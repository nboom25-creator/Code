import numpy as np
import pandas as pd
import pytest

from trading_bot.strategy import (
    RSIMeanReversion,
    Signal,
    SMACrossover,
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


def test_sma_crossover_emits_buy_on_golden_cross():
    # Downtrend then sharp uptrend forces fast SMA above slow SMA.
    close = list(np.linspace(100, 50, 60)) + list(np.linspace(50, 120, 30))
    strat = SMACrossover(fast_period=5, slow_period=20)
    signals = [strat.generate_signal(_bars(close[: i + 1])) for i in range(len(close))]
    assert Signal.BUY in signals


def test_sma_crossover_emits_sell_on_death_cross():
    close = list(np.linspace(50, 120, 60)) + list(np.linspace(120, 40, 30))
    strat = SMACrossover(fast_period=5, slow_period=20)
    signals = [strat.generate_signal(_bars(close[: i + 1])) for i in range(len(close))]
    assert Signal.SELL in signals


def test_sma_holds_when_insufficient_bars():
    strat = SMACrossover(fast_period=5, slow_period=20)
    assert strat.generate_signal(_bars([100, 101, 102])) is Signal.HOLD


def test_sma_rejects_bad_periods():
    with pytest.raises(ValueError):
        SMACrossover(fast_period=20, slow_period=5)


def test_strategy_validates_columns():
    strat = SMACrossover()
    bad = pd.DataFrame({"close": [1, 2, 3]})
    with pytest.raises(ValueError):
        strat.generate_signal(bad)


def test_rsi_reversion_buys_after_oversold():
    # Drop hard (oversold) then recover -> RSI crosses up out of oversold.
    close = list(np.linspace(100, 60, 30)) + list(np.linspace(60, 90, 20))
    strat = RSIMeanReversion(rsi_period=14, oversold=30, overbought=70)
    signals = [strat.generate_signal(_bars(close[: i + 1])) for i in range(len(close))]
    assert Signal.BUY in signals


def test_build_strategy_unknown():
    with pytest.raises(ValueError):
        build_strategy("does_not_exist")


def test_build_strategy_passes_params():
    strat = build_strategy("sma_crossover", {"fast_period": 3, "slow_period": 7})
    assert isinstance(strat, SMACrossover)
    assert strat.fast_period == 3 and strat.slow_period == 7
