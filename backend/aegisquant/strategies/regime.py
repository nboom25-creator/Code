"""Market-regime classification.

The regime is derived from four independent legs — index trend, volatility,
credit and breadth — combined into the ``risk_on_score`` feature. Classification
uses **hysteresis**: leaving a regime requires a wider move than entering it, so
the allocator is not whipsawed by a score oscillating around a threshold.

The regime governs how aggressive the platform is allowed to be:

=========  ==============  ===================================================
Regime     New-entry scale  Posture
=========  ==============  ===================================================
risk_on    1.0             Full sizing, greater concentration in leaders
neutral    0.5             Smaller positions, higher evidence bar, more cash
risk_off   0.0             No new entries; manage and reduce existing risk
=========  ==============  ===================================================
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.db.enums import Regime
from aegisquant.db.models import RegimeSnapshot
from aegisquant.features.engine import FeatureBundle
from aegisquant.utils.money import D

RISK_ON_ENTRY = 0.15
RISK_ON_EXIT = 0.05
RISK_OFF_ENTRY = -0.25
RISK_OFF_EXIT = -0.10

#: Fraction of normal sizing permitted for *new* entries in each regime.
NEW_ENTRY_SCALE: dict[Regime, Decimal] = {
    Regime.RISK_ON: Decimal("1.0"),
    Regime.NEUTRAL: Decimal("0.5"),
    Regime.RISK_OFF: Decimal("0.0"),
}

#: Maximum single-name weight multiplier by regime (concentration allowance).
CONCENTRATION_SCALE: dict[Regime, Decimal] = {
    Regime.RISK_ON: Decimal("1.0"),
    Regime.NEUTRAL: Decimal("0.7"),
    Regime.RISK_OFF: Decimal("0.4"),
}

#: Minimum confidence a new entry needs, by regime — the evidence bar rises as
#: conditions deteriorate.
MIN_CONFIDENCE: dict[Regime, Decimal] = {
    Regime.RISK_ON: Decimal("0.40"),
    Regime.NEUTRAL: Decimal("0.55"),
    Regime.RISK_OFF: Decimal("0.99"),
}


@dataclass(slots=True)
class RegimeAssessment:
    regime: Regime
    score: float
    components: dict[str, float | None] = field(default_factory=dict)
    explanation: str = ""
    previous: Regime | None = None
    unclassifiable: bool = False

    @property
    def new_entry_scale(self) -> Decimal:
        return NEW_ENTRY_SCALE[self.regime]

    @property
    def concentration_scale(self) -> Decimal:
        return CONCENTRATION_SCALE[self.regime]

    @property
    def min_confidence(self) -> Decimal:
        return MIN_CONFIDENCE[self.regime]

    def as_dict(self) -> dict[str, Any]:
        return {
            "regime": self.regime.value,
            "score": round(self.score, 4),
            "components": self.components,
            "explanation": self.explanation,
            "previous": self.previous.value if self.previous else None,
            "unclassifiable": self.unclassifiable,
            "new_entry_scale": str(self.new_entry_scale),
            "concentration_scale": str(self.concentration_scale),
            "min_confidence": str(self.min_confidence),
        }


def classify(
    market_features: dict[str, float],
    previous: Regime | None = None,
) -> RegimeAssessment:
    """Classify the regime from market-level features, with hysteresis."""
    score = market_features.get("risk_on_score")
    components = {
        "risk_on_score": score,
        "index_trend_200": market_features.get("index_trend_200"),
        "index_above_200sma": market_features.get("index_above_200sma"),
        "index_drawdown": market_features.get("index_drawdown"),
        "vix_level": market_features.get("vix_level"),
        "vix_percentile_252": market_features.get("vix_percentile_252"),
        "credit_spread": market_features.get("credit_spread"),
        "credit_spread_change_63d": market_features.get("credit_spread_change_63d"),
        "breadth_above_200sma": market_features.get("breadth_above_200sma"),
        "yield_curve_slope": market_features.get("yield_curve_slope"),
        "avg_pairwise_correlation_63": market_features.get("avg_pairwise_correlation_63"),
    }

    if score is None:
        # Cannot classify -> treat as risk-off. The safe choice is always to
        # stop adding risk, never to assume conditions are benign.
        return RegimeAssessment(
            regime=Regime.RISK_OFF,
            score=0.0,
            components=components,
            explanation=(
                "The regime could not be classified because the required market data "
                "(index trend, volatility, credit and breadth) was unavailable. Defaulting to "
                "risk-off: no new entries are permitted until the regime can be measured."
            ),
            previous=previous,
            unclassifiable=True,
        )

    if previous is Regime.RISK_ON:
        regime = Regime.RISK_ON if score > RISK_ON_EXIT else (
            Regime.RISK_OFF if score < RISK_OFF_ENTRY else Regime.NEUTRAL
        )
    elif previous is Regime.RISK_OFF:
        regime = Regime.RISK_OFF if score < RISK_OFF_EXIT else (
            Regime.RISK_ON if score > RISK_ON_ENTRY else Regime.NEUTRAL
        )
    else:  # neutral or unknown
        regime = (
            Regime.RISK_ON
            if score > RISK_ON_ENTRY
            else (Regime.RISK_OFF if score < RISK_OFF_ENTRY else Regime.NEUTRAL)
        )

    return RegimeAssessment(
        regime=regime,
        score=score,
        components=components,
        explanation=_explain(regime, score, components, previous),
        previous=previous,
    )


def _explain(
    regime: Regime, score: float, c: dict[str, float | None], previous: Regime | None
) -> str:
    bits: list[str] = []
    trend = c.get("index_trend_200")
    if trend is not None:
        direction = "above" if trend > 0 else "below"
        bits.append(f"the benchmark is {abs(trend):.1%} {direction} its 200-session average")
    vix_pct = c.get("vix_percentile_252")
    if vix_pct is not None:
        bits.append(f"implied volatility sits in the {vix_pct:.0%} percentile of the past year")
    credit = c.get("credit_spread_change_63d")
    if credit is not None:
        move = "widened" if credit > 0 else "narrowed"
        bits.append(f"high-yield spreads have {move} {abs(credit):.2f} points over 63 sessions")
    breadth = c.get("breadth_above_200sma")
    if breadth is not None:
        bits.append(f"{breadth:.0%} of the universe trades above its own 200-session average")
    curve = c.get("yield_curve_slope")
    if curve is not None and curve < 0:
        bits.append(f"the yield curve is inverted by {abs(curve):.2f} points")
    corr = c.get("avg_pairwise_correlation_63")
    if corr is not None and corr > 0.7:
        bits.append(f"average pairwise correlation is elevated at {corr:.2f}, thinning diversification")

    headline = {
        Regime.RISK_ON: "Risk-on: conditions support full growth exposure.",
        Regime.NEUTRAL: "Neutral: exposure is halved and the evidence bar for new entries is raised.",
        Regime.RISK_OFF: "Risk-off: no new entries; existing positions are managed and reduced.",
    }[regime]
    transition = ""
    if previous and previous is not regime:
        transition = f" Regime changed from {previous.value} to {regime.value}."
    detail = ("; ".join(bits) + ".") if bits else "Limited regime detail was available."
    return f"{headline} Composite risk-on score {score:+.2f}.{transition} {detail[0].upper() + detail[1:]}"


# ---------------------------------------------------------------------------
def previous_regime(session: Session) -> Regime | None:
    row = session.scalar(select(RegimeSnapshot).order_by(RegimeSnapshot.as_of.desc()).limit(1))
    return row.regime if row else None


def assess(
    bundle: FeatureBundle, session: Session | None = None, previous: Regime | None = None
) -> RegimeAssessment:
    if previous is None and session is not None:
        previous = previous_regime(session)
    return classify(bundle.market, previous)


def persist(session: Session, as_of: datetime, assessment: RegimeAssessment) -> RegimeSnapshot:
    existing = session.scalar(select(RegimeSnapshot).where(RegimeSnapshot.as_of == as_of))
    c = assessment.components

    def dec(key: str) -> Decimal | None:
        v = c.get(key)
        return None if v is None else D(v)

    payload = {
        "regime": assessment.regime,
        "score": D(assessment.score),
        "index_trend": dec("index_trend_200"),
        "vol_regime": dec("vix_percentile_252"),
        "breadth": dec("breadth_above_200sma"),
        "credit": dec("credit_spread_change_63d"),
        "yield_curve": dec("yield_curve_slope"),
        "components": {k: v for k, v in c.items()},
        "explanation": assessment.explanation,
    }
    if existing is not None:
        for key, value in payload.items():
            setattr(existing, key, value)
        session.flush()
        return existing
    row = RegimeSnapshot(as_of=as_of, **payload)
    session.add(row)
    session.flush()
    return row
