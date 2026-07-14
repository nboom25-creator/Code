"""Twelve Data provider (keyed) — real-time quotes in a single source.

Twelve Data is the recommended provider for real-time behaviour: one free API key
gives real-time/near-real-time quotes, 5+ years of daily history, company profile,
valuation statistics and symbol search. Free tier: ~800 requests/day, 8/minute —
the app caches aggressively and surfaces a clear rate-limit message when hit.

Get a free key: https://twelvedata.com/pricing (Basic/free plan).
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from app.config import get_settings
from app.providers.base import (
    MarketDataProvider,
    ProviderError,
    ProviderNotConfigured,
    RateLimited,
    SymbolNotFound,
)
from app.providers.http import get_json
from app.schemas import (
    CompanyProfile,
    Fundamentals,
    OHLCV,
    Provenance,
    Quote,
    SearchResult,
)

_BASE = "https://api.twelvedata.com"


def _f(value) -> float | None:
    try:
        if value in (None, "", "None"):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


class TwelveDataProvider(MarketDataProvider):
    name = "Twelve Data"
    is_demo = False

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or get_settings().twelvedata_api_key
        if not self.api_key:
            raise ProviderNotConfigured(
                "Twelve Data API key is not set.",
                setup_hint="Set TWELVEDATA_API_KEY in backend/.env (free key: "
                "https://twelvedata.com/pricing).",
            )

    def _provenance(self, note: str | None = None, when: datetime | None = None) -> Provenance:
        return Provenance(
            source="Twelve Data",
            as_of=when or datetime.now(timezone.utc),
            is_demo=False,
            delay_note=note,
        )

    async def _get(self, path: str, params: dict) -> dict:
        params = {**params, "apikey": self.api_key}
        data = await get_json(f"{_BASE}{path}", params=params)
        if isinstance(data, dict) and str(data.get("status")) == "error":
            code = data.get("code")
            msg = data.get("message", "Twelve Data error")
            if code == 429 or "limit" in str(msg).lower():
                raise RateLimited(msg)
            if code == 404 or "not found" in str(msg).lower() or "not exist" in str(msg).lower():
                raise SymbolNotFound(params.get("symbol", "?"))
            raise ProviderError(msg, code="upstream_error")
        return data

    async def get_daily_history(
        self, ticker: str, start: date | None = None, end: date | None = None
    ) -> list[OHLCV]:
        data = await self._get(
            "/time_series",
            {"symbol": ticker.upper(), "interval": "1day", "outputsize": "5000", "order": "ASC"},
        )
        values = data.get("values") or []
        if not values:
            raise SymbolNotFound(ticker)
        bars: list[OHLCV] = []
        for row in values:
            try:
                d = datetime.strptime(row["datetime"][:10], "%Y-%m-%d").date()
            except (KeyError, ValueError):
                continue
            if start and d < start:
                continue
            if end and d > end:
                continue
            close = _f(row.get("close"))
            if close is None:
                continue
            bars.append(
                OHLCV(
                    date=d,
                    open=_f(row.get("open")) or close,
                    high=_f(row.get("high")) or close,
                    low=_f(row.get("low")) or close,
                    close=close,
                    adj_close=close,
                    volume=_f(row.get("volume")) or 0.0,
                )
            )
        if not bars:
            raise SymbolNotFound(ticker)
        bars.sort(key=lambda b: b.date)
        return bars

    async def get_quote(self, ticker: str) -> Quote:
        data = await self._get("/quote", {"symbol": ticker.upper()})
        price = _f(data.get("close"))
        if price is None:
            raise SymbolNotFound(ticker)
        prev = _f(data.get("previous_close")) or price
        # Timestamp reflects the last trade/bar time (near real-time when market open).
        when = None
        ts = data.get("timestamp")
        if ts:
            try:
                when = datetime.fromtimestamp(int(ts), tz=timezone.utc)
            except (ValueError, OSError):
                when = None
        market_open = data.get("is_market_open")
        note = "Real-time (market open)" if market_open else "Last close (market closed)"
        return Quote(
            ticker=ticker.upper(),
            price=price,
            change=_f(data.get("change")) or (price - prev),
            change_percent=_f(data.get("percent_change")) or 0.0,
            previous_close=prev,
            open=_f(data.get("open")),
            day_high=_f(data.get("high")),
            day_low=_f(data.get("low")),
            volume=_f(data.get("volume")),
            provenance=self._provenance(note=note, when=when),
        )

    async def get_profile(self, ticker: str) -> CompanyProfile:
        try:
            data = await self._get("/profile", {"symbol": ticker.upper()})
        except (ProviderError, SymbolNotFound):
            data = {}
        # Market cap often lives in /statistics; profile carries descriptive fields.
        return CompanyProfile(
            ticker=ticker.upper(),
            name=data.get("name") or ticker.upper(),
            exchange=data.get("exchange"),
            currency="USD",
            sector=data.get("sector"),
            industry=data.get("industry"),
            market_cap=None,
            description=data.get("description"),
            website=data.get("website"),
            provenance=self._provenance(),
        )

    async def get_fundamentals(self, ticker: str) -> Fundamentals | None:
        try:
            data = await self._get("/statistics", {"symbol": ticker.upper()})
        except (ProviderError, SymbolNotFound, RateLimited):
            return None
        stats = data.get("statistics") or {}
        val = stats.get("valuations_metrics") or {}
        fin = stats.get("financials") or {}
        income = (fin.get("income_statement") or {}) if isinstance(fin, dict) else {}
        div = stats.get("dividends_and_splits") or {}
        if not stats:
            return None
        return Fundamentals(
            ticker=ticker.upper(),
            revenue=_f(income.get("revenue_ttm") or fin.get("revenue_ttm")),
            net_income=_f(income.get("net_income_to_common_ttm")),
            free_cash_flow=None,
            gross_margin=_f(fin.get("gross_margin")),
            operating_margin=_f(fin.get("operating_margin")),
            net_margin=_f(fin.get("profit_margin")),
            total_debt=None,
            total_cash=None,
            shares_outstanding=_f(stats.get("shares_outstanding")),
            revenue_growth_yoy=_f(fin.get("quarterly_revenue_growth")),
            earnings_growth_yoy=_f(fin.get("quarterly_earnings_growth_yoy")),
            pe_ratio=_f(val.get("trailing_pe")),
            forward_pe=_f(val.get("forward_pe")),
            peg_ratio=_f(val.get("peg_ratio")),
            price_to_sales=_f(val.get("price_to_sales_ttm")),
            ev_to_ebitda=_f(val.get("enterprise_to_ebitda")),
            dividend_yield=_f(div.get("forward_annual_dividend_yield")),
            provenance=self._provenance(),
        )

    async def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        data = await self._get("/symbol_search", {"symbol": query})
        out: list[SearchResult] = []
        for m in (data.get("data") or [])[:limit]:
            out.append(
                SearchResult(
                    ticker=m.get("symbol", ""),
                    name=m.get("instrument_name"),
                    exchange=m.get("exchange"),
                    type=m.get("instrument_type"),
                )
            )
        return out
