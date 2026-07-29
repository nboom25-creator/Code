"""Fundamental feature computations.

All inputs come from :meth:`PointInTime.fundamentals`, which only exposes rows
whose ``observed_at`` (publication time) is at or before the evaluation instant.
That is what keeps a backtest honest: the Q2 figures are invisible until the
filing date, not the quarter end.

Growth features prefer the provider's own year-over-year figure when it exists,
and otherwise derive it by matching the same fiscal quarter one year back — never
by comparing adjacent quarters, which would inject seasonality as signal.
"""

from __future__ import annotations

import numpy as np

from aegisquant.features.market_view import FundamentalRow, PointInTime


def _rows(pit: PointInTime, symbol: str) -> list[FundamentalRow]:
    return pit.fundamentals(symbol)


def _latest(pit: PointInTime, symbol: str) -> FundamentalRow | None:
    rows = _rows(pit, symbol)
    return rows[-1] if rows else None


def _val(row: FundamentalRow | None, key: str) -> float | None:
    if row is None:
        return None
    v = row.values.get(key)
    if v is None or not np.isfinite(v):
        return None
    return float(v)


def _year_ago(rows: list[FundamentalRow], target: FundamentalRow) -> FundamentalRow | None:
    """The row for the same fiscal quarter one year earlier (±25 days)."""
    for row in reversed(rows):
        delta = (target.period_end - row.period_end).days
        if 340 <= delta <= 390:
            return row
    return None


def _growth(rows: list[FundamentalRow], key: str, index: int = -1) -> float | None:
    if len(rows) < 2 or abs(index) > len(rows):
        return None
    target = rows[index]
    prior = _year_ago(rows[: len(rows) + index if index < -1 else None] or rows, target)
    if prior is None:
        return None
    now, then = _val(target, key), _val(prior, key)
    if now is None or then is None or then == 0:
        return None
    return (now - then) / abs(then)


def _provider_or_derived(rows: list[FundamentalRow], provided: str, base: str, index: int = -1) -> float | None:
    if abs(index) <= len(rows):
        direct = _val(rows[index], provided)
        if direct is not None:
            return direct
    return _growth(rows, base, index)


# ---------------------------------------------------------------------------
# growth
# ---------------------------------------------------------------------------
def revenue_growth_yoy(pit: PointInTime, symbol: str) -> float | None:
    return _provider_or_derived(_rows(pit, symbol), "revenue_yoy", "revenue")


def revenue_growth_accel(pit: PointInTime, symbol: str) -> float | None:
    rows = _rows(pit, symbol)
    if len(rows) < 2:
        return None
    now = _provider_or_derived(rows, "revenue_yoy", "revenue", -1)
    prev = _provider_or_derived(rows, "revenue_yoy", "revenue", -2)
    if now is None or prev is None:
        return None
    return now - prev


def eps_growth_yoy(pit: PointInTime, symbol: str) -> float | None:
    return _provider_or_derived(_rows(pit, symbol), "eps_yoy", "eps")


def eps_growth_accel(pit: PointInTime, symbol: str) -> float | None:
    rows = _rows(pit, symbol)
    if len(rows) < 2:
        return None
    now = _provider_or_derived(rows, "eps_yoy", "eps", -1)
    prev = _provider_or_derived(rows, "eps_yoy", "eps", -2)
    if now is None or prev is None:
        return None
    return now - prev


def fcf_growth_yoy(pit: PointInTime, symbol: str) -> float | None:
    return _provider_or_derived(_rows(pit, symbol), "fcf_yoy", "free_cash_flow")


# ---------------------------------------------------------------------------
# margins / quality
# ---------------------------------------------------------------------------
def gross_margin(pit: PointInTime, symbol: str) -> float | None:
    row = _latest(pit, symbol)
    direct = _val(row, "gross_margin")
    if direct is not None:
        return direct
    gp, rev = _val(row, "gross_profit"), _val(row, "revenue")
    if gp is None or not rev:
        return None
    return gp / rev


def gross_margin_delta_yoy(pit: PointInTime, symbol: str) -> float | None:
    rows = _rows(pit, symbol)
    if not rows:
        return None
    prior = _year_ago(rows, rows[-1])
    if prior is None:
        return None
    now, then = _val(rows[-1], "gross_margin"), _val(prior, "gross_margin")
    if now is None or then is None:
        return None
    return now - then


def operating_margin(pit: PointInTime, symbol: str) -> float | None:
    row = _latest(pit, symbol)
    direct = _val(row, "operating_margin")
    if direct is not None:
        return direct
    oi, rev = _val(row, "operating_income"), _val(row, "revenue")
    if oi is None or not rev:
        return None
    return oi / rev


def operating_leverage(pit: PointInTime, symbol: str) -> float | None:
    """Operating-income growth divided by revenue growth."""
    rows = _rows(pit, symbol)
    oi_growth = _growth(rows, "operating_income")
    rev_growth = _growth(rows, "revenue")
    if oi_growth is None or rev_growth is None or abs(rev_growth) < 0.005:
        return None  # undefined when revenue is flat; not defaulted to 1
    return oi_growth / rev_growth


def fcf_margin(pit: PointInTime, symbol: str) -> float | None:
    row = _latest(pit, symbol)
    fcf, rev = _val(row, "free_cash_flow"), _val(row, "revenue")
    if fcf is None or not rev:
        return None
    return fcf / rev


def fcf_conversion(pit: PointInTime, symbol: str) -> float | None:
    row = _latest(pit, symbol)
    fcf, ni = _val(row, "free_cash_flow"), _val(row, "net_income")
    if fcf is None or ni is None or abs(ni) < 1e-6:
        return None
    return fcf / ni


def accruals_ratio(pit: PointInTime, symbol: str) -> float | None:
    row = _latest(pit, symbol)
    direct = _val(row, "accruals_ratio")
    if direct is not None:
        return direct
    ni, ocf, rev = _val(row, "net_income"), _val(row, "operating_cash_flow"), _val(row, "revenue")
    if ni is None or ocf is None or not rev:
        return None
    return (ni - ocf) / abs(rev)


def roic(pit: PointInTime, symbol: str) -> float | None:
    row = _latest(pit, symbol)
    direct = _val(row, "roic")
    if direct is not None:
        return direct
    oi, equity, debt = _val(row, "operating_income"), _val(row, "total_equity"), _val(row, "total_debt")
    if oi is None or equity is None:
        return None
    invested = equity + (debt or 0.0)
    if invested <= 0:
        return None
    return oi * 4 / invested  # annualise a quarterly figure


# ---------------------------------------------------------------------------
# balance sheet
# ---------------------------------------------------------------------------
def debt_to_equity(pit: PointInTime, symbol: str) -> float | None:
    row = _latest(pit, symbol)
    direct = _val(row, "debt_to_equity")
    if direct is not None:
        return direct
    debt, equity = _val(row, "total_debt"), _val(row, "total_equity")
    if debt is None or not equity or equity <= 0:
        return None
    return debt / equity


def current_ratio(pit: PointInTime, symbol: str) -> float | None:
    return _val(_latest(pit, symbol), "current_ratio")


def net_cash_to_mcap(pit: PointInTime, symbol: str) -> float | None:
    row = _latest(pit, symbol)
    cash, debt, mcap = _val(row, "cash"), _val(row, "total_debt"), _val(row, "market_cap")
    if cash is None or not mcap or mcap <= 0:
        return None
    return (cash - (debt or 0.0)) / mcap


def dilution_1y(pit: PointInTime, symbol: str) -> float | None:
    return _growth(_rows(pit, symbol), "shares_outstanding")


# ---------------------------------------------------------------------------
# valuation
# ---------------------------------------------------------------------------
def pe_ratio(pit: PointInTime, symbol: str) -> float | None:
    return _val(_latest(pit, symbol), "pe_ratio")


def ps_ratio(pit: PointInTime, symbol: str) -> float | None:
    return _val(_latest(pit, symbol), "ps_ratio")


def ev_to_sales(pit: PointInTime, symbol: str) -> float | None:
    return _val(_latest(pit, symbol), "ev_to_sales")


def growth_adjusted_ps(pit: PointInTime, symbol: str) -> float | None:
    """Price/sales per point of growth — the GARP discipline in one number.

    Deliberately undefined (``None``) when growth is non-positive: a
    "cheap" multiple on shrinking revenue is not a growth opportunity, and
    returning a large number would let it rank as merely expensive.
    """
    ps = ps_ratio(pit, symbol)
    growth = revenue_growth_yoy(pit, symbol)
    if ps is None or growth is None or growth <= 0.02:
        return None
    return ps / (growth * 100)


def market_cap(pit: PointInTime, symbol: str) -> float | None:
    return _val(_latest(pit, symbol), "market_cap")


# ---------------------------------------------------------------------------
# durability / other
# ---------------------------------------------------------------------------
def recurring_revenue_pct(pit: PointInTime, symbol: str) -> float | None:
    return _val(_latest(pit, symbol), "recurring_revenue_pct")


def rnd_intensity(pit: PointInTime, symbol: str) -> float | None:
    row = _latest(pit, symbol)
    rnd, rev = _val(row, "rnd_expense"), _val(row, "revenue")
    if rnd is None or not rev:
        return None
    return rnd / rev


def short_interest_pct(pit: PointInTime, symbol: str) -> float | None:
    return _val(_latest(pit, symbol), "short_interest_pct")


def insider_net_buy_usd(pit: PointInTime, symbol: str) -> float | None:
    return _val(_latest(pit, symbol), "insider_net_buy_usd")


def periods_available(pit: PointInTime, symbol: str) -> float | None:
    return float(len(_rows(pit, symbol)))


def fundamental_momentum(pit: PointInTime, symbol: str) -> float | None:
    """Composite of acceleration, margin expansion and returns on capital.

    Components are individually scaled to roughly unit variance and averaged
    over whichever ones are available; ``None`` if fewer than two exist, so the
    score is never carried by a single noisy input.
    """
    parts: list[float] = []
    accel = revenue_growth_accel(pit, symbol)
    if accel is not None:
        parts.append(float(np.clip(accel / 0.05, -3, 3)))
    eps_accel = eps_growth_accel(pit, symbol)
    if eps_accel is not None:
        parts.append(float(np.clip(eps_accel / 0.15, -3, 3)))
    gm_delta = gross_margin_delta_yoy(pit, symbol)
    if gm_delta is not None:
        parts.append(float(np.clip(gm_delta / 0.02, -3, 3)))
    r = roic(pit, symbol)
    if r is not None:
        parts.append(float(np.clip((r - 0.10) / 0.10, -3, 3)))
    lev = operating_leverage(pit, symbol)
    if lev is not None:
        parts.append(float(np.clip((lev - 1.0) / 1.5, -3, 3)))
    if len(parts) < 2:
        return None
    return float(np.mean(parts))


SYMBOL_FEATURES = {
    "revenue_growth_yoy": revenue_growth_yoy,
    "revenue_growth_accel": revenue_growth_accel,
    "eps_growth_yoy": eps_growth_yoy,
    "eps_growth_accel": eps_growth_accel,
    "fcf_growth_yoy": fcf_growth_yoy,
    "gross_margin": gross_margin,
    "gross_margin_delta_yoy": gross_margin_delta_yoy,
    "operating_margin": operating_margin,
    "operating_leverage": operating_leverage,
    "fcf_margin": fcf_margin,
    "fcf_conversion": fcf_conversion,
    "accruals_ratio": accruals_ratio,
    "debt_to_equity": debt_to_equity,
    "current_ratio": current_ratio,
    "net_cash_to_mcap": net_cash_to_mcap,
    "dilution_1y": dilution_1y,
    "roic": roic,
    "pe_ratio": pe_ratio,
    "ps_ratio": ps_ratio,
    "ev_to_sales": ev_to_sales,
    "growth_adjusted_ps": growth_adjusted_ps,
    "market_cap": market_cap,
    "recurring_revenue_pct": recurring_revenue_pct,
    "rnd_intensity": rnd_intensity,
    "short_interest_pct": short_interest_pct,
    "insider_net_buy_usd": insider_net_buy_usd,
    "periods_available": periods_available,
    "fundamental_momentum": fundamental_momentum,
}
