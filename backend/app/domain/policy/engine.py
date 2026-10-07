"""Decision engine (blueprint §G.2): ordered rules -> BLOCKED / APPROVAL_REQUIRED / AUTO_APPROVED,
with every matching reason recorded. Authorization is always a hard BLOCK. Pure and stateless."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.domain.consequence.report import ConsequenceReport
from app.domain.enums import DataSensitivity, Decision, Reversibility, UserRole
from app.domain.money import format_inr
from app.domain.policy.model import Policy, level_at_least
from app.domain.policy.reasons import PolicyReason, Severity, render
from app.domain.risk.scorer import RiskAssessment


class DecisionResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    decision: Decision
    reasons: list[PolicyReason]
    money_out: Decimal
    policy_version: str

    @property
    def codes(self) -> list[str]:
        return [r.code for r in self.reasons]


def decide(report: ConsequenceReport, risk: RiskAssessment, policy: Policy) -> DecisionResult:
    radius = report.blast_radius
    info = list(risk.reasons)
    for warning in report.warnings:
        if warning.code in {"CASCADE_LIMIT_REACHED", "CYCLE_DETECTED"}:
            continue  # promoted to approval reasons below
        node = report.node(warning.node_id) if warning.node_id else None
        info.append(
            render(
                "OPTIONAL_STEP_SKIPPED",
                node_id=warning.node_id,
                tool_id=node.tool_id if node else "?",
                agent_id=node.agent_id if node else "?",
                cause=warning.code,
            )
        )

    def result(decision: Decision, reasons: list[PolicyReason]) -> DecisionResult:
        return DecisionResult(
            decision=decision,
            reasons=reasons + info,
            money_out=radius.money_out,
            policy_version=policy.version,
        )

    # 1. Hard rules: anything the engine refused (authorization, params, preconditions).
    if report.blocking:
        return result(
            Decision.BLOCKED,
            [
                PolicyReason(
                    code=b.code,
                    severity=Severity.BLOCK,
                    message=b.message,
                    node_id=b.node_id,
                    details=b.details,
                )
                for b in report.blocking
            ],
        )

    # 2. Human approval triggers (all matching ones are recorded).
    approval: list[PolicyReason] = []
    limit = policy.auto_approve_limit
    if radius.money_out > limit:
        approval.append(
            render(
                "REFUND_ABOVE_AUTO_LIMIT",
                money_out=format_inr(radius.money_out),
                limit=format_inr(limit),
            )
        )
    if level_at_least(risk.level, policy.approval.min_level):
        approval.append(render("HIGH_RISK", level=risk.level.value, score=risk.score))
    if radius.reversibility is Reversibility.NONE and level_at_least(
        risk.level, policy.approval.irreversible_min_level
    ):
        approval.append(render("IRREVERSIBLE_AT_MEDIUM_RISK", level=risk.level.value))
    if (
        policy.approval.bulk_pii_requires_approval
        and radius.data_sensitivity is DataSensitivity.BULK_PII
    ):
        approval.append(render("BULK_PII_EXPOSURE"))
    if report.limit_reached:
        approval.append(render("CASCADE_LIMIT_REACHED"))
    if report.cycle_detected:
        approval.append(render("CYCLE_DETECTED"))
    if approval:
        return result(Decision.APPROVAL_REQUIRED, approval)

    # 3. Otherwise the agent may proceed on its own.
    return result(
        Decision.AUTO_APPROVED,
        [
            render(
                "WITHIN_POLICY",
                money_out=format_inr(radius.money_out),
                limit=format_inr(limit),
                level=risk.level.value,
            )
        ],
    )


def approver_error(
    *,
    approver_id: str,
    approver_role: UserRole,
    approval_limit: Decimal | None,
    proposer_id: str | None,
    money_out: Decimal,
) -> tuple[str, str] | None:
    """Who may approve: role APPROVER, limit >= outflow, and never the proposer."""
    if approver_role is not UserRole.APPROVER:
        return ("APPROVER_NOT_AUTHORIZED", f"{approver_id} does not have the APPROVER role.")
    if proposer_id is not None and approver_id == proposer_id:
        return ("SELF_APPROVAL_FORBIDDEN", "The proposer cannot approve their own action.")
    if approval_limit is None or approval_limit < money_out:
        return (
            "APPROVAL_LIMIT_EXCEEDED",
            f"{approver_id} may approve up to {format_inr(approval_limit or Decimal(0))}; "
            f"this action moves {format_inr(money_out)}.",
        )
    return None
