"""THE PRE-REGISTERED CHANGES M1-M4 (partite-attese-scomposte-v1.md §5-sexies), judged at 5 September.

Read-only. Each variant is the September formula (prior + blend with the rounds seen + a spell still open) with the
prior fitted as the variant says, on the windows whose season predicted is not the one judged; judged on the auction's
population with everybody in. The criterion was written before the run: the share within 80-125% of what they really
played rises on at least 5 windows of 7 and on average, and the mean error does not get worse on average.

    python toolkit/scripts/presence_test/m_eval.py
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
    "M1 classe titolare/rotazione": {"cls": "cls_bin"},
    "M1b classe = gradino": {"cls": "cls_rung"},
    "M2 tarata su settembre": {"september": True},
    "M3 minuti -> voti": {"vote_minutes": True},
    "M4 tarata sulla quota 80-125%": {"objective": "band"},
    "M1b + M3": {"cls": "cls_rung", "vote_minutes": True},
    "M1b + M4": {"cls": "cls_rung", "objective": "band"},
    "M3 + M4": {"vote_minutes": True, "objective": "band"},
    "M1b + M3 + M4": {"cls": "cls_rung", "vote_minutes": True, "objective": "band"},
}


def main() -> None:
    config = Config()
    conn = sqlite3.connect(f"file:{config.db_path}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    games, spells = B.league_games(conn), B.open_spells(conn)
    july = B.engine_rows(conn, B.july_windows())
    B.annotate(july, agg, at_club, clubs, first, europe, mv)
    sept = B.engine_rows(conn, B.september_windows())
    B.annotate(sept, agg, at_club, clubs, first, europe, mv)
    k = evaluate.R20_ROUNDS[next(x for x in evaluate.ADOPTED[B.PLATFORM] if x in evaluate.R20_ROUNDS)]
    tables = {t: B.residual_table(conn, f"{t[:4]}-07-01") for t in {r["target"] for r in sept}}
    out_open = {id(r): B.expected_out(r, games, spells, tables[r["target"]]) for r in sept}
    windows = [w for w in B.september_windows() if any(r["window"] == w for r in sept)]
    results: dict = {}
    for name, opts in VARIANTS.items():
        per_window = {}
        for w in windows:
            judged = [r for r in sept if r["window"] == w]
            target = judged[0]["target"]
            pool = sept if opts.get("september") else july
            p = B.fit([x for x in pool if x["target"] != target], keeper_line=False, cls=opts.get("cls"),
                      vote_minutes=opts.get("vote_minutes", False), objective=opts.get("objective", "mae"))

            def pa(r, p=p):
                prior = B.share(r, p)
                chosen = (model.blend_with_seen(prior, r["pv_seen"] / r["seen"], r["seen"], k)
                          if r["seen"] and r["pv_seen"] is not None else prior)
                return max(r["N"] - out_open[id(r)], 0.0) * chosen
            s = B.scored(judged, pa)
            per_window[w] = {"band": s["within20_formula"], "mae": s["mae_formula"],
                             "band_engine": s["within20_engine"], "mae_engine": s["mae_engine"]}
        results[name] = per_window
        base = results["base"]
        wins = sum(per_window[w]["band"] > base[w]["band"] for w in windows)
        print(f"{name:32s} quota {mean(v['band'] for v in per_window.values()):.3f} "
              f"(meglio della base {wins}/{len(windows)}) · errore {mean(v['mae'] for v in per_window.values()):.3f} · "
              f"per stagione {[round(per_window[w]['band'], 3) for w in windows]}", flush=True)
    print(f"motore: quota {mean(v['band_engine'] for v in results['base'].values()):.3f} · errore "
          f"{mean(v['mae_engine'] for v in results['base'].values()):.3f}")
    out = config.data_dir / "reports" / "presence_m_eval.json"
    out.write_text(json.dumps(results, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
