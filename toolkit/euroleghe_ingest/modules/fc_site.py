"""fc_site - fantacalcio.it editorial lists: penalty takers, probable starters, unavailable.

Start-of-season prior + in-season editorial confirmation. Populates (dated, valid_from):
penalty_hierarchy (source=fc_site), probable_starter, availability. Revealed evidence from
the ratings always dominates the declared lists.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules.base import not_implemented

NAME = "fc_site"
DESCRIPTION = "Penalty takers/probable starters/unavailable -> penalty_hierarchy, probable_starter, availability"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = True


def run(ctx: Context, **kwargs) -> None:
    raise not_implemented(NAME, "parse penalty-taker/probable/unavailable lists (dated)")
