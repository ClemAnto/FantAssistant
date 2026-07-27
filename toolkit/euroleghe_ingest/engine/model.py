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
from euroleghe_ingest.sources import CLASSIC_ROLES, MANTRA_ROLES
from euroleghe_ingest.sources import _norm_roles as split_roles

__all__ = ["CLASSIC_ROLES", "MANTRA_ROLES", "split_roles"]

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
