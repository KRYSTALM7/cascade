"""NovaCart business state. Mutable rows touched by execution carry a `version` for staleness
detection (simulation fingerprints the versions it read; execution re-checks them under lock)."""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import (
    CreatedAtMixin,
    Money,
    TimestampMixin,
    VersionedMixin,
    new_uuid,
    str_enum,
)
from app.domain.enums import (
    CaseStatus,
    CustomerStatus,
    CustomerTier,
    NotificationChannel,
    OrderStatus,
    PaymentMethod,
    PaymentStatus,
    RefundKind,
)


class Customer(VersionedMixin, TimestampMixin, Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # "CUST-1001"
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254))
    phone: Mapped[str] = mapped_column(String(32))
    tier: Mapped[CustomerTier] = mapped_column(str_enum(CustomerTier, "customer_tier"))
    status: Mapped[CustomerStatus] = mapped_column(
        str_enum(CustomerStatus, "customer_status"), default=CustomerStatus.ACTIVE
    )

    orders: Mapped[list[Order]] = relationship(back_populates="customer", order_by="Order.id")


class Order(VersionedMixin, TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (CheckConstraint("total_amount >= 0", name="total_non_negative"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # "ORD-10482"
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"), index=True)
    status: Mapped[OrderStatus] = mapped_column(str_enum(OrderStatus, "order_status"))
    total_amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), default="INR")

    customer: Mapped[Customer] = relationship(back_populates="orders")
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderItem.sku"
    )
    payments: Mapped[list[Payment]] = relationship(back_populates="order", order_by="Payment.id")


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        UniqueConstraint("order_id", "sku"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("unit_price >= 0", name="unit_price_non_negative"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    sku: Mapped[str] = mapped_column(ForeignKey("inventory_items.sku"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Money)
    # Units of this line currently held against stock (released on cancel, shipped on dispatch).
    reserved_quantity: Mapped[int] = mapped_column(Integer, default=0)

    order: Mapped[Order] = relationship(back_populates="items")


class Payment(VersionedMixin, TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("refunded_amount >= 0", name="refunded_non_negative"),
        CheckConstraint("refunded_amount <= amount", name="refund_within_amount"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # "PAY-90482"
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    refunded_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0.00"))
    method: Mapped[PaymentMethod] = mapped_column(str_enum(PaymentMethod, "payment_method"))
    status: Mapped[PaymentStatus] = mapped_column(str_enum(PaymentStatus, "payment_status"))

    order: Mapped[Order] = relationship(back_populates="payments")


class Refund(CreatedAtMixin, Base):
    """Money leaving NovaCart: refunds and goodwill compensation. Created only by execution."""

    __tablename__ = "refunds"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    payment_id: Mapped[str] = mapped_column(ForeignKey("payments.id"), index=True)
    kind: Mapped[RefundKind] = mapped_column(str_enum(RefundKind, "refund_kind"))
    amount: Mapped[Decimal] = mapped_column(Money)
    reason: Mapped[str] = mapped_column(Text, default="")
    action_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("actions.id"), index=True)


class InventoryItem(VersionedMixin, TimestampMixin, Base):
    __tablename__ = "inventory_items"
    __table_args__ = (
        CheckConstraint("on_hand >= 0", name="on_hand_non_negative"),
        CheckConstraint("reserved >= 0", name="reserved_non_negative"),
        CheckConstraint("reserved <= on_hand", name="reserved_within_on_hand"),
        CheckConstraint("reorder_point >= 0", name="reorder_point_non_negative"),
    )

    sku: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    on_hand: Mapped[int] = mapped_column(Integer)
    reserved: Mapped[int] = mapped_column(Integer, default=0)
    reorder_point: Mapped[int] = mapped_column(Integer, default=0)
    unit_price: Mapped[Decimal] = mapped_column(Money)


class RestockRequest(CreatedAtMixin, Base):
    __tablename__ = "restock_requests"
    __table_args__ = (CheckConstraint("quantity > 0", name="quantity_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    sku: Mapped[str] = mapped_column(ForeignKey("inventory_items.sku"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    action_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("actions.id"), index=True)


class CustomerCase(TimestampMixin, Base):
    __tablename__ = "customer_cases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"), index=True)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id"))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[CaseStatus] = mapped_column(
        str_enum(CaseStatus, "case_status"), default=CaseStatus.OPEN
    )
    action_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("actions.id"), index=True)


class Notification(CreatedAtMixin, Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"), index=True)
    channel: Mapped[NotificationChannel] = mapped_column(
        str_enum(NotificationChannel, "notification_channel")
    )
    template: Mapped[str] = mapped_column(String(64))
    action_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("actions.id"), index=True)
