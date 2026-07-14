// TypeScript mirrors of the backend Pydantic schemas.

export interface Provenance {
  source: string;
  as_of: string;
  is_demo: boolean;
  delay_note?: string | null;
}

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adj_close: number;
  volume: number;
}

export interface Quote {
  ticker: string;
  price: number;
  change: number;
  change_percent: number;
  previous_close: number;
  open?: number | null;
  day_high?: number | null;
  day_low?: number | null;
  volume?: number | null;
  provenance: Provenance;
}

export interface CompanyProfile {
  ticker: string;
  name?: string | null;
  exchange?: string | null;
  currency?: string | null;
  sector?: string | null;
  industry?: string | null;
  market_cap?: number | null;
  description?: string | null;
  website?: string | null;
  provenance: Provenance;
}

export interface Fundamentals {
  ticker: string;
  revenue?: number | null;
  net_income?: number | null;
  free_cash_flow?: number | null;
  gross_margin?: number | null;
  operating_margin?: number | null;
  net_margin?: number | null;
  total_debt?: number | null;
  total_cash?: number | null;
  shares_outstanding?: number | null;
  revenue_growth_yoy?: number | null;
  earnings_growth_yoy?: number | null;
  pe_ratio?: number | null;
  forward_pe?: number | null;
  peg_ratio?: number | null;
  price_to_sales?: number | null;
  ev_to_ebitda?: number | null;
  dividend_yield?: number | null;
  provenance: Provenance;
}

export interface NewsItem {
  headline: string;
  summary?: string | null;
  url?: string | null;
  source?: string | null;
  published_at?: string | null;
  sentiment_score?: number | null;
  sentiment_label?: string | null;
}

export interface SearchResult {
  ticker: string;
  name?: string | null;
  exchange?: string | null;
  type?: string | null;
}

export interface IndicatorPoint {
  date: string;
  value?: number | null;
}

export interface TechnicalIndicator {
  name: string;
  latest?: number | null;
  signal?: string | null;
  explanation: string;
  series: IndicatorPoint[];
}

export interface TechnicalAnalysis {
  indicators: TechnicalIndicator[];
  overall_signal: string;
  summary: string;
}

export interface ForecastPoint {
  date: string;
  horizon_label: string;
  horizon_days: number;
  predicted_price: number;
  lower: number;
  upper: number;
  bull: number;
  base: number;
  bear: number;
  expected_return_pct: number;
}

export interface ModelMetric {
  model: string;
  mae: number;
  rmse: number;
  mape?: number | null;
  directional_accuracy: number;
  skill_vs_naive: number;
  n_folds: number;
}

export interface Forecast {
  ticker: string;
  generated_at: string;
  selected_model: string;
  model_rationale: string;
  horizons: ForecastPoint[];
  interval_confidence: number;
  validation: ModelMetric[];
  is_demo: boolean;
  low_confidence_warning?: string | null;
}

export interface ScenarioCard {
  horizon_label: string;
  bull: number;
  base: number;
  bear: number;
  bull_return_pct: number;
  base_return_pct: number;
  bear_return_pct: number;
}

export interface RatingComponent {
  name: string;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
}

export interface ResearchRating {
  ticker: string;
  rating: "Buy" | "Accumulate" | "Hold" | "Reduce" | "Sell";
  composite_score: number;
  confidence: number;
  confidence_label: string;
  expected_return_low_pct: number;
  expected_return_high_pct: number;
  components: RatingComponent[];
  bullish_factors: string[];
  bearish_factors: string[];
  catalysts: string[];
  key_risks: string[];
  invalidation_conditions: string[];
  explanation: string;
}

export interface RiskAnalysis {
  annualized_volatility: number;
  max_drawdown_5y: number;
  value_at_risk_95_daily: number;
  beta_vs_benchmark?: number | null;
  sharpe_ratio_1y?: number | null;
  downside_notes: string[];
}

export interface AnalysisResponse {
  ticker: string;
  generated_at: string;
  is_demo: boolean;
  demo_reason?: string | null;
  quote: Quote;
  profile: CompanyProfile;
  fundamentals?: Fundamentals | null;
  history: OHLCV[];
  benchmark_history: OHLCV[];
  technical: TechnicalAnalysis;
  forecast: Forecast;
  scenarios: ScenarioCard[];
  rating: ResearchRating;
  risk: RiskAnalysis;
  news: NewsItem[];
  sources: string[];
  assumptions: string[];
  limitations: string[];
  disclaimer: string;
}

export interface BacktestRequest {
  ticker: string;
  model: string;
  horizon_days: number;
  lookback_years: number;
  initial_investment: number;
  transaction_cost_bps: number;
}

export interface BacktestPoint {
  date: string;
  actual: number;
  predicted: number;
  error: number;
}

export interface BacktestResult {
  ticker: string;
  model: string;
  horizon_days: number;
  is_demo: boolean;
  points: BacktestPoint[];
  directional_accuracy: number;
  mae: number;
  rmse: number;
  mape?: number | null;
  strategy_return_pct: number;
  strategy_return_after_costs_pct: number;
  buy_and_hold_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  n_trades: number;
  final_value: number;
  final_value_after_costs: number;
  equity_curve: { date: string | null; strategy: number; buy_hold: number }[];
  limitations: string[];
}

export interface HealthInfo {
  status: string;
  provider: string;
  provider_name: string;
  is_demo: boolean;
  configured: boolean;
  allow_demo_fallback: boolean;
  setup_hint?: string | null;
}

export interface ApiError {
  code: string;
  error: string;
  setup_hint?: string | null;
}
