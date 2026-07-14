"""Market-data provider abstraction.

The rest of the application depends only on this interface, so the underlying
data source can be swapped (Stooq, Alpha Vantage, Finnhub, ...) without any
change to feature engineering, modelling, scoring or presentation code.
"""
from __future__ import annotations

import abc
from datetime import date

from app.schemas import (
    CompanyProfile,
    Fundamentals,
    NewsItem,
    OHLCV,
    Quote,
    SearchResult,
)


class ProviderError(Exception):
    """Base error for provider failures."""

    def __init__(self, message: str, code: str = "provider_error", setup_hint: str | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.setup_hint = setup_hint


class ProviderNotConfigured(ProviderError):
    """Raised when a provider is selected but its API key is missing."""

    def __init__(self, message: str, setup_hint: str | None = None):
        super().__init__(message, code="provider_not_configured", setup_hint=setup_hint)


class RateLimited(ProviderError):
    def __init__(self, message: str = "Provider rate limit reached"):
        super().__init__(message, code="rate_limited")


class SymbolNotFound(ProviderError):
    def __init__(self, ticker: str):
        super().__init__(f"Ticker '{ticker}' not found", code="symbol_not_found")


class MarketDataProvider(abc.ABC):
    """Interface every concrete data source implements."""

    #: Human-readable name surfaced in provenance metadata.
    name: str = "abstract"

    #: True only for synthetic providers whose data must be labelled DEMO DATA.
    is_demo: bool = False

    @abc.abstractmethod
    async def get_daily_history(
        self, ticker: str, start: date | None = None, end: date | None = None
    ) -> list[OHLCV]:
        """Return adjusted daily OHLCV, oldest first. At least 5y when available."""

    @abc.abstractmethod
    async def get_quote(self, ticker: str) -> Quote:
        """Return the latest available price snapshot."""

    async def get_profile(self, ticker: str) -> CompanyProfile:  # optional
        raise NotImplementedError

    async def get_fundamentals(self, ticker: str) -> Fundamentals | None:  # optional
        return None

    async def get_news(self, ticker: str, limit: int = 10) -> list[NewsItem]:  # optional
        return []

    async def search(self, query: str, limit: int = 10) -> list[SearchResult]:  # optional
        return []

    async def close(self) -> None:  # pragma: no cover - lifecycle hook
        return None
