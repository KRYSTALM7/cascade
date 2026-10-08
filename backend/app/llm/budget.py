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

from app.llm.provider import LLMProvider, Narrative
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

    def __init__(self, primary: LLMProvider, fallback: LLMProvider, budget: CallBudget) -> None:
        self.primary = primary
        self.fallback = fallback
        self.budget = budget

    @property
    def name(self) -> str:
        return _served_by.get() or self.primary.name

    def _pick(self) -> LLMProvider:
        provider = self.primary if self.budget.take() else self.fallback
        _served_by.set(provider.name)
        return provider

    def parse_intent(self, text: str, ctx: ParseContext) -> LLMIntent:
        return self._pick().parse_intent(text, ctx)

    def interpret_what_if(self, text: str, ctx: WhatIfContext) -> LLMIntent:
        return self._pick().interpret_what_if(text, ctx)

    def explain(self, facts: ExplainInput) -> Narrative:
        return self._pick().explain(facts)
