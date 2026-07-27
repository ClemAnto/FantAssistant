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
from dataclasses import dataclass, field
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
    Rule("R1", "cover the newcomers: foreign FM-equivalent + minutes-based appearances", True,
         kind="coverage"),
    Rule("R1b", "adaptation discount for players who changed league (control: changed club)", True),
    Rule("R2", "beta corroborated by per-90 propensity (xG/xA per 90)", True),
    Rule("R3", "minutes inside expected appearances", True, metric="pv"),
    Rule("R4", "age curve on the fantamedia past 30", True),
    Rule("R4b", "age curve on expected appearances past 30", True, metric="pv"),
    Rule("R7", "goalkeeper appearances: dedicated persistence instead of the shared share model",
         True, metric="pv"),
    Rule("R8", "defenders' bonus potential (real role + set pieces)"),
    Rule("R9", "anchor recency weight (goal-environment drift)"),
)

# Rules that get fitted and compared one at a time by `compare`.
CANDIDATES: tuple[str, ...] = ("R1", "R1b", "R2", "R3", "R4", "R4b", "R7")

# What survived the gate, PER PLATFORM. Keeping it per platform is not a hedge: `platform` is a
# first-class dimension of the data model (different calendars, different perimeters), and the gate
# says these rules behave differently across it - R3 only helps where the target calendar IS the real
# calendar (Serie A), R1/R4 only where the perimeter is the 5-league top clubs (EuroLeghe).
ADOPTED: dict[str, tuple[str, ...]] = {
    "euro": ("R1", "R4", "R7"),
    "default": ("R3", "R7"),
}
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


def derive(data: features.WindowData) -> Derived:
    """Minutes share and the per-90 propensity z-score, both from the INPUT season only."""
    minutes_share: dict[int, float] = {}
    raw: dict[int, float] = {}
    groups: dict[tuple[str | None, str | None], list[float]] = {}
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
        value = 0.5 * (realised + expected)
        raw[obs.fc_id] = value
        groups.setdefault((obs.role_classic, obs.league), []).append(value)

    # standardise inside (role, league): a striker's volume is not a defender's, and league scoring
    # environments differ
    stats: dict[tuple[str | None, str | None], tuple[float, float]] = {}
    for key, values in groups.items():
        if len(values) < 5:
            continue
        mean = sum(values) / len(values)
        variance = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
        if variance > 1e-9:
            stats[key] = (mean, variance ** 0.5)
    propensity_z: dict[int, float] = {}
    for obs in data.observations:
        value = raw.get(obs.fc_id)
        entry = stats.get((obs.role_classic, obs.league))
        if value is not None and entry is not None:
            # clipped: one outlier per-90 rate must not swing a whole prediction
            propensity_z[obs.fc_id] = model.clip((value - entry[0]) / entry[1], -3.0, 3.0)
    return Derived(minutes_share=minutes_share, propensity_z=propensity_z)


# ---------------------------------------------------------------- cross-fitted parameters


@dataclass
class Params:
    """Parameters fitted on ONE window and applied to the OTHER - the project's gate protocol.

    Every field is None until the data identifies it; a rule with no parameter simply does not fire,
    which is how the harness stays honest about sample size instead of inventing coefficients.
    """

    source: str = "none"
    share: tuple[float, ...] | None = None        # R3: share incl. minutes
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


def fit_params(data: features.WindowData, rules: tuple[str, ...]) -> Params:
    """Estimate every requested rule's parameters on `data`. Caller applies them to another window."""
    derived = derive(data)
    params = Params(source=data.window.key)
    matchdays = data.matchdays_target or 1

    if "R3" in rules:
        samples = [((obs.share_prev(data.matchdays_prev), derived.minutes_share[obs.fc_id],
                     _mv_term(obs), 1.0 if obs.club_change else 0.0), obs.pv_act / matchdays)
                   for obs in data.observations
                   if obs.pv_prev is not None and obs.pv_act is not None
                   and obs.fc_id in derived.minutes_share and obs.role_classic != "P"]
        params.share = fit_linear(samples)
        params.notes["R3_n"] = len(samples)

    if "R7" in rules:
        samples = [((obs.share_prev(data.matchdays_prev), 1.0 if obs.club_change else 0.0),
                    obs.pv_act / matchdays)
                   for obs in data.observations
                   if _is_goalkeeper(obs) and obs.pv_prev is not None and obs.pv_act is not None]
        params.share_gk = fit_linear(samples)
        params.notes["R7_n"] = len(samples)

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

    if "R2" in rules or "R4" in rules or "R4b" in rules:
        propensity, ageing, ageing_share = [], [], []
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
            share_pred = _predict_pv(obs, data)
            age = obs.age(data.window)
            if share_pred is not None and obs.pv_act is not None and age is not None:
                ageing_share.append(((float(max(0, age - model.AGE_KNEE)),),
                                     (obs.pv_act - share_pred) / matchdays))
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
    elif ("R3" in rules and params.share and obs.pv_prev is not None
            and minutes_share is not None and not _is_goalkeeper(obs)):
        share = model.linear_share(params.share, (obs.share_prev(data.matchdays_prev),
                                                  minutes_share, _mv_term(obs),
                                                  1.0 if obs.club_change else 0.0))
    elif ("R1" in rules and params.share_new and obs.pv_prev is None
            and minutes_share is not None):
        share = model.linear_share(params.share_new, (minutes_share,))

    if share is None:
        pv_pred = _predict_pv(obs, data)
        if pv_pred is None or not data.matchdays_target:
            return pv_pred
        share = pv_pred / data.matchdays_target

    if "R4b" in rules and params.age_share is not None:
        share = model.clip(share + model.age_adjustment(obs.age(data.window), params.age_share),
                           0.0, 1.0)
    return model.expected_appearances(share, data.matchdays_target)


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
                    params: Params | None = None) -> dict:
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


def _errors(predictions: list[Prediction], metric: str,
            keep: set[int] | None = None) -> dict[int, float]:
    """{fc_id: absolute error} for the players this configuration actually priced."""
    out: dict[int, float] = {}
    for prediction in predictions:
        obs = prediction.obs
        if keep is not None and obs.fc_id not in keep:
            continue
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


def compare(conn: sqlite3.Connection, candidates: tuple[str, ...], platform: str,
            game: str) -> dict:
    """Run B0 and B0+rule on both windows, with every parameter fitted on the OTHER window.

    This is the gate: a rule is only interesting if it improves the metric it targets on BOTH
    windows, on the common sample, without making FM or VALUE worse (the golden rule's guardrail)
    and without losing the top-10 precision the auction actually consumes.
    """
    prepared = {key: features.prepare(conn, window, platform, game)
                for key, window in features.WINDOWS.items()}
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
        other = next(name for name in prepared if name != key)
        configurations = {"R0": evaluate_window(data, ("R0",))}
        predicted = {"R0": predict_window(data, ("R0",))}
        for rule in (*candidates, "ALL", "ADOPTED"):
            active = {"ALL": everything, "ADOPTED": adopted}.get(rule, ("R0", rule))
            configurations[rule] = evaluate_window(data, active, None, fitted[other])
            predicted[rule] = predict_window(data, active, None, fitted[other])
        out["windows"][key] = configurations
        predictions[key] = predicted
    out["adopted"] = list(adopted[1:])

    for rule in (*candidates, "ALL", "ADOPTED"):
        # A mixed set moves both halves, so it is judged on the product - the auction metric.
        target = RULES_BY_KEY[rule].metric if rule in RULES_BY_KEY else "value"
        rows = []
        for key in prepared:
            baseline = out["windows"][key]["R0"]["overall"]
            candidate = out["windows"][key][rule]["overall"]
            before, after, shared, added_mae, added_n = _common_mae(
                predictions[key]["R0"], predictions[key][rule], target)
            _fmb, fma, _n, _a, _an = _common_mae(
                predictions[key]["R0"], predictions[key][rule], "fm")
            _vb, vla, _n2, _a2, _an2 = _common_mae(
                predictions[key]["R0"], predictions[key][rule], "value")
            fm_before, value_before = _fmb, _vb
            rows.append({
                "window": key, "n_common": shared,
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

        improved = all(row["target_after"] is not None and row["target_before"] is not None
                       and row["target_after"] < row["target_before"] for row in rows)
        kind = RULES_BY_KEY[rule].kind if rule in RULES_BY_KEY else "accuracy"
        coverage_up = all((row["coverage_after"] or 0) > (row["coverage_before"] or 0)
                          for row in rows)
        # what a coverage rule adds must be in the same league as what already existed: 30% worse
        # than the baseline's own error is the line, beyond which "a prediction" is just noise
        added_sane = all(row["added_mae"] is not None and row["target_before"] is not None
                         and row["added_mae"] <= row["target_before"] * 1.30 for row in rows)
        verdict = {
            "kind": kind, "metric": target, "rows": rows, "improved_both": improved,
            "coverage_up": coverage_up, "added_sane": added_sane,
            "fm_not_worse": better(rows, "fm_before", "fm_after", 1.001),
            "value_not_worse": better(rows, "value_before", "value_after", 1.001),
            "top10_not_worse": all(row["top_after"] >= row["top_before"] for row in rows),
        }
        no_harm = verdict["fm_not_worse"] and verdict["value_not_worse"]
        verdict["passes"] = ((coverage_up and added_sane and no_harm and verdict["top10_not_worse"])
                             if kind == "coverage" else (improved and no_harm))
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

    # Prepared once: every remaining check reads the same windows.
    prepared = {key: features.prepare(conn, window, "euro", "mantra")
                for key, window in features.WINDOWS.items()}

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
                      f"{target} MAE {row['added_mae']} (no baseline to beat)")
        mark = "PASSES" if verdict["passes"] else "DOES NOT PASS"
        if verdict["kind"] == "coverage":
            criterion = (f"coverage up on both windows: {verdict['coverage_up']} · "
                         f"what it adds is not noise: {verdict['added_sane']}")
        else:
            criterion = f"target improved on both windows: {verdict['improved_both']}"
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


# ---------------------------------------------------------------- entry point


def run(ctx: Context, *, windows: list[str] | None = None, platforms: list[str] | None = None,
        games: list[str] | None = None, rules: str | None = None, cases: bool = False,
        verify: bool = False, gate: bool = False, report: bool = True) -> dict:
    """Run the harness. Read-only on the DB: the only output is a report under data/reports/."""
    conn = ctx.require_conn()
    selected_rules = parse_rules(rules)
    window_keys = windows or list(features.WINDOWS)
    platform_keys = platforms or ["euro", "default"]
    game_keys = games or ["classic", "mantra"]

    print(f"[backtest] rules {', '.join(selected_rules)} · windows {', '.join(window_keys)} · "
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
            if gate:
                # The gate owns its own windows: it needs both, to fit on one and score on the other.
                result = compare(conn, CANDIDATES, platform, game)
                _print_gate(result)
                output.setdefault("gate", []).append(result)
                if cases:
                    # the cases are shown under the ADOPTED set: what the engine would now say
                    active = ("R0", *ADOPTED.get(platform, ()))
                    for key in features.WINDOWS:
                        data = features.prepare(conn, features.WINDOWS[key], platform, game)
                        other = next(name for name in features.WINDOWS if name != key)
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
