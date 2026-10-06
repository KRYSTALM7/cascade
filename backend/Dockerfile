# syntax=docker/dockerfile:1.7
# Cloud Run-ready: non-root, listens on $PORT, no secrets baked in.

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app

FROM base AS deps
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project

FROM base AS runtime
RUN useradd --create-home --uid 10001 cascade
COPY --from=deps /opt/venv /opt/venv
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
USER cascade
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/healthz',timeout=2)"
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
