# Deploying Cascade to Google Cloud Run

Two Cloud Run services built from the repo's Dockerfiles, one PostgreSQL database, secrets in Secret Manager. No other infrastructure.

```
browser ──▶ cascade-web (nginx, static SPA)  ──/api, /healthz, /readyz──▶  cascade-api (FastAPI)  ──▶  Cloud SQL / any Postgres 16
                                                                              │
                                                                              └──▶ Gemini API (optional; LLM_PROVIDER=gemini)
```

The browser only talks to `cascade-web`; nginx reverse-proxies `/api` to `cascade-api`, so there is no CORS setup and the API URL never ships in the bundle.

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

## 1. Database

Cloud SQL (or any managed Postgres 16, e.g. Neon/Supabase — then skip the `--add-cloudsql-instances` flags and use its URL):

```bash
gcloud sql instances create cascade-db --database-version=POSTGRES_16 --tier=db-f1-micro --region=$REGION
gcloud sql databases create cascade --instance=cascade-db
gcloud sql users create cascade --instance=cascade-db --password='CHOOSE-A-PASSWORD'
export SQL_CONN=$(gcloud sql instances describe cascade-db --format='value(connectionName)')
```

`DATABASE_URL` for Cloud Run over the built-in Cloud SQL unix socket:

```
postgresql+psycopg://cascade:CHOOSE-A-PASSWORD@/cascade?host=/cloudsql/<SQL_CONN>
```

(`postgres://…` URLs from other providers are accepted too; the app normalises them to the psycopg driver.)

## 2. Secrets

```bash
printf '%s' 'postgresql+psycopg://cascade:CHOOSE-A-PASSWORD@/cascade?host=/cloudsql/'"$SQL_CONN" \
  | gcloud secrets create cascade-database-url --data-file=-
printf '%s' 'YOUR_GEMINI_KEY' | gcloud secrets create cascade-gemini-key --data-file=-   # optional

export SA=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')-compute@developer.gserviceaccount.com
for s in cascade-database-url cascade-gemini-key; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member=serviceAccount:$SA --role=roles/cloudsql.client
```

The API key is a `SecretStr` in settings: it is never logged or rendered (tested: INF-11).

## 3. Build images

```bash
gcloud builds submit backend  --tag $AR/cascade-api:v1
gcloud builds submit frontend --tag $AR/cascade-web:v1
```

## 4. Migrate + seed (Cloud Run job, run once per release)

```bash
gcloud run jobs create cascade-migrate --image=$AR/cascade-api:v1 --region=$REGION \
  --set-cloudsql-instances=$SQL_CONN \
  --set-secrets=DATABASE_URL=cascade-database-url:latest \
  --set-env-vars=ENVIRONMENT=production \
  --command=sh --args=-c,"alembic upgrade head && python -m app.seed --if-empty"
gcloud run jobs execute cascade-migrate --region=$REGION --wait
```

`--if-empty` seeds NovaCart only into an empty database, so re-running the job on a release keeps demo history.

## 5. API service

```bash
gcloud run deploy cascade-api --image=$AR/cascade-api:v1 --region=$REGION \
  --add-cloudsql-instances=$SQL_CONN \
  --set-secrets=DATABASE_URL=cascade-database-url:latest,GEMINI_API_KEY=cascade-gemini-key:latest \
  --set-env-vars=ENVIRONMENT=production,LOG_JSON=true,LLM_PROVIDER=gemini,GEMINI_MODEL=gemini-3.8-flash,DEMO_MODE=true,CORS_ORIGINS=https://example.invalid \
  --min-instances=1 --max-instances=3 --cpu=1 --memory=512Mi \
  --no-allow-unauthenticated
export API_URL=$(gcloud run services describe cascade-api --region=$REGION --format='value(status.url)')
```

- Listens on `$PORT` (set by Cloud Run); container runs as a non-root user.
- Liveness `/healthz`, readiness `/readyz` (pings the DB; returns 503 envelope if down).
- `LLM_PROVIDER=rules` runs fully offline. With `gemini`, a missing key refuses to boot (INF-09); Gemini outages never block the structured flow (SEC-07).
- `DEMO_MODE=true` enables `POST /api/demo/reset` and the Escape Room runner. **Set it to `false` for anything that is not a demo.**
- `--min-instances=1` avoids a cold start in the middle of a live demo.
- `CORS_ORIGINS` must be explicit (wildcards are refused); the browser goes through nginx, so it is not needed by the SPA.

## 6. Web service

```bash
gcloud run deploy cascade-web --image=$AR/cascade-web:v1 --region=$REGION \
  --set-env-vars=BACKEND_URL=$API_URL \
  --allow-unauthenticated --min-instances=1
```

nginx renders `BACKEND_URL` into its config at start and proxies `/api`, `/healthz`, `/readyz`, `/docs`. If the API is private (`--no-allow-unauthenticated` above), either make it public, or give `cascade-web` an identity-aware proxy / serverless NEG in front of both services. The simplest demo setup is: API public (`--allow-unauthenticated`) with `DEMO_MODE=true` and seeded demo users only.

## 7. Verify

```bash
WEB=$(gcloud run services describe cascade-web --region=$REGION --format='value(status.url)')
curl -s $WEB/readyz            # {"status":"ready","database":"ok"}
curl -s $WEB/api/policy | head -c 200
```

Open `$WEB` → the header shows "Backend ready" → click **High** on the Simulate page.

## Environment variables (all read in `backend/app/core/config.py` only)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | local compose DB | Secret. `postgresql+psycopg://…` (plain `postgres://` accepted) |
| `ENVIRONMENT` | `local` | `production` on Cloud Run |
| `LLM_PROVIDER` | `rules` | `gemini` requires `GEMINI_API_KEY` |
| `GEMINI_API_KEY` | – | Secret |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Verified against the model list on 2026-10-07 |
| `LLM_TIMEOUT_SECONDS` | `10` | One retry on timeout/5xx/429 only |
| `DEMO_MODE` | `false` | Enables demo reset + Escape Room |
| `CORS_ORIGINS` | `http://localhost:5173` | CSV; no wildcards |
| `LOG_JSON` / `LOG_LEVEL` | `true` / `INFO` | Structured logs with request ids |
| `POLICY_PATH` | `backend/policy/policy.yaml` | Thresholds/weights; validated at boot |
| `FAULT_INJECTION` | – | Tests/demo only: a tool id whose execution fails |
| Frontend `BACKEND_URL`, `PORT` | `http://backend:8000`, `8080` | nginx runtime config |
