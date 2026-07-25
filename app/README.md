# app/ - final assistant (placeholder)

This is where the **auction assistant app** will live (Electron + Angular, TypeScript) with the
`prediction-engine`. **Not initialized yet**: the roadmap places it after the toolkit.

## What it will contain (from the parent doc §7 and §2-bis)

- `prediction-engine/` - the TypeScript engine: Mantra formula + per-league parameter configuration,
  goalkeeper M2e module, expected appearances, flag/arrivals layer. Reads ONLY from the normalized data
  produced by the toolkit (`data/euroleghe.db`) and the scoring configuration from `config/scoring_config.json`.
- **Explainability layer**: every rule is a triplet *condition -> delta -> text template*; output
  `PlayerCard` with predicted FM, expected appearances, VALUE = FM x appearances, reliability,
  a 7-dimension profile and drivers ranked by impact.
- Electron/Angular UI with the 4 roster-recompute moments (end of season, summer,
  August/friendlies, January/repair window).

## Contract with the toolkit

The toolkit is the engine's only data source: no app-side scraping. The interface = the schema of
`data/euroleghe.db` (see `toolkit/euroleghe_ingest/db/schema.sql`) + the normalized CSVs.

## When we start

After the toolkit's first pass (rosters + stats + validate + rebuild on the 3 seasons in the vault).
At that point we pick the Angular/Electron scaffolding and generate it here.
