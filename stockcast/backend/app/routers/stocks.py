"""Stock analysis, search, quote and random-ticker endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app import service
from app.providers.base import ProviderError, ProviderNotConfigured, RateLimited, SymbolNotFound
from app.schemas import (
    AnalysisResponse,
    BacktestRequest,
    BacktestResult,
    Quote,
    SearchResult,
)

router = APIRouter()


def _handle(exc: Exception) -> HTTPException:
    if isinstance(exc, SymbolNotFound):
        return HTTPException(status_code=404, detail={"code": "symbol_not_found", "error": str(exc)})
    if isinstance(exc, RateLimited):
        return HTTPException(status_code=429, detail={"code": "rate_limited", "error": str(exc)})
    if isinstance(exc, ProviderNotConfigured):
        return HTTPException(
            status_code=503,
            detail={"code": "provider_not_configured", "error": str(exc), "setup_hint": exc.setup_hint},
        )
    if isinstance(exc, ProviderError):
        code = getattr(exc, "code", "provider_error")
        status = 400 if code in ("invalid_ticker", "insufficient_data") else 502
        return HTTPException(status_code=status, detail={"code": code, "error": str(exc)})
    return HTTPException(status_code=500, detail={"code": "internal_error", "error": str(exc)})


@router.get("/search", response_model=list[SearchResult])
async def search(q: str = Query(..., min_length=1, max_length=40)):
    try:
        return await service.search_symbols(q)
    except Exception as exc:  # noqa: BLE001
        raise _handle(exc)


@router.get("/quote/{ticker}", response_model=Quote)
async def quote(ticker: str):
    try:
        return await service.get_quote(ticker)
    except Exception as exc:  # noqa: BLE001
        raise _handle(exc)


@router.get("/random", response_model=dict)
async def random_stock():
    return {"ticker": service.random_ticker()}


@router.get("/analyze/{ticker}", response_model=AnalysisResponse)
async def analyze(ticker: str, provider: str | None = Query(None)):
    try:
        return await service.analyze(ticker, provider)
    except Exception as exc:  # noqa: BLE001
        raise _handle(exc)


@router.post("/backtest", response_model=BacktestResult)
async def backtest(req: BacktestRequest):
    try:
        return await service.backtest(req)
    except Exception as exc:  # noqa: BLE001
        raise _handle(exc)
