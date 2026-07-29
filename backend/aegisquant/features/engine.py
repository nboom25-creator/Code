"""The feature engine.

Computes every registered feature for a set of symbols at one point in time,
range-checks each value against its registry definition, adds cross-sectional
ranks, and (optionally) persists the snapshot.

Two invariants:

* A feature that cannot be computed is **absent**, and listed in ``missing``.
  Downstream code must handle absence; nothing is silently zero-filled.
* Market-level features are computed once per ``as_of`` and shared, so every
  symbol in a cycle sees exactly the same macro and breadth picture.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.db.enums import DataQuality
from aegisquant.db.models import FeatureSnapshot
from aegisquant.features import fundamentals as FU
from aegisquant.features import macro as MA
from aegisquant.features import market_structure as MS
from aegisquant.features import news_features as NF
from aegisquant.features.growth_score import GrowthScore, compute_growth_score
from aegisquant.features.market_view import MarketView, PointInTime
from aegisquant.features.registry import REGISTRY, registry_version
from aegisquant.logging_setup import get_logger
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)

#: Features that are ranked cross-sectionally. Rank is percentile in [0, 1].
RANKED_FEATURES = (
    "rel_strength_63",
    "rel_strength_126",
    "rel_strength_252",
    "momentum_12_1",
    "vol_adj_momentum_126",
    "revenue_growth_yoy",
    "revenue_growth_accel",
    "eps_growth_accel",
    "fundamental_momentum",
    "roic",
    "gross_margin",
    "growth_adjusted_ps",
    "trend_quality_126",
    "accumulation_20",
    "adv_usd_20",
    "growth_opportunity_score",
)


@dataclass(slots=True)
class SymbolFeatures:
    symbol: str
    as_of: datetime
    values: dict[str, float] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    out_of_range: dict[str, str] = field(default_factory=dict)
    growth: GrowthScore | None = None
    data_quality: DataQuality = DataQuality.OK
    is_synthetic: bool = False

    def get(self, name: str, default: float | None = None) -> float | None:
        return self.values.get(name, default)

    def as_dict(self) -> dict[str, float | None]:
        return dict(self.values)


@dataclass(slots=True)
class FeatureBundle:
    as_of: datetime
    registry_version: str
    market: dict[str, float] = field(default_factory=dict)
    market_missing: list[str] = field(default_factory=list)
    symbols: dict[str, SymbolFeatures] = field(default_factory=dict)
    universe_synthetic: bool = False

    def ranked(self, feature: str, descending: bool = True) -> list[tuple[str, float]]:
        pairs = [
            (s, f.values[feature]) for s, f in self.symbols.items() if feature in f.values
        ]
        return sorted(pairs, key=lambda kv: kv[1], reverse=descending)

    def as_dict(self) -> dict[str, Any]:
        return {
            "as_of": self.as_of.isoformat(),
            "registry_version": self.registry_version,
            "market": self.market,
            "market_missing": self.market_missing,
            "symbol_count": len(self.symbols),
            "universe_synthetic": self.universe_synthetic,
        }


# ---------------------------------------------------------------------------
def _record(
    target: dict[str, float],
    missing: list[str],
    out_of_range: dict[str, str],
    name: str,
    raw: float | None,
) -> None:
    definition = REGISTRY.features.get(name)
    if definition is None:  # not registered -> not usable
        return
    value, problem = definition.validate(raw)
    if value is None:
        missing.append(name)
        return
    target[name] = float(value)
    if problem:
        out_of_range[name] = problem


def compute_market_features(pit: PointInTime) -> tuple[dict[str, float], list[str]]:
    values: dict[str, float] = {}
    missing: list[str] = []
    oor: dict[str, str] = {}
    for name, fn in {**MS.MARKET_FEATURES, **MA.MARKET_FEATURES}.items():
        try:
            raw = fn(pit)
        except Exception as exc:  # a broken feature must not kill the cycle
            log.warning("market_feature_failed", feature=name, error=str(exc))
            raw = None
        _record(values, missing, oor, name, raw)
    # risk_on_score depends on breadth, so recompute it after breadth exists.
    if "risk_on_score" not in values:
        try:
            _record(values, missing, oor, "risk_on_score", MA.risk_on_score(pit))
        except Exception:  # pragma: no cover
            pass
    return values, sorted(set(missing))


def compute_symbol_features(
    pit: PointInTime,
    symbol: str,
    *,
    market: dict[str, float] | None = None,
    min_price: float = 5.0,
    min_adv_usd: float = 5_000_000.0,
    spread_bps: float | None = None,
) -> SymbolFeatures:
    symbol = symbol.upper()
    out = SymbolFeatures(symbol=symbol, as_of=pit.as_of)
    out.is_synthetic = pit.is_synthetic(symbol)

    all_fns = {**MS.SYMBOL_FEATURES, **FU.SYMBOL_FEATURES, **NF.SYMBOL_FEATURES}
    for name, fn in all_fns.items():
        try:
            raw = fn(pit, symbol)
        except Exception as exc:
            log.warning("feature_failed", feature=name, symbol=symbol, error=str(exc))
            raw = None
        _record(out.values, out.missing, out.out_of_range, name, raw)

    # Context the score needs that is not itself a registered feature.
    score_inputs: dict[str, float | None] = dict(out.values)
    score_inputs["last_price"] = pit.last_close(symbol)
    score_inputs["spread_bps"] = spread_bps
    if market:
        score_inputs.update({f"market_{k}": v for k, v in market.items()})

    out.growth = compute_growth_score(
        symbol,
        score_inputs,
        instrument=pit.instrument(symbol),
        min_price=min_price,
        min_adv_usd=min_adv_usd,
    )
    if out.growth.total is not None:
        _record(out.values, out.missing, out.out_of_range, "growth_opportunity_score", out.growth.total)
    for key, comp in out.growth.components.items():
        _record(out.values, out.missing, out.out_of_range, f"growth_{_short(key)}", comp.score)

    if not pit.quality_ok(symbol, n=20):
        out.data_quality = DataQuality.SUSPECT
    if out.is_synthetic:
        out.data_quality = DataQuality.SYNTHETIC
    return out


def _short(component_key: str) -> str:
    return {
        "fundamental_acceleration": "fundamental_acceleration",
        "price_strength": "price_strength",
        "durability": "durability",
        "catalyst": "catalyst",
        "risk_valuation": "risk_valuation",
    }[component_key]


def add_cross_sectional_ranks(bundle: FeatureBundle) -> None:
    """Add ``<feature>_rank`` percentiles across the evaluated universe."""
    for feature in RANKED_FEATURES:
        pairs = [(s, f.values[feature]) for s, f in bundle.symbols.items() if feature in f.values]
        if len(pairs) < 3:
            continue
        values = np.array([v for _, v in pairs])
        order = values.argsort().argsort().astype(float)
        pct = order / max(1, len(pairs) - 1)
        for (sym, _), p in zip(pairs, pct, strict=True):
            bundle.symbols[sym].values[f"{feature}_rank"] = float(p)


def compute_bundle(
    view: MarketView,
    as_of: datetime,
    symbols: list[str] | None = None,
    *,
    min_price: float = 5.0,
    min_adv_usd: float = 5_000_000.0,
    spreads: dict[str, float] | None = None,
) -> FeatureBundle:
    """Compute market-level plus per-symbol features for one instant."""
    pit = view.at(as_of)
    market, market_missing = compute_market_features(pit)
    universe = [s.upper() for s in (symbols or pit.investable_symbols)]

    bundle = FeatureBundle(
        as_of=pit.as_of,
        registry_version=registry_version(),
        market=market,
        market_missing=market_missing,
    )
    for sym in universe:
        if not pit.has(sym, min_bars=2):
            continue
        bundle.symbols[sym] = compute_symbol_features(
            pit,
            sym,
            market=market,
            min_price=min_price,
            min_adv_usd=min_adv_usd,
            spread_bps=(spreads or {}).get(sym),
        )
    bundle.universe_synthetic = any(f.is_synthetic for f in bundle.symbols.values())
    add_cross_sectional_ranks(bundle)
    return bundle


# ---------------------------------------------------------------------------
def persist_snapshot(session: Session, features: SymbolFeatures) -> FeatureSnapshot:
    version = registry_version()
    existing = session.scalar(
        select(FeatureSnapshot).where(
            FeatureSnapshot.symbol == features.symbol,
            FeatureSnapshot.as_of == features.as_of,
            FeatureSnapshot.registry_version == version,
        )
    )
    payload = {
        "values": features.values,
        "missing": {
            "features": features.missing,
            "out_of_range": features.out_of_range,
            "growth": features.growth.as_dict() if features.growth else None,
        },
        "data_quality": features.data_quality,
        "computed_at": utcnow(),
    }
    if existing is not None:
        for key, value in payload.items():
            setattr(existing, key, value)
        session.flush()
        return existing
    row = FeatureSnapshot(
        symbol=features.symbol,
        as_of=features.as_of,
        registry_version=version,
        **payload,
    )
    session.add(row)
    session.flush()
    return row


def persist_bundle(session: Session, bundle: FeatureBundle) -> int:
    count = 0
    for features in bundle.symbols.values():
        persist_snapshot(session, features)
        count += 1
    return count
