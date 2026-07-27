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
from dataclasses import dataclass
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


# The pre-registered set (see the roadmap). Declared here so `--rules` can refuse a rule that has
# not been built yet instead of silently ignoring it.
RULES: tuple[Rule, ...] = (
    Rule("R0", "baseline: the current validated engine (core + M2e + expected appearances)", True),
    Rule("R1", "arrival layer: foreign FM-equivalent + cross-league adaptation discount"),
    Rule("R2", "beta corroborated by per-90 propensity (xG/xA per 90)"),
    Rule("R3", "minutes inside expected appearances"),
    Rule("R4", "age curve"),
    Rule("R7", "goalkeeper starter probability as a binary event"),
    Rule("R8", "defenders' bonus potential (real role + set pieces)"),
    Rule("R9", "anchor recency weight (goal-environment drift)"),
)
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
    if data.game == "classic":
        anchor = data.anchors.get(obs.role_classic or "")
    else:
        anchor = model.fractional_anchor(obs.roles_mantra, data.anchors)
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


def predict_one(obs: features.Observation, data: features.WindowData, rules: tuple[str, ...],
                share_coeffs: tuple[float, ...] | None = None) -> Prediction | None:
    """B0 for one player. None = the engine has nothing to say (a finding, not a bug).

    `rules` is unused while only R0 exists; it is the hook the pre-registered rules plug into.
    """
    fm_pred, anchor = _predict_fm(obs, data)
    pv_pred = _predict_pv(obs, data, share_coeffs)
    if fm_pred is None and pv_pred is None:
        return None
    return Prediction(obs, fm_pred, pv_pred, anchor)


def predict_window(data: features.WindowData, rules: tuple[str, ...],
                   share_coeffs: tuple[float, ...] | None = None) -> list[Prediction]:
    return [prediction for prediction in
            (predict_one(obs, data, rules, share_coeffs) for obs in data.observations)
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
                    share_coeffs: tuple[float, ...] | None = None) -> dict:
    predictions = predict_window(data, rules, share_coeffs)
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
        "overall": role_metrics(data.observations, predictions),
        "by_role": by_role,
        "appearance_segments": appearance_segments(data, predictions),
        "features": features.feature_availability(data.observations),
    }


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
        verify: bool = False, report: bool = True) -> dict:
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
