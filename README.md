# Cascade

**Pre-execution consequence intelligence for AI agents.**
Before an agent runs a tool, Cascade shows what *else* will happen — downstream agents, state changes, money moved, reversibility — scores the risk with an explainable deterministic model, and decides whether a human must approve.

> Traditional permissions ask *"Can Agent A call Tool B?"*
> Cascade asks *"If Agent A calls Tool B with these parameters, what happens next?"*

Built for AI Builder Cup 2026. Design: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) · Edge cases: [`docs/EDGE_CASES.md`](docs/EDGE_CASES.md) · Demo: [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) · Deploy: [`docs/DEPLOY.md`](docs/DEPLOY.md)

## What it does

A support agent proposes *"Cancel ORD-10482, customer wants out"*. Cascade:

1. **Parses** the text (offline rules parser by default, Gemini optional) into a tool call, validated against an allowlist and the tool's strict parameter model. Missing or ambiguous → it asks ("3 customers match 'John'. Which one?"), never guesses.
2. **Simulates** the action on a copy-on-write overlay of the world: `cancel_order` emits `ORDER_CANCELLED` → Finance's reaction rule refunds ₹84,500 → CRM emails and opens a case, Inventory releases stock, CRM flags the VIP. Every node is checked for authorization; every node names the rule (id@version) that created it. The database is never touched.
3. Reports the **Blast Radius**: ₹84,500 out, 3 agents, 5 downstream actions, PARTIAL reversibility.
4. **Scores risk** (5 weighted dimensions from `backend/policy/policy.yaml`) → 76 HIGH, and **decides**: BLOCKED / APPROVAL_REQUIRED / AUTO_APPROVED with plain-sentence reasons.
5. **Explains** in prose (template or Gemini); any ₹ or % figure not present in the report discards the narrative.
6. On **approval** (role + limit + no self-approval) it **executes**: locks the rows, re-simulates, compares the state fingerprint (changed → 409 STALE_STATE), applies the exact previewed changes step by step in savepoints (required step fails → full rollback; optional fails → partial).
7. **What-if**: "What if we give 20% compensation instead?" → ₹16,900, 1 downstream action, risk 53 — a deterministic A/B comparison.

Everything is audited (append-only, with request ids). Gemini never computes money, permissions, risk, graph structure or approval.

## Quick start (Docker)

```bash
cp .env.example .env          # optional: LLM_PROVIDER=gemini + GEMINI_API_KEY
docker compose up --build     # db → migrate + seed → api → web
open http://localhost:5173    # API docs: http://localhost:8000/docs
```

If port 5432 is taken on your machine, set `DB_PORT=5434` (any free port) in `.env` and point `DATABASE_URL`/`TEST_DATABASE_URL` at it.

Runs fully offline by default (`LLM_PROVIDER=rules`). Demo users (header switcher, sent as `X-User-Id`): `ops-ravi` (operator), `approver-asha` (approver, ₹1,00,000), `approver-dev` (approver, ₹10,000), `viewer-kim` (viewer).

## Host development

Requires Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 22, and Postgres 16 (`docker compose up -d db`).

```bash
make install
make db-up && make migrate && make seed
make dev-backend              # :8000 (DEMO_MODE from .env)
make dev-frontend             # :5173, proxies /api → :8000
```

## Quality gate

```bash
make check                    # ruff + format + mypy --strict + eslint + tsc + pytest + vitest + build
REQUIRE_DB=1 make test        # fail (instead of skip) if the test DB is unreachable
make e2e                      # Playwright demo flows (RESETS the demo DB; needs DEMO_MODE=true)
```

Without `make` (e.g. Windows Git Bash): `bash scripts/check.sh` (`backend` / `frontend` / `e2e`).

Current: **311 backend tests** (+1 opt-in live Gemini test), **34 frontend tests**, **7 Playwright flows**; every row in the edge-case matrix is ✅ except the opt-in live test.

## Layout

```
backend/   FastAPI · SQLAlchemy · Alembic · pure domain engines (app/domain) · LLM adapters (app/llm)
           services (app/services) · policy/policy.yaml
frontend/  React · TypeScript · Vite · Tailwind · TanStack Query · React Flow + dagre · Playwright (e2e/)
docs/      blueprint, edge-case matrix, demo script, deploy guide, progress log
```

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Repo, Docker, backend skeleton, DB, migrations, frontend shell | ✅ |
| 2 | Domain model (event → reaction schema) + NovaCart seed + read API | ✅ |
| 3 | Tool simulators + consequence engine → Blast Radius | ✅ |
| 4 | Policy YAML + risk scorer + decision engine | ✅ |
| 5 | LLM layer: rules provider, Gemini adapter, guards, clarification | ✅ |
| 6 | Services + API: parse/simulate/approve/execute/what-if/audit | ✅ |
| 7 | Frontend: simulate screen, graph, risk, approvals, what-if, dashboard, audit | ✅ |
| 8 | Concurrency hardening + Escape Room | ✅ |
| 9 | Playwright E2E + edge-case sweep | ✅ |
| 10 | Deploy guide, demo script, README, clean-clone check | ✅ |
