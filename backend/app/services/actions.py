"""Action use cases: parse (NL) -> clarify -> simulate (score, decide, persist, audit)."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.errors import CascadeError, ErrorCode
from app.domain.catalog import Catalog
from app.domain.enums import ActionStatus, ActorType, UserRole
from app.domain.tools.base import canonical_json
from app.domain.tools.registry import SIMULATORS
from app.domain.validation.clarification import Resolution, resolve
from app.llm.guards import ToolCall, injection_markers, to_tool_call
from app.llm.provider import LLMOutputInvalidError, LLMUnavailableError
from app.llm.schemas import LLMIntent, ParseContext
from app.models import Action, InventoryItem, User
from app.repositories.world import load_catalog
from app.schemas.actions import ParseRequest, SimulateRequest
from app.services import audit
from app.services.context import ServiceContext, require_role
from app.services.directory import DbDirectory
from app.services.outcomes import simulate_and_persist
from app.services.transitions import transition

PROPOSERS = (UserRole.OPERATOR, UserRole.APPROVER)


def permitted_tools(catalog: Catalog, agent_id: str) -> list[str]:
    return sorted(tool for (agent, tool) in catalog.permissions if agent == agent_id)


class ActionService:
    def __init__(self, ctx: ServiceContext) -> None:
        self.ctx = ctx
        self.session = ctx.session

    # -- lookup ---------------------------------------------------------------------------------

    def get(self, action_id: uuid.UUID, *, lock: bool = False) -> Action:
        stmt = select(Action).where(Action.id == action_id)
        if lock:
            # Locked reads must see the committed row, never a stale identity-map copy.
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        action = self.session.scalars(stmt).one_or_none()
        if action is None:
            raise CascadeError(
                ErrorCode.ACTION_NOT_FOUND,
                f"Action {action_id} does not exist.",
                http_status=404,
                details={"action_id": str(action_id)},
            )
        return action

    def recent(self, limit: int = 50) -> Sequence[Action]:
        stmt = select(Action).order_by(Action.created_at.desc(), Action.id).limit(limit)
        return self.session.scalars(stmt).all()

    def _by_key(self, key: str | None) -> Action | None:
        if key is None:
            return None
        return self.session.scalars(select(Action).where(Action.idempotency_key == key)).first()

    def _reused_key(self, key: str) -> CascadeError:
        return CascadeError(
            ErrorCode.IDEMPOTENCY_KEY_REUSED,
            "This idempotency key was already used for a different proposal.",
            http_status=409,
            details={"idempotency_key": key},
        )

    def _insert(self, action: Action) -> Action:
        """Insert; if a concurrent request took the same idempotency key, return theirs."""
        self.session.add(action)
        try:
            self.session.flush()
        except IntegrityError:
            self.session.rollback()
            existing = self._by_key(action.idempotency_key)
            if existing is None:
                raise
            return existing
        return action

    # -- parse ----------------------------------------------------------------------------------

    def _parse_context(self, agent_id: str) -> ParseContext:
        catalog = load_catalog(self.session)
        return ParseContext(
            agent_id=agent_id,
            permitted_tools=permitted_tools(catalog, agent_id),
            catalog_tools=sorted(catalog.tools),
            products={i.sku: i.name for i in self.session.scalars(select(InventoryItem))},
        )

    def llm_failure(
        self, user: User, agent_id: str, text: str, exc: LLMOutputInvalidError | LLMUnavailableError
    ) -> CascadeError:
        """Nothing is created beyond the audit record."""
        audit.record(
            self.session,
            exc.code,
            action_id=None,
            actor_type=ActorType.LLM,
            actor_id=self.ctx.llm.name,
            payload={"agent_id": agent_id, "text": text, "error": str(exc), "user": user.id},
        )
        self.session.commit()
        if isinstance(exc, LLMUnavailableError):
            return CascadeError(
                ErrorCode.LLM_UNAVAILABLE,
                "The language model is unavailable. Use the structured form instead.",
                http_status=503,
            )
        return CascadeError(
            ErrorCode.LLM_OUTPUT_INVALID,
            "The request could not be interpreted safely. Rephrase it or use the structured form.",
            http_status=422,
            details={"reason": str(exc)},
        )

    def parse(self, user: User, req: ParseRequest) -> Action:
        require_role(user, *PROPOSERS)
        existing = self._by_key(req.idempotency_key)
        if existing is not None:
            if (existing.agent_id, existing.raw_text) != (req.agent_id, req.text):
                raise self._reused_key(existing.idempotency_key or "")
            return existing

        ctx = self._parse_context(req.agent_id)
        markers = injection_markers(req.text)
        try:
            intent = self.ctx.llm.parse_intent(req.text, ctx)
            call = to_tool_call(intent)
        except (LLMOutputInvalidError, LLMUnavailableError) as exc:
            raise self.llm_failure(user, req.agent_id, req.text, exc) from None

        resolution = self._resolve(call, ctx.permitted_tools)
        action = self._insert(
            Action(
                idempotency_key=req.idempotency_key,
                proposed_by=user.id,
                agent_id=req.agent_id,  # identity from the request, never from the text
                tool_id=call.tool_id,
                parameters=resolution.params,
                raw_text=req.text,
                interpretation=self._interpretation(intent, call, markers),
                parser=self.ctx.llm.name,
                status=ActionStatus.PARSED,
            )
        )
        if action.raw_text != req.text or action.status is not ActionStatus.PARSED:
            return action  # lost an idempotency race: the other request's action
        audit.record(
            self.session,
            "ACTION_PARSED",
            action_id=action.id,
            actor_type=ActorType.USER,
            actor_id=user.id,
            payload={
                "agent_id": action.agent_id,
                "text": req.text,
                "parser": self.ctx.llm.name,
                "interpretation": action.interpretation,
            },
        )
        if markers:
            audit.record(
                self.session,
                "INJECTION_SUSPECTED",
                action_id=action.id,
                actor_type=ActorType.SYSTEM,
                actor_id=None,
                payload={"markers": markers, "agent_id": req.agent_id},
            )
        self._apply_resolution(action, resolution, user)
        self.session.commit()
        return action

    @staticmethod
    def _interpretation(intent: LLMIntent, call: ToolCall, markers: list[str]) -> dict[str, Any]:
        return {
            "llm": intent.model_dump(mode="json"),
            "customer_name": call.customer_name,
            "missing": call.missing,
            "injection_markers": markers,
        }

    def _resolve(
        self, call: ToolCall, permitted: list[str], chosen_customer_id: str | None = None
    ) -> Resolution:
        return resolve(
            tool_id=call.tool_id,
            params=call.params,
            missing=call.missing,
            customer_name=call.customer_name,
            ambiguities=call.ambiguities,
            directory=DbDirectory(self.session),
            permitted_tools=permitted,
            chosen_customer_id=chosen_customer_id,
        )

    def _apply_resolution(self, action: Action, resolution: Resolution, user: User) -> None:
        action.parameters = resolution.params
        if resolution.clarification is None:
            action.clarification = None
            if action.status is ActionStatus.NEEDS_CLARIFICATION:
                transition(action, ActionStatus.PARSED)
            return
        action.clarification = resolution.clarification.model_dump(mode="json")
        transition(action, ActionStatus.NEEDS_CLARIFICATION)
        audit.record(
            self.session,
            "CLARIFICATION_REQUESTED",
            action_id=action.id,
            actor_type=ActorType.SYSTEM,
            actor_id=None,
            payload=action.clarification,
        )

    # -- clarify --------------------------------------------------------------------------------

    def clarify(self, user: User, action_id: uuid.UUID, answers: dict[str, Any]) -> Action:
        require_role(user, *PROPOSERS)
        action = self.get(action_id, lock=True)
        if action.status is not ActionStatus.NEEDS_CLARIFICATION:
            raise CascadeError(
                ErrorCode.ILLEGAL_TRANSITION,
                f"Action is {action.status}; nothing to clarify.",
                http_status=409,
                details={"status": action.status.value},
            )
        answers = dict(answers)
        tool_id = answers.pop("intent", None) or action.tool_id
        if not isinstance(tool_id, str) or tool_id not in SIMULATORS:
            raise CascadeError(
                ErrorCode.INVALID_CLARIFICATION,
                "Choose an action (intent) the catalog knows.",
                http_status=400,
                details={"intent": tool_id},
            )
        fields = SIMULATORS[tool_id].params_model.model_fields
        chosen_customer = answers.pop("customer_id", None) if "customer_id" not in fields else None
        unknown = sorted(set(answers) - set(fields))
        if unknown:
            raise CascadeError(
                ErrorCode.INVALID_CLARIFICATION,
                f"{tool_id} does not take {', '.join(unknown)}.",
                http_status=400,
                details={"unknown": unknown},
            )
        params = {**action.parameters, **answers}
        interpretation = action.interpretation or {}
        call = ToolCall(
            tool_id=tool_id,
            params=params,
            missing=[n for n, f in fields.items() if f.is_required() and n not in params],
            customer_name=None if chosen_customer else interpretation.get("customer_name"),
        )
        catalog = load_catalog(self.session)
        resolution = self._resolve(
            call,
            permitted_tools(catalog, action.agent_id),
            chosen_customer_id=chosen_customer if isinstance(chosen_customer, str) else None,
        )
        action.tool_id = tool_id
        audit.record(
            self.session,
            "CLARIFIED",
            action_id=action.id,
            actor_type=ActorType.USER,
            actor_id=user.id,
            payload={
                "answers": {
                    **answers,
                    **({"customer_id": chosen_customer} if chosen_customer else {}),
                }
            },
        )
        self._apply_resolution(action, resolution, user)
        self.session.commit()
        return action

    # -- simulate -------------------------------------------------------------------------------

    def simulate(self, user: User, req: SimulateRequest) -> Action:
        require_role(user, *PROPOSERS)
        if req.action_id is not None:
            return self._simulate_existing(user, req.action_id)
        assert req.agent_id is not None and req.tool is not None
        existing = self._by_key(req.idempotency_key)
        if existing is not None:
            same = (existing.agent_id, existing.tool_id, canonical_json(existing.parameters)) == (
                req.agent_id,
                req.tool,
                canonical_json(req.parameters),
            )
            if not same:
                raise self._reused_key(existing.idempotency_key or "")
            return existing
        action = self._insert(
            Action(
                idempotency_key=req.idempotency_key,
                proposed_by=user.id,
                agent_id=req.agent_id,
                tool_id=req.tool,
                parameters=dict(req.parameters),
                parser="structured",
                status=ActionStatus.PARSED,
            )
        )
        if action.status is not ActionStatus.PARSED:
            return action
        audit.record(
            self.session,
            "ACTION_PROPOSED",
            action_id=action.id,
            actor_type=ActorType.USER,
            actor_id=user.id,
            payload={"agent_id": req.agent_id, "tool": req.tool, "parameters": req.parameters},
        )
        simulate_and_persist(self.ctx, action, user.id)
        self.session.commit()
        return action

    def _simulate_existing(self, user: User, action_id: uuid.UUID) -> Action:
        action = self.get(action_id, lock=True)
        if action.status is ActionStatus.NEEDS_CLARIFICATION:
            raise CascadeError(
                ErrorCode.ACTION_NEEDS_CLARIFICATION,
                "Answer the clarification question before simulating.",
                http_status=409,
                details={"clarification": action.clarification},
            )
        if action.status not in (ActionStatus.PARSED, ActionStatus.STALE):
            return action  # already simulated: idempotent
        simulate_and_persist(self.ctx, action, user.id)
        self.session.commit()
        return action
