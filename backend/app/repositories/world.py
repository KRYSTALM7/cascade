"""Load the pure domain inputs (WorldSnapshot + Catalog) from the database, and row-lock the
resources a simulation read (execution path). Read-only apart from the locks."""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.catalog import AgentDef, Catalog, PermissionDef, ReactionDef, ToolDef
from app.domain.state import (
    CustomerRow,
    InventoryRow,
    OrderItemRow,
    OrderRow,
    PaymentRow,
    ReadVersion,
    WorldSnapshot,
)
from app.models import (
    Agent,
    AgentPermission,
    AgentReaction,
    Customer,
    InventoryItem,
    Order,
    OrderItem,
    Payment,
    Tool,
)

# The NovaCart demo world is small, so the whole business state is loaded; the fingerprint only
# covers rows the simulation actually READ, so unrelated rows never cause false staleness.


def load_snapshot(session: Session) -> WorldSnapshot:
    return WorldSnapshot.build(
        customers=(
            CustomerRow(c.id, c.name, c.email, c.phone, c.tier, c.status, c.version)
            for c in session.scalars(select(Customer).order_by(Customer.id))
        ),
        orders=(
            OrderRow(o.id, o.customer_id, o.status, o.total_amount, o.currency, o.version)
            for o in session.scalars(select(Order).order_by(Order.id))
        ),
        order_items=(
            OrderItemRow(i.order_id, i.sku, i.quantity, i.unit_price, i.reserved_quantity)
            for i in session.scalars(select(OrderItem).order_by(OrderItem.order_id, OrderItem.sku))
        ),
        payments=(
            PaymentRow(p.id, p.order_id, p.amount, p.refunded_amount, p.method, p.status, p.version)
            for p in session.scalars(select(Payment).order_by(Payment.id))
        ),
        inventory=(
            InventoryRow(
                i.sku, i.name, i.on_hand, i.reserved, i.reorder_point, i.unit_price, i.version
            )
            for i in session.scalars(select(InventoryItem).order_by(InventoryItem.sku))
        ),
    )


def load_catalog(session: Session) -> Catalog:
    return Catalog.build(
        agents=(AgentDef(a.id, a.name, a.enabled) for a in session.scalars(select(Agent))),
        tools=(
            ToolDef(
                id=t.id,
                owner_agent_id=t.owner_agent_id,
                reversibility=t.reversibility,
                customer_impact=t.customer_impact,
                data_sensitivity=t.data_sensitivity,
                enabled=t.enabled,
                read_only=t.read_only,
                name=t.name,
            )
            for t in session.scalars(select(Tool))
        ),
        permissions=(
            PermissionDef(p.agent_id, p.tool_id, p.expires_at)
            for p in session.scalars(select(AgentPermission))
        ),
        reactions=(
            ReactionDef(
                id=r.id,
                agent_id=r.agent_id,
                event_type=r.event_type,
                tool_id=r.tool_id,
                param_mapping=dict(r.param_mapping),
                condition_key=r.condition_key,
                condition_params=dict(r.condition_params),
                required=r.required,
                priority=r.priority,
                enabled=r.enabled,
                version=r.version,
                description=r.description,
            )
            for r in session.scalars(select(AgentReaction))
        ),
    )


_LOCKABLE = {
    "customer": (Customer, Customer.id),
    "order": (Order, Order.id),
    "payment": (Payment, Payment.id),
    "inventory_item": (InventoryItem, InventoryItem.sku),
}


def lock_rows(session: Session, reads: Iterable[ReadVersion]) -> None:
    """SELECT … FOR UPDATE every row a simulation read, in one global order (type, id) so two
    executions can never deadlock on each other. Missing rows simply lock nothing."""
    by_type: dict[str, list[str]] = {}
    for read in sorted(reads):
        if read.resource_type in _LOCKABLE:
            by_type.setdefault(read.resource_type, []).append(read.resource_id)
    for resource_type in sorted(by_type):
        model, key = _LOCKABLE[resource_type]
        ids = sorted(set(by_type[resource_type]))
        session.execute(select(model).where(key.in_(ids)).order_by(key).with_for_update())
