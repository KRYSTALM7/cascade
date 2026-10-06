"""Reusable column types and mixins."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, Enum, Integer, Numeric, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

# INR to the paisa. 12 digits = up to ₹9,999,999,999.99 — ample for the demo domain.
Money = Numeric(12, 2, asdecimal=True)
JSON = JSONB(none_as_null=True)


def str_enum(enum_cls: type[StrEnum], name: str) -> Enum:
    """VARCHAR + CHECK constraint (portable, migration-friendly; no native PG enum churn)."""
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=32,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class VersionedMixin:
    """Optimistic concurrency: SQLAlchemy bumps `version` on every UPDATE and adds
    `WHERE version = <loaded>`; a concurrent writer therefore raises StaleDataError instead of
    silently overwriting. Simulation fingerprints read versions; execution re-checks them."""

    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:  # noqa: N805 - declarative classmethod-style
        return {"version_id_col": cls.__table__.c.version}  # type: ignore[attr-defined]
