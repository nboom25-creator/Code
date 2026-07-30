# AegisQuant — Architecture

## The shape of the thing

AegisQuant is a research-and-execution platform for US equities and ETFs. It has
one structural commitment that everything else follows from:

> **A language model may research, summarise, critique and explain. A
> deterministic risk engine decides what actually gets sent to a broker.**

So the system is layered by *authority*, not just by concern. Data flows up;
authority narrows as it goes.

```
                    ┌────────────────────────────────────────────┐
                    │  React operator dashboard (8 screens)      │
                    │  reads the API; holds no credentials       │
                    └──────────────────┬─────────────────────────┘
                                       │  HttpOnly cookie + CSRF, same origin
                    ┌──────────────────▼─────────────────────────┐
                    │  FastAPI  (55 endpoints, RBAC on each)     │
                    └──────────────────┬─────────────────────────┘
                                       │
   ┌───────────────────────────────────┼────────────────────────────────────┐
   │                                   │                                    │
┌──▼───────────────┐   ┌───────────────▼──────────────┐   ┌─────────────────▼──┐
│ Autonomous loop  │   │  Research / backtest layer   │   │  Governance         │
│ 15 ordered steps │   │  features, strategies,       │   │  promotion gate,    │
│ (Celery or CLI)  │   │  ensemble, event-driven      │   │  live-mode gate,    │
│                  │   │  backtester, validation      │   │  audit trail        │
└──┬───────────────┘   └───────────────┬──────────────┘   └─────────────────────┘
   │                                   │
   │            ┌──────────────────────▼───────────────────────┐
   │            │  Point-in-time market view (MarketView)      │
   │            │  truncates every series at `as_of`           │
   │            └──────────────────────┬───────────────────────┘
   │                                   │
   │            ┌──────────────────────▼───────────────────────┐
   │            │  Data layer: providers → validation → store  │
   │            └──────────────────────────────────────────────┘
   │
   │  proposes an OrderIntent
   ▼
┌──────────────────────────────────────────────────────────────┐
│  RISK ENGINE — deterministic, pure, fail-closed              │
│  ~30 named checks. Approves, resizes, or rejects.            │
│  Nothing else in the platform may place an order.            │
└──────────────────────┬───────────────────────────────────────┘
                       │  approved quantity only
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  OMS: idempotent client order IDs, state machine, fills,     │
│  cancel/replace, reconciliation against the broker           │
└──────────────────────┬───────────────────────────────────────┘
                       ▼
              Broker adapter (mock | Alpaca)
```

Every arrow into the risk engine is a *proposal*. Every arrow out of it is
already bounded. There is no path from a strategy, a model, or the API to
`broker.submit_order` that does not pass through it.

## Module map

```
backend/aegisquant/
  config.py            Settings, RiskLimits, PromotionThresholds. Validates at
                       import: refuses LIVE without the env flag, refuses the
                       mock broker in LIVE, refuses a dev secret in production.
  logging_setup.py     structlog with a mandatory secret-redaction processor.
  utils/money.py       Decimal coercion. Every price, quantity and notional.
  utils/timeutil.py    UTC everywhere; bar-close timestamps.

  db/
    base.py            Numeric column types. Money is Numeric(30,10).
    enums.py           Domain enums. `Mode` is re-exported from config, not
                       redefined — two identical enums would break `is` checks.
    models.py          38 tables. Append-only audit, versioned risk config.
    session.py         Engine, session scope. A 4xx HTTPException commits so the
                       audit row written for that refusal survives.
    repo.py            Small query helpers used across layers.

  data/
    providers/base.py  Interfaces + record types. Every record carries provider,
                       retrieved_at, observed_at, adjustment, data_quality.
    providers/fixture.py   Deterministic three-factor market simulator.
    providers/yfinance_provider.py, alpaca.py, fred.py, calendar_static.py
    net.py             TTL cache, rate limiter, retry policy, fetch log.
    quality.py         13 validators. Detect and report; never repair by invention.
    ingest.py          Provider → validate → upsert. RAW adjustment by default.

  features/
    market_view.py     THE point-in-time boundary. Everything downstream sees
                       only what existed at `as_of`.
    registry.py        108 feature definitions: units, ranges, dependencies,
                       availability delay, version. Hashed into a registry version.
    market_structure.py, fundamentals.py, news_features.py, macro.py
    growth_score.py    The composite score, with disqualifiers and coverage.
    engine.py          Computes a bundle for one instant; persists snapshots.

  strategies/          12 strategies in 4 families, one interface.
  portfolio/           Sizing (5 methods) and portfolio construction.
  risk/engine.py       The deterministic risk engine.
  backtest/            Event-driven engine, cost model, metrics, validation.
  execution/           OMS + broker adapters (mock, Alpaca) + factory.
  loop/autonomous.py   The 15-step cycle.
  governance/          Promotion gate, live-mode gate.
  explain/narrator.py  Deterministic narration + the numeric-consistency guard.
  services/            Backtest orchestration.
  jobs/                Celery app and tasks.
  ops/alerts.py        Alerts, metrics, drift detection, Prometheus text.
  api/                 FastAPI app, security, 6 routers.
  cli.py               14 commands. seed.py builds the demo environment.
```

## The three properties that shaped the design

### 1. Point-in-time correctness is a boundary, not a habit

There is exactly one place where "what did we know at time *t*" is decided:
`MarketView.at(as_of)` returns a `PointInTime`, and every feature, strategy and
backtest reads through it. Nothing else touches the raw tables.

`PointInTime` truncates by *observation timestamp*, which differs by data type:

| Data | Visible from |
|---|---|
| Daily bar | its session close (21:00 UTC, 18:00 on an early close) |
| Fundamentals | the filing's publication timestamp, not the period end |
| News | its publication time |
| Macro series | the release time, not the observation date |
| Corporate actions | the ex-date |

Two non-obvious consequences:

**Prices are stored RAW, not back-adjusted.** A vendor's back-adjusted series
already reflects splits that had not happened at the evaluation instant — it is
look-ahead baked into the data. AegisQuant stores unadjusted prices and applies
only the splits public at `as_of`, in `SymbolSeries.adjusted_to`. This also means
the backtester must handle splits itself, so a bug there surfaces instead of
hiding.

**Delisted names stay investable up to their delisting.** `investable_symbols`
is computed per instant, so a backtest can hold a company that later dies. That
is the point: a universe filtered to today's survivors produces a fictional
track record.

The test suite attacks this from four directions (`tests/test_lookahead.py`):
structurally (nothing after `as_of` is reachable), behaviourally (appending
future bars changes no past feature, to 1e-12), by negative control (a
deliberately cheating "oracle" feature *is* caught by the same harness), and
through corporate actions (a split produces no phantom return).

### 2. The risk engine is the only thing with authority

`RiskEngine.evaluate(intent, account) -> RiskVerdict` is a pure function over an
explicit snapshot. No network, no clock reads beyond what is passed in, no
randomness. Properties, each with tests:

- **Deterministic.** Same inputs, same verdict — which is what makes the audit
  trail meaningful.
- **Total.** It never raises. An internal error produces a rejection.
- **Fail-closed.** Unknown data age, unmeasurable liquidity, an unresolved
  reconciliation break: all reject. "I don't know" is never "it's fine".
- **Resize before reject.** A too-large order is trimmed to the cap rather than
  refused, because the trade may still be worth making at the permitted size.
  Only an unfixable violation rejects.
- **Exits are evaluated on a narrower rule set.** Blocking a risk-reducing order
  is itself a risk, so a sell that closes or trims a position skips exposure,
  liquidity and spread limits. It still cannot run under the kill switch.

The engine knows nothing about strategies. It sees a quantity, a price, an
account state, and a rule set.

### 3. Explanations are rendered from the record, not generated about it

`explain_decision()` is a deterministic function of the values that were
persisted. The end-to-end test re-runs it from the stored `Decision` row and
asserts the output is character-identical to the stored text. If a number in an
explanation could not be re-derived from the record, that is a failing test — not
a stylistic complaint.

An LLM may *rewrite* that text when `AEGIS_LLM_ENABLED=true`, and the rewrite is
discarded unless `polish_is_consistent()` confirms its numeric content is a
subset of the deterministic version. A "nicer" explanation is not allowed to
become a different explanation.

## The autonomous cycle

Fifteen steps, each recorded on the `LoopRun` row with its duration and outcome.
The ordering is enforced by the code, not by convention.

| # | Step | What it does |
|---|---|---|
| 1 | `verify_health` | kill switch, read-only mode, broker connectivity, blocking data issues, unresolved reconciliation breaks. Halts the cycle if any fail. |
| 2 | `market_status` | Trading calendar plus the broker's own session state. |
| 3 | `update_data` | Ingest bars, fundamentals, news, macro. Validate everything. |
| 4 | `classify_regime` | Benchmark vs its long-term trend, plus volatility, with hysteresis so the state does not flicker. |
| 5 | `generate_candidates` | Features → 12 strategies → ensemble → ranked candidates. |
| 6 | `validate_signal_freshness` | Reject a signal computed on stale data. |
| 7 | `estimate_and_compare` | Expected return, volatility, downside, cost. Rank. |
| 8 | *(construction)* | Portfolio target: weights, correlation haircuts, caps. |
| 9 | `review_open_positions` | HOLD / TRIM / EXIT / ADD for everything held, against the thesis it was opened on. |
| 10 | `risk_and_submit` | Risk engine on every intent, then the OMS. |
| 11 | *(sizing)* | Applied inside step 10 by the engine's verdict. |
| 12 | `monitor_orders` | Poll open orders; cancel stale ones. |
| 13 | `reconcile` | Compare local state to the broker; heal toward the broker. |
| 14 | `update_audit` | Snapshot, decisions, risk checks, explanations. |
| 15 | `monitor_risk_conditions` | Drawdown ladder, loss limits, cooldowns, alerts. |

Positions are reviewed (step 9) *before* new entries are submitted (step 10).
Managing what you already own is where realised returns come from.

## Data model notes

38 tables. The ones whose design carries a decision:

- **`orders.client_order_id` is UNIQUE.** The id is a SHA-256 over
  `mode | symbol | side | quantity | strategy | time-bucket`, so a replayed
  decision produces the same id and the second attempt is refused by the
  database even if two workers race.
- **`risk_checks`** is one row per limit per decision — around 39 rows for a
  single order. This is what makes "why was this trade allowed?" answerable
  months later.
- **`risk_configs` is versioned, not mutated.** Changing a limit writes a new
  active row and deactivates the old one. The history is readable.
- **`audit_logs` is append-only** and its `detail` JSON is redacted on write.
- **`positions.entry_thesis` / `exit_criteria`** are copied from the decision at
  fill time, so a later review can ask whether the original reason still holds.
- **Money is `Numeric(30,10)`.** `Numeric(24,10)` caps out around 10^14 and
  overflows on a large market cap.

## Frontend

React 18 + TypeScript + Vite + Tailwind, nine routes (eight screens plus login).
Three deliberate choices:

- **Money crosses the wire as strings.** A JSON number is a float, and a float
  is the wrong type for money. The client formats; it never arithmetics.
- **No token in `localStorage`.** The session is an `HttpOnly` cookie with a
  double-submit CSRF token. Broker credentials never reach the browser at all.
- **Missing data renders as `—`, never `0`.** A zero and an absent value mean
  very different things in a risk dashboard.

The synthetic-data banner has no dismiss control. Simulated performance must not
be presentable as a real track record.

## Where each spec constraint is enforced

| Constraint | Enforced in | Test |
|---|---|---|
| Never fall back from paper to live | `config.py` validators, `broker/factory.py` | `test_money_and_config.py`, `test_api_security.py` |
| Never fabricate market data | `data/quality.py` (report, never repair) | `test_data_quality.py` |
| No look-ahead | `features/market_view.py` | `test_lookahead.py` |
| Credentials stay server-side | `Settings.public_dict()`, `secret_values()` | `test_api_security.py` |
| Stops are not guaranteed prices | `backtest/costs.py` gap-through handling | `test_backtest.py` |
| Never full Kelly | `RiskLimits` validator (cap 0.5) | `test_sizing.py` |
| Deterministic risk authority | `risk/engine.py` | `test_risk_engine.py` |
| No duplicate orders | `execution/oms.py`, UNIQUE constraint | `test_oms.py` |
| Explanations match the record | `explain/narrator.py` | `test_paper_e2e.py` |
| Simulated data always labelled | provenance + API flags + UI banner | `test_api_security.py` |
