# Risk controls

## Authority

The risk engine (`aegisquant/risk/engine.py`) has final authority over every
order. Nothing else in the platform may place one — not a strategy, not the
ensemble, not the API, not a language model.

`RiskEngine.evaluate(intent, account) -> RiskVerdict` is a pure function over an
explicit snapshot. It reads no network, no clock beyond what is passed in, and no
random source. Four properties, each with tests in
`backend/tests/test_risk_engine.py`:

| Property | Why it matters |
|---|---|
| **Deterministic** | The same inputs always produce the same verdict, which is what makes the recorded audit trail meaningful months later. |
| **Total** — never raises | An exception here would be an unhandled path *around* the only control that matters. An internal error produces a rejection. |
| **Fail-closed** | Unknown data age, unmeasurable liquidity, an unresolved reconciliation break: all reject. "I don't know" is never "it's fine". |
| **Resize before reject** | An over-sized order is trimmed to the cap rather than refused — the trade may still be worth making smaller. Only an unfixable violation rejects. |

Every evaluation writes one `risk_checks` row per limit — around 39 rows for a
single order. That is what makes *"why was this trade allowed, and what was the
binding constraint?"* answerable long after the fact.

## Verdict semantics

| Result | Meaning |
|---|---|
| `pass` | The limit was measured and satisfied. |
| `warn` | Noted for the operator; does not block. |
| `resize` | The order is permitted at a smaller quantity. The engine takes the **minimum** across all resizing checks. |
| `reject` | The order does not go. One rejection is enough. |

A rejected verdict always carries `approved_quantity = 0`. Approved quantity can
never exceed what was requested. If every limit passes but the permitted quantity
rounds to zero, that becomes a rejection with a stated reason rather than a
silent no-op.

## The limits

All configurable via `AEGIS_RISK_*` or at runtime by an admin (which writes a new
*version* of the configuration and keeps the old one — the history is readable in
Settings). Defaults shown.

### Per position

| Limit | Default | Behaviour |
|---|---|---|
| `max_position_pct` | 15% | Resize; reject if already at the cap. |
| `max_order_notional_pct` | 15% | Resize. |
| `min_order_notional` | $50 | Reject — costs would dominate. |
| `max_risk_per_trade_pct` | 1% | Resize. Risk measured to the stop, or to ¼ of annual volatility when no stop is set. |

### Portfolio-wide

| Limit | Default | Behaviour |
|---|---|---|
| `max_gross_exposure_pct` | 100% | Resize / reject. **No leverage in v1.** |
| `max_net_exposure_pct` | 100% | Reject. |
| `max_sector_exposure_pct` | 35% | Resize; reject when the sector is full. |
| `max_strategy_exposure_pct` | 50% | Resize / reject. Stops one sleeve becoming the whole book. |
| `max_correlated_exposure_pct` | 50% | Resize / reject, applied when correlation to the book exceeds the threshold. |
| `correlation_threshold` | 0.60 | Above this, a position is haircut (up to 50%) and counted as correlated exposure. |
| `max_open_positions` | 15 | Reject a *new* symbol; adding to an existing one is unaffected. |
| `min_cash_buffer_pct` | 2% | Resize; reject when there is no headroom. |
| `max_turnover_daily_pct` | 50% | Reject. |

### Loss limits and the defensive ladder

Drawdown maps onto a posture. Escalation is immediate; de-escalation requires
recovering well clear of the warning line, so the state does not flicker and the
book is not re-levered on a one-day bounce.

| Threshold | Default | Posture | Effect on new entries | Exits |
|---|---|---|---|---|
| `drawdown_warning_pct` | 7% | `warning` | sizes × 0.75 | permitted |
| `defensive_stage_1_pct` | 10% | `defensive_1` | sizes × 0.50 | permitted |
| `defensive_stage_2_pct` | 15% | `defensive_2` | **none** | permitted |
| `emergency_stage_pct` | 20% | `emergency` | **none**, orders cancelled | permitted |
| `max_portfolio_drawdown_pct` | 20% | — | reject | permitted |

Plus:

- `max_daily_loss_pct` (3%) — halts trading for the session. **Exits remain
  permitted**: blocking an exit during a bad day is the opposite of risk
  management.
- `max_weekly_loss_pct` (7%) — blocks new risk.
- `loss_cooldown_hours` (24) — after a loss limit trips, new entries are blocked
  for this long. Exits are not.

Recovery from the emergency state requires an explicit human action
(`POST /api/controls/recover`), audited with the operator's identity and reason.

### Market regime gate

Before any *new* entry, the loop classifies the regime from the benchmark's
position relative to its long-term trend plus a volatility read, with hysteresis:

| Regime | New-entry sizing |
|---|---|
| `risk_on` | full |
| `neutral` | half |
| `risk_off` | **zero** — manage existing positions only |

Exits and trims run in every regime.

### Execution and microstructure

| Limit | Default | Behaviour |
|---|---|---|
| `min_price` | $5 | Reject — penny-stock exclusion. |
| `min_adv_usd` | $5M | Reject. Unknown ADV also rejects. |
| `max_adv_participation_pct` | 1% | Resize. Often the binding constraint on a thin name: if it rounds below one share, the name is too illiquid to hold. |
| `max_spread_bps` | 50 | Reject. |
| `max_estimated_impact_bps` | 50 | Reject. |
| `max_data_age_seconds` | 900 | Reject. **Unknown age also rejects.** |
| `max_open_order_seconds` | 3600 | Warn; the loop cancels stale orders. |

### Instrument eligibility

Rejected outright: delisted, not tradable at the broker, leveraged or inverse
ETFs (disabled in v1), and any sell that would open or extend a short
(unrestricted shorting is disabled in v1). A fractional quantity on a
whole-share-only instrument is rounded **down**.

## Position sizing

Five methods, in `aegisquant/portfolio/sizing.py`. Every one of them can only
ever *shrink* a position relative to the hard caps — growing past a limit is not
a thing sizing can do.

| Method | Basis |
|---|---|
| `volatility_target` | target portfolio vol ÷ asset vol |
| `fixed_fractional` | risk budget ÷ distance to stop |
| `fractional_kelly` | `f* = p − (1−p)/b`, × the Kelly fraction |
| `risk_parity` | equal risk contribution |
| `conviction_weighted` | the **more conservative** of vol-target and Kelly |

The final weight is
`method_weight × conviction × correlation × regime × concentration × sleeve`,
then clipped by every cap. Each multiplier is recorded in the decision's
`sizing_detail`, so the number can be re-derived.

### On Kelly

Full Kelly maximises expected log wealth **given perfectly known probabilities**,
and every probability here is an estimate with material error. Over-betting
relative to true edge is the classic route to ruin.

`kelly_fraction` defaults to **0.25** and is **capped at 0.5 by configuration
validation** — a value above that is rejected at startup and by the API. A
negative Kelly means "do not take this bet", never "take the other side".

### Pyramiding, and not selling winners arbitrarily

- Adding to a position requires at least 8% of open profit, and each add is half
  the remaining headroom to target. Averaging *down* has no code path.
- There is deliberately no "up 20%, take profit" rule. A winner is reduced when
  its **thesis** deteriorates (`weakening` → trim, `invalidated` → exit) or when
  a risk limit binds. Selling a compounder at an arbitrary percentage is how you
  convert a large win into a small one.
- Cash is an active allocation: the target rises in a weaker regime and in a
  drawdown, and never falls below the configured buffer.

## Stops are not guaranteed prices

A stop is an *instruction*, not an execution price. The backtester models a
gap-through explicitly: when the session opens below a sell stop, the fill is at
the gapped open, not at the stop. There is a test for exactly this
(`test_a_stop_is_not_treated_as_a_guaranteed_price`) because a backtester that
fills stops at the stop price systematically understates tail risk.

## Emergency controls

| Control | Scope | Who | Reversal |
|---|---|---|---|
| **Kill switch** | Blocks *all* order flow, including exits | operator+ | Separate, audited action |
| **Read-only mode** | No orders of any kind | operator+ | Separate action |
| **Cancel all** | Cancels every open order | operator+ | n/a |
| **Flatten positions** | Market-sells the entire book | admin, with a typed confirmation | irreversible |
| **Symbol quarantine** | Blocks one symbol | operator+ | Release action |
| **Strategy pause** | Blocks one sleeve | operator+ | Resume action |
| **Recovery approval** | Leaves the emergency state | operator+ | n/a |

Every one records the actor's identity and the reason they typed into the
append-only audit log. Flatten uses **market** orders on purpose: when
flattening, certainty of execution matters more than price.

## What the language model may not do

From the specification, enforced structurally rather than by instruction:

| The model may | The model may not |
|---|---|
| research and summarise | bypass any deterministic risk control |
| critique a proposal | alter credentials |
| explain a decision in prose | raise a risk limit |
| propose a candidate and a confidence | enable live mode |
| | deploy unreviewed code |
| | call the execution path |

There is no code path from the LLM layer to `broker.submit_order`. Narration is
generated deterministically from recorded values; when `AEGIS_LLM_ENABLED=true`
the model may only *rewrite* that text, and the rewrite is discarded unless its
numeric content is a subset of the deterministic version.

Confidence is the one place a model-derived number affects sizing — and it does
so only *downward*, scaled inside caps the engine enforces afterwards regardless.

## Promotion gate: paper to live-eligible

A strategy becomes live-eligible only by passing every one of these:

- minimum paper days (60) and paper trades (30)
- out-of-sample Sharpe above threshold (0.80)
- out-of-sample drawdown within tolerance (25%)
- excess return over benchmark ≥ 0
- paper-versus-simulation tracking error within tolerance (0.50) — if paper
  results do not resemble the backtest, the backtest is wrong
- zero open blocking data-quality issues
- zero unresolved reconciliation breaks

The gate is evaluated on demand and shown in the Strategy Lab, with each check's
observed value next to its threshold.

## Live-mode gate

Seven independent conditions, all required:

1. `AEGIS_LIVE_TRADING_ENABLED=true` in the server environment
2. `AEGIS_MODE=LIVE` and a backend restart
3. a non-mock broker with live credentials
4. at least one strategy through the promotion gate
5. every preflight check passing
6. explicit UI confirmation **plus** re-entry of the confirmation phrase
7. acknowledgement of the displayed account identifier

Refusal returns `409 Conflict` with every unmet requirement listed. The attempt
is written to `live_authorizations` and the audit log **whether or not it is
granted** — the record of a refused attempt is as important as a granted one.

Disabling live is never gated. De-risking is always allowed.

The platform never falls back from paper to live. `AEGIS_MODE=LIVE` without the
env flag is a startup failure, not a downgrade to paper; the mock broker in LIVE
mode is a startup failure, not a substitution.
