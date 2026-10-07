"""DB-backed lookups for the clarification rules."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.domain.validation.clarification import CustomerBrief, OrderBrief
from app.models import Customer, InventoryItem, Order, Payment
from app.repositories.business import BusinessRepository

_KINDS: dict[str, type[Customer | Order | Payment | InventoryItem]] = {
    "customer": Customer,
    "order": Order,
    "payment": Payment,
    "sku": InventoryItem,
}


def _brief(customer: Customer) -> CustomerBrief:
    return CustomerBrief(
        id=customer.id,
        name=customer.name,
        tier=customer.tier.value,
        orders=tuple(OrderBrief(o.id, o.status.value, o.total_amount) for o in customer.orders),
    )


class DbDirectory:
    def __init__(self, session: Session) -> None:
        self._session = session

    def customers_named(self, name: str) -> Sequence[CustomerBrief]:
        return [_brief(c) for c in BusinessRepository(self._session).find_customers_by_name(name)]

    def customer(self, customer_id: str) -> CustomerBrief | None:
        customer = self._session.get(Customer, customer_id)
        return _brief(customer) if customer else None

    def exists(self, kind: str, entity_id: str) -> bool:
        return self._session.get(_KINDS[kind], entity_id) is not None
