"""Stable reason codes with plain-sentence templates, so the UI can say WHY without an LLM.

Engine block codes (authorization, preconditions) keep the engine's own message, which already
names the agent/tool/order involved; policy codes are rendered from these templates.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, JsonValue


class Severity(StrEnum):
    BLOCK = "BLOCK"  # hard rule; never weighed against risk
    APPROVAL = "APPROVAL"  # a human must decide
    INFO = "INFO"  # context for the reader


class PolicyReason(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    code: str
    severity: Severity
    message: str
    node_id: str | None = None
    details: dict[str, JsonValue] = {}


# code -> (severity, template). Placeholders are filled from `details`.
TEMPLATES: dict[str, tuple[Severity, str]] = {
    # approval triggers
    "REFUND_ABOVE_AUTO_LIMIT": (
        Severity.APPROVAL,
        "{money_out} would leave NovaCart, above the {limit} auto-approve limit.",
    ),
    "HIGH_RISK": (Severity.APPROVAL, "Risk is {level} ({score}/100)."),
    "IRREVERSIBLE_AT_MEDIUM_RISK": (
        Severity.APPROVAL,
        "Nothing in this cascade can be undone and risk is {level}.",
    ),
    "BULK_PII_EXPOSURE": (Severity.APPROVAL, "A step exposes bulk customer PII."),
    "CASCADE_LIMIT_REACHED": (
        Severity.APPROVAL,
        "The cascade is larger than the policy explores; a human must review the rest.",
    ),
    "CYCLE_DETECTED": (
        Severity.APPROVAL,
        "Agent reactions form a loop; it was cut, but a human should review it.",
    ),
    # autonomous
    "WITHIN_POLICY": (
        Severity.INFO,
        "{money_out} is within the {limit} auto-approve limit and risk is {level}.",
    ),
    # floors (info: they explain why the level is higher than the score alone)
    "FLOOR_HIGH_VALUE_OUTFLOW": (
        Severity.INFO,
        "Outflow above {threshold} sets the risk level to at least {floor}.",
    ),
    "FLOOR_CASCADE_LIMIT": (
        Severity.INFO,
        "An incompletely explored cascade sets the risk level to at least {floor}.",
    ),
    # optional downstream steps that will not run (warnings from the engine)
    "OPTIONAL_STEP_SKIPPED": (
        Severity.INFO,
        "{tool_id} by {agent_id} will not run ({cause}); it is optional, so the action proceeds.",
    ),
}


def render(code: str, *, node_id: str | None = None, **details: Any) -> PolicyReason:
    severity, template = TEMPLATES[code]
    return PolicyReason(
        code=code,
        severity=severity,
        message=template.format(**details),
        node_id=node_id,
        details={
            k: v if isinstance(v, str | int | bool) or v is None else str(v)
            for k, v in details.items()
        },
    )
