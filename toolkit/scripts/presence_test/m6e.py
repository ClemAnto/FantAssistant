"""M6e (partite-attese-scomposte-v1.md §5-octies): the games an open spell still costs, by KIND OF INJURY.

Read-only. The adopted September formula (M1b + M4) on the bench's population after the operator's two decisions
(nobody who was out of Serie A on the day; a man who played nothing counts), each window with the prior fitted on the
others. Base: the residual table of every spell. M6e: the table of the spell's own `detail`, then `kind`, then all.

    python toolkit/scripts/presence_test/m6e.py
"""
from __future__ import annotations

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


def main() -> None:
    conn = sqlite3.connect(f"file:{Config().db_path}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    games, spells, comps, types = B.league_games(conn), B.open_spells(conn), B.league_comps(conn), B.spell_types(conn)
    july = B.engine_rows(conn, B.july_windows())
    B.annotate(july, agg, at_club, clubs, first, europe, mv)
    sept = [r for r in B.engine_rows(conn, B.september_windows()) if not B.abroad_on_day(r, comps)]
    B.annotate(sept, agg, at_club, clubs, first, europe, mv)
    k = evaluate.R20_ROUNDS[next(x for x in evaluate.ADOPTED[B.PLATFORM] if x in evaluate.R20_ROUNDS)]
    targets = sorted({r["target"] for r in sept})
    flat = {t: B.residual_table(conn, f"{t[:4]}-07-01") for t in targets}
    typed = {t: B.residual_by_type(conn, f"{t[:4]}-07-01") for t in targets}
    out = {"base": {id(r): B.expected_out(r, games, spells, flat[r["target"]]) for r in sept},
           "M6e": {id(r): B.expected_out(r, games, spells, typed[r["target"]], types) for r in sept}}
    moved = [r for r in sept if out["base"][id(r)] != out["M6e"][id(r)]]
    print(f"popolazione {len(sept)}; stop aperti {sum(out['base'][id(r)] > 0 for r in sept)}; "
          f"partite saltate previste diverse su {len(moved)}")
    results = {name: {} for name in out}
    for t in targets:
        judged = [r for r in sept if r["target"] == t]
        p = B.fit([x for x in july if x["target"] != t], keeper_line=False, cls=B.SEPTEMBER_CLASS,
                  objective=B.SEPTEMBER_OBJECTIVE)
        for name, o in out.items():
            def pa(r, p=p, o=o):
                prior = B.share(r, p)
                chosen = (model.blend_with_seen(prior, r["pv_seen"] / r["seen"], r["seen"], k)
                          if r["seen"] and r["pv_seen"] is not None else prior)
                return max(r["N"] - o[id(r)], 0.0) * chosen
            results[name][t] = B.scored(judged, pa)
        b, m = results["base"][t], results["M6e"][t]
        print(f"{t}: quota {b['within20_formula']:.3f} -> {m['within20_formula']:.3f} (motore {b['within20_engine']:.3f})"
              f" · errore {b['mae_formula']:.3f} -> {m['mae_formula']:.3f} (motore {b['mae_engine']:.3f})", flush=True)
    for name, per in results.items():
        print(f"{name:5s} quota {mean(v['within20_formula'] for v in per.values()):.4f} errore "
              f"{mean(v['mae_formula'] for v in per.values()):.4f}")
    print(f"motore quota {mean(v['within20_engine'] for v in results['base'].values()):.4f} errore "
          f"{mean(v['mae_engine'] for v in results['base'].values()):.4f}")
    wins = sum(results["M6e"][t]["within20_formula"] > results["base"][t]["within20_formula"] for t in targets)
    print(f"M6e meglio della base sulla quota in {wins} stagioni su {len(targets)}")
    for r in sorted(moved, key=lambda r: -abs(out["M6e"][id(r)] - out["base"][id(r)]))[:15]:
        print(f"  {r['target']} {r['name']:18s} saltate previste {out['base'][id(r)]} -> {out['M6e'][id(r)]}, vere {r['pa_actual']}")


if __name__ == "__main__":
    main()
