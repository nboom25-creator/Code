"""Analysis: indicators, features, forecasting, rating, backtesting."""
from __future__ import annotations

import pandas as pd

from app.schemas import OHLCV


def to_dataframe(bars: list[OHLCV]) -> pd.DataFrame:
    """Convert an OHLCV list into a date-indexed DataFrame (oldest first)."""
    if not bars:
        return pd.DataFrame(
            columns=["open", "high", "low", "close", "adj_close", "volume"]
        )
    df = pd.DataFrame(
        {
            "date": [b.date for b in bars],
            "open": [b.open for b in bars],
            "high": [b.high for b in bars],
            "low": [b.low for b in bars],
            "close": [b.close for b in bars],
            "adj_close": [b.adj_close for b in bars],
            "volume": [b.volume for b in bars],
        }
    )
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").set_index("date")
    return df
