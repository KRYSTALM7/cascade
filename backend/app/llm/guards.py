"""Validation of untrusted LLM output (blueprint §I). Fail closed at every step.

Pipeline: raw JSON -> `LLMIntent` schema -> intent is a real catalog tool -> parameters are a
subset of that tool's parameter model -> (services) entities exist + clarification rules ->
(engine) permission + full param validation. Authorization is never decided here: a real tool the
agent may not call becomes an action that the engine BLOCKs as TOOL_NOT_PERMITTED, so the attempt
is visible in the audit trail.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from pydantic import ValidationError

from app.domain.tools.registry import SIMULATORS
from app.llm.provider import LLMOutputInvalidError
from app.llm.schemas import UNKNOWN_INTENT, ExplainInput, Explanation, LLMIntent

# --- 1. schema ----------------------------------------------------------------------------------


def parse_llm_json(raw: str) -> LLMIntent:
    """SEC-05: malformed JSON or schema violations are rejected (and never retried)."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise LLMOutputInvalidError(f"LLM output is not JSON: {exc}") from None
    try:
        return LLMIntent.model_validate(data)
    except ValidationError as exc:
        raise LLMOutputInvalidError(
            f"LLM output violates the schema: {exc.error_count()} error(s)"
        ) from None


# --- 2/3. allowlist + parameter shape ------------------------------------------------------------

_LINE_TOOLS = {"modify_order", "reserve_inventory", "release_inventory"}


@dataclass
class ToolCall:
    tool_id: str | None  # None = the text did not map to any action
    params: dict[str, Any] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    customer_name: str | None = None
    ambiguities: list[str] = field(default_factory=list)


def to_tool_call(intent: LLMIntent) -> ToolCall:
    """Map the flat LLM parameters onto the tool's own parameter names."""
    if intent.intent == UNKNOWN_INTENT:
        return ToolCall(tool_id=None, ambiguities=list(intent.ambiguities))
    simulator = SIMULATORS.get(intent.intent)
    if simulator is None:  # SEC-03: invented tool
        raise LLMOutputInvalidError(f"LLM proposed unknown tool '{intent.intent}'")

    raw = intent.parameters.model_dump(exclude_none=True)
    customer_name = raw.pop("customer_name", None)
    if intent.intent in _LINE_TOOLS and ("sku" in raw or "quantity" in raw):
        sku, qty = raw.pop("sku", None), raw.pop("quantity", None)
        if sku is not None and qty is not None:
            raw["lines"] = [{"sku": sku, "quantity": qty}]
        else:  # half a line is a missing line, not a guess
            raw.pop("lines", None)

    fields = simulator.params_model.model_fields
    extra = sorted(set(raw) - set(fields))
    if extra:  # SEC-04: parameters the tool does not take
        raise LLMOutputInvalidError(
            f"LLM proposed parameter(s) {', '.join(extra)} that {intent.intent} does not accept"
        )
    missing = [name for name, f in fields.items() if f.is_required() and name not in raw]
    return ToolCall(
        tool_id=intent.intent,
        params=raw,
        missing=missing,
        customer_name=customer_name,
        ambiguities=list(intent.ambiguities),
    )


# --- explanations: numeric consistency ------------------------------------------------------------

_MONEY = re.compile(r"(?:₹|\brs\.?|\binr)\s*([0-9][0-9,]*(?:\.[0-9]+)?)", re.IGNORECASE)
_PERCENT = re.compile(r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*%")
_ANY_NUMBER = re.compile(r"[0-9][0-9,]*(?:\.[0-9]+)?")


def _decimal(token: str) -> Decimal | None:
    try:
        return Decimal(token.replace(",", ""))
    except InvalidOperation:
        return None


def _numbers_in(value: Any, into: set[Decimal]) -> None:
    if isinstance(value, dict):
        for v in value.values():
            _numbers_in(v, into)
    elif isinstance(value, list):
        for v in value:
            _numbers_in(v, into)
    elif isinstance(value, bool):
        return
    elif isinstance(value, int | float):
        into.add(Decimal(str(value)))
    elif isinstance(value, str):
        for token in _ANY_NUMBER.findall(value):
            number = _decimal(token)
            if number is not None:
                into.add(number)


def unsupported_figures(explanation: Explanation, facts: ExplainInput) -> list[str]:
    """SEC-06: every ₹ amount and % in the narrative must be a number the backend computed."""
    allowed: set[Decimal] = set()
    _numbers_in(facts.model_dump(), allowed)
    text = " ".join([explanation.summary, *explanation.bullets])
    cited = [m.group(0) for m in _MONEY.finditer(text)] + [
        m.group(0) for m in _PERCENT.finditer(text)
    ]
    bad = []
    for figure in cited:
        token = _ANY_NUMBER.search(figure)
        number = _decimal(token.group(0)) if token else None
        if number is None or number not in allowed:
            bad.append(figure.strip())
    return bad


# --- prompt-injection heuristic (a signal for the audit log, NOT the defence) -------------------

_INJECTION = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bignore\b.{0,40}\b(?:instructions?|rules?|polic(?:y|ies)|prompts?)\b",
        r"\b(?:disregard|forget|override|bypass)\b.{0,40}\b(?:instructions?|rules?|polic(?:y|ies)|limits?|approvals?)\b",
        r"\byou are (?:now )?(?:the |an? )?\w+(?:\s\w+)? agent\b",
        r"\bact as\b",
        r"\bsystem prompt\b",
        r"\b(?:developer|admin|god) mode\b",
        r"\bpre-?approved\b",
        r"\bwithout (?:approval|asking)\b",
        r"</?(?:system|instructions?)>",
    )
]


def injection_markers(text: str) -> list[str]:
    return [m.group(0) for p in _INJECTION if (m := p.search(text))]
