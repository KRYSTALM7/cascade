"""ORM models. Import every model module here so Alembic autogenerate sees the full metadata.

Populated in Phase 2 (domain model).
"""

from app.db.base import Base

__all__ = ["Base"]
