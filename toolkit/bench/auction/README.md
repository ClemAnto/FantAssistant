# bench/auction — which strategy to play at a raise auction

The fifth harness. `backtest` judges rules, `sweep` judges constants, `zeros` judges the zero,
`bench/draft` judges draft policies — this one judges **auction strategies**: how much to bid, for whom,
in which department, against a table of participants who each play their own way.

```
python -m bench.auction.bench              # the declared table: 2 P1a, 2 P1b, 1 P2, 3 P3, 2 P4
python -m bench.auction.bench --engine     # ...plus one participant bidding on the engine's surplus
```

It needs `bench/draft/leghe-classic.json`, regenerated with
`python extract.py leghe-classic.json "Leghe"` from `bench/draft/` (~2 minutes, read-only on the DB,
**not in git** — it carries names, prices and votes of paid content).

## What comes from the engine and what is declared

**From the engine**, per window: the **Qt.I** (the only quotation that does not know the outcome), the
engine's own `fm_pred`/`pv_pred` with parameters **cross-fit on an adjacent window** exactly as the gate
does it, and the realised fantavoto **and base vote** of every matchday. So the line-up each matchday is
chosen with the forecast a manager actually holds in August, and the outcome is what those men really
did. Nothing here re-predicts a footballer.

**Declared, not measured** — and stated so nobody reads them as results:

| what | where | why it cannot be measured here |
|---|---|---|
| the five profiles | `profiles.py` | a translation of the operator's own sentences into willingness-to-pay |
| the league's regulation | `rules.py` | a published rulebook: modifiers, deputy votes, slots |
| the mental threshold of 500 credits | `profiles.py` | «difficilmente si supera» — a fact about the people at the table |
| `CAUTIOUS_CAP_SHARE`, `SCATTER` | `profiles.py` | nobody has measured how cautious or how distracted a real bidder is |

## Two things the mechanism produces rather than assumes

**The price of the top striker.** Aggiudication is at the **second price plus one**, which is what a
raise *is*. With that alone the dearest man of the listone comes out at 48-75% of the budget (mean 60%)
— the number the operator reports from experience, and the reason to trust the rest.

**The cost of a hole.** A deputy vote is worth 4 (3 for a keeper), every one after the first in the same
matchday is worth **zero**, and a single one **annuls both modifiers**. Over 120 simulated squads the
correlation of final points with holes is **−0.79**, with credits spent **+0.13**.

## Limits, stated rather than averaged away

- **No repair window.** Mid-season markets exist in this league and they cure holes, so every number is
  the season *as bought in August*. Three attempts at modelling them failed in the same place — the
  order in which a squad is fielded after a window — and the cure is the same engine call this file
  already makes, at a later date. A strategy that leaves many holes is judged more harshly here than at
  a real table.
- **The rate of the engine arm** (`engine_rate`) is calibrated on the pool, not swept. Sweeping it is
  one of the reasons for having this bench.
- **`CAUTIOUS_CAP_SHARE` = 0.15** is one of the reasons P3 does well, and it was chosen by hand. It is
  the first thing to sweep.
- The fifth profile (**the supporter**: overpays for one club, boycotts the rival) is written down in
  `profiles.py` and switched off on the operator's instruction. Switching it on needs the club of every
  man plus a declared table of rivalries — «Napoli ↔ Juve» is a fact about people, not about football we
  measure.

## What the engine arm needed to win, and how much each half is worth

The first version of `--engine` bid in proportion to the **surplus** alone and finished **last of eleven**,
spending 284 credits of 1000. Two things were missing, and both are measured rather than chosen:

- **The other half of a man's worth.** The surplus answers «how much better than the man who would play
  instead», which presumes somebody plays. In this league nobody may: a place with no vote pays 4, or
  **nothing at all** if another place is already empty, and it annuls both modifiers for the matchday. So
  worth has two terms that are **added, never multiplied** — `surplus + cover_value` — where the second
  is `holes avoided × HOLE_COST`. `HOLE_COST` = **4.73**, the slope of points against holes over 110
  simulated squads (r = −0.798), and the arithmetic of the regulation independently says the same: about
  6 of lost fantavoto, minus the 4 a deputy gives back when it is the *first* of the matchday and 0 from
  the second on, plus the ~0.6 of modifiers annulled.
- **A ceiling per department, dynamic.** What is left of that department's share of the budget over the
  slots still to fill there, lifted by `URGENCY` while it cannot field its places. A flat 15% was wrong
  in both directions at once: 150 credits is a ceiling no keeper reaches and one that binds on a striker.
  The departmental shares are **derived from the pool** (`role_shares`), not declared.

Result on the declared table, ten windows:

| arm | points | sd | worst | place | holes | R-Factor | modifier | spent | won |
|---|---|---|---|---|---|---|---|---|---|
| **ENGINE** | **2658.8** | **42.6** | **2578** | **1.90** | 13.8 | 13.8 | 14.2 | 933 | **6/10** |
| P1a no plan, expert | 2542.9 | 106.3 | 2268 | 5.25 | 17.4 | 11.2 | 14.6 | 980 | 0/20 |
| P1b no plan, novice | 2542.1 | 113.6 | 2180 | 5.35 | 44.6 | 3.5 | 3.9 | 1000 | 1/20 |
| P3 balanced | 2518.4 | 117.9 | 2206 | 6.27 | 28.7 | 9.1 | 10.1 | 986 | 3/30 |
| P2 defence | 2482.8 | 63.7 | 2350 | 7.70 | 28.1 | 7.0 | 12.4 | 981 | 0/10 |
| P4 top striker | 2439.5 | 116.6 | 2081 | 8.20 | 42.6 | 4.0 | 6.0 | 965 | 0/20 |

+116 points on the best human profile, and the LOWEST dispersion of the table (42.6 against 64-118) -
its worst season, 2578, beats every other profile's mean.

## The two components that were added after that, one adopted and one measured at zero

Attributed ONE AT A TIME, which is the only way a change can be credited (the project's own rule):

| engine arm | points | sd | place | R-Factor |
|---|---|---|---|---|
| cover only | 2650.0 | 61.6 | 2.30 | 12.6 |
| + steadiness | 2641.8 | 73.0 | 2.70 | 12.4 |
| **+ diversification** | 2648.4 | **56.0** | 2.50 | 12.6 |
| both | 2640.2 | 68.2 | 2.90 | 12.4 |

**DIVERSIFICATION IS ADOPTED** (`CLUB_FREE` = 2, `CLUB_PENALTY` = 0.45), the operator's rule of
01/09/2026 - «comprare 5 calciatori di una singola squadra reale significa rischiare il tracollo se quella
squadra ha un anno storto». It costs 1.6 points, which is inside the noise, and cuts the standard
deviation by **9%**. That is exactly what `metrica-asta-surplus-v1.md` §24 had already measured about the
same question from the other side: two men of one club cost nothing on the MEAN and add 3.9% to the
weekly standard deviation. **And this bench cannot see the benefit it buys** - its sd is measured ACROSS
SEASONS, while the risk diversification removes is the weekly one WITHIN a season. So the honest reading
is: the cost is measured here at ~0, the benefit is measured in §24, and the two agree in direction.

**STEADINESS IS MEASURED AND SWITCHED OFF** (`STEADY_WEIGHT` = 0). The symptom that prompted it was real
- the arm banked 6.5 points of R-Factor against a rival's 20.5, and neither the surplus nor the
appearances contain the BASE vote. But:

- **one man can move the R-Factor by +2.4 points a season** (from his role's median to its p90, computed
  exactly on the Poisson-binomial of the eleven), +10.8 in the impossible case of never-sufficient to
  always. Against a `cover_value` that reaches 180 for a starter in an empty department, that cannot
  reorder a single bid;
- **and the modifier is governed by HOLES, not by steadiness**: over 110 squads the R-Factor collected
  correlates **−0.821** with holes - 13.6 points for the quartile with fewest, 2.1 for the quartile with
  most - because one deputy vote annuls the whole bonus for the matchday. The arm's 6.5 was a symptom of
  its holes, not of who it bought.

Switched on it costs 8.2 points and moves the R-Factor by −0.2. Kept at zero with the numbers beside it,
so nobody re-tries it: what would make it pay is a squad with no holes, and no strategy on this bench
gets there.

**And the null says how much of that is the engine.** The same strategy — same coverage ladder, same
ceilings — reading availability off the PRICE RANK instead of `pv_pred`:

| | points | place | holes | won |
|---|---|---|---|---|
| with the engine | 2712.9 | 1.50 | 5.1 | 7/10 |
| blind (plan only) | 2690.6 | 1.80 | 8.3 | 7/10 |

**The engine is worth +22.3 points, 6 windows of 10** — and that number is honest about its own fragility:
0.8% on a bare majority of windows would not pass this project's robust criterion. Against a STRONGER
table (an earlier version whose novice was effectively a disciplined bidder) the same comparison read
+57.7 on 7 of 10. So the reading is: **the plan is what beats a weak table, and the forecast is what
you need against a good one.**

## A defect the operator found from the result, and it was a double one

He said: «non è normale che il novizio batta l'esperto 2-0, il novizio dovrebbe avere dei buchi nella rosa
che gli pregiudicano la stagione». Both halves of the cause were mine.

1. **The rate did not reach whoever reads the engine.** `engine_rate` was assigned to the engine arm only,
   so the expert compared a surplus in FANTAPUNTI against a price in CREDITS — the scale was out by the
   rate itself, and he undervalued every dear man while overvaluing every cheap one. Worth 13 points.
2. **I had given a DECREASING ladder to profiles that have no plan**, which is a rationing plan. With the
   ladder flat - what «senza piano» actually means - the credits go on the first names that come up (the
   auction calls the dearest first) and the departments close with whatever is left. The novice's holes
   went 32.7 → **43.8** and he lost 84 points.

What remains after the fix is itself a result, and it is the same one the null states: novice 2543.3
against expert 2537.8 is a **tie**. The expert builds a structurally far better squad — 17.9 holes against
43.8, 25 points of modifiers against 6.8 — and does not convert it, because his eye makes him SAVE
credits (878 of 1000) that no plan tells him where to spend. **Judgement without a plan pays nothing.**

## Two results that are the model's and are flagged as such

- **The mental threshold makes scatter cheap.** In a second-price auction a wild ceiling is FREE where
  nobody contests it, so a distracted bidder is treated more kindly here than at a real table, where an
  impulsive raise gets paid. What would fix it is a scatter CORRELATED across participants - real
  blunders share a cause, the fashionable name - and nobody has measured that.
- **Which of P1a, P2 and P3 is best is not decidable here.** Changing the prior alone (FVM against Qt.I)
  reordered them in an earlier run. Only two statements survived every version, both prices and every
  table composition: **playing for the top striker loses**, and **coverage decides a season**.

## ...and then the same auction on a CALENDAR (`league.py`, 01/09/2026)

The table above ranks the participants by the fantapunti a season is worth, which answers "who scores
more". A league is not played on that: 36 head-to-head matches, each total converted into GOALS on a
staircase (66 -> 1, then one every 6), and everything a squad scores below 66 in a matchday is thrown
away. So the two rankings can disagree, and they do.

```
python -m bench.auction.league [--json out.json]
```

`LEAGUE_TABLE` is the operator's own table of 01/09/2026, by letter: A the engine, B and C for the top
striker, D E L balanced, F the expert with no plan, G and H the novices, I the defence. The calendar is
CHECKED and not trusted (a rotation that repeats a pairing would hand somebody four matches against the
weakest participant): 45 pairings once per leg, four meetings per pair, eighteen of each side, nobody
twice on a matchday. The SIDE pays nothing in this league - what separates the second leg from the first
is not the side but the ROUND.

| profile | seats | table pts | place | titles | fantapunti | under 66 | holes |
|---|---|---|---|---|---|---|---|
| **ENGINE** | 1 | **61.4** | **2.10** | **5/10** | 2529.5 | **8.6** | 10.4 |
| P1b no plan, novice | 2 | 47.9 | 5.65 | 2/20 | 2413.0 | 15.5 | 43.5 |
| P1a no plan, expert | 1 | 46.9 | 5.90 | 1/10 | 2424.6 | 14.0 | 17.6 |
| P3 balanced | 3 | 46.3 | 5.70 | 1/30 | 2416.1 | 15.2 | 20.5 |
| P2 defence | 1 | 45.6 | 6.10 | 0/10 | 2423.7 | 14.8 | 20.6 |
| P4 top striker | 2 | 45.5 | 6.25 | 1/20 | 2380.7 | 16.9 | 25.4 |

**The championship exposed a quantity the seasonal mean could not see.** In 4 windows of 10 the champion
is NOT the top scorer. Over the 100 rows, table points correlate +0.815 with the season total and
**-0.802 with the matchdays spent under 66** - nearly as strongly - while those matchdays correlate
+0.661 with holes. So coverage pays TWICE, and neither road goes through whoever you buy at the top.
One number not to misread: table points against credits spent reads -0.418, and it is CONFOUNDED by the
profile (the engine spends least and wins most), so it is a difference between groups and not a virtue of
saving.

**A latent defect the letters exposed.** A tie in the bidding used to be broken ALPHABETICALLY, invisible
while everybody is named after his profile and a real advantage the moment they are called A...L. It is a
reproducible draw per (participant, man) now; measured before switching it over, the order of the six
profiles does not change - see the note in `auction`.
