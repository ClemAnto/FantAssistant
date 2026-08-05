# FantAssistant - briefing (read first)

Monorepo for the **EuroLeghe fantacalcio prediction engine**. Two parts:

- `toolkit/` - **euroleghe-ingest** (Python/SQLite): the data pipeline that feeds the engine, with
  a **lightweight UI** (Tkinter, `python -m euroleghe_ingest gui`) as the operator panel. **Work in progress.**
  Inside it, `euroleghe_ingest/engine/` is NOT part of the pipeline: it is the **reference model + the
  out-of-sample GATE harness** (`python -m euroleghe_ingest backtest`), read-only on the DB, writing
  only reports. It stays dependency-free because the shippable engine gets ported from it.
- `app/` - **final assistant** (Electron + Angular, TypeScript) with the `prediction-engine`. **Placeholder**:
  initialized after the toolkit (see roadmap); it will be ported from `toolkit/euroleghe_ingest/engine/`.
  Its data contract already exists: `python -m euroleghe_ingest export` writes `data/export/<season>/`
  (pruned SQLite + JSON tables + `manifest.json`), and the table list is DERIVED from what
  `engine/features.py` queries - a rule that reads a new table must be added to `export.CONTRACT`.
- `config/` - shared configuration read by both the toolkit and the engine: `scoring_config.json`
  (per-CHAMPIONSHIP scoring: its `leagues` are serie_a, premier_league, ... - what a PLAYER belongs to)
  and `league_config.json`, whose `my_leagues` are the leagues the operator PLAYS IN: one entry each,
  declaring its `platform`, its `game` and how many teams and squad slots it has - which is what fixes
  the auction's REPLACEMENT LEVEL (see below). The two senses of "league" are different dimensions and
  the names must not be mixed up. A sheet is built PER LEAGUE (`snapshot --league NAME`), its manifest
  records which one, and the folder name carries it - two leagues on the same platform and game have
  different replacement levels, so a surplus quoted without its league is not comparable.
- `docs/` - manifest of the Drive documents (source of truth). `data/` - local datasets (rebuildable).

## Language convention
Chat replies to the user: **Italian**. Everything in the repo (code, comments, logs, UI strings, file names,
Markdown docs): **English**. The Google Drive documents are the user's Italian knowledge base (source of truth)
and stay in Italian.

## Reading order for a new session
The knowledge base now lives in **git** under [docs/model/](docs/model/) (Italian, source of truth; Drive
is a mirror/archive). Before any work read, in order:
[docs/model/00-BRIDGE-punto-di-ingresso.md](docs/model/00-BRIDGE-punto-di-ingresso.md) ->
`stato-progetto-continuita-v5.md` -> `todolist-mantra-euroleghe-v5.md` -> **`gate-motore-v1.md`** (the gate
protocol, every verdict and every falsified hypothesis: read it before proposing any rule) ->
**`metrica-asta-surplus-v1.md`** (what the Auction panel ranks by, and why it is not VALUE) ->
`spec-euroleghe-ingest-v9.md` -> `nota-modello-set-pieces-v2.md` -> `modello-previsionale-v3.8.md` ->
the consolidated notes in the same folder.
Drive dataset IDs (xlsx/csv, not in git) are in [docs/DRIVE-MANIFEST.md](docs/DRIVE-MANIFEST.md).

## Golden rule (gate)
No prediction rule enters the engine without winning the **pre-registered out-of-sample gate**, with its
parameters fitted on a window that does NOT judge it. Overall MAE must never get worse.

**The gate now runs on 10 windows for Serie A (Tm7 = 15/16->16/17 ... T2 = 24/25->25/26) and 5 for euro**
(the authenticated votes API turned out to serve seasons the Drive datasets never covered; EuroLeghe
21/22 is empty at the source, which costs euro two windows). T1/T2 remain named because every published
number refers to them - `features.PUBLISHED_WINDOWS` pins them - but they are also the windows the
hypotheses were GENERATED on, so passing there is the weakest possible evidence. Rules that survived two
windows and died on ten: R4 (age), R10 (new coach), R8 (off-role). Details and protocol in
[docs/model/gate-motore-v1.md](docs/model/gate-motore-v1.md).

Two verdicts are reported side by side and neither is allowed to hide the other: **strict** (improves on
every window that measures it, 0.5% floor) and **robust** (majority of windows, mean gain above the
floor, no window worse than -2%). With ten windows the strict AND rejects rules that win nine times and
tie once; where they disagree, the report says so and the decision is taken in the open.

## Toolkit principles (spec v9)
- `fc_id` (fantacalcio.it id) = **primary key**; the other sites live in `player_xref`/`club_xref`.
- Code identifiers in **English** (tables, columns, modules, variables).
- Raw files (Drive) = source of truth; the **DB is always rebuildable from scratch** (idempotent `rebuild`).
- No mandatory manual step; `manual_overrides` = optional highest-precedence overrides only.
- Volatile states (penalty takers, starters, injuries) = **dated time series** (`valid_from`), never static flags.
- `scoring_config` is **per-league parametric** (non-standard scoring changes the EV): no hard-coded +3/-3/+1.

## Data model & platform dimension (spec v9)
- **`platform`** = `euro` | `default`. `euro` = EuroLeghe (5 leagues, top clubs; Serie A is PARTIAL);
  `default` = classic Serie A (all 20 teams). They use **different matchday calendars**, so `platform`
  is part of the PK of `match_ratings`, `match_rating_bonuses` and `season_stats`. `euro` = the
  fantamedia/**target**; `default` = the **full real-league season**.
- **`gameType`** = `classic` | `mantra` = an **engine** dimension (roles + fantavoto modifiers); the base
  voto is shared, so it is NOT stored in the raw ratings. **Mantra is played on BOTH platforms**: the
  classic Serie A listone carries the whole Mantra apparatus (`RM`, `Qt.A M`, `Qt.I M`, `FVM M`) and
  `rosters.roles` holds 641-751 Serie A Mantra roles per season. An earlier claim that Mantra was
  euro-only was wrong and was switching off a real combination.
- **Prices are three pairs and only one is auction-safe.** `price_initial` (Qt.I) is the pre-auction
  quotation - the market's expectation, and the ONLY price a rule may read. `price` (Qt.A) is revised all
  season, so for a past season it embeds the outcome. `fvm` / `fvm_mantra` (fantavalore di mercato) are
  end-of-season by the same argument, and `price_mantra` / `price_initial_mantra` are the same two
  quotations in the Mantra currency. Everything but Qt.I is **reporting only**; the schema says so where
  each column lives.
- **Additive schema changes need a migration.** `CREATE TABLE IF NOT EXISTS` does nothing to an existing
  table, so a new column without an entry in `db.database.ADDED_COLUMNS` fails with "no such column" and
  the only cure would be a `rebuild` that drops everything.
- **An identity is not a season fact.** `player_xref` is written in ONE pass over every season a run reads
  (`positions._store_identities`), strongest evidence first. Written inside the per-season loop it was
  decided by whichever season happened to be processed last, and 827 `fc_id` ended up with their season
  aggregates in the table and no provider id at all - invisible to the granular roles, the heatmap AND the
  per-match layer at once, because all three join through it. Same shape as the rule below, one level up:
  ask what the natural unit of a fact is before choosing the loop that writes it.
- **A club-level fact must not pass through the identity funnel.** A per-player row needs an `fc_id`, but
  counting how many forwards a club FIELDS does not — and requiring resolved identities biases exactly the
  clubs whose fringe players are not quoted (Serie A 24/25: 233 of 774 elevens fully resolved, Juventus
  **zero**). Hence `club_match_lineups`, populated over ALL lineup entries at parse time. Found by
  measuring, not by review: if a derived table needs a complete unit, count the unit, not its members.
- **Full-season propensity**: the euro calendar is a *subset* of a player's real matches, so propensity
  (goals/assists/xG per 90) is computed over the FULL real season while the FM/Mv target stays on `euro`.
  Serie A: from `default`. Other 4 leagues: from **FBref** (facts) + **Sofascore** (rating + heatmaps),
  with a **calibrated** synthetic base-voto (fitted on the overlap, never fixed buckets) stored
  source-tagged in `external_stats`, never contaminating the `euro` target. Everything still passes the gate.
- **euro<->real matchday map is per league** (one euro round bundles a *different* real round in each of
  the 5 leagues): `matchday_map(season, euro_md, league, real_md)`. Lets the view mark which real
  matchdays are in the euro calendar vs synthetically filled.
- Ratings via the **authenticated Excel API** (login + `/api/v1/Excel/votes/...`), never the boobytrapped
  HTML. Aggregation **option A**: canonical `match_ratings` columns + lossless `match_rating_bonuses`.
  Cached Excel = raw source of truth -> `rebuild` re-ingests offline so scraped ratings survive.

## Provisional parameters, and the sweep that judges them
Some constants exist only because a module needed a number to run. They are MODEL choices, so the gate owns
them: same rule as any candidate rule, no gate no engine. The presence formulas that read them live in
**`engine/presence.py`** (dependency-free, `Params` dataclass) and NOT in the Tk view they came from -
a parameter no harness can reach is a parameter nobody can sweep. **`python -m euroleghe_ingest sweep`** is
the gate's other half (`backtest` judges rules, `sweep` judges constants): pre-registered grids, one
parameter at a time, leave-one-out cross-fit, strict and robust side by side, report in
`data/reports/sweep_presence.json`. Ran 29/07/2026 - details in `gate-motore-v1.md` §7-ter:
- **measured**: `standing_weights` = (0, 1) - who starts next season is predicted by last season's MINUTES,
  not by his start rate (strict AND robust on all ten window-platform folds).
- **confirmed**: the v9.11 shape of `contested` (measured absences, not the forecast), `ARRIVAL_DISCOUNT`
  0.80, the penalty hierarchy's decay 0.75.
- **still provisional, each with its measured reason**: `LOAN_DISCOUNT` (platform-dependent - euro pulls to
  0.2, default to 0.8), the tilt of `INJURY_WEIGHTS` (the three-season shape is confirmed, the tilt is worth
  0.3%), `AVAILABILITY_FLOOR` (the whole grid is worth 0.6%), the miss quarantine, the arrival tiers.
Two lessons the run itself taught, both worth keeping: a sweep that seems to REFUTE a constant can be how a
data defect surfaces (every Serie A penalty was counted twice, which halved the hierarchy's memory for
Italian clubs and made 0.5 look better than 0.75 - and 0.75 squared is 0.56); and "confirmed" is not
"nothing found", so the report says which of the two happened and carries the margin over the runner-up.

## Rebuilding from nothing, and the app bundle
Two commands own these, and both print a plan before doing anything:
- **`bootstrap --plan`** = the ordered acquisition on a machine that has never seen the project (15
  steps, ~17 h, resumable, refuses to start without credentials). `rebuild` stays OFFLINE by design -
  it replays the cache - so on a fresh clone it is `bootstrap` that fills the cache first. Optional and
  not on the public web: the Drive roster exports (`fetch --inbox` imports them from `data/inbox/`); the
  authenticated listone creates `players`/`clubs`/`rosters` without them.
- **`export`** = the app's bundle. `data/export/` is **gitignored**: it carries the same paid
  fantacalcio.it content the cache does, and the repo is public.
`fetch --plan` answers "what is missing here?" table by table, with the command that fills each gap.
Every run leaves a line in `ingest_runs` (module, when, status, options), written by whoever owns the
invocation - CLI, rebuild or GUI - never by the module itself.

## Three facts that are snapshots and can never be backfilled
- **Starting probability** (`probable_starter`): the site publishes only "now", so a week not captured is
  gone - and the operator's judgement, recorded 29/07/2026, is that **it is not worth a weekly cron**. The
  editors' forecast reasons from the same facts this toolkit already measures (last line-ups, injuries,
  formation habits); what it adds that we cannot compute arrives LATE, from the coach's own words, so the
  reading worth having is one taken **just before kick-off** and used at once, not a history. It also does
  not serve the toolkit's actual target: an initial auction happens in August, when the page does not exist
  yet. Consequence to state rather than treat as a gap: `starter_prob` 0/1453 on past windows is **empty by
  design**, and no auction rule is waiting for it. What this DOES require, if a pre-match reading is to be
  taken seriously: `valid_from` and the cache file are per-DAY, so two captures on the same matchday
  overwrite each other and a 20:45 kick-off would read the 15:00 state - the series needs an hour.
- **Contract expiry** (`flags.contract_until` / `exit_risk`): verified against the source - a PAST
  season's squad page does not carry the column. So `exit_risk` is usable for the auction that is
  coming and is **not gatable on T1/T2**.
- **The granular real role** (`player_roles`, source `sofascore`): the twelve codes `GK | DL DC DR |
  DM | ML MC MR | AM | LW RW | ST`, one to three per player, which is the ONLY thing that separates a
  left back from a centre back - `rosters.role_classic` calls both `D` and `positions.derived_role`
  calls both `D` too. The provider accepts a `seasonId` and **ignores** it (HTTP 200, today's codes for
  a season three years old), so it is observed by `snapshot` on the day it runs and stored dated.
  Historical instead, and unaffected: `positions.derived_role` (G/D/M/F per season, from the per-match
  layer) and `positions.avg_x/avg_y` (the season heatmap).

All three are listed in the export manifest's `known_gaps`.

## Credentials & security
fantacalcio.it credentials **only** in the local `.env` (see `.env.example`). NEVER on Drive, in chats,
in the repository, or in logs. `.env` is in `.gitignore` and `.claudeignore`.
**The GitHub repo is PUBLIC** (`origin` = github.com/ClemAnto/FantAssistant, branch `master`): every
commit publishes `docs/model/` - the model knowledge base - so treat anything committed as public.

## The quotation is a judgement, so it goes LAST
**Operator's rule, 04/08/2026: «utilizziamo la quotazione quando non abbiamo altre risorse oggettive».** A
listone price is somebody's opinion - a good one, and still an opinion - so anything the engine decides must
prefer football that was actually played. Where the project already stood: the ADOPTED sets never read a
price (R12 «market expectation» and R12b «revision» are falsified, 4/10 and 5/10, λ≈0 - «the market's
absolute expectation adds nothing to the previous fantamedia: it is built on the same history»), the
REPLACEMENT LEVEL behind every surplus reads the marginal rostered player's fantamedia plus the league's own
slots, and `stature` sits at weight zero. The one live use was the ARRIVAL TIERS - the branch that prices a
man with no measured history - and it now leads with his **FM-equivalent in the league he came from**, as a
percentile inside his role, with the quotation as the fallback (`arrivals.TIER_DRIVER`).
Measured, and the verdict is about COVERAGE rather than the choice: `measured_first` wins every held-out fold
on euro, while on Serie A the quotation gains a little on the subset it touches and stays below the 0.5% floor,
because there the measured resource is thin — for most arrivals both arms are IDENTICAL, both falling back to
the price. So the way to make the rule pay is to widen what is measured, not to go back to the quotation. And
that claim has now been tested twice on different coverage (gate §7-sexies, re-measured 05/08/2026 after the
FM-equivalent layer went from 707 to 2128 arrivals): the euro margin grew (+0.89% → **+1.00%**) and the
quotation's Serie A advantage FELL (+0.42% → **+0.32%**), which is the direction «the bottleneck is coverage»
predicts, with nobody touching a parameter. Cite those numbers from the report, never from here: this file
carries the shape of the conclusion, the gate carries its date. Two things stay irreducible and are not the same as trusting it: the listone ROLE (the game
itself scores by role - the twelve measured codes already replaced it for *where he plays*), and the ASK price
at the table, which is what a bid is made against. The FANTAVALORE (`fvm`) sits between the two - «varia ogni settimana o quando ci sono eventi particolari»,
so it is the fresher judgement and it goes ahead of Qt.I, which is set once before the season and never moves
(and it is ten times finer: a striker's Qt.I spans 1-40, his FVM 1-430). Two things it forced: it is a
VOLATILE state that was being kept as a static field, overwritten at every listone download, so it now also
lands in `fvm_history(fc_id, season, observed_on, ...)` and accumulates from today - the weekly history before
now exists nowhere we can reach, and before 2022-23 the source stores **0 and not NULL**, so `count(fvm)` read
as full coverage while the values were absent. And a parameter must be judged ON THE POPULATION IT ACTS ON:
the tier sweep was scoring every arrival, which handed the quotation a robust PASS on `default` off men whose
tier is never consulted (the core prices them from their own fantamedia); scored on the arrivals the tier
actually routes, that advantage falls below the floor and `measured_first` stands. Details: gate §7-sexies.

## Citing a fitted number
**A coefficient quoted without its platform, its residual baseline and its date is not a fact.** Audited
28/07/2026: only 5 of the 12 lambdas the knowledge base quoted could still be reproduced, and two of the
five only against the pre-two-pass baseline - one of those carried an INTERPRETATION that the corrected sign
reverses (R11, `gate-motore-v1.md` §5-septies). Drift is legitimate, data improves; presenting a number as
fixed without provenance is not. The gate report carries all three (`platform`, `generated_at`,
`notes["residual_baseline"]` per fit), so either copy them alongside the number or cite the report instead
of the number. Two conclusions also turned out to be stated in the singular about a PLATFORM-dependent
quantity, which `platform` being a first-class dimension should have prevented.

## A share of a season is a share of the CHAMPIONSHIP
**Numerator and denominator must be counted over the same competitions, and the one that matters is the
club's own league.** The season aggregate (`external_stats`) stores one row per championship and nothing
else, so every per-player numerator is league-only; the denominator used to be every eleven we parsed in
any competition - Arsenal 58, Bayern 50, Napoli 38 (Serie A alone) - which is 66%-100% of the calendar
depending on the club, so a titolarità could not be compared with the one next to it (Kane: 49% off 25
starts in 34 rounds). Fixed 29/07/2026: `clubs.csv` carries `league_XIs`, and the correlation between a
club's league share and its players' mean titolarità went from **+0.796 to −0.172**. Two corollaries worth
keeping: a count from an external source arrives in ITS units (Transfermarkt counts absences over every
competition, so they are counted as league rounds inside the union of the spells, never scaled), and
`engine_pv_pred` lives on the PLATFORM's calendar (31 euro rounds, 38 default - in the manifest), which is
not the club's. Details: spec «Novità v9.11».

## The unit is the MATCH, never the matchday
Matches get postponed, so a round can be played weeks after the one that follows it, and a date can carry
one round's fixtures plus another's catch-ups. Two consequences, both measured on 29/07/2026 rather than
assumed:
- **a (player, matchday) pair is NOT unique**: with a postponement and a transfer a man plays the same round
  for two different clubs, on two different dates. Serie A 2023-24 round 21: fc_id 49 for Udinese on
  2024-01-20 and for Torino on 2024-02-22. Dimarco, 2019-20 round 17: Inter, then Hellas Verona.
- **`match_ratings`'s primary key `(fc_id, season, matchday, platform)` cannot represent it**, so for those
  players one appearance is dropped at ingest - the votes hold 1 row where the per-match layer has 2. Zero
  such duplicates exist in the table today, which is exactly what a PK that forbids them would show, so
  "none observed" is not evidence of none happening. Rare (a handful of players per season) and now written
  down instead of invisible; the cure would be a PK carrying the match, which is a migration plus a
  re-ingest, so it is a decision and not a fix to slip in.
So anything that walks a calendar walks DATES and match ids: `club_form`'s last-ten window, `rounds_missed`,
`fielded_next` ("the first match after the auction date" is by date, and it carries the round so a catch-up
is visible). Code that groups by matchday is making a claim it cannot support.

## Comparing against the right null
**A "does the event repeat?" statistic must be compared with the RESHUFFLED sequence, never with zero.**
Found 29\07\2026 by making the mistake: a lagged autocorrelation inside a demeaned group carries a
finite-sample bias of about −1/(n−1) (−0.044 over 24 matches), so the fantavoto's "hot hand" was reported as
−0.035 = mean reversion when the reshuffled null is −0.041 and the true excess is **+0.012**, i.e. the sign
is the opposite one. Same trap in every streak question (Miller-Sanjurjo). Conditioning on something that is
NOT the lagged outcome is safe - the "worse fantavoto after a team win" result was re-tested the same way and
holds (null −0.002 vs observed −0.048). Details: `gate-motore-v1.md` §5-duodecies point 4 and
[turnover-atteso-v1.md](docs/model/turnover-atteso-v1.md) §4.

Related and already learnt: the exploitable signal in these per-match questions sits on **who plays**, not on
the voto - `Var(ln pv)` is 90% of `Var(ln` total fantapunti`)`. And a Serie A match RESULT is derivable
offline from `match_ratings` (`platform='default'`): `goals` is net of penalties AND own goals, so
goals-for = `SUM(goals) + SUM(pen_scored)` and goals-against comes from the `role='P'` rows.

## A drawn module is a real module, and a SECOND opinion must not undo a priced one
**Where a decision is already priced, do not re-derive it somewhere else.** The eleven is assigned to the
module's own places and every place is priced as a whole (`_assign`/`_slot_price`, Hungarian); `lanes_for`
then re-read each man's lane from his FIRST code and threw that away, which is how Liverpool's 4-5-1 came out
with a back THREE, five men squeezed into one half with the far touchline empty, and an attack of two
left-sided men - the fit had given Gakpo (`LW`) the five's left flank and a mediano the four's second centre,
both correctly. Same shape of defect twice more: two pricers that could disagree (`slot_cost` said a front
line's wide place belongs to a forward and `_slot_price` did not, so a wing back outbid Fiorentina's third
striker and pushed him out of the eleven - one pricer now, `_off_the_front` states the rule where the price
is decided), and a stale slot outliving the line that issued it (a `ST` kept the front three's left after the
transformation had thinned the line to two central places, and the badge read it as 'As').
The operator's rules now live in ONE transformation, five in cascade (`_reshape`): nobody plays two lines from
home; a flank is covered by a flank player and the central man dislocates to the row his most ADVANCED code
says (the defence is exempt - braccetti); **a vacated midfield wing is covered from the front** («i due
attaccanti esterni possono arretrare e coprire il centrocampo»); a place in the front line is a FORWARD's
job, and a thinned front line keeps its centre-forwards; a midfield ROW is five at most. Plus the vocabulary,
because a marker is a claim too: **flank codes come in pairs** («se c'è un Ed ci deve essere anche una Es»,
idem Ad/As, Td/Ts) and an unpaired one falls back to the line's central job; a **centre-forward is never
renamed into an ala** by a place («Krstovic e Scamacca sono Pc e basta»); and a row reaches **both touchlines
or neither**. Guarded by 394 boards (every club x every shape of its repertoire x both modes x both sheets):
0 rows over the maximum, 0 unpaired flank codes, 0 lopsided rows. Details: spec «Novità v9.17».

## Judge a drawing against somebody else's eleven
**A board has an external judge available, so use it instead of arguing.** The published typical elevens of
the same window (SOS Fanta) give, per man, the LINE somebody else draws him in - 193 comparable men over 20
clubs, plus 52 whose FLANK is stated (in those lists a line runs from the team's right to its left). The
board scores 83% of the men and 16/20 line counts, and every hypothesis about positions gets tested there
rather than adopted: the heatmap-vs-code question was settled that way (gate §5-quaterdecies) - the
measurement BEATS the code at naming a flank (97.9% vs 93.9%) and is already read where that pays (`lateral`),
while four ways of using it elsewhere are flat or negative, and any weight on the measured DEPTH costs,
because that axis saturates up front (median avg_x: full back 47, mediano 51, then winger 61, CENTRE-FORWARD
62, winger 63 - touches gather where a man receives the ball). Two corollaries worth keeping: a mean cannot
tell a two-flank winger from a central man while the cloud's three bands can (Malen 0.37/0.50/0.14 against
Pulisic 0.46/0.30/0.24, centroids -0.149 and -0.163); and what a man's PRIMARY code misses, his code LIST
usually already carries (Zé Pedro reads `DC;DR` with 75% of his touches in the right band).

## A layout claim is a measurement too
**Read the widget geometry before and after (`winfo_height` / `winfo_rooty`), and assert the invariant as a
RATIO so the test survives another display's fonts.** The panel is 5,100 lines and no test looked at geometry,
which is how a **status bar collapsed to 1x1 px** survived from the day it was written: created, filled and
updated on every run, and invisible - the packer hands out `root`'s cavity in packing order, so an expanding
widget packed before it leaves nothing behind. Measured on the Snapshot board 29/07/2026: the pitch went from
388 to **493px at the same window size** not by shrinking one thing but because the app header, the tab strip
and the club card were each sized as if it were the only one - and the club card said the shape the `modulo`
selector and the pitch caption already said. Two more of the same shape: **276px of the squad table's columns
were not narrow, they were ABSENT** (Tk clips what does not fit and offers no way to reach it - hence the
horizontal scrollbar, shown only when `xview` says it is needed), and the forward's plate was drawn ON TOP of
the pitch caption (fixed by reserving `CAPTION_BAND_PX`, which also bought the plates a second named rival).
Guarded by `test_the_panel_spends_its_height_on_the_board_and_not_on_its_own_chrome`. Details: spec «Novità
v9.15».

## Drawing an eleven: the claim picks WHO, the fit only WHERE
**Two questions, two numbers, and mixing them is the defect that came back three times.** `claim` (standing:
who starts when everyone is fit) selects the men, line by line; the FIT decides only which place each of them
takes, and it is solved as ONE assignment over the shape's own places (`gui._matching`, a Hungarian written in
house) because a greedy pass has to fix a priority between the flank and the line and **both orders are wrong
on the same eleven** - flank first draws a mediano as a winger, line first sends the centre-forward to the
trequarti. The price of a place is the distance on the grid the twelve codes already live on
(`REAL_ROLE_DEPTH` x 20, one full line = 7) plus the side weighted **per line** (`SIDE_WEIGHT`: 8 on D/M
where the flank IS a role, 3 on T/A where the three forwards interchange). A single side weight does not
exist - it was tried, and every value broke one case to fix another.
Around it: `_settle` repairs only in PARETO terms (never a worse fit, and at equal fit only for
`CLAIM_MARGIN` = 0.05 of claim, because two moves worth +0.01 emptied an attack), and `_reshape` changes a
line only when FORCED - the defence exempt, since braccetti are centre backs by trade. And when tuning one
number starts fixing one club while breaking another, the answer is a wrong MODEL, not a wrong value: revert
and write it down (`docs/model/spec-euroleghe-ingest-v9.md` «Novità v9.16»).

## Every player must have a number, and the number must say what it is worth
**Operator's rule, 05/08/2026: «ogni calciatore DEVE avere il suo SURPLUS altrimenti è impossibile valutarli
oggettivamente ... penalizziamo il SURPLUS (l'indeterminazione è comunque una nota negativa) ma dobbiamo cmq
avere un valore di riferimento».** A blank is still a statement (below), but a blank cannot be COMPARED, and
an auction is nothing but comparison. So the sheet carries a fourth class of column beside `engine_*` (gated),
`desc_*` (measured) and `actual_*` (after the fact): **`est_*`**, the fallback valuation — `engine/estimate.py`,
a declared cascade where every rung carries the measurement that put it there (the other platform's same
season: mean difference **+0.001**, 92% within 0.3 over 870 player-seasons · an older season: MAE 0.396 at t-2
against 0.368 at t-1 · a thin season blended with the club's own level for that role, whose measured spread is
1.36 of fantamedia between the best and worst Serie A club's forwards and 0.25 between their keepers). Three
rules hold it together: the estimate uses **the same arithmetic** as `engine_surplus` times a confidence, so
one column ranks the whole sheet (weighting one side only moved Hojlund 28.4 → 24.6 with nothing about him
changed); the penalty multiplies the **surplus** and never the fantamedia, because indeterminacy is a fact
about the number, not about the player; and every estimated row says its basis, its penalty and its reason in
words (`est_basis` / `est_confidence` / `est_note`, and a `~` in the panel with the note on the tooltip).
`engine_*` does not move a decimal — `backtest --verify` stays 22/22 — and the foreign FM-equivalent is
deliberately NOT a rung, because R1 measured it as worse than the role anchor on five windows of six. And when
a fallback needs a number nobody measured, MEASURE it rather than choose it: "half a calendar" for an unknown
man made an unknown keeper outrank his club's third keeper, while the data says 0.289 of the calendar for a man
with no previous season and 0.421 for one with a thin one — the thin man plays more, and the ordering should
come from that.

## An empty cell is a statement, and a football prior is a hypothesis
Two habits this project keeps, both paid for:
- **Say why a number is missing.** A blank SURPLUS is not a zero: below `MIN_PV_PREV` = 15 votes the core
  refuses to predict, and on `default` there is no R0c to fall back on - 253 rows out of 598 on that sheet.
  The manifest and the column's tooltip carry the reason, so nobody reads the gap as a valuation.
- **Measure a football belief before coding it.** «Coaches field the tall physical striker» - measured over 92
  club-seasons, the more used of two strikers is the taller one **48%** of the time, a coin, so height and
  weight are shown and select nobody (gate §5-terdecies). The preferred foot survived the same test and IS
  used, but only as a tie-break inside a line: DL 96% left-footed and DR 96% right, while wingers are
  INVERTED (LW 86% right-footed) - which is why one rule for both lines would have been backwards.

## A fitted transform belongs to the population it was fitted on
**Where a number may be applied is a claim about calibration, and it must be read from the data — never from a
tag and never from a hand-written list.** `synth` fits its line on the OVERLAP (provider rating + real vote for
the same match), and it was applied to every row carrying `source='sofascore'`: two different statements, and
the second was false for 4784 rows — 3756 of **Serie B**, 570 Championship, 458 Coppa Italia got a synthetic
vote from a line that never saw their competition, while ten **Bundesliga** matches recovered by another module
were left out because of the same tag. Eligibility is now the COMPETITION's (`synth.calibrated_competitions`,
derived from the overlap itself): 241,913 matches of 250,678 convert, the rest stay NULL. Two corollaries the
same day paid for: **a per-competition offset can be real and still not be worth applying** — the Serie B shift
is −0.181 and cuts leave-one-out error 20% against the naked line, and it loses to the role ANCHOR, so nothing
converts (`APPLY_OFFSETS = False`, gate §7-nonies); and **a chain that feeds a chain must be re-run as a
chain** — `mv_synth` was stale, so the arrivals layer had been working on a third of its input (707 arrivals
with an FM-equivalent, 2045 after).

Two more of the same family, both from the same session:
- **A rule that selects a population has ONE definition, read from both sides.** The panel's ⧖ mark and the
  module's fetch queue are the same question (`recent_form.awaiting_data`, one function whose `measured`
  parameter says which side is asking). Two copies would be two populations, and the mark would stop meaning
  "this is what is being fetched" — including the case that matters, a man whose window was already fetched
  ELSEWHERE, whom a second definition would keep marking as waiting.
- **A parameter is never adopted at the edge of its grid.** The conditional-investment channel passes robust on
  Serie A (+0.79%, 5 folds of 6) and stays at zero because every fold picks 0.5 out of 0.5: the curve was never
  evaluated beyond. Widening the grid after seeing the curve is the other way of fitting — it goes in the
  pre-registered follow-up, not in the same run.

## Conventions
The knowledge base lives in git under [docs/model/](docs/model/) (canonical; git handles versioning);
Drive is a mirror/archive, updated ONLY on the user's explicit request. When the user says **`chiudi`**,
consolidate all `docs/model/` docs (and this file if conventions changed) with the current
state/decisions/commits/next steps, then commit — so a new chat resumes with no lost context.
