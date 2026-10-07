"""Pure, immutable view of the agent/tool catalog and the declared reaction rules."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Any

from app.domain.enums import (
    ConditionKey,
    DataSensitivity,
    DomainEvent,
    ImpactLevel,
    Reversibility,
)


@dataclass(frozen=True, slots=True)
class AgentDef:
    id: str
    name: str = ""
    enabled: bool = True


@dataclass(frozen=True, slots=True)
class ToolDef:
    id: str
    owner_agent_id: str
    reversibility: Reversibility
    customer_impact: ImpactLevel
    data_sensitivity: DataSensitivity
    enabled: bool = True
    read_only: bool = False
    name: str = ""


@dataclass(frozen=True, slots=True)
class PermissionDef:
    agent_id: str
    tool_id: str
    expires_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class ReactionDef:
    id: str
    agent_id: str
    event_type: DomainEvent
    tool_id: str
    param_mapping: Mapping[str, Any]
    condition_key: ConditionKey = ConditionKey.ALWAYS
    condition_params: Mapping[str, Any] = field(default_factory=dict)
    required: bool = True
    priority: int = 100
    enabled: bool = True
    version: int = 1
    description: str = ""


@dataclass(frozen=True, slots=True)
class Catalog:
    agents: Mapping[str, AgentDef]
    tools: Mapping[str, ToolDef]
    permissions: Mapping[tuple[str, str], PermissionDef]
    reactions: tuple[ReactionDef, ...]

    @classmethod
    def build(
        cls,
        *,
        agents: Iterable[AgentDef],
        tools: Iterable[ToolDef],
        permissions: Iterable[PermissionDef],
        reactions: Iterable[ReactionDef],
    ) -> Catalog:
        return cls(
            agents=MappingProxyType({a.id: a for a in agents}),
            tools=MappingProxyType({t.id: t for t in tools}),
            permissions=MappingProxyType({(p.agent_id, p.tool_id): p for p in permissions}),
            reactions=tuple(sorted(reactions, key=lambda r: (r.priority, r.id))),
        )

    def reactions_for(self, event: DomainEvent) -> list[ReactionDef]:
        """Subscribed rules in deterministic firing order: (priority, rule id)."""
        return [r for r in self.reactions if r.event_type is event]
