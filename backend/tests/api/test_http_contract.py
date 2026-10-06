"""HTTP-level contract every endpoint inherits: error envelope, request ids, CORS, health."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from sqlalchemy.exc import OperationalError

from app.core.config import Settings
from app.core.errors import CascadeError
from app.db.session import get_db
from app.main import create_app


class _Body(BaseModel):
    amount: int = Field(gt=0)


def _app_with_probe_routes(settings: Settings) -> FastAPI:
    app = create_app(settings)
    probe = APIRouter(prefix="/_probe")

    @probe.post("/validate")
    def validate(body: _Body) -> dict[str, int]:
        return {"amount": body.amount}

    @probe.get("/domain-error")
    def domain_error() -> None:
        raise CascadeError(
            "ORDER_ALREADY_CANCELLED",
            "Order ORD-1 is already CANCELLED.",
            http_status=409,
            details={"order_id": "ORD-1"},
        )

    @probe.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret internal detail")

    app.include_router(probe)
    return app


@pytest.fixture
def probe_client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(_app_with_probe_routes(settings)) as c:
        yield c


def _assert_envelope(body: dict[str, object], code: str) -> dict[str, object]:
    assert set(body) == {"error"}
    error = body["error"]
    assert isinstance(error, dict)
    assert set(error) == {"code", "message", "details", "request_id"}
    assert error["code"] == code
    assert error["request_id"]
    return error


def test_healthz_reports_ok_and_version(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


def test_every_response_gets_a_request_id(client: TestClient) -> None:
    first = client.get("/healthz").headers["X-Request-Id"]
    second = client.get("/healthz").headers["X-Request-Id"]
    assert first and second and first != second


def test_safe_client_request_id_is_propagated(client: TestClient) -> None:
    response = client.get("/healthz", headers={"X-Request-Id": "demo-run.42"})
    assert response.headers["X-Request-Id"] == "demo-run.42"


@pytest.mark.parametrize("unsafe", ["a" * 65, "<script>", "id with spaces", "x;rm -rf"])
def test_unsafe_client_request_id_is_replaced(client: TestClient, unsafe: str) -> None:
    response = client.get("/healthz", headers={"X-Request-Id": unsafe})
    assert response.headers["X-Request-Id"] != unsafe
    assert len(response.headers["X-Request-Id"]) == 32


def test_unknown_route_uses_envelope(client: TestClient) -> None:
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    error = _assert_envelope(response.json(), "NOT_FOUND")
    assert error["request_id"] == response.headers["X-Request-Id"]


def test_wrong_method_uses_envelope(client: TestClient) -> None:
    response = client.delete("/healthz")
    assert response.status_code == 405
    _assert_envelope(response.json(), "METHOD_NOT_ALLOWED")


def test_validation_error_uses_envelope_with_field_locations(probe_client: TestClient) -> None:
    response = probe_client.post("/_probe/validate", json={"amount": -5})
    assert response.status_code == 422
    error = _assert_envelope(response.json(), "VALIDATION_ERROR")
    details = error["details"]
    assert isinstance(details, dict)
    assert details["errors"][0]["loc"] == ["body", "amount"]


def test_malformed_json_uses_envelope(probe_client: TestClient) -> None:
    response = probe_client.post(
        "/_probe/validate", content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    _assert_envelope(response.json(), "VALIDATION_ERROR")


def test_domain_error_keeps_code_status_and_details(probe_client: TestClient) -> None:
    response = probe_client.get("/_probe/domain-error")
    assert response.status_code == 409
    error = _assert_envelope(response.json(), "ORDER_ALREADY_CANCELLED")
    assert error["details"] == {"order_id": "ORD-1"}


def test_unexpected_error_is_500_envelope_without_leaking_internals(
    probe_client: TestClient,
) -> None:
    response = probe_client.get("/_probe/boom")
    assert response.status_code == 500
    error = _assert_envelope(response.json(), "INTERNAL_ERROR")
    assert "secret internal detail" not in response.text
    assert error["request_id"] == response.headers["X-Request-Id"]


def test_cors_allows_configured_origin_only(client: TestClient) -> None:
    preflight = {"Access-Control-Request-Method": "POST"}
    allowed = client.options("/healthz", headers={"Origin": "http://localhost:5173", **preflight})
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"
    denied = client.options("/healthz", headers={"Origin": "http://evil.test", **preflight})
    assert "access-control-allow-origin" not in denied.headers


def test_readyz_returns_503_envelope_when_database_is_down(app: FastAPI) -> None:
    class _DeadSession:
        def execute(self, *_: object, **__: object) -> None:
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    def _dead_db() -> Iterator[_DeadSession]:
        yield _DeadSession()

    app.dependency_overrides[get_db] = _dead_db
    with TestClient(app) as c:
        response = c.get("/readyz")
    assert response.status_code == 503
    error = _assert_envelope(response.json(), "SERVICE_UNAVAILABLE")
    assert error["details"] == {"dependency": "database"}
    assert "connection refused" not in response.text


def test_openapi_schema_is_served(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "Cascade API"
    assert "/readyz" in schema["paths"]
