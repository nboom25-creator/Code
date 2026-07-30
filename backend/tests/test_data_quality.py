"""Data validation.

The contract under test: **detect and report, never repair by invention.** Every
check below asserts both that the defect is flagged and that no value was
synthesised to paper over it.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from aegisquant.data.quality import (
    ADJUSTMENT_JUMP_THRESHOLD,
    check_quote_freshness,
    compare_providers,
    detect_silent_delisting,
    open_issue_summary,
    persist_issues,
    validate_bars,
)
from aegisquant.db.enums import DataQuality, IssueKind, IssueSeverity
from aegisquant.utils.timeutil import utcnow
from tests.helpers import bar_at, bar_series, dividend, quote, sessions, split, store_bars

START = date(2024, 1, 2)


def kinds(result) -> set[IssueKind]:
    return {i.kind for i in result.issues}


class TestStructuralValidation:
    def test_clean_series_produces_no_issues(self) -> None:
        days = sessions(START, 30)
        closes = [Decimal(100) + Decimal(i) / 10 for i in range(30)]
        result = validate_bars("AAA", bar_series("AAA", days, closes), expected_sessions=days)
        assert result.issues == []
        assert len(result.accepted) == 30
        assert result.ok is True
        assert result.worst_quality() is DataQuality.OK

    def test_duplicate_bar_is_rejected_not_merged(self) -> None:
        days = sessions(START, 5)
        bars = bar_series("AAA", days, [100, 101, 102, 103, 104])
        bars.append(bar_at("AAA", days[2], 999))  # same (symbol, timeframe, ts)
        result = validate_bars("AAA", bars, expected_sessions=days)
        assert IssueKind.DUPLICATE_RECORD in kinds(result)
        assert len(result.accepted) == 5
        assert len(result.rejected) == 1
        # The first bar for that timestamp survives; the duplicate does not
        # silently overwrite it.
        assert [b.close for b in result.accepted if b.ts.date() == days[2]] == [Decimal(102)]

    def test_non_positive_price_is_rejected(self) -> None:
        days = sessions(START, 4)
        bars = bar_series("AAA", days, [100, 101, 102, 103])
        bars[2] = bar_at("AAA", days[2], 0)
        result = validate_bars("AAA", bars, expected_sessions=days)
        assert IssueKind.NEGATIVE_OR_ZERO_PRICE in kinds(result)
        assert len(result.rejected) == 1
        assert result.ok is False

    def test_ohlc_inconsistency_is_rejected(self) -> None:
        days = sessions(START, 3)
        bars = bar_series("AAA", days, [100, 101, 102])
        # close above the high is structurally impossible
        bars[1] = bar_at("AAA", days[1], 120, open_=100, high=105, low=99)
        result = validate_bars("AAA", bars, expected_sessions=days)
        assert IssueKind.OHLC_INCONSISTENT in kinds(result)
        assert bars[1] in result.rejected

    def test_negative_volume_is_rejected(self) -> None:
        days = sessions(START, 3)
        bars = bar_series("AAA", days, [100, 101, 102])
        bars[1] = bar_at("AAA", days[1], 101, volume=-5)
        result = validate_bars("AAA", bars, expected_sessions=days)
        assert IssueKind.NEGATIVE_OR_ZERO_PRICE in kinds(result)

    def test_future_dated_bar_is_rejected(self) -> None:
        today = utcnow().date()
        days = sessions(today - timedelta(days=10), 5)
        bars = bar_series("AAA", days, [100, 101, 102, 103, 104])
        bars.append(bar_at("AAA", today + timedelta(days=3), 105))
        result = validate_bars("AAA", bars)
        assert IssueKind.TIMESTAMP_INCONSISTENCY in kinds(result)
        assert len(result.accepted) == 5

    def test_missing_sessions_are_reported_with_the_dates(self) -> None:
        days = sessions(START, 20)
        present = [d for d in days if d not in (days[5], days[6], days[7])]
        result = validate_bars(
            "AAA",
            bar_series("AAA", present, [Decimal(100)] * len(present)),
            expected_sessions=days,
        )
        assert IssueKind.MISSING_BAR in kinds(result)
        issue = next(i for i in result.issues if i.kind is IssueKind.MISSING_BAR)
        assert issue.detail["count"] == 3
        assert days[5].isoformat() in issue.detail["missing"]
        # More than two missing sessions escalates to ERROR.
        assert issue.severity is IssueSeverity.ERROR
        # Nothing was invented to fill the hole.
        assert len(result.accepted) == 17

    def test_trailing_gap_is_not_an_error(self) -> None:
        # A bar that has not been published yet is not a data defect.
        days = sessions(START, 20)
        result = validate_bars(
            "AAA",
            bar_series("AAA", days[:-1], [Decimal(100)] * 19),
            expected_sessions=days,
        )
        assert IssueKind.MISSING_BAR not in kinds(result)

    def test_bar_on_a_closed_day_is_flagged(self) -> None:
        days = sessions(START, 10)
        bars = bar_series("AAA", days, [Decimal(100)] * 10)
        holiday = days[4]
        calendar = [d for d in days if d != holiday]
        result = validate_bars("AAA", bars, expected_sessions=calendar)
        assert IssueKind.MARKET_CLOSED in kinds(result)


class TestReturnBasedValidation:
    def test_unexplained_jump_is_an_adjustment_error(self) -> None:
        days = sessions(START, 20)
        closes = [Decimal(100)] * 10 + [Decimal(50)] * 10  # a 2:1 split, unrecorded
        result = validate_bars("AAA", bar_series("AAA", days, closes), expected_sessions=days)
        assert IssueKind.ADJUSTMENT_ERROR in kinds(result)
        assert result.ok is False
        assert result.worst_quality() is DataQuality.SUSPECT

    def test_the_same_jump_is_accepted_when_a_split_explains_it(self) -> None:
        days = sessions(START, 20)
        closes = [Decimal(100)] * 10 + [Decimal(50)] * 10
        result = validate_bars(
            "AAA",
            bar_series("AAA", days, closes),
            expected_sessions=days,
            corporate_actions=[split("AAA", days[10], 2)],
        )
        assert IssueKind.ADJUSTMENT_ERROR not in kinds(result)
        assert result.ok is True

    def test_a_large_special_dividend_also_explains_a_gap(self) -> None:
        days = sessions(START, 20)
        closes = [Decimal(100)] * 10 + [Decimal(60)] * 10
        result = validate_bars(
            "AAA",
            bar_series("AAA", days, closes),
            expected_sessions=days,
            corporate_actions=[dividend("AAA", days[10], 40)],
        )
        assert IssueKind.ADJUSTMENT_ERROR not in kinds(result)

    def test_a_split_dated_a_few_days_earlier_still_explains_the_gap(self) -> None:
        # Providers disagree by a day or two on the ex-date, a weekend or holiday
        # shifts the first session that can print the gap, and some feeds date an
        # action to a non-trading day. The exemption window absorbs that; without
        # it an ordinary 3:1 split is reported as an unexplained 67% collapse.
        days = sessions(START, 20)
        closes = [Decimal(300)] * 10 + [Decimal(100)] * 10
        gap_session = days[10]
        for offset in (0, 1, 2, 3):
            recorded_ex = gap_session - timedelta(days=offset)
            result = validate_bars(
                "AAA",
                bar_series("AAA", days, closes),
                expected_sessions=days,
                corporate_actions=[split("AAA", recorded_ex, 3)],
            )
            assert IssueKind.ADJUSTMENT_ERROR not in kinds(result), f"offset {offset} was not absorbed"

    def test_an_action_far_from_the_gap_does_not_excuse_it(self) -> None:
        # The window must not be so wide that an unrelated action launders any
        # jump in the same month.
        days = sessions(START, 20)
        closes = [Decimal(300)] * 10 + [Decimal(100)] * 10
        result = validate_bars(
            "AAA",
            bar_series("AAA", days, closes),
            expected_sessions=days,
            corporate_actions=[split("AAA", days[10] - timedelta(days=20), 3)],
        )
        assert IssueKind.ADJUSTMENT_ERROR in kinds(result)

    def test_move_just_under_the_threshold_is_treated_as_a_real_return(self) -> None:
        days = sessions(START, 20)
        drop = Decimal(1) - (ADJUSTMENT_JUMP_THRESHOLD - Decimal("0.02"))
        closes = [Decimal(100)] * 10 + [Decimal(100) * drop] * 10
        result = validate_bars("AAA", bar_series("AAA", days, closes), expected_sessions=days)
        assert IssueKind.ADJUSTMENT_ERROR not in kinds(result)

    def test_outlier_return_is_flagged_without_being_dropped(self) -> None:
        days = sessions(START, 40)
        closes = [Decimal(100) + Decimal(i % 3) / 100 for i in range(40)]
        closes[20] = closes[19] * Decimal("1.20")  # 20%: below the 35% adjustment cut
        closes[21] = closes[20]
        result = validate_bars("AAA", bar_series("AAA", days, closes), expected_sessions=days)
        assert IssueKind.EXTREME_OUTLIER in kinds(result)
        # Warnings do not reject data — the operator decides.
        assert len(result.accepted) == 40
        assert result.ok is True


class TestQuoteFreshness:
    def test_fresh_quote_passes(self) -> None:
        assert check_quote_freshness(quote("AAA", age_seconds=5), max_age_seconds=900) is None

    def test_stale_quote_is_flagged(self) -> None:
        issue = check_quote_freshness(quote("AAA", age_seconds=3600), max_age_seconds=900)
        assert issue is not None
        assert issue.kind is IssueKind.STALE_QUOTE
        assert issue.detail["age_seconds"] >= 3600

    def test_crossed_quote_is_flagged(self) -> None:
        issue = check_quote_freshness(quote("AAA", bid=101, ask=99), max_age_seconds=900)
        assert issue is not None
        assert "crossed" in issue.message


class TestProviderDisagreement:
    def test_agreement_within_tolerance_is_silent(self) -> None:
        days = sessions(START, 5)
        primary = bar_series("AAA", days, [100, 101, 102, 103, 104], provider="p1")
        secondary = bar_series("AAA", days, [100, 101, 102, 103, 104], provider="p2")
        assert compare_providers("AAA", primary, secondary) == []

    def test_material_disagreement_escalates_with_size(self) -> None:
        days = sessions(START, 5)
        primary = bar_series("AAA", days, [100, 101, 102, 103, 104], provider="p1")
        secondary = bar_series("AAA", days, [100, 101, 102, 103, 150], provider="p2")
        issues = compare_providers("AAA", primary, secondary)
        assert len(issues) == 1
        assert issues[0].kind is IssueKind.PROVIDER_DISAGREEMENT
        assert issues[0].severity is IssueSeverity.ERROR
        assert issues[0].detail["secondary_provider"] == "p2"

    def test_dates_only_one_provider_covers_are_skipped(self) -> None:
        days = sessions(START, 5)
        primary = bar_series("AAA", days, [100, 101, 102, 103, 104], provider="p1")
        secondary = bar_series("AAA", days[:2], [100, 101], provider="p2")
        assert compare_providers("AAA", primary, secondary) == []


class TestSilentDelisting:
    def test_data_that_stops_arriving_is_flagged(self, session) -> None:
        days = sessions(utcnow().date() - timedelta(days=40), 20)
        store_bars(session, bar_series("ZZZ", days[:10], [Decimal(50)] * 10))
        issue = detect_silent_delisting(session, "ZZZ", days)
        assert issue is not None
        assert issue.kind is IssueKind.DELISTED
        assert issue.detail["sessions_missing"] >= 5

    def test_current_data_is_not_flagged(self, session) -> None:
        days = sessions(utcnow().date() - timedelta(days=40), 20)
        store_bars(session, bar_series("ZZZ", days, [Decimal(50)] * 20))
        assert detect_silent_delisting(session, "ZZZ", days) is None

    def test_unknown_symbol_yields_no_false_positive(self, session) -> None:
        days = sessions(utcnow().date() - timedelta(days=40), 20)
        assert detect_silent_delisting(session, "NOSUCH", days) is None


class TestIssuePersistence:
    def test_issues_persist_and_deduplicate(self, session) -> None:
        days = sessions(START, 20)
        closes = [Decimal(100)] * 10 + [Decimal(50)] * 10
        result = validate_bars("AAA", bar_series("AAA", days, closes), expected_sessions=days)
        first = persist_issues(session, result.issues)
        session.flush()
        assert first >= 1

        # Re-validating the same defect must not multiply the operator's queue.
        second = persist_issues(session, result.issues)
        session.flush()
        assert second == 0

        summary = open_issue_summary(session)
        assert summary["open_total"] == first
        assert summary["blocking"] >= 1
        assert summary["healthy"] is False

    def test_summary_is_healthy_with_only_warnings(self, session) -> None:
        days = sessions(START, 5)
        bars = bar_series("AAA", days, [100, 101, 102, 103, 104])
        bars.append(bar_at("AAA", days[2], 102))
        result = validate_bars("AAA", bars, expected_sessions=days)
        persist_issues(session, result.issues)
        session.flush()
        summary = open_issue_summary(session)
        assert summary["open_total"] >= 1
        assert summary["blocking"] == 0
        assert summary["healthy"] is True


class TestIngestionRejectsBadData:
    """Validation is wired into ingestion, not merely available to it."""

    def test_ingest_records_issues_and_marks_synthetic_provenance(self, seeded: dict) -> None:
        report = seeded["report"]
        assert report.symbols_ok > 0
        assert report.bars_written > 0
        # The fixture provider is a simulator and must never be presented as real.
        assert report.used_synthetic is True

    def test_every_stored_bar_carries_provenance(self, seeded: dict, session) -> None:
        from sqlalchemy import select

        from aegisquant.db.models import Bar

        bars = list(session.scalars(select(Bar).limit(200)))
        assert bars
        for bar in bars:
            assert bar.provider
            assert bar.retrieved_at is not None
            assert bar.ts is not None
            assert bar.adjustment is not None
            assert bar.data_quality is not None

    @pytest.mark.parametrize("field", ["open", "high", "low", "close", "volume"])
    def test_stored_prices_are_decimal_not_float(self, seeded: dict, session, field: str) -> None:
        from sqlalchemy import select

        from aegisquant.db.models import Bar

        bar = session.scalars(select(Bar).limit(1)).one()
        assert isinstance(getattr(bar, field), Decimal)
