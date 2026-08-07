"""Tests for the ClubElo API layer: the CSV parser, the alias table, and the offline re-ingest.

The alias table is the part worth testing: ClubElo writes 'Bayern', 'Man City', 'Paris SG', and
without the mapping the API silently leaves the strongest clubs of four leagues without an Elo -
which is exactly the population the goalkeeper model is about. A miss here is not a crash, it is a
quietly emptier table, so it gets an assertion.
"""

from __future__ import annotations

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import elo

_SNAPSHOT = (
    "Rank,Club,Country,Level,Elo,From,To\n"
    "1,Liverpool,ENG,1,1993.43103027,2025-05-29,2025-08-15\n"
    "7,Inter,ITA,1,1933.51513672,2025-06-01,2025-08-21\n"
    "3,Paris SG,FRA,1,1970.07531738,2025-08-13,2025-08-17\n"
    "9,Bayern,GER,1,1920.5,2025-06-01,2025-08-21\n"
    "99,Nowhere United,ITA,1,1200.0,2025-06-01,2025-08-21\n"
    "100,Broken,ITA,1,,2025-06-01,2025-08-21\n"
)


def _ctx(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euro.db")
    cfg.cache_dir.mkdir(parents=True)
    return Context(config=cfg, conn=init_db(cfg.db_path))


def test_parse_snapshot_skips_rows_without_an_elo():
    records = elo.parse_snapshot(_SNAPSHOT)
    assert [rec["club"] for rec in records] == ["Liverpool", "Inter", "Paris SG", "Bayern",
                                                "Nowhere United"]
    assert records[0]["elo"] == 1993.43103027


def test_store_snapshot_resolves_the_short_names(tmp_path):
    ctx = _ctx(tmp_path)
    conn = ctx.conn
    for club_id, name, league in ((1, "Inter", "serie_a"), (2, "Paris Saint-Germain", "ligue_1"),
                                  (3, "Bayern Monaco", "bundesliga")):
        conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
                     (club_id, name, league))
    conn.commit()
    stored, unresolved = elo.store_snapshot(conn, "2025-08-15", elo.parse_snapshot(_SNAPSHOT))
    assert stored == 3, "PSG and Bayern must resolve through ELO_ALIASES, not by luck"
    assert "Nowhere United" in unresolved and "Liverpool" in unresolved
    rows = dict(conn.execute("SELECT fc_club_id, elo FROM club_elo WHERE date = '2025-08-15'"))
    assert rows == {1: 1933.51513672, 2: 1970.07531738, 3: 1920.5}


def test_reingest_from_cache_is_offline_and_idempotent(tmp_path):
    ctx = _ctx(tmp_path)
    ctx.conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) "
                     "VALUES (1, 'Inter', 'serie_a')")
    ctx.conn.commit()
    for date in ("2024-08-15", "2025-08-15"):
        (ctx.config.cache_dir / f"clubelo_{date}.csv").write_text(_SNAPSHOT, encoding="utf-8")
    for _ in range(2):
        elo.reingest_from_cache(ctx)
        assert ctx.conn.execute("SELECT COUNT(*) FROM club_elo").fetchone()[0] == 2


def test_auction_dates_come_from_the_engine_windows(tmp_path):
    from euroleghe_ingest.engine.features import WINDOWS

    ctx = _ctx(tmp_path)
    ctx.conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'X')")
    ctx.conn.execute("INSERT INTO rosters(fc_id, season) VALUES (1, '2025-26')")
    ctx.conn.commit()
    dates = elo.auction_dates(ctx.conn, today="2026-09-01")
    assert {window.auction_date for window in WINDOWS.values()} <= set(dates)
    assert "2020-09-15" in dates, "the COVID auction date is a special case, not a computed 08-15"
    assert "2025-08-15" in dates, "the newest season's own auction date, once it has happened"


def test_the_newest_snapshot_is_dated_when_it_was_taken_and_never_in_the_future(tmp_path):
    """A sheet built during the preseason has TODAY as its auction date, and the readers take
    `MAX(date) <= auction_date` - so with only the conventional 15 August on the list, the whole
    2026-27 window read the 2025-08-15 snapshot: a club's strength a season and a transfer window
    ago, which is what `desc_level_elo` (R19) and the club card are built on. Today's date goes in
    instead, because filing a reading taken today under a day that has not happened is the one thing
    a dated fact must never do."""
    ctx = _ctx(tmp_path)
    ctx.conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'X')")
    ctx.conn.execute("INSERT INTO rosters(fc_id, season) VALUES (1, '2026-27')")
    ctx.conn.commit()

    early = elo.auction_dates(ctx.conn, today="2026-08-07")
    assert "2026-08-07" in early and "2026-08-15" not in early
    # ...and on the day itself the pre-registered date is the one taken, joining the series
    assert "2026-08-15" in elo.auction_dates(ctx.conn, today="2026-08-20")
