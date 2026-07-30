"""Opportunity Centre, Strategy Lab and feature-registry endpoints."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.api.security import CurrentUser, mutating, require_viewer
from aegisquant.config import get_settings
from aegisquant.db import enums as E
from aegisquant.db.models import (
    BacktestRun,
    BacktestTrade,
    EnsembleWeight,
    EquityPoint,
    FeatureSnapshot,
    Opportunity,
    RegimeSnapshot,
)
from aegisquant.db.models import (
    Strategy as StrategyRow,
)
from aegisquant.db.repo import current_mode, open_positions
from aegisquant.db.session import get_session, session_scope
from aegisquant.features.engine import compute_bundle
from aegisquant.features.market_view import MarketView
from aegisquant.features.registry import REGISTRY, registry_version
from aegisquant.logging_setup import get_logger
from aegisquant.services import backtest_service as bt
from aegisquant.strategies import regime as regime_mod
from aegisquant.strategies.base import OpenPositionState, StrategyContext
from aegisquant.strategies.registry import ALL_STRATEGIES, build_all, describe_all, get_strategy
from aegisquant.utils.money import ZERO, D, safe_div
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)
router = APIRouter(tags=["research"])


def _dec(v: Any) -> str | None:
    return None if v is None else str(v)


# ---------------------------------------------------------------------------
# Opportunity Centre
# ---------------------------------------------------------------------------
@router.get("/opportunities")
def opportunities(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(40, ge=1, le=200),
    live: bool = Query(False, description="Recompute now instead of reading the last cycle"),
) -> dict[str, Any]:
    """Ranked candidates with scores, evidence and the proposed trade."""
    if not live:
        latest_at = session.scalar(select(Opportunity.as_of).order_by(Opportunity.as_of.desc()).limit(1))
        if latest_at is not None:
            rows = list(
                session.scalars(
                    select(Opportunity)
                    .where(Opportunity.as_of == latest_at)
                    .order_by(Opportunity.rank.nullslast(), Opportunity.growth_score.desc())
                    .limit(limit)
                )
            )
            return {
                "as_of": latest_at.isoformat(),
                "source": "last_cycle",
                "using_synthetic_data": (
                    any(r.is_synthetic for r in rows) or get_settings().price_provider == "fixture"
                ),
                "candidates": [_opportunity_out(r) for r in rows],
            }

    return _compute_opportunities(session, limit)


def _opportunity_out(row: Opportunity) -> dict[str, Any]:
    return {
        "symbol": row.symbol,
        "rank": row.rank,
        "strategy_key": row.strategy_key,
        "growth_score": _dec(row.growth_score),
        "signal_score": _dec(row.signal_score),
        "confidence": _dec(row.confidence),
        "uncertainty": _dec(row.uncertainty),
        "expected_return": _dec(row.expected_return),
        "expected_return_low": _dec(row.expected_return_low),
        "expected_return_high": _dec(row.expected_return_high),
        "expected_vol": _dec(row.expected_vol),
        "downside_estimate": _dec(row.downside_estimate),
        "estimated_cost_bps": _dec(row.estimated_cost_bps),
        "expected_holding_days": row.expected_holding_days,
        "regime": row.regime.value if row.regime else None,
        "components": row.components,
        "supporting_evidence": (row.supporting_evidence or {}).get("items", []),
        "opposing_evidence": (row.opposing_evidence or {}).get("items", []),
        "weaknesses": (row.weaknesses or {}).get("items", []),
        "is_synthetic": row.is_synthetic,
    }


def _compute_opportunities(session: Session, limit: int) -> dict[str, Any]:
    """Recompute the candidate list from current data and persist it."""
    settings = get_settings()
    mode = current_mode()
    universe = bt.default_universe(session)
    if not universe:
        return {
            "as_of": None,
            "source": "live",
            "candidates": [],
            "note": "no instruments ingested yet",
        }

    now = utcnow()
    view = MarketView.load(session, universe, benchmark=settings.benchmark_symbol)
    bundle = compute_bundle(
        view,
        now,
        min_price=float(settings.risk.min_price),
        min_adv_usd=float(settings.risk.min_adv_usd),
    )
    assessment = regime_mod.assess(bundle, session)

    equity = ZERO
    from aegisquant.db.repo import latest_snapshot

    snapshot = latest_snapshot(session, mode)
    if snapshot:
        equity = snapshot.equity
    positions: dict[str, OpenPositionState] = {}
    for pos in open_positions(session, mode):
        price = pos.last_price or pos.avg_entry_price
        positions[pos.symbol] = OpenPositionState(
            symbol=pos.symbol,
            quantity=float(pos.quantity),
            avg_entry_price=float(pos.avg_entry_price),
            last_price=float(price),
            unrealized_pnl_pct=float(pos.unrealized_pnl_pct or 0),
            holding_days=(now - pos.opened_at).days if pos.opened_at else 0,
            peak_price=float(pos.peak_price or price),
            weight=float(safe_div(pos.quantity * price, equity)) if equity else 0.0,
            strategy_key=pos.strategy_key,
        )

    ctx = StrategyContext(
        as_of=now,
        pit=view.at(now),
        features=bundle,
        regime=assessment.regime,
        regime_score=assessment.score,
        positions=positions,
        equity=float(equity),
        cash=float(snapshot.cash) if snapshot else 0.0,
    )

    grouped: dict[str, list[Any]] = {}
    for strategy in build_all():
        if not strategy.supports_regime(assessment.regime):
            continue
        try:
            for signal in strategy.generate(ctx):
                grouped.setdefault(signal.symbol, []).append(signal)
        except Exception:
            log.exception("opportunity_strategy_failed", strategy=strategy.meta.key)

    candidates: list[dict[str, Any]] = []
    for symbol, signals in grouped.items():
        sf = bundle.symbols.get(symbol)
        best = max(signals, key=lambda s: (s.confidence, s.strength))
        growth = sf.growth if sf else None
        candidates.append(
            {
                "symbol": symbol,
                "strategy_key": best.strategy_key,
                "strategies": sorted({s.strategy_key for s in signals}),
                "growth_score": _dec(D(growth.total)) if growth and growth.total is not None else None,
                "signal_score": _dec(D(best.strength)),
                "confidence": _dec(D(best.confidence)),
                "uncertainty": _dec(D(1 - best.confidence)),
                "expected_return": _dec(D(best.expected_return)) if best.expected_return else None,
                "expected_return_low": _dec(D(best.expected_return_low)) if best.expected_return_low else None,
                "expected_return_high": _dec(D(best.expected_return_high)) if best.expected_return_high else None,
                "expected_vol": _dec(D(best.expected_vol)) if best.expected_vol else None,
                "downside_estimate": _dec(D(best.downside_estimate)) if best.downside_estimate else None,
                "expected_holding_days": best.expected_holding_days,
                "regime": assessment.regime.value,
                "sector": view.sectors.get(symbol),
                "thesis": best.thesis,
                "components": growth.as_dict()["components"] if growth else None,
                "supporting_evidence": sorted({e for s in signals for e in s.supporting_evidence}),
                "opposing_evidence": sorted({e for s in signals for e in s.opposing_evidence}),
                "weaknesses": growth.weaknesses if growth else [],
                "disqualifiers": growth.disqualifiers if growth else [],
                "coverage": growth.coverage if growth else None,
                "is_synthetic": bool(sf and sf.is_synthetic),
                "signal_inputs": best.signal_inputs,
                "exit_criteria": best.exit_criteria,
            }
        )
    candidates.sort(key=lambda c: (float(c["confidence"] or 0), float(c["growth_score"] or 0)), reverse=True)
    for i, candidate in enumerate(candidates, start=1):
        candidate["rank"] = i

    # Persist so the UI and the audit trail agree on what was ranked when.
    for candidate in candidates[:limit]:
        session.add(
            Opportunity(
                as_of=now,
                symbol=candidate["symbol"],
                strategy_key=candidate["strategy_key"],
                rank=candidate["rank"],
                growth_score=D(candidate["growth_score"]) if candidate["growth_score"] else None,
                signal_score=D(candidate["signal_score"]),
                confidence=D(candidate["confidence"]),
                uncertainty=D(candidate["uncertainty"]),
                expected_return=D(candidate["expected_return"]) if candidate["expected_return"] else None,
                expected_return_low=D(candidate["expected_return_low"]) if candidate["expected_return_low"] else None,
                expected_return_high=D(candidate["expected_return_high"])
                if candidate["expected_return_high"]
                else None,
                expected_vol=D(candidate["expected_vol"]) if candidate["expected_vol"] else None,
                downside_estimate=D(candidate["downside_estimate"]) if candidate["downside_estimate"] else None,
                expected_holding_days=candidate["expected_holding_days"],
                regime=assessment.regime,
                components=candidate["components"],
                supporting_evidence={"items": candidate["supporting_evidence"]},
                opposing_evidence={"items": candidate["opposing_evidence"]},
                weaknesses={"items": candidate["weaknesses"]},
                data_quality=E.DataQuality.SYNTHETIC if candidate["is_synthetic"] else E.DataQuality.OK,
                is_synthetic=candidate["is_synthetic"],
            )
        )

    return {
        "as_of": now.isoformat(),
        "source": "live",
        "regime": assessment.as_dict(),
        "universe_evaluated": len(bundle.symbols),
        "using_synthetic_data": bundle.universe_synthetic,
        "candidates": candidates[:limit],
    }


@router.get("/features/registry")
def feature_registry(user: CurrentUser = Depends(require_viewer)) -> dict[str, Any]:
    return {
        "version": registry_version(),
        "count": len(REGISTRY.features),
        "features": REGISTRY.as_dicts(),
    }


@router.get("/features/{symbol}")
def feature_snapshot(
    symbol: str,
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    row = session.scalar(
        select(FeatureSnapshot)
        .where(FeatureSnapshot.symbol == symbol.upper())
        .order_by(FeatureSnapshot.as_of.desc())
        .limit(1)
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No feature snapshot has been computed for {symbol.upper()} yet",
        )
    return {
        "symbol": row.symbol,
        "as_of": row.as_of.isoformat(),
        "registry_version": row.registry_version,
        "data_quality": row.data_quality.value,
        "values": row.values,
        "missing": row.missing,
        "computed_at": row.computed_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Strategy Lab
# ---------------------------------------------------------------------------
@router.get("/strategies")
def list_strategies(
    user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)
) -> list[dict[str, Any]]:
    rows = {r.key: r for r in session.scalars(select(StrategyRow))}
    out = []
    for meta in describe_all():
        row = rows.get(meta["key"])
        out.append(
            {
                **meta,
                "status": row.status.value if row else E.StrategyStatus.RESEARCH.value,
                "enabled": row.enabled if row else True,
                "paused_reason": row.paused_reason if row else None,
                "target_weight": _dec(row.target_weight) if row else "0",
                "db_id": row.id if row else None,
            }
        )
    return out


@router.get("/strategies/{key}")
def strategy_detail(
    key: str,
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    if key not in ALL_STRATEGIES:
        raise HTTPException(status_code=404, detail=f"Unknown strategy '{key}'")
    strategy = get_strategy(key)
    row = session.scalar(select(StrategyRow).where(StrategyRow.key == key))
    runs = list(
        session.scalars(
            select(BacktestRun)
            .where(BacktestRun.strategy_keys.is_not(None))
            .order_by(BacktestRun.created_at.desc())
            .limit(50)
        )
    )
    relevant = [r for r in runs if key in ((r.strategy_keys or {}).get("keys") or [])]
    weights = list(
        session.scalars(
            select(EnsembleWeight)
            .where(EnsembleWeight.strategy_key == key)
            .order_by(EnsembleWeight.as_of.desc())
            .limit(30)
        )
    )
    return {
        **strategy.describe(),
        "status": row.status.value if row else E.StrategyStatus.RESEARCH.value,
        "enabled": row.enabled if row else True,
        "target_weight": _dec(row.target_weight) if row else "0",
        "versions": [
            {
                "version": v.version,
                "params": v.params,
                "origin": v.origin,
                "quarantined": v.quarantined,
                "approved_by": v.approved_by,
                "approved_at": v.approved_at.isoformat() if v.approved_at else None,
                "notes": v.notes,
            }
            for v in (row.versions if row else [])
        ],
        "backtests": [_run_summary(r) for r in relevant[:20]],
        "ensemble_weight_history": [
            {
                "as_of": w.as_of.isoformat(),
                "weight": str(w.weight),
                "prev_weight": _dec(w.prev_weight),
                "sharpe": _dec(w.sharpe),
                "regime_multiplier": _dec(w.regime_multiplier),
                "capped_by": w.capped_by,
                "reason": w.reason,
            }
            for w in weights
        ],
    }


def _run_summary(run: BacktestRun) -> dict[str, Any]:
    metrics = run.metrics or {}
    return {
        "id": run.id,
        "label": run.label,
        "phase": run.phase.value,
        "status": run.status.value,
        "start_date": run.start_date.isoformat(),
        "end_date": run.end_date.isoformat(),
        "strategy_keys": (run.strategy_keys or {}).get("keys", []),
        "accepted": run.accepted,
        "uses_synthetic_data": run.uses_synthetic_data,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "duration_ms": run.duration_ms,
        "error": run.error,
        "headline": {
            "total_return": metrics.get("total_return"),
            "cagr": metrics.get("cagr"),
            "sharpe": metrics.get("sharpe"),
            "sortino": metrics.get("sortino"),
            "calmar": metrics.get("calmar"),
            "max_drawdown": metrics.get("max_drawdown"),
            "trades": (metrics.get("trade_stats") or {}).get("trades"),
            "excess_return": metrics.get("excess_return"),
        },
    }


class BacktestRequest(BaseModel):
    start: date
    end: date
    label: str = Field(default="lab-run", max_length=120)
    strategy_keys: list[str] = Field(default_factory=list)
    strategy_params: dict[str, dict[str, Any]] = Field(default_factory=dict)
    universe: list[str] | None = None
    starting_cash: Decimal = Decimal("100000")
    benchmark: str | None = None
    phase: E.BacktestPhase = E.BacktestPhase.IN_SAMPLE
    rebalance_interval_days: int = Field(default=5, ge=1, le=60)
    review_interval_days: int = Field(default=5, ge=1, le=60)
    warmup_sessions: int = Field(default=260, ge=30, le=1000)
    with_validation: bool = False
    sensitivity: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/backtests")
def list_backtests(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    limit: int = Query(50, ge=1, le=200),
    phase: E.BacktestPhase | None = None,
) -> list[dict[str, Any]]:
    query = select(BacktestRun).order_by(BacktestRun.created_at.desc()).limit(limit)
    if phase:
        query = (
            select(BacktestRun).where(BacktestRun.phase == phase).order_by(BacktestRun.created_at.desc()).limit(limit)
        )
    return [_run_summary(r) for r in session.scalars(query)]


@router.get("/backtests/{run_id}")
def backtest_detail(
    run_id: int,
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    run = session.get(BacktestRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Backtest run not found")
    points = list(
        session.scalars(select(EquityPoint).where(EquityPoint.run_id == run_id).order_by(EquityPoint.session_date))
    )
    trades = list(
        session.scalars(select(BacktestTrade).where(BacktestTrade.run_id == run_id).order_by(BacktestTrade.entry_at))
    )
    return {
        **_run_summary(run),
        "params": run.params,
        "cost_model": run.cost_model,
        "universe": (run.universe or {}).get("symbols", []),
        "metrics": run.metrics,
        "benchmark_metrics": run.benchmark_metrics,
        "regime_metrics": run.regime_metrics,
        "diagnostics": run.diagnostics,
        "rejection_reasons": run.rejection_reasons,
        "disclaimer": (
            "Backtested results are hypothetical. They are not an indication of future returns, "
            "and they are shown separately from paper and live results."
            + (" This run used SIMULATED market data." if run.uses_synthetic_data else "")
        ),
        "equity_curve": [
            {
                "date": p.session_date.isoformat(),
                "equity": str(p.equity),
                "cash": str(p.cash),
                "benchmark": _dec(p.benchmark_equity),
                "drawdown": str(p.drawdown),
                "gross_exposure": str(p.gross_exposure),
                "positions": p.positions,
                "regime": p.regime.value if p.regime else None,
            }
            for p in points
        ],
        "trades": [
            {
                "symbol": t.symbol,
                "strategy_key": t.strategy_key,
                "entry_at": t.entry_at.isoformat() if t.entry_at else None,
                "exit_at": t.exit_at.isoformat() if t.exit_at else None,
                "quantity": str(t.quantity),
                "entry_price": str(t.entry_price),
                "exit_price": _dec(t.exit_price),
                "net_pnl": _dec(t.net_pnl),
                "return_pct": _dec(t.return_pct),
                "costs": _dec(t.costs),
                "holding_days": t.holding_days,
                "exit_reason": t.exit_reason,
                "mae_pct": _dec(t.mae_pct),
                "mfe_pct": _dec(t.mfe_pct),
            }
            for t in trades[:2000]
        ],
    }


def _run_backtest_job(request: BacktestRequest, run_id: int) -> None:
    """Background worker body. Opens its own session."""
    with session_scope() as session:
        run = session.get(BacktestRun, run_id)
        if run is None:
            return
        config = bt.build_config(
            session,
            start=request.start,
            end=request.end,
            label=request.label,
            universe=request.universe,
            strategy_keys=request.strategy_keys,
            strategy_params=request.strategy_params,
            starting_cash=request.starting_cash,
            benchmark=request.benchmark,
            rebalance_interval_days=request.rebalance_interval_days,
            review_interval_days=request.review_interval_days,
            warmup_sessions=request.warmup_sessions,
        )
        specs = [
            (s["strategy_key"], s["parameter"], s["values"])
            for s in request.sensitivity
            if {"strategy_key", "parameter", "values"} <= set(s)
        ]
        bt.run_backtest(
            session,
            config,
            phase=request.phase,
            strategy_key=request.strategy_keys[0] if request.strategy_keys else None,
            with_validation=request.with_validation,
            sensitivity_specs=specs or None,
            run=run,
        )


@router.post("/backtests", status_code=status.HTTP_202_ACCEPTED)
def create_backtest(
    payload: BacktestRequest,
    background: BackgroundTasks,
    user: CurrentUser = Depends(mutating),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    """Queue a backtest. Returns immediately; poll the run for status."""
    if payload.end <= payload.start:
        raise HTTPException(status_code=400, detail="end must be after start")
    for key in payload.strategy_keys:
        if key not in ALL_STRATEGIES:
            raise HTTPException(status_code=400, detail=f"Unknown strategy '{key}'")
    config = bt.build_config(
        session,
        start=payload.start,
        end=payload.end,
        label=payload.label,
        universe=payload.universe,
        strategy_keys=payload.strategy_keys,
        strategy_params=payload.strategy_params,
        starting_cash=payload.starting_cash,
        benchmark=payload.benchmark,
        rebalance_interval_days=payload.rebalance_interval_days,
        review_interval_days=payload.review_interval_days,
        warmup_sessions=payload.warmup_sessions,
    )
    run = bt.create_run(
        session,
        config,
        phase=payload.phase,
        strategy_key=payload.strategy_keys[0] if payload.strategy_keys else None,
    )
    session.commit()
    background.add_task(_run_backtest_job, payload, run.id)
    return {"run_id": run.id, "status": "queued", "poll": f"/api/backtests/{run.id}"}


@router.get("/ensemble")
def ensemble_weights(
    user: CurrentUser = Depends(require_viewer), session: Session = Depends(get_session)
) -> dict[str, Any]:
    latest = session.scalar(select(EnsembleWeight.as_of).order_by(EnsembleWeight.as_of.desc()).limit(1))
    if latest is None:
        return {
            "as_of": None,
            "weights": [],
            "note": "no ensemble allocation has been computed yet",
        }
    rows = list(session.scalars(select(EnsembleWeight).where(EnsembleWeight.as_of == latest)))
    return {
        "as_of": latest.isoformat(),
        "weights": [
            {
                "strategy_key": r.strategy_key,
                "weight": str(r.weight),
                "prev_weight": _dec(r.prev_weight),
                "raw_score": _dec(r.raw_score),
                "sharpe": _dec(r.sharpe),
                "correlation_penalty": _dec(r.correlation_penalty),
                "turnover_penalty": _dec(r.turnover_penalty),
                "regime_multiplier": _dec(r.regime_multiplier),
                "evidence_trades": r.evidence_trades,
                "capped_by": r.capped_by,
                "reason": r.reason,
            }
            for r in sorted(rows, key=lambda r: r.weight, reverse=True)
        ],
    }


@router.get("/regime/history")
def regime_history(
    user: CurrentUser = Depends(require_viewer),
    session: Session = Depends(get_session),
    days: int = Query(365, ge=7, le=3650),
) -> list[dict[str, Any]]:
    cutoff = utcnow() - timedelta(days=days)
    rows = session.scalars(select(RegimeSnapshot).where(RegimeSnapshot.as_of >= cutoff).order_by(RegimeSnapshot.as_of))
    return [
        {
            "as_of": r.as_of.isoformat(),
            "regime": r.regime.value,
            "score": str(r.score),
            "index_trend": _dec(r.index_trend),
            "vol_regime": _dec(r.vol_regime),
            "breadth": _dec(r.breadth),
            "credit": _dec(r.credit),
            "yield_curve": _dec(r.yield_curve),
            "explanation": r.explanation,
        }
        for r in rows
    ]
