"""Tactical strategies: mean reversion, volatility targeting and regime allocation."""

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


class ShortTermMeanReversion(Strategy):
    """Buy short-term weakness inside a longer-term uptrend.

    The long-term trend filter is what keeps this from being a falling-knife
    strategy: it buys a pullback in something that is still working, never a
    breakdown.
    """

    meta = StrategyMeta(
        key="mean_reversion",
        name="Short-Term Mean Reversion",
        family="mean_reversion",
        description=(
            "Buys oversold pullbacks in names whose 200-session trend is still positive, exiting "
            "on reversion to the short-term mean."
        ),
        required_features=("mean_rev_z_10", "rsi_14", "trend_252"),
        required_data=("daily bars",),
        universe_rules=(
            "liquid names above the price floor",
            "200-session trend positive (no falling knives)",
        ),
        entry_criteria=(
            "10-session z-score below the oversold threshold",
            "RSI below the oversold threshold",
            "price still above its 252-session average",
            "no accounting or regulatory disclosure in the window",
        ),
        exit_criteria=(
            "z-score returns to or above zero",
            "RSI recovers above the exit level",
            "maximum holding period reached",
            "stop loss triggered",
        ),
        sizing_method="fixed_fractional",
        expected_holding_days=8,
        risk_assumptions=(
            "mean reversion fails badly in genuine downtrends, hence the trend filter",
            "high turnover makes this the most cost-sensitive sleeve",
            "the edge is small per trade and needs many observations",
        ),
        invalidating_conditions=(
            "benchmark below its 200-session average",
            "volatility regime above 2x its one-year level",
            "credit spreads widening sharply",
        ),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL),
        max_positions=5,
        capacity_notes="Limited by turnover and cost drag rather than by liquidity.",
    )
    default_params: dict[str, Any] = {
        "z_entry": -1.5,
        "rsi_entry": 35.0,
        "rsi_exit": 55.0,
        "max_holding_days": 15,
        "stop_pct": 0.07,
        "require_uptrend": True,
    }

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        # Regime gate: this sleeve is structurally unsafe in a downtrend.
        index_above = ctx.market("index_above_200sma")
        if index_above is not None and index_above < 1.0:
            return []

        scored: list[tuple[float, str, dict[str, float | None]]] = []
        for symbol in ctx.candidates():
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            z = ctx.value(symbol, "mean_rev_z_10")
            rsi = ctx.value(symbol, "rsi_14")
            trend252 = ctx.value(symbol, "trend_252")
            vol_regime = ctx.value(symbol, "vol_regime")
            regulatory = ctx.value(symbol, "has_regulatory_event_30")
            if None in (z, rsi, trend252):
                continue
            if z > self.params["z_entry"] or rsi > self.params["rsi_entry"]:
                continue
            if self.params["require_uptrend"] and trend252 <= 0:
                continue
            if vol_regime is not None and vol_regime > 2.0:
                continue
            if regulatory == 1.0:
                continue
            score = (-z) + (self.params["rsi_entry"] - rsi) / 20.0
            scored.append(
                (
                    score,
                    symbol,
                    {
                        "mean_rev_z_10": z,
                        "rsi_14": rsi,
                        "trend_252": trend252,
                        "vol_regime": vol_regime,
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
            atr = ctx.value(symbol, "atr_pct_14") or 0.02
            strength = self._clip01(score / best if best > 0 else 0)
            confidence = self._confidence_from(
                self._clip01(-(inputs["mean_rev_z_10"] or 0) / 3.0),
                self._clip01((self.params["rsi_entry"] - (inputs["rsi_14"] or 50)) / 20.0),
                self._clip01((inputs["trend_252"] or 0) / 0.20),
                floor=0.30,
                cap=0.70,  # short-horizon edge; never a high-conviction bet
            )
            point = float(np.clip(atr * 2.0, 0.01, 0.08))
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
                        f"{symbol} is {_num(inputs['mean_rev_z_10'])} standard deviations below its 10-session "
                        f"mean with RSI at {_num(inputs['rsi_14'], 0)}, while still "
                        f"{_pct(inputs['trend_252'])} above its 252-session average — an oversold pullback "
                        "inside an intact uptrend."
                    ),
                    supporting_evidence=[
                        f"10-session z-score {_num(inputs['mean_rev_z_10'])}",
                        f"RSI(14) {_num(inputs['rsi_14'], 0)}",
                        f"long-term trend still positive ({_pct(inputs['trend_252'])})",
                    ],
                    opposing_evidence=[
                        "buying weakness fails when the pullback is the start of a real decline",
                        f"short holding period means costs are a large share of the {_pct(point)} target",
                    ],
                    exit_criteria={
                        "z_above": 0.0,
                        "rsi_above": self.params["rsi_exit"],
                        "max_holding_days": self.params["max_holding_days"],
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
        z = ctx.value(position.symbol, "mean_rev_z_10")
        rsi = ctx.value(position.symbol, "rsi_14")
        inputs = {"mean_rev_z_10": z, "rsi_14": rsi}
        if position.holding_days >= self.params["max_holding_days"]:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.75,
                f"held {position.holding_days} sessions — beyond the mean-reversion window",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if (z is not None and z >= 0) or (rsi is not None and rsi >= self.params["rsi_exit"]):
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.7,
                "price has reverted to its short-term mean — target reached",
                thesis_status="intact",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key,
            position.symbol,
            "hold",
            0.5,
            "still oversold; awaiting reversion",
            signal_inputs=inputs,
        )


class VolatilityTargetCore(Strategy):
    """A volatility-targeted core holding in the broad growth benchmark.

    Not a stock-selection strategy: it holds the index and lets sizing do the
    work, scaling exposure inversely to realised volatility. This is the sleeve
    that keeps the portfolio participating in a broad advance when nothing else
    passes its filters — cash drag is a real cost in a growth mandate.
    """

    meta = StrategyMeta(
        key="vol_target_core",
        name="Volatility-Targeted Core",
        family="volatility_targeting",
        description=(
            "Holds broad growth ETFs with exposure scaled inversely to realised volatility, "
            "targeting a constant risk contribution."
        ),
        required_features=("realized_vol_21", "trend_200_proxy"),
        required_data=("daily bars for the core ETFs",),
        universe_rules=(
            "explicit ETF list only (default QQQ, SPY, VUG)",
            "instrument must not be leveraged or inverse",
        ),
        entry_criteria=(
            "the ETF is above its 200-session average",
            "realised volatility below the ceiling",
        ),
        exit_criteria=(
            "the ETF closes below its 200-session average",
            "realised volatility exceeds the ceiling",
        ),
        sizing_method="volatility_target",
        expected_holding_days=250,
        risk_assumptions=(
            "index exposure is beta, not alpha — its job is participation, not outperformance",
            "volatility targeting reduces drawdowns but lags in a fast recovery",
        ),
        invalidating_conditions=("benchmark below its 200-session average",),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL),
        max_positions=2,
        min_history_bars=220,
        capacity_notes="Effectively unlimited capacity in major ETFs.",
    )
    default_params: dict[str, Any] = {
        "core_symbols": ["QQQ", "VUG", "SPY"],
        "target_vol": 0.18,
        "max_vol": 0.35,
        "trailing_stop_pct": 0.25,
    }

    #: The 200-day trend is read from ``trend_252`` / ``trend_126``; the named
    #: requirement above is documentation, so exclude it from the hard gate.
    def eligible(self, ctx: StrategyContext, symbol: str) -> tuple[bool, str | None]:
        sf = ctx.f(symbol)
        if sf is None:
            return False, "no features computed"
        if not ctx.pit.has(symbol, min_bars=self.meta.min_history_bars):
            return False, "insufficient history"
        if ctx.pit.instrument(symbol).get("is_leveraged_etf"):
            return False, "leveraged/inverse ETF"
        return True, None

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        out: list[StrategySignal] = []
        for symbol in self.params["core_symbols"]:
            symbol = symbol.upper()
            if symbol not in ctx.features.symbols:
                continue
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            vol21 = ctx.value(symbol, "realized_vol_21")
            trend = ctx.value(symbol, "trend_252") or ctx.value(symbol, "trend_126")
            if vol21 is None or trend is None:
                continue
            if trend <= 0 or vol21 > self.params["max_vol"]:
                continue
            # Exposure scalar is the sizing hint; the risk engine still caps it.
            scalar = float(np.clip(self.params["target_vol"] / max(vol21, 0.02), 0.25, 1.0))
            strength = scalar
            confidence = self._confidence_from(self._clip01(trend / 0.15), self._clip01(scalar), floor=0.40, cap=0.80)
            point = 0.08 * scalar
            er, lo, hi = self._expected_return_band(point, vol21, self.meta.expected_holding_days)
            inputs = {
                "realized_vol_21": vol21,
                "trend_252": trend,
                "vol_target_scalar": scalar,
                "target_vol": self.params["target_vol"],
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
                    expected_vol=vol21,
                    downside_estimate=-min(0.30, vol21 * 1.2),
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"{symbol} is {_pct(trend)} above its long-term average with realised volatility at "
                        f"{_pct(vol21)}; exposure is scaled to {scalar:.0%} to target "
                        f"{_pct(self.params['target_vol'])} portfolio volatility."
                    ),
                    supporting_evidence=[
                        f"long-term trend positive ({_pct(trend)})",
                        f"realised volatility {_pct(vol21)} versus a {_pct(self.params['target_vol'])} target",
                        f"exposure scalar {scalar:.0%}",
                    ],
                    opposing_evidence=[
                        "this is index beta, not alpha — it will not outperform the benchmark",
                        "volatility targeting lags in a sharp recovery off a low",
                    ],
                    exit_criteria={
                        "close_below_sma": 200,
                        "realized_vol_above": self.params["max_vol"],
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
        trend = ctx.value(position.symbol, "trend_252")
        vol21 = ctx.value(position.symbol, "realized_vol_21")
        inputs = {"trend_252": trend, "realized_vol_21": vol21}
        if trend is not None and trend < 0:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.7,
                "the core holding has broken its long-term average — reduce to cash",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if vol21 is not None and vol21 > self.params["max_vol"]:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "trim",
                0.65,
                f"realised volatility at {_pct(vol21)} exceeds the ceiling — cut exposure",
                thesis_status="weakening",
                target_fraction=float(np.clip(self.params["target_vol"] / max(vol21, 0.02), 0.25, 1.0)),
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key,
            position.symbol,
            "hold",
            0.55,
            "core exposure at target risk",
            signal_inputs=inputs,
        )


class RegimeGrowthAllocation(Strategy):
    """Regime-aware allocation between growth and defensive posture.

    Reads the composite risk-on score and allocates the growth ETF sleeve
    accordingly: full in risk-on, reduced in neutral, nothing new in risk-off.
    Cash is an active allocation here, not a leftover.
    """

    meta = StrategyMeta(
        key="regime_allocation",
        name="Market-Regime Growth Allocation",
        family="regime_allocation",
        description=(
            "Allocates to Nasdaq-100 and growth ETFs in proportion to the composite risk-on "
            "score, holding cash when the regime does not pay for risk."
        ),
        required_features=(),
        required_data=("benchmark bars", "macro series (rates, credit, volatility)"),
        universe_rules=("explicit growth-ETF list only",),
        entry_criteria=(
            "risk-on score above the entry threshold",
            "benchmark above its 200-session average",
            "the target ETF's own trend is positive",
        ),
        exit_criteria=(
            "risk-on score falls below the exit threshold",
            "benchmark closes below its 200-session average",
        ),
        sizing_method="risk_parity",
        expected_holding_days=200,
        risk_assumptions=(
            "regime signals lag turning points; some drawdown is unavoidable",
            "whipsaw around the threshold costs money, so hysteresis is required",
        ),
        invalidating_conditions=(
            "macro series unavailable, leaving the regime unclassifiable",
            "risk-on score below the exit threshold",
        ),
        supported_regimes=(Regime.RISK_ON, Regime.NEUTRAL),
        max_positions=2,
        min_history_bars=220,
        capacity_notes="Unlimited capacity; ETF-only.",
    )
    default_params: dict[str, Any] = {
        "growth_symbols": ["QQQ", "VUG"],
        "entry_risk_on": 0.15,
        "exit_risk_on": -0.10,
        "neutral_scale": 0.5,
        "trailing_stop_pct": 0.22,
    }

    def eligible(self, ctx: StrategyContext, symbol: str) -> tuple[bool, str | None]:
        if ctx.pit.instrument(symbol).get("is_leveraged_etf"):
            return False, "leveraged/inverse ETF"
        if not ctx.pit.has(symbol, min_bars=self.meta.min_history_bars):
            return False, "insufficient history"
        return True, None

    def generate(self, ctx: StrategyContext) -> list[StrategySignal]:
        risk_on = ctx.market("risk_on_score")
        if risk_on is None:
            return []  # unclassifiable regime -> no new exposure
        if risk_on < self.params["entry_risk_on"]:
            return []
        index_above = ctx.market("index_above_200sma")
        if index_above is not None and index_above < 1.0:
            return []

        scale = 1.0 if ctx.regime is Regime.RISK_ON else self.params["neutral_scale"]
        out: list[StrategySignal] = []
        for symbol in self.params["growth_symbols"]:
            symbol = symbol.upper()
            if symbol not in ctx.features.symbols:
                continue
            ok, _ = self.eligible(ctx, symbol)
            if not ok:
                continue
            trend = ctx.value(symbol, "trend_126")
            vol = ctx.value(symbol, "realized_vol_63") or 0.20
            if trend is None or trend <= 0:
                continue
            strength = self._clip01(scale * (0.5 + risk_on / 2))
            confidence = self._confidence_from(
                self._clip01((risk_on + 1) / 2), self._clip01(trend / 0.12), floor=0.38, cap=0.82
            )
            point = float(np.clip(0.10 * scale * (0.5 + risk_on), 0.01, 0.22))
            er, lo, hi = self._expected_return_band(point, vol, self.meta.expected_holding_days)
            inputs = {
                "risk_on_score": risk_on,
                "trend_126": trend,
                "regime_scale": scale,
                "index_above_200sma": index_above,
                "vix_percentile_252": ctx.market("vix_percentile_252"),
                "credit_spread_change_63d": ctx.market("credit_spread_change_63d"),
                "breadth_above_200sma": ctx.market("breadth_above_200sma"),
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
                    downside_estimate=-min(0.28, vol * 1.2),
                    expected_holding_days=self.meta.expected_holding_days,
                    thesis=(
                        f"The composite risk-on score is {risk_on:+.2f} with the benchmark above its "
                        f"200-session average, so growth exposure is warranted at {scale:.0%} scale "
                        f"through {symbol}."
                    ),
                    supporting_evidence=[
                        f"risk-on score {risk_on:+.2f}",
                        f"{symbol} above its 126-session average by {_pct(trend)}",
                    ]
                    + (
                        [f"market breadth {_pct(inputs['breadth_above_200sma'])} above the 200-day average"]
                        if inputs.get("breadth_above_200sma") is not None
                        else []
                    ),
                    opposing_evidence=["regime signals lag turning points; a reversal will be caught late"]
                    + (
                        [f"credit spreads widened {_num(inputs['credit_spread_change_63d'])}pp over 63 sessions"]
                        if (inputs.get("credit_spread_change_63d") or 0) > 0.1
                        else []
                    ),
                    exit_criteria={
                        "risk_on_below": self.params["exit_risk_on"],
                        "close_below_sma": 200,
                        "trailing_stop_pct": self.params["trailing_stop_pct"],
                    },
                    invalidating_conditions=list(self.meta.invalidating_conditions),
                    signal_inputs=inputs,
                    trailing_stop_pct=self.params["trailing_stop_pct"],
                    model_version=self.meta.version,
                )
            )
        return out[: self.meta.max_positions]

    def review(self, ctx: StrategyContext, position: OpenPositionState) -> PositionReview:
        risk_on = ctx.market("risk_on_score")
        index_above = ctx.market("index_above_200sma")
        inputs = {"risk_on_score": risk_on, "index_above_200sma": index_above}
        if risk_on is not None and risk_on < self.params["exit_risk_on"]:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "exit",
                0.72,
                f"risk-on score has fallen to {risk_on:+.2f} — move to cash",
                thesis_status="invalidated",
                target_fraction=0.0,
                signal_inputs=inputs,
            )
        if index_above is not None and index_above < 1.0:
            return PositionReview(
                self.meta.key,
                position.symbol,
                "trim",
                0.65,
                "the benchmark has lost its 200-session average — halve growth exposure",
                thesis_status="weakening",
                target_fraction=0.5,
                signal_inputs=inputs,
            )
        return PositionReview(
            self.meta.key,
            position.symbol,
            "hold",
            0.55,
            "regime still supports growth exposure",
            signal_inputs=inputs,
        )
