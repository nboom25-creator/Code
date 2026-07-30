# Testing

439 backend tests and 17 frontend tests. The suite runs in about four minutes on
SQLite with the market simulator: no PostgreSQL, no Redis, no network, no API
keys. Determinism comes from a fixed simulator seed, so a failing assertion is
reproducible rather than "flaky".

```bash
cd backend
ruff format --check . && ruff check . && mypy aegisquant && pytest -q

cd ../frontend
npm run typecheck && npm run test && npm run build
```

## Coverage by area

| File | Tests | What it defends |
|---|---:|---|
| `test_money_and_config.py` | 27 | Decimal coercion (including numpy scalars and non-finite rejection), quantity rounding *down*, full-Kelly refusal, monotonic drawdown stages, every LIVE-mode startup refusal, no secret in `public_dict()` |
| `test_data_quality.py` | 34 | All 13 validators, the corporate-action exemption window, silent-delisting detection, issue de-duplication, provenance on every stored bar |
| `test_features.py` | 29 | Feature maths against hand-built series with known answers, registry metadata completeness, no NaN or infinity ever reaching a strategy, out-of-range values flagged rather than clipped, growth-score bounds and disqualifiers |
| `test_lookahead.py` | 14 | Absence of look-ahead, four independent ways (below) |
| `test_sizing.py` | 50 | Every sizing method bounded by the caps, risk-off producing zero, each scale factor only shrinking, Kelly caps, pyramiding rules, no arbitrary profit-taking |
| `test_risk_engine.py` | 75 | Every limit, every system-state gate, the defensive ladder, exit permissiveness, fail-closed behaviour, determinism, and that the engine never raises |
| `test_oms.py` | 48 | Client-order-id identity, triple duplicate defence, the state machine including illegal transitions, partial-fill accumulation and average price, reconciliation semantics, broker failure modes |
| `test_backtest.py` | 56 | Fill simulation, gap-through stops, participation caps, concave impact, cash/position/equity accounting, corporate actions in both adjustment modes, metrics against known curves, purged CV, Monte Carlo, bootstrap, acceptance screening |
| `test_api_security.py` | 71 | Password hashing past bcrypt's 72-byte limit, lockout, RBAC per endpoint, CSRF, cookie flags, no credential in any payload, log redaction, every live-mode refusal |
| `test_paper_e2e.py` | 35 | A full autonomous cycle end to end, plus the safety properties under composition |
| Frontend `format.test.ts`, `primitives.test.tsx` | 17 | Money formatting, missing-vs-zero rendering, the synthetic banner having no dismiss control, accessible meters |

## The tests that carry the most weight

### Look-ahead leakage — attacked four ways

Look-ahead is the failure mode that makes a worthless strategy look excellent and
is invisible in the performance numbers. `test_lookahead.py`:

1. **Structurally** — nothing dated after `as_of` is reachable through
   `PointInTime`, for bars, fundamentals, news and macro.
2. **Behaviourally** — compute a feature at time *t*, then append the future to the
   database and recompute at the same *t*. Every value must be identical to 1e-12.
   This is run per-feature and again over the whole bundle including
   cross-sectional ranks.
3. **By negative control** — a deliberately cheating `oracle` feature that reads the
   raw series *is* caught by the same harness. Without this, the stability test
   could be passing vacuously.
4. **Through corporate actions** — a 2:1 split produces no phantom return in the
   adjusted series, volume adjusts inversely, and a *future* split does not adjust
   the present.

Plus `assert_no_lookahead()` has a test proving the detector itself works: force
an off-by-N cut and it must raise.

### The risk engine — written adversarially

Each test is an attempt to get an order through that should not be: kill switch
engaged, market closed, broker disconnected, stale data, unknown data age,
unresolved reconciliation break, sector full, position at cap, drawdown past the
emergency line, penny stock, illiquid name, wide spread, dust order.

Three that matter beyond the obvious:

- `test_the_engine_never_raises_on_absurd_inputs` — a `NaN` quantity and a negative
  price produce a rejection, not an exception.
- `test_an_internal_error_produces_a_rejection_not_an_exception` — an account
  object that raises on *every* attribute access still yields a rejection.
- `test_exits_are_permitted_in_every_defensive_state` — blocking an exit is itself
  a risk.

### Explanations must be re-derivable

`test_every_explanation_is_derivable_from_recorded_inputs` re-runs the narrator
from the persisted `Decision` row and asserts the output is **character-identical**
to the stored text. If a number in an explanation cannot be re-derived from the
record, the test fails.

This test found a real gap: the narration cited a growth score and sector that the
record did not persist, so the explanation asserted numbers the audit trail could
not account for. Both are now recorded.

`test_the_polish_guard_rejects_a_rewrite_that_changes_a_number` covers the LLM
path: a faithful rephrasing passes, one that changes 100 shares to 140 does not.

### End-to-end paper simulation

`test_paper_e2e.py` runs a real cycle through the real code path — perception,
features, candidates, ensemble, risk engine, OMS, mock broker, fills, positions,
reconciliation, audit — and then asserts:

- all 15 steps ran, in order, each recorded
- every buy decision has a bull case, a bear case, a thesis and exit criteria
- every actionable decision has ≥20 risk-check rows
- no order exists without an approving verdict, and no order exceeds its approved
  quantity
- buys are price-protected limit orders, within 5% of the reference price
- `filled_quantity` equals the sum of fills, per order
- no duplicate client order ids, no duplicate broker fill ids
- the portfolio snapshot balances: `equity == cash + market value`, within a dollar
- every position carries the thesis it was opened on
- reconciliation is clean and the broker's positions match the database exactly
- every order at the broker has a local record

And the safety properties **in composition**, each with its own fresh cycle:

| Test | Asserts |
|---|---|
| kill switch | the next cycle submits nothing and halts with a stated reason |
| closed market | no orders |
| disconnected broker | no orders, no rows written |
| read-only mode | no orders |
| **two identical cycles** | no duplicate order ids, and no position past its cap |
| flatten | closes the whole book, locally and at the broker |

### Data validation

Each of the 13 validators has a positive and a negative case, and the negative
cases assert the *absence of invention*: a series missing three sessions yields 17
accepted bars, not 20 with three interpolated.

Two calibration tests exist because both directions were wrong at some point:

- `test_a_split_dated_a_few_days_earlier_still_explains_the_gap` — a split recorded
  0–3 days before the session that prints the gap is absorbed. (A weekend ex-date
  was reporting an ordinary 3:1 split as an unexplained 67% collapse, which would
  have blocked promotion for no reason.)
- `test_an_action_far_from_the_gap_does_not_excuse_it` — the window is not so wide
  that an unrelated action launders any jump in the same month.

## Deterministic fixtures

- `tests/helpers.py` builds bars, quotes, corporate actions, account snapshots and
  order intents by hand, so a test states exactly the condition it exercises
  instead of depending on whatever the simulator produced.
- `tests/conftest.py` gives each test its own SQLite file. Two expensive artefacts
  are built once per session and **cloned** per test: the ingested universe
  (`_seed_template`) and the post-cycle database (`test_paper_e2e.py`). Every test
  is fully isolated; ingestion is paid once. This took the suite from ~21s per
  seeded test to about 4 minutes total.
- Process-wide singletons — settings, engine, providers, brokers, the API rate
  limiter — are reset between tests. The rate limiter matters: every test client
  presents the same address, so one test exhausting the login budget would
  otherwise lock out every test after it.

## CI

`.github/workflows/aegisquant.yml`, four jobs:

| Job | Runs |
|---|---|
| **backend** | `ruff format --check`, `ruff check`, `mypy aegisquant`, `pytest` |
| **migrations** | Against a real PostgreSQL 16: `alembic upgrade head`, then **`alembic check`** (fails on model drift), then seed → `loop-once` → `reconcile` → `live-preflight` end to end |
| **frontend** | `tsc`, `vitest`, production `vite build` |
| **dependency-audit** | `pip-audit` and `npm audit`; advisory, so a new upstream CVE surfaces without blocking an unrelated change |

The `alembic check` step is there because a model change without a migration
otherwise produces a schema that silently disagrees with the ORM in production.

## Type checking

`mypy` is a gate on the safety-critical path: config, risk engine, order
management, brokers, governance, API security. Thirteen research and numeric
modules are excluded (documented in `pyproject.toml`) where heavy numpy
manipulation makes annotations cost more than they return. The exclusion never
covers anything that decides, sizes, or executes.

## Verified beyond the automated suite

The following were exercised by hand against real infrastructure, not just SQLite:

- **PostgreSQL 16**: migrations applied, `alembic check` reporting no drift, 39
  tables, a clean rebuild seeding 32,704 bars / 226 corporate actions / 1,404
  fundamentals / 1,600 news items / 4,358 macro rows with **zero** rejected bars
  and zero blocking data-quality issues.
- **Two autonomous cycles** on that database: 6 decisions → 234 risk-check rows →
  6 orders → 6 fills → 6 positions, all carrying theses, reconciliation clean, 6
  post-trade reviews.
- **The live API**: 401 unauthenticated, 401 on a bad password, 403 without a CSRF
  header, 403 for a viewer attempting a mutation, **409 refusing live activation**,
  and 200 on 30 read endpoints. A scan of every payload found no credential
  material and no bcrypt hash.
- **The production frontend build** driven in headless Chromium: all eight pages
  render populated data, `localStorage` and `sessionStorage` are empty, the session
  cookie is `HttpOnly` / `SameSite=Lax` and the CSRF cookie is readable, and the
  only console error is the expected 401 from the pre-login session probe.
