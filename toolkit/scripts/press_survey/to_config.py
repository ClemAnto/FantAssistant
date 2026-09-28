"""Last step: the survey's rungs -> `config/press_rungs.json`, the declared file the APP reads.

Only rows with a listone id, no FVM and no notes: what travels is the press's word, its start share and the club.
The toolkit never reads this file (tests/test_export.py forbids it) - the press judges the boards.
"""
import json, os, pathlib

REPO = pathlib.Path(__file__).resolve().parents[3]
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
TODAY = os.environ.get("PRESS_SURVEY_DATE", "2026-09-28")
SEASON = os.environ.get("PRESS_SURVEY_SEASON", "2026-27")

report = json.loads((WORK / "report_data.json").read_text(encoding="utf-8"))
players = {}
for club in report["clubs"]:
    for p in club["players"]:
        key = str(int(p["fc_id"])) if p["fc_id"] else None
        if key and key not in players:   # two press rows on one listone id: keep the first, the ranked one
            players[key] = {"tier": p["tier"], "start_pct": p["start_pct"], "club": club["club"]}
path = REPO / "config" / "press_rungs.json"
current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
current[SEASON] = {"as_of": TODAY, "source": f"rilevazione stampa del {'/'.join(reversed(TODAY.split('-')))} "
                                             f"({len(report['clubs'])} club EuroLeghe)", "players": players}
path.write_text(json.dumps(current, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(players)} players -> {path}")
