"""Active policy (thresholds, weights, limits) so the UI can show "why" with real numbers."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import ActivePolicy
from app.domain.policy.model import Policy

router = APIRouter(prefix="/api", tags=["policy"])


@router.get("/policy", response_model=Policy)
def get_policy(policy: ActivePolicy) -> Policy:
    return policy
