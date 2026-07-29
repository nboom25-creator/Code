"""Provider resolution.

Resolution is explicit: the operator's configured provider is used, and if it
cannot be constructed the failure is reported rather than silently swapped for a
different source. The one automatic fallback is to the fixture provider, and
that only happens when the configuration asks for it, because synthetic data
must never masquerade as real data.
"""

from __future__ import annotations

from typing import Any

from aegisquant.config import get_settings
from aegisquant.data.providers.base import (
    CalendarProvider,
    CorporateActionProvider,
    EconomicProvider,
    FundamentalsProvider,
    InstrumentProvider,
    NewsProvider,
    PriceProvider,
    Provider,
    ProviderNotConfigured,
    QuoteProvider,
)
from aegisquant.data.providers.calendar_static import StaticCalendarProvider
from aegisquant.data.providers.fixture import FixtureProvider
from aegisquant.logging_setup import get_logger

log = get_logger(__name__)

_CACHE: dict[str, Provider] = {}


def _build(kind: str) -> Provider:
    if kind == "fixture":
        return FixtureProvider()
    if kind == "static":
        return StaticCalendarProvider()
    if kind == "yfinance":
        from aegisquant.data.providers.yfinance_provider import YFinanceProvider

        return YFinanceProvider()
    if kind == "alpaca":
        from aegisquant.data.providers.alpaca import AlpacaProvider

        return AlpacaProvider()
    if kind == "fred":
        from aegisquant.data.providers.fred import FredProvider

        return FredProvider()
    raise ProviderNotConfigured("registry", f"unknown provider '{kind}'")


def get_provider(kind: str) -> Provider:
    prov = _CACHE.get(kind)
    if prov is None:
        prov = _build(kind)
        _CACHE[kind] = prov
    return prov


def reset_providers() -> None:
    _CACHE.clear()


# ---------------------------------------------------------------------------
def price_provider() -> PriceProvider:
    return get_provider(get_settings().price_provider)  # type: ignore[return-value]


def quote_provider() -> QuoteProvider:
    kind = get_settings().price_provider
    prov = get_provider(kind)
    if not isinstance(prov, QuoteProvider):
        raise ProviderNotConfigured(kind, "provider does not supply quotes")
    return prov


def fundamentals_provider() -> FundamentalsProvider:
    return get_provider(get_settings().fundamentals_provider)  # type: ignore[return-value]


def news_provider() -> NewsProvider:
    return get_provider(get_settings().news_provider)  # type: ignore[return-value]


def macro_provider() -> EconomicProvider:
    return get_provider(get_settings().macro_provider)  # type: ignore[return-value]


def calendar_provider() -> CalendarProvider:
    return get_provider(get_settings().calendar_provider)  # type: ignore[return-value]


def corporate_action_provider() -> CorporateActionProvider:
    kind = get_settings().price_provider
    prov = get_provider(kind)
    if not isinstance(prov, CorporateActionProvider):
        raise ProviderNotConfigured(kind, "provider does not supply corporate actions")
    return prov


def instrument_provider() -> InstrumentProvider:
    kind = get_settings().price_provider
    prov = get_provider(kind)
    if not isinstance(prov, InstrumentProvider):
        raise ProviderNotConfigured(kind, "provider cannot enumerate instruments")
    return prov


def secondary_price_provider() -> PriceProvider | None:
    """A second price source for cross-provider disagreement checks, if available."""
    s = get_settings()
    for candidate in ("alpaca", "yfinance"):
        if candidate == s.price_provider:
            continue
        try:
            prov = get_provider(candidate)
        except Exception:
            continue
        if isinstance(prov, PriceProvider):
            return prov
    return None


def provider_health() -> dict[str, Any]:
    """Health of every configured provider. Never raises."""
    s = get_settings()
    kinds = {
        "prices": s.price_provider,
        "fundamentals": s.fundamentals_provider,
        "news": s.news_provider,
        "macro": s.macro_provider,
        "calendar": s.calendar_provider,
    }
    out: dict[str, Any] = {}
    for role, kind in kinds.items():
        try:
            out[role] = get_provider(kind).health()
        except Exception as exc:
            out[role] = {"provider": kind, "ok": False, "error": str(exc)}
    out["any_synthetic"] = any(v.get("synthetic") for v in out.values() if isinstance(v, dict))
    out["all_ok"] = all(v.get("ok") for v in out.values() if isinstance(v, dict))
    return out
