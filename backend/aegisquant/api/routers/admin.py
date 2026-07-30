"""Settings, risk configuration, promotion gate, live-mode gate and loop control."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.api.security import (
    CurrentUser,
    admin_mutating,
    mutating,
    record_audit,
    require_viewer,
)
from aegisquant.config import RiskLimits, get_settings
from aegisquant.data.registry import provider_health
from aegisquant.db import enums as E
from aegisquant.db.models import LiveAuthorization, PromotionRecord, RiskConfig
from aegisquant.db.models import Strategy as StrategyRow
from aegisquant.db.repo import get_active_risk_config, get_system_state
from aegisquant.db.session import get_session, session_scope
from aegisquant.governance import live_gate, promotion
from aegisquant.logging_setup import get_logger

log = get_logger(__name__)
router = APIRouter(tags=["admin"])


@router.get("/settings")
def settings_view(
    user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Non-secret configuration plus provider and broker status.

    No credential, secret or token is ever included in this response.
    """
    settings = get_settings()
    state = get_system_state(session)
    authorized, auth_reason = live_gate.is_live_authorized(session)
    risk_row = get_active_risk_config(session)
    return {
        "config": settings.public_dict(),
        "providers": provider_health(),
        "credentials_configured": {
            # Booleans only — never the values themselves.
            "alpaca": bool(settings.alpaca_key_id and settings.alpaca_secret_key),
            "fred": bool(settings.fred_api_key),
            "anthropic": bool(settings.anthropic_api_key),
        },
        "trading_schedule": {
            "loop_enabled": settings.loop_enabled,
            "loop_interval_seconds": settings.loop_interval_seconds,
            "regular_hours_only": True,
            "timezone": settings.timezone,
        },
        "risk_config": {
            "version": risk_row.version if risk_row else 0,
            "source": "database" if risk_row else "environment defaults",
            "updated_by": risk_row.updated_by if risk_row else None,
            "note": risk_row.note if risk_row else None,
            "limits": {k: str(v) for k, v in (risk_row.limits if risk_row else settings.risk.model_dump()).items()},
        },
        "live_controls": {
            "mode": settings.mode.value,
            "env_flag_enabled": settings.live_trading_enabled,
            "authorized": authorized,
            "authorization_reason": auth_reason,
            "max_allocation_usd": str(settings.live_max_allocation_usd),
            "requires_promotion_gate": settings.live_require_promotion_gate,
        },
        "system_state": {
            "kill_switch_engaged": state.kill_switch_engaged,
            "read_only": state.read_only,
            "risk_state": state.risk_state.value,
            "last_loop_at": state.last_loop_at.isoformat() if state.last_loop_at else None,
            "last_reconcile_at": (state.last_reconcile_at.isoformat() if state.last_reconcile_at else None),
        },
        "deferred_features": [
            "options, futures and cryptocurrency (interfaces exist, trading disabled)",
            "margin borrowing and leveraged ETFs",
            "unrestricted short selling",
            "defensive index hedging",
            "tax-lot accounting and wash-sale tracking",
        ],
    }


class RiskConfigUpdate(BaseModel):
    limits: dict[str, Any]
    note: str = Field(min_length=3, max_length=500)


@router.post("/settings/risk")
def update_risk_config(
    payload: RiskConfigUpdate,
    request: Request,
    user: CurrentUser = Depends(admin_mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Replace the active risk configuration. Admin only, fully validated.

    The submitted limits are validated through :class:`RiskLimits`, so an invalid
    or dangerous combination (for example a Kelly fraction above 0.5, or
    out-of-order drawdown stages) is rejected rather than stored.
    """
    try:
        validated = RiskLimits(**payload.limits)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid risk configuration: {exc}",
        ) from exc

    current = get_active_risk_config(session)
    if current is not None:
        current.is_active = False
    row = RiskConfig(
        version=(current.version + 1) if current else 1,
        is_active=True,
        limits={k: str(v) for k, v in validated.model_dump().items()},
        updated_by=user.email,
        note=payload.note,
    )
    session.add(row)
    session.flush()
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="risk_config_updated",
        target=f"risk_config:{row.version}",
        ip=request.client.host if request.client else None,
        detail={"note": payload.note, "version": row.version},
    )
    log.warning("risk_config_updated", version=row.version, by=user.email)
    return {"version": row.version, "limits": row.limits, "note": row.note}


@router.get("/settings/risk/history")
def risk_config_history(
    user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    rows = session.scalars(select(RiskConfig).order_by(RiskConfig.version.desc()).limit(50))
    return [
        {
            "version": r.version,
            "is_active": r.is_active,
            "updated_by": r.updated_by,
            "note": r.note,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "limits": r.limits,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Promotion gate
# ---------------------------------------------------------------------------
@router.get("/promotion")
def promotion_status(
    user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)
) -> dict[str, Any]:
    return {
        "thresholds": {k: str(v) for k, v in get_settings().promotion.model_dump().items()},
        "strategies": promotion.evaluate_all(session),
        "history": [
            {
                "at": r.at.isoformat(),
                "strategy_key": r.strategy_key,
                "from_status": r.from_status,
                "to_status": r.to_status,
                "passed": r.passed,
                "requested_by": r.requested_by,
                "approved_by": r.approved_by,
                "note": r.note,
                "blocking": (r.checks or {}).get("blocking", []),
            }
            for r in session.scalars(select(PromotionRecord).order_by(PromotionRecord.at.desc()).limit(50))
        ],
    }


class PromotionRequest(BaseModel):
    strategy_key: str
    note: str = Field(default="", max_length=500)
    force: bool = Field(
        default=False,
        description="Record a deliberate human override of failed checks (audited forever)",
    )


@router.post("/promotion")
def promote_strategy(
    payload: PromotionRequest,
    request: Request,
    user: CurrentUser = Depends(admin_mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    result, record = promotion.promote(
        session,
        payload.strategy_key,
        requested_by=user.email,
        approved_by=user.email,
        note=payload.note,
        force=payload.force,
    )
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="strategy_promotion",
        target=payload.strategy_key,
        ip=request.client.host if request.client else None,
        detail={
            "passed": result.passed,
            "force": payload.force,
            "to": result.to_status.value if result.to_status else None,
        },
    )
    return {"result": result.as_dict(), "record_id": record.id}


# ---------------------------------------------------------------------------
# Live-mode gate
# ---------------------------------------------------------------------------
@router.get("/live/preflight")
def live_preflight(
    user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)
) -> dict[str, Any]:
    """Show exactly what stands between the system and live trading."""
    broker = None
    try:
        from aegisquant.execution.broker.factory import get_broker

        broker = get_broker()
    except Exception as exc:
        log.info("live_preflight_no_broker", error=str(exc))
    result = live_gate.preflight(session, broker)
    authorized, reason = live_gate.is_live_authorized(session)
    return {
        **result.as_dict(),
        "currently_authorized": authorized,
        "authorization_reason": reason,
        "required_steps": [
            "set AEGIS_LIVE_TRADING_ENABLED=true in the server environment",
            "set AEGIS_MODE=LIVE and restart the backend",
            "configure a non-mock broker with live credentials",
            "have at least one strategy pass the promotion gate",
            "confirm in the UI and re-enter the confirmation phrase",
            "acknowledge the displayed account identifier",
        ],
        "warning": (
            "Live trading risks real capital. The platform will not enable it from the user "
            "interface alone, and it never falls back from paper to live."
        ),
    }


class LiveActivationRequest(BaseModel):
    confirmation_phrase: str = Field(min_length=1, max_length=200)
    ui_confirmed: bool
    acknowledged_account_identifier: str | None = None


@router.post("/live/enable")
def enable_live(
    payload: LiveActivationRequest,
    request: Request,
    user: CurrentUser = Depends(admin_mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    broker = None
    try:
        from aegisquant.execution.broker.factory import get_broker

        broker = get_broker()
    except Exception as exc:
        log.warning("live_enable_no_broker", error=str(exc))
    granted, result, record = live_gate.request_live_activation(
        session,
        requested_by=user.email,
        role=user.role,
        confirmation_phrase=payload.confirmation_phrase,
        ui_confirmed=payload.ui_confirmed,
        acknowledged_account_identifier=payload.acknowledged_account_identifier,
        broker=broker,
        ip=request.client.host if request.client else None,
    )
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="live_enable_attempt",
        ip=request.client.host if request.client else None,
        status_code=200 if granted else 403,
        detail={"granted": granted, "failures": result.failures[:5]},
    )
    if not granted:
        # 409: the request was understood but the system is not in a state to allow it.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Live trading was not enabled. Unmet requirements are listed below.",
                "failures": result.failures,
                "checks": [c.as_dict() for c in result.checks],
                "authorization_id": record.id,
            },
        )
    return {"granted": True, "authorization": result.as_dict(), "authorization_id": record.id}


class LiveDisableRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/live/disable")
def disable_live(
    payload: LiveDisableRequest,
    request: Request,
    user: CurrentUser = Depends(admin_mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Revoke live authorization. Always allowed — de-risking is never gated."""
    record = live_gate.revoke_live_activation(
        session,
        requested_by=user.email,
        reason=payload.reason,
        ip=request.client.host if request.client else None,
    )
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="live_disabled",
        ip=request.client.host if request.client else None,
        detail={"reason": payload.reason},
    )
    return {"disabled": True, "authorization_id": record.id}


@router.get("/live/history")
def live_history(
    user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    rows = session.scalars(select(LiveAuthorization).order_by(LiveAuthorization.at.desc()).limit(100))
    return [
        {
            "id": r.id,
            "at": r.at.isoformat(),
            "requested_by": r.requested_by,
            "action": r.action,
            "granted": r.granted,
            "account_identifier": r.account_identifier,
            "broker": r.broker,
            "max_allocation_usd": str(r.max_allocation_usd) if r.max_allocation_usd else None,
            "phrase_matched": r.phrase_matched,
            "env_flag_enabled": r.env_flag_enabled,
            "failure_reasons": r.failure_reasons,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            "revoked_at": r.revoked_at.isoformat() if r.revoked_at else None,
        }
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Loop control
# ---------------------------------------------------------------------------
def _loop_job(trigger: str) -> None:
    from aegisquant.loop.autonomous import run_cycle

    with session_scope() as session:
        run_cycle(session, trigger=trigger)


@router.post("/loop/run", status_code=status.HTTP_202_ACCEPTED)
def run_loop_now(
    background: BackgroundTasks,
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Trigger one autonomous cycle immediately."""
    state = get_system_state(session)
    if state.kill_switch_engaged:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The kill switch is engaged; the loop will not run",
        )
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="loop_triggered",
        ip=request.client.host if request.client else None,
    )
    background.add_task(_loop_job, f"manual:{user.email}")
    return {
        "status": "queued",
        "detail": "one cycle has been queued; poll /api/loops for the result",
    }


@router.get("/strategies/{key}/toggle")
def strategy_toggle_info(
    key: str, user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)
) -> dict[str, Any]:
    row = session.scalar(select(StrategyRow).where(StrategyRow.key == key))
    if row is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    return {
        "key": row.key,
        "status": row.status.value,
        "enabled": row.enabled,
        "paused_reason": row.paused_reason,
    }


class StrategyToggle(BaseModel):
    enabled: bool
    reason: str = Field(min_length=3, max_length=500)


@router.post("/strategies/{key}/toggle")
def toggle_strategy(
    key: str,
    payload: StrategyToggle,
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = session.scalar(select(StrategyRow).where(StrategyRow.key == key))
    if row is None:
        raise HTTPException(status_code=404, detail="Strategy not found")
    row.enabled = payload.enabled
    if not payload.enabled:
        row.status = E.StrategyStatus.PAUSED
        row.paused_reason = f"{payload.reason} (by {user.email})"
    else:
        row.paused_reason = None
        if row.status is E.StrategyStatus.PAUSED:
            row.status = E.StrategyStatus.PAPER
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="strategy_enabled" if payload.enabled else "strategy_paused",
        target=key,
        ip=request.client.host if request.client else None,
        detail={"reason": payload.reason},
    )
    return {"key": row.key, "enabled": row.enabled, "status": row.status.value}
