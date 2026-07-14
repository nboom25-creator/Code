"""Finnhub provider (keyed).

Provides quote, company profile, basic financial metrics, symbol search and
company news. Requires ``FINNHUB_API_KEY``. Note: Finnhub's historical daily
candles (``/stock/candle``) now require a paid plan; on the free tier
``get_daily_history`` will raise a clear error and the app can fall back to the
keyless Stooq provider for history while still using Finnhub for fundamentals.
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
    NewsItem,
    OHLCV,
    Provenance,
    Quote,
    SearchResult,
)

_BASE = "https://finnhub.io/api/v1"


def _f(value) -> float | None:
    try:
        return None if value in (None, "") else float(value)
    except (TypeError, ValueError):
        return None


class FinnhubProvider(MarketDataProvider):
    name = "Finnhub"
    is_demo = False

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or get_settings().finnhub_api_key
        if not self.api_key:
            raise ProviderNotConfigured(
                "Finnhub API key is not set.",
                setup_hint="Set FINNHUB_API_KEY in backend/.env (free key: "
                "https://finnhub.io/register).",
            )

    def _provenance(self, note: str | None = None) -> Provenance:
        return Provenance(
            source="Finnhub",
            as_of=datetime.now(timezone.utc),
            is_demo=False,
            delay_note=note,
        )

    async def _get(self, path: str, params: dict) -> dict:
        params = {**params, "token": self.api_key}
        data = await get_json(f"{_BASE}{path}", params=params)
        if isinstance(data, dict) and data.get("error"):
            if "limit" in str(data["error"]).lower():
                raise RateLimited(data["error"])
            raise ProviderError(str(data["error"]))
        return data

    async def get_daily_history(
        self, ticker: str, start: date | None = None, end: date | None = None
    ) -> list[OHLCV]:
        start_ts = int(datetime(2000, 1, 1, tzinfo=timezone.utc).timestamp())
        end_ts = int(datetime.now(timezone.utc).timestamp())
        data = await self._get(
            "/stock/candle",
            {"symbol": ticker.upper(), "resolution": "D", "from": start_ts, "to": end_ts},
        )
        if data.get("s") == "no_access":
            raise ProviderError(
                "Historical candles require a paid Finnhub plan. Use Stooq for "
                "history or upgrade your Finnhub plan.",
                code="upstream_error",
            )
        if data.get("s") != "ok" or not data.get("c"):
            raise SymbolNotFound(ticker)
        bars: list[OHLCV] = []
        for i, ts in enumerate(data["t"]):
            d = datetime.fromtimestamp(ts, tz=timezone.utc).date()
            if start and d < start:
                continue
            if end and d > end:
                continue
            close = float(data["c"][i])
            bars.append(
                OHLCV(
                    date=d,
                    open=float(data["o"][i]),
                    high=float(data["h"][i]),
                    low=float(data["l"][i]),
                    close=close,
                    adj_close=close,
                    volume=float(data["v"][i]),
                )
            )
        bars.sort(key=lambda b: b.date)
        return bars

    async def get_quote(self, ticker: str) -> Quote:
        data = await self._get("/quote", {"symbol": ticker.upper()})
        price = _f(data.get("c"))
        if not price:
            raise SymbolNotFound(ticker)
        prev = _f(data.get("pc")) or price
        return Quote(
            ticker=ticker.upper(),
            price=price,
            change=_f(data.get("d")) or (price - prev),
            change_percent=_f(data.get("dp")) or 0.0,
            previous_close=prev,
            open=_f(data.get("o")),
            day_high=_f(data.get("h")),
            day_low=_f(data.get("l")),
            volume=None,
            provenance=self._provenance("Real-time / delayed depending on plan"),
        )

    async def get_profile(self, ticker: str) -> CompanyProfile:
        data = await self._get("/stock/profile2", {"symbol": ticker.upper()})
        if not data or not data.get("name"):
            return CompanyProfile(
                ticker=ticker.upper(), name=ticker.upper(), provenance=self._provenance()
            )
        return CompanyProfile(
            ticker=ticker.upper(),
            name=data.get("name"),
            exchange=data.get("exchange"),
            currency=data.get("currency", "USD"),
            sector=data.get("finnhubIndustry"),
            industry=data.get("finnhubIndustry"),
            market_cap=(_f(data.get("marketCapitalization")) or 0) * 1_000_000 or None,
            description=None,
            website=data.get("weburl"),
            provenance=self._provenance(),
        )

    async def get_fundamentals(self, ticker: str) -> Fundamentals | None:
        data = await self._get("/stock/metric", {"symbol": ticker.upper(), "metric": "all"})
        m = data.get("metric") or {}
        if not m:
            return None
        return Fundamentals(
            ticker=ticker.upper(),
            revenue=_f(m.get("revenueTTM")),
            net_income=None,
            free_cash_flow=_f(m.get("freeCashFlowTTM")),
            gross_margin=_f(m.get("grossMarginTTM")),
            operating_margin=_f(m.get("operatingMarginTTM")),
            net_margin=_f(m.get("netProfitMarginTTM")),
            total_debt=_f(m.get("totalDebt/totalEquityQuarterly")),
            total_cash=None,
            shares_outstanding=None,
            revenue_growth_yoy=_f(m.get("revenueGrowthTTMYoy")),
            earnings_growth_yoy=_f(m.get("epsGrowthTTMYoy")),
            pe_ratio=_f(m.get("peTTM")),
            forward_pe=_f(m.get("forwardPE")),
            peg_ratio=_f(m.get("pegRatioTTM")),
            price_to_sales=_f(m.get("psTTM")),
            ev_to_ebitda=_f(m.get("currentEv/freeCashFlowTTM")),
            dividend_yield=_f(m.get("dividendYieldIndicatedAnnual")),
            provenance=self._provenance(),
        )

    async def get_news(self, ticker: str, limit: int = 10) -> list[NewsItem]:
        from datetime import timedelta

        today = datetime.now(timezone.utc).date()
        start = today - timedelta(days=30)  # Finnhub company-news window
        data = await self._get(
            "/company-news",
            {"symbol": ticker.upper(), "from": start.isoformat(), "to": today.isoformat()},
        )
        items: list[NewsItem] = []
        if isinstance(data, list):
            for entry in data[:limit]:
                published = None
                if entry.get("datetime"):
                    published = datetime.fromtimestamp(entry["datetime"], tz=timezone.utc)
                items.append(
                    NewsItem(
                        headline=entry.get("headline", ""),
                        summary=entry.get("summary"),
                        url=entry.get("url"),
                        source=entry.get("source"),
                        published_at=published,
                    )
                )
        return items

    async def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        data = await self._get("/search", {"q": query})
        results = data.get("result") or []
        out: list[SearchResult] = []
        for m in results[:limit]:
            out.append(
                SearchResult(
                    ticker=m.get("symbol", ""),
                    name=m.get("description"),
                    exchange=None,
                    type=m.get("type"),
                )
            )
        return out
