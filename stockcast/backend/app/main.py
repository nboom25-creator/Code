"""StockCast FastAPI application entry point.

Run: ``uvicorn app.main:app --reload --port 8000`` (from the backend/ directory).
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.providers.factory import build_provider
from app.routers import stocks

settings = get_settings()

app = FastAPI(
    title="StockCast API",
    version=__version__,
    description="Evidence-based stock-price forecasting research API. "
    "Research tool only — not financial advice.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks.router, prefix="/api")


@app.get("/api/health")
async def health() -> dict:
    """Report the active provider and whether it is a keyed/demo source."""
    active = settings.provider
    demo = False
    configured = True
    hint = None
    try:
        provider = build_provider()
        demo = provider.is_demo
        active = provider.name
    except Exception as exc:  # noqa: BLE001
        configured = False
        hint = getattr(exc, "setup_hint", None) or str(exc)
    return {
        "status": "ok",
        "version": __version__,
        "provider": settings.provider,
        "provider_name": active,
        "is_demo": demo,
        "configured": configured,
        "allow_demo_fallback": settings.allow_demo_fallback,
        "setup_hint": hint,
        "disclaimer": "Research tool only. Not financial advice.",
    }


@app.get("/api/meta")
async def meta() -> dict:
    """Static metadata for the frontend (horizons, chart ranges, disclaimer)."""
    from app.analysis.forecasting import HORIZONS
    from app.service import DISCLAIMER

    return {
        "horizons": [{"label": lbl, "days": d} for lbl, d in HORIZONS],
        "chart_ranges": ["1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"],
        "disclaimer": DISCLAIMER,
    }
