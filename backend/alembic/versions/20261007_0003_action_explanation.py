"""Actions: current report pointer + the latest narrative (LLM or template) shown with it.

`current_report_id` has no FK (consequence_reports already references actions; a pointer back
keeps the cycle out of the schema). Timestamps cannot order reports: now() is per transaction.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-07 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("actions", sa.Column("current_report_id", sa.Uuid(), nullable=True))
    op.add_column(
        "actions",
        sa.Column(
            "explanation", postgresql.JSONB(none_as_null=True, astext_type=sa.Text()), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column("actions", "explanation")
    op.drop_column("actions", "current_report_id")
