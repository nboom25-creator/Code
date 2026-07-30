# Deployment guide

## What runs

| Process | Command | Purpose |
|---|---|---|
| API | `aegisquant serve` | FastAPI, serves the dashboard's data |
| Worker | `aegisquant worker` | Durable jobs: ingestion, backtests, reconciliation, reviews |
| Scheduler | `aegisquant scheduler` | Fires the autonomous loop on an interval |
| Frontend | nginx serving `dist/` | Static assets + `/api` proxy |
| PostgreSQL 16 | — | System of record |
| Redis 7 | — | Job queue and cache |

The worker and scheduler are separate on purpose: the loop must keep its cadence
even while a long backtest occupies a worker.

## Docker Compose (recommended)

```bash
cp .env.example .env
# Edit .env: AEGIS_SECRET_KEY and AEGIS_BOOTSTRAP_ADMIN_PASSWORD are required.
#   python -c "import secrets; print(secrets.token_urlsafe(48))"

docker compose up --build

# Once healthy, load the demo environment (simulated data):
docker compose exec backend python -m aegisquant.cli seed --years 4 --cycles 2

open http://localhost:5173
```

The `migrate` service runs Alembic to completion and exits; everything else waits
for it via `service_completed_successfully`, so no process ever talks to a
half-migrated schema.

Ports are overridable in `.env` (`BACKEND_PORT`, `FRONTEND_PORT`,
`POSTGRES_PORT`, `REDIS_PORT`).

## Manual install

```bash
# --- backend ---
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"          # add ".[dev,providers]" for yfinance

export AEGIS_DATABASE_URL="postgresql+psycopg2://aegis:aegis@localhost:5432/aegisquant"
export AEGIS_REDIS_URL="redis://localhost:6379/0"
export AEGIS_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export AEGIS_BOOTSTRAP_ADMIN_PASSWORD="pick-something-long"

aegisquant migrate
aegisquant seed --years 4 --cycles 2
aegisquant serve --port 8000

# --- frontend (second terminal) ---
cd frontend
npm ci
npm run dev                       # proxies /api to 127.0.0.1:8000

# --- worker and scheduler (optional, third terminal) ---
aegisquant worker --concurrency 2
aegisquant scheduler
```

SQLite works for a keyless local look (`AEGIS_DATABASE_URL=sqlite:///aegis.db`)
and is what the test suite uses. PostgreSQL is the production target — it is what
the migrations are verified against, and the only backend where the money column
types behave identically under concurrency.

## Configuration

Everything is environment-driven with the `AEGIS_` prefix; see
[`.env.example`](../.env.example) for the annotated list. Validation happens at
import, so a bad configuration fails at startup rather than at the first trade:

- `AEGIS_MODE=LIVE` without `AEGIS_LIVE_TRADING_ENABLED=true` → refuses to start
- `AEGIS_MODE=LIVE` with `AEGIS_BROKER=mock` → refuses to start
- default `AEGIS_SECRET_KEY` outside development → refuses to start
- `AEGIS_BROKER=alpaca` without credentials → refuses to start
- incoherent risk limits (Kelly > 0.5, out-of-order drawdown stages) → refuses

## Migrations

```bash
aegisquant migrate                                  # upgrade to head
alembic revision --autogenerate -m "add x"          # after a model change
alembic check                                       # fails if models drifted
alembic downgrade -1
```

`alembic check` runs in CI against a real PostgreSQL service. A model change
without a migration fails the build, because the alternative is a schema that
silently disagrees with the ORM in production.

## Health and readiness

| Endpoint | Meaning | Use for |
|---|---|---|
| `GET /api/health` | Process is up. No auth, no sensitive detail. | liveness probe |
| `GET /api/ready` | Database reachable, migrations at head, broker reachable. `503` when not. | readiness probe / load-balancer gate |

Both are unauthenticated by design — a probe should not need a credential — and
both are covered by a test that scans their output for secret material.

Operational metrics: `aegisquant metrics --prometheus` emits Prometheus text, and
`GET /api/risk` carries live limit utilisation for dashboards.

## Reverse proxy and TLS

The Compose frontend already proxies `/api` to the backend, which keeps the
session cookie **first-party**. Do the same in any other topology. Behind TLS,
set `AEGIS_COOKIE_SECURE=true`.

If you must split origins, set `AEGIS_CORS_ORIGINS` to the exact frontend origin.
Do not use `*`: the session cookie is `SameSite=Lax` and a wildcard origin with
credentials is not a configuration that works, only one that looks like it might.

## Backups

The database is the system of record and much of it is legally interesting: the
audit log, the decision journal, the trade ledger, and every risk-config version.

```bash
pg_dump --format=custom --file=aegis-$(date +%F).dump "$AEGIS_DATABASE_URL"
```

Back up before every upgrade. Redis holds only queue state and cache; losing it
costs an in-flight job, not a record.

## Upgrading

1. Back up the database.
2. Engage the kill switch from the Execution Monitor (audited).
3. Pull, rebuild, run `aegisquant migrate`.
4. Restart the API, worker and scheduler.
5. Run `aegisquant reconcile` and confirm it comes back clean.
6. Release the kill switch.

Step 5 matters: local order state and broker state must agree before trading
resumes, and after a restart that is an assumption rather than a fact.

## Security checklist before exposing this to a network

- [ ] `AEGIS_SECRET_KEY` is long and random, not the default
- [ ] `AEGIS_BOOTSTRAP_ADMIN_PASSWORD` changed after the first login
- [ ] `AEGIS_COOKIE_SECURE=true` and TLS terminated in front
- [ ] `AEGIS_CORS_ORIGINS` names exact origins, never `*`
- [ ] `AEGIS_ENV_NAME=production` (turns on JSON logs and stricter validation)
- [ ] PostgreSQL not reachable from the internet; strong password
- [ ] `.env` not committed and readable only by the service user
- [ ] Roles assigned deliberately — `viewer` for anyone who does not need to act
- [ ] `AEGIS_LIVE_TRADING_ENABLED` left `false` until you mean it
- [ ] Backups running and *restore* tested, not just backup

## Scaling notes

- The API is stateless; run several behind a load balancer.
- Run **one** scheduler. Two would produce two cycles per interval. Order
  idempotency means that is not a disaster, but it is still wrong.
- Workers scale horizontally. Celery is configured with `acks_late` and
  `prefetch_multiplier=1`, so a worker crash re-queues the task rather than
  losing it.
- The heaviest queries are backtest reads. If they start to hurt, a read replica
  for research and the primary for execution is the natural split.

## Known operational limitations

Stated plainly rather than discovered later:

- **The default data is simulated.** Every screen says so. Point the providers at
  real sources before drawing any conclusion about a strategy.
- **`yfinance` is unofficial** — no SLA, rate-limited, occasional gaps. Fine for
  research, not for live.
- **The mock broker is in-process.** Its state lives in memory and is rehydrated
  from the database on handout, which is enough for a single-node demo but is not
  a distributed paper broker. Use Alpaca paper for anything multi-process.
- **No intraday bars.** The loop and the backtester are daily-bar systems. The
  interfaces accept a timeframe, but only `1Day` is exercised.
- **Options, futures, crypto, leveraged ETFs, margin and unrestricted shorting
  are interface-only and disabled.** The risk engine rejects them.
