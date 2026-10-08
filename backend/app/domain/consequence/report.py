"""ConsequenceReport: the immutable, canonical output of a simulation (persisted as JSONB)."""

from __future__ import annotations

import json
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, JsonValue

from app.domain.enums import (
    ConditionKey,
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


class AuthorizationOut(_Model):
    """The independent authorization check for ONE node. A downstream agent never inherits the
    proposer's permission: its own agent/tool/permission rows are checked."""

    granted: bool
    code: str | None = None  # denial code, e.g. DOWNSTREAM_NOT_PERMITTED
    message: str


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
    # Why this agent acted: the rule's condition and declared purpose (None for the root).
    trigger_condition: ConditionKey | None = None
    trigger_reason: str | None = None
    # None = not evaluated (node beyond the cascade limits).
    authorization: AuthorizationOut | None = None
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
    # Distinct kinds of record the cascade writes (order, payment, refund, notification, ...).
    systems_affected: list[str] = []
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


class RuleVersionOut(_Model):
    """A reaction rule the traversal consulted (fired or not), with a digest of its definition."""

    id: str
    version: int
    enabled: bool
    digest: str


class ConfigOut(_Model):
    """Configuration the simulation depended on. Execution recomputes it and refuses to apply an
    approval whose rules or agent/tool/permission configuration changed underneath it."""

    reaction_rules: list[RuleVersionOut]
    rules_fingerprint: str
    catalog_fingerprint: str  # agents, tools and permissions the authorization checks read


class ConsequenceReport(_Model):
    engine_version: str
    proposer_agent_id: str
    root_tool_id: str
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    blast_radius: BlastRadius
    # The proposed action ALONE (root node only): what a per-tool permission check would see.
    direct_effect: BlastRadius | None = None
    fingerprint: str
    reads: list[ReadOut]
    config: ConfigOut | None = None
    execution_order: list[str]
    blocking: list[Reason]
    warnings: list[Reason]
    limit_reached: bool
    cycle_detected: bool

    @property
    def root(self) -> NodeOut:
        return self.nodes[0]

    def direct_view(self) -> ConsequenceReport:
        """This report reduced to the root action, as if no agent reacted. Used to show how the
        proposal looks in isolation; never used to decide."""
        root = self.root
        return self.model_copy(
            update={
                "nodes": [root],
                "edges": [],
                "blast_radius": self.direct_effect or self.blast_radius,
                "direct_effect": None,
                "execution_order": [root.id] if root.status is NodeStatus.WILL_EXECUTE else [],
                "blocking": [b for b in self.blocking if b.node_id == root.id],
                "warnings": [],
                "limit_reached": False,
                "cycle_detected": False,
            }
        )

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
