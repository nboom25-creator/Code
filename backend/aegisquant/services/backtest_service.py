"""Backtest orchestration and persistence.

Runs are recorded with their configuration, cost model, metrics, per-trade
ledger, equity curve, regime breakdown, validation diagnostics and the acceptance
verdict. Phase (``in_sample`` / ``validation`` / ``out_of_sample`` / ``paper`` /
``live``) is stored on every run so the UI can never mix them up.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.backtest.costs import CostModel
from aegisquant.backtest.engine import BacktestConfig, BacktestEngine, BacktestResult
from aegisquant.backtest.validation import (
    bootstrap_confidence,
    monte_carlo_trade_order,
    parameter_sensitivity,
    purged_cv,
    screen_result,
    stress_test,
    walk_forward,
)
from aegisquant.config import RiskLimits, get_settings
from aegisquant.db import enums as E
from aegisquant.db.models import (
    BacktestRun,
    BacktestTrade,
    EquityPoint,
    Instrument,
)
from aegisquant.db.models import (
    Strategy as StrategyRow,
)
from aegisquant.features.market_view import MarketView
from aegisquant.logging_setup import get_logger
from aegisquant.utils.money import D
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)


def default_universe(session: Session, limit: int = 250) -> list[str]:
    rows = session.scalars(
        select(Instrument.symbol).where(Instrument.is_active.is_(True), Instrument.is_leveraged_etf.is_(False))
    ).all()
    return list(rows)[:limit]


def build_config(
    session: Session,
    *,
    start: date,
    end: date,
    label: str,
    universe: list[str] | None = None,
    strategy_keys: list[str] | None = None,
    strategy_params: dict[str, dict[str, Any]] | None = None,
    starting_cash: Decimal | None = None,
    benchmark: str | None = None,
    limits: RiskLimits | None = None,
    cost_model: CostModel | None = None,
    rebalance_interval_days: int = 5,
    review_interval_days: int = 5,
    warmup_sessions: int = 260,
) -> BacktestConfig:
    settings = get_settings()
    return BacktestConfig(
        start=start,
        end=end,
        starting_cash=starting_cash or Decimal("100000"),
        universe=universe or default_universe(session),
        strategy_keys=strategy_keys or [],
        strategy_params=strategy_params or {},
        benchmark=(benchmark or settings.benchmark_symbol).upper(),
        label=label,
        cost_model=cost_model or CostModel(),
        limits=limits or settings.risk,
        rebalance_interval_days=rebalance_interval_days,
        review_interval_days=review_interval_days,
        warmup_sessions=warmup_sessions,
    )


def create_run(
    session: Session,
    config: BacktestConfig,
    *,
    phase: E.BacktestPhase = E.BacktestPhase.IN_SAMPLE,
    strategy_key: str | None = None,
) -> BacktestRun:
    strategy_id = None
    if strategy_key:
        row = session.scalar(select(StrategyRow).where(StrategyRow.key == strategy_key))
        strategy_id = row.id if row else None
    run = BacktestRun(
        label=config.label,
        strategy_id=strategy_id,
        strategy_keys={"keys": config.strategy_keys or ["<all>"]},
        phase=phase,
        status=E.RunStatus.QUEUED,
        start_date=config.start,
        end_date=config.end,
        starting_cash=config.starting_cash,
        universe={"symbols": config.universe},
        params=config.as_dict(),
        cost_model=config.cost_model.as_dict(),
        benchmark_symbol=config.benchmark,
    )
    session.add(run)
    session.flush()
    return run


def persist_result(
    session: Session,
    run: BacktestRun,
    result: BacktestResult,
    *,
    validation: dict[str, Any] | None = None,
    max_trades: int = 5000,
    max_points: int = 5000,
) -> BacktestRun:
    run.status = E.RunStatus.COMPLETED
    run.finished_at = utcnow()
    run.duration_ms = result.duration_ms
    run.metrics = result.metrics.as_dict() if result.metrics else None
    run.benchmark_metrics = result.benchmark_metrics.as_dict() if result.benchmark_metrics else None
    run.regime_metrics = result.regime_breakdown
    run.uses_synthetic_data = result.uses_synthetic_data

    diagnostics = dict(result.diagnostics)
    if validation:
        diagnostics.update(
            {
                k: v
                for k, v in validation.items()
                if k
                in (
                    "walk_forward",
                    "purged_cv",
                    "sensitivity",
                    "monte_carlo",
                    "bootstrap",
                    "stress",
                )
            }
        )
    run.diagnostics = diagnostics

    acceptance = (validation or {}).get("acceptance")
    if acceptance is None:
        acceptance = screen_result(result).as_dict()
    run.accepted = bool(acceptance.get("accepted"))
    run.rejection_reasons = {
        "rejections": acceptance.get("rejections", []),
        "warnings": acceptance.get("warnings", []),
        "checks": acceptance.get("checks", {}),
    }

    # Trades and equity points, bounded so a long run cannot bloat the row set.
    step = max(1, len(result.trades) // max_trades) if result.trades else 1
    for trade in result.trades[::step]:
        session.add(
            BacktestTrade(
                run_id=run.id,
                symbol=trade["symbol"],
                strategy_key=trade.get("strategy_key"),
                side=E.Side.BUY,
                entry_at=_dt(trade.get("entry_at")),
                exit_at=_dt(trade.get("exit_at")),
                quantity=D(trade["quantity"]),
                entry_price=D(trade["entry_price"]),
                exit_price=D(trade["exit_price"]) if trade.get("exit_price") else None,
                gross_pnl=D(trade["gross_pnl"]),
                costs=D(trade["costs"]),
                net_pnl=D(trade["net_pnl"]),
                return_pct=D(trade["return_pct"]),
                holding_days=trade.get("holding_days"),
                exit_reason=(trade.get("exit_reason") or "")[:80] or None,
                mae_pct=D(trade.get("mae_pct") or 0),
                mfe_pct=D(trade.get("mfe_pct") or 0),
            )
        )

    point_step = max(1, len(result.dates) // max_points) if result.dates else 1
    for i in range(0, len(result.dates), point_step):
        session.add(
            EquityPoint(
                run_id=run.id,
                session_date=result.dates[i],
                equity=D(result.equity[i]),
                cash=D(result.cash[i]),
                gross_exposure=D(result.gross_exposure[i]),
                net_exposure=D(result.net_exposure[i]),
                drawdown=D(result.drawdown[i]),
                benchmark_equity=D(result.benchmark[i]) if i < len(result.benchmark) else None,
                positions=result.position_counts[i],
                turnover=D(result.turnover[i]) if i < len(result.turnover) else None,
                regime=E.Regime(result.regimes[i]) if result.regimes[i] else None,
            )
        )
    session.flush()
    return run


def _dt(value: Any):
    from datetime import datetime

    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value)).replace(tzinfo=utcnow().tzinfo)
    except ValueError:
        return None


def run_backtest(
    session: Session,
    config: BacktestConfig,
    *,
    phase: E.BacktestPhase = E.BacktestPhase.IN_SAMPLE,
    strategy_key: str | None = None,
    with_validation: bool = False,
    sensitivity_specs: list[tuple[str, str, list[Any]]] | None = None,
    run: BacktestRun | None = None,
) -> BacktestRun:
    """Execute a backtest and persist everything about it."""
    run = run or create_run(session, config, phase=phase, strategy_key=strategy_key)
    run.status = E.RunStatus.RUNNING
    run.started_at = utcnow()
    session.flush()

    try:
        view = MarketView.load(session, config.universe, benchmark=config.benchmark)
        result = BacktestEngine(view, config).run()

        validation: dict[str, Any] | None = None
        if with_validation:
            mc = monte_carlo_trade_order(result.trades, float(config.starting_cash))
            wf = walk_forward(view, config)
            sens = [
                parameter_sensitivity(view, config, key, param, values)
                for key, param, values in (sensitivity_specs or [])
            ]
            validation = {
                "monte_carlo": mc,
                "bootstrap": bootstrap_confidence(result.equity, result.dates),
                "stress": stress_test(
                    result.equity,
                    beta=result.metrics.beta if result.metrics else None,
                    gross_exposure=result.metrics.exposure_avg if result.metrics else None,
                ),
                "walk_forward": wf.as_dict(),
                "sensitivity": sens,
                "acceptance": screen_result(result, walkforward=wf, sensitivity=sens or None, monte_carlo=mc).as_dict(),
            }
        persist_result(session, run, result, validation=validation)
        log.info(
            "backtest_completed",
            run_id=run.id,
            label=config.label,
            trades=len(result.trades),
            accepted=run.accepted,
        )
    except Exception as exc:
        log.exception("backtest_failed", run_id=run.id)
        run.status = E.RunStatus.FAILED
        run.error = f"{type(exc).__name__}: {exc}"
        run.finished_at = utcnow()
        session.flush()
    return run


def run_purged_cv_for(
    session: Session, config: BacktestConfig, *, n_splits: int = 4, horizon: int = 60
) -> dict[str, Any]:
    view = MarketView.load(session, config.universe, benchmark=config.benchmark)
    return purged_cv(view, config, n_splits=n_splits, label_horizon_days=horizon)
