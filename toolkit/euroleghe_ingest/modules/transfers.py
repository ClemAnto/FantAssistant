"""transfers - Transfermarkt: transfers, coaches, injuries.

Populates transfers_history, coaches, injuries and the derived flags: exit_risk (contract
expiry + rumors + value drop), new_coach (coach history vs auction date), injury_history
(days out). Basis for the club indices rischio_panchina / attivita_mercato.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.modules.base import not_implemented

NAME = "transfers"
DESCRIPTION = "Transfermarkt -> transfers_history, coaches, injuries, exit_risk"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = True


def run(ctx: Context, **kwargs) -> None:
    raise not_implemented(NAME, "Transfermarkt scraping: transfers/coaches/injuries")
