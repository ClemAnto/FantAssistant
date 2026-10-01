"""Last step: the survey's rungs -> `config/press_rungs.json`, the declared file the APP reads.

Only rows with a listone id, no FVM and no notes: what travels is the press's word, its start share, the club and
the DAY that club was surveyed. The toolkit never reads this file (tests/test_export.py forbids it) - the press
judges the boards.

A survey covers SOME clubs (the 28/09 one the 37 EuroLeghe clubs, the 01/10 one the 20 of the Serie A listone), so
the season block is MERGED by club and never replaced: the clubs this report carries are rewritten, every other
club keeps its own rows and its own date. The block's `as_of` is the most recent survey day, `source` names each
one, and every row carries its own `as_of` - the app shows a man's rung with the day HIS club was read.
"""
import json, os, pathlib

REPO = pathlib.Path(__file__).resolve().parents[3]
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
TODAY = os.environ.get("PRESS_SURVEY_DATE", "2026-09-28")
SEASON = os.environ.get("PRESS_SURVEY_SEASON", "2026-27")

report = json.loads((WORK / "report_data.json").read_text(encoding="utf-8"))
surveyed = {club["club"] for club in report["clubs"]}
path = REPO / "config" / "press_rungs.json"
current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
block = current.get(SEASON) or {}
old_as_of = block.get("as_of", "")
# what stays: every row of a club this report does not carry, with the day it was read (rows written before the
# per-row date existed take the block's)
# ...and in the project's ONE ladder (01/10/2026): the 28/09 survey wrote the press's own six words, two of which
# are retired on the word they converged into - `titolarissimo` -> `bandiera` (the operator's decision),
# `comprimario` -> `panchina` (same promise). `scarto` stays: it is measured apart from `riserva`.
LEGACY = {"titolarissimo": "bandiera", "comprimario": "panchina"}
players = {k: dict(v, as_of=v.get("as_of") or old_as_of, tier=LEGACY.get(v.get("tier"), v.get("tier")))
           for k, v in (block.get("players") or {}).items() if v.get("club") not in surveyed}
kept = len(players)
for club in report["clubs"]:
    for p in club["players"]:
        key = str(int(p["fc_id"])) if p["fc_id"] else None
        if key and key in players and players[key].get("as_of") == TODAY:
            # two press rows of THIS survey on one listone id: keep the first, the ranked one, and SAY so
            print(f"WARNING id {key}: {club['club']} {p['name']} ({p['tier']}) dropped, kept {players[key]['club']} "
                  f"({players[key]['tier']})")
        elif key:
            if key in players:   # an older survey filed him at another club: the newer read wins, and says so
                print(f"NOTE id {key}: {p['name']} was {players[key]['club']} ({players[key]['as_of']}), "
                      f"now {club['club']}")
            players[key] = {"tier": LEGACY.get(p["tier"], p["tier"]), "start_pct": p["start_pct"],
                            "club": club["club"], "as_of": TODAY}
# the source line is DERIVED from the rows, one entry per survey day: a hand-kept list would go on saying
# «37 club EuroLeghe» after ten of those clubs were read again on another day
by_day = {}
for v in players.values():
    by_day.setdefault(v["as_of"], set()).add(v["club"])
sources = [f"rilevazione stampa del {'/'.join(reversed(day.split('-')))} ({len(clubs)} club)"
           for day, clubs in sorted(by_day.items())]
current[SEASON] = {"as_of": max(by_day), "source": " + ".join(sources), "players": players}
current["_comment"] = (
    "The PRESS reading of each player's season-long role (EuroLeghe and Serie A clubs), DECLARED and dated - the "
    "same standing as board_rulings.json and player_notes.json: nobody here measures it, it is a judgement read from "
    "the press, club statements, Transfermarkt and FotMob, cross-checked by hand. The APP may show and price it "
    "instead of desc_titolarita when its switch is on (core/player-rulings.ts). The TOOLKIT never reads it: the "
    "press is a JUDGE of the boards and never an input of the claim, or the comparison it serves would be circular. "
    "Words are the project's ONE ladder since 01/10/2026 (bandiera, titolare, ballottaggio, panchina, riserva) plus "
    "scarto, the press's word under riserva; start_pct = estimated share of league STARTS when fit; as_of = the day "
    "that man's club was surveyed. Refreshing it means re-running the research (toolkit/scripts/press_survey), not "
    "a toolkit command.")
current = {"_comment": current.pop("_comment"), **current}
path.write_text(json.dumps(current, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(players) - kept} players of {len(surveyed)} clubs written, {kept} kept from other clubs -> {path}")
