# Cascade — standing rules for AI assistants

Source of truth: `docs/BLUEPRINT.md` (rev 2) and `docs/EDGE_CASES.md`. Progress/resume point: `docs/PROGRESS.md`.

## Git
- NEVER run `git commit`, `git push`, or any history-rewriting git command. The maintainer commits manually. Only `git status` / `git diff` (read-only) are allowed.
- NEVER add `Co-Authored-By`, `Claude-Session`, "Generated with Claude", or any AI attribution anywhere (code, docs, commit message suggestions).

## Architecture
- No Kafka, queues, microservices, Neo4j, LangChain, or extra services. Modular monolith per the blueprint.
- `backend/app/domain` is pure: no DB / HTTP / LLM imports.
- Gemini never computes money, permissions, risk, graph structure, or approval. It parses intent and narrates.
- Money: `Decimal` / `NUMERIC(12,2)` only. All thresholds live in `backend/policy/policy.yaml`, never hardcoded.

## Phase gate (must be green before moving on)
- `ruff check`, `ruff format --check`, `mypy --strict` (app + tests), `pytest` with `REQUIRE_DB=1`.
- Frontend: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Warnings are errors. Never skip, xfail, or delete a test to get green; fix the root cause.
- Every new behaviour gets a row in `docs/EDGE_CASES.md` (ID, exact expected behaviour, test name), flipped to ✅ only when its test passes.
- No live Gemini calls in the normal test suite. Use the deterministic `rules` provider and mocks.

## Commands without `make` (Windows)
```
cd backend && uv sync && uv run alembic upgrade head && uv run python -m app.seed
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app tests
cd backend && REQUIRE_DB=1 uv run pytest
cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build
bash scripts/check.sh            # all of the above (backend | frontend | e2e)
cd frontend && npm run e2e       # Playwright; RESETS the DB the backend points at (DEMO_MODE=true)
```
