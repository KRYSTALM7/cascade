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
