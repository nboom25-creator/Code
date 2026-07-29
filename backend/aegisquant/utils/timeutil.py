"""UTC-first time helpers.

Every timestamp that enters the database is timezone-aware UTC. Display-time
conversion to the operator's configured timezone happens in the API layer only.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
NY = ZoneInfo("America/New_York")

# Regular US equity session, in exchange-local time.
REGULAR_OPEN = time(9, 30)
REGULAR_CLOSE = time(16, 0)
EARLY_CLOSE = time(13, 0)


def utcnow() -> datetime:
    return datetime.now(tz=UTC)


def ensure_utc(dt: datetime) -> datetime:
    """Attach UTC to a naive datetime, or convert an aware one."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def to_display(dt: datetime, tz_name: str) -> datetime:
    return ensure_utc(dt).astimezone(ZoneInfo(tz_name))


def session_open_utc(d: date) -> datetime:
    return datetime.combine(d, REGULAR_OPEN, tzinfo=NY).astimezone(UTC)


def session_close_utc(d: date, early: bool = False) -> datetime:
    close = EARLY_CLOSE if early else REGULAR_CLOSE
    return datetime.combine(d, close, tzinfo=NY).astimezone(UTC)


def as_of_from_bar_close(d: date, early: bool = False) -> datetime:
    """The moment a daily bar for ``d`` becomes legitimately observable."""
    return session_close_utc(d, early)


def daterange(start: date, end: date) -> list[date]:
    out, cur = [], start
    while cur <= end:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def parse_iso_date(value: str) -> date:
    return date.fromisoformat(value[:10])
