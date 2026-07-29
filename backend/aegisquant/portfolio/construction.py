"""Portfolio construction.

Turns a set of strategy signals into target positions:

1. **Aggregate** signals per symbol. Multiple sleeves liking the same name is
   genuine corroboration, so confidence is combined — but sub-additively, because
   two correlated momentum sleeves are not two independent opinions.
2. **Rank** by combined conviction and the Growth Opportunity Score.
3. **Size** each candidate (:mod:`aegisquant.portfolio.sizing`).
4. **Concentrate deliberately**: the strongest ideas get the capital, bounded by
   the position, sector and correlation limits.
5. **Reserve cash** according to regime and drawdown state.

The output is a *target*, not an order. The risk engine still has final say, and
the order-management layer decides how to get there.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

import numpy as np

from aegisquant.config import RiskLimits
from aegisquant.db.enums import Regime
from aegisquant.features.engine import FeatureBundle
from aegisquant.features.market_view import PointInTime
from aegisquant.portfolio.sizing import (
    SizingResult,
    dynamic_cash_target,
    pyramid_increment,
    size_position,
)
from aegisquant.strategies.base import OpenPositionState, StrategySignal
from aegisquant.utils.money import D, ZERO


@dataclass(slots=True)
class TargetPosition:
    symbol: str
    target_weight: Decimal
    current_weight: Decimal
    delta_weight: Decimal
    direction: str
    confidence: Decimal
    strategies: list[str]
    primary_strategy: str
    sizing: SizingResult
    expected_return: Decimal | None = None
    expected_vol: Decimal | None = None
    downside: Decimal | None = None
    expected_holding_days: int = 60
    growth_score: Decimal | None = None
    sector: str | None = None
    thesis: str = ""
    supporting_evidence: list[str] = field(default_factory=list)
    opposing_evidence: list[str] = field(default_factory=list)
    exit_criteria: dict[str, Any] = field(default_factory=dict)
    invalidating_conditions: list[str] = field(default_factory=list)
    signal_inputs: dict[str, float | None] = field(default_factory=dict)
    stop_hint_pct: Decimal | None = None
    trailing_stop_pct: Decimal | None = None
    risk_contribution: Decimal | None = None
    correlation_to_book: Decimal | None = None
    action: str = "open"  # open | add | trim | exit | hold
    reason: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "target_weight": str(self.target_weight),
            "current_weight": str(self.current_weight),
            "delta_weight": str(self.delta_weight),
            "direction": self.direction,
            "confidence": str(self.confidence),
            "strategies": self.strategies,
            "primary_strategy": self.primary_strategy,
            "sizing": self.sizing.as_dict(),
            "expected_return": None if self.expected_return is None else str(self.expected_return),
            "expected_vol": None if self.expected_vol is None else str(self.expected_vol),
            "downside": None if self.downside is None else str(self.downside),
            "expected_holding_days": self.expected_holding_days,
            "growth_score": None if self.growth_score is None else str(self.growth_score),
            "sector": self.sector,
            "thesis": self.thesis,
            "supporting_evidence": self.supporting_evidence,
            "opposing_evidence": self.opposing_evidence,
            "exit_criteria": self.exit_criteria,
            "invalidating_conditions": self.invalidating_conditions,
            "risk_contribution": None if self.risk_contribution is None else str(self.risk_contribution),
            "correlation_to_book": (
                None if self.correlation_to_book is None else str(self.correlation_to_book)
            ),
            "action": self.action,
            "reason": self.reason,
        }


@dataclass(slots=True)
class PortfolioTarget:
    as_of: datetime
    regime: Regime
    targets: list[TargetPosition]
    cash_target: Decimal
    cash_reason: str
    rejected: dict[str, str] = field(default_factory=dict)
    gross_target: Decimal = ZERO
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "as_of": self.as_of.isoformat(),
            "regime": self.regime.value,
            "cash_target": str(self.cash_target),
            "cash_reason": self.cash_reason,
            "gross_target": str(self.gross_target),
            "targets": [t.as_dict() for t in self.targets],
            "rejected": self.rejected,
            "notes": self.notes,
        }


# ---------------------------------------------------------------------------
def combine_confidence(confidences: list[Decimal]) -> Decimal:
    """Sub-additive combination of independent opinions.

    Two sleeves at 0.6 give roughly 0.68, not 1.2. Corroboration should raise
    confidence, but never to certainty and never linearly, because the sleeves
    share features and are not truly independent.
    """
    if not confidences:
        return ZERO
    best = max(confidences)
    if len(confidences) == 1:
        return best
    residual = Decimal(1) - best
    bonus = residual * Decimal("0.35") * min(Decimal(1), D(len(confidences) - 1) / Decimal(3))
    return min(Decimal("0.95"), best + bonus)


def _avg_correlation_to_book(
    pit: PointInTime, symbol: str, book: list[str], window: int = 63
) -> Decimal | None:
    """Mean absolute return correlation between ``symbol`` and the current book."""
    peers = [s for s in book if s != symbol]
    if not peers:
        return None
    own = pit.closes(symbol, window + 1)
    if own.size < 30:
        return None
    own_ret = np.diff(np.log(own)) if np.all(own > 0) else None
    if own_ret is None or own_ret.size < 25:
        return None
    corrs: list[float] = []
    for peer in peers:
        other = pit.closes(peer, window + 1)
        if other.size < 30 or not np.all(other > 0):
            continue
        other_ret = np.diff(np.log(other))
        n = min(own_ret.size, other_ret.size)
        if n < 25:
            continue
        a, b = own_ret[-n:], other_ret[-n:]
        if float(np.std(a)) == 0 or float(np.std(b)) == 0:
            continue
        c = float(np.corrcoef(a, b)[0, 1])
        if np.isfinite(c):
            corrs.append(abs(c))
    if not corrs:
        return None
    return D(round(float(np.mean(corrs)), 6))


def _risk_contribution(weight: Decimal, asset_vol: Decimal | None, portfolio_vol: Decimal) -> Decimal | None:
    if asset_vol is None or portfolio_vol <= 0:
        return None
    return ((weight * asset_vol) / portfolio_vol).quantize(Decimal("0.000001"))


def construct_portfolio(
    *,
    as_of: datetime,
    pit: PointInTime,
    features: FeatureBundle,
    signals: list[StrategySignal],
    positions: dict[str, OpenPositionState],
    limits: RiskLimits,
    regime: Regime,
    regime_scale: Decimal,
    concentration_scale: Decimal,
    min_confidence: Decimal,
    strategy_weights: dict[str, Decimal] | None = None,
    sizing_methods: dict[str, str] | None = None,
    current_drawdown: Decimal = ZERO,
    max_new_positions: int | None = None,
) -> PortfolioTarget:
    """Build the target portfolio from strategy signals and current holdings."""
    strategy_weights = strategy_weights or {}
    sizing_methods = sizing_methods or {}
    rejected: dict[str, str] = {}
    notes: list[str] = []

    # --- 1. aggregate by symbol ---
    grouped: dict[str, list[StrategySignal]] = {}
    for sig in signals:
        if sig.direction != "long":
            rejected[sig.symbol] = "only long positions are enabled in version 1"
            continue
        grouped.setdefault(sig.symbol.upper(), []).append(sig)

    cash_target, cash_reason = dynamic_cash_target(
        regime_scale, limits.min_cash_buffer_pct, current_drawdown
    )
    book = list(positions)

    candidates: list[TargetPosition] = []
    for symbol, sigs in grouped.items():
        confidences = [D(s.confidence) for s in sigs]
        combined = combine_confidence(confidences)
        if combined < min_confidence:
            rejected[symbol] = (
                f"combined confidence {combined:.2f} is below the {min_confidence} bar "
                f"required in the {regime.value} regime"
            )
            continue

        sf = features.symbols.get(symbol)
        if sf is None:
            rejected[symbol] = "no feature snapshot available"
            continue
        if sf.growth and sf.growth.disqualifiers:
            rejected[symbol] = sf.growth.disqualifiers[0]
            continue

        primary = max(sigs, key=lambda s: (s.confidence, s.strength))
        asset_vol = sf.get("realized_vol_63") or sf.get("realized_vol_21")
        expected_returns = [s.expected_return for s in sigs if s.expected_return is not None]
        downsides = [s.downside_estimate for s in sigs if s.downside_estimate is not None]
        stop_hints = [s.stop_hint_pct for s in sigs if s.stop_hint_pct is not None]
        trailing = [s.trailing_stop_pct for s in sigs if s.trailing_stop_pct is not None]

        corr = _avg_correlation_to_book(pit, symbol, book)
        method = sizing_methods.get(primary.strategy_key, "conviction_weighted")
        sleeve_weight = strategy_weights.get(primary.strategy_key, Decimal("0.08"))

        sizing = size_position(
            method=method,
            limits=limits,
            confidence=combined,
            asset_vol=None if asset_vol is None else D(asset_vol),
            expected_return=D(float(np.mean(expected_returns))) if expected_returns else None,
            downside=D(float(np.mean(downsides))) if downsides else None,
            stop_distance=D(min(stop_hints)) if stop_hints else None,
            avg_correlation_to_book=corr,
            regime_scale=regime_scale,
            concentration_scale=concentration_scale,
            strategy_weight=sleeve_weight,
        )
        if sizing.weight <= 0:
            rejected[symbol] = f"sizing produced a zero weight ({sizing.binding_constraint})"
            continue

        current = positions.get(symbol)
        current_weight = D(current.weight) if current else ZERO
        action = "open"
        reason = ""
        target_weight = sizing.weight

        if current is not None:
            increment, pyr_reason = pyramid_increment(
                current_weight, sizing.weight, D(current.unrealized_pnl_pct)
            )
            if increment > 0:
                action, target_weight, reason = "add", current_weight + increment, pyr_reason
            else:
                action, target_weight, reason = "hold", current_weight, pyr_reason

        candidates.append(
            TargetPosition(
                symbol=symbol,
                target_weight=target_weight,
                current_weight=current_weight,
                delta_weight=target_weight - current_weight,
                direction="long",
                confidence=combined,
                strategies=sorted({s.strategy_key for s in sigs}),
                primary_strategy=primary.strategy_key,
                sizing=sizing,
                expected_return=D(float(np.mean(expected_returns))) if expected_returns else None,
                expected_vol=None if asset_vol is None else D(asset_vol),
                downside=D(float(np.mean(downsides))) if downsides else None,
                expected_holding_days=int(np.mean([s.expected_holding_days for s in sigs])),
                growth_score=D(sf.get("growth_opportunity_score")) if sf.get("growth_opportunity_score") is not None else None,
                sector=pit.sector(symbol),
                thesis=primary.thesis,
                supporting_evidence=sorted({e for s in sigs for e in s.supporting_evidence}),
                opposing_evidence=sorted({e for s in sigs for e in s.opposing_evidence}),
                exit_criteria={k: v for s in sigs for k, v in s.exit_criteria.items()},
                invalidating_conditions=sorted({c for s in sigs for c in s.invalidating_conditions}),
                signal_inputs=primary.signal_inputs,
                stop_hint_pct=D(min(stop_hints)) if stop_hints else None,
                trailing_stop_pct=D(min(trailing)) if trailing else None,
                correlation_to_book=corr,
                action=action,
                reason=reason,
            )
        )

    # --- 2. rank: conviction first, growth score as the tiebreak ---
    def rank_key(t: TargetPosition) -> tuple[float, float, float]:
        return (
            float(t.confidence),
            float(t.growth_score or 0),
            float(len(t.strategies)),
        )

    candidates.sort(key=rank_key, reverse=True)

    # --- 3. apply portfolio-level budgets ---
    investable = Decimal(1) - cash_target
    max_positions = limits.max_open_positions
    sector_used: dict[str, Decimal] = {}
    for sym, pos in positions.items():
        sector_used[pit.sector(sym)] = sector_used.get(pit.sector(sym), ZERO) + D(pos.weight)

    accepted: list[TargetPosition] = []
    gross = sum((D(p.weight) for p in positions.values()), ZERO)
    new_count = 0

    for target in candidates:
        if target.action == "hold":
            accepted.append(target)
            continue
        if len(positions) + new_count >= max_positions and target.symbol not in positions:
            rejected[target.symbol] = (
                f"position count limit reached ({max_positions} open positions)"
            )
            continue
        if max_new_positions is not None and new_count >= max_new_positions and target.symbol not in positions:
            rejected[target.symbol] = f"new-position budget for this cycle exhausted ({max_new_positions})"
            continue

        delta = target.delta_weight
        if delta <= 0:
            accepted.append(target)
            continue

        # Gross-exposure / cash budget.
        headroom = investable - gross
        if headroom <= 0:
            rejected[target.symbol] = (
                f"no investable headroom: gross {gross:.1%} against a {investable:.1%} budget "
                f"(cash target {cash_target:.1%})"
            )
            continue
        if delta > headroom:
            target.target_weight = target.current_weight + headroom
            target.delta_weight = headroom
            target.reason = (
                (target.reason + "; " if target.reason else "")
                + f"reduced to the remaining {headroom:.2%} investable headroom"
            )
            delta = headroom

        # Sector budget.
        sector = target.sector or "Unclassified"
        used = sector_used.get(sector, ZERO)
        sector_headroom = limits.max_sector_exposure_pct - used
        if sector_headroom <= 0:
            rejected[target.symbol] = (
                f"{sector} sector is at its {limits.max_sector_exposure_pct:.0%} limit "
                f"(currently {used:.1%})"
            )
            continue
        if delta > sector_headroom:
            target.target_weight = target.current_weight + sector_headroom
            target.delta_weight = sector_headroom
            target.reason = (
                (target.reason + "; " if target.reason else "")
                + f"reduced to the {sector_headroom:.2%} remaining {sector} sector headroom"
            )
            delta = sector_headroom

        if delta <= 0:
            rejected[target.symbol] = "no headroom left after portfolio budgets"
            continue

        sector_used[sector] = used + delta
        gross += delta
        if target.symbol not in positions:
            new_count += 1
        accepted.append(target)

    # --- 4. risk contributions ---
    portfolio_vol = ZERO
    vols = [(t.target_weight, t.expected_vol) for t in accepted if t.expected_vol]
    if vols:
        # Simple sum-of-parts with an assumed average correlation; the exact
        # covariance calculation lives in the risk engine's correlation check.
        assumed_corr = Decimal("0.5")
        var = sum((w * v) ** 2 for w, v in vols)
        cross = sum(
            w1 * v1 * w2 * v2 * assumed_corr
            for i, (w1, v1) in enumerate(vols)
            for (w2, v2) in vols[i + 1 :]
        )
        portfolio_vol = D(float((var + 2 * cross)) ** 0.5)
    for target in accepted:
        target.risk_contribution = _risk_contribution(
            target.target_weight, target.expected_vol, portfolio_vol
        )

    if not accepted and grouped:
        notes.append(
            f"{len(grouped)} candidate(s) were generated but none survived portfolio construction"
        )
    if regime_scale == 0:
        notes.append(
            "risk-off regime: new entries are blocked entirely; existing positions are still managed"
        )

    return PortfolioTarget(
        as_of=as_of,
        regime=regime,
        targets=accepted,
        cash_target=cash_target,
        cash_reason=cash_reason,
        rejected=rejected,
        gross_target=gross,
        notes=notes,
    )
