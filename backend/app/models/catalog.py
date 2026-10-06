"""Agent/tool catalog and the multi-agent wiring (permissions + reaction rules)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import JSON, Money, TimestampMixin, new_uuid, str_enum
from app.domain.enums import (
    ConditionKey,
    DataSensitivity,
    DomainEvent,
    ImpactLevel,
    Reversibility,
    UserRole,
)


class Agent(TimestampMixin, Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # e.g. "customer-support"
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    tools: Mapped[list[Tool]] = relationship(back_populates="owner", order_by="Tool.id")
    permissions: Mapped[list[AgentPermission]] = relationship(back_populates="agent")
    reactions: Mapped[list[AgentReaction]] = relationship(back_populates="agent")


class Tool(TimestampMixin, Base):
    """A simulated capability. The owner agent is the system that implements it; other agents may
    call it only through an AgentPermission. Behaviour lives in the code-side simulator registry,
    keyed by `id` (including its typed parameter model); these columns hold the catalog entry
    and static risk characteristics."""

    __tablename__ = "tools"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # e.g. "cancel_order"
    owner_agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    reversibility: Mapped[Reversibility] = mapped_column(str_enum(Reversibility, "reversibility"))
    customer_impact: Mapped[ImpactLevel] = mapped_column(str_enum(ImpactLevel, "customer_impact"))
    data_sensitivity: Mapped[DataSensitivity] = mapped_column(
        str_enum(DataSensitivity, "data_sensitivity")
    )
    read_only: Mapped[bool] = mapped_column(Boolean, default=False)

    owner: Mapped[Agent] = relationship(back_populates="tools")


class AgentPermission(TimestampMixin, Base):
    __tablename__ = "agent_permissions"
    __table_args__ = (UniqueConstraint("agent_id", "tool_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    agent: Mapped[Agent] = relationship(back_populates="permissions")


class AgentReaction(TimestampMixin, Base):
    """Declared agent behaviour: when `event_type` is emitted and `condition_key` holds, this agent
    calls `tool_id` with parameters built from the event payload via `param_mapping`.

    This is what makes the graph multi-agent rather than a tool->tool chain: every downstream node
    is attributable to an agent and to the specific rule (id + version) that fired.
    """

    __tablename__ = "agent_reactions"
    __table_args__ = (
        UniqueConstraint("agent_id", "event_type", "tool_id"),
        CheckConstraint("priority >= 0", name="priority_non_negative"),
        CheckConstraint("version >= 1", name="version_positive"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # e.g. "finance.refund_on_cancel"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    event_type: Mapped[DomainEvent] = mapped_column(str_enum(DomainEvent, "event_type"))
    condition_key: Mapped[ConditionKey] = mapped_column(
        str_enum(ConditionKey, "condition_key"), default=ConditionKey.ALWAYS
    )
    condition_params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    tool_id: Mapped[str] = mapped_column(ForeignKey("tools.id"))
    # {"tool_param": "$event.field"} or literal values; resolved by the engine, never eval'd.
    param_mapping: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    description: Mapped[str] = mapped_column(Text, default="")

    agent: Mapped[Agent] = relationship(back_populates="reactions")


class User(TimestampMixin, Base):
    """Human operators/approvers. Demo auth: identified by X-User-Id header."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "approval_limit IS NULL OR approval_limit >= 0", name="approval_limit_non_negative"
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(str_enum(UserRole, "user_role"))
    approval_limit: Mapped[Decimal | None] = mapped_column(Money)
