"""The ONE action state machine (blueprint §C). Every status change goes through `transition`."""

from __future__ import annotations

from collections.abc import Mapping

from app.core.errors import CascadeError, ErrorCode
from app.domain.enums import ActionStatus as S
from app.models import Action

TRANSITIONS: Mapping[S, frozenset[S]] = {
    S.PARSED: frozenset({S.NEEDS_CLARIFICATION, S.SIMULATED}),
    S.NEEDS_CLARIFICATION: frozenset({S.PARSED, S.NEEDS_CLARIFICATION}),
    S.SIMULATED: frozenset({S.BLOCKED, S.AUTO_APPROVED, S.PENDING_APPROVAL}),
    S.AUTO_APPROVED: frozenset({S.EXECUTING, S.STALE}),
    S.PENDING_APPROVAL: frozenset({S.APPROVED, S.REJECTED, S.EXPIRED, S.STALE}),
    S.APPROVED: frozenset({S.EXECUTING, S.STALE}),
    S.EXECUTING: frozenset({S.EXECUTED, S.PARTIALLY_EXECUTED, S.FAILED}),
    S.FAILED: frozenset({S.EXECUTING, S.STALE}),
    S.STALE: frozenset({S.SIMULATED}),
    # terminal
    S.BLOCKED: frozenset(),
    S.REJECTED: frozenset(),
    S.EXPIRED: frozenset(),
    S.EXECUTED: frozenset(),
    S.PARTIALLY_EXECUTED: frozenset(),
}

TERMINAL = frozenset(s for s, nxt in TRANSITIONS.items() if not nxt)


def can_transition(current: S, target: S) -> bool:
    return target in TRANSITIONS[current]


def transition(action: Action, target: S) -> None:
    current = S(action.status)
    if not can_transition(current, target):
        raise CascadeError(
            ErrorCode.ILLEGAL_TRANSITION,
            f"Action cannot go from {current} to {target}.",
            http_status=409,
            details={"action_id": str(action.id), "from": current.value, "to": target.value},
        )
    action.status = target
