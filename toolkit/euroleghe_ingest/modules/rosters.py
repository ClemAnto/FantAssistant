"""rosters - ALWAYS first. Normalizes the roster lists into players / clubs / rosters.

Source: season Excel/CSV files in data/raw (see DRIVE-MANIFEST). Establishes the registry
with fc_id as primary key and the club x season perimeter. Mantra roles in `roles`
(lowercase, ';'-separated), Classic role in `role_classic`.

Notes from the real data: price is not in the current roster lists -> NULL; nationality is
provided by no source -> NULL; in 2024-25 the club column is empty -> club NULL.
"""

from __future__ import annotations

import sqlite3

from euroleghe_ingest.context import Context
from euroleghe_ingest.sources import iter_records

NAME = "rosters"
DESCRIPTION = "Roster lists -> players, clubs, rosters (fc_id primary key)"
DEPENDS_ON: list[str] = []
RAW_INPUTS: list[str] = [
    "Statistiche_Fantacalcio_EuroLeghe_Stagione_2025_26.xlsx",
    "euroleghe-stats-2024-25.csv",
    "euroleghe-stats-2023-24.csv",
]
NETWORK = False


def _get_or_create_club(conn: sqlite3.Connection, name: str | None, league: str | None) -> int | None:
    if not name:
        return None
    row = conn.execute("SELECT fc_club_id FROM clubs WHERE canonical_name = ?", (name,)).fetchone()
    if row:
        return row[0]
    new_id = conn.execute("SELECT COALESCE(MAX(fc_club_id), 0) + 1 FROM clubs").fetchone()[0]
    conn.execute(
        "INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
        (new_id, name, league),
    )
    return new_id


def run(ctx: Context, **kwargs) -> None:
    conn = ctx.require_conn()
    seasons: set[str] = set()
    for rec in iter_records(ctx.config):
        conn.execute(
            """
            INSERT INTO players(fc_id, canonical_name, birth_year, nationality)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(fc_id) DO UPDATE SET
                canonical_name = excluded.canonical_name,
                nationality = COALESCE(players.nationality, excluded.nationality)
            """,
            (rec.fc_id, rec.name, None, rec.nationality),
        )
        club_id = _get_or_create_club(conn, rec.club, rec.league)
        conn.execute(
            """
            INSERT OR REPLACE INTO rosters(fc_id, season, fc_club_id, roles, role_classic, league, price)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (rec.fc_id, rec.season, club_id, ";".join(rec.roles) or None, rec.role_classic, rec.league, None),
        )
        seasons.add(rec.season)

    n_players = conn.execute("SELECT COUNT(*) FROM players").fetchone()[0]
    n_clubs = conn.execute("SELECT COUNT(*) FROM clubs").fetchone()[0]
    n_rosters = conn.execute("SELECT COUNT(*) FROM rosters").fetchone()[0]
    print(f"[rosters] seasons={sorted(seasons)} · players={n_players} clubs={n_clubs} rosters={n_rosters}")


def backfill_clubs(ctx: Context) -> None:
    """Fill rosters that have no club by learning the player's team from the scraped ratings
    (match_ratings.team, most frequent) + the league already on the roster row. Reuses existing
    clubs by name, so it also fixes seasons whose listone had an empty club column (e.g. 2024-25)."""
    conn = ctx.require_conn()
    missing = conn.execute("SELECT fc_id, season, league FROM rosters WHERE fc_club_id IS NULL").fetchall()
    filled = 0
    for fc_id, season, league in missing:
        row = conn.execute(
            "SELECT team FROM match_ratings WHERE fc_id = ? AND season = ? AND team IS NOT NULL "
            "GROUP BY team ORDER BY COUNT(*) DESC LIMIT 1",
            (fc_id, season),
        ).fetchone()
        if row is None:
            continue
        club_id = _get_or_create_club(conn, row[0], league)
        conn.execute("UPDATE rosters SET fc_club_id = ? WHERE fc_id = ? AND season = ?",
                     (club_id, fc_id, season))
        filled += 1
    print(f"[rosters] backfilled {filled} missing clubs from ratings")


def backfill_serie_a_rosters(ctx: Context) -> None:
    """Create roster entries for FULL Serie A players who exist only in the serie_a ratings scrape
    (not in the EuroLeghe listone), so the Players view can show all 20 Serie A teams, not just the
    EuroLeghe top clubs. Mantra roles stay NULL (ratings only give the Classic role)."""
    conn = ctx.require_conn()
    pairs = conn.execute(
        "SELECT DISTINCT fc_id, season FROM match_ratings mr "
        "WHERE mr.competition = 'serie_a' AND mr.role IN ('P','D','C','A') "
        "AND NOT EXISTS (SELECT 1 FROM rosters r WHERE r.fc_id = mr.fc_id AND r.season = mr.season)"
    ).fetchall()
    created = 0
    for fc_id, season in pairs:
        team = conn.execute(
            "SELECT team FROM match_ratings WHERE fc_id=? AND season=? AND competition='serie_a' "
            "AND team IS NOT NULL GROUP BY team ORDER BY COUNT(*) DESC LIMIT 1", (fc_id, season)).fetchone()
        if team is None:
            continue
        role = conn.execute(
            "SELECT role FROM match_ratings WHERE fc_id=? AND season=? AND competition='serie_a' "
            "AND role IN ('P','D','C','A') GROUP BY role ORDER BY COUNT(*) DESC LIMIT 1", (fc_id, season)).fetchone()
        club_id = _get_or_create_club(conn, team[0], "serie_a")
        conn.execute(
            "INSERT OR IGNORE INTO rosters(fc_id, season, fc_club_id, role_classic, league) "
            "VALUES (?, ?, ?, ?, 'serie_a')",
            (fc_id, season, club_id, role[0] if role else None),
        )
        created += 1
    print(f"[rosters] created {created} full-Serie-A roster entries from ratings")
