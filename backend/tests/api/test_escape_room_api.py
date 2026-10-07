"""Escape Room (§M): four adversarial scenarios, each caught by an existing mechanism."""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import AgentReaction, Order
from tests.conftest import make_settings

pytestmark = pytest.mark.db


@pytest.fixture
def room(app: FastAPI, db_client: TestClient) -> Iterator[TestClient]:
    app.state.settings = make_settings(demo_mode=True)
    yield db_client


def run(client: TestClient, scenario: str) -> Any:
    response = client.post(f"/api/escape-room/{scenario}/run")
    assert response.status_code == 200, response.text
    return response.json()


def test_scenarios_are_listed_as_data(room: TestClient) -> None:
    scenarios = room.get("/api/escape-room").json()
    assert [s["id"] for s in scenarios] == [
        "poisoned-instruction",
        "unauthorized-downstream",
        "state-tampering",
        "conflicting-instructions",
    ]
    assert all(s["expected_code"] and s["caught_by"] for s in scenarios)


def test_poisoned_instruction_is_blocked_and_audited(room: TestClient) -> None:
    result = run(room, "poisoned-instruction")
    assert result["passed"] is True
    assert (result["actual_outcome"], result["actual_code"]) == ("BLOCKED", "TOOL_NOT_PERMITTED")
    assert result["details"] == {"injection_audited": True, "acting_agent": "customer-support"}
    audit = room.get(f"/api/actions/{result['action_ids'][0]}/audit").json()
    assert "INJECTION_SUSPECTED" in [e["event_type"] for e in audit]


def test_unauthorized_downstream_is_blocked_where_it_happens(
    room: TestClient, db_session: Session
) -> None:
    result = run(room, "unauthorized-downstream")
    assert result["passed"] is True
    assert result["actual_code"] == "DOWNSTREAM_NOT_PERMITTED"
    assert result["details"]["blocked_node"] == "crm.issue_compensation"
    detail = room.get(f"/api/actions/{result['action_ids'][0]}").json()
    blocked = [n for n in detail["report"]["nodes"] if n["status"] == "BLOCKED"]
    assert [(n["agent_id"], n["tool_id"], n["rule_id"]) for n in blocked] == [
        ("crm", "issue_compensation", "crm.goodwill_on_vip_cancel")
    ]
    db_session.expire_all()
    rule = db_session.get(AgentReaction, "crm.goodwill_on_vip_cancel")
    assert rule is not None and rule.enabled is False  # toggled back


def test_state_tampering_is_stale_and_nothing_is_applied(
    room: TestClient, db_session: Session
) -> None:
    result = run(room, "state-tampering")
    assert result["passed"] is True
    assert result["actual_outcome"] == "409 STALE_STATE"
    assert result["details"]["changed_rows"] == ["order:ORD-10530"]
    assert result["details"]["order_status_after"] == "CONFIRMED"
    db_session.expire_all()
    order = db_session.get(Order, "ORD-10530")
    assert order is not None and order.total_amount == Decimal("54999.00")  # restored
    status = room.get(f"/api/actions/{result['action_ids'][0]}").json()["action"]["status"]
    assert status == "STALE"


def test_conflicting_instructions_first_wins_second_is_stale(room: TestClient) -> None:
    result = run(room, "conflicting-instructions")
    assert result["passed"] is True
    assert result["details"]["results"] == ["cancel EXECUTED", "modify STALE_STATE"]
    assert room.get("/api/orders/ORD-10540").json()["status"] == "CANCELLED"
    replay = room.post("/api/escape-room/conflicting-instructions/run")
    assert replay.status_code == 409  # ORD-10540 is no longer open: reset to replay


def test_every_scenario_passes_in_sequence(room: TestClient) -> None:
    ids = [s["id"] for s in room.get("/api/escape-room").json()]
    assert all(run(room, i)["passed"] for i in ids)


def test_escape_room_requires_demo_mode_and_known_ids(app: FastAPI, db_client: TestClient) -> None:
    response = db_client.post("/api/escape-room/poisoned-instruction/run")
    assert response.json()["error"]["code"] == "DEMO_MODE_DISABLED"
    app.state.settings = make_settings(demo_mode=True)
    assert db_client.post("/api/escape-room/nope/run").status_code == 404
