"""Shared networking concerns: caching, rate limiting, retry with backoff.

Every provider call funnels through :func:`call_with_policy` so that retry
counts, rate-limit hits and latency are uniformly observable.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar

from aegisquant.config import get_settings
from aegisquant.data.providers.base import (
    ProviderError,
    ProviderNotConfigured,
    ProviderRateLimited,
)
from aegisquant.logging_setup import get_logger

log = get_logger(__name__)
T = TypeVar("T")


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
class TTLCache:
    """Process-local TTL cache with an optional Redis tier.

    Redis is used when reachable so that the API, worker and scheduler share
    provider responses; the in-process dict is always the fast path.
    """

    def __init__(self, namespace: str = "aegis:cache") -> None:
        self._local: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()
        self._ns = namespace
        self._redis: Any | None = None
        self._redis_checked = False

    def _get_redis(self) -> Any | None:
        if self._redis_checked:
            return self._redis
        self._redis_checked = True
        try:
            import redis  # local import: optional dependency at runtime

            client = redis.Redis.from_url(get_settings().redis_url, socket_timeout=1.0)
            client.ping()
            self._redis = client
        except Exception as exc:  # pragma: no cover - environment dependent
            log.debug("redis_cache_unavailable", error=str(exc))
            self._redis = None
        return self._redis

    @staticmethod
    def key(*parts: Any) -> str:
        raw = json.dumps(parts, default=str, sort_keys=True)
        return hashlib.sha256(raw.encode()).hexdigest()[:40]

    def get(self, key: str) -> Any | None:
        now = time.time()
        with self._lock:
            hit = self._local.get(key)
            if hit and hit[0] > now:
                return hit[1]
            if hit:
                self._local.pop(key, None)
        r = self._get_redis()
        if r is not None:
            try:
                raw = r.get(f"{self._ns}:{key}")
                if raw:
                    return json.loads(raw)
            except Exception:  # pragma: no cover
                return None
        return None

    def set(self, key: str, value: Any, ttl: int) -> None:
        with self._lock:
            self._local[key] = (time.time() + ttl, value)
            if len(self._local) > 4096:  # crude bound
                for k in list(self._local)[:512]:
                    self._local.pop(k, None)
        r = self._get_redis()
        if r is not None:
            try:
                r.setex(f"{self._ns}:{key}", ttl, json.dumps(value, default=str))
            except Exception:  # pragma: no cover
                pass

    def clear(self) -> None:
        with self._lock:
            self._local.clear()


CACHE = TTLCache()


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
class RateLimiter:
    """Simple sliding-window limiter, per provider."""

    def __init__(self, max_calls: int, per_seconds: float) -> None:
        self.max_calls = max_calls
        self.per_seconds = per_seconds
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()

    def acquire(self, block: bool = True) -> bool:
        while True:
            with self._lock:
                now = time.monotonic()
                while self._calls and now - self._calls[0] > self.per_seconds:
                    self._calls.popleft()
                if len(self._calls) < self.max_calls:
                    self._calls.append(now)
                    return True
                wait = self.per_seconds - (now - self._calls[0]) + 0.01
            if not block:
                return False
            time.sleep(min(wait, 5.0))


_LIMITERS: dict[str, RateLimiter] = {}
_LIMITER_LOCK = threading.Lock()

# Conservative published/observed limits for the free tiers we support.
_DEFAULT_LIMITS = {
    "yfinance": (60, 60.0),
    "alpaca": (190, 60.0),
    "fred": (100, 60.0),
    "fixture": (100_000, 1.0),
}


def limiter_for(provider: str) -> RateLimiter:
    with _LIMITER_LOCK:
        lim = _LIMITERS.get(provider)
        if lim is None:
            calls, window = _DEFAULT_LIMITS.get(provider, (60, 60.0))
            lim = RateLimiter(calls, window)
            _LIMITERS[provider] = lim
        return lim


# ---------------------------------------------------------------------------
# Retry policy
# ---------------------------------------------------------------------------
@dataclass(slots=True)
class CallOutcome:
    ok: bool
    attempts: int
    latency_ms: int
    rate_limited: bool
    error: str | None = None
    status_code: int | None = None


def call_with_policy(
    provider: str,
    endpoint: str,
    fn: Callable[[], T],
    *,
    symbol: str | None = None,
    max_retries: int | None = None,
    log_fetch: bool = True,
) -> tuple[T | None, CallOutcome]:
    """Invoke ``fn`` under rate limiting with exponential backoff.

    Returns ``(result, outcome)``. Non-retryable failures return ``(None, outcome)``
    with ``ok=False``; the caller decides whether to fall back or surface the error.
    """
    settings = get_settings()
    retries = settings.provider_max_retries if max_retries is None else max_retries
    lim = limiter_for(provider)
    started = time.monotonic()
    attempts = 0
    rate_limited = False
    last_error: str | None = None
    status: int | None = None

    while attempts <= retries:
        attempts += 1
        lim.acquire()
        try:
            result = fn()
            outcome = CallOutcome(
                ok=True,
                attempts=attempts,
                latency_ms=int((time.monotonic() - started) * 1000),
                rate_limited=rate_limited,
            )
            if log_fetch:
                _record_fetch(provider, endpoint, symbol, outcome, _size_of(result))
            return result, outcome
        except ProviderNotConfigured as exc:
            last_error, status = str(exc), exc.status_code
            break  # never retry a configuration error
        except ProviderRateLimited as exc:
            rate_limited = True
            last_error, status = str(exc), 429
            delay = exc.retry_after or min(2.0 ** attempts, 30.0)
            time.sleep(delay)
        except ProviderError as exc:
            last_error, status = str(exc), exc.status_code
            time.sleep(min(0.5 * (2 ** (attempts - 1)), 8.0))
        except Exception as exc:  # unexpected — treat as transient once
            last_error = f"{type(exc).__name__}: {exc}"
            time.sleep(min(0.5 * (2 ** (attempts - 1)), 8.0))

    outcome = CallOutcome(
        ok=False,
        attempts=attempts,
        latency_ms=int((time.monotonic() - started) * 1000),
        rate_limited=rate_limited,
        error=last_error,
        status_code=status,
    )
    log.warning(
        "provider_call_failed",
        provider=provider,
        endpoint=endpoint,
        symbol=symbol,
        attempts=attempts,
        error=last_error,
    )
    if log_fetch:
        _record_fetch(provider, endpoint, symbol, outcome, 0)
    return None, outcome


def _size_of(result: Any) -> int:
    try:
        return len(result)  # type: ignore[arg-type]
    except Exception:
        return 1


# Provider calls usually happen *inside* an open transaction (ingest, the
# autonomous loop). Opening a second connection to log the fetch would deadlock
# on SQLite and waste a connection on PostgreSQL, so rows are buffered here and
# flushed by the caller's own session via :func:`flush_fetch_logs`.
_FETCH_BUFFER: deque[dict[str, Any]] = deque(maxlen=5000)
_BUFFER_LOCK = threading.Lock()


def _record_fetch(
    provider: str, endpoint: str, symbol: str | None, outcome: CallOutcome, records: int
) -> None:
    from aegisquant.utils.timeutil import utcnow

    with _BUFFER_LOCK:
        _FETCH_BUFFER.append(
            {
                "at": utcnow(),
                "provider": provider,
                "endpoint": endpoint,
                "symbol": symbol,
                "ok": outcome.ok,
                "status_code": outcome.status_code,
                "latency_ms": outcome.latency_ms,
                "records": records,
                "attempts": outcome.attempts,
                "rate_limited": outcome.rate_limited,
                "error": outcome.error,
            }
        )


def flush_fetch_logs(session: Any) -> int:
    """Write buffered provider-fetch rows using an existing session."""
    from aegisquant.db.models import ProviderFetchLog

    with _BUFFER_LOCK:
        rows = list(_FETCH_BUFFER)
        _FETCH_BUFFER.clear()
    if not rows:
        return 0
    try:
        session.add_all(ProviderFetchLog(**r) for r in rows)
        session.flush()
    except Exception as exc:  # pragma: no cover - observability must not break ingest
        log.debug("fetch_log_flush_failed", error=str(exc), rows=len(rows))
        return 0
    return len(rows)


def pending_fetch_log_count() -> int:
    with _BUFFER_LOCK:
        return len(_FETCH_BUFFER)
