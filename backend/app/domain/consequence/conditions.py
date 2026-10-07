"""Named predicates that gate reaction rules. Every `ConditionKey` maps to code here; rules can
only reference these keys (DB CHECK + enum), so no condition is ever evaluated from a string."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from decimal import Decimal, InvalidOperation
from types import MappingProxyType
from typing import Any

from app.domain.enums import ConditionKey, CustomerTier
from app.domain.money import ZERO
from app.domain.state import SimState
from app.domain.tools.base import EmittedEvent

Condition = Callable[[EmittedEvent, Mapping[str, Any], SimState], bool]


class ConditionConfigError(ValueError):
    """A rule's condition_params are missing/invalid, or the event lacks a needed field."""


def _field(event: EmittedEvent, name: str) -> Any:
    if name not in event.payload:
        raise ConditionConfigError(f"{event.type} has no field {name!r}")
    return event.payload[name]


def _decimal(value: Any, what: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ConditionConfigError(f"{what} is not a decimal: {value!r}") from exc


def _always(_e: EmittedEvent, _p: Mapping[str, Any], _s: SimState) -> bool:
    return True


def _payment_captured(e: EmittedEvent, _p: Mapping[str, Any], s: SimState) -> bool:
    """The event's order still has captured money that could be refunded."""
    return s.refundable_amount(str(_field(e, "order_id"))) > ZERO


def _order_has_reserved_stock(e: EmittedEvent, _p: Mapping[str, Any], s: SimState) -> bool:
    return any(i.reserved_quantity > 0 for i in s.items_for_order(str(_field(e, "order_id"))))


def _customer_is_vip(e: EmittedEvent, _p: Mapping[str, Any], s: SimState) -> bool:
    customer = s.customer(str(_field(e, "customer_id")))
    return customer is not None and customer.tier is CustomerTier.VIP


def _amount_at_least(e: EmittedEvent, p: Mapping[str, Any], _s: SimState) -> bool:
    if "min_amount" not in p:
        raise ConditionConfigError("AMOUNT_AT_LEAST needs condition_params.min_amount")
    return _decimal(_field(e, "amount"), "amount") >= _decimal(p["min_amount"], "min_amount")


def _quantity_increased(e: EmittedEvent, _p: Mapping[str, Any], _s: SimState) -> bool:
    return bool(_field(e, "increased_lines"))


def _quantity_decreased(e: EmittedEvent, _p: Mapping[str, Any], _s: SimState) -> bool:
    return bool(_field(e, "decreased_lines"))


def _total_decreased(e: EmittedEvent, _p: Mapping[str, Any], s: SimState) -> bool:
    """The order got cheaper AND there is captured money to give back (COD orders: nothing)."""
    decrease = _decimal(_field(e, "total_decrease"), "total_decrease")
    return decrease > ZERO and s.refundable_amount(str(_field(e, "order_id"))) > ZERO


CONDITIONS: Mapping[ConditionKey, Condition] = MappingProxyType(
    {
        ConditionKey.ALWAYS: _always,
        ConditionKey.PAYMENT_CAPTURED: _payment_captured,
        ConditionKey.ORDER_HAS_RESERVED_STOCK: _order_has_reserved_stock,
        ConditionKey.CUSTOMER_IS_VIP: _customer_is_vip,
        ConditionKey.AMOUNT_AT_LEAST: _amount_at_least,
        ConditionKey.QUANTITY_INCREASED: _quantity_increased,
        ConditionKey.QUANTITY_DECREASED: _quantity_decreased,
        ConditionKey.TOTAL_DECREASED: _total_decreased,
    }
)
