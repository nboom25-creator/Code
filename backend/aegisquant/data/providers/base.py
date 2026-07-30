"""Provider interfaces and the provenance envelope every record must carry.

Contract for all providers:

* Return **only** what the upstream source actually returned. Missing data is
  represented by absence or an explicit ``MISSING`` quality flag — never by an
  invented value.
* Stamp every record with provider, retrieval time, observation time, symbol,
  adjustment status and data-quality status.
* Raise :class:`ProviderError` (or a subclass) on failure. Callers decide
  whether to fall back; providers never silently substitute another source.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from aegisquant.db.enums import Adjustment, AssetClass, DataQuality
from aegisquant.utils.timeutil import utcnow


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------
class ProviderError(RuntimeError):
    """Base class for all provider failures."""

    def __init__(self, provider: str, message: str, *, status_code: int | None = None) -> None:
        super().__init__(f"[{provider}] {message}")
        self.provider = provider
        self.message = message
        self.status_code = status_code


class ProviderRateLimited(ProviderError):
    def __init__(self, provider: str, retry_after: float | None = None) -> None:
        super().__init__(provider, "rate limited", status_code=429)
        self.retry_after = retry_after


class ProviderUnavailable(ProviderError):
    """Transient — safe to retry or fall back."""


class ProviderNotConfigured(ProviderError):
    """Credentials or configuration missing. Never retried."""


class ProviderDataMissing(ProviderError):
    """Upstream responded but has no data for the request."""


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class Provenance:
    """Mandatory provenance for every externally retrieved record."""

    provider: str
    retrieved_at: datetime
    observed_at: datetime
    symbol: str | None = None
    adjustment: Adjustment = Adjustment.RAW
    data_quality: DataQuality = DataQuality.OK
    is_synthetic: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "retrieved_at": self.retrieved_at.isoformat(),
            "observed_at": self.observed_at.isoformat(),
            "symbol": self.symbol,
            "adjustment": self.adjustment.value,
            "data_quality": self.data_quality.value,
            "is_synthetic": self.is_synthetic,
        }


@dataclass(slots=True)
class BarRecord:
    symbol: str
    ts: datetime  # bar close (observation timestamp), UTC
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    provenance: Provenance
    timeframe: str = "1Day"
    trade_count: int | None = None
    vwap: Decimal | None = None


@dataclass(slots=True)
class QuoteRecord:
    symbol: str
    observed_at: datetime
    provenance: Provenance
    bid: Decimal | None = None
    ask: Decimal | None = None
    bid_size: Decimal | None = None
    ask_size: Decimal | None = None
    last: Decimal | None = None

    @property
    def mid(self) -> Decimal | None:
        if self.bid and self.ask and self.bid > 0 and self.ask > 0:
            return (self.bid + self.ask) / 2
        return self.last

    @property
    def spread_bps(self) -> Decimal | None:
        m = self.mid
        if self.bid and self.ask and m and m > 0:
            return (self.ask - self.bid) / m * Decimal(10_000)
        return None


@dataclass(slots=True)
class TradeRecord:
    symbol: str
    observed_at: datetime
    price: Decimal
    size: Decimal
    provenance: Provenance
    exchange: str | None = None


@dataclass(slots=True)
class CorporateActionRecord:
    symbol: str
    action_type: str  # split | dividend | symbol_change | delist
    ex_date: date
    provenance: Provenance
    ratio: Decimal | None = None
    cash_amount: Decimal | None = None
    new_symbol: str | None = None


@dataclass(slots=True)
class FundamentalRecord:
    symbol: str
    period_end: date
    provenance: Provenance
    fiscal_period: str | None = None
    values: dict[str, Decimal | None] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class NewsRecord:
    symbol: str | None
    external_id: str
    headline: str
    published_at: datetime
    provenance: Provenance
    summary: str | None = None
    source: str | None = None
    url: str | None = None
    sentiment: Decimal | None = None
    uncertainty: Decimal | None = None
    source_credibility: Decimal | None = None
    novelty: Decimal | None = None
    event_tags: list[str] = field(default_factory=list)


@dataclass(slots=True)
class EconomicRecord:
    series_id: str
    observation_date: date
    value: Decimal | None
    provenance: Provenance
    label: str | None = None
    unit: str | None = None


@dataclass(slots=True)
class CalendarDayRecord:
    session_date: date
    is_open: bool
    provider: str
    open_utc: datetime | None = None
    close_utc: datetime | None = None
    early_close: bool = False
    holiday_name: str | None = None


@dataclass(slots=True)
class InstrumentRecord:
    symbol: str
    name: str | None
    asset_class: AssetClass
    provenance: Provenance
    exchange: str | None = None
    sector: str | None = None
    industry: str | None = None
    tradable: bool = True
    fractionable: bool = False
    shortable: bool = False
    easy_to_borrow: bool = False
    is_leveraged_etf: bool = False
    delisted_on: date | None = None
    renamed_to: str | None = None


# ---------------------------------------------------------------------------
# Interfaces
# ---------------------------------------------------------------------------
class Provider(abc.ABC):  # noqa: B024 - intentional shared base with no abstract members
    """Common provider surface.

    Deliberately declares no abstract methods: it carries the provenance helper
    and health probe that every provider role shares, while the role protocols
    below (``PriceProvider``, ``NewsProvider``, ...) define the actual contracts.
    """

    name: str = "abstract"
    is_synthetic: bool = False

    def provenance(
        self,
        symbol: str | None,
        observed_at: datetime,
        *,
        adjustment: Adjustment = Adjustment.RAW,
        quality: DataQuality | None = None,
    ) -> Provenance:
        return Provenance(
            provider=self.name,
            retrieved_at=utcnow(),
            observed_at=observed_at,
            symbol=symbol,
            adjustment=adjustment,
            data_quality=quality or (DataQuality.SYNTHETIC if self.is_synthetic else DataQuality.OK),
            is_synthetic=self.is_synthetic,
        )

    def health(self) -> dict[str, Any]:
        """Cheap liveness probe. Must not raise."""
        return {"provider": self.name, "ok": True, "synthetic": self.is_synthetic}


class PriceProvider(Provider):
    @abc.abstractmethod
    def get_bars(
        self,
        symbol: str,
        start: date,
        end: date,
        timeframe: str = "1Day",
        adjustment: Adjustment = Adjustment.SPLIT_DIVIDEND,
    ) -> list[BarRecord]:
        """Historical OHLCV, ascending by timestamp, inclusive of both bounds."""

    def get_latest_bar(self, symbol: str, timeframe: str = "1Day") -> BarRecord | None:
        return None


class QuoteProvider(Provider):
    @abc.abstractmethod
    def get_quote(self, symbol: str) -> QuoteRecord: ...


class TradeProvider(Provider):
    @abc.abstractmethod
    def get_recent_trades(self, symbol: str, limit: int = 50) -> list[TradeRecord]: ...


class CorporateActionProvider(Provider):
    @abc.abstractmethod
    def get_corporate_actions(self, symbol: str, start: date, end: date) -> list[CorporateActionRecord]: ...


class FundamentalsProvider(Provider):
    @abc.abstractmethod
    def get_fundamentals(self, symbol: str, limit: int = 8) -> list[FundamentalRecord]:
        """Most recent ``limit`` fiscal periods, ascending by ``period_end``."""


class NewsProvider(Provider):
    @abc.abstractmethod
    def get_news(self, symbol: str, start: date | None = None, limit: int = 50) -> list[NewsRecord]:
        """Recent news. An empty list is a legitimate result, not a failure."""


class EconomicProvider(Provider):
    @abc.abstractmethod
    def get_series(self, series_id: str, start: date, end: date) -> list[EconomicRecord]: ...


class CalendarProvider(Provider):
    @abc.abstractmethod
    def get_calendar(self, start: date, end: date) -> list[CalendarDayRecord]: ...


class InstrumentProvider(Provider):
    @abc.abstractmethod
    def list_instruments(self, symbols: list[str] | None = None) -> list[InstrumentRecord]: ...
