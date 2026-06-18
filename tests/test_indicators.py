import numpy as np
import pandas as pd
import pytest

from trading_bot import indicators


def test_sma_basic():
    s = pd.Series([1, 2, 3, 4, 5], dtype=float)
    result = indicators.sma(s, 3)
    assert pd.isna(result.iloc[0])
    assert pd.isna(result.iloc[1])
    assert result.iloc[2] == pytest.approx(2.0)
    assert result.iloc[4] == pytest.approx(4.0)


def test_ema_converges():
    s = pd.Series([10.0] * 50)
    result = indicators.ema(s, 10)
    assert result.iloc[-1] == pytest.approx(10.0)


def test_rsi_bounds():
    rng = np.random.default_rng(0)
    s = pd.Series(100 + np.cumsum(rng.normal(0, 1, 200)))
    r = indicators.rsi(s, 14).dropna()
    assert (r >= 0).all() and (r <= 100).all()


def test_rsi_all_gains_is_100():
    s = pd.Series(np.arange(1, 50, dtype=float))  # strictly increasing
    r = indicators.rsi(s, 14)
    assert r.iloc[-1] == pytest.approx(100.0)


def test_macd_columns_and_relationship():
    s = pd.Series(100 + np.cumsum(np.ones(100)))
    df = indicators.macd(s)
    assert list(df.columns) == ["macd", "signal", "hist"]
    valid = df.dropna()
    assert np.allclose(valid["hist"], valid["macd"] - valid["signal"])


def test_macd_validates_periods():
    with pytest.raises(ValueError):
        indicators.macd(pd.Series([1.0, 2.0]), fast=26, slow=12)


def test_bollinger_ordering():
    rng = np.random.default_rng(1)
    s = pd.Series(100 + np.cumsum(rng.normal(0, 1, 100)))
    bands = indicators.bollinger_bands(s, 20).dropna()
    assert (bands["lower"] <= bands["mid"]).all()
    assert (bands["mid"] <= bands["upper"]).all()


def test_atr_positive():
    rng = np.random.default_rng(2)
    close = pd.Series(100 + np.cumsum(rng.normal(0, 1, 100)))
    high = close + 1
    low = close - 1
    a = indicators.atr(high, low, close, 14).dropna()
    assert (a > 0).all()
