"""Domain error type, stable error codes, and handlers producing one consistent envelope.

Envelope:
    {"error": {"code": str, "message": str, "details": dict, "request_id": str | None}}
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.request_context import get_request_id

logger = logging.getLogger(__name__)


class ErrorCode(StrEnum):
    # Generic
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    HTTP_ERROR = "HTTP_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
    # Domain codes are added per phase; keep them here so they stay unique and greppable.
    AGENT_NOT_FOUND = "AGENT_NOT_FOUND"
    ORDER_NOT_FOUND = "ORDER_NOT_FOUND"
    # Caller identity (demo auth via X-User-Id)
    USER_UNKNOWN = "USER_UNKNOWN"
    ROLE_NOT_PERMITTED = "ROLE_NOT_PERMITTED"
    # Actions & lifecycle
    ACTION_NOT_FOUND = "ACTION_NOT_FOUND"
    ILLEGAL_TRANSITION = "ILLEGAL_TRANSITION"
    IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED"
    ACTION_NEEDS_CLARIFICATION = "ACTION_NEEDS_CLARIFICATION"
    INVALID_CLARIFICATION = "INVALID_CLARIFICATION"
    NOT_SIMULATED = "NOT_SIMULATED"
    # Approval
    ACTION_NOT_PENDING = "ACTION_NOT_PENDING"
    APPROVAL_EXPIRED = "APPROVAL_EXPIRED"
    APPROVER_NOT_AUTHORIZED = "APPROVER_NOT_AUTHORIZED"
    APPROVAL_LIMIT_EXCEEDED = "APPROVAL_LIMIT_EXCEEDED"
    SELF_APPROVAL_FORBIDDEN = "SELF_APPROVAL_FORBIDDEN"
    # Execution
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    ACTION_BLOCKED = "ACTION_BLOCKED"
    ACTION_REJECTED = "ACTION_REJECTED"
    STALE_STATE = "STALE_STATE"
    STALE_POLICY_VERSION = "STALE_POLICY_VERSION"
    STALE_REACTION_RULE_VERSION = "STALE_REACTION_RULE_VERSION"
    STALE_TOOL_CONFIG = "STALE_TOOL_CONFIG"
    # LLM
    LLM_OUTPUT_INVALID = "LLM_OUTPUT_INVALID"
    LLM_UNAVAILABLE = "LLM_UNAVAILABLE"
    WHAT_IF_NEEDS_CLARIFICATION = "WHAT_IF_NEEDS_CLARIFICATION"
    # Demo
    DEMO_MODE_DISABLED = "DEMO_MODE_DISABLED"
    PUBLIC_MODE_RESTRICTED = "PUBLIC_MODE_RESTRICTED"


class CascadeError(Exception):
    """Base for every expected, user-facing failure. Never carries secrets or stack traces."""

    def __init__(
        self,
        code: ErrorCode | str,
        message: str,
        *,
        http_status: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = str(code)
        self.message = message
        self.http_status = http_status
        self.details = details or {}


def error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "request_id": get_request_id(),
        }
    }


def _response(
    status: int, code: str, message: str, details: dict[str, Any] | None = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status, content=jsonable_encoder(error_body(code, message, details))
    )


async def _handle_cascade_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, CascadeError)
    logger.info("domain_error", extra={"code": exc.code, "status": exc.http_status})
    return _response(exc.http_status, exc.code, exc.message, exc.details)


async def _handle_validation_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = [
        {"loc": list(err.get("loc", ())), "msg": err.get("msg", ""), "type": err.get("type", "")}
        for err in exc.errors()
    ]
    return _response(
        422, ErrorCode.VALIDATION_ERROR, "Request validation failed.", {"errors": errors}
    )


_HTTP_CODES: dict[int, ErrorCode] = {
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
}


async def _handle_http_error(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = _HTTP_CODES.get(exc.status_code, ErrorCode.HTTP_ERROR)
    return _response(exc.status_code, code, str(exc.detail))


def internal_error_response() -> JSONResponse:
    """Used by the outermost middleware for unexpected exceptions (see core/middleware.py)."""
    return _response(500, ErrorCode.INTERNAL_ERROR, "An unexpected error occurred.")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(CascadeError, _handle_cascade_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_error)
