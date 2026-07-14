"""Provider selection and graceful fallback.

Chooses the active provider from settings. For history specifically, if a keyed
provider cannot supply candles (e.g. Finnhub free tier) we transparently use the
keyless Stooq provider so charts still render with *real* data. Demo data is
only ever used when explicitly selected or as a clearly-labelled fallback that
the caller opts into.
"""
from __future__ import annotations

from app.config import get_settings
from app.providers.alphavantage import AlphaVantageProvider
from app.providers.base import MarketDataProvider, ProviderError, ProviderNotConfigured
from app.providers.demo import DemoProvider
from app.providers.finnhub import FinnhubProvider
from app.providers.stooq import StooqProvider
from app.providers.twelvedata import TwelveDataProvider


def build_provider(name: str | None = None) -> MarketDataProvider:
    settings = get_settings()
    name = (name or settings.provider or "stooq").lower()
    if name in ("twelvedata", "twelve_data", "12data"):
        return TwelveDataProvider()
    if name == "stooq":
        return StooqProvider()
    if name == "alphavantage":
        return AlphaVantageProvider()
    if name == "finnhub":
        return FinnhubProvider()
    if name == "demo":
        return DemoProvider()
    raise ProviderError(f"Unknown provider '{name}'", code="config_error")


def get_history_provider(primary: MarketDataProvider) -> MarketDataProvider:
    """Return a provider capable of daily history.

    Twelve Data, Stooq and Alpha Vantage serve history directly. Finnhub's free
    tier does not, so pair it with Stooq for history while keeping Finnhub for
    fundamentals.
    """
    if isinstance(primary, FinnhubProvider):
        try:
            return StooqProvider()
        except ProviderError:
            return primary
    return primary


def demo_provider() -> DemoProvider:
    return DemoProvider()


def benchmark_symbol(provider: MarketDataProvider) -> str:
    """S&P 500 symbol appropriate for the given provider.

    Stooq exposes the index as ``^spx``; keyed providers reliably serve the SPY
    ETF as a real-time S&P 500 proxy; the demo provider has its own ``^GSPC``.
    """
    if provider.is_demo:
        return "^GSPC"
    if isinstance(provider, StooqProvider):
        return "^SPX"
    return "SPY"
