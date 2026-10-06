"""Read access to agents, tools, permissions and reaction rules."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Agent, AgentReaction, Tool


class CatalogRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_agents(self) -> Sequence[Agent]:
        stmt = (
            select(Agent)
            .options(selectinload(Agent.tools), selectinload(Agent.permissions))
            .order_by(Agent.id)
        )
        return self._session.scalars(stmt).all()

    def get_agent(self, agent_id: str) -> Agent | None:
        stmt = (
            select(Agent)
            .where(Agent.id == agent_id)
            .options(
                selectinload(Agent.tools),
                selectinload(Agent.permissions),
                selectinload(Agent.reactions),
            )
        )
        return self._session.scalars(stmt).one_or_none()

    def list_tools(self) -> Sequence[Tool]:
        return self._session.scalars(select(Tool).order_by(Tool.owner_agent_id, Tool.id)).all()

    def list_reactions(self) -> Sequence[AgentReaction]:
        stmt = select(AgentReaction).order_by(
            AgentReaction.event_type, AgentReaction.priority, AgentReaction.id
        )
        return self._session.scalars(stmt).all()
