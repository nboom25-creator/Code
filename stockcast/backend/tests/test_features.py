"""Tests that feature engineering does not leak future information."""
import numpy as np
import pandas as pd

from app.analysis import to_dataframe
from app.analysis.features import assemble_xy, build_feature_frame, make_target
from app.providers.demo import DemoProvider
import asyncio


def _demo_df(ticker="AAPL"):
    bars = asyncio.run(DemoProvider().get_daily_history(ticker))
    df = to_dataframe(bars)
    return df


def test_target_is_forward_return():
    df = _demo_df()
    price = df["adj_close"].astype(float)
    target = make_target(df, 5)
    # target at t should equal log(P[t+5]/P[t])
    expected = np.log(price.shift(-5) / price)
    assert np.allclose(target.dropna(), expected.dropna())


def test_no_future_leak_in_features():
    """A feature computed at time t must not change if future rows are removed."""
    df = _demo_df()
    cut = 800
    full = build_feature_frame(df)
    truncated = build_feature_frame(df.iloc[: cut + 1])
    # Compare the last common row; all feature values must match (no look-ahead).
    common_idx = truncated.index[-1]
    a = full.loc[common_idx]
    b = truncated.loc[common_idx]
    # Only compare non-NaN entries.
    mask = ~(a.isna() | b.isna())
    assert np.allclose(a[mask].to_numpy(), b[mask].to_numpy())


def test_assemble_xy_no_nans():
    df = _demo_df()
    X, y = assemble_xy(df, 5)
    assert not X.isna().any().any()
    assert not y.isna().any()
    assert len(X) == len(y)
