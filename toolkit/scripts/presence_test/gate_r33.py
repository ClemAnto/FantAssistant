"""THE GATE OF R33 (gate-motore-v1.md §7-septsexagies): the September presences of the bench against the engine.

Read-only on the DB. The engine's side is the adopted set of `default`, scored the way the gate scores the in-season
windows (each fitted, pooled and cross-fitted among the September ones); the candidate is the SAME predictions with
`pv_pred` replaced by the bench's September formula (`build.py`, frozen at the pre-registration commit), so the
auction lists, which read `value_pred` = f(fm, pv), follow by themselves.

Judged: the seven 5 September windows (2019-20 -> 2025-26), all quoted men, common sample - the primary verdict -
plus two declared readings (Qt.I above 5, and without the unforeseen long injuries), and the clean window, 5 September
2026, with the rounds played since.

R33b (§7-octsexagies, congelata il 01/10/2026 e giudicata SOLO in avanti sul 2026-27): `--r33b` tara il prior sui
quotati sopra 5 e applica la regola solo a loro; sotto, le presenze restano quelle del motore.

    python toolkit/scripts/presence_test/gate_r33.py [--r33b] [--out FILE]
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import sqlite3
import sys
from pathlib import Path
from statistics import mean

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
import build as B  # noqa: E402
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.engine import evaluate, features, model  # noqa: E402

CLEAN = features.Window("I26set", "2025-26", "2026-27", "2026-09-05")


def row_of(obs, key: str, window, data) -> dict:
    return {"window": key, "input": window.input_season, "target": window.target_season,
            "auction": window.auction_date, "fc_id": obs.fc_id, "name": obs.name, "role": obs.role_classic,
            "club_change": bool(obs.club_change), "club_prev": obs.club_prev, "club_target": obs.club_target,
            "N": float(data.matchdays_target), "seen": int(data.matchdays_seen or 0), "pv_seen": obs.pv_seen,
            "pa_actual": float(obs.pv_act) if obs.pv_act is not None else None,
            "price_initial": obs.price_initial}


def mae(pairs):
    return mean(abs(p - a) for p, a in pairs) if pairs else None


def main() -> None:
    parser = argparse.ArgumentParser()
    config = Config()
    parser.add_argument("--db", default=str(config.db_path))
    parser.add_argument("--out", default=None)
    parser.add_argument("--r33b", action="store_true")
    args = parser.parse_args()
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    dates, spells, games = B.league_dates(conn), B.open_spells(conn), B.league_games(conn)

    # The formula's prior: fitted on the July windows, everybody in (no price filter), like the rule says.
    july = B.engine_rows(conn, B.july_windows(), keep_cheap=not args.r33b)
    for r in july:
        r["injury"] = B.injury_group(r, dates, spells)
    B.annotate(july, agg, at_club, clubs, first, europe, mv)
    k_key = next(k for k in evaluate.ADOPTED[B.PLATFORM] if k in evaluate.R20_ROUNDS)
    k_rounds = evaluate.R20_ROUNDS[k_key]
    priors: dict[str, dict] = {}
    tables: dict[str, list] = {}

    def formula(r) -> float:
        if r["target"] not in priors:
            priors[r["target"]] = B.fit([x for x in july if x["target"] != r["target"]], keeper_line=False)
            tables[r["target"]] = B.residual_table(conn, f"{r['target'][:4]}-07-01")
        prior = B.share(r, priors[r["target"]])
        chosen = (model.blend_with_seen(prior, r["pv_seen"] / r["seen"], r["seen"], k_rounds)
                  if r["seen"] and r["pv_seen"] is not None else prior)
        out = B.expected_out(r, games, spells, tables[r["target"]])
        return max(r["N"] - out, 0.0) * chosen

    # The engine, as the gate builds the in-season windows; the clean one scored with its earlier neighbour.
    windows = B.september_windows()
    prepared = {k: evaluate.prepared_window(conn, w, B.PLATFORM, B.GAME) for k, w in windows.items()}
    prepared = {k: d for k, d in prepared.items() if evaluate._window_is_usable(d, B.PLATFORM)}
    fitted = {k: evaluate.fit_params(d, ("R0", *evaluate.CANDIDATES)) for k, d in prepared.items()}
    adopted = ("R0", *evaluate.ADOPTED[B.PLATFORM])
    judged = {k: (windows[k], d, evaluate.pool_params(
        fitted, k, fitted[features.cross_fit_source(k, tuple(prepared))])) for k, d in prepared.items()}
    clean = evaluate.prepared_window(conn, CLEAN, B.PLATFORM, B.GAME)
    judged[CLEAN.key] = (CLEAN, clean, evaluate.pool_params(fitted, CLEAN.key, fitted[list(prepared)[-1]]))

    report: dict = {"rule": "R33b" if args.r33b else "R33", "k": k_rounds, "windows": {}}
    for key, (window, data, params) in judged.items():
        base = [p for p in evaluate.predict_window(data, adopted, None, params)]
        cand = []
        rows = {}
        for p in base:
            r = row_of(p.obs, key, window, data)
            r["injury"] = B.injury_group(r, dates, spells)
            rows[p.obs.fc_id] = r
        B.annotate(list(rows.values()), agg, at_club, clubs, first, europe, mv)
        for p in base:
            priced = p.obs.price_initial is None or p.obs.price_initial > B.MAX_CHEAP_PRICE
            applies = p.pv_pred is not None and (priced or not args.r33b)
            cand.append(dataclasses.replace(p, pv_pred=formula(rows[p.obs.fc_id])) if applies else p)
        pairs = [(b, c) for b, c in zip(base, cand) if b.pv_pred is not None and b.obs.pv_act is not None]

        def score(keep) -> dict:
            chosen = [(b, c) for b, c in pairs if keep(rows[b.obs.fc_id])]
            before = mae([(b.pv_pred, b.obs.pv_act) for b, _ in chosen])
            after = mae([(c.pv_pred, c.obs.pv_act) for _, c in chosen])
            return {"n": len(chosen), "engine": before, "r33": after,
                    "gain": (before - after) / before if before else None}
        view_b, view_c = evaluate.auction_view(data, base), evaluate.auction_view(data, cand)
        entry = {
            "target": window.target_season, "seen": int(data.matchdays_seen or 0),
            "rounds": int(data.matchdays_target),
            "all": score(lambda r: True),
            "priced_above_5": score(lambda r: r["price_initial"] is None or r["price_initial"] > B.MAX_CHEAP_PRICE),
            "no_unforeseen": score(lambda r: r.get("injury") != "unforeseen"),
            # THE BENCH'S OWN POPULATION (quoted above 5, the unforeseen long injuries apart): the line that has to
            # reproduce `build.py` before any other number of this driver is believed.
            "bench": score(lambda r: (r["price_initial"] is None or r["price_initial"] > B.MAX_CHEAP_PRICE)
                           and r.get("injury") != "unforeseen"),
            "names": (sum(v["hits"] for v in view_b.values()), sum(v["hits"] for v in view_c.values())),
            "value": (round(sum(v.get("captured_value") or 0 for v in view_b.values()), 1),
                      round(sum(v.get("captured_value") or 0 for v in view_c.values()), 1)),
        }
        report["windows"][key] = entry
        print(f"{key} -> {entry['target']} (viste {entry['seen']}, da giocare {entry['rounds']}): tutti "
              f"{entry['all']['engine']:.3f} -> {entry['all']['r33']:.3f} ({entry['all']['gain']:+.2%}) · Qt.I>5 "
              f"{entry['priced_above_5']['gain']:+.2%} · senza imprevedibili {entry['no_unforeseen']['gain']:+.2%} · "
              f"nomi {entry['names'][0]} -> {entry['names'][1]} · valore {entry['value'][0]} -> {entry['value'][1]}",
              flush=True)

    history = {k: v for k, v in report["windows"].items() if k != CLEAN.key}
    for reading in ("all", "priced_above_5", "no_unforeseen", "bench"):
        gains = [v[reading]["gain"] for v in history.values()]
        names_b = sum(v["names"][0] for v in history.values())
        names_a = sum(v["names"][1] for v in history.values())
        value_b = sum(v["value"][0] for v in history.values())
        value_a = sum(v["value"][1] for v in history.values())
        verdict = {"windows": len(gains), "wins": sum(g > 0 for g in gains), "mean_gain": round(mean(gains), 4),
                   "worst": round(min(gains), 4), "names": (names_b, names_a),
                   "value_change": round((value_a - value_b) / value_b, 4)}
        verdict["robust"] = (verdict["wins"] > len(gains) / 2 and verdict["mean_gain"] > B.FLOOR
                             and verdict["worst"] > B.TOLERANCE and names_a >= 0.98 * names_b
                             and value_a >= 0.98 * value_b)
        verdict["strict"] = verdict["robust"] and all(g > 0 for g in gains)
        report[f"verdict_{reading}"] = verdict
        print(f"verdetto {reading}: {verdict}")
    out = (Path(args.out) if args.out
           else config.data_dir / "reports" / f"gate_{'r33b' if args.r33b else 'r33'}.json")
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False, default=float), encoding="utf-8")
    print(f"-> {out}")


if __name__ == "__main__":
    main()
