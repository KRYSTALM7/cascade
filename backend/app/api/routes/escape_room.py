"""Escape Room: adversarial scenarios replayed through the normal pipeline (DEMO_MODE only)."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import Context
from app.core.errors import CascadeError, ErrorCode
from app.services.escape_room import SCENARIOS, EscapeRoomService, Scenario, ScenarioResult

router = APIRouter(prefix="/api/escape-room", tags=["escape-room"])


@router.get("", response_model=list[Scenario])
def list_scenarios() -> list[Scenario]:
    return SCENARIOS


@router.post("/{scenario_id}/run", response_model=ScenarioResult)
def run_scenario(scenario_id: str, ctx: Context) -> ScenarioResult:
    if not ctx.settings.demo_mode:
        raise CascadeError(
            ErrorCode.DEMO_MODE_DISABLED,
            "Escape Room scenarios change demo data and run only with DEMO_MODE=true.",
            http_status=403,
        )
    return EscapeRoomService(ctx).run(scenario_id)
