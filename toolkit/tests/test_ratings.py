"""Tests for the ratings module: Excel parsing, fantavoto, upsert, and the consistency check."""

from __future__ import annotations

import io

from openpyxl import Workbook

from euroleghe_ingest.config import Config
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import ratings
from euroleghe_ingest.modules.validate import check_ratings_consistency

HEADER = ["Cod.", "Ruolo", "Squadra", "Nome", "Voto", "Gf", "Gs", "Rp", "Rs", "Rf", "Au", "Amm", "Esp", "Ass"]
ROWS = [
    ["Voti EuroLeghe 5a giornata", None, None, None, None, None, None, None, None, None, None, None, None, None],
    ["disclaimer", None, None, None, None, None, None, None, None, None, None, None, None, None],
    ["Bayern", None, None, None, None, None, None, None, None, None, None, None, None, None],
    HEADER,
    [100, "P", "Bayern", "Neuer", 6, 0, 1, 0, 0, 0, 0, 0, 0, 0],            # GK conceded 1 -> fanta 5.0
    [200, "A", "Bayern", "Kane", 7, 2, 0, 0, 1, 0, 0, 1, 0, 1],             # 2 goals, pen, yellow, assist
    [300, "ALL", "Bayern", "Kompany", 6.5, 0, 0, 0, 0, 0, 0, 0, 0, 0],      # coach
    [400, "C", "Bayern", "Benched", None, 0, 0, 0, 0, 0, 0, 0, 0, 0],       # no vote
]


def _xlsx_bytes(rows):
    wb = Workbook()
    ws = wb.active
    ws.title = "Statistico"
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _scoring():
    return Config().load_scoring()


def test_parse_workbook():
    recs = ratings.parse_workbook(_xlsx_bytes(ROWS), "2023-24", 5)
    assert len(recs) == 4
    by_id = {r["fc_id"]: r for r in recs}
    assert by_id[300]["role"] == "ALL"                      # coach kept
    kane = by_id[200]
    assert kane["team"] == "Bayern"
    assert kane["canon"]["goals"] == 2 and kane["canon"]["assists"] == 1
    assert kane["canon"]["pen_scored"] == 1 and kane["canon"]["yellows"] == 1
    assert set(kane["raw"]) == {"Voto", "Gf", "Gs", "Rp", "Rs", "Rf", "Au", "Amm", "Esp", "Ass"}
    assert by_id[400]["canon"]["mv"] is None                # no vote


def test_parse_empty_sheet_stops():
    # Beyond the season the endpoint returns disclaimer+header but no player rows -> no records.
    empty = ROWS[:4]  # the three text rows + header, no players
    assert ratings.parse_workbook(_xlsx_bytes(empty), "2023-24", 39) == []


def test_compute_fantavoto():
    recs = {r["fc_id"]: r for r in ratings.parse_workbook(_xlsx_bytes(ROWS), "2023-24", 5)}
    s = _scoring()
    assert ratings.compute_fantavoto(recs[100]["canon"], s) == 5.0          # 6 - 1 conceded
    assert ratings.compute_fantavoto(recs[200]["canon"], s) == 16.5         # 7 +6 +1 +3 -0.5
    assert ratings.compute_fantavoto(recs[400]["canon"], s) is None         # no vote


def test_upsert(tmp_path):
    conn = init_db(tmp_path / "euroleghe.db")
    recs = ratings.parse_workbook(_xlsx_bytes(ROWS), "2023-24", 5)
    n = ratings.upsert_records(conn, recs, _scoring())
    assert n == 4
    assert conn.execute("SELECT COUNT(*) FROM match_ratings").fetchone()[0] == 4
    # raw bonuses: 4 players x 10 columns
    assert conn.execute("SELECT COUNT(*) FROM match_rating_bonuses").fetchone()[0] == 40
    status = dict(conn.execute("SELECT fc_id, status FROM match_ratings").fetchall())
    assert status[100] == "played" and status[400] == "no_vote"
    assert conn.execute("SELECT role FROM match_ratings WHERE fc_id=300").fetchone()[0] == "ALL"


def test_reingest_from_cache(tmp_path):
    from euroleghe_ingest.config import Config
    from euroleghe_ingest.context import Context

    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    cfg.cache_dir.mkdir(parents=True)
    (cfg.cache_dir / "ratings_euroleghe_2023-24_md5.xlsx").write_bytes(_xlsx_bytes(ROWS))
    ctx = Context(config=cfg, conn=init_db(cfg.db_path))
    ratings.reingest_from_cache(ctx)
    assert ctx.conn.execute("SELECT COUNT(*) FROM match_ratings").fetchone()[0] == 4
    # season + matchday recovered from the file name
    row = ctx.conn.execute("SELECT DISTINCT season, matchday FROM match_ratings").fetchone()
    assert tuple(row) == ("2023-24", 5)


def test_backfill_clubs_from_ratings(tmp_path):
    from euroleghe_ingest.config import Config
    from euroleghe_ingest.context import Context
    from euroleghe_ingest.modules import rosters

    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'X')")
    conn.execute("INSERT INTO rosters(fc_id, season, league) VALUES (1, '2024-25', 'serie_a')")  # no club
    conn.executemany(
        "INSERT INTO match_ratings(fc_id, season, matchday, team, mv) VALUES (?, ?, ?, ?, ?)",
        [(1, "2024-25", 1, "Inter", 6.0), (1, "2024-25", 2, "Inter", 6.5)],
    )
    conn.commit()
    rosters.backfill_clubs(Context(config=cfg, conn=conn))
    row = conn.execute(
        "SELECT c.canonical_name, c.league FROM rosters r JOIN clubs c ON c.fc_club_id = r.fc_club_id "
        "WHERE r.fc_id = 1"
    ).fetchone()
    assert tuple(row) == ("Inter", "serie_a")


def test_backfill_serie_a_rosters(tmp_path):
    from euroleghe_ingest.config import Config
    from euroleghe_ingest.context import Context
    from euroleghe_ingest.modules import rosters

    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    conn = init_db(cfg.db_path)
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (7, 'SerieAonly')")
    conn.executemany(
        "INSERT INTO match_ratings(fc_id, season, matchday, role, team, competition, mv) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(7, "2023-24", 1, "C", "Cagliari", "serie_a", 6.0),
         (7, "2023-24", 2, "C", "Cagliari", "serie_a", 6.5)],
    )
    conn.commit()
    rosters.backfill_serie_a_rosters(Context(config=cfg, conn=conn))
    row = conn.execute(
        "SELECT c.canonical_name, r.role_classic, r.league FROM rosters r "
        "JOIN clubs c ON c.fc_club_id = r.fc_club_id WHERE r.fc_id = 7 AND r.season = '2023-24'"
    ).fetchone()
    assert tuple(row) == ("Cagliari", "C", "serie_a")


def test_ratings_consistency_check(tmp_path):
    conn = init_db(tmp_path / "euroleghe.db")
    for fc_id in (100, 200):
        conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)", (fc_id, f"P{fc_id}"))
    # season aggregates
    conn.execute("INSERT INTO season_stats(fc_id, season, pv, mv, fm) VALUES (100,'2023-24',2,6.0,5.0)")
    conn.execute("INSERT INTO season_stats(fc_id, season, pv, mv, fm) VALUES (200,'2023-24',1,7.0,7.0)")
    # fc 100: two matchdays that average to Mv=6, FM=5 -> consistent
    conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, mv, fantavoto) VALUES (100,'2023-24',1,6.0,5.0)")
    conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, mv, fantavoto) VALUES (100,'2023-24',2,6.0,5.0)")
    # fc 200: one matchday with Mv=8 but season says 7 -> Mv mismatch (hard)
    conn.execute("INSERT INTO match_ratings(fc_id, season, matchday, mv, fantavoto) VALUES (200,'2023-24',1,8.0,8.0)")
    conn.commit()

    problems = check_ratings_consistency(conn)
    assert any("fc_id=200" in p for p in problems)
    assert not any("fc_id=100" in p for p in problems)
