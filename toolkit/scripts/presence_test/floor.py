"""THE FLOOR: how wrong a PERFECT formula would still be at 5 September (operator, 01/10/2026).

The oracle knows each man's true chance of being CHOSEN when available - his realised share of the games he was fit
for, which no real formula can know - and knows availability only as his ROLE's distribution (how much of a season
men of his role actually lose). What is left for it to get wrong is exactly the unforeseeable: which games he will
miss, and which of the games he is fit for he will play. Everything counted on Transfermarkt's per-game rows after
the auction date (a game played = an appearance), on the bench's population: quoted above 5, September windows.
"""
import random
import sqlite3
import sys
from collections import defaultdict
from statistics import mean

from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))
import build as B
from euroleghe_ingest.config import Config

random.seed(7)
conn = sqlite3.connect(f"file:{Config().db_path}?mode=ro", uri=True)
games = B.league_games(conn)
rows = B.engine_rows(conn, B.september_windows())          # quoted above 5, the engine's own prediction beside

people = []
for r in rows:
    after = [(day, club, state, absence) for day, club, state, absence in games.get((r["fc_id"], r["target"]), ())
             if day > r["auction"]]
    if len(after) < 10:
        continue
    missed = sum(state in ("injured", "absent") for _d, _c, state, _a in after)
    free = len(after) - missed
    played = sum(state == "played" for _d, _c, state, _a in after)
    people.append({"fc_id": r["fc_id"], "role": r["role"], "n": len(after), "free": free, "played": played,
                   "p": played / free if free else None, "window": r["window"],
                   "engine": r["pa_engine"], "votes": r["pa_actual"]})

# The role's distribution of the share of games a man is FIT for, from the same population.
avail = defaultdict(list)
for x in people:
    avail[x["role"]].append(x["free"] / x["n"])
p_role = {role: mean(x["p"] for x in people if x["role"] == role and x["p"] is not None) for role in avail}


def binomial_draw(n, p):
    return sum(random.random() < p for _ in range(n))


DRAWS = 400
floor_total, floor_match, floor_avail, within = [], [], [], []
for x in people:
    p = x["p"] if x["p"] is not None else p_role[x["role"]]
    shares = avail[x["role"]]
    expected = x["n"] * mean(shares) * p
    sims_total, sims_match = [], []
    for _ in range(DRAWS):
        a = random.choice(shares)
        free = round(x["n"] * a)
        sims_total.append(binomial_draw(free, p))
        sims_match.append(binomial_draw(x["free"], p))       # availability known, only the dice
    floor_total.append(mean(abs(s - expected) for s in sims_total))
    floor_match.append(mean(abs(s - x["free"] * p) for s in sims_match))
    floor_avail.append(mean(abs(round(x["n"] * random.choice(shares)) * p - expected) for _ in range(DRAWS)))
    within.append(mean((0.8 <= expected / s <= 1.25) if s > 0 else False for s in sims_total))

engine_err = [abs(x["engine"] - x["votes"]) for x in people if x["engine"] is not None]
print(f"uomini {len(people)} (quotati sopra 5, 5 settembre, 7 stagioni)")
print(f"pavimento totale (oracolo perfetto sulla scelta): {mean(floor_total):.2f} partite")
print(f"  solo il caso partita per partita (disponibilita' nota): {mean(floor_match):.2f}")
print(f"  solo gli imprevisti di disponibilita' (scelta nota, senza dadi): {mean(floor_avail):.2f}")
print(f"motore oggi sugli stessi uomini: {mean(engine_err):.2f}")
print(f"entro 80-125% del vero, per l'oracolo: {mean(within):.1%}")
band = [0.8 <= x["engine"] / x["votes"] <= 1.25 for x in people if x["engine"] is not None and x["votes"] > 0]
print(f"entro 80-125% del vero, per il motore: {mean(band):.1%}")
by_role = defaultdict(list)
for x, f in zip(people, floor_total):
    by_role[x["role"]].append(f)
print({role: round(mean(v), 2) for role, v in sorted(by_role.items())})
print("disponibilita' media per ruolo", {role: round(mean(v), 3) for role, v in sorted(avail.items())},
      "p medio", {role: round(v, 3) for role, v in sorted(p_role.items())})

# THE CHOICE THAT CHANGES INSIDE THE SEASON (a coach sacked, a dispute, a January signing): the chronological halves
# of the games a man was fit for, against the halves a pure coin with his p would give (odd/even of the same games
# have the same state and only dice between them).
excess, halves = [], []
for r in rows:
    after = [state for day, club, state, absence in games.get((r["fc_id"], r["target"]), ())
             if day > r["auction"] and state not in ("injured", "absent")]
    if len(after) < 16:
        continue
    k = len(after) // 2
    first, second = after[:k], after[k:2 * k]
    odd, even = after[0:2 * k:2], after[1:2 * k:2]
    share = lambda xs: sum(s == "played" for s in xs) / len(xs)
    halves.append((share(first) - share(second)) ** 2)
    excess.append((share(odd) - share(even)) ** 2)
drift_var = max(mean(halves) - mean(excess), 0.0)
print(f"meta' cronologiche: var {mean(halves):.4f} · pari/dispari (solo dadi): {mean(excess):.4f} · "
      f"deriva della scelta: sd {drift_var ** 0.5:.3f} di quota fra la prima e la seconda meta'")

# The floor again, now with the choice ALSO drifting: the second half's p moves by the measured drift.
floor_drift, within_drift = [], []
sd = (drift_var / 2) ** 0.5          # each half moves by half the variance of their difference
for x in people:
    p = x["p"] if x["p"] is not None else p_role[x["role"]]
    shares = avail[x["role"]]
    expected = x["n"] * mean(shares) * p
    sims = []
    for _ in range(DRAWS):
        free = round(x["n"] * random.choice(shares))
        h1, h2 = free // 2, free - free // 2
        p1 = min(max(p + random.gauss(0, sd), 0.0), 1.0)
        p2 = min(max(p + random.gauss(0, sd), 0.0), 1.0)
        sims.append(binomial_draw(h1, p1) + binomial_draw(h2, p2))
    floor_drift.append(mean(abs(s - expected) for s in sims))
    x["floor"] = floor_drift[-1]
    within_drift.append(mean((0.8 <= expected / s <= 1.25) if s > 0 else False for s in sims))
print(f"pavimento con la deriva della scelta: {mean(floor_drift):.2f} partite, entro 80-125%: {mean(within_drift):.1%}")
