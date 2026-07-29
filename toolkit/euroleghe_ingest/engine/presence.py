"""presence - who plays, and how much of a season: the formulas, with their parameters exposed.

Extracted from the Snapshot panel on 29/07/2026 for one reason: the constants in it are MODEL choices
(gate `7-bis`), and a parameter the gate owns cannot live inside a Tk view where no harness can reach
it. The panel now calls this module, `modules/sweep.py` sweeps it against realised appearances, and the
two can no longer disagree - which is the same discipline `snapshot` already follows for the `engine_*`
columns.

Dependency-free, like the rest of `engine/`: the shippable TypeScript engine gets ported from here.

THE UNIT, because it is what the whole file rests on: everything is a share of the CHAMPIONSHIP's
calendar. The numerators are league-only by construction (the season aggregate stores one row per
championship), so the calendar has to be too - a club's full fixture list is 66%-100% of it depending on
how far it went in Europe, and dividing one by the other made two clubs' percentages incomparable
(spec «Novità v9.11»). Absences arrive from an external source in ITS unit, every competition included,
so they are counted as league rounds where a calendar exists and scaled only as a declared fallback.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

# ---------------------------------------------------------------- the parameters
#
# PROVISIONAL unless the field says otherwise: they exist because the panel needed a number to draw a
# pitch, and the gate owes them a verdict (gate-motore-v1.md 7-bis / 7-ter). `modules/sweep.py` is what
# replaces one with a measured value or confirms it, and after the run of 29/07/2026 the state is:
#   standing_weights  MEASURED - (0, 1), strict and robust on all ten folds. No longer provisional.
#   contested_from    CONFIRMED - "measured" is the held-out pick on every fold, on both platforms.
#   arrival_discount  CONFIRMED - 0.80 is the pooled optimum on default and ties for it on euro, and the
#                     curve is steep (0.0 costs 30% more error), so the parameter matters and is right.
#   loan_discount     OPEN and platform-DEPENDENT: euro pulls to 0.2, default to 0.8, and the curve is
#                     flat between them. 0.60 sits in the middle and stays provisional.
#   injury_weights    the SHAPE is confirmed (both degenerate alternatives are worse: last-season-only is
#                     the worst value on both platforms), the TILT is open - the three candidates sit
#                     within 0.3% of each other and the two platforms prefer opposite ones.
#   availability_floor OPEN: monotone toward 0.6, but the whole grid spans 0.6% - under the gate's floor.
# Anything still marked open is quoted as provisional and never as established.


@dataclass(frozen=True)
class Params:
    """One set of the presence parameters. `replace(params, ...)` is how the sweep varies one of them."""

    # How much a season measured AT ANOTHER CLUB is worth toward THIS club's shirt. Two numbers because
    # there are two reasons to discount and they do not always both apply: it was earned in another side
    # (always), and being sent away is this club's own judgement of him (only if it had him to send).
    loan_discount: float = 0.60
    arrival_discount: float = 0.80
    # Recency of the injury history: this season, the one before, the one before that.
    injury_weights: tuple[float, ...] = (1.0, 0.6, 0.35)
    # A man is never assumed to miss more than this much of a season: a bad history is a discount, not a
    # verdict that he will not play.
    availability_floor: float = 0.40
    # How the standing splits between his START RATE and his SHARE OF THE MINUTES. The only one of these
    # parameters that is no longer provisional: `sweep` ran it on 29/07/2026 against the share of his
    # championship's rounds he actually STARTED next season, and (0, 1) - minutes alone - won on every one
    # of the ten window-platform folds, strict AND robust, mean gain +1.55% on euro (4 windows) and +1.32%
    # on default (6), worst fold +0.70%. The whole grid is monotone in that direction, so the reading is
    # the plain one: how long a coach keeps a man on the pitch says more about whether he will start next
    # season than how often he was in the eleven. `starts` is still the fallback for a player with no
    # minutes on file - no minutes recorded is not zero minutes played.
    # Report: data/reports/sweep_presence.json (`generated_at` is the provenance, as always).
    standing_weights: tuple[float, float] = (0.0, 1.0)
    # WHICH absences come off the denominator of the start rate:
    #   "measured" - the rounds he actually missed inside the measured season. A fact about the sample.
    #   "forecast" - the three-season weighted estimate, which is what the panel used until v9.11. It is
    #                also the number `availability` multiplies back in, so subtracting it here cancels
    #                out of `presence` almost exactly and the injury history becomes decoration.
    # Both are on the table and the gate decides; the shapes are named so a report can say which it ran.
    contested_from: str = "measured"

    def with_value(self, name: str, value) -> Params:
        return replace(self, **{name: value})


DEFAULTS = Params()


@dataclass(frozen=True)
class Inputs:
    """What one player's presence is computed from - all of it measurable before the auction.

    Deliberately not a CSV row: the panel builds this from the sheet, the sweep builds it from the DB for
    a window that was played years ago, and neither has to know the other's column names.
    """

    # the measured season, LEAGUE ONLY (his championship, not the cups)
    starts: float = 0.0
    appearances: float = 0.0
    minutes: float = 0.0
    # his club's calendar: the championship's rounds, and every fixture we know it played
    league_matches: float = 38.0
    fixtures: float = 0.0
    # Absences, in LEAGUE ROUNDS. `rounds_by_season` is most recent first, aligned with
    # `params.injury_weights`, with None for a season we had no calendar to count on - which is what makes
    # the weights SWEEPABLE: a pre-weighted total would freeze them at the values it was written with.
    rounds_measured: float | None = None
    rounds_by_season: tuple[float | None, ...] = ()
    # The source's own figure, over every competition, already weighted with the DEFAULT recency: the
    # fallback for a player whose club we have no calendar for. Not sweepable, and it says so.
    weighted_all: float | None = None
    known_injuries: bool = False
    # whose season it was
    minutes_here: float = 0.0
    minutes_elsewhere: float = 0.0
    was_here_before: bool = False


def at_club_weight(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much of his measured season counts toward THIS club's shirt: 1.0 all of it, less if elsewhere.

    The share of his minutes played where he is now, with the rest weighed at `loan_discount` if this club
    had already had him - it sent him away, and that is its own judgement - or at the milder
    `arrival_discount` if he arrives from a club that is not this one, which has never judged him. A man
    who never moved is untouched, a man whose whole season was elsewhere is discounted once, and a January
    transfer lands in between - which is also the answer to "the discount should shrink as he accumulates
    matches here": it already does, one match at a time, with no second parameter.

    Minutes rather than starts because they are the continuous measure: a substitute has a share too. No
    minutes on either side reads 1.0 - an unknown split must not penalise him.
    """
    total = inputs.minutes_here + inputs.minutes_elsewhere
    if not total:
        return 1.0
    discount = params.loan_discount if inputs.was_here_before else params.arrival_discount
    return (inputs.minutes_here + discount * inputs.minutes_elsewhere) / total


def absences_per_season(inputs: Inputs, params: Params = DEFAULTS) -> float | None:
    """His forecast absences for a season, in LEAGUE ROUNDS. None when there is no history at all.

    None is not zero, and the difference is deliberate: not knowing whether a man gets injured is not
    knowing, and a player with no id at the source must not be penalised for our gap.
    """
    if not inputs.known_injuries:
        return None
    counted = [(weight, rounds) for weight, rounds
               in zip(params.injury_weights, inputs.rounds_by_season, strict=False)
               if rounds is not None]
    if counted:
        # The average is over the seasons really measured, so a man with one missing season is not read as
        # having been healthy in it.
        return sum(weight * rounds for weight, rounds in counted) / sum(
            weight for weight, _rounds in counted)
    if inputs.weighted_all is None:
        return None
    # Fallback: the source counted every competition, so its number is scaled onto the league calendar by
    # the share of the club's fixtures that are league rounds. Approximate, and only as good as the
    # fixtures we parsed - which is exactly why counting the rounds exists.
    share = inputs.league_matches / inputs.fixtures if inputs.fixtures else 1.0
    return inputs.weighted_all / (sum(DEFAULTS.injury_weights) or 1.0) * share


def availability(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The share of a season a man like this one is fit for: 1.0 healthy, less for the injury-prone."""
    missed = absences_per_season(inputs, params)
    if missed is None:
        return 1.0
    return max(1.0 - missed / max(inputs.league_matches, 1.0), params.availability_floor)


def contested(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The championship rounds he was in CONTENTION for: the calendar, less what he missed of it.

    The denominator of every start rate here. Which absences come off it is `params.contested_from`, and
    the two answers are not interchangeable - see the note on the field.
    """
    if params.contested_from == "measured" and inputs.rounds_measured is not None:
        missed = inputs.rounds_measured
    else:
        missed = absences_per_season(inputs, params) or 0.0
    return max(inputs.league_matches - missed, 1.0)


def standing(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """His absolute standing in the side - the blasone - as a share of a season, 0..1.

    Two measured facts about how much the coach used him, both over the rounds he was there for: his START
    RATE, and his SHARE OF THE MINUTES. Neither is a fantacalcio quantity - surplus and quotation answer
    "is he worth buying", and a coach does not pick a side by them.

    Both are weighed by WHOSE season it was (`at_club_weight`): a standing built somewhere else is
    evidence about this shirt too, and weaker evidence. A man with no minutes on file is judged on his
    starts alone: no minutes recorded is not zero minutes played.
    """
    rounds = contested(inputs, params)
    weight = at_club_weight(inputs, params)
    starts = min(inputs.starts * weight / rounds, 1.0)
    if not inputs.minutes:
        return starts
    by_starts, by_minutes = params.standing_weights
    return by_starts * starts + by_minutes * min(inputs.minutes * weight / (rounds * 90.0), 1.0)


def presence(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The share of the club's MATCHDAYS he is expected to START in - the one number a shirt carries."""
    return min(standing(inputs, params) * availability(inputs, params), 1.0)


def voto_share(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """The share of the season's matchdays he is expected to get a VOTO in - not to START in.

    The difference is what a fantacalcio squad is actually bought on: a substitute who comes on every week
    scores every week, and `presence` deliberately does not count him. So this reads APPEARANCES over the
    rounds he was there for, discounted by `availability` exactly as `presence` is.

    An appearance is taken as a voto, which is the honest limit of the layer: the season aggregate cannot
    tell a ten-minute cameo from a full match.
    """
    rounds = contested(inputs, params)
    appearances = min(inputs.appearances * at_club_weight(inputs, params) / rounds, 1.0)
    return min(appearances * availability(inputs, params), 1.0)
