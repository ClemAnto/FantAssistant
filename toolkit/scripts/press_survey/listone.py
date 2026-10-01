"""Step 1: the listone, grouped by club, with FVM - the survey's perimeter and its FVM column.

Reads the cached listone the toolkit already downloaded (`data/cache/listone_<platform>_<season>.xlsx`,
fantacalcio.it's own file) and writes `listone_<platform>.json` and `ceduti.json` (the «Ceduti» sheet: the asterisk
on the site). `$PRESS_SURVEY_PLATFORM` = euro (default, the 28/09 survey) | default (the Serie A listone, 01/10).
The two files differ by ONE column: the EuroLeghe listone carries «Nazione» (the league) after the name, the Serie A
one does not, so every later index shifts by one - read by header name, never by position.
usage: python listone.py [SEASON]   (default 2026-27)
"""
import collections, json, os, pathlib, sys

import openpyxl

REPO = pathlib.Path(__file__).resolve().parents[3]
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
WORK.mkdir(parents=True, exist_ok=True)
PLATFORM = os.environ.get("PRESS_SURVEY_PLATFORM", "euro")
season = sys.argv[1] if len(sys.argv) > 1 else "2026-27"
book = openpyxl.load_workbook(REPO / "data" / "cache" / f"listone_{PLATFORM}_{season}.xlsx", read_only=True)


def rows(sheet):
    # two header rows: the title, then Id, R, RM, Nome, [Nazione,] Squadra, Qt.A, Qt.I, Diff., Qt.A M, Qt.I M,
    # Diff.M, FVM, FVM M - as dicts keyed by the header, because «Nazione» is on one listone only
    raw = list(book[sheet].iter_rows(values_only=True))
    head = list(raw[1])
    return [dict(zip(head, r)) for r in raw[2:] if r and r[0]]


clubs = collections.defaultdict(list)
for r in rows("Tutti"):
    clubs[(r.get("Nazione") or "Serie A", r["Squadra"])].append(
        dict(id=r["Id"], r=r["R"], rm=r["RM"], nome=r["Nome"], fvm=r["FVM"], fvm_m=r["FVM M"], qta=r["Qt.A"]))
out = {club: dict(league=league, players=sorted(ps, key=lambda p: -(p["fvm"] or 0)))
       for (league, club), ps in sorted(clubs.items())}
sold = collections.defaultdict(list)
for r in rows("Ceduti"):
    sold[r["Squadra"]].append(dict(id=r["Id"], r=r["R"], rm=r["RM"], nome=r["Nome"], fvm=r["FVM"], qta=r["Qt.A"],
                                   ceduto=True))
(WORK / f"listone_{PLATFORM}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
(WORK / "ceduti.json").write_text(json.dumps(sold, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(out)} clubs, {sum(len(v['players']) for v in out.values())} players, {sum(map(len, sold.values()))} ceduti")
