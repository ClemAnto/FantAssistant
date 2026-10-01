"""HOW MANY VOTES A PRESS RUNG IS WORTH (operator, 01/10/2026: «è fondamentale tarare bene le giornate attese dai
gradini letti dalla stampa»). Read-only.

No past press survey exists, so the press is replaced by its BEST CASE: a reader who, on 5 September, knows the
role the coach is giving him NOW - the rung he holds over his club's next ten league games, on the ladder's own two
axes (`build.rung`: share of the games he was FIT for, minutes per game). What that reader cannot know is what
the press cannot know either: injuries to come, a January market, a sacking, form. So the conversion measured here
is «if the press is RIGHT about the role, how many votes over the rounds that remain», which is the number the app
needs - and it is a CEILING on what a real press reading is worth, because a real reading is sometimes wrong.

For each rung: the median of votes / rounds left, its quartiles, and the share that puts the most men inside 80-125%
of what they really got (the operator's measure). Population: the bench's September windows, base Qt.I per role.

    python toolkit/scripts/presence_test/press_calib.py
"""
from __future__ import annotations

import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, median, quantiles

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
import build as B  # noqa: E402
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.engine import status  # noqa: E402

NEXT_GAMES = 10
GRID = [x / 100 for x in range(20, 101)]


def main() -> None:
    conn = sqlite3.connect(f"file:{Config().db_path}?mode=ro", uri=True)
    comps = B.league_comps(conn)
    rows: dict = defaultdict(list)
    for fc, season, day, state, start, minutes in conn.execute(
            f"""SELECT fc_id, season, played_on, state, is_starting, minutes FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(B.LEAGUE_TYPES))})""", B.LEAGUE_TYPES):
        rows[(fc, season)].append((day, state, minutes or 0))
    for v in rows.values():
        v.sort()
    sept = [r for r in B.engine_rows(conn, B.september_windows()) if not B.abroad_on_day(r, comps)]
    by_rung: dict = defaultdict(list)
    for r in sept:
        nxt = [x for x in rows.get((r["fc_id"], r["target"]), ()) if x[0] > r["auction"]][:NEXT_GAMES]
        if len(nxt) < NEXT_GAMES:
            continue
        fit = [x for x in nxt if x[1] not in ("injured", "absent")]
        played = [x for x in fit if x[1] == "played"]
        if len(fit) < 5:
            continue                       # a man out for most of them has no role to read
        share = len(played) / len(fit)
        per_game = mean(x[2] for x in played) if played else None
        word = B.rung(share, per_game)
        if word is None:
            continue
        group = "P" if r["role"] == "P" else "movimento"
        by_rung[(group, word)].append((r["pa_actual"] / r["N"], r["N"]))
    print(f"{'gruppo':10s} {'gradino':13s} {'n':>4s}  mediana  p25-p75     media  migliore per la banda (quota dentro)")
    for group in ("movimento", "P"):
        for word in status.LADDER:
            v = by_rung.get((group, word))
            if not v or len(v) < 10:
                continue
            shares = [a for a, _n in v]
            q = quantiles(shares, n=4)
            mid = median(shares)
            best = max(GRID, key=lambda s: (mean(B.in_band(s * n, a * n) for a, n in v), -abs(s - mid)))
            inside = mean(B.in_band(best * n, a * n) for a, n in v)
            at_mid = mean(B.in_band(mid * n, a * n) for a, n in v)
            print(f"{group:10s} {word:13s} {len(v):4d}  {mid:.3f}  {q[0]:.2f}-{q[2]:.2f}  {mean(shares):.3f}  "
                  f"{best:.2f} ({inside:.0%})  = {best * 38:.1f} su 38 · alla mediana {mid * 38:.1f} su 38 ({at_mid:.0%})")


if __name__ == "__main__":
    main()
