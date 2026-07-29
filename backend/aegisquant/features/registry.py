"""The feature registry.

Every signal the platform can use is declared here with its definition, unit,
expected range, dependencies, **availability delay** and version. The delay is
the load-bearing field: it records how long after an event the value could
actually have been known, and the point-in-time layer refuses to serve a feature
earlier than that.

Adding a feature means adding a :class:`FeatureDef` — nothing computes a signal
that is not registered, so the registry is always a complete inventory.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

Category = Literal["market_structure", "fundamental", "macro", "news", "composite"]


@dataclass(frozen=True, slots=True)
class FeatureDef:
    name: str
    category: Category
    description: str
    unit: str
    version: str = "1.0.0"
    expected_min: float | None = None
    expected_max: float | None = None
    depends_on: tuple[str, ...] = ()
    #: Hours after the observation before the value is legitimately usable.
    #: Price features are observable at the bar close (0); fundamentals inherit
    #: the filing lag from the provider record's ``observed_at`` (0 here because
    #: the loader already filters on it); news is usable once published.
    availability_delay_hours: float = 0.0
    #: Market-level features are computed once per ``as_of`` for all symbols.
    market_level: bool = False
    higher_is_better: bool | None = None
    notes: str = ""
    tags: tuple[str, ...] = ()

    def validate(self, value: float | None) -> tuple[float | None, str | None]:
        """Range-check a computed value. Out-of-range values are kept but flagged."""
        if value is None:
            return None, "missing"
        if value != value:  # NaN
            return None, "nan"
        if value in (float("inf"), float("-inf")):
            return None, "infinite"
        if self.expected_min is not None and value < self.expected_min:
            return value, f"below expected_min ({self.expected_min})"
        if self.expected_max is not None and value > self.expected_max:
            return value, f"above expected_max ({self.expected_max})"
        return value, None


@dataclass
class FeatureRegistry:
    features: dict[str, FeatureDef] = field(default_factory=dict)

    def add(self, definition: FeatureDef) -> FeatureDef:
        if definition.name in self.features:
            raise ValueError(f"duplicate feature '{definition.name}'")
        self.features[definition.name] = definition
        return definition

    def get(self, name: str) -> FeatureDef:
        try:
            return self.features[name]
        except KeyError:
            raise KeyError(f"feature '{name}' is not registered") from None

    def by_category(self, category: Category) -> list[FeatureDef]:
        return [f for f in self.features.values() if f.category == category]

    def names(self) -> list[str]:
        return sorted(self.features)

    def market_level_names(self) -> list[str]:
        return sorted(n for n, f in self.features.items() if f.market_level)

    def as_dicts(self) -> list[dict[str, Any]]:
        return [
            {
                "name": f.name,
                "category": f.category,
                "description": f.description,
                "unit": f.unit,
                "version": f.version,
                "expected_min": f.expected_min,
                "expected_max": f.expected_max,
                "depends_on": list(f.depends_on),
                "availability_delay_hours": f.availability_delay_hours,
                "market_level": f.market_level,
                "higher_is_better": f.higher_is_better,
                "notes": f.notes,
                "tags": list(f.tags),
            }
            for f in sorted(self.features.values(), key=lambda x: (x.category, x.name))
        ]

    def version_hash(self) -> str:
        """Stable hash of the whole registry — stamped onto every snapshot."""
        payload = "|".join(f"{f.name}:{f.version}" for f in sorted(self.features.values(), key=lambda x: x.name))
        return hashlib.sha256(payload.encode()).hexdigest()[:12]


REGISTRY = FeatureRegistry()
F = REGISTRY.add


def _f(
    name: str,
    category: Category,
    description: str,
    unit: str,
    *,
    lo: float | None = None,
    hi: float | None = None,
    deps: tuple[str, ...] = (),
    delay: float = 0.0,
    market: bool = False,
    better: bool | None = None,
    notes: str = "",
    tags: tuple[str, ...] = (),
    version: str = "1.0.0",
) -> FeatureDef:
    return F(
        FeatureDef(
            name=name,
            category=category,
            description=description,
            unit=unit,
            expected_min=lo,
            expected_max=hi,
            depends_on=deps,
            availability_delay_hours=delay,
            market_level=market,
            higher_is_better=better,
            notes=notes,
            tags=tags,
            version=version,
        )
    )


# ---------------------------------------------------------------------------
# Market structure
# ---------------------------------------------------------------------------
_f("trend_20", "market_structure", "Close vs 20-session SMA", "ratio-1", lo=-0.9, hi=3.0, deps=("close",), better=True, tags=("trend",))
_f("trend_63", "market_structure", "Close vs 63-session SMA", "ratio-1", lo=-0.9, hi=5.0, deps=("close",), better=True, tags=("trend",))
_f("trend_126", "market_structure", "Close vs 126-session SMA", "ratio-1", lo=-0.9, hi=8.0, deps=("close",), better=True, tags=("trend",))
_f("trend_252", "market_structure", "Close vs 252-session SMA", "ratio-1", lo=-0.95, hi=12.0, deps=("close",), better=True, tags=("trend",))
_f("trend_quality_126", "market_structure", "R-squared of log-price linear fit over 126 sessions", "r2", lo=0.0, hi=1.0, deps=("close",), better=True, notes="separates a smooth uptrend from a volatile one", tags=("trend",))
_f("trend_slope_126", "market_structure", "Annualised slope of the 126-session log-price fit", "ann-return", lo=-5.0, hi=8.0, deps=("close",), better=True, tags=("trend",))
_f("rel_strength_63", "market_structure", "63-session return minus benchmark return", "ratio", lo=-2.0, hi=5.0, deps=("close", "benchmark_close"), better=True, tags=("momentum",))
_f("rel_strength_126", "market_structure", "126-session return minus benchmark return", "ratio", lo=-2.0, hi=8.0, deps=("close", "benchmark_close"), better=True, tags=("momentum",))
_f("rel_strength_252", "market_structure", "252-session return minus benchmark return", "ratio", lo=-3.0, hi=15.0, deps=("close", "benchmark_close"), better=True, tags=("momentum",))
_f("momentum_12_1", "market_structure", "12-month return skipping the most recent month", "ratio", lo=-1.0, hi=15.0, deps=("close",), better=True, notes="classic cross-sectional momentum definition; the skip avoids short-term reversal", tags=("momentum",))
_f("vol_adj_momentum_126", "market_structure", "126-session return divided by realised volatility", "sharpe-like", lo=-8.0, hi=12.0, deps=("close",), better=True, tags=("momentum",))
_f("breakout_55", "market_structure", "Close vs 55-session Donchian high", "ratio-1", lo=-0.9, hi=1.0, deps=("close", "high"), better=True, tags=("breakout",))
_f("breakout_252", "market_structure", "Close vs 252-session high", "ratio-1", lo=-0.99, hi=1.0, deps=("close", "high"), better=True, tags=("breakout",))
_f("consolidation_days", "market_structure", "Sessions since the 55-session range last exceeded 25%", "sessions", lo=0, hi=500, deps=("high", "low"), better=True, notes="long quiet bases precede the highest-quality breakouts", tags=("breakout",))
_f("base_tightness_55", "market_structure", "55-session (high-low)/close range width", "ratio", lo=0.0, hi=5.0, deps=("high", "low", "close"), better=False, tags=("breakout",))
_f("mean_rev_z_10", "market_structure", "Z-score of close vs its 10-session mean", "sigma", lo=-8.0, hi=8.0, deps=("close",), better=False, tags=("mean_reversion",))
_f("rsi_14", "market_structure", "14-session Wilder RSI", "index", lo=0.0, hi=100.0, deps=("close",), tags=("mean_reversion",))
_f("atr_pct_14", "market_structure", "14-session ATR as a fraction of close", "ratio", lo=0.0, hi=1.0, deps=("high", "low", "close"), better=False, tags=("volatility",))
_f("realized_vol_21", "market_structure", "Annualised 21-session realised volatility", "ann-vol", lo=0.0, hi=5.0, deps=("close",), better=False, tags=("volatility",))
_f("realized_vol_63", "market_structure", "Annualised 63-session realised volatility", "ann-vol", lo=0.0, hi=5.0, deps=("close",), better=False, tags=("volatility",))
_f("vol_regime", "market_structure", "21-session vol divided by 252-session vol", "ratio", lo=0.0, hi=10.0, deps=("close",), better=False, notes=">1.5 means volatility is expanding", tags=("volatility",))
_f("downside_vol_63", "market_structure", "Annualised volatility of negative returns only", "ann-vol", lo=0.0, hi=5.0, deps=("close",), better=False, tags=("volatility",))
_f("volume_ratio_20", "market_structure", "Latest volume vs its 20-session average", "ratio", lo=0.0, hi=50.0, deps=("volume",), tags=("volume",))
_f("accumulation_20", "market_structure", "Up-volume minus down-volume over 20 sessions, scaled by total volume", "ratio", lo=-1.0, hi=1.0, deps=("close", "volume"), better=True, notes="proxy for institutional accumulation", tags=("volume",))
_f("obv_slope_63", "market_structure", "Normalised slope of on-balance volume over 63 sessions", "ratio", lo=-5.0, hi=5.0, deps=("close", "volume"), better=True, tags=("volume",))
_f("adv_usd_20", "market_structure", "20-session average daily dollar volume", "usd", lo=0.0, deps=("close", "volume"), better=True, tags=("liquidity",))
_f("turnover_20", "market_structure", "20-session average volume divided by shares outstanding", "ratio", lo=0.0, hi=5.0, deps=("volume", "shares_outstanding"), tags=("liquidity",))
_f("gap_pct", "market_structure", "Latest open vs prior close", "ratio", lo=-0.9, hi=3.0, deps=("open", "close"), tags=("gap",))
_f("gap_risk_63", "market_structure", "Mean absolute overnight gap over 63 sessions", "ratio", lo=0.0, hi=1.0, deps=("open", "close"), better=False, tags=("gap",))
_f("corr_benchmark_63", "market_structure", "63-session return correlation with the benchmark", "corr", lo=-1.0, hi=1.0, deps=("close", "benchmark_close"), tags=("correlation",))
_f("corr_change_63_252", "market_structure", "63-session benchmark correlation minus the 252-session value", "corr-delta", lo=-2.0, hi=2.0, deps=("close", "benchmark_close"), notes="rising correlation reduces diversification benefit", tags=("correlation",))
_f("beta_252", "market_structure", "252-session OLS beta to the benchmark", "beta", lo=-5.0, hi=6.0, deps=("close", "benchmark_close"), tags=("correlation",))
_f("downside_capture_252", "market_structure", "Mean return on benchmark down-days divided by the benchmark's", "ratio", lo=-5.0, hi=5.0, deps=("close", "benchmark_close"), better=False, tags=("correlation",))
_f("recovery_speed_63", "market_structure", "Fraction of its 63-session drawdown the name has recovered", "ratio", lo=0.0, hi=1.0, deps=("close",), better=True, notes="fast recovery after market declines is a leadership tell", tags=("trend",))
_f("drawdown_252", "market_structure", "Current drawdown from the 252-session high", "ratio", lo=-1.0, hi=0.0, deps=("close",), better=True, tags=("risk",))
_f("dist_52w_high", "market_structure", "Close vs the 252-session high", "ratio-1", lo=-1.0, hi=0.5, deps=("close", "high"), better=True, tags=("trend",))
_f("dist_52w_low", "market_structure", "Close vs the 252-session low", "ratio-1", lo=0.0, hi=30.0, deps=("close", "low"), better=True, tags=("trend",))
_f("sector_rel_strength_126", "market_structure", "126-session return minus the equal-weighted sector composite", "ratio", lo=-3.0, hi=8.0, deps=("close",), better=True, tags=("sector",))

# Market-level structure
_f("breadth_above_200sma", "market_structure", "Share of the universe trading above its 200-session SMA", "ratio", lo=0.0, hi=1.0, market=True, better=True, tags=("breadth",))
_f("breadth_advance_decline_20", "market_structure", "Advancing minus declining names over 20 sessions, scaled", "ratio", lo=-1.0, hi=1.0, market=True, better=True, tags=("breadth",))
_f("breadth_new_high_low_63", "market_structure", "New 63-session highs minus new lows, scaled by universe size", "ratio", lo=-1.0, hi=1.0, market=True, better=True, tags=("breadth",))
_f("sector_momentum_dispersion", "market_structure", "Cross-sector standard deviation of 63-session returns", "ratio", lo=0.0, hi=2.0, market=True, notes="high dispersion favours sector-selection strategies", tags=("sector",))
_f("sector_rotation_leader_count", "market_structure", "Number of sectors with positive 63-session relative strength", "count", lo=0, hi=40, market=True, tags=("sector",))
_f("avg_pairwise_correlation_63", "market_structure", "Mean pairwise 63-session return correlation across the universe", "corr", lo=-1.0, hi=1.0, market=True, better=False, notes="rises in stress; shrinks true diversification", tags=("correlation", "breadth"))

# ---------------------------------------------------------------------------
# Fundamentals (availability governed by the record's observed_at)
# ---------------------------------------------------------------------------
_f("revenue_growth_yoy", "fundamental", "Year-over-year revenue growth, most recent reported period", "ratio", lo=-1.0, hi=20.0, deps=("fundamentals.revenue",), better=True, tags=("growth",))
_f("revenue_growth_accel", "fundamental", "Latest revenue YoY minus the prior period's YoY", "ratio-delta", lo=-10.0, hi=10.0, deps=("fundamentals.revenue",), better=True, notes="acceleration, not level, is the growth signal", tags=("growth", "acceleration"))
_f("eps_growth_yoy", "fundamental", "Year-over-year EPS growth", "ratio", lo=-20.0, hi=30.0, deps=("fundamentals.eps",), better=True, tags=("growth",))
_f("eps_growth_accel", "fundamental", "Latest EPS YoY minus the prior period's YoY", "ratio-delta", lo=-20.0, hi=20.0, deps=("fundamentals.eps",), better=True, tags=("growth", "acceleration"))
_f("fcf_growth_yoy", "fundamental", "Year-over-year free-cash-flow growth", "ratio", lo=-20.0, hi=30.0, deps=("fundamentals.free_cash_flow",), better=True, tags=("growth",))
_f("gross_margin", "fundamental", "Gross profit divided by revenue", "ratio", lo=-1.0, hi=1.0, deps=("fundamentals.gross_margin",), better=True, tags=("quality",))
_f("gross_margin_delta_yoy", "fundamental", "Gross-margin change versus the year-ago period", "ratio-delta", lo=-1.0, hi=1.0, deps=("fundamentals.gross_margin",), better=True, notes="margin expansion is the cleanest operating-leverage tell", tags=("quality", "acceleration"))
_f("operating_margin", "fundamental", "Operating income divided by revenue", "ratio", lo=-5.0, hi=1.0, deps=("fundamentals.operating_margin",), better=True, tags=("quality",))
_f("operating_leverage", "fundamental", "Operating-income growth divided by revenue growth", "ratio", lo=-20.0, hi=20.0, deps=("fundamentals.operating_income", "fundamentals.revenue"), better=True, tags=("quality",))
_f("fcf_margin", "fundamental", "Free cash flow divided by revenue", "ratio", lo=-10.0, hi=1.0, deps=("fundamentals.free_cash_flow", "fundamentals.revenue"), better=True, tags=("quality",))
_f("fcf_conversion", "fundamental", "Free cash flow divided by net income", "ratio", lo=-20.0, hi=20.0, deps=("fundamentals.free_cash_flow", "fundamentals.net_income"), better=True, notes="low conversion with high reported earnings is an accounting-quality flag", tags=("earnings_quality",))
_f("accruals_ratio", "fundamental", "(Net income - operating cash flow) / revenue", "ratio", lo=-5.0, hi=5.0, deps=("fundamentals.accruals_ratio",), better=False, notes="high accruals predict lower future returns (Sloan)", tags=("earnings_quality",))
_f("debt_to_equity", "fundamental", "Total debt divided by shareholders' equity", "ratio", lo=0.0, hi=50.0, deps=("fundamentals.debt_to_equity",), better=False, tags=("leverage",))
_f("current_ratio", "fundamental", "Current assets divided by current liabilities", "ratio", lo=0.0, hi=30.0, deps=("fundamentals.current_ratio",), better=True, tags=("leverage",))
_f("net_cash_to_mcap", "fundamental", "(Cash - total debt) divided by market capitalisation", "ratio", lo=-20.0, hi=5.0, deps=("fundamentals.cash", "fundamentals.total_debt", "fundamentals.market_cap"), better=True, tags=("leverage",))
_f("roic", "fundamental", "Return on invested capital", "ratio", lo=-5.0, hi=3.0, deps=("fundamentals.roic",), better=True, tags=("quality",))
_f("pe_ratio", "fundamental", "Price divided by trailing earnings", "ratio", lo=-1000.0, hi=5000.0, deps=("fundamentals.pe_ratio",), better=False, tags=("valuation",))
_f("ps_ratio", "fundamental", "Price divided by trailing sales", "ratio", lo=0.0, hi=500.0, deps=("fundamentals.ps_ratio",), better=False, tags=("valuation",))
_f("ev_to_sales", "fundamental", "Enterprise value divided by trailing sales", "ratio", lo=0.0, hi=500.0, deps=("fundamentals.ev_to_sales",), better=False, tags=("valuation",))
_f("growth_adjusted_ps", "fundamental", "Price/sales divided by revenue growth — a GARP screen", "ratio", lo=0.0, hi=500.0, deps=("ps_ratio", "revenue_growth_yoy"), better=False, notes="undefined for non-growers; left missing rather than defaulted", tags=("valuation", "garp"))
_f("market_cap", "fundamental", "Market capitalisation", "usd", lo=0.0, deps=("fundamentals.market_cap",), tags=("size",))
_f("recurring_revenue_pct", "fundamental", "Share of revenue that is recurring", "ratio", lo=0.0, hi=1.0, deps=("fundamentals.recurring_revenue_pct",), better=True, tags=("durability",))
_f("rnd_intensity", "fundamental", "R&D expense divided by revenue", "ratio", lo=0.0, hi=5.0, deps=("fundamentals.rnd_expense", "fundamentals.revenue"), tags=("durability",))
_f("short_interest_pct", "fundamental", "Short interest as a share of float", "ratio", lo=0.0, hi=1.0, deps=("fundamentals.short_interest_pct",), better=False, tags=("risk",))
_f("insider_net_buy_usd", "fundamental", "Net insider buying in dollars", "usd", deps=("fundamentals.insider_net_buy_usd",), better=True, tags=("risk",))
_f("fundamental_momentum", "fundamental", "Composite of growth acceleration, margin expansion and ROIC change", "z-score", lo=-6.0, hi=6.0, deps=("revenue_growth_accel", "gross_margin_delta_yoy", "roic"), better=True, tags=("acceleration",))
_f("dilution_1y", "fundamental", "Year-over-year growth in shares outstanding", "ratio", lo=-1.0, hi=10.0, deps=("fundamentals.shares_outstanding",), better=False, notes="growth funded by share issuance is lower quality", tags=("risk",))
_f("periods_available", "fundamental", "Count of reported periods visible at this point in time", "count", lo=0, hi=60, tags=("meta",))

# ---------------------------------------------------------------------------
# Macro / regime (market level)
# ---------------------------------------------------------------------------
_f("rate_10y", "macro", "10-year Treasury yield", "percent", lo=-5.0, hi=25.0, market=True, delay=24.0, tags=("rates",))
_f("rate_2y", "macro", "2-year Treasury yield", "percent", lo=-5.0, hi=25.0, market=True, delay=24.0, tags=("rates",))
_f("yield_curve_slope", "macro", "10-year minus 2-year Treasury yield", "percent", lo=-6.0, hi=6.0, market=True, delay=24.0, better=True, notes="sustained inversion has preceded most US recessions", tags=("rates",))
_f("rate_change_63d", "macro", "63-session change in the 10-year yield", "percent-delta", lo=-10.0, hi=10.0, market=True, delay=24.0, better=False, tags=("rates",))
_f("inflation_level", "macro", "Latest headline inflation reading", "percent", lo=-10.0, hi=50.0, market=True, delay=384.0, tags=("inflation",))
_f("inflation_trend", "macro", "Change in the inflation reading over the last four releases", "percent-delta", lo=-30.0, hi=30.0, market=True, delay=384.0, better=False, tags=("inflation",))
_f("credit_spread", "macro", "High-yield credit spread", "percent", lo=0.0, hi=40.0, market=True, delay=24.0, better=False, tags=("credit",))
_f("credit_spread_change_63d", "macro", "63-session change in the high-yield spread", "percent-delta", lo=-20.0, hi=20.0, market=True, delay=24.0, better=False, notes="widening credit is the earliest reliable risk-off signal", tags=("credit",))
_f("vix_level", "macro", "Equity implied-volatility index level", "index", lo=0.0, hi=200.0, market=True, delay=24.0, better=False, tags=("volatility",))
_f("vix_percentile_252", "macro", "Percentile rank of VIX within the last 252 observations", "percentile", lo=0.0, hi=1.0, market=True, delay=24.0, better=False, tags=("volatility",))
_f("index_trend_200", "macro", "Benchmark close vs its 200-session SMA", "ratio-1", lo=-0.9, hi=1.5, market=True, better=True, tags=("index",))
_f("index_above_200sma", "macro", "1 when the benchmark is above its 200-session SMA, else 0", "boolean", lo=0.0, hi=1.0, market=True, better=True, tags=("index",))
_f("index_drawdown", "macro", "Benchmark drawdown from its 252-session high", "ratio", lo=-1.0, hi=0.0, market=True, better=True, tags=("index",))
_f("risk_on_score", "macro", "Composite risk appetite score in [-1, 1]", "score", lo=-1.0, hi=1.0, market=True, better=True, deps=("index_trend_200", "vix_percentile_252", "credit_spread_change_63d", "breadth_above_200sma"), tags=("regime",))

# ---------------------------------------------------------------------------
# News (publication time is preserved; nothing is visible before it)
# ---------------------------------------------------------------------------
_f("news_count_7", "news", "Articles published in the trailing 7 days", "count", lo=0, hi=1000, tags=("coverage",))
_f("news_count_30", "news", "Articles published in the trailing 30 days", "count", lo=0, hi=5000, tags=("coverage",))
_f("news_sentiment_7", "news", "Credibility-weighted mean sentiment over 7 days", "score", lo=-1.0, hi=1.0, better=True, notes="missing when no scored article exists; absence is never read as negative", tags=("sentiment",))
_f("news_sentiment_30", "news", "Credibility-weighted mean sentiment over 30 days", "score", lo=-1.0, hi=1.0, better=True, tags=("sentiment",))
_f("news_sentiment_trend", "news", "7-day sentiment minus 30-day sentiment", "score-delta", lo=-2.0, hi=2.0, better=True, tags=("sentiment",))
_f("news_uncertainty_30", "news", "Mean uncertainty score across recent coverage", "score", lo=0.0, hi=1.0, better=False, tags=("sentiment",))
_f("news_novelty_max_7", "news", "Highest novelty score in the trailing 7 days", "score", lo=0.0, hi=1.0, better=True, notes="repeat coverage of a known story carries little information", tags=("event",))
_f("news_credibility_mean_30", "news", "Mean source credibility across recent coverage", "score", lo=0.0, hi=1.0, better=True, tags=("sentiment",))
_f("has_earnings_event_7", "news", "1 when an earnings item was published in 7 days", "boolean", lo=0.0, hi=1.0, tags=("event",))
_f("has_regulatory_event_30", "news", "1 when a regulatory item was published in 30 days", "boolean", lo=0.0, hi=1.0, better=False, tags=("event",))
_f("has_management_change_30", "news", "1 when a management-change item was published in 30 days", "boolean", lo=0.0, hi=1.0, tags=("event",))
_f("has_accounting_flag_90", "news", "1 when an accounting or restatement item appeared in 90 days", "boolean", lo=0.0, hi=1.0, better=False, notes="hard disqualifier for new entries", tags=("event", "risk"))
_f("has_corporate_action_30", "news", "1 when a material corporate action was recorded in 30 days", "boolean", lo=0.0, hi=1.0, tags=("event",))
_f("days_since_earnings", "news", "Sessions since the most recent reported period became public", "sessions", lo=0, hi=400, tags=("event",))
_f("pead_drift_20", "news", "Return since the last earnings publication", "ratio", lo=-1.0, hi=5.0, better=True, notes="post-earnings-announcement drift window", tags=("event", "pead"))
_f("earnings_gap_pct", "news", "Overnight move on the last earnings publication date", "ratio", lo=-1.0, hi=5.0, tags=("event", "pead"))

# ---------------------------------------------------------------------------
# Composite scores
# ---------------------------------------------------------------------------
_f("growth_opportunity_score", "composite", "Overall Growth Opportunity Score in [0, 100]", "score", lo=0.0, hi=100.0, better=True, deps=("fundamental_momentum", "rel_strength_126", "roic", "adv_usd_20"), tags=("composite",))
_f("growth_fundamental_acceleration", "composite", "Growth score component: fundamental acceleration", "score", lo=0.0, hi=100.0, better=True, tags=("composite",))
_f("growth_price_strength", "composite", "Growth score component: price strength", "score", lo=0.0, hi=100.0, better=True, tags=("composite",))
_f("growth_durability", "composite", "Growth score component: growth durability", "score", lo=0.0, hi=100.0, better=True, tags=("composite",))
_f("growth_catalyst", "composite", "Growth score component: catalyst credibility", "score", lo=0.0, hi=100.0, better=True, tags=("composite",))
_f("growth_risk_valuation", "composite", "Growth score component: risk and valuation (higher = safer)", "score", lo=0.0, hi=100.0, better=True, tags=("composite",))


def registry_version() -> str:
    return REGISTRY.version_hash()


def feature_names() -> list[str]:
    return REGISTRY.names()


CALLABLES: dict[str, Callable[..., Any]] = {}  # populated by the compute modules
