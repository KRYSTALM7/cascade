"""Read + validate policy.yaml. A malformed policy raises at startup, never at request time."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from app.domain.consequence.engine import CascadeLimits
from app.domain.policy.model import Policy


class PolicyError(ValueError):
    pass


def parse_policy(raw: Any) -> Policy:
    if not isinstance(raw, dict):
        raise PolicyError("policy must be a mapping")
    try:
        return Policy.model_validate(raw)
    except ValueError as exc:
        raise PolicyError(f"invalid policy: {exc}") from exc


def load_policy(path: Path) -> Policy:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise PolicyError(f"cannot read policy file {path}: {exc}") from exc
    return parse_policy(yaml.safe_load(text))


def cascade_limits(policy: Policy) -> CascadeLimits:
    return CascadeLimits(max_depth=policy.cascade.max_depth, max_nodes=policy.cascade.max_nodes)
