"""In-process background job queue.

A thread pool executes jobs; job state lives in the database so the API (and
SSE stream) can report progress. If Redis/an external queue is configured in
the future it can implement the same submit/cancel interface; the thread pool
is the guaranteed synchronous-friendly fallback and the default.

Recovery: on startup any job left in queued/running state is marked failed
with an explanatory error (the process died mid-job).
"""
from __future__ import annotations

import logging
import threading
import traceback
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from ..config import get_settings
from ..db import SessionLocal
from ..models import SimulationJob

logger = logging.getLogger("partforge.jobs")


class JobCancelled(Exception):
    pass


class JobQueue:
    def __init__(self) -> None:
        self._executor: ThreadPoolExecutor | None = None
        self._cancel_events: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(
                max_workers=get_settings().worker_threads, thread_name_prefix="pf-job")

    def shutdown(self) -> None:
        if self._executor:
            self._executor.shutdown(wait=False, cancel_futures=True)
            self._executor = None

    def recover_interrupted(self) -> None:
        db = SessionLocal()
        try:
            stuck = db.query(SimulationJob).filter(
                SimulationJob.status.in_(["pending", "running"])).all()
            for job in stuck:
                job.status = "failed"
                job.error = "Interrupted by application restart; please retry."
                job.finished_at = datetime.now(UTC)
            db.commit()
            if stuck:
                logger.warning("marked %d interrupted jobs as failed", len(stuck))
        finally:
            db.close()

    def submit(self, job_id: str, fn: Callable[[str, threading.Event], None]) -> None:
        self.start()
        ev = threading.Event()
        with self._lock:
            self._cancel_events[job_id] = ev
        assert self._executor is not None
        self._executor.submit(self._run, job_id, fn, ev)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            ev = self._cancel_events.get(job_id)
        if ev:
            ev.set()
            return True
        return False

    def _run(self, job_id: str, fn: Callable[[str, threading.Event], None], ev: threading.Event) -> None:
        db = SessionLocal()
        try:
            job = db.get(SimulationJob, job_id)
            if job is None or job.cancelled:
                return
            job.status = "running"
            job.started_at = datetime.now(UTC)
            db.commit()
        finally:
            db.close()
        try:
            fn(job_id, ev)
            self._finish(job_id, "succeeded", None)
        except JobCancelled:
            self._finish(job_id, "cancelled", "Cancelled by user.")
        except Exception as exc:
            logger.error("job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
            self._finish(job_id, "failed", str(exc))
        finally:
            with self._lock:
                self._cancel_events.pop(job_id, None)

    def _finish(self, job_id: str, status: str, error: str | None) -> None:
        db = SessionLocal()
        try:
            job = db.get(SimulationJob, job_id)
            if job is None:
                return
            if job.status == "running":
                job.status = status
                job.error = error
                if status == "succeeded":
                    job.progress = 1.0
            job.finished_at = datetime.now(UTC)
            db.commit()
        finally:
            db.close()


job_queue = JobQueue()


def progress_updater(job_id: str, cancel: threading.Event):
    """Returns progress(frac, msg) that persists updates and honors cancellation."""
    def progress(frac: float, msg: str) -> None:
        if cancel.is_set():
            raise JobCancelled()
        db = SessionLocal()
        try:
            job = db.get(SimulationJob, job_id)
            if job is not None:
                job.progress = float(min(max(frac, 0.0), 1.0))
                job.message = msg
                db.commit()
        finally:
            db.close()
    return progress
