"""Consequence engine against the real seeded database."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.domain.consequence.engine import simulate_action
from app.domain.state import ReadVersion
from app.domain.tools.registry import SIMULATORS
from app.models import Tool
from app.repositories.world import load_catalog, load_snapshot, lock_rows
from tests.factories import LIMITS, NOW, novacart_catalog, novacart_snapshot

pytestmark = pytest.mark.db

SCENARIOS: list[tuple[str, str, dict[str, Any]]] = [
    ("customer-support", "cancel_order", {"order_id": "ORD-10482"}),
    (
        "customer-support",
        "modify_order",
        {"order_id": "ORD-10495", "lines": [{"sku": "SKU-WAT-003", "quantity": 2}]},
    ),
    ("customer-support", "cancel_order", {"order_id": "ORD-10510"}),
    ("customer-support", "cancel_order", {"order_id": "ORD-10490"}),
    ("customer-support", "issue_refund", {"order_id": "ORD-10482"}),
    ("customer-support", "issue_compensation", {"order_id": "ORD-10482", "percentage": "20"}),
]

BUSINESS_TABLES = [
    "customers",
    "orders",
    "order_items",
    "payments",
    "refunds",
    "inventory_items",
    "restock_requests",
    "customer_cases",
    "notifications",
]


def _dump(db: Session) -> dict[str, list[Any]]:
    return {
        t: [tuple(r) for r in db.execute(text(f"SELECT * FROM {t} ORDER BY 1"))]  # noqa: S608
        for t in BUSINESS_TABLES
    }


def test_database_tools_match_the_simulator_registry(db_session: Session) -> None:
    """TOOL-05: a DB tool without code behaviour (or vice versa) fails here."""
    assert set(db_session.scalars(select(Tool.id))) == set(SIMULATORS)


@pytest.mark.parametrize(("agent", "tool", "params"), SCENARIOS, ids=lambda v: str(v)[:30])
def test_db_loaded_world_gives_the_same_report_as_the_seed_data(
    db_session: Session, agent: str, tool: str, params: dict[str, Any]
) -> None:
    kwargs: dict[str, Any] = {
        "agent_id": agent,
        "tool_id": tool,
        "params": params,
        "now": NOW,
        "limits": LIMITS,
    }
    from_db = simulate_action(
        snapshot=load_snapshot(db_session), catalog=load_catalog(db_session), **kwargs
    )
    in_memory = simulate_action(snapshot=novacart_snapshot(), catalog=novacart_catalog(), **kwargs)
    assert from_db.canonical_json() == in_memory.canonical_json()


def test_simulation_never_writes_to_the_database(db_session: Session) -> None:
    """GRAPH-12"""
    before = _dump(db_session)
    for agent, tool, params in SCENARIOS:
        simulate_action(
            snapshot=load_snapshot(db_session),
            catalog=load_catalog(db_session),
            agent_id=agent,
            tool_id=tool,
            params=params,
            now=NOW,
            limits=LIMITS,
        )
    db_session.flush()
    assert not db_session.dirty and not db_session.new
    assert _dump(db_session) == before


def test_lock_rows_accepts_reads_of_missing_rows(db_session: Session) -> None:
    lock_rows(
        db_session,
        [
            ReadVersion("order", "ORD-10482", 1),
            ReadVersion("order", "ORD-NOPE", 0),
            ReadVersion("inventory_item", "SKU-LAP-001", 1),
            ReadVersion("order_item", "x", 0),
        ],
    )
