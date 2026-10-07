"""In-memory NovaCart world + catalog built from the same declarative seed data the DB uses, so
pure-domain tests need no database. `tests/integration/test_consequence_golden.py` proves the
DB-loaded inputs give byte-identical reports."""

from __future__ import annotations

from collections import Counter
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.domain.catalog import AgentDef, Catalog, PermissionDef, ReactionDef, ToolDef
from app.domain.consequence.engine import CascadeLimits, simulate_action
from app.domain.consequence.report import ConsequenceReport
from app.domain.enums import CustomerStatus, PaymentStatus
from app.domain.policy.loader import cascade_limits, load_policy
from app.domain.state import (
    CustomerRow,
    InventoryRow,
    OrderItemRow,
    OrderRow,
    PaymentRow,
    WorldSnapshot,
)
from app.seed import novacart_data as data

NOW = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)
POLICY_PATH = Path(__file__).resolve().parents[1] / "policy" / "policy.yaml"
POLICY = load_policy(POLICY_PATH)
LIMITS = cascade_limits(POLICY)


def novacart_snapshot() -> WorldSnapshot:
    prices = {i["sku"]: i["unit_price"] for i in data.INVENTORY}
    reserved: Counter[str] = Counter()
    items: list[OrderItemRow] = []
    orders: list[OrderRow] = []
    payments: list[PaymentRow] = []
    for seed in data.ORDERS:
        holds = seed.status in data.OPEN_STATUSES
        total = Decimal("0.00")
        for sku, qty in seed.lines:
            items.append(OrderItemRow(seed.id, sku, qty, prices[sku], qty if holds else 0))
            total += prices[sku] * qty
            if holds:
                reserved[sku] += qty
        orders.append(OrderRow(seed.id, seed.customer_id, seed.status, total))
        if seed.payment is not None:
            payments.append(
                PaymentRow(
                    seed.payment.id,
                    seed.id,
                    total,
                    seed.payment.refunded_amount,
                    seed.payment.method,
                    seed.payment.status,
                )
            )
    return WorldSnapshot.build(
        customers=[
            CustomerRow(
                c["id"], c["name"], c["email"], c["phone"], c["tier"], CustomerStatus.ACTIVE
            )
            for c in data.CUSTOMERS
        ],
        orders=orders,
        order_items=items,
        payments=payments,
        inventory=[
            InventoryRow(
                i["sku"],
                i["name"],
                i["on_hand"],
                reserved[i["sku"]],
                i["reorder_point"],
                i["unit_price"],
            )
            for i in data.INVENTORY
        ],
    )


def seed_agents() -> list[AgentDef]:
    return [AgentDef(a["id"], a["name"]) for a in data.AGENTS]


def seed_tools() -> list[ToolDef]:
    return [
        ToolDef(
            id=t["id"],
            owner_agent_id=t["owner_agent_id"],
            reversibility=t["reversibility"],
            customer_impact=t["customer_impact"],
            data_sensitivity=t["data_sensitivity"],
            read_only=t["read_only"],
            name=t["name"],
        )
        for t in data.TOOLS
    ]


def seed_permissions() -> list[PermissionDef]:
    return [PermissionDef(a, t) for a, tools in data.PERMISSIONS.items() for t in tools]


def seed_reactions() -> list[ReactionDef]:
    return [
        ReactionDef(
            id=r.id,
            agent_id=r.agent_id,
            event_type=r.event_type,
            tool_id=r.tool_id,
            param_mapping=r.param_mapping,
            condition_key=r.condition_key,
            condition_params=r.condition_params,
            required=r.required,
            priority=r.priority,
            enabled=r.enabled,
            description=r.description,
        )
        for r in data.REACTIONS
    ]


def novacart_catalog(
    *,
    agents: list[AgentDef] | None = None,
    tools: list[ToolDef] | None = None,
    permissions: list[PermissionDef] | None = None,
    reactions: list[ReactionDef] | None = None,
) -> Catalog:
    return Catalog.build(
        agents=agents if agents is not None else seed_agents(),
        tools=tools if tools is not None else seed_tools(),
        permissions=permissions if permissions is not None else seed_permissions(),
        reactions=reactions if reactions is not None else seed_reactions(),
    )


def with_agent(agent_id: str, **changes: Any) -> list[AgentDef]:
    return [replace(a, **changes) if a.id == agent_id else a for a in seed_agents()]


def with_tool(tool_id: str, **changes: Any) -> list[ToolDef]:
    return [replace(t, **changes) if t.id == tool_id else t for t in seed_tools()]


def with_reaction(rule_id: str, **changes: Any) -> list[ReactionDef]:
    return [replace(r, **changes) if r.id == rule_id else r for r in seed_reactions()]


def without_permission(agent_id: str, tool_id: str) -> list[PermissionDef]:
    return [p for p in seed_permissions() if (p.agent_id, p.tool_id) != (agent_id, tool_id)]


def with_payment_status(
    snapshot: WorldSnapshot, payment_id: str, status: PaymentStatus, refunded: Decimal
) -> WorldSnapshot:
    payments = [
        replace(p, status=status, refunded_amount=refunded) if p.id == payment_id else p
        for p in snapshot.payments.values()
    ]
    return replace(snapshot, payments={p.id: p for p in payments})


def simulate(
    agent_id: str,
    tool_id: str,
    params: dict[str, Any],
    *,
    snapshot: WorldSnapshot | None = None,
    catalog: Catalog | None = None,
    limits: CascadeLimits = LIMITS,
    now: datetime = NOW,
) -> ConsequenceReport:
    return simulate_action(
        snapshot=snapshot or novacart_snapshot(),
        catalog=catalog or novacart_catalog(),
        agent_id=agent_id,
        tool_id=tool_id,
        params=params,
        now=now,
        limits=limits,
    )


def hero(**kwargs: Any) -> ConsequenceReport:
    return simulate("customer-support", "cancel_order", {"order_id": "ORD-10482"}, **kwargs)
