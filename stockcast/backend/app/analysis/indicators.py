"""Technical indicators.

Pure functions over a pandas price/volume series. Each returns a Series aligned
to the input index (leading values are NaN until enough history exists). These
are unit-tested against hand-computed values in ``tests/test_indicators.py``.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window=window, min_periods=window).mean()


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False, min_periods=span).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index using Wilder's smoothing."""
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100 - (100 / (1 + rs))
    # When avg_loss is 0 (only gains), RSI is 100.
    out = out.where(avg_loss != 0, 100.0)
    out = out.where(~((avg_gain == 0) & (avg_loss == 0)), 50.0)
    return out


def macd(
    series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> pd.DataFrame:
    """MACD line, signal line and histogram."""
    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = macd_line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    hist = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "signal": signal_line, "hist": hist})


def bollinger_bands(
    series: pd.Series, window: int = 20, num_std: float = 2.0
) -> pd.DataFrame:
    mid = sma(series, window)
    std = series.rolling(window=window, min_periods=window).std(ddof=0)
    upper = mid + num_std * std
    lower = mid - num_std * std
    # %B: position within bands (0 = lower, 1 = upper)
    width = (upper - lower).replace(0.0, np.nan)
    pct_b = (series - lower) / width
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower, "pct_b": pct_b})


def momentum(series: pd.Series, window: int = 10) -> pd.Series:
    """Percent change over ``window`` periods."""
    return series.pct_change(periods=window)


def rolling_volatility(series: pd.Series, window: int = 20) -> pd.Series:
    """Annualised volatility of daily log returns."""
    log_ret = np.log(series / series.shift(1))
    return log_ret.rolling(window=window, min_periods=window).std() * np.sqrt(252)


def volume_change(volume: pd.Series, window: int = 20) -> pd.Series:
    """Volume relative to its rolling average (1.0 == average)."""
    avg = volume.rolling(window=window, min_periods=window).mean()
    return volume / avg.replace(0.0, np.nan)


def relative_strength(price: pd.Series, benchmark: pd.Series, window: int = 63) -> pd.Series:
    """Ratio of the asset's return to the benchmark's over ``window`` days.

    >1 means the asset outperformed the benchmark over the window.
    """
    aligned = pd.concat([price, benchmark], axis=1, keys=["a", "b"]).dropna()
    a_ret = aligned["a"] / aligned["a"].shift(window)
    b_ret = aligned["b"] / aligned["b"].shift(window)
    rs = a_ret / b_ret.replace(0.0, np.nan)
    return rs.reindex(price.index)


def max_drawdown(series: pd.Series) -> float:
    """Maximum peak-to-trough drawdown as a negative fraction."""
    if series.empty:
        return 0.0
    running_max = series.cummax()
    drawdown = series / running_max - 1.0
    return float(drawdown.min())


def sharpe_ratio(returns: pd.Series, periods_per_year: int = 252, risk_free: float = 0.0) -> float:
    """Annualised Sharpe ratio from a series of periodic returns."""
    r = returns.dropna()
    if r.empty or r.std(ddof=0) == 0:
        return 0.0
    excess = r - risk_free / periods_per_year
    return float(np.sqrt(periods_per_year) * excess.mean() / r.std(ddof=0))
