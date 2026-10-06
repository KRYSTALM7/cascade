"""Shared fixtures.

Unit/API tests need no database. Tests marked `db` use TEST_DATABASE_URL and are skipped (with a
clear reason) when it is unreachable — unless REQUIRE_DB=1, in which case they fail loudly (CI).
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import Environment, Settings
from app.db.session import get_db
from app.main import create_app
from app.seed.novacart import reset_and_seed

DEFAULT_TEST_DB = "postgresql+psycopg://cascade:cascade@localhost:5432/cascade_test"


_TEST_CONTROL_VARS = {"TEST_DATABASE_URL", "REQUIRE_DB"}


@pytest.fixture(autouse=True)
def _isolate_settings_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests must not depend on the developer's shell/.env (the Makefile exports .env)."""
    for field in Settings.model_fields:
        name = field.upper()
        if name not in _TEST_CONTROL_VARS:
            monkeypatch.delenv(name, raising=False)


def make_settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "environment": Environment.TEST,
        "database_url": os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB),
        "log_json": True,
        "log_level": "WARNING",
        "cors_origins": ["http://localhost:5173"],
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)  # type: ignore[arg-type]


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def test_db_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB)


@pytest.fixture(scope="session")
def db_engine(test_db_url: str) -> Iterator[Engine]:
    engine = create_engine(test_db_url, pool_pre_ping=True)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except OperationalError as exc:
        engine.dispose()
        if os.environ.get("REQUIRE_DB") == "1":
            pytest.fail(f"REQUIRE_DB=1 but test database is unreachable: {exc}")
        pytest.skip(f"test database unreachable at {test_db_url} (run `make db-up`)")
    yield engine
    engine.dispose()


@pytest.fixture(scope="session")
def migrated_engine(db_engine: Engine, test_db_url: str) -> Engine:
    """Schema at head, once per test session."""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    cfg.attributes["database_url"] = test_db_url
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
    return db_engine


@pytest.fixture
def db_session(migrated_engine: Engine) -> Iterator[Session]:
    """Seeded NovaCart inside an outer transaction that is ROLLED BACK after the test, so every
    test starts from identical state regardless of order. Code under test may commit freely:
    commits release SAVEPOINTs, never the outer transaction."""
    connection = migrated_engine.connect()
    outer = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        reset_and_seed(session)
        session.flush()
        session.expire_all()  # behave like a fresh request session: reload with ORDER BY
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()


@pytest.fixture
def db_client(app: FastAPI, db_session: Session) -> Iterator[TestClient]:
    """API client whose requests all share the seeded, rolled-back test session."""

    def _override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
