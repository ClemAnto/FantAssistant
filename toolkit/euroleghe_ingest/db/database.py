"""Connection and initialization helpers for the SQLite database."""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(db_path: Path) -> sqlite3.Connection:
    """Open a connection (creating the folder if missing) with foreign keys enabled."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")   # wait for a lock instead of failing (GUI may read)
    return conn


# Columns added to schema.sql after a database may already exist. CREATE TABLE IF NOT EXISTS does
# nothing to a table that is already there, so without this an existing DB keeps the old shape and
# every query naming the new column fails with "no such column" - and the only cure would be
# `rebuild`, which drops everything. Additive columns only: anything else needs a real migration.
ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("rosters", "price_initial", "REAL"),
    ("rosters", "fvm", "REAL"),
    ("rosters", "fvm_mantra", "REAL"),
    ("rosters", "price_mantra", "REAL"),
    ("rosters", "price_initial_mantra", "REAL"),
    ("external_match_stats", "shots", "INTEGER"),
    ("external_match_stats", "shots_on_target", "INTEGER"),
    ("external_match_stats", "big_chances_created", "INTEGER"),
    ("external_match_stats", "big_chances_missed", "INTEGER"),
    ("external_match_stats", "key_passes", "INTEGER"),
    ("external_match_stats", "touches", "INTEGER"),
    ("probable_starter", "team", "TEXT"),
    ("probable_starter", "formation", "TEXT"),
    ("probable_starter", "starter", "INTEGER"),
    ("probable_starter", "role", "TEXT"),
    ("probable_starter", "status", "TEXT"),
    # The season the probabili page was about (see schema.sql): a row whose season is unknown cannot be
    # read as today's forecast - «vuoto = ignoto», and here the empty ones are measurably last season's.
    ("probable_starter", "season", "TEXT"),
    # The BODY, from the same provider payload the granular roles come from (one request per club, so
    # they cost nothing extra). Dated like the roles because that is the table they arrive in - though a
    # grown man's height does not move, which is why it may be read for a past season and a role may not.
    ("player_roles", "height", "INTEGER"),
    ("player_roles", "weight", "INTEGER"),
    # The keeper's half of the fantavoto, from a payload we already cache (gate §7-decies).
    ("external_stats", "goals_conceded", "INTEGER"),
    ("external_stats", "saves", "INTEGER"),
    ("injuries", "matches_missed", "INTEGER"),
    ("injuries", "detail", "TEXT"),
    ("injuries", "source", "TEXT"),
)


def migrate(conn: sqlite3.Connection) -> list[str]:
    """Add the columns an older database is missing. Returns what was added, for the log."""
    applied: list[str] = []
    existing = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    for table, column, kind in ADDED_COLUMNS:
        if table not in existing:
            continue                                  # the CREATE will include it
        columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {kind}")
            applied.append(f"{table}.{column}")
    if applied:
        conn.commit()
    return applied


def widen_transfers_pk(conn: sqlite3.Connection) -> bool:
    """Rebuild `transfers_history` with the COUNTERPART in its primary key, if it still has the old one.

    `CREATE TABLE IF NOT EXISTS` cannot change a key and SQLite cannot alter one, so an existing DB needs
    this: create, copy, drop, rename. It is worth the migration because the old key could not represent two
    real events - a loan return and a permanent signing, both dated 1 July, both on the club's own page -
    and silently kept whichever was written last (Hojlund read as LEAVING Napoli for Manchester United in
    the summer Napoli signed him permanently). Idempotent: it looks at the key it finds.
    """
    sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='transfers_history'").fetchone()
    if not sql or "PRIMARY KEY (fc_id, date, from_club, to_club)" in sql[0]:
        return False
    conn.executescript(
        """
        CREATE TABLE transfers_history__new (
            fc_id       INTEGER NOT NULL REFERENCES players(fc_id),
            date        TEXT NOT NULL,
            from_club   TEXT,
            to_club     TEXT,
            from_league TEXT,
            to_league   TEXT,
            fee         REAL,
            PRIMARY KEY (fc_id, date, from_club, to_club)
        );
        INSERT OR REPLACE INTO transfers_history__new
            SELECT fc_id, date, from_club, to_club, from_league, to_league, fee FROM transfers_history;
        DROP TABLE transfers_history;
        ALTER TABLE transfers_history__new RENAME TO transfers_history;
        """
    )
    conn.commit()
    return True


# Every table that points at a club by ID, and the tables that store OUR canonical club NAME. The second
# list is short on purpose: `match_ratings.team`, `external_match_stats.club/opponent`,
# `club_match_lineups.club` and `transfers_history.from_club/to_club` hold what the SOURCE said, and
# rewriting those would be editing the evidence - they are resolved at read time through the alias table,
# which works again as soon as the twin row is gone.
_CLUB_ID_TABLES = ("rosters", "club_xref", "club_elo", "coaches", "penalty_hierarchy")
_CLUB_NAME_COLUMNS = (("squad_snapshot", "club"), ("arrivals", "origin_club"))


def merge_twin_clubs(conn: sqlite3.Connection) -> list[str]:
    """Collapse `clubs` rows that are the same club under two spellings. Returns what was merged.

    `fc_club_id` is a surrogate handed out by `rosters._get_or_create_club`, which used to match on the
    exact string - so one club could become two identities, and every club-level channel split between
    them. Measured on 05/08/2026: `Newcastle` 12 (seasons 24-25, 25-26, the Transfermarkt xref, 46 coach
    spells) against `Newcastle United` 60 (18-19 to 23-24, the SofaScore xref, none); `Eintracht` 22 with
    zero coach spells against `Eintracht Francoforte` 59 with seventy; `Paris Saint Germain` 4 with no
    roster row at all against `Paris Saint-Germain` 37 with 226. Consequences that were already being
    paid: the live squad unjoinable on two clubs (52 rows of the euro sheet), the turnover channel blind
    for today's Eintracht, and `penalty_hierarchy` halved across the twins - the same shape of defect that
    once made a decay of 0.5 look better than 0.75.

    Derived from the data, never from a list of names: rows group by `matching.club_identity`, and the
    SURVIVOR is the one carrying the most recent roster season, because that is the identity the next
    listone will land on. Idempotent - with no twins it does nothing and returns [].

    Where a re-pointed row would collide with one the survivor already has (same date, same valid_from),
    the survivor's row stands and the loser's is dropped: both describe the same club on the same day. The
    tables that can lose a row that way are DERIVED and re-derivable offline (`elo`, `fc_site`), which is
    what the caller is told to do.
    """
    from euroleghe_ingest.matching import club_identity

    groups: dict[tuple[str, str | None], list[tuple[int, str]]] = {}
    for club_id, name, league in conn.execute(
            "SELECT fc_club_id, canonical_name, league FROM clubs WHERE canonical_name IS NOT NULL"):
        groups.setdefault((club_identity(name), league), []).append((club_id, name))
    merged: list[str] = []
    for members in groups.values():
        if len(members) < 2:
            continue
        ranked = sorted(members, key=lambda m: (
            conn.execute("SELECT MAX(season) FROM rosters WHERE fc_club_id = ?", (m[0],)).fetchone()[0]
            or "", m[0]), reverse=True)
        (keep_id, keep_name), losers = ranked[0], ranked[1:]
        for drop_id, drop_name in losers:
            dropped: list[str] = []
            for table in _CLUB_ID_TABLES:
                conn.execute(f"UPDATE OR IGNORE {table} SET fc_club_id = ? WHERE fc_club_id = ?",
                             (keep_id, drop_id))
                # Whatever is LEFT collided with a row the survivor already had. Counted and reported,
                # never silent: a merge that quietly eats history is worse than the split it cures.
                lost = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE fc_club_id = ?",
                                    (drop_id,)).fetchone()[0]
                if lost:
                    dropped.append(f"{lost} {table}")
                conn.execute(f"DELETE FROM {table} WHERE fc_club_id = ?", (drop_id,))
            for table, column in _CLUB_NAME_COLUMNS:
                conn.execute(f"UPDATE OR IGNORE {table} SET {column} = ? WHERE {column} = ?",
                             (keep_name, drop_name))
            conn.execute("DELETE FROM clubs WHERE fc_club_id = ?", (drop_id,))
            note = f" (duplicates dropped: {', '.join(dropped)})" if dropped else ""
            merged.append(f"{drop_name} ({drop_id}) -> {keep_name} ({keep_id}){note}")
    if merged:
        conn.commit()
    return merged


def apply_schema(conn: sqlite3.Connection) -> None:
    """Apply schema.sql (idempotent: CREATE TABLE IF NOT EXISTS) and migrate an older DB."""
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()
    added = migrate(conn)
    if added:
        print(f"[db] migrated: added {', '.join(added)}")
    if widen_transfers_pk(conn):
        print("[db] migrated: transfers_history now keys on the COUNTERPART too - re-run `transfers` "
              "(or its offline reingest) to recover the rows the old key dropped")
    twins = merge_twin_clubs(conn)
    if twins:
        print(f"[db] migrated: {len(twins)} twin club identities merged - the club-level histories they "
              f"had split are now whole. {' · '.join(twins)}")
        # ...and WHAT TO RE-DERIVE, because a migration that says what it changed and not what that
        # invalidates is how a side effect gets found at an auction. `arrivals` is a diff between rosters,
        # so a player who never moved but whose club id did reads as a transfer: the merge of 06/08/2026
        # left 26 phantom arrivals at Newcastle and 28 at Eintracht, and they were in the sheets.
        print("[db] -> RE-DERIVE, in this order: `arrivals` (a roster diff: a changed club id reads as a "
              "transfer), then the snapshot sheets, `estimates` and `export`. See the spec, «Dipendenze e "
              "ri-derivazioni».")


def record_run(conn: sqlite3.Connection, module: str, started_at: str, status: str,
               detail: str | None = None) -> None:
    """One line per module run into `ingest_runs` - the provenance the spec asks for.

    Written by whoever OWNS the invocation (the CLI, the rebuild, the GUI), not by the modules: a
    module that logged its own run would miss the runs that died before reaching the log, which are
    exactly the ones worth knowing about. Never raises: a failed audit line must not fail an ingest.
    """
    try:
        conn.execute(
            "INSERT OR REPLACE INTO ingest_runs(module, started_at, status, detail) "
            "VALUES (?, ?, ?, ?)", (module, started_at, status, detail))
        conn.commit()
    except sqlite3.Error:
        pass


def table_names(conn: sqlite3.Connection) -> list[str]:
    """User table names (excludes SQLite's internal tables)."""
    return [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()]


def init_db(db_path: Path) -> sqlite3.Connection:
    conn = connect(db_path)
    apply_schema(conn)
    return conn
