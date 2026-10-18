"""What-if: simulate an alternative under the same agent and compare deterministically.

The alternative is a real child action (parent_action_id = base), so it can itself be approved
and executed. Every number in the comparison is computed here; the LLM only narrates it.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select

from app.core.errors import CascadeError, ErrorCode
from app.domain.enums import ActionStatus, ActorType
from app.domain.tools.registry import SIMULATORS
from app.llm.guards import to_tool_call
from app.llm.provider import LLMOutputInvalidError, LLMUnavailableError
from app.llm.rules import RulesProvider
from app.llm.schemas import ExplainInput, WhatIfContext
from app.models import Action, InventoryItem, User
from app.repositories.world import load_catalog
from app.schemas.actions import ComparisonOut, DeltaOut, ExplanationOut, SideOut, WhatIfRequest
from app.services import audit
from app.services.actions import PROPOSERS, ActionService, permitted_tools
from app.services.context import ServiceContext, require_role
from app.services.outcomes import Outcome, load_outcome, narrative_json, simulate_and_persist


def side(action: Action, outcome: Outcome) -> SideOut:
    radius = outcome.report.blast_radius
    return SideOut(
        action_id=action.id,
        title=outcome.facts().title,
        money_out=radius.money_out,
        agents=radius.agents_affected,
        downstream_actions=radius.downstream_actions,
        records_affected=radius.record_count,
        risk_score=outcome.risk.score,
        risk_level=outcome.risk.level,
        reversibility=radius.reversibility,
        decision=outcome.decision.decision,
    )


def compare(base: SideOut, alt: SideOut) -> DeltaOut:
    return DeltaOut(
        money_out=alt.money_out - base.money_out,
        agents=len(alt.agents) - len(base.agents),
        downstream_actions=alt.downstream_actions - base.downstream_actions,
        records_affected=alt.records_affected - base.records_affected,
        risk_score=alt.risk_score - base.risk_score,
    )


class WhatIfService:
    def __init__(self, ctx: ServiceContext) -> None:
        self.ctx = ctx
        self.session = ctx.session
        self.actions = ActionService(ctx)

    def _alternative_call(
        self, user: User, base: Action, req: WhatIfRequest
    ) -> tuple[str, dict[str, Any], str]:
        if req.tool is not None:
            return req.tool, dict(req.parameters), "structured"
        assert req.text is not None and base.tool_id is not None
        catalog = load_catalog(self.session)
        ctx = WhatIfContext(
            agent_id=base.agent_id,
            base_tool=base.tool_id,
            base_params=dict(base.parameters),
            permitted_tools=permitted_tools(catalog, base.agent_id),
            catalog_tools=sorted(catalog.tools),
            products={i.sku: i.name for i in self.session.scalars(select(InventoryItem))},
        )
        try:
            call = to_tool_call(self.ctx.llm.interpret_what_if(req.text, ctx))
        except (LLMOutputInvalidError, LLMUnavailableError) as exc:
            raise self.actions.llm_failure(user, base.agent_id, req.text, exc) from None
        if call.tool_id is None or call.missing or call.ambiguities:
            raise CascadeError(
                ErrorCode.WHAT_IF_NEEDS_CLARIFICATION,
                "Describe the alternative more precisely, e.g. "
                "'What if we give 20% compensation instead?'.",
                http_status=422,
                details={
                    "intent": call.tool_id,
                    "missing": call.missing,
                    "ambiguities": call.ambiguities,
                },
            )
        return call.tool_id, call.params, self.ctx.llm.name

    def what_if(
        self, user: User, action_id: uuid.UUID, req: WhatIfRequest
    ) -> tuple[Action, ComparisonOut]:
        require_role(user, *PROPOSERS)
        base = self.actions.get(action_id)
        base_outcome = load_outcome(self.session, base)
        if base_outcome is None:
            raise CascadeError(
                ErrorCode.NOT_SIMULATED,
                "Simulate the action before comparing alternatives.",
                http_status=409,
                details={"action_id": str(base.id)},
            )
        tool_id, params, parser = self._alternative_call(user, base, req)
        if tool_id not in SIMULATORS:
            raise CascadeError(
                ErrorCode.VALIDATION_ERROR,
                f"Unknown tool '{tool_id}'.",
                http_status=422,
                details={"tool": tool_id},
            )
        alt = Action(
            proposed_by=user.id,
            agent_id=base.agent_id,  # same acting agent: a fair comparison
            tool_id=tool_id,
            parameters=params,
            raw_text=req.text,
            parser=parser,
            status=ActionStatus.PARSED,
            parent_action_id=base.id,
        )
        self.session.add(alt)
        self.session.flush()
        audit.record(
            self.session,
            "WHAT_IF_PROPOSED",
            action_id=alt.id,
            actor_type=ActorType.USER,
            actor_id=user.id,
            payload={
                "base_action_id": str(base.id),
                "text": req.text,
                "tool": tool_id,
                "parameters": params,
            },
        )
        alt_outcome = simulate_and_persist(self.ctx, alt, user.id)

        base_side, alt_side = side(base, base_outcome), side(alt, alt_outcome)
        # Alternative interpretation already used the request's one bounded LLM call. The
        # comparison narrative is deterministic and uses only the computed comparison facts.
        narrative = RulesProvider().explain(
            ExplainInput(
                kind="comparison", base=base_outcome.facts(), alternative=alt_outcome.facts()
            )
        )
        comparison = ComparisonOut(
            base=base_side,
            alternative=alt_side,
            delta=compare(base_side, alt_side),
            lower_risk=alt_side.risk_score < base_side.risk_score,
            explanation=ExplanationOut(**narrative_json(narrative)),
        )
        audit.record(
            self.session,
            "WHAT_IF_COMPARED",
            action_id=base.id,
            actor_type=ActorType.SYSTEM,
            actor_id=user.id,
            payload={
                "alternative_action_id": str(alt.id),
                "delta": comparison.delta.model_dump(mode="json"),
                "narrative_source": narrative.source,
            },
        )
        self.session.commit()
        return alt, comparison
