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
    pool = [_entry(1, "Martinez L.", 1997)]
    items = [(pool, [], [{"id": "10", "displayName": "Lautaro Martinez", "dateOfBirth": "1997-08-22"},
                         {"id": "11", "displayName": "Lautaro Martinez", "dateOfBirth": "1997-08-22"}])]
    mapping, dropped = espn.resolve_athletes(items)
    assert mapping == {} and dropped == 2


def test_one_athlete_read_on_several_days_reaches_one_fc_id():
    pool = [_entry(1, "Thuram", 1997)]
    athlete = {"id": "7", "displayName": "Marcus Thuram", "dateOfBirth": "1997-08-06"}
    mapping, dropped = espn.resolve_athletes([(pool, [], [athlete]), (pool, [], [athlete])])
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


def test_a_venue_swap_updates_the_match_of_that_day_and_not_the_reverse_fixture(tmp_path):
    """PSG - Rennes 23/08/2026: SofaScore home PSG (round 1), ESPN home Rennes. The ordered pair is the
    round-23 return match, and moving it to August would erase it from the calendar still to play."""
    conn = init_db(tmp_path / "t.db")
    for event, rnd, date, home, away in (("s1", 1, "2026-08-23", "psg", "rennes"),
                                         ("s23", 23, "2027-03-06", "rennes", "psg")):
        conn.execute("INSERT INTO fixtures(event_id, season, league, round, date, home_key, away_key, played, "
                     "source, observed_on) VALUES (?, '2026-27', 'ligue_1', ?, ?, ?, ?, 0, 'sofascore', "
                     "'2026-09-24')", (event, rnd, date, home, away))
    rows = [{"season": "2026-27", "league": "ligue_1", "home_key": "rennes", "away_key": "psg",
             "date": "2026-08-23", "played": 1, "event_id": "e"}]
    counts = espn.update_fixtures(conn, rows, "2026-10-30")
    assert counts == {"updated": 1, "moved": 0, "unmatched": 0}
    assert dict(conn.execute("SELECT event_id, date || '|' || played FROM fixtures")) == {
        "s1": "2026-08-23|1", "s23": "2027-03-06|0"}


def test_an_espn_match_is_placed_on_its_club_round_and_a_self_contradicting_day_on_the_common_one(tmp_path):
    conn = init_db(tmp_path / "t.db")
    for event, rnd, date, home, away in (("a", 5, "2026-10-04", "inter", "milan"),
                                         ("b", 5, "2026-10-04", "roma", "lazio"),
                                         ("c", 3, "2026-10-04", "napoli", "como"),
                                         ("d", 23, "2026-10-04", "milan", "inter")):
        conn.execute("INSERT INTO fixtures(event_id, season, league, round, date, home_key, away_key, played, "
                     "source, observed_on) VALUES (?, '2026-27', 'serie_a', ?, ?, ?, ?, 1, 'sofascore', "
                     "'2026-10-30')", (event, rnd, date, home, away))
    book = espn.RoundBook(conn)
    assert book.round_of("2026-27", "serie_a", "2026-10-04", "Napoli") == 3   # a catch-up keeps ITS round
    assert book.round_of("2026-27", "serie_a", "2026-10-04", "Inter") == 5    # two rounds that day: the common
    assert book.round_of("2026-27", "serie_a", "2026-10-04", None) == 5
    assert book.round_of("2026-27", "serie_a", "2026-10-05", "Inter") is None


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


def _summary():
    def entry(aid, name, pos, starter, stats, place=None):
        return {"athlete": {"id": aid, "displayName": name}, "starter": starter, "formationPlace": place,
                "position": {"abbreviation": pos}, "stats": [{"name": k, "value": v} for k, v in stats.items()]}
    return {
        "header": {"season": {"year": 2026}, "competitions": [{
            "date": "2026-10-25T18:45Z", "status": {"type": {"completed": True}},
            "competitors": [{"homeAway": "home", "team": {"id": "110"}, "score": "2"},
                            {"homeAway": "away", "team": {"id": "109"}, "score": "1"}]}]},
        "keyEvents": [
            {"type": {"text": "Substitution"}, "clock": {"value": 3780},
             "participants": [{"athlete": {"id": "s1"}}, {"athlete": {"id": "a2"}}]},
            {"type": {"text": "Red Card"}, "clock": {"value": 4200}, "participants": [{"athlete": {"id": "b2"}}]},
            {"type": {"text": "Penalty - Scored"}, "clock": {"value": 5400}, "team": {"id": "110"},
             "participants": [{"athlete": {"id": "s1"}}]},
            {"type": {"text": "Penalty - Saved"}, "clock": {"value": 3000}, "team": {"id": "110"},
             "participants": [{"athlete": {"id": "a2"}}]},
            {"type": {"text": "Substitution"}, "clock": {"value": 2400},
             "participants": [{"athlete": {"id": "gk2"}}, {"athlete": {"id": "gk1"}}]}],
        "rosters": [
            {"team": {"id": "110"}, "formation": "3-5-2", "roster": [
                entry("a1", "Keeper A", "G", True, {"saves": 1, "goalsConceded": 1}, 1),
                entry("a2", "Striker A", "CF-L", True, {"totalGoals": 0}, 9),
                entry("s1", "Sub A", "SUB", False, {"totalGoals": 1})]},
            {"team": {"id": "109"}, "formation": "4-3-3", "roster": [
                entry("gk1", "Keeper B", "G", True, {"saves": 2, "goalsConceded": 0}, 1),
                entry("gk2", "Keeper B2", "SUB", False, {"saves": 0, "goalsConceded": 2}),
                entry("b2", "Defender B", "CD", True, {"redCards": 1}, 5)]}]}


def test_a_summary_rebuilds_minutes_penalties_and_the_keeper_who_saved():
    rows = {row["athlete_id"]: row for row in espn.parse_summary(_summary(), {"gk2"})}
    assert rows["a2"]["minutes"] == 63 and rows["s1"]["minutes"] == 27      # off at 63', on at 63'
    assert rows["b2"]["minutes"] == 70                                       # sent off at 70'
    assert rows["s1"]["pen_scored"] == 1 and rows["a2"]["pen_missed"] == 1
    # the penalty saved at 50' goes to the keeper ON THE PITCH then - the one who came on at 40' - and he
    # is recognised as a keeper only because the caller knows it: a substitute is listed as SUB
    assert rows["gk2"]["pen_saved"] == 1 and rows["gk1"]["pen_saved"] == 0
    assert rows["gk2"]["minutes"] == 50 and rows["gk1"]["minutes"] == 40
    assert rows["a1"]["team_goals"] == 2 and rows["b2"]["opponent_goals"] == 2 and rows["a1"]["home"] == 1


def test_an_unfinished_match_has_no_rows():
    payload = _summary()
    payload["header"]["competitions"][0]["status"]["type"]["completed"] = False
    assert espn.parse_summary(payload) == []


def test_the_synthetic_vote_is_on_half_points_and_reads_the_events():
    from euroleghe_ingest.engine import vote_synth

    quiet = {"minutes": 90, "starter": 1, "team_goals": 0, "opponent_goals": 0, "home": 1}
    scorer = {**quiet, "team_goals": 1, "goals": 1}
    assert vote_synth.base_vote(quiet, "C") in (5.5, 6.0, 6.5)
    assert vote_synth.raw_vote(scorer, "C") > vote_synth.raw_vote(quiet, "C") + 0.7
    assert (vote_synth.base_vote(scorer, "C") * 2) % 1 == 0
    assert vote_synth.base_vote({**quiet, "minutes": 0}, "C") is None    # did not play: no vote, not a 6
    assert vote_synth.base_vote(quiet, "X") is None                      # unknown role: no guess


def test_a_cameo_under_fifteen_minutes_gets_no_vote_unless_something_happened():
    """Operator, 30/10/2026: under 15' the match is not played - unless he scored, assisted, missed a penalty
    or was sent off. One rule for the provider-rating line and for ESPN's vote."""
    from euroleghe_ingest.engine import vote_synth
    assert vote_synth.gets_a_vote(15)
    assert not vote_synth.gets_a_vote(14)
    assert vote_synth.gets_a_vote(5, goals=1)
    assert vote_synth.gets_a_vote(5, assists=1)
    assert vote_synth.gets_a_vote(5, pen_missed=1)
    assert vote_synth.gets_a_vote(5, reds=1)
    assert vote_synth.gets_a_vote(None)            # unknown minutes are not a cameo
    row = {"minutes": 9, "started": 0, "team_goals": 1, "opponent_goals": 0}
    assert vote_synth.base_vote(row, "C") is None
    assert vote_synth.base_vote({**row, "goals": 1}, "C") is not None
