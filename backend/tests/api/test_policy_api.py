from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.domain.policy.loader import PolicyError
from app.main import create_app
from tests.conftest import make_settings


def test_policy_endpoint_serves_exact_decimal_strings(client: TestClient) -> None:
    body = client.get("/api/policy").json()
    assert body["auto_approve_limit"] == "2000.00"
    assert body["risk"]["weights"]["financial"] == "0.35"
    assert body["risk"]["levels"] == {"medium": 35, "high": 60, "critical": 80}
    assert body["cascade"] == {"max_depth": 6, "max_nodes": 50}


def test_app_refuses_to_start_with_an_invalid_policy(tmp_path: Path) -> None:
    bad = tmp_path / "policy.yaml"
    bad.write_text("version: x\n", encoding="utf-8")
    with pytest.raises(PolicyError):
        create_app(make_settings(policy_path=bad))
