"""Position sizing.

Five methods, all of which can only ever *reduce* a position relative to the hard
caps in the risk configuration. Sizing never grows a position past a limit; that
is the risk engine's exclusive authority and it is applied afterwards regardless.

Fractional Kelly deserves a note. Full Kelly maximises expected log wealth *given
perfectly known probabilities*, and every probability here is an estimate with
material error. Over-betting relative to true edge is the classic route to ruin,
so the Kelly fraction is capped at 0.5 by configuration validation and defaults
to 0.25, and the resulting weight is then clipped by every other cap.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from aegisquant.config import RiskLimits
from aegisquant.utils.money import D, ZERO, safe_div


@dataclass(slots=True)
class SizingResult:
    """A target weight with a complete, auditable derivation."""

    weight: Decimal
    method: str
    components: dict[str, str] = field(default_factory=dict)
    binding_constraint: str | None = None
    explanation: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "weight": str(self.weight),
            "method": self.method,
            "components": self.components,
            "binding_constraint": self.binding_constraint,
            "explanation": self.explanation,
        }


def volatility_target_weight(
    asset_vol: Decimal | None, target_vol: Decimal, max_weight: Decimal
) -> tuple[Decimal, str]:
    """Weight that makes the position contribute ``target_vol`` of risk."""
    if asset_vol is None or asset_vol <= 0:
        return max_weight * Decimal("0.5"), "asset volatility unknown; halved the cap"
    weight = safe_div(target_vol, asset_vol)
    return min(weight, max_weight), f"target vol {target_vol} / asset vol {asset_vol:.4f}"


def fixed_fractional_weight(
    risk_per_trade: Decimal, stop_distance: Decimal | None, max_weight: Decimal
) -> tuple[Decimal, str]:
    """Weight that risks ``risk_per_trade`` of equity to the stop."""
    if stop_distance is None or stop_distance <= 0:
        return max_weight * Decimal("0.5"), "no stop distance; halved the cap"
    weight = safe_div(risk_per_trade, stop_distance)
    return min(weight, max_weight), (
        f"risk {risk_per_trade} / stop distance {stop_distance:.4f}"
    )


def fractional_kelly_weight(
    expected_return: Decimal | None,
    downside: Decimal | None,
    confidence: Decimal,
    kelly_fraction: Decimal,
    max_weight: Decimal,
) -> tuple[Decimal, str]:
    """Fractional-Kelly weight from win probability and payoff asymmetry.

    ``f* = p - (1 - p) / b`` where ``p`` is the win probability (the calibrated
    confidence) and ``b`` the win/loss payoff ratio. Multiplied by the configured
    fraction and clipped at zero — a negative Kelly means "do not take the bet",
    never "take the other side".
    """
    if expected_return is None or downside is None or downside >= 0:
        return ZERO, "expected return or downside unavailable; Kelly not computed"
    payoff_ratio = safe_div(abs(expected_return), abs(downside))
    if payoff_ratio <= 0:
        return ZERO, "non-positive payoff ratio"
    p = max(Decimal("0"), min(Decimal("1"), confidence))
    full_kelly = p - (Decimal(1) - p) / payoff_ratio
    if full_kelly <= 0:
        return ZERO, (
            f"Kelly is non-positive (p={p}, payoff={payoff_ratio:.2f}) — no edge to bet"
        )
    weight = full_kelly * kelly_fraction
    return min(weight, max_weight), (
        f"{kelly_fraction} x Kelly({p}, payoff {payoff_ratio:.2f}) = {full_kelly:.4f}"
    )


def conviction_multiplier(confidence: Decimal, floor: Decimal) -> Decimal:
    """Scale in ``[floor, 1]`` from confidence. Never exceeds 1."""
    return max(floor, min(Decimal(1), confidence))


def correlation_multiplier(
    avg_correlation_to_book: Decimal | None, threshold: Decimal
) -> tuple[Decimal, str]:
    """Shrink a position that duplicates risk already in the book."""
    if avg_correlation_to_book is None:
        return Decimal(1), "correlation to the book unknown"
    excess = avg_correlation_to_book - threshold
    if excess <= 0:
        return Decimal(1), f"correlation {avg_correlation_to_book:.2f} is within tolerance"
    # Up to a 50% haircut as correlation approaches 1.
    haircut = min(Decimal("0.5"), excess / (Decimal(1) - threshold) * Decimal("0.5"))
    return Decimal(1) - haircut, (
        f"correlation {avg_correlation_to_book:.2f} exceeds {threshold} — {haircut:.0%} haircut"
    )


def size_position(
    *,
    method: str,
    limits: RiskLimits,
    confidence: Decimal,
    asset_vol: Decimal | None = None,
    expected_return: Decimal | None = None,
    downside: Decimal | None = None,
    stop_distance: Decimal | None = None,
    avg_correlation_to_book: Decimal | None = None,
    regime_scale: Decimal = Decimal(1),
    concentration_scale: Decimal = Decimal(1),
    strategy_weight: Decimal = Decimal(1),
    max_weight_override: Decimal | None = None,
) -> SizingResult:
    """Compute a target portfolio weight for one candidate position.

    The result is the **minimum** of the requested method's weight and every
    applicable cap, then scaled by conviction, correlation, regime and the
    sleeve's ensemble weight.
    """
    hard_cap = max_weight_override if max_weight_override is not None else limits.max_position_pct
    components: dict[str, str] = {"hard_cap": str(hard_cap)}

    if method == "volatility_target":
        base, note = volatility_target_weight(asset_vol, limits.target_portfolio_vol_pct, hard_cap)
    elif method == "fixed_fractional":
        base, note = fixed_fractional_weight(
            limits.max_risk_per_trade_pct, stop_distance or (asset_vol or ZERO) * Decimal("0.5"), hard_cap
        )
    elif method == "fractional_kelly":
        base, note = fractional_kelly_weight(
            expected_return, downside, confidence, limits.kelly_fraction, hard_cap
        )
        if base <= 0:  # no Kelly edge -> fall back to a conservative vol target
            base, note2 = volatility_target_weight(
                asset_vol, limits.target_portfolio_vol_pct / 2, hard_cap
            )
            note = f"{note}; fell back to half-volatility target ({note2})"
    elif method == "risk_parity":
        base, note = volatility_target_weight(
            asset_vol, limits.target_portfolio_vol_pct / Decimal(4), hard_cap
        )
    elif method == "conviction_weighted":
        vol_weight, note = volatility_target_weight(
            asset_vol, limits.target_portfolio_vol_pct, hard_cap
        )
        kelly_weight, kelly_note = fractional_kelly_weight(
            expected_return, downside, confidence, limits.kelly_fraction, hard_cap
        )
        # Conviction weighting = the *more conservative* of the two, so a strong
        # opinion cannot override a volatility-based bound.
        base = min(vol_weight, kelly_weight) if kelly_weight > 0 else vol_weight
        note = f"min(vol target, fractional Kelly): {note}; {kelly_note}"
    elif method == "equal_weight":
        base, note = hard_cap / Decimal(2), "equal weight at half the single-name cap"
    else:
        base, note = hard_cap / Decimal(4), f"unknown method '{method}'; used a quarter of the cap"

    components["method_weight"] = str(base)
    components["method_note"] = note

    conviction = conviction_multiplier(confidence, limits.conviction_size_floor)
    corr_mult, corr_note = correlation_multiplier(
        avg_correlation_to_book, limits.correlation_threshold
    )
    components["conviction_multiplier"] = str(conviction)
    components["correlation_multiplier"] = str(corr_mult)
    components["correlation_note"] = corr_note
    components["regime_scale"] = str(regime_scale)
    components["concentration_scale"] = str(concentration_scale)
    components["strategy_weight"] = str(strategy_weight)

    weight = base * conviction * corr_mult * regime_scale * concentration_scale
    # A sleeve's ensemble weight scales its positions, but a single high-conviction
    # idea from a small sleeve should not vanish entirely, so the floor is 0.35.
    sleeve_scale = max(Decimal("0.35"), min(Decimal(1), strategy_weight * Decimal(4)))
    weight *= sleeve_scale
    components["sleeve_scale"] = str(sleeve_scale)

    binding: str | None = None
    if weight > hard_cap:
        weight, binding = hard_cap, "max_position_pct"
    if weight > limits.max_order_notional_pct:
        weight, binding = limits.max_order_notional_pct, "max_order_notional_pct"

    weight = max(ZERO, weight).quantize(Decimal("0.000001"))
    if weight == 0 and regime_scale == 0:
        binding = "regime_risk_off"

    explanation = (
        f"Sized by {method}: {note}. Scaled by conviction {conviction}, "
        f"correlation {corr_mult}, regime {regime_scale}, concentration "
        f"{concentration_scale}, sleeve {sleeve_scale}. Target weight {weight}."
        + (f" Binding constraint: {binding}." if binding else "")
    )
    return SizingResult(
        weight=weight,
        method=method,
        components=components,
        binding_constraint=binding,
        explanation=explanation,
    )


def quantity_from_weight(
    weight: Decimal, equity: Decimal, price: Decimal, allow_fractional: bool
) -> Decimal:
    """Convert a target weight into a share quantity, always rounding down."""
    if price <= 0 or equity <= 0 or weight <= 0:
        return ZERO
    notional = weight * equity
    raw = notional / price
    if allow_fractional:
        return raw.quantize(Decimal("0.000001"), rounding="ROUND_DOWN")
    return raw.quantize(Decimal("1"), rounding="ROUND_DOWN")


def pyramid_increment(
    current_weight: Decimal,
    target_weight: Decimal,
    unrealized_pnl_pct: Decimal,
    max_add_fraction: Decimal = Decimal("0.5"),
    min_profit_to_add: Decimal = Decimal("0.08"),
) -> tuple[Decimal, str]:
    """How much to add to a winning position.

    Adding is only permitted once the position is genuinely working, and each add
    is a fraction of the remaining headroom — so averaging *up* is gradual and
    averaging *down* never happens through this path.
    """
    if unrealized_pnl_pct < min_profit_to_add:
        return ZERO, (
            f"position is up {unrealized_pnl_pct:.1%}; adds require at least "
            f"{min_profit_to_add:.0%} of open profit"
        )
    headroom = target_weight - current_weight
    if headroom <= 0:
        return ZERO, "already at or above the target weight"
    increment = (headroom * max_add_fraction).quantize(Decimal("0.000001"))
    return increment, (
        f"adding {increment} of the {headroom} headroom (position up {unrealized_pnl_pct:.1%})"
    )


def reduction_fraction(
    thesis_status: str, severity: Decimal = Decimal("0.5")
) -> tuple[Decimal, str]:
    """Fraction of a position to sell as a thesis deteriorates."""
    if thesis_status == "invalidated":
        return Decimal(1), "thesis invalidated — exit the full position"
    if thesis_status == "weakening":
        return severity, f"thesis weakening — reduce by {severity:.0%}"
    return ZERO, "thesis intact — no reduction"


def dynamic_cash_target(
    regime_scale: Decimal, min_cash_buffer: Decimal, drawdown: Decimal
) -> tuple[Decimal, str]:
    """Target cash weight. Cash is an active allocation, not a leftover.

    ``drawdown`` is expected to be negative.
    """
    base = min_cash_buffer
    reasons = [f"minimum buffer {min_cash_buffer}"]
    if regime_scale < 1:
        regime_cash = (Decimal(1) - regime_scale) * Decimal("0.4")
        base = max(base, regime_cash)
        reasons.append(f"regime scale {regime_scale} implies {regime_cash} cash")
    if drawdown < Decimal("-0.10"):
        dd_cash = min(Decimal("0.60"), abs(drawdown) * Decimal(2))
        base = max(base, dd_cash)
        reasons.append(f"drawdown {drawdown:.1%} implies {dd_cash} cash")
    return min(Decimal("0.95"), base), "; ".join(reasons)
