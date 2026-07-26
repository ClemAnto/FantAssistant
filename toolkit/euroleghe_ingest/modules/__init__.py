"""Module registry and the `rebuild` pipeline order.

`fetch` (network) comes before everything but is not part of the raw-file rebuild.
`rebuild` runs the normalizers in order and closes with `validate`.
"""

from __future__ import annotations

import importlib
from types import ModuleType

# Rebuild execution order (from raw files to the normalized DB).
# `rosters` always first; `validate` closes the chain.
PIPELINE: tuple[str, ...] = (
    "rosters",
    "stats",
    "ratings",
    "matchdays",
    "fc_site",
    "transfers",
    "fbref",
    "positions",
    "synth",
    "arrivals",
    "tournaments",
    "elo",
    "validate",
)

# Modules callable individually from the CLI but outside the rebuild.
STANDALONE: tuple[str, ...] = ("fetch", "rebuild")

ALL_MODULES: tuple[str, ...] = STANDALONE + PIPELINE

# Modules whose run() is fully implemented (the rest are stubs raising NotImplementedError).
# Single source of truth: add a name here when its module becomes real.
IMPLEMENTED: frozenset[str] = frozenset(
    {"rosters", "stats", "ratings", "matchdays", "positions", "synth", "arrivals", "elo", "validate"}
)


def load(name: str) -> ModuleType:
    """Dynamically import a module by name (e.g. 'rosters')."""
    if name not in ALL_MODULES:
        raise KeyError(f"Unknown module: {name!r}. Available: {', '.join(ALL_MODULES)}")
    return importlib.import_module(f"euroleghe_ingest.modules.{name}")
