# Cascade

**Pre-execution consequence intelligence for AI agents.**
Before an agent runs a tool, Cascade shows what *else* will happen — downstream agents, state changes, money moved, reversibility — scores the risk with an explainable deterministic model, and decides whether a human must approve.

> Traditional permissions ask *"Can Agent A call Tool B?"*
> Cascade asks *"If Agent A calls Tool B with these parameters, what happens next?"*

Built for AI Builder Cup 2026. Design: [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md).

## Quick start (Docker)

```bash
cp .env.example .env          # optional: set LLM_PROVIDER=gemini + GEMINI_API_KEY
make up                       # db → migrations → seed → api → web
open http://localhost:5173    # API docs: http://localhost:8000/docs
```

Runs fully offline by default (`LLM_PROVIDER=rules`); Gemini is optional and never the source of truth.

## Host development

Requires Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 22, and a Postgres 16 (`make db-up` starts one in Docker).

```bash
make install
make db-up && make migrate
make dev-backend              # :8000, auto-reload
make dev-frontend             # :5173, proxies /api → :8000
```

## Quality gate

```bash
make check                    # ruff + mypy --strict + eslint + tsc + pytest + vitest + build
REQUIRE_DB=1 make test        # fail (instead of skip) if the test DB is unreachable
```

## Layout

```
backend/   FastAPI · SQLAlchemy · Alembic · deterministic engines · Gemini adapter
frontend/  React · TypeScript · Vite · Tailwind
docs/      blueprint, edge-case matrix, demo script
```

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Repo, Docker, backend skeleton, DB, migrations, frontend shell | ✅ |
| 2 | Domain model (event → reaction schema) + NovaCart seed + read API | ✅ |
| 3 | Tool simulators + consequence engine → Blast Radius | next |
| 4–10 | Risk/policy → Gemini → APIs → UI → execution → edge cases → deploy | planned |
