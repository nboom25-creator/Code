"""PartForge AI backend application."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import api_router
from .config import get_settings
from .db import SessionLocal, init_db
from .services.materials_seed import seed_materials
from .version import APP_NAME, APP_VERSION
from .workers.queue import job_queue

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
)
logger = logging.getLogger("partforge")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    db = SessionLocal()
    try:
        added = seed_materials(db)
        if added:
            logger.info("seeded %d built-in materials", added)
    finally:
        db.close()
    job_queue.recover_interrupted()
    job_queue.start()
    logger.info("%s %s ready (FEA available: %s)", APP_NAME, APP_VERSION,
                settings.ccx_available and settings.gmsh_available)
    yield
    job_queue.shutdown()


app = FastAPI(
    title=f"{APP_NAME} API",
    version=APP_VERSION,
    description=(
        "STL analysis, preliminary FEA and design-variant generation. "
        "Geometry observations come from the mesh; engineering recommendations depend on "
        "user-entered assumptions; FEA results are preliminary linear statics — not a certified "
        "validation."),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
def health():
    return {"status": "ok", "app": APP_NAME, "version": APP_VERSION}
