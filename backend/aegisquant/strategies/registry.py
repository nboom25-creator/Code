"""Strategy registry — the complete inventory of tradable strategies."""

from __future__ import annotations

from typing import Any

from aegisquant.strategies.base import Strategy
from aegisquant.strategies.growth import (
    EarningsAcceleration,
    GrowthAtReasonablePrice,
    PostEarningsDrift,
    QualityGrowthCompounder,
    SmallMidGrowthDiscovery,
)
from aegisquant.strategies.momentum import (
    BreakoutFromConsolidation,
    CrossSectionalMomentum,
    SectorLeadership,
    TimeSeriesMomentum,
)
from aegisquant.strategies.tactical import (
    RegimeGrowthAllocation,
    ShortTermMeanReversion,
    VolatilityTargetCore,
)

STRATEGY_CLASSES: tuple[type[Strategy], ...] = (
    CrossSectionalMomentum,
    TimeSeriesMomentum,
    BreakoutFromConsolidation,
    SectorLeadership,
    QualityGrowthCompounder,
    GrowthAtReasonablePrice,
    EarningsAcceleration,
    PostEarningsDrift,
    SmallMidGrowthDiscovery,
    ShortTermMeanReversion,
    VolatilityTargetCore,
    RegimeGrowthAllocation,
)

ALL_STRATEGIES: dict[str, type[Strategy]] = {cls.meta.key: cls for cls in STRATEGY_CLASSES}


def strategy_keys() -> list[str]:
    return sorted(ALL_STRATEGIES)


def get_strategy(key: str, params: dict[str, Any] | None = None) -> Strategy:
    try:
        cls = ALL_STRATEGIES[key]
    except KeyError:
        raise KeyError(f"unknown strategy '{key}'; known: {', '.join(strategy_keys())}") from None
    return cls(params)


def build_all(params_by_key: dict[str, dict[str, Any]] | None = None) -> list[Strategy]:
    params_by_key = params_by_key or {}
    return [cls(params_by_key.get(key)) for key, cls in sorted(ALL_STRATEGIES.items())]


def describe_all() -> list[dict[str, Any]]:
    return [cls.meta.as_dict() | {"default_params": cls.default_params} for cls in STRATEGY_CLASSES]
