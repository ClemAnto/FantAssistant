"""bench/auction - which STRATEGY to play at a raise auction, judged on the gate's own ten windows.

`backtest` judges RULES, `sweep` judges CONSTANTS, `zeros` judges the ZERO, `bench/draft` judges DRAFT
POLICIES. This one judges AUCTION STRATEGIES: how much to bid, for whom, in which department, against a
table of participants who each play their own way.

WHAT IT READS FROM THE ENGINE, which is the reason it lives here instead of in a scratchpad:
`bench/draft/extract.py` writes, per window, the Qt.I (the only quotation that does not know the
outcome), the engine's own `fm_pred`/`pv_pred` with parameters cross-fit on an adjacent window exactly
as the gate does it, and the realised fantavoto AND base vote of every matchday. So the LINE-UP is
chosen with the engine's forecast - which is what a manager actually holds in August - and the OUTCOME
is what those men really did. Nothing here re-predicts a footballer.

    python -m bench.auction.bench              # the declared table: 2 P1a, 2 P1b, 1 P2, 3 P3, 2 P4
    python -m bench.auction.bench --engine     # ...plus one participant bidding on the engine

THREE THINGS ARE DECLARED AND NOT MEASURED, so nobody reads them as results: the five profiles
(`profiles.py`, a translation of the operator's own sentences), the league's regulation (`rules.py`, a
published rulebook) and the mental threshold of 500 credits. What is measured is what they produce.

A LIMIT STATED RATHER THAN AVERAGED AWAY: there is no repair window here. Mid-season markets exist in
this league and they cure holes, so every number below is the season as it was bought in August. Three
attempts at modelling them failed in the same place - the order in which a squad is fielded after a
window - and the cure is the same engine call this file already makes, at a later date. Until then the
window is ABSENT rather than approximated, and a strategy that leaves many holes is judged more harshly
here than at a real table.
"""
from __future__ import annotations

import argparse
import heapq
import json
import random
import statistics as st
import zlib
from pathlib import Path

from . import rules
from .profiles import (ABUNDANCE, CAUTIOUS_CAP_SHARE, EXPERT_EYE, MENTAL_CAP_SHARE, PLAN,
                       PROFILES, SCATTER, URGENCY, engine_ladder)

WINDOWS_FILE = Path(__file__).resolve().parents[1] / "draft" / "leghe-classic.json"

#: The table the operator says he normally finds (01/09/2026): 4 with no plan, 1 defence, 3 balanced,
#: 2 for the top striker. The four «no plan» are split into expert and novice on his instruction of the
#: same day - «l'esperto sa valutare al momento l'asta, l'inesperto un po' si fida ciecamente della QI e
#: un po' fa degli errori grossolani» - because those are two different players, not one with noise.
DECLARED_TABLE: tuple[tuple[str, int], ...] = (
    ("P1a no plan, expert", 2), ("P1b no plan, novice", 2),
    ("P2 defence", 1), ("P3 balanced", 3), ("P4 top striker", 2),
)

def seated(table: tuple[tuple[str, int], ...], engine_seats: int) -> list[str]:
    """The profiles that sit down when `engine_seats` of the ten places go to the engine arm.

    THE ARM TAKES A CHAIR, IT DOES NOT PULL ONE UP - the operator's instruction of 02/09/2026, and it
    was a real defect: «dobbiamo necessariamente confrontare i dati reali di aste con 10 partecipanti a
    simulazioni con 10 partecipanti altrimenti avremo delle incongruenze». This league has
    `rules.TEAMS` = 10 teams, `to_credits` conserves ten budgets over the men ten squads roster, a TIER
    is a rank divided by ten and the replacement level behind every surplus is the 10 x slots-th man -
    so seating an eleventh participant put 10% more money and 10% more slots into an auction calibrated
    for ten, and thirteen put 30%. `league.py` never had the defect (its ten letters include the arm).

    WHICH human gives up his chair is declared and deterministic: the profile that currently has the
    most seats, ties broken by the order the table declares them in - so the opposition keeps the
    operator's own mix as closely as possible. With three arms his table of 2 · 2 · 1 · 3 · 2
    becomes 1 · 1 · 1 · 2 · 2, which still seats every profile he described.
    """
    seats = [profile for profile, count in table for _ in range(count)]
    order = [profile for profile, _count in table]
    for _ in range(min(engine_seats, len(seats))):
        crowded = max(order, key=lambda p: (seats.count(p), -order.index(p)))
        seats.remove(crowded)
    return seats


def to_credits(pool: list[dict]) -> float:
    """The factor that turns the listone's Qt.I into the credits of THIS league.

    Not a coefficient to choose: it is a LAW OF CONSERVATION. What a table pays out is the sum of its
    budgets, so the men it actually rosters - the dearest `teams x slots` of each role - must add up to
    `teams x budget`. Without it the Qt.I is a quotation on a scale of its own (1-40 for a striker
    against 1-500 of credits), every ceiling comes out minuscule and the whole table ends the auction
    with three quarters of its money unspent - which is exactly what the first run of this bench did.

    The pool used for the sum is the ROSTERED one and never everybody quoted: spreading the same money
    over ~400 men instead of the 250 who get bought is the same defect the SpM conversion measured on
    the FVM, and it would read every price as 40% too cheap.
    """
    total = 0.0
    for role, slots in rules.SLOTS.items():
        prices = sorted((m["price"] for m in pool if m["slot"].upper() == role), reverse=True)
        total += sum(prices[: slots * rules.TEAMS])
    return (rules.BUDGET * rules.TEAMS / total) if total else 1.0


def engine_rate(pool: list[dict]) -> float:
    """How many credits a fantapunto of surplus is worth AT THIS TABLE - calibrated, never chosen.

    The rate is fixed by the budget: take the men this bidder wants - the best `slots[role]` by surplus
    in each role - and let their surplus add up to the whole purse. A bid in proportion to surplus then
    spends exactly the budget on exactly those men, which is what a ceiling is for.

    The first version used the SHADOW price of a credit from the 2026-27 sheet (0.139 fantapunti per
    credit, so 7.2 credits a point) and divided it by ten for no reason anybody could state. Both halves
    were wrong: a shadow price is the worth of the LAST credit spent, not the average at which a whole
    squad is bought (990 credits for 606 points of surplus is 1.63 credits a point), and the divisor was
    a fudge. That arm ended the auction with 849 credits in its pocket and finished last of eleven.
    """
    total = 0.0
    for role, slots in rules.SLOTS.items():
        best = sorted((m.get("surplus") or 0.0 for m in pool if m["slot"].upper() == role),
                      reverse=True)[:slots]
        total += sum(x for x in best if x > 0)
    return (rules.BUDGET / total) if total > 0 else 1.0


def engine_bid(man: dict, rate: float) -> int:
    """What a man is worth to a bidder who reads the engine instead of the listone.

    The surplus is already "points over the man who would play instead of him", so a price in proportion
    to it is a price of indifference. A man the engine does not price gets one credit and never a guess:
    "vuoto = ignoto, mai zero" applied to a bid - which also means this arm never overpays for a flop and
    never buys a promising unknown at all.
    """
    surplus = man.get("surplus")
    if surplus is None or surplus <= 0:
        return 1
    return max(1, round(surplus * rate))


#: THE GRADUATED QUOTA LADDER, and both numbers are the DRAFT BENCH'S own (`core/auction-plan.ts`):
#: full weight while a role cannot cover the places it fields, `QUOTA_DEPTH` up to twice them,
#: `DEPTH_WEIGHT` after. On classic that ladder is the only rationing with a verdict - +0.77% of points
#: per matchday, robust, 6 windows of 10, against -4.93% for no rationing at all - so it is read here
#: rather than re-invented. What IS new, and stated because it is an extension and not a quotation: the
#: ladder was measured on a count of HEADS, and here it is applied to the EXPECTED SHARE of the calendar
#: those men cover. That is the quantity this bench measured as the one that decides a season (holes vs
#: points, r = -0.79), and counting heads would call a role covered when four men who play half the
#: matches each sit in it.
QUOTA_DEPTH = 0.7
DEPTH_WEIGHT = 0.35


def covered_places(team: Team, role: str, matchdays: int) -> float:
    """How many of the role's places this squad can expect to FILL, from the engine's own appearances.

    Not a count of men: the sum of `pv_pred / matchdays`, i.e. the share of the calendar each of them is
    expected to be rated in. Four men at 0.5 cover two places, not four - which is the whole difference
    between a squad that looks deep and one that fields eleven.
    """
    total = 0.0
    for man in team.men[role]:
        pv = man.get("pv_pred")
        if pv:
            total += min(1.0, pv / matchdays)
    return total


def coverage_need(team: Team, role: str, matchdays: int) -> float:
    """How much this squad still WANTS a man of this role: the graduated ladder over expected places."""
    places = rules.FIELDED[role]
    covered = covered_places(team, role, matchdays)
    if covered < places:
        return 1.0
    if covered < 2 * places:
        return QUOTA_DEPTH
    return DEPTH_WEIGHT


#: WHAT ONE HOLE COSTS, in fantapunti. MEASURED on this bench over 110 simulated squads - the slope of
#: points against holes, 4.73, with r = -0.798 - and the arithmetic of the regulation says the same
#: thing, which is what makes it a number and not a fit: the lost fantavoto is about 6, the deputy vote
#: gives back 4 when it is the FIRST of the matchday and 0 from the second on, and the two modifiers
#: (worth some 0.6 a matchday together) are annulled. So a hole costs between 2.6 and 6 depending on
#: whether it stands alone, and the measured mean lands inside that range.
HOLE_COST = 4.73


def cover_value(man: dict, team: Team, matchdays: int) -> float:
    """The points this man saves by NOT LEAVING A PLACE EMPTY - the half the surplus cannot see.

    The surplus answers "how much better than the man who would play instead", which presumes somebody
    plays. In this league nobody may: a place with no vote pays 4, or nothing at all if another place is
    already empty, and it wipes out the R-Factor and the defence modifier for the whole matchday. So the
    worth of a man has two terms and they are added, never multiplied: what he scores when he plays, and
    how many empty matchdays he removes.

    The saving is capped by the DEFICIT of his role - once the places are covered, one more man covers
    nothing - which is what stops this term from buying a fifth striker. Beyond that the graduated
    ladder handles depth, because a spare who covers an injury is worth something and not nothing.
    """
    pv = man.get("pv_pred")
    if not pv:
        return 0.0
    share = min(1.0, pv / matchdays)
    deficit = max(0.0, rules.FIELDED[role_of(man)] - covered_places(team, role_of(man), matchdays))
    return min(share, deficit) * matchdays * HOLE_COST


def role_of(man: dict) -> str:
    return man["slot"].upper()


#: The steadiness of a man nobody measured. It is the MEDIAN of his role and not zero - "vuoto = ignoto"
#: - because a man with no measured season is unknown, not a man who never closes at 6. Measured on Serie
#: A over 2021-22..2025-26: P 0.87 - D 0.66 - C 0.66 - A 0.61 (per man, at least 15 votes).
STEADY_MEDIAN: dict[str, float] = {"P": 0.87, "D": 0.66, "C": 0.66, "A": 0.61}


def expected_r_factor(shares: list[float]) -> float:
    """E[R-Factor] for one matchday, from each man's own chance of closing at 6 or better.

    A Poisson-binomial, computed exactly: the R-Factor is a THRESHOLD (gone at four insufficient men),
    so it cannot be attributed man by man - the fifth steady player in a squad that already has four
    unreliable ones is worth nothing, and the fourth is worth half a point. This is the same convolution
    the 01/09/2026 measurement used, and it is why the value of steadiness has to be computed on the
    ELEVEN and never written on a row.
    """
    dist = [1.0]
    for share in shares:
        nxt = [0.0] * (len(dist) + 1)
        for count, mass in enumerate(dist):
            nxt[count] += mass * share
            nxt[count + 1] += mass * (1.0 - share)
        dist = nxt
    return sum(mass * max(0.0, rules.R_FACTOR_MAX - rules.R_FACTOR_STEP * short)
               for short, mass in enumerate(dist))


def steady_of(man: dict) -> float:
    """His measured share of matches closed at 6 or better, or the median of his role when unknown."""
    value = man.get("steady")
    if value is None:
        return STEADY_MEDIAN.get(role_of(man), 0.65)
    return float(value)


def steady_value(man: dict, team: Team, matchdays: int) -> float:
    """What this man's STEADINESS is worth to THIS squad, over the season, in fantapunti.

    E[R-Factor] of the eleven with him in it, minus the same without: the marginal value of the threshold,
    computed on the squad he would join. It is the third term the engine arm was missing, and the operator
    named it from a result - the arm was reading 6.5 of R-Factor a season against the 20.5 of a
    participant who bought steady defenders, because neither the surplus nor the appearances contain the
    BASE vote.

    The eleven is the one the squad would field: the best `FIELDED[role]` men of each role by the engine's
    own value, which is the same order `season` uses. A squad that cannot yet field eleven is padded with
    the population median, so the term does not reward a hole (that is `cover_value`'s job) and does not
    punish one twice.
    """
    def eleven(extra: dict | None) -> list[float]:
        out: list[float] = []
        for role, places in rules.FIELDED.items():
            men = sorted(team.men[role], key=lambda m: -(m.get("value") or -1.0))
            if extra is not None and role_of(extra) == role:
                men = sorted([*men, extra], key=lambda m: -(m.get("value") or -1.0))
            picked = men[:places]
            out += [steady_of(m) for m in picked]
            out += [STEADY_MEDIAN.get(role, 0.65)] * (places - len(picked))
        return out

    with_him = expected_r_factor(eleven(man))
    without = expected_r_factor(eleven(None))
    return (with_him - without) * matchdays


#: HOW MUCH OF THE STEADINESS TERM ENTERS A BID: measured, and the answer is ZERO.
#:
#: The operator asked for it having read the right symptom - the arm was collecting 6.5 points of
#: R-Factor a season against a rival's 20.5 - and neither the surplus nor the appearances contain the
#: BASE vote, so the diagnosis was sound. The cure is not, and the reason is arithmetic rather than
#: implementation:
#:
#:   * ONE MAN CAN MOVE THE R-FACTOR BY +1.5 POINTS A SEASON (from his role's median to its p90, the
#:     other ten at their medians, on the exact Poisson-binomial), +6.3 for four defenders and +18.8 for
#:     an eleven where ALL ELEVEN sit at their role's p90 - which is a squad nobody can buy, because
#:     buying it costs the coverage. And +10.8 in the impossible case of one man going from never
#:     sufficient to always. Against a `cover_value` that reaches 180 for a starter in an empty
#:     department, none of that can reorder a single bid.
#:     (The +2.4 published on 01/09 does not reproduce and was corrected in the review of 02/09: the
#:     same construction gives +1.5, while the +10.8 reproduces EXACTLY - which is what locates the
#:     error in the quantile and not in this function.)
#:   * AND THE MODIFIER IS GOVERNED BY HOLES, NOT BY STEADINESS. Over 110 simulated squads the R-Factor
#:     collected correlates -0.821 with holes: the quartile with fewest holes banks 13.6 points of it,
#:     the quartile with most banks 2.1. A single deputy vote annuls the whole bonus for the matchday,
#:     so until a squad is covered its steadiness is never read at all - which is why the arm's 6.5 was
#:     a symptom of its 12 holes and not of who it bought.
#:
#: AND MEASURED ON THE CURRENT CODE IT IS INERT, which is a stronger statement than the "-8.2 points" of
#: 01/09 (that figure was taken before the purse floor stopped being clipped by the department ceiling,
#: and is superseded): at weight 0, 1 and 5 the arm reads 2665.5 points, IDENTICALLY - the term reaches
#: the bid (1.8 points on a real defender) and changes nothing, because `role_cap` binds first. It only
#: begins to bite at 20 (+2.2 points, R-Factor 14.4 -> 15.2), i.e. 0.08% - an order of magnitude under
#: this project's 0.5% floor - and at 100 it collapses (-25.7, holes 12.4 -> 13.7) because it starts
#: buying steadiness instead of coverage, which is the modifier's own destroyer. Kept at zero with the
#: numbers: what would make it pay is a squad with no holes, and no strategy on this bench gets there.
STEADY_WEIGHT = 0.0

#: HOW MANY MEN OF ONE REAL CLUB before the ceiling starts falling, and by how much each further one
#: cuts it. The operator's rule, 01/09/2026: «nel fanta e' molto importante differenziare, comprare 5
#: calciatori di una singola squadra reale significa rischiare il tracollo se quella squadra ha un anno
#: storto - puntare su piu' squadre minimizza questo pericolo (come giocare in borsa su piu' titoli)».
#:
#: DECLARED, and it is a decision about RISK rather than about points - which is exactly why it is a
#: constraint and not a currency. What this project has already measured about the same question
#: (`metrica-asta-surplus-v1.md` §24) is that two men of one club cost nothing on the MEAN (-0.0033 of a
#: point a matchday, the interval contains zero) and add 3.9% to the weekly standard deviation, on 11
#: seasons of 11. So diversifying buys stability and not expectation, and the bench reports both.
#:
#: One tension that has to be stated rather than hidden: the R-Factor is TRUNCATED at zero, and a
#: truncated payoff is worth MORE under higher variance - the same measurement of 01/09/2026 read +7
#: points a season for a correlated eleven of population quality (and only +2 for a steady one). So this
#: rule gives up something small on the modifier to buy stability. Whether that trade is worth it is a
#: preference, and it is the operator's.
CLUB_FREE = 2
CLUB_PENALTY = 0.45


def engine_worth(man: dict, team: Team) -> float:
    """WHAT A MAN IS WORTH TO THIS SQUAD, in fantapunti - the quantity the engine arm bids on.

    Two terms that count, added, and a third measured at zero. They answer different questions and no
    single one is the worth of a man in this league: how much he SCORES over the man who would play
    instead (surplus), and how many empty matchdays he REMOVES (cover). The arm had only the first and
    finished last of eleven; with the second it wins. The third - steadiness, the currency of both
    modifiers - is measured and switched off: see `STEADY_WEIGHT`.

    Extracted from `bid` on 02/09/2026 because the random extraction needs it TWICE: once for the man
    on the block and once for the man who would come up instead of him. Two copies of this sum would
    eventually price the same footballer two ways, and the first place anybody would notice is a bid.
    """
    return ((man.get("surplus") or 0.0)
            + cover_value(man, team, team.matchdays)
            + STEADY_WEIGHT * steady_value(man, team, team.matchdays))


#: HOW MUCH OF THE ALTERNATIVE STILL IN THE URN comes off a bid. 0 = the man is priced on his own
#: worth, which is right when the ORDER guarantees nobody better is behind him; 1 = he is priced on
#: what he adds over the man who would come up instead of him.
#:
#: ADOPTED at 0.75 for the DRAWN mechanism on 02/09/2026 (`Urn.random` switches it off at a called
#: auction, and the reason is written there). Swept on the pre-registered grid 0 ... 1 at
#: `ALT_RANK` = 1, 20 draws of each of the ten windows: 2276 -> 2568 points, +12.8%, with 10 windows
#: of 10 improving, the worst at +6.7%, holes 69.0 -> 22.5 and the mean place 7.75 -> 2.90. The
#: optimum is INTERIOR (0.70 reads 2563.5 and 0.80 reads 2560.0, 1.00 falls back to 2477.8), which is
#: this project's condition for adopting a number at all.
#:
#: WHY IT IS NOT 1.0, which is the value the theory would write: the fallback is OPTIMISTIC - it
#: assumes this squad wins one of the best `k` men left, and against ten rivals it often does not. So
#: only three quarters of it comes off. The other reading of the same fact - keep the coefficient at 1
#: and look further down the urn - was measured too (`ALT_RANK` 2 and 3 read 2549 and 2583) and the
#: whole surface is flat inside 0.5%: two knobs for one effect, so the one that stays is the one whose
#: companion is COUNTED rather than fitted.
ALT_WEIGHT = 0.75

#: WHETHER THE RATE IS RE-READ during the auction instead of fixed at its start. See `Team.live_rate`.
#: MEASURED AND SWITCHED OFF, 02/09/2026: at `ALT_WEIGHT` 0.75 on the drawn mechanism it is worth
#: 2486.8 -> 2497.5 (+0.4%, under this project's 0.5% floor) and at a called auction 2665.5 -> 2670.2.
#: The spend it was built to correct barely moves (739 -> 748), which is the same shape as
#: `STEADY_WEIGHT`: not a weak channel, a channel that does not ARRIVE. What actually stopped the arm
#: hoarding was `FLOOR_ON_BETTER`, and for the opposite reason to the one this term assumes - it was
#: not spending too little, it was spending on the wrong men.
LIVE_RATE = False

#: WHETHER THE SPENDING FLOOR REFUSES A MAN WORSE THAN THE ONE STILL TO COME. See `Team.bid`.
#: ADOPTED 02/09/2026, measured at `ALT_WEIGHT` 0.75 on the drawn mechanism: 2486.8 -> 2565.8 points,
#: holes 33.4 -> 22.9, mean place 4.34 -> 2.79 - and the spend FALLS from 739 to 564, which is the
#: mechanism itself and not a side effect: what the floor was buying was slots, not points. Inert at a
#: called auction by construction, because `alternative` is zero there.
FLOOR_ON_BETTER = True

#: HOW FAR DOWN THE URN the fallback sits, as a multiple of the participants still needing the role.
#: 1.0 is the count itself - "the best k men left go one each, and I get the k-th" - and it is the
#: OPTIMISTIC reading, because it assumes this squad wins one of them. Above 1 it assumes it does not,
#: which is a pessimism that makes it bid harder now. Swept: see the README.
ALT_RANK = 1.0


def club_weight(man: dict, team: Team) -> float:
    """How much this squad still wants a man of HIS club: 1 up to `CLUB_FREE`, falling after."""
    club = man.get("club")
    if not club:
        return 1.0
    held = sum(1 for role in team.men for other in team.men[role] if other.get("club") == club)
    if held < CLUB_FREE:
        return 1.0
    return CLUB_PENALTY ** (held - CLUB_FREE + 1)


def role_shares(pool: list[dict]) -> dict[str, float]:
    """What share of the budget each department is worth, DERIVED from the pool and never declared.

    Per role, the surplus of the best `slots[role]` men, over the same sum across every role. It is the
    same argument the shadow price makes - spend where a credit buys more fantapunti - computed on the
    window being played instead of quoted from a sheet. On the 2026-27 sheet the equivalent numbers were
    P 12.5% - D 32.4% - C 21.4% - A 33.8%, against a market that spends 6.4 - 19.1 - 35.1 - 39.4.
    """
    per_role: dict[str, float] = {}
    for role, slots in rules.SLOTS.items():
        best = sorted((m.get("surplus") or 0.0 for m in pool if m["slot"].upper() == role),
                      reverse=True)[:slots]
        per_role[role] = sum(x for x in best if x > 0)
    total = sum(per_role.values())
    return {role: (value / total if total else 0.0) for role, value in per_role.items()}


def set_tiers(pool: list[dict]) -> None:
    """WHICH TIER OF HIS ROLE EACH MAN BELONGS TO - his rank inside the role over the number of teams.

    A conservation law and not a choice: in a league of ten there are ten first-choice defenders,
    because each participant fields one of them. So «the n-th defender» of a recipe is the n-th TIER,
    and that is what the recipe is indexed by (`Team.step`, and `profiles.TARGET_TIER` for why).

    Ties are broken by id so the tiers are reproducible: two men on the same Qt.I must not swap bands
    because the extraction file happens to list them in another order.
    """
    for role in rules.SLOTS:
        men = sorted((m for m in pool if role_of(m) == role), key=lambda m: (-m["price"], m["id"]))
        for rank, man in enumerate(men):
            # THE RANK TRAVELS WITH THE TIER because a TARGET IS A NAME and not a band: «deve puntare
            # sul TOP in attacco (L.Martinez/Thuram/ecc...) e fa di tutto per prenderlo». Read as «a
            # first-tier forward» that sentence releases the moment he owns any of the ten, which is
            # why the dearest man of the listone was going for 0,6% of a budget when the urn drew him
            # late in his own block - nobody was still waiting for HIM. Real, inside the block: 43,1%
            # · 45,4% · 37,6% · 34,7% by quarter.
            man["rank"] = rank
            man["tier"] = rank // rules.TEAMS


#: HOW HARD THE ARM DEVIATES FROM THE MARKET LADDER *INSIDE* A TIER, on the engine's own appearances.
#:
#: WHY HERE AND NOWHERE ELSE. At a DRAWN auction the arm bids on `profiles.engine_ladder` - the market's
#: own multiple of the ask, tier by tier - and that ladder is indexed on a tier defined by the PRICE. So
#: the arm's whole valuation apparatus (`engine_worth`, `cover_value`, `coverage_need`, `alternative`,
#: `role_cap`) is NEVER CALLED at the urn: counted rather than read off the code, 1436 calls each at a
#: called auction and ZERO at a drawn one. Whatever the arm was winning there, it was not winning it
#: with football - which is exactly what §17.5 measured from the other side («our own ranking read on
#: the price's rank instead of the engine's gives +12,4% against +12,3%, identical») and it said what to
#: do about it: «if one day the informational advantage has to pay, this is not the form».
#:
#: WHERE A LADDER LEAVES ROOM. A tier is `rules.TEAMS` men wide because that is the conservation law, so
#: the ladder prices ten men alike - a limit `profiles.MARKET` already states about the REAL market
#: (inside the first band of the attack the real ladder still falls, 2.81 3.36 2.15 2.60 3.01 2.23 then
#: 1.79 1.23 1.89 1.90). Measured on the ten windows, inside one (role, tier) band the PRICE spans
#: 0.08-0.48 of its own median for the outfield roles while the expected APPEARANCE SHARE spans
#: 0.31-0.33 of the calendar - the defenders' fourth tier is the cleanest case, price 0.08 and
#: appearances 0.42 to 0.76, i.e. TWELVE MATCHDAYS at the same price. The keepers are wider on both
#: axes (price 1.35, appearances 0.15 to 0.84 in the second tier). That is the room, and it is where
#: the market cannot see and we can.
#:
#: AND THE QUANTITY IS NOT A CHOICE. `metrica-asta-surplus-v1.md` §18 measured our incremental edge over
#: the quotation and it is ONE NUMBER WIDE: partial Spearman against the outcome, controlling for Qt.I,
#: `pv_pred` reads +0.198 (euro) and +0.243 (Serie A) while `fm_pred` reads +0.046 and -0.032 and the
#: SURPLUS +0.006 and -0.077. So the within-tier deviation is spent on the APPEARANCES and on nothing
#: else - and the regulation says why it pays here: a single deputy vote annuls both modifiers of this
#: league, so `HOLE_COST` is 4.73 and appearances are what a squad is actually buying.
#:
#: AND NOT A Z-SCORE, which is the third form and the one nobody should write: standardising inside a
#: band of ten men gives an sd near zero wherever the band is compact, and then one hundredth of a
#: matchday becomes a doubled bid. It is the defect `level_z` was paying for when the panel computed its
#: population over one club's movers. The two forms that WERE measured both normalise by a bounded
#: quantity instead - the band's widest man, or the rank itself - so neither can explode.
#:
#: IT CONSERVES BY CONSTRUCTION, which the ladder's own tilt needed a renormalisation to do: the mean of
#: `u` over a full band is exactly 0, so the plan `Team.scale` prices still costs one budget. A tilt
#: that does not conserve is not a strategy, it is a bigger purse (§17.4).
#:
#: ADOPTED 02/09/2026 at 0.80. Criterion pre-registered before the run, paired - the same arm on the
#: same urns, with and without - ten windows, ten participants, the arm on one of the ten chairs.
#: **ROBUST: +1.02%, 9 windows of 10 improve, the worst at -0.42%**, paired +26.4 fantapunti with a
#: standard error of 4.5 (t = 5.9 over 800 seasons), holes 22.9 -> 18.8, mean place 4.20 -> 3.52, titles
#: 175 -> 257 of 800. The optimum is INTERIOR and the plateau is flat inside 0.05% (0.70 reads +26.1,
#: 0.90 +25.9), so the DIRECTION is the finding and the second decimal is not.
#:
#: AND THE LABEL WAS RETIRED BY THE BIGGER SAMPLE, which is §18.2's own discipline turned on this
#: adoption. At forty draws (400 seasons) the same comparison read **STRICT** - +1.26%, 10 windows of
#: 10, worst +0.33% - and at eighty draws one window crosses to -0.42%. The paired GAIN survives
#: doubling the sample and gets sharper (+32.9 +- 6.3 -> +26.4 +- 4.5, t 5.2 -> 5.9); the VERDICT LABEL
#: does not, because "every window improves" is a count on ten and one of those ten was a coin. So the
#: adoption stands on the effect and is published as robust: a gain confirmed by a larger sample and a
#: label refuted by it are two different things, and only the first one is evidence.
#:
#: AND UNLIKE THE LADDER'S OWN MARGIN, THIS ONE SURVIVES ITS OWN COMPETITION. §18.2 had to retire the
#: arm's advantage over the best human because most of it was exclusivity (-2.8 with three arms at the
#: table). Re-measured with THREE arms, the same paired comparison reads **+30.0, t = 7.4, 9 windows of
#: 10, worst -0.48%** - because this term does not escalate a bid, it MOVES the same money inside a
#: band, so three participants reading the same forecast all still gain. It is the first thing this
#: bench has found that pays for our own opinion rather than for how we bid.
#:
#: THE SHAPE WAS CHOSEN BY MEASUREMENT AND THE LOSER IS ON THE RECORD. The rank form - the one the edge
#: was measured in - peaks at 0.50 with +23.8 (t = 3.6, 9 windows of 10, worst -0.39%): robust, not
#: strict. It reads "one rank better" where the magnitude form reads "twelve matchdays better", and
#: inside a band that difference is the whole content of the channel.
#:
#: A DEAD CHANNEL AND A SMALL ONE LOOK ALIKE, so the weight was given an ABSURD value: at 3.00 the arm
#: reads -0.15% with the worst window at -2.90% and the holes back to 22.5. So it ARRIVES and it has a
#: ceiling - the deviation stops paying once it overrules the market by enough to lose the lot.
INSIGHT = 0.80

#: THE SHAPE OF THAT DEVIATION, and it is a question the measurement answers rather than taste.
#: "rank" spends the edge as a RANK (linear in the order inside the band, +-1 at the ends), which is
#: the form the edge was MEASURED in - a partial Spearman is about ranks. "share" spends the MAGNITUDE
#: (the distance from the band's own mean over its widest man, so it still averages to exactly zero and
#: still conserves), which says something the rank throws away: whether the best man of the band is a
#: little better or twelve matchdays better.
#:
#: MEASURED: "share" is STRICT at 0.80 (+1.26%, worst window +0.33%) and "rank" is robust at 0.50
#: (+0.92%, worst -0.39%). The magnitude wins, and the mechanism says why - inside a band the spread of
#: the expected appearance share is 0.30 of a calendar, which is twelve matchdays, and a rank cannot
#: tell that band from one where everybody plays the same.
INSIGHT_SHAPE = "share"

#: FROM WHICH TIER THE ARM LETS A LOT PASS BECAUSE THE MARKET WILL DISCOUNT HIM, and how many rosters
#: still holding a place in that role count as «the table is wide open». Both come from the ARCHIVE and
#: not from this bench's own optimum, and the difference matters - see below.
#:
#: WHAT THE ARCHIVE SAYS (10 real drawn auctions of this league, 2495 awards, `simulatore-asta-rilanci`
#: §23.1): against how many of the ten rosters still hold a place in the role, the median paid/ask of a
#: man of the FIRST TWO TIERS reads x1.00 / 0.91 / 0.80 - i.e. he never comes cheap, and ZERO of 552
#: awards of the top tier of any role went for one credit. From the THIRD TIER the same curve reads
#: x1.00 / 0.50 / 0.50, and from the fifth x1.00 / 0.36 / 0.21, with the share going at one credit
#: climbing from 17% to 92%. So the discount exists exactly where the man is SUBSTITUTABLE: twenty men
#: for ten starting places at the top, more men than places below it.
#:
#: WHAT IT BUYS, and the mechanism is not the one the name suggests. It is NOT «get the depth cheaper»:
#: photographed, the arm's tail purchases go from 3 credits to 1 while their expected appearances barely
#: move (pv 23.7 -> 23.2), and the credits it does not spend there buy **1.6 more men of the first two
#: tiers** (10.5 -> 12.1 a squad). Paired, ten participants, the arm on one of the ten chairs:
#: **+1.88% STRICT over 800 seasons** (+49.4 +- 4.3, t 11.6, 10 windows of 10, worst window +0.57%),
#: holes 18.9 -> 13.3, mean place 3.53 -> 2.49. It SURVIVES ITS OWN COMPETITION - three arms read
#: +1.54% strict (t 9.0, 10 of 10) - and it is INERT at a called auction to the decimal, switched by the
#: mechanism like everything else here.
#:
#: AND IT MAKES OUR FORECAST WORTH MORE, which is the reason it is here rather than in a note: `INSIGHT`
#: is worth +29.9 fantapunti inside the arm as it was and **+37.0** inside this one (+1.15% -> +1.39%,
#: t 3.1 -> 5.4), and +0.56% robust even with three arms at the table. The timing buys the PLACES at the
#: top of the market and the forecast decides WHICH man fills them: they compose, they are not
#: substitutes - which is what our department shares turned out to be against the ladder tilt (§17.4).
#:
#: THE TIER BOUNDARY IS AN INTERIOR OPTIMUM AND IT LANDS ON THE ARCHIVE'S OWN BAND: 0 and 1 read +1.69%
#: (the guard below makes the top tier unrefusable by construction), **2 reads +2.06%**, 3 +1.84%,
#: 4 +1.47%, 5 +1.38%, all at 20 draws. Two measurements that had no reason to agree, agreeing.
#:
#: WHAT IS DELIBERATELY NOT TAKEN, and it is a judgement rather than a measurement: this bench's own
#: optimum for the WIDE-OPEN threshold is not 9 but **3** (+3.85% against +2.06%), i.e. «wait until
#: almost nobody wants the role». That is §22's patience again, and §22 was refused because the prices
#: it harvested do not exist at a real table - the archive puts the third and fourth tiers at x0.50 late
#: (8-13 credits) where this bench hands them over for one. So the threshold is the archive's band and
#: not the bench's peak, and the ~2 points of the difference are left on the table on purpose. Checked
#: rather than assumed: at the archive's band the arm pays 0.90-1.24 of the real late price for the
#: first two tiers of the keepers and the midfield (the defence overpays at 1.9, which is the adopted
#: tilt), so the men that decide a season are bought at real prices.
DEPTH_TIER = 2
DEPTH_HANDS = 9


def set_insight(pool: list[dict]) -> None:
    """WHERE EACH MAN STANDS INSIDE HIS OWN TIER on the engine's expected appearances: `u` in [-1, +1].

    +1 is the man of the band furthest above its mean and -1 the one furthest below, and BOTH ends are
    reached by construction, because the divisor is the band's own widest man. Whatever the shape, the
    mean over a full band is 0, so the deviation cannot change what the plan costs (`Team.scale`).

    Two shapes, and `INSIGHT_SHAPE` records which one the measurement chose: "share" reads the MAGNITUDE
    (how far above the band's mean he is), "rank" reads only the ORDER. The adopted one is "share" -
    +32.9 against +23.8 - because inside a band the spread of the expected appearance share is a third
    of a calendar, and a rank cannot tell that band from one where everybody plays the same.

    A man the engine does not price gets 0 and never the bottom of his band: «vuoto = ignoto, mai zero»,
    which here would be the difference between "no opinion about him" and "we expect him not to play".
    """
    for role in rules.SLOTS:
        bands: dict[int, list[dict]] = {}
        for man in pool:
            if role_of(man) == role:
                bands.setdefault(man.get("tier", 0), []).append(man)
        for band in bands.values():
            for man in band:
                man["insight"] = 0.0
            known = sorted((m for m in band if m.get("pv_pred") is not None),
                           key=lambda m: (-m["pv_pred"], m["id"]))
            if len(known) < 2:
                continue
            if INSIGHT_SHAPE == "share":
                mean = sum(m["pv_pred"] for m in known) / len(known)
                widest = max(abs(m["pv_pred"] - mean) for m in known) or 1.0
                for man in known:
                    man["insight"] = (man["pv_pred"] - mean) / widest
                continue
            for index, man in enumerate(known):
                man["insight"] = 1.0 - 2.0 * index / (len(known) - 1)


def tier_asks(pool: list[dict]) -> dict[tuple[str, int], float]:
    """The MEAN ask price of each tier - what executing a plan costs, read off the listone in August.

    The mean and not the median, for the same reason `profiles.MARKET` is a ratio of sums: summed over
    every tier of every role it has to give back the montepremi, or a recipe normalised to it
    (`Team.scale`) would silently ration or inflate every bid at the table. The medians of a
    right-skewed band add up to 79% of the money.
    """
    asks: dict[tuple[str, int], float] = {}
    for role, slots in rules.SLOTS.items():
        men = sorted((m for m in pool if role_of(m) == role), key=lambda m: -m["price"])
        for tier in range(slots):
            band = men[tier * rules.TEAMS:(tier + 1) * rules.TEAMS] or men[-1:]
            asks[(role, tier)] = (st.mean(m["price"] for m in band) if band else 1.0)
    return asks


class Urn:
    """WHAT IS STILL TO BE DRAWN - which at a RANDOM extraction is half of every decision.

    At a called auction the ORDER does the rationing for you: the man on the block is by construction
    the dearest one left, so "hold my credits for somebody better" is never a question anybody has to
    ask. Drawn at random he can be the last striker of the listone or a third-choice full back, and
    those two ask opposite things of the same purse.

    So the bidders are allowed to see the urn - and only this much of it: what is STILL IN it. Never
    what comes next, which nobody at a real table knows either.
    """

    def __init__(self, pool: list[dict]) -> None:
        #: SLOTS STILL TO FILL ACROSS THE WHOLE TABLE, refreshed by `auction` at every lot. It lives on
        #: the urn rather than being passed around because it is a fact about the auction and not about
        #: any one bidder, and two copies of it would eventually disagree.
        self.demand = 0
        #: HOW MANY PARTICIPANTS still have a slot open in each role - i.e. how many hands go up when a
        #: man of that role is drawn. Refreshed at every lot by `auction`, for the same reason.
        self.needing: dict[str, int] = {role: 0 for role in rules.SLOTS}
        #: WHETHER THE LOTS ARE DRAWN OR CALLED. It is not decoration: at a called auction the man on
        #: the block is the dearest one left, so "is somebody better coming?" is a question the ORDER
        #: has already answered, and asking it again with `alternative` is not caution but
        #: misinformation - the best man left by SURPLUS can be dearer to refuse than he is worth.
        #: Measured, and it is why the term is switched off there: on the ten called windows it is
        #: worth +0.3% (under this project's 0.5% floor) with one window at -5.6%, i.e. it fails the
        #: robust criterion; on the ten drawn ones it is +12.8% with 10 windows of 10 improving and the
        #: worst at +6.7%. A parameter belongs to the mechanism it was measured on.
        self.random = False
        self._drawn: set[int] = set()
        self._gone: dict[str, int] = {role: 0 for role in rules.SLOTS}
        self._by_price: dict[str, list[dict]] = {}
        self._by_worth: dict[str, list[dict]] = {}
        for role in rules.SLOTS:
            men = [man for man in pool if role_of(man) == role]
            # SORTED THE WAY `set_tiers` RANKS, ties included: `tier_left` walks this list and stops
            # at the first man of a worse tier, which is only valid if the list is in tier order.
            self._by_price[role] = sorted(men, key=lambda m: (-m["price"], m["id"]))
            self._by_worth[role] = sorted(men, key=lambda m: -(m.get("surplus") or 0.0))

    def back(self, man: dict) -> None:
        """NOBODY BID: he goes back into the urn, because that is what the platform does.

        MEASURED on the operator's own auctions (`docs/real-data/`, the five whose extraction order
        could be reconstructed): every one of the 518 quoted names is drawn 5 to 9 times, and Martinez
        L., Malen, Dimarco, Paz N. and Thuram all appear among the extractions nobody bid on and are
        sold later. So a drawn auction is not one pass over the listone - it keeps drawing until the
        rosters are full.
        """
        self._drawn.discard(man["id"])
        role = role_of(man)
        self._gone[role] -= 1

    def take(self, man: dict) -> None:
        """This man is on the block, so he is out of the urn: what remains is what remains AFTER him."""
        self._drawn.add(man["id"])
        role = role_of(man)
        self._gone[role] += 1
        # Compacted when a third of a role has gone, which keeps every walk below short and the whole
        # auction linear. Filtering on every draw would be quadratic and rebuilding never would make
        # the walks quadratic instead.
        if self._gone[role] * 3 > len(self._by_price[role]):
            self._by_price[role] = [m for m in self._by_price[role] if m["id"] not in self._drawn]
            self._by_worth[role] = [m for m in self._by_worth[role] if m["id"] not in self._drawn]
            self._gone[role] = 0

    def dearest(self, roles: tuple[str, ...]) -> float:
        """The ask price of the dearest man still to come, among the roles asked for. 0 if none is."""
        best = 0.0
        for role in roles:
            for man in self._by_price[role]:
                if man["id"] not in self._drawn:
                    best = max(best, man["price"])
                    break
        return best

    def tier_left(self, role: str, tier: int) -> int:
        """How many men of this role and no worse than `tier` are STILL TO BE DRAWN.

        What «is a champion still to come?» means, and the whole of what stops one going unsold: the
        rosters fill up long before the urn does (77 forwards for 60 slots), so a participant who never
        keeps a slot cannot bid for a man drawn late however rich he is. See `Team.keeps`.
        """
        count = 0
        for man in self._by_price[role]:
            if man.get("tier", 0) > tier:
                break
            if man["id"] not in self._drawn:
                count += 1
        return count

    def rank_left(self, role: str, ranks: int) -> int:
        """How many of the `ranks` dearest men of this role are STILL TO BE DRAWN. See `set_tiers`."""
        count = 0
        for man in self._by_price[role]:
            if man.get("rank", 0) >= ranks:
                break
            if man["id"] not in self._drawn:
                count += 1
        return count

    def best_tier(self, roles: tuple[str, ...]) -> int:
        """The tier of the best man still to come, among the roles asked for - a big number if none is."""
        best = max(rules.SLOTS.values()) + 1
        for role in roles:
            for man in self._by_price[role]:
                if man["id"] not in self._drawn:
                    best = min(best, man.get("tier", 0))
                    break
        return best

    def nth(self, role: str, rank: int) -> dict | None:
        """The `rank`-th best man of this role still to come, by surplus. None if the urn is shorter."""
        seen = 0
        for man in self._by_worth[role]:
            if man["id"] in self._drawn:
                continue
            if seen == rank:
                return man
            seen += 1
        return None

    def left(self, role: str) -> int:
        return sum(1 for man in self._by_price[role] if man["id"] not in self._drawn)

    def best_surplus(self, role: str, wanted: int) -> float:
        """The surplus of the `wanted` best men of this role still to come. The same sum `engine_rate`
        takes over the whole pool at the start, taken over the urn in the middle of the auction."""
        total, taken = 0.0, 0
        if wanted <= 0:
            return 0.0
        for man in self._by_worth[role]:
            if man["id"] in self._drawn:
                continue
            surplus = man.get("surplus") or 0.0
            if surplus <= 0:
                break
            total += surplus
            taken += 1
            if taken >= wanted:
                break
        return total

    def market(self, wanted: int) -> float:
        """What the rest of the auction will COST the table, if the dearest `wanted` men left are bought.

        The conservation law `to_credits` is built on, read at a point in the middle of the auction
        instead of at its start: the men a table rosters are the dearest ones, and their ask prices add
        up to the budgets. So this is the money the table still has to put on the floor - and a
        participant's own share of it is what tells him whether he is spending fast enough.
        """
        total, taken = 0.0, 0
        for man in heapq.merge(*(self._by_price[role] for role in rules.SLOTS),
                               key=lambda m: -m["price"]):
            if man["id"] in self._drawn:
                continue
            total += man["price"]
            taken += 1
            if taken >= wanted:
                break
        return total


#: THE ORDER THE PLATFORM PLAYS THE ROLES IN, and it is the biggest single thing this bench had wrong.
#: MEASURED on the operator's own archive (`docs/real-data/`) and not chosen: of the 20 real auctions
#: with his exact league, SIXTEEN put the mean award position of the four roles at 0.06 · 0.28 · 0.60 ·
#: 0.88 - identical to two decimals across sixteen separate sessions, which is the signature of an order
#: the platform imposes rather than a habit anybody has. And those four numbers are exactly where the
#: ROSTER puts the boundaries: 3 keepers of 25 places, then 8 defenders, then 8 midfielders, then 6
#: forwards. Within a role the men come in a random order (the position's standard deviation inside a
#: role is 0.06-0.13 against 0.29 for a draw spread over the whole auction).
#:
#: WHAT IT EXPLAINS, all at once and with no behaviour added: a real table spends 8.8% of the montepremi
#: in the first tenth of the awards and 38% in the last two, which is the department split (P 9.1 · D
#: 16.3 · C 27.2 · A 47.4) accumulated in this order and nothing else; the dear men are awarded late
#: because they are FORWARDS; and the price of a champion does not depend on when he is drawn, because
#: whenever that is, it is inside the attack phase and every rival still has all six of his forward
#: slots open and the money he kept for them.
#:
#: It is the rulebook, so it has no parameter - but 4 of those 20 auctions ran free, so the free order
#: stays reachable (`--free`) and is what the unsold-champion figures were measured on.
PHASES: tuple[str, ...] = ("P", "D", "C", "A")


def in_phases(pool: list[dict]) -> list[list[dict]]:
    """The pool split into the phases the platform plays, in order. See `PHASES`."""
    blocks = [[man for man in pool if role_of(man) == role] for role in PHASES]
    others = [man for man in pool if role_of(man) not in PHASES]
    return [block for block in blocks if block] + ([others] if others else [])


def called_order(pool: list[dict], phased: bool = True) -> list[dict]:
    """The order of a CALLED auction: role by role, and inside a role the dearest first.

    The phases are the platform's (see `PHASES`); 81 of 86 real called auctions are played in them.
    What the manager chooses at a called auction is WHICH name to put up, and the archive says he
    chooses it inside the role the auction has reached.
    """
    if not phased:
        return sorted(pool, key=lambda m: -m["price"])
    out: list[dict] = []
    for block in in_phases(pool):
        out += sorted(block, key=lambda m: -m["price"])
    return out


def extraction_order(pool: list[dict], seed: int, phased: bool = True) -> list[dict]:
    """The order of a RANDOM extraction: the platform draws a name, and nobody chose it.

    Sorted by id BEFORE the shuffle, so the draw depends on the seed and on nothing else - the order
    the extraction file happens to list its men in is not a fact about the auction. Drawn INSIDE the
    phase the auction has reached, which is what the real archive says (`PHASES`).
    """
    lots = sorted(pool, key=lambda m: m["id"])
    shuffle = random.Random(seed)
    if not phased:
        shuffle.shuffle(lots)
        return lots
    out: list[dict] = []
    for block in in_phases(lots):
        shuffle.shuffle(block)
        out += block
    return out


class Team:
    """One participant: a recipe, a purse, and the men it has bought."""

    def __init__(self, name: str, profile: str, recipe: dict[str, list[float]] | None,
                 budget: int = rules.BUDGET) -> None:
        self.name, self.profile, self.recipe = name, profile, recipe
        # HIS OWN BUDGET AND NOT THE RULEBOOK'S, everywhere. The constructor took a `budget` and then
        # `role_cap` split `rules.BUDGET` into departments while `season` reported
        # `rules.BUDGET - left` as the spend: a participant built with any other purse would have got
        # ceilings and a spend belonging to somebody else, silently. Nothing passes another budget today,
        # which is exactly what makes it worth closing - a parameter half the class honours is a wrong
        # answer waiting for its first caller.
        self.budget = budget
        self.left = budget
        self.men: dict[str, list[dict]] = {role: [] for role in rules.SLOTS}
        self.cap = round(budget * MENTAL_CAP_SHARE)
        own = CAUTIOUS_CAP_SHARE.get(profile)
        if own:
            self.cap = min(self.cap, round(budget * own))
        self.scatter = SCATTER.get(profile, 0.0)
        self.eye = EXPERT_EYE.get(profile, 0.0)
        self.rate = 1.0            # set per window by `run`, for the engine bidder only
        self.shares: dict[str, float] = {}
        self.matchdays = 38
        #: WHAT HE CAME TO THE TABLE WANTING, and the money he ring-fences for it: see `profiles.PLAN`.
        self.plan = PLAN.get(profile, ())
        #: WHAT EACH TIER ASKS, set per window by whoever builds the table - like `rate`. Left empty a
        #: recipe is read at its face value, which is what the unit tests do on purpose.
        self.asks: dict[tuple[str, int], float] = {}
        #: HOW HARD THIS PARTICIPANT DEVIATES FROM THE LADDER INSIDE A TIER - see `INSIGHT`. Zero for
        #: every human, because a human has no engine to read: the market ladder IS their opinion.
        self.insight = 0.0
        #: THE ENGINE ARM'S LADDER, built once per auction from its own department shares. Cached on the
        #: participant because it depends on `shares`, which the caller sets after construction.
        self.ladder: dict[str, list[float]] | None = None

    def draw(self, player_id: int) -> float:
        """A number in [0, 1) fixed by (participant, man): the scatter has to be REPRODUCIBLE.

        Python's `hash()` on a string is salted per process, so the first version of this gave a
        different auction on every run - two consecutive runs read the engine arm at 1.10 and 1.90 of
        mean place, and neither was wrong. A bench whose numbers cannot be repeated cannot be cited.

        Also the tie-break in `auction`, for the reason written there.
        """
        return (zlib.crc32(f"{self.name}|{player_id}".encode()) % 100_000) / 100_000

    def role_cap(self, role: str) -> int:
        """The ceiling for ONE man of this role: dynamic by department and by what the squad still needs.

        What is left of this department's share of the budget, spread over the slots still to fill in it,
        and multiplied by `URGENCY` while the department cannot yet field its own places. A department
        already covered gets the plain average, so the money drains toward the holes by itself.

        Replaces a flat share of the budget, which was wrong in both directions at once: 150 credits is a
        ceiling no keeper ever reaches and one that binds on the striker a shape needs.
        """
        if not self.shares:
            return self.cap
        want = round(self.budget * self.shares.get(role, 0.0))
        spent = sum(m.get("paid", 0) for m in self.men[role])
        free = max(1, rules.SLOTS[role] - len(self.men[role]))
        room = max(1, want - spent)
        cap = room / free
        if covered_places(self, role, self.matchdays) < rules.FIELDED[role]:
            cap *= URGENCY
        return max(1, round(cap))

    def slots_left(self) -> int:
        return sum(rules.SLOTS[r] - len(self.men[r]) for r in rules.SLOTS)

    def open_roles(self) -> tuple[str, ...]:
        """The roles this squad can still buy into - which is what its purse is being kept for."""
        return tuple(r for r in rules.SLOTS if len(self.men[r]) < rules.SLOTS[r])

    def step(self, man: dict) -> float:
        """The multiple of the ask price this recipe puts on THIS man: the ladder, indexed by
        `max(tier, held)`.

        Both halves are needed. The TIER is what the ladder was always meant to say - «the first
        defender» means the best one, not the first one you happen to meet - and indexing on what the
        squad HELD was the same number only because a called auction offers the dearest man first. At a
        random extraction it read as «1.9 times the ask for whatever defender comes up», which is what
        put P2's whole purse into the 90th defender of the listone and left him nothing for Dimarco.
        The HELD half is what stops a profile buying eight first-choice defenders at the first-choice
        price. See `profiles.TARGET_TIER`.
        """
        role = role_of(man)
        ladder = self.recipe[role]
        tier = man.get("tier", 0)
        # HOW MANY OF THIS ROLE THE SQUAD ALREADY OWNS WHO ARE AS GOOD OR BETTER, not how many it owns.
        # Indexed on the plain count, a squad holding four forwards priced the best player of the game
        # as its FIFTH - 0,18 times the ask - which is what made a champion drawn late in his own block
        # worth a credit. Measured on the four targets: men bought at five credits or less 7,0 -> 8,0
        # (real 9,5), credits left in pocket 10,2% -> 6,2% (real 6,1%), and the champion's price in the
        # first quarter of his block 47,8% -> 43,9% against a real 43,1%.
        ahead = sum(1 for other in self.men[role] if other.get("tier", 0) <= tier)
        rate = ladder[min(max(tier, ahead), len(ladder) - 1)]
        # ...AND THE ONE THING THE LADDER CANNOT SAY, for whoever has an engine to read it with: which
        # of the ten men of this band we expect to PLAY. See `INSIGHT` and `set_insight`. Zero for every
        # human, and inert at a called auction by the mechanism - there the arm never reaches this
        # function at all, because a ceiling in fantapunti is the better instrument when the dearest man
        # left is always the one on the block.
        return rate * (1.0 + self.insight * man.get("insight", 0.0)) if self.insight else rate

    def owed(self, role: str) -> int:
        """How many of the DEAREST men of this role his plan still says he must own.

        Counted on the RANK and not on the tier: a plan for «the top forward» is a plan for one of the
        dearest one or two names, and reading it as «any first-tier forward» released it the moment he
        bought the tenth-best - which is how the best man of the listone came to go for 0,6% of a
        budget when the urn drew him late in his own block.
        """
        total = 0
        for line, count, _share in self.plan:
            if line == role:
                have = sum(1 for m in self.men[role] if m.get("rank", 99) < count)
                total += max(0, count - have)
        return total

    def reserved(self, man: dict, urn: Urn | None) -> int:
        """The credits ring-fenced for the targets this man is NOT - «conservando piu' crediti degli altri».

        A cap on what he will spend on anybody else, never a change of his ceiling for the target
        himself: «solo dopo aver preso un attaccante TOP comincia a piazzare qualche altra offerta
        seria». It releases itself in the only two ways it can - he buys the target, or the urn runs out
        of them - so a plan can never leave a squad unfinishable.
        """
        total = 0.0
        for role, count, share in self.plan:
            owed = self.owed(role)
            if owed <= 0:
                continue
            if role_of(man) == role and man.get("rank", 99) < count:
                continue            # he IS what the money is being kept for
            if urn is not None and urn.rank_left(role, count) <= 0:
                continue            # nothing left to wait for: the money is released
            total += self.budget * share * owed / count
        return round(total)

    def keeps(self, man: dict, urn: Urn | None) -> bool:
        """Whether buying this man would spend a slot that is being KEPT for a top man still to come.

        «Conservare almeno uno o due posti per qualche occasione alla fine», and the operator's own
        justification for the risk - «il rischio vale per un top di ruolo». How many slots that is, is
        COUNTED and never declared - `profiles.py` records the numbers of the two declared
        forms that came first, both of them worse.

        INERT AT A CALLED AUCTION, and not by accident: there the dearest man is offered first, so
        there is never a better one still to come and `tier_left` is zero. One rule, two mechanisms.
        """
        if urn is None:
            return False
        role = role_of(man)
        open_here = rules.SLOTS[role] - len(self.men[role])
        hands = max(1, urn.needing.get(role, 1))
        # A PLAN KEEPS ITS PLACE AS WELL AS ITS MONEY, and only a plan does - «su 10 persone QUALCUNO
        # dovrebbe conservare un posto in rosa aspettando proprio il campione». Given to everybody it
        # strangles the auction (measured: 8,4 slots of 250 unfilled and 18 of the top 50 unsold,
        # because all ten wait for the same man); given to the two profiles whose declared strategy IS
        # that man, it costs at most three places across the table.
        owed = self.owed(role)
        if owed and man.get("rank", 99) >= max(c for r, c, _s in self.plan if r == role):
            waiting = urn.rank_left(role, max(c for r, c, _s in self.plan if r == role))
            if open_here <= min(owed, waiting) and urn.left(role) > open_here + hands - 1:
                return True
        # HOW MANY BETTER MEN THIS SQUAD CAN EXPECT TO WIN, counted and not chosen: if `hands`
        # participants still want the role, the better men left go one each, so his share of them is
        # their number over the hands up. Refusing costs him nothing while that share covers every slot
        # he has left there - and the moment it does not, he bids.
        mine = urn.tier_left(role, man.get("tier", 0) - 1) / hands
        if mine < open_here:
            return False
        # ...AND ONLY WHILE REFUSING DOES NOT COST THE SLOT ITSELF: enough men of the role must be left
        # for this squad and for the rivals who still want one.
        return urn.left(role) > open_here + hands - 1

    def waits(self, man: dict, urn: Urn | None) -> bool:
        """Whether the arm lets this lot pass because THE MARKET WILL DISCOUNT HIM. See `DEPTH_TIER`.

        Not the same question as `keeps`, which asks «is somebody BETTER still to come?» and divides
        the men left by the hands up. This one asks «will this same man be CHEAPER later?», and the
        archive answers it: from the third tier down he costs half as much once the table thins and a
        fifth at the end, while a man of the first two tiers never comes cheap at all.

        Two guards, and neither is a parameter. The first is the one `Team.keeps` ends with - enough men
        of his own tier or better must be left for this squad AND for every rival that still wants one -
        so waiting can never cost the slot itself. The second is that guard's arithmetic doing something
        this rule needs: with `rules.TEAMS` men per tier, a man of the TOP tier can never satisfy
        `tier_left > open_here + hands - 1` while the table is wide open, so the rule cannot touch him
        however the constant is set. That is why the tier grid reads the same at 0 and at 1.
        """
        if urn is None or not urn.random or man.get("tier", 0) < DEPTH_TIER:
            return False
        role = role_of(man)
        open_here = rules.SLOTS[role] - len(self.men[role])
        hands = max(1, urn.needing.get(role, 1))
        if open_here <= 0 or hands < DEPTH_HANDS:
            return False
        return urn.tier_left(role, man.get("tier", 0)) > open_here + hands - 1

    def scale(self) -> float:
        """WHAT MULTIPLIES EVERY STEP OF THE RECIPE so the plan costs exactly what is left to spend.

        A recipe is a DISTRIBUTION of the purse and its level is not a free parameter: the same
        conservation law `to_credits` and `engine_rate` are built on, read on one participant. The plan
        still to execute is the ladder over the slots still to fill, priced at what each tier asks; the
        purse is what is left. So a participant who has saved bids up by himself, and one who has
        overpaid rations himself - both in the SHAPE of his own plan, which is the half a flat floor per
        remaining slot could not do.

        It replaced that floor (`ABUNDANCE`, now the engine arm's alone) and it is the biggest single
        cause of the flat auctions the operator objected to on 02/09/2026: «vedo costi distribuiti in
        maniera troppo equilibrata». With 1000 credits and 25 slots the floor said «40 a man» about the
        best striker of the listone and about the 200th defender alike - four participants of ten ended
        with ZERO men under 5 credits, against 8-9 of 25 in the 131 real auctions.
        """
        if not self.asks or self.recipe is None:
            return 1.0
        plan = 0.0
        for role, ladder in self.recipe.items():
            for index in range(len(self.men[role]), rules.SLOTS[role]):
                plan += ladder[min(index, len(ladder) - 1)] * self.asks.get((role, index), 1.0)
        return (self.left / plan) if plan > 0 else 1.0

    def live_rate(self, urn: Urn | None) -> float:
        """The credits this purse can still put on one fantapunto - `engine_rate` re-read mid-auction.

        `engine_rate` is a CONSERVATION LAW taken at the start: the men this bidder wants - the best
        `slots[role]` by surplus - are made to add up to the whole purse, so bidding in proportion to
        worth spends exactly the budget on exactly those men. Halfway through a random extraction both
        halves have moved: the purse is smaller and the urn no longer holds that squad. Re-reading the
        same law over what is LEFT is not a new parameter, it is the same one at the right moment - and
        it is what stops the arm from ending an auction with credits it was never going to be able to
        spend, since the rate rises by itself as the good men leave the urn.
        """
        if urn is None:
            return self.rate
        total = sum(urn.best_surplus(role, rules.SLOTS[role] - len(self.men[role]))
                    for role in rules.SLOTS)
        return (self.left / total) if total > 0 else self.rate

    def alternative(self, man: dict, urn: Urn | None) -> float:
        """What the man who would come up INSTEAD of him is worth to this squad.

        THE ZERO OF A BID IS A QUESTION, and a random extraction asks a different one. `surplus`
        already subtracts the man who would PLAY instead (the roster-marginal of the league); this
        subtracts the man who would be BOUGHT instead, which is a fact about the urn and not about the
        listone. Where they differ is exactly where the two mechanisms differ.

        Which man that is, is counted and not chosen: if `k` participants still have a slot open in
        this role, the best `k` men left will go one each, so the one this squad ends up with if it
        lets this lot pass is the `k`-th of them. Nobody is assumed to bid badly.
        """
        if urn is None or not urn.random:
            return 0.0
        role = role_of(man)
        other = urn.nth(role, max(0, round(ALT_RANK * urn.needing.get(role, 1)) - 1))
        return engine_worth(other, self) if other is not None else 0.0

    def pace(self, urn: Urn | None) -> float:
        """How rich this purse is against what it can still SPEND - 1.0 is on schedule, 2.0 is double.

        The other half of "nobody ends an auction with credits in his pocket", and the half a called
        order never needs. `market` says what the rest of the auction will cost the table; this squad's
        own share of that is its remaining slots over everybody's. A participant who has bought little
        and hoarded much reads above 1 and starts bidding up by himself, which is what a real table
        does when it notices the money is not going anywhere - and it is SELF-CORRECTING rather than a
        rate anybody tuned, because it is the same conservation law `to_credits` is built on.
        """
        if urn is None:
            return 1.0
        demand = urn.demand
        if demand <= 0:
            return 1.0
        fair = urn.market(demand) * self.slots_left() / demand
        return self.left / max(1.0, fair)

    def reach(self, man: dict, urn: Urn | None) -> float:
        """How much of the "spend it or lose it" floor this man may claim, from 0 to 1.

        THE DECLARED RULE IS «nobody ends an auction with credits in his pocket», and until 02/09/2026
        it was implemented as a flat floor - the purse's affordable share per remaining slot, claimed by
        every man on the block. Under a CALLED order that fires late by itself and only on the cheap,
        because the man in front of you is the dearest one left and his ask price towers over the share.
        Under a RANDOM extraction it fires on the FIRST lot drawn: everybody bids ~40 credits on a
        third-choice full back because he happens to come up first, and the auction goes flat.

        The rule was never about the man in front of you: it is about there being nothing better left to
        keep the money for. So the floor is claimed in proportion to how this man's ask price compares
        with the DEAREST man still to come in a role this squad still needs - full when he is as dear as
        anything left, none of it when a striker is still in the urn.

        And it reduces EXACTLY to the old behaviour on a called order: there the man on the block is the
        dearest remaining, so the ratio is 1 on every bid that is computed at all (his role must be open
        for this squad, or `bid` has already returned 0). One definition, two mechanisms - which is why
        nothing published on the called auction moves.
        """
        if urn is None:
            return 1.0
        dearest = min(1.0, man["price"] / max(1.0, urn.dearest(self.open_roles())))
        # ...OR because there is too much money left in this purse for what it can still buy. The two
        # are different reasons to stop saving and either one is enough, so they are a MAXIMUM and not
        # a product: a man who is the best thing left deserves the floor even from a poor purse, and a
        # purse that is running out of things to buy has to spend on whoever comes up.
        return min(1.0, max(dearest, self.pace(urn) - 1.0))

    def bid(self, man: dict, urn: Urn | None = None) -> int:
        """The most this participant will pay for this man, 0 for "not interested".

        Closing the squad is always on: every slot still to fill costs at least one credit, so the
        ceiling is never the whole purse. It is the same guard the auction panel calls "tetto effettivo".
        """
        role = man["slot"].upper()
        held = len(self.men.get(role, ()))
        if held >= rules.SLOTS.get(role, 0):
            return 0
        room = self.left - (self.slots_left() - 1)
        if room < 1:
            return 0
        if self.recipe is None and urn is not None and urn.random and self.asks:
            if self.waits(man, urn):
                return 0
            # AT A DRAWN AUCTION THE ARM BIDS ON THE MARKET'S LADDER, tilted toward the back: see
            # `profiles.engine_ladder`. Worth +17,9% and 28 titles of 100 against 0, because a ceiling
            # in fantapunti cannot win a contested lot however well the footballer is judged. Switched
            # on by the mechanism and not by a flag - at a called auction the same ladder loses 2%.
            if self.ladder is None:
                self.ladder = engine_ladder()
            kept, self.recipe = self.recipe, self.ladder
            try:
                return self.bid(man, urn)
            finally:
                self.recipe = kept
        if self.recipe is None:
            # THE ENGINE ARM, and the two things the first version was missing are both here.
            # COVERAGE: the bid is scaled by how much this squad still needs the role, on the graduated
            # ladder read off the expected share of the calendar its men cover. Without it the arm bought
            # the highest surpluses wherever they were and left 36 holes a season - and a hole costs the
            # place plus BOTH modifiers.
            # A CEILING PER ROLE: what is left of that department's own share of the budget, spread over
            # the slots still to fill there, and lifted while the department cannot field its places.
            # A single cap for every role is the defect that a fixed 15% was: 150 credits is a ceiling
            # nobody needs on a keeper and one that binds on a striker.
            need = coverage_need(self, role, self.matchdays)
            # WHAT HE IS WORTH (`engine_worth`), LESS WHAT COMES INSTEAD OF HIM. The second half is the
            # whole of what a random extraction changes: at a called auction the man on the block is
            # the dearest one left, so "wait for a better one" is not a question anybody has to ask,
            # and the arm can bid his worth. Drawn at random he is just A man of that role, with 130
            # more behind him - and paying his full worth for coverage that ten better men would also
            # have given is how the arm bought pv 13-24 instead of pv 23-31 and finished with 74 holes.
            mine, other = engine_worth(man, self), self.alternative(man, urn)
            worth = max(0.0, mine - ALT_WEIGHT * other)
            rate = self.live_rate(urn) if LIVE_RATE else self.rate
            # ...and ONE MULTIPLIER, which is not a fourth term because it is not about points: how much
            # this squad still wants the role at all (depth) and how concentrated it already is on this
            # man's real club (risk). Both are constraints - «differenziare» is a decision about the
            # tracollo you avoid, not about the points you expect.
            bid = max(1, round(worth * rate * need * club_weight(man, self)))
            # ...AND THE SAME FLOOR AS EVERYBODY ELSE: what the purse can afford per remaining slot. The
            # engine arm was the only participant allowed to keep credits, because this branch returns
            # before the rule below - and it ended the auction on 888 of 1000 while the table spent
            # 956-1000. A rule that applies to every profile but the one being judged is not a rule.
            #
            # AND THE FLOOR IS NOT SUBJECT TO THE DEPARTMENT'S CEILING, which is the second half of the
            # same defect and survived the first fix: `role_cap` was eating the floor, so the arm still
            # kept 67 credits while the table kept 0-20. A ceiling is a RATIONING device, and rationing a
            # purse that can no longer be spent on anything else is not caution, it is waste - the humans
            # have no per-department ceiling at all. Measured when the clip was removed: 2658.8 -> 2665.5
            # points, spend 933 -> 988, holes 13.8 -> 12.4, mean place 1.90 -> 1.70. Note the direction:
            # the defect PENALISED the arm being judged, so every margin published before this was
            # conservative rather than flattering - which is the only kind of bug to find in your own
            # favour's opposite.
            slack = room / max(1, self.slots_left()) * self.reach(man, urn)
            capped = min(room, self.cap, self.role_cap(role), bid)
            if FLOOR_ON_BETTER and mine < other:
                # "SPEND IT OR LOSE IT" NEVER MEANS BUYING A MAN WORSE THAN THE ONE WHO IS COMING.
                # At a random extraction a slot is as scarce as a credit - the draft bench's own
                # lesson, met halfway - so a floor that creates appetite for a man this squad does not
                # want does not spend a credit, it spends a SLOT, and the credit stays in the purse
                # anyway. The floor is there to raise a ceiling, never to invent a bid.
                return capped
            return max(capped, min(room, self.cap, round(ABUNDANCE * slack)))
        # A SLOT KEPT FOR A CHAMPION IS NOT FOR SALE. First of all the tests, because it is a
        # decision about the SLOT and not about the price: no ceiling, however low, can leave a place
        # free for a man who has not been drawn yet.
        if self.keeps(man, urn):
            return 0
        want = self.step(man)
        # THE EXPERT READS THE MAN AND NOT ONLY THE ASK PRICE: his ceiling is blended toward what the
        # engine's surplus says the man is worth, which is the auditable stand-in for «sa valutare al
        # momento l'asta ed il valore dei calciatori astati». The novice has no such term and reads the
        # quotation alone. Same ladder for both, because neither of them has a plan.
        if self.eye and man.get("surplus"):
            fair = engine_bid(man, self.rate) / max(1.0, man["price"])
            want = want * (1 - self.eye) + fair * self.eye
        # WHOEVER HAS NO PLAN DOES NOT PAY THE LIST PRICE TO EVERYBODY: he gets carried away on some
        # names and forgets others, and that scatter IS the profile. Without it «no plan» becomes
        # «pays the going rate for all», which is a disciplined strategy under a misleading name - and
        # it was winning the first run of this bench for exactly that reason. The draw is deterministic
        # per (participant, man) so the bench stays reproducible.
        if self.scatter:
            spread = (self.draw(man["id"]) - 0.5) * 2 * self.scatter
            want = max(0.0, want * (1.0 + spread))
        # NOBODY ENDS AN AUCTION WITH CREDITS IN HIS POCKET - and since 02/09/2026 that is the SCALE
        # and no longer a floor per remaining slot: the recipe is normalised to what is left to spend,
        # so the money goes where his own plan puts it instead of being spread evenly over whoever
        # comes up. See `Team.scale` for the numbers that forced the change. Measured on the real
        # auctions: 2,8% of a budget stays in pocket at a called auction and 6,1% at a drawn one, which
        # is what a self-correcting scale gives and a flat floor did not.
        want *= self.scale()
        if want <= 0:
            return 0
        bid = min(room, self.cap, max(1, round(man["price"] * want)))
        # ...AND THE MONEY HE IS KEEPING FOR A TARGET IS NOT AVAILABLE FOR ANYBODY ELSE. Never below one
        # credit, so a plan can slow a squad down and never stop it closing.
        held_back = self.reserved(man, urn)
        return min(bid, max(1, room - held_back)) if held_back else bid

    def take(self, man: dict, paid: int) -> None:
        self.men[man["slot"].upper()].append({**man, "paid": paid})
        self.left -= paid


def auction(pool: list[dict], teams: list[Team], order: list[dict] | None = None) -> None:
    """One auction: the winner pays the SECOND price plus one. `order` says which name comes up when.

    TWO MECHANISMS, ONE PRICE RULE. With `order` left out the names are CALLED dearest first, which is
    what this bench measured until 02/09/2026. With `order` given - `extraction_order` - the platform
    DRAWS them, which is the auction the operator will actually play, and the difference is not
    cosmetic: at a called auction the order rations the purses for everybody (you cannot spend on a
    striker who has not been called yet, and once he has, there is no better one behind him), while at
    a random one the rationing is the bidder's own problem. See `Team.reach`.

    The second-price rule is not a convenience, it is what a raise IS - and it is what makes the top
    striker's price EMERGE (48-75% of the budget across four seasons, mean 60%, which is the number the
    operator reports from experience) instead of being assumed by whoever wrote the model.

    AND THE RE-OFFER BELONGS TO THE PHASE: a man nobody bid on comes back inside his own department and
    never after all four of them, because in the archive a role's awards are contiguous. See the loop.

    A TIE IS BROKEN BY A DRAW AND NEVER BY THE NAME. It used to be alphabetical, which is invisible
    while every participant is called after his profile and becomes a real advantage the moment they are
    named after the operator's own table (A...L): the letter A would win every tie of the auction. At a
    real table a tie goes to whoever shouted first, which is nobody in particular - so it goes to a
    reproducible draw per (participant, man), the same one the scatter uses. Measured on the declared
    table before switching it over: 2657.1 -> 2658.8 points for the engine arm and 2.10 -> 1.90 of mean
    place, with the ORDER of the six profiles unchanged - i.e. the bias was latent rather than active,
    which is exactly when to fix one. What it does move is the dispersion (sd 51.9 -> 42.6), because a
    tie is now decided by the man rather than always by the same participant.
    """
    lots = called_order(pool) if order is None else order
    urn = Urn(lots)
    urn.random = order is not None
    # A PASSED MAN COMES BACK INSIDE HIS OWN PHASE, never after all four of them. The re-offer was
    # written before `PHASES` and kept a single queue, so a participant who let a whole department go
    # by met it again only once every other roster was full - and the archive says a role's awards are
    # CONTIGUOUS (a ten-team auction awards exactly 30 keepers, then 80 defenders, then 80 midfielders,
    # then 60 forwards, which is how the role can be read off the award position at all). MEASURED
    # before adopting: on the declared table it moves NOTHING - 0 differences over 1000
    # participant-seasons, and 0 awards happen after the first pass at all, so the re-offer this cures
    # is a corner the declared table never enters. It is switched by the mechanism, like everything
    # else here: a called auction is one queue and one pass.
    for block in ([lots] if order is None else in_phases(lots)):
        waiting = block
        while waiting:
            passed: list[dict] = []
            for man in waiting:
                # He is ON THE BLOCK, so he is out of the urn before anybody prices him: what a bidder may
                # read is what is left AFTER this man, never what is coming next.
                urn.take(man)
                urn.demand = sum(t.slots_left() for t in teams)
                for role in rules.SLOTS:
                    urn.needing[role] = sum(1 for t in teams if len(t.men[role]) < rules.SLOTS[role])
                bids = sorted(((t.bid(man, urn), t) for t in teams),
                              key=lambda x: (-x[0], x[1].draw(man["id"])))
                if not bids or bids[0][0] < 1:
                    # NOBODY BID: he is not gone, he is BACK IN THE URN. See `Urn.back` for the five real
                    # auctions this was measured on. It is the mechanism and not a strategy, so it is not
                    # a parameter either.
                    passed.append(man)
                    urn.back(man)
                    continue
                second = bids[1][0] if len(bids) > 1 else 0
                paid = max(1, min(bids[0][0], second + 1))
                bids[0][1].take(man, paid)
                if all(t.slots_left() == 0 for t in teams):
                    return
            # A CALLED AUCTION IS ONE PASS: there the manager chooses whom to put up, and nobody
            # calls a man nobody wants. A pass that sells nothing ends the PHASE whatever the
            # mechanism - there is no price at which those rosters and those men agree.
            if not urn.random or len(passed) == len(waiting):
                break
            waiting = passed


def line_up_order(team: Team) -> dict[str, list[dict]]:
    """The order the ENGINE's own forecast puts this squad in, per role: `fm_pred x pv_pred`.

    A forecast made before the season, so reading it is legitimate; a man the engine does not price
    sorts last, which is "vuoto = ignoto" and not a zero.
    """
    return {role: sorted(team.men[role], key=lambda m: -(m.get("value") or -1.0))
            for role in team.men}


DAY_KEYS = ("points", "r_factor", "defence", "holes", "zeros", "killed", "no_base")


def matchday(order: dict[str, list[dict]], votes: dict, base: dict, day: str) -> dict:
    """ONE matchday of one squad: who fills each place, what it scores, and what was missing.

    The regulation does all of it: substitutions of the same role, the deputy vote, and the two
    modifiers - which a single deputy vote annuls outright.

    Extracted from `season` because the head-to-head league (`league.py`) needs the same quantity per
    ROUND rather than per season, and two definitions of "what did this squad score on matchday 12"
    would eventually give one squad two totals - with the first place anybody noticed being a standings
    table. One definition, two readers, which is this project's own rule.
    """
    subs = rules.SUBSTITUTIONS
    fielded: list[tuple[str, list[dict]]] = []
    deputies: list[str] = []
    holes = 0
    for role, wanted in rules.FIELDED.items():
        available = [m for m in order[role] if votes.get(str(m["id"]), {}).get(day) is not None]
        picked = available[:wanted]
        missing = wanted - len(picked)
        while missing and subs and len(available) > len(picked):
            picked.append(available[len(picked)])
            missing -= 1
            subs -= 1
        fielded.append((role, picked))
        deputies += [role] * missing
        holes += missing
    row = {key: 0.0 for key in DAY_KEYS}
    row["holes"] = holes
    row["points"] = sum(votes[str(m["id"])][day] for _role, picked in fielded for m in picked)
    row["fielded"] = [m["id"] for _role, picked in fielded for m in picked]
    if deputies:
        # The FIRST deputy vote is worth its value, every other one is worth zero - and both
        # modifiers are gone. This clause is why coverage outweighs any single purchase.
        row["points"] += max(rules.deputy_value(role) for role in deputies)
        row["zeros"] = len(deputies) - 1
        row["killed"] = 1
        return row
    eleven = [base.get(str(m["id"]), {}).get(day) for _role, picked in fielded for m in picked]
    if any(v is None for v in eleven):
        # A man with a fantavoto and no base vote cannot be judged against the pass mark, so the
        # modifiers are SKIPPED rather than guessed - and the row counts how often that happened.
        row["no_base"] = 1
        return row
    row["r_factor"] = rules.r_factor([v for v in eleven if v is not None])
    defenders = [base.get(str(m["id"]), {}).get(day)
                 for role, picked in fielded if role == "D" for m in picked]
    row["defence"] = rules.defence_modifier([v for v in defenders if v is not None])
    row["points"] += row["r_factor"] + row["defence"]
    return row


def season(team: Team, votes: dict, base: dict, rounds: int) -> dict:
    """The season of one squad: the ENGINE picks who plays, the outcome says what they scored."""
    order = line_up_order(team)
    days = [matchday(order, votes, base, str(day)) for day in range(1, rounds + 1)]
    return {**{key: sum(day[key] for day in days) for key in DAY_KEYS},
            "spent": team.budget - team.left,
            # SLOTS NEVER FILLED, which a called auction cannot produce and a random one can: the urn
            # holds 359-430 men for 250 places, so a squad that waits for a keeper can find the urn
            # empty. Counted apart from `holes` - a matchday with nobody to field is the CONSEQUENCE,
            # an empty slot is the cause, and reporting only the first hides which of the two happened.
            "unfilled": team.slots_left()}


def priced_pool(window: dict) -> list[dict]:
    """The window's men with their Qt.I converted into the credits of this league - once per window."""
    pool = [dict(man) for man in window["players"] + list(window.get("others", []))]
    factor = to_credits(pool)
    for man in pool:
        man["price"] = max(1.0, man["price"] * factor)
        fm, pv = man.get("fm_pred"), man.get("pv_pred")
        man["value"] = fm * pv if fm is not None and pv is not None else None
    set_tiers(pool)
    set_insight(pool)
    return pool


def window_seed(key: str, draw: int) -> int:
    """The seed of one extraction, fixed by (window, draw) so a table can be re-read a year later."""
    return zlib.crc32(f"{key}|{draw}".encode())


def one_auction(pool: list[dict], table: tuple[tuple[str, int], ...], with_engine: bool | int,
                window: dict, shares: dict[str, float], rate: float,
                order: list[dict] | None) -> list[tuple[dict, Team]]:
    """One auction on one order of the lots, and the season the squads it built then played."""
    # THE ARM TAKES A CHAIR RATHER THAN PULLING ONE UP, so the table is always ten: see `seated`.
    counted: dict[str, int] = {}
    teams = []
    for profile in seated(table, int(with_engine)):
        counted[profile] = counted.get(profile, 0) + 1
        teams.append(Team(f"{profile}#{counted[profile] - 1}", profile, PROFILES[profile]))
    asks = tier_asks(pool)
    for team in teams:
        team.matchdays = window["rounds"]
        team.asks = asks
        # THE RATE BELONGS TO WHOEVER READS THE ENGINE, not only to the engine arm. Without it the
        # expert compared a surplus in FANTAPUNTI with a price in CREDITS - the scale was out by the
        # rate itself, so he undervalued every dear man and overvalued every cheap one, ended the
        # auction 153 credits short and lost to the novice. The operator spotted it from the result:
        # «non e' normale che il novizio batta l'esperto, il novizio dovrebbe avere dei buchi».
        team.rate = rate
    for seat in range(int(with_engine)):
        # MORE THAN ONE SEAT IS THE NULL, not a feature: a strategy that only wins because the rest of
        # the table wastes its money is not a strategy, and the cheapest way to ask is to sit it down
        # against itself. See the README.
        engine = Team(f"ENGINE#{seat}", "ENGINE", None)
        engine.rate = rate
        engine.shares = shares
        # ...AND WHAT EACH TIER ASKS, like everybody else at the table: the arm reads them at a drawn
        # auction (`profiles.engine_ladder`). It is appended after the loop above, so forgetting this
        # line switches the ladder off in silence - which it did, and the giveaway was a table of
        # results identical to the decimal.
        engine.asks = tier_asks(pool)
        # READ FROM THE MODULE AT CALL TIME, never bound at import: a knob turned where nobody reads it
        # prints identical rows, which has now cost this bench two experiments (§16.9, §17.7).
        engine.insight = INSIGHT
        engine.matchdays = window["rounds"]
        teams.append(engine)
    auction(pool, teams, order)
    scored = [(season(t, window["votes"], window.get("base", {}), window["rounds"]), t)
              for t in teams]
    return [({**result, "place": place}, team)
            for place, (result, team) in enumerate(sorted(scored, key=lambda x: -x[0]["points"]), 1)]


def run(table: tuple[tuple[str, int], ...], with_engine: bool | int, draws: int = 0) -> dict:
    """The ten windows. `draws` = 0 CALLS the lots dearest first; N > 0 DRAWS N extractions of each.

    A RANDOM EXTRACTION IS NOT ONE EXPERIMENT, which is the whole reason for `draws`: the same window
    on two urns is two different auctions, so a single order measures the luck of that order and
    nothing else. Every figure is then the mean over `windows x draws` seasons, and the dispersion
    carries what the mechanism itself adds - which is a quantity the called auction does not have.
    """
    windows = json.loads(WINDOWS_FILE.read_text(encoding="utf-8"))
    per_profile: dict[str, list[dict]] = {}
    per_window: dict[str, dict[str, float]] = {}
    for key, window in windows.items():
        pool = priced_pool(window)
        shares, rate = role_shares(pool), engine_rate(pool)
        rows: list[tuple[dict, Team]] = []
        for draw in range(max(1, draws)):
            order = extraction_order(pool, window_seed(key, draw)) if draws else None
            rows += one_auction(pool, table, with_engine, window, shares, rate, order)
        for result, team in rows:
            per_profile.setdefault(team.profile, []).append({**result, "window": key})
        per_window[key] = {profile: st.mean(r["points"] for r, t in rows if t.profile == profile)
                           for profile in {t.profile for _r, t in rows}}
    return {"profiles": per_profile, "windows": per_window, "draws": draws}


def report(result: dict) -> None:
    profiles = result["profiles"]
    order = sorted(profiles, key=lambda p: -st.mean(r["points"] for r in profiles[p]))
    draws = result.get("draws") or 0
    print(f"extraction: {draws} random draws per window" if draws
          else "extraction: called, dearest first")
    print(f"{'profile':22s} {'points':>9s} {'sd':>7s} {'worst':>8s} {'place':>7s} "
          f"{'holes':>7s} {'empty':>6s} {'R':>6s} {'def':>6s} {'spent':>7s} {'wins':>8s}")
    for profile in order:
        rows = profiles[profile]
        pts = [r["points"] for r in rows]
        wins = sum(1 for r in rows if r["place"] == 1)
        print(f"{profile:22s} {st.mean(pts):9.1f} {st.pstdev(pts):7.1f} {min(pts):8.0f} "
              f"{st.mean(r['place'] for r in rows):7.2f} {st.mean(r['holes'] for r in rows):7.1f} "
              f"{st.mean(r.get('unfilled', 0) for r in rows):6.2f} "
              f"{st.mean(r['r_factor'] for r in rows):6.1f} {st.mean(r['defence'] for r in rows):6.1f} "
              f"{st.mean(r['spent'] for r in rows):7.0f} {wins:4d}/{len(rows):<3d}")
    skipped = st.mean(r["no_base"] for rows in profiles.values() for r in rows)
    print(f"\nmatchdays whose modifiers were skipped for a missing base vote: {skipped:.1f} per season")
    print(f"\n{'window':8s} " + " ".join(f"{p.split()[0]:>8s}" for p in order))
    for key, row in result["windows"].items():
        print(f"{key:8s} " + " ".join(f"{row.get(p, float('nan')):8.0f}" for p in order))


def main() -> None:
    parser = argparse.ArgumentParser(description="judge auction strategies on the gate's windows")
    parser.add_argument("--engine", nargs="?", type=int, const=1, default=0, metavar="SEATS",
                        help="add SEATS participants (default 1) that bid on the engine's own worth; "
                             "more than one is the NULL - does the edge survive its own competition?")
    parser.add_argument("--random", dest="draws", nargs="?", type=int, const=20, default=0,
                        metavar="DRAWS",
                        help="the platform DRAWS the lots instead of calling them, DRAWS times per "
                             "window (default 20): one order measures the luck of that order")
    args = parser.parse_args()
    if not WINDOWS_FILE.exists():
        raise SystemExit(f"missing {WINDOWS_FILE.name}: run bench/draft/extract.py first")
    report(run(DECLARED_TABLE, args.engine, args.draws))


if __name__ == "__main__":
    main()
