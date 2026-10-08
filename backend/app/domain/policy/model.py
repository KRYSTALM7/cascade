"""Typed, validated policy (thresholds, weights, limits). Loaded from policy/policy.yaml."""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from itertools import pairwise
from typing import Annotated, Any, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.domain.enums import DataSensitivity, ImpactLevel, Reversibility, RiskLevel

LEVEL_ORDER = list(RiskLevel)


def level_at_least(level: RiskLevel, floor: RiskLevel) -> bool:
    return LEVEL_ORDER.index(level) >= LEVEL_ORDER.index(floor)


def max_level(a: RiskLevel, b: RiskLevel) -> RiskLevel:
    return a if level_at_least(a, b) else b


def _no_float(value: Any) -> Any:
    if isinstance(value, float):
        raise ValueError("write decimals as quoted strings in policy.yaml (floats are inexact)")
    return value


ExactDecimal = Annotated[Decimal, BeforeValidator(_no_float)]
Score = Annotated[int, Field(ge=0, le=100)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Weights(_Strict):
    financial: ExactDecimal
    irreversibility: ExactDecimal
    downstream: ExactDecimal
    customer: ExactDecimal
    data: ExactDecimal

    @model_validator(mode="after")
    def _sum_to_one(self) -> Self:
        total = self.financial + self.irreversibility + self.downstream + self.customer + self.data
        if total != Decimal(1):
            raise ValueError(f"risk weights must sum to 1 (got {total})")
        return self


class Breakpoint(_Strict):
    amount: Annotated[ExactDecimal, Field(ge=0)]
    score: Annotated[ExactDecimal, Field(ge=0, le=100)]


class Levels(_Strict):
    medium: Score
    high: Score
    critical: Score

    @model_validator(mode="after")
    def _ascending(self) -> Self:
        if not 0 < self.medium < self.high < self.critical <= 100:
            raise ValueError("levels must satisfy 0 < medium < high < critical <= 100")
        return self

    def level_for(self, score: int) -> RiskLevel:
        if score >= self.critical:
            return RiskLevel.CRITICAL
        if score >= self.high:
            return RiskLevel.HIGH
        if score >= self.medium:
            return RiskLevel.MEDIUM
        return RiskLevel.LOW

    def lower_bound(self, level: RiskLevel) -> int:
        return {
            RiskLevel.LOW: 0,
            RiskLevel.MEDIUM: self.medium,
            RiskLevel.HIGH: self.high,
            RiskLevel.CRITICAL: self.critical,
        }[level]


class Floors(_Strict):
    high_value_outflow: RiskLevel
    cascade_limit: RiskLevel


class RiskConfig(_Strict):
    weights: Weights
    financial_breakpoints: Annotated[list[Breakpoint], Field(min_length=2)]
    irreversibility: dict[Reversibility, Score]
    downstream_per_agent: Score
    customer_impact: dict[ImpactLevel, Score]
    data_sensitivity: dict[DataSensitivity, Score]
    levels: Levels
    floors: Floors

    @model_validator(mode="after")
    def _complete_and_monotonic(self) -> Self:
        for name, enum in (
            ("irreversibility", Reversibility),
            ("customer_impact", ImpactLevel),
            ("data_sensitivity", DataSensitivity),
        ):
            missing = set(enum) - set(getattr(self, name))
            if missing:
                raise ValueError(f"risk.{name} is missing {sorted(missing)}")
        points = self.financial_breakpoints
        if points[0].amount != 0:
            raise ValueError("the first financial breakpoint must be at amount 0")
        for prev, nxt in pairwise(points):
            if not (nxt.amount > prev.amount and nxt.score >= prev.score):
                raise ValueError("financial breakpoints must be strictly increasing in amount")
        return self


class CascadeConfig(_Strict):
    max_depth: Annotated[int, Field(ge=1, le=20)]
    max_nodes: Annotated[int, Field(ge=1, le=500)]


class ApprovalConfig(_Strict):
    min_level: RiskLevel
    irreversible_min_level: RiskLevel
    bulk_pii_requires_approval: bool


class Policy(_Strict):
    version: Annotated[str, Field(min_length=1, max_length=32)]
    currency: str
    auto_approve_limit: Annotated[ExactDecimal, Field(ge=0, decimal_places=2)]
    high_value_refund: Annotated[ExactDecimal, Field(ge=0, decimal_places=2)]
    approval_expiry_minutes: Annotated[int, Field(ge=1, le=7 * 24 * 60)]
    cascade: CascadeConfig
    risk: RiskConfig
    approval: ApprovalConfig

    def fingerprint(self) -> str:
        """SHA-256 of the canonical policy content. An approval is bound to the policy it was
        decided under: execution compares this, not only the human-maintained `version`."""
        canonical = json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()
