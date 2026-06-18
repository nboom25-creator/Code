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
