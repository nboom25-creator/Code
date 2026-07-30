"""Validation: walk-forward, purged cross-validation, Monte Carlo, sensitivity,
stress testing and the acceptance screen.

The purpose of this module is to *reject* strategies. A single backtest with a
good Sharpe is nearly worthless evidence — the tests here exist to find the ways
that result could be an artefact:

``walk_forward``
    Repeatedly fit on a window and evaluate on the untouched period after it.
    Reports the share of folds that held up out of sample.
``purged_cv``
    Cross-validation with purging and embargo, for labels that overlap in time.
    Without purging, a 60-day holding period leaks between adjacent folds.
``monte_carlo_trade_order``
    Reshuffles trade order to see how much of the equity path was luck of
    sequencing, and how bad the drawdown could plausibly have been.
``bootstrap_confidence``
    Block-bootstrap confidence intervals for CAGR and Sharpe.
``parameter_sensitivity``
    Perturbs each parameter. A result that only exists at one setting is a
    curve-fit, not an edge.
``stress_test``
    Replays crisis-shaped shocks and evaluates the worst historical windows.
``screen_result``
    Applies the rejection rules: single-period dependence, fragile parameters,
    unrealistic fills, excessive turnover, too few trades.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import numpy as np

from aegisquant.backtest.engine import BacktestConfig, BacktestEngine, BacktestResult
from aegisquant.backtest.metrics import PerformanceMetrics
from aegisquant.features.market_view import MarketView
from aegisquant.logging_setup import get_logger

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Walk-forward
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class WalkForwardFold:
    index: int
    train_start: date
    train_end: date
    test_start: date
    test_end: date
    train_metrics: dict[str, Any] | None = None
    test_metrics: dict[str, Any] | None = None
    test_trades: int = 0
    passed: bool = False
    reason: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "train_start": self.train_start.isoformat(),
            "train_end": self.train_end.isoformat(),
            "test_start": self.test_start.isoformat(),
            "test_end": self.test_end.isoformat(),
            "train_metrics": self.train_metrics,
            "test_metrics": self.test_metrics,
            "test_trades": self.test_trades,
            "passed": self.passed,
            "reason": self.reason,
        }


@dataclass(slots=True)
class WalkForwardReport:
    folds: list[WalkForwardFold] = field(default_factory=list)
    pass_rate: float = 0.0
    mean_test_cagr: float | None = None
    mean_test_sharpe: float | None = None
    median_test_sharpe: float | None = None
    train_test_sharpe_decay: float | None = None
    total_test_trades: int = 0
    window_mode: str = "rolling"
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "folds": [f.as_dict() for f in self.folds],
            "pass_rate": round(self.pass_rate, 4),
            "mean_test_cagr": self.mean_test_cagr,
            "mean_test_sharpe": self.mean_test_sharpe,
            "median_test_sharpe": self.median_test_sharpe,
            "train_test_sharpe_decay": self.train_test_sharpe_decay,
            "total_test_trades": self.total_test_trades,
            "window_mode": self.window_mode,
            "notes": self.notes,
        }


def _split_windows(
    start: date,
    end: date,
    train_days: int,
    test_days: int,
    expanding: bool,
) -> list[tuple[date, date, date, date]]:
    out: list[tuple[date, date, date, date]] = []
    train_start = start
    train_end = start + timedelta(days=train_days)
    while train_end + timedelta(days=test_days) <= end:
        test_start = train_end + timedelta(days=1)
        test_end = min(end, test_start + timedelta(days=test_days))
        out.append((train_start if not expanding else start, train_end, test_start, test_end))
        train_end = test_end
        if not expanding:
            train_start = train_start + timedelta(days=test_days)
    return out


def walk_forward(
    view: MarketView,
    base_config: BacktestConfig,
    *,
    train_days: int = 504,
    test_days: int = 126,
    expanding: bool = False,
    min_test_trades: int = 3,
    optimizer: Callable[[BacktestResult, BacktestConfig], dict[str, dict[str, Any]]] | None = None,
) -> WalkForwardReport:
    """Run walk-forward analysis.

    ``optimizer`` receives the in-sample result and returns strategy parameters
    to use out of sample. Without one, the same parameters are used throughout,
    which measures robustness across time rather than parameter selection.
    """
    windows = _split_windows(base_config.start, base_config.end, train_days, test_days, expanding)
    report = WalkForwardReport(window_mode="expanding" if expanding else "rolling")
    if not windows:
        report.notes.append(
            f"date range {base_config.start}..{base_config.end} is too short for "
            f"{train_days}-day training plus {test_days}-day test windows"
        )
        return report

    train_sharpes: list[float] = []
    test_sharpes: list[float] = []
    test_cagrs: list[float] = []

    for i, (tr_start, tr_end, te_start, te_end) in enumerate(windows):
        train_cfg = _clone(base_config, tr_start, tr_end, f"{base_config.label}-wf{i}-train")
        train_result = BacktestEngine(view, train_cfg).run()

        params = base_config.strategy_params
        if optimizer is not None:
            try:
                params = optimizer(train_result, train_cfg)
            except Exception as exc:  # a failed optimisation must not fake a pass
                log.warning("walkforward_optimizer_failed", fold=i, error=str(exc))
                params = base_config.strategy_params

        test_cfg = _clone(base_config, te_start, te_end, f"{base_config.label}-wf{i}-test", params=params)
        # The test window needs history for warm-up, so start the data earlier but
        # only evaluate from te_start: the engine warms up before it trades.
        test_cfg.warmup_sessions = base_config.warmup_sessions
        test_result = BacktestEngine(view, test_cfg).run()

        fold = WalkForwardFold(
            index=i,
            train_start=tr_start,
            train_end=tr_end,
            test_start=te_start,
            test_end=te_end,
            train_metrics=_compact(train_result.metrics),
            test_metrics=_compact(test_result.metrics),
            test_trades=len(test_result.trades),
        )
        tm, sm = train_result.metrics, test_result.metrics
        if tm and tm.sharpe is not None:
            train_sharpes.append(tm.sharpe)
        if sm:
            if sm.sharpe is not None:
                test_sharpes.append(sm.sharpe)
            if sm.cagr is not None:
                test_cagrs.append(sm.cagr)

        if fold.test_trades < min_test_trades:
            fold.passed = False
            fold.reason = f"only {fold.test_trades} out-of-sample trades (need {min_test_trades})"
        elif sm is None or sm.total_return <= 0:
            fold.passed = False
            fold.reason = "out-of-sample return was not positive"
        elif sm.max_drawdown < -0.35:
            fold.passed = False
            fold.reason = f"out-of-sample drawdown {sm.max_drawdown:.1%} was unacceptable"
        else:
            fold.passed = True
            fold.reason = (
                f"out-of-sample return {sm.total_return:.1%} over {fold.test_trades} trades "
                f"with a {sm.max_drawdown:.1%} drawdown"
            )
        report.folds.append(fold)
        report.total_test_trades += fold.test_trades

    report.pass_rate = sum(1 for f in report.folds if f.passed) / max(1, len(report.folds))
    report.mean_test_cagr = float(np.mean(test_cagrs)) if test_cagrs else None
    report.mean_test_sharpe = float(np.mean(test_sharpes)) if test_sharpes else None
    report.median_test_sharpe = float(np.median(test_sharpes)) if test_sharpes else None
    if train_sharpes and test_sharpes:
        report.train_test_sharpe_decay = float(np.mean(train_sharpes) - np.mean(test_sharpes))
        if report.train_test_sharpe_decay > 1.0:
            report.notes.append(
                f"Sharpe decays by {report.train_test_sharpe_decay:.2f} from training to test — "
                "a strong sign of overfitting"
            )
    if report.total_test_trades < 30:
        report.notes.append(
            f"only {report.total_test_trades} out-of-sample trades in total — the walk-forward "
            "result is not yet statistically meaningful"
        )
    return report


def _clone(
    config: BacktestConfig,
    start: date,
    end: date,
    label: str,
    params: dict[str, dict[str, Any]] | None = None,
) -> BacktestConfig:
    from copy import deepcopy

    new = deepcopy(config)
    new.start, new.end, new.label = start, end, label
    if params is not None:
        new.strategy_params = params
    return new


def _compact(metrics: PerformanceMetrics | None) -> dict[str, Any] | None:
    if metrics is None:
        return None
    return {
        "total_return": metrics.total_return,
        "cagr": metrics.cagr,
        "sharpe": metrics.sharpe,
        "sortino": metrics.sortino,
        "max_drawdown": metrics.max_drawdown,
        "volatility": metrics.annualized_volatility,
        "trades": metrics.trade_stats.trades,
        "win_rate": metrics.trade_stats.win_rate,
        "profit_factor": metrics.trade_stats.profit_factor,
        "turnover_annual": metrics.turnover_annual,
        "excess_return": metrics.excess_return,
    }


# ---------------------------------------------------------------------------
# Purged cross-validation
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class PurgedFold:
    index: int
    test_start: date
    test_end: date
    train_ranges: list[tuple[date, date]]
    purged_days: int
    embargo_days: int


def purged_kfold_splits(
    sessions: Sequence[date],
    n_splits: int = 5,
    label_horizon_days: int = 60,
    embargo_pct: float = 0.01,
) -> list[PurgedFold]:
    """Purged, embargoed k-fold splits for overlapping labels.

    With a holding period of ``label_horizon_days``, a label that starts just
    before a fold boundary is still resolving inside the next fold. Training on
    it leaks the test period's outcome. Purging removes the overlapping training
    observations; the embargo drops a further slice after each test fold to
    account for serial correlation.
    """
    if not sessions or n_splits < 2:
        return []
    n = len(sessions)
    fold_size = n // n_splits
    embargo = max(1, int(n * embargo_pct))
    folds: list[PurgedFold] = []
    for i in range(n_splits):
        test_lo = i * fold_size
        test_hi = n - 1 if i == n_splits - 1 else (i + 1) * fold_size - 1
        test_start, test_end = sessions[test_lo], sessions[test_hi]

        # Purge any training observation whose label window overlaps the test fold.
        purge_before = test_start - timedelta(days=label_horizon_days)
        purge_after_idx = min(n - 1, test_hi + embargo)
        purge_after = sessions[purge_after_idx]

        train_ranges: list[tuple[date, date]] = []
        if sessions[0] < purge_before:
            train_ranges.append((sessions[0], purge_before))
        if purge_after < sessions[-1]:
            train_ranges.append((purge_after, sessions[-1]))

        folds.append(
            PurgedFold(
                index=i,
                test_start=test_start,
                test_end=test_end,
                train_ranges=train_ranges,
                purged_days=label_horizon_days,
                embargo_days=embargo,
            )
        )
    return folds


def purged_cv(
    view: MarketView,
    base_config: BacktestConfig,
    *,
    n_splits: int = 4,
    label_horizon_days: int = 60,
    embargo_pct: float = 0.01,
) -> dict[str, Any]:
    """Evaluate the strategy on each purged test fold."""
    sessions = [ts.date() for ts in view.sessions(base_config.start, base_config.end)]
    folds = purged_kfold_splits(sessions, n_splits, label_horizon_days, embargo_pct)
    if not folds:
        return {"folds": [], "note": "not enough sessions for purged cross-validation"}

    results = []
    sharpes, returns = [], []
    for fold in folds:
        cfg = _clone(base_config, fold.test_start, fold.test_end, f"{base_config.label}-pcv{fold.index}")
        result = BacktestEngine(view, cfg).run()
        metrics = _compact(result.metrics)
        results.append(
            {
                "index": fold.index,
                "test_start": fold.test_start.isoformat(),
                "test_end": fold.test_end.isoformat(),
                "train_ranges": [[a.isoformat(), b.isoformat()] for a, b in fold.train_ranges],
                "purged_days": fold.purged_days,
                "embargo_days": fold.embargo_days,
                "metrics": metrics,
                "trades": len(result.trades),
            }
        )
        if result.metrics:
            if result.metrics.sharpe is not None:
                sharpes.append(result.metrics.sharpe)
            returns.append(result.metrics.total_return)

    return {
        "folds": results,
        "n_splits": n_splits,
        "label_horizon_days": label_horizon_days,
        "embargo_pct": embargo_pct,
        "mean_sharpe": float(np.mean(sharpes)) if sharpes else None,
        "std_sharpe": float(np.std(sharpes, ddof=1)) if len(sharpes) > 1 else None,
        "mean_return": float(np.mean(returns)) if returns else None,
        "positive_folds": sum(1 for r in returns if r > 0),
        "total_folds": len(folds),
    }


# ---------------------------------------------------------------------------
# Monte Carlo / bootstrap
# ---------------------------------------------------------------------------
def monte_carlo_trade_order(
    trades: list[dict[str, Any]],
    starting_equity: float,
    paths: int = 2000,
    seed: int = 4242,
) -> dict[str, Any]:
    """Reshuffle trade order to separate edge from sequencing luck.

    The set of trades is held fixed and only their order changes, so the final
    return is nearly constant while the *path* — and therefore the drawdown —
    varies a lot. A strategy whose 5th-percentile drawdown is unacceptable was
    lucky in its ordering, not robust.
    """
    pnls = [float(t["net_pnl"]) for t in trades if t.get("net_pnl") is not None]
    if len(pnls) < 10:
        return {"note": f"only {len(pnls)} trades — too few to reshuffle meaningfully"}
    rng = np.random.default_rng(seed)
    arr = np.array(pnls)
    finals, drawdowns = [], []
    for _ in range(paths):
        shuffled = rng.permutation(arr)
        equity = starting_equity + np.cumsum(shuffled)
        equity = np.maximum(equity, 1e-9)
        peak = np.maximum.accumulate(equity)
        drawdowns.append(float(np.min(equity / peak - 1)))
        finals.append(float(equity[-1]))
    dd = np.array(drawdowns)
    fin = np.array(finals)
    return {
        "paths": paths,
        "trades": len(pnls),
        "median_final_equity": float(np.median(fin)),
        "p5_final_equity": float(np.percentile(fin, 5)),
        "p95_final_equity": float(np.percentile(fin, 95)),
        "median_max_drawdown": float(np.median(dd)),
        "p5_max_drawdown": float(np.percentile(dd, 5)),
        "worst_max_drawdown": float(np.min(dd)),
        "probability_of_loss": float((fin < starting_equity).mean()),
        "interpretation": (
            "The trade set is held fixed and only its order is reshuffled, so the spread "
            "in drawdown shows how much of the realised equity path was sequencing luck."
        ),
    }


def bootstrap_confidence(
    equity: list[float],
    dates: list[date],
    *,
    paths: int = 1000,
    block: int = 20,
    seed: int = 909,
) -> dict[str, Any]:
    """Block-bootstrap confidence intervals for CAGR, Sharpe and drawdown."""
    if len(equity) < 60:
        return {"note": f"only {len(equity)} observations — too few to bootstrap"}
    arr = np.array(equity, dtype=float)
    rets = np.diff(arr) / arr[:-1]
    rng = np.random.default_rng(seed)
    years = max((dates[-1] - dates[0]).days / 365.25, 1e-9)
    cagrs: list[float] = []
    sharpes: list[float] = []
    dds: list[float] = []
    for _ in range(paths):
        pieces: list[np.ndarray] = []
        while sum(len(p) for p in pieces) < rets.size:
            lo = int(rng.integers(0, max(1, rets.size - block)))
            pieces.append(rets[lo : lo + block])
        path = np.concatenate(pieces)[: rets.size]
        curve = np.cumprod(1 + path)
        if curve[-1] <= 0:
            continue
        cagrs.append(float(curve[-1] ** (1 / years) - 1))
        sd = float(np.std(path, ddof=1))
        if sd > 0:
            sharpes.append(float(np.mean(path) / sd * np.sqrt(252)))
        peak = np.maximum.accumulate(curve)
        dds.append(float(np.min(curve / peak - 1)))

    def ci(values: list[float]) -> dict[str, float] | None:
        if not values:
            return None
        a = np.array(values)
        return {
            "mean": float(np.mean(a)),
            "p5": float(np.percentile(a, 5)),
            "p50": float(np.percentile(a, 50)),
            "p95": float(np.percentile(a, 95)),
        }

    return {
        "paths": paths,
        "block_size": block,
        "cagr": ci(cagrs),
        "sharpe": ci(sharpes),
        "max_drawdown": ci(dds),
        "interpretation": (
            "Stationary block bootstrap of realised daily returns. The interval reflects "
            "sampling variability only; it does not account for the strategy no longer working."
        ),
    }


# ---------------------------------------------------------------------------
# Parameter sensitivity
# ---------------------------------------------------------------------------
def parameter_sensitivity(
    view: MarketView,
    base_config: BacktestConfig,
    strategy_key: str,
    parameter: str,
    values: list[Any],
) -> dict[str, Any]:
    """Sweep one parameter and report how stable the result is.

    A high coefficient of variation across neighbouring settings means the result
    lives on a knife edge, which is the signature of a curve fit.
    """
    from copy import deepcopy

    rows = []
    sharpes, returns = [], []
    for value in values:
        params = deepcopy(base_config.strategy_params)
        params.setdefault(strategy_key, {})[parameter] = value
        cfg = _clone(
            base_config,
            base_config.start,
            base_config.end,
            f"{base_config.label}-{parameter}={value}",
            params=params,
        )
        cfg.strategy_keys = [strategy_key]
        result = BacktestEngine(view, cfg).run()
        metrics = _compact(result.metrics)
        rows.append({"value": value, "metrics": metrics, "trades": len(result.trades)})
        if result.metrics:
            if result.metrics.sharpe is not None:
                sharpes.append(result.metrics.sharpe)
            returns.append(result.metrics.total_return)

    cv = None
    if len(sharpes) > 1 and abs(float(np.mean(sharpes))) > 1e-9:
        cv = float(np.std(sharpes, ddof=1) / abs(np.mean(sharpes)))
    return {
        "strategy_key": strategy_key,
        "parameter": parameter,
        "values": values,
        "results": rows,
        "sharpe_mean": float(np.mean(sharpes)) if sharpes else None,
        "sharpe_std": float(np.std(sharpes, ddof=1)) if len(sharpes) > 1 else None,
        "sharpe_cv": cv,
        "positive_settings": sum(1 for r in returns if r > 0),
        "total_settings": len(values),
        "fragile": bool(cv is not None and cv > 0.6),
    }


# ---------------------------------------------------------------------------
# Stress testing
# ---------------------------------------------------------------------------
#: Shock scenarios applied to the realised return series. These are *synthetic
#: shocks calibrated to the shape of historical crises*, not replays of those
#: periods — replaying an actual crisis needs price history covering it, which
#: the configured provider may not have.
STRESS_SCENARIOS: dict[str, dict[str, float]] = {
    "sudden_crash_1987": {"shock": -0.22, "days": 1, "vol_multiplier": 3.0},
    "gfc_2008_grind": {"shock": -0.45, "days": 250, "vol_multiplier": 2.5},
    "covid_2020_gap": {"shock": -0.34, "days": 23, "vol_multiplier": 4.0},
    "dotcom_2000_unwind": {"shock": -0.55, "days": 500, "vol_multiplier": 1.8},
    "rate_shock_2022": {"shock": -0.28, "days": 180, "vol_multiplier": 1.6},
    "flash_crash": {"shock": -0.09, "days": 1, "vol_multiplier": 5.0},
}


def stress_test(
    equity: list[float],
    *,
    beta: float | None = None,
    gross_exposure: float | None = None,
) -> dict[str, Any]:
    """Estimate portfolio impact under shock scenarios.

    The estimate is ``benchmark shock x beta x average gross exposure``, plus the
    portfolio's own worst realised window. It is deliberately simple and stated
    as an estimate: a genuine crisis replay requires history that covers it.
    """
    if len(equity) < 30:
        return {"note": "insufficient history for stress testing"}
    arr = np.array(equity, dtype=float)
    rets = np.diff(arr) / arr[:-1]
    b = 1.0 if beta is None else abs(beta)
    exposure = 1.0 if gross_exposure is None else max(0.0, gross_exposure)

    scenarios = {}
    for name, spec in STRESS_SCENARIOS.items():
        estimated = spec["shock"] * b * exposure
        scenarios[name] = {
            "benchmark_shock": spec["shock"],
            "duration_days": spec["days"],
            "vol_multiplier": spec["vol_multiplier"],
            "estimated_portfolio_impact": round(estimated, 4),
            "survives": estimated > -0.60,
        }

    worst_windows = {}
    for window in (5, 21, 63, 252):
        if rets.size <= window:
            continue
        rolled = np.array([float(np.prod(1 + rets[i : i + window]) - 1) for i in range(rets.size - window)])
        worst_windows[f"worst_{window}d"] = float(np.min(rolled))

    return {
        "beta_used": b,
        "avg_gross_exposure_used": exposure,
        "scenarios": scenarios,
        "worst_realised_windows": worst_windows,
        "worst_estimated_impact": min((v["estimated_portfolio_impact"] for v in scenarios.values()), default=None),
        "all_scenarios_survived": all(v["survives"] for v in scenarios.values()),
        "method": (
            "Synthetic shocks calibrated to the shape of historical crises, scaled by the "
            "portfolio's realised beta and average gross exposure. Not a replay of those periods."
        ),
    }


# ---------------------------------------------------------------------------
# Acceptance screen
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class AcceptanceDecision:
    accepted: bool
    rejections: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    checks: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "accepted": self.accepted,
            "rejections": self.rejections,
            "warnings": self.warnings,
            "checks": self.checks,
        }


def screen_result(
    result: BacktestResult,
    *,
    min_trades: int = 30,
    max_turnover_annual: float = 12.0,
    max_single_period_share: float = 0.60,
    max_top5_winner_share: float = 0.85,
    max_drawdown: float = 0.35,
    walkforward: WalkForwardReport | None = None,
    sensitivity: list[dict[str, Any]] | None = None,
    monte_carlo: dict[str, Any] | None = None,
) -> AcceptanceDecision:
    """Reject strategies whose results depend on an artefact.

    Every rule here exists because the corresponding failure mode is common:
    too few trades, one lucky year, a single winner carrying everything, a
    parameter knife edge, turnover that costs more than the edge, or fills that
    could not have happened.
    """
    decision = AcceptanceDecision(accepted=True)
    m = result.metrics
    if m is None:
        decision.accepted = False
        decision.rejections.append("no metrics were produced")
        return decision

    # 1. sample size
    trades = m.trade_stats.trades
    decision.checks["trades"] = trades
    if trades < min_trades:
        decision.accepted = False
        decision.rejections.append(
            f"only {trades} closed trades (minimum {min_trades}) — the result is not distinguishable from luck"
        )

    # 2. dependence on one unusually favourable period
    if result.dates and result.equity:
        by_year: dict[int, float] = {}
        prev_year_equity: dict[int, tuple[float, float]] = {}
        for d, e in zip(result.dates, result.equity, strict=True):
            entry = prev_year_equity.get(d.year)
            if entry is None:
                prev_year_equity[d.year] = (e, e)
            else:
                prev_year_equity[d.year] = (entry[0], e)
        for year, (first, last) in prev_year_equity.items():
            by_year[year] = (last / first - 1) if first > 0 else 0.0
        decision.checks["annual_returns"] = {str(k): round(v, 4) for k, v in by_year.items()}
        total_gain = sum(max(0.0, v) for v in by_year.values())
        if total_gain > 0 and len(by_year) > 1:
            best_share = max(by_year.values()) / total_gain
            decision.checks["best_year_share_of_gains"] = round(best_share, 4)
            if best_share > max_single_period_share:
                decision.accepted = False
                decision.rejections.append(
                    f"{best_share:.0%} of all gains came from a single year — the strategy depends "
                    "on one unusually favourable period"
                )
        positive_years = sum(1 for v in by_year.values() if v > 0)
        decision.checks["positive_years"] = f"{positive_years}/{len(by_year)}"

    # 3. concentration in a handful of winners
    top5 = m.trade_stats.top5_winner_share
    decision.checks["top5_winner_share"] = top5
    if top5 is not None and top5 > max_top5_winner_share and trades >= 20:
        decision.warnings.append(
            f"the five largest winners produced {top5:.0%} of all profit — expected for a growth "
            "mandate, but it means the result rests on very few outcomes"
        )

    # 4. turnover / cost realism
    decision.checks["turnover_annual"] = m.turnover_annual
    if m.turnover_annual is not None and m.turnover_annual > max_turnover_annual:
        decision.accepted = False
        decision.rejections.append(
            f"annual turnover of {m.turnover_annual:.1f}x is above the {max_turnover_annual:.1f}x "
            "ceiling — costs and market impact would consume the edge"
        )
    cost_share = m.trade_stats.cost_share_of_gross
    decision.checks["cost_share_of_gross_pnl"] = cost_share
    if cost_share is not None and cost_share > 0.5:
        decision.accepted = False
        decision.rejections.append(
            f"modelled costs consumed {cost_share:.0%} of gross profit — the edge is not large enough to trade"
        )

    # 5. drawdown
    decision.checks["max_drawdown"] = m.max_drawdown
    if m.max_drawdown < -max_drawdown:
        decision.accepted = False
        decision.rejections.append(f"maximum drawdown {m.max_drawdown:.1%} exceeds the {max_drawdown:.0%} tolerance")

    # 6. unrealistic fills — partial fills and rejections must actually occur
    partials = sum(1 for t in result.trades if t.get("partial"))
    decision.checks["partial_fills"] = partials
    decision.checks["rejected_orders"] = len(result.rejected_orders)
    if result.rejected_orders == [] and trades > 50:
        decision.warnings.append(
            "no order was ever rejected or partially filled across the whole run — verify the "
            "liquidity and participation constraints are actually binding"
        )

    # 7. risk of ruin
    decision.checks["risk_of_ruin"] = m.risk_of_ruin
    if m.risk_of_ruin is not None and m.risk_of_ruin > 0.02:
        decision.accepted = False
        decision.rejections.append(
            f"bootstrapped risk of ruin is {m.risk_of_ruin:.1%} — a meaningful probability of "
            "catastrophic loss disqualifies the strategy regardless of expected return"
        )

    # 8. walk-forward
    if walkforward is not None:
        decision.checks["walkforward_pass_rate"] = walkforward.pass_rate
        decision.checks["walkforward_sharpe_decay"] = walkforward.train_test_sharpe_decay
        if walkforward.folds and walkforward.pass_rate < 0.5:
            decision.accepted = False
            decision.rejections.append(f"only {walkforward.pass_rate:.0%} of walk-forward folds held up out of sample")

    # 9. parameter fragility
    if sensitivity:
        fragile = [s["parameter"] for s in sensitivity if s.get("fragile")]
        decision.checks["fragile_parameters"] = fragile
        if fragile:
            decision.accepted = False
            decision.rejections.append(
                f"results are fragile to {', '.join(fragile)} — performance exists only at "
                "specific settings, which indicates curve fitting"
            )

    # 10. Monte Carlo path risk
    if monte_carlo and "p5_max_drawdown" in monte_carlo:
        decision.checks["mc_p5_max_drawdown"] = monte_carlo["p5_max_drawdown"]
        if monte_carlo["p5_max_drawdown"] < -max_drawdown * 1.5:
            decision.warnings.append(
                f"in the worst 5% of trade orderings the drawdown reaches "
                f"{monte_carlo['p5_max_drawdown']:.1%} — the realised path was favourably ordered"
            )

    if result.uses_synthetic_data:
        decision.warnings.append(
            "this run used SIMULATED data; acceptance here says nothing about real-market viability"
        )
    return decision


def full_validation(
    view: MarketView,
    config: BacktestConfig,
    *,
    run_walk_forward: bool = True,
    run_purged_cv: bool = False,
    sensitivity_specs: list[tuple[str, str, list[Any]]] | None = None,
) -> dict[str, Any]:
    """Run the whole validation battery and return one report."""
    base = BacktestEngine(view, config).run()
    out: dict[str, Any] = {"base": base.summary()}

    mc = monte_carlo_trade_order(base.trades, float(config.starting_cash))
    out["monte_carlo"] = mc
    out["bootstrap"] = bootstrap_confidence(base.equity, base.dates)
    out["stress"] = stress_test(
        base.equity,
        beta=base.metrics.beta if base.metrics else None,
        gross_exposure=base.metrics.exposure_avg if base.metrics else None,
    )

    wf = None
    if run_walk_forward:
        wf = walk_forward(view, config)
        out["walk_forward"] = wf.as_dict()

    if run_purged_cv:
        out["purged_cv"] = purged_cv(view, config)

    sens: list[dict[str, Any]] = []
    for strategy_key, parameter, values in sensitivity_specs or []:
        sens.append(parameter_sensitivity(view, config, strategy_key, parameter, values))
    if sens:
        out["sensitivity"] = sens

    out["acceptance"] = screen_result(base, walkforward=wf, sensitivity=sens or None, monte_carlo=mc).as_dict()
    return out
