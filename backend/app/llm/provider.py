"""LLM provider protocol. Providers parse and narrate; they never decide anything."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

from app.llm.schemas import ExplainInput, Explanation, LLMIntent, ParseContext, WhatIfContext


class LLMError(Exception):
    code = "LLM_ERROR"


class LLMOutputInvalidError(LLMError):
    """Malformed / schema-violating / out-of-allowlist output. Never retried."""

    code = "LLM_OUTPUT_INVALID"


class LLMUnavailableError(LLMError):
    """Timeout, 5xx or 429 after the single allowed retry."""

    code = "LLM_UNAVAILABLE"


@dataclass(frozen=True)
class Narrative:
    explanation: Explanation
    source: Literal["gemini", "rules", "template_fallback"]
    rejected_figures: list[str] = field(default_factory=list)


class LLMProvider(Protocol):
    @property
    def name(self) -> str: ...

    def parse_intent(self, text: str, ctx: ParseContext) -> LLMIntent: ...

    def interpret_what_if(self, text: str, ctx: WhatIfContext) -> LLMIntent: ...

    def explain(self, facts: ExplainInput) -> Narrative: ...
