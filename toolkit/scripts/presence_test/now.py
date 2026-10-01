"""THE NEW FORMULA'S Pa FOR TODAY (operator, 01/10/2026: «la colonna Pa - partite attese, nuova formula - dopo la
colonna SeSw in draft»).

The bench (`build.py`) judges the decomposed formula on past windows; nothing priced the season being played. This
does, with the bench's own September reading (`build.september_pa_of`, one definition): the window is the season in
progress with the auction TODAY, the prior is fitted on every July window of the bench (none of them predicts this
season, so none has read its outcome), the rounds already played enter with the engine's own K, and a spell open
today takes its expected games off. Read-only on the DB.

What it is NOT, said so: a gated number - the formula did not pass the gate on all quoted men (R33, gate
§7-septsexagies) and R33b is judged forward on this very season; and a measurement on EuroLeghe - the bench runs on
Serie A only (`partite-attese-scomposte-v1.md` §6.8), so the file carries Serie A's quoted men and nobody else.
Every row carries its share of the rounds left (`share`), so a reader can put it on the scale of the season it
shows: the app reports it on a FULL season, like every other number in matchdays.

    python toolkit/scripts/presence_test/now.py [--date YYYY-MM-DD] [--out FILE]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
import build as B  # noqa: E402
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.engine import evaluate, features  # noqa: E402

INPUT, TARGET = "2025-26", "2026-27"


def main() -> None:
    parser = argparse.ArgumentParser()
    config = Config()
    parser.add_argument("--db", default=str(config.db_path))
    parser.add_argument("--date", default=dt.datetime.now(tz=dt.UTC).date().isoformat())
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    agg, at_club, clubs, first, europe = B.breakdown(conn)
    mv = {(fc, s): v for fc, s, v in conn.execute(
        "select fc_id, season, mv from season_stats where platform='default' and mv is not null and pv >= 5")}
    games, spells = B.league_games(conn), B.open_spells(conn)

    # THE PRIOR: the September one of the bench (M1b + M4 + M7c + M7f), fitted on every July window.
    july = B.engine_rows(conn, B.july_windows())
    B.annotate(july, agg, at_club, clubs, first, europe, mv, own_club=B.SEPTEMBER_OWN_CLUB)
    prior = B.fit([r for r in july if r["target"] != TARGET], keeper_line=False,
                  cls=B.SEPTEMBER_CLASS, objective=B.SEPTEMBER_OBJECTIVE)
    k_key = next(k for k in evaluate.ADOPTED[B.PLATFORM] if k in evaluate.R20_ROUNDS)
    k_rounds = evaluate.R20_ROUNDS[k_key]
    table = B.residual_table(conn, f"{TARGET[:4]}-07-01")

    window = features.Window("now", INPUT, TARGET, args.date)
    data = evaluate.prepared_window(conn, window, B.PLATFORM, B.GAME)
    rounds, seen = float(data.matchdays_target), int(data.matchdays_seen or 0)
    rows = []
    for obs in data.observations:
        rows.append({"window": "now", "input": INPUT, "target": TARGET, "auction": args.date,
                     "fc_id": obs.fc_id, "name": obs.name, "role": obs.role_classic,
                     "club_change": bool(obs.club_change), "club_prev": obs.club_prev,
                     "club_target": obs.club_target, "N": rounds, "seen": seen, "pv_seen": obs.pv_seen,
                     "pa_engine": None, "pa_actual": None})
    B.annotate(rows, agg, at_club, clubs, first, europe, mv, own_club=B.SEPTEMBER_OWN_CLUB)
    out_rows = []
    for r in rows:
        r["out_open"] = B.expected_out(r, games, spells, table)
        pa = B.september_pa_of(r, prior, k_rounds)
        out_rows.append({"fcId": r["fc_id"], "name": r["name"], "role": r["role"], "context": r["ctx"],
                         "pa": round(pa, 1), "share": round(pa / rounds, 4) if rounds else None,
                         "seenVotes": r["pv_seen"], "outOpen": r["out_open"]})
    result = {
        "generated_at": dt.datetime.now(tz=dt.UTC).isoformat(timespec="seconds"),
        "formula": "Pa = N x D x S x europa x c (settembre: + giornate viste con il K del motore, - stop aperto)",
        "platform": B.PLATFORM, "input": INPUT, "target": TARGET, "auction": args.date,
        "seen": seen, "rounds": rounds, "k": k_rounds,
        "gated": False,
        "rows": out_rows,
    }
    exports = [d for d in (config.data_dir / "export").iterdir() if d.is_dir() and (d / "manifest.json").exists()]
    target = Path(args.out) if args.out else max(exports, key=lambda d: d.name) / "presence_now.json"
    target.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"{len(out_rows)} righe, viste {seen}, da giocare {rounds:g}, K {k_rounds:g} -> {target}")


if __name__ == "__main__":
    main()
