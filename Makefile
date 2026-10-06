# Cascade — one-word developer commands. `make help` lists them.
SHELL := /bin/bash
-include .env
export

BACKEND  := backend
FRONTEND := frontend
UV       := cd $(BACKEND) && uv run
NPM      := cd $(FRONTEND) && npm

.DEFAULT_GOAL := help
.PHONY: help install up down logs db-up migrate seed dev-backend dev-frontend \
        test test-backend test-frontend lint lint-backend lint-frontend fmt typecheck check

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n",$$1,$$2}'

install: ## Install backend (uv) and frontend (npm) dependencies
	cd $(BACKEND) && uv sync
	$(NPM) ci

# ---- Docker stack ----------------------------------------------------------
up: ## Build and start db + migrate + backend + frontend (http://localhost:5173)
	docker compose up --build -d
	@echo "web http://localhost:5173  api http://localhost:8000/docs"

down: ## Stop the stack (keeps the database volume)
	docker compose down

logs: ## Tail stack logs
	docker compose logs -f --tail=100

db-up: ## Start only Postgres (for running backend/tests on the host)
	docker compose up -d db

# ---- Host development ------------------------------------------------------
migrate: ## Apply migrations to DATABASE_URL
	$(UV) alembic upgrade head

seed: ## WIPE and reload the NovaCart demo dataset into DATABASE_URL
	$(UV) python -m app.seed

dev-backend: ## API with auto-reload on :8000
	$(UV) uvicorn app.main:app --reload --port 8000

dev-frontend: ## Vite dev server on :5173 (proxies /api to :8000)
	$(NPM) run dev

# ---- Quality gates ---------------------------------------------------------
test-backend: ## Backend tests (DB tests need TEST_DATABASE_URL reachable)
	$(UV) pytest -W error::DeprecationWarning

test-frontend: ## Frontend unit/component tests
	$(NPM) test

test: test-backend test-frontend ## All tests

lint-backend:
	$(UV) ruff check .
	$(UV) ruff format --check .

lint-frontend:
	$(NPM) run lint

lint: lint-backend lint-frontend ## All linters

typecheck: ## mypy --strict + tsc
	$(UV) mypy app tests
	$(NPM) run typecheck

fmt: ## Auto-format backend
	$(UV) ruff format .
	$(UV) ruff check --fix .

check: lint typecheck test ## Phase gate: lint + types + tests (REQUIRE_DB=1 to forbid DB skips)
	$(NPM) run build
