"""Structured shapes exchanged with LLM providers. Everything an LLM returns is UNTRUSTED input:
it is validated against these models, then re-validated by the backend (llm/guards.py)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

UNKNOWN_INTENT = "unknown"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LLMParameters(_Strict):
    """Flat on purpose (simple JSON schema for Gemini). Amounts are STRINGS: no float drift."""

    order_id: str | None = None
    payment_id: str | None = None
    customer_id: str | None = None
    customer_name: str | None = None  # not a tool param: drives clarification
    amount: str | None = None
    percentage: str | None = None
    sku: str | None = None
    quantity: int | None = None
    status: str | None = None
    template: str | None = None
    channel: str | None = None
    reason: str | None = None


class LLMIntent(_Strict):
    intent: Annotated[str, Field(max_length=64)]  # a tool id, or "unknown"
    parameters: LLMParameters = LLMParameters()
    ambiguities: list[str] = []
    confidence: Annotated[float, Field(ge=0, le=1)] = 0.5


class Explanation(_Strict):
    summary: Annotated[str, Field(max_length=800)]
    bullets: Annotated[list[Annotated[str, Field(max_length=300)]], Field(max_length=8)] = []


class ParseContext(_Strict):
    agent_id: str
    permitted_tools: list[str]
    catalog_tools: list[str]
    products: dict[str, str]  # sku -> product name (lets "the watch" resolve to a SKU)


class WhatIfContext(_Strict):
    agent_id: str
    base_tool: str
    base_params: dict[str, object]
    permitted_tools: list[str]
    catalog_tools: list[str]
    products: dict[str, str]


class StepFact(_Strict):
    agent_id: str
    tool_id: str
    status: str
    summary: str


class OutcomeFacts(_Strict):
    """Everything an explanation may talk about — and the only numbers it may cite."""

    title: str
    decision: Literal["AUTO_APPROVED", "APPROVAL_REQUIRED", "BLOCKED"]
    risk_score: int
    risk_level: str
    money_out: str
    agents: list[str]
    downstream_actions: int
    reversibility: str
    reasons: list[str]
    steps: list[StepFact]


class ExplainInput(_Strict):
    kind: Literal["action", "comparison"]
    base: OutcomeFacts
    alternative: OutcomeFacts | None = None
