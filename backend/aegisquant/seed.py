"""Seed a demonstration environment.

Everything created here is reproducible from the fixture seed, and every record
that came from the market simulator is flagged ``is_synthetic=True`` so the API
and UI can label it. Nothing in this module fabricates *real* market data or
presents simulated results as real.

What it creates:

* users (admin / operator / viewer) — passwords come from configuration
* the demo instrument universe, calendar, bars, corporate actions, fundamentals,
  news and macro series
* the twelve strategies with their metadata and initial version rows
* an active risk configuration
* one in-sample and one out-of-sample backtest run, with validation
* one autonomous paper cycle against the mock broker, producing decisions,
  orders, fills, positions, a portfolio snapshot and a reconciliation run
"""

from __future__ import annotations

import argparse
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.api.security import hash_password
from aegisquant.config import get_settings
from aegisquant.data.ingest import ingest_macro, ingest_universe
from aegisquant.data.providers.fixture import DEMO_UNIVERSE
from aegisquant.db import enums as E
from aegisquant.db.models import (
    Instrument,
    RiskConfig,
    StrategyVersion,
    User,
)
from aegisquant.db.models import (
    Strategy as StrategyRow,
)
from aegisquant.db.repo import get_system_state
from aegisquant.db.session import create_all, session_scope
from aegisquant.logging_setup import configure_logging, get_logger
from aegisquant.services import backtest_service as bt
from aegisquant.strategies.registry import STRATEGY_CLASSES
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)

DEMO_USERS = [
    ("admin@aegisquant.local", E.Role.ADMIN),
    ("operator@aegisquant.local", E.Role.OPERATOR),
    ("viewer@aegisquant.local", E.Role.VIEWER),
]


def seed_users(session: Session, password: str | None = None) -> int:
    settings = get_settings()
    raw = password or settings.bootstrap_admin_password.get_secret_value()
    created = 0
    for email, role in DEMO_USERS:
        existing = session.scalar(select(User).where(User.email == email))
        if existing is not None:
            continue
        session.add(User(email=email, password_hash=hash_password(raw), role=role, is_active=True))
        created += 1
    session.flush()
    if created:
        log.warning(
            "demo_users_created",
            count=created,
            note="these are development credentials; change them before any real deployment",
        )
    return created


def seed_strategies(session: Session) -> int:
    created = 0
    for cls in STRATEGY_CLASSES:
        meta = cls.meta
        row = session.scalar(select(StrategyRow).where(StrategyRow.key == meta.key))
        if row is None:
            row = StrategyRow(
                key=meta.key,
                name=meta.name,
                family=meta.family,
                description=meta.description,
                # Seeded at PAPER so the demo has something running, but nothing
                # is live-eligible until the promotion gate says so.
                status=E.StrategyStatus.PAPER,
                enabled=True,
                metadata_json=meta.as_dict(),
            )
            session.add(row)
            session.flush()
            created += 1
        else:
            row.metadata_json = meta.as_dict()
        if not row.versions:
            session.add(
                StrategyVersion(
                    strategy_id=row.id,
                    version=meta.version,
                    params=cls.default_params,
                    origin="human",
                    quarantined=False,
                    approved_by="seed",
                    approved_at=utcnow(),
                    notes="initial version registered by the seeding script",
                )
            )
    session.flush()
    return created


def seed_risk_config(session: Session) -> RiskConfig | None:
    existing = session.scalar(select(RiskConfig).where(RiskConfig.is_active.is_(True)))
    if existing is not None:
        return existing
    limits = get_settings().risk
    row = RiskConfig(
        version=1,
        is_active=True,
        limits={k: str(v) for k, v in limits.model_dump().items()},
        updated_by="seed",
        note="initial risk configuration from environment defaults",
    )
    session.add(row)
    session.flush()
    return row


def seed_market_data(session: Session, *, years: int = 4, symbols: list[str] | None = None) -> dict[str, Any]:
    end = utcnow().date()
    start = end - timedelta(days=365 * years + 30)
    universe = symbols or [s for s, _, _, _ in DEMO_UNIVERSE]
    report = ingest_universe(
        session,
        universe,
        start,
        end,
        with_fundamentals=True,
        with_news=True,
        # The simulator can serve the whole window, so news features are
        # populated across history rather than only near the present.
        news_lookback_days=365 * years + 30,
    )
    macro_rows = ingest_macro(session, start, end)
    return {**report.as_dict(), "macro_rows": macro_rows, "start": start, "end": end}


def seed_backtests(session: Session, *, start: date, end: date, with_validation: bool = True) -> list[int]:
    """One in-sample run and one out-of-sample run on disjoint windows."""
    split = start + (end - start) * 2 // 3
    runs: list[int] = []

    in_sample = bt.build_config(
        session,
        start=start,
        end=split,
        label="demo in-sample",
        rebalance_interval_days=5,
        review_interval_days=5,
    )
    runs.append(bt.run_backtest(session, in_sample, phase=E.BacktestPhase.IN_SAMPLE, with_validation=False).id)

    out_of_sample = bt.build_config(
        session,
        start=split,
        end=end,
        label="demo out-of-sample",
        rebalance_interval_days=5,
        review_interval_days=5,
    )
    runs.append(
        bt.run_backtest(
            session,
            out_of_sample,
            phase=E.BacktestPhase.OUT_OF_SAMPLE,
            with_validation=with_validation,
            sensitivity_specs=[
                ("xs_momentum", "min_trend_quality", [0.2, 0.3, 0.4]),
            ]
            if with_validation
            else None,
        ).id
    )
    return runs


def seed_paper_cycle(session: Session, *, cycles: int = 1) -> list[dict[str, Any]]:
    """Run the autonomous loop against the mock broker, seeded with live prices."""
    from aegisquant.config import get_settings
    from aegisquant.db.repo import latest_bar
    from aegisquant.execution.broker.factory import set_broker
    from aegisquant.execution.broker.mock import MockBroker, MockMarket
    from aegisquant.loop.autonomous import run_cycle

    symbols = list(session.scalars(select(Instrument.symbol)))
    market = MockMarket()
    for symbol in symbols:
        bar = latest_bar(session, symbol)
        if bar is not None and bar.close > 0:
            market.set_price(symbol, bar.close)
            market.shortable.add(symbol)
    # The simulated venue is declared open so the seeded cycle actually decides
    # something. Against a real broker the loop reads the real session status and
    # correctly refuses to trade outside market hours.
    broker = MockBroker(starting_cash=Decimal("100000"), market=market, market_open=True)
    set_broker(broker, "mock")

    # Evaluate as of the most recent bar close, so features see complete history.
    benchmark_bar = latest_bar(session, get_settings().benchmark_symbol)
    as_of = benchmark_bar.ts if benchmark_bar else utcnow()

    outcomes = []
    for _ in range(cycles):
        outcome = run_cycle(
            session,
            broker=broker,
            universe=symbols,
            now=as_of,
            ingest=False,  # data was just seeded
            trigger="seed",
        )
        outcomes.append(outcome.as_dict())
        # Let resting limit orders fill at the seeded prices.
        broker.advance()
    return outcomes


def seed_post_trade_reviews(session: Session) -> int:
    """Create post-trade reviews for decisions whose orders have filled."""
    from aegisquant.db.models import Decision, PostTradeReview

    created = 0
    for decision in session.scalars(select(Decision).where(Decision.approval_state == E.ApprovalState.AUTO_APPROVED)):
        if decision.review is not None:
            continue
        filled = [o for o in decision.orders if o.status in (E.OrderStatus.FILLED, E.OrderStatus.PARTIALLY_FILLED)]
        if not filled:
            continue
        order = filled[0]
        if order.avg_fill_price is None or decision.reference_price is None:
            continue
        slippage = order.realized_slippage_bps
        session.add(
            PostTradeReview(
                decision_id=decision.id,
                at=utcnow(),
                symbol=decision.symbol,
                realized_pnl=None,  # position still open; realised P&L comes at exit
                realized_return_pct=None,
                holding_days=0,
                expected_vs_actual={
                    "expected_price": str(decision.reference_price),
                    "actual_fill_price": str(order.avg_fill_price),
                    "expected_cost_bps": str(decision.estimated_cost_bps or 0),
                    "realized_slippage_bps": str(slippage or 0),
                    "expected_return": str(decision.expected_return or 0),
                },
                thesis_outcome="open",
                exit_reason=None,
                slippage_bps=slippage,
                cost_bps=decision.estimated_cost_bps,
                lessons=(
                    f"Entry filled at {order.avg_fill_price} against a reference of "
                    f"{decision.reference_price} ({slippage or 0} bps). "
                    "Outcome will be scored when the position closes."
                ),
                calibration_bucket=(
                    f"{int(float(decision.confidence or 0) * 10) * 10}-"
                    f"{int(float(decision.confidence or 0) * 10) * 10 + 10}%"
                ),
            )
        )
        created += 1
    session.flush()
    return created


def run(
    *,
    years: int = 4,
    with_backtests: bool = True,
    with_validation: bool = False,
    cycles: int = 1,
    password: str | None = None,
) -> dict[str, Any]:
    configure_logging(json_output=False)
    settings = get_settings()
    summary: dict[str, Any] = {
        "mode": settings.mode.value,
        "price_provider": settings.price_provider,
        "using_synthetic_data": settings.price_provider == "fixture",
    }

    create_all()
    with session_scope() as session:
        summary["users_created"] = seed_users(session, password)
        summary["strategies_created"] = seed_strategies(session)
        risk = seed_risk_config(session)
        summary["risk_config_version"] = risk.version if risk else None
        get_system_state(session)

    with session_scope() as session:
        data = seed_market_data(session, years=years)
        summary["market_data"] = {k: v for k, v in data.items() if k not in ("start", "end")}
        start, end = data["start"], data["end"]

    if with_backtests:
        with session_scope() as session:
            summary["backtest_run_ids"] = seed_backtests(session, start=start, end=end, with_validation=with_validation)

    if cycles:
        with session_scope() as session:
            summary["paper_cycles"] = seed_paper_cycle(session, cycles=cycles)
        with session_scope() as session:
            summary["post_trade_reviews"] = seed_post_trade_reviews(session)

    log.info("seed_complete", **{k: v for k, v in summary.items() if k != "paper_cycles"})
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the AegisQuant demonstration environment")
    parser.add_argument("--years", type=int, default=4, help="years of simulated history")
    parser.add_argument("--no-backtests", action="store_true", help="skip the seeded backtests")
    parser.add_argument(
        "--with-validation",
        action="store_true",
        help="also run walk-forward and sensitivity analysis (slow)",
    )
    parser.add_argument("--cycles", type=int, default=1, help="autonomous paper cycles to run")
    parser.add_argument("--password", help="password for the seeded demo users")
    args = parser.parse_args()

    summary = run(
        years=args.years,
        with_backtests=not args.no_backtests,
        with_validation=args.with_validation,
        cycles=args.cycles,
        password=args.password,
    )
    print("\n=== Seed summary ===")
    for key, value in summary.items():
        if key == "paper_cycles":
            for i, cycle in enumerate(value or []):
                print(f"  paper cycle {i}: {cycle.get('summary') or cycle.get('halted_reason')}")
            continue
        print(f"  {key}: {value}")
    if summary.get("using_synthetic_data"):
        print(
            "\n  NOTE: this environment is populated with SIMULATED market data from the built-in\n"
            "  market simulator. It is not real market history and the performance figures are\n"
            "  not real results. Point AEGIS_PRICE_PROVIDER at yfinance or alpaca for real data."
        )


if __name__ == "__main__":
    main()
