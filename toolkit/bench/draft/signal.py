"""Item 2.1: which HALF of the prediction carries the ranking - the fantamedia or the appearances?

The answer the todolist carried was measured on T2 alone (`pv_pred` +0.545 against `fm_pred` +0.313), and a
conclusion on one window is not a conclusion - that is the standing lesson of the 10/08/2026 campaign, which
retired two of its own results for exactly this reason. So it is re-measured on every window the bench holds.

Read on RANKS (Spearman) because the question is about ordering an auction list, with Pearson beside it: a
gap that only exists on one of the two is a statement about the tails, not about the signal. The variance
decomposition is here too, because the gate already knows the answer from another direction
(`Var(ln pv)` is ~90% of `Var(ln fantapunti)`) and two roads to one conclusion are worth more than one.

    python signal.py [windows.json]
"""
import json
import math
import sys

FILE = sys.argv[1] if len(sys.argv) > 1 else "windows.json"
windows = json.load(open(FILE, encoding="utf-8"))


def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        mean = (i + j) / 2 + 1
        for k in range(i, j + 1):
            out[order[k]] = mean
        i = j + 1
    return out


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    return sxy / math.sqrt(sxx * syy) if sxx > 0 and syy > 0 else None


def spearman(xs, ys):
    return pearson(ranks(xs), ranks(ys))


CANDIDATES = [
    ("pv_pred", lambda r: r["pv_pred"]),
    ("fm_pred", lambda r: r["fm_pred"]),
    ("value = fm x pv", lambda r: r["value"]),
    ("Qt.I", lambda r: r["price"]),
    ("fm_prev", lambda r: r["fm_prev"]),
]

keys = list(windows)
print(f"{len(keys)} windows: {', '.join(keys)}   target = the season's real fantapunti (fm_act x pv_act)\n")

for label, stat in (("SPEARMAN (ranks - what an auction list is)", spearman), ("PEARSON", pearson)):
    print(f"=== {label}")
    print(f"{'signal':20}" + "".join(k.rjust(9) for k in keys) + "mean".rjust(9) + "won".rjust(7))
    table = {}
    for name, of in CANDIDATES:
        cells = []
        for key in keys:
            rows = [r for r in windows[key]["players"] if of(r) is not None]
            cells.append(stat([of(r) for r in rows], [r["actual"] for r in rows]))
        table[name] = cells
    for name, _ in CANDIDATES:
        cells = table[name]
        good = [c for c in cells if c is not None]
        mean = sum(good) / len(good) if good else float("nan")
        # «won» = windows where this signal ranks better than the OTHER half of the prediction.
        other = "fm_pred" if name == "pv_pred" else ("pv_pred" if name == "fm_pred" else None)
        wins = ("-" if other is None
                else f"{sum(1 for a, b in zip(cells, table[other]) if a is not None and b is not None and a > b)}"
                     f"/{len(keys)}")
        print(f"{name:20}" + "".join(("-" if c is None else f"{c:+.3f}").rjust(9) for c in cells)
              + f"{mean:+.3f}".rjust(9) + wins.rjust(7))
    print()

print("=== VARIANCE: how much of the spread in fantapunti is availability and how much is the vote")
print(f"{'window':12}{'Var(ln pv)':>12}{'Var(ln fm)':>12}{'Var(ln tot)':>13}{'pv share':>10}")
for key in keys:
    rows = [r for r in windows[key]["players"] if r["pv_act"] > 0 and r["fm_act"] > 0]
    def var(values):
        m = sum(values) / len(values)
        return sum((v - m) ** 2 for v in values) / (len(values) - 1)
    vpv = var([math.log(r["pv_act"]) for r in rows])
    vfm = var([math.log(r["fm_act"]) for r in rows])
    vtot = var([math.log(r["actual"]) for r in rows])
    print(f"{key:12}{vpv:12.3f}{vfm:12.3f}{vtot:13.3f}{100 * vpv / vtot:9.1f}%")
