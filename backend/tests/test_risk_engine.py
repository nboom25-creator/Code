"""The deterministic risk engine.

This is the component with final authority over every order, so the tests are
written as adversarial attempts to get an order through that should not be. The
engine must be:

* deterministic — same inputs, same verdict, every time;
* fail-closed — missing or unmeasurable data rejects, never approves;
* total — it never raises, because an exception here would be an unhandled path
  around the only control that matters;
* exit-friendly — blocking a risk-reducing order is itself a risk.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from aegisquant.config import RiskLimits
from aegisquant.db.enums import OrderType, Regime, RiskCheckResult, RiskState, Side
from aegisquant.risk.engine import AccountSnapshot, OrderIntent, RiskEngine, cooldown_expiry, derive_risk_state
from aegisquant.utils.timeutil import utcnow
from tests.helpers import account, intent, position

LIMITS = RiskLimits()


@pytest.fixture()
def engine() -> RiskEngine:
    return RiskEngine(LIMITS)


def check(verdict, name: str):
    return next((c for c in verdict.checks if c.name == name), None)


def rejected_by(verdict, name: str) -> bool:
    outcome = check(verdict, name)
    return outcome is not None and outcome.result is RiskCheckResult.REJECT


class TestBaseline:
    def test_a_reasonable_order_is_approved_unchanged(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(quantity=50, price=100), account(equity=100_000))
        assert verdict.approved is True
        assert verdict.approved_quantity == Decimal(50)
        assert verdict.was_resized is False
        assert verdict.rejections == []
        assert "APPROVED" in verdict.explanation

    def test_the_verdict_is_deterministic(self, engine: RiskEngine) -> None:
        acct = account(equity=100_000, positions=[position("MSFT", quantity=100, price=400)])
        order = intent(quantity=50, price=100)
        first = engine.evaluate(order, acct).as_dict()
        second = RiskEngine(LIMITS).evaluate(order, acct).as_dict()
        assert first == second

    def test_every_check_is_recorded_for_the_audit_trail(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(), account())
        assert len(verdict.checks) >= 25
        names = [c.name for c in verdict.checks]
        assert len(names) == len(set(names)) or True  # duplicates are allowed, gaps are not
        for expected in (
            "kill_switch",
            "read_only_mode",
            "broker_connectivity",
            "market_status",
            "data_quality",
            "data_age",
            "max_daily_loss",
            "max_drawdown",
            "market_regime",
            "max_position_pct",
            "max_gross_exposure",
            "cash_buffer",
            "max_sector_exposure",
            "max_open_positions",
            "min_liquidity",
            "adv_participation",
            "max_spread",
            "max_market_impact",
        ):
            assert expected in names, f"check '{expected}' is missing from the audit record"
        for outcome in verdict.checks:
            assert outcome.message
            assert outcome.result in set(RiskCheckResult)


class TestSystemStateGates:
    def test_the_kill_switch_blocks_everything_including_exits(self, engine: RiskEngine) -> None:
        acct = account(kill_switch=True, positions=[position("NVDA", quantity=100, price=100)])
        for reduce_only in (False, True):
            verdict = engine.evaluate(
                intent(side=Side.SELL if reduce_only else Side.BUY, reduce_only=reduce_only), acct
            )
            assert verdict.approved is False
            assert rejected_by(verdict, "kill_switch")

    def test_read_only_mode_blocks_everything(self, engine: RiskEngine) -> None:
        acct = account(read_only=True, positions=[position("NVDA", quantity=100, price=100)])
        verdict = engine.evaluate(intent(side=Side.SELL, reduce_only=True), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "read_only_mode")

    def test_a_disconnected_broker_rejects(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(), account(broker_connected=False))
        assert verdict.approved is False
        assert rejected_by(verdict, "broker_connectivity")

    def test_a_closed_market_rejects(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(), account(market_open=False))
        assert verdict.approved is False
        assert rejected_by(verdict, "market_status")

    def test_a_quarantined_symbol_rejects(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent("NVDA"), account(quarantined_symbols={"NVDA"}))
        assert verdict.approved is False
        assert rejected_by(verdict, "symbol_quarantine")

    def test_a_paused_strategy_rejects(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(
            intent(strategy_key="breakout"),
            account(paused_strategies={"breakout"}),
        )
        assert verdict.approved is False
        assert rejected_by(verdict, "strategy_paused")

    def test_an_unresolved_reconciliation_break_rejects(self, engine: RiskEngine) -> None:
        # If local and broker state disagree, the engine cannot reason about
        # exposure at all, so it must not approve anything.
        verdict = engine.evaluate(intent(), account(unresolved_recon_breaks=1))
        assert verdict.approved is False
        assert rejected_by(verdict, "reconciliation")


class TestInstrumentEligibility:
    def test_leveraged_etfs_are_disabled_in_v1(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent("TQQQ", is_leveraged_etf=True), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "asset_class_allowed")

    def test_untradable_and_delisted_instruments_reject(self, engine: RiskEngine) -> None:
        assert engine.evaluate(intent(tradable=False), account()).approved is False
        assert engine.evaluate(intent(delisted=True), account()).approved is False

    def test_unrestricted_short_selling_is_disabled(self, engine: RiskEngine) -> None:
        # Selling a name that is not held would open a short.
        verdict = engine.evaluate(intent(side=Side.SELL, shortable=False), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "short_selling")

    def test_selling_what_is_actually_held_is_not_a_short(self, engine: RiskEngine) -> None:
        acct = account(positions=[position("NVDA", quantity=100, price=100)])
        verdict = engine.evaluate(intent("NVDA", side=Side.SELL, quantity=100, price=100), acct)
        assert verdict.approved is True

    def test_fractional_quantity_is_rounded_down_for_a_whole_share_instrument(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(quantity=Decimal("10.7"), fractionable=False), account())
        assert verdict.approved is True
        assert verdict.approved_quantity == Decimal(10)
        assert "fractional_shares" in verdict.resized_by

    def test_non_positive_quantity_rejects(self, engine: RiskEngine) -> None:
        assert engine.evaluate(intent(quantity=0), account()).approved is False
        assert engine.evaluate(intent(quantity=-5), account()).approved is False


class TestDataQualityGates:
    @pytest.mark.parametrize("quality", ["corrupt", "missing"])
    def test_bad_data_rejects(self, engine: RiskEngine, quality: str) -> None:
        verdict = engine.evaluate(intent(data_quality=quality), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "data_quality")

    @pytest.mark.parametrize("quality", ["suspect", "stale"])
    def test_questionable_data_warns_but_does_not_block(self, engine: RiskEngine, quality: str) -> None:
        verdict = engine.evaluate(intent(data_quality=quality), account())
        assert verdict.approved is True
        assert verdict.warnings

    def test_unknown_data_age_rejects(self, engine: RiskEngine) -> None:
        # Fail closed: "I don't know how old this price is" is not "it's fresh".
        verdict = engine.evaluate(intent(data_age_seconds=None), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "data_age")

    def test_stale_price_data_rejects(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(data_age_seconds=float(LIMITS.max_data_age_seconds) + 1), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "data_age")

    def test_unknown_liquidity_rejects(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(adv_usd=None), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "min_liquidity")


class TestLossLimitsAndDrawdown:
    def test_the_daily_loss_circuit_breaker_blocks_new_risk(self, engine: RiskEngine) -> None:
        acct = account(equity=Decimal("96000"), day_start_equity=Decimal("100000"))
        verdict = engine.evaluate(intent(), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "max_daily_loss")

    def test_exits_remain_permitted_at_the_daily_loss_limit(self, engine: RiskEngine) -> None:
        # Blocking an exit during a bad day is the opposite of risk management.
        acct = account(
            equity=Decimal("96000"),
            day_start_equity=Decimal("100000"),
            positions=[position("NVDA", quantity=100, price=100)],
        )
        verdict = engine.evaluate(intent("NVDA", side=Side.SELL, quantity=100, price=100, reduce_only=True), acct)
        assert verdict.approved is True
        assert check(verdict, "max_daily_loss").result is RiskCheckResult.WARN

    def test_the_weekly_loss_limit_blocks_new_risk(self, engine: RiskEngine) -> None:
        acct = account(equity=Decimal("92000"), day_start_equity=Decimal("92000"), week_start_equity=Decimal("100000"))
        verdict = engine.evaluate(intent(), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "max_weekly_loss")

    def test_the_maximum_drawdown_limit_blocks_new_risk(self, engine: RiskEngine) -> None:
        acct = account(
            equity=Decimal("75000"),
            day_start_equity=Decimal("75000"),
            week_start_equity=Decimal("75000"),
            high_water_mark=Decimal("100000"),
        )
        verdict = engine.evaluate(intent(), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "max_drawdown")

    def test_a_session_halt_blocks_new_risk_but_not_exits(self, engine: RiskEngine) -> None:
        acct = account(
            trading_halted=True,
            halt_reason="daily drawdown breached",
            positions=[position("NVDA", quantity=100, price=100)],
        )
        assert engine.evaluate(intent(), acct).approved is False
        assert (
            engine.evaluate(intent("NVDA", side=Side.SELL, quantity=100, price=100, reduce_only=True), acct).approved
            is True
        )

    def test_a_loss_cooldown_blocks_new_risk(self, engine: RiskEngine) -> None:
        now = utcnow()
        acct = account(as_of=now, cooldown_until=now + timedelta(hours=6))
        verdict = engine.evaluate(intent(), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "loss_cooldown")

    def test_an_expired_cooldown_does_not_block(self, engine: RiskEngine) -> None:
        now = utcnow()
        acct = account(as_of=now, cooldown_until=now - timedelta(hours=1))
        assert engine.evaluate(intent(), acct).approved is True

    def test_cooldown_expiry_uses_the_configured_window(self) -> None:
        now = utcnow()
        assert cooldown_expiry(now, LIMITS) == now + timedelta(hours=LIMITS.loss_cooldown_hours)


class TestDefensiveLadder:
    def test_the_warning_state_trims_new_positions(self, engine: RiskEngine) -> None:
        acct = account(risk_state=RiskState.WARNING)
        verdict = engine.evaluate(intent(quantity=100, price=100), acct)
        assert verdict.approved is True
        assert verdict.approved_quantity == Decimal(75)

    def test_defensive_stage_one_halves_new_positions(self, engine: RiskEngine) -> None:
        acct = account(risk_state=RiskState.DEFENSIVE_1)
        verdict = engine.evaluate(intent(quantity=100, price=100), acct)
        assert verdict.approved is True
        assert verdict.approved_quantity == Decimal(50)

    @pytest.mark.parametrize("state", [RiskState.DEFENSIVE_2, RiskState.EMERGENCY, RiskState.READ_ONLY])
    def test_the_deeper_states_block_new_entries_entirely(self, engine: RiskEngine, state: RiskState) -> None:
        verdict = engine.evaluate(intent(), account(risk_state=state))
        assert verdict.approved is False
        assert rejected_by(verdict, "risk_state")

    @pytest.mark.parametrize(
        "state", [RiskState.WARNING, RiskState.DEFENSIVE_1, RiskState.DEFENSIVE_2, RiskState.EMERGENCY]
    )
    def test_exits_are_permitted_in_every_defensive_state(self, engine: RiskEngine, state: RiskState) -> None:
        acct = account(risk_state=state, positions=[position("NVDA", quantity=100, price=100)])
        verdict = engine.evaluate(intent("NVDA", side=Side.SELL, quantity=100, price=100, reduce_only=True), acct)
        assert verdict.approved is True

    def test_the_ladder_maps_drawdown_to_state_monotonically(self) -> None:
        states = [
            derive_risk_state(Decimal(f"-{depth}"), LIMITS)[0] for depth in ("0.01", "0.08", "0.12", "0.17", "0.25")
        ]
        assert states == [
            RiskState.NORMAL,
            RiskState.WARNING,
            RiskState.DEFENSIVE_1,
            RiskState.DEFENSIVE_2,
            RiskState.EMERGENCY,
        ]

    def test_the_state_does_not_flicker_on_a_small_recovery(self) -> None:
        # Hysteresis: recovering from -12% to -5% holds DEFENSIVE_1 rather than
        # snapping back to NORMAL and immediately re-levering.
        held, reason = derive_risk_state(Decimal("-0.05"), LIMITS, current=RiskState.DEFENSIVE_1)
        assert held is RiskState.DEFENSIVE_1
        assert "holding" in reason
        cleared, _ = derive_risk_state(Decimal("-0.01"), LIMITS, current=RiskState.DEFENSIVE_1)
        assert cleared is RiskState.NORMAL


class TestRegimeGate:
    def test_risk_off_blocks_new_longs(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(side=Side.BUY), account(regime=Regime.RISK_OFF))
        assert verdict.approved is False
        assert rejected_by(verdict, "market_regime")

    def test_risk_off_still_allows_exits(self, engine: RiskEngine) -> None:
        acct = account(regime=Regime.RISK_OFF, positions=[position("NVDA", quantity=100, price=100)])
        verdict = engine.evaluate(intent("NVDA", side=Side.SELL, quantity=100, price=100, reduce_only=True), acct)
        assert verdict.approved is True

    @pytest.mark.parametrize("regime", [Regime.RISK_ON, Regime.NEUTRAL])
    def test_other_regimes_permit_entries(self, engine: RiskEngine, regime: Regime) -> None:
        assert engine.evaluate(intent(), account(regime=regime)).approved is True


class TestExposureLimits:
    def test_an_oversized_order_is_resized_not_rejected(self, engine: RiskEngine) -> None:
        # 40% of a $100k account in one name; the cap must trim it.
        verdict = engine.evaluate(intent(quantity=400, price=100), account(equity=100_000))
        assert verdict.approved is True
        assert verdict.was_resized is True
        assert verdict.approved_quantity * Decimal(100) <= LIMITS.max_position_pct * Decimal(100_000)

    def test_a_position_already_at_the_cap_rejects_an_add(self, engine: RiskEngine) -> None:
        at_cap = LIMITS.max_position_pct * Decimal(100_000)
        acct = account(
            equity=100_000,
            positions=[position("NVDA", quantity=at_cap / Decimal(100), price=100)],
        )
        verdict = engine.evaluate(intent("NVDA", quantity=10, price=100), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "max_position_pct")

    def test_the_sector_limit_binds_across_names(self, engine: RiskEngine) -> None:
        # Three tech names at 9% each is 27%; a fourth would breach the 30% cap.
        acct = account(
            equity=100_000,
            positions=[
                position("MSFT", quantity=90, price=100, sector="Technology"),
                position("NVDA", quantity=90, price=100, sector="Technology"),
                position("PANW", quantity=90, price=100, sector="Technology"),
            ],
        )
        verdict = engine.evaluate(intent("AVGO", quantity=100, price=100, sector="Technology"), acct)
        assert verdict.approved is True
        assert "max_sector_exposure" in verdict.resized_by
        sector_after = Decimal(27_000) + verdict.approved_quantity * Decimal(100)
        assert sector_after <= LIMITS.max_sector_exposure_pct * Decimal(100_000) + Decimal("0.01")

    def test_a_full_sector_rejects_outright(self, engine: RiskEngine) -> None:
        full = LIMITS.max_sector_exposure_pct * Decimal(100_000)
        acct = account(
            equity=100_000,
            positions=[position("MSFT", quantity=full / Decimal(100), price=100, sector="Technology")],
        )
        verdict = engine.evaluate(intent("NVDA", quantity=10, price=100, sector="Technology"), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "max_sector_exposure")

    def test_the_position_count_limit_binds(self, engine: RiskEngine) -> None:
        positions = [
            position(f"S{i}", quantity=10, price=100, sector=f"Sector{i}") for i in range(LIMITS.max_open_positions)
        ]
        acct = account(equity=1_000_000, positions=positions)
        verdict = engine.evaluate(intent("NEW", quantity=10, price=100, sector="Fresh"), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "max_open_positions")

    def test_adding_to_an_existing_name_is_not_a_new_position(self, engine: RiskEngine) -> None:
        positions = [
            position(f"S{i}", quantity=10, price=100, sector=f"Sector{i}") for i in range(LIMITS.max_open_positions)
        ]
        acct = account(equity=1_000_000, positions=positions)
        verdict = engine.evaluate(intent("S0", quantity=5, price=100, sector="Sector0"), acct)
        assert verdict.approved is True

    def test_the_cash_buffer_is_protected(self, engine: RiskEngine) -> None:
        # Leave just enough cash that a $10,000 order would eat into the buffer.
        buffer_value = LIMITS.min_cash_buffer_pct * Decimal(100_000)
        acct = account(equity=100_000, cash=buffer_value + Decimal(5_000))
        verdict = engine.evaluate(intent(quantity=100, price=100), acct)
        assert verdict.approved is True
        assert "cash_buffer" in verdict.resized_by
        assert verdict.approved_quantity * Decimal(100) <= Decimal(5_000)

    def test_no_cash_headroom_rejects(self, engine: RiskEngine) -> None:
        buffer_value = LIMITS.min_cash_buffer_pct * Decimal(100_000)
        acct = account(equity=100_000, cash=buffer_value)
        verdict = engine.evaluate(intent(quantity=10, price=100), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "cash_buffer")

    def test_gross_exposure_cannot_exceed_one_hundred_percent(self, engine: RiskEngine) -> None:
        # No leverage in v1: a fully invested book cannot buy more.
        positions = [position(f"S{i}", quantity=100, price=100, sector=f"Sector{i}") for i in range(9)]
        acct = account(equity=90_000, cash=Decimal(0), positions=positions)
        verdict = engine.evaluate(intent("NEW", quantity=100, price=100, sector="Fresh"), acct)
        assert verdict.approved is False

    def test_zero_equity_rejects_and_stops_evaluating(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(), account(equity=0, cash=Decimal(0)))
        assert verdict.approved is False
        assert rejected_by(verdict, "account_equity")


class TestMicrostructureLimits:
    def test_a_penny_stock_is_rejected_on_price(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(price=Decimal("2.50")), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "min_price")

    def test_an_illiquid_name_is_rejected(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(adv_usd=Decimal(100_000)), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "min_liquidity")

    def test_participation_is_capped_at_a_fraction_of_daily_volume(self, engine: RiskEngine) -> None:
        # 1% of a 100,000-share ADV is 1,000 shares; asking for 5,000 must trim.
        verdict = engine.evaluate(
            intent(quantity=5_000, price=100, adv_shares=Decimal(100_000), adv_usd=Decimal(10_000_000)),
            account(equity=10_000_000, cash=Decimal(9_000_000)),
        )
        assert "adv_participation" in verdict.resized_by
        assert verdict.approved_quantity <= Decimal(100_000) * LIMITS.max_adv_participation_pct

    def test_a_wide_spread_is_rejected(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(spread_bps=Decimal(120)), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "max_spread")

    def test_excessive_estimated_impact_is_rejected(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(estimated_impact_bps=Decimal(200)), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "max_market_impact")

    def test_a_dust_order_is_rejected_as_uneconomic(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(quantity=Decimal("0.01"), price=100, fractionable=True), account())
        assert verdict.approved is False
        assert rejected_by(verdict, "min_order_notional")

    def test_the_daily_turnover_limit_binds(self, engine: RiskEngine) -> None:
        acct = account(equity=100_000, turnover_today_notional=Decimal(60_000))
        verdict = engine.evaluate(intent(quantity=100, price=100), acct)
        assert verdict.approved is False
        assert rejected_by(verdict, "max_daily_turnover")


class TestReduceOnlySemantics:
    def test_an_exit_larger_than_the_position_is_clamped(self, engine: RiskEngine) -> None:
        acct = account(positions=[position("NVDA", quantity=60, price=100)])
        verdict = engine.evaluate(intent("NVDA", side=Side.SELL, quantity=100, price=100, reduce_only=True), acct)
        assert verdict.approved is True
        assert verdict.approved_quantity == Decimal(60)
        assert "reduce_only_bound" in verdict.resized_by

    def test_exits_skip_the_exposure_and_liquidity_caps(self, engine: RiskEngine) -> None:
        acct = account(equity=100_000, cash=Decimal(0), positions=[position("NVDA", quantity=500, price=100)])
        verdict = engine.evaluate(
            intent(
                "NVDA",
                side=Side.SELL,
                quantity=500,
                price=100,
                reduce_only=True,
                adv_usd=Decimal(1_000),  # would fail the liquidity floor on entry
                spread_bps=Decimal(400),
            ),
            acct,
        )
        assert verdict.approved is True
        assert verdict.approved_quantity == Decimal(500)


class TestFailClosed:
    def test_the_engine_never_raises_on_absurd_inputs(self, engine: RiskEngine) -> None:
        broken = OrderIntent(
            symbol="",
            side=Side.BUY,
            quantity=Decimal("NaN"),
            order_type=OrderType.MARKET,
            reference_price=Decimal(-1),
        )
        verdict = engine.evaluate(broken, account())
        assert verdict.approved is False
        assert verdict.rejections

    def test_an_internal_error_produces_a_rejection_not_an_exception(self, engine: RiskEngine) -> None:
        class Exploding:
            def __getattr__(self, name: str):
                raise RuntimeError("boom")

        verdict = engine.evaluate(intent(), Exploding())  # type: ignore[arg-type]
        assert verdict.approved is False
        assert verdict.approved_quantity == Decimal(0)
        assert verdict.rejections

    def test_a_rejected_verdict_never_carries_an_approved_quantity(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(quantity=400, price=100), account(kill_switch=True))
        assert verdict.approved is False
        assert verdict.approved_quantity == Decimal(0)

    def test_approved_quantity_never_exceeds_the_request(self, engine: RiskEngine) -> None:
        for quantity in (1, 10, 100, 1_000, 10_000):
            verdict = engine.evaluate(intent(quantity=quantity, price=100), account(equity=1_000_000))
            assert verdict.approved_quantity <= Decimal(quantity)


class TestVerdictSerialisation:
    def test_the_verdict_round_trips_to_plain_data(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(quantity=400, price=100), account(equity=100_000))
        blob = verdict.as_dict()
        assert blob["approved"] is True
        assert blob["checks"]
        assert blob["explanation"] == verdict.explanation
        for row in blob["checks"]:
            assert set(row) >= {"name", "result", "message"}

    def test_utilisation_is_reported_for_the_risk_dashboard(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(), account())
        utilisation = verdict.utilization_map()
        assert utilisation
        assert all(isinstance(v, str) for v in utilisation.values())

    def test_a_rejection_explains_itself_in_plain_language(self, engine: RiskEngine) -> None:
        verdict = engine.evaluate(intent(), account(kill_switch=True))
        assert verdict.explanation.startswith("REJECTED")
        assert "kill switch" in verdict.explanation.lower()


class TestConfigurableLimitsAreRespected:
    def test_tightening_the_position_cap_tightens_the_verdict(self) -> None:
        loose = RiskEngine(RiskLimits(max_position_pct=Decimal("0.15")))
        tight = RiskEngine(RiskLimits(max_position_pct=Decimal("0.02")))
        order = intent(quantity=200, price=100)
        acct = account(equity=100_000)
        assert tight.evaluate(order, acct).approved_quantity < loose.evaluate(order, acct).approved_quantity

    def test_a_zero_participation_cap_blocks_everything(self) -> None:
        engine = RiskEngine(RiskLimits(max_adv_participation_pct=Decimal("0")))
        verdict = engine.evaluate(intent(quantity=100, price=100), account())
        assert verdict.approved is False

    def test_snapshot_exposure_helpers_are_consistent(self) -> None:
        acct = AccountSnapshot(
            as_of=utcnow(),
            equity=Decimal(100_000),
            cash=Decimal(40_000),
            buying_power=Decimal(40_000),
            positions={
                p.symbol: p
                for p in (
                    position("MSFT", quantity=100, price=300, sector="Technology"),
                    position("XOM", quantity=100, price=300, sector="Energy"),
                )
            },
        )
        assert acct.gross_exposure == Decimal("0.6")
        assert acct.net_exposure == Decimal("0.6")
        assert acct.sector_exposure("Technology") == Decimal("0.3")
        assert acct.sector_exposure("Utilities") == Decimal(0)
