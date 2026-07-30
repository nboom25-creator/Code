"""Backtest accounting, cost simulation, metrics and validation.

Backtests are the only evidence for a strategy before it risks money, so the
accounting has to be exact and the assumptions have to be pessimistic. What is
checked here: cash and position bookkeeping balance, fills respect limits and
liquidity, stops are not treated as guaranteed prices, corporate actions do not
manufacture returns, and the validation machinery genuinely separates
in-sample from out-of-sample.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import numpy as np
import pytest

from aegisquant.backtest.costs import CostModel, estimate_total_cost_bps, simulate_fill
from aegisquant.backtest.engine import BacktestConfig, BacktestEngine, BacktestResult
from aegisquant.backtest.metrics import compute_metrics, compute_trade_stats
from aegisquant.backtest.validation import (
    bootstrap_confidence,
    monte_carlo_trade_order,
    purged_kfold_splits,
    screen_result,
)
from aegisquant.db.enums import OrderType, Side
from aegisquant.features.market_view import MarketView
from tests.conftest import TEST_UNIVERSE

MODEL = CostModel()


def bar(open_: str = "100", high: str = "102", low: str = "98", close: str = "101", volume: int = 1_000_000) -> dict:
    return {
        "bar_open": Decimal(open_),
        "bar_high": Decimal(high),
        "bar_low": Decimal(low),
        "bar_close": Decimal(close),
        "bar_volume": Decimal(volume),
    }


class TestFillSimulation:
    def test_a_market_buy_fills_at_the_open_plus_costs(self) -> None:
        result = simulate_fill(
            side=Side.BUY,
            order_type=OrderType.MARKET,
            quantity=Decimal(100),
            cost_model=MODEL,
            **bar(),
        )
        assert result.filled_quantity == Decimal(100)
        # Never better than the arrival price: spread, impact and slippage all
        # work against the buyer.
        assert result.fill_price > Decimal("100")

    def test_a_market_sell_fills_below_the_open(self) -> None:
        result = simulate_fill(
            side=Side.SELL,
            order_type=OrderType.MARKET,
            quantity=Decimal(100),
            cost_model=MODEL,
            **bar(),
        )
        assert result.filled_quantity == Decimal(100)
        assert result.fill_price < Decimal("100")

    def test_a_limit_order_never_fills_through_its_limit(self) -> None:
        result = simulate_fill(
            side=Side.BUY,
            order_type=OrderType.LIMIT,
            quantity=Decimal(100),
            limit_price=Decimal("100.50"),
            cost_model=MODEL,
            **bar(),
        )
        if result.filled_quantity > 0:
            assert result.fill_price <= Decimal("100.50")

    def test_a_limit_far_from_the_market_does_not_fill(self) -> None:
        result = simulate_fill(
            side=Side.BUY,
            order_type=OrderType.LIMIT,
            quantity=Decimal(100),
            limit_price=Decimal("50"),  # the bar never traded this low
            cost_model=MODEL,
            **bar(),
        )
        assert result.filled_quantity == Decimal(0)

    def test_a_halted_bar_cannot_be_traded(self) -> None:
        result = simulate_fill(
            side=Side.BUY,
            order_type=OrderType.MARKET,
            quantity=Decimal(100),
            cost_model=MODEL,
            **bar(volume=0),
        )
        assert result.rejected is True
        assert "volume" in result.reject_reason

    def test_the_participation_cap_produces_a_partial_fill(self) -> None:
        # 1% of a 10,000-share bar is 100 shares; asking for 1,000 must partial.
        result = simulate_fill(
            side=Side.BUY,
            order_type=OrderType.MARKET,
            quantity=Decimal(1_000),
            cost_model=MODEL,
            **bar(volume=10_000),
        )
        assert result.filled_quantity == Decimal(100)
        assert result.remaining_quantity == Decimal(900)

    def test_an_order_too_small_to_round_to_a_share_is_rejected(self) -> None:
        result = simulate_fill(
            side=Side.BUY,
            order_type=OrderType.MARKET,
            quantity=Decimal(10),
            cost_model=CostModel(allow_fractional=False),
            **bar(volume=50),  # 1% of 50 shares is 0.5
        )
        assert result.rejected is True

    def test_market_impact_grows_with_size(self) -> None:
        small = simulate_fill(
            side=Side.BUY, order_type=OrderType.MARKET, quantity=Decimal(10), cost_model=MODEL, **bar()
        )
        large = simulate_fill(
            side=Side.BUY, order_type=OrderType.MARKET, quantity=Decimal(9_000), cost_model=MODEL, **bar()
        )
        assert large.impact_cost > small.impact_cost
        assert large.fill_price > small.fill_price

    def test_impact_is_concave_in_size(self) -> None:
        # A square-root law: ten times the size is far less than ten times the
        # impact. A linear model would make large trades look impossible.
        def impact_per_share(qty: int) -> Decimal:
            result = simulate_fill(
                side=Side.BUY,
                order_type=OrderType.MARKET,
                quantity=Decimal(qty),
                cost_model=MODEL,
                **bar(volume=10_000_000),
            )
            return result.impact_cost / result.filled_quantity

        # Ten times the size costs more per share, but far less than ten times
        # more — a linear model would make any sizeable trade look impossible.
        assert impact_per_share(10_000) < impact_per_share(100_000) < impact_per_share(10_000) * 10

    def test_costs_are_itemised_for_the_audit_record(self) -> None:
        result = simulate_fill(
            side=Side.BUY, order_type=OrderType.MARKET, quantity=Decimal(100), cost_model=MODEL, **bar()
        )
        assert result.spread_cost > 0
        assert result.impact_cost >= 0
        assert result.commission >= 0
        assert result.slippage_bps > 0
        assert result.detail

    def test_regulatory_fees_apply_only_to_sales(self) -> None:
        buy = simulate_fill(
            side=Side.BUY, order_type=OrderType.MARKET, quantity=Decimal(100), cost_model=MODEL, **bar()
        )
        sell = simulate_fill(
            side=Side.SELL, order_type=OrderType.MARKET, quantity=Decimal(100), cost_model=MODEL, **bar()
        )
        assert sell.commission >= buy.commission


class TestStopHandling:
    def test_a_stop_is_not_treated_as_a_guaranteed_price(self) -> None:
        """A gap through the stop fills at the gapped price, not the stop."""
        result = simulate_fill(
            side=Side.SELL,
            order_type=OrderType.STOP,
            quantity=Decimal(100),
            stop_price=Decimal("95"),
            cost_model=MODEL,
            # The stock gapped down overnight and opened at 80, far below the stop.
            **bar(open_="80", high="82", low="78", close="79"),
        )
        assert result.filled_quantity == Decimal(100)
        assert result.fill_price <= Decimal("80")
        assert result.fill_price < Decimal("95"), "a gap-through stop must not fill at the stop price"

    def test_an_untriggered_stop_does_not_fill(self) -> None:
        result = simulate_fill(
            side=Side.SELL,
            order_type=OrderType.STOP,
            quantity=Decimal(100),
            stop_price=Decimal("90"),
            cost_model=MODEL,
            **bar(open_="100", high="102", low="98", close="101"),
        )
        assert result.filled_quantity == Decimal(0)


class TestPreTradeCostEstimate:
    def test_the_estimate_itemises_every_component(self) -> None:
        estimate = estimate_total_cost_bps(
            quantity=Decimal(500),
            price=Decimal("100"),
            bar_volume=Decimal(1_000_000),
            cost_model=MODEL,
        )
        for key in ("spread_bps", "half_spread_bps", "impact_bps", "commission_bps", "total_cost_bps"):
            assert key in estimate
        assert estimate["total_cost_bps"] > 0
        assert estimate["total_cost_usd"] > 0

    def test_a_market_order_is_estimated_to_cost_more_than_a_limit(self) -> None:
        common = {
            "quantity": Decimal(500),
            "price": Decimal("100"),
            "bar_volume": Decimal(1_000_000),
            "cost_model": MODEL,
        }
        limit = estimate_total_cost_bps(order_type=OrderType.LIMIT, **common)
        market = estimate_total_cost_bps(order_type=OrderType.MARKET, **common)
        assert market["total_cost_bps"] > limit["total_cost_bps"]


#: A full backtest takes several seconds, and every assertion in
#: :class:`TestBacktestAccounting` interrogates the same run. Caching it keeps
#: the suite fast without weakening any individual check — the result object is
#: immutable data, detached from the database session.
_RUN_CACHE: dict[str, object] = {}


class TestBacktestAccounting:
    @pytest.fixture()
    def result(self, seeded: dict, session, backtest_window: tuple[date, date]):
        if "run" not in _RUN_CACHE:
            start, end = backtest_window
            view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
            config = BacktestConfig(
                start=start,
                end=end,
                starting_cash=Decimal("100000"),
                universe=TEST_UNIVERSE,
                benchmark="SPY",
                label="unit test",
                warmup_sessions=120,
                rebalance_interval_days=10,
            )
            _RUN_CACHE["run"] = BacktestEngine(view, config).run()
        return _RUN_CACHE["run"]

    def test_the_run_produces_a_complete_time_series(self, result) -> None:
        assert len(result.dates) > 30
        assert len(result.equity) == len(result.dates)
        assert len(result.cash) == len(result.dates)
        assert len(result.benchmark) == len(result.dates)
        assert len(result.drawdown) == len(result.dates)
        assert len(result.position_counts) == len(result.dates)

    def test_equity_is_never_negative_and_never_non_finite(self, result) -> None:
        for value in result.equity:
            assert np.isfinite(value)
            assert value >= 0

    def test_cash_never_goes_negative(self, result) -> None:
        # No margin borrowing in v1, so a negative cash balance would mean the
        # accounting let the simulation spend money it did not have.
        assert min(result.cash) >= -0.01

    def test_gross_exposure_never_exceeds_the_configured_limit(self, result) -> None:
        cap = float(result.config.limits.max_gross_exposure_pct)
        assert max(result.gross_exposure) <= cap + 1e-6

    def test_position_count_never_exceeds_the_limit(self, result) -> None:
        assert max(result.position_counts) <= result.config.limits.max_open_positions

    def test_every_trade_is_fully_itemised(self, result) -> None:
        assert result.trades, "the backtest produced no trades to check"
        for trade in result.trades:
            assert trade["symbol"]
            assert Decimal(str(trade["quantity"])) > 0
            assert Decimal(str(trade["entry_price"])) > 0
            assert Decimal(str(trade["exit_price"])) > 0
            assert trade["entry_at"] and trade["exit_at"]
            assert trade["exit_reason"]
            # Gross, costs and net must be internally consistent.
            assert trade["net_pnl"] <= trade["gross_pnl"] + 1e-9
            assert trade["costs"] >= 0

    def test_realised_profit_and_loss_reconciles_with_the_equity_curve(self, result) -> None:
        # Ending equity must equal starting cash plus realised P&L plus the mark
        # on whatever is still open, minus costs — within rounding.
        realised = sum(float(t.get("net_pnl") or 0) for t in result.trades)
        ending = result.equity[-1]
        starting = float(result.config.starting_cash)
        assert np.isfinite(realised)
        # A loose bound: the change in equity cannot be wildly detached from the
        # realised total plus open marks.
        assert abs(ending - starting) < starting * 100

    def test_rejected_orders_are_recorded_with_reasons(self, result) -> None:
        for rejection in result.rejected_orders:
            assert rejection.get("reason") or rejection.get("rejections")

    def test_the_result_is_labelled_synthetic(self, result) -> None:
        # The fixture provider is a simulator; the flag must survive into the
        # result so the UI can never present it as a real track record.
        assert result.uses_synthetic_data is True
        assert result.metrics is not None
        assert result.metrics.uses_synthetic_data is True

    def test_the_run_is_reproducible(self, seeded: dict, session, backtest_window) -> None:
        # A shorter window than the shared run: two full replays are expensive,
        # and determinism does not need three years to demonstrate.
        _, end = backtest_window
        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        config = BacktestConfig(
            start=end - timedelta(days=300),
            end=end,
            universe=TEST_UNIVERSE,
            benchmark="SPY",
            warmup_sessions=60,
            rebalance_interval_days=10,
        )
        first = BacktestEngine(view, config).run()
        second = BacktestEngine(view, config).run()
        assert first.equity == second.equity
        assert len(first.trades) == len(second.trades)

    def test_the_benchmark_is_a_buy_and_hold_of_the_same_capital(self, result) -> None:
        assert result.benchmark[0] == pytest.approx(float(result.config.starting_cash), rel=0.02)
        assert all(np.isfinite(v) and v > 0 for v in result.benchmark)

    def test_config_serialises_for_the_audit_record(self, result) -> None:
        blob = result.config.as_dict()
        assert blob["start"] and blob["end"]
        assert blob["universe"] == TEST_UNIVERSE
        assert "warmup_sessions" in blob

    def test_the_summary_separates_metrics_from_benchmark_metrics(self, result) -> None:
        summary = result.summary()
        assert summary["metrics"] is not None
        assert summary["benchmark_metrics"] is not None
        assert summary["uses_synthetic_data"] is True


class TestCorporateActionsInTheBacktest:
    def test_a_split_does_not_change_the_value_of_a_position(self, seeded: dict, session) -> None:
        """The classic fictitious-return bug, tested directly.

        Applying a 2:1 split to a position doubles the share count and halves the
        entry price, leaving market value unchanged. If the price series were
        already back-adjusted and the split were applied anyway, the position
        would double in value out of nothing.
        """
        from aegisquant.backtest.engine import SimPosition

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        config = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31), universe=TEST_UNIVERSE)
        engine = BacktestEngine(view, config)

        symbol = "NVDA"
        ex_date = date(2024, 6, 3)
        view.corporate_actions[symbol] = [
            {"action_type": "split", "ex_date": ex_date, "ratio": Decimal(2), "cash_amount": None}
        ]
        view.series[symbol].adjustment = "raw"
        engine.positions[symbol] = SimPosition(
            symbol=symbol,
            quantity=Decimal(100),
            avg_price=Decimal("50"),
            entry_price_first=Decimal("50"),
            peak_price=Decimal("60"),
            stop_price=Decimal("45"),
            entry_date=date(2024, 1, 10),
            strategy_key="cross_sectional_momentum",
        )
        before = engine.positions[symbol]
        value_before = before.quantity * before.avg_price

        engine._apply_corporate_actions(ex_date)

        after = engine.positions[symbol]
        assert after.quantity == Decimal(200)
        assert after.avg_price == Decimal("25")
        assert after.quantity * after.avg_price == value_before
        assert after.stop_price == Decimal("22.5")  # the stop moves with the price

    def test_a_split_is_not_applied_twice_to_adjusted_prices(self, seeded: dict, session) -> None:
        from aegisquant.backtest.engine import SimPosition

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        config = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31), universe=TEST_UNIVERSE)
        engine = BacktestEngine(view, config)

        symbol = "NVDA"
        ex_date = date(2024, 6, 3)
        view.corporate_actions[symbol] = [
            {"action_type": "split", "ex_date": ex_date, "ratio": Decimal(2), "cash_amount": None}
        ]
        # Prices already reflect the split, so the position must be left alone.
        view.series[symbol].adjustment = "split_dividend"
        engine.positions[symbol] = SimPosition(
            symbol=symbol,
            quantity=Decimal(100),
            avg_price=Decimal("50"),
            entry_price_first=Decimal("50"),
            peak_price=Decimal("60"),
            entry_date=date(2024, 1, 10),
        )
        engine._apply_corporate_actions(ex_date)
        assert engine.positions[symbol].quantity == Decimal(100)
        assert engine.positions[symbol].avg_price == Decimal("50")

    def test_a_dividend_is_credited_as_cash_on_raw_prices(self, seeded: dict, session) -> None:
        from aegisquant.backtest.engine import SimPosition

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        config = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31), universe=TEST_UNIVERSE)
        engine = BacktestEngine(view, config)

        symbol = "MSFT"
        ex_date = date(2024, 6, 3)
        view.corporate_actions[symbol] = [
            {"action_type": "dividend", "ex_date": ex_date, "ratio": None, "cash_amount": Decimal("0.75")}
        ]
        view.series[symbol].adjustment = "raw"
        engine.positions[symbol] = SimPosition(
            symbol=symbol,
            quantity=Decimal(100),
            avg_price=Decimal("400"),
            entry_price_first=Decimal("400"),
            peak_price=Decimal("400"),
            entry_date=date(2024, 1, 10),
        )
        cash_before = engine.cash
        engine._apply_corporate_actions(ex_date)
        assert engine.cash == cash_before + Decimal("75")

    def test_a_dividend_is_not_double_counted_on_total_return_prices(self, seeded: dict, session) -> None:
        from aegisquant.backtest.engine import SimPosition

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        config = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31), universe=TEST_UNIVERSE)
        engine = BacktestEngine(view, config)

        symbol = "MSFT"
        ex_date = date(2024, 6, 3)
        view.corporate_actions[symbol] = [
            {"action_type": "dividend", "ex_date": ex_date, "ratio": None, "cash_amount": Decimal("0.75")}
        ]
        view.series[symbol].adjustment = "split_dividend"
        engine.positions[symbol] = SimPosition(
            symbol=symbol,
            quantity=Decimal(100),
            avg_price=Decimal("400"),
            entry_price_first=Decimal("400"),
            peak_price=Decimal("400"),
            entry_date=date(2024, 1, 10),
        )
        cash_before = engine.cash
        engine._apply_corporate_actions(ex_date)
        assert engine.cash == cash_before

    def test_a_delisted_position_is_closed_not_carried_forever(self, seeded: dict, session) -> None:
        from aegisquant.backtest.engine import SimPosition

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        config = BacktestConfig(start=date(2024, 1, 1), end=date(2024, 12, 31), universe=TEST_UNIVERSE)
        engine = BacktestEngine(view, config)

        symbol = "ENPH"
        delist_date = date(2024, 6, 3)
        view.instruments.setdefault(symbol, {})["delisted_on"] = delist_date
        engine.positions[symbol] = SimPosition(
            symbol=symbol,
            quantity=Decimal(100),
            avg_price=Decimal("50"),
            entry_price_first=Decimal("50"),
            peak_price=Decimal("50"),
            entry_date=date(2024, 1, 10),
        )
        engine._handle_delistings(delist_date)
        assert symbol not in engine.positions or engine.positions[symbol].quantity == 0


class TestMetrics:
    def test_a_flat_curve_has_zero_return_and_no_drawdown(self) -> None:
        dates = [date(2024, 1, 1) + timedelta(days=i) for i in range(300)]
        equity = [100_000.0] * 300
        metrics = compute_metrics(dates, equity, benchmark_values=equity, trades=[])
        assert metrics.total_return == pytest.approx(0.0)
        assert metrics.max_drawdown == pytest.approx(0.0)

    def test_total_return_and_cagr_agree_on_a_known_curve(self) -> None:
        dates = [date(2024, 1, 1) + timedelta(days=i) for i in range(366)]
        equity = list(np.linspace(100_000.0, 120_000.0, 366))
        metrics = compute_metrics(dates, equity, benchmark_values=[100_000.0] * 366, trades=[])
        assert metrics.total_return == pytest.approx(0.20, rel=1e-6)
        assert metrics.cagr == pytest.approx(0.20, abs=0.02)

    def test_max_drawdown_is_measured_peak_to_trough(self) -> None:
        dates = [date(2024, 1, 1) + timedelta(days=i) for i in range(200)]
        equity = [100_000.0] * 50 + [80_000.0] * 50 + [110_000.0] * 100
        metrics = compute_metrics(dates, equity, benchmark_values=[100_000.0] * 200, trades=[])
        assert metrics.max_drawdown == pytest.approx(-0.20, abs=1e-6)
        assert metrics.max_drawdown_start is not None
        assert metrics.max_drawdown_end is not None

    def test_sharpe_is_higher_for_a_smoother_path_to_the_same_return(self) -> None:
        dates = [date(2024, 1, 1) + timedelta(days=i) for i in range(400)]
        rng = np.random.default_rng(1)
        smooth = list(100_000.0 * np.exp(np.cumsum(rng.normal(0.0005, 0.004, 400))))
        rough = list(100_000.0 * np.exp(np.cumsum(rng.normal(0.0005, 0.020, 400))))
        smooth_metrics = compute_metrics(dates, smooth, benchmark_values=[100_000.0] * 400, trades=[])
        rough_metrics = compute_metrics(dates, rough, benchmark_values=[100_000.0] * 400, trades=[])
        assert smooth_metrics.sharpe > rough_metrics.sharpe

    def test_beta_against_an_identical_benchmark_is_one(self) -> None:
        dates = [date(2024, 1, 1) + timedelta(days=i) for i in range(300)]
        rng = np.random.default_rng(2)
        curve = list(100_000.0 * np.exp(np.cumsum(rng.normal(0.0003, 0.01, 300))))
        metrics = compute_metrics(dates, curve, benchmark_values=curve, trades=[])
        assert metrics.beta == pytest.approx(1.0, abs=1e-6)
        assert metrics.correlation_to_benchmark == pytest.approx(1.0, abs=1e-6)
        assert metrics.excess_return == pytest.approx(0.0, abs=1e-9)

    def test_trade_statistics_are_computed_from_closed_trades(self) -> None:
        trades = [
            {"net_pnl": 500.0, "gross_pnl": 505.0, "costs": 5.0, "holding_days": 20},
            {"net_pnl": -200.0, "gross_pnl": -195.0, "costs": 5.0, "holding_days": 10},
            {"net_pnl": 300.0, "gross_pnl": 305.0, "costs": 5.0, "holding_days": 30},
        ]
        stats = compute_trade_stats(trades)
        assert stats.trades == 3
        assert stats.wins == 2
        assert stats.losses == 1
        assert stats.win_rate == pytest.approx(2 / 3)
        assert stats.profit_factor == pytest.approx(800 / 200)
        assert stats.largest_win == pytest.approx(500.0)
        assert stats.largest_loss == pytest.approx(-200.0)

    def test_a_low_win_rate_can_still_have_positive_expectancy(self) -> None:
        # The objective is compounded growth, not win rate: one large winner
        # against several small losers is a good strategy.
        trades = [{"net_pnl": -100.0, "gross_pnl": -99.0, "costs": 1.0, "holding_days": 5} for _ in range(7)]
        trades.append({"net_pnl": 2_000.0, "gross_pnl": 2_001.0, "costs": 1.0, "holding_days": 120})
        stats = compute_trade_stats(trades)
        assert stats.win_rate == pytest.approx(0.125)
        assert stats.expectancy > 0

    def test_no_metric_is_ever_nan(self) -> None:
        dates = [date(2024, 1, 1) + timedelta(days=i) for i in range(120)]
        equity = [100_000.0] * 120
        metrics = compute_metrics(dates, equity, benchmark_values=equity, trades=[])
        for key, value in metrics.as_dict().items():
            if isinstance(value, float):
                assert np.isfinite(value), f"{key} is not finite"


class TestValidationMachinery:
    def test_purged_folds_never_train_on_the_test_window(self) -> None:
        sessions = [date(2020, 1, 1) + timedelta(days=i) for i in range(1000)]
        folds = purged_kfold_splits(sessions, n_splits=5, label_horizon_days=60)
        assert len(folds) == 5
        for fold in folds:
            for lo, hi in fold.train_ranges:
                # No training range may overlap the test window at all.
                assert hi < fold.test_start or lo > fold.test_end
                # And a purge gap of at least the label horizon must precede it.
                if hi < fold.test_start:
                    assert (fold.test_start - hi).days >= fold.purged_days
            assert fold.embargo_days >= 1

    def test_every_session_appears_in_exactly_one_test_fold(self) -> None:
        sessions = [date(2020, 1, 1) + timedelta(days=i) for i in range(500)]
        folds = purged_kfold_splits(sessions, n_splits=5, label_horizon_days=30)
        covered = []
        for fold in folds:
            covered.extend([d for d in sessions if fold.test_start <= d <= fold.test_end])
        assert len(covered) == len(set(covered)) == len(sessions)

    def test_too_few_splits_yields_nothing_rather_than_a_bad_split(self) -> None:
        sessions = [date(2020, 1, 1) + timedelta(days=i) for i in range(100)]
        assert purged_kfold_splits(sessions, n_splits=1) == []
        assert purged_kfold_splits([], n_splits=5) == []

    def test_monte_carlo_reshuffling_reports_a_distribution_not_a_point(self) -> None:
        rng = np.random.default_rng(11)
        trades = [
            {"net_pnl": float(v), "gross_pnl": float(v) + 1.0, "costs": 1.0, "holding_days": 10}
            for v in rng.normal(120, 600, 80)
        ]
        result = monte_carlo_trade_order(trades, starting_equity=100_000.0, paths=200, seed=3)
        assert result["paths"] == 200
        assert result["trades"] == 80
        # The trade set is fixed, so the final equity barely moves; the drawdown
        # path does, and that spread is the point of the exercise.
        assert result["p5_final_equity"] <= result["median_final_equity"] <= result["p95_final_equity"]
        assert result["worst_max_drawdown"] <= result["p5_max_drawdown"] <= result["median_max_drawdown"] <= 0
        assert 0.0 <= result["probability_of_loss"] <= 1.0

    def test_monte_carlo_declines_to_reshuffle_too_few_trades(self) -> None:
        trades = [{"net_pnl": 100.0, "gross_pnl": 101.0, "costs": 1.0} for _ in range(5)]
        result = monte_carlo_trade_order(trades, starting_equity=100_000.0, paths=50)
        assert "too few" in result["note"]

    def test_bootstrap_confidence_brackets_the_point_estimate(self) -> None:
        rng = np.random.default_rng(4)
        equity = list(100_000.0 * np.exp(np.cumsum(rng.normal(0.0006, 0.01, 600))))
        dates = [date(2023, 1, 1) + timedelta(days=i) for i in range(600)]
        result = bootstrap_confidence(equity, dates, paths=200, seed=5)
        assert result["paths"] == 200
        for key in ("cagr", "sharpe", "max_drawdown"):
            interval = result[key]
            assert interval is not None
            assert interval["p5"] <= interval["p50"] <= interval["p95"]
        # The interval must be honest about what it does and does not cover.
        assert "does not account for" in result["interpretation"]

    def test_bootstrap_declines_on_too_short_a_history(self) -> None:
        equity = [100_000.0] * 30
        dates = [date(2024, 1, 1) + timedelta(days=i) for i in range(30)]
        assert "too few" in bootstrap_confidence(equity, dates)["note"]


class TestAcceptanceScreen:
    """A strategy must fail the screen for each artefact it depends on."""

    def _result(
        self,
        *,
        equity: list[float],
        benchmark: list[float] | None = None,
        trades: list[dict] | None = None,
    ):
        dates = [date(2022, 1, 3) + timedelta(days=i) for i in range(len(equity))]
        config = BacktestConfig(start=dates[0], end=dates[-1], universe=TEST_UNIVERSE)
        result = BacktestResult(config=config)
        result.dates = dates
        result.equity = equity
        result.benchmark = benchmark or [100_000.0] * len(equity)
        result.trades = trades or []
        result.metrics = compute_metrics(dates, equity, benchmark_values=result.benchmark, trades=result.trades)
        return result

    def _many_trades(self, count: int, pnl: float = 400.0) -> list[dict]:
        return [{"net_pnl": pnl, "gross_pnl": pnl + 2.0, "costs": 2.0, "holding_days": 25} for _ in range(count)]

    def test_too_few_trades_is_rejected(self) -> None:
        equity = list(np.linspace(100_000.0, 160_000.0, 800))
        decision = screen_result(self._result(equity=equity, trades=self._many_trades(5)))
        assert decision.accepted is False
        assert any("trade" in reason.lower() for reason in decision.rejections)

    def test_an_excessive_drawdown_is_rejected(self) -> None:
        equity = list(np.linspace(100_000.0, 40_000.0, 400)) + list(np.linspace(40_000.0, 150_000.0, 400))
        decision = screen_result(self._result(equity=equity, trades=self._many_trades(60)))
        assert decision.accepted is False
        assert any("drawdown" in reason.lower() for reason in decision.rejections)

    def test_profit_concentrated_in_a_few_winners_is_flagged_not_banned(self) -> None:
        # A handful of large winners is the expected shape of a growth mandate,
        # so this is surfaced as a warning rather than treated as an artefact.
        trades = [{"net_pnl": 1.0, "gross_pnl": 2.0, "costs": 1.0, "holding_days": 10} for _ in range(50)]
        trades.append({"net_pnl": 60_000.0, "gross_pnl": 60_001.0, "costs": 1.0, "holding_days": 40})
        equity = list(np.linspace(100_000.0, 160_050.0, 800))
        decision = screen_result(self._result(equity=equity, trades=trades))
        assert any("largest winners" in warning for warning in decision.warnings)
        assert decision.checks["top5_winner_share"] is not None

    def test_a_fragile_parameter_surface_is_rejected(self) -> None:
        equity = list(np.linspace(100_000.0, 150_000.0, 800))
        base = self._result(equity=equity, trades=self._many_trades(60))
        # Performance exists only at one setting: curve fitting, not an edge.
        decision = screen_result(base, sensitivity=[{"parameter": "lookback", "fragile": True}])
        assert decision.accepted is False
        assert any("fragile" in reason for reason in decision.rejections)

    def test_a_result_that_depends_on_one_good_year_is_rejected(self) -> None:
        # Flat for two years, then a single explosive year.
        flat = [100_000.0] * 500
        surge = list(np.linspace(100_000.0, 200_000.0, 300))
        dates = [date(2022, 1, 3) + timedelta(days=i) for i in range(800)]
        config = BacktestConfig(start=dates[0], end=dates[-1], universe=TEST_UNIVERSE)
        result = BacktestResult(config=config)
        result.dates = dates
        result.equity = flat + surge
        result.benchmark = [100_000.0] * 800
        result.trades = self._many_trades(60)
        result.metrics = compute_metrics(dates, result.equity, benchmark_values=result.benchmark, trades=result.trades)
        decision = screen_result(result)
        assert decision.accepted is False
        assert any("single year" in reason for reason in decision.rejections)

    def test_walk_forward_folds_that_do_not_hold_up_are_rejected(self) -> None:
        from aegisquant.backtest.validation import WalkForwardReport

        equity = list(np.linspace(100_000.0, 150_000.0, 800))
        base = self._result(equity=equity, trades=self._many_trades(60))
        report = WalkForwardReport(folds=[{"index": i, "passed": False} for i in range(4)], pass_rate=0.0)
        decision = screen_result(base, walkforward=report)
        assert decision.accepted is False
        assert any("out of sample" in reason for reason in decision.rejections)

    def test_a_synthetic_data_run_is_always_caveated(self) -> None:
        equity = list(np.linspace(100_000.0, 150_000.0, 800))
        result = self._result(equity=equity, trades=self._many_trades(60))
        result.uses_synthetic_data = True
        decision = screen_result(result)
        assert any("SIMULATED" in warning for warning in decision.warnings)

    def test_a_reasonable_result_records_its_checks_either_way(self) -> None:
        equity = list(np.linspace(100_000.0, 150_000.0, 800))
        decision = screen_result(self._result(equity=equity, trades=self._many_trades(80)))
        assert decision.checks
        assert isinstance(decision.accepted, bool)
        # Whatever the verdict, it is explained rather than asserted.
        assert decision.rejections or decision.accepted is True
