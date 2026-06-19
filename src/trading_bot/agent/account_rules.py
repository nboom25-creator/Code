"""Account rules + cost model for realistic execution.

Two US-market realities the bot should respect, both read from the trade ledger:

* **Pattern Day Trader (PDT):** an account under $25k may make at most 3 "day
  trades" (open and close the same name on the same day) in a rolling 5 business
  days. A 4th can get the account restricted — so we block it.
* **Wash sale:** selling at a loss and rebuying the same name within 30 days
  disallows the tax loss — so we avoid rebuying a recent loser.

Plus a tiny cost model so estimated (dry-run) fills aren't rose-tinted: you pay a
little more buying and receive a little less selling.
"""

from __future__ import annotations

import datetime as dt


def _today() -> dt.date:
    return dt.date.today()


def _date_of(iso_ts: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat(iso_ts[:10])
    except (ValueError, TypeError):
        return None


def opened_today(ticker: str, ledger, mode: str | None) -> bool:
    """True if there's a buy for ``ticker`` dated today (so selling it now would
    be a same-day round trip — a 'day trade')."""
    today = _today()
    for f in ledger.fills(mode=mode):
        if f.ticker == ticker and f.side == "buy" and _date_of(f.timestamp) == today:
            return True
    return False


def recent_day_trades(ledger, mode: str | None, *, within_days: int = 7) -> int:
    """Count closed round-trips that opened and closed on the same day, within the
    last ``within_days`` calendar days (~5 business days)."""
    cutoff = _today() - dt.timedelta(days=within_days)
    count = 0
    for c in ledger.closed_trades(mode=mode):
        entry, exit_ = _date_of(c.entry_time), _date_of(c.exit_time)
        if entry and exit_ and entry == exit_ and exit_ >= cutoff:
            count += 1
    return count


def pdt_would_block(ticker: str, ledger, equity: float, mode: str | None, *,
                    threshold: float = 25_000.0, max_day_trades: int = 3) -> bool:
    """True if selling ``ticker`` now would be a day trade that breaches PDT."""
    if ledger is None or equity >= threshold:
        return False
    if not opened_today(ticker, ledger, mode):
        return False  # not a same-day round trip → not a day trade
    return recent_day_trades(ledger, mode) >= max_day_trades


def wash_sale_blocked(ticker: str, ledger, mode: str | None, *,
                      days: int = 30) -> bool:
    """True if ``ticker`` was sold at a loss within the last ``days`` days."""
    if ledger is None:
        return False
    cutoff = _today() - dt.timedelta(days=days)
    for c in ledger.closed_trades(mode=mode):
        if c.ticker == ticker and c.pnl < 0:
            exit_ = _date_of(c.exit_time)
            if exit_ and exit_ >= cutoff:
                return True
    return False


def estimated_fill_price(price: float, side: str, slippage_pct: float) -> float:
    """Move the fill against us: pay more to buy, receive less to sell."""
    if slippage_pct <= 0:
        return price
    factor = (1 + slippage_pct) if side == "buy" else (1 - slippage_pct)
    return round(price * factor, 4)
