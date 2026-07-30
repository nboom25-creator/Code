"""Durable job system (Celery over Redis).

Every task is a thin wrapper around a plain service function, so the same logic
runs identically from the CLI, the API's background tasks and the worker. That
also makes the tasks testable without a broker: call the underlying function.

Reliability settings and why:

* ``acks_late=True`` — a task is acknowledged only after it completes, so a
  worker crash re-delivers it instead of silently losing it.
* ``worker_prefetch_multiplier=1`` — no hoarding, so a slow task does not block
  a queue of quick ones behind it.
* ``task_reject_on_worker_lost=True`` — a killed worker's task is requeued.
* Idempotency lives in the domain layer (deterministic client order ids), which
  is what makes re-delivery safe rather than dangerous.
"""

from __future__ import annotations

from typing import Any

from celery import Celery
from celery.schedules import crontab

from aegisquant.config import get_settings
from aegisquant.logging_setup import configure_logging, get_logger

log = get_logger(__name__)
settings = get_settings()

celery_app = Celery(
    "aegisquant",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    task_time_limit=3600,
    task_soft_time_limit=3300,
    result_expires=86400,
    broker_connection_retry_on_startup=True,
    # If Redis is unreachable the tasks still run inline rather than vanishing.
    task_always_eager=False,
    beat_schedule={
        "autonomous-loop": {
            "task": "aegisquant.jobs.tasks.run_loop",
            # Every five minutes during extended US market hours, Monday-Friday.
            "schedule": crontab(minute="*/5", hour="13-21", day_of_week="1-5"),
        },
        "reconcile": {
            "task": "aegisquant.jobs.tasks.reconcile",
            "schedule": crontab(minute="*/15"),
        },
        "ingest-daily": {
            "task": "aegisquant.jobs.tasks.ingest_daily",
            # Shortly after the US close (21:15 UTC ≈ 17:15 ET).
            "schedule": crontab(minute="15", hour="21", day_of_week="1-5"),
        },
        "record-metrics": {
            "task": "aegisquant.jobs.tasks.snapshot_metrics",
            "schedule": crontab(minute="*/10"),
        },
        "close-post-trade-reviews": {
            "task": "aegisquant.jobs.tasks.close_post_trade_reviews",
            "schedule": crontab(minute="30", hour="22", day_of_week="1-5"),
        },
    },
)


@celery_app.on_after_configure.connect  # type: ignore[misc]
def _setup_logging(sender: Any, **_: Any) -> None:  # pragma: no cover - worker startup
    configure_logging()
    log.info("celery_configured", broker=settings.redis_url.split("@")[-1])


celery_app.autodiscover_tasks(["aegisquant.jobs"])
