"""Global audit log (append-only), filterable; plus the demo users and demo reset."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.api.deps import AppSettings, DbSession, PrivateDemo
from app.core.errors import CascadeError, ErrorCode
from app.domain.enums import UserRole
from app.models import User
from app.schemas.actions import AuditOut
from app.seed.novacart import reset_and_seed
from app.services import audit

router = APIRouter(prefix="/api", tags=["audit"])


@router.get("/audit", response_model=list[AuditOut])
def global_audit(
    db: DbSession,
    event_type: Annotated[str | None, Query(max_length=64)] = None,
    actor_id: Annotated[str | None, Query(max_length=64)] = None,
    action_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[AuditOut]:
    rows = audit.search(
        db, event_type=event_type, actor_id=actor_id, action_id=action_id, limit=limit
    )
    return [AuditOut.model_validate(r) for r in rows]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    role: UserRole
    approval_limit: str | None


@router.get("/users", response_model=list[UserOut])
def list_users(db: DbSession) -> list[UserOut]:
    """Seeded demo identities for the UI's user switcher."""
    return [
        UserOut(
            id=u.id,
            name=u.name,
            role=u.role,
            approval_limit=str(u.approval_limit) if u.approval_limit is not None else None,
        )
        for u in db.scalars(select(User).order_by(User.id))
    ]


class ResetOut(BaseModel):
    seeded: dict[str, int]


@router.post("/demo/reset", response_model=ResetOut, dependencies=[PrivateDemo])
def demo_reset(db: DbSession, settings: AppSettings) -> ResetOut:
    """Wipe everything (including actions and audit) and reload NovaCart. DEMO_MODE only."""
    if not settings.demo_mode:
        raise CascadeError(
            ErrorCode.DEMO_MODE_DISABLED,
            "Demo reset is disabled (DEMO_MODE=false).",
            http_status=403,
        )
    counts = reset_and_seed(db)
    db.commit()
    return ResetOut(seeded=counts)
