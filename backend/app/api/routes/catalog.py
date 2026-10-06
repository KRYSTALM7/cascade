"""Agents, tools and declared reaction rules (the multi-agent wiring)."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DbSession
from app.core.errors import CascadeError, ErrorCode
from app.models import Agent
from app.repositories.catalog import CatalogRepository
from app.schemas.catalog import (
    AgentDetailOut,
    AgentSummaryOut,
    PermissionOut,
    ReactionOut,
    ToolOut,
)

router = APIRouter(prefix="/api", tags=["catalog"])


def _summary_fields(agent: Agent) -> dict[str, object]:
    return {
        "id": agent.id,
        "name": agent.name,
        "description": agent.description,
        "enabled": agent.enabled,
        "owned_tools": [t.id for t in agent.tools],
        "permitted_tools": sorted(p.tool_id for p in agent.permissions),
    }


@router.get("/agents", response_model=list[AgentSummaryOut])
def list_agents(db: DbSession) -> list[AgentSummaryOut]:
    return [AgentSummaryOut(**_summary_fields(a)) for a in CatalogRepository(db).list_agents()]


@router.get("/agents/{agent_id}", response_model=AgentDetailOut)
def get_agent(agent_id: str, db: DbSession) -> AgentDetailOut:
    agent = CatalogRepository(db).get_agent(agent_id)
    if agent is None:
        raise CascadeError(
            ErrorCode.AGENT_NOT_FOUND,
            f"Agent '{agent_id}' does not exist.",
            http_status=404,
            details={"agent_id": agent_id},
        )
    return AgentDetailOut(
        **_summary_fields(agent),
        tools=[ToolOut.model_validate(t) for t in agent.tools],
        permissions=[
            PermissionOut.model_validate(p)
            for p in sorted(agent.permissions, key=lambda p: p.tool_id)
        ],
        reactions=[
            ReactionOut.model_validate(r)
            for r in sorted(agent.reactions, key=lambda r: (r.event_type, r.priority, r.id))
        ],
    )


@router.get("/tools", response_model=list[ToolOut])
def list_tools(db: DbSession) -> list[ToolOut]:
    return [ToolOut.model_validate(t) for t in CatalogRepository(db).list_tools()]


@router.get("/reactions", response_model=list[ReactionOut])
def list_reactions(db: DbSession) -> list[ReactionOut]:
    """Declared agent behaviour: event -> condition -> agent -> tool."""
    return [ReactionOut.model_validate(r) for r in CatalogRepository(db).list_reactions()]
