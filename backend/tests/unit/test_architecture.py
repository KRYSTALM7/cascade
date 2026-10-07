"""Layering rules that keep the engines deterministic and testable."""

from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"

FORBIDDEN_IN_DOMAIN = (
    "sqlalchemy",
    "fastapi",
    "starlette",
    "httpx",
    "requests",
    "google",
    "psycopg",
    "app.models",
    "app.db",
    "app.repositories",
    "app.services",
    "app.api",
    "app.llm",
    "app.core",
)


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def test_domain_layer_is_pure() -> None:
    offenders = {
        f"{path.relative_to(APP)}: {name}"
        for path in (APP / "domain").rglob("*.py")
        for name in _imports(path)
        if name.startswith(FORBIDDEN_IN_DOMAIN)
    }
    assert offenders == set()


def test_llm_layer_is_never_imported_by_domain_or_repositories() -> None:
    for layer in ("domain", "repositories"):
        for path in (APP / layer).rglob("*.py"):
            assert not any(n.startswith("app.llm") for n in _imports(path)), path
