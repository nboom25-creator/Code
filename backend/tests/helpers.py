"""Deterministic builders for test data.

These construct provider records and risk snapshots by hand so a test can state
exactly the condition it is exercising, without depending on whatever the market
simulator happened to produce.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from aegisquant.data.providers.base import BarRecord, CorporateActionRecord, Provenance, QuoteRecord
from aegisquant.db.enums import Adjustment, DataQuality, OrderType, Regime, RiskState, Side
from aegisquant.risk.engine import AccountSnapshot, OrderIntent, PositionSnapshot
from aegisquant.utils.money import D
from aegisquant.utils.timeutil import utcnow

PROVIDER = "unit-test"


def provenance(
    symbol: str | None = None,
    *,
    observed_at: datetime | None = None,
    provider: str = PROVIDER,
    adjustment: Adjustment = Adjustment.RAW,
    quality: DataQuality = DataQuality.OK,
) -> Provenance:
    now = utcnow()
    return Provenance(
        provider=provider,
        retrieved_at=now,
        observed_at=observed_at or now,
        symbol=symbol,
        adjustment=adjustment,
        data_quality=quality,
        is_synthetic=False,
    )


def bar_at(
    symbol: str,
    day: date,
    close: Any,
    *,
    open_: Any | None = None,
    high: Any | None = None,
    low: Any | None = None,
    volume: Any = 1_000_000,
    provider: str = PROVIDER,
) -> BarRecord:
    """One daily bar, timestamped at 21:00 UTC (a nominal US close)."""
    c = D(close)
    o = D(open_) if open_ is not None else c
    hi = D(high) if high is not None else max(o, c)
    lo = D(low) if low is not None else min(o, c)
    ts = datetime.combine(day, datetime.min.time()).replace(hour=21, tzinfo=utcnow().tzinfo)
    return BarRecord(
        symbol=symbol,
        ts=ts,
        open=o,
        high=hi,
        low=lo,
        close=c,
        volume=D(volume),
        provenance=provenance(symbol, observed_at=ts, provider=provider),
    )


def sessions(start: date, count: int) -> list[date]:
    """``count`` consecutive weekdays starting at or after ``start``."""
    out: list[date] = []
    day = start
    while len(out) < count:
        if day.weekday() < 5:
            out.append(day)
        day += timedelta(days=1)
    return out


def bar_series(symbol: str, days: list[date], closes: list[Any], **kwargs: Any) -> list[BarRecord]:
    assert len(days) == len(closes)
    return [bar_at(symbol, d, c, **kwargs) for d, c in zip(days, closes, strict=True)]


def quote(
    symbol: str,
    *,
    bid: Any = 99,
    ask: Any = 101,
    age_seconds: float = 0.0,
) -> QuoteRecord:
    observed = utcnow() - timedelta(seconds=age_seconds)
    return QuoteRecord(
        symbol=symbol,
        observed_at=observed,
        provenance=provenance(symbol, observed_at=observed),
        bid=D(bid),
        ask=D(ask),
        last=(D(bid) + D(ask)) / 2,
    )


def split(symbol: str, ex_date: date, ratio: Any) -> CorporateActionRecord:
    return CorporateActionRecord(
        symbol=symbol,
        action_type="split",
        ex_date=ex_date,
        provenance=provenance(symbol),
        ratio=D(ratio),
    )


def dividend(symbol: str, ex_date: date, cash: Any) -> CorporateActionRecord:
    return CorporateActionRecord(
        symbol=symbol,
        action_type="dividend",
        ex_date=ex_date,
        provenance=provenance(symbol),
        cash_amount=D(cash),
    )


def store_bars(session: Any, bars: list[BarRecord]) -> int:
    """Persist hand-built bars through the real ingestion writer."""
    from aegisquant.data.ingest import _upsert_bars
    from aegisquant.db.repo import get_or_create_instrument

    written = 0
    by_symbol: dict[str, list[BarRecord]] = {}
    for bar in bars:
        by_symbol.setdefault(bar.symbol, []).append(bar)
    for symbol, group in by_symbol.items():
        instrument = get_or_create_instrument(session, symbol, provider=PROVIDER)
        written += _upsert_bars(session, instrument, group, [])
    session.flush()
    return written


# ---------------------------------------------------------------------------
# risk-engine inputs
# ---------------------------------------------------------------------------
def position(
    symbol: str,
    *,
    quantity: Any = 100,
    price: Any = 100,
    entry: Any | None = None,
    sector: str = "Technology",
    strategy_key: str | None = "cross_sectional_momentum",
) -> PositionSnapshot:
    qty = D(quantity)
    last = D(price)
    avg = D(entry) if entry is not None else last
    return PositionSnapshot(
        symbol=symbol,
        quantity=qty,
        market_value=qty * last,
        avg_entry_price=avg,
        last_price=last,
        sector=sector,
        strategy_key=strategy_key,
        unrealized_pnl=(last - avg) * qty,
    )


def account(
    *,
    equity: Any = 100_000,
    cash: Any | None = None,
    positions: list[PositionSnapshot] | None = None,
    **overrides: Any,
) -> AccountSnapshot:
    eq = D(equity)
    pos = {p.symbol: p for p in (positions or [])}
    invested = sum((abs(p.market_value) for p in pos.values()), Decimal(0))
    free = D(cash) if cash is not None else eq - invested
    defaults: dict[str, Any] = {
        "as_of": utcnow(),
        "equity": eq,
        "cash": free,
        "buying_power": free,
        "positions": pos,
        "day_start_equity": eq,
        "week_start_equity": eq,
        "high_water_mark": eq,
        "market_open": True,
        "session_date": utcnow().date(),
        "regime": Regime.RISK_ON,
        "risk_state": RiskState.NORMAL,
        "broker_connected": True,
    }
    defaults.update(overrides)
    return AccountSnapshot(**defaults)


def intent(
    symbol: str = "NVDA",
    *,
    side: Side = Side.BUY,
    quantity: Any = 100,
    price: Any = 100,
    **overrides: Any,
) -> OrderIntent:
    defaults: dict[str, Any] = {
        "symbol": symbol,
        "side": side,
        "quantity": D(quantity),
        "order_type": OrderType.LIMIT,
        "reference_price": D(price),
        "limit_price": D(price) * Decimal("1.002"),
        "strategy_key": "cross_sectional_momentum",
        "sector": "Technology",
        "adv_usd": D(500_000_000),
        "adv_shares": D(5_000_000),
        "spread_bps": D(4),
        "estimated_impact_bps": D(3),
        "estimated_total_cost_bps": D(9),
        "asset_vol": D("0.25"),
        "data_age_seconds": 60.0,
        "data_quality": "ok",
        "tradable": True,
        "confidence": D("0.7"),
    }
    defaults.update(overrides)
    return OrderIntent(**defaults)
