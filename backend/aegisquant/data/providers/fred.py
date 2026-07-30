"""FRED economic-indicator provider.

Uses the official API when ``AEGIS_FRED_API_KEY`` is set (free from
https://fred.stlouisfed.org/docs/api/api_key.html), otherwise the public
``fredgraph.csv`` endpoint, which needs no key.

Point-in-time caveat: the free endpoints return the *current* vintage of each
series, not the originally released figure. Macro series get revised, so a
backtest that reads revised values is mildly optimistic. AegisQuant compensates
by applying a per-series publication lag (``RELEASE_LAG_DAYS``) so that at
minimum no value is visible before it could have been published. Truly
as-reported vintages require the ALFRED endpoint (paid tiers / heavier quotas);
the interface is unchanged if you swap it in.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from aegisquant.config import get_settings
from aegisquant.data.providers.base import (
    EconomicProvider,
    EconomicRecord,
    ProviderDataMissing,
    ProviderError,
    ProviderRateLimited,
    ProviderUnavailable,
)
from aegisquant.utils.money import D
from aegisquant.utils.timeutil import utcnow

# Conservative publication lags in days, by series frequency.
RELEASE_LAG_DAYS: dict[str, int] = {
    "DGS10": 1,
    "DGS2": 1,
    "DGS3MO": 1,
    "T10Y2Y": 1,
    "VIXCLS": 1,
    "BAMLH0A0HYM2": 1,
    "CPIAUCSL": 16,
    "CPILFESL": 16,
    "UNRATE": 7,
    "PCEPI": 30,
    "INDPRO": 16,
    "T10YIE": 1,
}
DEFAULT_LAG_DAYS = 21

SERIES_LABELS: dict[str, tuple[str, str]] = {
    "DGS10": ("10-Year Treasury Yield", "percent"),
    "DGS2": ("2-Year Treasury Yield", "percent"),
    "DGS3MO": ("3-Month Treasury Yield", "percent"),
    "T10Y2Y": ("10Y-2Y Term Spread", "percent"),
    "VIXCLS": ("CBOE Volatility Index", "index"),
    "BAMLH0A0HYM2": ("High-Yield Credit Spread", "percent"),
    "CPIAUCSL": ("CPI (All Urban Consumers)", "index"),
    "CPILFESL": ("Core CPI", "index"),
    "UNRATE": ("Unemployment Rate", "percent"),
    "T10YIE": ("10-Year Breakeven Inflation", "percent"),
}


class FredProvider(EconomicProvider):
    name = "fred"
    is_synthetic = False

    def __init__(self) -> None:
        s = get_settings()
        self._key = s.fred_api_key.get_secret_value() if s.fred_api_key else None
        self._timeout = s.provider_timeout_seconds

    def _fetch_csv(self, series_id: str, start: date, end: date) -> list[tuple[date, str]]:
        url = "https://fred.stlouisfed.org/graph/fredgraph.csv"
        params = {
            "id": series_id,
            "cosd": start.isoformat(),
            "coed": end.isoformat(),
        }
        try:
            resp = httpx.get(url, params=params, timeout=self._timeout, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(self.name, f"transport error: {exc}") from exc
        if resp.status_code == 429:
            raise ProviderRateLimited(self.name)
        if resp.status_code >= 500:
            raise ProviderUnavailable(self.name, f"upstream {resp.status_code}")
        if resp.status_code >= 400:
            raise ProviderError(self.name, resp.text[:200], status_code=resp.status_code)
        reader = csv.reader(io.StringIO(resp.text))
        rows = list(reader)
        if not rows or len(rows) < 2:
            raise ProviderDataMissing(self.name, f"no rows for {series_id}")
        out: list[tuple[date, str]] = []
        for row in rows[1:]:
            if len(row) < 2:
                continue
            try:
                out.append((date.fromisoformat(row[0]), row[1]))
            except ValueError:
                continue
        return out

    def _fetch_api(self, series_id: str, start: date, end: date) -> list[tuple[date, str]]:
        url = "https://api.stlouisfed.org/fred/series/observations"
        params = {
            "series_id": series_id,
            "api_key": self._key,
            "file_type": "json",
            "observation_start": start.isoformat(),
            "observation_end": end.isoformat(),
        }
        try:
            resp = httpx.get(url, params=params, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(self.name, f"transport error: {exc}") from exc
        if resp.status_code == 429:
            raise ProviderRateLimited(self.name)
        if resp.status_code >= 400:
            raise ProviderError(self.name, resp.text[:200], status_code=resp.status_code)
        payload = resp.json()
        return [(date.fromisoformat(o["date"]), o["value"]) for o in payload.get("observations", []) if o.get("date")]

    def get_series(self, series_id: str, start: date, end: date) -> list[EconomicRecord]:
        rows = self._fetch_api(series_id, start, end) if self._key else self._fetch_csv(series_id, start, end)
        lag = RELEASE_LAG_DAYS.get(series_id, DEFAULT_LAG_DAYS)
        label, unit = SERIES_LABELS.get(series_id, (series_id, "unknown"))
        out: list[EconomicRecord] = []
        for obs_date, raw in rows:
            # FRED marks unavailable observations with "."; never invent a value.
            value = None if raw in (".", "", None) else D(raw)
            released = datetime.combine(obs_date + timedelta(days=lag), datetime.min.time()).replace(
                hour=13, tzinfo=utcnow().tzinfo
            )
            out.append(
                EconomicRecord(
                    series_id=series_id,
                    observation_date=obs_date,
                    value=value,
                    label=label,
                    unit=unit,
                    provenance=self.provenance(None, released),
                )
            )
        return out

    def health(self) -> dict[str, Any]:
        try:
            self._fetch_csv("DGS10", date.today() - timedelta(days=10), date.today())
            return {
                "provider": self.name,
                "ok": True,
                "synthetic": False,
                "authenticated": bool(self._key),
                "notes": "current vintage (revised) values; publication lag applied",
            }
        except ProviderError as exc:
            return {"provider": self.name, "ok": False, "error": exc.message}
