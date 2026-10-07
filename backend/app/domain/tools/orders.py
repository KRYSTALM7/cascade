"""Order agent tools: view, cancel, modify, update status."""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import Field

from app.domain.enums import DomainEvent, OrderStatus
from app.domain.money import ZERO
from app.domain.state import FieldChange, OrderRow, SimState
from app.domain.tools.base import (
    EntityId,
    PreconditionFailedError,
    ToolEffect,
    ToolParams,
    ToolSimulator,
    emit,
)

OPEN_STATUSES = frozenset({OrderStatus.PENDING, OrderStatus.CONFIRMED})
Reason = Annotated[str, Field(max_length=200)]
Quantity = Annotated[int, Field(ge=1, le=1000)]


def require_order(state: SimState, order_id: str) -> OrderRow:
    order = state.order(order_id)
    if order is None:
        raise PreconditionFailedError(
            "ORDER_NOT_FOUND", f"Order {order_id} does not exist.", order_id=order_id
        )
    return order


# --- view_order -----------------------------------------------------------------------------------


class ViewOrderParams(ToolParams):
    order_id: EntityId


def _view_order(params: ViewOrderParams, state: SimState) -> ToolEffect:
    order = require_order(state, params.order_id)
    return ToolEffect(summary=f"Read order {order.id} ({order.status}).")


# --- cancel_order ---------------------------------------------------------------------------------


class CancelOrderParams(ToolParams):
    order_id: EntityId
    reason: Reason = ""


def _cancel_order(params: CancelOrderParams, state: SimState) -> ToolEffect:
    order = require_order(state, params.order_id)
    if order.status is OrderStatus.CANCELLED:
        raise PreconditionFailedError(
            "ORDER_ALREADY_CANCELLED", f"Order {order.id} is already CANCELLED.", order_id=order.id
        )
    if order.status not in OPEN_STATUSES:
        raise PreconditionFailedError(
            "ORDER_NOT_CANCELLABLE",
            f"Order {order.id} is {order.status} and can no longer be cancelled.",
            order_id=order.id,
            status=order.status,
        )
    return ToolEffect(
        changes=[FieldChange("order", order.id, "status", order.status, OrderStatus.CANCELLED)],
        events=[
            emit(
                DomainEvent.ORDER_CANCELLED,
                order_id=order.id,
                customer_id=order.customer_id,
                previous_status=order.status,
                order_total=order.total_amount,
                refundable_amount=state.refundable_amount(order.id),
            )
        ],
        summary=f"Order {order.id}: {order.status} → CANCELLED.",
    )


# --- modify_order ---------------------------------------------------------------------------------


class LineQuantity(ToolParams):
    sku: EntityId
    quantity: Quantity


class ModifyOrderParams(ToolParams):
    order_id: EntityId
    lines: Annotated[list[LineQuantity], Field(min_length=1, max_length=20)]


def _modify_order(params: ModifyOrderParams, state: SimState) -> ToolEffect:
    order = require_order(state, params.order_id)
    if order.status is OrderStatus.CANCELLED:
        raise PreconditionFailedError(
            "ORDER_ALREADY_CANCELLED", f"Order {order.id} is already CANCELLED.", order_id=order.id
        )
    if order.status not in OPEN_STATUSES:
        raise PreconditionFailedError(
            "ORDER_NOT_MODIFIABLE",
            f"Order {order.id} is {order.status} and can no longer be modified.",
            order_id=order.id,
            status=order.status,
        )
    skus = [line.sku for line in params.lines]
    if len(set(skus)) != len(skus):
        raise PreconditionFailedError(
            "INVALID_PARAMETERS", "Each SKU may appear only once.", skus=skus
        )
    items = {i.sku: i for i in state.items_for_order(order.id)}
    changes: list[FieldChange] = []
    increased: list[dict[str, object]] = []
    decreased: list[dict[str, object]] = []
    new_total = order.total_amount
    for line in sorted(params.lines, key=lambda line: line.sku):
        item = items.get(line.sku)
        if item is None:
            raise PreconditionFailedError(
                "SKU_NOT_IN_ORDER",
                f"Order {order.id} has no line for {line.sku}.",
                order_id=order.id,
                sku=line.sku,
            )
        delta = line.quantity - item.quantity
        if delta == 0:
            continue
        changes.append(
            FieldChange("order_item", item.key, "quantity", item.quantity, line.quantity)
        )
        new_total += item.unit_price * delta
        (increased if delta > 0 else decreased).append({"sku": item.sku, "quantity": abs(delta)})
    if not changes:
        raise PreconditionFailedError(
            "NO_CHANGE", f"Order {order.id} already has those quantities.", order_id=order.id
        )
    changes.append(FieldChange("order", order.id, "total_amount", order.total_amount, new_total))
    diff: Decimal = new_total - order.total_amount
    return ToolEffect(
        changes=changes,
        events=[
            emit(
                DomainEvent.ORDER_MODIFIED,
                order_id=order.id,
                customer_id=order.customer_id,
                increased_lines=increased,
                decreased_lines=decreased,
                old_total=order.total_amount,
                new_total=new_total,
                total_increase=max(diff, ZERO),
                total_decrease=max(-diff, ZERO),
            )
        ],
        summary=f"Order {order.id}: total {order.total_amount} → {new_total}.",
    )


# --- update_order_status --------------------------------------------------------------------------

_NEXT_STATUS = {
    OrderStatus.PENDING: OrderStatus.CONFIRMED,
    OrderStatus.CONFIRMED: OrderStatus.SHIPPED,
    OrderStatus.SHIPPED: OrderStatus.DELIVERED,
}


class UpdateOrderStatusParams(ToolParams):
    order_id: EntityId
    status: Literal["CONFIRMED", "SHIPPED", "DELIVERED"]


def _update_order_status(params: UpdateOrderStatusParams, state: SimState) -> ToolEffect:
    order = require_order(state, params.order_id)
    target = OrderStatus(params.status)
    if _NEXT_STATUS.get(order.status) is not target:
        raise PreconditionFailedError(
            "INVALID_STATUS_TRANSITION",
            f"Order {order.id} cannot move from {order.status} to {target}.",
            order_id=order.id,
            status=order.status,
            target=target,
        )
    changes = [FieldChange("order", order.id, "status", order.status, target)]
    if target is OrderStatus.SHIPPED:
        # Dispatch consumes the held units: they leave both on-hand and reserved stock.
        for item in state.items_for_order(order.id):
            if item.reserved_quantity == 0:
                continue
            inv = state.inventory(item.sku)
            assert inv is not None  # FK guarantees the SKU exists
            qty = item.reserved_quantity
            changes += [
                FieldChange("inventory_item", inv.sku, "on_hand", inv.on_hand, inv.on_hand - qty),
                FieldChange(
                    "inventory_item", inv.sku, "reserved", inv.reserved, inv.reserved - qty
                ),
                FieldChange("order_item", item.key, "reserved_quantity", qty, 0),
            ]
    return ToolEffect(
        changes=changes,
        events=[
            emit(
                DomainEvent.ORDER_STATUS_CHANGED,
                order_id=order.id,
                customer_id=order.customer_id,
                previous_status=order.status,
                new_status=target,
            )
        ],
        summary=f"Order {order.id}: {order.status} → {target}.",
    )


SIMULATORS: list[ToolSimulator[Any]] = [
    ToolSimulator("view_order", ViewOrderParams, _view_order),
    ToolSimulator("cancel_order", CancelOrderParams, _cancel_order),
    ToolSimulator("modify_order", ModifyOrderParams, _modify_order),
    ToolSimulator("update_order_status", UpdateOrderStatusParams, _update_order_status),
]
