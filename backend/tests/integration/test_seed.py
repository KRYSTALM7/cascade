"""NovaCart seed invariants. If these break, a demo scenario silently stops working."""

from __future__ import annotations

from collections import Counter
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.enums import OrderStatus
from app.models import (
    AgentPermission,
    AgentReaction,
    InventoryItem,
    Order,
    OrderItem,
    Payment,
    Tool,
)
from app.repositories.business import BusinessRepository
from app.seed import novacart_data as data
from app.seed.novacart import reset_and_seed

pytestmark = pytest.mark.db


def _permissions(db: Session) -> set[tuple[str, str]]:
    return {(p.agent_id, p.tool_id) for p in db.scalars(select(AgentPermission))}


def test_seed_is_idempotent(db_session: Session) -> None:
    first = reset_and_seed(db_session)
    second = reset_and_seed(db_session)
    assert first == second
    assert db_session.scalar(select(func.count()).select_from(Order)) == len(data.ORDERS)


def test_hero_order_is_84500_vip_with_matching_captured_payment(db_session: Session) -> None:
    order = BusinessRepository(db_session).get_order("ORD-10482")
    assert order is not None
    assert order.total_amount == Decimal("84500.00")
    assert order.status is OrderStatus.CONFIRMED
    assert order.customer.tier == "VIP"
    assert [(p.amount, p.refunded_amount, p.status) for p in order.payments] == [
        (Decimal("84500.00"), Decimal("0.00"), "CAPTURED")
    ]


def test_order_totals_equal_sum_of_lines(db_session: Session) -> None:
    for order in db_session.scalars(select(Order)):
        lines = db_session.scalars(select(OrderItem).where(OrderItem.order_id == order.id))
        assert order.total_amount == sum((i.unit_price * i.quantity for i in lines), Decimal(0))


def test_payments_never_exceed_order_total(db_session: Session) -> None:
    for payment in db_session.scalars(select(Payment)):
        order = db_session.get(Order, payment.order_id)
        assert order is not None and payment.amount == order.total_amount


def test_inventory_reserved_matches_open_order_holds(db_session: Session) -> None:
    held: Counter[str] = Counter()
    for item in db_session.scalars(select(OrderItem)):
        held[item.sku] += item.reserved_quantity
    for inv in db_session.scalars(select(InventoryItem)):
        assert inv.reserved == held[inv.sku], inv.sku


def test_every_reaction_rule_is_executable_by_its_agent(db_session: Session) -> None:
    """An ENABLED reaction whose agent lacks permission would BLOCK every happy path. The only
    exception is the Escape Room rule, which is seeded disabled and toggled by its scenario."""
    permitted = _permissions(db_session)
    rules = list(db_session.scalars(select(AgentReaction)))
    for rule in rules:
        if rule.enabled:
            assert (rule.agent_id, rule.tool_id) in permitted, rule.id
    unauthorized = [r.id for r in rules if (r.agent_id, r.tool_id) not in permitted]
    assert unauthorized == ["crm.goodwill_on_vip_cancel"]
    assert not db_session.get(AgentReaction, "crm.goodwill_on_vip_cancel").enabled  # type: ignore[union-attr]


def test_reaction_parameter_mappings_only_reference_event_fields(db_session: Session) -> None:
    for rule in db_session.scalars(select(AgentReaction)):
        for value in rule.param_mapping.values():
            if isinstance(value, str) and value.startswith("$"):
                assert value.startswith("$event."), (rule.id, value)


def test_unauthorized_demo_preconditions_hold(db_session: Session) -> None:
    permitted = _permissions(db_session)
    assert ("customer-support", "cancel_order") in permitted
    assert ("customer-support", "issue_refund") not in permitted
    assert ("customer-support", "reverse_payment") not in permitted


def test_every_tool_has_an_enabled_owner_agent(db_session: Session) -> None:
    for tool in db_session.scalars(select(Tool)):
        assert tool.owner.enabled, tool.id


def test_three_johns_exist_for_clarification(db_session: Session) -> None:
    johns = BusinessRepository(db_session).find_customers_by_name("john")
    assert [c.id for c in johns] == ["CUST-1001", "CUST-1002", "CUST-1003"]
    assert len(johns[0].orders) == 3  # "Refund John Mathew's order" is still ambiguous


@pytest.mark.parametrize("pattern", ["%", "_", "\\\\", "   "])
def test_customer_search_treats_wildcards_literally(db_session: Session, pattern: str) -> None:
    assert BusinessRepository(db_session).find_customers_by_name(pattern) == []


def test_medium_scenario_watch_is_one_reservation_from_reorder_point(db_session: Session) -> None:
    watch = db_session.get(InventoryItem, "SKU-WAT-003")
    assert watch is not None
    available = watch.on_hand - watch.reserved
    assert available == watch.reorder_point  # one more reservation tips it below
