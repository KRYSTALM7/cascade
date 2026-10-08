"""Human approval: approve / reject, lazy expiry, role + limit + no-self-approval checks."""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.errors import CascadeError, ErrorCode
from app.domain.enums import ActionStatus, ActorType, ApprovalStatus, UserRole
from app.domain.policy.engine import approver_error
from app.models import Action, ApprovalRequest, User
from app.services import audit
from app.services.actions import ActionService
from app.services.context import ServiceContext
from app.services.outcomes import load_outcome
from app.services.transitions import transition


def expire_if_due(ctx: ServiceContext, action: Action) -> bool:
    """Approvals expire lazily: checked whenever a pending action is touched."""
    approval = action.approval
    if action.status is not ActionStatus.PENDING_APPROVAL or approval is None:
        return False
    if approval.expires_at > ctx.now():
        return False
    approval.status = ApprovalStatus.EXPIRED
    transition(action, ActionStatus.EXPIRED)
    audit.record(
        ctx.session,
        "APPROVAL_EXPIRED",
        action_id=action.id,
        actor_type=ActorType.SYSTEM,
        actor_id=None,
        payload={"expired_at": approval.expires_at.isoformat()},
    )
    return True


def _binding(session: Session, action: Action) -> dict[str, str | None]:
    """What a decision is bound to: the business-state fingerprint and the configuration
    (policy, reaction rules, agent/tool/permission rows) of the report the approver saw.
    Execution re-checks every one of these (services/execution.py::stale_reasons)."""
    outcome = load_outcome(session, action)
    assert outcome is not None
    config = outcome.report.config
    return {
        "state_fingerprint": outcome.report.fingerprint,
        "policy_version": outcome.risk.policy_version,
        "policy_fingerprint": outcome.risk.policy_fingerprint,
        "rules_fingerprint": config.rules_fingerprint if config else None,
        "catalog_fingerprint": config.catalog_fingerprint if config else None,
    }


def _expired_error(action: Action) -> CascadeError:
    return CascadeError(
        ErrorCode.APPROVAL_EXPIRED,
        "The approval window for this action has closed; simulate it again.",
        http_status=409,
        details={"action_id": str(action.id)},
    )


def _not_pending(action: Action) -> CascadeError:
    return CascadeError(
        ErrorCode.ACTION_NOT_PENDING,
        f"Action is {action.status}, not awaiting approval.",
        http_status=409,
        details={"action_id": str(action.id), "status": action.status.value},
    )


class ApprovalService:
    def __init__(self, ctx: ServiceContext) -> None:
        self.ctx = ctx
        self.session = ctx.session
        self.actions = ActionService(ctx)

    def _deny(self, action: Action, user: User, code: str, message: str) -> CascadeError:
        audit.record(
            self.session,
            "APPROVAL_DENIED",
            action_id=action.id,
            actor_type=ActorType.USER,
            actor_id=user.id,
            payload={"code": code, "message": message},
        )
        self.session.commit()
        return CascadeError(code, message, http_status=403, details={"user_id": user.id})

    def _pending(self, action_id: uuid.UUID, user: User, target: ApprovalStatus) -> Action | None:
        """Lock, expire if due, and return None if this exact decision was already made."""
        action = self.actions.get(action_id, lock=True)
        if expire_if_due(self.ctx, action):
            self.session.commit()
            raise _expired_error(action)
        done = ActionStatus.APPROVED if target is ApprovalStatus.APPROVED else ActionStatus.REJECTED
        if action.status is done:
            return None  # duplicate request: idempotent
        if action.status is ActionStatus.EXPIRED:
            raise _expired_error(action)
        if action.status is not ActionStatus.PENDING_APPROVAL:
            raise _not_pending(action)
        return action

    def approve(self, user: User, action_id: uuid.UUID, comment: str | None) -> Action:
        action = self._pending(action_id, user, ApprovalStatus.APPROVED)
        if action is None:
            return self.actions.get(action_id)
        outcome = load_outcome(self.session, action)
        assert outcome is not None
        error = approver_error(
            approver_id=user.id,
            approver_role=user.role,
            approval_limit=user.approval_limit,
            proposer_id=action.proposed_by,
            money_out=outcome.report.blast_radius.money_out,
        )
        if error:
            raise self._deny(action, user, *error)
        self._decide(action, user, ApprovalStatus.APPROVED, ActionStatus.APPROVED, comment)
        return action

    def reject(self, user: User, action_id: uuid.UUID, comment: str | None) -> Action:
        action = self._pending(action_id, user, ApprovalStatus.REJECTED)
        if action is None:
            return self.actions.get(action_id)
        if user.role is not UserRole.APPROVER:
            raise self._deny(
                action,
                user,
                "APPROVER_NOT_AUTHORIZED",
                f"{user.id} does not have the APPROVER role.",
            )
        self._decide(action, user, ApprovalStatus.REJECTED, ActionStatus.REJECTED, comment)
        return action

    def _decide(
        self,
        action: Action,
        user: User,
        approval_status: ApprovalStatus,
        action_status: ActionStatus,
        comment: str | None,
    ) -> None:
        approval = action.approval
        assert isinstance(approval, ApprovalRequest)
        approval.status = approval_status
        approval.decided_by = user.id
        approval.decided_at = self.ctx.now()
        approval.comment = comment
        transition(action, action_status)
        audit.record(
            self.session,
            approval_status.value,  # "APPROVED" | "REJECTED"
            action_id=action.id,
            actor_type=ActorType.USER,
            actor_id=user.id,
            payload={"comment": comment, "decided_against": _binding(self.session, action)},
        )
        self.session.commit()
