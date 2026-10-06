"""Engine and session management. Engines are created lazily so importing the app never connects."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    return create_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        pool_pre_ping=True,  # survive DB restarts / idle disconnects (Cloud Run, docker restarts)
        echo=settings.db_echo,
    )


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request. Services own commit/rollback explicitly."""
    session = get_sessionmaker()()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for scripts (seed, CLI): commit on success, rollback on error."""
    session = get_sessionmaker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ping(session: Session) -> None:
    session.execute(text("SELECT 1"))
