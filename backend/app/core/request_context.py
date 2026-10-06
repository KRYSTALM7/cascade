"""Per-request context carried via contextvars (no framework imports, so anything can use it)."""

from __future__ import annotations

from contextvars import ContextVar, Token

REQUEST_ID_HEADER = "X-Request-Id"
_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    return _request_id.get()


def set_request_id(value: str) -> Token[str | None]:
    return _request_id.set(value)


def reset_request_id(token: Token[str | None]) -> None:
    _request_id.reset(token)
