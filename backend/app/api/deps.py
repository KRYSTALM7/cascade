"""Shared FastAPI dependencies."""

from __future__ import annotations

import hmac
from datetime import UTC, datetime
from typing import Annotated, cast

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import CascadeError, ErrorCode
from app.db.session import get_db
from app.domain.policy.model import Policy
from app.llm.provider import LLMProvider
from app.models import User
from app.services.context import Clock, ServiceContext

DbSession = Annotated[Session, Depends(get_db)]


def get_app_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_policy(request: Request) -> Policy:
    return cast(Policy, request.app.state.policy)


def system_clock() -> datetime:
    return datetime.now(UTC)


AppSettings = Annotated[Settings, Depends(get_app_settings)]
ActivePolicy = Annotated[Policy, Depends(get_policy)]


def get_context(request: Request, db: DbSession) -> ServiceContext:
    state = request.app.state
    return ServiceContext(
        session=db,
        policy=cast(Policy, state.policy),
        llm=cast(LLMProvider, state.llm),
        settings=cast(Settings, state.settings),
        clock=cast(Clock, state.clock),
    )


Context = Annotated[ServiceContext, Depends(get_context)]


def get_current_user(
    db: DbSession, x_user_id: Annotated[str | None, Header(max_length=64)] = None
) -> User:
    """Demo auth: the caller names a seeded user in X-User-Id. Unknown or missing -> 401."""
    user = db.get(User, x_user_id) if x_user_id else None
    if user is None:
        raise CascadeError(
            ErrorCode.USER_UNKNOWN,
            "Send X-User-Id with a known user (e.g. ops-ravi, approver-asha).",
            http_status=401,
            details={"user_id": x_user_id},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_private_demo(
    settings: AppSettings,
    x_demo_admin_token: Annotated[str | None, Header(max_length=256)] = None,
) -> None:
    """Operations that change the SHARED demo data for everyone (reset, Escape Room runs) are
    refused on a public instance unless the caller presents the presenter's admin token.
    The token travels in a custom header, so a cross-site form/fetch cannot send it."""
    if not settings.is_public:
        return
    expected = settings.demo_admin_token
    if (
        expected is not None
        and x_demo_admin_token is not None
        and hmac.compare_digest(x_demo_admin_token.encode(), expected.get_secret_value().encode())
    ):
        return
    raise CascadeError(
        ErrorCode.PUBLIC_MODE_RESTRICTED,
        "This operation changes the shared demo data and is unavailable on the public demo. "
        "Use a private presenter environment.",
        http_status=403,
    )


PrivateDemo = Depends(require_private_demo)
