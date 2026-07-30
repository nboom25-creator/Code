"""Absence of look-ahead leakage.

Look-ahead is the failure mode that makes a worthless strategy look excellent,
and it is invisible in the performance numbers. These tests attack it from four
directions:

1. structurally — nothing dated after ``as_of`` is reachable;
2. behaviourally — a feature computed at time *t* is unchanged by appending
   future bars, so no future value can be influencing it;
3. by construction — an oracle feature that *does* peek is detected, proving the
   detector has teeth;
4. through corporate actions — split adjustment uses only splits already public.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import numpy as np
import pytest

from aegisquant.features import market_structure as MS
from aegisquant.features.engine import compute_bundle
from aegisquant.features.market_view import LookaheadError, MarketView
from aegisquant.utils.timeutil import ensure_utc, utcnow
from tests.helpers import bar_series, sessions, store_bars

START = date(2022, 1, 3)


def at(day: date, hour: int = 23) -> datetime:
    return datetime.combine(day, datetime.min.time()).replace(hour=hour, tzinfo=utcnow().tzinfo)


class TestStructuralTruncation:
    def test_nothing_after_as_of_is_visible(self, seeded: dict, session) -> None:
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        for offset in (30, 120, 400):
            cut = utcnow() - timedelta(days=offset)
            pit = view.at(cut)
            pit.assert_no_lookahead()  # raises LookaheadError if violated

    def test_the_detector_actually_detects(self, session) -> None:
        # Guard against a vacuous assert_no_lookahead: hand it a view whose
        # series extends past as_of but whose cut is forced open.
        days = sessions(START, 40)
        store_bars(session, bar_series("AAA", days, [100.0] * 40))
        store_bars(session, bar_series("SPY", days, [100.0] * 40))
        view = MarketView.load(session, ["AAA"], benchmark="SPY")
        pit = view.at(at(days[20]))
        pit._cuts["AAA"] = len(view.series["AAA"])  # simulate an off-by-N bug
        with pytest.raises(LookaheadError):
            pit.assert_no_lookahead()

    def test_bar_count_matches_the_number_of_elapsed_sessions(self, session) -> None:
        days = sessions(START, 60)
        store_bars(session, bar_series("AAA", days, [100.0 + i for i in range(60)]))
        store_bars(session, bar_series("SPY", days, [100.0] * 60))
        view = MarketView.load(session, ["AAA"], benchmark="SPY")
        for i in (5, 20, 59):
            pit = view.at(at(days[i]))
            assert pit.closes("AAA").size == i + 1
            assert pit.last_close("AAA") == pytest.approx(100.0 + i)

    def test_a_bar_is_only_visible_after_its_close(self, session) -> None:
        # Bars are stamped at 21:00 UTC. At 20:00 the session's bar does not yet
        # exist; using it would be trading on a close before it printed.
        days = sessions(START, 10)
        store_bars(session, bar_series("AAA", days, [100.0 + i for i in range(10)]))
        store_bars(session, bar_series("SPY", days, [100.0] * 10))
        view = MarketView.load(session, ["AAA"], benchmark="SPY")
        assert view.at(at(days[5], hour=20)).closes("AAA").size == 5
        assert view.at(at(days[5], hour=21)).closes("AAA").size == 6


class TestFeaturesAreUnchangedByTheFuture:
    """The behavioural test: append future data, recompute, expect identity."""

    FEATURES = (
        "trend_20",
        "trend_63",
        "rel_strength_63",
        "momentum_12_1",
        "realized_vol_21",
        "realized_vol_63",
        "rsi_14",
        "atr_pct_14",
        "breakout_55",
        "mean_rev_z_10",
        "volume_ratio_20",
        "adv_usd_20",
        "corr_benchmark_63",
    )

    def test_appending_future_bars_changes_no_past_feature(self, session) -> None:
        rng = np.random.default_rng(42)
        days = sessions(START, 400)
        closes = list(100.0 * np.exp(np.cumsum(rng.normal(0.0004, 0.012, 400))))
        bench = list(100.0 * np.exp(np.cumsum(rng.normal(0.0003, 0.008, 400))))

        cut_index = 300
        evaluation_instant = at(days[cut_index])

        # First pass: only history up to the cut exists at all.
        store_bars(session, bar_series("AAA", days[: cut_index + 1], closes[: cut_index + 1]))
        store_bars(session, bar_series("SPY", days[: cut_index + 1], bench[: cut_index + 1]))
        truncated = MarketView.load(session, ["AAA"], benchmark="SPY").at(evaluation_instant)
        before = {name: getattr(MS, name)(truncated, "AAA") for name in self.FEATURES}

        # Second pass: the future is now in the database, but as_of is unchanged.
        store_bars(session, bar_series("AAA", days[cut_index + 1 :], closes[cut_index + 1 :]))
        store_bars(session, bar_series("SPY", days[cut_index + 1 :], bench[cut_index + 1 :]))
        with_future = MarketView.load(session, ["AAA"], benchmark="SPY").at(evaluation_instant)
        after = {name: getattr(MS, name)(with_future, "AAA") for name in self.FEATURES}

        assert any(v is not None for v in before.values()), "no features computed — test proves nothing"
        for name in self.FEATURES:
            if before[name] is None:
                assert after[name] is None, f"{name} appeared only once the future was visible"
            else:
                assert after[name] == pytest.approx(before[name], rel=1e-12), (
                    f"{name} changed when future bars were added: {before[name]} -> {after[name]}"
                )

    def test_the_whole_bundle_is_stable_against_the_future(self, session) -> None:
        rng = np.random.default_rng(9)
        days = sessions(START, 400)
        series = {
            sym: list(100.0 * np.exp(np.cumsum(rng.normal(0.0003, 0.011, 400)))) for sym in ("AAA", "BBB", "CCC", "SPY")
        }
        cut_index = 320
        instant = at(days[cut_index])

        for sym, closes in series.items():
            store_bars(session, bar_series(sym, days[: cut_index + 1], closes[: cut_index + 1]))
        view = MarketView.load(session, ["AAA", "BBB", "CCC"], benchmark="SPY")
        before = compute_bundle(view, instant, min_price=0.0, min_adv_usd=0.0)

        for sym, closes in series.items():
            store_bars(session, bar_series(sym, days[cut_index + 1 :], closes[cut_index + 1 :]))
        view2 = MarketView.load(session, ["AAA", "BBB", "CCC"], benchmark="SPY")
        after = compute_bundle(view2, instant, min_price=0.0, min_adv_usd=0.0)

        assert set(before.symbols) == set(after.symbols)
        assert before.market.keys() == after.market.keys()
        for name, value in before.market.items():
            assert after.market[name] == pytest.approx(value, rel=1e-12), f"market.{name} moved"
        for sym in before.symbols:
            lhs, rhs = before.symbols[sym].as_dict(), after.symbols[sym].as_dict()
            assert lhs.keys() == rhs.keys(), f"{sym} gained or lost features"
            for name, value in lhs.items():
                assert rhs[name] == pytest.approx(value, rel=1e-12), f"{sym}.{name} moved"

    def test_an_oracle_feature_is_caught_by_the_same_harness(self, session) -> None:
        """Negative control: a feature that peeks must fail the stability check."""
        rng = np.random.default_rng(5)
        days = sessions(START, 200)
        closes = list(100.0 * np.exp(np.cumsum(rng.normal(0.0005, 0.015, 200))))
        cut_index = 150
        instant = at(days[cut_index])

        def oracle(view: MarketView, symbol: str) -> float:
            """Deliberately cheats: reads the raw series, ignoring as_of."""
            return float(view.series[symbol].close[-1])

        store_bars(session, bar_series("AAA", days[: cut_index + 1], closes[: cut_index + 1]))
        store_bars(session, bar_series("SPY", days[: cut_index + 1], [100.0] * (cut_index + 1)))
        view = MarketView.load(session, ["AAA"], benchmark="SPY")
        honest_before = MS.trend_20(view.at(instant), "AAA")
        cheating_before = oracle(view, "AAA")

        store_bars(session, bar_series("AAA", days[cut_index + 1 :], closes[cut_index + 1 :]))
        store_bars(session, bar_series("SPY", days[cut_index + 1 :], [100.0] * (200 - cut_index - 1)))
        view2 = MarketView.load(session, ["AAA"], benchmark="SPY")

        assert MS.trend_20(view2.at(instant), "AAA") == pytest.approx(honest_before, rel=1e-12)
        assert oracle(view2, "AAA") != pytest.approx(cheating_before)


class TestPublicationDelays:
    def test_fundamentals_are_gated_on_publication_not_period_end(self, session) -> None:
        """A quarter ending in March is not knowable until it is filed in May."""
        from decimal import Decimal

        from aegisquant.data.ingest import _upsert_fundamentals
        from aegisquant.data.providers.base import FundamentalRecord
        from aegisquant.db.repo import get_or_create_instrument
        from tests.helpers import provenance

        days = sessions(date(2024, 1, 2), 200)
        store_bars(session, bar_series("AAA", days, [100.0] * 200))
        store_bars(session, bar_series("SPY", days, [100.0] * 200))
        instrument = get_or_create_instrument(session, "AAA")

        period_end = date(2024, 3, 31)
        filed_at = datetime(2024, 5, 15, 21, 0, tzinfo=utcnow().tzinfo)
        _upsert_fundamentals(
            session,
            instrument,
            [
                FundamentalRecord(
                    symbol="AAA",
                    period_end=period_end,
                    fiscal_period="Q1",
                    provenance=provenance("AAA", observed_at=filed_at),
                    values={"revenue": Decimal(1000)},
                )
            ],
        )
        session.flush()

        view = MarketView.load(session, ["AAA"], benchmark="SPY")
        # Between period end and filing date the figures do not exist yet.
        between = view.at(datetime(2024, 4, 20, 21, 0, tzinfo=utcnow().tzinfo))
        assert between.latest_fundamental("AAA") is None

        after = view.at(datetime(2024, 5, 16, 21, 0, tzinfo=utcnow().tzinfo))
        row = after.latest_fundamental("AAA")
        assert row is not None
        assert row.period_end == period_end
        assert row.values["revenue"] == pytest.approx(1000.0)

    def test_seeded_fundamentals_never_predate_their_own_filing(self, seeded: dict, session) -> None:
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        checked = 0
        for symbol, rows in view.fundamentals.items():
            for row in rows:
                # A filing observed before the period it reports on would be a
                # provider bug, and would leak the future into every backtest.
                assert ensure_utc(row.observed_at).date() >= row.period_end, symbol
                checked += 1
        assert checked > 0

    def test_macro_series_respect_release_time(self, seeded: dict, session) -> None:
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        assert view.macro, "no macro series loaded"
        cut = utcnow() - timedelta(days=200)
        pit = view.at(cut)
        checked = 0
        for series_id, series in view.macro.items():
            if pit.macro_latest(series_id) is None:
                continue
            boundary = np.datetime64(cut.replace(tzinfo=None))
            visible = series.observed_at[series.observed_at <= boundary]
            released_later = series.observed_at[series.observed_at > boundary]
            assert released_later.size > 0, f"{series_id} has nothing after the cut — test proves nothing"
            # macro_history filters non-finite values, so it can be shorter than
            # the visible window but never longer: nothing unreleased leaks in.
            history = pit.macro_history(series_id, 10_000)
            assert history.size <= visible.size
            assert history.size > 0
            checked += 1
        assert checked > 0


class TestCorporateActionAdjustmentIsPointInTime:
    def test_a_split_creates_no_phantom_return(self, session) -> None:
        """A 2:1 split halves the price; the adjusted series must show ~0%."""
        from aegisquant.data.ingest import _upsert_actions
        from aegisquant.db.repo import get_or_create_instrument
        from tests.helpers import split

        days = sessions(date(2024, 1, 2), 60)
        ex_index = 30
        raw = [100.0] * ex_index + [50.0] * (60 - ex_index)
        store_bars(session, bar_series("AAA", days, raw))
        store_bars(session, bar_series("SPY", days, [100.0] * 60))
        instrument = get_or_create_instrument(session, "AAA")
        _upsert_actions(session, instrument, [split("AAA", days[ex_index], 2)])
        session.flush()

        view = MarketView.load(session, ["AAA"], benchmark="SPY")
        pit = view.at(at(days[-1]))
        closes = pit.closes("AAA")
        returns = closes[1:] / closes[:-1] - 1.0
        assert float(np.max(np.abs(returns))) < 1e-9, "split produced a phantom return in the adjusted series"

    def test_volume_is_adjusted_in_the_opposite_direction(self, session) -> None:
        from aegisquant.data.ingest import _upsert_actions
        from aegisquant.db.repo import get_or_create_instrument
        from tests.helpers import bar_at, split

        days = sessions(date(2024, 1, 2), 60)
        ex_index = 30
        bars = [bar_at("AAA", d, 100, volume=1_000_000) for d in days[:ex_index]]
        bars += [bar_at("AAA", d, 50, volume=2_000_000) for d in days[ex_index:]]
        store_bars(session, bars)
        store_bars(session, bar_series("SPY", days, [100.0] * 60))
        instrument = get_or_create_instrument(session, "AAA")
        _upsert_actions(session, instrument, [split("AAA", days[ex_index], 2)])
        session.flush()

        pit = MarketView.load(session, ["AAA"], benchmark="SPY").at(at(days[-1]))
        volumes = pit.volumes("AAA")
        # Share counts scale as the reciprocal of price, so the adjusted series
        # is flat rather than doubling on the ex-date.
        assert float(np.max(volumes) / np.min(volumes)) == pytest.approx(1.0, abs=1e-9)

    def test_a_future_split_does_not_adjust_the_present(self, session) -> None:
        """The core point-in-time rule for corporate actions.

        A vendor's back-adjusted series already reflects splits that have not
        happened yet at the evaluation instant. Here the same series is viewed
        before the split, and the observed price must be the unadjusted one that
        a trader would actually have seen on the screen.
        """
        from aegisquant.data.ingest import _upsert_actions
        from aegisquant.db.repo import get_or_create_instrument
        from tests.helpers import split

        days = sessions(date(2024, 1, 2), 60)
        ex_index = 40
        raw = [100.0] * ex_index + [50.0] * (60 - ex_index)
        store_bars(session, bar_series("AAA", days, raw))
        store_bars(session, bar_series("SPY", days, [100.0] * 60))
        instrument = get_or_create_instrument(session, "AAA")
        _upsert_actions(session, instrument, [split("AAA", days[ex_index], 2)])
        session.flush()

        view = MarketView.load(session, ["AAA"], benchmark="SPY")
        before_split = view.at(at(days[ex_index - 1]))
        assert before_split.last_close("AAA") == pytest.approx(100.0)

        after_split = view.at(at(days[ex_index]))
        assert after_split.last_close("AAA") == pytest.approx(50.0)
        # Looking back from after the split, the earlier prices are now halved —
        # which is correct, because by then the split is public knowledge.
        assert float(after_split.closes("AAA")[0]) == pytest.approx(50.0)


class TestSurvivorshipBias:
    def test_a_delisted_name_leaves_the_investable_universe(self, session) -> None:
        from aegisquant.db.repo import get_or_create_instrument

        days = sessions(date(2024, 1, 2), 60)
        store_bars(session, bar_series("AAA", days, [100.0] * 60))
        store_bars(session, bar_series("DEAD", days, [100.0] * 60))
        store_bars(session, bar_series("SPY", days, [100.0] * 60))
        instrument = get_or_create_instrument(session, "DEAD")
        instrument.delisted_on = days[30]
        session.flush()

        view = MarketView.load(session, ["AAA", "DEAD"], benchmark="SPY")
        # Before the delisting the name is investable; the backtest must be able
        # to hold it, or the result is survivorship-biased.
        assert "DEAD" in view.at(at(days[20])).investable_symbols
        assert view.at(at(days[20])).is_delisted("DEAD") is False
        # After it, the name is gone.
        assert "DEAD" not in view.at(at(days[50])).investable_symbols
        assert view.at(at(days[50])).is_delisted("DEAD") is True
