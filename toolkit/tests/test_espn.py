"""ESPN as the live-squad and calendar source since SofaScore closed (30/10/2026).

Pinned here, each for its own reason:
  * IDENTITY: a name joins inside a POOL, the birth year is a VETO, the wide pass wants the year to AGREE,
    and two ESPN ids claiming one fc_id leave him with neither - an ambiguous identity is worse than none;
  * the CLUBS: ESPN's spellings our resolver does not place are declared, and an unknown club is reported,
    never forced onto a key;
  * the CALENDAR: ESPN moves the rows SofaScore wrote and never creates one, because it has no round;
  * WHICH provider the absence readers listen to: the freshest one, one at a time - never a union, or a man
    one provider knows would read as «gone» from the other's payload.
"""

from __future__ import annotations

from euroleghe_ingest import matching
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.engine import features
from euroleghe_ingest.modules import espn, snapshot


def _entry(fc_id, name, born):
    return (*matching.build_pool_entry(fc_id, name), born)


def test_a_name_joins_inside_its_club_pool_and_the_birth_year_is_a_veto():
    pool = [_entry(1, "Dimarco", 1997), _entry(2, "Bastoni", 1999)]
    assert espn._claim({"displayName": "Federico Dimarco", "dateOfBirth": "1997-11-10"}, pool,
                       strict=False) == 1
    # the same name with a birth year that DISAGREES is not him
    assert espn._claim({"displayName": "Federico Dimarco", "dateOfBirth": "2004-01-01"}, pool,
                       strict=False) is None
    # unknown year on either side does not veto inside the club's own pool
    assert espn._claim({"displayName": "Alessandro Bastoni"}, pool, strict=False) == 2


def test_the_wide_pass_requires_the_birth_year_to_agree():
    wide = [_entry(5, "Kean", 2000), _entry(6, "Rossi", None)]
    assert espn._claim({"displayName": "Moise Kean", "dateOfBirth": "2000-02-28"}, wide, strict=True) == 5
    assert espn._claim({"displayName": "Moise Kean"}, wide, strict=True) is None
    assert espn._claim({"displayName": "Mario Rossi", "dateOfBirth": "1990-01-01"}, wide, strict=True) is None


def test_two_espn_ids_on_one_man_leave_him_with_neither():
    pool = {"Inter": [_entry(1, "Martinez L.", 1997)]}
    rosters = [("Inter", [{"id": "10", "displayName": "Lautaro Martinez", "dateOfBirth": "1997-08-22"},
                          {"id": "11", "displayName": "Lautaro Martinez", "dateOfBirth": "1997-08-22"}])]
    mapping, dropped = espn.resolve_athletes(rosters, pool, [])
    assert mapping == {} and dropped == 2


def test_one_athlete_read_on_several_days_reaches_one_fc_id():
    pool = {"Inter": [_entry(1, "Thuram", 1997)]}
    athlete = {"id": "7", "displayName": "Marcus Thuram", "dateOfBirth": "1997-08-06"}
    mapping, dropped = espn.resolve_athletes([("Inter", [athlete]), ("Inter", [athlete])], pool, [])
    assert mapping == {"7": 1} and dropped == 0


def _clubs_db(tmp_path):
    conn = init_db(tmp_path / "t.db")
    for fc_club_id, name, league in ((1, "Inter", "serie_a"), (2, "Milan", "serie_a"),
                                    (3, "Bayern Monaco", "bundesliga")):
        conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (?, ?, ?)",
                     (fc_club_id, name, league))
    conn.commit()
    return conn


def test_espn_spellings_reach_our_clubs_and_an_unknown_one_is_reported(tmp_path):
    conn = _clubs_db(tmp_path)
    teams = {"serie_a": [{"id": "110", "displayName": "Internazionale"},
                         {"id": "103", "displayName": "AC Milan"}],
             "bundesliga": [{"id": "132", "displayName": "Bayern Munich"},
                            {"id": "999", "displayName": "SV Elversberg"}]}
    clubs, missing = espn.resolve_clubs(conn, teams)
    assert clubs == {"110": "Inter", "103": "Milan", "132": "Bayern Monaco"}
    assert missing == ["SV Elversberg"]


def test_the_calendar_moves_sofascore_rows_and_never_creates_one(tmp_path):
    conn = init_db(tmp_path / "t.db")
    conn.execute("INSERT INTO fixtures(event_id, season, league, round, date, home_key, away_key, played, "
                 "source, observed_on) VALUES ('s1', '2026-27', 'serie_a', 10, '2026-10-31', 'milan', "
                 "'inter', 0, 'sofascore', '2026-09-24')")
    payload = {"events": [
        {"id": "e1", "date": "2026-11-04T19:45Z", "season": {"year": 2026},
         "competitions": [{"status": {"type": {"completed": False}},
                           "competitors": [{"homeAway": "home", "team": {"id": "103"}},
                                           {"homeAway": "away", "team": {"id": "110"}}]}]},
        {"id": "e2", "date": "2026-11-08T17:00Z", "season": {"year": 2026},
         "competitions": [{"status": {"type": {"completed": False}},
                           "competitors": [{"homeAway": "home", "team": {"id": "777"}},
                                           {"homeAway": "away", "team": {"id": "110"}}]}]}]}
    rows = espn.parse_schedule(payload, "serie_a", {"103": "milan", "110": "inter", "777": "como"})
    counts = espn.update_fixtures(conn, rows, "2026-10-30")
    assert counts == {"updated": 1, "moved": 1, "unmatched": 1}
    assert [tuple(row) for row in conn.execute("SELECT date, observed_on, round FROM fixtures")] == [
        ("2026-11-04", "2026-10-30", 10)]
    assert conn.execute("SELECT COUNT(*) FROM fixtures").fetchone()[0] == 1


def test_the_absence_readers_listen_to_the_freshest_provider_one_at_a_time(tmp_path):
    conn = init_db(tmp_path / "t.db")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'A'), (2, 'B')")
    conn.execute("INSERT INTO squad_snapshot(fc_id, valid_from, club, source) "
                 "VALUES (1, '2026-09-20', 'Inter', 'sofascore')")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (1, 'sofascore', 's1')")
    assert features.live_source(conn, "2026-10-30") == "sofascore"
    conn.execute("INSERT INTO squad_snapshot(fc_id, valid_from, club, source) "
                 "VALUES (2, '2026-10-30', 'Inter', 'espn')")
    conn.execute("INSERT INTO player_xref(fc_id, source, source_id) VALUES (2, 'espn', 'e2')")
    assert features.live_source(conn, "2026-10-30") == "espn"
    # ...but not at a date before ESPN was ever read: a back-dated sheet keeps the provider it had
    assert features.live_source(conn, "2026-09-25") == "sofascore"
    assert snapshot.observed_players(conn, "2026-10-30") == {2}
    assert snapshot.live_club_of(conn, "2026-10-30") == {2: ("Inter", "2026-10-30")}
    # no read at all behaves as before ESPN existed
    assert features.live_source(init_db(tmp_path / "empty.db"), "2026-10-30") == "sofascore"
