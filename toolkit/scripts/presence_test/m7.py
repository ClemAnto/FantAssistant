"""M7a-M7d (partite-attese-scomposte-v1.md §5-nonies), judged at 5 September on the base of §5-octies.

Read-only. Born from five names (Svilar, Bellanova, Terracciano, Lucca; Lukaku is not a candidate here), judged on
the whole population with the criterion of §5-sexies: the share within 80-125% rises on at least 5 windows of 7 and on
average, and the mean error does not get worse on average.

* M7a - the blend's K has its own value for the keepers;
* M7b - the same for the men who changed club;
* M7c - the choice is read at the club he will play for when the season measured was split (OWN_CLUB);
* M7d - a teammate ARRIVED this summer, sharing a mantra role and quoted higher, multiplies his choice by a factor.

K and the factor are chosen, for each window judged, on the September rows of the OTHER windows.

    python toolkit/scripts/presence_test/m7.py
"""
from __future__ import annotations

import datetime as dt
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
import build as B  # noqa: E402
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.engine import evaluate, model  # noqa: E402

K_GRID = (1, 2, 3, 5, 10, 20)
F_GRID = (0.6, 0.7, 0.8, 0.9, 1.0)


def club_on_day(games, fc, season, auction):
    rows = games.get((fc, season), ())
    soon = (dt.date.fromisoformat(auction) + dt.timedelta(days=B.ABROAD_DAYS)).isoformat()
    after = [club for day, club, _s, _a in rows if auction < day <= soon]
    before = [club for day, club, _s, _a in rows if day <= auction]
    return after[0] if after else before[-1] if before else None


def competitors(conn, sept, games, clubs) -> set:
    """(window, fc_id) of the men who have, at their club on the day, a pricier summer arrival in their role."""
    roles = {(fc, s): {x.strip().lower() for x in (rr or "").replace(",", ";").split(";") if x.strip()}
             for fc, s, rr in conn.execute("SELECT fc_id, season, roles FROM rosters")}
    price = {(fc, s): p for fc, s, p in conn.execute(
        "SELECT fc_id, season, price_initial FROM listone_quotes WHERE platform='default' AND price_initial IS NOT NULL")}
    out = set()
    for key in {(r["window"], r["target"], r["input"], r["auction"]) for r in sept}:
        window, target, input_, auction = key
        squad = defaultdict(list)
        for (fc, s), _rows in games.items():
            if s != target or (fc, target) not in price:
                continue
            club = club_on_day(games, fc, target, auction)
            if club is None:
                continue
            held = clubs.get((fc, input_))
            main = max(held.items(), key=lambda kv: kv[1])[0] if held else None
            squad[club].append((fc, roles.get((fc, target), set()), price[(fc, target)], main != club))
        for r in sept:
            if r["window"] != window:
                continue
            club = club_on_day(games, r["fc_id"], target, auction)
            mine = roles.get((r["fc_id"], target), set())
            qti = price.get((r["fc_id"], target))
            if club is None or not mine or qti is None:
                continue
            if any(fc != r["fc_id"] and new and rr & mine and p > qti for fc, rr, p, new in squad.get(club, ())):
                out.add((window, r["fc_id"]))
    return out


def main() -> None:
    conn = sqlite3.connect(f"file:{Config().db_path}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    games, spells, comps = B.league_games(conn), B.open_spells(conn), B.league_comps(conn)
    july = B.engine_rows(conn, B.july_windows())
    sept = [r for r in B.engine_rows(conn, B.september_windows()) if not B.abroad_on_day(r, comps)]
    targets = sorted({r["target"] for r in sept})
    tables = {t: B.residual_table(conn, f"{t[:4]}-07-01") for t in targets}
    k_engine = evaluate.R20_ROUNDS[next(x for x in evaluate.ADOPTED[B.PLATFORM] if x in evaluate.R20_ROUNDS)]
    rival = competitors(conn, sept, games, clubs)
    print(f"popolazione {len(sept)}; con un concorrente arrivato piu' caro {len(rival)}", flush=True)

    def shirt_changed(r) -> bool:
        """M7e: a keeper of class «riserva» who took a vote in every round seen (two at least)."""
        return (r["ctx"] == "portiere riserva" and (r["seen"] or 0) >= 2 and r["pv_seen"] is not None
                and r["pv_seen"] >= r["seen"])

    def chosen_by_target(own_club: bool, swap: bool = False) -> dict:
        """Per September row: (prior share, rounds left) under the July fit that leaves its season out."""
        B.annotate(july, agg, at_club, clubs, first, europe, mv, own_club=own_club)
        B.annotate(sept, agg, at_club, clubs, first, europe, mv, own_club=own_club)
        out = {}
        for t in targets:
            p = B.fit([x for x in july if x["target"] != t], keeper_line=False, cls=B.SEPTEMBER_CLASS,
                      objective=B.SEPTEMBER_OBJECTIVE)
            for r in sept:
                if r["target"] == t:
                    ctx = r["ctx"]
                    if swap and shirt_changed(r):
                        r["ctx"] = "portiere titolare"
                    share = B.share(r, p)
                    if swap == "replace" and shirt_changed({**r, "ctx": ctx}):
                        d, _s = B.parts(r, p)          # M7f: his choice IS the starters' mean
                        share = d * B.prior(p, "Sbar", r) * p["c"]
                    r["ctx"] = ctx
                    out[id(r)] = (share, max(r["N"] - B.expected_out(r, games, spells, tables[t]), 0.0),
                                  r["ctx"].startswith("portiere"), r["club_change"])
        return out

    base_prior = chosen_by_target(False)
    swap_prior = chosen_by_target(False, swap=True)
    replace_prior = chosen_by_target(False, swap="replace")
    print(f"maglia cambiata (M7e): {sum(shirt_changed(r) for r in sept if r['pa_engine'] is not None)} righe")
    own_prior = chosen_by_target(True)
    both_prior = chosen_by_target(True, swap="replace")

    def pa(r, prior, k_keep=None, k_move=None, f=1.0):
        share, rounds, keeper, moved = prior[id(r)]
        if (r["window"], r["fc_id"]) in rival:
            share *= f
        k = k_keep if keeper and k_keep else k_move if moved and not keeper and k_move else k_engine
        if r["seen"] and r["pv_seen"] is not None:
            share = model.blend_with_seen(share, r["pv_seen"] / r["seen"], r["seen"], k)
        return rounds * share

    def band(rows, fn):
        return mean(B.in_band(fn(r), r["pa_actual"]) for r in rows if r["pa_engine"] is not None)

    def choose(t, grid, make):
        other = [r for r in sept if r["target"] != t]
        return max(grid, key=lambda v: (band(other, make(v)), -abs(v - grid[-1])))

    variants = {
        "base": lambda t: (lambda r: pa(r, base_prior)),
        "M7a K dei portieri": lambda t: (lambda r, k=choose(t, K_GRID, lambda v: lambda x: pa(x, base_prior, k_keep=v)):
                                         pa(r, base_prior, k_keep=k)),
        "M7b K di chi cambia club": lambda t: (lambda r, k=choose(t, K_GRID, lambda v: lambda x: pa(x, base_prior, k_move=v)):
                                               pa(r, base_prior, k_move=k)),
        "M7c scelta al club nuovo": lambda t: (lambda r: pa(r, own_prior)),
        "M7e maglia cambiata": lambda t: (lambda r: pa(r, swap_prior)),
        "M7f maglia cambiata, quota dei titolari": lambda t: (lambda r: pa(r, replace_prior)),
        "M7c+M7f": lambda t: (lambda r: pa(r, both_prior)),
        "M7d concorrente arrivato": lambda t: (lambda r, f=choose(t, F_GRID, lambda v: lambda x: pa(x, base_prior, f=v)):
                                               pa(r, base_prior, f=f)),
    }
    results = {}
    chosen_params = defaultdict(list)
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    for name, make in variants.items():
        if only and name != "base" and not any(name.startswith(o) for o in only):
            continue
        per = {}
        for t in targets:
            fn = make(t)
            if fn.__defaults__:
                chosen_params[name].append(fn.__defaults__[0])
            per[t] = B.scored([r for r in sept if r["target"] == t], fn)
        results[name] = per
        base = results["base"]
        bw = sum(per[t]["within20_formula"] > base[t]["within20_formula"] for t in targets)
        mw = sum(per[t]["mae_formula"] < base[t]["mae_formula"] for t in targets)
        q = mean(v["within20_formula"] for v in per.values())
        e = mean(v["mae_formula"] for v in per.values())
        ok = (bw >= 5 and q > mean(v["within20_formula"] for v in base.values())
              and e <= mean(v["mae_formula"] for v in base.values()))
        print(f"{name:28s} quota {q:.4f} ({bw}/7) errore {e:.4f} ({mw}/7) {'PASSA' if ok and name != 'base' else ''} "
              f"{chosen_params.get(name, '')}", flush=True)
    # the five names, with the four readings
    for r in sept:
        if shirt_changed(r) and r["pa_engine"] is not None:
            print(f"  M7f {r['target']} {r['name']:20s} vere {r['pa_actual']:4.0f} base {pa(r, base_prior):5.1f} "
                  f"M7f {pa(r, replace_prior):5.1f} motore {r['pa_engine']}")
    names = ("Svilar", "Butez", "Caprile", "Bellanova", "Zortea", "Terracciano", "Lucca")
    for r in sept:
        if r["name"].split()[0] in names and r["pa_engine"] is not None:
            if r["target"] in ("2023-24", "2024-25", "2025-26"):
                print(f"  {r['target']} {r['name']:14s} vere {r['pa_actual']:4.0f} base {pa(r, base_prior):5.1f} "
                      f"Kport1 {pa(r, base_prior, k_keep=1):5.1f} Kcamb2 {pa(r, base_prior, k_move=2):5.1f} "
                      f"club {pa(r, own_prior):5.1f} conc {pa(r, base_prior, f=0.7):5.1f} "
                      f"{'(concorrente)' if (r['window'], r['fc_id']) in rival else ''}")
    out = Config().data_dir / "reports" / "presence_m7.json"
    out.write_text(json.dumps({k: v for k, v in results.items()}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
