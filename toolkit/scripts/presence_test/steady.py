"""THE STEADY MEN OF EACH RUNG (operator, 01/10/2026): men who held the SAME rung three seasons running and in the
third had nothing unforeseen (at most 2 league games missed injured, banned, away or with the national team, one
club, Serie A, quoted in the auction's population), and how many games they really played. The check of the rung
table: if a stable, healthy titolare does not play ~every game, the table is not the problem, the rung is.

    python toolkit/scripts/presence_test/steady.py
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
from euroleghe_ingest.engine import status  # noqa: E402

PER_RUNG = 6
MAX_MISSED = 2


def season_rung(a) -> str | None:
    free = B.available(a)
    if free <= 0:
        return None
    return B.rung((a["sub"] + a["start"]) / free, B.minutes_per_game(a))


def main() -> None:
    conn = sqlite3.connect(f"file:{Config().db_path}?mode=ro", uri=True)
    agg, _at_club, clubs, _first, _europe = B.breakdown(conn)
    names = dict(conn.execute("SELECT fc_id, canonical_name FROM players"))
    role = {(fc, s): r for fc, s, r in conn.execute("SELECT fc_id, season, role_classic FROM rosters")}
    price = {(fc, s): p for fc, s, p in conn.execute(
        "SELECT fc_id, season, price_initial FROM listone_quotes WHERE platform = 'default'")}
    votes = {(fc, s): pv for fc, s, pv in conn.execute(
        "SELECT fc_id, season, pv FROM season_stats WHERE platform = 'default'")}
    club_name = {}
    for fc, s, club in conn.execute(
            "SELECT r.fc_id, r.season, c.canonical_name FROM rosters r JOIN clubs c USING(fc_club_id)"):
        club_name[(fc, s)] = club
    seasons = [f"{y}-{str(y + 1)[2:]}" for y in range(2017, 2026)]
    found = defaultdict(list)
    for (fc, season), a in agg.items():
        if season not in seasons or not a["n"]:
            continue
        y = int(season[:4])
        before = [agg.get((fc, f"{y - k}-{str(y - k + 1)[2:]}")) for k in (2, 1)]
        if any(b is None or not b["n"] for b in before):
            continue
        rungs = [season_rung(b) for b in before] + [season_rung(a)]
        if rungs[0] is None or len(set(rungs)) != 1:
            continue
        missed = a["inj"] + a["susp"] + a["other"] + a["naz"]
        if missed > MAX_MISSED or len(clubs.get((fc, season), {})) != 1 or a["it1"] < a["n"] * 0.9 or a["n"] < 30:
            continue
        r = role.get((fc, season))
        # quoted, and in the auction's population: a man the listone does not carry is not somebody you buy
        if r is None or price.get((fc, season)) is None or not B.bought(r, price.get((fc, season))):
            continue
        found[(rungs[0], r == "P")].append({
            "name": names.get(fc, fc), "season": season, "club": club_name.get((fc, season), "?"),
            "n": int(a["n"]), "missed": int(missed), "apps": int(a["sub"] + a["start"]),
            "start": int(a["start"]), "votes": votes.get((fc, season)), "min": B.minutes_per_game(a),
            "fc": fc})
    for keeper in (False, True):
        print("\nPORTIERI" if keeper else "GIOCATORI DI MOVIMENTO")
        for rung in status.LADDER:
            men = found.get((rung, keeper), [])
            if not men:
                continue
            with_votes = [m for m in men if m["votes"] is not None]
            print(f"\n{rung.upper()}: {len(men)} casi; in media {mean(m['apps'] / (m['n'] - m['missed']) for m in men) * 38:.1f}"
                  f" presenze e {mean(m['votes'] / (m['n'] - m['missed']) for m in with_votes) * 38:.1f} voti su 38")
            for m in sorted(men, key=lambda m: (-int(m["season"][:4]), (m["fc"] * 2654435761) % 2**32))[:PER_RUNG]:
                print(f"  {m['name']:22s} {m['season']} {m['club']:12s} disponibile {m['n'] - m['missed']:2d}/{m['n']} · "
                      f"presenze {m['apps']:2d} (titolare {m['start']:2d}) · voti {m['votes']} · {(m['min'] or 0):.0f}'")


if __name__ == "__main__":
    main()
