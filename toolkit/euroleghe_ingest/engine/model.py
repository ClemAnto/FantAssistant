"""Pure model formulas + the values published in docs/model (no DB, no I/O).

This is the CURRENT engine, the one the gate calls B0. Three of its four modules are validated
(docs/model): the Mantra/Classic core, the goalkeeper module M2e, expected appearances. The fourth -
the flag/arrival layer - does not exist yet, which is precisely what the roadmap addresses.

Two conventions matter here and are easy to get wrong:

* **Anchors are recomputed, not hard-coded.** The published values below are REFERENCE constants,
  used by `evaluate.verify_baseline` and by the tests to prove the recomputation from the DB is
  faithful. A backtest of season S must build its anchors from seasons <= input only: the
  engine's own 3-season means include the target season, which would be look-ahead.
* **Nothing in this file reads the target season.** Every argument is either an input-season
  quantity or something the listone publishes before the auction (roles, prices, club).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

# `sources` owns the canonical role vocabulary and the multi-role splitter (';' / '|' / '/');
# reusing the private helper keeps one parser in the codebase instead of two that can drift.
from euroleghe_ingest.engine.fitting import predict_linear
from euroleghe_ingest.sources import CLASSIC_ROLES, MANTRA_BY_CLASSIC, MANTRA_ROLES
from euroleghe_ingest.sources import _norm_roles as split_roles

__all__ = ["CLASSIC_ROLES", "MANTRA_BY_CLASSIC", "MANTRA_ROLES", "split_roles"]

# ---------------------------------------------------------------- parameters (validated)

BETA: dict[str, float] = {
    "classic": 0.50,   # modello-previsionale-v3.8.md
    "mantra": 0.42,    # ancore-mantra-fase2_1.md - deliberately NOT inherited from Classic
}

# The beta pairs were fitted on players with Pv >= 15, and the anchors on Pv >= 20: outside that
# domain the core has never been validated, so the harness refuses to pretend it has.
MIN_PV_PREV = 15
ANCHOR_MIN_PV = 20

# Roles whose own sample is too thin to carry an anchor borrow one (phase 2.1: 'b' = braccetto,
# introduced in the 25/26 listone with n=5, uses 'dc' until it matures).
ANCHOR_FALLBACK: dict[str, str] = {"b": "dc"}

# Goalkeepers, module M2e (modulo-portieri-fase2_2.md): FM = Mv_pred - GsRate_pred + 0.055
GK_MV_ANCHOR = 6.15
GK_MV_BETA = 0.40
GK_RATE_BETA = 0.40
GK_PEN_SAVED = 0.055          # 3 x the stable 0.018 penalties-saved-per-game rate

# Expected appearances (presenze-attese-v1.md):
#   share = 0.26 + 0.50*share_prev + 0.14*(Mv_prev - 6.2)clip + 0.04*club_change
PV_SHARE_COEFFS: tuple[float, float, float, float] = (0.26, 0.50, 0.14, 0.04)
MV_PIVOT = 6.2
# The doc writes "(Mv - 6.2)clip" without giving the bound. +/-1 grade covers the whole observed Mv
# band (about 5.2-7.2) and only bites on tiny-sample averages; recorded here so it is not invisible.
MV_CLIP = 1.0

# ---------------------------------------------------------------- published reference values

# Classic anchors on the EURO scale, per season (dataset-euroleghe-README.md, Pv >= 20).
REFERENCE_ANCHORS_CLASSIC: dict[str, dict[str, float]] = {
    "2023-24": {"P": 4.98, "D": 6.08, "C": 6.52, "A": 7.28},
    "2024-25": {"P": 5.01, "D": 6.07, "C": 6.51, "A": 7.34},
    "2025-26": {"P": 4.99, "D": 6.07, "C": 6.49, "A": 7.16},
}

# Fractional Mantra anchors, per season (ancore-mantra-fase2_1.md). Role 'b' (braccetto) appears
# only in the 25/26 listone with n=5 -> the engine uses the 'dc' anchor until the sample matures.
REFERENCE_ANCHORS_MANTRA: dict[str, dict[str, float]] = {
    "2023-24": {"por": 4.98, "dc": 5.97, "ds": 6.19, "dd": 6.15, "e": 6.27, "m": 6.24,
                "c": 6.39, "w": 6.78, "t": 6.83, "a": 7.07, "pc": 7.54},
    "2024-25": {"por": 5.01, "dc": 5.97, "ds": 6.05, "dd": 6.08, "e": 6.24, "m": 6.29,
                "c": 6.33, "w": 6.74, "t": 6.80, "a": 7.19, "pc": 7.52},
    "2025-26": {"por": 4.99, "dc": 6.01, "ds": 6.07, "dd": 6.07, "e": 6.23, "m": 6.24,
                "c": 6.33, "w": 6.70, "t": 6.69, "a": 7.10, "pc": 7.15, "b": 6.14},
}

# Engine anchors currently in use (means over the 3 seasons). Kept for reference only: a backtest
# that used them would be peeking at the target season.
ENGINE_ANCHORS_MANTRA: dict[str, float] = {
    "por": 5.00, "dc": 5.98, "b": 5.98, "ds": 6.10, "dd": 6.10, "e": 6.25,
    "m": 6.26, "c": 6.35, "w": 6.74, "t": 6.77, "a": 7.12, "pc": 7.40,
}

# Numbers the harness must reproduce before it is allowed to judge any new rule.
REFERENCE_GATE: dict[str, dict[str, float]] = {
    # ancore-mantra-fase2_1.md: two independent estimates of the Mantra beta
    "beta_mantra": {"T1": 0.382, "T2": 0.448},
    # modulo-portieri-fase2_2.md: naive vs M2 decomposed, FM MAE on goalkeepers
    "gk_mae_naive": {"T1": 0.323, "T2": 0.336},
    "gk_mae_m2e": {"T1": 0.242, "T2": 0.268},
    # presenze-attese-v1.md: appearances MAE improvement vs naive (fractions, not %)
    "pv_gain_vs_naive": {"T1": -0.016, "T2": -0.013},
    # ... and the bias the module was actually adopted for: the naive forecast promises the average
    # starter about 5 matchdays he will not play, and the module zeroes that out.
    "pv_bias_naive_starters": {"T1": 5.2, "T2": 5.3},
    "pv_bias_model_starters": {"T1": 0.4, "T2": -0.2},
}

# The two per-window fits behind the shipped average (presenze-attese-v1.md quotes them as
# "0.47/0.53 · 0.16/0.13 · 0.03/0.06"): share_prev, (Mv-6.2)clip, club_change. The strongest trust
# check available - it compares coefficients, not a summary statistic.
REFERENCE_PV_COEFFS: dict[str, tuple[float, float, float]] = {
    "T1": (0.47, 0.16, 0.03),
    "T2": (0.53, 0.13, 0.06),
}

# Regression cases: the players whose 2025-26 outcome exposed each hole (see the roadmap). A rule
# that improves the aggregate MAE without moving these has probably not fixed what it claims to.
REGRESSION_CASES: tuple[str, ...] = (
    "Lewandowski",     # age / minutes collapse, no age curve in the engine
    "Wirtz",           # cross-league move ignored (no arrival layer)
    "Torres F.",       # per-90 propensity ignored -> real level regressed as a career year
    "Ezzalzouli",      # new in the perimeter -> no prediction at all
    "Bremer",          # season-ending injury: predicted 5th among defenders, ended 283rd
    "Baumgartner C.",  # minutes/role regime change: predicted 126th, ended 4th
    "Dimarco",         # defender whose edge is bonus potential, not FM persistence
    "Kane",            # dominant-club environment: 8.21 predicted, 10.60 real
    # Bought on expectation, delivered little: the market had priced them at 20/21/13 credits before
    # the auction (Qt.I) and revised them to 3/8/10 by the end of the season.
    "Openda",          # Leipzig -> Juventus: FM 7.05 -> 5.67 on 12 appearances
    "David",           # Lille -> Juventus: FM 7.81 -> 6.04
    "Vlahovic",        # stayed, quotation halved before the auction (30 -> 13), FM 7.74 -> 6.75
)


# ---------------------------------------------------------------- formulas

def clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def fractional_anchor(roles: Sequence[str], anchors: Mapping[str, float]) -> float | None:
    """Anchor of a multi-role player = mean of the anchors of the k roles he is listed with.

    The fractional variant was adopted in phase 2.1 because averaging by primary role only made the
    thin roles (e, t) drift between seasons. Unknown roles are skipped; None means "no usable role",
    which the caller must treat as "not predictable", never as 0.
    """
    values = [anchors[role] for role in roles if role in anchors]
    if not values:
        return None
    return sum(values) / len(values)


def predict_fm(anchor: float, fm_prev: float, beta: float) -> float:
    """Core: regress last season's fantamedia towards the role anchor."""
    return anchor + beta * (fm_prev - anchor)


def predict_fm_goalkeeper(mv_prev: float, club_rate_prev: float | None, mu_rate: float) -> float:
    """M2e: predict ability (Mv) and the club's conceded rate separately, then recombine.

    `club_rate_prev` is the DESTINATION club's goals-conceded rate last season - transfer aware on
    purpose: a keeper who changes club inherits the new defence. None (club new to the perimeter)
    falls back to the population mean.
    """
    mv_pred = GK_MV_ANCHOR + GK_MV_BETA * (mv_prev - GK_MV_ANCHOR)
    rate = mu_rate if club_rate_prev is None else club_rate_prev
    gs_rate_pred = mu_rate + GK_RATE_BETA * (rate - mu_rate)
    return mv_pred - gs_rate_pred + GK_PEN_SAVED


def expected_share(share_prev: float, mv_prev: float, club_change: bool,
                   coeffs: Sequence[float] = PV_SHARE_COEFFS) -> float:
    """Share of the league's matchdays the player is expected to be rated in.

    Works on the share, not on the count, so 34-matchday and 38-matchday leagues mix safely.
    """
    a0, a1, a2, a3 = coeffs
    share = (a0 + a1 * share_prev + a2 * clip(mv_prev - MV_PIVOT, -MV_CLIP, MV_CLIP)
             + a3 * (1.0 if club_change else 0.0))
    return clip(share, 0.0, 1.0)


def expected_appearances(share: float, matchdays: int) -> float:
    return clip(share, 0.0, 1.0) * matchdays


def season_value(fm: float, appearances: float) -> float:
    """The auction metric: what a player is worth over a season, not per game."""
    return fm * appearances


# ---------------------------------------------------------------- candidate rules
#
# Every parameter below is FITTED (cross-window) by `evaluate.fit_params`, never a constant: the
# numbers are what the gate is deciding on. The functions are the shape of each hypothesis.

# R4: where the ageing term starts biting. One knee, two slopes (FM and share) - two windows and
# ~500 players do not support a curve with more knots.
AGE_KNEE = 30


def linear_share(coeffs: Sequence[float], featureset: Sequence[float]) -> float:
    """Generic share model: intercept + dot(coeffs, features), clipped to [0, 1].

    R3 (minutes), R7 (goalkeepers) and R1 (newcomers) are all this function with a different feature
    vector, so the clipping and the bounds live in one place.
    """
    return clip(predict_linear(coeffs, featureset), 0.0, 1.0)


def predict_fm_arrival(anchor: float, fm_equivalent: float, beta_new: float) -> float:
    """R1, players with no history in the game: regress the FOREIGN FM-equivalent to the anchor.

    `arrivals.foreign_fm_equiv` is what the player's fantamedia would have been under EuroLeghe
    scoring had his real season been played in the game - the only quantity that makes a Bundesliga
    season comparable to a Serie A one. `beta_new` is fitted, and is expected to be lower than the
    core beta: an equivalent is a noisier measurement than a real fantamedia.
    """
    return anchor + beta_new * (fm_equivalent - anchor)


def adaptation_discount(fm: float, discount: float) -> float:
    """R1, players who changed league: the adaptation cost the engine currently ignores entirely."""
    return fm - discount


def propensity_adjustment(gamma: float, z_propensity: float) -> float:
    """R2: how much of last season's residual is corroborated by the underlying per-90 volume.

    Positive z = more goals/assists (and xG/xA) per 90 than his role peers, so a high fantamedia was
    earned rather than lucky; negative z = a career year to regress harder.
    """
    return gamma * z_propensity


# R14: a gap this long inside a season is not rotation. Measured: 21-45 days is the normal band on
# both windows, and beyond 90 next season's appearances drop from ~18 to ~13.
NORMAL_GAP_DAYS = 45


def months_out(longest_gap_days: int | None) -> float:
    """Absence beyond a normal between-matches gap, in months - 0 for anyone who kept playing."""
    if not longest_gap_days:
        return 0.0
    return max(0, longest_gap_days - NORMAL_GAP_DAYS) / 30.0


def inactivity_adjustment(longest_gap_days: int | None, lam: float) -> float:
    """R14: what a spell out costs, per month out. Fitted, and expected negative."""
    return lam * months_out(longest_gap_days)


def production_per_90(goals: int | None, assists: int | None, minutes: int) -> float | None:
    """Goals plus assists per 90 in the recent sample. None when it was never MEASURED.

    `goals is None` means the per-match bonuses were never fetched, which is not the same as a goalless
    spell and must never be read as one - 111 of the 123 players in this population used to arrive here
    as "0 in 715 minutes" (see features._recent_form). A measured zero is a fact and passes through.
    """
    if goals is None or assists is None or minutes < MIN_MINUTES_FOR_PRODUCTION:
        return None
    return (goals + assists) / (minutes / 90.0)


def predict_fm_from_production(anchor: float, production_z: float, lam: float) -> float:
    """R13c: the role anchor plus how his measured PRODUCTION compared to the other newcomers.

    R13b compared his RATING and lost to the trivial answer: a provider rating in the Portuguese league
    is a different quantity from one in Serie A, and the comparison carried little. Goals and assists
    are the same event everywhere, which is the reason to expect more of them - Gyokeres arrived with 12
    goals in 10 matches (1.42 per 90) and the engine priced him at the bare 'pc' anchor with half a
    season of appearances, 44th among the strikers, on his way to finishing 10th.

    Standardised inside the COHORT and by role, not against the league: what travels across competitions
    is "more productive than the other newcomers we could measure", never the absolute rate.
    """
    return anchor + lam * production_z


def predict_fm_from_recent(anchor: float, rating_deviation: float, lam: float) -> float:
    """R13: price a player whose only measured football is `recent_form`, elsewhere.

    His rating comes from a competition the synthetic voto was never fitted on, so it is NOT converted
    into a base voto. What is used is its DEVIATION from the mean rating of that same sample: "better
    than the other newcomers we could measure" travels across leagues in a way that "7.0" does not.
    Everything else stays the role anchor, which is what the engine had for him before.
    """
    return anchor + lam * rating_deviation


# Below this the match rate is an artefact of the window, not a property of the player.
MIN_SPAN_DAYS = 21

# R13c: five full matches, the same floor the season-long per-90 propensity uses. Under it a rate is
# arithmetic on a rounding error - one goal in 120 minutes reads as 0.75 per 90.
MIN_MINUTES_FOR_PRODUCTION = 450


def recent_minutes_per_appearance(minutes: int, matches: int) -> float | None:
    """Minutes per match PLAYED, over 90 - how long he stayed on when he was picked.

    Named for what it measures. It was called a "minutes share" and read as "how much of a starter he
    was", which it cannot be: the sample only holds matches with minutes and is cut at ten of them, so
    a man who started 38 and a man who started 5 both come out at 1.0. Availability is
    `recent_availability` below; this is intensity.
    """
    if not matches:
        return None
    return clip(minutes / (90.0 * matches), 0.0, 1.0)


def recent_availability(matches: int, span_days: int | None) -> float | None:
    """Matches per week over the span of the sample: how OFTEN he was on the pitch.

    Ten matches inside seventy days is a regular; ten spread over eight months is a man in and out of
    the side. This is the part of "how much he plays" that the per-appearance figure cannot express,
    and it comes from dates we already store. Clipped at two a week, which is the real ceiling.

    A span under three weeks says nothing: three matches in four days is a rate of 5 a week, which is
    an artefact of a short window and not a fact about the player. Those return None and fall back to
    the baseline rather than entering the fit as noise.
    """
    if not matches or not span_days or span_days < MIN_SPAN_DAYS:
        return None
    return clip(matches / (span_days / 7.0), 0.0, 2.0)


def market_expectation_adjustment(price_z: float | None, lam: float) -> float:
    """R12: what the market expected of him, over and above what his own history says.

    The pre-auction quotation (Qt.I) is a second opinion built on things our data does not contain -
    a transfer fee, a pre-season, a coach's public words. Standardised inside the role, so it is
    "expensive FOR a striker", not "expensive". Sign is an open question and that is the point: a
    positive lambda would mean the market knows something the fantamedia does not, a negative one
    that expectation is systematically overpriced (the Openda / David pattern).
    """
    if price_z is None:
        return 0.0
    return lam * price_z


def expectation_revision_adjustment(revision: float | None, lam: float) -> float:
    """R12b: how the market revised him BEFORE the auction, year on year.

    `revision` = (Qt.I this season - Qt.I last season) / Qt.I last season, both pre-auction figures,
    so nothing here is hindsight. The archetype is Vlahovic 25/26: the quotation went 30 -> 13 before
    a ball was kicked, and the engine - which only reads last season's fantamedia - saw none of it.
    """
    if revision is None:
        return 0.0
    return lam * revision


def club_strength_adjustment(elo_z: float | None, lam: float) -> float:
    """R5: shift the role anchor by the destination club's standardised strength.

    ⚠️ ADJACENT TO TWO HYPOTHESES THE GATE ALREADY REJECTED - "internal club strength" and "additive
    Elo for movement" (see the rejected list in stato-progetto-continuita). It is retested because the
    doc's own improvement list opens with it and because the biggest single FM error the engine makes
    is a dominant-club one (Kane 8.29 predicted, 10.60 real): regressing him towards a league mean
    ignores that he plays in a team that scores twice as much as the league. If it fails again, it
    must be recorded as re-rejected, not quietly retried a third time.
    """
    if elo_z is None:
        return 0.0
    return lam * elo_z


def coach_change_adjustment(new_coach: bool, share_prev: float, level: float,
                            interaction: float) -> float:
    """R10: a new coach changes his mind about who plays.

    Two terms because the effect is not obviously a level shift: `level` is the average change in
    playing share, `interaction` multiplies the previous share - the hypothesis being that a new coach
    weakens the persistence of last season's hierarchy, which hurts the established starters more
    than the fringe. Fitted, so the data decides whether either term is real.
    """
    if not new_coach:
        return 0.0
    return level + interaction * share_prev


def competition_adjustment(same_role_arrivals: int, lam: float) -> float:
    """R11: new team-mates signed for the same role are minutes taken away from him."""
    return lam * same_role_arrivals


# R11b: below this, arrivals in your role are squad churn; at or above it, the position is genuinely
# crowded. Juventus 25/26 signed three forwards (Boga, David, Openda) on top of Vlahovic, and the
# engine gave Openda 25.8 appearances against 12 real ones.
CROWDED_POSITION = 2


def crowded_position_adjustment(same_role_arrivals: int, lam: float) -> float:
    """R11b: competition as a THRESHOLD, not a slope.

    R11 measured the same regressor linearly and came out positive (more arrivals, more appearances):
    for most clubs one signing is replacement, and clubs that buy are clubs whose players play. The
    hypothesis here is that the effect only reverses in the tail. NOTE: this variant was generated
    after seeing the 25/26 Juventus cases, so T2 is its hypothesis-generating window - a clean
    confirmation needs the 26/27 one.
    """
    return lam if same_role_arrivals >= CROWDED_POSITION else 0.0


def penalty_adjustment(confidence: float | None, lam: float) -> float:
    """R6: the designated taker's expected penalty income, in reduced form.

    The set-pieces note models this as rigori_attesi x taker_share x [conv*bonus - (1-conv)*malus].
    Here the whole product is collapsed into one fitted coefficient times the hierarchy's own
    CONFIDENCE, because that is what the data supports: `penalty_hierarchy` is a dated series with a
    graded confidence, but we have no per-club penalty-award rate and no career conversion rate yet.
    A reduced form that passes the gate is worth more than a structural form that cannot be fitted.
    """
    if confidence is None:
        return 0.0
    return lam * confidence


# Classic roles ordered by how far forward they play: the off-role signal is a MOVE along this axis.
ROLE_ADVANCEMENT: dict[str, int] = {"P": 0, "D": 1, "C": 2, "A": 3}


def off_role_adjustment(listed: str | None, derived: str | None,
                        forward: float, backward: float) -> float:
    """R8: the heatmap says he is used further forward (or further back) than his listed role.

    Asymmetric on purpose: being used further forward buys bonus chances, being used further back
    costs them, and there is no reason for the two to have the same size. What this rule does NOT
    contain is the set-piece and penalty half of the original hypothesis: `assists_set_piece` is NULL
    on every rating row in these three seasons (the source never split assists), and only 7 defenders
    are designated penalty takers - neither can be fitted, so neither is claimed.
    """
    if not listed or not derived:
        return 0.0
    delta = ROLE_ADVANCEMENT.get(derived, -1) - ROLE_ADVANCEMENT.get(listed, -1)
    if delta > 0:
        return forward
    if delta < 0:
        return backward
    return 0.0


def goal_budget(club_goals: float | None, attack_share: float | None) -> float | None:
    """R16: how many of his club's goals are plausibly HIS - the budget times his claim on it.

    The engine regresses every forward to the same role anchor, so two forwards of the same mid-table
    side are both priced as though the whole attack were theirs. Fiorentina scored 57 in 2024-25, sixth
    in Serie A; Kean came out 1st among the forwards and Piccoli 4th, and between them (with Solomon)
    they scored 12. Multiplying the club's goal level by his share of its attacking production is the
    smallest quantity that cannot say that: a share is at most 1, and two team-mates cannot both hold it.
    """
    if club_goals is None or attack_share is None:
        return None
    return club_goals * attack_share


def attack_rivals(club_goals: float | None, attack_share: float | None) -> float | None:
    """R16b: the part of his club's goal budget his TEAM-MATES claim - budget x (1 - his share).

    R16 measured budget x HIS OWN share and did nothing (3/10 windows, mean -1.2%), and in hindsight it
    could not: his own share of last season's goals is already inside his own fantamedia, so the
    regressor re-states what the baseline has and the fit finds nothing left to explain. What the
    baseline cannot know is how much the OTHERS are going to take, which is the crowding hypothesis
    stated properly.

    ⚠️ THE FITTED SIGN IS THE OPPOSITE OF THE HYPOTHESIS, and consistently so. Crowding predicts
    negative - the more the others take, the less is left. Measured: 9 of 10 Serie A windows positive
    (+0.033 to +0.165, the tenth -0.006) and 4 of 5 on euro. So this regressor does not measure crowding;
    it measures CLUB ATTACKING STRENGTH, with the sign of a rising tide. Which is intuitive in hindsight
    and is why the two are so hard to separate: a club whose attackers produced a lot last season is both
    a strong attack AND a crowded one, and the strong half evidently dominates.

    Consequence for the roadmap: the Kean / Piccoli hole is NOT closed by penalising shared attacks,
    because the data does not support the penalty at all. Separating the two effects needs both terms in
    one fit - strength and claimant count together - and that is partly a FOURTH attempt at the
    club-strength family the gate has already rejected three times (see `club_strength_adjustment`), so
    it is a decision to take out loud rather than a refinement to slip in here.
    """
    if club_goals is None or attack_share is None:
        return None
    return club_goals * (1.0 - attack_share)


def goal_budget_adjustment(volume_z: float | None, lam: float) -> float:
    """The fitted correction. Standardised inside the role, so it is "for a forward", not "in general"."""
    if volume_z is None:
        return 0.0
    return lam * volume_z


def age_adjustment(age: int | None, slope: float, knee: int = AGE_KNEE) -> float:
    """R4: linear decline past the knee, nothing before it. Missing age -> no adjustment.

    Deliberately one-sided: the young-player side of the curve is a different hypothesis (second-year
    growth, U22 triggers) and is not being tested here.
    """
    if age is None:
        return 0.0
    return slope * max(0, age - knee)
