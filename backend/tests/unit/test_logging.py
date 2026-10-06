from __future__ import annotations

import json
import logging

from app.core.logging import JsonFormatter
from app.core.request_context import reset_request_id, set_request_id


def _record(msg: str, **extra: object) -> logging.LogRecord:
    record = logging.LogRecord("cascade.test", logging.INFO, __file__, 1, msg, None, None)
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_json_formatter_emits_one_parseable_object_with_extras() -> None:
    line = JsonFormatter().format(_record("hello", action_id="a1", risk_score=76))
    payload = json.loads(line)
    assert payload["msg"] == "hello"
    assert payload["level"] == "INFO"
    assert payload["action_id"] == "a1"
    assert payload["risk_score"] == 76
    assert "request_id" not in payload


def test_json_formatter_attaches_current_request_id() -> None:
    token = set_request_id("req-123")
    try:
        payload = json.loads(JsonFormatter().format(_record("x")))
    finally:
        reset_request_id(token)
    assert payload["request_id"] == "req-123"


def test_json_formatter_serialises_non_json_values() -> None:
    from decimal import Decimal

    payload = json.loads(JsonFormatter().format(_record("x", amount=Decimal("84500.00"))))
    assert payload["amount"] == "84500.00"
