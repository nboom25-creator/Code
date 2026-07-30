"""Data-quality validation.

Everything ingested passes through here before research or trading can see it.
The rule is simple: **detect and report, never repair by invention.** A bar that
fails validation is flagged (and, when structurally impossible, dropped), but no
value is ever synthesised to fill a hole.

Checks implemented
------------------
=========================  ====================================================
missing_bar                trading session with no bar for a symbol
duplicate_record           two bars for the same (symbol, timeframe, timestamp)
stale_quote                quote older than the configured freshness budget
timestamp_inconsistency    out-of-order / future-dated / non-session timestamps
ohlc_inconsistent          high < low, close outside [low, high], etc.
non_positive_price         zero or negative price or volume
adjustment_error           price jump with no corporate action to explain it
extreme_outlier            robust-z outlier in log returns
symbol_change              rename recorded in corporate actions
delisted                   delisting recorded, or data stopped arriving
provider_disagreement      two providers differ beyond tolerance on a close
market_closed             data returned for a day the calendar says was closed
=========================  ====================================================
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.data.providers.base import BarRecord, CorporateActionRecord, QuoteRecord
from aegisquant.db.enums import DataQuality, IssueKind, IssueSeverity
from aegisquant.db.models import Bar, DataQualityIssue
from aegisquant.logging_setup import get_logger
from aegisquant.utils.money import D, safe_div
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)

# A single-session move beyond this, with no corporate action on that date, is
# treated as a likely adjustment error rather than a real return.
ADJUSTMENT_JUMP_THRESHOLD = Decimal("0.35")
# Robust z-score cut-off for return outliers (median/MAD based).
OUTLIER_ROBUST_Z = Decimal("12")
# Cross-provider close tolerance.
PROVIDER_DISAGREEMENT_TOLERANCE = Decimal("0.02")
# How far after a recorded ex-date a price gap may still be attributed to it.
# Covers a weekend plus a holiday, which is the longest a US session gap runs.
ACTION_MATCH_WINDOW_DAYS = 4


@dataclass(slots=True)
class Issue:
    kind: IssueKind
    severity: IssueSeverity
    message: str
    symbol: str | None = None
    provider: str | None = None
    session_date: date | None = None
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ValidationResult:
    accepted: list[BarRecord]
    rejected: list[BarRecord]
    issues: list[Issue]

    @property
    def ok(self) -> bool:
        return not any(i.severity in (IssueSeverity.ERROR, IssueSeverity.CRITICAL) for i in self.issues)

    def worst_quality(self) -> DataQuality:
        if any(i.severity is IssueSeverity.CRITICAL for i in self.issues):
            return DataQuality.CORRUPT
        if any(i.severity is IssueSeverity.ERROR for i in self.issues):
            return DataQuality.SUSPECT
        return DataQuality.OK


def _robust_z(values: list[Decimal]) -> list[Decimal]:
    if len(values) < 8:
        return [Decimal(0)] * len(values)
    floats = [float(v) for v in values]
    med = Decimal(str(statistics.median(floats)))
    abs_dev = [abs(v - med) for v in values]
    mad = Decimal(str(statistics.median([float(a) for a in abs_dev])))
    if mad == 0:
        return [Decimal(0)] * len(values)
    scale = mad * Decimal("1.4826")  # MAD -> sigma for a normal distribution
    return [(v - med) / scale for v in values]


def validate_bars(
    symbol: str,
    bars: list[BarRecord],
    *,
    expected_sessions: list[date] | None = None,
    corporate_actions: list[CorporateActionRecord] | None = None,
    provider: str | None = None,
    now: datetime | None = None,
) -> ValidationResult:
    """Validate a batch of bars for one symbol.

    ``expected_sessions`` should be the trading calendar for the requested
    window; missing-bar detection is skipped without it.
    """
    now = now or utcnow()
    provider = provider or (bars[0].provenance.provider if bars else "unknown")
    issues: list[Issue] = []
    accepted: list[BarRecord] = []
    rejected: list[BarRecord] = []
    # A dividend that is small relative to price cannot explain a large jump, but
    # splits and large special dividends can; keep both in the exemption set.
    #
    # The window matters. Providers disagree by a day or two on where an ex-date
    # falls (announcement vs. ex vs. distribution), a holiday shifts the first
    # session that can print the gap, and some feeds date an action to a weekend.
    # Requiring exact equality would report a perfectly ordinary split as an
    # unexplained 67% move — and since the promotion gate demands zero open
    # blocking issues, a false positive here blocks a strategy for no reason.
    action_dates: set[date] = set()
    for action in corporate_actions or []:
        for offset in range(-1, ACTION_MATCH_WINDOW_DAYS + 1):
            action_dates.add(action.ex_date + timedelta(days=offset))

    # --- structural checks, bar by bar ---
    seen_keys: set[tuple[str, datetime]] = set()
    prev_ts: datetime | None = None
    for bar in sorted(bars, key=lambda b: b.ts):
        key = (bar.timeframe, bar.ts)
        d = bar.ts.date()

        if key in seen_keys:
            issues.append(
                Issue(
                    IssueKind.DUPLICATE_RECORD,
                    IssueSeverity.WARNING,
                    f"duplicate bar for {symbol} at {bar.ts.isoformat()}",
                    symbol,
                    provider,
                    d,
                )
            )
            rejected.append(bar)
            continue
        seen_keys.add(key)

        if min(bar.open, bar.high, bar.low, bar.close) <= 0:
            issues.append(
                Issue(
                    IssueKind.NEGATIVE_OR_ZERO_PRICE,
                    IssueSeverity.ERROR,
                    f"non-positive price for {symbol} on {d}",
                    symbol,
                    provider,
                    d,
                    {"open": str(bar.open), "close": str(bar.close), "low": str(bar.low)},
                )
            )
            rejected.append(bar)
            continue

        if bar.high < bar.low or not (bar.low <= bar.open <= bar.high) or not (bar.low <= bar.close <= bar.high):
            issues.append(
                Issue(
                    IssueKind.OHLC_INCONSISTENT,
                    IssueSeverity.ERROR,
                    f"OHLC inconsistent for {symbol} on {d}",
                    symbol,
                    provider,
                    d,
                    {
                        "open": str(bar.open),
                        "high": str(bar.high),
                        "low": str(bar.low),
                        "close": str(bar.close),
                    },
                )
            )
            rejected.append(bar)
            continue

        if bar.volume < 0:
            issues.append(
                Issue(
                    IssueKind.NEGATIVE_OR_ZERO_PRICE,
                    IssueSeverity.ERROR,
                    f"negative volume for {symbol} on {d}",
                    symbol,
                    provider,
                    d,
                )
            )
            rejected.append(bar)
            continue

        if bar.ts > now + timedelta(minutes=5):
            issues.append(
                Issue(
                    IssueKind.TIMESTAMP_INCONSISTENCY,
                    IssueSeverity.ERROR,
                    f"future-dated bar for {symbol}: {bar.ts.isoformat()}",
                    symbol,
                    provider,
                    d,
                )
            )
            rejected.append(bar)
            continue

        if prev_ts is not None and bar.ts <= prev_ts:
            issues.append(
                Issue(
                    IssueKind.TIMESTAMP_INCONSISTENCY,
                    IssueSeverity.WARNING,
                    f"non-monotonic timestamp for {symbol} at {bar.ts.isoformat()}",
                    symbol,
                    provider,
                    d,
                )
            )
        prev_ts = bar.ts

        if expected_sessions is not None and bar.timeframe == "1Day" and d not in set(expected_sessions):
            issues.append(
                Issue(
                    IssueKind.MARKET_CLOSED,
                    IssueSeverity.WARNING,
                    f"bar for {symbol} on {d}, which the calendar reports as closed",
                    symbol,
                    provider,
                    d,
                )
            )

        accepted.append(bar)

    # --- return-based checks ---
    if len(accepted) >= 2:
        returns: list[Decimal] = []
        for prev, cur in zip(accepted, accepted[1:], strict=False):
            returns.append(safe_div(cur.close - prev.close, prev.close))
        zs = _robust_z(returns)
        for (prev, cur), ret, z in zip(zip(accepted, accepted[1:], strict=False), returns, zs, strict=False):
            d = cur.ts.date()
            if abs(ret) >= ADJUSTMENT_JUMP_THRESHOLD and d not in action_dates:
                issues.append(
                    Issue(
                        IssueKind.ADJUSTMENT_ERROR,
                        IssueSeverity.ERROR,
                        (
                            f"{symbol} moved {float(ret):.1%} on {d} with no corporate action "
                            "on record — possible split/dividend adjustment error"
                        ),
                        symbol,
                        provider,
                        d,
                        {
                            "return": str(ret),
                            "prev_close": str(prev.close),
                            "close": str(cur.close),
                        },
                    )
                )
            elif abs(z) >= OUTLIER_ROBUST_Z and d not in action_dates:
                issues.append(
                    Issue(
                        IssueKind.EXTREME_OUTLIER,
                        IssueSeverity.WARNING,
                        f"{symbol} return on {d} is a {float(z):.1f}-sigma robust outlier",
                        symbol,
                        provider,
                        d,
                        {"return": str(ret), "robust_z": str(z)},
                    )
                )

    # --- missing sessions ---
    if expected_sessions:
        have = {b.ts.date() for b in accepted if b.timeframe == "1Day"}
        missing = [d for d in expected_sessions if d not in have]
        # Trailing gaps are usually "not published yet", not a data error.
        if missing:
            last_expected = max(expected_sessions)
            hard_missing = [d for d in missing if d < last_expected]
            if hard_missing:
                issues.append(
                    Issue(
                        IssueKind.MISSING_BAR,
                        IssueSeverity.WARNING if len(hard_missing) <= 2 else IssueSeverity.ERROR,
                        f"{symbol} missing {len(hard_missing)} session(s) in the requested window",
                        symbol,
                        provider,
                        hard_missing[0],
                        {
                            "missing": [d.isoformat() for d in hard_missing[:30]],
                            "count": len(hard_missing),
                        },
                    )
                )

    # --- corporate-action driven identity changes ---
    for action in corporate_actions or []:
        if action.action_type == "symbol_change":
            issues.append(
                Issue(
                    IssueKind.SYMBOL_CHANGE,
                    IssueSeverity.INFO,
                    f"{symbol} renamed to {action.new_symbol} effective {action.ex_date}",
                    symbol,
                    provider,
                    action.ex_date,
                    {"new_symbol": action.new_symbol},
                )
            )
        elif action.action_type == "delist":
            issues.append(
                Issue(
                    IssueKind.DELISTED,
                    IssueSeverity.WARNING,
                    f"{symbol} delisted effective {action.ex_date}",
                    symbol,
                    provider,
                    action.ex_date,
                )
            )

    return ValidationResult(accepted=accepted, rejected=rejected, issues=issues)


def check_quote_freshness(quote: QuoteRecord, max_age_seconds: int, now: datetime | None = None) -> Issue | None:
    now = now or utcnow()
    age = (now - quote.observed_at).total_seconds()
    if age > max_age_seconds:
        return Issue(
            IssueKind.STALE_QUOTE,
            IssueSeverity.ERROR,
            f"{quote.symbol} quote is {int(age)}s old (budget {max_age_seconds}s)",
            quote.symbol,
            quote.provenance.provider,
            quote.observed_at.date(),
            {"age_seconds": int(age), "max_age_seconds": max_age_seconds},
        )
    if quote.bid and quote.ask and quote.ask < quote.bid:
        return Issue(
            IssueKind.STALE_QUOTE,
            IssueSeverity.ERROR,
            f"{quote.symbol} crossed quote: bid {quote.bid} > ask {quote.ask}",
            quote.symbol,
            quote.provenance.provider,
            quote.observed_at.date(),
        )
    return None


def compare_providers(
    symbol: str,
    primary: list[BarRecord],
    secondary: list[BarRecord],
    tolerance: Decimal = PROVIDER_DISAGREEMENT_TOLERANCE,
) -> list[Issue]:
    """Flag dates where two providers disagree on the close beyond ``tolerance``."""
    sec_by_date = {b.ts.date(): b for b in secondary}
    issues: list[Issue] = []
    for bar in primary:
        other = sec_by_date.get(bar.ts.date())
        if other is None:
            continue
        diff = abs(safe_div(bar.close - other.close, other.close))
        if diff > tolerance:
            issues.append(
                Issue(
                    IssueKind.PROVIDER_DISAGREEMENT,
                    IssueSeverity.ERROR if diff > tolerance * 3 else IssueSeverity.WARNING,
                    (
                        f"{symbol} close on {bar.ts.date()} differs by {float(diff):.2%} between "
                        f"{bar.provenance.provider} and {other.provenance.provider}"
                    ),
                    symbol,
                    bar.provenance.provider,
                    bar.ts.date(),
                    {
                        "primary": str(bar.close),
                        "secondary": str(other.close),
                        "difference_pct": str(diff),
                        "secondary_provider": other.provenance.provider,
                    },
                )
            )
    return issues


def detect_silent_delisting(
    session: Session, symbol: str, expected_sessions: list[date], min_missing: int = 5
) -> Issue | None:
    """A symbol whose data simply stopped arriving is treated as possibly delisted."""
    if len(expected_sessions) < min_missing:
        return None
    last = session.scalar(select(Bar.ts).where(Bar.symbol == symbol.upper()).order_by(Bar.ts.desc()).limit(1))
    if last is None:
        return None
    tail = [d for d in expected_sessions if d > last.date()]
    if len(tail) >= min_missing:
        return Issue(
            IssueKind.DELISTED,
            IssueSeverity.WARNING,
            (
                f"{symbol} has no data for the last {len(tail)} sessions "
                f"(latest bar {last.date()}) — possible delisting or symbol change"
            ),
            symbol,
            None,
            tail[0],
            {"sessions_missing": len(tail), "last_bar": last.date().isoformat()},
        )
    return None


def persist_issues(session: Session, issues: list[Issue]) -> int:
    """Write issues, de-duplicating against unresolved rows for the same key."""
    written = 0
    for issue in issues:
        existing = session.scalar(
            select(DataQualityIssue).where(
                DataQualityIssue.kind == issue.kind,
                DataQualityIssue.symbol == issue.symbol,
                DataQualityIssue.session_date == issue.session_date,
                DataQualityIssue.resolved.is_(False),
            )
        )
        if existing is not None:
            existing.message = issue.message
            existing.detail = issue.detail
            continue
        session.add(
            DataQualityIssue(
                detected_at=utcnow(),
                kind=issue.kind,
                severity=issue.severity,
                symbol=issue.symbol,
                provider=issue.provider,
                session_date=issue.session_date,
                message=issue.message,
                detail=issue.detail,
            )
        )
        written += 1
    return written


def open_issue_summary(session: Session) -> dict[str, Any]:
    rows = list(session.scalars(select(DataQualityIssue).where(DataQualityIssue.resolved.is_(False))))
    by_severity: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    for r in rows:
        by_severity[r.severity.value] = by_severity.get(r.severity.value, 0) + 1
        by_kind[r.kind.value] = by_kind.get(r.kind.value, 0) + 1
    blocking = sum(1 for r in rows if r.severity in (IssueSeverity.ERROR, IssueSeverity.CRITICAL))
    return {
        "open_total": len(rows),
        "blocking": blocking,
        "by_severity": by_severity,
        "by_kind": by_kind,
        "healthy": blocking == 0,
    }


def bar_quality_for(issues: list[Issue], session_date: date) -> DataQuality:
    """Worst quality implied by ``issues`` for a specific session."""
    relevant = [i for i in issues if i.session_date == session_date]
    if any(i.severity is IssueSeverity.CRITICAL for i in relevant):
        return DataQuality.CORRUPT
    if any(i.severity is IssueSeverity.ERROR for i in relevant):
        return DataQuality.SUSPECT
    return DataQuality.OK


def as_decimal_summary(values: list[Any]) -> Decimal:  # pragma: no cover - helper
    return D(sum(D(v) for v in values))
