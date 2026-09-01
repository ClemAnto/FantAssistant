"""The REGULATION of the operator's classic league, dictated on 01/09/2026 and read here, never fitted.

Same standing as `config/mantra_modules.json` and `config/classic_modules.json`: these numbers are a
published rulebook, so the only thing this file may get wrong is the transcription - and the
transcription was checked against the screenshot of the league's own settings page.

WHAT MAKES THIS LEAGUE DIFFERENT from the scoring every other harness assumes: the two modifiers ADD UP
(in mantra they do not - there the defence modifier does not exist and the D-Factor is another rule), and
a single DEPUTY VOTE wipes them both out. That last clause is what makes coverage worth more than any
single purchase, and it is measured rather than asserted: over 120 simulated squads the correlation of
final points with holes is -0.79, with credits spent +0.13.
"""
from __future__ import annotations

#: Squad and pitch. 3/8/8/6 is the league's own roster; the shape is the one the operator plays, and
#: with the defence modifier switched on a back FOUR is the only shape that can collect it.
SLOTS: dict[str, int] = {"P": 3, "D": 8, "C": 8, "A": 6}
FIELDED: dict[str, int] = {"P": 1, "D": 4, "C": 3, "A": 3}
BUDGET = 1000
TEAMS = 10

#: Substitutions available each matchday, same role only.
SUBSTITUTIONS = 3

#: THE DEPUTY VOTE: what a place is worth when nobody fills it with a real vote.
#: «se il titolare non gioca e in panchina non hai sostituti, la riserva d'ufficio vale 4 per i
#: calciatori di movimento e 3 per i portieri. Se in una partita ci fossero piu' riserve d'ufficio, la
#: seconda e le successive valgono 0.»
DEPUTY_OUTFIELD = 4.0
DEPUTY_KEEPER = 3.0

#: R-FACTOR, on the BASE vote: «se tutti e 11 prendono almeno 6 guadagni +2; per ogni calciatore sotto
#: il 6 perdi mezzo punto; il bonus non scende sotto lo 0». So it is gone at four insufficient men.
R_FACTOR_MAX = 2.0
R_FACTOR_STEP = 0.5
PASS_MARK = 6.0

#: DEFENCE MODIFIER: applies when at least four defenders are fielded, on the mean of the best THREE.
#: The bands are the league's own settings page, transcribed as they stand - note that 6.00-6.25 and
#: 6.25-6.50 both pay 0.5, and 6.50-6.75 and 6.75-7.00 both pay 1: the scale has three effective steps
#: even though it is written in six rows, and its ceiling of +2 is reached on 3% of the matchdays of a
#: top defence. Below 6 it pays nothing.
DEFENCE_BANDS: tuple[tuple[float, float, float], ...] = (
    (6.00, 6.50, 0.5),
    (6.50, 7.00, 1.0),
    (7.00, 99.0, 2.0),
)
DEFENCE_MIN_FIELDED = 4
DEFENCE_BEST = 3


def deputy_value(role: str) -> float:
    """What the FIRST deputy vote of a matchday is worth. Every one after it is worth zero."""
    return DEPUTY_KEEPER if role == "P" else DEPUTY_OUTFIELD


def r_factor(base_votes: list[float]) -> float:
    """The performance modifier, from the base votes of the eleven that took the pitch.

    Called only when the eleven is COMPLETE: a deputy vote annuls this modifier outright («una riserva
    d'ufficio annulla sia r-factor che il mod.dif»), which is a different statement from «that man
    counts as insufficient» and worth far more - it is the whole bonus rather than half a point.
    """
    short = sum(1 for vote in base_votes if vote < PASS_MARK)
    return max(0.0, R_FACTOR_MAX - R_FACTOR_STEP * short)


def defence_modifier(defender_votes: list[float]) -> float:
    """The defence modifier from the base votes of the defenders fielded, or 0 when it cannot apply.

    Zero has two different meanings here and the caller owes the distinction: fewer than four defenders
    fielded (the modifier does not apply) and a mean below 6 (it applies and pays nothing).
    """
    if len(defender_votes) < DEFENCE_MIN_FIELDED:
        return 0.0
    best = sorted(defender_votes, reverse=True)[:DEFENCE_BEST]
    mean = sum(best) / len(best)
    for low, high, value in DEFENCE_BANDS:
        if low <= mean < high:
            return value
    return 0.0


# ------------------------------------------------------------------------------------------------
# HEAD TO HEAD. Everything above decides what a squad SCORES on a matchday; this decides who WINS the
# match, which is a different question and the one a championship is played on.
#
# DECLARED like the rest of this file, and the standard conversion of an Italian classic league: 66
# fantapunti are one goal and every 6 above it is another (66 -> 1, 72 -> 2, 78 -> 3), below 66 nothing.
# Two consequences worth stating before any number is read, because they are properties of the ladder
# and not of anybody's strategy: it is a STAIRCASE, so 65.9 and 60.0 are the same result and 71.9 and
# 66.0 are too; and it TRUNCATES at the bottom, so the points a squad throws away below 66 are lost in a
# way the seasonal mean cannot see. That is why a table can disagree with a ranking by total points.
GOAL_FLOOR = 66.0
GOAL_STEP = 6.0

#: The championship's own points, and the tie-break, in order. Declared: this league plays three points
#: for a win, and settles a tie on goal difference, then goals scored, then the total fantapunti of the
#: season - which is the ranking the bench measured until now, kept here as the LAST word rather than
#: the first.
WIN_POINTS = 3
DRAW_POINTS = 1


def goals(points: float) -> int:
    """How many goals a matchday total is worth. See the ladder above."""
    if points < GOAL_FLOOR:
        return 0
    return 1 + int((points - GOAL_FLOOR) // GOAL_STEP)
