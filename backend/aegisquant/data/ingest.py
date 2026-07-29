"""Validated market-data ingestion.

Flow for every symbol:

1. fetch corporate actions (needed to interpret price jumps),
2. fetch bars through the retry/rate-limit policy,
3. validate (:mod:`aegisquant.data.quality`),
4. upsert the accepted bars with full provenance,
5. persist any issues, and flag the affected bars' quality.

Nothing here invents data. If a fetch fails the symbol is skipped and the
failure is recorded; the autonomous loop then refuses to trade names whose data
it could not verify.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from aegisquant.config import get_settings
from aegisquant.data import quality as Q
from aegisquant.data.net import call_with_policy, flush_fetch_logs
from aegisquant.data.providers.base import (
    BarRecord,
    CorporateActionRecord,
    FundamentalRecord,
    NewsRecord,
    ProviderError,
)
from aegisquant.data.registry import (
    calendar_provider,
    corporate_action_provider,
    fundamentals_provider,
    instrument_provider,
    macro_provider,
    news_provider,
    price_provider,
    quote_provider,
    secondary_price_provider,
)
from aegisquant.db.enums import Adjustment, DataQuality, IssueKind, IssueSeverity
from aegisquant.db.models import (
    Bar,
    CorporateAction,
    EconomicIndicator,
    Fundamental,
    Instrument,
    MarketCalendarDay,
    NewsItem,
    Quote,
)
from aegisquant.db.repo import get_or_create_instrument
from aegisquant.logging_setup import get_logger
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)


@dataclass(slots=True)
class IngestReport:
    symbols_requested: int = 0
    symbols_ok: int = 0
    symbols_failed: int = 0
    bars_written: int = 0
    bars_rejected: int = 0
    actions_written: int = 0
    fundamentals_written: int = 0
    news_written: int = 0
    issues_written: int = 0
    failures: dict[str, str] = field(default_factory=dict)
    used_synthetic: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "symbols_requested": self.symbols_requested,
            "symbols_ok": self.symbols_ok,
            "symbols_failed": self.symbols_failed,
            "bars_written": self.bars_written,
            "bars_rejected": self.bars_rejected,
            "actions_written": self.actions_written,
            "fundamentals_written": self.fundamentals_written,
            "news_written": self.news_written,
            "issues_written": self.issues_written,
            "failures": self.failures,
            "used_synthetic_data": self.used_synthetic,
        }


# ---------------------------------------------------------------------------
def sync_calendar(session: Session, start: date, end: date) -> int:
    prov = calendar_provider()
    days, outcome = call_with_policy(
        prov.name, "calendar", lambda: prov.get_calendar(start, end), log_fetch=True
    )
    if days is None:
        log.error("calendar_sync_failed", error=outcome.error)
        return 0
    existing = {
        d.session_date: d
        for d in session.scalars(
            select(MarketCalendarDay).where(
                MarketCalendarDay.session_date >= start, MarketCalendarDay.session_date <= end
            )
        )
    }
    written = 0
    for rec in days:
        row = existing.get(rec.session_date)
        if row is None:
            session.add(
                MarketCalendarDay(
                    session_date=rec.session_date,
                    is_open=rec.is_open,
                    open_utc=rec.open_utc,
                    close_utc=rec.close_utc,
                    early_close=rec.early_close,
                    holiday_name=rec.holiday_name,
                    provider=rec.provider,
                )
            )
            written += 1
        else:
            row.is_open = rec.is_open
            row.open_utc = rec.open_utc
            row.close_utc = rec.close_utc
            row.early_close = rec.early_close
            row.holiday_name = rec.holiday_name
            row.provider = rec.provider
    session.flush()
    return written


def sync_instruments(session: Session, symbols: list[str] | None = None) -> int:
    try:
        prov = instrument_provider()
    except ProviderError as exc:
        log.warning("instrument_provider_unavailable", error=exc.message)
        return 0
    records, outcome = call_with_policy(
        prov.name, "instruments", lambda: prov.list_instruments(symbols)
    )
    if records is None:
        log.warning("instrument_sync_failed", error=outcome.error)
        return 0
    count = 0
    for rec in records:
        inst = get_or_create_instrument(
            session,
            rec.symbol,
            asset_class=rec.asset_class,
            sector=rec.sector,
            name=rec.name,
            provider=rec.provenance.provider,
        )
        inst.exchange = rec.exchange or inst.exchange
        inst.industry = rec.industry or inst.industry
        inst.is_tradable = rec.tradable
        inst.fractionable = rec.fractionable
        inst.shortable = rec.shortable
        inst.easy_to_borrow = rec.easy_to_borrow
        inst.is_leveraged_etf = rec.is_leveraged_etf
        inst.delisted_on = rec.delisted_on or inst.delisted_on
        inst.renamed_to = rec.renamed_to or inst.renamed_to
        inst.is_active = rec.delisted_on is None
        inst.data_quality = rec.provenance.data_quality
        count += 1
    session.flush()
    return count


# ---------------------------------------------------------------------------
def _upsert_bars(session: Session, instrument: Instrument, bars: list[BarRecord], issues: list[Q.Issue]) -> int:
    """Insert-or-update bars. Uses a real upsert on PostgreSQL, per-row otherwise."""
    if not bars:
        return 0
    quality_by_date = {}
    for issue in issues:
        if issue.session_date and issue.severity in (IssueSeverity.ERROR, IssueSeverity.CRITICAL):
            quality_by_date[issue.session_date] = DataQuality.SUSPECT

    rows = []
    for b in bars:
        p = b.provenance
        rows.append(
            {
                "instrument_id": instrument.id,
                "symbol": b.symbol,
                "timeframe": b.timeframe,
                "ts": b.ts,
                "open": b.open,
                "high": b.high,
                "low": b.low,
                "close": b.close,
                "volume": b.volume,
                "trade_count": b.trade_count,
                "vwap": b.vwap,
                "provider": p.provider,
                "retrieved_at": p.retrieved_at,
                "adjustment": p.adjustment,
                "data_quality": quality_by_date.get(b.ts.date(), p.data_quality),
                "is_synthetic": p.is_synthetic,
            }
        )

    dialect = session.bind.dialect.name if session.bind is not None else "sqlite"
    if dialect == "postgresql":
        stmt = pg_insert(Bar).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["instrument_id", "timeframe", "ts"],
            set_={
                "open": stmt.excluded.open,
                "high": stmt.excluded.high,
                "low": stmt.excluded.low,
                "close": stmt.excluded.close,
                "volume": stmt.excluded.volume,
                "vwap": stmt.excluded.vwap,
                "trade_count": stmt.excluded.trade_count,
                "provider": stmt.excluded.provider,
                "retrieved_at": stmt.excluded.retrieved_at,
                "adjustment": stmt.excluded.adjustment,
                "data_quality": stmt.excluded.data_quality,
                "is_synthetic": stmt.excluded.is_synthetic,
            },
        )
        session.execute(stmt)
        return len(rows)

    # Portable path (SQLite / tests).
    existing = {
        (b.timeframe, b.ts): b
        for b in session.scalars(
            select(Bar).where(
                Bar.instrument_id == instrument.id,
                Bar.ts >= min(r["ts"] for r in rows),
                Bar.ts <= max(r["ts"] for r in rows),
            )
        )
    }
    written = 0
    for r in rows:
        row = existing.get((r["timeframe"], r["ts"]))
        if row is None:
            session.add(Bar(**r))
            written += 1
        else:
            for k, v in r.items():
                setattr(row, k, v)
    session.flush()
    return written


def _upsert_actions(
    session: Session, instrument: Instrument, actions: list[CorporateActionRecord]
) -> int:
    written = 0
    for a in actions:
        existing = session.scalar(
            select(CorporateAction).where(
                CorporateAction.symbol == a.symbol,
                CorporateAction.action_type == a.action_type,
                CorporateAction.ex_date == a.ex_date,
            )
        )
        if existing is not None:
            continue
        session.add(
            CorporateAction(
                instrument_id=instrument.id,
                symbol=a.symbol,
                action_type=a.action_type,
                ex_date=a.ex_date,
                ratio=a.ratio,
                cash_amount=a.cash_amount,
                new_symbol=a.new_symbol,
                provider=a.provenance.provider,
                retrieved_at=a.provenance.retrieved_at,
                observed_at=a.provenance.observed_at,
                data_quality=a.provenance.data_quality,
                is_synthetic=a.provenance.is_synthetic,
            )
        )
        written += 1
        if a.action_type == "delist":
            instrument.delisted_on = a.ex_date
            instrument.is_active = False
            instrument.is_tradable = False
        elif a.action_type == "symbol_change":
            instrument.renamed_to = a.new_symbol
    session.flush()
    return written


def _upsert_fundamentals(
    session: Session, instrument: Instrument, records: list[FundamentalRecord]
) -> int:
    written = 0
    columns = {c.name for c in Fundamental.__table__.columns}
    for rec in records:
        existing = session.scalar(
            select(Fundamental).where(
                Fundamental.symbol == rec.symbol,
                Fundamental.period_end == rec.period_end,
                Fundamental.provider == rec.provenance.provider,
            )
        )
        target = existing or Fundamental(
            instrument_id=instrument.id,
            symbol=rec.symbol,
            period_end=rec.period_end,
            provider=rec.provenance.provider,
        )
        target.fiscal_period = rec.fiscal_period
        target.observed_at = rec.provenance.observed_at
        target.retrieved_at = rec.provenance.retrieved_at
        target.data_quality = rec.provenance.data_quality
        target.is_synthetic = rec.provenance.is_synthetic
        target.raw = rec.raw
        for key, value in rec.values.items():
            if key in columns and value is not None:
                setattr(target, key, value)
        if existing is None:
            session.add(target)
            written += 1
    session.flush()
    return written


def _upsert_news(session: Session, instrument: Instrument | None, records: list[NewsRecord]) -> int:
    written = 0
    for rec in records:
        existing = session.scalar(
            select(NewsItem).where(
                NewsItem.provider == rec.provenance.provider,
                NewsItem.external_id == rec.external_id,
            )
        )
        if existing is not None:
            continue
        session.add(
            NewsItem(
                instrument_id=instrument.id if instrument else None,
                symbol=rec.symbol,
                external_id=rec.external_id,
                headline=rec.headline,
                summary=rec.summary,
                source=rec.source,
                url=rec.url,
                published_at=rec.published_at,
                retrieved_at=rec.provenance.retrieved_at,
                provider=rec.provenance.provider,
                sentiment=rec.sentiment,
                uncertainty=rec.uncertainty,
                source_credibility=rec.source_credibility,
                novelty=rec.novelty,
                event_tags={"tags": rec.event_tags} if rec.event_tags else None,
                data_quality=rec.provenance.data_quality,
                is_synthetic=rec.provenance.is_synthetic,
            )
        )
        written += 1
    session.flush()
    return written


# ---------------------------------------------------------------------------
def ingest_symbol(
    session: Session,
    symbol: str,
    start: date,
    end: date,
    *,
    timeframe: str = "1Day",
    with_fundamentals: bool = True,
    with_news: bool = True,
    cross_check: bool = False,
    report: IngestReport | None = None,
) -> IngestReport:
    """Ingest one symbol's price history plus optional fundamentals and news."""
    report = report or IngestReport()
    report.symbols_requested += 1
    symbol = symbol.upper()
    prices = price_provider()
    report.used_synthetic = report.used_synthetic or prices.is_synthetic
    inst = get_or_create_instrument(session, symbol, provider=prices.name)

    # 1. corporate actions first — needed to interpret jumps
    actions: list[CorporateActionRecord] = []
    try:
        ca_prov = corporate_action_provider()
        fetched, _ = call_with_policy(
            ca_prov.name,
            "corporate_actions",
            lambda: ca_prov.get_corporate_actions(symbol, start, end),
            symbol=symbol,
        )
        actions = fetched or []
    except ProviderError as exc:
        log.info("corporate_actions_unavailable", symbol=symbol, error=exc.message)
    if actions:
        report.actions_written += _upsert_actions(session, inst, actions)

    # 2. bars
    bars, outcome = call_with_policy(
        prices.name,
        "bars",
        lambda: prices.get_bars(symbol, start, end, timeframe, Adjustment.SPLIT_DIVIDEND),
        symbol=symbol,
    )
    if bars is None:
        report.symbols_failed += 1
        report.failures[symbol] = outcome.error or "unknown provider failure"
        report.issues_written += Q.persist_issues(
            session,
            [
                Q.Issue(
                    IssueKind.PROVIDER_ERROR,
                    IssueSeverity.ERROR,
                    f"price fetch failed for {symbol}: {outcome.error}",
                    symbol,
                    prices.name,
                    end,
                )
            ],
        )
        return report

    # 3. validate
    sessions = [
        d.session_date
        for d in session.scalars(
            select(MarketCalendarDay).where(
                MarketCalendarDay.session_date >= start,
                MarketCalendarDay.session_date <= end,
                MarketCalendarDay.is_open.is_(True),
            )
        )
    ]
    result = Q.validate_bars(
        symbol,
        bars,
        expected_sessions=sessions or None,
        corporate_actions=actions,
        provider=prices.name,
    )

    if cross_check:
        secondary = secondary_price_provider()
        if secondary is not None:
            other, _ = call_with_policy(
                secondary.name,
                "bars_crosscheck",
                lambda: secondary.get_bars(symbol, start, end, timeframe),
                symbol=symbol,
            )
            if other:
                result.issues.extend(Q.compare_providers(symbol, result.accepted, other))

    silent = Q.detect_silent_delisting(session, symbol, sessions)
    if silent:
        result.issues.append(silent)

    # 4. persist
    report.bars_written += _upsert_bars(session, inst, result.accepted, result.issues)
    report.bars_rejected += len(result.rejected)
    report.issues_written += Q.persist_issues(session, result.issues)
    inst.data_quality = result.worst_quality() if not prices.is_synthetic else DataQuality.SYNTHETIC

    # 5. fundamentals / news (absence is not a failure)
    if with_fundamentals:
        try:
            fp = fundamentals_provider()
            recs, _ = call_with_policy(
                fp.name, "fundamentals", lambda: fp.get_fundamentals(symbol), symbol=symbol
            )
            if recs:
                report.fundamentals_written += _upsert_fundamentals(session, inst, recs)
        except ProviderError as exc:
            log.info("fundamentals_unavailable", symbol=symbol, error=exc.message)

    if with_news:
        try:
            np_ = news_provider()
            recs, _ = call_with_policy(
                np_.name,
                "news",
                lambda: np_.get_news(symbol, start=max(start, end - timedelta(days=120))),
                symbol=symbol,
            )
            if recs:
                report.news_written += _upsert_news(session, inst, recs)
        except ProviderError as exc:
            log.info("news_unavailable", symbol=symbol, error=exc.message)

    report.symbols_ok += 1
    return report


def ingest_universe(
    session: Session,
    symbols: list[str],
    start: date,
    end: date,
    *,
    timeframe: str = "1Day",
    with_fundamentals: bool = True,
    with_news: bool = True,
    cross_check: bool = False,
) -> IngestReport:
    report = IngestReport()
    sync_calendar(session, start - timedelta(days=10), end + timedelta(days=10))
    for sym in symbols:
        try:
            ingest_symbol(
                session,
                sym,
                start,
                end,
                timeframe=timeframe,
                with_fundamentals=with_fundamentals,
                with_news=with_news,
                cross_check=cross_check,
                report=report,
            )
        except Exception as exc:  # one bad symbol must not abort the run
            log.exception("ingest_symbol_failed", symbol=sym)
            report.symbols_failed += 1
            report.failures[sym] = f"{type(exc).__name__}: {exc}"
    flush_fetch_logs(session)
    log.info("ingest_complete", **report.as_dict())
    return report


def refresh_quote(session: Session, symbol: str) -> Quote | None:
    """Fetch and store the latest quote, flagging staleness."""
    try:
        prov = quote_provider()
    except ProviderError as exc:
        log.info("quote_provider_unavailable", error=exc.message)
        return None
    rec, outcome = call_with_policy(
        prov.name, "quote", lambda: prov.get_quote(symbol), symbol=symbol
    )
    if rec is None:
        Q.persist_issues(
            session,
            [
                Q.Issue(
                    IssueKind.PROVIDER_ERROR,
                    IssueSeverity.WARNING,
                    f"quote fetch failed for {symbol}: {outcome.error}",
                    symbol,
                    prov.name,
                )
            ],
        )
        return None
    settings = get_settings()
    issue = Q.check_quote_freshness(rec, settings.risk.max_data_age_seconds)
    if issue:
        Q.persist_issues(session, [issue])

    inst = get_or_create_instrument(session, symbol, provider=prov.name)
    row = session.scalar(
        select(Quote).where(Quote.symbol == symbol.upper(), Quote.provider == prov.name)
    )
    if row is None:
        row = Quote(instrument_id=inst.id, symbol=symbol.upper(), provider=prov.name)
        session.add(row)
    row.bid, row.ask = rec.bid, rec.ask
    row.bid_size, row.ask_size = rec.bid_size, rec.ask_size
    row.last = rec.last
    row.observed_at = rec.observed_at
    row.retrieved_at = rec.provenance.retrieved_at
    row.data_quality = DataQuality.STALE if issue else rec.provenance.data_quality
    row.is_synthetic = rec.provenance.is_synthetic
    session.flush()
    flush_fetch_logs(session)
    return row


def ingest_macro(session: Session, start: date, end: date, series: list[str] | None = None) -> int:
    prov = macro_provider()
    series = series or ["DGS10", "DGS2", "CPIAUCSL", "BAMLH0A0HYM2", "VIXCLS", "UNRATE"]
    written = 0
    for sid in series:
        recs, outcome = call_with_policy(
            prov.name, "macro", lambda sid=sid: prov.get_series(sid, start, end), symbol=sid
        )
        if not recs:
            if outcome.error:
                log.warning("macro_fetch_failed", series=sid, error=outcome.error)
            continue
        existing = {
            (r.series_id, r.observation_date)
            for r in session.scalars(
                select(EconomicIndicator).where(
                    EconomicIndicator.series_id == sid,
                    EconomicIndicator.observation_date >= start,
                    EconomicIndicator.observation_date <= end,
                )
            )
        }
        for rec in recs:
            if (rec.series_id, rec.observation_date) in existing:
                continue
            session.add(
                EconomicIndicator(
                    series_id=rec.series_id,
                    label=rec.label,
                    observation_date=rec.observation_date,
                    value=rec.value,
                    unit=rec.unit,
                    observed_at=rec.provenance.observed_at,
                    retrieved_at=rec.provenance.retrieved_at,
                    provider=rec.provenance.provider,
                    data_quality=rec.provenance.data_quality,
                    is_synthetic=rec.provenance.is_synthetic,
                )
            )
            written += 1
        session.flush()
    flush_fetch_logs(session)
    return written
