"""Unit tests for technical indicators against hand-computed values."""
import numpy as np
import pandas as pd
import pytest

from app.analysis import indicators as ind


def test_sma_basic():
    s = pd.Series([1, 2, 3, 4, 5], dtype=float)
    out = ind.sma(s, 3)
    assert np.isnan(out.iloc[0]) and np.isnan(out.iloc[1])
    assert out.iloc[2] == pytest.approx(2.0)
    assert out.iloc[4] == pytest.approx(4.0)


def test_rsi_all_gains_is_100():
    s = pd.Series(np.arange(1, 40, dtype=float))  # strictly increasing
    out = ind.rsi(s, 14)
    assert out.dropna().iloc[-1] == pytest.approx(100.0, abs=1e-6)


def test_rsi_all_losses_near_zero():
    s = pd.Series(np.arange(40, 1, -1, dtype=float))  # strictly decreasing
    out = ind.rsi(s, 14)
    assert out.dropna().iloc[-1] == pytest.approx(0.0, abs=1e-6)


def test_rsi_bounds():
    rng = np.random.default_rng(0)
    s = pd.Series(100 + np.cumsum(rng.normal(0, 1, 200)))
    out = ind.rsi(s, 14).dropna()
    assert (out >= 0).all() and (out <= 100).all()


def test_macd_hist_is_macd_minus_signal():
    rng = np.random.default_rng(1)
    s = pd.Series(100 + np.cumsum(rng.normal(0, 1, 300)))
    m = ind.macd(s)
    valid = m.dropna()
    assert np.allclose(valid["hist"], valid["macd"] - valid["signal"])


def test_bollinger_pct_b_at_bounds():
    rng = np.random.default_rng(2)
    s = pd.Series(100 + np.cumsum(rng.normal(0, 1, 100)))
    bb = ind.bollinger_bands(s, 20)
    valid = bb.dropna()
    # %B should be ~0 at lower band and ~1 at upper band by construction.
    recomputed = (s - bb["lower"]) / (bb["upper"] - bb["lower"])
    assert np.allclose(valid["pct_b"], recomputed.reindex(valid.index))


def test_max_drawdown_known():
    s = pd.Series([100, 120, 60, 80, 200])  # trough 60 after peak 120 -> -50%
    assert ind.max_drawdown(s) == pytest.approx(-0.5)


def test_sharpe_zero_variance():
    assert ind.sharpe_ratio(pd.Series([0.01, 0.01, 0.01])) == 0.0


def test_rolling_volatility_positive():
    rng = np.random.default_rng(3)
    s = pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.01, 300))))
    v = ind.rolling_volatility(s, 20).dropna()
    assert (v > 0).all()
