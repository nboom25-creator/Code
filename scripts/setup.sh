#!/usr/bin/env bash
# One-command setup: backend venv + frontend node_modules.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Python backend"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r backend/requirements-dev.txt

echo "==> Frontend"
(cd frontend && npm install)

echo "==> Optional solver check"
if command -v ccx >/dev/null 2>&1; then
  echo "    CalculiX found: $(command -v ccx)"
else
  echo "    CalculiX (ccx) NOT found — FEA will be disabled."
  echo "    Install with: sudo apt install calculix-ccx   (plus libglu1-mesa for Gmsh)"
fi

echo "==> Done. Start the app with ./scripts/dev.sh"
