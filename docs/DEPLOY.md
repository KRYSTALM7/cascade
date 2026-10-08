# Deploying Cascade to Google Cloud Run (public hackathon demo)

Two Cloud Run services built from the repo's Dockerfiles, one Cloud SQL PostgreSQL database, secrets in Secret Manager. No other infrastructure.

```
browser ──▶ cascade-web (Cloud Run, public)  ──/api, /healthz, /readyz──▶  cascade-api (Cloud Run)  ──▶  Cloud SQL (Postgres 16)
            nginx + static SPA                                              FastAPI, PUBLIC_MODE on        synthetic NovaCart only
                                                                                 │
                                                                                 └──▶ Gemini API (optional, capped)
```

## How the pieces are exposed (read this first)

| Component | Exposure | Why |
|---|---|---|
| `cascade-web` | Public (`--allow-unauthenticated`) | The judge-facing site. nginx serves the SPA and reverse-proxies `/api`, `/healthz`, `/readyz` to `cascade-api`, so the browser sees a single origin. |
| `cascade-api` | Public URL (`--allow-unauthenticated`) | nginx is a plain reverse proxy and cannot attach Google identity tokens, so a private (`--no-allow-unauthenticated`) API would answer every proxied request with 403. The API is protected **by the application** instead: `PUBLIC_MODE` refuses every shared-state demo operation, hides the API docs, and Gemini usage is capped. It exposes nothing that is not also reachable through `cascade-web`. |
| Cloud SQL | Private (Cloud SQL connector via `--add-cloudsql-instances`) | Only `cascade-api` and the migrate job connect. |
| Secrets | Secret Manager | `DATABASE_URL`, `GEMINI_API_KEY` (optional), `DEMO_ADMIN_TOKEN` (optional). |

### Public mode vs presenter mode

`PUBLIC_MODE` decides whether visitors can change the **shared** demo data for everyone.

| Setting | Public demo (`cascade-api` on Cloud Run) | Presenter environment (your laptop, `docker compose`) |
|---|---|---|
| `ENVIRONMENT` | `production` | `local` |
| `PUBLIC_MODE` | unset (**defaults to on when `ENVIRONMENT=production`**) or `true` | unset (off for `local`) |
| `DEMO_MODE` | `true` (demo identities, demo banner) | `true` |
| `POST /api/demo/reset` | **403 `PUBLIC_MODE_RESTRICTED`** (unless `X-Demo-Admin-Token` matches `DEMO_ADMIN_TOKEN`) | allowed |
| `POST /api/escape-room/{id}/run` | **403 `PUBLIC_MODE_RESTRICTED`** (same token exception) | allowed |
| `/docs`, `/redoc`, `/openapi.json` | 404 (disabled) | available |
| UI | Reset buttons hidden; Escape Room shows "Presenter only" | everything |
| `LLM_PROVIDER` | `rules` (recommended) or `gemini` with `LLM_CALL_LIMIT` | `rules` |

A cloud deploy is safe by default: with `ENVIRONMENT=production` and no `PUBLIC_MODE`, the dangerous operations are off. Turning them on for a cloud instance requires writing `PUBLIC_MODE=false` explicitly. **Never do that for a URL you share.**

**Never expose publicly:** `POST /api/demo/reset` (truncates every table, including the audit log), `POST /api/escape-room/{id}/run` (enables a rule, edits an order, consumes orders), the API docs, and any instance started with `FAULT_INJECTION` set.

## 0. Prerequisites

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT
export REGION=asia-south1          # any Cloud Run region
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com
gcloud artifacts repositories create cascade --repository-format=docker --location=$REGION
export AR=$REGION-docker.pkg.dev/$(gcloud config get-value project)/cascade
```

## 1. Database (synthetic data only)

```bash
gcloud sql instances create cascade-db --database-version=POSTGRES_16 --tier=db-g1-small --region=$REGION
gcloud sql databases create cascade --instance=cascade-db
gcloud sql users create cascade --instance=cascade-db --password='CHOOSE-A-PASSWORD'
export SQL_CONN=$(gcloud sql instances describe cascade-db --format='value(connectionName)')
```

This database holds **only the seeded NovaCart demo world**. Never load real customer, payment or financial data, and never reuse the instance for anything else. Visitors' typed requests are stored and readable by other visitors.

`DATABASE_URL` over the built-in Cloud SQL unix socket:

```
postgresql+psycopg://cascade:CHOOSE-A-PASSWORD@/cascade?host=/cloudsql/<SQL_CONN>
```

(`postgres://…` URLs from other providers are accepted; the app normalises them to the psycopg driver.)

### Connection-pool sizing

Each API instance opens at most `DB_POOL_SIZE + DB_MAX_OVERFLOW` connections (defaults 5 + 10). The whole deployment must fit under the Cloud SQL tier's `max_connections`, with headroom for the migrate job and maintenance:

```
(DB_POOL_SIZE + DB_MAX_OVERFLOW) × --max-instances  +  ~5 headroom  ≤  max_connections
```

Check the current limit for your tier in the Cloud SQL documentation. At the time of writing, `db-f1-micro` allows about 25 connections and `db-g1-small` about 50. Settings that fit:

| Tier | `DB_POOL_SIZE` | `DB_MAX_OVERFLOW` | `--max-instances` | Max connections used |
|---|---|---|---|---|
| db-f1-micro | 5 | 2 | 2 | 14 |
| db-g1-small | 5 | 5 | 3 | 30 |

Endpoints are synchronous, and with Gemini a request holds its connection during the LLM call (timeout `LLM_TIMEOUT_SECONDS`, one retry). Keep Cloud Run `--concurrency` modest (20 below) so requests queue in Cloud Run rather than time out waiting for a pool connection. None of this has been load-tested.

## 2. Secrets

```bash
printf '%s' 'postgresql+psycopg://cascade:CHOOSE-A-PASSWORD@/cascade?host=/cloudsql/'"$SQL_CONN" \
  | gcloud secrets create cascade-database-url --data-file=-
# Optional: lets the presenter reset the PUBLIC instance with a header (see §7). Use a long random value.
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create cascade-demo-admin-token --data-file=-
# Optional: only if LLM_PROVIDER=gemini.
printf '%s' 'YOUR_GEMINI_KEY' | gcloud secrets create cascade-gemini-key --data-file=-

export SA=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')-compute@developer.gserviceaccount.com
for s in cascade-database-url cascade-demo-admin-token cascade-gemini-key; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member=serviceAccount:$SA --role=roles/cloudsql.client
```

Skip the lines for secrets you did not create. All secrets are `SecretStr` settings: they are never logged or rendered (INF-11).

## 3. Build images

```bash
gcloud builds submit backend  --tag $AR/cascade-api:v1
gcloud builds submit frontend --tag $AR/cascade-web:v1
```

## 4. Migrate + seed (Cloud Run job, once per release)

```bash
gcloud run jobs create cascade-migrate --image=$AR/cascade-api:v1 --region=$REGION \
  --set-cloudsql-instances=$SQL_CONN \
  --set-secrets=DATABASE_URL=cascade-database-url:latest \
  --set-env-vars=ENVIRONMENT=production \
  --command=sh --args=-c,"alembic upgrade head && python -m app.seed --if-empty"
gcloud run jobs execute cascade-migrate --region=$REGION --wait
```

`--if-empty` seeds NovaCart only into an empty database, so re-running the job keeps the demo history.

## 5. API service (public mode)

Deterministic rules provider (recommended for the public demo; no LLM cost):

```bash
gcloud run deploy cascade-api --image=$AR/cascade-api:v1 --region=$REGION \
  --add-cloudsql-instances=$SQL_CONN \
  --set-secrets=DATABASE_URL=cascade-database-url:latest,DEMO_ADMIN_TOKEN=cascade-demo-admin-token:latest \
  --set-env-vars=ENVIRONMENT=production,DEMO_MODE=true,LLM_PROVIDER=rules,LOG_JSON=true,DB_POOL_SIZE=5,DB_MAX_OVERFLOW=5,CORS_ORIGINS=https://example.invalid \
  --min-instances=1 --max-instances=3 --concurrency=20 --cpu=1 --memory=512Mi \
  --allow-unauthenticated
export API_URL=$(gcloud run services describe cascade-api --region=$REGION --format='value(status.url)')
```

To demonstrate Gemini instead, change these settings: `LLM_PROVIDER=gemini`, add `GEMINI_API_KEY=cascade-gemini-key:latest` to `--set-secrets`, and set a budget, e.g. `LLM_CALL_LIMIT=100,LLM_CALL_WINDOW_SECONDS=3600`. Each instance then sends at most 100 Gemini requests per hour (worst case: limit × `--max-instances`). After that the deterministic rules provider answers, the decision is unchanged, and the parser is recorded as `rules`. Also set a quota or budget alert on the Gemini key in Google Cloud.

Notes:
- `PUBLIC_MODE` is deliberately not set: `ENVIRONMENT=production` turns it on. Setting it explicitly (`PUBLIC_MODE=true`) is also fine.
- `CORS_ORIGINS` must be explicit (wildcards refuse to boot). The browser goes through nginx, so the SPA does not need it.
- The container runs as a non-root user and listens on `$PORT`. Liveness is `/healthz`; readiness is `/readyz` (pings the DB, 503 envelope if down).
- `--min-instances=1` avoids a cold start during judging.
- Never set `FAULT_INJECTION` on a deployed service.

## 6. Web service

```bash
gcloud run deploy cascade-web --image=$AR/cascade-web:v1 --region=$REGION \
  --set-env-vars=BACKEND_URL=$API_URL \
  --allow-unauthenticated --min-instances=1
```

nginx renders `BACKEND_URL` into its config at start and proxies `/api`, `/healthz`, `/readyz` (and `/docs`, which the public API answers with 404).

## 7. Verify (do this before sharing the URL)

```bash
WEB=$(gcloud run services describe cascade-web --region=$REGION --format='value(status.url)')
curl -s $WEB/readyz                       # {"status":"ready","database":"ok"}
curl -s $WEB/healthz                      # ... "demo_mode":true,"public_mode":true
curl -s -X POST $WEB/api/demo/reset       # 403 PUBLIC_MODE_RESTRICTED  — must NOT reset
curl -s -X POST $WEB/api/escape-room/state-tampering/run   # 403 PUBLIC_MODE_RESTRICTED
curl -s -o /dev/null -w '%{http_code}\n' $WEB/docs          # 404
```

If `public_mode` is not `true`, or the reset does not return 403, stop and fix the configuration before sharing the URL.

Open `$WEB`, check the header says "Backend ready", and run the flagship ("Simulate consequences").

**Presenter reset of the public instance** (restores NovaCart for the next judge; only works if you created `DEMO_ADMIN_TOKEN`):

```bash
curl -s -X POST $WEB/api/demo/reset -H "X-Demo-Admin-Token: $(gcloud secrets versions access latest --secret=cascade-demo-admin-token)"
```

All visitors share one dataset. Executing the flagship consumes ORD-10550's second laptop for everyone until the presenter resets. Show the Escape Room from the presenter environment (`docker compose up --build` locally), not on the public instance.

## Environment variables (all read in `backend/app/core/config.py` only)

| Variable | Default | Public demo | Notes |
|---|---|---|---|
| `DATABASE_URL` | local compose DB | Secret | `postgresql+psycopg://…` (plain `postgres://` accepted) |
| `ENVIRONMENT` | `local` | `production` | `production` turns `PUBLIC_MODE` on unless set |
| `PUBLIC_MODE` | unset → on in production, off otherwise | unset or `true` | Refuses reset + Escape Room runs, disables API docs |
| `DEMO_MODE` | `false` | `true` | Demo identities; required for reset/Escape Room at all |
| `DEMO_ADMIN_TOKEN` | – | Secret (optional) | Presenter header `X-Demo-Admin-Token` for reset/Escape Room on a public instance |
| `LLM_PROVIDER` | `rules` | `rules` (or `gemini`) | `gemini` requires `GEMINI_API_KEY` |
| `GEMINI_API_KEY` | – | Secret, only with Gemini | |
| `GEMINI_MODEL` | `gemini-3.8-flash` | | Verified against the model list on 2026-10-07 |
| `LLM_CALL_LIMIT` | `200` | e.g. `100` | Gemini requests per instance per window; then the rules provider answers. `0` = never call Gemini |
| `LLM_CALL_WINDOW_SECONDS` | `3600` | `3600` | |
| `LLM_TIMEOUT_SECONDS` | `10` | `10` | One retry on timeout/5xx/429 only |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | `5` / `10` | see §1 sizing | Per-instance connections = sum |
| `CORS_ORIGINS` | `http://localhost:5173` | explicit URL | CSV; no wildcards |
| `LOG_JSON` / `LOG_LEVEL` | `true` / `INFO` | `true` / `INFO` | Structured logs with request ids |
| `POLICY_PATH` | `backend/policy/policy.yaml` | default | Validated at boot |
| `FAULT_INJECTION` | – | **never set** | Tests only: a tool id whose execution fails |
| Frontend `BACKEND_URL`, `PORT` | `http://backend:8000`, `8080` | `$API_URL` | nginx runtime config |
