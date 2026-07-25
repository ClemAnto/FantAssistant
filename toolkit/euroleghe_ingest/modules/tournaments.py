"""tournaments - international tournament squads (Wikidata) -> tournaments_squads.

Feeds the post_tournament flag and the mid-season tournaments (Africa/Asia Cup): a penalty
on the EXPECTED APPEARANCES of the target year + FM normalization of the input year (low
appearances due to a tournament are not unreliability). First multi-league case: Asia Cup January 2027.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules.base import not_implemented

NAME = "tournaments"
DESCRIPTION = "Wikidata -> tournaments_squads (post_tournament, mid-season cups)"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = True


def run(ctx: Context, **kwargs) -> None:
    raise not_implemented(NAME, "Wikidata tournament-squad query -> tournaments_squads")
