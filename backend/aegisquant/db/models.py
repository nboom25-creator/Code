"""SQLAlchemy ORM models — the complete AegisQuant schema.

Design rules encoded here:

* Money and quantities are ``Numeric`` (Decimal), never float.
* Every externally retrieved record carries provider, retrieval timestamp,
  observation timestamp, instrument identity, adjustment status and data-quality
  status. This is what makes point-in-time replay honest.
* The decision journal and order-event log are **append-only**; there is no
  update path in the services that write them.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from aegisquant.db import enums as E
from aegisquant.db.base import Base, Money, Qty, Ratio, TimestampMixin, UtcDateTime


def _enum(py_enum: type, name: str) -> Enum:
    """Store enums as their string values (portable across backends)."""
    return Enum(py_enum, name=name, native_enum=False, length=40, values_callable=lambda x: [e.value for e in x])


# ---------------------------------------------------------------------------
# Security / audit
# ---------------------------------------------------------------------------
class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[E.Role] = mapped_column(_enum(E.Role, "role"), default=E.Role.VIEWER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UtcDateTime)


class AuditLog(Base):
    """Append-only record of every state-changing API call."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    actor: Mapped[str] = mapped_column(String(255), default="system")
    actor_role: Mapped[str | None] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(120), index=True)
    target: Mapped[str | None] = mapped_column(String(255))
    method: Mapped[str | None] = mapped_column(String(10))
    path: Mapped[str | None] = mapped_column(String(400))
    status_code: Mapped[int | None] = mapped_column(Integer)
    ip: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------
class Instrument(Base, TimestampMixin):
    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(255))
    asset_class: Mapped[E.AssetClass] = mapped_column(
        _enum(E.AssetClass, "asset_class"), default=E.AssetClass.EQUITY
    )
    exchange: Mapped[str | None] = mapped_column(String(40))
    sector: Mapped[str | None] = mapped_column(String(80), index=True)
    industry: Mapped[str | None] = mapped_column(String(120))
    country: Mapped[str | None] = mapped_column(String(8), default="US")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_tradable: Mapped[bool] = mapped_column(Boolean, default=True)
    fractionable: Mapped[bool] = mapped_column(Boolean, default=False)
    shortable: Mapped[bool] = mapped_column(Boolean, default=False)
    easy_to_borrow: Mapped[bool] = mapped_column(Boolean, default=False)
    is_leveraged_etf: Mapped[bool] = mapped_column(Boolean, default=False)
    delisted_on: Mapped[date | None] = mapped_column(Date)
    renamed_to: Mapped[str | None] = mapped_column(String(24))
    first_seen_on: Mapped[date | None] = mapped_column(Date)
    listed_on: Mapped[date | None] = mapped_column(Date)
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "data_quality"), default=E.DataQuality.OK
    )
    provider: Mapped[str | None] = mapped_column(String(40))
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class MarketCalendarDay(Base):
    __tablename__ = "market_calendar"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    open_utc: Mapped[datetime | None] = mapped_column(UtcDateTime)
    close_utc: Mapped[datetime | None] = mapped_column(UtcDateTime)
    early_close: Mapped[bool] = mapped_column(Boolean, default=False)
    holiday_name: Mapped[str | None] = mapped_column(String(80))
    provider: Mapped[str] = mapped_column(String(40), default="static")


# ---------------------------------------------------------------------------
# Market data
# ---------------------------------------------------------------------------
class Bar(Base):
    """OHLCV bar with full provenance."""

    __tablename__ = "bars"
    __table_args__ = (
        UniqueConstraint("instrument_id", "timeframe", "ts", name="uq_bars_instrument_tf_ts"),
        Index("ix_bars_symbol_ts", "symbol", "ts"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    timeframe: Mapped[str] = mapped_column(String(12), default="1Day")
    ts: Mapped[datetime] = mapped_column(UtcDateTime, index=True)  # observation timestamp
    open: Mapped[Decimal] = mapped_column(Money)
    high: Mapped[Decimal] = mapped_column(Money)
    low: Mapped[Decimal] = mapped_column(Money)
    close: Mapped[Decimal] = mapped_column(Money)
    volume: Mapped[Decimal] = mapped_column(Qty, default=Decimal(0))
    trade_count: Mapped[int | None] = mapped_column(Integer)
    vwap: Mapped[Decimal | None] = mapped_column(Money)
    provider: Mapped[str] = mapped_column(String(40))
    retrieved_at: Mapped[datetime] = mapped_column(UtcDateTime)
    adjustment: Mapped[E.Adjustment] = mapped_column(
        _enum(E.Adjustment, "adjustment"), default=E.Adjustment.RAW
    )
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "bar_quality"), default=E.DataQuality.OK
    )
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class Quote(Base):
    """Latest NBBO-style snapshot per symbol (staleness matters more than history)."""

    __tablename__ = "quotes"
    __table_args__ = (UniqueConstraint("symbol", "provider", name="uq_quotes_symbol_provider"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    bid: Mapped[Decimal | None] = mapped_column(Money)
    ask: Mapped[Decimal | None] = mapped_column(Money)
    bid_size: Mapped[Decimal | None] = mapped_column(Qty)
    ask_size: Mapped[Decimal | None] = mapped_column(Qty)
    last: Mapped[Decimal | None] = mapped_column(Money)
    observed_at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    retrieved_at: Mapped[datetime] = mapped_column(UtcDateTime)
    provider: Mapped[str] = mapped_column(String(40))
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "quote_quality"), default=E.DataQuality.OK
    )
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class CorporateAction(Base):
    __tablename__ = "corporate_actions"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "action_type", "ex_date", name="uq_corp_action_symbol_type_date"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    action_type: Mapped[str] = mapped_column(String(24))  # split | dividend | symbol_change | delist
    ex_date: Mapped[date] = mapped_column(Date, index=True)
    ratio: Mapped[Decimal | None] = mapped_column(Ratio)  # e.g. 4 for a 4:1 split
    cash_amount: Mapped[Decimal | None] = mapped_column(Money)
    new_symbol: Mapped[str | None] = mapped_column(String(24))
    provider: Mapped[str] = mapped_column(String(40))
    retrieved_at: Mapped[datetime] = mapped_column(UtcDateTime)
    observed_at: Mapped[datetime] = mapped_column(UtcDateTime)
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "ca_quality"), default=E.DataQuality.OK
    )
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class Fundamental(Base):
    """Point-in-time fundamental snapshot.

    ``period_end`` is the fiscal period; ``observed_at`` is when the figure was
    *publicly available*. Research code filters on ``observed_at`` only.
    """

    __tablename__ = "fundamentals"
    __table_args__ = (
        UniqueConstraint("symbol", "period_end", "provider", name="uq_fund_symbol_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    period_end: Mapped[date] = mapped_column(Date, index=True)
    fiscal_period: Mapped[str | None] = mapped_column(String(12))
    observed_at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    retrieved_at: Mapped[datetime] = mapped_column(UtcDateTime)
    provider: Mapped[str] = mapped_column(String(40))
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "fund_quality"), default=E.DataQuality.OK
    )
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)

    revenue: Mapped[Decimal | None] = mapped_column(Money)
    revenue_yoy: Mapped[Decimal | None] = mapped_column(Ratio)
    gross_profit: Mapped[Decimal | None] = mapped_column(Money)
    gross_margin: Mapped[Decimal | None] = mapped_column(Ratio)
    operating_income: Mapped[Decimal | None] = mapped_column(Money)
    operating_margin: Mapped[Decimal | None] = mapped_column(Ratio)
    net_income: Mapped[Decimal | None] = mapped_column(Money)
    eps: Mapped[Decimal | None] = mapped_column(Money)
    eps_yoy: Mapped[Decimal | None] = mapped_column(Ratio)
    free_cash_flow: Mapped[Decimal | None] = mapped_column(Money)
    fcf_yoy: Mapped[Decimal | None] = mapped_column(Ratio)
    operating_cash_flow: Mapped[Decimal | None] = mapped_column(Money)
    total_debt: Mapped[Decimal | None] = mapped_column(Money)
    total_equity: Mapped[Decimal | None] = mapped_column(Money)
    cash: Mapped[Decimal | None] = mapped_column(Money)
    debt_to_equity: Mapped[Decimal | None] = mapped_column(Ratio)
    current_ratio: Mapped[Decimal | None] = mapped_column(Ratio)
    roic: Mapped[Decimal | None] = mapped_column(Ratio)
    market_cap: Mapped[Decimal | None] = mapped_column(Money)
    pe_ratio: Mapped[Decimal | None] = mapped_column(Ratio)
    ps_ratio: Mapped[Decimal | None] = mapped_column(Ratio)
    ev_to_sales: Mapped[Decimal | None] = mapped_column(Ratio)
    shares_outstanding: Mapped[Decimal | None] = mapped_column(Qty)
    accruals_ratio: Mapped[Decimal | None] = mapped_column(Ratio)  # earnings quality
    recurring_revenue_pct: Mapped[Decimal | None] = mapped_column(Ratio)
    rnd_expense: Mapped[Decimal | None] = mapped_column(Money)
    short_interest_pct: Mapped[Decimal | None] = mapped_column(Ratio)
    insider_net_buy_usd: Mapped[Decimal | None] = mapped_column(Money)
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class NewsItem(Base):
    __tablename__ = "news_items"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_news_provider_external"),
        Index("ix_news_symbol_published", "symbol", "published_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int | None] = mapped_column(ForeignKey("instruments.id"), index=True)
    symbol: Mapped[str | None] = mapped_column(String(24), index=True)
    external_id: Mapped[str] = mapped_column(String(128))
    headline: Mapped[str] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(120))
    url: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)  # observation ts
    retrieved_at: Mapped[datetime] = mapped_column(UtcDateTime)
    provider: Mapped[str] = mapped_column(String(40))
    sentiment: Mapped[Decimal | None] = mapped_column(Ratio)  # [-1, 1]
    uncertainty: Mapped[Decimal | None] = mapped_column(Ratio)  # [0, 1]
    source_credibility: Mapped[Decimal | None] = mapped_column(Ratio)  # [0, 1]
    novelty: Mapped[Decimal | None] = mapped_column(Ratio)  # [0, 1]
    event_tags: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "news_quality"), default=E.DataQuality.OK
    )
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class EconomicIndicator(Base):
    __tablename__ = "economic_indicators"
    __table_args__ = (
        UniqueConstraint("series_id", "observation_date", "provider", name="uq_econ_series_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[str] = mapped_column(String(40), index=True)
    label: Mapped[str | None] = mapped_column(String(120))
    observation_date: Mapped[date] = mapped_column(Date, index=True)
    value: Mapped[Decimal | None] = mapped_column(Ratio)
    unit: Mapped[str | None] = mapped_column(String(40))
    observed_at: Mapped[datetime] = mapped_column(UtcDateTime)  # release timestamp
    retrieved_at: Mapped[datetime] = mapped_column(UtcDateTime)
    provider: Mapped[str] = mapped_column(String(40))
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "econ_quality"), default=E.DataQuality.OK
    )
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class DataQualityIssue(Base):
    __tablename__ = "data_quality_issues"

    id: Mapped[int] = mapped_column(primary_key=True)
    detected_at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    kind: Mapped[E.IssueKind] = mapped_column(_enum(E.IssueKind, "issue_kind"), index=True)
    severity: Mapped[E.IssueSeverity] = mapped_column(
        _enum(E.IssueSeverity, "issue_severity"), default=E.IssueSeverity.WARNING, index=True
    )
    symbol: Mapped[str | None] = mapped_column(String(24), index=True)
    provider: Mapped[str | None] = mapped_column(String(40))
    session_date: Mapped[date | None] = mapped_column(Date)
    message: Mapped[str] = mapped_column(Text)
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    resolution_note: Mapped[str | None] = mapped_column(Text)


class ProviderFetchLog(Base):
    __tablename__ = "provider_fetch_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    endpoint: Mapped[str] = mapped_column(String(120))
    symbol: Mapped[str | None] = mapped_column(String(24))
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    status_code: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    records: Mapped[int | None] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    rate_limited: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text)


# ---------------------------------------------------------------------------
# Research
# ---------------------------------------------------------------------------
class FeatureSnapshot(Base):
    """Computed feature vector for one symbol at one point in time."""

    __tablename__ = "feature_snapshots"
    __table_args__ = (
        UniqueConstraint("symbol", "as_of", "registry_version", name="uq_feature_symbol_asof"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    as_of: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    registry_version: Mapped[str] = mapped_column(String(24))
    values: Mapped[dict[str, Any]] = mapped_column(JSON)
    missing: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "feat_quality"), default=E.DataQuality.OK
    )
    computed_at: Mapped[datetime] = mapped_column(UtcDateTime)


class RegimeSnapshot(Base):
    __tablename__ = "regime_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    as_of: Mapped[datetime] = mapped_column(UtcDateTime, index=True, unique=True)
    regime: Mapped[E.Regime] = mapped_column(_enum(E.Regime, "regime"))
    score: Mapped[Decimal] = mapped_column(Ratio)
    index_trend: Mapped[Decimal | None] = mapped_column(Ratio)
    vol_regime: Mapped[Decimal | None] = mapped_column(Ratio)
    breadth: Mapped[Decimal | None] = mapped_column(Ratio)
    credit: Mapped[Decimal | None] = mapped_column(Ratio)
    yield_curve: Mapped[Decimal | None] = mapped_column(Ratio)
    components: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    explanation: Mapped[str | None] = mapped_column(Text)


class Opportunity(Base):
    """A ranked candidate produced by the research engine."""

    __tablename__ = "opportunities"
    __table_args__ = (Index("ix_opportunity_asof_rank", "as_of", "rank"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    as_of: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    strategy_id: Mapped[int | None] = mapped_column(ForeignKey("strategies.id"))
    strategy_key: Mapped[str | None] = mapped_column(String(60), index=True)
    rank: Mapped[int | None] = mapped_column(Integer)
    growth_score: Mapped[Decimal | None] = mapped_column(Ratio)
    signal_score: Mapped[Decimal | None] = mapped_column(Ratio)
    confidence: Mapped[Decimal | None] = mapped_column(Ratio)
    uncertainty: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_return: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_return_low: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_return_high: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_vol: Mapped[Decimal | None] = mapped_column(Ratio)
    downside_estimate: Mapped[Decimal | None] = mapped_column(Ratio)
    estimated_cost_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_holding_days: Mapped[int | None] = mapped_column(Integer)
    regime: Mapped[E.Regime | None] = mapped_column(_enum(E.Regime, "opp_regime"))
    components: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    supporting_evidence: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    opposing_evidence: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    weaknesses: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    feature_snapshot_id: Mapped[int | None] = mapped_column(ForeignKey("feature_snapshots.id"))
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "opp_quality"), default=E.DataQuality.OK
    )
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


# ---------------------------------------------------------------------------
# Strategies / backtests
# ---------------------------------------------------------------------------
class Strategy(Base, TimestampMixin):
    __tablename__ = "strategies"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    family: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[E.StrategyStatus] = mapped_column(
        _enum(E.StrategyStatus, "strategy_status"), default=E.StrategyStatus.RESEARCH, index=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    paused_reason: Mapped[str | None] = mapped_column(Text)
    target_weight: Mapped[Decimal] = mapped_column(Ratio, default=Decimal(0))
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    versions: Mapped[list[StrategyVersion]] = relationship(back_populates="strategy")


class StrategyVersion(Base, TimestampMixin):
    __tablename__ = "strategy_versions"
    __table_args__ = (UniqueConstraint("strategy_id", "version", name="uq_stratver_strategy_ver"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    strategy_id: Mapped[int] = mapped_column(ForeignKey("strategies.id"), index=True)
    version: Mapped[str] = mapped_column(String(24))
    params: Mapped[dict[str, Any]] = mapped_column(JSON)
    code_hash: Mapped[str | None] = mapped_column(String(64))
    origin: Mapped[str] = mapped_column(String(40), default="human")  # human | ai_research
    quarantined: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by: Mapped[str | None] = mapped_column(String(255))
    approved_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    notes: Mapped[str | None] = mapped_column(Text)

    strategy: Mapped[Strategy] = relationship(back_populates="versions")


class BacktestRun(Base, TimestampMixin):
    __tablename__ = "backtest_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(160))
    strategy_id: Mapped[int | None] = mapped_column(ForeignKey("strategies.id"), index=True)
    strategy_version_id: Mapped[int | None] = mapped_column(ForeignKey("strategy_versions.id"))
    strategy_keys: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    phase: Mapped[E.BacktestPhase] = mapped_column(
        _enum(E.BacktestPhase, "bt_phase"), default=E.BacktestPhase.IN_SAMPLE, index=True
    )
    status: Mapped[E.RunStatus] = mapped_column(
        _enum(E.RunStatus, "run_status"), default=E.RunStatus.QUEUED, index=True
    )
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    starting_cash: Mapped[Decimal] = mapped_column(Money)
    universe: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    params: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    cost_model: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    benchmark_symbol: Mapped[str | None] = mapped_column(String(24))
    metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    benchmark_metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    regime_metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    diagnostics: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    rejection_reasons: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    accepted: Mapped[bool | None] = mapped_column(Boolean)
    uses_synthetic_data: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class BacktestTrade(Base):
    __tablename__ = "backtest_trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("backtest_runs.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    strategy_key: Mapped[str | None] = mapped_column(String(60))
    side: Mapped[E.Side] = mapped_column(_enum(E.Side, "bt_side"))
    entry_at: Mapped[datetime] = mapped_column(UtcDateTime)
    exit_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    quantity: Mapped[Decimal] = mapped_column(Qty)
    entry_price: Mapped[Decimal] = mapped_column(Money)
    exit_price: Mapped[Decimal | None] = mapped_column(Money)
    gross_pnl: Mapped[Decimal | None] = mapped_column(Money)
    costs: Mapped[Decimal | None] = mapped_column(Money)
    net_pnl: Mapped[Decimal | None] = mapped_column(Money)
    return_pct: Mapped[Decimal | None] = mapped_column(Ratio)
    holding_days: Mapped[int | None] = mapped_column(Integer)
    exit_reason: Mapped[str | None] = mapped_column(String(80))
    mae_pct: Mapped[Decimal | None] = mapped_column(Ratio)  # max adverse excursion
    mfe_pct: Mapped[Decimal | None] = mapped_column(Ratio)  # max favourable excursion


class EquityPoint(Base):
    __tablename__ = "equity_points"
    __table_args__ = (Index("ix_equity_run_date", "run_id", "session_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("backtest_runs.id"), index=True)
    session_date: Mapped[date] = mapped_column(Date)
    equity: Mapped[Decimal] = mapped_column(Money)
    cash: Mapped[Decimal] = mapped_column(Money)
    gross_exposure: Mapped[Decimal] = mapped_column(Ratio, default=Decimal(0))
    net_exposure: Mapped[Decimal] = mapped_column(Ratio, default=Decimal(0))
    drawdown: Mapped[Decimal] = mapped_column(Ratio, default=Decimal(0))
    benchmark_equity: Mapped[Decimal | None] = mapped_column(Money)
    positions: Mapped[int] = mapped_column(Integer, default=0)
    turnover: Mapped[Decimal | None] = mapped_column(Ratio)
    regime: Mapped[E.Regime | None] = mapped_column(_enum(E.Regime, "eq_regime"))


class EnsembleWeight(Base):
    __tablename__ = "ensemble_weights"

    id: Mapped[int] = mapped_column(primary_key=True)
    as_of: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    strategy_key: Mapped[str] = mapped_column(String(60), index=True)
    weight: Mapped[Decimal] = mapped_column(Ratio)
    prev_weight: Mapped[Decimal | None] = mapped_column(Ratio)
    raw_score: Mapped[Decimal | None] = mapped_column(Ratio)
    sharpe: Mapped[Decimal | None] = mapped_column(Ratio)
    correlation_penalty: Mapped[Decimal | None] = mapped_column(Ratio)
    turnover_penalty: Mapped[Decimal | None] = mapped_column(Ratio)
    regime_multiplier: Mapped[Decimal | None] = mapped_column(Ratio)
    evidence_trades: Mapped[int | None] = mapped_column(Integer)
    capped_by: Mapped[str | None] = mapped_column(String(60))
    reason: Mapped[str | None] = mapped_column(Text)


# ---------------------------------------------------------------------------
# Decisions / risk / execution
# ---------------------------------------------------------------------------
class Decision(Base):
    """Append-only decision journal entry. One row per proposed action."""

    __tablename__ = "decisions"
    __table_args__ = (Index("ix_decisions_at_symbol", "decided_at", "symbol"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    decided_at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    loop_run_id: Mapped[int | None] = mapped_column(ForeignKey("loop_runs.id"), index=True)
    mode: Mapped[E.Mode] = mapped_column(_enum(E.Mode, "decision_mode"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    action: Mapped[E.DecisionAction] = mapped_column(_enum(E.DecisionAction, "decision_action"))
    strategy_key: Mapped[str | None] = mapped_column(String(60), index=True)
    strategy_version: Mapped[str | None] = mapped_column(String(24))
    model_version: Mapped[str | None] = mapped_column(String(40))
    registry_version: Mapped[str | None] = mapped_column(String(24))

    proposed_quantity: Mapped[Decimal | None] = mapped_column(Qty)
    approved_quantity: Mapped[Decimal | None] = mapped_column(Qty)
    proposed_notional: Mapped[Decimal | None] = mapped_column(Money)
    reference_price: Mapped[Decimal | None] = mapped_column(Money)
    limit_price: Mapped[Decimal | None] = mapped_column(Money)

    confidence: Mapped[Decimal | None] = mapped_column(Ratio)
    uncertainty: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_return: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_holding_days: Mapped[int | None] = mapped_column(Integer)
    risk_contribution: Mapped[Decimal | None] = mapped_column(Ratio)
    estimated_cost_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    regime: Mapped[E.Regime | None] = mapped_column(_enum(E.Regime, "dec_regime"))

    signal_inputs: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    entry_thesis: Mapped[str | None] = mapped_column(Text)
    exit_criteria: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    invalidating_conditions: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    bull_case: Mapped[str | None] = mapped_column(Text)
    bear_case: Mapped[str | None] = mapped_column(Text)
    explanation: Mapped[str | None] = mapped_column(Text)
    sizing_detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    approval_state: Mapped[E.ApprovalState] = mapped_column(
        _enum(E.ApprovalState, "approval_state"), default=E.ApprovalState.PENDING_HUMAN, index=True
    )
    approved_by: Mapped[str | None] = mapped_column(String(255))
    approved_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    risk_verdict: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    opportunity_id: Mapped[int | None] = mapped_column(ForeignKey("opportunities.id"))
    data_quality: Mapped[E.DataQuality] = mapped_column(
        _enum(E.DataQuality, "dec_quality"), default=E.DataQuality.OK
    )
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)

    orders: Mapped[list[Order]] = relationship(back_populates="decision")
    risk_checks: Mapped[list[RiskCheck]] = relationship(back_populates="decision")
    review: Mapped[PostTradeReview | None] = relationship(back_populates="decision")


class RiskCheck(Base):
    """One row per individual limit evaluated for a decision — the audit detail."""

    __tablename__ = "risk_checks"

    id: Mapped[int] = mapped_column(primary_key=True)
    decision_id: Mapped[int | None] = mapped_column(ForeignKey("decisions.id"), index=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    check_name: Mapped[str] = mapped_column(String(80), index=True)
    result: Mapped[E.RiskCheckResult] = mapped_column(_enum(E.RiskCheckResult, "risk_result"))
    observed: Mapped[Decimal | None] = mapped_column(Ratio)
    limit_value: Mapped[Decimal | None] = mapped_column(Ratio)
    utilization: Mapped[Decimal | None] = mapped_column(Ratio)
    message: Mapped[str | None] = mapped_column(Text)
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    decision: Mapped[Decision | None] = relationship(back_populates="risk_checks")


class Order(Base, TimestampMixin):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("client_order_id", name="uq_orders_client_order_id"),
        Index("ix_orders_status_symbol", "status", "symbol"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    client_order_id: Mapped[str] = mapped_column(String(64), index=True)
    broker_order_id: Mapped[str | None] = mapped_column(String(64), index=True)
    decision_id: Mapped[int | None] = mapped_column(ForeignKey("decisions.id"), index=True)
    replaces_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"))
    mode: Mapped[E.Mode] = mapped_column(_enum(E.Mode, "order_mode"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    side: Mapped[E.Side] = mapped_column(_enum(E.Side, "order_side"))
    order_type: Mapped[E.OrderType] = mapped_column(_enum(E.OrderType, "order_type"))
    time_in_force: Mapped[E.TimeInForce] = mapped_column(
        _enum(E.TimeInForce, "tif"), default=E.TimeInForce.DAY
    )
    quantity: Mapped[Decimal] = mapped_column(Qty)
    limit_price: Mapped[Decimal | None] = mapped_column(Money)
    stop_price: Mapped[Decimal | None] = mapped_column(Money)
    status: Mapped[E.OrderStatus] = mapped_column(
        _enum(E.OrderStatus, "order_status"), default=E.OrderStatus.PENDING_NEW, index=True
    )
    filled_quantity: Mapped[Decimal] = mapped_column(Qty, default=Decimal(0))
    avg_fill_price: Mapped[Decimal | None] = mapped_column(Money)
    submitted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, index=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    last_event_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    canceled_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    expires_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    strategy_key: Mapped[str | None] = mapped_column(String(60), index=True)
    reference_price: Mapped[Decimal | None] = mapped_column(Money)
    expected_spread_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_slippage_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_impact_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    expected_total_cost_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    realized_slippage_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    commission: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    reject_reason: Mapped[str | None] = mapped_column(Text)
    broker: Mapped[str | None] = mapped_column(String(40))
    submit_attempts: Mapped[int] = mapped_column(Integer, default=0)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)

    decision: Mapped[Decision | None] = relationship(back_populates="orders")
    events: Mapped[list[OrderEvent]] = relationship(back_populates="order")
    fills: Mapped[list[Fill]] = relationship(back_populates="order")


class OrderEvent(Base):
    """Append-only order lifecycle event log."""

    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    from_status: Mapped[E.OrderStatus | None] = mapped_column(_enum(E.OrderStatus, "oe_from"))
    to_status: Mapped[E.OrderStatus | None] = mapped_column(_enum(E.OrderStatus, "oe_to"))
    quantity: Mapped[Decimal | None] = mapped_column(Qty)
    price: Mapped[Decimal | None] = mapped_column(Money)
    message: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(24), default="local")  # local | broker | recon
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    order: Mapped[Order] = relationship(back_populates="events")


class Fill(Base):
    __tablename__ = "fills"
    __table_args__ = (
        UniqueConstraint("order_id", "broker_fill_id", name="uq_fills_order_brokerfill"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    broker_fill_id: Mapped[str] = mapped_column(String(64))
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    side: Mapped[E.Side] = mapped_column(_enum(E.Side, "fill_side"))
    quantity: Mapped[Decimal] = mapped_column(Qty)
    price: Mapped[Decimal] = mapped_column(Money)
    commission: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    is_partial: Mapped[bool] = mapped_column(Boolean, default=False)
    slippage_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    liquidity_flag: Mapped[str | None] = mapped_column(String(16))

    order: Mapped[Order] = relationship(back_populates="fills")


class Position(Base, TimestampMixin):
    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("mode", "symbol", name="uq_positions_mode_symbol"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    mode: Mapped[E.Mode] = mapped_column(_enum(E.Mode, "position_mode"), index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    quantity: Mapped[Decimal] = mapped_column(Qty, default=Decimal(0))
    avg_entry_price: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    cost_basis: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    last_price: Mapped[Decimal | None] = mapped_column(Money)
    last_price_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    market_value: Mapped[Decimal | None] = mapped_column(Money)
    unrealized_pnl: Mapped[Decimal | None] = mapped_column(Money)
    unrealized_pnl_pct: Mapped[Decimal | None] = mapped_column(Ratio)
    realized_pnl: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    peak_price: Mapped[Decimal | None] = mapped_column(Money)
    opened_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    strategy_key: Mapped[str | None] = mapped_column(String(60), index=True)
    entry_decision_id: Mapped[int | None] = mapped_column(ForeignKey("decisions.id"))
    entry_thesis: Mapped[str | None] = mapped_column(Text)
    exit_criteria: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    stop_price: Mapped[Decimal | None] = mapped_column(Money)
    trailing_stop_pct: Mapped[Decimal | None] = mapped_column(Ratio)
    target_weight: Mapped[Decimal | None] = mapped_column(Ratio)
    risk_contribution: Mapped[Decimal | None] = mapped_column(Ratio)
    thesis_status: Mapped[str] = mapped_column(String(24), default="intact")
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"
    __table_args__ = (Index("ix_snapshot_mode_at", "mode", "at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    mode: Mapped[E.Mode] = mapped_column(_enum(E.Mode, "snap_mode"))
    session_date: Mapped[date] = mapped_column(Date, index=True)
    equity: Mapped[Decimal] = mapped_column(Money)
    cash: Mapped[Decimal] = mapped_column(Money)
    buying_power: Mapped[Decimal | None] = mapped_column(Money)
    long_market_value: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    short_market_value: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))
    gross_exposure: Mapped[Decimal] = mapped_column(Ratio, default=Decimal(0))
    net_exposure: Mapped[Decimal] = mapped_column(Ratio, default=Decimal(0))
    day_pnl: Mapped[Decimal | None] = mapped_column(Money)
    day_pnl_pct: Mapped[Decimal | None] = mapped_column(Ratio)
    cumulative_pnl: Mapped[Decimal | None] = mapped_column(Money)
    high_water_mark: Mapped[Decimal | None] = mapped_column(Money)
    drawdown_pct: Mapped[Decimal | None] = mapped_column(Ratio)
    open_positions: Mapped[int] = mapped_column(Integer, default=0)
    open_orders: Mapped[int] = mapped_column(Integer, default=0)
    risk_state: Mapped[E.RiskState] = mapped_column(
        _enum(E.RiskState, "snap_risk_state"), default=E.RiskState.NORMAL
    )
    sector_exposure: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    strategy_exposure: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(24), default="broker")


# ---------------------------------------------------------------------------
# Risk governance
# ---------------------------------------------------------------------------
class RiskConfig(Base, TimestampMixin):
    """Persisted, operator-editable risk limits. Newest active row wins."""

    __tablename__ = "risk_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    limits: Mapped[dict[str, Any]] = mapped_column(JSON)
    updated_by: Mapped[str | None] = mapped_column(String(255))
    note: Mapped[str | None] = mapped_column(Text)


class SystemState(Base, TimestampMixin):
    """Singleton operational state: kill switch, risk posture, cooldowns."""

    __tablename__ = "system_state"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    kill_switch_engaged: Mapped[bool] = mapped_column(Boolean, default=False)
    kill_switch_reason: Mapped[str | None] = mapped_column(Text)
    kill_switch_engaged_by: Mapped[str | None] = mapped_column(String(255))
    kill_switch_engaged_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    read_only: Mapped[bool] = mapped_column(Boolean, default=False)
    risk_state: Mapped[E.RiskState] = mapped_column(
        _enum(E.RiskState, "sys_risk_state"), default=E.RiskState.NORMAL
    )
    risk_state_reason: Mapped[str | None] = mapped_column(Text)
    cooldown_until: Mapped[datetime | None] = mapped_column(UtcDateTime)
    cooldown_reason: Mapped[str | None] = mapped_column(Text)
    recovery_requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    trading_halted_for_date: Mapped[date | None] = mapped_column(Date)
    halt_reason: Mapped[str | None] = mapped_column(Text)
    last_loop_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    last_reconcile_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    broker_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    broker_last_ok_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class Quarantine(Base, TimestampMixin):
    __tablename__ = "quarantines"

    id: Mapped[int] = mapped_column(primary_key=True)
    scope: Mapped[str] = mapped_column(String(16), index=True)  # symbol | strategy
    key: Mapped[str] = mapped_column(String(60), index=True)
    reason: Mapped[str] = mapped_column(Text)
    engaged_by: Mapped[str | None] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    until: Mapped[datetime | None] = mapped_column(UtcDateTime)
    released_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    released_by: Mapped[str | None] = mapped_column(String(255))


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    kind: Mapped[E.AlertKind] = mapped_column(_enum(E.AlertKind, "alert_kind"), index=True)
    severity: Mapped[E.AlertSeverity] = mapped_column(
        _enum(E.AlertSeverity, "alert_severity"), default=E.AlertSeverity.INFO, index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    symbol: Mapped[str | None] = mapped_column(String(24))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    acknowledged_by: Mapped[str | None] = mapped_column(String(255))
    acknowledged_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    delivered_channels: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class MetricSample(Base):
    __tablename__ = "metric_samples"
    __table_args__ = (Index("ix_metric_name_at", "name", "at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    name: Mapped[str] = mapped_column(String(80))
    value: Mapped[Decimal] = mapped_column(Ratio)
    labels: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class ReconciliationRun(Base):
    __tablename__ = "reconciliation_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    mode: Mapped[E.Mode] = mapped_column(_enum(E.Mode, "recon_mode"))
    status: Mapped[E.ReconStatus] = mapped_column(
        _enum(E.ReconStatus, "recon_status"), default=E.ReconStatus.CLEAN, index=True
    )
    positions_checked: Mapped[int] = mapped_column(Integer, default=0)
    orders_checked: Mapped[int] = mapped_column(Integer, default=0)
    breaks: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    auto_healed: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    resolved: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)


class PromotionRecord(Base, TimestampMixin):
    __tablename__ = "promotion_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    strategy_id: Mapped[int] = mapped_column(ForeignKey("strategies.id"), index=True)
    strategy_key: Mapped[str] = mapped_column(String(60))
    from_status: Mapped[str] = mapped_column(String(24))
    to_status: Mapped[str] = mapped_column(String(24))
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    checks: Mapped[dict[str, Any]] = mapped_column(JSON)
    thresholds: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    requested_by: Mapped[str | None] = mapped_column(String(255))
    approved_by: Mapped[str | None] = mapped_column(String(255))
    note: Mapped[str | None] = mapped_column(Text)


class LiveAuthorization(Base):
    """Persistent audit record of every live-mode enable/disable attempt."""

    __tablename__ = "live_authorizations"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    requested_by: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(24))  # enable | disable
    granted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    account_identifier: Mapped[str | None] = mapped_column(String(120))
    broker: Mapped[str | None] = mapped_column(String(40))
    max_allocation_usd: Mapped[Decimal | None] = mapped_column(Money)
    phrase_matched: Mapped[bool] = mapped_column(Boolean, default=False)
    env_flag_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    preflight: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    validation: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    failure_reasons: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))
    expires_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class LoopRun(Base):
    """One execution of the autonomous decision loop, step by step."""

    __tablename__ = "loop_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    mode: Mapped[E.Mode] = mapped_column(_enum(E.Mode, "loop_mode"), index=True)
    status: Mapped[E.RunStatus] = mapped_column(
        _enum(E.RunStatus, "loop_status"), default=E.RunStatus.RUNNING, index=True
    )
    trigger: Mapped[str] = mapped_column(String(24), default="scheduler")
    market_open: Mapped[bool | None] = mapped_column(Boolean)
    regime: Mapped[E.Regime | None] = mapped_column(_enum(E.Regime, "loop_regime"))
    health_ok: Mapped[bool | None] = mapped_column(Boolean)
    steps: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    candidates_considered: Mapped[int] = mapped_column(Integer, default=0)
    decisions_made: Mapped[int] = mapped_column(Integer, default=0)
    orders_submitted: Mapped[int] = mapped_column(Integer, default=0)
    orders_rejected: Mapped[int] = mapped_column(Integer, default=0)
    halted_reason: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class PostTradeReview(Base):
    __tablename__ = "post_trade_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    decision_id: Mapped[int] = mapped_column(ForeignKey("decisions.id"), unique=True, index=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, index=True)
    symbol: Mapped[str] = mapped_column(String(24), index=True)
    realized_pnl: Mapped[Decimal | None] = mapped_column(Money)
    realized_return_pct: Mapped[Decimal | None] = mapped_column(Ratio)
    holding_days: Mapped[int | None] = mapped_column(Integer)
    expected_vs_actual: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    thesis_outcome: Mapped[str | None] = mapped_column(String(40))
    exit_reason: Mapped[str | None] = mapped_column(String(80))
    slippage_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    cost_bps: Mapped[Decimal | None] = mapped_column(Ratio)
    lessons: Mapped[str | None] = mapped_column(Text)
    calibration_bucket: Mapped[str | None] = mapped_column(String(24))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    decision: Mapped[Decision] = relationship(back_populates="review")


__all__ = [
    "Alert",
    "AuditLog",
    "BacktestRun",
    "BacktestTrade",
    "Bar",
    "CorporateAction",
    "DataQualityIssue",
    "Decision",
    "EconomicIndicator",
    "EnsembleWeight",
    "EquityPoint",
    "FeatureSnapshot",
    "Fill",
    "Fundamental",
    "Instrument",
    "LiveAuthorization",
    "LoopRun",
    "MarketCalendarDay",
    "MetricSample",
    "NewsItem",
    "Opportunity",
    "Order",
    "OrderEvent",
    "PortfolioSnapshot",
    "Position",
    "PostTradeReview",
    "PromotionRecord",
    "ProviderFetchLog",
    "Quarantine",
    "Quote",
    "ReconciliationRun",
    "RegimeSnapshot",
    "RiskCheck",
    "RiskConfig",
    "Strategy",
    "StrategyVersion",
    "SystemState",
    "User",
]
