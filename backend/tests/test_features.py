"""Feature calculations and the feature registry.

Features are computed on hand-built series with known answers, so a regression
in the maths fails here rather than showing up as an unexplained change in
backtest performance.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta

import numpy as np
import pytest

from aegisquant.features import market_structure as MS
from aegisquant.features.engine import compute_bundle, persist_bundle
from aegisquant.features.market_view import MarketView
from aegisquant.features.registry import REGISTRY, feature_names, registry_version
from aegisquant.utils.timeutil import ensure_utc, utcnow
from tests.helpers import bar_at, bar_series, sessions, store_bars

START = date(2024, 1, 2)


def view_from(session, closes: dict[str, list[float]], days: list[date], **kwargs) -> MarketView:
    """Build a MarketView over hand-specified close series."""
    for symbol, series in closes.items():
        store_bars(session, bar_series(symbol, days, series))
    return MarketView.load(session, list(closes), benchmark="SPY", **kwargs)


def pit_for(session, closes: dict[str, list[float]], days: list[date]):
    view = view_from(session, closes, days)
    last = datetime.combine(days[-1], datetime.min.time()).replace(hour=23, tzinfo=utcnow().tzinfo)
    return view.at(last)


class TestTrendAndMomentum:
    def test_trend_is_the_close_relative_to_its_moving_average(self, session) -> None:
        days = sessions(START, 60)
        closes = [100.0 * (1.01**i) for i in range(60)]
        pit = pit_for(session, {"AAA": closes, "SPY": [100.0] * 60}, days)
        expected = closes[-1] / (sum(closes[-20:]) / 20) - 1
        assert MS.trend_20(pit, "AAA") == pytest.approx(expected, rel=1e-9)
        assert MS.trend_20(pit, "AAA") > 0  # price above its own average

    def test_flat_series_has_zero_trend(self, session) -> None:
        days = sessions(START, 60)
        pit = pit_for(session, {"AAA": [100.0] * 60, "SPY": [100.0] * 60}, days)
        assert MS.trend_20(pit, "AAA") == pytest.approx(0.0)

    def test_insufficient_history_returns_none_never_zero(self, session) -> None:
        # A missing feature must be distinguishable from a feature that is zero.
        days = sessions(START, 5)
        pit = pit_for(session, {"AAA": [100.0] * 5, "SPY": [100.0] * 5}, days)
        assert MS.trend_252(pit, "AAA") is None
        assert MS.trend_126(pit, "AAA") is None

    def test_relative_strength_is_symbol_minus_benchmark(self, session) -> None:
        days = sessions(START, 80)
        symbol = [100.0 * (1.002**i) for i in range(80)]
        bench = [100.0 * (1.001**i) for i in range(80)]
        pit = pit_for(session, {"AAA": symbol, "SPY": bench}, days)
        expected = (symbol[-1] / symbol[-64] - 1) - (bench[-1] / bench[-64] - 1)
        assert MS.rel_strength_63(pit, "AAA") == pytest.approx(expected, rel=1e-9)
        assert MS.rel_strength_63(pit, "AAA") > 0

    def test_momentum_12_1_skips_the_most_recent_month(self, session) -> None:
        # The one-month skip is what distinguishes momentum from short-term
        # reversal; a last-month spike must not inflate it.
        days = sessions(START, 300)
        base = [100.0 * (1.001**i) for i in range(300)]
        with_spike = list(base)
        for i in range(279, 300):
            with_spike[i] = base[i] * 1.5
        plain = pit_for(session, {"AAA": base, "SPY": [100.0] * 300}, days)
        value_plain = MS.momentum_12_1(plain, "AAA")

        # Rebuild in a clean session-scoped view for the spiked series.
        store_bars(session, bar_series("BBB", days, with_spike))
        spiked = MarketView.load(session, ["AAA", "BBB"], benchmark="SPY").at(
            datetime.combine(days[-1], datetime.min.time()).replace(hour=23, tzinfo=utcnow().tzinfo)
        )
        value_spiked = MS.momentum_12_1(spiked, "BBB")
        assert value_plain is not None and value_spiked is not None
        assert value_spiked == pytest.approx(value_plain, rel=1e-6)


class TestVolatilityAndRange:
    def test_realized_vol_of_a_constant_series_is_zero(self, session) -> None:
        days = sessions(START, 80)
        pit = pit_for(session, {"AAA": [100.0] * 80, "SPY": [100.0] * 80}, days)
        assert MS.realized_vol_21(pit, "AAA") == pytest.approx(0.0)

    def test_realized_vol_is_annualised(self, session) -> None:
        days = sessions(START, 120)
        rng = np.random.default_rng(7)
        daily = rng.normal(0, 0.01, 120)
        closes = list(100.0 * np.exp(np.cumsum(daily)))
        pit = pit_for(session, {"AAA": closes, "SPY": [100.0] * 120}, days)
        vol = MS.realized_vol_63(pit, "AAA")
        assert vol is not None
        # 1% daily -> ~16% annualised (sqrt(252) scaling).
        assert 0.10 < vol < 0.24

    def test_atr_pct_reflects_the_daily_range(self, session) -> None:
        days = sessions(START, 40)
        bars = [bar_at("AAA", d, 100, open_=100, high=102, low=98) for d in days]
        store_bars(session, bars)
        store_bars(session, bar_series("SPY", days, [100.0] * 40))
        pit = MarketView.load(session, ["AAA"], benchmark="SPY").at(
            datetime.combine(days[-1], datetime.min.time()).replace(hour=23, tzinfo=utcnow().tzinfo)
        )
        atr = MS.atr_pct_14(pit, "AAA")
        assert atr == pytest.approx(0.04, abs=0.005)  # 4-point range on a 100 price

    def test_breakout_is_positive_at_a_new_high(self, session) -> None:
        # breakout_252 is close / max(prior 252 highs) - 1, so a fresh high is
        # positive and anything inside the range is negative.
        days = sessions(START, 300)
        closes = [100.0 + i for i in range(300)]
        pit = pit_for(session, {"AAA": closes, "SPY": [100.0] * 300}, days)
        value = MS.breakout_252(pit, "AAA")
        assert value is not None and value > 0

    def test_breakout_is_negative_below_the_high(self, session) -> None:
        days = sessions(START, 300)
        closes = [100.0 + i for i in range(250)] + [200.0] * 50
        pit = pit_for(session, {"AAA": closes, "SPY": [100.0] * 300}, days)
        value = MS.breakout_252(pit, "AAA")
        assert value is not None and value < 0


class TestOscillators:
    def test_rsi_of_a_monotonic_rise_is_one_hundred(self, session) -> None:
        days = sessions(START, 40)
        closes = [100.0 + i for i in range(40)]
        pit = pit_for(session, {"AAA": closes, "SPY": [100.0] * 40}, days)
        assert MS.rsi_14(pit, "AAA") == pytest.approx(100.0, abs=1e-6)

    def test_rsi_of_a_monotonic_fall_is_zero(self, session) -> None:
        days = sessions(START, 40)
        closes = [200.0 - i for i in range(40)]
        pit = pit_for(session, {"AAA": closes, "SPY": [100.0] * 40}, days)
        assert MS.rsi_14(pit, "AAA") == pytest.approx(0.0, abs=1e-6)

    def test_mean_reversion_z_score_sign(self, session) -> None:
        days = sessions(START, 40)
        closes = [100.0, 101.0] * 19 + [130.0, 130.0]  # far above the local mean
        pit = pit_for(session, {"AAA": closes, "SPY": [100.0] * 40}, days)
        z = MS.mean_rev_z_10(pit, "AAA")
        assert z is not None and z > 1


class TestLiquidityFeatures:
    def test_adv_usd_is_price_times_volume(self, session) -> None:
        days = sessions(START, 40)
        bars = [bar_at("AAA", d, 50, volume=200_000) for d in days]
        store_bars(session, bars)
        store_bars(session, bar_series("SPY", days, [100.0] * 40))
        pit = MarketView.load(session, ["AAA"], benchmark="SPY").at(
            datetime.combine(days[-1], datetime.min.time()).replace(hour=23, tzinfo=utcnow().tzinfo)
        )
        assert MS.adv_usd_20(pit, "AAA") == pytest.approx(50 * 200_000, rel=1e-6)

    def test_volume_ratio_detects_a_spike(self, session) -> None:
        days = sessions(START, 40)
        bars = [bar_at("AAA", d, 100, volume=100_000) for d in days[:-1]]
        bars.append(bar_at("AAA", days[-1], 100, volume=500_000))
        store_bars(session, bars)
        store_bars(session, bar_series("SPY", days, [100.0] * 40))
        pit = MarketView.load(session, ["AAA"], benchmark="SPY").at(
            datetime.combine(days[-1], datetime.min.time()).replace(hour=23, tzinfo=utcnow().tzinfo)
        )
        ratio = MS.volume_ratio_20(pit, "AAA")
        assert ratio is not None and ratio > 3.0


class TestCorrelation:
    def test_identical_series_correlate_at_one(self, session) -> None:
        days = sessions(START, 120)
        rng = np.random.default_rng(11)
        closes = list(100.0 * np.exp(np.cumsum(rng.normal(0, 0.01, 120))))
        pit = pit_for(session, {"AAA": closes, "SPY": closes}, days)
        assert MS.corr_benchmark_63(pit, "AAA") == pytest.approx(1.0, abs=1e-6)

    def test_uncorrelated_series_are_near_zero(self, session) -> None:
        days = sessions(START, 300)
        rng = np.random.default_rng(3)
        a = list(100.0 * np.exp(np.cumsum(rng.normal(0, 0.01, 300))))
        b = list(100.0 * np.exp(np.cumsum(rng.normal(0, 0.01, 300))))
        pit = pit_for(session, {"AAA": a, "SPY": b}, days)
        corr = MS.corr_benchmark_63(pit, "AAA")
        assert corr is not None and abs(corr) < 0.5


class TestFeatureRegistry:
    def test_every_computed_feature_is_declared(self, seeded: dict, session, as_of: datetime) -> None:
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        bundle = compute_bundle(view, as_of)
        declared = set(feature_names())
        assert bundle.symbols, "no symbol features computed"
        for sym, features in bundle.symbols.items():
            undeclared = {
                name
                for name in features.as_dict()
                # Cross-sectional ranks are derived from a declared base feature.
                if name not in declared and name.removesuffix("_rank") not in declared
            }
            assert not undeclared, f"{sym} produced features absent from the registry: {undeclared}"

    def test_every_definition_carries_the_metadata_the_spec_requires(self) -> None:
        assert len(REGISTRY.features) > 50
        for name, definition in REGISTRY.features.items():
            assert definition.name == name
            assert definition.description
            assert definition.unit
            assert definition.version
            assert definition.availability_delay_hours >= 0
            if definition.expected_min is not None and definition.expected_max is not None:
                assert definition.expected_min < definition.expected_max

    def test_registry_version_is_stable_and_content_addressed(self) -> None:
        assert registry_version() == registry_version()
        assert len(registry_version()) >= 8

    def test_no_feature_is_ever_nan_or_infinite(self, seeded: dict, session, as_of: datetime) -> None:
        # A NaN that reaches a strategy would silently poison a ranking, so the
        # recorder converts non-finite values to "missing" instead.
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        bundle = compute_bundle(view, as_of)
        for sym, features in bundle.symbols.items():
            for name, value in features.as_dict().items():
                assert value is None or math.isfinite(value), f"{sym}.{name} = {value}"
        for name, value in bundle.market.items():
            assert math.isfinite(value), f"market.{name} = {value}"

    def test_values_outside_the_declared_range_are_flagged_not_discarded(
        self, seeded: dict, session, as_of: datetime
    ) -> None:
        # The registry range is a sanity band, not a hard truth: a real P/E can
        # exceed it. The contract is that such a value is recorded *and* marked,
        # never silently clipped to look plausible.
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        bundle = compute_bundle(view, as_of)
        for sym, features in bundle.symbols.items():
            for name, value in features.as_dict().items():
                definition = REGISTRY.features.get(name)
                if definition is None or value is None:
                    continue
                lo, hi = definition.expected_min, definition.expected_max
                outside = (lo is not None and value < float(lo)) or (hi is not None and value > float(hi))
                if outside:
                    assert name in features.out_of_range, f"{sym}.{name} = {value} is out of range but unflagged"
                else:
                    assert name not in features.out_of_range

    def test_growth_scores_stay_inside_zero_to_one_hundred(self, seeded: dict, session, as_of: datetime) -> None:
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        bundle = compute_bundle(view, as_of)
        for sym, features in bundle.symbols.items():
            score = features.get("growth_opportunity_score")
            assert score is None or 0.0 <= score <= 100.0, f"{sym} scored {score}"

    def test_missing_inputs_are_reported_not_imputed(self, session) -> None:
        # Two bars of history cannot support a 252-day trend. The feature must be
        # None and the omission recorded, not filled with a plausible number.
        days = sessions(START, 3)
        store_bars(session, bar_series("AAA", days, [100.0, 101.0, 102.0]))
        store_bars(session, bar_series("SPY", days, [100.0, 100.0, 100.0]))
        view = MarketView.load(session, ["AAA"], benchmark="SPY")
        bundle = compute_bundle(
            view,
            datetime.combine(days[-1], datetime.min.time()).replace(hour=23, tzinfo=utcnow().tzinfo),
            min_adv_usd=0.0,
            min_price=0.0,
        )
        features = bundle.symbols["AAA"]
        assert features.values.get("trend_252") is None
        assert "trend_252" in features.missing

    def test_persisting_a_bundle_records_the_registry_version(self, seeded: dict, session, as_of: datetime) -> None:
        from sqlalchemy import select

        from aegisquant.db.models import FeatureSnapshot
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        bundle = compute_bundle(view, as_of)
        written = persist_bundle(session, bundle)
        session.flush()
        assert written == len(bundle.symbols)
        snapshots = list(session.scalars(select(FeatureSnapshot)))
        assert snapshots
        for snap in snapshots:
            assert snap.registry_version == registry_version()
            assert ensure_utc(snap.as_of) == bundle.as_of


class TestGrowthScore:
    def test_score_is_bounded_and_explains_itself(self, seeded: dict, session, as_of: datetime) -> None:
        from aegisquant.features.growth_score import compute_growth_score
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        bundle = compute_bundle(view, as_of)
        scored = 0
        for sym, features in bundle.symbols.items():
            score = compute_growth_score(sym, features.as_dict(), instrument=view.instruments.get(sym, {}))
            assert score.total is not None and 0 <= score.total <= 100
            assert score.components, f"{sym} produced no component breakdown"
            assert score.strengths or score.weaknesses
            for component in score.components.values():
                assert component.score is None or 0 <= component.score <= 100
            scored += 1
        assert scored > 0

    def test_a_disqualified_name_scores_zero_and_says_why(self, seeded: dict, session, as_of: datetime) -> None:
        from aegisquant.features.growth_score import compute_growth_score
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        bundle = compute_bundle(view, as_of)
        sym, features = next(iter(bundle.symbols.items()))
        score = compute_growth_score(
            sym,
            features.as_dict(),
            instrument={"is_leveraged_etf": True, "tradable": True},
        )
        assert score.disqualifiers
        # The score is still reported (it is evidence), but the name is not
        # investable — that flag is what the pipeline gates on.
        assert score.investable is False

    def test_untradable_and_delisted_names_are_disqualified(self, seeded: dict, session, as_of: datetime) -> None:
        from aegisquant.features.growth_score import compute_growth_score
        from tests.conftest import TEST_UNIVERSE

        view = MarketView.load(session, TEST_UNIVERSE, benchmark="SPY")
        bundle = compute_bundle(view, as_of)
        sym, features = next(iter(bundle.symbols.items()))
        for instrument in ({"tradable": False}, {"delisted_on": date(2020, 1, 1)}):
            score = compute_growth_score(sym, features.as_dict(), instrument=instrument)
            assert score.disqualifiers
            assert score.investable is False


class TestNewsFeaturesRespectPublicationTime:
    def test_news_published_after_as_of_is_invisible(self, session) -> None:
        from aegisquant.data.ingest import _upsert_news
        from aegisquant.data.providers.base import NewsRecord
        from aegisquant.db.repo import get_or_create_instrument
        from tests.helpers import provenance

        days = sessions(utcnow().date() - timedelta(days=60), 40)
        store_bars(session, bar_series("AAA", days, [100.0] * 40))
        store_bars(session, bar_series("SPY", days, [100.0] * 40))
        instrument = get_or_create_instrument(session, "AAA")
        cutoff = datetime.combine(days[20], datetime.min.time()).replace(hour=21, tzinfo=utcnow().tzinfo)
        _upsert_news(
            session,
            instrument,
            [
                NewsRecord(
                    symbol="AAA",
                    external_id="before",
                    headline="AAA beats estimates",
                    published_at=cutoff - timedelta(days=1),
                    provenance=provenance("AAA"),
                    sentiment=None,
                ),
                NewsRecord(
                    symbol="AAA",
                    external_id="after",
                    headline="AAA announces a merger",
                    published_at=cutoff + timedelta(days=1),
                    provenance=provenance("AAA"),
                    sentiment=None,
                ),
            ],
        )
        session.flush()

        pit = MarketView.load(session, ["AAA"], benchmark="SPY").at(cutoff)
        headlines = [row.headline for row in pit.news("AAA")]
        assert "AAA beats estimates" in headlines
        assert "AAA announces a merger" not in headlines
