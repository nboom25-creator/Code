"""Strategy interface.

Every strategy declares its contract up front — required data, universe rules,
entry and exit criteria, sizing method, expected holding period, risk
assumptions, invalidating conditions and supported regimes — and implements two
methods:

``generate``
    Propose entries from the current cross-section.
``review``
    Re-examine an open position and say whether to hold, add, trim or exit.

A strategy is a **research opinion**, not an order. It never sizes in dollars,
never touches the broker, and its output always passes through portfolio
construction and then the deterministic risk engine.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from aegisquant.db.enums import Regime
from aegisquant.features.engine import FeatureBundle, SymbolFeatures
from aegisquant.features.market_view import PointInTime

Direction = Literal["long", "short", "flat"]
SizingMethod = Literal[
    "volatility_target",
    "fixed_fractional",
    "conviction_weighted",
    "risk_parity",
    "fractional_kelly",
    "equal_weight",
]
ReviewAction = Literal["hold", "add", "trim", "exit"]


@dataclass(frozen=True, slots=True)
class StrategyMeta:
    """Static, self-documenting contract for a strategy."""

    key: str
    name: str
    family: str
    description: str
    required_features: tuple[str, ...]
    required_data: tuple[str, ...]
    universe_rules: tuple[str, ...]
    entry_criteria: tuple[str, ...]
    exit_criteria: tuple[str, ...]
    sizing_method: SizingMethod
    expected_holding_days: int
    risk_assumptions: tuple[str, ...]
    invalidating_conditions: tuple[str, ...]
    supported_regimes: tuple[Regime, ...]
    min_history_bars: int = 260
    max_positions: int = 8
    allows_short: bool = False
    version: str = "1.0.0"
    capacity_notes: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "family": self.family,
            "description": self.description,
            "required_features": list(self.required_features),
            "required_data": list(self.required_data),
            "universe_rules": list(self.universe_rules),
            "entry_criteria": list(self.entry_criteria),
            "exit_criteria": list(self.exit_criteria),
            "sizing_method": self.sizing_method,
            "expected_holding_days": self.expected_holding_days,
            "risk_assumptions": list(self.risk_assumptions),
            "invalidating_conditions": list(self.invalidating_conditions),
            "supported_regimes": [r.value for r in self.supported_regimes],
            "min_history_bars": self.min_history_bars,
            "max_positions": self.max_positions,
            "allows_short": self.allows_short,
            "version": self.version,
            "capacity_notes": self.capacity_notes,
        }


@dataclass(slots=True)
class StrategySignal:
    """A proposed entry. Sizing and execution are decided elsewhere."""

    strategy_key: str
    symbol: str
    direction: Direction
    strength: float  # 0..1, the strategy's own cross-sectional ranking
    confidence: float  # 0..1, calibrated belief the thesis plays out
    as_of: datetime
    expected_return: float | None = None
    expected_return_low: float | None = None
    expected_return_high: float | None = None
    expected_vol: float | None = None
    downside_estimate: float | None = None
    expected_holding_days: int = 60
    thesis: str = ""
    supporting_evidence: list[str] = field(default_factory=list)
    opposing_evidence: list[str] = field(default_factory=list)
    exit_criteria: dict[str, Any] = field(default_factory=dict)
    invalidating_conditions: list[str] = field(default_factory=list)
    signal_inputs: dict[str, float | None] = field(default_factory=dict)
    stop_hint_pct: float | None = None
    trailing_stop_pct: float | None = None
    model_version: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "strategy_key": self.strategy_key,
            "symbol": self.symbol,
            "direction": self.direction,
            "strength": round(self.strength, 6),
            "confidence": round(self.confidence, 6),
            "as_of": self.as_of.isoformat(),
            "expected_return": self.expected_return,
            "expected_return_low": self.expected_return_low,
            "expected_return_high": self.expected_return_high,
            "expected_vol": self.expected_vol,
            "downside_estimate": self.downside_estimate,
            "expected_holding_days": self.expected_holding_days,
            "thesis": self.thesis,
            "supporting_evidence": self.supporting_evidence,
            "opposing_evidence": self.opposing_evidence,
            "exit_criteria": self.exit_criteria,
            "invalidating_conditions": self.invalidating_conditions,
            "signal_inputs": self.signal_inputs,
            "stop_hint_pct": self.stop_hint_pct,
            "trailing_stop_pct": self.trailing_stop_pct,
            "model_version": self.model_version,
        }


@dataclass(slots=True)
class PositionReview:
    """The verdict on an existing position."""

    strategy_key: str
    symbol: str
    action: ReviewAction
    confidence: float
    reason: str
    thesis_status: Literal["intact", "weakening", "invalidated"] = "intact"
    target_fraction: float = 1.0  # of the current position to retain
    evidence: list[str] = field(default_factory=list)
    signal_inputs: dict[str, float | None] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "strategy_key": self.strategy_key,
            "symbol": self.symbol,
            "action": self.action,
            "confidence": round(self.confidence, 6),
            "reason": self.reason,
            "thesis_status": self.thesis_status,
            "target_fraction": self.target_fraction,
            "evidence": self.evidence,
            "signal_inputs": self.signal_inputs,
        }


@dataclass(slots=True)
class OpenPositionState:
    """What a strategy is allowed to know about a position it is reviewing."""

    symbol: str
    quantity: float
    avg_entry_price: float
    last_price: float
    unrealized_pnl_pct: float
    holding_days: int
    peak_price: float
    weight: float  # of portfolio equity
    strategy_key: str | None = None
    entry_thesis: str | None = None
    exit_criteria: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class StrategyContext:
    """Everything a strategy may read for one evaluation."""

    as_of: datetime
    pit: PointInTime
    features: FeatureBundle
    regime: Regime
    regime_score: float
    positions: dict[str, OpenPositionState] = field(default_factory=dict)
    equity: float = 0.0
    cash: float = 0.0
    params: dict[str, Any] = field(default_factory=dict)

    def f(self, symbol: str) -> SymbolFeatures | None:
        return self.features.symbols.get(symbol.upper())

    def value(self, symbol: str, feature: str) -> float | None:
        sf = self.f(symbol)
        return None if sf is None else sf.get(feature)

    def market(self, feature: str) -> float | None:
        return self.features.market.get(feature)

    def candidates(self) -> list[str]:
        return sorted(self.features.symbols)


class Strategy(abc.ABC):
    """Base class. Subclasses declare :attr:`meta` and implement ``generate``."""

    meta: StrategyMeta
    #: Default parameters; overridden per run so the Strategy Lab can sweep them.
    default_params: dict[str, Any] = {}

    def __init__(self, params: dict[str, Any] | None = None) -> None:
        self.params = {**self.default_params, **(params or {})}

    # -- required ------------------------------------------------------------
    @abc.abstractmethod
    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        """Propose new entries. Returning an empty list is a valid outcome."""

    # -- optional ------------------------------------------------------------
    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        """Default review: exit when the trend that justified entry is gone.

        Deliberately conservative and shared by every strategy that does not
        override it, so no position is ever left unmanaged.
        """
        trend = ctx.value(position.symbol, "trend_63")
        rel = ctx.value(position.symbol, "rel_strength_126")
        inputs = {"trend_63": trend, "rel_strength_126": rel}

        if trend is not None and trend < -0.08:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.7,
                f"price is {trend:.1%} below its 63-day average — the entry trend has broken",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if rel is not None and rel < -0.12:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "trim",
                0.55,
                f"relative strength has decayed to {rel:.1%} versus the benchmark",
                thesis_status="weakening",
                target_fraction=0.5,
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key,
            position.symbol,
            "hold",
            0.5,
            "thesis intact; no exit or invalidation condition met",
            signal_inputs=inputs,
        )

    # -- helpers -------------------------------------------------------------
    def supports_regime(self, regime: Regime) -> bool:
        return regime in self.meta.supported_regimes

    def eligible(self, ctx: StrategyContext, symbol: str) -> tuple[bool, str | None]:
        """Universe gate shared by every strategy."""
        sf = ctx.f(symbol)
        if sf is None:
            return False, "no features computed"
        if sf.growth and sf.growth.disqualifiers:
            return False, sf.growth.disqualifiers[0]
        if not ctx.pit.has(symbol, min_bars=self.meta.min_history_bars):
            return False, f"fewer than {self.meta.min_history_bars} bars of history"
        instrument = ctx.pit.instrument(symbol)
        if instrument.get("is_leveraged_etf"):
            return False, "leveraged/inverse ETF (disabled in v1)"
        if instrument.get("tradable") is False:
            return False, "not tradable"
        for feature in self.meta.required_features:
            if sf.get(feature) is None:
                return False, f"required feature '{feature}' unavailable"
        return True, None

    @staticmethod
    def _clip01(value: float) -> float:
        return max(0.0, min(1.0, value))

    def _confidence_from(self, *parts: float | None, floor: float = 0.30, cap: float = 0.92) -> float:
        """Blend evidence into a calibrated confidence.

        Capped below 1.0 on purpose: no signal set justifies certainty, and the
        cap keeps fractional-Kelly sizing away from its blow-up region.
        """
        vals = [self._clip01(p) for p in parts if p is not None]
        if not vals:
            return floor
        avg = sum(vals) / len(vals)
        # More independent confirmations -> modest bonus, never above `cap`.
        bonus = min(0.08, 0.02 * (len(vals) - 1))
        return max(floor, min(cap, avg + bonus))

    def _expected_return_band(self, point: float, vol: float | None, holding_days: int) -> tuple[float, float, float]:
        """A one-sigma band around the point estimate over the holding period."""
        if vol is None or vol <= 0:
            return point, point * 0.2, point * 1.8
        horizon_vol = vol * (holding_days / 252.0) ** 0.5
        return point, point - horizon_vol, point + horizon_vol

    def describe(self) -> dict[str, Any]:
        return {**self.meta.as_dict(), "params": self.params}
