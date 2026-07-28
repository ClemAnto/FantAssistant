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
  (per-league scoring) and `league_config.json` (how many teams and squad slots a league has, which is
  what fixes the auction's REPLACEMENT LEVEL - see below).
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

## Provisional parameters
Some constants exist only because a module needed a number to run: the revealed penalty hierarchy's
decay/quarantine (`fc_site`), the arrival tier thresholds and the U22 age (`arrivals`). They are
MODEL choices, so the gate owns them - they are marked provisional in the code and must be swept,
never quoted as established. Same rule as any other candidate rule: no gate, no engine.

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
- **Starting probability** (`probable_starter`): the site publishes only "now". The weekly job exists
  (`scripts/weekly-snapshot.ps1 -Register`) and every week it does not run is a window that will never
  exist. This is why the gate reports `starter_prob` 0/1453 on past windows.
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

## Citing a fitted number
**A coefficient quoted without its platform, its residual baseline and its date is not a fact.** Audited
28/07/2026: only 5 of the 12 lambdas the knowledge base quoted could still be reproduced, and two of the
five only against the pre-two-pass baseline - one of those carried an INTERPRETATION that the corrected sign
reverses (R11, `gate-motore-v1.md` §5-septies). Drift is legitimate, data improves; presenting a number as
fixed without provenance is not. The gate report carries all three (`platform`, `generated_at`,
`notes["residual_baseline"]` per fit), so either copy them alongside the number or cite the report instead
of the number. Two conclusions also turned out to be stated in the singular about a PLATFORM-dependent
quantity, which `platform` being a first-class dimension should have prevented.

## Conventions
The knowledge base lives in git under [docs/model/](docs/model/) (canonical; git handles versioning);
Drive is a mirror/archive, updated ONLY on the user's explicit request. When the user says **`chiudi`**,
consolidate all `docs/model/` docs (and this file if conventions changed) with the current
state/decisions/commits/next steps, then commit — so a new chat resumes with no lost context.
