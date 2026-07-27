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


def apply_schema(conn: sqlite3.Connection) -> None:
    """Apply schema.sql (idempotent: CREATE TABLE IF NOT EXISTS) and migrate an older DB."""
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()
    added = migrate(conn)
    if added:
        print(f"[db] migrated: added {', '.join(added)}")


def table_names(conn: sqlite3.Connection) -> list[str]:
    """User table names (excludes SQLite's internal tables)."""
    return [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()]


def init_db(db_path: Path) -> sqlite3.Connection:
    conn = connect(db_path)
    apply_schema(conn)
    return conn
