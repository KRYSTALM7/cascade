from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import LLMProviderName, Settings


def _settings(**kwargs: object) -> Settings:
    return Settings(_env_file=None, **kwargs)  # type: ignore[arg-type]


def test_defaults_are_safe_for_local_run() -> None:
    s = _settings()
    assert s.llm_provider is LLMProviderName.RULES  # works offline with no key
    assert s.gemini_api_key is None
    assert s.demo_mode is False


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("postgres://u:p@h:5432/d", "postgresql+psycopg://u:p@h:5432/d"),
        ("postgresql://u:p@h/d", "postgresql+psycopg://u:p@h/d"),
        ("postgresql+psycopg://u:p@h/d", "postgresql+psycopg://u:p@h/d"),
    ],
)
def test_database_url_is_normalised_to_psycopg(raw: str, expected: str) -> None:
    assert _settings(database_url=raw).database_url == expected


@pytest.mark.parametrize("bad", ["sqlite:///x.db", "mysql://u@h/d", "postgresql+asyncpg://u@h/d"])
def test_non_postgres_urls_are_rejected(bad: str) -> None:
    with pytest.raises(ValidationError):
        _settings(database_url=bad)


def test_cors_origins_accept_csv_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")
    assert _settings().cors_origins == ["http://a.test", "http://b.test"]


def test_wildcard_cors_is_rejected() -> None:
    with pytest.raises(ValidationError, match="wildcard"):
        _settings(cors_origins=["*"])


def test_gemini_provider_requires_api_key() -> None:
    with pytest.raises(ValidationError, match="GEMINI_API_KEY"):
        _settings(llm_provider="gemini")


@pytest.mark.parametrize("blank", ["", "   "])
def test_blank_api_key_counts_as_missing(blank: str) -> None:
    assert _settings(gemini_api_key=blank).gemini_api_key is None
    with pytest.raises(ValidationError, match="GEMINI_API_KEY"):
        _settings(llm_provider="gemini", gemini_api_key=blank)


def test_blank_api_key_from_env_file_counts_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    with pytest.raises(ValidationError, match="GEMINI_API_KEY"):
        _settings()


def test_api_key_is_never_rendered() -> None:
    s = _settings(llm_provider="gemini", gemini_api_key="super-secret-key")
    assert "super-secret-key" not in repr(s)
    assert "super-secret-key" not in s.model_dump_json()
