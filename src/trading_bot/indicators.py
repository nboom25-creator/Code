"""Technical indicators.

Pure pandas/numpy implementations so the strategy and backtest layers have no
network or heavy native (TA-Lib) dependency and stay fully unit-testable.

All functions take a ``pandas.Series`` of prices (typically close) and return a
``pandas.Series`` aligned to the input index.
"""

from __future__ import annotations

import pandas as pd


def sma(series: pd.Series, period: int) -> pd.Series:
    """Simple moving average."""
    if period < 1:
        raise ValueError("period must be >= 1")
    return series.rolling(window=period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    """Exponential moving average."""
    if period < 1:
        raise ValueError("period must be >= 1")
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index using Wilder's smoothing.

    Returns values in [0, 100]. NaN until ``period`` observations exist.
    """
    if period < 1:
        raise ValueError("period must be >= 1")
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    # Wilder's smoothing == EMA with alpha = 1/period.
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss
    out = 100 - (100 / (1 + rs))
    # When there are no losses, RSI is 100 by definition.
    out = out.where(avg_loss != 0, 100.0)
    return out


def macd(
    series: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> pd.DataFrame:
    """Moving Average Convergence Divergence.

    Returns a DataFrame with columns ``macd``, ``signal``, ``hist``.
    """
    if fast >= slow:
        raise ValueError("fast period must be < slow period")
    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    hist = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "signal": signal_line, "hist": hist})


def bollinger_bands(
    series: pd.Series,
    period: int = 20,
    num_std: float = 2.0,
) -> pd.DataFrame:
    """Bollinger Bands. Returns columns ``lower``, ``mid``, ``upper``."""
    mid = sma(series, period)
    std = series.rolling(window=period, min_periods=period).std()
    return pd.DataFrame({
        "lower": mid - num_std * std,
        "mid": mid,
        "upper": mid + num_std * std,
    })


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Average True Range — a volatility measure used for stop sizing."""
    prev_close = close.shift(1)
    true_range = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
