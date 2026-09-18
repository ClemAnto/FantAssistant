/**
 * verify-parsers.mjs - runs the Sheet's parsers against SAVED pages, outside Google.
 *
 *   node scripts/gas/verify-parsers.mjs <folder with the saved pages>
 *
 * WHY IT EXISTS. `probe()` answers the half that can only be answered from Google: do these sites
 * serve a Google server at all. This answers the other half, which is the one that will actually
 * break: do the expressions written today still read the markup of today. A site rebuild does not
 * announce itself - it turns a parser into "0 clubs", and the capture then refuses to write, which is
 * the right behaviour and still a round lost. Running this against the last photographs says which
 * source moved and what its markup looks like now.
 *
 * THE FIXTURES ARE NOT IN THE REPOSITORY and must never be: they are the same paid content the
 * toolkit's cache holds, and this repo is public. Take them from the Drive folder the Sheet fills
 * ("FantAssistant - probabili", one gzipped page per source per capture) or save them by hand:
 *
 *   probabili.html   fantacalcio.it/probabili-formazioni-serie-a
 *   sky.html         sport.sky.it/calcio/serie-a/probabili-formazioni
 *   cds.html         corrieredellosport.it/probabili-formazioni/calcio/serie-a
 *   sosl.html        sosfanta.com/lista-formazioni/probabili-formazioni-serie-a/
 *   voti_<N>.html    fantacalcio.it/voti-fantacalcio-serie-a/<season>/<N>   (one or more played rounds)
 *
 * WHAT IT ASSERTS, and every number below was measured on the pages of 18/09/2026 before the Sheet
 * was written: twenty clubs per source, ELEVEN starters each, a shape for every club, the truth page
 * exact at eleven per club and 220 in total, ten fixtures with their kick-off instants from two
 * independent readers, and the club keys of the three sources joining 20/20.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/gas/verify-parsers.mjs <folder with the saved pages>');
  process.exit(2);
}

const script = fs.readFileSync(path.join(import.meta.dirname, 'probabili-sheet.gs'), 'utf8');

// The Apps Script globals the parsers touch. Deliberately minimal: anything the parsers needed from
// Google beyond these would be a parser that cannot be verified here, which is a reason to change it.
const sandbox = {
  Logger: { log: () => {} },
  Utilities: { formatString: (f, ...a) => String(f).replace(/%s/g, () => a.shift()) },
  Session: { getScriptTimeZone: () => 'Europe/Rome' },
  SpreadsheetApp: {}, DriveApp: {}, ScriptApp: {}, UrlFetchApp: {}, console,
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox);

const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const has = (f) => fs.existsSync(path.join(dir, f));

let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.log('  FAILED: ' + msg); } };
const perClub = (rows) => rows.reduce((m, r) => (m[r.clubKey] = (m[r.clubKey] || 0) + 1, m), {});

console.log('=== the three probabili parsers ===');
const keys = {};
for (const [label, file, fn] of [
  ['fantacalcio.it', 'probabili.html', 'parseFantacalcio_'],
  ['sport.sky.it', 'sky.html', 'parseSky_'],
  ['corrieredellosport.it', 'cds.html', 'parseCorriere_'],
  ['sosfanta.com', 'sosl.html', 'parseSosfanta_'],
]) {
  if (!has(file)) { console.log(`${label}: ${file} not in the folder - skipped`); continue; }
  const rows = sandbox[fn](read(file));
  const per = perClub(rows);
  const clubs = Object.keys(per);
  const elevens = clubs.filter((c) => per[c] === 11).length;
  const withShape = new Set(rows.filter((r) => r.formation).map((r) => r.clubKey)).size;
  const withId = rows.filter((r) => r.fcId).length;
  keys[fn] = new Set(clubs);
  console.log(`${label.padEnd(24)} rows ${String(rows.length).padStart(4)} | clubs ${String(clubs.length).padStart(2)}`
    + ` | clubs with 11 ${String(elevens).padStart(2)} | with fc_id ${String(withId).padStart(4)} | with a shape ${withShape}`);
  check(clubs.length === 20, `${label}: expected 20 clubs, read ${clubs.length}`);
  check(elevens === 20, `${label}: expected 20 clubs with exactly 11 starters, read ${elevens}`);
  check(withShape === 20, `${label}: expected 20 clubs carrying a shape, read ${withShape}`);
}

if (keys.parseFantacalcio_) {
  // Every source that was actually read, not a hard-coded three: a club key that joins on three
  // sources and not on the fourth is exactly the failure this check exists for.
  const names = Object.keys(keys);
  const shared = [...keys.parseFantacalcio_].filter((k) => names.every((f) => keys[f].has(k)));
  console.log(`\nclub keys shared by all ${names.length} sources read: ${shared.length}/20`);
  check(shared.length === 20, `the club keys do not join: ${shared.length}/20 - look at CLUB_ALIASES`);
}

console.log('\n=== identity: the two sources without our key, resolved against fantacalcio ===');
if (has('probabili.html')) {
  const index = sandbox.rosterIndex_(read('probabili.html'));
  const ambiguous = Object.values(index).reduce((n, o) => n + Object.values(o).filter((v) => !v).length, 0);
  console.log(`index: ${Object.keys(index).length} clubs | ${Object.values(index).reduce((n, o) => n + Object.keys(o).length, 0)} tokens`
    + ` | ${ambiguous} tokens claimed twice and therefore refused`);
  for (const [label, file, fn] of [['sport.sky.it', 'sky.html', 'parseSky_'],
    ['corrieredellosport.it', 'cds.html', 'parseCorriere_'],
    ['sosfanta.com', 'sosl.html', 'parseSosfanta_']]) {
    if (!has(file)) continue;
    const rows = sandbox[fn](read(file));
    const missed = rows.filter((r) => !sandbox.resolve_(index, r.clubKey, r.player));
    const rate = (1 - missed.length / rows.length) * 100;
    console.log(`${label.padEnd(24)} ${rows.length - missed.length}/${rows.length} resolved (${rate.toFixed(1)}%)`
      + (missed.length ? ` | unresolved: ${missed.map((r) => r.clubKey + '/' + r.player).join(', ')}` : ''));
    // 97% was the measured figure on 18/09/2026 once the index was built over the whole squad and
    // names were compared by token. A fall below it means a site changed how it spells people, and
    // an unresolved name reads as a MISS - i.e. it would quietly punish that source.
    check(rate >= 95, `${label}: only ${rate.toFixed(1)}% of the names resolve to an fc_id`);
  }
}

console.log('\n=== the guard in front of the fetch ===');
// Stubbing UrlFetchApp and NOT fetch_, because stubbing fetch_ is what let a real defect through: on
// its first run from Google the truth page was refused as "200 without elevens", the shape guard being
// the right instrument for a line-up page and the wrong one for a table of grades. A bench that
// replaces the function holding the guard cannot see the guard.
{
  const serve = (html) => { sandbox.UrlFetchApp = { fetch: () => ({
    getResponseCode: () => 200, getContentText: () => html }) }; };
  for (const [label, file, expected] of [
    ['a line-up page', 'probabili.html', true],
    ['the truth page with the default guard', 'voti', false],
    ['the truth page as truth_ asks for it (no shape guard)', 'voti', true],
  ]) {
    const name = file === 'voti'
      ? fs.readdirSync(dir).filter((f) => /^voti_\d+\.html$/.test(f))[0] : file;
    if (!name || !has(name)) { console.log(`${label}: no fixture - skipped`); continue; }
    serve(read(name));
    const got = label.indexOf('no shape guard') >= 0
      ? sandbox.fetch_('https://example/x', 0)
      : sandbox.fetch_('https://example/x');
    console.log(`${label}: ${got.ok ? 'accepted' : 'refused (' + got.why + ')'}`);
    check(got.ok === expected, `${label}: expected ${expected ? 'accepted' : 'refused'}`);
  }
}

console.log('\n=== the truth ===');
for (const file of fs.readdirSync(dir).filter((f) => /^voti_\d+\.html$/.test(f)).sort()) {
  const round = file.match(/(\d+)/)[1];
  const html = read(file);
  sandbox.fetch_ = () => ({ ok: true, why: '', html });
  const t = sandbox.truth_('2026-27', round);
  const per = perClub(t.rows);
  console.log(`round ${round}: ok=${t.ok} | clubs ${t.clubs} | starters ${t.rows.length}`
    + ` | distinct ids ${new Set(t.rows.map((r) => r.fcId)).size}${t.ok ? '' : ' | ' + t.why}`);
  check(t.ok, `truth round ${round}: ${t.why}`);
  check(t.rows.length === 220, `truth round ${round}: expected 220 starters, read ${t.rows.length}`);
  check(Object.values(per).every((n) => n === 11), `truth round ${round}: some club is not on eleven`);
}

console.log('\n=== the schedule, from independent readers ===');
const cals = {};
for (const [label, fn, file] of [['corriere', 'fromCorriere_', 'cds.html'],
  ['sky', 'fromSky_', 'sky.html'], ['sosfanta', 'fromSosfanta_', 'sosl.html']]) {
  if (!has(file)) continue;
  sandbox.fetch_ = () => ({ ok: true, why: '', html: read(file) });
  const cal = sandbox[fn]();
  cals[label] = cal;
  console.log(`${label.padEnd(10)} ${cal.length} fixtures`
    + (cal.length ? ` | first ${cal[0].home} vs ${cal[0].away} at ${cal[0].kickoff.toISOString()}` : ''));
  check(cal.length === 10, `${label}: expected 10 fixtures, read ${cal.length}`);
}
{
  // Readers that do not agree on an instant are a reason to look, not to average: the capture is
  // timed on this number and a wrong one misses a kick-off by hours. SOS Fanta is the interesting one
  // here because it states the instant as an ISO attribute while the other two are parsed out of
  // Italian prose - so their agreement is evidence about the PARSING, not just about the sites.
  const first = Object.keys(cals).filter((k) => cals[k].length)
    .map((k) => [k, cals[k][0].kickoff.getTime()]);
  const same = first.length > 1 && first.every((p) => p[1] === first[0][1]);
  console.log(`the ${first.length} readers agree on the first kick-off: ${same ? 'yes' : 'NO'}`
    + (same ? '' : ' -> ' + JSON.stringify(first.map((p) => [p[0], new Date(p[1]).toISOString()]))));
  check(first.length < 2 || same, 'the schedule readers disagree on the first kick-off instant');
}

console.log(failed ? `\n### ${failed} CHECK(S) FAILED ###` : '\n### all checks passed ###');
process.exit(failed ? 1 : 0);
