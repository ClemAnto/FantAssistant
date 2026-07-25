"""Test the arrivals roster-diff classification."""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import arrivals


def test_arrivals_classification(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    conn = init_db(cfg.db_path)
    conn.executemany("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
                     [(1, "Inter", "serie_a"), (2, "Milan", "serie_a"), (3, "Bayern", "bundesliga")])
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(1, "P1"), (2, "P2"), (3, "P3")])
    conn.executemany("INSERT INTO rosters(fc_id, season, fc_club_id, league) VALUES (?, ?, ?, ?)", [
        (1, "2023-24", 1, "serie_a"),      # P1 at Inter
        (2, "2023-24", 3, "bundesliga"),   # P2 at Bayern
        (1, "2024-25", 2, "serie_a"),      # P1 -> Milan (same league)
        (2, "2024-25", 1, "serie_a"),      # P2 -> Inter (league change)
        (3, "2024-25", 1, "serie_a"),      # P3 new to the perimeter
    ])
    conn.commit()

    arrivals.run(Context(config=cfg, conn=conn))
    got = {fc_id: (typ, origin) for fc_id, typ, origin in conn.execute(
        "SELECT fc_id, type, origin_club FROM arrivals WHERE season = '2024-25'")}
    assert got[1] == ("transfer_intra_league", "Inter")
    assert got[2] == ("transfer_cross_league", "Bayern")
    assert got[3] == ("new", None)
    # a player who stayed put produces no arrival row
    assert 1 not in {r[0] for r in conn.execute("SELECT fc_id FROM arrivals WHERE season='2023-24'")}
