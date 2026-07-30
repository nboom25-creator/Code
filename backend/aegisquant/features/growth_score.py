"""The Growth Opportunity Score.

Five components, each 0-100, combined into one headline number. The components
are always reported alongside the total, and any serious weakness is surfaced as
an explicit flag rather than being averaged away — a single number that hides an
accounting problem or a liquidity problem is worse than no number at all.

============================  ======  =============================================
Component                     Weight  What it measures
============================  ======  =============================================
fundamental_acceleration       0.30   Is the business improving *and* accelerating?
price_strength                 0.30   Is the market confirming it?
durability                     0.15   Can the growth persist?
catalyst                       0.10   Is there a credible near-term driver?
risk_valuation                 0.15   What could go wrong, and what is priced in?
============================  ======  =============================================

``risk_valuation`` is oriented so that higher is safer, letting the weighted sum
read consistently as "better".

Disqualifiers are separate from the score. A name can score 90 and still be
un-buyable because of an accounting flag or insufficient liquidity; the strategy
layer reads ``disqualifiers`` before it reads ``total``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

COMPONENT_WEIGHTS = {
    "fundamental_acceleration": 0.30,
    "price_strength": 0.30,
    "durability": 0.15,
    "catalyst": 0.10,
    "risk_valuation": 0.15,
}


@dataclass(slots=True)
class ScoreComponent:
    name: str
    score: float | None  # 0-100
    inputs: dict[str, float | None] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "score": None if self.score is None else round(self.score, 2),
            "inputs": {k: (None if v is None else round(v, 6)) for k, v in self.inputs.items()},
            "missing": self.missing,
            "notes": self.notes,
        }


@dataclass(slots=True)
class GrowthScore:
    symbol: str
    total: float | None
    components: dict[str, ScoreComponent]
    disqualifiers: list[str] = field(default_factory=list)
    weaknesses: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    coverage: float = 0.0  # share of inputs that were available

    @property
    def investable(self) -> bool:
        return not self.disqualifiers and self.total is not None

    def as_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "total": None if self.total is None else round(self.total, 2),
            "components": {k: v.as_dict() for k, v in self.components.items()},
            "component_weights": COMPONENT_WEIGHTS,
            "disqualifiers": self.disqualifiers,
            "weaknesses": self.weaknesses,
            "strengths": self.strengths,
            "coverage": round(self.coverage, 3),
            "investable": self.investable,
        }


# ---------------------------------------------------------------------------
def _scale(value: float | None, low: float, high: float, invert: bool = False) -> float | None:
    """Map ``value`` onto 0-100 across [low, high], clipped."""
    if value is None:
        return None
    if high == low:
        return 50.0
    pct = (value - low) / (high - low)
    pct = float(np.clip(pct, 0.0, 1.0))
    return (1.0 - pct) * 100 if invert else pct * 100


def _blend(parts: dict[str, float | None], weights: dict[str, float]) -> float | None:
    """Weighted mean over the sub-scores that exist. ``None`` if none do."""
    num = den = 0.0
    for key, score in parts.items():
        if score is None:
            continue
        w = weights.get(key, 1.0)
        num += score * w
        den += w
    if den <= 0:
        return None
    return num / den


# ---------------------------------------------------------------------------
def _fundamental_acceleration(f: dict[str, float | None]) -> ScoreComponent:
    parts = {
        "revenue_growth_yoy": _scale(f.get("revenue_growth_yoy"), -0.05, 0.60),
        "revenue_growth_accel": _scale(f.get("revenue_growth_accel"), -0.08, 0.12),
        "eps_growth_yoy": _scale(f.get("eps_growth_yoy"), -0.15, 0.75),
        "eps_growth_accel": _scale(f.get("eps_growth_accel"), -0.25, 0.35),
        "fcf_growth_yoy": _scale(f.get("fcf_growth_yoy"), -0.30, 0.80),
        "gross_margin_delta_yoy": _scale(f.get("gross_margin_delta_yoy"), -0.03, 0.05),
        "operating_leverage": _scale(f.get("operating_leverage"), 0.5, 3.0),
        "roic": _scale(f.get("roic"), -0.05, 0.35),
        "fundamental_momentum": _scale(f.get("fundamental_momentum"), -1.5, 2.0),
    }
    weights = {
        "revenue_growth_yoy": 1.0,
        "revenue_growth_accel": 1.6,
        "eps_growth_yoy": 1.0,
        "eps_growth_accel": 1.3,
        "fcf_growth_yoy": 0.9,
        "gross_margin_delta_yoy": 1.2,
        "operating_leverage": 0.8,
        "roic": 1.0,
        "fundamental_momentum": 1.2,
    }
    comp = ScoreComponent(
        "fundamental_acceleration",
        _blend(parts, weights),
        inputs={k: f.get(k) for k in parts},
        missing=[k for k, v in parts.items() if v is None],
    )
    if f.get("revenue_growth_accel") is not None and f["revenue_growth_accel"] < -0.05:
        comp.notes.append("revenue growth is decelerating")
    if f.get("gross_margin_delta_yoy") is not None and f["gross_margin_delta_yoy"] < -0.02:
        comp.notes.append("gross margin is contracting year over year")
    return comp


def _price_strength(f: dict[str, float | None]) -> ScoreComponent:
    parts = {
        "rel_strength_63": _scale(f.get("rel_strength_63"), -0.15, 0.30),
        "rel_strength_126": _scale(f.get("rel_strength_126"), -0.20, 0.50),
        "rel_strength_252": _scale(f.get("rel_strength_252"), -0.30, 0.80),
        "trend_quality_126": _scale(f.get("trend_quality_126"), 0.15, 0.90),
        "vol_adj_momentum_126": _scale(f.get("vol_adj_momentum_126"), -0.5, 2.5),
        "breakout_55": _scale(f.get("breakout_55"), -0.15, 0.03),
        "dist_52w_high": _scale(f.get("dist_52w_high"), -0.40, -0.01),
        "accumulation_20": _scale(f.get("accumulation_20"), -0.35, 0.45),
        "obv_slope_63": _scale(f.get("obv_slope_63"), -0.5, 1.2),
        "sector_rel_strength_126": _scale(f.get("sector_rel_strength_126"), -0.20, 0.35),
        "recovery_speed_63": _scale(f.get("recovery_speed_63"), 0.2, 1.0),
    }
    weights = {
        "rel_strength_63": 1.0,
        "rel_strength_126": 1.6,
        "rel_strength_252": 1.2,
        "trend_quality_126": 1.3,
        "vol_adj_momentum_126": 1.4,
        "breakout_55": 1.0,
        "dist_52w_high": 0.9,
        "accumulation_20": 1.1,
        "obv_slope_63": 0.8,
        "sector_rel_strength_126": 1.0,
        "recovery_speed_63": 0.7,
    }
    comp = ScoreComponent(
        "price_strength",
        _blend(parts, weights),
        inputs={k: f.get(k) for k in parts},
        missing=[k for k, v in parts.items() if v is None],
    )
    if f.get("trend_quality_126") is not None and f["trend_quality_126"] < 0.25:
        comp.notes.append("the uptrend is low quality (noisy, not persistent)")
    if f.get("accumulation_20") is not None and f["accumulation_20"] < -0.15:
        comp.notes.append("distribution rather than accumulation on volume")
    return comp


def _durability(f: dict[str, float | None]) -> ScoreComponent:
    parts = {
        "gross_margin": _scale(f.get("gross_margin"), 0.15, 0.75),
        "recurring_revenue_pct": _scale(f.get("recurring_revenue_pct"), 0.10, 0.85),
        "roic": _scale(f.get("roic"), -0.05, 0.35),
        "net_cash_to_mcap": _scale(f.get("net_cash_to_mcap"), -0.35, 0.20),
        "debt_to_equity": _scale(f.get("debt_to_equity"), 0.0, 2.5, invert=True),
        "current_ratio": _scale(f.get("current_ratio"), 0.8, 3.0),
        "rnd_intensity": _scale(f.get("rnd_intensity"), 0.0, 0.22),
        "fcf_margin": _scale(f.get("fcf_margin"), -0.15, 0.30),
        "dilution_1y": _scale(f.get("dilution_1y"), 0.0, 0.15, invert=True),
    }
    weights = {
        "gross_margin": 1.2,
        "recurring_revenue_pct": 1.1,
        "roic": 1.3,
        "net_cash_to_mcap": 1.0,
        "debt_to_equity": 1.2,
        "current_ratio": 0.8,
        "rnd_intensity": 0.6,
        "fcf_margin": 1.1,
        "dilution_1y": 0.9,
    }
    comp = ScoreComponent(
        "durability",
        _blend(parts, weights),
        inputs={k: f.get(k) for k in parts},
        missing=[k for k, v in parts.items() if v is None],
    )
    if f.get("dilution_1y") is not None and f["dilution_1y"] > 0.10:
        comp.notes.append("shares outstanding grew >10% — growth is partly issuance-funded")
    if f.get("debt_to_equity") is not None and f["debt_to_equity"] > 2.0:
        comp.notes.append("leverage is high relative to equity")
    return comp


def _catalyst(f: dict[str, float | None]) -> ScoreComponent:
    parts = {
        "pead_drift_20": _scale(f.get("pead_drift_20"), -0.08, 0.15),
        "earnings_gap_pct": _scale(f.get("earnings_gap_pct"), -0.06, 0.10),
        "news_sentiment_7": _scale(f.get("news_sentiment_7"), -0.5, 0.6),
        "news_sentiment_trend": _scale(f.get("news_sentiment_trend"), -0.4, 0.4),
        "news_novelty_max_7": _scale(f.get("news_novelty_max_7"), 0.1, 0.9),
        "volume_ratio_20": _scale(f.get("volume_ratio_20"), 0.8, 2.5),
        "breakout_252": _scale(f.get("breakout_252"), -0.20, 0.02),
        "insider_net_buy_usd": _scale(f.get("insider_net_buy_usd"), -2e6, 5e6),
    }
    weights = {
        "pead_drift_20": 1.4,
        "earnings_gap_pct": 1.0,
        "news_sentiment_7": 0.9,
        "news_sentiment_trend": 0.8,
        "news_novelty_max_7": 0.7,
        "volume_ratio_20": 1.1,
        "breakout_252": 1.2,
        "insider_net_buy_usd": 0.8,
    }
    comp = ScoreComponent(
        "catalyst",
        _blend(parts, weights),
        inputs={k: f.get(k) for k in parts},
        missing=[k for k, v in parts.items() if v is None],
    )
    if not [v for v in parts.values() if v is not None]:
        comp.notes.append("no catalyst evidence available at this time")
    return comp


def _risk_valuation(f: dict[str, float | None]) -> ScoreComponent:
    """Higher score = lower risk / more supportable valuation."""
    parts = {
        "growth_adjusted_ps": _scale(f.get("growth_adjusted_ps"), 0.05, 0.60, invert=True),
        "ps_ratio": _scale(f.get("ps_ratio"), 1.0, 30.0, invert=True),
        "accruals_ratio": _scale(f.get("accruals_ratio"), -0.05, 0.15, invert=True),
        "fcf_conversion": _scale(f.get("fcf_conversion"), 0.2, 1.5),
        "short_interest_pct": _scale(f.get("short_interest_pct"), 0.02, 0.20, invert=True),
        "gap_risk_63": _scale(f.get("gap_risk_63"), 0.005, 0.05, invert=True),
        "realized_vol_63": _scale(f.get("realized_vol_63"), 0.20, 0.95, invert=True),
        "downside_capture_252": _scale(f.get("downside_capture_252"), 0.6, 2.0, invert=True),
        "drawdown_252": _scale(f.get("drawdown_252"), -0.55, -0.05),
        "adv_usd_20": _scale(
            None if f.get("adv_usd_20") is None else float(np.log10(max(f["adv_usd_20"], 1.0))),
            5.7,  # ~$500k/day
            8.5,  # ~$300m/day
        ),
    }
    weights = {
        "growth_adjusted_ps": 1.4,
        "ps_ratio": 0.8,
        "accruals_ratio": 1.4,
        "fcf_conversion": 1.1,
        "short_interest_pct": 0.9,
        "gap_risk_63": 0.9,
        "realized_vol_63": 1.0,
        "downside_capture_252": 0.9,
        "drawdown_252": 0.8,
        "adv_usd_20": 1.3,
    }
    comp = ScoreComponent(
        "risk_valuation",
        _blend(parts, weights),
        inputs={k: f.get(k) for k in parts},
        missing=[k for k, v in parts.items() if v is None],
    )
    if f.get("accruals_ratio") is not None and f["accruals_ratio"] > 0.10:
        comp.notes.append("high accruals — reported earnings are not converting to cash")
    if f.get("growth_adjusted_ps") is None and f.get("ps_ratio") is not None:
        comp.notes.append("growth-adjusted valuation undefined (growth is not positive)")
    return comp


# ---------------------------------------------------------------------------
#: Hard exclusions from the aggressive-growth mandate. These are not score
#: penalties — they remove the name from consideration entirely.
def _disqualifiers(
    f: dict[str, float | None],
    *,
    min_price: float,
    min_adv_usd: float,
    max_spread_bps: float | None,
    instrument: dict[str, Any],
) -> list[str]:
    out: list[str] = []
    if instrument.get("is_leveraged_etf"):
        out.append("leveraged/inverse ETF — excluded in version 1")
    if instrument.get("tradable") is False:
        out.append("instrument is not tradable at the broker")
    if instrument.get("delisted_on"):
        out.append("instrument is delisted")
    if instrument.get("data_quality") in ("corrupt", "suspect"):
        out.append(f"unreliable pricing data (quality={instrument.get('data_quality')})")

    price = f.get("last_price")
    if price is not None and price < min_price:
        out.append(f"price ${price:,.2f} is below the ${min_price:,.2f} floor (penny-stock exclusion)")

    adv = f.get("adv_usd_20")
    if adv is not None and adv < min_adv_usd:
        out.append(f"20-day ADV ${adv:,.0f} is below the ${min_adv_usd:,.0f} liquidity floor")
    elif adv is None:
        out.append("liquidity could not be measured")

    if max_spread_bps is not None and f.get("spread_bps") is not None and f["spread_bps"] > max_spread_bps:
        out.append(f"quoted spread {f['spread_bps']:.0f}bps exceeds the {max_spread_bps:.0f}bps limit")

    if f.get("has_accounting_flag_90") == 1.0:
        out.append("unresolved accounting or restatement disclosure in the last 90 days")

    # Pump-and-dump shape: a vertical move on a huge volume spike in a name with
    # no fundamental support and a low price.
    vol_ratio = f.get("volume_ratio_20")
    trend_20 = f.get("trend_20")
    growth = f.get("revenue_growth_yoy")
    if (
        vol_ratio is not None
        and trend_20 is not None
        and vol_ratio > 6.0
        and trend_20 > 0.45
        and (growth is None or growth < 0.05)
        and (price is None or price < 15.0)
    ):
        out.append("pump-and-dump pattern: vertical move on extreme volume with no revenue growth to support it")

    if (
        f.get("periods_available") is not None
        and f["periods_available"] < 2
        and instrument.get("asset_class") not in ("etf",)
    ):
        out.append("fewer than two reported fiscal periods available — insufficient fundamental history")
    return out


def compute_growth_score(
    symbol: str,
    features: dict[str, float | None],
    *,
    instrument: dict[str, Any] | None = None,
    min_price: float = 5.0,
    min_adv_usd: float = 5_000_000.0,
    max_spread_bps: float | None = 50.0,
) -> GrowthScore:
    """Combine a feature dict into the Growth Opportunity Score."""
    instrument = instrument or {}
    is_etf = instrument.get("asset_class") == "etf"

    components = {
        "fundamental_acceleration": _fundamental_acceleration(features),
        "price_strength": _price_strength(features),
        "durability": _durability(features),
        "catalyst": _catalyst(features),
        "risk_valuation": _risk_valuation(features),
    }

    weights = dict(COMPONENT_WEIGHTS)
    if is_etf:
        # An index or thematic ETF has no company fundamentals; reweight onto
        # what is actually measurable instead of scoring it as if data were missing.
        weights = {
            "fundamental_acceleration": 0.0,
            "price_strength": 0.60,
            "durability": 0.05,
            "catalyst": 0.15,
            "risk_valuation": 0.20,
        }

    total = _blend({k: c.score for k, c in components.items()}, weights)

    all_inputs = [v for c in components.values() for v in c.inputs.values()]
    coverage = sum(1 for v in all_inputs if v is not None) / len(all_inputs) if all_inputs else 0.0

    disq = _disqualifiers(
        features,
        min_price=min_price,
        min_adv_usd=min_adv_usd,
        max_spread_bps=max_spread_bps,
        instrument=instrument,
    )
    if is_etf:
        disq = [d for d in disq if "reported fiscal periods" not in d]

    weaknesses = [note for c in components.values() for note in c.notes]
    for name, comp in components.items():
        if comp.score is not None and comp.score < 30 and weights.get(name, 0) > 0:
            weaknesses.append(f"{name.replace('_', ' ')} scores only {comp.score:.0f}/100")
        if comp.score is None and weights.get(name, 0) > 0:
            weaknesses.append(f"{name.replace('_', ' ')} could not be evaluated (no data)")

    strengths = [
        f"{name.replace('_', ' ')} scores {comp.score:.0f}/100"
        for name, comp in components.items()
        if comp.score is not None and comp.score >= 70 and weights.get(name, 0) > 0
    ]

    # Low coverage is a real limitation, not something to paper over.
    if coverage < 0.35:
        weaknesses.append(f"only {coverage:.0%} of scoring inputs were available")

    return GrowthScore(
        symbol=symbol,
        total=total,
        components=components,
        disqualifiers=disq,
        weaknesses=weaknesses,
        strengths=strengths,
        coverage=coverage,
    )
