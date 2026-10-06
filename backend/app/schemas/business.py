"""API response models for NovaCart business state."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.domain.enums import (
    CustomerStatus,
    CustomerTier,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
)


class _Orm(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class CustomerOut(_Orm):
    id: str
    name: str
    tier: CustomerTier
    status: CustomerStatus


class OrderItemOut(_Orm):
    sku: str
    quantity: int
    unit_price: Decimal
    reserved_quantity: int


class PaymentOut(_Orm):
    id: str
    amount: Decimal
    refunded_amount: Decimal
    method: PaymentMethod
    status: PaymentStatus


class OrderSummaryOut(_Orm):
    id: str
    status: OrderStatus
    total_amount: Decimal
    currency: str
    version: int
    customer: CustomerOut


class OrderDetailOut(OrderSummaryOut):
    items: list[OrderItemOut]
    payments: list[PaymentOut]
