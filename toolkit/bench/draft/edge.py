"""Where is our EDGE over a table that only sees the price?

We know the price AND our own `fm_pred`/`pv_pred`; the rivals know the price. That asymmetry is worth
something only if our numbers carry information the PRICE DOES NOT - and «our correlation is higher» does not
establish that: two signals can rank equally well and say the same thing. The question is incremental, so it
is asked the way the project asks every incremental question (gate §7-duovicies): score the signal against the
OUTCOME while controlling for what is already known.

Partial Spearman, on ranks, because an auction list is an ordering:

    r(A | B) = (r_AO - r_AB x r_BO) / sqrt((1 - r_AB^2)(1 - r_BO^2))

Read it as «how much of the outcome A explains that B does not». Two numbers matter and they are different:
r(ours | price) is our edge; r(price | ours) is what the MARKET knows that we do not, and if that one is large
the asymmetry cuts both ways.

Then the practical half: among the men where we and the market DISAGREE most, who is right? That is the
question a bargain is, and it is answered by splitting on the rank gap rather than on the price.

    python edge.py [windows.json]
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


def partial(a, b, o):
    """corr(a, o) controlling for b, all on ranks."""
    ra, rb, ro = ranks(a), ranks(b), ranks(o)
    ab, ao, bo = pearson(ra, rb), pearson(ra, ro), pearson(rb, ro)
    if None in (ab, ao, bo) or abs(ab) >= 1:
        return None
    denom = math.sqrt((1 - ab ** 2) * (1 - bo ** 2))
    return (ao - ab * bo) / denom if denom > 0 else None


keys = list(windows)
print(f"{len(keys)} windows: {', '.join(keys)}\n")

PAIRS = [
    ("value | Qt.I", lambda r: r["value"], lambda r: r["price"]),
    ("Qt.I | value", lambda r: r["price"], lambda r: r["value"]),
    ("pv_pred | Qt.I", lambda r: r["pv_pred"], lambda r: r["price"]),
    ("fm_pred | Qt.I", lambda r: r["fm_pred"], lambda r: r["price"]),
    ("surplus | Qt.I", lambda r: r["surplus"], lambda r: r["price"]),
]

print("=== PARTIAL correlation with the real fantapunti, controlling for the other signal")
print(f"{'signal | controlled for':26}" + "".join(k.rjust(8) for k in keys) + "mean".rjust(8))
for label, of, given in PAIRS:
    cells = []
    for key in keys:
        rows = [r for r in windows[key]["players"] if of(r) is not None and given(r) is not None]
        cells.append(partial([of(r) for r in rows], [given(r) for r in rows], [r["actual"] for r in rows]))
    good = [c for c in cells if c is not None]
    mean = sum(good) / len(good) if good else float("nan")
    print(f"{label:26}" + "".join(("-" if c is None else f"{c:+.3f}").rjust(8) for c in cells)
          + f"{mean:+.3f}".rjust(8))

print("\n=== WHERE WE DISAGREE: the men our rank likes and the price does not, and vice versa")
print("Split on (our value's percentile) - (Qt.I's percentile). The outcome is read as the mean percentile of")
print("the REAL fantapunti, so 50% is «an average man» and the two columns are directly comparable.\n")
print(f"{'group':28}{'n':>7}{'our rank':>10}{'Qt.I rank':>11}{'REAL rank':>11}{'who was right':>16}")

buckets = {"we like him, market not": [], "market likes him, we not": [], "both agree": []}
for key in keys:
    rows = [r for r in windows[key]["players"] if r["value"] is not None and r["price"] is not None]
    n = len(rows)
    if n < 20:
        continue
    rv = [x / n for x in ranks([r["value"] for r in rows])]
    rp = [x / n for x in ranks([r["price"] for r in rows])]
    ro = [x / n for x in ranks([r["actual"] for r in rows])]
    for i in range(n):
        gap = rv[i] - rp[i]
        where = ("we like him, market not" if gap > 0.15
                 else "market likes him, we not" if gap < -0.15 else "both agree")
        buckets[where].append((rv[i], rp[i], ro[i]))

for label, rows in buckets.items():
    if not rows:
        continue
    mean = lambda at: 100 * sum(row[at] for row in rows) / len(rows)
    ours, market, real = mean(0), mean(1), mean(2)
    verdict = ("noi" if real > max(ours, market) - 1 and ours > market
               else "il mercato" if real > max(ours, market) - 1 and market > ours
               else "chi lo mette piu' BASSO" if real < min(ours, market) + 1
               else "nel mezzo")
    print(f"{label:28}{len(rows):>7}{ours:>9.1f}%{market:>10.1f}%{real:>10.1f}%{verdict:>16}")

print("\nRead the LAST column against the two before it: if the real rank lands nearer our own, the")
print("disagreement is ours to exploit; if it lands nearer the price, the disagreement is our error.")
