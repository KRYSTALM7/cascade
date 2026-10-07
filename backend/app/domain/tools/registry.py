"""Tool id -> simulator. Must match the `tools` table exactly (tested), so a catalog tool without
code behaviour (or vice versa) is caught before it can reach a demo."""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Any

from app.domain.tools import crm, finance, inventory, orders
from app.domain.tools.base import ToolSimulator


def _build() -> Mapping[str, ToolSimulator[Any]]:
    registry: dict[str, ToolSimulator[Any]] = {}
    for module in (orders, finance, inventory, crm):
        for sim in module.SIMULATORS:
            if sim.tool_id in registry:
                raise RuntimeError(f"duplicate simulator for {sim.tool_id}")
            registry[sim.tool_id] = sim
    return MappingProxyType(dict(sorted(registry.items())))


SIMULATORS: Mapping[str, ToolSimulator[Any]] = _build()


def param_schema(tool_id: str) -> dict[str, Any]:
    """JSON schema of a tool's parameters (UI forms, LLM prompts)."""
    schema: dict[str, Any] = SIMULATORS[tool_id].params_model.model_json_schema()
    return schema
