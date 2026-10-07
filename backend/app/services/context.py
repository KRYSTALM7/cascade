"""Everything a use case needs, injected per request (tests swap the clock / LLM / settings)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import CascadeError, ErrorCode
from app.domain.enums import UserRole
from app.domain.policy.model import Policy
from app.llm.provider import LLMProvider
from app.models import User

Clock = Callable[[], datetime]


@dataclass
class ServiceContext:
    session: Session
    policy: Policy
    llm: LLMProvider
    settings: Settings
    clock: Clock

    def now(self) -> datetime:
        return self.clock()


def require_role(user: User, *roles: UserRole) -> None:
    if user.role not in roles:
        raise CascadeError(
            ErrorCode.ROLE_NOT_PERMITTED,
            f"{user.id} ({user.role}) may not do this.",
            http_status=403,
            details={"user_id": user.id, "role": user.role.value},
        )
