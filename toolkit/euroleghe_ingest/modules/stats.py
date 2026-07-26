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


def derive_from_ratings(ctx: Context) -> None:
    """Compute season_stats (Pv, Mv, FM, and the bonus sums) from the per-matchday match_ratings,
    for any (player, season) NOT already covered by the listone. This gives seasons that have no
    listone (older voti-only seasons) their aggregates, and fills players missing from the listone.
    The listone-backed seasons are left untouched (authoritative). No Mantra roles / prices here."""
    conn = ctx.require_conn()
    # EuroLeghe and Serie A have different calendars -> aggregate PER platform (never mix), then
    # keep one row per (player, season): prefer EuroLeghe (the model's perspective), else Serie A.
    rows = conn.execute(
        """
        SELECT mr.fc_id, mr.season, mr.platform,
               COUNT(mr.mv), AVG(mr.mv), AVG(mr.fantavoto),
               SUM(mr.goals), SUM(mr.assists), SUM(mr.yellows), SUM(mr.reds), SUM(mr.own_goals),
               SUM(mr.pen_scored), SUM(mr.pen_missed), SUM(mr.goals_conceded), SUM(mr.pen_saved)
        FROM match_ratings mr
        WHERE mr.role IN ('P','D','C','A')
          AND NOT EXISTS (SELECT 1 FROM season_stats s WHERE s.fc_id = mr.fc_id AND s.season = mr.season)
        GROUP BY mr.fc_id, mr.season, mr.platform
        """
    ).fetchall()

    chosen: dict[tuple, tuple] = {}
    for row in rows:
        key = (row[0], row[1])
        if key not in chosen or row[2] == "euro":
            chosen[key] = row

    def r2(v):
        return round(v, 2) if v is not None else None

    for row in chosen.values():
        fc_id, season, _comp, pv, mv, fm, g, a, y, red, og, ps, pm, gc, psv = row
        conn.execute(
            """
            INSERT OR REPLACE INTO season_stats(
                fc_id, season, pv, mv, fm, goals, assists, yellows, reds, own_goals,
                pen_scored, pen_missed, goals_conceded, pen_saved)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (fc_id, season, pv, r2(mv), r2(fm), g, a, y, red, og, ps, pm, gc, psv),
        )
    seasons = {key[1] for key in chosen}
    print(f"[stats] derived {len(chosen)} season_stats rows from ratings for {sorted(seasons)}")
