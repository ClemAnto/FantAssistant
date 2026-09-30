"""M5 (partite-attese-scomposte-v1.md, pre-registered 01/10/2026): what the BOARD knows on 5 September.

Read-only. The two time-travel packs dated 5 September (2024 and 2025) carry, for every quoted Serie A man, whether the
typical eleven draws him (`in_eleven`) and the sheet's rung on that day (`status`). Judged on the bench's September
population of those two seasons, each with the numbers measured on the OTHER one, against the adopted formula.

    M5a  the formula's Pa x (median real/predicted of his group, drawn or not) on the other season
    M5b  (games to play - an open spell's) x the median share of the season with a vote of the sheet's rung that day

    python toolkit/scripts/presence_test/m5_board.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, median

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
import build as B  # noqa: E402
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.engine import evaluate, model  # noqa: E402

WINDOWS = ("I24set", "I25set")


def main() -> None:
    config = Config()
    conn = sqlite3.connect(f"file:{config.db_path}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    games, spells = B.league_games(conn), B.open_spells(conn)
    july = B.engine_rows(conn, B.july_windows())
    B.annotate(july, agg, at_club, clubs, first, europe, mv)
    sept = [r for r in B.engine_rows(conn, B.september_windows()) if r["window"] in WINDOWS]
    B.annotate(sept, agg, at_club, clubs, first, europe, mv)
    k = evaluate.R20_ROUNDS[next(x for x in evaluate.ADOPTED[B.PLATFORM] if x in evaluate.R20_ROUNDS)]
    boards = {}
    for r in sept:
        day = r["auction"]
        if day not in boards:
            path = config.data_dir / "timepacks" / day / "boards" / "leghe.json"
            boards[day] = json.loads(path.read_text(encoding="utf-8"))["titolarita"]
        entry = boards[day].get(str(r["fc_id"])) or {}
        r["in_eleven"] = entry.get("in_eleven")
        r["status"] = B.status.normalized(entry.get("status"))
    priors, tables = {}, {}
    for r in sept:
        t = r["target"]
        if t not in priors:
            priors[t] = B.fit([x for x in july if x["target"] != t], keeper_line=False,
                              cls=B.SEPTEMBER_CLASS, objective=B.SEPTEMBER_OBJECTIVE)
            tables[t] = B.residual_table(conn, f"{t[:4]}-07-01")
        r["out_open"] = B.expected_out(r, games, spells, tables[t])
        prior = B.share(r, priors[t])
        chosen = (model.blend_with_seen(prior, r["pv_seen"] / r["seen"], r["seen"], k)
                  if r["seen"] and r["pv_seen"] is not None else prior)
        r["rounds_left"] = max(r["N"] - r["out_open"], 0.0)
        r["pa_formula"] = r["rounds_left"] * chosen

    def group(r):
        return "disegnato" if r["in_eleven"] else ("non disegnato" if r["in_eleven"] is False else "ignoto")
    print("DIAGNOSI - formula contro vero, per quello che dice la board")
    for w in WINDOWS:
        rows = [r for r in sept if r["window"] == w and r["pa_engine"] is not None]
        for g in ("disegnato", "non disegnato", "ignoto"):
            got = [r for r in rows if group(r) == g]
            if got:
                print(f"  {w} {g:14s} {len(got):4d} · formula {mean(r['pa_formula'] for r in got):5.1f} · "
                      f"vere {mean(r['pa_actual'] for r in got):5.1f}")
        by_rung = defaultdict(list)
        for r in rows:
            by_rung[r["status"]].append(r)
        print("   " + " · ".join(f"{g}: {len(v)} f {mean(x['pa_formula'] for x in v):.1f} v "
                                  f"{mean(x['pa_actual'] for x in v):.1f}"
                                  for g, v in by_rung.items() if g))

    results = {}
    for w in WINDOWS:
        other = [r for r in sept if r["window"] != w]
        judged = [r for r in sept if r["window"] == w]
        factor = {}
        for g in ("disegnato", "non disegnato", "ignoto"):
            ratios = [r["pa_actual"] / r["pa_formula"] for r in other if group(r) == g and r["pa_formula"] > 0]
            factor[g] = median(ratios) if len(ratios) >= B.CELL_MIN else 1.0
        rung_share = {}
        for rung in B.status.LADDER:
            shares = [min(r["pa_actual"] / r["rounds_left"], 1.0) for r in other
                      if r["status"] == rung and r["rounds_left"] > 0]
            if len(shares) >= B.CELL_MIN:
                rung_share[rung] = median(shares)
        # M5d: the same groups, the factor that maximises the share within 80-125% on the other season.
        def band_of(rows, pred):
            ok = [r for r in rows if r["pa_actual"] > 0]
            return mean(0.8 <= pred(r) / r["pa_actual"] <= 1.25 for r in ok) if ok else 0.0
        grid = [x / 20 for x in range(4, 25)]
        best = {}
        for g in ("disegnato", "non disegnato", "ignoto"):
            mine = [r for r in other if group(r) == g]
            best[g] = max(grid, key=lambda f: band_of(mine, lambda r, f=f: r["pa_formula"] * f)) if len(mine) >= B.CELL_MIN else 1.0
        base = B.scored(judged, lambda r: r["pa_formula"])
        m5c = B.scored(judged, lambda r: r["pa_formula"] * (factor["ignoto"] if group(r) == "ignoto" else 1.0))
        m5d = B.scored(judged, lambda r: r["pa_formula"] * best[group(r)])
        m5a = B.scored(judged, lambda r: r["pa_formula"] * factor[group(r)])
        m5b = B.scored(judged, lambda r: r["rounds_left"] * rung_share[r["status"]]
                       if r["status"] in rung_share else r["pa_formula"])
        results[w] = {"base": base, "M5a": m5a, "M5b": m5b, "M5c": m5c, "M5d": m5d, "factor": factor,
                      "band_factor": best, "rung_share": rung_share}
        print(f"\n{w}: fattori {({g: round(f, 3) for g, f in factor.items()})} · quota per gradino "
              f"{({g: round(v, 3) for g, v in rung_share.items()})}")
        print(f"  fattori per la quota (M5d): {best}")
        for name, s in (("formula adottata", base), ("M5a", m5a), ("M5b", m5b), ("M5c", m5c), ("M5d", m5d)):
            print(f"  {name:18s} entro 80-125% {s['within20_formula']:.3f} · errore {s['mae_formula']:.3f} · "
                  f"motore {s['within20_engine']:.3f} / {s['mae_engine']:.3f}")
    (config.data_dir / "reports" / "presence_m5.json").write_text(json.dumps(results, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
