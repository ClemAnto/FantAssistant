# app/ - final assistant (initialized 09/08/2026)

The **auction assistant app**: Angular 22 + ng-zorro + Tailwind v4, with the `prediction-engine` still
to be ported. The Angular workspace is this folder - there is no `client/` sub-folder.

```bash
npm install
npm run data:pull    # copy the newest data/export/<season>/ into public/data (gitignored)
npm start            # dev server on http://localhost:4200
npm run build        # the check that must pass before delivering a change
```

Conventions are in [CLAUDE.md](CLAUDE.md) - read it before writing a component or touching a style.

## What exists today

- **`views/players`** - the consultation table: name, role, Mantra role, current club and one column per
  matchday (the last ten of the chosen period). Each cell carries the vote - the fantacalcio one, or the
  calibrated synthetic one marked `~` - with compact goal/assist icons, and a tooltip with the fixture,
  the score, the side and the minutes played. Filters: role, club, season, matchday window, sort.
  Serie A (`platform = default`) only for now: on `euro` a matchday is a EuroLeghe round and the join to
  the provider's per-match layer has to go through `matchday_map`.
- **`views/hello`** - the smoke page that proves the theme, the tokens and ng-zorro are wired.
- **`core/bundle.ts`** - the only data source. See the contract below.

Two things about the data the page shows, worth stating because they are not obvious:
`match_ratings.minutes` is empty in the bundle, so the **minutes come from the provider's per-match
layer** (`external_match_stats`, joined on `fc_id, season, real_md` - 11,866 of 12,686 rows match on
Serie A 2025-26); and the **scoreline is derived inside `match_ratings`** (goals + converted penalties
for, the goalkeeper's conceded against) rather than by matching club names across sources, because a
name join is what once lost Milan, Roma and Napoli from a measurement.

## What it will still contain (from the parent doc §7 and §2-bis)

- `prediction-engine/` - the TypeScript engine: Mantra formula + per-league parameter configuration,
  goalkeeper M2e module (ability + the club's measured conceded rate - it does not read `club_elo`),
  expected appearances, flag/arrivals layer. A **port of
  `toolkit/euroleghe_ingest/engine/`**, which is kept dependency-free and explicit for exactly that
  reason (`engine/__init__` says so).
- **Explainability layer**: every rule is a triplet *condition -> delta -> text template*; output
  `PlayerCard` with predicted FM, expected appearances, VALUE = FM x appearances, reliability,
  a 7-dimension profile and drivers ranked by impact.
- Electron/Angular UI with the 4 roster-recompute moments (end of season, summer,
  August/friendlies, January/repair window).

## Contract with the toolkit — this part EXISTS

The toolkit is the engine's only data source: no app-side scraping. The interface is not "the whole
database" any more, it is the **bundle**:

```bash
python -m euroleghe_ingest export                    # -> data/export/<season>/
python -m euroleghe_ingest export --season 2026-27   # once its listone is out
```

```
data/export/<season>/
  bundle.sqlite          pruned copy of the DB, SAME schema (db/schema.sql), ~39 MB
  json/<table>.json.gz   one file per table: {table, columns, rows[]} - for a runtime without SQLite
  config/                scoring_config.json + league_config.json, as they were at export time
  manifest.json          the part to read before using any of it
```

Read `manifest.json` first, and treat it as normative:

- `schema_version` - refuse a bundle whose version you do not know rather than guess.
- `price_discipline` - **`price_initial` (Qt.I) is the only price a rule may read.** `price` (Qt.A) is
  revised all season and `fvm` is end-of-season, so for a past season both embed the outcome. They are
  in the bundle because the UI legitimately shows them.
- `provisional_parameters` - constants that exist because a module needed a number, with their values.
  Do not present them as established, and do not tune them outside a pre-registered sweep.
- `known_gaps` - what is missing and cannot be reconstructed. Two matter for the UI: the
  starting-probability history is thin (the site publishes only "now"), and `exit_risk` is a snapshot
  of today, so it must never be shown as a historical fact.
- `heavy_seasons` - the per-match tables travel for these seasons only. It covers the input season AND
  the input season of the cross-fit window, because the coefficients are fitted there.
- `adopted_rules` - the rule set the engine ships, per platform. Coefficients live in the gate report,
  not here: a coefficient without its platform, its residual baseline and its date is not a fact.

The contract is **derived from what `engine/features.py` queries**, table by table
(`modules/export.py:CONTRACT`), and it is checked the only way that proves anything: pointing the gate
harness at the bundle and comparing its output to the DB's, character for character. If the ported
engine needs a table the bundle does not carry, add it to `CONTRACT` - do not read around it.

⚠️ The bundle carries the same paid fantacalcio.it content the cache does ("NON PUO' ESSERE RIPRODOTTO
NE' PUBBLICATO"), so `data/export/` is gitignored and this repository is public. It ships with the app,
never through git.

## What the app still needs from the engine side

A **live mode**. Every path in the harness assumes an outcome exists: `_window_is_usable` wants at
least 50 actual fantamedie, the Auction view lists finished seasons only, `auction_view` compares two
lists. An auction needs **one list**. That is the open work, and it is not the toolkit's.

## When we start

The toolkit's side is done (spec «Novità v9.4»): the bundle exists, is verified, and the whole database
rebuilds from zero on a new machine. The next step here is picking the Angular/Electron scaffolding and
porting `engine/model.py` + `engine/features.py` against `bundle.sqlite`.
