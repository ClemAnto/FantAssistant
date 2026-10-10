"""The widget's bridge: our club id -> SofaScore team id, derived from `club_xref` (10/10/2026)."""
import json
import sqlite3

from euroleghe_ingest.modules.export import write_sofascore_clubs


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE club_xref (fc_club_id INTEGER, source TEXT, source_id TEXT, "
                 "valid_from TEXT, valid_to TEXT)")
    conn.executemany("INSERT INTO club_xref VALUES (?, ?, ?, NULL, ?)", [
        (8, "sofascore", "2697", None),         # Inter
        (8, "transfermarkt", "46", None),       # another provider: not this file's business
        (9, "sofascore", "2829", "2025-06-30"),  # a mapping that has ended: not current
        (10, "sofascore", "not-a-number", None),
    ])
    return conn


def test_only_current_numeric_sofascore_ids_travel(tmp_path):
    assert write_sofascore_clubs(_conn(), tmp_path) == "sofascore_clubs.json"
    payload = json.loads((tmp_path / "sofascore_clubs.json").read_text(encoding="utf-8"))
    assert payload["clubs"] == {"8": 2697}


def test_no_ids_means_no_file(tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE club_xref (fc_club_id INTEGER, source TEXT, source_id TEXT, "
                 "valid_from TEXT, valid_to TEXT)")
    assert write_sofascore_clubs(conn, tmp_path) is None
    assert not (tmp_path / "sofascore_clubs.json").exists()
