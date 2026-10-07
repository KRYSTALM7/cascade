"""CRM agent tools: customer status, cases, notifications."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field

from app.domain.enums import CustomerStatus, DomainEvent
from app.domain.state import CustomerRow, FieldChange, RecordCreation, SimState
from app.domain.tools.base import (
    EntityId,
    PreconditionFailedError,
    ToolEffect,
    ToolParams,
    ToolSimulator,
    emit,
)
from app.domain.tools.orders import Reason, require_order

NotificationTemplate = Literal[
    "REFUND_ISSUED",
    "ORDER_UPDATED",
    "ORDER_CANCELLED",
    "COMPENSATION_ISSUED",
    "ORDER_STATUS_UPDATED",
    "ORDER_SHIPPED",
]


def require_customer(state: SimState, customer_id: str) -> CustomerRow:
    customer = state.customer(customer_id)
    if customer is None:
        raise PreconditionFailedError(
            "CUSTOMER_NOT_FOUND", f"Customer {customer_id} does not exist.", customer_id=customer_id
        )
    return customer


# --- update_customer_status -----------------------------------------------------------------------


class UpdateCustomerStatusParams(ToolParams):
    customer_id: EntityId
    status: Literal["ACTIVE", "AT_RISK", "SUSPENDED"]
    reason: Reason = ""


def _update_customer_status(params: UpdateCustomerStatusParams, state: SimState) -> ToolEffect:
    customer = require_customer(state, params.customer_id)
    target = CustomerStatus(params.status)
    if customer.status is target:
        raise PreconditionFailedError(
            "STATUS_UNCHANGED",
            f"Customer {customer.id} is already {target}.",
            customer_id=customer.id,
        )
    return ToolEffect(
        changes=[FieldChange("customer", customer.id, "status", customer.status, target)],
        events=[
            emit(
                DomainEvent.CUSTOMER_STATUS_CHANGED,
                customer_id=customer.id,
                previous_status=customer.status,
                new_status=target,
            )
        ],
        summary=f"{customer.name}: {customer.status} → {target}.",
    )


# --- create_customer_case -------------------------------------------------------------------------


class CreateCustomerCaseParams(ToolParams):
    customer_id: EntityId
    order_id: EntityId | None = None
    reason: Annotated[str, Field(min_length=1, max_length=200)]


def _create_customer_case(params: CreateCustomerCaseParams, state: SimState) -> ToolEffect:
    customer = require_customer(state, params.customer_id)
    if params.order_id is not None:
        require_order(state, params.order_id)
    return ToolEffect(
        creations=[
            RecordCreation(
                "customer_case",
                {"customer_id": customer.id, "order_id": params.order_id, "reason": params.reason},
            )
        ],
        events=[
            emit(
                DomainEvent.CASE_OPENED,
                customer_id=customer.id,
                order_id=params.order_id,
                reason=params.reason,
            )
        ],
        summary=f"Open case {params.reason} for {customer.name}.",
    )


# --- send_customer_notification -------------------------------------------------------------------


class SendCustomerNotificationParams(ToolParams):
    customer_id: EntityId
    order_id: EntityId | None = None
    template: NotificationTemplate
    channel: Literal["EMAIL", "SMS"]


def _send_customer_notification(
    params: SendCustomerNotificationParams, state: SimState
) -> ToolEffect:
    customer = require_customer(state, params.customer_id)
    if params.order_id is not None:
        require_order(state, params.order_id)
    return ToolEffect(
        creations=[
            RecordCreation(
                "notification",
                {
                    "customer_id": customer.id,
                    "channel": params.channel,
                    "template": params.template,
                },
            )
        ],
        summary=f"{params.channel} {params.template} to {customer.name}.",
    )


SIMULATORS: list[ToolSimulator[Any]] = [
    ToolSimulator("update_customer_status", UpdateCustomerStatusParams, _update_customer_status),
    ToolSimulator("create_customer_case", CreateCustomerCaseParams, _create_customer_case),
    ToolSimulator(
        "send_customer_notification", SendCustomerNotificationParams, _send_customer_notification
    ),
]
