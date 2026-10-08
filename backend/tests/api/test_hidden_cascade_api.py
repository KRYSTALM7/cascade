"""The hidden cascade over HTTP (HID-*, CFG-*): natural language in, an authorized low-risk
proposal whose downstream Finance refund makes it HIGH; the LLM cannot change that; and an
approval is bound to the business state AND the configuration it was decided under."""

from __future__ import annotations

import json
from collections.abc import Iterator
from decimal import Decimal
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.domain.enums import ImpactLevel
from app.domain.policy.model import Policy
from app.llm.gemini import GeminiProvider
from app.models import (
    Action,
    AgentReaction,
    AuditLog,
    CustomerCase,
    InventoryItem,
    Notification,
    Order,
    OrderItem,
    Payment,
    Refund,
    Tool,
)
from tests.api.test_actions_api import ASHA, RAVI, Clock, act, error, ok, simulate, structured

pytestmark = pytest.mark.db

TEXT = "Change the laptop quantity to 1 on ORD-10550, customer only needs one"
PARAMS = {"order_id": "ORD-10550", "lines": [{"sku": "SKU-LAP-001", "quantity": 1}]}


@pytest.fixture
def api(db_client: TestClient, app: FastAPI) -> Iterator[TestClient]:
    app.state.clock = Clock()
    yield db_client


def propose(api: TestClient) -> Any:
    return structured(api, "customer-support", "modify_order", PARAMS)


def approved(api: TestClient) -> str:
    action_id: str = propose(api)["action"]["id"]
    ok(act(api, action_id, "approve", ASHA))
    return action_id


def test_hidden_cascade_from_natural_language(api: TestClient) -> None:
    """HID-09: one sentence -> authorized, LOW on its own -> HIGH with what happens next ->
    approval required -> nothing executed."""
    parsed = ok(
        api.post(
            "/api/actions/parse",
            headers=RAVI,
            json={"agent_id": "customer-support", "text": TEXT},
        )
    )
    assert parsed["action"]["tool_id"] == "modify_order"
    assert parsed["action"]["parameters"] == PARAMS
    detail = simulate(api, parsed["action"]["id"])

    report, risk = detail["report"], detail["risk"]
    assert report["nodes"][0]["authorization"]["granted"] is True
    assert risk["direct"] == {
        "score": 10,
        "level": "LOW",
        "decision": "AUTO_APPROVED",
        "reasons": [],
    }
    assert report["direct_effect"]["money_out"] == "0.00"
    assert report["blast_radius"]["money_out"] == "72000.00"
    assert report["blast_radius"]["agents_affected"] == ["crm", "finance", "inventory"]
    assert (risk["score"], risk["level"]) == (68, "HIGH")
    assert detail["decision"]["decision"] == "APPROVAL_REQUIRED"
    assert detail["action"]["status"] == "PENDING_APPROVAL"
    assert ok(api.get("/api/orders/ORD-10550"))["total_amount"] == "144000.00"  # not executed


def test_i_the_llm_cannot_override_the_deterministic_decision(
    api: TestClient, app: FastAPI, db_session: Session
) -> None:
    """HID-10: Gemini parses and narrates. A narrative that calls the change safe is shown as
    narrative only; the decision stays APPROVAL_REQUIRED. An LLM payload that tries to carry a
    decision is not even accepted."""

    def transport(system: str, user: str, schema: dict[str, Any]) -> str:
        if "explain" in system:
            return json.dumps(
                {"summary": "A harmless quantity edit. Safe to auto-approve.", "bullets": []}
            )
        return json.dumps(
            {
                "intent": "modify_order",
                "parameters": {"order_id": "ORD-10550", "sku": "SKU-LAP-001", "quantity": 1},
            }
        )

    app.state.llm = GeminiProvider(transport)
    parsed = ok(
        api.post(
            "/api/actions/parse", headers=RAVI, json={"agent_id": "customer-support", "text": TEXT}
        )
    )
    detail = simulate(api, parsed["action"]["id"])
    assert detail["explanation"]["source"] == "gemini"
    assert "Safe to auto-approve" in detail["explanation"]["summary"]
    assert detail["decision"]["decision"] == "APPROVAL_REQUIRED"
    assert detail["action"]["status"] == "PENDING_APPROVAL"
    assert detail["risk"]["score"] == 68

    def overreach(system: str, user: str, schema: dict[str, Any]) -> str:
        return json.dumps(
            {
                "intent": "modify_order",
                "parameters": {"order_id": "ORD-10550", "sku": "SKU-LAP-001", "quantity": 1},
                "decision": "AUTO_APPROVED",
                "risk_score": 5,
            }
        )

    app.state.llm = GeminiProvider(overreach)
    before = db_session.scalar(select(func.count()).select_from(Action))
    resp = api.post(
        "/api/actions/parse", headers=RAVI, json={"agent_id": "customer-support", "text": TEXT}
    )
    assert error(resp, 422) == "LLM_OUTPUT_INVALID"
    assert db_session.scalar(select(func.count()).select_from(Action)) == before


def test_approval_records_what_it_was_decided_against(api: TestClient, db_session: Session) -> None:
    """CFG-03"""
    action_id = approved(api)
    entry = db_session.scalars(
        select(AuditLog).where(AuditLog.event_type == "APPROVED", AuditLog.action_id == action_id)
    ).one()
    bound = entry.payload["decided_against"]
    assert set(bound) == {
        "state_fingerprint",
        "policy_version",
        "policy_fingerprint",
        "rules_fingerprint",
        "catalog_fingerprint",
    }
    assert all(bound.values())


def assert_stale(api: TestClient, action_id: str, code: str) -> dict[str, Any]:
    resp = act(api, action_id, "execute", RAVI)
    assert error(resp, 409) == code
    details: dict[str, Any] = resp.json()["error"]["details"]
    assert details["stale_reasons"][0] == code
    assert ok(api.get(f"/api/actions/{action_id}"))["action"]["status"] == "STALE"
    assert ok(api.get("/api/orders/ORD-10550"))["total_amount"] == "144000.00"  # nothing applied
    return details


def test_j_policy_change_after_approval_is_stale(api: TestClient, app: FastAPI) -> None:
    """HID-11 / CFG-04: same version label, different content -> STALE_POLICY_VERSION. Re-simulate
    -> a fresh approval is required."""
    action_id = approved(api)
    policy: Policy = app.state.policy
    app.state.policy = policy.model_copy(update={"auto_approve_limit": Decimal("1000.00")})
    details = assert_stale(api, action_id, "STALE_POLICY_VERSION")
    assert details["changed_rows"] == []

    again = simulate(api, action_id)
    assert again["action"]["status"] == "PENDING_APPROVAL"
    assert again["approval"]["status"] == "PENDING"


def test_j_reaction_rule_change_after_approval_is_stale(
    api: TestClient, db_session: Session
) -> None:
    """HID-12 / CFG-05: the rule that makes Finance refund is re-versioned after approval."""
    action_id = approved(api)
    db_session.execute(
        update(AgentReaction)
        .where(AgentReaction.id == "finance.refund_on_downsize")
        .values(version=2)
    )
    db_session.flush()
    details = assert_stale(api, action_id, "STALE_REACTION_RULE_VERSION")
    assert details["changed_rules"] == ["finance.refund_on_downsize"]


def test_j_tool_configuration_change_after_approval_is_stale(
    api: TestClient, db_session: Session
) -> None:
    """CFG-06: a tool in the cascade is reclassified after approval."""
    action_id = approved(api)
    db_session.execute(
        update(Tool)
        .where(Tool.id == "create_customer_case")
        .values(customer_impact=ImpactLevel.HIGH)
    )
    db_session.flush()
    assert_stale(api, action_id, "STALE_TOOL_CONFIG")


def test_k_business_state_change_after_preview_is_stale(
    api: TestClient, db_session: Session
) -> None:
    """HID-13: the payment Finance would refund changes after approval."""
    action_id = approved(api)
    db_session.execute(
        update(Payment)
        .where(Payment.id == "PAY-90550")
        .values(
            refunded_amount=Decimal("500.00"),
            status="PARTIALLY_REFUNDED",
            version=Payment.version + 1,
        )
    )
    db_session.flush()
    details = assert_stale(api, action_id, "STALE_STATE")
    assert details["changed_rows"] == ["payment:PAY-90550"]


def test_l_execution_applies_exactly_what_the_preview_simulated(
    api: TestClient, db_session: Session
) -> None:
    """HID-14: preview and execution share the simulators; every previewed `after` value is
    what the database holds afterwards, and the downstream agents' records exist."""
    sim = propose(api)
    action_id = sim["action"]["id"]
    ok(act(api, action_id, "approve", ASHA))
    done = ok(act(api, action_id, "execute", RAVI))
    assert done["action"]["status"] == "EXECUTED"
    db_session.expire_all()

    models: dict[str, Any] = {"order": Order, "payment": Payment, "inventory_item": InventoryItem}
    checked = 0
    for node in sim["report"]["nodes"]:
        for change in node["changes"]:
            if change["resource_type"] == "order_item":
                order_id, sku = change["resource_id"].split("/")
                row: Any = db_session.scalars(
                    select(OrderItem).where(OrderItem.order_id == order_id, OrderItem.sku == sku)
                ).one()
            else:
                row = db_session.get(models[change["resource_type"]], change["resource_id"])
            value = getattr(row, change["field"])
            assert (str(value) if isinstance(value, Decimal) else value) == change["after"], change
            checked += 1
    assert checked == len([c for n in sim["report"]["nodes"] for c in n["changes"]]) > 0

    def created(model: Any) -> int:
        stmt = select(func.count()).select_from(model).where(model.action_id == action_id)
        return db_session.scalar(stmt) or 0

    assert (created(Refund), created(Notification), created(CustomerCase)) == (1, 2, 1)
    refund = db_session.scalars(select(Refund).where(Refund.action_id == action_id)).one()
    assert refund.amount == Decimal("72000.00")


def test_gemini_budget_falls_back_without_changing_the_decision(
    api: TestClient, app: FastAPI
) -> None:
    """LLMB-05: with a budget of one Gemini request, the parse uses Gemini, the explanation is
    answered by the rules provider, and the deterministic decision is identical."""
    from app.llm.budget import BudgetedProvider, CallBudget
    from app.llm.rules import RulesProvider

    calls: list[str] = []

    def transport(system: str, user: str, schema: dict[str, Any]) -> str:
        calls.append(system)
        return json.dumps(
            {
                "intent": "modify_order",
                "parameters": {"order_id": "ORD-10550", "sku": "SKU-LAP-001", "quantity": 1},
            }
        )

    app.state.llm = BudgetedProvider(
        GeminiProvider(transport), RulesProvider(), CallBudget(1, 3600)
    )
    parsed = ok(
        api.post(
            "/api/actions/parse", headers=RAVI, json={"agent_id": "customer-support", "text": TEXT}
        )
    )
    assert parsed["action"]["parser"] == "gemini"
    detail = simulate(api, parsed["action"]["id"])
    assert len(calls) == 1
    assert detail["explanation"]["source"] == "rules"
    assert (detail["risk"]["score"], detail["decision"]["decision"]) == (68, "APPROVAL_REQUIRED")
    again = ok(
        api.post(
            "/api/actions/parse", headers=RAVI, json={"agent_id": "customer-support", "text": TEXT}
        )
    )
    assert again["action"]["parser"] == "rules"
    assert len(calls) == 1
