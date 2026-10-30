"""The synthetic BASE VOTE of a match the fantacalcio does not vote, without the provider's rating.

`docs/model/voto-sintetico-senza-rating-v1.md`: since SofaScore answers 403 (24/09/2026) its rating - the
input of `mv_synth` - no longer arrives. This rebuilds the vote from facts any source carries: the man's own
events, the result, his time on the pitch and the two clubs' strength. A linear rule PER ROLE, its weights
fitted on real votes (`vote_synth_coef.json`, written by `toolkit/scripts/synth_vote/`), measured out of
season at 0.303 of MAE abroad and 0.310 in Serie A against the rating line's 0.372 and 0.363.

Dependency-free like the rest of `engine/`, and a pure function of one row: what a row does not carry is
read as the population's own value (no Elo = an even match against an average club), never invented.
"""

from __future__ import annotations

import json
from pathlib import Path

COEFFICIENTS: dict[str, dict[str, float]] = {
    role: weights for role, weights in json.loads(
        (Path(__file__).with_name("vote_synth_coef.json")).read_text(encoding="utf-8")).items()
    if not role.startswith("_")}
FULL_MATCH = 90
ELO_ANCHOR = 1700.0


def features(row: dict, role: str) -> dict[str, float]:
    """The model's inputs from one player-match row (ESPN's names: `goals` includes penalties)."""
    minutes = float(row.get("minutes") or 0)
    gf, ga = int(row.get("team_goals") or 0), int(row.get("opponent_goals") or 0)
    gd = max(-3, min(3, gf - ga))
    m90 = min(minutes, FULL_MATCH) / FULL_MATCH
    started = 1.0 if row.get("starter") else 0.0
    keeper = role == "P"
    elo_t, elo_o = row.get("elo_team"), row.get("elo_opp")
    return {
        "goals_all": float(row.get("goals") or 0), "assists": float(row.get("assists") or 0),
        "manyGA": float(ga >= 3), "manyGF": float(gf >= 3), "reds": float(row.get("reds") or 0),
        "pen_missed": float(row.get("pen_missed") or 0), "own_goals": float(row.get("own_goals") or 0),
        "yellows": float(row.get("yellows") or 0),
        "cs_dp": float(role in ("D", "P") and ga == 0 and minutes >= 60),
        "gk_ga": float(row.get("goals_conceded") or 0) if keeper else 0.0,
        "pen_saved": float(row.get("pen_saved") or 0) if keeper else 0.0,
        "saves": float(row.get("saves") or 0) if keeper else 0.0,
        "sub_short": float(not started and minutes <= 30),
        "W": float(gf > ga), "L": float(gf < ga), "gd": float(gd), "GFc": float(min(gf, 5)),
        "GAc": float(min(ga, 5)), "m90": m90, "started": started, "gd_m": gd * m90,
        "elod": (elo_t - elo_o) / 100 if elo_t is not None and elo_o is not None else 0.0,
        "elot": (elo_t - ELO_ANCHOR) / 100 if elo_t is not None else 0.0,
        "home": float(row.get("home") or 0),
    }


# THE CAMEO WITHOUT A VOTE (operator, 30/10/2026): «se il calciatore ha giocato meno di 15 minuti non deve
# prendere voto e risultare come partita non giocata - a meno che non abbia segnato, fatto assist, sbagliato un
# rigore o sia stato espulso». Measured on 23,000 Serie A appearances against the real votes before adopting
# it: s.v. on 97% of cameos under 10 minutes, 49% from 10 to 14, 3% from 15 to 19 - the cut sits on the jump.
MIN_VOTE_MINUTES = 15


def gets_a_vote(minutes, goals=0, assists=0, pen_missed=0, reds=0) -> bool:
    """Whether a synthetic vote may exist for this appearance. ONE definition: `synth` (the provider-rating line,
    `mv_synth`/`mv_est`) and this module (ESPN) both ask here. Unknown minutes are not a short cameo."""
    if minutes is None:
        return True
    if minutes >= MIN_VOTE_MINUTES:
        return True
    return bool((goals or 0) or (assists or 0) or (pen_missed or 0) or (reds or 0))


def raw_vote(row: dict, role: str, coefficients: dict | None = None) -> float | None:
    """The unrounded prediction, or None for a man who did not play or a role we do not know."""
    weights = (coefficients or COEFFICIENTS).get(role)
    if weights is None or not row.get("minutes"):
        return None
    if not gets_a_vote(row.get("minutes"), row.get("goals"), row.get("assists"), row.get("pen_missed"),
                       row.get("reds")):
        return None
    x = features(row, role)
    return weights["base"] + sum(w * x.get(name, 0.0) for name, w in weights.items() if name != "base")


def base_vote(row: dict, role: str, coefficients: dict | None = None) -> float | None:
    """On the half-point alphabet the real votes live on (57,925 of 57,925, `letture-app-v1.md` §25.5)."""
    vote = raw_vote(row, role, coefficients)
    return None if vote is None else round(vote * 2) / 2
