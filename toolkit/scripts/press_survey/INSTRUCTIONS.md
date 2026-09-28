# Task: season-long role of every player of your clubs (EuroLeghe) - the date is the survey date

Working folder: `data/reports/press_survey/` (or `$PRESS_SURVEY_DIR`) - gitignored, it carries names and FVM.
- `briefs/<Club>.txt` = your starting data, already scraped TODAY from TWO structured sources:
  * **Transfermarkt** (TM): squad, league and all-competition appearances/starts/sub-ons/minutes for 2026-27, the
    same for 2025-26 at this club, injuries with TM's expected return date.
  * **FotMob**: squad list, positions, injury flag with FotMob's own expected-return wording.
  * FVM and role come from the fantacalcio.it EuroLeghe listone (read 27/09/2026). "CEDUTO" = the listone marks him
    sold (asterisk).
- Do NOT use any project database. Transfermarkt cannot be fetched with WebFetch (already scraped for you); FBref,
  Sofascore, ESPN, kicker are blocked. Use WebSearch + WebFetch on OTHER sources.

## What to do, per club (be thorough - the operator explicitly asked NOT to rely on one platform)
1. **Roster verification**: check the squad against at least one more independent source (official club website
   squad page, the league's official site, Wikipedia "current squad", footballsquads.co.uk, reputable press on late
   transfers/loans up to the end of the summer window). Report players who left/arrived, loans out, players listed
   by one source and not another. Players who are no longer at the club go to `roster_discrepancies`, not `players`.
2. **Injuries**: for every player TM or FotMob mark injured (and any injury you find in press news), cross-check
   with at least one press/club source from the last 2 weeks. Give your best estimate of the RETURN DATE (ISO) and
   the sources. When sources disagree, say so and pick the most recent/authoritative (club statement > coach press
   conference > major outlet > aggregator). Also note suspensions.
3. **Season-long classification** (the TYPICAL season XI, NOT the next match). Use: this season's minutes shares
   (sample is small: 5-6 league games), last season at the club, the coach's system, press "formazione tipo"/
   predicted season XI articles, transfer context (a big signing is expected to start). An injured player is
   classified by what he is WHEN FIT (plus the injury block).
   - `titolarissimo`: in the season XI and plays practically always, league AND cups (>=85% of available minutes
     across competitions when fit). For a club with no European cup: >=90% league and plays the domestic cups too.
   - `titolare`: in the league season XI, starts >=70% of league games when fit, but rests / rotates in cups.
   - `comprimario`: 12th-15th man: starts sometimes (roughly 25-60%) or comes on from the bench almost every game;
     no single direct rival.
   - `ballottaggio`: disputes ONE specific place of the season XI with one or two named teammates. MANDATORY: list
     the rivals and give each contender's estimated % of league starts for that place (the shares of one place
     sum to ~100, e.g. 60/40). Mark ALL contenders of that place as `ballottaggio` with consistent numbers.
   - `riserva`: comes on now and then (roughly 10-35% of games, low minutes), rare starts (cups/rotation).
   - `scarto`: almost never plays (<10%): third keeper, out of the project, youth players only registered.
   - Goalkeepers: the #1 who also plays cups = titolarissimo; #1 in league with a cup keeper = titolare; the cup
     keeper = comprimario; the unused #2 = riserva; #3 = scarto.
4. For EVERY player give `start_pct` = estimated % of LEAGUE matches he will START when fit this season (integer).

## Output: write ONE JSON file per club to `out/<Club>.json` (exact club names as in the brief file name), UTF-8:
```json
{
  "club": "Juventus",
  "coach": "Luciano Spalletti",
  "module": "4-3-3",
  "typical_xi": ["Vicario", "Kalulu", "..."],
  "players": [
    {"tm_id": 123, "name": "Full Name", "fc_id": 456, "listone": "Kolo Muani", "role": "A",
     "tier": "titolarissimo|titolare|comprimario|ballottaggio|riserva|scarto",
     "start_pct": 90, "rivals": [{"name": "X", "start_pct": 40}],
     "note": "breve nota IN ITALIANO (perche' questo gradino)",
     "injury": null}
  ],
  "roster_discrepancies": [{"name": "...", "issue": "IN ITALIANO", "sources": ["url"]}],
  "sources": [{"name": "...", "url": "...", "used_for": "rosa|infortuni|formazione tipo"}],
  "source_notes": "IN ITALIANO: which sources agreed/disagreed and which you judged most reliable, with examples"
}
```
`injury` when present: `{"what": "IN ITALIANO", "since": "YYYY-MM-DD", "return_date": "YYYY-MM-DD" or null,
"return_text": "come lo dicono le fonti", "tm_return": "...", "fotmob_return": "...", "press": "...",
"sources": ["url"], "confidence": "alta|media|bassa"}`. Use `role` P/D/C/A from the listone when present, else
your best mapping. Keep `tm_id`/`fc_id` from the brief when available (null otherwise). Include every current
squad player (youth players with 0 minutes can be `scarto` with a one-line note). Validate the JSON by reading it
back with python before finishing. Notes must be short (max ~25 words). Your final message: 5-10 lines summary
(key findings, disagreements between sources) - not the JSON.
