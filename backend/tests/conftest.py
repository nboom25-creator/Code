"""Test configuration: isolated data dir + SQLite DB per test session."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="partforge_test_")
os.environ.setdefault("PARTFORGE_DATA_DIR", str(Path(_tmp) / "data"))
os.environ.setdefault("PARTFORGE_DATABASE_URL", f"sqlite:///{_tmp}/test.sqlite3")
os.environ.setdefault("PARTFORGE_WORKER_THREADS", "2")

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def db_session():
    from app.db import SessionLocal, init_db
    init_db()
    s = SessionLocal()
    yield s
    s.close()


def wait_for_job(client, job_id: str, timeout_s: int = 300) -> dict:
    import time
    for _ in range(timeout_s * 2):
        j = client.get(f"/api/v1/jobs/{job_id}").json()
        if j["status"] in ("succeeded", "failed", "cancelled"):
            return j
        time.sleep(0.5)
    raise TimeoutError(f"job {job_id} did not finish in {timeout_s}s: {j}")


def fea_available() -> bool:
    from app.config import get_settings
    s = get_settings()
    return s.ccx_available and s.gmsh_available
