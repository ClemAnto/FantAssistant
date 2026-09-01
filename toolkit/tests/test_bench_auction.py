"""The auction bench: the league's regulation, and the invariants an auction cannot break.

Two kinds of test, and the split matters. The REGULATION ones pin numbers the operator dictated - if one
of them fails, either the transcription is wrong or somebody changed a rulebook without saying so. The
INVARIANT ones pin things no auction may ever do (spend more than the budget, leave a squad unfinishable,
pay more than the winner's own ceiling); they are what makes the bench's numbers worth reading at all.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bench.auction import rules
from bench.auction.bench import (DEPTH_WEIGHT, HOLE_COST, QUOTA_DEPTH, Team, auction, cover_value,
                                 coverage_need, covered_places, engine_rate, role_shares, to_credits)
from bench.auction.league import LEAGUE_TABLE, LEGS, fixtures, round_robin, standings
from bench.auction.profiles import MENTAL_CAP_SHARE, PROFILES, URGENCY


# ----------------------------------------------------------------------------- the regulation

def test_r_factor_is_gone_at_four_insufficient_men():
    """«+2 se tutti e 11 prendono almeno 6, mezzo punto in meno per ognuno sotto, mai sotto zero.»

    The threshold is the whole point of the modifier: below four insufficient men every man who closes
    at 6 is worth half a point, from four on he is worth nothing. It is why the value of a steady player
    cannot be written on his own row - it depends on the other ten.
    """
    assert rules.r_factor([6.0] * 11) == 2.0
    assert rules.r_factor([5.5] + [6.0] * 10) == 1.5
    assert rules.r_factor([5.5] * 3 + [6.0] * 8) == 0.5
    assert rules.r_factor([5.5] * 4 + [6.0] * 7) == 0.0
    assert rules.r_factor([5.0] * 11) == 0.0          # never negative


def test_the_pass_mark_includes_a_bare_six():
    """A flat 6.0 is SUFFICIENT, and it is the modal vote of the game: 36.1% of 59,094 Serie A votes.

    Reading it as insufficient would move the share of men who pass from 0.658 to 0.297 - so this is
    not a boundary detail, it is most of the modifier.
    """
    assert rules.r_factor([6.0] * 11) == rules.R_FACTOR_MAX
    assert rules.r_factor([5.99] + [6.0] * 10) < rules.R_FACTOR_MAX


def test_defence_modifier_bands_are_the_league_settings_page():
    """Three effective steps written in six rows, ceiling +2, and nothing below 6."""
    assert rules.defence_modifier([6.1, 6.1, 6.1, 5.0]) == 0.5      # 6.00-6.25
    assert rules.defence_modifier([6.4, 6.4, 6.3, 5.0]) == 0.5      # 6.25-6.50, same pay
    assert rules.defence_modifier([6.6, 6.6, 6.5, 5.0]) == 1.0      # 6.50-6.75
    assert rules.defence_modifier([6.9, 6.9, 6.8, 5.0]) == 1.0      # 6.75-7.00, same pay
    assert rules.defence_modifier([7.5, 7.0, 7.0, 5.0]) == 2.0      # >= 7
    assert rules.defence_modifier([5.9, 5.9, 5.9, 5.9]) == 0.0      # < 6 pays nothing


def test_defence_modifier_needs_four_fielded_and_reads_the_best_three():
    """«Si applica schierando almeno 4 difensori. Si calcola la media voto sui migliori 3.»

    So the fourth defender is an OPTION and not a contributor: his vote is the one discarded. Which is
    also why the R-Factor decides that purchase instead - there his 5.5 costs half a point.
    """
    assert rules.defence_modifier([7.0, 7.0, 7.0]) == 0.0           # three is not enough
    with_scrub = rules.defence_modifier([7.0, 7.0, 7.0, 4.0])
    assert with_scrub == 2.0                                        # the 4.0 is dropped
    assert rules.defence_modifier([7.0, 7.0, 7.0, 4.0, 4.0]) == with_scrub


def test_the_deputy_vote_is_worth_less_for_a_keeper():
    """«4 per i calciatori di movimento e 3 per i portieri.»"""
    assert rules.deputy_value("P") == 3.0
    for role in ("D", "C", "A"):
        assert rules.deputy_value(role) == 4.0


# ----------------------------------------------------------------------------- the invariants

def _pool(count: int = 60) -> list[dict]:
    """A synthetic listone: enough men per role for one table, prices spread over the whole range."""
    men = []
    for role, slots in rules.SLOTS.items():
        for i in range(slots * rules.TEAMS + 5):
            men.append({"id": len(men) + 1, "name": f"{role}{i}", "slot": role.lower(),
                        "roles": [role.lower()], "price": float(max(1, 40 - i)),
                        "fm_pred": 6.0, "pv_pred": 30.0, "surplus": float(max(0, 30 - i))})
    return men


def _table() -> list[Team]:
    return [Team(f"{name}#{i}", name, PROFILES[name])
            for name, count in (("P1a no plan, expert", 2), ("P1b no plan, novice", 2),
                                ("P2 defence", 1), ("P3 balanced", 3), ("P4 top striker", 2))
            for i in range(count)]


def test_nobody_overspends_and_everybody_can_close_the_squad():
    """The two things an auction may never do, and the second is the one that bites at the end.

    A participant must always be able to fill the slots that remain at one credit each - which is the
    `tetto effettivo` of the auction panel, and the reason a ceiling is never the whole purse.
    """
    pool = _pool()
    for man in pool:
        man["price"] *= to_credits(pool)
    teams = _table()
    auction(pool, teams)
    for team in teams:
        spent = sum(m["paid"] for role in team.men for m in team.men[role])
        assert spent <= rules.BUDGET, f"{team.name} spent {spent}"
        assert team.left >= 0
        assert team.left >= team.slots_left(), "cannot fill the remaining slots at one credit each"


def test_no_bid_ever_passes_the_mental_threshold():
    """«La soglia mentale dei 500 difficilmente si supera» - declared, so it is a hard cap.

    Without it the second-price mechanism took the best striker to 747 credits, which the operator
    recognised as wrong. It is an absolute cap and not a multiple of the ask price.
    """
    pool = _pool()
    for man in pool:
        man["price"] *= to_credits(pool)
    teams = _table()
    auction(pool, teams)
    cap = rules.BUDGET * MENTAL_CAP_SHARE
    for team in teams:
        for role in team.men:
            for man in team.men[role]:
                assert man["paid"] <= cap, f"{man['name']} went for {man['paid']}"


def test_a_squad_never_exceeds_its_slots():
    pool = _pool()
    teams = _table()
    auction(pool, teams)
    for team in teams:
        for role, slots in rules.SLOTS.items():
            assert len(team.men[role]) <= slots


def test_the_credit_conversion_obeys_conservation():
    """The men a table rosters must add up to what the table can spend - it is a law, not a fit.

    Checked as the sum over the dearest `teams x slots` of each role, which is the population that
    actually gets bought: spreading the same money over everybody quoted is the defect this cures.
    """
    pool = _pool()
    factor = to_credits(pool)
    total = 0.0
    for role, slots in rules.SLOTS.items():
        prices = sorted((m["price"] * factor for m in pool if m["slot"].upper() == role), reverse=True)
        total += sum(prices[: slots * rules.TEAMS])
    assert total == pytest.approx(rules.BUDGET * rules.TEAMS, rel=1e-6)


def test_the_engine_rate_spends_the_whole_purse_on_the_men_it_wants():
    """A ceiling proportional to surplus, calibrated so those 25 men cost exactly one budget.

    The first version used the shadow price of a credit (7.2 credits a point) divided by ten, and the
    arm finished the auction with 849 credits unspent. This test is what that mistake bought.
    """
    pool = _pool()
    rate = engine_rate(pool)
    wanted = 0.0
    for role, slots in rules.SLOTS.items():
        best = sorted((m["surplus"] for m in pool if m["slot"].upper() == role), reverse=True)[:slots]
        wanted += sum(best) * rate
    assert wanted == pytest.approx(rules.BUDGET, rel=1e-6)


# ----------------------------------------------------------------------------- coverage and ceilings

def _man(role: str, pv: float, surplus: float = 10.0, price: float = 20.0, ident: int = 1) -> dict:
    return {"id": ident, "name": f"{role}{ident}", "slot": role.lower(), "roles": [role.lower()],
            "price": price, "pv_pred": pv, "fm_pred": 6.0, "surplus": surplus}


def test_coverage_counts_SHARES_and_not_heads():
    """Four defenders who play half the matches cover TWO places, not four.

    This is the whole reason the ladder is applied to expected shares here: counting heads would call a
    department covered while it leaves a hole every other matchday, and a hole costs the place plus both
    modifiers.
    """
    team = Team("t", "P3 balanced", PROFILES["P3 balanced"])
    for i in range(4):
        team.men["D"].append(_man("D", 19.0, ident=i + 1))       # 19 of 38 = half a season each
    assert covered_places(team, "D", 38) == pytest.approx(2.0)
    assert coverage_need(team, "D", 38) == 1.0                   # still short of its four places


def test_the_ladder_steps_down_only_once_the_places_are_covered():
    team = Team("t", "P3 balanced", PROFILES["P3 balanced"])
    assert coverage_need(team, "C", 38) == 1.0                   # empty: full weight
    for i in range(3):
        team.men["C"].append(_man("C", 38.0, ident=i + 1))       # three men who never miss = 3 places
    assert coverage_need(team, "C", 38) == QUOTA_DEPTH           # covered, still wants depth
    for i in range(3):
        team.men["C"].append(_man("C", 38.0, ident=i + 10))      # six of them = twice the places
    assert coverage_need(team, "C", 38) == DEPTH_WEIGHT


def test_cover_value_is_capped_by_the_deficit_and_never_buys_a_fifth_striker():
    """A man covers a hole only while there IS one - otherwise this term would pay for depth twice.

    The saving is what makes the engine arm buy availability at all: with the surplus alone it left 36
    holes a season and finished last of eleven. With it, 8.
    """
    empty = Team("t", "P3 balanced", PROFILES["P3 balanced"])
    starter = _man("A", 38.0)
    alone = cover_value(starter, empty, 38)
    assert alone == pytest.approx(38 * HOLE_COST)                # one whole place, all season
    full = Team("t2", "P3 balanced", PROFILES["P3 balanced"])
    for i in range(3):
        full.men["A"].append(_man("A", 38.0, ident=i + 1))       # the three places are covered
    assert cover_value(starter, full, 38) == 0.0
    # and a man who plays half the season covers half a place, never a whole one
    assert cover_value(_man("A", 19.0), empty, 38) == pytest.approx(19 * HOLE_COST)


def test_a_man_with_no_forecast_covers_nothing_rather_than_everything():
    """"Vuoto = ignoto, mai zero" cuts both ways: unknown availability may not be READ as full."""
    team = Team("t", "P3 balanced", PROFILES["P3 balanced"])
    unknown = {"id": 9, "name": "x", "slot": "d", "roles": ["d"], "price": 5.0}
    assert cover_value(unknown, team, 38) == 0.0
    team.men["D"].append(unknown)
    assert covered_places(team, "D", 38) == 0.0


def test_the_role_ceiling_is_dynamic_and_urgency_lifts_it():
    """A ceiling per department, not one number for the whole squad - and higher while a place is empty.

    The comparison holds SPEND and SLOTS fixed and moves only the coverage: three strikers who never
    miss a match against three who play five games each. Both squads have spent the same and have the
    same slots left, so the only thing that can move the ceiling is whether the places are filled -
    which is what `URGENCY` is for. Comparing a full department with an empty one would measure the
    division by the remaining slots instead, and that was the first version of this test.
    """
    pool = _pool()
    shares = role_shares(pool)

    def squad(pv: float) -> Team:
        team = Team("e", "ENGINE", None)
        team.shares, team.matchdays = shares, 38
        team.men["A"] = [dict(_man("A", pv, ident=i + 1), paid=30) for i in range(3)]
        return team

    covered, uncovered = squad(38.0), squad(5.0)
    assert covered_places(covered, "A", 38) == pytest.approx(3.0)
    assert covered_places(uncovered, "A", 38) < rules.FIELDED["A"]
    assert uncovered.role_cap("A") == pytest.approx(covered.role_cap("A") * URGENCY, rel=0.02)


def test_every_department_gets_its_own_ceiling():
    """A flat share of the budget was wrong in both directions: 150 credits is a ceiling no keeper ever
    reaches and one that binds on the striker a shape needs."""
    pool = _pool()
    shares = role_shares(pool)
    caps = {}
    for role in ("P", "D", "C", "A"):
        team = Team(f"e{role}", "ENGINE", None)
        team.shares, team.matchdays = shares, 38
        caps[role] = team.role_cap(role)
    assert len(set(caps.values())) > 1, caps
    # and the shares themselves must add up to the whole budget, or a department is being starved
    assert sum(shares.values()) == pytest.approx(1.0)


# ----------------------------------------------------------------------------- the championship

def test_the_goal_ladder_is_the_declared_one():
    """«66 fantapunti sono un gol, e ogni 6 in piu' un altro» - and below 66 nothing.

    A STAIRCASE, so the test pins the steps and not a formula: the point of writing it down is that 65.9
    and 60.0 are the same result, which is what lets a table disagree with a ranking by total points.
    """
    assert rules.goals(0.0) == 0
    assert rules.goals(65.9) == 0
    assert rules.goals(rules.GOAL_FLOOR) == 1
    assert rules.goals(rules.GOAL_FLOOR + rules.GOAL_STEP - 0.1) == 1
    assert rules.goals(rules.GOAL_FLOOR + rules.GOAL_STEP) == 2
    assert rules.goals(rules.GOAL_FLOOR + 4 * rules.GOAL_STEP) == 5


def test_the_calendar_is_a_real_round_robin():
    """Everybody meets everybody once per leg, nobody plays twice on a matchday.

    A calendar is arithmetic, so it is checked rather than trusted: a rotation that repeats a pairing
    would hand somebody four matches against the weakest participant and the table would be a statement
    about the fixture list.
    """
    letters = tuple(letter for letter, _ in LEAGUE_TABLE)
    leg = round_robin(letters)
    assert len(leg) == len(letters) - 1
    assert all(len(day) == len(letters) // 2 for day in leg)
    pairs = Counter(frozenset(pair) for day in leg for pair in day)
    assert len(pairs) == len(letters) * (len(letters) - 1) // 2
    assert set(pairs.values()) == {1}
    for day in leg:
        assert len({side for pair in day for side in pair}) == len(letters)


def test_two_andata_and_two_ritorno_meet_four_times_with_the_sides_even():
    """«2 andata e 2 ritorno»: 36 matchdays, four meetings per pair, eighteen of each side."""
    letters = tuple(letter for letter, _ in LEAGUE_TABLE)
    calendar = fixtures(letters)
    assert len(calendar) == LEGS * (len(letters) - 1) == 36
    assert set(Counter(frozenset(p) for day in calendar for p in day).values()) == {LEGS}
    home = Counter(pair[0] for day in calendar for pair in day)
    assert set(home.values()) == {LEGS * (len(letters) - 1) // 2}


def test_the_standings_settle_a_tie_the_way_the_league_declares():
    """Points, then goal difference, then goals scored, then the season's total fantapunti."""
    rows = [
        {"letter": "X", "table_points": 50, "goals_for": 40, "goals_against": 30, "points": 2000.0},
        {"letter": "Y", "table_points": 50, "goals_for": 45, "goals_against": 35, "points": 2000.0},
        {"letter": "Z", "table_points": 50, "goals_for": 40, "goals_against": 30, "points": 2500.0},
        {"letter": "W", "table_points": 51, "goals_for": 10, "goals_against": 99, "points": 100.0},
    ]
    # W on points alone; then Y, whose goal difference ties and whose GOALS are more; then Z over X
    # on the season total, which is the last word and not the first.
    assert [row["letter"] for row in standings(rows)] == ["W", "Y", "Z", "X"]


def test_the_operators_table_is_ten_participants_of_declared_profiles():
    """His own dictation of 01/09/2026: A engine, B and C for the top striker, D E L balanced, F the
    expert with no plan, G and H the novices, I the defence."""
    assert len(LEAGUE_TABLE) == rules.TEAMS
    assert dict(LEAGUE_TABLE)["A"] == "ENGINE"
    assert Counter(profile for _letter, profile in LEAGUE_TABLE) == Counter({
        "ENGINE": 1, "P4 top striker": 2, "P3 balanced": 3,
        "P1a no plan, expert": 1, "P1b no plan, novice": 2, "P2 defence": 1})
    for _letter, profile in LEAGUE_TABLE:
        assert profile == "ENGINE" or profile in PROFILES
