"""What «facile» means, and the calendar the app counts it on.

Two things are pinned here and they are pinned for different reasons.

The MEANING of the label, in TWO assertions that are two different kinds of statement - which is the
whole point, because for one day they were one. The 40% level of the fitted curve falls at an edge of
199 and that is an invariant of the MEASUREMENT: it does not move when a threshold does, and it is
still the number `club_defence.CLEAN_SHEET_SHARE` = 0.40 landed on from an unrelated criterion a month
earlier. The THRESHOLD is a declaration by the operator (100, his decision of 03/09/2026 evening, on
three examples of his own) and what it promises is asserted as the value it actually is, 0.32 - so
whoever moves it has to re-declare that sentence instead of inheriting a 0.40 that was true of a
different threshold.

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


def test_the_forty_per_cent_level_of_the_curve_is_where_two_measurements_met():
    """The 40% level falls at an edge of 202, and that is a fact about the CURVE.

    Two roads to one number: `club_defence.CLEAN_SHEET_SHARE` = 0.40, measured in August as the quota
    at which «una porta resta inviolata spesso», and this logistic, fitted in September on 5354
    club-matches against whether the goal was actually kept. It stays asserted after `EASY_MARGIN`
    stopped sitting on it, because a threshold moving does not unmeasure a curve.
    """
    assert fixtures.clean_sheet_probability(202.0) == pytest.approx(0.40, abs=0.005)


def test_the_declared_margin_promises_what_it_promises_and_not_what_it_used_to():
    """`EASY_MARGIN` is DECLARED, and the sentence that goes with it is asserted at its own value.

    75 is the operator's decision of 03/09/2026 (evening), taken twice with the table in front of
    him: three matches took it from 200 to 100 (two of the three were already easy), then twelve
    matches dotted on two boards took it to 75 - all twelve of them HOME matches, which is what moved
    the field term with it. At 75 an easy match keeps a clean sheet 38.7% of the time against 20.0%
    for the rest (measured, 5354 club-matches) - a real separation, and NOT «more likely than not».
    Anybody moving this constant moves that sentence with it, and this is the assertion that makes
    them say so.
    """
    assert fixtures.EASY_MARGIN == 75.0
    assert fixtures.clean_sheet_probability(fixtures.EASY_MARGIN) == pytest.approx(0.30, abs=0.01)


def test_the_two_models_agree_at_the_threshold_so_a_promoted_club_does_not_change_colour():
    """`EASY_PROBABILITY` is the edge-only model's answer at `EASY_MARGIN`, and that is load-bearing.

    Since 03/09/2026 the verdict is a threshold on the PROBABILITY, and the probability reads the last
    ten matches' goals when both clubs have them. A club with no form - a promoted side in September -
    is priced by the edge alone, so if the two thresholds were not the same number it would be labelled
    differently for having been promoted, which is a fact about our data and not about its calendar.
    """
    assert fixtures.clean_sheet_probability(fixtures.EASY_MARGIN) == pytest.approx(
        fixtures.EASY_PROBABILITY, abs=0.0005)
    # Just under and just over, on the edge-only model: the two rules agree on the same matches.
    assert fixtures.clean_sheet_probability(fixtures.EASY_MARGIN - 1) < fixtures.EASY_PROBABILITY
    assert fixtures.clean_sheet_probability(fixtures.EASY_MARGIN + 1) > fixtures.EASY_PROBABILITY


def test_the_goals_move_the_probability_at_the_same_edge():
    """The operator's channel, in one assertion: “una squadra forte non e' detto che segni tanto”.

    Same edge, two opponents - one scoring 0.8 a game, one 2.0 - and the probability has to move, or
    the goals are in the signature and not in the answer. And it moves the RIGHT way on both terms: a
    leakier defence of my own lowers it too, by less (the measured coefficients are -0.32 against
    -0.41, which is why «what decides a clean sheet is mostly who you are playing against»).
    """
    mild = fixtures.clean_sheet_probability(0.0, conceded=1.35, scored=0.8)
    fierce = fixtures.clean_sheet_probability(0.0, conceded=1.35, scored=2.0)
    assert mild > fierce + 0.05
    solid = fixtures.clean_sheet_probability(0.0, conceded=0.6, scored=1.33)
    leaky = fixtures.clean_sheet_probability(0.0, conceded=1.8, scored=1.33)
    assert solid > leaky
    # ...and the opponent's attack is worth MORE than my own defence, as measured.
    assert abs(fixtures.CLEAN_SHEET_FORM_SCORED) > abs(fixtures.CLEAN_SHEET_FORM_CONCEDED)
    # Half a form is no form: one number cannot enter a two-term model, so the edge-only one answers.
    assert (fixtures.clean_sheet_probability(0.0, conceded=1.35)
            == fixtures.clean_sheet_probability(0.0))


def test_recent_goals_reads_each_club_and_refuses_a_window_it_cannot_fill(tmp_path):
    """Ten matches per club, by DATE, and nobody else's.

    The first version of this function joined the votes to the per-match layer on (season, matchday)
    with no club in the key, so every club-match matched every other club of that round and all twenty
    clubs read the same numbers. This asserts the two clubs apart - which is what printing five clubs
    and seeing identical rows would have caught, and did.
    """
    conn = _db(tmp_path)
    # One keeper and one forward PER CLUB: the votes are keyed on (fc_id, season, matchday, platform),
    # so two clubs cannot share a man on the same round - and both tables reference `players`, so the
    # men exist before their votes do.
    squads = {"Inter": (1000, 2000, 0, 3), "Lecce": (1100, 2100, 2, 1)}
    for keeper, forward, _c, _s in squads.values():
        for at in range(12):
            conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                         (keeper + at, f"keeper{keeper + at}"))
            conn.execute("INSERT INTO players(fc_id, canonical_name) VALUES (?, ?)",
                         (forward + at, f"forward{forward + at}"))
    conn.commit()
    for at in range(12):
        day = f"2026-0{1 + at // 6}-{10 + at % 6:02d}"
        for club, (keeper, forward, conceded, scored) in squads.items():
            conn.execute(
                """INSERT INTO match_ratings(fc_id, season, matchday, role, team, platform, mv,
                                             goals, pen_scored, goals_conceded)
                   VALUES (?, '2026-27', ?, 'P', ?, 'default', 6.0, 0, 0, ?)""",
                (keeper + at, at + 1, club, conceded))
            conn.execute(
                """INSERT INTO match_ratings(fc_id, season, matchday, role, team, platform, mv,
                                             goals, pen_scored, goals_conceded)
                   VALUES (?, '2026-27', ?, 'A', ?, 'default', 6.0, ?, 0, NULL)""",
                (forward + at, at + 1, club, scored))
            conn.execute(
                """INSERT INTO external_match_stats(fc_id, season, source, match_id, competition,
                                                    real_md, match_date, club, opponent, home)
                   VALUES (?, '2026-27', 'sofascore', ?, 'serie_a', ?, ?, ?, 'x', 1)""",
                (keeper + at, f"{club}-{at}", at + 1, day, club))
    conn.commit()

    form = fixtures.recent_goals(conn, before="2026-12-31", horizon_days=0)
    assert form["inter"][0] == pytest.approx(0.0), "i gol subiti sono quelli suoi, non della giornata"
    assert form["inter"][1] == pytest.approx(3.0)
    assert form["lecce"] == (pytest.approx(2.0), pytest.approx(1.0), 10)

    # A club with nine matches has no form: a mean over nine is not what the coefficients were fitted
    # on, and the caller's fallback is the edge-only model - «vuoto = ignoto, mai zero».
    assert fixtures.recent_goals(conn, before="2026-12-31", horizon_days=0, matches=13) == {}

    # THE HORIZON: the same ten matches, read from a day fifteen months later, are not a form.
    assert fixtures.recent_goals(conn, before="2028-06-01") == {}


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
    """And the gap is the one measured on THIS question, not the one measured on the result.

    Two field constants live in the module since 03/09/2026 and each names its question:
    `HOME_AWAY_GAP` (70, fitted on whether the goal is kept) is what `edge` applies, while
    `RESULT_HOME_AWAY_GAP` (29, fitted on the result) has no reader here and is provenance for the
    `projection.CALENDAR_PER_100` coefficient, which was measured with it. Asserting the pair is what
    stops the two being swapped by whoever reads only one of the names.
    """
    assert fixtures.edge(1700, 1700, True) - fixtures.edge(1700, 1700, False) == pytest.approx(
        fixtures.HOME_AWAY_GAP)
    assert fixtures.HOME_AWAY_GAP != fixtures.RESULT_HOME_AWAY_GAP


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
