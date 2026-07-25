# euroleghe-ingest

Data ingestion toolkit (roadmap task 1.0). Python + SQLite. Produces `data/euroleghe.db` +
normalized CSVs, read by the app's `prediction-engine`.

Reference spec: `spec-euroleghe-ingest-v8.md` on Drive (see [../docs/DRIVE-MANIFEST.md](../docs/DRIVE-MANIFEST.md)).

## Principles (spec v8)

1. Raw files (Drive) = source of truth; the **DB is always rebuildable from scratch** (idempotent `rebuild`).
2. The prediction engine reads only from the normalized data.
3. `fc_id` = **primary key**; the other sites live in `player_xref`/`club_xref`.
4. No mandatory manual step; ambiguous cases downgrade a tier.
5. The toolkit knows what it is missing (manifest); the network is an optimization.
6. Autonomy via authenticated scraping (credentials in the local `.env`, nowhere else).
7. `manual_overrides` = optional highest-precedence overrides.
8. Volatile states as **dated time series**, never static flags.

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
