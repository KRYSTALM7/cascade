"""Money tools: refund requests, refunds, goodwill compensation, payment reversal.

Every rupee leaving NovaCart is an itemised `MoneyMovement` and a created `refund` record.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Any, Self

from pydantic import Field, model_validator

from app.domain.enums import DomainEvent, OrderStatus, PaymentStatus, RefundKind
from app.domain.money import format_inr, percentage_of
from app.domain.state import FieldChange, PaymentRow, RecordCreation, SimState
from app.domain.tools.base import (
    EntityId,
    MoneyMovement,
    PositiveMoney,
    PreconditionFailedError,
    ToolEffect,
    ToolParams,
    ToolSimulator,
    emit,
)
from app.domain.tools.orders import Reason, require_order

Percentage = Annotated[Decimal, Field(gt=0, le=100, max_digits=5, decimal_places=2)]
MONEY = frozenset({"amount"})


def _check_amount(requested: Decimal, refundable: Decimal, order_id: str) -> None:
    if requested > refundable:
        raise PreconditionFailedError(
            "REFUND_EXCEEDS_REFUNDABLE",
            f"{format_inr(requested)} exceeds the {format_inr(refundable)} still refundable "
            f"on order {order_id}.",
            order_id=order_id,
            requested=requested,
            refundable=refundable,
        )


def _refund_payment_changes(payment: PaymentRow, amount: Decimal) -> list[FieldChange]:
    refunded = payment.refunded_amount + amount
    status = (
        PaymentStatus.REFUNDED if refunded == payment.amount else PaymentStatus.PARTIALLY_REFUNDED
    )
    changes = [
        FieldChange("payment", payment.id, "refunded_amount", payment.refunded_amount, refunded)
    ]
    if status is not payment.status:
        changes.append(FieldChange("payment", payment.id, "status", payment.status, status))
    return changes


# --- request_refund (Support asks; Finance decides via its reaction rule) -------------------------


class RequestRefundParams(ToolParams):
    order_id: EntityId
    amount: PositiveMoney | None = None  # None = the full remaining refundable amount
    reason: Reason = ""


def _request_refund(params: RequestRefundParams, state: SimState) -> ToolEffect:
    order = require_order(state, params.order_id)
    refundable = state.refundable_amount(order.id)
    if refundable == 0:
        raise PreconditionFailedError(
            "NOTHING_TO_REFUND", f"Order {order.id} has no refundable payment.", order_id=order.id
        )
    amount = params.amount if params.amount is not None else refundable
    _check_amount(amount, refundable, order.id)
    return ToolEffect(
        events=[
            emit(
                DomainEvent.REFUND_REQUESTED,
                order_id=order.id,
                customer_id=order.customer_id,
                amount=amount,
                reason=params.reason or "CUSTOMER_REQUEST",
            )
        ],
        summary=f"Refund of {format_inr(amount)} requested for {order.id}.",
    )


# --- issue_refund ---------------------------------------------------------------------------------


class IssueRefundParams(ToolParams):
    order_id: EntityId
    amount: PositiveMoney | None = None  # None = the full remaining refundable amount
    reason: Reason = ""


def _issue_refund(params: IssueRefundParams, state: SimState) -> ToolEffect:
    order = require_order(state, params.order_id)
    payment = state.refundable_payment(order.id)
    if payment is None:
        raise PreconditionFailedError(
            "NOTHING_TO_REFUND", f"Order {order.id} has no refundable payment.", order_id=order.id
        )
    amount = params.amount if params.amount is not None else payment.refundable
    _check_amount(amount, payment.refundable, order.id)
    return ToolEffect(
        changes=_refund_payment_changes(payment, amount),
        creations=[
            RecordCreation(
                "refund",
                {
                    "payment_id": payment.id,
                    "kind": RefundKind.REFUND,
                    "amount": amount,
                    "reason": params.reason,
                },
            )
        ],
        money=[MoneyMovement("OUT", amount, "REFUND", f"Refund on {payment.id}")],
        events=[
            emit(
                DomainEvent.REFUND_ISSUED,
                order_id=order.id,
                customer_id=order.customer_id,
                payment_id=payment.id,
                amount=amount,
                reason=params.reason,
            )
        ],
        summary=f"Refund {format_inr(amount)} to {payment.id} ({payment.method}).",
    )


# --- issue_compensation ---------------------------------------------------------------------------


class IssueCompensationParams(ToolParams):
    order_id: EntityId
    amount: PositiveMoney | None = None
    percentage: Percentage | None = None  # of the order total; computed here, never by the LLM
    reason: Reason = ""

    @model_validator(mode="after")
    def _exactly_one_of_amount_or_percentage(self) -> Self:
        if (self.amount is None) == (self.percentage is None):
            raise ValueError("give exactly one of amount or percentage")
        return self


def _issue_compensation(params: IssueCompensationParams, state: SimState) -> ToolEffect:
    order = require_order(state, params.order_id)
    if order.status is OrderStatus.CANCELLED:
        raise PreconditionFailedError(
            "ORDER_ALREADY_CANCELLED", f"Order {order.id} is already CANCELLED.", order_id=order.id
        )
    payments = state.payments_for_order(order.id)
    if not payments:
        raise PreconditionFailedError(
            "NO_PAYMENT_ON_ORDER",
            f"Order {order.id} has no payment to credit compensation to.",
            order_id=order.id,
        )
    if params.amount is not None:
        amount = params.amount
    else:
        assert params.percentage is not None
        amount = percentage_of(order.total_amount, params.percentage)
    if amount > order.total_amount:
        raise PreconditionFailedError(
            "COMPENSATION_EXCEEDS_ORDER_TOTAL",
            f"{format_inr(amount)} exceeds the order total {format_inr(order.total_amount)}.",
            order_id=order.id,
            requested=amount,
        )
    payment = payments[0]
    return ToolEffect(
        creations=[
            RecordCreation(
                "refund",
                {
                    "payment_id": payment.id,
                    "kind": RefundKind.COMPENSATION,
                    "amount": amount,
                    "reason": params.reason,
                },
            )
        ],
        money=[MoneyMovement("OUT", amount, "COMPENSATION", f"Goodwill credit on {payment.id}")],
        events=[
            emit(
                DomainEvent.COMPENSATION_ISSUED,
                order_id=order.id,
                customer_id=order.customer_id,
                payment_id=payment.id,
                amount=amount,
            )
        ],
        summary=f"Compensation {format_inr(amount)} on {order.id}; the order stays active.",
    )


# --- reverse_payment ------------------------------------------------------------------------------


class ReversePaymentParams(ToolParams):
    payment_id: EntityId
    reason: Reason = ""


def _reverse_payment(params: ReversePaymentParams, state: SimState) -> ToolEffect:
    payment = state.payment(params.payment_id)
    if payment is None:
        raise PreconditionFailedError(
            "PAYMENT_NOT_FOUND",
            f"Payment {params.payment_id} does not exist.",
            payment_id=params.payment_id,
        )
    if payment.status is PaymentStatus.REVERSED:
        raise PreconditionFailedError(
            "PAYMENT_ALREADY_REVERSED",
            f"Payment {payment.id} is already REVERSED.",
            payment_id=payment.id,
        )
    amount = payment.refundable
    if amount == 0:
        raise PreconditionFailedError(
            "NOTHING_TO_REFUND",
            f"Payment {payment.id} has nothing left to reverse.",
            payment_id=payment.id,
        )
    order = require_order(state, payment.order_id)
    return ToolEffect(
        changes=[
            FieldChange(
                "payment", payment.id, "refunded_amount", payment.refunded_amount, payment.amount
            ),
            FieldChange("payment", payment.id, "status", payment.status, PaymentStatus.REVERSED),
        ],
        creations=[
            RecordCreation(
                "refund",
                {
                    "payment_id": payment.id,
                    "kind": RefundKind.REFUND,
                    "amount": amount,
                    "reason": params.reason or "PAYMENT_REVERSED",
                },
            )
        ],
        money=[MoneyMovement("OUT", amount, "REVERSAL", f"Reversal of {payment.id}")],
        events=[
            emit(
                DomainEvent.PAYMENT_REVERSED,
                order_id=order.id,
                customer_id=order.customer_id,
                payment_id=payment.id,
                amount=amount,
            )
        ],
        summary=f"Reverse {format_inr(amount)} on {payment.id}.",
    )


SIMULATORS: list[ToolSimulator[Any]] = [
    ToolSimulator("request_refund", RequestRefundParams, _request_refund, MONEY),
    ToolSimulator("issue_refund", IssueRefundParams, _issue_refund, MONEY),
    ToolSimulator(
        "issue_compensation",
        IssueCompensationParams,
        _issue_compensation,
        frozenset({"amount", "percentage"}),
    ),
    ToolSimulator("reverse_payment", ReversePaymentParams, _reverse_payment, MONEY),
]
