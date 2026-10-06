"""Baseline: empty schema anchor. Domain tables arrive in 0002 (Phase 2).

Revision ID: 0001
Revises:
Create Date: 2026-10-05
"""

from collections.abc import Sequence

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
