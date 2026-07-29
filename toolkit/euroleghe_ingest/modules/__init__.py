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
    "injuries",
    "fbref",
    "positions",
    "recent_form",
    "synth",
    "arrivals",
    "tournaments",
    "elo",
    "validate",
)

# Modules callable individually from the CLI but outside the rebuild.
# `backtest`, `sweep` and `export` are read-only (two score the model, the third writes the app's bundle);
# none produces an ingest table, hence none is in PIPELINE. `sweep` is the gate's other half: `backtest`
# judges candidate RULES, `sweep` judges the provisional CONSTANTS (gate-motore-v1.md 7-bis).
STANDALONE: tuple[str, ...] = ("fetch", "rebuild", "bootstrap", "backtest", "sweep", "export",
                              "snapshot")

ALL_MODULES: tuple[str, ...] = STANDALONE + PIPELINE

# Modules whose run() is fully implemented (the rest are stubs raising NotImplementedError).
# Single source of truth: add a name here when its module becomes real.
IMPLEMENTED: frozenset[str] = frozenset(
    {"rosters", "stats", "ratings", "matchdays", "fc_site", "transfers", "injuries", "positions",
     "recent_form", "synth", "tournaments", "arrivals",
     "elo",
     "validate"}
)


def load(name: str) -> ModuleType:
    """Dynamically import a module by name (e.g. 'rosters')."""
    if name not in ALL_MODULES:
        raise KeyError(f"Unknown module: {name!r}. Available: {', '.join(ALL_MODULES)}")
    return importlib.import_module(f"euroleghe_ingest.modules.{name}")
