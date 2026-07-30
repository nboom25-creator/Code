"""Growth, quality and event-driven strategy families.

These are the strategies the aggressive-growth mandate leans on hardest. Each one
insists on the *combination* of a fundamental condition and price confirmation:
accelerating fundamentals that the market is ignoring may stay ignored for years,
and price strength with no fundamental support is the pattern the disqualifier
screen exists to reject.
"""

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


def _pct(value: float | None, digits: int = 1) -> str:
    return "n/a" if value is None else f"{value:.{digits}%}"


def _num(value: float | None, digits: int = 2) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


class QualityGrowthCompounder(Strategy):
    """Own high-return-on-capital businesses that keep compounding.

    Lower turnover than the momentum sleeves: the intent is to hold a good
    business for quarters, exiting on fundamental deterioration rather than on a
    price wobble.
    """

    meta = StrategyMeta(
        key="quality_growth",
        name="Quality-Growth Compounder",
        family="quality_growth",
        description=(
            "Ranks companies on return on invested capital, margin structure, cash conversion and "
            "balance-sheet strength, requiring durable growth and a confirming price trend."
        ),
        required_features=("roic", "gross_margin", "revenue_growth_yoy"),
        required_data=("daily bars", "quarterly fundamentals"),
        universe_rules=(
            "common stocks with at least four reported fiscal periods",
            "liquid and above the price floor",
            "no accounting disclosure flags",
        ),
        entry_criteria=(
            "return on invested capital above the floor",
            "revenue growth above the floor",
            "gross margin above the floor and not contracting materially",
            "accruals ratio below the earnings-quality ceiling",
            "price above its 200-session average",
        ),
        exit_criteria=(
            "revenue growth decelerates below the exit floor",
            "gross margin contracts year over year beyond tolerance",
            "return on invested capital falls below the exit floor",
            "price closes below its 200-session average",
        ),
        sizing_method="conviction_weighted",
        expected_holding_days=180,
        risk_assumptions=(
            "quality persists but is priced; multiple compression is the main risk",
            "reported fundamentals are lagged, so price can lead the deterioration",
        ),
        invalidating_conditions=(
            "accounting restatement or audit disclosure",
            "two consecutive quarters of decelerating growth with margin contraction",
            "leverage rising while cash flow falls",
        ),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL),
        max_positions=8,
        capacity_notes="High capacity; low turnover and large-cap tilt.",
    )
    default_params: dict[str, Any] = {
        "min_roic": 0.08,
        "min_revenue_growth": 0.08,
        "min_gross_margin": 0.30,
        "max_accruals": 0.10,
        "require_uptrend": True,
        "trailing_stop_pct": 0.25,
    }

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        scored: list[tuple[float, str, dict[str, float | None]]] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            if ctx.pit.instrument(symbol).get("asset_class") == "etf":
                continue
            roic = ctx.value(symbol, "roic")
            growth = ctx.value(symbol, "revenue_growth_yoy")
            margin = ctx.value(symbol, "gross_margin")
            accruals = ctx.value(symbol, "accruals_ratio")
            fcf_conv = ctx.value(symbol, "fcf_conversion")
            debt = ctx.value(symbol, "debt_to_equity")
            trend252 = ctx.value(symbol, "trend_252")
            periods = ctx.value(symbol, "periods_available")
            if None in (roic, growth, margin):
                continue
            if periods is not None and periods < 4:
                continue
            if roic < self.params["min_roic"] or growth < self.params["min_revenue_growth"]:
                continue
            if margin < self.params["min_gross_margin"]:
                continue
            if accruals is not None and accruals > self.params["max_accruals"]:
                continue
            if self.params["require_uptrend"] and (trend252 is None or trend252 <= 0):
                continue
            score = (
                float(np.clip(roic / 0.25, 0, 2)) * 1.4
                + float(np.clip(growth / 0.30, 0, 2)) * 1.2
                + float(np.clip(margin / 0.60, 0, 1.5)) * 0.8
                + (float(np.clip(fcf_conv / 1.2, 0, 1.5)) * 0.6 if fcf_conv else 0.0)
                - (float(np.clip((debt or 0) / 2.0, 0, 1.5)) * 0.4)
            )
            scored.append(
                (
                    score,
                    symbol,
                    {
                        "roic": roic,
                        "revenue_growth_yoy": growth,
                        "gross_margin": margin,
                        "accruals_ratio": accruals,
                        "fcf_conversion": fcf_conv,
                        "debt_to_equity": debt,
                        "trend_252": trend252,
                    },
                )
            )
        if not scored:
            return []
        scored.sort(reverse=True, key=lambda t: t[0])
        best = scored[0][0] or 1.0
        out: list[StrategySignal] = []
        for score, symbol, inputs in scored[: self.meta.max_positions]:
            vol = ctx.value(symbol, "realized_vol_63") or 0.30
            strength = self._clip01(score / best if best > 0 else 0)
            confidence = self._confidence_from(
                self._clip01((inputs["roic"] or 0) / 0.25),
                self._clip01((inputs["revenue_growth_yoy"] or 0) / 0.30),
                self._clip01((inputs["gross_margin"] or 0) / 0.60),
                strength,
                floor=0.35,
            )
            point = float(np.clip((inputs["revenue_growth_yoy"] or 0) * 0.55, 0.03, 0.40))
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
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
                    downside_estimate=-min(0.4, vol * 0.8),
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{symbol} earns {_pct(inputs['roic'])} on invested capital while growing revenue "
                        f"{_pct(inputs['revenue_growth_yoy'])} at a {_pct(inputs['gross_margin'])} gross "
                        "margin — a compounder whose price trend confirms the fundamentals."
                    ),
                    supporting_evidence=[
                        f"return on invested capital {_pct(inputs['roic'])}",
                        f"revenue growth {_pct(inputs['revenue_growth_yoy'])}",
                        f"gross margin {_pct(inputs['gross_margin'])}",
                    ]
                    + (
                        [f"free-cash-flow conversion {_num(inputs['fcf_conversion'])}x net income"]
                        if inputs.get("fcf_conversion")
                        else []
                    ),
                    opposing_evidence=["quality is widely recognised, so the multiple is the risk"]
                    + (
                        [f"leverage at {_num(inputs['debt_to_equity'])}x equity"]
                        if (inputs.get("debt_to_equity") or 0) > 1.0
                        else []
                    )
                    + (
                        [f"accruals ratio {_num(inputs['accruals_ratio'], 3)} — watch cash conversion"]
                        if (inputs.get("accruals_ratio") or 0) > 0.05
                        else []
                    ),
                    exit_criteria={
                        "revenue_growth_below": 0.03,
                        "gross_margin_delta_below": -0.03,
                        "roic_below": 0.05,
                        "close_below_sma": 200,
                        "trailing_stop_pct": self.params["trailing_stop_pct"],
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    trailing_stop_pct=self.params["trailing_stop_pct"],
                    model_version=self.meta.version,
                )
            )
        return out

    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        growth = ctx.value(position.symbol, "revenue_growth_yoy")
        accel = ctx.value(position.symbol, "revenue_growth_accel")
        margin_delta = ctx.value(position.symbol, "gross_margin_delta_yoy")
        roic = ctx.value(position.symbol, "roic")
        trend252 = ctx.value(position.symbol, "trend_252")
        accounting = ctx.value(position.symbol, "has_accounting_flag_90")
        inputs = {
            "revenue_growth_yoy": growth,
            "revenue_growth_accel": accel,
            "gross_margin_delta_yoy": margin_delta,
            "roic": roic,
            "trend_252": trend252,
            "has_accounting_flag_90": accounting,
        }
        if accounting == 1.0:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.9,
                "accounting or restatement disclosure — the fundamental thesis cannot be trusted",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if growth is not None and growth < 0.03:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.7,
                f"revenue growth has fallen to {_pct(growth)} — no longer a compounder",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        deteriorating = [
            cond
            for cond, flag in (
                ("growth decelerating", accel is not None and accel < -0.04),
                ("margin contracting", margin_delta is not None and margin_delta < -0.02),
                ("returns on capital falling", roic is not None and roic < 0.06),
            )
            if flag
        ]
        if len(deteriorating) >= 2:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "trim",
                0.6,
                "fundamentals deteriorating on two fronts: " + " and ".join(deteriorating),
                thesis_status="weakening",
                target_fraction=0.5,
                signal_inputs=inputs,
            )
        if trend252 is not None and trend252 < -0.05:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "trim",
                0.55,
                "price has broken its 252-session average while fundamentals still look intact",
                thesis_status="weakening",
                target_fraction=0.6,
                signal_inputs=inputs,
            )
        if accel is not None and accel > 0.02 and position.unrealized_pnl_pct > 0.15 and (margin_delta or 0) >= 0:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "add",
                0.6,
                (
                    f"growth is still accelerating (+{accel:.1%} change in year-over-year rate) and the "
                    f"position is up {position.unrealized_pnl_pct:.1%} — let the winner compound"
                ),
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key,
            position.symbol,
            "hold",
            0.55,
            "growth, margins and returns on capital all still meet the entry standard",
            signal_inputs=inputs,
        )


class GrowthAtReasonablePrice(Strategy):
    """Growth, but refusing to pay any price for it.

    The valuation leg is ``growth_adjusted_ps`` (price/sales per point of
    growth), which is undefined for non-growers — so a cheap multiple on
    shrinking revenue cannot sneak in as "value".
    """

    meta = StrategyMeta(
        key="garp",
        name="Growth at a Reasonable Price",
        family="value_quality",
        description=(
            "Ranks growers by valuation per unit of growth, filtered on profitability, cash "
            "conversion and balance-sheet quality."
        ),
        required_features=("revenue_growth_yoy", "ps_ratio"),
        required_data=("daily bars", "quarterly fundamentals"),
        universe_rules=(
            "common stocks with positive revenue growth and a reported sales multiple",
            "at least four reported fiscal periods",
        ),
        entry_criteria=(
            "revenue growth above the floor",
            "growth-adjusted price/sales in the cheapest tier of qualifying names",
            "positive operating margin or improving margin trend",
            "accruals below the earnings-quality ceiling",
        ),
        exit_criteria=(
            "growth-adjusted valuation exceeds the exit ceiling",
            "growth falls below the floor",
            "margins deteriorate",
        ),
        sizing_method="conviction_weighted",
        expected_holding_days=150,
        risk_assumptions=(
            "valuation discipline gives up some of the strongest momentum names",
            "cheap-looking growth is often cheap for a reason; quality filters are load-bearing",
        ),
        invalidating_conditions=(
            "growth turns negative",
            "accounting disclosure",
            "multiple expansion without fundamental improvement",
        ),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL, Regime.RISK_OFF),
        max_positions=8,
        capacity_notes="High capacity; valuation discipline keeps it away from the thinnest names.",
    )
    default_params: dict[str, Any] = {
        "min_revenue_growth": 0.10,
        "max_growth_adjusted_ps": 0.60,
        "max_accruals": 0.12,
        "require_positive_margin": False,
        "trailing_stop_pct": 0.22,
    }

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        scored: list[tuple[float, str, dict[str, float | None]]] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            if ctx.pit.instrument(symbol).get("asset_class") == "etf":
                continue
            growth = ctx.value(symbol, "revenue_growth_yoy")
            gaps = ctx.value(symbol, "growth_adjusted_ps")
            ps = ctx.value(symbol, "ps_ratio")
            op_margin = ctx.value(symbol, "operating_margin")
            accruals = ctx.value(symbol, "accruals_ratio")
            margin_delta = ctx.value(symbol, "gross_margin_delta_yoy")
            if growth is None or growth < self.params["min_revenue_growth"]:
                continue
            if gaps is None or gaps > self.params["max_growth_adjusted_ps"]:
                continue
            if accruals is not None and accruals > self.params["max_accruals"]:
                continue
            if self.params["require_positive_margin"] and (op_margin is None or op_margin <= 0):
                continue
            if op_margin is not None and op_margin < -0.25 and (margin_delta or 0) <= 0:
                continue  # deep losses with no improvement
            score = (growth / max(gaps, 0.02)) * (1.0 + max(0.0, op_margin or 0.0))
            scored.append(
                (
                    score,
                    symbol,
                    {
                        "revenue_growth_yoy": growth,
                        "growth_adjusted_ps": gaps,
                        "ps_ratio": ps,
                        "operating_margin": op_margin,
                        "accruals_ratio": accruals,
                        "gross_margin_delta_yoy": margin_delta,
                    },
                )
            )
        if not scored:
            return []
        scored.sort(reverse=True, key=lambda t: t[0])
        best = scored[0][0] or 1.0
        out: list[StrategySignal] = []
        for score, symbol, inputs in scored[: self.meta.max_positions]:
            vol = ctx.value(symbol, "realized_vol_63") or 0.35
            strength = self._clip01(score / best if best > 0 else 0)
            confidence = self._confidence_from(
                self._clip01((inputs["revenue_growth_yoy"] or 0) / 0.35),
                self._clip01(1.0 - (inputs["growth_adjusted_ps"] or 1.0) / 0.6),
                strength,
                floor=0.33,
            )
            point = float(np.clip((inputs["revenue_growth_yoy"] or 0) * 0.5, 0.03, 0.40))
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
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
                    downside_estimate=-min(0.42, vol * 0.8),
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{symbol} grows revenue {_pct(inputs['revenue_growth_yoy'])} yet trades at "
                        f"{_num(inputs['ps_ratio'])}x sales — {_num(inputs['growth_adjusted_ps'])} of "
                        "price/sales per point of growth, the cheapest tier of qualifying growers."
                    ),
                    supporting_evidence=[
                        f"revenue growth {_pct(inputs['revenue_growth_yoy'])}",
                        f"growth-adjusted price/sales {_num(inputs['growth_adjusted_ps'])}",
                    ]
                    + (
                        [f"operating margin {_pct(inputs['operating_margin'])}"]
                        if inputs.get("operating_margin") is not None
                        else []
                    ),
                    opposing_evidence=[
                        "a low multiple on growth can reflect a market view the fundamentals have not shown yet"
                    ]
                    + (
                        [f"operating margin is negative at {_pct(inputs['operating_margin'])}"]
                        if (inputs.get("operating_margin") or 0) < 0
                        else []
                    ),
                    exit_criteria={
                        "growth_adjusted_ps_above": 1.20,
                        "revenue_growth_below": 0.05,
                        "trailing_stop_pct": self.params["trailing_stop_pct"],
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    trailing_stop_pct=self.params["trailing_stop_pct"],
                    model_version=self.meta.version,
                )
            )
        return out


class EarningsAcceleration(Strategy):
    """Buy the inflection, not the level.

    Targets names where the *rate* of revenue and earnings growth is rising and
    margins are expanding — the fundamental-momentum effect — with a price
    confirmation leg so the market is at least starting to agree.
    """

    meta = StrategyMeta(
        key="earnings_acceleration",
        name="Earnings and Revenue Acceleration",
        family="fundamental_momentum",
        description=(
            "Selects companies whose year-over-year growth rate is increasing with expanding "
            "margins, confirmed by relative strength."
        ),
        required_features=("revenue_growth_accel", "fundamental_momentum"),
        required_data=("daily bars", "quarterly fundamentals"),
        universe_rules=(
            "common stocks with at least five reported fiscal periods (two YoY comparisons)",
            "liquid, above the price floor",
        ),
        entry_criteria=(
            "revenue growth acceleration above the floor",
            "composite fundamental momentum above the floor",
            "gross margin flat or expanding year over year",
            "positive 63-session relative strength",
        ),
        exit_criteria=(
            "acceleration turns negative",
            "margins contract year over year",
            "relative strength turns negative",
        ),
        sizing_method="conviction_weighted",
        expected_holding_days=100,
        risk_assumptions=(
            "acceleration mean-reverts, so the edge decays as the trend matures",
            "reported data is lagged; the market may already have discounted it",
        ),
        invalidating_conditions=(
            "two consecutive quarters of decelerating growth",
            "margin contraction with rising leverage",
            "accounting disclosure",
        ),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL),
        max_positions=7,
        capacity_notes="Moderate to high; concentrated in mid- and large-cap growth.",
    )
    default_params: dict[str, Any] = {
        "min_revenue_accel": 0.01,
        "min_fundamental_momentum": 0.20,
        "min_rel_strength_63": -0.02,
        "allow_margin_contraction": -0.005,
        "trailing_stop_pct": 0.20,
    }

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        scored: list[tuple[float, str, dict[str, float | None]]] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            if ctx.pit.instrument(symbol).get("asset_class") == "etf":
                continue
            accel = ctx.value(symbol, "revenue_growth_accel")
            eps_accel = ctx.value(symbol, "eps_growth_accel")
            fund_mom = ctx.value(symbol, "fundamental_momentum")
            margin_delta = ctx.value(symbol, "gross_margin_delta_yoy")
            rel63 = ctx.value(symbol, "rel_strength_63")
            op_lev = ctx.value(symbol, "operating_leverage")
            if accel is None or fund_mom is None:
                continue
            if accel < self.params["min_revenue_accel"]:
                continue
            if fund_mom < self.params["min_fundamental_momentum"]:
                continue
            if margin_delta is not None and margin_delta < self.params["allow_margin_contraction"]:
                continue
            if rel63 is not None and rel63 < self.params["min_rel_strength_63"]:
                continue
            score = (
                float(np.clip(accel / 0.06, 0, 3)) * 1.5
                + float(np.clip(fund_mom / 1.5, 0, 2)) * 1.2
                + (float(np.clip((eps_accel or 0) / 0.25, -1, 2)) * 0.8)
                + (float(np.clip((margin_delta or 0) / 0.03, -1, 2)) * 0.7)
            )
            scored.append(
                (
                    score,
                    symbol,
                    {
                        "revenue_growth_accel": accel,
                        "eps_growth_accel": eps_accel,
                        "fundamental_momentum": fund_mom,
                        "gross_margin_delta_yoy": margin_delta,
                        "rel_strength_63": rel63,
                        "operating_leverage": op_lev,
                    },
                )
            )
        if not scored:
            return []
        scored.sort(reverse=True, key=lambda t: t[0])
        best = scored[0][0] or 1.0
        out: list[StrategySignal] = []
        for score, symbol, inputs in scored[: self.meta.max_positions]:
            vol = ctx.value(symbol, "realized_vol_63") or 0.35
            margin_text = (
                _pct(inputs["gross_margin_delta_yoy"])
                if inputs["gross_margin_delta_yoy"] is not None
                else "flat"
            )
            strength = self._clip01(score / best if best > 0 else 0)
            confidence = self._confidence_from(
                self._clip01((inputs["revenue_growth_accel"] or 0) / 0.06),
                self._clip01((inputs["fundamental_momentum"] or 0) / 1.5),
                self._clip01(0.5 + (inputs["gross_margin_delta_yoy"] or 0) / 0.04),
                strength,
                floor=0.34,
            )
            point = float(np.clip((inputs["revenue_growth_accel"] or 0) * 3.0, 0.03, 0.45))
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
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
                    downside_estimate=-min(0.45, vol * 0.85),
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{symbol}'s revenue growth rate rose {inputs['revenue_growth_accel']:+.1%} versus "
                        f"the prior comparison with gross margin {margin_text} "
                        "year over year — a fundamental inflection the price is beginning to confirm."
                    ),
                    supporting_evidence=[
                        f"revenue growth acceleration {inputs['revenue_growth_accel']:+.1%}",
                        f"composite fundamental momentum {_num(inputs['fundamental_momentum'])}",
                    ]
                    + (
                        [f"EPS growth acceleration {inputs['eps_growth_accel']:+.1%}"]
                        if inputs.get("eps_growth_accel") is not None
                        else []
                    )
                    + (
                        [f"operating leverage {_num(inputs['operating_leverage'])}x"]
                        if (inputs.get("operating_leverage") or 0) > 1.2
                        else []
                    ),
                    opposing_evidence=[
                        "acceleration is mean-reverting; the edge decays as the comparison base rises",
                        "fundamentals are reported with a lag, so some of this is already priced",
                    ],
                    exit_criteria={
                        "revenue_accel_below": -0.01,
                        "gross_margin_delta_below": -0.02,
                        "rel_strength_63_below": -0.10,
                        "trailing_stop_pct": self.params["trailing_stop_pct"],
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    trailing_stop_pct=self.params["trailing_stop_pct"],
                    model_version=self.meta.version,
                )
            )
        return out

    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        accel = ctx.value(position.symbol, "revenue_growth_accel")
        margin_delta = ctx.value(position.symbol, "gross_margin_delta_yoy")
        rel63 = ctx.value(position.symbol, "rel_strength_63")
        inputs = {
            "revenue_growth_accel": accel,
            "gross_margin_delta_yoy": margin_delta,
            "rel_strength_63": rel63,
        }
        if accel is not None and accel < -0.02:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.7,
                f"growth is now decelerating ({accel:+.1%} change in rate) — the entry thesis is gone",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if margin_delta is not None and margin_delta < -0.02:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "trim",
                0.6,
                f"gross margin contracted {_pct(abs(margin_delta))} year over year",
                thesis_status="weakening",
                target_fraction=0.5,
                signal_inputs=inputs,
            )
        if accel is not None and accel > 0.03 and position.unrealized_pnl_pct > 0.12:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "add",
                0.62,
                "acceleration is still improving and price confirms — add to the winner",
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key,
            position.symbol,
            "hold",
            0.55,
            "acceleration thesis intact",
            signal_inputs=inputs,
        )


class PostEarningsDrift(Strategy):
    """Post-earnings-announcement drift.

    Trades the window after a report: a positive surprise that the market
    under-reacts to tends to keep drifting for several weeks. Strictly bounded by
    ``days_since_earnings`` so it cannot masquerade as a momentum sleeve.
    """

    meta = StrategyMeta(
        key="pead",
        name="Post-Earnings-Announcement Drift",
        family="event_driven",
        description=(
            "Buys names that gapped up on their most recent earnings publication and have kept "
            "drifting, within a bounded window after the report."
        ),
        required_features=("days_since_earnings", "pead_drift_20"),
        required_data=("daily bars", "quarterly fundamentals with publication timestamps"),
        universe_rules=(
            "names whose most recent report is inside the drift window",
            "liquid, above the price floor",
        ),
        entry_criteria=(
            "earnings published between the minimum and maximum session counts ago",
            "positive earnings gap",
            "positive drift since publication",
            "positive earnings or revenue growth in the reported period",
        ),
        exit_criteria=(
            "the drift window closes",
            "price gives back the earnings gap",
        ),
        sizing_method="fixed_fractional",
        expected_holding_days=35,
        risk_assumptions=(
            "the effect is small per trade and needs many observations",
            "transaction costs consume a large share of the edge",
            "gap risk into the next report must be avoided by exiting first",
        ),
        invalidating_conditions=(
            "no reliable earnings publication timestamps available",
            "the next report is imminent",
        ),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL),
        max_positions=6,
        capacity_notes="Limited; short holding period and high turnover cap the deployable capital.",
    )
    default_params: dict[str, Any] = {
        "min_days_since_earnings": 1,
        "max_days_since_earnings": 45,
        "min_earnings_gap": 0.01,
        "min_drift": 0.0,
        "stop_pct": 0.08,
    }

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        scored: list[tuple[float, str, dict[str, float | None]]] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            days = ctx.value(symbol, "days_since_earnings")
            gap = ctx.value(symbol, "earnings_gap_pct")
            drift = ctx.value(symbol, "pead_drift_20")
            eps_growth = ctx.value(symbol, "eps_growth_yoy")
            rev_growth = ctx.value(symbol, "revenue_growth_yoy")
            if days is None or gap is None or drift is None:
                continue
            if not (self.params["min_days_since_earnings"] <= days <= self.params["max_days_since_earnings"]):
                continue
            if gap < self.params["min_earnings_gap"] or drift < self.params["min_drift"]:
                continue
            if (eps_growth is None or eps_growth <= 0) and (rev_growth is None or rev_growth <= 0):
                continue
            score = gap * 2.0 + drift
            scored.append(
                (
                    score,
                    symbol,
                    {
                        "days_since_earnings": days,
                        "earnings_gap_pct": gap,
                        "pead_drift_20": drift,
                        "eps_growth_yoy": eps_growth,
                        "revenue_growth_yoy": rev_growth,
                    },
                )
            )
        if not scored:
            return []
        scored.sort(reverse=True, key=lambda t: t[0])
        best = scored[0][0] or 1.0
        out: list[StrategySignal] = []
        for score, symbol, inputs in scored[: self.meta.max_positions]:
            vol = ctx.value(symbol, "realized_vol_63") or 0.35
            strength = self._clip01(score / best if best > 0 else 0)
            confidence = self._confidence_from(
                self._clip01((inputs["earnings_gap_pct"] or 0) / 0.08),
                self._clip01((inputs["pead_drift_20"] or 0) / 0.10),
                self._clip01(1.0 - (inputs["days_since_earnings"] or 0) / 45.0),
                floor=0.32,
                cap=0.75,  # a small, well-documented effect; never high conviction
            )
            point = float(np.clip((inputs["earnings_gap_pct"] or 0) * 1.2, 0.01, 0.12))
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
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
                    downside_estimate=-self.params["stop_pct"],
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{symbol} gapped {_pct(inputs['earnings_gap_pct'])} on its report "
                        f"{int(inputs['days_since_earnings'] or 0)} days ago and has drifted "
                        f"{_pct(inputs['pead_drift_20'])} since — the classic under-reaction window."
                    ),
                    supporting_evidence=[
                        f"earnings gap {_pct(inputs['earnings_gap_pct'])}",
                        f"drift since publication {_pct(inputs['pead_drift_20'])}",
                        f"{int(inputs['days_since_earnings'] or 0)} sessions into the drift window",
                    ],
                    opposing_evidence=[
                        "post-earnings drift is a small effect that costs consume quickly",
                        "the window is short; there is no thesis left after it closes",
                    ],
                    exit_criteria={
                        "max_days_since_earnings": self.params["max_days_since_earnings"] + 15,
                        "gap_given_back": True,
                        "stop_loss_pct": self.params["stop_pct"],
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    stop_hint_pct=self.params["stop_pct"],
                    model_version=self.meta.version,
                )
            )
        return out

    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        days = ctx.value(position.symbol, "days_since_earnings")
        drift = ctx.value(position.symbol, "pead_drift_20")
        inputs = {"days_since_earnings": days, "pead_drift_20": drift}
        if days is not None and days > self.params["max_days_since_earnings"] + 15:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.8,
                f"the drift window has closed ({int(days)} sessions since the report)",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if drift is not None and drift < -0.02:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.7,
                "the post-earnings gain has been given back — no drift to trade",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key,
            position.symbol,
            "hold",
            0.5,
            "still inside the drift window",
            signal_inputs=inputs,
        )


class SmallMidGrowthDiscovery(Strategy):
    """Find smaller companies before the coverage arrives.

    Weighs raw fundamentals and unusual volume rather than sentiment, because
    smaller names legitimately have little or no news coverage. Absent news is
    treated as absent information, never as a negative — but the liquidity and
    pump-and-dump screens are applied *harder* here, since that is where the real
    risk in this part of the universe lives.
    """

    meta = StrategyMeta(
        key="smid_growth",
        name="Small- and Mid-Cap Growth Discovery",
        family="quality_growth",
        description=(
            "Screens smaller companies on fundamental strength and volume anomalies, with "
            "stricter liquidity and manipulation filters and no reliance on news sentiment."
        ),
        required_features=("market_cap", "revenue_growth_yoy", "adv_usd_20"),
        required_data=("daily bars", "quarterly fundamentals"),
        universe_rules=(
            "market capitalisation between the floor and ceiling parameters",
            "20-day dollar volume above the hard liquidity floor",
            "price above the penny-stock floor",
            "no pump-and-dump pattern, no accounting flags",
        ),
        entry_criteria=(
            "revenue growth above the floor",
            "current ratio above the floor, or net cash positive",
            "volume expansion versus the 20-session average",
            "price above its 126-session average",
        ),
        exit_criteria=(
            "growth falls below the floor",
            "liquidity deteriorates below the floor",
            "price closes below its 126-session average",
        ),
        sizing_method="fixed_fractional",
        expected_holding_days=120,
        risk_assumptions=(
            "smaller names gap harder and are far more expensive to exit",
            "position sizes must be bounded by ADV participation, not conviction",
            "sparse coverage means larger model uncertainty, so confidence is capped lower",
        ),
        invalidating_conditions=(
            "dollar volume falls below the liquidity floor",
            "dilution above the tolerance",
            "any accounting disclosure",
        ),
        supported_regimes=(Regime.RISK_ON,),
        max_positions=5,
        capacity_notes=(
            "Low capacity by construction. The ADV participation limit binds before the position "
            "limit does, and that is intentional."
        ),
    )
    default_params: dict[str, Any] = {
        "min_market_cap": 3e8,
        "max_market_cap": 2e10,
        "min_revenue_growth": 0.15,
        "min_current_ratio": 1.2,
        "min_volume_ratio": 1.1,
        "hard_min_adv_usd": 3e6,
        "max_dilution": 0.15,
        "trailing_stop_pct": 0.22,
    }

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        scored: list[tuple[float, str, dict[str, float | None]]] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            if ctx.pit.instrument(symbol).get("asset_class") == "etf":
                continue
            mcap = ctx.value(symbol, "market_cap")
            growth = ctx.value(symbol, "revenue_growth_yoy")
            adv = ctx.value(symbol, "adv_usd_20")
            current = ctx.value(symbol, "current_ratio")
            net_cash = ctx.value(symbol, "net_cash_to_mcap")
            vol_ratio = ctx.value(symbol, "volume_ratio_20")
            trend126 = ctx.value(symbol, "trend_126")
            dilution = ctx.value(symbol, "dilution_1y")
            insider = ctx.value(symbol, "insider_net_buy_usd")
            if None in (mcap, growth, adv):
                continue
            if not (self.params["min_market_cap"] <= mcap <= self.params["max_market_cap"]):
                continue
            if adv < self.params["hard_min_adv_usd"]:
                continue
            if growth < self.params["min_revenue_growth"]:
                continue
            liquid_balance = (current is not None and current >= self.params["min_current_ratio"]) or (
                net_cash is not None and net_cash > 0
            )
            if not liquid_balance:
                continue
            if vol_ratio is not None and vol_ratio < self.params["min_volume_ratio"]:
                continue
            if trend126 is None or trend126 <= 0:
                continue
            if dilution is not None and dilution > self.params["max_dilution"]:
                continue
            score = (
                float(np.clip(growth / 0.40, 0, 2.5)) * 1.5
                + float(np.clip((vol_ratio or 1.0) - 1.0, 0, 2)) * 0.8
                + float(np.clip(trend126 / 0.25, 0, 2)) * 0.7
                + (0.5 if (insider or 0) > 0 else 0.0)
            )
            scored.append(
                (
                    score,
                    symbol,
                    {
                        "market_cap": mcap,
                        "revenue_growth_yoy": growth,
                        "adv_usd_20": adv,
                        "current_ratio": current,
                        "net_cash_to_mcap": net_cash,
                        "volume_ratio_20": vol_ratio,
                        "trend_126": trend126,
                        "dilution_1y": dilution,
                        "insider_net_buy_usd": insider,
                    },
                )
            )
        if not scored:
            return []
        scored.sort(reverse=True, key=lambda t: t[0])
        best = scored[0][0] or 1.0
        out: list[StrategySignal] = []
        for score, symbol, inputs in scored[: self.meta.max_positions]:
            vol = ctx.value(symbol, "realized_vol_63") or 0.45
            strength = self._clip01(score / best if best > 0 else 0)
            confidence = self._confidence_from(
                self._clip01((inputs["revenue_growth_yoy"] or 0) / 0.40),
                self._clip01((inputs["trend_126"] or 0) / 0.25),
                strength,
                floor=0.32,
                cap=0.70,  # sparse coverage means genuinely higher model uncertainty
            )
            point = float(np.clip((inputs["revenue_growth_yoy"] or 0) * 0.6, 0.04, 0.50))
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
            news_count = ctx.value(symbol, "news_count_30")
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
                    downside_estimate=-min(0.5, vol * 0.9),
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{symbol} (${(inputs['market_cap'] or 0) / 1e9:.1f}B) grows revenue "
                        f"{_pct(inputs['revenue_growth_yoy'])} with a sound balance sheet and volume running "
                        f"{_num(inputs['volume_ratio_20'])}x average, while trading above its 126-session average."
                    ),
                    supporting_evidence=[
                        f"revenue growth {_pct(inputs['revenue_growth_yoy'])}",
                        f"20-day dollar volume ${(inputs['adv_usd_20'] or 0) / 1e6:.1f}M",
                        f"above the 126-session average by {_pct(inputs['trend_126'])}",
                    ]
                    + (
                        [f"net insider buying ${(inputs['insider_net_buy_usd'] or 0) / 1e6:.1f}M"]
                        if (inputs.get("insider_net_buy_usd") or 0) > 0
                        else []
                    ),
                    opposing_evidence=[
                        "smaller names gap harder and cost materially more to exit",
                        "position size is limited by daily volume participation, not by conviction",
                    ]
                    + (
                        [
                            f"only {int(news_count)} articles in 30 days — thin coverage means "
                            "the fundamental read carries all the weight"
                        ]
                        if news_count is not None and news_count < 3
                        else []
                    ),
                    exit_criteria={
                        "revenue_growth_below": 0.05,
                        "adv_usd_below": self.params["hard_min_adv_usd"],
                        "close_below_sma": 126,
                        "trailing_stop_pct": self.params["trailing_stop_pct"],
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    trailing_stop_pct=self.params["trailing_stop_pct"],
                    model_version=self.meta.version,
                )
            )
        return out

    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        adv = ctx.value(position.symbol, "adv_usd_20")
        growth = ctx.value(position.symbol, "revenue_growth_yoy")
        trend126 = ctx.value(position.symbol, "trend_126")
        inputs = {"adv_usd_20": adv, "revenue_growth_yoy": growth, "trend_126": trend126}
        if adv is not None and adv < self.params["hard_min_adv_usd"]:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.75,
                f"liquidity has fallen to ${adv / 1e6:.1f}M/day — exit while it is still possible",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if growth is not None and growth < 0.05:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.7,
                f"revenue growth has slowed to {_pct(growth)}",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if trend126 is not None and trend126 < -0.05:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "trim",
                0.6,
                "price has broken its 126-session average",
                thesis_status="weakening",
                target_fraction=0.5,
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key,
            position.symbol,
            "hold",
            0.5,
            "growth and liquidity intact",
            signal_inputs=inputs,
        )
