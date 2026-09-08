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

## «TITOLARITÀ» has ONE meaning here, and it is not the common one
**Operator's definition, 20/08/2026, and it binds every file:** «nel linguaggio comune "titolarità" è il
fattore che indica se un calciatore parte dall'inizio in campo, nel nostro progetto invece dobbiamo usarlo
per indicare che un calciatore **gioca abbastanza da prendere il voto** (anche se non parte dal principio in
campo)». A fantacalcio squad scores what the votes score, and a substitute who comes on every week scores
every week - so the quantity the project is about is the APPEARANCE, and the word follows the quantity.

Two words, two quantities, and they must not be swapped:
- **titolarità** = the share of matchdays he gets a VOTO in, started or not. `presence.voto_share` (of every
  round) and `presence.appearance_share` (of the rounds he was fit for), `engine_pv_pred` on the platform's
  calendar, `desc_titolarita_play` on the sheet.
- **quota da titolare / who starts** = the share he is on the TEAM SHEET for. `presence.standing`, `claim`,
  `presence.presence`, `SnapshotView.starting_record`, `snapshot.starting_record`, `desc_start_share`. In
  prose say «parte titolare», «quota da titolare», «chi comincia la partita» - never the bare word.

The six-rung ladder (`engine/status.py`, `desc_titolarita`) is named in this sense: its axis is the
appearance share, and `titolare` there means «he plays almost every match, for most of it», not «he is on
the team sheet». **`titolarissimo` and `bandiera` are the operator's own vocabulary and are stored
untranslated**, the way `mantra_modules.json` stores `por` and `pc`: the repo is English, the game's own
words are not, and inventing an English `titolarissimo` nobody uses would be worse than the exception.

Cleaned up on 20/08/2026 wherever the word NAMED a quantity: `snapshot.titolarita` → `starting_record`,
`SnapshotView.titolarita` → `starting_record` (both docstrings say why), the panel's comments, and the
strings the app actually shows (`club-eleven.disagreementHint`, the pitch card's footer, `club-board`).
**Deliberately NOT rewritten**: the historical records in `docs/model/` - the gate, the continuity notes,
the todolists - where the word logs a measurement that was made on the STARTING share, and rewriting it
would alter the record instead of clarifying it. Those pages now carry a dated note saying which sense
they are written in; from here on the definition above is the only one.

## Six words for one shirt, and the drawing is a GATE
**20/08/2026, the operator's own ladder** — bandiera, titolarissimo, titolare, ballottaggio, panchina,
riserva — read as **two axes and not one**, which is how he wrote the six lines: a share of the matches and
a MINUTES floor, with the fourth rung dropping the floor. Both numbers already existed and neither is
invented (`presence.appearance_share` and `minutes.per_appearance`), so `engine/status.py` only says where
the two of them put a man. The joint reading — «>90% of the matches in which he plays at least 75'» — was
built FIRST and measured unusable: the predicted q75 tops out at 0.86, so `bandiera` is empty by
construction and `titolare` with it, and a Serie A sheet came out **10/0/0/184** on the first four rungs.
The share is CONDITIONAL, «of the matches he is fit for», which is what makes the state agree with the
typical eleven — `claim` is `standing` without the injury discount for the same reason.

**The board is a gate, and it is also the better classifier.** A man the eleven does not field cannot be
`titolare`; one it does never falls below `ballottaggio`. At the SAME claim, the men the board drew
realised a q75 of **0.512 against 0.328** for the men it did not: the fit knows what shape the club plays
and who else wants the shirt, and a share of a season does not. Without the gate a Serie A sheet showed 19
`titolarissimo` the board does not field and 83 drawn men called `panchina`.

**...E DALL'08/09/2026 IL CANCELLO HA UNA SECONDA META', DICHIARATA DA LUI: un uomo che la board disegna e
a cui NESSUNO contende la maglia e' `titolare` e non `ballottaggio`** — «Ballottaggio con chi???», trovato a
schermo su G. Ramos. Un contendente e' un rivale che la scala stessa chiama `ballottaggio` o meglio
(`boards.CONTENDER_RUNGS`: si cita il metro invece di inventare una soglia, come `ownsShirt`); toglie il
pavimento dei MINUTI e solo quello, non porta nessuno sopra `titolare`, non tocca chi la board non disegna
(li' il posto e' di un altro, che E' il suo contendente) e **ignoto non promuove**. Il canale che l'avrebbe
prodotta da sola e' stato MISURATO PRIMA e respinto sui suoi numeri — «quanto vale un vice che non c'e'» e'
+3,1' appaiato dentro l'uomo e +3,8' (t +1,7) come livello netto di quello che gia' giocava, contro i dieci
che servono per scavalcare il pavimento — quindi questa e' una DICHIARAZIONE e non un termine fittato.
**Il prezzo e' stato misurato prima e accettato guardandolo**: 76 dei 115 ballottaggi disegnati di Serie A
diventano `titolare` e 56 di quei 76 hanno una quota sotto lo 0,80 che la parola promette (il piu' basso
0,274). Le due varianti col pavimento sono respinte da lui e scritte a verbale: quella a 0,80 escluderebbe
il 76% degli ARRIVATI, la cui quota e' scontata da `ARRIVAL_DISCOUNT` (mediana 0,710 contro 0,909), cioe'
proprio la popolazione per cui la regola nasce. La riga lo dichiara (`desc_titolarita_contended`,
`SHEET_REVISION` 56). Numeri e confini: `gate-motore-v1.md` §7-quinquinquagies e seguenti.

Measured on four back-dated pre-season windows (two platforms x two seasons), against what those men really
did: `bandiera` and `titolare` keep their promise **4 times out of 4**; `titolarissimo` is the weak rung
(the residual between the other two, 0.7-1.0 men per club, 3 of 4). Three columns of the sheet
(`SHEET_REVISION` 35) written by the SAME pass that draws the boards — the rung reads the drawn eleven, so
computing it elsewhere could describe a different eleven than the one exported — and therefore **empty on a
machine with no display**, which is stated rather than filled in. `engine_*` does not move.

Three things stay on the record because they are the operator's to rule on, not measurements: the minutes
floor in ABSOLUTE minutes is not neutral between roles (a start lasts 84.5' for a defender and 78.5' for a
forward, so `bandiera` holds 11 keepers and 4 forwards); `titolarissimo` is small by construction; and a man
with NO football on file gets no rung at all rather than `riserva` — «vuoto = ignoto, mai zero», met again
and committed by whoever had just rewritten the rule (a keeper read `riserva` with nothing measured and the
engine expecting him in 29 rounds of 38). The guard lives in the ROW (`SnapshotView.play_share`) because
`presence.Inputs` stores appearances as a float and an absent column and a measured zero arrive identical.
Numbers, the refused readings and the open decisions: `docs/model/letture-app-v1.md` §16.

## Reading order for a new session
The knowledge base now lives in **git** under [docs/model/](docs/model/) (Italian, source of truth; Drive
is a mirror/archive). Before any work read, in order:
[docs/model/00-BRIDGE-punto-di-ingresso.md](docs/model/00-BRIDGE-punto-di-ingresso.md) ->
`stato-progetto-continuita-v5.md` -> `todolist-mantra-euroleghe-v5.md` -> **`gate-motore-v1.md`** (the gate
protocol, every verdict and every falsified hypothesis: read it before proposing any rule) ->
**`copertura-eventi-motore-v1.md`** (06/09/2026, the index BY EVENT: for each thing a fantacalcio player
names — a change of shape, a set-piece duty, the Africa Cup, an ageing curve — whether the engine reads
it, whether the PANEL does, or whether it was measured and refused, with the number. Read it before
proposing a channel: the answer is usually «measured, and here is what it cost») ->
**`metrica-asta-surplus-v1.md`** (what the Auction panel ranks by, and why it is not VALUE) ->
**`assistente-asta-v1.md`** (what the assistant does with it at the table: three questions, three
numbers, the UI rules that are requirements, and the SLOT BOARD) ->
**`simulatore-asta-rilanci-v1.md`** (the fifth bench: HOW TO BID at a raise-and-draw auction, 28
sections — §28 is the live list of open items and supersedes §20.2; read it before proposing an
auction strategy) -> **`letture-app-v1.md`** (the app's five 0-99
columns: reporting, ungated, every threshold measured — and the alternatives that were refused, with
their numbers) -> **`todolist-draft-v1.md`** (the DRAFT improvement
plan born from the 10/08/2026 five-window strategy campaign, ordered by measured yield; its standing
results: role coverage beats the currency tenfold, the surplus is the wrong draft currency, playing
for first pick is ruinous) -> `spec-euroleghe-ingest-v9.md` -> `nota-modello-set-pieces-v2.md` -> `modello-previsionale-v3.8.md` ->
the consolidated notes in the same folder. For BOARD work (typical elevens): `formazioni-tipo-v1.md`
(how the board is decided — shape, claim, fit, with every constant) and `todolist-formazioni-tipo-v1.md`
(the improvement plan born from the 08/08/2026 press comparison, ordered by measured yield; its standing
rule: the press is a JUDGE, never an input of the claim). For the SEALED-BID page (`/sealed-bid`, the
third game): **`todolist-buste-chiuse-v1.md`** — the league's own regulation, what the page does, the
round-1 measurements, and the operator's three declared rules; closed on 25/08/2026 for everything that
depends on code, so what is left there is measurement and acquisition. See «A sealed bid is a third
game» below.
For the STRATEGY page (what is prepared BEFORE sitting down): **`pagina-strategia-v1.md`** — the league
settings, the currency per auction type, how many names a role needs, and the two REFUSED forms of the
«most defensive place» rule with their numbers. See «A list per role cannot express a joint constraint».
For the RAISE AUCTION seen from the STRATEGY side — not «whom to buy» but «how to bid»:
**`simulatore-asta-rilanci-v1.md`** (01/09/2026), the fifth harness and the championship over it.
See «A fifth harness» below.
For a roster built for a HANDFUL OF MATCHDAYS instead of a season — a SECOND classic competition, 250
credits on the Qt.A, its own modifiers, five substitutions and a SWITCH that fires on starting:
**`rosa-3-giornate-v1.md`** (03/09/2026). It also carries the four platform-club defects it found and
the calibration of the editorial page onto P(vote) and P(starts). See the two sections near the end.
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
  the 81 among the errors. **And a module that says «skipping» is reporting a zero** (24/08/2026): the
  per-match layer answered «no euro ratings yet - perimeter unknown, skipping» and exited 0, so the whole
  first round of the new season could not be downloaded - and the acquisition was launched THREE times
  before anybody called `perimeter_club_keys` and saw the empty set. The corollary is procedural, not
  mnemonic: **an audit that reports a suspicious
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
**(FIVE since 01/09/2026 — `bench/auction`, below.)** **17/08/2026.** `backtest` judges RULES, `sweep` judges CONSTANTS, `bench/draft` judges POLICIES - and
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
the real one with `EUROLEGHE_DATA_DIR` **e anche `EUROLEGHE_DB_PATH`, e questa riga senza il secondo
era FALSA** (misurato 07/09/2026: `config.db_path` ha la sua variabile, quindi con la sola DATA_DIR un
worktree apre un database VUOTO e risponde «no rosters in the DB» - un errore fortunato, perche' una
variabile che sposta i dati e non il DB puo' far misurare su meta' stato credendo di leggere il vero)
and you are back to one write lock, or copy the 49 MB and the two
sessions measure on two different databases, which is worse than a lock. So the rule has a second half that
is not a git feature: **one session owns the DB** (acquisitions, `snapshot`, `export`) and the other works on
the app, the docs, or read-only.
**And a third half, paid for on 27/08/2026: two sessions edited ONE view.** While one was adding the manual
order to `views/strategy/`, the other moved the league settings into `core/global-options.ts` and deleted
that page's settings modal. The two merged well — both used anchored patches, and the second even reused the
first's types — but for two hours the shared tree **did not compile** (a half-finished refactor left two
constructors in `valuation-store.ts`) and the e2e harness read 15 failures that were all downstream of one.
Three habits: **verify in a WORKTREE on HEAD plus your own files**, with `node_modules` and `public/data`
attached by junction (`mklink /J`, removed with `rmdir`, which takes the link and not the target) — it is the
only way to have a green gate while the shared tree is mid-someone-else's-work; **never commit another
session's file**, and never commit your own half that cannot compile without theirs (the view stayed out, the
`core/` half went in); and **leave the harness RED where the defect is real**, naming the cause — here a
button that calls `GlobalOptions.open()` while the panel opens on its own signal, which the harness pinned
down not by reading code but by measuring `hasModalHost: true` with `containers: 0`.
**Same view again on 01/09/2026, and this time it cost a feature its commit.** One session added the
«Costanza» column to `squad-table/` and `player-ratings.ts` while the other added «Categoria» to the
SAME three files (plus `letture-app-v1.md` §20) — merged cleanly, both anchored, and one of their
comments even landed INSIDE the other's block. So the rule bit as written: the toolkit half (the whole
of `bench/auction`) went in and the app half stayed out, named in the continuity note rather than
half-committed. Two things worth carrying: **authorship is measurable** (`git diff | grep` for each
feature's own vocabulary answers «whose is this file?» in one command, and the answer here was «both»),
and **a spec cannot go in without its implementation** — `player-ratings.spec.ts` was exclusively mine
and still had to stay out, because committing it alone leaves the repo RED.
**And then the operator said «committa tutto», which is his call and turns the rule into a different
one.** Owning both sessions, he can decide the shared tree goes in as it stands; what does NOT transfer
with the decision is the reason the rule exists, so the answer is **measure before committing somebody
else's half rather than trusting it** — 541 app tests over 35 files and 592 toolkit tests, green, i.e.
the two halves really do merge. Two duties come with it and both are cheap: the commit **says it carries
two sessions' work** and which half is whose, because a history that hides that cannot be bisected by
whoever wrote neither; and a debt DECLARED inside the other half is inherited out loud (here their own
`letture-app-v1.md` §20 says the `backtest --verify` for sheet revision 38 is «dovuto e non ancora
fatto», the DB having been under a write lock). **Committing somebody's work is adopting their open
items too.**
**Seconda istanza il 03/09/2026, e stavolta la procedura ha retto.** Di nuovo due sessioni sugli stessi
file (`plancia.ts`, `plancia-store.ts`, `slot-matrix.ts`, `pull-bundle.mjs`): la metà accoppiamenti-
portieri e la metà «chi oggi non gioca». Quello che si aggiunge alla regola è **come** si misura
l'autorship, perché è la domanda che si fa per prima e ha una risposta in un comando: un `git diff |
grep` per il VOCABOLARIO di ciascuna feature, file per file, che qui ha separato le due metà e ha
trovato i quattro file condivisi. Poi l'albero combinato ai gate di tutt'e due (637 test toolkit, 593
app, cinque banchi e2e verdi) invece di fidarsi. Il commit nomina le due metà e dichiara il debito
ereditato: `injuries.observed_on` è nello schema e nella migrazione, ma il DB vivo non è migrato e il
bundle non la porta — la metà app legge `availability`, quindi niente è rotto e il valore arriva dopo
una corsa di `injuries` e un `export`.

## A FIFTH harness, and a RANKING BY TOTAL is not a TABLE
**01/09/2026, `bench/auction` + `bench/auction/league.py`, details in
`docs/model/simulatore-asta-rilanci-v1.md`.** `backtest` judges RULES, `sweep` CONSTANTS, `zeros` the
ZERO, `bench/draft` DRAFT POLICIES — this judges **how you BID** at a raise auction: how much, for whom,
in which department, against five profiles the operator dictated. It re-predicts no footballer (the Qt.I,
`fm_pred`/`pv_pred` cross-fit on an adjacent window, and the realised fantavoto AND base vote come from
the engine), so `engine_*` and the sheets do not move a decimal.

**Where a place can be EMPTY, the worth of a man has TWO terms that are ADDED, never multiplied.** The
surplus answers «how much better than the man who would play instead», which presumes somebody plays; in
this league nobody may, and **a single deputy vote annuls both modifiers for the whole matchday**. The
first version of the engine arm bid on the surplus alone and finished **last of eleven** with 284 credits
of 1000 unspent; with `surplus + cover_value` (holes avoided × `HOLE_COST` = **4.73**, the slope over 110
squads at r = −0.798, and the regulation's own arithmetic agrees) it wins by **+122 points** with the
lowest dispersion of the table. The general form: **a metric that assumes the thing happens cannot price
the risk that it does not.**

**And a table is not the ranking by total, which is why the calendar was worth playing.** The goal ladder
truncates at 66, so **in 4 windows of 10 the champion is not the top scorer**: over 100 rows, table points
correlate +0.833 with the season total and **−0.825 with the matchdays left under 66**, which in turn
correlate +0.701 with holes. So coverage pays TWICE and neither road goes through whoever you buy at the
top — a quantity no amount of staring at the seasonal mean could have produced, because the bench was not
settling the thing the way the league settles it. **Score the deliverable the way it is actually decided.**
One number not to misread: table points against credits spent reads −0.177 and is CONFOUNDED by profile
(the engine spends least and wins most) — a difference between groups, not a virtue of saving.

**The value of a THRESHOLD cannot be written on a row.** The R-Factor is gone at four insufficient men, so
the fifth steady player in a squad that already has four unreliable ones is worth nothing and the fourth
is worth half a point: it is a Poisson-binomial over the ELEVEN (`expected_r_factor`, computed exactly),
never a per-man figure. That is what refused the operator's own request for a steadiness term, on a
diagnosis that was RIGHT (the arm banked 6.5 of R-Factor against a rival's 20.5, and neither the surplus
nor the appearances contain the BASE vote): one man moves the R-Factor by **+1.5 points a season** against
a `cover_value` reaching 180, and the modifier is governed by HOLES (r = **−0.821**, 13.6 points for the
quartile with fewest against 2.1 for the most). **On the current code it is INERT** — at weight 0, 1 and 5
the arm reads the same figure to the decimal, because the department ceiling binds before the term can
reorder anything; it bites only at 20 (0.08%, an order of magnitude under the floor) and collapses at 100.
Kept at zero with the numbers beside it — **what would make it pay is a squad with no holes, and no
strategy on this bench gets there.** Its sibling ADOPTED the same day is the operator's diversification across real clubs
(`CLUB_FREE` 2, `CLUB_PENALTY` 0.45): 4.1 points of cost, **4.4% off the dispersion**, agreeing with
`metrica-asta-surplus-v1.md` §24 measured from the other side — and stated plainly, **this bench cannot
see the benefit it buys**, because its sd is across seasons and the risk removed is within one.

Four habits that outlive the harness, and three were paid for.
- **A rule that applies to every profile but the one being judged is not a rule.** «Nobody ends an auction
  with credits in his pocket» was enforced on the five human profiles and not on the engine arm, whose
  branch returns before it: 888 of 1000 against a table spending 956-1000. **And the first cure was
  half a cure** (found in the review of 02/09): the arm's own per-department CEILING was still eating the
  floor, so it kept 67 credits while the table kept 0-20 — a ceiling is a rationing device, and rationing
  a purse that can no longer be spent on anything else is waste. Worth +6.7 points and half a place. Note
  the direction both times: the defect PENALISED the arm being judged, so every margin published before
  it was conservative rather than flattering — **the direction of an error is part of the error.**
- **A DECREASING LADDER IS A RATIONING PLAN**, so giving one to a profile defined as having no plan hands
  it discipline under a misleading name — it was why the novice beat the expert, which is what the operator
  spotted from the result. Flat, his holes went 32.7 → 43.8. **Model the declared behaviour, not a tidier
  version of it.**
- **A tie broken by a NAME is a latent bias, and latent is exactly when to fix one.** Bids that tied were
  awarded alphabetically — invisible while participants are called after their profiles, an outright
  advantage the moment they are named A...L. Measured before switching to a reproducible draw per
  (participant, man): the order of the six profiles does not change, so nothing published moves.
- **One definition, two readers**: `bench.matchday` was extracted from `season` because the championship
  needs it per ROUND. Two definitions of «what did this squad score on matchday 12» would eventually give
  one squad two totals, and the first place anybody notices is a standings table.

**Three more from the REVIEW of all this, 02/09/2026** (`simulatore-asta-rilanci-v1.md` §13 has the
table of eight findings; five were in code or docs shipped the day before).
- **When two numbers come out of ONE function and only one reproduces, the culprit is the INPUT.** The
  «+2.4 points of R-Factor for one man» published in six places does not reproduce — the same construction
  gives +1.5 — while its companion, «+10.8 in the impossible extreme», reproduces EXACTLY. That asymmetry
  is what located the error in the quantile rather than in the Poisson-binomial, and it cost one run
  instead of an afternoon of reading.
- **To tell a SMALL effect from a DEAD channel, give the weight an absurd value.** The steadiness term
  read identically at 0, 1 and 5 — which looks like a broken harness — and at 20 it moves (+0.08%) and at
  100 it collapses. So it is not weak, it does not ARRIVE: `role_cap` binds before it can reorder a bid,
  and the term itself is worth 1.8 points inside a worth of 149. A channel that does not move at twenty
  times its weight is a channel to explain, not to tune.
- **Where a decision is marginal, publish the MARGINAL number.** A shipped comment priced steadiness at
  «27 points of R-Factor, more than a top striker's surplus»; measured, it is 18.8 and it describes an
  eleven where ALL ELEVEN men sit at their role's p90 — a squad nobody can buy, because buying it costs
  the coverage. The number that decides a purchase is +1.5 for one man. An aggregate that requires an
  unbuyable squad is not an advantage anybody can act on.

**And one of those eight findings was WRONG, which is why a review gets verified like anything else.** It
read as an inconsistency that a template writes `man.rating?.steady?.share` while the TypeScript writes
`man.rating?.steady.share` on a field the interface declares required — and the "cure" does not compile:
`TS2532: Object is possibly undefined`. **Angular's template `?.` is not TypeScript's `?.`**: it
short-circuits the immediate access only, not the rest of the chain. Two dialects, not two opinions. So:
**a difference between a file and its template is not necessarily a decision nobody took** — before
unifying them, ask whether they are the same language. Caught by the compiler in seconds, which is the
argument for running the suite after a review's fixes and not only after a feature's.

**And three about verifying a rendered page, all the same shape as the app's own harness lessons.** A step
that measures TWO unknowns attributes the defect to the wrong one (one selector counted the standings AND
the twelve dearest buys, read 22 rows and blamed the page). **Headless Chrome defaults to DARK**, so the
first run compared the dark ground with itself and declared broken a theme that worked — both media states
have to be asked for explicitly, since the untold one is what most viewers see. And `document.fonts.check`
is the wrong instrument for «is this face painting»: the computed `font-family` only echoes the
declaration, and what decides is the WIDTH of one string in the face and in its own fallback. What no
count could see, the SCREENSHOTS found: a roster card clipping its last column (`overflow:hidden` plus an
auto-layout table, the same family as the app table's «276px of columns not narrow, ABSENT»).

## ...and the same bench on a RANDOM EXTRACTION, where the ORDER stops rationing for you
**02/09/2026, on the operator's own auction: «l'asta che dovrò affrontare sarà ad estrazione RANDOM del
calciatore che andrà in asta».** Details and every refused variant: `simulatore-asta-rilanci-v1.md` §14.
One question was asked before a line was written, because the two answers are two different jobs (free
over the whole listone, or role by role); the answer is FREE, and every number is measured on that.

**A change of ORDER is a change of GAME, and the first thing to measure is the mechanism with every
strategy held still.** (Three numbers of this paragraph were SUPERSEDED the same evening by the
operator's own auction archive - a real drawn auction RESHUFFLES the urn, so an unsold man comes back;
see the section below.) Of the 50 best men by the engine's own value, **14.3 go UNSOLD** at a drawn
auction against 0.1 at a called one — they come up when the rosters are already full — the table
manages to spend 709 credits of 1000 against 978, holes double (25.4 → 50.0), and what the best man
costs stops being a fact about him: 31.2% of a budget at a called auction, 11-48% at a drawn one
depending on WHEN he is drawn. **One participant, one window, twenty urns: sd 170 fantapunti against
the 199 that separates the ten seasons themselves** — so a single order measures the luck of that
order, which is why `--random` takes a number of DRAWS and every figure is a mean over windows × draws.

**The arm that won at a called auction finishes fifth of six at a drawn one** (2665.5 → 2276.1, holes
12.4 → 69.0), and the cure is this project's own question asked once more: **what is the zero of this
number?** The surplus already subtracts the man who would PLAY instead; a drawn auction needs the man
who would be BOUGHT instead, and WHICH man that is, is COUNTED rather than chosen — if `k` participants
still have that role open, the best `k` left go one each, so the fallback is the `k`-th of them.
`ALT_WEIGHT` = 0.75 of it comes off the bid: **+12.8%, 10 windows of 10, worst +6.7%**, holes → 22.5,
interior optimum. It is not the 1.0 the theory writes because the fallback is OPTIMISTIC — it assumes
you win one of those `k`. Its companion refuses the mirror defect: **«spend it or lose it» never means
buying a man worse than the one who is coming**, because at a random extraction **a slot is as scarce
as a credit** (the draft bench's lesson met halfway) — that floor was not spending a credit, it was
spending a PLACE, and the credit stayed in the purse anyway (+79 points, holes 33.4 → 22.9).

Five things outlive the mechanism.
- **A parameter belongs to the MECHANISM it was measured on**, exactly as it belongs to a platform: the
  same term is worth +0.3% on the called windows with one at −5.6%, i.e. it fails the robust criterion
  there. So it is switched off by the mechanism itself (`Urn.random`) and not by a flag anybody has to
  remember, and every number published on the called auction reproduces to the decimal — asserted by a
  test, not hoped.
- **Two knobs for one effect is where a bench starts fitting itself.** `ALT_RANK` 2 measures a shade
  better than 1 (2572.8 against 2568.0) and the whole surface is flat inside 0.5%; what survives is the
  parametrisation whose companion is COUNTED rather than tuned.
- **Reading a value without its option value is worse than reading none at all.** The profile who
  blends his ceiling toward the engine's surplus (the expert) goes from mid-table to LAST, below the
  novice who reads only the quotation — the surplus alone says «he is cheap for what he gives» about a
  man ten better ones are queued behind.
- **A strategy that wins only because the table wastes its money is not a strategy**, so it is sat down
  against itself: three engine seats of thirteen still lead (2506.2 against 2414.8), with the arms'
  spend rising 560 → 734 — competition for the same men is what puts the prices back.
- **A number quoted as agreeing with the operator's experience is the first one to re-measure.** The
  «top man goes for 48-75% of the budget, mean 60%» published in the README does NOT reproduce: 31.2%
  (26-35%) on ten windows, identical with the engine arm at the table and without it. Withdrawn rather
  than deleted, with what it would mean if his real figure is 60% — that this bench's urn is too short
  (359-430 men for 275 places), which is a limit and not a defence.

## ...e poi sono arrivati 147 DATI VERI, e il meccanismo aveva una regola in meno
**02/09/2026 (sera), `docs/real-data/` — 147 aste vere sul listone ufficiale, 131 con la sua stessa rosa
3/8/8/6 e 20 identiche alla sua, 29.421 aggiudicazioni su 1.177 rose. Dettaglio:
`simulatore-asta-rilanci-v1.md` §15.** L'operatore ha portato l'archivio che il documento chiedeva, e
con quello il banco cambia natura: quanto paga un tavolo era DICHIARATO e diventa MISURATO. Le sue
quattro obiezioni («non è realistico che L.Martinez non venga preso» · «P2 … almeno 3 devono essere
suoi» · «P4 deve puntare sul TOP in attacco» · «costi distribuiti in maniera troppo equilibrata») erano
giuste tutte e quattro, e avevano **una causa sola**.

**Una scala indicizzata sulla quantità sbagliata è invisibile sotto un meccanismo e letale sotto un
altro.** Il gradino di una ricetta era scelto da quanti uomini di quel reparto la rosa già possedeva, che
è lo stesso numero del TIER **solo se i lotti sono chiamati dal più caro**. A estrazione la ricetta si
leggeva «pago 1,9 volte la richiesta per il primo difensore che mi capita», e P2 pagava il premio da
titolare al **90esimo difensore del listone**. Ora l'indice è `max(tier, posseduti)`, e il tier — il rango
dentro il ruolo diviso il numero di squadre — è una **legge di conservazione**: in una lega da dieci ci
sono dieci primi difensori perché ognuno ne schiera uno.

**I DATI VERI SONO UN GIUDICE DELL'AMBIENTE, e dove entrano come input lo dicono.** `profiles.MARKET` è
quello che un tavolo vero paga per fascia (attacco di prima fascia **2,38** volte la richiesta, dalla
quinta in giù **0,16-0,25**, e la spartizione fra reparti viene da sé: P 9,1 · D 16,3 · C 27,2 · **A
47,4**). I cinque profili restano dichiarati — sono le sue frasi — ma il loro LIVELLO no. Quindi «il
tavolo simulato riproduce la scala vera» **non è una prova di niente**: è come è costruito. La prova è
quello che il MECCANISMO produce da sé, ed è quello che si segna — concentrazione della spesa (gini
0,59-0,62 contro 0,65-0,68), crediti in tasca (**2,8% contro 2,8%**), campioni invenduti (1,3 contro 1,75).

**Una scala è il tetto di un acquisto ORDINARIO.** La mediana di pagato/richiesta e non il rapporto delle
somme, che in coda vale 1,4-1,7 volte la mediana perché qualche riempimento viene comprato in chiusura
con quello che resta: quell'inflazione è vera e il banco la produce già da sé, e metterla anche nella
scala la conta due volte (2,7 uomini sotto i 5 crediti contro 4,3, su un vero di 8,0). Il prezzo della
mediana è la conservazione — somma il 79% del montepremi — e il meccanismo mette il resto.

**IL DIFETTO PIÙ GROSSO NON ERA NELLA SUA LISTA: a un'asta a estrazione vera l'urna si rimescola.** Nelle
cinque aste il cui ordine è ricostruibile, ognuno dei 518 nomi è estratto **da 5 a 9 volte**, e Martinez
L., Malen, Dimarco, Paz N. e Thuram compaiono fra le estrazioni su cui nessuno ha offerto e sono venduti
dopo. Il banco modellava un giro solo, e quel giro solo produceva da sé **tre numeri pubblicati**: i «14,3
dei 50 migliori invenduti» (col rimescolo 1,3, vero 1,75), il «migliore che va dallo 0% al 35% a seconda
di quando esce» (mai invenduto, 60 urne su 60), e la frase su cui poggia `ALT_WEIGHT` — «un nome rifiutato
non ha un sostituto garantito». Un nome rifiutato **torna**. La regola generale: **quando i numeri di un
meccanismo sembrano estremi, si va a leggere il regolamento della cosa vera prima di modellare un
comportamento** — qui mancava una regola, non un parametro.

**E «una strategia che vince solo perché il tavolo butta i suoi soldi non è una strategia» è stata
misurata dall'altro lato** (e il crollo all'urna è stato poi CURATO la notte stessa, sezione seguente:
il difetto era la SCALA dei tetti, non la valutazione). Contro il tavolo calibrato sul vero, il braccio
motore passa da 2665,5 punti e posto medio 1,70 a **2604,2 e posto 4,40** a chiamata (0 titoli su 10) e
da ~2568 a **2087,3, ultimo di undici**, a estrazione — mentre il tavolo guadagna ~120 punti diventando realistico. Non è la taratura:
tutta la griglia di `ALT_WEIGHT` è ultima a estrazione e **inerte a chiamata** (identica a ogni punto), e
due sonde dicono che la diagnosi è di LIVELLO — `engine_rate` tara i suoi tetti perché i suoi 25 uomini
costino un budget, mentre un tavolo vero mette il 47% del montepremi in attacco.

Quattro abitudini più piccole, tutte pagate nella stessa sera.
- **Una soglia sposta il problema di un gradino invece di risolverlo.** Tenere l'ultimo posto per un uomo
  di prima fascia lascia 7,73 dei 50 migliori invenduti, estenderlo alla seconda 10,67, alla terza 14,30.
  La forma che funziona è CONTATA e non ha costanti: se `hands` partecipanti vogliono ancora quel ruolo, i
  migliori rimasti vanno uno per testa, quindi la mia quota è il loro numero diviso le mani alzate — lo
  stesso conto che `alternative` fa per un credito, fatto per un POSTO.
- **Un indice che divide per la richiesta NON è pulito dalla composizione**, perché il rapporto
  pagato/richiesta cresce col calciatore: la curva per decimo dell'asta legge 1,69 nel nono decimo, e in
  quel decimo gli aggiudicati hanno una Qt.I media 1,42 volte quella dell'asta. La prima cura scritta su
  quella curva è stata misurata e **respinta**; quello che decide è il test PER UOMO — Malen costa il
  42,2% del budget aggiudicato presto e il 42,5% tardi, `r(quando, prezzo) = −0,147`.
- **Una costante dichiarata può essere CONFERMATA dai dati**, e vale la pena guardare: «la soglia mentale
  dei 500 difficilmente si supera» misurata è **0,30 acquisti per asta** sopra la metà del budget (39 su
  29.421, p99,9 al 52,1%). E il numero che il progetto aveva **ritirato** — il più caro di un'asta al
  «48-75%, media 60%» — ha ora una risposta: **42,8% a chiamata e 44,1% a estrazione** (18-73%). Il
  ricordo dell'operatore era più vicino al vero del 31,2% che il banco misurava: **un numero ritirato per
  mancata riproduzione non è un numero smentito.**
- **Un archetipo che non siede al tavolo va cercato nei dati, non inventato.** k-means sulle 1.177 rose
  vere: tre dei cinque gruppi sono i suoi P4, P3 e P2, e i due che mancavano sono «rinuncia al top
  d'attacco» (13,5%: il 62% fra difesa e centrocampo) e «un campione e la manovalanza» (14%: il 46% del
  budget su un uomo e il 42% della rosa a due crediti). Dichiarati, implementati e **seduti fuori** dal
  tavolo dichiarato, perché chi siede al suo tavolo è una sua decisione e non una misura. La stessa
  tabella dice anche che possedere 3+ top di ruolo in un reparto è **raro** (4% in difesa), quindi il P2
  che lui descrive è una strategia vera e rara.

Quello che ancora non tornava, con il suo numero: sul banco il campione costava il **38,1%** del budget se
estratto nel primo quarto e l'**1,3%** nell'ultimo (`r = −0,904`), dove il vero è piatto. **Chiuso la
stessa sera, e la cura che avevo scritto qui era sbagliata** — non era una quota di crediti da tenere, era
l'ORDINE: vedi la sezione che segue.

## ...e allineare il banco a quei dati ha trovato che il difetto era l'ORDINE
**02/09/2026 (sera), `simulatore-asta-rilanci-v1.md` §16.** I tre scarti che il pomeriggio aveva lasciato
si chiudono con **una correzione al meccanismo** e due all'indicizzazione, e con tre cure scritte prima
di essere misurate e bocciate. Lo strumento che ha trovato tutto è uno: **la curva della spesa
cumulata** — quanto del montepremi è già uscito, decimo per decimo. Un tavolo vero tiene in tasca il
**70% dei crediti a metà asta**; il banco ne aveva speso il 60%, e a chiamata era fuori scala di **cinque
volte** nel primo decimo (46,1% contro 9,0%). Nessun comportamento sposta una curva così.

**UN'ASTA SI GIOCA A REPARTI, e questo banco la giocava tutta insieme.** Sulle 20 aste reali con la sua
lega, **16 mettono la posizione media dell'aggiudicazione a 0,06 · 0,28 · 0,60 · 0,88** per P · D · C ·
A — identiche a due decimali su sedici sessioni separate, che è la firma di un ordine imposto dalla
piattaforma e non di un'abitudine, e sono esattamente dove il REGOLAMENTO mette i confini (3 portieri su
25 posti, poi 8, poi 8, poi 6). Dentro un reparto l'ordine è casuale. Adottato senza parametri
(`bench.PHASES`), spiega da sé la curva della spesa (= la spartizione fra reparti accumulata in
quell'ordine), il fatto che gli uomini cari siano aggiudicati tardi (sono attaccanti) e che il prezzo di
un campione non dipenda da quando esce. Dopo: **8,3 · 19,9 · 24,1 · 25,6 · 40,0 · 48,1 · 50,5 · 78,3 ·
98,1** contro il vero **9,0 · 18,6 · 24,8 · 27,8 · 40,5 · 50,4 · 54,3 · 77,0 · 95,5**.

Tre lezioni che valgono oltre il banco, e due sono su come si cerca.
- **La fotografia batte il ragionamento.** Tre cure sono state respinte ragionando su curve aggregate; la
  causa vera l'ha trovata stampare, **per un lotto solo**, chi aveva ancora un posto, quanti crediti
  aveva e quanto offriva: nove mani, crediti [12, 12, 50, 68, 106, 145, 177, 369, 513], offerte 184 ·
  150 · 150. Il progetto lo aveva già scritto per il pannello Tk («fotografa la SUA finestra prima di
  rispiegare il codice»); vale identico per un meccanismo.
- **Un indice che conta gli uomini sbagliati è invisibile fino al caso limite.** `step` era indicizzato su
  *quanti* uomini del reparto la rosa possiede, quindi una rosa con quattro attaccanti prezzava **il
  miglior giocatore del gioco come il suo quinto**, 0,18 volte la richiesta invece di 2,38. Ora conta
  quelli che possiede **almeno bravi come lui**, la guardia anti-accumulo regge intatta, e i quattro
  bersagli si muovono tutti (uomini a ≤5 crediti 7,0 → 8,0 su un vero di 9,5; tasca 10,2% → 6,2% su 6,1%).
- **Un OBIETTIVO è un NOME, non una fascia.** «Un attaccante di prima fascia» si liberava nel momento in
  cui P4 comprava **il decimo migliore dei dieci**; con il RANGO la riserva vale finché quel nome non è
  uscito, e il posto la segue. Dentro la sua fase il campione passa da 47,8 · 31,0 · 12,3 · **1,6** a
  47,0 · 42,0 · 42,0 · **40,5**, contro un vero di 43,1 · 45,4 · 37,6 · 34,7.

**E tre cure respinte dalla misura, tutte e tre ovvie sulla carta**: tenere i crediti per la migliore
occasione ancora nell'urna (tasca 5,3% → **22,3%** e il campione fermo — il vincolo era il POSTO, non il
credito); tenere crediti **e** posto, per tutti (**8,4 posti su 250 vuoti**, 18 dei 50 migliori
invenduti: dieci partecipanti che aspettano lo stesso uomo non sono dieci strategie, sono un'asta
bloccata — data ai due profili la cui strategia È quell'uomo costa tre posti in tutto); e un pavimento
d'urgenza scritto sulla curva sporca di composizione, che non produce il picco per cui era nato.

Due chiuse. **`CAUTIOUS_CAP_SHARE` era 0,15, cioè il DECIMO PERCENTILE della cautela reale** (l'acquisto
più caro di una rosa vera è il 14,8% del budget al p10, il 18,4% al p25, il 25,0% alla mediana; solo il
10,4% delle 1.177 rose lo tiene sotto il 15%), e con tre sedie su dieci decideva il secondo prezzo
dell'uomo più caro; ora è **0,18** e **è quasi inerte** — quello che sembrava un tetto vincolante era il
sintomo dell'indice. *Una manopola che morde solo mentre un'altra cosa è rotta è una manopola da
rimisurare dopo aver aggiustato quella.* E **una manopola girata dove nessuno la legge stampa righe
identiche**: il primo sweep di quel tetto leggeva gli stessi numeri da 0,15 a 0,50 perché `bench` importa
la costante per nome — la prima cosa da sospettare di un risultato piatto è lo strumento.

## Un TETTO IN FANTAPUNTI non vince un lotto: il braccio motore e la scala del mercato
**02/09/2026 (notte), `simulatore-asta-rilanci-v1.md` §17.** Il braccio motore era **ultimo di undici**
all'urna (2212,9 contro 2584,8 del miglior umano, 79,8 buchi, 656 crediti spesi su 1000); adesso è
**primo** (2609,0 · posto 3,82 · 22,4 buchi · 987 spesi · 28 titoli su 100, e i meno buchi del tavolo).
Sette famiglie di correzione misurate, **una sola conta**, e non è quella che sembrava.

**IL DIFETTO È DI SCALA, non di valutazione.** Il braccio prezza un uomo in FANTAPUNTI (`engine_worth` =
surplus + copertura) e converte con un tasso globale; il mercato lo prezza come MULTIPLO DELLA SUA
RICHIESTA, fascia per fascia, ed è quella scala che conserva i crediti. *Un offerente i cui tetti non
vivono sulla stessa scala dei prezzi non può vincere un lotto contendibile a nessun livello*: alzali e
strapaga il primo uomo di ogni fase, abbassali e non compra niente. Fotografato: sui lotti che perde
offriva **0,16-0,47 del prezzo** e quello che prendeva lo pagava **0,10-0,15 della richiesta**, con un
acquisto mediano da **un credito** e il 30,7% dei suoi uomini previsto sotto le 19 giornate. A chiamata lo
stesso codice offre 0,63-0,85 e spende 987 — perché lì l'ordine gli mette davanti i cari per primi.

**LA CURA È LA SCALA DEL MERCATO, INCLINATA SULLA DIFESA** (`profiles.engine_ladder`): il passo misurato
sulle 131 aste vere, ×1,9 su portieri e difensori, ×2,2 sulle prime quattro fasce, **rinormalizzato**
perché il piano costi un budget — *un tilt che non conserva non è una strategia, è un portafoglio più
grande*. Verdetto STRICT, 10 finestre di 10, peggiore +10,1%, ottimo INTERNO su griglia allargata e
plateau piatto entro l'1% (quindi la direzione è il risultato, i decimali no). **È la strategia di P2
trovata dalla ricerca invece che copiata**, e il regolamento dice perché paga: i due modificatori di
questa lega si pagano in **voti BASE** (il mod.dif sulla media dei tre difensori migliori, l'R-Factor su
tutti gli undici) e i voti base sono quello che consegna una linea difensiva.

**E QUI STA LA METÀ SCOMODA: il nostro ORDINAMENTO non aggiunge niente** — *metà smentita la notte stessa
dalla sezione seguente, che ha trovato perché: non veniva LETTO.* La stessa scala letta sul rango
di PREZZO invece che su quello del motore dà **+12,4% contro +12,3%**, identico. Quello che il braccio
guadagna non è un'opinione migliore sui calciatori, è offrire su una scala che può vincere un lotto — e
`metrica-asta-surplus-v1.md` §18 aveva già misurato quel vantaggio largo un numero solo (le presenze).
Anche le nostre quote di reparto sono **ridondanti col tilt**: +1,1% sulla scala piatta, **−1,2%** su
quella inclinata (2 finestre su 10), quindi il parametro è stato togliuto invece di restare non letto. E
con **tre** sedie al braccio su tredici resta primo ma per 6,9 punti invece di 54,5: parte del vantaggio
è essere il solo a giocare così.

Sei famiglie respinte, e due avevano un buon argomento: `ALT_WEIGHT` rimisurato con le fasi (l'ottimo si
sposta da 0,75 a 0,5 e vale +5,2% — dentro un reparto «arriva qualcuno di meglio» è quasi sempre vero,
quindi aspettare non informa più); l'alternativa sottratta **solo sul surplus** e non sulla copertura
(+3,5%: la copertura è il valore di non lasciare un posto vuoto, non una proprietà dell'uomo, quindi le
due si annullano — diagnosi giusta, cura insufficiente); i **buchi attesi esatti** col Poisson-binomiale
al posto di `min(quota, deficit)` (−0,3%: più pulito, senza guadagno); il tetto di reparto in quattro
varianti (la migliore +0,0%, e togliendolo **−9,9% a chiamata**, dove resta essenziale); il tasso
ricalibrato sulla quantità che l'offerta usa davvero (−10,4%); le quote di mercato al posto delle nostre
(−0,1% all'urna, +1,0% a chiamata).

**E la stessa lezione sullo strumento, per la seconda volta in una sera.** La prima corsa col codice
adottato leggeva identica a quella di prima: `one_auction` aggiunge il braccio **dopo** il ciclo che
consegna `asks`, quindi il dispatch non scattava. **Righe identiche non sono un risultato: sono un guasto
dello strumento**, e vanno sospettate prima della conclusione — la prima volta era
`profiles.CAUTIOUS_CAP_SHARE` girata dove `bench` non la legge.

## Un vantaggio informativo si spende dove la scala del mercato lascia spazio: DENTRO la fascia
**02/09/2026 (notte tarda), `simulatore-asta-rilanci-v1.md` §21.** «Migliorare l'engine che consiglia le
offerte per un'asta random», e la diagnosi non era in nessuna delle sette aperture della todolist perché
nessuno l'aveva fatta: **all'urna il braccio motore non chiamava una sola funzione del motore.** Contato
invece che dedotto dal codice — `engine_worth`, `cover_value`, `coverage_need`, `alternative`, `role_cap`:
**1436 chiamate a chiamata e ZERO a estrazione** — perché l'adozione della scala di mercato manda il
braccio sul ramo umano, che prezza `richiesta × passo(fascia) × scala` con la **fascia definita dal
PREZZO**. Il braccio che vinceva all'urna era un offerente di mercato inclinato sulla difesa. *Quando una
misura dice «la nostra opinione vale zero», la prima cosa da verificare è che venga LETTA* — §17.5 aveva
misurato +12,4% contro +12,3% e la sua conclusione giusta era «la forma non è questa», non «non serve».

**Una fascia è larga dieci uomini perché quella è la legge di conservazione, e lì c'è lo spazio.** Dentro
una (ruolo, fascia) il PREZZO varia dello 0,08-0,48 della propria mediana e le PRESENZE ATTESE dello 0,31-0,33
del calendario — dodici giornate allo stesso prezzo, e 0,69 per i portieri di seconda fascia. **E la
quantità non è una scelta**: `metrica-asta-surplus-v1.md` §18 aveva già misurato il nostro vantaggio
incrementale sulla quotazione come largo un numero solo (`pv_pred | Qt.I` +0,243 su Serie A, contro
−0,077 del surplus e −0,032 della fantamedia), e il regolamento dice perché paga proprio qui: una sola
riserva d'ufficio annulla tutt'e due i modificatori. `INSIGHT` 0,80 sulla MAGNITUDINE (la distanza dalla
media della fascia sull'uomo più lontano della stessa fascia), che **conserva per costruzione** — media
zero su una fascia piena, quindi nessuna rinormalizzazione, a differenza del tilt — e mette al **centro**
della fascia, non in fondo, chi il motore non prezza. **+1,02% robust su 800 stagioni** (appaiato +26,4 ±
4,5, t 5,9, 9 finestre su 10), buchi 22,9 → 18,8, titoli 175 → 257 su 800; a chiamata nemmeno un decimale,
perché lì il braccio non arriva a `Team.step` e le presenze le legge già dentro `cover_value`.

**E questo margine SOPRAVVIVE alla propria concorrenza**, che è la cosa che il §18.2 aveva dovuto ritirare
per la scala (−2,8, un pareggio, con tre bracci): con tre bracci il confronto appaiato legge **+30,0 ± 4,0
(t 7,4)**, perché il termine **non alza un'offerta, sposta gli stessi soldi dentro una fascia**. È la prima
cosa che questo banco trova che paghi per la nostra OPINIONE invece che per il modo in cui offriamo.

Quattro abitudini, e tre sono regole di casa incontrate da un lato nuovo.
- **Un'ETICHETTA di verdetto può essere ritirata da un campione più grande mentre l'effetto si rafforza.**
  A 40 urne era **STRICT** (10 finestre su 10, peggiore +0,33%), a 80 una finestra passa a −0,42%: il
  guadagno si affila (+32,9 ± 6,3 → +26,4 ± 4,5, t 5,2 → 5,9), l'etichetta cade, perché «tutte le finestre
  migliorano» è un conteggio su dieci e una era una monetina. *Un guadagno confermato da un campione più
  grande e un'etichetta smentita da quello stesso campione sono due cose diverse, e solo la prima è una
  prova* — la disciplina del §18.2 applicata alla propria adozione e non a quelle di ieri.
- **Le parti non fanno il tutto dove quello che si compra è una SOGLIA sull'undici.** Un peso per reparto
  è stato chiesto come il §19.1 impone (i portieri a parte) e respinto dall'aritmetica: 9,7 + 10,7 = 20,4
  contro 32,9, e nessuna metà arriva al pavimento con un `t` sopra 2, perché i due modificatori sono una
  proprietà dell'ELEVEN — sistemare un reparto e lasciarne tre rotti non incassa niente. Stessa famiglia
  dell'R-Factor: *il valore di una soglia non si può scrivere su una riga.*
- **Due frasi sullo stesso ruolo possono valere zero e sette punti.** La metà portieri del TILT valeva
  niente (+0,1%) ed era una frase sul **livello** della fascia («offri 136 dove il mercato paga 81»); la
  metà portieri di QUESTO termine vale **+7,4 dei +32,9** ed è una frase su **quale dei dieci** gioca — che
  per un portiere, di cui se ne schiera uno, è la sola domanda. Svilar (pv 0,90) e Butez (0,57) chiedono 53
  e 35 crediti: il prezzo non li distingue, il termine offre 107 contro 10.
- **E la forma si sceglie sulla misura, non sulla provenienza.** Il RANGO era la forma in cui il vantaggio
  è stato misurato (uno Spearman parziale è sui ranghi) e per questo è stato scritto per primo: +23,8
  contro +32,9. La magnitudine vince perché dice quello che il rango butta via, cioè se lo scarto dentro la
  fascia è una giornata o dodici. Respinta anche `Team.keeps` contata su «chi gioca» invece che sulla
  fascia di prezzo: +0,25%, t 1,71, sotto il pavimento con la direzione giusta.

## Leggere i rivali non paga a SECONDO PREZZO, e il null lo ha dimostrato meglio dell'oracolo
**02/09/2026 (notte tarda), `simulatore-asta-rilanci-v1.md` §22.** «Individuare le strategie degli
avversari può aiutarci a prevedere le loro mosse?» Quattro famiglie misurate col criterio pre-registrato
e **con l'informazione PERFETTA** (un oracolo che legge il massimo dei rivali prima di offrire, quindi un
TETTO di qualunque modello e non una politica), tutte e quattro respinte. **La ragione è del meccanismo:
a un'asta a secondo prezzo sapere cosa serve per vincere il lotto che hai davanti vale ZERO** — se il tuo
tetto è sopra vinci e paghi il secondo prezzo comunque, se è sotto perdi comunque — quindi
l'informazione può pagare solo attraverso il BILANCIO, e il bilancio è già impegnato per costruzione
(`Team.scale`). Il prezzo ombra di un credito (la Lagrangiana, che sussume tasso, alternativa e tetto di
reparto senza parametri) legge **−7,6%** coi prezzi dell'oracolo; rilanciare per prendere il lotto
−2,7/−4,9% ed è monotono nel quanto; `keeps` sul valore per credito −25%.

**E la lezione più utile non è il no: è che IL NULL HA BATTUTO IL CANALE.** «Conta come mano alzata solo
il rivale che può pagare» è una definizione senza parametri, osservabile (ogni aggiudicazione è pubblica)
e valeva **+2,0%**; la sua forma esatta — «può pagare quanto COSTERÀ», con la scala misurata sulle aste
vere — vale **+0,22%**, cioè niente; e «abbassa `hands` di un fattore, senza leggere un soldo di nessuno»
vale **+4,8%**. Quindi non era informazione sui rivali, era PAZIENZA: il braccio compra troppo presto
all'urna e la divisione per le mani alzate dentro `keeps` è la ragione. La direzione resta stabilita,
il numero no.

**E la pazienza è il caso in cui l'AMBIENTE boccia quello che ogni criterio interno approva.** +2,83% e
+3,82% su 800 stagioni appaiate (t 19,3 e 26,0, 10 finestre su 10, peggiore +1,5%), buchi 19,2 → 6,0,
posto medio 3,52 → 1,24, sopravvive a tre bracci (+2,8% strict), ha un tetto (il valore assurdo legge
meno del limite) ed è inerte a chiamata. **Non adottata**, perché l'archivio dice a che prezzo compra:
**0,07 del prezzo vero** un difensore di seconda fascia tardi nella sua fase, 0,09 un centrocampista di
terza, 0,14-0,16 un attaccante delle prime due — mentre il braccio BASE è in scala col vero. Quel prezzo
esiste solo perché nove rose devono riempire le loro quote mentre una non compra niente, e **l'archivio
non può nemmeno smentirlo: nessun manager vero si astiene da una fase, quindi quel prezzo non è mai stato
osservato.** Sfruttamento del tavolo, non valutazione migliore — e su una cosa che l'operatore dovrebbe
giocare davvero la decisione è sua.

Quattro abitudini, e due sono errori commessi nella stessa sera.
- **Un rilancio che nessuno paga con un taglio altrove è un portafoglio più grande** (§17.4 dall'altro
  lato): la spesa sale a 995-999 su 1000 e i buchi raddoppiano, perché vincere un lotto che stavi
  perdendo costa i lotti che stavi vincendo.
- **Un rapporto valore/credito ordina la SPAZZATURA per prima quando il vincolo sono i POSTI**, e il
  difetto è stato commesso due volte in un'ora: il primo oracolo ha chiuso l'asta spendendo **25 crediti
  su 1000** (25 uomini da un credito, 36 buchi), e la stessa forma dentro `keeps` legge −25%. Con 25
  posti e crediti che scadono il problema è uno zaino con quote, non una graduatoria.
- **Una conservazione si legge PER RUOLO**, che è quello che `to_credits` scrive di se stesso: sommata sui
  250 uomini più cari invece che sui 3+8+8+6 a testa, il piano risultava più economico della borsa, il
  prezzo ombra leggeva **zero** e il braccio offriva 241 crediti per il sedicesimo portiere del listone.
- **Un aggregato giusto può nascondere un difetto un piano sotto.** La curva della spesa DENTRO ogni fase
  riproduce il vero (P 30/60/86% contro 33/65/85%, e le altre tre uguali), quindi i soldi del tavolo non
  partono presto; il difetto era che il **ri-offerta teneva una coda sola** e gli invenduti di tutte e
  quattro le fasi tornavano dopo l'intera prima passata, mentre nell'archivio le aggiudicazioni di un
  ruolo sono CONTIGUE. Corretto e misurato prima di adottarlo: **0 differenze su 1.000
  stagioni-partecipante**, perché sul tavolo dichiarato **0 aggiudicazioni avvengono dopo la prima
  passata** — la cura riguarda un angolo in cui il tavolo dichiarato non entra mai, e che solo una
  strategia di attesa apre.

## Un RISERVA che compri per il voto non puo' fare il lavoro per cui l'hai comprato
**02/09/2026 (notte), `simulatore-asta-rilanci-v1.md` §26.** Dalla domanda dell'operatore «e' meglio un
calciatore che gioca sempre o uno che salta qualche partita ma con un'ottima fantamedia?», e la risposta
per UN uomo dipende da una cosa sola: **se in quel ruolo hai un ricambio.** Con un ricambio, la
fantamedia che serve per pareggiare uno che gioca tutte le 38 a 6,30 **non sale quasi** (6,29 a 34
giornate, 6,25 a 22), perche' il riserva vale quanto lui (6,37 a centrocampo, misurato); senza ricambio
serve **14,32**, cioe' un giocatore che non esiste. Sul dato vero: Zambo Anguissa (6,81 in 18 giornate)
rende 123 punti suoi, **250** con un ricambio e **28** senza; Barella (6,72 in 34) rende 228, 254 e 210.

**E POI L'OPERATORE NE HA RICAVATO UNA REGOLA — «paga la fantamedia dove hai copertura, le presenze
dove quel posto lo regge lui da solo» — CHE LA MISURA CONFERMA A META'.** A budget uguale sulle dieci
stagioni vere: presenze su tutti i 25 posti 2686 punti e 5,1 buchi; la regola (presenze fino a coprire
l'undici, poi fantamedia sui posti di scorta) 2680, cioe' **−6,4 ± 12,7 e cinque stagioni su dieci: un
pareggio**; il suo contrario −27,9; comprare chi segna su tutti i posti −85,2 con 24,6 buchi. Quindi la
DIREZIONE e' giusta e il RAFFINAMENTO vale zero.

**La ragione e' una contraddizione dentro la regola, e vale oltre questo caso**: «dove hai copertura»
presuppone che un posto di scorta non serva a coprire, ma **il lavoro di un riserva E' coprire** — se lo
scegli per il voto non puo' fare il lavoro per cui l'hai comprato, e quel voto lo incassi poche volte
perche' per definizione gioca poco. La panchina e' anche piu' corta di quanto sembri: di otto
centrocampisti in rosa ne sono disponibili **5,3** in una giornata media, quindi *un posto in cui la
copertura c'e' gia' non esiste.* Quello che sopravvive: presenze su tutti i posti, e la fantamedia solo
come spareggio fra uomini con le stesse presenze attese — che e' esattamente cio' che il motore fa
dentro una fascia. Il portiere e' il caso limite dove le due cose coincidono, e non per caso e' dove il
motore vale il doppio.

## Il TETTO di un'offerta e' una QUOTA del budget, ed e' diverso per RUOLO
**03/09/2026, `simulatore-asta-rilanci-v1.md` §27**, dalle domande dell'operatore al tavolo. **Un
credito speso sul resto della rosa vale 0,0055 punti a giornata** (misurato variando il budget), e senza
quel tasso nessun tetto si puo' scrivere. Con quello, il tetto **scala col budget**: verificato a 500 ·
1000 · 2000, il segno gira fra il **17,5% e il 19%** in tutti e tre i casi (88 · 190 · 380 crediti) —
tre cifre, una soglia, che e' il §18.3 applicato a un tetto.

**IL PRIMO SLOT NON E' UNA FASCIA PIATTA, e da li' viene tutto.** Il rapporto fra il prezzo del primo e
del decimo dentro uno slot e' **1,0-1,3 dal secondo slot in giu'** e **1,7-2,5 nel primo**. Per questo la
scelta del motore dentro il primo slot PERDE contro il piu' caro (D −16,4 · C −12,1 · A −6,3 per scelta)
e vince largo dal secondo (+37,6 · +45,4 · +50,2) — e non perche' il mercato sia meglio informato in
cima: la' sbagliamo di MENO (errore 5-6 giornate contro 7-8). *Dove il prezzo varia di due volte, il
prezzo sta ancora dicendo qualcosa.* Quindi dentro uno slot si ordina per VALORE ATTESO (fantamedia ×
presenze) e non per presenze pure: il criterio si adatta da se'.

**E IL TETTO E' DIVERSO PER RUOLO, per una ragione che sta nel regolamento e non nei dati — quanti ne
SCHIERI.** Uno del primo slot contro due del secondo, dieci stagioni: **portieri tetto ~13% dove il
mercato chiede il 6% (si compra); DIFENSORI nessun prezzo** — negativo a ogni quota provata, gia' −0,10
a giornata a 30 crediti; centrocampisti ~6,5% contro il 9% chiesto; **attaccanti ~18% contro il 25%
chiesto**. Del portiere ne schieri UNO, quindi la sostituzione due-per-uno non esiste; dei difensori
QUATTRO e il modificatore premia la media dei tre migliori, quindi la difesa vuole quantita' di voti
decenti e non un fenomeno. **Questo corregge «difesa TOP e' la strategia migliore»**: resta vero (18% di
titoli contro il 10% del caso) ma non vuol dire comprare il difensore piu' caro — vuol dire mettere piu'
soldi nel reparto, spalmati, che e' quello che il tilt adottato fa da se'.

**Slot per slot il tetto NON scende mentre il prezzo crolla** (1o 255 chiesti contro ~170 di tetto, 2o
104 contro ~130, 3o 50 contro ~145): il mercato sfonda **in un posto solo**. E **se la profondita' si
esaurisce il tetto sale, ma non subito**: 21% con lo slot 2 vivo, 22% con lo slot 2 esaurito (il terzo lo
sostituisce quasi), **32% con due slot vuoti** — dove il primo slot vince 10 stagioni su 10 a 50 crediti.
*Finche' sotto di lui c'e' profondita' un top vale 210; quando la profondita' e' finita ne vale 320.*

Due convenzioni nate qui e da rispettare altrove.
- **«SLOT» e' la parola del gioco**, non «blocco» o «fascia», su indicazione dell'operatore: si usa
  quella, come si tengono `titolarissimo`, `bandiera`, `por` e `pc`.
- **I risultati si riportano in punti A GIORNATA, mai in totali di stagione** (sua richiesta: «per me e'
  piu' facile capire di che grandezze parliamo»). Un totale nasconde l'ordine di grandezza — +31 punti su
  2665 sono **+0,8 a giornata** — e la giornata e' anche l'unita' in cui la differenza CONTA, perche' la
  scala dei gol parte da 66 su una media di ~70. Ancoraggi: la scelta della strategia vale +1,7 a
  giornata, il tempismo +1,3, due attaccanti del secondo slot invece di un top +0,8, i consigli del
  motore dentro uno slot +0,7, un buco −4,7.

## Un'assenza recente ha DUE significati, e la piu' cara e' «non abbiamo guardato»
**03/09/2026, da una domanda dell'operatore: «come mai non abbiamo nessun infortunio di serie a che
risale a oggi o ieri?». Dettaglio: `letture-app-v1.md` §22.** Ci sono volute cinque interrogazioni e un
elenco di file per rispondere, e la risposta era che **il 96% delle pagine in cache era stato letto il 1º
settembre**: una pagina letta l'1 non puo' contenere un infortunio cominciato il 2. Impossibilita' di
costruzione, non un fatto sul calcio — e il buco era uniforme sui cinque campionati, che e' la firma di
una causa nostra. Da qui **`injuries.observed_on`**: la data della LETTURA, presa dal file di cache e mai
dall'orologio, cosi' un `rebuild` che rigioca la cache non ristampa oggi su una pagina di luglio. La
regola generale: **una tabella datata sull'EVENTO ha bisogno anche della data dell'OSSERVAZIONE**, o non
sa distinguere un'assenza di fatti da un'assenza di sguardo — «vuoto = ignoto» applicato a una tabella
intera invece che a una colonna. E se quella data vive fuori dal database (li' erano i timestamp di 4.662
file), nessuna query puo' arrivarci.

**IL CANALE VELOCE C'ERA GIA', E MANCAVA UNA RIGA IN UNA ALLOWLIST.** `availability` — la pagina
*indisponibili* di fantacalcio.it, riletta ogni giorno su tutti e cinque i campionati — era nel DB, nel
contratto di export e scritta in `data/export/`: non era in `TABLES` di `pull-bundle.mjs`, quindi l'app
non l'aveva mai vista. **Terza istanza** del difetto dei campetti (10/08), e la regola scritta allora —
«una cartella aggiunta all'EXPORT va aggiunta anche li'» — vale identica per una TABELLA. Quanto valeva:
114 indisponibili del listone, e **70 di quei 114 senza un infortunio aperto sull'ufficiale** che l'app
gia' leggeva. Misurare prima di costruire ha risparmiato uno scraper, per la seconda volta.

**UNA SOGLIA PRESA IN PRESTITO DA UN'ALTRA DOMANDA E' UN DIFETTO, e qui le domande sono TRE.**
`LONG_INJURY_DAYS` 45 decide se DISEGNARE un'icona, `sealed-bid.LONG_OUT_DAYS` 30 se un uomo merita una
BUSTA per la tornata, e `unavailableNow()` se schierarlo o comprarlo **per sabato** — dove non conta
quanto durera', conta che oggi e' fuori. Tre nomi, tre soglie, nessuna riusata.

**E QUANDO NON SI SA PER QUANTO, SI VINCOLA INVECE DI RIPREZZARE.** Su richiesta dell'operatore i casi
come McTominay scendono in fondo a ogni graduatoria che decide nell'immediato (plancia, pannello draft,
buste chiuse) — ma come CONSTRAINT e mai come peso, la stessa forma delle tre regole dichiarate della
pagina delle buste: una voce di corridoio non dice la durata, quindi riprezzarlo sarebbe inventare.
Restano tutti in lista col loro prezzo, perche' toglierli nasconderebbe un fatto. Due corollari:
**un vincolo che agisce in silenzio e' indistinguibile da un ordinamento rotto**, quindi la ragione sta
in cima al tooltip e il conto e' dichiarato in barra; e la tensione resta detta invece di risolta — la
plancia e' un'asta e un'asta iniziale compra per la STAGIONE, quindi far scendere un top fuori per sette
giorni e' giusto per «compro per sabato» e discutibile per «compro per maggio».

**E UNA LETTURA CHE SCADE SPEGNE IL MARCHIO, quindi la FRESCHEZZA sta a schermo** (`ui/data-freshness`,
nella barra fissa, su ogni pagina). Due date e due domande — quando e' stato scritto il pacchetto, quando
abbiamo guardato la fonte veloce — e **il colore dice la CONSEGUENZA e non l'eta'**: oltre tre giorni la
pastiglia e' rossa e dice «allarmi spenti», perche' uno schermo senza allarmi si legge come «non c'e'
nessuno fuori», che e' la bugia piu' cara che questa app possa dire. Quando e' tutto di oggi e' neutra:
«va bene» non e' una notizia.

## La sua asta e' a ESTRAZIONE LIBERA, e la PLANCIA e' scritta
**03/09/2026, correzione dell'operatore sulla sua stessa asta + `app/src/app/views/plancia/`. Dettaglio:
`simulatore-asta-rilanci-v1.md` §29 e `assistente-asta-v1.md` §33.** «L'asta estrae calciatori random
NON per reparto, tutti insieme.» Il banco modella la sua asta con `bench.PHASES` (l'ordine P·D·C·A
adottato perche' **16 delle 20 aste reali con la sua configurazione** portano quella firma): la sua non e'
una di quelle. **Quello che NON cambia e' la parte grossa** — sconto di fine asta, banda del tempismo,
scala per (ruolo, slot), tetti — perche' sono indicizzati su **quante rose vogliono ancora quel ruolo**, e
la sostituibilita' non sa in che ordine escono i nomi; cambia tutto cio' che il §16 spiegava *con* le fasi.
La regola generale: **il regolamento della cosa vera si chiede all'operatore, non si deduce da un archivio
di aste che assomigliano alla sua.**

**La CONNESSIONE a fanta-asta-live e' FACOLTATIVA su tutt'e due le pagine d'asta** (sua decisione,
03/09/2026): `/plancia` e `/auction` aprono su un tavolo INVENTATO coi settaggi standard e il collegamento
e' un bottone che apre una modale (`ui/live-connect`, una sola per le due pagine — due copie avrebbero
validato il codice in due modi, e il codice E' la chiave del database). Su `/auction` l'ordine e' forzato:
prima `feed.restore()`, la finzione parte solo se non c'e' un'asta vera da riprendere. Una pagina che apre
su un campo codice mostra il layout della cosa invece della cosa.

**E fanta-asta-live NON pubblica il lotto in asta**: nessun nodo del genere e' mai stato osservato per il
meccanismo a rilanci (`options.bids` porta solo countdown, offerta minima e buzzer). Da collegati il lotto
lo nomina l'operatore con un click sulla plancia, e `lotSource` dice quale dei due sta parlando — un campo
indovinato su un payload che nessuno ha letto e' il difetto che questo repository ha gia' pagato.

Quattro cose che restano, e tre le ha trovate la MISURA in un browser vero.
- **UNA COPPIA CHE SI COMPRA INSIEME E DUE ALTERNATIVE FRA LORO NON HANNO LA STESSA ARITMETICA.** Per un
  uomo di movimento l'alternativa e' la coppia dello slot sotto e il totale e' la cifra da confrontare col
  suo prezzo; per un PORTIERE se ne schiera uno, quindi il 2º e il 3º del suo slot sono alternative *fra
  loro* e sommarle confronta il suo prezzo con una cifra che nessuno pagherebbe (184 crediti contro una
  banda di 80-97). `Alternative.together` decide se un totale esiste; dove non esiste non si stampa.
  **Errore di unita', la famiglia piu' cara di questo progetto.**
- **Un parametro appartiene alla popolazione su cui e' stato misurato, e «listone» e' una popolazione**:
  la demo prezzava il listone EuroLeghe con la `LADDER` misurata sulle 20 aste della sua Serie A, perche'
  sceglieva «il foglio che prezza piu' uomini». Ora sceglie classic/default per primo e l'intestazione lo
  nomina comunque.
- **Un tetto e' una QUOTA del budget e non una cifra**, quindi la scala del §19.3 vive nel codice come
  quota (verificato a 500 · 1000 · 2000) — «una soglia assoluta non si confronta fra budget diversi»
  applicata al codice invece che a un rapporto.
- **Una riga puo' portare un numero con due significati SE lo dice**: sulla plancia e' la max offerta
  finche' e' nell'urna e il prezzo pagato quando e' di qualcuno. Tenuto perche' togliere il secondo
  costerebbe la meta' piu' utile — quello che la stanza ha davvero pagato per quello slot e' l'unica
  lettura viva del mercato — e la riga dice quale dei due e' con l'inchiostro, la barra del proprietario e
  una legenda in chiaro.

**Un lettore solo delle colonne del motore**: `core/engine-sheet.ts` (`engineNumbersFrom`) estratto da
`auction-advice.ts` e condiviso, perche' tre viste stanno ormai sugli stessi `engine_*` e due lettori di
`engine_fm_pred` finiscono per dare a un uomo due valutazioni.

## I consigli si giudicano SENZA il tavolo, e una rosa ne schiera undici
**02/09/2026 (notte), `simulatore-asta-rilanci-v1.md` §25, `python -m bench.auction.advice`.** Domanda
dell'operatore: «riusciamo ad avere dei dati verosimili per capire se i consigli del motore favoriscono
veramente chi li usa?». È la più difficile che si possa fare a questo banco, perché **ogni numero
pubblicato là è condizionato al tavolo simulato**. La risposta è un giudice che il tavolo non lo usa, e
lo rende possibile una legge di conservazione che il banco aveva già dentro: **una rosa è di 25 uomini e
un listone contiene 25 FASCE da dieci, quindi una rosa è un uomo per fascia** — e la sola decisione che
i consigli cambiano è quale dei dieci prendere, che si giudica sull'esito vero.

**DENTRO UNA FASCIA DI PREZZO LA QUOTAZIONE VALE MENO DI UN TIRO DI DADO**, ed è il fatto più forte di
tutta la giornata: su dieci stagioni vere e 230 decisioni, prendere il più caro della fascia rende
**−1,0 ± 3,7** fantapunti (t −0,27, 5 stagioni su 10) contro la media della fascia, mentre prendere chi
il motore dà per più presente rende **+18,1 ± 3,4** (t 5,34, **10 su 10**) — appaiato contro la scelta
del mercato, **+19,9 ± 5,2 per scelta** (t 3,84). Non è una critica al listone, è la conservazione: una
fascia è larga dieci uomini *perché* il mercato li prezza uguali, quindi quello che li distingue non può
stare nel prezzo. E il surplus, misurato qui dal lato dell'esito, conferma di non aggiungere niente
(+3,4, t 0,96), che è quello che `metrica-asta-surplus-v1.md` §18 diceva dalla correlazione parziale.

**MA +19,9 SU UN UOMO DIVENTA +1 SU UNA ROSA, PERCHÉ UNA ROSA NE SCHIERA UNDICI.** Due rose sulle stesse
25 fasce e agli stessi prezzi (849 crediti entrambe), a giocare la stagione vera: **+26,4 ± 39,6 a
stagione (+0,99%)** con i **buchi dimezzati** (18,2 → 8,5) e i due modificatori su (R 11,4 → 13,9,
difesa 13,9 → 17,9). E la curva SATURA — a fasce estratte a sorte, la fascia marginale vale **+2,36 sulle
prime cinque e +0,74 sulle ultime**. Le presenze in più di un uomo pagano solo se altrimenti lasciavano
un posto vuoto, e **un undici si copre una volta sola**: quello che i consigli comprano è la COPERTURA e
non il punteggio grezzo. È «il valore di una soglia non si può scrivere su una riga» (l'R-Factor) da un
lato nuovo — e la rosa del motore segna *meno* per apparizione e vince perché non manca.

**E UN ACCORDO FRA DUE MISURE È STATO SCRITTO E RITIRATO NELLA STESSA ORA.** Il conteggio
dell'esecuzione dice che il termine adottato porta in rosa +2,35 dei nostri uomini preferiti, e 2,35 ×
19,9 = +47 contro i +37 che il banco misura: sembrava la riconciliazione fra due misure indipendenti. La
curva di saturazione dice che uno scambio vale +1 di punteggio-rosa, non +19,9, quindi era **una
coincidenza fra un numero per UOMO e un numero per ROSA**. *Due numeri che concordano vanno moltiplicati
solo se hanno la stessa unità, e «per scelta» e «per rosa» non ce l'hanno.*

Tre cose che questi dati NON possono dire, e vanno dette perché è la parte utile della risposta.
- **Non possono certificare quanto valgono in punti**: +26,4 con un errore standard di 39,6 (t 0,67) —
  dieci stagioni vere non distinguono l'1% di una stagione da zero, perché la sd di una stagione è ~100
  fantapunti. **Ed è per questo che il banco esiste**: rigioca quelle stesse dieci stagioni su centinaia
  di urne e legge lo stesso ~+1% con t 5,9. *Il banco non aggiunge calcio, aggiunge POTENZA, e il prezzo
  è un tavolo dichiarato.*
- **Non possono ordinare le nostre colonne fra loro**: al livello della rosa il surplus legge +36,0
  (t 1,10) contro i +26,4 delle presenze (t 0,67), cioè la stessa cosa dentro il rumore.
- **Non dicono niente su quanto se ne ESEGUE al tavolo**, che dipende dai rivali e che solo il banco
  stima: 2,35 acquisti su 25, il **9%**. È anche l'argomento per l'interfaccia — il collo di bottiglia
  non è la previsione, è quanto un'asta contesa ne lascia passare.

## Il TEMPISMO compra i posti e il motore li riempie: due canali che si COMPONGONO
**02/09/2026 (notte), `simulatore-asta-rilanci-v1.md` §24.** Richiesta dell'operatore: «prima di passare
all'interfaccia troviamo un meccanismo giusto per avere un vantaggio dai consigli del motore».
**ADOTTATO `bench.DEPTH_TIER` = 2 e `DEPTH_HANDS` = 9**: all'urna il braccio lascia passare un uomo dalla
TERZA fascia in giù finché nove o dieci rose hanno ancora un posto in quel ruolo, e solo finché restano
abbastanza uomini di fascia non peggiore per sé e per i rivali — la guardia di `Team.keeps`, quindi
nessuna costante in più oltre alla banda misurata. **+1,88% STRICT su 800 stagioni appaiate** (t 11,6,
10 finestre su 10, peggiore +0,57%), buchi 18,9 → 13,3, posto 3,53 → 2,49, **+1,54% strict con tre
bracci**, inerte a chiamata al decimale.

**IL MECCANISMO NON È «LA PROFONDITÀ A MENO», È 1,6 TITOLARI IN PIÙ.** Fotografato: la coda passa da 3
crediti a 1 con le presenze attese ferme (pv 23,7 → 23,2), e i crediti risparmiati comprano **10,5 → 12,1
uomini delle prime due fasce**, cioè dove il §23 ha misurato che il prezzo non scende mai.

**E LA RAGIONE PER CUI È LA RISPOSTA ALLA SUA DOMANDA È LA COMPOSIZIONE, non la regola.** Va detta la
metà scomoda per prima: questa regola **non legge un solo numero del motore** (legge la fascia di prezzo
e il conto delle mani), quindi è un vantaggio preso alla STRUTTURA dell'asta. Quello che la rende un
meccanismo per i nostri consigli è che `INSIGHT` — la deviazione dentro la fascia sulle presenze, il solo
numero su cui battiamo la quotazione — vale **+29,9 fantapunti dentro il braccio di ieri e +37,0 dentro
quello che aspetta** (t 3,08 → 5,37, peggiore finestra −0,52% → −0,18%), e +0,56% robust anche con tre
bracci. *Il tempismo compra i POSTI in cima al mercato e il motore decide QUALI uomini li occupano*: sono
complementari, che è l'esatto contrario di quello che erano le nostre quote di reparto contro il tilt
(§17.4). **Prima di adottare un canale nuovo, misurare se rende più grande o più piccolo quello adottato
prima** — le due risposte esistono entrambe in questo file.

Due cure vicine respinte, e la seconda insegna un fatto sul banco.
- **Prezzare la coda a quello che costerà, senza aspettare** — la forma meglio fondata sulla carta —
  **vale ZERO** (+0,02% a peso 1, −0,09% a 0,5, −0,24% a 2). Quindi il meccanismo **non è il prezzo, è il
  momento**: a secondo prezzo abbassare un tetto su un lotto che avresti vinto comunque non cambia
  niente, e su uno conteso lo perdi e ricompri un uomo simile allo stesso prezzo.
- **Un moltiplicatore UNIFORME sulla scala è inerte per costruzione**, e si è scoperto misurandolo (righe
  identiche al decimale, `se` = 0): `Team.scale` normalizza il piano sulla borsa e lo cancella
  esattamente. È il §17.4 letto dall'altro lato — *quello che una scala non può vedere è un cambiamento
  che conserva* — e la cura è applicarlo per REPARTO, che poi si è misurato come terza istanza della
  ridondanza col tilt (−0,00%, t 0,00).

**E L'OTTIMO DEL BANCO NON È QUELLO CHE SI ADOTTA.** `DEPTH_TIER` ha un ottimo INTERNO che cade sulla
banda misurata dall'archivio (+1,69 · +1,69 · **+2,06** · +1,84 · +1,47 · +1,38%): due misure senza
ragione di concordare, che concordano. `DEPTH_HANDS` no — sul banco migliora in modo monotono fino in
fondo (+0,94% a 10, **+2,06% a 9**, +2,72 · +3,18 · +3,36 · +3,58 · **+3,85% a 3**), cioè il picco è la
pazienza del §22 con un'altra faccia, e quella era stata respinta perché **i prezzi che raccoglieva non
esistono a un tavolo vero**. Quindi si adotta la banda dell'archivio e si lasciano due punti percentuali
sul tavolo per scelta, con la guardia verificata: alla banda dell'archivio il braccio paga **0,90-1,24**
del prezzo vero tardivo per le prime due fasce di portieri e centrocampo, cioè gli uomini che decidono
una stagione li compra a prezzi reali.

## Il saldo esiste solo dove l'uomo è SOSTITUIBILE, e la causa di un difetto scritta a verbale può essere falsa
**02/09/2026 (notte tarda), `simulatore-asta-rilanci-v1.md` §23.** Domanda dell'operatore: «conviene
spendere di più appena un top del suo ruolo esce, o lasciar perdere perché gli acquisti in coda avverranno
a prezzi bassi?», con la premessa che è un requisito — **l'utilità del suggerimento è sopperire alla poca
lucidità al passare del tempo**, quindi «per ogni ruolo cosa ti serve e quali calciatori buoni per te
devono ancora uscire» è già il risultato. E si scopre che quel conto E il prezzo sono lo **stesso
oggetto**: quante rose vogliono ancora quel ruolo è il numero che decide il secondo prezzo.

**LA RISPOSTA È UNA SOGLIA SULLA FASCIA E NON UNA CURVA**, misurata sulle 10 aste vere a estrazione della
sua lega (2.495 aggiudicazioni), dentro la fascia perché un rapporto pagato/richiesta non è pulito dalla
composizione (§15.7): contro «quante delle dieci rose hanno ancora un posto in quel ruolo», le **prime due
fasce** leggono ×1,00 · 0,91 · **0,80** e non arrivano MAI in saldo (2-5% di aggiudicazioni a un credito,
**zero su 552** per la prima fascia di ogni ruolo); la **terza e quarta** ×1,00 · **0,50** · 0,50; **dalla
quinta giù** ×1,00 · **0,36** · **0,21**, con la quota a un credito che va dal 29% al 72%. Stesso segno sui
due meccanismi. La ragione è la sostituibilità — venti uomini per dieci posti da titolare contro un
riempimento che è più numeroso dei posti — quindi *conviene spendere appena esce* è giusto per i primi due
gradini e sbagliato per tutto il resto. In crediti sulla sua lega: P 1ª 60 · D 1ª 52 · C 1ª 112 · **A 1ª
270** (27% del budget, mai in saldo), e la quarta fascia di centrocampo e attacco passa da 20 crediti a UNO
appena il tavolo si assottiglia.

**E l'ipotesi letterale è stata ridimensionata dal test APPAIATO**: il k-esimo attaccante di prima fascia
legge 5,71 · 9,85 · 8,90 · 10,34 volte la richiesta, cioè il primo estratto sembra costare metà — ma
appaiando dentro l'asta è 160 crediti contro 255 con il primo più economico in **6 aste su 10**, e su
dodici celle provate una a 9/10 è quello che produce il provare dodici celle. Il meccanismo a CHIAMATA è il
contro-esempio che valida la lettura: là il segno si inverte in quasi ogni cella (0 su 7 tre volte) perché
il primo uomo di una fascia **è** il più caro. *Un effetto misurato dove l'ordine è scelto non è lo stesso
effetto misurato dove l'ordine è sorteggiato.*

**LA CAUSA DI UN DIFETTO SCRITTA A VERBALE VA RIMISURATA COME QUALUNQUE ALTRO NUMERO.** Il §18.3 diceva
che il fondo del mercato è sbagliato perché «ogni nostro partecipante ha un tetto positivo per ogni uomo,
quindi con dieci offerenti il secondo prezzo non arriva a uno». Misurato: le offerte da un credito su un
uomo valutato meno di mezzo sono **27 su 3.568** (1%) e i lotti più economici hanno **già una mano sola**.
La causa vera è il **SINCRONO**: i dieci partecipanti condividono una sola vista dell'urna (`tier_left` e
`hands` sono fatti sull'urna, non su di loro) e passano da «rifiuto» a «offro» insieme, quindi un uomo
fuori serbatoio trova sempre due o tre mani dove al tavolo vero ne trova una. La struttura invece è quasi
giusta (16,3% di acquisti fuori serbatoio contro 20,4%, 40,6 uomini del serbatoio invenduti contro ~50):
sbaglia il prezzo, mediana 3 crediti contro 1.

Cinque cure misurate e respinte, e tre lezioni che valgono oltre il banco.
- **La DISPERSIONE è respinta dall'aritmetica e non dal calcio**: un lotto si chiude al SECONDO prezzo, e
  il secondo massimo di dieci estrazioni disperse è più ALTO del secondo massimo di dieci valutazioni
  identiche. Più rumore alza il fondo (10,0% → 11,2% a uno sbandamento assurdo). *Quando il bersaglio è
  una statistica d'ordine, la dispersione non fa quello che l'intuizione dice.*
- **Una regola nuova può essere già contenuta in una vecchia, e il modo di scoprirlo è la DIFFERENZA**:
  «non offro su un uomo fuori serbatoio» ha effetto **zero** — 250 aggiudicazioni identiche, uomo per uomo
  e credito per credito — perché `Team.keeps` lo fa già e più severamente. Diffare un'asta costa un minuto
  e smaschera una regola inerte che una tabella di aggregati avrebbe fatto sembrare piccola.
- **UNA CALIBRAZIONE MIGLIORE DELL'AMBIENTE PUÒ COSTARE UN CANALE PREVISIONALE, e allora si scrive
  invece di adottarla.** Il secondo indice (il prezzo dipende anche da quante rose vogliono il ruolo) è
  MISURATO e sistema quasi tutti i bersagli a chiamata (aggiudicazioni al minimo 6,5% → 19,1% contro
  19,4%, gini 0,61 → 0,65 = 0,65); respinto perché **riordina i profili dichiarati** a chiamata (P3 dal
  terzo al secondo, +32,1) e porta l'adozione del §21 da +1,49% a **−0,35%**. Il che lascia una
  fragilità detta: **il margine di `INSIGHT` dipende dal fatto che la coda sia CARA** — sposta soldi
  dentro una fascia verso chi gioca, e se il riempimento costa un credito quei soldi non comprano più
  niente che gli altri non abbiano.

## Dieci contro dieci, e una soglia ASSOLUTA non si confronta fra budget diversi
**02/09/2026 (notte tarda), `simulatore-asta-rilanci-v1.md` §18.** Due osservazioni dell'operatore, e
tutt'e due hanno spostato numeri pubblicati poche ore prima.

**«I dati reali parlano di aste a 8 o a 10 partecipanti, nelle nostre simulazioni invece abbiamo 11 o
13?»** Sì, e era un difetto: `bench.py` metteva il braccio motore come UNDICESIMO al tavolo dichiarato di
dieci (e tredici col null a tre bracci), mentre tutto quello contro cui il banco è calibrato dice DIECI —
`rules.TEAMS`, la conservazione di `to_credits` su dieci budget, la FASCIA che è un rango diviso dieci, il
livello di sostituzione al 10 × posti-esimo uomo. Undici partecipanti portano il **10% di soldi e posti in
più** di quello che la calibrazione assume, tredici il 30%. Curato con `bench.seated` — **il braccio
prende una sedia, non se la aggiunge** — e la scala di mercato rimisurata sulle **60 aste vere a dieci
squadre** invece che su tutte e 131, con un movimento quasi nullo (la normalizzazione sul montepremi
faceva il suo lavoro): **la popolazione giusta è la ragione, non la dimensione del cambiamento**.

**E un confronto APPAIATO sopravvive a un campione che ne ammazza uno non appaiato.** Rimisurato a dieci
partecipanti e venti urne, il guadagno dell'adozione (lo stesso braccio, le stesse urne, con e senza la
scala) **migliora**: da +17,9% a **+20,2%**, 10 finestre di 10, peggiore +12,6%. Ma lo scarto dal miglior
umano (una media contro il MASSIMO su cinque profili) crolla da **+54,5 a +21,3**, e il null a tre bracci
da «+6,9, resta primo» a **−2,8, un pareggio**: erano numeri non appaiati su dieci urne, cioè rumore. La
frase giusta sul null è che **il vantaggio non sopravvive in modo misurabile alla propria concorrenza** —
la maggior parte del margine a una sedia era esclusività, e il meccanismo è misurato (i portieri di prima
fascia da 0,62 a **0,85** della richiesta quando tre bracci li vogliono insieme).

**E «≤5 crediti» è una soglia ASSOLUTA, quindi non si confronta fra budget diversi** (l'operatore, sulla
mia stessa frase): su 600 rose vere legge 10,7 a budget 500 contro 8,5 a 1000. La cura non è restringere
la popolazione ma trovare la definizione LIBERA DAL BUDGET, e ce ne sono due — gli uomini presi al
**minimo** (6,1 · 5,7) e quelli sotto l'**1% del budget** (10,7 · 11,0) — mentre 0,5% non è stabile. Il
fatto che ne esce: **il 24% di tutti gli acquisti veri costa un credito o meno.** E il bersaglio nuovo ha
scoperto un difetto che quello vecchio nascondeva: il banco legge **1,8-2,5 uomini a un credito contro
5,7-6,7 veri** mentre la banda ≤1% torna (9,9-10,7 contro 10,5-11,7). La coda del nostro mercato è
giusta, il **fondo** no — ogni nostro partecipante ha un tetto positivo per ogni uomo, quindi con dieci
offerenti il secondo prezzo non arriva mai a uno, mentre a un tavolo vero nove manager su dieci **non
offrono affatto** sul fondo del listone. Costa 12 crediti su 1000 e non muove un verdetto: è la FORMA del
fondo del mercato, e **una soglia scelta bene la rende visibile dove una scelta male la nasconde.**

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
**And an ignore rule is only as wide as its anchor** (25/08/2026): every line of the data section is
anchored to `/data/`, so a `bundle.sqlite` written in the repository ROOT was ignored by nothing - and
there was one. A public repo carrying paid content is one `git add -A` away from publishing it, so the
guard is now the un-anchored `*.sqlite` / `*.db` (measured before widening it: `git ls-files '*.sqlite'
'*.db'` = 0, so it hides nothing legitimate). The ignore is the net, not the cure: what still has to be
found is how `export` came to write outside its own declared folder.

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
depending on the club, so a share of a season could not be compared with the one next to it (Kane: 49% off 25
starts in 34 rounds). Fixed 29/07/2026: `clubs.csv` carries `league_XIs`, and the correlation between a
club's league share and its players' mean starting share went from **+0.796 to −0.172**. Two corollaries worth
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

## Un denominatore segue il suo NUMERATORE, e il confine di una permanenza è la data dell'altra
**20/08/2026, e la scala della titolarità ha reso visibile un difetto che questo progetto aveva già
incontrato e archiviato come limite dichiarato.** Nato da una frase dell'operatore su una lista di
`riserva` ordinata per FVM: «Malen è stato uno dei migliori giocatori della scorsa stagione, non può essere
una riserva» — un uomo col **secondo FVM di tutto il listone** che aveva giocato **tutte** le ultime 18
giornate della Roma, 18 da titolare, 82 minuti, 14 gol, e leggeva 18/38 = 0,444.
`external_stats` tiene UNA RIGA PER CAMPIONATO, quindi il numeratore di ogni quota di stagione è di un
campionato solo, mentre il denominatore era il calendario intero del club che compra: le 20 giornate
passate in Premier gliele contava **due volte**, come sconto sul numeratore (`at_club_weight` 0,937) e come
denominatore. L'esenzione era DICHIARATA in `season_calendar` («no single right denominator for him, so he
keeps his club's») e scegliendo il peggiore dei due — la stessa famiglia del 49% di Kane su 25 presenze in
34 giornate, un piano più sotto. `features.measured_season_rounds`: ogni campionato porta le giornate in
cui c'era, letto dal pannello E dallo sweep, e passato a `presence.contested` da un campo NUOVO
(`Inputs.measured_rounds`) e non da `league_matches` — quello è anche il divisore delle assenze, che sono
contate per stagione intera, e accorciarlo avrebbe corretto una quota e **rotto un'unità**.
Quattro cose che restano, e tre le ha trovate la misura invece della rilettura:
- **Il denominatore segue il NUMERATORE, non il calendario che sarebbe comodo avere.** La prima versione
  sommava le due finestre (21 + 18 = 39) e non curava niente, perché la metà Premier di Malen non è
  nell'aggregato: 18 presenze su 39 giornate. Dove tutt'e due gli aggregati esistono la risposta è la
  stessa (39 su 39), ed è questo che ne fa una regola e non un rattoppo.
- **Il confine di una permanenza è la DATA dell'altra, mai le sue presenze.** Legarla alla prima e
  all'ultima presenza restituisce ogni giornata in cui c'era e non è stato scelto — la stessa lusinga da
  cui è protetto chi smette di giocare a marzo. Chukwueze ha giocato UNA partita col Milan il 23/08 e a
  fine settembre era al Fulham: per le sue presenze è una stagione di una giornata giocata tutta, per il
  giorno in cui è comparso altrove sono le CINQUE giornate che erano. La finestra di mercato non è
  osservabile (ogni riga di `transfers_history` è datata 1º luglio), quindi l'intervallo fra due
  permanenze è addebitato a tutt'e due: nessuno è lusingato.
- **Chi ha un solo campionato non è nel risultato e non cambia di un decimale.** Una giornata in cui c'era
  e non è stato scelto è una prova su di lui; una giornata giocata in un altro paese non è sua da perdere.
- **E il limite è un'ACQUISIZIONE, non una formula.** Una permanenza si delimita solo col calcio che è su
  file, e il livello per-partita tiene i cinque campionati più i serbatoi: chi arriva da fuori non ha
  confine e si tiene il calendario intero. Costa uno dei quattro uomini su cui la stampa dissente (Taylor
  K., all'Ajax fino a gennaio, **una** riga di Eredivisie datata 10/08). La versione che delimita con
  qualunque competizione di lega è stata scritta e **misurata prima di essere tenuta**: 0 righe su 67, e
  quindi è stata tolta — una manopola che non muove niente è una manopola che nessuno ha misurato.
Effetto: `SHEET_REVISION` 36, 18 righe con la stagione spezzata sul foglio Serie A e **9 che salgono di
gradino** (Malen `claim` 0,405 → 0,810 e la board lo disegna; Raspadori `ballottaggio`), col prezzo detto
— la board è un'assegnazione, quindi Scamacca, Castro S. e Ngom scendono a quota invariata. `engine_*` non
si muove. Il giudice stampa resta 165/220 in aggregato e sposta Roma a 11/11 e Lecce a 7/11: **non
conferma e non smentisce**, e la correzione sta in piedi sull'aritmetica.
E il canale vicino è **misurato e respinto**: leggere solo il regime nuovo di chi ha conquistato il posto a
stagione in corso (795 uomini, 6 stagioni) è il **39% peggiore** come predittore da solo, la miscela vale
`w` = 0,1 e muove **4 gradini su 123**. La ragione era già scritta — «un effetto dentro la stagione non è
un effetto fra le stagioni» — e ora ha un numero. Dettaglio: `gate-motore-v1.md` §7-unquadragies.

## Una guardia deve interrogare il calcio che la FORMULA legge
**Stessa sera, e è la seconda istanza di una forma sola.** `play_share` chiedeva `MEASURED_FOOTBALL`, che
contiene la finestra misurata altrove; `appearance_share` quella finestra non la sa leggere (il ramo
`window_only` vive in `standing`, non lì). Quindi un uomo con dieci partite in un campionato che non
copriamo e nessuna qui PASSAVA la guardia e poi divideva ZERO presenze per 38, e `status_of(0.000)`
risponde `riserva` — una frase sul calcio, detta su un uomo che nessuno ha visto giocare qui (Alajbegovic,
32M di cartellino; Adams A.). 7 righe su 605, ora vuote. La guardia vedeva la prova che la formula non
poteva leggere: «vuoto = ignoto, mai zero» rotto dal lato per cui la guardia era stata scritta.

## Una lettura VUOTA non scavalca una piena, nemmeno se è più recente
**Stessa sera, e spegneva l'unico giudice che esista prima che si giochi una partita.** `press --sheet ...
--against press` leggeva «module MATCH 0, ALT 0, DIFF 20 | men **0/0**» e poi andava in errore formattando
un modulo None: `load_reference` tiene l'ULTIMA lettura per club ordinando per `(observed_on, source)`, e
la tabella aveva 20 club letti l'8 agosto CON modulo e undici e 20 letti il 17 senza né l'uno né l'altro.
Con `--source press` lo stesso comando leggeva 10/5/5 e 165/220. Ora una lettura senza modulo E senza
undici non scavalca una che ne ha. Uno zero uniforme è la cosa che questo progetto ha imparato a non
credere; qui non era un difetto di misura, era il giudice **spento per default**.

## Una seconda fonte per lo stesso fatto non e' un canale nuovo — ma solo dentro la sua popolazione
**25/08/2026, dalla domanda dell'operatore su un nome: «Varela del Monza si e' dimostrato essere un ottimo
calciatore, come mai non abbiamo nessun suo valore nel db?».** La riga c'era, il valore no: `est_pv` **10,7**
su 38, che e' la costante «nessuno lo ha mai visto giocare», addosso a un uomo con **34 partite di Primeira
Liga, 1522 minuti, 6 gol**. `est.presences_from_abroad` legge `external_stats`, che tiene **sei**
competizioni (le cinque piu' il serbatoio), e su quel gradino cadono **due popolazioni diverse**. Misurate a
parte (gate §7-duoquadragies), danno risposte opposte:
- **il campionato lo copriamo e l'aggregato ha un buco** — Milla 38 partite di Liga e 3277 minuti che
  leggevano 12,6 giornate su 38. **ADOTTATO**: i minuti li porta `tm_appearances` dove l'aggregato tace,
  `config.TM_CHAMPIONSHIPS` dichiara i codici del provider, e **niente altro cambia** — stessa quantita',
  stesso denominatore (`features.league_rounds`), stessa retta, zero parametri nuovi. Fuori campione +6,0%
  (n=455, 7 stagioni su 9). Che sia la stessa quantita' e' MISURATO: 10.580 coppie, differenza mediana
  **+0,0000**, correlazione **+0,9957**.
- **il campionato non lo copriamo** — il caso da cui la domanda e' nata. **RIFIUTATO per misura**: −6,9% su
  default (3 stagioni su 10), e non lo salvano ne' un filtro sull'eta' mediana della competizione (ogni
  punto negativo, e il guadagno cresce fino al BORDO della griglia) ne' un rifit (0,2405 contro 0,2448 della
  costante, con la pendenza a 0,20-0,25 contro lo 0,32 pubblicato). La retta non ha un termine di LIVELLO e
  legge mezza stagione di Primeira Liga come mezza di Premier League. Varela resta sulla costante, ora per
  misura e non per distrazione; a riaprire la questione servirebbe un termine di livello, o il numero di
  giornate dei campionati esteri come fatto DICHIARATO.

Quattro abitudini, e tre le ha imposte la misura invece della rilettura.
**La distinzione che decide e' «predittore nuovo» contro «secondo lettore dello stesso fatto»**, ed e' la
stessa di `synth.calibrated_competitions`: dove un numero si puo' applicare e' una proprieta' della
popolazione su cui e' stato fittato, quindi la seconda fonte entra dentro quei sei campionati e si fermerebbe
al primo che non lo e'. Detto per intero: letto come REGOLA previsionale il braccio adottato fallirebbe il
terzo comma del criterio pre-registrato (peggiore stagione −2,6% contro −2%); entra perche' e' un ripiego di
sorgente, e la prova e' il +0,9957, non la tabella dei MAE.
**L'arnese si verifica sui numeri PUBBLICATI prima di giudicare qualunque cosa**: la retta di v9.56 e' stata
riprodotta (n=322 contro 323, coefficienti (0,336, 0,327) contro (0,339, 0,320)), e la prima passata leggeva
n=890 perche' la popolazione era «meno di 15 voti a t−1» invece di «nessuna riga» — senza i numeri pubblicati
non c'era modo di accorgersene, e la seconda passata ne ha trovato un altro (il 2015-16 mette in popolazione
mezza Serie A, perche' a t−1 nessuno ha una riga).
**Un massimo non e' un conteggio, se la tabella porta anche le righe di un altro club**: il numero di
giornate di una competizione si stima per (uomo, **club**), perche' chi cambia squadra a stagione in corso
porta le righe di tutt'e due (`state = 'not in squad'`, minuti NULL) e la Serie A leggeva **73** giornate.
Corretto, lo stimatore riproduce `features.league_rounds` **39 volte su 40**, e **5 uomini su file bastano**
perche' sia esatto (con 3 sono 37/39, con 1 sono 25/39) — misurato, non scelto.
**E `features.league_rounds` per l'estero NON restituisce giornate di campionato**: legge `MAX(real_md)` dal
livello per-partita, dove le competizioni fuori perimetro arrivano con lo slug del provider e il suo id di
turno — `uefa-europa-league` ne dichiara **636**, `coppa-italia` 32. Oggi e' inerte perche' `external_stats`
porta solo i sei nomi nostri; e' una trappola per il prossimo che allarghi quel lettore, ed e' la ragione per
cui il ripiego passa per i nostri sei nomi e non per la chiave del provider.

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

**And where the null is not a reshuffle but a MODEL, the SHAPE of that model is half the result**
(07/09/2026, the xG question: `metrica-asta-surplus-v1.md` §29). Goals are not `Poisson(xG)` — they are a
sum of Bernoulli over SHOTS, variance `Σp(1−p)` and not `Σp` — and with the Poisson null a forward's
conversion reads UNDERdispersed (chi²/df 0.74), i.e. «no skill, less than none»; with the right null it is
1.03-1.19 and the true player component is ~0.06 against a noise of 0.17. **A wrong null does not merely
cost power: here it reversed the sign of the conclusion.** Two habits travel with it: the direction of the
approximation is DECLARED (equal-p inside a match maximises `Σp(1−p)` at fixed xG, so that 0.06 is a FLOOR
and not an estimate); and the paired design answers «whose is it?» without any model at all — the same man
at different clubs reads +0.142 over 90 pairs while different men at the same club-season read **−0.014**
over 362, so what little exists belongs to the MAN and the club explains nothing. What the club does move
is the VOLUME of xG (+0.254), which is the quantity to look at when a striker transfers.

Related and already learnt: the exploitable signal in these per-match questions sits on **who plays**, not on
the voto - `Var(ln pv)` is 90% of `Var(ln` total fantapunti`)`. And a Serie A match RESULT is derivable
offline from `match_ratings` (`platform='default'`): `goals` is net of penalties AND own goals, so
goals-for = `SUM(goals) + SUM(pen_scored)` and goals-against comes from the `role='P'` rows.

## The model of a decision must respect WHEN the decision is taken
**25/08/2026, and it flipped the advice by a factor of five.** Asked whether two players of the SAME club
are worth having, the one-slot model fielded «the better of the two who got a vote» — a choice nobody can
make, because the line-up is handed in BEFORE kick-off. Scored that way, diversifying is worth −2.21 points
a season (goalkeepers −5.89, the same club losing 31 pairs of 32); scored with the game's own rule — you
name a starter and the other comes off the bench — it is **−0.42, and the same club wins 46% of the pairs**:
a coin. The gap between the two numbers is the price of information nobody has, and it must be subtracted
rather than banked. Same family as «vuoto = ignoto» and as the fielded zero: the first pass of that same
measurement read an absence as a ZERO and reported the variance of a same-club pair as LOWER, and putting
the bench back in (A = 6.79) turned the sign round.
Two habits travel with it. **An insurance is priced against what already covers you, not against nothing** —
with two keepers of one club the rounds where neither plays fall by 5.2 of 38, a big effect that yields no
points, because the man who covers that hole is the BENCH, the third keeper who is on the roster anyway.
And **an effect real in the population can be pure noise per individual**: the fantavoto correlation of
same-club team-mates is +0.13 against a null of 0.00, yet it does not persist between seasons (+0.002) nor
between the two halves of one (+0.014) — Scamacca + Krstović read −0.05 on the championship calendar and
−0.21 on EuroLeghe, one fact and two numbers. What IS knowable in August is the mantra role: `pc`+`pc`
clash at −0.151 against −0.061 for every other pairing (difference −0.090 ± 0.028). Numbers, the refused
readings and the pair-by-pair table: `docs/model/metrica-asta-surplus-v1.md` §24.

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
**THREE judges score the boards, and the third is the one that exists when it is useful** (24/08/2026).
`press --against round --round N` is the OUTCOME restricted to the rounds ALREADY PLAYED: the same
evidence, the same arithmetic and the same null as `outcome`, available from the first weekend instead
of from May. The press is a forecast by other people; the outcome needs a finished season and therefore
a back-dated sheet; between an August auction and May there was nothing, and the sheet the operator buys
from is current in exactly that gap. It is judged on the `board_shape` for `outcome`'s own reason
(`club_match_lineups` holds three lines and cannot say 4-2-3-1), the unit is the MATCH and never the
matchday (`real_md`, and the entry carries the date so a postponement is visible), and the SHAPE is
complete while the MEN come through the identity funnel - so the report says, per club, how many of the
eleven it resolved. On the 1st round of 2026-27: Serie A modules 9/18 against a null of 7/18 and men
64,0% against 55,9%; euro 18/23 against 16/24 and 63,1% against 51,0% - four measures of four above the
null, on NINE matches, which is not a verdict and is stated as such. Two things travel with it. **A board
with fewer than eleven men is not a wrong forecast** but a club whose contingent on that sheet cannot
field one (`short_board`, counted apart the way the null counts a promoted club apart) - the euro sheet
of 20/08 carried 5 Como rows against 29 quoted. And **«is this round scored?» is asked per CLUB, never
per round**: a round is scored from its first match, so a global flag turns every man of a match still
being played into a MEASURED no-voto - twenty-two zeros invented by the question.

**Two judges scored the boards before that, and the second one is the stronger** (08/08/2026, `press` module).
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
- **...E UN CANCELLO IL CUI DENOMINATORE CONTIENE CIÒ CHE DEVE TOGLIERE SI SPEGNE DOVE SERVE**
  (07/09/2026, dalla richiesta dell'operatore «evitiamo assolutamente che calciatori non più presenti in
  una squadra non si aggiornino tempestivamente»; dettaglio: spec «Novità v9.86»). Tre difetti, tutti nella
  LETTURA e nessuno nel dato — di Cheddira l'archivio aveva già il trasferimento all'Avellino e il Napoli
  era stato riletto ogni giorno senza di lui. `complete_squads` chiedeva il 90% degli uomini che il FOGLIO
  mette in quel club, cioè un denominatore gonfiato dai partiti: Napoli 26 iscritti contro 31 righe = 0,84,
  cancello mancato, **e i cinque della differenza erano esattamente i cinque assenti** — sei club su venti
  spenti così, tutti e sei quelli con più di due partiti. Il riferimento è ora la **mediana delle ultime
  cinque letture DELLO STESSO club** più un **pavimento assoluto** (`SQUAD_FLOOR` = 16), due condizioni per
  due domande diverse: una vede una lettura troncata, l'altra il publisher cronicamente magro per cui
  `SQUAD_COMPLETENESS` era stato scritto. E `still_buyable` guarda la **DATA** dell'avvistamento e non solo
  il club: un avvistamento più vecchio della lettura che non lo trova è la stessa lettura, guardata prima —
  ma solo per il club della riga, perché visto ALTROVE nella piattaforma resta comprabile (il caso Molina /
  Bruno Guimarães del 17/08). `ABSENT_READS` = 2 letture piene, con la curva misurata sulle nostre stesse 20
  date: un'assenza da una lettura si rimangia il **4,9%** delle volte, da due il **3,4%**, da tre l'1,5%.
  **Il 83,1% citato qui sopra è la precisione del cancello VECCHIO** e non descrive più la regola in vigore.
  Tre habits: **la cura ovvia era un'identità aritmetica** (togliere gli assenti dal denominatore rende
  `ids ≥ 0,9 × presenti` sempre vera, cioè il cancello un ornamento); **la sottigliezza distrugge il
  significato di un'ASSENZA, mai quello di una PRESENZA** (giudicare l'appartenenza solo sulle letture piene
  toglieva Olivera, Kean, Rowe e Beto, che stanno nel payload di oggi); e **un'ipotesi sul mondo non batte
  un conteggio sul dato** — avevo segnalato come implausibile l'uscita di Caicedo dal Chelsea usando
  conoscenza di una stagione che questo dataset ha già giocato, e dei 133 usciti dai payload dopo la
  deadline il 6% ha un infortunio aperto e il **79% un trasferimento datato in questa finestra**.

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
vote from a line that never saw their competition, while ~~ten **Bundesliga** matches recovered by another
module were left out because of the same tag~~. Eligibility is now the COMPETITION's
(`synth.calibrated_competitions`, derived from the overlap itself): 241,913 matches of 250,678 convert, the
rest stay NULL.
**THE EXAMPLE STRUCK OUT ABOVE IS NOT VERIFIABLE, and this replaces a stronger claim I made and withdrew
within the hour (06/09/2026).** What can be measured: FOUR men have exactly ten matches under a
`bundesliga%` key in that layer — **Koulierakis, who is GERMAN**, plus Alajbegovic, Irving and Pavlovic,
who are Austrian — so *the count identifies nobody*, and if those ten were Koulierakis's the original
sentence was right. The sentence also measures a state of the DB that no longer exists: that layer went
from 81 to 399 rows in the five championships on 06/09/2026.
**What DOES stand, and it is the part that matters**: the provider spells `bundesliga` for the German
championship AND for the Austrian one (36 rows of Red Bull Salzburg and Austria Klagenfurt were sitting
under our German key, where the line converts them), so the tag was the wrong gate for a reason nobody had
named. The rule is untouched, and the argument for it is stronger with a measured example instead of an
undecidable one: what the SOURCE tag was really costing is **352 rows of 45 players** whose Premier League,
Liga, Ligue 1 and Serie A matches were archived under the provider's slug and refused for a hyphen — 17 of
them arrivals of the listone in use.
**AND THE WITHDRAWAL IS THE LESSON, not the correction.** I had written that those ten matches were
Alajbegovic's and that the case cited in SUPPORT of the rule was one the rule must exclude — a good
reversal, and undecidable on the data. A claim stronger than its evidence, published in the file that
teaches how to measure, is the same defect as the example it was curing, one level up. It was caught
because another session re-ran the query and its own retraction had gone to a third one that had already
closed: *a correction that travels through a third party is a correction that can be lost.* Two corollaries the
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
already contains its author's opinion about how much the man will play**, so predicting it with the price is
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

## A sealed bid is a THIRD game, and what decides a bid is «what will it TAKE»
**25/08/2026, `app/src/app/core/sealed-bid.ts` + `views/sealed-bid/`, details in
`docs/model/todolist-buste-chiuse-v1.md`.** Every manager writes one number in an envelope, the highest
pays HIS OWN number, losing costs NOTHING, and a tie awards the man to nobody. Nothing on that page
predicts a footballer — the valuation is the sheet's, read and never recomputed — and everything it
computes is about SLOTS, CREDITS and RIVALS, which is the same boundary that put a real club's board in
the toolkit and a fanta eleven in the app.

**The currency is the GAIN and the two alternatives are refused for reasons already written down**:
`surplus × (competition rounds / matchdays) × (Pv/matchdays)^reliability`. Not the OVERALL, which is a
total with NO zero (an auction is always «instead of somebody else», so with no zero the column crowns
whoever plays and says nothing about what a SLOT gains); not the bare SURPLUS, which prices 38 matchdays
on a market that buys 37 and does not discount a season you have to be able to FIELD. Its bands are
percentiles of the WHOLE listone, cut once (`ui/gain-chip`): on the free board the same man would turn
`ottimo` because somebody else was bought, which is a statement about the market and not about him.

**Three rules are DECLARED by the operator and applied as CONSTRAINTS, never as weights** — no gate owns
them, and each one reports where it cannot be met, because a constraint that gives up in silence reads
exactly like one that was satisfied. (1) As many men who simply PLAY as an eleven fields, per role
(counting the squad — `sureTarget`, and since the same evening this is his FLOOR of two per role while
what «covered» means moved to the department's own holes, below). (2) THE KEEPERS
ARE A DIFFERENT GAME: you field one, so what has to turn up is the SHIRT — own both sides of a fight or
own somebody who is not in one — which is also why they are exempt from (1), a pair being two men of whom
one plays each week. (3) The plan MIXES serious bids with 2-credit shots, and that is arithmetic and not
taste: since losing costs nothing, what an envelope is worth is `gain × chance(price)` and not the gain,
so the knapsack chooses the NUMBER as well as the name. Evidence it is real: 37 of 125 awards in round 1
of the operator's league cost one or two credits, Mora (FVM 100) and Dybala (70) among them.

**Four lessons that outlive the page.** A PRICE IS A FACT WHOEVER HE IS: an award whose id the listone
cannot name still leaves that manager's pocket, and skipping it read him RICHER than he is — every rival
model on the page is built on `credits`/`ceiling`, so what cannot be attributed is the ROLE, and the
count of such rows is stated. TWO KEY SPACES THAT OVERLAP is a defect no unit test sees: `swaps` is keyed
by the man the SOLVER proposed and `extras` by the man added BY HAND, the same person can be both, and
reading one map with the other's key put a substitute in a hand-written envelope. «VUOTO = IGNOTO» HAS A
SECOND FACE — hiding the man: a name without a number is not worth zero *and* is not invisible, so he
sits last with a dash and only the automatic plan refuses him (found on «come mai non mi esce il portiere
Martinez dell'Inter?», who is expected in 10.6 matchdays of 38 against a 35% floor). And A THRESHOLD
COMES FROM ITS OWN QUESTION: «do not suggest a man out for a month» is 30 days and not the 45 that decide
whether to draw an icon.

**And three about the harness, all the same shape — what the DOM says is not what the screen does.** A
CDP pointer TELEPORTS, so a popover stays open where a hand would have closed it: it covered the offer
field and the suite read «I typed 95 and the box says 55», two defects the app did not have. A long
TOOLTIP covers the control it is explaining. And a step that cannot find its target must SAY SO — «zero
problems» and «I did not look» must never read the same.

**A CLUB-MATE IS NOT THE OTHER SIDE OF A FIGHT, and A PER-MAN BINARY CANNOT ANSWER A QUESTION ABOUT A
SET** — the two corrections of 25/08/2026 (late), both found by the operator on real recommendations, and
the second one is the durable half. Rule (2) above was applied only where the mate is SEARCHED for, so the
three places that decide whether a pair EXISTS looked at the club and nothing else: Di Gregorio
(`panchina`) + Perin (`riserva`) read **zero gambles** while the shirt belonged to Vicario
(`ballottaggio`), who was in no envelope — «senza Vicario non ha senso offrire delle buste per loro». One
definition now (`ownsShirt`): TWO claimants on that shirt, one of whom the BOARD DRAWS, which is the
toolkit's own gate quoted («a man the eleven fields never falls below `ballottaggio`») and not a threshold
of ours. The arithmetic is not what refuses the wrong pair — it PREFERS it (33.9 points against 30.7,
because 26.9 + 13.3 appearances tile a 38-round season while 26.9 + 23.6 overlap), which is why this is a
constraint and not a currency. An UNKNOWN rung does not refuse a pair while the mate search still requires
a read one: to ACT on a man you need evidence, to REFUSE him you need evidence too.

The same evening, one department along: «la difesa è SCOPERTA» on five defenders of whom three are
`bandiera` and two `ballottaggio`. `playsOften` answers false to a `ballottaggio`, so the verdict counted
3 of 4 places — true about each man and the wrong question about the SET: those five own shares (0.87 ·
0.81 · 0.67 · 0.66 · 0.50) cover **3.36 places of four, i.e. 0.64 of a hole a matchday**. So «coperto» is
now `expectedHoles` — the men of a role are independent draws, «how many have a vote» is a convolution,
the expected shortfall is a sum over it, exact and not simulated — with `HOLE_TARGET` = 1 whole place
DECLARED (what a hole costs is measured, when to spend a credit on it is a preference). One definition,
THREE readers: the verdict, the plan's repair, and the choice of the reference shape. His morning rule
(«le buste consigliate devono rispecchiare i consigli che dai reparto per reparto») survives while its
mechanism changes, and `sureTarget` goes back to being his floor of two — which is what stops the plan
asking a fourth regular defender of a man who has five.

**THE REFERENCE MODULE IS CHOSEN, AND THE DEFENCE MODIFIER IS A DECLARED INPUT** (same evening, his
instruction). It was hard-coded to 1-4-4-2 — `features.fielded_places`, correctly quoted and neither of
the two shapes the room plays: «il 3-4-3 è molto gettonato ma per chi usa il modificatore di difesa anche
il 4-3-3 è molto frequente ... devi tarare le buste scegliendo quale dei due prendere come riferimento in
base ai calciatori già in rosa e quelli rimanenti». So `referenceShape` reads the places from
`classic_modules.json` (configuration, read and never transcribed) and picks: his two shapes FIRST, the
rulebook's other five only when neither is coverable and only if one is STRICTLY better, so a tie never
moves the target he is buying against. Shapes are compared on what cannot be filled (holes minus the
regulars still reachable within his ceiling — the «e quelli rimanenti» half) and then on the holes. The
modifier is `LeagueRules.defenceModifier`, a switch beside the budget and the slots because it is a
REGULATION («deve essere una informazione da mettere come input»), and it decides the SHAPE and touches no
valuation: it pays on the average vote of the defensive block and nobody here has measured that. Two
consequences worth stating: both his shapes field THREE forwards, so a third forward is a starter and not
depth — which corrects a measurement of that same evening made on A = 2 — and the plan CARRIES the shape
it used (`BidPlan.reference`), drawn beside its own title, because an automatic choice must be doubtable.

**A DECLARED NOTE IS THE CHANNEL FOR WHAT THE MODEL CANNOT REACH, and the page has to READ it.** «Vedo
Lukaku nei nomi contesi ma ormai non è più in serie A» — and the sheet keeps him for a reason:
`snapshot._still_buyable` removes a man only when a TRANSFER names where he went, while the live squad read
that no longer lists him leaves `desc_live_club` pointing at his last sighting (Napoli, 10/08, on a sheet
whose Napoli was re-read on the 20th without him). The evidence is in the bundle — **40 rows of 605** are
absent from their club's freshest read — and it is NOT adopted as a rule: Djimsiti, Bennacer and Angelino
are among them, a payload is «the first team as the provider chose to publish it», and the absence signal
was measured 83.1% precise at a completeness gate the app cannot see. What was missing was that the page
ignored `config/player_notes.json` altogether: `Bidder.outOfSquad` now travels with the row and `buyable`
refuses him, so he leaves the automatic plan AND the contested names, stays on the board and stays
offerable by hand. Only `out_of_squad`: `dispute` and `wants_out` are states of a RELATIONSHIP and a man in
either can still be fielded, so reading them as an absence would be inventing a fact from a different one.
Open for the toolkit, with its population already counted: `_still_buyable` must read the DATE of the
sighting and not only the club.

**A SILENT RESET READS EXACTLY LIKE «THERE WAS NOTHING TO KEEP», and the round log was written only by
hand** (25/08/2026, from «caricare le nuove rose conservando la tornata precedente»). A new roster export
CLOSES the round on screen, so `setSnapshots` clears the swaps, the hand-written offers and the envelopes
added or removed — rightly, they are all facts about that round. But the RECORD (`logs`, the only entrance
to `settle`) was written only by the «registra» button, so whoever loaded the file that opened the
envelopes without pressing it lost that round for ever, and the page went on preparing the next one
without saying it had thrown anything away. `closeRound` puts them on the record BEFORE the export
replaces them and the order is forced — reading them afterwards reads the empty — while a round he
registered himself is never overwritten: what he sent beats what the screen still showed. Two habits
travel with it: **two records are two kinds of evidence and the row says which** (`RoundLog.auto`, «as I
sent them» against «as they stood when the export arrived»), and **zero new awards is not a round** — it
is the same state read again, and the page cannot know whether a round ended with nothing assigned or he
only wanted fresher rosters, so it says what it did and NAMES the way back instead of inferring the
regulation. What is not weakened is the calibration: the chances still come from a ladder built before the
new export was in, so a forecast is never scored by a round it has already read.

**And «SOLITARIA» WAS THE WORD NOBODY READ** (same evening, and the third instance of one shape in a day):
the keeper rule was still a per-man rail, so a `ballottaggio` bought BESIDE a `bandiera` was swapped out
of the plan and counted as a gamble, while the department behind him was covered. `keeperAnchored` — a
keeper who plays, or a shirt owned outright — with no threshold and no new constant, because the
operator's own sentence IS the test, and re-read at every repair step since a repair can bring the anchor
in. Same question for the counter the screen reads, or the verdict would say one thing and the solver do
another. And `expectedHoles` now knows the keepers: two men of one club never play the same match, so the
cover is the department's own sum (`keeperCovered`, the one `keeperGain` already discounts by) and not a
convolution of independent draws, which read Milinkovic-Savic + Meret at **0.87** of the calendar where
they cover **1.00**. The answer to the request is that the objective gets there BY ITSELF once it can
afford it (at 257 of ceiling Provedel + Palmisani, with 17 credits more Falcone + Provedel: department
26.8 → 34.9, holes 0.18 → 0.07) — not a judgement about the goal, the budget. And a number that FALLS is
compared with the objective that produced it before being called a defect: `gain` is the total if you win
everything, so more money buys dearer and likelier envelopes and that total drops by construction, while
`expectedGain` rises on all seven ceilings tried (107 · 118 · 135 · 144 · 156 · 162 · 180).

## A LIST PER ROLE CANNOT EXPRESS A JOINT CONSTRAINT, which is why the strategy page MARKS
**26-27/08/2026, `app/src/app/core/strategy.ts` + `views/strategy/`, details in
`docs/model/pagina-strategia-v1.md`.** A fourth page (`/strategy`): the operator declares his league -
listone, game, roster shape, budget, raises or draft, participants - and it draws one BLOCK per role with
the best names. Nothing here predicts a footballer either: the valuation is the sheet's, read and never
recomputed, and what is deduced is about PLACES, PARTICIPANTS and the rulebook.

**THE CURRENCY IS THE AUCTION'S, and it is measured rather than chosen**: the SURPLUS with raises (there
the scarce resource is the credit, which is exactly what the surplus subtracts against) and the VALUE in a
draft (there you spend PICKS, and the surplus charges a per-slot scarcity the rulebook does not impose:
−4.0% over the bench's five windows). Stated rather than hidden: that measurement was made on MANTRA, so
«draft + classic» extends a conclusion outside the population it was taken on.

**THE LENGTH OF A LIST IS THE ROOM'S OWN DEMAND**, which is the operator's own rule («sufficiente ad avere
sempre un'alternativa considerando la distribuzione di quel ruolo per ogni partecipante»): on classic it is
a count - eight defenders for eight participants is 64, and the guarantee is exact - while on mantra the
roster has no per-role quota at all, so the demand comes from the SHAPES (`slotShares` /
`demandFromShapes`, the placeholder §15.4 already declares). One floor is declared: at least one man per
participant, because the roles OVERLAP and a per-role demand underestimates the drain - a `Dc;B` bought as
a `Dc` is one braccetto fewer for everybody else.

**AND THE OPERATOR'S OWN RULE WAS RIGHT ABOUT THE PROBLEM AND REFUSED IN BOTH ITS FORMS** («conviene
sempre schierare un calciatore nella posizione del modulo più difensiva rispetto ai suoi ruoli ... un C/T
conviene prenderlo per metterlo come C in modo da lasciare la posizione T a un T/A»). The problem is real
and measurable: of the top 16 trequartisti of the Serie A mantra sheet, **15** can play as a C and 12 are
also in the C block's top 26; the esterni 18 of 23; the braccetti 10 of 10 - those blocks repeat the one
behind them. But keeping only each man's DEEPEST place leaves the BRACCETTI at **zero** names on both
listoni (every quoted braccetto is also a `Dc`, a `Dd` or a `Ds`), the esterni at 19 against a demand of
23; and putting the natives FIRST and cutting at the demand is worse - the trequartisti block's total gain
goes from 256 to **−9** and the attaccanti esterni from 116 to **−94**, with McTominay 27.8 and Dimarco
37.0 disappearing. **A list whose first names are worth less than the bench is not a list to buy from.**
So the rule MARKS (`↓C` beside the gain) and the literal reading is one click away with its price stated.
The reason is `metrica-asta-surplus-v1.md` §16 met from the display side - a per-role quota cannot express
what the rulebook rations - and where the principle really decides, the ASSIGNMENT, the app already
applies it exactly: `mantra-legal.ts`'s matching moves the C/T to C by itself once you own a T.

**«More defensive» is MEASURED on the rulebook**, never a hand-written list: the deepest LINE the modules
ever put that role in (Dd/Dc/Ds/B 1 · E/M/C/W 2 · T/A 3 · Pc 4), ties broken by the order the rulebook
declares. The MINIMUM and not the mean, and the reason is a stated limit: the means put M at 2.00, C at
2.06 and E at 2.07 - three different jobs at one depth (a wing back is a flank, a mediano is the centre) -
so deciding between them on seven hundredths would be inventing an order. **Inside the midfield that word
separates nothing**, and saying so is the point.

Three things the page SAYS instead of filling in silently, all of them this project's own habits: a
(listone, game) combination the bundle does not carry - euro/classic today - is never filled with the
other game's sheet, because a surplus is a fact about the GAME you are buying for (hence
`ValuationStore.sheets` and `expectationsFor(sheet)`: one reader of the engine columns, now reachable for a
NAMED sheet); a declared league that disagrees with the sheet's own teams and slots keeps the sheet's GAIN
and gets the declared LENGTHS, with the mismatch drawn; and the budget enters no number yet.

## A PREFERENCE ON TOP OF A MEASUREMENT IS A PREFIX, and the boundary between them is drawn
**27/08/2026, `core/manual-order.ts`, on the operator's request** — «nei vari blocchi le liste devono essere
riordinabili in modo che posso impostare il mio personale ordine di priorità». The strategy blocks are
ranked by a measurement (the GAIN); what he adds by hand is a PREFERENCE, and the two must not blend.

**The model is a PREFIX**: what is stored is the sequence of names he ARRANGED, and everything he has not
touched stays below in the measured order. The simpler design — store the whole visible list on every drag —
degrades badly and the reason is measurable: a new arrival the sheet prices at 40 would land **below eighty
defenders**, i.e. invisible, while under the prefix he appears at the top of the measured half, right under
the arranged names. It is «vuoto = ignoto» applied to an ORDER: a name nobody ranked is not a name ranked
last. Storing the MOVES instead («three places up») does not survive a list that changes length, which is
what every settings change does.

**And the boundary is DRAWN, not implied**: the position number of his own names is bright, the block
carries a ✕ that returns to the measurement (and appears only when there is an order to undo), the bar
counts the arranged blocks. A list that is half preference and half measurement and does not say where the
line falls is the defect this project keeps paying for. `RoleBlock.pinned` is that number, and the order is
applied BEFORE the demand cut — a name arranged at the eightieth place must stay visible, and applying it
after would cut him from the very list he was put in. The key is `listone|gioco|ruolo` and deliberately
NOT the sheet: a preference is a fact about his league and the role, not about the revision we are reading,
so a new export keeps it while a different game never inherits it.

**The gesture is CDK's** (`cdkDropList`), the operator's own choice of 27/08/2026 — and it reopens a door
this project had closed, which is why the record matters more than the swap. CDK was thrown out of the
TABLE on 18/08 on two counts, and **one of them was later disproved**: the «buchi / disallineamenti» he had
seen were an `nz-tooltip` eating a grid column, not CDK (`letture-app-v1.md` §17). What remained measured
was the release frame on a fixed-layout row of `<th>`; a list of `<li>` that scrolls is what `cdkDropList`
is for. So it was MEASURED rather than argued, on exactly that frame: mid-flight **1 preview, 1 placeholder,
3 rows translated**; at release **0 previews, 0 placeholders, 0 leftover transforms**. The package was
already installed (ng-zorro depends on it), so this declares a dependency instead of adding one — and
`column-drag.ts` went back beside the table, because a module moves for a reason and that reason is gone.
Verified the only way a gesture can be: with a real pointer, **counting the events that ARRIVE**
(`pointerdown` 1 · `pointermove` 9 of 9 · `pointerup` 1), the name still first after a reload, the ✕
restoring the gain. What did NOT change is the model: `withRowAt` takes the final index CDK declares and
returns the prefix — the DOM is CDK's to move, the order stays ours.

**And the modules that list ranks were measured the same day** (`metrica-asta-surplus-v1.md` §26): all
eleven mantra shapes field **5 defensive and 5 offensive places** — the rulebook says so about itself,
refusing the classic modifiers because «gli schemi sono già bilanciati» — while the places a BONUS man can
take run from 3 to 5, and the 4-2-3-1 does not offer a higher probability, it DEMANDS four of them. The
ceiling in POINTS varies by **1.15%** and its winner changes with the reading, the listone and the budget:
the shape is not a lever. What changes is the price — the surplus 100 credits buy falls monotonically from
`Por` 44 and `B` 38 to **`Pc` 8.5** — so two `Pc` places are the most expensive way to fill the offensive
five, **and the answer flips in a draft**, where picks are the scarce resource and the `Pc` gives the
highest absolute surplus of any role. You pay the absolute fantamedia and win with the marginal one; the
shape is chosen after the auction, from what you own.

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
who STARTS: that is where to go back, not to a bigger formula.
And where a rival is DRAWN is an assignment, not a per-man choice: the same day, «evitiamo posizioni con
tanti calciatori in alternativa e posizioni senza alternative» turned the dedup rule into one allocation
over the whole pitch (real-role fit dominating, a convex crowd price, a price for moving inside the line),
and the empty places went 126 → 91 on Serie A and 218 → 165 on euro with the same men drawn.

## A DERIVED pair has two halves, and WHICH ONE you predict is a decision
**20/08/2026, found by the operator on a striker: «come e' possibile che Malen ha solo 5,67 come MVa?».**
`FM = MV + bonus per appearance`, so one half is predicted and the other falls out - and the sheet derived
the MV, `engine_fm_pred` (already regressed toward the anchor) minus his own RAW bonus rate, taken whole
from fifteen votes up. So the whole regression landed on the base vote: 18 votes, a measured MV of **6.75**,
a column reading **5.67** - below every base vote of his career. It is the defect the comment beside it
already described for every OTHER rung («deriving it there too would dump the whole regression onto the base
vote, which is how Kolo Muani first came out at 5.29 against the 6.06 he actually averaged»), committed by
the one rung that derived. «One number and one derivation» was right and is kept; what was wrong was which
half. Now the MV is predicted (`est.mv_predict`) and the RATE is what falls out - `fm - mv` is still the
bonus per appearance the row expects. Every parameter cross-fit on 2092 Serie A and 1708 euro season pairs:
`MV_BETA` 0.45 / 0.40, **unanimous on 10 folds of 10 and 5 of 5**; `MV_FROM_FM` 0.55, interior; the club's
level is base vote only in part (`CLUB_MV_SHARE`, and the part is ordered as football says - a solid defence
is marks, a strong attack is bonus). `SHEET_REVISION` 32, `engine_*` untouched.
Five things that outlive the column, and four of them are rules this project already had.
- **A POOLED correlation justifies nothing about an individual.** The reason written in the file for taking
  his own rate whole was «r = +0.842, far above anything else this project carries season to season». It
  reproduces to the decimal and it is pooled over the roles: **within the role it is +0.488**, and nearly
  all the rest is the gap between a keeper at -1.29 and a forward at +0.74. Same lesson as the age channel,
  met on the parameter that had been adopted by citing it.
- **The parameter was not mistuned, it was at the EDGE of its grid - and the edge was the worst point.**
  b = 1 gives MAE 0.2470 against **0.2449 at b = 0**: taking his own rate whole loses to ignoring it
  entirely, and the optimum at 0.45 is 0.2163. The rule «never adopt a parameter at the edge of its grid»
  existed; here the edge had never been looked at, because nobody drew the grid.
- **The operator's football sentence was itself a measurement.** «Chi segna ha sempre o quasi un voto buono»
  is `r(MV, bonus rate)` = **+0.787** within the role for forwards (+0.79 euro, C +0.63, D +0.50, P +0.28),
  so subtracting the rate from a fixed FM imposed a slope of **-1** on a relation the data puts at +0.39.
  When he says a number is impossible, measure the relation he is describing before defending the formula.
- **A CONTRADICTION is evidence, and it costs no season of waiting.** The base vote is what the two
  platforms SHARE, so the same man had to read the same MVa on both sheets and did not (Gimenez 5.83 on
  classic against 7.08 on euro, 46 men of 269 over 0.40). That is a defect provable with no outcome at all;
  it is now 0.107 of mean gap and 6 men of 269.
- **And the number that was needed was already in the file.** The replaced block recorded «anchor +
  b(his - anchor) 0.148 at b = 0.45» and then refused it, for fear of a second free number contradicting
  the first. Deriving the RATE removes the fear entirely - so the refusal, not the measurement, was the
  mistake. When a comment says «measured, and refused on purpose», check that the purpose still holds.
Numbers, the refused channel (his own rate ON TOP of his own base vote: d = 0 on ten folds of ten - the
population relation is already inside the base vote being read) and the per-sheet verdicts:
[docs/model/letture-app-v1.md](docs/model/letture-app-v1.md) §15, spec «Novita' v9.59».

## Two models under one division, and only one of them gets the news
**20/08/2026, from the operator's question about a number I had flagged myself**: «where the appearances
go up, the minutes per match go down — so are they two parameters to keep separate?». No: the realised
changes move TOGETHER (r **+0.566** default, **+0.448** euro; the 671 who played much more often went from
**55.3' to 66.5'** per appearance), and the behaviour he was asking about was a defect.
`minutes.start_rate_next` forecast `P(start | appearance)` as `presence.presence / (engine_pv_pred /
matchdays)` — **numerator from the PANEL, denominator from the ENGINE** — and `presence.py` does not import
`evaluate`, so every new engine rule moves the denominator and none of them moves the numerator. Adopting
R23 the day before therefore LOWERED the forecast minutes of exactly the men whose appearances it raised.
The missing piece already existed: **`presence.voto_share` is the same model's answer to the engine's own
question** (`sweep.PREDICTORS` maps «appearances» onto it), and their ratio cancels `availability`, which
has no business in «does he start» — being injury-prone is not being a substitute. Adopted on **euro**
(+1.44%, 4 windows of 4, strict; the rate's bias +0.048 → +0.032), **not on default** (3 of 6) — and the
split is the PRE-REGISTERED expectation with its mechanism: on default the two models nearly agree (median
gap −0.038) so there is little to repair, on euro the platform's calendar is a SUBSET and the engine reads
systematically lower (−0.106). The term that would have made the minutes RISE with the appearances was
measured and **refused** — g = 0 on every fold, although the disagreement does correlate +0.162 with the
realised change: the difference between a signal and a term. Gate §7-quadragies.
Three habits, and the first two are old ones met from a new side. **Before building a channel, ask what its
output can even change** — here the question was the reverse: ask what ALREADY changes it, because a
denominator nobody declared was carrying every rule. **A parameter belongs to the population it was
measured on, and «platform» is such a population**, so a structural repair can still be per-platform. And
the one that cost this session: **I retracted numbers to get here.** The minutaggi shown to the operator an
hour earlier passed last season's RAW appearances where the panel passes its model — *verify the FUNCTION,
not the column that looks like it*, sixth instance, this time in an answer on screen rather than in an
audit. The direction I had described was right and readable in the code; the magnitudes were mine.

## A field that exists and is DELETED IN TRANSIT is worse than a field nobody wrote
**20/08/2026, same session, and I reported the wrong diagnosis first.** The four time-travel packs were
built at `SHEET_REVISION` **29** against today's **34** — five revisions, R23 among them — and nothing in
the app could say so, so the time machine showed an old engine under a chosen date, which is the one thing
that box exists not to do. I told the operator the packs «cannot say it». They can: `timepack.build` copies
the snapshot's manifest into `leagues[].manifest`, revision included. It is `export.write_timepacks` that
**deletes** it, because `entry.pop("manifest")` consumes that manifest after serialising the sheet. Third
instance of one shape — the folder `export` writes and `pull-bundle` does not copy, the flag the parser
accepts and the dispatcher drops — and the general form is: **when a fact is missing at the far end of a
chain, look for where it is dropped before deciding it was never measured.**
Two rules travel with the cure. **One definition of «which revision is this pack at»**
(`timepack.pack_revision`, read by `build`, `--plan` and `export`): two copies would give two answers about
one pack, and the first to be wrong would be the one the app draws. And **a rebuild that does not rebuild
the sheets must not restamp them** — the «already built» branch recovers the revision from what the sheets
declare instead of writing today's, because writing today's is the exact lie the field exists to prevent;
by the same rule `null` stays TWO different things, «does not declare it» and «up to date», and the app
shows no warning for either, for opposite reasons.
And the reason I got it wrong is written down because it is the project's own rule: **an audit that reports
a suspicious ZERO must call the function before it reports anything at all** — I read `engine_sheets` and a
top-level `sheet_revision` on a manifest that has neither, and took a uniform `None` for a hole. One hour
after writing that same lesson into the gate.

## Un controllo può esistere nel DOM e non esistere sullo schermo
**20/08/2026, dalla richiesta dell'operatore: «l'ordinamento delle colonne sulla tabella tramite D&D
funziona malissimo, riscrivilo da capo».** Il gesto era già NOSTRO (CDK era stato mandato via il 18/08) e
la riscrittura ha trovato cinque difetti, ma i due che valgono oltre questa tabella non erano nel gesto:
erano nel fatto che una misura del DOM diceva sì e lo schermo diceva no.

- **Un nodo che non è una `<th>` dentro la riga di intestazione si mangia una colonna della griglia**, e
  questa è la causa vera dei «buchi / disallineamenti» che per due giorni sono stati attribuiti a CDK.
  `nz-tooltip` costruisce il suo componente con la `ViewContainerRef` dell'elemento su cui sta e poi ne
  STACCA l'elemento dal DOM, perché il tooltip vero vive in un overlay; Angular però continua a contare
  quel nodo fra quelli della vista, quindi quando un `@for` con `track` RIORDINA e sposta la vista, lo
  reinserisce. Col tooltip sulla `<th>`, il nodo reinserito era un `<nz-tooltip>` figlio diretto del
  `<tr>`: il browser gli dà una casella, la riga finisce su 23 colonne contro le 22 del colgroup, e ogni
  intestazione dopo quella spostata sta 84px a destra dei propri dati - con l'ultima schiacciata a
  larghezza ZERO. Il colgroup era giusto, il corpo era giusto, e nessun conteggio di celle se ne
  accorgeva (22 e 22). Cura: il tooltip su uno `<span>` dentro la cella, dove un nodo di troppo non
  sposta niente.
- **E un rettangolo dentro la sua cella può essere coperto da un altro elemento.** Aggiungendo l'imbuto
  del filtro a ogni colonna, 16 intestazioni su 22 lo avevano TAGLIATO fuori dalla propria cella (fino a
  32px oltre il bordo su una colonna larga 68), e una volta tirato fuori dal flusso e appoggiato al bordo
  destro, `document.elementFromPoint` sulle sue coordinate rispondeva `nz-table-sorters`:
  `.ant-table-column-sorters::after` di antd è un `inset: 0` che copre la cella intera. Due difetti
  diversi con lo stesso sintomo - un filtro che c'è e non si clicca - e nessuno dei due visibile a
  `element.click()`, che passa sopra la CSS. **Un controllo si verifica con un puntatore vero, alle
  coordinate che il browser dichiara, dopo un hover vero**; ed è la stessa regola che `app/CLAUDE.md` già
  scriveva per i target ingranditi («si prova con un click 8px sopra il bordo»), applicata al contrario.

**E i due difetti che ha trovato la SUITE e2e, scritta dopo — perché «riscrivilo pulito» non è «funziona».**
Il primo è il più insidioso che questa tabella abbia avuto: **il primo trascinamento di una pagina
funzionava e tutti quelli dopo non facevano niente**. Un `mousedown` seguito da un movimento sopra del
testo fa partire il trascinamento NATIVO di Chromium, che si prende il puntatore e smette di mandare
`pointermove` (manda `drag`). Nessuna misura di geometria, di ordine o di DOM può vederlo: dal di fuori si
legge come «il riordino funziona a volte», che è il difetto più difficile da inseguire. **Si è visto
contando gli eventi che ARRIVAVANO invece di quelli spediti**: `pointerdown` 1, `pointermove` **2 su 18**.
Cura: `selectstart` e `dragstart` spenti dal `pointerdown` (non dalla soglia - il drag nativo parte prima
che noi abbiamo deciso che è un trascinamento) e la selezione rimasta in giro azzerata, che è proprio
quella che rende «trascinabile» il testo sotto il dito. Il conteggio è rimasto come asserzione: se il drag
nativo torna, è la prima cosa che crolla. Il secondo è che **metà delle destinazioni non era
raggiungibile**: la tabella chiede ~1900px contro i 1600 di una finestra, quindi un varco fuori dal
viewport non si può scegliere perché il dito non ci arriva - la pagina ora scorre da sé vicino al bordo.
E una lezione sull'arnese, non sull'app: il primo tentativo di misurare il varco in coda ha detto «non
esiste» perché trascinava una colonna FUORI dallo schermo. **Un passo che misura due incognite insieme
attribuisce il difetto a quella sbagliata**: il varco in testa e in coda è una proprietà dell'aritmetica e
si misura su una tabella che sta nella finestra (spegnendo le colonne che non c'entrano), mentre «le
colonne fuori schermo sono raggiungibili?» è un'altra domanda e ha il suo passo.

Tre abitudini che restano, e la prima è la sola ragione per cui i due difetti sono stati trovati.
**L'arnese deve raccogliere quello che la PAGINA urla**: passare da un imbuto all'altro senza chiudere il
primo lasciava lo schermo senza pannello, e la causa era leggibile solo nella console (`TypeError: Cannot
read properties of null (reading 'classList')` - due `NzDropdownDirective` che attaccano lo stesso
`TemplateRef` a due overlay, perché il click apre l'overlay SUBITO e nessun segnale arriva in tempo; la
cura è un `nz-dropdown-menu` per colonna con il contenuto scritto una volta e istanziato da
`ngTemplateOutlet`). **Un gesto è fatto di pixel, e ogni pixel dove non risponde è un pezzo di gesto che
«non funziona»**: la prima versione decideva su QUALE COLONNA si lasciava, e fra due celle non c'è nessuna
colonna - `null`, e il rilascio non spostava niente, cioè portare una colonna in testa o in coda non
faceva assolutamente nulla. La cura è ragionare per VARCHI (`column-drag.ts`: `n + 1` posizioni, esistono
sempre, mezzerie e non bordi). E **diciannove celle quasi identiche in uno `@switch` sono il posto dove si
dimentica `text-right` sulla diciannovesima**: l'intestazione è ora UNA `<th>` ripetuta e larghezza,
allineamento, verso dell'ordinamento e tipo di filtro stanno accanto alla chiave in `SquadColumn` - che è
anche la ragione per cui il filtro è stato aggiunto una volta e non diciannove.

**Il filtro per colonna che ne è nato** (`column-filter.ts`, richiesta dello stesso giorno) ripete due
regole di casa invece di inventarne. **Non è `nzFilterFn`**, per la ragione già misurata il 18/08
sull'ordinamento: quello filtra `nzData`, cioè le sessanta righe già caricate, e «FMa ≥ 6,50» avrebbe
risposto su un campione riempiendosi poi scorrendo - si filtra la lista INTERA, prima di ordinarla e prima
di ritagliarla (misurato: 610 → 109, e il conteggio sotto la tabella lo DICE). E **il vuoto è una
risposta**: un ignoto non è «sotto il minimo» perché non ha un numero da confrontare, quindi un estremo lo
esclude per costruzione, e «solo gli ignoti» è una scelta dichiarata (`blanks`) perché «chi non ha una
stagione misurata in questo listone» è una delle domande vere di un'asta. I filtri si ricordano come le
colonne spente e l'ordinamento - sono una preferenza sulla TABELLA, quindi valgono in tutt'e due le viste -
e la contro-obiezione è vera: un filtro salvato è invisibile. Per questo ogni filtro attivo porta la sua
etichetta SOPRA la tabella, fuori da ogni pannello che si chiude, con la sua crocetta e con quanti uomini
sta nascondendo su quanti.

## Una soglia SCELTA A OCCHIO può essere già la risposta, e va verificata contro la domanda NUOVA
*(e la sera dello stesso giorno l'operatore l'ha spostata a 100 su tre esempi suoi: ultimo capoverso
del primo punto. `EASY_MARGIN` = **100** è il valore vivo, 200 è la storia.)*
**03/09/2026, `assistente-asta-v1.md` §34, dalla richiesta di accoppiare due portieri sulla plancia.**
`EASY_MARGIN` = 200 era stato congelato dall'operatore il 10/08 su un criterio suo — «il club più forte
deve smettere di leggere *tutte* le partite come facili» — e la richiesta di oggi gli chiede un'altra
frase: «una partita facile è una partita dove è **probabile che la squadra non subisca 0 gol**». Due
affermazioni diverse sullo stesso numero, quindi si misura invece di riusarlo sulla fiducia.
Misurato su **5354 partite-club di Serie A** (2019-20…2026-27; avversario e campo dal layer per partita,
gol subiti dalle righe `role='P'` dei voti — quindi **il conteggio non passa dal funnel delle identità**,
che è la regola «un fatto di club non si conta sui suoi membri» applicata a una porta): a un vantaggio di
200 la probabilità di porta inviolata è **0,401**, e il livello 40% cade a **199**. Quel 40% è anche
`club_defence.CLEAN_SHEET_SHARE`, misurato un mese prima su un criterio scorrelato. **Due strade
indipendenti sullo stesso numero sono evidenza**, e per questo un test le lega insieme: chi muove una
delle due costanti deve ristabilire l'accordo invece di perderlo in silenzio. L'etichetta regge: le
partite classificate facili chiudono a zero il **42,8%** delle volte contro il **23,9%** delle altre.
Tre cose che restano oltre il caso.
- **Un CONTEGGIO che satura non si cura abbassando la soglia, si affianca a una misura continua.** Alla
  soglia congelata dodici club di venti non hanno NESSUNA partita facile in stagione, quindi quasi tutte
  le coppie pareggiano a zero e la classifica non distingue niente. Abbassare a 138 farebbe tornare a
  discriminare il conteggio ed è stato **respinto**: sarebbe una soglia scelta perché il conteggio non
  piaceva, cioè «un criterio non si allarga perché una regola ci è caduta» applicato a una colonna.
  Quello che si adotta è la sua regola che DECIDE più una colonna continua che rompe il pareggio, con
  due nomi a schermo e mai una cifra sola — la stessa disciplina del §23.3 («il margine continuo viaggia
  accanto al conteggio») incontrata dal capo opposto, la saturazione in BASSO invece che in alto.
  **E QUELLA STESSA SERA LA SOGLIA È SCESA A 100, che non contraddice il paragrafo qui sopra: lo
  conferma.** Il rifiuto era per una soglia scelta guardando il conteggio; questa è scelta guardando il
  CALCIO, perché l'operatore ha portato tre partite («ATALANTA vs CAGLIARI è facile per l'Atalanta ...»)
  e poi la sua stessa lettura di una casella, con un puntino su ogni partita che secondo lui è facile.
  **Un giudizio dell'operatore su casi concreti è un dato, e si misura contro il codice invece di
  discuterlo**: sulle 19 giornate della casella Como + Fiorentina la soglia 100 concorda con i suoi
  segni **17 volte su 19** e la 200 dodici, e le sue sette giornate segnate sono tutte facili a 100 e
  **nessuna** a 200. La prima cosa misurata sono stati i suoi ESEMPI e non la soglia: due dei tre erano
  già facili a 200 (+236,9 e +270,8), quindi la sua lista vincolava una partita sola, Como-Genoa a
  +104,2 — «prima di cambiare una costante, guarda quanta della richiesta è già soddisfatta». Il prezzo
  è detto: a 100 una facile chiude a zero il **39,5%** delle volte contro il 42,7% (e il 21,0% delle
  altre), cioè il potere separante non scende — è **piatto fra 50 e 250**, lift 1,88 contro 1,79 — e
  quello che cambia è cosa promette la parola. E il valore è 100 e non 75, che pure passerebbe uno dei
  suoi esempi (Genoa-Como, il Como in TRASFERTA a +75,2, che è la partita dentro la sua finestra 3-5),
  perché a 75 tornano a leggere tutta la stagione facile Inter 38/38, Bayern 34/34 e PSG 35/35: **una
  soglia che resuscita il difetto che lui aveva chiesto di spegnere è una soglia da fermare un gradino
  prima.** L'accordo col 40% di `club_defence.CLEAN_SHEET_SHARE` non c'è più, e il test non si cancella:
  si SPACCA IN DUE, perché sono due affermazioni di natura diversa — il livello 40% a un vantaggio di
  199 è un invariante della CURVA e resta asserito, la soglia è una dichiarazione e si asserisce al
  valore che promette davvero (0,32), così nessuno legge 0,40 su una griglia costruita a 0,32.
- **Una costante appartiene alla DOMANDA su cui è stata misurata, non solo alla popolazione.** Per una
  porta inviolata il vantaggio campo si fitta a **30-35** punti Elo e non ai 14,5 che `fixtures.py`
  usava, che erano misurati sul RISULTATO (log-loss fuori campione 0,57796 contro 0,57839, ottimo
  interno, quindi la direzione è identificata: tenere la porta inviolata dipende dal campo più che
  vincere). Non adottata quel giorno per un buon argomento — due costanti per un solo campo è come uno
  schermo finisce con due risposte a «questa partita è in casa» — e **ADOTTATA la sera dello stesso
  giorno, perché l'operatore ha portato l'evidenza che mancava: dodici partite segnate a mano come
  facili, e TUTTE E DODICI in casa.** Nessuno gli aveva chiesto del campo; una regolarità così in un
  giudizio sul calcio è una misura sul modello. E il dilemma delle due costanti si è sciolto guardando
  chi le LEGGE: ogni lettore di `edge()` chiede «quanto è facile», nessuno chiede il risultato, quindi
  la costante non è doppia — il 29 era la risposta all'altra domanda e resta come provenienza
  (`RESULT_HOME_AWAY_GAP`, che il coefficiente di calendario di Fπ cita per esteso invece di
  riferirsi a una costante che si è mossa). *Un cambio di INPUT vuole la trasformazione RIFITTATA*: la
  logistica è stata rifittata sull'edge che il campo nuovo produce, o la probabilità sarebbe stata
  scalibrata esattamente dove il campo entra.
- **E POI L'OPERATORE HA CHIESTO UN CANALE, e la sua frase era il meccanismo.** «Oltre all'elo valuta
  la media gol dell'attacco e i gol subiti della difesa … le ultime 5 o 10 partite», perché **«una
  squadra forte non è detto che segni tanto»** — l'Elo è un rating di RISULTATI e non distingue chi
  vince 3-2 da chi vince 1-0, che è esattamente la differenza fra prendere gol e non prenderne.
  Misurato e **adottato**: log-loss fuori campione 0,54749 → **0,54282**, 7 stagioni su 8, lift
  dell'etichetta 1,95 → 2,01, e a parità di Elo un avversario che segna 0,8 invece di 2,0 sposta la
  probabilità da 0,199 a 0,289. Tre cose che la misura ha deciso **contro la formulazione della
  richiesta**: la finestra è DIECI e non cinque (5 vale la metà, e la curva è piatta da 10 a 38 col
  minimo sul bordo, che non si adotta); il casa/fuori NON paga (metà campione per un termine che
  l'edge già porta); e le due metà non valgono uguale — l'attacco avversario −0,0030, la propria
  difesa −0,0005. **La prima misura di tutto questo era mia e sbagliata**: camminando le partite in
  ordine di data e aggiornando la storia man mano, le DUE RIGHE DI UNA PARTITA condividono la data,
  quindi la seconda leggeva la partita dentro il proprio predittore — quattro volte il guadagno e
  «più corta la finestra meglio è», monotono fino al bordo, che è il campanello scritto qui sopra.
  Due conseguenze strutturali: la soglia si sposta sulla PROBABILITÀ (con tre predittori un margine
  sull'edge non può più dire «facile», e le due soglie sono appaiate per costruzione così un club
  senza forma non cambia colore per essere stato promosso), e la finestra ha un ORIZZONTE di quindici
  mesi, perché le ultime dieci di Serie A di una promossa sono di due stagioni fa e «vuoto = ignoto»
  vale anche sul tempo.
- **UNA CASELLA CONDIVISA NON SI PUÒ ETICHETTARE DAGLI ASSI** (03/09/2026 sera, trovato dall'operatore
  su una casella: «quii non mi trovo»). La griglia calcola METÀ delle coppie e fa leggere alla casella e
  alla sua speculare lo stesso oggetto — che è giusto, «due passate su una domanda sola è come una
  casella e la sua speculare finiscono per non essere d'accordo» — e il prezzo si paga un piano sopra:
  `a` e `b` sono l'ordine in cui la COPPIA è stata costruita, non la riga e la colonna di chi guarda.
  Sotto la diagonale il popover disegnava **le partite dell'Atalanta sotto Como**, col segno di «facile»
  sulla colonna sbagliata. La cura è che la casella **dichiari di chi è ciascuna colonna** invece di
  farlo dedurre da chi la legge (e il titolo segue lo stesso ordine: due ordini per una coppia sono come
  qualcuno rilegge le colonne al rovescio). *Un'ottimizzazione che condivide un oggetto fra due contesti
  deve portarsi dietro il suo contesto*, e la prova è un asserto che RICALCOLA l'attribuzione dal bundle
  su una casella scelta **sotto** la diagonale — la metà dove il difetto vive; una sopra passa sempre.
- **IL TOTALE DI UNA COPPIA NASCONDE CHI L'HA PORTATO, e LO ZERO È LA DOMANDA — due volte** (03/09,
  sera, sua osservazione: «il Napoli e la Juve singolarmente hanno 31 partite facili, il Como ne ha 22
  e solo insieme al Bologna arriva a 33»). Verificato e più forte dell'esempio: **111 caselle su 190
  aggiungono due giornate o meno** al migliore dei propri due club e **5 su 190** battono il miglior
  singolo di tre o più — il secondo portiere è quasi tutto ridondanza, che è «un'assicurazione si
  prezza contro quello che ti copre già» incontrata dal lato del display. Il marginale è ora a schermo
  accanto al totale, e serve DUE zeri con due nomi: nella lista l'uomo che ho è fissato, quindi il
  riferimento è il MIO calendario (e allora il marginale non riordina niente, perché è una costante);
  sulla griglia nessuno dei due è mio, quindi è il MIGLIORE DEI DUE, e quello riordina. La prima
  versione sottraeva il massimo anche nella lista e **un test l'ha rifiutata**: con quello zero un
  compagno forte finisce sotto uno debole, perché la formula risponde di nascosto a «quanto aggiungo
  IO a lui». *Quando un commento afferma che un ordinamento non cambia, l'asserto che lo prova è
  gratis e va scritto: qui ha smentito il commento nello stesso minuto in cui lo scrivevo.*
- **UNA COLONNA CHE SPIEGA UN ORDINAMENTO DEVE ESSERE QUELLO STESSO ORDINAMENTO** (03/09, sera
  tardi). Chiesto un numerino «che mi indichi il valore a colpo d'occhio: quanti punti a partita fa
  guadagnare rispetto al 6», scritto come `fm − 6`, e lui ha trovato il difetto in un secondo
  guardando lo schermo: «perché Hojlund (+1,1) sta prima di Martinez (+1,6)? Immagino per le
  presenze». Sì — dentro uno slot la plancia ordina per VALORE ATTESO, e un numero che non sa niente
  delle presenze non può che contraddire quell'ordine. Ora è `fm × pv / giornate − 6`, cioè la stessa
  quantità dell'ordine traslata, quindi monotona con essa per costruzione (×100 e senza virgola, sua
  scelta). Le due alternative sono state misurate e messe davanti a lui: quella con la scala più
  bella — sottrarre il RICAMBIO invece del 6 — **riordina**, e un numero più alto sotto uno più basso
  è il difetto che si stava curando. *Il prezzo della forma scelta è dichiarato e si vede: il
  riferimento è «6 in tutte le giornate», che nessuno raggiunge, quindi la colonna è in gran parte
  negativa.*
- **QUELLO CHE SI MISURA È QUELLO CHE CAMBIA, e un formato di colore non si dà per scontato** (stessa
  sera, sull'evidenziazione della coppia alternativa all'hover). Due tentativi di leggerla
  direttamente hanno mentito in due modi opposti: contare i BORDI leggeva 250 caselle su 250 (ogni
  bottone ne ha uno — lo strumento che dice «è marcato tutto», cioè niente), e leggere il canale
  ROSSO leggeva 0, perché Chrome computa un `color-mix(in srgb …)` come `color(srgb 1 0.17 0.47/0.1)`
  e non come `rgb()`, quindi un test sui canali confronta 1 con 8. La forma che regge è fotografare
  lo sfondo di TUTTE le righe prima e dopo e contare le DIFFERENZE, che non ha bisogno di conoscere
  nessun formato — e togliere dal conto la riga sotto il puntatore, che cambia da sé: *non alzare la
  soglia, togliere il caso noto.* E il gesto sta su `mouseenter` e non su `pointerenter` per una
  misura, non per gusto: col pointer event il banco leggeva zero righe accese dopo un hover vero, e
  **un gesto che il banco non riesce a far scattare è un gesto che non si può verificare.**
- **UNA SCALA DI COLORE SI TARA SULLA DISTRIBUZIONE, non sul massimo** (03/09, sera: «sembra tutto
  verde e non risalta niente»). La causa non era la tinta: i valori di quella griglia sono ammassati in
  alto — cento caselle su 190 fra il 68% e il 100% del massimo — quindi una scala lineare le dipinge
  tutte fra il 48% e il 70%, indistinguibili proprio dove si decide. Cinque CLASSI PER QUANTILE (un
  quinto ciascuna per costruzione, la più bassa senza tinta), col colore assegnato al VALORE e non alla
  cella, o due caselle che dicono 32 avrebbero due colori. Misurato: 5 tinte, nessuna oltre il 45%
  delle caselle, il numero leggibile su ognuna, la legenda a schermo. *E un flag dell'arnese scritto e
  tolto nella stessa ora*: `--light` emulava `prefers-color-scheme` su un'app che ha temi NOMINATI, le
  celle restavano identiche, e **un flag che non muove niente è peggio di nessun flag** perché legge
  «nessun problema» su una cosa che non ha guardato.
- **Il confine fra toolkit e app si taglia sulla natura del fatto, non sulla comodità.** Se una partita
  è facile è una previsione sul calcio → `fixtures.schedule` → `calendar.json` nel bundle; quante ne
  cadono nella finestra dichiarata e cosa coprono due club è aritmetica sulle impostazioni dell'operatore
  → `core/keeper-pairs.ts`. Ed è anche l'unica cosa che l'app **non potrebbe** dedursi: `fixtures` e
  `club_levels` sono chiavati su `matching.club_identity`, che è una tabella di alias in Python, quindi
  rifarne il join in un browser vorrebbe dire ripetere il join che una volta ha perso Milan, Roma e
  Napoli dal calendario di tutti. Risolto una volta là, e l'app unisce sul nome canonico che già legge su
  una riga del foglio.

## Un AVVISO DEL COMPILATORE che nessuna misura conferma è una misura che non stiamo facendo
**03/09/2026, `letture-app-v1.md`, segnalato dall'operatore che leggeva il terminale.** `ng build`
stampava un **NG8011** a ogni corsa da tredici giorni: `nz-th-addon` ha uno slot suo per l'imbuto del
filtro (`<ng-content select="nz-filter-trigger">`) e Angular ci proietta il contenuto di un `@if` **solo
se quel blocco ha UN nodo radice** — l'imbuto e il suo `nz-dropdown-menu` erano due, quindi il blocco
intero finiva nello slot di **default**, dentro il titolo.
**Non si vedeva perché la nostra CSS lo compensava per intero**: `nz-table-filter` avvolge tutt'e due gli
slot in `.ant-table-filter-column`, che è esattamente il selettore su cui la cura di agosto tira l'imbuto
fuori dal flusso. Quindi tutte le misure di agosto — 24 imbuti su 24, zero tagliati, `elementFromPoint`
sull'icona, pannello che si apre — erano **vere e restano vere**: sbagliato era il posto nel DOM, non il
pixel. L'arnese guardava dove l'imbuto *appare*, e nessuno guardava in quale slot *è*.
Due abitudini. **Un `#ref` dichiarato dentro un blocco non si vede da un blocco fratello**, quindi la
cura è il menu fuori dal blocco con l'`@if` DENTRO di lui — e non può uscire dalla `<th>`, perché un nodo
che non è una `<th>` dentro il `<tr>` si mangia una colonna della griglia (gli 84px del 20/08). E **un
asserto nuovo si prova rimettendo il difetto**: con il markup vecchio la corsa nomina tutte e 24 le
colonne, quindi non passa a vuoto. La stessa disciplina, lo stesso giorno, ha smascherato un audit che
**stampava** il numero atteso accanto a quello dello schermo senza confrontarlo — cioè un banco che
risponde «nessun problema» dopo aver guardato niente, che è il difetto che questo progetto si è già
scritto due volte e ha commesso di nuovo.

## Una SOGLIA DI FILTRO non e' un RISULTATO, e «riprendibile» e' una proprieta' del PREDICATO
**03/09/2026 (sera tardi), i tre punti aperti della chiusura precedente. Dettaglio:
`rosa-3-giornate-v1.md` §11 e spec «Novita' v9.69».**

**Il verbale di poche ore prima diceva «nessuno scambio a budget invariato guadagna piu' di 0,15 a
giornata», e quel numero era il filtro dello script.** `cura.py` scartava con `diff.mean() <= 0.15` le
righe da STAMPARE, in fantapunti sulle TRE giornate — cioe' 0,05 a giornata — e il log prodotto da
quella stessa riga aveva in cima **Kean → Simeone +0,591**. Due errori in una frase: la soglia presa per
il massimo e il totale preso per la media. Si e' visto **rieseguendo la funzione invece di citare il
log**, che e' «verifica la FUNZIONE, non la colonna che le somiglia» applicato a un verbale; e per
fortuna la conclusione che ne dipendeva era giusta lo stesso, il che e' esattamente il modo in cui un
numero sbagliato sopravvive. *Prima di pubblicare un massimo, guarda se e' il valore di una costante che
sta nel codice due righe sopra.*

**E il piano che ne e' nato dice perche' i cambi sono DUE: uno solo non puo' spostare crediti fra
reparti.** A budget chiuso una mossa deve costare non piu' di chi esce (+0,58 il meglio); la coppia vale
**+1,13 a giornata** perche' la prima LIBERA i dieci crediti che rendono comprabile la seconda, e il
secondo cambio vale quanto il primo pur non esistendo senza di lui. Due cambi recuperano 1,40 dei 2,44
che separavano la sua rosa dalla costruita, e dimezzano i buchi (0,739 → 0,428). **La riga da
consigliare non e' la migliore**: le prime due vendono un `anchor`, cioe' un uomo che il motore non sa
prezzare, e «vendi l'uomo che non vedo» non e' un consiglio. Misurato muovendo una cosa sola — la stessa
ricerca con la demozione degli anchor accesa e spenta — la cecita' vale 0,35 a giornata, la coppia
migliore ne conserva il 90% anche credendo l'anchor, e la riga che non ne tocca nessuno legge identica
nelle due letture. *Quando una raccomandazione dipende da cio' che non sappiamo, la misura giusta e' la
stessa ricerca con quella ignoranza spenta.*

**`--refresh` e «riprendibile» si contraddicono su una camminata di migliaia di pagine, e la cura e'
sostituire il booleano con l'ETA' della lettura.** `injuries` interrotto a meta' lascia 2564 pagine
lette oggi e 2100 lette due giorni fa: `--refresh` ripaga tutt'e due le meta', senza non ne paga
nessuna. `--stale-days N` (1 = «non letta oggi», 7 = la cadenza di un archivio settimanale) e' la stessa
quantita' che `injuries.observed_on` archivia, ed e' misurata sulla cache PRIMA di lanciare (0 · 2100 ·
24 pagine su 4664). Un file che non esiste e' stale a prescindere dal parametro: non c'e' una lettura
che possa essere vecchia. La corsa ripresa ha chiuso 1891 su 1891 e `injuries` porta ora **35.995 righe
tutte con `observed_on` = 03/09** — e quello che la rilettura ha portato va detto per intero perche' e'
piccolo: **9 assenze cominciate dal 1º settembre, 4 dal 2**. *Il valore di una cura del genere non e' il
conteggio del giorno in cui la si fa: e' che da quel giorno la tabella sa quando e' stata guardata.*

**Un preset e' una SELEZIONE dell'ordine unico, e il criterio e' cosa il passo OSSERVA.** `update
--daily` (7 passi, ~40 min contro 22h34) filtra `plan()` e non ne scrive una copia — un test asserisce
`DAILY ⊆ plan()`, perche' una chiave sbagliata darebbe un preset silenziosamente piu' corto, che e' la
famiglia del flag che il dispatcher scarta. Dentro c'e' cio' che si perde se nessuno guarda oggi
(`fc_site`, `positions:roles`, `fixtures`, `elo`), fuori i fatti FINITI e gli archivi settimanali. **E
la DERIVAZIONE e' fuori per un'affermazione sul grafo, non per preferenza**: `stats:derive`,
`matchdays`, `synth` e `arrivals` leggono i voti e gli aggregati di stagione, che una corsa quotidiana
non rilegge, quindi riprodurrebbero le tabelle di ieri in tredici minuti. I 24 passi lasciati fuori sono
STAMPATI col loro costo — un preset che salta gli archivi in silenzio si legge come un update completo
che non ha trovato niente da fare — e `--daily` e `--offline` sono mutuamente esclusivi, perche' due
flag che dicono entrambi «un pezzo» fanno uscire una corsa diversa da quella chiesta.

## A fact about a PLATFORM lives in a table keyed by platform, and the CLUB is such a fact
**03/09/2026, found by the operator with three names: «io mi trovo come portieri del como
Butez+Sanchez+Vigorito» while the sheet carried Butez+TORNQVIST+Vigorito and Sanchez Ro. was not there at
all.** Behind it were FOUR defects with one root, and his judgement was the right one («se i trasferimenti
non corrispondono e la Qt.A non corrisponde è un problema GRAVISSIMO»). Details:
`spec-euroleghe-ingest-v9.md` «Novità v9.68», measurements in `docs/model/rosa-3-giornate-v1.md`.

`listone_quotes` was given `platform` in the key for PRICES on 07/08/2026 and the CLUB was left in
`rosters`, which holds ONE row per (fc_id, season) while `ratings:euro` runs after `ratings:default`. So
**221 rows of 289** men quoted on both listoni carried the EURO price; the `league` was frozen at the first
value ever written by a `COALESCE(rosters.league, excluded.league)` in the wrong direction, so no re-read
could correct it and the pair could disagree with itself (club from the last read, league from the first);
and five quoted Serie A men sat outside `perimeter_clubs` because they were filed at Bournemouth, Aston
Villa, Bayer, Lipsia and Stuttgart. The two listoni are read at DIFFERENT MOMENTS, so a man who changed
country this summer is at two different clubs on them: Di Gregorio is **Juventus on Serie A and Bournemouth
on euro**. Cured the way the prices were: `listone_quotes.fc_club_id` / `.league`, written by `ratings`,
read by `perimeter_clubs` and both population queries with a `COALESCE` onto `rosters` - **inert on every
row written before the columns existed**, so no published window moves until somebody backfills the
history, and whoever does must re-run `backtest --verify`.

**And the fourth is a RIGHT RULE taken outside its domain, which is the durable half.** With
`squad_source='squad'` the population has two arms: one takes whoever the provider places at a club this
platform plays, the other took whoever the provider has NEVER seen. A man the provider sees at a FOREIGN
club satisfies neither, so **35 quoted Serie A men were absent from the sheet, 7 of them given as probable
starters that day** - Woltemade (23 credits, filed at Newcastle and fielded by Juventus), Beto (14, filed
at Everton and fielded by Fiorentina), Diego Carlos, Belghali, Sarr P., Mbangula, Zeballos. The operator's
rule of 17/08 («l'autorità di chi è in rosa è sofascore») exists to read an ABSENCE from a club; using it
to assert a foreign club AGAINST the listone that quotes him is a different sentence - «vuoto = ignoto»
covers the absence, not a foreign positive. **Being quoted on THIS platform's listone is positive evidence
of being in THIS championship**, so the row keeps the LISTONE's club and `desc_live_club` says where the
provider sees him: the contradiction is reported, not applied. Effect: absent **35 → 22**, wrong clubs
**8 → 0** (Kean was filed at Fiorentina and is at Como, 24 credits), and the 22 that remain are CORRECT
removals - three sources agree (live squad, a transfer naming the same destination, and absence from
today's probabili).

**Fifth, the same day and the same family: the probabili page was erasing itself.** The PK of
`probable_starter` is `(fc_id, valid_from)`, the write was `INSERT OR REPLACE`, and the EURO page - stored
with an unknown season on purpose so no sheet reads it - is ingested AFTER the Serie A one in the same run.
It therefore overwrote the day's reading of every man whose club is also on euro, i.e. exactly the ten
biggest clubs: **479 probabilities over 20 teams reduced to 250 over 10**, with Maignan, Svilar, Dimarco
and Malen reading 0.063 = «absent from the page» on a page that carried them. Nobody had noticed because
the FULL `update` repairs it by accident (the `sheets` step re-reads the Serie A page after the euro one),
so only a run that stops earlier leaves the day clobbered. Cured with an `ON CONFLICT ... WHERE`: **a row
that knows its season is never replaced by one that does not.** It is `load_reference` (20/08) on the
WRITER's side.

Three habits, and two are about how one searches.
- **A DOMINATION PRUNE IS RIGHT FOR A VALUE AND WRONG FOR A STRUCTURE.** A prune drops a man another of
  the same role and club beats on price and per-round value - and the THIRD KEEPER of a club is dominated
  by the second, yet needed, because what you buy is the shirt being closed and not him. It silently
  excluded **ten clubs of twenty** from a comparison of keeper trios, including the winner, and produced a
  recommendation the operator broke with one question: «se prima mi indichi Butez come miglior portiere
  perché dopo mi suggerisci Bologna?».
- **A CLASSIFICATION WRITTEN AS AN `if/elif` CHAIN IN AN ARBITRARY ORDER IS NOT A MEASUREMENT**: the first
  label eats the other causes' cases. It made me report «22 missing because they have no measured football»
  when the counter-check said 182 of 205 men in that condition were on the sheet.
- **THE MANIFEST IS A MINUTE-BOOK: read it before deducing.** What closed this diagnosis was calling the
  real functions (`features.prepare`, `perimeter_clubs`) and reading the sheet's own manifest, which
  records how many rows it left out and why («129 players were left out: their club is not one this
  platform plays»). Two false infeasibilities were declared before that: a seed that cannot build a legal
  roster is not proof that none exists.

## A rule that fires on STARTING needs the other quantity, and one keeper of a club plays
**03/09/2026, a roster for three matchdays: `docs/model/rosa-3-giornate-v1.md`.** A second classic
competition (250 credits on the **Qt.A**, 3/8/8/6, matchdays 3-5, at least 2 U23 born from 2004, max 3 per
club), whose regulation arrived in SIX messages - and every message moved a number, so the rule is the one
already written: **the regulation of the real thing is asked, never deduced.** Its declared rules: the
defence modifier needs FOUR defenders fielded and reads the best three plus THE KEEPER, +0.5 from 6.00 in
steps of 0.25 up to +3; the captain doubles the BONUSES only; there is NO voto d'ufficio, so an uncovered
place is a ZERO; five automatic substitutions a matchday; and ONE **SWITCH** pair, which fires when the
pitch man does not START and costs no substitution.

**The switch fires on STARTING, so it needs the quantity this project keeps separate** («titolarità» = he
gets a vote, «quota da titolare» = he is on the team sheet). Both curves are measured out of sample on the
two rounds already played, 932 observations: P(vote) runs 0.013 to 0.952 with **absent from the page
0.063**, and P(STARTS) runs 0.020 to 0.910 with absent 0.028. The fact that binds them is that **P(vote |
he started) = 1.000 in EVERY bucket**, so `P(vote | not started) = (q − s)/(1 − s)` is exact rather than
fitted - checked against the direct count in all seven buckets. And the editorial reading BEATS the engine
near the round: Brier **0.133 against 0.175** for `est_pv/38`. Coming on instead of starting costs BONUSES
and not the mark (base vote D −0.013 · C +0.009 · A −0.008; fantavoto **A −0.439** · C −0.129 · D −0.050):
a substitute has less time to score, so the switch pays in attack and the modifier never sees it.

**EXACTLY ONE KEEPER OF A CLUB PLAYS.** This project had written the fact down from the other side
(`keeperCovered` on the sealed-bid page is the department's own SUM, not a convolution) and was not reading
it here: the simulation drew keepers independently, so a trio of one club read an **8% chance of NOBODY in
goal** - a ZERO in this league - where the truth is 0.0000, and a pair read as two independent 87% men.
Cured in the OBJECTIVE as well as in the simulation, which was the worse half: choosing on independent
keepers and scoring on exclusive ones is optimising one quantity and measuring another. **And the
operator's own structure beat mine**: three FIRST-CHOICE keepers of three clubs for 18 credits against the
trio of one club for 24 - the trio pays two deputies who never play for a perfect cover the dice ask for
once in two hundred. His proposal also exposed that the engine ordered the declared line-up ONCE and kept
it for all three rounds, when **a line-up is handed in every matchday**: that understated every roster a
little and his a lot, because three clubs have three calendars and three keepers of one club share one.

**The +3 of the defence modifier exists and cannot be bought.** He was right that the modifier reads
REALISED votes («può anche darti i 3 punti se becchi la giornata buona»), and the mechanism is in the data
- a defender who scores reads **6.998 of base vote against 5.888** - but a goal is 3.7% of a defender's
appearances, and the rung reads **0.02% a matchday**. The reason contradicts the intuition and is worth
keeping: a defender's base-vote residual is skewed **LEFT** (−0.275), so `P(residual ≥ +1.5)` is 0.61%
empirical against 0.60% gaussian - substituting the empirical residuals for a normal changed nothing, the
opposite of what I expected. The within-club correlation is real and measured with the right null
(defender-defender same club, same match **+0.359** over 32,861 pairs against **−0.011** for two defenders
of different clubs in the same round) and it does **not** help the modifier (−0.006), because the ladder is
locally LINEAR where a buyable defence sits: variance is neutral there. It is «the value of a threshold
cannot be written on a row» read from the dispersion's side.

Three smaller ones that generalise.
- **The reliability filter belongs to the ELEVEN, not to the one-credit fillers.** Applying
  `est_confidence >= 0.75` to both declared the operator's own «2-5-4-4 plus ten scartine» INFEASIBLE: the
  listone has 17 midfielders at a credit and only THREE survive the filter, because a one-credit man is by
  definition one nobody has seen play, and his structure needs four. A body needs no valuation to be a body.
- **A per-role backup beats letting an optimiser place the free slots**: his 2-5-4-4 reads 73.33 a matchday
  against 73.20 for fifteen free slots placed wherever they pay, and costs 0.21 against the unconstrained
  optimum - which by itself already puts **82% of the budget in the first eleven**, so «prioritise the
  eleven» is what it does and pushing further trades coverage for quality at a loss.
- **A credit is worth ~0.02 points a matchday here** (190 credits instead of 250 costs 1.3 a matchday), so
  holding some back for later changes is nearly free - and a keeper is not worth paying for at all: the
  keepers' FMa spans 4.91 to 5.24 and the cheapest man had the listone's highest expected base vote.

## L'ASTERISCO del listone e' un fatto, e lo scaricavamo gia' da anni
**03/09/2026, dalla segnalazione dell'operatore sulla plancia («come e' possibile che c'e' Lukaku? Non
e' piu' un calciatore del Napoli!!!!») e dalla sua correzione, che vale piu' della segnalazione:
«Lukaku non deve essere tolto per la nota "fuori rosa" ma perche' non gioca piu' in serie A», poi la
regola intera — «i calciatori acquistabili sulla plancia devono essere presenti nel listone (serie-a o
euroleghe) e non devono avere l'asterisco». Dettaglio: `assistente-asta-v1.md` §35, spec «Novita'
v9.70».**

**DUE FATTI CHE SI SOMIGLIANO E NON SONO LO STESSO, e la prima cura ha usato quello sbagliato.** Una
nota DICHIARATA `out_of_squad` esisteva dal 25/08 e la plancia non la leggeva; farla RIFIUTARE l'uomo lo
toglieva dallo schermo con la ragione sbagliata — «fuori rosa» e' uno stato dentro un club, «non gioca
piu' qui» e' un fatto sul CAMPIONATO. E' la stessa regola per cui `dispute` e `wants_out` non toccano
niente, applicata a se stessa: *un fatto vicino non e' il fatto, e usarlo perche' e' quello che si ha in
mano e' inventare.* Ritirata; la nota e' tornata a essere un'icona.

**IL DATO C'ERA E LO FONDEVAMO.** Il file delle quotazioni ha un foglio `Tutti` e un foglio **`Ceduti`**
— sul sito e' l'asterisco accanto al nome — e `parse_listone` li leggeva tutt'e due e li fondeva, con
una buona ragione scritta nel suo docstring (un ceduto ha comunque giocato e i suoi voti vanno
attribuiti) e una conseguenza che nessuno aveva notato: «si puo' ancora comprare?» non stava in nessuna
colonna. *Una fusione giustificata da una domanda non e' giustificata per tutte le domande, e la prova
e' che nessuna colonna risponde piu' alla seconda.* Cura: `listone_quotes.sold` (piu' migrazione),
scritto da `ratings` e letto da `snapshot`; **fatto per PIATTAFORMA** come il prezzo e il club, terza
istanza della regola del 07/08 — 57 ceduti sul listone Serie A e 79 su quello euro, e sette di quelli
(Di Gregorio, Suzuki, Nkunku, Dia, David, Gutierrez, El Aynaoui) sono ceduti in Serie A e **comprabili
su euro**. Non irreversibile: nessun `COALESCE`, l'ultima lettura decide, o chi rientra in `Tutti` non
tornerebbe mai comprabile. Effetto, `SHEET_REVISION` 40: **36 righe fuori** dal foglio Serie A, 48 da
quello euro.

**I due segnali che il foglio consultava non potevano supplire, ed e' un limite di FORMA e non di
freschezza**: il trasferimento al Fenerbahce e' entrato nel DB solo quella sera, e `_still_buyable`
pretende comunque che la fonte lo VEDA in un club fuori perimetro — impossibile per chi va in un
campionato che non leggiamo (ultimo avvistamento: Napoli, 10/08, con la rosa del Napoli riletta ogni
giorno fino al 03/09 senza di lui). *Quando due segnali non possono per costruzione rispondere alla
domanda, la risposta non e' tararli meglio: e' cercare chi la domanda la risponde per mestiere* — qui il
listone, che e' l'autorita' su cosa si compra perche' e' cio' da cui si compra.

**E l'errore procedurale della serata, due volte in un'ora: uno ZERO da chiave sbagliata.** «Lukaku non
e' nel foglio» (letto con `row.get` su righe che sono LISTE) e «zero quotati assenti dalla lettura
fresca» (interrogando `squad_snapshot` con `source='squad'`, che non esiste: e' `sofascore`). La regola
di casa dice di chiamare la funzione prima di riportare uno zero sospetto; la variante che serviva qui
e' piu' piccola e piu' meccanica: **prima di credere a uno zero, stampa la FORMA di cio' che stai
leggendo** — le chiavi di una riga, i valori distinti di una colonna.

**Le ICONCINE sulle righe e il menu' che le spegne** (sua richiesta, stessa sera): `ui-flags` sulla
plancia, due per riga al massimo (17px), taglio in coda dove i marchi sono gia' in ordine di importanza
e il resto DETTO con un `+N`; `core/flag-prefs.ts` tiene la scelta in `localStorage` per tutta l'app, e
**tiene la lista degli SPENTI**, cosi' un marchio nuovo nasce acceso invece di essere spento in silenzio
da una preferenza salvata mesi prima. Un test lega il menu' al vocabolario dei `PlayerFlag`.

## Le rose si scrivono A MANO, e un PREZZO ZERO non e' un credito
**04/09/2026, tre richieste dell'operatore sulla plancia in fila, e le prime due sono una cosa sola:
`app/src/app/core/plancia-store.ts` (`award`, `resetSquads`) + `auction-feed.ts` (`awardByHand`,
`emptySquads`). Dettaglio: `assistente-asta-v1.md` §37.** La sua asta la gira il software di qualcun
altro e questa pagina non e' collegata (la connessione e' un bottone, §33), quindi il tavolo inventato
non e' una demo da guardare: e' **il foglio su cui si segna l'asta vera**. Un foglio che parte con un
terzo dell'asta giocata da un fixture non serve a niente finche' non lo si puo' azzerare, ne' si puo'
tenere aggiornato finche' non si puo' dire chi ha preso il lotto — un tasto e un doppio click sulla card
di una rosa.

**IL PREZZO NON HA UN VALORE DI CORTESIA.** Zero vuol dire «nessuno ha ancora offerto», non «un
credito»: i crediti di ogni rosa sono la quantita' su cui poggia ogni tetto della pagina (la banda, le
mani alzate, l'alternativa), quindi assegnare a un prezzo che nessuno ha scritto e' **inventare un
acquisto** e falsare tutti i numeri sotto. Si rifiuta. Gli altri due rifiuti sono del REGOLAMENTO e non
nostri (reparto completo, borsa che non arriva), perche' un doppio click e' un gesto grosso e un
acquisto impossibile lasciato passare darebbe a una rosa ventisei posti o crediti negativi.

Quattro cose che restano oltre il caso.
- **Un rifiuto muto e' indistinguibile da un gesto rotto**: ognuno dei tre scrive la sua ragione
  nell'avviso della pagina, che percio' ora si chiude — un canale che portava guasti di costruzione e
  adesso porta anche un no a un gesto non puo' restare a schermo per sempre. E l'interfaccia non
  promette quello che non puo' fare (cursore e tooltip cambiano solo dove il gesto funziona) mentre il
  gesto arriva comunque allo store, che e' l'unico a sapere perche' no.
- **Si scrive solo sul tavolo NOSTRO, e la guardia sta nel feed**: i pick di una sessione vera sono del
  banditore, la prima riga in arrivo cancellerebbe quello che scrivessimo noi, e nel frattempo il
  pannello mostrerebbe una rosa che al tavolo non esiste. Una definizione, non una condizione ripetuta
  in due viste.
- **UN FIXTURE CONDIVISO CHE UN ALTRO TEST MUTA NON E' UN FIXTURE.** `applyStreamEvent(mirror, 'put',
  '/', STATE)` restituisce l'oggetto STESSO, e i `put` successivi scrivevano un terzo pick dentro lo
  `STATE` dichiarato in cima al file: ogni test dopo quello vedeva un tavolo diverso da quello che il
  file dichiara. Trovato dai due test nuovi, che leggevano 3 pick su un fixture che ne dichiara 2, e
  curato dai due lati (quel test lavora su una copia, i test nuovi scrivono i propri pick).
- **E un `title` nativo su 250 righe alte diciassette pixel spunta dove si sta leggendo** («da'
  fastidio»): togliendolo se ne sono andate anche le due funzioni che lo scrivevano, perche' quello che
  diceva vive altrove — prezzo e banda sulla card che il click apre, l'alternativa nell'evidenziazione
  all'hover. Due canali per una frase sono come una riga finisce per dirne due versioni. Misurato come
  un'assenza si misura: `scripts/e2e-plancia-award.mjs` legge **0 `title` su 250 righe**, e lo stesso
  banco pilota i due gesti con un puntatore vero (`clickCount` 1 e 2) perche' un doppio click e' un
  GESTO — con la cura che «scrivo il prezzo» e «il doppio click assegna» sono due PASSI separati, o un
  passo che misura due incognite attribuisce il guasto a quella sbagliata.

## Una data di rientro e' un NUMERO, e il rischio che sia sbagliata e' una DICHIARAZIONE
**04/09/2026, dal caso McTominay. Dettaglio: `assistente-asta-v1.md` §36-§38, spec «Novita' v9.71».**
Il 03/09 la regola era «quando non si sa per quanto, si vincola invece di riprezzare», e la condizione
di quella frase era la parte che contava: **dove una data di rientro esiste, il numero fa lo stesso
lavoro meglio, perche' dice DI QUANTO.** La plancia conta le giornate del SUO club che cadono prima del
rientro (`core/injury-window.ts`), col denominatore che parte da OGGI — le giornate gia' giocate le
hanno perse tutti, contarle sconterebbe l'infortunato per una cosa che non e' sua.

**IL DATO C'ERA, DUE VOLTE, ed e' la quinta istanza della famiglia** dopo i campetti, `availability` e
l'asterisco. Transfermarkt pubblica la data di rientro STIMATA finche' lo spell e' aperto:
`injuries.end_date` la porta da sempre, il bundle la esporta, e l'app la STAMPAVA nel tooltip senza che
una cifra la leggesse. E gli articoli di giornale che l'operatore leggeva a mano sono la riga di prosa
che la pagina *indisponibili* scrive accanto a ogni nome — quella che scarichiamo ogni giorno su cinque
campionati e che `upsert_availability` buttava tenendo solo lo `status`.

**E LA QUOTA E' LINEARE PERCHE' IL RODAGGIO NON ESISTE — ma solo nella quantita' che conta.** Tre
domande diverse, tre misure, e la prima risposta era sulla quantita' sbagliata: **SE** gioca non cambia
(0,400 contro 0,402 sui 2872 rientri da spell di 45+ giorni, appaiato −0,002 ± 0,006), **QUANTO** gioca
cambia moltissimo (−20,2' alla prima presenza, t −29,4; −8,7' sulle prime cinque), e la quota di
giornate in cui **prende il VOTO** scende (0,808 contro 0,908 alla prima, t −6,6). Sommato in fantapunti
vale **~1,8 su ~140, l'1,3%**, cinque centesimi a giornata, perche' il fantavoto e' dominato dal VOTO —
che si prende giocando, non giocando molto. Quindi **misurato e NON implementato**: una costante che
sposta un uomo dell'1,3% mentre un tetto dichiarato lo sposta del 60% serve solo a far sembrare il tetto
piu' preciso di quanto sia.

**QUATTRO COSE SONO DICHIARATE E TENUTE SEPARATE DALLE MISURE**, ognuna con la sua ragione:
- **`RETURN_SLIP` = 0,25** (proporzionale all'assenza che resta): la DIREZIONE e' misurata — sui 35.792
  spell chiusi la durata residua CRESCE con quella trascorsa (da 7 giorni ne restano 14 di mediana, da
  30 ne restano 23, da 60 ne restano 38, da 120 ne restano **62**), quindi gli sforamenti sono la norma.
  L'ENTITA' no, **e la ragione e' nostra**: la riga di `injuries` e' sostituita a ogni lettura, quindi in
  archivio resta l'esito e mai la previsione. Diventa misurabile il giorno in cui la si data.
- **`MIN_PLAY_SHARE` = 0,60**: chi torna a gennaio non entra in plancia. La sua frase e' un MESE, che non
  si confronta fra stagioni ne' fra un'asta di agosto e una di novembre, quindi la regola vive nella
  quota — e **0,60 e' il punto che non dipende dall'altra costante**: lascia fuori i due di gennaio e
  tiene il primo di dicembre per ogni margine fra 0 e 40%, mentre 0,65 cambia risposta col margine.
  *Fra due soglie che dicono la stessa cosa oggi, si sceglie quella che non dipende da un'altra.*
- **`BET_SHARE` = 0,70 con un tetto di 20-30 crediti su 1000**: sotto quella quota l'acquisto e' una
  scommessa. Le due cifre sono sue, tenute come QUOTE del budget; 0,70 e' il centro di un VUOTO
  nell'archivio (fra 0,64 e 0,75 non c'e' nessuno), quindi anche questa non dipende dal margine.
- **`HURT_SLOT_STEP` = 1**: chi e' infortunato OGGI si paga come lo slot SOTTO. La forma e' una demozione
  sulla scala e non un numero nuovo — la sua frase («con quell'infortunio non possono essere da primo
  slot») detta nella valuta che la scala parla gia'. **Scatta con o senza una data**: legarla alla quota
  avrebbe lasciato il tetto pieno a chi non dice quando torna, cioe' un premio all'ignoranza.

Due regole di forma che valgono oltre il caso. **Il VINCOLO e il PREZZO non convivono su una riga** (chi
ha una finestra non e' anche `outNow`, e non e' nemmeno barrato: un uomo cancellato e uno riprezzato sono
due cose diverse e devono vedersi diverse), o lo stesso fatto punirebbe l'uomo due volte. E **una QUOTA
DI CALENDARIO non e' un'opinione**: la clamp di `offerBand` limita quanto la nostra opinione muove una
banda misurata sullo slot, quindi il suo pavimento scende fino alla quota e non oltre — un tetto
misurato su uomini presenti tutta la stagione non si applica a chi non c'e'.

## La CONFIDENZA di una stima entra nel TETTO, e la plancia era l'unica a ignorarla
**04/09/2026, dalla domanda dell'operatore «per il primo slot vorrei premiare calciatori che ti danno
continuita' ... come mai ci sono Mora o Pulisic che hanno < 20 partite previste?».** Due cause diverse e
**una sola e' una frase sul calciatore**: Pulisic 19,1 e' una MISURA (`basis: core`, confidenza 1 — lui
le partite le salta davvero), mentre Mora 12,6 e' una COSTANTE (`basis: anchor`, confidenza 0,50, e la
sua nota dice «nothing measured anywhere»), cioe' «vuoto = ignoto» che prende la forma di un numero
basso. Molina N. legge la sua ultima stagione misurata di CINQUE anni fa, Kolo Muani di due.
`est_confidence` viaggia sul foglio da sempre e ogni altro lettore la applica (`worthOf`, `gainOf`: «la
penalita' moltiplica il numero perche' l'indeterminatezza e' un fatto sul NUMERO»); la plancia no, quindi
offriva su una costante con la stessa autorita' di una misura — due letture dello stesso foglio che danno
a un uomo due valutazioni. Ora Mora passa da 70 a 35 crediti e Pulisic non si muove.
**Nel TETTO e non nell'ORDINE, ed e' una decisione**: l'ordine dentro lo slot e' il valore atteso e i due
numeri della riga devono SPIEGARLO (sua regola del 03/09), quindi una confidenza li farebbe contraddire;
l'incertezza limita quanto si e' disposti a ESPORSI. E la risposta alla domanda «come mai sono nel primo
slot» e' che **ce li mette il MERCATO**: lo slot e' il rango per FVM, e la continuita' e' gia' premiata
DENTRO il blocco (Paz N. 30,9 presenze primo con tetto 131, Pulisic 19,1 penultimo con 79).

## Una PROSA e' una fonte, e si legge stretta o inventa una data
**04/09/2026, `fc_site.parse_return`.** La pagina *indisponibili* dice quasi sempre quando l'uomo e'
atteso, e la regola che discrimina e' un VERBO DI RIENTRO che governa un «da/dal/dalla» che governa
un'ancora di mese. Non e' decorazione: sulla stessa pagina del 03/09/2026 tre frasi portano un'ancora di
mese e nessuna e' un rientro — «ai box **da inizio settembre**» (l'inizio dell'assenza), «operato **a
fine giugno**» (l'operazione), «**a meta' settembre** verra' sottoposto a esami» (un controllo) — e un
lettore piu' largo avrebbe letto la prima come l'OPPOSTO di quello che la pagina dice. Un test per
trappola, e due di quelle righe portano anche la frase VERA piu' avanti, quindi il passo verifica che il
parser scelga quella. **Le DURATE sono rifiutate** («stop di almeno due mesi»): si contano
dall'infortunio, che la prosa data solo a volte, quindi sarebbero ancorate a un giorno che non sappiamo.
**«Stagione finita» viaggia SENZA data** (`return_basis = 'season_over'`, che nell'app diventa quota 0):
e' la frase piu' decisiva che la pagina possa portare e non nomina nessun mese, quindi il FATTO si tiene
e la data resta vuota invece di essere inventata come un'ultima giornata che nessuno ha letto.
Le convenzioni sono DICHIARATE (`MONTH_PART_DAY`: inizio 5 · meta' 15 · fine 25 · prima meta' 8 · seconda
meta' 23, i punti MEDI dei terzi e delle meta' di un mese) e **il pessimismo sta da un'altra parte**:
`RETURN_SLIP` vive nell'app, e metterne un secondo qui conterebbe la stessa paura due volte. L'ANNO lo
decide il giorno della LETTURA, perche' la frase nomina un mese e mai un anno.

Cinque cose che restano, e tre sono errori di misura miei.
- **UN NUMERO CHE SEMBRA TROPPO BELLO E' IL PRIMO DA RIMISURARE.** Avevo pubblicato «42 voci su 45
  contengono l'indicazione del rientro»: veniva da una regex larga che accettava qualunque parola
  temporale, e in quelle righe un mese sta quasi sempre sull'INFORTUNIO. Con la regola stretta sono
  **23 su 45** (e 14 su 94 su euro). La meta', non il 93%, e il verbale porta la correzione accanto al
  numero sbagliato invece di sostituirlo in silenzio.
- **DUE FONTI PER UN FATTO SOLO SI SCELGONO PER FRESCHEZZA, non per qualita'**, e la freschezza si
  confronta sulle DATE DELL'OSSERVAZIONE — non ricordandosi quale canale gira piu' spesso: uno e' un
  archivio settimanale e l'altro una pagina quotidiana, ma dopo un `rebuild` sono lo stesso giorno. Per
  questo `injuries.observed_on` doveva arrivare fino all'app (`Spell.observedOn`). Che non sia una
  questione di qualita' e' MISURATO: sui 15 uomini datati da entrambe la differenza mediana e' **+1
  giorno** e 10 su 15 stanno dentro una settimana. Quello che la prosa aggiunge sono **8 uomini su 23
  che Transfermarkt non data affatto**, e la freschezza. E una lettura senza data non scavalca una che
  ce l'ha (la regola del 20/08 su `load_reference`, dal lato del lettore).
- **LA «A» ACCENTATA SI SCRIVE IN DUE MODI, e per una regex sono stringhe diverse.** Trovato scrivendo
  il test: la pagina vera usa la forma precomposta, il caso scritto a mano era venuto decomposto, e lo
  stesso parser leggeva «meta' novembre» su una e niente sull'altra. Cura: `unicodedata.normalize("NFC")`
  prima di guardare, e il test tiene le due forme accanto. *Una fonte che cambiasse forma spegnerebbe il
  canale in silenzio* — stessa famiglia del tag rinominato che il 01/09 ha azzerato gli infortunati.
- **UNA COLONNA NUOVA VUOLE LA CACHE RIGIOCATA, E NON TUTTA**: `reingest_from_cache(pages=...)`, la forma
  che `positions` aveva gia'. Rileggere i probabili per riempire una colonna di `availability` sarebbe
  migliaia di righe riscritte per niente. Backfill offline: 27 snapshot dal 19/08 al 03/09, 186 date e
  11 righe «stagione finita», zero richieste. E **la corsa STAMPA quante date ha trovato** — un canale
  nuovo che finisce a zero in silenzio e' esattamente il difetto del 01/09.
- **UNA NOTA CHE DICE «LA FONTE» QUANDO LE FONTI SONO DUE NON DICE NIENTE**: la card scrive «La stampa di
  oggi dice» oppure «L'archivio infortuni dice», e `OutWindow.source` porta quel fatto invece di farlo
  dedurre. L'ha trovato il banco accusando la card di attribuire alla fonte una data sbagliata — la data
  era giusta ed era dell'ALTRA fonte, e il difetto era che la frase non lo diceva.

## E un banco che verifica una pagina sbaglia negli stessi cinque modi
**04/09/2026, `app/scripts/e2e-plancia-injury.mjs`.** Cinque difetti dell'ARNESE, e ognuno diceva «la
pagina e' rotta» su una pagina che non lo era. Valgono piu' della feature perche' sono il modo in cui si
sbaglia a misurare, e tre sono regole di casa incontrate da capo.
- **UN'ASSERZIONE CIRCOLARE PASSA QUALUNQUE COSA**: la prima ricavava le presenze piene DIVIDENDO il
  numero della card per la quota, cioe' confrontava la card con se stessa. Le presenze piene devono
  venire dal FOGLIO — «un audit che stampa il numero atteso accanto a quello dello schermo senza
  confrontarli», commesso di nuovo.
- **UN JOIN CERCATO NEL POSTO SBAGLIATO ACCUSA LA PAGINA DEL PROPRIO DIFETTO**: il club veniva cercato
  dentro il testo della riga, che porta un nome e due numeri, quindi rispondeva sempre «il calendario non
  conosce il suo club». Si legge dal bundle (`fc_id` → `fc_club_id` → nome canonico), che e' il join che
  il toolkit ha gia' risolto.
- **IL COLORE E' UNA PROPRIETA' DEL TEMA, IL TESTO E' QUELLO CHE SI LEGGE**: la nota si cercava con
  `.text-danger` e leggeva vuoto su una card che la nota ce l'ha eccome.
- **UN TOOLTIP SI VERIFICA APRENDOLO**: con `[nzTooltipTitle]` il titolo e' un binding di PROPRIETA' e
  nel DOM non c'e' nessun attributo da leggere.
- **DUE POPOLAZIONI NON SONO DUE RISPOSTE**: gli esclusi del BUNDLE (18) contro quelli della pastiglia
  (2) — il bundle porta gli infortuni di cinque campionati e la plancia disegna un listone solo. La forma
  che regge e' l'asserzione dal lato dello schermo, «nessuna riga disegnata e' di un uomo sotto la
  soglia», che non ha bisogno di rifare a mano la divisione in slot.
  **E il verso opposto costa piu' caro** (06/09/2026, le coppie `G:A` della Strategia): quando il banco
  legge una popolazione piu' STRETTA della pagina, non tace — ACCUSA. Ri-derivando i gol dai soli voti
  mentre la pagina conta anche il campionato estero, 54 righe leggevano «`0:0` sullo schermo e niente nel
  bundle», e il torto era dell'arnese. *Prima di credere a uno scarto, chiedersi se le due parti stiano
  rispondendo alla stessa domanda su LA STESSA popolazione* — la piu' larga delle due e' quasi sempre
  quella della pagina.

## Una COLONNA con due significati non puo' essere anche la chiave dell'ordinamento
**04/09/2026, `app/src/app/core/plancia.ts` (`regroupByOffer`, `SlotView`) e `views/plancia/`. Dettaglio:
`assistente-asta-v1.md` §39-§41.** La plancia ha due TAGLI: slot **MERCATO** (un rango per FVM diviso il
numero di rose, che e' la popolazione su cui ogni numero del banco d'asta e' misurato) e slot
**PERSONALI**, gli stessi 250 uomini ritagliati per la MIA max offerta. Il tasto li NOMINA, e la sessione
vale per come sono arrivate le correzioni: **cinque dell'operatore, quattro su cose spedite lo stesso
giorno**, e ognuna ha trovato un difetto che nessun banco vedeva.

**IL TETTO NON SI RICALCOLA SULLA GRIGLIA NUOVA.** La scala delle offerte e' una quota del budget per
(ruolo, slot) misurata con lo slot definito come rango PER PREZZO (§19.3 del simulatore), quindi
rileggerla su un rango costruito sulla nostra offerta sarebbe **un parametro applicato fuori dalla
popolazione su cui e' stato misurato** e, in piu', una **circolarita'** - l'offerta decide lo slot che
decide l'offerta. Il taglio personale e' un RIORDINO dei tetti che il mercato ha gia' prodotto: ogni uomo
si tiene la banda che la misura gli ha dato, e la card continua a nominare lo slot su cui e' stata letta.

**E LA COLONNA DELL'ORDINE DEVE DIRE UNA COSA SOLA** (sua domanda: «come mai Hojlund sta prima di
Martinez?»). La colonna della plancia porta due significati **dichiarati** - max offerta finche' e'
nell'urna, prezzo PAGATO quando e' di qualcuno - e sulla griglia personale l'ordine usava il tetto: la
discesa si rompeva **solo sulle righe di chi e' gia' di qualcuno**, con Martinez che mostrava i 403
pagati da un rivale ed era ordinato su una banda di 322. Cura nel NUMERO e non nell'ordine (sul taglio
personale la cifra e' sempre il mio tetto), perche' ordinare per il prezzo pagato renderebbe monotona la
colonna e insensata la graduatoria. *Due significati convivono solo dove non sono anche la chiave.* Lo
stesso argomento ha portato via «i miei in cima al blocco» da quella griglia: un prefisso su una colonna
ordinata rimette la contraddizione che si sta togliendo.

**UN INCHIOSTRO SI SCEGLIE SULLA TAGLIA DEL FATTO, e la richiesta di eliminare qualcosa va letta come
un sintomo.** «Togli Bernabe e Casadei dagli slot personali» → fatto (il predicato non era inventato:
erano esattamente le righe che la plancia BARRAVA) → **ritirato da lui**: «non e' molto rilevante ai fini
del mercato, e' solo una gara saltata, mostrarlo addirittura barrato mi ha tratto in inganno». La causa
stava a monte della lista: un fatto da UNA giornata su 36 era disegnato come una **cancellazione**,
quindi chiedere di togliere quei nomi era la conseguenza ragionevole di quello che lo schermo diceva.
*Quando l'operatore chiede di eliminare qualcosa, chiedersi se sia la cosa a essere sbagliata o il modo
in cui la si mostra.* Il barrato dice adesso «infortunato di lunga data» - uno spell aperto da 45+
giorni, cioe' `LONG_INJURY_DAYS`, la soglia che decide GIA' l'icona, quindi un lettore solo
(`PlayerStatus.longInjury`) e non una soglia nuova - e passa da 12 righe a 2. Chi salta la prossima non
tinge e non sposta piu' niente: il fatto lo porta l'ICONA, e il gradino «in fondo al suo slot» del
03/09 e' andato via CON l'inchiostro, perche' senza il barrato sarebbe stato un riordino MUTO.

**Tre regole di forma nate qui, tutte sull'INTERFACCIA e non sul calcio.** Il colore di uno stato
CALCOLATO e quello di uno stato SCELTO non si mescolano: la lente su una rosa (un click su una card: i
suoi acquisti in chiaro, tutto il resto al 30%) sta davanti a tutto sulla card e ha la sua pastiglia in
barra con la crocetta, perche' **smorzare 250 righe senza una parola in cima si legge come un guasto**.
`opacity` **si MOLTIPLICA lungo l'albero**, quindi un contenitore sbiadito annulla l'evidenziazione dei
suoi figli - e un banco che legge l'opacita' della RIGA non lo vede. E un'utility in piu' sulla stessa
proprieta' si decide sull'ordine del CSS generato: dove serve una variante si scrive una MAPPA
(`LIT_TONE` accanto a `ROW_TONE`), non una classe aggiunta.

**Un guard che ferma META' di un gesto lo rende META' rotto.** Sulla stessa card convivono un click (la
lente) e un doppio click (assegna il lotto), e un doppio click emette prima un `click`: il filtro su
`MouseEvent.detail` fermava il secondo click e **non il primo**, che ha `detail` 1 come tutti. La forma
che regge fa ASPETTARE l'accensione e la fa annullare dal doppio click - il ritardo sta sul gesto raro e
non su quello frequente, che e' l'opposto di quello che il primo commento sosteneva.

**E il tema si guarda dove antd dipinge da se'.** Il «bordo sinistro blu» di un radio group erano due
blu che i nostri override non toccavano: il divisore `::before` (1px x 22px su un bottone alto 24) e
l'alone del FUOCO, **invisibile in ogni screenshot dello stato iniziale** perche' esiste solo dopo un
click. Un tema che ridipinge sfondo, bordo e testo e lascia lo PSEUDO all'autore della libreria sbaglia
in un posto solo, e in quel posto si vede.

## Un banco non puo' fallire sull'ECCEZIONE che porta dentro l'asserzione
**04/09/2026, e l'ha trovato l'operatore su otto passi verdi**: «quando seleziono una squadra e poi ne
seleziono un'altra, i calciatori della squadra precedente restano accesi». Era una mia eccezione allo
smorzamento («i miei restano leggibili sotto la lente di un rivale») - e la prima rosa che uno guarda e'
la propria, quindi il caso che la rompe e' il primo che si incontra. **Il banco era cieco per
costruzione**: nei filtri «nient'altro resta in chiaro» c'era scritto
`row.owner !== mineColour && row.name !== lotName`, cioe' le stesse due eccezioni della pagina.
*Un'asserzione che porta dentro di se' l'eccezione che dovrebbe provare non puo' fallire su quella
eccezione*, e nessun numero di passi verdi lo dice - e' l'asserzione circolare vista da un angolo
peggiore, perche' la circolarita' e' fra il banco e una decisione di design. Cura: tutt'e due le
eccezioni togliute dalla pagina E dai filtri, e **il passo segue la SUA sequenza e non una comoda**
(prima la mia rosa, poi un rivale).

Quattro abitudini di misura che vengono dalla stessa giornata.
- **Normalizzare lo stato per rendere possibile una misura puo' nascondere il difetto che vive solo
  nello stato vero.** Il banco degli slot premeva «azzera le rose» prima di leggere - per una ragione
  buona, la colonna del mercato mescola due cifre - e quel reset eliminava **le sole righe su cui la
  discesa era rotta**. Ora si misura due volte: sul tavolo come arriva, giocato, e dopo il reset.
- **Il colore si confronta fra righe della STESSA pagina, mai con un letterale**: i token sono
  `color-mix` e il tema ha due versi, quindi la sola affermazione verificabile e' «questa riga ha lo
  stesso colore di quella» - col NULL che pretende che le due referenze siano diverse.
- **Una classe che una direttiva mette comunque non e' la prova che qualcosa si veda.** Cercare
  `.anticon-eye` legge «c'e'» anche su una casella vuota; l'asserzione utile e' nella forma GENERALE,
  «nessuna icona della pagina e' vuota», con `waitFor` perche' la risoluzione e' asincrona.
- **Una sonda che serve un ciclo di attesa deve poter dire «non ancora».** `e2e-options` moriva 2 volte
  su 6 su `document.body.innerText`: fra la navigazione e il primo frame il documento non ha un body,
  quindi la sonda LANCIAVA invece di rispondere, e un ciclo che polla non aspetta niente se chi
  interroga puo' morire.

**E una review si verifica come qualunque altra cosa.** Quella richiesta sulla plancia ha dato 14
rilievi e 12 correzioni, e **uno era sbagliato nella sua conseguenza**: «`nzType="eye"` non registrato
⇒ la lente non disegna mai il suo occhio, 404 su `assets/`». La prima meta' e' vera, la seconda no -
togliendo di nuovo la registrazione: 73 icone a schermo, **0 vuote**, occhio disegnato, perche'
`ng-zorro-antd/icon` ha una lista di default che include `EyeOutline`. La correzione resta adottata (un'app
che dipende da cosa un'altra libreria patcha per se' e' fragile), il verbale porta il numero e non la
storia. *Una review e' un'ipotesi con un argomento, non una misura: la meta' verificabile si verifica.*

## Un CONTENITORE decide la forma di una riga, non la FINESTRA — e un riquadro che non si vede non c'e'
**04/09/2026 (sera), `views/strategy/` + `core/strategy.readingsOf`. Dettaglio:
`pagina-strategia-v1.md` §13.** Richiesta dell'operatore: tre pastiglie su ogni riga della Strategia —
quanto rende una sua partita sopra il 6, quante ne gioca (e di quelle quante le chiude bene), quanti
minuti resta in campo. **Nessuno dei quattro numeri e' nuovo**: tre sono colonne del foglio
(`engine_fm_pred`/`est_fm`, `engine_pv_pred`/`est_pv`, `desc_minutes_next`) e il quarto e' la COSTANZA
che la tabella misura gia' (`player-ratings.steadyOf`); il 6 e' `plancia.EDGE_BASE` importato da dove
sta, cioe' una definizione e due lettori. L'aritmetica sta in `core/`, non nel template, e non ordina
niente: la lista resta sul GAIN e le tre pastiglie lo SPIEGANO.

**La seconda pastiglia mescola una PREVISIONE e una MISURA, e lo dice invece di nasconderlo.** `24` e'
il motore, `:20` e' quel 24 per la quota di sufficienze delle sue stagioni — «quante ne chiuderebbe
bene se tenesse il passo che ha tenuto finora». Il chip dei minuti del 18/08 fu curato dichiarando
quale delle due cose fosse; qui la terza strada non esiste — nessuno ha misurato una PREVISIONE di
quella quota, e inventarne una sarebbe una regola senza gate — quindi restano due numeri accanto, il
tooltip dice quale e' quale, e dove la quota e' quasi tutta l'ancora del ruolo (`MOSTLY_ANCHOR`) la
meta' SBIADISCE. *Quando non si puo' separare due nature, si dichiara la giuntura invece di scegliere
la piu' comoda.*

**E LA SOGLIA DI LAYOUT VA SUL CONTENITORE, perche' la domanda e' «quanto e' larga questa lista» e non
«quanto e' larga la finestra».** Tre riquadri in linea chiedono ~104px: su classic le liste sono 386px e
tutto sta in riga (250 righe su 250, **0 nomi tagliati**), su mantra i blocchi sono dodici, la lista
scende a 254px e la prima versione **mangiava il nome per intero e buttava il gain fuori dal blocco** —
la famiglia dei «276px di colonne non strette, ASSENTI». La stessa finestra da' 386 o 254 secondo quanti
blocchi ci sono, quindi una media query risponderebbe alla domanda sbagliata: `@container` sulla lista,
soglia 23rem, e sotto quella le pastiglie vanno a capo DOPO il gain (`order-last`) — il gain resta in
riga perche' e' il numero che ORDINA, e se andasse a capo lui si spezzerebbe la colonna del colore, che
e' quella che si scorre. Prezzo detto: riga da 24 a 38px, ~8 nomi per blocco invece di ~11.

**`bg-control` era la scelta ovvia ed e' stata bocciata dallo schermo**: su questo tema `control`
(#1c1c26) e `surface` (#14141c) distano otto punti per canale, e su una riga dispari (`bg-control/25`)
la pastiglia spariva. Un riquadro che non si vede e' un riquadro che non c'e', quindi e' un INCAVO
(`bg-page` piu' bordo) e senza colore — il colore di una riga e' del GAIN, e una seconda scala accanto
a quella vera farebbe chiedere «quale dei due verdi conta?».

Tre abitudini per l'arnese, e sono le stesse di sempre viste da un lato nuovo (`e2e-strategy.mjs`).
**Il confronto e' col FOGLIO e non con lo schermo**: il `.json.gz` si legge in Node, con gli stessi due
ripieghi dell'app riscritti apposta fuori dall'app — confrontare la pastiglia con un numero ricavato
dalla pastiglia e' l'asserzione circolare pagata quella mattina stessa. Piu' due invarianti
falsificabili che non hanno bisogno di nessuna fonte: le partite buone non possono essere piu' di
quelle giocate, le giocate non piu' delle giornate del calendario. **Un tooltip si verifica aprendolo**
con un puntatore vero (`[nzTooltipTitle]` non lascia nessun attributo). E **la vista stretta ha un
passo suo**, perche' un passo che guarda solo la vista larga direbbe «nessun problema» dopo aver
guardato meta' pagina — con l'attribuzione misurata invece che dedotta: i 16 nomi tagliati su mantra
hanno tutti le pastiglie gia' a capo, quindi non tolgono un pixel alla riga del nome.

**Terza istanza in quattro giorni di DUE SESSIONI SU UN ALBERO, e la lezione nuova e' sul TEMPO.** Le
due meta' — la Strategia (questa) e la PLANCIA (`assistente-asta-v1.md` §39-§41) — non si toccavano
quasi, e mentre misuravo l'albero combinato per decidere cosa committare **l'altra sessione ha
committato la sua da se'** (`f9e456c`). Quindi lo stato dell'albero e' una FOTOGRAFIA che scade: si
rilegge `git status` prima di scrivere il messaggio, o il commit dichiara una composizione che non ha
piu'. Due cose restano vere comunque: il suo commit **porta dentro tre righe di commento mie** in
`plancia.ts` (come `21e7d2e` aveva portato codice dell'altra meta' la mattina), e va detto invece di
lasciarlo trovare; e **il debito dichiarato dentro l'altra meta' si eredita ad alta voce** —
`e2e-plancia-award` resta ROSSO su un difetto preesistente che lei ha gia' attribuito muovendo una cosa
sola e scritto (§39.6, `progress` sottrae invece di contare i padroni).

**E la fotografia e' scaduta una seconda volta, dentro i miei file**: un minuto e mezzo prima del
commit la stessa sessione aveva cominciato una feature nuova nella MIA vista (le bande dello slot, e i
badge dei ruoli tolti dalla riga). L'ho committata con la mia, e la ragione e' meccanica e non di
cortesia: **le sue righe e le mie stanno dentro lo stesso hunk** - l'attributo `class` dello stesso
`<li>` - quindi uno `git add -p` avrebbe committato un template che chiama `bandTone` senza il metodo
che lo definisce. *«Non committare la meta' di un altro» esiste per non lasciare rosso l'albero, non
per obbedire alla lettera: quando separare produce il rosso che la regola vuole evitare, si porta tutto
e si dice di chi e' cosa* - misurando prima (build pulito, 651 test, banco verde), e lasciando fuori
quello che si puo' separare DAVVERO: i suoi due file non tracciati e la coppia `ui/gain-chip/*`, dopo
aver verificato che niente di committato nomini `digits` o `format`. *Separabile vuol dire «l'albero
committato compila senza», e si controlla con un grep, non con un'intuizione sui confini dei file.* Il regalo di quel giro: togliendo
i badge dei ruoli il nome piu' stretto passa da 94 a 116px su classic e da 18 a 81 su mantra, e i 16
nomi tagliati diventano ZERO - *il costo di un layout e' una fotografia che scade, quindi si rimisura
invece di citarlo.*

## Sette parametri sono QUATTRO, e la scala viene dall'archivio mentre il peso viene dal banco
**04/09/2026, dalla richiesta dell'operatore di esprimere i requisiti di una rosa vincente in «4/5
parametri con delle stelline calcolabili a partire dai calciatori acquistati in un determinato
istante», con una lista d'esempio di SETTE voci. Dettaglio, tagli e aperti:
[docs/model/salute-rosa-stelline-v1.md](docs/model/salute-rosa-stelline-v1.md); l'arnese è
`app/scripts/measure-squad-health.mjs`, sola lettura.**

**Prima di disegnare sette stelline si MISURA quante ne esistono**, perché due letture dello stesso
numero finiscono per dare a una rosa due verdetti — il difetto dei campetti e dei due lettori di
`engine_fm_pred`, visto da un lato nuovo. Sulle **1.176 rose vere** di `docs/real-data/` (le 131 aste
con la sua rosa 3/8/8/6, join sul foglio al **98,4%**): **Presenze ~ Bonus r = +0,963** (dentro uno
slot la fantamedia è piatta, quindi «bonus» è «presenze» in un'altra unità → una stellina),
**Difesa ~ Attacco −0,649** (un asse con due versi → una stellina), Copertura ~ Presenze −0,624
(due domande diverse → due stelline), e Spartizione e Diversificazione indipendenti da tutto
(r ≤ 0,12). Sette voci, **quattro assi di stato** più uno di comportamento (a che prezzo compra).

**UNA STELLINA È UN QUINTILE DELLE ROSE VERE**, cioè 3★ è la rosa mediana di un'asta vera: è il null
della pastiglia, e senza di lui «4 stelle» direbbe «bene» in astratto. Ma **l'archivio tara la SCALA
e non può pesare le stelline** — quelle aste comprano per una stagione non giocata, quindi sono un
giudice dell'AMBIENTE come diceva già `simulatore-asta-rilanci-v1.md` §15 — e i pesi vengono dal
banco, in punti a giornata: copertura **−4,73 fp per buco** (+1,3 fp/gg da 2★ a 5★), prezzi pagati
+1,3, presenze +0,7, spartizione +0,55, diversificazione 0 punti e −4,4% di dispersione. Il totale è
la somma pesata **in fp/gg** e non la media delle stelline, che mescolerebbe pesi da 0 a 1,3.

Tre cose che restano oltre la pastiglia.
- **Una stellina che non si può muovere se non muovendone un'altra non è una stellina.** La
  «costanza» chiesta è un EFFETTO della copertura (un uomo vale +1,5 fp a stagione di R-Factor, e il
  modificatore correla −0,821 coi buchi), quindi esce come stellina e resta come NUMERO derivato
  accanto al mod. difesa atteso.
- **Un posto ancora da comprare non è un buco**: a metà asta si segna la rosa PROIETTATA (i posti
  liberi riempiti col miglior uomo che il budget residuo consente alla banda dello slot), con quanti
  uomini sono già suoi scritto accanto — «vuoto = ignoto» applicato a una rosa incompleta, e un
  vincolo che agisce in silenzio è indistinguibile da un ordinamento rotto.
- **Un aggregato può saturare in un reparto e separare in un altro**: i buchi delle rose vere sono
  P **0,000** a ogni percentile · D 0,071 · C 0,065 · **A 0,229** di mediana, quindi la copertura è
  UNA stellina col dettaglio per reparto nel tooltip e non quattro — su tre reparti su quattro non
  separerebbe niente. E la quota difesa che il tilt adotta (25,4%) sta **oltre il p90** delle rose
  vere (mediana 15,4%): 5★ di spartizione è il decile più alto di un tavolo vero, per costruzione.

## DUE PARTITE NON SONO UNA STAGIONE, e tre numeri per una domanda finiscono per litigare
**04/09/2026, da cinque correzioni dell'operatore su nomi concreti. Dettaglio: spec «Novita' v9.72» e
`letture-app-v1.md` §23.** L'audit che ne e' nato e' il risultato: sul foglio del 03/09 **313 righe su
358 avevano il gradino di titolarita' in disaccordo con le proprie presenze attese** — le `bandiera`
promettono >90% delle partite e la loro mediana leggeva 0,58, i `riserva` 0,50, cioe' la scala non
ordinava piu' niente.

**LA CAUSA E' UNA SOLA: TRE QUANTITA' SULLA STESSA DOMANDA, COSTRUITE SU TRE CAMPIONI DIVERSI.**
`play_share` (che decide il gradino) leggeva le DUE giornate giocate, il `claim` (che decide chi la board
disegna) lo standing regredito, `engine_pv_pred` la stagione scorsa. Il commutatore
(`snapshot.measured_season`) contava le giornate su CINQUE campionati insieme — 10 contro una soglia di 5
il cui commento dice «cinque giornate = un settembre» — mentre di Serie A ce n'erano **due**. *Quando due
colonne che descrivono lo stesso uomo si contraddicono, la prima cosa da guardare non e' la formula: e'
se stanno leggendo lo stesso campione.*

**LA CURA E' UNA MISCELA E NON UN INTERRUTTORE**, e il peso non si sceglie: `presence.blend_seasons` usa
la K che il gate ha gia' ADOTTATO per R20 (10 su `default`, 6 su euro), cioe' il tasso di cambio MISURATO
fra «le giornate gia' giocate» e il prior per quella stessa domanda. Ogni finestra entra col PROPRIO
denominatore — che cura da se' l'errore di unita' che il foglio aveva (Douvikas diviso per 2, Kean per
38, stessa colonna) — e a zero giornate giocate la funzione restituisce la stagione precedente intatta,
quindi ogni numero pubblicato dal gate resta identico. Giudicata sul giudice esterno (`press --against
press`): **gli uomini passano da 137 a 153 su 220** contro un null di 104, e il prezzo sui moduli (10 → 8
MATCH) e' detto invece che nascosto.

**E UN GIUDICE CHE HA LETTO LA RISPOSTA NON ARBITRA.** `--against round --round 2` da' al foglio VECCHIO
`bandiera` 100,0% e `titolare` 97,3%: non e' una previsione, e' una copia — quella giornata era il suo
intero campione. Il nuovo la pesa al 15,4% e legge 95,0%. *Prima di leggere un verdetto, chiedersi se il
candidato ha gia' visto l'esito.*

**IL CALENDARIO DI UNA STAGIONE IN CORSO E' QUELLO CHE RESTA.** `matchday_count` conta le giornate GIA'
IN ARCHIVIO, quindi su una stagione cominciata `matchdays_target` (= quelle meno le viste) e' zero e il
ripiego diceva «non e' ancora cominciata» di una stagione alla terza giornata: il foglio prezzava 38
giornate quando ne restavano 36, e ogni presenza attesa e ogni surplus erano gonfi del **5,6%**.

**L'ASSICURAZIONE STA NELL'APP, ED E' UNA FORMULA SOLA** (`core/expected-play.ts`, sua richiesta: «il di
piu' va misurato in ottica pessimistica ... cammino distante dal ciglio 1 metro», e «piuttosto che
cambiare il toolkit meglio implementarla solo nell'app, centralizzata, da usare in ogni pagina»). Tre
passi separati perche' rispondono a tre domande diverse: la BASE (il foglio, o il metro della PLANCIA
dove il motore ripiega su una costante di ruolo), la FINESTRA APERTA (un fatto: Yildiz salta 10 delle 36
che restano), e l'ASSICURAZIONE (un rischio). Misurata su 533 quotati e tre stagioni: per stagione-uomo
si perdono in media 4,93 giornate, al p75 sette; e chi ha due stagioni di storia ha una media di 8,4 e un
massimo di **13,7**, cioe' **la stagione brutta costa 1,63 volte quella media**. Si sottrae lo SCARTO fra
la sua stagione tipica e la sua peggiore e non il totale, perche' il Pa del motore contiene gia' lo
sconto della stagione media — sottrarlo tutto lo conterebbe due volte. Il FATTORE che ne esce riprezza
surplus e valore senza che l'app diventi un motore: tutt'e due moltiplicano le presenze.

**E UN NUMERO CHE NON SI PUO' COMPRARE NON STA IN UNA LISTA DI NOMI DA COMPRARE.** «Cheddira e' ridicolo
che stia nei primi 60 attaccanti»: il difetto non era la sua valutazione, e' che **non e' quotato
affatto** — zero righe in `listone_quotes` — ed era in lista perche' il foglio si costruisce sulle ROSE
VERE e l'app aggiunge chi il listone non ha (70 righe su 602). La regola gia' viva sulla plancia,
portata sulla strategia.

**Un difetto trovato dalla MISURA e non dal codice**: con l'assicurazione due centrocampisti sono scesi
sotto la soglia della plancia e la barra ha letto «C 2/80» su un tavolo azzerato. `progress` ricavava gli
assegnati come `capienza − rimasti`, contando come acquisto un uomo che nel blocco non era mai entrato.
*«Quanti posti restano» e «quanti ne sono stati comprati» sono due domande diverse, e un conteggio si
conta.*

## Una CARD sola per due pagine, e le righe che non si disegnano
**05/09/2026, cinque richieste dell'operatore in una sessione. Dettaglio: `pagina-strategia-v1.md` §15,
`letture-app-v1.md` §24, `assistente-asta-v1.md` §42.** «Se draggo un calciatore ordino, se invece clicco
solo si apre la card con il dettaglio del calciatore (LA STESSA della plancia)» — e la card e' dovuta
uscire da `views/plancia/` per andare in `ui/player-card/`, perche' due card sarebbero due letture degli
stessi `engine_*`.

**QUELLO CHE NON SI POTEVA RIUSARE E' COME I NUMERI ARRIVANO: la plancia prezza sempre
`default|classic`, la Strategia il foglio della combinazione DICHIARATA** (euro|mantra compreso). Una
card che andasse a prendersi i numeri da se' direbbe di un uomo il surplus di un altro gioco. Quindi
riceve un `CardMan` gia' letto da chi la apre, e la META' D'ASTA (max offerta, prezzo pagato, padrone, i
due bottoni) e' un campo OPZIONALE: sulla Strategia non c'e' un tavolo, e disegnarne uno inventato
accanto a una lista che non lo riguarda sarebbe la demo che prezzava il listone euro con la scala di
Serie A. Quello che invece la card si prende da se' sono i fatti che NON dipendono dal foglio: i marchi,
la nota dichiarata e le ultime partite.

**DUE GESTI SULLA STESSA RIGA SI DISTINGUONO CON UNA SOGLIA, E LA GUARDIA SI SPEGNE SU UN TIMEOUT.** Sotto
i 5px di CDK nessun `cdkDragStarted` arriva e un click e' un click; ma CDK non spegne il `click` che il
browser manda dopo un RILASCIO, quindi senza guardia ogni riordino aprirebbe anche una card. E la guardia
si abbassa dopo, non dentro il click: se un trascinamento finisce e nessun click segue, un flag che
aspetta il click si mangia quello dopo — «un guard che ferma meta' di un gesto lo rende meta' rotto»
(04/09), incontrato dall'altro lato.

**UNA GIORNATA DI CUI NON SI SA NIENTE NON E' UNA SUA PARTITA**, ed e' la risposta a tre domande
dell'operatore su nomi diversi («perche' Lucca o Neres non mostrano lo scorso anno?», «perche' Kolo Muani
o Beto non hanno storico?»). Misurato: righe di Serie A nei voti per il 2025-26 — Hojlund 33 e Santos 14
fino alla 38ª, Lucca 16 (ultima la 19ª), Neres 16 (la 18ª), **Kolo Muani zero**, **Beto zero su due
stagioni** (38 + 37 di Premier). Le giornate mancanti finivano in lista come assenze senza un incontro,
cioe' tre `??? – ???` in colonna. La cura e' una regola sullo STATO e non una soglia: `not_in_league` e
`absent` vogliono dire che di lui quel giorno questo campionato non ha nessuna traccia — quindi non si sa
nemmeno contro chi giocasse il suo club, ne' che il suo club fosse quello — e non si disegnano; `bench` e
`injured` restano, perche' **una distinta e uno stop datato sono prove su di lui**. Dove non resta niente
la card lo DICE invece di sembrare guasta.

**UN JOIN PER NOME SI FA SOLO PER UNO STEMMA, E SI MISURA PRIMA.** Dell'avversario di una partita questo
progetto tiene il nome del provider e niente che lo identifichi. La chiave normalizzata riusa la lista di
parole vuote che `nameWords` ha gia' (`SSC Napoli` → `napoli`) e sui 106 club del bundle da' **106 chiavi,
zero collisioni**; risolve il **95,2%** delle righe di Serie A e il **10,9%** di Bundesliga, dove il
provider scrive `1. FC Koln` e il listone `Colonia`. Chi non si risolve resta col monogramma, che e'
quello che aveva prima: **un fatto che decide un numero non passerebbe mai di li'.**

**E DUE COSE CHE MANCAVANO DAVVERO, tutt'e due «il dato c'era e non lo leggeva nessuno».**
`match_ratings.started` e `minutes` sono NULL su tutte le **62.594** righe del bundle, quindi la distinta
viene dal livello per-partita; e `seasons()` aggiungeva la stagione bersaglio FUORI dal `Set`, quindi da
settembre in poi compariva DUE VOLTE e chi camminava quella lista leggeva le stesse partite due volte.

Quattro regole di forma nate qui, e tre sono di casa incontrate da un lato nuovo.
- **I TOOLTIP SONO CORTI, sempre** (sua regola: «poche parole per indicare il significato di quella sigla
  o quell'icona ... quando voglio spiegazioni piu' dettagliate te lo indico io»). Il caso peggiore era un
  paragrafo di ~700 caratteri sul contatore di un blocco — una LEGENDA su un bersaglio che si incontra
  scorrendo. *La ragione di una scelta non e' documentazione da mettere a schermo: va nel codice accanto
  alla riga che la applica, e in `docs/model/`.*
- **UN'ICONA HA LO STESSO SIGNIFICATO IN OGNI PAGINA**, che e' la sua condizione esplicita: quindi un
  componente solo (`ui/bonus-mark`) letto dalla riga compatta E dal pannello grande, e il marchio si
  sceglie su un `kind` DICHIARATO e mai sull'etichetta — due pagine che leggessero il testo dipingerebbero
  due cose diverse il giorno in cui una frase cambia parola. Stessa cosa per le fasce del voto
  (`vocabulary.voteInk`, verde sopra il sei su sua richiesta): una definizione, tre lettori, e il prezzo
  detto — anche le celle della tabella Calciatori cambiano tinta.
- **UNA RICERCA «INTELLIGENTE» E' UNA CHIAVE APPLICATA AI DUE LATI, non un punteggio.** `looseKey`
  (accenti via, `ck`/`ch` → `c` PRIMA di `k` → `c`, `j`/`y` → `i`, la `h` muta via, doppie singole) tiene
  `includes` deterministico e senza soglie da tarare: `Hojlund` si trova scrivendo `oilund`. Quello che
  NON fa e' altrettanto deciso — niente metafone, niente troncamenti: **in una lista di duecentocinquanta
  nomi un falso positivo costa piu' di un nome da riscrivere.**
- **UN FILTRO NON DEVE RINUMERARE NIENTE, e mentre e' attivo il riordino a mano si SOSPENDE**: il numero
  accanto al nome e' il posto vero (assegnato prima del filtro), o tre righe trovate direbbero che il
  quarantesimo difensore e' il primo; e il prefisso dell'ordine personale si costruisce «dai nomi come
  sono a schermo», che su una lista filtrata scriverebbe un ordine di una lista che non esiste.

**E due difetti dell'ARNESE, che valgono quanto quelli del codice.** Il passo del chevron cercava il
contenitore delle partite come «il primo div che contiene una partita» e prendeva il riquadro INTORNO
all'elenco, che non scorre: accusava di non scorrere una lista che scorre. E pretendeva un `button` sotto
il puntatore, mentre al centro di un'icona c'e' un `<svg>` — che e' SUO. *Un passo che misura l'elemento
sbagliato accusa il codice del proprio difetto*: si chiede al bottone (`button.contains(under)`), non al
nome del tag.

## Una colonna DERIVATA che una ri-ingestione cancella, e un dato che il parser buttava via
**05/09/2026, nato da una richiesta sull'app e finito nel toolkit. Dettaglio: spec «Novità v9.73»,
`letture-app-v1.md` §25.** «I voti sintetici devono essere utilizzati anche dall'app per ricostruire lo
storico del calciatore anche quando ha giocato fuori dalla serie A»: il codice per leggerli era da
scrivere, ma la colonna era **vuota proprio sulle tre stagioni che il bundle esporta**.

**`INSERT OR REPLACE` CANCELLA LA RIGA E NE SCRIVE UNA NUOVA, quindi ogni colonna che l'istruzione non
elenca torna NULL.** `mv_synth` la scrive `synth` e nessun parser, quindi ogni rilettura di una giornata
la buttava via: **100% delle righe con rating fino al 2023-24 ne aveva una, 0 su 88.121** dal 2024-25 in
poi. La regola non era rotta — riapplicata ha convertito 77.317 di quelle 88.121 — era la catena che si
mangiava se stessa. Cura: `ON CONFLICT ... DO UPDATE SET <colonne osservate>`, con il derivato **ritirato
solo se cambia l'input da cui è calcolato** (`rating IS excluded.rating`): *un derivato stantio è peggio
di uno vuoto*, che è «vuoto = ignoto» applicato a una colonna calcolata. E un test che deriva l'elenco
delle assegnazioni dal TESTO dell'INSERT, perché una colonna aggiunta a uno e non all'altro smetterebbe
in silenzio di essere aggiornata dalla seconda lettura in poi.

**E QUINTA ISTANZA DI «IL DATO C'ERA»** dopo i campetti, `availability`, l'asterisco e la data di
rientro: `download_round` costruiva l'evento senza `homeScore`/`awayScore` mentre `parse_round` sa
leggerli da sempre e li riceveva solo dal layer EXTRA — **`team_goals` vuoto sul 98,5% delle righe di
campionato**. Serve per una domanda sola: quanti gol ha subito un portiere in una partita che il
fantacalcio non vota. **I file già in cache non lo recuperano**, perché la cache tiene l'evento già
sfoltito e non il payload grezzo: la colonna si riempie giornata per giornata, e dirlo è parte della cura.

**LA PREMESSA DELL'OPERATORE ERA GIUSTA E IL SUO CASO RARO ERA UN ALTRO.** «I gol subiti li prendi pari
pari ai gol segnati dall'avversario ... la rarità di un tale evento è così rara» (il portiere uscito prima
del gol). Quel caso è raro davvero; quello che non lo è è che **il marcatore avversario spesso non è nel
nostro perimetro**, quindi ricostruire dai nostri dati è esatto il **95,1%** sulla Serie A e il **72,5%**
all'estero (Ligue 1 60,6%), con errore medio **−0,325 gol** — cioè il fantavoto di un portiere sintetico è
ottimista di un terzo di punto. *Quando si accetta un'approssimazione dichiarata, si misura ANCHE il modo
di sbagliare che nessuno aveva nominato*: la differenza fra il 95% e il 72% è il PERIMETRO e non il metodo.

Quattro misure che restano perché altri le riuseranno: i GOL del layer per-partita concordano al **100%**
coi voti veri su 24.393 partite (NULL letto come zero, e delle 1.745 in cui ha segnato **nessuna** legge
NULL); gli ASSIST al **99,25%**; i CARTELLINI non esistono affatto (**0 su 352.754**, nessun modulo li
scrive) e un'ammonizione cade nell'11,2% delle partite, quindi qualunque somma da questo strato è
ottimista di ~0,06; e il **bonus porta inviolata NON è nel fantavoto pubblicato** (1.218 su 1.222 portieri
a porta inviolata leggono `voto + bonus` senza premio) — è un modificatore di lega, non un termine della
riga.

## Un VOTO SINTETICO vive sull'alfabeto della fonte, e una scala si dichiara sulla riga
**05/09/2026, `letture-app-v1.md` §25.5.** «Mostra i voti sintetici arrotondati sempre a 0,5»: misurato
prima di implementarlo, **57.925 voti veri su 57.925** stanno sui mezzi punti, e altrettanti fantavoti.
Un sintetico che legge `5,88` scrive una cifra che il fantacalcio non pubblica mai, e la falsa precisione
si vede proprio dove serve confrontarlo con un voto vero. Prezzo dichiarato: **0,129 di spostamento medio**
contro i **0,37** di errore che la retta di `synth` ha di suo — un terzo del rumore che c'è già.
L'arrotondamento sta nello STORE e non nella vista, perché il fantavoto si somma a QUEL numero e la riga
deve tornare.

**E LA DOMANDA «DI CHE SCALA È QUESTO NUMERO» NON SI RISPONDE GUARDANDO IL TIPO DI RIGA.** `voteText`
decideva su `kind`, quindi su una riga che vale `~5,9` stampava `*6,7`, cioè il rating del provider.
Erano la stessa domanda finché solo il proprio campionato poteva portare un voto; da quando il layer
per-partita porta il sintetico anche degli altri quattro sono DUE domande, e leggere la seconda al posto
della prima è un errore di unità. Da qui anche `MatchKind` con `other_league`: **un campionato straniero
non è una coppa**, ed è la distinzione che rende legittimo il `~` — `synth` calibra su esattamente quei
cinque campionati e su nessun altro.

## `display: contents` è una riga che non si può dipingere, e `opacity` si moltiplica
**05/09/2026.** Una riga di partita era `display: contents` perché è così che le sue celle restano
incolonnate con quelle delle altre righe; il prezzo è che **non esiste come elemento**, quindi
«evidenziala» non ha un posto dove andare — e dipingere le cinque celle una per una lascia scoperti i
`gap`, cioè una riga a strisce che si legge come un guasto. **`grid-cols-subgrid`** dà tutt'e due: un
elemento che occupa tutte le colonne e celle allineate alle piste del genitore. *E l'incolonnamento si
MISURA dopo il cambio* (la x di ogni cella riga per riga), perché è esattamente quello che un cambio del
genere può rompere in silenzio.

**L'attenuazione va sulle CELLE e non sull'ospite**, perché `opacity` si moltiplica lungo l'albero (già
scritto per la plancia, incontrato qui dal lato opposto): sull'ospite spegnerebbe a metà anche il suo
sfondo, cioè un'evidenziazione che può cadere sulla stessa riga.

**E LO SPAZIO LIBERO IN UNA GRIGLIA VA DOVE STA `1fr`, NON DOVE SI STRINGE.** «Stringi gli stemmi e
lascia più spazio ai bonus»: stringere le colonne interne non ha dato un pixel a nessuno, perché la cella
dell'incontro era `1fr` e i bonus `auto` — l'aria restava dentro la cella che si era stretta. *Un problema
di spazio si risolve dove le tracce sono dichiarate, non dove il contenuto è largo.*

## Verificare una CARD: sette modi di sbagliare a misurare, cinque commessi
**05/09/2026, `app/scripts/e2e-player-card.mjs`.** Il banco guida la plancia vera, apre una card e
confronta ogni numero **col bundle** letto dallo stesso server della pagina. Cinque difetti erano suoi, e
sono la parte che vale oltre questa card:
- **`display: contents` inganna chi legge la griglia**: i figli sono i COMPONENTI e non le celle, quindi
  leggerne cinque alla volta impacchetta cinque partite in una riga sola.
- **Un indice costruito su meno di quello che lo schermo disegna sbaglia ad ATTRIBUIRE**: una partita di
  FA Cup finiva sulla partita di Premier fra gli stessi due club, e il banco accusava la pagina di
  stampare numeri sbagliati mentre stampava quelli giusti di un'altra partita.
- **Un uomo identificato col PRIMO nome che è sottostringa della riga**: «Sanchez Ro.» prendeva l'id di un
  altro Sanchez, e il riepilogo «non tornava». Si prende il più LUNGO.
- **Una griglia di valori pretesa da un numero di un'ALTRA scala** (i mezzi punti dal rating del provider).
- **Un elemento nuovo letto come uno vecchio**: il riepilogo di stagione contato come divisore avvelenava
  l'attribuzione di ogni riga sotto.
Più due regole di lettura: i due club di una riga si leggono SEPARATI e non da una stringa unita (in mezzo
c'è il risultato), e uno stemma si legge per componente e non per posizione delle `<img>` — un club senza
stemma non ne disegna nessuna e quello di destra scivola a sinistra.

## Quarta istanza di DUE SESSIONI SU UN ALBERO, e stavolta il loro half non compilava
**05/09/2026.** Le due metà (la card, e il rifacimento `riser` in `valuation-store`) non si toccavano, ma
l'albero condiviso **non compilava** per la loro. La procedura scritta il 27/08 ha retto senza modifiche:
`git worktree add --detach <tmp> HEAD`, copia dei SOLI file miei, `node_modules` e `public/data` in
giunzione — build pulito, 728 test app, 674 toolkit, dieci banchi e2e verdi. *Committare la propria metà è
legittimo solo se si è VERIFICATO che compili senza la loro*, e questo è il modo di verificarlo.
L'autorship si misura in un comando (`git diff | grep` per il vocabolario di ciascuna feature, file per
file) e qui ha separato tutto tranne tre file che sembravano misti e non lo erano: il conteggio grezzo
prende anche il contesto, quindi la conferma è un grep sulle sole righe AGGIUNTE.

## Un FILE letto prima di essere scritto dà DUE valori a una colonna, e l'esperimento che lo assolveva teneva ferma la variabile sbagliata
**05/09/2026, il difetto più grosso della giornata e il mio errore più istruttivo. Dettaglio: spec «Novità
v9.75» §5.** `minutes_next` legge `manifest.matchdays.platform_target` per l'unica metà del suo `P` che
viene dal MODELLO, e `snapshot` scrive il manifest **dopo** la passata dei campetti. Su una cartella NUOVA
quel numero è **zero** e la colonna esce calcolata sulla sola misura; su una cartella RIUSATA la passata
legge il manifest della corsa **precedente**, in silenzio. Malen 74,0 col manifest e **78,0** senza, 241
righe su 602 in mezzo — abbastanza da riordinare i tre gradini alti della scala, che hanno i pavimenti a
75' e 65' (`titolare` letto **2** invece di 33). Il docstring prevedeva lo zero «per un foglio scritto
prima che il manifest lo portasse» e nessuno aveva notato che capita al PRIMO giro di ogni cartella nuova,
cioè **ogni giorno**, e a **ogni pacchetto del viaggio nel tempo**. Cura: il numero si **passa**
(`write_boards(..., matchdays=...)`), con un test che lo pretende nella firma E al punto di chiamata.

**E LA LEZIONE SUL METODO VALE PIÙ DEL DIFETTO.** Per un'ora l'ho attribuito all'ordine d'iterazione
delle stringhe, su un esperimento che sembrava decisivo: due corse a `PYTHONHASHSEED=0` concordavano su
tutte le righe, due senza divergevano su 241. Concordavano per la ragione sbagliata — **entrambe
scrivevano in cartelle nuove**, quindi entrambe leggevano zero. *Un esperimento che tiene ferma una
variabile che non sapevi di avere non ha tenuto ferma niente*, e la conferma che sembra più pulita è
esattamente quella da sospettare. Quello che ha trovato la causa è stato **rigirare nella STESSA
cartella**, cioè muovere la variabile invisibile invece di quella che credevo di studiare. Due corollari
già scritti altrove e incontrati qui da capo: un `grep` che filtra solo le righe di SUCCESSO fa leggere
il silenzio come «tutto bene» (una delle tre corse era caduta e l'ho saputo dieci minuti dopo aver citato
quella regola); e prima di attribuire un difetto, si diffano TUTTE le colonne — qui furono 2 su 199, ed è
quel 2 su 199 a localizzarlo.

## Un'ASSENZA non è uno ZERO MISURATO, e la cura ovvia è peggio del difetto
**05/09/2026, dai cinque nomi che l'operatore ha portato guardando le prime due giornate. Dettaglio:
spec «Novità v9.75» §1-§3, gate §7-trequadragies.**

**Il prior di chi qui non ha mai giocato era «zero presenze su dieci giornate»**: non un ripiego prudente,
un TETTO — qualunque cosa facesse, la sua quota non poteva superare `k/(k+K)`, cioè **0,167** con due
giornate. 113 righe su 602, e tredici uomini che avevano cominciato da titolare TUTTE E DUE le prime
partite leggevano `riserva`. **Ma togliere la finestra è il difetto opposto e più grosso**: quei 113
poggerebbero su due partite e leggerebbero **1,000** (Rrahmani `bandiera` con 19 minuti giocati, i terzi
portieri da 0,077 a 0,334). Quindi il prior è la **mediana della sua popolazione**, che era già misurata e
già in uso due colonne più in là. *Quando le due letture estreme di un vuoto sono entrambe sbagliate, la
risposta è quello che fa la sua popolazione — e se nessuno l'ha misurato, si misura.*

**E UNA FINESTRA NE PORTA TRE, non una.** `SeasonWindow` porta presenze, partite da titolare e MINUTI, e
`standing` legge i minuti: un prior con le sole presenze avrebbe curato una colonna e rotto quella
accanto. Le due quantità nuove sono misurate sulla stessa popolazione ed espresse come **rapporti alla
presenza**, così si COMPONGONO con qualunque costante sia in vigore invece di sostituirla — e l'arnese
riproduce le costanti già adottate prima di misurare qualcosa di nuovo, che è l'unico modo di sapere che
sta guardando la stessa popolazione.

**UNA COSTANTE APPARTIENE ALLA DOMANDA SU CUI È MISURATA, non solo alla popolazione.**
`season_prior_rounds` era **presa in prestito** da R20 — misurata per l'accuratezza di `engine_pv_pred` a
sei e dieci giornate giocate — mentre qui la quantità è `appearance_share` e il momento è k = 2.
Rimisurata su quella domanda: **K = 5**, ottimo interno, piatto fra 4 e 6, e le 10 costano +1,8%.
L'ottimo è lo STESSO a k = 2, 4 e 6, che è la proprietà che un prior deve avere; e 6 è la K che il gate
aveva già adottato per R20 su euro — due strade indipendenti sullo stesso numero. **La proposta
dell'operatore di una PERCENTUALE FISSA (50/50) è respinta dalla misura** (+4,7%) e per una ragione
strutturale: una quota fissa fa CRESCERE il prior col procedere della stagione, che è il contrario di
quello che un prior è. Il suo meccanismo («il passato ha un contesto diverso») è invece **vero e non
sposta il cambio**: il cambio di club peggiora tutte e due le metà, quindi il loro rapporto quasi non si
muove — e una manopola per popolazione che vale un punto di K non si adotta.

**E IL DENOMINATORE DEL PRIOR SEGUE IL SUO NUMERATORE**: la regola del 20/08 rientrata dalla porta della
miscela. Malen ha giocato 18 delle ultime 18 della Roma e leggeva 0,562, perché il denominatore era il
calendario del CAMPIONATO e gli contava anche le giornate giocate in Premier; con la sua finestra vera
legge **0,918**. *Una regola curata in un punto va cercata in ogni punto che ricostruisce la stessa
quantità.*

**Quarta istanza di «una finestra vuota non è una finestra a zero», e la prima trovata leggendo un
COMMENTO**: il ritiro entrava con `minutes=0`, mentre il commento al punto di chiamata prometteva già che
«entra con i minuti della media delle altre e non ne sposta il rapporto di un decimale». Lo spostava di
0,060 a K=10 e di **0,100 a K=5**, cioè il difetto peggiorava con la costante adottata la stessa ora.

## Nell'undici tipo non si ignorano TUTTI gli infortuni, e il rientro è misurato
**05/09/2026, dichiarazione dell'operatore + 856 casi. Dettaglio: `formazioni-tipo-v1.md` §8, spec
«Novità v9.75» §6.** «Se un calciatore non può giocare 6 mesi non può rientrare nella formazione tipo; se
non può giocare 3 mesi può rientrare ma con tanti dubbi e la sua percentuale deve diminuire nettamente.»
Cambia la DEFINIZIONE che il pannello portava dall'08/08 («la squadra che schiera quando sono tutti
disponibili», il caso De Bruyne): quella definizione era coerente e chiedeva di disegnare un uomo fuori
fino a dicembre. È sua, quindi nessun gate la possiede — ma il DISEGNO ha un giudice esterno e la si
misura là.

La quantità è la **quota delle giornate del suo club che restano in cui è disponibile**, col denominatore
che parte da OGGI perché le giornate già giocate le hanno perse tutti; il `claim` la moltiplica, e sotto
`BOARD_OUT_SHARE` = 0,50 esce di netto. **La soglia è oggi INERTE** (0 righe su 32 sotto): quello che
lavora è la moltiplicazione, e Yildiz e Thuram escono dall'undici della Juventus **per graduatoria e non
per taglio**. Il margine di prudenza NON sta qui — `RETURN_SLIP` vive nell'app, e metterne un secondo
conterebbe la stessa paura due volte. **Il gradino resta condizionale** per sua decisione esplicita: la
scala è definita sulla quota delle partite in cui è DISPONIBILE, quindi non prende lo sconto, e Yildiz
scende a `ballottaggio` solo perché la board non lo disegna più.

**E LA SUA IPOTESI SUI CONTENDENTI È MISURATA, con il regime che cambia dove lui aveva messo le soglie.**
856 spell chiusi, appaiati coi compagni della sua linea rimasti sani: al rientro un mese costa −0,116 di
quota da titolare, due-tre mesi −0,134, **quattro-sei mesi −0,256**; e nelle giornate 7-18 la prima e la
seconda banda sono già rientrate nel rumore mentre la terza tiene **−0,143** (in minuti: −5,2' · −5,6' ·
**−19,2'**, e dopo −1,3' · −0,3' · **−12,4'**). I contendenti raddoppiano durante l'assenza e ne tengono
metà, **piatto su tutte e tre le bande**: quello che cambia con la durata non è quanto guadagnano loro, è
quanto lui non recupera. Le sue due soglie cadono esattamente sul cambio di regime — terza volta che
succede in questo progetto, e come le altre due **è evidenza e non una ragione per tarare la soglia su
quei numeri** (n = 38 nella banda lunga). Il RODAGGIO, che era l'altra metà della sua ipotesi, era già
misurato il 04/09 e vale ~1,3%: piccolo. La parte che valeva era quella che non modellavamo.

## Il dato c'era, in una tabella che nessuno leggeva per quella domanda
**05/09/2026, quinta istanza. Dall'operatore: «non riusciamo in nessun modo a recuperare le partite di
Varela in Primeira Liga?»** Sì: `tm_appearances` (acquisita il 17/08, 2,08M righe su 3.535 giocatori) ne
porta **32 partite giocate, 1522', 6 gol, 3 assist**. Cosa quella tabella porta e cosa no va detto: minuti,
gol, assist, competizione e posizione per partita **sì**; **se è partito titolare no** — `state` è
`played` / `in squad` / `not in squad`, cioè la partecipazione e non la distinta, e il surrogato sono i
minuti a presenza (Varela 47,6': un uomo di rotazione). E una trappola trovata **misurando invece che
dichiarando**: quella tabella ha 1.086 codici di competizione e dentro c'è il calcio GIOVANILE (`IJ1` =
Primavera 1, anno di nascita mediano **2006**), quindi 38 partite di Penev e 14 gol di Gabellini non sono
una stagione da senior. L'età mediana di chi ci gioca separa senior e giovanili senza che nessuno debba
decidere.

**E LA SUA REGOLA ASIMMETRICA È GIUSTA PER UNA RAGIONE PRECISA.** «Un attaccante che fa pochi gol in
Primeira Liga ne farà ancora di meno in Serie A → inutile porre attenzione; uno che segna tantissimo
potrebbe essere un talento in erba → giusto acquisire altri dati.» Non è un coefficiente, è **dove
spendere attenzione** — e questo è ciò che la misura del 25/08 lasciava aperto: là era stato respinto
usare le presenze di un campionato non coperto come *predittore* (−6,9%, «la retta non ha un termine di
livello»), e un FLAG quel termine non ne ha bisogno perché il livello lo giudica l'operatore leggendo il
nome del campionato. **Stessa quantità, due domande, due verdetti opposti.** Col metro della Serie A
2025-26 (g+a per 90 di chi ha ≥900': A 0,43 / 0,59 / 0,76 · C 0,25 / 0,36 / 0,44) e 55 uomini con una
stagione senior di lega, quello che segnala è **Bobcek** (20 gol e 6 assist in Ekstraklasa, 0,95 per 90,
oltre il p90 di un attaccante di Serie A, e la scheda dice `riserva`); e **Varela cade nel ramo basso
della sua stessa regola** (0,53 fra mediana e p75, in un campionato più debole), cioè «usa l'ancora di
ruolo» — che è ciò che il foglio fa già. Il limite dichiarato: `tm_appearances` copre i giocatori che
abbiamo chiesto, quindi **dentro un campionato minore non esiste una popolazione** contro cui fare un
percentile (provato: sopravvivevano 6 uomini su 113), e il metro deve essere la Serie A.

## Una POPOLAZIONE la dichiara l'operatore, un CRITERIO no — e un bordo dichiarato non è un bordo misurato
**05/09/2026, da tre domande su Palestra e da un'istruzione. Dettaglio:
[docs/model/letture-app-v1.md](docs/model/letture-app-v1.md) §26.** «Se lo scopo è individuare calciatori
come Palestra allora dobbiamo tarare i limiti in modo che Palestra sarebbe rientrato l'anno scorso.»
Sembra la cosa che questo progetto vieta — «un criterio non si allarga perché una regola ci è caduta» —
e non lo è: **quella regola riguarda l'ADOZIONE di una regola, questa è la POPOLAZIONE bersaglio**, che
è una dichiarazione dell'operatore come `board_rulings.json`. Quello che la ridichiarazione impone non è
di allentare: è di **rimisurare tutto sulla popolazione nuova** e di dire il prezzo (qui 1,64× con lui
contro 1,86× senza).

**E il bordo che si è mosso era un parametro che nessuno aveva mai misurato.** Il pavimento della fascia
dello screen `starter_signs` (30° percentile, «sotto è un riempitivo le cui quattro buone partite sono
una coppa») era DICHIARATO nel commento e mai passato al setaccio. Al setaccio **costa precisione zero e
compra lift** — 30 → 1,93× · 20 → 2,02× · **0 → 2,26×**, monotono, +7 uomini a stagione — perché sotto
il 30° diventare titolare è più RARO, quindi la stessa precisione sta contro una base più bassa.
*Una frase plausibile scritta accanto a una costante non è la sua misura*, ed è la stessa famiglia di
«mai adottare un parametro sul bordo della sua griglia», incontrata dal lato di un bordo che nessuno
aveva guardato.

**METÀ DI UN LIFT PUÒ ESSERE «GIOCA», E VA DETTO QUALE METÀ.** «Quotato ≤5 e titolare in tutt'e due le
prime giornate» legge **19,3% contro 3,5% (5,46×)** su 636 uomini e 6 stagioni su 6; dentro la
popolazione di uno screen che pretende GIÀ 90 minuti in quelle due giornate, lo stesso segnale vale
**1,16×**. Nessuno dei due numeri è sbagliato: sono due domande, e il 5,46× è utile solo perché
«chi sta giocando» è invisibile su seicento righe — non perché sia un'opinione migliore sui calciatori.

**LA CONTROPROVA CHE TIENE ONESTO UN FILTRO A DUE TERMINI È MISURARE OGNI TERMINE DA SOLO.** «Ha
cominciato l'ultima giornata» + «il valore di mercato è raddoppiato in 24 mesi» vale 1,78×; il valore di
mercato **da solo** vale **1,22×**. Senza quel numero il filtro sembrerebbe un canale nuovo e sarebbe
lo stesso fatto contato due volte.

**PRIMA DI COSTRUIRE UNO SCREEN SU UNA FONTE, SI MISURA LA SUA COPERTURA ALL'INDIETRO.** L'operatore ha
chiesto di contare le amichevoli pre-stagionali «anche se hanno meno validità»: `club-friendly-games`
copre 20 club di Serie A su 20 **solo per il 2026-27** e **2 e 4** nelle due stagioni precedenti, perché
quel livello è stato acquisito quest'estate. Quindi nessuno screen che le legga è verificabile su una
stagione passata, e un marchio senza verdetto dietro è la cosa che qui non si spedisce: viaggiano nella
FRASE, dove informano senza decidere, e la misura è **pre-registrata per l'estate 2027**.

**UN MARCHIO CHE SI DISEGNA IN UNA VISTA SOLA È INDISTINGUIBILE DA UN MARCHIO CHE NON ESISTE** (terza
istanza, dopo i campetti e `availability`). `starter_signs` era misurato dal 14/08 e lo registrava il
PANNELLO D'ASTA invece di `ValuationStore`, quindi in plancia e in Strategia non era mai comparso. E il
suo compagno era muto per un'altra ragione ancora: `RISER_FROM` = 4 lo faceva tacere sulle prime tre
giornate — zero righe su 602, **per costruzione**, che è il posto peggiore in cui un buco possa
nascondersi, ed era esattamente la finestra in cui si compra.

Quattro abitudini, e due sono errori di misura miei della stessa giornata.
- **Un rango di ruolo calcolato DENTRO la fascia non è un rango di ruolo**: la prima curva leggeva una
  base del 25,4% dove è il 3,5%, perché «i primi 30 del ruolo» erano calcolati sui soli quotati a ≤5.
  Un lift diluito da una popolazione sbagliata sembra un risultato modesto, non un difetto.
- **Un conteggio di copertura per NOME di club non è una copertura**: leggeva 2 club di 20 con
  amichevoli in archivio; con `club_index` sono 20 su 20. Quinta istanza della stessa regola.
- **Si verifica CHIAMANDO la funzione sulla finestra vera**: `starter_signs` con la data del 15/08/2025
  accende 56 uomini su 663 e Palestra è dentro, e quella lista realizza **39,3% contro 26,2% (1,50×)**.
  Nessuna tabella di celle sostituisce una corsa sulla stagione che l'operatore ricorda.
- **E una riproduzione non è la misura che riproduce**: la mia lettura dello screen esistente dà 86,2%
  dove il file ne pubblica 79,1%, perché loro misurano su cinque campionati e io sul listone Serie A. Si
  rivendica la FORMA dentro una sola riproduzione (2 giornate tengono il 91% del lift che ne hanno
  quattro), mai il livello.

**E una nota di attrezzo, pagata due volte**: un `node_modules` attaccato per GIUNZIONE rompe vitest (43
file, «no tests», due istanze del pacchetto). In un worktree di verifica si fa `npm ci --prefer-offline`,
che costa **21 secondi** — mentre `public/data` per giunzione va benissimo, perché sono dati e non moduli.

## Tre colonne che sono una frazione e il suo valore vengono dalla STESSA finestra
**05/09/2026, da un'osservazione dell'operatore su tre attaccanti in cima alla lista della Strategia: «i
minuti previsti a partita sono molto bassi (Thuram 39, Krstovic 36, Castro 38) ... non sarebbe il caso di
un malus sul GAIN?». Dettaglio: spec «Novità v9.74» e `letture-app-v1.md` §27.** Prima di prezzare un
fatto si verifica che sia un fatto, e non lo era: Thuram aveva giocato 29 partite, 24 da titolare, 1913
minuti. Tre attaccanti di punta tutti sui 36-39 minuti sono la firma di una causa NOSTRA, come lo è uno
zero uniforme.

**La miscela del 04/09 aveva spostato DUE colonne su tre.** `desc_season_starts` e `desc_season_matches`
erano passate a `blend_seasons`, `desc_start_share` era rimasta su `season_play` — la sola stagione in
corso, due giornate — e `minutes.per_appearance` prende i minuti dalla prima coppia e la quota dalla
terza: **due campioni in un conto solo**, cioè l'errore di unità che la miscela era nata per curare. 267
righe su 602 in disaccordo col proprio `starts/matches`, 100 a 0,000 esatto, e nei DUE VERSI (chi le sue
due partite le aveva cominciate da titolare leggeva 1,000). Non solo un numero sulla card: i pavimenti
della scala della titolarità sono in MINUTI, quindi **94 righe attraversavano un gradino**.

**IL GIUDICE ABITUALE NON POTEVA VEDERLO, e sceglierlo lo stesso avrebbe prodotto due numeri identici da
leggere come una conferma.** `press --against press` giudica la board, e la board non legge quella colonna
(`eleven` usa `desc_season_starts` come spareggio). *Prima di scegliere un giudice, chiedersi cosa il
cambio può muovere* — la regola «prima di costruire un canale, chiedersi cosa il suo output può cambiare»
applicata alla propria verifica invece che a un candidato. Il giudice giusto era la quota stessa, fuori
campione: alla giornata k prevedere `starts/appearances` sulle giornate che RESTANO — MAE 0,2749 → 0,1873
a k = 2 (**+31,9%**), 6 stagioni su 6, 5 campionati su 5, positivo a ogni k e a ogni K. Inerte su una
pre-stagione, quindi nessuna finestra pubblicata dal gate si muove.

**E il malus chiesto è misurato e NON adottato.** Il meccanismo dell'operatore è vero ed è un fatto sugli
attaccanti (r = +0,424 fra cambio dei minuti e cambio del tasso bonus, contro +0,177 C · +0,113 D · −0,063
P), ma la fantamedia lo legge già: la correlazione grezza +0,322 degli attaccanti diventa **+0,082** a
parità di fantamedia precedente, e zero per gli altri tre ruoli — **+0,04 a giornata**, contro un buco che
ne costa 4,7. Più una circolarità che chiude la questione: `desc_minutes_next` non è uno sguardo
indipendente sul futuro, è per il 30% un modello il cui denominatore è `engine_pv_pred`. *Un canale che la
colonna che vorresti correggere contiene già non è un canale: è lo stesso fatto contato due volte.*

## Un CONTEGGIO non è una misura del disegno, e due disegni opposti ci stanno dentro uguali
**05/09/2026, da «crea una favicon adeguata». Dettaglio: `letture-app-v1.md` §28.** A 16 pixel l'icona non
era un pallone, era una **stella a cinque punte**: cuciture radiali dai vertici del pentagono, e
l'antialiasing allarga un tratto da 0,77 px in due pixel grigi che si saldano al vertice. Il commento del
file dichiarava di aver già corretto quella figura — «a sedici pixel sbiadisce» — e **non sbiadisce**: il
difetto è sopravvissuto alla propria correzione per tre settimane perché la cura è stata ragionata e mai
riguardata alla misura che conta.

**Il controllo automatico diceva «nessun problema», e continua a dirlo con lo stesso numero.** Misurava
l'AREA (142 pixel di tinta, 38 di sagoma a 16px); sostituita la geometria, l'area legge **gli stessi 142 e
38** perché il pentagono più grande compensa le cuciture più corte. *Un'area non ha una forma.* È «righe
identiche non sono un risultato» da un lato nuovo: qui erano vere, e non dicevano niente. L'invariante che
separa i due casi è la CONNESSIONE — in una stella le cuciture toccano il centro e la sagoma è UNA
macchia, in un pallone sono staccate — ed è ora asserita. **Quando un controllo può riportare solo un
totale, chiedersi quale disegno sbagliato darebbe lo stesso totale, e asserire la differenza.**

Due corollari pagati la stessa ora: la cura giusta non era un'altra taratura della stessa forma ma
**togliere alla forma la possibilità di sbagliare** (archi tangenziali, che non hanno un capo che punta in
fuori); e **un asset generato si verifica nel mezzo che lo consuma** — l'SVG, che è quello che i browser
disegnano, è stato aperto in un Chrome vero solo dopo la riscrittura, e un `fill` dimenticato su un arco
riempie la corda senza che nessun test del rasterizzatore possa vederlo.

## Il divisore dei decimali di questa app e' il PUNTO
**Operatore, 05/09/2026: «il divisore dei decimali deve essere sempre il punto "."».** Deciso dopo che il
banco della Strategia aveva trovato la contraddizione confrontando due schermate: la lista scriveva `0.45`
(`formatNumber` sul locale di default) e la card `0,45` (dieci `.replace('.', ',')` sparsi fra `core/` e
`ui/`). Le PAROLE dell'interfaccia restano italiane - quella convenzione non cambia - la cifra no.

Tolto ovunque si formatti un numero da mostrare: i voti e i fantavoti delle righe di partita, il
riepilogo della card, gli attesi, le etichette dei filtri, la scala del mercato («4.5 M»), i buchi delle
buste, e le percentuali dentro le frasi misurate degli screen (`player-place`, `player-screens`). Chi
LEGGE quello che l'operatore scrive resta tollerante (`player-filter` accetta ancora `6,5` digitato a
mano): una regola sull'output non e' una regola sull'input.

**E la guardia sta a SCHERMO e non nel codice**, perche' una regola sul separatore si rompe la prossima
volta che qualcuno scrive `.replace('.', ',')` e allora deve fallire dove si vede: due banchi (card e
Strategia) contano le celle che portano una virgola fra due cifre con al piu' due decimali dietro —
`1,000` sarebbe un separatore di MIGLIAIA e non e' questa regola.

## Due fonti per un fatto solo non convivono su uno schermo, e l'accordo si misura ALLA PRECISIONE CHE SI STAMPA
**05/09/2026, dalle richieste dell'operatore su xG e xA. Dettaglio: `letture-app-v1.md` §29,
`pagina-strategia-v1.md` §16, `metrica-asta-surplus-v1.md` §28.** Gli attesi servivano in due posti — il
riepilogo di stagione della CARD e due pastiglie nuove della STRATEGIA — e c'erano due strade: l'aggregato
di stagione del provider (`external_stats`, 310 KB) o la somma delle sue partite (`external_match_stats`,
2,1 MB, che è quello che la card somma già). Sembravano la stessa cosa: stesso conteggio di partite su
**1.096 righe su 1.096** e scarto medio 0,003 sul totale di stagione. **A due decimali il 19,7% degli
uomini leggeva due cifre diverse, fino a 0,21** — stesso provider, stessa competizione, stesso numero di
partite: la pagina di STAGIONE e quella della PARTITA servono due xG diversi. L'aggregato è uscito dal
pacchetto e dal codice, e la pastiglia chiama la stessa funzione della card. *Una media più economica che
non coincide con quella che già stampi non è un'ottimizzazione: è un secondo parere sullo stesso uomo, e i
due pareri stanno sullo stesso schermo.* Il prezzo (2,1 MB) lo paga solo chi accende le pastiglie: sono
spente all'apertura e lo store si chiede al primo click.

**E la lezione sull'ESPERIMENTO è della stessa famiglia: il null e i candidati devono leggere la stessa
tabella.** La prima misura di «quale finestra di xG prevede il resto della stagione» dava alle due
giornate correnti **+0,6%** contro il **+25,7%** della stagione scorsa, con un null che era la media DI
RUOLO e candidati senza nessun termine di ruolo: il braccio doveva riprodurre col suo unico numero anche
il gradino fra un difensore e un attaccante. Col ruolo dentro ogni braccio sono **+13,5%** contro
+28,0%, e la miscela +30,4%. La risposta alla domanda non cambia — vince la stagione scorsa, e le ultime
dieci perdono perché sono CORTE (il guadagno cresce in modo monotono fino a 40 partite: nessun premio
alla recenza) — ma il numero pubblicato sì.

**Sesta istanza di «il dato c'era»** dopo i campetti, `availability`, l'asterisco, la data di rientro e le
partite di Varela: `xg` e `xa` sono in `external_match_stats` da sempre e viaggiano nel bundle; mancava un
lettore. **E la convenzione sui vuoti si deriva dai dati** (`players-store.expectedScope`): dentro un
(stagione, competizione) in cui la fonte ha pubblicato almeno un atteso, una cella vuota è uno ZERO — fuori
è un ignoto. Fino al 2021-22 la fonte non li emette affatto, e infatti lì ci sono righe con un GOL e nessun
xG. Prezzo misurato: 0 righe con un gol e nessun xG, 2 su 78.626 con un assist e nessun xA.

Tre abitudini d'arnese pagate nella stessa sessione, e valgono per ogni banco.
- **Un banco serve `dist/`, quindi una corsa dopo un build fallito misura il BUILD.** Per venti minuti la
  Strategia ha letto «la pagina scorre di 14.750px, liste che scorrono 0» — un layout collassato — su un
  `dist/` a metà; ricostruito, 907px e 3 liste, senza toccare una riga. *Prima di inseguire un difetto di
  layout, ricostruisci.*
- **`scrollIntoView` porta con sé ogni antenato scorrevole.** Usato per portare una riga sotto gli occhi,
  ha fatto scorrere il documento e quattro passi dopo hanno letto «la pastiglia è coperta». La cura di un
  difetto dell'arnese non deve produrne uno più grosso: si tocca il solo contenitore che deve scorrere.
- **Un tooltip lungo copre il controllo accanto** (buste chiuse, 25/08) — ricomparso sulle pastiglie: il
  secondo click finiva sul pannello aperto dal primo, e il passo lasciava ACCESA una lettura facendo
  fallire due passi più in là che misuravano tutt'altro. La forma che regge preme, sposta il puntatore e
  poi **verifica che il click abbia morso**: un click che non cambia niente è indistinguibile da un
  bottone che non c'è.

## Spiegare un numero è LEGGERLO, e il modo di leggerlo è RIESEGUIRE
**05/09/2026, dalla richiesta dell'operatore «non sono ancora contento del surplus assegnato ad ogni
calciatore ... preparami una nuova pagina dove ... mi espliciti i fattori che poi portano al valore di
surplus/match». Dettaglio: `letture-app-v1.md` §30, spec «Novità v9.76».** La pagina è `/why`; quello
che vale oltre la pagina è come si è deciso di produrre la spiegazione.

**UNA SPIEGAZIONE RICALCOLATA È LA SPIEGAZIONE DI UN ALTRO NUMERO.** Rifare il conto nell'app sarebbe
stato il difetto che questo progetto paga da sempre visto da un lato nuovo — due letture dello stesso
foglio danno a un uomo due valutazioni — con l'aggravante che nessuno se ne accorgerebbe: una catena
plausibile che finisce a 58 accanto a una colonna che dice 61,7 si legge come un arrotondamento. Quindi
la scala che spiega le due colonne del motore la scrive il TOOLKIT, e la scrive **rieseguendo**:
`evaluate.explain_window` chiama la stessa `predict_window` sui PREFISSI dell'insieme adottato, quindi
l'ultimo gradino È la colonna `engine_*` accanto, per costruzione. L'alternativa — strumentare i trenta
rami di `_rule_fm`/`_rule_pv` perché ognuno registri quello che cambia — era una SECONDA descrizione
dell'aritmetica dentro un file gatato, cioè la cosa che può divergere. *Quando serve raccontare come un
numero è nato, il racconto più sicuro è farlo rinascere.* `backtest --verify` 22/22, `engine_*` fermo.

**E UNA DECOMPOSIZIONE DI PERCORSO SI DICHIARA TALE.** Il contributo di una regola è quello che aggiunge
alle PRECEDENTI, nell'ordine di `ADOPTED`, e le regole non sono indipendenti (`_rule_pv` sceglie un solo
ramo per priorità): «R3 vale +3,7 presenze per lui» è vero, «R3 conta più di R19» no. Sta scritto sulla
pagina, perché è la lettura sbagliata che chiunque farebbe.

Tre cose più piccole, e due sono errori di misura fatti qui.
- **IL CONTROLLO È PARTE DELLA SPIEGAZIONE, e sta in barra.** `(FM − rimpiazzo) × Pa × confidenza` deve
  riprodurre `engine_surplus`: la pagina lo rifà su ogni riga e DICHIARA quante non tornano, con lo zero
  scritto perché un uno si veda. La tolleranza è 0,15 e la ragione è aritmetica, non prudenza — il foglio
  arrotonda a tre, uno e uno decimali, quindi rifare la moltiplicazione dai numeri arrotondati NON può
  dare la stessa cifra.
- **UN CONTEGGIO VERO SULLA DOMANDA SBAGLIATA**, terza istanza dopo l'area della favicon: la barra
  leggeva «600 con la scala delle regole» e le scale sono 386, perché contava chi ha le COLONNE mentre il
  foglio le porta per tutti e le riempie per chi il motore riesce a prevedere. Nessuno dei due numeri è
  falso. L'ha trovato il banco perché confronta la barra col FOGLIO e non con se stessa.
- **E LA POPOLAZIONE PIÙ LARGA, per la ragione opposta a quella delle altre pagine.** Le liste da
  comprare tagliano chi il listone non quota (sua regola del 04/09); una pagina DIAGNOSTICA sul motore no
  — un uomo che il motore prezza deve poter essere letto anche se nessuno lo vende — e chi non è quotato
  porta il marchio, con un filtro che lo toglie in un click. *Il taglio giusto dipende dalla domanda che
  la lista risponde, non dalla lista.*

**Il primo fatto che la pagina rende visibile è sul MOTORE e non su un calciatore**: su Serie A la scala
della fantamedia è PIATTA su ogni riga (tutte le regole adottate là lavorano sulle presenze), mentre su
EuroLeghe R18 la muove su 381 righe di 997. Detto altrimenti: su `default` la fantamedia attesa di un uomo
è la sua stagione scorsa regredita verso l'ancora del ruolo, e tutto il resto del motore decide quante
volte la incasserà. Non è un difetto ed è esattamente il genere di dinamica che la richiesta chiedeva di
mettere sotto gli occhi.

## Un DERIVATO non e' di chi scrive la riga, e una replica offline che nessuno chiama e' una cache che non esiste
**06/09/2026, da «fai una code-review su tutto il progetto e sistema eventuali fix o ottimizzazioni».**
Quattro difetti, tutti nel percorso di SCRITTURA e nessuno visibile da una suite verde: 689 test del
toolkit, 736 dell'app e un build pulito mentre tutt'e quattro erano rotti - perche' sono difetti di
ORDINE FRA MODULI, e un test per modulo non li puo' vedere. Dettaglio: `stato-progetto-continuita-v5.md`
(6 settembre) e `todolist-mantra-euroleghe-v5.md`.

- **`INSERT OR REPLACE` cancella la riga e ne scrive una nuova, quindi ogni colonna che l'istruzione non
  nomina torna NULL.** E' la cura del 05/09 (`positions._store_match_rows`) ritrovata un modulo piu' in
  la', e non l'ha trovata una rilettura: l'ha trovata un audit MECCANICO - le colonne dello schema meno
  quelle nominate, per ognuno degli `INSERT OR REPLACE` del toolkit. **Otto siti, due veri** - e il
  «quattordici» pubblicato col commit e' un numero MIO da ritirare: la prima passata spezzava le
  istruzioni SQL scritte su piu' literal Python adiacenti (`"...coach,"` + `" module, ..."`) e leggeva
  come mancanti sei colonne che erano li'. Rimisurata con un parser che le incolla, i colpevoli sono gli
  stessi due e gli innocenti sono sei invece di dodici: *prima di pubblicare un conteggio, chiedersi se
  non sia il numero del proprio arnese* - la stessa regola del massimo che era la soglia di uno script,
  incontrata su uno strumento scritto un'ora prima. `recent_form.store`
  si portava via `mv_synth` e, peggio, i quattro BONUS che quel modulo paga **una richiesta a partita**
  da un secondo endpoint; `stats` si portava via `clean_sheets`, che scrive `derive_clean_sheets` dal
  layer per partita - **509 stagioni di portieri euro** azzerate da un `stats` lanciato da solo, e
  nessuno se ne accorgeva perche' `rebuild` e `update` richiamano la derivazione subito dopo. Gli altri
  dodici siti sono legittimi e la stessa passata lo dice: *un audit che stampa solo i colpevoli non si
  distingue da uno che non ha guardato.* **La regola: una colonna DERIVATA non appartiene a chi scrive
  la riga, quindi un upsert la deve DICHIARARE** - conservarla, e ritirarla quando l'input da cui viene
  si muove (`mv_synth` sopravvive finche' il `rating` e' lo stesso, perche' un derivato stantio e'
  peggio di uno vuoto).
- **UNA REPLICA OFFLINE CHE NESSUNO CHIAMA E' UNA CACHE CHE NON ESISTE.**
  `recent_form.reingest_from_cache` era scritta, testata, e il suo docstring diceva perche' la cache c'e'
  - e `rebuild` non la invocava: un rebuild lasciava a ZERO tutte le **1.731 partite** di
  `sofascore_recent`, cioe' il calcio giocato altrove da chi qui non ha storia, ore di richieste polite
  che solo una nuova acquisizione poteva riportare. «Il DB e' sempre ricostruibile da zero» e' un
  invariante, e *un invariante senza un test e' un'intenzione*: ora la riga c'e' e un test la pretende.
  Con lei un `--from-cache` sul comando, perche' una replica raggiungibile solo da dentro `rebuild` non
  si puo' ne' verificare ne' usare per rimettere in piedi uno strato solo.
- **E LA META' DI UN MODULO CHE PAGA VA SCRITTA DOVE STA L'ARCHIVIO, non solo dove sta la domanda.**
  `backfill_bonuses` scriveva i suoi gol nel DB e mai nella cache, quindi la regola valeva per la fetch e
  cadeva per l'arricchimento: misurato, **1.086 delle 1.731 partite** portavano nel DB bonus che il disco
  non aveva, e un rebuild li avrebbe rimessi in vendita uno per uno. La scrittura sta in un `finally`
  accanto al commit, perche' il docstring promette che un'interruzione conserva quello che ha gia' preso
  - e una cache aggiornata solo sul percorso felice lascia da ricomprare proprio le richieste del
  giocatore interrotto.
- **E UN'IGNORE E' LA RETE, NON LA CURA: `export` ora rifiuta di scrivere dentro il repository.**
  La domanda aperta dal 25/08/2026 («cosa resta da trovare e' come `export` sia arrivato a scrivere
  fuori dalla propria cartella») non si chiude trovando chi ha digitato cosa: si chiude rendendolo
  impossibile. `--out` accettava qualunque directory e nessuno la guardava; adesso una destinazione
  DENTRO il repo e FUORI da `data/` e' un errore che nomina la ragione (il repo e' pubblico, il
  pacchetto porta contenuto a pagamento), mentre una chiavetta o una cartella temporanea restano
  legittime - vietare anche quelle farebbe solo spostare il file a mano dopo, che e' peggio. Su
  `data_dir` e non su un `data/` letterale, perche' `EUROLEGHE_DATA_DIR` e' proprio quello che sposta
  una seconda sessione, e una guardia che lo ignorasse rifiuterebbe l'unica cartella che protegge. I due
  file da zero byte (`bundle.sqlite` nella radice, `data/euroleghe.sqlite`) sono stati tolti: erano
  vuoti, quindi non e' mai uscito niente, ma il secondo era anche un DECOY accanto al database vero.

- **E un `some` dentro un `computed` e' una DIPENDENZA, non una lettura.** Nella Strategia `pool` - le
  seicento righe, con l'esito atteso, la costanza e il fantavalore di ognuna - leggeva l'ELENCO delle
  pastiglie accese per decidere se servisse il calcio giocato, quindi si rifaceva a ogni click su una
  QUALUNQUE delle undici, mentre il commento due righe piu' sotto dichiarava l'esatto contrario
  («ricostruire il listone a ogni click sarebbe pagare un giro di 600 righe per accendere una
  pastiglia»). Un `computed` si invalida sul VALORE che produce: passando da uno suo - «una stagione, o
  niente» - accendere `Bpm` non tocca piu' niente e accendere `xG` rifa' la lista una volta sola.
  *Quando un commento dichiara un costo che il codice accanto paga lo stesso, il commento e' la
  segnalazione.*

## Un PRONOSTICO si giudica sulla finestra che prevede, e meta' della richiesta era gia' costruita
**06/09/2026, dalla richiesta dell'operatore: «lo scopo del SURPLUS e' di dare un indice di valore del
calciatore PRONOSTICANDO come andra' la sua stagione ... uno step fondamentale e' capire quanto questo
pronostico si avvicina alla realta'». Dettaglio: `letture-app-v1.md` §31, spec «Novita' v9.77».**

**«Applicare l'algoritmo con i dati presi alla terza giornata della scorsa stagione» ESISTEVA GIA'**:
e' `timepack` (16/08/2026), e **2025-09-05 e' una delle quattro date impacchettate** — al 5 settembre
2025 la Serie A aveva giocato 2 giornate e il foglio ne prevede 36. Quello che mancava non era il motore
di una data passata, era il **METRO**: nessuna colonna diceva cosa quei calciatori hanno poi fatto
davvero. *Prima di costruire si guarda cosa c'e'*, e per la settima volta la misura ha risparmiato piu'
codice di quanto ne abbia aggiunto — qui una pagina intera.

**L'ESITO SI MISURA SULLE GIORNATE CHE IL FOGLIO PREVEDE, mai sul totale di stagione.** `actual_rounds`,
`actual_pv`, `actual_mv`, `actual_fm`, `actual_value` (`SHEET_REVISION` 46) contano le giornate **dopo la
data d'asta**: al 5 settembre due erano gia' state giocate quando il motore ha parlato, quindi 38 giocate
contro 36 previste direbbe che tutti hanno reso piu' del previsto — un fatto sul calendario e non sui
calciatori. E' «l'unita' di una sottrazione e' parte della sottrazione» applicata al GIUDIZIO. La finestra
e' anche la STESSA che `features._split_target_season` usa per l'esito del gate, riletta dalle sue due
funzioni pubbliche invece di ritagliata una seconda volta.

**IL NUMERO, e concorda con tre misure che non avevano ragione di concordare.** Serie A classic, 5
settembre 2025, 36 giornate giudicate, 556 righe (361 col motore): presenze errore medio **6,87 giornate**
e scarto −0,24 (solo motore 6,56 e −1,00); fantamedia **0,317** e scarto +0,032 su chi ha giocato almeno
14 giornate, che e' la soglia del gate; fantapunti 42,7. Cioe' **quello che sbagliamo sono le PRESENZE e
non la fantamedia** — e la coda e' fatta di infortuni e partenze (Angelino 29,4 previste e 5 giocate,
Lukaku 21,8 e 2), mentre dall'altra parte c'e' chi il posto se l'e' preso (Palestra 16,5 e 36). La stessa cosa che
`Var(ln pv)` = 86-90% di `Var(ln` fantapunti`)` dice da un lato, che il vantaggio incrementale sulla
quotazione «largo un numero solo» dice da un altro, e che i +18,1 fantapunti di `bench.auction.advice`
dicono dal terzo. Qui si vede dal lato dell'ERRORE: e' la grandezza su cui c'e' ancora da guadagnare.

**E NON E' UN VERDETTO SUL MOTORE, che e' la meta' da dire per prima**: il gate giudica una regola su
dieci finestre con un criterio scritto prima della corsa; questa e' una fotografia di UNA data su UNA
lega, e per giunta di una stagione che ha tarato quei parametri — il foglio lo dichiara da se' («this run
is a DRY RUN, not an out-of-sample statement»). Serve a leggere le righe, non a promuovere niente.

**LA DIREZIONE DI UNA CONTAMINAZIONE E' PARTE DEL RISULTATO.** Un foglio back-dated conosce cose che quel
giorno non si sapevano (rose, trasferimenti, ruoli granulari, l'asterisco del listone): sul foglio del 5
settembre 2025 l'asterisco toglie **131 righe**, e misurato **nessuna di loro ha poi giocato 25 giornate**
(Lookman 11, Castellanos 11, Lucca 9). La lista e' ripulita proprio dei casi peggiori, quindi l'errore
misurato e' **ottimistico** — e va scritto accanto al numero, non lasciato scoprire. Stessa famiglia di
«la direzione di un errore e' parte dell'errore» (§17 del simulatore, dove sbagliava a sfavore del
braccio giudicato).

**Un secondo COMANDO non e' un secondo stato**: la tendina delle date in cima a `/why` inietta
`TimeTravel`, non ne fa una copia, e l'etichetta di una data e' una funzione sola letta dal box e dalla
pagina. Due etichette per la stessa data sarebbero due nomi per un pacchetto solo. Il banco ha dovuto
imparare a scegliere la tendina giusta — con due `nz-select` sulla pagina, `querySelector` prende la
prima, e il passo del filtro squadre avrebbe accusato il filtro di non offrire nessun club.

## Il NOME, la VERSIONE e la GRAFIA sono la stessa famiglia, e TRE sessioni la incontrano tutte in un pomeriggio
**06/09/2026, dalla domanda dell'operatore «verifica se nell'algoritmo abbiamo tenuto conto di questi
eventi» (ventisei voci). Dettaglio: `copertura-eventi-motore-v1.md`, §9 e §10.** La risposta è una mappa
nuova — per ogni evento, se il motore lo legge, se lo legge il PANNELLO, o se è stato misurato e respinto
col suo numero — e la parte che vale oltre la mappa è come si è sbagliato per arrivarci.

**«Verifica la FUNZIONE, non la colonna che le somiglia» ha tre facce, e in una sessione sono uscite
tutte e tre.** Fra due sessioni ci sono state sei correzioni, nessuna risolta discutendo:
- **il NOME** — un grep sul CAMPO (`.rounds`) mentre il lettore usa l'ACCESSORE (`rounds_for`): la
  conclusione «il motore non legge quel campo» era falsa (`evaluate.py:667`, dentro `derive()`), e il
  docstring della funzione lo diceva due righe sopra. *La lista dei lettori si prende con un grep che
  include il motore, e un lettore nominato in un docstring entra in lista prima di ogni ragionamento.*
- **la VERSIONE** — l'albero di lavoro letto per rispondere a una domanda sul PASSATO: «il fallback
  dichiarato dava già 34» era vero DOPO il commit che quel fallback lo introduce, e prima il default era
  38 cablato. *Per «com'era prima» si legge `git show <sha>:<file>`.*
- **la GRAFIA** — quinta istanza del join per nome, e la più economica da prevenire: fra
  `club_match_lineups.club` (grafia del provider) e `match_ratings.team` (grafia dei voti) **26 su 35** si
  appaiano, e le perse sono **Milan, Roma e Napoli** più sei. *Quando due tabelle nominano un club con due
  colonne dal nome DIVERSO, la prima cosa da cercare è il risolutore e non la corrispondenza*: due nomi
  diversi fanno sentire che si stanno unendo due cose invece di due grafie della stessa cosa, ed è così
  che il commento «NOT canonical» nello schema non viene letto. Quello che sopravvive a un join così è
  esattamente ciò che questo file già prevedeva: l'aggregato regge (r −0,040 → −0,045), le celle per
  gruppo si muovono e una **cambia segno**.

**E un'INERZIA si dichiara con le condizioni che la reggono.** «Questo commit non muove il gate» era vero
e la ragione data era falsa: `league_rounds` È nel percorso del gate, e lo zero poggia su due fatti che
possono cambiare tutt'e due — R3 è l'unica adottata che legge quella quantità ed è solo su `default`, e il
listone `default` è monolingua (2018-19: 641 righe, tutte `serie_a`). Scritto come «lo zero è
strutturale», il prossimo si sente autorizzato a toccare quella funzione senza gate.

**TRE sessioni su un albero, e il coordinamento si fa sugli ARTEFATTI.** Due regole nuove, pagate:
`--verify` è in sola lettura sul DB e **non** su `data/reports/` — scrive `engine_backtest.json` come il
gate salvo `--no-report` — e `backtest` lascia comunque la sua riga in `ingest_runs`, che è come una corsa
logicamente innocua fa risultare il DB «toccato». La regola è **non condividere l'ARTEFATTO**, con due
implementazioni: `--no-report` quando non serve conservarlo, una data-dir privata quando l'artefatto È la
misura. E l'attribuzione di una corsa si legge nel CONTENUTO dell'artefatto (`generated_at`, la presenza
della chiave `gate`), mai dal suo mtime né dalle righe di `ingest_runs`.

**Infine la regola sulle liste di «cose promettenti»: si misurano prima di consegnarle.** I tre buchi che
questa mappa proponeva sono durati mezza giornata — il modulo sui difensori ha il **segno rovesciato**
(guadagnare un posto nella propria linea si accompagna a giocare 0,06 di quota MENO del null, perché il
posto in più lo riempie l'ARRIVO: è «posti meno pretendenti», la famiglia R11…R17 respinta cinque volte),
le squalifiche valgono **≤14%** dell'errore sulle presenze, e i rigori per club **non sono
un'acquisizione** — il dato è in `match_ratings` (~6,5 per club-stagione) e si prevede male (persistenza
+0,291 su 187 coppie). Quest'ultima è la **sesta istanza** di «il dato c'era e nessuno lo leggeva», ed è la
prima commessa **citando un documento invece di interrogare la tabella**.

## Un canale si giudica contro il SET ADOTTATO, e tre rifiuti hanno tre forme diverse
**06/09/2026, dalla richiesta dell'operatore «dobbiamo trovare un modo per migliorare quante partite
giocherà un calciatore». Dettaglio: gate §7-quinquadragies (R24), §7-sexquadragies, §7-septquadragies,
§7-octoquadragies.** La diagnosi che l'ha aperta: la fantamedia la sappiamo (MAE **0,289** su una
dispersione di 0,539), le presenze no (**6,56** giornate su 36) — e regalando al motore le presenze vere
l'errore di stagione crolla da 39,9 a **6,9** fantapunti, mentre regalandogli la fantamedia resta 37,2.
Quarta strada indipendente allo stesso posto dopo `Var(ln pv)`, il vantaggio incrementale sulla
quotazione e i +18,1 di `bench.auction.advice`.

**R24 — «una PARTENZA da titolare non è una presenza» — PRE-REGISTRATA E RESPINTA.** `pv_seen` mette
nello stesso numero il titolare e chi entra dalla panchina e prende il voto; la distinta non è nei voti e
arriva dal livello per-partita. La diagnostica pre-corsa era forte (a parità di presenze viste, la quota
di PARTENZE correla **+0,198** col resto della stagione, **13 finestre su 13**) e il gate l'ha respinta:
contro R20, `default` **+0,35%** (6/14, sotto il pavimento) ed `euro` **+0,81%** (5/10, non maggioranza,
peggiore −2,11% fuori tolleranza). Le quattro chiavi restano DICHIARATE e fuori da `ADOPTED`.

**E IL SURROGATO AVEVA DATO IL SEGNO OPPOSTO, che è la lezione che è costata la giornata.** Provata fuori
dal motore con un prior grezzo al posto del set adottato, la forma leggeva +0,66% a settembre (6/6) e
negativa a febbraio; il gate vero legge −0,13% a settembre e +0,84% a febbraio. **Il surrogato non
misurava il valore dello sconto: misurava l'ASSENZA del set adottato** — a settembre «è un subentrante e
non un titolare» il motore lo sa già da R3 (i minuti) e R19 (il livello), quindi lo sconto ricontava un
fatto contato. Da cui la regola, e vale per ogni banco fuori dal gate: **un baseline più debole fa
sembrare un canale nuovo MIGLIORE di quanto sia, quindi il verso del bias si dichiara PRIMA della corsa,
non dopo.** E il corollario opposto: un segnale **piccolo ma ortogonale** vale più di uno grande e già
contenuto — è la differenza fra R24 (+0,198 di parziale, ridondante) e le squalifiche (−0,068,
ortogonale ai minuti a **−0,004**).

**IL BASELINE È FITTATO SU UN ESITO CHE IL FATTO LO CONTIENE GIÀ, quindi si paga solo il DIFFERENZIALE.**
Le squalifiche l'hanno dimostrato dal lato peggiore: il termine lineare sulla propensione al cartellino
vale +0,17%, la forma di R21 — sottrarre le giornate attese dal regolamento, che sulla carta è la forma
giusta — vale **−1,58%, 0 finestre su 11**, perché il modello impara «questo profilo gioca 24 giornate» e
quel 24 è già al netto delle sue squalifiche: le 0,84 sottratte sono contate due volte. Stessa famiglia
dell'età («il modello sconta già i trentenni prima di qualunque termine d'età») e di R14. I rigori dicono
la stessa cosa dal lato buono: i +3 di chi li tirava sono già dentro la sua fantamedia precedente, quindi
il canale esiste **solo sui cambi di stato** (chi smette −0,546, chi comincia **+0,661**).

**E UN EFFETTO GRANDE CON UNA MIRA PEGGIORE DEL NIENTE È UN CANALE CHE NON ESISTE.** I rigori sono il caso
puro: mezzo punto di fantamedia su ~6 uomini a stagione, che è la forma che il gate premia — pochi uomini
spostati di molto — e al 5 agosto la domanda «chi li tirerà» ha due risposte, il taker della stagione
scorsa (**40%**) e il rank 1 di `penalty_hierarchy` (**15%**). La gerarchia è peggiore del banale, e il
banale **è ciò che il modello assume già**. Serve uno strumento che batta il 40%, non un parametro.

**Tre rifiuti, tre forme diverse, e vale la pena tenerle distinte** perché si riconoscono in fretta: il
modulo/posti della linea non ha il MECCANISMO (il segno è al contrario); le squalifiche ce l'hanno troppo
PICCOLO (≤14% dell'errore nel caso perfetto); i rigori ce l'hanno grande ma senza MIRA. Costo dei tre
messi insieme: circa un'ora di SELECT contro tre implementazioni con pre-registrazione e gate. **Una lista
di cose promettenti si misura prima di aprirla, e la diagnostica pre-corsa si fa contro il set adottato o
non è una diagnostica.**

## Uno SLUG non è un'identità, e una cache che archivia un'etichetta DERIVATA non si può rigiocare
**06/09/2026, dal pacchetto pre-registrato in `gate-motore-v1.md` §7-quattuorquadragies (esito nella stessa
sezione), spec «Novità v9.78-79».** Nato da una voce di todolist che chiedeva perché **44 righe su 1.731**
dello strato `recent_form` avessero un voto sintetico: né un ri-salvataggio né la regola di calibrazione —
`recent_form` si era riscritto la denominazione delle competizioni invece di chiamare `positions._slug_of`,
che esiste dal 08/08 e decide per **ID DI TORNEO**. Così le partite di Premier di un uomo a un club fuori
perimetro erano archiviate come `premier-league` mentre `calibrated_competitions` chiede
`matchday_map.league`: `bundesliga` era l'unica grafia che coincideva **per caso**, e infatti l'unica che
convertiva. **352 righe e 45 giocatori** rifiutati per un trattino, 17 dei quali arrivi del listone in uso.
QUINTA istanza della regola più vecchia del progetto.

**E LA PRIMA CURA ERA SBAGLIATA IN UN MODO CHE SOLO IL DATO POTEVA MOSTRARE.** Il provider chiama
`bundesliga` **anche il campionato austriaco**: mappare per slug portava 36 partite di Red Bull Salzburg e
Austria Klagenfurt sotto la nostra chiave tedesca, dove `synth` le converte con una retta fittata sulla
Bundesliga — e quattro di quegli uomini sono ARRIVI il cui FM-equivalente ne era costruito (Pavlovic 6,86 ·
Sucic L. 8,30 · Irving 8,29 · **Alajbegovic 6,93**, sul listone 2026-27). *Una cache che archivia
l'etichetta DERIVATA invece dell'identità della fonte non si può rigiocare in modo esatto*: quella cache
tiene la voce già interpretata, l'ID non c'è più, e la rigiocata offline che la todolist chiedeva ha
propagato un'ambiguità che era già su disco. La forma adottata decide per ID alla FONTE e ripara l'ARCHIVIO
col **PAESE del club**, solo come evidenza CONTRARIA — un club senza paese non è un argomento contro la
grafia, che è ciò che tiene in piedi la normalizzazione di `serie-b`. Effetto: voto sintetico **44 → 396**,
36 austriache fuori, arrivi 28 riempiti / 8 tolti / 42 rivisti / 29 tier, e **0 differenze su 50.284 numeri
del gate** — perché l'unico lettore di `foreign_fm_equiv` in `evaluate` è R1, che non è adottata da nessuna
parte. Il valore cade sui FOGLI (`SHEET_REVISION` 47), non sull'engine.

**UN CALENDARIO LO CONTA IL LIVELLO CHE CAMMINA LE GIORNATE**, ed era il difetto che la rinomina avrebbe
reso letale: `features.league_rounds` prendeva `MAX(real_md)` da qualunque riga, quindi una manciata delle
ultime partite di un giocatore *era* il calendario — `bundesliga 2016-17` leggeva **33** giornate invece di
34, e con la rinomina `premier_league 2018-19` avrebbe letto **UNO**, con 248 osservazioni che dividono per
quel numero. Ora filtra la sorgente e dove non arriva il numero è **dichiarato** (34/38), perché quel
dizionario fa anche da filtro di ammissibilità e un buco lì spegne una riga invece di curarla.
**E «inerte» è una frase su una POPOLAZIONE**: «0 differenze su 6.168 numeri» valeva le 40 celle
pre-stagione e non le 14 finestre in-season, che quel rapporto non tocca. Lo zero vale anche là, ma per una
ragione **condizionale al set adottato** (R3 è l'unica adottata che legge quella quantità ed è solo su
`default`, dove il listone è monolingua) — e smette di valere il giorno in cui `ADOPTED` cambia.

## TRE sessioni su un albero, e una BASE DI CONFRONTO scade fra due corse dello stesso comando
**06/09/2026, ed è la prima volta con tre.** La regola del 27/08 («verifica in un WORKTREE su HEAD più i
tuoi file») è nata per una build e vale identica per una MISURA, che è come l'ho scoperta: il campo
`starts_seen` di un'altra sessione è comparso nell'inventario delle feature **fra la mia prima e la mia
seconda corsa** di `backtest --verify` (6.168 → 6.248 numeri), e per mezz'ora ho attribuito a me stesso una
differenza che era loro. *Righe identiche non sono un risultato e una base non è una costante: si rifà la
base nel worktree, non si spiega il diff.*

Cinque abitudini che ne sono uscite, tutte pagate.
- **Si committa la propria metà di un file condiviso mettendo in INDEX il blob del worktree su HEAD**
  (`git hash-object -w --path <file>` + `git update-index --cacheinfo`): l'albero di lavoro tiene tutt'e due
  le metà, il commit solo la propria, e la prova è un `git diff --cached | grep` sul vocabolario dell'altro.
  Fatto due volte in un pomeriggio, zero righe altrui in entrambi i commit.
- **NON CONDIVIDERE L'ARTEFATTO, con due implementazioni**: `--no-report` quando non serve conservarlo, una
  data-dir privata quando l'artefatto **È** la misura (6.168 numeri da diffare). E `--verify` è in sola
  lettura sul DB e **non** su `data/reports/`; `backtest` lascia comunque la sua riga in `ingest_runs`, ed è
  così che una corsa logicamente innocua fa risultare il DB toccato — attribuirla si fa con quel log e non
  col mtime.
- **Per un esperimento di SCRITTURA, la copia privata del DB** (513 MB in mezzo secondo): il vivo lo si
  tocca dopo il verdetto e col via libera di chi lo sta usando. Una sessione possiede il DB, e se non si sa
  chi sia, non sei tu.
- **Le correzioni fra sessioni si verificano come qualunque altra cosa.** Di quattro arrivate: due mi hanno
  spostato numeri, **una era falsa** (il mio `--verify` non aveva sovrascritto il lavoro di nessuno: quel
  rapporto non ha nemmeno la chiave `gate`) e una l'ho corretta io — «`evaluate` non legge `.rounds`» è
  sbagliata, lo legge attraverso l'ACCESSORE, e *una ragione sbagliata dentro un verdetto giusto è più
  pericolosa dello zero che spiega*, perché è quella che il prossimo lettore riusa.
- **E una tabella stantia confrontata con una fresca attribuisce al candidato il lavoro del tempo**:
  `arrivals` non era ri-derivata dal 7 agosto, quindi la prima misura dava alla rinomina 70 FM-equivalenti e
  21 tier (e +2 righe che nessuna rinomina può creare). Coi due bracci ri-derivati entrambi sono 28 e 29.

## «Chi è meglio» e «quanto offrire» sono DUE graduatorie, e un termine giusto per una è sbagliato per l'altra
**06/09/2026, `app/src/app/core/swing.ts`, dettaglio in `letture-app-v1.md` §32.** Dalla domanda
dell'operatore «esiste un valore che mi dica subito, fra due calciatori, quale mi farà vincere più
partite?». Ne è nato **SWING** — il nome è suo, e in codice e a schermo è lo stesso — e quattro termini
misurati: la conversione in gol (adottata), la copertura e la convessità (respinte), la costanza
(adottata su evidenza dichiaratamente debole).

**LA REGOLA PIÙ GROSSA È IL RIFIUTO DELLA COPERTURA.** La prima versione sommava `surplus + copertura`
come fa `engine_worth` sul banco d'asta, dove quella somma ha portato il braccio motore da ultimo di
undici a PRIMO. Su una lista di nomi vale l'opposto: pesata da 0 a 1 su 200 campionati, **peso 0 rende
63,0 punti e il 78% dei titoli, peso 1 ne rende 35,8**, e il braccio con la copertura compra 0,25 buchi
in 36 giornate e le giornate sotto i 66 più alte del tavolo — la copertura la compra tutta e non la
converte in punti. *Sul banco la copertura prezza un'OFFERTA sotto un budget, dove un posto può restare
davvero vuoto; in una lista il posto vuoto non esiste, la rosa la riempi comunque, e pagare per la
presenza è pagare per qualcosa che avresti gratis.* La diagnosi ha una firma riconoscibile: la copertura
era l'**80-97%** del numero, perché `min(quota, deficit)` non morde mai (la quota è ≤ 1 e il deficit dei
difensori è 4) — cioè **due zeri diversi dentro una somma**, il surplus che sottrae chi giocherebbe al
posto suo e la copertura che assume che non giochi nessuno.

**E IL BUDGET RIBALTA CHI VINCE, quindi il banco senza budget risponde a un'altra domanda.** In un draft
LIBERO su dieci stagioni la QUOTAZIONE batte il surplus (21,4 punti e 40% dei titoli contro 20,2 e 32%);
con un budget di 250 crediti la stessa quotazione crolla **ultima all'1%**. Comprare per prezzo è gratis
solo quando i soldi non contano. Si compone con quello che il progetto sapeva già: dentro una fascia il
prezzo non vale niente (−1,0 contro un tiro di dado), fra fasce diverse è informazione vera.

**UN CANALE SI PAGA AL DIFFERENZIALE E NON AL TOTALE, e l'operatore l'ha indovinato dove io l'ho
sbagliato.** La sua formula per la costanza — `surplus + giornate sufficienti × k`, con **k = 2/11** dal
07/09 (prima 1/11), «la parte di bonus da R-Factor o Mod. Difesa attribuibile a un uomo, un valore
ragionevole ma non frutto di mille calcoli» — sta sotto il marginale ESATTO che l'aritmetica dà (0,298 di
fantamedia per unità di costanza, Poisson-binomiale sull'undici tipo). La ragione è la stessa delle
squalifiche: **il surplus contiene già una parte della costanza** — un uomo costante gioca di più e rende
di più — quindi il totale è il prezzo di una cosa comprata due volte. *Quando un canale ha un marginale
calcolabile, quel numero è il TETTO del peso e non il peso.* **I NUMERI che difendevano l'1/11 sono
RITIRATI il 07/09** (§32.10 di `letture-app-v1.md`): erano presi su un banco che premiava chi riempie la
rosa, e su quello curato la griglia è piatta con vicini di segno opposto (1/11 −0,11 · **2/11 −0,25** ·
6/11 +1,07 t 3,5 · 12/11 −0,55 t −2,2 · 96/11 +0,03). Il meccanismo sopravvive perché è aritmetica; il
peso resta il suo.

**E UN PESO DICHIARATO HA UNA QUANTITÀ SU CUI È INDICIZZATO, che va trovata e scritta** (07/09/2026, sua
correzione: «il k dovrebbe dipendere da quanti punti è impostato il mod.dif e r-factor — mettiamolo a
2/11»). Il numero non era sbagliato, gli mancava il denominatore: nella sua lega l'R-Factor vale al
massimo **2** punti, e due punti spalmati sugli undici uomini che li producono sono `2/11`. Quindi
**`STEADY_SHARE` è un parametro di LEGA e non una costante del gioco**, e chi ne gioca una con
modificatori di taglia diversa lo deve ridichiarare — non è ancora un'impostazione a schermo perché la
TAGLIA dei due modificatori non è fra quelle dichiarate (`LeagueRules` porta il mod. difesa come un
interruttore e non come una scala, e la scala dell'R-Factor vive solo in `bench/auction/rules.py`), e il
codice dice dove andrebbe aggiunta invece di lasciarlo scoprire. Due corollari: **il peso è una
dichiarazione, il TETTO è un conto** (`STEADY_MARGINAL` = 0,298, il marginale esatto sull'undici tipo:
oltre quello il termine prezzerebbe due volte una cosa che il surplus già contiene, e il test asserisce
la disuguaglianza invece di un numero magico); e il punto nuovo è stato **misurato e non interpolato**
fra i due vicini già corsi, perché su una superficie piatta i vicini non predicono niente.

**UN NULL SI SIEDE AL TAVOLO, e ha trovato due difetti che nessuna rilettura vedeva** (07/09/2026, dalla
richiesta «aumenta il k finché SWING(k) > SWING(k−1)»). La scala saliva fino a 96/11 con un **ottimo
interno** e `t` da 17 — tutto quello che il protocollo chiede — e misurava l'incompetenza degli
avversari: nella stessa tabella il braccio a **CASO** batteva surplus e quotazione, perché con 250 crediti
i bracci greedy compravano senza guardare il prezzo e finivano la rosa con uomini da un credito. A 96/11
il braccio giudicato comprava **sei attaccanti per 13 crediti**, che è una rosa che nessuno può giocare.
Curato dando a tutti la spartizione per reparto di un tavolo VERO (`profiles.MARKET`, dalle 131 aste
reali), il CASO va ultimo — *la validazione di una cura dell'ambiente è che il null torni a perdere* — e
il `k` sparisce. Il secondo difetto era dell'arnese e l'ha trovato lo stesso null: `bench` nomina i
partecipanti per INDICE nel calendario, quindi scambiando due bracci le partite restano le stesse ma
cambiano GIORNATA, e una giornata è un punteggio fisso: **0,4 punti regalati alla posizione 0**, sempre
quella del braccio giudicato. Due bracci con lo stesso criterio ora pareggiano a **+0,000 esatto**, ed è
il gemello di «righe identiche non sono un risultato» — qui erano righe DIVERSE da uno strumento
identico, e si riconosce allo stesso modo: mettendo lo stesso criterio su due sedie. *Un ottimo interno,
un `t` grande e la coerenza fra stagioni non proteggono da un banco che sta rispondendo a un'altra
domanda: le guardie procedurali proteggono dal fitting, non dall'ambiente.*

**UN'ADOZIONE SU EVIDENZA DEBOLE SI DICHIARA TALE, e la si RILEGGE quando il banco migliora.** Il termine
di costanza aveva perso su tre banchi e vinto su uno (quello col budget, 3 impostazioni su 4), e su quello
si reggeva l'adozione. Curato il tavolo (07/09) quella vittoria non c'è più: 1/11 legge **−0,11 (t −0,3),
3 finestre su 10** contro il surplus nudo, cioè **zero**, come tutti gli altri pesi provati. Resta
adottato perché è la formula dell'operatore, perché è piccolo per costruzione e perché nessuna misura lo
trova DANNOSO — non perché un banco lo promuova, e la clausola di R19 resta scritta accanto: **se la
prossima misura lo trova peggiore, esce senza discutere.** *Una lettura debole non si difende: si
ricontrolla appena lo strumento migliora, e si riscrive quello che diceva.*

E la SOGLIA che ne esce si usa anche senza la colonna: preferisci il costante se `Δfantamedia < 0,30 ×
Δcostanza` — dieci punti di costanza pareggiano 0,03 di fantamedia, con un tetto invalicabile di 0,50
(l'R-Factor vale mezzo punto per uomo). Ma il tasso **non è costante**, perché l'R-Factor è una soglia:
coi dieci compagni allo 0,50 di costanza un'unità vale 0,086, allo 0,68 (l'undici tipo) 0,298, allo 0,90
**0,494**. *Più la rosa è già solida, più il prossimo uomo costante vale.*

**LA CONVESSITÀ È IL CONTRO-ESEMPIO UTILE: un meccanismo vero che non arriva mai.** La troncatura a 66
rende la varianza un bene, e la varianza di un uomo **si legge dal suo tasso di bonus** (r **+0,92** sugli
attaccanti, +0,93 a centrocampo, +0,66/+0,76 in difesa; il portiere è l'eccezione perché il suo «bonus» è
il malus dei gol subiti). Il termine sposta **2 uomini su 474 di una posizione** — perché una giornata di
rosa vale **74,8 ± 7,0** e i 66 si superano nel 90% dei casi. *Tre costanti per ruolo che muovono due
righe non si spediscono.*

Quattro abitudini di misura, e tutte e quattro sono state pagate in questa sessione.
- **RIGHE IDENTICHE NON SONO UN RISULTATO** (terza istanza): quattro bracci che leggevano 4,00 punti a
  giornata e 11 buchi ciascuno erano un JOIN a zero — il foglio restituisce `fc_id` come **float**,
  quindi `str(2097.0)` non aggancia `"2097"`. *Prima di credere a uno zero si stampa la FORMA di ciò che
  si sta leggendo*: le chiavi di una riga, i valori distinti di una colonna.
- **DUECENTO CAMPIONATI POSSONO ESSERE QUATTRO ROSE.** Con criteri deterministici le repliche
  rimescolavano solo il calendario, quindi l'errore standard era finto e la griglia del peso frastagliata.
  La potenza vera viene dalle **24 permutazioni dell'ordine di scelta**; con quelle la griglia diventa
  monotona e l'ottimo interno si vede.
- **UNO SWEEP CHE NON CONTIENE IL VALORE GIUSTO NON PROVA NIENTE**: il primo rifiuto della costanza aveva
  spazzato pesi da 5 a 40 quando l'ottimo è 0,09 — da 17 a 130 volte troppo grandi — ed è stato ritirato.
- **E UN SELETTORE POSIZIONALE DENTRO UN'INTESTAZIONE** si rompe il giorno che qualcuno ci mette un
  controllo: `header span:nth-of-type(2)` ha cominciato a rispondere «Impostazioni lega» perché il
  selettore d'ordinamento ha aggiunto uno span, e il banco accusava la pagina del proprio difetto.

**Il selettore d'ordinamento della Strategia** nasce qui (`SortKey`, `blocksOf`): ogni blocco si ordina su
una qualunque delle dodici letture o sul gain. Ritira a metà la frase «l'ordine è SEMPRE il gain» del
27/08 — quella vietava un ordine che NESSUNO ha scelto e che la lista non dichiara, e un selettore è
l'opposto: una scelta esplicita, visibile e reversibile a ogni sguardo. Il taglio alla domanda viene DOPO
l'ordine, quindi cambiare chiave cambia anche chi resta in lista, e chi quel numero non ce l'ha va in
fondo e non in mezzo.

## Una META' di una coppia derivata non riceve una novita' da sola, e il «6» di un portiere e' un 5
**07/09/2026, gate §7-quinquagies bis, spec «Novita' v9.80», `letture-app-v1.md` §32.11.** Giornata di
una ADOZIONE nel motore e di quattro correzioni dell'operatore sull'app, e le regole che restano sono
cinque.

**UN OTTIMO SUL BORDO SI RIAPRE CON UNA GRIGLIA PRE-REGISTRATA, e questa volta ha funzionato.** R25
passava il verdetto robusto a K = 40 col 40 sul BORDO, e la regola di casa («un parametro al bordo non
si adotta mai») la teneva fuori per una ragione PROCEDURALE e non per il risultato. Corsa la griglia
allargata come pre-registrata (60, 80, 120 e nessun altro punto), la media SCENDE oltre il 40 — +5,0%
→ +4,0% → +3,4% → +2,5% — quindi l'ottimo e' interno e **R25K40 e' adottata su `default`**. Due
corollari: il punto che si adotta non e' quello con la media piu' alta in assoluto (K25 rende +5,6% e
non regge su classic) e **«migliora ovunque di poco» e' la firma di un termine che si SPEGNE**, non di
un ottimo — il K120 passa strict perche' converge all'inerzia.

**E LA CONSEGUENZA VALE PIU' DELL'ADOZIONE: dove una coppia e' `A = B + derivato`, una novita' entra in
tutt'e due o il derivato la assorbe tutta.** Con R25 la fantamedia del motore porta le giornate
giocate; `est_mv` leggeva solo la stagione scorsa, quindi tutta la novita' in-season sarebbe finita nel
tasso bonus `fm − mv` — la stessa famiglia del difetto v9.59, dove la regressione verso l'ancora
cadeva per intero sul voto base e Malen leggeva 5,67. Misurata prima di spedirla, la miscela della MV
vale **+4,7% di MAE a K=40, 13 finestre su 13**. La `K` non e' una costante nuova: la legge da
`evaluate.ADOPTED`, quindi su euro sta spenta da se' e una futura ri-adozione con un altro K arriva
per conto suo — *una definizione, due lettori*, applicato a un parametro invece che a una funzione.
Stessa regola dal lato app: `SwingInput.fmBlendsSeen` spegne la correzione R25 dello SWING sulle righe
che il motore prezza, perche' riapplicarla sarebbe contarla due volte.

**UN RUOLO MISURATO COL METRO DI UN ALTRO ORDINA AL CONTRARIO.** Lo SWING e' passato a **punti sopra il
6 a giornata** per dichiarazione dell'operatore, e il giorno stesso lui ha trovato che i portieri erano
ordinati per NON giocare: il loro fantavoto porta il malus dei gol subiti, quindi sul loro mestiere «6»
vuol dire porta inviolata ogni settimana — la FMa dei titolari veri sta fra **4,91 e 5,24, tutti sotto
il 6** — e uno zero sopra l'intera scala del ruolo rende il giocare un moltiplicatore di numeri
negativi (il titolare −0,6, il terzo portiere ≈0). E' il difetto dei «primi portieri tutti a 99»
(16/08) incontrato dal verso opposto. Lo zero giusto era gia' MISURATO e non andava scelto: il fielded
del ruolo P legge **5,01/5,03** per due strade indipendenti, quindi `swing.KEEPER_BASE` = 5 mentre per
D/C/A il 6 sta dentro la banda fielded (5,8-6,9) e resta. *Prima di dichiarare uno zero, guardare se
sta dentro la scala del ruolo su cui agisce.*

**UN MODIFICATORE DI LEGA NON E' NEL FANTAVOTO, quindi e' un'OPZIONE e non un termine.** Il +1 a porta
inviolata: misurato, **1.218 portieri su 1.222** a porta inviolata leggono `voto + bonus` senza premio,
quindi ne' la fantamedia ne' il surplus lo contengono. Dichiarato come interruttore accanto al mod.
difesa (`LeagueSettings.cleanSheet`, come `rFactor` per il termine di costanza), e il conto e' **al
DIFFERENZIALE contro la media del campionato e mai al totale** — anche il portiere che giocherebbe al
posto suo incassa porte inviolate, quindi un calendario medio non compra niente e quello che paga e' il
CALENDARIO. Terza lettura del canale delle coppie-portieri e non una seconda aritmetica.

## Un NUMERO CITATO PER CHIUDERE UNA DISCUSSIONE va ricontrollato sulla popolazione della discussione
**07/09/2026, e la voce che c'era qui e' stata RIDIMENSIONATA la sera dello stesso giorno su obiezione
dell'operatore. Dettaglio e tabelle: `letture-app-v1.md` §32.12.** La mattina la sua ipotesi («due
partite da 90' contro zero dovrebbero bastare» per la maglia del portiere) era stata scritta come
RESPINTA su un 10/18 «monetina». La sera lui ha obiettato due cose — che il caso e' particolare (nuovo
anno, cambio allenatore) e che «da verifiche passate avevamo visto che 2 partite da 90' quasi sempre
significava titolarita' per tutto l'anno» — e **aveva ragione su tutt'e due i piani che contano.**

**LA VERIFICA PASSATA ESISTEVA** (`starter_signs`, 14/08/2026: portieri 81,9% contro una base del
22,3%), quindi il 10/18 non era «il» numero di quella domanda: era il numero di UN'ALTRA. Riallargata a
cinque campionati — **294 casi invece di 18**, perche' una popolazione piccola si allarga e non si
spacca — la sua affermazione generale e' confermata con un margine largo: chi ha giocato le prime due da
titolare a 85'+ tiene **0,770** delle giornate che restano contro un null di **0,129** (un portiere
dello stesso club che non le ha giocate), cioe' **sei volte**, e il 71% tiene almeno il 70% del resto
contro il 5%. Il 10/18 e' l'ultima delle quattro celle: era gia' lui l'uscente **0,818** (n=219) · maglia
libera 0,732 (45) · **cambio di maglia con l'uscente ancora in rosa 0,476 (30)**.

**E IL SUO MECCANISMO E' CONFERMATO, LA SUA ETICHETTA NO.** Dentro quei 30 il discriminante non e'
l'allenatore nuovo ma **se l'uscente era disponibile**: infortunato **0,230** (n=10, tiene >=70% una
volta su dieci) contro **SANO e non schierato 0,610** (n=18, 61%) — che e' letteralmente «l'allenatore
ha scelto lui». Il cambio di allenatore, dentro i sani, non aggiunge niente (nuovo 0,613 su 5, stesso
0,666 su 11) e la direzione e' perfino contraria. Il caso vivo cade nella cella buona: Milinkovic-Savic
non ha **nessuno stop datato** sul 22 e il 30/08 e ha due righe con `started` 0 e minuti NULL, cioe'
panchina inutilizzata. Quindi il numero giusto e' 0,610 e non una monetina.

**LA CONFERMA MIGLIORE NON L'AVEVO CERCATA: la correzione sugli infortuni (v9.84) da' a Meret una quota
di 0,638, e la sua cella ne realizza 0,610.** Non serve nessun canale nuovo — un termine «uscente sano
non schierato» resterebbe un candidato su n=18, da pre-registrare — perche' l'aritmetica corretta cade
sulla misura da se'.
Resta vero il sospetto strutturale respinto la mattina («un club schiera UN portiere, quindi la' due
giornate valgono piu'»): la curva del peso ottimale per i portieri ha la **stessa forma** dei ruoli di
movimento (+58,6% a K=1 contro +26,2% a K=5; movimento +53,0% e +25,1%), quindi nessun K per ruolo.

Due abitudini, e sono errori miei. **Un controesempio va verificato nel gruppo in cui cade**: quello che
avevo chiamato «l'evidenza piu' economica che esista» — Meret 2025-26 — ha come titolare uscente **Meret
stesso** (34 presenze nel 2024-25), quindi non e' un cambio di maglia e non poteva testimoniare su quella
cella; resta un controesempio alla cella FORTE, dove tenne 9 su 36 contro una media di 0,818, e quella
cautela sul giocatore e' legittima. E **quando l'operatore dice «da verifiche passate avevamo visto»,
quella verifica si CERCA a verbale prima di rispondere**: era in casa, con un numero piu' forte del mio.

**E l'errore di misura della giornata e' mio, sullo strumento:** ho citato «`--verify` 22/22» dopo aver
tagliato l'output con `tail -30`, che mangia esattamente il blocco dei controlli, e ho dovuto
rilanciare per LEGGERLO. *Un filtro che tronca l'output fa citare un verdetto che non si e' visto* —
la stessa famiglia del `grep` che tiene solo le righe di successo, e la cura e' identica: si scrive su
file e si legge il blocco, non la coda.

## Un NAV si DERIVA dalle rotte, e una pagina che linka solo un'altra pagina non si raggiunge
**06/09/2026, `app/src/app/core/nav.ts` + `ui/app-header`. Dettaglio: `letture-app-v1.md` §33-§34.**
Nove viste avevano nove intestazioni che si somigliavano - la pastiglia della versione copiata OTTO volte
- e ognuna la sua manciata di collegamenti: sette dalla pagina Calciatori, uno dalle Buste, **ZERO dal
pannello d'asta**. Il difetto era scritto nei template, sei volte, dentro un commento («without it
/charts is reachable by URL alone»): *un progetto che scrive il proprio difetto in un commento invece di
curarlo lo riporta alla prima pagina nuova.* Ora ogni rotta dichiara il suo `data.nav` e il nav è
DERIVATO da lì, con un test che pretende che ogni rotta tranne il jolly ne abbia uno - la stessa forma di
`export.CONTRACT`, che si deriva da chi la usa invece di essere mantenuta a mano accanto.

- **IL TITOLO DI UNA PAGINA VIENE DALLA ROTTA ATTIVATA E NON DA `Router.url`.** Un'intestazione che vive
  DENTRO la vista nasce durante l'attivazione, mentre `Router.url` cambia solo alla fine della
  navigazione: per un frame la barra della pagina nuova scriveva il titolo di quella VECCHIA (misurato:
  `/clubs` che legge «Calciatori»). E la stessa risposta serve al titolo E all'accensione della voce: con
  `routerLinkActive` sarebbero due definizioni, e il path vuoto è il caso in cui non sono d'accordo.
- **NOVE ICONE E NON NOVE NOMI, e il conto è la ragione**: 590px contro 230. Su una pagina che non scorre
  quella differenza è una riga rubata alla cosa che si sta guardando - lo stesso conto che al pannello Tk
  è costato 105px di campetto. Il costo si misura con l'A/B più piccolo possibile, **la stessa barra con
  il nav e senza, nella stessa sessione**: +0px sulla Strategia, +28px sulla plancia, e nessuna delle due
  ricomincia a scorrere.
- **UN `<h1>` PER PAGINA**, e quello che descrive il TAVOLO non è l'intestazione della pagina: sul
  pannello d'asta la barra sta SOPRA i tre rami, perché prima ce l'aveva solo il pannello e mentre l'asta
  si preparava non si andava da nessuna parte.

## `[attr.X]` su un INPUT di un componente scrive un attributo che nessuno legge
**06/09/2026, e valeva 74px di colonna.** `[attr.nzWidth]` invece di `[nzWidth]` su una `nz-th`: la
larghezza è un INPUT, da cui ng-zorro costruisce il `<colgroup>`, e l'attributo nel DOM non lo legge
nessuno - la colonna del Nome riceveva **116px dei 190 dichiarati** e i nomi finivano tagliati. È «verifica
la FUNZIONE, non la colonna che le somiglia» applicato a un BINDING, e la variante è che il build resta
verde e lo schermo quasi giusto. Insieme: dentro un flex un elemento non scende sotto il suo contenuto,
quindi `truncate` senza `min-w-0` non tronca, sfonda.

## Il TAGLIO di una cella si misura sul CONTENUTO, e una decorazione non è un taglio
**06/09/2026, e la lezione è la RITRATTAZIONE.** Ho misurato lo `scrollWidth` di un `<td>` e riportato che
la tabella **tagliava ogni nome di 30px**: quei 30px sono il `::after` con cui antd disegna l'ombra di una
colonna `nzLeft`, che vive FUORI dalla cella. La regola giusta è un **Range sul contenuto** (misura le
caselle e ignora gli pseudo-elementi), e con quella entrambe le tabelle leggono zero tagli. *Un difetto si
spiega da sé con una storia plausibile se lo si lascia fare*: colonna stretta, nome lungo, nessun puntino
- e la causa era un ornamento. Corollario: un testo con `truncate` misura la sua casella, quindi i puntini
non sono un taglio - sono una degradazione dichiarata e visibile.

## Un elemento di dimensione FISSA non segue la densità, ed è lui a decidere l'altezza della riga
**06/09/2026.** Una tabella compatta si fa con due proprietà - il PADDING e il CARATTERE, sotto UNA classe
che tutte le tabelle condividono, perché «compatto» è una cosa sola su una pagina - ma un badge, uno
stemma, un'icona non si stringono col carattere: restano alti come prima e diventano il pavimento della
riga (23px contro i 19 che il testo permetteva) e il pavimento della larghezza della loro colonna. La cura
è dare loro una TAGLIA, e il regalo è che l'eccezione di larghezza che quella colonna aveva sparisce: *una
eccezione può essere il prezzo di un elemento che non si stringe, e allora si cura l'elemento.*

## Un'ICONA significa la stessa cosa ovunque: la TAGLIA è un input, il DISEGNO no
**06/09/2026, e il difetto era vecchio.** La tabella delle ultime partite disegnava un **bersaglio** per i
gol - che nel vocabolario di `ui/bonus-mark` è il RIGORE - e una `share-alt` per l'assist, dove la card
mette una scarpetta: due pagine che dipingevano due cose diverse per lo stesso fatto, cioè quello che quel
componente esiste per impedire (condizione dell'operatore, 05/09). Quando una seconda pagina ha bisogno di
un marchio più piccolo si aggiunge una TAGLIA (`size`), come le pastiglie dei ruoli che hanno tre misure e
un colore solo; quello che non si tocca è il disegno e il `kind` su cui si sceglie.

## L'ORDINE delle colonne è parte della risposta, e vive nell'ASSE
**06/09/2026.** «A sinistra le più recenti» si cambia in un posto solo - l'asse delle colonne dello store -
e non in ogni vista che lo disegna, o la stessa tabella leggerebbe in due direzioni su due pagine. È anche
il verso che il lettore delle ultime partite della CARD (`recentMatches`) dichiara di sé da sempre: *una
tabella e una card che raccontano la stessa storia in due direzioni sono due vocabolari per un fatto solo.*
E la prova non passa dall'app: i numeri di giornata stanno nei `title` delle colonne, quindi il banco legge
la sequenza e pretende che scenda.

## Due fatti che devono essere D'ACCORDO si leggono in UNA lettura
**06/09/2026, difetto di un banco.** «Quale vista è a schermo» e «che titolo scrive la barra» venivano da
due `Runtime.evaluate` diversi: fra i due la navigazione passa, e il passo attribuisce a una pagina il
titolo di quella prima. È la variante «nello stesso istante» del passo che misura due incognite insieme.
Con lei, altre tre regole di casa incontrate da capo in una sera: aspettare «la prima barra che passa» è
misurare il frame precedente (si aspetta un segnale INDIPENDENTE da quello che si sta per asserire, o è
l'asserzione circolare); un bersaglio allineato a destra si SPOSTA quando arriva il contenuto a sinistra,
quindi si aspettano due letture identiche; e un tooltip rimasto in giro si legge come quello nuovo, quindi
si parte da uno stato pulito verificato.

## Prettier è configurato e l'albero NON è formattato
**06/09/2026, e la cura è stata annullare una corsa.** `npx prettier --write` su ventisei file ne ha
riformattate in massa ~1.500 righe, dentro la metà di un'altra sessione. Verificato che le versioni a HEAD
di quei file **erano già non formattate**, e così i banchi vicini: quindi lanciarlo non è una pulizia, è
una riformattazione di massa. Annullata file per file ricostruendo ogni file come «HEAD più il mio blocco»,
e la prova che la metà altrui era intatta è che `prettier(ricostruito)` è **byte-identico** al file
prettificato di prima. *Un formattatore dichiarato e non applicato è una trappola: prima di lanciarlo si
controlla se l'albero lo rispetta già.*

## Lo ZERO di un parametro centrato e' parte del parametro, e una costante DICHIARATA si puo' calibrare
**07/09/2026, dalle due correzioni dell'operatore su `est_*`. Dettaglio: gate §7-unquinquagies /
§7-duoquinquagies, `letture-app-v1.md` §35-§36.**

**UN PARAMETRO APPARTIENE ALLA POPOLAZIONE SU CUI E' MISURATO — E ANCHE IL SUO ZERO.** L'ancora di un
nuovo arrivato legge la forza del suo club come DIFFERENZA dalla media del campionato, e la media veniva
presa su tutte le osservazioni: `snapshot` costruisce la popolazione sulle ROSE OSSERVATE, che portano
club esteri e di Serie B, quindi lo zero scendeva da 1690 a ~1647 e ogni nuovo arrivato prendeva +0,07 di
fantamedia gratis. La pendenza era giusta; sbagliato era il punto da cui si misura la distanza. Due
abitudini, e la prima e' la sola ragione per cui il difetto e' durato mezz'ora invece di un mese: **il
primo artefatto scritto dopo un'adozione si confronta col NUMERO CALCOLATO A MANO** e non con «e'
cambiato nella direzione giusta» — 6,859 era piu' alto di 6,52 come previsto, quindi ogni controllo di
direzione avrebbe detto che funzionava; e **un test su una media centrata deve contenere una riga FUORI
popolazione**, o passa qualunque zero.

**UNA COSTANTE DICHIARATA NON E' PER SEMPRE DICHIARATA.** Messo davanti a tre scale di confidenza da
scegliere, l'operatore ha risposto «possiamo misurare gli esiti su una stagione vecchia e vedere qual e'
la soluzione che piu' rispecchia la realta'?» — su una costante che aveva dichiarato lui. Si puo', quando
la quantita' ha un esito osservabile: una penale che MOLTIPLICA il surplus si calibra come RAPPORTO fra
quello che quella popolazione ha reso e quello che le era stato predetto. Misurato per gradino su dieci
finestre: `core` 0,94 · `older` 0,93 · `shrunk` 0,77 · `anchor` **0,69** contro lo 0,50 in vigore. La
regola procedurale: **le opzioni si offrono per le PREFERENZE** (quanto rischio accettare, cosa mostrare,
quale vocabolario), **non per le quantita' che i dati possono decidere** — e prima di aprire una domanda
su una taratura ci si chiede se la quantita' abbia un esito. Due corollari: quel che si calibra e' il
BIAS e non la prudenza (l'avversione al rischio si moltiplicherebbe sopra, ed e' un'altra decisione); e
dove il deliverable e' PIATTO (qui fra 0,73 e 0,80, e non monotono) si adotta il valore misurato e non il
picco del banco, che e' la disciplina gia' scritta per il `k` dello SWING.

**E «POCA EVIDENZA» PUO' ESSERE EVIDENZA CONTRARIA, che ribalta l'obiezione con cui la scelta era stata
presentata.** Alzare l'ancora sopra il pavimento dello `shrunk` sembrava rovesciare una scala ordinata per
evidenza; calibrato per banda di voti, `shrunk` legge **1-4 voti 0,45** · 5-9 0,92 · 10-14 0,89. Un uomo
con tre voti merita MENO di uno che non ne ha nessuno, perche' tre voti sono un giocatore che il suo
allenatore non ha schierato, mentre «niente» puo' essere un titolare che arriva dall'estero. *Prima di
«ripristinare un ordine» che sembra rotto, misurare se l'ordine e' davvero quello che si crede.*

**Il `core` calibra 0,94 e NON si tocca**: `est_*` su una riga core deve riprodurre `engine_*`, o un uomo
porta due surplus sullo stesso foglio. Quel 6% e' un fatto sul MOTORE — sovrastima il surplus degli uomini
che prezza — e appartiene al gate, non alla cascata: scritto, non applicato.

## Una DRITTA e' la terza cosa dichiarata, e la difesa NATIVA e' una selezione e non un prezzo
**07/09/2026, da cinque nomi che l'operatore ha portato guardando la pagina Formazione. Dettaglio:
`formazioni-tipo-v1.md` §9, spec «Novita' v9.87».**

**`config/player_rulings.json` e' la TERZA cosa dichiarata di questo progetto**, e ha la forma delle altre
due (`board_rulings.json` per il modulo di un club, `player_notes.json` per chi e' fuori rosa): unita per
`fc_id`, datata, revocabile, **invisibile ai due giudici** (`apply_rulings=False`) - una dritta si da'
spesso GUARDANDO il giudice. Nasce dalla sua richiesta: «servirebbe qualche parte dove ti posso dare delle
dritte che esulano dalle statistiche... io ho delle conoscenze che i dati non hanno». Tre valori e ognuno
ha un effetto PRECISO sul disegno (`starter` entra nell'undici e una riparazione non lo scavalca,
`alternative` compare fra i rivali di una maglia che puo' indossare, `reserve` esce dai candidati), perche'
**una dichiarazione che non si puo' applicare non si puo' nemmeno smentire**; e' un VINCOLO e mai un peso,
come le tre regole delle buste chiuse; e una parola fuori vocabolario viene IGNORATA invece di interpretata.

**I RIVALI DI UNA MAGLIA VENGONO DAL POSTO, non dalla linea per cui l'uomo e' stato SCELTO.** Il serbatoio
si costruiva da `by_role[linea di partenza]` prima delle riparazioni, e chi una riparazione toglieva
dall'undici restava in `taken`: quindi Neres (claim 0,440) non era nel serbatoio di NESSUNA maglia mentre
la sua andava a Santos A. (0,405), e la fascia di mezzo del Milan aveva per rivali Moreira (0,386) e
Terracciano F. (0,304, **un destro sulla sinistra**) invece di Gabbia (0,543) e Tomori (0,498). Ora e'
«tutti gli eleggibili fuori dall'undici FINALE» col filtro `can_replace`: si e' allargato il POOL alla
regola che il commento accanto dichiarava da sempre, non la regola. Cambia i rivali di 14 club su 20 e non
puo' muovere l'undici, che e' verificato e non dedotto (zero differenze sulle 9 colonne `engine_*`).

**E LA REGOLA DELL'OPERATORE SULLA DIFESA E' UNA SELEZIONE, NON UN PREZZO** - «finche' ci sono Dc di buon
livello e disponibili devono giocare loro nella posizione Dc; se mancassero e nella sua storia avesse
giocato Dc allora potrebbe posizionarsi li'», e la generale: «adattamenti in posizioni che non gli
competono devono essere avallati da situazioni realmente viste in campo e non immaginate, senza controprova
statistica e' solo fantasia» (la controprova esiste: `player_roles` sono i codici OSSERVATI). Tre cose
restano oltre il caso.
- **Un punteggio migliore non compra una regola che ne rompe un'altra.** La prima cura era un pedaggio di
  40 dentro `_slot_price`, dimensionato sul caso vero (la coppia sbagliata costa 10 contro i 16 di quella
  giusta): metteva Karlstrom a centrocampo e faceva SALIRE il giudice stampa (157/220 contro 156). Rifiutata
  comunque, perche' faceva cadere tre test guardiani - vietava gli attraversamenti che il modulo RICHIEDE
  («una fascia di centrocampo scoperta viene coperta dal fronte») e la riga di mezzo del Liverpool restava
  senza l'ala destra.
- **Il fixture che cade dice qual e' la distinzione giusta.** Nel Liverpool di quel test NESSUN altro
  centrale esiste, quindi il mediano che scala e' il secondo comma della sua stessa regola e questo modulo
  l'aveva gia' misurato. La domanda «esiste un Dc arruolabile?» e' sulla ROSA e non sulla griglia, e un
  prezzo per posto non la puo' fare: da qui `_native_defence`, dopo il rimodellamento, con l'adattato che
  torna nella sua linea se la' c'e' un posto piu' debole di lui (Karlstrom 0,672 contro Piotrowski 0,508).
  Effetto: uomini disegnati in una linea che i loro codici non coprono **9 -> 8, e ZERO in difesa**; giudice
  **identico** (8 MATCH / 2 ALT / 10 DIFF, 156/220), che per una regola DICHIARATA e' quello che si chiede -
  che il disegno non peggiori, non che il giudice la approvi.
- **E un caso su cinque non era un difetto**: Belahyane legge `pv_seen` 1 su 2 e 11 voti su 38 l'anno
  scorso, quindi il claim 0,355 e' aritmetica - la miscela pesa «adesso» al 25% alla seconda giornata (K=5,
  adottata a +31,9% fuori campione, e la percentuale fissa 50/50 misurata PEGGIORE). Il prezzo dichiarato e'
  che un titolare nuovo emerge in 4-5 giornate, ed e' esattamente il buco che le dritte riempiono.

## ...e l'altra metà: una dritta si PREZZA nell'app, e la scala a sei parole non è monotona
**07/09/2026 (notte), la metà APP della dritta qui sopra: «cliccando su un calciatore, nella card di
dettaglio, fosse possibile cliccare sulla riga titolarità e impostare la mia indicazione ... dovrebbe
aggiornarsi il campetto nella pagina squadre, il numero di partite attese, il surplus, lo swing e tutti i
valori derivati». Dettaglio: `letture-app-v1.md` §38.** Il toolkit applica la dichiarazione al DISEGNO
come vincolo e non muove un numero; qui la stessa dichiarazione viene PREZZATA, e sta nell'app per la
ragione per cui ci sta l'assicurazione infortuni (`expected-play.ts`): non è una previsione nuova sul
calcio, è una quantità dichiarata che riscala numeri che il foglio ha già calcolato. Nessun gate la
possiede. Il formato su disco è **lo stesso file del toolkit**, così un JSON copiato da là si legge qui
senza tradurlo — ma vive in `localStorage`, quindi non entra nei fogli e la strada per farlo è
ridichiararlo in `config/player_rulings.json`: è l'unico pezzo aperto e nessuno dei due lati mente.

**QUANTO VALE UNA PAROLA È UNA DOMANDA SULLA SUA POPOLAZIONE, e la risposta contraddice l'ordine della
scala.** Le sei parole le decide il toolkit su DUE assi (la quota di partite a voto e un pavimento di
MINUTI), quindi la conversione in giornate non si sceglie: è la MEDIANA del gradino sul foglio che si sta
leggendo. Misurata: bandiera 0,967 (n=29) · **titolarissimo 0,858 (17)** · **titolare 0,949 (59)** ·
ballottaggio 0,807 (155) · panchina 0,631 (119) · riserva 0,243 (183) — `titolarissimo` sta SOTTO
`titolare` perché è il gradino RESIDUO fra gli altri due (>80% delle partite E almeno 75 minuti).

**E L'ORDINE DELLA SCALA NON CEDE ALLA MISURA, perché è una DICHIARAZIONE** (sua correzione del
08/09/2026: «titolarissimo deve essere meglio di titolare»). La prima versione non imponeva nessuna
monotonia e stampava i numeri «perché la sorpresa si veda»: era giusta sulla misura e sbagliata sulla cosa
da fare — dichiarare un gradino più alto non può ABBASSARE le presenze attese, o è una dichiarazione che
punisce chi la fa. *Quando una misura contraddice una dichiarazione dell'operatore su un ORDINE, non è la
dichiarazione a cedere: è la conversione a doverla rispettare, e la misura resta leggibile accanto* (due
funzioni e due nomi: `rungMedians` misura, `orderedShares` dichiara). La riparazione fa il MINIMO e agisce PER ASSE: si
muove solo il gradino che viola l'ordine e lo si mette in MEZZO ai suoi vicini misurati (`titolarissimo`
0,958, fra 0,949 e 0,967), quindi l'ordine viene da lui e il livello dal dato, e nessun numero entra fuori
dalla banda che la misura disegna. E **si ripara un'INVERSIONE, non un PAREGGIO**: sui minuti i due
gradini alti valgono entrambi 80 perché condividono il pavimento dei 75', e inventare uno scarto dove il
dato non ne ha vorrebbe dire scrivere una misura.

**E LA PAROLA PROMETTE DUE COSE, quindi dichiararla ne imposta due** (sua osservazione dell'08/09/2026:
«l'etichetta viene assegnata non solo per le partite giocate ma anche per i minuti giocati... devi
impostare sia le partite che i minuti adeguatamente»). Esatto, e i pavimenti si leggono nel dato: le
mediane dei minuti sono 80 · 80 · 71 · 61 · 55 · 52, coi due gradini alti sopra i 75' e `titolare` fra 65
e 75. Quindi la misura porta DUE mediane per gradino e la dichiarazione le impone entrambe - i minuti sono
un LIVELLO e si sostituiscono, non si riscalano, e non entrano in nessuna valutazione: quello che cambiano
è cosa la riga DICE su cinque schermate. Il prezzo e' che un asse puo' anche SCENDERE (77' -> 71' su un
`panchina` promosso a `titolare`), ed e' coerente: a 77' con quella quota il toolkit lo chiamerebbe
`titolarissimo`. E il selettore stampa **un decimale sulle giornate e i minuti interi**, perche' in cima
la differenza vive nei decimi di giornata e nei nove minuti: *ogni asse si stampa con la precisione in cui
la sua differenza vive*, o lo schermo cancella la distinzione appena aggiunta (con l'intero le due parole
leggevano entrambe «34 gg»).

E **una CONFERMA non muove niente**: se il gradino dichiarato è quello che il foglio dice già, la quota
resta la SUA — altrimenti un `bandiera` letto 0,99 e dichiarato `bandiera` scenderebbe alla mediana, cioè
una dichiarazione che conferma peggiorerebbe il numero.

**LA PROIEZIONE SUL DISEGNO VIENE DAL CANCELLO CHE LA SCALA HA SU SE STESSA**, non da una scelta nostra:
«chi la board non schiera non può essere titolare, chi schiera non scende sotto ballottaggio». Quindi i
primi tre gradini pretendono l'undici, gli ultimi due lo escludono e `ballottaggio` non muove niente (115
dei 155 ballottaggi del foglio Serie A sono nell'undici, 40 no). L'app non calcola nessun undici di un
club vero: RIORDINA la graduatoria che il toolkit ha già scritto per ogni posto, con un ordinamento
STABILE — quindi **idempotente per costruzione**, ed è quella proprietà che rende sicuro avere due
lettori della stessa dichiarazione. Chi il toolkit non mette in discussione da nessuna parte non entra, e
il campetto lo DICE.

**E DUE PUNTI DI APPLICAZIONE NON SI SOMMANO SE FISSANO UNA BASE ASSOLUTA.** Le tabelle e il campetto
passano da `ValuationStore` (le colonne del foglio più le dritte), le pagine che PREZZANO da
`expectedPlay`: applicata due volte, la dichiarazione ricalcola lo stesso numero, perché sostituisce la
base invece di moltiplicarla. Si riscala solo quello che MOLTIPLICA le presenze, elencato una colonna per
volta, e **`actual_*` non si tocca**: riscalare un esito con una dichiarazione vorrebbe dire correggere
il passato.

Tre difetti trovati dal banco in un browser vero, e il terzo era del banco.
- **La plancia legge il foglio DA SÉ e non passa da `ValuationStore`**, quindi la misura delle quote non
  le arrivava e il selettore stampava un trattino su tutte e sei le parole. I lettori del foglio sono DUE
  e non uno: la misura si CONSEGNA e si fonde per piattaforma, o la prima consegna cancella l'altro
  listone.
- **Chi entra in campo restava ballottaggio di un ALTRO posto** (il toolkit elenca lo stesso rivale su
  più posti: 171 voci su 610), quindi il campetto lo disegnava due volte — l'invariante «un titolare non è
  un ballottaggio» valeva per il posto e andava detta per l'intero campetto.
- **E «il campetto non gli ha dato la maglia» era falso**: il passo cercava il posto salendo di due
  `parentElement` e finiva sull'intera RIGA. *Un passo che misura l'elemento sbagliato accusa il codice
  del proprio difetto*, ennesima istanza — ora legge l'item dal suo hook.

**Tre richieste della stessa sera, tutte di vocabolario.** Il PALLINO dopo il nome quando una
personalizzazione è attiva è UN componente letto da cinque liste (`ui/ruling-dot`) e non un `@switch`
copiato cinque volte, e sul campetto ha **sostituito** la sigla messa mezz'ora prima: due marchi per un
fatto sono due legende. Lo SWING sulla card è una riga con la sua etichetta e NON il numero grande
accanto — quello è quanto rende una partita CHE GIOCA, questo quanto rende una GIORNATA — con la base del
tooltip letta da `swingBase(role)`, perché per un portiere è 5 e una card che dicesse «sopra il 6»
spiegherebbe un numero vero con la base di un altro ruolo. E la titolarità sulla Strategia è la
quindicesima pastiglia, l'unica che porta una PAROLA: ordina per la SCALA e non per la sigla (che darebbe
l'alfabeto), e la parola che mostra è quella DICHIARATA, risolta dove nasce la riga perché `readingsOf` è
pura e non deve poter leggere una dichiarazione.

## L'ASTERISCO viaggiava nel pacchetto e nessuno lo leggeva
**07/09/2026, da «perche' nel Napoli c'e' ancora Lukaku?». Dettaglio: `letture-app-v1.md` §37.** I fogli
del motore non lo portano e `listone_quotes` dice `sold = 1` su tutt'e due le piattaforme; quello che si
vedeva veniva dalle liste che l'app costruisce dalle QUOTAZIONI, dove un ceduto conserva prezzo e club fino
alla prossima lettura del listone. **145 righe con `sold=1` erano nel bundle dal 03/09 e l'unico posto che
lo nominava era un commento**: sesta istanza di «il dato c'era e mancava un lettore». Curato per
piattaforma (`PlayerRow.sold`), coi ceduti fuori dalle liste da comprare e fuori dalla rosa di un club -
mentre la tabella dei Calciatori li MOSTRA, perche' «chi il listone quota» e' un'altra domanda e la sua
storia con quel club e' un fatto. Resta da fare il MARCHIO su quella riga.

## Uno SCONTO che agisce in silenzio, e una SOGLIA dell'operatore si risolve MISURANDO
**08/09/2026, quattro richieste sulla plancia. Dettaglio: `assistente-asta-v1.md` §34.3-novies e §34.6,
`simulatore-asta-rilanci-v1.md` §31.**

**«DISINCENTIVARE GLI ACQUISTI DELLO STESSO CLUB» ERA GIA' IMPLEMENTATO, e quello che mancava era che si
VEDESSE.** Lo sconto stesso-club viveva dal 04/09 in tutt'e due i punti che chiamano `offerBand` —
abbassava la cifra sugli slot mercato e faceva scendere di BLOCCO su quelli personali — mentre la card
del lotto dichiarava la finestra dell'infortunio, la demozione di slot e il tetto della scommessa, cioe'
ogni fattore della banda TRANNE questo. E' «un vincolo che agisce in silenzio e' indistinguibile da un
ordinamento rotto» commesso dal lato del DISPLAY, ed e' anche la ragione per cui l'operatore ha
richiesto una cosa che c'era gia'. *Prima di cambiare una costante, guarda quanta della richiesta e'
gia' soddisfatta* — e se lo e', il difetto e' che non si vede.
La scala e' ora per RUOLO (25% chi gli pesta il ruolo, 15% chi sta in un altro reparto), **geometrica**
come quella del banco (`CLUB_PENALTY ** k`) cosi' «poi aumento per i successivi» esce da se' senza
scrivere a mano il terzo numero, col tetto DICHIARATO al 90%. Le percentuali si LEGGONO dalla scala e
non si riscrivono nelle stringhe: due copie di quei numeri direbbero due cose il giorno che ne cambia
uno. La direzione e' quella che `metrica-asta-surplus-v1.md` §24 misura (stesso club **e** ruolo −0,151
contro −0,061 di ogni altro appaiamento), quindi vale come DIREZIONE e non come taratura.

**E IL BRACCIO DEL BANCO NON LA APPLICAVA PROPRIO NEL MECCANISMO CHE LUI GIOCA**: contato invece che
dedotto, `club_weight` e' chiamato **140 volte a chiamata e ZERO a estrazione**, perche' l'adozione della
scala di mercato manda il braccio sul ramo `step`. `CLUB_ON_DRAWN` e' misurato appaiato (**−0,68%**, t
−3,1, 2 finestre di 10: FALLISCE il criterio, e' un COSTO) contro un club piu' affollato **4,00 → 3,18**
e una sd **86,9 → 82,6**; ACCESO per decisione dell'operatore e non per il banco, perche' e' una
preferenza che il banco non arbitra — il beneficio e' DENTRO una stagione e la sua sd e' FRA stagioni — e
perche' con OFF il braccio offriva su una scala che il consiglio dell'app contraddice.

**UNA SOGLIA DELL'OPERATORE SI RISOLVE MISURANDO QUALE METRICA PUO' RAGGIUNGERLA.** La sua «almeno 32
partite su 38» per una coppia di portieri non e' sui *coperti* (porta inviolata attesa: la coppia
migliore fa **24,8/38** e ZERO coppie toccano 32) ma sui *facili* (**64 coppie di 190** ci arrivano, la
migliore 38/38). Costruirla sulla metrica sbagliata avrebbe prodotto una funzione che non mostra mai
niente, e il difetto sarebbe stato invisibile. La soglia vive come QUOTA (`KEEPER_PAIR_TARGET_SHARE`
32/38) e non come numero, per la lezione R20.

**LA SUA SECONDA STRATEGIA E' CONFERMATA DAL CALENDARIO, E IL CONCETTO NUOVO NON HA UNA COSTANTE NUOVA.**
«Tre portieri di una sola squadra ma a livello supertop, come Inter»: misurato, l'**Inter da sola fa
35/38** giornate facili (Roma 34, Juventus 31), cioe' tre di lei valgono tre giornate in meno della
migliore coppia ma con la porta GARANTITA tutte le 38 e zero rischio rotazione. E «supertop» e'
esattamente **«un club che DA SOLO raggiunge gia' la soglia della coppia»** — la stessa soglia, non una
seconda — ed e' il complemento di `EASY_ALREADY_SHARE`: un club auto-coperto e' un cattivo PARTNER
(ridondante) e un'ottima ANCORA singola. Da qui `planKeepers`, che legge cosa possiedo e capisce la fase
(scegliere · completare i tre di un supertop · cercare il partner che arriva alla soglia · il terzo
economico coi DUE tipi «pari», il vice di un mio titolare o un club nuovo), e la striscia
`views/plancia/keeper-strategy` che la traduce in una riga.

Tre abitudini piu' piccole, tutte pagate qui. **Un numero pubblicato si ricontrolla**: avevo scritto che
il tetto del 90% morde all'ottavo uomo dello stesso club e ruolo, e contato l'ottavo legge 89,99% per la
progressione da se', quindi taglia dal NONO. **Un arnese si verifica prima di accusare il codice**:
`npx vitest run` a mano legge 38 fallimenti (`describe is not defined`, `localStorage is not defined`) su
un albero verde, perche' il comando vero e' `ng test`; e `sorted(windows)[-1]` da' la finestra piu'
VECCHIA (Tm7, 2015-16) invece della piu' recente. E **una sola urna misura la fortuna di
quell'ordine**: nell'asta singola il braccio motore e' quarto, su 10×20 urne fa 2686 punti, posto 2,18 e
103 titoli su 200 contro i 2574 del miglior umano.

## Conventions
The knowledge base lives in git under [docs/model/](docs/model/) (canonical; git handles versioning);
Drive is a mirror/archive, updated ONLY on the user's explicit request. When the user says **`chiudi`**,
consolidate all `docs/model/` docs (and this file if conventions changed) with the current
state/decisions/commits/next steps, then commit — so a new chat resumes with no lost context.
