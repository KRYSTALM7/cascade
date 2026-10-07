"""World state for simulation.

`WorldSnapshot` is an immutable picture of NovaCart business rows. `SimState` is a copy-on-write
overlay on top of it: simulators read through it (every read records the row's version, which
feeds the staleness fingerprint) and the engine applies each tool's changes to it, so later nodes
in a cascade see earlier effects. The snapshot and the database are never touched.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Literal

from app.domain.enums import (
    CustomerStatus,
    CustomerTier,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
)
from app.domain.money import ZERO

ResourceType = Literal["customer", "order", "order_item", "payment", "inventory_item"]
CreatedType = Literal["refund", "restock_request", "customer_case", "notification"]

# Resource types whose rows carry an optimistic-lock `version` (and can be row-locked).
VERSIONED_TYPES: tuple[ResourceType, ...] = ("customer", "order", "payment", "inventory_item")


class StateConflictError(RuntimeError):
    """A change's `before` value does not match the overlay (a simulator bug, never user error)."""


# --- Rows -----------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CustomerRow:
    id: str
    name: str
    email: str
    phone: str
    tier: CustomerTier
    status: CustomerStatus
    version: int = 1


@dataclass(frozen=True, slots=True)
class OrderRow:
    id: str
    customer_id: str
    status: OrderStatus
    total_amount: Decimal
    currency: str = "INR"
    version: int = 1


@dataclass(frozen=True, slots=True)
class OrderItemRow:
    order_id: str
    sku: str
    quantity: int
    unit_price: Decimal
    reserved_quantity: int

    @property
    def key(self) -> str:
        return item_key(self.order_id, self.sku)


@dataclass(frozen=True, slots=True)
class PaymentRow:
    id: str
    order_id: str
    amount: Decimal
    refunded_amount: Decimal
    method: PaymentMethod
    status: PaymentStatus
    version: int = 1

    @property
    def refundable(self) -> Decimal:
        if self.status in (PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED):
            return self.amount - self.refunded_amount
        return ZERO


@dataclass(frozen=True, slots=True)
class InventoryRow:
    sku: str
    name: str
    on_hand: int
    reserved: int
    reorder_point: int
    unit_price: Decimal
    version: int = 1

    @property
    def available(self) -> int:
        return self.on_hand - self.reserved


Row = CustomerRow | OrderRow | OrderItemRow | PaymentRow | InventoryRow


def item_key(order_id: str, sku: str) -> str:
    return f"{order_id}/{sku}"


@dataclass(frozen=True, slots=True)
class WorldSnapshot:
    customers: Mapping[str, CustomerRow]
    orders: Mapping[str, OrderRow]
    order_items: Mapping[str, OrderItemRow]  # keyed by item_key(order_id, sku)
    payments: Mapping[str, PaymentRow]
    inventory: Mapping[str, InventoryRow]

    @classmethod
    def build(
        cls,
        *,
        customers: Iterable[CustomerRow] = (),
        orders: Iterable[OrderRow] = (),
        order_items: Iterable[OrderItemRow] = (),
        payments: Iterable[PaymentRow] = (),
        inventory: Iterable[InventoryRow] = (),
    ) -> WorldSnapshot:
        return cls(
            customers=MappingProxyType({c.id: c for c in customers}),
            orders=MappingProxyType({o.id: o for o in orders}),
            order_items=MappingProxyType({i.key: i for i in order_items}),
            payments=MappingProxyType({p.id: p for p in payments}),
            inventory=MappingProxyType({i.sku: i for i in inventory}),
        )

    def table(self, resource_type: ResourceType) -> Mapping[str, Row]:
        tables: dict[ResourceType, Mapping[str, Any]] = {
            "customer": self.customers,
            "order": self.orders,
            "order_item": self.order_items,
            "payment": self.payments,
            "inventory_item": self.inventory,
        }
        return tables[resource_type]


# --- Changes --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FieldChange:
    resource_type: ResourceType
    resource_id: str
    field: str
    before: Any
    after: Any


@dataclass(frozen=True, slots=True)
class RecordCreation:
    resource_type: CreatedType
    values: Mapping[str, Any]


@dataclass(frozen=True, slots=True, order=True)
class ReadVersion:
    resource_type: str
    resource_id: str
    version: int  # 0 = the row did not exist when read


def to_jsonable(value: Any) -> Any:
    """Canonical JSON-safe form: Decimal -> str, StrEnum -> value, containers recursively."""
    if isinstance(value, StrEnum):
        return value.value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Mapping):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [to_jsonable(v) for v in value]
    return value


# --- Overlay --------------------------------------------------------------------------------------


@dataclass
class SimState:
    snapshot: WorldSnapshot
    _overlay: dict[tuple[ResourceType, str], Row] = field(default_factory=dict)
    _reads: dict[tuple[str, str], int] = field(default_factory=dict)

    # -- reads (all recorded) --

    def _get(self, resource_type: ResourceType, key: str) -> Row | None:
        row = self._overlay.get((resource_type, key))
        base = self.snapshot.table(resource_type).get(key)
        if resource_type in VERSIONED_TYPES:
            version = getattr(base, "version", 0) if base is not None else 0
            self._reads.setdefault((resource_type, key), version)
        return row if row is not None else base

    def customer(self, customer_id: str) -> CustomerRow | None:
        row = self._get("customer", customer_id)
        return row if isinstance(row, CustomerRow) else None

    def order(self, order_id: str) -> OrderRow | None:
        row = self._get("order", order_id)
        return row if isinstance(row, OrderRow) else None

    def payment(self, payment_id: str) -> PaymentRow | None:
        row = self._get("payment", payment_id)
        return row if isinstance(row, PaymentRow) else None

    def inventory(self, sku: str) -> InventoryRow | None:
        row = self._get("inventory_item", sku)
        return row if isinstance(row, InventoryRow) else None

    def items_for_order(self, order_id: str) -> list[OrderItemRow]:
        """Lines of an order (sorted by sku). Order lines are versioned through their order."""
        self.order(order_id)
        keys = sorted(k for k, i in self.snapshot.order_items.items() if i.order_id == order_id)
        rows = [self._get("order_item", k) for k in keys]
        return [r for r in rows if isinstance(r, OrderItemRow)]

    def payments_for_order(self, order_id: str) -> list[PaymentRow]:
        ids = sorted(p.id for p in self.snapshot.payments.values() if p.order_id == order_id)
        return [p for p in (self.payment(i) for i in ids) if p is not None]

    def refundable_payment(self, order_id: str) -> PaymentRow | None:
        """First payment (by id) of the order that still has money to refund."""
        for payment in self.payments_for_order(order_id):
            if payment.refundable > ZERO:
                return payment
        return None

    def refundable_amount(self, order_id: str) -> Decimal:
        return sum((p.refundable for p in self.payments_for_order(order_id)), ZERO)

    # -- writes (overlay only) --

    def apply(self, changes: Sequence[FieldChange]) -> None:
        for change in changes:
            key = (change.resource_type, change.resource_id)
            current = self._overlay.get(key) or self.snapshot.table(change.resource_type).get(
                change.resource_id
            )
            if current is None:
                raise StateConflictError(f"no {change.resource_type} {change.resource_id!r}")
            if getattr(current, change.field) != change.before:
                raise StateConflictError(
                    f"{change.resource_type} {change.resource_id}.{change.field}: expected "
                    f"{change.before!r}, found {getattr(current, change.field)!r}"
                )
            self._overlay[key] = replace(current, **{change.field: change.after})

    # -- staleness --

    def read_versions(self) -> list[ReadVersion]:
        return sorted(ReadVersion(t, i, v) for (t, i), v in self._reads.items())

    def fingerprint(self) -> str:
        return fingerprint_of(self.read_versions())


def fingerprint_of(reads: Iterable[ReadVersion]) -> str:
    lines = "\n".join(f"{r.resource_type}|{r.resource_id}|{r.version}" for r in sorted(reads))
    return hashlib.sha256(lines.encode()).hexdigest()
