"""Centralised, typed configuration. The ONLY place that reads environment variables."""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from typing import Annotated, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


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
    db_echo: bool = False

    # NoDecode: accept "a,b" CSV from env instead of requiring a JSON list.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    llm_provider: LLMProviderName = LLMProviderName.RULES
    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-2.5-flash"
    llm_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    demo_mode: bool = False

    @field_validator("database_url")
    @classmethod
    def _require_psycopg_driver(cls, value: str) -> str:
        if value.startswith("postgres://") or value.startswith("postgresql://"):
            # Normalise plain URLs (e.g. from managed providers) to the psycopg v3 driver.
            return "postgresql+psycopg://" + value.split("://", 1)[1]
        if not value.startswith("postgresql+psycopg://"):
            raise ValueError("database_url must be a PostgreSQL URL (postgresql+psycopg://...)")
        return value

    @field_validator("gemini_api_key", mode="before")
    @classmethod
    def _blank_key_is_no_key(cls, value: object) -> object:
        # `GEMINI_API_KEY=` in a .env file must mean "unset", not "a key that is empty".
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
        if self.llm_provider is LLMProviderName.GEMINI and not self.gemini_api_key:
            raise ValueError("LLM_PROVIDER=gemini requires GEMINI_API_KEY to be set")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
