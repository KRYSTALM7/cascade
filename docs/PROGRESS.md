# Progress log (resume point)

A new session resumes from the **Next step** line of the latest entry. Rules: `CLAUDE.md`.

## Environment notes (this machine: Windows 11, Git Bash, no `make`)
- `uv` installed via `python -m pip install --user uv` → `C:\Users\sujan\AppData\Roaming\Python\Python314\Scripts` (prepend to PATH).
- A host PostgreSQL 17 owns `:5432` and another project's container owns `:5433`, so compose `db` is published on **`:5434`** via `DB_PORT=5434` in `.env` (compose now reads `${DB_PORT:-5432}`). `.env` points `DATABASE_URL`/`TEST_DATABASE_URL` at `:5434`.
- Gate without make: `bash scripts/check.sh` (sources `.env`, sets `REQUIRE_DB=1`, runs the same steps as `make check`).

## Step 0 — baseline ✅
- `uv sync`, `npm ci`, `docker compose up -d db`, `alembic upgrade head`, `python -m app.seed`.
- Gate: backend **80 passed**, frontend **10 passed**, ruff/mypy/eslint/tsc/build clean.
- `docker compose up --build` (first ever run): builds OK; on a fresh volume `migrate` migrates + seeds (5 agents, 14 tools, 23 permissions, 14 reactions, 10 orders); backend `/readyz` → ready; `http://localhost:5173` shows "Backend ready" (nginx proxies `/readyz`, `/api`).
- Fixes: compose DB host port made configurable (`DB_PORT`), because 5432 was taken on this machine. Nothing else broke.
- Added: `CLAUDE.md` (standing rules), `scripts/check.sh`, this file.

## Phase 3 — simulators + consequence engine ✅
- Gate: backend **182 passed** (ruff, format, mypy --strict clean); frontend unchanged (10).
- Built: `domain/money.py`, `domain/state.py` (WorldSnapshot, SimState overlay, read tracking, fingerprint), `domain/catalog.py`, `domain/tools/{base,orders,finance,inventory,crm,registry}.py` (14 simulators, strict param models), `domain/consequence/{conditions,engine,graph,report}.py`, `repositories/world.py` (load snapshot/catalog, `lock_rows`), `tests/factories.py` (in-memory NovaCart from seed data).
- Tests: `unit/test_state.py`, `unit/test_tools.py`, `unit/test_engine.py`, `unit/test_architecture.py`, `integration/test_consequence_golden.py`.
- Decisions:
  - Params are validated via JSON (`model_validate_json`) so strict mode accepts decimal strings but nothing implicit; amounts normalised to the paisa after validation.
  - `request_refund` / `issue_refund` `amount` is optional = full remaining refundable (deterministic backend default, not a guess). Compensation takes `amount` XOR `percentage`; the backend computes the rupees.
  - A BLOCKED/WOULD_FAIL node is never expanded. Root param errors → BLOCKED (`INVALID_PARAMETERS`/`MISSING_PARAMETERS`/`INVALID_AMOUNT`); downstream param errors → WOULD_FAIL.
  - Required downstream WOULD_FAIL → blocking code `REQUIRED_REACTION_WOULD_FAIL` (cause in details); downstream auth failures keep their `DOWNSTREAM_*` code.
  - Agents affected / downstream actions count only WILL_EXECUTE reaction nodes (proposer excluded).
  - Aggregate reversibility: all FULL → FULL, all NONE → NONE, else PARTIAL (no executing nodes → FULL).
  - `TOTAL_DECREASED` also requires captured money (COD downsizes never trigger a refund node).
  - `reserve_inventory` emits STOCK_BELOW_REORDER_POINT only when available crosses the reorder point; suggested qty = 2×reorder_point − available.
  - Whole business state is loaded per simulation (tiny demo world); fingerprint covers only rows read.

## Phase 4 — policy + risk + decision ✅
- Gate: backend **223 passed**; ruff/format/mypy clean.
- Built: `backend/policy/policy.yaml` (v 2026-10-07.1), `domain/policy/{model,loader,reasons,engine}.py`, `domain/risk/scorer.py`, `api/routes/policy.py` (`GET /api/policy`), `api/deps.py` (`ActivePolicy`, `AppSettings`); app loads + validates the policy at startup (`app.state.policy`); `Settings.policy_path`, `Settings.fault_injection`; Dockerfile copies `policy/`.
- Tests: `unit/test_policy_risk.py`, `api/test_policy_api.py`; `tests/factories.py` now takes limits from the policy file.
- Decisions:
  - "Irreversible effects" (approval rule) = the WHOLE cascade's aggregate reversibility is NONE. Reading it as "any irreversible step" would force approval on the ₹1,998 auto-approve demo (54 MEDIUM, refund is irreversible), contradicting the required auto-approved scenario.
  - "PII exposure to a new channel" is not modelled (no contact history); proxy = any step with `BULK_PII` → `BULK_PII_EXPOSURE` (policy flag `bulk_pii_requires_approval`).
  - Floors raise the level AND lift the score to that band's lower bound; `raw_score` keeps the formula value.
  - Approval reason code for money is `REFUND_ABOVE_AUTO_LIMIT` for any outflow (refund, compensation, reversal).
- **Decision for the maintainer:** the Medium scenario (ORD-10495 watch 1→2) scores **34 = LOW** (one point under MEDIUM) and is AUTO_APPROVED under the specified weights. Policy left unchanged; to make it MEDIUM, e.g. lower `levels.medium` to 30 in `policy.yaml` (one-line change, tests reference the policy file).

## Phase 5 — LLM layer ✅
- Gate: backend **262 passed, 1 skipped** (the opt-in `live` Gemini smoke test; skipped without `GEMINI_API_KEY` by design).
- Built: `app/llm/{schemas,provider,rules,templates,guards,gemini,facts,factory}.py`, `domain/validation/clarification.py`; `live` pytest marker.
- Verified on the web (2026-10-07): google-genai 2.28 (`HttpOptions.timeout` is **milliseconds**; `response_json_schema`; `APIError.code`); Gemini 2.5 is now restricted for new users → default `GEMINI_MODEL=gemini-3.8-flash` (`.env.example`, compose, Settings).
- Decisions:
  - Flat `LLMParameters` schema with string amounts (simple Gemini JSON schema, no float money).
  - Invented tool → `LLM_OUTPUT_INVALID`; a REAL catalog tool the agent may not call is NOT rejected at parse time: it becomes an action the engine BLOCKs as `TOOL_NOT_PERMITTED` (matches Escape Room §M and keeps the attempt in the audit trail).
  - Parameters the tool doesn't accept → `LLM_OUTPUT_INVALID`; missing ones → clarification; wrong values → the engine's param codes.
  - SDK retries disabled (`HttpRetryOptions(attempts=1)`); adapter retries once on timeout/connect/429/5xx only. `explain()` never raises: failures or unsupported figures → template, `source="template_fallback"`.
  - Numeric guard: every `₹`/`Rs`/`INR` amount and `%` in a narrative must equal (as a Decimal) a number in the facts.
  - Non-existent entity in NL text → clarification (could be a typo); structured path still BLOCKs `ORDER_NOT_FOUND`.

## Phase 6 — services + API ✅
- Gate: backend **300 passed, 1 skipped** (live Gemini).
- Built: migration `0003` (`actions.current_report_id`, `actions.explanation`), `services/{context,audit,transitions,directory,outcomes,actions,approvals,execution,whatif,views}.py`, `repositories/execution.py` (apply previewed changes with `before` checks), `schemas/actions.py`, routes `api/routes/actions.py` (parse, clarify, simulate, what-if, approve, reject, execute, list, detail, consequences, audit) and `api/routes/audit.py` (`/api/audit`, `/api/users`, `/api/demo/reset`); `app.state.{llm,clock,settings}`; error codes added to `ErrorCode`.
- Tests: `api/test_actions_api.py` (38 tests: 3 demo scenarios, unauthorized, auto-approve, what-if, idempotency, APR-01..08, EXE-01..06, CON-02/03, clarification, SEC over HTTP, reset).
- Decisions:
  - `X-User-Id` required on all POSTs (missing or unknown → 401 `USER_UNKNOWN`); GETs are open (demo). VIEWER may not propose/execute (403 `ROLE_NOT_PERMITTED`); reject needs the APPROVER role.
  - Same idempotency key + different payload → 409 `IDEMPOTENCY_KEY_REUSED`; a concurrent insert race returns the winner's action.
  - `POST /simulate {action_id}` on an already-decided action returns it unchanged (idempotent); from STALE it re-simulates and the old approval resets to PENDING (approvals never carry over).
  - Staleness = fingerprint differs OR graph shape (agents/tools/params/statuses) differs OR the fresh report is now blocked; the 409 lists `changed_rows`.
  - Execution failure returns 200 with status FAILED (+ execution row `REQUIRED_STEP_FAILED`); an optional failure also skips that node's descendants.
  - What-if alternative is a real child action (same acting agent), approvable/executable on its own.
  - Approval expiry is lazy: checked on approve/reject/execute and on `GET /api/actions/{id}`.

## Phase 7 — frontend ✅
- Gate: backend **300 passed, 1 skipped**; frontend **33 passed**, eslint `--max-warnings=0`, tsc, build clean (route-level code splitting keeps every chunk < 500 kB).
- Deps added: `react-router` 8.4, `@tanstack/react-query` 5, `@xyflow/react` 12, `@dagrejs/dagre` 3.
- Built: `src/api/{types,endpoints}.ts`; `src/graph/layout.ts` (dagre LR, bounds, `fitViewport`, exact paise money sum); components `ConsequenceGraph`, `BlastRadius`, `RiskPanel`, `ExplanationCard`, `ClarificationPrompt`, `DecisionBar`, `OrderState` (before → preview → now), `WhatIfPanel`, `Badges`, `ErrorBanner`, `UserProvider`/`UserSwitcher`; pages Simulate (main), Dashboard, Agents & rules, Audit, Escape room (stub → Phase 8); `src/lib/{format,scenarios,userContext}.ts`; header with user switcher, demo reset, backend status.
- Tests: `layout.test.ts`, `format.test.ts`, `ConsequenceGraph.test.tsx`, `RiskPanel.test.tsx`, `DecisionBar.test.tsx`, `ClarificationPrompt.test.tsx`; fixtures captured from the real API (`src/test/fixtures/*.json`); jsdom stubs for ResizeObserver/DOMMatrixReadOnly in `src/test/setup.ts`.
- Verified in the browser against the real backend: High scenario → graph, Blast Radius, risk 76, explanation, approve (asha) → execute (ravi) → order CANCELLED in the "Now" column.
- Decisions:
  - Graph viewport is controlled (own ResizeObserver + `fitViewport`), pan/zoom disabled: React Flow's `fitView` mis-fit inside lazily loaded routes (zoom clamped to minZoom).
  - Quick-picks are natural-language requests parsed by the backend (rules provider), so every demo click exercises parse → simulate.
  - Current action lives in the URL (`/simulate?action=<id>`), so reloads and E2E can deep-link.
  - `.claude/launch.json` (dev servers for the in-app browser) uses this machine's uv path; it's a local convenience file.

## Phase 8 — hardening + Escape Room ✅
- Gate: backend **311 passed, 1 skipped**; frontend **34 passed**; lint/types/build clean.
- Built: `services/escape_room.py` (4 scenarios as data + runner over the existing services), `api/routes/escape_room.py` (`GET /api/escape-room`, `POST /api/escape-room/{id}/run`, DEMO_MODE only), seed rule `crm.goodwill_on_vip_cancel` (disabled; CRM lacks `issue_compensation`), `frontend/src/pages/EscapeRoomPage.tsx`.
- Tests: `integration/test_concurrency.py` (committed world, separate sessions, `threading.Barrier`: CON-01 cancel-vs-modify race, 3× parallel execute, 2× parallel approve, second-connection writer → STALE; stable over 5 repeated runs), `api/test_escape_room_api.py`, `EscapeRoomPage.test.tsx`.
- Bug found + fixed: with `expire_on_commit=False` (the app's sessionmaker) a same-session approve after simulate saw `action.approval` cached as None → approval now attached through the relationship; locked reads (`get(..., lock=True)`) use `populate_existing`.
- Decisions:
  - DATA-08 invariant narrowed to ENABLED rules (a disabled rule cannot block a happy path); it also asserts the Escape Room rule is the only unauthorized one and is disabled. Reaction count 14 → 15.
  - Escape Room scenarios use orders outside the main demo path (ORD-10490, ORD-10530, ORD-10540) so they don't interfere with the hero; ORD-10540's scenario consumes the order → replay needs a reset (409 explains).
  - The runner replays the conflicting executions back to back (same lock + fingerprint path); genuine parallelism is proven by the concurrency tests.

## Phase 9 — E2E + sweep ✅
- Gate: backend **311 passed, 1 skipped**; frontend **34 passed**; Playwright **7 passed** (`npx playwright test`, Chromium 1243 already cached; ~20 s).
- Built: `frontend/playwright.config.ts` (webServer for backend + Vite, `reuseExistingServer`), `frontend/e2e/demo.spec.ts`, `tsconfig.e2e.json`, `npm run e2e`, `make e2e`, `scripts/check.sh e2e`; vitest limited to `src/**`; scenario buttons got aria-labels ("High scenario", …).
- Sweep: all 157 matrix rows ✅ except LLM-08 (⏭ opt-in live Gemini test, by rule).
- Decisions: E2E resets the database the backend points at (dev DB `cascade`), so it requires DEMO_MODE=true — documented in the config and the Makefile help.

## Phase 10 — delivery ✅
- Gate (final, `bash scripts/check.sh`): backend **311 passed, 1 skipped** (opt-in live Gemini), ruff/format/mypy --strict clean (110 files); frontend **34 passed**, eslint 0 warnings, tsc, build; Playwright **7 passed** (against dev servers AND against the clean-clone Docker stack).
- Built: `docs/DEPLOY.md` (Cloud Run: api + web services, Cloud SQL, Secret Manager, migrate job, env table), `docs/DEMO_SCRIPT.md` (3-minute click path), README rewritten (what it does, quick start, gate, status), `.gitignore` += `.claude/`, Playwright artefacts.
- Clean-clone check: exported exactly the files git would see (`git ls-files --cached --others --exclude-standard`, no `.env`) to a fresh directory → `DB_PORT=5435 docker compose -p cascadeclean up --build` → migrate 0001→0003 + seed (15 reactions) → `/readyz` ready through nginx → NL hero parse + simulate = PENDING_APPROVAL, 76 HIGH, ₹84,500.00 → Playwright 7/7 → `down -v`.

## Final state
- All phases 3–10 done; nothing from the core path was cut.
- Open decision for the maintainer: Medium scenario scores 34 = LOW (see Phase 4).
- Not committed (by rule). Suggested commits are in the session summary.
- Resume: nothing pending. To demo: `docker compose up --build`, open :5173, follow `docs/DEMO_SCRIPT.md`.
