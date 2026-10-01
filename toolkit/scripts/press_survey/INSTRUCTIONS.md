# Task: season-long role of every player of your clubs - the date is the survey date

Working folder: `data/reports/press_survey/` (or `$PRESS_SURVEY_DIR`) - gitignored, it carries names and FVM.
- `briefs/<Club>.txt` = your starting data, already scraped TODAY from TWO structured sources:
  * **Transfermarkt** (TM): squad, league and all-competition appearances/starts/sub-ons/minutes for 2026-27, the
    same for 2025-26 at this club, injuries with TM's expected return date.
  * **FotMob**: squad list, positions, injury flag with FotMob's own expected-return wording.
  * FVM and role come from the fantacalcio.it listone being surveyed (EuroLeghe or Serie A; the day it was read is
    in your task). "CEDUTO" = the listone marks him sold (asterisk).
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
   (sample is small: 5-7 league games), last season at the club, the coach's system, press "formazione tipo"/
   predicted season XI articles, transfer context (a big signing is expected to start). An injured player is
   classified by what he is WHEN FIT (plus the injury block). THE WORDS ARE THE PROJECT'S OWN LADDER (operator,
   01/10/2026: one ladder everywhere, the one the expected-appearances formula is calibrated on) - write exactly
   these six and no other word; the percentages are of the LEAGUE matches he is fit for:
   - `bandiera`: in the season XI, plays EVERY league match when fit (>90%) and almost always the whole match
     (>=75' a game). Whether he also plays the cups goes in the note.
   - `titolare`: in the season XI, plays almost every league match (>80%) for most of it (>=65'), but is rested
     or substituted now and then. Nobody takes his place.
   - `ballottaggio`: disputes ONE specific place of the season XI with one or two named teammates. MANDATORY: list
     the rivals and give each contender's estimated % of league starts for that place (the shares of one place
     sum to ~100, e.g. 60/40). Mark ALL contenders of that place as `ballottaggio` with consistent numbers.
   - `panchina`: 12th-15th man, NOT in the season XI and with no single direct rival: plays often (roughly half
     to four fifths of the league matches) by starting sometimes or coming on most weeks, without certainties.
   - `riserva`: comes on now and then (roughly 10-50% of the matches, low minutes), rare starts.
   - `scarto`: almost never plays (<10%): third keeper, out of the project, youth players only registered.
   - Goalkeepers: the league #1 = `bandiera` (even when a cup keeper plays the cups); a #1 who is really rotated in
     the league = `ballottaggio` with his rival; the cup keeper and the unused #2 = `riserva`; #3 = `scarto`.
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
     "tier": "bandiera|titolare|ballottaggio|panchina|riserva|scarto",
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
