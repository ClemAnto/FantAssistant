# bench/auction — which strategy to play at a raise auction

The fifth harness. `backtest` judges rules, `sweep` judges constants, `zeros` judges the zero,
`bench/draft` judges draft policies — this one judges **auction strategies**: how much to bid, for whom,
in which department, against a table of participants who each play their own way.

```
python -m bench.auction.bench                      # CALLED: the dearest names first
python -m bench.auction.bench --engine             # ...plus one participant bidding on the engine
python -m bench.auction.bench --engine --random 20 # DRAWN: the platform picks the lot, 20 urns/window
python -m bench.auction.bench --engine 3 --random 20   # ...three engine seats, which is the NULL
```

**Two mechanisms, one price rule** (02/09/2026, on the operator's own auction: «l'asta che dovrò
affrontare sarà ad estrazione RANDOM del calciatore che andrà in asta»). Everything below that says
*called* is the auction where the dearest names are called first; everything that says *drawn* is the
one where a machine picks the next lot out of the whole listone. Nothing published on the called
mechanism moved - `bench --engine` reads 2665.5 to the decimal - and that is asserted rather than
hoped, because the two rules the drawn auction needed are inert there BY CONSTRUCTION.

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
raise *is*, so what the best man costs EMERGES instead of being assumed. Re-measured 02/09/2026 on the
current code over the ten windows: the dearest lot of a called auction goes for **31.2% of a budget
(26-35%)**, and it reads the same with the engine arm at the table and without it.

> **WITHDRAWN: the «48-75%, mean 60%» first published here does not reproduce.** It was taken on four
> seasons and on the configuration of 01/09 morning - before the tie-break draw and before the
> purse-floor fix, both of which move what a contested lot costs - and no table composition on the
> current code gets near it. It is left on the record rather than deleted, because it was quoted to the
> operator as agreeing with his experience, and an agreement that cannot be reproduced is worth less
> than the disagreement that replaces it. If the real figure at his table is 60%, what that says is
> that this bench's SUPPLY is too generous (see the limits), not that the mechanism is wrong.

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
| **ENGINE** | **2665.5** | **45.7** | **2574** | **1.90** | 12.4 | 14.4 | 15.2 | 988 | **6/10** |
| P1b no plan, novice | 2543.4 | 113.0 | 2180 | 5.30 | 44.4 | 3.5 | 4.0 | 1000 | 1/20 |
| P1a no plan, expert | 2542.9 | 106.3 | 2268 | 5.25 | 17.4 | 11.2 | 14.6 | 980 | 0/20 |
| P3 balanced | 2513.1 | 123.3 | 2206 | 6.20 | 30.3 | 8.7 | 9.9 | 981 | 3/30 |
| P2 defence | 2481.4 | 63.4 | 2350 | 7.70 | 28.3 | 7.0 | 12.2 | 977 | 0/10 |
| P4 top striker | 2432.9 | 122.7 | 2036 | 8.35 | 43.8 | 3.9 | 5.8 | 965 | 0/20 |

+122 points on the best human profile, and the LOWEST dispersion of the table (45.7 against 63-123) -
its worst season, 2574, beats every other profile's mean.

## The two components that were added after that, one adopted and one measured at zero

Attributed ONE AT A TIME, which is the only way a change can be credited (the project's own rule):

| engine arm | points | sd | place | R-Factor | holes |
|---|---|---|---|---|---|
| cover only | 2669.6 | 47.8 | 1.80 | 14.1 | 12.4 |
| + steadiness | 2669.6 | 47.8 | 1.80 | 14.1 | 12.4 |
| **+ diversification** | 2665.5 | **45.7** | 1.90 | 14.4 | 12.4 |
| both | 2665.5 | 45.7 | 1.90 | 14.4 | 12.4 |

(Re-measured 02/09/2026 on the current code. The 01/09 version of this table predates the purse-floor
fix and its numbers are superseded.)

**DIVERSIFICATION IS ADOPTED** (`CLUB_FREE` = 2, `CLUB_PENALTY` = 0.45), the operator's rule of
01/09/2026 - «comprare 5 calciatori di una singola squadra reale significa rischiare il tracollo se quella
squadra ha un anno storto». It costs 1.6 points, which is inside the noise, and cuts the standard
deviation by **9%**. That is exactly what `metrica-asta-surplus-v1.md` §24 had already measured about the
same question from the other side: two men of one club cost nothing on the MEAN and add 3.9% to the
weekly standard deviation. (On the current code the cost is 4.1 points and the dispersion falls 47.8 ->
45.7, i.e. **-4.4%** rather than the -9% first published.) **And this bench cannot see the benefit it buys** - its sd is measured ACROSS
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

AND ON THE CURRENT CODE IT IS INERT, which is stronger than the "−8.2 points" first published (that
figure predates the purse-floor fix): at weight 0, 1 and 5 the arm reads 2665.5 IDENTICALLY. The term
does reach the bid - 1.8 points on a real defender - and changes nothing, because `role_cap` binds first.
It bites only at 20 (+2.2 points, i.e. 0.08%, an order of magnitude under the 0.5% floor) and collapses
at 100 (−25.7, holes 12.4 -> 13.7), where it buys steadiness instead of coverage. Kept at zero with the
numbers beside it: what would make it pay is a squad with no holes, and no strategy on this bench gets
there.

**And the null says how much of that is the engine.** The same strategy — same coverage ladder, same
ceilings — reading availability off the PRICE RANK instead of `pv_pred`:

| | points | place | holes | won |
|---|---|---|---|---|
| with the engine | 2712.9 | 1.50 | 5.1 | 7/10 |
| blind (plan only) | 2690.6 | 1.80 | 8.3 | 7/10 |

**THOSE FOUR NUMBERS ARE SUPERSEDED AND NOT CITABLE**: they were taken on the configuration of 01/09
morning, before the tie-break draw and before the purse-floor fix, and the blind arm was a throwaway
variant that is not in the code. The comparison is worth having and must be re-run before it is quoted
again. What follows is the reading it gave then, kept for the shape of the argument and not for the
figures.

**The engine was worth +22.3 points, 6 windows of 10** — and that number is honest about its own fragility:
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
| **ENGINE** | 1 | **62.1** | **1.70** | **5/10** | 2536.3 | **8.0** | 8.4 |
| P1b no plan, novice | 2 | 48.6 | 5.35 | 2/20 | 2413.8 | 15.8 | 43.6 |
| P1a no plan, expert | 1 | 47.6 | 5.50 | 0/10 | 2424.6 | 14.0 | 17.6 |
| P2 defence | 1 | 46.6 | 5.50 | 0/10 | 2425.3 | 14.8 | 20.3 |
| P3 balanced | 3 | 45.9 | 6.03 | 1/30 | 2414.2 | 15.5 | 21.3 |
| P4 top striker | 2 | 43.9 | 6.75 | 2/20 | 2371.3 | 17.8 | 28.1 |

**The championship exposed a quantity the seasonal mean could not see.** In 4 windows of 10 the champion
is NOT the top scorer (Tm3, T0, T1, T2). Over the 100 rows, table points correlate +0.833 with the season
total and **-0.825 with the matchdays spent under 66** - nearly as strongly - while those matchdays
correlate +0.701 with holes. So coverage pays TWICE, and neither road goes through whoever you buy at the
top. One number not to misread: table points against credits spent reads -0.177, and it is CONFOUNDED by
the profile (the engine spends least and wins most), so it is a difference between groups and not a virtue
of saving.

**AND THE TWO TABLES ABOVE ARE NOT ON ONE CALENDAR**, which is worth saying before anybody reads the
championship as a regression: the bench scores 38 rounds and the championship 36 (4 x 9), so 2665.5 and
2536.3 are **70.14 and 70.45 fantapunti per round** - the whole difference is the two rounds a
four-leg calendar does not reach.

**A latent defect the letters exposed.** A tie in the bidding used to be broken ALPHABETICALLY, invisible
while everybody is named after his profile and a real advantage the moment they are called A...L. It is a
reproducible draw per (participant, man) now; measured before switching it over, the order of the six
profiles does not change - see the note in `auction`.


## ...and then the auction became a RANDOM EXTRACTION (02/09/2026)

The operator's league draws the man who goes on the block. That is not a cosmetic change of order, and
the cheapest way to see it is to change nothing else and measure the MECHANISM:

| | called | drawn |
|---|---|---|
| of the 50 best men by the engine's value, **UNSOLD** | 0.1 | **14.3** |
| the dearest lot, as a share of one budget | 31.2% (26-35%) | 18.4% (**11-48%**) |
| what the dearest man of the listone went for | 31.2% | 10.8% (**0-35%**) |
| credits the table managed to spend, of 1000 | 978 | **709** |
| holes in a season, per participant | 25.4 | **50.0** |
| paid / Qt.I, first tenth of the lots ... last tenth | 1.13 ... 4.78 | **1.30 ... 5.03** |

> **SUPERSEDED 02/09/2026 (evening), by the operator's own auction archive.** Three rows of the table
> above are artefacts of a SINGLE PASS over the listone, which is not how the platform draws: in the
> five real auctions whose extraction order can be reconstructed every quoted name is drawn 5 to 9
> times, and an unsold man COMES BACK. With re-entry the unsold top-50 count is **1.3** against a real
> **1.75**, and the best man of the listone is awarded in 60 urns of 60. What survives unchanged is the
> direction of everything else - a drawn auction does concentrate the money on the few names that
> matter, and the real ladder agrees (attack's first tier 2.31 called against 2.50 drawn). See «147 REAL
> AUCTIONS» below.

**A random extraction WASTES the top of the listone.** Fourteen of the fifty best men are never bought:
they come up when the rosters are already full. And the price of the best man stops being a fact about
him - drawn early he costs a third of a budget, drawn late he goes unsold. Everything a strategy can do
is downstream of that.

**One participant, one window, twenty urns: sd 170 fantapunti**, against sd 199 across the ten seasons
themselves. The draw is nearly as big a source of variation as the season - which is why `--random`
takes a number of DRAWS and every figure below is the mean over `windows x draws`. A single order
measures the luck of that order and nothing else.

### The arm that won at a called auction finishes fifth of six at a drawn one

> **SUPERSEDED 02/09/2026 (evening).** Against the table calibrated on 131 real auctions the arm is
> **last of eleven** at a drawn auction (2087.3 against a table at 2536.5) and **fourth of eleven** at a
> called one (2604.2 against 2539.5, 0 titles of 10), and no point of the `ALT_WEIGHT` grid recovers it.
> The two cures below are still the right shape of question - «what is the zero of this number?» - and
> their measured verdicts belonged to an environment that let champions go unsold.

2665.5 -> **2276.1** points, mean place 1.90 -> 7.75, holes 12.4 -> **69.0**. The mechanism is not
subtle: `cover_value` is large while a department is empty, so the arm pays it to the FIRST man of that
role who comes up - and nothing tells it that thirty more are behind him. It bought defenders expected
in 15-24 matchdays where the called auction had bought 23-29.

Two rules cure it, and they are both the same question this project asks everywhere else: **what is the
zero of this number?**

- **THE ZERO OF A BID IS THE MAN WHO WOULD BE BOUGHT INSTEAD** (`ALT_WEIGHT` = 0.75). The surplus
  already subtracts the man who would PLAY instead - the roster-marginal of the league. A drawn auction
  needs the other subtraction, and *which* man it is, is COUNTED and not chosen: if `k` participants
  still have a slot open in that role, the best `k` left go one each, so the fallback is the `k`-th of
  them (`Urn.nth`, `ALT_RANK` = 1). Swept on a pre-registered grid 0 ... 1, 20 draws of each of the ten
  windows: **2276.1 -> 2568.0 (+12.8%), 10 windows of 10 improving, worst +6.7%**, holes 69.0 -> 22.5,
  mean place 7.75 -> 2.90. The optimum is INTERIOR (0.70 reads 2563.5, 0.80 reads 2560.0, 1.00 falls
  back to 2477.8). It is 0.75 and not the 1.0 the theory would write because the fallback is
  OPTIMISTIC: it assumes this squad wins one of the best `k`, and against ten rivals it often does not.
- **«SPEND IT OR LOSE IT» NEVER MEANS BUYING A MAN WORSE THAN THE ONE WHO IS COMING**
  (`FLOOR_ON_BETTER`). The purse floor exists so nobody ends holding credits; at a drawn auction it
  fired on the FIRST lot, because the man on the block is no longer the dearest one left. At a random
  extraction **a slot is as scarce as a credit** - the draft bench's own lesson met halfway - so that
  floor was not spending a credit, it was spending a PLACE, and the credit stayed in the purse anyway.
  Worth 2486.8 -> 2565.8, holes 33.4 -> 22.9, mean place 4.34 -> 2.79.

Both are switched off at a called auction, and not by a flag anybody has to remember: `Urn.random` is
false there, `alternative` returns 0, and the gate that reads it cannot fire. **Measured before it was
scoped that way** - on the ten called windows the term is worth +0.3% (under this project's 0.5% floor)
with one window at -5.6%, i.e. it fails the robust criterion there and passes overwhelmingly here. A
parameter belongs to the mechanism it was measured on, the same way it belongs to a platform.

### The sweep, and the two things measured and left at zero

| `ALT_WEIGHT` | points | sd | place | holes | spent | seasons won |
|---|---|---|---|---|---|---|
| 0.00 (the old arm) | 2276.1 | 184.8 | 7.75 | 69.0 | 898 | 2/200 |
| 0.50 | 2505.9 | 118.5 | 4.15 | 29.8 | 842 | 30/200 |
| 0.60 | 2551.0 | 95.2 | 3.18 | 22.0 | 774 | 56/200 |
| 0.70 | 2563.5 | 105.5 | 2.93 | 21.4 | 636 | 60/200 |
| **0.75** | **2568.0** | 112.2 | **2.90** | 22.5 | 560 | **66/200** |
| 0.80 | 2560.0 | 118.4 | 3.13 | 25.2 | 500 | 62/200 |
| 0.90 | 2522.7 | 141.5 | 3.82 | 32.7 | 377 | 52/200 |
| 1.00 | 2477.8 | 155.4 | 4.67 | 40.3 | 318 | 30/200 |

**`ALT_RANK` stays at 1 although 2 measures a shade better** (2572.8 at `ALT_WEIGHT` 0.75). The two
knobs are one effect - how much of the option value comes off - and the whole surface between them is
flat inside 0.5%. Two fitted numbers for one quantity is how a bench starts fitting itself, so the one
that survives is the one whose companion is COUNTED (`k` = who still needs the role) rather than tuned.

**`LIVE_RATE` is measured and switched off.** Re-reading the rate mid-auction - the same conservation
law `engine_rate` uses, over what is LEFT in the urn - is worth **+0.4%** (2486.8 -> 2497.5), under the
floor, and the spend it was built to correct moves 739 -> 748. Same shape as `STEADY_WEIGHT`: not a weak
channel, a channel that does not ARRIVE. What actually stopped the arm hoarding was the floor gate, and
for the OPPOSITE reason to the one this term assumes - it was not spending too little, it was spending
on the wrong men.

### The result, and the null

| profile | seats | points | sd | place | holes | spent | seasons won |
|---|---|---|---|---|---|---|---|
| **ENGINE** | 1 | **2568.0** | 112.2 | **2.90** | **22.5** | 560 | **66/200** |
| P4 top striker | 2 | 2427.8 | 163.5 | 5.45 | 46.6 | 733 | 30/400 |
| P3 balanced | 3 | 2420.0 | 171.7 | 5.53 | 47.5 | 742 | 62/600 |
| P1b no plan, novice | 2 | 2408.9 | 184.5 | 5.57 | 51.4 | 899 | 34/400 |
| P2 defence | 1 | 2258.4 | 235.6 | 7.64 | 73.5 | 705 | 4/200 |
| P1a no plan, expert | 2 | 2206.3 | 226.1 | 8.41 | 80.8 | 689 | 4/400 |

**The expert collapses, and it is a result and not a bug.** `EXPERT_EYE` blends his ceiling toward what
the engine's surplus says a man is worth - the auditable stand-in for «sa valutare al momento l'asta».
At a called auction that is worth 13 points; at a drawn one it takes him from mid-table to LAST, below
the novice who reads nothing but the quotation. **Reading a value without the option value is worse
than not reading one at all**, because the surplus alone says «he is cheap for what he gives» about a
man ten better ones are queued behind.

**THE NULL: three engine seats at a thirteen-handed table.** A strategy that wins only because the rest
of the table wastes its money is not a strategy. The margin narrows and holds: **2506.2 against 2414.8**
for the best human (drawn), 2548.9 against 2471.3 (called), with the arms' spend rising 560 -> 734 -
competition for the same men is exactly what puts the prices back up. What it also does is leave 0.73
slots per arm UNFILLED, which is the cost of patience when three people practise it at once.

### The championship on a calendar, drawn (`league --random 20`)

| profile | seats | table pts | place | titles | fantapunti | under 66 | holes |
|---|---|---|---|---|---|---|---|
| **ENGINE** | 1 | **61.0** | **3.03** | **70/200** | 2429.8 | **14.8** | 20.7 |
| P3 balanced | 3 | 47.8 | 5.10 | 57/600 | 2291.4 | 20.9 | 45.2 |
| P4 top striker | 2 | 46.5 | 5.40 | 35/400 | 2274.9 | 21.6 | 48.2 |
| P1b no plan, novice | 2 | 45.1 | 5.74 | 27/400 | 2254.3 | 22.3 | 52.4 |
| P2 defence | 1 | 42.3 | 6.12 | 10/200 | 2219.6 | 23.5 | 56.0 |
| P1a no plan, expert | 1 | 31.3 | 8.26 | 1/200 | 2021.3 | 29.8 | 86.7 |

35% of titles against the 10% a coin would give, and against **50%** on the called mechanism - the
difference is not the strategy, it is the urn. `--json` now carries both readings and neither may hide
the other: `windows` is the full detail of ONE order per window and `all` is every draw in the compact
form the aggregate needs.

### Limits this mechanism adds to the ones already listed

- **The urn here is shorter than a real one.** The extraction file holds 359-430 men for 275 places
  (1.4 per place); a full listone holds far more, so at a real table the junk is more numerous and the
  good men more diluted. Scarcity here is HIGHER than at the operator's table, and with it the prices.
  It is also the first thing to suspect about any number on this page that feels too tight.
- **No repair window**, which was already true and now costs more: holes double under the drawn
  mechanism, so a strategy that leaves them is judged more harshly here than it would be in a league
  that can buy in January.
- **The table does not know the option value.** None of the five profiles applies the rule the arm
  applies, so the margin is measured against opponents who do not have it. The three-seat null is what
  answers that, and it answers it only for the arm against itself.

## 147 REAL AUCTIONS (02/09/2026): what was declared is now measured, and one mechanism was missing

The operator brought the archive this README's own «what would make the declared measured» asked for:
`docs/real-data/`, read from the production database on 02/09/2026 — **147 auctions** on the official
listone (19/08 → 01/09/2026), **131** of them with this same 3/8/8/6 roster and **20 identical to his
league** (10 teams, 1000 credits), **29,421 purchases** over 1,177 squads. The order of the awards, the
Qt.I of that listone and the credits paid: all three, which is what makes it usable.

**The real data is a JUDGE of the environment, never an input to the verdict.** The five profiles stay
declared — they are his sentences — but their LEVEL does not: `profiles.MARKET` is what a real table
pays, so a strategy is now a deviation from a measured ladder instead of from an invented one. What the
bench judges (which strategy wins a season) has no real outcome to be fitted to, and the numbers the
mechanism produces on its own are what get scored below.

### The operator's four objections, each with its null

| his objection | the bench, before | **real** | the bench, now |
|---|---|---|---|
| «non è realistico che L.Martinez non venga preso» | 14.3 of the top 50 unsold | **1.75** | **1.3** |
| «P2 … almeno 3 [top defenders] devono essere suoi» | 2 of 8 called, 0-1 drawn | 3+ top-tier men in one role: 4% of squads | **3.8** |
| «P4 deve puntare sul TOP in attacco … lo attende» | the top man in 1 window of 2 | dearest lot = 42.8-44.1% of a budget | **50.0% / 43.5%** |
| «costi distribuiti in maniera troppo equilibrata» | gini 0.07-0.17 on 4 profiles of 10, **zero** men under 5 credits | gini **0.65-0.68**, **8-9.5** men of 25 at ≤5 credits | gini 0.59-0.62, 4.3-6.9 men |

He was right on all four, and the fourth was the biggest: four participants of ten finished with NO man
under five credits and 23-25 men in the 21-60 band, where a real squad has 8-9 at two-to-five credits
and puts **28-31% of its own budget on one man**.

### One cause for all four: the ladder was indexed on the wrong thing

A recipe is «for the n-th man of a role, the multiple of the ask I will go to», and the step was chosen
by HOW MANY MEN OF THE ROLE THE SQUAD ALREADY HELD — which is the same number as the TIER only when the
lots are called dearest first, because there the first defender you meet IS the best one left. Drawn at
random the recipe read «1.9 times the ask for whatever defender turns up»: P2 met the 90th defender of
the listone and paid him the first-choice premium, then had nothing left for Dimarco.

`Team.step` now indexes on `max(tier, held)` — the tier being the rank inside the role over the number
of teams, which is a conservation law rather than a choice (in a league of ten there are ten
first-choice defenders, because each participant fields one). Both halves are needed: the first is what
the ladder always meant to say, the second is what stops a profile buying eight first-choice defenders
at the first-choice price.

### THE MARKET LADDER, measured (`profiles.MARKET`)

Median of paid/ask inside the tier, over the 131 auctions, each normalised by its own montepremi first:

| | tier 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| **P** | 1.25 | 0.34 | 0.50 | | | | | |
| **D** | 0.87 | 0.69 | 0.50 | 0.43 | 0.23 | 0.24 | 0.18 | 0.19 |
| **C** | 1.18 | 0.83 | 0.62 | 0.50 | 0.25 | 0.25 | 0.16 | 0.21 |
| **A** | **2.38** | 1.34 | 0.92 | 0.30 | 0.18 | 0.18 |

It replaced a flat 1.0 on every tier for the two profiles with no plan — wrong at both ends at once —
and it hands over the department split without anybody declaring one: **P 9.1% · D 16.3% · C 27.2% ·
A 47.4%**. Nearly half the money goes to six men of twenty-five. Worth comparing with the arm's own
`role_shares`, which derives D 32.4% and A 33.8% from the surplus: not an error, a valuation that
disagrees with the market — and the reason the arm never buys a first-tier forward.

**The MEDIAN and not the ratio of sums**, which is 1.03-1.06 times it at the top of a role and 1.4-1.7
times it in the tail, because a handful of filler men are bought at the death with whatever is left in a
purse. That inflation is real and this bench produces it on its own (`scale` rises as a squad runs out of
slots); putting it in the ladder too counts it twice, and measured it does — the ratio of sums gives 2.7
men under 5 credits per squad against 4.3 for the median, on a real 8.0. **A ladder is the ceiling of an
ORDINARY purchase.** The price of the median is conservation: summed over the tiers it recovers 79% of
the montepremi, so a plan priced on it starts at a scale of 1.21 and the mechanism supplies the rest —
which is checked, the credits left in pocket come out at 2.8% of a budget against a real 2.8%.

**One limit inside the first band, stated rather than smoothed away**: a tier is `TEAMS` men wide because
that is the conservation law, and inside the first band of the ATTACK the real ladder still falls — rank
by rank 2.81 3.36 2.15 2.60 3.01 2.23 then 1.79 1.23 1.89 1.90. The six dearest forwards cost more than
the four behind them and this bench prices all ten alike.

### «Nobody ends with credits in his pocket» is a NORMALISATION, not a floor

The floor was «what the purse can afford per remaining slot», claimed by every man on the block: with
1000 credits and 25 slots it says «40 a man» about the best striker of the listone and about the 200th
defender, and it was the first cause of the flat auctions. `Team.scale` replaces it — the recipe is
normalised to what is left to spend, so a participant who has saved bids up by himself and one who has
overpaid rations himself, both IN THE SHAPE OF HIS OWN PLAN.

**And the variant «no scale for whoever has no plan» was written and REFUSED by measurement**, although
its argument is this project's own (a decreasing ladder is a rationing plan, so giving one to a profile
defined as having no plan is a defect): P1a finishes with **49% of his purse at a called auction and 71%
at a drawn one**, and the aggregate residual goes from 2.8% (= the real figure) to 6.0% and 22.9%. The
market ladder is what the market PAYS, so a bidder who bids exactly it wins only half his men and cannot
spend his purse. Here the scale is not a plan: it is the law that turns a price into a ceiling.

### A slot kept for a champion: COUNTED, never declared

`Team.keeps` has no constant. If `hands` participants still want a role, the better men left in the urn
go one each, so this squad's share of them is their number over the hands up — and while that share
covers every slot it still has there, letting this one pass costs nothing. It is the count
`Team.alternative` does for a CREDIT, done for a SLOT.

The two DECLARED forms that came first were both worse and stay on the record: keeping the last slot of a
role while a FIRST-tier man is still to come leaves 7.73 of the top 50 unsold (the men refused are the
second and third tier of the crowded roles), and extending it to the second tier makes it 10.67. A
threshold moves the problem down a tier instead of solving it. Zero slots are left unfilled.

### THE STRUCTURAL DEFECT: at a real drawn auction THE URN IS RESHUFFLED

The biggest thing these data found, and it was not on the operator's list. In the **five auctions whose
extraction order can be reconstructed**, every one of the 518 quoted names is drawn **5 to 9 times**, and
**Martinez L., Malen, Dimarco, Paz N. and Thuram all appear among the extractions nobody bid on** and are
sold later. A drawn auction is not one pass over the listone: it keeps drawing until the rosters are full.

This bench modelled a single pass, and that single pass produced three of the numbers published above:

- «**14.3 of the 50 best men go unsold**» — an artefact. With re-entry it is **1.3**, against a real 1.75.
- «**the dearest man goes from 0% (never awarded) to 35% depending on WHEN he is drawn**» — an artefact,
  and the «never awarded» half disappears entirely (0 of 60).
- «a refused name has no guaranteed replacement behind him» — the sentence `ALT_WEIGHT` rests on. A
  refused name COMES BACK, so that parameter had to be re-measured on the mechanism that exists.

Re-entry is the platform's rulebook and not a strategy: no parameter, and a called auction stays one pass
because there the manager chooses whom to put up and nobody calls a man nobody wants.

### What still does not reproduce, with its number

One man at a time over 36 real drawn auctions: **Malen costs 42.2% of a budget when awarded in the first
40% of the auction and 42.5% after**, `r(when, price) = −0.147`; Martinez L. 37.7% and −0.207; Ramos G.
32.6% and −0.086. **The price of a champion does not depend on when he comes up.** On this bench, after
everything above, the same man costs **38.1%** drawn in the first quarter and **1.3%** in the last,
`r = −0.904`.

The diagnosis is in the purses and not in the prices: our participants spend in the third to seventh
tenth and reach the last quarter empty, where a real table still has its money.

> **CLOSED the same evening, and the cure proposed here was WRONG.** «Holding back the money of the best
> man still in the urn» was written and measured: it leaves **22.3%** of the credits in pocket and does
> not move the champion by a decimal, because the binding resource was the SLOT and not the credit. What
> was actually broken is the ORDER - a real auction is played role by role - plus the ladder's index,
> which priced the champion as a fifth forward. See «ALIGNING THE BENCH TO REALITY» below.

**And a lesson about the index that nearly produced the wrong diagnosis.** The `indice_prezzo` curve by
tenth of the auction (which `sintesi-posizione.csv` carries ready-made) reads, drawn, 0.95 · 0.54 · 0.55 ·
0.51 · 0.66 · 0.85 · 0.78 · 1.00 · **1.69** · 1.11 — a market that saves early and fights at the end. It
is NOT free of composition: the index divides by the Qt.I, but the paid/ask ratio itself rises with the
man (2.38 for a first-tier forward, 0.19 for an eighth-tier defender), and in the ninth tenth the men
awarded carry **1.42 times** the auction's mean Qt.I. The spike is largely WHO is awarded there, not what
is paid. The per-man test above is what decides — and it earned its keep: the first cure written on that
curve (an urgency floor when the urn can no longer cover the open slots) was **measured and refused**,
because it does not produce the spike (ninth tenth 0.26 against 0.45) and costs 2.8 → 1.7 points of
residual.

### The ENGINE ARM against a realistic table: the margin was their waste

| | before | now |
|---|---|---|
| called | 2665.5 points, mean place 1.70 | **2604.2**, place **4.40**, 0 titles of 10 |
| the table, called | ~2414-2477 | **2539.5** |
| drawn | ~2568, place 2.90 | **2087.3**, place **10.67 of 11**, 99.1 holes, 674 credits spent of 1000 |
| the table, drawn | ~2414 | **2536.5** |

The table gained ~120 points by becoming realistic and the arm lost 480. **«A strategy that wins only
because the table wastes its money is not a strategy» was already written here, and the real data
measured it from the other side.**

> **CURED the same night, and the cause was not the valuation.** The arm's ceilings live in fantapunti
> while the prices live on the market's ladder, so it could not win a contested lot at any level - it
> bid a FIFTH of what the men it lost went for. On the market's ladder, tilted toward the back, it goes
> from last of eleven to FIRST (+17.9%, 10 windows of 10, holes 79.8 → 22.4). See «MAKING THE ENGINE ARM
> WIN AT AN URN» below - including the half that says our own ranking adds nothing to it, and the LAST
> section, which found that the ranking was not being read and spent it where it pays.

It is not `ALT_WEIGHT`'s tuning: re-swept over the whole 0…1 grid it is **inert at a called auction**
(identical at every point, which confirms that nothing published there depends on it) and at a drawn
auction **every point of the grid finishes last** — best 0.5 at 2292.9, the adopted 0.75 at 2105.4 — and
the grid reads the same to a decimal with re-entry on and off, so the collapse is not an effect of the new
mechanism either. Two probes for the reason: **without the department ceiling** the arm collapses even at
a called auction (2459.1, place 9.00 — that ceiling is essential), and with its **ceilings lifted by half**
it gains at a called auction (2624.4, place 3.50) and does not recover at a drawn one (2160.9). The
diagnosis is LEVEL and not shape: `engine_rate` calibrates so the 25 men it wants cost exactly one budget,
while a real table puts 47% of the montepremi into attack and 2.38 of the ask on the first forward. The
arm loses every contested man and buys what nobody wants.

### Do the five profiles exist? Yes — and two were missing

k-means on the four department shares plus the concentration, over the **1,177 real squads**, k=5:

| share | P | D | C | A | top1 | at ≤2 credits | who |
|---|---|---|---|---|---|---|---|
| 25.7% | 9% | 16% | 30% | 44% | 25% | 37% | balanced, with a one-credit tail |
| 23.6% | 8% | 14% | 23% | 55% | 34% | 27% | **P4** |
| 23.2% | 9% | 18% | 28% | 45% | 22% | 15% | **P3** |
| 14.0% | 8% | 11% | 19% | **63%** | **46%** | 42% | *one champion and the labourers* |
| 13.5% | 12% | **24%** | **38%** | 26% | 18% | 23% | *no top striker* (a relative of **P2**) |

Three of the five clusters are his. The two that were missing are declared and **seated OUT** of the
declared table, because who sits at his table is his decision and not a measurement: **P5 «no top
striker»** (spends 62% between defence and midfield against the market's 43.5%, dearest buy 18% of the
budget against a median 26%) and **P6 «one champion»** (63% in attack, **46% on one man**, 42% of the
squad at two credits or less). Two more readings from the same table: owning 3+ top-tier men of one role
is RARE (P 1% · D 4% · C 3% · A 1%), so P2 as the operator wants him is a real and rare strategy — and
the bench now gets him 3.8, slightly above his own target; the median squad owns ONE top-tier man per
role, p90 two.

### The mental threshold of 500: CONFIRMED by measurement

Over 29,421 real purchases the p99.9 of a single purchase is **52.1%** of a budget and the maximum
**73.0%**; above half a budget there are **39 purchases (0.13%)**, i.e. **0.30 per auction**. «Difficilmente
si supera» measured is one purchase every three auctions. The p50 is **1.6%** (16 credits of 1000) and the
p90 **9.9%**.

And the number this README **withdrew** on 02/09 now has an answer: the dearest lot of an auction costs
**42.8%** of a budget called (median, 18-73%) and **44.1%** drawn (36-73%). The operator's recollection
(«48-75%, mean 60%») was closer to the truth than the 31.2% the bench was measuring; withdrawing it was
right and this is the replacement. The bench now reads 50.0% called and 43.5-45.3% drawn.

### The dearest men: the same names, and the urn CONCENTRATES

On the tables like his, the 25 most expensive men are **16 forwards · 6 midfielders · 2 keepers · 1
defender** called and 15/7/2/1 drawn — practically the same names in both mechanisms. **Malen** (Qt.I 34)
is the dearest man of the auction in **74 of 86** called auctions and **25 of 36** drawn, at 42.5-43.5% of
a budget; then Martinez L. (37.2-38.2%), Ramos G. (30.5-32.4%), Hojlund (26.2-30.2%), Thuram, Kolo Muani,
Kean.

**The mechanism does not change who, it changes how much the money concentrates.** The seven dearest cost
MORE drawn (+1.0 to +4.0 points of budget; only Thuram reads −1.8) while the median man costs LESS (1.0%
→ 0.6%) and only **72 men of 292** are dearer drawn. The ladder says the same: the attack's first tier
goes from 2.31 to **2.50** and the defence's fifth-to-eighth from 0.25-0.26 to **0.14-0.17**.

### What these data cannot say

- **There is no sporting outcome in them.** They are auctions, not seasons: which strategy PAYS remains
  the bench's question, and the real data calibrates the environment rather than the verdict.
- **`modalita` is the league setup and the order can be changed mid-auction.** 17 of the 131 finished on a
  different order (11 alphabetical, 4 by value) and **13 of those are among the 36 «random»**. The **20
  auctions identical to his carry NO order change**, so the concentration and dearest-lot figures are
  clean; the market ladder, measured over all 131, is not.
- **The extraction order exists for five auctions only**, reconstructed from the seed and verified: the
  database records purchases, not extractions. Re-entry is measured there, and the 5-9 passes come from
  those five.
- **Roles are not in the light export** and were re-attached BY IDENTITY from our own `rosters` (`fc_id` is
  this project's primary key): 574 of 587 quoted men, 98%.
- **11 auctions have unverified residuals** (the host corrected budgets by hand) and are excluded from the
  pocket measurement rather than estimated.

## ALIGNING THE BENCH TO REALITY (02/09/2026, evening): the ORDER was the defect

The section above left three measured gaps and a diagnosis that turned out to be wrong. Closing them
took one correction to the MECHANISM and two to the indexing, and it refused three cures that had been
written before they were measured. One instrument found all of it: **the cumulative spend curve**.

### The instrument: how much of the montepremi has left the table, tenth by tenth

Not the paid/ask index by tenth (already declared contaminated by composition above) but the CREDITS:

| | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th | 9th | 10th |
|---|---|---|---|---|---|---|---|---|---|---|
| **real, called** | 9.0 | 18.6 | 24.8 | 27.8 | 40.5 | 50.4 | 54.3 | 77.0 | 95.5 | 100 |
| bench, free order | **46.1** | 65.6 | 78.3 | 85.9 | 90.8 | 94.4 | 96.7 | 98.3 | 99.4 | 100 |
| **real, drawn** | 8.8 | 13.7 | 18.6 | 23.9 | 30.9 | 40.7 | 50.4 | 61.9 | 87.2 | 100 |
| bench, free order | 9.3 | 21.2 | 35.2 | 48.1 | 60.2 | 71.5 | 83.0 | 92.1 | 98.4 | 100 |

A real table still holds **70% of its credits at half time** and spends 38% of them in the last two
tenths; the bench had spent 60% by half time, and at a called auction it was out by a factor of FIVE in
the first tenth. No change of behaviour moves a curve like that: it is the shape of the ORDER.

### The defect: an auction is played ROLE BY ROLE

Mean award position inside the auction, per role, over the **20 real auctions with his exact league**:

| | P | D | C | A | phased? |
|---|---|---|---|---|---|
| 16 of 20 | **0.06** | **0.28** | **0.60** | **0.88** | yes, always P→D→C→A |
| the other 4 | ~0.5 | ~0.5 | ~0.5 | ~0.5 | no, free order |

**Those four numbers are identical to two decimals across sixteen separate sessions** - the signature of
an order the platform imposes rather than a habit - and they are exactly where the ROSTER puts the
boundaries: 3 keepers of 25 places, then 8 defenders, then 8 midfielders, then 6 forwards. Inside a role
the order is random (the position's sd inside a role is 0.06-0.13 against 0.29 for a draw spread over
the whole auction). In aggregate: 81 called auctions of 86, 32 drawn of 36.

Adopted as `PHASES` / `in_phases`, read by both order functions. **What it explains at once, with no
behaviour added**: the spend curve (which is the department split - P 9.1 · D 16.3 · C 27.2 · A 47.4 -
accumulated in this order and nothing else); the dear men being awarded late (they are FORWARDS); and
the champion's price not depending on when he is drawn, because wherever that is it is inside the attack
phase, when every rival still has all six forward slots open and the money he kept for them. The free
order stays reachable (`--free`) because 4 of those 20 auctions play it, and it is what the unsold
figures above were measured on.

After it, the called curve reads **8.3 · 19.9 · 24.1 · 25.6 · 40.0 · 48.1 · 50.5 · 78.3 · 98.1 · 100**
against a real **9.0 · 18.6 · 24.8 · 27.8 · 40.5 · 50.4 · 54.3 · 77.0 · 95.5 · 100**. It is the closest
check this bench has ever passed, and it is not a calibration: the phases have no parameter.

### «The champion priced as a fifth forward»: the index was counting the wrong men

With the phases in, the champion always falls in the attack phase, so his test has to be read INSIDE
his phase - which is also how the real one is measured (Malen lands in the attack block 34 times of 36).

| inside the attack block | 1st quarter | 2nd | 3rd | 4th |
|---|---|---|---|---|
| **real** (Malen, 36 urns) | 43.1% | 45.4% | 37.6% | 34.7% |
| **real** (Martinez L.) | 36.8% | 41.0% | 35.0% | 27.8% |
| bench, before | 47.8% | 31.0% | 12.3% | **1.6%** |
| **bench, now** | 47.0% | 42.0% | 42.0% | **40.5%** |

A **photograph of the table at the moment the champion is drawn** found the cause: nine hands with a
forward slot open, credits [12, 12, 50, 68, 106, 145, 177, 369, 513], and the three highest bids **184,
150, 150**. `Team.step` was indexing the ladder on HOW MANY MEN OF THE ROLE the squad owns, so a squad
holding four forwards priced the best player of the game as its FIFTH - 0.18 times the ask instead of
2.38. It now counts the men it owns who are **as good or better**; the guard the plain count existed for
is intact, and the four targets all move the right way (men at five credits or less 7.0 → 8.0 against a
real 9.5, credits left in pocket 10.2% → 6.2% against a real 6.1%, the champion's first quarter 47.8% →
43.9% against a real 43.1%).

### A TARGET is a NAME, not a tier

The slope inside the phase survived that. `PLAN` said «a first-tier forward», and read that way the
reserve released itself **the moment P4 bought the tenth-best of the ten** - after which nobody was
keeping money or a place for the champion, and whoever met him late paid a credit. The operator's words
say something else: «deve puntare sul TOP in attacco (L.Martinez/Thuram/ecc...) e **fa di tutto per
prenderlo**». So a target is one of the `count` DEAREST men of the role - the rank, not the band
(`set_tiers` writes `man["rank"]`, `Urn.rank_left` says whether he is still to be drawn) - and the place
follows the money: **a plan keeps its slot as well as its credits, and only a plan does.**

That last half is the only thing of this evening that is declared rather than counted, and the reason is
measured: given to EVERYBODY it strangles the auction (**8.4 slots of 250 unfilled** and 18 of the top 50
unsold, because all ten wait for the same man), and given to the two profiles whose declared strategy IS
that man it costs at most three places across the table. Which is the operator's sentence read literally:
«su 10 persone QUALCUNO dovrebbe conservare un posto in rosa aspettando proprio il campione».

### Three cures written and REFUSED by measurement

On the record because each looked obvious:

- **The credit hold alone** («what I would pay for the best chance still in the urn is not spendable on
  anybody else»): credits left in pocket 5.3% → **22.3%**, and the champion does not move (r −0.913 →
  −0.925). They hold the money and no longer have the place to spend it on - the binding resource was
  the SLOT.
- **The hold plus the slot, for everybody**: 8.4 unfilled slots per auction, 18 of the top 50 unsold,
  23.3% left in pocket. Ten participants waiting for the same man are not ten strategies, they are a
  jammed auction.
- **An urgency floor** («when the urn can no longer cover the open slots, the slot is worth the
  affordable share»): it does not produce the spike it was built for (ninth tenth 0.26 against 0.45) and
  costs 2.8 → 1.7 points of residual. It was written on the composition-contaminated curve, i.e. on the
  wrong clue.

### The cautious cap: from the tenth percentile to the p25, and now inert

`CAUTIOUS_CAP_SHARE` was **0.15** and nobody had measured it. In the real archive a squad's dearest
purchase is **14.8% of its budget at the p10, 18.4% at the p25 and 25.0% at the median**, and only
**10.4%** of 1,177 real squads keep it under 15%: that number put P3 at the tenth percentile of caution,
and with three seats of ten it was setting the second price for the auction's dearest man. It is now
**0.18**, the p25 - «he is in the most cautious quarter of a real table», which is what the sentence says
- and it is also where the called auction's residual lands nearest reality (3.4% at 0.15, 2.5% at 0.18,
1.4% at 0.22, against a real 2.8%).

**And it is now nearly inert**: over the whole grid 0.15 … 0.50 the four targets move by less than a
point. What had looked like a binding cap was a symptom of the step index above. *A knob that only bites
while something else is broken is a knob to re-measure after fixing that, not before.*

### Where the bench stands against the seven targets

| | called | real | drawn | real |
|---|---|---|---|---|
| spend curve | 8.3 … 98.1 | 9.0 … 95.5 | 6.5 … 83.8 | 8.8 … 87.2 |
| the dearest lot | 50.0% | 42.8% | **43.5%** | 44.1% |
| men at ≤5 credits | 5.6 | 8.0 | **8.1** | 9.5 |
| gini of the spend | 0.61 | 0.65 | **0.65** | 0.68 |
| credits left in pocket | 3.4% | 2.8% | **7.4%** | 6.1% |
| of the top 50, unsold | 0.0 | 0.0 | 1.4 | 1.75¹ |
| slots left unfilled | 0.00 | — | 0.00 | — |

¹ measured on the four real free-order auctions; our own free order reads 1.05.

What is still off target is **the tail of a called auction** (5.6 men at five credits against 8.0, and
the dearest lot at 50.0% against 42.8%), and the reason is structural and worth naming: at a real called
auction the MANAGER chooses which name to put up inside the role being played, while this bench calls the
dearest first. Our champion is therefore always the first forward called, when everybody still has all
his attack money. On the drawn mechanism, where the order is exogenous on both sides, five of the seven
targets are inside a point and a half.

### The standings that come out, and a strategy that changes verdict

**P4 collapses at a phased called auction** (2365.4 fantapunti, last, **68 holes**): his recipe saves
«in maniera netta negli altri reparti» and those departments are now played FIRST, so he reaches the
attack phase with the money and a squad that cannot cover. At a drawn auction he stays mid-table. The
engine arm recovers a little when called (2604.2 → **2628.3**, mean place 4.40 → **3.00**) and is still
**last of eleven** when drawn (2212.9 against P2's 2584.8): the diagnosis above does not change.

### Two lessons about the instrument

**A knob turned where nobody reads it prints identical rows, and those rows are the clue.** The first
cautious-cap sweep read the same numbers at every value from 0.15 to 0.50: `bench` imports the constant
by name, so patching `profiles.CAUTIOUS_CAP_SHARE` moves nothing. Same family as the column that did not
exist, seen from an experiment instead of an audit - and as there, **the first thing to suspect about a
flat result is the instrument.**

**And the photograph beats the reasoning.** Three cures were written and refused by reasoning over
aggregate curves; the real cause was found by printing, for ONE lot, who still had a slot, how many
credits he had and what he bid. This project had already written that rule for the Tk panel
(«photograph HIS window before re-explaining the code»); it holds identically for a mechanism.

## MAKING THE ENGINE ARM WIN AT AN URN (02/09/2026, night)

The operator's question: «dobbiamo fare in modo che la strategia dell'engine riesca a creare una rosa
equilibrata, solida e vincente, quali accorgimenti possiamo adottare?». The arm was **last of eleven** at
a drawn auction (2212.9 against the best human's 2584.8, 79.8 holes, 656 credits spent of 1000). It is
now **first** (2609.0 · place 3.82 · 22.4 holes · 987 spent · 28 titles of 100), and the championship
agrees (54.7 table points, 45 titles of 200, and the FEWEST holes at the table).

Seven families of correction were measured. **One matters**, and it is not the one that looked likely.

### The photograph, again, and before the reasoning

Role by role, on the lots the arm LOSES, how far its ceiling was from the price:

| | P | D | C | A |
|---|---|---|---|---|
| ceiling / price on the lots it lost, drawn | 0.47 | **0.30** | **0.16** | 0.20 |
| paid / ask on the ones it won | 0.66 | **0.15** | **0.10** | 0.31 |
| the same two, called | 0.69 · 0.95 | 0.85 · 0.82 | 0.79 · 0.72 | 0.63 · 1.32 |

It does not lose narrowly: it bids **a fifth**. And what it wins it pays a tenth of the ask for, i.e. it
buys only the leftovers - its median purchase costs **one credit** against the table's fifteen, and
**30.7%** of its men are forecast under nineteen matchdays against 17.9%. At a called auction the same
code bids 0.63-0.85 and spends 987.

### The defect is one of SCALE, and the hole count said so already

79.8 holes against the best human's 20.6, at `HOLE_COST` = 4.73, is **266 of the ~370 points** it was
behind. But the holes are the symptom. The cause is that the arm prices a man in **fantapunti**
(`engine_worth` = surplus + cover) and converts with one global rate, while the market prices him as a
**multiple of his ask**, tier by tier - and that ladder is what conserves the credits. *A bidder whose
ceilings do not live on the same scale as the prices cannot win a contested lot at any level*: raise them
and it overpays for the first man of each phase, lower them and it buys nothing.

One bid, every component (T2, first urn):

| | ask | surplus | cover | alternative | role cap | bids | went for |
|---|---|---|---|---|---|---|---|
| Bastoni | 56 | 16.6 | 130.1 | 133.0 | 45 | **45** | 84 |
| Vecino | 21 | 7.9 | 92.5 | 148.2 | 63 | **1** | 1 |
| Thuram | 102 | 44.5 | 129.6 | 142.6 | 112 | **145** | 253 |
| Martinez L. | 119 | 43.3 | 130.4 | 155.6 | 161 | **214** | 402 |

### Six families measured and refused, with their numbers

On the record because each had an argument and two had a good one:

- **`ALT_WEIGHT`** (the option value). Re-swept over 0…1 with the phases in: the optimum moves from 0.75
  to **0.5** and is worth **+5.2%** (2224 → 2340). The best of the six, and not enough. Why it moves is
  the phases' own lesson: inside a role «somebody better is still coming» is nearly always true, so
  waiting stops carrying information.
- **The alternative subtracted on the SURPLUS only**, not on the cover. The argument is strong -
  `cover_value` is the worth of *not leaving a place empty*, not a property of the man, so the two cover
  terms cancel and the arm ends up pricing everybody at the margin - and it is worth **+3.5%**, less than
  plain `ALT_WEIGHT` 0.5. Right diagnosis, insufficient cure.
- **The EXACT expected holes** (a Poisson-binomial over the shares, like `expected_r_factor`) instead of
  `min(share, deficit)`: **−0.3%** drawn, +0.0% called (though holes 10.8 → 8.6 there). A cleaner
  formulation with no measurable gain.
- **The department ceiling**: `URGENCY` 3 and 5 (+0.0% and −0.6%), weighted by worth instead of spread
  evenly over the slots (−0.5%), removed entirely (−0.6% drawn and **−9.9% called**, where it stays
  essential).
- **The rate recalibrated on the quantity the bid actually uses** (`engine_worth` instead of the surplus
  alone - a real inconsistency: the conservation law is read on one quantity and the bid uses another,
  three times larger): **−10.4%**. The ceilings become tiny.
- **The market's department shares** instead of ours: −0.1% drawn, **+1.0% called**.

### What is ADOPTED: the market's ladder, leaning on the back

`profiles.engine_ladder()`. At a drawn auction the arm bids like a competent human - `step(tier) × ask ×
scale` - where the base ladder is the one **measured on the 131 real auctions** and the step is tilted:

- **`ENGINE_BACK` = 1.9** on keepers and defenders;
- **`ENGINE_TOP` = 2.2** on the first four tiers of every role;
- and the whole thing **renormalised** so the plan costs one budget: *a tilt that does not conserve is
  not a strategy, it is a bigger purse.*

Effectively ~1.7 times the market on the top four tiers of P and D, ~0.9 on the top of C and A, and
0.4-0.8 on the tails. **It is P2's strategy, found by the search rather than copied** - and the
regulation says why it pays: both modifiers of this league are paid in **BASE VOTES** (the defence one on
the mean of the best three defenders, the R-Factor on all eleven) and base votes are what a back line
delivers.

| | before | now |
|---|---|---|
| fantapunti, 10 windows × 10 urns | 2212.9 | **2609.0** |
| mean place of eleven | 10.27 | **3.82** |
| holes in a season | 79.8 | **22.4** |
| credits spent of 1000 | 656 | **987** |
| R-Factor · defence modifier | 1.8 · 2.4 | **10.9 · 12.6** |
| titles | 0 of 100 | **28 of 100** |
| gap to the best human | −371.8 | **+54.5** |

Verdict in the gate's vocabulary: **STRICT**, 10 windows of 10 improve, worst **+10.1%**. The optimum is
**interior** on the widened grid (back 1.3…2.3 × top 1.3…3.5: the neighbours read 2584.6 · 2584.9 ·
2604.0 · 2569.9 against 2609.0), but the plateau is **flat inside 1%** - so the direction is the finding
and the two decimals are not.

### Three things that have to be said because they are the uncomfortable half

**Our own RANKING adds nothing** - and see the last section of this file, which found out WHY and turned
the sentence half round: the arm was not reading the engine at the urn at all, so this comparison was
measuring the same market bidder twice. Spent INSIDE a tier it is worth +1.02% robust and survives three
arms. **The same ladder read on the PRICE's ranking instead of the engine's**
gives **+12.4% against +12.3%** - identical. What the arm gains here is not a better opinion about
footballers, it is bidding on a scale that can win a lot. Our informational edge over the listone, spent
this way, is worth **zero** - and `metrica-asta-surplus-v1.md` §18 had already measured that edge as one
number wide (the appearances).

**And our department shares are redundant with the tilt.** On the untilted ladder they are worth +1.1%
(the surplus says P 14.5 · D 20.1 · C 28.2 · A 37.2 against the market's 9.1 · 16.3 · 27.2 · 47.4 - it
leans the same way); on the tilted one they cost **−1.2%** and improve 2 windows of 10. The tilt absorbs
them, so the parameter was **removed** rather than carried unread.

**And the margin does NOT survive its own competition**, which is stronger than the «still leads by 6.9»
first written here: re-measured at ten participants and twenty urns, with **three** engine seats the gap
to the best human is **−2.8**, a dead heat (80 titles of 600, 13.3% against the 10% of chance). Most of
the one-seat margin IS exclusivity. See «TEN AGAINST TEN» below.

### And nothing changes at a CALLED auction

The same ladder **loses** there: 2575.7 against 2628.3, 3 windows of 10, worst −7.8%. So it is switched on
**by the mechanism** (`Urn.random`) and not by a flag anybody has to remember, exactly as `ALT_WEIGHT` is
switched off there. *A parameter belongs to the mechanism it was measured on*, and when called the
fantapunti arm is still the best at the table (place 3.00, 10.8 holes, 56.5 table points).

### A defect found for the second time the same way

The first run with the adopted code read **identical** to the one before it: `one_auction` appends the
engine arm AFTER the loop that hands `asks` to everybody, so the arm did not have them and the dispatch
never fired. Second time in one evening that a table identical to itself denounced a knob turned where
nobody reads it (the first was `profiles.CAUTIOUS_CAP_SHARE`). **Identical rows are not a result, they are
a broken instrument** - and they deserve suspicion before the conclusion does.

### TEN AGAINST TEN, and three of the figures above withdrawn (02/09/2026, late)

Two observations from the operator, both right, and the second born of the first.

**«I dati reali parlano di aste a 8 o a 10 partecipanti … nelle nostre simulazioni invece abbiamo 11 o
13?»** Yes, and it was a defect. `bench.py` seated the engine arm as an ELEVENTH participant at a
declared table of ten, and the three-seat null made it THIRTEEN - while everything this bench is
calibrated against says TEN: `rules.TEAMS` = 10, `to_credits` conserves ten budgets over the 250 men ten
squads roster, a TIER is a rank divided by ten, and the replacement level behind every surplus is the
10 × slots-th man. Eleven participants bring 10% more money and slots than the calibration assumes;
thirteen bring 30%. (`league.py` never had it - its ten letters include the arm.)

Cured with `bench.seated`: **the arm takes a chair, it does not pull one up**, and which human gives his
up is declared and deterministic. The market ladder was also re-measured on the **60 real auctions played
by ten participants** rather than all 131 - a change worth almost nothing (the largest move is the
midfield's third tier, 0.62 → 0.74), which is the montepremi normalisation doing its job. The population
is right now, and that is the reason rather than the size of the change.

**And three figures move.** Re-measured at ten participants and twenty urns (200 seasons for the arm,
600 for the null):

| | above (11 participants, 10 urns) | **now (10 participants, 20 urns)** |
|---|---|---|
| the ladder's gain | +17.9% · 10/10 · worst +10.1% | **+20.2% · 10/10 · worst +12.6%** |
| the arm, before | 2212.9 · place 10.27 · 79.8 holes | 2161.9 · 9.68 · 87.9 |
| the arm, now | 2609.0 · place 3.82 · 22.4 holes | **2599.6 · 4.29 · 22.5** |
| gap to the best human | +54.5 | **+21.3** |
| the three-seat null | +6.9, «still first» | **−2.8, a dead heat** |

**A PAIRED comparison survives a sample size that kills an unpaired one.** The adoption is the same arm
on the same urns with and without the ladder, so the bigger sample confirms and strengthens it. The gap
to the best human and the null are a mean against the MAX over five profiles - unpaired, and at ten urns
they were noise. So the honest null is that **the edge does not survive its own competition in any
measurable way**: most of the one-seat margin was exclusivity. The mechanism is measured, not assumed -
the first-tier keepers the tilt targets go from **0.62 to 0.85 of the ask** and the defenders from 0.96
to 1.05 when three arms want them together, and each arm ends with 8.7 of them instead of 9.8.

**«≤5 crediti è una soglia ASSOLUTA … magari rivedi questo valore.»** Right, and measuring it gave a
better answer than the correction it asked for. Over 600 real ten-team squads, how many of the 25 men
cost less than X:

| threshold | budget 500 (360 squads) | budget 1000 (200) | stable? |
|---|---|---|---|
| ≤ 5 credits | 10.7 | 8.5 | **no** - the threshold used above |
| **at 1 credit** | **6.1** | **5.7** | **yes** |
| ≤ 0.2% of the budget | 6.1 | 6.5 | nearly |
| ≤ 0.5% | 7.4 | 8.5 | no |
| **≤ 1.0% of the budget** | **10.7** | **11.0** | **yes** |

So the target is now two budget-free counts - men bought at the MINIMUM and men under one per cent of the
budget - and the big fact behind them is that **24% of all real purchases cost one credit or less**
(price of a purchase, as a share of a budget: p10 0.20% · p25 0.30% · p50 1.60% · p75 4.80% · p90 10.00%).

**And the new target exposes a defect the old one hid:** the bench reads **1.8 / 2.5** men at one credit
against a real **5.7 / 6.7** (called / drawn), while the ≤1% band matches (9.9 / 10.7 against 10.5 /
11.7). The TAIL of our market is right and the FLOOR is not: our tables pay 2-5 credits where a real one
pays ONE, because every participant of ours has a positive ceiling for every man (the tail step, 0.17-0.21
of the ask) so with ten bidders the second price never reaches one - while at a real table nine managers
of ten do not bid at all on the bottom of the listone. Its consequence is small and stated: ~3.9 men a
squad at ~4 credits instead of 1, i.e. **12 credits of 1000**. It moves no verdict; it is the SHAPE of the
market's floor, and a well-chosen threshold made it visible where a badly chosen one hid it.

## THE INFORMATIONAL EDGE PAYS, AND IT PAYS *INSIDE* A TIER (02/09/2026, late night)

The operator's request: «dobbiamo migliorare l'engine che ti consiglia le offerte per un'asta random».
The document's own list of seven open items did not contain this one, because the diagnosis that opened
it had not been made: **at the urn the arm was not reading a single number from the engine.**

### The diagnosis, counted rather than deduced from the code

Instrumented, over the ten windows, twice:

| how many times the arm calls it | called | **drawn** |
|---|---|---|
| `engine_worth` (surplus + cover) | 1436 | **0** |
| `cover_value` · `coverage_need` | 1436 · 1436 | **0 · 0** |
| `Team.alternative` (the option value) | 1436 | **0** |
| `Team.role_cap` (the department ceiling) | 1436 | **0** |
| `Team.step` (the market ladder) | 0 | 5746 |

It is a correct and undeclared consequence of the adoption above: at a drawn auction the arm borrows
`profiles.engine_ladder()` and goes down the HUMAN branch, which prices `ask × step(tier) × scale` - and
the TIER is defined by the PRICE (`set_tiers` sorts on Qt.I). So the arm that wins at the urn was a
market bidder leaning on the defence, and its opinion about footballers entered nowhere. Which is exactly
what §17.5 measured from the other side («the same ladder read on the price's rank gives +12.4% against
+12.3%, identical») and it also said what to do about it: *«if one day the informational advantage has to
pay, this is not the form».*

### Where a ladder leaves room, and what fills it

A tier is `rules.TEAMS` men wide because that is the conservation law, so ten men are priced alike.
Measured on the ten windows, inside one (role, tier) band:

| | the PRICE spans | the expected APPEARANCES span |
|---|---|---|
| defenders, 4th tier | **0.08** of its own median | **0.33 of the calendar** (0.42 → 0.76) |
| midfielders, 3rd | 0.12 | 0.32 (0.50 → 0.81) |
| forwards, 1st | 0.48 | 0.31 (0.58 → 0.89) |
| keepers, 2nd | 1.35 | **0.69** (0.15 → 0.84) |

The defenders' band is the cleanest case: twelve matchdays of difference at the same price. And the quantity is not a choice:
`metrica-asta-surplus-v1.md` §18 measured our whole incremental edge over the quotation as ONE number -
partial Spearman against the outcome controlling for Qt.I, `pv_pred` +0.198 (euro) and **+0.243** (Serie
A) against the fantamedia's +0.046 / −0.032 and the **surplus's +0.006 / −0.077**.

`bench.INSIGHT` = 0.80, `bench.set_insight`: the ladder's step is multiplied by `1 + INSIGHT × u`, where
`u` is the man's distance from his band's own mean over the band's widest man. **It conserves by
construction** - the mean of `u` over a full band is exactly zero, so the plan `Team.scale` prices still
costs one budget, which the ladder's own tilt needed a renormalisation for. A man the engine does not
price sits at the MIDDLE of his band and never at the bottom.

### The verdict, and the label the bigger sample retired

Pre-registered before the run; paired - the same arm, the same urns, with and without - ten
participants, the arm on one of the ten chairs:

| | 40 urns (400 seasons) | **80 urns (800 seasons)** |
|---|---|---|
| paired gain | +32.9 ± 6.3 (t 5.2) | **+26.4 ± 4.5 (t 5.9)** |
| per cent | +1.26% | **+1.02%** |
| windows improving | 10 of 10 | **9 of 10** |
| the worst | +0.33% | **−0.42%** |
| verdict | **STRICT** | **robust** |
| holes a season | 23.5 → 18.5 | 22.9 → **18.8** |
| mean place | 4.27 → 3.50 | 4.20 → **3.52** |
| titles | 81 → 122 of 400 | 175 → **257 of 800** |

**The gain survives doubling the sample and gets sharper; the LABEL does not.** «Every window improves»
is a count on ten and one of those ten was a coin. So the adoption stands on the effect (t = 5.9) and is
published as robust - §18.2's own discipline turned on this adoption instead of yesterday's. The optimum
is INTERIOR and the plateau flat inside 0.05% (0.70 reads +26.1, 0.90 +25.9), so the DIRECTION is the
finding. And the channel ARRIVES: at an absurd 3.00 it reads −0.15% with the worst window at −2.90%.
At a CALLED auction nothing moves by a decimal (2647.4, place 3.70, 10.5 holes), because there the arm
never reaches `Team.step` - the mechanism switches it, not a flag, and there the appearances are already
inside `cover_value`.

### ...AND THIS MARGIN SURVIVES ITS OWN COMPETITION, which the ladder's did not

Re-measured with THREE arms: **+30.0 ± 4.0 (t 7.4), 9 windows of 10, worst −0.48%**, holes 26.5 → 20.8.
The term does not escalate a bid, it MOVES the same money inside a band, so three participants reading
the same forecast all still gain. It is the first thing this bench has found that pays for our OPINION
rather than for how we bid.

### Two things measured and NOT adopted

- **The RANK form** of the same deviation (linear in the order inside the band, which is the form the
  edge was measured in): +23.8 (t 3.6), 9 windows of 10, worst −0.39%, holes 20.2 - robust, and beaten by
  the magnitude, which says what a rank throws away.
- **A weight PER DEPARTMENT.** Asked apart the way §19.1 requires: all four +32.9, D·C·A +25.5, P·D +9.7,
  C·A +10.7, P alone +8.7 - **the parts do not make the whole** (9.7 + 10.7 = 20.4 against 32.9) and no
  half reaches the floor with a `t` over 2, because what the term buys are the two modifiers and those
  are a property of the ELEVEN. One global weight. Note the contrast with §19.1, and it is not a
  contradiction: the keeper half of the LADDER tilt was worth nothing (+0.1%) because it was a statement
  about the LEVEL of the band, while the keeper half of THIS term is worth +7.4 of the +32.9 because it
  is a statement about WHICH of the ten plays - and for a keeper, of whom you field one, that is the only
  question. In the data: first tier of T2, Svilar (pv 0.90) and Butez (0.57) ask 53 and 35 credits, so the
  price cannot separate them, and the term offers **107 against 10**.
- **`Team.keeps` counted on «who plays» instead of on the price tier** - a change of definition with no
  new parameter: +6.6 ± 3.8 (t 1.71), +0.25%, holes 18.5 → 17.0. Under the 0.5% floor and under two
  standard errors, so it does not go in; the direction is right and it is recorded as a candidate if the
  floor is ever re-measured.

## READING THE RIVALS: asked of an ORACLE, and the answer is no (02/09/2026, late)

The operator's question was «can identifying the rivals' strategies help us predict their moves and
optimise ours?». Four families measured against the pre-registered criterion, all four refused - and
the most interesting one is refused by a judge the internal criteria do not contain.

**The rule that decides is the MECHANISM's, not the rivals'. At a SECOND-PRICE auction, knowing what
it takes to win the lot in front of you is worth exactly ZERO**: above the clearing price you win and
pay the second price anyway, below it you lose anyway. Rival information can only pay through the
BUDGET - what you spend here you do not spend there - and the budget is already committed by
construction (`Team.scale` normalises the plan onto what is left). Every measurement below is a
different way of discovering that one fact.

### The shadow price of a credit: the right frame, and it loses with PERFECT prices

Keep the engine's worth in fantapunti and convert it into credits at the rate the state of the auction
implies, re-read at every lot: `lambda` bisected until the best squad still buyable costs the purse,
and `ceiling = price(m0) + (worth(man) - worth(m0)) / lambda`, where `m0` is the man that plan would
use LAST for the role. No parameter, and it subsumes `engine_rate`, `Team.alternative` and `role_cap`.

| prices feeding the plan | paired gain | holes | spend |
|---|---|---|---|
| the measured market ladder | **-6.86%** (t -6.21) | 15.1 → 38.6 | 977 → 917 |
| **ORACLE** - what each lot will really take | **-7.56%** (t -7.52), 0 windows of 10 | 15.1 → 41.4 | 977 → 945 |

Three defects paid for on the way, and each is a house rule met from a new side. **A worth-per-credit
ratio ranks the junk first when what binds is the SLOTS** - the first oracle spent 25 credits of 1000
on 25 one-credit men, and the same defect came back inside `keeps` an hour later. **A conservation is
read PER ROLE**, which is what `to_credits` says about itself: summed over the dearest 250 men the urn
was over-priced, the plan came out cheaper than the purse, the shadow price read ZERO and the arm
offered 241 credits for the 16th keeper of the listone. And **a ceiling is not a squad**: with no
`ABUNDANCE` floor the arm ended with two slots UNFILLED.

### Topping up to take the lot: monotone and negative

At a real raise auction the price CLIMBS in front of you, so this one needs no model at all - the
oracle only stands in for a hand that keeps raising, since the bench's bids are sealed.

| how far above its own ceiling | gain | holes |
|---|---|---|
| x1.5 | -3.67% | 16.5 → 28.4 |
| x2 | -4.93% | 16.5 → 33.2 |
| whatever it takes | -4.92% | 16.5 → 31.4 |
| x2, only where the engine rates him above his own band | **-2.74%** | 16.5 → 23.3 |

It is §17.4 from the other side - **a raise nobody pays for with a cut somewhere else is not a
strategy, it is a bigger purse, and the purse does not grow.** Winning a lot you were losing costs the
lots you were winning. Note the direction of the detail: restricting the raise to the men we rate above
their band is the least bad variant, so §21's discrimination is right and the ESCALATION is wrong.

### `keeps` on the DEAL, and `hands` on the rivals' MONEY - where the NULL beats the channel

Reallocating instead of escalating conserves by construction, and reading «better» as «more worth per
credit at what he will cost» is a change of definition with no new parameter. Refused hard: **-25.21%**
with oracle prices and **-34.45%** with the ladder (113-154 holes), the ratio defect twice.

Then the cheapest reading of all: a rival with twelve credits has a slot open and cannot contest a
sixty-credit defender, so counting him counts a hand that is not up.

| reading | gain | verdict |
|---|---|---|
| can afford 0.5 / 1.0 / 2.0 / 10.0 x the ask | +1.00 / +1.18 / +2.04 / +3.15% | robust ... strict |
| **can afford what he will COST** (`profiles.MARKET`, no parameter) | **+0.22%** (t 1.02) | **NO** |
| **NULL - `hands` x 0.25, reading nothing about anybody** | **+4.17%** | strict |
| **NULL - `hands` x 0.1** | **+4.78%** | strict |

**The null beats the channel and the parameter-free form is worth nothing: so this is not information
about the rivals, it is PATIENCE.** The affordability reading was a roundabout way of lowering `hands`,
and the lower the better - the optimum sat at the edge of the grid, which is this project's condition
for not adopting a number at all.

### The patience finding, and why it is NOT adopted

At the limit (`hands` = 1, i.e. the division by the hands up simply is not there) it passes every
internal criterion: **+2.83% (t 19.30) and +3.82% (t 26.01) over 800 paired seasons at x0.6 and x0.4,
10 windows of 10, worst window +1.48% and +2.45%**; +4.99% (t 16.85) at x0.1 on 200; holes 19.2 → 6.0,
mean place 3.52 → 1.24, zero slots unfilled. It survives THREE arms at the table (+2.76% strict), it
has a ceiling (the absurd end reads +4.13%, less than the limit) and it is INERT at a called auction to
the decimal, `keeps` being switched off there by the mechanism.

The mechanism, photographed: the arm buys later (median lot position 1.10 → 1.52) and pays **0.78 →
0.30 of the ask** for BETTER men (median pv 27.3 → 28.2, median tier 2 → 1).

**And then the archive refuses it.** The 10 real drawn auctions of his league (2495 awards) say
paid/ask falls 53% from the first half of a phase to the second - but inside the top two tiers only
**14%** (4.08 → 3.51), so almost all of that fall is COMPOSITION, the defect §15.7 already isolated.
By tier, with the bench's ratio carried into the archive's units (x `to_credits` = 3.46), the patient
arm pays **0.07** of the real late price for a second-tier defender, **0.09** for a third-tier
midfielder, **0.16** and **0.14** for a first- and second-tier forward. The BASE arm is in scale with
reality (first tiers 5.20 vs 4.53 · 5.56 vs 3.07 · 5.14 vs 4.55 · 3.14 vs 8.83). So the gain is bought
at a seventh to a fifteenth of what a real table charges for the men that decide a season, and that
price exists only because nine rosters must fill their quotas while one buys nothing. **The archive
cannot refute it either** - no real manager sits out a phase, so that price has never been observed.
It is an exploitation of the table rather than a better valuation, and the decision on something the
operator would actually have to play is his.

What is established is the DIRECTION: the arm is too eager at the urn, and the division by the hands up
inside `keeps` is the reason. What would make it adoptable is a number the archive does not carry -
what a man of tier `k` costs late in his phase WHEN ONLY ONE BUYER still needs the role.

### Where the defect was NOT, and one mechanism correction (adopted, free)

**The table's money does not leave too early.** The spend curve INSIDE each phase reproduces the real
one: 30/60/86% against 33/65/85% for the keepers, 31/55/80 against 31/54/77 for the defence, 26/52/81
against 28/51/72 for the midfield, 28/65/92 against 36/65/88 for the attack. §16.1 checked the curve
over the WHOLE auction; this is the finer target and it holds.

**But the re-offer belonged to the wrong phase.** `auction` kept ONE queue, so the unsold men of all
four phases came back after the entire first pass and whoever let a department go by met it again only
once every other roster was full. The archive says a role's awards are CONTIGUOUS - 30 keepers, then
80 defenders, then 80 midfielders, then 60 forwards, which is how this session could read the role off
the award position at all. Corrected, and measured before adopting: on the declared table it moves
**nothing** (0 differences over 1000 participant-seasons) and **0 awards happen after the first pass**,
so the re-offer this cures is a corner the declared table never enters. The patience finding survives
it (+4.67%), so the loophole is not the phase boundary: it is inside the phase, and it is about who
still has a slot.
