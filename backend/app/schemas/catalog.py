"""API response models for the catalog. Money is serialised as a decimal STRING (exact)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.domain.enums import (
    ConditionKey,
    DataSensitivity,
    DomainEvent,
    ImpactLevel,
    Reversibility,
)


class _Orm(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ToolOut(_Orm):
    id: str
    owner_agent_id: str
    name: str
    description: str
    enabled: bool
    reversibility: Reversibility
    customer_impact: ImpactLevel
    data_sensitivity: DataSensitivity
    read_only: bool


class PermissionOut(_Orm):
    tool_id: str
    expires_at: datetime | None


class ReactionOut(_Orm):
    id: str
    agent_id: str
    event_type: DomainEvent
    condition_key: ConditionKey
    condition_params: dict[str, Any]
    tool_id: str
    param_mapping: dict[str, Any]
    required: bool
    priority: int
    enabled: bool
    version: int
    description: str


class AgentSummaryOut(_Orm):
    id: str
    name: str
    description: str
    enabled: bool
    owned_tools: list[str]
    permitted_tools: list[str]


class AgentDetailOut(AgentSummaryOut):
    tools: list[ToolOut]
    permissions: list[PermissionOut]
    reactions: list[ReactionOut]
