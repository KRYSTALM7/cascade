"""Apply a simulated node's changes to real rows. The simulator computed them; this module only
writes them, checking each `before` value so nothing is ever applied on top of unexpected state."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import Enum, Numeric, select
from sqlalchemy.orm import Session

from app.domain.consequence.report import ChangeOut, CreationOut, NodeOut
from app.domain.enums import NotificationChannel, RefundKind
from app.models import (
    Base,
    Customer,
    CustomerCase,
    InventoryItem,
    Notification,
    Order,
    OrderItem,
    Payment,
    Refund,
    RestockRequest,
)

_ROWS: dict[str, type[Base]] = {
    "customer": Customer,
    "order": Order,
    "payment": Payment,
    "inventory_item": InventoryItem,
}


class ApplyConflictError(RuntimeError):
    """The row is not in the state the simulation saw (should be impossible under lock)."""


def _row(session: Session, change: ChangeOut) -> Base:
    if change.resource_type == "order_item":
        order_id, sku = change.resource_id.split("/", 1)
        row: Base | None = session.scalars(
            select(OrderItem).where(OrderItem.order_id == order_id, OrderItem.sku == sku)
        ).one_or_none()
    else:
        row = session.get(_ROWS[change.resource_type], change.resource_id)
    if row is None:
        raise ApplyConflictError(f"{change.resource_type} {change.resource_id} is missing")
    return row


def _typed(model: type[Base], field: str, value: Any) -> Any:
    column = model.__table__.c[field]
    if value is None:
        return None
    if isinstance(column.type, Numeric):
        return Decimal(str(value))
    if isinstance(column.type, Enum) and column.type.enum_class is not None:
        return column.type.enum_class(value)
    return value


def apply_change(session: Session, change: ChangeOut) -> None:
    row = _row(session, change)
    model = type(row)
    before = _typed(model, change.field, change.before)
    current = getattr(row, change.field)
    if current != before:
        raise ApplyConflictError(
            f"{change.resource_type} {change.resource_id}.{change.field} is {current!r}, "
            f"preview expected {before!r}"
        )
    setattr(row, change.field, _typed(model, change.field, change.after))


def create_record(session: Session, creation: CreationOut, action_id: uuid.UUID) -> Base:
    v = creation.values
    record: Base
    if creation.resource_type == "refund":
        record = Refund(
            payment_id=v["payment_id"],
            kind=RefundKind(str(v["kind"])),
            amount=Decimal(str(v["amount"])),
            reason=str(v.get("reason") or ""),
            action_id=action_id,
        )
    elif creation.resource_type == "restock_request":
        record = RestockRequest(sku=v["sku"], quantity=v["quantity"], action_id=action_id)
    elif creation.resource_type == "customer_case":
        record = CustomerCase(
            customer_id=v["customer_id"],
            order_id=v.get("order_id"),
            reason=str(v["reason"]),
            action_id=action_id,
        )
    elif creation.resource_type == "notification":
        record = Notification(
            customer_id=v["customer_id"],
            channel=NotificationChannel(str(v["channel"])),
            template=str(v["template"]),
            action_id=action_id,
        )
    else:  # pragma: no cover - the CreatedType literal is closed
        raise ValueError(f"cannot create {creation.resource_type}")
    session.add(record)
    return record


def apply_node(session: Session, node: NodeOut, action_id: uuid.UUID) -> list[dict[str, str]]:
    for change in node.changes:
        apply_change(session, change)
    created = [create_record(session, c, action_id) for c in node.creations]
    session.flush()  # surface CHECK/FK violations inside this step's savepoint
    return [
        {"resource_type": c.resource_type, "id": str(getattr(r, "id", ""))}
        for c, r in zip(node.creations, created, strict=True)
    ]
