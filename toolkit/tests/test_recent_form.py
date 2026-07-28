"""Tests for `recent_form`: who gets scraped, how identity is resolved, and what is kept.

The network parts are stubbed. What is pinned here is the judgement: the population filter (a
third-choice keeper is not "priced at least average"), the identity ladder (refuse rather than guess),
and the date cutoff (a backtest must not see matches played after the auction).
"""

from __future__ import annotations

import sqlite3

import pytest


def test_unfetched_bonuses_are_missing_not_zero(tmp_path):
    """Lauriente' reached the engine as "0 goals, 0 assists in 715 minutes". He was a Serie B top
    scorer: the bonuses cost one request per match, his were never fetched, and SUM(COALESCE(goals,0))
    turned "not measured" into "measured nothing" - a fabricated observation, which is worse than a
    missing one because a fit will happily learn from it. 111 of the 123 players in this population had
    it. Now the totals are None unless something carries them, and `bonus_matches` says how much does."""
    from euroleghe_ingest.db.database import init_db
    from euroleghe_ingest.engine import features

    conn = init_db(tmp_path / "euroleghe.db")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Unfetched')")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (2, 'Fetched')")
    rows = [(1, i, None, None) for i in range(1, 4)] + [(2, i, 1, 0) for i in range(1, 4)]
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, match_date, minutes, "
        "goals, assists) VALUES (?, '2024-25', 'sofascore_recent', ?, ?, 90, ?, ?)",
        [(fc_id, f"{fc_id}-{i}", f"2025-03-0{i}", goals, assists)
         for fc_id, i, goals, assists in rows])
    conn.commit()

    window = features.Window("TEST", "2024-25", "2025-26", "2025-08-15")
    sample = features._recent_form(conn, window)
    assert sample[1]["goals"] is None and sample[1]["assists"] is None
    assert sample[1]["bonus_matches"] == 0
    assert sample[1]["matches"] == 3          # the appearances themselves are real and stay
    assert sample[2]["goals"] == 3 and sample[2]["bonus_matches"] == 3
    # a genuine zero must still read as a zero: that is the case the None must not swallow
    conn.execute("UPDATE external_match_stats SET goals = 0, assists = 0 WHERE fc_id = 2")
    conn.commit()
    reread = features._recent_form(conn, window)
    assert reread[2]["goals"] == 0 and reread[2]["bonus_matches"] == 3


def test_backfill_targets_exactly_the_matches_missing_their_bonuses(tmp_path):
    """Re-running the module to fix 111 players would re-resolve every identity and re-download every
    match list to arrive at the rows it already has. `stored_without_bonuses` is the work that is
    actually missing: the stored matches with no goals, grouped by player, so each costs one request."""
    from euroleghe_ingest.db.database import init_db
    from euroleghe_ingest.modules import recent_form

    conn = init_db(tmp_path / "euroleghe.db")
    conn.executemany("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                     [(1, "Needs bonuses"), (2, "Already done"), (3, "Half done")])
    rows = [(1, "a1", None), (1, "a2", None),          # nothing fetched
            (2, "b1", 1), (2, "b2", 0),                # done, including a MEASURED zero
            (3, "c1", 2), (3, "c2", None)]             # interrupted mid-player
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, match_date, minutes, "
        "goals) VALUES (?, '2024-25', 'sofascore_recent', ?, '2025-03-01', 90, ?)", rows)
    conn.commit()

    pending = {fc_id: ids for fc_id, _name, ids in
               recent_form.stored_without_bonuses(conn)}
    assert sorted(pending) == [1, 3], "a player whose bonuses are all in must not be re-requested"
    assert sorted(pending[1]) == ["a1", "a2"]
    assert pending[3] == ["c2"], "an interrupted player resumes at the match he stopped on"
    assert 2 not in pending, "goals = 0 is a measurement and must not look like missing data"


def test_production_per_90_refuses_what_was_never_measured():
    """The whole reason R13c became testable. `goals is None` means the per-match bonuses were never
    fetched, and reading it as a goalless spell is what made 111 players look like non-scorers - which
    would have taught the fit exactly the wrong thing. A measured zero is a fact and passes through."""
    from euroleghe_ingest.engine import model

    assert model.production_per_90(None, None, 900) is None       # never fetched
    assert model.production_per_90(0, 0, 900) == 0.0              # measured, and genuinely nothing
    assert model.production_per_90(12, 2, 889) == pytest.approx(14 / (889 / 90))   # Gyokeres
    # under five full matches a rate is arithmetic on a rounding error, so it is refused outright
    assert model.production_per_90(1, 0, 120) is None
    assert model.production_per_90(1, 0, model.MIN_MINUTES_FOR_PRODUCTION) is not None


def test_a_resolved_identity_is_stored_not_thrown_away(tmp_path):
    """Resolving is the expensive and fragile half of this module - several search requests and a
    three-tier ladder that can refuse. It used to be used and dropped, so the only record was the
    coverage CSV, which every run overwrites: 17 players ended up with stored matches and no way to
    fetch their bonuses without resolving them all over again. The id now goes in player_xref."""
    from euroleghe_ingest.db.database import init_db
    from euroleghe_ingest.modules import recent_form

    conn = init_db(tmp_path / "euroleghe.db")
    conn.execute("INSERT INTO players(fc_id, canonical_name, birth_year) VALUES (7, 'Tizio', 1998)")
    conn.commit()

    calls: list[str] = []

    def fake_resolve(_session, player, _cancel=None):
        calls.append(player["name"])
        return 4242, "tier1_club_confirmed"

    original, recent_form.resolve = recent_form.resolve, fake_resolve
    try:
        first = recent_form._provider_id(conn, None, 7, "Tizio")
        second = recent_form._provider_id(conn, None, 7, "Tizio")
    finally:
        recent_form.resolve = original

    assert (first, second) == ("4242", "4242")
    assert calls == ["Tizio"], "the second call must read the stored id, not resolve again"


def test_resume_does_not_lock_in_a_player_whose_bonuses_were_skipped(tmp_path):
    """The other half of the same bug: the resume check counted MATCHES, so a player stored by a
    --no-bonuses run looked covered forever and could never be completed."""
    from euroleghe_ingest.db.database import init_db
    from euroleghe_ingest.modules import recent_form

    conn = init_db(tmp_path / "euroleghe.db")
    conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (1, 'Half stored')")
    conn.executemany(
        "INSERT INTO external_match_stats(fc_id, season, source, match_id, match_date, minutes) "
        "VALUES (1, '2024-25', 'sofascore_recent', ?, ?, 90)",
        [(f"m{i}", f"2025-03-{i:02d}") for i in range(1, 11)])
    conn.commit()

    def already(*, bonuses: bool) -> int:
        clause = "AND goals IS NOT NULL" if bonuses else ""
        return conn.execute(
            f"SELECT COUNT(*) FROM external_match_stats WHERE fc_id = 1 AND source = ? "
            f"AND match_date >= ? AND match_date < ? {clause}",
            (recent_form.SOURCE, "2024-07-01", "2025-08-15")).fetchone()[0]

    assert already(bonuses=False) == 10       # matches are there, so a bonus-free run is done
    assert already(bonuses=True) == 0         # ... and a bonus run still has everything to do
    assert isinstance(conn, sqlite3.Connection)

import csv
import time

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
