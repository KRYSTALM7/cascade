"""Action lifecycle: parse -> clarify -> simulate -> (what-if) -> approve/reject -> execute."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import Context, CurrentUser
from app.schemas.actions import (
    ActionDetailOut,
    ActionSummaryOut,
    AuditOut,
    ClarifyRequest,
    DecisionRequest,
    ParseRequest,
    SimulateRequest,
    WhatIfOut,
    WhatIfRequest,
)
from app.services import audit
from app.services.actions import ActionService
from app.services.approvals import ApprovalService, expire_if_due
from app.services.execution import ExecutionService
from app.services.views import detail, summary
from app.services.whatif import WhatIfService

router = APIRouter(prefix="/api/actions", tags=["actions"])


@router.post("/parse", response_model=ActionDetailOut)
def parse_action(body: ParseRequest, ctx: Context, user: CurrentUser) -> ActionDetailOut:
    """Natural language + acting agent -> PARSED or NEEDS_CLARIFICATION (never a guess)."""
    return detail(ctx.session, ActionService(ctx).parse(user, body))


@router.post("/{action_id}/clarify", response_model=ActionDetailOut)
def clarify_action(
    action_id: uuid.UUID, body: ClarifyRequest, ctx: Context, user: CurrentUser
) -> ActionDetailOut:
    return detail(ctx.session, ActionService(ctx).clarify(user, action_id, body.answers))


@router.post("/simulate", response_model=ActionDetailOut)
def simulate_action(body: SimulateRequest, ctx: Context, user: CurrentUser) -> ActionDetailOut:
    """Consequence graph + Blast Radius + risk + decision. Writes no business state."""
    return detail(ctx.session, ActionService(ctx).simulate(user, body))


@router.post("/{action_id}/what-if", response_model=WhatIfOut)
def what_if(
    action_id: uuid.UUID, body: WhatIfRequest, ctx: Context, user: CurrentUser
) -> WhatIfOut:
    alternative, comparison = WhatIfService(ctx).what_if(user, action_id, body)
    return WhatIfOut(comparison=comparison, alternative=detail(ctx.session, alternative))


@router.post("/{action_id}/approve", response_model=ActionDetailOut)
def approve(
    action_id: uuid.UUID, ctx: Context, user: CurrentUser, body: DecisionRequest | None = None
) -> ActionDetailOut:
    action = ApprovalService(ctx).approve(user, action_id, body.comment if body else None)
    return detail(ctx.session, action)


@router.post("/{action_id}/reject", response_model=ActionDetailOut)
def reject(
    action_id: uuid.UUID, ctx: Context, user: CurrentUser, body: DecisionRequest | None = None
) -> ActionDetailOut:
    action = ApprovalService(ctx).reject(user, action_id, body.comment if body else None)
    return detail(ctx.session, action)


@router.post("/{action_id}/execute", response_model=ActionDetailOut)
def execute(action_id: uuid.UUID, ctx: Context, user: CurrentUser) -> ActionDetailOut:
    """Idempotent. Also the retry path for FAILED."""
    return detail(ctx.session, ExecutionService(ctx).execute(user, action_id))


@router.get("", response_model=list[ActionSummaryOut])
def list_actions(
    ctx: Context, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[ActionSummaryOut]:
    return [summary(ctx.session, a) for a in ActionService(ctx).recent(limit)]


@router.get("/{action_id}", response_model=ActionDetailOut)
def get_action(action_id: uuid.UUID, ctx: Context) -> ActionDetailOut:
    service = ActionService(ctx)
    action = service.get(action_id)
    if expire_if_due(ctx, action):  # approvals expire lazily, also on read
        ctx.session.commit()
    return detail(ctx.session, action)


@router.get("/{action_id}/consequences", response_model=ActionDetailOut)
def get_consequences(action_id: uuid.UUID, ctx: Context) -> ActionDetailOut:
    return detail(ctx.session, ActionService(ctx).get(action_id))


@router.get("/{action_id}/audit", response_model=list[AuditOut])
def action_audit(action_id: uuid.UUID, ctx: Context) -> list[AuditOut]:
    ActionService(ctx).get(action_id)
    return [AuditOut.model_validate(e) for e in audit.for_action(ctx.session, action_id)]
