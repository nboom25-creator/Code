import pytest

from trading_bot.backtest import generate_synthetic_bars
from trading_bot.optimize import (
    default_grid,
    grid_search,
    walk_forward,
)


def test_grid_search_ranks_results():
    bars = generate_synthetic_bars(n=400, seed=5, trend=0.0008)
    grid = {"fast_period": [5, 10], "slow_period": [30, 50]}
    results = grid_search("sma_crossover", grid, bars, metric="sharpe")
    assert len(results) == 4
    # Sorted best-first.
    scores = [r.score for r in results]
    assert scores == sorted(scores, reverse=True)
    assert "total_return" in results[0].metrics


def test_grid_search_skips_invalid_combos():
    bars = generate_synthetic_bars(n=300, seed=1)
    # fast >= slow is invalid and must be skipped, not raise.
    grid = {"fast_period": [50], "slow_period": [20]}
    results = grid_search("sma_crossover", grid, bars)
    assert results == []


def test_default_grids_exist():
    for name in ["sma_crossover", "rsi_reversion", "macd_crossover",
                 "bollinger_breakout"]:
        assert default_grid(name)


def test_walk_forward_produces_oos_folds():
    bars = generate_synthetic_bars(n=1000, seed=9, trend=0.0005)
    grid = {"fast_period": [5, 10], "slow_period": [30, 50]}
    wf = walk_forward("sma_crossover", grid, bars, n_splits=4)
    assert len(wf.folds) >= 1
    for fold in wf.folds:
        assert "oos_metrics" in fold and "params" in fold
    assert "Mean OOS" in wf.summary()


def test_walk_forward_requires_enough_data():
    bars = generate_synthetic_bars(n=30, seed=1)
    with pytest.raises(ValueError):
        walk_forward("sma_crossover", {"fast_period": [5], "slow_period": [10]},
                     bars, n_splits=4)
