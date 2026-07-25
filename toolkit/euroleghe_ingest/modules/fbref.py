"""fbref - foreign performance, career penalties, set pieces (removes survivorship bias).

Complete data source across the 5 leagues (never top-N tables). Provides: xG/xA, minutes,
CAREER penalty conversion (for conv_shrunk, k~10, league_mean~0.78), free-kick shots/goals
and pass types for the set-piece EV, revealed penalty hierarchy (event detail).
Candidate: the soccerdata library.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules.base import not_implemented

NAME = "fbref"
DESCRIPTION = "FBref -> foreign performance, career penalties, set pieces, xG/xA, minutes"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = True


def run(ctx: Context, **kwargs) -> None:
    raise not_implemented(NAME, "FBref ingestion (foreign performance, career penalties, set pieces)")
