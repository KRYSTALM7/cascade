"""API contracts for actions: requests, lifecycle detail, what-if comparison, audit."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

from app.domain.consequence.report import ConsequenceReport
from app.domain.enums import (
    ActionStatus,
    ActorType,
    ApprovalStatus,
    Decision,
    ExecutionStatus,
    Reversibility,
    RiskLevel,
)
from app.domain.policy.reasons import PolicyReason
from app.domain.risk.scorer import RiskAssessment

AgentId = Annotated[str, Field(min_length=1, max_length=64)]
IdempotencyKey = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")]


class _Req(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ParseRequest(_Req):
    agent_id: AgentId
    text: Annotated[str, Field(min_length=1, max_length=2000)]
    idempotency_key: IdempotencyKey | None = None


class ClarifyRequest(_Req):
    answers: Annotated[dict[str, JsonValue], Field(min_length=1, max_length=10)]


class SimulateRequest(_Req):
    """Either an existing `action_id`, or a structured proposal (no LLM involved)."""

    action_id: uuid.UUID | None = None
    agent_id: AgentId | None = None
    tool: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    parameters: dict[str, JsonValue] = {}
    idempotency_key: IdempotencyKey | None = None

    @model_validator(mode="after")
    def _one_form(self) -> Self:
        structured = self.agent_id is not None or self.tool is not None
        if self.action_id is not None and structured:
            raise ValueError("give either action_id or agent_id+tool, not both")
        if self.action_id is None and (self.agent_id is None or self.tool is None):
            raise ValueError("give action_id, or both agent_id and tool")
        return self


class WhatIfRequest(_Req):
    text: Annotated[str, Field(min_length=1, max_length=2000)] | None = None
    tool: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    parameters: dict[str, JsonValue] = {}

    @model_validator(mode="after")
    def _one_form(self) -> Self:
        if (self.text is None) == (self.tool is None):
            raise ValueError("give either text or tool (+parameters)")
        return self


class DecisionRequest(_Req):
    comment: Annotated[str, Field(max_length=500)] | None = None


# --- responses ----------------------------------------------------------------------------------


class _Orm(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ActionOut(_Orm):
    id: uuid.UUID
    status: ActionStatus
    decision: Decision | None
    agent_id: str
    tool_id: str | None
    parameters: dict[str, Any]
    raw_text: str | None
    parser: str | None
    proposed_by: str | None
    idempotency_key: str | None
    parent_action_id: uuid.UUID | None
    clarification: dict[str, Any] | None
    interpretation: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class ExplanationOut(BaseModel):
    summary: str
    bullets: list[str]
    source: str
    rejected_figures: list[str] = []


class DecisionOut(BaseModel):
    decision: Decision
    reasons: list[PolicyReason]
    money_out: Decimal
    policy_version: str


class ApprovalOut(_Orm):
    status: ApprovalStatus
    expires_at: datetime
    decided_by: str | None
    decided_at: datetime | None
    comment: str | None


class ExecutionOut(_Orm):
    attempt: int
    status: ExecutionStatus
    steps: list[dict[str, Any]]
    error: dict[str, Any] | None
    started_at: datetime
    finished_at: datetime | None


class ActionDetailOut(BaseModel):
    action: ActionOut
    report: ConsequenceReport | None = None
    risk: RiskAssessment | None = None
    decision: DecisionOut | None = None
    explanation: ExplanationOut | None = None
    approval: ApprovalOut | None = None
    executions: list[ExecutionOut] = []


class ActionSummaryOut(BaseModel):
    id: uuid.UUID
    status: ActionStatus
    decision: Decision | None
    agent_id: str
    tool_id: str | None
    title: str
    proposed_by: str | None
    risk_score: int | None
    risk_level: RiskLevel | None
    money_out: Decimal | None
    parent_action_id: uuid.UUID | None
    created_at: datetime


class SideOut(BaseModel):
    action_id: uuid.UUID
    title: str
    money_out: Decimal
    agents: list[str]
    downstream_actions: int
    records_affected: int
    risk_score: int
    risk_level: RiskLevel
    reversibility: Reversibility
    decision: Decision


class DeltaOut(BaseModel):
    money_out: Decimal  # alternative - base
    agents: int
    downstream_actions: int
    records_affected: int
    risk_score: int


class ComparisonOut(BaseModel):
    base: SideOut
    alternative: SideOut
    delta: DeltaOut
    lower_risk: bool
    explanation: ExplanationOut


class WhatIfOut(BaseModel):
    comparison: ComparisonOut
    alternative: ActionDetailOut


class AuditOut(_Orm):
    id: int
    action_id: uuid.UUID | None
    event_type: str
    actor_type: ActorType
    actor_id: str | None
    payload: dict[str, Any]
    request_id: str | None
    created_at: datetime
