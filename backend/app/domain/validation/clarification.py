"""Clarification rules: what the backend asks when a request is incomplete or ambiguous.

The backend — not the LLM — decides what is missing. It never guesses: a single unambiguous
match is used, anything else becomes a question with explicit candidates.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict

from app.domain.money import format_inr


class Candidate(BaseModel):
    model_config = ConfigDict(frozen=True)

    field: str
    value: str
    label: str


class Clarification(BaseModel):
    model_config = ConfigDict(frozen=True)

    field: str
    question: str
    candidates: list[Candidate] = []
    missing: list[str] = []


@dataclass(frozen=True)
class OrderBrief:
    id: str
    status: str
    total: Decimal


@dataclass(frozen=True)
class CustomerBrief:
    id: str
    name: str
    tier: str
    orders: Sequence[OrderBrief] = field(default_factory=tuple)


class Directory(Protocol):
    """Read-only lookups the rules need (implemented over the DB by the services layer)."""

    def customers_named(self, name: str) -> Sequence[CustomerBrief]: ...

    def customer(self, customer_id: str) -> CustomerBrief | None: ...

    def exists(self, kind: str, entity_id: str) -> bool: ...


# Parameters that name an entity, and the lookup kind used to check it exists.
ENTITY_PARAMS = {
    "order_id": "order",
    "customer_id": "customer",
    "payment_id": "payment",
    "sku": "sku",
}

EXAMPLES = {"order_id": "ORD-10482", "customer_id": "CUST-1001", "payment_id": "PAY-90482"}


@dataclass
class Resolution:
    params: dict[str, Any]
    clarification: Clarification | None = None


def _order_candidates(customer: CustomerBrief) -> list[Candidate]:
    return [
        Candidate(
            field="order_id",
            value=o.id,
            label=f"{o.id} · {o.status} · {format_inr(o.total)}",
        )
        for o in customer.orders
    ]


def _orders_of(customer: CustomerBrief, params: dict[str, Any], missing: list[str]) -> Resolution:
    if len(customer.orders) == 1:  # exactly one: deterministic, not a guess
        params["order_id"] = customer.orders[0].id
        return Resolution(params)
    if not customer.orders:
        return Resolution(
            params,
            Clarification(
                field="order_id",
                question=f"{customer.name} has no orders. Which order do you mean?",
                missing=missing,
            ),
        )
    return Resolution(
        params,
        Clarification(
            field="order_id",
            question=f"{customer.name} has {len(customer.orders)} orders. Which one?",
            candidates=_order_candidates(customer),
            missing=missing,
        ),
    )


def resolve(
    *,
    tool_id: str | None,
    params: dict[str, Any],
    missing: Sequence[str],
    customer_name: str | None,
    ambiguities: Sequence[str],
    directory: Directory,
    permitted_tools: Sequence[str],
    chosen_customer_id: str | None = None,
) -> Resolution:
    params = dict(params)
    missing = list(missing)

    if tool_id is None:
        return Resolution(
            params,
            Clarification(
                field="intent",
                question="What should the agent do? For example: 'Cancel order ORD-10482'.",
                candidates=[Candidate(field="intent", value=t, label=t) for t in permitted_tools],
            ),
        )
    if ambiguities:
        return Resolution(params, Clarification(field="ambiguity", question=" ".join(ambiguities)))

    if "order_id" in missing:
        others = [m for m in missing if m != "order_id"]
        if chosen_customer_id:
            customer = directory.customer(chosen_customer_id)
            if customer is not None:
                resolution = _orders_of(customer, params, others)
                if resolution.clarification is not None:
                    return resolution
                params, missing = resolution.params, others
        elif customer_name:
            matches = list(directory.customers_named(customer_name))
            if not matches:
                return Resolution(
                    params,
                    Clarification(
                        field="order_id",
                        question=f"No customer matches '{customer_name}'. Which order "
                        f"(e.g. {EXAMPLES['order_id']})?",
                        missing=missing,
                    ),
                )
            if len(matches) > 1:
                return Resolution(
                    params,
                    Clarification(
                        field="customer_id",
                        question=f"{len(matches)} customers match '{customer_name}'. Which one?",
                        candidates=[
                            Candidate(
                                field="customer_id",
                                value=c.id,
                                label=f"{c.name} ({c.id}, {c.tier}, {len(c.orders)} orders)",
                            )
                            for c in matches
                        ],
                        missing=missing,
                    ),
                )
            resolution = _orders_of(matches[0], params, others)
            if resolution.clarification is not None:
                return resolution
            params, missing = resolution.params, others

    if missing:
        first = missing[0]
        example = f" (e.g. {EXAMPLES[first]})" if first in EXAMPLES else ""
        return Resolution(
            params,
            Clarification(
                field=first,
                question=f"Please provide {', '.join(missing)}{example}.",
                missing=missing,
            ),
        )

    for name, kind in ENTITY_PARAMS.items():
        value = params.get(name)
        if isinstance(value, str) and not directory.exists(kind, value):
            return Resolution(
                params,
                Clarification(
                    field=name,
                    question=f"{value} does not exist. Which {kind} do you mean?",
                    missing=[name],
                ),
            )
    return Resolution(params)
