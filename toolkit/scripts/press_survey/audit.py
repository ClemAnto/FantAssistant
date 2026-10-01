"""Completeness and consistency audit of a press survey (read-only). Run after `assemble.py`, before `to_config.py`.

What it asks, and why each question is the right one (written 29/09/2026 after doing it by hand once):
- COVERAGE against TODAY's listone (the bundle's `listone_quotes`, not the listone the survey read): a buyable man
  with no press rung falls back to the sheet's rung in the app, which is correct but should be a known list.
- ONE listone id on two press rows: `to_config` keeps the first, so the second is silently lost.
- The WORD against the agent's own start share, on the thresholds INSTRUCTIONS.md gives (titolare >= 70, ...).
- A man of the typical XI filed comprimario/riserva/scarto: the XI fields him, so he owns a shirt or disputes one.
- PLACES: titolari plus contested places must make eleven. Contested places are counted per GROUP of rivals, the
  group's shares summing to ~100 per place - agents list the man himself among his rivals and four men can share
  two shirts, so a per-man sum of shares is NOT a check (that mistake read 39 false anomalies on 29/09).
`--skip-league "Serie A"` leaves a championship out.
"""
import collections, json, os, pathlib, sqlite3, sys, unicodedata

REPO = pathlib.Path(__file__).resolve().parents[3]
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
SEASON = os.environ.get("PRESS_SURVEY_SEASON", "2026-27")
PLATFORM = os.environ.get("PRESS_SURVEY_PLATFORM", "euro")
LIMITS = {"bandiera": (85, 100), "titolare": (70, 100), "panchina": (0, 60), "riserva": (0, 35), "scarto": (0, 10)}
TOP = ("bandiera", "titolare")
skip = set(sys.argv[sys.argv.index("--skip-league") + 1:][:1]) if "--skip-league" in sys.argv else set()


def words(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return "".join(c if c.isalpha() else " " for c in s).split()


def same_man(name, p):
    """A rival or XI name against a press row: full name, listone name, or the surname with its initial."""
    w = words(name)
    for other in (p["name"], p.get("listone")):
        o = words(other)
        if w and o and (w == o or (w[-1] == o[-1] and (len(w) == 1 or len(o) == 1 or w[0][0] == o[0][0]))):
            return True
    return False


report = json.loads((WORK / "report_data.json").read_text(encoding="utf-8"))
out = collections.defaultdict(list)
ids = collections.defaultdict(list)
for club in report["clubs"]:
    if club["league"] in skip:
        continue
    ps = club["players"]
    for p in ps:
        if p["fc_id"]:
            ids[int(p["fc_id"])].append(f"{club['club']} {p['name']}")
        lo, hi = LIMITS.get(p["tier"], (0, 100))
        if p["fc_id"] and not lo <= (p["start_pct"] or 0) <= hi:
            out["word against its own start share"].append(f"{club['club']}: {p['listone']} {p['tier']} {p['start_pct']}%")
        if p["tier"] not in LIMITS and p["tier"] != "ballottaggio":
            out["unknown word"].append(f"{club['club']}: {p['name']} {p['tier']!r}")
        inj = p.get("injury")
        if inj and not inj.get("return_date"):
            out["injury without a return date"].append(f"{club['club']}: {p['name']} - {inj.get('what')}")
    for name in club["xi"]:
        hit = next((p for p in ps if same_man(name, p)), None)
        if hit is None:
            out["XI name matching no press row"].append(f"{club['club']}: {name}")
        elif hit["tier"] in ("panchina", "riserva", "scarto"):
            out["XI man filed below ballottaggio"].append(f"{club['club']}: {hit['listone'] or hit['name']} {hit['tier']}")
    # contested places: union of ballottaggio rows through their rivals
    ball = [p for p in ps if p["tier"] == "ballottaggio"]
    parent = {id(p): id(p) for p in ps}
    lent = {}   # a titolare named as a rival lends the group the share the agent gave him there (Moleiro 30 on a wing)

    def root(x):
        while parent[x] != x:
            x = parent[x]
        return x
    for p in ball:
        for r in p.get("rivals") or []:
            q = next((q for q in ps if same_man(r["name"], q)), None)
            if q is None:
                out["rival matching no press row"].append(f"{club['club']}: {p['name']} vs {r['name']}")
            elif q is not p and q["tier"] == "ballottaggio":
                parent[root(id(p))] = root(id(q))
            elif q is not p:
                lent[(id(p), id(q))] = r.get("start_pct") or 0
    groups = collections.defaultdict(list)
    for p in ball:
        groups[root(id(p))].append(p)
    places = 0
    for key, g in groups.items():
        members = {id(p) for p in g}
        total = sum(p["start_pct"] or 0 for p in g) + sum(
            max(v for (a, b), v in lent.items() if a in members and b == q) for q in {b for (a, b) in lent if a in members})
        k = max(1, round(total / 100))
        places += k
        if abs(total - 100 * k) > 25:
            out["ballottaggio shares not ~100 per place"].append(
                f"{club['club']}: {'/'.join(p['listone'] or p['name'] for p in g)} = {total}")
    top = sum(1 for p in ps if p["tier"] in TOP)
    if top + places != 11:
        out["titolari + contested places != 11"].append(f"{club['club']}: {top} + {places}")

for i, rows in ids.items():
    if len(rows) > 1:
        out["one listone id on two press rows"].append(f"{i}: {' | '.join(rows)}")

bundle = REPO / "data" / "export" / SEASON / "bundle.sqlite"
if bundle.exists():
    surveyed = {i for i in ids}
    clubs = {c["club"] for c in report["clubs"] if c["league"] not in skip}
    with sqlite3.connect(f"file:{bundle}?mode=ro", uri=True) as db:
        for fc, name, fvm, club in db.execute(
                "select q.fc_id, p.canonical_name, q.fvm, c.canonical_name from listone_quotes q "
                "join players p on p.fc_id = q.fc_id left join clubs c on c.fc_club_id = q.fc_club_id "
                "where q.season = ? and q.platform = ? and not coalesce(q.sold, 0) order by q.fvm desc", (SEASON, PLATFORM)):
            if club in clubs and fc not in surveyed:
                out["buyable today, no press rung"].append(f"{club}: {name} (FVM {fvm:g}, id {fc})")
else:
    out["not checked"].append(f"coverage: no bundle at {bundle}")

print(f"{sum(c['league'] not in skip for c in report['clubs'])} clubs, {len(ids)} listone ids")
for k, v in out.items():
    print(f"\n== {k}: {len(v)}")
    for line in v:
        print("   ", line)
print("\nno findings" if not out else "")
