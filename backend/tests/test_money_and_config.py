"""Money handling and configuration guardrails.

Money is the one place where a float bug is silently wrong rather than loudly
wrong, so ``D()`` is tested against every input shape the providers can produce.
The configuration tests pin the refusals that keep LIVE mode from being reached
by accident.
"""

from __future__ import annotations

from decimal import Decimal

import numpy as np
import pytest
from pydantic import ValidationError

from aegisquant.config import Mode, RiskLimits, Settings
from aegisquant.utils.money import ZERO, D, bps, money, pct, price, qty, safe_div


class TestDecimalConversion:
    def test_from_str_int_float(self) -> None:
        assert D("12.34") == Decimal("12.34")
        assert D(7) == Decimal(7)
        assert D(0.1) == Decimal("0.1")

    def test_float_goes_through_repr_not_binary_expansion(self) -> None:
        # Decimal(0.1) is 0.1000000000000000055511151231257827.., which would
        # leak binary noise into every downstream calculation.
        assert str(D(0.1)) == "0.1"

    def test_numpy_scalars(self) -> None:
        # repr(np.float64(1.5)) is "np.float64(1.5)" on NumPy 2.x, which Decimal
        # cannot parse; D() must unwrap via .item() instead.
        assert D(np.float64(1.5)) == Decimal("1.5")
        assert D(np.int64(3)) == Decimal(3)
        assert D(np.float32(2.5)) == Decimal("2.5")

    def test_none_is_zero(self) -> None:
        assert D(None) == ZERO

    @pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
    def test_non_finite_rejected(self, bad: float) -> None:
        with pytest.raises(ValueError):
            D(bad)

    def test_numpy_non_finite_rejected(self) -> None:
        with pytest.raises(ValueError):
            D(np.float64("nan"))

    def test_quantisers(self) -> None:
        assert money("1.005") == Decimal("1.01")
        assert price("1.00005") == Decimal("1.0001")
        assert pct("0.1234565") == Decimal("0.123457")

    def test_quantity_rounds_down_never_up(self) -> None:
        # Rounding a quantity up could push a position past a hard cap that the
        # risk engine already approved, so qty() truncates in both modes.
        assert qty("1.9999999") == Decimal("1.999999")
        assert qty("1.9999999", allow_fractional=False) == Decimal("1")

    def test_safe_div_never_raises_on_zero(self) -> None:
        assert safe_div(Decimal(1), Decimal(0)) == ZERO
        assert safe_div(Decimal(1), None) == ZERO
        assert safe_div(Decimal(3), Decimal(2)) == Decimal("1.5")

    def test_bps(self) -> None:
        assert bps("0.0015") == Decimal("15.0000")


class TestRiskLimits:
    def test_defaults_are_fractional_kelly(self) -> None:
        limits = RiskLimits()
        assert Decimal(0) < limits.kelly_fraction <= Decimal("0.5")

    @pytest.mark.parametrize("fraction", ["0.51", "1.0", "2"])
    def test_full_kelly_is_refused(self, fraction: str) -> None:
        # Full Kelly maximises growth only under a perfectly known edge and
        # guarantees deep drawdowns otherwise. It must be unreachable.
        with pytest.raises(ValidationError):
            RiskLimits(kelly_fraction=Decimal(fraction))

    def test_drawdown_stages_must_be_monotonic(self) -> None:
        # Out-of-order stages would make the defensive ladder skip a rung.
        with pytest.raises(ValidationError):
            RiskLimits(
                drawdown_warning_pct=Decimal("0.07"),
                defensive_stage_1_pct=Decimal("0.15"),
                defensive_stage_2_pct=Decimal("0.10"),
                emergency_stage_pct=Decimal("0.20"),
            )

    def test_default_stages_are_ordered_and_inside_the_drawdown_cap(self) -> None:
        limits = RiskLimits()
        assert (
            limits.drawdown_warning_pct
            < limits.defensive_stage_1_pct
            < limits.defensive_stage_2_pct
            <= limits.emergency_stage_pct
        )
        assert limits.emergency_stage_pct <= limits.max_portfolio_drawdown_pct

    def test_no_leverage_in_v1(self) -> None:
        assert RiskLimits().max_gross_exposure_pct <= Decimal("1.0")


class TestSettingsSafety:
    """Every path into LIVE mode must be blocked unless explicitly unlocked."""

    def _base(self, **kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "env_name": "production",
            "secret_key": "a-real-secret-key-value-for-tests-only",
            "database_url": "postgresql+psycopg://u:p@localhost/aegis",
            "alpaca_key_id": "AKREALKEY123456",
            "alpaca_secret_key": "super-secret-broker-value",
        }
        base.update(kw)
        return base

    def test_live_mode_requires_the_separate_env_flag(self) -> None:
        with pytest.raises(ValidationError) as excinfo:
            Settings(**self._base(mode=Mode.LIVE, live_trading_enabled=False, broker="alpaca"))
        assert "live_trading_enabled" in str(excinfo.value).lower()

    def test_alpaca_broker_requires_credentials(self) -> None:
        with pytest.raises(ValidationError):
            Settings(**self._base(broker="alpaca", alpaca_key_id=None, alpaca_secret_key=None))

    def test_live_mode_refuses_the_mock_broker(self) -> None:
        # A mock broker in LIVE would report fills that never happened.
        with pytest.raises(ValidationError):
            Settings(**self._base(mode=Mode.LIVE, live_trading_enabled=True, broker="mock"))

    def test_paper_mode_is_the_default(self) -> None:
        settings = Settings(**self._base())
        assert settings.mode is Mode.PAPER
        assert settings.live_trading_enabled is False

    def test_development_secret_refused_outside_development(self) -> None:
        with pytest.raises(ValidationError):
            Settings(**self._base(secret_key="dev-only-insecure-change-me"))

    def test_live_mode_refuses_the_development_secret(self) -> None:
        with pytest.raises(ValidationError):
            Settings(
                **self._base(
                    env_name="development",
                    secret_key="dev-only-insecure-change-me",
                    mode=Mode.LIVE,
                    live_trading_enabled=True,
                    broker="alpaca",
                )
            )

    def test_public_dict_never_contains_secret_values(self) -> None:
        settings = Settings(**self._base())
        blob = repr(settings.public_dict())
        for secret in settings.secret_values():
            assert secret not in blob
        assert "AKREALKEY123456" not in blob
        assert "super-secret-broker-value" not in blob

    def test_secret_values_enumerates_everything_the_redactor_must_hide(self) -> None:
        secrets = Settings(**self._base()).secret_values()
        assert "super-secret-broker-value" in secrets
        assert "AKREALKEY123456" in secrets
        assert "a-real-secret-key-value-for-tests-only" in secrets
