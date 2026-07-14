"""DEMO DATA provider.

Generates deterministic, clearly-synthetic market data so the application runs
end-to-end without network access or API keys. Every value produced here is
flagged ``is_demo=True`` and must be labelled **DEMO DATA** in the UI. It is
NEVER presented as real market data.

Determinism: a per-ticker integer seed drives a geometric-Brownian-motion price
path, so the same ticker always yields the same history (reproducible tests and
demos) while different tickers look distinct. Values are plausible but invented.
"""
from __future__ import annotations

import hashlib
import math
from datetime import date, datetime, timedelta, timezone

import numpy as np

from app.providers.base import MarketDataProvider, SymbolNotFound
from app.schemas import (
    CompanyProfile,
    Fundamentals,
    NewsItem,
    OHLCV,
    Provenance,
    Quote,
    SearchResult,
)

# A small catalogue of well-known symbols so search / random selection work.
DEMO_CATALOG: dict[str, dict] = {
    "AAPL": {"name": "Apple Inc.", "sector": "Technology", "industry": "Consumer Electronics", "start": 30.0, "drift": 0.00045, "vol": 0.018},
    "MSFT": {"name": "Microsoft Corporation", "sector": "Technology", "industry": "Software—Infrastructure", "start": 90.0, "drift": 0.00050, "vol": 0.017},
    "GOOGL": {"name": "Alphabet Inc.", "sector": "Communication Services", "industry": "Internet Content & Information", "start": 55.0, "drift": 0.00042, "vol": 0.019},
    "AMZN": {"name": "Amazon.com, Inc.", "sector": "Consumer Cyclical", "industry": "Internet Retail", "start": 75.0, "drift": 0.00040, "vol": 0.022},
    "NVDA": {"name": "NVIDIA Corporation", "sector": "Technology", "industry": "Semiconductors", "start": 12.0, "drift": 0.00090, "vol": 0.030},
    "META": {"name": "Meta Platforms, Inc.", "sector": "Communication Services", "industry": "Internet Content & Information", "start": 110.0, "drift": 0.00035, "vol": 0.024},
    "TSLA": {"name": "Tesla, Inc.", "sector": "Consumer Cyclical", "industry": "Auto Manufacturers", "start": 20.0, "drift": 0.00060, "vol": 0.035},
    "JPM": {"name": "JPMorgan Chase & Co.", "sector": "Financial Services", "industry": "Banks—Diversified", "start": 80.0, "drift": 0.00025, "vol": 0.016},
    "JNJ": {"name": "Johnson & Johnson", "sector": "Healthcare", "industry": "Drug Manufacturers—General", "start": 95.0, "drift": 0.00015, "vol": 0.011},
    "KO": {"name": "The Coca-Cola Company", "sector": "Consumer Defensive", "industry": "Beverages—Non-Alcoholic", "start": 40.0, "drift": 0.00012, "vol": 0.010},
    "V": {"name": "Visa Inc.", "sector": "Financial Services", "industry": "Credit Services", "start": 60.0, "drift": 0.00038, "vol": 0.015},
    "WMT": {"name": "Walmart Inc.", "sector": "Consumer Defensive", "industry": "Discount Stores", "start": 35.0, "drift": 0.00028, "vol": 0.012},
    "DIS": {"name": "The Walt Disney Company", "sector": "Communication Services", "industry": "Entertainment", "start": 90.0, "drift": 0.00010, "vol": 0.018},
    "NFLX": {"name": "Netflix, Inc.", "sector": "Communication Services", "industry": "Entertainment", "start": 45.0, "drift": 0.00055, "vol": 0.028},
    "^GSPC": {"name": "S&P 500 Index", "sector": "Index", "industry": "Broad Market", "start": 1300.0, "drift": 0.00030, "vol": 0.011},
}

BENCHMARK_TICKER = "^GSPC"


def _seed(ticker: str) -> int:
    return int(hashlib.sha256(ticker.upper().encode()).hexdigest(), 16) % (2**32)


def _trading_days(years: int) -> list[date]:
    """Business days (Mon-Fri) for the last ``years`` years, ending today."""
    end = date.today()
    start = end - timedelta(days=int(years * 365.25) + 5)
    days: list[date] = []
    d = start
    while d <= end:
        if d.weekday() < 5:  # skip weekends
            days.append(d)
        d += timedelta(days=1)
    return days


def _params(ticker: str) -> dict:
    t = ticker.upper()
    if t in DEMO_CATALOG:
        return DEMO_CATALOG[t]
    # Deterministic pseudo-company for unknown tickers so the demo still works.
    rng = np.random.default_rng(_seed(t))
    return {
        "name": f"{t} Demo Corp.",
        "sector": "Technology",
        "industry": "Software—Application",
        "start": float(rng.uniform(20, 200)),
        "drift": float(rng.uniform(0.0001, 0.0006)),
        "vol": float(rng.uniform(0.012, 0.030)),
    }


class DemoProvider(MarketDataProvider):
    name = "DEMO DATA (synthetic)"
    is_demo = True

    def _provenance(self, note: str | None = None) -> Provenance:
        return Provenance(
            source=self.name,
            as_of=datetime.now(timezone.utc),
            is_demo=True,
            delay_note=note or "Synthetic data — not real market prices",
        )

    def _generate(self, ticker: str, years: int = 6) -> list[OHLCV]:
        p = _params(ticker)
        days = _trading_days(years)
        rng = np.random.default_rng(_seed(ticker))
        n = len(days)
        # GBM log-returns with mild autocorrelation to make indicators meaningful.
        shocks = rng.normal(p["drift"], p["vol"], n)
        # add a slow cyclical component (market regimes)
        cycle = 0.0009 * np.sin(np.linspace(0, 6 * math.pi, n))
        log_rets = shocks + cycle
        prices = p["start"] * np.exp(np.cumsum(log_rets))
        bars: list[OHLCV] = []
        for i, d in enumerate(days):
            close = float(prices[i])
            intraday = abs(rng.normal(0, p["vol"])) * close
            high = close + intraday * rng.uniform(0.2, 1.0)
            low = close - intraday * rng.uniform(0.2, 1.0)
            open_ = float(prices[i - 1]) if i > 0 else close
            open_ = min(max(open_, low), high)
            vol = float(abs(rng.normal(1.0, 0.3)) * 5_000_000 * (p["start"] / max(close, 1)))
            bars.append(
                OHLCV(
                    date=d,
                    open=round(open_, 2),
                    high=round(max(high, open_, close), 2),
                    low=round(min(low, open_, close), 2),
                    close=round(close, 2),
                    adj_close=round(close, 2),
                    volume=round(vol),
                )
            )
        return bars

    async def get_daily_history(
        self, ticker: str, start: date | None = None, end: date | None = None
    ) -> list[OHLCV]:
        bars = self._generate(ticker)
        if start:
            bars = [b for b in bars if b.date >= start]
        if end:
            bars = [b for b in bars if b.date <= end]
        if not bars:
            raise SymbolNotFound(ticker)
        return bars

    async def get_quote(self, ticker: str) -> Quote:
        bars = self._generate(ticker)
        last, prev = bars[-1], bars[-2]
        change = last.close - prev.close
        return Quote(
            ticker=ticker.upper(),
            price=last.close,
            change=round(change, 2),
            change_percent=round(change / prev.close * 100, 2),
            previous_close=prev.close,
            open=last.open,
            day_high=last.high,
            day_low=last.low,
            volume=last.volume,
            provenance=self._provenance(),
        )

    async def get_profile(self, ticker: str) -> CompanyProfile:
        p = _params(ticker)
        bars = self._generate(ticker)
        shares = float(1_000_000_000 * (1 + _seed(ticker) % 5))
        market_cap = bars[-1].close * shares
        return CompanyProfile(
            ticker=ticker.upper(),
            name=p["name"],
            exchange="DEMO",
            currency="USD",
            sector=p["sector"],
            industry=p["industry"],
            market_cap=market_cap,
            description=(
                f"DEMO DATA: {p['name']} is a synthetic company profile generated "
                "for demonstration. These figures are not real and must not be used "
                "for any investment decision."
            ),
            website=None,
            provenance=self._provenance(),
        )

    async def get_fundamentals(self, ticker: str) -> Fundamentals | None:
        rng = np.random.default_rng(_seed(ticker) + 7)
        bars = self._generate(ticker)
        price = bars[-1].close
        shares = float(1_000_000_000 * (1 + _seed(ticker) % 5))
        revenue = float(rng.uniform(5e9, 3e11))
        net_margin = float(rng.uniform(0.05, 0.30))
        net_income = revenue * net_margin
        eps = net_income / shares
        return Fundamentals(
            ticker=ticker.upper(),
            revenue=revenue,
            net_income=net_income,
            free_cash_flow=net_income * float(rng.uniform(0.7, 1.2)),
            gross_margin=float(rng.uniform(0.30, 0.70)),
            operating_margin=float(rng.uniform(0.10, 0.40)),
            net_margin=net_margin,
            total_debt=float(rng.uniform(1e9, 8e10)),
            total_cash=float(rng.uniform(1e9, 6e10)),
            shares_outstanding=shares,
            revenue_growth_yoy=float(rng.uniform(-0.05, 0.35)),
            earnings_growth_yoy=float(rng.uniform(-0.10, 0.45)),
            pe_ratio=round(price / eps, 2) if eps > 0 else None,
            forward_pe=round(price / (eps * 1.1), 2) if eps > 0 else None,
            peg_ratio=float(rng.uniform(0.8, 3.0)),
            price_to_sales=round(price * shares / revenue, 2),
            ev_to_ebitda=float(rng.uniform(8, 30)),
            dividend_yield=float(rng.uniform(0, 0.03)),
            provenance=self._provenance(),
        )

    async def get_news(self, ticker: str, limit: int = 10) -> list[NewsItem]:
        p = _params(ticker)
        templates = [
            (f"{p['name']} reports quarterly results in line with expectations", 0.1),
            (f"Analysts weigh {p['name']}'s position in {p['industry']}", 0.0),
            (f"{p['name']} announces new product roadmap", 0.4),
            (f"Market volatility pressures {p['sector']} names including {ticker.upper()}", -0.3),
            (f"{p['name']} expands operations amid demand shifts", 0.25),
        ]
        now = datetime.now(timezone.utc)
        items: list[NewsItem] = []
        for i, (headline, s) in enumerate(templates[:limit]):
            items.append(
                NewsItem(
                    headline="DEMO DATA — " + headline,
                    summary="Synthetic headline for demonstration only.",
                    url=None,
                    source="DEMO",
                    published_at=now - timedelta(days=i),
                    sentiment_score=s,
                    sentiment_label="positive" if s > 0.1 else "negative" if s < -0.1 else "neutral",
                )
            )
        return items

    async def search(self, query: str, limit: int = 10) -> list[SearchResult]:
        q = query.upper()
        out: list[SearchResult] = []
        for t, meta in DEMO_CATALOG.items():
            if t == BENCHMARK_TICKER:
                continue
            if q in t or q.lower() in meta["name"].lower():
                out.append(SearchResult(ticker=t, name=meta["name"], exchange="DEMO", type="EQUITY"))
        return out[:limit]
