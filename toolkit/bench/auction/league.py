"""bench/auction/league - the same auction, then a CHAMPIONSHIP on a calendar.

`bench.py` ranks the participants by the fantapunti a season is worth. That answers "who scores more",
which is not the question a league is played on: a table is decided by 36 head-to-head matches, the
total is converted into GOALS on a staircase (66 -> 1, then one every 6), and everything a squad scores
below 66 in a matchday is thrown away. So a strategy can score more over a season and win fewer matches,
and that is a result of the REGULATION rather than of anybody's play.

    python -m bench.auction.league                 # the operator's table of 01/09/2026, A...L
    python -m bench.auction.league --json out.json # ...and the whole thing for the artifact

Everything measured here comes from the same place `bench.py` reads it: the engine's forecast picks the
eleven, the realised fantavoto and base vote say what it scored, and `bench.matchday` is called for both
- one definition of "what did this squad score on matchday 12", two readers.

WHAT IS DECLARED, so nobody reads it as a result: the ten participants and their profiles (the
operator's own table), the goal ladder and the championship points (`rules`), and the calendar itself.
THE SIDE OF A FIXTURE PAYS NOTHING in this league - there is no home bonus - so home and away are
cosmetic, kept only because a fixture list without them is unreadable. What separates the second andata
from the first is not the side but the ROUND: every leg is played on its own nine real matchdays.
"""
from __future__ import annotations

import argparse
import json
import statistics as st
from pathlib import Path

from . import rules
from .bench import (Team, WINDOWS_FILE, auction, engine_rate, extraction_order, line_up_order,
                    matchday, priced_pool, role_shares, tier_asks, window_seed)
from .profiles import PROFILES

#: THE TABLE THE OPERATOR ASKED FOR, 01/09/2026, in his own order and with his own letters: A the
#: engine, two for the top striker, three balanced, one expert with no plan, two novices, one defence.
#: Declared, like the profiles themselves.
LEAGUE_TABLE: tuple[tuple[str, str], ...] = (
    ("A", "ENGINE"),
    ("B", "P4 top striker"),
    ("C", "P4 top striker"),
    ("D", "P3 balanced"),
    ("E", "P3 balanced"),
    ("F", "P1a no plan, expert"),
    ("G", "P1b no plan, novice"),
    ("H", "P1b no plan, novice"),
    ("I", "P2 defence"),
    ("L", "P3 balanced"),
)

#: «2 andata e 2 ritorno»: every pair meets four times, twice per side. With ten participants that is
#: 4 x 9 = 36 matchdays, played on the real rounds 1...36 - so the last two rounds of the real season
#: are UNUSED, which is stated rather than folded into a fifth partial leg nobody asked for.
LEGS = 4


def round_robin(letters: tuple[str, ...]) -> list[list[tuple[str, str]]]:
    """One full round of everybody against everybody, by the circle method: `n-1` matchdays."""
    ring = list(letters)
    half = len(ring) // 2
    days: list[list[tuple[str, str]]] = []
    for _ in range(len(ring) - 1):
        days.append([(ring[i], ring[-1 - i]) for i in range(half)])
        ring = [ring[0], ring[-1], *ring[1:-1]]
    return days


def fixtures(letters: tuple[str, ...], legs: int = LEGS) -> list[list[tuple[str, str]]]:
    """The whole calendar: `legs` rounds, the sides swapped on every other one."""
    base = round_robin(letters)
    out: list[list[tuple[str, str]]] = []
    for leg in range(legs):
        for day in base:
            out.append([(a, b) if leg % 2 == 0 else (b, a) for a, b in day])
    return out


def play(home_points: float, away_points: float) -> tuple[int, int]:
    """The score of one match: each total converted on the league's own ladder."""
    return rules.goals(home_points), rules.goals(away_points)


def standings(rows: list[dict]) -> list[dict]:
    """The table, on the league's declared order: points, goal difference, goals, then fantapunti."""
    return sorted(rows, key=lambda r: (-r["table_points"], -(r["goals_for"] - r["goals_against"]),
                                       -r["goals_for"], -r["points"]))


def squad_rows(team: Team, fielded: dict[int, int], scored: dict[int, float]) -> list[dict]:
    """One row per man bought, in the order the engine would field him, with what he really gave."""
    out: list[dict] = []
    for role, men in line_up_order(team).items():
        for rank, man in enumerate(men, 1):
            out.append({
                "name": man["name"], "club": man.get("club"), "role": role, "rank": rank,
                "paid": man.get("paid", 0), "price": round(man["price"], 1),
                "pv_pred": round(man["pv_pred"], 1) if man.get("pv_pred") is not None else None,
                "fm_pred": round(man["fm_pred"], 2) if man.get("fm_pred") is not None else None,
                "steady": man.get("steady"),
                "fielded": fielded.get(man["id"], 0),
                "scored": round(scored.get(man["id"], 0.0), 1),
            })
    return out


def one_window(window: dict, table: tuple[tuple[str, str], ...],
               order: list[dict] | None = None, pool: list[dict] | None = None) -> dict:
    """Auction, then season, then championship - for one of the gate's windows and one order of lots."""
    pool = priced_pool(window) if pool is None else pool
    teams: dict[str, Team] = {}
    shares, rate, asks = role_shares(pool), engine_rate(pool), tier_asks(pool)
    for letter, profile in table:
        team = Team(letter, profile, None if profile == "ENGINE" else PROFILES[profile])
        team.rate = rate
        team.asks = asks
        team.matchdays = window["rounds"]
        if profile == "ENGINE":
            team.shares = shares
        teams[letter] = team
    auction(pool, list(teams.values()), order)

    letters = tuple(letter for letter, _ in table)
    calendar = fixtures(letters)
    days: dict[str, list[dict]] = {}
    fielded: dict[str, dict[int, int]] = {}
    scored: dict[str, dict[int, float]] = {}
    for letter, team in teams.items():
        order = line_up_order(team)
        rows = [matchday(order, window["votes"], window.get("base", {}), str(day))
                for day in range(1, len(calendar) + 1)]
        days[letter] = rows
        counts: dict[int, int] = {}
        totals: dict[int, float] = {}
        for index, row in enumerate(rows, 1):
            for man_id in row["fielded"]:
                counts[man_id] = counts.get(man_id, 0) + 1
                totals[man_id] = totals.get(man_id, 0.0) + window["votes"][str(man_id)][str(index)]
        fielded[letter], scored[letter] = counts, totals

    tally = {letter: {"letter": letter, "profile": teams[letter].profile,
                      "won": 0, "drawn": 0, "lost": 0, "goals_for": 0, "goals_against": 0,
                      "table_points": 0, "form": ""} for letter in letters}
    results: list[list[dict]] = []
    for index, day in enumerate(calendar):
        played: list[dict] = []
        for home, away in day:
            hp = days[home][index]["points"]
            ap = days[away][index]["points"]
            hg, ag = play(hp, ap)
            played.append({"home": home, "away": away, "hp": round(hp, 1), "ap": round(ap, 1),
                           "hg": hg, "ag": ag})
            for side, own, other in ((home, hg, ag), (away, ag, hg)):
                row = tally[side]
                row["goals_for"] += own
                row["goals_against"] += other
                if own > other:
                    row["won"] += 1
                    row["table_points"] += rules.WIN_POINTS
                    row["form"] += "V"
                elif own == other:
                    row["drawn"] += 1
                    row["table_points"] += rules.DRAW_POINTS
                    row["form"] += "N"
                else:
                    row["lost"] += 1
                    row["form"] += "P"
        results.append(played)

    rows: list[dict] = []
    for letter, team in teams.items():
        totals = {key: sum(row[key] for row in days[letter])
                  for key in ("points", "r_factor", "defence", "holes", "zeros", "killed", "no_base")}
        by_role = {role: sum(m.get("paid", 0) for m in team.men[role]) for role in team.men}
        rows.append({**tally[letter], **{key: round(value, 1) for key, value in totals.items()},
                     "spent": team.budget - team.left, "by_role": by_role,
                     "best": max(row["points"] for row in days[letter]),
                     "worst": min(row["points"] for row in days[letter]),
                     "under_floor": sum(1 for row in days[letter]
                                        if row["points"] < rules.GOAL_FLOOR),
                     "men": squad_rows(team, fielded[letter], scored[letter])})
    return {"key": window.get("key"), "input": window["input"], "target": window["target"],
            "rounds": window["rounds"], "matchdays": len(calendar), "draw": window.get("draw"),
            "table": standings(rows), "results": results}


def compact(win: dict) -> dict:
    """One drawn order, kept for the AGGREGATE and not for reading: no squads and no fixtures.

    Twenty urns per window is twenty championships, and the whole of what they are for is the spread -
    a single one measures the luck of that order and nothing else. The full detail of one of them is
    kept separately, and the page that draws it has to say which one it is.
    """
    return {"key": win["key"], "draw": win["draw"],
            "rows": [{"letter": r["letter"], "profile": r["profile"], "place": place,
                      "table_points": r["table_points"], "points": r["points"],
                      "goals_for": r["goals_for"], "goals_against": r["goals_against"],
                      "under_floor": r["under_floor"], "holes": r["holes"], "spent": r["spent"]}
                     for place, r in enumerate(standings(win["table"]), 1)]}


def run(table: tuple[tuple[str, str], ...] = LEAGUE_TABLE, draws: int = 0) -> dict:
    """The ten windows. `draws` = 0 calls the lots dearest first; N > 0 draws N extractions of each.

    What comes back carries BOTH readings and neither may hide the other: `windows` is the full detail
    of ONE order per window - the standings, the squads, every fixture - and `all` is every draw of
    every window in the compact form the aggregate needs. A page that shows only the first is showing
    one roll of the dice; one that shows only the second cannot be checked against a single auction.
    """
    windows = json.loads(WINDOWS_FILE.read_text(encoding="utf-8"))
    shown, every = [], []
    for key, window in windows.items():
        pool = priced_pool(window)
        for draw in range(max(1, draws)):
            order = extraction_order(pool, window_seed(key, draw)) if draws else None
            played = one_window({**window, "key": key, "draw": draw if draws else None},
                                table, order, pool)
            if draw == 0:
                shown.append(played)
            every.append(compact(played))
    return {"table": [{"letter": letter, "profile": profile} for letter, profile in table],
            "legs": LEGS, "goal_floor": rules.GOAL_FLOOR, "goal_step": rules.GOAL_STEP,
            "draws": draws, "windows": shown, "all": every}


def report(result: dict) -> None:
    print(f"extraction: {result['draws']} random draws per window" if result["draws"]
          else "extraction: called, dearest first")
    for window in result["windows"]:
        print(f"\n=== {window['key']}  {window['input']} -> {window['target']}  "
              f"({window['matchdays']} matchdays) ===")
        print(f"{'':2s} {'profile':22s} {'pt':>4s} {'V':>3s} {'N':>3s} {'P':>3s} {'GF':>4s} "
              f"{'GA':>4s} {'fanta':>7s} {'<66':>4s} {'holes':>6s} {'spent':>6s}")
        for row in window["table"]:
            print(f"{row['letter']:2s} {row['profile']:22s} {row['table_points']:4d} "
                  f"{row['won']:3d} {row['drawn']:3d} {row['lost']:3d} {row['goals_for']:4d} "
                  f"{row['goals_against']:4d} {row['points']:7.1f} {row['under_floor']:4d} "
                  f"{row['holes']:6.0f} {row['spent']:6d}")
    per_profile: dict[str, list[dict]] = {}
    for window in result["all"]:
        for row in window["rows"]:
            per_profile.setdefault(row["profile"], []).append(row)
    print(f"\n=== over the ten windows x {max(1, result['draws'])} draws, per profile ===")
    print(f"{'profile':22s} {'pt':>6s} {'place':>6s} {'titles':>7s} {'fanta':>8s} {'GF':>6s} "
          f"{'GA':>6s} {'<66':>5s} {'holes':>6s}")
    for profile in sorted(per_profile, key=lambda p: -st.mean(r["table_points"]
                                                              for r in per_profile[p])):
        rows = per_profile[profile]
        titles = sum(1 for r in rows if r["place"] == 1)
        print(f"{profile:22s} {st.mean(r['table_points'] for r in rows):6.1f} "
              f"{st.mean(r['place'] for r in rows):6.2f} {titles:3d}/{len(rows):<3d} "
              f"{st.mean(r['points'] for r in rows):8.1f} "
              f"{st.mean(r['goals_for'] for r in rows):6.1f} "
              f"{st.mean(r['goals_against'] for r in rows):6.1f} "
              f"{st.mean(r['under_floor'] for r in rows):5.1f} "
              f"{st.mean(r['holes'] for r in rows):6.1f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="the auction, then a championship on a calendar")
    parser.add_argument("--json", type=Path, help="write the whole thing out for the artifact")
    parser.add_argument("--random", dest="draws", nargs="?", type=int, const=20, default=0,
                        metavar="DRAWS",
                        help="the platform DRAWS the lots, DRAWS times per window (default 20)")
    args = parser.parse_args()
    if not WINDOWS_FILE.exists():
        raise SystemExit(f"missing {WINDOWS_FILE.name}: run bench/draft/extract.py first")
    result = run(LEAGUE_TABLE, args.draws)
    report(result)
    if args.json:
        # EXPLICIT UTF-8: on Windows the default encoding cannot re-read the names it just wrote.
        args.json.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        print(f"\nwritten {args.json} ({args.json.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
