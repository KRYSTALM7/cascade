#!/usr/bin/env bash
# Phase gate without `make` (e.g. Git Bash on Windows). Same steps as `make check`, DB required.
#   scripts/check.sh            full gate
#   scripts/check.sh backend    backend only
#   scripts/check.sh frontend   frontend only
#   scripts/check.sh e2e        Playwright demo flows (resets the demo DB)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
export REQUIRE_DB=1

# uv may be installed only as a Python package (pip install --user uv).
if command -v uv >/dev/null 2>&1; then UV=(uv); else UV=(python -m uv); fi

what="${1:-all}"

if [[ "$what" == "all" || "$what" == "backend" ]]; then
  echo "== backend: ruff / mypy / pytest"
  cd "$ROOT/backend"
  "${UV[@]}" run ruff check .
  "${UV[@]}" run ruff format --check .
  "${UV[@]}" run mypy app tests
  "${UV[@]}" run pytest -W error::DeprecationWarning -q
fi

if [[ "$what" == "all" || "$what" == "frontend" ]]; then
  echo "== frontend: lint / typecheck / test / build"
  cd "$ROOT/frontend"
  npm run lint -- --max-warnings=0
  npm run typecheck
  npm test
  npm run build
fi
if [[ "$what" == "e2e" ]]; then
  echo "== e2e: Playwright (backend must run with DEMO_MODE=true; the DB it uses is RESET)"
  cd "$ROOT/frontend"
  npx playwright test
fi
echo "== gate green"
