"""FastAPI application factory."""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.exc import SQLAlchemyError

from aegisquant import __version__
from aegisquant.api.routers import admin, auth, dashboard, execution, journal, research
from aegisquant.api.security import get_rate_limiter
from aegisquant.config import get_settings
from aegisquant.db.session import session_scope
from aegisquant.logging_setup import configure_logging, get_logger

log = get_logger(__name__)

#: Paths exempt from rate limiting so health checks never get throttled.
_UNLIMITED = {"/api/health", "/api/ready", "/api/metrics"}


@asynccontextmanager
async def lifespan(app: FastAPI):  # pragma: no cover - startup path
    configure_logging()
    settings = get_settings()
    log.info(
        "api_starting",
        mode=settings.mode.value,
        broker=settings.broker,
        price_provider=settings.price_provider,
        synthetic_data=settings.price_provider == "fixture",
        version=__version__,
    )
    if settings.price_provider == "fixture":
        log.warning(
            "synthetic_data_active",
            note="the platform is serving SIMULATED market data; nothing shown is real history",
        )
    yield
    log.info("api_stopping")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="AegisQuant",
        version=__version__,
        description=(
            "Autonomous, auditable equities research and execution platform. "
            "Backtested and simulated results are never presented as guaranteed future "
            "performance, and live trading requires explicit human authorization."
        ),
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["content-type", "x-csrf-token", "authorization"],
    )

    # -- request context, rate limiting, security headers -------------------
    @app.middleware("http")
    async def request_middleware(request: Request, call_next: Any) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        structlog.contextvars.bind_contextvars(request_id=request_id, path=request.url.path)
        started = time.monotonic()

        if request.url.path not in _UNLIMITED:
            identity = request.client.host if request.client else "unknown"
            if not get_rate_limiter().check(identity):
                structlog.contextvars.clear_contextvars()
                return JSONResponse(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    content={"detail": "Rate limit exceeded. Slow down and retry."},
                    headers={"retry-after": "10", "x-request-id": request_id},
                )
        try:
            response = await call_next(request)
        finally:
            duration_ms = int((time.monotonic() - started) * 1000)

        response.headers["x-request-id"] = request_id
        response.headers["x-frame-options"] = "DENY"
        response.headers["x-content-type-options"] = "nosniff"
        response.headers["referrer-policy"] = "no-referrer"
        response.headers["content-security-policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
        )
        response.headers["permissions-policy"] = "geolocation=(), microphone=(), camera=()"
        if request.method != "GET":
            log.info(
                "request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=duration_ms,
            )
        structlog.contextvars.clear_contextvars()
        return response

    # -- error handling: never leak internals ------------------------------
    @app.exception_handler(RequestValidationError)
    async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": "Request validation failed",
                "errors": [
                    {"field": ".".join(str(p) for p in e.get("loc", [])), "message": e.get("msg")}
                    for e in exc.errors()[:10]
                ],
            },
        )

    @app.exception_handler(SQLAlchemyError)
    async def db_handler(_: Request, exc: SQLAlchemyError) -> JSONResponse:
        log.error("database_error", error=str(exc))
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": "A database error occurred. The request was not applied."},
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An internal error occurred. The request was not applied."},
        )

    # -- routers ------------------------------------------------------------
    app.include_router(auth.router, prefix="/api")
    app.include_router(dashboard.router, prefix="/api")
    app.include_router(research.router, prefix="/api")
    app.include_router(execution.router, prefix="/api")
    app.include_router(journal.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")

    # -- health / readiness / metrics --------------------------------------
    @app.get("/api/health", tags=["ops"])
    def health() -> dict[str, Any]:
        """Liveness: is the process up? Never touches external services."""
        return {
            "status": "ok",
            "version": __version__,
            "mode": get_settings().mode.value,
        }

    @app.get("/api/ready", tags=["ops"])
    def ready(response: Response) -> dict[str, Any]:
        """Readiness: database, providers and broker all usable."""
        from aegisquant.data.registry import provider_health
        from aegisquant.execution.broker.factory import get_broker

        checks: dict[str, Any] = {}
        try:
            with session_scope() as session:
                session.execute(__import__("sqlalchemy").text("SELECT 1"))
            checks["database"] = {"ok": True}
        except Exception as exc:
            checks["database"] = {"ok": False, "error": str(exc)[:200]}
        checks["providers"] = provider_health()
        try:
            checks["broker"] = get_broker().health()
        except Exception as exc:
            checks["broker"] = {"ok": False, "error": str(exc)[:200]}

        ready_now = bool(
            checks["database"].get("ok") and checks["providers"].get("all_ok") and checks["broker"].get("ok")
        )
        if not ready_now:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"ready": ready_now, "checks": checks}

    @app.get("/api/metrics", response_class=PlainTextResponse, tags=["ops"])
    def metrics() -> str:
        """Prometheus exposition of the operational metrics."""
        from aegisquant.ops.alerts import collect_metrics, prometheus_text

        with session_scope() as session:
            return prometheus_text(collect_metrics(session))

    return app


app = create_app()
