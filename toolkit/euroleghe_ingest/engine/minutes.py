"""minutes - how long a man stays ON THE PITCH when he plays, for the season that is coming.

Born from the operator's question of 18/08/2026: the pitch card shows «minuti totali stagione scorsa /
partite giocate», which is a MEASUREMENT of the season that ended, and he asked whether it could be made
to describe the season being auctioned - «trovare il rapporto (claim stagione scorsa) / (claim stagione
corrente)».

WHY THAT RATIO IS NOT THE ANSWER, and it has to be said here or it comes back. The claim IS built on last
season's minutes: `standing_weights = (0, 1)` was adopted on ten folds of ten, so its measured part is
`minutes x weight / (rounds x 90)` and the start rate weighs nothing. Reading `claim_prev` as that rate,

    perMatch x claim_now / claim_prev = (minutes/matches) x claim_now x rounds x 90 / minutes
                                      = 90 x rounds x claim_now / matches

- HIS MINUTES CANCEL. The estimator throws away the very number it claims to adjust, and what is left is
unbounded: a man with six appearances and a claim of 0.6 reads 342 minutes per match. Measured on the two
back-dated windows below it is **-59% and -55%** against doing nothing, which is the worst arm of the
whole comparison. Same family as the `contested`/`availability` defect the spec already records:
subtracting an estimate and multiplying it back cancels out.

WHAT IS ADOPTED INSTEAD. A minute-per-appearance is a mixture of two kinds of appearance, and only the
MIX changes when a man's role changes:

    minutes per appearance = C + P x (S - C)      P = P(start | appearance)

with `S` and `C` measured (below). His own measured average enters twice and never as a scale factor:
once through `P_prev`, his measured start-per-appearance rate, and once as the RESIDUAL - «he is the
striker who always comes off at 65'» - kept at `ANCHOR`.

IT IS THEREFORE A SHRINKAGE AS WELL AS A RESCALING, and that has to be said because it surprises: even
with a start rate that does not move, the number moves, because only `ANCHOR` = 0.20 of the personal
residual survives. That is not a side effect, it is most of the gain - the arm that changes NOTHING but
shrink (P_next = P_prev) is already worth **+4.6% and +4.9%**, and the role-change term adds the other
three points. A measured per-appearance average regresses to the mean like any other measured rate, and
88 minutes over four appearances is not a promise of 88.

THE FORECAST OF P IS THE WHOLE GAME, and the honest finding is that the model's own is WORSE than the
measurement it was built from. Against the realised start-per-appearance rate of the target season:

    last season's measured rate      bias +0.010 / +0.022   MAE 0.200 / 0.197   r 0.497 / 0.468
    the model's (presence / quota)   bias +0.085 / +0.109   MAE 0.234 / 0.237   r 0.408 / 0.359

So the model's number is not a better answer to «will he start», it is a DIFFERENT one - it knows about
a transfer, a new coach and an injury history that the measurement cannot see - and it earns its place
only as a MINORITY of the blend. Hence `MODEL_MIX` = 0.30, and the curve is measured, not chosen.

MEASURED, on two back-dated pre-season windows (`snapshot --season S --date S-08-15`, which below five
league rounds measures the PREVIOUS season - the state of an August auction), outcome = the realised
minutes per appearance of the target season, minimum three appearances, 2303 player-windows:

    window                     naive (unchanged)   adopted      per role (naive -> adopted)
    2024-08-15 -> 2024-25      MAE 14.29           13.21 +7.5%  D +9.4% · C +8.5% · A +2.8%
    2025-08-15 -> 2025-26      MAE 13.89           12.84 +7.6%  D +7.0% · C +7.7% · A +8.8%
    pooled                     MAE 14.09           13.02 +7.6%

The two parameters are chosen CROSS-FIT - each window's verdict uses the grid point the OTHER window
picked - and both times the held-out gain is +7.7% / +7.6%; both optima are interior. The ceiling of the
family, with the TRUE P substituted, is MAE 3.78 / 3.54 (+74%), which says the form is right and the
forecast of P is what nobody has. That is what would reopen this: a better P, not a bigger formula.

WHAT IT IS NOT. This is REPORTING - it moves no `engine_*` column, no gate owns it, and `backtest
--verify` does not change. It is measured rather than picked, and the numbers above are the reason, not a
justification written afterwards.

Dependency-free, like the rest of `engine/`: the shippable TypeScript engine gets ported from here.
"""

from __future__ import annotations

from dataclasses import dataclass

# ---------------------------------------------------------------- the two constants, measured
#
# S and C: how long a START lasts and how long a SUBSTITUTE APPEARANCE lasts, by listone role. Measured
# 19/08/2026 over 247,825 league appearances of the per-match layer (`external_match_stats`,
# `source='sofascore'`, the five championships, `minutes > 0`, so an unused substitute is not one):
#
#   role   starts    S mean   subs      C mean
#   P      12,589    89.5     178       35.4      <- and that 178 is why the keeper is a special case
#   D      52,533    84.5     13,023    21.3
#   C      48,615    79.9     22,153    21.1
#   A      26,441    78.5     16,588    20.7
#   ?      42,995    83.4     12,710    20.5      <- no listone role that season: its own bucket, never
#                                                    silently the midfielder's
#
# Per role and not pooled: S spans 78 to 90, and that spread is the difference between a forward and a
# keeper. Re-measure when the window moves a season, and keep the old table as history.
START_MINUTES: dict[str, float] = {"P": 89.5, "D": 84.5, "C": 79.9, "A": 78.5, "?": 83.4}
SUB_MINUTES: dict[str, float] = {"P": 35.4, "D": 21.3, "C": 21.1, "A": 20.7, "?": 20.5}


@dataclass(frozen=True)
class Params:
    """The two weights. `replace(params, ...)` is how a harness varies one of them."""

    # How much of the start-per-appearance rate comes from the MODEL (`presence / expected share`) and how
    # much from what he MEASURED last season. Grid (0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1.0) on both
    # windows: interior optimum at 0.25-0.30 on one and 0.20-0.30 on the other, and the pure model (1.0)
    # is NEGATIVE on both (-4.2%, -8.4%). The model is the minority opinion here because it is measurably
    # the noisier of the two, not because it is less trusted.
    model_mix: float = 0.30
    # How much of the personal residual survives - «he always comes off at 65'». Grid (0, 0.2, 0.35, 0.5,
    # 0.7, 1.0): the curve is flat between 0 and 0.2 (+7.8/+7.7 against +7.7/+7.7) and falls after, so the
    # interior point is taken rather than the edge, which is this project's own rule about a grid.
    anchor: float = 0.20
    # How much the ENGINE'S DISAGREEMENT with the panel about the appearances moves the start rate.
    # MEASURED 20/08/2026 AND REFUSED, and it stays here at zero as the sweepable record of that: grid
    # (0, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0), cross-fit over the gate's own windows, and EVERY fold of both
    # platforms picks 0. It was worth trying because the disagreement does correlate with the realised
    # change in start rate (+0.162 default, +0.132 euro) - it just does not lower the error, which is the
    # difference between a signal and a term. The grid is one-sided on purpose: a NEGATIVE weight is the
    # perverse direction `model_share` exists to remove, and looking for a coefficient with the wrong
    # sign is not measuring, it is fishing.
    news_weight: float = 0.0


DEFAULTS = Params()

# WHERE THE COHERENT PAIR IS ADOPTED, and it is per PLATFORM because the evidence is (20/08/2026,
# gate §7-quadragies). `start_rate_next` divides the PANEL's starts share by the ENGINE's appearances
# share - two models, and only the denominator receives the engine's new rules, so adopting R23 the day
# before LOWERED this forecast for exactly the men it raised the appearances of. `presence.voto_share` is
# the panel's own answer to the engine's question, so passing it makes the ratio one model's and cancels
# `availability` on the way: being injury-prone is not being a substitute.
# Judged on the gate's own windows (pre-season regime - the timepacks are dated after the fifth round and
# the module's docstring records that the sign flips there), outcome = the realised minutes per appearance
# of the target season, minimum three appearances, arms varied through THIS function so the incumbent is a
# point of the grid:
#
#   euro     +1.44% mean, 4 windows of 4, worst +0.84%   -> STRICT, adopted
#   default  +1.25% mean, 3 windows of 6, worst -1.14%   -> no majority, NOT adopted
#
# The split was the pre-registered expectation and its mechanism says why: on default the two models
# nearly agree about the appearances (mean gap -0.009, median -0.038) so there is little to repair and the
# gain is noise-sized, while on euro the platform's calendar is a SUBSET of the club's championship and
# the engine reads systematically lower (-0.083, median -0.106) - the ratio was inflated, and the measured
# bias of the rate falls from +0.048 to +0.032. Per role on euro, no role losing: D +1.20% · C +1.46% ·
# A +1.85%. The number on the card moves -1.0' on average (median -2.1', from -11.6' to +16.3').
# TWO PRE-REGISTERED FOLLOW-UPS, written here rather than done now, because both would be a decision taken
# after seeing a curve: BLEND the two denominators instead of choosing one (only the endpoints have been
# measured, so an interior optimum would be news); and `model_mix`, whose optimum under the coherent pair
# is 0.40 on BOTH platforms with an interior minimum - worth +0.66% on default (6 windows of 6, strict) and
# **-0.09% on euro**. Its grid was re-fitted in that run to make the arm comparison fair and not to move
# the parameter, and this project has already paid for widening a decision after the fact.
COHERENT_PLATFORMS: frozenset[str] = frozenset({"euro"})


def model_share_for(platform: str | None, model_share: float | None) -> float | None:
    """The panel's own appearances share, on the platforms where using it as the denominator is adopted.

    A caller that does not know its platform gets None, which is the incumbent: a sheet whose manifest
    cannot say where it comes from must not be silently given a euro parameter.
    """
    return model_share if (platform or "") in COHERENT_PLATFORMS else None


# A season's worth of minutes cannot exceed a match, and cannot be nothing at all.
MAX_MINUTES = 90.0
MIN_MINUTES = 1.0


def start_rate_next(presence_share: float | None, expected_share: float | None,
                    start_share: float | None, params: Params = DEFAULTS,
                    model_share: float | None = None) -> float | None:
    """P(start | appearance) for the season that is coming, or None when a half is missing.

    TWO SHARES AND NEVER TWO COUNTS. `presence_share` is a share of his championship's rounds (38) and
    `expected_share` is `engine_pv_pred / matchdays_target`, a share of the PLATFORM's calendar (29 on
    euro, 35-36 on default). Dividing the counts would be the wrong-denominator defect this project has
    already paid for twice; dividing the shares is dimensionless. Capped at 1: a man cannot start more
    often than he appears.

    The numerator is `presence` and not `claim` because the denominator carries absences: `claim` is «the
    side with everybody fit» while `engine_pv_pred` predicts real appearances, so claim/quota would be
    inflated by 1/availability. Measured: bias +0.062 against +0.085 on one window - closer, and it is
    still the blend below that does the work.

    TWO MODELS UNDER ONE DIVISION, which is what `model_share` exists to repair. `presence_share` is the
    PANEL's forecast and `expected_share` the ENGINE's, and `presence.py` does not import `evaluate` - so
    every new engine rule moves the denominator and none of them moves the numerator, and a rule that
    raises the appearances lowers this rate by construction. `model_share` is the panel's OWN answer to
    the engine's question (`presence.voto_share`), which makes the ratio one model's and cancels
    `availability` - being injury-prone is not being a substitute. `news_weight` then lets the engine's
    DISAGREEMENT with the panel enter with the sign the realised changes have. Both default to the
    incumbent, so today's number is a point of the grid rather than an alternative to it.
    """
    if start_share is None:
        return None
    if presence_share is None or not expected_share:
        return start_share
    base = model_share if model_share else expected_share
    modelled = min(1.0, max(0.0, presence_share / base))
    rate = params.model_mix * modelled + (1.0 - params.model_mix) * start_share
    if params.news_weight and model_share:
        rate = min(1.0, max(0.0, rate + params.news_weight * (expected_share - model_share)))
    return rate


def per_appearance(role: str | None, minutes: float | None, matches: float | None,
                   start_share: float | None, presence_share: float | None,
                   expected_share: float | None, params: Params = DEFAULTS,
                   model_share: float | None = None) -> float | None:
    """The minutes he is expected to play IN A MATCH HE PLAYS, next season. None = unknown, never zero.

    It answers a DIFFERENT question from the average it starts from: `minutes / matches` is what he did,
    this is what he is expected to do, and the two differ even when nothing about his role changes (the
    shrinkage above). The card shows this one and names the other beside it - a forecast and a measurement
    under one naked figure is the trap this project already sprang once.

    THE KEEPER IS NOT RESCALED, and it is measured rather than assumed: a keeper who plays plays ninety
    minutes by the rulebook, so his measured average already IS the forecast (MAE 3.65 and 2.24 on the two
    windows, against 6.19 and 5.88 for the rescaled version - the structural form makes him worse because
    his P is 1 by construction and the model's P is not).

    A man with no measured start rate keeps his own average untouched: without `P_prev` the residual is
    undefined, and substituting the population's would turn «unknown» into «average», which is the failure
    mode the window branch of `presence.standing` was rewritten to avoid.
    """
    if not minutes or not matches:
        return None                             # no measured season: unknown, and never an average man
    measured = minutes / matches
    line = (role or "?").strip().upper()
    if line not in START_MINUTES:
        line = "?"
    if line == "P":
        return measured
    rate = start_rate_next(presence_share, expected_share, start_share, params, model_share)
    if rate is None:
        return measured
    start, sub = START_MINUTES[line], SUB_MINUTES[line]
    residual = measured - (sub + start_share * (start - sub))
    level = sub + rate * (start - sub)
    return min(max(level + params.anchor * residual, MIN_MINUTES), MAX_MINUTES)
