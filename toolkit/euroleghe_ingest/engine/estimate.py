"""The FALLBACK valuation: every player gets a number, and the number says how much it is worth.

Operator's rule, 05/08/2026: «Ogni calciatore DEVE avere il suo SURPLUS altrimenti è impossibile valutarli
oggettivamente. Se mancano dei valori per calcolare il SURPLUS, ricaviamoli/ricostruiamoli
approssimativamente (ma razionalmente) ... se non ci sono tutti i requisiti, penalizziamo il SURPLUS
(l'indeterminazione è comunque una nota negativa) ma dobbiamo comunque avere un valore di riferimento (un
attaccante titolare della Juve anche se sconosciuto è sempre meglio di un attaccante sconosciuto del
Verona)».

WHAT THIS IS NOT. It is not the engine and it is not gated: `engine_*` stays exactly what passed the
pre-registered gate, blanks included, and nothing here touches a published number. This is a THIRD class of
column, `est_*`, and the manifest says so - estimated, neither measured (`desc_*`) nor validated
(`engine_*`). The gate's own verdict on the closest thing to it is on the record and it is negative: R1
(«price a newcomer from his FM-equivalent abroad») was measured on six windows and does WORSE than the role
anchor on five of them. So the cascade below never prefers a foreign equivalent to an anchor - the ladder is
ordered by what the numbers say, not by what sounds like more information.

THE LADDER, and every rung carries the measurement that put it there (05/08/2026, on our own DB):
  * `core`            his own season here, >= MIN_PV_PREV votes. The engine's, untouched.        conf 1.00
  * `other_platform`  the SAME season on the other platform. euro and default measure the same football on
                      different calendars: over 870 player-seasons with >= 15 votes on both, the difference
                      of the two fantamedie has mean **+0.001**, sd 0.185, and |diff| <= 0.3 on **92%** -
                      per role within 0.03. So it stands in almost exactly, and it is not a prediction at
                      all, it is the same season seen from the other calendar.                   conf 0.95
  * `older`           his most recent season further back. Using an old fantamedia as the prediction gives
                      MAE 0.396 at t-2 and 0.434 at t-3 against 0.368 at t-1 (rho 0.712 / 0.649 / 0.741):
                      a season two years old is worth nearly as much as last year's - for the FANTAMEDIA.
                      His PRESENCES are a different question and were measured 19/08/2026, three years
                      late: an old pv is worth almost nothing on default and the population's own share
                      answers instead (`OLDER_SHARE`, `presences_from_older`).            conf 0.85 / 0.75
  * `shrunk`          a season here with 1..14 votes: his own mean is real but thin, so it is blended with
                      the club-adjusted anchor in proportion to the votes he HAS - which is exactly the
                      operator's «aggiungiamo i voti che mancano come la media del ruolo», written as
                      arithmetic.                                                     conf 0.50 + 0.50 x w
  * `anchor`          nothing at all: the role's anchor, moved toward his CLUB's own level for that role.
                      Measured on 25/26 Serie A: the spread between the best and the worst club's mean
                      fantamedia is 1.36 for forwards (Inter 7.38, Pisa 6.02), 1.10 for midfielders, 0.75
                      for defenders and 0.25 for keepers - which is the operator's Juve-vs-Verona point,
                      quantified, and it is why the adjustment is per ROLE and not a single number.
                                                                                                 conf 0.50

THE PENALTY multiplies the SURPLUS and nothing else. Indeterminacy is a fact about the number, not about the
player's fantamedia: his level is our best guess either way, while what an auction ranks - points over the
bench - is what should be discounted for not knowing. And it is a DECLARED product choice, not a fitted
coefficient: the ladder is ordered by the measured errors above, the exact rungs are ours, and the sheet
carries them per row so nobody has to trust this docstring.
"""

from __future__ import annotations

from dataclasses import dataclass

# The ONE surplus arithmetic. `model` is pure formulas with no DB and no I/O, so importing it keeps this
# file as portable as it was and removes the third copy of a subtraction that had already drifted once.
from euroleghe_ingest.engine import model

# How many votes the core needs before it will predict at all - `model.MIN_PV_PREV`, restated here because
# this module must stay importable on its own (the gate's harness reaches both).
FULL_SEASON_VOTES: int = 15

# The confidence of each rung. Ordered by the measured errors in the docstring; the values themselves are a
# product choice and are stated on every row that uses them.
CONFIDENCE: dict[str, float] = {
    "core": 1.00,
    "other_platform": 0.95,
    "older": 0.85,             # t-2; one more season back takes OLDER_DECAY off it
    "shrunk_floor": 0.50,      # a shrunk estimate with one vote is barely more than the anchor...
    "shrunk_span": 0.50,       # ...and with 14 it is nearly the core
    "anchor": 0.50,
}
OLDER_DECAY: float = 0.10      # per season beyond t-2, floored at the anchor's own confidence

# HOW MANY MATCHES a man the engine cannot price actually plays, as a share of the platform's calendar -
# MEASURED over three windows on our own seasons, not chosen. It matters because the first version invented
# "half a calendar" for a man with nothing measured, and that made an UNKNOWN keeper (est 9.3) worth more
# than his club's third keeper who had played once (4.4), which is the opposite of what the sheet should say.
#   nothing measured before  ->  median share 0.289 default (n=719) · 0.194 euro (n=1174)
#   a thin season (1-14)     ->  median share 0.421 default (n=244) · 0.290 euro (n=696)
# The thin man plays MORE, and the ordering now comes from the data instead of from a round number.
PRESENCE_SHARE: dict[str, dict[str, float]] = {
    "unmeasured": {"default": 0.29, "euro": 0.19},
    "thin": {"default": 0.42, "euro": 0.29},
}

# ...and the man who HAS a measured season, only not on THIS platform - the new signing from abroad.
# Pricing him at the share above says «nobody has ever seen him play», which is false and expensive:
# measured over the men with no season here at t-1 and league minutes abroad at t-1 who then played here
# (323 on default, 929 on euro), their real share is a median **0.447 / 0.290** against the 0.29 / 0.19 the
# unmeasured constant gives them - six matchdays of 38 handed back. And their OWN minutes carry more than
# the band does:
#     share = a + b x (his league minutes / (90 x that league's rounds))
# fitted on `external_stats` league rows over `features.league_rounds`, i.e. the two denominators the
# measurement itself used - a cup is not a matchday of the championship he played. Judged
# LEAVE-ONE-SEASON-OUT, so the coefficients never see the season they are scored on: MAE **0.2300 against
# 0.2803** for the constant on default (**+17.9%**) and **0.2831 against 0.2983** on euro (**+5.1%**). The
# band median alone is worth less than the line on default (0.2455) and is WORSE than the constant on euro
# (0.3256), which is why what ships is the line and not a second constant.
# REPORTING, like the whole of this module: `engine_*` does not move a decimal, the gate never sees it.
ABROAD_SHARE: dict[str, tuple[float, float]] = {
    "default": (0.339, 0.320),
    "euro": (0.183, 0.357),
}
# His share of a foreign calendar cannot exceed it, and the line's intercept keeps it off zero - so the
# clip is about the INPUT being outside the range it was fitted on, not about tidying the output.
ABROAD_MAX_SHARE: float = 1.0


# ...and the man whose only measured season is OLD - the `older` rung, MEASURED 19/08/2026 because it never
# had been. The rung has always REGRESSED his fantamedia toward the anchor (`OLDER_BETA`, and the comment
# there says why: an old number used raw is the naive baseline the core beats) and handed over his old
# PRESENCES untouched - not even converted between the two calendars. It is the same defect that comment
# describes, on the other half of the pair, and it surfaced where a raw presence hurts most: the app's
# Overall is `presenze x (voto + bonus)`, so Arthur Melo - 32 votes at Fiorentina in 2023-24, nothing since
# - read 32 of 38 and came out FOURTH of the whole Serie A listone with an unremarkable 6.34 of fantamedia.
#
# THE POPULATION IS THE MEN WHOSE OLD PV ACTUALLY SHIPS, and that is not everybody the rung prices: nothing
# measured at t-1 on either platform AND no league minutes abroad at t-1, because `presences_from_abroad`
# answers first for those. Scored on the share of the target calendar he really got, LEAVE-ONE-SEASON-OUT
# (the anchor never sees the season it is scored on), with a man quoted and never rated counting as the ZERO
# he was - the sheet predicts for everybody quoted, so scoring only the survivors would grade a different
# question:
#
#                                     default (n=221, 8 seasons)   euro (n=48, 3 seasons)
#   his old pv, raw (what shipped)           MAE 0.3749                 MAE 0.3510
#   ...just converted between calendars           0.3756                     0.3064   (+12.7%)
#   the population's own share alone              0.2704                     0.3482
#   anchor + b(his share - anchor)                0.2689 (+28.3%)            0.2993 (+14.7%)
#
# WHAT THE TWO PLATFORMS SAY IS NOT THE SAME THING, and the mechanism is why. On default the median old
# share is 0.632 and the median outcome 0.289, so his old season carries almost nothing: b* is 0.10, INSIDE
# the grid, positive on 8 seasons of 8 (+13.9% to +36.7%) and picked by the cross-fit on 6 folds of 8. And
# the anchor it lands on, 0.29, is to the decimal the `unmeasured` constant above: a man quoted in Serie A
# who did not play last season anywhere is, FOR PRESENCES, a man nobody has ever measured. On euro he is
# not (0.61 against that platform's 0.19), because there «nothing measured at t-1» usually means «played in
# a championship we do not cover» rather than «did not play» - the five leagues are the perimeter, not the
# world.
# THE EURO VALUE IS FRAGILE AND IS ADOPTED SAYING SO: 3 seasons and 48 rows, whose own optima are 0.90 /
# 0.00 / 0.55 - the direction is identified (every point of the grid beats the raw pv, +3.7% to +16.1%) and
# the value is not. 0.55 is the minimum of the leave-one-out curve on the other convention (score only the
# men who played: +20.3%) and sits in the flat basin of this one. It comes out without argument the first
# time another season says otherwise.
OLDER_SHARE: dict[str, float] = {"default": 0.29, "euro": 0.61}
OLDER_PV_BETA: dict[str, float] = {"default": 0.10, "euro": 0.55}


def presences_from_older(calendar: int | None, platform: str, pv_old: float | None,
                         calendar_old: int | None) -> float | None:
    """The presences of a man whose most recent measured season is two or more years back.

    His own share of THAT calendar, pulled toward the share his population really gets - the same shape
    `regress` gives the fantamedia below, and for the same reason. The two calendars are part of the
    arithmetic: 32 votes are 84% of a Serie A season and 100% of a euro one, and handing the number
    across without converting it was worth 12.7% of error on its own.
    """
    anchor, beta = OLDER_SHARE.get(platform), OLDER_PV_BETA.get(platform)
    if not calendar or anchor is None or beta is None:
        return None
    if not pv_old or not calendar_old:
        # «Vuoto = ignoto»: with no readable old season the population's own share answers, which is what
        # this rung's neighbours already do - never his pv on somebody else's calendar.
        return round(calendar * anchor, 1)
    his = min(1.0, pv_old / calendar_old)
    return round(calendar * min(1.0, max(0.0, anchor + beta * (his - anchor))), 1)


def default_presences(calendar: int | None, platform: str, kind: str = "unmeasured") -> float | None:
    """The presences of a man whose appearances nobody can predict, from the measured shares above."""
    if not calendar:
        return None
    share = PRESENCE_SHARE.get(kind, {}).get(platform)
    return None if share is None else round(calendar * share, 1)


def presences_from_abroad(calendar: int | None, platform: str,
                          minutes_share: float | None) -> float | None:
    """The presences of a man measured ELSEWHERE last season, from how much of it he actually played.

    None when there is nothing to read - no calendar, no measured minutes, or a platform without a fitted
    line - and then the caller falls back to the unmeasured constant. A None here is «we have not watched
    him», which is a different sentence from «he played a third of a season», and only one of them is true
    for a €74M signing with 1320 minutes in Ligue 1.
    """
    line = ABROAD_SHARE.get(platform)
    if not calendar or line is None or minutes_share is None or minutes_share <= 0:
        return None
    intercept, slope = line
    share = min(max(intercept + slope * minutes_share, 0.0), ABROAD_MAX_SHARE)
    return round(calendar * share, 1)


# How many measured players of a role a club needs before its own level is trusted over the role anchor.
# Three, because a club fields 3-4 defenders and 2-3 forwards a week: with one man the "club level" is one
# man's season wearing a club's name.
CLUB_PRIOR: float = 3.0


@dataclass(frozen=True)
class Estimate:
    """One player's fallback valuation, with the reason it exists attached to it."""

    fm: float | None
    pv: float | None
    basis: str
    confidence: float
    note: str
    # The base vote behind that fantamedia. It is DERIVED from `fm` and never estimated on its own - see
    # `bonus_rate` - so the pair can never contradict itself: fm - mv IS the bonus per appearance the row
    # expects of him, which is a number a reader can disagree with.
    mv: float | None = None

    @property
    def estimated(self) -> bool:
        return self.basis != "core"


def club_anchor(role_anchor: float, club_mean: float | None, club_measured: int) -> float:
    """The role's anchor moved toward the CLUB's own level for that role, by how much of it we measured.

    «Un attaccante titolare della Juve anche se sconosciuto è sempre meglio di un attaccante sconosciuto del
    Verona» - and the size of that difference is measured, not assumed: 1.36 of fantamedia between the best
    and the worst Serie A club's forwards in 25/26, 0.25 between their keepers. Nothing here decides how big
    it is; it comes out of the club's own mean, so a league where clubs are alike moves the anchor less.
    """
    if club_mean is None or club_measured <= 0:
        return role_anchor
    weight = club_measured / (club_measured + CLUB_PRIOR)
    return role_anchor + (club_mean - role_anchor) * weight


def shrink(fm: float, votes: int, anchor: float, full: int = FULL_SEASON_VOTES) -> tuple[float, float]:
    """(fantamedia, confidence) for a season measured with too few votes to be a season.

    The operator's own remedy, as arithmetic: pad the votes he is missing with the anchor. Padding `full -
    votes` matches at the anchor and keeping his own `votes` at his own mean IS the weighted mean below, so
    the two descriptions are the same number - which is why this is a blend and not a taste.
    """
    weight = max(0.0, min(1.0, votes / full))
    value = weight * fm + (1.0 - weight) * anchor
    confidence = CONFIDENCE["shrunk_floor"] + CONFIDENCE["shrunk_span"] * weight
    return value, confidence


# THE BONUS PER APPEARANCE, which is what separates a fantamedia from a base vote: FM = MV + (bonuses -
# maluses) / Pv, so MV = FM - this. Measured 15/08/2026 on our own DB, 3750 Serie A player-seasons with
# >= 15 votes, after the operator asked for an MV for everybody:
#
#     role   n     mean    sd     p10     p90
#     P     247   -1.293  0.388  -1.77   -0.82      (the goals-conceded malus, and it is huge)
#     D    1348   +0.045  0.178  -0.14   +0.28
#     C    1395   +0.239  0.301  -0.08   +0.64
#     A     760   +0.735  0.519  +0.17   +1.43
#
# It is a PROPERTY OF THE MAN and not noise: from one season to the next it repeats at **r = +0.842**,
# which is far above anything else this project carries season to season. That is why the estimate blends
# HIS OWN rate toward his role's instead of using the role's alone.
#
# Why derive the MV instead of estimating it directly. Measured on the same table, predicting a season's MV
# from the one before: his own MV raw MAE **0.170**, the role anchor alone **0.166**, anchor + b(his -
# anchor) **0.148** at b = 0.45 - the same shape and nearly the same coefficient as `OLDER_BETA`. So a
# direct estimate is available and about as good; it is refused because it would be a SECOND number free to
# contradict the first, and «fm - mv» would then be a bonus rate nobody chose. One number and one
# derivation keeps the pair readable.
BONUS_FULL_VOTES: int = FULL_SEASON_VOTES


def bonus_rate(own: float | None, votes: int | None, role_rate: float | None) -> float | None:
    """His bonus per appearance, padded with his role's for the appearances he has not got.

    The same arithmetic as `shrink` and for the same reason: a rate off three matches is his in name only.
    With nothing measured at all it IS the role's rate, which is what «spannometrico ma ragionato» means.
    """
    if own is None or not votes:
        return role_rate
    if role_rate is None:
        return own
    weight = max(0.0, min(1.0, votes / BONUS_FULL_VOTES))
    return weight * own + (1.0 - weight) * role_rate


def mv_from(fm: float | None, rate: float | None) -> float | None:
    """The base vote behind a fantamedia: `MV = FM - bonus per appearance`. Null if either half is."""
    if fm is None or rate is None:
        return None
    return fm - rate


def older_confidence(seasons_back: int) -> float:
    """A season further back is worth less, and never less than the anchor it would otherwise be replaced by."""
    return max(CONFIDENCE["anchor"], CONFIDENCE["older"] - OLDER_DECAY * max(0, seasons_back - 2))


# How much of an OLD fantamedia survives as a prediction. MEASURED 06/08/2026 on our own Serie A seasons,
# after the operator asked the right question - «un calciatore che torna in serie A dopo un anno, la sua FM
# è confrontabile con chi gioca due anni consecutivi?». Predicting season t from t-2, anchor out of sample:
#
#                              n     raw FM(t-2)   role anchor   anchor + b(FM-anchor)
#   returners (no Serie A t-1)   203      0.407         0.369      0.326   (b 0.40)
#   continuous (Serie A at t-1) 1264      0.395         0.376      0.336   (b 0.45)
#
# Two answers in one table. The one he asked for: YES, comparable - the year away costs 0.012 of MAE and the
# best b is the same, so an old Serie A fantamedia is as good a reference for a returner as for anybody.
# The one he did not ask for and that matters more: taken RAW it loses to the plain role anchor on both
# groups, and it is biased UPWARD for returners (+0.079 overall, +0.144 for forwards) - a man who was good
# enough two years ago and left tends to come back worse than his old number. So the rung hands its season
# to the same transform the core uses on `fm_prev` instead of passing it through; 0.40 is the returners'
# own value and 0.45 the runner-up, and both sit inside a grid swept at 0.05 from 0 to 1.
OLDER_BETA: float = 0.40


def regress(fm: float, anchor: float, beta: float = OLDER_BETA) -> float:
    """A measured fantamedia turned into a PREDICTED one, the way the core turns `fm_prev` into `fm_pred`.

    The core never predicts last season's number: it shrinks it toward the role's anchor (`beta_mantra`
    0.397 and 0.446 on the two published windows), and that is most of why it beats the naive baseline the
    backtest prints beside it. An estimate that hands over a raw fantamedia is that naive baseline wearing
    the sheet's third prefix - which is exactly what made Kolo Muani, a striker whose Serie A season is two
    years old, come out at 6.98 with +17.8 of surplus.
    """
    return anchor + beta * (fm - anchor)


def surplus(fm: float | None, pv: float | None, replacement: float | None,
            confidence: float) -> float | None:
    """(fm - replacement) x pv, THEN penalized - the SAME arithmetic as the sheet's `engine_surplus`.

    Identical on purpose, times the confidence: the whole point of this column is that one ranking can read
    every player, so a core row must come out at exactly its gated surplus (confidence 1.00) and an estimated
    row must be comparable with it. Weighting for catchability here and not there would have made the two
    columns two different questions - measured, it moved Hojlund from 28.4 to 24.6 while nothing about him
    had changed. The catchability weight belongs to whoever RANKS (`evaluate.auction_view` applies it to both
    sides of its own comparison); it does not belong to the column.

    The penalty is on the surplus alone: his fantamedia is our best guess either way, while what an auction
    ranks - points over the man you would have fielded instead - is the thing that should cost for not being
    known. Without a replacement level there is nothing to be over, so it falls back to VALUE, exactly as
    `snapshot._surplus` does.

    The paragraph above turned out to be the project's position and NOT the project's code: `auction_view`
    weighted and this did not, under one name. Both call `model.surplus_of` now with the exponent as an
    explicit argument, so the sentence and the arithmetic can no longer disagree (17/08/2026).
    """
    surplus_value = model.surplus_of(fm, pv, replacement)
    return None if surplus_value is None else surplus_value * confidence
