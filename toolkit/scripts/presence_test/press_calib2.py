"""THE PRESS-RUNG CALIBRATION REPEATED ON OTHER DATA (operator, 01/10/2026: «vorrei ripetere la taratura con altri
dati»). Read-only. Same question as `press_calib.py` - if the press reads the role he holds NOW, how many votes
over the rest of the season - on data the first run never touched:

* the four foreign leagues of EuroLeghe (Premier, Liga, Bundesliga, Ligue 1), the operator's own game;
* the Serie A seasons 2015-16 .. 2018-19, before the bench's seven windows;
* the reading window: the next 5, 10 and 15 league games.

The outcome cannot be the fantacalcio votes there (EuroLeghe votes only its own perimeter, on its own calendar), so
it is a VOTE PROXY read from Transfermarkt's per-game rows: an appearance of at least `VOTE_MINUTES` minutes. The
threshold is fitted on Serie A, where both exist, so the proxy and the votes agree in total on the bench's own men
- and the proxy is then checked against the first run's table (`press_calib.py`), which read real votes.

Population: per platform and season, the men of the listone an auction of ten teams buys (the top 30 keepers, 80
defenders, 80 midfielders, 60 forwards by Qt.I - the definition of `build.QTI_BASE`, applied by rank because the two
listoni have different scales). Auction day: 5 September of the season.

    python toolkit/scripts/presence_test/press_calib2.py
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

SLOTS = {"P": 30, "D": 80, "C": 80, "A": 60}
LEAGUES = {"IT1": "Serie A", "GB1": "Premier", "ES1": "Liga", "L1": "Bundesliga", "FR1": "Ligue 1"}
GRID = [x / 100 for x in range(20, 101)]
# the operator's «via di mezzo» (01/10/2026): the band optimum on the two top rungs, the median below
MIDDLE = {"bandiera": "best", "titolare": "best", "ballottaggio": "median", "panchina": "median", "riserva": "median"}


def population(conn) -> list[tuple]:
    """(fc_id, season, platform, role) of the men a ten-team auction buys, by Qt.I rank inside role."""
    role = {(fc, s): r for fc, s, r in conn.execute("SELECT fc_id, season, role_classic FROM rosters")}
    ranked: dict = defaultdict(list)
    for fc, s, platform, price in conn.execute(
            "SELECT fc_id, season, platform, price_initial FROM listone_quotes WHERE price_initial IS NOT NULL"):
        r = role.get((fc, s))
        if r in SLOTS:
            ranked[(s, platform, r)].append((price, fc))
    out = []
    for (s, platform, r), men in ranked.items():
        for _price, fc in sorted(men, reverse=True)[:SLOTS[r]]:
            out.append((fc, s, platform, r))
    return out


def games(conn) -> dict:
    out: dict = defaultdict(list)
    for fc, season, day, comp, state, minutes in conn.execute(
            f"""SELECT fc_id, season, played_on, competition, state, minutes FROM tm_appearances
                WHERE is_national = 0 AND season IS NOT NULL
                  AND competition_type IN ({','.join('?' * len(B.LEAGUE_TYPES))})""", B.LEAGUE_TYPES):
        out[(fc, season)].append((day, comp, state, minutes))
    for v in out.values():
        v.sort(key=lambda x: (x[0], x[1] or "", x[2] or ""))
    return out


def vote_threshold(conn, all_games) -> int:
    """The minutes at which a Transfermarkt appearance stands for a vote: fitted on the bench's Serie A men."""
    rows = [r for r in B.engine_rows(conn, B.september_windows())]
    best, best_gap = 0, None
    for m in range(0, 46, 1):
        gap = 0.0
        for r in rows:
            after = [x for x in all_games.get((r["fc_id"], r["target"]), ()) if x[0] > r["auction"] and x[1] == "IT1"]
            proxy = sum(1 for x in after if x[2] == "played" and (x[3] or 0) >= m)
            gap += proxy - r["pa_actual"]
        if best_gap is None or abs(gap) < abs(best_gap):
            best, best_gap = m, gap
    print(f"soglia del voto: {best} minuti (scarto totale {best_gap:+.0f} voti su {len(rows)} uomini)")
    return best


def table(cases: list[tuple], label: str) -> None:
    by: dict = defaultdict(list)
    for group, word, share, n in cases:
        by[(group, word)].append((share, n))
    print(f"\n{label}")
    for group in ("movimento", "P"):
        for word in status.LADDER:
            v = by.get((group, word))
            if not v or len(v) < 15:
                continue
            shares = [s for s, _ in v]
            mid = median(shares)
            best = max(GRID, key=lambda s: (mean(B.in_band(s * n, a * n) for a, n in v), -abs(s - mid)))
            pick = best if MIDDLE[word] == "best" else mid
            inside = mean(B.in_band(pick * n, a * n) for a, n in v)
            print(f"  {group:9s} {word:12s} n {len(v):4d}  mediana {mid * 38:5.1f}  migliore {best * 38:5.1f}  "
                  f"via di mezzo {pick * 38:5.1f} su 38 ({inside:.0%} in banda)")


def main() -> None:
    conn = sqlite3.connect(f"file:{Config().db_path}?mode=ro", uri=True)
    all_games = games(conn)
    m = vote_threshold(conn, all_games)
    pop = population(conn)
    for window in (10, 5, 15):
        cases: dict = defaultdict(list)
        for fc, season, platform, role in pop:
            mine = all_games.get((fc, season), ())
            auction = f"{season[:4]}-09-05"
            after = [x for x in mine if x[0] > auction]
            if len(after) < window + 5:
                continue
            league = after[0][1]
            if league not in LEAGUES or (platform == "default") != (league == "IT1"):
                continue
            nxt = after[:window]
            fit = [x for x in nxt if x[2] not in ("injured", "absent")]
            if len(fit) < window / 2:
                continue
            played = [x for x in fit if x[2] == "played"]
            word = B.rung(len(played) / len(fit), mean((x[3] or 0) for x in played) if played else None)
            if word is None:
                continue
            same = [x for x in after if x[1] == league]
            votes = sum(1 for x in same if x[2] == "played" and (x[3] or 0) >= m)
            group = "P" if role == "P" else "movimento"
            era = ("Serie A 2015-19" if league == "IT1" and season < "2019-20" else
                   "Serie A 2019-26" if league == "IT1" else "EuroLeghe estero")
            cases[era].append((group, word, votes / len(same), len(same)))
        for era in ("Serie A 2019-26", "Serie A 2015-19", "EuroLeghe estero"):
            if window == 10 or era == "EuroLeghe estero":
                table(cases.get(era, []), f"{era} · finestra {window} partite · voti = presenze da {m}'+")


if __name__ == "__main__":
    main()
