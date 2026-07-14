"""Alpha Vantage provider (keyed).

Provides history, quote, company overview / fundamentals, symbol search and
news+sentiment. Requires ``ALPHAVANTAGE_API_KEY``. The free tier is rate
limited (about 25 requests/day, 5/minute) — the app caches aggressively and
surfaces a clear rate-limit message when the quota is hit.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from app.config import get_settings
from app.providers.base import (
    MarketDataProvider,
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

_BASE = "https://www.alphavantage.co/query"


def _f(value) -> float | None:
    try:
        if value in (None, "", "None", "-"):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


class AlphaVantageProvider(MarketDataProvider):
    name = "Alpha Vantage"
    is_demo = False

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or get_settings().alphavantage_api_key
        if not self.api_key:
            raise ProviderNotConfigured(
                "Alpha Vantage API key is not set.",
                setup_hint="Set ALPHAVANTAGE_API_KEY in backend/.env (free key: "
                "https://www.alphavantage.co/support/#api-key).",
            )

    def _provenance(self, note: str | None = None) -> Provenance:
        return Provenance(
            source="Alpha Vantage",
            as_of=datetime.now(timezone.utc),
            is_demo=False,
            delay_note=note or "End-of-day / delayed data depending on plan",
        )

    async def _query(self, params: dict) -> dict:
        params = {**params, "apikey": self.api_key}
        data = await get_json(_BASE, params=params)
        if isinstance(data, dict):
            if "Note" in data or "Information" in data:
                raise RateLimited(data.get("Note") or data.get("Information"))
            if "Error Message" in data:
                raise SymbolNotFound(params.get("symbol", "?"))
        return data

    async def get_daily_history(
        self, ticker: str, start: date | None = None, end: date | None = None
    ) -> list[OHLCV]:
        data = await self._query(
            {"function": "TIME_SERIES_DAILY", "symbol": ticker, "outputsize": "full"}
        )
        series = data.get("Time Series (Daily)")
        if not series:
            raise SymbolNotFound(ticker)
        bars: list[OHLCV] = []
        for day, row in series.items():
            d = datetime.strptime(day, "%Y-%m-%d").date()
            if start and d < start:
                continue
            if end and d > end:
                continue
            close = _f(row.get("4. close")) or 0.0
            bars.append(
                OHLCV(
                    date=d,
                    open=_f(row.get("1. open")) or close,
                    high=_f(row.get("2. high")) or close,
                    low=_f(row.get("3. low")) or close,
                    close=close,
                    adj_close=close,  # TIME_SERIES_DAILY is unadjusted on free tier
                    volume=_f(row.get("5. volume")) or 0.0,
                )
            )
        bars.sort(key=lambda b: b.date)
        return bars

    async def get_quote(self, ticker: str) -> Quote:
        data = await self._query({"function": "GLOBAL_QUOTE", "symbol": ticker})
        q = data.get("Global Quote") or {}
        price = _f(q.get("05. price"))
        if price is None:
            raise SymbolNotFound(ticker)
        prev = _f(q.get("08. previous close")) or price
        return Quote(
            ticker=ticker.upper(),
            price=price,
            change=_f(q.get("09. change")) or (price - prev),
            change_percent=_f((q.get("10. change percent") or "0").rstrip("%")) or 0.0,
            previous_close=prev,
            open=_f(q.get("02. open")),
            day_high=_f(q.get("03. high")),
            day_low=_f(q.get("04. low")),
            volume=_f(q.get("06. volume")),
            provenance=self._provenance(),
        )

    async def get_profile(self, ticker: str) -> CompanyProfile:
        data = await self._query({"function": "OVERVIEW", "symbol": ticker})
        if not data or not data.get("Symbol"):
            # Overview unavailable (e.g. ETF/index); return minimal profile.
            return CompanyProfile(
                ticker=ticker.upper(), name=ticker.upper(), provenance=self._provenance()
            )
        return CompanyProfile(
            ticker=ticker.upper(),
            name=data.get("Name"),
            exchange=data.get("Exchange"),
            currency=data.get("Currency", "USD"),
            sector=data.get("Sector"),
            industry=data.get("Industry"),
            market_cap=_f(data.get("MarketCapitalization")),
            description=data.get("Description"),
            provenance=self._provenance(),
        )

    async def get_fundamentals(self, ticker: str) -> Fundamentals | None:
        data = await self._query({"function": "OVERVIEW", "symbol": ticker})
        if not data or not data.get("Symbol"):
            return None
        return Fundamentals(
            ticker=ticker.upper(),
            revenue=_f(data.get("RevenueTTM")),
            net_income=None,
            free_cash_flow=None,
            gross_margin=_f(data.get("GrossProfitTTM")),
            operating_margin=_f(data.get("OperatingMarginTTM")),
            net_margin=_f(data.get("ProfitMargin")),
            total_debt=None,
            total_cash=None,
            shares_outstanding=_f(data.get("SharesOutstanding")),
            revenue_growth_yoy=_f(data.get("QuarterlyRevenueGrowthYOY")),
            earnings_growth_yoy=_f(data.get("QuarterlyEarningsGrowthYOY")),
            pe_ratio=_f(data.get("PERatio")),
            forward_pe=_f(data.get("ForwardPE")),
            peg_ratio=_f(data.get("PEGRatio")),
            price_to_sales=_f(data.get("PriceToSalesRatioTTM")),
            ev_to_ebitda=_f(data.get("EVToEBITDA")),
            dividend_yield=_f(data.get("DividendYield")),
            provenance=self._provenance(),
        )

    async def get_news(self, ticker: str, limit: int = 10) -> list[NewsItem]:
        data = await self._query(
            {"function": "NEWS_SENTIMENT", "tickers": ticker, "limit": str(limit)}
        )
        feed = data.get("feed") or []
        items: list[NewsItem] = []
        for entry in feed[:limit]:
            score = None
            for ts in entry.get("ticker_sentiment", []):
                if ts.get("ticker", "").upper() == ticker.upper():
                    score = _f(ts.get("ticker_sentiment_score"))
                    break
            if score is None:
                score = _f(entry.get("overall_sentiment_score"))
            published = None
            if entry.get("time_published"):
                try:
                    published = datetime.strptime(entry["time_published"], "%Y%m%dT%H%M%S")
                except ValueError:
                    published = None
            items.append(
                NewsItem(
                    headline=entry.get("title", ""),
                    summary=entry.get("summary"),
                    url=entry.get("url"),
                    source=entry.get("source"),
                    published_at=published,
                    sentiment_score=score,
                    sentiment_label=entry.get("overall_sentiment_label"),
                )
            )
        return items

    async def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        data = await self._query({"function": "SYMBOL_SEARCH", "keywords": query})
        matches = data.get("bestMatches") or []
        out: list[SearchResult] = []
        for m in matches[:limit]:
            out.append(
                SearchResult(
                    ticker=m.get("1. symbol", ""),
                    name=m.get("2. name"),
                    exchange=m.get("4. region"),
                    type=m.get("3. type"),
                )
            )
        return out
