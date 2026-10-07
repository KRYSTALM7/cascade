"""SimState: copy-on-write overlay, read tracking, fingerprint."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from app.domain.enums import OrderStatus
from app.domain.state import FieldChange, ReadVersion, SimState, StateConflictError
from tests.factories import novacart_snapshot


def test_overlay_changes_are_visible_to_later_reads_but_snapshot_is_untouched() -> None:
    snapshot = novacart_snapshot()
    state = SimState(snapshot)
    state.apply(
        [FieldChange("order", "ORD-10482", "status", OrderStatus.CONFIRMED, OrderStatus.CANCELLED)]
    )
    order = state.order("ORD-10482")
    assert order is not None and order.status is OrderStatus.CANCELLED
    assert snapshot.orders["ORD-10482"].status is OrderStatus.CONFIRMED


def test_apply_rejects_a_change_whose_before_value_is_stale() -> None:
    state = SimState(novacart_snapshot())
    with pytest.raises(StateConflictError):
        state.apply(
            [
                FieldChange(
                    "order", "ORD-10482", "status", OrderStatus.PENDING, OrderStatus.CANCELLED
                )
            ]
        )


def test_reads_record_snapshot_versions_including_missing_rows() -> None:
    state = SimState(novacart_snapshot())
    state.order("ORD-10482")
    state.payments_for_order("ORD-10482")
    state.order("ORD-NOPE")
    assert state.read_versions() == [
        ReadVersion("order", "ORD-10482", 1),
        ReadVersion("order", "ORD-NOPE", 0),
        ReadVersion("payment", "PAY-90482", 1),
    ]


def test_fingerprint_is_order_independent_and_version_sensitive() -> None:
    snapshot = novacart_snapshot()
    a, b = SimState(snapshot), SimState(snapshot)
    a.order("ORD-10482")
    a.customer("CUST-1001")
    b.customer("CUST-1001")
    b.order("ORD-10482")
    assert a.fingerprint() == b.fingerprint()

    bumped = replace(
        snapshot,
        orders={**snapshot.orders, "ORD-10482": replace(snapshot.orders["ORD-10482"], version=2)},
    )
    c = SimState(bumped)
    c.order("ORD-10482")
    c.customer("CUST-1001")
    assert c.fingerprint() != a.fingerprint()


def test_refundable_amount_ignores_refunded_and_reversed_payments() -> None:
    state = SimState(novacart_snapshot())
    assert state.refundable_amount("ORD-10482") == Decimal("84500.00")
    assert state.refundable_amount("ORD-10520") == Decimal("10000.00")
    assert state.refundable_amount("ORD-10460") == Decimal("0.00")
    assert state.refundable_amount("ORD-10490") == Decimal("0.00")  # COD, no payment
