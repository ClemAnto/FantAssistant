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
    # THE PROVIDER'S TEAM ID per (player, season, competition). The payload has carried it since the
    # first run (`sofascore_stats_*.json` -> `team.id`) and the parser dropped it, exactly as it dropped
    # `goalsConceded` until gate §7-decies. Without it a club can only be joined by the STRING a source
    # uses to name it, which is the join this project forbids - and the one that priced Gonçalo Ramos's
    # PSG seasons at Paris FC. Backfilled offline from the same cache, zero requests.
    ("external_stats", "club_id", "TEXT"),
    # OUR id on a level row, where the club is one of ours. `club_levels` is keyed on a canonical KEY,
    # which a reader has to compute - and `engine/features.py` may not import `matching`, because that is
    # a level up. With the id the gate can join it to `clubs` in SQL and take a level for a club of ours
    # that `club_elo` happens not to carry on that date.
    ("club_levels", "fc_club_id", "INTEGER"),
    # ...and WHICH COUNTRY the club plays in, which is the only thing that can tell the Austrian
    # Bundesliga from the German one: the provider gives both the slug `bundesliga`, so 36 recent-form
    # rows of Red Bull Salzburg and Austria Klagenfurt were filed as top-5 football and took a synthetic
    # vote calibrated on Germany. ClubElo's CSV has carried the column since the first run.
    ("club_levels", "country", "TEXT"),
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
    # The transfer row's OBSERVATION day (see schema.sql): Transfermarkt's own date is the contract
    # start, so every summer deal reads 1 July and freshness lived nowhere.
    ("transfers_history", "first_seen", "TEXT"),
    # WHO established an identity, and therefore who may retract it (see schema.sql). Three modules
    # write here on three different kinds of evidence and one of them deletes.
    ("player_xref", "resolved_by", "TEXT"),
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
            if (table, column) == ("player_xref", "resolved_by"):
                # An identity already on file was established by SOME module and we cannot say which,
                # so it is marked as what it is. It matters because `positions` retracts what it owns:
                # left NULL these would read as its own and be dropped on the next authoritative run.
                conn.execute("UPDATE player_xref SET resolved_by = 'unknown' "
                             "WHERE resolved_by IS NULL")
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
            first_seen  TEXT,
            PRIMARY KEY (fc_id, date, from_club, to_club)
        );
        INSERT OR REPLACE INTO transfers_history__new
            SELECT fc_id, date, from_club, to_club, from_league, to_league, fee, first_seen
            FROM transfers_history;
        DROP TABLE transfers_history;
        ALTER TABLE transfers_history__new RENAME TO transfers_history;
        """
    )
    conn.commit()
    return True


# Every table that points at a club by ID, and the tables that store OUR canonical club NAME. The second
# list is short on purpose: `match_ratings.team`, `external_match_stats.club/opponent` and
# `club_match_lineups.club` hold what the SOURCE said, and rewriting those would be editing the
# evidence - they are resolved at read time through the alias table, which works again as soon as the
# twin row is gone. (`transfers_history.from_club/to_club` canonicalize PERIMETER clubs at write time
# since 08/08/2026 - the same deal is on both clubs' pages under two spellings and the PK holds the
# strings - and the whole table re-derives from the cache, so a merge here would rewrite nothing.)
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


def widen_quotation_pks(conn: sqlite3.Connection) -> list[str]:
    """Put `platform` in the key of `fvm_history` and `arrivals`, if it is not there yet.

    The quotation is a fact about a PLATFORM (see `listone_quotes` in schema.sql) and both of these were
    keyed as if it were not: `fvm_history` mixed the two listoni's fantavalori day by day, and `arrivals`
    held ONE tier, i.e. one percentile inside whichever listone had been read last. `CREATE TABLE IF NOT
    EXISTS` cannot change a key, so: create, copy, drop, rename - idempotent, it looks at the key it finds.

    The two are copied differently ON PURPOSE. A fantavalore reading really happened, so it is KEPT and
    marked `unknown`: attributing it now would be inventing provenance, and «vuoto = ignoto». An arrival
    tier is DERIVED and cheap to redo, so the rows are dropped rather than duplicated into a platform they
    were never computed for - and the caller is told to re-derive.
    """
    done: list[str] = []
    fvm = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='fvm_history'").fetchone()
    if fvm and "observed_on, platform" not in fvm[0]:
        conn.executescript(
            """
            CREATE TABLE fvm_history__new (
                fc_id       INTEGER NOT NULL REFERENCES players(fc_id),
                season      TEXT NOT NULL,
                observed_on TEXT NOT NULL,
                platform    TEXT NOT NULL DEFAULT 'unknown',
                fvm         REAL,
                fvm_mantra  REAL,
                PRIMARY KEY (fc_id, season, observed_on, platform)
            );
            INSERT OR REPLACE INTO fvm_history__new(fc_id, season, observed_on, platform, fvm, fvm_mantra)
                SELECT fc_id, season, observed_on, 'unknown', fvm, fvm_mantra FROM fvm_history;
            DROP TABLE fvm_history;
            ALTER TABLE fvm_history__new RENAME TO fvm_history;
            """
        )
        kept = conn.execute("SELECT COUNT(*) FROM fvm_history").fetchone()[0]
        done.append(f"fvm_history keys on the platform too ({kept} earlier readings kept as 'unknown': "
                    f"which listone wrote them cannot be recovered)")
    arrivals = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='arrivals'").fetchone()
    if arrivals and "season, platform" not in arrivals[0]:
        dropped = conn.execute("SELECT COUNT(*) FROM arrivals").fetchone()[0]
        conn.executescript(
            """
            DROP TABLE arrivals;
            CREATE TABLE arrivals (
                fc_id           INTEGER NOT NULL REFERENCES players(fc_id),
                season          TEXT NOT NULL,
                platform        TEXT NOT NULL DEFAULT 'default',
                type            TEXT,
                tier            TEXT,
                origin_club     TEXT,
                origin_league   TEXT,
                foreign_fm_equiv REAL,
                PRIMARY KEY (fc_id, season, platform)
            );
            """
        )
        done.append(f"arrivals keys on the platform too - {dropped} rows dropped because their tier was "
                    f"a percentile inside an unknown listone")
    if done:
        conn.commit()
    return done


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
    quotations = widen_quotation_pks(conn)
    for change in quotations:
        print(f"[db] migrated: {change}")
    if quotations:
        print("[db] -> RE-DERIVE, in this order: `ratings --quotes-from-cache` (fills `listone_quotes` "
              "per platform from the cached listoni, offline), then `arrivals`, then the snapshot sheets "
              "and `export`. See the spec, «Dipendenze e ri-derivazioni».")
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
