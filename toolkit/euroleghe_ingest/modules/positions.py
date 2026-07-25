"""positions - SofaScore: heatmap -> real role; also covers FRIENDLIES (factor 21).

Derives the effective role from the average position/heatmap over N matches and produces the
off_role_usage flag -> ASYMMETRIC anchor change (already validated: full on demotion /
zero on promotion). Friendly line-ups cover the preseason (hierarchies, starters, penalty
takers, minutes after injury): NEVER performances/goals (noise).
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules.base import not_implemented

NAME = "positions"
DESCRIPTION = "SofaScore heatmap -> real role (positions) + friendly signals"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = True


def run(ctx: Context, **kwargs) -> None:
    raise not_implemented(NAME, "SofaScore heatmap -> derived_role + friendly signals")
