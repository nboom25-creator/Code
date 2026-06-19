"""Tests for the agent backtester (point-in-time data, sim broker, full loop)."""

import pandas as pd

from trading_bot.agent.backtest_agent import (
    AgentBacktester,
    BacktestBroker,
    PointInTimeData,
)
from trading_bot.agent.ledger import TradeLedger
from trading_bot.agent.research import build_research_bundle


# --------------------------------------------------------------------------- #
# Point-in-time data feed never looks ahead
# --------------------------------------------------------------------------- #
def test_point_in_time_data_no_lookahead():
    idx = pd.date_range("2024-01-01", periods=10, freq="B")
    df = pd.DataFrame({"open": range(10), "high": range(10), "low": range(10),
                       "close": range(10), "volume": [1] * 10}, index=idx)
    feed = PointInTimeData({"X": df})
    feed.set_cursor(3)
    bars = feed.get_bars("X")
    assert len(bars) == 4               # only bars 0..3 are visible
    assert bars["close"].iloc[-1] == 3


# --------------------------------------------------------------------------- #
# Backtest broker: fills, marking, and stop handling
# --------------------------------------------------------------------------- #
def test_backtest_broker_buy_sell_and_equity(tmp_path):
    b = BacktestBroker(100_000, TradeLedger(tmp_path / "l.jsonl"), slippage_pct=0.0)
    b.set_prices({"X": 100.0})
    b.submit_bracket_order("X", 10, stop_loss_price=95.0, take_profit_price=120.0)
    assert b.cash == 99_000.0
    assert b.get_account().equity == 100_000.0   # 99k cash + 10*100
    b.set_prices({"X": 110.0})
    assert b.get_account().equity == 100_100.0   # marked up


def test_backtest_broker_stop_loss_closes_position(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    b = BacktestBroker(100_000, led, slippage_pct=0.0)
    b.set_prices({"X": 100.0})
    b.submit_bracket_order("X", 10, stop_loss_price=95.0, take_profit_price=120.0)
    # A day that trades down through the stop closes the position at the stop.
    b.check_stops({"X": (101.0, 94.0)})
    assert "X" not in b.positions
    sells = [f for f in led.fills() if f.side == "sell"]
    assert sells and sells[0].price == 95.0


def test_backtest_broker_take_profit_closes_position(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    b = BacktestBroker(100_000, led, slippage_pct=0.0)
    b.set_prices({"X": 100.0})
    b.submit_bracket_order("X", 10, stop_loss_price=95.0, take_profit_price=120.0)
    b.check_stops({"X": (121.0, 99.0)})   # high pierces the take-profit
    assert "X" not in b.positions
    # The broker records the exit at the take-profit price (the buy is recorded
    # by the cognitive loop in a real run, not by the broker).
    sells = [f for f in led.fills() if f.side == "sell"]
    assert sells and sells[0].price == 120.0


# --------------------------------------------------------------------------- #
# Full backtest end to end
# --------------------------------------------------------------------------- #
def test_agent_backtest_runs_and_reports(tmp_path):
    history, benchmark = AgentBacktester.build_synthetic_history(
        ["AAA", "BBB", "CCC"], days=160, seed=3)
    bt = AgentBacktester(
        history=history, benchmark=benchmark,
        research=build_research_bundle(sim=True),
        starting_cash=100_000, cadence=10,
        ledger_path=str(tmp_path / "bt.jsonl"),
    )
    result = bt.run()
    assert len(result.equity_curve) > 0
    m = result.metrics
    for key in ("total_return", "max_drawdown", "sharpe", "end_equity", "days"):
        assert key in m
    assert m["end_equity"] > 0
    assert -1.0 <= m["max_drawdown"] <= 0.0
    assert "Agent backtest" in result.summary()
    # The equity curve never goes to zero (positions are capped + stopped).
    assert (result.equity_curve > 0).all()


class _FakeProvider:
    """Returns different date ranges per symbol, to test alignment."""

    def __init__(self, empty_for=()):
        self.empty_for = set(empty_for)

    def get_bars(self, symbol, *, timeframe="1Day", limit=None, start=None, end=None):
        if symbol in self.empty_for:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        starts = {"A": "2024-01-01", "B": "2024-01-03", "SPY": "2024-01-01"}
        idx = pd.date_range(starts.get(symbol, "2024-01-01"), periods=12, freq="B")
        close = pd.Series(range(len(idx)), index=idx, dtype=float)
        return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                             "close": close, "volume": [100] * len(idx)})


def test_fetch_history_aligns_to_common_dates():
    history, benchmark = AgentBacktester.fetch_history(
        ["A", "B"], benchmark_symbol="SPY", provider=_FakeProvider())
    # All frames share one identical index (the intersection of their dates).
    idxs = [df.index for df in history.values()] + [benchmark.index]
    assert all(ix.equals(idxs[0]) for ix in idxs)
    assert len(idxs[0]) > 0
    assert set(history) == {"A", "B"}  # benchmark returned separately


def test_fetch_history_requires_benchmark():
    import pytest
    with pytest.raises(ValueError):
        AgentBacktester.fetch_history(
            ["A"], benchmark_symbol="SPY", provider=_FakeProvider(empty_for=["SPY"]))


def test_fetch_history_drops_empty_symbols():
    history, _ = AgentBacktester.fetch_history(
        ["A", "B"], benchmark_symbol="SPY", provider=_FakeProvider(empty_for=["B"]))
    assert set(history) == {"A"}  # B had no data and was dropped


def test_agent_backtest_is_deterministic(tmp_path):
    h1, b1 = AgentBacktester.build_synthetic_history(["AAA", "BBB"], days=150, seed=7)
    h2, b2 = AgentBacktester.build_synthetic_history(["AAA", "BBB"], days=150, seed=7)
    r1 = AgentBacktester(history=h1, benchmark=b1,
                         research=build_research_bundle(sim=True), cadence=10,
                         ledger_path=str(tmp_path / "a.jsonl")).run()
    r2 = AgentBacktester(history=h2, benchmark=b2,
                         research=build_research_bundle(sim=True), cadence=10,
                         ledger_path=str(tmp_path / "b.jsonl")).run()
    assert round(r1.metrics["end_equity"], 2) == round(r2.metrics["end_equity"], 2)
