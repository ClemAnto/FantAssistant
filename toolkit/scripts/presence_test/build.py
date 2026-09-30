"""THE EXPECTED APPEARANCES, REBUILT FROM THEIR PARTS - a test bench, not an engine rule (30/09/2026, v2 01/10).

The operator's request: split every past season into the reasons a man did or did not get a vote - injured,
suspended, absent for another reason, not called, on the bench, came on, started - and predict next season's
appearances as a product of those parts, so each part can be re-tuned on its own:

    Pa = N x D_hat x S_hat x europe x c                       (every role, goalkeepers included)

    D_hat   availability over two seasons (the older weighted w2), pulled toward the ROLE's Dbar by kD (see `CELL_MIN`);
    S_hat   chosen when available: (1 - alpha - gamma) x share of games played + alpha x share of minutes
            + gamma x share of starts, pulled toward its ROLE's prior INSIDE its context by kS; x (1 + q (mv - 6)), the quality;
    europe  (1 - b x Eout) / (1 - b x Ein): the club of the predicted season plays a European cup (main phase),
            and the club of the measured one did. Eout is read from the predicted season's own games (his first
            club there), which at the auction is known for the Champions League and not always for the Europa
            and Conference play-offs, nor for a man sold on 31 August: a small advantage the engine's
            pre-season number does not have, and it is stated rather than hidden;
    c       one scale.

THE KEEPER LINE (v2), MEASURED AND REFUSED: a club fields ONE keeper, so a line of their own (R7's form, with the
same functions `fitting.fit_linear` + `model.linear_share`, on the share of games with a vote and the club change)
was the obvious candidate. On the keepers it is worse than the plain product on 10 windows of 10 (-12.9%), while
the product with the role's priors beats the engine's R7 on 7 of 10 (+2.9%, worst -7.8%). `fit(keeper_line=True)`
stays, so the reading is re-run every time the bench is.

THE SOURCE, v2: `tm_appearances`, which since 30/09/2026 carries the absence reason, the start, the coach and the
competition type (`performance --from-cache`, zero requests). v1 read the cache files directly because the parser
dropped those fields; one reader of one fact now. 1, 2 and 3 of `absence_id` are the three suspensions.

THE PROTOCOL, v2: every pre-season window of the gate (Tm7 -> T2), each JUDGED with parameters fitted on the other
nine (leave one window out), against the engine's own pre-season prediction of that window built the way the gate
builds it (every window fitted, the judged one scored with its neighbour's parameters). v1's split - fit on T1,
judge T2 - is printed first as a reproduction line, because a bench is checked on the numbers it has already
published before it judges anything.

THE BLEND, v2: on the gate's in-season windows (`features.INSEASON_WINDOWS`, 5 September and 5 February) the
formula's pre-season share - fitted on the pre-season windows whose target is NOT that season, or it would have
read the outcome - is blended with the rounds already played by the engine's own function
(`model.blend_with_seen`) at the engine's own K (the R20 key in `evaluate.ADOPTED["default"]`), and judged on the
rounds that remain against the engine's in-season prediction.

Writes `presence_test.json` into the newest export folder (or `--out`), which `app/scripts/pull-bundle.mjs` copies
for the /why page. The file carries names and paid numbers: it lives under data/, never in the repository.

    python toolkit/scripts/presence_test/build.py [--db PATH] [--out FILE] [--no-inseason]
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
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.engine import evaluate, features, model, status  # noqa: E402
from euroleghe_ingest.engine.fitting import fit_linear  # noqa: E402

PLATFORM, GAME = "default", "classic"
SUSPENSION = {1, 2, 3}
EUROPE = {"CL", "EL", "UCOL"}
TOP5 = {"IT1", "GB1", "ES1", "L1", "FR1"}
LEAGUE_TYPES = (1, 2)          # Transfermarkt's first and second divisions; cups and youth are other types
SAMPLE_PER_CELL = 2
CONTEXTS = ("serie A, stesso club", "serie A, cambio club", "estero top5", "altro campionato", "portiere", "nessuna")
GRID = {
    "kD": [0, 20, 40, 80, 160, 320, 640], "w2": [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0],
    "alpha": [0, 0.25, 0.5, 0.75, 1.0], "gamma": [0, 0.1, 0.2, 0.3, 0.5],
    "q": [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.5], "kS": [0, 5, 10, 20, 40, 80, 160],
    "b": [-0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.3], "c": [0.85, 0.9, 0.95, 1.0, 1.05, 1.1],
}
# The gate's own thresholds for the two verdicts, so the bench speaks the gate's vocabulary.
FLOOR, TOLERANCE = 0.005, -0.02
K_READING = (3, 6, 10, 15, 25, 40)


def previous(season: str) -> str:
    start = int(season[:4]) - 1
    return f"{start}-{str(start + 1)[-2:]}"


def breakdown(conn: sqlite3.Connection):
    """Per (fc_id, season): the league seasons summed, the clubs, the first club, and the clubs in Europe."""
    agg: dict = defaultdict(lambda: defaultdict(float))
    clubs: dict = defaultdict(lambda: defaultdict(float))
    first: dict = {}
    europe: set = set()
    for club, season in conn.execute(
            f"SELECT DISTINCT club_id, season FROM tm_appearances WHERE is_national = 0 "
            f"AND competition IN ({','.join('?' * len(EUROPE))})", tuple(EUROPE)):
        europe.add((club, season))
    for fc, season, club in conn.execute(
            """SELECT fc_id, season, club_id FROM (
                   SELECT fc_id, season, club_id,
                          ROW_NUMBER() OVER (PARTITION BY fc_id, season ORDER BY played_on) AS k
                   FROM tm_appearances WHERE is_national = 0 AND season IS NOT NULL) WHERE k = 1"""):
        first[(fc, season)] = club
    for fc, season, comp, club, state, start, minutes, absence in conn.execute(
            f"""SELECT fc_id, season, competition, club_id, state, is_starting, minutes, absence_id
                FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(LEAGUE_TYPES))})""", LEAGUE_TYPES):
        a = agg[(fc, season)]
        a["n"] += 1
        a["it1"] += comp == "IT1"
        a["top5"] += comp in TOP5
        clubs[(fc, season)][club] += 1
        if state == "played":
            a["start" if start else "sub"] += 1
            a["minutes"] += minutes or 0
        elif state == "in squad":
            a["bench"] += 1
        elif state == "injured":
            a["inj"] += 1
        elif state == "absent":
            a["susp" if absence in SUSPENSION else "other"] += 1
        else:
            a["out"] += 1
    return agg, clubs, first, europe


def clubs_elsewhere(conn: sqlite3.Connection) -> tuple[dict, dict]:
    """Where a man played a season the gate's `club_prev` does not name (it is a Serie A roster fact).

    Two sources, in order, for DISPLAY only: the club he played most matches for in the per-match layer (the
    provider's spelling, «AC Milan» and not «Milan», which is a name to read and never a key to join on), and
    the club a transfer of that summer says he came FROM (`transfers_history`, dated 1 July from 2023). What
    neither knows stays a dash: a man with no season anywhere has no club to name.
    """
    played: dict = {}
    for fc, season, club, n in conn.execute(
            "SELECT fc_id, season, club, COUNT(*) FROM external_match_stats WHERE club IS NOT NULL GROUP BY 1, 2, 3"):
        if n > played.get((fc, season), (None, 0))[1]:
            played[(fc, season)] = (club, n)
    came_from = {(fc, int(day[:4])): club for fc, day, club in conn.execute(
        "SELECT fc_id, date, from_club FROM transfers_history WHERE from_club IS NOT NULL")}
    return {key: club for key, (club, _n) in played.items()}, came_from


def engine_rows(conn: sqlite3.Connection, keys: tuple[str, ...]):
    """The engine's prediction of each window, as the gate builds it (in-season windows pair among themselves)."""
    prepared = {k: evaluate.prepared_window(conn, features.window(k), PLATFORM, GAME) for k in keys}
    prepared = {k: d for k, d in prepared.items() if evaluate._window_is_usable(d, PLATFORM)}
    fitted = {k: evaluate.fit_params(d, ("R0", *evaluate.CANDIDATES)) for k, d in prepared.items()}
    adopted = ("R0", *evaluate.ADOPTED[PLATFORM])
    out = []
    for key, data in prepared.items():
        scoring = evaluate.pool_params(fitted, key, fitted[features.cross_fit_source(key, tuple(prepared))])
        preds = {p.obs.fc_id: p for p in evaluate.predict_window(data, adopted, None, scoring)}
        window = features.window(key)
        for obs in data.observations:
            if obs.pv_act is None:
                continue
            p = preds.get(obs.fc_id)
            out.append({"window": key, "input": window.input_season, "target": window.target_season,
                        "fc_id": obs.fc_id, "name": obs.name, "role": obs.role_classic,
                        "club_change": bool(obs.club_change),
                        "club_prev": obs.club_prev, "club_target": obs.club_target, "N": float(data.matchdays_target),
                        "seen": int(data.matchdays_seen or 0),
                        "pv_seen": obs.pv_seen,
                        "pa_engine": None if p is None or p.pv_pred is None else round(p.pv_pred, 1),
                        "pa_actual": float(obs.pv_act)})
    return out


def available(a) -> float:
    return a["n"] - a["inj"] - a["susp"] - a["other"]


def keeper_input(r) -> tuple[float, float]:
    a1 = r["a1"]
    return ((a1["sub"] + a1["start"]) / a1["n"], 1.0 if r["club_change"] else 0.0)


def parts(r, p):
    a1, a2 = r["a1"], r["a2"]
    n = a1["n"] + (p["w2"] * a2["n"] if a2 else 0)
    free = available(a1) + (p["w2"] * available(a2) if a2 else 0)
    d = (free + p["kD"] * prior(p, "Dbar", r)) / (n + p["kD"])
    av1 = max(available(a1), 0)
    s_app = (a1["sub"] + a1["start"]) / av1 if av1 else 0
    s_min = a1["minutes"] / (90 * av1) if av1 else 0
    s_start = a1["start"] / av1 if av1 else 0
    s_raw = (1 - p["alpha"] - p["gamma"]) * s_app + p["alpha"] * s_min + p["gamma"] * s_start
    # A season spent entirely out (injured, suspended) says nothing about being chosen: the prior answers.
    s_bar = prior(p, "Sbar", r)
    s = (av1 * s_raw + p["kS"] * s_bar) / (av1 + p["kS"]) if av1 + p["kS"] else s_bar
    s *= (1 - p["b"] * r["eout"]) / (1 - p["b"] * r["ein"])
    mv = r["mv"] if r["mv"] is not None or not p["by_role"] else prior(p, "MVbar", r)
    if mv is not None and r["ctx"] != "portiere":
        s *= 1 + p["q"] * (mv - 6.0)
    return d, min(s, 1.0)


def rung(play_share: float | None, minutes: float | None) -> str | None:
    """The six-word ladder (`engine/status.py`) on its two axes, WITHOUT the board's gate.

    Operator, 01/10/2026: «inserire una colonna con il gradino-titolarità ricavato». The ladder's own function,
    not a copy, and one thing it cannot have here is stated rather than faked: a past window has no drawn
    board, so «is he in the typical eleven» is unknown. The two numbers decide alone - a top rung where they
    reach it (as if drawn), otherwise the rungs of a man the board does not draw. `play_share` is the share of
    the games he is FIT for that he gets a vote in, which is what S is, and `minutes` per game played.
    """
    if play_share is None:
        return None
    drawn = status.status_of(play_share, minutes, True)
    return drawn if drawn in status.LADDER[:3] else status.status_of(play_share, minutes, False)


def minutes_per_game(a) -> float | None:
    played = a["sub"] + a["start"] if a else 0
    return a["minutes"] / played if played else None


def share(r, p) -> float:
    """The predicted share of the calendar, before any round of the target season is known."""
    if r["a1"] is None:
        return prior(p, "none", r)
    if r["ctx"] == "portiere" and p.get("keeper"):
        return model.linear_share(p["keeper"], keeper_input(r))
    d, s = parts(r, p)
    return d * s * p["c"]


def predict(r, p) -> float:
    return r["N"] * share(r, p)


# «QUANDO NEI CALCOLI MANCANO DEI DATI UTILIZZIAMO SEMPRE LE MEDIE PER RUOLO IN QUELL'AMBITO» (operator,
# 01/10/2026). Every prior the formula falls back on - the availability a short record is pulled toward, the
# chance of being chosen, the share of a man with no season on file, and the base vote where he has none - is
# the mean of HIS ROLE inside HIS CONTEXT on the training rows. A cell thinner than `CELL_MIN` falls back to the
# context and then to everybody, and that is stated rather than hidden: a mean of three men is a coin.
CELL_MIN = 10


def cells(train, keep, value, by_role: bool, per_context: bool = True) -> dict:
    """Means per (role, context), per context and overall - the ladder `prior` walks down."""
    groups: dict = defaultdict(list)
    for r in train:
        if not keep(r):
            continue
        v = value(r)
        groups[("*", "*")].append(v)
        if per_context:
            groups[("*", r["ctx"])].append(v)
        if by_role:
            groups[(r["role"], r["ctx"] if per_context else "*")].append(v)
    return {key: (mean(vs), len(vs)) for key, vs in groups.items()}


def prior(p, name: str, r) -> float:
    table = p[name]
    ctx = r["ctx"] if ("*", r["ctx"]) in table else "*"
    for key in ((r["role"], ctx), ("*", ctx), ("*", "*")):
        if key in table and table[key][1] >= CELL_MIN:
            return table[key][0]
    return table[("*", "*")][0]


def fit(train: list[dict], *, keeper_line: bool = True, by_role: bool = True) -> dict:
    """Priors, the keeper line and the coordinate descent, all on `train` and nothing else."""
    p = {"by_role": by_role,
         "Dbar": cells(train, lambda r: r["a1"] is not None, lambda r: available(r["a1"]) / r["a1"]["n"],
                       by_role, per_context=False),
         "none": cells(train, lambda r: r["ctx"] == "nessuna", lambda r: r["pa_actual"] / r["N"], by_role),
         "Sbar": cells(train, lambda r: r["ctx"] != "nessuna", lambda r: min(1, r["pa_actual"] / r["N"]),
                       by_role),
         "MVbar": cells(train, lambda r: r["mv"] is not None, lambda r: r["mv"], True),
         "kD": 40, "w2": 0.5, "alpha": 0.5, "gamma": 0.0, "q": 0.0, "kS": 20, "b": 0.0, "c": 1.0,
         "keeper": None}
    if keeper_line:
        p["keeper"] = fit_linear([(keeper_input(r), r["pa_actual"] / r["N"])
                                  for r in train if r["ctx"] == "portiere"])
    # The outfield descent never sees a keeper once the line exists, or the grid would tune D and S to
    # rescue rows the line already answers.
    outfield = [r for r in train if not (p["keeper"] and r["ctx"] == "portiere")]
    for _ in range(4):
        for key, values in GRID.items():
            p[key] = min(values, key=lambda v: mae(outfield, {**p, key: v}))
    return p


def mae(group, params) -> float:
    return mean(abs(predict(r, params) - r["pa_actual"]) for r in group)


def ratio(pred: float | None, actual: float) -> float | None:
    # Predicted over REAL (operator, 30/09/2026): 100% exact, 50% he played twice what was expected, 200%
    # he played half. A man who played nothing has no ratio: any prediction over zero is infinitely off.
    return None if pred is None or actual <= 0 else pred / actual


def band_share(values) -> float:
    known = [v for v in values if v is not None]
    return round(sum(0.8 <= v <= 1.25 for v in known) / len(known), 3) if known else 0.0


def scored(rows: list[dict], pred) -> dict:
    """Formula (`pred(row)`) against the engine on the rows where the engine has a number."""
    both = [r for r in rows if r["pa_engine"] is not None]
    formula = [pred(r) for r in both]
    f_mae = mean(abs(f - r["pa_actual"]) for f, r in zip(formula, both))
    e_mae = mean(abs(r["pa_engine"] - r["pa_actual"]) for r in both)
    f_ratio = [ratio(f, r["pa_actual"]) for f, r in zip(formula, both)]
    e_ratio = [ratio(r["pa_engine"], r["pa_actual"]) for r in both]
    return {"n": len(both), "mae_formula": round(f_mae, 3), "mae_engine": round(e_mae, 3),
            "gain": round((e_mae - f_mae) / e_mae, 4),
            "median_ratio_formula": round(median(v for v in f_ratio if v is not None), 3),
            "median_ratio_engine": round(median(v for v in e_ratio if v is not None), 3),
            "within20_formula": band_share(f_ratio), "within20_engine": band_share(e_ratio)}


def verdict(gains: list[float]) -> dict:
    """The gate's two verdicts on a list of per-window gains (positive = the formula is better)."""
    mean_gain = mean(gains)
    wins = sum(g > 0 for g in gains)
    return {"windows": len(gains), "wins": wins, "mean_gain": round(mean_gain, 4),
            "worst": round(min(gains), 4),
            "strict": all(g > 0 for g in gains) and mean_gain > FLOOR,
            "robust": wins > len(gains) / 2 and mean_gain > FLOOR and min(gains) > TOLERANCE}


def annotate(rows, agg, clubs, first, europe, mv) -> None:
    for r in rows:
        one, two = r["input"], previous(r["input"])
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
        r["eout"] = 1.0 if (first.get((r["fc_id"], r["target"])), r["target"]) in europe else 0.0
        r["mv"] = mv.get((r["fc_id"], one))
        nxt = agg.get((r["fc_id"], r["target"]))
        r["a_next"] = nxt if nxt and nxt["n"] else None
        fit_for = available(nxt) if r["a_next"] else 0
        r["s_actual"] = (nxt["sub"] + nxt["start"]) / fit_for if fit_for > 0 else None


def main() -> None:
    parser = argparse.ArgumentParser()
    # The project's own paths (`EUROLEGHE_DB_PATH`, `EUROLEGHE_DATA_DIR`), so a worktree reads the real DB.
    config = Config()
    parser.add_argument("--db", default=str(config.db_path))
    parser.add_argument("--out", default=None)
    parser.add_argument("--no-inseason", dest="inseason", action="store_false")
    args = parser.parse_args()
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    agg, clubs, first, europe = breakdown(conn)
    played_for, came_from = clubs_elsewhere(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    rows = engine_rows(conn, tuple(features.WINDOWS))
    annotate(rows, agg, clubs, first, europe, mv)
    windows = [k for k in features.WINDOWS if any(r["window"] == k for r in rows)]
    by_window = {k: [r for r in rows if r["window"] == k] for k in windows}

    # 1. THE REPRODUCTION of v1's published split (fit T1, judge T2): v1's priors (per context), no keeper line.
    p_v1 = fit(by_window["T1"], keeper_line=False, by_role=False)
    repro = {k: scored(by_window[k], lambda r: predict(r, p_v1)) for k in ("T1", "T2")}
    print(f"[v1] fit T1: T1 {repro['T1']['mae_formula']} / {repro['T1']['mae_engine']} · "
          f"T2 {repro['T2']['mae_formula']} / {repro['T2']['mae_engine']}")

    # 2. LEAVE ONE WINDOW OUT. The formula is the operator's (priors per role inside the context); beside it the
    # two readings it is compared with: v1's priors per context only, and the keeper line.
    folds: dict[str, dict] = {}
    params_by_fold: dict[str, dict] = {}
    for key in windows:
        train = [r for r in rows if r["window"] != key]
        p_main = fit(train, keeper_line=False)
        p_ctx = fit(train, keeper_line=False, by_role=False)
        p_line = fit(train, keeper_line=True)
        params_by_fold[key] = p_main
        judged = by_window[key]
        keepers = [r for r in judged if r["ctx"] == "portiere"]
        folds[key] = {"target": features.window(key).target_season,
                      **scored(judged, lambda r, p=p_main: predict(r, p)),
                      "context_priors": scored(judged, lambda r, p=p_ctx: predict(r, p)),
                      "keeper_line": scored(keepers, lambda r, p=p_line: predict(r, p)),
                      "keepers": scored(keepers, lambda r, p=p_main: predict(r, p)),
                      "params": {k: v for k, v in p_main.items() if k in GRID}}
        f = folds[key]
        print(f"{key} -> {f['target']}: n {f['n']}, formula {f['mae_formula']} (priori per contesto "
              f"{f['context_priors']['mae_formula']}), motore {f['mae_engine']}, guadagno {f['gain']:+.2%}; "
              f"portieri {f['keepers']['mae_formula']} con la retta {f['keeper_line']['mae_formula']} "
              f"motore {f['keepers']['mae_engine']}")
    lowo = {"formula": verdict([f["gain"] for f in folds.values()]),
            "context_priors": verdict([f["context_priors"]["gain"] for f in folds.values()]),
            "role_vs_context": verdict([
                (f["context_priors"]["mae_formula"] - f["mae_formula"]) / f["context_priors"]["mae_formula"]
                for f in folds.values()]),
            "keepers_vs_engine": verdict([f["keepers"]["gain"] for f in folds.values()]),
            "keeper_line_vs_formula": verdict([
                (f["keepers"]["mae_formula"] - f["keeper_line"]["mae_formula"]) / f["keepers"]["mae_formula"]
                for f in folds.values()])}
    # Every rung of the grid chosen fold by fold: a parameter on the edge of its grid is not adopted.
    edges = {k: sorted({params_by_fold[w][k] for w in windows}) for k in GRID}
    for name, v in lowo.items():
        print(f"LOWO {name}: {v}")
    print(f"parametri per piega: {edges}")

    # 3. THE BLEND with the rounds already played, on the in-season windows.
    inseason = {}
    in_rows: list[dict] = []
    if args.inseason:
        in_rows = engine_rows(conn, tuple(features.INSEASON_WINDOWS))
        annotate(in_rows, agg, clubs, first, europe, mv)
        k_key = next(k for k in evaluate.ADOPTED[PLATFORM] if k in evaluate.R20_ROUNDS)
        k_adopted = evaluate.R20_ROUNDS[k_key]
        priors: dict[str, dict] = {}
        for r in in_rows:
            if r["target"] not in priors:
                priors[r["target"]] = fit([x for x in rows if x["target"] != r["target"]], keeper_line=False)
        def blended(r, k_prior: float) -> float:
            prior = share(r, priors[r["target"]])
            if not r["seen"] or r["pv_seen"] is None:
                return r["N"] * prior
            return r["N"] * model.blend_with_seen(prior, r["pv_seen"] / r["seen"], r["seen"], k_prior)
        for key in features.INSEASON_WINDOWS:
            judged = [r for r in in_rows if r["window"] == key]
            if not judged:
                continue
            inseason[key] = {"target": features.window(key).target_season, "seen": judged[0]["seen"],
                             **scored(judged, lambda r: blended(r, k_adopted)),
                             "prior_only": scored(judged, lambda r: r["N"] * share(r, priors[r["target"]])),
                             "by_k": {k: scored(judged, lambda r, k=k: blended(r, k))["mae_formula"]
                                      for k in K_READING}}
            i = inseason[key]
            print(f"{key} (viste {i['seen']}): formula {i['mae_formula']} (senza miscela "
                  f"{i['prior_only']['mae_formula']}), motore {i['mae_engine']}, guadagno {i['gain']:+.2%}")
        inseason_verdict = verdict([i["gain"] for i in inseason.values()])
        print(f"in-season, K {k_adopted:g} ({k_key}): {inseason_verdict}")
    else:
        inseason_verdict, k_key, k_adopted = None, None, None

    # THE SAMPLE the page shows (operator: «inutile che mostri tutti, un campione ampio variegato»): up to two men
    # per (role, context, band of real appearances), chosen by a fixed hash of the id so it is the same on every run
    # and nobody picked the names.
    def band(actual: float) -> str:
        return "0" if actual <= 0 else "1-9" if actual < 10 else "10-19" if actual < 20 else "20-29" if actual < 30 else "30+"
    sampled: set = set()
    for key in windows:
        cells: dict = defaultdict(list)
        for r in by_window[key]:
            cells[(r["role"], r["ctx"], band(r["pa_actual"]))].append(r)
        for members in cells.values():
            for r in sorted(members, key=lambda one: (one["fc_id"] * 2654435761) % 2**32)[:SAMPLE_PER_CELL]:
                sampled.add((key, r["fc_id"]))
    out_rows = []
    for r in rows:
        a1, a2 = r["a1"], r["a2"]
        p = params_by_fold[r["window"]]
        d, s = parts(r, p) if a1 and not (p["keeper"] and r["ctx"] == "portiere") else (None, None)
        out_rows.append({
            "window": r["window"], "target": r["target"], "fcId": r["fc_id"], "name": r["name"],
            "role": r["role"], "context": r["ctx"], "clubChange": r["club_change"],
            "europeIn": bool(r["ein"]), "europeOut": bool(r["eout"]), "mv": r["mv"],
            "prev": None if not a1 else {k: int(a1[k]) for k in
                                         ("n", "inj", "susp", "other", "out", "bench", "sub", "start", "minutes")},
            "prev2": None if not a2 else {k: int(a2[k]) for k in ("n", "inj", "susp", "other")},
            "clubPrev": (r["club_prev"] or played_for.get((r["fc_id"], r["input"]))
                         or came_from.get((r["fc_id"], int(r["target"][:4])))),
            "clubNext": r["club_target"],
            "d": None if d is None else round(d, 3), "s": None if s is None else round(s, 3),
            # THE RUNG the formula's S gives him (minutes: the season measured - no forecast of minutes on this
            # bench, and saying so is the point), and the rung he really reached in the season predicted.
            "rung": rung(s, minutes_per_game(a1)),
            "rungActual": rung(r["s_actual"], minutes_per_game(r["a_next"])),
            "paFormula": round(predict(r, p), 1), "paEngine": r["pa_engine"], "paActual": r["pa_actual"],
            "sample": (r["window"], r["fc_id"]) in sampled,
        })
    summary = {key: {"target": f["target"], "fitted_on": "le altre finestre", "out_of_sample": True,
                     **{k: f[k] for k in ("n", "mae_formula", "mae_engine", "median_ratio_formula",
                                          "median_ratio_engine", "within20_formula", "within20_engine")},
                     "median_formula": round(median(abs(x["paFormula"] - x["paActual"])
                                                    for x in out_rows if x["window"] == key
                                                    and x["paEngine"] is not None), 2),
                     "median_engine": round(median(abs(x["paEngine"] - x["paActual"])
                                                   for x in out_rows if x["window"] == key
                                                   and x["paEngine"] is not None), 2),
                     "zero_actual": sum(x["paActual"] <= 0 for x in out_rows
                                        if x["window"] == key and x["paEngine"] is not None)}
               for key, f in folds.items()}
    result = {
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "formula": "Pa = N x D x S x europa x c",
        "protocol": "leave one window out",
        "params": {k: (round(v, 4) if isinstance(v, float) else v)
                   for k, v in params_by_fold["T2"].items() if k in GRID},
        # The page shows the cells the rule reads: one per role inside a context (the thinner ones fall back).
        "priors": {f"{role} {ctx}": round(v, 3) for (role, ctx), (v, n) in params_by_fold["T2"]["Sbar"].items()
                   if role != "*" and n >= CELL_MIN},
        "cellMin": CELL_MIN,
        "reproduction": repro, "verdict": lowo, "edges": edges,
        "inseason": {"k_rule": k_key, "k": k_adopted, "windows": inseason, "verdict": inseason_verdict},
        "summary": summary, "rows": out_rows,
    }
    exports = [d for d in (config.data_dir / "export").iterdir() if d.is_dir() and (d / "manifest.json").exists()]
    target = Path(args.out) if args.out else max(exports, key=lambda d: d.name) / "presence_test.json"
    target.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"campione: {sum(1 for row in out_rows if row['sample'])} righe; {len(out_rows)} righe in {target}")


if __name__ == "__main__":
    main()
