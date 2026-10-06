"""Application factory. `uvicorn app.main:app` for serving; `create_app()` for tests."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.routes import health
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.core.request_context import REQUEST_ID_HEADER


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)

    app = FastAPI(
        title=f"{settings.app_name} API",
        version=__version__,
        description="Pre-execution consequence intelligence for AI agents.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-User-Id", REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER],
    )
    # Added last => outermost: wraps CORS and routing, so every response gets a request id.
    app.add_middleware(RequestContextMiddleware)

    register_error_handlers(app)
    app.include_router(health.router)
    return app


app = create_app()
