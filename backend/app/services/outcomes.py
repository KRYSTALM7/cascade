"""Simulate -> score -> decide for one action, and persist/load the immutable result."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.consequence.engine import simulate_action
from app.domain.consequence.report import ConsequenceReport
from app.domain.enums import ActionStatus, ActorType, ApprovalStatus, Decision
from app.domain.policy.engine import DecisionResult, decide
from app.domain.policy.loader import cascade_limits
from app.domain.policy.reasons import PolicyReason
from app.domain.risk.scorer import RiskAssessment, score_report
from app.llm.facts import outcome_facts
from app.llm.provider import Narrative
from app.llm.schemas import ExplainInput, OutcomeFacts
from app.models import Action, ApprovalRequest
from app.models import ConsequenceReport as ReportRow
from app.models import RiskAssessment as RiskRow
from app.repositories.world import load_catalog, load_snapshot
from app.services import audit
from app.services.context import ServiceContext
from app.services.transitions import transition

_DECISION_STATUS = {
    Decision.BLOCKED: ActionStatus.BLOCKED,
    Decision.AUTO_APPROVED: ActionStatus.AUTO_APPROVED,
    Decision.APPROVAL_REQUIRED: ActionStatus.PENDING_APPROVAL,
}


@dataclass(frozen=True)
class Outcome:
    report: ConsequenceReport
    risk: RiskAssessment
    decision: DecisionResult

    def facts(self) -> OutcomeFacts:
        return outcome_facts(self.report, self.risk, self.decision)


def compute(ctx: ServiceContext, action: Action) -> Outcome:
    """Pure pipeline over a fresh snapshot. Writes nothing."""
    assert action.tool_id is not None
    report = simulate_action(
        snapshot=load_snapshot(ctx.session),
        catalog=load_catalog(ctx.session),
        agent_id=action.agent_id,
        tool_id=action.tool_id,
        params=action.parameters,
        now=ctx.now(),
        limits=cascade_limits(ctx.policy),
    )
    risk = score_report(report, ctx.policy)
    return Outcome(report, risk, decide(report, risk, ctx.policy))


def narrative_json(narrative: Narrative) -> dict[str, Any]:
    return {
        "summary": narrative.explanation.summary,
        "bullets": narrative.explanation.bullets,
        "source": narrative.source,
        "rejected_figures": narrative.rejected_figures,
    }


def simulate_and_persist(ctx: ServiceContext, action: Action, actor_id: str | None) -> Outcome:
    """PARSED/STALE -> SIMULATED -> BLOCKED | AUTO_APPROVED | PENDING_APPROVAL, one transaction."""
    session = ctx.session
    outcome = compute(ctx, action)
    report, risk, decision = outcome.report, outcome.risk, outcome.decision
    narrative = ctx.llm.explain(ExplainInput(kind="action", base=outcome.facts()))

    report_row = ReportRow(
        action_id=action.id,
        engine_version=report.engine_version,
        state_fingerprint=report.fingerprint,
        report=report.to_jsonable(),
    )
    session.add(report_row)
    session.flush()
    session.add(
        RiskRow(
            action_id=action.id,
            report_id=report_row.id,
            score=risk.score,
            level=risk.level,
            decision=decision.decision,
            dimensions=risk.model_dump(mode="json"),
            reasons=[r.model_dump(mode="json") for r in decision.reasons],
            policy_version=risk.policy_version,
        )
    )
    action.current_report_id = report_row.id
    action.state_fingerprint = report.fingerprint
    action.decision = decision.decision
    action.explanation = narrative_json(narrative)
    transition(action, ActionStatus.SIMULATED)
    transition(action, _DECISION_STATUS[decision.decision])

    audit.record(
        session,
        "ACTION_SIMULATED",
        action_id=action.id,
        actor_type=ActorType.SYSTEM,
        actor_id=actor_id,
        payload={
            "report_id": str(report_row.id),
            "engine_version": report.engine_version,
            "fingerprint": report.fingerprint,
            "nodes": [f"{n.agent_id}.{n.tool_id}:{n.status.value}" for n in report.nodes],
            "blast_radius": report.blast_radius.model_dump(mode="json"),
        },
    )
    audit.record(
        session,
        "RISK_ASSESSED",
        action_id=action.id,
        actor_type=ActorType.SYSTEM,
        actor_id=None,
        payload={
            "score": risk.score,
            "raw_score": risk.raw_score,
            "level": risk.level.value,
            "policy_version": risk.policy_version,
        },
    )
    audit.record(
        session,
        "DECISION_MADE",
        action_id=action.id,
        actor_type=ActorType.SYSTEM,
        actor_id=None,
        payload={
            "decision": decision.decision.value,
            "reasons": decision.codes,
            "money_out": decision.money_out,
        },
    )
    audit.record(
        session,
        "EXPLANATION_GENERATED",
        action_id=action.id,
        actor_type=ActorType.LLM,
        actor_id=ctx.llm.name,
        payload={"source": narrative.source, "rejected_figures": narrative.rejected_figures},
    )
    if decision.decision is Decision.APPROVAL_REQUIRED:
        expires_at = ctx.now() + timedelta(minutes=ctx.policy.approval_expiry_minutes)
        approval = action.approval
        if approval is None:
            # Through the relationship, so `action.approval` is correct in this same session.
            action.approval = ApprovalRequest(status=ApprovalStatus.PENDING, expires_at=expires_at)
        else:  # re-simulated after STALE: the old approval does not carry over
            approval.status = ApprovalStatus.PENDING
            approval.expires_at = expires_at
            approval.decided_by = None
            approval.decided_at = None
            approval.comment = None
        audit.record(
            session,
            "APPROVAL_REQUESTED",
            action_id=action.id,
            actor_type=ActorType.SYSTEM,
            actor_id=None,
            payload={"expires_at": expires_at.isoformat(), "money_out": decision.money_out},
        )
    session.flush()
    return outcome


def load_outcome(session: Session, action: Action) -> Outcome | None:
    if action.current_report_id is None:
        return None
    report_row = session.get(ReportRow, action.current_report_id)
    assert report_row is not None
    risk_row = session.scalars(select(RiskRow).where(RiskRow.report_id == report_row.id)).one()
    report = ConsequenceReport.model_validate(report_row.report)
    return Outcome(
        report=report,
        risk=RiskAssessment.model_validate(risk_row.dimensions),
        decision=DecisionResult(
            decision=risk_row.decision,
            reasons=[PolicyReason.model_validate(r) for r in risk_row.reasons],
            money_out=report.blast_radius.money_out,
            policy_version=risk_row.policy_version,
        ),
    )
