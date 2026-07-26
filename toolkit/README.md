# euroleghe-ingest

Data ingestion toolkit (roadmap task 1.0). Python + SQLite. Produces `data/euroleghe.db` +
normalized CSVs, read by the app's `prediction-engine`.

Reference spec: `spec-euroleghe-ingest-v9.md` on Drive (see [../docs/DRIVE-MANIFEST.md](../docs/DRIVE-MANIFEST.md)).

## Principles (spec v9)

1. Raw files (Drive) = source of truth; the **DB is always rebuildable from scratch** (idempotent `rebuild`).
2. The prediction engine reads only from the normalized data.
3. `fc_id` = **primary key**; the other sites live in `player_xref`/`club_xref`.
4. No mandatory manual step; ambiguous cases downgrade a tier.
5. The toolkit knows what it is missing (manifest); the network is an optimization.
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
  Serie A gets the full season from `default`; the other 4 leagues from **FBref** (facts) + **Sofascore**
  (per-match rating + heatmaps), with a **calibrated** synthetic base-voto (fitted on the euro/real overlap,
  not fixed buckets) in a source-tagged `external_stats` layer that never contaminates the `euro` target.
- **euro<->real matchday map** is **per league**: one euro round bundles a *different* real round in each of
  the 5 leagues -> `matchday_map(season, euro_md, league, real_md)`.

## UI (operator panel)

The toolkit opens a **lightweight window** (Tkinter, stdlib - no extra dependency) to launch the
operations with a live log and DB status:

```bash
python -m euroleghe_ingest          # no command -> opens the window
python -m euroleghe_ingest gui      # explicit equivalent
```

After `pip install -e .` the console-less executable `euroleghe-ingest-gui` is also available
(good for double-click / a desktop shortcut). From the repo root, `toolkit-start.cmd` does the same.

## Commands (CLI)

```bash
python -m euroleghe_ingest --help
python -m euroleghe_ingest initdb           # apply the schema to an empty DB
python -m euroleghe_ingest rebuild          # rebuild the whole DB from raw files (idempotent)
python -m euroleghe_ingest fetch --plan     # compute the needs -> whitelist_request.md
python -m euroleghe_ingest rosters          # run a single module
python -m euroleghe_ingest validate         # integrity checks
```

## Pipeline (`rebuild` order)

`fetch` (network) -> `rosters` (always first) -> `stats` -> `ratings` -> `fc_site` -> `transfers` ->
`fbref` -> `positions` -> `arrivals` -> `tournaments` -> `elo` -> `validate`.

## Suggested first pass (no network)

`rosters` + `stats` + `validate` + `rebuild` on the 3 seasons already in the vault (`data/raw/`),
then `fetch --plan` to generate `whitelist_request.md` to forward to the workspace administrator.

## Domain whitelist (network)

`fantacalcio.it` and subdomains · `api.clubelo.com` · `fbref.com` · `transfermarkt.com/.it` ·
`query.wikidata.org` · `sofascore.com` + `api.sofascore.com`.
