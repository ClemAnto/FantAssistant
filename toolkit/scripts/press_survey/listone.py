"""Step 1: the EuroLeghe listone, grouped by club, with FVM - the survey's perimeter and its FVM column.

Reads the cached listone the toolkit already downloaded (`data/cache/listone_euro_<season>.xlsx`, fantacalcio.it's
own file) and writes `listone_euro.json` and `ceduti.json` (the «Ceduti» sheet: the asterisk on the site).
usage: python listone.py [SEASON]   (default 2026-27)
"""
import collections, json, os, pathlib, sys

import openpyxl

REPO = pathlib.Path(__file__).resolve().parents[3]
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
WORK.mkdir(parents=True, exist_ok=True)
season = sys.argv[1] if len(sys.argv) > 1 else "2026-27"
book = openpyxl.load_workbook(REPO / "data" / "cache" / f"listone_euro_{season}.xlsx", read_only=True)


def rows(sheet):
    # two header rows: the title, then Id, R, RM, Nome, Nazione, Squadra, Qt.A, Qt.I, Diff., Qt.A M, Qt.I M, Diff.M, FVM, FVM M
    return [r for r in list(book[sheet].iter_rows(values_only=True))[2:] if r and r[0]]


clubs = collections.defaultdict(list)
for r in rows("Tutti"):
    clubs[(r[4], r[5])].append(dict(id=r[0], r=r[1], rm=r[2], nome=r[3], fvm=r[12], fvm_m=r[13], qta=r[6]))
out = {club: dict(league=league, players=sorted(ps, key=lambda p: -(p["fvm"] or 0)))
       for (league, club), ps in sorted(clubs.items())}
sold = collections.defaultdict(list)
for r in rows("Ceduti"):
    sold[r[5]].append(dict(id=r[0], r=r[1], rm=r[2], nome=r[3], fvm=r[12], qta=r[6], ceduto=True))
(WORK / "listone_euro.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
(WORK / "ceduti.json").write_text(json.dumps(sold, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(out)} clubs, {sum(len(v['players']) for v in out.values())} players, {sum(map(len, sold.values()))} ceduti")
