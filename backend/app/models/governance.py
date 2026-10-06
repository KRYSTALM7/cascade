"""Actions and everything recorded about them: consequence reports, risk, approval, execution,
audit. Reports are immutable JSONB snapshots — what the approver saw is exactly what is stored.

`actions.agent_id` / `actions.tool_id` deliberately have NO foreign keys: an attempt by an unknown
agent or with an unknown tool must still be recordable for audit (and then BLOCKED).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import (
    JSON,
    CreatedAtMixin,
    TimestampMixin,
    VersionedMixin,
    new_uuid,
    str_enum,
)
from app.domain.enums import (
    ActionStatus,
    ActorType,
    ApprovalStatus,
    Decision,
    ExecutionStatus,
    RiskLevel,
)


class Action(VersionedMixin, TimestampMixin, Base):
    __tablename__ = "actions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    # Client-supplied; makes re-submission of the same proposal return the same action.
    idempotency_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    proposed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    agent_id: Mapped[str] = mapped_column(String(64), index=True)
    tool_id: Mapped[str | None] = mapped_column(String(64))  # None until NL parse resolves it
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    raw_text: Mapped[str | None] = mapped_column(Text)
    interpretation: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # LLM output, as received
    parser: Mapped[str | None] = mapped_column(String(32))  # "gemini" | "rules" | "structured"
    status: Mapped[ActionStatus] = mapped_column(str_enum(ActionStatus, "action_status"))
    decision: Mapped[Decision | None] = mapped_column(str_enum(Decision, "decision"))
    state_fingerprint: Mapped[str | None] = mapped_column(String(64))
    parent_action_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("actions.id"))
    clarification: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    reports: Mapped[list[ConsequenceReport]] = relationship(
        back_populates="action", order_by="ConsequenceReport.created_at"
    )
    approval: Mapped[ApprovalRequest | None] = relationship(back_populates="action")
    executions: Mapped[list[ActionExecution]] = relationship(
        back_populates="action", order_by="ActionExecution.attempt"
    )


class ConsequenceReport(CreatedAtMixin, Base):
    __tablename__ = "consequence_reports"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    action_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("actions.id", ondelete="CASCADE"), index=True
    )
    engine_version: Mapped[str] = mapped_column(String(32))
    state_fingerprint: Mapped[str] = mapped_column(String(64))
    report: Mapped[dict[str, Any]] = mapped_column(JSON)  # graph + blast radius, immutable

    action: Mapped[Action] = relationship(back_populates="reports")


class RiskAssessment(CreatedAtMixin, Base):
    __tablename__ = "risk_assessments"
    __table_args__ = (CheckConstraint("score BETWEEN 0 AND 100", name="score_range"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    action_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("actions.id", ondelete="CASCADE"), index=True
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("consequence_reports.id", ondelete="CASCADE")
    )
    score: Mapped[int] = mapped_column(Integer)
    level: Mapped[RiskLevel] = mapped_column(str_enum(RiskLevel, "risk_level"))
    decision: Mapped[Decision] = mapped_column(str_enum(Decision, "risk_decision"))
    dimensions: Mapped[dict[str, Any]] = mapped_column(JSON)
    reasons: Mapped[list[dict[str, Any]]] = mapped_column(JSON)  # [{code, message, ...}]
    policy_version: Mapped[str] = mapped_column(String(32))


class ApprovalRequest(TimestampMixin, VersionedMixin, Base):
    __tablename__ = "approval_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    action_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("actions.id", ondelete="CASCADE"), unique=True
    )
    status: Mapped[ApprovalStatus] = mapped_column(str_enum(ApprovalStatus, "approval_status"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    comment: Mapped[str | None] = mapped_column(Text)

    action: Mapped[Action] = relationship(back_populates="approval")


class ActionExecution(Base):
    __tablename__ = "action_executions"
    __table_args__ = (
        UniqueConstraint("action_id", "attempt"),
        CheckConstraint("attempt >= 1", name="attempt_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    action_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("actions.id", ondelete="CASCADE"), index=True
    )
    attempt: Mapped[int] = mapped_column(Integer)
    status: Mapped[ExecutionStatus] = mapped_column(str_enum(ExecutionStatus, "execution_status"))
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    action: Mapped[Action] = relationship(back_populates="executions")


class AuditLog(CreatedAtMixin, Base):
    """Append-only. Application code inserts; it never updates or deletes rows."""

    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_action_id_id", "action_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    # Intentionally not a FK: audit rows must survive anything that happens to the action.
    action_id: Mapped[uuid.UUID | None] = mapped_column()
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    actor_type: Mapped[ActorType] = mapped_column(str_enum(ActorType, "actor_type"))
    actor_id: Mapped[str | None] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(64))
