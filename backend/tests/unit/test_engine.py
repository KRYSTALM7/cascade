"""Consequence engine (§H): golden NovaCart cascades + edge cases on small in-memory fixtures."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

import pytest

from app.domain.catalog import AgentDef, PermissionDef, ReactionDef
from app.domain.consequence.engine import CascadeLimits, ParamMappingError, resolve_params
from app.domain.consequence.report import ConsequenceReport, EdgeKind, NodeStatus
from app.domain.enums import (
    ConditionKey,
    CustomerStatus,
    DomainEvent,
    Reversibility,
    TriggerType,
)
from tests.factories import (
    NOW,
    hero,
    novacart_catalog,
    novacart_snapshot,
    seed_permissions,
    seed_reactions,
    simulate,
    with_agent,
    with_reaction,
    with_tool,
    without_permission,
)


def outline(report: ConsequenceReport) -> list[tuple[str, str, str]]:
    return [(n.agent_id, n.tool_id, n.status.value) for n in report.nodes]


# --- golden: the demo scenarios ---------------------------------------------------------------


def test_golden_hero_cancel_ord_10482() -> None:
    report = hero()
    assert outline(report) == [
        ("customer-support", "cancel_order", "WILL_EXECUTE"),
        ("finance", "issue_refund", "WILL_EXECUTE"),
        ("inventory", "release_inventory", "WILL_EXECUTE"),
        ("crm", "update_customer_status", "WILL_EXECUTE"),
        ("crm", "send_customer_notification", "WILL_EXECUTE"),
        ("crm", "create_customer_case", "WILL_EXECUTE"),
    ]
    refund, release, status, notify, case = report.nodes[1:]
    assert refund.rule_ref == "finance.refund_on_cancel@1"
    assert refund.params == {
        "order_id": "ORD-10482",
        "amount": "84500.00",
        "reason": "ORDER_CANCELLED",
    }
    assert refund.money[0].amount == Decimal("84500.00")
    assert refund.trigger_event is DomainEvent.ORDER_CANCELLED
    assert release.rule_ref == "inventory.release_on_cancel@1"
    assert status.params["status"] == "AT_RISK"
    assert notify.params["template"] == "REFUND_ISSUED"
    assert notify.parent_id == refund.id and notify.trigger_event is DomainEvent.REFUND_ISSUED
    assert case.params["reason"] == "HIGH_VALUE_REFUND"
    assert [n.depth for n in report.nodes] == [0, 1, 1, 1, 2, 2]

    radius = report.blast_radius
    assert radius.agents_affected == ["crm", "finance", "inventory"]
    assert radius.agent_count == 3
    assert radius.downstream_actions == 5
    assert radius.money_out == Decimal("84500.00")
    assert radius.money_in == Decimal("0.00")
    assert radius.reversibility is Reversibility.PARTIAL
    assert report.blocking == [] and report.warnings == []
    assert report.execution_order == ["n0", "n1", "n2", "n3", "n4", "n5"]


def test_golden_modify_ord_10495_watch_one_to_two() -> None:
    report = simulate(
        "customer-support",
        "modify_order",
        {"order_id": "ORD-10495", "lines": [{"sku": "SKU-WAT-003", "quantity": 2}]},
    )
    assert outline(report) == [
        ("customer-support", "modify_order", "WILL_EXECUTE"),
        ("inventory", "reserve_inventory", "WILL_EXECUTE"),
        ("crm", "send_customer_notification", "WILL_EXECUTE"),
        ("inventory", "create_restock_request", "WILL_EXECUTE"),
    ]
    assert report.nodes[2].params["template"] == "ORDER_UPDATED"
    assert report.nodes[3].trigger_event is DomainEvent.STOCK_BELOW_REORDER_POINT
    assert report.nodes[3].params == {"sku": "SKU-WAT-003", "quantity": 9}
    assert report.blast_radius.agents_affected == ["crm", "inventory"]
    assert report.blast_radius.money_out == Decimal("0.00")


def test_golden_cancel_ord_10510_small_refund() -> None:
    report = simulate("customer-support", "cancel_order", {"order_id": "ORD-10510"})
    assert [n.tool_id for n in report.nodes] == [
        "cancel_order",
        "issue_refund",
        "release_inventory",
        "send_customer_notification",
    ]
    assert report.blast_radius.money_out == Decimal("1998.00")


def test_golden_cancel_cod_order_has_no_finance_branch() -> None:
    """ORD-06"""
    report = simulate("customer-support", "cancel_order", {"order_id": "ORD-10490"})
    assert "finance" not in report.blast_radius.agents_affected
    assert [n.tool_id for n in report.nodes] == [
        "cancel_order",
        "release_inventory",
        "update_customer_status",
    ]
    assert report.blast_radius.money_out == Decimal("0.00")
    assert not report.is_blocked


def test_golden_support_cannot_issue_refund() -> None:
    """AGT-03: the unauthorized demo. Root blocked, nothing explored."""
    report = simulate("customer-support", "issue_refund", {"order_id": "ORD-10482"})
    assert outline(report) == [("customer-support", "issue_refund", "BLOCKED")]
    assert [r.code for r in report.blocking] == ["TOOL_NOT_PERMITTED"]
    assert report.blast_radius.downstream_actions == 0


# --- root authorization -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("agent", "tool", "catalog_kwargs", "code"),
    [
        ("ghost-agent", "cancel_order", {}, "AGENT_UNKNOWN"),  # AGT-01
        (
            "customer-support",
            "cancel_order",
            {"agents": with_agent("customer-support", enabled=False)},
            "AGENT_DISABLED",
        ),  # AGT-02
        ("customer-support", "reverse_payment", {}, "TOOL_NOT_PERMITTED"),  # AGT-03
        ("customer-support", "issue_refund", {}, "TOOL_NOT_PERMITTED"),  # AGT-05 (finance's)
        ("customer-support", "launch_rocket", {}, "TOOL_UNKNOWN"),  # TOOL-01
        (
            "customer-support",
            "cancel_order",
            {"tools": with_tool("cancel_order", enabled=False)},
            "TOOL_DISABLED",
        ),  # TOOL-02
    ],
)
def test_root_authorization_is_a_hard_block(
    agent: str, tool: str, catalog_kwargs: dict[str, object], code: str
) -> None:
    catalog = novacart_catalog(**catalog_kwargs)  # type: ignore[arg-type]
    report = simulate(agent, tool, {"order_id": "ORD-10482"}, catalog=catalog)
    assert report.root.status is NodeStatus.BLOCKED
    assert [r.code for r in report.blocking] == [code]
    assert len(report.nodes) == 1


@pytest.mark.parametrize(
    ("offset", "blocked"),
    [(timedelta(0), True), (timedelta(seconds=-1), True), (timedelta(microseconds=1), False)],
)
def test_permission_expiry_boundary(offset: timedelta, blocked: bool) -> None:
    """AGT-04: expires_at == now counts as expired."""
    perms = [
        replace(p, expires_at=NOW + offset)
        if (p.agent_id, p.tool_id) == ("customer-support", "cancel_order")
        else p
        for p in seed_permissions()
    ]
    report = hero(catalog=novacart_catalog(permissions=perms))
    assert report.is_blocked is blocked
    if blocked:
        assert report.blocking[0].code == "PERMISSION_EXPIRED"


def test_root_param_errors_block_with_stable_codes() -> None:
    report = simulate("customer-support", "cancel_order", {"order_id": "ORD-10482", "x": 1})
    assert report.blocking[0].code == "INVALID_PARAMETERS"
    report = simulate("customer-support", "cancel_order", {})
    assert report.blocking[0].code == "MISSING_PARAMETERS"
    report = simulate(
        "customer-support", "request_refund", {"order_id": "ORD-10482", "amount": "0.005"}
    )
    assert report.blocking[0].code == "INVALID_AMOUNT"


def test_root_precondition_failure_blocks_with_its_code() -> None:
    """ORD-02 end-to-end through the engine."""
    report = simulate("customer-support", "cancel_order", {"order_id": "ORD-10460"})
    assert report.root.status is NodeStatus.WOULD_FAIL
    assert [r.code for r in report.blocking] == ["ORDER_ALREADY_CANCELLED"]


# --- graph shape ------------------------------------------------------------------------------


def test_no_reactions_fire_gives_a_single_node() -> None:
    """GRAPH-01"""
    report = simulate(
        "crm",
        "send_customer_notification",
        {
            "customer_id": "CUST-1005",
            "order_id": "ORD-10501",
            "template": "ORDER_SHIPPED",
            "channel": "SMS",
        },
    )
    assert len(report.nodes) == 1 and report.edges == []
    assert report.blast_radius.agent_count == 0


def test_one_reaction_gives_one_trigger_edge_with_rule_version() -> None:
    """GRAPH-02"""
    report = simulate(
        "customer-support", "issue_compensation", {"order_id": "ORD-10482", "amount": "500.00"}
    )
    assert len(report.nodes) == 2
    (edge,) = report.edges
    assert (edge.source, edge.target, edge.kind) == ("n0", "n1", EdgeKind.TRIGGER)
    assert (edge.rule_id, edge.rule_version) == ("crm.notify_on_compensation", 1)
    assert report.nodes[1].trigger_type is TriggerType.AGENT_REACTION


def test_multiple_reactions_are_ordered_by_priority_then_rule_id() -> None:
    """GRAPH-03: equal priorities fall back to rule id, regardless of declaration order."""
    rules = [
        replace(r, priority=5) if r.event_type is DomainEvent.ORDER_CANCELLED else r
        for r in reversed(seed_reactions())
    ]
    report = hero(catalog=novacart_catalog(reactions=rules))
    assert [n.rule_id for n in report.nodes[1:4]] == [
        "crm.flag_vip_on_cancel",
        "finance.refund_on_cancel",
        "inventory.release_on_cancel",
    ]


def test_same_agent_tool_params_twice_is_a_duplicate_edge_counted_once() -> None:
    """GRAPH-04 / REF-09"""
    twin = ReactionDef(
        id="finance.refund_on_cancel_twin",
        agent_id="finance",
        event_type=DomainEvent.ORDER_CANCELLED,
        tool_id="issue_refund",
        param_mapping={
            "order_id": "$event.order_id",
            "amount": "$event.refundable_amount",
            "reason": "ORDER_CANCELLED",
        },
        condition_key=ConditionKey.PAYMENT_CAPTURED,
        priority=11,
    )
    report = hero(catalog=novacart_catalog(reactions=[*seed_reactions(), twin]))
    refunds = [n for n in report.nodes if n.tool_id == "issue_refund"]
    assert len(refunds) == 1
    dup = [e for e in report.edges if e.kind is EdgeKind.DUPLICATE]
    assert [(e.source, e.target, e.rule_id) for e in dup] == [
        ("n0", refunds[0].id, "finance.refund_on_cancel_twin")
    ]
    assert report.blast_radius.money_out == Decimal("84500.00")
    assert not report.cycle_detected


def test_cycle_is_cut_and_reported() -> None:
    """GRAPH-05: refund -> case -> (rule) same refund again."""
    loop = ReactionDef(
        id="finance.refund_on_case",
        agent_id="finance",
        event_type=DomainEvent.CASE_OPENED,
        tool_id="issue_refund",
        param_mapping={"order_id": "$event.order_id", "amount": "100.00", "reason": "LOOP"},
    )
    always_case = ReactionDef(
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
    catalog = novacart_catalog(reactions=[loop, always_case])
    report = simulate(
        "finance",
        "issue_refund",
        {"order_id": "ORD-10482", "amount": "100.00", "reason": "LOOP"},
        catalog=catalog,
    )
    assert [n.tool_id for n in report.nodes] == ["issue_refund", "create_customer_case"]
    cycles = [e for e in report.edges if e.kind is EdgeKind.CYCLE]
    assert [(e.source, e.target) for e in cycles] == [("n1", "n0")]
    assert report.cycle_detected
    assert [w.code for w in report.warnings] == ["CYCLE_DETECTED"]
    assert report.blast_radius.money_out == Decimal("100.00")


# --- downstream authorization & failures ------------------------------------------------------


def test_disabled_downstream_agent_on_required_rule_blocks_the_action() -> None:
    """GRAPH-06"""
    report = hero(catalog=novacart_catalog(agents=with_agent("finance", enabled=False)))
    refund = report.nodes[1]
    assert (refund.tool_id, refund.status) == ("issue_refund", NodeStatus.BLOCKED)
    assert [r.code for r in report.blocking] == ["DOWNSTREAM_AGENT_DISABLED"]
    assert report.blocking[0].node_id == refund.id
    # its consequences were never explored
    assert "send_customer_notification" not in [n.tool_id for n in report.nodes]


def test_disabled_downstream_agent_on_optional_rule_is_a_warning() -> None:
    """GRAPH-07"""
    report = hero(catalog=novacart_catalog(agents=with_agent("crm", enabled=False)))
    assert not report.is_blocked
    crm_nodes = [n for n in report.nodes if n.agent_id == "crm"]
    assert {n.status for n in crm_nodes} == {NodeStatus.BLOCKED}
    assert {w.code for w in report.warnings} == {"DOWNSTREAM_AGENT_DISABLED"}
    assert report.blast_radius.agents_affected == ["finance", "inventory"]


def test_downstream_agent_without_permission_is_blocked_where_it_happens() -> None:
    """GRAPH-08 (required -> whole action)"""
    report = hero(
        catalog=novacart_catalog(permissions=without_permission("finance", "issue_refund"))
    )
    assert [r.code for r in report.blocking] == ["DOWNSTREAM_NOT_PERMITTED"]
    assert report.node(report.blocking[0].node_id or "").tool_id == "issue_refund"


def test_downstream_agent_without_permission_on_optional_rule_warns() -> None:
    """GRAPH-08 (optional -> warning)"""
    perms = without_permission("crm", "create_customer_case")
    report = hero(catalog=novacart_catalog(permissions=perms))
    assert not report.is_blocked
    assert [(w.code, report.node(w.node_id or "").tool_id) for w in report.warnings] == [
        ("DOWNSTREAM_NOT_PERMITTED", "create_customer_case")
    ]


def test_downstream_expired_permission_has_its_own_code() -> None:
    perms = [
        replace(p, expires_at=NOW) if (p.agent_id, p.tool_id) == ("finance", "issue_refund") else p
        for p in seed_permissions()
    ]
    report = hero(catalog=novacart_catalog(permissions=perms))
    assert [r.code for r in report.blocking] == ["DOWNSTREAM_PERMISSION_EXPIRED"]


def test_downstream_disabled_tool_has_its_own_code() -> None:
    report = hero(catalog=novacart_catalog(tools=with_tool("issue_refund", enabled=False)))
    assert [r.code for r in report.blocking] == ["DOWNSTREAM_TOOL_DISABLED"]


def test_required_downstream_precondition_failure_blocks() -> None:
    """GRAPH-09 (required)"""
    rules = with_reaction(
        "finance.refund_on_cancel",
        param_mapping={"order_id": "$event.order_id", "amount": "999999.00", "reason": "X"},
    )
    report = hero(catalog=novacart_catalog(reactions=rules))
    assert report.nodes[1].status is NodeStatus.WOULD_FAIL
    assert report.nodes[1].status_code == "REFUND_EXCEEDS_REFUNDABLE"
    assert [r.code for r in report.blocking] == ["REQUIRED_REACTION_WOULD_FAIL"]
    assert report.blocking[0].details["cause"] == "REFUND_EXCEEDS_REFUNDABLE"


def test_optional_downstream_precondition_failure_warns() -> None:
    """GRAPH-09 (optional): VIP already AT_RISK -> status update would fail, action proceeds."""
    snapshot = novacart_snapshot()
    customers = dict(snapshot.customers)
    customers["CUST-1001"] = replace(customers["CUST-1001"], status=CustomerStatus.AT_RISK)
    report = hero(snapshot=replace(snapshot, customers=customers))
    assert not report.is_blocked
    assert [(w.code, w.node_id) for w in report.warnings] == [("STATUS_UNCHANGED", "n3")]
    assert report.blast_radius.would_fail_nodes == ["n3"]
    assert report.blast_radius.downstream_actions == 4


def test_disabled_rule_never_fires() -> None:
    rules = with_reaction("finance.refund_on_cancel", enabled=False)
    report = hero(catalog=novacart_catalog(reactions=rules))
    assert "issue_refund" not in [n.tool_id for n in report.nodes]


def test_misconfigured_condition_fails_closed() -> None:
    rules = with_reaction("crm.case_on_large_refund", condition_params={})
    report = hero(catalog=novacart_catalog(reactions=rules))
    case = next(n for n in report.nodes if n.tool_id == "create_customer_case")
    assert (case.status, case.status_code) == (NodeStatus.WOULD_FAIL, "RULE_MISCONFIGURED")


def test_bad_param_mapping_fails_closed() -> None:
    rules = with_reaction(
        "inventory.release_on_cancel", param_mapping={"order_id": "$event.nope"}, required=True
    )
    report = hero(catalog=novacart_catalog(reactions=rules))
    assert report.nodes[2].status_code == "PARAM_MAPPING_INVALID"
    assert report.blocking[0].code == "REQUIRED_REACTION_WOULD_FAIL"


def test_resolve_params_only_allows_event_references() -> None:
    payload = {"order_id": "ORD-1", "amount": "5.00"}
    assert resolve_params({"order_id": "$event.order_id", "reason": "X"}, payload) == {
        "order_id": "ORD-1",
        "reason": "X",
    }
    with pytest.raises(ParamMappingError):
        resolve_params({"x": "$state.orders"}, payload)
    with pytest.raises(ParamMappingError):
        resolve_params({"x": "$event.missing"}, payload)


# --- limits & determinism ---------------------------------------------------------------------


def test_depth_limit_stops_exploration_and_flags_it() -> None:
    """GRAPH-10 (depth)"""
    report = hero(limits=CascadeLimits(max_depth=1, max_nodes=50))
    assert report.limit_reached
    skipped = [n.tool_id for n in report.nodes if n.status is NodeStatus.SKIPPED_LIMIT]
    assert skipped == ["send_customer_notification", "create_customer_case"]
    assert [w.code for w in report.warnings] == ["CASCADE_LIMIT_REACHED"]


def test_node_limit_stops_exploration_and_flags_it() -> None:
    """GRAPH-10 (nodes)"""
    report = hero(limits=CascadeLimits(max_depth=6, max_nodes=2))
    statuses = [n.status for n in report.nodes]
    assert statuses[:2] == [NodeStatus.WILL_EXECUTE, NodeStatus.WILL_EXECUTE]
    assert set(statuses[2:]) == {NodeStatus.SKIPPED_LIMIT}
    assert report.limit_reached


def test_same_input_gives_byte_identical_report() -> None:
    """GRAPH-11"""
    first, second = hero(), hero()
    assert first.canonical_json() == second.canonical_json()
    assert first.fingerprint == second.fingerprint
    assert len(first.fingerprint) == 64


def test_fingerprint_covers_rows_read_by_the_cascade() -> None:
    report = hero()
    read = {(r.resource_type, r.resource_id) for r in report.reads}
    assert {
        ("order", "ORD-10482"),
        ("payment", "PAY-90482"),
        ("customer", "CUST-1001"),
        ("inventory_item", "SKU-LAP-001"),
        ("inventory_item", "SKU-HPH-002"),
    } <= read
    assert ("order", "ORD-10540") not in read


def test_unrelated_permission_does_not_change_the_report() -> None:
    perms = [*seed_permissions(), PermissionDef("order", "issue_refund")]
    agents = [*with_agent("crm"), AgentDef("extra-agent")]
    report = hero(catalog=novacart_catalog(permissions=perms, agents=agents))
    assert report.canonical_json() == hero().canonical_json()
