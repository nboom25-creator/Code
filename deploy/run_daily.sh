#!/usr/bin/env bash
# Daily driver for the autonomous trading agent on an always-on Linux host.
#
# Activates the project's virtualenv, runs one decision cycle, and appends all
# output to a dated log under logs/. Intended to be invoked by cron on weekdays
# (see trading-bot.cron). Safe to run by hand too.
set -uo pipefail

# Resolve the repo root (this script lives in <repo>/deploy/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR" || exit 1

# Activate the virtualenv created during setup (see DEPLOY.md).
if [[ -f .venv/bin/activate ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

# Load .env so cron (which has a bare environment) sees the API keys.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

mkdir -p logs
LOG="logs/cron-$(date +%F).log"

{
  echo "===== $(date -Is) starting agent run ====="
  python -m trading_bot agent
  status=$?
  echo "===== $(date -Is) finished (exit ${status}) ====="
} >> "$LOG" 2>&1

exit "${status:-0}"
