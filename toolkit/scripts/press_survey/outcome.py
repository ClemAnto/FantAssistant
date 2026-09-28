"""Judge back-dated variant sheets on what the men REALLY did after the sheet's date.

usage: python outcome.py sheet_b25 sheet_K3_25 ...
- play MAE / Spearman: desc_titolarita_play (predicted share of matches with a vote, when fit) against the
  realised share actual_pv / actual_rounds over the rounds AFTER the date (all men with actual_rounds > 0).
- band hit: the rung's band (fisso / in bilico / panchina / fuori) against the realised share cut at
  0.75 / 0.45 / 0.15 - the same cut for every variant, so it compares variants and says nothing absolute.
- XI: per club, the board's eleven against the 11 men with the most realised votes after the date.
The same metre for every folder; the variants differ by one parameter, so the difference is theirs.
"""
import os, csv, json, sys, pathlib, collections

REPO = pathlib.Path(__file__).resolve().parents[3]
# Everything these scripts WRITE carries names, FVM and paid-source pages, and the repository is public, so
# it lives under data/reports/ (gitignored) and never next to the code.
WORK = pathlib.Path(os.environ.get("PRESS_SURVEY_DIR", REPO / "data" / "reports" / "press_survey"))
WORK.mkdir(parents=True, exist_ok=True)
HERE = WORK / "experiments"
OUR = {"bandiera": 0, "titolarissimo": 0, "titolare": 0, "ballottaggio": 1, "panchina": 2, "riserva": 3}


def band(r):
    return 0 if r >= 0.75 else 1 if r >= 0.45 else 2 if r >= 0.15 else 3


def rank(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2
        i = j + 1
    return out


def spearman(a, b):
    ra, rb = rank(a), rank(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = sum((x - ma) ** 2 for x in ra) ** 0.5
    vb = sum((y - mb) ** 2 for y in rb) ** 0.5
    return cov / (va * vb)


def score(folder):
    board = json.loads((HERE / folder / "boards.json").read_text(encoding="utf-8"))
    tit = {int(k): v for k, v in board["titolarita"].items()}
    with open(HERE / folder / "players.csv", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r.get("fc_id")]
    pred, real, hit, n = [], [], 0, 0
    by_club = collections.defaultdict(list)
    for r in rows:
        fid = int(float(r["fc_id"]))
        rounds = float(r["actual_rounds"] or 0)
        if rounds <= 0 or fid not in tit:
            continue
        share = float(r["actual_pv"] or 0) / rounds
        by_club[r["club"]].append((share, fid))
        play = r.get("desc_titolarita_play")
        if play not in (None, ""):
            pred.append(float(play))
            real.append(share)
        st = tit[fid].get("status")
        if st in OUR:
            n += 1
            hit += OUR[st] == band(share)
    xi_hit = xi_n = 0
    for club, men in by_club.items():
        real11 = {fid for _, fid in sorted(men, reverse=True)[:11]}
        drawn = {fid for _, fid in men if tit[fid].get("in_eleven")}
        xi_hit += len(real11 & drawn)
        xi_n += len(real11)
    mae = sum(abs(p - q) for p, q in zip(pred, real)) / len(pred)
    return dict(n=len(pred), play_mae=round(mae, 4), spearman=round(spearman(pred, real), 4),
                band_hit=f"{100 * hit / n:.1f}%", xi=f"{xi_hit}/{xi_n}")


for folder in sys.argv[1:]:
    print(f"{folder:16} {score(folder)}")
