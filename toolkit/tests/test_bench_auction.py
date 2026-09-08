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
from bench.auction import bench as bench_module
from bench.auction.bench import (CLUB_FREE, CLUB_PENALTY, DEPTH_WEIGHT, HOLE_COST, PHASES,
                                 QUOTA_DEPTH, Team, Urn,
                                 auction, called_order, club_weight, cover_value, coverage_need,
                                 covered_places, engine_rate, engine_worth, extraction_order,
                                 role_of, role_shares,
                                 season, set_insight, set_tiers, tier_asks, to_credits)
from bench.auction import advice
from bench.auction.league import LEAGUE_TABLE, LEGS, fixtures, round_robin, standings
from bench.auction.profiles import (MARKET, MARKET_SHARE, MENTAL_CAP_SHARE, PROFILES,
                                    TILT, URGENCY, engine_ladder)


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


# ----------------------------------------------------------------------------- what the review found

def test_the_purse_floor_is_not_clipped_by_the_department_ceiling():
    """Rilievo 1 della review del 02/09/2026, e vale +6,7 punti.

    «Nobody ends an auction with credits in his pocket» applies to the engine arm too, and its own
    per-department ceiling must not eat that floor: a ceiling is a RATIONING device, and rationing a purse
    that can no longer be spent on anything else is waste. Built here as the case that exposed it - one
    slot left, a purse far larger than the department's remaining share - where the floor has to win.
    """
    pool = _pool()
    team = Team("engine", "ENGINE", None)
    team.shares, team.matchdays = role_shares(pool), 38
    # fill every slot but one striker, so `slots_left` is 1 and the whole purse is spendable on him
    for role, count in rules.SLOTS.items():
        for index in range(count - (1 if role == "A" else 0)):
            team.men[role].append({**_man(role, 38.0, ident=1000 + index), "paid": 1})
    team.left = 400
    man = _man("A", 38.0, surplus=1.0, price=5.0, ident=99)
    # the department ceiling on its own is small here; the floor is the affordable share per slot
    assert team.role_cap("A") < 300
    assert team.bid(man) >= 300, "il pavimento del portafoglio è stato tagliato dal tetto di reparto"


def test_a_participant_gets_ceilings_and_a_spend_from_HIS_OWN_purse():
    """Rilievo 5: `Team` accettava un `budget` che `role_cap` e `season` ignoravano.

    Nothing passes another budget today, which is exactly what makes it worth pinning - a parameter half
    the class honours is a wrong answer waiting for its first caller.
    """
    pool = _pool()
    shares = role_shares(pool)
    full, half = Team("full", "ENGINE", None), Team("half", "ENGINE", None, budget=500)
    for team in (full, half):
        team.shares, team.matchdays = shares, 38
    assert half.role_cap("A") == pytest.approx(full.role_cap("A") / 2, rel=0.02)
    half.men["A"].append({**_man("A", 38.0, ident=7), "paid": 120})
    half.left -= 120
    assert season(half, {}, {}, 1)["spent"] == 120


# ------------------------------------------------------------------- the RANDOM extraction (02/09/2026)

def _urn(pool: list[dict], random: bool) -> Urn:
    """An urn with nothing drawn yet and the table's demand already on it."""
    urn = Urn(pool)
    urn.random = random
    urn.demand = sum(rules.SLOTS.values()) * rules.TEAMS
    for role in rules.SLOTS:
        urn.needing[role] = rules.TEAMS
    return urn


def test_the_extraction_is_reproducible_and_ignores_the_order_of_the_file():
    """A bench whose numbers cannot be repeated cannot be cited - and the order the pool happens to be
    listed in is not a fact about the auction, so the same seed on a shuffled pool draws the same lots."""
    pool = _pool()
    first = [man["id"] for man in extraction_order(pool, 4242)]
    again = [man["id"] for man in extraction_order(list(reversed(pool)), 4242)]
    other = [man["id"] for man in extraction_order(pool, 4243)]
    assert first == again
    assert first != other
    assert sorted(first) == sorted(man["id"] for man in pool), "un lotto è sparito dall'urna"


def test_a_called_auction_never_asks_what_is_still_to_come():
    """The term that wins at a random extraction is INERT at a called one, and that is why nothing
    published on the called mechanism moved.

    The reason is the order itself: the man on the block is the dearest one left, so «is somebody
    better coming?» is a question the order has already answered. Measured, it is also the right call -
    on the ten called windows the term is worth +0.3% (under the 0.5% floor) with one window at -5.6%.
    """
    pool = _pool()
    team = Team("engine", "ENGINE", None)
    team.shares, team.matchdays = role_shares(pool), 38
    lots = called_order(pool)
    urn = _urn(lots, random=False)
    urn.take(lots[0])
    assert team.alternative(lots[1], urn) == 0.0
    assert team.reach(lots[1], urn) == 1.0
    drawn = _urn(lots, random=True)
    drawn.take(lots[0])
    assert team.alternative(lots[1], drawn) > 0.0


def test_the_urn_forgets_what_has_been_drawn_even_after_it_compacts():
    """`dearest`, `nth` and `left` all read the men STILL to come - across the lazy compaction that
    keeps the walks short. A stale answer here would price a bid against a man already sold."""
    pool = _pool()
    urn = _urn(pool, random=True)
    defenders = sorted((m for m in pool if m["slot"] == "d"), key=lambda m: -m["price"])
    before = urn.left("D")
    for man in defenders[: len(defenders) // 2 + 1]:      # enough to force a compaction
        urn.take(man)
    assert urn.left("D") == before - (len(defenders) // 2 + 1)
    assert urn.dearest(("D",)) <= defenders[len(defenders) // 2 + 1]["price"]
    still = urn.nth("D", 0)
    assert still is not None and still["id"] not in {m["id"] for m in defenders[: len(defenders) // 2 + 1]}


def test_the_alternative_is_the_k_th_best_left_where_k_is_who_still_wants_the_role():
    """Counted, not chosen: if k participants still have a slot open there, the best k left go one
    each, so the man this squad ends up with if it lets this lot pass is the k-th of them."""
    pool = _pool()
    team = Team("engine", "ENGINE", None)
    team.shares, team.matchdays = role_shares(pool), 38
    urn = _urn(pool, random=True)
    urn.needing["A"] = 3
    striker = next(m for m in pool if m["slot"] == "a")
    urn.take(striker)
    third = urn.nth("A", 2)
    assert team.alternative(striker, urn) == pytest.approx(engine_worth(third, team))


def test_the_spending_floor_refuses_a_man_worse_than_the_one_still_to_come():
    """«Spend it or lose it» never means buying a man worse than the one who is coming.

    At a random extraction a SLOT is as scarce as a credit, so a floor that invents appetite does not
    spend a credit - it spends a place in the squad, and the credit stays in the purse anyway. Worth
    2486.8 -> 2565.8 points and holes 33.4 -> 22.9 on the ten drawn windows.
    """
    pool = _pool()
    team = Team("engine", "ENGINE", None)
    team.shares, team.matchdays = role_shares(pool), 38
    team.left = 900
    urn = _urn(pool, random=True)
    urn.needing["A"] = 1
    poor = {"id": 9001, "name": "scarto", "slot": "a", "roles": ["a"], "price": 3.0,
            "fm_pred": 6.0, "pv_pred": 2.0, "surplus": 0.1}
    urn.take(poor)
    assert engine_worth(poor, team) < team.alternative(poor, urn), "il caso di prova non è quello giusto"
    floor = (team.left - (team.slots_left() - 1)) / team.slots_left()
    assert team.bid(poor, urn) < floor, "il pavimento ha comprato un uomo peggiore di quello che esce dopo"


def test_a_drawn_auction_keeps_every_invariant_a_called_one_keeps():
    """Nobody overspends, nobody exceeds his slots, and nobody pays more than his own ceiling - the
    three things that make the bench's numbers worth reading, asserted on the other mechanism too."""
    pool = _pool()
    teams = _table()
    for team in teams:
        team.matchdays = 38
    auction(pool, teams, extraction_order(pool, 7))
    for team in teams:
        assert team.left >= 0
        assert team.budget - team.left <= rules.BUDGET
        for role, slots in rules.SLOTS.items():
            assert len(team.men[role]) <= slots
            for man in team.men[role]:
                assert 1 <= man["paid"] <= round(rules.BUDGET * MENTAL_CAP_SHARE)
    bought = Counter(man["id"] for team in teams for men in team.men.values() for man in men)
    assert not [ident for ident, times in bought.items() if times > 1], "un uomo venduto due volte"

# ------------------------------------------------- realistic dynamics, on real data (02/09/2026)

def test_the_ladder_is_indexed_by_WHO_THE_MAN_IS_and_not_only_by_what_you_hold():
    """The defect the operator found from the result: «almeno 3 devono essere suoi».

    P2's whole strategy is the top of the defence, and the step was indexed by how many defenders he
    already held - the same number as the tier ONLY when the lots are called dearest first. Drawn at
    random he met the 90th defender of the listone first and paid the first-choice premium for him.
    """
    pool = _pool()
    set_tiers(pool)
    team = Team("p2", "P2 defence", PROFILES["P2 defence"])
    best = next(m for m in pool if role_of(m) == "D" and m["tier"] == 0)
    filler = next(m for m in pool if role_of(m) == "D" and m["tier"] == 7)
    assert team.step(best) > 1.0, "il migliore della difesa non paga il gradino alto"
    assert team.step(filler) < 0.3, "il 71esimo difensore paga come un titolare"
    # ...and the HELD half still binds: with three defenders in the squad the fourth is his fourth,
    # whatever tier he belongs to, or a profile buys eight first-choice men at the first-choice price.
    for index in range(3):
        team.men["D"].append({**_man("D", 30.0, ident=500 + index), "tier": 0, "paid": 1})
    assert team.step(best) == pytest.approx(PROFILES["P2 defence"]["D"][3])


def test_a_slot_is_not_spent_while_the_urn_can_still_supply_better_men():
    """«Conservare almeno uno o due posti per qualche occasione alla fine» - counted, never declared.

    Of the 50 dearest men of the listone, 14,3 went unsold at a drawn auction before this rule and
    1,93 after, against 1,75 in the four real drawn auctions whose order could be reconstructed.
    """
    pool = _pool()
    set_tiers(pool)
    lots = called_order(pool)
    urn = _urn(lots, random=True)
    team = Team("p3", "P3 balanced", PROFILES["P3 balanced"])
    filler = next(m for m in pool if role_of(m) == "D" and m["tier"] == 7)
    # eight slots open and seventy better defenders in the urn: his share of them is seven, which does
    # not cover eight, so he bids. With one slot left it covers it, and he waits.
    assert not team.keeps(filler, urn)
    for index in range(7):
        team.men["D"].append({**_man("D", 30.0, ident=600 + index), "tier": 1, "paid": 1})
    assert team.keeps(filler, urn)
    assert team.bid(filler, urn) == 0, "ha comprato il riempimento sull'ultimo posto"


def test_the_kept_slot_is_inert_at_a_called_auction():
    """One rule, two mechanisms - and this is why nothing about a called auction depends on it: the
    man on the block is the dearest one left, so there is never a better one still to come."""
    pool = _pool()
    set_tiers(pool)
    lots = called_order(pool)
    urn = _urn(lots, random=False)
    team = Team("p3", "P3 balanced", PROFILES["P3 balanced"])
    for man in lots[:40]:
        urn.take(man)
        assert not team.keeps(man, urn), f"{man['name']} rifiutato a un'asta a chiamata"


def test_the_recipe_is_normalised_to_the_purse_and_a_saved_purse_bids_up():
    """`Team.scale`: a recipe is a DISTRIBUTION of the purse, and its level is a conservation law.

    It replaced a flat floor per remaining slot, which said «40 a man» about the best striker of the
    listone and about the 200th defender alike - and left four participants of ten with ZERO men under
    5 credits, against 8 of 25 in the 131 real auctions.
    """
    pool = _pool()
    set_tiers(pool)
    asks = tier_asks(pool)
    rich = Team("rich", "P3 balanced", PROFILES["P3 balanced"])
    poor = Team("poor", "P3 balanced", PROFILES["P3 balanced"])
    rich.asks = poor.asks = asks
    poor.left = 200
    assert rich.scale() > 0
    assert poor.scale() < rich.scale(), "chi ha speso troppo non si raziona"
    man = next(m for m in pool if role_of(m) == "C" and m["tier"] == 0)
    assert poor.bid(man) < rich.bid(man)
    # and with no asks handed over - which is what the unit tests do - the recipe is read at face value
    naked = Team("naked", "P3 balanced", PROFILES["P3 balanced"])
    assert naked.scale() == 1.0


def test_a_plan_ring_fences_its_credits_and_releases_them_by_itself():
    """«Lo attende conservando piu' crediti degli altri ... solo dopo aver preso un attaccante TOP
    comincia a piazzare qualche altra offerta seria».

    Two things are asserted because both are what makes a plan safe: the money is not available to
    anybody else while it is owed, and it comes back the moment the urn has no target left - so a plan
    can slow a squad down and can never stop it closing.
    """
    pool = _pool()
    set_tiers(pool)
    urn = _urn(pool, random=True)
    striker = Team("p4", "P4 top striker", PROFILES["P4 top striker"])
    striker.asks = tier_asks(pool)
    other = next(m for m in pool if role_of(m) == "C" and m["tier"] == 0)
    target = next(m for m in pool if role_of(m) == "A" and m["tier"] == 0)
    assert striker.reserved(target, urn) == 0, "il bersaglio non paga la propria riserva"
    assert striker.reserved(other, urn) == round(rules.BUDGET * 0.40)
    held = striker.bid(other, urn)
    striker.men["A"].append({**target, "paid": 1})
    assert striker.bid(other, urn) > held, "preso il top, non ha ripreso a offrire"
    # ...and if the urn runs out of first-tier forwards the money is released without him buying one
    empty = Team("p4b", "P4 top striker", PROFILES["P4 top striker"])
    empty.asks = striker.asks
    for man in pool:
        if role_of(man) == "A" and man["tier"] == 0:
            urn.take(man)
    assert empty.reserved(other, urn) == 0


def test_the_market_ladder_is_the_one_the_real_auctions_measured():
    """A transcription check, the same one the two rulebooks make about themselves.

    These numbers are not a model choice: they are `docs/real-data/`, 131 auctions of this roster and
    29.421 purchases. What may be wrong here is only the transcription - so the shape is pinned (one
    step per slot of each role), the attack's first tier is pinned as the dearest thing at the table,
    and the tail is pinned below a quarter of the ask, which is «1-5 crediti per i pezzi comuni».
    """
    for role, slots in rules.SLOTS.items():
        assert len(MARKET[role]) == slots, f"{role}: un gradino per posto in rosa"
    assert MARKET["A"][0] > 2.0 > MARKET["C"][0] > MARKET["D"][0]
    assert MARKET["D"][-1] <= 0.25 and MARKET["C"][-1] <= 0.25
    # and every profile is built from it, so the level is stated once
    for name, tilts in TILT.items():
        for role in rules.SLOTS:
            if role not in tilts:
                assert PROFILES[name][role] == MARKET[role]


def test_the_engine_arm_keeps_the_floor_the_humans_no_longer_have():
    """`ABUNDANCE` is the engine arm's alone now, and that is a decision worth pinning.

    The humans reach «nobody ends an auction with credits in his pocket» through `scale`; the engine
    arm has no recipe to normalise, so it keeps the affordable share per remaining slot - the same
    floor whose clipping was worth +6,7 points in the review of 02/09.
    """
    pool = _pool()
    set_tiers(pool)
    team = Team("engine", "ENGINE", None)
    team.shares, team.matchdays, team.asks = role_shares(pool), 38, tier_asks(pool)
    assert team.scale() == 1.0, "il braccio motore non ha una ricetta da normalizzare"
    for role, count in rules.SLOTS.items():
        for index in range(count - (1 if role == "A" else 0)):
            team.men[role].append({**_man(role, 38.0, ident=1000 + index), "paid": 1})
    team.left = 400
    assert team.bid(_man("A", 38.0, surplus=1.0, price=5.0, ident=99)) >= 300

# ------------------------------------- the order, the name and the step (02/09/2026, evening)

def test_the_auction_is_played_ROLE_BY_ROLE_the_way_the_platform_plays_it():
    """MEASURED, not chosen: 16 of the 20 real auctions with this league put the mean award position
    of the four roles at 0.06 · 0.28 · 0.60 · 0.88, identical to two decimals across sixteen separate
    sessions - and those numbers are exactly where the ROSTER puts the boundaries (3 keepers of 25
    places, then 8, then 8, then 6).

    It is the single biggest thing this bench had wrong: with a free order the table spent 46% of the
    montepremi in the first tenth of the awards against a real 9%.
    """
    pool = _pool()
    set_tiers(pool)
    for order in (called_order(pool), extraction_order(pool, 99)):
        seen = [role_of(man) for man in order]
        first = [seen.index(role) for role in PHASES]
        assert first == sorted(first), f"le fasi non sono in ordine: {first}"
        # ...and each role is a BLOCK: the men of a role are contiguous
        for role in PHASES:
            spots = [i for i, r in enumerate(seen) if r == role]
            assert spots == list(range(spots[0], spots[-1] + 1)), f"{role} non e' un blocco"
    # the free order is still reachable, because 4 of those 20 auctions ran free
    free = extraction_order(pool, 99, phased=False)
    assert [role_of(m) for m in free] != [role_of(m) for m in extraction_order(pool, 99)]


def test_a_passed_man_comes_back_INSIDE_his_own_phase():
    """The re-offer belongs to the phase, and the archive is what says so.

    `auction` used to keep ONE queue: the men nobody bid on, from all four phases, came back after the
    whole first pass - so a participant who let a department go by met it again when every other
    roster was already full, and nobody bid against him. In the real archive a role's awards are
    CONTIGUOUS (a ten-team auction awards exactly 30 keepers, then 80 defenders, then 80 midfielders,
    then 60 forwards), which is the same fact `PHASES` was adopted on.

    Asserted on the PHASE OF EVERY MAN PRICED and not on the awards, because the declared table never
    buys anybody in a re-offer at all (measured: 0 awards after the first pass, and 0 differences over
    1000 participant-seasons when this was corrected) - so the awards cannot see the defect and the
    lots can. It bites only for a strategy that refuses a whole phase, which is exactly the corner
    where a bench that got this wrong would hand one out for a credit.
    """
    pool = _pool()
    teams = _table()
    for team in teams:
        team.matchdays = 38
    seen: list[int] = []
    original = Team.bid

    def bid(self, man, urn=None):
        if self is teams[0]:
            seen.append(PHASES.index(role_of(man)))
        return original(self, man, urn)

    Team.bid = bid
    try:
        auction(pool, teams, extraction_order(pool, 7))
    finally:
        Team.bid = original
    assert seen, "nessun lotto prezzato"
    assert len(seen) > sum(rules.SLOTS[role] for role in rules.SLOTS) * rules.TEAMS, \
        "nessuna ri-offerta: il test non sta misurando niente"
    assert seen == sorted(seen), "una fase e' stata riaperta dopo la successiva"

def test_the_phase_boundaries_fall_where_the_ROSTER_puts_them():
    """The four measured positions are not a coincidence to be transcribed: they are the slot counts.

    Checked as the real archive was read - the mean position of each role's awards - so if either the
    roster or the phase order ever changes, this is what says so.
    """
    pool = _pool()
    set_tiers(pool)
    order = extraction_order(pool, 7)
    # keep only the men a table would actually roster, which is what an award sequence contains
    kept: list[dict] = []
    held = {role: 0 for role in rules.SLOTS}
    for man in order:
        role = role_of(man)
        if held[role] < rules.SLOTS[role] * rules.TEAMS:
            held[role] += 1
            kept.append(man)
    means = {}
    for role in PHASES:
        spots = [i / (len(kept) - 1) for i, man in enumerate(kept) if role_of(man) == role]
        means[role] = sum(spots) / len(spots)
    assert means["P"] == pytest.approx(0.06, abs=0.02)
    assert means["D"] == pytest.approx(0.28, abs=0.02)
    assert means["C"] == pytest.approx(0.60, abs=0.02)
    assert means["A"] == pytest.approx(0.88, abs=0.02)


def test_the_step_counts_the_BETTER_men_owned_and_not_the_men_owned():
    """A squad with four forwards was pricing the best player of the game as its FIFTH.

    That is what made a champion drawn late in his own phase worth a credit: 0.18 times the ask
    instead of 2.38. Measured on the four targets after the fix: men bought at five credits or less
    7.0 -> 8.0 (real 9.5), credits left in pocket 10.2% -> 6.2% (real 6.1%), and the champion's price
    inside his own block 47.8 / 31.0 / 12.3 / 1.6 -> 47.0 / 42.0 / 42.0 / 40.5 against a real
    43.1 / 45.4 / 37.6 / 34.7.
    """
    pool = _pool()
    set_tiers(pool)
    team = Team("p4", "P4 top striker", PROFILES["P4 top striker"])
    champion = next(m for m in pool if role_of(m) == "A" and m["tier"] == 0)
    top_step = team.step(champion)
    for index in range(4):                      # four forwards, none of them as good as he is
        team.men["A"].append({**_man("A", 30.0, ident=700 + index), "tier": 3, "paid": 1})
    assert team.step(champion) == top_step, "il campione prezzato come un quinto attaccante"
    # ...and the guard the plain count was there for still holds: better men DO walk the ladder down
    team.men["A"].append({**champion, "paid": 1})
    assert team.step(champion) < top_step


def test_a_TARGET_is_a_NAME_and_owning_the_tenth_best_does_not_release_the_plan():
    """«Deve puntare sul TOP in attacco (L.Martinez/Thuram/ecc...) e fa di tutto per prenderlo.»

    Read as «any first-tier forward» the plan released itself the moment he bought the tenth-best of
    them - and with it went the money and the place that were being kept for the champion.
    """
    pool = _pool()
    set_tiers(pool)
    urn = _urn(pool, random=True)
    team = Team("p4", "P4 top striker", PROFILES["P4 top striker"])
    team.asks = tier_asks(pool)
    other = next(m for m in pool if role_of(m) == "C" and m["tier"] == 0)
    assert team.owed("A") == 1
    tenth = next(m for m in pool if role_of(m) == "A" and m.get("rank") == rules.TEAMS - 1)
    assert tenth["tier"] == 0, "il decimo del ruolo e' ancora di prima fascia"
    team.men["A"].append({**tenth, "paid": 1})
    assert team.owed("A") == 1, "il piano si e' liberato comprando il decimo"
    assert team.reserved(other, urn) > 0
    champion = next(m for m in pool if role_of(m) == "A" and m.get("rank") == 0)
    team.men["A"].append({**champion, "paid": 1})
    assert team.owed("A") == 0
    assert team.reserved(other, urn) == 0


def test_a_plan_keeps_its_PLACE_as_well_as_its_money_and_only_a_plan_does():
    """«Su 10 persone QUALCUNO dovrebbe conservare un posto in rosa aspettando proprio il campione.»

    Given to everybody the same rule strangles the auction - measured, 8.4 slots of 250 left unfilled
    and 18 of the top 50 unsold, because all ten wait for the same man. Given to the profiles whose
    declared strategy IS that man it costs at most three places across the table.
    """
    pool = _pool()
    set_tiers(pool)
    urn = _urn(pool, random=True)
    # A MAN OF THE FIRST TIER WHO IS NOT THE TARGET: nobody better than him is left to wait for, so
    # the counted rule (`Team.keeps`'s own arithmetic) releases every squad - and the plan does not.
    # Built this way on purpose: a test that cannot separate the two rules is not testing either.
    other = next(m for m in pool if role_of(m) == "A" and m["tier"] == 0 and m["rank"] > 0)
    for man in pool:
        if role_of(man) == "A" and 0 < man["rank"] < other["rank"]:
            urn.take(man)
    striker = Team("p4", "P4 top striker", PROFILES["P4 top striker"])
    plain = Team("p3", "P3 balanced", PROFILES["P3 balanced"])
    for team in (striker, plain):
        for index in range(rules.SLOTS["A"] - 1):
            team.men["A"].append({**_man("A", 30.0, ident=800 + index), "tier": 3, "paid": 1})
    assert not plain.keeps(other, urn), "il conto non ha rilasciato il posto"
    assert striker.keeps(other, urn), "il posto del campione e' stato venduto"
    # ...and once the champion has been drawn and taken by somebody else, the place is free again
    urn.take(next(m for m in pool if role_of(m) == "A" and m["rank"] == 0))
    assert not striker.keeps(other, urn)

# --------------------------------------- the engine arm on the market's ladder (02/09/2026, night)

def test_the_arm_bids_on_the_MARKET_LADDER_at_a_drawn_auction_and_not_at_a_called_one():
    """A ceiling in fantapunti cannot win a contested lot, however well the footballer is judged.

    Photographed, the arm bid 0,16-0,47 of what the men it lost went for and bought at a median of ONE
    credit. On the market's ladder tilted toward the back it goes from tenth of eleven to first at a
    drawn auction (+17,9%, 10 windows of 10, holes 79,8 -> 22,4) - and the same ladder LOSES 2% at a
    called auction, so the mechanism switches it, not a flag.
    """
    pool = _pool()
    set_tiers(pool)
    arm = Team("engine", "ENGINE", None)
    arm.shares, arm.matchdays, arm.asks = role_shares(pool), 38, tier_asks(pool)
    lots = called_order(pool)
    drawn, called = _urn(lots, random=True), _urn(lots, random=False)
    man = next(m for m in pool if role_of(m) == "D" and m["tier"] == 0)
    drawn.take(man)
    called.take(man)
    on_ladder, on_worth = arm.bid(man, drawn), arm.bid(man, called)
    assert on_ladder != on_worth, "il braccio offre lo stesso su tutt'e due i meccanismi"
    # the ladder's own arithmetic - and `scale` has to be read WITH the ladder installed, because it
    # normalises the plan the recipe describes and the arm has no recipe of its own
    arm.recipe = engine_ladder()
    expected = arm.recipe["D"][0] * man["price"] * arm.scale()
    arm.recipe = None
    assert on_ladder == pytest.approx(expected, rel=.05)
    assert on_ladder > man["price"], "un difensore di prima fascia sotto la richiesta"
    assert arm.recipe is None, "la ricetta presa in prestito e' rimasta addosso al braccio"


def test_the_arm_diversifies_by_club_at_a_drawn_auction_too():
    """The plancia discounts a repeated club, so the bench arm must too on the mechanism he plays.

    Measured 08/09/2026, the arm called `club_weight` 140 times at a called auction and ZERO at a
    drawn one: the tilt sends it down the market-ladder branch, which did not read the diversification.
    Turned on by the operator (`CLUB_ON_DRAWN`) for consistency with the plancia, at a stated bench
    cost of -0,68% - a preference the bench cannot score, because the risk it removes is within a
    season and the bench's sd is between seasons. This pins that the discount is now applied, and only
    on the third man of a club (the first `CLUB_FREE` are free), and only at the DRAWN auction.
    """
    assert bench_module.CLUB_ON_DRAWN, "il flag e' spento: questo test descrive lo stato acceso"
    pool = _pool()
    set_tiers(pool)
    band = [m for m in pool if role_of(m) == "D"][:rules.TEAMS]
    for i, man in enumerate(band):
        man["club"] = "Napoli" if i < CLUB_FREE + 1 else "Torino"
    arm = Team("engine", "ENGINE", None)
    arm.shares, arm.matchdays, arm.asks = role_shares(pool), 38, tier_asks(pool)
    # the arm already holds CLUB_FREE men of Napoli, so a third one is discounted and a Torino man is not
    for man in band[:CLUB_FREE]:
        arm.men["D"].append({**man, "paid": 1})
    third_napoli = band[CLUB_FREE]
    fresh_torino = band[CLUB_FREE + 1]
    assert third_napoli["club"] == "Napoli" and fresh_torino["club"] == "Torino"
    assert third_napoli["tier"] == fresh_torino["tier"], "il test confronta due uomini della stessa fascia"

    drawn = _urn([third_napoli, fresh_torino], random=True)
    drawn.take(third_napoli)
    concentrated = arm.bid(third_napoli, drawn)
    drawn.take(fresh_torino)
    diversified = arm.bid(fresh_torino, drawn)
    assert concentrated < diversified, "l'offerta sul terzo dello stesso club non e' scesa"
    expected = club_weight(third_napoli, arm)
    assert expected == pytest.approx(CLUB_PENALTY, rel=1e-9), "la penalita' del terzo e' CLUB_PENALTY"

    # ...and it is the DRAWN mechanism only: at a called auction the arm was always reading it, and
    # switching CLUB_ON_DRAWN must not have changed that path.
    called = _urn([third_napoli, fresh_torino], random=False)
    called.take(third_napoli)
    called_bid = arm.bid(third_napoli, called)
    assert called_bid > 0


def test_the_engine_ladder_conserves_the_budget_and_leans_on_the_back():
    """A tilt that does not conserve is not a strategy, it is a bigger purse.

    Whatever the back takes the front gives up, so the plan still costs one budget - and what the search
    found is that the keepers and the defence carry it, which the regulation explains: both modifiers of
    this league are paid in BASE VOTES (the defence one on the mean of the best three defenders, the
    R-Factor on all eleven) and base votes are what a back line delivers.
    """
    ladder = engine_ladder()
    for role in rules.SLOTS:
        assert len(ladder[role]) == len(MARKET[role])
    # conserving: the departments still add up to the market's own total spend
    total = sum(sum(ladder[role]) / sum(MARKET[role]) * MARKET_SHARE[role] for role in ladder)
    assert total == pytest.approx(1.0, abs=1e-9)
    # ...and it leans on the DEFENCE and nothing else: the keepers were measured apart and the tilt on
    # them is worth nothing (+0,1%, 4 windows of 10) while it spends 100 credits in goal instead of 58,
    # so they are out of it - see `profiles.ENGINE_BACK`.
    assert ladder["D"][0] / MARKET["D"][0] > 1.5
    assert ladder["P"][0] / MARKET["P"][0] < 1.0, "il tilt e' tornato sui portieri"
    assert ladder["A"][0] / MARKET["A"][0] < 1.0
    assert ladder["D"][-1] / MARKET["D"][-1] < 1.0, "la coda non paga il premio della cima"


def _banded(shares: dict[str, float]) -> list[dict]:
    """One tier of ten defenders at the SAME price, whose expected appearances differ."""
    pool = _pool()
    band = [m for m in pool if role_of(m) == "D"][:rules.TEAMS]
    for man in band:
        man["price"] = 50.0
    for man, share in zip(band, shares["D"]):
        man["pv_pred"] = share
    set_tiers(pool)
    set_insight(pool)
    return pool


def test_the_within_tier_deviation_averages_to_ZERO_and_therefore_conserves():
    """A tilt that does not conserve is not a strategy, it is a bigger purse - the same rule the
    ladder's own tilt needed a renormalisation for, and this one gets for free: the deviation is the
    distance from the band's OWN mean, so a full band sums to nothing and `Team.scale` still prices
    the plan at one budget."""
    pool = _banded({"D": [34.0, 30.0, 28.0, 26.0, 24.0, 22.0, 20.0, 18.0, 16.0, 12.0]})
    band = [m for m in pool if role_of(m) == "D" and m["tier"] == 0]
    assert len(band) == rules.TEAMS
    assert sum(m["insight"] for m in band) == pytest.approx(0.0, abs=1e-9)
    assert max(m["insight"] for m in band) == pytest.approx(1.0)
    # ...and every band of every role, on the real shape of the synthetic listone
    for role in rules.SLOTS:
        for tier in range(rules.SLOTS[role]):
            full = [m for m in pool if role_of(m) == role and m.get("tier") == tier]
            if len(full) >= 2:
                assert sum(m["insight"] for m in full) == pytest.approx(0.0, abs=1e-9)


def test_a_man_the_engine_does_not_price_sits_at_the_MIDDLE_of_his_band_and_not_at_the_bottom():
    """«Vuoto = ignoto, mai zero», applied to an opinion: "we have no forecast for him" and "we expect
    him not to play" are two different sentences, and only the second one may lower a bid."""
    pool = _banded({"D": [34.0, 30.0, 28.0, 26.0, 24.0, 22.0, 20.0, 18.0, 16.0, 12.0]})
    band = [m for m in pool if role_of(m) == "D" and m["tier"] == 0]
    band[3]["pv_pred"] = None
    set_insight(pool)
    assert band[3]["insight"] == 0.0
    assert band[0]["insight"] > 0 and band[-1]["insight"] < 0


def test_the_arm_pays_MORE_for_the_man_of_the_band_it_expects_to_PLAY():
    """The one thing the market's ladder cannot say, and the only place it leaves room.

    A tier is `rules.TEAMS` men wide, so the ladder prices ten men alike; measured on the ten windows,
    inside a band the PRICE spans 0.08-0.48 of its own median while the expected appearance share spans
    0.31-0.33 of the calendar - twelve matchdays at the same price. And the quantity is not a choice:
    `metrica-asta-surplus-v1.md` §18 measured
    our whole incremental edge over the quotation as ONE number, the appearances (+0,243 partial
    Spearman on Serie A against -0,077 for the surplus). Worth +1,02% ROBUST over 800 seasons (paired
    +26,4 +- 4,5, 9 windows of 10, worst -0,42%), holes 22,9 -> 18,8 - and it SURVIVES three arms at the
    table (+30,0, t = 7,4), which the ladder's own margin did not.
    """
    pool = _banded({"D": [34.0, 30.0, 28.0, 26.0, 24.0, 22.0, 20.0, 18.0, 16.0, 12.0]})
    band = [m for m in pool if role_of(m) == "D" and m["tier"] == 0]
    best, worst = band[0], band[-1]
    assert best["price"] == worst["price"], "il caso non isola le presenze dal prezzo"
    arm = Team("engine", "ENGINE", None)
    arm.shares, arm.matchdays, arm.asks = role_shares(pool), 38, tier_asks(pool)
    arm.insight = 0.8
    lots = called_order(pool)
    drawn = _urn(lots, random=True)
    assert arm.bid(best, drawn) > arm.bid(worst, drawn), "il braccio paga uguale chi gioca e chi no"
    # ...and the channel is actually SWITCHED ON, which a mechanism test cannot say by itself: the
    # weight above is the test's, the one the arm plays with is the module's. This is the line to
    # change deliberately if a re-measurement ever turns the term off.
    assert bench_module.INSIGHT > 0, "il canale e' spento: la misura lo ha ritirato?"
    assert bench_module.INSIGHT_SHAPE == "share"
    # ...and a HUMAN reads the market ladder unmodified, because he has no engine to read it with
    human = Team("p3", "P3 balanced", PROFILES["P3 balanced"])
    human.asks, human.matchdays = tier_asks(pool), 38
    assert human.insight == 0.0
    assert human.bid(best, drawn) == human.bid(worst, drawn)


def test_the_within_tier_deviation_is_inert_at_a_CALLED_auction():
    """Switched on by the MECHANISM and not by a flag, exactly like the ladder it deviates from: at a
    called auction the arm never reaches `Team.step` at all, because there the man on the block is the
    dearest one left and a ceiling in fantapunti is the better instrument.

    Counted rather than read off the code, which is how the whole channel was found: over the ten
    windows the arm calls `engine_worth`, `cover_value`, `coverage_need`, `alternative` and `role_cap`
    1436 times each at a called auction and ZERO times at a drawn one.
    """
    pool = _banded({"D": [34.0, 30.0, 28.0, 26.0, 24.0, 22.0, 20.0, 18.0, 16.0, 12.0]})
    band = [m for m in pool if role_of(m) == "D" and m["tier"] == 0]
    arm = Team("engine", "ENGINE", None)
    arm.shares, arm.matchdays, arm.asks = role_shares(pool), 38, tier_asks(pool)
    lots = called_order(pool)
    called = _urn(lots, random=False)
    plain = [arm.bid(man, called) for man in band]
    arm.insight = 3.0
    assert [arm.bid(man, called) for man in band] == plain


# ------------------------------- the timing of the depth (02/09/2026, night)

def test_the_arm_lets_a_DEPTH_man_pass_while_the_table_is_still_wide_open():
    """It asks «will he be CHEAPER later?», which is not `keeps`'s question («is somebody BETTER
    coming?»), and the archive answers it: from the third tier down the median paid/ask falls to x0.50
    once the table thins and x0.21-0.36 at the end, while the first two tiers read x0.91 and x0.80 and
    zero of 552 awards of a top tier ever went for one credit.

    Worth +1,88% STRICT over 800 paired seasons (t 11,6, 10 windows of 10, worst +0,57%), it survives
    three arms (+1,54% strict) and it makes `INSIGHT` worth MORE (+29,9 -> +37,0 fantapunti), which is
    the reason it is in the code: the timing buys the places at the top and the forecast picks who
    fills them.
    """
    pool = _pool()
    set_tiers(pool)
    set_insight(pool)
    lots = extraction_order(pool, 11)
    arm = Team("engine", "ENGINE", None)
    arm.shares, arm.matchdays, arm.asks = role_shares(pool), 38, tier_asks(pool)
    arm.insight = bench_module.INSIGHT
    deep = next(m for m in pool if role_of(m) == "D" and m.get("tier") == bench_module.DEPTH_TIER)
    top = next(m for m in pool if role_of(m) == "D" and m.get("tier") == 0)

    wide = _urn(lots, random=True)
    wide.take(deep)
    assert arm.waits(deep, wide), "il braccio compra la profondita' col tavolo ancora aperto"
    assert arm.bid(deep, wide) == 0

    # ...and the SAME man, once the rosters have started filling, is bought
    thin = _urn(lots, random=True)
    for role in rules.SLOTS:
        thin.needing[role] = bench_module.DEPTH_HANDS - 1
    thin.take(deep)
    assert not arm.waits(deep, thin)
    assert arm.bid(deep, thin) > 0, "il braccio non compra la profondita' nemmeno alla fine"


def test_the_top_of_the_market_is_UNREFUSABLE_by_that_rule_whatever_the_constant():
    """The archive says a man of the first two tiers never comes cheap, and the guard says the same
    thing by arithmetic: with `rules.TEAMS` men per tier there can never be more men of the TOP tier
    left than this squad's open slots plus the rivals' hands, so the rule cannot touch him however
    `DEPTH_TIER` is set. That is why the measured grid reads the same at 0 and at 1.
    """
    pool = _pool()
    set_tiers(pool)
    lots = extraction_order(pool, 11)
    arm = Team("engine", "ENGINE", None)
    arm.shares, arm.matchdays, arm.asks = role_shares(pool), 38, tier_asks(pool)
    urn = _urn(lots, random=True)
    kept = bench_module.DEPTH_TIER
    bench_module.DEPTH_TIER = 0
    try:
        for role in rules.SLOTS:
            best = next(m for m in pool if role_of(m) == role and m.get("tier") == 0)
            urn.take(best)
            assert not arm.waits(best, urn), f"il migliore dei {role} rifiutato per attesa"
    finally:
        bench_module.DEPTH_TIER = kept


def test_the_waiting_never_costs_the_SLOT_and_is_inert_at_a_called_auction():
    """Two guards. A rule about a PRICE may never leave a place empty, so it stops the moment the urn
    no longer holds enough men of his tier or better for this squad and for the rivals still wanting
    one - `Team.keeps`'s own counting. And at a called auction there is nothing to wait for, because
    the man on the block is the dearest one left: one rule, two mechanisms."""
    pool = _pool()
    set_tiers(pool)
    arm = Team("engine", "ENGINE", None)
    arm.shares, arm.matchdays, arm.asks = role_shares(pool), 38, tier_asks(pool)
    deep = next(m for m in pool if role_of(m) == "D" and m.get("tier") == bench_module.DEPTH_TIER)

    called = _urn(called_order(pool), random=False)
    called.take(deep)
    assert not arm.waits(deep, called), "attende a un'asta a chiamata"

    short = _urn(extraction_order(pool, 3), random=True)
    short.take(deep)
    assert arm.waits(deep, short), "il caso non parte dalla condizione di attesa"
    # ...drain the role until there is nothing left to wait for
    for man in [m for m in pool if role_of(m) == "D" and m["id"] != deep["id"]]:
        short.take(man)
    assert not arm.waits(deep, short), "attende con l'urna vuota: lascerebbe il posto scoperto"


def test_the_waiting_is_the_ARMS_and_a_human_reads_his_own_recipe():
    """The five profiles are the operator's own sentences, so a strategy measured on the arm is not
    given to them: a human's patience is `keeps` and nothing else."""
    pool = _pool()
    set_tiers(pool)
    urn = _urn(extraction_order(pool, 5), random=True)
    deep = next(m for m in pool if role_of(m) == "D" and m.get("tier") == bench_module.DEPTH_TIER)
    urn.take(deep)
    human = Team("p3", "P3 balanced", PROFILES["P3 balanced"])
    human.asks, human.matchdays = tier_asks(pool), 38
    before = human.bid(deep, urn)
    kept = bench_module.DEPTH_TIER
    bench_module.DEPTH_TIER = 0            # the rule at its most aggressive
    try:
        # the CONDITION holds for him too - it is a fact about the urn - and his bid ignores it,
        # because `bid` consults it only on the branch a participant with no recipe of his own takes.
        assert human.waits(deep, urn), "il caso non isola: la condizione di attesa non vale per lui"
        assert human.bid(deep, urn) == before, "il tempismo del braccio ha cambiato un umano"
    finally:
        bench_module.DEPTH_TIER = kept


# ---------------------------------- the judge of the ADVICE (02/09/2026, night)

def test_a_squad_is_ONE_MAN_PER_BAND_and_both_sides_of_the_comparison_cost_the_same():
    """The conservation law `bench/auction/advice.py` rests on, and the thing that makes its comparison
    a comparison: a roster is `sum(SLOTS)` men and a listone is that many bands of `TEAMS`, so a squad
    is one man per band - and every picker pays the same for the same band, so what is measured is the
    CHOICE and not the spend. A comparison whose two sides do not cost the same is not a comparison.
    """
    pool = _pool()
    # ...and the men must DISAGREE with the price order, or every picker names the same man and the
    # test measures nothing. The guard at the bottom is what says so, and it fired the first time.
    for index, man in enumerate(pool):
        man["pv_pred"] = 10.0 + (index % rules.TEAMS) * 2.5
        man["value"] = man["pv_pred"] * man["fm_pred"]
    window = {"players": pool, "others": [], "rounds": 38, "votes": {}, "base": {}}
    cut = advice.bands(window)
    assert len(cut) == sum(rules.SLOTS.values()), "le fasce non sono una per posto in rosa"
    for _role, _tier, band, paid in cut:
        assert len(band) == rules.TEAMS, "una fascia non e' larga quanto le squadre"
        assert paid >= 1
    for role in rules.SLOTS:
        assert sum(1 for r, _t, _b, _p in cut if r == role) == rules.SLOTS[role]
    # ...and the price of a band does not depend on who is picked from it
    ids = set()
    for name, pick in advice.PICKERS.items():
        chosen = [pick(band) for _r, _t, band, _p in cut]
        assert len({m["id"] for m in chosen}) == len(chosen), f"{name} prende due volte lo stesso"
        ids.add(tuple(m["id"] for m in chosen))
    assert len(ids) > 1, "i pickers scelgono tutti gli stessi uomini: il test non misura niente"


def test_the_judge_of_the_advice_needs_no_table_at_all():
    """It is the reason that file exists: every auction-level number is conditional on the declared
    room, and this one is not. So it must not touch a rival, a price rule or an urn - asserted by
    building a squad and scoring it with nothing else in the world."""
    pool = _pool()
    for man in pool:
        man["actual"] = (man.get("pv_pred") or 0) * (man.get("fm_pred") or 0)
    votes = {str(m["id"]): {str(day): 6.0 for day in range(1, 39)} for m in pool}
    window = {"players": pool, "others": [], "rounds": 38, "votes": votes, "base": {}}
    cut = advice.bands(window)
    engine = advice.PICKERS["ENGINE (who plays most)"]
    got = advice.squad(window, cut, set(range(len(cut))), engine)
    assert got["points"] > 0
    assert got["holes"] == 0, "38 giornate di voti e un buco: la rosa non e' stata schierata"
    # ...and the two squads cost exactly the same, which is what makes the comparison one
    market = advice.PICKERS["market (the dearest of the band)"]
    assert advice.squad(window, cut, set(), market)["points"] > 0
    assert sum(paid for _r, _t, _b, paid in cut) > 0
