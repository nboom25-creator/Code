"""Stooq provider — keyless daily history and light quotes.

Stooq exposes free CSV endpoints that need no API key, which makes it the
default so the app works out of the box on a networked machine. Stooq does not
provide company fundamentals or news; those come back empty and the UI shows a
"not available from this provider" note rather than fabricating values.

US symbols are suffixed with ``.us``; the S&P 500 index maps to ``^spx``.
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone

from app.providers.base import MarketDataProvider, ProviderError, SymbolNotFound
from app.providers.http import get_text
from app.schemas import CompanyProfile, OHLCV, Provenance, Quote

_HISTORY_URL = "https://stooq.com/q/d/l/"
_QUOTE_URL = "https://stooq.com/q/l/"


def _stooq_symbol(ticker: str) -> str:
    t = ticker.strip().lower()
    if t in ("^gspc", "^spx", "spx"):
        return "^spx"
    if t.startswith("^"):
        return t
    if "." in t:
        return t
    return f"{t}.us"


class StooqProvider(MarketDataProvider):
    name = "Stooq"
    is_demo = False

    def _provenance(self) -> Provenance:
        return Provenance(
            source="Stooq (stooq.com)",
            as_of=datetime.now(timezone.utc),
            is_demo=False,
            delay_note="End-of-day data; may lag intraday by up to a day",
        )

    async def get_daily_history(
        self, ticker: str, start: date | None = None, end: date | None = None
    ) -> list[OHLCV]:
        params = {"s": _stooq_symbol(ticker), "i": "d"}
        text = await get_text(_HISTORY_URL, params=params)
        if not text or text.strip().lower().startswith("no data"):
            raise SymbolNotFound(ticker)
        reader = csv.DictReader(io.StringIO(text))
        bars: list[OHLCV] = []
        for row in reader:
            try:
                d = datetime.strptime(row["Date"], "%Y-%m-%d").date()
            except (KeyError, ValueError):
                continue
            if start and d < start:
                continue
            if end and d > end:
                continue
            try:
                close = float(row["Close"])
                bars.append(
                    OHLCV(
                        date=d,
                        open=float(row["Open"]),
                        high=float(row["High"]),
                        low=float(row["Low"]),
                        close=close,
                        # Stooq CSV close is already split/dividend adjusted.
                        adj_close=close,
                        volume=float(row.get("Volume") or 0),
                    )
                )
            except (ValueError, KeyError):
                continue
        if not bars:
            raise SymbolNotFound(ticker)
        bars.sort(key=lambda b: b.date)
        return bars

    async def get_quote(self, ticker: str) -> Quote:
        params = {"s": _stooq_symbol(ticker), "f": "sd2t2ohlcv", "h": "", "e": "csv"}
        text = await get_text(_QUOTE_URL, params=params)
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        if not rows:
            raise SymbolNotFound(ticker)
        row = rows[0]
        if (row.get("Close") in (None, "", "N/D")):
            # Fall back to history for a close when the light quote is empty.
            hist = await self.get_daily_history(ticker)
            last, prev = hist[-1], hist[-2]
            change = last.close - prev.close
            return Quote(
                ticker=ticker.upper(),
                price=last.close,
                change=round(change, 4),
                change_percent=round(change / prev.close * 100, 4),
                previous_close=prev.close,
                open=last.open,
                day_high=last.high,
                day_low=last.low,
                volume=last.volume,
                provenance=self._provenance(),
            )
        try:
            price = float(row["Close"])
            open_ = float(row["Open"])
        except (ValueError, KeyError) as exc:
            raise ProviderError("Malformed quote response from Stooq") from exc
        # Stooq light quote has no previous close; derive change from history tail.
        hist = await self.get_daily_history(ticker)
        prev_close = hist[-2].close if len(hist) >= 2 else open_
        change = price - prev_close
        return Quote(
            ticker=ticker.upper(),
            price=price,
            change=round(change, 4),
            change_percent=round(change / prev_close * 100, 4) if prev_close else 0.0,
            previous_close=prev_close,
            open=open_,
            day_high=float(row.get("High") or price),
            day_low=float(row.get("Low") or price),
            volume=float(row.get("Volume") or 0),
            provenance=self._provenance(),
        )

    async def get_profile(self, ticker: str) -> CompanyProfile:
        # Stooq does not expose company metadata; return a minimal profile so the
        # UI can render, clearly noting the missing fields rather than inventing.
        return CompanyProfile(
            ticker=ticker.upper(),
            name=ticker.upper(),
            exchange=None,
            currency="USD",
            sector=None,
            industry=None,
            market_cap=None,
            description="Company metadata is not available from Stooq. Configure a "
            "keyed provider (Alpha Vantage / Finnhub) for profile and fundamentals.",
            provenance=self._provenance(),
        )
