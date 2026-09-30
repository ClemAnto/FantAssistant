"""HOW MANY GAMES EACH RUNG PLAYS, with nothing unforeseen (operator, 01/10/2026): «senza infortuni e imprevisti, quante
presenze ci aspettiamo da un titolare? da uno in ballottaggio? da una riserva? - attenzione a non mischiare minutaggio
e gradino».

Read-only. The rung is the one KNOWN at the auction (5 September): the ladder of `engine/status.py` on last season's two
axes - the share of the games he was fit for in which he played, and his minutes per game - without the board's gate
(a past window has no drawn board), which is `build.rung`. The outcome is the season after the auction on
Transfermarkt's per-game rows, counted ONLY over the games he was fit for, so injuries, bans and national duty are out
of it by construction: appearances / games fit for, and votes / games fit for (a cameo of a few minutes often gets no
vote, and the fantacalcio counts votes). «× 38» is that share on a full season.

The minutes axis is kept apart on purpose: the top four rungs all ask for the same share (>80%) and differ only by the
minutes floor, so if the minutes do not move the games played, those four rungs are ONE number of games.

    python toolkit/scripts/presence_test/rungs.py
"""
from __future__ import annotations

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
from euroleghe_ingest.engine import status  # noqa: E402


def main() -> None:
    conn = sqlite3.connect(f"file:{Config().db_path}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    games = B.league_games(conn)
    sept = B.engine_rows(conn, B.september_windows())
    B.annotate(sept, agg, at_club, clubs, first, europe, mv)
    by = defaultdict(list)
    for r in sept:
        a1 = r["a1"]
        if a1 is None or r["pa_actual"] is None:
            continue
        free_prev = B.available(a1)
        if free_prev <= 0:
            continue
        share_prev = (a1["sub"] + a1["start"]) / free_prev
        rung = B.rung(share_prev, B.minutes_per_game(a1))
        after = [state for day, _c, state, _a in games.get((r["fc_id"], r["target"]), ()) if day > r["auction"]]
        fit_for = [s for s in after if s not in ("injured", "absent")]
        if len(fit_for) < 10:
            continue
        played = sum(s == "played" for s in fit_for)
        by[(rung, r["role"] == "P")].append({"apps": played / len(fit_for),
                                             "votes": min(r["pa_actual"] / len(fit_for), 1.0),
                                             "change": r["club_change"]})
    print(f"{'gradino (stagione prima)':26s} {'n':>5s}  {'presenze':>9s} {'× 38':>6s}  {'voti':>6s} {'× 38':>6s}  "
          f"{'mediana voti':>12s}   (sulle partite in cui era disponibile)")
    for keeper in (False, True):
        print("PORTIERI" if keeper else "GIOCATORI DI MOVIMENTO")
        for rung in status.LADDER:
            rows = by.get((rung, keeper), [])
            if not rows:
                continue
            apps, votes = mean(x["apps"] for x in rows), mean(x["votes"] for x in rows)
            print(f"  {rung:24s} {len(rows):5d}  {apps:9.3f} {apps * 38:6.1f}  {votes:6.3f} {votes * 38:6.1f}  "
                  f"{median(x['votes'] for x in rows) * 38:12.1f}")
        # The top four rungs differ only by the minutes floor: are they one number of games?
        top = [x for rung in status.LADDER[:3] for x in by.get((rung, keeper), [])]
        if top:
            print(f"  {'(i primi tre insieme)':24s} {len(top):5d}  {mean(x['apps'] for x in top):9.3f} "
                  f"{mean(x['apps'] for x in top) * 38:6.1f}  {mean(x['votes'] for x in top):6.3f} "
                  f"{mean(x['votes'] for x in top) * 38:6.1f}")
    moved = [x for rows in by.values() for x in rows if x["change"]]
    stayed = [x for rows in by.values() for x in rows if not x["change"]]
    print(f"chi cambia club: {mean(x['votes'] for x in moved) * 38:.1f} voti su 38 · chi resta: "
          f"{mean(x['votes'] for x in stayed) * 38:.1f}")


if __name__ == "__main__":
    main()
