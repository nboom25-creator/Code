"""Momentum, trend and breakout strategy families."""

from __future__ import annotations

from typing import Any

import numpy as np

from aegisquant.db.enums import Regime
from aegisquant.strategies.base import (
    OpenPositionState,
    PositionReview,
    Strategy,
    StrategyContext,
    StrategyMeta,
    StrategySignal,
)

ALL_REGIMES = (Regime.RISK_ON, Regime.NEUTRAL, Regime.RISK_OFF)


def _pct(value: float | None, digits: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{digits}%}"


class CrossSectionalMomentum(Strategy):
    """Buy the strongest relative performers in the cross-section.

    The academic 12-1 definition (twelve-month return, most recent month
    skipped) with a trend-quality filter so the winners are smooth trends rather
    than a single lucky gap.
    """

    meta = StrategyMeta(
        key="xs_momentum",
        name="Cross-Sectional Momentum",
        family="momentum",
        description=(
            "Ranks the universe on volatility-adjusted 12-1 momentum and relative strength, "
            "requiring trend quality and volume confirmation."
        ),
        required_features=("momentum_12_1", "rel_strength_126", "realized_vol_63"),
        required_data=("daily bars", "benchmark bars"),
        universe_rules=(
            "liquid US common stocks and ETFs",
            "minimum 260 sessions of history",
            "passes the growth-score disqualifier screen",
        ),
        entry_criteria=(
            "12-1 momentum rank in the top quintile of the evaluated universe",
            "positive relative strength versus the benchmark over 126 sessions",
            "trend quality (R-squared of the log-price fit) above the parameter floor",
            "price above its 63-session moving average",
        ),
        exit_criteria=(
            "momentum rank falls out of the top half",
            "price closes below its 63-session moving average",
            "trailing stop triggered",
        ),
        sizing_method="volatility_target",
        expected_holding_days=90,
        risk_assumptions=(
            "momentum persists over 3-12 month horizons",
            "crowded momentum unwinds violently, so volatility targeting is required",
            "the effect weakens sharply in market reversals",
        ),
        invalidating_conditions=(
            "benchmark below its 200-session average with widening credit spreads",
            "cross-sectional momentum spread collapses",
            "realised volatility more than doubles versus its one-year average",
        ),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL),
        max_positions=8,
        capacity_notes="Scales to large capital in liquid names; capped by the ADV participation limit.",
    )
    default_params: dict[str, Any] = {
        "top_quantile": 0.20,
        "min_trend_quality": 0.30,
        "min_rel_strength": 0.0,
        "max_vol_regime": 1.8,
        "trailing_stop_pct": 0.18,
    }

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        scored: list[tuple[float, str, dict[str, float | None]]] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            mom = ctx.value(symbol, "momentum_12_1")
            rel = ctx.value(symbol, "rel_strength_126")
            quality = ctx.value(symbol, "trend_quality_126")
            vol = ctx.value(symbol, "realized_vol_63")
            vol_regime = ctx.value(symbol, "vol_regime")
            trend63 = ctx.value(symbol, "trend_63")
            accumulation = ctx.value(symbol, "accumulation_20")
            if None in (mom, rel, quality, vol) or vol <= 0:
                continue
            if quality < self.params["min_trend_quality"]:
                continue
            if rel < self.params["min_rel_strength"]:
                continue
            if trend63 is not None and trend63 < 0:
                continue
            if vol_regime is not None and vol_regime > self.params["max_vol_regime"]:
                continue
            score = (mom / vol) * (0.5 + quality)
            scored.append(
                (
                    score,
                    symbol,
                    {
                        "momentum_12_1": mom,
                        "rel_strength_126": rel,
                        "trend_quality_126": quality,
                        "realized_vol_63": vol,
                        "vol_regime": vol_regime,
                        "accumulation_20": accumulation,
                    },
                )
            )
        if not scored:
            return []
        scored.sort(reverse=True, key=lambda t: t[0])
        keep = max(1, int(round(len(scored) * self.params["top_quantile"])))
        keep = min(keep, self.meta.max_positions)

        signals: list[StrategySignal] = []
        best = scored[0][0] or 1.0
        for rank, (score, symbol, inputs) in enumerate(scored[:keep]):
            strength = self._clip01(score / best if best > 0 else 0.0)
            vol = inputs["realized_vol_63"] or 0.3
            confidence = self._confidence_from(
                self._clip01((inputs["trend_quality_126"] or 0) / 0.8),
                self._clip01((inputs["rel_strength_126"] or 0) / 0.35),
                self._clip01(0.5 + (inputs["accumulation_20"] or 0)),
                strength,
            )
            point = float(np.clip((inputs["momentum_12_1"] or 0) * 0.25, 0.02, 0.45))
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
            signals.append(
                StrategySignal(
                    strategy_key=self.meta.key,
                    symbol=symbol,
                    direction="long",
                    strength=strength,
                    confidence=confidence,
                    as_of=ctx.as_of,
                    expected_return=er,
                    expected_return_low=lo,
                    expected_return_high=hi,
                    expected_vol=vol,
                    downside_estimate=-min(0.5, vol * 0.75),
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{symbol} ranks #{rank + 1} of {len(scored)} on volatility-adjusted 12-1 "
                        f"momentum ({_pct(inputs['momentum_12_1'])} over the year to one month ago, "
                        f"{_pct(inputs['rel_strength_126'])} versus the benchmark over 126 sessions) "
                        f"with trend quality {inputs['trend_quality_126']:.2f}."
                    ),
                    supporting_evidence=[
                        f"12-1 momentum {_pct(inputs['momentum_12_1'])}",
                        f"relative strength vs benchmark {_pct(inputs['rel_strength_126'])}",
                        f"trend R-squared {inputs['trend_quality_126']:.2f}",
                    ]
                    + (
                        [f"net accumulation on volume {_pct(inputs['accumulation_20'])}"]
                        if (inputs.get("accumulation_20") or 0) > 0.05
                        else []
                    ),
                    opposing_evidence=[
                        f"realised volatility {_pct(vol)} annualised — momentum unwinds are sharp"
                    ]
                    + (
                        [f"volatility expanding ({inputs['vol_regime']:.2f}x its one-year level)"]
                        if (inputs.get("vol_regime") or 0) > 1.3
                        else []
                    ),
                    exit_criteria={
                        "momentum_rank_below": 0.5,
                        "close_below_sma": 63,
                        "trailing_stop_pct": self.params["trailing_stop_pct"],
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    trailing_stop_pct=self.params["trailing_stop_pct"],
                    model_version=self.meta.version,
                )
            )
        return signals

    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        mom_rank = ctx.value(position.symbol, "momentum_12_1_rank")
        trend63 = ctx.value(position.symbol, "trend_63")
        inputs = {"momentum_12_1_rank": mom_rank, "trend_63": trend63}
        if trend63 is not None and trend63 < -0.02:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.72,
                "closed below its 63-session average; the momentum condition no longer holds",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if mom_rank is not None and mom_rank < 0.5:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "trim",
                0.58,
                f"momentum rank has slipped to the {mom_rank:.0%} percentile of the universe",
                thesis_status="weakening",
                target_fraction=0.5,
                signal_inputs=inputs,
            )
        if mom_rank is not None and mom_rank > 0.85 and position.unrealized_pnl_pct > 0.10:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "add",
                0.62,
                (
                    f"still in the top {1 - mom_rank:.0%} of the universe on momentum and up "
                    f"{position.unrealized_pnl_pct:.1%} — pyramid into confirmed strength"
                ),
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key, position.symbol, "hold", 0.5, "momentum intact", signal_inputs=inputs
        )


class TimeSeriesMomentum(Strategy):
    """Own an instrument only while its own trend is positive.

    Absolute rather than relative: the comparison is a name against its own
    history, which is what makes it a genuine de-risking overlay in a downtrend.
    """

    meta = StrategyMeta(
        key="ts_momentum",
        name="Time-Series Momentum",
        family="trend",
        description=(
            "Holds names whose own 63- and 252-session trends are positive, and stands aside "
            "in cash when they are not."
        ),
        required_features=("trend_63", "trend_252", "realized_vol_63"),
        required_data=("daily bars",),
        universe_rules=("liquid stocks and broad ETFs", "minimum 260 sessions of history"),
        entry_criteria=(
            "price above both its 63- and 252-session moving averages",
            "12-month total return positive",
            "volatility regime below the parameter ceiling",
        ),
        exit_criteria=(
            "price closes below its 126-session moving average",
            "12-month total return turns negative",
        ),
        sizing_method="volatility_target",
        expected_holding_days=120,
        risk_assumptions=(
            "trends persist longer than random walk theory implies",
            "whipsaw losses in range-bound markets are the cost of the crash protection",
        ),
        invalidating_conditions=(
            "sustained range-bound market producing repeated whipsaws",
            "volatility regime above 2x the one-year level",
        ),
        supported_regimes=ALL_REGIMES,
        max_positions=10,
        capacity_notes="Very high capacity; trades infrequently and only liquid names.",
    )
    default_params: dict[str, Any] = {
        "min_trend_63": 0.0,
        "min_trend_252": 0.0,
        "max_vol_regime": 2.0,
        "trailing_stop_pct": 0.20,
    }

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        out: list[StrategySignal] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            t63 = ctx.value(symbol, "trend_63")
            t252 = ctx.value(symbol, "trend_252")
            ret252 = ctx.value(symbol, "rel_strength_252")
            vol = ctx.value(symbol, "realized_vol_63")
            vol_regime = ctx.value(symbol, "vol_regime")
            if None in (t63, t252, vol) or vol <= 0:
                continue
            if t63 <= self.params["min_trend_63"] or t252 <= self.params["min_trend_252"]:
                continue
            if vol_regime is not None and vol_regime > self.params["max_vol_regime"]:
                continue
            strength = self._clip01((t63 + t252) / 0.5)
            confidence = self._confidence_from(
                self._clip01(t63 / 0.10), self._clip01(t252 / 0.30), strength, floor=0.35
            )
            point = float(np.clip(t252 * 0.2, 0.015, 0.30))
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
            inputs = {
                "trend_63": t63,
                "trend_252": t252,
                "realized_vol_63": vol,
                "vol_regime": vol_regime,
                "rel_strength_252": ret252,
            }
            out.append(
                StrategySignal(
                    strategy_key=self.meta.key,
                    symbol=symbol,
                    direction="long",
                    strength=strength,
                    confidence=confidence,
                    as_of=ctx.as_of,
                    expected_return=er,
                    expected_return_low=lo,
                    expected_return_high=hi,
                    expected_vol=vol,
                    downside_estimate=-min(0.45, vol * 0.7),
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{symbol} is {_pct(t63)} above its 63-session average and {_pct(t252)} above "
                        "its 252-session average — an intact absolute uptrend."
                    ),
                    supporting_evidence=[
                        f"above the 63-session average by {_pct(t63)}",
                        f"above the 252-session average by {_pct(t252)}",
                    ],
                    opposing_evidence=(
                        [f"volatility regime {vol_regime:.2f}x — trend-following whipsaws in choppy tape"]
                        if (vol_regime or 0) > 1.2
                        else ["trend following gives back a portion of gains at every turn"]
                    ),
                    exit_criteria={
                        "close_below_sma": 126,
                        "trailing_stop_pct": self.params["trailing_stop_pct"],
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    trailing_stop_pct=self.params["trailing_stop_pct"],
                    model_version=self.meta.version,
                )
            )
        out.sort(key=lambda s: s.strength, reverse=True)
        return out[: self.meta.max_positions]

    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        t126 = ctx.value(position.symbol, "trend_126")
        inputs = {"trend_126": t126}
        if t126 is not None and t126 < 0:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.75,
                "price closed below its 126-session average — the absolute trend has ended",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key, position.symbol, "hold", 0.55, "absolute trend intact", signal_inputs=inputs
        )


class BreakoutFromConsolidation(Strategy):
    """Buy breakouts from long, tight bases on expanding volume.

    The base-length and tightness requirements are what separate this from
    chasing: a breakout from a 60-session quiet range on 1.5x volume behaves very
    differently from a vertical move that has already tripled.
    """

    meta = StrategyMeta(
        key="breakout_base",
        name="Breakout from Consolidation",
        family="breakout",
        description=(
            "Buys new highs emerging from extended tight consolidations, confirmed by volume "
            "expansion and accumulation."
        ),
        required_features=("breakout_55", "consolidation_days", "volume_ratio_20", "atr_pct_14"),
        required_data=("daily bars",),
        universe_rules=(
            "liquid names above the price floor",
            "minimum 260 sessions of history",
            "no accounting disclosure flags",
        ),
        entry_criteria=(
            "close within the breakout tolerance of the 55-session high",
            "the prior base lasted at least the minimum number of sessions",
            "base width below the tightness ceiling",
            "volume at least the required multiple of its 20-session average",
        ),
        exit_criteria=(
            "close back below the breakout level by more than the failure tolerance",
            "trailing stop triggered",
            "volume dries up while price stalls",
        ),
        sizing_method="fixed_fractional",
        expected_holding_days=45,
        risk_assumptions=(
            "false breakouts are frequent, so stops must be tight and honoured",
            "gap risk around the breakout is real and cannot be stopped out of",
        ),
        invalidating_conditions=(
            "benchmark in a confirmed downtrend (breakout failure rate rises sharply)",
            "average pairwise correlation above 0.8 (single-factor market)",
        ),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL),
        max_positions=6,
        capacity_notes="Moderate; entries cluster in time and can move thinner names.",
    )
    default_params: dict[str, Any] = {
        "breakout_tolerance": 0.02,
        "min_base_days": 25,
        "max_base_tightness": 0.35,
        "min_volume_ratio": 1.25,
        "failure_tolerance": 0.04,
        "trailing_stop_pct": 0.12,
    }

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        out: list[StrategySignal] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            bo = ctx.value(symbol, "breakout_55")
            base = ctx.value(symbol, "consolidation_days")
            tight = ctx.value(symbol, "base_tightness_55")
            vol_ratio = ctx.value(symbol, "volume_ratio_20")
            atr = ctx.value(symbol, "atr_pct_14")
            accumulation = ctx.value(symbol, "accumulation_20")
            if None in (bo, base, vol_ratio, atr):
                continue
            if bo < -self.params["breakout_tolerance"]:
                continue  # not at a new high
            if base < self.params["min_base_days"]:
                continue
            if tight is not None and tight > self.params["max_base_tightness"]:
                continue
            if vol_ratio < self.params["min_volume_ratio"]:
                continue
            score = (base / 100.0) + (vol_ratio - 1.0) * 0.5 + max(0.0, bo) * 5
            strength = self._clip01(score / 2.0)
            confidence = self._confidence_from(
                self._clip01(base / 90.0),
                self._clip01((vol_ratio - 1.0) / 1.5),
                self._clip01(0.5 + (accumulation or 0)),
                floor=0.35,
            )
            point = float(np.clip(atr * 8, 0.03, 0.25))
            vol = ctx.value(symbol, "realized_vol_63") or atr * 16
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
            stop = max(0.05, min(0.15, atr * 3))
            inputs = {
                "breakout_55": bo,
                "consolidation_days": base,
                "base_tightness_55": tight,
                "volume_ratio_20": vol_ratio,
                "atr_pct_14": atr,
                "accumulation_20": accumulation,
            }
            out.append(
                StrategySignal(
                    strategy_key=self.meta.key,
                    symbol=symbol,
                    direction="long",
                    strength=strength,
                    confidence=confidence,
                    as_of=ctx.as_of,
                    expected_return=er,
                    expected_return_low=lo,
                    expected_return_high=hi,
                    expected_vol=vol,
                    downside_estimate=-stop,
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{symbol} is breaking out of a {int(base)}-session base "
                        f"({_pct(tight) if tight else 'n/a'} wide) on {vol_ratio:.2f}x average volume."
                    ),
                    supporting_evidence=[
                        f"base length {int(base)} sessions",
                        f"volume {vol_ratio:.2f}x its 20-session average",
                        f"within {_pct(abs(bo))} of the 55-session high",
                    ],
                    opposing_evidence=[
                        f"false breakouts are common; ATR is {_pct(atr)} so the stop is {_pct(stop)} away"
                    ]
                    + (
                        ["no volume-based accumulation to confirm the move"]
                        if (accumulation or 0) <= 0
                        else []
                    ),
                    exit_criteria={
                        "close_below_breakout_pct": self.params["failure_tolerance"],
                        "trailing_stop_pct": self.params["trailing_stop_pct"],
                        "stop_loss_pct": stop,
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    stop_hint_pct=stop,
                    trailing_stop_pct=self.params["trailing_stop_pct"],
                    model_version=self.meta.version,
                )
            )
        out.sort(key=lambda s: s.strength, reverse=True)
        return out[: self.meta.max_positions]

    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        bo = ctx.value(position.symbol, "breakout_55")
        vol_ratio = ctx.value(position.symbol, "volume_ratio_20")
        inputs = {"breakout_55": bo, "volume_ratio_20": vol_ratio}
        if bo is not None and bo < -self.params["failure_tolerance"] * 2:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.7,
                f"price has fallen {_pct(abs(bo))} back below the breakout level — failed breakout",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if position.unrealized_pnl_pct < -0.08:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.65,
                f"down {position.unrealized_pnl_pct:.1%} — breakout theses fail fast or not at all",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key, position.symbol, "hold", 0.5, "breakout holding above the base", signal_inputs=inputs
        )


class SectorLeadership(Strategy):
    """Own the strongest names inside the strongest sectors.

    Two-stage selection: rank sectors on composite momentum, then take the
    leaders within the winning sectors. Concentrating inside leading groups is
    what makes a growth portfolio participate in a real theme instead of holding
    an average of everything.
    """

    meta = StrategyMeta(
        key="sector_leadership",
        name="Sector and Industry Leadership",
        family="momentum",
        description=(
            "Selects the leading sectors on 63-session composite momentum, then buys the "
            "highest relative-strength names inside them."
        ),
        required_features=("sector_rel_strength_126", "rel_strength_63"),
        required_data=("daily bars", "sector classification"),
        universe_rules=(
            "names with a sector classification and at least two same-sector peers",
            "liquid, above the price floor",
        ),
        entry_criteria=(
            "sector composite return in the top sectors",
            "name outperforming its own sector over 126 sessions",
            "positive 63-session relative strength versus the benchmark",
        ),
        exit_criteria=(
            "the sector loses leadership",
            "the name underperforms its sector",
        ),
        sizing_method="conviction_weighted",
        expected_holding_days=75,
        risk_assumptions=(
            "sector concentration is intentional and must be bounded by the sector risk limit",
            "sector rotation can be abrupt",
        ),
        invalidating_conditions=(
            "sector momentum dispersion collapses (nothing is leading)",
            "average pairwise correlation above 0.85",
        ),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL),
        max_positions=6,
        capacity_notes="Good capacity; concentration is bounded by the portfolio sector limit.",
    )
    default_params: dict[str, Any] = {
        "top_sectors": 3,
        "min_sector_rel_strength": 0.0,
        "min_rel_strength_63": 0.0,
        "trailing_stop_pct": 0.16,
    }

    def _sector_scores(self, ctx: StrategyContext) -> dict[str, float]:
        buckets: dict[str, list[float]] = {}
        for symbol in ctx.candidates():
            if ctx.pit.instrument(symbol).get("asset_class") == "etf":
                continue
            rel = ctx.value(symbol, "rel_strength_63")
            if rel is None:
                continue
            buckets.setdefault(ctx.pit.sector(symbol), []).append(rel)
        return {k: float(np.mean(v)) for k, v in buckets.items() if len(v) >= 2}

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        sector_scores = self._sector_scores(ctx)
        if len(sector_scores) < 2:
            return []
        leaders = sorted(sector_scores.items(), key=lambda kv: kv[1], reverse=True)
        top = [s for s, v in leaders[: self.params["top_sectors"]] if v > 0]
        if not top:
            return []

        out: list[StrategySignal] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            sector = ctx.pit.sector(symbol)
            if sector not in top:
                continue
            sector_rel = ctx.value(symbol, "sector_rel_strength_126")
            rel63 = ctx.value(symbol, "rel_strength_63")
            if sector_rel is None or rel63 is None:
                continue
            if sector_rel < self.params["min_sector_rel_strength"]:
                continue
            if rel63 < self.params["min_rel_strength_63"]:
                continue
            vol = ctx.value(symbol, "realized_vol_63") or 0.35
            strength = self._clip01((sector_rel + rel63) / 0.5)
            confidence = self._confidence_from(
                self._clip01(sector_rel / 0.25),
                self._clip01(rel63 / 0.20),
                self._clip01(sector_scores[sector] / 0.15),
                floor=0.34,
            )
            point = float(np.clip((sector_rel + rel63) * 0.35, 0.02, 0.35))
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
            inputs = {
                "sector_rel_strength_126": sector_rel,
                "rel_strength_63": rel63,
                "sector_composite_63": sector_scores[sector],
            }
            out.append(
                StrategySignal(
                    strategy_key=self.meta.key,
                    symbol=symbol,
                    direction="long",
                    strength=strength,
                    confidence=confidence,
                    as_of=ctx.as_of,
                    expected_return=er,
                    expected_return_low=lo,
                    expected_return_high=hi,
                    expected_vol=vol,
                    downside_estimate=-min(0.4, vol * 0.7),
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{sector} is a leading group (+{sector_scores[sector]:.1%} versus the benchmark "
                        f"over 63 sessions) and {symbol} leads within it by {_pct(sector_rel)} over 126 sessions."
                    ),
                    supporting_evidence=[
                        f"sector composite relative strength {_pct(sector_scores[sector])}",
                        f"outperforming its own sector by {_pct(sector_rel)}",
                        f"63-session relative strength {_pct(rel63)}",
                    ],
                    opposing_evidence=[
                        "sector concentration raises correlated drawdown risk",
                        "sector rotation can reverse leadership quickly",
                    ],
                    exit_criteria={
                        "sector_loses_leadership": True,
                        "sector_rel_strength_below": -0.05,
                        "trailing_stop_pct": self.params["trailing_stop_pct"],
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    trailing_stop_pct=self.params["trailing_stop_pct"],
                    model_version=self.meta.version,
                )
            )
        out.sort(key=lambda s: s.strength, reverse=True)
        return out[: self.meta.max_positions]

    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        sector_rel = ctx.value(position.symbol, "sector_rel_strength_126")
        sector_scores = self._sector_scores(ctx)
        sector = ctx.pit.sector(position.symbol)
        composite = sector_scores.get(sector)
        inputs = {"sector_rel_strength_126": sector_rel, "sector_composite_63": composite}
        if composite is not None and composite < -0.03:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.66,
                f"{sector} has lost leadership ({composite:.1%} versus the benchmark)",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if sector_rel is not None and sector_rel < -0.05:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "trim",
                0.55,
                f"lagging its own sector by {_pct(abs(sector_rel))}",
                thesis_status="weakening",
                target_fraction=0.5,
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key, position.symbol, "hold", 0.5, "sector and stock leadership intact", signal_inputs=inputs
        )
