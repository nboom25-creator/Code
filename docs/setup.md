# Setup guide

## Local development

Prerequisites:
- Python **3.11+**
- Node **20+**
- For FEA (optional but recommended): `calculix-ccx` and GL libraries for Gmsh:
  ```bash
  sudo apt install calculix-ccx libglu1-mesa libxrender1 libxcursor1 libxft2 libxinerama1
  ```

One-command setup and run:

```bash
./scripts/setup.sh     # venv + pip install + npm install (+ solver check)
./scripts/dev.sh       # backend on :8000, frontend on :5173
```

Manual equivalent:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000
# separate shell:
cd frontend && npm install && npm run dev
```

The backend creates `backend/data/` (SQLite DB + per-project artifact storage) on first start and
seeds the built-in material catalog. The frontend dev server proxies `/api` to `:8000`.

Load the demo: open http://localhost:5173 and click **Load demo project** (or
`curl -X POST http://localhost:8000/api/v1/demo`).

## Docker

```bash
docker compose up --build
```

Services: `backend` (Python + Gmsh + CalculiX), `frontend` (nginx serving the built app and
proxying `/api`), `db` (PostgreSQL 16). Volumes: `partforge_data` (uploads/meshes/results/reports),
`partforge_db` (database). Frontend at http://localhost:5173, API docs at http://localhost:8000/docs.

## Configuration

Environment variables (prefix `PARTFORGE_`, or a `.env` file in `backend/`): see `.env.example`.
Notable:

| Variable | Default | Meaning |
|---|---|---|
| `PARTFORGE_ENVIRONMENT` | development | `production` forbids mock/demo analysis results |
| `PARTFORGE_DATABASE_URL` | SQLite in data dir | any SQLAlchemy URL (PostgreSQL supported) |
| `PARTFORGE_MAX_UPLOAD_BYTES` | 100 MB | upload size limit |
| `PARTFORGE_MAX_TRIANGLES` | 2,000,000 | mesh size limit |
| `PARTFORGE_FEA_TIMEOUT_S` | 600 | solver wall-clock limit |
| `PARTFORGE_FEA_MEMORY_LIMIT_MB` | 4096 | solver address-space limit |
| `PARTFORGE_WORKER_THREADS` | 2 | background job concurrency |
| `PARTFORGE_AI_PROVIDER` | rules | `rules` \| `mock` \| `openai` \| `anthropic` |

Secrets (API keys) are only ever read from the environment — never commit them.
