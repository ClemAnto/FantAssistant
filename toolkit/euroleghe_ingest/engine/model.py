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
# ⚠️ The name carries an 'e' this implementation has never earned, and it is kept only because every
# published number and every doc says M2e. `clubelo-gate.md` adopted M2 -> M2e in Colab by mixing the
# conceded rate 50/50 with the club's Elo; what got ported is the PERSISTENCE half alone, which is the
# formula modulo-portieri-fase2_2.md itself prints. So no goalkeeper number here reads `club_elo`
# (verified 27/07/2026, gate §3-quinquies (a); the comments that claimed otherwise were corrected
# 07/08/2026). Porting the Elo half is a candidate for the gate - on ten windows and both platforms,
# not on the two the Colab run had - and not a bug to quietly close.
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
    # presenze-attese-v1.md, RE-MEASURED 4/08/2026 on euro/mantra - the configuration these checks run in.
    # ⚠️ The published numbers were T1 -0.016 / T2 -0.013 for the gain and 5.2 / 5.3 for the naive bias, and
    # they CANNOT be reproduced on today's data for a reason worth writing down instead of chasing: the
    # document is dated 22 July 2026 and the `platform` dimension was introduced in the spec on 25-26 July.
    # Those numbers are PRE-PLATFORM - measured on a dataset that mixed the two calendars, which is what the
    # document means by «gestisce 34 vs 38 giornate», a pairing that no longer exists. The claim is also
    # PLATFORM-DEPENDENT and the document states it in the singular: on `default` (38->38) the module beats
    # the naive on BOTH windows (-5.2% and -2.9%, naive bias 6.26 / 5.64), on `euro` (30->31) only on T2.
    # So these are trust checks in the proper sense - does the code still compute what it computed - and the
    # scientific claim lives in the doc, per platform, with its date.
    # What the module was ADOPTED for reproduces everywhere: the naive promises the average starter 4-6
    # phantom matchdays and the model returns a residual bias of about zero.
    "pv_gain_vs_naive": {"T1": 0.0183, "T2": -0.0209},
    "pv_bias_naive_starters": {"T1": 4.17, "T2": 5.47},
    "pv_bias_model_starters": {"T1": -0.11, "T2": 0.09},
    # ...and the segment the auction is decided on, which the document quotes (6.84->6.51 and 6.71->6.27)
    # and NOTHING was checking until now. On euro/mantra today: T1 6.61 vs 6.42 (the naive wins by 3%),
    # T2 6.22 vs 6.80 (the model wins by 8.5%).
    "pv_mae_starters_model": {"T1": 6.61, "T2": 6.22},
    "pv_mae_starters_naive": {"T1": 6.42, "T2": 6.8},
    # The gate as it was actually RUN: coefficients fitted on the other window. A different quantity from
    # the in-window gain above, so it gets its own reference instead of borrowing one - T1 scored with T2's
    # fit is +1.26%, T2 scored with T1's is -2.09%.
    "pv_gain_crossfit": {"T1": 0.0126, "T2": -0.0209},
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


def predict_fm_from_history(anchor: float, fm_prev: float, fm_history: float,
                            lams: tuple[float, float]) -> float:
    """R18 - the core's shrinkage, told about more than one season.

    `predict_fm` reads LAST season and shrinks it toward the role anchor. A career is not one season, and
    the operator asked the question the right way round: «valutiamo anche una FM negli ultimi 5 anni come
    qualita' base del calciatore». Measured on 3470 player-seasons before the grid was written - MAE of
    the naive last-season figure 0.3921, of the role anchor 0.3981, of the raw five-year mean 0.3668, of
    the core's own shape 0.3458, and of the two terms together **0.3401** at 0.25 / 0.35.

    Both terms are deviations from the same anchor, so with the second at zero this IS `predict_fm` and
    the incumbent is inside the parameter space - which is what lets the gate refuse it cleanly.
    """
    return anchor + lams[0] * (fm_prev - anchor) + lams[1] * (fm_history - anchor)


# R18b's pre-registered grid (10/08/2026). `d = 1` would BE R18, so the incumbent is inside the space
# and a decay that only wins at the edge of this grid is not adopted - it earns a follow-up instead.
HISTORY_DECAYS: tuple[float, ...] = (0.50, 0.70, 0.85)


def weighted_history(seasons: tuple[float, ...] | list[float], decay: float) -> float | None:
    """The history term with older seasons worth less: weight `decay**k`, k = seasons back.

    `seasons` is MOST RECENT FIRST. With `decay = 1` this is the flat mean R18 already uses, which is
    what makes R18b a variant of it rather than a different rule: the hypothesis under test is only
    «older seasons say less», and nothing else moves.
    """
    if not seasons:
        return None
    weights = [decay ** k for k in range(len(seasons))]
    total = sum(weights)
    return sum(value * weight for value, weight in zip(seasons, weights)) / total if total else None


# R18c's pre-registered grid (10/08/2026): the SPLIT between last season and the history is declared,
# only the total strength is fitted. Diagnosed rather than guessed - the two-coefficient fit of R18 is
# not identified (the two regressors are nearly the same quantity), so its split swung from 0.38 to
# 40.7 across the nine windows while the SUM stayed at 0.68 +/- 19%. A parameter that follows its
# estimation window is not a parameter, and scoring one window with another's split is what put R18
# 4.6% under water on Tm5.
HISTORY_SPLITS: tuple[float, ...] = (0.50, 0.65)


def predict_fm_weighted_history(anchor: float, fm_prev: float, history: float,
                                lam: float, weight: float) -> float:
    """R18c - one strength, a declared split. `weight` = 1 is the core, so it stays inside the space."""
    blended = weight * (fm_prev - anchor) + (1.0 - weight) * (history - anchor)
    return anchor + lam * blended


def predict_fm_goalkeeper_weighted_history(mv_prev: float, mv_history: float,
                                           club_rate_prev: float | None, mu_rate: float,
                                           lam: float, weight: float) -> float:
    """R18c on a keeper's Mv: the ability half only, exactly as R18-GK does."""
    blended = weight * (mv_prev - GK_MV_ANCHOR) + (1.0 - weight) * (mv_history - GK_MV_ANCHOR)
    return predict_fm_goalkeeper_history(
        GK_MV_ANCHOR + blended, GK_MV_ANCHOR, club_rate_prev, mu_rate, (1.0, 0.0))


def predict_fm_goalkeeper_history(mv_prev: float, mv_history: float, club_rate_prev: float | None,
                                  mu_rate: float, lams: tuple[float, float]) -> float:
    """R18-GK: M2e with the ABILITY term told about more than one season.

    Only the ability half changes - the conceded-rate half and the penalties saved are M2e's and stay put.
    With `lams[1]` at zero this is `predict_fm_goalkeeper` with its own beta, so the incumbent is inside
    the parameter space. Measured before the grid, n=163: 0.1037 on last season alone, 0.1017 with both,
    and the weight goes almost entirely to the history (0.05 / 0.30).
    """
    mv_pred = (GK_MV_ANCHOR + lams[0] * (mv_prev - GK_MV_ANCHOR)
               + lams[1] * (mv_history - GK_MV_ANCHOR))
    rate = mu_rate if club_rate_prev is None else club_rate_prev
    return mv_pred - (mu_rate + GK_RATE_BETA * (rate - mu_rate)) + GK_PEN_SAVED


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


def blend_with_seen(prior: float, seen: float, rounds_seen: float, prior_rounds: float) -> float:
    """Quello che ha fatto finora e quello che ci si aspettava, pesati: R20 (gate §7-duotricies).

        share = (k x osservato + K x prior) / (k + K)

    `k` sono le giornate già giocate alla data d'asta, `K` quante ne servono perché l'osservato pesi
    quanto il prior. È la stessa forma della shrinkage per taglia del campione che il modello delle
    presenze già usa (`presence.standing_prior_rounds`, il verdetto più netto che quel giro abbia dato):
    un uomo che ha giocato tutte e tre le prime giornate non diventa un titolare da trentotto, e uno che
    ne ha giocate ventitré su ventitré sì.

    A `k` = 0 restituisce il prior INTATTO, che è ciò che rende la regola inerte su ogni finestra
    pre-stagione - cioè su tutte quelle su cui il gate ha pubblicato i suoi numeri.
    """
    if rounds_seen <= 0:
        return prior
    return (rounds_seen * seen + prior_rounds * prior) / (rounds_seen + prior_rounds)


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

    ⚠️⚠️ THE FAMILY IS CLOSED - decided 28/07/2026, on the fourth rejection. Kept in the code because the
    gate must still be able to re-score it, NOT because it is a live candidate. Do not propose a fifth
    measure of the same thing.

    Four attempts, all measuring "this club is strong, so shift his fantamedia": internal static club
    strength (retrospective FM residuals) · additive Elo for movement · R5, club Elo at the auction date
    (lambda +0.023/+0.073) · R5b, club attacking strength from expected assists (passes 3/3 on Serie A and
    fails on euro, and only on the three windows the hypothesis was read off). The SIGN was right every
    single time - the Kane intuition is correct - and the error never improved where it mattered.

    Why, and it is the same reason three unrelated families died: **the regressor is not incremental**.
    Kane's own fm_prev of 9.34 already contains Bayern, so a club term added on top restates what the
    baseline carries. R14 failed identically (a spell out is already inside `share_prev`) and so did R16
    (his own share of the club's goals is already inside his own fantamedia). A hypothesis whose input is
    derivable from the player's own history has to be expected to fail here, whatever its mechanism.

    And the direction of the residual says what the real fix is. The engine regressed Kane DOWN, 9.34 ->
    8.25, and he went UP to 10.60: the error is not a missing club term, it is that BETA over-shrinks a
    player whose level is genuinely that high. That is a different mechanism - a non-constant beta - and it
    is pre-registered separately.

    What would legitimately reopen this: a club measure that is ORTHOGONAL to the player's own history -
    forward-looking, and not derivable from the results that produced his fantamedia. Confirmed summer
    signings' quality, a new coach's historical attacking output, pre-season market odds. Another
    retrospective measure of past club strength is not a new hypothesis, it is a fifth run at this one.
    """
    if elo_z is None:
        return 0.0
    return lam * elo_z


def club_attack_adjustment(expected_z: float | None, lam: float) -> float:
    """R5b: the destination club's attacking strength, read off its EXPECTED assists.

    ⚠️ THE FOURTH ATTEMPT AT A FAMILY THIS GATE HAS REJECTED THREE TIMES. It is named for what it is
    rather than dressed as something else: R16b was built as a crowding rule and its fitted sign came out
    positive on 13 of 15 windows, which is club strength and not crowding. So the honest move is to test
    club strength directly, with the best measure of it we have, and to record a fourth rejection as a
    fourth rejection if that is the answer.

    Why xA rather than goals, measured at club level against the following season's goals per
    appearance: on euro, xA pooled 0.66 against goals' 0.59 and xG's 0.50 - assists expected is the best
    single read of the three. Two cautions kept in view. Its per-window values rise monotonically
    (0.49 / 0.68 / 0.81), and on the earliest of the three it is WORSE than goals, so "xA is better" holds
    on two windows and reverses on the third. And on Serie A nothing predicts well or stably (goals 0.55 /
    0.63 / 0.11), which says that a Serie A club's attack simply does not persist season to season.

    xG/xA start at 2022-23, so this is measurable on T0/T1/T2 only - and those are the same three windows
    R16b worked on and the ones the hypothesis was read off. A pass here therefore CONFIRMS NOTHING; only
    a failure would be informative.
    """
    if expected_z is None:
        return 0.0
    return lam * expected_z


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


# R17: a club's fielding capacity for forwards is measurable from this many elevens; below it the
# shape is unknown and the rule stays SILENT for that club - not measurable, never a guess.
FORWARD_MIN_XI = 10


def forward_claimant_order(entries: Sequence[tuple[int, float | None, float]]) -> list[int]:
    """R17: [(fc_id, price_initial, share_prev)] -> fc_ids by market rank inside the club's forwards.

    Qt.I descending - the market's own hierarchy of the club's strikers, and the only price a rule
    may read. A missing Qt.I ranks last (a forward the market does not price is not ranked above
    anybody); ties break by last season's share and then fc_id, so the order is deterministic.
    """
    def key(entry: tuple[int, float | None, float]):
        fc_id, price, share = entry
        return (price is None, -(price or 0.0), -(share or 0.0), fc_id)
    return [entry[0] for entry in sorted(entries, key=key)]


def forward_crowding_adjustment(overflow: float, lam: float) -> float:
    """R17: the share his team-mates claim ABOVE what the coach actually fields, charged to him.

    `overflow` = max(0, sum of the OTHER listone forwards' predicted shares at his club minus the
    club's measured forward capacity), and only for players the market ranks below that capacity:
    Inter's K of 2.05 charges Taremi and never Thuram; Fiorentina's 1.71 charges Piccoli. Excluding
    his own share removes the self-reference that sank R16 ("his share of the club's goals is
    already inside his own fantamedia"), and measuring the claim against fielded SLOTS rather than
    against goals removes the club-strength term that flipped R16b's sign on 13 of 15 windows. The
    inputs are the coach's revealed shape and the market's ranking of OTHER players - neither is
    derivable from the player's own history, which is the closed family's registered failure mode.
    """
    return lam * overflow


# ---------------- slot pressure (auction METRIC layer - metrica-asta-surplus-v1.md §11) ----------
# NOT a prediction rule: R17 established that crowding does not transfer as an error correction, so
# this lives in the ranking currency instead - a DECLARED preference with declared constants, zero
# fits, validated by the metric doc's own protocol (captured VALUE >= -2% and bust rate down, or the
# panel option ships OFF). The serious-claimant test is a COUNT on purpose: predicted-share sums are
# inflated by the fringe (the baseline hands Taremi 0.55), and the dangerous claimants - Openda and
# David arrived that summer - can be invisible to the predictions while sitting in the listone with
# a heavy Qt.I. Group-level, not rank-gated: Zapata was Torino's Qt.I leader and lost the slot.
SERIOUS_SHARE = 0.35        # a predicted share this high is a serious claim on the slot...
SERIOUS_QTI_MIN = 6.0       # ...and so is real auction money, absolute...
SERIOUS_QTI_FRACTION = 1 / 3  # ...or relative to the group's most expensive claimant
PRESSURE_EXPONENT = 0.5     # each serious claimant beyond capacity does not erase value linearly
PRESSURE_FLOOR = 0.60       # the discount is bounded...
PRESSURE_CAP = 1.15         # ...and so is the assured-slot premium (the user's inverse reasoning)


def slot_pressure_factor(serious: int, capacity: float) -> float:
    """Ranking multiplier for a forward group: <1 contested hierarchy, >1 assured slot.

    `serious` claimants against the club's measured fielded capacity K: Juventus 25/26 had four
    serious forwards on K 1.55 (factor 0.62), Como four on 1.34 (0.62 - the market's top three all
    flopped), Inter two on 2.05 (~1.0, and the pair held). Below capacity the slot is guaranteed by
    LACK of competition and earns the capped premium: errors get forgiven, the chances come back.
    """
    if capacity <= 0:
        return 1.0
    if serious <= 0:
        return PRESSURE_CAP
    return clip((capacity / serious) ** PRESSURE_EXPONENT, PRESSURE_FLOOR, PRESSURE_CAP)


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
