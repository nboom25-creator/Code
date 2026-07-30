"""Macro and regime features (market level).

Macro series are read through the release timestamp, so a CPI print is invisible
until it was published — the single most common source of accidental look-ahead
in macro-aware backtests.

Series identifiers follow FRED conventions so the same code works against the
FRED provider and the fixture simulator.
"""

from __future__ import annotations

import numpy as np

from aegisquant.features.market_structure import breadth_above_200sma
from aegisquant.features.market_view import PointInTime

TEN_YEAR = "DGS10"
TWO_YEAR = "DGS2"
INFLATION = "CPIAUCSL"
CREDIT = "BAMLH0A0HYM2"
VIX = "VIXCLS"


def rate_10y(pit: PointInTime) -> float | None:
    return pit.macro_latest(TEN_YEAR)


def rate_2y(pit: PointInTime) -> float | None:
    return pit.macro_latest(TWO_YEAR)


def yield_curve_slope(pit: PointInTime) -> float | None:
    ten, two = rate_10y(pit), rate_2y(pit)
    if ten is None or two is None:
        return None
    return ten - two


def rate_change_63d(pit: PointInTime) -> float | None:
    hist = pit.macro_history(TEN_YEAR, 64)
    if hist.size < 20:
        return None
    return float(hist[-1] - hist[0])


def inflation_level(pit: PointInTime) -> float | None:
    return pit.macro_latest(INFLATION)


def inflation_trend(pit: PointInTime) -> float | None:
    hist = pit.macro_history(INFLATION, 5)
    if hist.size < 3:
        return None
    return float(hist[-1] - hist[0])


def credit_spread(pit: PointInTime) -> float | None:
    return pit.macro_latest(CREDIT)


def credit_spread_change_63d(pit: PointInTime) -> float | None:
    hist = pit.macro_history(CREDIT, 64)
    if hist.size < 20:
        return None
    return float(hist[-1] - hist[0])


def vix_level(pit: PointInTime) -> float | None:
    return pit.macro_latest(VIX)


def vix_percentile_252(pit: PointInTime) -> float | None:
    hist = pit.macro_history(VIX, 252)
    if hist.size < 60:
        return None
    return float((hist <= hist[-1]).mean())


def index_trend_200(pit: PointInTime) -> float | None:
    closes = pit.closes(pit.benchmark, 200)
    if closes.size < 200:
        return None
    sma = float(np.mean(closes))
    if sma <= 0:
        return None
    return float(closes[-1] / sma - 1.0)


def index_above_200sma(pit: PointInTime) -> float | None:
    trend = index_trend_200(pit)
    return None if trend is None else (1.0 if trend > 0 else 0.0)


def index_drawdown(pit: PointInTime) -> float | None:
    closes = pit.closes(pit.benchmark, 253)
    if closes.size < 60:
        return None
    high = float(np.max(closes))
    if high <= 0:
        return None
    return float(closes[-1] / high - 1.0)


def _index_vol(pit: PointInTime) -> float | None:
    closes = pit.closes(pit.benchmark, 22)
    if closes.size < 15:
        return None
    rets = np.diff(np.log(closes))
    return float(np.std(rets, ddof=1) * np.sqrt(252))


def risk_on_score(pit: PointInTime) -> float | None:
    """Composite risk appetite in [-1, 1].

    Built from four independent legs — index trend, volatility, credit and
    breadth — averaged over whichever are available. Requires at least two legs,
    so a single missing macro series cannot swing the regime call.
    """
    legs: list[float] = []
    weights: list[float] = []

    trend = index_trend_200(pit)
    if trend is not None:
        legs.append(float(np.clip(trend / 0.08, -1, 1)))
        weights.append(0.35)

    vix_pct = vix_percentile_252(pit)
    if vix_pct is not None:
        legs.append(float(np.clip(1.0 - 2.0 * vix_pct, -1, 1)))
        weights.append(0.25)
    else:
        realized = _index_vol(pit)
        if realized is not None:
            legs.append(float(np.clip((0.18 - realized) / 0.12, -1, 1)))
            weights.append(0.25)

    credit_delta = credit_spread_change_63d(pit)
    if credit_delta is not None:
        legs.append(float(np.clip(-credit_delta / 1.0, -1, 1)))
        weights.append(0.20)

    breadth = breadth_above_200sma(pit)
    if breadth is not None:
        legs.append(float(np.clip((breadth - 0.5) * 3.0, -1, 1)))
        weights.append(0.20)

    if len(legs) < 2:
        return None
    total = sum(weights)
    return float(np.clip(sum(v * w for v, w in zip(legs, weights, strict=True)) / total, -1, 1))


MARKET_FEATURES = {
    "rate_10y": rate_10y,
    "rate_2y": rate_2y,
    "yield_curve_slope": yield_curve_slope,
    "rate_change_63d": rate_change_63d,
    "inflation_level": inflation_level,
    "inflation_trend": inflation_trend,
    "credit_spread": credit_spread,
    "credit_spread_change_63d": credit_spread_change_63d,
    "vix_level": vix_level,
    "vix_percentile_252": vix_percentile_252,
    "index_trend_200": index_trend_200,
    "index_above_200sma": index_above_200sma,
    "index_drawdown": index_drawdown,
    "risk_on_score": risk_on_score,
}
