"""Merge the agents' per-club JSON with the briefs (FVM, TM numbers) and compute the matches each injured man misses
from the TM calendar. Writes report_data.json and the final HTML."""
import os, json, pathlib, collections, datetime as dt, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))

REPO = pathlib.Path(__file__).resolve().parents[3]
# Everything these scripts WRITE carries names, FVM and paid-source pages, and the repository is public, so
# it lives under data/reports/ (gitignored) and never next to the code.
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
WORK.mkdir(parents=True, exist_ok=True)
CODE = pathlib.Path(__file__).parent
HERE = WORK
TODAY = os.environ.get("PRESS_SURVEY_DATE", "2026-09-28")
LEAGUES = ("Premier League", "Serie A", "Bundesliga", "LaLiga", "Ligue 1")
# the project's own ladder since 01/10/2026 (the 28/09 survey wrote the press's six words; `audit` and `to_config`
# still read those through LEGACY)
TIERS = ["bandiera", "titolare", "ballottaggio", "panchina", "riserva", "scarto"]
briefs = json.loads((HERE / "briefs.json").read_text(encoding="utf-8"))
tm = json.loads((HERE / "tm_data.json").read_text(encoding="utf-8"))
PLATFORM = os.environ.get("PRESS_SURVEY_PLATFORM", "euro")
lst = json.loads((HERE / f"listone_{PLATFORM}.json").read_text(encoding="utf-8"))
ced = json.loads((HERE / "ceduti.json").read_text(encoding="utf-8"))
by_fc = {p["id"]: dict(p, club=c) for c, v in lst.items() for p in v["players"]}
by_fc.update({p["id"]: dict(p, club=c) for c, v in ced.items() for p in v})

def _n(x):
    import unicodedata
    x = unicodedata.normalize("NFKD", (x or "").translate(str.maketrans({"ı": "i", "ø": "o", "ł": "l", "ß": "ss"})))
    return re.sub(r"[^a-z ]", " ", x.encode("ascii", "ignore").decode().lower()).split()


def by_name(rows, name, listone):
    w = _n(name)
    for r in rows:
        if _n(r["name"]) == w:
            return r
    for r in rows:  # the agent may write "Iñaki Williams" where TM writes "Iñaki Williams" or just a surname
        rw = _n(r["name"])
        if w and rw and (w[-1] == rw[-1]) and (len(w) == 1 or len(rw) == 1 or w[0][:1] == rw[0][:1]):
            return r
    if listone:
        for r in rows:
            if r.get("fc") and _n(r["fc"]) == _n(listone):
                return r
    return None


IT_COMP = {"Italy Cup": "Coppa Italia", "Supercoppa Italiana": "Supercoppa", "UEFA Champions League": "Champions League",
           "UEFA Europa League": "Europa League", "UEFA Conference League": "Conference League", "EFL Cup": "League Cup",
           "Community Shield": "Community Shield", "DFB-Pokal": "Coppa di Germania", "Trophée des Champions": "Supercoppa di Francia",
           "Franz-Beckenbauer-Supercup": "Supercoppa di Germania", "UEFA Super Cup": "Supercoppa UEFA"}
clubs, problems = [], []
for club in briefs:
    f = HERE / "out" / f"{club}.json"
    if not f.exists():
        problems.append(f"MISSING {club}")
        continue
    a = json.loads(f.read_text(encoding="utf-8"))
    b = briefs[club]
    brow = {r["tm_id"]: r for r in b["players"]}
    future = [x for x in tm[club]["fixtures"] if not x["played"] and x["date"] >= TODAY]
    players = []
    for p in a.get("players", []):
        r = brow.get(p.get("tm_id")) or by_name(b["players"], p.get("name"), p.get("listone")) or {}
        fc_id = p.get("fc_id") or r.get("fc_id")
        lp = by_fc.get(fc_id) if fc_id else None
        tier = (p.get("tier") or "").strip().lower()
        if tier not in TIERS:
            problems.append(f"{club}: bad tier {tier!r} for {p.get('name')}")
        inj = p.get("injury")
        if inj:
            rd = inj.get("return_date")
            if rd and re.match(r"\d{4}-\d\d-\d\d$", rd):
                inj["miss_all"] = sum(1 for x in future if x["date"] < rd)
                inj["miss_league"] = sum(1 for x in future if x["date"] < rd and x["comp"] in LEAGUES)
            else:
                inj["miss_all"] = inj["miss_league"] = None
        players.append(dict(
            name=p.get("name") or r.get("name"), listone=(lp or {}).get("nome") or p.get("listone"),
            fc_id=fc_id, role=(lp or {}).get("r") or p.get("role"), rm=(lp or {}).get("rm"),
            fvm=(lp or {}).get("fvm"), ceduto=bool((lp or {}).get("ceduto")),
            listone_club=(lp or {}).get("club"),
            tier=tier, start_pct=p.get("start_pct"), rivals=p.get("rivals") or [], note=p.get("note") or "",
            injury=inj, pos=r.get("pos"), age=r.get("age"),
            lg=f"{r.get('lg_apps', 0)}/{r.get('lg_starts', 0)}/{r.get('lg_min', 0)}" if r else None,
            lg_min_pct=r.get("lg_min_pct"), all_min_pct=r.get("all_min_pct"),
            cup_starts=r.get("cup_starts"), lg25_min_pct=r.get("lg25_min_pct")))
    # A listone id that two press rows reach through the BRIEF (a surname both men share) stays only with the row
    # the agent tagged itself; with no such row nobody gets it. Briefs built before that guard carry the defect.
    own = [p.get("fc_id") for p in a.get("players", [])]
    claims = collections.Counter(x["fc_id"] for x in players if x["fc_id"])
    for x, tagged in zip(players, own):
        if x["fc_id"] and claims[x["fc_id"]] > 1 and tagged != x["fc_id"]:
            problems.append(f"{club}: listone id {x['fc_id']} also reached by {x['name']}, dropped there")
            x.update(fc_id=None, listone=None, fvm=None, ceduto=False, listone_club=None)
    players.sort(key=lambda x: (TIERS.index(x["tier"]) if x["tier"] in TIERS else 9, -(x["fvm"] or 0)))
    clubs.append(dict(club=club, league=b["league"], coach=a.get("coach") or b["coach"], module=a.get("module"),
                      xi=a.get("typical_xi") or [], played_lg=b["league_played"], played_all=b["all_played"],
                      comps=[IT_COMP.get(c, c) for c in b["competitions"] if c not in LEAGUES and "Qualifying" not in c], next=b["next_matches"][:3],
                      players=players, discrepancies=a.get("roster_discrepancies") or [],
                      sources=a.get("sources") or [], source_notes=a.get("source_notes") or "",
                      listone_missing=[dict(nome=p["nome"], fvm=p["fvm"], r=p["r"], ceduto=bool(p.get("ceduto")))
                                       for p in b["listone_not_in_tm"]
                                       if p["id"] not in {x["fc_id"] for x in players}]))

order = {"Serie A": 0, "Premier League": 1, "Liga": 2, "Bundesliga": 3, "Ligue 1": 4}
clubs.sort(key=lambda c: (order.get(c["league"], 9), c["club"]))
data = dict(date="/".join(reversed(TODAY.split("-"))), listone_read=os.environ.get("PRESS_SURVEY_LISTONE_READ", ""), clubs=clubs,
            **json.loads((CODE / "overview.json").read_text(encoding="utf-8")))
(HERE / "report_data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
print(len(clubs), "clubs,", sum(len(c["players"]) for c in clubs), "players")
print("\n".join(problems) or "no problems")
if "--html" in sys.argv:
    tpl = (CODE / "template.html").read_text(encoding="utf-8")
    html = tpl.replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    stem = f"rose-{'euroleghe' if PLATFORM == 'euro' else 'serie-a'}-{TODAY}.html"
    out = REPO / "data" / "reports" / stem
    out.write_text(html, encoding="utf-8")
    (HERE / stem).write_text(html, encoding="utf-8")
    print("wrote", out, len(html) // 1024, "KB")
