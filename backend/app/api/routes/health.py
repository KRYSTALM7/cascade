"""Liveness and readiness probes (Cloud Run / docker-compose healthchecks)."""

from __future__ import annotations

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import __version__
from app.api.deps import AppSettings
from app.core.errors import CascadeError, ErrorCode
from app.db.session import get_db, ping

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    # True = demo identities (X-User-Id), demo reset and the Escape Room are enabled. Shown in
    # the UI so a demo deployment can never be mistaken for a production-safe one.
    demo_mode: bool
    # True = a visitor-facing instance: reset and Escape Room runs are refused (PUBLIC_MODE).
    public_mode: bool


class ReadinessResponse(BaseModel):
    status: Literal["ready"]
    database: Literal["ok"]


@router.get("/healthz", response_model=HealthResponse)
def healthz(settings: AppSettings) -> HealthResponse:
    """Process is alive. Never touches dependencies."""
    return HealthResponse(
        status="ok",
        version=__version__,
        demo_mode=settings.demo_mode,
        public_mode=settings.is_public,
    )


@router.get(
    "/readyz",
    response_model=ReadinessResponse,
    responses={503: {"description": "A dependency is unavailable"}},
)
def readyz(db: Annotated[Session, Depends(get_db)]) -> ReadinessResponse:
    """Process can serve traffic: database reachable."""
    try:
        ping(db)
    except SQLAlchemyError as exc:
        logger.warning("readiness_db_unavailable", extra={"error": type(exc).__name__})
        raise CascadeError(
            ErrorCode.SERVICE_UNAVAILABLE,
            "Database is not reachable.",
            http_status=503,
            details={"dependency": "database"},
        ) from exc
    return ReadinessResponse(status="ready", database="ok")
