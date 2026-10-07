"""Inventory agent tools: reserve, release, restock."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from app.domain.enums import DomainEvent
from app.domain.state import FieldChange, InventoryRow, RecordCreation, SimState
from app.domain.tools.base import (
    EmittedEvent,
    EntityId,
    PreconditionFailedError,
    ToolEffect,
    ToolParams,
    ToolSimulator,
    emit,
)
from app.domain.tools.orders import LineQuantity, Quantity, require_order

Lines = Annotated[list[LineQuantity], Field(min_length=1, max_length=20)]


def require_sku(state: SimState, sku: str) -> InventoryRow:
    inv = state.inventory(sku)
    if inv is None:
        raise PreconditionFailedError("SKU_NOT_FOUND", f"SKU {sku} does not exist.", sku=sku)
    return inv


def _fmt_lines(lines: list[dict[str, object]]) -> str:
    return ", ".join(f"{line['quantity']} x {line['sku']}" for line in lines)


def suggested_restock(inv: InventoryRow, available_after: int) -> int:
    """Refill to twice the reorder point (deterministic, documented)."""
    return max(2 * inv.reorder_point - available_after, 1)


# --- reserve_inventory ----------------------------------------------------------------------------


class ReserveInventoryParams(ToolParams):
    order_id: EntityId
    lines: Lines


def _reserve_inventory(params: ReserveInventoryParams, state: SimState) -> ToolEffect:
    order = require_order(state, params.order_id)
    items = {i.sku: i for i in state.items_for_order(order.id)}
    changes: list[FieldChange] = []
    events: list[EmittedEvent] = []
    reserved_lines: list[dict[str, object]] = []
    for line in sorted(params.lines, key=lambda line: line.sku):
        item = items.get(line.sku)
        if item is None:
            raise PreconditionFailedError(
                "SKU_NOT_IN_ORDER",
                f"Order {order.id} has no line for {line.sku}.",
                order_id=order.id,
                sku=line.sku,
            )
        inv = require_sku(state, line.sku)
        if line.quantity > inv.available:
            raise PreconditionFailedError(
                "INSUFFICIENT_STOCK",
                f"Only {inv.available} x {inv.sku} available; {line.quantity} requested.",
                sku=inv.sku,
                available=inv.available,
                requested=line.quantity,
            )
        if item.reserved_quantity + line.quantity > item.quantity:
            raise PreconditionFailedError(
                "RESERVATION_EXCEEDS_LINE",
                f"Cannot hold more {item.sku} than order {order.id} contains.",
                order_id=order.id,
                sku=item.sku,
            )
        after_reserved = inv.reserved + line.quantity
        changes += [
            FieldChange("inventory_item", inv.sku, "reserved", inv.reserved, after_reserved),
            FieldChange(
                "order_item",
                item.key,
                "reserved_quantity",
                item.reserved_quantity,
                item.reserved_quantity + line.quantity,
            ),
        ]
        reserved_lines.append({"sku": inv.sku, "quantity": line.quantity})
        available_after = inv.on_hand - after_reserved
        if inv.available >= inv.reorder_point > available_after:
            events.append(
                emit(
                    DomainEvent.STOCK_BELOW_REORDER_POINT,
                    sku=inv.sku,
                    available=available_after,
                    reorder_point=inv.reorder_point,
                    suggested_quantity=suggested_restock(inv, available_after),
                )
            )
    events.insert(0, emit(DomainEvent.STOCK_RESERVED, order_id=order.id, lines=reserved_lines))
    return ToolEffect(
        changes=changes,
        events=events,
        summary=f"Hold {_fmt_lines(reserved_lines)}.",
    )


# --- release_inventory ----------------------------------------------------------------------------


class ReleaseInventoryParams(ToolParams):
    order_id: EntityId
    lines: Lines | None = None  # None = release everything the order holds


def _release_inventory(params: ReleaseInventoryParams, state: SimState) -> ToolEffect:
    order = require_order(state, params.order_id)
    items = {i.sku: i for i in state.items_for_order(order.id)}
    if params.lines is None:
        wanted = {sku: i.reserved_quantity for sku, i in items.items() if i.reserved_quantity}
    else:
        wanted = {line.sku: line.quantity for line in params.lines}
    changes: list[FieldChange] = []
    released: list[dict[str, object]] = []
    for sku in sorted(wanted):
        qty = wanted[sku]
        item = items.get(sku)
        if item is None:
            raise PreconditionFailedError(
                "SKU_NOT_IN_ORDER",
                f"Order {order.id} has no line for {sku}.",
                order_id=order.id,
                sku=sku,
            )
        if qty > item.reserved_quantity:
            raise PreconditionFailedError(
                "RELEASE_EXCEEDS_RESERVED",
                f"Order {order.id} holds only {item.reserved_quantity} x {sku}.",
                order_id=order.id,
                sku=sku,
            )
        inv = require_sku(state, sku)
        changes += [
            FieldChange("inventory_item", sku, "reserved", inv.reserved, inv.reserved - qty),
            FieldChange(
                "order_item",
                item.key,
                "reserved_quantity",
                item.reserved_quantity,
                item.reserved_quantity - qty,
            ),
        ]
        released.append({"sku": sku, "quantity": qty})
    if not released:
        raise PreconditionFailedError(
            "NOTHING_TO_RELEASE", f"Order {order.id} holds no stock.", order_id=order.id
        )
    return ToolEffect(
        changes=changes,
        events=[emit(DomainEvent.STOCK_RELEASED, order_id=order.id, lines=released)],
        summary=f"Return {_fmt_lines(released)} to stock.",
    )


# --- create_restock_request -----------------------------------------------------------------------


class CreateRestockRequestParams(ToolParams):
    sku: EntityId
    quantity: Quantity


def _create_restock_request(params: CreateRestockRequestParams, state: SimState) -> ToolEffect:
    inv = require_sku(state, params.sku)
    return ToolEffect(
        creations=[
            RecordCreation("restock_request", {"sku": inv.sku, "quantity": params.quantity})
        ],
        summary=f"Request {params.quantity} x {inv.sku} from procurement.",
    )


SIMULATORS: list[ToolSimulator[Any]] = [
    ToolSimulator("reserve_inventory", ReserveInventoryParams, _reserve_inventory),
    ToolSimulator("release_inventory", ReleaseInventoryParams, _release_inventory),
    ToolSimulator("create_restock_request", CreateRestockRequestParams, _create_restock_request),
]
