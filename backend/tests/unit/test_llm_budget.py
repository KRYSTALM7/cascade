"""Gemini call budget (LLMB-*): never unlimited; past the cap the deterministic provider answers."""

from __future__ import annotations

import json
from typing import Any

import pytest

from app.core.config import LLMProviderName
from app.llm import factory
from app.llm.budget import BudgetedProvider, CallBudget
from app.llm.gemini import GeminiProvider
from app.llm.rules import RulesProvider
from app.llm.schemas import ParseContext
from tests.conftest import make_settings

CTX = ParseContext(
    agent_id="customer-support",
    permitted_tools=["cancel_order", "modify_order"],
    catalog_tools=["cancel_order", "modify_order"],
    products={"SKU-LAP-001": "NovaBook Pro 14 Laptop"},
)
INTENT = json.dumps({"intent": "cancel_order", "parameters": {"order_id": "ORD-10482"}})


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def gemini(calls: list[str]) -> GeminiProvider:
    def transport(system: str, user: str, schema: dict[str, Any]) -> str:
        calls.append(system)
        return INTENT

    return GeminiProvider(transport)


def test_calls_beyond_the_limit_go_to_the_rules_provider() -> None:
    """LLMB-01: the third request in the window is answered deterministically, and `name`
    reports which provider actually answered (recorded as the action's parser)."""
    calls: list[str] = []
    clock = FakeClock()
    provider = BudgetedProvider(gemini(calls), RulesProvider(), CallBudget(2, 60, clock))
    for _ in range(2):
        assert provider.parse_intent("Cancel ORD-10482", CTX).intent == "cancel_order"
        assert provider.name == "gemini"
    intent = provider.parse_intent("Cancel ORD-10482", CTX)
    assert (intent.intent, intent.parameters.order_id) == ("cancel_order", "ORD-10482")
    assert provider.name == "rules"
    assert len(calls) == 2


def test_the_budget_refills_after_the_window() -> None:
    """LLMB-02"""
    calls: list[str] = []
    clock = FakeClock()
    provider = BudgetedProvider(gemini(calls), RulesProvider(), CallBudget(1, 60, clock))
    provider.parse_intent("Cancel ORD-10482", CTX)
    provider.parse_intent("Cancel ORD-10482", CTX)
    assert len(calls) == 1
    clock.now = 60
    provider.parse_intent("Cancel ORD-10482", CTX)
    assert len(calls) == 2 and provider.name == "gemini"


def test_a_zero_limit_never_calls_gemini() -> None:
    """LLMB-03"""
    calls: list[str] = []
    provider = BudgetedProvider(gemini(calls), RulesProvider(), CallBudget(0, 60))
    provider.parse_intent("Cancel ORD-10482", CTX)
    assert provider.explain is not None
    assert calls == [] and provider.name == "rules"


def test_provider_failure_falls_back_then_recovers_after_cooldown() -> None:
    """AI outage serves deterministic results and a later request probes recovery."""
    clock = FakeClock()
    state = {"available": False, "calls": 0}

    def transport(system: str, user: str, schema: dict[str, Any]) -> str:
        state["calls"] += 1
        if not state["available"]:
            raise RuntimeError("provider unavailable")
        return INTENT

    provider = BudgetedProvider(
        GeminiProvider(transport),
        RulesProvider(),
        CallBudget(10, 60, clock),
        cooldown_seconds=5,
        clock=clock,
    )

    assert provider.parse_intent("Cancel ORD-10482", CTX).intent == "cancel_order"
    assert provider.name == "rules"
    first_attempts = state["calls"]
    assert first_attempts == 1

    provider.parse_intent("Cancel ORD-10482", CTX)
    assert state["calls"] == first_attempts  # cooldown avoids a hot retry loop

    state["available"] = True
    clock.now = 5
    assert provider.parse_intent("Cancel ORD-10482", CTX).intent == "cancel_order"
    assert provider.name == "gemini"
    assert state["calls"] == first_attempts + 1


def test_invalid_gemini_output_falls_back_to_rules_without_retrying() -> None:
    calls = 0

    def invalid_output(system: str, user: str, schema: dict[str, Any]) -> str:
        nonlocal calls
        calls += 1
        return "not valid JSON"

    provider = BudgetedProvider(
        GeminiProvider(invalid_output), RulesProvider(), CallBudget(10, 60)
    )
    intent = provider.parse_intent("Change the laptop quantity to 1 on ORD-10550", CTX)

    assert intent.intent == "modify_order"
    assert intent.parameters.order_id == "ORD-10550"
    assert intent.parameters.sku == "SKU-LAP-001"
    assert intent.parameters.quantity == 1
    assert provider.name == "rules"
    assert calls == 1


def test_semantically_invalid_gemini_tool_falls_back_to_rules() -> None:
    calls = 0

    def unsupported_tool(system: str, user: str, schema: dict[str, Any]) -> str:
        nonlocal calls
        calls += 1
        return json.dumps({"intent": "invented_tool", "parameters": {}})

    provider = BudgetedProvider(
        GeminiProvider(unsupported_tool), RulesProvider(), CallBudget(10, 60)
    )
    intent = provider.parse_intent("Cancel ORD-10482", CTX)

    assert intent.intent == "cancel_order"
    assert intent.parameters.order_id == "ORD-10482"
    assert provider.name == "rules"
    assert calls == 1


def test_gemini_is_always_built_behind_the_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    """LLMB-04: the factory never returns an uncapped Gemini provider; rules stays the default."""
    monkeypatch.setattr(factory, "sdk_transport", lambda *_: lambda *_a: INTENT)
    built = factory.build_provider(
        make_settings(llm_provider=LLMProviderName.GEMINI, gemini_api_key="k", llm_call_limit=7)
    )
    assert isinstance(built, BudgetedProvider)
    assert built.budget.limit == 7
    assert isinstance(factory.build_provider(make_settings()), RulesProvider)
    assert make_settings().llm_provider is LLMProviderName.RULES
