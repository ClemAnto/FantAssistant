"""arrivals - who is new in the perimeter each season, by diffing the roster lists (offline).

For each season vs the previous one:
  * `new`                    - fc_id not in the perimeter last season (no prior FM) -> arrival anchor case.
  * `transfer_cross_league`  - was in the perimeter, changed club AND league (e.g. De Bruyne).
  * `transfer_intra_league`  - was in the perimeter, changed club within the same league.
Players staying at the same club are not arrivals. Tier (T1/T2/T3) and foreign_fm_equiv are left
for later (they need fbref/transfers); this fills the detection + origin, the core of the flag layer.
"""

from __future__ import annotations

from euroleghe_ingest.context import Context

NAME = "arrivals"
DESCRIPTION = "Roster diff -> arrivals (new to perimeter / transfers)"
DEPENDS_ON: list[str] = ["rosters"]
RAW_INPUTS: list[str] = []
NETWORK = False


def _season_map(conn, season: str) -> dict[int, tuple]:
    rows = conn.execute(
        "SELECT r.fc_id, c.canonical_name, r.league "
        "FROM rosters r LEFT JOIN clubs c ON c.fc_club_id = r.fc_club_id WHERE r.season = ?",
        (season,),
    ).fetchall()
    return {fc_id: (club, league) for fc_id, club, league in rows}


def _classify(prev: tuple, cur: tuple) -> tuple[str, str | None, str | None] | None:
    """Return (type, origin_club, origin_league) or None if it's not an arrival."""
    pclub, pleague = prev
    club, league = cur
    if pclub is not None and pclub == club:
        return None   # same club, stayed
    if pclub is None or club is None:
        # club unknown on one side -> fall back to league only
        if pleague and league and pleague != league:
            return ("transfer_cross_league", pclub, pleague)
        return None
    kind = "transfer_cross_league" if pleague != league else "transfer_intra_league"
    return (kind, pclub, pleague)


def run(ctx: Context, **kwargs) -> None:
    conn = ctx.require_conn()
    seasons = [r[0] for r in conn.execute("SELECT DISTINCT season FROM rosters ORDER BY season")]
    conn.execute("DELETE FROM arrivals")   # idempotent rebuild

    n = 0
    prev_map: dict[int, tuple] | None = None
    for season in seasons:
        cur_map = _season_map(conn, season)
        if prev_map is not None:
            for fc_id, cur in cur_map.items():
                if fc_id not in prev_map:
                    kind, origin_club, origin_league = "new", None, None
                else:
                    classified = _classify(prev_map[fc_id], cur)
                    if classified is None:
                        continue
                    kind, origin_club, origin_league = classified
                conn.execute(
                    "INSERT OR REPLACE INTO arrivals(fc_id, season, type, origin_club, origin_league) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (fc_id, season, kind, origin_club, origin_league),
                )
                n += 1
        prev_map = cur_map

    print(f"[arrivals] {n} arrivals/transfers across {len(seasons)} seasons")
