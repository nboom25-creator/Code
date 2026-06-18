"""Tests for stop-loss / take-profit handling in the backtester."""

import pandas as pd

from trading_bot.backtest import Backtester
from trading_bot.config import BacktestConfig, RiskConfig
from trading_bot.strategy import Signal, Strategy


class BuyOnceStrategy(Strategy):
    """Emits BUY on the second bar, HOLD forever after — lets us isolate the
    stop/take-profit exit logic from any strategy-driven sell."""

    name = "buy_once"

    @property
    def min_bars(self) -> int:
        return 1

    def generate_signal(self, bars: pd.DataFrame) -> Signal:
        return Signal.BUY if len(bars) == 2 else Signal.HOLD


def _bars(rows):
    df = pd.DataFrame(rows, columns=["open", "high", "low", "close", "volume"])
    df.index = pd.date_range("2021-01-01", periods=len(df), freq="D")
    return df


def test_stop_loss_exits_position():
    # Buy near 100, then a bar whose low pierces the 5% stop (95).
    bars = _bars([
        [100, 101, 99, 100, 1000],   # bar 0
        [100, 101, 99, 100, 1000],   # bar 1 -> BUY at ~100
        [100, 100, 90, 92, 1000],    # bar 2 -> low 90 < stop 95 -> exit
        [92, 93, 91, 92, 1000],
    ])
    risk = RiskConfig(stop_loss_pct=0.05, take_profit_pct=0.0)
    bt = Backtester(BuyOnceStrategy(), risk, BacktestConfig(slippage_pct=0))
    result = bt.run("X", bars)
    sells = [t for t in result.trades if t.side == "sell"]
    assert len(sells) == 1
    assert sells[0].pnl < 0  # stopped out at a loss


def test_take_profit_exits_position():
    # Buy near 100, then a bar whose high reaches the 10% take-profit (110).
    bars = _bars([
        [100, 101, 99, 100, 1000],
        [100, 101, 99, 100, 1000],   # BUY at ~100
        [100, 112, 99, 111, 1000],   # high 112 >= tp 110 -> exit at profit
        [111, 112, 110, 111, 1000],
    ])
    risk = RiskConfig(stop_loss_pct=0.05, take_profit_pct=0.10)
    bt = Backtester(BuyOnceStrategy(), risk, BacktestConfig(slippage_pct=0))
    result = bt.run("X", bars)
    sells = [t for t in result.trades if t.side == "sell"]
    assert len(sells) == 1
    assert sells[0].pnl > 0  # took profit


def test_no_exit_when_stops_disabled():
    bars = _bars([
        [100, 101, 99, 100, 1000],
        [100, 101, 99, 100, 1000],   # BUY
        [100, 100, 80, 85, 1000],    # big drop, but stops disabled
        [85, 86, 84, 85, 1000],
    ])
    risk = RiskConfig(stop_loss_pct=0.0, take_profit_pct=0.0)
    bt = Backtester(BuyOnceStrategy(), risk, BacktestConfig(slippage_pct=0))
    result = bt.run("X", bars)
    assert [t for t in result.trades if t.side == "sell"] == []
