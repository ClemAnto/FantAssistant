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

// ================================================================================================
// The deadline: one photograph per round, taken before the round opens
// ================================================================================================
//
// These need no saved page, so they run on every invocation. They are here and not only in the head
// comment because the rule they describe is the one thing in this file that a future edit can undo
// without the parsers noticing: `chosenTakes_` is where "which reading counts" is decided, and a
// per-club deadline and a per-round one differ ONLY on the clubs that play later than the opener.
//
// The fixture is built so the two answers are different: Sunday's club has a reading taken on Sunday,
// fifteen minutes before its own kick-off. Under the old rule that reading is the one that counts;
// under the operator's rule of 21/09/2026 it is taken while the round is being played and counts for
// nothing. So a regression to the old definition fails the very first assertion below.
console.log('\n=== the deadline is the round opener, for every club ===');
{
  const H = ['round', 'season', 'source', 'club', 'club_key', 'formation', 'fc_id', 'player', 'role',
    'probability', 'starter', 'taken_at_utc', 'kickoff_utc', 'lead_min'];
  const OPENER = '2026-09-18T18:45:00Z';       // Friday 20:45 local - the round's first kick-off
  const SUNDAY = '2026-09-20T16:00:00Z';
  const row = (club, kickoff, taken) => {
    const r = new Array(14).fill('');
    r[0] = 5; r[1] = '2026-27'; r[2] = 'fantacalcio.it'; r[3] = club; r[4] = club;
    r[6] = '1'; r[7] = 'Tizio'; r[10] = 1; r[11] = taken; r[12] = kickoff;
    return r;
  };
  const values = [H,
    row('monza', OPENER, '2026-09-18T18:30:00Z'),      // 15 min before the opener
    row('roma', SUNDAY, '2026-09-18T18:30:00Z'),       // same photograph, a club playing on Sunday
    row('roma', SUNDAY, '2026-09-20T15:45:00Z'),       // 15 min before ROMA's kick-off: too late now
  ];
  const chosen = sandbox.chosenTakes_(values);
  const used = (club) => {
    const c = chosen['5|fantacalcio.it|' + club];
    return c && c.use === null ? null : new Date(c.use).toISOString();
  };
  console.log(`monza -> ${used('monza')}`);
  console.log(`roma  -> ${used('roma')}   (la lettura della domenica non conta)`);
  check(used('roma') === '2026-09-18T18:30:00.000Z',
    'a reading taken after the round opened is still being scored - the deadline is not the opener');
  check(used('monza') === '2026-09-18T18:30:00.000Z', 'the opener club lost its pre-opener reading');
  // The pruner reads the same definition, so what it keeps must be what the scorer uses - otherwise
  // Sunday's prune deletes Friday's photograph and the round loses every prediction it had.
  check(new Date(chosen['5|fantacalcio.it|roma'].keep).toISOString() === '2026-09-18T18:30:00.000Z',
    'the pruner would keep a reading the scorer does not use');

  // A round nobody could attach a kick-off to has no opener, and there a prediction must survive.
  const blind = [H, row('lecce', '', '2026-09-18T18:30:00Z'), row('lecce', '', '2026-09-20T15:45:00Z')];
  const bc = sandbox.chosenTakes_(blind)['5|fantacalcio.it|lecce'];
  check(bc && bc.use !== null && new Date(bc.use).toISOString() === '2026-09-20T15:45:00.000Z',
    'a round with no kick-off on any row lost its readings instead of keeping the newest');

  // And the opener is per ROUND, read from the rows: the earliest kick-off, whichever club carries it.
  const openers = sandbox.openerIndex_(values);
  check(openers[5] === new Date(OPENER).getTime(), 'openerIndex_ did not read the round opener');
}

console.log(failed ? `\n### ${failed} CHECK(S) FAILED ###` : '\n### all checks passed ###');
process.exit(failed ? 1 : 0);
