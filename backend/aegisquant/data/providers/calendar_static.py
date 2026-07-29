"""US equity market calendar computed from published NYSE holiday rules.

This is rule-based reference data, not fabricated market data: NYSE holidays and
their observance rules are public and deterministic. Ad-hoc closures (e.g. storm
closures, national days of mourning) that predate the rules are listed
explicitly. If the operator configures the Alpaca calendar provider, that
authoritative source is preferred.
"""

from __future__ import annotations

from datetime import date, timedelta

from aegisquant.data.providers.base import CalendarDayRecord, CalendarProvider
from aegisquant.utils.timeutil import session_close_utc, session_open_utc

# Non-rule-based closures. Extend as needed; absence only ever makes the
# calendar *more* permissive, and the data-quality layer flags days where every
# symbol is missing a bar.
AD_HOC_CLOSURES: dict[date, str] = {
    date(2012, 10, 29): "Hurricane Sandy",
    date(2012, 10, 30): "Hurricane Sandy",
    date(2018, 12, 5): "National Day of Mourning (G.H.W. Bush)",
    date(2025, 1, 9): "National Day of Mourning (J. Carter)",
}

# Half sessions (1:00pm ET close): day after Thanksgiving, Christmas Eve when a
# weekday, and July 3rd when July 4th falls on a weekday.
EARLY_CLOSE_NAMES = {"Day after Thanksgiving", "Christmas Eve", "Independence Day Eve"}


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    offset = (weekday - d.weekday()) % 7
    return d + timedelta(days=offset + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    while d.weekday() != weekday:
        d -= timedelta(days=1)
    return d


def _observed(d: date) -> date:
    """NYSE observance: Saturday holidays roll back to Friday, Sunday forward to Monday."""
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def _easter(year: int) -> date:
    """Anonymous Gregorian algorithm."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def holidays_for_year(year: int) -> dict[date, str]:
    """Full-day NYSE closures for ``year``."""
    hol: dict[date, str] = {
        _observed(date(year, 1, 1)): "New Year's Day",
        _nth_weekday(year, 1, 0, 3): "Martin Luther King Jr. Day",
        _nth_weekday(year, 2, 0, 3): "Washington's Birthday",
        _easter(year) - timedelta(days=2): "Good Friday",
        _last_weekday(year, 5, 0): "Memorial Day",
        _observed(date(year, 7, 4)): "Independence Day",
        _nth_weekday(year, 9, 0, 1): "Labor Day",
        _nth_weekday(year, 11, 3, 4): "Thanksgiving Day",
        _observed(date(year, 12, 25)): "Christmas Day",
    }
    if year >= 2022:  # Juneteenth became an NYSE holiday in 2022
        hol[_observed(date(year, 6, 19))] = "Juneteenth"
    if year < 1986:  # MLK Day first observed 1986
        hol.pop(_nth_weekday(year, 1, 0, 3), None)
    return hol


def early_closes_for_year(year: int) -> dict[date, str]:
    out: dict[date, str] = {}
    thanksgiving = _nth_weekday(year, 11, 3, 4)
    out[thanksgiving + timedelta(days=1)] = "Day after Thanksgiving"
    xmas_eve = date(year, 12, 24)
    if xmas_eve.weekday() < 5:
        out[xmas_eve] = "Christmas Eve"
    july3 = date(year, 7, 3)
    if july3.weekday() < 5 and date(year, 7, 4).weekday() < 5:
        out[july3] = "Independence Day Eve"
    return out


def is_trading_day(d: date) -> bool:
    if d.weekday() >= 5:
        return False
    if d in AD_HOC_CLOSURES:
        return False
    return d not in holidays_for_year(d.year)


def build_calendar(start: date, end: date) -> list[CalendarDayRecord]:
    out: list[CalendarDayRecord] = []
    years = range(start.year, end.year + 1)
    holidays: dict[date, str] = {}
    earlies: dict[date, str] = {}
    for y in years:
        holidays.update(holidays_for_year(y))
        earlies.update(early_closes_for_year(y))

    cur = start
    while cur <= end:
        weekend = cur.weekday() >= 5
        holiday_name = holidays.get(cur) or AD_HOC_CLOSURES.get(cur)
        is_open = not weekend and holiday_name is None
        early = is_open and cur in earlies
        out.append(
            CalendarDayRecord(
                session_date=cur,
                is_open=is_open,
                provider="static",
                open_utc=session_open_utc(cur) if is_open else None,
                close_utc=session_close_utc(cur, early=early) if is_open else None,
                early_close=early,
                holiday_name=holiday_name or (earlies.get(cur) if early else None),
            )
        )
        cur += timedelta(days=1)
    return out


class StaticCalendarProvider(CalendarProvider):
    """Rule-derived calendar. Always available, needs no network."""

    name = "static"
    is_synthetic = False

    def get_calendar(self, start: date, end: date) -> list[CalendarDayRecord]:
        return build_calendar(start, end)


def trading_days(start: date, end: date) -> list[date]:
    return [d.session_date for d in build_calendar(start, end) if d.is_open]
