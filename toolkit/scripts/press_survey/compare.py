"""Our EuroLeghe sheet + season board (28/09/2026) against the press report of the same day, on titolarità."""
import os, json, gzip, re, unicodedata, pathlib, collections

REPO = pathlib.Path(__file__).resolve().parents[3]
# Everything these scripts WRITE carries names, FVM and paid-source pages, and the repository is public, so
# it lives under data/reports/ (gitignored) and never next to the code.
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
WORK.mkdir(parents=True, exist_ok=True)
HERE = WORK
EXP = REPO / "data" / "export" / os.environ.get("PRESS_SURVEY_SEASON", "2026-27")
press = json.loads((HERE / "report_data.json").read_text(encoding="utf-8"))
sheet = json.load(gzip.open(EXP / "sheets" / "euroleghe.json.gz", "rt", encoding="utf-8"))
board = json.loads((EXP / "boards" / "euroleghe.json").read_text(encoding="utf-8"))
cols = {c: i for i, c in enumerate(sheet["columns"])}
col = lambda r, c: r[cols[c]] if c in cols else None

# our per-man reading: rung + appearance share from the board's own ladder; claim + drawn from the board lines
ours = {}
for fid, t in board["titolarita"].items():
    ours[int(fid)] = dict(rung=t["status"], play=t["play"], minutes=t["minutes"], in_xi=bool(t["in_eleven"]))
claim = {}
for club, cb in board["clubs"].items():
    for line in cb["lines"].values():
        for m in line:
            claim[int(m["fc_id"])] = max(claim.get(int(m["fc_id"]), 0), m.get("claim") or 0)
            for d in m.get("duels") or []:
                claim.setdefault(int(d["fc_id"]), d.get("claim") or 0)
sheet_rows = {int(col(r, "fc_id")): r for r in sheet["rows"] if col(r, "fc_id")}

OUR_BAND = {"bandiera": 0, "titolarissimo": 0, "titolare": 0, "ballottaggio": 1, "panchina": 2, "riserva": 3}
PRESS_BAND = {"titolarissimo": 0, "titolare": 0, "ballottaggio": 1, "comprimario": 1, "riserva": 2, "scarto": 3}
BAND = ["fisso", "in bilico", "panchina", "fuori"]


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").translate(str.maketrans({"ı": "i", "ø": "o", "ł": "l"})))
    return re.sub(r"[^a-z ]", " ", s.encode("ascii", "ignore").decode().lower()).split()


def in_press_xi(p, xi):
    names = [norm(x) for x in xi]
    cand = [norm(p["name"]), norm(p["listone"] or "")]
    for n in names:
        for c in cand:
            if n and c and (n == c or n[-1] == c[-1] or set(n) <= set(c) or set(c) <= set(n)):
                return True
    return False


clubs_out, allrows = [], []
for c in press["clubs"]:
    cb = board["clubs"].get(c["club"], {})
    rows = []
    press_ids = set()
    for p in c["players"]:
        fid = p["fc_id"]
        if not fid or fid in press_ids:  # two press rows on one listone id (the two Miley): keep the first, the ranked one
            continue
        press_ids.add(fid)
        o = ours.get(fid)
        s = sheet_rows.get(fid)
        pb = PRESS_BAND.get(p["tier"])
        ob = OUR_BAND.get(o["rung"]) if o else None
        pxi = in_press_xi(p, c["xi"])
        cl = claim.get(fid)
        row = dict(club=c["club"], league=c["league"], name=p["listone"] or p["name"], full=p["name"], role=p["role"],
                   fvm=p["fvm"], press_tier=p["tier"], press_pct=p["start_pct"], press_xi=pxi,
                   rivals=p["rivals"], note=p["note"], injury=bool(p["injury"]),
                   on_sheet=bool(s), our_rung=o["rung"] if o else None, our_play=round(100 * o["play"]) if o and o["play"] is not None else None,
                   our_xi=o["in_xi"] if o else False, our_claim=round(100 * cl) if cl is not None else None,
                   our_minutes=o["minutes"] if o else None,
                   engine_pv=col(s, "engine_pv_pred") if s else None,
                   band_gap=(ob - pb) if (ob is not None and pb is not None) else None)
        # a difference worth showing: the XI disagrees, the band is 2+ apart, or the starting share is 30+ points apart
        why = []
        if row["our_xi"] != pxi and (pxi or row["our_xi"]):
            why.append("undici")
        if row["band_gap"] is not None and abs(row["band_gap"]) >= 2:
            why.append("fascia")
        if row["our_claim"] is not None and row["press_pct"] is not None and abs(row["our_claim"] - row["press_pct"]) >= 30:
            why.append("quota")
        row["why"] = why
        row["no_prev"] = bool(s) and col(s, "why_pv_prev") is None
        row["blend_now"] = col(s, "desc_blend_now") if s else None
        row["now_matches"] = col(s, "desc_now_matches") if s else None
        row["now_rounds"] = col(s, "desc_now_rounds") if s else None
        lower = row["band_gap"] is not None and row["band_gap"] >= 1 or (pxi and not row["our_xi"])
        higher = row["band_gap"] is not None and row["band_gap"] <= -1 or (row["our_xi"] and not pxi)
        if not why:
            row["cause"] = None
        elif pxi and not row["our_xi"] and row["injury"]:
            row["cause"] = "infortunato"      # the press draws him when fit, our season board discounts the time out
        elif lower and row["no_prev"]:
            row["cause"] = "arrivo"           # no previous season on this platform: the prior still weighs half
        elif higher and not row["no_prev"] and (row["now_matches"] or 0) < 0.6 * (row["now_rounds"] or 1):
            row["cause"] = "posto perso"      # strong last season, little this season: our prior is slow to let go
        elif cb.get("board_shape") and c["module"] and cb.get("board_shape") != c["module"]:
            row["cause"] = "modulo"
        else:
            row["cause"] = "gerarchia"        # same data, different reading of who is ahead
        row["gap"] = (row["press_pct"] - row["our_claim"]) if row["our_claim"] is not None and row["press_pct"] is not None else None
        rows.append(row)
    # men our sheet places at this club that the press does not have in the squad
    ghost = []
    for fid, s in sheet_rows.items():
        if col(s, "club") == c["club"] and fid not in press_ids:
            o = ours.get(fid)
            disc = next((d for d in c["discrepancies"] if set(norm(d["name"])) & set(norm(col(s, "name"))) and
                         any(len(w) > 3 for w in set(norm(d["name"])) & set(norm(col(s, "name"))))), None)
            ghost.append(dict(name=col(s, "name"), rung=o["rung"] if o else None, in_xi=o["in_xi"] if o else False,
                              engine_pv=col(s, "engine_pv_pred"), press_says=disc["issue"] if disc else None))
    xi_ours = [r["name"] for r in rows if r["our_xi"]]
    xi_press = [r["name"] for r in rows if r["press_xi"]]
    common = len(set(xi_ours) & set(xi_press))
    clubs_out.append(dict(club=c["club"], league=c["league"], coach=c["coach"], press_module=c["module"],
                          our_module=cb.get("board_shape"), xi_common=common, xi_ours=xi_ours, xi_press=xi_press,
                          rows=rows, ghost=ghost))
    allrows += rows

# summary numbers
both = [r for r in allrows if r["our_rung"] and r["press_tier"]]
cross = collections.Counter((BAND[OUR_BAND[r["our_rung"]]], BAND[PRESS_BAND[r["press_tier"]]]) for r in both)
q = [r for r in allrows if r["gap"] is not None]
mae = sum(abs(r["gap"]) for r in q) / len(q)
bias = sum(r["gap"] for r in q) / len(q)
mod_same = sum(1 for c in clubs_out if c["our_module"] and c["press_module"] and
               c["our_module"].replace(" ", "") == c["press_module"].replace(" ", ""))
summary = dict(clubs=len(clubs_out), players=len(allrows), compared=len(both), same_band=sum(1 for r in both if r["band_gap"] == 0),
               far_band=sum(1 for r in both if abs(r["band_gap"]) >= 2), cross={f"{a}|{b}": n for (a, b), n in cross.items()},
               claim_n=len(q), claim_mae=round(mae, 1), claim_bias=round(bias, 1),
               xi_common=sum(c["xi_common"] for c in clubs_out), xi_total=sum(len(c["xi_press"]) for c in clubs_out),
               module_same=mod_same, diffs=sum(1 for r in allrows if r["why"]),
               ghosts=sum(len(c["ghost"]) for c in clubs_out),
               ghosts_in_xi=sum(1 for c in clubs_out for g in c["ghost"] if g["in_xi"]))
summary["causes"] = dict(collections.Counter(r["cause"] for r in allrows if r["cause"]))
missing = []
for c in press["clubs"]:
    for p in c["players"]:
        if p["fc_id"] and p["fc_id"] not in sheet_rows and p["tier"] in ("titolarissimo", "titolare", "ballottaggio", "comprimario"):
            missing.append(dict(club=c["club"], name=p["listone"] or p["name"], tier=p["tier"], pct=p["start_pct"],
                                fvm=p["fvm"], listone_club=p["listone_club"], note=p["note"]))
summary["missing"] = len(missing)
out = dict(date="28/09/2026", missing=missing, sheet_generated=sheet["generated_at"], sheet_revision=sheet["sheet_revision"],
           summary=summary, clubs=clubs_out)
(HERE / "compare_data.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=1))
