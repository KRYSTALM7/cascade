"""PUBLIC_MODE (PUB-*): a visitor-facing instance refuses operations that change the shared demo
data for everyone, hides the API docs, and keeps every approval rule exactly as it is."""

from __future__ import annotations

from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Environment, Settings
from app.models import Action, AgentReaction, Order
from tests.api.test_actions_api import ASHA, RAVI, Clock, act, error, ok, structured
from tests.conftest import make_settings

pytestmark = pytest.mark.db

TOKEN = "presenter-secret-123"  # noqa: S105 - test-only value
FLAGSHIP = {"order_id": "ORD-10550", "lines": [{"sku": "SKU-LAP-001", "quantity": 1}]}


@pytest.fixture
def settings() -> Settings:
    return make_settings(demo_mode=True, public_mode=True, demo_admin_token=TOKEN)


@pytest.fixture
def api(db_client: TestClient, app: FastAPI) -> Iterator[TestClient]:
    app.state.clock = Clock()
    yield db_client


def test_public_instance_refuses_demo_reset(api: TestClient, db_session: Session) -> None:
    """PUB-01: nothing is wiped; the error says why."""
    structured(api, "customer-support", "modify_order", FLAGSHIP)
    before = db_session.scalar(select(func.count()).select_from(Action))
    resp = api.post("/api/demo/reset")
    assert error(resp, 403) == "PUBLIC_MODE_RESTRICTED"
    assert "public demo" in resp.json()["error"]["message"]
    assert db_session.scalar(select(func.count()).select_from(Action)) == before == 1


def test_public_instance_refuses_escape_room_runs(api: TestClient, db_session: Session) -> None:
    """PUB-02: no rule is toggled and no order is edited; the scenario list stays readable."""
    for scenario in ["unauthorized-downstream", "state-tampering", "conflicting-instructions"]:
        assert error(api.post(f"/api/escape-room/{scenario}/run"), 403) == "PUBLIC_MODE_RESTRICTED"
    rule = db_session.get(AgentReaction, "crm.goodwill_on_vip_cancel")
    assert rule is not None and rule.enabled is False
    order = db_session.get(Order, "ORD-10530")
    assert order is not None and order.total_amount == Decimal("54999.00")
    assert len(ok(api.get("/api/escape-room"))) == 4


def test_cross_site_style_request_without_the_token_is_refused(api: TestClient) -> None:
    """PUB-03: a wrong or missing token never passes (a cross-site POST cannot set the header)."""
    assert error(api.post("/api/demo/reset", headers={"X-Demo-Admin-Token": "guess"}), 403) == (
        "PUBLIC_MODE_RESTRICTED"
    )


def test_presenter_token_unlocks_shared_state_operations(api: TestClient) -> None:
    """PUB-04"""
    resp = api.post("/api/demo/reset", headers={"X-Demo-Admin-Token": TOKEN})
    assert ok(resp)["seeded"]["orders"] == 11


def test_public_instance_hides_api_docs_and_reports_public_mode(api: TestClient) -> None:
    """PUB-05"""
    for path in ["/docs", "/redoc", "/openapi.json"]:
        assert api.get(path).status_code == 404
    assert ok(api.get("/healthz")) == {
        "status": "ok",
        "version": "0.1.0",
        "demo_mode": True,
        "public_mode": True,
    }


def test_public_mode_keeps_the_approval_rules(api: TestClient) -> None:
    """PUB-06: requester -> approver -> execute works; self-approval is still refused."""
    action_id = structured(api, "customer-support", "modify_order", FLAGSHIP)["action"]["id"]
    assert error(act(api, action_id, "approve", RAVI), 403) == "APPROVER_NOT_AUTHORIZED"
    ok(act(api, action_id, "approve", ASHA))
    assert ok(act(api, action_id, "execute", RAVI))["action"]["status"] == "EXECUTED"

    own = structured(
        api,
        "customer-support",
        "cancel_order",
        {"order_id": "ORD-10482"},
        headers=ASHA,
    )["action"]["id"]
    assert error(act(api, own, "approve", ASHA), 403) == "SELF_APPROVAL_FORBIDDEN"


def test_production_defaults_to_public_mode() -> None:
    """PUB-07: a cloud deploy is safe unless a private presenter instance opts out explicitly."""
    assert make_settings(environment=Environment.PRODUCTION).is_public is True
    assert make_settings(environment=Environment.PRODUCTION, public_mode=False).is_public is False
    assert make_settings(environment=Environment.LOCAL).is_public is False
    assert make_settings(environment=Environment.LOCAL, public_mode=True).is_public is True


def test_blank_public_mode_falls_back_to_the_safe_default() -> None:
    """PUB-09"""
    assert make_settings(environment=Environment.PRODUCTION, public_mode=" ").is_public is True


def test_blank_admin_token_means_no_token() -> None:
    """PUB-08: `DEMO_ADMIN_TOKEN=` in an env file must not become an empty, matchable token."""
    assert make_settings(demo_admin_token="  ")  # noqa: S106 - blank on purpose.demo_admin_token is None
