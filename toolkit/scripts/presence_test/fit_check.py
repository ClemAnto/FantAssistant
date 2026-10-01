"""IS THE FIT STUCK? (partite-attese-scomposte-v1.md §5-septies: «la griglia tarata sulla quota tocca il bordo e la
sua discesa per coordinate su una perdita a gradini è da verificare prima di credere a un "non serve"»). Read-only.

The adopted September formula (M1b + M4 + M7f, P0, zeros counted), each window with the prior fitted on the others,
three ways: the shipped fit (one coordinate descent from the default start); the same descent from many random
starts, keeping the one with the best TRAINING loss; and the grid WIDENED past the edges the shipped fit touches.
If neither moves the held-out share, the edges are where the loss is flat, not where the tool got stuck.

    python toolkit/scripts/presence_test/fit_check.py [--db PATH]
"""
from __future__ import annotations

import argparse
import random
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

RESTARTS = 12
WIDE = {"kD": [0, 20, 40, 80, 160, 320, 640, 1280, 2560], "w2": [0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0],
        "q": [-0.6, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.5]}


def descend(train, p, grid, loss, passes=4):
    outfield = [r for r in train if not (p["keeper"] and r["ctx"].startswith("portiere"))]
    for _ in range(passes):
        for key, values in grid.items():
            p[key] = min(values, key=lambda v: loss(outfield, {**p, key: v}))
    return p, loss(outfield, p)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(Config().db_path))
    db = parser.parse_args().db
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    games, spells, comps = B.league_games(conn), B.open_spells(conn), B.league_comps(conn)
    july = B.engine_rows(conn, B.july_windows())
    B.annotate(july, agg, at_club, clubs, first, europe, mv)
    sept = [r for r in B.engine_rows(conn, B.september_windows()) if not B.abroad_on_day(r, comps)]
    B.annotate(sept, agg, at_club, clubs, first, europe, mv)
    k = evaluate.R20_ROUNDS[next(x for x in evaluate.ADOPTED[B.PLATFORM] if x in evaluate.R20_ROUNDS)]
    targets = sorted({r["target"] for r in sept})
    out = {id(r): B.expected_out(r, games, spells, B.residual_table(conn, f"{r['target'][:4]}-07-01"))
           for r in sept}
    rng = random.Random(7)
    results = {"spedita": {}, "ripartenze": {}, "griglia larga": {}}
    for t in targets:
        train = [x for x in july if x["target"] != t]
        base = B.fit(train, keeper_line=False, cls=B.SEPTEMBER_CLASS, objective=B.SEPTEMBER_OBJECTIVE)
        candidates = {"spedita": base}
        best, best_loss = None, None
        for _ in range(RESTARTS):
            start = {**base, **{key: rng.choice(values) for key, values in B.GRID.items()}}
            p, loss = descend(train, start, B.GRID, B.band_loss)
            if best_loss is None or loss < best_loss:
                best, best_loss = dict(p), loss
        candidates["ripartenze"] = best
        candidates["griglia larga"] = descend(train, dict(base), {**B.GRID, **WIDE}, B.band_loss)[0]
        judged = [r for r in sept if r["target"] == t]
        for name, p in candidates.items():
            def pa(r, p=p):
                prior = B.september_share(r, p)
                chosen = (model.blend_with_seen(prior, r["pv_seen"] / r["seen"], r["seen"], k)
                          if r["seen"] and r["pv_seen"] is not None else prior)
                return max(r["N"] - out[id(r)], 0.0) * chosen
            s = B.scored(judged, pa)
            results[name][t] = (s["within20_formula"], s["mae_formula"], {g: p[g] for g in ("kD", "w2", "q", "kS", "c")})
        print(t, {name: (v[t][0], v[t][1]) for name, v in results.items()}, flush=True)
    base = results["spedita"]
    for name, per in results.items():
        wins = sum(per[t][0] > base[t][0] for t in targets)
        print(f"{name:14s} quota {mean(v[0] for v in per.values()):.4f} ({wins}/7) errore "
              f"{mean(v[1] for v in per.values()):.4f} · {[per[t][2] for t in targets][:3]}")


if __name__ == "__main__":
    main()
