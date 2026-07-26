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
    "euro-stats-2024-25.csv",
    "euro-stats-2023-24.csv",
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


def backfill_rosters_from_ratings(ctx: Context) -> None:
    """Create roster entries for players present in the ratings but not in a listone, so the Players
    view can show them: the full Serie A teams (the 'default' platform) and older voti-only seasons.
    League = serie_a for the 'default' (classic Serie A) platform; otherwise inferred from the team's clubs entry.
    Mantra roles stay NULL (ratings only give the Classic role)."""
    conn = ctx.require_conn()
    pairs = conn.execute(
        "SELECT DISTINCT fc_id, season FROM match_ratings mr WHERE mr.role IN ('P','D','C','A') "
        "AND NOT EXISTS (SELECT 1 FROM rosters r WHERE r.fc_id = mr.fc_id AND r.season = mr.season)"
    ).fetchall()

    def _mode(fc_id, season, column, where=""):
        row = conn.execute(
            f"SELECT {column} FROM match_ratings WHERE fc_id=? AND season=? {where} "
            f"GROUP BY {column} ORDER BY COUNT(*) DESC LIMIT 1", (fc_id, season)).fetchone()
        return row[0] if row else None

    created = 0
    for fc_id, season in pairs:
        team = _mode(fc_id, season, "team", "AND team IS NOT NULL")
        if not team:
            continue
        role = _mode(fc_id, season, "role", "AND role IN ('P','D','C','A')")
        if _mode(fc_id, season, "platform") == "default":
            league = "serie_a"
        else:
            lk = conn.execute("SELECT league FROM clubs WHERE canonical_name=? AND league IS NOT NULL "
                              "LIMIT 1", (team,)).fetchone()
            league = lk[0] if lk else None
        club_id = _get_or_create_club(conn, team, league)
        conn.execute(
            "INSERT OR IGNORE INTO rosters(fc_id, season, fc_club_id, role_classic, league) "
            "VALUES (?, ?, ?, ?, ?)",
            (fc_id, season, club_id, role, league),
        )
        created += 1
    print(f"[rosters] created {created} roster entries from ratings")


def fix_club_leagues(ctx: Context) -> None:
    """Set each club's league to the most common league among its rosters. This corrects clubs
    mislabeled by a single transferred player whose listone league differed from the club's real
    one (e.g. Genoa/Torino ending up as premier_league/bundesliga)."""
    conn = ctx.require_conn()
    fixed = 0
    for (club_id, current) in conn.execute("SELECT fc_club_id, league FROM clubs").fetchall():
        row = conn.execute(
            "SELECT league FROM rosters WHERE fc_club_id = ? AND league IS NOT NULL "
            "GROUP BY league ORDER BY COUNT(*) DESC LIMIT 1", (club_id,)).fetchone()
        if row and row[0] and row[0] != current:
            conn.execute("UPDATE clubs SET league = ? WHERE fc_club_id = ?", (row[0], club_id))
            fixed += 1
    print(f"[rosters] fixed {fixed} club leagues to the majority roster league")
