"""Application configuration loaded from environment variables.

All secrets (API keys) are read here on the server side only and are never
sent to the client. See ``.env.example`` for the full list of variables.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the StockCast API.

    ``PROVIDER`` selects the active market-data source. When a keyed provider
    is chosen but its key is missing, the API surfaces a clear setup message
    rather than silently falling back to fabricated data.
    """

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # ---- Data provider selection -------------------------------------------
    # One of: "stooq" (keyless), "alphavantage", "finnhub", "demo".
    provider: str = "stooq"

    # Optional API keys (server-side only).
    alphavantage_api_key: str | None = None
    finnhub_api_key: str | None = None

    # ---- Behaviour ----------------------------------------------------------
    # Allow the DEMO DATA provider to be used as an automatic fallback when a
    # real provider is unreachable or unconfigured. When False, the API returns
    # an explicit setup error instead of demo data.
    allow_demo_fallback: bool = True

    # Cache time-to-live in seconds for market data responses. Respects that
    # end-of-day history changes at most daily; intraday quotes are short.
    cache_ttl_history_seconds: int = 6 * 60 * 60
    cache_ttl_quote_seconds: int = 60
    cache_ttl_fundamentals_seconds: int = 24 * 60 * 60

    cache_db_path: str = "stockcast_cache.sqlite"

    # HTTP client behaviour for outbound provider calls.
    http_timeout_seconds: float = 15.0
    http_max_retries: int = 3

    # CORS origins for the frontend dev server.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
