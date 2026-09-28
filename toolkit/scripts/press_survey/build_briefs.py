"""Merge TM usage + FotMob squad/injuries + listone FVM into one brief per club (data only, no tier decided here)."""
import os, json, re, unicodedata, pathlib, datetime as dt

REPO = pathlib.Path(__file__).resolve().parents[3]
# Everything these scripts WRITE carries names, FVM and paid-source pages, and the repository is public, so
# it lives under data/reports/ (gitignored) and never next to the code.
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
WORK.mkdir(parents=True, exist_ok=True)
HERE = WORK
TODAY = dt.date.fromisoformat(os.environ.get("PRESS_SURVEY_DATE", "2026-09-28"))
LEAGUES = ("Premier League", "Serie A", "Bundesliga", "LaLiga", "Ligue 1")
tm = json.loads((HERE / "tm_data.json").read_text(encoding="utf-8"))
fm = json.loads((HERE / "fm_data.json").read_text(encoding="utf-8"))
lst = json.loads((HERE / "listone_euro.json").read_text(encoding="utf-8"))
ced = json.loads((HERE / "ceduti.json").read_text(encoding="utf-8"))
SPECIAL = str.maketrans({"ı": "i", "ø": "o", "Ø": "o", "ł": "l", "Ł": "l", "đ": "d", "Đ": "d", "ß": "ss", "æ": "ae"})


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").translate(SPECIAL)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z ]", " ", s).split()


def match_listone(tm_name, cands):
    words = norm(tm_name)
    joined = " ".join(words)
    hits = []
    for p in cands:
        toks = (p["nome"] or "").split()
        init = [norm(t)[0] for t in toks if t.endswith(".") and norm(t)]  # "Jo." / "F.P." are initials
        sur = [w for t in toks if not t.endswith(".") for w in norm(t)]
        if not sur:
            continue
        if all(w in words for w in sur) or re.search(r"" + " ".join(sur) + r"", joined) or "".join(sur) == "".join(words):
            rest = [w for w in words if w not in sur]
            if init and rest and not any(w.startswith(init[0][:2]) or w.startswith(init[0][0]) and len(init[0]) == 1
                                         for w in rest):
                continue
            hits.append(p)
        elif words and all(w in sur for w in words) and len("".join(words)) >= 5:
            hits.append(p)  # TM uses a shorter name ("Gabriel" for "Gabriel Magalhaes")
    if len(hits) > 1:  # prefer the candidate carrying TM's LAST word (the surname), then the longest
        def score(p):
            sur = [w for t in p["nome"].split() if not t.endswith(".") for w in norm(t)]
            return (words[-1] in sur, len("".join(sur)))
        hits.sort(key=score, reverse=True)
        if score(hits[0]) != score(hits[1]):
            return hits[0]
    return hits[0] if len(hits) == 1 else (hits or None)


def match_fm(tm_name, members):
    w = norm(tm_name)
    for m in members:
        if norm(m["name"]) == w:
            return m
    last = w[-1] if w else ""
    c = [m for m in members if norm(m["name"]) and (norm(m["name"])[-1] == last or last in norm(m["name"]))]
    if len(c) == 1:
        return c[0]
    c = [m for m in members if set(norm(m["name"])) & set(w) and len(set(norm(m["name"])) & set(w)) >= 1
         and any(len(x) > 3 for x in set(norm(m["name"])) & set(w))]
    return c[0] if len(c) == 1 else None


def d(s):
    m = re.match(r"(\d\d)/(\d\d)/(\d{4})", s or "")
    return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def pct(a, b):
    return round(100 * a / b) if b else None


briefs = {}
for club, c in tm.items():
    fx = c["fixtures"]
    L = sum(f["played"] for f in fx if f["comp"] in LEAGUES)
    T = sum(f["played"] for f in fx)
    comps = sorted({f["comp"] for f in fx})
    L25 = max([r.get("squad", 0) for r in c["lg25"].values()] + [1])
    future = [f for f in fx if not f["played"] and f["date"] >= TODAY.isoformat()]
    nxt = future[:6]
    inj = {}
    for i in c["injuries"]:
        age, reason, since, back, missed = (i["cells"] + [""] * 5)[:5]
        bd = d(back)
        inj[i["pid"]] = dict(reason=reason, since=since, expected_return=back, missed_so_far=missed,
                             will_miss_all=sum(1 for f in future if f["date"] < bd.isoformat()) if bd else None,
                             will_miss_league=sum(1 for f in future if f["date"] < bd.isoformat() and f["comp"] in LEAGUES)
                             if bd else None)
    cand = lst[club]["players"] + ced.get(club, [])
    members = fm[club]["squad"]
    used, fm_used, rows = set(), set(), []
    for pid, r in c["all26"].items():
        pid = int(pid)
        lg = c["lg26"].get(str(pid), {})
        l25 = c["lg25"].get(str(pid), {})
        st_all = r["apps"] - r["on"]
        st_lg = lg.get("apps", 0) - lg.get("on", 0)
        m = match_listone(r["name"], cand)
        p = m if isinstance(m, dict) else None
        if p:
            used.add(p["id"])
        f = match_fm(r["name"], members)
        if f:
            fm_used.add(f["id"])
        rows.append(dict(
            tm_id=pid, name=r["name"], pos=r["pos"], age=r["age"],
            fc=(p or {}).get("nome"), fc_id=(p or {}).get("id"), role=(p or {}).get("r"), rm=(p or {}).get("rm"),
            fvm=(p or {}).get("fvm"), ceduto=bool((p or {}).get("ceduto")),
            ambiguous=[x["nome"] for x in m] if isinstance(m, list) else None,
            lg_apps=lg.get("apps", 0), lg_starts=st_lg, lg_on=lg.get("on", 0), lg_min=lg.get("minutes", 0),
            all_apps=r["apps"], all_starts=st_all, all_min=r["minutes"], cup_starts=st_all - st_lg,
            lg_min_pct=pct(lg.get("minutes", 0), 90 * L), all_min_pct=pct(r["minutes"], 90 * T),
            lg25_apps=l25.get("apps"), lg25_starts=(l25.get("apps", 0) - l25.get("on", 0)) if l25 else None,
            lg25_min=l25.get("minutes"), lg25_min_pct=pct(l25.get("minutes") or 0, 90 * L25) if l25 else None,
            tm_injury=inj.get(pid), fm_seen=bool(f), fm_pos=(f or {}).get("pos"),
            fm_injury=(f or {}).get("injury") if (f or {}).get("injured") else None, fm_rating=(f or {}).get("rating")))
    briefs[club] = dict(league=lst[club]["league"], tm_id=c["tm_id"], fm_id=fm[club]["fm_id"], coach=fm[club]["coach"],
                        league_played=L, all_played=T, competitions=comps, L25=L25,
                        next_matches=[f"{x['date']} {x['comp']} {x['venue']} {x['opp']}" for x in nxt],
                        players=rows,
                        listone_not_in_tm=[p for p in cand if p["id"] not in used],
                        fm_not_in_tm=[m for m in members if m["id"] not in fm_used])

(HERE / "briefs.json").write_text(json.dumps(briefs, ensure_ascii=False, indent=1), encoding="utf-8")


def text(club):
    b = briefs[club]
    out = [f"# {club} ({b['league']}) - coach (FotMob): {b['coach']}. TM id {b['tm_id']}, FotMob id {b['fm_id']}.",
           f"Matches played 2026-27: league {b['league_played']}, all comps {b['all_played']}. Competitions on the TM "
           f"calendar: {', '.join(b['competitions'])}. Last season league games ~{b['L25']}.",
           "Next fixtures: " + " | ".join(b["next_matches"]),
           "",
           "COLUMNS: name | TM pos | FotMob pos | age | listone (role/mantra) FVM | 26-27 LEAGUE apps/starts/subON/min (min% of"
           " available) | ALL COMPS apps/starts/min (min%) | cup starts | 25-26 LEAGUE at this club apps/starts/min (min%)"
           " | TM injury | FotMob injury"]
    for r in sorted(b["players"], key=lambda r: -(r["all_min"] or 0)):
        fc = (f"{r['fc']} ({r['role']}/{r['rm']}) FVM {r['fvm']}" + (" [CEDUTO/asterisco nel listone]" if r["ceduto"] else "")
              if r["fc"] else (f"AMBIGUOUS {r['ambiguous']}" if r["ambiguous"] else "NOT IN LISTONE"))
        ti = ""
        if r["tm_injury"]:
            i = r["tm_injury"]
            ti = (f"{i['reason']} since {i['since']} back {i['expected_return'] or '?'} -> misses "
                  f"{i['will_miss_all']} all comps ({i['will_miss_league']} league)")
        fi = json.dumps(r["fm_injury"], ensure_ascii=False) if r["fm_injury"] else ("" if r["fm_seen"] else "NOT IN FOTMOB SQUAD")
        l25 = (f"{r['lg25_apps']}/{r['lg25_starts']}/{r['lg25_min']} ({r['lg25_min_pct']}%)"
               if r["lg25_apps"] is not None else "not at club")
        out.append(f"{r['name']} | {r['pos']} | {r['fm_pos']} | {r['age']} | {fc} | "
                   f"{r['lg_apps']}/{r['lg_starts']}/{r['lg_on']}/{r['lg_min']} ({r['lg_min_pct']}%) | "
                   f"{r['all_apps']}/{r['all_starts']}/{r['all_min']} ({r['all_min_pct']}%) | {r['cup_starts']} | "
                   f"{l25} | {ti} | {fi}")
    if b["listone_not_in_tm"]:
        out.append("\nLISTONE players NOT matched in the TM squad (left? loan? name mismatch?): " + "; ".join(
            f"{p['nome']} ({p['r']}, FVM {p['fvm']}, id {p['id']}{', CEDUTO' if p.get('ceduto') else ''})"
            for p in b["listone_not_in_tm"]))
    if b["fm_not_in_tm"]:
        out.append("FotMob squad members NOT matched in TM: " + "; ".join(
            f"{m['name']} ({m['pos']}{', injured ' + json.dumps(m['injury']) if m['injured'] else ''})"
            for m in b["fm_not_in_tm"]))
    return "\n".join(out)


(HERE / "briefs").mkdir(exist_ok=True)
for club in briefs:
    (HERE / "briefs" / f"{club}.txt").write_text(text(club), encoding="utf-8")
print(len(briefs), "briefs;", sum(len(b["players"]) for b in briefs.values()), "TM players;",
      sum(1 for b in briefs.values() for r in b["players"] if r["fc"]), "matched to listone;",
      sum(len(b["listone_not_in_tm"]) for b in briefs.values()), "listone rows unmatched;",
      sum(1 for b in briefs.values() for r in b["players"] if not r["fm_seen"]), "TM rows not in FotMob")
