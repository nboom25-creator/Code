/**
 * Types mirroring the backend responses.
 *
 * Money and ratios arrive as **strings**, not numbers: the backend stores them
 * as decimals and serialising through a JavaScript `number` would silently
 * introduce binary floating-point error into account values. Convert only at the
 * point of display, with the helpers in `format.ts`.
 */

export type Mode = 'BACKTEST' | 'PAPER' | 'LIVE'
export type Regime = 'risk_on' | 'neutral' | 'risk_off'
export type RiskState = 'normal' | 'warning' | 'defensive_1' | 'defensive_2' | 'emergency' | 'read_only'
export type Role = 'admin' | 'operator' | 'viewer' | 'readonly'

export interface User {
  id: number
  email: string
  role: Role
}

export interface PublicConfig {
  mode: Mode
  env_name: string
  timezone: string
  base_currency: string
  broker: string
  price_provider: string
  fundamentals_provider: string
  news_provider: string
  macro_provider: string
  calendar_provider: string
  live_trading_enabled: boolean
  live_max_allocation_usd: string
  loop_enabled: boolean
  loop_interval_seconds: number
  llm_enabled: boolean
  using_synthetic_data: boolean
  benchmark_symbol?: string
  version: string
}

export interface ProviderHealth {
  all_ok?: boolean
  any_synthetic?: boolean
  [role: string]: unknown
}

export interface Overview {
  mode: Mode
  config: PublicConfig
  data_disclaimer: string | null
  account: {
    source: string
    account_identifier?: string
    is_paper?: boolean
    equity?: string
    cash?: string
    buying_power?: string | null
    trading_blocked?: boolean
    day_trade_count?: number
  }
  pnl: {
    day: string | null
    day_pct: string | null
    cumulative: string | null
    high_water_mark: string | null
    drawdown_pct: string | null
  }
  exposure: {
    gross: string | null
    net: string | null
    long_market_value: string | null
    open_positions: number
    open_orders: number
    max_gross: string
  }
  regime: {
    regime: Regime | null
    score: string | null
    as_of: string | null
    explanation: string | null
    components: Record<string, number | null> | null
  }
  health: {
    providers: ProviderHealth
    broker: { ok?: boolean; broker?: string; error?: string; account_id?: string; warning?: string }
    data_quality: { open_total: number; blocking: number; healthy: boolean; by_kind: Record<string, number> }
    reconciliation: { status: string | null; at: string | null; breaks: number | null; resolved: boolean | null }
    last_loop_at: string | null
  }
  controls: {
    kill_switch_engaged: boolean
    kill_switch_reason: string | null
    read_only: boolean
    risk_state: RiskState
    risk_state_reason: string | null
    trading_halted_for_date: string | null
    halt_reason: string | null
    cooldown_until: string | null
    recovery_requires_approval: boolean
  }
  timezone: string
  server_time_utc: string
  server_time_local: string
}

export interface Position {
  symbol: string
  name: string
  sector: string
  quantity: string
  avg_entry_price: string
  last_price: string | null
  last_price_at: string | null
  market_value: string | null
  cost_basis: string
  unrealized_pnl: string | null
  unrealized_pnl_pct: string | null
  realized_pnl: string
  weight: string
  weight_limit: string
  risk_contribution: string | null
  strategy_key: string | null
  entry_thesis: string | null
  exit_criteria: Record<string, unknown> | null
  stop_price: string | null
  trailing_stop_pct: string | null
  thesis_status: string
  opened_at: string | null
  holding_days: number | null
  is_synthetic: boolean
}

export interface PortfolioResponse {
  mode: Mode
  equity: string
  positions: Position[]
  sector_exposure: Record<string, string>
  strategy_exposure: Record<string, string>
  equity_curve: Array<{
    at: string
    session_date: string
    equity: string
    cash: string
    drawdown: string | null
    gross_exposure: string
    positions: number
  }>
  using_synthetic_data: boolean
}

export interface Candidate {
  symbol: string
  rank?: number
  strategy_key: string | null
  strategies?: string[]
  growth_score: string | null
  signal_score: string | null
  confidence: string | null
  uncertainty: string | null
  expected_return: string | null
  expected_return_low: string | null
  expected_return_high: string | null
  expected_vol: string | null
  downside_estimate: string | null
  estimated_cost_bps: string | null
  expected_holding_days: number | null
  regime: Regime | null
  sector?: string | null
  thesis?: string
  components: Record<string, ScoreComponent> | null
  supporting_evidence: string[]
  opposing_evidence: string[]
  weaknesses: string[]
  disqualifiers?: string[]
  coverage?: number | null
  is_synthetic: boolean
}

export interface ScoreComponent {
  name: string
  score: number | null
  inputs: Record<string, number | null>
  missing: string[]
  notes: string[]
}

export interface OpportunitiesResponse {
  as_of: string | null
  source: string
  regime?: Record<string, unknown>
  universe_evaluated?: number
  using_synthetic_data?: boolean
  candidates: Candidate[]
  note?: string
}

export interface StrategyMeta {
  key: string
  name: string
  family: string
  description: string
  required_features: string[]
  required_data: string[]
  universe_rules: string[]
  entry_criteria: string[]
  exit_criteria: string[]
  sizing_method: string
  expected_holding_days: number
  risk_assumptions: string[]
  invalidating_conditions: string[]
  supported_regimes: string[]
  max_positions: number
  allows_short: boolean
  version: string
  capacity_notes: string
  status: string
  enabled: boolean
  paused_reason: string | null
  target_weight: string
  default_params?: Record<string, unknown>
}

export interface BacktestSummary {
  id: number
  label: string
  phase: string
  status: string
  start_date: string
  end_date: string
  strategy_keys: string[]
  accepted: boolean | null
  uses_synthetic_data: boolean
  created_at: string | null
  duration_ms: number | null
  error: string | null
  headline: {
    total_return: number | null
    cagr: number | null
    sharpe: number | null
    sortino: number | null
    calmar: number | null
    max_drawdown: number | null
    trades: number | null
    excess_return: number | null
  }
}

export interface BacktestDetail extends BacktestSummary {
  params: Record<string, unknown> | null
  cost_model: Record<string, unknown> | null
  universe: string[]
  metrics: Record<string, any> | null
  benchmark_metrics: Record<string, any> | null
  regime_metrics: Record<string, any> | null
  diagnostics: Record<string, any> | null
  rejection_reasons: { rejections?: string[]; warnings?: string[]; checks?: Record<string, unknown> } | null
  disclaimer: string
  equity_curve: Array<{
    date: string
    equity: string
    cash: string
    benchmark: string | null
    drawdown: string
    gross_exposure: string
    positions: number
    regime: string | null
  }>
  trades: Array<{
    symbol: string
    strategy_key: string | null
    entry_at: string | null
    exit_at: string | null
    quantity: string
    entry_price: string
    exit_price: string | null
    net_pnl: string | null
    return_pct: string | null
    costs: string | null
    holding_days: number | null
    exit_reason: string | null
    mae_pct: string | null
    mfe_pct: string | null
  }>
}

export interface Order {
  id: number
  client_order_id: string
  broker_order_id: string | null
  decision_id: number | null
  symbol: string
  side: string
  order_type: string
  time_in_force: string
  status: string
  quantity: string
  filled_quantity: string
  limit_price: string | null
  avg_fill_price: string | null
  reference_price: string | null
  expected_total_cost_bps: string | null
  realized_slippage_bps: string | null
  commission: string
  strategy_key: string | null
  submitted_at: string | null
  reject_reason: string | null
  broker: string | null
  submit_attempts?: number
  is_synthetic: boolean
  created_at: string | null
  events?: Array<{
    at: string
    event_type: string
    from_status: string | null
    to_status: string | null
    message: string | null
    source: string
  }>
  fills?: Array<{ at: string; quantity: string; price: string; slippage_bps: string | null; is_partial: boolean }>
}

export interface Decision {
  id: number
  decided_at: string
  loop_run_id: number | null
  mode: Mode
  symbol: string
  action: string
  strategy_key: string | null
  model_version: string | null
  proposed_quantity: string | null
  approved_quantity: string | null
  reference_price: string | null
  confidence: string | null
  uncertainty: string | null
  expected_return: string | null
  expected_holding_days: number | null
  risk_contribution: string | null
  estimated_cost_bps: string | null
  regime: Regime | null
  approval_state: string
  approved_by: string | null
  rejection_reason: string | null
  explanation: string | null
  is_synthetic: boolean
  signal_inputs?: Record<string, number | null>
  entry_thesis?: string | null
  exit_criteria?: Record<string, unknown> | null
  bull_case?: string | null
  bear_case?: string | null
  sizing_detail?: Record<string, any> | null
  risk_verdict?: Record<string, any> | null
  risk_checks?: Array<{
    check: string
    result: string
    observed: string | null
    limit: string | null
    utilization: string | null
    message: string | null
  }>
  orders?: Array<Record<string, unknown>>
  review?: Record<string, any> | null
}

export interface RiskCentre {
  limits: Record<string, string>
  risk_state: RiskState
  risk_state_reason: string | null
  defensive_stages: Record<string, string | null>
  utilisation: Record<string, Utilisation>
  sector_utilisation: Record<string, Utilisation>
  strategy_utilisation: Record<string, Utilisation>
  concentration: { largest_position_weight: string; positions: number; sectors: number }
  correlations: {
    pairs: Array<{ a: string; b: string; correlation: number }>
    threshold?: string
    above_threshold?: number
    average?: number | null
    note?: string | null
  }
  stress_test: Record<string, any>
  recent_risk_events: Array<{
    at: string
    check: string
    result: string
    message: string | null
    observed: string | null
    limit: string | null
    decision_id: number | null
  }>
  rejection_counts_30d: Record<string, number>
}

export interface Utilisation {
  observed: string
  limit: string
  utilization: string | null
  breached: boolean
}

export interface LoopRun {
  id: number
  started_at: string
  finished_at: string | null
  mode: Mode
  status: string
  trigger: string
  market_open: boolean | null
  regime: Regime | null
  health_ok: boolean | null
  candidates_considered: number
  decisions_made: number
  orders_submitted: number
  orders_rejected: number
  halted_reason: string | null
  summary: string | null
  error: string | null
  duration_ms: number | null
  steps: Array<{ name: string; ok: boolean; message: string; duration_ms: number; detail?: unknown }>
}

export interface Alert {
  id: number
  at: string
  kind: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  symbol: string | null
  acknowledged: boolean
  acknowledged_by: string | null
}

export interface SettingsResponse {
  config: PublicConfig
  providers: ProviderHealth
  credentials_configured: Record<string, boolean>
  trading_schedule: Record<string, unknown>
  risk_config: { version: number; source: string; updated_by: string | null; note: string | null; limits: Record<string, string> }
  live_controls: {
    mode: Mode
    env_flag_enabled: boolean
    authorized: boolean
    authorization_reason: string
    max_allocation_usd: string
    requires_promotion_gate: boolean
  }
  system_state: Record<string, unknown>
  deferred_features: string[]
}

export interface LivePreflight {
  granted: boolean
  checks: Array<{ name: string; passed: boolean; message: string }>
  failures: string[]
  account_identifier: string | null
  broker: string | null
  max_allocation_usd: string | null
  currently_authorized: boolean
  authorization_reason: string
  required_steps: string[]
  warning: string
}

export interface PromotionStatus {
  thresholds: Record<string, string>
  strategies: Array<{
    strategy_key: string
    from_status: string
    to_status: string | null
    passed: boolean
    checks: Array<{ name: string; passed: boolean; observed: unknown; required: unknown; message: string }>
    blocking: string[]
    notes: string[]
    disclaimer: string
  }>
  history: Array<{
    at: string
    strategy_key: string
    from_status: string
    to_status: string
    passed: boolean
    requested_by: string | null
    approved_by: string | null
    note: string | null
    blocking: string[]
  }>
}

export interface PerformanceResponse {
  mode: Mode
  observations: number
  metrics: Record<string, any> | null
  post_trade_reviews: Array<{
    at: string
    symbol: string
    decision_id: number
    realized_pnl: string | null
    realized_return_pct: string | null
    holding_days: number | null
    thesis_outcome: string | null
    exit_reason: string | null
    slippage_bps: string | null
    lessons: string | null
  }>
  calibration: Record<string, any>
  strategy_drift: Record<string, any>
  disclaimer: string
}
