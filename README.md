# AegisQuant

An autonomous, auditable research-and-execution platform for US equities and
ETFs. It researches a universe, argues both sides of every trade, sizes inside
hard limits, executes through a broker, reconciles what it thinks it owns against
what it actually owns, and writes down enough that you can reconstruct any
decision months later.

> **Paper trading by default. Live trading is off and hard to turn on.** Reaching
> live requires seven independent conditions including a separate environment
> flag, a promotion gate, an in-app confirmation and a typed phrase. The platform
> never falls back from paper to live: a misconfiguration is a startup failure,
> not a downgrade.
>
> **The default data is simulated.** Every screen says so, permanently. Backtested
> and simulated results are hypothetical and are not a track record. Nothing here
> is financial advice, and no level of performance is promised anywhere in the
> code or in these docs.

---

## What it actually does

One structural commitment shapes everything:

> A language model may research, summarise, critique and explain. A
> **deterministic risk engine** decides what gets sent to a broker.

So the system is layered by *authority*. Strategies and models **propose**; a pure
function with ~30 named checks **disposes**; the OMS executes only what was
approved. There is no code path from a strategy, the API, or an LLM to
`broker.submit_order` that bypasses it.

| Area | What is built |
|---|---|
| **Data** | 6 provider interfaces, a deterministic market simulator, yfinance / Alpaca / FRED adapters, 13 validators, full provenance on every record |
| **Features** | 108-definition registry with units, expected ranges, dependencies, availability delays and versions; point-in-time-safe market, fundamental, macro and news features |
| **Strategies** | 12 strategies in 4 families behind one interface, plus a bounded ensemble allocator |
| **Backtesting** | Event-driven engine; signal at close, fill at next open; spread, square-root impact, partial fills, commissions, gap-through stops; walk-forward, purged CV, Monte Carlo, block bootstrap, stress tests, acceptance screening |
| **Risk** | Deterministic engine with final authority: ~30 checks, 5 sizing methods, a 4-stage defensive ladder, kill switch, quarantine, flatten, read-only mode |
| **Execution** | Idempotent client order IDs, an enforced state machine, partial fills, cancel-and-replace, triple duplicate defence, broker reconciliation |
| **Autonomy** | A 15-step cycle, every step recorded with its outcome |
| **Governance** | Promotion gate (paper → live-eligible), live-mode gate, append-only audit |
| **UI** | 8 operator screens: Overview, Portfolio, Opportunities, Strategy Lab, Execution Monitor, Risk Centre, Decision Journal, Settings |
| **Tests** | 439 backend tests + 17 frontend tests; lint, types, migration-drift check, and an end-to-end paper simulation in CI |

Full detail: **[Architecture](docs/architecture.md)** ·
**[Data sources](docs/data-sources.md)** ·
**[Risk controls](docs/risk-controls.md)** ·
**[Deployment](docs/deployment.md)** ·
**[Runbook](docs/runbook.md)** ·
**[Testing](docs/testing.md)** ·
**[Deferred features](docs/deferred-features.md)**

---

## Quick start

### Docker Compose

```bash
cp .env.example .env

# Two values are required. Generate the secret:
#   python -c "import secrets; print(secrets.token_urlsafe(48))"
# Set AEGIS_SECRET_KEY and AEGIS_BOOTSTRAP_ADMIN_PASSWORD in .env.

docker compose up --build

# Load the demo environment: 4 years of simulated history for 32 symbols,
# in-sample and out-of-sample backtests, and two autonomous cycles.
docker compose exec backend python -m aegisquant.cli seed --years 4 --cycles 2
```

Open <http://localhost:5173> and sign in with `AEGIS_BOOTSTRAP_ADMIN_EMAIL` /
`AEGIS_BOOTSTRAP_ADMIN_PASSWORD` (default email `admin@aegisquant.local`).

### Without Docker

```bash
# Backend
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

export AEGIS_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export AEGIS_BOOTSTRAP_ADMIN_PASSWORD="pick-something-long"
export AEGIS_DATABASE_URL="postgresql+psycopg2://aegis:aegis@localhost:5432/aegisquant"
export AEGIS_REDIS_URL="redis://localhost:6379/0"

aegisquant migrate
aegisquant seed --years 4 --cycles 2
aegisquant serve --port 8000

# Frontend, second terminal
cd frontend && npm ci && npm run dev
```

No PostgreSQL to hand? `export AEGIS_DATABASE_URL="sqlite:///aegis.db"` works for
a look around, and is what the test suite uses.

### Your first backtest

```bash
aegisquant backtest --start 2021-01-01 --end 2024-12-31 --phase in_sample --validate
```

Or use **Strategy Lab** in the UI: pick a window, pick strategies, run. Results are
labelled by phase — in-sample, validation, out-of-sample, paper — and never mixed.
The acceptance screen states its verdict and its reasons.

### Start paper trading

```bash
# One cycle now, so you can read what it decided before letting it run:
aegisquant loop-once

# Read the reasoning: UI → Journal, or
curl -b cookies.txt localhost:8000/api/journal | jq '.[0]'

# When you are satisfied, enable the scheduler:
export AEGIS_LOOP_ENABLED=true
aegisquant scheduler
```

The loop reviews existing positions *before* considering new entries, and refuses
to trade when a health check, the regime gate or a loss limit says not to. A cycle
that does nothing is a normal outcome.

---

## Repository layout

```
backend/
  aegisquant/          the platform (84 modules)
  alembic/             migrations, verified against PostgreSQL in CI
  tests/               439 tests: unit, integration, end-to-end paper simulation
frontend/
  src/                 React + TypeScript operator dashboard
docs/                  architecture, data, risk, deployment, runbook, testing
docker-compose.yml     postgres, redis, migrate, backend, worker, scheduler, frontend
src/trading_bot/       the earlier standalone agent — see docs/legacy-trading-bot.md
```

## Commands

```bash
aegisquant migrate                   # schema to head
aegisquant seed --years 4 --cycles 2 # demo environment (simulated data)
aegisquant ingest --symbols NVDA,MSFT --days 400
aegisquant backtest --start … --end … --validate
aegisquant validate --purged-cv --sensitivity
aegisquant loop-once [--no-ingest]   # one autonomous cycle
aegisquant scheduler                 # the loop on an interval
aegisquant worker --concurrency 2    # durable jobs
aegisquant reconcile                 # broker vs local
aegisquant promote-check             # promotion gate per strategy
aegisquant live-preflight            # what stands between here and live
aegisquant metrics --prometheus
aegisquant serve --port 8000
```

## Running the checks

```bash
cd backend
ruff format --check . && ruff check . && mypy aegisquant && pytest -q

cd ../frontend
npm run typecheck && npm run test && npm run build
```

---

## The parts worth knowing about

**Point-in-time correctness is a boundary, not a habit.** One object,
`MarketView.at(as_of)`, decides what was knowable at an instant, and every
feature, strategy and backtest reads through it. Fundamentals appear at their
filing time, not their period end. News appears when published. Macro appears at
its release. Prices are stored **unadjusted**, because a vendor's back-adjusted
series already reflects splits that had not happened yet — look-ahead baked into
the data. The test suite attacks this four ways, including a deliberately cheating
"oracle" feature that the same harness catches.

**Never full Kelly.** The Kelly fraction defaults to 0.25 and is capped at 0.5 by
validation. Full Kelly maximises growth only under perfectly known probabilities,
and every probability here is an estimate.

**Stops are not guaranteed prices.** A gap through a stop fills at the gapped
open. A backtester that fills stops at the stop systematically understates tail
risk.

**Explanations are rendered from the record, not written about it.** The
end-to-end test re-runs the narrator from the stored decision row and asserts the
output is character-identical. An LLM may only *rewrite* that text, and the
rewrite is discarded unless its numbers are a subset of the original.

**Winners are not sold at an arbitrary percentage.** A position is trimmed when
its *thesis* weakens and exited when it is invalidated, or when a risk limit
binds. Pyramiding into winners requires open profit; averaging down has no code
path.

**Simulated data is never presentable as real.** Every synthetic record is flagged
at the provenance level, the API exposes the flag, and the UI banner has no
dismiss control.

---

## Before you trade real money

Read [the runbook](docs/runbook.md) and [risk controls](docs/risk-controls.md)
first. Then, at minimum:

1. Run on **real** data (`AEGIS_PRICE_PROVIDER=yfinance` or `alpaca`) — results on
   the simulator prove the pipeline works, not that a strategy does.
2. Backtest with genuine out-of-sample separation and read the acceptance verdict.
3. Paper trade for at least the promotion gate's window, and confirm paper
   tracking error against the backtest is inside tolerance. If paper does not
   resemble the backtest, the backtest is wrong.
4. Pass the promotion gate: `aegisquant promote-check`.
5. Pass preflight: `aegisquant live-preflight`.
6. Set `AEGIS_LIVE_MAX_ALLOCATION_USD` small. It bounds your worst case.
7. Know where the kill switch is before you need it.

Algorithmic trading can lose money quickly. Start on paper, understand the code,
and risk only what you can afford to lose.

## Licence and status

Personal research software. No warranty, no guarantee of any performance level,
and no financial advice.
