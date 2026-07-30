"""Celery tasks. Each one delegates to a plain function that is directly testable."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from aegisquant.db.session import session_scope
from aegisquant.jobs.celery_app import celery_app
from aegisquant.logging_setup import get_logger

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# plain callables (unit-testable without a broker)
# ---------------------------------------------------------------------------
def do_run_loop(trigger: str = "celery") -> dict[str, Any]:
    from aegisquant.config import get_settings
    from aegisquant.loop.autonomous import run_cycle

    if not get_settings().loop_enabled:
        return {"skipped": True, "reason": "AEGIS_LOOP_ENABLED is false"}
    with session_scope() as session:
        return run_cycle(session, trigger=trigger).as_dict()


def do_reconcile() -> dict[str, Any]:
    from aegisquant.execution.broker.factory import get_broker
    from aegisquant.execution.oms import OrderManager

    with session_scope() as session:
        run = OrderManager(session, get_broker()).reconcile()
        return {
            "status": run.status.value,
            "breaks": (run.breaks or {}).get("count", 0),
            "healed": (run.auto_healed or {}).get("count", 0),
            "resolved": run.resolved,
        }


def do_ingest_daily(days: int = 30) -> dict[str, Any]:
    from aegisquant.data.ingest import ingest_macro, ingest_universe
    from aegisquant.services.backtest_service import default_universe

    end = date.today()
    start = end - timedelta(days=days)
    with session_scope() as session:
        symbols = default_universe(session)
        if not symbols:
            return {"skipped": True, "reason": "no instruments have been registered"}
        report = ingest_universe(session, symbols, start, end)
        macro = ingest_macro(session, start, end)
        return {**report.as_dict(), "macro_rows": macro}


def do_snapshot_metrics() -> dict[str, Any]:
    from aegisquant.ops.alerts import collect_metrics, record_metric

    with session_scope() as session:
        metrics = collect_metrics(session)
        for metric in metrics:
            record_metric(session, metric.name, metric.value, metric.labels)
        return {"recorded": len(metrics)}


def do_close_post_trade_reviews() -> dict[str, Any]:
    """Write post-trade reviews for positions that have closed.

    This is where the system learns: expected versus actual, slippage versus
    estimate, thesis outcome. It records observations; it never changes a model
    on its own.
    """
    from sqlalchemy import select

    from aegisquant.db.models import Decision, Position, PostTradeReview
    from aegisquant.utils.money import safe_div
    from aegisquant.utils.timeutil import utcnow

    created = 0
    with session_scope() as session:
        # A closed position is one with zero quantity but non-zero realised P&L.
        closed = list(session.scalars(select(Position).where(Position.quantity == 0, Position.realized_pnl != 0)))
        for pos in closed:
            decision = session.get(Decision, pos.entry_decision_id) if pos.entry_decision_id else None
            if decision is None or decision.review is not None:
                continue
            holding_days = (utcnow() - pos.opened_at).days if pos.opened_at else None
            realized_pct = safe_div(pos.realized_pnl, abs(pos.cost_basis)) if pos.cost_basis else None
            expected = decision.expected_return
            outcome = "unknown"
            if realized_pct is not None:
                if realized_pct > 0:
                    outcome = (
                        "thesis_played_out"
                        if expected and realized_pct >= expected * Decimal("0.5")
                        else "profitable_below_expectation"
                    )
                else:
                    outcome = "thesis_failed"
            session.add(
                PostTradeReview(
                    decision_id=decision.id,
                    at=utcnow(),
                    symbol=pos.symbol,
                    realized_pnl=pos.realized_pnl,
                    realized_return_pct=realized_pct,
                    holding_days=holding_days,
                    expected_vs_actual={
                        "expected_return": str(expected) if expected is not None else None,
                        "realized_return": str(realized_pct) if realized_pct is not None else None,
                        "expected_holding_days": decision.expected_holding_days,
                        "actual_holding_days": holding_days,
                        "expected_cost_bps": str(decision.estimated_cost_bps or 0),
                        "confidence": str(decision.confidence or 0),
                    },
                    thesis_outcome=outcome,
                    exit_reason=pos.thesis_status,
                    cost_bps=decision.estimated_cost_bps,
                    lessons=(
                        f"Expected {expected} over {decision.expected_holding_days} sessions at "
                        f"{decision.confidence} confidence; realised {realized_pct} over "
                        f"{holding_days} sessions."
                    ),
                    calibration_bucket=(
                        f"{int(float(decision.confidence or 0) * 10) * 10}-"
                        f"{int(float(decision.confidence or 0) * 10) * 10 + 10}%"
                    ),
                )
            )
            created += 1
    return {"reviews_created": created}


def do_run_backtest(run_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Execute a queued backtest by id."""
    from aegisquant.db import enums as E
    from aegisquant.db.models import BacktestRun
    from aegisquant.services import backtest_service as bt

    with session_scope() as session:
        run = session.get(BacktestRun, run_id)
        if run is None:
            return {"error": f"run {run_id} not found"}
        config = bt.build_config(
            session,
            start=date.fromisoformat(payload["start"]),
            end=date.fromisoformat(payload["end"]),
            label=payload.get("label", f"job-{run_id}"),
            universe=payload.get("universe"),
            strategy_keys=payload.get("strategy_keys") or [],
            strategy_params=payload.get("strategy_params") or {},
        )
        result = bt.run_backtest(
            session,
            config,
            phase=E.BacktestPhase(payload.get("phase", "in_sample")),
            with_validation=bool(payload.get("with_validation")),
            run=run,
        )
        return {"run_id": result.id, "status": result.status.value, "accepted": result.accepted}


# ---------------------------------------------------------------------------
# Celery wrappers
# ---------------------------------------------------------------------------
@celery_app.task(name="aegisquant.jobs.tasks.run_loop", bind=True, max_retries=2)
def run_loop(self: Any, trigger: str = "celery") -> dict[str, Any]:  # pragma: no cover - worker path
    try:
        return do_run_loop(trigger)
    except Exception as exc:
        log.exception("task_run_loop_failed")
        raise self.retry(exc=exc, countdown=60) from exc


@celery_app.task(name="aegisquant.jobs.tasks.reconcile", bind=True, max_retries=3)
def reconcile(self: Any) -> dict[str, Any]:  # pragma: no cover - worker path
    try:
        return do_reconcile()
    except Exception as exc:
        log.exception("task_reconcile_failed")
        raise self.retry(exc=exc, countdown=30) from exc


@celery_app.task(name="aegisquant.jobs.tasks.ingest_daily", bind=True, max_retries=3)
def ingest_daily(self: Any, days: int = 30) -> dict[str, Any]:  # pragma: no cover
    try:
        return do_ingest_daily(days)
    except Exception as exc:
        log.exception("task_ingest_failed")
        raise self.retry(exc=exc, countdown=120) from exc


@celery_app.task(name="aegisquant.jobs.tasks.snapshot_metrics")
def snapshot_metrics() -> dict[str, Any]:  # pragma: no cover
    return do_snapshot_metrics()


@celery_app.task(name="aegisquant.jobs.tasks.close_post_trade_reviews")
def close_post_trade_reviews() -> dict[str, Any]:  # pragma: no cover
    return do_close_post_trade_reviews()


@celery_app.task(name="aegisquant.jobs.tasks.run_backtest")
def run_backtest_task(run_id: int, payload: dict[str, Any]) -> dict[str, Any]:  # pragma: no cover
    return do_run_backtest(run_id, payload)
