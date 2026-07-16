#!/usr/bin/env bash
# Start backend (:8000) and frontend dev server (:5173).
set -euo pipefail
cd "$(dirname "$0")/.."

trap 'kill 0' EXIT
(cd backend && ../.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload) &
(cd frontend && npm run dev -- --host) &
wait
