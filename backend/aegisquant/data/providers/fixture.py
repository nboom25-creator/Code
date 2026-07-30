"""Deterministic synthetic-market provider.

**This provider generates simulated data.** It exists so the platform is fully
runnable and testable with no API keys and no network, and so tests have
reproducible fixtures. Every record it emits is stamped
``data_quality=SYNTHETIC`` and ``is_synthetic=True``; the API surfaces that flag
and the UI shows a permanent banner. Synthetic output must never be presented as
real market history.

The simulation is a three-factor model so that cross-sectional features are
meaningful rather than noise:

``market`` factor
    A regime-switching drift/vol process shared by all names. Produces genuine
    bull / chop / bear stretches, so regime classification and breadth features
    have something real to detect.
``sector`` factor
    Sector-level rotation, giving relative-strength and sector-leadership
    signals actual structure.
``idiosyncratic``
    Name-specific noise plus a slow fundamental-quality drift, so quality-growth
    ranking correlates with forward returns to a realistic (weak) degree.

Paths are generated from a fixed epoch and sliced, so the bars returned for a
symbol never depend on the requested window.
"""

from __future__ import annotations

import math
import zlib
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any

import numpy as np

from aegisquant.data.providers.base import (
    BarRecord,
    CalendarDayRecord,
    CalendarProvider,
    CorporateActionProvider,
    CorporateActionRecord,
    EconomicProvider,
    EconomicRecord,
    FundamentalRecord,
    FundamentalsProvider,
    InstrumentProvider,
    InstrumentRecord,
    NewsProvider,
    NewsRecord,
    PriceProvider,
    QuoteProvider,
    QuoteRecord,
    TradeProvider,
    TradeRecord,
)
from aegisquant.data.providers.calendar_static import build_calendar, trading_days
from aegisquant.db.enums import Adjustment, AssetClass, DataQuality
from aegisquant.utils.money import D
from aegisquant.utils.timeutil import as_of_from_bar_close, utcnow

EPOCH = date(2015, 1, 2)

# Demo universe: aggressive-growth oriented, sector-diversified. Symbols mirror
# real listings so the operator can flip to a live provider without remapping,
# but the *data* is simulated and flagged as such on every row.
DEMO_UNIVERSE: list[tuple[str, str, str, AssetClass]] = [
    # symbol, name, sector, asset class
    ("SPY", "S&P 500 ETF", "Broad Market", AssetClass.ETF),
    ("QQQ", "Nasdaq-100 ETF", "Broad Market", AssetClass.ETF),
    ("IWM", "Russell 2000 ETF", "Broad Market", AssetClass.ETF),
    ("NVDA", "NVIDIA", "Semiconductors", AssetClass.EQUITY),
    ("AMD", "Advanced Micro Devices", "Semiconductors", AssetClass.EQUITY),
    ("AVGO", "Broadcom", "Semiconductors", AssetClass.EQUITY),
    ("ASML", "ASML Holding", "Semiconductors", AssetClass.EQUITY),
    ("MSFT", "Microsoft", "Software", AssetClass.EQUITY),
    ("GOOGL", "Alphabet", "Software", AssetClass.EQUITY),
    ("SNOW", "Snowflake", "Software", AssetClass.EQUITY),
    ("DDOG", "Datadog", "Software", AssetClass.EQUITY),
    ("CRWD", "CrowdStrike", "Cybersecurity", AssetClass.EQUITY),
    ("PANW", "Palo Alto Networks", "Cybersecurity", AssetClass.EQUITY),
    ("ZS", "Zscaler", "Cybersecurity", AssetClass.EQUITY),
    ("ISRG", "Intuitive Surgical", "Robotics & Automation", AssetClass.EQUITY),
    ("ROK", "Rockwell Automation", "Robotics & Automation", AssetClass.EQUITY),
    ("REGN", "Regeneron", "Biotechnology", AssetClass.EQUITY),
    ("VRTX", "Vertex Pharmaceuticals", "Biotechnology", AssetClass.EQUITY),
    ("ENPH", "Enphase Energy", "Advanced Energy", AssetClass.EQUITY),
    ("FSLR", "First Solar", "Advanced Energy", AssetClass.EQUITY),
    ("CEG", "Constellation Energy", "Nuclear Energy", AssetClass.EQUITY),
    ("LEU", "Centrus Energy", "Nuclear Energy", AssetClass.EQUITY),
    ("LMT", "Lockheed Martin", "Aerospace & Defense", AssetClass.EQUITY),
    ("RTX", "RTX Corporation", "Aerospace & Defense", AssetClass.EQUITY),
    ("AXON", "Axon Enterprise", "Aerospace & Defense", AssetClass.EQUITY),
    ("V", "Visa", "Fintech", AssetClass.EQUITY),
    ("SQ", "Block", "Fintech", AssetClass.EQUITY),
    ("SHOP", "Shopify", "Disruptive Consumer", AssetClass.EQUITY),
    ("TSLA", "Tesla", "Disruptive Consumer", AssetClass.EQUITY),
    ("CELH", "Celsius Holdings", "Disruptive Consumer", AssetClass.EQUITY),
    ("VUG", "Growth ETF", "Broad Market", AssetClass.ETF),
    ("XLK", "Technology Sector ETF", "Software", AssetClass.ETF),
]

SECTORS = sorted({s for _, _, s, _ in DEMO_UNIVERSE})

# Symbols simulated as delisted / renamed so survivorship handling is exercised.
SYNTHETIC_DELISTINGS: dict[str, date] = {"XDLST": date(2022, 6, 15)}
SYNTHETIC_RENAMES: dict[str, tuple[str, date]] = {"XOLDN": ("XNEWN", date(2021, 9, 20))}

MACRO_SERIES = {
    "DGS10": ("10-Year Treasury Yield", "percent"),
    "DGS2": ("2-Year Treasury Yield", "percent"),
    "CPIAUCSL": ("CPI (all urban consumers, YoY)", "percent"),
    "BAMLH0A0HYM2": ("High-Yield Credit Spread", "percent"),
    "VIXCLS": ("CBOE Volatility Index", "index"),
    "UNRATE": ("Unemployment Rate", "percent"),
}


def _seed_for(*parts: Any) -> int:
    raw = "|".join(str(p) for p in parts).encode()
    return zlib.crc32(raw)


@lru_cache(maxsize=8)
def _market_path(seed: int, n_days: int) -> tuple[np.ndarray, np.ndarray]:
    """Regime-switching market factor. Returns (daily returns, regime labels)."""
    rng = np.random.default_rng(_seed_for(seed, "market"))
    # 0 = bull, 1 = chop, 2 = bear. Persistent, with realistic transition rates.
    trans = np.array([[0.985, 0.013, 0.002], [0.030, 0.950, 0.020], [0.020, 0.060, 0.920]])
    drift = np.array([0.00062, 0.00005, -0.00110])  # daily
    vol = np.array([0.0075, 0.0105, 0.0205])
    state = 0
    rets = np.empty(n_days)
    states = np.empty(n_days, dtype=int)
    for i in range(n_days):
        states[i] = state
        rets[i] = rng.normal(drift[state], vol[state])
        # occasional gap/shock day
        if rng.random() < 0.004:
            rets[i] += rng.normal(0.0, 0.035)
        state = int(rng.choice(3, p=trans[state]))
    return rets, states


@lru_cache(maxsize=64)
def _sector_path(seed: int, sector: str, n_days: int) -> np.ndarray:
    """Sector rotation as daily excess returns.

    The sector's *cumulative* excess is modelled as a mean-reverting
    Ornstein-Uhlenbeck level, and the emitted series is its first difference. A
    persistent level must never be used directly as a daily return: over a decade
    that compounds into a drift of many hundred-fold, which is how a simulator
    ends up quoting a $190,000 share price.
    """
    rng = np.random.default_rng(_seed_for(seed, "sector", sector))
    phi = 0.998
    target_std = 0.30  # sector cumulative excess stays within roughly ±30%
    sigma = target_std * float(np.sqrt(1 - phi**2))
    level = 0.0
    out = np.empty(n_days)
    for i in range(n_days):
        previous = level
        level = phi * level + rng.normal(0, sigma)
        out[i] = (level - previous) + rng.normal(0, 0.0035)
    return out


class _SymbolSim:
    """All simulated state for one symbol, derived deterministically from seed."""

    def __init__(self, seed: int, symbol: str, sector: str, asset_class: AssetClass) -> None:
        self.symbol = symbol
        self.sector = sector
        self.asset_class = asset_class
        self.rng = np.random.default_rng(_seed_for(seed, symbol))
        r = self.rng
        self.is_etf = asset_class is AssetClass.ETF
        self.beta = 1.0 if self.is_etf else float(np.clip(r.normal(1.15, 0.35), 0.35, 2.2))
        self.sector_beta = 0.4 if self.is_etf else float(np.clip(r.normal(1.0, 0.3), 0.2, 1.9))
        self.idio_vol = 0.004 if self.is_etf else float(np.clip(r.normal(0.016, 0.006), 0.006, 0.045))
        # Fundamental quality drives a small, persistent alpha — the thing the
        # quality-growth strategies are supposed to find.
        self.quality = float(np.clip(r.normal(0.0, 1.0), -2.5, 2.5))
        self.alpha = 0.0 if self.is_etf else self.quality * 0.00022
        self.start_price = float(np.clip(r.lognormal(3.6, 0.75), 6.0, 900.0))
        self.rev_growth = float(np.clip(r.normal(0.16, 0.16) + self.quality * 0.05, -0.20, 0.85))
        self.rev_accel = float(r.normal(0.0, 0.05))
        self.gross_margin = float(np.clip(r.normal(0.52, 0.16), 0.12, 0.90))
        self.op_margin = float(np.clip(self.gross_margin - abs(r.normal(0.30, 0.12)), -0.35, 0.45))
        self.debt_to_equity = float(np.clip(abs(r.normal(0.55, 0.5)), 0.0, 3.5))
        self.shares = float(np.clip(r.lognormal(20.0, 0.9), 2e7, 1.2e10))
        # Revenue is derived from the starting market cap and a plausible sales
        # multiple, so simulated valuation ratios land in a realistic range
        # instead of being an independent draw that can imply a 0.01x multiple.
        self.target_ps = float(np.clip(r.lognormal(1.25, 0.65), 0.4, 35.0))
        self.base_revenue = max(5e6, self.start_price * self.shares / self.target_ps)
        self.adv_shares = float(np.clip(r.lognormal(14.2, 1.3), 5e4, 1.2e8))
        self.spread_bps = float(np.clip(r.normal(6.0, 5.0), 0.6, 90.0))
        self.split_dates: list[tuple[date, float]] = []
        self.div_yield = 0.0 if r.random() < 0.55 else float(np.clip(r.normal(0.014, 0.01), 0.0, 0.06))

    # -- price path ----------------------------------------------------------
    def daily_returns(self, seed: int, n: int) -> np.ndarray:
        mkt, _ = _market_path(seed, n)
        sec = _sector_path(seed, self.sector, n)
        idio = np.random.default_rng(_seed_for(seed, self.symbol, "idio")).normal(0, self.idio_vol, n)
        rets = self.alpha + self.beta * mkt + self.sector_beta * sec + idio
        # Earnings-day jumps every ~63 sessions.
        jr = np.random.default_rng(_seed_for(seed, self.symbol, "jumps"))
        for i in range(55, n, 63):
            surprise = jr.normal(self.quality * 0.012, 0.055)
            rets[i] += surprise
        return rets


class FixtureProvider(
    PriceProvider,
    QuoteProvider,
    TradeProvider,
    CorporateActionProvider,
    FundamentalsProvider,
    NewsProvider,
    EconomicProvider,
    CalendarProvider,
    InstrumentProvider,
):
    """Simulated data for every provider interface. Never real market data."""

    name = "fixture"
    is_synthetic = True

    def __init__(self, seed: int | None = None) -> None:
        from aegisquant.config import get_settings

        self.seed = seed if seed is not None else get_settings().fixture_seed
        self._sims: dict[str, _SymbolSim] = {}
        self._meta = {sym: (nm, sec, ac) for sym, nm, sec, ac in DEMO_UNIVERSE}

    # ------------------------------------------------------------------
    def _sim(self, symbol: str) -> _SymbolSim:
        symbol = symbol.upper()
        sim = self._sims.get(symbol)
        if sim is None:
            name, sector, ac = self._meta.get(
                symbol, (symbol, SECTORS[_seed_for(symbol) % len(SECTORS)], AssetClass.EQUITY)
            )
            sim = _SymbolSim(self.seed, symbol, sector, ac)
            self._sims[symbol] = sim
        return sim

    def sector_of(self, symbol: str) -> str:
        return self._sim(symbol).sector

    def _sessions(self, end: date) -> list[date]:
        return trading_days(EPOCH, end)

    def _path(self, symbol: str, end: date) -> tuple[list[date], np.ndarray, np.ndarray]:
        """Full OHLCV path from EPOCH to ``end`` (split/dividend adjusted)."""
        sim = self._sim(symbol)
        sessions = self._sessions(end)
        n = len(sessions)
        if n == 0:
            return [], np.array([]), np.array([])
        rets = sim.daily_returns(self.seed, n)
        closes = sim.start_price * np.exp(np.cumsum(rets))
        vol_rng = np.random.default_rng(_seed_for(self.seed, symbol, "vol"))
        # Volume clusters with absolute return (real, well-documented effect).
        base = sim.adv_shares
        volumes = base * np.exp(vol_rng.normal(0, 0.35, n)) * (1 + 3.0 * np.abs(rets))
        return sessions, closes, volumes

    # -- PriceProvider -------------------------------------------------------
    def get_bars(
        self,
        symbol: str,
        start: date,
        end: date,
        timeframe: str = "1Day",
        adjustment: Adjustment = Adjustment.SPLIT_DIVIDEND,
    ) -> list[BarRecord]:
        symbol = symbol.upper()
        delisted = SYNTHETIC_DELISTINGS.get(symbol)
        if delisted and start > delisted:
            return []
        sessions, closes, volumes = self._path(symbol, min(end, delisted) if delisted else end)
        if not sessions:
            return []
        sim = self._sim(symbol)
        rng = np.random.default_rng(_seed_for(self.seed, symbol, "ohlc"))
        out: list[BarRecord] = []
        cal = {c.session_date: c for c in build_calendar(start, end)}
        horizon = sessions[-1]
        now = utcnow()
        for i, d in enumerate(sessions):
            if d < start or d > end:
                continue
            calendar_day = cal.get(d)
            early = bool(calendar_day.early_close) if calendar_day is not None else False
            bar_close = as_of_from_bar_close(d, early=early)
            # A daily bar does not exist until its session has closed. Emitting
            # today's bar mid-session would hand the consumer a close that has
            # not happened — the same look-ahead the rest of the platform is
            # built to prevent — and the validator rightly rejects it.
            if bar_close > now:
                continue
            # Emit RAW prices: the continuous path is scaled up by the product of
            # split ratios still ahead of this date, so a split produces a real
            # discontinuity. Back-adjusted history is deliberately *not* emitted,
            # because adjusting the past using a future split is itself a form of
            # look-ahead, and it hides whether the consumer handles splits at all.
            factor = self._forward_split_factor(symbol, d, horizon)
            prev_factor = self._forward_split_factor(symbol, sessions[i - 1], horizon) if i else factor
            close = float(closes[i]) * factor
            prev = (float(closes[i - 1]) * prev_factor) if i else close
            # Overnight gap, then intraday range around it.
            gap = float(rng.normal(0, sim.idio_vol * 0.6))
            # On a split ex-date the open reflects the post-split price, so the
            # gap is measured against the *adjusted* prior close.
            open_ = max(0.01, prev * (factor / prev_factor) * (1 + gap))
            hi = max(open_, close) * (1 + abs(float(rng.normal(0, sim.idio_vol * 0.8))))
            lo = min(open_, close) * (1 - abs(float(rng.normal(0, sim.idio_vol * 0.8))))
            lo = max(0.01, min(lo, open_, close))
            hi = max(hi, open_, close)
            vol = float(volumes[i]) / factor  # share counts scale inversely to price
            out.append(
                BarRecord(
                    symbol=symbol,
                    ts=bar_close,
                    open=D(round(open_, 4)),
                    high=D(round(hi, 4)),
                    low=D(round(lo, 4)),
                    close=D(round(close, 4)),
                    volume=D(int(vol)),
                    vwap=D(round((open_ + hi + lo + close) / 4, 4)),
                    trade_count=int(vol / 220),
                    timeframe=timeframe,
                    provenance=self.provenance(
                        symbol,
                        bar_close,
                        # Always RAW, whatever was requested: the simulator's
                        # canonical output is unadjusted, and mislabelling it
                        # would make the consumer double-count splits.
                        adjustment=Adjustment.RAW,
                        quality=DataQuality.SYNTHETIC,
                    ),
                )
            )
        return out

    def get_latest_bar(self, symbol: str, timeframe: str = "1Day") -> BarRecord | None:
        today = utcnow().date()
        bars = self.get_bars(symbol, today - timedelta(days=14), today, timeframe)
        return bars[-1] if bars else None

    # -- QuoteProvider -------------------------------------------------------
    def get_quote(self, symbol: str) -> QuoteRecord:
        bar = self.get_latest_bar(symbol)
        sim = self._sim(symbol)
        last = float(bar.close) if bar else sim.start_price
        half = last * (sim.spread_bps / 2 / 10_000)
        now = utcnow()
        return QuoteRecord(
            symbol=symbol.upper(),
            observed_at=now,
            bid=D(round(last - half, 4)),
            ask=D(round(last + half, 4)),
            bid_size=D(int(sim.adv_shares / 2000)),
            ask_size=D(int(sim.adv_shares / 2000)),
            last=D(round(last, 4)),
            provenance=self.provenance(symbol, now, quality=DataQuality.SYNTHETIC),
        )

    # -- TradeProvider -------------------------------------------------------
    def get_recent_trades(self, symbol: str, limit: int = 50) -> list[TradeRecord]:
        q = self.get_quote(symbol)
        rng = np.random.default_rng(_seed_for(self.seed, symbol, "trades"))
        now = utcnow()
        mid = float(q.mid or 0)
        out = []
        for i in range(limit):
            out.append(
                TradeRecord(
                    symbol=symbol.upper(),
                    observed_at=now - timedelta(seconds=i * 3),
                    price=D(round(mid * (1 + float(rng.normal(0, 0.0004))), 4)),
                    size=D(int(abs(rng.normal(200, 150)) + 1)),
                    exchange="SYNTH",
                    provenance=self.provenance(symbol, now, quality=DataQuality.SYNTHETIC),
                )
            )
        return out

    # -- CorporateActionProvider --------------------------------------------
    @lru_cache(maxsize=512)  # noqa: B019 - bounded by universe size
    def _split_events(self, symbol: str, end_year: int) -> tuple[tuple[date, float], ...]:
        """Split schedule for a symbol. Price-independent so it can be used to
        build the raw price path without recursing back into ``get_bars``."""
        rng = np.random.default_rng(_seed_for(self.seed, symbol.upper(), "corp"))
        out: list[tuple[date, float]] = []
        for year in range(EPOCH.year, end_year + 1):
            if rng.random() < 0.18:
                ex = date(year, int(rng.integers(2, 12)), int(rng.integers(1, 28)))
                # A real ex-date is always a trading day. Left on a weekend, the
                # price discontinuity prints on the following Monday while the
                # action is dated Sunday, and the validator then reports a
                # perfectly good split as an unexplained 67% move.
                while ex.weekday() >= 5:
                    ex += timedelta(days=1)
                ratio = float(rng.choice([2.0, 3.0, 4.0, 10.0], p=[0.55, 0.2, 0.2, 0.05]))
                out.append((ex, ratio))
        return tuple(out)

    def _forward_split_factor(self, symbol: str, d: date, end: date) -> float:
        """Product of split ratios with an ex-date after ``d``.

        Raw price on ``d`` equals the continuous (adjusted) price times this
        factor, which is what creates a genuine split discontinuity in the
        emitted series.
        """
        factor = 1.0
        for ex, ratio in self._split_events(symbol.upper(), end.year):
            if ex > d:
                factor *= ratio
        return factor

    def get_corporate_actions(self, symbol: str, start: date, end: date) -> list[CorporateActionRecord]:
        symbol = symbol.upper()
        sim = self._sim(symbol)
        out: list[CorporateActionRecord] = []
        for ex, ratio in self._split_events(symbol, end.year):
            if start <= ex <= end:
                out.append(
                    CorporateActionRecord(
                        symbol=symbol,
                        action_type="split",
                        ex_date=ex,
                        ratio=D(ratio),
                        provenance=self.provenance(symbol, as_of_from_bar_close(ex), quality=DataQuality.SYNTHETIC),
                    )
                )
        # Quarterly dividends for payers. Sized off the simulated starting price
        # scaled by the split factor, so no price lookup (and no recursion).
        if sim.div_yield > 0:
            for year in range(start.year, end.year + 1):
                for month in (3, 6, 9, 12):
                    ex = date(year, month, 15)
                    if not (start <= ex <= end):
                        continue
                    price = sim.start_price * self._forward_split_factor(symbol, ex, end)
                    out.append(
                        CorporateActionRecord(
                            symbol=symbol,
                            action_type="dividend",
                            ex_date=ex,
                            cash_amount=D(round(max(0.01, price * sim.div_yield / 4), 4)),
                            provenance=self.provenance(symbol, as_of_from_bar_close(ex), quality=DataQuality.SYNTHETIC),
                        )
                    )
        if symbol in SYNTHETIC_DELISTINGS:
            ex = SYNTHETIC_DELISTINGS[symbol]
            if start <= ex <= end:
                out.append(
                    CorporateActionRecord(
                        symbol=symbol,
                        action_type="delist",
                        ex_date=ex,
                        provenance=self.provenance(symbol, as_of_from_bar_close(ex), quality=DataQuality.SYNTHETIC),
                    )
                )
        if symbol in SYNTHETIC_RENAMES:
            new, ex = SYNTHETIC_RENAMES[symbol]
            if start <= ex <= end:
                out.append(
                    CorporateActionRecord(
                        symbol=symbol,
                        action_type="symbol_change",
                        ex_date=ex,
                        new_symbol=new,
                        provenance=self.provenance(symbol, as_of_from_bar_close(ex), quality=DataQuality.SYNTHETIC),
                    )
                )
        return sorted(out, key=lambda r: r.ex_date)

    # -- FundamentalsProvider ----------------------------------------------
    REPORTING_LAG_DAYS = 42  # publication delay: filings land weeks after period end

    # Deep default so a multi-year backtest has reported fundamentals available at
    # every historical evaluation date, not only near the present.
    def get_fundamentals(self, symbol: str, limit: int = 52) -> list[FundamentalRecord]:
        symbol = symbol.upper()
        sim = self._sim(symbol)
        if sim.is_etf:
            # An ETF has no income statement. Returning an empty list is the
            # honest answer; inventing one would let fundamental strategies
            # "analyse" a fund as though it were an operating company.
            return []
        today = utcnow().date()
        # Quarter ends going back ``limit`` quarters, only those already published.
        out: list[FundamentalRecord] = []
        q_ends: list[date] = []
        y, m = today.year, ((today.month - 1) // 3) * 3 + 3
        for _ in range(limit + 2):
            q_ends.append(date(y, m, [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]))
            m -= 3
            if m <= 0:
                m += 12
                y -= 1
        q_ends = sorted(q_ends)
        rng = np.random.default_rng(_seed_for(self.seed, symbol, "fund"))
        bars = self.get_bars(symbol, today - timedelta(days=400), today)
        last_close = float(bars[-1].close) if bars else sim.start_price

        for idx, pe in enumerate(q_ends):
            published = pe + timedelta(days=self.REPORTING_LAG_DAYS)
            if published > today:
                continue
            quarters_ago = len([q for q in q_ends if q > pe])
            g = sim.rev_growth + sim.rev_accel * (len(q_ends) - quarters_ago) / len(q_ends)
            rev = sim.base_revenue * ((1 + g / 4) ** idx) / 4
            rev_yoy = (1 + g) ** 1 - 1 + float(rng.normal(0, 0.03))
            gm = float(np.clip(sim.gross_margin + rng.normal(0, 0.012) + idx * 0.0008, 0.05, 0.95))
            om = float(np.clip(sim.op_margin + rng.normal(0, 0.015) + idx * 0.001, -0.6, 0.5))
            ni = rev * om * 0.78
            eps = ni / sim.shares
            ocf = ni * float(np.clip(rng.normal(1.25, 0.2), 0.4, 2.2))
            capex = rev * float(np.clip(abs(rng.normal(0.06, 0.03)), 0.005, 0.25))
            fcf = ocf - capex
            equity = max(rev * 1.2, 1.0)
            debt = equity * sim.debt_to_equity
            mcap = last_close * sim.shares
            out.append(
                FundamentalRecord(
                    symbol=symbol,
                    period_end=pe,
                    fiscal_period=f"Q{((pe.month - 1) // 3) + 1} {pe.year}",
                    provenance=self.provenance(
                        symbol,
                        datetime.combine(published, datetime.min.time()).replace(tzinfo=utcnow().tzinfo),
                        quality=DataQuality.SYNTHETIC,
                    ),
                    values={
                        "revenue": D(round(rev, 2)),
                        "revenue_yoy": D(round(rev_yoy, 6)),
                        "gross_profit": D(round(rev * gm, 2)),
                        "gross_margin": D(round(gm, 6)),
                        "operating_income": D(round(rev * om, 2)),
                        "operating_margin": D(round(om, 6)),
                        "net_income": D(round(ni, 2)),
                        "eps": D(round(eps, 4)),
                        "eps_yoy": D(round(rev_yoy + float(rng.normal(0.02, 0.05)), 6)),
                        "free_cash_flow": D(round(fcf, 2)),
                        "fcf_yoy": D(round(rev_yoy + float(rng.normal(0.0, 0.08)), 6)),
                        "operating_cash_flow": D(round(ocf, 2)),
                        "total_debt": D(round(debt, 2)),
                        "total_equity": D(round(equity, 2)),
                        "cash": D(round(equity * 0.28, 2)),
                        "debt_to_equity": D(round(sim.debt_to_equity, 6)),
                        "current_ratio": D(round(float(np.clip(rng.normal(2.1, 0.7), 0.4, 6.0)), 4)),
                        "roic": D(
                            round(
                                float(np.clip(om * 0.75 / max(0.2, sim.debt_to_equity + 0.6), -0.4, 0.6)),
                                6,
                            )
                        ),
                        "market_cap": D(round(mcap, 2)),
                        # Undefined for a loss-maker: emitting market cap as the
                        # P/E (which a max(x, 1) guard would do) is worse than
                        # emitting nothing, because it ranks as "expensive".
                        "pe_ratio": D(round(mcap / (ni * 4), 4)) if ni > 0 else None,
                        "ps_ratio": D(round(mcap / max(rev * 4, 1.0), 4)),
                        "ev_to_sales": D(round((mcap + debt) / max(rev * 4, 1.0), 4)),
                        "shares_outstanding": D(round(sim.shares, 0)),
                        "accruals_ratio": D(round((ni - ocf) / max(abs(rev), 1.0), 6)),
                        "recurring_revenue_pct": D(round(float(np.clip(rng.normal(0.55, 0.25), 0, 1)), 4)),
                        "rnd_expense": D(round(rev * float(np.clip(abs(rng.normal(0.11, 0.07)), 0, 0.45)), 2)),
                        "short_interest_pct": D(round(float(np.clip(abs(rng.normal(0.035, 0.03)), 0, 0.4)), 6)),
                        "insider_net_buy_usd": D(round(float(rng.normal(0, 4e6)), 2)),
                    },
                    raw={"simulated": True, "quality_factor": round(sim.quality, 3)},
                )
            )
        return out[-limit:]

    # -- NewsProvider --------------------------------------------------------
    # (template, event tag, base sentiment, relative frequency). Serious adverse
    # disclosures are rare on purpose — in reality a restatement is an unusual
    # event, and over-generating them would disqualify most of the universe.
    _HEADLINES = [
        ("{name} reports quarterly results above internal plan", "earnings", 0.45, 0.20),
        ("{name} announces expanded capacity at flagship facility", "capacity", 0.35, 0.13),
        ("{name} names new chief financial officer", "management", -0.05, 0.07),
        ("{name} wins multi-year contract with major customer", "customer_win", 0.55, 0.15),
        ("Regulator opens review of {name} business practices", "regulatory", -0.50, 0.04),
        ("{name} unveils next-generation product line", "product", 0.40, 0.17),
        (
            "Analysts revise {name} estimates following guidance update",
            "estimate_revision",
            0.25,
            0.15,
        ),
        ("{name} discloses restatement of prior-period figures", "accounting", -0.70, 0.01),
        ("{name} completes bolt-on acquisition", "m_and_a", 0.15, 0.06),
        ("Short seller publishes critical report on {name}", "short_report", -0.60, 0.02),
    ]

    def get_news(self, symbol: str, start: date | None = None, limit: int = 50) -> list[NewsRecord]:
        symbol = symbol.upper()
        name = self._meta.get(symbol, (symbol,))[0]
        today = utcnow().date()
        start = start or (today - timedelta(days=90))
        rng = np.random.default_rng(_seed_for(self.seed, symbol, "news", start.isoformat()))
        probs = np.array([h[3] for h in self._HEADLINES], dtype=float)
        probs = probs / probs.sum()
        out: list[NewsRecord] = []
        d = start
        seen: set[str] = set()
        while d <= today and len(out) < limit:
            if rng.random() < 0.16:
                tmpl, tag, base_sent, _freq = self._HEADLINES[int(rng.choice(len(self._HEADLINES), p=probs))]
                published = datetime.combine(d, datetime.min.time()).replace(
                    hour=int(rng.integers(11, 22)), tzinfo=utcnow().tzinfo
                )
                headline = tmpl.format(name=name)
                out.append(
                    NewsRecord(
                        symbol=symbol,
                        external_id=f"fixture-{symbol}-{d.isoformat()}-{tag}",
                        headline=headline,
                        summary=f"Simulated wire copy for {name}. Generated by the fixture provider.",
                        source=str(rng.choice(["SynthWire", "SimDaily", "MockStreet"])),
                        url=None,
                        published_at=published,
                        sentiment=D(round(float(np.clip(base_sent + rng.normal(0, 0.18), -1, 1)), 4)),
                        uncertainty=D(round(float(np.clip(abs(rng.normal(0.3, 0.18)), 0, 1)), 4)),
                        source_credibility=D(round(float(np.clip(rng.normal(0.65, 0.18), 0.05, 1)), 4)),
                        novelty=D(0.2 if tag in seen else 0.9),
                        event_tags=[tag],
                        provenance=self.provenance(symbol, published, quality=DataQuality.SYNTHETIC),
                    )
                )
                seen.add(tag)
            d += timedelta(days=1)
        return out

    # -- EconomicProvider ----------------------------------------------------
    def get_series(self, series_id: str, start: date, end: date) -> list[EconomicRecord]:
        if series_id not in MACRO_SERIES:
            return []
        label, unit = MACRO_SERIES[series_id]
        rng = np.random.default_rng(_seed_for(self.seed, "macro", series_id))
        anchors = {
            "DGS10": 3.9,
            "DGS2": 4.3,
            "CPIAUCSL": 3.1,
            "BAMLH0A0HYM2": 3.4,
            "VIXCLS": 16.0,
            "UNRATE": 4.0,
        }
        level = anchors[series_id]
        out: list[EconomicRecord] = []
        # Monthly series are released with a lag; daily rate series are same-day.
        monthly = series_id in ("CPIAUCSL", "UNRATE")
        d = EPOCH
        mkt, states = _market_path(self.seed, len(trading_days(EPOCH, end)))
        sessions = trading_days(EPOCH, end)
        state_by_date = dict(zip(sessions, states, strict=False))
        while d <= end:
            if monthly and d.day != 1:
                d += timedelta(days=1)
                continue
            if not monthly and d.weekday() >= 5:
                d += timedelta(days=1)
                continue
            stress = state_by_date.get(d, 1)
            drift = {"VIXCLS": 4.5 * stress, "BAMLH0A0HYM2": 0.9 * stress}.get(series_id, 0.0)
            level = level * 0.995 + 0.005 * (anchors[series_id] + drift) + float(rng.normal(0, 0.05))
            level = max(0.02, level)
            if d >= start:
                released = d + timedelta(days=14 if monthly else 0)
                out.append(
                    EconomicRecord(
                        series_id=series_id,
                        observation_date=d,
                        value=D(round(level, 4)),
                        label=label,
                        unit=unit,
                        provenance=self.provenance(
                            None,
                            datetime.combine(released, datetime.min.time()).replace(hour=13, tzinfo=utcnow().tzinfo),
                            quality=DataQuality.SYNTHETIC,
                        ),
                    )
                )
            d += timedelta(days=1)
        return out

    # -- CalendarProvider ----------------------------------------------------
    def get_calendar(self, start: date, end: date) -> list[CalendarDayRecord]:
        return build_calendar(start, end)

    # -- InstrumentProvider --------------------------------------------------
    def list_instruments(self, symbols: list[str] | None = None) -> list[InstrumentRecord]:
        wanted = [s.upper() for s in symbols] if symbols else [s for s, _, _, _ in DEMO_UNIVERSE]
        now = utcnow()
        out: list[InstrumentRecord] = []
        for sym in wanted:
            name, sector, ac = self._meta.get(sym, (sym, self.sector_of(sym), AssetClass.EQUITY))
            sim = self._sim(sym)
            out.append(
                InstrumentRecord(
                    symbol=sym,
                    name=name,
                    asset_class=ac,
                    exchange="SYNTH",
                    sector=sector,
                    industry=sector,
                    tradable=True,
                    fractionable=not sim.is_etf or True,
                    shortable=sim.adv_shares > 1e6,
                    easy_to_borrow=sim.adv_shares > 5e6,
                    is_leveraged_etf=False,
                    delisted_on=SYNTHETIC_DELISTINGS.get(sym),
                    renamed_to=SYNTHETIC_RENAMES.get(sym, (None, None))[0],
                    provenance=self.provenance(sym, now, quality=DataQuality.SYNTHETIC),
                )
            )
        return out

    # ------------------------------------------------------------------
    def market_regime_states(self, end: date) -> dict[date, int]:
        """Ground-truth regime labels — used only by tests, never by strategies."""
        sessions = trading_days(EPOCH, end)
        _, states = _market_path(self.seed, len(sessions))
        return dict(zip(sessions, (int(s) for s in states), strict=False))

    def health(self) -> dict[str, Any]:
        return {
            "provider": self.name,
            "ok": True,
            "synthetic": True,
            "warning": "SIMULATED DATA — not real market history",
            "seed": self.seed,
            "universe": len(DEMO_UNIVERSE),
        }


def _unused_math_guard() -> float:  # pragma: no cover
    return math.nan
