"""Execution Monitor: orders, fills, reconciliation and emergency controls."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aegisquant.api.security import (
    CurrentUser,
    admin_mutating,
    mutating,
    record_audit,
    require_viewer,
)
from aegisquant.db import enums as E
from aegisquant.db.models import Fill, Order, Quarantine, ReconciliationRun
from aegisquant.db.repo import current_mode, get_system_state
from aegisquant.db.session import get_session
from aegisquant.execution.broker.factory import get_broker
from aegisquant.execution.oms import OrderManager
from aegisquant.logging_setup import get_logger
from aegisquant.ops.alerts import raise_alert
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)
router = APIRouter(tags=["execution"])


def _dec(v: Any) -> str | None:
    return None if v is None else str(v)


def _order_out(order: Order, *, with_events: bool = False) -> dict[str, Any]:
    payload = {
        "id": order.id,
        "client_order_id": order.client_order_id,
        "broker_order_id": order.broker_order_id,
        "decision_id": order.decision_id,
        "symbol": order.symbol,
        "side": order.side.value,
        "order_type": order.order_type.value,
        "time_in_force": order.time_in_force.value,
        "status": order.status.value,
        "quantity": str(order.quantity),
        "filled_quantity": str(order.filled_quantity),
        "limit_price": _dec(order.limit_price),
        "stop_price": _dec(order.stop_price),
        "avg_fill_price": _dec(order.avg_fill_price),
        "reference_price": _dec(order.reference_price),
        "expected_spread_bps": _dec(order.expected_spread_bps),
        "expected_slippage_bps": _dec(order.expected_slippage_bps),
        "expected_impact_bps": _dec(order.expected_impact_bps),
        "expected_total_cost_bps": _dec(order.expected_total_cost_bps),
        "realized_slippage_bps": _dec(order.realized_slippage_bps),
        "commission": str(order.commission),
        "strategy_key": order.strategy_key,
        "submitted_at": order.submitted_at.isoformat() if order.submitted_at else None,
        "acknowledged_at": order.acknowledged_at.isoformat() if order.acknowledged_at else None,
        "canceled_at": order.canceled_at.isoformat() if order.canceled_at else None,
        "reject_reason": order.reject_reason,
        "broker": order.broker,
        "submit_attempts": order.submit_attempts,
        "is_synthetic": order.is_synthetic,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }
    if with_events:
        payload["events"] = [
            {
                "at": e.at.isoformat(),
                "event_type": e.event_type,
                "from_status": e.from_status.value if e.from_status else None,
                "to_status": e.to_status.value if e.to_status else None,
                "quantity": _dec(e.quantity),
                "price": _dec(e.price),
                "message": e.message,
                "source": e.source,
            }
            for e in sorted(order.events, key=lambda x: x.at)
        ]
        payload["fills"] = [
            {
                "at": f.at.isoformat(),
                "quantity": str(f.quantity),
                "price": str(f.price),
                "commission": str(f.commission),
                "is_partial": f.is_partial,
                "slippage_bps": _dec(f.slippage_bps),
                "broker_fill_id": f.broker_fill_id,
            }
            for f in sorted(order.fills, key=lambda x: x.at)
        ]
    return payload


@router.get("/orders")
def list_orders(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(100, ge=1, le=500),
    status_filter: E.OrderStatus | None = Query(None, alias="status"),
    symbol: str | None = None,
    open_only: bool = False,
) -> dict[str, Any]:
    mode = current_mode()
    query = select(Order).where(Order.mode == mode)
    if status_filter:
        query = query.where(Order.status == status_filter)
    if open_only:
        query = query.where(Order.status.in_([s for s in E.OrderStatus if s.is_open]))
    if symbol:
        query = query.where(Order.symbol == symbol.upper())
    rows = list(session.scalars(query.order_by(Order.created_at.desc()).limit(limit)))

    counts = dict(
        session.execute(select(Order.status, func.count()).where(Order.mode == mode).group_by(Order.status)).all()
    )
    return {
        "mode": mode.value,
        "orders": [_order_out(o) for o in rows],
        "status_counts": {k.value: v for k, v in counts.items()},
    }


@router.get("/orders/{order_id}")
def order_detail(
    order_id: int,
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    order = session.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return _order_out(order, with_events=True)


@router.get("/fills")
def list_fills(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(200, ge=1, le=1000),
) -> dict[str, Any]:
    rows = list(session.scalars(select(Fill).order_by(Fill.at.desc()).limit(limit)))
    slippages = [float(f.slippage_bps) for f in rows if f.slippage_bps is not None]
    return {
        "fills": [
            {
                "at": f.at.isoformat(),
                "order_id": f.order_id,
                "symbol": f.symbol,
                "side": f.side.value,
                "quantity": str(f.quantity),
                "price": str(f.price),
                "commission": str(f.commission),
                "is_partial": f.is_partial,
                "slippage_bps": _dec(f.slippage_bps),
            }
            for f in rows
        ],
        "fill_quality": {
            "count": len(slippages),
            "mean_slippage_bps": round(sum(slippages) / len(slippages), 2) if slippages else None,
            "worst_slippage_bps": round(max(slippages), 2) if slippages else None,
            "best_slippage_bps": round(min(slippages), 2) if slippages else None,
        },
    }


@router.get("/reconciliation")
def reconciliation_history(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(25, ge=1, le=200),
) -> list[dict[str, Any]]:
    rows = session.scalars(select(ReconciliationRun).order_by(ReconciliationRun.at.desc()).limit(limit))
    return [
        {
            "id": r.id,
            "at": r.at.isoformat(),
            "status": r.status.value,
            "positions_checked": r.positions_checked,
            "orders_checked": r.orders_checked,
            "breaks": r.breaks,
            "auto_healed": r.auto_healed,
            "resolved": r.resolved,
            "duration_ms": r.duration_ms,
            "error": r.error,
        }
        for r in rows
    ]


@router.post("/reconciliation/run")
def run_reconciliation(
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        broker = get_broker()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Broker unavailable: {exc}") from exc
    run = OrderManager(session, broker).reconcile()
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="reconciliation_run",
        ip=request.client.host if request.client else None,
        detail={"status": run.status.value},
    )
    return {
        "id": run.id,
        "status": run.status.value,
        "breaks": run.breaks,
        "auto_healed": run.auto_healed,
        "resolved": run.resolved,
    }


# ---------------------------------------------------------------------------
# Emergency controls
# ---------------------------------------------------------------------------
class KillSwitchRequest(BaseModel):
    engage: bool
    reason: str = Field(min_length=3, max_length=500)


class QuarantineRequest(BaseModel):
    scope: str = Field(pattern="^(symbol|strategy)$")
    key: str = Field(min_length=1, max_length=60)
    reason: str = Field(min_length=3, max_length=500)
    active: bool = True


class FlattenRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    confirm: bool = Field(description="Must be true; flattening sells every position")


@router.post("/controls/kill-switch")
def kill_switch(
    payload: KillSwitchRequest,
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Engage or release the global kill switch.

    Engaging is immediate and blocks every order, including exits. Releasing is
    intentionally a separate, audited action.
    """
    state = get_system_state(session)
    state.kill_switch_engaged = payload.engage
    state.kill_switch_reason = payload.reason
    state.kill_switch_engaged_by = user.email if payload.engage else None
    state.kill_switch_engaged_at = utcnow() if payload.engage else None
    raise_alert(
        session,
        E.AlertKind.KILL_SWITCH,
        E.AlertSeverity.CRITICAL,
        f"Kill switch {'ENGAGED' if payload.engage else 'released'}",
        f"{payload.reason} (by {user.email})",
    )
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="kill_switch_engage" if payload.engage else "kill_switch_release",
        ip=request.client.host if request.client else None,
        detail={"reason": payload.reason},
    )
    return {"kill_switch_engaged": state.kill_switch_engaged, "reason": state.kill_switch_reason}


@router.post("/controls/read-only")
def read_only(
    payload: KillSwitchRequest,
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Enter or leave read-only emergency mode (no orders of any kind)."""
    state = get_system_state(session)
    state.read_only = payload.engage
    raise_alert(
        session,
        E.AlertKind.KILL_SWITCH,
        E.AlertSeverity.WARNING,
        f"Read-only mode {'enabled' if payload.engage else 'disabled'}",
        f"{payload.reason} (by {user.email})",
    )
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="read_only_toggle",
        ip=request.client.host if request.client else None,
        detail={"engage": payload.engage, "reason": payload.reason},
    )
    return {"read_only": state.read_only}


@router.post("/controls/cancel-all")
def cancel_all(
    payload: KillSwitchRequest,
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    try:
        broker = get_broker()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Broker unavailable: {exc}") from exc
    cancelled = OrderManager(session, broker).cancel_all(payload.reason)
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="cancel_all_orders",
        ip=request.client.host if request.client else None,
        detail={"cancelled": cancelled, "reason": payload.reason},
    )
    return {"cancelled": cancelled}


@router.post("/controls/flatten")
def flatten(
    payload: FlattenRequest,
    request: Request,
    user: CurrentUser = Depends(admin_mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Cancel every order and market-sell every position. Admin only."""
    if not payload.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Flattening requires explicit confirmation: it sells every open position",
        )
    try:
        broker = get_broker()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Broker unavailable: {exc}") from exc
    result = OrderManager(session, broker).flatten_positions(payload.reason)
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="flatten_positions",
        ip=request.client.host if request.client else None,
        detail={"reason": payload.reason, **{k: v for k, v in result.items() if k != "submitted"}},
    )
    return result


@router.get("/controls/quarantine")
def list_quarantines(
    user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    rows = session.scalars(select(Quarantine).order_by(Quarantine.created_at.desc()).limit(200))
    return [
        {
            "id": q.id,
            "scope": q.scope,
            "key": q.key,
            "reason": q.reason,
            "active": q.active,
            "engaged_by": q.engaged_by,
            "until": q.until.isoformat() if q.until else None,
            "released_at": q.released_at.isoformat() if q.released_at else None,
            "released_by": q.released_by,
            "created_at": q.created_at.isoformat() if q.created_at else None,
        }
        for q in rows
    ]


@router.post("/controls/quarantine")
def set_quarantine(
    payload: QuarantineRequest,
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Quarantine or release a symbol, or pause/resume a strategy."""
    key = payload.key.upper() if payload.scope == "symbol" else payload.key
    existing = session.scalar(
        select(Quarantine).where(Quarantine.scope == payload.scope, Quarantine.key == key, Quarantine.active.is_(True))
    )
    if payload.active:
        if existing is not None:
            existing.reason = payload.reason
            row = existing
        else:
            row = Quarantine(
                scope=payload.scope,
                key=key,
                reason=payload.reason,
                engaged_by=user.email,
                active=True,
            )
            session.add(row)
        if payload.scope == "strategy":
            from aegisquant.db.models import Strategy as StrategyRow

            strategy = session.scalar(select(StrategyRow).where(StrategyRow.key == key))
            if strategy:
                strategy.status = E.StrategyStatus.PAUSED
                strategy.enabled = False
                strategy.paused_reason = payload.reason
        raise_alert(
            session,
            E.AlertKind.STRATEGY_PAUSED if payload.scope == "strategy" else E.AlertKind.RISK_VIOLATION,
            E.AlertSeverity.WARNING,
            f"{payload.scope.title()} quarantined: {key}",
            f"{payload.reason} (by {user.email})",
        )
    else:
        if existing is None:
            raise HTTPException(status_code=404, detail="No active quarantine for that key")
        existing.active = False
        existing.released_at = utcnow()
        existing.released_by = user.email
        row = existing
        if payload.scope == "strategy":
            from aegisquant.db.models import Strategy as StrategyRow

            strategy = session.scalar(select(StrategyRow).where(StrategyRow.key == key))
            if strategy and strategy.status is E.StrategyStatus.PAUSED:
                strategy.status = E.StrategyStatus.PAPER
                strategy.enabled = True
                strategy.paused_reason = None
    session.flush()
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="quarantine_set" if payload.active else "quarantine_release",
        target=f"{payload.scope}:{key}",
        ip=request.client.host if request.client else None,
        detail={"reason": payload.reason},
    )
    return {"id": row.id, "scope": row.scope, "key": row.key, "active": row.active}


@router.post("/controls/recover")
def recover(
    payload: KillSwitchRequest,
    request: Request,
    user: CurrentUser = Depends(admin_mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Clear a trading halt and cooldown after a loss limit. Admin approval required."""
    state = get_system_state(session)
    if not (state.trading_halted_for_date or state.cooldown_until or state.recovery_requires_approval):
        return {"detail": "nothing to recover from", "risk_state": state.risk_state.value}
    state.trading_halted_for_date = None
    state.halt_reason = None
    state.cooldown_until = None
    state.cooldown_reason = None
    state.recovery_requires_approval = False
    state.risk_state = E.RiskState.WARNING  # never straight back to normal
    state.risk_state_reason = (
        f"recovery approved by {user.email}: {payload.reason}. Held in the warning state so "
        "position sizing stays reduced until the drawdown clears."
    )
    raise_alert(
        session,
        E.AlertKind.RISK_VIOLATION,
        E.AlertSeverity.WARNING,
        "Trading resumed after operator approval",
        state.risk_state_reason,
    )
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="recovery_approved",
        ip=request.client.host if request.client else None,
        detail={"reason": payload.reason},
    )
    return {"risk_state": state.risk_state.value, "reason": state.risk_state_reason}


@router.get("/broker/health")
def broker_health(user: CurrentUser = Depends(require_viewer)) -> dict[str, Any]:
    try:
        return get_broker().health()
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:300]}
