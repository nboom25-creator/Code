"""Pydantic schemas shared across the API.

These are the strongly-typed contracts returned to the frontend. Every value
that originates from a data provider is wrapped so its ``source`` and ``as_of``
timestamp travel with it — the UI must never display a number without knowing
where it came from.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel as _PydBaseModel, ConfigDict, Field


class BaseModel(_PydBaseModel):
    # Several fields legitimately start with "model_" (model_rationale, etc.);
    # opt out of Pydantic's protected-namespace warning for them.
    model_config = ConfigDict(protected_namespaces=())


# --------------------------------------------------------------------------- #
# Provenance
# --------------------------------------------------------------------------- #
class Provenance(BaseModel):
    """Where a value came from and when it was current."""

    source: str = Field(..., description="Human-readable provider name")
    as_of: datetime = Field(..., description="Timestamp the value was current")
    is_demo: bool = Field(
        False, description="True when the value is synthetic DEMO DATA"
    )
    delay_note: Optional[str] = Field(
        None, description="Data-delay / freshness caveat, e.g. '15-min delayed'"
    )


# --------------------------------------------------------------------------- #
# Prices
# --------------------------------------------------------------------------- #
class OHLCV(BaseModel):
    date: date
    open: float
    high: float
    low: float
    close: float
    adj_close: float
    volume: float


class Quote(BaseModel):
    """Latest available price snapshot."""

    ticker: str
    price: float
    change: float
    change_percent: float
    previous_close: float
    open: Optional[float] = None
    day_high: Optional[float] = None
    day_low: Optional[float] = None
    volume: Optional[float] = None
    provenance: Provenance


class CompanyProfile(BaseModel):
    ticker: str
    name: Optional[str] = None
    exchange: Optional[str] = None
    currency: Optional[str] = "USD"
    sector: Optional[str] = None
    industry: Optional[str] = None
    market_cap: Optional[float] = None
    description: Optional[str] = None
    website: Optional[str] = None
    provenance: Provenance


class Fundamentals(BaseModel):
    ticker: str
    revenue: Optional[float] = None
    net_income: Optional[float] = None
    free_cash_flow: Optional[float] = None
    gross_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    net_margin: Optional[float] = None
    total_debt: Optional[float] = None
    total_cash: Optional[float] = None
    shares_outstanding: Optional[float] = None
    revenue_growth_yoy: Optional[float] = None
    earnings_growth_yoy: Optional[float] = None
    # Valuation ratios
    pe_ratio: Optional[float] = None
    forward_pe: Optional[float] = None
    peg_ratio: Optional[float] = None
    price_to_sales: Optional[float] = None
    ev_to_ebitda: Optional[float] = None
    dividend_yield: Optional[float] = None
    provenance: Provenance


class NewsItem(BaseModel):
    headline: str
    summary: Optional[str] = None
    url: Optional[str] = None
    source: Optional[str] = None
    published_at: Optional[datetime] = None
    sentiment_score: Optional[float] = Field(
        None, description="Lexicon sentiment in [-1, 1]"
    )
    sentiment_label: Optional[str] = None


class SearchResult(BaseModel):
    ticker: str
    name: Optional[str] = None
    exchange: Optional[str] = None
    type: Optional[str] = None


# --------------------------------------------------------------------------- #
# Technical analysis
# --------------------------------------------------------------------------- #
class IndicatorPoint(BaseModel):
    date: date
    value: Optional[float] = None


class TechnicalIndicator(BaseModel):
    name: str
    latest: Optional[float] = None
    signal: Optional[str] = None  # bullish / bearish / neutral
    explanation: str
    series: list[IndicatorPoint] = Field(default_factory=list)


class TechnicalAnalysis(BaseModel):
    indicators: list[TechnicalIndicator]
    overall_signal: str
    summary: str


# --------------------------------------------------------------------------- #
# Forecasting
# --------------------------------------------------------------------------- #
class ForecastPoint(BaseModel):
    date: date
    horizon_label: str
    horizon_days: int
    predicted_price: float
    lower: float  # lower prediction-interval bound
    upper: float  # upper prediction-interval bound
    bull: float
    base: float
    bear: float
    expected_return_pct: float


class ModelMetric(BaseModel):
    model: str
    mae: float
    rmse: float
    mape: Optional[float] = None
    directional_accuracy: float
    skill_vs_naive: float = Field(
        ..., description="1 - (model_rmse / naive_rmse); >0 means beats naive"
    )
    n_folds: int


class Forecast(BaseModel):
    ticker: str
    generated_at: datetime
    selected_model: str
    model_rationale: str
    horizons: list[ForecastPoint]
    interval_confidence: float = Field(
        0.80, description="Nominal coverage of the prediction interval"
    )
    validation: list[ModelMetric]
    is_demo: bool = False
    low_confidence_warning: Optional[str] = None


class ScenarioCard(BaseModel):
    horizon_label: str
    bull: float
    base: float
    bear: float
    bull_return_pct: float
    base_return_pct: float
    bear_return_pct: float


# --------------------------------------------------------------------------- #
# Research rating
# --------------------------------------------------------------------------- #
class RatingComponent(BaseModel):
    name: str
    score: float = Field(..., description="Normalised component score in [-1, 1]")
    weight: float
    contribution: float = Field(..., description="score * weight")
    detail: str


class ResearchRating(BaseModel):
    ticker: str
    rating: Literal["Buy", "Accumulate", "Hold", "Reduce", "Sell"]
    composite_score: float = Field(..., description="Weighted score in [-1, 1]")
    confidence: float = Field(..., description="0..1 confidence level")
    confidence_label: str
    expected_return_low_pct: float
    expected_return_high_pct: float
    components: list[RatingComponent]
    bullish_factors: list[str]
    bearish_factors: list[str]
    catalysts: list[str]
    key_risks: list[str]
    invalidation_conditions: list[str]
    explanation: str


# --------------------------------------------------------------------------- #
# Risk
# --------------------------------------------------------------------------- #
class RiskAnalysis(BaseModel):
    annualized_volatility: float
    max_drawdown_5y: float
    value_at_risk_95_daily: float
    beta_vs_benchmark: Optional[float] = None
    sharpe_ratio_1y: Optional[float] = None
    downside_notes: list[str]


# --------------------------------------------------------------------------- #
# Full analysis response
# --------------------------------------------------------------------------- #
class AnalysisResponse(BaseModel):
    ticker: str
    generated_at: datetime
    is_demo: bool
    demo_reason: Optional[str] = None
    quote: Quote
    profile: CompanyProfile
    fundamentals: Optional[Fundamentals] = None
    history: list[OHLCV]
    benchmark_history: list[OHLCV] = Field(default_factory=list)
    technical: TechnicalAnalysis
    forecast: Forecast
    scenarios: list[ScenarioCard]
    rating: ResearchRating
    risk: RiskAnalysis
    news: list[NewsItem]
    sources: list[str]
    assumptions: list[str]
    limitations: list[str]
    disclaimer: str


# --------------------------------------------------------------------------- #
# Backtesting
# --------------------------------------------------------------------------- #
class BacktestRequest(BaseModel):
    ticker: str
    model: str = "auto"
    horizon_days: int = 5
    lookback_years: int = 5
    initial_investment: float = 10_000.0
    transaction_cost_bps: float = 5.0  # basis points per trade


class BacktestPoint(BaseModel):
    date: date
    actual: float
    predicted: float
    error: float


class BacktestResult(BaseModel):
    ticker: str
    model: str
    horizon_days: int
    is_demo: bool
    points: list[BacktestPoint]
    directional_accuracy: float
    mae: float
    rmse: float
    mape: Optional[float]
    strategy_return_pct: float
    strategy_return_after_costs_pct: float
    buy_and_hold_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    n_trades: int
    final_value: float
    final_value_after_costs: float
    equity_curve: list[dict]
    limitations: list[str]


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #
class ErrorResponse(BaseModel):
    error: str
    code: str
    detail: Optional[str] = None
    setup_hint: Optional[str] = None
