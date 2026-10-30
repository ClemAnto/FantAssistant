"""Refit the synthetic vote on ESPN's own features (saves included) against the real Serie A votes.

Read-only on the DB. The join goes ESPN row -> SofaScore's per-match row of the same man on the same day (which
carries the real round) -> the real vote of that round: `match_ratings` has no date, and a round is not a date.
Two seasons, each judged by the other (fit on one, score the other). Writes nothing unless `--write`, which
puts the coefficients fitted on BOTH seasons into `engine/vote_synth_coef.json`.

    python scripts/synth_vote/espn_refit.py [--write]
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from euroleghe_ingest.config import Config  # noqa: E402
from euroleghe_ingest.engine import vote_synth  # noqa: E402
from euroleghe_ingest.modules import elo as elo_module  # noqa: E402
from euroleghe_ingest import matching  # noqa: E402

SEASONS = ("2024-25", "2025-26")
conn = sqlite3.connect(f"file:{Config().db_path}?mode=ro", uri=True)
rows = conn.execute(
    """
    SELECT e.season, e.fc_id, e.club, e.opponent, e.home, e.team_goals, e.opponent_goals, e.starter, e.minutes,
           e.goals, e.assists, e.pen_scored, e.pen_missed, e.pen_saved, e.own_goals, e.yellows, e.reds,
           e.saves, e.goals_conceded, m.role, m.mv
    FROM espn_match_players e
    JOIN external_match_stats x ON x.fc_id = e.fc_id AND x.season = e.season AND x.source = 'sofascore'
         AND x.competition = 'serie_a' AND ABS(julianday(x.match_date) - julianday(e.match_date)) <= 1
    JOIN match_ratings m ON m.fc_id = e.fc_id AND m.season = e.season AND m.matchday = x.real_md
         AND m.platform = 'default' AND m.status = 'played' AND m.mv IS NOT NULL
    WHERE e.league = 'serie_a' AND e.season IN (?, ?) AND e.minutes > 0
    GROUP BY e.event_id, e.athlete_id
    """, SEASONS).fetchall()
cols = ["season", "fc_id", "club", "opponent", "home", "team_goals", "opponent_goals", "starter", "minutes",
        "goals", "assists", "pen_scored", "pen_missed", "pen_saved", "own_goals", "yellows", "reds", "saves",
        "goals_conceded", "role", "mv"]
data = [dict(zip(cols, row)) for row in rows]
levels = {season: elo_module.levels_at(conn, season[:4]) for season in SEASONS}
for row in data:
    lv = levels[row["season"]]
    row["elo_team"] = lv.get(matching.club_identity(row["club"])) if row["club"] else None
    row["elo_opp"] = lv.get(matching.club_identity(row["opponent"])) if row["opponent"] else None
print(f"joined rows: {len(data)} - " + ", ".join(f"{s} {sum(r['season'] == s for r in data)}" for s in SEASONS))

CURRENT = vote_synth.COEFFICIENTS


def design(sub, names, role):
    return np.array([[1.0] + [vote_synth.features(r, role)[n] for n in names] for r in sub])


def fit(sub, names, role, lam=1.0):
    a = design(sub, names, role)
    y = np.array([r["mv"] for r in sub])
    reg = lam * np.eye(a.shape[1])
    reg[0, 0] = 0
    w = np.linalg.solve(a.T @ a + reg, a.T @ y)
    return {"base": float(w[0]), **{n: float(v) for n, v in zip(names, w[1:])}}


report = {}
for role in "PDCA":
    names_no = [n for n in CURRENT[role] if n not in ("base", "saves")]
    names_sv = names_no + (["saves"] if role == "P" else [])
    for label, names in (("refit", names_no), ("refit+saves", names_sv)):
        for test in SEASONS:
            train = [r for r in data if r["role"] == role and r["season"] != test]
            score = [r for r in data if r["role"] == role and r["season"] == test]
            w = fit(train, names, role)
            err = [abs(vote_synth.raw_vote(r, role, {role: w}) - r["mv"]) for r in score]
            report.setdefault((role, label), []).append(float(np.mean(err)))
    for test in SEASONS:
        score = [r for r in data if r["role"] == role and r["season"] == test]
        err = [abs(vote_synth.raw_vote(r, role) - r["mv"]) for r in score]
        report.setdefault((role, "L3 as is"), []).append(float(np.mean(err)))
for (role, label), errs in sorted(report.items()):
    print(f"{role} {label:12} MAE " + " | ".join(f"{s} {e:.3f}" for s, e in zip(SEASONS, errs)))
for label in ("L3 as is", "refit", "refit+saves"):
    total = []
    for role in "PDCA":
        for test, err in zip(SEASONS, report[(role, label)]):
            n = sum(1 for r in data if r["role"] == role and r["season"] == test)
            total.append((err, n))
    print(f"ALL {label:12} MAE {sum(e * n for e, n in total) / sum(n for _, n in total):.3f}")

if "--write" in sys.argv:
    # A role is refitted only where the ESPN fit beats L3 on BOTH held-out seasons: L3 was fitted on 138,794
    # votes of five leagues, this on ~20,000 of Serie A alone, so a tie keeps the wider population.
    out = {"_note": "L3 (scripts/synth_vote, 2019-26, five leagues) except the roles listed in `_refitted`, "
                    "fitted on ESPN rows of Serie A 2024-25 + 2025-26 (scripts/synth_vote/espn_refit.py)",
           "_refitted": []}
    for role in "PDCA":
        base = report[(role, "L3 as is")]
        label = min(("refit", "refit+saves"), key=lambda lb: sum(report[(role, lb)]))
        if all(new < old for new, old in zip(report[(role, label)], base)):
            names = [n for n in CURRENT[role] if n not in ("base", "saves")]
            names += ["saves"] if label == "refit+saves" else []
            out[role] = {k: round(v, 4) for k, v in fit([r for r in data if r["role"] == role], names, role).items()}
            out["_refitted"].append(f"{role} {label}")
        else:
            out[role] = CURRENT[role]
    path = Path(vote_synth.__file__).with_name("vote_synth_coef.json")
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"written {path}")
