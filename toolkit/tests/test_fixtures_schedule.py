"""What «facile» means, and the calendar the app counts it on.

Two things are pinned here and they are pinned for different reasons.

The MEANING of the label, because it was measured against the operator's own sentence («una partita
facile e' una partita dove e' probabile che la squadra non subisca gol») and the whole design stands on
the answer: at the frozen margin the clean-sheet probability is 0.40, which is also
`club_defence.CLEAN_SHEET_SHARE`, measured a month earlier on an unrelated criterion. If somebody moves
either constant, that agreement has to be re-established rather than quietly lost.

The SHAPE of `schedule`, because the app reads it and cannot re-derive any of it: one number per match
says both sides, a club joins by the canonical name resolved HERE, and a championship with no fitted
coefficients carries no probability at all instead of a plausible one.
"""

from __future__ import annotations

import sqlite3

import pytest

from euroleghe_ingest.config import CHAMPIONSHIPS
from euroleghe_ingest.db.database import init_db
from euroleghe_ingest.modules import fixtures


def _db(tmp_path) -> sqlite3.Connection:
    conn = init_db(tmp_path / "test.db")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (1, 'Inter', 'serie_a')")
    conn.execute("INSERT INTO clubs(fc_club_id, canonical_name, league) VALUES (2, 'Lecce', 'serie_a')")
    for key, elo in (("inter", 1900.0), ("lecce", 1550.0), ("bayern", 2000.0), ("koln", 1600.0)):
        conn.execute(
            "INSERT INTO club_levels(club_key, year, elo, elo_name) VALUES (?, '2026', ?, ?)",
            (key, elo, key))
    conn.commit()
    return conn


def _fixture(conn, event, league, rnd, home, away, played=0):
    conn.execute(
        """INSERT INTO fixtures(event_id, season, league, round, date, home_key, away_key,
                                played, source, observed_on)
           VALUES (?, '2026-27', ?, ?, '2026-09-01', ?, ?, ?, 'sofascore', '2026-09-01')""",
        (event, league, rnd, home, away, played))
    conn.commit()


def test_the_frozen_margin_is_the_operators_own_sentence():
    """P(clean sheet) at `EASY_MARGIN` is 0.40 - the quota `club_defence` measured independently.

    Not a coincidence to be preserved by luck: the margin was chosen by eye in August on «the strongest
    club must stop reading all of them», and the logistic was fitted in September on 5354 club-matches
    against whether the goal was actually kept. Two roads, one number.
    """
    assert fixtures.clean_sheet_probability(fixtures.EASY_MARGIN) == pytest.approx(0.40, abs=0.01)


def test_the_probability_rises_with_the_edge_and_stays_a_probability():
    values = [fixtures.clean_sheet_probability(edge) for edge in (-400, -200, 0, 200, 400)]
    assert values == sorted(values)
    assert all(0.0 < value < 1.0 for value in values)
    # A club level with a match of its own is a coin's worth of nothing special: the base rate.
    assert fixtures.clean_sheet_probability(0) == pytest.approx(0.249, abs=0.01)


def test_the_away_edge_is_exactly_minus_the_home_edge():
    """One subtraction per match says both sides - which is why the artefact stores one number."""
    home = fixtures.edge(1900, 1550, True)
    away = fixtures.edge(1550, 1900, False)
    assert home == pytest.approx(-away)


def test_the_venue_is_worth_the_whole_gap_and_not_twice_it():
    assert fixtures.edge(1700, 1700, True) - fixtures.edge(1700, 1700, False) == pytest.approx(
        fixtures.HOME_AWAY_GAP)


def test_schedule_resolves_our_canonical_name_so_the_app_never_joins_by_a_key(tmp_path):
    conn = _db(tmp_path)
    _fixture(conn, "1", "serie_a", 1, "inter", "lecce")
    out = fixtures.schedule(conn, "2026-27", CHAMPIONSHIPS)
    clubs = {club["key"]: club for club in out["leagues"]["serie_a"]["clubs"]}
    assert clubs["inter"]["name"] == "Inter"
    assert clubs["inter"]["fc_club_id"] == 1


def test_schedule_prices_the_home_side_only_and_the_reader_negates_it(tmp_path):
    conn = _db(tmp_path)
    _fixture(conn, "1", "serie_a", 1, "inter", "lecce")
    row = fixtures.schedule(conn, "2026-27", CHAMPIONSHIPS)["leagues"]["serie_a"]["matches"][0]
    _round, _date, home, away, gap, cs_home, cs_away = row
    assert (home, away) == ("inter", "lecce")
    assert gap == pytest.approx(fixtures.edge(1900, 1550, True), abs=0.05)
    assert cs_home == pytest.approx(fixtures.clean_sheet_probability(gap), abs=1e-3)
    assert cs_away == pytest.approx(fixtures.clean_sheet_probability(-gap), abs=1e-3)


def test_a_championship_the_coefficients_were_not_fitted_on_carries_no_probability(tmp_path):
    """A fitted transform belongs to the population it was fitted on - so outside it, nothing."""
    conn = _db(tmp_path)
    _fixture(conn, "1", "bundesliga", 1, "bayern", "koln")
    league = fixtures.schedule(conn, "2026-27", CHAMPIONSHIPS)["leagues"]["bundesliga"]
    assert league["clean_sheet_fitted"] is False
    _round, _date, _home, _away, gap, cs_home, cs_away = league["matches"][0]
    assert gap is not None                      # the EDGE is universal: `club_levels` prices everybody
    assert cs_home is None and cs_away is None  # ...the probability is not, and says so


def test_a_match_missing_a_level_is_unclassified_and_never_an_easy_zero(tmp_path):
    conn = _db(tmp_path)
    conn.execute("DELETE FROM club_levels WHERE club_key = 'lecce'")
    conn.commit()
    _fixture(conn, "1", "serie_a", 1, "inter", "lecce")
    league = fixtures.schedule(conn, "2026-27", CHAMPIONSHIPS)["leagues"]["serie_a"]
    assert league["unclassified"] == 1
    assert league["matches"][0][4] is None


def test_schedule_leaves_out_what_has_already_been_played_and_what_has_no_round(tmp_path):
    conn = _db(tmp_path)
    _fixture(conn, "1", "serie_a", 1, "inter", "lecce", played=1)
    conn.execute(
        """INSERT INTO fixtures(event_id, season, league, round, date, home_key, away_key,
                                played, source, observed_on)
           VALUES ('2', '2026-27', 'coppa-italia', NULL, '2026-09-01', 'inter', 'lecce', 0,
                   'sofascore', '2026-09-01')""")
    conn.commit()
    assert fixtures.schedule(conn, "2026-27", CHAMPIONSHIPS)["leagues"] == {}


def test_easy_matches_and_the_calendar_agree_on_which_match_is_easy(tmp_path):
    """ONE definition of the edge, read by the count on the sheet and by the app's own calendar.

    They are two callers of `fixtures.edge` and this is what stops them drifting: a match that is easy
    on a sheet's `desc_easy_matches` and not easy on the auction board would be the same defect as two
    readers of `engine_fm_pred`.
    """
    conn = _db(tmp_path)
    _fixture(conn, "1", "serie_a", 1, "inter", "lecce")
    counted = fixtures.easy_matches(conn, "2026-27", "inter", league="serie_a")
    gap = fixtures.schedule(conn, "2026-27", CHAMPIONSHIPS)["leagues"]["serie_a"]["matches"][0][4]
    assert counted["easy"] == (1 if gap > fixtures.EASY_MARGIN else 0)
    assert counted["margin"] == pytest.approx(gap, abs=0.05)
