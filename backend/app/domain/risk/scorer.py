"""Risk = documented formula over the Blast Radius (blueprint §G.2). Every number comes from the
Policy; this module has no thresholds of its own."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from itertools import pairwise
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.domain.consequence.report import ConsequenceReport
from app.domain.enums import Reversibility, RiskLevel
from app.domain.money import format_inr
from app.domain.policy.model import Breakpoint, Policy, max_level
from app.domain.policy.reasons import PolicyReason, render

DimensionKey = Literal["financial", "irreversibility", "downstream", "customer", "data"]
ONE_DP = Decimal("0.1")


class RiskDimension(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    key: DimensionKey
    label: str
    score: Decimal  # 0..100, one decimal place
    weight: Decimal
    contribution: Decimal  # weight * score, two decimal places
    explanation: str


class RiskAssessment(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    score: int  # after floors
    raw_score: int  # the weighted formula alone
    level: RiskLevel
    dimensions: list[RiskDimension]
    reasons: list[PolicyReason]  # floors that raised the level
    policy_version: str


def financial_score(amount: Decimal, points: list[Breakpoint]) -> Decimal:
    """Piecewise-linear over the breakpoints, clamped to the last score."""
    amount = abs(amount)
    for low, high in pairwise(points):
        if amount <= high.amount:
            return low.score + (amount - low.amount) / (high.amount - low.amount) * (
                high.score - low.score
            )
    return points[-1].score


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def score_report(report: ConsequenceReport, policy: Policy) -> RiskAssessment:
    cfg = policy.risk
    radius = report.blast_radius
    executing = len(report.execution_order)
    net = radius.net_money_out

    raw: dict[DimensionKey, tuple[str, Decimal, str]] = {
        "financial": (
            "Financial",
            financial_score(net, cfg.financial_breakpoints),
            f"{format_inr(abs(net))} moves out of NovaCart." if net else "No money moves.",
        ),
        "irreversibility": (
            "Irreversibility",
            Decimal(cfg.irreversibility[radius.reversibility]),
            {
                Reversibility.FULL: "Every step can be undone.",
                Reversibility.PARTIAL: f"{len(radius.irreversible_nodes)} of "
                f"{_plural(executing, 'step')} cannot be undone.",
                Reversibility.NONE: "No step can be undone.",
            }[radius.reversibility],
        ),
        "downstream": (
            "Downstream agents",
            Decimal(min(100, cfg.downstream_per_agent * radius.agent_count)),
            f"{_plural(radius.agent_count, 'other agent')} act: "
            f"{', '.join(radius.agents_affected)}."
            if radius.agent_count
            else "No other agent is triggered.",
        ),
        "customer": (
            "Customer impact",
            Decimal(cfg.customer_impact[radius.customer_impact]),
            f"Highest customer impact: {radius.customer_impact}.",
        ),
        "data": (
            "Data sensitivity",
            Decimal(cfg.data_sensitivity[radius.data_sensitivity]),
            f"Most sensitive data touched: {radius.data_sensitivity}.",
        ),
    }
    weights = cfg.weights.model_dump()
    dimensions = [
        RiskDimension(
            key=key,
            label=label,
            score=value.quantize(ONE_DP, rounding=ROUND_HALF_UP),
            weight=weights[key],
            contribution=(weights[key] * value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            explanation=text,
        )
        for key, (label, value, text) in raw.items()
    ]
    total = sum((weights[k] * v for k, (_, v, _) in raw.items()), Decimal(0))
    raw_score = int(total.quantize(Decimal(1), rounding=ROUND_HALF_UP))

    level = cfg.levels.level_for(raw_score)
    reasons: list[PolicyReason] = []
    if radius.money_out > policy.high_value_refund:
        floor = cfg.floors.high_value_outflow
        level = max_level(level, floor)
        reasons.append(
            render(
                "FLOOR_HIGH_VALUE_OUTFLOW",
                threshold=format_inr(policy.high_value_refund),
                floor=floor.value,
            )
        )
    if report.limit_reached:
        floor = cfg.floors.cascade_limit
        level = max_level(level, floor)
        reasons.append(render("FLOOR_CASCADE_LIMIT", floor=floor.value))
    score = max(raw_score, cfg.levels.lower_bound(level))

    return RiskAssessment(
        score=score,
        raw_score=raw_score,
        level=level,
        dimensions=dimensions,
        reasons=reasons,
        policy_version=policy.version,
    )
