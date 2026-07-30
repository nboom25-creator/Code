"""Alpaca market-data provider (REST over httpx).

Credentials never leave the server. The free "IEX" data plan is assumed by
default; ``AEGIS_ALPACA_DATA_FEED=sip`` selects the consolidated feed if the
account is entitled to it.

Documented limitations of the free tier:

* IEX-only quotes/trades — a partial view of consolidated volume, so spread and
  ADV estimates are conservative rather than exact.
* 15-minute delay on some endpoints for free accounts. The data-age check in
  the risk engine is what protects order placement; nothing here pretends the
  data is fresher than it is.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from aegisquant.config import get_settings
from aegisquant.data.providers.base import (
    BarRecord,
    CalendarDayRecord,
    CalendarProvider,
    CorporateActionProvider,
    CorporateActionRecord,
    InstrumentProvider,
    InstrumentRecord,
    NewsProvider,
    NewsRecord,
    PriceProvider,
    ProviderDataMissing,
    ProviderError,
    ProviderNotConfigured,
    ProviderRateLimited,
    ProviderUnavailable,
    QuoteProvider,
    QuoteRecord,
    TradeProvider,
    TradeRecord,
)
from aegisquant.db.enums import Adjustment, AssetClass, DataQuality
from aegisquant.utils.money import D
from aegisquant.utils.timeutil import ensure_utc, utcnow

_TIMEFRAME = {
    "1Min": "1Min",
    "5Min": "5Min",
    "15Min": "15Min",
    "1Hour": "1Hour",
    "1Day": "1Day",
}
_ADJUSTMENT = {
    Adjustment.RAW: "raw",
    Adjustment.SPLIT_ONLY: "split",
    Adjustment.SPLIT_DIVIDEND: "all",
}


class AlpacaProvider(
    PriceProvider,
    QuoteProvider,
    TradeProvider,
    NewsProvider,
    CalendarProvider,
    InstrumentProvider,
    CorporateActionProvider,
):
    name = "alpaca"
    is_synthetic = False

    def __init__(self) -> None:
        s = get_settings()
        if not (s.alpaca_key_id and s.alpaca_secret_key):
            raise ProviderNotConfigured(self.name, "AEGIS_ALPACA_KEY_ID / SECRET_KEY not set")
        self._headers = {
            "APCA-API-KEY-ID": s.alpaca_key_id.get_secret_value(),
            "APCA-API-SECRET-KEY": s.alpaca_secret_key.get_secret_value(),
            "accept": "application/json",
        }
        self._data_url = s.alpaca_data_base_url.rstrip("/")
        self._trade_url = s.alpaca_trading_base_url.rstrip("/")
        self._timeout = s.provider_timeout_seconds
        self._feed = os.environ.get("AEGIS_ALPACA_DATA_FEED", "iex")

    # ------------------------------------------------------------------
    def _get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            resp = httpx.get(url, headers=self._headers, params=params, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(self.name, f"transport error: {exc}") from exc
        if resp.status_code == 429:
            retry = resp.headers.get("retry-after")
            raise ProviderRateLimited(self.name, float(retry) if retry else None)
        if resp.status_code in (401, 403):
            raise ProviderNotConfigured(self.name, "credentials rejected by Alpaca")
        if resp.status_code == 404:
            raise ProviderDataMissing(self.name, f"not found: {url}")
        if resp.status_code >= 500:
            raise ProviderUnavailable(self.name, f"upstream {resp.status_code}")
        if resp.status_code >= 400:
            raise ProviderError(self.name, resp.text[:300], status_code=resp.status_code)
        try:
            return resp.json()
        except ValueError as exc:
            raise ProviderError(self.name, "non-JSON response") from exc

    def _paged(self, url: str, params: dict[str, Any], key: str) -> list[Any]:
        out: list[Any] = []
        token: str | None = None
        for _ in range(50):  # hard page bound
            p = dict(params)
            if token:
                p["page_token"] = token
            payload = self._get(url, p)
            chunk = payload.get(key) or []
            if isinstance(chunk, dict):  # multi-symbol shape
                for sym, rows in chunk.items():
                    for r in rows:
                        r["S"] = sym
                        out.append(r)
            else:
                out.extend(chunk)
            token = payload.get("next_page_token")
            if not token:
                break
        return out

    # -- prices --------------------------------------------------------------
    def get_bars(
        self,
        symbol: str,
        start: date,
        end: date,
        timeframe: str = "1Day",
        adjustment: Adjustment = Adjustment.SPLIT_DIVIDEND,
    ) -> list[BarRecord]:
        tf = _TIMEFRAME.get(timeframe)
        if tf is None:
            raise ProviderDataMissing(self.name, f"unsupported timeframe {timeframe}")
        symbol = symbol.upper()
        rows = self._paged(
            f"{self._data_url}/v2/stocks/bars",
            {
                "symbols": symbol,
                "timeframe": tf,
                "start": start.isoformat(),
                "end": (end + timedelta(days=1)).isoformat(),
                "adjustment": _ADJUSTMENT[adjustment],
                "feed": self._feed,
                "limit": 10000,
            },
            "bars",
        )
        out: list[BarRecord] = []
        for r in rows:
            ts = ensure_utc(datetime.fromisoformat(r["t"].replace("Z", "+00:00")))
            if timeframe == "1Day":
                from aegisquant.utils.timeutil import as_of_from_bar_close

                ts = as_of_from_bar_close(ts.date())
            out.append(
                BarRecord(
                    symbol=symbol,
                    ts=ts,
                    open=D(r["o"]),
                    high=D(r["h"]),
                    low=D(r["l"]),
                    close=D(r["c"]),
                    volume=D(r.get("v") or 0),
                    vwap=D(r["vw"]) if r.get("vw") else None,
                    trade_count=r.get("n"),
                    timeframe=timeframe,
                    provenance=self.provenance(symbol, ts, adjustment=adjustment),
                )
            )
        return sorted(out, key=lambda b: b.ts)

    def get_latest_bar(self, symbol: str, timeframe: str = "1Day") -> BarRecord | None:
        today = utcnow().date()
        bars = self.get_bars(symbol, today - timedelta(days=7), today, timeframe)
        return bars[-1] if bars else None

    # -- quotes / trades -----------------------------------------------------
    def get_quote(self, symbol: str) -> QuoteRecord:
        symbol = symbol.upper()
        payload = self._get(
            f"{self._data_url}/v2/stocks/quotes/latest",
            {"symbols": symbol, "feed": self._feed},
        )
        q = (payload.get("quotes") or {}).get(symbol)
        if not q:
            raise ProviderDataMissing(self.name, f"no quote for {symbol}")
        observed = ensure_utc(datetime.fromisoformat(q["t"].replace("Z", "+00:00")))
        age = (utcnow() - observed).total_seconds()
        return QuoteRecord(
            symbol=symbol,
            observed_at=observed,
            bid=D(q.get("bp")) if q.get("bp") else None,
            ask=D(q.get("ap")) if q.get("ap") else None,
            bid_size=D(q.get("bs")) if q.get("bs") is not None else None,
            ask_size=D(q.get("as")) if q.get("as") is not None else None,
            provenance=self.provenance(symbol, observed, quality=DataQuality.STALE if age > 60 else DataQuality.OK),
        )

    def get_recent_trades(self, symbol: str, limit: int = 50) -> list[TradeRecord]:
        symbol = symbol.upper()
        rows = self._paged(
            f"{self._data_url}/v2/stocks/trades",
            {
                "symbols": symbol,
                "limit": min(limit, 1000),
                "feed": self._feed,
                "start": (utcnow() - timedelta(days=3)).isoformat(),
            },
            "trades",
        )
        out = []
        for r in rows[-limit:]:
            observed = ensure_utc(datetime.fromisoformat(r["t"].replace("Z", "+00:00")))
            out.append(
                TradeRecord(
                    symbol=symbol,
                    observed_at=observed,
                    price=D(r["p"]),
                    size=D(r["s"]),
                    exchange=r.get("x"),
                    provenance=self.provenance(symbol, observed),
                )
            )
        return out

    # -- corporate actions ---------------------------------------------------
    def get_corporate_actions(self, symbol: str, start: date, end: date) -> list[CorporateActionRecord]:
        symbol = symbol.upper()
        payload = self._get(
            f"{self._data_url}/v1/corporate-actions",
            {
                "symbols": symbol,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "types": "reverse_split,forward_split,cash_dividend,name_change,delisting",
            },
        )
        actions = payload.get("corporate_actions") or {}
        out: list[CorporateActionRecord] = []

        def prov(d: date) -> Any:
            from aegisquant.utils.timeutil import as_of_from_bar_close

            return self.provenance(symbol, as_of_from_bar_close(d))

        for row in actions.get("forward_splits", []) + actions.get("reverse_splits", []):
            ex = date.fromisoformat(row["ex_date"])
            old, new = D(row.get("old_rate") or 1), D(row.get("new_rate") or 1)
            out.append(
                CorporateActionRecord(
                    symbol=symbol,
                    action_type="split",
                    ex_date=ex,
                    ratio=(new / old) if old else None,
                    provenance=prov(ex),
                )
            )
        for row in actions.get("cash_dividends", []):
            ex = date.fromisoformat(row["ex_date"])
            out.append(
                CorporateActionRecord(
                    symbol=symbol,
                    action_type="dividend",
                    ex_date=ex,
                    cash_amount=D(row.get("rate")),
                    provenance=prov(ex),
                )
            )
        for row in actions.get("name_changes", []):
            ex = date.fromisoformat(row["process_date"])
            out.append(
                CorporateActionRecord(
                    symbol=symbol,
                    action_type="symbol_change",
                    ex_date=ex,
                    new_symbol=row.get("new_symbol"),
                    provenance=prov(ex),
                )
            )
        for row in actions.get("delistings", []):
            ex = date.fromisoformat(row["process_date"])
            out.append(CorporateActionRecord(symbol=symbol, action_type="delist", ex_date=ex, provenance=prov(ex)))
        return sorted(out, key=lambda r: r.ex_date)

    # -- news ----------------------------------------------------------------
    def get_news(self, symbol: str, start: date | None = None, limit: int = 50) -> list[NewsRecord]:
        symbol = symbol.upper()
        params: dict[str, Any] = {"symbols": symbol, "limit": min(limit, 50), "sort": "desc"}
        if start:
            params["start"] = start.isoformat()
        rows = self._paged(f"{self._data_url}/v1beta1/news", params, "news")
        out: list[NewsRecord] = []
        for r in rows[:limit]:
            published = ensure_utc(datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")))
            out.append(
                NewsRecord(
                    symbol=symbol,
                    external_id=str(r["id"]),
                    headline=r.get("headline") or "",
                    summary=r.get("summary"),
                    source=r.get("source"),
                    url=r.get("url"),
                    published_at=published,
                    # Alpaca supplies no sentiment score; the feature engine
                    # derives lexical sentiment separately and labels it as such.
                    sentiment=None,
                    provenance=self.provenance(symbol, published),
                )
            )
        return out

    # -- calendar ------------------------------------------------------------
    def get_calendar(self, start: date, end: date) -> list[CalendarDayRecord]:
        rows = self._get(f"{self._trade_url}/v2/calendar", {"start": start.isoformat(), "end": end.isoformat()})
        if not isinstance(rows, list):
            raise ProviderDataMissing(self.name, "unexpected calendar payload")
        out: list[CalendarDayRecord] = []
        from aegisquant.utils.timeutil import NY

        for r in rows:
            d = date.fromisoformat(r["date"])
            o_h, o_m = (int(x) for x in r["open"].split(":"))
            c_h, c_m = (int(x) for x in r["close"].split(":"))
            open_utc = datetime(d.year, d.month, d.day, o_h, o_m, tzinfo=NY).astimezone(utcnow().tzinfo)
            close_utc = datetime(d.year, d.month, d.day, c_h, c_m, tzinfo=NY).astimezone(utcnow().tzinfo)
            out.append(
                CalendarDayRecord(
                    session_date=d,
                    is_open=True,
                    provider=self.name,
                    open_utc=open_utc,
                    close_utc=close_utc,
                    early_close=(c_h, c_m) < (16, 0),
                )
            )
        # Alpaca returns only open days; fill the closed ones so gap detection works.
        present = {c.session_date for c in out}
        cur = start
        while cur <= end:
            if cur not in present:
                out.append(CalendarDayRecord(session_date=cur, is_open=False, provider=self.name))
            cur += timedelta(days=1)
        return sorted(out, key=lambda c: c.session_date)

    # -- instruments ---------------------------------------------------------
    def list_instruments(self, symbols: list[str] | None = None) -> list[InstrumentRecord]:
        rows = self._get(f"{self._trade_url}/v2/assets", {"status": "active", "asset_class": "us_equity"})
        wanted = {s.upper() for s in symbols} if symbols else None
        out: list[InstrumentRecord] = []
        assets: list[dict[str, Any]] = rows if isinstance(rows, list) else []
        for r in assets:
            sym = r["symbol"].upper()
            if wanted and sym not in wanted:
                continue
            name = r.get("name") or sym
            lc = name.lower()
            out.append(
                InstrumentRecord(
                    symbol=sym,
                    name=name,
                    asset_class=AssetClass.ETF if "etf" in lc or "trust" in lc else AssetClass.EQUITY,
                    exchange=r.get("exchange"),
                    sector=None,  # Alpaca assets carry no sector; enriched elsewhere
                    tradable=bool(r.get("tradable")),
                    fractionable=bool(r.get("fractionable")),
                    shortable=bool(r.get("shortable")),
                    easy_to_borrow=bool(r.get("easy_to_borrow")),
                    is_leveraged_etf=any(k in lc for k in ("2x", "3x", "ultra", "leveraged", "inverse")),
                    provenance=self.provenance(sym, utcnow()),
                )
            )
        return out

    def health(self) -> dict[str, Any]:
        try:
            self._get(f"{self._trade_url}/v2/clock")
            return {"provider": self.name, "ok": True, "synthetic": False, "feed": self._feed}
        except ProviderError as exc:
            return {"provider": self.name, "ok": False, "error": exc.message}
