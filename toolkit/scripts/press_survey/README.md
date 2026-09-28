# Press survey: the season role of every EuroLeghe player, from several sources

Built 28/09/2026 on the operator's request («ignora il nostro DB e fai un'analisi approfondita sui siti più
affidabili ... per ogni calciatore come viene dichiarato nell'undici stagionale»). It produced the consultable
report `data/reports/rose-euroleghe-<date>.html`, the comparison with our sheet and `config/press_rungs.json`,
which the app can show and price instead of the sheet's rung (`core/player-rulings.ts`, Opzioni → Titolarità).
The method, the measurements and the refused variants: `docs/model/letture-app-v1.md` §55.

Everything these scripts WRITE goes to `data/reports/press_survey/` (or `$PRESS_SURVEY_DIR`): it carries names,
FVM and paid-source pages, and the repository is public. `$PRESS_SURVEY_DATE` (default 2026-09-28) is the survey
day; `$PRESS_SURVEY_LISTONE_READ` the day the listone was read (shown in the report).

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
7. `python to_config.py` - writes `config/press_rungs.json`; then `export` and `npm run data:pull`.
8. `python compare.py` (with `compare_template.html`) - ours against the press.

## The experiments behind SHEET_REVISION 77

`run_variant.py NAME [key=value ...]` rebuilds one sheet on a PRIVATE copy of the DB (never the real one, never
the real sheet), with `presence` params overridden in memory, `tm=covered|top|all` for the historical fallback
variants, `notm=1` for the code before revision 77, and `date=` / `season=` / `league=` for back-dated sheets.
`score.py` judges a sheet against the press, `outcome.py` a back-dated one against what the men really did.
A baseline run reproduced the real sheet to the decimal before any variant was read.
