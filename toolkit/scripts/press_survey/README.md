# Press survey: the season role of every EuroLeghe player, from several sources

Built 28/09/2026 on the operator's request («ignora il nostro DB e fai un'analisi approfondita sui siti più
affidabili ... per ogni calciatore come viene dichiarato nell'undici stagionale»). It produced the consultable
report `data/reports/rose-euroleghe-<date>.html`, the comparison with our sheet and `config/press_rungs.json`,
which the app can show and price instead of the sheet's rung (`core/player-rulings.ts`, Opzioni → Titolarità).
The method, the measurements and the refused variants: `docs/model/letture-app-v1.md` §55.

Everything these scripts WRITE goes to `data/reports/press_survey/` (or `$PRESS_SURVEY_DIR`) - and that is where the
work folder must stay: the 28/09 run kept it in a session scratchpad under %TEMP%, one cleanup away from losing the
raw agent files the report and the config are rebuilt from (copied back on 29/09). It carries names,
FVM and paid-source pages, and the repository is public. `$PRESS_SURVEY_DATE` (default 2026-09-28) is the survey
day; `$PRESS_SURVEY_LISTONE_READ` the day the listone was read (shown in the report).

## Which listone, and one ladder

`$PRESS_SURVEY_PLATFORM` = `euro` (default: the 37 EuroLeghe clubs, 28/09/2026) | `default` (the 20 clubs of the Serie A
listone, 01/10/2026). Give each its own work folder - the Serie A one is `data/reports/press_survey_serie_a/` - so one
survey never overwrites the other's raw files. `to_config.py` MERGES by club: the clubs of the report it reads are
rewritten, every other club keeps its rows, and each row carries its own `as_of` (the app shows a man's rung with the
day HIS club was read). Since 01/10/2026 the agents write the project's ONE ladder - bandiera, titolare, ballottaggio,
panchina, riserva - plus `scarto` under riserva; the 28/09 words `titolarissimo` and `comprimario` are converted to
`bandiera` and `panchina` when the file is rewritten (`docs/model/letture-app-v1.md` §55.6).

## Refreshing it, in order

1. `python listone.py` - perimeter and FVM from the cached EuroLeghe listone (run `snapshot` first so it is fresh).
2. `python tm_scrape.py` - Transfermarkt with curl (WebFetch cannot open it): squad usage per competition this season
   and last, injuries with expected return, fixtures. ~13 min, polite, stops after five refusals in a row.
3. `python fotmob.py` - the second structured source: squads, positions, injuries, coach.
4. `python build_briefs.py` - one brief per club (`briefs/<Club>.txt`), both sources side by side.
5. **The research**: one agent per 2-4 clubs, each following `INSTRUCTIONS.md` and writing `out/<Club>.json`.
   This is the part that is NOT a command - press, club statements and coaches' words, cross-checked by hand.
   A session has a cap of ~200 web searches: 12 agents exhausted it halfway on 28/09, so plan fewer searches or
   more fetches of known pages.
6. `python assemble.py --html` - the report; injured matches are counted on the club's TM calendar.
7. `python audit.py [--skip-league "Serie A"]` - completeness and consistency, read-only: who is buyable TODAY and
   has no rung, one listone id on two rows, the word against the agent's own share, XI men filed below
   `ballottaggio`, titolari plus contested places making eleven. Fix what it finds in `out/<Club>.json` (add a
   `revised` line saying why) and re-run step 6.
8. `python to_config.py` - writes `config/press_rungs.json`; then `export` and `npm run data:pull`.
9. `python compare.py` (with `compare_template.html`) - ours against the press.

## The experiments behind SHEET_REVISION 77

`run_variant.py NAME [key=value ...]` rebuilds one sheet on a PRIVATE copy of the DB (never the real one, never
the real sheet), with `presence` params overridden in memory, `tm=covered|top|all` for the historical fallback
variants, `notm=1` for the code before revision 77, and `date=` / `season=` / `league=` for back-dated sheets.
`score.py` judges a sheet against the press, `outcome.py` a back-dated one against what the men really did.
A baseline run reproduced the real sheet to the decimal before any variant was read.
