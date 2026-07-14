"""Simple TTL cache backed by SQLite.

Market responses are cached to respect provider rate limits and update
frequencies (end-of-day history changes at most daily; quotes are short-lived).
SQLite keeps the local dev setup zero-dependency; the same interface can be
backed by Redis/Postgres later without touching callers.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any

from app.config import get_settings

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        settings = get_settings()
        _conn = sqlite3.connect(settings.cache_db_path, check_same_thread=False)
        _conn.execute(
            "CREATE TABLE IF NOT EXISTS cache ("
            "  key TEXT PRIMARY KEY,"
            "  value TEXT NOT NULL,"
            "  expires_at REAL NOT NULL"
            ")"
        )
        _conn.commit()
    return _conn


def get(key: str) -> Any | None:
    with _lock:
        conn = _connection()
        row = conn.execute(
            "SELECT value, expires_at FROM cache WHERE key = ?", (key,)
        ).fetchone()
        if not row:
            return None
        value, expires_at = row
        if expires_at < time.time():
            conn.execute("DELETE FROM cache WHERE key = ?", (key,))
            conn.commit()
            return None
        return json.loads(value)


def set(key: str, value: Any, ttl_seconds: int) -> None:
    with _lock:
        conn = _connection()
        conn.execute(
            "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)",
            (key, json.dumps(value, default=str), time.time() + ttl_seconds),
        )
        conn.commit()


def clear() -> None:
    with _lock:
        conn = _connection()
        conn.execute("DELETE FROM cache")
        conn.commit()
