"""The previous season of a man from OUTSIDE the platform's perimeter, from `tm_appearances` (28/09/2026).

Who has no `external_stats` row for last season took the synthetic «never seen» prior (0.28-0.33 of a
season), and at five matchdays of prior that still weighs half in October: summer arrivals who had started
every match read `panchina`. The fallback reads the same quantity from Transfermarkt's per-match rows, first
tiers only, youth football out by median age, and the league's own rounds as the denominator.
"""
import sqlite3

from euroleghe_ingest.modules import snapshot


def _db(rows, births):
    conn = sqlite3.connect(":memory:")
    conn.execute("""CREATE TABLE tm_appearances (fc_id INTEGER, tm_game_id INTEGER, played_on TEXT,
                    season TEXT, competition TEXT, is_national INTEGER, club_id INTEGER, minutes INTEGER,
                    state TEXT, goals INTEGER, assists INTEGER, yellows INTEGER, reds INTEGER,
                    position_id INTEGER)""")
    conn.execute("CREATE TABLE players (fc_id INTEGER PRIMARY KEY, birth_year INTEGER)")
    conn.executemany("INSERT INTO players VALUES (?, ?)", births.items())
    game = 0
    for fc_id, competition, club, minutes, state in rows:
        game += 1
        conn.execute("""INSERT INTO tm_appearances (fc_id, tm_game_id, season, competition, is_national,
                        club_id, minutes, state) VALUES (?, ?, '2025-26', ?, 0, ?, ?, ?)""",
                     (fc_id, game, competition, club, minutes, state))
    return conn


def _season(fc_id, competition, club, played, benched=0, minutes=90):
    return ([(fc_id, competition, club, minutes, "played")] * played
            + [(fc_id, competition, club, None, "in squad")] * benched)


def test_a_first_tier_season_is_read_with_its_own_rounds():
    # 26 matches played and 4 on the bench in a 30-round Belgian season: the denominator is Belgium's
    conn = _db(_season(1, "BE1", 10, 26, benched=4), {1: 1998})
    row = snapshot.prior_from_tm(conn, "2025-26")[1]
    assert row["matches"] == 26 and row["competition"] == "BE1"
    assert row["rounds"] == 30, "the league's own rounds, not the club he plays for now"
    assert row["starts"] == 26, "a 60'+ match stands for a start"


def test_a_lower_tier_or_a_youth_league_is_not_a_prior():
    # the reserve side in a third division (Funk, 34 of 34 in 3. Liga) and the Primavera (`IJ1`, coded
    # like a first tier, recognised by the median age of whoever plays it)
    rows = _season(2, "L3", 20, 34) + [(100 + i, "IJ1", 30, 90, "played") for i in range(25)] \
        + _season(3, "IJ1", 30, 30)
    births = {2: 2003, 3: 2008, **{100 + i: 2008 for i in range(25)}}
    tm = snapshot.prior_from_tm(_db(rows, births), "2025-26")
    assert 2 not in tm, "a third division is not a Bundesliga prior"
    assert 3 not in tm, "youth football is out by median age, never by a hand-written list"


def test_the_fallback_never_overrides_a_measured_row_nor_a_measured_zero():
    tm = {1: {"matches": 26, "starts": 26, "minutes": 2300, "competition": "BE1", "rounds": 30},
          2: {"matches": 30, "starts": 30, "minutes": 2700, "competition": "PO1", "rounds": 34}}
    record = {2: {"starts": 0, "matches": 0, "share": 0.0}}          # measured by external_stats
    rec, prop, rounds = snapshot.with_tm_prior(record, {}, {}, tm)
    assert rec[2]["matches"] == 0, "the first reader keeps its row, a measured zero included"
    assert rec[1]["matches"] == 26 and rec[1]["source"] == "tm_appearances"
    assert prop[1]["minutes"] == 2300 and 2 not in prop
    assert rounds == {1: 30.0}
    assert record == {2: {"starts": 0, "matches": 0, "share": 0.0}}, "the inputs are not mutated"
