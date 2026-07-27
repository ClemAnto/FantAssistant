"""Tests for `recent_form`: who gets scraped, how identity is resolved, and what is kept.

The network parts are stubbed. What is pinned here is the judgement: the population filter (a
third-choice keeper is not "priced at least average"), the identity ladder (refuse rather than guess),
and the date cutoff (a backtest must not see matches played after the auction).
"""

from __future__ import annotations

import csv
import time

import pytest

from euroleghe_ingest.config import Config
from euroleghe_ingest.context import Context
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import recent_form


def _db(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", db_path=tmp_path / "data" / "euroleghe.db")
    (tmp_path / "data").mkdir()
    return cfg, init_db(cfg.db_path)


def test_population_takes_the_priced_and_historyless_only(tmp_path):
    _cfg, conn = _db(tmp_path)
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1,'Milan','serie_a')")
    players = [(1, "Expensive", 1999), (2, "Cheap", 2000), (3, "HasHistory", 1998),
               (4, "BackupKeeper", 1997), (5, "StarKeeper", 1996), (6, "HasMatches", 1995)]
    conn.executemany("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (?,?,?)", players)
    # role medians here: A = 6.5 (prices 5, 6, 7, 15), P = 6.5 (1 and 12)
    conn.executemany(
        "INSERT INTO rosters(fc_id, season, fc_club_id, role_classic, price_initial) "
        "VALUES (?, '2025-26', 1, ?, ?)",
        [(1, "A", 15.0), (2, "A", 5.0), (3, "A", 6.0), (4, "P", 1.0), (5, "P", 12.0),
         (6, "A", 7.0)])
    # HasHistory played last season; HasMatches has provider rows for it
    conn.execute("INSERT INTO season_stats(fc_id, season, platform, pv, mv, fm) "
                 "VALUES (3, '2024-25', 'euro', 20, 6.2, 7.0)")
    conn.execute("INSERT INTO external_match_stats(fc_id, season, source, match_id, minutes) "
                 "VALUES (6, '2024-25', 'sofascore', 'm1', 90)")
    conn.commit()

    picked = {entry["name"] for entry in
              recent_form.priced_without_history(conn, "2025-26", "2024-25")}
    assert picked == {"Expensive", "StarKeeper"}, picked
    # the reason StarKeeper is in and BackupKeeper is out: strictly above the role median, because
    # the keeper median is the floor itself
    assert "BackupKeeper" not in picked
    assert "Cheap" not in picked          # at/below the median
    assert "HasHistory" not in picked and "HasMatches" not in picked


def test_identity_ladder_prefers_the_club_then_the_birth_year_then_refuses(monkeypatch):
    candidates = [
        {"id": 1, "name": "Malik Tillman", "team": "Bayer 04 Leverkusen", "followers": 8000},
        {"id": 2, "name": "Timothy Tillman", "team": "Los Angeles FC", "followers": 500},
    ]
    monkeypatch.setattr(recent_form, "search_candidates", lambda *_a, **_k: candidates)
    monkeypatch.setattr(recent_form, "_polite_sleep", lambda *_a, **_k: None)

    # tier1: the listone club and the provider's current club agree
    got = recent_form.resolve(None, {"name": "Tillman", "club": "Bayer Leverkusen"})
    assert got == (1, "tier1_club_confirmed")

    # no club to lean on -> the birth year breaks the tie, one probe per candidate
    probed: list[int] = []

    def fake_birth_year(_session, provider_id):
        probed.append(provider_id)
        return {1: 2002, 2: 1999}[provider_id]

    monkeypatch.setattr(recent_form, "birth_year", fake_birth_year)
    got = recent_form.resolve(None, {"name": "Tillman", "club": None, "birth_year": 1999})
    assert got == (2, "tier2_birth_year")
    assert probed, "the birth year must actually be checked, not assumed"

    # neither club nor birth year: followers decide only when one candidate dominates
    got = recent_form.resolve(None, {"name": "Tillman", "club": None})
    assert got == (1, "tier3_popularity")
    close = [dict(candidates[0], followers=600), dict(candidates[1], followers=500)]
    monkeypatch.setattr(recent_form, "search_candidates", lambda *_a, **_k: close)
    assert recent_form.resolve(None, {"name": "Tillman", "club": None}) == (None, "")


def test_two_players_with_the_same_name_at_the_same_club_are_refused(monkeypatch):
    twins = [{"id": 1, "name": "Ivan Ilic", "team": "Torino", "followers": 900},
             {"id": 2, "name": "Ivan Ilic", "team": "Torino", "followers": 800}]
    monkeypatch.setattr(recent_form, "search_candidates", lambda *_a, **_k: twins)
    assert recent_form.resolve(None, {"name": "Ilic", "club": "Torino"}) == (None, "")


def test_only_club_matches_before_the_cutoff_are_kept(monkeypatch):
    """Three ways a match is not evidence for an auction: it is after it, it is a national-team game,
    or he never came on."""
    cutoff = int(time.mktime(time.strptime("2025-08-15", "%Y-%m-%d")))
    day = 86_400
    events = [
        {"id": 1, "startTimestamp": cutoff - 10 * day, "homeTeam": {"id": 10, "name": "Feyenoord"},
         "awayTeam": {"id": 11, "name": "Ajax"}, "tournament": {"uniqueTournament": {"slug": "eredivisie"}},
         "roundInfo": {"round": 33}},
        {"id": 2, "startTimestamp": cutoff + 5 * day, "homeTeam": {"id": 10, "name": "Feyenoord"},
         "awayTeam": {"id": 12, "name": "PSV"}, "tournament": {"uniqueTournament": {"slug": "eredivisie"}}},
        {"id": 3, "startTimestamp": cutoff - 20 * day, "homeTeam": {"id": 90, "name": "Netherlands",
                                                                    "national": True},
         "awayTeam": {"id": 91, "name": "Belgium", "national": True},
         "tournament": {"uniqueTournament": {"slug": "world-cup"}}},
        {"id": 4, "startTimestamp": cutoff - 30 * day, "homeTeam": {"id": 10, "name": "Feyenoord"},
         "awayTeam": {"id": 13, "name": "Utrecht"},
         "tournament": {"uniqueTournament": {"slug": "eredivisie"}}},
    ]
    payload = {"events": events, "hasNextPage": False,
               "statisticsMap": {"1": {"rating": 7.4, "minutesPlayed": 90},
                                 "2": {"rating": 8.0, "minutesPlayed": 90},
                                 "3": {"rating": 6.9, "minutesPlayed": 90},
                                 "4": {"rating": 6.1, "minutesPlayed": 0}},
               "playedForTeamMap": {"1": 10, "2": 10, "3": 90, "4": 10}}
    monkeypatch.setattr(recent_form, "_get_json", lambda *_a, **_k: payload)
    monkeypatch.setattr(recent_form, "_polite_sleep", lambda *_a, **_k: None)

    kept = recent_form.recent_matches(None, 555, cutoff, wanted=10)
    assert [match["event_id"] for match in kept] == ["1"], [m["event_id"] for m in kept]
    assert kept[0]["competition"] == "eredivisie"
    assert kept[0]["club"] == "Feyenoord" and kept[0]["opponent"] == "Ajax"
    assert kept[0]["home"] == 1 and kept[0]["rating"] == 7.4


def test_stored_rows_are_tagged_apart_from_the_five_league_layer(tmp_path):
    """A Serie B rating must never be mistaken for a Serie A one: `synth` fits and applies its line
    to source='sofascore', so these rows carry a different source."""
    _cfg, conn = _db(tmp_path)
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (7, 'Newcomer')")
    conn.commit()
    matches = [{"event_id": "900", "timestamp": 1_700_000_000, "season": "2023-24",
                "competition": "eredivisie", "club": "Feyenoord", "opponent": "Ajax", "home": 1,
                "round": 12, "minutes": 90, "rating": 7.2, "goals": 1, "assists": 0,
                "xg": 0.4, "xa": 0.1}]
    assert recent_form.store(conn, 7, matches) == 1
    conn.commit()
    row = conn.execute("SELECT source, competition, match_date, rating, goals FROM "
                       "external_match_stats WHERE fc_id = 7").fetchone()
    assert row[0] == recent_form.SOURCE
    assert row[0] != "sofascore", "these rows must not be picked up by synth"
    assert row[1] == "eredivisie"
    assert row[2] == "2023-11-14"
    assert (row[3], row[4]) == (7.2, 1)
    # and `synth` would not touch it
    assert conn.execute("SELECT COUNT(*) FROM external_match_stats WHERE source = 'sofascore'"
                        ).fetchone()[0] == 0


def test_season_of_follows_the_european_convention():
    assert recent_form._season_of(int(time.mktime(time.strptime("2024-08-20", "%Y-%m-%d")))) == "2024-25"
    assert recent_form._season_of(int(time.mktime(time.strptime("2025-05-10", "%Y-%m-%d")))) == "2024-25"
    assert recent_form._season_of(int(time.mktime(time.strptime("2025-07-02", "%Y-%m-%d")))) == "2025-26"


def test_run_is_safe_when_nobody_qualifies(tmp_path):
    cfg, conn = _db(tmp_path)
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Solo')")
    conn.executemany("INSERT INTO rosters(fc_id, season, role_classic, price_initial) VALUES (?,?,?,?)",
                     [(1, "2023-24", "A", 10.0), (1, "2024-25", "A", 10.0)])
    conn.commit()
    # one player, so he IS the median and nobody is strictly above it: no network call must happen
    monkeypatch_failed = False
    try:
        recent_form.run(Context(config=cfg, conn=conn), seasons=["2024-25"])
    except Exception as exc:  # noqa: BLE001 - any network attempt would surface here
        monkeypatch_failed = True
        pytest.fail(f"run touched the network with an empty population: {exc}")
    assert not monkeypatch_failed


def test_a_prehistoric_birth_date_is_not_a_crash(monkeypatch):
    """The search reaches every era: a pre-1970 timestamp is negative and `time.gmtime` refuses it on
    Windows, which used to kill the whole run two thirds of the way through."""
    assert recent_form._year_of(-1_000_000_000) is None
    assert recent_form._year_of(0) is None
    assert recent_form._year_of(None) is None
    assert recent_form._year_of(946_684_800) == 2000

    monkeypatch.setattr(recent_form, "_get_json",
                        lambda *_a, **_k: {"player": {"dateOfBirthTimestamp": -1_262_304_000}})
    assert recent_form.birth_year(None, 1) is None


def test_one_bad_player_does_not_end_the_run(tmp_path, monkeypatch):
    cfg, conn = _db(tmp_path)
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(1, "Boom"), (2, "Fine"), (3, "Cheap"), (4, "Cheaper")])
    # median of 1, 2, 15, 20 is 8.5, so both Boom and Fine are strictly above it
    conn.executemany(
        "INSERT INTO rosters(fc_id, season, role_classic, price_initial) VALUES (?, ?, 'A', ?)",
        [(1, "2024-25", 20.0), (2, "2024-25", 15.0), (3, "2024-25", 1.0), (4, "2024-25", 2.0),
         (1, "2023-24", 20.0), (2, "2023-24", 15.0), (3, "2023-24", 1.0), (4, "2023-24", 2.0)])
    conn.commit()

    monkeypatch.setattr(recent_form, "_client", lambda: _Session())
    monkeypatch.setattr(recent_form, "_polite_sleep", lambda *_a, **_k: None)

    def explode_on_the_first(_ctx, _session, _conn, player, *_a, **_k):
        if player["name"] == "Boom":
            raise RuntimeError("provider said something odd")
        return {"season": "2024-25", "fc_id": player["fc_id"], "name": player["name"],
                "role": "A", "price": player["price"], "club": None, "provider_id": 9,
                "tier": "tier1_club_confirmed", "matches": 4, "competitions": "serie-b",
                "_stored": 4}

    monkeypatch.setattr(recent_form, "_process", explode_on_the_first)
    recent_form.run(Context(config=cfg, conn=conn), seasons=["2024-25"])

    written = list(csv.DictReader(
        (cfg.data_dir / "reports" / recent_form.COVERAGE_FILE).open(encoding="utf-8")))
    tiers = {row["name"]: row["tier"] for row in written}
    assert tiers["Boom"] == "error"                      # reported, not fatal
    assert tiers["Fine"] == "tier1_club_confirmed"       # and the run carried on


class _Session:
    def close(self):
        pass


def test_names_are_compared_folded_and_the_initial_discriminates():
    """Two bugs in one test. The accent: a raw substring test never matched "Lucas Vazquez", which is
    why four Vazquez went unresolved. The initial: our "Surname X." means the surname sits at the END
    of the provider's "First Last", and the initial starts his first name."""
    match = recent_form.candidate_matches
    assert match("vazquez", None, "Lucas Vázquez")          # folded
    assert match("gronbaek", None, "Oscar Grønbæk")          # o-slash and ae-ligature too
    # "James J." = surname James, first name starting with J
    assert match("james", "j", "Jaden James")
    assert not match("james", "j", "James Justin")           # James is his FIRST name
    assert not match("james", "j", "Reece James")            # right surname, wrong initial
    # no initial to lean on: any position of the surname is accepted
    assert match("james", None, "Reece James")
    assert match("neves", None, "João Neves")
    assert not match("neves", None, "Lucas Vázquez")


def test_the_initial_bug_no_longer_swallows_the_shortlist(monkeypatch):
    candidates = [
        {"id": 1, "name": "James Justin", "team": "Leeds United", "followers": 1419},
        {"id": 2, "name": "James Rodriguez", "team": "No team", "followers": 85610},
        {"id": 3, "name": "Jaden James", "team": "Rennes", "followers": 300},
    ]
    monkeypatch.setattr(recent_form, "search_candidates", lambda *_a, **_k: candidates)
    monkeypatch.setattr(recent_form, "_polite_sleep", lambda *_a, **_k: None)
    # the club still decides when it can
    assert recent_form.resolve(None, {"name": "James J.", "club": "Rennes"}) == (
        3, "tier1_club_confirmed")
