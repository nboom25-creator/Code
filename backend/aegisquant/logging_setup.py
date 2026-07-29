"""Structured logging with mandatory secret redaction."""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

from aegisquant.config import get_settings

_REDACTED = "***REDACTED***"
_SENSITIVE_KEYS = {
    "password",
    "secret",
    "secret_key",
    "token",
    "access_token",
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "set-cookie",
    "alpaca_key_id",
    "alpaca_secret_key",
    "confirmation_phrase",
    "csrf",
}


def _redact(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """Strip secret-looking keys and any literal secret value from the event."""
    try:
        secrets = get_settings().secret_values()
    except Exception:  # settings may be invalid while logging the failure
        secrets = []

    def scrub(value: Any) -> Any:
        if isinstance(value, str):
            for s in secrets:
                if s in value:
                    value = value.replace(s, _REDACTED)
            return value
        if isinstance(value, dict):
            return {k: (_REDACTED if k.lower() in _SENSITIVE_KEYS else scrub(v)) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return type(value)(scrub(v) for v in value)
        return value

    for key in list(event_dict):
        if key.lower() in _SENSITIVE_KEYS:
            event_dict[key] = _REDACTED
        else:
            event_dict[key] = scrub(event_dict[key])
    return event_dict


def configure_logging(json_output: bool | None = None) -> None:
    """Configure structlog + stdlib logging once, at process start."""
    settings = get_settings()
    if json_output is None:
        json_output = settings.env_name not in ("development", "test")

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=logging.DEBUG if settings.debug else logging.INFO,
        force=True,
    )
    for noisy in ("urllib3", "httpx", "httpcore", "yfinance", "peewee", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    renderer: Any = (
        structlog.processors.JSONRenderer()
        if json_output
        else structlog.dev.ConsoleRenderer(colors=False)
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            _redact,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.DEBUG if settings.debug else logging.INFO
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)  # type: ignore[return-value]
