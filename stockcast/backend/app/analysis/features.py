"""Feature engineering for the forecasting models.

Every feature is computed from information available *at or before* each row's
date, so shifting the target forward cannot leak future information into the
predictors. The target is the forward log-return over the forecast horizon.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.analysis import indicators as ind


def build_feature_frame(
    df: pd.DataFrame, benchmark: pd.Series | None = None
) -> pd.DataFrame:
    """Return a DataFrame of predictive features indexed like ``df``.

    Uses adjusted close for return-based features so splits/dividends do not
    distort momentum and volatility.
    """
    price = df["adj_close"].astype(float)
    volume = df["volume"].astype(float)
    feats = pd.DataFrame(index=df.index)

    log_ret = np.log(price / price.shift(1))
    # Lagged returns
    for lag in (1, 2, 3, 5, 10):
        feats[f"ret_lag_{lag}"] = log_ret.shift(lag - 1)
    # Rolling mean returns (momentum-ish)
    for w in (5, 10, 21):
        feats[f"ret_mean_{w}"] = log_ret.rolling(w).mean()
    # Rolling volatility
    for w in (10, 21):
        feats[f"vol_{w}"] = log_ret.rolling(w).std()
    # Moving-average distance (price relative to SMA)
    for w in (10, 20, 50, 200):
        feats[f"sma_dist_{w}"] = price / ind.sma(price, w) - 1.0
    # RSI
    feats["rsi_14"] = ind.rsi(price, 14) / 100.0
    # MACD
    macd = ind.macd(price)
    feats["macd_hist"] = macd["hist"] / price
    # Bollinger position
    bb = ind.bollinger_bands(price, 20)
    feats["bb_pct_b"] = bb["pct_b"]
    # Momentum
    feats["momentum_10"] = ind.momentum(price, 10)
    feats["momentum_21"] = ind.momentum(price, 21)
    # Volume change
    feats["vol_change_20"] = ind.volume_change(volume, 20) - 1.0
    # Relative strength vs benchmark (market regime / RS)
    if benchmark is not None and not benchmark.empty:
        bench = benchmark.reindex(price.index).ffill()
        feats["rel_strength_63"] = ind.relative_strength(price, bench, 63) - 1.0
        bench_ret = np.log(bench / bench.shift(1))
        feats["bench_ret_mean_21"] = bench_ret.rolling(21).mean()
    return feats


def make_target(df: pd.DataFrame, horizon: int) -> pd.Series:
    """Forward log-return over ``horizon`` trading days (the prediction target)."""
    price = df["adj_close"].astype(float)
    return np.log(price.shift(-horizon) / price)


def assemble_xy(
    df: pd.DataFrame, horizon: int, benchmark: pd.Series | None = None
) -> tuple[pd.DataFrame, pd.Series]:
    """Aligned (X, y) with rows containing NaNs (warm-up / future) dropped."""
    feats = build_feature_frame(df, benchmark)
    target = make_target(df, horizon)
    data = feats.copy()
    data["__target__"] = target
    data = data.dropna()
    y = data.pop("__target__")
    return data, y
