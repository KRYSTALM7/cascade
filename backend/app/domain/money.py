"""Decimal money helpers. INR to the paisa, ROUND_HALF_UP. Floats never touch money."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

PAISA = Decimal("0.01")
ZERO = Decimal("0.00")


def to_money(value: Decimal | int | str) -> Decimal:
    """Exact conversion + rounding to the paisa. Rejects floats and garbage."""
    if isinstance(value, float):  # pragma: no cover - guarded by typing, kept as a tripwire
        raise TypeError("money must never be a float")
    try:
        return Decimal(value).quantize(PAISA, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"not a money amount: {value!r}") from exc


def percentage_of(total: Decimal, percentage: Decimal) -> Decimal:
    return to_money(total * percentage / Decimal(100))


def format_inr(amount: Decimal) -> str:
    """₹84,500.00 (Western grouping; deterministic, locale-independent)."""
    return f"₹{to_money(amount):,.2f}"
