/**
 * LIVE check of the Formazione page (08/10/2026): drives `/lineup` under `ng serve` against the REAL Leghe
 * account in the repository's `.env` (FANTACALCIO_USERNAME / FANTACALCIO_PASSWORD, never printed):
 * EuroLeghe direct login, Leghe embedded login, then reads what the page shows. Read-only on Leghe.
 *
 *   npm start -- --port 4321          (in another shell)
 *   node scripts/e2e-lineup-live.mjs 4321
 *
 * Screenshots go to the OS temp folder: they carry the operator's roster and league names, and the
 * repository is public.
 *
 * FEW REQUESTS TO LEGHE (operator, 09/10/2026: «altrimenti la sicurezza ci blocca»). The browser profile is
 * KEPT between runs (`<temp>/e2e-lineup-live-profile`), so the page's local cache (`core/leghe-cache.ts`)
 * answers what it already read and a second run asks Leghe almost nothing - the two LOGINS stay, because the
 * tokens live in `sessionStorage` and die with the browser. `--fresh` empties the profile first, which costs
 * a whole cold pass per league: use it only when the cold path itself is what is being checked. Each league
 * prints how many requests its look cost, and the first league is opened AGAIN at the end: that look must
 * cost ZERO, or the cache is not doing its job.
 *
 *   node scripts/e2e-lineup-live.mjs 4321 [pacchetto-quote.json] [--fresh]
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FRESH = process.argv.includes('--fresh');
const PORT = ARGS[0] ?? '4321';
const URL0 = `http://localhost:${PORT}/lineup`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOTS = join(tmpdir(), 'e2e-lineup-live');
await mkdir(SHOTS, { recursive: true });

// Credentials from the repository's .env, the only place they live.
const ENV = {};
for (const line of readFileSync(join(import.meta.dirname, '..', '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m) ENV[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const USER = ENV.FANTACALCIO_USERNAME;
const PASS = ENV.FANTACALCIO_PASSWORD;
if (!USER || !PASS) throw new Error('FANTACALCIO_USERNAME / FANTACALCIO_PASSWORD missing in .env');

const prof = join(tmpdir(), 'e2e-lineup-live-profile');
if (FRESH) await rm(prof, { recursive: true, force: true });
await mkdir(prof, { recursive: true });
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--window-size=1400,1100', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const [port] = (await readFile(join(prof, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const frames = []; const problems = [];
const send = (method, params = {}, sessionId) => new Promise((r) => { const m = ++id; pending.set(m, r); ws.send(JSON.stringify({ id: m, method, params, sessionId })); });
let pageSession = null;
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown' && msg.sessionId === pageSession) problems.push('exception: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 200));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error' && msg.sessionId === pageSession) problems.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (msg.method === 'Target.attachedToTarget') {
    const s = msg.params.sessionId;
    send('Runtime.enable', {}, s);
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, s);
    frames.push({ s, type: msg.params.targetInfo.type });
  }
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evalIn = async (s, expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s)).result?.result?.value;
const ev = (expression) => evalIn(pageSession, expression);
const until = async (expression, ms = 20000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expression)) return true; await wait(250); } return false; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }, pageSession); await writeFile(join(SHOTS, name), Buffer.from(r.result.data, 'base64')); };
const type = async (s, selector, text) => { await evalIn(s, `document.querySelector(${JSON.stringify(selector)}).focus()`); await send('Input.insertText', { text }, s); };

// ---- THE ODDS CHECKS (operator, 08/10/2026: «controlla che le quote siano effettivamente quelle della
// prossima partita del turno di gioco»). Three questions, each answered against something the page did not
// compute itself: the kick-offs of all priced men fall in ONE matchday; every man of one Leghe fixture reads
// the SAME bookmakers' match; and the price on screen is the one oddschecker shows NOW (re-read here with
// odds.gs's own parsers, a few matches per league, within a tolerance because prices move).
const failures = [];
const fail = (msg) => failures.push(msg);
const PRICED = `[...document.querySelectorAll('[data-lineup-roster] li[data-fc-id]')].map((r) => {
  const cell = r.querySelector('[data-odds-match]');
  return {
    name: (r.children[1]?.innerText ?? '').split('\\n')[0].trim(),
    leghe: (r.children[2]?.innerText ?? '').split(' · ')[0].trim(),
    match: cell?.getAttribute('data-odds-match') ?? null,
    kickoff: cell?.getAttribute('data-odds-kickoff') ?? null,
    kind: cell?.getAttribute('data-odds-kind') ?? null,
    oddsName: cell?.getAttribute('data-odds-name') ?? null,
    side: cell?.getAttribute('data-odds-side') ?? null,
    price: cell ? Number(cell.getAttribute('data-odds-price')) : null,
  };
})`;
const sampled = new Map();   // odds match -> rows to re-price
function oddsChecks(league, rows) {
  const priced = rows.filter((r) => r.match);
  if (!priced.length) { fail(`league ${league}: no man priced at all`); return; }
  const times = priced.map((r) => Date.parse(r.kickoff));
  const span = (Math.max(...times) - Math.min(...times)) / 86400000;
  console.log(`  league ${league}: ${priced.length} priced, kick-offs ${new Date(Math.min(...times)).toISOString()} .. ${new Date(Math.max(...times)).toISOString()} (${span.toFixed(1)} days)`);
  if (span > 4.5) fail(`league ${league}: priced kick-offs span ${span.toFixed(1)} days - more than one matchday`);
  if (Math.min(...times) < Date.now() - 3 * 3600000) fail(`league ${league}: a price for a match already played`);
  const byFixture = new Map();
  for (const r of priced) {
    const seen = byFixture.get(r.leghe);
    if (seen && seen !== r.match) fail(`league ${league}: Leghe fixture ${r.leghe} read as two matches, ${seen} and ${r.match}`);
    byFixture.set(r.leghe, r.match);
  }
  for (const [fixture, match] of byFixture) console.log(`    ${fixture.padEnd(9)} -> ${match}`);
  for (const r of priced) {
    if (!sampled.has(r.match)) sampled.set(r.match, []);
    if (!sampled.get(r.match).some((x) => x.name === r.name)) sampled.get(r.match).push(r);
  }
}
async function verifyPrices() {
  const { execFileSync } = await import('node:child_process');
  const vm = await import('node:vm');
  const box = { Logger: { log: () => {} }, console };
  vm.createContext(box);
  vm.runInContext(readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'gas', 'odds.gs'), 'utf8'), box);
  // Git's curl and not Windows' or Node's: oddschecker's edge filters on the TLS fingerprint (measured).
  const CURL = 'C:/Program Files/Git/mingw64/bin/curl.exe';
  const get = async (path) => {
    const out = execFileSync(CURL, ['-s', '-L', '--max-time', '40', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', '-H', 'Accept: text/html,application/xhtml+xml', '-H', 'Accept-Language: it-IT,it;q=0.9', 'https://www.oddschecker.com' + path], { maxBuffer: 64 << 20 }).toString('utf8');
    await wait(3000);
    return out;
  };
  // A league page the site refused (it rate-limits) is a match we could not re-check, not a wrong price:
  // said apart, so a throttled run does not read as a failed one.
  const paths = new Map();
  const unread = [];
  for (const [league, path] of Object.entries(box.ODDS_LEAGUES)) {
    const listed = box.oddsMatches_(await get(path));
    if (!listed.length) unread.push(league);
    for (const m of listed) paths.set(m.name, m.path);
  }
  if (unread.length) console.log(`    league pages refused now, their matches not re-priced: ${unread.join(', ')}`);
  let checked = 0, off = 0;
  for (const [match, rows] of [...sampled].slice(0, 12)) {
    const path = paths.get(match);
    if (!path) {
      if (unread.length) { console.log(`    ${match}: its league page was refused, not re-priced`); continue; }
      fail(`${match}: not on oddschecker's league pages any more`);
      continue;
    }
    const grids = box.oddsGrids_(await get(path));
    if (!grids) { console.log(`    ${match}: page without odds now, not re-priced`); continue; }
    const fresh = box.oddsRows_('x', { name: match, start: '' }, grids, 'now');
    for (const r of rows) {
      const row = r.kind === 'goal'
        ? fresh.find((f) => f[8] === 'goal' && f[10] === r.oddsName)
        : fresh.find((f) => f[8] === 'clean_sheet' && f[9] === r.side);
      if (!row) { fail(`${r.name} (${match}): no ${r.kind} selection on the page now`); continue; }
      const drift = Math.abs(row[11] - r.price) / r.price;
      checked += 1;
      if (drift > 0.15) { off += 1; fail(`${r.name} (${match}): screen ${r.price}, oddschecker now ${row[11]}`); }
      console.log(`    ${r.name.padEnd(18)} ${String(r.kind).padEnd(11)} ${match.padEnd(34)} screen ${String(r.price).padStart(6)}  now ${String(row[11]).padStart(6)}  (${row[13]} books)`);
    }
  }
  console.log(`  re-priced ${checked} selections, ${off} off by more than 15%`);
}

try {
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  pageSession = (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  await send('Runtime.enable', {}, pageSession);
  await send('Page.enable', {}, pageSession);
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession);
  // OPTIONAL: a bookmaker-odds payload to seed the page's cache (argv[3]), so the odds join can be measured
  // on the real rosters before the Sheet serves it. Built with odds.gs's own parsers.
  const seed = ARGS[1];
  if (seed) {
    const body = readFileSync(seed, 'utf8');
    const cache = JSON.stringify({ at: new Date().toISOString(), body });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('fantassistant.bookmaker-odds-cache', ${JSON.stringify(cache)}); } catch {}` }, pageSession);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1100, deviceScaleFactor: 1, mobile: false }, pageSession);
  await send('Page.navigate', { url: URL0 }, pageSession);
  console.log('page mounted:', await until(`!!document.querySelector('app-lineup [data-lineup-connect]')`));
  await shot('1-empty.png');

  // EuroLeghe, direct login.
  await ev(`document.querySelector('[data-lineup-connect]').click()`);
  console.log('modal open:', await until(`!!document.querySelector('[data-leghe-platform="euro"] input[name=username]')`));
  await type(pageSession, '[data-leghe-platform="euro"] input[name=username]', USER);
  await type(pageSession, '[data-leghe-platform="euro"] input[name=password]', PASS);
  await ev(`document.querySelector('[data-leghe-platform="euro"] button[type=submit]').click()`);
  console.log('euro connected:', await until(`/collegato/.test(document.querySelector('[data-leghe-platform="euro"]').innerText)`));
  console.log('euro problem:', await ev(`document.querySelector('[data-leghe-platform="euro"] nz-alert')?.innerText ?? null`));

  // Leghe, embedded login inside the modal: the iframe is out-of-process, so it is found by its location.
  await ev(`[...document.querySelectorAll('[data-leghe-platform="classic"] button')].find(b => /Accedi/.test(b.innerText)).click()`);
  let frame = null;
  for (let t = 0; t < 40 && !frame; t++) {
    await wait(500);
    for (const f of frames.filter((f) => f.type === 'iframe')) {
      if (/leghe\.fantacalcio\.it/.test((await evalIn(f.s, 'location.href')) ?? '')) frame = f;
    }
  }
  console.log('embed iframe attached:', !!frame);
  if (frame) {
    for (let t = 0; t < 40; t++) { if (await evalIn(frame.s, `!!document.querySelector('input[type=password]')`)) break; await wait(500); }
    await type(frame.s, 'input[type=text]', USER);
    await type(frame.s, 'input[type=password]', PASS);
    await evalIn(frame.s, `(document.querySelector('button[type=submit]') || [...document.querySelectorAll('button')].find(b => /login|accedi/i.test(b.innerText)))?.click()`);
    console.log('classic connected:', await until(`/collegato/.test(document.querySelector('[data-leghe-platform="classic"]').innerText)`));
  }
  await shot('2-modal.png');

  // Close the modal and read the page: the league stays the one first shown, which is the point of
  // pinning it - a second login must not swap the page under the operator.
  await ev(`document.querySelector('.ant-modal-close')?.click()`);
  console.log('matchday shown:', await until(`!!document.querySelector('[data-lineup-matchday]')`, 40000));
  await wait(1500);
  // THE RULES ARE FOLDED by default (operator, 08/10/2026): zero rows before the click, all of them after.
  const rulesFolded = await ev(`document.querySelectorAll('[data-lineup-rules] dt').length`);
  await ev(`document.querySelector('[data-lineup-rules-toggle]').click()`);
  await wait(300);
  console.log('rules folded:', rulesFolded === 0, '· rules after the click:', await ev(`document.querySelectorAll('[data-lineup-rules] dt').length`));

  // EVERY LEAGUE in the selector, one after the other: the same three readings on each.
  const leagues = await ev(`(async () => {
    (document.querySelector('[data-lineup-league] nz-select-top-control') ?? document.querySelector('[data-lineup-league]')).click();
    await new Promise((r) => setTimeout(r, 400));
    const names = [...document.querySelectorAll('nz-option-item')].map((o) => o.innerText.trim());
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return names;
  })()`);
  console.log('leagues:', leagues.length);
  if (!leagues.length) leagues.push(null); // the selector did not open: read the league on screen at least
  for (let i = 0; i < leagues.length; i++) {
    if (leagues[i] !== null) await ev(`(async () => {
      (document.querySelector('[data-lineup-league] nz-select-top-control') ?? document.querySelector('[data-lineup-league]')).click();
      await new Promise((r) => setTimeout(r, 400));
      document.querySelectorAll('nz-option-item')[${i}].click();
    })()`);
    await until(`!!document.querySelector('[data-lineup-roster] li[data-fc-id]') && !!document.querySelector('[data-lineup-pitch] [data-module]')`, 40000);
    // The prices come from the Sheet live, and Apps Script takes 5-30 s to answer: wait for its verdict.
    await until(`/lette |non lette/.test(document.querySelector('[data-lineup-odds-state]')?.innerText ?? '')`, 90000);
    await wait(1500);
    const read = await ev(`(() => {
      const rows = [...document.querySelectorAll('[data-lineup-roster] li[data-fc-id]')];
      const places = [...document.querySelectorAll('[data-lineup-pitch] [data-place]')];
      return {
        competitions: [...document.querySelectorAll('[data-lineup-matchday] li')].map(li => li.innerText.replace(/\\s+/g, ' ')),
        rosterRows: rows.length,
        advisedStarters: rows.filter((r) => /Titolare/.test(r.children[8]?.innerText ?? '')).length,
        module: document.querySelector('[data-lineup-pitch] [data-module]')?.innerText ?? null,
        places: places.length,
        filled: places.filter((p) => p.hasAttribute('data-filled')).length,
        bench: document.querySelectorAll('[data-lineup-bench] [data-bench]').length,
        oddsState: document.querySelector('[data-lineup-odds-state]')?.innerText.replace(/\\s+/g, ' ') ?? null,
        noOdds: rows.filter((r) => /^\\s*–\\s*$/.test(r.children[7]?.innerText ?? '')).map((r) => (r.children[1]?.innerText ?? '').split('\\n')[0] + ' [' + (r.children[0]?.innerText ?? '').replace(/\\s+/g, '') + '] ' + (r.children[2]?.innerText ?? '')),
        sentEnabled: !document.querySelector('[data-pitch-source="sent"]')?.classList.contains('ant-radio-button-wrapper-disabled'),
        requests: Number(document.querySelector('[data-lineup-read]')?.getAttribute('data-leghe-requests') ?? NaN),
        error: document.querySelector('app-lineup nz-alert')?.innerText ?? null,
      };
    })()`);
    console.log(`league ${i + 1}:`, JSON.stringify(read));
    await shot(`3-page-${i + 1}.png`);
    if (read.rosterRows) oddsChecks(i + 1, await ev(PRICED));
  }
  // THE CACHE: the first league again. Its readings are minutes old, so this look must not ask Leghe at all.
  if (leagues.length > 1 && leagues[0] !== null) {
    await ev(`(async () => {
      (document.querySelector('[data-lineup-league] nz-select-top-control') ?? document.querySelector('[data-lineup-league]')).click();
      await new Promise((r) => setTimeout(r, 400));
      document.querySelectorAll('nz-option-item')[0].click();
    })()`);
    await until(`!!document.querySelector('[data-lineup-roster] li[data-fc-id]')`, 40000);
    await wait(1000);
    const again = Number(await ev(`document.querySelector('[data-lineup-read]')?.getAttribute('data-leghe-requests') ?? NaN`));
    console.log(`league 1 again: ${again} requests to Leghe`);
    if (again !== 0) fail(`league 1 opened again cost ${again} requests: the local cache did not answer`);
  }
  await verifyPrices();
} finally {
  console.log(failures.length ? `${failures.length} ODDS CHECK(S) FAILED:\n  ` + failures.join('\n  ') : 'odds checks passed');
  console.log(problems.length ? problems.join('\n') : 'no page exceptions');
  console.log(`screenshots in ${SHOTS}`);
  ws.close();
  // THE WHOLE TREE, and every Edge carrying this profile: one left behind would hold the profile the next run
  // reuses (the lesson of `e2e-draft.mjs`, 29/09/2026).
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
    spawnSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*e2e-lineup-live-profile*' } | `
      + 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], { stdio: 'ignore' });
  } else browser.kill();
}
