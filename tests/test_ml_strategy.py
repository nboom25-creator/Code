import pytest

pytest.importorskip("sklearn")

from trading_bot.backtest import Backtester, generate_synthetic_bars
from trading_bot.config import BacktestConfig, RiskConfig
from trading_bot.ml_strategy import MLSignalStrategy, build_features
from trading_bot.strategy import Signal, build_strategy


def test_ml_strategy_registered():
    strat = build_strategy("ml", {"min_train": 100})
    assert isinstance(strat, MLSignalStrategy)


def test_build_features_columns():
    bars = generate_synthetic_bars(n=200, seed=1)
    feats = build_features(bars)
    assert {"ret_1", "ret_5", "rsi", "macd_hist", "vol_10", "sma_gap"} <= set(
        feats.columns
    )
    assert len(feats) == len(bars)


def test_ml_holds_until_trained():
    strat = MLSignalStrategy(min_train=200)
    bars = generate_synthetic_bars(n=50, seed=2)
    assert strat.generate_signal(bars) is Signal.HOLD


def test_ml_fits_and_predicts():
    bars = generate_synthetic_bars(n=400, seed=3, trend=0.0006)
    strat = MLSignalStrategy(min_train=150, refit_every=50)
    sig = strat.generate_signal(bars)
    assert sig in (Signal.BUY, Signal.SELL, Signal.HOLD)
    assert strat._model is not None  # got trained


def test_ml_runs_in_backtest():
    bars = generate_synthetic_bars(n=400, seed=8, trend=0.0005)
    strat = MLSignalStrategy(min_train=150, refit_every=100)
    result = Backtester(strat, RiskConfig(), BacktestConfig()).run("SYNTH", bars)
    assert (result.equity_curve > 0).all()


def test_ml_rejects_bad_thresholds():
    with pytest.raises(ValueError):
        MLSignalStrategy(buy_threshold=0.4, sell_threshold=0.6)
