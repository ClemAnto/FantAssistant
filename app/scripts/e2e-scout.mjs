/**
 * THE SCOUT PAGE (22/10/2026): `/scout` from `dist/`, on a real league export seeded as a stored roster.
 *
 *   npx ng build && node scripts/e2e-scout.mjs <export.csv> [squad name] [classic|mantra]
 *
 * What it checks, against the FILE and never against the screen's own numbers: the pitch draws only his men, each
 * once; a place and a line list targets that play for the rival they name, each adding points, best first; no page
 * error. Screenshots go to the OS temp folder (they carry the squads).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const CSV = process.argv[2];
if (!CSV || !existsSync(CSV)) throw new Error('usage: node scripts/e2e-scout.mjs <export.csv> [squad] [classic|mantra] [classic|euro]');
const GAME = process.argv[4] === 'mantra' ? 'mantra' : 'classic';
// The listone: `euro` for an EuroLeghe export (nEuroSeghe), Serie A otherwise.
const PLATFORM = process.argv[5] === 'euro' ? 'euro' : 'classic';
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const SHOTS = join(tmpdir(), 'e2e-scout');
await mkdir(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.gz': 'application/gzip', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- THE FILE, read here with its own rules (the judge does not reuse the page's parser).
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
const MINE = process.argv[3] && squads.has(process.argv[3]) ? process.argv[3] : [...squads.keys()][0];
const now = new Date().toISOString();
const saved = [{
  key: 'r-e2e-scout', updatedAt: now, fileName: CSV.replace(/^.*[\\/]/, '').replace(/^'+/, ''), loadedAt: now,
  teams: [...squads].map(([name, ids]) => ({ name, ids })), team: MINE, platform: PLATFORM, game: GAME,
}];

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    ...(extname(file) === '.gz' ? { 'content-encoding': 'gzip' } : {}) });
  res.end(readFileSync(file));
});
await new Promise((d) => server.listen(0, '127.0.0.1', d));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const profile = join(tmpdir(), `e2e-scout-${process.pid}`);
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
  const w = pending.get(m.id); if (!w) return;
  pending.delete(m.id); m.error ? w.f(new Error(JSON.stringify(m.error))) : w.d(m.result);
});
const send = (method, params = {}) => new Promise((d, f) => { const id = (seq += 1); pending.set(id, { d, f }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
  return r.result.value;
};
const until = async (expression, ms = 60000) => { for (let t = 0; t < ms; t += 200) { const v = await ev(expression); if (v) return v; await wait(200); } return null; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(join(SHOTS, name), Buffer.from(r.data, 'base64')); };

const problems = [];
const check = (ok, said) => { console.log(`${ok ? '·' : 'X'} ${said}`); if (!ok) problems.push(said); };

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!localStorage.getItem('fantassistant.lineup.rosters')) {
      localStorage.setItem('fantassistant.lineup.rosters', ${JSON.stringify(JSON.stringify(saved))});
      localStorage.setItem('fantassistant.lineup.roster', 'r-e2e-scout');
    }` });
  await send('Page.navigate', { url: `${ORIGIN}/scout` });
  check(!!(await until(`document.querySelectorAll('[data-scout-pitch] [data-place]').length === 11`)), `the pitch of «${MINE}» draws eleven places`);
  check(await ev(`document.documentElement.scrollHeight <= window.innerHeight + 1`), 'the page fits one screen');

  // THE PITCH: only HIS men, each once.
  const mine = new Set(squads.get(MINE));
  const drawn = await ev(`[...document.querySelectorAll('[data-scout-pitch] [data-man]')].map((x) => Number(x.getAttribute('data-id')))`);
  check(drawn.length > 0 && drawn.every((id) => mine.has(id)), `${drawn.length} men on the pitch, all of his squad`);
  check(new Set(drawn).size === drawn.length, 'nobody is drawn twice');
  const yields = await ev(`[...document.querySelectorAll('[data-place]')].map((p) => ({ slot: p.getAttribute('data-slot'),
    cover: p.querySelector('[data-place-cover]').innerText.trim(), fert: p.querySelector('[data-place-fertility]').innerText.trim() }))`);
  console.log('    ' + yields.map((y) => `${y.slot} ${y.cover} ${y.fert}`).join(' · '));
  check(yields.every((y) => /^\d+%$/.test(y.cover) && Number(y.cover.slice(0, -1)) <= 100), 'every place prints a coverage between 0% and 100%');
  check(!!(await ev(`/Seleziona una posizione/.test(document.querySelector('[data-scout-targets]').innerText)`)), 'with nothing selected the right side asks for a place');
  await shot('1-pitch.png');

  const owner = new Map();
  for (const [team, ids] of squads) for (const id of ids) owner.set(id, team);
  const readTargets = () => ev(`[...document.querySelectorAll('[data-scout-target]')].map((r) => ({ id: Number(r.getAttribute('data-id')),
    rival: r.getAttribute('data-rival'), points: Number(r.getAttribute('data-points')), name: r.querySelector('button').innerText.trim() }))`);
  const judge = (rows, label) => {
    check(rows.every((r) => owner.get(r.id) === r.rival && r.rival !== MINE), `${label}: every target plays for the rival it names, none is mine`);
    check(rows.every((r) => r.points > 0), `${label}: every target adds points`);
    check(rows.every((r, i) => i === 0 || r.points <= rows[i - 1].points + 1e-9), `${label}: best first`);
    check(new Set(rows.map((r) => r.id)).size === rows.length, `${label}: nobody listed twice`);
  };

  // A PLACE: the weakest-covered one.
  const pct = (y) => Number(y.cover.slice(0, -1));
  const weakest = yields.reduce((best, y, at) => (pct(y) < pct(yields[best]) ? at : best), 0);
  await ev(`document.querySelectorAll('[data-place]')[${weakest}].click()`);
  await until(`!!document.querySelector('[data-scout-target-title]')`, 10000);
  const placeRows = await readTargets();
  console.log(`    ${await ev(`document.querySelector('[data-scout-target-title]').innerText`)}: ${placeRows.length} targets`);
  for (const r of placeRows.slice(0, 5)) console.log(`      ${r.name} (${r.rival}) +${r.points.toFixed(2)}`);
  judge(placeRows, 'place');
  check(await ev(`document.querySelectorAll('[data-place][data-selected]').length === 1`), 'the clicked place is the one highlighted');
  await shot('2-place.png');

  // A LINE: every place of it highlighted, a man once.
  await ev(`document.querySelectorAll('[data-scout-line]')[1].click()`);
  await wait(300);
  const lineRows = await readTargets();
  const lit = await ev(`document.querySelectorAll('[data-place][data-selected]').length`);
  console.log(`    ${await ev(`document.querySelector('[data-scout-target-title]').innerText`)}: ${lineRows.length} targets, ${lit} places lit`);
  judge(lineRows, 'line');
  check(lit >= 1, 'the line lights its places');
  await shot('3-line.png');

  // THE COLUMNS SORT: a click on «Calciatore» goes A to Z, a second Z to A, a click on «+Pt/g» back to the best first.
  const sortOn = async (key) => { await ev(`document.querySelector('[data-scout-sort="${key}"]').click()`); await wait(200); return readTargets(); };
  const names = (rows) => rows.map((r) => r.name);
  const az = names(await sortOn('name'));
  check(az.every((n, i) => i === 0 || az[i - 1].localeCompare(n) <= 0), 'a click on «Calciatore» sorts A to Z');
  const za = names(await sortOn('name'));
  check(za.every((n, i) => i === 0 || za[i - 1].localeCompare(n) >= 0), 'a second click reverses it');
  const back = await sortOn('points');
  check(back.every((r, i) => i === 0 || r.points <= back[i - 1].points + 1e-9), 'a click on «+Pt/g» puts the best first again');
  check(await ev(`document.querySelectorAll('[data-scout-target] ui-vote-trend').length === document.querySelectorAll('[data-scout-target]').length`),
    'the default set draws the form bars on every row');

  // THE «MEDIE» SET: two seasons of FM, MV, Pv, G:A; the same men, the same order.
  await ev(`document.querySelector('[data-scout-columns-set="medie"]').click()`);
  const filled = await until(`[...document.querySelectorAll('[data-scout-season-fm]')].filter((c) => c.innerText.trim() !== '—').length > 0`, 30000);
  const cols = await ev(`document.querySelectorAll('[data-scout-target]')[0]?.querySelectorAll('[data-scout-season-fm]').length ?? 0`);
  check(!!filled && cols === 2, `the «medie» set shows two seasons per row (${cols}), with fantamedie read`);
  check(await ev(`[...document.querySelectorAll('[data-scout-season-ga]')].every((c) => /^(—|\\d+:\\d+)$/.test(c.innerText.trim()))`), 'every G:A reads «g:a» or «—»');
  const medie = await readTargets();
  check(medie.length === back.length && medie.every((r, i) => r.id === back[i].id), 'switching set keeps the same men in the same order');
  await shot('4-medie.png');
  // THE «HYPE» SET: the ratio of the trend to the fantamedia, and where each target stands with us and with them.
  await ev(`document.querySelector('[data-scout-columns-set="hype"]').click()`);
  await until(`!!document.querySelector('[data-scout-hype]')`, 10000);
  const hype = await ev(`[...document.querySelectorAll('[data-scout-target]')].map((r) => ({ id: Number(r.getAttribute('data-id')),
    hype: r.querySelector('[data-scout-hype]').innerText.trim(), ours: r.querySelector('[data-scout-ours]').innerText.trim(),
    theirs: r.querySelector('[data-scout-theirs]').innerText.trim() }))`);
  const words = new Set(['titolare', 'riserva', 'panchina']);
  check(hype.every((r) => /^(—|\d+\.\d\d)$/.test(r.hype)), 'every hype reads a ratio or «—»');
  check(hype.every((r) => words.has(r.ours) && (words.has(r.theirs) || r.theirs === '—')), '«Da noi» and «Da loro» read titolare, riserva or panchina');
  console.log(`    da loro: ${[...words].map((w) => `${w} ${hype.filter((r) => r.theirs === w).length}`).join(' · ')}`);
  const active = await ev(`[...document.querySelectorAll('[data-scout-columns-set]')].map((b) => b.getAttribute('data-scout-columns-set') + ':' + b.hasAttribute('data-active') + ':' + getComputedStyle(b).backgroundColor)`);
  console.log('    ' + active.join(' | '));
  check(await ev(`[...document.querySelectorAll('[data-scout-columns-set].ant-radio-button-wrapper-checked')].map((b) => b.getAttribute('data-scout-columns-set')).join() === 'hype'`), 'only the hype icon is lit');
  await shot('5-hype.png');
  await ev(`document.querySelector('[data-scout-columns-set="default"]').click()`);
  check(!noise.length, `no page errors${noise.length ? ': ' + noise.join(' | ') : ''}`);
} finally {
  ws.close();
  spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  server.close();
}
console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nOK');
process.exit(problems.length ? 1 : 0);
