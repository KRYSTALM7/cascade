"""Append-only audit trail. Inserts only — no update or delete path exists in application code."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.request_context import get_request_id
from app.domain.enums import ActorType
from app.domain.state import to_jsonable
from app.models import AuditLog


def record(
    session: Session,
    event_type: str,
    *,
    action_id: uuid.UUID | None,
    actor_type: ActorType,
    actor_id: str | None,
    payload: dict[str, Any] | None = None,
) -> AuditLog:
    entry = AuditLog(
        action_id=action_id,
        event_type=event_type,
        actor_type=actor_type,
        actor_id=actor_id,
        payload=to_jsonable(payload or {}),
        request_id=get_request_id(),
    )
    session.add(entry)
    return entry


def for_action(session: Session, action_id: uuid.UUID) -> Sequence[AuditLog]:
    stmt = select(AuditLog).where(AuditLog.action_id == action_id).order_by(AuditLog.id)
    return session.scalars(stmt).all()


def search(
    session: Session,
    *,
    event_type: str | None = None,
    actor_id: str | None = None,
    action_id: uuid.UUID | None = None,
    limit: int = 100,
) -> Sequence[AuditLog]:
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if event_type:
        stmt = stmt.where(AuditLog.event_type == event_type)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if action_id:
        stmt = stmt.where(AuditLog.action_id == action_id)
    return session.scalars(stmt).all()
