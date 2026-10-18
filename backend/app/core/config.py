"""Centralised, typed configuration. The ONLY place that reads environment variables."""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Environment(StrEnum):
    LOCAL = "local"
    TEST = "test"
    PRODUCTION = "production"


class LLMProviderName(StrEnum):
    GEMINI = "gemini"
    RULES = "rules"  # deterministic offline provider (tests, offline demo)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "Cascade"
    environment: Environment = Environment.LOCAL
    log_level: str = "INFO"
    log_json: bool = True

    database_url: str = Field(
        default="postgresql+psycopg://cascade:cascade@localhost:5432/cascade",
        description="SQLAlchemy URL. Must use the psycopg (v3) driver.",
    )
    db_pool_size: int = Field(default=5, ge=1, le=50)
    # Extra connections beyond the pool under burst. Per instance: pool_size + max_overflow.
    db_max_overflow: int = Field(default=10, ge=0, le=50)
    db_echo: bool = False

    # NoDecode: accept "a,b" CSV from env instead of requiring a JSON list.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    llm_provider: LLMProviderName = LLMProviderName.RULES
    gemini_api_key: SecretStr | None = None
    # Comma-separated list of fallback API keys for rotation
    gemini_api_keys: Annotated[list[SecretStr], NoDecode] | None = None
    gemini_model: str = "gemini-3.8-flash"
    llm_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    # Gemini budget per process: at most `llm_call_limit` Gemini requests per window; beyond it
    # the deterministic rules provider answers instead (0 = never call Gemini).
    llm_call_limit: int = Field(default=200, ge=0, le=100_000)
    llm_call_window_seconds: int = Field(default=3600, ge=1, le=86_400)

    demo_mode: bool = False
    # A visitor-facing deployment: shared-state demo operations (reset, Escape Room runs) and the
    # OpenAPI docs are off. Unset = ON when ENVIRONMENT=production, so a cloud deploy is safe by
    # default; a private presenter instance must opt out explicitly with PUBLIC_MODE=false.
    public_mode: bool | None = None
    # Optional: lets a presenter run reset / Escape Room on a public instance by sending the
    # header X-Demo-Admin-Token. Unset = nobody can, on a public instance.
    demo_admin_token: SecretStr | None = None
    policy_path: Path = BACKEND_ROOT / "policy" / "policy.yaml"
    # Tests/demo only: execution of this tool id raises (e.g. "send_customer_notification").
    fault_injection: str | None = None

    @field_validator("database_url")
    @classmethod
    def _require_psycopg_driver(cls, value: str) -> str:
        if value.startswith("postgres://") or value.startswith("postgresql://"):
            # Normalise plain URLs (e.g. from managed providers) to the psycopg v3 driver.
            return "postgresql+psycopg://" + value.split("://", 1)[1]
        if not value.startswith("postgresql+psycopg://"):
            raise ValueError("database_url must be a PostgreSQL URL (postgresql+psycopg://...)")
        return value

    @property
    def is_public(self) -> bool:
        if self.public_mode is None:
            return self.environment is Environment.PRODUCTION
        return self.public_mode

    @field_validator("gemini_api_key", "demo_admin_token", mode="before")
    @classmethod
    def _blank_key_is_no_key(cls, value: object) -> object:
        # `GEMINI_API_KEY=` in a .env file must mean "unset", not "a key that is empty".
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("gemini_api_keys", mode="before")
    @classmethod
    def _parse_api_keys_csv(cls, value: object) -> object:
        """Parse comma-separated API keys from env var."""
        if isinstance(value, str) and value.strip():
            # Split by comma and filter out blank keys
            keys = [k.strip() for k in value.split(",") if k.strip()]
            return [SecretStr(k) for k in keys] if keys else None
        return value

    @field_validator("public_mode", mode="before")
    @classmethod
    def _blank_public_mode_is_unset(cls, value: object) -> object:
        # `PUBLIC_MODE=` must fall back to the safe environment default, not fail or mean false.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip().startswith("["):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def _no_wildcard_origin(cls, value: list[str]) -> list[str]:
        if "*" in value:
            raise ValueError("wildcard CORS origin is not allowed; list explicit origins")
        return value

    @model_validator(mode="after")
    def _gemini_needs_key(self) -> Self:
        if (
            self.llm_provider is LLMProviderName.GEMINI
            and not self.gemini_api_key
            and not self.gemini_api_keys
        ):
            raise ValueError(
                "LLM_PROVIDER=gemini requires GEMINI_API_KEY or GEMINI_API_KEYS to be set"
            )
        return self

    @property
    def all_gemini_keys(self) -> list[str]:
        """Get all configured Gemini API keys (primary + fallbacks)."""
        keys = []
        if self.gemini_api_key:
            keys.append(self.gemini_api_key.get_secret_value())
        if self.gemini_api_keys:
            keys.extend(k.get_secret_value() for k in self.gemini_api_keys)
        return keys


@lru_cache
def get_settings() -> Settings:
    return Settings()
