# euroleghe-ingest

Data ingestion toolkit for the EuroLeghe prediction engine. Python + SQLite. Produces
`data/euroleghe.db`, and `export` turns it into the bundle the app's `prediction-engine` reads.

Reference spec: [../docs/model/spec-euroleghe-ingest-v9.md](../docs/model/spec-euroleghe-ingest-v9.md)
(canonical, in git; Drive is a mirror).

## Install on a machine that has never seen this project

```bash
git clone https://github.com/ClemAnto/FantAssistant
cd FantAssistant
python -m venv toolkit/.venv                      # Python 3.13
toolkit/.venv/Scripts/pip install -e toolkit      # or bin/pip on POSIX
cp .env.example .env                              # then fill in the fantacalcio.it credentials
```

Then build the whole database from the network:

```bash
python -m euroleghe_ingest bootstrap --plan   # print the order, the options and the cost
python -m euroleghe_ingest bootstrap          # run it (resumable: rerun to continue)
```

**About 17 hours**, almost all of it deliberate rate-limiting, and every step caches its raw response
so an interrupted run continues where it stopped. What the plan cannot do, and says so:

- **credentials are mandatory.** `ratings` needs a fantacalcio.it account for the authenticated Excel
  API (votes + listone). Without it there is no registry, so `bootstrap` refuses to start rather than
  build half a database.
- **the Drive roster exports are optional.** `data/raw/*.csv|xlsx` are the user's own files, not on the
  public web. The listone creates `players`/`clubs`/`rosters` without them and the euro season
  aggregates are derived from the votes. If you do have them: drop them in `data/inbox/` and run
  `fetch --inbox` first.
- **FBref is blocked** (Cloudflare 403 on every path, TLS impersonation included). SofaScore replaced
  it as the source of the facts; `fbref` stays a stub on purpose.

`fetch --plan` answers "what is missing on this machine?" at any point, table by table, with the exact
command that fills each gap.

## Principles (spec v9)

1. Raw responses are cached and ARE the source of truth; the **DB is always rebuildable from scratch**
   (idempotent `rebuild`, offline).
2. The prediction engine reads only normalized data - and only through the `export` bundle.
3. `fc_id` = **primary key**; the other sites live in `player_xref`/`club_xref`.
4. No mandatory manual step; ambiguous cases downgrade a tier.
5. The toolkit knows what it is missing (`fetch --plan`, `bootstrap --plan`).
6. Autonomy via authenticated scraping (credentials in the local `.env`, nowhere else).
7. `manual_overrides` = optional highest-precedence overrides.
8. Volatile states as **dated time series**, never static flags.

## Data model: `platform`, `gameType`, full-season propensity (v9)

- **`platform`** = `euro` | `default`. `euro` = EuroLeghe (5 leagues, top clubs; Serie A is **partial**);
  `default` = classic Serie A (all 20 teams, endpoint `/voti-fantacalcio-serie-a/{season}/{md}`). The two
  use **different matchday calendars**, so `platform` is part of the PK of `match_ratings`,
  `match_rating_bonuses` and `season_stats`. `euro` is the fantamedia/**target**; `default` is the
  **full real-league season**.
- **`gameType`** = `classic` | `mantra` is an **engine** dimension (roles + fantavoto modifiers); the base
  voto is shared, so it is not stored in the raw ratings.
- **Ratings** come from the authenticated **Excel API** (login + `/api/v1/Excel/votes/{championshipId}/{md}`),
  never the anti-bot HTML page. Aggregation **option A**: canonical `match_ratings` columns + a lossless
  `match_rating_bonuses` layer (raw key/value) for season-specific bonuses. The cached Excel are the raw
  source of truth: `rebuild` re-ingests them offline (`reingest_from_cache`) so scraped ratings survive.
- **Full-season propensity**: the euro calendar is a *subset* of a player's real matches. Propensity
  (goals/assists/xG per 90) is computed over the FULL real season, while the FM/Mv target stays on `euro`.
  Serie A gets the full season from `default`; the other 4 leagues from **SofaScore** - season facts in
  `external_stats`, per-match rating in `external_match_stats` - with a **calibrated** synthetic base-voto
  (`mv_synth`, a least-squares line per role fitted on the euro/real overlap, not fixed buckets). The whole
  external layer is source-tagged and never contaminates the `euro` target.
- **euro<->real matchday map** is **per league**: one euro round bundles a *different* real round in each of
  the 5 leagues -> `matchday_map(season, euro_md, league, real_md)`. Serie A is derived offline from the two
  platforms' ratings; the other leagues from the per-match layer. The two derivations agree 29/29 where
  they overlap.
- **Prices: three pairs, one of them auction-safe.** `price_initial` (Qt.I) is the pre-auction quotation
  and the only price a rule may read; `price` (Qt.A) is revised all season and `fvm` is end-of-season, so
  for a past season both embed the outcome. The export manifest states this per column.
- **Three answers to "what role is he?", and they are different questions.** `rosters.role_classic` /
  `rosters.roles` = what the LISTONE sells him as (P/D/C/A and the Mantra roles). `positions.derived_role`
  = which of the provider's four LINES he was actually used in, per season, from the modal per-match slot.
  **`player_roles.roles`** = the granular real position, one to three of twelve codes
  (`GK` · `DL DC DR` · `DM` · `ML MC MR` · `AM` · `LW RW` · `ST`) - the only one of the three that tells a
  left back from a centre back, since the first two call both `D`. It is a **grid**: each code carries a
  flank (-1..+1) and a depth (0 = his own goal .. 1 = the opponent's, the axis `positions.avg_x` is
  measured on), which is what lets the sheet and the pitch view place him. `snapshot` also derives what a
  **Mantra** auction would call him (`desc_mantra_real`): Mantra simplifies (ML/MR both `e`, LW/RW both
  `w`), `AM` is `t` or `a` by the provider's broad line, and `b` (braccetto) comes from the code
  COMBINATION - a flank defender who also plays `DC`. It never replaces `rosters.roles`; it exists for the
  July case, where no listone row exists yet.
- ⚠️ **`player_roles` is DATED and cannot be backfilled.** The provider serves only "now": `?seasonId=` is
  accepted (HTTP 200) and ignored, returning today's codes for a season three years old. It is the third
  snapshot-only fact, with `probable_starter` and `flags.contract_until` - see the export manifest's
  `known_gaps`. `positions.derived_role` and `positions.avg_x/avg_y` ARE historical and are what a past
  window must use instead.

## UI (operator panel)

```bash
python -m euroleghe_ingest          # no command -> opens the window
python -m euroleghe_ingest gui      # explicit equivalent
```

Tkinter, stdlib only - no extra dependency. Three tabs: **Operations** (the modules grouped by how
often they are run, each with a state dot: green = its output exists, orange = to run, grey =
unavailable), **Players** (per-team table with role pills, or the per-matchday fantavoti grid), and
**Auction** (per role, the ten players the engine would have valued highest against the ten who
actually finished highest). Light and dark theme, toggled in the header and remembered.

`ui_theme.py` owns the palette, the type scale and the operation glyphs; the drawing code reads the
colours at draw time, which is what lets the theme switch without a restart. Role pills and the
fantavoti status cells are deliberately NOT themed: they are data encodings, and they must mean the
same thing in both modes.

After `pip install -e .` the console-less executable `euroleghe-ingest-gui` is also available (good for
a desktop shortcut). From the repo root, `toolkit-start.cmd` does the same.

## Commands (CLI)

```bash
python -m euroleghe_ingest --help
python -m euroleghe_ingest bootstrap --plan  # the from-zero acquisition plan (order + cost)
python -m euroleghe_ingest initdb            # apply the schema to an empty DB
python -m euroleghe_ingest rebuild           # rebuild the whole DB from the cache (offline, idempotent)
python -m euroleghe_ingest fetch --plan      # what is populated, what is missing, what to run
python -m euroleghe_ingest fetch --inbox     # import the Drive exports from data/inbox/
python -m euroleghe_ingest validate          # integrity checks

python -m euroleghe_ingest ratings --platform euro --season 2024-25  # authenticated Excel + listone
python -m euroleghe_ingest positions                     # SofaScore season facts (5 leagues)
python -m euroleghe_ingest positions --layer match       # per-match ratings, perimeter clubs (hours)
python -m euroleghe_ingest positions --layer complete    # the matches the perimeter filter skipped
python -m euroleghe_ingest positions --layer heatmap     # avg_x/avg_y (one request per player-season)
python -m euroleghe_ingest positions --layer roles       # the granular real role + foot (one per CLUB)
python -m euroleghe_ingest positions --layer crosstab    # provider slot vs listone role (offline report)
python -m euroleghe_ingest injuries --layer ids          # Transfermarkt ids + contract expiry
python -m euroleghe_ingest injuries --layer injuries     # the injury history, one request per player
python -m euroleghe_ingest transfers                     # clubs, coach spells, transfer fees
python -m euroleghe_ingest elo                           # ClubElo: one request per auction date
python -m euroleghe_ingest fc_site                       # today's probabili/indisponibili snapshot
python -m euroleghe_ingest matchdays                     # euro <-> real calendar map (+ cross-check)
python -m euroleghe_ingest synth                         # calibrate rating -> Mv, fill mv_synth

python -m euroleghe_ingest snapshot --platform euro --game mantra   # today's auction sheet
python -m euroleghe_ingest export                        # the app's data bundle + manifest
python -m euroleghe_ingest backtest --gate               # the out-of-sample gate harness (read-only)
```

Every network module is resumable (the raw cache is the source of truth) and interruptible; `rebuild`
re-ingests everything offline. Every run leaves a line in `ingest_runs` (module, when, status, options).

## Weekly, and it cannot be caught up later

```bash
pwsh ../scripts/weekly-snapshot.ps1 -Register     # Friday 12:00, current user, no admin needed
```

The probabili-formazioni page shows only "now" and has no archive, so a week nobody snapshotted is
gone for good - which is why the gate reports `starter_prob` as 0/1453 on past windows. R7 is
pre-registered in its weekly-snapshot form and can only be tested once enough weeks exist.

⚠️ **The job runs `fc_site` only, so it does NOT accumulate the granular real role.** `player_roles` is
the third fact of the same class - the provider serves only "now" - and today it is observed only when
somebody runs `snapshot`. A week without a `snapshot` run is a week `player_roles` will not have, and no
later command can recover it. Adding `positions --layer roles` to the weekly job (~80 requests, ~2
minutes, and free if `snapshot` already ran that day because the cache is keyed by the observation date)
is what would close it; it is deliberately left as a decision rather than done quietly inside a
scheduled task.

## The auction sheet (`snapshot`)

```bash
python -m euroleghe_ingest snapshot --platform euro --game mantra
python -m euroleghe_ingest snapshot --platform default --game classic --no-refresh
```

Run it on the day you prepare an auction. It refreshes the probabili/indisponibili (a state that only
exists *now*), then writes `data/reports/auction-snapshot-<season>-<platform>-<game>-<date>/` with
`players.csv`, `clubs.csv` and `manifest.json`.

The header splits the sheet in two, on purpose:

- **`engine_*`** - the valuation the gate validated: predicted fantamedia, expected appearances, VALUE,
  SURPLUS, the role's replacement level, rank in role. Produced by calling `engine/` with the ADOPTED
  rule set and parameters fitted on a window that is not the season being priced.
- **`desc_*`** - DESCRIPTIVE and **not gated**: form over the last 10 matches, expected minutes,
  starting duels, injury propensity (matches missed, recency-weighted), penalty duty, bonus propensity
  per 90, cards per appearance, contract situation. For the human reading the sheet. Turning any of it
  into a coefficient needs a pre-registered gate run.

What no source states is reported as not measurable rather than invented: the player's relationship
with the club (only proxies exist), set-piece duty beyond penalties (`assists_set_piece` is NULL at the
source), the coach's ideas (what is measured is who he is, since when, whether he is new, today's
formation and the lines the club actually fielded). The auction date is `min(the season's 15 August,
today)`, so a dry run on a finished season cannot read the future it pretends not to know.

## The app's bundle (`export`)

```bash
python -m euroleghe_ingest export                    # data/export/<season>/
python -m euroleghe_ingest export --season 2026-27   # once its listone is out
```

Writes `bundle.sqlite` (a pruned copy with the same schema), `json/*.json.gz` (one file per table, for
a runtime without SQLite), a copy of `config/`, and `manifest.json`. The table list is derived from
what `engine/features.py` actually queries - a rule that reads a new table has to be added to the
contract - and the manifest carries the provenance (commit, timestamp, seasons), which prices are
auction-safe, the provisional parameters with their values, and the known gaps. `--no-verify` skips the
integrity check on what was written; do not use it.

The bundle carries the same paid fantacalcio.it content the cache does, so `data/export/` is
gitignored: it ships with the app, never through git.

## Pipeline (`rebuild` order)

`rosters` (always first) -> `stats` -> `ratings` -> `matchdays` -> `fc_site` -> `transfers` ->
`injuries` -> `fbref` (stub) -> `positions` -> `recent_form` -> `synth` -> `arrivals` ->
`tournaments` -> `elo` -> `validate`.

`rebuild` skips the network modules and replays their cache instead, in the order their outputs depend
on each other; that is why a rebuild is offline and still complete.

## Domain whitelist (network)

`fantacalcio.it` and subdomains · `api.clubelo.com` · `fbref.com` (403 Cloudflare) ·
`transfermarkt.com/.it` · `query.wikidata.org` · `sofascore.com` + `api.sofascore.com`.

## Tests

```bash
toolkit/.venv/Scripts/python -m pytest -q      # 231 tests
toolkit/.venv/Scripts/python -m ruff check .
```

No test touches the network: every parser is exercised on fixtures, and the modules that fetch take a
`fetch=False` / cache-only path.
