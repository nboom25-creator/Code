"""Tests for provider normalization using recorded/sample payloads.

These verify that raw provider responses are correctly normalised into the
schema without hitting the network (parsing logic is what we own).
"""
import asyncio
import csv
import io
from datetime import date

import pytest

from app.providers import stooq
from app.providers.alphavantage import AlphaVantageProvider
from app.providers.demo import DEMO_CATALOG, DemoProvider
from app.schemas import OHLCV


def test_stooq_symbol_mapping():
    assert stooq._stooq_symbol("AAPL") == "aapl.us"
    assert stooq._stooq_symbol("^GSPC") == "^spx"
    assert stooq._stooq_symbol("brk.b") == "brk.b"


def test_stooq_history_parsing(monkeypatch):
    sample = (
        "Date,Open,High,Low,Close,Volume\n"
        "2024-01-02,10.0,11.0,9.5,10.5,1000\n"
        "2024-01-03,10.5,12.0,10.0,11.5,2000\n"
    )

    async def fake_get_text(url, params=None, headers=None):
        return sample

    monkeypatch.setattr(stooq, "get_text", fake_get_text)
    provider = stooq.StooqProvider()
    bars = asyncio.run(provider.get_daily_history("AAPL"))
    assert len(bars) == 2
    assert bars[0] == OHLCV(date=date(2024, 1, 2), open=10.0, high=11.0, low=9.5,
                            close=10.5, adj_close=10.5, volume=1000)
    assert bars[1].close == 11.5


def test_stooq_no_data_raises(monkeypatch):
    async def fake_get_text(url, params=None, headers=None):
        return "No data"

    monkeypatch.setattr(stooq, "get_text", fake_get_text)
    from app.providers.base import SymbolNotFound
    with pytest.raises(SymbolNotFound):
        asyncio.run(stooq.StooqProvider().get_daily_history("ZZZZ"))


def test_alphavantage_requires_key(monkeypatch):
    monkeypatch.delenv("ALPHAVANTAGE_API_KEY", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()
    from app.providers.base import ProviderNotConfigured
    with pytest.raises(ProviderNotConfigured):
        AlphaVantageProvider(api_key=None)


def test_alphavantage_quote_parsing():
    provider = AlphaVantageProvider(api_key="TESTKEY")

    async def fake_query(params):
        return {
            "Global Quote": {
                "05. price": "150.25", "08. previous close": "148.00",
                "09. change": "2.25", "10. change percent": "1.52%",
                "02. open": "148.5", "03. high": "151.0", "04. low": "147.9",
                "06. volume": "1234567",
            }
        }

    provider._query = fake_query  # type: ignore
    q = asyncio.run(provider.get_quote("AAPL"))
    assert q.price == 150.25
    assert q.change_percent == pytest.approx(1.52)
    assert q.previous_close == 148.0
    assert q.provenance.is_demo is False


def test_twelvedata_requires_key(monkeypatch):
    monkeypatch.delenv("TWELVEDATA_API_KEY", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()
    from app.providers.base import ProviderNotConfigured
    from app.providers.twelvedata import TwelveDataProvider
    with pytest.raises(ProviderNotConfigured):
        TwelveDataProvider(api_key=None)


def test_twelvedata_quote_and_history_parsing():
    from app.providers.twelvedata import TwelveDataProvider

    provider = TwelveDataProvider(api_key="TESTKEY")

    async def fake_get(path, params):
        if path == "/quote":
            return {
                "symbol": "AAPL", "open": "148.5", "high": "151.0", "low": "147.9",
                "close": "150.25", "previous_close": "148.00", "change": "2.25",
                "percent_change": "1.52", "volume": "1234567",
                "timestamp": 1710000000, "is_market_open": True,
            }
        if path == "/time_series":
            return {
                "meta": {"symbol": "AAPL"},
                "values": [
                    {"datetime": "2024-01-03", "open": "10.5", "high": "12.0", "low": "10.0", "close": "11.5", "volume": "2000"},
                    {"datetime": "2024-01-02", "open": "10.0", "high": "11.0", "low": "9.5", "close": "10.5", "volume": "1000"},
                ],
                "status": "ok",
            }
        return {}

    provider._get = fake_get  # type: ignore
    q = asyncio.run(provider.get_quote("AAPL"))
    assert q.price == 150.25 and q.change_percent == pytest.approx(1.52)
    assert q.provenance.is_demo is False and "Real-time" in (q.provenance.delay_note or "")

    bars = asyncio.run(provider.get_daily_history("AAPL"))
    assert len(bars) == 2
    assert bars[0].date == date(2024, 1, 2) and bars[-1].close == 11.5  # sorted ascending


def test_twelvedata_rate_limit_and_notfound():
    from app.providers.base import RateLimited, SymbolNotFound
    from app.providers.twelvedata import TwelveDataProvider
    from app.providers import twelvedata as td

    async def rate_limited(url, params=None, headers=None):
        return {"code": 429, "message": "API credits limit reached", "status": "error"}

    async def not_found(url, params=None, headers=None):
        return {"code": 404, "message": "symbol not found", "status": "error"}

    provider = TwelveDataProvider(api_key="K")
    td.get_json = rate_limited  # type: ignore
    with pytest.raises(RateLimited):
        asyncio.run(provider.get_quote("AAPL"))
    td.get_json = not_found  # type: ignore
    with pytest.raises(SymbolNotFound):
        asyncio.run(provider.get_quote("ZZZZ"))


def test_demo_is_deterministic_and_labelled():
    p = DemoProvider()
    a = asyncio.run(p.get_daily_history("AAPL"))
    b = asyncio.run(p.get_daily_history("AAPL"))
    assert [x.close for x in a] == [x.close for x in b]  # deterministic
    q = asyncio.run(p.get_quote("AAPL"))
    assert q.provenance.is_demo is True
    assert len(a) > 250 * 5  # at least ~5y of daily bars


def test_demo_catalog_has_benchmark():
    assert "^GSPC" in DEMO_CATALOG
