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
import json
import statistics as st
import zlib
from pathlib import Path

from . import rules
from .profiles import (ABUNDANCE, CAUTIOUS_CAP_SHARE, EXPERT_EYE, MENTAL_CAP_SHARE, PROFILES,
                       SCATTER, URGENCY)

WINDOWS_FILE = Path(__file__).resolve().parents[1] / "draft" / "leghe-classic.json"

#: The table the operator says he normally finds (01/09/2026): 4 with no plan, 1 defence, 3 balanced,
#: 2 for the top striker. The four «no plan» are split into expert and novice on his instruction of the
#: same day - «l'esperto sa valutare al momento l'asta, l'inesperto un po' si fida ciecamente della QI e
#: un po' fa degli errori grossolani» - because those are two different players, not one with noise.
DECLARED_TABLE: tuple[tuple[str, int], ...] = (
    ("P1a no plan, expert", 2), ("P1b no plan, novice", 2),
    ("P2 defence", 1), ("P3 balanced", 3), ("P4 top striker", 2),
)

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

    def bid(self, man: dict) -> int:
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
            # TWO TERMS THAT COUNT, ADDED, AND A THIRD MEASURED AT ZERO. They answer different questions
            # and no single one is the worth of a man in this league: how much he SCORES over the man who
            # would play instead (surplus), and how many empty matchdays he REMOVES (cover). The arm had
            # only the first and finished last of eleven; with the second it wins. The third - steadiness,
            # the currency of both modifiers - is measured and switched off: see `STEADY_WEIGHT`.
            worth = ((man.get("surplus") or 0.0)
                     + cover_value(man, self, self.matchdays)
                     + STEADY_WEIGHT * steady_value(man, self, self.matchdays))
            # ...and ONE MULTIPLIER, which is not a fourth term because it is not about points: how much
            # this squad still wants the role at all (depth) and how concentrated it already is on this
            # man's real club (risk). Both are constraints - «differenziare» is a decision about the
            # tracollo you avoid, not about the points you expect.
            bid = max(1, round(worth * self.rate * need * club_weight(man, self)))
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
            slack = room / max(1, self.slots_left())
            capped = min(room, self.cap, self.role_cap(role), bid)
            return max(capped, min(room, self.cap, round(ABUNDANCE * slack)))
        ladder = self.recipe[role]
        want = ladder[held] if held < len(ladder) else ladder[-1]
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
        # NOBODY ENDS AN AUCTION WITH CREDITS IN HIS POCKET, and the operator put it as the thing a real
        # table would obviously do: «avrebbero rilanciato sicuramente per qualche attaccante piu' forte
        # alla fine piuttosto che restare con crediti non spesi».
        #
        # So the floor of a ceiling is what the purse can AFFORD PER REMAINING SLOT: with 400 credits and
        # three slots to fill, 133 a man is not generous, it is arithmetic - every credit left over is a
        # credit thrown away. `want` (the recipe) can raise that, never lower it.
        #
        # The first version tested `slack >= price` and only then paid the LIST price, which fires far too
        # late: it left P1a with 828 of 1000, P3 with 840 and P4 with 495, all of them holding money while
        # better strikers went past. This form has no threshold at all - it is simply the affordable
        # share - and it is why it fires on the last rounds by itself.
        slack = (self.left - (self.slots_left() - 1)) / max(1, self.slots_left())
        if want > 0 and slack > 0:
            want = max(want, ABUNDANCE * slack / max(1.0, man["price"]))
        if want <= 0:
            return 0
        return min(room, self.cap, max(1, round(man["price"] * want)))

    def take(self, man: dict, paid: int) -> None:
        self.men[man["slot"].upper()].append({**man, "paid": paid})
        self.left -= paid


def auction(pool: list[dict], teams: list[Team]) -> None:
    """A called auction: the dearest names go first, and the winner pays the SECOND price plus one.

    The second-price rule is not a convenience, it is what a raise IS - and it is what makes the top
    striker's price EMERGE (48-75% of the budget across four seasons, mean 60%, which is the number the
    operator reports from experience) instead of being assumed by whoever wrote the model.

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
    for man in sorted(pool, key=lambda m: -m["price"]):
        bids = sorted(((t.bid(man), t) for t in teams),
                      key=lambda x: (-x[0], x[1].draw(man["id"])))
        if not bids or bids[0][0] < 1:
            continue
        second = bids[1][0] if len(bids) > 1 else 0
        paid = max(1, min(bids[0][0], second + 1))
        bids[0][1].take(man, paid)
        if all(t.slots_left() == 0 for t in teams):
            return


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
            "spent": team.budget - team.left}


def run(table: tuple[tuple[str, int], ...], with_engine: bool) -> dict:
    windows = json.loads(WINDOWS_FILE.read_text(encoding="utf-8"))
    per_profile: dict[str, list[dict]] = {}
    per_window: dict[str, dict[str, float]] = {}
    for key, window in windows.items():
        pool = [dict(man) for man in window["players"] + list(window.get("others", []))]
        factor = to_credits(pool)
        for man in pool:
            man["price"] = max(1.0, man["price"] * factor)
            fm, pv = man.get("fm_pred"), man.get("pv_pred")
            man["value"] = fm * pv if fm is not None and pv is not None else None
        teams = [Team(f"{profile}#{i}", profile, PROFILES[profile])
                 for profile, count in table for i in range(count)]
        shares = role_shares(pool)
        rate = engine_rate(pool)
        for team in teams:
            team.matchdays = window["rounds"]
            # THE RATE BELONGS TO WHOEVER READS THE ENGINE, not only to the engine arm. Without it the
            # expert compared a surplus in FANTAPUNTI with a price in CREDITS - the scale was out by the
            # rate itself, so he undervalued every dear man and overvalued every cheap one, ended the
            # auction 153 credits short and lost to the novice. The operator spotted it from the result:
            # «non e' normale che il novizio batta l'esperto, il novizio dovrebbe avere dei buchi».
            team.rate = rate
        if with_engine:
            engine = Team("ENGINE#0", "ENGINE", None)
            engine.rate = rate
            engine.shares = shares
            engine.matchdays = window["rounds"]
            teams.append(engine)
        auction(pool, teams)
        scored = [(season(t, window["votes"], window.get("base", {}), window["rounds"]), t)
                  for t in teams]
        for place, (result, team) in enumerate(sorted(scored, key=lambda x: -x[0]["points"]), 1):
            per_profile.setdefault(team.profile, []).append({**result, "place": place, "window": key})
        per_window[key] = {
            profile: st.mean(r["points"] for r, t in scored if t.profile == profile)
            for profile in {t.profile for t in teams}
        }
    return {"profiles": per_profile, "windows": per_window}


def report(result: dict) -> None:
    profiles = result["profiles"]
    order = sorted(profiles, key=lambda p: -st.mean(r["points"] for r in profiles[p]))
    print(f"{'profile':22s} {'points':>9s} {'sd':>7s} {'worst':>8s} {'place':>7s} "
          f"{'holes':>7s} {'R':>6s} {'def':>6s} {'spent':>7s} {'wins':>8s}")
    for profile in order:
        rows = profiles[profile]
        pts = [r["points"] for r in rows]
        wins = sum(1 for r in rows if r["place"] == 1)
        print(f"{profile:22s} {st.mean(pts):9.1f} {st.pstdev(pts):7.1f} {min(pts):8.0f} "
              f"{st.mean(r['place'] for r in rows):7.2f} {st.mean(r['holes'] for r in rows):7.1f} "
              f"{st.mean(r['r_factor'] for r in rows):6.1f} {st.mean(r['defence'] for r in rows):6.1f} "
              f"{st.mean(r['spent'] for r in rows):7.0f} {wins:4d}/{len(rows):<3d}")
    skipped = st.mean(r["no_base"] for rows in profiles.values() for r in rows)
    print(f"\nmatchdays whose modifiers were skipped for a missing base vote: {skipped:.1f} per season")
    print(f"\n{'window':8s} " + " ".join(f"{p.split()[0]:>8s}" for p in order))
    for key, row in result["windows"].items():
        print(f"{key:8s} " + " ".join(f"{row.get(p, float('nan')):8.0f}" for p in order))


def main() -> None:
    parser = argparse.ArgumentParser(description="judge auction strategies on the gate's windows")
    parser.add_argument("--engine", action="store_true",
                        help="add one more participant that bids on the engine's surplus")
    args = parser.parse_args()
    if not WINDOWS_FILE.exists():
        raise SystemExit(f"missing {WINDOWS_FILE.name}: run bench/draft/extract.py first")
    report(run(DECLARED_TABLE, args.engine))


if __name__ == "__main__":
    main()
