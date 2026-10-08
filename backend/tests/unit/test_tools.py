"""Tool simulators: parameter models (strict, extra=forbid, money rules) and typed preconditions."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from app.domain.enums import DomainEvent, OrderStatus, PaymentStatus
from app.domain.state import SimState
from app.domain.tools.base import (
    EVENT_PAYLOAD_FIELDS,
    ParamErrorKind,
    ParamValidationError,
    PreconditionFailedError,
    ToolEffect,
)
from app.domain.tools.registry import SIMULATORS
from app.seed import novacart_data as data
from tests.factories import novacart_snapshot


def run(tool_id: str, params: dict[str, Any]) -> ToolEffect:
    return SIMULATORS[tool_id].simulate(params, SimState(novacart_snapshot()))


def precondition(tool_id: str, params: dict[str, Any]) -> str:
    with pytest.raises(PreconditionFailedError) as exc:
        run(tool_id, params)
    return exc.value.code


def param_error(tool_id: str, params: dict[str, Any]) -> ParamValidationError:
    with pytest.raises(ParamValidationError) as exc:
        run(tool_id, params)
    return exc.value


def changes(effect: ToolEffect) -> dict[tuple[str, str, str], tuple[Any, Any]]:
    return {(c.resource_type, c.resource_id, c.field): (c.before, c.after) for c in effect.changes}


# --- registry ---------------------------------------------------------------------------------


def test_registry_covers_exactly_the_seeded_tools() -> None:
    """TOOL-05 (code side): every catalog tool has a simulator and vice versa."""
    assert set(SIMULATORS) == {t["id"] for t in data.TOOLS}
    assert len(SIMULATORS) == 14


def test_every_seeded_reaction_maps_only_fields_its_event_emits() -> None:
    for rule in data.REACTIONS:
        fields = EVENT_PAYLOAD_FIELDS[rule.event_type]
        for value in rule.param_mapping.values():
            if isinstance(value, str) and value.startswith("$event."):
                assert value.removeprefix("$event.") in fields, (rule.id, value)


# --- parameter models -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "params",
    [
        {"order_id": "ORD-10482", "amount": "0"},  # REF-01
        {"order_id": "ORD-10482", "amount": "0.00"},
        {"order_id": "ORD-10482", "amount": "-100.00"},  # REF-02
        {"order_id": "ORD-10482", "amount": "0.005"},  # REF-10 sub-paisa
        {"order_id": "ORD-10482", "amount": "12.345"},
        {"order_id": "ORD-10482", "amount": "lots"},
    ],
)
@pytest.mark.parametrize("tool_id", ["issue_refund", "request_refund"])
def test_invalid_amounts_are_rejected(tool_id: str, params: dict[str, Any]) -> None:
    assert param_error(tool_id, params).kind is ParamErrorKind.INVALID_AMOUNT


@pytest.mark.parametrize(
    ("tool_id", "params"),
    [
        ("cancel_order", {"order_id": "ORD-10482", "force": True}),  # extra field
        ("cancel_order", {"order_id": 10482}),  # wrong type
        (
            "modify_order",
            {"order_id": "ORD-10495", "lines": [{"sku": "SKU-WAT-003", "quantity": "2"}]},
        ),
        ("modify_order", {"order_id": "ORD-10495", "lines": []}),
        (
            "send_customer_notification",
            {"customer_id": "CUST-1001", "template": "HACKED", "channel": "EMAIL"},
        ),
        ("issue_compensation", {"order_id": "ORD-10482", "amount": "100.00", "percentage": "20"}),
        ("issue_compensation", {"order_id": "ORD-10482"}),
    ],
)
def test_malformed_extra_or_wrong_type_params_are_invalid(
    tool_id: str, params: dict[str, Any]
) -> None:
    """TOOL-04"""
    assert param_error(tool_id, params).kind is ParamErrorKind.INVALID_PARAMETERS


def test_missing_required_params_are_listed() -> None:
    """TOOL-03 (domain side)"""
    err = param_error("modify_order", {})
    assert err.kind is ParamErrorKind.MISSING_PARAMETERS
    assert err.missing == ("lines", "order_id")


def test_amount_is_normalised_to_the_paisa() -> None:
    effect = run("issue_refund", {"order_id": "ORD-10482", "amount": "1E+3"})
    assert effect.money[0].amount == Decimal("1000.00")


# --- orders -----------------------------------------------------------------------------------


def test_cancel_unknown_order() -> None:
    """ORD-01"""
    assert precondition("cancel_order", {"order_id": "ORD-99999"}) == "ORDER_NOT_FOUND"


def test_cancel_already_cancelled_order() -> None:
    """ORD-02"""
    assert precondition("cancel_order", {"order_id": "ORD-10460"}) == "ORDER_ALREADY_CANCELLED"


@pytest.mark.parametrize("order_id", ["ORD-10477", "ORD-10501"])
def test_cancel_delivered_or_shipped_order(order_id: str) -> None:
    """ORD-04 (delivered), ORD-05 (shipped)"""
    assert precondition("cancel_order", {"order_id": order_id}) == "ORDER_NOT_CANCELLABLE"


def test_cancel_emits_refundable_amount_and_changes_only_status() -> None:
    effect = run("cancel_order", {"order_id": "ORD-10482"})
    assert changes(effect) == {
        ("order", "ORD-10482", "status"): (OrderStatus.CONFIRMED, OrderStatus.CANCELLED)
    }
    (event,) = effect.events
    assert event.type is DomainEvent.ORDER_CANCELLED
    assert event.payload["refundable_amount"] == "84500.00"
    assert effect.money == ()


def test_modify_order_preconditions() -> None:
    sku_line = [{"sku": "SKU-WAT-003", "quantity": 1}]
    assert precondition("modify_order", {"order_id": "ORD-10495", "lines": sku_line}) == "NO_CHANGE"
    other = [{"sku": "SKU-LAP-001", "quantity": 1}]
    assert (
        precondition("modify_order", {"order_id": "ORD-10495", "lines": other})
        == "SKU_NOT_IN_ORDER"
    )
    assert (
        precondition("modify_order", {"order_id": "ORD-10501", "lines": sku_line})
        == "ORDER_NOT_MODIFIABLE"
    )


def test_modify_order_reports_line_deltas_and_new_total() -> None:
    effect = run(
        "modify_order",
        {"order_id": "ORD-10495", "lines": [{"sku": "SKU-WAT-003", "quantity": 2}]},
    )
    assert changes(effect)[("order", "ORD-10495", "total_amount")] == (
        Decimal("9997.00"),
        Decimal("18996.00"),
    )
    payload = effect.events[0].payload
    assert payload["increased_lines"] == [{"sku": "SKU-WAT-003", "quantity": 1}]
    assert payload["total_increase"] == "8999.00"
    assert payload["total_decrease"] == "0.00"


def test_update_order_status_follows_the_fulfilment_sequence() -> None:
    assert (
        precondition("update_order_status", {"order_id": "ORD-10482", "status": "DELIVERED"})
        == "INVALID_STATUS_TRANSITION"
    )
    effect = run("update_order_status", {"order_id": "ORD-10482", "status": "SHIPPED"})
    diff = changes(effect)
    assert diff[("inventory_item", "SKU-LAP-001", "on_hand")] == (12, 11)
    assert diff[("order_item", "ORD-10482/SKU-LAP-001", "reserved_quantity")] == (1, 0)


# --- finance ----------------------------------------------------------------------------------


def test_refund_fully_refunded_payment() -> None:
    """ORD-03"""
    assert precondition("issue_refund", {"order_id": "ORD-10460"}) == "NOTHING_TO_REFUND"
    assert precondition("request_refund", {"order_id": "ORD-10460"}) == "NOTHING_TO_REFUND"


def test_refund_on_cod_order_has_nothing_to_refund() -> None:
    assert precondition("issue_refund", {"order_id": "ORD-10490"}) == "NOTHING_TO_REFUND"


@pytest.mark.parametrize("tool_id", ["issue_refund", "request_refund"])
def test_refund_above_remaining_refundable(tool_id: str) -> None:
    """REF-03: ORD-10520 has ₹10,000 left."""
    params = {"order_id": "ORD-10520", "amount": "10000.01"}
    assert precondition(tool_id, params) == "REFUND_EXCEEDS_REFUNDABLE"
    run(tool_id, {"order_id": "ORD-10520", "amount": "10000.00"})  # exactly the remainder: OK


def test_full_refund_marks_payment_refunded() -> None:
    """REF-07"""
    effect = run("issue_refund", {"order_id": "ORD-10520"})
    diff = changes(effect)
    assert diff[("payment", "PAY-90520", "refunded_amount")] == (
        Decimal("2500.00"),
        Decimal("12500.00"),
    )
    assert diff[("payment", "PAY-90520", "status")] == (
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
    )


def test_partial_refund_is_exact_to_the_paisa() -> None:
    """REF-08"""
    effect = run("issue_refund", {"order_id": "ORD-10482", "amount": "1234.56"})
    diff = changes(effect)
    assert diff[("payment", "PAY-90482", "refunded_amount")] == (
        Decimal("0.00"),
        Decimal("1234.56"),
    )
    assert diff[("payment", "PAY-90482", "status")][1] is PaymentStatus.PARTIALLY_REFUNDED
    assert Decimal("84500.00") - Decimal("1234.56") == Decimal("83265.44")
    assert effect.creations[0].values["amount"] == Decimal("1234.56")


def test_compensation_percentage_is_computed_by_the_backend() -> None:
    effect = run("issue_compensation", {"order_id": "ORD-10482", "percentage": "20"})
    assert [m.amount for m in effect.money] == [Decimal("16900.00")]
    assert effect.changes == ()  # the order stays active
    assert (
        param_error("issue_compensation", {"order_id": "ORD-10482", "percentage": "0"}).kind
        is ParamErrorKind.INVALID_AMOUNT
    )


def test_compensation_preconditions() -> None:
    assert (
        precondition("issue_compensation", {"order_id": "ORD-10460", "amount": "10.00"})
        == "ORDER_ALREADY_CANCELLED"
    )
    assert (
        precondition("issue_compensation", {"order_id": "ORD-10490", "amount": "10.00"})
        == "NO_PAYMENT_ON_ORDER"
    )
    assert (
        precondition("issue_compensation", {"order_id": "ORD-10510", "amount": "1998.01"})
        == "COMPENSATION_EXCEEDS_ORDER_TOTAL"
    )


def test_reverse_payment() -> None:
    effect = run("reverse_payment", {"payment_id": "PAY-90482"})
    assert changes(effect)[("payment", "PAY-90482", "status")][1] is PaymentStatus.REVERSED
    assert effect.money[0].amount == Decimal("84500.00")
    assert precondition("reverse_payment", {"payment_id": "PAY-0"}) == "PAYMENT_NOT_FOUND"
    assert precondition("reverse_payment", {"payment_id": "PAY-90460"}) == "NOTHING_TO_REFUND"


# --- inventory --------------------------------------------------------------------------------


def test_reserving_below_reorder_point_emits_restock_signal() -> None:
    state = SimState(novacart_snapshot())
    lines = [{"sku": "SKU-WAT-003", "quantity": 2}]
    state.apply(
        SIMULATORS["modify_order"]
        .simulate({"order_id": "ORD-10495", "lines": lines}, state)
        .changes
    )
    effect = SIMULATORS["reserve_inventory"].simulate(
        {"order_id": "ORD-10495", "lines": [{"sku": "SKU-WAT-003", "quantity": 1}]}, state
    )
    types = [e.type for e in effect.events]
    assert types == [DomainEvent.STOCK_RESERVED, DomainEvent.STOCK_BELOW_REORDER_POINT]
    assert effect.events[1].payload == {
        "sku": "SKU-WAT-003",
        "available": 7,
        "reorder_point": 8,
        "suggested_quantity": 9,
    }


def test_reserve_beyond_the_order_line_is_refused() -> None:
    params = {"order_id": "ORD-10495", "lines": [{"sku": "SKU-WAT-003", "quantity": 1}]}
    assert precondition("reserve_inventory", params) == "RESERVATION_EXCEEDS_LINE"


def test_reserve_more_than_available() -> None:
    params = {"order_id": "ORD-10482", "lines": [{"sku": "SKU-LAP-001", "quantity": 999}]}
    assert precondition("reserve_inventory", params) == "INSUFFICIENT_STOCK"


def test_release_without_holds() -> None:
    assert precondition("release_inventory", {"order_id": "ORD-10477"}) == "NOTHING_TO_RELEASE"


def test_release_all_holds_of_an_order() -> None:
    effect = run("release_inventory", {"order_id": "ORD-10482"})
    # 4 laptops held: ORD-10482 (1), ORD-10540 (1), ORD-10550 (2); releasing ORD-10482 frees one.
    assert changes(effect)[("inventory_item", "SKU-LAP-001", "reserved")] == (4, 3)


def test_restock_unknown_sku() -> None:
    assert (
        precondition("create_restock_request", {"sku": "SKU-X", "quantity": 1}) == "SKU_NOT_FOUND"
    )


# --- crm --------------------------------------------------------------------------------------


def test_customer_status_preconditions() -> None:
    params = {"customer_id": "CUST-1001", "status": "ACTIVE"}
    assert precondition("update_customer_status", params) == "STATUS_UNCHANGED"
    params = {"customer_id": "CUST-0", "status": "AT_RISK"}
    assert precondition("update_customer_status", params) == "CUSTOMER_NOT_FOUND"


def test_notification_creates_a_record_and_emits_nothing() -> None:
    effect = run(
        "send_customer_notification",
        {
            "customer_id": "CUST-1005",
            "order_id": "ORD-10501",
            "template": "ORDER_SHIPPED",
            "channel": "SMS",
        },
    )
    assert [c.resource_type for c in effect.creations] == ["notification"]
    assert effect.events == ()
