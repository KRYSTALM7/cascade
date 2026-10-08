"""Pick the configured provider. `rules` (default) needs nothing; `gemini` needs GEMINI_API_KEY."""

from __future__ import annotations

from app.core.config import LLMProviderName, Settings
from app.llm.budget import BudgetedProvider, CallBudget
from app.llm.gemini import GeminiProvider, sdk_transport
from app.llm.provider import LLMProvider
from app.llm.rules import RulesProvider


def build_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider is LLMProviderName.GEMINI:
        assert settings.gemini_api_key is not None  # enforced by Settings validation
        gemini = GeminiProvider(
            sdk_transport(
                settings.gemini_api_key.get_secret_value(),
                settings.gemini_model,
                settings.llm_timeout_seconds,
            )
        )
        # Never unlimited: past LLM_CALL_LIMIT per window the deterministic provider answers.
        budget = CallBudget(settings.llm_call_limit, settings.llm_call_window_seconds)
        return BudgetedProvider(gemini, RulesProvider(), budget)
    return RulesProvider()
