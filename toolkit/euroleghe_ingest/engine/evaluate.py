"""The gate harness: predict a season from the previous one, then score what matters.

Two things this file exists to fix.

1. **The gate had no executable form.** The golden rule (a rule enters the engine only if it beats
   the baseline out of sample on two independent windows) lived in the documents; every number was
   produced by a one-off script. Here B0 - the current engine - is reproducible, and `verify_baseline`
   checks it against the values already published before any new rule is allowed to be judged.
2. **MAE alone is nearly blind.** Measured on 2 windows x 2 platforms, defenders have the best FM MAE
   of all roles (0.18-0.23) and the worst top-10 precision (1-3/10), and the appearances error
   contributes 3-11x more to the season VALUE error than the fantamedia error does. So the report
   carries, side by side: per-role top-N precision (the auction metric), the FM/Pv decomposition of
   the VALUE error (which side a rule is actually working on), and coverage (how many players get a
   prediction at all - 19% of the real top-10 slots were unreachable).
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime

from euroleghe_ingest.context import Context
from euroleghe_ingest.engine import features, model
from euroleghe_ingest.engine.fitting import fit_linear, spearman

# ---------------------------------------------------------------- rules registry


@dataclass(frozen=True)
class Rule:
    key: str
    summary: str
    implemented: bool = False
    metric: str = "fm"          # which side of VALUE = FM x Pv this rule is supposed to move
    # "accuracy" rules must beat the baseline on the players it already prices; "coverage" rules
    # price players it skipped entirely, so they cannot improve that metric by construction and are
    # judged on coverage, on the quality of what they add, and on doing no harm.
    kind: str = "accuracy"


# The pre-registered set (see the roadmap). Declared here so `--rules` can refuse a rule that has
# not been built yet instead of silently ignoring it.
# One rule = one hypothesis = one parameter family. R1/R1b and R4/R4b started life as single rules
# and were split after the first gate run: bundling "cover the newcomers" with "discount the movers"
# (or the fantamedia side of ageing with the appearances side) hides which half is working.
RULES: tuple[Rule, ...] = (
    Rule("R0", "baseline: the current validated engine (core + M2e + expected appearances)", True),
    # R0c is not a hypothesis, it is the null model made explicit: the role anchor and the mean share
    # for everyone the core cannot price. It exists because the stricter coverage criterion showed that
    # R1 and R13 do not beat it on euro - so the coverage is worth having and their estimators are not.
    Rule("R0c", "cover the unpriced with the role anchor and the population's mean share", True,
         kind="coverage"),
    Rule("R1", "cover the newcomers: foreign FM-equivalent + minutes-based appearances", True,
         kind="coverage"),
    Rule("R1b", "adaptation discount for players who changed league (control: changed club)", True),
    Rule("R2", "beta corroborated by per-90 propensity (xG/xA per 90)", True),
    Rule("R3", "minutes inside expected appearances", True, metric="pv"),
    Rule("R3c", "minutes measured on the euro calendar's own rounds (matchday_map)", True,
         metric="pv"),
    Rule("R6", "penalty duty at auction date, reduced form on the hierarchy's confidence", True),
    Rule("R8", "off-role usage from the heatmap (set-piece/penalty halves are data-blocked)", True),
    Rule("R4", "age curve on the fantamedia past 30", True),
    Rule("R4b", "age curve on expected appearances past 30", True, metric="pv"),
    # ⚠️ The key R7 was PRE-REGISTERED as "goalkeeper starter probability as a binary event". That
    # hypothesis turned out not to be testable at all - `probable_starter` exists only as a 2026-07
    # snapshot, so it is 0/1453 in every past window - and what is implemented and adopted under this
    # key is a DIFFERENT hypothesis: a dedicated persistence coefficient. Recorded here rather than
    # quietly overwritten, because a key whose hypothesis is redefined after a gate run is no longer
    # pre-registered in the sense the golden rule means.
    Rule("R7", "goalkeeper appearances: dedicated persistence (NOT the pre-registered binary "
               "starter probability, which `probable_starter` cannot support retrospectively)",
         True, metric="pv"),
    Rule("R9", "anchor recency weight (goal-environment drift)"),
    Rule("R5", "club-strength anchor from club_elo (RETEST of a rejected family)", True),
    Rule("R10", "new coach: level + interaction with last season's playing share", True,
         metric="pv"),
    Rule("R11", "positional competition: new team-mates signed for the same role", True,
         metric="pv"),
    Rule("R12", "market expectation: pre-auction quotation Qt.I, standardised inside the role", True),
    Rule("R12b", "expectation revision: how Qt.I moved year on year, before the auction", True),
    Rule("R13", "recent form elsewhere: APPEARANCES from his minutes at the old club", True,
         kind="coverage", metric="pv"),
    Rule("R13b", "recent form elsewhere: FANTAMEDIA from how his rating compared to the other "
                 "newcomers", True, kind="coverage"),
    Rule("R14", "inactivity: what a spell out of 45+ days costs in APPEARANCES", True, metric="pv"),
    Rule("R14b", "inactivity: what a spell out of 45+ days costs in FANTAMEDIA", True),
    Rule("R11b", "crowded position: 2+ same-role arrivals as a threshold, not a slope", True,
         metric="pv"),
)

# Rules that get fitted and compared one at a time by `compare`.
CANDIDATES: tuple[str, ...] = ("R0c", "R1", "R1b", "R2", "R3", "R3c", "R4", "R4b", "R5", "R6", "R7",
                               "R8", "R10", "R11", "R11b", "R12", "R12b", "R13", "R13b",
                               "R14", "R14b")

# What survived the gate, PER PLATFORM. Keeping it per platform is not a hedge: `platform` is a
# first-class dimension of the data model (different calendars, different perimeters), and the gate
# says these rules behave differently across it - R3 only helps where the target calendar IS the real
# calendar (Serie A), R1/R4 only where the perimeter is the 5-league top clubs (EuroLeghe).
# ⚠️ R4 (the age curve) LEFT this set on 27/07/2026 when a third window became available: it improves
# the players it moves by 1-3.5% on T1/T2 and makes them 0.9% worse on T0, and its coefficient varies
# 4.5x across the three windows (-0.004 / -0.011 / -0.018) - monotone in time, which is what a parameter
# that follows its estimation window looks like, not an age effect.
#
# R7 is no longer a bet. With seven Serie A windows and the POOLED keeper coefficient (see
# POOLED_PARAMS) it improves keeper appearances on ALL SEVEN - -1.6% to -18.3%, mean -9.8% - and never
# costs a top-10 place. Its earlier failures were the estimator's, not the rule's: one neighbour window's
# coefficient, fitted on ~30 keepers, was sometimes almost the shared 0.50 and the rule then did nothing.
#
# On EURO it stays out. There the same pooled coefficient wins 3 of 4 windows but only by 1.9-3.3% (the
# neighbour's higher coefficient was worth 17% on T1/T2 and nothing before), it trips the no-harm
# guardrail on T1, and across the four windows it is a wash on the auction metric: -1 name on Tm3 and T0,
# +1 on T1 and T2. Two platforms, two verdicts, which is what `platform` being a model dimension is for.
ADOPTED: dict[str, tuple[str, ...]] = {
    "euro": ("R0c", "R3c", "R10"),
    "default": ("R3", "R7", "R13"),
}
# What the corrected criteria changed, and why the list is shorter than it was:
# * accuracy rules are judged on the players they MOVE, with a 0.5% floor. That made R4 and R10 much
#   stronger than the diluted aggregate suggested (R4 -3.8%/-1.1% on the over-30s it touches, R10
#   -3.5%/-4.9% on its 234/260) and it killed R14, whose 0.04% "gain" carried a coefficient of the
#   wrong sign.
# * coverage rules must beat the TRIVIAL answer - the role anchor and the mean share - for the players
#   they add. R1's foreign FM-equivalent does not (0.391 against the anchor's 0.373 on T1), and neither
#   does R13's rating comparison on euro. So the coverage is kept and their estimators are not: R0c
#   prices the unpriced at the anchor, which is what the data supports and no more.
# * R13 survives on Serie A, where it does beat the trivial answer on both windows.
# * R0c is NOT adopted on Serie A: there the core's own error is 0.281 and an anchor-quality estimate
#   is 0.369, which misses the pre-declared "within +30%" bound by a point. Pricing the rest of that
#   listone anyway is a product decision, not something the gate licenses.



RULES_BY_KEY: dict[str, Rule] = {rule.key: rule for rule in RULES}

TOP_N = 10                 # the auction looks at the top 10 of each role
REGIME_RANK = 50           # predicted worse than this = a regime change, not a calibration error
MIN_PV_ACT = model.MIN_PV_PREV      # scoring domain for the FM metrics, as in the published gates
SEGMENTS: tuple[tuple[str, float, float], ...] = (
    ("starters", 0.70, 1.01), ("rotation", 0.40, 0.70), ("fringe", -0.01, 0.40))


def parse_rules(text: str | None) -> tuple[str, ...]:
    """'R0,R3' -> ('R0', 'R3'), rejecting unknown or not-yet-implemented rules."""
    keys = tuple(part.strip().upper() for part in (text or "R0").split(",") if part.strip())
    for key in keys:
        rule = RULES_BY_KEY.get(key)
        if rule is None:
            raise SystemExit(f"unknown rule {key!r}. Known: {', '.join(RULES_BY_KEY)}")
        if not rule.implemented:
            raise SystemExit(
                f"rule {key} ({rule.summary}) is pre-registered but not implemented yet - "
                "see the roadmap; run --rules R0 for the baseline")
    return keys or ("R0",)


# ---------------------------------------------------------------- prediction


@dataclass(frozen=True)
class Prediction:
    """The two halves of a valuation are predicted on DIFFERENT domains, so both are optional."""

    obs: features.Observation
    fm_pred: float | None
    pv_pred: float | None
    anchor: float | None

    @property
    def value_pred(self) -> float | None:
        if self.fm_pred is None or self.pv_pred is None:
            return None
        return model.season_value(self.fm_pred, self.pv_pred)


def _is_goalkeeper(obs: features.Observation) -> bool:
    return obs.role_classic == "P" or "por" in obs.roles_mantra


def _predict_fm(obs: features.Observation,
                data: features.WindowData) -> tuple[float | None, float | None]:
    """FM core. Needs a history inside the domain the beta was fitted on (Pv_prev >= 15)."""
    anchor = _anchor_for(obs, data)
    if obs.mv_prev is None or (obs.pv_prev or 0) < model.MIN_PV_PREV:
        return None, anchor
    # Goalkeepers first: M2e predicts ability and defence and never touches the role anchor, so a
    # missing 'P' anchor must not make a keeper unpredictable.
    if _is_goalkeeper(obs):
        return model.predict_fm_goalkeeper(
            obs.mv_prev, data.gk_rates.get(obs.club_target or ""), data.mu_rate), anchor
    if anchor is None or obs.fm_prev is None:
        return None, anchor
    return model.predict_fm(anchor, obs.fm_prev, model.BETA[data.game]), anchor


def fit_share(data: features.WindowData) -> tuple[tuple[float, ...] | None, int]:
    """Refit the appearances share regression on one window - the module is refitted every season.

    This is not a new rule: presenze-attese-v1 was gated CROSS-FITTED (coefficients from one window,
    scored on the other), and its published coefficients (0.47/0.53 · 0.16/0.13 · 0.03/0.06) are the
    two per-window fits, of which the engine ships the average. Reproducing the gate means being able
    to redo that fit, and it is also the hook R3 plugs its minutes regressor into.
    """
    samples: list[tuple[tuple[float, ...], float]] = []
    for obs in data.observations:
        if obs.pv_prev is None or obs.pv_act is None or not data.matchdays_target:
            continue
        mv_prev = obs.mv_prev if obs.mv_prev is not None else 0.0
        samples.append((
            (obs.share_prev(data.matchdays_prev),
             model.clip(mv_prev - model.MV_PIVOT, -model.MV_CLIP, model.MV_CLIP),
             1.0 if obs.club_change else 0.0),
            obs.pv_act / data.matchdays_target))
    return fit_linear(samples), len(samples)


# ---------------------------------------------------------------- derived features (not fitted)

# Below this a per-90 rate is noise, not a propensity: five full matches of football.
MIN_MINUTES_FOR_PROPENSITY = 450


@dataclass
class Derived:
    """Quantities computed FROM the window's own population - standardisations, not parameters."""

    minutes_share: dict[int, float]
    propensity_z: dict[int, float]
    elo_z: dict[int, float] = field(default_factory=dict)
    price_z: dict[int, float] = field(default_factory=dict)
    price_revision: dict[int, float] = field(default_factory=dict)
    recent_deviation: dict[int, float] = field(default_factory=dict)


def _scale(values: Sequence[float], min_n: int) -> tuple[float, float] | None:
    """(mean, sd) of a sample, or None when it is too thin or has no spread to standardise by."""
    if len(values) < min_n:
        return None
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
    return (mean, variance ** 0.5) if variance > 1e-9 else None


def _z_scores(samples: dict[int, tuple[object, float]], min_n: int) -> dict[int, float]:
    """Standardise each player's value inside its own group, clipped to three deviations.

    One helper for every standardisation in the engine (propensity per role x league, price per role,
    club Elo): the mean, the deviation, the minimum group size and the clip are decided in one place,
    so a change of policy cannot reach two of the three and miss the third.
    """
    groups: dict[object, list[float]] = {}
    for group, value in samples.values():
        groups.setdefault(group, []).append(value)
    stats = {group: scale for group, values in groups.items()
             if (scale := _scale(values, min_n)) is not None}
    out: dict[int, float] = {}
    for fc_id, (group, value) in samples.items():
        entry = stats.get(group)
        if entry is not None:
            out[fc_id] = model.clip((value - entry[0]) / entry[1], -3.0, 3.0)
    return out


def _elo_z_scores(data: features.WindowData) -> dict[int, float]:
    """Standardise the destination club's Elo across the CLUBS in this window (R5).

    Across clubs, not across players: otherwise a club with thirty listed players would pull the mean
    towards itself thirty times over.
    """
    scale = _scale([elo for elo in {obs.club_target: obs.elo_target for obs in data.observations
                                    if obs.club_target and obs.elo_target is not None}.values()], 5)
    if scale is None:
        return {}
    return {obs.fc_id: model.clip((obs.elo_target - scale[0]) / scale[1], -3.0, 3.0)
            for obs in data.observations if obs.elo_target is not None}


def _price_signals(data: features.WindowData) -> tuple[dict[int, float], dict[int, float]]:
    """R12/R12b: the pre-auction quotation standardised INSIDE the role, and its year-on-year change.

    Inside the role because 20 credits is elite for a defender and mid-table for a striker. The
    revision is a ratio, so a 30 -> 13 collapse and a 3 -> 1.3 one count the same.
    """
    price_z = _z_scores({obs.fc_id: (obs.role_classic, obs.price_initial)
                         for obs in data.observations
                         if obs.price_initial is not None and obs.role_classic}, 10)
    revision: dict[int, float] = {}
    for obs in data.observations:
        if obs.price_initial is not None and obs.price_initial_prev:
            revision[obs.fc_id] = model.clip(
                (obs.price_initial - obs.price_initial_prev) / obs.price_initial_prev, -1.0, 2.0)
    return price_z, revision


def derive(data: features.WindowData) -> Derived:
    """Minutes share and the per-90 propensity z-score, both from the INPUT season only.

    Memoised on the window: the gate evaluates the same window under every candidate rule, and none
    of this depends on which rules are active.
    """
    cached = data.cache.get("derived")
    if cached is not None:
        return cached
    minutes_share: dict[int, float] = {}
    raw: dict[int, tuple[object, float]] = {}
    for obs in data.observations:
        share = obs.minutes_share_prev(data.rounds_for(obs.league))
        if share is not None:
            minutes_share[obs.fc_id] = min(share, 1.0)
        # goalkeepers have no attacking propensity; thin samples are left out entirely
        if (obs.role_classic == "P" or not obs.minutes_prev
                or obs.minutes_prev < MIN_MINUTES_FOR_PROPENSITY):
            continue
        realised = ((obs.goals_prev or 0) + (obs.assists_prev or 0)) * 90.0 / obs.minutes_prev
        expected = ((obs.xg_prev or 0.0) + (obs.xa_prev or 0.0)) * 90.0 / obs.minutes_prev
        # half realised, half expected: the first is what the fantamedia was paid on, the second is
        # what is likely to repeat
        raw[obs.fc_id] = ((obs.role_classic, obs.league), 0.5 * (realised + expected))

    # standardise inside (role, league): a striker's volume is not a defender's, and league scoring
    # environments differ
    propensity_z = _z_scores(raw, 5)
    # R13: deviation from the mean rating of the players we could measure this way at all
    rated = [obs.recent_rating for obs in data.observations
             if obs.recent_matches and obs.recent_rating is not None]
    mean_rating = sum(rated) / len(rated) if rated else None
    recent_deviation = {obs.fc_id: obs.recent_rating - mean_rating
                        for obs in data.observations
                        if mean_rating is not None and obs.recent_matches
                        and obs.recent_rating is not None}
    price_z, price_revision = _price_signals(data)
    derived = Derived(recent_deviation=recent_deviation, minutes_share=minutes_share,
                      propensity_z=propensity_z, elo_z=_elo_z_scores(data),
                      price_z=price_z, price_revision=price_revision)
    data.cache["derived"] = derived
    return derived


# ---------------------------------------------------------------- cross-fitted parameters


@dataclass
class Params:
    """Parameters fitted on ONE window and applied to the OTHER - the project's gate protocol.

    Every field is None until the data identifies it; a rule with no parameter simply does not fire,
    which is how the harness stays honest about sample size instead of inventing coefficients.
    """

    source: str = "none"
    mean_share: float | None = None               # R0c: the population's mean predicted share
    share: tuple[float, ...] | None = None        # R3: share incl. minutes
    share_euro: tuple[float, ...] | None = None   # R3c: minutes on the euro rounds
    penalty_lam: float | None = None              # R6: penalty duty
    elo_lam: float | None = None                  # R5: club-strength anchor shift
    price_lam: float | None = None                # R12: market expectation
    revision_lam: float | None = None             # R12b: pre-auction expectation revision
    recent_lam: float | None = None               # R13: rating deviation of the recent-form sample
    recent_share: tuple[float, ...] | None = None  # R13: appearances from his minutes elsewhere
    idle_share: float | None = None               # R14: cost of a spell out, in share
    idle_fm: float | None = None                  # R14b: cost of a spell out, in fantamedia
    coach_level: float | None = None              # R10: new coach, average share change
    coach_interaction: float | None = None         # R10: new coach x previous share
    competition_lam: float | None = None           # R11: same-role arrivals at his club
    crowded_lam: float | None = None               # R11b: same, as a threshold
    off_role_forward: float | None = None         # R8: used further forward than listed
    off_role_backward: float | None = None        # R8: used further back than listed
    share_gk: tuple[float, ...] | None = None     # R7: goalkeepers
    share_new: tuple[float, ...] | None = None    # R1: players with no history in the game
    beta_new: float | None = None                 # R1: FM from the foreign equivalent
    discount_cross: float | None = None           # R1: adaptation, changed league
    discount_intra: float | None = None           # R1: control, changed club only
    gamma: float | None = None                    # R2: propensity corroboration
    age_fm: float | None = None                   # R4: slope past the knee, fantamedia
    age_share: float | None = None                # R4: slope past the knee, share
    notes: dict[str, object] = field(default_factory=dict)


def _mv_term(obs: features.Observation) -> float:
    mv_prev = obs.mv_prev if obs.mv_prev is not None else 0.0
    return model.clip(mv_prev - model.MV_PIVOT, -model.MV_CLIP, model.MV_CLIP)


# Rules whose parameters are POOLED over the other windows (leave-one-out) instead of taken from the
# single adjacent one, with the fields that get pooled. A rule belongs here when its coefficient is
# stable across windows but each window's estimate is noisy - which is a property to be demonstrated,
# window by window, not assumed. R7: keeper persistence, 0.505-0.798 on seven windows, from ~30 keepers
# each. See `docs/model/gate-motore-v1.md` §3-quater for the numbers that put it here.
POOLED_PARAMS: dict[str, tuple[str, ...]] = {"R7": ("share_gk",)}


def pool_params(fitted: dict[str, Params], exclude: str, base: Params) -> Params:
    """`base` with every pooled field replaced by the mean over the OTHER windows' fits.

    Out of sample is preserved by construction: `exclude` is the window being scored and its own fit is
    the one value left out of every average.
    """
    others = [params for key, params in fitted.items() if key != exclude]
    if not others:
        return base
    pooled = replace(base, source=f"{base.source}+pooled(-{exclude})")
    for fields in POOLED_PARAMS.values():
        for field_name in fields:
            values = [getattr(params, field_name) for params in others
                      if getattr(params, field_name) is not None]
            if not values:
                continue
            if isinstance(values[0], tuple):
                width = min(len(value) for value in values)
                mean = tuple(sum(value[i] for value in values) / len(values) for i in range(width))
            else:
                mean = sum(values) / len(values)
            setattr(pooled, field_name, mean)
    return pooled


# Rules that REPLACE the appearances share outright. A residual correction has to be fitted against
# whichever of these is active, not against B0 - otherwise both absorb the same variance and the
# combined configuration over-corrects (finding 7).
SHARE_REPLACING: frozenset[str] = frozenset({"R3", "R3c", "R7", "R13", "R0c"})


def fit_params(data: features.WindowData, rules: tuple[str, ...]) -> Params:
    """Estimate every requested rule's parameters on `data`. Caller applies them to another window.

    Two passes, because the rules are not independent: the share-REPLACING rules are fitted first
    against B0, and the residual corrections (R10, R11, R4b, R14) are then fitted against the share
    those rules actually produce. Fitting everything against B0 and adding it all up in the ADOPTED
    configuration double-counted the same variance.
    """
    derived = derive(data)
    params = Params(source=data.window.key)
    matchdays = data.matchdays_target or 1

    def baseline_share(obs: features.Observation) -> float | None:
        """The share the configuration's own replacing rules produce for this player."""
        active = tuple(rule for rule in rules if rule in SHARE_REPLACING or rule == "R0")
        value = _rule_pv(obs, data, active, params, derived) if active != ("R0",) else None
        if value is None:
            value = _predict_pv(obs, data)
        return None if value is None else value / matchdays

    if "R0c" in rules:
        priced = [_predict_pv(obs, data) for obs in data.observations]
        shares = [value / matchdays for value in priced if value is not None]
        params.mean_share = (sum(shares) / len(shares)) if shares else None
        params.notes["R0c_n"] = len(shares)

    if "R3" in rules:
        samples = [((obs.share_prev(data.matchdays_prev), derived.minutes_share[obs.fc_id],
                     _mv_term(obs), 1.0 if obs.club_change else 0.0), obs.pv_act / matchdays)
                   for obs in data.observations
                   if obs.pv_prev is not None and obs.pv_act is not None
                   and obs.fc_id in derived.minutes_share and obs.role_classic != "P"]
        params.share = fit_linear(samples)
        params.notes["R3_n"] = len(samples)

    if "R3c" in rules:
        samples = [((obs.share_prev(data.matchdays_prev), obs.minutes_share_euro_prev,
                     _mv_term(obs), 1.0 if obs.club_change else 0.0), obs.pv_act / matchdays)
                   for obs in data.observations
                   if obs.pv_prev is not None and obs.pv_act is not None
                   and obs.minutes_share_euro_prev is not None and obs.role_classic != "P"]
        params.share_euro = fit_linear(samples)
        params.notes["R3c_n"] = len(samples)

    if "R7" in rules:
        samples = [((obs.share_prev(data.matchdays_prev), 1.0 if obs.club_change else 0.0),
                    obs.pv_act / matchdays)
                   for obs in data.observations
                   if _is_goalkeeper(obs) and obs.pv_prev is not None and obs.pv_act is not None]
        params.share_gk = fit_linear(samples)
        params.notes["R7_n"] = len(samples)

    if "R13" in rules or "R13b" in rules:
        deviations, shares = [], []
        for obs in data.observations:
            if not obs.recent_matches or obs.fm_prev is not None:
                continue
            anchor = _anchor_for(obs, data)
            deviation = derived.recent_deviation.get(obs.fc_id)
            if (anchor is not None and deviation is not None and obs.fm_act is not None
                    and (obs.pv_act or 0) >= MIN_PV_ACT):
                deviations.append(((deviation,), obs.fm_act - anchor))
            intensity = model.recent_minutes_per_appearance(obs.recent_minutes, obs.recent_matches)
            availability = model.recent_availability(obs.recent_matches, obs.recent_span_days)
            if (intensity is not None and availability is not None and obs.pv_act is not None
                    and matchdays):
                shares.append(((intensity, availability), obs.pv_act / matchdays))
        fitted = fit_linear(deviations, intercept=False)
        params.recent_lam = fitted[0] if fitted else None
        params.recent_share = fit_linear(shares)
        params.notes["R13_fm_n"] = len(deviations)
        params.notes["R13_pv_n"] = len(shares)

    if "R1" in rules or "R1b" in rules:
        # appearances for players the game has never rated: minutes elsewhere are all we have
        samples = [((derived.minutes_share[obs.fc_id],), obs.pv_act / matchdays)
                   for obs in data.observations
                   if obs.pv_prev is None and obs.pv_act is not None
                   and obs.fc_id in derived.minutes_share]
        params.share_new = fit_linear(samples)
        params.notes["R1_share_n"] = len(samples)

        pairs, discounts = [], {"transfer_cross_league": [], "transfer_intra_league": []}
        for obs in data.observations:
            anchor = _anchor_for(obs, data)
            if anchor is None or obs.fm_act is None or (obs.pv_act or 0) < MIN_PV_ACT:
                continue
            if _is_goalkeeper(obs):
                continue          # the FM-equivalent ignores goals conceded: unusable for keepers
            if obs.pv_prev is None and obs.foreign_fm_equiv is not None:
                pairs.append(((obs.foreign_fm_equiv - anchor,), obs.fm_act - anchor))
            baseline, _anchor = _predict_fm(obs, data)
            if baseline is not None and obs.arrival_type in discounts:
                discounts[obs.arrival_type].append(baseline - obs.fm_act)
        fitted = fit_linear(pairs, intercept=False)
        params.beta_new = fitted[0] if fitted else None
        params.notes["R1_beta_n"] = len(pairs)
        for kind, key in (("transfer_cross_league", "discount_cross"),
                          ("transfer_intra_league", "discount_intra")):
            values = discounts[kind]
            if len(values) >= 10:
                setattr(params, key, sum(values) / len(values))
            params.notes[f"R1_{key}_n"] = len(values)

    if {"R14", "R14b"} & set(rules):
        idle_share, idle_fm = [], []
        for obs in data.observations:
            months = model.months_out(obs.longest_gap_days)
            if not months:
                continue
            base = baseline_share(obs)
            if base is not None and obs.pv_act is not None:
                idle_share.append(((months,), obs.pv_act / matchdays - base))
            baseline_fm, _anchor = _predict_fm(obs, data)
            if (baseline_fm is not None and obs.fm_act is not None
                    and (obs.pv_act or 0) >= MIN_PV_ACT):
                idle_fm.append(((months,), obs.fm_act - baseline_fm))
        if "R14" in rules:
            fitted = fit_linear(idle_share, intercept=False)
            params.idle_share = fitted[0] if fitted else None
            params.notes["R14_n"] = len(idle_share)
        if "R14b" in rules:
            fitted = fit_linear(idle_fm, intercept=False)
            params.idle_fm = fitted[0] if fitted else None
            params.notes["R14b_n"] = len(idle_fm)

    if {"R10", "R11", "R11b"} & set(rules):
        coach, competition, crowded = [], [], []
        for obs in data.observations:
            base = baseline_share(obs)
            if base is None or obs.pv_act is None or not matchdays:
                continue
            residual_share = obs.pv_act / matchdays - base
            if obs.new_coach_target:
                coach.append(((1.0, obs.share_prev(data.matchdays_prev)), residual_share))
            competition.append(((float(obs.same_role_arrivals),), residual_share))
            crowded.append(((1.0 if obs.same_role_arrivals >= model.CROWDED_POSITION else 0.0,),
                            residual_share))
        if "R10" in rules:
            fitted = fit_linear(coach, intercept=False)
            if fitted:
                params.coach_level, params.coach_interaction = fitted
            params.notes["R10_n"] = len(coach)
        if "R11" in rules:
            fitted = fit_linear(competition, intercept=False)
            params.competition_lam = fitted[0] if fitted else None
            params.notes["R11_n"] = sum(1 for f, _r in competition if f[0] > 0)
        if "R11b" in rules:
            fitted = fit_linear(crowded, intercept=False)
            params.crowded_lam = fitted[0] if fitted else None
            params.notes["R11b_n"] = sum(1 for f, _r in crowded if f[0] > 0)

    if {"R2", "R4", "R4b", "R5", "R6", "R8", "R12", "R12b"} & set(rules):
        propensity, ageing, ageing_share = [], [], []
        penalties: list[tuple[tuple[float, ...], float]] = []
        off_role: list[tuple[tuple[float, ...], float]] = []
        elo_pairs: list[tuple[tuple[float, ...], float]] = []
        price_pairs: list[tuple[tuple[float, ...], float]] = []
        revision_pairs: list[tuple[tuple[float, ...], float]] = []
        for obs in data.observations:
            baseline, _anchor = _predict_fm(obs, data)
            if baseline is not None and obs.fm_act is not None and (obs.pv_act or 0) >= MIN_PV_ACT:
                residual = obs.fm_act - baseline
                z = derived.propensity_z.get(obs.fc_id)
                if z is not None:
                    propensity.append(((z,), residual))
                age = obs.age(data.window)
                if age is not None:
                    ageing.append(((float(max(0, age - model.AGE_KNEE)),), residual))
                if not _is_goalkeeper(obs) and obs.penalty_rank == 1:
                    penalties.append(((obs.penalty_confidence or 0.0,), residual))
                z_elo = derived.elo_z.get(obs.fc_id)
                if z_elo is not None and not _is_goalkeeper(obs):
                    elo_pairs.append(((z_elo,), residual))
                z_price = derived.price_z.get(obs.fc_id)
                if z_price is not None:
                    price_pairs.append(((z_price,), residual))
                revision = derived.price_revision.get(obs.fc_id)
                if revision is not None:
                    revision_pairs.append(((revision,), residual))
                if not _is_goalkeeper(obs) and obs.derived_role_prev and obs.role_classic:
                    delta = (model.ROLE_ADVANCEMENT.get(obs.derived_role_prev, -1)
                             - model.ROLE_ADVANCEMENT.get(obs.role_classic, -1))
                    off_role.append(((1.0 if delta > 0 else 0.0, 1.0 if delta < 0 else 0.0),
                                     residual))
            base = baseline_share(obs)
            age = obs.age(data.window)
            if base is not None and obs.pv_act is not None and age is not None:
                ageing_share.append(((float(max(0, age - model.AGE_KNEE)),),
                                     obs.pv_act / matchdays - base))
        if "R2" in rules:
            fitted = fit_linear(propensity, intercept=False)
            params.gamma = fitted[0] if fitted else None
            params.notes["R2_n"] = len(propensity)
        if "R4" in rules or "R4b" in rules:
            fitted_fm = fit_linear(ageing, intercept=False)
            fitted_share = fit_linear(ageing_share, intercept=False)
            params.age_fm = fitted_fm[0] if fitted_fm else None
            params.age_share = fitted_share[0] if fitted_share else None
            params.notes["R4_n"] = len(ageing)
            params.notes["R4b_n"] = len(ageing_share)
        if "R5" in rules:
            fitted = fit_linear(elo_pairs, intercept=False)
            params.elo_lam = fitted[0] if fitted else None
            params.notes["R5_n"] = len(elo_pairs)
        if "R12" in rules:
            fitted = fit_linear(price_pairs, intercept=False)
            params.price_lam = fitted[0] if fitted else None
            params.notes["R12_n"] = len(price_pairs)
        if "R12b" in rules:
            fitted = fit_linear(revision_pairs, intercept=False)
            params.revision_lam = fitted[0] if fitted else None
            params.notes["R12b_n"] = len(revision_pairs)
        if "R6" in rules:
            fitted = fit_linear(penalties, intercept=False)
            params.penalty_lam = fitted[0] if fitted else None
            params.notes["R6_n"] = len(penalties)
        if "R8" in rules:
            fitted = fit_linear(off_role, intercept=False)
            if fitted:
                params.off_role_forward, params.off_role_backward = fitted
            params.notes["R8_n"] = len(off_role)
            params.notes["R8_forward_n"] = sum(1 for features_, _r in off_role if features_[0])
            params.notes["R8_backward_n"] = sum(1 for features_, _r in off_role if features_[1])
    return params


def _anchor_for(obs: features.Observation, data: features.WindowData) -> float | None:
    if data.game == "classic":
        return data.anchors.get(obs.role_classic or "")
    return model.fractional_anchor(obs.roles_mantra, data.anchors)


def _predict_pv(obs: features.Observation, data: features.WindowData,
                coeffs: tuple[float, ...] | None = None) -> float | None:
    """Expected appearances. Fitted on the WHOLE listone, so a previous-season row is enough.

    That asymmetry is the point: a fringe player with 6 appearances gets an appearances forecast and
    no fantamedia forecast, and evaluating the module only on the core's domain would hide exactly
    the segment (share < 0.4) whose systematic bias it was adopted to fix.
    """
    if obs.pv_prev is None:
        return None
    # pv_prev = 0 comes with mv = 0 in the source (no rating to average): the clip turns it into the
    # bottom of the band, which is how the module was fitted.
    mv_prev = obs.mv_prev if obs.mv_prev is not None else 0.0
    share = model.expected_share(obs.share_prev(data.matchdays_prev), mv_prev, obs.club_change,
                                 coeffs or model.PV_SHARE_COEFFS)
    return model.expected_appearances(share, data.matchdays_target)


def _rule_fm(obs: features.Observation, data: features.WindowData, rules: tuple[str, ...],
             params: Params, derived: Derived,
             baseline: float | None, anchor: float | None) -> float | None:
    """Apply the FM-side rules on top of B0. Order: cover, then correct, then age."""
    fm_pred = baseline

    # R1a - the player the engine cannot see at all: price him off the foreign FM-equivalent.
    # NOT for goalkeepers: `arrivals.foreign_fm_equiv` adds goal/assist bonuses to the base voto and
    # never subtracts goals conceded, so for a keeper it is inflated by about a full grade. A new
    # keeper needs an equivalent computed with the goalkeeper scoring - a fix in `arrivals`, not here.
    if (fm_pred is None and "R1" in rules and anchor is not None and obs.pv_prev is None
            and obs.foreign_fm_equiv is not None and params.beta_new is not None
            and not _is_goalkeeper(obs)):
        fm_pred = model.predict_fm_arrival(anchor, obs.foreign_fm_equiv, params.beta_new)

    # R0c - the engine has nothing for him: say so with the role anchor rather than with a number
    # dressed up as a measurement
    if fm_pred is None and "R0c" in rules and anchor is not None:
        fm_pred = anchor

    # R13 - his only measured football is elsewhere: the role anchor plus how he compared to the
    # other newcomers we could measure. Only where the engine has nothing else.
    if (fm_pred is None and "R13b" in rules and anchor is not None and obs.recent_matches
            and params.recent_lam is not None):
        deviation = derived.recent_deviation.get(obs.fc_id)
        if deviation is not None:
            fm_pred = model.predict_fm_from_recent(anchor, deviation, params.recent_lam)

    if (fm_pred is None and "R13" in rules and anchor is not None and obs.recent_matches
            and params.recent_share is not None):
        fm_pred = anchor          # measured appearances, role anchor for the rate: no rating term

    if fm_pred is None:
        return None

    # R1b - adaptation cost of changing league, which B0 ignores entirely
    if "R1b" in rules and not _is_goalkeeper(obs):
        if obs.arrival_type == "transfer_cross_league" and params.discount_cross is not None:
            fm_pred = model.adaptation_discount(fm_pred, params.discount_cross)
        elif obs.arrival_type == "transfer_intra_league" and params.discount_intra is not None:
            fm_pred = model.adaptation_discount(fm_pred, params.discount_intra)

    # R2 - was last season's level corroborated by the underlying per-90 volume?
    if "R2" in rules and params.gamma is not None:
        z = derived.propensity_z.get(obs.fc_id)
        if z is not None:
            fm_pred += model.propensity_adjustment(params.gamma, z)

    # R12 / R12b - what the market expected of him before the auction, and how it revised him
    if "R12" in rules and params.price_lam is not None:
        fm_pred += model.market_expectation_adjustment(
            derived.price_z.get(obs.fc_id), params.price_lam)
    if "R12b" in rules and params.revision_lam is not None:
        fm_pred += model.expectation_revision_adjustment(
            derived.price_revision.get(obs.fc_id), params.revision_lam)

    # R5 - the destination club's strength, as an anchor shift (retest of a rejected family)
    if "R5" in rules and params.elo_lam is not None and not _is_goalkeeper(obs):
        fm_pred += model.club_strength_adjustment(derived.elo_z.get(obs.fc_id), params.elo_lam)

    # R6 - penalty duty as known on auction day
    if "R6" in rules and params.penalty_lam is not None and obs.penalty_rank == 1:
        fm_pred += model.penalty_adjustment(obs.penalty_confidence, params.penalty_lam)

    # R8 - the heatmap says he is used further forward (or back) than his listed role
    if ("R8" in rules and params.off_role_forward is not None
            and params.off_role_backward is not None and not _is_goalkeeper(obs)):
        fm_pred += model.off_role_adjustment(obs.role_classic, obs.derived_role_prev,
                                             params.off_role_forward, params.off_role_backward)

    # R14b - he is coming back from a spell out
    if "R14b" in rules and params.idle_fm is not None:
        fm_pred += model.inactivity_adjustment(obs.longest_gap_days, params.idle_fm)

    # R4 - ageing
    if "R4" in rules and params.age_fm is not None:
        fm_pred += model.age_adjustment(obs.age(data.window), params.age_fm)
    return fm_pred


def _rule_pv(obs: features.Observation, data: features.WindowData, rules: tuple[str, ...],
             params: Params, derived: Derived) -> float | None:
    """Appearances with the rules on. Each branch replaces B0's share, then R4 adjusts it."""
    minutes_share = derived.minutes_share.get(obs.fc_id)
    share: float | None = None

    if _is_goalkeeper(obs) and "R7" in rules and params.share_gk and obs.pv_prev is not None:
        share = model.linear_share(params.share_gk, (obs.share_prev(data.matchdays_prev),
                                                     1.0 if obs.club_change else 0.0))
    elif ("R3c" in rules and params.share_euro and obs.pv_prev is not None
            and obs.minutes_share_euro_prev is not None and not _is_goalkeeper(obs)):
        share = model.linear_share(params.share_euro,
                                   (obs.share_prev(data.matchdays_prev),
                                    obs.minutes_share_euro_prev, _mv_term(obs),
                                    1.0 if obs.club_change else 0.0))
    elif ("R3" in rules and params.share and obs.pv_prev is not None
            and minutes_share is not None and not _is_goalkeeper(obs)):
        share = model.linear_share(params.share, (obs.share_prev(data.matchdays_prev),
                                                  minutes_share, _mv_term(obs),
                                                  1.0 if obs.club_change else 0.0))
    elif ("R1" in rules and params.share_new and obs.pv_prev is None
            and minutes_share is not None):
        share = model.linear_share(params.share_new, (minutes_share,))
    elif ({"R13", "R13b"} & set(rules) and params.recent_share and obs.pv_prev is None
            and obs.recent_matches):
        intensity = model.recent_minutes_per_appearance(obs.recent_minutes, obs.recent_matches)
        availability = model.recent_availability(obs.recent_matches, obs.recent_span_days)
        if intensity is not None and availability is not None:
            share = model.linear_share(params.recent_share, (intensity, availability))

    if share is None and "R0c" in rules and obs.pv_prev is None and params.mean_share is not None:
        share = params.mean_share

    if share is None:
        pv_pred = _predict_pv(obs, data)
        if pv_pred is None or not data.matchdays_target:
            return pv_pred
        share = pv_pred / data.matchdays_target

    if "R4b" in rules and params.age_share is not None:
        share += model.age_adjustment(obs.age(data.window), params.age_share)
    if ("R10" in rules and params.coach_level is not None
            and params.coach_interaction is not None):
        share += model.coach_change_adjustment(
            obs.new_coach_target, obs.share_prev(data.matchdays_prev),
            params.coach_level, params.coach_interaction)
    if "R14" in rules and params.idle_share is not None:
        share += model.inactivity_adjustment(obs.longest_gap_days, params.idle_share)
    if "R11" in rules and params.competition_lam is not None:
        share += model.competition_adjustment(obs.same_role_arrivals, params.competition_lam)
    if "R11b" in rules and params.crowded_lam is not None:
        share += model.crowded_position_adjustment(obs.same_role_arrivals, params.crowded_lam)
    return model.expected_appearances(model.clip(share, 0.0, 1.0), data.matchdays_target)


def predict_one(obs: features.Observation, data: features.WindowData, rules: tuple[str, ...],
                share_coeffs: tuple[float, ...] | None = None, params: Params | None = None,
                derived: Derived | None = None) -> Prediction | None:
    """One player's valuation. None = the engine has nothing to say (a finding, not a bug)."""
    fm_pred, anchor = _predict_fm(obs, data)
    if params is None or derived is None or rules == ("R0",):
        pv_pred = _predict_pv(obs, data, share_coeffs)
    else:
        fm_pred = _rule_fm(obs, data, rules, params, derived, fm_pred, anchor)
        pv_pred = _rule_pv(obs, data, rules, params, derived)
    if fm_pred is None and pv_pred is None:
        return None
    return Prediction(obs, fm_pred, pv_pred, anchor)


def predict_window(data: features.WindowData, rules: tuple[str, ...],
                   share_coeffs: tuple[float, ...] | None = None,
                   params: Params | None = None) -> list[Prediction]:
    derived = derive(data) if params is not None else None
    return [prediction for prediction in
            (predict_one(obs, data, rules, share_coeffs, params, derived)
             for obs in data.observations)
            if prediction is not None]


# ---------------------------------------------------------------- metrics


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _round(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(value, digits)


def role_metrics(observations: list[features.Observation], predictions: list[Prediction]) -> dict:
    """Everything we want to know about one role in one window."""
    valued = [p for p in predictions if p.value_pred is not None]
    ranked = sorted(valued, key=lambda p: -(p.value_pred or 0.0))
    predicted_rank = {prediction.obs.fc_id: index for index, prediction in enumerate(ranked, 1)}
    actual = sorted((obs for obs in observations if obs.value_act is not None),
                    key=lambda obs: -(obs.value_act or 0.0))

    top_predicted = ranked[:TOP_N]
    top_actual = actual[:TOP_N]
    hits = len({p.obs.fc_id for p in top_predicted} & {obs.fc_id for obs in top_actual})

    # Each metric on its own domain: the FM core, the appearances module, and their product.
    scored = [p for p in predictions if p.fm_pred is not None
              and p.obs.fm_act is not None and (p.obs.pv_act or 0) >= MIN_PV_ACT]
    with_pv = [p for p in predictions if p.pv_pred is not None and p.obs.pv_act is not None]
    with_value = [p for p in valued if p.obs.value_act is not None]

    return {
        "n_observations": len(observations),
        "n_predicted": len(valued),
        "n_predicted_pv": len(with_pv),
        "coverage": _round(len(valued) / len(observations), 3) if observations else None,
        "coverage_pv": _round(len(with_pv) / len(observations), 3) if observations else None,
        "top_n": {
            "hits": hits,
            "of": min(TOP_N, len(top_actual)),
            # actual top-N players the engine could not price at all, and those it priced far too low
            "uncovered": sum(1 for obs in top_actual if obs.fc_id not in predicted_rank),
            "regime_change": sum(1 for obs in top_actual
                                 if predicted_rank.get(obs.fc_id, 10**6) > REGIME_RANK),
        },
        "fm": {
            "n": len(scored),
            "mae": _round(_mean([abs(p.fm_pred - p.obs.fm_act) for p in scored])),
            "mae_naive": _round(_mean([abs((p.obs.fm_prev or 0) - p.obs.fm_act) for p in scored])),
            "bias": _round(_mean([p.fm_pred - p.obs.fm_act for p in scored])),
        },
        "pv": {
            "n": len(with_pv),
            "mae": _round(_mean([abs(p.pv_pred - p.obs.pv_act) for p in with_pv]), 2),
            "mae_naive": _round(_mean([abs((p.obs.pv_prev or 0) - p.obs.pv_act)
                                       for p in with_pv]), 2),
            "bias": _round(_mean([p.pv_pred - p.obs.pv_act for p in with_pv]), 2),
        },
        "value": {
            "n": len(with_value),
            "mae": _round(_mean([abs(p.value_pred - (p.obs.value_act or 0))
                                 for p in with_value]), 1),
            # which side of VALUE = FM x Pv the error comes from: this is the compass
            "contrib_fm": _round(_mean([abs(p.fm_pred - p.obs.fm_act) * (p.obs.pv_act or 0)
                                        for p in with_value if p.obs.fm_act is not None]), 1),
            "contrib_pv": _round(_mean([(p.obs.fm_act or 0) * abs(p.pv_pred - (p.obs.pv_act or 0))
                                        for p in with_value if p.obs.fm_act is not None]), 1),
            "spearman": _round(spearman([(p.value_pred, p.obs.value_act or 0.0)
                                         for p in with_value])),
        },
    }


def appearance_segments(data: features.WindowData, predictions: list[Prediction]) -> dict:
    """Bias by playing-time segment: the criterion presenze-attese-v1 was actually adopted on."""
    out: dict[str, dict] = {}
    for name, low, high in SEGMENTS:
        bucket = [p for p in predictions if p.pv_pred is not None and p.obs.pv_act is not None
                  and low <= p.obs.share_prev(data.matchdays_prev) < high]
        out[name] = {
            "n": len(bucket),
            "bias_model": _round(_mean([p.pv_pred - p.obs.pv_act for p in bucket]), 2),
            "bias_naive": _round(_mean([(p.obs.pv_prev or 0) - p.obs.pv_act for p in bucket]), 2),
        }
    return out


def evaluate_window(data: features.WindowData, rules: tuple[str, ...],
                    share_coeffs: tuple[float, ...] | None = None,
                    params: Params | None = None,
                    predictions: list[Prediction] | None = None) -> dict:
    """Metrics for one configuration.

    `predictions` lets a caller that already has them skip a second identical pass: `compare` was
    predicting every window twice for every candidate rule.
    """
    if predictions is None:
        predictions = predict_window(data, rules, share_coeffs, params)
    by_role: dict[str, dict] = {}
    for role in model.CLASSIC_ROLES:
        role_observations = [obs for obs in data.observations if obs.role_classic == role]
        role_predictions = [p for p in predictions if p.obs.role_classic == role]
        if role_observations:
            by_role[role] = role_metrics(role_observations, role_predictions)
    return {
        "window": data.window.label,
        "platform": data.platform,
        "game": data.game,
        "matchdays": {"input": data.matchdays_prev, "target": data.matchdays_target},
        "anchors": {role: round(value, 3) for role, value in sorted(data.anchors.items())},
        "share_coeffs": [round(value, 4) for value in (share_coeffs or model.PV_SHARE_COEFFS)],
        "rules": list(rules),
        "params_from": params.source if params else "published",
        "overall": role_metrics(data.observations, predictions),
        "by_role": by_role,
        "appearance_segments": appearance_segments(data, predictions),
        "features": features.feature_availability(data.observations),
    }


# ---------------------------------------------------------------- the gate


def _delta(before: float | None, after: float | None) -> str:
    """Signed relative change, formatted for a terminal table. Lower is better for every MAE."""
    if before is None or after is None or not before:
        return "   n/a"
    return f"{(after - before) / before * 100:+5.1f}%"


def _errors(predictions: list[Prediction], metric: str) -> dict[int, float]:
    """{fc_id: absolute error} for the players this configuration actually priced."""
    out: dict[int, float] = {}
    for prediction in predictions:
        obs = prediction.obs
        if metric == "fm":
            if (prediction.fm_pred is None or obs.fm_act is None
                    or (obs.pv_act or 0) < MIN_PV_ACT):
                continue
            out[obs.fc_id] = abs(prediction.fm_pred - obs.fm_act)
        elif metric == "pv":
            if prediction.pv_pred is None or obs.pv_act is None:
                continue
            out[obs.fc_id] = abs(prediction.pv_pred - obs.pv_act)
        else:
            if prediction.value_pred is None or obs.value_act is None:
                continue
            out[obs.fc_id] = abs(prediction.value_pred - obs.value_act)
    return out


def _naive_added(data: features.WindowData, baseline: list[Prediction],
                 candidate: list[Prediction], metric: str) -> float | None:
    """MAE the players a coverage rule ADDS would get from the trivial answer.

    The trivial answer is what the engine already had for them: the role anchor for the fantamedia and
    the mean predicted share for appearances. A coverage rule that cannot beat this is not carrying
    information - it is spreading the population mean over a new set of names.
    """
    priced = [p.pv_pred / data.matchdays_target for p in baseline
              if p.pv_pred is not None and data.matchdays_target]
    mean_share = (sum(priced) / len(priced)) if priced else None
    known = {p.obs.fc_id for p in baseline
             if (p.fm_pred if metric == "fm" else
                 p.pv_pred if metric == "pv" else p.value_pred) is not None}
    errors: list[float] = []
    for prediction in candidate:
        obs = prediction.obs
        if obs.fc_id in known:
            continue
        anchor = _anchor_for(obs, data)
        naive_pv = (mean_share * data.matchdays_target) if mean_share is not None else None
        if metric == "fm":
            if anchor is None or obs.fm_act is None or (obs.pv_act or 0) < MIN_PV_ACT:
                continue
            errors.append(abs(anchor - obs.fm_act))
        elif metric == "pv":
            if naive_pv is None or obs.pv_act is None:
                continue
            errors.append(abs(naive_pv - obs.pv_act))
        else:
            if anchor is None or naive_pv is None or obs.value_act is None:
                continue
            errors.append(abs(anchor * naive_pv - obs.value_act))
    return (sum(errors) / len(errors)) if errors else None


MIN_RELATIVE_GAIN = 0.005      # half a percent on the players it touches: below that it is noise
# How much a single window may go AGAINST an accuracy rule before the robust verdict gives up on it.
# Only used by the robust verdict; the strict one tolerates nothing, which is the point of having both.
MAX_WINDOW_LOSS = 0.02
# Below this many measuring windows there is no majority to speak of and only the strict verdict applies.
MIN_WINDOWS_FOR_ROBUST = 3


def _changed_mae(baseline: list[Prediction], candidate: list[Prediction],
                 metric: str) -> tuple[float | None, float | None, int]:
    """(before, after, n) on the players whose prediction the rule actually MOVED.

    A rule that only touches over-30s or players with a spell out is diluted to nothing by the whole
    population, and one that moves everyone by a hair looks the same as one that fixes a segment. The
    changed subset is the denominator that makes the comparison mean something.
    """
    before, after = _errors(baseline, metric), _errors(candidate, metric)
    by_id = {p.obs.fc_id: p for p in baseline}
    moved: list[int] = []
    for prediction in candidate:
        twin = by_id.get(prediction.obs.fc_id)
        if twin is None:
            continue
        pairs = ((twin.fm_pred, prediction.fm_pred) if metric == "fm"
                 else (twin.pv_pred, prediction.pv_pred) if metric == "pv"
                 else (twin.value_pred, prediction.value_pred))
        if pairs[0] is None or pairs[1] is None:
            continue
        if abs(pairs[0] - pairs[1]) > 1e-9:
            moved.append(prediction.obs.fc_id)
    shared = [fc_id for fc_id in moved if fc_id in before and fc_id in after]
    if not shared:
        return None, None, 0
    return (sum(before[i] for i in shared) / len(shared),
            sum(after[i] for i in shared) / len(shared), len(shared))


def _common_mae(baseline: list[Prediction], candidate: list[Prediction],
                metric: str) -> tuple[float | None, float | None, int, float | None, int]:
    """MAE of both configurations ON THE SAME PLAYERS, plus the candidate's new coverage.

    A rule that prices players the baseline skipped (R1) must not be judged on a bigger, harder
    sample: that would score it against a different population. So the comparison runs on the
    intersection, and what it added is reported separately - a MAE with no baseline to beat.
    """
    before = _errors(baseline, metric)
    after = _errors(candidate, metric)
    shared = set(before) & set(after)
    added = set(after) - set(before)
    mean_before = sum(before[i] for i in shared) / len(shared) if shared else None
    mean_after = sum(after[i] for i in shared) / len(shared) if shared else None
    mean_added = sum(after[i] for i in added) / len(added) if added else None
    return mean_before, mean_after, len(shared), mean_added, len(added)


def _common_by_role(baseline: list[Prediction], candidate: list[Prediction],
                    metric: str) -> dict[str, dict]:
    """Same comparison as `_common_mae`, per Classic role - the auction is played role by role."""
    roles = {prediction.obs.fc_id: (prediction.obs.role_classic or "?")
             for prediction in baseline + candidate}
    before, after = _errors(baseline, metric), _errors(candidate, metric)
    out: dict[str, dict] = {}
    for role in model.CLASSIC_ROLES:
        ids = {fc_id for fc_id, value in roles.items() if value == role}
        shared = (set(before) & set(after)) & ids
        added = (set(after) - set(before)) & ids
        out[role] = {
            "n": len(shared),
            "before": _round(sum(before[i] for i in shared) / len(shared)) if shared else None,
            "after": _round(sum(after[i] for i in shared) / len(shared)) if shared else None,
            "added_n": len(added),
            "added_mae": _round(sum(after[i] for i in added) / len(added)) if added else None,
        }
    return out


# A window needs a real input season, not just a listone: below this many players with a previous
# fantamedia there is nothing to predict FROM and every metric would be computed on a handful of names.
MIN_WITH_HISTORY = 50


def _window_is_usable(data: features.WindowData, platform: str) -> bool:
    """BOTH seasons must have votes: one to predict from, one to be scored against.

    EuroLeghe's hole at 2021-22 needs both halves of this check. Its Tm1 fails on the input side (nothing
    to predict from) and its Tm2 on the OUTCOME side - the input season is fine, so an input-only check
    let Tm2 through, and it contributed rows scored on zero players to every rule in the gate. Reported
    out loud either way: a silently dropped window looks exactly like a window that passed.
    """
    if not data.observations:
        print(f"[gate] {data.window.label} {platform}: no observations - skipped")
        return False
    with_history = sum(1 for obs in data.observations if obs.fm_prev is not None)
    with_outcome = sum(1 for obs in data.observations if obs.fm_act is not None)
    for count, side, season in ((with_history, "a previous fantamedia", data.window.input_season),
                                (with_outcome, "an actual fantamedia", data.window.target_season)):
        if count < MIN_WITH_HISTORY:
            print(f"[gate] {data.window.label} {platform}: only {count} players have {side} - "
                  f"{season} has no votes, window skipped")
            return False
    return True


def compare(conn: sqlite3.Connection, candidates: tuple[str, ...], platform: str,
            game: str, windows: tuple[str, ...] | None = None) -> dict:
    """Run B0 and B0+rule on both windows, with every parameter fitted on the OTHER window.

    This is the gate: a rule is only interesting if it improves the metric it targets on BOTH
    windows, on the common sample, without making FM or VALUE worse (the golden rule's guardrail)
    and without losing the top-10 precision the auction actually consumes.
    """
    keys = tuple(windows or features.WINDOWS)
    prepared = {key: features.prepare(conn, features.WINDOWS[key], platform, game) for key in keys}
    prepared = {key: data for key, data in prepared.items() if _window_is_usable(data, platform)}
    if len(prepared) < 2:
        raise RuntimeError("the gate needs at least two usable windows, got "
                           f"{list(prepared)} on {platform}/{game}")
    everything = ("R0", *candidates)
    adopted = ("R0", *ADOPTED.get(platform, ()))
    fitted = {key: fit_params(data, everything) for key, data in prepared.items()}

    out: dict = {"platform": platform, "game": game, "windows": {}, "params": {}, "verdicts": {}}
    for key, params in fitted.items():
        out["params"][key] = {name: value for name, value in vars(params).items()
                              if name != "notes" and value is not None}
        out["params"][key]["notes"] = params.notes

    predictions: dict[str, dict[str, list[Prediction]]] = {}
    for key, data in prepared.items():
        other = features.cross_fit_source(key, tuple(prepared))
        # the neighbour's fit for everything except the pooled rules, whose coefficients come from the
        # mean over every window but this one
        scoring = pool_params(fitted, key, fitted[other])
        predicted = {"R0": predict_window(data, ("R0",))}
        configurations = {"R0": evaluate_window(data, ("R0",), predictions=predicted["R0"])}
        for rule in (*candidates, "ALL", "ADOPTED"):
            active = {"ALL": everything, "ADOPTED": adopted}.get(rule, ("R0", rule))
            predicted[rule] = predict_window(data, active, None, scoring)
            configurations[rule] = evaluate_window(data, active, None, scoring,
                                                   predictions=predicted[rule])
        out["windows"][key] = configurations
        predictions[key] = predicted
    out["adopted"] = list(adopted[1:])

    for rule in (*candidates, "ALL", "ADOPTED"):
        # A mixed set moves both halves, so it is judged on the product - the auction metric.
        target = RULES_BY_KEY[rule].metric if rule in RULES_BY_KEY else "value"
        kind = RULES_BY_KEY[rule].kind if rule in RULES_BY_KEY else "accuracy"
        rows = []
        for key, window_data in prepared.items():
            baseline = out["windows"][key]["R0"]["overall"]
            candidate = out["windows"][key][rule]["overall"]
            before, after, shared, added_mae, added_n = _common_mae(
                predictions[key]["R0"], predictions[key][rule], target)
            _fmb, fma, _n, _a, _an = _common_mae(
                predictions[key]["R0"], predictions[key][rule], "fm")
            _vb, vla, _n2, _a2, _an2 = _common_mae(
                predictions[key]["R0"], predictions[key][rule], "value")
            fm_before, value_before = _fmb, _vb
            changed_before, changed_after, changed_n = _changed_mae(
                predictions[key]["R0"], predictions[key][rule], target)
            rows.append({
                "window": key, "n_common": shared,
                "changed_n": changed_n, "changed_before": _round(changed_before),
                "changed_after": _round(changed_after),
                "added_mae_naive": _round(_naive_added(
                    window_data, predictions[key]["R0"], predictions[key][rule], target)),
                "by_role": _common_by_role(predictions[key]["R0"], predictions[key][rule], target),
                "target_before": _round(before), "target_after": _round(after),
                "added_mae": _round(added_mae), "added_n": added_n,
                "fm_before": _round(fm_before), "fm_after": _round(fma),
                "value_before": _round(value_before, 1), "value_after": _round(vla, 1),
                "top_before": sum(m["top_n"]["hits"] for m in role_reports(out, key, "R0")),
                "top_after": sum(m["top_n"]["hits"] for m in role_reports(out, key, rule)),
                "coverage_before": baseline["coverage"], "coverage_after": candidate["coverage"],
            })

        def better(rows_: list[dict], field_before: str, field_after: str,
                   tolerance: float = 1.0) -> bool:
            return all(row[field_after] is not None and row[field_before] is not None
                       and row[field_after] <= row[field_before] * tolerance for row in rows_)

        # A window where the rule moves NOBODY has not tested it - the inputs it needs do not exist
        # that far back. Excluded from the verdict and named in the report, because scoring it as a
        # failure would retire a rule for the sin of predating its own data.
        # What counts as "this window tested the rule" depends on the kind: an accuracy rule is
        # tested where it MOVES a prediction, a coverage rule where it ADDS one. Using the moved
        # subset for both labelled every coverage rule unmeasurable everywhere, since not moving
        # anyone already priced is precisely what a coverage rule is supposed to do.
        counter = "added_n" if kind == "coverage" else "changed_n"
        measured = [row for row in rows if row[counter]]
        unmeasurable = [row["window"] for row in rows if not row[counter]]
        # improvement is measured on the players the rule MOVES, and has to clear a floor: an
        # 0.04% gain on a coefficient whose sign contradicts its own hypothesis is not a rule.
        improved = len(measured) >= 2 and all(
            row["changed_before"] is not None and row["changed_after"] is not None
            and row["changed_n"] > 0
            and row["changed_after"] <= row["changed_before"] * (1 - MIN_RELATIVE_GAIN)
            for row in measured)
        kind = RULES_BY_KEY[rule].kind if rule in RULES_BY_KEY else "accuracy"
        # On the windows that MEASURE the rule, like every other criterion. Adding older windows
        # exposed the asymmetry: on a window where `recent_form` has no data R13 adds nobody, so
        # "coverage up" was False and every coverage rule failed automatically the moment a window
        # existed that could not see its input.
        coverage_up = len(measured) >= 2 and all(
            (row["coverage_after"] or 0) > (row["coverage_before"] or 0) for row in measured)
        # what a coverage rule adds must be in the same league as what already existed: 30% worse
        # than the baseline's own error is the line, beyond which "a prediction" is just noise
        added_sane = all(row["added_mae"] is not None and row["target_before"] is not None
                         and row["added_mae"] <= row["target_before"] * 1.30 for row in measured)
        # ... and it must beat the trivial answer for those same players, or it is only spreading the
        # population mean over new names (finding 8: a near-constant prediction passed the old test).
        # R0c is exempt because it IS the trivial answer - the null model is not asked to beat itself.
        beats_naive = rule == "R0c" or all(
            row["added_mae"] is not None and row["added_mae_naive"] is not None
            and row["added_mae"] < row["added_mae_naive"] for row in measured)
        verdict = {
            "kind": kind, "metric": target, "rows": rows, "improved_both": improved,
            "coverage_up": coverage_up, "added_sane": added_sane,
            "beats_naive": beats_naive, "unmeasurable": unmeasurable,
            "n_measured": len(measured),
            "fm_not_worse": better(rows, "fm_before", "fm_after", 1.001),
            "value_not_worse": better(rows, "value_before", "value_after", 1.001),
            "top10_not_worse": all(row["top_after"] >= row["top_before"] for row in rows),
        }
        no_harm = verdict["fm_not_worse"] and verdict["value_not_worse"]
        verdict["passes"] = (
            (coverage_up and added_sane and beats_naive and no_harm and verdict["top10_not_worse"])
            if kind == "coverage" else (improved and no_harm))

        # The robust verdict: majority of measuring windows, mean gain above the floor, and no single
        # window losing more than MAX_WINDOW_LOSS. Only for accuracy rules and only once there are
        # enough windows for "majority" to mean anything. None = not applicable, never a silent False.
        gains = [1 - row["changed_after"] / row["changed_before"]
                 for row in measured
                 if row["changed_before"] and row["changed_after"] is not None]
        if kind == "coverage" or len(gains) < MIN_WINDOWS_FOR_ROBUST:
            verdict["robust"] = None
        else:
            wins = sum(1 for gain in gains if gain >= MIN_RELATIVE_GAIN)
            verdict["robust_detail"] = {
                "wins": wins, "of": len(gains),
                "mean_gain": _round(sum(gains) / len(gains), 4),
                # the worst window's own gain, so it reads on the same scale and sign as mean_gain:
                # negative means that window went AGAINST the rule
                "worst_window": _round(min(gains), 4),
            }
            verdict["robust"] = bool(
                wins * 2 > len(gains)
                and sum(gains) / len(gains) >= MIN_RELATIVE_GAIN
                and min(gains) >= -MAX_WINDOW_LOSS
                and no_harm)
        out["verdicts"][rule] = verdict
    return out


def role_reports(out: dict, window: str, rule: str) -> list[dict]:
    return list(out["windows"][window][rule]["by_role"].values())


# ---------------------------------------------------------------- trust checks


@dataclass
class Check:
    name: str
    expected: float | str
    got: float | str
    ok: bool
    note: str = ""


def _close(got: float | None, expected: float, tolerance: float) -> bool:
    return got is not None and abs(got - expected) <= tolerance


def verify_baseline(conn: sqlite3.Connection) -> list[Check]:
    """Reproduce the published numbers. Until these pass, the harness cannot judge anything."""
    checks: list[Check] = []

    # 1-2. anchors recomputed from the DB, per season, against the published tables. Roles that
    # borrow an anchor (ANCHOR_FALLBACK) are informational: the engine never uses their own value,
    # and 'b' is published from a 5-player sample.
    for game, reference, tolerance in (("classic", model.REFERENCE_ANCHORS_CLASSIC, 0.02),
                                       ("mantra", model.REFERENCE_ANCHORS_MANTRA, 0.03)):
        cells = mismatched = 0
        notes: list[str] = []
        for season, expected_roles in reference.items():
            got_roles = features.anchors(conn, "euro", (season,), game)
            for role, expected in expected_roles.items():
                got = got_roles.get(role)
                if role in model.ANCHOR_FALLBACK:
                    notes.append(f"{season} {role} not counted ({got and round(got, 2)} "
                                 f"vs {expected}, borrows {model.ANCHOR_FALLBACK[role]})")
                    continue
                cells += 1
                if got is None or abs(got - expected) > tolerance:
                    mismatched += 1
                    notes.append(f"{season} {role}: {got} vs {expected}")
        checks.append(Check(f"anchors_{game}_euro", f"{cells}/{cells} cells",
                            f"{cells - mismatched}/{cells} cells", mismatched == 0,
                            " · ".join(notes)))

    # Prepared once: every remaining check reads the same windows - and only the two the published
    # numbers refer to. A new window has no published counterpart to be verified against.
    prepared = {key: features.prepare(conn, features.WINDOWS[key], "euro", "mantra")
                for key in features.PUBLISHED_WINDOWS}

    # 3. the two independent Mantra beta estimates
    for key, data in prepared.items():
        pairs = []
        for obs in data.observations:
            anchor = model.fractional_anchor(obs.roles_mantra, model.ENGINE_ANCHORS_MANTRA)
            if (anchor is None or obs.fm_prev is None or obs.fm_act is None
                    or (obs.pv_prev or 0) < 15 or (obs.pv_act or 0) < 15):
                continue
            pairs.append(((obs.fm_prev - anchor,), obs.fm_act - anchor))
        fitted = fit_linear(pairs, intercept=False)
        expected = model.REFERENCE_GATE["beta_mantra"][key]
        got = round(fitted[0], 3) if fitted else None
        checks.append(Check(f"beta_mantra_{key}", expected, got if got is not None else "n/a",
                            _close(got, expected, 0.02), f"{len(pairs)} pairs"))

    # 4. the appearances regression refitted per window, coefficient by coefficient
    fitted_share = {key: fit_share(data) for key, data in prepared.items()}
    for key, (coefficients, n_samples) in fitted_share.items():
        published = model.REFERENCE_PV_COEFFS[key]
        got = tuple(round(value, 3) for value in coefficients[1:]) if coefficients else ()
        ok = bool(coefficients) and all(
            _close(value, expected, 0.02) for value, expected in zip(got, published, strict=True))
        checks.append(Check(f"pv_coeffs_{key}", str(published), str(got), ok,
                            f"intercept {coefficients[0]:+.3f} on n={n_samples}"
                            if coefficients else "not fitted"))

    # 5-7. module-level gates, reproduced from the same code path the report uses
    for key, data in prepared.items():
        report = evaluate_window(data, ("R0",))
        keeper = report["by_role"].get("P", {}).get("fm", {})
        for metric, expected in (("mae", model.REFERENCE_GATE["gk_mae_m2e"][key]),
                                 ("mae_naive", model.REFERENCE_GATE["gk_mae_naive"][key])):
            got = keeper.get(metric)
            checks.append(Check(f"gk_fm_{metric}_{key}", expected, got if got is not None else "n/a",
                                _close(got, expected, 0.01), f"n={keeper.get('n')}"))
        overall_pv = report["overall"]["pv"]
        gain = ((overall_pv["mae"] - overall_pv["mae_naive"]) / overall_pv["mae_naive"]
                if overall_pv["mae_naive"] else None)
        expected_gain = model.REFERENCE_GATE["pv_gain_vs_naive"][key]
        checks.append(Check(f"pv_gain_vs_naive_{key}", expected_gain, _round(gain, 4),
                            gain is not None and gain < 0,
                            f"model {overall_pv['mae']} vs naive {overall_pv['mae_naive']} "
                            f"on n={overall_pv['n']}"))
        # The module was adopted for the BIAS, not the MAE: the naive forecast hands the average
        # starter about 5 phantom matchdays. That is the number that has to come back.
        starters = report["appearance_segments"]["starters"]
        for source, published in (("naive", model.REFERENCE_GATE["pv_bias_naive_starters"][key]),
                                  ("model", model.REFERENCE_GATE["pv_bias_model_starters"][key])):
            got = starters[f"bias_{source}"]
            checks.append(Check(f"pv_bias_{source}_starters_{key}", published, got,
                                _close(got, published, 0.6), f"n={starters['n']}"))

        # 7. the appearances gate as it was actually run: coefficients from the OTHER window.
        other = next(name for name in prepared if name != key)
        coefficients, n_samples = fitted_share[other]
        if coefficients:
            cross = evaluate_window(data, ("R0",), coefficients)["overall"]["pv"]
            cross_gain = ((cross["mae"] - cross["mae_naive"]) / cross["mae_naive"]
                          if cross["mae_naive"] else None)
            checks.append(Check(
                f"pv_gain_crossfit_{key}", expected_gain, _round(cross_gain, 4),
                cross_gain is not None and cross_gain < 0,
                f"coeffs fitted on {other} (n={n_samples}): "
                + " ".join(f"{value:+.3f}" for value in coefficients)))
    return checks


# ---------------------------------------------------------------- printing


def _print_checks(checks: list[Check]) -> None:
    print("\n=== baseline trust checks (published value vs recomputed) ===")
    for check in checks:
        mark = "OK  " if check.ok else "DIFF"
        print(f"  [{mark}] {check.name:<26} expected {check.expected!s:>8}  got {check.got!s:>8}"
              + (f"   {check.note}" if check.note else ""))
    failed = [check.name for check in checks if not check.ok]
    print(f"  -> {len(checks) - len(failed)}/{len(checks)} reproduced"
          + (f" · review: {', '.join(failed)}" if failed else ""))


def _print_window(report: dict) -> None:
    print(f"\n=== {report['window']} · platform={report['platform']} · game={report['game']} "
          f"· matchdays {report['matchdays']['input']}->{report['matchdays']['target']} ===")
    overall = report["overall"]
    print(f"  coverage VALUE {overall['n_predicted']}/{overall['n_observations']} "
          f"({(overall['coverage'] or 0) * 100:.0f}%) · appearances {overall['n_predicted_pv']} "
          f"({(overall['coverage_pv'] or 0) * 100:.0f}%) · "
          f"FM MAE {overall['fm']['mae']} vs naive {overall['fm']['mae_naive']} · "
          f"Pv MAE {overall['pv']['mae']} vs naive {overall['pv']['mae_naive']} · "
          f"VALUE MAE {overall['value']['mae']} (FM {overall['value']['contrib_fm']} / "
          f"Pv {overall['value']['contrib_pv']})")
    header = (f"  {'role':<5}{'top10':>7}{'uncov':>7}{'regime':>7}{'FM MAE':>9}{'naive':>7}"
              f"{'Pv MAE':>8}{'naive':>7}{'VAL MAE':>9}{'cFM':>7}{'cPv':>7}{'rho':>7}")
    print(header)
    for role, metrics in report["by_role"].items():
        top = metrics["top_n"]
        hits = "{}/{}".format(top["hits"], top["of"])
        fm, pv, value = metrics["fm"], metrics["pv"], metrics["value"]
        print(f"  {role:<5}{hits:>7}{top['uncovered']:>7}{top['regime_change']:>7}"
              f"{fm['mae']!s:>9}{fm['mae_naive']!s:>7}{pv['mae']!s:>8}{pv['mae_naive']!s:>7}"
              f"{value['mae']!s:>9}{value['contrib_fm']!s:>7}{value['contrib_pv']!s:>7}"
              f"{value['spearman']!s:>7}")
    segments = report["appearance_segments"]
    print("  appearance bias  " + " · ".join(
        f"{name} model {values['bias_model']} naive {values['bias_naive']} (n={values['n']})"
        for name, values in segments.items()))


def _print_features(report: dict) -> None:
    print("  input inventory: " + " · ".join(
        f"{name} {counts['present']}/{counts['total']}"
        for name, counts in report["features"].items()))


def _print_gate(result: dict) -> None:
    """The gate table: per rule, per role, before -> after on both windows."""
    print(f"\n=== GATE · platform={result['platform']} · game={result['game']} ===")
    for key, params in result["params"].items():
        shown = {name: (tuple(round(v, 3) for v in value) if isinstance(value, tuple)
                        else round(value, 3) if isinstance(value, float) else value)
                 for name, value in params.items() if name not in ("notes", "source")}
        print(f"  parameters fitted on {key}: {shown}")
        print(f"    samples: {params['notes']}")

    windows = list(result["windows"])
    labels = {"ALL": "every candidate together (information only)",
              "ADOPTED": f"the set that passed the gate on this platform: "
                         f"{', '.join(result['adopted']) or 'none'}"}
    for rule, verdict in result["verdicts"].items():
        summary = RULES_BY_KEY[rule].summary if rule in RULES_BY_KEY else labels.get(rule, rule)
        target = verdict["metric"]
        print(f"\n  {rule} · {summary}  [target {target.upper()} MAE]")
        # Per role, on the players BOTH configurations price, plus what the rule added on its own.
        header = f"    {'role':<5}"
        for window in windows:
            header += f"{window + ' ' + target + ' MAE (common)':>34}"
        for window in windows:
            header += f"{window + ' top10':>12}"
        print(header)
        per_window = {row["window"]: row for row in verdict["rows"]}
        for role in model.CLASSIC_ROLES:
            cells = f"    {role:<5}"
            for window in windows:
                entry = per_window[window]["by_role"].get(role, {})
                if not entry or entry["before"] is None:
                    cells += f"{'-':>34}"
                    continue
                b, a, n = entry["before"], entry["after"], entry["n"]
                added = (f" +{entry['added_n']}@{entry['added_mae']}"
                         if entry["added_n"] else "")
                cells += f"{f'{b}->{a} {_delta(b, a)} n={n}{added}':>34}"
            for window in windows:
                before = result["windows"][window]["R0"]["by_role"].get(role, {})
                after = result["windows"][window][rule]["by_role"].get(role, {})
                if not before:
                    cells += f"{'-':>12}"
                    continue
                cells += (f"{before['top_n']['hits']}/{before['top_n']['of']}"
                          f"->{after['top_n']['hits']}").rjust(12)
            print(cells)
        for row in verdict["rows"]:
            if row["changed_n"]:
                print(f"    {row['window']} on the {row['changed_n']} players it MOVES: "
                      f"{target} MAE {row['changed_before']} -> {row['changed_after']} "
                      f"({_delta(row['changed_before'], row['changed_after'])})")
            print(f"    {row['window']} on the {row['n_common']} players both configurations price: "
                  f"{target} MAE {row['target_before']} -> {row['target_after']} "
                  f"({_delta(row['target_before'], row['target_after'])}) · "
                  f"FM {row['fm_before']} -> {row['fm_after']} · "
                  f"VALUE {row['value_before']} -> {row['value_after']} "
                  f"({_delta(row['value_before'], row['value_after'])}) · "
                  f"top10 {row['top_before']} -> {row['top_after']} · "
                  f"coverage {row['coverage_before']} -> {row['coverage_after']}")
            if row["added_n"]:
                print(f"        + {row['added_n']} players the baseline could not price at all: "
                      f"{target} MAE {row['added_mae']} against {row['added_mae_naive']} "
                      f"from the role anchor and the mean share")
        mark = "PASSES" if verdict["passes"] else "DOES NOT PASS"
        detail = verdict.get("robust_detail")
        if detail is not None:
            agreement = ("agrees" if verdict["robust"] == verdict["passes"]
                         else "DISAGREES with the strict verdict")
            print(f"    robust verdict ({agreement}): "
                  f"{'holds' if verdict['robust'] else 'does not hold'} · "
                  f"wins {detail['wins']}/{detail['of']} windows · mean gain "
                  f"{detail['mean_gain'] * 100:+.1f}% · worst window "
                  f"{detail['worst_window'] * 100:+.1f}% (negative = against the rule)")
        if verdict["kind"] == "coverage":
            # said differently for R0c: it does not beat the trivial answer, it IS the trivial answer
            beats = ("is the trivial answer, by construction" if rule == "R0c"
                     else f"beats the trivial answer: {verdict['beats_naive']}")
            criterion = (f"coverage up on both windows: {verdict['coverage_up']} · "
                         f"what it adds is not noise: {verdict['added_sane']} · {beats}")
        else:
            criterion = (f"target improved on all {verdict['n_measured']} windows that measure it: "
                         f"{verdict['improved_both']}")
        if verdict["unmeasurable"]:
            criterion += (" · NOT MEASURABLE on " + ", ".join(verdict["unmeasurable"])
                          + " (inputs absent that far back)")
        print(f"    -> {mark} [{verdict['kind']}] · {criterion} · "
              f"FM not worse: {verdict['fm_not_worse']} · VALUE not worse: "
              f"{verdict['value_not_worse']} · top10 not worse: {verdict['top10_not_worse']}")


def _print_cases(data: features.WindowData, predictions: list[Prediction]) -> None:
    by_name = {prediction.obs.name: prediction for prediction in predictions}
    observations = {obs.name: obs for obs in data.observations}
    print(f"  regression cases ({data.window.key} {data.platform}/{data.game}):")
    for name in model.REGRESSION_CASES:
        obs = observations.get(name)
        if obs is None:
            continue
        actual = (f"FM {obs.fm_act} Pv {obs.pv_act} VALUE "
                  f"{obs.value_act:.0f}" if obs.value_act is not None else "no actual")
        prediction = by_name.get(name)
        if prediction is None:
            print(f"    {name:<16} NO PREDICTION (fm_prev={obs.fm_prev} pv_prev={obs.pv_prev}) "
                  f"| actual {actual}")
            continue
        # A player can have appearances and no fantamedia (below the core's domain): print what
        # exists instead of pretending the valuation is complete.
        fm = "  -  " if prediction.fm_pred is None else f"{prediction.fm_pred:.2f}"
        pv = "  - " if prediction.pv_pred is None else f"{prediction.pv_pred:.1f}"
        value = "  - " if prediction.value_pred is None else f"{prediction.value_pred:.0f}"
        delta = ("" if prediction.fm_pred is None or obs.fm_act is None
                 else f" | dFM {obs.fm_act - prediction.fm_pred:+.2f}")
        print(f"    {name:<16} FM {fm} Pv {pv} VALUE {value} | actual {actual}{delta}")


def role_membership(data: features.WindowData) -> tuple[tuple[str, ...], object]:
    """The roles the auction is run by, and how to tell whether a player holds one.

    Classic has one role per player; Mantra has several, and a 'dc;b' defender competes for a slot in
    BOTH lists - which is how a Mantra auction is actually run, one role slot at a time.
    """
    if data.game == "mantra":
        return model.MANTRA_ROLES, (lambda obs, role: role in obs.roles_mantra)
    return model.CLASSIC_ROLES, (lambda obs, role: obs.role_classic == role)


def auction_view(data: features.WindowData, predictions: list[Prediction],
                 top_n: int = TOP_N) -> dict:
    """Per role: the predicted top N and the real top N, each annotated with the other's rank.

    Two lists rather than one score. A precision of 6/10 hides whether the four misses were injuries,
    players the engine could not price at all, or ranking noise between comparable names - and only the
    named comparison shows which.
    """
    out: dict[str, dict] = {}
    roles, holds = role_membership(data)
    for role in roles:
        observations = [obs for obs in data.observations if holds(obs, role)]
        valued = [p for p in predictions
                  if holds(p.obs, role) and p.value_pred is not None]
        if not observations:
            continue
        ranked = sorted(valued, key=lambda p: -(p.value_pred or 0.0))
        predicted_rank = {p.obs.fc_id: index for index, p in enumerate(ranked, 1)}
        by_id = {p.obs.fc_id: p for p in valued}
        actual = sorted((obs for obs in observations if obs.value_act is not None),
                        key=lambda obs: -(obs.value_act or 0.0))
        actual_rank = {obs.fc_id: index for index, obs in enumerate(actual, 1)}

        # What buying the engine's ten would have RETURNED, against what the perfect ten returned.
        # Precision counts names and treats every miss alike; this counts points, so missing the tenth
        # defender costs what the tenth defender was worth. It is the closest thing the harness has to
        # the question the auction actually asks.
        def market(obs, _game=data.game):
            """The market's own end-of-season answer, in the game's own currency."""
            return obs.fvm_mantra if _game == "mantra" else obs.fvm

        captured = sum(p.obs.value_act or 0.0 for p in ranked[:top_n])
        perfect = sum(obs.value_act or 0.0 for obs in actual[:top_n])
        out[role] = {
            "n_actual": len(actual),
            "hits": len({p.obs.fc_id for p in ranked[:top_n]}
                        & {obs.fc_id for obs in actual[:top_n]}),
            "captured_value": _round(captured, 1),
            "perfect_value": _round(perfect, 1),
            "captured_share": _round(captured / perfect, 3) if perfect else None,
            # a miss is one of three different problems, and they need different fixes
            "misses": {
                "near": sum(1 for obs in actual[:top_n]
                            if top_n < (predicted_rank.get(obs.fc_id) or 10**6) <= REGIME_RANK),
                "regime": sum(1 for obs in actual[:top_n]
                              if obs.fc_id in predicted_rank
                              and predicted_rank[obs.fc_id] > REGIME_RANK),
                "unpriced": sum(1 for obs in actual[:top_n] if obs.fc_id not in predicted_rank),
            },
            "predicted": [{
                "rank": index, "name": p.obs.name, "club": p.obs.club_target,
                "price_initial": p.obs.price_initial,
                "fm_pred": _round(p.fm_pred, 2), "pv_pred": _round(p.pv_pred, 1),
                "value_pred": _round(p.value_pred, 1),
                "fm_act": p.obs.fm_act, "pv_act": p.obs.pv_act,
                "value_act": _round(p.obs.value_act, 1), "fvm": market(p.obs),
                "actual_rank": actual_rank.get(p.obs.fc_id),
            } for index, p in enumerate(ranked[:top_n], 1)],
            "actual": [{
                "rank": index, "name": obs.name, "club": obs.club_target,
                "price_initial": obs.price_initial,
                "fm_act": obs.fm_act, "pv_act": obs.pv_act,
                "value_act": _round(obs.value_act, 1), "fvm": market(obs),
                "fm_pred": _round(by_id[obs.fc_id].fm_pred, 2) if obs.fc_id in by_id else None,
                "pv_pred": _round(by_id[obs.fc_id].pv_pred, 1) if obs.fc_id in by_id else None,
                "value_pred": _round(by_id[obs.fc_id].value_pred, 1) if obs.fc_id in by_id else None,
                "predicted_rank": predicted_rank.get(obs.fc_id),
            } for index, obs in enumerate(actual[:top_n], 1)],
        }
    return out


def _print_auction(data: features.WindowData, view: dict, rules: tuple[str, ...]) -> None:
    print(f"\n=== {data.window.label} · {data.platform}/{data.game} · "
          f"{', '.join(rules[1:]) or 'baseline only'} ===")
    for role, block in view.items():
        misses = block["misses"]
        print(f"\n  {role} - predicted top {TOP_N} (auction day) vs real top {TOP_N} "
              f"(end of season) · hits {block['hits']}/{TOP_N} · "
              f"VALUE captured {block['captured_value']:.0f} of {block['perfect_value']:.0f} "
              f"({(block['captured_share'] or 0) * 100:.0f}%) · misses: {misses['near']} near, "
              f"{misses['regime']} regime, {misses['unpriced']} never priced")
        print(f"    {'#':>2}  {'PREDICTED':<20} {'Qt.I':>4} {'FMp':>5} {'Pvp':>5} {'VALp':>6} "
              f"{'real':>6} {'FVM':>5} {'#real':>6}   {'#':>2}  {'REAL':<20} {'FM':>5} {'Pv':>4} "
              f"{'VAL':>6} {'FVM':>5} {'#pred':>6}")
        for left, right in zip(block["predicted"], block["actual"], strict=False):
            got = "  -  " if left["value_act"] is None else f"{left['value_act']:6.0f}"
            actual_rank = "   -" if left["actual_rank"] is None else f"{left['actual_rank']:4d}"
            pred_rank = ("  n/p" if right["predicted_rank"] is None
                         else f"{right['predicted_rank']:4d}")
            print(f"    {left['rank']:2d}  {left['name'][:20]:<20} "
                  f"{(left['price_initial'] or 0):4.0f} {left['fm_pred'] or 0:5.2f} "
                  f"{left['pv_pred'] or 0:5.1f} {left['value_pred'] or 0:6.0f} {got} "
                  f"{left['fvm'] or 0:5.0f} {actual_rank:>6}"
                  f"   {right['rank']:2d}  {right['name'][:20]:<20} {right['fm_act'] or 0:5.2f} "
                  f"{right['pv_act'] or 0:4d} {right['value_act'] or 0:6.0f} "
                  f"{right['fvm'] or 0:5.0f} {pred_rank:>6}")


# ---------------------------------------------------------------- entry point


def run(ctx: Context, *, windows: list[str] | None = None, platforms: list[str] | None = None,
        games: list[str] | None = None, rules: str | None = None, cases: bool = False,
        verify: bool = False, gate: bool = False, auction: bool = False,
        report: bool = True) -> dict:
    """Run the harness. Read-only on the DB: the only output is a report under data/reports/."""
    conn = ctx.require_conn()
    selected_rules = parse_rules(rules)
    window_keys = windows or list(features.WINDOWS)
    platform_keys = platforms or ["euro", "default"]
    game_keys = games or ["classic", "mantra"]

    # --gate and --auction choose their own rule sets (every candidate, and the adopted set), so
    # echoing --rules there would describe a configuration that is not the one being run.
    chosen = ("every candidate rule" if gate else "the adopted set per platform" if auction
              else ", ".join(selected_rules))
    print(f"[backtest] rules {chosen} · windows {', '.join(window_keys)} · "
          f"platforms {', '.join(platform_keys)} · games {', '.join(game_keys)}")
    output: dict = {"generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
                    "rules": list(selected_rules), "windows": []}

    if verify:
        checks = verify_baseline(conn)
        _print_checks(checks)
        output["trust_checks"] = [vars(check) for check in checks]

    for platform in platform_keys:
        for game in game_keys:
            # Mantra roles only exist on the euro listone; `default` is the classic Serie A game.
            if platform == "default" and game == "mantra":
                continue
            if auction:
                # The auction simulation: the ADOPTED set, parameters fitted on the OTHER window, so
                # nothing in the prediction comes from the season being predicted.
                active = ("R0", *ADOPTED.get(platform, ()))
                usable = tuple(key for key in features.WINDOWS
                               if _window_is_usable(features.prepare(
                                   conn, features.WINDOWS[key], platform, game), platform))
                # every usable window's fit, because the pooled rules average over all but the scored
                # one - the same parameters the gate uses, or the deliverable would disagree with the
                # verdicts that produced it
                every = {key: fit_params(features.prepare(
                    conn, features.WINDOWS[key], platform, game), ("R0", *CANDIDATES))
                    for key in usable}
                for key in window_keys:
                    if key not in usable:
                        continue
                    data = features.prepare(conn, features.WINDOWS[key], platform, game)
                    other = features.cross_fit_source(key, usable)
                    params = pool_params(every, key, every[other])
                    view = auction_view(data, predict_window(data, active, None, params))
                    _print_auction(data, view, active)
                    output.setdefault("auction", []).append({
                        "window": key, "platform": platform, "game": game,
                        "rules": list(active), "params_from": params.source, "by_role": view})
                continue
            if gate:
                # The gate needs at least two windows - one to fit on, one to score. It uses whatever
                # --window selected (all of them by default): `--window T1 --window T2` reproduces the
                # published two-window numbers exactly.
                result = compare(conn, CANDIDATES, platform, game, tuple(window_keys))
                _print_gate(result)
                output.setdefault("gate", []).append(result)
                if cases:
                    # the cases are shown under the ADOPTED set: what the engine would now say
                    active = ("R0", *ADOPTED.get(platform, ()))
                    for key in features.WINDOWS:
                        data = features.prepare(conn, features.WINDOWS[key], platform, game)
                        other = features.cross_fit_source(key)
                        params = fit_params(features.prepare(
                            conn, features.WINDOWS[other], platform, game), ("R0", *CANDIDATES))
                        print(f"  with {', '.join(active[1:]) or 'the baseline only'}:")
                        _print_cases(data, predict_window(data, active, None, params))
                continue
            for key in window_keys:
                window = features.WINDOWS[key]
                data = features.prepare(conn, window, platform, game)
                if not data.observations:
                    print(f"[backtest] {window.label} {platform}/{game}: no observations, skipped")
                    continue
                window_report = evaluate_window(data, selected_rules)
                _print_window(window_report)
                _print_features(window_report)
                if cases:
                    _print_cases(data, predict_window(data, selected_rules))
                output["windows"].append(window_report)

    if report:
        path = ctx.config.data_dir / "reports" / "engine_backtest.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(output, indent=2), encoding="utf-8")
        print(f"\n[backtest] report -> {path}")
    return output
