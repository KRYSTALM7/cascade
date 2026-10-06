from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.db


def test_list_agents_shows_ownership_and_permissions(db_client: TestClient) -> None:
    agents = {a["id"]: a for a in db_client.get("/api/agents").json()}
    assert list(agents) == ["crm", "customer-support", "finance", "inventory", "order"]
    support = agents["customer-support"]
    assert support["owned_tools"] == ["request_refund"]
    assert "cancel_order" in support["permitted_tools"]
    assert "issue_refund" not in support["permitted_tools"]


def test_agent_detail_includes_declared_reactions(db_client: TestClient) -> None:
    finance = db_client.get("/api/agents/finance").json()
    reactions = {r["id"]: r for r in finance["reactions"]}
    rule = reactions["finance.refund_on_cancel"]
    assert rule["event_type"] == "ORDER_CANCELLED"
    assert rule["condition_key"] == "PAYMENT_CAPTURED"
    assert rule["tool_id"] == "issue_refund"
    assert rule["version"] == 1


@pytest.mark.parametrize("agent_id", ["ghost", "FINANCE", "finance%20", "../order"])
def test_unknown_agent_is_404_with_envelope(db_client: TestClient, agent_id: str) -> None:
    response = db_client.get(f"/api/agents/{agent_id}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] in {"AGENT_NOT_FOUND", "NOT_FOUND"}


def test_tools_and_reactions_are_listed(db_client: TestClient) -> None:
    tools = db_client.get("/api/tools").json()
    assert len(tools) == 14
    assert {t["id"]: t["reversibility"] for t in tools}["cancel_order"] == "NONE"
    reactions = db_client.get("/api/reactions").json()
    assert len(reactions) == 14
    assert reactions[0]["event_type"] <= reactions[-1]["event_type"]  # deterministic order


def test_order_detail_serialises_money_as_exact_strings(db_client: TestClient) -> None:
    order = db_client.get("/api/orders/ORD-10482").json()
    assert order["total_amount"] == "84500.00"
    assert order["customer"] == {
        "id": "CUST-1001",
        "name": "John Mathew",
        "tier": "VIP",
        "status": "ACTIVE",
    }
    assert [i["sku"] for i in order["items"]] == ["SKU-HPH-002", "SKU-LAP-001"]
    assert order["payments"][0]["refunded_amount"] == "0.00"


def test_unknown_order_is_404_with_envelope(db_client: TestClient) -> None:
    response = db_client.get("/api/orders/ORD-99999")
    assert response.status_code == 404
    body = response.json()["error"]
    assert body["code"] == "ORDER_NOT_FOUND"
    assert body["details"] == {"order_id": "ORD-99999"}


def test_orders_list_is_sorted_and_complete(db_client: TestClient) -> None:
    ids = [o["id"] for o in db_client.get("/api/orders").json()]
    assert ids == sorted(ids) and len(ids) == 10
