"""Alerting and operational metrics.

Alerts are persisted first and delivered second, so a delivery failure never
loses the record. Delivery is pluggable: the log channel is always on, and a
webhook channel activates when ``AEGIS_ALERT_WEBHOOK_URL`` is set.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aegisquant.db import enums as E
from aegisquant.db.models import (
    Alert,
    DataQualityIssue,
    LoopRun,
    MetricSample,
    Order,
    PortfolioSnapshot,
    ProviderFetchLog,
    ReconciliationRun,
)
from aegisquant.db.repo import current_mode
from aegisquant.logging_setup import get_logger
from aegisquant.utils.money import ZERO, D, safe_div
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)


def raise_alert(
    session: Session,
    kind: E.AlertKind,
    severity: E.AlertSeverity,
    title: str,
    message: str,
    *,
    symbol: str | None = None,
    detail: dict[str, Any] | None = None,
    deliver: bool = True,
) -> Alert:
    alert = Alert(
        at=utcnow(),
        kind=kind,
        severity=severity,
        title=title,
        message=message,
        symbol=symbol,
        detail=detail,
    )
    session.add(alert)
    session.flush()
    channels = {"log": True}
    log.info(
        "alert",
        kind=kind.value,
        severity=severity.value,
        title=title,
        message=message,
        symbol=symbol,
    )
    if deliver:
        channels["webhook"] = _deliver_webhook(alert)
    alert.delivered_channels = channels
    return alert


def _deliver_webhook(alert: Alert) -> bool:
    url = os.environ.get("AEGIS_ALERT_WEBHOOK_URL")
    if not url:
        return False
    try:
        httpx.post(
            url,
            json={
                "kind": alert.kind.value,
                "severity": alert.severity.value,
                "title": alert.title,
                "message": alert.message,
                "symbol": alert.symbol,
                "at": alert.at.isoformat(),
            },
            timeout=5.0,
        )
        return True
    except Exception as exc:  # pragma: no cover - network dependent
        log.warning("alert_webhook_failed", error=str(exc))
        return False


def unacknowledged(session: Session, limit: int = 50) -> list[Alert]:
    return list(
        session.scalars(select(Alert).where(Alert.acknowledged.is_(False)).order_by(Alert.at.desc()).limit(limit))
    )


# ---------------------------------------------------------------------------
@dataclass(slots=True)
class Metric:
    name: str
    value: Decimal
    labels: dict[str, Any] | None = None
    help_text: str = ""


def record_metric(session: Session, name: str, value: Any, labels: dict[str, Any] | None = None) -> None:
    session.add(MetricSample(at=utcnow(), name=name, value=D(value), labels=labels))


def collect_metrics(session: Session) -> list[Metric]:
    """Snapshot the operational metrics the runbook references."""
    now = utcnow()
    mode = current_mode()
    out: list[Metric] = []

    # --- data freshness ---
    newest_fetch = session.scalar(select(func.max(ProviderFetchLog.at)))
    out.append(
        Metric(
            "data_freshness_seconds",
            D((now - newest_fetch).total_seconds()) if newest_fetch else D(-1),
            help_text="seconds since the most recent successful provider fetch",
        )
    )
    recent = list(session.scalars(select(ProviderFetchLog).where(ProviderFetchLog.at >= now - timedelta(hours=1))))
    if recent:
        ok = sum(1 for r in recent if r.ok)
        out.append(Metric("provider_success_rate_1h", safe_div(D(ok), D(len(recent)))))
        latencies = [r.latency_ms for r in recent if r.latency_ms is not None]
        if latencies:
            out.append(Metric("provider_latency_ms_avg_1h", D(sum(latencies) / len(latencies))))
        out.append(Metric("provider_rate_limited_1h", D(sum(1 for r in recent if r.rate_limited))))

    # --- job / loop latency ---
    last_loop = session.scalar(select(LoopRun).order_by(LoopRun.started_at.desc()).limit(1))
    if last_loop:
        out.append(Metric("loop_age_seconds", D((now - last_loop.started_at).total_seconds())))
        if last_loop.duration_ms is not None:
            out.append(Metric("loop_duration_ms", D(last_loop.duration_ms)))
        out.append(Metric("loop_failed", D(1 if last_loop.status is E.RunStatus.FAILED else 0)))

    # --- order latency / rejection / fill quality ---
    day_orders = list(
        session.scalars(select(Order).where(Order.mode == mode, Order.created_at >= now - timedelta(days=1)))
    )
    if day_orders:
        rejected = sum(1 for o in day_orders if o.status is E.OrderStatus.REJECTED)
        out.append(Metric("order_rejection_rate_1d", safe_div(D(rejected), D(len(day_orders)))))
        acked = [
            (o.acknowledged_at - o.submitted_at).total_seconds()
            for o in day_orders
            if o.acknowledged_at and o.submitted_at
        ]
        if acked:
            out.append(Metric("order_ack_latency_seconds_avg", D(sum(acked) / len(acked))))
        slippages = [o.realized_slippage_bps for o in day_orders if o.realized_slippage_bps is not None]
        if slippages:
            out.append(Metric("realized_slippage_bps_avg", D(sum(slippages) / len(slippages))))
        filled = sum(1 for o in day_orders if o.status is E.OrderStatus.FILLED)
        out.append(Metric("order_fill_rate_1d", safe_div(D(filled), D(len(day_orders)))))
        partials = sum(1 for o in day_orders if o.status is E.OrderStatus.PARTIALLY_FILLED)
        out.append(Metric("order_partial_rate_1d", safe_div(D(partials), D(len(day_orders)))))
    open_orders = session.scalar(
        select(func.count())
        .select_from(Order)
        .where(Order.mode == mode, Order.status.in_([s for s in E.OrderStatus if s.is_open]))
    )
    out.append(Metric("open_orders", D(open_orders or 0)))

    # --- reconciliation ---
    last_recon = session.scalar(select(ReconciliationRun).order_by(ReconciliationRun.at.desc()).limit(1))
    if last_recon:
        out.append(Metric("reconciliation_age_seconds", D((now - last_recon.at).total_seconds())))
        out.append(Metric("reconciliation_clean", D(1 if last_recon.status is E.ReconStatus.CLEAN else 0)))
        out.append(Metric("reconciliation_breaks", D((last_recon.breaks or {}).get("count", 0))))
    unresolved_recon = session.scalar(
        select(func.count()).select_from(ReconciliationRun).where(ReconciliationRun.resolved.is_(False))
    )
    out.append(Metric("reconciliation_unresolved", D(unresolved_recon or 0)))

    # --- data quality ---
    open_issues = session.scalar(
        select(func.count()).select_from(DataQualityIssue).where(DataQualityIssue.resolved.is_(False))
    )
    blocking = session.scalar(
        select(func.count())
        .select_from(DataQualityIssue)
        .where(
            DataQualityIssue.resolved.is_(False),
            DataQualityIssue.severity.in_([E.IssueSeverity.ERROR, E.IssueSeverity.CRITICAL]),
        )
    )
    out.append(Metric("data_quality_issues_open", D(open_issues or 0)))
    out.append(Metric("data_quality_issues_blocking", D(blocking or 0)))

    # --- portfolio risk ---
    snapshot = session.scalar(
        select(PortfolioSnapshot).where(PortfolioSnapshot.mode == mode).order_by(PortfolioSnapshot.at.desc()).limit(1)
    )
    if snapshot:
        out.append(Metric("portfolio_equity", snapshot.equity))
        out.append(Metric("portfolio_gross_exposure", snapshot.gross_exposure))
        out.append(Metric("portfolio_net_exposure", snapshot.net_exposure))
        out.append(Metric("portfolio_drawdown", snapshot.drawdown_pct or ZERO))
        out.append(Metric("portfolio_day_pnl_pct", snapshot.day_pnl_pct or ZERO))
        out.append(Metric("portfolio_open_positions", D(snapshot.open_positions)))
        out.append(
            Metric(
                "risk_state_severity",
                D(
                    {
                        E.RiskState.NORMAL: 0,
                        E.RiskState.WARNING: 1,
                        E.RiskState.DEFENSIVE_1: 2,
                        E.RiskState.DEFENSIVE_2: 3,
                        E.RiskState.EMERGENCY: 4,
                        E.RiskState.READ_ONLY: 5,
                    }[snapshot.risk_state]
                ),
            )
        )

    # --- alerting backlog ---
    unacked = session.scalar(select(func.count()).select_from(Alert).where(Alert.acknowledged.is_(False)))
    out.append(Metric("alerts_unacknowledged", D(unacked or 0)))
    return out


def model_drift(session: Session, lookback_days: int = 90) -> dict[str, Any]:
    """Compare stated confidence to realised outcomes — calibration drift.

    A model that says 70% and is right 40% of the time is mis-calibrated, and
    since confidence directly scales position size, that mis-calibration is a
    risk problem rather than a reporting curiosity.
    """
    from aegisquant.db.models import Decision, PostTradeReview

    cutoff = utcnow() - timedelta(days=lookback_days)
    rows = list(
        session.execute(
            select(Decision.confidence, PostTradeReview.realized_return_pct, Decision.strategy_key)
            .join(PostTradeReview, PostTradeReview.decision_id == Decision.id)
            .where(Decision.decided_at >= cutoff, Decision.confidence.is_not(None))
        )
    )
    if not rows:
        return {"observations": 0, "note": "no completed trades with recorded confidence yet"}

    buckets: dict[str, dict[str, Any]] = {}
    for confidence, realized, _strategy in rows:
        if confidence is None or realized is None:
            continue
        c = float(confidence)
        bucket = f"{int(c * 10) * 10}-{int(c * 10) * 10 + 10}%"
        entry = buckets.setdefault(bucket, {"count": 0, "wins": 0, "mean_confidence": 0.0, "mean_return": 0.0})
        entry["count"] += 1
        entry["wins"] += 1 if float(realized) > 0 else 0
        entry["mean_confidence"] += c
        entry["mean_return"] += float(realized)
    for entry in buckets.values():
        n = entry["count"]
        entry["mean_confidence"] = round(entry["mean_confidence"] / n, 4)
        entry["mean_return"] = round(entry["mean_return"] / n, 4)
        entry["win_rate"] = round(entry["wins"] / n, 4)
        entry["calibration_gap"] = round(entry["win_rate"] - entry["mean_confidence"], 4)

    gaps = [abs(v["calibration_gap"]) for v in buckets.values() if v["count"] >= 5]
    return {
        "observations": len(rows),
        "buckets": dict(sorted(buckets.items())),
        "mean_absolute_calibration_gap": round(sum(gaps) / len(gaps), 4) if gaps else None,
        "well_calibrated": bool(gaps and (sum(gaps) / len(gaps)) < 0.15),
        "note": (
            "Confidence buckets versus realised win rate. A persistent gap means position sizing "
            "is systematically wrong, because confidence scales size."
        ),
    }


def strategy_drift(session: Session, lookback_days: int = 90) -> dict[str, Any]:
    """Recent per-strategy realised performance versus its longer history."""
    from aegisquant.db.models import PostTradeReview

    now = utcnow()
    recent_cut = now - timedelta(days=lookback_days)
    from aegisquant.db.models import Decision

    rows = list(
        session.execute(
            select(
                Decision.strategy_key,
                PostTradeReview.realized_return_pct,
                PostTradeReview.at,
            ).join(PostTradeReview, PostTradeReview.decision_id == Decision.id)
        )
    )
    by_strategy: dict[str, dict[str, list[float]]] = {}
    for key, realized, at in rows:
        if key is None or realized is None:
            continue
        entry = by_strategy.setdefault(key, {"recent": [], "prior": []})
        entry["recent" if at >= recent_cut else "prior"].append(float(realized))

    out: dict[str, Any] = {}
    for key, entry in by_strategy.items():
        recent, prior = entry["recent"], entry["prior"]
        record: dict[str, Any] = {
            "recent_trades": len(recent),
            "prior_trades": len(prior),
            "recent_mean_return": round(sum(recent) / len(recent), 4) if recent else None,
            "prior_mean_return": round(sum(prior) / len(prior), 4) if prior else None,
        }
        if record["recent_mean_return"] is not None and record["prior_mean_return"] is not None:
            record["drift"] = round(record["recent_mean_return"] - record["prior_mean_return"], 4)
            record["degraded"] = bool(record["drift"] < -0.05 and len(recent) >= 5)
        out[key] = record
    return out


def prometheus_text(metrics: list[Metric]) -> str:
    """Render metrics in Prometheus exposition format."""
    lines: list[str] = []
    for metric in metrics:
        name = f"aegisquant_{metric.name}"
        if metric.help_text:
            lines.append(f"# HELP {name} {metric.help_text}")
        lines.append(f"# TYPE {name} gauge")
        labels = ""
        if metric.labels:
            inner = ",".join(f'{k}="{v}"' for k, v in metric.labels.items())
            labels = f"{{{inner}}}"
        lines.append(f"{name}{labels} {metric.value}")
    return "\n".join(lines) + "\n"
