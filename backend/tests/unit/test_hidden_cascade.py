"""The hidden cascade (HID-*): an authorized, low-risk action whose danger only appears AFTER it.

Customer Support trims ORD-10550 from 2 laptops to 1. On its own that is a fully reversible order
edit that moves no money (LOW, auto-approvable). Simulating it shows the Finance agent, reacting
to ORDER_MODIFIED under its OWN permission, refunding ₹72,000 irreversibly, plus CRM case and
emails. Everything below is produced by the engines from seed data; nothing is hardcoded.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal
from typing import Any

from app.domain.consequence.engine import simulate_action
from app.domain.consequence.report import ConsequenceReport, NodeStatus
from app.domain.enums import (
    ConditionKey,
    DataSensitivity,
    Decision,
    DomainEvent,
    ImpactLevel,
    Reversibility,
    RiskLevel,
    TriggerType,
)
from app.domain.policy.engine import assess_direct, decide
from app.domain.risk.scorer import score_report
from tests.factories import (
    LIMITS,
    NOW,
    POLICY,
    novacart_catalog,
    novacart_snapshot,
    seed_permissions,
    seed_reactions,
)

AGENT = "customer-support"
TOOL = "modify_order"
PARAMS: dict[str, Any] = {"order_id": "ORD-10550", "lines": [{"sku": "SKU-LAP-001", "quantity": 1}]}


def hidden(**catalog: Any) -> ConsequenceReport:
    return simulate_action(
        snapshot=novacart_snapshot(),
        catalog=novacart_catalog(**catalog),
        agent_id=AGENT,
        tool_id=TOOL,
        params=PARAMS,
        now=NOW,
        limits=LIMITS,
    )


def finance_node(report: ConsequenceReport) -> Any:
    return next(n for n in report.nodes if n.agent_id == "finance")


def test_a_initial_action_is_authorized() -> None:
    """HID-01"""
    root = hidden().root
    assert (root.agent_id, root.tool_id, root.trigger_type) == (AGENT, TOOL, TriggerType.ROOT)
    assert root.status is NodeStatus.WILL_EXECUTE
    assert root.authorization is not None and root.authorization.granted
    assert root.authorization.code is None


def test_b_initial_action_alone_is_low_risk_and_auto_approvable() -> None:
    """HID-02: what a per-tool permission check sees."""
    report = hidden()
    direct = report.direct_effect
    assert direct is not None
    assert direct.money_out == Decimal("0.00")
    assert direct.reversibility is Reversibility.FULL
    assert (direct.agent_count, direct.downstream_actions) == (0, 0)
    assert direct.systems_affected == ["order", "order_item"]
    alone = assess_direct(report, POLICY)
    assert (alone.score, alone.level, alone.decision) == (10, RiskLevel.LOW, Decision.AUTO_APPROVED)
    assert alone.reasons == []


def test_c_initial_action_changes_state_and_emits_an_event() -> None:
    """HID-03"""
    root = hidden().root
    fields = {(c.resource_type, c.resource_id, c.field): (c.before, c.after) for c in root.changes}
    assert fields[("order_item", "ORD-10550/SKU-LAP-001", "quantity")] == (2, 1)
    assert fields[("order", "ORD-10550", "total_amount")] == ("144000.00", "72000.00")
    assert root.money == []  # the edit itself moves no money
    [event] = root.events
    assert event.type is DomainEvent.ORDER_MODIFIED
    assert event.payload["total_decrease"] == "72000.00"
    assert event.payload["decreased_lines"] == [{"sku": "SKU-LAP-001", "quantity": 1}]


def test_d_downstream_agent_is_triggered_by_the_event_through_a_rule() -> None:
    """HID-04: event -> reaction rule -> Finance agent -> Finance's own tool proposal."""
    report = hidden()
    node = finance_node(report)
    assert node.trigger_type is TriggerType.AGENT_REACTION
    assert node.parent_id == report.root.id
    assert node.trigger_event is DomainEvent.ORDER_MODIFIED
    assert (node.rule_id, node.rule_version) == ("finance.refund_on_downsize", 1)
    assert node.trigger_condition is ConditionKey.TOTAL_DECREASED
    assert node.trigger_reason == "Finance refunds the difference when an order gets cheaper."
    assert node.tool_id == "issue_refund"
    assert node.params == {
        "order_id": "ORD-10550",
        "amount": "72000.00",
        "reason": "ORDER_MODIFIED",
    }
    edge = next(e for e in report.edges if e.target == node.id)
    assert (edge.source, edge.event, edge.rule_id) == (
        report.root.id,
        DomainEvent.ORDER_MODIFIED,
        "finance.refund_on_downsize",
    )


def test_e_downstream_agent_is_authorized_independently() -> None:
    """HID-05: the proposer may NOT refund; Finance may, under its own permission. Revoke
    Finance's permission and the cascade is blocked at the Finance node while the root stays
    authorized: permission is never inherited from the action that triggered it."""
    catalog = novacart_catalog()
    assert (AGENT, "issue_refund") not in catalog.permissions
    node = finance_node(hidden())
    assert node.authorization is not None and node.authorization.granted
    assert "its own permission" in node.authorization.message

    revoked = [
        p for p in seed_permissions() if (p.agent_id, p.tool_id) != ("finance", "issue_refund")
    ]
    report = hidden(permissions=revoked)
    assert report.root.authorization is not None and report.root.authorization.granted
    node = finance_node(report)
    assert node.status is NodeStatus.BLOCKED
    assert node.authorization is not None and not node.authorization.granted
    assert node.authorization.code == "DOWNSTREAM_NOT_PERMITTED"
    risk = score_report(report, POLICY)
    result = decide(report, risk, POLICY)
    assert result.decision is Decision.BLOCKED
    assert result.codes[0] == "DOWNSTREAM_NOT_PERMITTED"


def test_f_downstream_consequences_are_in_the_blast_radius() -> None:
    """HID-06"""
    radius = hidden().blast_radius
    assert radius.agents_affected == ["crm", "finance", "inventory"]
    assert radius.downstream_actions == 5
    assert radius.money_out == Decimal("72000.00")
    assert radius.systems_affected == [
        "customer_case",
        "inventory_item",
        "notification",
        "order",
        "order_item",
        "payment",
        "refund",
    ]
    assert radius.record_count == 8
    assert radius.irreversible_nodes  # the refund and the emails cannot be undone


def test_g_impact_is_calculated_deterministically() -> None:
    """HID-07: same input, byte-identical report; every figure from the engines."""
    first, second = hidden(), hidden()
    assert first.canonical_json() == second.canonical_json()
    radius = first.blast_radius
    assert (radius.customer_impact, radius.data_sensitivity, radius.reversibility) == (
        ImpactLevel.MEDIUM,
        DataSensitivity.PII,
        Reversibility.PARTIAL,
    )
    risk = score_report(first, POLICY)
    assert {d.key: str(d.score) for d in risk.dimensions} == {
        "financial": "88.8",
        "irreversibility": "50.0",
        "downstream": "75.0",
        "customer": "50.0",
        "data": "60.0",
    }
    assert (risk.raw_score, risk.score, risk.level) == (68, 68, RiskLevel.HIGH)


def test_h_final_decision_reflects_the_downstream_consequence() -> None:
    """HID-08: alone -> AUTO_APPROVED; with what happens next -> APPROVAL_REQUIRED."""
    report = hidden()
    risk = score_report(report, POLICY)
    result = decide(report, risk, POLICY)
    assert result.decision is Decision.APPROVAL_REQUIRED
    assert result.codes[:2] == ["REFUND_ABOVE_AUTO_LIMIT", "HIGH_RISK"]
    assert result.money_out == Decimal("72000.00")
    assert assess_direct(report, POLICY).decision is Decision.AUTO_APPROVED


def test_report_records_the_configuration_it_depended_on() -> None:
    """CFG-01: every reaction rule consulted for an emitted event (fired or not) is listed with
    its version; a change to one of them changes the rules fingerprint, a change to a rule for an
    event this cascade never emits does not."""
    base = hidden()
    assert base.config is not None
    consulted = {r.id for r in base.config.reaction_rules}
    assert {"finance.refund_on_downsize", "inventory.reserve_on_modify"} <= consulted
    assert "finance.refund_on_cancel" not in consulted  # ORDER_CANCELLED is never emitted

    def bumped(rule_id: str) -> ConsequenceReport:
        rules = [replace(r, version=2) if r.id == rule_id else r for r in seed_reactions()]
        return hidden(reactions=rules)

    changed = bumped("inventory.reserve_on_modify")  # consulted, did not fire
    assert changed.config is not None
    assert changed.config.rules_fingerprint != base.config.rules_fingerprint
    unrelated = bumped("finance.refund_on_cancel")
    assert unrelated.config is not None
    assert unrelated.config.rules_fingerprint == base.config.rules_fingerprint
    assert unrelated.config.catalog_fingerprint == base.config.catalog_fingerprint


def test_policy_fingerprint_tracks_content_not_just_the_version_label() -> None:
    """CFG-02"""
    edited = POLICY.model_copy(update={"auto_approve_limit": Decimal("1000.00")})
    assert edited.version == POLICY.version
    assert edited.fingerprint() != POLICY.fingerprint()
    assert score_report(hidden(), POLICY).policy_fingerprint == POLICY.fingerprint()
