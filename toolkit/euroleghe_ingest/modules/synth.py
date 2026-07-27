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


VALIDATION_FILE = "mv_synth_validation.json"


def validate_against_default(ctx: Context) -> dict:
    """Validate the synthetic layer where BOTH real vote sets exist: Serie A.

    Three levels, because they answer different questions, and only the third one tells you what to
    fix:
      1. per match - mv_synth against the euro Mv it was fitted on, and against the classic `default`
         Mv. The euro-vs-default gap is the FLOOR: the two real vote sets disagree by about 0.21 on
         the same match, so no synthetic voto calibrated on one can be closer than that to the other.
      2. per season - the FM-equivalent (real euro vote where the euro calendar covered the round,
         mv_synth elsewhere) against the real Serie A fantamedia over the same rounds.
      3. fixture selection - for clubs whose per-match layer is INCOMPLETE, the real fantamedia on the
         covered rounds minus the real fantamedia on the whole season. That isolates "we measured him
         on the wrong half of the season" from "the synthetic voto is wrong", and the two need
         completely different fixes (more scraping vs recalibration).

    Read-only. Writes data/reports/mv_synth_validation.json.
    """
    conn = ctx.require_conn()
    report: dict = {"per_match": {}, "per_season": {}, "fixture_selection": {}}

    rows = conn.execute(
        """
        SELECT COALESCE(mr_e.role, mr_d.role), e.mv_synth, mr_e.mv, mr_d.mv
        FROM external_match_stats e
        JOIN matchday_map m ON m.season = e.season AND m.league = e.competition
                           AND m.real_md = e.real_md
        LEFT JOIN match_ratings mr_e ON mr_e.fc_id = e.fc_id AND mr_e.season = e.season
                                    AND mr_e.platform = 'euro' AND mr_e.matchday = m.euro_md
        LEFT JOIN match_ratings mr_d ON mr_d.fc_id = e.fc_id AND mr_d.season = e.season
                                    AND mr_d.platform = 'default' AND mr_d.matchday = e.real_md
        WHERE e.competition = 'serie_a' AND e.source = 'sofascore'
          AND e.mv_synth IS NOT NULL AND COALESCE(e.minutes, 0) > 0
        """).fetchall()
    for role in ("P", "D", "C", "A", "ALL"):
        picked = [r for r in rows if role == "ALL" or r[0] == role]
        pairs = {
            "synth_vs_euro": [(s, e) for _r, s, e, _d in picked if e is not None],
            "synth_vs_default": [(s, d) for _r, s, _e, d in picked if d is not None],
            "euro_vs_default": [(e, d) for _r, _s, e, d in picked
                                if e is not None and d is not None],
        }
        entry = {}
        for name, values in pairs.items():
            if values:
                errors = [a - b for a, b in values]
                entry[name] = {"n": len(errors),
                               "bias": round(sum(errors) / len(errors), 4),
                               "mae": round(sum(abs(x) for x in errors) / len(errors), 4)}
        report["per_match"][role] = entry

    from euroleghe_ingest.modules.arrivals import foreign_fm_equivalent
    scoring = ctx.config.load_scoring("serie_a")
    seasons = [s for (s,) in conn.execute("SELECT DISTINCT season FROM rosters ORDER BY season")]
    for season in seasons:
        equivalents = foreign_fm_equivalent(conn, scoring, season)
        by_role: dict[str, list[float]] = {}
        for fc_id, role, fm_real in conn.execute(
                """SELECT r.fc_id, r.role_classic, ss.fm FROM rosters r
                   JOIN season_stats ss ON ss.fc_id = r.fc_id AND ss.season = r.season
                                       AND ss.platform = 'default'
                   WHERE r.season = ? AND r.league = 'serie_a' AND ss.pv >= 15
                     AND ss.fm IS NOT NULL""", (season,)):
            entry = equivalents.get(fc_id)
            if entry and role:
                by_role.setdefault(role, []).append(entry[0] - fm_real)
        report["per_season"][season] = {
            role: {"n": len(errors), "bias": round(sum(errors) / len(errors), 3),
                   "mae": round(sum(abs(e) for e in errors) / len(errors), 3),
                   "within_0_3": round(sum(1 for e in errors if abs(e) <= 0.3) / len(errors), 3)}
            for role, errors in sorted(by_role.items()) if errors}

        covered: dict[str, set[int]] = {}
        for club, real_md in conn.execute(
                "SELECT DISTINCT club, real_md FROM external_match_stats "
                "WHERE season = ? AND competition = 'serie_a' AND club IS NOT NULL", (season,)):
            covered.setdefault(club, set()).add(real_md)
        partial = {club: rounds for club, rounds in covered.items() if len(rounds) < 38}
        deltas: dict[str, list[float]] = {}
        for fc_id, role, fm_real, club in conn.execute(
                """SELECT r.fc_id, r.role_classic, ss.fm,
                          (SELECT e.club FROM external_match_stats e
                            WHERE e.fc_id = r.fc_id AND e.season = r.season LIMIT 1)
                   FROM rosters r
                   JOIN season_stats ss ON ss.fc_id = r.fc_id AND ss.season = r.season
                                       AND ss.platform = 'default'
                   WHERE r.season = ? AND r.league = 'serie_a' AND ss.pv >= 25
                     AND ss.fm IS NOT NULL""", (season,)):
            rounds = partial.get(club or "")
            if not rounds or not role:
                continue
            votes = conn.execute(
                "SELECT matchday, fantavoto FROM match_ratings WHERE fc_id = ? AND season = ? "
                "AND platform = 'default' AND fantavoto IS NOT NULL", (fc_id, season)).fetchall()
            on_covered = [value for matchday, value in votes if matchday in rounds]
            if len(on_covered) >= 8:
                deltas.setdefault(role, []).append(
                    sum(on_covered) / len(on_covered) - fm_real)
        report["fixture_selection"][season] = {
            "clubs_incomplete": len(partial),
            "by_role": {role: {"n": len(values), "bias": round(sum(values) / len(values), 3)}
                        for role, values in sorted(deltas.items())}}

    path = ctx.config.data_dir / "reports" / VALIDATION_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    overall = report["per_match"].get("ALL", {})
    print(f"[synth] per match (Serie A): synth vs euro MAE "
          f"{overall.get('synth_vs_euro', {}).get('mae')} · vs default "
          f"{overall.get('synth_vs_default', {}).get('mae')} · the two REAL sets "
          f"{overall.get('euro_vs_default', {}).get('mae')} (the floor)")
    for season, entry in report["fixture_selection"].items():
        biases = " ".join(f"{role} {value['bias']:+.3f}"
                          for role, value in entry["by_role"].items())
        print(f"[synth] {season}: {entry['clubs_incomplete']} clubs with an incomplete layer · "
              f"fixture-selection bias {biases or 'none measurable'}")
    print(f"[synth] validation -> {path}")
    return report


def run(ctx: Context, *, holdout_season: str = "2025-26", validate: bool = False,
        **kwargs) -> None:
    """Fit the rating -> Mv map on the overlap and write mv_synth for every provider match row.

    `validate=True` skips the fit and only re-measures the layer against the Serie A real votes
    (`validate_against_default`), which is read-only.

    The most recent season is held out by default, so the log shows an out-of-sample MAE next to the
    in-sample one. This is a sanity check, NOT the project's gate: the gate lives in the engine.
    """
    if validate:
        validate_against_default(ctx)
        return
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
