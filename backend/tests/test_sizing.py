"""Position sizing.

The invariant every test here defends: **sizing can only ever shrink a position
relative to the hard caps.** No combination of high confidence, low volatility or
a favourable regime may produce a weight above the configured ceiling, and full
Kelly must be unreachable.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from aegisquant.config import RiskLimits
from aegisquant.portfolio.sizing import (
    conviction_multiplier,
    correlation_multiplier,
    dynamic_cash_target,
    fixed_fractional_weight,
    fractional_kelly_weight,
    pyramid_increment,
    quantity_from_weight,
    reduction_fraction,
    size_position,
    volatility_target_weight,
)

LIMITS = RiskLimits()
METHODS = (
    "volatility_target",
    "fixed_fractional",
    "fractional_kelly",
    "risk_parity",
    "conviction_weighted",
    "equal_weight",
)


class TestVolatilityTargeting:
    def test_low_volatility_gets_a_larger_weight(self) -> None:
        calm, _ = volatility_target_weight(Decimal("0.25"), Decimal("0.18"), Decimal("1"))
        wild, _ = volatility_target_weight(Decimal("0.90"), Decimal("0.18"), Decimal("1"))
        assert calm > wild

    def test_weight_is_target_over_asset_vol(self) -> None:
        weight, note = volatility_target_weight(Decimal("0.36"), Decimal("0.18"), Decimal("1"))
        assert weight == Decimal("0.5")
        assert "0.18" in note

    def test_the_cap_always_binds(self) -> None:
        weight, _ = volatility_target_weight(Decimal("0.01"), Decimal("0.18"), Decimal("0.15"))
        assert weight == Decimal("0.15")

    def test_unknown_volatility_halves_the_cap_rather_than_assuming_calm(self) -> None:
        weight, note = volatility_target_weight(None, Decimal("0.18"), Decimal("0.10"))
        assert weight == Decimal("0.05")
        assert "unknown" in note


class TestFractionalKelly:
    def test_full_kelly_is_never_returned(self) -> None:
        weight, _ = fractional_kelly_weight(
            expected_return=Decimal("0.40"),
            downside=Decimal("-0.10"),
            confidence=Decimal("0.90"),
            kelly_fraction=LIMITS.kelly_fraction,
            max_weight=Decimal("1"),
        )
        payoff = Decimal("0.40") / Decimal("0.10")
        full = Decimal("0.90") - Decimal("0.10") / payoff
        assert weight == pytest.approx(full * LIMITS.kelly_fraction)
        assert weight < full / 2 + Decimal("0.0001")

    def test_no_edge_means_no_bet_not_a_reversed_bet(self) -> None:
        # p below the break-even implied by the payoff ratio gives negative Kelly.
        weight, note = fractional_kelly_weight(
            expected_return=Decimal("0.05"),
            downside=Decimal("-0.20"),
            confidence=Decimal("0.20"),
            kelly_fraction=Decimal("0.25"),
            max_weight=Decimal("1"),
        )
        assert weight == Decimal(0)
        assert "no edge" in note

    def test_missing_inputs_produce_no_position(self) -> None:
        for kwargs in (
            {"expected_return": None, "downside": Decimal("-0.1")},
            {"expected_return": Decimal("0.1"), "downside": None},
            {"expected_return": Decimal("0.1"), "downside": Decimal("0.1")},  # non-negative downside
        ):
            weight, _ = fractional_kelly_weight(
                confidence=Decimal("0.8"),
                kelly_fraction=Decimal("0.25"),
                max_weight=Decimal("1"),
                **kwargs,  # type: ignore[arg-type]
            )
            assert weight == Decimal(0)

    def test_higher_confidence_bets_more_within_the_cap(self) -> None:
        def weight_for(confidence: str) -> Decimal:
            w, _ = fractional_kelly_weight(
                Decimal("0.30"), Decimal("-0.10"), Decimal(confidence), Decimal("0.25"), Decimal("1")
            )
            return w

        assert weight_for("0.55") < weight_for("0.70") < weight_for("0.85")


class TestFixedFractional:
    def test_a_wider_stop_gets_a_smaller_position(self) -> None:
        tight, _ = fixed_fractional_weight(Decimal("0.01"), Decimal("0.05"), Decimal("1"))
        wide, _ = fixed_fractional_weight(Decimal("0.01"), Decimal("0.20"), Decimal("1"))
        assert tight == Decimal("0.2")
        assert wide == Decimal("0.05")

    def test_no_stop_distance_halves_the_cap(self) -> None:
        weight, note = fixed_fractional_weight(Decimal("0.01"), None, Decimal("0.10"))
        assert weight == Decimal("0.05")
        assert "no stop distance" in note


class TestMultipliers:
    def test_conviction_multiplier_is_bounded_by_the_floor_and_one(self) -> None:
        assert conviction_multiplier(Decimal("0.01"), Decimal("0.25")) == Decimal("0.25")
        assert conviction_multiplier(Decimal("0.60"), Decimal("0.25")) == Decimal("0.60")
        assert conviction_multiplier(Decimal("5.00"), Decimal("0.25")) == Decimal("1")

    def test_correlation_haircut_grows_with_correlation(self) -> None:
        low, _ = correlation_multiplier(Decimal("0.30"), Decimal("0.60"))
        mid, _ = correlation_multiplier(Decimal("0.80"), Decimal("0.60"))
        high, _ = correlation_multiplier(Decimal("0.99"), Decimal("0.60"))
        assert low == Decimal(1)
        assert Decimal("0.5") <= high < mid < low
        assert high >= Decimal("0.5")  # haircut never exceeds 50%

    def test_unknown_correlation_does_not_silently_shrink(self) -> None:
        mult, note = correlation_multiplier(None, Decimal("0.60"))
        assert mult == Decimal(1)
        assert "unknown" in note


class TestSizePosition:
    @pytest.mark.parametrize("method", METHODS)
    def test_no_method_can_exceed_the_hard_cap(self, method: str) -> None:
        result = size_position(
            method=method,
            limits=LIMITS,
            confidence=Decimal("1.0"),
            asset_vol=Decimal("0.001"),  # absurdly calm
            expected_return=Decimal("5.0"),  # absurdly optimistic
            downside=Decimal("-0.001"),
            stop_distance=Decimal("0.001"),
            avg_correlation_to_book=Decimal("0"),
            regime_scale=Decimal(1),
            concentration_scale=Decimal(1),
            strategy_weight=Decimal(1),
        )
        assert result.weight <= LIMITS.max_position_pct
        assert result.weight <= LIMITS.max_order_notional_pct

    @pytest.mark.parametrize("method", METHODS)
    def test_risk_off_regime_produces_no_new_exposure(self, method: str) -> None:
        result = size_position(
            method=method,
            limits=LIMITS,
            confidence=Decimal("0.95"),
            asset_vol=Decimal("0.20"),
            expected_return=Decimal("0.30"),
            downside=Decimal("-0.10"),
            regime_scale=Decimal(0),
        )
        assert result.weight == Decimal(0)
        assert result.binding_constraint == "regime_risk_off"

    def test_every_scale_factor_only_ever_shrinks(self) -> None:
        neutral: dict[str, Decimal] = {
            "confidence": Decimal("1"),
            "asset_vol": Decimal("0.25"),
            "avg_correlation_to_book": Decimal("0"),
            "regime_scale": Decimal(1),
            "concentration_scale": Decimal(1),
            "strategy_weight": Decimal(1),
        }
        base = size_position(method="volatility_target", limits=LIMITS, **neutral).weight
        assert base > 0
        for override in (
            {"confidence": Decimal("0.4")},
            {"avg_correlation_to_book": Decimal("0.95")},
            {"regime_scale": Decimal("0.5")},
            {"concentration_scale": Decimal("0.5")},
            {"strategy_weight": Decimal("0.05")},
        ):
            reduced = size_position(method="volatility_target", limits=LIMITS, **{**neutral, **override}).weight
            assert reduced <= base, f"{override} increased the weight"

    @pytest.mark.parametrize("method", METHODS)
    def test_the_derivation_is_always_recorded(self, method: str) -> None:
        result = size_position(
            method=method,
            limits=LIMITS,
            confidence=Decimal("0.7"),
            asset_vol=Decimal("0.30"),
            expected_return=Decimal("0.20"),
            downside=Decimal("-0.08"),
        )
        assert result.method == method
        assert result.explanation
        # Every multiplier that shaped the number is named, so the audit record
        # can be re-derived from the components alone.
        for key in (
            "hard_cap",
            "method_weight",
            "conviction_multiplier",
            "correlation_multiplier",
            "regime_scale",
            "sleeve_scale",
        ):
            assert key in result.components

    def test_an_unknown_method_falls_back_conservatively(self) -> None:
        result = size_position(method="does_not_exist", limits=LIMITS, confidence=Decimal("1"))
        assert result.weight <= LIMITS.max_position_pct / Decimal(4)
        assert "unknown method" in result.components["method_note"]

    def test_kelly_falls_back_to_a_half_vol_target_with_no_edge(self) -> None:
        result = size_position(
            method="fractional_kelly",
            limits=LIMITS,
            confidence=Decimal("0.20"),
            asset_vol=Decimal("0.30"),
            expected_return=Decimal("0.02"),
            downside=Decimal("-0.20"),
        )
        assert result.weight > 0  # a small, volatility-bounded position
        assert "fell back" in result.components["method_note"]
        assert result.weight < LIMITS.max_position_pct


class TestQuantityConversion:
    def test_quantity_rounds_down_to_stay_inside_the_weight(self) -> None:
        # 10% of $10,000 is $1,000; at $333 that is 3.003 shares.
        whole = quantity_from_weight(Decimal("0.10"), Decimal(10_000), Decimal(333), allow_fractional=False)
        assert whole == Decimal(3)
        assert whole * Decimal(333) <= Decimal("0.10") * Decimal(10_000)

    def test_fractional_shares_are_supported_when_allowed(self) -> None:
        qty = quantity_from_weight(Decimal("0.10"), Decimal(10_000), Decimal(333), allow_fractional=True)
        assert Decimal("3.003") <= qty < Decimal("3.004")
        assert qty * Decimal(333) <= Decimal("0.10") * Decimal(10_000)

    @pytest.mark.parametrize(
        ("weight", "equity", "price"),
        [
            (Decimal("0.1"), Decimal(0), Decimal(10)),
            (Decimal("0.1"), Decimal(1000), Decimal(0)),
            (Decimal(0), Decimal(1000), Decimal(10)),
        ],
    )
    def test_degenerate_inputs_produce_no_position(self, weight, equity, price) -> None:
        assert quantity_from_weight(weight, equity, price, allow_fractional=True) == Decimal(0)


class TestPyramiding:
    def test_adds_require_open_profit(self) -> None:
        increment, note = pyramid_increment(
            current_weight=Decimal("0.05"),
            target_weight=Decimal("0.12"),
            unrealized_pnl_pct=Decimal("0.02"),
        )
        assert increment == Decimal(0)
        assert "at least" in note

    def test_a_winner_is_added_to_gradually(self) -> None:
        increment, _ = pyramid_increment(
            current_weight=Decimal("0.05"),
            target_weight=Decimal("0.13"),
            unrealized_pnl_pct=Decimal("0.25"),
        )
        # Half of the 8-point headroom, not the whole thing.
        assert increment == Decimal("0.040000")

    def test_never_averages_down(self) -> None:
        # A losing position has no open profit, so this path cannot add at all.
        increment, _ = pyramid_increment(
            current_weight=Decimal("0.05"),
            target_weight=Decimal("0.15"),
            unrealized_pnl_pct=Decimal("-0.30"),
        )
        assert increment == Decimal(0)

    def test_no_add_once_at_target(self) -> None:
        increment, note = pyramid_increment(
            current_weight=Decimal("0.15"),
            target_weight=Decimal("0.12"),
            unrealized_pnl_pct=Decimal("0.40"),
        )
        assert increment == Decimal(0)
        assert "target weight" in note


class TestThesisDrivenReduction:
    def test_invalidated_thesis_exits_the_whole_position(self) -> None:
        fraction, note = reduction_fraction("invalidated")
        assert fraction == Decimal(1)
        assert "exit" in note

    def test_weakening_thesis_trims(self) -> None:
        fraction, _ = reduction_fraction("weakening", severity=Decimal("0.4"))
        assert fraction == Decimal("0.4")

    def test_intact_thesis_holds(self) -> None:
        fraction, _ = reduction_fraction("intact")
        assert fraction == Decimal(0)

    def test_a_profit_percentage_is_not_a_reason_to_sell(self) -> None:
        # There is deliberately no "up 20%, take profit" path: winners are only
        # reduced when the thesis deteriorates or a risk limit binds.
        assert reduction_fraction("intact")[0] == Decimal(0)


class TestDynamicCash:
    def test_cash_rises_in_a_weaker_regime(self) -> None:
        calm, _ = dynamic_cash_target(Decimal(1), Decimal("0.10"), Decimal(0))
        neutral, _ = dynamic_cash_target(Decimal("0.5"), Decimal("0.10"), Decimal(0))
        risk_off, _ = dynamic_cash_target(Decimal(0), Decimal("0.10"), Decimal(0))
        assert calm <= neutral <= risk_off

    def test_cash_rises_in_a_drawdown(self) -> None:
        flat, _ = dynamic_cash_target(Decimal(1), Decimal("0.10"), Decimal(0))
        drawn, _ = dynamic_cash_target(Decimal(1), Decimal("0.10"), Decimal("-0.15"))
        assert drawn > flat

    def test_cash_never_falls_below_the_configured_buffer(self) -> None:
        target, _ = dynamic_cash_target(Decimal(1), Decimal("0.10"), Decimal(0))
        assert target >= Decimal("0.10")
