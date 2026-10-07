"""Policy file, risk scorer and decision engine (blueprint §G.2)."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any

import pytest
import yaml

from app.domain.catalog import ReactionDef
from app.domain.consequence.engine import CascadeLimits
from app.domain.consequence.report import ConsequenceReport
from app.domain.enums import (
    CustomerStatus,
    DataSensitivity,
    Decision,
    DomainEvent,
    RiskLevel,
    UserRole,
)
from app.domain.policy.engine import DecisionResult, approver_error, decide
from app.domain.policy.loader import PolicyError, load_policy, parse_policy
from app.domain.policy.model import Policy
from app.domain.policy.reasons import TEMPLATES, Severity
from app.domain.risk.scorer import RiskAssessment, financial_score, score_report
from tests.factories import (
    POLICY,
    POLICY_PATH,
    hero,
    novacart_catalog,
    novacart_snapshot,
    simulate,
    with_tool,
)


def assess(
    report: ConsequenceReport, policy: Policy = POLICY
) -> tuple[RiskAssessment, DecisionResult]:
    risk = score_report(report, policy)
    return risk, decide(report, risk, policy)


def raw_policy() -> dict[str, Any]:
    loaded = yaml.safe_load(POLICY_PATH.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


# --- policy file --------------------------------------------------------------------------------


def test_policy_file_loads_with_the_blueprint_values() -> None:
    policy = load_policy(POLICY_PATH)
    assert policy.auto_approve_limit == Decimal("2000.00")
    assert policy.high_value_refund == Decimal("25000.00")
    assert policy.approval_expiry_minutes == 30
    assert (policy.cascade.max_depth, policy.cascade.max_nodes) == (6, 50)
    w = policy.risk.weights
    assert (w.financial, w.irreversibility, w.downstream, w.customer, w.data) == tuple(
        Decimal(x) for x in ("0.35", "0.20", "0.15", "0.20", "0.10")
    )


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("risk", "weights", "data"), "0.11", "sum to 1"),
        (("auto_approve_limit",), 2000.0, "quoted strings"),
        (("risk", "levels", "high"), 30, "medium < high"),
        (("risk", "financial_breakpoints", 0, "amount"), "10", "amount 0"),
        (("risk", "customer_impact"), {"NONE": 0}, "missing"),
        (("surprise",), 1, "Extra inputs"),
    ],
)
def test_invalid_policy_is_refused(path: tuple[Any, ...], value: Any, message: str) -> None:
    raw = raw_policy()
    target: Any = raw
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(PolicyError, match=message):
        parse_policy(raw)


def test_missing_policy_file_is_refused(tmp_path: Any) -> None:
    with pytest.raises(PolicyError):
        load_policy(tmp_path / "nope.yaml")


# --- risk scorer --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("amount", "expected"),
    [
        ("0", "0"),
        ("1000", "15"),
        ("2000", "30"),
        ("25000", "70"),
        ("84500", "93.8"),
        ("100000", "100"),
        ("250000", "100"),
        ("-84500", "93.8"),
    ],
)
def test_financial_dimension_is_piecewise_linear(amount: str, expected: str) -> None:
    assert financial_score(Decimal(amount), POLICY.risk.financial_breakpoints) == Decimal(expected)


def test_hero_worked_example_is_76_high_approval_required() -> None:
    """Blueprint worked example: F 93.8 · I 50 · D 75 · C 80 · X 60 -> 76 HIGH."""
    risk, decision = assess(hero())
    assert {d.key: d.score for d in risk.dimensions} == {
        "financial": Decimal("93.8"),
        "irreversibility": Decimal("50.0"),
        "downstream": Decimal("75.0"),
        "customer": Decimal("80.0"),
        "data": Decimal("60.0"),
    }
    assert (risk.raw_score, risk.score, risk.level) == (76, 76, RiskLevel.HIGH)
    assert decision.decision is Decision.APPROVAL_REQUIRED
    assert decision.codes == ["REFUND_ABOVE_AUTO_LIMIT", "HIGH_RISK", "FLOOR_HIGH_VALUE_OUTFLOW"]
    assert decision.reasons[0].message == (
        "₹84,500.00 would leave NovaCart, above the ₹2,000.00 auto-approve limit."
    )
    assert decision.money_out == Decimal("84500.00")
    explanations = {d.key: d.explanation for d in risk.dimensions}
    assert explanations["downstream"] == "3 other agents act: crm, finance, inventory."
    assert explanations["irreversibility"] == "3 of 6 steps cannot be undone."


def request_refund(amount: str) -> ConsequenceReport:
    return simulate(
        "customer-support", "request_refund", {"order_id": "ORD-10482", "amount": amount}
    )


@pytest.mark.parametrize(
    ("amount", "decision"),
    [
        ("1999.99", Decision.AUTO_APPROVED),  # REF-05
        ("2000.00", Decision.AUTO_APPROVED),  # REF-04: the limit is inclusive
        ("2000.01", Decision.APPROVAL_REQUIRED),  # REF-06
    ],
)
def test_auto_approve_limit_boundaries(amount: str, decision: Decision) -> None:
    _, result = assess(request_refund(amount))
    assert result.decision is decision
    if decision is Decision.APPROVAL_REQUIRED:
        assert result.codes[0] == "REFUND_ABOVE_AUTO_LIMIT"
    else:
        assert result.codes == ["WITHIN_POLICY"]


def test_small_cancel_ord_10510_is_auto_approved() -> None:
    risk, result = assess(simulate("customer-support", "cancel_order", {"order_id": "ORD-10510"}))
    assert (risk.score, risk.level) == (54, RiskLevel.MEDIUM)
    assert result.decision is Decision.AUTO_APPROVED
    assert result.reasons[0].message == (
        "₹1,998.00 is within the ₹2,000.00 auto-approve limit and risk is MEDIUM."
    )


def test_unauthorized_is_blocked_regardless_of_risk() -> None:
    risk, result = assess(simulate("customer-support", "issue_refund", {"order_id": "ORD-10482"}))
    assert result.decision is Decision.BLOCKED
    assert result.codes == ["TOOL_NOT_PERMITTED"]
    assert result.reasons[0].severity is Severity.BLOCK
    assert risk.level is RiskLevel.LOW  # low risk never un-blocks an authorization failure


def test_compensation_alternative_is_lower_risk_than_cancelling() -> None:
    comp_risk, comp = assess(
        simulate(
            "customer-support", "issue_compensation", {"order_id": "ORD-10482", "percentage": "20"}
        )
    )
    hero_risk, _ = assess(hero())
    assert comp.money_out == Decimal("16900.00")
    assert (comp_risk.score, comp_risk.level) == (53, RiskLevel.MEDIUM)
    assert comp_risk.score < hero_risk.score
    assert comp.decision is Decision.APPROVAL_REQUIRED  # still above ₹2,000


def test_medium_scenario_scores_from_the_formula() -> None:
    """ORD-10495 watch 1->2: no money, 2 agents, PII email -> 34 (LOW band starts below 35)."""
    report = simulate(
        "customer-support",
        "modify_order",
        {"order_id": "ORD-10495", "lines": [{"sku": "SKU-WAT-003", "quantity": 2}]},
    )
    risk, result = assess(report)
    assert (risk.raw_score, risk.level) == (34, RiskLevel.LOW)
    assert result.decision is Decision.AUTO_APPROVED


def test_same_report_gives_identical_assessment() -> None:
    assert assess(hero()) == assess(hero())


# --- every reason code ------------------------------------------------------------------------


def test_high_risk_alone_requires_approval() -> None:
    policy = POLICY.model_copy(update={"auto_approve_limit": Decimal("1000000.00")})
    _, result = assess(hero(), policy)
    assert result.codes[:1] == ["HIGH_RISK"]
    assert "REFUND_ABOVE_AUTO_LIMIT" not in result.codes


def test_fully_irreversible_cascade_at_medium_risk_requires_approval() -> None:
    policy = POLICY.model_copy(update={"auto_approve_limit": Decimal("1000000.00")})
    report = simulate(
        "customer-support", "issue_compensation", {"order_id": "ORD-10482", "percentage": "20"}
    )
    _, result = assess(report, policy)
    assert result.codes[0] == "IRREVERSIBLE_AT_MEDIUM_RISK"


def test_bulk_pii_requires_approval() -> None:
    tools = with_tool("send_customer_notification", data_sensitivity=DataSensitivity.BULK_PII)
    report = simulate(
        "customer-support",
        "cancel_order",
        {"order_id": "ORD-10510"},
        catalog=novacart_catalog(tools=tools),
    )
    _, result = assess(report)
    assert "BULK_PII_EXPOSURE" in result.codes


def test_cascade_limit_requires_approval_and_floors_risk_at_high() -> None:
    """GRAPH-10 (risk floor)"""
    report = simulate(
        "customer-support",
        "cancel_order",
        {"order_id": "ORD-10510"},
        limits=CascadeLimits(max_depth=0, max_nodes=50),
    )
    risk, result = assess(report)
    assert risk.raw_score < 60
    assert (risk.level, risk.score) == (RiskLevel.HIGH, 60)
    assert "CASCADE_LIMIT_REACHED" in result.codes
    assert "FLOOR_CASCADE_LIMIT" in result.codes
    assert result.decision is Decision.APPROVAL_REQUIRED


def test_high_value_outflow_floors_risk_at_high() -> None:
    report = simulate(
        "customer-support", "issue_compensation", {"order_id": "ORD-10482", "amount": "30000.00"}
    )
    risk, result = assess(report)
    assert (risk.raw_score, risk.level, risk.score) == (59, RiskLevel.HIGH, 60)
    assert "FLOOR_HIGH_VALUE_OUTFLOW" in result.codes


def test_cycle_requires_approval() -> None:
    loop = ReactionDef(
        id="finance.refund_on_case",
        agent_id="finance",
        event_type=DomainEvent.CASE_OPENED,
        tool_id="issue_refund",
        param_mapping={"order_id": "$event.order_id", "amount": "100.00", "reason": "LOOP"},
    )
    case = ReactionDef(
        id="crm.case_on_refund",
        agent_id="crm",
        event_type=DomainEvent.REFUND_ISSUED,
        tool_id="create_customer_case",
        param_mapping={
            "customer_id": "$event.customer_id",
            "order_id": "$event.order_id",
            "reason": "LOOP",
        },
    )
    report = simulate(
        "finance",
        "issue_refund",
        {"order_id": "ORD-10482", "amount": "100.00", "reason": "LOOP"},
        catalog=novacart_catalog(reactions=[loop, case]),
    )
    _, result = assess(report)
    assert result.codes[0] == "CYCLE_DETECTED"


def test_optional_step_that_will_not_run_is_explained() -> None:
    snapshot = novacart_snapshot()
    customers = dict(snapshot.customers)
    customers["CUST-1001"] = replace(customers["CUST-1001"], status=CustomerStatus.AT_RISK)
    _, result = assess(hero(snapshot=replace(snapshot, customers=customers)))
    skipped = [r for r in result.reasons if r.code == "OPTIONAL_STEP_SKIPPED"]
    assert [r.message for r in skipped] == [
        "update_customer_status by crm will not run (STATUS_UNCHANGED); "
        "it is optional, so the action proceeds."
    ]


def test_every_template_code_is_exercised_by_this_module() -> None:
    source = (POLICY_PATH.parents[1] / "tests" / "unit" / "test_policy_risk.py").read_text(
        encoding="utf-8"
    )
    assert [code for code in TEMPLATES if f'"{code}"' not in source] == []


# --- approvers ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("approver", "role", "limit", "expected"),
    [
        ("approver-asha", UserRole.APPROVER, "100000.00", None),
        ("ops-ravi", UserRole.OPERATOR, None, "APPROVER_NOT_AUTHORIZED"),  # APR-05
        ("viewer-kim", UserRole.VIEWER, None, "APPROVER_NOT_AUTHORIZED"),
        ("approver-dev", UserRole.APPROVER, "10000.00", "APPROVAL_LIMIT_EXCEEDED"),  # APR-06
        ("approver-asha", UserRole.APPROVER, "84500.00", None),  # limit == outflow is enough
        ("proposer", UserRole.APPROVER, "100000.00", "SELF_APPROVAL_FORBIDDEN"),  # APR-07
    ],
)
def test_approver_rules(
    approver: str, role: UserRole, limit: str | None, expected: str | None
) -> None:
    error = approver_error(
        approver_id=approver,
        approver_role=role,
        approval_limit=Decimal(limit) if limit else None,
        proposer_id="proposer",
        money_out=Decimal("84500.00"),
    )
    assert (error[0] if error else None) == expected
