"""The database itself refuses invalid states (defence in depth below the engines)."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.models import AgentPermission, InventoryItem, Order, Payment

pytestmark = pytest.mark.db


def _violates(db: Session, sql: str) -> None:
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(text(sql))


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE orders SET total_amount = -1 WHERE id = 'ORD-10482'",
        "UPDATE orders SET status = 'TELEPORTED' WHERE id = 'ORD-10482'",
        "UPDATE payments SET refunded_amount = amount + 0.01 WHERE id = 'PAY-90482'",
        "UPDATE payments SET refunded_amount = -0.01 WHERE id = 'PAY-90482'",
        "UPDATE inventory_items SET reserved = on_hand + 1 WHERE sku = 'SKU-LAP-001'",
        "UPDATE inventory_items SET on_hand = -1, reserved = 0 WHERE sku = 'SKU-LAP-001'",
        "UPDATE order_items SET quantity = 0 WHERE order_id = 'ORD-10482'",
        "UPDATE agent_reactions SET event_type = 'MADE_UP' WHERE id = 'finance.refund_on_cancel'",
        "UPDATE agent_reactions SET condition_key = 'eval(x)' WHERE agent_id = 'finance'",
        "UPDATE tools SET reversibility = 'MAYBE' WHERE id = 'cancel_order'",
        "UPDATE users SET approval_limit = -5 WHERE id = 'approver-asha'",
        "INSERT INTO order_items (id, order_id, sku, quantity, unit_price, reserved_quantity) "
        "VALUES (gen_random_uuid(), 'ORD-10482', 'SKU-NOPE', 1, 1, 0)",
    ],
    ids=lambda s: s[:60],
)
def test_invalid_states_are_rejected_by_the_database(db_session: Session, sql: str) -> None:
    _violates(db_session, sql)


def test_duplicate_permission_is_rejected(db_session: Session) -> None:
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.add(AgentPermission(agent_id="customer-support", tool_id="cancel_order"))
        db_session.flush()


def test_invalid_enum_is_rejected_before_reaching_the_database(db_session: Session) -> None:
    order = db_session.get(Order, "ORD-10482")
    assert order is not None
    order.status = "TELEPORTED"  # type: ignore[assignment]
    with pytest.raises(StatementError):
        db_session.flush()
    db_session.rollback()


def test_money_round_trips_exactly_as_decimal(db_session: Session) -> None:
    db_session.execute(
        update(Payment).where(Payment.id == "PAY-90520").values(refunded_amount=Decimal("2500.10"))
    )
    db_session.expire_all()
    payment = db_session.get(Payment, "PAY-90520")
    assert payment is not None
    assert isinstance(payment.refunded_amount, Decimal)
    assert payment.refunded_amount == Decimal("2500.10")


def test_version_increments_on_every_update(db_session: Session) -> None:
    item = db_session.get(InventoryItem, "SKU-WAT-003")
    assert item is not None and item.version == 1
    item.reserved += 1
    db_session.flush()
    assert item.version == 2


def test_concurrent_write_raises_stale_data_instead_of_overwriting(db_session: Session) -> None:
    """Simulates another writer committing between our read and our write."""
    order = db_session.get(Order, "ORD-10482")
    assert order is not None
    db_session.execute(
        text("UPDATE orders SET status = 'CANCELLED', version = version + 1 WHERE id = 'ORD-10482'")
    )
    order.status = "SHIPPED"  # type: ignore[assignment]
    with pytest.raises(StaleDataError):
        db_session.flush()
    db_session.rollback()


def test_audit_log_ids_are_generated_by_the_database(db_session: Session) -> None:
    with pytest.raises(Exception), db_session.begin_nested():  # noqa: B017 - GENERATED ALWAYS
        db_session.execute(
            text(
                "INSERT INTO audit_logs (id, event_type, actor_type, payload) "
                "VALUES (1, 'X', 'SYSTEM', '{}')"
            )
        )
