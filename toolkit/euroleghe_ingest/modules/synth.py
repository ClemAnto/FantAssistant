"""synth - calibrated synthetic base voto for the matches EuroLeghe never voted (spec v9 §7).

The euro calendar skips real matchdays, and the 4 foreign leagues have no fantacalcio vote at all
outside it. Propensity can be computed from facts, but any FM-like quantity needs a BASE VOTO. So we
fit the provider rating onto the real base voto (Mv) on the OVERLAP - the matches where we know both
- and apply that mapping to the matches we are missing.

Decisions this implements (from the spec):
- the fit targets the **base voto**, never the fantavoto: the bonuses are added afterwards by the
  engine's per-league scoring, so a rating that already embeds goals must not double-count them;
- the target is the **euro** Mv, not the `default` one: for the same real match the two platforms
  publish a different base voto (+/-0.5 on about a third of the players), and euro is what the game
  scores;
- **no fixed buckets**: a least-squares line per role (Classic P/D/C/A), fitted on the data, with the
  global line as the fallback for roles with too few pairs;
- the result lands in external_match_stats.mv_synth, a source-tagged column that never touches
  match_ratings. Every downstream use still has to pass the out-of-sample gate.

Honest scope: it is a linear map from one noisy rating to another, so its per-match error is around
half a grade; its value is in the aggregate (season-long propensity and FM-equivalent), not in
pretending to know a single match's vote.
"""

from __future__ import annotations

import json

from euroleghe_ingest.context import Context

NAME = "synth"
DESCRIPTION = "Calibrated synthetic base voto (provider rating -> euro Mv) -> mv_synth"
DEPENDS_ON: list[str] = ["positions", "matchdays"]
RAW_INPUTS: list[str] = []
NETWORK = False

MIN_PAIRS_PER_ROLE = 200      # below this a role reuses the global line
MV_RANGE = (3.0, 10.0)        # the fantacalcio base voto never leaves this band
CALIBRATION_FILE = "mv_synth_calibration.json"


def overlap_pairs(conn, holdout_season: str | None = None):
    """(role, provider rating, euro Mv) for every match where we know both.

    The join goes through matchday_map: the provider row is keyed by REAL matchday, the vote by EURO
    matchday, and one euro round bundles a different real round in each league.
    """
    rows = conn.execute(
        """
        SELECT mr.role, e.rating, mr.mv, e.season
        FROM external_match_stats e
        JOIN matchday_map m ON m.season = e.season AND m.league = e.competition
                           AND m.real_md = e.real_md
        JOIN match_ratings mr ON mr.fc_id = e.fc_id AND mr.season = e.season
                             AND mr.platform = 'euro' AND mr.matchday = m.euro_md
        WHERE e.source = 'sofascore' AND e.rating IS NOT NULL AND mr.mv IS NOT NULL
          AND COALESCE(e.minutes, 0) > 0 AND mr.role IN ('P', 'D', 'C', 'A')
        """
    ).fetchall()
    fit = [(role, rating, mv) for role, rating, mv, season in rows if season != holdout_season]
    test = [(role, rating, mv) for role, rating, mv, season in rows if season == holdout_season]
    return fit, test


def _fit_line(pairs) -> tuple[float, float] | None:
    """Least-squares mv = a + b*rating (plain formulas: no numpy needed for two coefficients)."""
    n = len(pairs)
    if n < 2:
        return None
    sum_x = sum(rating for _role, rating, _mv in pairs)
    sum_y = sum(mv for _role, _rating, mv in pairs)
    sum_xx = sum(rating * rating for _role, rating, _mv in pairs)
    sum_xy = sum(rating * mv for _role, rating, mv in pairs)
    denominator = n * sum_xx - sum_x * sum_x
    if abs(denominator) < 1e-9:
        return None
    slope = (n * sum_xy - sum_x * sum_y) / denominator
    intercept = (sum_y - slope * sum_x) / n
    return round(intercept, 4), round(slope, 4)


def fit_model(pairs) -> dict:
    """{'global': [a, b], 'roles': {role: [a, b]}} - roles with too few pairs fall back to global."""
    model = {"global": _fit_line(pairs), "roles": {}, "n": len(pairs)}
    by_role: dict[str, list] = {}
    for pair in pairs:
        by_role.setdefault(pair[0], []).append(pair)
    for role, role_pairs in by_role.items():
        line = _fit_line(role_pairs) if len(role_pairs) >= MIN_PAIRS_PER_ROLE else None
        if line:
            model["roles"][role] = line
            model.setdefault("n_by_role", {})[role] = len(role_pairs)
    return model


def apply_model(model: dict, role: str | None, rating: float | None) -> float | None:
    if rating is None or not model.get("global"):
        return None
    intercept, slope = model["roles"].get(role) or model["global"]
    value = intercept + slope * rating
    return round(min(max(value, MV_RANGE[0]), MV_RANGE[1]), 2)


def evaluate(model: dict, pairs) -> dict:
    """MAE / bias of the fitted map, plus the naive baseline (predict the mean Mv) for comparison."""
    if not pairs:
        return {}
    errors = [apply_model(model, role, rating) - mv for role, rating, mv in pairs]
    mean_mv = sum(mv for _r, _x, mv in pairs) / len(pairs)
    baseline = [mean_mv - mv for _r, _x, mv in pairs]
    return {
        "n": len(pairs),
        "mae": round(sum(abs(e) for e in errors) / len(errors), 4),
        "bias": round(sum(errors) / len(errors), 4),
        "mae_baseline_mean": round(sum(abs(e) for e in baseline) / len(baseline), 4),
    }


def run(ctx: Context, *, holdout_season: str = "2025-26", **kwargs) -> None:
    """Fit the rating -> Mv map on the overlap and write mv_synth for every provider match row.

    The most recent season is held out by default, so the log shows an out-of-sample MAE next to the
    in-sample one. This is a sanity check, NOT the project's gate: the gate lives in the engine.
    """
    conn = ctx.require_conn()
    fit_pairs, test_pairs = overlap_pairs(conn, holdout_season)
    if not fit_pairs:
        print("[synth] no overlap between the provider ratings and the euro votes yet - "
              "run `positions --layer match` and `matchdays` first")
        return

    model = fit_model(fit_pairs)
    in_sample = evaluate(model, fit_pairs)
    out_sample = evaluate(model, test_pairs)
    intercept, slope = model["global"]
    print(f"[synth] fitted on {len(fit_pairs)} overlap matches (holdout {holdout_season}): "
          f"mv = {intercept} + {slope} * rating")
    for role, (role_intercept, role_slope) in sorted(model["roles"].items()):
        print(f"[synth]   role {role}: mv = {role_intercept} + {role_slope} * rating "
              f"(n={model.get('n_by_role', {}).get(role)})")
    print(f"[synth] in-sample  MAE {in_sample['mae']} (mean-baseline {in_sample['mae_baseline_mean']})"
          f" · bias {in_sample['bias']}")
    if out_sample:
        print(f"[synth] out-of-sample MAE {out_sample['mae']} "
              f"(mean-baseline {out_sample['mae_baseline_mean']}) · bias {out_sample['bias']} "
              f"on {out_sample['n']} matches")

    # Apply to every provider match row. The role comes from the roster (Classic role) because the
    # provider's own position code is a different vocabulary (G/D/M/F) and unknown for our purposes.
    rows = conn.execute(
        """
        SELECT e.fc_id, e.season, e.match_id, e.rating, r.role_classic
        FROM external_match_stats e
        LEFT JOIN rosters r ON r.fc_id = e.fc_id AND r.season = e.season
        WHERE e.source = 'sofascore' AND e.rating IS NOT NULL
        """
    ).fetchall()
    updates = [(apply_model(model, role, rating), fc_id, season, match_id)
               for fc_id, season, match_id, rating, role in rows]
    conn.executemany(
        "UPDATE external_match_stats SET mv_synth = ? "
        "WHERE fc_id = ? AND season = ? AND source = 'sofascore' AND match_id = ?",
        updates,
    )
    conn.commit()

    path = ctx.config.data_dir / "reports" / CALIBRATION_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"model": model, "in_sample": in_sample,
                                "out_of_sample": out_sample, "holdout_season": holdout_season},
                               indent=2), encoding="utf-8")
    print(f"[synth] mv_synth written for {len(updates)} provider matches · model -> {path}")
