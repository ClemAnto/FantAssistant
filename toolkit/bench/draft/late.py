"""L'ASTA DUE GIORNATE DOPO L'INIZIO: favorisce noi o il mercato?

Ipotesi dell'operatore (10/08/2026): un'asta fatta a stagione iniziata dovrebbe favorire il SURPLUS e il
VALORE, perche' due giornate di formazioni viste rendono le presenze meno incerte - e le presenze sono l'unica
cosa su cui il nostro vantaggio incrementale esiste (`edge.py`: +0,198 su euro, +0,243 su Serie A, contro
+0,046 e -0,032 della fantamedia).

IL CONTRO-ARGOMENTO, che va misurato insieme e non dopo: quelle due giornate sono PUBBLICHE. Le ha viste anche
il tavolo, e l'FVM - che in un draft E' il prezzo - si muove a ogni evento saliente, quindi il numero dei
rivali assorbe la notizia. Se il nostro vantaggio era PREVEDERE le presenze prima che si vedessero, vederle
puo' restringerlo invece di allargarlo. Le due letture portano a decisioni opposte, quindi si misurano.

Come. Il bersaglio di un'asta fatta dopo la giornata k non e' la stagione: sono i fantapunti dalla k+1 in
avanti, e li abbiamo giornata per giornata. Quindi:

  * si sposta il bersaglio (stagione intera -> giornate > k) e si guarda se il nostro vantaggio incrementale
    sul prezzo CRESCE;
  * si aggiunge un terzo segnale, «le presenze OSSERVATE nelle prime k giornate», che al tavolo lo sa
    chiunque, e si guarda quanto ne resta al nostro numero una volta controllato per quello.

    python late.py [windows.json] [k]
"""
import json
import math
import sys

FILE = sys.argv[1] if len(sys.argv) > 1 else "windows.json"
K = int(sys.argv[2]) if len(sys.argv) > 2 else 2
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


def spear(a, o):
    return pearson(ranks(a), ranks(o))


def partial(a, b, o):
    ra, rb, ro = ranks(a), ranks(b), ranks(o)
    ab, ao, bo = pearson(ra, rb), pearson(ra, ro), pearson(rb, ro)
    if None in (ab, ao, bo) or abs(ab) >= 1:
        return None
    d = math.sqrt((1 - ab ** 2) * (1 - bo ** 2))
    return (ao - ab * bo) / d if d > 0 else None


def partial2(a, b, c, o):
    """corr(a, o) controlling for BOTH b and c: control for c first, then for b's residual part."""
    # Two nested partials is the honest cheap form: r(a,o | b,c) via the recursive formula.
    r_ao_c, r_ab_c, r_bo_c = partial(a, c, o), partial(a, c, b), partial(b, c, o)
    if None in (r_ao_c, r_ab_c, r_bo_c) or abs(r_ab_c) >= 1:
        return None
    d = math.sqrt((1 - r_ab_c ** 2) * (1 - r_bo_c ** 2))
    return (r_ao_c - r_ab_c * r_bo_c) / d if d > 0 else None


keys = list(windows)
print(f"{len(keys)} finestre, asta dopo la giornata {K}: il bersaglio sono i fantapunti dalla {K + 1} in poi\n")

rows_by_window = {}
for key in keys:
    w = windows[key]
    votes = w["votes"]
    out = []
    for r in w["players"]:
        per = votes.get(str(r["id"])) or {}
        late = sum(v for md, v in per.items() if int(md) > K)
        seen = sum(1 for md in per if int(md) <= K)
        if r["value"] is None or r["price"] is None:
            continue
        out.append({**r, "late": late, "seen": seen})
    rows_by_window[key] = out

SIGNALS = [
    ("value | Qt.I", lambda r: r["value"], lambda r: r["price"]),
    ("Qt.I | value", lambda r: r["price"], lambda r: r["value"]),
    ("pv_pred | Qt.I", lambda r: r["pv_pred"], lambda r: r["price"]),
    ("surplus | Qt.I", lambda r: r["surplus"], lambda r: r["price"]),
    ("presenze VISTE | Qt.I", lambda r: r["seen"], lambda r: r["price"]),
    ("presenze VISTE | value", lambda r: r["seen"], lambda r: r["value"]),
]

print(f"=== PARZIALI contro i fantapunti dalla giornata {K + 1}")
print(f"{'segnale | controllato per':28}" + "".join(k.rjust(8) for k in keys) + "media".rjust(8))
for label, of, given in SIGNALS:
    cells = []
    for key in keys:
        rows = [r for r in rows_by_window[key] if of(r) is not None and given(r) is not None]
        cells.append(partial([of(r) for r in rows], [given(r) for r in rows], [r["late"] for r in rows]))
    good = [c for c in cells if c is not None]
    mean = sum(good) / len(good) if good else float("nan")
    print(f"{label:28}" + "".join(("-" if c is None else f"{c:+.3f}").rjust(8) for c in cells)
          + f"{mean:+.3f}".rjust(8))

print(f"\n=== IL NOSTRO NUMERO, una volta che il tavolo ha visto {K} giornate")
print("«value | Qt.I + viste» e' quello che ci resta quando il prezzo E le presenze osservate sono note a")
print("tutti: se crolla, il vantaggio non si allarga a stagione iniziata, si consuma.\n")
print(f"{'':28}" + "".join(k.rjust(8) for k in keys) + "media".rjust(8))
for label, of in [("value | Qt.I + viste", lambda r: r["value"]),
                  ("pv_pred | Qt.I + viste", lambda r: r["pv_pred"]),
                  ("surplus | Qt.I + viste", lambda r: r["surplus"])]:
    cells = []
    for key in keys:
        rows = rows_by_window[key]
        cells.append(partial2([of(r) for r in rows], [r["price"] for r in rows],
                              [r["seen"] for r in rows], [r["late"] for r in rows]))
    good = [c for c in cells if c is not None]
    mean = sum(good) / len(good) if good else float("nan")
    print(f"{label:28}" + "".join(("-" if c is None else f"{c:+.3f}").rjust(8) for c in cells)
          + f"{mean:+.3f}".rjust(8))

print("\n=== E il confronto che risponde all'ipotesi: lo stesso numero sui due bersagli")
print(f"{'':28}{'stagione intera':>18}{f'dalla {K + 1}':>14}{'differenza':>13}")
for label, of, given in [("value | Qt.I", lambda r: r["value"], lambda r: r["price"]),
                         ("surplus | Qt.I", lambda r: r["surplus"], lambda r: r["price"]),
                         ("Qt.I | value", lambda r: r["price"], lambda r: r["value"])]:
    full, late = [], []
    for key in keys:
        rows = rows_by_window[key]
        full.append(partial([of(r) for r in rows], [given(r) for r in rows], [r["actual"] for r in rows]))
        late.append(partial([of(r) for r in rows], [given(r) for r in rows], [r["late"] for r in rows]))
    mf = sum(x for x in full if x is not None) / len([x for x in full if x is not None])
    ml = sum(x for x in late if x is not None) / len([x for x in late if x is not None])
    print(f"{label:28}{mf:>+18.3f}{ml:>+14.3f}{ml - mf:>+13.3f}")
