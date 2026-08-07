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
    # ...and the same discount for a man arriving from ANOTHER championship, which the data says is a
    # different event. Residual of next season's start share against his previous minutes, over 2324
    # player-seasons: stayed **+0.020** (n=1619, se 0.006), bought **−0.047** (n=705, se 0.011) - so the
    # discount is right and if anything mild. But split by kind: **intra-league −0.057** (n=543) against
    # **cross-league −0.013** (n=162, within half a sigma of zero). The man bought from abroad is nearly
    # unbiased; the one bought down the road is the one who pays. Defaults to the SAME value as
    # `arrival_discount`, so the incumbent is one discount for both and is literally a point of the grid -
    # a "None means fall back" would have been the same function and not the same object, which is how an
    # incumbent ends up unrepresentable in its own sweep.
    arrival_discount_cross: float = 0.80
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
    # WHAT THE CLUB HAS PUT INTO HIM, and how much it should weigh on being selected. The hypothesis: a
    # club that has spent wants to see the man play and the coach forgives him a bad match, at the expense
    # of a youth-team player. Two channels because they catch different players - the fee catches Isak, the
    # stature catches De Bruyne, who arrived for nothing - and BOTH START AT ZERO: the term is off until the
    # sweep says otherwise, which is the only honest default for a hypothesis nobody has scored yet.
    # Careful with what a verdict here would and would not mean: passing says investment predicts starts
    # beyond what minutes already say. It does NOT separate "he plays because the club paid" from "the club
    # paid because he is good" - that needs a design this data cannot give.
    fee_weight: float = 0.0
    stature_weight: float = 0.0
    # ...and the third channel, which is what §7-quater was waiting for: his MARKET VALUE as a share of
    # the value of his squad, read on the INPUT season. The fee is NULL for a free transfer, so it said
    # "no investment" about Modric and De Bruyne - the two names the hypothesis came from - while a market
    # value exists for every player the source has ever priced. Historical and dated, so a window reads the
    # input season and never the target one. Starts at ZERO like the other two.
    value_weight: float = 0.0
    # HOW MUCH A MEASURED WINDOW COUNTS when there is no season at all: 0.0 = not at all, which is what
    # the ENGINE keeps (its answer for that man is R13, already adopted on Serie A - presences from his
    # recent matches at the old club) and what every gate number was measured with. The PANEL turns it on
    # (`SnapshotView.PRESENCE`), because a board that draws nobody where the engine predicts somebody is
    # two answers to one question: Alajbegovic has 693 minutes over ten Bundesliga matches, the engine
    # prices his presences off exactly those, and the eleven had him at a standing of ZERO - not "low",
    # absent. Pre-registered as a model input in gate §7-octies; until that runs it is a DISPLAY choice and
    # says so, in the company of `FORM_WEIGHT` and `RECENT_PRIOR`.
    window_standing: float = 0.0
    # THE NULL for the conditional form, and it is not a channel: a lift of the SAME SHAPE with no
    # investment in it at all - `shrink_weight * (1 - measured)`. It exists because «a statistic must be
    # compared with the right null»: `unplayed` closes part of the gap between what a man played and a full
    # season, and a man who played little tends to play more next year whoever he is (mean reversion). If the
    # constant does what the market value does, then what passed the gate is the SHAPE and not the money.
    # Swept beside the two arms (§7-septies), never adopted: it is a measuring stick.
    shrink_weight: float = 0.0
    # Where it enters: "standing" adds to the standing itself; "arrival" instead closes part of the gap in
    # `at_club_weight`, which is the sharper version of the claim - a season played elsewhere counts more
    # toward this shirt when the club paid for him, and nothing changes for a man whose whole season is
    # already here (his minutes have said it).
    # ...and "unplayed", the THIRD form, pre-registered 05/08/2026 (gate §7-septies): the lift closes part of
    # the gap between what he PLAYED and a full season, so it is null by construction on a man who starts and
    # largest on the man the coach did not use. It exists because of what killed the other two: «the mechanism
    # is already absorbed by the minutes» - and where the minutes are not informative, nothing absorbs it.
    # The case it was written for is a striker the club paid 13M for and the outgoing coach refused to field.
    # THE QUALITY CHANNEL, off until the sweep says otherwise. «Un giocatore con SURPLUS maggiore,
    # nell'arco dell'anno, acquisirà più visibilità agli occhi dell'allenatore e quindi minutaggio» -
    # the operator, 06/08/2026. Stated on the SURPLUS it would be circular (surplus = FM x predicted
    # presences, and the presences come from this very standing), so what is swept is the part that is
    # not: role-relative FANTAMEDIA, in standard deviations, added to the standing.
    # Measured first, on 1758 (player, season) of Serie A - first half against second, same club, at least
    # five votes, controlling for the minutes he already played: partial r = +0.100, and the effect is
    # +1.5 minutes per round per standard deviation (forwards +2.9, r = +0.196; midfield and defence +1.3).
    # Real, and small: 1.5 of 90 is 0.017 of a season, while a real ballottaggio is a gap ten times that.
    # THE CAREER CHANNEL, off until the sweep says otherwise. Measured 06/08/2026: the mean fantamedia of
    # the seasons BEFORE the input one predicts next season's start share beyond the minutes already
    # played - but only for FORWARDS. Partial r +0.135 (n=264, +0.034 of start share per sd) against +0.010
    # over everybody, +0.020 on midfielders and **−0.054** on defenders. A single global weight would be
    # describing four different things at once, so the input is None outside the role it was fitted on.
    career_weight: float = 0.0
    quality_weight: float = 0.0
    # THE LEVEL CHANNEL, off until the sweep says otherwise. «Livello più alto puoi intenderlo anche con
    # Premier > Serie A» - the operator, 06/08/2026, and the data agrees: mean ClubElo is 1807 in the Premier
    # against 1610 in Serie A. Measured on 700 transfers, controlling for the minutes he played AND for his
    # fantamedia (so it is LEVEL and not quality in disguise): partial r +0.137 overall, +0.235 for forwards,
    # +0.040 of start share per +1 sd of Elo (1 sd = 127 points). Gate §7-terdecies.
    # ADOTTATO 06/08/2026 al valore 0.06 - lo sweep, non una scelta. Serie A: robust PASS, guadagno medio
    # +0.93% su 6 finestre, il cross-fit sceglie 0.08 in 5 fold su 6. euro: positivo su TUTTE e 4 le
    # finestre (peggiore +0.05%) e non robust solo perché la media, +0.46%, sta sotto la soglia dello 0.5%.
    # Entrambe le curve pooled hanno un minimo INTERNO - euro a 0.06, Serie A a 0.08, e risalgono a 0.12 -
    # che è la condizione che mancava a ogni altro candidato di oggi. 0.06 è l'ottimo di euro e cattura il
    # 90% del guadagno di Serie A (0.20106 contro 0.20084 al suo 0.08): un valore solo, quasi ottimo su
    # entrambe, invece di una costante che sarebbe giusta su una piattaforma e sbagliata sull'altra.
    level_weight: float = 0.06
    # ...and the SALTO: Elo(the club he played for) - Elo(the club that just bought him), standardised.
    # Pre-registered 07/08/2026 (gate §7-duovicies) from the operator's question - «cosa differenzia un
    # giocatore acquistato per riempire la rosa da uno preso per giocare titolare?» - after he refused the
    # obvious candidate on an argument that holds: the listone's Qt.I is not an objective value, it already
    # contains its author's opinion about the man's titolarità, so predicting titolarità with it is partly
    # circular. Measured at EQUAL MINUTES (the confound that ate the first attempt: the index `minutes x
    # Elo` correlates +0.769 with the minutes themselves, so it is the regression rewritten and not new
    # information): the gap scores r = +0.220 against the residual, the absolute origin level +0.117.
    # WHAT THE SIGN SAYS is the answer to the question: a POSITIVE gap - he comes from a stronger club than
    # the one buying him - means the model UNDER-predicts him. Chi scende di livello sale di ruolo: he was
    # behind better players and now he is not. The symmetric case is the commoner one, the regular starter
    # who steps UP a level and is over-predicted. And the gap beats the absolute level TWICE OVER, which is
    # also why this is not R5 in disguise: R5 read the destination Elo alone and was rejected four times.
    # 0.0 until the sweep says otherwise - no gate, no engine.
    level_gap_weight: float = 0.0
    # ...and the third of the family: WHERE HE STANDS IN THE DEPARTMENT HE JOINS, by the level of the
    # football he has played (`elo.personal_levels`, five seasons, minutes-weighted). The operator's
    # question was «cosa differenzia un giocatore acquistato per riempire la rosa da uno preso per
    # giocare titolare», and this is the answer that reads no quotation at all.
    # A BLEND and not a lift, and that is the whole lesson of gate §7-tervicies: as a CLASSIFIER the
    # rank is weak (it separates 40% from 34% of the next season's minutes), because for a man whose
    # minutes already say he plays it is answering a question that has an answer. Read as a second
    # term over the minutes it is the best thing measured on this population - r +0.286 for the
    # minutes alone, +0.109 for the rank alone, **+0.346 for 0.75 x minutes + 0.25 x rank**, with an
    # INTERIOR maximum (0.15 -> +0.329, 0.25 -> +0.346, 0.35 -> +0.339, 0.50 -> +0.283).
    # It fixes both directions: Atta, 75% of the minutes at Udinese, was last by rank and comes back
    # 10th of 48; Valdepenas, 2% of a season at Real Madrid, was FIRST and falls to 0.27.
    # 0.0 until the sweep says otherwise.
    level_rank_weight: float = 0.0
    # HOW MUCH OF A SEASON the standing was measured on, as a shrinkage: `m x r/(r+K) + prior x K/(r+K)`,
    # with r the rounds he was there for. K = 0 is the incumbent (no shrinkage) and there is no meaningful
    # negative direction - the null IS zero, which is why this grid is one-sided and says so.
    # MEASURED first (gate §7-quaterdecies, 2195 player-seasons): a standing built on few rounds does not
    # hold. Error = next season's real start share minus the standing - 3-10 rounds **+0.073**, 11-19
    # +0.048, 20-28 −0.021, 29-34 −0.027, 35+ −0.008; and isolating the high standings (> 0.55), a short
    # sample overshoots by **−0.190** against −0.092 for a full one. It cuts both ways, which is why a
    # shrinkage toward the mean is the right shape rather than a one-sided discount.
    # ADOTTATO 06/08/2026 a 10 giornate, ed è il verdetto più netto di tutta la sessione: euro **strict E
    # robust** (guadagno medio +2.82%, peggior fold +1.97%, tutti e quattro scelgono 10), default robust
    # (+1.96%, ogni fold positivo, cross-fit 10 su tre e 6 su tre). Minimo INTERNO su entrambe le curve, che
    # risalgono a 15 e 25: euro 0.20023 (K=0) -> 0.19454 (10) -> 0.19907 (25). Un ordine di grandezza sopra
    # ogni altro canale misurato oggi. Il prior di popolazione esce ~0.46-0.51, cioè mezza stagione.
    standing_prior_rounds: float = 10.0
    investment_shape: str = "standing"
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
    # ...and the WINDOW, for a man who has no season here at all: the matches we could measure elsewhere
    # and the minutes in them. Its own denominator is the point - ten matches at 69 minutes is 77% of the
    # football that was available to him, and reading those minutes against a 38-round season would call
    # the same man a 20% player.
    window_matches: float = 0.0
    window_minutes: float = 0.0
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
    # what the club put into him: his fee as a share of what it spent that window (0 = no new spending,
    # None = we have no fees for that club), and his Qt.I percentile within his role (None = unquoted)
    fee_share: float | None = None
    stature: float | None = None
    value_share: float | None = None
    # ...and what he SHOWED with the minutes he had: his measured fantamedia relative to his role, in
    # standard deviations (None = no season to read). Not a valuation and not a forecast - the operator's
    # hypothesis is that a coach watches, so the thing that has to be in here is what a coach saw.
    fm_z: float | None = None
    # ...and the LEVEL of the football those minutes were played at: the Elo of the club he played them for,
    # in standard deviations, and ONLY for a man who has changed club (None otherwise). Restricted on
    # purpose - it is the population the coefficient was measured on, and for a man who stayed the term
    # would silently become "his own club is strong", which is a different claim nobody has measured.
    level_z: float | None = None
    # ...and the SALTO between the two levels, standardised over the same population: how far he steps DOWN
    # (positive) or UP (negative) by moving. None for a man who stayed - his gap is zero by construction -
    # and None when either Elo is missing, which is «vuoto = ignoto» and not a gap of zero.
    level_gap_z: float | None = None
    # ...and his place in the department he JOINS, 0..1, by the level of the football he has played -
    # 0 the lowest of his role in the new squad, 1 the highest. None where it cannot be computed (no
    # matched club, or a department too thin to rank in), which is «vuoto = ignoto» and NOT a 0.5.
    level_rank: float | None = None
    # What a SHORT sample is shrunk toward. Supplied by the caller (the panel from its sheet, the sweep from
    # its window) because `presence` is dependency-free and an average is a property of a population.
    # CONDITIONAL ON THE ROUNDS OBSERVED since 06/08/2026, and that is the whole point: the mean of everybody
    # is 0.53, but a man measured over 3-10 rounds actually plays **0.207** of the next season, not 0.53 -
    # he is not a random member of the population, he is a fringe player, and the rounds say so. Shrinking
    # him toward everybody's mean was pulling him UP (Milik, two rounds, came out at 26% of claim). The
    # bands are the ones already published in gate §7-quaterdecies: 0.207 / 0.411 / 0.463 / 0.571 / 0.574.
    # None = no prior, no shrinkage.
    standing_prior: float | None = None
    # ...and WHAT KIND of arrival he is: True when the club he left plays in another championship. Measured
    # 06/08/2026 over 2324 player-seasons - the two are not the same event and the model had one discount
    # for both (gate §7-quindecies).
    cross_league: bool = False
    # What he had already SHOWN before last season, relative to his role, in standard deviations - and only
    # for FORWARDS, which is the population it was measured on (gate §7-vicies). None everywhere else.
    career_z: float | None = None


def investment_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much the club's investment should move him, in shares of a season. 0.0 when the term is off.

    The fee channel is one-sided (no spending is not evidence against a man), the stature channel is
    CENTRED: above-median Qt.I lifts, below-median pushes down, because the claim has two sides and the
    youngster losing his place to a signing is the same statement as the signing keeping it.

    An unknown channel contributes nothing - not knowing what a club spent is not knowing.
    """
    lift = 0.0
    if params.fee_weight and inputs.fee_share is not None:
        lift += params.fee_weight * inputs.fee_share
    if params.stature_weight and inputs.stature is not None:
        lift += params.stature_weight * (inputs.stature - 0.5) * 2.0
    # The value channel is ONE-SIDED like the fee, and for the same reason: being a small part of a rich
    # squad is not evidence against a man. It is also scaled to the squad, so an eleventh of it - what a
    # starter is by construction - reads about 0.09.
    if params.value_weight and inputs.value_share is not None:
        lift += params.value_weight * inputs.value_share
    # ...and the null, which reads nothing about him at all
    lift += params.shrink_weight
    return lift


def career_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """What he had shown BEFORE last season, in shares of a season. 0.0 when off or outside its role.

    Centred like the others. Distinct from `quality_lift`, which reads the INPUT season and was falsified
    (§7-duodecies): this reads the seasons before it, which the standing has never seen at all.
    """
    if not params.career_weight or inputs.career_z is None:
        return 0.0
    return params.career_weight * inputs.career_z


def quality_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much what he SHOWED should move his standing, in shares of a season. 0.0 when the term is off.

    CENTRED, like the stature channel and for the same reason: the claim has two sides, and «he played
    well and earned minutes» is the same sentence as «he played badly and lost them». A one-sided version
    would be a hypothesis that only allows the sign it expects.

    Unknown is not zero: a man with no season to read contributes nothing rather than an average.
    """
    if not params.quality_weight or inputs.fm_z is None:
        return 0.0
    return params.quality_weight * inputs.fm_z


def level_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much the LEVEL of the football behind his minutes should move his standing. 0.0 when off.

    Centred, like the other two: coming from a stronger side lifts, coming from a weaker one pushes down.
    The same minutes are not the same evidence - a starter at PSG (Elo 1970) and a starter at a mid-table
    Serie A club (1610) are two different men, and the standing reads them identically today.
    """
    if not params.level_weight or inputs.level_z is None:
        return 0.0
    return params.level_weight * inputs.level_z


def level_gap_lift(inputs: Inputs, params: Params = DEFAULTS) -> float:
    """How much the STEP between the two levels should move him. 0.0 when off. See `Params.level_gap_weight`.

    Deliberately a separate term from `level_lift` and not a replacement for it, because the two share
    `elo_prev` and the sweep has to be able to tell them apart: with both on the grid, a run where this one
    wins and `level_weight` falls to zero says the gap SUBSUMES the level, and a run where both stay
    positive says they read different things. Collapsing them here would have decided that by hand.
    """
    if not params.level_gap_weight or inputs.level_gap_z is None:
        return 0.0
    return params.level_gap_weight * inputs.level_gap_z


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
    if inputs.was_here_before:
        discount = params.loan_discount
    elif inputs.cross_league:
        discount = params.arrival_discount_cross
    else:
        discount = params.arrival_discount
    weight = (inputs.minutes_here + discount * inputs.minutes_elsewhere) / total
    if params.investment_shape == "arrival":
        # The investment closes part of what the discount took away, and only that part: a man whose whole
        # season is already here is at 1.0 and cannot be lifted, which is right - his minutes have said it.
        weight = min(weight + investment_lift(inputs, params) * (1.0 - weight), 1.0)
    return max(weight, 0.0)


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
    if (params.window_standing and inputs.window_matches
            and not inputs.starts and not inputs.appearances and not inputs.minutes):
        # NOTHING measured here, and a window measured elsewhere: his share of the minutes he could have
        # played in it, discounted by whose football it was (`at_club_weight` - the arrival discount) and
        # by how much of a window it is (`window_standing`). Ten matches are not a season and the number
        # must not pretend otherwise; zero is not the alternative, it is the other error.
        share = min(inputs.window_minutes / (inputs.window_matches * 90.0), 1.0)
        # ...and the discount is taken EXPLICITLY, not through `at_club_weight`: that one splits his
        # minutes between here and elsewhere, and a man whose whole window is elsewhere has no minutes
        # here to split, so it reads 1.0 - «an unknown split must not penalise him», which is right for a
        # missing split and wrong for a known one. This window was played somewhere else by construction
        # (it is what `recent_form` fetches), so the arrival discount applies to all of it.
        discount = (params.loan_discount if inputs.was_here_before else params.arrival_discount)
        return min(max(params.window_standing * share * discount, 0.0), 1.0)
    starts = min(inputs.starts * weight / rounds, 1.0)
    if not inputs.minutes:
        measured = starts
    else:
        by_starts, by_minutes = params.standing_weights
        measured = (by_starts * starts
                    + by_minutes * min(inputs.minutes * weight / (rounds * 90.0), 1.0))
    # The two lifts share the shape because they make the same KIND of claim - something the minutes did
    # not see should move the standing - and differ only in what they read: what the club paid, and what
    # the man showed.
    lift = (investment_lift(inputs, params) + quality_lift(inputs, params)
            + level_lift(inputs, params) + level_gap_lift(inputs, params)
            + career_lift(inputs, params))
    # ...and how much of a season is BEHIND that number. Twelve rounds and thirty-eight say the same thing
    # with very different confidence, and the standing said them identically.
    if params.standing_prior_rounds and inputs.standing_prior is not None:
        share = rounds / (rounds + params.standing_prior_rounds)
        measured = share * measured + (1.0 - share) * inputs.standing_prior
    # ...and WHERE HE STANDS in the department he joins, blended in - the shape that was measured, and
    # not an additive lift like the three above. The difference matters: a lift moves everybody by the
    # same amount for the same evidence, while a blend lets the minutes keep most of the say and pulls
    # only toward the level of the men he will compete with. See `Params.level_rank_weight`.
    if params.level_rank_weight and inputs.level_rank is not None:
        measured = ((1.0 - params.level_rank_weight) * measured
                    + params.level_rank_weight * inputs.level_rank)

    if params.investment_shape == "standing":
        return min(max(measured + lift, 0.0), 1.0)
    if params.investment_shape == "unplayed":
        # ...and the CONDITIONAL form: what the minutes could not see, and only that. A man at 1.0 cannot be
        # lifted at all, which is the whole point - his minutes have already said he plays.
        return min(max(measured + lift * (1.0 - measured), 0.0), 1.0)
    # Any other shape ("arrival") applies the INVESTMENT lift of its own, elsewhere - so only the quality
    # term is added here, and adding `lift` would have double-counted the other one.
    return min(max(measured + quality_lift(inputs, params) + level_lift(inputs, params)
                   + level_gap_lift(inputs, params) + career_lift(inputs, params), 0.0), 1.0)


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
