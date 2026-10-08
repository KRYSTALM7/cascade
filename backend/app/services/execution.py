"""Execution (blueprint §H): lock -> re-simulate -> fingerprint check -> apply the SAME previewed
changes node by node in topological order, each inside a SAVEPOINT.

The freshness check covers business state AND the configuration the preview depended on: an
approval is bound to the policy, the reaction rules and the agent/tool/permission rows it was
decided under. Any difference -> 409 with the specific STALE_* code, nothing applied.

Required step fails -> everything rolled back -> FAILED (retryable; new attempt row next time).
Optional step fails -> that step (and anything it would have triggered) rolled back, the rest kept
-> PARTIALLY_EXECUTED. A different fingerprint -> 409 STALE_STATE, nothing applied.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import CascadeError, ErrorCode
from app.domain.consequence.report import ConsequenceReport
from app.domain.enums import ActionStatus, ActorType, ExecutionStatus
from app.domain.state import ReadVersion
from app.domain.tools.base import canonical_json
from app.models import Action, ActionExecution, User
from app.repositories.execution import ApplyConflictError, apply_node
from app.repositories.world import lock_rows
from app.services import audit
from app.services.actions import PROPOSERS, ActionService
from app.services.approvals import expire_if_due
from app.services.context import ServiceContext, require_role
from app.services.outcomes import Outcome, compute, load_outcome
from app.services.transitions import transition

EXECUTABLE = (ActionStatus.AUTO_APPROVED, ActionStatus.APPROVED, ActionStatus.FAILED)
DONE = (ActionStatus.EXECUTED, ActionStatus.PARTIALLY_EXECUTED)

_REFUSALS: dict[ActionStatus, tuple[ErrorCode, str]] = {
    ActionStatus.PENDING_APPROVAL: (ErrorCode.APPROVAL_REQUIRED, "A human must approve first."),
    ActionStatus.EXPIRED: (ErrorCode.APPROVAL_EXPIRED, "The approval window has closed."),
    ActionStatus.REJECTED: (ErrorCode.ACTION_REJECTED, "The action was rejected."),
    ActionStatus.BLOCKED: (ErrorCode.ACTION_BLOCKED, "The action is blocked by policy."),
    ActionStatus.STALE: (ErrorCode.STALE_STATE, "State changed since simulation; re-simulate."),
    ActionStatus.PARSED: (ErrorCode.NOT_SIMULATED, "Simulate the action first."),
    ActionStatus.NEEDS_CLARIFICATION: (ErrorCode.NOT_SIMULATED, "Clarify and simulate first."),
    ActionStatus.SIMULATED: (ErrorCode.NOT_SIMULATED, "Simulation has no decision yet."),
    ActionStatus.EXECUTING: (ErrorCode.ILLEGAL_TRANSITION, "The action is already executing."),
}


class InjectedFaultError(RuntimeError):
    """FAULT_INJECTION: deterministic failure of one tool, for tests and the demo."""


_STALE_MESSAGES: dict[ErrorCode, str] = {
    ErrorCode.STALE_STATE: "The world changed since this action was simulated; nothing was "
    "applied. Re-simulate to see the current consequences.",
    ErrorCode.STALE_POLICY_VERSION: "The approval policy changed since this action was "
    "simulated; nothing was applied. Re-simulate under the current policy.",
    ErrorCode.STALE_REACTION_RULE_VERSION: "Agent reaction rules this cascade depends on changed "
    "since simulation; nothing was applied. Re-simulate to see what the agents would do now.",
    ErrorCode.STALE_TOOL_CONFIG: "An agent, tool or permission this cascade depends on changed "
    "since simulation; nothing was applied. Re-simulate.",
}


def graph_shape(report: ConsequenceReport) -> list[tuple[str, str, str, str]]:
    return [(n.agent_id, n.tool_id, canonical_json(n.params), n.status.value) for n in report.nodes]


def stale_reasons(stored: Outcome, fresh: Outcome) -> list[ErrorCode]:
    """Why the approved preview no longer describes what execution would do (empty = fresh).
    Business state first, then policy, reaction rules and agent/tool/permission configuration;
    a changed graph or a newly blocked report with no other explanation is stale state."""
    old, new = stored.report, fresh.report
    reasons: list[ErrorCode] = []
    if new.fingerprint != old.fingerprint:
        reasons.append(ErrorCode.STALE_STATE)
    policy_then = (stored.risk.policy_version, stored.risk.policy_fingerprint)
    if (fresh.risk.policy_version, fresh.risk.policy_fingerprint) != policy_then:
        reasons.append(ErrorCode.STALE_POLICY_VERSION)
    if old.config is None or new.config is None:
        reasons.append(ErrorCode.STALE_REACTION_RULE_VERSION)  # unknown = changed (fail closed)
    else:
        if new.config.rules_fingerprint != old.config.rules_fingerprint:
            reasons.append(ErrorCode.STALE_REACTION_RULE_VERSION)
        if new.config.catalog_fingerprint != old.config.catalog_fingerprint:
            reasons.append(ErrorCode.STALE_TOOL_CONFIG)
    if not reasons and (graph_shape(new) != graph_shape(old) or new.is_blocked):
        reasons.append(ErrorCode.STALE_STATE)
    return reasons


def changed_rules(stored: ConsequenceReport, fresh: ConsequenceReport) -> list[str]:
    before = {r.id: r for r in stored.config.reaction_rules} if stored.config else {}
    after = {r.id: r for r in fresh.config.reaction_rules} if fresh.config else {}
    return sorted(i for i in before.keys() | after.keys() if before.get(i) != after.get(i))


class ExecutionService:
    def __init__(self, ctx: ServiceContext) -> None:
        self.ctx = ctx
        self.session = ctx.session
        self.actions = ActionService(ctx)

    def execute(self, user: User, action_id: uuid.UUID) -> Action:
        require_role(user, *PROPOSERS)
        action = self.actions.get(action_id, lock=True)  # serialises duplicate executes
        if action.status in DONE:
            return action  # EXE-04: idempotent; nothing applied twice
        if expire_if_due(self.ctx, action):
            self.session.commit()
            raise _refusal_error(action, ActionStatus.EXPIRED)
        if action.status not in EXECUTABLE:
            raise _refusal_error(action, action.status)

        stored = load_outcome(self.session, action)
        assert stored is not None
        lock_rows(
            self.session,
            [ReadVersion(r.resource_type, r.resource_id, r.version) for r in stored.report.reads],
        )
        self.session.expire_all()  # read the locked rows fresh, never from the identity map
        fresh = compute(self.ctx, action)
        reasons = stale_reasons(stored, fresh)
        if reasons:
            return self._stale(user, action, stored, fresh, reasons)

        return self._apply(user, action, fresh.report)

    def _stale(
        self,
        user: User,
        action: Action,
        stored_outcome: Outcome,
        fresh_outcome: Outcome,
        reasons: list[ErrorCode],
    ) -> Action:
        stored, fresh = stored_outcome.report, fresh_outcome.report
        before = {(r.resource_type, r.resource_id): r.version for r in stored.reads}
        after = {(r.resource_type, r.resource_id): r.version for r in fresh.reads}
        changed = sorted(
            f"{t}:{i}"
            for (t, i) in before.keys() | after.keys()
            if before.get((t, i)) != after.get((t, i))
        )
        rules = changed_rules(stored, fresh)
        policy = {
            "approved": stored_outcome.risk.policy_version,
            "current": fresh_outcome.risk.policy_version,
        }
        transition(action, ActionStatus.STALE)
        audit.record(
            self.session,
            "STALE_STATE_DETECTED",
            action_id=action.id,
            actor_type=ActorType.SYSTEM,
            actor_id=user.id,
            payload={
                "stale_reasons": [r.value for r in reasons],
                "simulated_fingerprint": stored.fingerprint,
                "current_fingerprint": fresh.fingerprint,
                "changed_rows": changed,
                "changed_rules": rules,
                "policy_version": policy,
                "now_blocked": [b.code for b in fresh.blocking],
            },
        )
        self.session.commit()
        raise CascadeError(
            reasons[0],
            _STALE_MESSAGES[reasons[0]],
            http_status=409,
            details={
                "action_id": str(action.id),
                "stale_reasons": [r.value for r in reasons],
                "changed_rows": changed,
                "changed_rules": rules,
                "policy_version": policy,
            },
        )

    def _apply(self, user: User, action: Action, report: ConsequenceReport) -> Action:
        session = self.session
        attempt = len(action.executions) + 1
        started = self.ctx.now()
        transition(action, ActionStatus.EXECUTING)
        steps: list[dict[str, Any]] = []
        failed: set[str] = set()
        required_failure: dict[str, Any] | None = None

        outer = session.begin_nested()
        for node_id in report.execution_order:
            node = report.node(node_id)
            step: dict[str, Any] = {
                "node_id": node.id,
                "agent_id": node.agent_id,
                "tool_id": node.tool_id,
                "required": node.required,
            }
            if node.parent_id in failed:
                failed.add(node.id)
                steps.append({**step, "status": "SKIPPED", "error": "parent step failed"})
                continue
            savepoint = session.begin_nested()
            try:
                if self.ctx.settings.fault_injection == node.tool_id:
                    raise InjectedFaultError(f"fault injected into {node.tool_id}")
                created = apply_node(session, node, action.id)
                savepoint.commit()
                steps.append(
                    {**step, "status": "APPLIED", "changes": len(node.changes), "created": created}
                )
            except (InjectedFaultError, ApplyConflictError, SQLAlchemyError, ValueError) as exc:
                savepoint.rollback()
                failed.add(node.id)
                steps.append({**step, "status": "FAILED", "error": f"{type(exc).__name__}: {exc}"})
                if node.required:
                    required_failure = {
                        "code": "REQUIRED_STEP_FAILED",
                        "node_id": node.id,
                        "tool_id": node.tool_id,
                        "message": str(exc),
                    }
                    break

        if required_failure is not None:
            outer.rollback()  # nothing from this attempt survives
            status, action_status = ExecutionStatus.FAILED, ActionStatus.FAILED
        else:
            outer.commit()
            partial = any(s["status"] != "APPLIED" for s in steps)
            status = ExecutionStatus.PARTIAL if partial else ExecutionStatus.SUCCEEDED
            action_status = ActionStatus.PARTIALLY_EXECUTED if partial else ActionStatus.EXECUTED

        transition(action, action_status)
        session.add(
            ActionExecution(
                action_id=action.id,
                attempt=attempt,
                status=status,
                steps=steps,
                error=required_failure,
                started_at=started,
                finished_at=self.ctx.now(),
            )
        )
        audit.record(
            session,
            {
                ExecutionStatus.SUCCEEDED: "EXECUTED",
                ExecutionStatus.PARTIAL: "PARTIALLY_EXECUTED",
                ExecutionStatus.FAILED: "EXECUTION_FAILED",
            }[status],
            action_id=action.id,
            actor_type=ActorType.USER,
            actor_id=user.id,
            payload={
                "attempt": attempt,
                "steps": steps,
                "error": required_failure,
                "fingerprint": report.fingerprint,
            },
        )
        session.commit()
        return action


def _refusal_error(action: Action, status: ActionStatus) -> CascadeError:
    code, message = _REFUSALS.get(status, (ErrorCode.ILLEGAL_TRANSITION, "Cannot execute."))
    return CascadeError(
        code,
        message,
        http_status=409,
        details={"action_id": str(action.id), "status": action.status.value},
    )
