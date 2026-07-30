"""Command-line interface.

aegisquant init-db                 create the schema (development; use Alembic in production)
aegisquant migrate                 run Alembic migrations to head
aegisquant seed                    populate the demonstration environment
aegisquant ingest                  fetch and validate market data
aegisquant backtest                run a backtest
aegisquant validate                run the full validation battery
aegisquant loop-once               run one autonomous cycle
aegisquant scheduler               run the autonomous loop on an interval
aegisquant worker                  run the durable job worker
aegisquant reconcile               reconcile local state against the broker
aegisquant promote-check           evaluate the promotion gate
aegisquant metrics                 print the operational metrics
aegisquant serve                   run the API server
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from aegisquant import __version__
from aegisquant.config import get_settings
from aegisquant.logging_setup import configure_logging, get_logger

log = get_logger(__name__)


def _print(payload: Any) -> None:
    print(json.dumps(payload, indent=2, default=str))


# ---------------------------------------------------------------------------
def cmd_init_db(args: argparse.Namespace) -> int:
    from aegisquant.db.session import create_all, drop_all

    if args.drop:
        confirm = args.yes or input("Drop every table? Type 'yes' to confirm: ").strip() == "yes"
        if not confirm:
            print("Aborted.")
            return 1
        drop_all()
        print("Schema dropped.")
    create_all()
    print("Schema created.")
    return 0


def cmd_migrate(args: argparse.Namespace) -> int:
    from pathlib import Path

    from alembic.config import Config

    from alembic import command

    ini = Path(__file__).resolve().parent.parent / "alembic.ini"
    if not ini.exists():
        print(f"alembic.ini not found at {ini}", file=sys.stderr)
        return 1
    config = Config(str(ini))
    config.set_main_option("sqlalchemy.url", get_settings().database_url)
    command.upgrade(config, args.revision)
    print(f"Migrated to {args.revision}.")
    return 0


def cmd_seed(args: argparse.Namespace) -> int:
    from aegisquant import seed

    summary = seed.run(
        years=args.years,
        with_backtests=not args.no_backtests,
        with_validation=args.with_validation,
        cycles=args.cycles,
        password=args.password,
    )
    _print({k: v for k, v in summary.items() if k != "paper_cycles"})
    return 0


def cmd_ingest(args: argparse.Namespace) -> int:
    from aegisquant.data.ingest import ingest_macro, ingest_universe
    from aegisquant.db.session import session_scope

    end = date.fromisoformat(args.end) if args.end else date.today()
    start = date.fromisoformat(args.start) if args.start else end - timedelta(days=args.days)
    symbols = [s.strip().upper() for s in args.symbols.split(",")] if args.symbols else None

    with session_scope() as session:
        if symbols is None:
            from aegisquant.services.backtest_service import default_universe

            symbols = default_universe(session)
            if not symbols:
                from aegisquant.data.providers.fixture import DEMO_UNIVERSE

                symbols = [s for s, _, _, _ in DEMO_UNIVERSE]
        report = ingest_universe(
            session,
            symbols,
            start,
            end,
            with_fundamentals=not args.no_fundamentals,
            with_news=not args.no_news,
            news_lookback_days=args.news_days,
            cross_check=args.cross_check,
        )
        macro = ingest_macro(session, start, end) if not args.no_macro else 0
    _print({**report.as_dict(), "macro_rows": macro, "start": str(start), "end": str(end)})
    return 0 if report.symbols_ok else 1


def cmd_backtest(args: argparse.Namespace) -> int:
    from aegisquant.db import enums as E
    from aegisquant.db.session import session_scope
    from aegisquant.services import backtest_service as bt

    end = date.fromisoformat(args.end) if args.end else date.today()
    start = date.fromisoformat(args.start) if args.start else end - timedelta(days=args.days)
    keys = [k.strip() for k in args.strategies.split(",")] if args.strategies else []
    symbols = [s.strip().upper() for s in args.symbols.split(",")] if args.symbols else None

    with session_scope() as session:
        config = bt.build_config(
            session,
            start=start,
            end=end,
            label=args.label,
            universe=symbols,
            strategy_keys=keys,
            starting_cash=Decimal(str(args.cash)),
            rebalance_interval_days=args.rebalance,
            review_interval_days=args.review,
        )
        run = bt.run_backtest(
            session,
            config,
            phase=E.BacktestPhase(args.phase),
            strategy_key=keys[0] if keys else None,
            with_validation=args.validate,
        )
        metrics = run.metrics or {}
        _print(
            {
                "run_id": run.id,
                "status": run.status.value,
                "accepted": run.accepted,
                "uses_synthetic_data": run.uses_synthetic_data,
                "error": run.error,
                "headline": {
                    "total_return": metrics.get("total_return"),
                    "cagr": metrics.get("cagr"),
                    "volatility": metrics.get("annualized_volatility"),
                    "sharpe": metrics.get("sharpe"),
                    "sortino": metrics.get("sortino"),
                    "calmar": metrics.get("calmar"),
                    "max_drawdown": metrics.get("max_drawdown"),
                    "trades": (metrics.get("trade_stats") or {}).get("trades"),
                    "win_rate": (metrics.get("trade_stats") or {}).get("win_rate"),
                    "profit_factor": (metrics.get("trade_stats") or {}).get("profit_factor"),
                    "benchmark_total_return": metrics.get("benchmark_total_return"),
                    "excess_return": metrics.get("excess_return"),
                    "risk_of_ruin": metrics.get("risk_of_ruin"),
                },
                "rejection_reasons": run.rejection_reasons,
                "notes": metrics.get("notes"),
            }
        )
        return 0 if run.status.value == "completed" else 1


def cmd_validate(args: argparse.Namespace) -> int:
    from aegisquant.backtest.validation import full_validation
    from aegisquant.db.session import session_scope
    from aegisquant.features.market_view import MarketView
    from aegisquant.services import backtest_service as bt

    end = date.fromisoformat(args.end) if args.end else date.today()
    start = date.fromisoformat(args.start) if args.start else end - timedelta(days=args.days)
    with session_scope() as session:
        config = bt.build_config(session, start=start, end=end, label="cli-validation")
        view = MarketView.load(session, config.universe, benchmark=config.benchmark)
        report = full_validation(
            view,
            config,
            run_walk_forward=not args.no_walk_forward,
            run_purged_cv=args.purged_cv,
            sensitivity_specs=[("xs_momentum", "min_trend_quality", [0.2, 0.3, 0.4])] if args.sensitivity else None,
        )
    _print(
        {
            "acceptance": report["acceptance"],
            "walk_forward": {k: v for k, v in (report.get("walk_forward") or {}).items() if k != "folds"},
            "monte_carlo": report.get("monte_carlo"),
            "bootstrap": report.get("bootstrap"),
            "stress": {
                "worst_estimated_impact": (report.get("stress") or {}).get("worst_estimated_impact"),
                "all_scenarios_survived": (report.get("stress") or {}).get("all_scenarios_survived"),
            },
        }
    )
    return 0 if report["acceptance"]["accepted"] else 1


def cmd_loop_once(args: argparse.Namespace) -> int:
    from aegisquant.db.session import session_scope
    from aegisquant.loop.autonomous import run_cycle

    with session_scope() as session:
        outcome = run_cycle(session, ingest=not args.no_ingest, trigger="cli")
    _print(
        {
            "run_id": outcome.run_id,
            "status": outcome.status.value,
            "regime": outcome.regime.value if outcome.regime else None,
            "candidates": outcome.candidates,
            "decisions": len(outcome.decisions),
            "orders_submitted": outcome.orders_submitted,
            "orders_rejected": outcome.orders_rejected,
            "halted_reason": outcome.halted_reason,
            "summary": outcome.summary,
            "steps": [{"name": s.name, "ok": s.ok, "message": s.message, "ms": s.duration_ms} for s in outcome.steps],
        }
    )
    return 0 if outcome.status.value == "completed" else 1


def cmd_scheduler(args: argparse.Namespace) -> int:
    """Run the autonomous loop on a fixed interval.

    Deliberately simple and restart-safe: state lives in the database, so an
    interrupted cycle is picked up by the next one, and the idempotent client
    order ids stop a restart from duplicating an order.
    """
    from aegisquant.db.session import session_scope
    from aegisquant.loop.autonomous import run_cycle

    settings = get_settings()
    interval = args.interval or settings.loop_interval_seconds
    print(f"Scheduler started: one cycle every {interval}s in {settings.mode.value} mode. Ctrl-C to stop.")
    cycles = 0
    while True:
        started = time.monotonic()
        try:
            with session_scope() as session:
                outcome = run_cycle(session, trigger="scheduler")
            cycles += 1
            log.info(
                "scheduler_cycle",
                cycle=cycles,
                status=outcome.status.value,
                summary=outcome.summary or outcome.halted_reason,
            )
        except KeyboardInterrupt:
            print("\nScheduler stopped.")
            return 0
        except Exception:
            log.exception("scheduler_cycle_failed")
        if args.once:
            return 0
        elapsed = time.monotonic() - started
        try:
            time.sleep(max(1.0, interval - elapsed))
        except KeyboardInterrupt:
            print("\nScheduler stopped.")
            return 0


def cmd_worker(args: argparse.Namespace) -> int:
    from aegisquant.jobs.celery_app import celery_app

    argv = ["worker", "--loglevel=info", f"--concurrency={args.concurrency}"]
    if args.beat:
        argv.append("--beat")
    celery_app.worker_main(argv)
    return 0


def cmd_reconcile(args: argparse.Namespace) -> int:
    from aegisquant.db.session import session_scope
    from aegisquant.execution.broker.factory import get_broker
    from aegisquant.execution.oms import OrderManager

    with session_scope() as session:
        run = OrderManager(session, get_broker()).reconcile(auto_heal=not args.no_heal)
        _print(
            {
                "status": run.status.value,
                "positions_checked": run.positions_checked,
                "orders_checked": run.orders_checked,
                "breaks": run.breaks,
                "auto_healed": run.auto_healed,
                "resolved": run.resolved,
                "error": run.error,
            }
        )
        return 0 if run.resolved else 2


def cmd_promote_check(args: argparse.Namespace) -> int:
    from aegisquant.db.session import session_scope
    from aegisquant.governance import promotion

    with session_scope() as session:
        if args.strategy:
            _print(promotion.evaluate(session, args.strategy).as_dict())
        else:
            results = promotion.evaluate_all(session)
            _print(
                [
                    {
                        "strategy_key": r["strategy_key"],
                        "from": r["from_status"],
                        "to": r["to_status"],
                        "passed": r["passed"],
                        "blocking": r["blocking"][:3],
                    }
                    for r in results
                ]
            )
    return 0


def cmd_metrics(args: argparse.Namespace) -> int:
    from aegisquant.db.session import session_scope
    from aegisquant.ops.alerts import collect_metrics, prometheus_text

    with session_scope() as session:
        metrics = collect_metrics(session)
        if args.prometheus:
            print(prometheus_text(metrics), end="")
        else:
            _print({m.name: str(m.value) for m in metrics})
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "aegisquant.api.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_config=None,
        access_log=settings.debug,
    )
    return 0


def cmd_live_preflight(args: argparse.Namespace) -> int:
    from aegisquant.db.session import session_scope
    from aegisquant.governance import live_gate

    broker = None
    try:
        from aegisquant.execution.broker.factory import get_broker

        broker = get_broker()
    except Exception as exc:
        print(f"(broker unavailable: {exc})", file=sys.stderr)
    with session_scope() as session:
        result = live_gate.preflight(session, broker)
    _print(result.as_dict())
    return 0 if result.granted else 1


# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="aegisquant",
        description="AegisQuant — autonomous, auditable equities research and execution platform",
    )
    parser.add_argument("--version", action="version", version=f"AegisQuant {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init-db", help="create the schema directly (development)")
    p.add_argument("--drop", action="store_true", help="drop every table first")
    p.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    p.set_defaults(func=cmd_init_db)

    p = sub.add_parser("migrate", help="run Alembic migrations")
    p.add_argument("--revision", default="head")
    p.set_defaults(func=cmd_migrate)

    p = sub.add_parser("seed", help="populate the demonstration environment")
    p.add_argument("--years", type=int, default=4)
    p.add_argument("--no-backtests", action="store_true")
    p.add_argument("--with-validation", action="store_true")
    p.add_argument("--cycles", type=int, default=1)
    p.add_argument("--password")
    p.set_defaults(func=cmd_seed)

    p = sub.add_parser("ingest", help="fetch and validate market data")
    p.add_argument("--symbols", help="comma-separated symbols (default: the stored universe)")
    p.add_argument("--start")
    p.add_argument("--end")
    p.add_argument("--days", type=int, default=420)
    p.add_argument("--news-days", type=int, default=120)
    p.add_argument("--no-fundamentals", action="store_true")
    p.add_argument("--no-news", action="store_true")
    p.add_argument("--no-macro", action="store_true")
    p.add_argument("--cross-check", action="store_true", help="compare a second provider")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("backtest", help="run a backtest")
    p.add_argument("--start")
    p.add_argument("--end")
    p.add_argument("--days", type=int, default=1095)
    p.add_argument("--symbols")
    p.add_argument("--strategies", help="comma-separated strategy keys (default: all)")
    p.add_argument("--cash", default="100000")
    p.add_argument("--label", default="cli-backtest")
    p.add_argument(
        "--phase",
        default="in_sample",
        choices=["in_sample", "validation", "out_of_sample", "paper", "live"],
    )
    p.add_argument("--rebalance", type=int, default=5)
    p.add_argument("--review", type=int, default=5)
    p.add_argument("--validate", action="store_true", help="also run walk-forward and sensitivity")
    p.set_defaults(func=cmd_backtest)

    p = sub.add_parser("validate", help="run the full validation battery")
    p.add_argument("--start")
    p.add_argument("--end")
    p.add_argument("--days", type=int, default=1460)
    p.add_argument("--no-walk-forward", action="store_true")
    p.add_argument("--purged-cv", action="store_true")
    p.add_argument("--sensitivity", action="store_true")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("loop-once", help="run one autonomous cycle")
    p.add_argument("--no-ingest", action="store_true")
    p.set_defaults(func=cmd_loop_once)

    p = sub.add_parser("scheduler", help="run the autonomous loop on an interval")
    p.add_argument("--interval", type=int)
    p.add_argument("--once", action="store_true")
    p.set_defaults(func=cmd_scheduler)

    p = sub.add_parser("worker", help="run the durable job worker")
    p.add_argument("--concurrency", type=int, default=2)
    p.add_argument("--beat", action="store_true", help="also run the periodic scheduler")
    p.set_defaults(func=cmd_worker)

    p = sub.add_parser("reconcile", help="reconcile against the broker")
    p.add_argument("--no-heal", action="store_true")
    p.set_defaults(func=cmd_reconcile)

    p = sub.add_parser("promote-check", help="evaluate the promotion gate")
    p.add_argument("--strategy")
    p.set_defaults(func=cmd_promote_check)

    p = sub.add_parser("metrics", help="print operational metrics")
    p.add_argument("--prometheus", action="store_true")
    p.set_defaults(func=cmd_metrics)

    p = sub.add_parser("live-preflight", help="show what stands between here and live trading")
    p.set_defaults(func=cmd_live_preflight)

    p = sub.add_parser("serve", help="run the API server")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true")
    p.set_defaults(func=cmd_serve)

    return parser


def main() -> int:
    configure_logging(json_output=False)
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
