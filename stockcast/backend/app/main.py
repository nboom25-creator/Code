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


@app.get("/api/diagnostics")
async def diagnostics(symbol: str = "AAPL") -> dict:
    """Live self-test: can this server actually reach the configured provider?

    Attempts a real quote through the configured (non-demo) provider and reports
    whether the network path works. This is the fastest way to distinguish a
    misconfiguration from an environment network policy that blocks the host.
    """
    import asyncio

    from app.providers.base import ProviderError, ProviderNotConfigured

    result: dict = {"provider": settings.provider, "symbol": symbol.upper()}
    try:
        provider = build_provider()
    except ProviderNotConfigured as exc:
        return {**result, "reachable": None, "configured": False,
                "detail": exc.message, "setup_hint": exc.setup_hint}
    if provider.is_demo:
        return {**result, "reachable": None, "configured": True, "is_demo": True,
                "detail": "Demo provider selected — no live network call is made."}
    try:
        quote = await asyncio.wait_for(provider.get_quote(symbol), timeout=12)
        return {
            **result, "reachable": True, "configured": True, "is_demo": False,
            "live_price": quote.price, "as_of": quote.provenance.as_of.isoformat(),
            "source": quote.provenance.source, "delay_note": quote.provenance.delay_note,
            "detail": "Provider reachable — live data is flowing.",
        }
    except asyncio.TimeoutError:
        return {
            **result, "reachable": False, "configured": True, "is_demo": False,
            "error_code": "timeout", "likely_network_policy": True,
            "detail": "Timed out contacting the provider (host likely blocked).",
            "hint": "If running on Claude Code for the web, allow the provider host in your "
            "environment's network policy. See README → 'Enabling live data'.",
        }
    except ProviderError as exc:
        blocked = getattr(exc, "code", "") in ("network_error", "upstream_error")
        return {
            **result, "reachable": False, "configured": True, "is_demo": False,
            "error_code": getattr(exc, "code", "provider_error"),
            "detail": str(exc),
            "likely_network_policy": blocked,
            "hint": (
                "The host appears blocked. If running on Claude Code for the web, allow the "
                "provider host in your environment's network policy; if running locally, check "
                "your firewall/proxy. See README → 'Enabling live data'."
                if blocked else getattr(exc, "setup_hint", None)
            ),
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
