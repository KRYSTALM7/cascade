"""Outermost ASGI middleware: request id, access log, and last-resort error envelope."""

from __future__ import annotations

import logging
import re
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import internal_error_response
from app.core.request_context import REQUEST_ID_HEADER, reset_request_id, set_request_id

logger = logging.getLogger("cascade.http")

# Accept a client-supplied id only if it is short and harmless; otherwise mint our own.
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_HEADER_KEY = REQUEST_ID_HEADER.lower().encode()


class RequestContextMiddleware:
    """Pure ASGI middleware (not BaseHTTPMiddleware) so it composes cleanly and stays fast."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = _header(scope, _HEADER_KEY)
        request_id = incoming if incoming and _SAFE_ID.match(incoming) else uuid.uuid4().hex
        token = set_request_id(request_id)
        started = time.perf_counter()
        status_holder = {"status": 0, "started": False}

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                status_holder["started"] = True
                headers = list(message.get("headers", []))
                headers.append((_HEADER_KEY, request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            logger.exception("unhandled_error", extra={"path": scope.get("path")})
            if status_holder["started"]:
                raise  # response already partially sent; nothing safe left to do
            response = internal_error_response()
            await response(scope, receive, send_with_id)
        finally:
            logger.info(
                "request",
                extra={
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": status_holder["status"],
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
            reset_request_id(token)


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key == name:
            return str(value.decode("latin-1"))
    return None
