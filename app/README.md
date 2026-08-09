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

## The published site

**https://clemanto.github.io/FantAssistant/** - `npm run deploy:pages`, from this machine.

```bash
MSYS_NO_PATHCONV=1 npm run deploy:pages   # the env var is a Git Bash quirk: without it MSYS
                                          # rewrites --base-href /FantAssistant/ into a C:\ path
```

It **bumps the patch version** (every publish gets a number, and the header shows it), pulls the newest
export, builds with `--base-href /FantAssistant/` (the bundle rides along because
`public/` is an asset root), adds `404.html`, `.nojekyll` and `robots.txt`, and force-pushes the result
to the **`gh-pages`** branch as a single orphan commit - so the repository does not grow by 2.4 MB per
deploy. Pages serves that branch.

⚠️ **What goes online is the real bundle**: the toolkit's paid fantacalcio.it data, on a public URL that
anybody who finds it can download. That is the operator's decision of 09/08/2026, taken knowing that a
Pages site on a public repository is open to everyone and that `robots.txt` only asks crawlers to stay
away. The root `CLAUDE.md` records it as an exception to its own rule. `master` still never carries the
bundle and `data/export/` is still gitignored - the data lives on `gh-pages` alone.

**There is exactly one publisher, and it is this machine.** A CI job cannot do it (a runner has no
bundle), and a second publisher would republish the site without the data and wipe it. That is why the
Pages workflow was deleted rather than kept alongside.

To go back to a data-free site, `scripts/make-demo-bundle.mjs` still generates a demo bundle - 20
invented clubs, 500 invented players, two seasons of invented matches, fixed seed. It imitates the SHAPE
of the real one: circle-method fixtures, a team's goals handed to its own players and taken by the
opposing keeper as conceded, so the scoreline the page derives inside `match_ratings` comes out
consistent. Its manifest carries `demo: true` and the app puts a banner on the page when it reads it.

```bash
node scripts/make-demo-bundle.mjs dist/fantassistant/browser/data   # after a build, before publishing
```

## What exists today

- **`views/players`** - the consultation table: name, role, Mantra role, current club and one column per
  matchday (the last ten of the chosen period). Each cell carries the vote - the fantacalcio one, or the
  calibrated synthetic one marked `~` - with compact goal/assist icons, and a tooltip with the fixture,
  the score, the side and the minutes played. Filters: role, club, season, matchday window, sort.
  - **Both listoni.** `Serie A` (`platform = default`, 499 quoted players, 38 rounds) and `EuroLeghe`
    (`euro`, 925, 31 rounds). WHO is on a platform comes from `listone_quotes`, not from `rosters`: the
    latter holds one row per player while the two listoni are two different games. On `euro` a matchday
    is a EuroLeghe round, so the join to the provider's per-match layer goes through `matchday_map`,
    per league - 16,414 of 16,661 rows match on 2025-26.
  - **Cups and friendlies in the columns.** A cup has no matchday, so switching them on changes the unit
    of a column from a matchday to a MATCH: the player's last ten, by date. Neither carries a fantacalcio
    vote and neither has a synthetic one - they are not calibrated competitions, `mv_synth` is null on
    every single row - so all they can show is the provider's own 1-10 rating, marked `*` and left
    uncoloured because the bands belong to the other scale. A `·` means the match is on file with
    nothing measurable on it.
  - **Of national teams there is nothing.** Not thin: absent. No national-team competition exists in the
    per-match layer, so there is no toggle for it - a note on the page says so, which is better than an
    empty column that reads as "he did not play".
  - **A cell with no vote says WHY.** Five states, one icon each, no red - an injury is a fact
    about a player, not a failure: in campo senza voto, in panchina (his provider row exists
    with no minutes), infortunato (a dated spell covers the day the round was played), non in
    questo campionato, non risulta in distinta. Measured on Serie A 2025-26 over the 499 quoted
    men x 38 rounds: 45.9% played or s.v., 14.9% bench, 24.6% never in that championship (123
    men of 499), 7.6% injured, and only **6.9%** genuinely unaccounted for - which is what the
    last icon says, instead of a reason nobody has. The order is deliberate: "not in this
    league" outranks "injured", because a Ligue 1 man's injury has no business reading as a
    missed Serie A round. Absences appear in the matchday mode only: in "last matches" a column
    is a match he PLAYED.
  - **Dedicated components for the roles and the clubs** (`ui/role-badge`, `ui/club-crest`):
    one colour per code, white text, always the same shape - a circle for one character, a pill
    for two or three. The crests are MONOGRAMS: no crest image exists anywhere in the toolkit's
    data, and the app reads the bundle and never the web, so the real badges would be a
    decision about what this app may fetch, not a detail to slip in.
  - **Clicking a cell opens the match**: competition, the two teams with their marks, the
    scoreline, the minutes, and the bonus/malus with their points read from
    `config/scoring_config.json` - never hard-coded, because the scoring is per-championship
    parametric. The panel also checks its own arithmetic against the stored fantavoto and says
    so when the two disagree.
  - Coverage to state rather than average away: cups were acquired **from 2025-26** (1,071 Champions rows
    against 21 the season before) and friendlies are almost entirely the **2026-27 pre-season** (1,752
    rows, 321 of them with minutes).
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
