"""A per-process cap on Gemini requests, so a public demo cannot run up unlimited API cost.

Within each window at most `limit` requests go to Gemini; the rest are answered by the
deterministic rules provider (same validation downstream, so nothing about the decision
changes). No shared infrastructure: the cap is per instance, so the deployment's worst case is
limit x max instances per window.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from contextvars import ContextVar

from app.llm.guards import to_tool_call
from app.llm.provider import LLMOutputInvalidError, LLMProvider, LLMUnavailableError, Narrative
from app.llm.schemas import ExplainInput, LLMIntent, ParseContext, WhatIfContext

logger = logging.getLogger(__name__)

# Which provider answered the current request's last LLM call. Request-scoped (each request runs
# in its own context), so `name` - recorded as the action's parser / audit actor - is accurate.
_served_by: ContextVar[str | None] = ContextVar("llm_served_by", default=None)


class CallBudget:
    """At most `limit` takes per `window_seconds` (fixed window). Thread-safe."""

    def __init__(
        self, limit: int, window_seconds: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._window_start = clock()
        self._used = 0
        self._warned = False

    def take(self) -> bool:
        with self._lock:
            now = self._clock()
            if now - self._window_start >= self.window_seconds:
                self._window_start, self._used, self._warned = now, 0, False
            if self._used < self.limit:
                self._used += 1
                return True
            if not self._warned:
                self._warned = True
                logger.warning(
                    "llm_budget_exhausted",
                    extra={"limit": self.limit, "window_seconds": self.window_seconds},
                )
            return False

    @property
    def used(self) -> int:
        with self._lock:
            return self._used


class BudgetedProvider:
    """Gemini while the budget lasts, the deterministic rules provider after that."""

    def __init__(
        self,
        primary: LLMProvider,
        fallback: LLMProvider,
        budget: CallBudget,
        cooldown_seconds: float = 30.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.primary = primary
        self.fallback = fallback
        self.budget = budget
        self.cooldown_seconds = cooldown_seconds
        self._clock = clock
        self._primary_unavailable_until = 0.0
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return _served_by.get() or self.primary.name

    def _pick(self) -> LLMProvider:
        with self._lock:
            cooling_down = self._clock() < self._primary_unavailable_until
        provider = self.primary if not cooling_down and self.budget.take() else self.fallback
        _served_by.set(provider.name)
        return provider

    def _call(self, method: str, *args: object) -> object:
        provider = self._pick()
        if provider is self.fallback:
            return getattr(provider, method)(*args)
        try:
            result = getattr(provider, method)(*args)
            if method in {"parse_intent", "interpret_what_if"}:
                context = args[-1]
                call = to_tool_call(result)  # type: ignore[arg-type]
                if call.tool_id is None:
                    raise LLMOutputInvalidError("The model could not resolve a tool from the request")
                if call.tool_id not in context.permitted_tools:  # type: ignore[union-attr]
                    raise LLMOutputInvalidError("The model selected a tool unavailable to this agent")
        except (LLMUnavailableError, LLMOutputInvalidError):
            # The deterministic provider is safe here: its output still passes the same schemas,
            # allowlist and backend validation as AI output. A cooldown prevents hot-looping on a
            # broken provider; after it expires, one request probes recovery.
            with self._lock:
                self._primary_unavailable_until = self._clock() + self.cooldown_seconds
            _served_by.set(self.fallback.name)
            logger.warning("llm_provider_fallback", extra={"provider": self.primary.name})
            return getattr(self.fallback, method)(*args)
        with self._lock:
            self._primary_unavailable_until = 0.0
        return result

    def parse_intent(self, text: str, ctx: ParseContext) -> LLMIntent:
        return self._call("parse_intent", text, ctx)  # type: ignore[return-value]

    def interpret_what_if(self, text: str, ctx: WhatIfContext) -> LLMIntent:
        return self._call("interpret_what_if", text, ctx)  # type: ignore[return-value]

    def explain(self, facts: ExplainInput) -> Narrative:
        return self._call("explain", facts)  # type: ignore[return-value]
