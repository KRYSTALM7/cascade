"""ConsequenceReport: the immutable, canonical output of a simulation (persisted as JSONB)."""

from __future__ import annotations

import json
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, JsonValue

from app.domain.enums import (
    DataSensitivity,
    DomainEvent,
    ImpactLevel,
    Reversibility,
    TriggerType,
)

ENGINE_VERSION = "cascade-engine/1"


class NodeStatus(StrEnum):
    WILL_EXECUTE = "WILL_EXECUTE"
    BLOCKED = "BLOCKED"  # authorization / config: the agent may not do this
    WOULD_FAIL = "WOULD_FAIL"  # parameters or preconditions fail against simulated state
    SKIPPED_LIMIT = "SKIPPED_LIMIT"  # beyond max_depth / max_nodes: not explored


class EdgeKind(StrEnum):
    TRIGGER = "TRIGGER"  # event -> reaction rule -> child node
    DUPLICATE = "DUPLICATE"  # same (agent, tool, params) already in the graph: executed once
    CYCLE = "CYCLE"  # ... and it is an ancestor: the loop is cut here


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class ChangeOut(_Model):
    resource_type: str
    resource_id: str
    field: str
    before: JsonValue
    after: JsonValue


class CreationOut(_Model):
    resource_type: str
    values: dict[str, JsonValue]


class MoneyOut(_Model):
    direction: Literal["OUT", "IN"]
    amount: Decimal
    kind: str
    description: str


class EventOut(_Model):
    type: DomainEvent
    payload: dict[str, JsonValue]


class Reason(_Model):
    code: str
    message: str
    node_id: str | None = None
    details: dict[str, JsonValue] = {}


class NodeOut(_Model):
    id: str
    depth: int
    agent_id: str
    tool_id: str
    params: dict[str, JsonValue]
    parent_id: str | None
    trigger_type: TriggerType
    trigger_event: DomainEvent | None
    rule_id: str | None
    rule_version: int | None
    required: bool
    status: NodeStatus
    status_code: str | None = None
    status_message: str | None = None
    summary: str = ""
    reversibility: Reversibility
    customer_impact: ImpactLevel
    data_sensitivity: DataSensitivity
    changes: list[ChangeOut] = []
    creations: list[CreationOut] = []
    money: list[MoneyOut] = []
    events: list[EventOut] = []

    @property
    def rule_ref(self) -> str | None:
        return f"{self.rule_id}@{self.rule_version}" if self.rule_id else None


class EdgeOut(_Model):
    source: str
    target: str
    kind: EdgeKind
    event: DomainEvent | None
    rule_id: str | None
    rule_version: int | None


class BlastRadius(_Model):
    agents_affected: list[str]
    agent_count: int
    downstream_actions: int
    records_affected: list[str]
    record_count: int
    money_out: Decimal
    money_in: Decimal
    net_money_out: Decimal
    customer_impact: ImpactLevel
    data_sensitivity: DataSensitivity
    reversibility: Reversibility
    irreversible_nodes: list[str]
    blocked_nodes: list[str]
    would_fail_nodes: list[str]
    skipped_nodes: list[str]


class ReadOut(_Model):
    resource_type: str
    resource_id: str
    version: int


class ConsequenceReport(_Model):
    engine_version: str
    proposer_agent_id: str
    root_tool_id: str
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    blast_radius: BlastRadius
    fingerprint: str
    reads: list[ReadOut]
    execution_order: list[str]
    blocking: list[Reason]
    warnings: list[Reason]
    limit_reached: bool
    cycle_detected: bool

    @property
    def root(self) -> NodeOut:
        return self.nodes[0]

    @property
    def is_blocked(self) -> bool:
        return bool(self.blocking)

    def node(self, node_id: str) -> NodeOut:
        return next(n for n in self.nodes if n.id == node_id)

    def to_jsonable(self) -> dict[str, Any]:
        return self.model_dump(mode="json")

    def canonical_json(self) -> str:
        return json.dumps(
            self.to_jsonable(), sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
