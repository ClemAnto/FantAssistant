/**
 * verify-odds.mjs - runs `odds.gs`'s parsers against SAVED oddschecker pages, outside Google.
 *
 *   node scripts/gas/verify-odds.mjs <folder>
 *
 * The folder holds `league.html` (an oddschecker.com/it league page) and any number of `match*.html`
 * (match pages). Not in the repository: they carry bookmakers' prices and this repo is public. Save them
 * with any plain GET - the pages are server-rendered.
 *
 * WHAT IT ASSERTS, measured on the pages of 08/10/2026: the league page lists its matches with a
 * kick-off and a path; every match page yields both sides, at least ten scorers priced by at least five
 * books each, and a clean-sheet price for both sides.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/gas/verify-odds.mjs <folder>');
  process.exit(2);
}

const sandbox = { Logger: { log: () => {} }, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(import.meta.dirname, 'odds.gs'), 'utf8'), sandbox);

let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.log('  FAILED: ' + msg); } };

const league = path.join(dir, 'league.html');
if (fs.existsSync(league)) {
  const matches = sandbox.oddsMatches_(fs.readFileSync(league, 'utf8'));
  console.log(`league page: ${matches.length} matches, first ${JSON.stringify(matches[0])}`);
  check(matches.length >= 9, 'fewer than nine matches listed');
  check(matches.every((m) => /^\/it\/calcio\//.test(m.path) && !Number.isNaN(Date.parse(m.start))), 'a match without path or kick-off');
}

for (const file of fs.readdirSync(dir).filter((f) => /^match.*\.html$/.test(f))) {
  const grids = sandbox.oddsGrids_(fs.readFileSync(path.join(dir, file), 'utf8'));
  check(!!grids, `${file}: no odds grid`);
  if (!grids) continue;
  const rows = sandbox.oddsRows_('serie_a', { name: file, start: '' }, grids, 'now');
  const goals = rows.filter((r) => r[8] === 'goal');
  const clean = rows.filter((r) => r[8] === 'clean_sheet');
  console.log(`${file}: ${grids.home} v ${grids.away} | ${goals.length} scorers, books ${Math.min(...goals.map((r) => r[13]))}-${Math.max(...goals.map((r) => r[13]))} | clean sheet ${clean.map((r) => `${r[9]} ${r[11]} (${r[13]} books)`).join(', ')}`);
  console.log('   top scorers: ' + goals.sort((a, b) => a[11] - b[11]).slice(0, 4).map((r) => `${r[10]} ${r[11]}`).join(' · '));
  check(goals.length >= 10, `${file}: fewer than ten scorers`);
  check(goals.filter((r) => r[13] >= 5).length >= 10, `${file}: fewer than ten scorers priced by five books`);
  check(clean.length === 2, `${file}: clean sheet missing on a side`);
}

console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
