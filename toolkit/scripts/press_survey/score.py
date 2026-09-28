"""Agreement of a sheet folder's season board with the press report of 28/09/2026.

usage: python score.py sheet_base sheet_K3 ...
Same metre as rose/compare.py: XI in common, same band (4 bands), 2+ bands apart, |claim - press %| MAE,
split by whether the man is one of the 'arrivals without history' (no previous-season row).
"""
import os, csv, json, re, sys, unicodedata, pathlib, collections

REPO = pathlib.Path(__file__).resolve().parents[3]
# Everything these scripts WRITE carries names, FVM and paid-source pages, and the repository is public, so
# it lives under data/reports/ (gitignored) and never next to the code.
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
WORK.mkdir(parents=True, exist_ok=True)
HERE = WORK / "experiments"
PRESS = json.loads((WORK / "report_data.json").read_text(encoding="utf-8"))
OUR = {"bandiera": 0, "titolarissimo": 0, "titolare": 0, "ballottaggio": 1, "panchina": 2, "riserva": 3}
PR = {"titolarissimo": 0, "titolare": 0, "ballottaggio": 1, "comprimario": 1, "riserva": 2, "scarto": 3}


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "").translate(str.maketrans({"ı": "i", "ø": "o", "ł": "l"})))
    return re.sub(r"[^a-z ]", " ", s.encode("ascii", "ignore").decode().lower()).split()


def in_xi(p, xi):
    cand = [norm(p["name"]), norm(p["listone"] or "")]
    for n in (norm(x) for x in xi):
        for c in cand:
            if n and c and (n == c or n[-1] == c[-1] or set(n) <= set(c) or set(c) <= set(n)):
                return True
    return False


def score(folder):
    board = json.loads((HERE / folder / "boards.json").read_text(encoding="utf-8"))
    with open(HERE / folder / "players.csv", encoding="utf-8-sig") as f:
        sheet = {int(float(r["fc_id"])): r for r in csv.DictReader(f) if r.get("fc_id")}
    ours = {int(k): v for k, v in board["titolarita"].items()}
    claim = {}
    for cb in board["clubs"].values():
        for line in cb["lines"].values():
            for m in line:
                claim[int(m["fc_id"])] = max(claim.get(int(m["fc_id"]), 0), m.get("claim") or 0)
                for d in m.get("duels") or []:
                    claim.setdefault(int(d["fc_id"]), d.get("claim") or 0)
    tot = collections.Counter()
    for grp in ("all", "arrivals"):
        tot[grp] = collections.Counter()
    out = {g: collections.Counter() for g in ("all", "no_prev")}
    gaps = {g: [] for g in out}
    for c in PRESS["clubs"]:
        seen = set()
        for p in c["players"]:
            fid = p["fc_id"]
            if not fid or fid in seen or fid not in ours:
                continue
            seen.add(fid)
            o = ours[fid]
            row = sheet.get(fid, {})
            groups = ["all"] + (["no_prev"] if row and not row.get("why_pv_prev") else [])
            pxi = in_xi(p, c["xi"])
            band = OUR[o["status"]] - PR[p["tier"]]
            for g in groups:
                out[g]["n"] += 1
                out[g]["same"] += band == 0
                out[g]["far"] += abs(band) >= 2
                out[g]["lower"] += band >= 1
                out[g]["xi_both"] += pxi and o["in_eleven"]
                out[g]["xi_press"] += pxi
                if fid in claim and p["start_pct"] is not None:
                    gaps[g].append(p["start_pct"] - 100 * claim[fid])
    res = {}
    for g in out:
        n = out[g]["n"] or 1
        gl = gaps[g]
        res[g] = dict(n=out[g]["n"], same=f"{100 * out[g]['same'] / n:.1f}%", far=out[g]["far"],
                      lower=out[g]["lower"], xi=f"{out[g]['xi_both']}/{out[g]['xi_press']}",
                      claim_mae=round(sum(abs(x) for x in gl) / len(gl), 1) if gl else None,
                      claim_bias=round(sum(gl) / len(gl), 1) if gl else None)
    return res


for folder in sys.argv[1:]:
    r = score(folder)
    print(f"{folder:14} ALL {r['all']}\n{'':14} NO-PREV {r['no_prev']}")
