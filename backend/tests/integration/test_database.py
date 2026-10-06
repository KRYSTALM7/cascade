"""Real-PostgreSQL tests: readiness against a live DB and migration round-trip."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.session import get_db

pytestmark = pytest.mark.db

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _alembic_config(url: str) -> Config:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.attributes["database_url"] = url
    cfg.attributes["configure_logger"] = False
    return cfg


def test_readyz_ok_against_real_database(app: FastAPI, db_engine: Engine) -> None:
    factory = sessionmaker(bind=db_engine)

    def _db() -> Iterator[Session]:
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    with TestClient(app) as c:
        response = c.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ok"}


def test_migrations_have_single_head() -> None:
    script = ScriptDirectory.from_config(_alembic_config("postgresql+psycopg://unused/x"))
    assert len(script.get_heads()) == 1, "diverged migration history"


def test_migrations_upgrade_and_downgrade_round_trip(db_engine: Engine, test_db_url: str) -> None:
    cfg = _alembic_config(test_db_url)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    head = ScriptDirectory.from_config(cfg).get_current_head()
    with db_engine.connect() as conn:
        current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert current == head

    command.downgrade(cfg, "base")
    with db_engine.connect() as conn:
        remaining = conn.execute(text("SELECT count(*) FROM alembic_version")).scalar_one()
    assert remaining == 0

    command.upgrade(cfg, "head")  # leave the DB at head for later tests


def test_models_and_migrations_have_no_drift(migrated_engine: Engine) -> None:
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from app.models import Base

    with migrated_engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        diff = compare_metadata(ctx, Base.metadata)
    assert diff == [], (
        f"models differ from migrations — run alembic revision --autogenerate: {diff}"
    )
