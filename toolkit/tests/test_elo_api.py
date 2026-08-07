"""Tests for the ClubElo API layer: the CSV parser, the alias table, and the offline re-ingest.

The alias table is the part worth testing: ClubElo writes 'Bayern', 'Man City', 'Paris SG', and
without the mapping the API silently leaves the strongest clubs of four leagues without an Elo -
which is exactly the population the LEVEL channel exists for, since a man arriving from one of them
is the case R19 prices (this used to say "the goalkeeper model", which reads measured goals conceded
and no Elo at all - see the audited reader list at the top of `elo.py`). A miss here is not a crash,
it is a quietly emptier table, so it gets an assertion.
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


# The mirror republishes ClubElo's own daily CSV with two columns appended, so the fallback has to
# pick a date out of one big file rather than ask for one. Same seven columns in the same order.
_MIRROR = (
    "Rank,Club,Country,Level,Elo,From,To,date,updated_at\n"
    "1,Inter,ITA,1,1900.0,2023-04-01,2023-04-20,2023-04-16,2023-04-16 18:17:58\n"
    "1,Inter,ITA,1,1910.0,2025-12-20,2026-01-20,2026-01-13,2026-01-13 10:20:15\n"
    "2,Bayern,GER,1,1990.0,2025-12-20,2026-01-20,2026-01-13,2026-01-13 10:20:15\n"
    "1,Inter,ITA,1,1925.0,2026-01-01,2026-02-08,2026-01-14,2026-01-14 10:20:15\n"
    "2,Bayern,GER,1,1996.3,2026-01-01,2026-02-08,2026-01-14,2026-01-14 10:20:15\n"
)


def test_the_mirror_serves_the_latest_reading_that_is_not_after_the_date_asked_for():
    """The fallback's whole risk is filing a reading under a date it does not belong to.

    A request for today is answered with the most recent snapshot the mirror HAS, returned together
    with the day it was observed so the caller stores that and not the request - and never with a
    later one, since a snapshot taken after an auction knows things the auction did not.
    """
    picked = elo.pick_from_mirror(_MIRROR.splitlines(), ["2026-08-07", "2026-01-13"])

    observed, payload = picked["2026-08-07"]
    assert observed == "2026-01-14", "the freshest reading at or before the request"
    # ...and what comes out is exactly what the API would have returned, parser untouched
    assert payload.splitlines()[0] == "Rank,Club,Country,Level,Elo,From,To"
    assert {rec["club"]: rec["elo"] for rec in elo.parse_snapshot(payload)} == {
        "Inter": 1925.0, "Bayern": 1996.3}

    assert picked["2026-01-13"][0] == "2026-01-13", "an earlier request is not served the newer day"
    assert elo.parse_snapshot(picked["2026-01-13"][1])[0]["elo"] == 1910.0


def test_a_date_the_mirror_cannot_reach_is_absent_and_not_approximated():
    """The mirror starts in 2023 and the ten gate windows are cached in full, so the honest answer
    for an older date is nothing at all - «vuoto = ignoto» applied to a date. Filling it with the
    closest thing available would put a 2023 reading inside a 2016 window."""
    assert elo.pick_from_mirror(_MIRROR.splitlines(), ["2016-08-15"]) == {}


def test_the_mirror_changing_shape_is_an_error_and_not_a_silent_empty():
    """If the columns move, every date would come back empty and `club_elo` would just stay as it
    was - a fallback that fails looking like a fallback that had nothing to add."""
    import pytest

    with pytest.raises(ValueError, match="columns"):
        elo.pick_from_mirror(["Team,Rating,day\n", "Inter,1900,2026-01-14\n"], ["2026-08-07"])
