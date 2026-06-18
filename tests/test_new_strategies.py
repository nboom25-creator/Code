import numpy as np
import pandas as pd
import pytest

from trading_bot.strategy import (
    BollingerBreakout,
    MACDCrossover,
    Signal,
    build_strategy,
)


def _bars(close):
    close = pd.Series(close, dtype=float)
    return pd.DataFrame({
        "open": close,
        "high": close + 1,
        "low": close - 1,
        "close": close,
        "volume": 1_000,
    })


def test_macd_registered_and_builds():
    strat = build_strategy("macd_crossover", {"fast": 8, "slow": 21, "signal": 7})
    assert isinstance(strat, MACDCrossover)


def test_macd_emits_signals_on_trend_reversal():
    close = list(np.linspace(100, 60, 60)) + list(np.linspace(60, 130, 60))
    strat = MACDCrossover(fast=8, slow=21, signal=7)
    signals = [strat.generate_signal(_bars(close[: i + 1])) for i in range(len(close))]
    assert Signal.BUY in signals


def test_macd_rejects_bad_periods():
    with pytest.raises(ValueError):
        MACDCrossover(fast=26, slow=12)


def test_bollinger_registered_and_builds():
    strat = build_strategy("bollinger_breakout", {"period": 20, "num_std": 2.0})
    assert isinstance(strat, BollingerBreakout)


def test_bollinger_breakout_buys_on_spike():
    # Flat then a sharp spike pushes price above the upper band.
    close = [100.0] * 40 + [100 + i * 3 for i in range(1, 10)]
    strat = BollingerBreakout(period=20, num_std=2.0)
    signals = [strat.generate_signal(_bars(close[: i + 1])) for i in range(len(close))]
    assert Signal.BUY in signals


def test_bollinger_holds_when_insufficient():
    strat = BollingerBreakout(period=20)
    assert strat.generate_signal(_bars([100, 101, 102])) is Signal.HOLD
