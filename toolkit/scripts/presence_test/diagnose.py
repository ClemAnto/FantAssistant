"""WHICH FACTOR OVER-PREDICTS: the September formula split into availability (D) and choice (S), against the season.

Read-only. For every man of the bench's September population: the formula's D and S (the July-fitted prior, S after
the blend with the rounds seen), and what happened after the auction on Transfermarkt's per-game rows - the share of
his club's games he was FIT for (actual D) and, of those, the share he PLAYED (actual S). Printed per group, the mean
of each and the bias, so «we give the starters too many games» can be read as «too available» or «too chosen».

    python toolkit/scripts/presence_test/diagnose.py
"""
from __future__ import annotations

import sqlite3
import sys
from collections import defaultdict
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
    dates, spells, games = B.league_dates(conn), B.open_spells(conn), B.league_games(conn)
    july = B.engine_rows(conn, B.july_windows())
    B.annotate(july, agg, at_club, clubs, first, europe, mv)
    sept = B.engine_rows(conn, B.september_windows())
    B.annotate(sept, agg, at_club, clubs, first, europe, mv)
    k = evaluate.R20_ROUNDS[next(x for x in evaluate.ADOPTED[B.PLATFORM] if x in evaluate.R20_ROUNDS)]
    priors, tables = {}, {}
    out = defaultdict(list)
    for r in sept:
        if r["a1"] is None or r["pa_engine"] is None:
            continue
        if r["target"] not in priors:
            priors[r["target"]] = B.fit([x for x in july if x["target"] != r["target"]], keeper_line=False)
            tables[r["target"]] = B.residual_table(conn, f"{r['target'][:4]}-07-01")
        p = priors[r["target"]]
        after = [(state) for day, _club, state, _a in games.get((r["fc_id"], r["target"]), ()) if day > r["auction"]]
        if len(after) < 10:
            continue
        fit_for = [s for s in after if s not in ("injured", "absent")]
        d_act = len(fit_for) / len(after)
        s_act = sum(s == "played" for s in fit_for) / len(fit_for) if fit_for else None
        if r["ctx"].startswith("portiere") and p.get("keeper"):
            continue
        d, s = B.parts(r, p)
        d *= p["c"]            # the scale sits on the product; put it on D, it is one number either way
        prior = d * s
        chosen = (model.blend_with_seen(prior, r["pv_seen"] / r["seen"], r["seen"], k)
                  if r["seen"] and r["pv_seen"] is not None else prior)
        out_open = B.expected_out(r, games, spells, tables[r["target"]])
        rounds = max(r["N"] - out_open, 0.0)
        s_blend = chosen / d if d else s          # the blend moves the product; read it as a move of S
        d_eff = d * rounds / r["N"] if r["N"] else d
        group = ("portiere" if r["ctx"].startswith("portiere") else
                 "cambio club" if r["club_change"] else
                 "stesso club, titolare" if s >= 0.6 else "stesso club, riserva")
        out[group].append({"d": d_eff, "d_act": d_act, "s": s_blend, "s_act": s_act,
                           "pa": rounds * chosen, "pa_act": r["pa_actual"], "played": sum(x == "played" for x in after)})
    print(f"{'gruppo':24s} {'n':>5s}  {'D form.':>7s} {'D vera':>7s}  {'S form.':>7s} {'S vera':>7s}  "
          f"{'Pa form.':>8s} {'Pa vere':>7s}")
    for group, rows in sorted(out.items(), key=lambda kv: -len(kv[1])):
        known = [x for x in rows if x["s_act"] is not None]
        print(f"{group:24s} {len(rows):5d}  {mean(x['d'] for x in rows):7.3f} {mean(x['d_act'] for x in rows):7.3f}  "
              f"{mean(x['s'] for x in known):7.3f} {mean(x['s_act'] for x in known):7.3f}  "
              f"{mean(x['pa'] for x in rows):8.2f} {mean(x['pa_act'] for x in rows):7.2f}")
    starters = out["stesso club, titolare"]
    # Where the over-prediction of the starters comes from: the bias of each factor, weighted like the product.
    over = [x for x in starters if x["pa"] > x["pa_act"]]
    print(f"titolari sovrastimati: {len(over)} su {len(starters)}; fra loro D form. {mean(x['d'] for x in over):.3f} "
          f"vera {mean(x['d_act'] for x in over):.3f}, S form. {mean(x['s'] for x in over if x['s_act'] is not None):.3f} "
          f"vera {mean(x['s_act'] for x in over if x['s_act'] is not None):.3f}")
    # How the error of the starters splits by how much of the season they really lost.
    bands = defaultdict(list)
    for x in starters:
        lost = 1 - x["d_act"]
        bands["perde < 10%" if lost < 0.1 else "10-33%" if lost < 1 / 3 else "oltre un terzo"].append(x)
    for name, rows in bands.items():
        print(f"  {name:16s} {len(rows):4d} uomini · errore {mean(abs(x['pa'] - x['pa_act']) for x in rows):.2f} · "
              f"scarto {mean(x['pa'] - x['pa_act'] for x in rows):+.2f}")


if __name__ == "__main__":
    main()
