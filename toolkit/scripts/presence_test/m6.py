"""M6a-M6d (partite-attese-scomposte-v1.md §5-septies), judged at 5 September on the base of §5-octies.

Read-only. The adopted September formula (M1b + M4) on the bench's population after the operator's two decisions
(nobody out of Serie A on the day; a man who played nothing counts), each window with the prior fitted on the others,
and each variant against the same base. The criterion was written before the run: the share within 80-125% rises on
at least 5 windows of 7 and on average, and the mean error does not get worse on average.

* M6a - the starters of last season have a quality slope of their own (`q_top`);
* M6b - the rounds seen read the STARTS as well as the votes (the mean of the two shares, same K);
* M6c - from 32 the choice is multiplied by a fitted factor (`age_f`);
* M6d - a starter of last season whose rung was `panchina` or `ballottaggio` is pulled toward the `titolare` mean.

«Starter of last season» is the RAW share of the games he was fit for >= 0.6, not the formula's S, because S depends
on the parameter being fitted.

    python toolkit/scripts/presence_test/m6.py
"""
from __future__ import annotations

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
from euroleghe_ingest.engine import evaluate, model  # noqa: E402

VARIANTS = {
    "base": {},
    "M6a qualita' dei titolari": {"extra": ("q_top",)},
    "M6b partenze viste": {"starts_seen": True},
    "M6c eta' dai 32": {"extra": ("age_f",)},
    "M6d gradini bassi -> titolare": {"cls": "cls_m6d"},
    "M6a+b+c+d": {"extra": ("q_top", "age_f"), "starts_seen": True, "cls": "cls_m6d"},
    "M6e durata per tipo (lettura)": {"typed": True},
}


def extend(rows: list[dict], born: dict, games: dict) -> None:
    for r in rows:
        r["age"] = int(r["target"][:4]) - born[r["fc_id"]] if r["fc_id"] in born else None
        a1 = r["a1"]
        free = B.available(a1) if a1 else 0
        r["share_prev"] = (a1["sub"] + a1["start"]) / free if a1 and free > 0 else None
        low = r.get("cls_rung") in ("panchina", "ballottaggio")
        r["cls_m6d"] = "titolare" if low and (r["share_prev"] or 0) >= B.STARTER_SHARE else r.get("cls_rung")
        before = [x for x in games.get((r["fc_id"], r["target"]), ()) if x[0] <= r["auction"]]
        r["starts_seen_share"] = sum(started for _day, started in before) / len(before) if before else None


def main() -> None:
    config = Config()
    conn = sqlite3.connect(f"file:{config.db_path}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    games, spells, comps, types = B.league_games(conn), B.open_spells(conn), B.league_comps(conn), B.spell_types(conn)
    born = dict(conn.execute("SELECT fc_id, birth_year FROM players WHERE birth_year IS NOT NULL"))
    starts: dict = {}
    for fc, season, day, state, start in conn.execute(
            f"""SELECT fc_id, season, played_on, state, is_starting FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(B.LEAGUE_TYPES))})""", B.LEAGUE_TYPES):
        starts.setdefault((fc, season), []).append((day, bool(state == "played" and start)))
    july = B.engine_rows(conn, B.july_windows())
    B.annotate(july, agg, at_club, clubs, first, europe, mv)
    sept = [r for r in B.engine_rows(conn, B.september_windows()) if not B.abroad_on_day(r, comps)]
    B.annotate(sept, agg, at_club, clubs, first, europe, mv)
    for rows in (july, sept):
        extend(rows, born, starts)
    k = evaluate.R20_ROUNDS[next(x for x in evaluate.ADOPTED[B.PLATFORM] if x in evaluate.R20_ROUNDS)]
    targets = sorted({r["target"] for r in sept})
    flat = {t: B.residual_table(conn, f"{t[:4]}-07-01") for t in targets}
    typed = {t: B.residual_by_type(conn, f"{t[:4]}-07-01") for t in targets}
    out_flat = {id(r): B.expected_out(r, games, spells, flat[r["target"]]) for r in sept}
    out_typed = {id(r): B.expected_out(r, games, spells, typed[r["target"]], types) for r in sept}
    results: dict = {}
    for name, opts in VARIANTS.items():
        per = {}
        for t in targets:
            judged = [r for r in sept if r["target"] == t]
            p = B.fit([x for x in july if x["target"] != t], keeper_line=False,
                      cls=opts.get("cls", B.SEPTEMBER_CLASS), objective=B.SEPTEMBER_OBJECTIVE,
                      extra=opts.get("extra", ()))
            out = out_typed if opts.get("typed") else out_flat

            def pa(r, p=p, out=out, opts=opts):
                prior = B.share(r, p)
                if not (r["seen"] and r["pv_seen"] is not None):
                    return max(r["N"] - out[id(r)], 0.0) * prior
                seen = r["pv_seen"] / r["seen"]
                if opts.get("starts_seen") and r["starts_seen_share"] is not None:
                    seen = (seen + r["starts_seen_share"]) / 2
                return max(r["N"] - out[id(r)], 0.0) * model.blend_with_seen(prior, seen, r["seen"], k)
            s = B.scored(judged, pa)
            per[t] = {"band": s["within20_formula"], "mae": s["mae_formula"], "band_engine": s["within20_engine"],
                      "mae_engine": s["mae_engine"], "params": {key: p[key] for key in ("q", "q_top", "age_f")
                                                                if key in p}}
        results[name] = per
        base = results["base"]
        band_wins = sum(per[t]["band"] > base[t]["band"] for t in targets)
        mae_wins = sum(per[t]["mae"] < base[t]["mae"] for t in targets)
        passes = (band_wins >= 5 and mean(v["band"] for v in per.values()) > mean(v["band"] for v in base.values())
                  and mean(v["mae"] for v in per.values()) <= mean(v["mae"] for v in base.values()))
        print(f"{name:32s} quota {mean(v['band'] for v in per.values()):.4f} ({band_wins}/{len(targets)}) · errore "
              f"{mean(v['mae'] for v in per.values()):.4f} ({mae_wins}/{len(targets)}) · "
              f"{'PASSA' if name != 'base' and passes else ''} · {[round(per[t]['band'], 3) for t in targets]}"
              f" · {[per[t]['params'] for t in targets] if opts.get('extra') else ''}", flush=True)
    print(f"motore: quota {mean(v['band_engine'] for v in results['base'].values()):.4f} · errore "
          f"{mean(v['mae_engine'] for v in results['base'].values()):.4f}")
    (config.data_dir / "reports" / "presence_m6.json").write_text(json.dumps(results, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
