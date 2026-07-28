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
    # R13c is what R13b should have been. A provider RATING in Portugal is not the same quantity as one
    # in Serie A, which is why R13b lost to the trivial answer; goals and assists are the same event
    # everywhere. It only became testable once the per-match bonuses were actually fetched: the sample
    # went from 8 measured players to 78 on euro/T2 and 60 on T1.
    Rule("R13c", "recent form elsewhere: FANTAMEDIA from his measured goals and assists per 90", True,
         kind="coverage"),
    Rule("R14", "inactivity: what a spell out of 45+ days costs in APPEARANCES", True, metric="pv"),
    Rule("R14b", "inactivity: what a spell out of 45+ days costs in FANTAMEDIA", True),
    Rule("R11b", "crowded position: 2+ same-role arrivals as a threshold, not a slope", True,
         metric="pv"),
    # R15 is NOT R14 with another name. R14 measures how LONG he was out; this measures whether his
    # availability had any STRUCTURE - the same Pv can be nineteen matches in a row (a settled starter
    # who got hurt) or nineteen scattered over the season (a rotation player), and the two should not
    # forecast alike. Share-replacing, because it is the B0 regression with one more regressor rather
    # than a correction bolted on top. Sign is genuinely open, which is why it is worth a gate slot.
    Rule("R15", "availability persistence inside expected appearances", True, metric="pv"),
    # R3d exists because R15 and R3c compete for the same branch and R3c wins by order, so adding R15 to
    # an adopted set that already has R3c is nearly inert: on T2 it would fire for 7 players of 657.
    # The measured signal is real (persistence carries information R0's residual still holds, +0.077 to
    # +0.097 on all five euro windows) and the only way to collect it ALONGSIDE the euro minutes is one
    # regression with both regressors, rather than two rules taking turns.
    Rule("R3d", "expected appearances with BOTH the euro-calendar minutes and the appearance pattern",
         True, metric="pv"),
    # R16: a club's goals are a budget and its attackers share it. Adjacent to R11/R11b, which count
    # ARRIVALS in the same role - this counts the goals actually on offer, which is what the Kean /
    # Piccoli case is about: R11b would have fired on Piccoli as an arrival and said nothing about
    # Fiorentina having only 57 goals to hand out.
    Rule("R16", "attack crowding: the club's goal budget times his share of it", True),
    Rule("R16b", "attack crowding: the budget his TEAM-MATES claim (control for R16)", True),
    # Named for what it measures, not for what it was meant to measure. R16b's positive coefficient says
    # club strength, so club strength is what gets tested - and this is openly the FOURTH run at a family
    # rejected three times (R5, and twice before it), on the best measure of it available.
    Rule("R5b", "club attacking strength from its EXPECTED assists (4th run at a rejected family)",
         True),
    # R17 is the Kean/Piccoli hypothesis stated in the units R16b could not reach: the team-mates'
    # claim measured against the club's fielded-forward CAPACITY (per-club elevens, counted over ALL
    # lineup entries so unquoted fringe players cannot bias it) instead of against its goals, which is
    # a strength measure and flipped R16b's sign on 13 of 15 windows. Charged only to the players the
    # market itself (Qt.I) ranks below the coach's capacity. Identification is WITHIN-club - the
    # regressor differs between team-mates - so a between-club strength term cannot restate it, and
    # neither input is derivable from the player's own history (the closed family's failure mode).
    # Pre-registered in docs/model/attacco-affollato-r17-v1.md BEFORE any gate run.
    Rule("R17", "forward crowding: team-mates' claimed share above the club's fielded-forward "
                "capacity, charged to the market's lower-ranked claimants", True, metric="pv"),
)

# Rules that get fitted and compared one at a time by `compare`.
CANDIDATES: tuple[str, ...] = ("R0c", "R1", "R1b", "R2", "R3", "R3c", "R4", "R4b", "R5", "R6", "R7",
                               "R8", "R10", "R11", "R11b", "R12", "R12b", "R13", "R13b",
                               "R13c", "R14", "R14b", "R15", "R3d", "R16", "R16b", "R5b", "R17")

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
# ⚠️ R10 LEFT both sets on 27/07/2026, the moment it became testable on the older windows. Its inputs
# (`flags.new_coach`) had never been computed for the seasons before 2023-24 - not missing data, just
# uncomputed: `derive_new_coach` reads `coaches`, which goes back to 1886. Recomputing it took no network
# request and no new source, and the rule that had looked like the engine's strongest (-5.2%/-3.5%/-4.9%
# of appearances MAE on three windows) turns out to win 3 of 4 on euro and 4 of 7 on Serie A, with a
# worst window of -6.7%. On the auction metric it is the same story: +1 name on T1 and T2, -3 points of
# captured VALUE on Tm3 and T0. It helps on the windows it was invented on and hurts on the ones it was
# not. That is the pattern the gate exists to find, and it is the third time today it has found it.
# ⚠️⚠️ THE CLUB-STRENGTH FAMILY IS CLOSED - decided 28/07/2026 after R5b, on the fourth rejection. R5 and
# R5b stay in CANDIDATES so the gate can still re-score them; neither is a live proposal, and a fifth
# measure of "this club is strong, shift his fantamedia" is not a new hypothesis. The diagnosis, the cost
# we accept and the only thing that would legitimately reopen it are in `model.club_strength_adjustment`.
# In one line: the sign was right all four times and the input is derivable from the player's own
# fantamedia, which is the same reason R14 and R16 died - a regressor that restates the baseline cannot
# improve it. Kane's residual points at a non-constant beta instead, which is a different mechanism.
#
# ⚠️ R5b (club attacking strength from its expected assists) is NOT adopted, and the reason was written
# down BEFORE the run: xG/xA start at 2022-23, so it is measurable on T0/T1/T2 only - the same three
# windows R16b worked on and the ones the hypothesis was read off - so a pass confirms nothing and only a
# failure is informative. What came back:
#   Serie A  PASSES formally: 3/3 windows, -1.8% / -2.8% / -0.7% of FM MAE on the players it moves,
#            mean +1.8%, worst window +0.7%, and no harm to FM, VALUE or the top tens.
#   euro     DOES NOT PASS: 1/3 windows, mean -0.5%, and T1 is 2.8% WORSE.
# So the family's verdict is DEFERRED on Serie A and negative on euro, and neither is an adoption. Holding
# to the pre-registration costs a rule that looks good, which is the only moment a pre-registration is
# worth anything. An independent window arrives with 26/27.
#
# The reusable finding is the inconsistency, and it is worth more than the rule. At CLUB level, xA is much
# the best read on next season's goals per appearance on euro (pooled 0.66 against goals' 0.59 and xG's
# 0.50) and everything is weak and unstable on Serie A (goals 0.55 / 0.63 / 0.11, pooled 0.34). The rule
# then fails on euro and passes on Serie A - the exact opposite ordering. So a club-level correlation with
# club goals does NOT predict which measure helps a PLAYER's fantamedia: that proxy is not just weak, it
# is anti-informative, and picking a regressor with it would have chosen wrong both times.
# ⚠️ R13c (fantamedia from the measured goals+assists per 90 of the recent sample) is NOT adopted, and
# the reason is a sample-size wall rather than a failed hypothesis. Direction confirmed: where R13c and
# its predecessor R13b differ, the PRODUCTION version wins - Serie A T2 0.387 against R13b's 0.407, euro
# T2 0.320 against 0.324 - so "goals are the same event in any league, a provider rating is not" holds.
# Against the trivial answer it wins one window and ties the other: Serie A T1 0.248 vs the anchor's
# 0.325 (-24%), T2 0.387 vs 0.387. "Both windows" is the coverage criterion, so it stays out.
#
# The wall, measured, and it is NOT the one we just spent 1066 requests fixing:
#   window        cohort  bonuses measured  >= 450 min  Pv_act >= 15 (scoreable)
#   euro/T1           57                57          51                        19
#   euro/T2           66                65          54                        14
#   default/T1        24                24          23                        16
#   default/T2        35                35          34                        21
# The enrichment worked - coverage of the feature is now essentially total, and the minutes floor costs
# little. The collapse is at the SCORING domain: about a quarter of these players reach 15 appearances in
# the target season, because a priced newcomer with no history mostly stays fringe. Fourteen to twenty-one
# observations per window cannot carry a coefficient, whatever their quality. So the next move is more
# windows, not more scraping - and NOT a scoring domain widened to fit the rule, which would be choosing
# the test after seeing the answer.
# ⚠️ R16 / R16b (attack crowding on the club's goal budget) are BOTH REJECTED, and the pair is worth
# keeping because the second explains the first. R16 measured the club's goals times HIS OWN share and
# did nothing (3/10 windows, mean -1.2%, worst -14.9%): his share of last season's goals is already
# inside his own fantamedia, so the regressor restates what the baseline has. R16b measures what the
# TEAM-MATES claim, which is the hypothesis stated properly - and it works on exactly the three most
# recent windows (T0 -4.6%, T1 -4.2%, T2 -3.2% on the players it moves) and nowhere else, 4/10 overall.
# Two alternative explanations for the split were checked and BOTH ruled out: goals and assists are
# present in all eleven seasons of season_stats, and the target-season club is known for 100% of every
# season's listone, so neither window set is short of an input.
#
# What the FITTED COEFFICIENTS then showed is more interesting than the verdict. R16's lambda flips sign
# window to window (+0.152, -0.047, -0.076, +0.142, ... on Serie A) - noise, as its collinearity implies.
# R16b's is stable and POSITIVE: 9 of 10 Serie A windows between +0.033 and +0.165, the tenth -0.006, and
# 4 of 5 on euro. Positive is the OPPOSITE of what crowding predicts. So R16b does not measure crowding
# at all; it measures club attacking strength, and the two are entangled by construction - a club whose
# attackers produced a lot is both strong and crowded, and the strong half wins.
# So the Kean/Piccoli hole is not "still open pending a better estimator": the penalty it asks for is not
# in the data. Separating strength from crowding needs both terms in one fit, which is partly a fourth
# run at the club-strength family this gate has rejected three times, and therefore a decision to take
# deliberately rather than a refinement to slip in. Building the xG variant first would only sharpen the
# measurement of the effect we did NOT set out to measure.
# ⚠️ R15 (availability persistence) is the closest NEAR MISS in the whole candidate set and is NOT
# adopted. Serie A: it improves appearances MAE on 8 of 10 windows by 1.4-6.8% on the players it moves,
# mean +2.6%, and its two failures are +0.1% (Tm7) and +0.4% (Tm6) - the two oldest windows, i.e. noise
# in the wrong direction rather than a contrary effect. EuroLeghe: it improves ALL FIVE windows, but by
# 0.2-0.8% outside Tm4's 6.4%, so Tm3 sits under the 0.5% floor. It also costs top-10 names on Tm3/T2
# (euro) and Tm2 (Serie A). "All windows" is the pre-registered criterion and it is not met on either
# platform, so it stays out - the temptation to relax a criterion for a rule one likes is exactly what
# the criterion is for. What it DOES establish is that the feature is real: availability carries
# measurable memory (persistence 0.29-0.36 on every platform-season), and the natural next use is the
# auction OBJECTIVE (a per-player catchability instead of the population curve), which is a different
# metric and needs its own pre-registration - not a re-run of this one with softer thresholds.
# ⚠️ R3d PASSES THE ACCURACY GATE AND IS NOT ADOPTED, and it is the first rule to expose a gap in the
# criteria rather than in itself. `passes` for an accuracy rule is "target improved on every measuring
# window AND FM/VALUE MAE not worse"; the top-10 guardrail is binding only for COVERAGE rules. R3d clears
# all of that - pv MAE -1.3% to -3.2% on the players it moves, on all four measurable windows, coefficient
# stable (dispersion 0.31) - and it makes the AUCTION LISTS WORSE: over twelve Mantra roles the names in
# common go 157 -> 151 across five windows, with T2 alone losing four (36 -> 32), and captured VALUE falls
# on three windows of five. So a rule can pass the accuracy gate and degrade the deliverable the product
# actually consumes. Recorded here rather than fixed silently, because widening `passes` to bind the
# auction metric for accuracy rules would retroactively unseat rules already adopted - a decision to take
# deliberately, on its own, not as a side effect of this one.
#
# ⚠️ R15 is NOT adopted either, for a different reason: its gate row was measured STANDALONE against B0,
# and R15 shares the share-replacing branch with R3c, which wins by order. Inside the adopted set R15 fires
# for 7 players of 657 on T2 and buys nothing on the recent windows while costing a top-10 name on T0.
# A candidate's standalone gate row is not its value inside a set - the set has to be scored as a set.
# ⚠️ R17 (28/07/2026) DOES NOT PASS on either platform - with the cleanest coefficient ever rejected:
# lambda stable and negative on every measuring window (Serie A dispersion 0.24, 6/6 same sign; euro
# 0.15, 4/4), yet the players it moves get WORSE on 9 of 10 window x platform combinations (Serie A
# robust 1/6, mean -7.3%, worst -14.9%; euro 1/4, -0.9% - the one win is T1, a burned window, and the
# CLEAN windows are the most decisive against). In-sample the below-capacity claimants of an
# over-claimed club really do play less than the baseline says; the effect does not transfer across
# seasons. Fifth crowding formulation to fail on error (R11, R11b, R16, R16b, R17), each with a
# different mechanism - the pre-run diagnostic had already shown the charged players delivering 1.04x
# their prediction on T1/T2. Autopsy: docs/model/attacco-affollato-r17-v1.md §10.
ADOPTED: dict[str, tuple[str, ...]] = {
    "euro": ("R0c", "R3c"),
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
    budget_z: dict[int, float] = field(default_factory=dict)   # R16
    rivals_z: dict[int, float] = field(default_factory=dict)  # R16b
    production_z: dict[int, float] = field(default_factory=dict)  # R13c
    club_attack_z: dict[int, float] = field(default_factory=dict)  # R5b


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
    # R13c: inside the COHORT and by role - "more productive than the other newcomers we could
    # measure" crosses competitions in a way an absolute per-90 rate does not.
    production_raw: dict[int, tuple[object, float]] = {}
    for obs in data.observations:
        if obs.fm_prev is not None or not obs.recent_matches:
            continue
        rate = model.production_per_90(obs.recent_goals, obs.recent_assists, obs.recent_minutes)
        if rate is not None:
            production_raw[obs.fc_id] = (obs.role_classic, rate)
    price_z, price_revision = _price_signals(data)
    # R16: standardised inside the role, so it reads "for a forward" and not "in general"
    budget_raw: dict[int, tuple[object, float]] = {}
    rivals_raw: dict[int, tuple[object, float]] = {}
    attack_raw: dict[int, tuple[object, float]] = {}
    for obs in data.observations:
        volume = model.goal_budget(obs.club_goals_prev, obs.attack_share_target)
        if volume is not None:
            budget_raw[obs.fc_id] = (obs.role_classic, volume)
        rivals = model.attack_rivals(obs.club_goals_prev, obs.attack_share_target)
        if rivals is not None:
            rivals_raw[obs.fc_id] = (obs.role_classic, rivals)
        if obs.club_expected_assists_prev is not None:
            attack_raw[obs.fc_id] = (obs.role_classic, obs.club_expected_assists_prev)
    derived = Derived(recent_deviation=recent_deviation, minutes_share=minutes_share,
                      propensity_z=propensity_z, elo_z=_elo_z_scores(data),
                      price_z=price_z, price_revision=price_revision,
                      budget_z=_z_scores(budget_raw, 5),
                      rivals_z=_z_scores(rivals_raw, 5),
                      production_z=_z_scores(production_raw, 5),
                      club_attack_z=_z_scores(attack_raw, 5))
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
    share_persistence: tuple[float, ...] | None = None   # R15: availability persistence
    share_both: tuple[float, ...] | None = None          # R3d: euro minutes + the pattern
    penalty_lam: float | None = None              # R6: penalty duty
    elo_lam: float | None = None                  # R5: club-strength anchor shift
    budget_lam: float | None = None               # R16: club goal budget x his share
    rivals_lam: float | None = None               # R16b: the budget his team-mates claim
    production_lam: float | None = None           # R13c: measured goals+assists per 90
    club_attack_lam: float | None = None          # R5b: club expected assists
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
    crowding_lam: float | None = None              # R17: teammates' claim above the fielded capacity
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
SHARE_REPLACING: frozenset[str] = frozenset({"R3", "R3c", "R7", "R13", "R0c", "R15", "R3d"})


def _crowding_features(data: features.WindowData, baseline_rules: tuple[str, ...],
                       params: "Params", derived: "Derived") -> dict[int, float]:
    """R17's regressor per fc_id: the share his team-mates claim above the club's capacity.

    Rules-dependent by construction - the overflow is computed from the shares the CONFIGURATION's
    own share-replacing rules produce, not from B0 - so it cannot live in the rule-independent
    `derive()`. Memoised in `data.cache` keyed by BOTH the residual baseline and the params source:
    the same window is scored under many configurations and with fits from different windows, and a
    key missing either component would silently serve one configuration's overflow to another.
    `baseline_rules` must never contain R17 itself (the caller filters to SHARE_REPLACING + R0),
    which is what keeps this from recursing.
    """
    key = ("R17", baseline_rules, params.source)
    cached = data.cache.get(key)
    if cached is not None:
        return cached
    matchdays = data.matchdays_target or 1
    groups: dict[str, list[features.Observation]] = {}
    for obs in data.observations:
        if obs.role_classic == "A" and obs.club_target:
            groups.setdefault(obs.club_target, []).append(obs)
    out: dict[int, float] = {}
    for club, members in groups.items():
        caps = data.forward_caps.get(club)
        if caps is None or caps[2] < model.FORWARD_MIN_XI:
            continue                     # shape not measurable: silent, never a guess
        capacity = caps[0]               # mean forwards per eleven = the start budget per matchday
        shares: dict[int, float] = {}
        for obs in members:
            value = (_rule_pv(obs, data, baseline_rules, params, derived)
                     if baseline_rules != ("R0",) else None)
            if value is None:
                value = _predict_pv(obs, data)
            if value is not None:
                shares[obs.fc_id] = value / matchdays
        order = model.forward_claimant_order(
            [(obs.fc_id, obs.price_initial, obs.share_prev(data.matchdays_prev))
             for obs in members])
        total = sum(shares.values())
        for rank, fc_id in enumerate(order, start=1):
            if fc_id not in shares:
                continue
            overflow = max(0.0, total - shares[fc_id] - capacity)
            out[fc_id] = overflow if rank > capacity else 0.0
    data.cache[key] = out
    return out


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

    # ⚠️ EVERY coefficient fitted from the residual block below is measured against THIS baseline, and
    # changes when it changes - not by a little. R11's competition lambda is +0.008/+0.010 against B0 and
    # -0.010/-0.010 against the two-pass baseline; R10's two terms invert outright (+0.129/-0.136 becomes
    # -0.134/+0.179). A coefficient quoted without saying which baseline produced it is not a fact, and
    # the docs carried R11's B0-era sign for a day and a half together with an INTERPRETATION built on it
    # ("more arrivals, more appearances - the declared mechanism is false") that the corrected sign
    # reverses. So the baseline is recorded in `notes` on every fit: a stale quote is now detectable
    # instead of having to be remembered.
    residual_baseline = tuple(rule for rule in rules if rule in SHARE_REPLACING or rule == "R0")
    params.notes["residual_baseline"] = ",".join(residual_baseline) or "B0"

    def baseline_share(obs: features.Observation) -> float | None:
        """The share the configuration's own replacing rules produce for this player."""
        value = (_rule_pv(obs, data, residual_baseline, params, derived)
                 if residual_baseline != ("R0",) else None)
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

    if "R3d" in rules:
        samples = [((obs.share_prev(data.matchdays_prev), obs.minutes_share_euro_prev,
                     obs.persistence_prev, _mv_term(obs), 1.0 if obs.club_change else 0.0),
                    obs.pv_act / matchdays)
                   for obs in data.observations
                   if obs.pv_prev is not None and obs.pv_act is not None
                   and obs.minutes_share_euro_prev is not None and obs.persistence_prev is not None
                   and obs.role_classic != "P"]
        params.share_both = fit_linear(samples)
        params.notes["R3d_n"] = len(samples)

    if "R15" in rules:
        samples = [((obs.share_prev(data.matchdays_prev), obs.persistence_prev,
                     _mv_term(obs), 1.0 if obs.club_change else 0.0), obs.pv_act / matchdays)
                   for obs in data.observations
                   if obs.pv_prev is not None and obs.pv_act is not None
                   and obs.persistence_prev is not None and obs.role_classic != "P"]
        params.share_persistence = fit_linear(samples)
        params.notes["R15_n"] = len(samples)

    if "R7" in rules:
        samples = [((obs.share_prev(data.matchdays_prev), 1.0 if obs.club_change else 0.0),
                    obs.pv_act / matchdays)
                   for obs in data.observations
                   if _is_goalkeeper(obs) and obs.pv_prev is not None and obs.pv_act is not None]
        params.share_gk = fit_linear(samples)
        params.notes["R7_n"] = len(samples)

    if {"R13", "R13b", "R13c"} & set(rules):
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

    if "R13c" in rules:
        # the same domain R13b is fitted on - no history, a real outcome, inside the scoring window -
        # so the two are directly comparable and the gate is choosing between them, not stacking them.
        pairs = []
        for obs in data.observations:
            if obs.fm_prev is not None or not obs.recent_matches:
                continue
            anchor = _anchor_for(obs, data)
            z_production = derived.production_z.get(obs.fc_id)
            if (anchor is not None and z_production is not None and obs.fm_act is not None
                    and (obs.pv_act or 0) >= MIN_PV_ACT):
                pairs.append(((z_production,), obs.fm_act - anchor))
        fitted = fit_linear(pairs, intercept=False)
        params.production_lam = fitted[0] if fitted else None
        params.notes["R13c_n"] = len(pairs)

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

    if "R17" in rules:
        # Residual rule on the share side, so it is fitted against the two-pass baseline like
        # R10/R11 - and its regressor is built from that same baseline's shares (see
        # `_crowding_features`), which is what "one hypothesis, one fit" means here.
        crowding_x = _crowding_features(data, residual_baseline, params, derived)
        crowding_samples: list[tuple[tuple[float, ...], float]] = []
        for obs in data.observations:
            x = crowding_x.get(obs.fc_id)
            if x is None or obs.pv_act is None or not matchdays:
                continue
            base = baseline_share(obs)
            if base is None:
                continue
            crowding_samples.append(((x,), obs.pv_act / matchdays - base))
        fitted = fit_linear(crowding_samples, intercept=False)
        params.crowding_lam = fitted[0] if fitted else None
        params.notes["R17_n"] = sum(1 for f, _r in crowding_samples if f[0] > 0)
        params.notes["R17_domain"] = len(crowding_samples)

    # Every rule fitted from this loop MUST be listed: the gate always fits the whole
    # candidate set at once, so a missing name is invisible there and only shows up when
    # someone fits a subset - which then silently gets no coefficient and a rule that
    # "does nothing". R16/R16b were added here after exactly that.
    if {"R2", "R4", "R4b", "R5", "R6", "R8", "R12", "R12b",
            "R16", "R16b", "R5b"} & set(rules):
        propensity, ageing, ageing_share = [], [], []
        penalties: list[tuple[tuple[float, ...], float]] = []
        off_role: list[tuple[tuple[float, ...], float]] = []
        elo_pairs: list[tuple[tuple[float, ...], float]] = []
        price_pairs: list[tuple[tuple[float, ...], float]] = []
        revision_pairs: list[tuple[tuple[float, ...], float]] = []
        budget_pairs: list[tuple[tuple[float, ...], float]] = []
        rivals_pairs: list[tuple[tuple[float, ...], float]] = []
        attack_pairs: list[tuple[tuple[float, ...], float]] = []
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
                z_budget = derived.budget_z.get(obs.fc_id)
                if z_budget is not None:
                    budget_pairs.append(((z_budget,), residual))
                z_rivals = derived.rivals_z.get(obs.fc_id)
                if z_rivals is not None:
                    rivals_pairs.append(((z_rivals,), residual))
                z_attack = derived.club_attack_z.get(obs.fc_id)
                if z_attack is not None:
                    attack_pairs.append(((z_attack,), residual))
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
        if "R16" in rules:
            fitted = fit_linear(budget_pairs, intercept=False)
            params.budget_lam = fitted[0] if fitted else None
            params.notes["R16_n"] = len(budget_pairs)
        if "R5b" in rules:
            fitted = fit_linear(attack_pairs, intercept=False)
            params.club_attack_lam = fitted[0] if fitted else None
            params.notes["R5b_n"] = len(attack_pairs)
        if "R16b" in rules:
            fitted = fit_linear(rivals_pairs, intercept=False)
            params.rivals_lam = fitted[0] if fitted else None
            params.notes["R16b_n"] = len(rivals_pairs)
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
    # R13c - his measured production elsewhere, which is the same event in any league
    if (fm_pred is None and "R13c" in rules and anchor is not None and obs.recent_matches
            and params.production_lam is not None):
        z_production = derived.production_z.get(obs.fc_id)
        if z_production is not None:
            fm_pred = model.predict_fm_from_production(anchor, z_production, params.production_lam)

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

    # R16 - how many of his club's goals are plausibly his, rather than the whole attack's
    if "R16" in rules and params.budget_lam is not None and not _is_goalkeeper(obs):
        fm_pred += model.goal_budget_adjustment(derived.budget_z.get(obs.fc_id), params.budget_lam)

    if "R16b" in rules and params.rivals_lam is not None and not _is_goalkeeper(obs):
        fm_pred += model.goal_budget_adjustment(derived.rivals_z.get(obs.fc_id), params.rivals_lam)

    # R12 / R12b - what the market expected of him before the auction, and how it revised him
    if "R12" in rules and params.price_lam is not None:
        fm_pred += model.market_expectation_adjustment(
            derived.price_z.get(obs.fc_id), params.price_lam)
    if "R12b" in rules and params.revision_lam is not None:
        fm_pred += model.expectation_revision_adjustment(
            derived.price_revision.get(obs.fc_id), params.revision_lam)

    if "R5b" in rules and params.club_attack_lam is not None and not _is_goalkeeper(obs):
        fm_pred += model.club_attack_adjustment(derived.club_attack_z.get(obs.fc_id),
                                                params.club_attack_lam)

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
    elif ("R3d" in rules and params.share_both and obs.pv_prev is not None
            and obs.minutes_share_euro_prev is not None and obs.persistence_prev is not None
            and not _is_goalkeeper(obs)):
        share = model.linear_share(params.share_both,
                                   (obs.share_prev(data.matchdays_prev),
                                    obs.minutes_share_euro_prev, obs.persistence_prev,
                                    _mv_term(obs), 1.0 if obs.club_change else 0.0))
    elif ("R3c" in rules and params.share_euro and obs.pv_prev is not None
            and obs.minutes_share_euro_prev is not None and not _is_goalkeeper(obs)):
        share = model.linear_share(params.share_euro,
                                   (obs.share_prev(data.matchdays_prev),
                                    obs.minutes_share_euro_prev, _mv_term(obs),
                                    1.0 if obs.club_change else 0.0))
    elif ("R15" in rules and params.share_persistence and obs.pv_prev is not None
            and obs.persistence_prev is not None and not _is_goalkeeper(obs)):
        share = model.linear_share(params.share_persistence,
                                   (obs.share_prev(data.matchdays_prev), obs.persistence_prev,
                                    _mv_term(obs), 1.0 if obs.club_change else 0.0))
    elif ("R3" in rules and params.share and obs.pv_prev is not None
            and minutes_share is not None and not _is_goalkeeper(obs)):
        share = model.linear_share(params.share, (obs.share_prev(data.matchdays_prev),
                                                  minutes_share, _mv_term(obs),
                                                  1.0 if obs.club_change else 0.0))
    elif ("R1" in rules and params.share_new and obs.pv_prev is None
            and minutes_share is not None):
        share = model.linear_share(params.share_new, (minutes_share,))
    elif ({"R13", "R13b", "R13c"} & set(rules) and params.recent_share
            and obs.pv_prev is None
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
    if "R17" in rules and params.crowding_lam is not None:
        baseline_rules = tuple(rule for rule in rules if rule in SHARE_REPLACING or rule == "R0")
        crowding_x = _crowding_features(data, baseline_rules, params, derived)
        overflow = crowding_x.get(obs.fc_id)
        if overflow:
            share += model.forward_crowding_adjustment(overflow, params.crowding_lam)
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
# How much of the auction deliverable a rule may cost before the no-harm guard blocks it. Decided
# 28/07/2026: the guard used to tolerate NOTHING - a single name lost on a single window failed it - and
# that is too rigid, because a small regression can be the right direction that pays off with a later
# change. So it is elastic, and DELIBERATELY the same 2% the robust verdict already allows on the error
# side rather than a new number invented for the occasion.
#
# Read on the AGGREGATE over measuring windows, not per window: the per-window counts run 26-36 names, so
# a relative bound there would fail on one name (36 -> 35 is -2.8%) and would not be elastic at all. On the
# aggregate (157 names on euro/mantra) 2% is about three names, which is the intended "small".
TOP10_MAX_AGGREGATE_LOSS = MAX_WINDOW_LOSS


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


# ---------------------------------------------------------------- coefficient stability
#
# PRE-REGISTERED 28/07/2026, and written before it was run on anything.
#
# The gate judges a rule by its ERROR: improve the target on every window that measures it, by at least
# 0.5% on the players moved, without harming FM, VALUE or the top tens. That cannot express a distinction
# the day's six candidates made unavoidable: R15's coefficient is the same number on all five euro windows
# (+0.074 to +0.096) and it misses the amplitude floor, while R16's flips sign window to window and happens
# to improve the error anyway. Both are recorded as "does not pass" and they are not the same situation -
# one is a real effect too small to be worth a parameter, the other is noise.
#
# What this measures, per rule with an identifiable single fitted coefficient:
#   sign_consistent  the coefficient has the same sign on every window that measures it
#   dispersion       sd / |mean| across those windows (coefficient of variation)
#   stable           sign_consistent AND dispersion < STABILITY_MAX_DISPERSION
#
# The threshold is 0.5 because that is where |mean| = 2 x sd: the crudest sense in which a coefficient is
# distinguishable from zero across windows. It was NOT chosen by looking at what any rule needs - and it
# could not honestly be, because R15's coefficients had already been seen when this was written, which is
# exactly why the next paragraph matters.
#
# ⚠️ THIS CHANGES NO VERDICT. The amplitude floor and the no-harm guardrails are untouched, and nothing
# passes or fails because of it. It only CLASSIFIES the rejections, so the roadmap can tell "revisit when a
# new window arrives" from "closed". Using it to admit a rule would be a different decision - whether a
# real but tiny effect earns a parameter in the engine is a product judgement, not a statistical one, and
# the 0.5% floor is the existing answer to it. Changing that answer is not this function's business.
#
# It is applied UNIFORMLY, to every candidate including the ones already rejected. A criterion that only
# ran on the rule its author liked would be worthless, and if it classifies an unwelcome rule as stable
# then that is the finding. It did, several times over - see the LIMITATION below, which the first run
# found and which is the reason this measure is a classifier and not a gate.
#
# ⚠️ LIMITATION FOUND ON THE FIRST RUN, and it bounds what the number means. Dispersion has TWO causes and
# this measure cannot tell them apart:
#   1. there is no effect - the fit is chasing noise (R16: -0.101, +0.146, +0.098, +0.019, -0.006);
#   2. the regressor is COLLINEAR with one already in the model, so the fit trades weight between them
#      window to window while the prediction stays good.
# Cause 2 is not a defect and the first run proved it matters: **R3 is ADOPTED on Serie A and comes out
# unstable** (dispersion 0.88, +0.060 … +0.460 with Tm3 at -0.075), because its minutes regressor and
# `share_prev` both measure how much he played. R3 wins 10/10 windows on the error. So an unstable
# coefficient is NOT grounds for doubting a rule that works; it means the coefficient is not
# INTERPRETABLE. Read the classification as trustworthy for the single-lambda adjustment rules, and as
# "may be collinearity" for the share-replacing ones (R3, R3c, R15) whose fit has four regressors.
STABILITY_MAX_DISPERSION = 0.5

# Rule -> the fitted quantity that IS the rule, and where to find it. An index picks one slot out of a
# fitted tuple: the rule's OWN new regressor, not the whole refit. `None` where the rule is a wholesale
# replacement of the share regression (R7, R1, R13) and no single number represents it - reported as such
# rather than given a misleading one.
RULE_COEFFICIENT: dict[str, tuple[str, int | None]] = {
    "R2": ("gamma", None),
    "R3": ("share", 2),                    # minutes share
    "R3c": ("share_euro", 2),              # minutes on the euro rounds
    "R15": ("share_persistence", 2),       # availability persistence
    "R3d": ("share_both", 3),              # the appearance pattern, alongside the euro minutes
    "R4": ("age_fm", None),
    "R4b": ("age_share", None),
    "R5": ("elo_lam", None),
    "R5b": ("club_attack_lam", None),
    "R6": ("penalty_lam", None),
    "R10": ("coach_interaction", None),
    "R11": ("competition_lam", None),
    "R11b": ("crowded_lam", None),
    "R12": ("price_lam", None),
    "R12b": ("revision_lam", None),
    "R13b": ("recent_lam", None),
    "R13c": ("production_lam", None),
    "R14": ("idle_share", None),
    "R14b": ("idle_fm", None),
    "R16": ("budget_lam", None),
    "R16b": ("rivals_lam", None),
    "R17": ("crowding_lam", None),
}


def coefficient_stability(fitted: dict[str, "Params"], rule: str) -> dict | None:
    """Per-window coefficients of `rule`, and whether they agree. None when it has no single one."""
    where = RULE_COEFFICIENT.get(rule)
    if where is None:
        return None
    field, index = where
    values: dict[str, float] = {}
    for key, params in fitted.items():
        value = getattr(params, field, None)
        if isinstance(value, tuple):
            value = value[index] if index is not None and index < len(value) else None
        if isinstance(value, int | float):
            values[key] = float(value)
    if len(values) < 2:
        return {"coefficients": {k: _round(v, 4) for k, v in values.items()},
                "sign_consistent": None, "dispersion": None, "stable": None,
                "note": "fewer than two windows fit it"}
    numbers = list(values.values())
    signs = {1 if v > 1e-9 else -1 if v < -1e-9 else 0 for v in numbers}
    sign_consistent = len(signs - {0}) <= 1 and 0 not in signs
    mean = sum(numbers) / len(numbers)
    variance = sum((v - mean) ** 2 for v in numbers) / (len(numbers) - 1)
    dispersion = (variance ** 0.5) / abs(mean) if abs(mean) > 1e-12 else None
    return {
        "coefficients": {k: _round(v, 4) for k, v in values.items()},
        "sign_consistent": sign_consistent,
        "dispersion": _round(dispersion, 2),
        "stable": bool(sign_consistent and dispersion is not None
                       and dispersion < STABILITY_MAX_DISPERSION),
    }


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
    out["stability"] = {rule: coefficient_stability(fitted, rule) for rule in candidates}

    for rule in (*candidates, "ALL", "ADOPTED"):
        # A mixed set moves both halves, so it is judged on the product - the auction metric.
        target = RULES_BY_KEY[rule].metric if rule in RULES_BY_KEY else "value"
        kind = RULES_BY_KEY[rule].kind if rule in RULES_BY_KEY else "accuracy"
        rows = []
        for key, window_data in prepared.items():
            auction_before = auction_view(window_data, predictions[key]["R0"])
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
                # ⚠️ The two above are over CLASSIC roles even when game='mantra', because
                # `evaluate_window` iterates model.CLASSIC_ROLES unconditionally. The guard must protect
                # the DELIVERABLE, which for mantra is twelve roles, so it reads `auction_view` instead -
                # the same lists the panel shows. Getting this wrong is what made an earlier adoption look
                # like +2 names when the deliverable was losing 6.
                "auction_before": sum(b["hits"] for b in auction_before.values()),
                "auction_after": sum(
                    b["hits"] for b in auction_view(window_data, predictions[key][rule]).values()),
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
            # Both are reported: the strict form (not one name, anywhere) is what the guard used to be
            # and is kept visible, and the elastic form is what now decides.
            "top10_not_worse": all(row["top_after"] >= row["top_before"] for row in rows),
            "top10_before": sum(row["auction_before"] for row in measured),
            "top10_after": sum(row["auction_after"] for row in measured),
        }
        before_names = verdict["top10_before"]
        verdict["top10_loss"] = _round(
            (before_names - verdict["top10_after"]) / before_names, 4) if before_names else None
        verdict["top10_not_harmed"] = (verdict["top10_loss"] is None
                                       or verdict["top10_loss"] <= TOP10_MAX_AGGREGATE_LOSS)
        no_harm = (verdict["fm_not_worse"] and verdict["value_not_worse"]
                   and verdict["top10_not_harmed"])
        verdict["passes"] = ((coverage_up and added_sane and beats_naive and no_harm)
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
        stability = (result.get("stability") or {}).get(rule)
        if stability and stability.get("stable") is not None:
            verdict["coefficient_stable"] = stability["stable"]
            print(f"    coefficient {stability['coefficients']} · same sign "
                  f"{stability['sign_consistent']} · dispersion {stability['dispersion']} -> "
                  f"{'STABLE' if stability['stable'] else 'UNSTABLE'}"
                  f"  (classification only - changes no verdict)")
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
        if verdict.get("top10_loss") is not None:
            print(f"    auction names {verdict['top10_before']} -> {verdict['top10_after']} "
                  f"({-verdict['top10_loss'] * 100:+.1f}%) · within the {TOP10_MAX_AGGREGATE_LOSS:.0%} "
                  f"no-harm allowance: {verdict['top10_not_harmed']}")
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


SURPLUS = "surplus"     # rank by (FM - replacement) x Pv instead of FM x Pv
# SURPLUS with the ranking score scaled by the forward group's slot pressure (metrica doc §11):
# a contested hierarchy is discounted, an assured slot earns a capped premium. Ranking only -
# predictions, the gate, and the other two currencies do not move by a decimal.
SURPLUS_PRESSURE = "surplus_pressure"


def _slot_pressure_factors(data: features.WindowData,
                           predictions: list[Prediction]) -> dict[int, float]:
    """{fc_id: pressure factor} for every listone forward at a club with a measurable K.

    The serious-claimant count reads the whole LISTONE, not the predictions: the dangerous
    claimants (Openda, David - fresh arrivals) can be unpredictable to the engine while carrying a
    heavy Qt.I. Qt.I is read in the game's own currency, like everything else in this view.
    """
    matchdays = data.matchdays_target or 1
    pv_by_id = {p.obs.fc_id: p.pv_pred for p in predictions if p.pv_pred is not None}

    def qti(obs: features.Observation) -> float:
        value = (obs.price_initial_mantra if data.game == "mantra" else obs.price_initial)
        return value or 0.0

    groups: dict[str, list[features.Observation]] = {}
    for obs in data.observations:
        if obs.role_classic == "A" and obs.club_target:
            groups.setdefault(obs.club_target, []).append(obs)
    out: dict[int, float] = {}
    for club, members in groups.items():
        caps = data.forward_caps.get(club)
        if caps is None or caps[2] < model.FORWARD_MIN_XI:
            continue                     # no measurable shape: factor 1 by absence
        threshold = max(model.SERIOUS_QTI_MIN,
                        max(qti(obs) for obs in members) * model.SERIOUS_QTI_FRACTION)
        serious = sum(1 for obs in members
                      if pv_by_id.get(obs.fc_id, 0.0) / matchdays >= model.SERIOUS_SHARE
                      or qti(obs) >= threshold)
        factor = model.slot_pressure_factor(serious, caps[0])
        for obs in members:
            out[obs.fc_id] = factor
    return out


def auction_view(data: features.WindowData, predictions: list[Prediction],
                 top_n: int = TOP_N, metric: str = "value") -> dict:
    """Per role: the predicted top N and the real top N, each annotated with the other's rank.

    Two lists rather than one score. A precision of 6/10 hides whether the four misses were injuries,
    players the engine could not price at all, or ranking noise between comparable names - and only the
    named comparison shows which.

    `metric` chooses the CURRENCY both lists are ranked in, and every figure in the block follows it:

    * 'value'   - VALUE = FM x Pv, the sum of a season's fantavoti. The pre-registered metric, and the
                  DEFAULT, so the gate's published numbers are unaffected by any of this.
    * 'surplus' - (FM - replacement) x Pv, points over the man you would have fielded instead. Needs
                  `data.replacement` (league setup, see features.replacement_levels); a role without a
                  replacement level silently keeps the VALUE ordering rather than inventing one.

    The two answer different questions. VALUE ranks an iron-man on a below-average fantamedia into the
    top ten - Politano was 9th among the euro/mantra 'w' on a predicted 6.58 against a role level of
    6.65 - and it also puts him in the REAL top ten at the end of the season, which is not a bug: he
    really did accumulate that many fantavoti. Surplus asks the other question, the one an auction is
    actually about, and answers 'nothing, he IS the bench'.
    """
    out: dict[str, dict] = {}
    roles, holds = role_membership(data)
    surplus_like = metric in (SURPLUS, SURPLUS_PRESSURE)
    # Slot pressure scales the PREDICTED ranking score only: the actual side is a report on what
    # happened and reports are not discounted for the risk they no longer carry.
    pressure = _slot_pressure_factors(data, predictions) if metric == SURPLUS_PRESSURE else {}
    for role in roles:
        observations = [obs for obs in data.observations if holds(obs, role)]
        valued = [p for p in predictions
                  if holds(p.obs, role) and p.value_pred is not None]
        if not observations:
            continue
        # The competitor for a role slot is the marginal player AT THAT ROLE, so each list uses its own
        # floor - not a multi-role player's average, which would price the same man differently in the
        # two lists he appears in.
        floor = data.replacement.get(role) if surplus_like else None
        # What ACTUALLY happened is measured against the level of the season it happened in. The
        # predicted side never touches this - it may only know the input seasons - and that asymmetry is
        # the point: one is a forecast, the other is a report, and a report scored against a three-year
        # old baseline says a 28-match striker was worth less than a one-match one.
        floor_act = (data.replacement_actual.get(role) or floor) if surplus_like else None

        def over_floor(fm, appearances, _floor=floor):
            """Points over the bench, optionally discounted for how little you can count on him.

            The bare product is the EXACT expected surplus: on the days he does not play you field the
            replacement and bank nothing, so a man with three good games is worth three good games. What
            the reliability weight adds is the part expectation cannot see - a slot whose Pv forecast is
            12 is also a high-variance slot, and transfers are limited. It makes the measure
            super-linear in appearances, and it is a declared preference, not an accuracy claim.
            """
            if fm is None or appearances is None or _floor is None:
                return None
            surplus = (fm - _floor) * appearances
            if not data.reliability or not data.matchdays_target:
                return surplus
            share = model.clip(appearances / data.matchdays_target, 0.0, 1.0)
            return surplus * share ** data.reliability

        def surplus_act(obs, _floor=floor_act):
            return over_floor(obs.fm_act, obs.pv_act, _floor)

        def score_pred(p, _floor=floor):
            base = (p.value_pred or 0.0) if _floor is None else (
                over_floor(p.fm_pred, p.pv_pred) or 0.0)
            return base * pressure.get(p.obs.fc_id, 1.0)

        def score_act(obs, _floor=floor_act):
            if _floor is None:
                return obs.value_act or 0.0
            return surplus_act(obs) or 0.0

        # Who is ELIGIBLE to be ranked at all. A one-appearance hat-trick is not a small value, it is
        # not a value of this kind: you could not have fielded him, so he does not belong in a ranking
        # of who to buy - at any discount, which is why this is a floor and not a steeper curve. Off
        # (0.0) unless the league asks for it, so the pre-registered VALUE lists are never filtered.
        floor_share = data.min_availability if surplus_like else 0.0

        def fieldable(appearances, _floor=floor_share):
            if not _floor or not data.matchdays_target or appearances is None:
                return True
            return appearances / data.matchdays_target >= _floor

        ranked = sorted((p for p in valued if fieldable(p.pv_pred)), key=lambda p: -score_pred(p))
        predicted_rank = {p.obs.fc_id: index for index, p in enumerate(ranked, 1)}
        by_id = {p.obs.fc_id: p for p in valued}
        actual = sorted((obs for obs in observations
                         if obs.value_act is not None and fieldable(obs.pv_act)),
                        key=lambda obs: -score_act(obs))
        actual_rank = {obs.fc_id: index for index, obs in enumerate(actual, 1)}

        # What buying the engine's ten would have RETURNED, against what the perfect ten returned.
        # Precision counts names and treats every miss alike; this counts points, so missing the tenth
        # defender costs what the tenth defender was worth. It is the closest thing the harness has to
        # the question the auction actually asks.
        def market(obs, _game=data.game):
            """The market's own end-of-season answer, in the game's own currency."""
            return obs.fvm_mantra if _game == "mantra" else obs.fvm

        def asked(obs, _game=data.game):
            """What the market asked for him BEFORE the auction, in the same currency."""
            return obs.price_initial_mantra if _game == "mantra" else obs.price_initial

        captured = sum(score_act(p.obs) for p in ranked[:top_n])
        perfect = sum(score_act(obs) for obs in actual[:top_n])

        # Same-club company inside the predicted top N, said out loud. Purely additive: the ranking,
        # the captured VALUE and every other figure are untouched - this only annotates that two of
        # the N names claim the same club's slots, with the season-start evidence that tells a
        # two-striker system (Inter 24/25: K 2.05, 23 co-starts) from a hierarchy (Fiorentina: 1.71).
        # K is a FORWARD capacity, so it is only attached on forward lists; co-starts likewise.
        forward_role = role == "A" or role in model.MANTRA_BY_CLASSIC.get("A", ())
        club_company: dict[str, list[Prediction]] = {}
        for p in ranked[:top_n]:
            if p.obs.club_target:
                club_company.setdefault(p.obs.club_target, []).append(p)

        def pair_note(p: Prediction) -> dict | None:
            company = club_company.get(p.obs.club_target or "", [])
            others = [q for q in company if q.obs.fc_id != p.obs.fc_id]
            if not others:
                return None
            mate = others[0]                       # the best-ranked of the others
            caps = data.forward_caps.get(p.obs.club_target) if forward_role else None
            measurable = caps is not None and caps[2] >= model.FORWARD_MIN_XI
            pair_key = tuple(sorted((p.obs.fc_id, mate.obs.fc_id)))
            qti_own, qti_mate = asked(p.obs), asked(mate.obs)
            return {
                "with": [q.obs.name for q in others],
                "k_mean": _round(caps[0], 2) if measurable else None,
                "n_xi": caps[2] if caps else 0,
                "co_starts": data.co_starts.get(pair_key) if forward_role else None,
                "qti_gap": (_round(qti_own - qti_mate, 1)
                            if qti_own is not None and qti_mate is not None else None),
            }

        out[role] = {
            "n_actual": len(actual),
            "metric": metric,
            "replacement": _round(floor, 2),
            "replacement_actual": _round(floor_act, 2),
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
                "price_initial": asked(p.obs),
                "fm_pred": _round(p.fm_pred, 2), "pv_pred": _round(p.pv_pred, 1),
                "value_pred": _round(p.value_pred, 1),
                "surplus_pred": _round(over_floor(p.fm_pred, p.pv_pred), 1),
                "fm_act": p.obs.fm_act, "pv_act": p.obs.pv_act,
                "value_act": _round(p.obs.value_act, 1),
                "surplus_act": _round(surplus_act(p.obs), 1),
                "fvm": market(p.obs),
                "actual_rank": actual_rank.get(p.obs.fc_id),
                "pair": pair_note(p),
                "pressure": _round(pressure.get(p.obs.fc_id), 2) if pressure else None,
            } for index, p in enumerate(ranked[:top_n], 1)],
            "actual": [{
                "rank": index, "name": obs.name, "club": obs.club_target,
                "price_initial": asked(obs),
                "fm_act": obs.fm_act, "pv_act": obs.pv_act,
                "value_act": _round(obs.value_act, 1),
                "surplus_act": _round(surplus_act(obs), 1), "fvm": market(obs),
                "fm_pred": _round(by_id[obs.fc_id].fm_pred, 2) if obs.fc_id in by_id else None,
                "pv_pred": _round(by_id[obs.fc_id].pv_pred, 1) if obs.fc_id in by_id else None,
                "value_pred": _round(by_id[obs.fc_id].value_pred, 1) if obs.fc_id in by_id else None,
                "surplus_pred": (_round(over_floor(by_id[obs.fc_id].fm_pred,
                                                   by_id[obs.fc_id].pv_pred), 1)
                                 if obs.fc_id in by_id else None),
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
            name = left["name"][:19] + "*" if left.get("pair") else left["name"][:20]
            print(f"    {left['rank']:2d}  {name:<20} "
                  f"{(left['price_initial'] or 0):4.0f} {left['fm_pred'] or 0:5.2f} "
                  f"{left['pv_pred'] or 0:5.1f} {left['value_pred'] or 0:6.0f} {got} "
                  f"{left['fvm'] or 0:5.0f} {actual_rank:>6}"
                  f"   {right['rank']:2d}  {right['name'][:20]:<20} {right['fm_act'] or 0:5.2f} "
                  f"{right['pv_act'] or 0:4d} {right['value_act'] or 0:6.0f} "
                  f"{right['fvm'] or 0:5.0f} {pred_rank:>6}")
        noted = [(row["name"], row["pair"]) for row in block["predicted"] if row.get("pair")]
        for name, pair in noted:
            k_text = f"K={pair['k_mean']:.2f}" if pair["k_mean"] is not None else "K n/m"
            co = pair["co_starts"]
            gap = pair["qti_gap"]
            print(f"      * {name} with {', '.join(pair['with'])} - {k_text}"
                  f" · co-starts {co if co is not None else '-'}"
                  f" · ΔQt.I {gap if gap is not None else '-'}")


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
            # No platform/game combination is skipped: Mantra is played on the classic Serie A game
            # too, and its listone carries the whole Mantra apparatus (RM, Qt.A M, Qt.I M, FVM M).
            # `rosters.roles` has held 641-751 Serie A players' Mantra roles every season since 18/19.
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
