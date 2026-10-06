"""`python -m app.seed [--if-empty]` — wipe and reload the NovaCart demo dataset.

--if-empty  seed only when the catalog is empty (safe to run on every container start).
"""

from __future__ import annotations

import argparse
import json

from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import session_scope
from app.models import Agent
from app.seed.novacart import reset_and_seed


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.seed")
    parser.add_argument("--if-empty", action="store_true", help="skip if data already exists")
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)
    with session_scope() as session:
        if args.if_empty and session.scalar(select(func.count()).select_from(Agent)):
            print(json.dumps({"seeded": False, "reason": "database already has data"}))
            return
        counts = reset_and_seed(session)
    print(json.dumps({"seeded": counts}))


if __name__ == "__main__":
    main()
