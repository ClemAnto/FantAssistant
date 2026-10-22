/**
 * THE FORMAZIONE PAGE FROM ROSTER FILES (16/10/2026): `/lineup` from `dist/`, no login and no Leghe at all
 * (operator: «non ci serve fare il login ... utilizziamo semplicemente il file csv esportabile», then «si possano
 * caricare più rose ... e poi successivamente si possa semplicemente selezionare la squadra», and «la rosa resta
 * visibile per ogni dispositivo»).
 *
 *   npx ng build && node scripts/e2e-lineup-file.mjs <export.csv>
 *
 * The league's export is uploaded through the page's own file input twice, for two of its squads; then the
 * selector switches between them; then the browser forgets its rosters (a NEW DEVICE) and must get them back from
 * the press sheet, which is FAKED here (`?what=rosters` GET, the text/plain POST, with `scripts/gas/rosters.gs`'s
 * own merge) so nothing leaves this machine. Everything is checked against the FILE, never against the screen.
 * Screenshots go to the OS temp folder, because they carry the league's squads.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';

const CSV = process.argv[2];
// OPTIONAL: a `?what=odds` body (a capture of the press sheet's Quote tab) seeded in the page's own odds cache, so
// the corrected scoring chance beside each price can be checked (22/10/2026) without a request leaving.
const ODDS = process.argv[3] && existsSync(process.argv[3]) ? readFileSync(process.argv[3], 'utf8') : null;
if (!CSV || !existsSync(CSV)) throw new Error('usage: node scripts/e2e-lineup-file.mjs <export.csv>');
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const SHOTS = join(tmpdir(), 'e2e-lineup-file');
await mkdir(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.gz': 'application/gzip', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = 'bench-secret';

// ---- THE FILE, read here with its own rules (the page's parser is not reused: this is the judge).
const squads = new Map();
for (const raw of readFileSync(CSV, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('$')) continue;
  const last = line.lastIndexOf(',');
  const prev = line.lastIndexOf(',', last - 1);
  const team = line.slice(0, prev).trim();
  const id = Number(line.slice(prev + 1, last));
  if (!team || !Number.isFinite(id)) continue;
  squads.set(team, [...(squads.get(team) ?? []), id]);
}
const names = [...squads.keys()];

// ---- THE FAKE SHEET: `rosters.gs` itself, run in a sandbox over an in-memory property store.
const props = new Map();
const sandbox = {
  PropertiesService: { getScriptProperties: () => ({
    getProperty: (k) => (k === 'WIDGET_SECRET' ? SECRET : (props.get(k) ?? null)),
    setProperties: (o) => { for (const [k, v] of Object.entries(o)) props.set(k, v); },
    getKeys: () => [...props.keys()],
    deleteProperty: (k) => props.delete(k),
  }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  json_: (body) => body,
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, '..', 'scripts', 'gas', 'rosters.gs'), 'utf8'), sandbox);
let sheetCalls = 0;

let foreign = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/sheet') {
    sheetCalls += 1;
    const answer = (body) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(body); };
    if (req.method === 'POST') {
      let text = '';
      req.on('data', (c) => (text += c));
      req.on('end', () => answer(sandbox.rosterPost_(JSON.parse(text))));
      return;
    }
    return answer(sandbox.rosterGet_({ parameter: Object.fromEntries(url.searchParams) }));
  }
  if (/leghe-api/.test(url.pathname)) foreign += 1;
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    ...(extname(file) === '.gz' ? { 'content-encoding': 'gzip' } : {}) });
  res.end(readFileSync(file));
});
await new Promise((d) => server.listen(0, '127.0.0.1', d));
const port = server.address().port;
const ORIGIN = `http://127.0.0.1:${port}`;

const profile = join(tmpdir(), `e2e-lineup-file-${process.pid}`);
await rm(profile, { recursive: true, force: true });
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
  '--window-size=1500,1100', 'about:blank'], { stdio: 'ignore' });
let ws = null;
for (let i = 0; i < 100 && !ws; i += 1) {
  await wait(200);
  try {
    const [p] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
    const list = await (await fetch(`http://127.0.0.1:${p}/json/list`)).json();
    const page = list.find((o) => o.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { /* coming up */ }
}
await new Promise((d) => ws.addEventListener('open', d, { once: true }));
let seq = 0; const pending = new Map(); const noise = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') noise.push(String(m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text).slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') noise.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (m.method === 'Network.requestWillBeSent' && /fantacalcio\.it|workers\.dev|script\.google/.test(m.params.request.url)) foreign += 1;
  const w = pending.get(m.id); if (!w) return;
  pending.delete(m.id); m.error ? w.f(new Error(JSON.stringify(m.error))) : w.d(m.result);
});
const send = (method, params = {}) => new Promise((d, f) => { const id = (seq += 1); pending.set(id, { d, f }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
  return r.result.value;
};
const until = async (expression, ms = 30000) => { for (let t = 0; t < ms; t += 200) { const v = await ev(expression); if (v) return v; await wait(200); } return null; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(SHOTS, name), Buffer.from(r.data, 'base64')); };
const rosterIds = () => ev(`[...document.querySelectorAll('[data-lineup-roster] li[data-fc-id]')].map((r) => Number(r.getAttribute('data-fc-id')))`);

const problems = [];
const check = (ok, said) => { console.log(`${ok ? '·' : 'X'} ${said}`); if (!ok) problems.push(said); };

/** «Carica rosa» -> the file -> his squad (the n-th of the file) -> Salva. Returns the platform guessed. */
async function upload(index) {
  await ev(`(document.querySelector('[data-lineup-connect]') ?? document.querySelector('[data-lineup-connect-empty]')).click()`);
  await until(`!!document.querySelector('[data-roster-file]')`);
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-roster-file]' });
  await send('DOM.setFileInputFiles', { nodeId, files: [resolve(CSV)] });
  await until(`!!document.querySelector('[data-roster-team]')`);
  const platform = await ev(`document.querySelector('[data-roster-platform] .ant-radio-button-wrapper-checked')?.innerText.trim()`);
  await ev(`document.querySelector('[data-roster-team] nz-select-top-control, [data-roster-team]').click()`);
  await until(`document.querySelectorAll('nz-option-item').length > 0`);
  const offered = await ev(`[...document.querySelectorAll('nz-option-item')].map((o) => o.innerText.trim())`);
  await ev(`document.querySelectorAll('nz-option-item')[${index}].click()`);
  await wait(300);
  await ev(`document.querySelector('[data-roster-done]').click()`);
  await wait(300);
  return { platform, offered };
}

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  // The fake sheet's address and the shared secret, where the page keeps them (`NextRoundStore.url`, the widget's
  // secret): set once, before the app boots.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try {
    if (!localStorage.getItem('fantassistant.next-round-url')) localStorage.setItem('fantassistant.next-round-url', ${JSON.stringify(ORIGIN + '/sheet')});
    if (!localStorage.getItem('fantassistant.widget-secret')) localStorage.setItem('fantassistant.widget-secret', ${JSON.stringify(SECRET)});
    ${ODDS ? `localStorage.setItem('fantassistant.bookmaker-odds-cache', ${JSON.stringify(JSON.stringify({ at: new Date().toISOString(), body: ODDS }))});` : ''}
  } catch {}` });
  await send('Page.navigate', { url: `${ORIGIN}/lineup` });

  // 1. No roster: the empty state offers «Carica rosa» and nothing about a login.
  const empty = await until(`(() => { const b = document.querySelector('[data-lineup-connect-empty]'); return b ? b.innerText.trim() : null; })()`);
  check(empty === 'Carica rosa', `empty page offers «${empty}»`);
  const login = await ev(`/Collegati a Leghe|Accedi|Account/.test(document.querySelector('app-lineup')?.innerText ?? '')`);
  check(!login, `no login wording on the page (${login ? 'found' : 'none'})`);
  await shot('1-empty.png');

  // 2. The first squad.
  const first = await upload(0);
  console.log(`  listone guessed: ${first.platform}`);
  check(first.offered.length === squads.size && first.offered.every((label, i) => label.startsWith(names[i] + ' · ')),
    `${first.offered.length} squads offered, the file's ${squads.size} in its order`);
  await until(`document.querySelectorAll('[data-lineup-roster] li[data-fc-id]').length > 0`, 40000);
  await wait(1000);
  let shown = await rosterIds();
  let said = Number((await ev(`document.querySelector('[data-lineup-unknown]')?.innerText ?? '0'`)).match(/\d+/)?.[0] ?? 0);
  check(shown.every((id) => squads.get(names[0]).includes(id)) && shown.length + said === squads.get(names[0]).length,
    `«${names[0]}»: ${shown.length} shown + ${said} unknown = the file's ${squads.get(names[0]).length}`);
  await until(`document.querySelectorAll('[data-lineup-pitch] [data-place][data-filled]').length === 11`, 30000);
  const pitch = await ev(`(() => { const p = [...document.querySelectorAll('[data-lineup-pitch] [data-place]')]; return { places: p.length, filled: p.filter((x) => x.hasAttribute('data-filled')).length, module: document.querySelector('[data-lineup-pitch] [data-module]')?.innerText ?? null }; })()`);
  check(pitch.places === 11 && pitch.filled === 11, `the pitch fields ${pitch.filled} of ${pitch.places} (${pitch.module})`);
  check(!(await ev(`!!document.querySelector('[data-lineup-save]')`)), 'no «Salva su Leghe» without Leghe');

  // 2a. THE CORRECTED SCORING CHANCE (22/10/2026): beside every scorer price a percentage, below 1/price (the
  //     archive measured the books overstating every scorer) and the keepers' clean sheet printed as priced.
  if (ODDS) {
    const priced = await ev(`[...document.querySelectorAll('[data-lineup-roster] [data-odds-kind]')].map((o) => ({
      kind: o.getAttribute('data-odds-kind'), price: Number(o.getAttribute('data-odds-price')),
      pct: o.querySelector('[data-odds-chance]')?.innerText ?? null, name: o.closest('li').querySelector('button')?.innerText ?? '' }))`);
    const goals = priced.filter((o) => o.kind === 'goal');
    const bad = goals.filter((o) => !o.pct || Number(o.pct.replace('%', '')) >= 100 / o.price);
    // A keeper's clean-sheet price is printed as it is (measured: the books price it at the rate it happens).
    const keepers = priced.filter((o) => o.kind !== 'goal');
    const keepersOff = keepers.filter((o) => !o.pct);
    check(goals.length > 0 && !bad.length && !keepersOff.length,
      `${goals.length} scorer prices, every one with a corrected chance under 1/price; keepers ${keepers.length}, without a chance ${keepersOff.length}` +
        (bad.length ? ` - wrong: ${bad.map((o) => o.name).join(', ')}` : ''));
    for (const o of goals.slice(0, 6)) console.log(`    ${o.name}: ${o.price} -> ${o.pct} (1/price ${Math.round(100 / o.price)}%)`);
    await shot('2a-odds.png');
  }

  // 2b. ONE KEEPER OF A CLUB (operator, 16/10/2026, Kohn fielded over Hradecky): every keeper on the pitch is the
  //     likeliest of his club in this roster, by the chance the page shows. Roles and clubs come from the BUNDLE
  //     (the club is a fact per platform, `listone_quotes`), and the step says how many clubs it judged.
  {
    const table = (name) => JSON.parse(gunzipSync(readFileSync(join(DIST, 'data', name))).toString('utf8'));
    const latest = (t, keep) => {
      const col = Object.fromEntries(t.columns.map((c, i) => [c, i]));
      const out = new Map();
      for (const row of t.rows) {
        if (!keep(row, col)) continue;
        const held = out.get(row[col.fc_id]);
        if (!held || row[col.season] > held[col.season]) out.set(row[col.fc_id], row);
      }
      return { out, col };
    };
    const platform = first.platform === 'EuroLeghe' ? 'euro' : 'default';
    const quotes = latest(table('listone_quotes.json.gz'), (row, col) => row[col.platform] === platform);
    const roles = latest(table('rosters.json.gz'), () => true);
    const keeper = (id) => roles.out.get(id)?.[roles.col.role_classic] === 'P';
    const clubOf = (id) => quotes.out.get(id)?.[quotes.col.fc_club_id] ?? null;
    const chances = new Map(await ev(`[...document.querySelectorAll('[data-lineup-roster] li[data-fc-id]')].map((r) => [Number(r.getAttribute('data-fc-id')), Number(r.getAttribute('data-chance'))])`));
    const fielded = await ev(`[...document.querySelectorAll('[data-lineup-pitch] [data-place-man]')].map((m) => Number(m.getAttribute('data-place-man')))`);
    const keepers = [...chances.keys()].filter(keeper);
    const judged = fielded.filter(keeper).filter((id) => clubOf(id) !== null);
    const wrong = judged.filter((id) => keepers.some((k) => k !== id && clubOf(k) === clubOf(id) && chances.get(k) > chances.get(id)));
    check(judged.length > 0 && wrong.length === 0,
      `fielded keepers judged ${judged.length} (roster keepers ${keepers.length}): ${wrong.length} with a likelier clubmate`);
  }

  // 3. A second squad of the same file: two entries, and the selector switches between them.
  await upload(1);
  await until(`document.querySelectorAll('[data-lineup-roster] li[data-fc-id]').length > 0 && [...document.querySelectorAll('[data-lineup-roster] li[data-fc-id]')].every((r) => ${JSON.stringify(squads.get(names[1]))}.includes(Number(r.getAttribute('data-fc-id'))))`, 30000);
  shown = await rosterIds();
  check(shown.length > 0 && shown.every((id) => squads.get(names[1]).includes(id)), `the second squad «${names[1]}» is on screen (${shown.length} men)`);
  await ev(`document.querySelector('[data-lineup-league] nz-select-top-control, [data-lineup-league]').click()`);
  await until(`document.querySelectorAll('nz-option-item').length > 0`);
  const options = await ev(`[...document.querySelectorAll('nz-option-item')].map((o) => o.innerText.trim())`);
  check(options.length === 2 && options.some((o) => o.endsWith(names[0])) && options.some((o) => o.endsWith(names[1])), `the selector offers both squads (${options.join(' | ')})`);
  await ev(`[...document.querySelectorAll('nz-option-item')].find((o) => o.innerText.trim().endsWith(${JSON.stringify(names[0])})).click()`);
  check(!!(await until(`[...document.querySelectorAll('[data-lineup-roster] li[data-fc-id]')].every((r) => ${JSON.stringify(squads.get(names[0]))}.includes(Number(r.getAttribute('data-fc-id'))))`, 20000)), `choosing «${names[0]}» brings its roster back`);
  await shot('2-roster.png');

  // 3b. A NEWER EXPORT of a squad already stored updates it under the SAME id (the default «Aggiorna» is the stored
  // squad of that league and name), instead of adding a twin - which is how the widget once showed every man twice.
  const keysBefore = await ev(`JSON.parse(localStorage.getItem('fantassistant.lineup.rosters') ?? '[]').filter((r) => !r.removed).map((r) => r.key).sort()`);
  await upload(0);
  await wait(800);
  const keysAfter = await ev(`JSON.parse(localStorage.getItem('fantassistant.lineup.rosters') ?? '[]').filter((r) => !r.removed).map((r) => r.key).sort()`);
  check(JSON.stringify(keysBefore) === JSON.stringify(keysAfter) && keysAfter.length === 2,
    `re-loading «${names[0]}» keeps the same ids (${keysAfter.length} squads, ${keysAfter.filter((k) => /^r-/.test(k)).length} minted ids)`);

  // 4. Every device: the sheet holds both; a browser that forgets its own list gets them back from the sheet.
  await until(`/sincronizzate/.test(document.body.innerText) || true`, 2000);
  await wait(1500);
  const onSheet = JSON.parse(sandbox.rosterGet_({ parameter: { secret: SECRET } })).rosters.filter((r) => !r.removed).map((r) => r.team);
  check(onSheet.length === 2 && onSheet.includes(names[0]) && onSheet.includes(names[1]), `the sheet holds both squads (${onSheet.join(', ')})`);
  await ev(`localStorage.removeItem('fantassistant.lineup.rosters'); localStorage.removeItem('fantassistant.lineup.roster'); true`);
  await send('Page.reload');
  check(!!(await until(`document.querySelectorAll('[data-lineup-roster] li[data-fc-id]').length > 0`, 40000)), 'a NEW DEVICE (no rosters stored) draws a roster from the sheet');
  await ev(`document.querySelector('[data-lineup-league] nz-select-top-control, [data-lineup-league]').click()`);
  await until(`document.querySelectorAll('nz-option-item').length > 0`);
  check((await ev(`document.querySelectorAll('nz-option-item').length`)) === 2, 'and offers both squads');
  await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  // 5. A removal reaches the sheet too.
  await ev(`document.querySelector('[data-lineup-connect]').click()`);
  await until(`document.querySelectorAll('[data-roster-remove]').length === 2`);
  await ev(`document.querySelectorAll('[data-roster-remove]')[0].click()`);
  await wait(1500);
  const left = JSON.parse(sandbox.rosterGet_({ parameter: { secret: SECRET } })).rosters.filter((r) => !r.removed);
  check(left.length === 1, `after «rimuovi» the sheet holds ${left.length} squad`);
  check(sheetCalls > 0, `requests to the (fake) sheet: ${sheetCalls}`);
  check(foreign === 0, `requests to Leghe, the pass-through or Google: ${foreign}`);
} finally {
  console.log(noise.length ? noise.join('\n') : 'no page exceptions');
  console.log(problems.length ? `${problems.length} PROBLEM(S)` : 'all checks passed');
  console.log(`screenshots in ${SHOTS}`);
  ws.close();
  server.close();
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  else browser.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exitCode = problems.length ? 1 : 0;
}
