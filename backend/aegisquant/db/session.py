"""Engine and session management.

PostgreSQL is the production target; SQLite is supported so the test suite and
an offline demo can run with no services. The only backend-specific behaviour is
foreign-key enforcement, which SQLite needs switched on explicitly.
"""

from __future__ import annotations

from collections.abc import Generator, Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from aegisquant.config import get_settings

_engine: Engine | None = None
_SessionFactory: sessionmaker[Session] | None = None


def _build_engine(url: str, echo: bool) -> Engine:
    kwargs: dict[str, Any] = {"echo": echo, "future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in url:
            from sqlalchemy.pool import StaticPool

            kwargs["poolclass"] = StaticPool
            kwargs.pop("pool_pre_ping")
    else:
        kwargs["pool_size"] = 10
        kwargs["max_overflow"] = 20
        kwargs["pool_recycle"] = 1800
    engine = create_engine(url, **kwargs)

    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn: Any, _rec: Any) -> None:
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            # WAL + a short busy timeout keeps concurrent readers working and
            # fails fast instead of blocking for the 5s default on contention.
            if ":memory:" not in url:
                cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=2000")
            cur.close()

    return engine


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        s = get_settings()
        _engine = _build_engine(s.database_url, s.sql_echo)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _SessionFactory
    if _SessionFactory is None:
        _SessionFactory = sessionmaker(
            bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False
        )
    return _SessionFactory


def reset_engine() -> None:
    """Test helper — drop cached engine/session factory."""
    global _engine, _SessionFactory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionFactory = None


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for service/worker code."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency. Commits on success, rolls back on exception."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def create_all() -> None:
    """Create the schema directly (tests / SQLite demo). Production uses Alembic."""
    from aegisquant.db.base import Base
    from aegisquant.db import models  # noqa: F401  (register mappers)

    Base.metadata.create_all(bind=get_engine())


def drop_all() -> None:
    from aegisquant.db.base import Base
    from aegisquant.db import models  # noqa: F401

    Base.metadata.drop_all(bind=get_engine())
