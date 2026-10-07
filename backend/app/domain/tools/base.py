"""Tool simulator contract.

A simulator is the single implementation of what a tool does: `simulate(params, state)` returns a
`ToolEffect` (field changes, created records, itemised money, emitted domain events). Preview and
execution both use it; execution applies exactly the effect the simulator computed.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError

from app.domain.enums import DataSensitivity, DomainEvent, ImpactLevel, Reversibility
from app.domain.money import to_money
from app.domain.state import FieldChange, RecordCreation, SimState, to_jsonable

# --- Parameter models ----------------------------------------------------------------------------

# INR, strictly positive, at most 2 decimal places (sub-paisa amounts are rejected, not rounded).
PositiveMoney = Annotated[
    Decimal, Field(gt=0, max_digits=12, decimal_places=2), AfterValidator(to_money)
]
EntityId = Annotated[str, Field(min_length=1, max_length=64)]


class ToolParams(BaseModel):
    """Base for every tool's parameter model: unknown fields forbidden, no type coercion."""

    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class ParamErrorKind(StrEnum):
    MISSING_PARAMETERS = "MISSING_PARAMETERS"
    INVALID_AMOUNT = "INVALID_AMOUNT"
    INVALID_PARAMETERS = "INVALID_PARAMETERS"


class ParamValidationError(Exception):
    def __init__(
        self,
        kind: ParamErrorKind,
        message: str,
        *,
        missing: tuple[str, ...] = (),
        errors: tuple[Mapping[str, Any], ...] = (),
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.missing = missing
        self.errors = errors


def canonical_json(value: Any) -> str:
    """Deterministic JSON: sorted keys, no whitespace, Decimal/enum normalised."""
    return json.dumps(to_jsonable(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


P = TypeVar("P", bound=ToolParams)


def validate_params(model: type[P], params: Mapping[str, Any], money_fields: frozenset[str]) -> P:
    """Validate through JSON so strict mode accepts decimal strings ("84500.00") but nothing
    implicit (no "2" -> 2, no 0.1-float drift). Errors are classified into stable codes."""
    try:
        return model.model_validate_json(canonical_json(params))
    except ValidationError as exc:
        errors = tuple(
            {"loc": [str(p) for p in e["loc"]], "type": e["type"], "msg": e["msg"]}
            for e in exc.errors(include_url=False)
        )
        missing = tuple(sorted({e["loc"][0] for e in errors if e["type"] == "missing"}))
        if missing:
            raise ParamValidationError(
                ParamErrorKind.MISSING_PARAMETERS,
                f"Missing required parameter(s): {', '.join(missing)}.",
                missing=missing,
                errors=errors,
            ) from None
        if any(e["loc"] and e["loc"][0] in money_fields for e in errors):
            raise ParamValidationError(
                ParamErrorKind.INVALID_AMOUNT,
                "Amount must be a positive INR value with at most 2 decimal places.",
                errors=errors,
            ) from None
        raise ParamValidationError(
            ParamErrorKind.INVALID_PARAMETERS,
            "Parameters do not match the tool's schema.",
            errors=errors,
        ) from None


# --- Effects -------------------------------------------------------------------------------------


class PreconditionFailedError(Exception):
    """The tool cannot run against the current (simulated) state. Codes are stable API codes."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = to_jsonable(details)


@dataclass(frozen=True)
class MoneyMovement:
    direction: Literal["OUT", "IN"]
    amount: Decimal
    kind: str  # REFUND | COMPENSATION | REVERSAL
    description: str


# Exact payload fields per event type. Reaction rules may only map "$event.<field>" from these;
# simulators may only emit exactly these (checked at emit time).
EVENT_PAYLOAD_FIELDS: Mapping[DomainEvent, frozenset[str]] = {
    DomainEvent.ORDER_CANCELLED: frozenset(
        {"order_id", "customer_id", "previous_status", "order_total", "refundable_amount"}
    ),
    DomainEvent.ORDER_MODIFIED: frozenset(
        {
            "order_id",
            "customer_id",
            "increased_lines",
            "decreased_lines",
            "old_total",
            "new_total",
            "total_increase",
            "total_decrease",
        }
    ),
    DomainEvent.ORDER_STATUS_CHANGED: frozenset(
        {"order_id", "customer_id", "previous_status", "new_status"}
    ),
    DomainEvent.REFUND_REQUESTED: frozenset({"order_id", "customer_id", "amount", "reason"}),
    DomainEvent.REFUND_ISSUED: frozenset(
        {"order_id", "customer_id", "payment_id", "amount", "reason"}
    ),
    DomainEvent.COMPENSATION_ISSUED: frozenset({"order_id", "customer_id", "payment_id", "amount"}),
    DomainEvent.PAYMENT_REVERSED: frozenset({"order_id", "customer_id", "payment_id", "amount"}),
    DomainEvent.STOCK_RESERVED: frozenset({"order_id", "lines"}),
    DomainEvent.STOCK_RELEASED: frozenset({"order_id", "lines"}),
    DomainEvent.STOCK_BELOW_REORDER_POINT: frozenset(
        {"sku", "available", "reorder_point", "suggested_quantity"}
    ),
    DomainEvent.CUSTOMER_STATUS_CHANGED: frozenset(
        {"customer_id", "previous_status", "new_status"}
    ),
    DomainEvent.CASE_OPENED: frozenset({"customer_id", "order_id", "reason"}),
}


@dataclass(frozen=True)
class EmittedEvent:
    type: DomainEvent
    payload: Mapping[str, Any]


def emit(event_type: DomainEvent, **payload: Any) -> EmittedEvent:
    expected = EVENT_PAYLOAD_FIELDS[event_type]
    if set(payload) != expected:
        raise ValueError(f"{event_type} payload must have exactly {sorted(expected)}")
    return EmittedEvent(event_type, to_jsonable(payload))


@dataclass(frozen=True)
class ToolEffect:
    changes: Sequence[FieldChange] = ()
    creations: Sequence[RecordCreation] = ()
    money: Sequence[MoneyMovement] = ()
    events: Sequence[EmittedEvent] = ()
    # None = use the tool's catalog characteristics.
    reversibility: Reversibility | None = None
    customer_impact: ImpactLevel | None = None
    data_sensitivity: DataSensitivity | None = None
    summary: str = ""


@dataclass(frozen=True)
class ToolSimulator(Generic[P]):
    """Binds a tool id to its parameter model and pure simulate function."""

    tool_id: str
    params_model: type[P]
    run: Callable[[P, SimState], ToolEffect] = field(repr=False)
    money_fields: frozenset[str] = frozenset()

    def parse(self, params: Mapping[str, Any]) -> P:
        return validate_params(self.params_model, params, self.money_fields)

    def simulate(self, params: Mapping[str, Any], state: SimState) -> ToolEffect:
        parsed = self.parse(params)
        return self.run(parsed, state)
