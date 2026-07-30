"""Shared test fixtures.

Everything runs against an in-memory SQLite database with the fixture data
provider, so the suite needs no PostgreSQL, no Redis, no network and no API keys.
Determinism comes from the fixture seed: the same seed always produces the same
market, so a failing assertion is reproducible.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

# Configure the environment before anything imports the settings singleton.
os.environ.setdefault("AEGIS_ENV_NAME", "test")
os.environ.setdefault("AEGIS_DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("AEGIS_MODE", "PAPER")
os.environ.setdefault("AEGIS_BROKER", "mock")
os.environ.setdefault("AEGIS_PRICE_PROVIDER", "fixture")
os.environ.setdefault("AEGIS_FUNDAMENTALS_PROVIDER", "fixture")
os.environ.setdefault("AEGIS_NEWS_PROVIDER", "fixture")
os.environ.setdefault("AEGIS_MACRO_PROVIDER", "fixture")
os.environ.setdefault("AEGIS_FIXTURE_SEED", "20240101")
os.environ.setdefault("AEGIS_SECRET_KEY", "test-secret-key-not-for-production-use")
os.environ.setdefault("AEGIS_BOOTSTRAP_ADMIN_PASSWORD", "test-password-1234")

from aegisquant.api.security import reset_rate_limiter  # noqa: E402
from aegisquant.config import get_settings, reset_settings_cache  # noqa: E402
from aegisquant.data.providers.fixture import FixtureProvider  # noqa: E402
from aegisquant.data.registry import reset_providers  # noqa: E402
from aegisquant.db.session import create_all, drop_all, reset_engine, session_scope  # noqa: E402
from aegisquant.execution.broker.factory import reset_brokers, set_broker  # noqa: E402
from aegisquant.execution.broker.mock import MockBroker, MockMarket  # noqa: E402
from aegisquant.logging_setup import configure_logging  # noqa: E402
from aegisquant.utils.timeutil import utcnow  # noqa: E402

#: A small universe keeps ingestion fast while still covering several sectors,
#: an ETF, and enough names for cross-sectional features to be defined.
TEST_UNIVERSE = ["SPY", "QQQ", "NVDA", "MSFT", "ISRG", "ENPH", "PANW", "VRTX", "V", "XLK"]


@pytest.fixture(scope="session", autouse=True)
def _settings() -> Iterator[None]:
    reset_settings_cache()
    # Configure logging exactly as a real process does, so the redaction
    # processor is actually in the chain when a test asserts on it.
    configure_logging(json_output=False)
    yield
    reset_settings_cache()


def _use_database(url: str) -> None:
    """Point the whole process at ``url`` and drop every cached handle."""
    os.environ["AEGIS_DATABASE_URL"] = url
    reset_settings_cache()
    reset_engine()
    reset_providers()
    reset_brokers()
    # The API rate limiter is a process-wide singleton keyed by client address.
    # Every test client presents the same address, so without this reset one
    # test exhausting the login budget would lock out every test after it.
    reset_rate_limiter()


@pytest.fixture()
def db(tmp_path: Path) -> Iterator[None]:
    """Fresh, empty schema per test, in its own SQLite file.

    A file rather than ``:memory:`` so the seeded template below can be cloned
    onto it; each test still gets an isolated database.
    """
    _use_database(f"sqlite:///{tmp_path / 'test.sqlite'}")
    create_all()
    yield
    drop_all()
    reset_engine()


@pytest.fixture()
def session(db: None) -> Iterator:
    with session_scope() as s:
        yield s


@pytest.fixture()
def fixture_provider() -> FixtureProvider:
    return FixtureProvider(seed=get_settings().fixture_seed)


#: Window of simulated history the seeded fixture ingests.
SEED_DAYS = 900


@pytest.fixture(scope="session")
def _seed_template(tmp_path_factory: pytest.TempPathFactory) -> dict[str, object]:
    """Ingest the test universe exactly once and keep the database file.

    Ingestion is the slow part of the suite (simulating three years of bars,
    fundamentals and news for ten symbols). Building it once and copying the
    file keeps every test independent without paying that cost repeatedly.
    """
    from aegisquant.data.ingest import ingest_macro, ingest_universe

    path = tmp_path_factory.mktemp("seed") / "template.sqlite"
    previous = os.environ["AEGIS_DATABASE_URL"]
    _use_database(f"sqlite:///{path}")
    create_all()

    end = utcnow().date()
    start = end - timedelta(days=SEED_DAYS)
    with session_scope() as s:
        report = ingest_universe(
            s,
            TEST_UNIVERSE,
            start,
            end,
            with_fundamentals=True,
            with_news=True,
            news_lookback_days=SEED_DAYS,
        )
        macro = ingest_macro(s, start, end)

    reset_engine()
    _use_database(previous)
    return {"path": path, "report": report, "macro_rows": macro, "start": start, "end": end}


@pytest.fixture()
def seeded(db: None, _seed_template: dict, tmp_path: Path) -> dict[str, object]:
    """A per-test database preloaded with the simulated universe."""
    target = tmp_path / "test.sqlite"
    reset_engine()
    for suffix in ("-wal", "-shm"):
        stale = Path(str(target) + suffix)
        if stale.exists():
            stale.unlink()
    shutil.copyfile(_seed_template["path"], target)  # type: ignore[arg-type]
    _use_database(f"sqlite:///{target}")
    return {k: v for k, v in _seed_template.items() if k != "path"}


@pytest.fixture()
def mock_broker(db: None) -> MockBroker:
    """A mock broker with prices for the test universe, registered as the broker."""
    from aegisquant.db.repo import latest_bar

    market = MockMarket()
    try:
        with session_scope() as s:
            for symbol in TEST_UNIVERSE:
                bar = latest_bar(s, symbol)
                if bar is not None:
                    market.set_price(symbol, bar.close)
    except Exception:
        pass
    for symbol in TEST_UNIVERSE:
        if market.price(symbol) is None:
            market.set_price(symbol, Decimal("100"))
    broker = MockBroker(starting_cash=Decimal("100000"), market=market, market_open=True)
    set_broker(broker, "mock")
    return broker


@pytest.fixture()
def strategies_registered(db: None) -> None:
    from aegisquant.seed import seed_risk_config, seed_strategies

    with session_scope() as s:
        seed_strategies(s)
        seed_risk_config(s)


@pytest.fixture()
def api_client(seeded: dict, mock_broker: MockBroker, strategies_registered: None):
    """FastAPI test client with an authenticated admin session."""
    from fastapi.testclient import TestClient

    from aegisquant.api.app import create_app
    from aegisquant.seed import seed_users

    with session_scope() as s:
        seed_users(s, "test-password-1234")

    client = TestClient(create_app())
    response = client.post(
        "/api/auth/login",
        json={"email": "admin@aegisquant.local", "password": "test-password-1234"},
    )
    assert response.status_code == 200, response.text
    csrf = response.json()["csrf_token"]
    client.headers.update({"x-csrf-token": csrf})
    return client


@pytest.fixture()
def as_of() -> datetime:
    """A deterministic evaluation instant inside the seeded window."""
    return datetime.combine(utcnow().date() - timedelta(days=10), datetime.min.time()).replace(
        hour=21, tzinfo=utcnow().tzinfo
    )


@pytest.fixture()
def backtest_window() -> tuple[date, date]:
    end = utcnow().date() - timedelta(days=5)
    return end - timedelta(days=730), end
