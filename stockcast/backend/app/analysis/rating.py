"""Transparent multi-component research rating.

The rating is a weighted sum of independently-scored components, each in
[-1, 1]. Every component's weight and contribution is returned so the UI can
show exactly why a stock is rated the way it is. A model predicting a price
increase is only ONE component — it can never, by itself, produce a Buy.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.analysis import indicators as ind
from app.schemas import (
    Forecast,
    Fundamentals,
    RatingComponent,
    ResearchRating,
    RiskAnalysis,
)

# Component weights (sum to 1.0).
WEIGHTS = {
    "Trend & momentum": 0.16,
    "Financial health": 0.14,
    "Growth": 0.14,
    "Valuation": 0.14,
    "Estimate revisions": 0.06,
    "News sentiment": 0.08,
    "Volatility & downside risk": 0.10,
    "Model forecast": 0.10,
    "Model reliability": 0.08,
}


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return float(max(lo, min(hi, x)))


def _trend_score(df: pd.DataFrame) -> tuple[float, str]:
    price = df["adj_close"].astype(float)
    sma50 = ind.sma(price, 50).iloc[-1]
    sma200 = ind.sma(price, 200).iloc[-1]
    mom = ind.momentum(price, 63).iloc[-1]
    parts = []
    score = 0.0
    if not np.isnan(sma50) and not np.isnan(sma200):
        above = (price.iloc[-1] > sma50) + (sma50 > sma200)
        score += (above - 1) * 0.5  # -0.5..0.5
        parts.append("50/200 SMA alignment")
    if not np.isnan(mom):
        score += _clamp(mom * 3)  # scale 3-month momentum
        parts.append(f"3-month momentum {mom:+.1%}")
    return _clamp(score), ", ".join(parts) or "insufficient history"


def _financial_health(f: Fundamentals | None) -> tuple[float, str]:
    if not f:
        return 0.0, "fundamentals unavailable from provider"
    score = 0.0
    n = 0
    detail = []
    if f.net_margin is not None:
        score += _clamp((f.net_margin - 0.05) / 0.20); n += 1
        detail.append(f"net margin {f.net_margin:.1%}")
    if f.total_debt is not None and f.total_cash is not None and f.total_cash > 0:
        ratio = f.total_debt / f.total_cash
        score += _clamp((1.5 - ratio) / 1.5); n += 1
        detail.append(f"debt/cash {ratio:.1f}x")
    if f.free_cash_flow is not None:
        score += _clamp(np.sign(f.free_cash_flow) * 0.5); n += 1
        detail.append("positive FCF" if f.free_cash_flow > 0 else "negative FCF")
    if n == 0:
        return 0.0, "insufficient fundamental fields"
    return _clamp(score / n), ", ".join(detail)


def _growth(f: Fundamentals | None) -> tuple[float, str]:
    if not f:
        return 0.0, "fundamentals unavailable"
    vals = []
    detail = []
    if f.revenue_growth_yoy is not None:
        vals.append(_clamp(f.revenue_growth_yoy / 0.25)); detail.append(f"revenue +{f.revenue_growth_yoy:.1%}" if f.revenue_growth_yoy >= 0 else f"revenue {f.revenue_growth_yoy:.1%}")
    if f.earnings_growth_yoy is not None:
        vals.append(_clamp(f.earnings_growth_yoy / 0.30)); detail.append(f"earnings {f.earnings_growth_yoy:+.1%}")
    if not vals:
        return 0.0, "growth data unavailable"
    return _clamp(float(np.mean(vals))), ", ".join(detail)


def _valuation(f: Fundamentals | None) -> tuple[float, str]:
    if not f:
        return 0.0, "fundamentals unavailable"
    vals = []
    detail = []
    # Cheaper valuation -> higher (more positive) score.
    if f.pe_ratio is not None and f.pe_ratio > 0:
        vals.append(_clamp((25 - f.pe_ratio) / 25)); detail.append(f"P/E {f.pe_ratio:.0f}")
    if f.price_to_sales is not None and f.price_to_sales > 0:
        vals.append(_clamp((6 - f.price_to_sales) / 6)); detail.append(f"P/S {f.price_to_sales:.1f}")
    if f.peg_ratio is not None and f.peg_ratio > 0:
        vals.append(_clamp((2 - f.peg_ratio) / 2)); detail.append(f"PEG {f.peg_ratio:.1f}")
    if not vals:
        return 0.0, "valuation ratios unavailable"
    return _clamp(float(np.mean(vals))), ", ".join(detail)


def _estimate_revisions(f: Fundamentals | None) -> tuple[float, str]:
    # Proxy: forward P/E below trailing P/E implies expected earnings growth.
    if not f or f.pe_ratio is None or f.forward_pe is None or f.forward_pe <= 0:
        return 0.0, "analyst estimate data unavailable from provider"
    ratio = f.pe_ratio / f.forward_pe - 1
    return _clamp(ratio * 2), f"forward vs trailing P/E implies {'improving' if ratio>0 else 'declining'} earnings"


def _sentiment_score(avg_sentiment: float | None) -> tuple[float, str]:
    if avg_sentiment is None:
        return 0.0, "no news available"
    return _clamp(avg_sentiment * 1.5), f"avg headline sentiment {avg_sentiment:+.2f}"


def _risk_score(risk: RiskAnalysis) -> tuple[float, str]:
    # Higher volatility / deeper drawdown -> more negative.
    vol_pen = _clamp((0.30 - risk.annualized_volatility) / 0.30)
    dd_pen = _clamp((risk.max_drawdown_5y + 0.5) / 0.5)  # -50% dd -> 0
    score = _clamp((vol_pen + dd_pen) / 2)
    return score, f"annualised vol {risk.annualized_volatility:.0%}, max 5y drawdown {risk.max_drawdown_5y:.0%}"


def _model_forecast_score(forecast: Forecast) -> tuple[float, str]:
    # Use the 1-month base expected return, scaled.
    pt = next((h for h in forecast.horizons if h.horizon_days == 21), None)
    if not pt:
        return 0.0, "no forecast"
    return _clamp(pt.expected_return_pct / 8.0), f"1-month base forecast {pt.expected_return_pct:+.1f}%"


def _model_reliability(forecast: Forecast) -> tuple[float, str]:
    sel = next((m for m in forecast.validation if m.model == forecast.selected_model), None)
    if not sel or sel.n_folds == 0:
        return -0.2, "model not validated for this ticker/horizon (treated cautiously)"
    # Directional accuracy above 0.5 and positive skill increase reliability.
    da = (sel.directional_accuracy - 0.5) * 2  # -1..1
    skill = _clamp(sel.skill_vs_naive * 2)
    score = _clamp(0.6 * da + 0.4 * skill)
    return score, f"validation directional acc {sel.directional_accuracy:.0%}, skill vs naive {sel.skill_vs_naive:+.2f}"


def _rating_bucket(score: float) -> str:
    if score >= 0.35:
        return "Buy"
    if score >= 0.12:
        return "Accumulate"
    if score > -0.12:
        return "Hold"
    if score > -0.35:
        return "Reduce"
    return "Sell"


def build_rating(
    ticker: str,
    df: pd.DataFrame,
    fundamentals: Fundamentals | None,
    forecast: Forecast,
    risk: RiskAnalysis,
    avg_sentiment: float | None,
) -> ResearchRating:
    raw: dict[str, tuple[float, str]] = {
        "Trend & momentum": _trend_score(df),
        "Financial health": _financial_health(fundamentals),
        "Growth": _growth(fundamentals),
        "Valuation": _valuation(fundamentals),
        "Estimate revisions": _estimate_revisions(fundamentals),
        "News sentiment": _sentiment_score(avg_sentiment),
        "Volatility & downside risk": _risk_score(risk),
        "Model forecast": _model_forecast_score(forecast),
        "Model reliability": _model_reliability(forecast),
    }

    components: list[RatingComponent] = []
    composite = 0.0
    for name, weight in WEIGHTS.items():
        score, detail = raw[name]
        contribution = score * weight
        composite += contribution
        components.append(
            RatingComponent(
                name=name, score=round(score, 3), weight=weight,
                contribution=round(contribution, 4), detail=detail,
            )
        )

    rating = _rating_bucket(composite)

    # Confidence: based on data availability, model reliability and agreement.
    available = sum(1 for n, (s, d) in raw.items() if "unavailable" not in d and "no news" not in d and "insufficient" not in d)
    availability = available / len(raw)
    reliability = (raw["Model reliability"][0] + 1) / 2
    agreement = 1 - float(np.std([s for s, _ in raw.values()]))
    confidence = _clamp(0.4 * availability + 0.35 * max(reliability, 0) + 0.25 * max(agreement, 0), 0, 1)
    conf_label = "high" if confidence >= 0.66 else "moderate" if confidence >= 0.4 else "low"

    # Expected return range from the 6-month scenario band.
    pt6 = next((h for h in forecast.horizons if h.horizon_days == 126), forecast.horizons[-1])
    exp_low = round((pt6.bear / forecast_last_price(df) - 1) * 100, 1)
    exp_high = round((pt6.bull / forecast_last_price(df) - 1) * 100, 1)

    bullish = [f"{c.name}: {c.detail}" for c in components if c.score > 0.25]
    bearish = [f"{c.name}: {c.detail}" for c in components if c.score < -0.25]

    catalysts = [
        "Next quarterly earnings report",
        "Sector or macro data releases affecting the industry",
    ]
    if fundamentals and fundamentals.forward_pe and fundamentals.pe_ratio:
        catalysts.append("Analyst revisions as forward estimates are updated")

    key_risks = [
        f"Elevated volatility ({risk.annualized_volatility:.0%} annualised) can overwhelm the forecast",
        "Forecasts assume no structural break (M&A, regulation, guidance shock)",
    ]
    if raw["Model reliability"][0] < 0:
        key_risks.append("The model has not demonstrated skill for this ticker — low forecast reliability")

    invalidation = [
        f"Close below the 6-month bear scenario (~{pt6.bear:.2f}) would invalidate the base case",
        "A negative earnings surprise or guidance cut",
        "A regime change to sustained high volatility",
    ]

    explanation = _explain(rating, composite, confidence, conf_label, components, forecast)

    return ResearchRating(
        ticker=ticker.upper(),
        rating=rating,
        composite_score=round(composite, 3),
        confidence=round(confidence, 3),
        confidence_label=conf_label,
        expected_return_low_pct=exp_low,
        expected_return_high_pct=exp_high,
        components=components,
        bullish_factors=bullish or ["No strongly positive factors stand out."],
        bearish_factors=bearish or ["No strongly negative factors stand out."],
        catalysts=catalysts,
        key_risks=key_risks,
        invalidation_conditions=invalidation,
        explanation=explanation,
    )


def forecast_last_price(df: pd.DataFrame) -> float:
    return float(df["adj_close"].astype(float).iloc[-1])


def _explain(rating, composite, confidence, conf_label, components, forecast) -> str:
    top_pos = sorted(components, key=lambda c: c.contribution, reverse=True)[:2]
    top_neg = sorted(components, key=lambda c: c.contribution)[:2]
    pos_txt = "; ".join(f"{c.name} ({c.contribution:+.2f})" for c in top_pos if c.contribution > 0)
    neg_txt = "; ".join(f"{c.name} ({c.contribution:+.2f})" for c in top_neg if c.contribution < 0)
    return (
        f"The composite research score is {composite:+.2f} on a -1..+1 scale, which maps "
        f"to a {rating} rating with {conf_label} confidence ({confidence:.0%}). "
        + (f"The biggest positive contributors are {pos_txt}. " if pos_txt else "")
        + (f"The biggest drags are {neg_txt}. " if neg_txt else "")
        + f"The forecast model ({forecast.selected_model}) contributes only "
        f"{WEIGHTS['Model forecast']:.0%} of the score by design — a predicted price move "
        "alone is never enough to earn a Buy. This is a research signal, not personalised "
        "investment advice."
    )
