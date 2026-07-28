"""backtest - run the out-of-sample GATE on the current model and on the candidate rules.

Thin CLI adapter: the model and the harness live in `euroleghe_ingest.engine` (which the TypeScript
engine will be ported from). Listed under STANDALONE rather than in PIPELINE because it produces no
ingest table - it is READ-ONLY on the DB and writes only a report under data/reports/.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.engine import evaluate

NAME = "backtest"
DESCRIPTION = "Out-of-sample gate: predict each season from the previous one and score the result"
DEPENDS_ON: list[str] = ["rosters", "stats", "ratings", "arrivals"]
RAW_INPUTS: list[str] = []
NETWORK = False


def run(ctx: Context, **kwargs) -> None:
    if kwargs.pop("pairs", False):
        from euroleghe_ingest.engine import diagnostics
        diagnostics.run(ctx, **kwargs)
        return
    evaluate.run(ctx, **kwargs)
