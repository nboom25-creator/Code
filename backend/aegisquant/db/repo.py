"""Small query helpers shared across services.

Kept deliberately thin — services own their own business logic; this module is
only for lookups that would otherwise be duplicated verbatim.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aegisquant.config import Mode as CfgMode
from aegisquant.config import get_settings
from aegisquant.db import enums as E
from aegisquant.db.models import (
    Bar,
    Instrument,
    MarketCalendarDay,
    Order,
    PortfolioSnapshot,
    Position,
    RiskConfig,
    SystemState,
)
from aegisquant.utils.timeutil import utcnow


def current_mode() -> E.Mode:
    m = get_settings().mode
    return {
        CfgMode.BACKTEST: E.Mode.BACKTEST,
        CfgMode.PAPER: E.Mode.PAPER,
        CfgMode.LIVE: E.Mode.LIVE,
    }[m]


def get_or_create_instrument(
    session: Session,
    symbol: str,
    *,
    asset_class: E.AssetClass = E.AssetClass.EQUITY,
    sector: str | None = None,
    name: str | None = None,
    provider: str | None = None,
    **extra: object,
) -> Instrument:
    symbol = symbol.upper().strip()
    inst = session.scalar(select(Instrument).where(Instrument.symbol == symbol))
    if inst is None:
        inst = Instrument(
            symbol=symbol,
            name=name or symbol,
            asset_class=asset_class,
            sector=sector,
            provider=provider,
            first_seen_on=utcnow().date(),
            **extra,  # type: ignore[arg-type]
        )
        session.add(inst)
        session.flush()
    else:
        if sector and not inst.sector:
            inst.sector = sector
        if name and (not inst.name or inst.name == inst.symbol):
            inst.name = name
    return inst


def get_system_state(session: Session) -> SystemState:
    state = session.get(SystemState, 1)
    if state is None:
        state = SystemState(id=1)
        session.add(state)
        session.flush()
    return state


def get_active_risk_config(session: Session) -> RiskConfig | None:
    return session.scalar(
        select(RiskConfig).where(RiskConfig.is_active.is_(True)).order_by(RiskConfig.version.desc())
    )


def open_positions(session: Session, mode: E.Mode | None = None) -> list[Position]:
    mode = mode or current_mode()
    return list(
        session.scalars(
            select(Position).where(Position.mode == mode, Position.quantity != 0).order_by(Position.symbol)
        )
    )


def open_orders(session: Session, mode: E.Mode | None = None) -> list[Order]:
    mode = mode or current_mode()
    open_statuses = [s for s in E.OrderStatus if s.is_open]
    return list(
        session.scalars(
            select(Order)
            .where(Order.mode == mode, Order.status.in_(open_statuses))
            .order_by(Order.submitted_at.desc().nullslast())
        )
    )


def latest_snapshot(session: Session, mode: E.Mode | None = None) -> PortfolioSnapshot | None:
    mode = mode or current_mode()
    return session.scalar(
        select(PortfolioSnapshot)
        .where(PortfolioSnapshot.mode == mode)
        .order_by(PortfolioSnapshot.at.desc())
        .limit(1)
    )


def latest_bar(session: Session, symbol: str, timeframe: str = "1Day") -> Bar | None:
    return session.scalar(
        select(Bar)
        .where(Bar.symbol == symbol.upper(), Bar.timeframe == timeframe)
        .order_by(Bar.ts.desc())
        .limit(1)
    )


def bars_asof(
    session: Session,
    symbol: str,
    as_of: datetime,
    limit: int = 400,
    timeframe: str = "1Day",
) -> list[Bar]:
    """Bars strictly at or before ``as_of`` — the point-in-time access path."""
    rows = list(
        session.scalars(
            select(Bar)
            .where(Bar.symbol == symbol.upper(), Bar.timeframe == timeframe, Bar.ts <= as_of)
            .order_by(Bar.ts.desc())
            .limit(limit)
        )
    )
    return list(reversed(rows))


def is_market_open_on(session: Session, d: date) -> bool:
    row = session.scalar(select(MarketCalendarDay).where(MarketCalendarDay.session_date == d))
    if row is not None:
        return row.is_open
    return d.weekday() < 5  # conservative fallback


def next_session(session: Session, after: date) -> date | None:
    return session.scalar(
        select(MarketCalendarDay.session_date)
        .where(MarketCalendarDay.session_date > after, MarketCalendarDay.is_open.is_(True))
        .order_by(MarketCalendarDay.session_date)
        .limit(1)
    )


def trading_sessions(session: Session, start: date, end: date) -> list[date]:
    rows = list(
        session.scalars(
            select(MarketCalendarDay.session_date)
            .where(
                MarketCalendarDay.session_date >= start,
                MarketCalendarDay.session_date <= end,
                MarketCalendarDay.is_open.is_(True),
            )
            .order_by(MarketCalendarDay.session_date)
        )
    )
    return list(rows)


def realized_pnl_since(session: Session, since: datetime, mode: E.Mode | None = None) -> Decimal:
    mode = mode or current_mode()
    total = session.scalar(
        select(func.coalesce(func.sum(Position.realized_pnl), 0)).where(
            Position.mode == mode, Position.updated_at >= since
        )
    )
    return Decimal(str(total or 0))


def recent_orders(session: Session, hours: int = 24, mode: E.Mode | None = None) -> list[Order]:
    mode = mode or current_mode()
    cutoff = utcnow() - timedelta(hours=hours)
    return list(
        session.scalars(
            select(Order)
            .where(Order.mode == mode, Order.created_at >= cutoff)
            .order_by(Order.created_at.desc())
        )
    )
