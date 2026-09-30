"""THE EXPECTED APPEARANCES, REBUILT FROM THEIR PARTS - a test bench, not an engine rule (30/09/2026).

The operator's request: split every past season into the reasons a man did or did not get a vote - injured,
suspended, absent for another reason, not called, on the bench, came on, started - and predict next season's
appearances as a product of those parts, so each part can be re-tuned on its own:

    Pa = N x D_hat x S_hat x europe x c

    D_hat   availability over two seasons (the older weighted w2), pulled toward the population's Dbar by kD;
    S_hat   chosen when available: (1 - alpha - gamma) x share of games played + alpha x share of minutes
            + gamma x share of starts, pulled toward its CONTEXT's prior by kS; x (1 + q (mv - 6)), the quality;
    europe  (1 - b x Eout) / (1 - b x Ein): the club of the predicted season plays a European cup (main phase),
            and the club of the measured one did;
    c       one scale.

The source is Transfermarkt's per-game payload, already in the cache (`transfermarkt_perf_<id>.json`): it carries
the participation state, whether he STARTED, the minutes, and the ABSENCE reason - 1, 2 and 3 are the three
suspensions (yellow accumulation, second yellow, red), measured against the cards of the game before: 93%, 94%
and a red (or a ban already running). The parser (`modules/performance.py`) keeps the state and drops the
reason and the start; this script reads the payloads instead, read-only.

The parameters are fitted on T1 (2023-24 -> 2024-25) and JUDGED on T2 (2024-25 -> 2025-26), against the engine's
own pre-season prediction of the same windows built the way the gate builds it (every window fitted, the judged one
scored with its neighbour's parameters). Writes `presence_test.json` into the newest export folder (or `--out`),
which `app/scripts/pull-bundle.mjs` copies for the /why page. The file carries names and paid numbers: it lives
under data/, never in the repository.

    python toolkit/scripts/presence_test/build.py [--db PATH] [--out FILE]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, median

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "toolkit"))
from euroleghe_ingest.engine import evaluate, features  # noqa: E402

TM_SEASON = {2022: "2022-23", 2023: "2023-24", 2024: "2024-25", 2025: "2025-26"}
PREV = {"2025-26": "2024-25", "2024-25": "2023-24", "2023-24": "2022-23"}
TARGET = {"T1": "2024-25", "T2": "2025-26"}
SUSPENSION = {1, 2, 3}
EUROPE = {"CL", "EL", "UCOL"}
TOP5 = {"IT1", "GB1", "ES1", "L1", "FR1"}
LEAGUE_TYPES = {1, 2}          # Transfermarkt's first and second divisions; cups and youth are other types
CONTEXTS = ("serie A, stesso club", "serie A, cambio club", "estero top5", "altro campionato", "portiere", "nessuna")
GRID = {
    "kD": [0, 20, 40, 80, 160, 320, 640], "w2": [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0],
    "alpha": [0, 0.25, 0.5, 0.75, 1.0], "gamma": [0, 0.1, 0.2, 0.3, 0.5],
    "q": [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.5], "kS": [0, 5, 10, 20, 40, 80, 160],
    "b": [-0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.3], "c": [0.85, 0.9, 0.95, 1.0, 1.05, 1.1],
}


def breakdown(conn: sqlite3.Connection, cache: Path):
    """Per (fc_id, season): the league seasons summed, the clubs, the first club, and the clubs in Europe."""
    agg: dict = defaultdict(lambda: defaultdict(float))
    clubs: dict = defaultdict(lambda: defaultdict(float))
    first: dict = {}
    europe: set = set()
    for tm, fc in conn.execute("select source_id, fc_id from player_xref where source='transfermarkt'"):
        path = cache / f"transfermarkt_perf_{tm}.json"
        if not path.exists():
            continue
        try:
            games = json.loads(path.read_text(encoding="utf-8"))["data"]["performance"]
        except (ValueError, KeyError, TypeError):
            continue
        for game in games:
            info = game["gameInformation"]
            season = TM_SEASON.get(info.get("seasonId"))
            if season is None or info.get("isNationalGame"):
                continue
            club = str(((game.get("clubsInformation") or {}).get("club") or {}).get("clubId"))
            comp = info["competitionId"]
            if comp in EUROPE:
                europe.add((club, season))
            when = info["date"]["dateTimeUTC"] or ""
            if (fc, season) not in first or when < first[(fc, season)][0]:
                first[(fc, season)] = (when, club)
            if info.get("competitionTypeId") not in LEAGUE_TYPES:
                continue
            stats = game["statistics"]
            general = stats.get("generalStatistics") or {}
            playing = stats.get("playingTimeStatistics") or {}
            state = general.get("participationState")
            a = agg[(fc, season)]
            a["n"] += 1
            a["it1"] += comp == "IT1"
            a["top5"] += comp in TOP5
            clubs[(fc, season)][club] += 1
            if state == "played":
                a["start" if playing.get("isStarting") else "sub"] += 1
                a["minutes"] += playing.get("playedMinutes") or 0
            elif state == "in squad":
                a["bench"] += 1
            elif state == "injured":
                a["inj"] += 1
            elif state == "absent":
                a["susp" if general.get("absenceId") in SUSPENSION else "other"] += 1
            else:
                a["out"] += 1
    return agg, clubs, {key: club for key, (_, club) in first.items()}, europe


def engine_rows(conn: sqlite3.Connection):
    """The engine's pre-season prediction of T1 and T2, as the gate builds it."""
    platform, game = "default", "classic"
    prepared = {k: evaluate.prepared_window(conn, features.window(k), platform, game) for k in features.WINDOWS}
    prepared = {k: d for k, d in prepared.items() if evaluate._window_is_usable(d, platform)}
    fitted = {k: evaluate.fit_params(d, ("R0", *evaluate.CANDIDATES)) for k, d in prepared.items()}
    adopted = ("R0", *evaluate.ADOPTED[platform])
    out = []
    for key in ("T1", "T2"):
        data = prepared[key]
        scoring = evaluate.pool_params(fitted, key, fitted[features.cross_fit_source(key, tuple(prepared))])
        preds = {p.obs.fc_id: p for p in evaluate.predict_window(data, adopted, None, scoring)}
        for obs in data.observations:
            if obs.pv_act is None:
                continue
            p = preds.get(obs.fc_id)
            out.append({"window": key, "fc_id": obs.fc_id, "name": obs.name, "role": obs.role_classic,
                        "club_change": bool(obs.club_change), "N": float(data.matchdays_target),
                        "pa_engine": None if p is None or p.pv_pred is None else round(p.pv_pred, 1),
                        "pa_actual": float(obs.pv_act)})
    return out


def available(a) -> float:
    return a["n"] - a["inj"] - a["susp"] - a["other"]


def parts(r, p):
    a1, a2 = r["a1"], r["a2"]
    n = a1["n"] + (p["w2"] * a2["n"] if a2 else 0)
    free = available(a1) + (p["w2"] * available(a2) if a2 else 0)
    d = (free + p["kD"] * p["Dbar"]) / (n + p["kD"])
    av1 = max(available(a1), 0)
    s_app = (a1["sub"] + a1["start"]) / av1 if av1 else 0
    s_min = a1["minutes"] / (90 * av1) if av1 else 0
    s_start = a1["start"] / av1 if av1 else 0
    s_raw = (1 - p["alpha"] - p["gamma"]) * s_app + p["alpha"] * s_min + p["gamma"] * s_start
    s = (av1 * s_raw + p["kS"] * p["Sbar"][r["ctx"]]) / (av1 + p["kS"])
    s *= (1 - p["b"] * r["eout"]) / (1 - p["b"] * r["ein"])
    if r["mv"] is not None and r["ctx"] != "portiere":
        s *= 1 + p["q"] * (r["mv"] - 6.0)
    return d, min(s, 1.0)


def predict(r, p) -> float:
    if r["a1"] is None:
        return r["N"] * p["none"]
    d, s = parts(r, p)
    return r["N"] * d * s * p["c"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(REPO / "data" / "euroleghe.db"))
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    agg, clubs, first_club, europe = breakdown(conn, REPO / "data" / "cache")
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    rows = engine_rows(conn)
    for r in rows:
        target = TARGET[r["window"]]
        one, two = PREV[target], PREV[PREV[target]]
        a1, a2 = agg.get((r["fc_id"], one)), agg.get((r["fc_id"], two))
        r["a1"] = a1 if a1 and a1["n"] else None
        r["a2"] = a2 if a2 and a2["n"] else None
        if r["a1"] is None:
            r["ctx"] = "nessuna"
        elif r["role"] == "P":
            r["ctx"] = "portiere"
        elif a1["it1"] >= a1["n"] / 2:
            r["ctx"] = "serie A, cambio club" if r["club_change"] else "serie A, stesso club"
        else:
            r["ctx"] = "estero top5" if a1["top5"] >= a1["n"] / 2 else "altro campionato"
        held = clubs.get((r["fc_id"], one))
        main_club = max(held.items(), key=lambda kv: kv[1])[0] if held else None
        r["ein"] = 1.0 if main_club and (main_club, one) in europe else 0.0
        r["eout"] = 1.0 if (first_club.get((r["fc_id"], target)), target) in europe else 0.0
        r["mv"] = mv.get((r["fc_id"], one))

    fit = [r for r in rows if r["window"] == "T1"]
    p = {"Dbar": mean(available(r["a1"]) / r["a1"]["n"] for r in fit if r["a1"]),
         "none": mean(r["pa_actual"] / r["N"] for r in fit if r["ctx"] == "nessuna"),
         "Sbar": {ctx: mean([min(1, r["pa_actual"] / r["N"]) for r in fit if r["ctx"] == ctx] or [0.5])
                  for ctx in CONTEXTS[:-1]},
         "kD": 40, "w2": 0.5, "alpha": 0.5, "gamma": 0.0, "q": 0.0, "kS": 20, "b": 0.0, "c": 1.0}
    mae = lambda group, params: mean(abs(predict(r, params) - r["pa_actual"]) for r in group)  # noqa: E731
    for _ in range(4):
        for key, values in GRID.items():
            p[key] = min(values, key=lambda v: mae(fit, {**p, key: v}))

    summary = {}
    for window in ("T1", "T2"):
        both = [r for r in rows if r["window"] == window and r["pa_engine"] is not None]
        summary[window] = {
            "target": TARGET[window], "fitted_on": "T1", "out_of_sample": window != "T1", "n": len(both),
            "mae_formula": round(mae(both, p), 3),
            "mae_engine": round(mean(abs(r["pa_engine"] - r["pa_actual"]) for r in both), 3),
            "median_formula": round(median(abs(predict(r, p) - r["pa_actual"]) for r in both), 2),
            "median_engine": round(median(abs(r["pa_engine"] - r["pa_actual"]) for r in both), 2),
        }
    out_rows = []
    for r in rows:
        a1, a2 = r["a1"], r["a2"]
        d, s = parts(r, p) if a1 else (None, None)
        out_rows.append({
            "window": r["window"], "target": TARGET[r["window"]], "fcId": r["fc_id"], "name": r["name"],
            "role": r["role"], "context": r["ctx"], "clubChange": r["club_change"],
            "europeIn": bool(r["ein"]), "europeOut": bool(r["eout"]), "mv": r["mv"],
            "prev": None if not a1 else {k: int(a1[k]) for k in
                                         ("n", "inj", "susp", "other", "out", "bench", "sub", "start", "minutes")},
            "prev2": None if not a2 else {k: int(a2[k]) for k in ("n", "inj", "susp", "other")},
            "d": None if d is None else round(d, 3), "s": None if s is None else round(s, 3),
            "paFormula": round(predict(r, p), 1), "paEngine": r["pa_engine"], "paActual": r["pa_actual"],
        })
    result = {
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "formula": "Pa = N x D x S x europa x c",
        "params": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in p.items() if k != "Sbar"},
        "priors": {k: round(v, 3) for k, v in p["Sbar"].items()},
        "summary": summary, "rows": out_rows,
    }
    target = Path(args.out) if args.out else max((REPO / "data" / "export").iterdir(),
                                                 key=lambda d: d.name) / "presence_test.json"
    target.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    for window, s in summary.items():
        print(f"{window} -> {s['target']} ({'fuori campione' if s['out_of_sample'] else 'taratura'}): "
              f"n {s['n']}, formula {s['mae_formula']}, motore {s['mae_engine']}")
    print(f"{len(out_rows)} righe in {target}")


if __name__ == "__main__":
    main()
