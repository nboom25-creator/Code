"""Market-data access.

Wraps Alpaca's historical data API behind a small interface. Alpaca SDK imports
are lazy so the rest of the package (indicators, strategy, risk, backtest) works
without the dependency installed or any network access.
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd

from .config import Credentials

_TIMEFRAME_MAP = {
    "1Min": ("Minute", 1),
    "5Min": ("Minute", 5),
    "15Min": ("Minute", 15),
    "1Hour": ("Hour", 1),
    "1Day": ("Day", 1),
}


class DataProvider:
    """Fetches historical OHLCV bars from Alpaca."""

    def __init__(self, credentials: Credentials) -> None:
        if not credentials.api_key or not credentials.api_secret:
            raise ValueError(
                "Alpaca API credentials are required for market data. Set "
                "ALPACA_API_KEY and ALPACA_API_SECRET in your environment/.env."
            )
        self._creds = credentials
        self._client = None  # lazy

    def _get_client(self):
        if self._client is None:
            from alpaca.data.historical import StockHistoricalDataClient

            self._client = StockHistoricalDataClient(
                self._creds.api_key, self._creds.api_secret
            )
        return self._client

    @staticmethod
    def _to_timeframe(timeframe: str):
        from alpaca.data.timeframe import TimeFrame, TimeFrameUnit

        if timeframe not in _TIMEFRAME_MAP:
            raise ValueError(
                f"unsupported timeframe {timeframe!r}; "
                f"choose from {sorted(_TIMEFRAME_MAP)}"
            )
        unit_name, amount = _TIMEFRAME_MAP[timeframe]
        return TimeFrame(amount, getattr(TimeFrameUnit, unit_name))

    def get_bars(
        self,
        symbol: str,
        *,
        timeframe: str = "1Day",
        start: datetime | str | None = None,
        end: datetime | str | None = None,
        limit: int | None = None,
    ) -> pd.DataFrame:
        """Return an OHLCV DataFrame indexed by timestamp for one symbol."""
        from alpaca.data.requests import StockBarsRequest

        request = StockBarsRequest(
            symbol_or_symbols=symbol,
            timeframe=self._to_timeframe(timeframe),
            start=pd.Timestamp(start) if start is not None else None,
            end=pd.Timestamp(end) if end is not None else None,
            limit=limit,
        )
        bars = self._get_client().get_stock_bars(request)
        df = bars.df
        if df.empty:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        # alpaca-py returns a MultiIndex (symbol, timestamp); drop the symbol level.
        if isinstance(df.index, pd.MultiIndex):
            df = df.xs(symbol, level="symbol")
        keep = ["open", "high", "low", "close", "volume"]
        return df[keep].sort_index()

    def get_news(self, symbol: str, *, limit: int = 10) -> list[dict]:
        """Return recent news items for a symbol from Alpaca's news API.

        Each item is a dict with headline, summary, source, and created_at.
        Returns an empty list if the news endpoint is unavailable.
        """
        from alpaca.data.historical.news import NewsClient
        from alpaca.data.requests import NewsRequest

        client = NewsClient(self._creds.api_key, self._creds.api_secret)
        response = client.get_news(NewsRequest(symbols=symbol, limit=limit))
        items = []
        for article in getattr(response, "news", []) or []:
            items.append({
                "headline": getattr(article, "headline", ""),
                "summary": getattr(article, "summary", ""),
                "source": getattr(article, "source", ""),
                "created_at": str(getattr(article, "created_at", "")),
            })
        return items


# Map our timeframe strings to yfinance (interval, period) pairs.
_YF_TIMEFRAME = {
    "1Min": ("1m", "5d"),
    "5Min": ("5m", "1mo"),
    "15Min": ("15m", "1mo"),
    "1Hour": ("1h", "3mo"),
    "1Day": ("1d", "1y"),
}


class YFinanceDataProvider:
    """Free, keyless market data + news via the ``yfinance`` library.

    Implements the same ``get_bars`` / ``get_news`` interface as the Alpaca
    :class:`DataProvider`, so the agent's tools work with no broker credentials —
    ideal for the dry-run sandbox. ``yfinance`` is imported lazily.
    """

    def get_bars(self, symbol: str, *, timeframe: str = "1Day",
                 limit: int | None = None, start=None, end=None) -> pd.DataFrame:
        import yfinance as yf

        interval, period = _YF_TIMEFRAME.get(timeframe, ("1d", "1y"))
        ticker = yf.Ticker(symbol)
        if start is not None or end is not None:
            df = ticker.history(start=start, end=end, interval=interval,
                                auto_adjust=False)
        else:
            df = ticker.history(period=period, interval=interval, auto_adjust=False)
        if df.empty:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        df = df.rename(columns={
            "Open": "open", "High": "high", "Low": "low",
            "Close": "close", "Volume": "volume",
        })
        df = df[["open", "high", "low", "close", "volume"]].sort_index()
        if limit:
            df = df.tail(limit)
        return df

    def get_news(self, symbol: str, *, limit: int = 10) -> list[dict]:
        import yfinance as yf

        raw = getattr(yf.Ticker(symbol), "news", None) or []
        items: list[dict] = []
        for entry in raw[:limit]:
            # yfinance has changed this shape across versions; handle both the
            # flat form and the newer nested {"content": {...}} form.
            content = entry.get("content", entry) if isinstance(entry, dict) else {}
            headline = content.get("title") or entry.get("title", "")
            summary = content.get("summary") or content.get("description", "")
            provider = content.get("provider") or {}
            source = (provider.get("displayName") if isinstance(provider, dict)
                      else "") or entry.get("publisher", "")
            created = (content.get("pubDate") or entry.get("providerPublishTime", ""))
            items.append({
                "headline": headline,
                "summary": summary,
                "source": source,
                "created_at": str(created),
            })
        return items


class SyntheticDataProvider:
    """Offline, deterministic market data + news for demonstrating the dry-run
    where live data egress is unavailable.

    Produces a gently trending OHLCV series (so the loop reaches a real BUY/HOLD
    decision) and a couple of canned, sentiment-bearing headlines. Not real data —
    for plumbing/demo only.
    """

    def __init__(self, *, trend: float = 0.004, seed: int = 7) -> None:
        self.trend = trend
        self.seed = seed

    def get_bars(self, symbol: str, *, timeframe: str = "1Day",
                 limit: int | None = None) -> pd.DataFrame:
        from .backtest import generate_synthetic_bars

        # Vary the seed per symbol so different tickers get different paths.
        seed = self.seed + (sum(ord(c) for c in symbol) % 97)
        bars = generate_synthetic_bars(n=60, seed=seed, trend=self.trend)
        return bars.tail(limit) if limit else bars

    def get_news(self, symbol: str, *, limit: int = 10) -> list[dict]:
        return [
            {"headline": f"{symbol} beats earnings, shares surge to record",
             "summary": "Strong revenue growth and raised guidance.",
             "source": "synthetic", "created_at": "2026-06-18"},
            {"headline": f"Analysts upgrade {symbol} on momentum",
             "summary": "Several desks turn bullish.",
             "source": "synthetic", "created_at": "2026-06-18"},
        ][:limit]
