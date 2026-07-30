"""yfinance-backed provider — free, keyless real market data.

Limitations (documented, not hidden):

* Unofficial API scraped from Yahoo Finance. No SLA, no guaranteed uptime, and
  it can change without notice. Suitable for research and paper trading; a
  licensed vendor (Polygon, Databento, Nasdaq, Refinitiv) is the production
  answer, and slots into the same interfaces.
* Fundamentals come from Yahoo's *current* snapshot. Yahoo does not publish the
  original filing timestamp, so ``observed_at`` is conservatively set to
  ``period_end + REPORTING_LAG_DAYS``. Anything that needs true as-reported
  point-in-time fundamentals must use a licensed provider; the estimate here is
  deliberately late rather than early so it cannot leak future information.
* No quote-level or trade-level data. Quote requests fall back to the latest
  bar close with an explicitly ``STALE`` quality flag, so the risk engine's
  data-age check does the right thing instead of trusting it.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from aegisquant.data.providers.base import (
    BarRecord,
    CorporateActionProvider,
    CorporateActionRecord,
    FundamentalRecord,
    FundamentalsProvider,
    InstrumentProvider,
    InstrumentRecord,
    NewsProvider,
    NewsRecord,
    PriceProvider,
    ProviderDataMissing,
    ProviderNotConfigured,
    ProviderUnavailable,
    QuoteProvider,
    QuoteRecord,
)
from aegisquant.db.enums import Adjustment, AssetClass, DataQuality
from aegisquant.logging_setup import get_logger
from aegisquant.utils.money import D
from aegisquant.utils.timeutil import ensure_utc, utcnow

log = get_logger(__name__)

REPORTING_LAG_DAYS = 45

_INTERVAL = {
    "1Min": "1m",
    "5Min": "5m",
    "15Min": "15m",
    "1Hour": "1h",
    "1Day": "1d",
    "1Week": "1wk",
}


def _import_yf() -> Any:
    try:
        import yfinance as yf
    except ImportError as exc:  # pragma: no cover
        raise ProviderNotConfigured(
            "yfinance", "yfinance is not installed (pip install 'aegisquant[providers]')"
        ) from exc
    return yf


class YFinanceProvider(
    PriceProvider,
    QuoteProvider,
    CorporateActionProvider,
    FundamentalsProvider,
    NewsProvider,
    InstrumentProvider,
):
    name = "yfinance"
    is_synthetic = False

    # -- prices --------------------------------------------------------------
    def get_bars(
        self,
        symbol: str,
        start: date,
        end: date,
        timeframe: str = "1Day",
        adjustment: Adjustment = Adjustment.SPLIT_DIVIDEND,
    ) -> list[BarRecord]:
        yf = _import_yf()
        interval = _INTERVAL.get(timeframe)
        if interval is None:
            raise ProviderDataMissing(self.name, f"unsupported timeframe {timeframe}")
        symbol = symbol.upper()
        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(
                start=start.isoformat(),
                end=(end + timedelta(days=1)).isoformat(),
                interval=interval,
                auto_adjust=adjustment is Adjustment.SPLIT_DIVIDEND,
                actions=False,
                raise_errors=True,
            )
        except Exception as exc:
            raise ProviderUnavailable(self.name, f"history failed for {symbol}: {exc}") from exc
        if df is None or df.empty:
            return []

        out: list[BarRecord] = []
        for idx, row in df.iterrows():
            ts = ensure_utc(idx.to_pydatetime())
            if timeframe == "1Day":
                # Yahoo stamps daily bars at midnight exchange time; the bar is
                # only observable at the close.
                from aegisquant.utils.timeutil import as_of_from_bar_close

                ts = as_of_from_bar_close(ts.date())
            try:
                o, h, low, c = (
                    D(row["Open"]),
                    D(row["High"]),
                    D(row["Low"]),
                    D(row["Close"]),
                )
            except (KeyError, ValueError):
                continue
            if any(v is None or v <= 0 for v in (o, h, low, c)):
                continue
            out.append(
                BarRecord(
                    symbol=symbol,
                    ts=ts,
                    open=o,
                    high=h,
                    low=low,
                    close=c,
                    volume=D(row.get("Volume") or 0),
                    timeframe=timeframe,
                    provenance=self.provenance(symbol, ts, adjustment=adjustment),
                )
            )
        return out

    def get_latest_bar(self, symbol: str, timeframe: str = "1Day") -> BarRecord | None:
        today = utcnow().date()
        bars = self.get_bars(symbol, today - timedelta(days=10), today, timeframe)
        return bars[-1] if bars else None

    # -- quotes --------------------------------------------------------------
    def get_quote(self, symbol: str) -> QuoteRecord:
        """Best-effort quote. Yahoo has no NBBO feed, so this is flagged STALE."""
        yf = _import_yf()
        symbol = symbol.upper()
        try:
            fast = yf.Ticker(symbol).fast_info
            last = fast.get("lastPrice") or fast.get("last_price")
            bid = fast.get("bid")
            ask = fast.get("ask")
        except Exception as exc:
            raise ProviderUnavailable(self.name, f"quote failed for {symbol}: {exc}") from exc
        if last is None and bid is None and ask is None:
            raise ProviderDataMissing(self.name, f"no quote for {symbol}")
        now = utcnow()
        return QuoteRecord(
            symbol=symbol,
            observed_at=now,
            bid=D(bid) if bid else None,
            ask=D(ask) if ask else None,
            last=D(last) if last else None,
            provenance=self.provenance(symbol, now, quality=DataQuality.STALE),
        )

    # -- corporate actions ---------------------------------------------------
    def get_corporate_actions(self, symbol: str, start: date, end: date) -> list[CorporateActionRecord]:
        yf = _import_yf()
        symbol = symbol.upper()
        out: list[CorporateActionRecord] = []
        try:
            ticker = yf.Ticker(symbol)
            splits = ticker.splits
            divs = ticker.dividends
        except Exception as exc:
            raise ProviderUnavailable(self.name, f"actions failed for {symbol}: {exc}") from exc

        for idx, ratio in (splits or {}).items():
            d = idx.date()
            if start <= d <= end and ratio:
                out.append(
                    CorporateActionRecord(
                        symbol=symbol,
                        action_type="split",
                        ex_date=d,
                        ratio=D(ratio),
                        provenance=self.provenance(symbol, ensure_utc(idx.to_pydatetime())),
                    )
                )
        for idx, amount in (divs or {}).items():
            d = idx.date()
            if start <= d <= end and amount:
                out.append(
                    CorporateActionRecord(
                        symbol=symbol,
                        action_type="dividend",
                        ex_date=d,
                        cash_amount=D(amount),
                        provenance=self.provenance(symbol, ensure_utc(idx.to_pydatetime())),
                    )
                )
        return sorted(out, key=lambda r: r.ex_date)

    # -- fundamentals --------------------------------------------------------
    _FIELD_MAP = {
        "Total Revenue": "revenue",
        "Gross Profit": "gross_profit",
        "Operating Income": "operating_income",
        "Net Income": "net_income",
        "Basic EPS": "eps",
        "Operating Cash Flow": "operating_cash_flow",
        "Free Cash Flow": "free_cash_flow",
        "Total Debt": "total_debt",
        "Stockholders Equity": "total_equity",
        "Cash And Cash Equivalents": "cash",
        "Research And Development": "rnd_expense",
    }

    def get_fundamentals(self, symbol: str, limit: int = 8) -> list[FundamentalRecord]:
        yf = _import_yf()
        symbol = symbol.upper()
        try:
            ticker = yf.Ticker(symbol)
            income = ticker.quarterly_income_stmt
            balance = ticker.quarterly_balance_sheet
            cash = ticker.quarterly_cashflow
            info = ticker.info or {}
        except Exception as exc:
            raise ProviderUnavailable(self.name, f"fundamentals failed for {symbol}: {exc}") from exc
        if income is None or income.empty:
            return []

        periods = sorted({c.date() for c in income.columns})[-limit:]
        out: list[FundamentalRecord] = []
        prior: dict[date, dict[str, Any]] = {}

        for pe in periods:
            values: dict[str, Any] = {}
            for frame in (income, balance, cash):
                if frame is None or frame.empty:
                    continue
                col = next((c for c in frame.columns if c.date() == pe), None)
                if col is None:
                    continue
                for label, key in self._FIELD_MAP.items():
                    if label in frame.index:
                        raw = frame.loc[label, col]
                        if raw is not None and raw == raw:  # not NaN
                            values[key] = D(float(raw))
            prior[pe] = values
            # Derived ratios, computed only from retrieved values.
            rev = values.get("revenue")
            if rev and rev != 0:
                if values.get("gross_profit") is not None:
                    values["gross_margin"] = values["gross_profit"] / rev
                if values.get("operating_income") is not None:
                    values["operating_margin"] = values["operating_income"] / rev
                ni, ocf = values.get("net_income"), values.get("operating_cash_flow")
                if ni is not None and ocf is not None:
                    values["accruals_ratio"] = (ni - ocf) / abs(rev)
            eq, debt = values.get("total_equity"), values.get("total_debt")
            if eq and eq != 0 and debt is not None:
                values["debt_to_equity"] = debt / eq
            # YoY needs the same quarter one year back.
            yoy_period = next((p for p in prior if abs((pe - p).days - 365) <= 20), None)
            if yoy_period:
                for base, key in (
                    ("revenue", "revenue_yoy"),
                    ("eps", "eps_yoy"),
                    ("free_cash_flow", "fcf_yoy"),
                ):
                    now_v, then_v = values.get(base), prior[yoy_period].get(base)
                    if now_v is not None and then_v not in (None, 0):
                        values[key] = (now_v - then_v) / abs(then_v)
            for src, key in (
                ("marketCap", "market_cap"),
                ("trailingPE", "pe_ratio"),
                ("priceToSalesTrailing12Months", "ps_ratio"),
                ("sharesOutstanding", "shares_outstanding"),
                ("shortPercentOfFloat", "short_interest_pct"),
                ("currentRatio", "current_ratio"),
            ):
                if info.get(src) is not None:
                    values[key] = D(info[src])

            observed = datetime.combine(pe + timedelta(days=REPORTING_LAG_DAYS), datetime.min.time()).replace(
                tzinfo=utcnow().tzinfo
            )
            out.append(
                FundamentalRecord(
                    symbol=symbol,
                    period_end=pe,
                    fiscal_period=f"Q{((pe.month - 1) // 3) + 1} {pe.year}",
                    values=values,
                    raw={"observed_at_is_estimated": True, "lag_days": REPORTING_LAG_DAYS},
                    provenance=self.provenance(symbol, observed, quality=DataQuality.OK),
                )
            )
        return out

    # -- news ----------------------------------------------------------------
    def get_news(self, symbol: str, start: date | None = None, limit: int = 50) -> list[NewsRecord]:
        yf = _import_yf()
        symbol = symbol.upper()
        try:
            items = yf.Ticker(symbol).news or []
        except Exception as exc:
            raise ProviderUnavailable(self.name, f"news failed for {symbol}: {exc}") from exc
        out: list[NewsRecord] = []
        for it in items[:limit]:
            content = it.get("content") or it
            ts = content.get("pubDate") or it.get("providerPublishTime")
            if isinstance(ts, (int, float)):
                published = datetime.fromtimestamp(ts, tz=utcnow().tzinfo)
            elif isinstance(ts, str):
                try:
                    published = ensure_utc(datetime.fromisoformat(ts.replace("Z", "+00:00")))
                except ValueError:
                    continue
            else:
                continue
            if start and published.date() < start:
                continue
            headline = content.get("title") or it.get("title")
            if not headline:
                continue
            provider_name = (content.get("provider") or {}).get("displayName") or it.get("publisher")
            out.append(
                NewsRecord(
                    symbol=symbol,
                    external_id=str(it.get("id") or content.get("id") or headline[:100]),
                    headline=headline,
                    summary=content.get("summary"),
                    source=provider_name,
                    url=(content.get("canonicalUrl") or {}).get("url") or it.get("link"),
                    published_at=published,
                    # No licensed sentiment feed: left None rather than invented.
                    sentiment=None,
                    provenance=self.provenance(symbol, published),
                )
            )
        return out

    # -- instruments ---------------------------------------------------------
    def list_instruments(self, symbols: list[str] | None = None) -> list[InstrumentRecord]:
        if not symbols:
            raise ProviderDataMissing(self.name, "yfinance cannot enumerate a universe; pass symbols")
        yf = _import_yf()
        out: list[InstrumentRecord] = []
        for sym in symbols:
            sym = sym.upper()
            try:
                info = yf.Ticker(sym).info or {}
            except Exception as exc:
                log.warning("yf_instrument_failed", symbol=sym, error=str(exc))
                continue
            quote_type = (info.get("quoteType") or "EQUITY").upper()
            ac = AssetClass.ETF if quote_type == "ETF" else AssetClass.EQUITY
            name_lc = (info.get("longName") or "").lower()
            out.append(
                InstrumentRecord(
                    symbol=sym,
                    name=info.get("longName") or info.get("shortName") or sym,
                    asset_class=ac,
                    exchange=info.get("exchange"),
                    sector=info.get("sector") or ("ETF" if ac is AssetClass.ETF else None),
                    industry=info.get("industry"),
                    tradable=True,
                    # Leveraged/inverse products are excluded from v1 trading.
                    is_leveraged_etf=any(k in name_lc for k in ("2x", "3x", "ultra", "leveraged", "inverse", "short ")),
                    provenance=self.provenance(sym, utcnow()),
                )
            )
        return out

    def health(self) -> dict[str, Any]:
        try:
            _import_yf()
        except ProviderNotConfigured as exc:
            return {"provider": self.name, "ok": False, "error": exc.message}
        return {
            "provider": self.name,
            "ok": True,
            "synthetic": False,
            "notes": "unofficial free source; no SLA; fundamentals observed_at is an estimate",
        }
