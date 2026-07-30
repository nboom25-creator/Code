"""Decision Journal: decisions, explanations, risk checks, outcomes and alerts."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aegisquant.api.security import CurrentUser, mutating, record_audit, require_viewer
from aegisquant.db import enums as E
from aegisquant.db.models import (
    Alert,
    AuditLog,
    DataQualityIssue,
    Decision,
    LoopRun,
    PostTradeReview,
)
from aegisquant.db.repo import current_mode
from aegisquant.db.session import get_session
from aegisquant.utils.timeutil import utcnow

router = APIRouter(tags=["journal"])


def _dec(v: Any) -> str | None:
    return None if v is None else str(v)


def _decision_out(decision: Decision, *, detail: bool = False) -> dict[str, Any]:
    payload = {
        "id": decision.id,
        "decided_at": decision.decided_at.isoformat(),
        "loop_run_id": decision.loop_run_id,
        "mode": decision.mode.value,
        "symbol": decision.symbol,
        "action": decision.action.value,
        "strategy_key": decision.strategy_key,
        "strategy_version": decision.strategy_version,
        "model_version": decision.model_version,
        "proposed_quantity": _dec(decision.proposed_quantity),
        "approved_quantity": _dec(decision.approved_quantity),
        "reference_price": _dec(decision.reference_price),
        "limit_price": _dec(decision.limit_price),
        "confidence": _dec(decision.confidence),
        "uncertainty": _dec(decision.uncertainty),
        "expected_return": _dec(decision.expected_return),
        "expected_holding_days": decision.expected_holding_days,
        "risk_contribution": _dec(decision.risk_contribution),
        "estimated_cost_bps": _dec(decision.estimated_cost_bps),
        "regime": decision.regime.value if decision.regime else None,
        "approval_state": decision.approval_state.value,
        "approved_by": decision.approved_by,
        "rejection_reason": decision.rejection_reason,
        "explanation": decision.explanation,
        "is_synthetic": decision.is_synthetic,
    }
    if detail:
        payload.update(
            {
                "signal_inputs": decision.signal_inputs,
                "entry_thesis": decision.entry_thesis,
                "exit_criteria": decision.exit_criteria,
                "invalidating_conditions": decision.invalidating_conditions,
                "bull_case": decision.bull_case,
                "bear_case": decision.bear_case,
                "sizing_detail": decision.sizing_detail,
                "risk_verdict": decision.risk_verdict,
                "risk_checks": [
                    {
                        "check": c.check_name,
                        "result": c.result.value,
                        "observed": _dec(c.observed),
                        "limit": _dec(c.limit_value),
                        "utilization": _dec(c.utilization),
                        "message": c.message,
                    }
                    for c in sorted(decision.risk_checks, key=lambda x: x.check_name)
                ],
                "orders": [
                    {
                        "id": o.id,
                        "client_order_id": o.client_order_id,
                        "status": o.status.value,
                        "quantity": str(o.quantity),
                        "filled_quantity": str(o.filled_quantity),
                        "avg_fill_price": _dec(o.avg_fill_price),
                        "realized_slippage_bps": _dec(o.realized_slippage_bps),
                        "reject_reason": o.reject_reason,
                    }
                    for o in decision.orders
                ],
                "review": (
                    {
                        "at": decision.review.at.isoformat(),
                        "realized_pnl": _dec(decision.review.realized_pnl),
                        "realized_return_pct": _dec(decision.review.realized_return_pct),
                        "holding_days": decision.review.holding_days,
                        "thesis_outcome": decision.review.thesis_outcome,
                        "exit_reason": decision.review.exit_reason,
                        "slippage_bps": _dec(decision.review.slippage_bps),
                        "expected_vs_actual": decision.review.expected_vs_actual,
                        "lessons": decision.review.lessons,
                        "calibration_bucket": decision.review.calibration_bucket,
                    }
                    if decision.review
                    else None
                ),
            }
        )
    return payload


@router.get("/journal")
def journal(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(50, ge=1, le=300),
    symbol: str | None = None,
    action: E.DecisionAction | None = None,
    approval_state: E.ApprovalState | None = None,
    days: int = Query(90, ge=1, le=3650),
) -> dict[str, Any]:
    mode = current_mode()
    query = select(Decision).where(Decision.mode == mode, Decision.decided_at >= utcnow() - timedelta(days=days))
    if symbol:
        query = query.where(Decision.symbol == symbol.upper())
    if action:
        query = query.where(Decision.action == action)
    if approval_state:
        query = query.where(Decision.approval_state == approval_state)
    rows = list(session.scalars(query.order_by(Decision.decided_at.desc()).limit(limit)))

    counts = dict(
        session.execute(
            select(Decision.action, func.count()).where(Decision.mode == mode).group_by(Decision.action)
        ).all()
    )
    approvals = dict(
        session.execute(
            select(Decision.approval_state, func.count()).where(Decision.mode == mode).group_by(Decision.approval_state)
        ).all()
    )
    return {
        "mode": mode.value,
        "decisions": [_decision_out(d) for d in rows],
        "action_counts": {k.value: v for k, v in counts.items()},
        "approval_counts": {k.value: v for k, v in approvals.items()},
    }


@router.get("/journal/{decision_id}")
def decision_detail(
    decision_id: int,
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    decision = session.get(Decision, decision_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    return _decision_out(decision, detail=True)


class ApprovalRequest(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=500)


@router.post("/journal/{decision_id}/approval")
def approve_decision(
    decision_id: int,
    payload: ApprovalRequest,
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Approve or reject a decision that was held for a human.

    Approval does **not** bypass the risk engine: an approved decision is
    re-evaluated at submission time, so a limit that binds later still blocks it.
    """
    decision = session.get(Decision, decision_id)
    if decision is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    if decision.approval_state not in (E.ApprovalState.PENDING_HUMAN,):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Decision is already {decision.approval_state.value}",
        )
    decision.approval_state = E.ApprovalState.APPROVED if payload.approve else E.ApprovalState.REJECTED_BY_HUMAN
    decision.approved_by = user.email
    decision.approved_at = utcnow()
    if not payload.approve:
        decision.rejection_reason = payload.note or "rejected by operator"
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="decision_approved" if payload.approve else "decision_rejected",
        target=f"decision:{decision_id}",
        ip=request.client.host if request.client else None,
        detail={"note": payload.note, "symbol": decision.symbol},
    )
    return _decision_out(decision, detail=True)


@router.get("/loops")
def loop_runs(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(25, ge=1, le=200),
) -> list[dict[str, Any]]:
    rows = session.scalars(select(LoopRun).order_by(LoopRun.started_at.desc()).limit(limit))
    return [
        {
            "id": r.id,
            "started_at": r.started_at.isoformat(),
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "mode": r.mode.value,
            "status": r.status.value,
            "trigger": r.trigger,
            "market_open": r.market_open,
            "regime": r.regime.value if r.regime else None,
            "health_ok": r.health_ok,
            "candidates_considered": r.candidates_considered,
            "decisions_made": r.decisions_made,
            "orders_submitted": r.orders_submitted,
            "orders_rejected": r.orders_rejected,
            "halted_reason": r.halted_reason,
            "summary": r.summary,
            "error": r.error,
            "duration_ms": r.duration_ms,
            "steps": (r.steps or {}).get("steps", []),
        }
        for r in rows
    ]


@router.get("/alerts")
def alerts(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(100, ge=1, le=500),
    unacknowledged_only: bool = False,
) -> dict[str, Any]:
    query = select(Alert).order_by(Alert.at.desc()).limit(limit)
    if unacknowledged_only:
        query = select(Alert).where(Alert.acknowledged.is_(False)).order_by(Alert.at.desc()).limit(limit)
    rows = list(session.scalars(query))
    unacked = session.scalar(select(func.count()).select_from(Alert).where(Alert.acknowledged.is_(False)))
    return {
        "unacknowledged_count": unacked or 0,
        "alerts": [
            {
                "id": a.id,
                "at": a.at.isoformat(),
                "kind": a.kind.value,
                "severity": a.severity.value,
                "title": a.title,
                "message": a.message,
                "symbol": a.symbol,
                "acknowledged": a.acknowledged,
                "acknowledged_by": a.acknowledged_by,
                "delivered_channels": a.delivered_channels,
            }
            for a in rows
        ],
    }


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: int,
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    alert = session.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    alert.acknowledged_by = user.email
    alert.acknowledged_at = utcnow()
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="alert_acknowledged",
        target=f"alert:{alert_id}",
        ip=request.client.host if request.client else None,
    )
    return {"id": alert.id, "acknowledged": True}


@router.get("/data-quality")
def data_quality(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(200, ge=1, le=1000),
    unresolved_only: bool = True,
) -> dict[str, Any]:
    from aegisquant.data.quality import open_issue_summary

    query = select(DataQualityIssue).order_by(DataQualityIssue.detected_at.desc()).limit(limit)
    if unresolved_only:
        query = (
            select(DataQualityIssue)
            .where(DataQualityIssue.resolved.is_(False))
            .order_by(DataQualityIssue.detected_at.desc())
            .limit(limit)
        )
    rows = list(session.scalars(query))
    return {
        "summary": open_issue_summary(session),
        "issues": [
            {
                "id": i.id,
                "detected_at": i.detected_at.isoformat(),
                "kind": i.kind.value,
                "severity": i.severity.value,
                "symbol": i.symbol,
                "provider": i.provider,
                "session_date": i.session_date.isoformat() if i.session_date else None,
                "message": i.message,
                "detail": i.detail,
                "resolved": i.resolved,
                "resolution_note": i.resolution_note,
            }
            for i in rows
        ],
    }


class ResolveIssueRequest(BaseModel):
    note: str = Field(min_length=3, max_length=500)


@router.post("/data-quality/{issue_id}/resolve")
def resolve_issue(
    issue_id: int,
    payload: ResolveIssueRequest,
    request: Request,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    issue = session.get(DataQualityIssue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    issue.resolved = True
    issue.resolved_at = utcnow()
    issue.resolution_note = f"{payload.note} (resolved by {user.email})"
    record_audit(
        session,
        actor=user.email,
        actor_role=user.role.value,
        action="data_issue_resolved",
        target=f"issue:{issue_id}",
        ip=request.client.host if request.client else None,
        detail={"note": payload.note},
    )
    return {"id": issue.id, "resolved": True}


@router.get("/performance")
def performance(user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)) -> dict[str, Any]:
    """Realised performance and post-trade analysis for the current mode."""
    from aegisquant.backtest.metrics import compute_metrics
    from aegisquant.db.models import PortfolioSnapshot
    from aegisquant.ops.alerts import model_drift, strategy_drift

    mode = current_mode()
    history = list(
        session.scalars(select(PortfolioSnapshot).where(PortfolioSnapshot.mode == mode).order_by(PortfolioSnapshot.at))
    )
    reviews = list(session.scalars(select(PostTradeReview).order_by(PostTradeReview.at.desc())))
    trades = [
        {
            "net_pnl": float(r.realized_pnl) if r.realized_pnl is not None else None,
            "gross_pnl": float(r.realized_pnl) if r.realized_pnl is not None else None,
            "costs": float(r.cost_bps or 0),
            "holding_days": r.holding_days,
        }
        for r in reviews
    ]

    metrics = None
    if len(history) >= 2:
        # Collapse to one observation per session so the metrics are daily.
        by_date: dict[Any, PortfolioSnapshot] = {}
        for snapshot in history:
            by_date[snapshot.session_date] = snapshot
        ordered = [by_date[k] for k in sorted(by_date)]
        metrics = compute_metrics(
            [s.session_date for s in ordered],
            [float(s.equity) for s in ordered],
            trades=trades,
            exposures=[float(s.gross_exposure) for s in ordered],
            uses_synthetic_data=any(
                p.is_synthetic
                for p in session.scalars(
                    select(__import__("aegisquant.db.models", fromlist=["Position"]).Position).where(
                        __import__("aegisquant.db.models", fromlist=["Position"]).Position.mode == mode
                    )
                )
            ),
            estimate_drawdown_probabilities=len(ordered) >= 60,
        ).as_dict()

    return {
        "mode": mode.value,
        "observations": len(history),
        "metrics": metrics,
        "post_trade_reviews": [
            {
                "at": r.at.isoformat(),
                "symbol": r.symbol,
                "decision_id": r.decision_id,
                "realized_pnl": _dec(r.realized_pnl),
                "realized_return_pct": _dec(r.realized_return_pct),
                "holding_days": r.holding_days,
                "thesis_outcome": r.thesis_outcome,
                "exit_reason": r.exit_reason,
                "slippage_bps": _dec(r.slippage_bps),
                "expected_vs_actual": r.expected_vs_actual,
                "lessons": r.lessons,
            }
            for r in reviews[:200]
        ],
        "calibration": model_drift(session),
        "strategy_drift": strategy_drift(session),
        "disclaimer": (
            "Realised results for this mode only. Backtested results are reported separately and "
            "are never combined with these figures."
        ),
    }


@router.get("/audit")
def audit_log(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(200, ge=1, le=1000),
) -> list[dict[str, Any]]:
    rows = session.scalars(select(AuditLog).order_by(AuditLog.at.desc()).limit(limit))
    return [
        {
            "at": r.at.isoformat(),
            "actor": r.actor,
            "actor_role": r.actor_role,
            "action": r.action,
            "target": r.target,
            "method": r.method,
            "path": r.path,
            "status_code": r.status_code,
            "ip": r.ip,
            "detail": r.detail,
        }
        for r in rows
    ]
