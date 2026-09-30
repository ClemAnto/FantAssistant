"""WHERE THE ADOPTED SEPTEMBER FORMULA MISSES ON THE STARTERS WHO STAYED (partite-attese-scomposte-v1.md §5-septies).

Read-only. The formula the bench ships at 5 September (M1b + M4: the prior pulled toward his role, context and rung of
last season, the grid fitted on the share within 80-125%, the blend with the rounds seen, a spell still open), on the
group that holds 58% of the margin: not a keeper, same club, S >= 0.6. For every man it writes what the formula said,
what happened after the auction on Transfermarkt's per-game rows, and what was knowable on the day, so the analysis
can be read without refitting:

    python toolkit/scripts/presence_test/starters.py        # writes data/reports/presence_starters.json

The error is split in three factors whose logs add up exactly - the CALENDAR (games of his club after the auction
against the rounds the engine counts), AVAILABILITY (the share of those games he was fit for) and CHOICE x VOTE (the
votes he took per game he was fit for) - and the choice is split again into appearances and the votes they bring.
"""
from __future__ import annotations

import datetime as dt
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, median

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
import build as B  # noqa: E402
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.engine import evaluate, model  # noqa: E402


def coaches(conn) -> dict:
    """Per (fc_id, season): the coach of each of his club's league games, by date (Transfermarkt's own field)."""
    out: dict = defaultdict(list)
    for fc, season, day, club, coach in conn.execute(
            f"""SELECT fc_id, season, played_on, club_id, coach_id FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(B.LEAGUE_TYPES))})""", B.LEAGUE_TYPES):
        out[(fc, season)].append((day, club, coach))
    for v in out.values():
        v.sort(key=lambda x: (x[0], str(x[1]), str(x[2])))
    return out


def main() -> None:
    config = Config()
    conn = sqlite3.connect(f"file:{config.db_path}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    dates, spells, games = B.league_dates(conn), B.open_spells(conn), B.league_games(conn)
    starts_rows: dict = defaultdict(list)
    for fc, season, day, club, state, start, minutes in conn.execute(
            f"""SELECT fc_id, season, played_on, club_id, state, is_starting, minutes FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(B.LEAGUE_TYPES))})""", B.LEAGUE_TYPES):
        starts_rows[(fc, season)].append((day, club, state, start, minutes or 0))
    coach = coaches(conn)
    comps: dict = defaultdict(list)
    for fc, season, day, comp in conn.execute(
            f"""SELECT fc_id, season, played_on, competition FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(B.LEAGUE_TYPES))})""", B.LEAGUE_TYPES):
        comps[(fc, season)].append((day, comp))
    born = dict(conn.execute("SELECT fc_id, birth_year FROM players WHERE birth_year IS NOT NULL"))
    price = {(fc, s): (p, club) for fc, s, p, club in conn.execute(
        "SELECT fc_id, season, price_initial, fc_club_id FROM listone_quotes WHERE platform='default'")}

    july = B.engine_rows(conn, B.july_windows())
    B.annotate(july, agg, at_club, clubs, first, europe, mv)
    sept = B.engine_rows(conn, B.september_windows())
    for r in sept:
        r["injury"] = B.injury_group(r, dates, spells)
    B.annotate(sept, agg, at_club, clubs, first, europe, mv)
    k = evaluate.R20_ROUNDS[next(x for x in evaluate.ADOPTED[B.PLATFORM] if x in evaluate.R20_ROUNDS)]
    priors, tables = {}, {}
    rows = []
    for r in sept:
        if r["target"] not in priors:
            priors[r["target"]] = B.fit([x for x in july if x["target"] != r["target"]], keeper_line=False,
                                        cls=B.SEPTEMBER_CLASS, objective=B.SEPTEMBER_OBJECTIVE)
            tables[r["target"]] = B.residual_table(conn, f"{r['target'][:4]}-07-01")
            print("fitted", r["target"], {g: priors[r["target"]][g] for g in B.GRID}, flush=True)
        p = priors[r["target"]]
        if r["pa_engine"] is None:
            continue
        prior = B.share(r, p)
        chosen = (model.blend_with_seen(prior, r["pv_seen"] / r["seen"], r["seen"], k)
                  if r["seen"] and r["pv_seen"] is not None else prior)
        out_open = B.expected_out(r, games, spells, tables[r["target"]])
        rounds = max(r["N"] - out_open, 0.0)
        pa = rounds * chosen
        d = s = None
        if r["a1"] is not None and not r["ctx"].startswith("portiere"):
            d, s = B.parts(r, p)
        group = ("portiere" if r["ctx"].startswith("portiere") else
                 "nessuna" if r["a1"] is None else
                 "cambio club" if r["club_change"] else
                 "stesso club, titolare" if s >= 0.6 else "stesso club, riserva")
        mine = starts_rows.get((r["fc_id"], r["target"]), ())
        after = [x for x in mine if x[0] > r["auction"]]
        before = [x for x in mine if x[0] <= r["auction"]]
        states = Counter(x[2] for x in after)
        fit_for = len(after) - states["injured"] - states["absent"]
        played = states["played"]
        # What was knowable on the day about the shirt: last season's starts, minutes, the coach, the price.
        a1 = r["a1"]
        prev_coaches = Counter(c for day, club, c in coach.get((r["fc_id"], r["input"]), ()) if c)
        now_coaches = [c for day, club, c in coach.get((r["fc_id"], r["target"]), ()) if day <= r["auction"] and c]
        later_coaches = [c for day, club, c in coach.get((r["fc_id"], r["target"]), ()) if day > r["auction"] and c]
        coach_prev = prev_coaches.most_common(1)[0][0] if prev_coaches else None
        coach_now = now_coaches[-1] if now_coaches else None
        pr, club_id = price.get((r["fc_id"], r["target"]), (None, None))
        # ABROAD ON THE DAY (§5-septies): his last league game before the auction was outside Serie A and no
        # Serie A game follows within 30 days - he left in the summer (Lukaku 2021, Scamacca 2022, Ndoye 2025) or
        # arrives in January (Gimenez, Taylor K.). The bench keeps him because a past season's listone is its LAST
        # read; an auction on 5 September could not buy him. The 30 days keep the deadline arrivals (Messias,
        # Okaka), who were in Serie A on the day and had not played yet - and read the calendar after the auction,
        # which is the leak this definition accepts for want of a dated roster.
        league_before = sorted((day, comp) for day, comp in comps.get((r["fc_id"], r["target"]), ())
                               if day <= r["auction"])
        soon = (dt.date.fromisoformat(r["auction"]) + dt.timedelta(days=30)).isoformat()
        abroad = (bool(league_before) and league_before[-1][1] != "IT1"
                  and not any(r["auction"] < day <= soon and comp == "IT1"
                              for day, comp in comps.get((r["fc_id"], r["target"]), ())))
        rows.append({
            "window": r["window"], "target": r["target"], "fc_id": r["fc_id"], "name": r["name"], "role": r["role"],
            "group": group, "abroad": abroad, "ctx": r["ctx"], "rung_prev": r["cls_rung"], "injury": r["injury"],
            "N": r["N"], "out_open": out_open, "seen": r["seen"], "pv_seen": r["pv_seen"],
            "d": d, "s": s, "c": p["c"], "prior": prior, "chosen": chosen, "pa": pa,
            "pa_engine": r["pa_engine"], "pa_actual": r["pa_actual"],
            "n_after": len(after), "fit_for": fit_for, "played": played,
            "started_after": sum(1 for x in after if x[2] == "played" and x[3]),
            "min_after": sum(x[4] for x in after if x[2] == "played"),
            "inj_after": states["injured"], "absent_after": states["absent"], "bench_after": states["in squad"],
            "out_after": states["not in squad"],
            "seen_tm": len(before), "seen_played": sum(1 for x in before if x[2] == "played"),
            "seen_started": sum(1 for x in before if x[2] == "played" and x[3]),
            "seen_minutes": sum(x[4] for x in before if x[2] == "played"),
            "seen_fit": sum(1 for x in before if x[2] not in ("injured", "absent")),
            "prev": None if a1 is None else {k2: a1[k2] for k2 in
                                             ("n", "inj", "susp", "other", "naz", "bench", "sub", "start", "minutes",
                                              "out")},
            "prev2": None if r["a2"] is None else {k2: r["a2"][k2] for k2 in
                                                   ("n", "inj", "susp", "other", "naz", "sub", "start", "minutes")},
            "age": (int(r["target"][:4]) - born[r["fc_id"]]) if r["fc_id"] in born else None,
            "price": pr, "club": club_id, "mv": r["mv"], "ein": r["ein"], "eout": r["eout"],
            # His MOST FREQUENT coach of last season against the coach on the day: it also fires when the coach
            # changed in the middle of the season measured, so it is NOT «a new coach this summer» (that reading, at
            # club level, is in the doc: 0.27 against 0.19 of lost places, and nothing once the rest is held).
            "coach_changed_summer": (coach_prev is not None and coach_now is not None and coach_prev != coach_now),
            "coach_changed_later": bool(later_coaches) and coach_now is not None and any(
                c != coach_now for c in later_coaches),
        })
    out = config.data_dir / "reports" / "presence_starters.json"
    out.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"{len(rows)} righe in {out}; gruppi {Counter(x['group'] for x in rows)}")
    report(rows)


def within(pred: float, actual: float) -> bool:
    return actual > 0 and 0.8 <= pred / actual <= 1.25


def report(rows: list[dict]) -> None:
    """The tables of §5-septies: the population, the oracle per factor, and where the misses fall."""
    abroad = [r for r in rows if r["abroad"]]
    print(f"fuori dalla Serie A il giorno dell'asta: {len(abroad)} di {len(rows)} "
          f"({Counter(r['group'] for r in abroad)}), zero voti {sum(r['pa_actual'] == 0 for r in abroad)}; "
          f"formula {mean(r['pa'] for r in abroad):.1f}, motore {mean(r['pa_engine'] for r in abroad):.1f}, "
          f"vere {mean(r['pa_actual'] for r in abroad):.1f}")
    for name, sub in (("tutti", rows), ("senza i fuori", [r for r in rows if not r["abroad"]])):
        per: dict = defaultdict(list)
        for r in sub:
            per[r["window"]].append(r)
        for zeros in (False, True):
            def share(v, key):
                v = [r for r in v if zeros or r["pa_actual"] > 0]
                return mean(within(r[key], r["pa_actual"]) or (r["pa_actual"] == 0 and r[key] < 0.5) for r in v)
            print(f"  {name:14s} zeri {'contati' if zeros else 'esclusi'}: quota formula "
                  f"{mean(share(v, 'pa') for v in per.values()):.3f} motore "
                  f"{mean(share(v, 'pa_engine') for v in per.values()):.3f} · errore "
                  f"{mean(mean(abs(r['pa'] - r['pa_actual']) for r in v) for v in per.values()):.3f} / "
                  f"{mean(mean(abs(r['pa_engine'] - r['pa_actual']) for r in v) for v in per.values()):.3f}")
    g = [r for r in rows if r["group"] == "stesso club, titolare" and not r["abroad"] and r["n_after"] >= 10]
    judged = [r for r in g if r["pa_actual"] > 0]
    for r in g:
        dc = r["d"] * r["c"]
        r["d_hat"] = dc * (r["N"] - r["out_open"]) / r["N"]
        r["s_hat"] = r["chosen"] / dc
        r["d_act"] = r["fit_for"] / r["n_after"]
        r["sv_act"] = r["pa_actual"] / r["fit_for"] if r["fit_for"] else 0.0
        r["kept"] = bool(r["fit_for"]) and r["played"] / r["fit_for"] >= 0.8

    def oracle(fn):
        return mean(within(fn(r), r["pa_actual"]) for r in judged)
    print(f"titolari rimasti, senza i fuori: {len(g)} ({len(judged)} con almeno un voto)")
    print(f"  quota {oracle(lambda r: r['pa']):.3f} · disponibilita' vera "
          f"{oracle(lambda r: r['pa'] * r['d_act'] / r['d_hat']):.3f} · scelta vera "
          f"{oracle(lambda r: r['pa'] * r['sv_act'] / r['s_hat']):.3f} · tutte e due "
          f"{oracle(lambda r: r['pa'] * r['d_act'] / r['d_hat'] * r['sv_act'] / r['s_hat']):.3f}")
    misses = sum(not within(r["pa"], r["pa_actual"]) for r in judged)
    cells: dict = defaultdict(list)
    for r in judged:
        cells[("sano" if r["d_act"] >= 0.9 else "infortuni/assenze", "tiene il posto" if r["kept"] else
               "perde il posto")].append(r)
    for (health, place), v in sorted(cells.items(), key=lambda kv: -len(kv[1])):
        miss = [r for r in v if not within(r["pa"], r["pa_actual"])]
        print(f"  {health:18s} {place:15s} n {len(v):4d} quota {1 - len(miss) / len(v):.2f} fuori {len(miss):3d} "
              f"({len(miss) / misses:.0%}; {sum(r['pa'] > 1.25 * r['pa_actual'] for r in miss)} sopra, "
              f"{sum(r['pa'] < 0.8 * r['pa_actual'] for r in miss)} sotto) rapporto mediano "
              f"{median(r['pa'] / r['pa_actual'] for r in v):.2f} · D {mean(r['d_hat'] for r in v):.2f}/"
              f"{mean(r['d_act'] for r in v):.2f} · S {mean(r['s_hat'] for r in v):.2f}/{mean(r['sv_act'] for r in v):.2f}")


if __name__ == "__main__":
    main()
