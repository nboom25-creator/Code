"""Ensemble allocator.

Combines strategy sleeves into portfolio weights. The design goal is *stability*:
recent performance is one input among several, and no single quarter can hand the
whole book to one sleeve.

Guards against uncontrolled allocation swings:

**Minimum evidence**
    A sleeve with fewer than ``min_trades`` completed trades or ``min_days`` of
    live history is held at its prior weight, or at the neutral weight if it has
    none. Performance measured on eight trades is noise.
**Bounded weights**
    Every weight is clamped to ``[min_weight, max_weight]``. No sleeve can be
    switched off entirely by performance alone (only by an explicit pause), and
    none can dominate.
**Turnover penalty**
    Reallocation is penalised, so a marginal improvement in a score does not
    justify churning the book.
**Maximum step**
    A weight can move at most ``max_step`` per update, so even a large score
    change takes several updates to express.
**Stable update interval**
    Weights are only recomputed every ``update_interval_days``; between updates
    the stored weights are used verbatim.
**Correlation penalty**
    Sleeves whose returns duplicate other sleeves are down-weighted — the
    allocator pays for unique return, not for repeated exposure.
**Regime suitability**
    A sleeve that does not support the current regime is scaled toward zero for
    *new* entries. Position management continues regardless.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.db.enums import Regime, StrategyStatus
from aegisquant.db.models import EnsembleWeight, Strategy as StrategyRow
from aegisquant.logging_setup import get_logger
from aegisquant.strategies.base import Strategy
from aegisquant.utils.money import D

log = get_logger(__name__)


@dataclass(slots=True)
class SleevePerformance:
    """Realised track record for one sleeve, from the trade ledger."""

    strategy_key: str
    trades: int = 0
    days_live: int = 0
    net_return: float = 0.0
    sharpe: float | None = None
    sortino: float | None = None
    max_drawdown: float = 0.0
    win_rate: float | None = None
    profit_factor: float | None = None
    avg_return_per_trade: float = 0.0
    daily_returns: np.ndarray = field(default_factory=lambda: np.array([]))

    @property
    def has_evidence(self) -> bool:
        return self.trades > 0 or self.days_live > 0


@dataclass(slots=True)
class AllocationConfig:
    min_weight: Decimal = Decimal("0.02")
    max_weight: Decimal = Decimal("0.30")
    neutral_weight: Decimal = Decimal("0.08")
    min_trades: int = 20
    min_days: int = 60
    max_step: Decimal = Decimal("0.05")
    turnover_penalty: Decimal = Decimal("0.20")
    correlation_penalty: Decimal = Decimal("0.35")
    correlation_threshold: float = 0.60
    update_interval_days: int = 7
    unsupported_regime_scale: Decimal = Decimal("0.25")


@dataclass(slots=True)
class SleeveAllocation:
    strategy_key: str
    weight: Decimal
    prev_weight: Decimal
    raw_score: float
    sharpe: float | None
    correlation_penalty: float
    turnover_penalty: float
    regime_multiplier: float
    evidence_trades: int
    capped_by: str | None
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "strategy_key": self.strategy_key,
            "weight": str(self.weight),
            "prev_weight": str(self.prev_weight),
            "raw_score": round(self.raw_score, 6),
            "sharpe": None if self.sharpe is None else round(self.sharpe, 4),
            "correlation_penalty": round(self.correlation_penalty, 4),
            "turnover_penalty": round(self.turnover_penalty, 4),
            "regime_multiplier": round(self.regime_multiplier, 4),
            "evidence_trades": self.evidence_trades,
            "capped_by": self.capped_by,
            "reason": self.reason,
        }


@dataclass(slots=True)
class AllocationResult:
    as_of: datetime
    regime: Regime
    allocations: dict[str, SleeveAllocation]
    updated: bool
    skipped_reason: str | None = None

    def weights(self) -> dict[str, Decimal]:
        return {k: v.weight for k, v in self.allocations.items()}

    def as_dict(self) -> dict[str, Any]:
        return {
            "as_of": self.as_of.isoformat(),
            "regime": self.regime.value,
            "updated": self.updated,
            "skipped_reason": self.skipped_reason,
            "allocations": {k: v.as_dict() for k, v in self.allocations.items()},
        }


# ---------------------------------------------------------------------------
def _annualised_sharpe(returns: np.ndarray) -> float | None:
    if returns.size < 20:
        return None
    sd = float(np.std(returns, ddof=1))
    if sd <= 0:
        return None
    return float(np.mean(returns) / sd * np.sqrt(252))


def _score(perf: SleevePerformance) -> float:
    """Risk-adjusted score in roughly [0, 2]. Deliberately gentle."""
    sharpe = perf.sharpe if perf.sharpe is not None else _annualised_sharpe(perf.daily_returns)
    if sharpe is None:
        # No usable risk-adjusted measure: fall back to a shrunk per-trade mean.
        return float(np.clip(1.0 + perf.avg_return_per_trade * 4, 0.4, 1.6))
    # Map Sharpe -1..2 onto 0.3..1.8, then discount deep drawdowns.
    base = float(np.clip(0.3 + (sharpe + 1.0) / 3.0 * 1.5, 0.2, 1.8))
    dd_discount = float(np.clip(1.0 - abs(perf.max_drawdown) * 0.8, 0.5, 1.0))
    return base * dd_discount


def _correlation_penalties(
    perfs: dict[str, SleevePerformance], threshold: float, strength: Decimal
) -> dict[str, float]:
    """Penalise sleeves that duplicate another sleeve's return stream."""
    keys = [k for k, p in perfs.items() if p.daily_returns.size >= 40]
    penalties = {k: 0.0 for k in perfs}
    if len(keys) < 2:
        return penalties
    n = min(len(perfs[k].daily_returns) for k in keys)
    matrix = np.vstack([perfs[k].daily_returns[-n:] for k in keys])
    keep = np.std(matrix, axis=1) > 0
    keys = [k for k, ok in zip(keys, keep, strict=True) if ok]
    matrix = matrix[keep]
    if len(keys) < 2:
        return penalties
    corr = np.corrcoef(matrix)
    for i, key in enumerate(keys):
        others = [corr[i, j] for j in range(len(keys)) if j != i and np.isfinite(corr[i, j])]
        if not others:
            continue
        excess = max(0.0, float(np.mean([abs(c) for c in others])) - threshold)
        penalties[key] = float(excess * float(strength))
    return penalties


def _capacity_multiplier(strategy: Strategy) -> float:
    """Small haircut for sleeves whose own metadata flags limited capacity."""
    notes = (strategy.meta.capacity_notes or "").lower()
    if "low capacity" in notes or "limited" in notes:
        return 0.75
    if "moderate" in notes:
        return 0.9
    return 1.0


def load_previous_weights(session: Session) -> tuple[dict[str, Decimal], datetime | None]:
    latest = session.scalar(select(EnsembleWeight.as_of).order_by(EnsembleWeight.as_of.desc()).limit(1))
    if latest is None:
        return {}, None
    rows = session.scalars(select(EnsembleWeight).where(EnsembleWeight.as_of == latest))
    return {r.strategy_key: Decimal(str(r.weight)) for r in rows}, latest


def allocate(
    as_of: datetime,
    strategies: list[Strategy],
    performance: dict[str, SleevePerformance],
    regime: Regime,
    *,
    previous_weights: dict[str, Decimal] | None = None,
    last_update: datetime | None = None,
    paused: set[str] | None = None,
    config: AllocationConfig | None = None,
    force: bool = False,
) -> AllocationResult:
    """Compute sleeve weights. Returns the previous weights unchanged if it is
    not yet time for an update — stability is a feature, not an omission."""
    config = config or AllocationConfig()
    previous_weights = dict(previous_weights or {})
    paused = paused or set()

    if (
        not force
        and last_update is not None
        and (as_of - last_update) < timedelta(days=config.update_interval_days)
        and previous_weights
    ):
        allocations = {
            s.meta.key: SleeveAllocation(
                strategy_key=s.meta.key,
                weight=previous_weights.get(s.meta.key, config.neutral_weight),
                prev_weight=previous_weights.get(s.meta.key, config.neutral_weight),
                raw_score=0.0,
                sharpe=performance.get(s.meta.key, SleevePerformance(s.meta.key)).sharpe,
                correlation_penalty=0.0,
                turnover_penalty=0.0,
                regime_multiplier=1.0,
                evidence_trades=performance.get(s.meta.key, SleevePerformance(s.meta.key)).trades,
                capped_by="update_interval",
                reason=(
                    f"weights held: last update {(as_of - last_update).days} days ago, "
                    f"interval is {config.update_interval_days} days"
                ),
            )
            for s in strategies
        }
        return AllocationResult(
            as_of=as_of,
            regime=regime,
            allocations=allocations,
            updated=False,
            skipped_reason="within the stable update interval",
        )

    corr_penalties = _correlation_penalties(
        performance, config.correlation_threshold, config.correlation_penalty
    )

    raw: dict[str, tuple[float, SleeveAllocation]] = {}
    for strategy in strategies:
        key = strategy.meta.key
        perf = performance.get(key, SleevePerformance(key))
        prev = previous_weights.get(key, config.neutral_weight)
        reasons: list[str] = []
        capped_by: str | None = None

        if key in paused:
            raw[key] = (
                0.0,
                SleeveAllocation(
                    key, Decimal("0"), prev, 0.0, perf.sharpe, 0.0, 0.0, 0.0, perf.trades,
                    "paused", "strategy is paused; weight forced to zero",
                ),
            )
            continue

        enough_evidence = perf.trades >= config.min_trades or perf.days_live >= config.min_days
        if not enough_evidence:
            score = 1.0
            capped_by = "insufficient_evidence"
            reasons.append(
                f"only {perf.trades} trades and {perf.days_live} days of history "
                f"(need {config.min_trades} trades or {config.min_days} days) — "
                "held at the neutral score rather than ranked on noise"
            )
        else:
            score = _score(perf)
            reasons.append(
                f"risk-adjusted score {score:.2f}"
                + (f" from Sharpe {perf.sharpe:.2f}" if perf.sharpe is not None else "")
                + f" over {perf.trades} trades"
            )

        corr_pen = corr_penalties.get(key, 0.0)
        if corr_pen > 0:
            reasons.append(f"correlation penalty {corr_pen:.2f} for duplicating other sleeves")

        regime_mult = 1.0
        if not strategy.supports_regime(regime):
            regime_mult = float(config.unsupported_regime_scale)
            reasons.append(f"does not support the {regime.value} regime — scaled to {regime_mult:.0%}")

        capacity = _capacity_multiplier(strategy)
        if capacity < 1.0:
            reasons.append(f"capacity haircut {capacity:.0%} per its own capacity notes")

        adjusted = max(0.0, score * (1.0 - corr_pen)) * regime_mult * capacity
        raw[key] = (
            adjusted,
            SleeveAllocation(
                key, Decimal("0"), prev, adjusted, perf.sharpe, corr_pen, 0.0,
                regime_mult, perf.trades, capped_by, "; ".join(reasons),
            ),
        )

    total = sum(v for v, _ in raw.values())
    if total <= 0:
        # Everything paused or scored zero: equal-weight the unpaused sleeves.
        active = [s.meta.key for s in strategies if s.meta.key not in paused]
        equal = D(1) / D(max(1, len(active)))
        for key, (_, alloc) in raw.items():
            alloc.weight = equal if key in active else Decimal("0")
            alloc.reason = (alloc.reason + "; all scores zero, falling back to equal weight").strip("; ")
        return AllocationResult(as_of, regime, {k: a for k, (_, a) in raw.items()}, updated=True)

    # Normalise, apply turnover penalty and the per-update step limit.
    for key, (value, alloc) in raw.items():
        target = D(value / total)
        prev = alloc.prev_weight
        # Turnover penalty: pull the target back toward the previous weight.
        damped = target - (target - prev) * config.turnover_penalty
        turnover_pen = float(abs(target - damped))
        step = damped - prev
        if abs(step) > config.max_step:
            damped = prev + (config.max_step if step > 0 else -config.max_step)
            alloc.capped_by = alloc.capped_by or "max_step"
            alloc.reason += f"; move limited to {config.max_step} per update"
        clamped = max(config.min_weight, min(config.max_weight, damped))
        if clamped != damped:
            alloc.capped_by = alloc.capped_by or ("max_weight" if damped > clamped else "min_weight")
            alloc.reason += f"; clamped to the [{config.min_weight}, {config.max_weight}] band"
        alloc.weight = clamped
        alloc.turnover_penalty = turnover_pen

    # Renormalise after clamping so the weights sum to 1.
    final_total = sum(a.weight for _, a in raw.values())
    if final_total > 0:
        for _, alloc in raw.values():
            alloc.weight = (alloc.weight / final_total).quantize(Decimal("0.000001"))

    return AllocationResult(as_of, regime, {k: a for k, (_, a) in raw.items()}, updated=True)


def persist(session: Session, result: AllocationResult) -> int:
    """Write the allocation and mirror the weights onto the strategy rows."""
    written = 0
    for alloc in result.allocations.values():
        session.add(
            EnsembleWeight(
                as_of=result.as_of,
                strategy_key=alloc.strategy_key,
                weight=alloc.weight,
                prev_weight=alloc.prev_weight,
                raw_score=D(alloc.raw_score),
                sharpe=None if alloc.sharpe is None else D(alloc.sharpe),
                correlation_penalty=D(alloc.correlation_penalty),
                turnover_penalty=D(alloc.turnover_penalty),
                regime_multiplier=D(alloc.regime_multiplier),
                evidence_trades=alloc.evidence_trades,
                capped_by=alloc.capped_by,
                reason=alloc.reason,
            )
        )
        row = session.scalar(select(StrategyRow).where(StrategyRow.key == alloc.strategy_key))
        if row is not None:
            row.target_weight = alloc.weight
        written += 1
    session.flush()
    return written


def paused_strategies(session: Session) -> set[str]:
    rows = session.scalars(
        select(StrategyRow).where(
            (StrategyRow.enabled.is_(False))
            | (StrategyRow.status.in_([StrategyStatus.PAUSED, StrategyStatus.QUARANTINED, StrategyStatus.RETIRED]))
        )
    )
    return {r.key for r in rows}
