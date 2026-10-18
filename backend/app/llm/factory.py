"""Pick the configured provider. `rules` (default) needs nothing; `gemini` needs GEMINI_API_KEY."""

from __future__ import annotations

from app.core.config import LLMProviderName, Settings
from app.llm.budget import BudgetedProvider, CallBudget
from app.llm.gemini import GeminiProvider, rotating_transport, sdk_transport
from app.llm.provider import LLMProvider
from app.llm.rules import RulesProvider


def build_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider is LLMProviderName.GEMINI:
        api_keys = settings.all_gemini_keys
        assert api_keys  # enforced by Settings validation

        # Use rotating transport if multiple keys, single transport otherwise
        if len(api_keys) > 1:
            transport = rotating_transport(
                api_keys,
                settings.gemini_model,
                settings.llm_timeout_seconds,
            )
        else:
            transport = sdk_transport(
                api_keys[0],
                settings.gemini_model,
                settings.llm_timeout_seconds,
            )

        gemini = GeminiProvider(transport)
        # Never unlimited: past LLM_CALL_LIMIT per window the deterministic provider answers.
        budget = CallBudget(settings.llm_call_limit, settings.llm_call_window_seconds)
        return BudgetedProvider(gemini, RulesProvider(), budget)
    return RulesProvider()
