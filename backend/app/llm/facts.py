"""Build the facts an explanation is allowed to use, from backend-computed results only."""

from __future__ import annotations

from typing import Any

from app.domain.consequence.report import ConsequenceReport
from app.domain.policy.engine import DecisionResult
from app.domain.risk.scorer import RiskAssessment
from app.llm.schemas import OutcomeFacts, StepFact


def action_title(tool_id: str, params: dict[str, Any]) -> str:
    target = params.get("order_id") or params.get("payment_id") or params.get("customer_id")
    verb = tool_id.replace("_", " ")
    return f"{verb} {target}" if target else verb


def outcome_facts(
    report: ConsequenceReport, risk: RiskAssessment, decision: DecisionResult
) -> OutcomeFacts:
    root = report.root
    return OutcomeFacts(
        title=action_title(root.tool_id, dict(root.params)),
        decision=decision.decision.value,
        risk_score=risk.score,
        risk_level=risk.level.value,
        money_out=str(report.blast_radius.money_out),
        agents=report.blast_radius.agents_affected,
        downstream_actions=report.blast_radius.downstream_actions,
        reversibility=report.blast_radius.reversibility.value,
        reasons=[r.message for r in decision.reasons],
        steps=[
            StepFact(
                agent_id=n.agent_id, tool_id=n.tool_id, status=n.status.value, summary=n.summary
            )
            for n in report.nodes
        ],
    )
