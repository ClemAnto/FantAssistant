# FantAssistant - briefing (read first)

Monorepo for the **EuroLeghe fantacalcio prediction engine**. Two parts:

- `toolkit/` - **euroleghe-ingest** (Python/SQLite): the data pipeline that feeds the engine, with
  a **lightweight UI** (Tkinter, `python -m euroleghe_ingest gui`) as the operator panel. **Work in progress.**
  Inside it, `euroleghe_ingest/engine/` is NOT part of the pipeline: it is the **reference model + the
  out-of-sample GATE harness** (`python -m euroleghe_ingest backtest`), read-only on the DB, writing
  only reports. It stays dependency-free because the shippable engine gets ported from it.
- `app/` - **final assistant** (Angular 22 + ng-zorro + Tailwind v4; Electron shell still to come) with
  the `prediction-engine` still to be ported from `toolkit/euroleghe_ingest/engine/`. **Initialized
  09/08/2026 and PUBLISHED**: https://clemanto.github.io/FantAssistant/ - the consultation page reads the
  bundle, never the DB and never the web.
  Its data contract already exists: `python -m euroleghe_ingest export` writes `data/export/<season>/`
  (pruned SQLite + JSON tables + `manifest.json`), and the table list is DERIVED from what
  `engine/features.py` queries - a rule that reads a new table must be added to `export.CONTRACT`.
  Its **working conventions are already written too**: [app/CLAUDE.md](app/CLAUDE.md) (Angular standalone +
  signals + `inject()`, ng-zorro components, Tailwind v4 token system with explicit cascade layers,
  `views/`-`ui/`-`core/`, CSS-only motion, measured verification) - imported 09/08/2026 from the operator's
  Jingle Machine project, where they were paid for on a working app. Read it before writing the first
  TypeScript file, not after.
- `config/` - shared configuration read by both the toolkit and the engine: `scoring_config.json`
  (per-CHAMPIONSHIP scoring: its `leagues` are serie_a, premier_league, ... - what a PLAYER belongs to)
  and `league_config.json`, whose `my_leagues` are the leagues the operator PLAYS IN: one entry each,
  declaring its `platform`, its `game` and how many teams and squad slots it has - which is what fixes
  the auction's REPLACEMENT LEVEL (see below). The two senses of "league" are different dimensions and
  the names must not be mixed up. A sheet is built PER LEAGUE (`snapshot --league NAME`), its manifest
  records which one, and the folder name carries it - two leagues on the same platform and game have
  different replacement levels, so a surplus quoted without its league is not comparable.
  Beside them live the two RULEBOOKS, which are read and never fitted: `mantra_modules.json` (typed places,
  hybrid places, the substitution matrix) and **`classic_modules.json`** (10/08/2026, from the public
  private-leagues regulation: 3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2, 5-4-1, transcription checked - every
  module sums to ten outfield places and its three lines reproduce its own name). **Classic legality is per
  MACRO-ROLE and must not be deduced from Mantra by analogy** (the operator's warning, same day): there are no
  typed places and no choice of roles there, so a classic eleven is legal if the COUNTS match and none of the
  matroid machinery applies. The emergency shapes (3-6-1, 6-3-1) are recorded and switched OFF: they are
  optional per league, and leaving them out can only make a squad's cover look worse than it is.
  A third, optional file lives here for the same reason those two do - it is DECLARED by the operator
  rather than measured by us: **`board_rulings.json`**, his per-(season, club) ruling on which module a
  board draws (`{season: {club: {shape, decided_on}}}`, written from the panel's shape selector).
  Highest precedence for the DRAWN board and nothing else; the two judges load with
  `apply_rulings=False`, because a ruling is often made looking at the judge and a judge must never
  score the operator's own answers. See «A judgement the model cannot reach» below.
  **A fourth file joined it on 11/08/2026 for the same reason and with the same standing**:
  `player_notes.json`, `{season: {fc_id: {kind, note, decided_on}}}`, where `kind` is `out_of_squad` |
  `dispute` | `wants_out` — who is out of the squad, who has fallen out with his club, who has asked to
  leave. Nothing in this project observes a quarrel: `flags.exit_risk` is a CONTRACT expiring, a
  transfer is a move that has happened and a missing squad row is evidence of a departure, so reading
  any of the three as a dispute would be inventing a fact from a different one. REPORTING only — it
  draws an icon beside a name in the app and no engine path reads it — it travels in the bundle's
  `config/` (`export` copies it, `data:pull` pulls it), and it is joined by `fc_id`, never by a name.
  **A fifth one, 17/08/2026: `international_cups.json`** — the continental cups played INSIDE a league
  season (window, host, the qualified field, the source and the day it was read) and which country belongs
  to which confederation, plus `exceptions`: the per-`fc_id` declaration that a man plays for somebody
  other than his passport (Dahoud reads Syria and has played for Germany, and nothing in this project
  observes a national-team choice). Declared like the two rulebooks, because it is a published calendar
  read and never fitted; what is MEASURED is what one of those windows COSTS, and that lives in
  `engine/cups.py` where a harness can reach it. It deliberately does NOT travel in the bundle — the
  sheet's own `desc_cup*` columns already carry the tournament, its dates and the penalty, and a second
  copy would be a second source for one fact. See «A mid-season continental cup» below.
- `docs/` - manifest of the Drive documents (source of truth). `data/` - local datasets (rebuildable).

## Language convention
Chat replies to the user: **Italian**. Everything in the repo (code, comments, logs, UI strings, file names,
Markdown docs): **English**. The Google Drive documents are the user's Italian knowledge base (source of truth)
and stay in Italian.
**One exception, decided 09/08/2026: the UI strings of `app/` are ITALIAN** - the auction assistant is used
at an Italian table, by the operator. Code, comments, logs, identifiers and the Markdown docs of `app/` stay
English, and the toolkit's Tkinter panel is NOT covered: its strings stay English. See
[app/CLAUDE.md](app/CLAUDE.md).

## Reading order for a new session
The knowledge base now lives in **git** under [docs/model/](docs/model/) (Italian, source of truth; Drive
is a mirror/archive). Before any work read, in order:
[docs/model/00-BRIDGE-punto-di-ingresso.md](docs/model/00-BRIDGE-punto-di-ingresso.md) ->
`stato-progetto-continuita-v5.md` -> `todolist-mantra-euroleghe-v5.md` -> **`gate-motore-v1.md`** (the gate
protocol, every verdict and every falsified hypothesis: read it before proposing any rule) ->
**`metrica-asta-surplus-v1.md`** (what the Auction panel ranks by, and why it is not VALUE) ->
**`assistente-asta-v1.md`** (what the assistant does with it at the table: three questions, three
numbers, and the UI rules that are requirements) -> **`letture-app-v1.md`** (the app's five 0-99
columns: reporting, ungated, every threshold measured — and the alternatives that were refused, with
their numbers) -> **`todolist-draft-v1.md`** (the DRAFT improvement
plan born from the 10/08/2026 five-window strategy campaign, ordered by measured yield; its standing
results: role coverage beats the currency tenfold, the surplus is the wrong draft currency, playing
for first pick is ruinous) -> `spec-euroleghe-ingest-v9.md` -> `nota-modello-set-pieces-v2.md` -> `modello-previsionale-v3.8.md` ->
the consolidated notes in the same folder. For BOARD work (typical elevens): `formazioni-tipo-v1.md`
(how the board is decided — shape, claim, fit, with every constant) and `todolist-formazioni-tipo-v1.md`
(the improvement plan born from the 08/08/2026 press comparison, ordered by measured yield; its standing
rule: the press is a JUDGE, never an input of the claim).
Drive dataset IDs (xlsx/csv, not in git) are in [docs/DRIVE-MANIFEST.md](docs/DRIVE-MANIFEST.md).
The BOARD list `todolist-formazioni-tipo-v1.md` is **closed** (08/08/2026): five adoptions, six measured
refusals, and the standing rule that the press is a JUDGE and never an input. What remains is
maintenance — re-measure the two judges when a new reference arrives, and the next items are born there.

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
every window that measures it, with the 0.5% floor on the MEAN since 06/08/2026 - on each window it was a
demand for amplitude per sample, and it was rejecting three rules the engine actually runs) and **robust**
(majority of windows, mean gain above the floor, no window worse than -2%). With ten windows the strict AND
rejects rules that win nine times and tie once; where they disagree, the report says so and the decision is
taken in the open - and on 06/08/2026 it was taken for the first time: **R19 is adopted on `default` on the
robust verdict alone** (9 of 10 windows improve, mean +1.7%, auction lists longer), and NOT on euro, where it
is against on all five. An adoption without `passes` is more fragile than one with it: if the next gate finds
it worse, it comes out without argument.
**The gate binds the DELIVERABLE, not just the error** (06/08/2026). It always checked how many of the right
names a rule keeps in the auction lists; it now also checks what those lists are WORTH (`captured_not_harmed`,
the same aggregate 2% as the names guard, reading `auction_view`'s own `captured_value`). This closes the gap
R3d exposed and the project had recorded rather than fixed - a rule could pass on error and make the lists
poorer. The reason it stayed open was that widening `passes` might unseat something already adopted: measured
before switching it on, **0 verdicts of 120 change** and every adopted rule still passes. The fear was worth
having and worth checking; checking it cost one gate run.

**A contaminated verdict can still have a clean corner, and it is worth looking for.** R18 was adopted on
`euro` on 06/08/2026 not despite the contamination but around it: **euro/mantra passed under the OLD criteria
and without the goalkeepers**, i.e. before both things I touched after seeing the rule fail. That corner
depends on nothing I changed. euro/classic passes only under the new criteria - concordant, so it counts as
confirmation and not as proof - and `default` fails under every version. When you have tainted a judgement,
do not argue it away: find the part of the evidence that predates the taint, and if there is none, say so.

**And a criterion is never widened because a rule failed it.** That mistake was made once, on 06/08/2026, and
is recorded rather than buried: FM/VALUE were read per window and R18 died on +0.24% on one of five - the
criterion WAS miscalibrated (the unit, not the tolerance), but it was looked at because R18 fell on it, and
with it fixed R18 passes one combination more. The fix stands on evidence that does not depend on R18; R18's
own verdict does not, and cannot be used to adopt it.

## Toolkit principles (spec v9)
- `fc_id` (fantacalcio.it id) = **primary key**; the other sites live in `player_xref`/`club_xref`.
- Code identifiers in **English** (tables, columns, modules, variables).
- Raw files (Drive) = source of truth; the **DB is always rebuildable from scratch** (idempotent `rebuild`).
- No mandatory manual step; `manual_overrides` = optional highest-precedence overrides only.
- Volatile states (penalty takers, starters, injuries) = **dated time series** (`valid_from`), never static flags.
- `scoring_config` is **per-league parametric** (non-standard scoring changes the EV): no hard-coded +3/-3/+1.

## Data model & platform dimension (spec v9)
- **A championship a promoted club comes UP from is not a championship in scope, and is still a
  championship** (08/08/2026). `config.FEEDER_LEAGUES` (today `serie_b`) and `config.CHAMPIONSHIPS` =
  the five plus the feeders, which is the right filter wherever the question is «is this a league
  match?» — i.e. every DENOMINATOR of a share of a season. Without it a Frosinone man's starts were
  divided by the 24 elevens we happened to parse instead of Serie B's 38 rounds, the same defect as
  Kane's 49% on the clubs least able to absorb it, and his starts and minutes were MISSING rather than
  measured (claim 0.07-0.43, 4/11 against the press → 10/11 once acquired). A bare run never touches a
  feeder; `--league serie_b --layer season` does. Two rules travel with it: **for a feeder the identity
  pool is the NEXT season's roster**, which is not a shortcut but what a feeder IS (nobody is in a
  listone WHILE he plays there — he is quoted the summer his club comes up); and **do not derive the
  aggregate from the per-match layer you already have** — for 2025-26 that was 97 Serie B matches of
  380, a median of 14 per player against 31, so a derived aggregate would say «he played a third of the
  season» about a man who played it all, and halving a denominator is worse than leaving it empty.
  What it is WORTH scales with how new the promoted squad is to the arriving championship: quoted men
  with 5+ Serie A starts in their career were 79% at Cremonese 2025-26 against **16%** at Frosinone
  2026-27, and the acquisition paid six men of eleven only in the second case.
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
  season, so for a past season it embeds the outcome. `fvm` / `fvm_mantra` (fantavalore di mercato) fall by
  the same argument - **not because they are "end-of-season" numbers, which was a wrong description
  corrected by the operator 08/08/2026: the FVM moves at every salient event**, so what we hold for a past
  season is the LAST READ of that listone, taken after the season and knowing its outcome. And it is a
  PRICE, not an opinion in arbitrary units: the scale is calibrated on a reference auction (max 500, «10
  squadre con 1000 di budget»), verified rather than believed - the complete 2025-26 Serie A listone's top
  10x25 by FVM sum to 10,323, i.e. 1,032 credits a team. That is what makes a conversion INTO credits a
  budget question (SpM, below). `price_mantra` / `price_initial_mantra` are the same two quotations in the
  Mantra currency. Everything but Qt.I is **reporting only**; the schema says so where each column lives.
- **...and a quotation is a fact about a PLATFORM: `listone_quotes`** (07/08/2026). `rosters` has PK
  `(fc_id, season)` and holds ONE pair, while the two listoni are two different games: on the ~249 Italians
  quoted in both they disagree on **202 Qt.I and 226 FVM** (Svilar 18/65 on the Serie A listone against
  15/56 on the EuroLeghe one), so the LAST read decided what BOTH sheets showed - including the ask price a
  bid is made against. Cured the way `match_ratings` and `season_stats` already were, `platform` in the key:
  a table of its own (`rosters` keeps the last read because everything joins it, and its comment says the
  columns cannot be decided on), `fvm_history` and **`arrivals`** widened too - a tier is a percentile
  INSIDE a listone, and 82 arrivals of 330 sit in a different band on the two platforms. Backfilled for the
  whole history offline (`ratings --quotes-from-cache`, 16,375 rows over 12 Serie A and 9 EuroLeghe
  seasons): the cache holds one file per platform and season, so unlike the three snapshot facts this one
  CAN be attributed backwards. Two things worth keeping: the pool of a percentile is part of the
  measurement - pooling the two lists ranked an Italian forward against quotations reaching 49 where his own
  list stops at 28, and the distributions are not proportional (defenders are the other way round, 28
  against 20) - and where a fallback would look harmless («no quote on this platform? take the roster
  row»), it is the defect itself, so a man his own listone never quoted has NO price here.
- **The sheet's PERIMETER is the TARGET listone, never last season's ratings** (08/08/2026,
  `SHEET_REVISION` 10). `perimeter_clubs` («who you can actually buy from») read `match_ratings` for
  (input, target); in August the target has no ratings, so every preseason sheet was filtered on the
  season that ENDED: the 2026-27 Serie A sheet silently dropped all **74 quoted players of the promoted
  Frosinone, Monza and Venezia** while keeping 94 unpurchasable rows of the relegated — and the euro
  sheet was still on last year's EuroLeghe selection (35 → 37 clubs). Found at the FIRST comparison of
  the boards with the press's typical formations, which is the kind of external judge that surfaces an
  absence no internal test asks about. The listone knows a promotion before a ball is kicked; a
  purchasable contingent fields at least an eleven (`PERIMETER_SQUAD_MIN` = 11), or one stray last-read
  roster row (Gutierrez, still quoted 8.0, filed at Bayer Leverkusen) smuggles a foreign club in.
- **Additive schema changes need a migration.** `CREATE TABLE IF NOT EXISTS` does nothing to an existing
  table, so a new column without an entry in `db.database.ADDED_COLUMNS` fails with "no such column" and
  the only cure would be a `rebuild` that drops everything.
- **An identity says which man a season fact belongs to; a season fact does not say who the man is**
  (08/08/2026). The three name pools of the identity funnel are built from the SEASON'S roster while the
  listone's perimeter changes every summer, so a man bought into the perimeter this year is in no pool of
  the year he actually played: **59 men of the 2026-27 listone had NO input-season aggregate at all**
  while their provider id was already in `player_xref` (Doekhi, Geubbels — both started by the press),
  and `external_stats` went from 11,732 to 16,970 rows once a `known` pass attributed them. That pass is
  the WEAKEST evidence and never decides an identity — counting it would make every mapping re-confirm
  itself and no stale one could ever be dropped — and a claim whose identity the run did not
  re-establish is dropped before writing, or two runs over one cache give two different databases.
  **And who established a mapping decides who may retract it**: `player_xref.resolved_by`, because three
  modules write identities on three kinds of evidence (`positions` matches names, `recent_form` pays
  provider searches, `injuries` reads squad pages) and only one deletes — without the author on the row
  it was dropping 20 ids another module had paid for over the network. Rows predating the column are
  `unknown` and nobody retracts those.
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
- **An entity joins through its CANONICAL KEY, never through the string a source uses to name it.**
  `club_key`/`CLUB_ALIASES` (`matching.py`) for clubs, `fc_id`/`player_xref` for people. Third instance of the
  same shape, and the cheapest to get wrong because a name join *works* on most rows: an ad-hoc measurement
  joined opponents by name and silently lost **AC Milan, AS Roma, SSC Napoli** (`clubs.canonical_name` says
  `Milan`) — i.e. it dropped the three STRONGEST teams from every club's schedule, unevenly. What survived a
  16/20 join were the aggregate ratios; what did not were the per-club rankings, which changed names entirely.
  Lesson beyond the join: in a partial measurement trust an order of magnitude, never a league table.
  **And one level deeper, found and fixed 05/08/2026: the canonical key is only as good as the IDENTITY
  behind it.** `fc_club_id` is not fantacalcio's id, it is a surrogate `rosters._get_or_create_club` minted
  whenever the exact STRING was new — so `clubs` held two rows for one club (Newcastle 12/60, Eintracht 22/59,
  Paris Saint Germain 4/37) with the listone's seasons on one twin and the provider's `club_xref` on the
  other. `club_key` cannot cure it: it reconciles `AC Milan`/`Milan` and PSG's hyphen, never
  `Newcastle`/`Newcastle United`. What it switched off was one club-level channel at a time — Eintracht with
  ZERO coach spells, the live squad dark on two clubs, `penalty_hierarchy` split 19/20 and 20/14, the same
  halving that once made a decay of 0.5 look better than 0.75. Cured by `matching.club_identity` (route
  through `CLUB_ALIASES`, which already knew) plus `db.database.merge_twin_clubs`, derived from the data and
  not from a list of names, survivor = the id with the most recent roster season: 109 → 106 clubs, four
  duplicate `club_elo` rows dropped and counted, Eintracht from 0 to 70 coach spells. Two corollaries: a
  merge that quietly eats history is worse than the split it cures, so the migration REPORTS what collided;
  and a name that stops being a `clubs` row does not stop being what a source SAID (`Eintracht Francoforte`
  is still in 1210 `match_ratings.team` rows), so `club_index` indexes the alias keys too — otherwise the
  cure trades three split clubs for three unreadable spellings.
  **Fourth instance, 08/08/2026, and the cheapest to have avoided.** `coach_repertoire` joined
  `club_match_lineups.club` — the string the parser wrote, `AC Milan`, `RB Leipzig`, `SSC Napoli` — to
  `clubs.canonical_name` with `=`: **13,830 complete elevens of 24,042** sit under a string that is not a
  canonical name. It cost the coaches' repertoires where the channel decides — Gattuso came back with **2**
  elevens and has **79**, Tedesco 3 of 28, Spalletti 31 of 107, and Simeone, Flick, Kompany, Pellegrini,
  Hütter, Genesio, Mourinho read zero or one against full careers — so three coaches sat under
  `COACH_SHAPE_MIN` while their real sample was far above it, and the board drew the PREDECESSOR's shape at
  exactly the clubs `coach_shapes` exists for (euro: 3 boards of 35 move once resolved; Serie A: 0 of 20).
  The enclosing function was already holding the resolver (`lineup_spellings`) for the club's own shapes.
  Two things travel with it: a claim like «Iraola has zero elevens because his career is outside our five
  leagues» was the join and not the career (Bournemouth is in the Premier: 115), so **a defect explains
  itself with a plausible story if you let it**; and the threshold calibrated on the broken samples
  (`COACH_SHAPE_MIN`/`FULL`) is now quoting numbers nobody has re-measured, which is stated rather than
  quietly kept.
- **Drive the REAL panel, not a harness that builds a different population** (08/08/2026, and it hid two
  adopted parameters). `SnapshotView.rows` is assigned in `_show_club` and holds ONE CLUB's squad, while the
  five population statistics that read it - the shrinkage prior and the four z-scores - all say «this sheet»
  in their own docstrings. Every test built a view with `rows` = the whole sheet, so the harness was right
  and the panel was wrong, and nothing could see it: Milan's keeper read **99%** of claim on screen against
  85% everywhere else, `level_z`/`level_gap_z` were standardised over a handful of one club's movers (sd
  near zero, so often None), and the board drew the predecessor's 3-5-2 instead of Amorim's 3-4-3 because
  the shape odds are built on those claims. Worse, the caches were never invalidated at all, so the FIRST
  club opened in a session fixed the means for every club after it. One accessor now (`population()`), and
  the caches are cleared with the sheet. The lesson is the general one: when the operator says «I don't see
  it», photograph HIS window before re-explaining the code - the divergence between panel and harness is
  invisible from either side alone.
- **Verify the FUNCTION, not the column that looks like it** (08/08/2026, twice in two days). «8 clubs of 20
  are drawn with the predecessor's module» was measured on the sheet's `formation_typical` column while the
  board draws `board_shape`, which had been blending `coach_shapes` for three days — three of the eight were
  already right, and the audit named a function (`_shape_for`) that does not exist. Same shape as the claim
  that a man «is simply not a starter», measured on a `claim` computed against the wrong calendar. Both cost
  an afternoon and both would have been caught by calling the function once.
  **Third instance, and it is the one that proves writing the rule down is not enough: it was committed by
  whoever had just rewritten it** (08/08/2026, night). An audit of «which arrivals does the adopted level
  channel reach?» was run on `desc_level_gap` — **a column that does not exist**: `level_gap_z` is
  COMPUTED by the panel from `desc_level_elo` minus the club's Elo, and `row.get()` on a missing name
  returns None for every row. Conclusion drawn: «100% blind on a channel adopted the day before», which
  would have been a grave defect. Truth, once the function was called: 67 of 158 arrivals carry it, 55 of
  the 81 among the errors. The corollary is procedural, not mnemonic: **an audit that reports a suspicious
  ZERO must call the function before it reports anything at all** — a uniform None is far more often a
  wrong key than a real hole. The same night produced the mirror error, applying `level_gap` outside its
  measured population (transfers) to a PROMOTED squad, which penalised eleven men for a step none of them
  took: Frosinone from MATCH to DIFF, drawn 3-3-1-3. Both were caught by the two judges within minutes,
  which is the argument for having them.
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

## FOUR harnesses, and the fourth exists because the gate is BLIND to the question
**17/08/2026.** `backtest` judges RULES, `sweep` judges CONSTANTS, `bench/draft` judges POLICIES - and
**`zeros`** judges the ZERO, because none of the other three can. The gate prepares its windows WITHOUT a
league (`features.prepare(league=None)`), so `data.replacement` is empty and `auction_view` ranks by VALUE =
FM x Pv: the choice of replacement level does not enter one published number, and `backtest --verify` would
stay 22/22 whatever zero were adopted. It does not touch ACCURACY either - the fm and pv predictions are the
same and the zero enters afterwards. So the pre-registration that said «ten windows of gate» had a false
premise, found before the run and corrected in the open (gate §7-sextricies).
What CAN be measured is the DELIVERABLE, the same metre `estimates` uses: the same list twice, changing only
the zero. Verdict: the FIELDED zero is worse on **15 of 15** windows (Serie A −18,5 points of efficiency,
euro −51,2; the right names 171→154 and 193→163), so the roster-marginal stays.
**And the harness's own first run was the lesson**: it read −66% on ten windows of ten and was measuring
nothing, because a surplus counted from a higher zero is smaller BY CONSTRUCTION - two numbers in two units.
The comparable figure is a QUOTA (how much of the perfect list, scored with the SAME zero, the predicted one
captured) plus the names, which never had a unit. Same family as «the unit of a subtraction is part of the
subtraction», applied to ourselves; a test now protects it.

## An empty CACHE file must mean «the source said nothing», never «the source did not answer»
**17/08/2026, and it cost 91 cache files of 93.** `fetch_extra_matches` writes an empty marker when a club
has no non-league match in the window - a FACT worth saving, or every re-run pays for it again. But the
marker was written on ANY failed download, and when Sofascore went back to 403 `challenge` mid-run (the
second time after a 93-club sweep, exactly as on 16/08) the run overwrote 91 files that held good payloads
with «zero events», in one hour. It is «vuoto = ignoto, mai zero» applied to the CACHE, which this project
had already written down three times for columns.
What survived and what did not, stated rather than hoped: the **11,516 extra rows are still in the DB** (an
extra file deletes nothing on reingest), and what was lost is the RAW SOURCE that `rebuild` replays - so
until the provider reopens, a rebuild would not reconstruct them. The cure is in `download_extra`, which now
returns an empty PAYLOAD when the source answered with nothing and `None` when it did not answer at all, and
the run stops after five refusals in a row instead of grinding 93 clubs against a closed door.
Two habits: **a marker that records an absence must know WHO said the absence**; and **a long sweep that
starts getting refused is a sweep to abandon**, because continuing does not reopen the source and can damage
what is already on disk.

## A flag the parser accepts and the dispatcher drops is worse than a flag that does not exist
**17/08/2026, and it is the SECOND time in this dispatcher** (the first was `--tournament`, spec «Novità
v9.39»). A four-hour acquisition was launched as `positions --layer extra --days 1100 --refresh` to reach
three seasons of European ties; the CLI parsed `--days` and never passed it, so the run used the default
150-day window and brought **797 events over 93 clubs** (median 8 per club, two seasons) instead of the
thousands intended - with `uefa-champions-league` 2024-25 sitting at **21 rows** and nothing reporting
anything. A missing flag errors; a dropped one produces a wrong run that looks like a right one. Found by
opening the cache files because a count would not grow, not by reading the code.
The cure is a test that reads the DISPATCHER'S SOURCE and requires every declared option to appear in its
command's call - deliberately crude (an `args.days` written and unused would pass) because it catches exactly
the defect that has now cost two runs.

## A source that hides its table may not be hiding it at all
**17/08/2026, and the way it was found matters more than the endpoint.** Transfermarkt's «detailed
performance» page answers 200 and does not carry the table; it had been chased through the HTML for weeks (four
hand-tried forms, 4 of 6 guesses 404) and written down as «a consent wall, data only after». Driving a headless
browser and RECORDING the calls the page makes - which the todolist itself prescribed - showed the data is not
in that page at all: it comes from a different HOST nobody had tried, `tmapi.transfermarkt.technology`, which
serves clean JSON with **no consent wall**. There was nothing to get around; there was something to look at.
What it buys (`performance` -> `tm_appearances`, one row per player-match): the competition of every match, the
MINUTES, the participation state, and `isNationalGame`. On one quoted player: 238 matches over five seasons, 44
of them for his national team. So «minutes per competition» and «minutes for the national team» were one call,
and they were two separate todolist items. It lives in a table of its OWN and not in `external_match_stats`,
because there the competition is one of our own keys and `mv_synth` is calibrated over that population -
mixing them would be §7-nonies again.
Two habits travel with it: **a long acquisition must survive a lock** (this run and the cups run write the
same SQLite, and the second holds the write lock through its reparse for longer than `busy_timeout` - an hour
of downloads died on `database is locked`, so the write now retries with a growing wait); and **a cache over a
growing series has its expiry in the caller's hands**, like the market curve.
**...and that cure was written where only one caller could reach it, which cost the same failure twice**
(19/08/2026): `performance.store` grew a PRIVATE retry, so when `snapshot.derive_squads` met the same lock two
days later - a `timepack --all --refresh` dead after 8 minutes and three packs, on the FIRST write of a phase
that had already done a minute of work - there was nothing to protect it. One definition now,
`db.database.retry_on_lock` (1, 2, 4, 8, 16 seconds, each one PRINTED, a non-lock `OperationalError` raised at
once because retrying a real defect turns a bug into a hang), read by both callers and reachable by every
other writer; a test asserts that `store` does not keep a copy. Proven on the real function under a real
6-second lock: three waits and the phase finishes, 7658 rows written where before it died.
**Two sessions on one repository is now the normal case, and git alone does not cover it.** A worktree per
session cures the WORKING TREE - separate branches, no `git add -A` sweeping up somebody's half-finished
work, no two sessions writing the same file blind (it happened: 414 lines of `snapshot.py` from two hands).
It cures nothing about `data/`, which is gitignored and therefore NOT copied into a worktree: point it at
the real one with `EUROLEGHE_DATA_DIR` and you are back to one write lock, or copy the 49 MB and the two
sessions measure on two different databases, which is worse than a lock. So the rule has a second half that
is not a git feature: **one session owns the DB** (acquisitions, `snapshot`, `export`) and the other works on
the app, the docs, or read-only.

## Three harnesses, not two - and the third one reads the app's own code
**`toolkit/bench/draft/` (10/08/2026).** `backtest` judges RULES, `sweep` judges CONSTANTS, and this judges
**POLICIES**: what to take now, in which currency, under which rationing. It replays the gate's own windows as
a DRAFT (legal eleven on the rulebook's modules, paired comparison inside the same draft, in per cent because
seasons have 29-31 matchdays), with the same vocabulary of verdicts - strict and robust, the 0.5% floor, no
window below -2%. Two readings and neither may hide the other: the advantage over the rivals (whose null is
weak on purpose, the table contains deliberately weak heads) and the gain over the BASELINE, which is what a
candidate has to win.
It keeps **no copy of the panel**: `entry.ts` re-exports `needFor`, `predictRivalPick`, `startingPlaces`,
`lambdaOf`, `netOf`, `coverNeedOf`, `needForUs` and the whole of `mantra-legal.ts` from `app/src/app/core/`,
and `build.mjs` bundles them with the app's own esbuild - so what is measured is what ships, and one row of the
bench exists only to check that the shipped code reproduces the measurement that adopted it (it does, to the
decimal). A candidate lives in `policies.mjs` and NOT in the app until it has a verdict: measure on the bench,
then change the panel, then let the bench read it from the panel.
`windows.json` is regenerated (`extract.py`, ~2 min, read-only on the DB) and is **not in git** - it carries
names, prices and votes of paid content. Two things that cost an afternoon and are worth stating: **a port is
verified on the NUMBERS, not on the compile** (the new signature passes the PLAYER where the old one passed the
slot, the published policies still passed `needFor`, `places.get(player)` is `undefined`, the weight was 1 for
everybody, and the first table said the surplus was the best currency - reproducing the published numbers is
what caught it); and a working file must be written in **explicit UTF-8**, or on Windows the script cannot
re-read what it wrote.

## A drawing is a claim too, so the app reads the PANEL's board and never its own
**`modules/boards.py` (10/08/2026).** The auction panel shows a real club's eleven on a pitch, and the first
version computed that eleven in the APP - which was a second answer to a question the toolkit already answers.
The operator corrected it the same day («il campetto deve utilizzare le informazioni del db generato dal
toolkit») and the right path turned out to exist already: `press.extract_boards` was driving the REAL panel
headless for the two judges, and it was **throwing the ballottaggi away** (`_placed` returns
`(x, starter, rivals)`).
So there is now ONE definition of a board, and it has two callers with opposite needs: the JUDGES read it with
`apply_rulings=False`, because a ruling is often made looking at the judge and a judge must never score the
operator's own answers; the PANEL's data path reads it with `apply_rulings=True`, because
`config/board_rulings.json` is his declared truth and has the highest precedence for the drawn board. Same
function, opposite flag, the reason written at each call site, and a test that asserts all three facts (the
safe default, the judge that never opts in, the panel that does) instead of one substring.
`snapshot` writes `boards.json` **inside the folder of the sheet it just wrote** - a board that could describe
a different sheet than the one exported is a mismatch nobody would ever see - and `export` copies it where the
manifest declares it (`engine_sheets[].boards`). It carries per club the drawn module, the eleven with the
panel's own `x` (flanks already ordered, so an empty flank reads as a gap), up to two duels per man, the
granular real roles and the minutes. Tk is an ENVIRONMENT and not a dependency of a sheet: without a display
the sheet is complete and only its boards are missing, which is reported and never raised.
Two habits it re-taught. **The app must not keep a fallback that draws a different eleven under the same name**
- no board means the card says so. And **a column that looks like a flag can be a word**: `new_coach` is
`yes`/`no`, so `Boolean(...)` read every coach as new, caught by the test that typed it.

**And two defects the DATA did not have.** «Non vedo i campetti»: the bundle carried the boards, the app's own
copy did not - `app/scripts/pull-bundle.mjs` copies named folders, and a folder added to the EXPORT has to be
added THERE too, or the app reads an older shape of the same bundle. The card was right to say it had no board.
The pull now counts what it copies and warns on a zero: a silent zero is indistinguishable from a broken
feature. Then «recupera gli stemmi di tutte le squadre»: measured before downloading anything, and nothing
needed downloading - 93 badges travel, **all 47 clubs the panel can show have one**, and the 13 that do not are
outside the perimeter AND have no provider id (zero clubs have the id and not the file), so the cure would be
an IDENTITY and never an API. What was actually broken was the call: `ui-crest` given only a name draws a
monogram by design, and the auction panel was passing only the name. **The data was there; nobody asked for
it** - and measuring first saved a whole scraper.

**And the MIRROR of that rule, which a future session must not delete by citing the rule above**
(11/08/2026). The app now draws a SECOND pitch beside the real one: the best legal eleven a squad AT THIS
TABLE can field (`core/fanta-eleven.ts`, `views/auction/fanta-pitch/`), and that one IS computed here. The
two are opposite questions and the boundary is the same one that put boards in the toolkit: a real club's
eleven is a **prediction about a person**, so it is a measurement and lives where measurements live and are
judged; a fanta squad's eleven has **no coach to predict** - it is a question about the RULEBOOK, «which of
the legal shapes lets these men on the pitch», so it is a deduction and lives where the question is asked.
Hence «the app reads the board and never its own» binds the DRAWN board of a real club and nothing else.
What travels with it: the currency is the **VALUE**, the one the five-window draft bench measured for this
format (not the surplus, and `value99` is a rank that cannot be summed - an eleven is a sum, so `valueBy` is
the fantapunti definition and `value99By` is that same map on the session's scale, one pricing and not two);
the module is CHOSEN as the one whose places field the strongest eleven, with the runners-up shown, because
an automatic choice must be doubtable; a man the sheet cannot price is listed APART and never fielded, which
is «vuoto = ignoto» applied to a drawing; and `mantra-legal.ts` was WIDENED rather than copied (`placesIn`
carries the line and the rulebook's own slot name, `bestEleven` returns who stands where, `bestElevenWorth`
is its total), so the draft bench keeps reading the one definition of legality.

**Three states a name carries, and only two of them are measurable** (11/08/2026, `ui-flags` +
`core/player-status.ts`). One component and ONE service, drawn in every list that shows a player, because the
defect this project has already paid for is a displayed list whose figures describe a different list: two
definitions of «he is injured» would eventually disagree, and the first time anyone noticed would be at a
table. A long OPEN injury and a RECENT RETURN from one are read from the bundle's own `injuries` table - the
same dated spells the consultation table already uses - and their two thresholds (45 and 60 days) are DISPLAY
choices declared in one place: they enter no valuation and move no ranking, so no gate owns them, and saying
so is the point or the next reader takes them for measured. Three rules the code obeys: the open spell WINS
over the return (a man who came back in June and broke down in August is out NOW), the LONGER of the source's
own `days_out` and the calendar is taken (the page can be older than the bundle), and the mark is computed on
the CLOCK while the tooltip states the day the data was READ - two dates, neither assumed. The third state
cannot be measured at all and is therefore DECLARED (`config/player_notes.json`, above).

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

**A branch no fold can see is where a defect survives, and the sweep cannot find it for you** (07/08/2026).
`window_standing` is declared unscorable - the sweep does not rebuild a recent-form window for a season played
years ago, and it says so in `KNOWN_GAPS` - and that same branch turned out to be the ONLY one exempt from
`standing_prior_rounds` = 10, because `standing` returned before the shrinkage. So the shortest sample the
panel ever builds a standing from was the one nobody shrank: Oulai, no season on file and ten matches in
Turkey, read **0.609** and took Fiorentina's third midfield shirt off Atta, who had 2563 measured minutes at
0.576. Two habits come out of it. **The sample a shrinkage is about is the sample, not the calendar** - one
definition (`presence.sample_rounds`), read by `standing` AND by whoever buckets a prior BAND, or a man with
ten matches is filed among the season-long starters and pulled toward the highest prior there is. And **when a
new channel fails to rescue the case it was born from, look for the cause instead of a bigger remedy**: the
personal-Elo rank was refused twice, and of the three men it was supposed to deliver, two were held out by
wrong denominators (this and the origin calendar below) and the third by a parameter nobody had decided.

**And to attribute a change you must move ONE variable - including in the harness itself.** The sweep report
before and after these fixes differed in 21 of 56 parameter-blocks, and it was not the fixes: `level_gap_weight`
= 0.06 had entered `presence.DEFAULTS` between the two runs, and DEFAULTS is the base every OTHER parameter is
swept on top of. Isolated with a third run at HEAD: **no adopted parameter changes verdict**, and where a
pooled optimum has drifted (`standing_prior_rounds` 10 → 6, `standing_weights` 0/1 → 0.35/0.65, `level_weight`
0.06 → 0.04) the held-out gain of moving is negative or under a tenth of the floor. A drifted pooled optimum is
not a parameter to change; it is one to look at next time.

## Rebuilding from nothing, and the app bundle
Two commands own these, and both print a plan before doing anything:
- **`bootstrap --plan`** = the ordered acquisition on a machine that has never seen the project (15
  steps, ~17 h, resumable, refuses to start without credentials). `rebuild` stays OFFLINE by design -
  it replays the cache - so on a fresh clone it is `bootstrap` that fills the cache first. Optional and
  not on the public web: the Drive roster exports (`fetch --inbox` imports them from `data/inbox/`); the
  authenticated listone creates `players`/`clubs`/`rosters` without them.
- **`export`** = the app's bundle. `data/export/` is **gitignored**: it carries the same paid
  fantacalcio.it content the cache does, and the repo is public.
  **Exception, and it is the operator's decision rather than a measurement (09/08/2026):** he asked for
  the real bundle on the public GitHub Pages site — «pubblica i dati veri ... la webapp e' per uso
  personale» — after being told twice that a Pages site on a public repository is open to anyone,
  indexable and downloadable, so «personal use» does not restrict it. So the bundle DOES travel through
  git now, on the **`gh-pages` branch only** (`app/scripts/deploy-pages.mjs`, rewritten as a single
  orphan commit each time); `master` still never carries it, and `data/export/` stays gitignored.
  A `robots.txt` asks crawlers to stay out, which is the only access control Pages offers here.
  Two consequences worth stating: the publisher is the OPERATOR'S MACHINE and cannot be CI (a runner has
  no bundle, and a second publisher would republish the site without data and wipe it); and the decision
  is revocable — `make-demo-bundle.mjs` still generates a data-free demo, so going back is one script.
`fetch --plan` answers "what is missing here?" table by table, with the command that fills each gap.
Every run leaves a line in `ingest_runs` (module, when, status, options), written by whoever owns the
invocation - CLI, rebuild or GUI - never by the module itself.

## A cache without an expiry is a freeze, not a saving
**Found 09/08/2026, and the code promised the opposite of what it did.** `fetch_extra_matches` keeps ONE
file per club and skips the download when it exists, while its own docstring says the layer «can be re-run
through August as the friendlies are played». Without `--refresh` that is false: the per-match layer sat at
**28/07/2026** for every club, so the pre-season friendlies of August did not exist - in the very window
that layer is for. Re-run with `--refresh`: 2026-27 from 1,772 to 4,234 rows. The rule to carry: a cache
over a fact that CHANGES needs an expiry or an explicit refresh in the caller's hands; a cache over a fact
that is FINISHED (a played match's incidents, a club's badge) can live forever, and the difference is
worth stating where the cache is written.

## A cross-role ranking must say WHICH pool each number is a fact about
**16/08/2026, and the operator found it as a paradox: «mettere tutti i primi portieri a 99 non ha senso,
significa che tutti sono forti uguale».** The app's Overall ranked the whole listone on one raw number,
and the goalkeeper role both FLOATED (median 66 against the midfielders' 40) and COMPRESSED (the twelve
best keepers inside ten points), so the column said neither what a keeper is worth nor which one to buy.
The cause is in the ZERO and not in the ranking, and it is written in the toolkit itself
(`features.replacement_levels`): the replacement is the rank `teams × slots` inside that role's pool of
REGULARS, and the pools are different sizes — for Serie A keepers the rank (10×3 = 30) is longer than the
pool (~22 starters), so their zero is **the worst regular keeper** while D/C/A get the 80th of ~150, a
mid-table one. Measured as distance from each role's own anchor: **P −0.90 · D −0.35 · C −0.38 · A
−1.15**. Four zeros at four depths are not comparable, and every role-level statement that follows is a
statement about the ruler.
The cure is the operator's own sentence — «normalmente è la fantamedia a creare questo confronto» — each
role measured against its own, then all four in one ranking: role medians 66/49/40/60 → **58/51/46/47**,
the keepers' spread 10 → 16 points, agreement with the sheet's surplus 0.64 → 0.48, and the price stated
rather than hidden (dividing by the role's spread promotes a compact role's best over a wide one's).
Two habits travel with it. **A difference between two GROUPS is not a virtue of whoever carries it** —
the same lesson the age channel taught, met again in the steadiness tilt, which was centred on the whole
listone while «closing at 6» has medians 0.86 / 0.65 / 0.61 / 0.57 by role and was therefore paying every
keeper +0.11 of fantamedia a match for being a keeper. And **a case the operator has already ruled on is
a test**: the elegant alternative (take the zero from the man you would FIELD, the 11th keeper instead of
the 31st) spreads the keepers three times better and was REFUSED because it sends Simeone from 94 to 41
while leaving Esposito F.P. at 79 — exactly the ordering he had corrected the day before. Details and
every refused variant: [docs/model/letture-app-v1.md](docs/model/letture-app-v1.md).

## The zero of a metric is a question, and there is more than one question
**16/08/2026, and the operator found it by asking a schoolboy question**: over three matches, is a
midfielder who scores 6.5 / 7 / does-not-play better than one who scores 6.5 / 7 / 6? The answer is not
19.5 against 13.5, because a missed round is not a zero — a substitute comes on. So everything depends on
what the bench is worth, and the sheet's `engine_replacement_fm` is the marginal ROSTERED man (the 80th
midfielder of a ten-team league) while what actually enters is **the best of your own who has a vote that
day**. Measured two independent ways — simulating the season (ten squads, snake rosters, field the best
with a vote) and taking the rank `teams × places FIELDED` — the two agree: **P 5.01/5.03 · D 6.11/5.81 ·
C 6.37/6.30 · A 6.79/6.87**, against the sheet's 4.13 / 5.66 / 5.87 / 5.61. Half a point.
Three things the simulation settled that an armchair estimate gets wrong. It is not a mean but a
**maximum** — you pick the best of the spares, not one at random. The bench is shorter than it looks: of
eight midfielders you have **5.3 available on average and all eight on 3% of rounds**, so that maximum is
taken over ~2.3 men. And the value DECAYS with the number of holes (6.46 with one, 6.30 with two, 5.88
with three) until, with three, it lands on the sheet's own number: **the sheet's replacement is the value
of your bench on the worst day**, which happens 2% of the time. League size barely moves it (6.42 → 6.28
from 8 to 12 teams) because the binding constraint is availability, not the depth of the listone.
The durable lesson is not the number. It is that **`engine_replacement_fm` and «what enters» are two
zeros for two questions** — «who should I buy» against «what does a missed round cost» — and the same
change is right for one and wrong for the other: the fielded zero, adopted in the app's Overall, had been
REFUSED hours earlier because it broke a ruling the operator had already made, and it stopped breaking it
only once the Overall's base moved to `FM att.`. A refusal is conditional on everything else that was
true when it was made, and re-measuring after a change is not re-litigating.
**So the sheet carries BOTH, and the gated one was not touched** (16/08/2026, `SHEET_REVISION` 22,
`desc_replacement_fielded` / `desc_surplus_fielded`, column «Margine» beside «Surplus» in the app). The
places an eleven fields are COUNTED from the game's own rulebook (`features.fielded_places`, one reader
for both files: classic reproduces P 1 · D 4 · C 4 · A 2, mantra gives the twelve codes, and both sum to
ELEVEN — which is the test, and the same transcription check the two files make about themselves). Two
habits it re-taught. **Move ONE variable**: the second zero reads the same pool over the same seasons as
the gated one, so the two columns differ by the depth and by nothing else — and because of that the top
25 change MORE than §21 had estimated (7 names in common against 13), the whole difference being the
forwards' pooled level (6.99) against 2025-26's (6.71). And **a slot is decided once**: asked to choose
freely on the deeper zero, every `dd`/`ds` of both mantra sheets moves into the `dc` list, so the row
would name one slot and carry another's level — the very sin `auction_level` exists to prevent.

## A provider that stops answering is a measurement, not an obstacle
**16/08/2026.** A `--refresh` over 93 clubs left Sofascore returning **403 `challenge`** on every
endpoint, and the run that caused it brought only the current season — so the story told the night
before («the extra layer is keyed per (club, season), so pagination could never reach back») was itself
wrong: the code does paginate, it stopped receiving data. Three things worth keeping. **Verify the route
on ONE unit before launching 93** — that check was never made, and it is what the whole run cost.
**A defect explains itself with a plausible story if you let it**, which is the same rule the coach-join
taught. And when a source closes, the answer is measured and not argued: of the four alternatives probed
with one request each, FBref is behind Cloudflare (403), football-data.org needs a key and has no
per-player minutes, **Transfermarkt answers 200** — and its `ceapi` serves the market-value history as
clean JSON with no consent wall, while its performance and national-team pages hide their tables behind
one. Guessing endpoints is not searching: 4 of 6 guesses returned 404, and the way in is to record the
calls the real page makes.

## A mid-season continental cup is a CALENDAR, and the only unknown is who goes
**17/08/2026, from the operator's question about the Africa Cup — and the first answer reverses the
premise.** In 2026-27 the CAN does not touch the league at all: it is played **19/06 → 17/07/2027**, the
first summer edition since 2019, so it costs a PRESEASON (`post_torneo`) and not a matchday. The only
tournament inside the season is the **Coppa d'Asia, 07/01 → 05/02/2027**, and it reaches 4 quoted men in
Serie A and 9 on euro. Zero Africans, which is the point.
Three facts of three different kinds meet on that row and each is treated as what it is. The CALENDAR is
declared (above). The NATIONALITY is an IDENTITY, and it was **already paid for and unread**:
`players.nationality` had been in the schema since day one and was NULL on all 4,674 rows (the listone's
«Nazione» column is the LEAGUE), while the squad payloads we download daily for the granular roles carry
`player.country` — read offline, 1,840 players, 92% of the Serie A listone and 90% of euro, and the gap is
exactly who has no sofascore identity. No network, which is also the only reason it could be done at all:
the provider has answered 403 `challenge` since 16/08. Validated instead of believed: on the 300 quoted men
who played the 2026 World Cup it names the national team they really turned out for **299 times**.
What it COSTS is MEASURED — difference-in-differences over four tournament windows, treated = that
confederation's nationals, control = the same league and season, outcome = the share of his club's matches
he was on the pitch for inside the window against outside it: **AFC 0.59 · CAF 0.35 capped / 0.20 not**
(gate §7-quattuortricies). The Asian Cup costs twice the CAN, and the mechanism says why: an African
passport in Europe is common and a call-up is not, while the handful of Asians who play here are their
countries' starters. So the coefficient already contains the probability of being called, which is what
makes a call-up list — a thing nobody publishes in August — unnecessary rather than missing.
Three habits it re-taught. **The unit of a subtraction is part of the subtraction**: the window's rounds
are counted from the real calendar (`fixtures`: Serie A 4, Bundesliga 5, Premier 3) and converted to the
PLATFORM's, because that is what `engine_pv_pred` lives on. **A coefficient is capped by the population it
was measured on** — regulars — so a squad player can never lose more rounds than he was going to play.
And **the counter-example lives where the validation is blind**: the World Cup test can only see men who
have already chosen, so the man who chose another country is declared, never inferred from a birthplace.
REPORTING: `desc_pv_cup` / `desc_value_cup` sit beside the gated column, `backtest --verify` stays 22/22,
and the engine-side rule is pre-registered with its criteria written before the run.

## Three facts that are snapshots and can never be backfilled
- **Starting probability** (`probable_starter`): the site publishes only "now", so a week not captured is
  gone - and the operator's judgement, recorded 29/07/2026 and made final on 05/08/2026 («il job ogni settimana non serve»), is that **there is no scheduled job at all**: `scripts/refresh-editorial.ps1` is a manual run for the day of a session. The
  editors' forecast reasons from the same facts this toolkit already measures (last line-ups, injuries,
  formation habits); what it adds that we cannot compute arrives LATE, from the coach's own words, so the
  reading worth having is one taken **just before kick-off** and used at once, not a history. It also does
  not serve the toolkit's actual target: an initial auction happens in August, when the page does not exist
  yet. Consequence to state rather than treat as a gap: `starter_prob` 0/1453 on past windows is **empty by
  design**, and no auction rule is waiting for it. What this DOES require, if a pre-match reading is to be
  taken seriously: `valid_from` and the cache file are per-DAY, so two captures on the same matchday
  overwrite each other and a 20:45 kick-off would read the 15:00 state - the series needs an hour.
  **And the day of a reading does not say which SEASON it is about** (07/08/2026): the page keeps serving the
  last round of the season that ended until the new one starts, so until 04/08 it carried 810 hrefs of
  `2025-26` at probability **1.0** - line-ups that were FIELDED, not forecast - and those were the freshest
  rows a 2026-27 sheet could find: 428 of 648 Serie A `desc_starter_prob`, 415 duels built on them, and their
  442 players asserting a 2026-27 squad through the strongest of the three squad sources. The season is in
  every href and the parser already read it; it is now STORED (`probable_starter.season`) and the readers
  filter on it, so the columns are empty and say so. Two habits behind the fix: a dated fact needs the date
  of the OBSERVATION and the identity of what it observes, and a row that cannot say which season it belongs
  to is unknown - not current. **Also: the euro pages exist** (`-euro-leghe`, the listone's own spelling) and
  nothing read them, so four leagues of five had no editorial signal; they are captured daily now, and by the
  operator's judgement (07/08/2026) they stay **poco affidabili** - for the weekly line-up the reading worth
  having is a per-player search of the press near kick-off, not this page.
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

## A change declares what it CHANGED, not what it invalidated
**Operator's request, 06/08/2026, after the bill arrived.** The club-identity migration printed what it
merged and how many duplicate rows it dropped, and said nothing about `arrivals` — which is a DIFF BETWEEN
ROSTERS, so a player who never moved but whose club id did reads as a transfer. Newcastle 2024-25 came out
with **26 arrivals** against 6 the year before and 7 the year after; Eintracht with 28. Those fed
`desc_arrival`, the arrival tiers, the FM-equivalent and the arrival discount, so the phantoms were in the
auction sheets until somebody went looking. Re-derived: 26→3, 28→12, 39 rows of 6550.
Two things came out of it, and the second is the durable one: the full dependency map now lives in the spec
(«Dipendenze e ri-derivazioni — cosa rifare quando cambia cosa»), derived from the modules' own `DEPENDS_ON`
rather than from memory; and the migration itself now PRINTS what to re-derive. Same family as «vuoto =
ignoto»: a side effect nobody declares is one that surfaces at the table. The one asymmetry worth memorising
because it saves a re-run: a parameter adopted in `presence.py` moves only the SHEETS — `evaluate` does not
import it, so `backtest --verify` stays 22/22 — while a rule or an `ADOPTED` change moves `engine_*` and needs
the gate, the sheets and the bundle.

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
**And "the club's own league" means the club he PLAYED FOR, which for an arrival is not the club he is at**
(07/08/2026). Gonçalo Ramos's 1320 minutes are Ligue 1's 34 rounds and were divided by Milan's 38: 0.386 of a
season where he had played 0.431, 12% of himself given away - the same rule broken for exactly the men it was
written for, and it kept him out of the typical eleven by 0.013 of claim. Cured with
`desc_arrival_origin_rounds` (the origin championship's rounds, from the per-match layer and per SEASON, so a
league changing size is not a constant anybody has to remember), read by `SnapshotView.season_calendar` and by
the sweep under the same rule. Two limits stated rather than averaged away: only for a man whose WHOLE
measured season was elsewhere - a January transfer has minutes on two calendars and no denominator is right
for him - and an origin we cannot name keeps his club's, «vuoto = ignoto». Details: spec «Novità v9.37».

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

## A null is not a detail, it is the measurement - and the POOL is half of it
**14/08/2026, and it halved a result twice in one day.** Two screens («possibile promessa», «possibile flop»)
came out at a lift of **5-10x** and ship at **1.0-2.4x**. Nothing about the signal changed: the screen contains
«cheap» among its own conditions, and the first version compared it with everybody who failed the filter -
**the expensive men included, who by definition cannot be labelled «exploded»**. That credits the signal with
what is merely the definition. Measured inside the pool the operator actually chooses from (same role, same
price band, same minutes floor), the honest numbers are the second ones. Same shape as the hot-hand lesson one
level up: there the null was the reshuffled sequence, here it is the CONDITIONING SET, and both times the raw
number was a statement about the construction rather than about football.
The companion case the same day: «he played above his own averages so he will come down» reads **+0.204** raw at
five matchdays - which anybody would report as «form persists, and more so over longer windows» - and the
reshuffled null is **+0.205**. The true excess is −0.0007, and it changes SIGN with the window (+0.0167 at two,
+0.0072 at three) over ~65,000 windows. Third refusal of that family, after «goals minus xG» (0.000, 3/8) and
«creating and not converting yet» (−0.046, 3/8). Numbers and method in
[metrica-asta-surplus-v1.md](docs/model/metrica-asta-surplus-v1.md) §20.
**And a corollary about what a blank means, verified rather than assumed**: NULL `xg` in the per-match layer is
a ZERO (3701 of 3701 such rows carry `shots` = 0, and not one of a season's goals sits on one), while the
provider CHANGED the payload's shape between seasons - 2022-23 emitted an explicit 0 and from 2024-25 it omits
the key. So the reader imposes the convention and never trusts the encoding; reading those NULLs as unknown
would have thrown away half the table, and reading them as zero without checking would have been the opposite
defect.

**A screen's numbers must come from the FUNCTION THAT SHIPS, and the denominator is half of them**
(14/08/2026, twice in one evening). A rotation screen was calibrated on a reimplementation that walked
each man's own ROWS and read 84.5% precision against a 34.9% base; the shipped function walks his CLUB'S
FIXTURES and counts the rounds he missed as zero. Re-scored by CALLING it at six dates of four seasons:
90.4% against a base of **59.5%** - the precision went up, the lift fell from 2.42x to 1.52x, and only
the second pair is about the thing that ships. Same evening, the mirror screen: its outcome bar was
borrowed from the rotation one (60 minutes a club match), and **the mirror of «he is not a starter» is
not «he is one»** - it called Castro wrong, a man who started 27 matches of 37. Counted the way the word
is used (how often he STARTS) the base moved from 22% to 41% and the screen from 53.8% to 79.1%. Two
habits: score the function, not a copy of it; and when a threshold is reused on the opposite question,
check that the WORD still means the same thing. Both readings stay on the record, so nothing is hidden by
the correction - and the reason for it must not depend on the screen's own score, or it is fitting.

**And a short window carries ONE threshold, not two.** The same evening, on the operator's «warn me
before the fifth round»: measured at 1, 2, 3, 4 rounds, the fourth is worth as much as the fifth (96.3%
against 94.9%) and two and three are worth 81% against a 58% base. So the full mark fires from the
fourth and the earlier one is a DIFFERENT mark with a different sentence - «look at him», not «he is not
the starter» - because the counter-example is what decides it: after two rounds it would have named
Donnarumma on 0 minutes, and he averaged 85. Under four rounds the rule is «he has never started», since
«at most one start of two» is not a sentence anybody measured.

## Non-emptiness is not completeness, and three things look identical to a COUNT
**14/08/2026.** `fetch --plan` said «every source is populated» while the xG of 2021-22 did not exist. A count
cannot distinguish four situations and only one of them is work to do: **declared** (the column has no source
and `validate.ALLOWED_EMPTY` says so - `match_ratings.minutes` is NULL on all 263,393 rows because the votes
Excel has no minutes, and nobody reads it there), **convention** (the value is absent because it IS zero, per
the xG rule above), **source** (the provider does not serve it, so no scraping will produce it), **missing**
(the only class that deserves a command). Plus the TARGET season, whose on-pitch facts are absent by
construction: offering `ratings --season 2026-27` in August is a command that cannot succeed.
`fetch --plan --seasons N` now classifies instead of counting, and the result over six seasons is **zero
season-shaped gaps a command could fill**. Two habits travel with it: a defect that explains itself with a
plausible story («we never scraped it») is worth one measurement - the cached 2021-22 payload carries
`expectedGoals` for **0 of 446** players against 312 of 471 in 2022-23, so re-downloading adds nothing; and a
plan that prints a command nobody can run is worse than no plan - the first version of the list offered
`matchdays --season 2021-22`, a flag that does not exist, so a test now checks every template against the real
parser.
**...and the same NULL can be the fact you were about to go and fetch** (14/08/2026). A todolist item planned
an offline re-parse of 1,373 cached payloads to «create the bench rows the parser discards», on a true
observation - no row of the per-match layer has `minutes` = 0 - and a false conclusion. An unused substitute
carries a `statistics` object with `totalShots` and no `minutesPlayed`, so the parser has always written his
row: **79,437 of them**, `started` = 0 and `minutes` NULL, and the app's own consultation table was already
reading them as the bench. What was missing was a READER, not a run. Two things travel with it: the reading
holds for the LEAGUE source only (in a friendly the provider publishes the eleven and no statistics at all, so
there «no minutes» cannot tell an unused substitute from a man who played an hour - the same absence with two
opposite meanings), and the bench BEATS a dated injury spell that covers the day, because a man printed on the
team sheet was available and was not chosen, which is the other question and the one that changes a bid.

**A column documented with six states can carry two.** `match_ratings.status` is populated on 100% of rows and
holds only `played` (228,246) and `no_vote` (35,147); the schema comment promises `bench | injured | suspended |
not_in_squad`, never written. Anyone trusting the comment would believe the bench is readable from there. Same
family as «a column that looks like a flag can be a word», and the reason `flags.new_coach` cost a whole
channel the same day: its value is the COACH'S NAME, so a filter on `value='yes'` matched nothing and the
channel went silently constant.

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

## A judgement needs its NULL, and the reference decides what may be compared
**Two judges now score the boards, and the second one is the stronger** (08/08/2026, `press` module).
`press --sheet DIR --against press|outcome`: the press is a FORECAST by other people and the only judge
that exists before a ball is kicked; the OUTCOME is what the clubs actually did (the modal shape of a
finished season and its eleven most-started men) and needs a back-dated sheet
(`snapshot --season 2025-26 --date 2025-08-15`). The reference is a DATED FACT (`press_formations`,
per-DAY like `probable_starter`, archived under `data/raw/press/` and replayed by `rebuild`) and **a
JUDGE, never an input**: reading it inside the claim would make circular the very comparison it serves.
Three rules came out of using it, and they generalise past the boards:
- **A number without its null is not interpretable.** «134 of 220 men» means nothing until «the same
  eleven as last year» is on the same page — it is 104. The boards beat that baseline by 30 men and 4
  modules, and THAT is the result; the raw 62% is not. Same rule as the hot-hand measurement
  (Miller-Sanjurjo, §5-duodecies): compare with the reshuffled sequence, never with zero. A club the
  baseline cannot answer for (a promoted side has no previous season here) is counted APART, because
  «0 of 11» there is a property of the baseline and not evidence about it.
- **WHICH representation may be compared is decided by the REFERENCE, not by preference.** The press
  writes four-number modules, so it is judged on the DRAWN picture after `_reshape`; the outcome is
  counted off `club_match_lineups`, which holds three lines and CANNOT say 4-2-3-1, so it is judged on
  the board shape. Judged on the wrong side, every split row reads as a disagreement — measured, 5 clubs
  of 20, the difference between 7 MATCH and 12. The report carries the other count too, as a READING of
  how much of the gap is vocabulary; declaring 4-5-1 ≡ 4-2-3-1 would be widening a criterion because
  cases failed it, which is forbidden.
- **A measured ceiling is not a defect.** 62% of the men is bounded by the season itself (injuries, the
  January window, sackings): Verona reads 2/11 because it changed nearly everything. And a back-dated
  sheet has one contamination IN THE MODEL'S FAVOUR — transfers and arrivals are derived today, so the
  board knows a summer market that was not closed in August. State it: the number is an upper bound.

## A judgement the model cannot reach is DECLARED, not adopted as a parameter
**08/08/2026, the Napoli case, and it is the third way out of a real dilemma.** The operator brought
three true clues that his board was wrong (the camp's two 4-3-3, a squad of wide forwards, and a
previous season that began with a back FOUR for 11 rounds before 27 of 3-4-3), and every channel that
would read them had already been measured and refused: the camp's MODULE (`PRESEASON_WEIGHT`, optimum
at the edge) and then its BACK-LINE FAMILY, the stronger form of the same idea - «choosing three at the
back or four is what you build the rest on». Measured on the 16 clubs with a parsed camp, the camp gets
the family right **11/16** against the board's **14/16**; it wins exactly where he said (Napoli,
Juventus - both new coaches) and loses on five, with two clubs reading as strongly in the OPPOSITE
direction. On new coaches alone it is 4/4, a coin. Adopting it would be widening a criterion because a
case failed it, which is forbidden; leaving the board wrong would be ignoring someone who knows
something true. So the judgement is **declared** instead of inferred: `config/board_rulings.json`,
dated, revocable, joined by identity, and **invisible to both judges**. Three habits travel with it: a
declared fact needs a way BACK (the selector's «auto» removes it from the file rather than covering
it); the measurement that refused the channel is written down with its numbers, so nobody re-runs it;
and the limit is stated rather than hidden - the strong judge could not rule here at all (no 2025 camp
in the DB), so the 2026 camp is archived and the comparison is pre-registered for May 2027.

**And the same family refused a fourth candidate, this time inside the PANEL** (16/08/2026, gate
§7-tretricies): shrinking a short in-season sample toward the man's OWN previous season instead of the
population's mean. Measured on all twelve back-dated sheets by moving ONE variable on the real view: it
moves half the sheet's claims (median 0.08 in February, 0.19 in September) and 385 board places, changes
**zero shapes**, and against the outcome the sheet itself carries it is worse or equal **12 times out of
12** (2142 against 2164 of 3322). The mechanism is the age channel's again — the personal prior
correlates **+0.523** with this year's raw standing, so half of what it brings is already in the minutes
being read and the other half is a season old. Plus a structural reason the shapes cannot move: inside a
club, in-season, the men share nearly the same sample size, so the shrinkage is an AFFINE map and the
order is preserved. **Before building a channel, ask what its output can even change** — that argument
was available before the measurement and would have predicted half the result.

## A difference between two groups is not a channel
**Not until you have checked that the model is not already reading it** (08/08/2026, the age case, gate
§7-quinvicies). Over 500 (player, season) pairs with 15+ Serie A starts, the share of starts kept next
season is 66% / 72% / 77% / 51% by age band (≤23, 24-26, 27-29, ≥30): an inverted U, so a THRESHOLD and
not a trend — a linear term would penalise the twenty-year-olds, who are second worst. Implemented as a
channel reachable by both harnesses and **refused by both**: `sweep` +0.23% and +0.04% (under the 0.5%
floor, with euro's optimum AT THE EDGE), the outcome judge worse at every grid point. The mechanism is
the lesson: the 30+ already carry fewer measured minutes (1299 against 1574 for the 27-29 band), so the
standing discounts them BEFORE any age term and the term charges the same evidence twice. The band table
did not control for the minutes; the model does. Three more candidates died the same week and are worth
not re-trying: the co-start rule (true about the pair, and the press starts the man it removed), the
training-camp shape (`PRESEASON_WEIGHT` 0, optimum at the edge), the SURPLUS as a module discriminator
(4/3/13 against 11/5/4 — it answers «which module suits ME», the odds answer «which will the coach
pick»). And one that is not refused but **unmeasurable**: the level step of a man who changed
championship without changing listone club is 3-7 players a season, so no harness can judge it and by
the golden rule it cannot be adopted.

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

## A squad is a DAILY fact, and only a full read can say somebody is gone
**Operator's rule, 05/08/2026: «il listone può non essere aggiornato al minuto, troviamo un ente affidabile e
aggiornato in tempo reale».** The reliable source already existed and nothing read it as a squad: the provider's
`/team/{id}/players` — one request per club, downloaded every day for the granular roles, and dated. Measured on
the case that asked the question: its 28/07 payload had 46 Napoli players and **not** Gutierrez, while
`fc_site` still listed him on 04/08 and the Transfermarkt squad page on 29/07. Three rules come out of it:
- **only a whole-squad read can express ABSENCE.** A squad page says who is in, a transfer says an event
  happened; neither can say "he is not there any more". That is why the departure flag has two independent
  signals (the transfer, which names the destination, and the live squad, which simply lacks him) and why
  `squad_snapshot` now carries the provider as a fourth source.
- **absence has TWO twins that mean the opposite**, and each needs its own guard. A man with no provider
  identity is missing from every payload by construction, so absence is only evidence about a man the provider
  can identify — «vuoto = ignoto, mai zero», the same rule the duel columns are built on. And a payload is the
  FIRST TEAM as the provider chose to publish it, so how complete it is varies by club: West Ham reads 18 men
  against 29 identified and not one of its fourteen "departures" is corroborated, while Bologna at 24 of 28 is
  6 for 6. Hence `complete_squads` and `SQUAD_COMPLETENESS` = 0.90, MEASURED over 172 absences (precision
  57.6% ungated → 83.1% at the gate, runner-up 0.85 at 81.9%; the choice is precision-first because a false
  departure hides a man who is really there while a missed one only leaves the listone's claim standing).
  Effect: 93 flagged rows → 48, zero new. And a signing made after the payload's date reads as absent until it
  is re-read, so the flag always carries the OBSERVATION DATE.
- **the row declares, the BOARD obeys.** Two different questions: the sheet keeps him at his listone club with
  a `⇥` (that is what you buy from), while `eleven()` excludes him outright in both modes — the typical eleven
  is «the side with everybody fit» and a man who plays elsewhere is not in it at any fitness. The order is
  forced: without the completeness guard, this same change benches twelve West Ham players who are really
  there.
- ~~**the sheet declares and does not overrule.** The listone is the game's own authority on who is in a
  squad - it is what you buy from - so a contradiction is reported, never silently applied.~~ **REVERSED by
  the operator on 17/08/2026: «l'autorità di chi è in rosa è sofascore».** The authority is the source that
  READS the squad every day, so the sheet now obeys instead of reporting: a man the two independent signals
  say is gone LEAVES the sheet, because a row you can buy from a club he is not at is worse than a row
  fewer. Measured on the sheets of that day: Serie A **53 rows out** (36 by a transfer that names where he
  went, 17 by the live squad), euro **63** (29 + 34). **The cost is stated, not hidden**: the live-squad
  signal is 83.1% precise at `SQUAD_COMPLETENESS` = 0.90, so about one in six of the absence-based removals
  is a man still there - the board was already paying that cost by excluding him, and now the auction list
  pays it too. Revocable at every run (`snapshot --keep-departed`), and the sheet's note always says how many
  and who. `desc_left_for` / `desc_left_on` still carry the reason on the rows that remain. The transfers layer needed its primary key widened to make this
  possible at all: `(fc_id, date)` could not hold a loan return and a permanent signing dated the same 1 July,
  so it kept whichever was parsed last and read Hojlund as LEAVING the club that had just bought him.

## Converting a currency is a BUDGET question, not a scaling
**SpM / dVM, 08/08/2026, on the operator's request** («un valore che trasformi il surplus in un nuovo valore
confrontabile con l'FVM»). The surplus is in fantapunti over the bench, the FVM is in credits on a scale with
a known total (above), so the rate between them is not a coefficient to choose. Per listone role, with N =
the league's own `teams × slots`: **`rate = ΣFVM over the N men the MARKET rosters / Σsurplus over the N men
the ENGINE would`**, then `SpM = rate × surplus` and `dVM = SpM − FVM`. That prices MY roster at exactly the
money the market spends on its own - same budget, same slots, a different opinion about who deserves them -
and the null is exact: summed over my roster, dVM is how much MORE the market's roster costs than mine at
market prices, and it can never be negative. **Fitting on everybody quoted instead is wrong and was
measured**: it spreads the same money over ~900 men instead of the 300 who get bought and reads them as 23%
overpriced by construction. The pool is the LISTONE ROLE and both alternatives were measured rather than
argued: one global rate turns the column into a statement about roles (mean dVM +38 keepers against −57
forwards, 14 of the top 15 are goalkeepers - true, unbuyable, and it drowns the question being asked), and a
pool per MANTRA SLOT splits two near-identical wide forwards into 8.9 (`w`) and 26.4 (`a`). REPORTING only,
like the FVM it is calibrated on - the gate never sees it (`auction_view(full=…)` is not a gate path) and
`backtest --verify` stays 22/22. Three limits stated rather than averaged away: it never says how to split a
budget BETWEEN roles (that needs the shadow price of a credit, `assistente-asta-v1.md` §4.2); at the very top
the scale runs out (Kane SpM 989 against a listone whose maximum is 499 - correct, and not a payable price);
and on a FINISHED season the FVM has already moved with the season itself, so a big dVM is the engine against
a price that knows the outcome, not a bargain anybody could have taken. Details:
`metrica-asta-surplus-v1.md` §14.

## The currency depends on the FORMAT, and one window is not a verdict
**Measured 10/08/2026 on the five gate windows of euro/mantra, against the real outcome** (`docs/model/
metrica-asta-surplus-v1.md` §15, and the plan it produced: `todolist-draft-v1.md`). The SURPLUS is right
where the scarce resource is what it subtracts against - a credit auction, and the goalkeeper, where you
field exactly one (replacement `por` 4.36 of fantamedia against `pc` 7.29). In a DRAFT on mantra it is the
wrong currency (**-4.0%** against the table, -15.7% on one window) because it charges a per-slot scarcity
the rulebook does not impose: the roster binds 3 keepers + 22 outfield and no per-slot quota, and 497
quoted men of 1014 carry 2+ codes, so the demand behind the surplus is DERIVED from the shapes rather than
imposed by the game. What survives on every window: **playing for the first pick is ruinous** (-45.8%,
0/5), and **role COVERAGE beats the choice of currency tenfold** - covering the module twice is worth
+10.6 points per matchday against the 0.8 that separate the currencies, and the top 25 of ANY ranking
cannot field a legal eleven at all (4-10 places of 11).
Three habits come out of it and they are the durable part. **A conclusion on one window is not a
conclusion**: two were reported to the operator from T2 alone and both died on five - the middle-way floor
(+92 became **+0.0%**) and «the engine beats the market» (Qt.I **+0.545** against our value **+0.514**, the
value ahead only on the window it was measured on). The same discipline later PROMOTED a third one instead of
retiring it: «the bottleneck is `pv_pred`» was also T2 alone and, re-measured, it is 5/5 from two independent
directions (Spearman +0.459 against `fm_pred`'s +0.259; `Var(ln pv)` 86.8-90.6% of `Var(ln` fantapunti`)`).
**A number needs the right null**: the +1.9% the
price-driven policy shows is largely «being like the better rivals», because the comparison is against the
MEAN of a table that contains deliberately weak heads. And **an intuition can be right about the mechanism
and wrong about the remedy**: «when slots get scarce you need alternatives in every role» is true, and the
cure is a constraint on the roster, not a change of currency - the schedule that switches currency
mid-draft is worse the earlier it switches (-131 at round 6, -162 at round 11).

**And the biggest defect the campaign found was not in the plan it produced: it was the currency the panel
was already advising with** (10/08/2026 evening, `metrica-asta-surplus-v1.md` §16). `pickForUs` ranked by the
NET - `surplus - lambda x price` - and rationed by role not at all: measured as a policy, **-52.3% against
the paired rivals, 0 of 5 windows, 34 credits spent over 25 picks, half the eleven uncovered**. Structural
rather than mistuned: lambda is the exchange rate between a credit and a fantapunto, and in a draft you do not
spend credits, you spend PICKS - so subtracting a rate nobody pays rewards being nearly free. Two symptoms had
already been patched at the edges without the cause being found (the one-credit fillers at the end of a round,
which is where `TAIL_PRICE_FLOOR` came from, and the third strip offering an 11-credit unknown). **When the
same symptom has to be patched twice in two different places, the defect is in the quantity both of them
read.** Adopted instead: the VALUE as the draft's currency for everybody including the keeper (the literal
hybrid is refused, -4.88%, on a SCALE defect named before the run), and role coverage as a CONSTRAINT counted
on the module's PLACES over two legal elevens (`COVER_COPIES` = 2, +1.47% robust, coverage 93.4% -> 97.4%).
The target the plan proposed - `startingPlaces x 2` - does not bind at all: those quotas are the ceiling of an
average and sum to SIXTEEN against a shape's ten outfield places, so doubling them releases the rule instead
of tightening it. And no price floor survives the leave-one-out cross-fit (held-out -0.05%), which retires the
«middle way» for good: it was buying coverage indirectly, and the constraint buys it directly.

**...and the same night the CLASSIC round corrected that adoption, which is what a todolist item is for**
(§17). On the ten Serie A windows under classic legality the places-based coverage target LOSES (-1.00%,
4/10), because there `startingPlaces` sums to exactly TEN - a classic module's places are integers, so the
quotas already are one eleven and need no correction - and insisting on two full elevens over a pool only 20%
larger than the draft's own demand buys weak men to cover places that were covered anyway. What ships on
classic is the graduated quota ladder (+0.77% robust, 6/10), which is also robust on mantra (+0.70%) and is
therefore the only one of the two with a verdict on both games; mantra keeps the places rule because it is
worth twice as much there. **A parameter belongs to the population it was measured on, and «game» is such a
population** - the same discipline the gate applies per platform (R19 on `default` only). The bug that made
it visible is the one worth remembering: the panel read a modules file only for mantra, so classic was left
UNRATIONED, which the bench prices at -4.93% - reading «no shapes loaded» as «no rule to apply» is the same
family as reading an empty cell as a zero.
Three more results of that round, all measured. **A rival's head can be read off his own picks**: guessing it
predicts his next pick 82.8% of the time against 69.2% for one head for everybody, 5/5 windows, and two picks
are enough (a longer warm-up is WORSE). **Denial pays early and never late**: at the most generous defensible
rate for this game it repays its cost on 63-70% of the picks in the first fifteen rounds and on 0% after the
sixteenth, so it ships as a NOTE on the predicted picks and never as a change of pick. And **«the market beats
us at ranking» is a sentence about a PLATFORM**: on euro the Qt.I beats our value (+0.574 against +0.499), on
Serie A we beat it (+0.475 against +0.463 over ten windows). Third instance of a conclusion written in the
singular about a platform-dependent quantity. Meanwhile the `pv` bottleneck now holds on FIFTEEN window
instances (5 euro + 10 default, 15/15) with the variance decomposition agreeing from another direction.

**And then the operator asked how to use what the table cannot see - «we know Qt.I, FVM, surplus and value,
they only know Qt.I and FVM» - and the measured answer reverses the premise** (§18). Partial Spearman against
the outcome, each signal controlling for the other: our value adds +0.214 (euro) / +0.246 (Serie A) over the
price, but the PRICE adds +0.388 (euro) over us - nearly double - and our whole incremental edge is ONE number
wide, the appearances (`pv_pred | Qt.I` +0.198/+0.243 against `fm_pred | Qt.I` +0.046/**-0.032** and
`surplus | Qt.I` +0.006/**-0.077**). On euro our disagreements with the price are, on average, our own errors:
where we rate a man high and the market low, the real outcome lands nearer THEIR rank. So the asymmetry is not
exploited by trusting our number.
**What pays uses no informational edge at all: take the man who will be GONE, harvest the one who survives.**
The rivals rank by price, so the dear disappear and the cheap remain - two men we rate the same are not
equivalent, because one has to be taken now and the other can be waited for. `SURVIVOR_DISCOUNT` = 0.7 is
**+4.54% of points per matchday, 5 of 5 windows, STRICT** - three times the coverage constraint and the only
strict verdict this bench has produced - with the spend rising 299 → 345, which IS the mechanism. It is also
the exact REVERSE of the refused price floor, which pushed toward the cheap, i.e. toward the survivors. The
blend of price and our own number also passes (+2.35% strict) and is half as good, and the two do NOT compose:
survival on top of the blend is +2.52% and 4/5, worse than survival alone - the same mechanism counted twice.
**A late auction favours whoever reads the played matchdays, and that is everybody.** The operator's
hypothesis - «holding the auction two rounds in should favour the surplus and the value» - has the right
mechanism and the wrong beneficiary: moving the target to the fantapunti from round 3 leaves our edge over the
price unchanged (+0.214 → +0.209, and +0.204 at six rounds), while the OBSERVED appearances are worth +0.443
over the price at k=2 and +0.536 at k=6 - the biggest signal in the whole campaign, and public. With the price
and the line-ups both known our value's edge falls to +0.170, the pv's to +0.127 and the surplus goes NEGATIVE
(-0.028). The uncertainty WAS our advantage. Consequence that is a requirement rather than a refinement: an
auction played after kick-off needs `engine_pv_pred` to READ the played rounds, which today it does not - it is
built on the previous season.

## A displayed list whose metrics describe a different list is worse than no metric
**Found and paid for within one hour, 05/08/2026.** The estimates were merged into the rows the auction panel
DISPLAYS while `captured`/`hits`/`predicted_rank` stayed on the gated list alone: the screen showed an estimated
man in 4th place and the statistics behaved as if he were not there, so the harness measuring the change printed
**+0.00% on ten windows out of ten**. It looked measured. The rule that follows: one chosen list per role, and
every figure of the block computed from it.
And then the real measurement, which **reversed a design decision made an hour earlier** (gate §7-undecies,
`python -m euroleghe_ingest estimates`): ranking the estimated men lowered the captured SURPLUS on **10 windows
of 10**, mean **−12.4%**, worst −30.3%, with the names in common falling too. The operator then decided, with that number in front of him, that
**measured and estimated go in ONE list with a filter** (`include` = all | measured | estimated): the cost is
his to accept, and the filter makes it reversible at every look instead of at every build. What stays
non-negotiable is the discipline around it - every figure of a block is computed from the list the filter
produced, and the gate never passes `estimates` at all. Two corollaries worth keeping: a platform where the core prices everybody (euro, R0c) returns 0
estimable and a +0.00% that is **not a PASS** - a window without a population confirms nothing; and the failure
mode is variance, not bias - Douglas Luiz predicted +28.6 and returned **−3.2**, Rugani never played, while
McTominay predicted +16.0 and returned **+50.2**.

## Every player must have a number, and the number must say what it is worth
**Operator's rule, 05/08/2026: «ogni calciatore DEVE avere il suo SURPLUS altrimenti è impossibile valutarli
oggettivamente ... penalizziamo il SURPLUS (l'indeterminazione è comunque una nota negativa) ma dobbiamo cmq
avere un valore di riferimento».** A blank is still a statement (below), but a blank cannot be COMPARED, and
an auction is nothing but comparison. So the sheet carries a fourth class of column beside `engine_*` (gated),
`desc_*` (measured) and `actual_*` (after the fact) — and since 19/08/2026 a FIFTH,
**`pi_*`** (Fπ's per-match value, see below): **`est_*`**, the fallback valuation — `engine/estimate.py`,
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

**A transform applied to HALF of a pair is a number that lies, and the uncovered half becomes the ranking**
(19/08/2026, from the operator's «come fa Arthur Melo ad avere 99 di overall?»). The `older` rung regressed the
fantamedia toward the anchor from 06/08 and handed the PRESENCES over raw — not even converted between the two
calendars — so 32 votes at Fiorentina in 2023-24 read as 32 matchdays of 38 for a man who has not played in
Serie A since, and the app's Overall being a PRODUCT put him FOURTH of the whole listone off a 6.34 of
fantamedia. Measured on the men whose old pv actually ships (nothing at t−1 on either platform AND no league
minutes abroad, because the abroad line answers first), leave-one-season-out, a quoted man who never played
counting as the ZERO he was: MAE 0.3749 → **0.2689** on default (n=221, 8 seasons, +28.3%, positive on 8 of 8)
and 0.3510 → 0.2993 on euro (n=48, 3 seasons, +14.7%). `est.OLDER_SHARE` and `OLDER_PV_BETA`, per platform
because the MECHANISM differs — on default «nothing measured at t−1» means *he did not play*, on euro *he
played in a championship we do not cover* — with euro's value declared FRAGILE (its three seasons want
0.90/0.00/0.55: the direction is identified, the value is not). Four things worth keeping past the rung.
**The cure that treats the SYMPTOM is the one to refuse**: discounting the Overall by `est_confidence` would
have fixed one column, left «98 di Presenze» beside it, and double-counted an uncertainty the screen already
shows in the stars' weight — the same «two patches, one defect» shape this file records elsewhere. **An
anchor measured independently landing on a number already in the file is evidence, not a coincidence**:
default's 0.29 IS the `unmeasured` constant, i.e. a man quoted here who played nowhere last season is, for
presences, a man nobody has ever seen. **A shrinkage that can only LOWER is not automatically a haircut** —
this one can, by construction, because the rung fires only above 15 votes, and the population's measured
outcome really is 0.29 of a season; saying so is the point, since the fantamedia's own regression pulls both
ways and presenting them as symmetric would be false. And **the same defect usually lives one rung further
on**: `shrunk` hands t−1's pv over raw on 108 rows against these 46, unmeasured, and its coefficients must be
its own. Numbers and the refused cures: `docs/model/letture-app-v1.md` §13, spec «Novità v9.56».

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

**The LEVEL of the football behind a man's minutes — adopted 06/08/2026, and the first candidate of that
session to earn it.** «Livello più alto puoi intenderlo anche con Premier > Serie A», and the data agrees:
mean ClubElo 1807 against 1610. Measured on 700 transfers controlling for the minutes AND the fantamedia — so
it is level, not quality in disguise — partial r +0.137, forwards +0.235. Swept on a pre-registered grid:
Serie A robust PASS (+0.93%, cross-fit picks 0.08 on 5 folds of 6), euro positive on all four windows (worst
+0.05%) and short of robust only because its mean, +0.46%, sits under the 0.5% floor. **Both pooled curves
have an INTERIOR minimum** — the condition every other candidate that week failed — so `level_weight` = 0.06,
euro's own optimum and 90% of Serie A's gain. Two things to keep with it: it applies only to men who CHANGED
club, because that is the population it was measured on; and `presence.py` is the PANEL's model, not the
engine's (`evaluate.py` does not import it), so this moves who the board draws and not one decimal of
`engine_*`. What it does NOT do is rescue the case it came from: Ramos gains +0.118 of standing, Kolo Muani
+0.026, and Gimenez nothing at all because he did not move.

**And a day later the same family gave a better answer: CHI SCENDE DI LIVELLO SALE DI RUOLO** —
`level_gap_weight` = 0.06, adopted 07/08/2026 (gate §7-duovicies). Born from the operator's question, «cosa
differenzia un giocatore acquistato per riempire la rosa da uno preso per giocare titolare?», with the
obvious candidate refused on an argument that holds: **the listone's Qt.I is not an objective value, it
already contains its author's opinion about the man's titolarità**, so predicting titolarità with it is
circular. The objective answer is not the level but the STEP — `Elo(club he left) − Elo(club buying him)`,
partial r **+0.220** at equal minutes against **+0.117** for the absolute level, i.e. what matters is not
the prestige of where he came from but the difference with where he goes. That is also why it is not R5 in
disguise: R5 read the destination Elo alone and was rejected four times. Serie A robust PASS, mean **+0.77%**
with the **worst fold POSITIVE** (+0.13%) and 0.06 chosen unanimously by all six folds; euro positive
(+0.35%) and under the floor. Second adoption without `passes` after R19, and less delicate than that one:
R19 was AGAINST on euro, this is merely small, and 0.06 is the optimum on both platforms rather than a
compromise. Both directions move — Esposito Se. +0.135 stepping down from Inter to Cagliari, Cheddira −0.117
stepping up to Napoli — which is what stops a shrinkage from being a haircut.
Three things that came with it and are worth more than the parameter. **A signal is judged against the
OUTCOME, controlling for what is already known — never against the RESIDUAL of a model that contains that
knowledge**: a rank correlating +0.204 with the residual turned out to be reproducing the model's own
regression to the mean, and the same idea scored +0.067 against next season's minutes while the minutes
already in hand scored +0.322. **An ambiguous name match is worse than a missing one**: stripping corporate
noise made «Paris FC» a subset of «Paris Saint-Germain» and priced three of Gonçalo Ramos's seasons at a
Ligue 2 club — hence `club_levels_xref`, where the club is resolved ONCE at ingest and every read joins by
the provider's team id (`external_stats.club_id`). And **a channel that passes need not rescue the case that
suggested it**: this one lifts Ramos by 0.075 and leaves him fourth, exactly as `level_weight` did.

**Two refinements of the same idea, both refused by measurement rather than by argument.** «L'esperienza si
accumula anche solo partecipando come panchinaro»: the bench IS in the data (the payload carries the whole
matchday squad — 58,161 starters, 23,275 substitutes who came on, 35,896 unused, and a man not called up has
no row at all, which is the «vuoto = ignoto» this needed), and the index `(minutes/90 + w × bench) × Elo`
peaks at exactly **w = 0** and decays monotonically — the bench term alone is −0.005. And «la qualità di
carriera»: flat overall (r +0.010), real only for forwards (+0.135), so it stays measured and unadopted. What
is missing is not a formula but an acquisition: European cups are too thin to weigh (Champions 2007 rows over
two seasons) and of national teams we have **nothing**.

**A within-season effect is not a between-season effect** (gate §7-duodecies, 06/08/2026). «Un giocatore con
SURPLUS maggiore acquisirà più visibilità agli occhi dell'allenatore e quindi minutaggio» — measured first, and
the mechanism is REAL inside a season: over 1758 (player, season) of Serie A, first half against second, same
club, controlling for the minutes he already played, the partial correlation with his fantamedia is **+0.100**
and the effect **+1.5 minutes per round per sd** (forwards +2.9, r +0.196). Swept between seasons on a
pre-registered grid it is **falsified on both platforms**: euro confirms 0.0 on all four folds, Serie A picks
the NEGATIVE step on four of six, mean −0.096%, and the pooled error climbs monotonically with the weight. The
applicability note written before the run is what happened — between June and August the coach, the shape and
the rivals all change, and what he learned watching does not survive the summer. Also: state it on the
FANTAMEDIA, never on the surplus, or the presences re-enter the standing that produced them.

**Third instance, found by the operator on a number that looked wrong (06/08/2026).** «Mi sembra troppo basso
il SURPLUS di Kolo Muani» — −9.9. The `other_platform` rung of `engine/estimate.py` substitutes the same
season from the other platform, worth mean +0.001 and 92% within 0.3 — measured on 870 player-seasons with a
full season on BOTH, i.e. Serie A men, for whom euro and default are one season seen from two calendars. Kolo
Muani's euro 2025-26 is TOTTENHAM. Substituting it into a Serie A sheet is not that rung: it is a foreign
fantamedia, which is R1, refused by the gate on five windows of six. Eligibility is now the roster's own
league, read from the data (on a euro sheet the other platform IS Serie A and always qualifies). 13 rows of
651 move, and the defect erred BOTH ways: Kolo Muani −9.9 → +17.8, Gonzalez N. +17.8 → +7.2. Six of the
thirteen were the same defect one rung down — `shrunk` blending a THIN foreign season with an Italian club's
level (Stones: 3 Premier votes against Inter's defenders). Lesson worth the repetition: the population a
transform was fitted on is part of the transform, and «he has a season on the other platform» and «he played
the same football» are two different sentences.
**And the first fix was incomplete, which three words exposed: «dove gioca Ramos?»** Gonçalo Ramos has never
played in Serie A (PSG 2023→2026), so `other_platform` refused him and `older` then handed over his LIGUE 1
season as «his last measured season» — 7.50 and +22.5 of surplus on a Serie A sheet. Same foreign fantamedia,
one rung lower. Both rungs now carry the same competition test, and a man who never played here lands on the
ANCHOR, which is what the gate preferred to R1 on five windows of six (Ramos → 6.52, surplus 2.3). When you
find a rule applied outside its population, check the rung below it: a cascade fails in the same way twice.

**A measured fantamedia is not a prediction, and the estimate has to say so too** (06/08/2026). Asked whether
a returner's old FM is comparable to a man who never left, measured on Serie A seasons predicting t from t−2
with an out-of-sample anchor: returners MAE 0.407 (n=203) against 0.395 (n=1264), same best β — so YES, the
year away costs 0.012 and an old fantamedia is as good a reference for one as for the other. The same table
answers a question nobody asked: RAW it loses to the plain role anchor (0.369 / 0.376) and both lose to
anchor + β(FM − anchor) at 0.326 / 0.336, β 0.40, the shape the core already uses on `fm_prev` (its own
`beta_mantra` is 0.397 / 0.446). It is also biased UPWARD for exactly the men the rung serves: +0.079, +0.144
for forwards. Hence `estimate.regress`. It pulls BOTH ways and that is the point — Ramos 7.50→6.91 down,
Vasquez D. 4.61→4.88 up and his surplus 13.2→20.4; a shrinkage that only ever lowered would be a haircut.

**A sheet cannot say whether it is stale, so make it say it.** `generated_at` records when a folder was
written, never whether the code that wrote it still computes the same numbers. `manifest.sheet_revision`
(`snapshot.SHEET_REVISION`) is bumped whenever a change moves a value the sheet CARRIES and left alone for
anything cosmetic; a folder below the current revision is to be rebuilt, and one without the field at all is
revision 0.

**A test whose fixture is a user-editable file is testing the user.** The smoke test read the repository's own
`league_config.json` and asserted 8 teams — so it broke the moment the operator declared his league from the
panel (12 teams, euro/mantra), which is a supported thing to do. It now points `Config` at a path that does
not exist, which is what «the built-in fallback» actually means.

Two more of the same family, both from the same session:
- **A rule that selects a population has ONE definition, read from both sides.** The panel's ⧖ mark and the
  module's fetch queue are the same question (`recent_form.awaiting_data`, one function whose `measured`
  parameter says which side is asking). Two copies would be two populations, and the mark would stop meaning
  "this is what is being fetched" — including the case that matters, a man whose window was already fetched
  ELSEWHERE, whom a second definition would keep marking as waiting.
  **The costliest instance so far, 07/08/2026: a fallback that is CORRECT for one caller is SILENT for
  another.** The replacement levels come back keyed on the vocabulary the game is played with (`por` … `pc` on
  mantra), five points of the code asked for them with `role_classic`, and every one of them took the
  documented «no level ⇒ fall back to VALUE» branch — right for the gate, which prepares its windows without a
  league on purpose, and mute for the panel, which has one. So the euro sheet's SURPLUS *was* its VALUE:
  `engine_replacement_fm` 0 of 1031, and since the level is not an additive constant but changes per role,
  1 or 2 of each role's top ten survived the correction. Three habits come out of it. **An asymmetry between
  two artifacts running the same code is a key that does not match** — nothing else produces it, and it is the
  cheapest thing to look for. **A number must say what it is measured against** (`engine_role_slot`), or the
  row cannot explain the column next to it. And **correcting a common fallback exposes what it was hiding**:
  once the levels arrived, the men the listone does not carry still had none — no mantra code, no level — and
  11 of the sheet's top 12 rows were estimates carrying a VALUE in a column of surpluses. One definition now
  (`snapshot.auction_level`), read by the sheet, the rank, `est_surplus`, the panel and the harness.
- **A dated reading is never filed under a date that has not arrived.** `elo.auction_dates` offered the
  conventional 15 August for the newest season, which during the PRESEASON has not happened, so the whole
  2026-27 window read the 2025-08-15 snapshot — a club's strength a season and a transfer window ago, which is
  what `desc_level_elo` (R19) and the club card are built on. Until that day is past, today's own date goes in
  instead. Same family as «vuoto = ignoto»: the fact was not missing, it was silently the wrong one.
  **And asking who reads a table is how a claim repeated for weeks turned out to be false**: the goalkeeper
  module does NOT read `club_elo`. `predict_fm_goalkeeper` takes the conceded rate from measured
  `season_stats.goals_conceded`; the 50/50 persistence+Elo mix that `clubelo-gate.md` adopted in Colab (M2 →
  M2e) was never ported — the NAME travelled and the Elo half did not, recorded in gate §3-quinquies (a) on
  27/07/2026 and left standing in four comments, the export contract and this file until 07/08/2026. A use
  nobody checks is a use nobody can correct: `elo.py` now opens with the audited list of its readers.
- **A parameter is never adopted at the edge of its grid.** The conditional-investment channel passes robust on
  Serie A (+0.79%) and stayed at zero because every fold picked 0.5 out of 0.5. **The follow-up has since been
  run** (05/08/2026, `investment_unplayed_value_wide`, grid to 3.0): on Serie A the winner is **0.75 —
  interior — still robust, mean +0.56%**, while euro does not pass (+0.34%). So the procedural reason for the
  zero is gone and what remains is a platform-dependent decision; cite the report, not this line. Widening a
  grid after seeing the curve is still the other way of fitting: it goes in the pre-registered follow-up.
  Corollary found 06/08/2026 while asking why two big signings are in no typical eleven: **the arm that passes
  is blind on the men it exists for.** It reads the INPUT season's market value, and Gonçalo Ramos has none at
  all (196 of 975 euro rows lack `value_share`, 17 of them arrivals), while Kolo Muani's reads 20M against
  Gimenez's 18M — equals, in the summer one of them cost 41.2M. The signal that would see them is the FEE
  (54% and 27% of what their clubs spent) and the new quotation (percentiles 0.95 and 0.94), and the fee arm
  has only three windows because fees exist from 2023. Fix the input before tuning the weight.
  **DONE, and the answer is no** (16/08/2026, gate §7-untricies). The input was repaired — the market value
  is now the last point of his CURVE on or before the auction day, and the acquisition was widened because
  «quoted today» is a SURVIVORSHIP filter that covered 7% of Tm7's quoted men and 60% of T2's, a coverage
  correlated with the very outcome the channel predicts (77-97% and flat after, `market --all-seasons`).
  Re-swept on the untouched grids: Serie A's `value_weight` goes from +0.14% to **+0.26%**, with an
  INTERIOR pooled optimum (0.3), a cross-fit unanimous on 5 folds of 6 and **every fold positive** - and
  still under the 0.5% floor, so it stays at zero. The CONDITIONAL form is now actively worse (−0.12% euro,
  −0.30% Serie A): where the minutes are missing, the market value does not replace them. Two habits the run
  is worth keeping for: the attribution was verified at ONE variable (60 parameters compared with the report
  of eight hours before, **8 changed and all 8 are the value family**, no adopted parameter moves); and what
  would reopen this is not another measurement of the same kind but the WAGES, which is what §7-quinquies
  had already declared.

## Quello che è già successo non si prevede — e l'app può viaggiare nel tempo
**16/08/2026, e sono due facce dello stesso problema.** Un'asta giocata a stagione iniziata è l'esercizio
più redditizio che il gate abbia mai misurato (**R20**, §7-duotricies: +28% di MAE sulle presenze a
febbraio, +10% a settembre) e anche il più facile da misurare male: con la data d'asta DENTRO la stagione
bersaglio, l'esito contiene le giornate che il modello ha appena letto, e un canale che le ricopiasse
sembrerebbe bravissimo per una parte di stagione già successa. Quindi una finestra **in-season**
(`features.INSEASON_WINDOWS`, tenute fuori da `WINDOWS` così nessuna corsa di default cambia significato)
ha per bersaglio le presenze **dopo** la data, per input `Observation.pv_seen` — l'unico pezzo della
stagione bersaglio che sia lecito leggere, perché quel giorno era pubblico — e per denominatore le
giornate che **restano**. La giornata **a cavallo** della data esce da tutt'e due i lati: non è vista (non
era finita) e non è esito (era cominciata), e senza quella cura il risultato era gonfio di sei punti.
La regola è inerte a `k` = 0 per costruzione, quindi tutte e dieci le finestre pubblicate restano ferme.
**ADOTTATA il 16/08/2026 con un K per PIATTAFORMA** — `R20K10` su `default`, `R20K6` su `euro` — perché
l'evidenza è per piattaforma come lo era per R19: su euro il 6 supera tutte e quattro le guardie e il 10
perde un nome in cima su una finestra di tre, su Serie A è l'opposto. L'accuratezza invece è unanime
(3/3 finestre su ogni punto di griglia e ogni regime, da +3,8% a +29,2%), e la guardia che decide è
sempre quella sui NOMI, che è un conteggio su dieci: quando le guardie si dividono, la decisione si
prende in chiaro e si scrive. **Il PANNELLO non la legge ancora**: `presence.py` non importa `evaluate`,
quindi lo standing che disegna la board e consiglia al tavolo ignora tuttora le giornate giocate - è la
stessa asimmetria di sempre, vista dall'altro lato.
Un difetto trovato lungo la strada e che vale oltre R20: **una soglia di scoring è una QUOTA del
calendario che si sta prevedendo, non un numero**. `MIN_PV_ACT` = 15 è il 39% di una stagione da 38; su
una finestra in-season restano quattordici giornate, quindi quella soglia non è severa ma
irraggiungibile, e la guardia sulla fantamedia **smetteva di misurare** invece di fallire - col gate che
contava «non verificata» come «peggiorata» e bocciava una regola da +23,7%. `evaluate.scoring_floor`
tiene la quota; sulle pre-stagione non cambia di un'unità.

**L'app fa lo stesso viaggio, e la sua onestà è metà della funzione** (`core/time-travel.ts`,
`ui/time-machine/`). Ritaglia da sé tutto quello che nel bundle è datato — strato per-partita, infortuni,
ruoli, stagioni chiuse — mentre il MOTORE di una data passata non si ricalcola: lo costruisce il toolkit
(`timepack`, che gira `snapshot --date` sulle leghe dichiarate) e viaggia nel bundle, ~1,3 MB a data,
perché con la data cambiano solo i fogli e i campetti. **Le date sono poche e scelte** - il giorno dopo
ogni finestra di mercato delle ultime due stagioni - e non si leggono dai trasferimenti: misurato, tutte
le 5.371 righe di `transfers_history` portano la data del **1º luglio**, che è un diff fra rose e non un
registro datato. Tre cose non tornano indietro nemmeno col pacchetto (probabili, ruolo granulare,
scadenza di contratto) e il box **le scrive a schermo**: un viaggio nel tempo che ne retrodata metà in
silenzio è peggio di nessun viaggio nel tempo.

## Every column has a DECLARED name, and each name is one question
**The operator's definitions, dictated 18/08/2026, and they bind everywhere.** They are his to decide -
they are what he reads at a table - so they are recorded here and not re-derived per screen:
- **`Overall`** = absolute judgement of a man's return, 0-99, `Pv x (MVa + expected bonuses)`, with NO
  zero subtracted (that measurement is `letture-app-v1.md` §9: with the mantra-role replacement the
  role medians read P 77 / C 56 / D 46 / A 11 and 14 of the top 25 were goalkeepers).
- **`Lead`** (ex «Valore») = the points he would add to YOUR squad over his replacement, i.e.
  `Overall - replacement`, the zero being the roster-marginal man of a ten-team league
  (`engine_replacement_fm`) and the estimate's confidence penalty still applied.
- **`Margine`** = the same subtraction against the FIELDED zero (what your bench is actually worth,
  `desc_replacement_fielded`). Two zeros are two questions, so they get two names and never one -
  the rule «the zero of a metric is a question» applied to the vocabulary.
- **`Bonus`** = the bonuses ALONE (`FMa - MVa`), so `Overall`'s own formula can be read off the row.
  Until 18/08 the column carried the fantamedia, which made the header a false statement about the
  arithmetic beside it: a name that does not match its number is worse than a missing column.
And **one pitch drawn by one component** in both the auction and the Squadre screens, where an item is a
PLACE and not a man (the real role it asks for on top, the men disputing it below, each in ONE place
only): `docs/model/formazioni-tipo-v1.md` §6-quinquies, with its measured floors.

## A COLUMN THAT FORECASTS is not a column that sums, and its scale is not its measurement
**19/08/2026, from a coherence check the operator asked for**: «the players with a high FVM should more or
less have a high OVERALL». The divergence is systematic and not an arithmetic error — **Overall is a TOTAL
with no zero**, so it rewards whoever plays every week at 5.8 and leaves behind whoever has never played in
Italy, for whom the sheet falls back to the role anchor, while the FVM is a judgement about the NEWS. Hence
**Fπ** (`engine/projection.py`, sheet columns `pi_*`, the fifth class): `presences × (value of one of his
matches + calendar − replacement)`, with Overall left **untouched** at his request («keep it a simple
mathematical term»). Three parameters, all measured out-of-sample although no gate owns them (§7-septiestricies).
Five things it settled that outlive the column:
- **The synthetic history is padded, not refused.** «At least ten plausible matches» is true to the letter
  because below ten the missing ones are the ANCHOR, so at zero matches Fπ *is* the anchor — no extra branch,
  and the row says how many are his.
- **A calendar term is a DEVIATION, never a level.** A club's average margin over the whole season IS its
  strength, and that is already inside its players' measured fantamedia; applied as a level it would pay
  every Inter player a permanent bonus. Over a full round-robin the term is exactly ZERO by construction —
  which is also the truth about a calendar — and only a short window moves it.
- **A rival is a SHARE, not a yes or no.** Whether a signing plays is answered by what the club spent on him
  *relative to whoever disputes his shirt*, and the peer group weighted by per-match positions
  (`tm_appearances.position_id`, the only HISTORICAL granular position here) beats the one built from the
  macro-role, which reads a left winger as a full rival of a centre-forward (−0.6%, worst window −7.3%).
- **An anchor defined by the column it is scaling moves by itself.** The 50 is the mean of the top 250
  chosen by OVERALL and averaged on Fπ: with one column doing both, every retouch of Fπ shifts its own
  reference. A test holds it.
- **A scale is presentation and lives where the POOL is known** — in the app — while the value of a match is
  a prediction about a person and lives where the harnesses are. The reference copy in `engine/` had already
  diverged from the shipped one within the hour (two straight segments against a curve), so the test now
  reads the TypeScript constants instead of copying them: two definitions eventually give one man two numbers.

**And two measurement defects of a kind worth naming.** `model.fractional_anchor` wants the TUPLE of mantra
codes and was handed the raw listone string `"dc;ds"`, which iterates CHARACTERS — and `c`, `b`, `e`, `m`,
`w`, `t`, `a` are all valid mantra keys, so the anchor was not missing, it was **another role's**, and a
plausible story had already been written around the wrong number. **An ambiguous join is worse than a
missing one, and the argument of a call is a join too.** Then the calendar coefficient for keepers read
−0.006 measured on a reconstruction that has no goals-conceded term; on the real fantavoto it is **+0.175**,
the highest of the four roles — «verify the FUNCTION, not the column that looks like it», fifth instance.

## A number on the card is a MEASUREMENT or a FORECAST, and the two never share a figure
**19/08/2026, and the operator moved the same vice twice in two days.** The pitch chip carried
«minutes per club match» - a measurement times a prediction - and on 18/08 it became the plain measured
average, «minuti totali stagione scorsa / partite giocate», because the product «mescolava una misura e una
previsione in un numero solo». Then the right question: that average describes the season that ENDED, and
what is being bought is the one that comes. So the chip is now a declared FORECAST (`engine/minutes.py`)
and the measurement sits in the tooltip **with its name**, next to the two other averages that have other
denominators - three labels, never a naked figure.
His own proposal for it was refused by ALGEBRA before any measurement: the claim IS last season's minutes
(`standing_weights` = (0,1)), so `perMatch × claim_now / claim_prev` cancels the minutes and leaves
`90 × rounds × claim / matches` - measured, **−59% and −55%** against changing nothing, and a test keeps
that arithmetic so nobody proposes it again. What ships is `C + P × (S − C)` with S and C measured over
247,825 appearances, and a P that is 70% the MEASURED start-per-appearance rate and 30% the model's, in
that proportion because the model's forecast of it is measurably WORSE than the measurement (MAE 0.234
against 0.200). Verdict on two back-dated pre-season sheets, criterion written before the run, parameters
cross-fit: **+7.5% and +7.6%**, no role losing, the keeper excluded because for him the measurement IS the
forecast. Two habits: **the regime of the judge is part of the judgement** - a pilot run on the time-travel
packs (dated after the fifth round, so they measure the season in progress) gave the opposite sign - and
the ceiling with the TRUE P is +74%, which says the form is right and what is missing is a forecast of
titolarità: that is where to go back, not to a bigger formula.
And where a rival is DRAWN is an assignment, not a per-man choice: the same day, «evitiamo posizioni con
tanti calciatori in alternativa e posizioni senza alternative» turned the dedup rule into one allocation
over the whole pitch (real-role fit dominating, a convex crowd price, a price for moving inside the line),
and the empty places went 126 → 91 on Serie A and 218 → 165 on euro with the same men drawn.

## Conventions
The knowledge base lives in git under [docs/model/](docs/model/) (canonical; git handles versioning);
Drive is a mirror/archive, updated ONLY on the user's explicit request. When the user says **`chiudi`**,
consolidate all `docs/model/` docs (and this file if conventions changed) with the current
state/decisions/commits/next steps, then commit — so a new chat resumes with no lost context.
