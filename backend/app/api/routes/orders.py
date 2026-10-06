"""NovaCart business state (lets the UI show state before/after an action)."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DbSession
from app.core.errors import CascadeError, ErrorCode
from app.repositories.business import BusinessRepository
from app.schemas.business import OrderDetailOut, OrderSummaryOut

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get("", response_model=list[OrderSummaryOut])
def list_orders(db: DbSession) -> list[OrderSummaryOut]:
    return [OrderSummaryOut.model_validate(o) for o in BusinessRepository(db).list_orders()]


@router.get("/{order_id}", response_model=OrderDetailOut)
def get_order(order_id: str, db: DbSession) -> OrderDetailOut:
    order = BusinessRepository(db).get_order(order_id)
    if order is None:
        raise CascadeError(
            ErrorCode.ORDER_NOT_FOUND,
            f"Order '{order_id}' does not exist.",
            http_status=404,
            details={"order_id": order_id},
        )
    return OrderDetailOut.model_validate(order)
