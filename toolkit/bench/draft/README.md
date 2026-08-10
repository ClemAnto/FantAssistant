# The draft bench

What it is: a **replay of the gate's own windows as a DRAFT**, used to judge the auction assistant's advice
before the panel changes. `backtest` judges rules and `sweep` judges constants; this judges **policies** —
what to take now, in which currency, under which rationing.

It lives in the repository because a bench nobody can find is a bench that gets rebuilt slightly differently
next time (it spent its first day in a session's scratchpad, which is how this file came to exist).

## Run it

```powershell
python extract.py windows.json          # ~2 min, read-only on the DB; NOT in git (paid content)
node build.mjs                          # bundles the APP's own auction code into appcode.mjs
node multi.mjs published                # reproduces the 10/08/2026 campaign
node multi.mjs coverage                 # item 1.1: role coverage as a constraint
node multi.mjs currency                 # item 1.2: the hybrid currency
node floor.mjs                          # item 1.3: leave-one-out cross-fit of the price floor
node table.mjs [covers]                 # the ranking test, no draft and no opponents
python signal.py                        # item 2.1: which half of the prediction carries the ranking
```

`run.ps1` chains the build and a run, so nothing is measured against a stale `appcode.mjs`.

## What is measured against what

Two readings, and neither is allowed to hide the other:

* **advantage over the rivals**, paired inside the same draft, in per cent — seasons have 29–31 matchdays,
  so raw points are not comparable across windows. This is what the campaign published. Its null is weak
  on purpose: the table contains deliberately weak heads, so a positive number is partly «being like the
  better rivals».
* **gain over the baseline**, the set's first policy, per window, relative on our own points per matchday.
  This is what a candidate has to win, and it is the unit the gate's 0.5% floor was calibrated in.

Verdicts are the gate's, never new ones: **strict** = better on every window with the mean above the floor;
**robust** = a majority of windows, mean above the floor, no window below −2%.

## The files

| file | what it owns |
| --- | --- |
| `entry.ts` → `appcode.mjs` | the APP's own `needFor`, `predictRivalPick`, `startingPlaces`, … — a re-export, never a copy |
| `policies.mjs` | the heads we can sit down with: the published ones, and the candidates under test |
| `engine.mjs` | one definition of the draft, of the two metrics, and of the league setup |
| `legal.mjs` | the legal Mantra eleven (typed places, transversal matroid, exact greedy) |
| `bench.mjs` | load, measure, verdict, report — so nobody invents a second criterion |
| `multi.mjs` | the five windows, one policy set per run |
| `floor.mjs` | the leave-one-out cross-fit of a price floor |
| `table.mjs` | the clean ranking test: no draft, no opponents |
| `signal.py` | `pv_pred` against `fm_pred` against the real fantapunti, on ranks and on variance |
| `extract.py` | the windows, for any league declared in `config/league_config.json` |

A candidate policy lives in `policies.mjs` and **not** in the app until it wins a verdict. Once it does, it
moves into `app/src/app/core/` and the bench reads it from there through `appcode.mjs` — that way there is
never a second definition of what the panel does.

## Mistakes already paid for, do not repeat them

* An eleven of «the best 11» is **not legal**: the assignment is over the module's typed places.
* An uncovered place is worth **zero** and does not void the matchday (like a «senza voto» with no bench
  player of the role). The opposite error voided 37% of the matchdays and inflated every margin tenfold.
* The comparison is **paired** (me minus the mean of the rivals IN THE SAME draft) and in per cent.
* Mantra roles are passed **complete** to the matching (497 of 1014 carry 2+ codes): with the primary code
  alone the flexibility disappears and the conclusions change.
* `windows.json` is regenerated, never edited. It is not in git: names, prices and votes of paid content —
  and it is written in **explicit UTF-8**, because on Windows the default is cp1252 and the script could not
  re-read what it had written.
* **A port is verified on the NUMBERS, not on the compile.** The bench's `need` hook passes the PLAYER where
  the app's `needFor` takes the SLOT, so handing `needFor` straight to a policy makes `places.get(player)`
  undefined and the weight 1 for everybody. It compiled, it ran, and it said the surplus was the best
  currency. Reproducing the published table is what caught it — run `node multi.mjs published` after any
  change to `engine.mjs`, `legal.mjs` or the app code it reads.
