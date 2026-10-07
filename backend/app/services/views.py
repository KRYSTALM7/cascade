"""Read models for the API: action detail (report + risk + decision + approval + executions)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.llm.facts import action_title
from app.models import Action
from app.schemas.actions import (
    ActionDetailOut,
    ActionOut,
    ActionSummaryOut,
    ApprovalOut,
    DecisionOut,
    ExecutionOut,
    ExplanationOut,
)
from app.services.outcomes import load_outcome


def detail(session: Session, action: Action) -> ActionDetailOut:
    session.refresh(action)
    outcome = load_outcome(session, action)
    return ActionDetailOut(
        action=ActionOut.model_validate(action),
        report=outcome.report if outcome else None,
        risk=outcome.risk if outcome else None,
        decision=DecisionOut(
            decision=outcome.decision.decision,
            reasons=outcome.decision.reasons,
            money_out=outcome.decision.money_out,
            policy_version=outcome.decision.policy_version,
        )
        if outcome
        else None,
        explanation=ExplanationOut.model_validate(action.explanation)
        if action.explanation
        else None,
        approval=ApprovalOut.model_validate(action.approval) if action.approval else None,
        executions=[ExecutionOut.model_validate(e) for e in action.executions],
    )


def summary(session: Session, action: Action) -> ActionSummaryOut:
    outcome = load_outcome(session, action)
    return ActionSummaryOut(
        id=action.id,
        status=action.status,
        decision=action.decision,
        agent_id=action.agent_id,
        tool_id=action.tool_id,
        title=action_title(action.tool_id or "unparsed request", dict(action.parameters)),
        proposed_by=action.proposed_by,
        risk_score=outcome.risk.score if outcome else None,
        risk_level=outcome.risk.level if outcome else None,
        money_out=outcome.report.blast_radius.money_out if outcome else None,
        parent_action_id=action.parent_action_id,
        created_at=action.created_at,
    )
