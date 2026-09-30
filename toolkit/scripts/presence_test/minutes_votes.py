"""HOW MANY APPEARANCES BECOME A VOTE, by the minutes a man plays (operator, 01/10/2026): «per le panchine proviamo ad
aggiungere l'informazione del minutaggio medio per individuare i voti ricevuti, lo stesso anche per i ballottaggi».

A cameo of a few minutes often ends without a vote (SV), so for a man who comes on the question «how many games» and
«how many votes» part. Read-only. The bench's September population; the minutes are LAST season's minutes per game
played (known at the auction), the outcome is votes / appearances after the auction on the games he was fit for.
Printed per rung and per band of minutes, and the same with this season's own minutes (the upper bound: what the
share would be if the minutes were known).

    python toolkit/scripts/presence_test/minutes_votes.py
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

BANDS = ((0, 30), (30, 45), (45, 60), (60, 75), (75, 91))


def band_of(minutes: float) -> str:
    for low, high in BANDS:
        if low <= minutes < high:
            return f"{low}-{high - 1}'"
    return "?"


def main() -> None:
    conn = sqlite3.connect(f"file:{Config().db_path}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    games = B.league_games(conn)
    sept = B.engine_rows(conn, B.september_windows())
    B.annotate(sept, agg, at_club, clubs, first, europe, {})
    cells = defaultdict(list)
    for r in sept:
        a1 = r["a1"]
        if a1 is None or r["pa_actual"] is None or r["role"] == "P":
            continue
        free = B.available(a1)
        mins = B.minutes_per_game(a1)
        if free <= 0 or mins is None:
            continue
        rung = B.rung((a1["sub"] + a1["start"]) / free, mins)
        after = [s for d, _c, s, _a in games.get((r["fc_id"], r["target"]), ()) if d > r["auction"]]
        played = sum(s == "played" for s in after)
        if played < 5:
            continue
        cells[(rung, band_of(mins))].append(min(r["pa_actual"] / played, 1.0))
        cells[("tutti", band_of(mins))].append(min(r["pa_actual"] / played, 1.0))
    print(f"{'gradino':14s} " + " ".join(f"{band_of(low):>14s}" for low, _ in BANDS))
    for rung in ("ballottaggio", "panchina", "riserva", "titolare", "bandiera", "tutti"):
        line = [f"{rung:14s}"]
        for low, _high in BANDS:
            v = cells.get((rung, band_of(low)), [])
            line.append(f"{mean(v):6.3f} ({len(v):4d})" if len(v) >= 10 else f"{'-':>14s}")
        print(" ".join(line))
    print("valori: voti / presenze dopo il 5 settembre; minuti: la media per presenza della stagione prima")


if __name__ == "__main__":
    main()
