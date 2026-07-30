"""Point-in-time market view.

This module is the single choke point for historical data access, and the reason
look-ahead bias cannot leak in through ordinary use: a :class:`PointInTime` view
physically cannot see rows past its ``as_of``.

* Bars are truncated by ``ts <= as_of`` (a daily bar's ``ts`` is its close, so a
  bar is never visible intraday on its own session).
* Fundamentals are truncated by ``observed_at <= as_of`` — the publication
  timestamp, not the fiscal period end.
* News is truncated by ``published_at <= as_of``.
* Macro series are truncated by ``observed_at <= as_of`` — the release time, not
  the observation date.

:class:`MarketView` loads full history once (cheap for a backtest over hundreds
of sessions) and hands out ``PointInTime`` slices via ``numpy.searchsorted``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from functools import cached_property
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.db.models import (
    Bar,
    CorporateAction,
    EconomicIndicator,
    Fundamental,
    Instrument,
    NewsItem,
)
from aegisquant.logging_setup import get_logger
from aegisquant.utils.timeutil import ensure_utc

log = get_logger(__name__)

FUNDAMENTAL_FIELDS = (
    "revenue",
    "revenue_yoy",
    "gross_profit",
    "gross_margin",
    "operating_income",
    "operating_margin",
    "net_income",
    "eps",
    "eps_yoy",
    "free_cash_flow",
    "fcf_yoy",
    "operating_cash_flow",
    "total_debt",
    "total_equity",
    "cash",
    "debt_to_equity",
    "current_ratio",
    "roic",
    "market_cap",
    "pe_ratio",
    "ps_ratio",
    "ev_to_sales",
    "shares_outstanding",
    "accruals_ratio",
    "recurring_revenue_pct",
    "rnd_expense",
    "short_interest_pct",
    "insider_net_buy_usd",
)


class LookaheadError(AssertionError):
    """Raised when data past the point-in-time boundary is observed."""


@dataclass(slots=True)
class SymbolSeries:
    """Numpy arrays for one symbol, ascending by timestamp."""

    symbol: str
    ts: np.ndarray  # datetime64[ns]
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    quality_ok: np.ndarray  # bool
    synthetic: bool = False
    #: Adjustment status of the stored prices. Decides whether a consumer must
    #: apply corporate actions itself (``raw``) or whether they are already
    #: baked in (``split_dividend``).
    adjustment: str = "raw"
    #: Cumulative product of split ratios with an ex-date at or before each bar.
    #: Used to build a point-in-time-correct adjusted series (see
    #: :meth:`adjusted_to`). ``None`` when the stored prices are already adjusted.
    split_factor: np.ndarray | None = None

    def __len__(self) -> int:
        return int(self.ts.size)

    def cut(self, as_of: datetime) -> int:
        """Index one past the last observation at or before ``as_of``."""
        return int(np.searchsorted(self.ts, np.datetime64(ensure_utc(as_of).replace(tzinfo=None)), side="right"))

    def adjusted_to(self, values: np.ndarray, cut: int, inverse: bool = False) -> np.ndarray:
        """Split-adjust ``values[:cut]`` as of observation ``cut - 1``.

        This is the point-in-time-correct adjustment. At an evaluation instant
        every split with an ex-date **at or before** that instant is public
        knowledge, so scaling earlier prices for those splits uses no future
        information. Adjusting for a split that has not happened yet — which is
        what a vendor's back-adjusted series does — would.

        ``inverse=True`` applies the reciprocal, for share quantities such as
        volume, which scale opposite to price.
        """
        if self.split_factor is None or cut <= 0 or values.size == 0:
            return values
        factors = self.split_factor[:cut]
        current = factors[-1]
        if current <= 0:
            return values
        scale = factors / current
        return values * (1.0 / scale) if inverse else values * scale


@dataclass(slots=True)
class FundamentalRow:
    period_end: date
    observed_at: datetime
    values: dict[str, float | None]


@dataclass(slots=True)
class NewsRow:
    published_at: datetime
    headline: str
    sentiment: float | None
    uncertainty: float | None
    credibility: float | None
    novelty: float | None
    tags: tuple[str, ...]
    source: str | None


@dataclass(slots=True)
class MacroSeries:
    series_id: str
    observed_at: np.ndarray  # datetime64[ns] release times
    observation_date: np.ndarray
    values: np.ndarray

    def latest(self, as_of: datetime) -> float | None:
        idx = int(
            np.searchsorted(
                self.observed_at,
                np.datetime64(ensure_utc(as_of).replace(tzinfo=None)),
                side="right",
            )
        )
        if idx == 0:
            return None
        vals = self.values[:idx]
        finite = vals[np.isfinite(vals)]
        return float(finite[-1]) if finite.size else None

    def history(self, as_of: datetime, n: int) -> np.ndarray:
        idx = int(
            np.searchsorted(
                self.observed_at,
                np.datetime64(ensure_utc(as_of).replace(tzinfo=None)),
                side="right",
            )
        )
        vals = self.values[max(0, idx - n) : idx]
        return vals[np.isfinite(vals)]


# ---------------------------------------------------------------------------
class MarketView:
    """Full-history container. Build once, slice many times."""

    def __init__(
        self,
        series: dict[str, SymbolSeries],
        fundamentals: dict[str, list[FundamentalRow]],
        news: dict[str, list[NewsRow]],
        macro: dict[str, MacroSeries],
        sectors: dict[str, str],
        instruments: dict[str, dict[str, Any]],
        corporate_actions: dict[str, list[dict[str, Any]]],
        benchmark: str = "SPY",
    ) -> None:
        self.series = series
        self.fundamentals = fundamentals
        self.news = news
        self.macro = macro
        self.sectors = sectors
        self.instruments = instruments
        self.corporate_actions = corporate_actions
        self.benchmark = benchmark

    # -- construction --------------------------------------------------------
    @classmethod
    def load(
        cls,
        session: Session,
        symbols: list[str],
        *,
        start: date | None = None,
        end: date | None = None,
        benchmark: str = "SPY",
        timeframe: str = "1Day",
        include_news: bool = True,
        include_fundamentals: bool = True,
    ) -> MarketView:
        wanted = sorted({s.upper() for s in symbols} | {benchmark.upper()})

        bar_q = select(Bar).where(Bar.symbol.in_(wanted), Bar.timeframe == timeframe)
        if start:
            bar_q = bar_q.where(Bar.ts >= datetime.combine(start, datetime.min.time()))
        if end:
            bar_q = bar_q.where(Bar.ts <= datetime.combine(end, datetime.max.time()))
        rows_by_symbol: dict[str, list[Bar]] = {}
        for bar in session.scalars(bar_q.order_by(Bar.symbol, Bar.ts)):
            rows_by_symbol.setdefault(bar.symbol, []).append(bar)

        # Split schedule per symbol, needed to build the adjustment factors.
        splits_by_symbol: dict[str, list[tuple[date, float]]] = {}
        for ca in session.scalars(
            select(CorporateAction)
            .where(CorporateAction.symbol.in_(wanted), CorporateAction.action_type == "split")
            .order_by(CorporateAction.symbol, CorporateAction.ex_date)
        ):
            if ca.ratio and float(ca.ratio) > 0:
                splits_by_symbol.setdefault(ca.symbol, []).append((ca.ex_date, float(ca.ratio)))

        series: dict[str, SymbolSeries] = {}
        for sym, rows in rows_by_symbol.items():
            adjustment = rows[-1].adjustment.value if rows else "raw"
            split_factor: np.ndarray | None = None
            splits = splits_by_symbol.get(sym)
            if adjustment == "raw" and splits:
                factors = np.ones(len(rows))
                running = 1.0
                split_idx = 0
                ordered = sorted(splits)
                for i, row in enumerate(rows):
                    d = ensure_utc(row.ts).date()
                    while split_idx < len(ordered) and ordered[split_idx][0] <= d:
                        running *= ordered[split_idx][1]
                        split_idx += 1
                    factors[i] = running
                split_factor = factors

            series[sym] = SymbolSeries(
                symbol=sym,
                ts=np.array(
                    [np.datetime64(ensure_utc(r.ts).replace(tzinfo=None)) for r in rows],
                    dtype="datetime64[ns]",
                ),
                open=np.array([float(r.open) for r in rows]),
                high=np.array([float(r.high) for r in rows]),
                low=np.array([float(r.low) for r in rows]),
                close=np.array([float(r.close) for r in rows]),
                volume=np.array([float(r.volume) for r in rows]),
                quality_ok=np.array([r.data_quality.value not in ("corrupt", "suspect") for r in rows], dtype=bool),
                synthetic=any(r.is_synthetic for r in rows),
                adjustment=adjustment,
                split_factor=split_factor,
            )

        fundamentals: dict[str, list[FundamentalRow]] = {}
        if include_fundamentals:
            for fund in session.scalars(
                select(Fundamental)
                .where(Fundamental.symbol.in_(wanted))
                .order_by(Fundamental.symbol, Fundamental.observed_at)
            ):
                fundamentals.setdefault(fund.symbol, []).append(
                    FundamentalRow(
                        period_end=fund.period_end,
                        observed_at=ensure_utc(fund.observed_at),
                        values={
                            f: (float(getattr(fund, f)) if getattr(fund, f) is not None else None)
                            for f in FUNDAMENTAL_FIELDS
                        },
                    )
                )

        news: dict[str, list[NewsRow]] = {}
        if include_news:
            for item in session.scalars(
                select(NewsItem).where(NewsItem.symbol.in_(wanted)).order_by(NewsItem.symbol, NewsItem.published_at)
            ):
                tags = tuple((item.event_tags or {}).get("tags", ())) if item.event_tags else ()
                news.setdefault(item.symbol or "", []).append(
                    NewsRow(
                        published_at=ensure_utc(item.published_at),
                        headline=item.headline,
                        sentiment=float(item.sentiment) if item.sentiment is not None else None,
                        uncertainty=float(item.uncertainty) if item.uncertainty is not None else None,
                        credibility=(float(item.source_credibility) if item.source_credibility is not None else None),
                        novelty=float(item.novelty) if item.novelty is not None else None,
                        tags=tags,
                        source=item.source,
                    )
                )

        macro: dict[str, MacroSeries] = {}
        grouped: dict[str, list[EconomicIndicator]] = {}
        for econ in session.scalars(
            select(EconomicIndicator).order_by(EconomicIndicator.series_id, EconomicIndicator.observed_at)
        ):
            grouped.setdefault(econ.series_id, []).append(econ)
        for sid, econ_rows in grouped.items():
            macro[sid] = MacroSeries(
                series_id=sid,
                observed_at=np.array(
                    [np.datetime64(ensure_utc(r.observed_at).replace(tzinfo=None)) for r in econ_rows],
                    dtype="datetime64[ns]",
                ),
                observation_date=np.array([np.datetime64(r.observation_date) for r in econ_rows]),
                values=np.array([float(r.value) if r.value is not None else np.nan for r in econ_rows]),
            )

        sectors: dict[str, str] = {}
        instruments: dict[str, dict[str, Any]] = {}
        for inst in session.scalars(select(Instrument).where(Instrument.symbol.in_(wanted))):
            sectors[inst.symbol] = inst.sector or "Unclassified"
            instruments[inst.symbol] = {
                "name": inst.name,
                "asset_class": inst.asset_class.value,
                "sector": inst.sector,
                "tradable": inst.is_tradable,
                "fractionable": inst.fractionable,
                "shortable": inst.shortable,
                "easy_to_borrow": inst.easy_to_borrow,
                "is_leveraged_etf": inst.is_leveraged_etf,
                "delisted_on": inst.delisted_on,
                "renamed_to": inst.renamed_to,
                "data_quality": inst.data_quality.value,
            }

        actions: dict[str, list[dict[str, Any]]] = {}
        for ca in session.scalars(
            select(CorporateAction)
            .where(CorporateAction.symbol.in_(wanted))
            .order_by(CorporateAction.symbol, CorporateAction.ex_date)
        ):
            actions.setdefault(ca.symbol, []).append(
                {
                    "action_type": ca.action_type,
                    "ex_date": ca.ex_date,
                    "ratio": float(ca.ratio) if ca.ratio is not None else None,
                    "cash_amount": float(ca.cash_amount) if ca.cash_amount is not None else None,
                    "new_symbol": ca.new_symbol,
                }
            )

        return cls(
            series=series,
            fundamentals=fundamentals,
            news=news,
            macro=macro,
            sectors=sectors,
            instruments=instruments,
            corporate_actions=actions,
            benchmark=benchmark.upper(),
        )

    # -- access --------------------------------------------------------------
    @property
    def symbols(self) -> list[str]:
        return sorted(self.series)

    def at(self, as_of: datetime) -> PointInTime:
        return PointInTime(self, ensure_utc(as_of))

    def sessions(self, start: date | None = None, end: date | None = None) -> list[datetime]:
        """Union of bar timestamps for the benchmark (the trading clock)."""
        bench = self.series.get(self.benchmark)
        source = bench or next(iter(self.series.values()), None)
        if source is None:
            return []
        out = []
        for t in source.ts:
            dt = ensure_utc(t.astype("datetime64[ms]").astype(datetime))
            if start and dt.date() < start:
                continue
            if end and dt.date() > end:
                continue
            out.append(dt)
        return out


@dataclass
class PointInTime:
    """A view of the market as it was known at ``as_of``. Read-only."""

    view: MarketView
    as_of: datetime
    _cuts: dict[str, int] = field(default_factory=dict, repr=False)

    # -- prices --------------------------------------------------------------
    def _cut(self, symbol: str) -> int:
        symbol = symbol.upper()
        cached = self._cuts.get(symbol)
        if cached is None:
            s = self.view.series.get(symbol)
            cached = 0 if s is None else s.cut(self.as_of)
            self._cuts[symbol] = cached
        return cached

    def has(self, symbol: str, min_bars: int = 1) -> bool:
        return self._cut(symbol) >= min_bars

    def closes(self, symbol: str, n: int | None = None) -> np.ndarray:
        return self._arr(symbol, "close", n)

    def opens(self, symbol: str, n: int | None = None) -> np.ndarray:
        return self._arr(symbol, "open", n)

    def highs(self, symbol: str, n: int | None = None) -> np.ndarray:
        return self._arr(symbol, "high", n)

    def lows(self, symbol: str, n: int | None = None) -> np.ndarray:
        return self._arr(symbol, "low", n)

    def volumes(self, symbol: str, n: int | None = None) -> np.ndarray:
        return self._arr(symbol, "volume", n)

    def timestamps(self, symbol: str, n: int | None = None) -> np.ndarray:
        return self._arr(symbol, "ts", n)

    def _arr(self, symbol: str, field_name: str, n: int | None) -> np.ndarray:
        """Truncate at ``as_of``, split-adjusting prices and volumes.

        Features must see a continuous series — a raw price series has a genuine
        discontinuity at every split, which would otherwise be read as a real
        return. The adjustment uses only splits already public at ``as_of``.
        """
        s = self.view.series.get(symbol.upper())
        if s is None:
            return np.array([])
        cut = self._cut(symbol)
        arr = getattr(s, field_name)[:cut]
        if field_name in ("open", "high", "low", "close"):
            arr = s.adjusted_to(arr, cut)
        elif field_name == "volume":
            arr = s.adjusted_to(arr, cut, inverse=True)
        if n is not None and arr.size > n:
            arr = arr[-n:]
        return arr

    def last_close(self, symbol: str) -> float | None:
        c = self.closes(symbol, 1)
        return float(c[-1]) if c.size else None

    def last_bar_time(self, symbol: str) -> datetime | None:
        ts = self.timestamps(symbol, 1)
        if not ts.size:
            return None
        return ensure_utc(ts[-1].astype("datetime64[ms]").astype(datetime))

    def data_age_seconds(self, symbol: str) -> float | None:
        t = self.last_bar_time(symbol)
        return None if t is None else (self.as_of - t).total_seconds()

    def quality_ok(self, symbol: str, n: int = 20) -> bool:
        s = self.view.series.get(symbol.upper())
        if s is None:
            return False
        cut = self._cut(symbol)
        window = s.quality_ok[max(0, cut - n) : cut]
        return bool(window.size) and bool(window.all())

    def is_synthetic(self, symbol: str) -> bool:
        s = self.view.series.get(symbol.upper())
        return bool(s and s.synthetic)

    # -- fundamentals --------------------------------------------------------
    def fundamentals(self, symbol: str) -> list[FundamentalRow]:
        rows = self.view.fundamentals.get(symbol.upper(), [])
        return [r for r in rows if r.observed_at <= self.as_of]

    def latest_fundamental(self, symbol: str) -> FundamentalRow | None:
        rows = self.fundamentals(symbol)
        return rows[-1] if rows else None

    # -- news ----------------------------------------------------------------
    def news(self, symbol: str, days: int | None = None) -> list[NewsRow]:
        rows = [r for r in self.view.news.get(symbol.upper(), []) if r.published_at <= self.as_of]
        if days is not None:
            cutoff = self.as_of - timedelta(days=days)
            rows = [r for r in rows if r.published_at >= cutoff]
        return rows

    # -- macro ---------------------------------------------------------------
    def macro_latest(self, series_id: str) -> float | None:
        s = self.view.macro.get(series_id)
        return None if s is None else s.latest(self.as_of)

    def macro_history(self, series_id: str, n: int) -> np.ndarray:
        s = self.view.macro.get(series_id)
        return np.array([]) if s is None else s.history(self.as_of, n)

    # -- reference -----------------------------------------------------------
    def sector(self, symbol: str) -> str:
        return self.view.sectors.get(symbol.upper(), "Unclassified")

    def instrument(self, symbol: str) -> dict[str, Any]:
        return self.view.instruments.get(symbol.upper(), {})

    def corporate_actions(self, symbol: str, since_days: int | None = None) -> list[dict[str, Any]]:
        rows = [a for a in self.view.corporate_actions.get(symbol.upper(), []) if a["ex_date"] <= self.as_of.date()]
        if since_days is not None:
            cutoff = (self.as_of - timedelta(days=since_days)).date()
            rows = [a for a in rows if a["ex_date"] >= cutoff]
        return rows

    def is_delisted(self, symbol: str) -> bool:
        meta = self.instrument(symbol)
        d = meta.get("delisted_on")
        return bool(d and d <= self.as_of.date())

    @cached_property
    def investable_symbols(self) -> list[str]:
        """Symbols with data at ``as_of`` that were not yet delisted.

        Using this rather than the raw universe list is what keeps a backtest
        free of survivorship bias: a name that had not listed yet has no bars, a
        name that has since delisted still appears until its delisting date.
        """
        out = []
        for sym in self.view.symbols:
            if self.is_delisted(sym):
                continue
            if not self.has(sym, min_bars=1):
                continue
            out.append(sym)
        return out

    @property
    def benchmark(self) -> str:
        return self.view.benchmark

    def assert_no_lookahead(self) -> None:
        """Self-check used by tests: no visible row may post-date ``as_of``."""
        for sym in self.view.symbols:
            ts = self.timestamps(sym)
            if ts.size:
                last = ensure_utc(ts[-1].astype("datetime64[ms]").astype(datetime))
                if last > self.as_of:
                    raise LookaheadError(f"{sym} bar {last} is after as_of {self.as_of}")
            for row in self.fundamentals(sym):
                if row.observed_at > self.as_of:
                    raise LookaheadError(f"{sym} fundamental observed {row.observed_at} > {self.as_of}")
            for n in self.news(sym):
                if n.published_at > self.as_of:
                    raise LookaheadError(f"{sym} news published {n.published_at} > {self.as_of}")
