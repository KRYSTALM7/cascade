"""Real concurrency: separate connections, committed data, parallel threads.

The shared rolled-back test session cannot exercise row locks, so these tests commit a fresh
NovaCart world, run competing use cases on their own sessions, and wipe the data afterwards.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.errors import CascadeError
from app.domain.enums import ActionStatus, OrderStatus
from app.llm.rules import RulesProvider
from app.models import Action, ActionExecution, AuditLog, Order, OrderItem, Payment, Refund, User
from app.schemas.actions import SimulateRequest
from app.seed.novacart import reset_and_seed, wipe
from app.services.actions import ActionService
from app.services.approvals import ApprovalService
from app.services.context import ServiceContext
from app.services.execution import ExecutionService
from tests.conftest import make_settings
from tests.factories import POLICY

pytestmark = pytest.mark.db


@pytest.fixture
def factory(migrated_engine: Engine) -> Iterator[sessionmaker[Session]]:
    make = sessionmaker(bind=migrated_engine, expire_on_commit=False)
    with make() as session:
        reset_and_seed(session)
        session.commit()
    yield make
    with make() as session:
        wipe(session)
        session.commit()


def ctx(session: Session) -> ServiceContext:
    return ServiceContext(
        session=session,
        policy=POLICY,
        llm=RulesProvider(),
        settings=make_settings(),
        clock=lambda: datetime.now(UTC),
    )


def user(session: Session, user_id: str) -> User:
    found = session.get(User, user_id)
    assert found is not None
    return found


def propose(
    make: sessionmaker[Session], agent: str, tool: str, params: dict[str, Any], approve: bool
) -> uuid.UUID:
    with make() as s:
        action = ActionService(ctx(s)).simulate(
            user(s, "ops-ravi"), SimulateRequest(agent_id=agent, tool=tool, parameters=params)
        )
        if approve and action.status is ActionStatus.PENDING_APPROVAL:
            ApprovalService(ctx(s)).approve(user(s, "approver-asha"), action.id, None)
        return action.id


def race(make: sessionmaker[Session], jobs: list[Callable[[Session], Any]]) -> list[Any]:
    """Run jobs at the same instant, each on its own session/connection."""
    barrier = threading.Barrier(len(jobs))
    results: list[Any] = [None] * len(jobs)

    def worker(i: int) -> None:
        with make() as s:
            barrier.wait()
            try:
                results[i] = jobs[i](s)
            except CascadeError as exc:
                s.rollback()
                results[i] = exc

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(len(jobs))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return results


def execute(action_id: uuid.UUID) -> Callable[[Session], Any]:
    def job(s: Session) -> Any:
        return ExecutionService(ctx(s)).execute(user(s, "ops-ravi"), action_id).status

    return job


def test_two_actions_on_one_order_first_wins_second_is_stale(
    factory: sessionmaker[Session],
) -> None:
    """CON-01 (Escape Room 'conflicting instructions'), with genuinely parallel executions."""
    cancel = propose(factory, "customer-support", "cancel_order", {"order_id": "ORD-10540"}, True)
    modify = propose(
        factory,
        "order",
        "modify_order",
        {"order_id": "ORD-10540", "lines": [{"sku": "SKU-LAP-001", "quantity": 2}]},
        True,
    )
    results = race(factory, [execute(cancel), execute(modify)])

    winners = [r for r in results if r == ActionStatus.EXECUTED]
    losers = [r for r in results if isinstance(r, CascadeError)]
    assert len(winners) == 1 and len(losers) == 1, results
    assert losers[0].code == "STALE_STATE"

    with factory() as s:
        order = s.get(Order, "ORD-10540")
        line = s.scalars(select(OrderItem).where(OrderItem.order_id == "ORD-10540")).one()
        statuses = {aid: s.get_one(Action, aid).status for aid in (cancel, modify)}
        assert order is not None
        if results[0] == ActionStatus.EXECUTED:  # cancel won
            assert (order.status, line.quantity) == (OrderStatus.CANCELLED, 1)
            assert statuses[modify] is ActionStatus.STALE
        else:  # modify won
            assert (order.status, line.quantity) == (OrderStatus.CONFIRMED, 2)
            assert statuses[cancel] is ActionStatus.STALE


def test_parallel_duplicate_execute_applies_once(factory: sessionmaker[Session]) -> None:
    """EXE-04 under real concurrency."""
    hero = propose(factory, "customer-support", "cancel_order", {"order_id": "ORD-10482"}, True)
    results = race(factory, [execute(hero), execute(hero), execute(hero)])
    assert results == [ActionStatus.EXECUTED] * 3
    with factory() as s:
        refunds = s.scalar(select(func.count()).select_from(Refund).where(Refund.action_id == hero))
        attempts = s.scalar(
            select(func.count())
            .select_from(ActionExecution)
            .where(ActionExecution.action_id == hero)
        )
        payment = s.get(Payment, "PAY-90482")
        assert (refunds, attempts) == (1, 1)
        assert payment is not None and payment.refunded_amount == Decimal("84500.00")


def test_parallel_duplicate_approval_is_recorded_once(factory: sessionmaker[Session]) -> None:
    hero = propose(factory, "customer-support", "cancel_order", {"order_id": "ORD-10482"}, False)

    def approve(s: Session) -> Any:
        return ApprovalService(ctx(s)).approve(user(s, "approver-asha"), hero, None).status

    assert race(factory, [approve, approve]) == [ActionStatus.APPROVED] * 2
    with factory() as s:
        approvals = s.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.action_id == hero, AuditLog.event_type == "APPROVED")
        )
        assert approvals == 1


def test_change_committed_by_another_connection_makes_execution_stale(
    factory: sessionmaker[Session],
) -> None:
    """CON-02/CON-03 with a real second writer."""
    hero = propose(factory, "customer-support", "cancel_order", {"order_id": "ORD-10482"}, True)
    with factory() as other:
        other.execute(
            update(Order).where(Order.id == "ORD-10482").values(version=Order.version + 1)
        )
        other.commit()
    with factory() as s, pytest.raises(CascadeError) as exc:
        ExecutionService(ctx(s)).execute(user(s, "ops-ravi"), hero)
    assert exc.value.code == "STALE_STATE"
    with factory() as s:
        order = s.get(Order, "ORD-10482")
        assert order is not None and order.status is OrderStatus.CONFIRMED
