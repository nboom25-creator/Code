import pytest

from trading_bot.backtest import Backtester, generate_synthetic_bars
from trading_bot.config import BacktestConfig, RiskConfig
from trading_bot.portfolio import Portfolio
from trading_bot.strategy import build_strategy


def test_synthetic_bars_shape_and_columns():
    bars = generate_synthetic_bars(n=300, seed=1)
    assert len(bars) == 300
    assert list(bars.columns) == ["open", "high", "low", "close", "volume"]
    assert (bars["high"] >= bars["low"]).all()
    assert (bars["close"] > 0).all()


def test_backtest_runs_and_reports_metrics():
    bars = generate_synthetic_bars(n=400, seed=7, trend=0.001)
    strat = build_strategy("sma_crossover", {"fast_period": 10, "slow_period": 30})
    bt = Backtester(strat, RiskConfig(), BacktestConfig(starting_cash=100_000))
    result = bt.run("SYNTH", bars)
    m = result.metrics
    assert len(result.equity_curve) == len(bars)
    assert m["final_equity"] > 0
    assert -1.0 <= m["max_drawdown"] <= 0.0
    assert 0.0 <= m["win_rate"] <= 1.0
    assert "Total return" in result.summary()


def test_backtest_never_goes_negative_cash():
    bars = generate_synthetic_bars(n=500, seed=3)
    strat = build_strategy("rsi_reversion")
    bt = Backtester(strat, RiskConfig(), BacktestConfig(starting_cash=50_000))
    result = bt.run("SYNTH", bars)
    assert (result.equity_curve > 0).all()


def test_backtest_empty_raises():
    import pandas as pd

    strat = build_strategy("sma_crossover")
    bt = Backtester(strat, RiskConfig(), BacktestConfig())
    with pytest.raises(ValueError):
        bt.run("X", pd.DataFrame(columns=["open", "high", "low", "close", "volume"]))


def test_portfolio_buy_sell_pnl():
    pf = Portfolio(cash=10_000)
    pf.buy("AAPL", 10, 100.0)
    assert pf.cash == pytest.approx(9_000)
    assert pf.has_position("AAPL")
    pf.sell("AAPL", 10, 110.0)
    assert not pf.has_position("AAPL")
    assert pf.cash == pytest.approx(10_100)
    sell_trade = pf.trades[-1]
    assert sell_trade.pnl == pytest.approx(100.0)


def test_portfolio_rejects_overspend():
    pf = Portfolio(cash=500)
    with pytest.raises(ValueError):
        pf.buy("AAPL", 10, 100.0)
