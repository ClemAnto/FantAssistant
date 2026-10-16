/**
 * THE FORMAZIONE PAGE FROM A ROSTER FILE (16/10/2026): `/lineup` from `dist/`, no login and no Leghe at all
 * (operator: «non ci serve fare il login ... utilizziamo semplicemente il file csv esportabile»). The league's own
 * export is uploaded through the page's file input («Carica rosa»), a squad is chosen, and the page must draw it.
 *
 *   npx ng build && node scripts/e2e-lineup-file.mjs <export.csv>
 *
 * What is checked against the FILE and never against the screen: the squads offered are the file's squads; the
 * roster rows are the chosen squad's men the listone knows, and the count the page says it leaves out is the rest;
 * the pitch fields eleven. And that no request leaves for Leghe or its pass-through. Screenshots go to the OS temp
 * folder, because they carry the league's squads.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const CSV = process.argv[2];
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

let foreign = 0;
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url).split('?')[0];
  if (/leghe-api/.test(path)) foreign += 1;
  let file = join(DIST, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    ...(extname(file) === '.gz' ? { 'content-encoding': 'gzip' } : {}) });
  res.end(readFileSync(file));
});
await new Promise((d) => server.listen(0, '127.0.0.1', d));
const port = server.address().port;

// The listone the page will read, from the same bundle it serves: which of the squad's ids it knows.
const rosters = JSON.parse(gunzipSync(readFileSync(join(DIST, 'data', 'rosters.json.gz'))).toString('utf8'));
const quotes = existsSync(join(DIST, 'data', 'listone_quotes.json.gz'))
  ? JSON.parse(gunzipSync(readFileSync(join(DIST, 'data', 'listone_quotes.json.gz'))).toString('utf8')) : null;

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
  if (m.method === 'Network.requestWillBeSent' && /fantacalcio\.it|workers\.dev/.test(m.params.request.url)) foreign += 1;
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

const problems = [];
const check = (ok, said) => { console.log(`${ok ? '·' : 'X'} ${said}`); if (!ok) problems.push(said); };

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/lineup` });

  // 1. No roster: the empty state offers «Carica rosa» and nothing about a login.
  const empty = await until(`(() => { const b = document.querySelector('[data-lineup-connect-empty]'); return b ? b.innerText.trim() : null; })()`);
  check(empty === 'Carica rosa', `empty page offers «${empty}»`);
  const login = await ev(`/Collegati a Leghe|Accedi|Account/.test(document.querySelector('app-lineup')?.innerText ?? '')`);
  check(!login, `no login wording on the page (${login ? 'found' : 'none'})`);
  await shot('1-empty.png');

  // 2. The file, through the page's own input.
  await ev(`document.querySelector('[data-lineup-connect]').click()`);
  await until(`!!document.querySelector('[data-roster-file]')`);
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-roster-file]' });
  await send('DOM.setFileInputFiles', { nodeId, files: [resolve(CSV)] });
  check(!!(await until(`!!document.querySelector('[data-roster-team]')`)), 'the file is read: the squad selector appears');
  const platform = await ev(`document.querySelector('[data-roster-platform] .ant-radio-button-wrapper-checked')?.innerText.trim()`);
  console.log(`  listone guessed: ${platform}`);

  // 3. The squads offered are the file's squads, in its order.
  await ev(`document.querySelector('[data-roster-team] nz-select-top-control, [data-roster-team]').click()`);
  await until(`document.querySelectorAll('nz-option-item').length > 0`);
  const offered = await ev(`[...document.querySelectorAll('nz-option-item')].map((o) => o.innerText.trim())`);
  check(offered.length === squads.size, `${offered.length} squads offered, the file has ${squads.size}`);
  const names = [...squads.keys()];
  check(offered.every((label, i) => label.startsWith(names[i] + ' · ')), 'each squad offered is the file\'s, in its order');
  const pick = names[0];
  await ev(`document.querySelectorAll('nz-option-item')[0].click()`);
  await wait(300);
  await ev(`document.querySelector('[data-roster-done]').click()`);

  // 4. The roster on the page against the file and the listone.
  const listone = (platform === 'EuroLeghe' ? 'euro' : 'default');
  await until(`document.querySelectorAll('[data-lineup-roster] li[data-fc-id]').length > 0`, 40000);
  await wait(1500);
  const shown = await ev(`[...document.querySelectorAll('[data-lineup-roster] li[data-fc-id]')].map((r) => Number(r.getAttribute('data-fc-id')))`);
  const ids = squads.get(pick);
  const extra = shown.filter((id) => !ids.includes(id));
  check(extra.length === 0, `every man on the page is of «${pick}» (${extra.length} not)`);
  const said = Number((await ev(`document.querySelector('[data-lineup-unknown]')?.innerText ?? '0'`)).match(/\d+/)?.[0] ?? 0);
  check(shown.length + said === ids.length, `${shown.length} shown + ${said} said unknown = ${shown.length + said} of the file's ${ids.length}`);
  const header = await ev(`document.querySelector('[data-lineup-read]')?.innerText ?? ''`);
  check(header.includes(pick), `the header names the squad («${header.trim()}»)`);
  // The pitch waits for the rulebook and the sheet, which arrive after the roster: wait for it, then judge it.
  await until(`document.querySelectorAll('[data-lineup-pitch] [data-place][data-filled]').length === 11`, 30000);
  const pitch = await ev(`(() => { const p = [...document.querySelectorAll('[data-lineup-pitch] [data-place]')]; return { places: p.length, filled: p.filter((x) => x.hasAttribute('data-filled')).length, module: document.querySelector('[data-lineup-pitch] [data-module]')?.innerText ?? null }; })()`);
  check(pitch.places === 11 && pitch.filled === 11, `the pitch fields ${pitch.filled} of ${pitch.places} (${pitch.module})`);
  const save = await ev(`!!document.querySelector('[data-lineup-save]')`);
  check(!save, 'no «Salva su Leghe» without Leghe');
  await shot('2-roster.png');

  // 5. A reload keeps the file and the squad (the page is opened again on the day of the matchday).
  await send('Page.reload');
  check(!!(await until(`document.querySelectorAll('[data-lineup-roster] li[data-fc-id]').length === ${shown.length}`, 40000)), 'after a reload the same roster is drawn');
  check(foreign === 0, `requests to Leghe or the pass-through: ${foreign}`);
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
