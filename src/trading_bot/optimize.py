"""Parameter optimization and walk-forward validation.

Two tools for stress-testing a strategy before trusting it:

* :func:`grid_search` — exhaustively backtest a grid of parameter combinations
  and rank them by a chosen metric.
* :func:`walk_forward` — the honest one. Repeatedly optimize on an in-sample
  window, then evaluate the chosen parameters on the *next* out-of-sample
  window the optimizer never saw. Aggregated out-of-sample performance is a far
  better estimate of live behaviour than a single in-sample backtest, which is
  trivially over-fit.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field

import pandas as pd

from .backtest import Backtester
from .config import BacktestConfig, RiskConfig
from .strategy import build_strategy


# Sensible default search grids per strategy, used by the CLI.
DEFAULT_GRIDS: dict[str, dict[str, list]] = {
    "sma_crossover": {
        "fast_period": [5, 10, 20],
        "slow_period": [30, 50, 100],
    },
    "rsi_reversion": {
        "rsi_period": [7, 14, 21],
        "oversold": [20, 30],
        "overbought": [70, 80],
    },
    "macd_crossover": {
        "fast": [8, 12],
        "slow": [21, 26],
        "signal": [7, 9],
    },
    "bollinger_breakout": {
        "period": [10, 20, 30],
        "num_std": [1.5, 2.0, 2.5],
    },
}


def default_grid(strategy_name: str) -> dict[str, list]:
    return DEFAULT_GRIDS.get(strategy_name, {})


@dataclass
class OptResult:
    params: dict
    metrics: dict
    score: float


def _score(metrics: dict, metric: str) -> float:
    value = metrics.get(metric, float("-inf"))
    # Drawdown is negative; for ranking we want "less bad" = higher.
    return value


def _param_combinations(grid: dict[str, list]) -> list[dict]:
    if not grid:
        return [{}]
    keys = list(grid)
    return [dict(zip(keys, combo)) for combo in itertools.product(*grid.values())]


def grid_search(
    strategy_name: str,
    grid: dict[str, list],
    bars: pd.DataFrame,
    *,
    risk_config: RiskConfig | None = None,
    backtest_config: BacktestConfig | None = None,
    metric: str = "sharpe",
    symbol: str = "OPT",
) -> list[OptResult]:
    """Backtest every parameter combination in ``grid``; return results sorted
    best-first by ``metric``."""
    risk_config = risk_config or RiskConfig()
    backtest_config = backtest_config or BacktestConfig()
    results: list[OptResult] = []
    for params in _param_combinations(grid):
        try:
            strat = build_strategy(strategy_name, params)
            bt = Backtester(strat, risk_config, backtest_config)
            res = bt.run(symbol, bars)
        except ValueError:
            # Skip invalid combos (e.g. fast >= slow).
            continue
        results.append(OptResult(params, res.metrics, _score(res.metrics, metric)))
    results.sort(key=lambda r: r.score, reverse=True)
    return results


@dataclass
class WalkForwardResult:
    folds: list[dict] = field(default_factory=list)

    @property
    def oos_mean_return(self) -> float:
        if not self.folds:
            return 0.0
        return sum(f["oos_metrics"]["total_return"] for f in self.folds) / len(self.folds)

    @property
    def oos_mean_sharpe(self) -> float:
        if not self.folds:
            return 0.0
        return sum(f["oos_metrics"]["sharpe"] for f in self.folds) / len(self.folds)

    def summary(self) -> str:
        lines = ["Walk-forward validation", f"  Folds: {len(self.folds)}"]
        for i, f in enumerate(self.folds, 1):
            lines.append(
                f"  Fold {i}: params={f['params']} "
                f"OOS return={f['oos_metrics']['total_return']:.2%} "
                f"OOS sharpe={f['oos_metrics']['sharpe']:.2f}"
            )
        lines.append(f"  Mean OOS return: {self.oos_mean_return:.2%}")
        lines.append(f"  Mean OOS Sharpe: {self.oos_mean_sharpe:.2f}")
        return "\n".join(lines)


def walk_forward(
    strategy_name: str,
    grid: dict[str, list],
    bars: pd.DataFrame,
    *,
    n_splits: int = 4,
    train_frac: float = 0.6,
    risk_config: RiskConfig | None = None,
    backtest_config: BacktestConfig | None = None,
    metric: str = "sharpe",
    symbol: str = "WF",
) -> WalkForwardResult:
    """Anchored walk-forward: split ``bars`` into ``n_splits`` sequential
    windows; in each, optimize on the first ``train_frac`` and evaluate the best
    params on the remaining out-of-sample tail."""
    risk_config = risk_config or RiskConfig()
    backtest_config = backtest_config or BacktestConfig()
    bars = bars.sort_index()
    n = len(bars)
    if n < n_splits * 20:
        raise ValueError("not enough bars for the requested number of splits")

    fold_size = n // n_splits
    wf = WalkForwardResult()
    for s in range(n_splits):
        lo = s * fold_size
        hi = n if s == n_splits - 1 else (s + 1) * fold_size
        fold = bars.iloc[lo:hi]
        split = int(len(fold) * train_frac)
        train, test = fold.iloc[:split], fold.iloc[split:]
        if len(train) < 10 or len(test) < 5:
            continue
        ranked = grid_search(
            strategy_name, grid, train,
            risk_config=risk_config, backtest_config=backtest_config,
            metric=metric, symbol=symbol,
        )
        if not ranked:
            continue
        best = ranked[0]
        strat = build_strategy(strategy_name, best.params)
        oos = Backtester(strat, risk_config, backtest_config).run(symbol, test)
        wf.folds.append({
            "params": best.params,
            "is_metrics": best.metrics,
            "oos_metrics": oos.metrics,
        })
    return wf
