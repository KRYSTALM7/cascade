"""Load the NovaCart dataset. `reset_and_seed` wipes every table and reloads — deterministic, so
the demo and tests always start from identical state."""

from __future__ import annotations

import logging
from collections import Counter
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import (
    Agent,
    AgentPermission,
    AgentReaction,
    Base,
    Customer,
    InventoryItem,
    Order,
    OrderItem,
    Payment,
    Tool,
    User,
)
from app.seed import novacart_data as data

logger = logging.getLogger(__name__)


def wipe(session: Session) -> None:
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    session.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    # Rows are gone; drop any in-memory objects that still claim those identities.
    session.expunge_all()


def reset_and_seed(session: Session) -> dict[str, int]:
    """Caller owns the transaction (commit/rollback)."""
    wipe(session)

    session.add_all(Agent(**a) for a in data.AGENTS)
    session.flush()
    session.add_all(Tool(**t) for t in data.TOOLS)
    session.flush()
    session.add_all(
        AgentPermission(agent_id=agent_id, tool_id=tool_id)
        for agent_id, tool_ids in data.PERMISSIONS.items()
        for tool_id in tool_ids
    )
    session.add_all(
        AgentReaction(
            id=r.id,
            agent_id=r.agent_id,
            event_type=r.event_type,
            condition_key=r.condition_key,
            condition_params=r.condition_params,
            tool_id=r.tool_id,
            param_mapping=r.param_mapping,
            required=r.required,
            priority=r.priority,
            description=r.description,
        )
        for r in data.REACTIONS
    )
    session.add_all(User(**u) for u in data.USERS)
    session.add_all(Customer(**c) for c in data.CUSTOMERS)

    prices = {item["sku"]: item["unit_price"] for item in data.INVENTORY}
    reserved: Counter[str] = Counter()
    for seed in data.ORDERS:
        if seed.status in data.OPEN_STATUSES:
            for sku, qty in seed.lines:
                reserved[sku] += qty
    session.add_all(
        InventoryItem(**item, reserved=reserved[item["sku"]]) for item in data.INVENTORY
    )
    session.flush()

    for seed in data.ORDERS:
        holds = seed.status in data.OPEN_STATUSES
        items = [
            OrderItem(
                sku=sku,
                quantity=qty,
                unit_price=prices[sku],
                reserved_quantity=qty if holds else 0,
            )
            for sku, qty in seed.lines
        ]
        total = sum((i.unit_price * i.quantity for i in items), Decimal("0.00"))
        order = Order(
            id=seed.id,
            customer_id=seed.customer_id,
            status=seed.status,
            total_amount=total,
            items=items,
        )
        session.add(order)
        if seed.payment is not None:
            session.add(
                Payment(
                    id=seed.payment.id,
                    order_id=seed.id,
                    amount=total,
                    refunded_amount=seed.payment.refunded_amount,
                    method=seed.payment.method,
                    status=seed.payment.status,
                )
            )
    session.flush()

    counts = {
        "agents": len(data.AGENTS),
        "tools": len(data.TOOLS),
        "permissions": sum(len(v) for v in data.PERMISSIONS.values()),
        "reactions": len(data.REACTIONS),
        "users": len(data.USERS),
        "customers": len(data.CUSTOMERS),
        "inventory_items": len(data.INVENTORY),
        "orders": len(data.ORDERS),
    }
    logger.info("novacart_seeded", extra=counts)
    return counts
