"""Read access to NovaCart business state."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Customer, Order


class BusinessRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_orders(self) -> Sequence[Order]:
        stmt = select(Order).options(selectinload(Order.customer)).order_by(Order.id)
        return self._session.scalars(stmt).all()

    def get_order(self, order_id: str) -> Order | None:
        stmt = (
            select(Order)
            .where(Order.id == order_id)
            .options(
                selectinload(Order.customer),
                selectinload(Order.items),
                selectinload(Order.payments),
            )
        )
        return self._session.scalars(stmt).one_or_none()

    def find_customers_by_name(self, fragment: str) -> Sequence[Customer]:
        """Case-insensitive substring match; used for clarification ("which John?")."""
        cleaned = fragment.strip()
        if not cleaned:
            return []
        escaped = cleaned.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
        stmt = (
            select(Customer)
            .where(Customer.name.ilike(f"%{escaped}%", escape="\\"))
            .options(selectinload(Customer.orders))
            .order_by(Customer.id)
        )
        return self._session.scalars(stmt).all()
