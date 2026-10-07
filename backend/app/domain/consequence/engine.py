"""Deterministic consequence engine (blueprint §H).

BFS over: node executes (simulated) -> emits domain events -> every enabled reaction rule
subscribed to the event, in (priority, rule id) order, whose condition holds -> child node owned
by the rule's agent. Authorization is checked on EVERY node. Nothing here touches the database.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.domain.catalog import Catalog, ReactionDef
from app.domain.consequence.conditions import CONDITIONS, ConditionConfigError
from app.domain.consequence.graph import execution_order
from app.domain.consequence.report import (
    ENGINE_VERSION,
    BlastRadius,
    ChangeOut,
    ConsequenceReport,
    CreationOut,
    EdgeKind,
    EdgeOut,
    EventOut,
    MoneyOut,
    NodeOut,
    NodeStatus,
    ReadOut,
    Reason,
)
from app.domain.enums import (
    DataSensitivity,
    DomainEvent,
    ImpactLevel,
    Reversibility,
    TriggerType,
)
from app.domain.money import ZERO
from app.domain.state import SimState, WorldSnapshot, to_jsonable
from app.domain.tools.base import (
    ParamValidationError,
    PreconditionFailedError,
    ToolEffect,
    canonical_json,
)
from app.domain.tools.registry import SIMULATORS

EVENT_REF = "$event."

IMPACT_ORDER = list(ImpactLevel)
SENSITIVITY_ORDER = list(DataSensitivity)


@dataclass(frozen=True)
class CascadeLimits:
    """From policy.yaml (`cascade.max_depth`, `cascade.max_nodes`)."""

    max_depth: int
    max_nodes: int


class ParamMappingError(ValueError):
    pass


def resolve_params(mapping: Mapping[str, Any], payload: Mapping[str, Any]) -> dict[str, Any]:
    """`"$event.<field>"` is looked up in the event payload; anything else is a literal.
    No expressions, no nesting, no other references — ever."""
    resolved: dict[str, Any] = {}
    for name, value in mapping.items():
        if isinstance(value, str) and value.startswith("$"):
            if not value.startswith(EVENT_REF):
                raise ParamMappingError(f"{name}: only $event.<field> references are allowed")
            ref = value[len(EVENT_REF) :]
            if ref not in payload:
                raise ParamMappingError(f"{name}: event has no field {ref!r}")
            resolved[name] = payload[ref]
        else:
            resolved[name] = value
    return resolved


@dataclass
class _Pending:
    agent_id: str
    tool_id: str
    params: dict[str, Any]
    depth: int
    parent_id: str | None = None
    event: DomainEvent | None = None
    rule: ReactionDef | None = None
    error: tuple[str, str] | None = None  # (code, message) known before simulation

    @property
    def is_root(self) -> bool:
        return self.parent_id is None

    @property
    def required(self) -> bool:
        return True if self.rule is None else self.rule.required


@dataclass
class _Outcome:
    status: NodeStatus
    code: str | None = None
    message: str | None = None
    effect: ToolEffect = field(default_factory=ToolEffect)


def _authorize(catalog: Catalog, p: _Pending, now: datetime) -> tuple[str, str] | None:
    """Hard authorization for one node. Downstream codes are distinct so the UI can say WHERE."""
    pre = "" if p.is_root else "DOWNSTREAM_"
    agent = catalog.agents.get(p.agent_id)
    if agent is None:
        return ("AGENT_UNKNOWN", f"Agent '{p.agent_id}' does not exist.")
    if not agent.enabled:
        return (f"{pre}AGENT_DISABLED", f"Agent {agent.id} is disabled.")
    tool = catalog.tools.get(p.tool_id)
    if tool is None or p.tool_id not in SIMULATORS:
        return ("TOOL_UNKNOWN", f"Tool '{p.tool_id}' does not exist.")
    if not tool.enabled:
        return (f"{pre}TOOL_DISABLED", f"Tool {tool.id} is disabled.")
    permission = catalog.permissions.get((agent.id, tool.id))
    if permission is None:
        code = "TOOL_NOT_PERMITTED" if p.is_root else "DOWNSTREAM_NOT_PERMITTED"
        return (code, f"Agent {agent.id} is not permitted to call {tool.id}.")
    if permission.expires_at is not None and permission.expires_at <= now:
        return (
            f"{pre}PERMISSION_EXPIRED",
            f"Agent {agent.id}'s permission for {tool.id} expired at "
            f"{permission.expires_at.isoformat()}.",
        )
    return None


def _run(catalog: Catalog, p: _Pending, state: SimState, now: datetime) -> _Outcome:
    denied = _authorize(catalog, p, now)
    if denied:
        return _Outcome(NodeStatus.BLOCKED, *denied)
    if p.error:
        return _Outcome(NodeStatus.WOULD_FAIL, *p.error)
    simulator = SIMULATORS[p.tool_id]
    try:
        effect = simulator.simulate(p.params, state)
    except ParamValidationError as exc:
        # A proposer sending bad params is refused outright; a rule producing bad params is a
        # downstream failure of that node.
        status = NodeStatus.BLOCKED if p.is_root else NodeStatus.WOULD_FAIL
        code = exc.kind.value if p.is_root else "INVALID_PARAMETERS"
        return _Outcome(status, code, exc.message)
    except PreconditionFailedError as exc:
        return _Outcome(NodeStatus.WOULD_FAIL, exc.code, exc.message)
    state.apply(effect.changes)
    return _Outcome(NodeStatus.WILL_EXECUTE, effect=effect)


def _is_ancestor(candidate: str, node: str | None, parents: Mapping[str, str | None]) -> bool:
    while node is not None:
        if node == candidate:
            return True
        node = parents[node]
    return False


def _children(
    catalog: Catalog, parent_id: str, depth: int, effect: ToolEffect, state: SimState
) -> list[_Pending]:
    children: list[_Pending] = []
    for event in effect.events:
        for rule in catalog.reactions_for(event.type):
            if not rule.enabled:
                continue
            child = _Pending(
                agent_id=rule.agent_id,
                tool_id=rule.tool_id,
                params={},
                depth=depth + 1,
                parent_id=parent_id,
                event=event.type,
                rule=rule,
            )
            try:
                if not CONDITIONS[rule.condition_key](event, rule.condition_params, state):
                    continue
                child.params = resolve_params(rule.param_mapping, event.payload)
            except ConditionConfigError as exc:
                child.error = ("RULE_MISCONFIGURED", f"Rule {rule.id}: {exc}")
            except ParamMappingError as exc:
                child.error = ("PARAM_MAPPING_INVALID", f"Rule {rule.id}: {exc}")
            children.append(child)
    return children


def _node(node_id: str, p: _Pending, outcome: _Outcome, catalog: Catalog) -> NodeOut:
    tool = catalog.tools.get(p.tool_id)
    effect = outcome.effect
    return NodeOut(
        id=node_id,
        depth=p.depth,
        agent_id=p.agent_id,
        tool_id=p.tool_id,
        params=to_jsonable(p.params),
        parent_id=p.parent_id,
        trigger_type=TriggerType.ROOT if p.is_root else TriggerType.AGENT_REACTION,
        trigger_event=p.event,
        rule_id=p.rule.id if p.rule else None,
        rule_version=p.rule.version if p.rule else None,
        required=p.required,
        status=outcome.status,
        status_code=outcome.code,
        status_message=outcome.message,
        summary=effect.summary,
        reversibility=effect.reversibility or (tool.reversibility if tool else Reversibility.NONE),
        customer_impact=effect.customer_impact
        or (tool.customer_impact if tool else ImpactLevel.NONE),
        data_sensitivity=effect.data_sensitivity
        or (tool.data_sensitivity if tool else DataSensitivity.NONE),
        changes=[
            ChangeOut(
                resource_type=c.resource_type,
                resource_id=c.resource_id,
                field=c.field,
                before=to_jsonable(c.before),
                after=to_jsonable(c.after),
            )
            for c in effect.changes
        ],
        creations=[
            CreationOut(resource_type=c.resource_type, values=to_jsonable(dict(c.values)))
            for c in effect.creations
        ],
        money=[
            MoneyOut(direction=m.direction, amount=m.amount, kind=m.kind, description=m.description)
            for m in effect.money
        ],
        events=[EventOut(type=e.type, payload=dict(e.payload)) for e in effect.events],
    )


def _aggregate_reversibility(values: list[Reversibility]) -> Reversibility:
    if not values or all(v is Reversibility.FULL for v in values):
        return Reversibility.FULL
    if all(v is Reversibility.NONE for v in values):
        return Reversibility.NONE
    return Reversibility.PARTIAL


def _blast_radius(nodes: list[NodeOut], proposer: str) -> BlastRadius:
    executing = [n for n in nodes if n.status is NodeStatus.WILL_EXECUTE]
    downstream = [n for n in executing if n.trigger_type is TriggerType.AGENT_REACTION]
    agents = sorted({n.agent_id for n in downstream} - {proposer})
    records: list[str] = []
    for n in executing:
        for c in n.changes:
            key = f"{c.resource_type}:{c.resource_id}"
            if key not in records:
                records.append(key)
        records += [f"{c.resource_type}:new@{n.id}#{i}" for i, c in enumerate(n.creations)]
    money_out = sum((m.amount for n in executing for m in n.money if m.direction == "OUT"), ZERO)
    money_in = sum((m.amount for n in executing for m in n.money if m.direction == "IN"), ZERO)
    return BlastRadius(
        agents_affected=agents,
        agent_count=len(agents),
        downstream_actions=len(downstream),
        records_affected=records,
        record_count=len(records),
        money_out=money_out,
        money_in=money_in,
        net_money_out=money_out - money_in,
        customer_impact=max(
            (n.customer_impact for n in executing),
            key=IMPACT_ORDER.index,
            default=ImpactLevel.NONE,
        ),
        data_sensitivity=max(
            (n.data_sensitivity for n in executing),
            key=SENSITIVITY_ORDER.index,
            default=DataSensitivity.NONE,
        ),
        reversibility=_aggregate_reversibility([n.reversibility for n in executing]),
        irreversible_nodes=[n.id for n in executing if n.reversibility is Reversibility.NONE],
        blocked_nodes=[n.id for n in nodes if n.status is NodeStatus.BLOCKED],
        would_fail_nodes=[n.id for n in nodes if n.status is NodeStatus.WOULD_FAIL],
        skipped_nodes=[n.id for n in nodes if n.status is NodeStatus.SKIPPED_LIMIT],
    )


def simulate_action(
    *,
    snapshot: WorldSnapshot,
    catalog: Catalog,
    agent_id: str,
    tool_id: str,
    params: Mapping[str, Any],
    now: datetime,
    limits: CascadeLimits,
) -> ConsequenceReport:
    state = SimState(snapshot)
    queue: deque[_Pending] = deque([_Pending(agent_id, tool_id, dict(params), depth=0)])
    seen: dict[str, str] = {}
    parents: dict[str, str | None] = {}
    nodes: list[NodeOut] = []
    edges: list[EdgeOut] = []
    blocking: list[Reason] = []
    warnings: list[Reason] = []
    processed = 0
    limit_reached = cycle_detected = False

    while queue:
        p = queue.popleft()
        key = f"{p.agent_id}|{p.tool_id}|{canonical_json(p.params)}"
        rule_id = p.rule.id if p.rule else None
        rule_version = p.rule.version if p.rule else None

        if p.parent_id is not None and p.error is None and key in seen:
            target = seen[key]
            is_cycle = _is_ancestor(target, p.parent_id, parents)
            edges.append(
                EdgeOut(
                    source=p.parent_id,
                    target=target,
                    kind=EdgeKind.CYCLE if is_cycle else EdgeKind.DUPLICATE,
                    event=p.event,
                    rule_id=rule_id,
                    rule_version=rule_version,
                )
            )
            if is_cycle and not cycle_detected:
                cycle_detected = True
                warnings.append(
                    Reason(
                        code="CYCLE_DETECTED",
                        message=f"Rule {rule_id} would call {p.tool_id} again; loop cut.",
                        node_id=target,
                    )
                )
            continue

        node_id = f"n{len(nodes)}"
        if p.parent_id is not None:
            edges.append(
                EdgeOut(
                    source=p.parent_id,
                    target=node_id,
                    kind=EdgeKind.TRIGGER,
                    event=p.event,
                    rule_id=rule_id,
                    rule_version=rule_version,
                )
            )

        if p.depth > limits.max_depth or processed >= limits.max_nodes:
            nodes.append(_node(node_id, p, _Outcome(NodeStatus.SKIPPED_LIMIT), catalog))
            if not limit_reached:
                limit_reached = True
                warnings.append(
                    Reason(
                        code="CASCADE_LIMIT_REACHED",
                        message=(
                            f"Cascade exceeds max depth {limits.max_depth} or "
                            f"{limits.max_nodes} nodes; the rest was not explored."
                        ),
                        node_id=node_id,
                    )
                )
            continue

        processed += 1
        seen.setdefault(key, node_id)
        parents[node_id] = p.parent_id
        outcome = _run(catalog, p, state, now)
        node = _node(node_id, p, outcome, catalog)
        nodes.append(node)

        if outcome.status is NodeStatus.WILL_EXECUTE:
            queue.extend(_children(catalog, node_id, p.depth, outcome.effect, state))
            continue

        assert outcome.code is not None and outcome.message is not None
        details: dict[str, Any] = {"agent_id": p.agent_id, "tool_id": p.tool_id}
        if rule_id:
            details["rule"] = node.rule_ref
        if p.is_root:
            blocking.append(
                Reason(code=outcome.code, message=outcome.message, node_id=node_id, details=details)
            )
        elif p.required:
            code = outcome.code
            if outcome.status is NodeStatus.WOULD_FAIL:
                details["cause"] = outcome.code
                code = "REQUIRED_REACTION_WOULD_FAIL"
            blocking.append(
                Reason(code=code, message=outcome.message, node_id=node_id, details=details)
            )
        else:
            warnings.append(
                Reason(code=outcome.code, message=outcome.message, node_id=node_id, details=details)
            )

    return ConsequenceReport(
        engine_version=ENGINE_VERSION,
        proposer_agent_id=agent_id,
        root_tool_id=tool_id,
        nodes=nodes,
        edges=edges,
        blast_radius=_blast_radius(nodes, agent_id),
        fingerprint=state.fingerprint(),
        reads=[
            ReadOut(resource_type=r.resource_type, resource_id=r.resource_id, version=r.version)
            for r in state.read_versions()
        ],
        execution_order=execution_order(nodes, edges),
        blocking=blocking,
        warnings=warnings,
        limit_reached=limit_reached,
        cycle_detected=cycle_detected,
    )
