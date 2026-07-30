"""Broker resolution.

The mock broker is the default so nothing can trade real money by accident. A
real broker is only constructed when the configuration names it explicitly, and
LIVE mode additionally refuses the mock (see :mod:`aegisquant.config`).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from aegisquant.config import Mode, get_settings
from aegisquant.execution.broker.base import Broker, BrokerNotConfigured
from aegisquant.logging_setup import get_logger

log = get_logger(__name__)

_CACHE: dict[str, Broker] = {}


def build_broker(kind: str | None = None) -> Broker:
    settings = get_settings()
    kind = kind or settings.broker

    if kind == "mock":
        if settings.mode is Mode.LIVE:
            raise BrokerNotConfigured("mock", "the mock broker cannot be used in LIVE mode")
        from aegisquant.execution.broker.mock import MockBroker

        broker: Broker = MockBroker(starting_cash=Decimal("100000"))
        # The simulator holds state in memory, so a fresh process would otherwise
        # report an empty account and reconciliation would "helpfully" zero out
        # every stored position. Rehydrating from the database keeps the paper
        # account coherent across restarts, which is what a real broker does.
        broker.autorefresh = True  # type: ignore[attr-defined]
        _rehydrate_mock(broker)
        return broker
    if kind == "alpaca":
        from aegisquant.execution.broker.alpaca import AlpacaBroker

        alpaca = AlpacaBroker()
        if settings.mode is Mode.LIVE and alpaca.is_paper:
            raise BrokerNotConfigured(
                "alpaca",
                "LIVE mode resolved to the paper endpoint — refusing to start in an inconsistent state",
            )
        if settings.mode is Mode.PAPER and not alpaca.is_paper:
            # Never silently fall through to a live account.
            raise BrokerNotConfigured(
                "alpaca",
                "PAPER mode resolved to the LIVE endpoint — refusing to trade real money from paper mode",
            )
        return broker
    raise BrokerNotConfigured(kind, f"unknown broker '{kind}'")


def _rehydrate_mock(broker: Any) -> None:
    """Load prices, positions and cash for the mock broker from the database.

    Best-effort: a failure here leaves an empty simulated account rather than
    breaking startup, and it is logged.
    """
    try:
        from sqlalchemy import select

        from aegisquant.db.models import Instrument, PortfolioSnapshot, Position
        from aegisquant.db.repo import current_mode, latest_bar
        from aegisquant.db.session import session_scope
        from aegisquant.execution.broker.base import BrokerPosition

        with session_scope() as session:
            mode = current_mode()
            broker.positions.clear()
            for symbol in session.scalars(select(Instrument.symbol)):
                bar = latest_bar(session, symbol)
                if bar is not None and bar.close > 0:
                    broker.market.set_price(symbol, bar.close)

            restored = 0
            invested = Decimal("0")
            for pos in session.scalars(select(Position).where(Position.mode == mode, Position.quantity > 0)):
                price = broker.market.price(pos.symbol) or pos.avg_entry_price
                broker.positions[pos.symbol] = BrokerPosition(
                    symbol=pos.symbol,
                    quantity=pos.quantity,
                    avg_entry_price=pos.avg_entry_price,
                    market_value=pos.quantity * price,
                    current_price=price,
                    cost_basis=pos.cost_basis,
                )
                invested += pos.cost_basis
                restored += 1

            snapshot = session.scalar(
                select(PortfolioSnapshot)
                .where(PortfolioSnapshot.mode == mode)
                .order_by(PortfolioSnapshot.at.desc())
                .limit(1)
            )
            if snapshot is not None:
                broker.cash = snapshot.cash
            elif invested:
                broker.cash = max(Decimal("0"), broker.starting_cash - invested)

            if restored:
                log.info("mock_broker_rehydrated", positions=restored, cash=str(broker.cash))
    except Exception as exc:  # pragma: no cover - startup convenience only
        log.warning("mock_broker_rehydrate_failed", error=str(exc))


def get_broker(kind: str | None = None) -> Broker:
    """Cached broker instance for the process."""
    settings = get_settings()
    key = kind or settings.broker
    broker = _CACHE.get(key)
    if broker is None:
        broker = build_broker(key)
        _CACHE[key] = broker
        log.info("broker_ready", broker=broker.name, is_paper=broker.is_paper, mode=settings.mode.value)
    elif getattr(broker, "autorefresh", False):
        # A cached simulator would otherwise drift from the database once another
        # process (the scheduler, a worker) traded — which showed up as an account
        # reporting full cash while holding positions. Re-read on each handout.
        _rehydrate_mock(broker)
    return broker


def reset_brokers() -> None:
    for broker in _CACHE.values():
        try:
            broker.close()
        except Exception:  # pragma: no cover
            pass
    _CACHE.clear()


def set_broker(broker: Broker, kind: str | None = None) -> None:
    """Inject a broker (tests, and the demo seeding script)."""
    _CACHE[kind or broker.name] = broker
