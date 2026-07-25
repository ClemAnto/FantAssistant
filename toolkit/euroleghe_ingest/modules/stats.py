"""stats - season statistics aggregated into season_stats.

Source: the same roster-list files. Verified FM formula (EuroLeghe scale):
FM = Mv + (3*Gf + Ass - 0.5*Amm - Esp - 2*Au - 3*R-)/Pv. Penalties: pen_scored,
pen_missed (taken-scored in the CSVs, R- in the Excel), pen_saved.
NOTE: own_goals is absent from the CSVs (only in the 25/26 Excel).
"""

from __future__ import annotations

from euroleghe_ingest.context import Context
from euroleghe_ingest.sources import iter_records

NAME = "stats"
DESCRIPTION = "Season statistics -> season_stats"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []  # reuses the roster-list inputs
NETWORK = False


def run(ctx: Context, **kwargs) -> None:
    conn = ctx.require_conn()
    for rec in iter_records(ctx.config):
        # safety when run standalone (without rosters): satisfy the player FK
        conn.execute(
            "INSERT OR IGNORE INTO players(fc_id, canonical_name) VALUES (?, ?)",
            (rec.fc_id, rec.name),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO season_stats(
                fc_id, season, pv, mv, fm, goals, assists, yellows, reds, own_goals,
                pen_scored, pen_missed, goals_conceded, pen_saved)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rec.fc_id, rec.season, rec.pv, rec.mv, rec.fm, rec.goals, rec.assists,
                rec.yellows, rec.reds, rec.own_goals, rec.pen_scored, rec.pen_missed,
                rec.goals_conceded, rec.pen_saved,
            ),
        )

    n = conn.execute("SELECT COUNT(*) FROM season_stats").fetchone()[0]
    print(f"[stats] season_stats={n}")
