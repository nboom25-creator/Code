"""Performance and risk metrics.

Every metric is computed from the realised equity curve and trade ledger, net of
modelled costs. Where a metric is undefined (no losing trades, too few
observations) it is returned as ``None`` rather than as a flattering number.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any

import numpy as np

TRADING_DAYS = 252


@dataclass(slots=True)
class TradeStats:
    trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float | None = None
    avg_win: float | None = None
    avg_loss: float | None = None
    profit_factor: float | None = None
    expectancy: float | None = None
    avg_holding_days: float | None = None
    largest_win: float | None = None
    largest_loss: float | None = None
    top5_winner_share: float | None = None
    total_costs: float = 0.0
    cost_share_of_gross: float | None = None


@dataclass(slots=True)
class PerformanceMetrics:
    """Full metric set. All returns are net of modelled costs."""

    start_date: date | None = None
    end_date: date | None = None
    days: int = 0
    years: float = 0.0

    starting_equity: float = 0.0
    ending_equity: float = 0.0
    total_return: float = 0.0
    cagr: float | None = None
    geometric_mean_daily: float | None = None
    annualized_volatility: float | None = None
    downside_deviation: float | None = None

    sharpe: float | None = None
    sortino: float | None = None
    calmar: float | None = None
    return_to_drawdown: float | None = None

    max_drawdown: float = 0.0
    max_drawdown_start: date | None = None
    max_drawdown_end: date | None = None
    max_drawdown_duration_days: int = 0
    time_to_recovery_days: int | None = None
    avg_drawdown: float | None = None

    var_95: float | None = None
    var_99: float | None = None
    expected_shortfall_95: float | None = None
    worst_day: float | None = None
    best_day: float | None = None

    beta: float | None = None
    alpha_annual: float | None = None
    correlation_to_benchmark: float | None = None
    upside_capture: float | None = None
    downside_capture: float | None = None
    excess_return: float | None = None
    benchmark_total_return: float | None = None
    benchmark_cagr: float | None = None
    benchmark_max_drawdown: float | None = None

    exposure_avg: float | None = None
    exposure_max: float | None = None
    turnover_annual: float | None = None
    capacity_estimate_usd: float | None = None
    transaction_cost_bps_of_equity: float | None = None

    prob_drawdown_10: float | None = None
    prob_drawdown_20: float | None = None
    prob_drawdown_30: float | None = None
    prob_drawdown_50: float | None = None
    risk_of_ruin: float | None = None
    expected_drawdown_duration_days: float | None = None

    rolling_1y: dict[str, float | None] = field(default_factory=dict)
    rolling_3y: dict[str, float | None] = field(default_factory=dict)
    rolling_5y: dict[str, float | None] = field(default_factory=dict)

    trade_stats: TradeStats = field(default_factory=TradeStats)
    uses_synthetic_data: bool = False
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        out = asdict(self)
        for key in ("start_date", "end_date", "max_drawdown_start", "max_drawdown_end"):
            value = out.get(key)
            out[key] = value.isoformat() if isinstance(value, date) else value
        return out


# ---------------------------------------------------------------------------
def _returns(equity: np.ndarray) -> np.ndarray:
    if equity.size < 2:
        return np.array([])
    prev = equity[:-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        rets = np.where(prev > 0, np.diff(equity) / prev, 0.0)
    return np.nan_to_num(rets, nan=0.0, posinf=0.0, neginf=0.0)


def _drawdown_series(equity: np.ndarray) -> np.ndarray:
    if equity.size == 0:
        return np.array([])
    peak = np.maximum.accumulate(equity)
    with np.errstate(divide="ignore", invalid="ignore"):
        dd = np.where(peak > 0, equity / peak - 1.0, 0.0)
    return np.nan_to_num(dd, nan=0.0)


def _cagr(start: float, end: float, years: float) -> float | None:
    if years <= 0 or start <= 0 or end <= 0:
        return None
    return float((end / start) ** (1.0 / years) - 1.0)


def _sharpe(rets: np.ndarray, rf_daily: float = 0.0) -> float | None:
    if rets.size < 20:
        return None
    excess = rets - rf_daily
    sd = float(np.std(excess, ddof=1))
    if sd <= 0:
        return None
    return float(np.mean(excess) / sd * np.sqrt(TRADING_DAYS))


def _sortino(rets: np.ndarray, rf_daily: float = 0.0) -> float | None:
    if rets.size < 20:
        return None
    excess = rets - rf_daily
    downside = excess[excess < 0]
    if downside.size < 5:
        return None
    dd = float(np.sqrt(np.mean(downside**2)))
    if dd <= 0:
        return None
    return float(np.mean(excess) / dd * np.sqrt(TRADING_DAYS))


def _max_drawdown_window(
    equity: np.ndarray, dates: list[date]
) -> tuple[float, date | None, date | None, int, int | None]:
    dd = _drawdown_series(equity)
    if dd.size == 0:
        return 0.0, None, None, 0, None
    trough_idx = int(np.argmin(dd))
    worst = float(dd[trough_idx])
    peak_idx = int(np.argmax(equity[: trough_idx + 1])) if trough_idx > 0 else 0
    start = dates[peak_idx] if peak_idx < len(dates) else None
    end = dates[trough_idx] if trough_idx < len(dates) else None
    duration = (end - start).days if start and end else 0
    recovery: int | None = None
    peak_value = float(equity[peak_idx])
    for i in range(trough_idx + 1, equity.size):
        if equity[i] >= peak_value:
            recovery = (dates[i] - dates[trough_idx]).days
            break
    return worst, start, end, duration, recovery


def _drawdown_episodes(equity: np.ndarray) -> tuple[list[float], list[int]]:
    """Depths and durations (in observations) of every completed drawdown."""
    dd = _drawdown_series(equity)
    depths: list[float] = []
    durations: list[int] = []
    in_dd = False
    depth = 0.0
    length = 0
    for value in dd:
        if value < -1e-9:
            in_dd = True
            depth = min(depth, float(value))
            length += 1
        elif in_dd:
            depths.append(depth)
            durations.append(length)
            in_dd, depth, length = False, 0.0, 0
    if in_dd:
        depths.append(depth)
        durations.append(length)
    return depths, durations


def _beta_alpha(
    rets: np.ndarray, bench: np.ndarray, rf_daily: float = 0.0
) -> tuple[float | None, float | None, float | None]:
    n = min(rets.size, bench.size)
    if n < 30:
        return None, None, None
    r, b = rets[-n:] - rf_daily, bench[-n:] - rf_daily
    var = float(np.var(b, ddof=1))
    if var <= 0:
        return None, None, None
    beta = float(np.cov(r, b, ddof=1)[0, 1] / var)
    alpha_daily = float(np.mean(r) - beta * np.mean(b))
    corr = float(np.corrcoef(r, b)[0, 1]) if float(np.std(r)) > 0 and float(np.std(b)) > 0 else None
    return beta, alpha_daily * TRADING_DAYS, corr


def _capture(rets: np.ndarray, bench: np.ndarray, upside: bool) -> float | None:
    n = min(rets.size, bench.size)
    if n < 30:
        return None
    r, b = rets[-n:], bench[-n:]
    mask = b > 0 if upside else b < 0
    if mask.sum() < 10:
        return None
    bench_mean = float(np.mean(b[mask]))
    if bench_mean == 0:
        return None
    return float(np.mean(r[mask]) / bench_mean)


def _rolling_window(equity: np.ndarray, dates: list[date], years: int) -> dict[str, float | None]:
    window = years * TRADING_DAYS
    if equity.size <= window:
        return {"available": 0.0, "best": None, "worst": None, "median": None, "mean": None}
    values = []
    for i in range(window, equity.size):
        start_v, end_v = float(equity[i - window]), float(equity[i])
        if start_v > 0:
            values.append((end_v / start_v) ** (1.0 / years) - 1.0)
    if not values:
        return {"available": 0.0, "best": None, "worst": None, "median": None, "mean": None}
    arr = np.array(values)
    return {
        "available": float(arr.size),
        "best": float(np.max(arr)),
        "worst": float(np.min(arr)),
        "median": float(np.median(arr)),
        "mean": float(np.mean(arr)),
        "positive_share": float((arr > 0).mean()),
    }


def _bootstrap_drawdown_probabilities(
    rets: np.ndarray, horizon_days: int = TRADING_DAYS, paths: int = 2000, seed: int = 12345
) -> dict[str, float | None]:
    """Probability of reaching drawdown thresholds over ``horizon_days``.

    Stationary block bootstrap of the realised daily returns. This is a
    *model estimate under the assumption that the return distribution is
    representative*, not a guarantee — it is reported as such in the UI.
    """
    if rets.size < 60:
        return {
            "prob_drawdown_10": None,
            "prob_drawdown_20": None,
            "prob_drawdown_30": None,
            "prob_drawdown_50": None,
            "risk_of_ruin": None,
            "expected_drawdown_duration_days": None,
        }
    rng = np.random.default_rng(seed)
    block = max(5, min(20, rets.size // 10))
    hits = {0.10: 0, 0.20: 0, 0.30: 0, 0.50: 0}
    ruin = 0
    durations: list[int] = []
    for _ in range(paths):
        pieces = []
        while sum(len(p) for p in pieces) < horizon_days:
            start = int(rng.integers(0, max(1, rets.size - block)))
            pieces.append(rets[start : start + block])
        path = np.concatenate(pieces)[:horizon_days]
        equity = np.cumprod(1.0 + path)
        dd = _drawdown_series(equity)
        worst = abs(float(np.min(dd))) if dd.size else 0.0
        for threshold in hits:
            if worst >= threshold:
                hits[threshold] += 1
        if worst >= 0.90 or float(np.min(equity)) <= 0.10:
            ruin += 1
        _, durs = _drawdown_episodes(equity)
        if durs:
            durations.append(int(max(durs)))
    return {
        "prob_drawdown_10": hits[0.10] / paths,
        "prob_drawdown_20": hits[0.20] / paths,
        "prob_drawdown_30": hits[0.30] / paths,
        "prob_drawdown_50": hits[0.50] / paths,
        "risk_of_ruin": ruin / paths,
        "expected_drawdown_duration_days": float(np.mean(durations)) if durations else None,
    }


def compute_trade_stats(trades: list[dict[str, Any]]) -> TradeStats:
    stats = TradeStats()
    closed = [t for t in trades if t.get("net_pnl") is not None]
    stats.trades = len(closed)
    if not closed:
        return stats
    pnls = np.array([float(t["net_pnl"]) for t in closed])
    wins, losses = pnls[pnls > 0], pnls[pnls < 0]
    stats.wins, stats.losses = int(wins.size), int(losses.size)
    stats.win_rate = float(wins.size / pnls.size)
    stats.avg_win = float(np.mean(wins)) if wins.size else None
    stats.avg_loss = float(np.mean(losses)) if losses.size else None
    gross_win, gross_loss = float(wins.sum()), float(abs(losses.sum()))
    stats.profit_factor = (gross_win / gross_loss) if gross_loss > 0 else None
    stats.expectancy = float(np.mean(pnls))
    holding = [t["holding_days"] for t in closed if t.get("holding_days") is not None]
    stats.avg_holding_days = float(np.mean(holding)) if holding else None
    stats.largest_win = float(np.max(pnls)) if pnls.size else None
    stats.largest_loss = float(np.min(pnls)) if pnls.size else None
    total_profit = float(pnls[pnls > 0].sum())
    if total_profit > 0:
        top5 = float(np.sort(pnls)[-5:].sum())
        stats.top5_winner_share = top5 / total_profit
    stats.total_costs = float(sum(float(t.get("costs") or 0) for t in closed))
    gross = float(sum(float(t.get("gross_pnl") or 0) for t in closed))
    stats.cost_share_of_gross = (stats.total_costs / abs(gross)) if gross else None
    return stats


def compute_metrics(
    dates: list[date],
    equity_values: list[float],
    *,
    trades: list[dict[str, Any]] | None = None,
    benchmark_values: list[float] | None = None,
    exposures: list[float] | None = None,
    turnovers: list[float] | None = None,
    risk_free_annual: float = 0.0,
    capacity_estimate_usd: float | None = None,
    uses_synthetic_data: bool = False,
    estimate_drawdown_probabilities: bool = True,
) -> PerformanceMetrics:
    """Compute the full metric set from an equity curve and trade ledger."""
    m = PerformanceMetrics(uses_synthetic_data=uses_synthetic_data)
    if not dates or not equity_values or len(dates) != len(equity_values):
        m.notes.append("insufficient data to compute metrics")
        return m

    equity = np.array(equity_values, dtype=float)
    m.start_date, m.end_date = dates[0], dates[-1]
    m.days = (dates[-1] - dates[0]).days
    m.years = max(m.days / 365.25, 1e-9)
    m.starting_equity, m.ending_equity = float(equity[0]), float(equity[-1])
    m.total_return = (m.ending_equity / m.starting_equity - 1.0) if m.starting_equity > 0 else 0.0
    m.cagr = _cagr(m.starting_equity, m.ending_equity, m.years)

    rets = _returns(equity)
    rf_daily = risk_free_annual / TRADING_DAYS
    if rets.size:
        positive = 1.0 + rets
        positive = positive[positive > 0]
        if positive.size:
            m.geometric_mean_daily = float(np.exp(np.mean(np.log(positive))) - 1.0)
        m.annualized_volatility = float(np.std(rets, ddof=1) * np.sqrt(TRADING_DAYS)) if rets.size > 1 else None
        downside = rets[rets < 0]
        if downside.size > 1:
            m.downside_deviation = float(np.std(downside, ddof=1) * np.sqrt(TRADING_DAYS))
        m.worst_day, m.best_day = float(np.min(rets)), float(np.max(rets))
        m.var_95 = float(np.percentile(rets, 5))
        m.var_99 = float(np.percentile(rets, 1))
        tail = rets[rets <= m.var_95]
        m.expected_shortfall_95 = float(np.mean(tail)) if tail.size else None

    m.sharpe = _sharpe(rets, rf_daily)
    m.sortino = _sortino(rets, rf_daily)

    worst_dd, dd_start, dd_end, dd_days, recovery = _max_drawdown_window(equity, dates)
    m.max_drawdown = worst_dd
    m.max_drawdown_start, m.max_drawdown_end = dd_start, dd_end
    m.max_drawdown_duration_days = dd_days
    m.time_to_recovery_days = recovery
    depths, _ = _drawdown_episodes(equity)
    m.avg_drawdown = float(np.mean(depths)) if depths else None
    if m.cagr is not None and worst_dd < 0:
        m.calmar = float(m.cagr / abs(worst_dd))
        m.return_to_drawdown = float(m.total_return / abs(worst_dd))

    if benchmark_values and len(benchmark_values) == len(equity_values):
        bench = np.array(benchmark_values, dtype=float)
        bench_rets = _returns(bench)
        m.benchmark_total_return = float(bench[-1] / bench[0] - 1.0) if bench[0] > 0 else None
        m.benchmark_cagr = _cagr(float(bench[0]), float(bench[-1]), m.years)
        bdd, *_ = _max_drawdown_window(bench, dates)
        m.benchmark_max_drawdown = bdd
        m.beta, m.alpha_annual, m.correlation_to_benchmark = _beta_alpha(rets, bench_rets, rf_daily)
        m.upside_capture = _capture(rets, bench_rets, upside=True)
        m.downside_capture = _capture(rets, bench_rets, upside=False)
        if m.cagr is not None and m.benchmark_cagr is not None:
            m.excess_return = m.cagr - m.benchmark_cagr

    if exposures:
        arr = np.array(exposures, dtype=float)
        m.exposure_avg, m.exposure_max = float(np.mean(arr)), float(np.max(arr))
    if turnovers:
        arr = np.array([t for t in turnovers if t is not None], dtype=float)
        if arr.size:
            m.turnover_annual = float(np.mean(arr) * TRADING_DAYS)

    m.rolling_1y = _rolling_window(equity, dates, 1)
    m.rolling_3y = _rolling_window(equity, dates, 3)
    m.rolling_5y = _rolling_window(equity, dates, 5)

    if estimate_drawdown_probabilities:
        probs = _bootstrap_drawdown_probabilities(rets)
        for key, value in probs.items():
            setattr(m, key, value)

    m.trade_stats = compute_trade_stats(trades or [])
    m.capacity_estimate_usd = capacity_estimate_usd
    if m.trade_stats.total_costs and m.starting_equity > 0:
        m.transaction_cost_bps_of_equity = float(m.trade_stats.total_costs / m.starting_equity * 10_000)

    if rets.size < 60:
        m.notes.append(f"only {rets.size} return observations — risk statistics are not yet meaningful")
    if m.trade_stats.trades < 30:
        m.notes.append(f"only {m.trade_stats.trades} closed trades — trade statistics have wide error bars")
    if uses_synthetic_data:
        m.notes.append(
            "COMPUTED FROM SIMULATED DATA — these figures describe a simulated market, not real historical performance"
        )
    return m


def regime_metrics(
    dates: list[date],
    equity_values: list[float],
    regimes: list[str | None],
) -> dict[str, dict[str, float | None]]:
    """Break performance down by market regime."""
    out: dict[str, dict[str, float | None]] = {}
    if not (len(dates) == len(equity_values) == len(regimes)):
        return out
    equity = np.array(equity_values, dtype=float)
    rets = _returns(equity)
    # returns[i] corresponds to the move into observation i+1
    labels = regimes[1:]
    for label in sorted({r for r in labels if r}):
        mask = np.array([r == label for r in labels])
        subset = rets[mask]
        if subset.size < 5:
            out[label] = {"days": float(subset.size), "note": None, "total_return": None}
            continue
        out[label] = {
            "days": float(subset.size),
            "total_return": float(np.prod(1 + subset) - 1),
            "annualized_return": float((1 + np.mean(subset)) ** TRADING_DAYS - 1),
            "volatility": float(np.std(subset, ddof=1) * np.sqrt(TRADING_DAYS)),
            "sharpe": _sharpe(subset),
            "worst_day": float(np.min(subset)),
            "share_of_days": float(subset.size / max(1, rets.size)),
        }
    return out
