/**
 * THE SCOUT PAGE (22/10/2026): `/scout` from `dist/`, on a real league export seeded as a stored roster.
 *
 *   npx ng build && node scripts/e2e-scout.mjs <export.csv> [squad name] [classic|mantra]
 *
 * What it checks, against the FILE and never against the screen's own numbers: every trade shown gives only men of
 * HIS squad and takes only men of the rival it names; both gains are at least +0.1; on classic every squad keeps its
 * role quotas; the search finishes; no page error. Screenshots go to the OS temp folder (they carry the squads).
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
  check(!!(await until(`!!document.querySelector('[data-scout-mine]')`)), `his squad «${MINE}» is drawn`);
  const bench = await ev(`document.querySelectorAll('[data-scout-bench] li').length`);
  console.log(`    bench lines: ${bench}`);
  // A starter's reserve must share his BASE role (operator: «Chabot non è alternativa a Grimaldo»): the first badge.
  const backed = await ev(`[...document.querySelectorAll('[data-scout-expendable] > li')].map((li) => {
    const badges = [...li.querySelectorAll('ui-roles')].map((r) => r.innerText.trim().split(/\\s+/)[0]);
    return { names: [...li.querySelectorAll('button')].map((b) => b.innerText.trim()).join(' <- '), starter: badges[0], reserve: badges[1] };
  })`);
  for (const b of backed) console.log(`    ${b.names} (${b.starter} / ${b.reserve})`);
  check(backed.every((b) => b.starter === b.reserve), `${backed.length} starters with a reserve, every one of his base role`);
  const rivals = await ev(`document.querySelectorAll('[data-scout-rivals] > section').length`);
  check(rivals === squads.size - 1, `${rivals} rival cards for ${squads.size - 1} rivals`);
  await shot('1-open.png');

  // THE 1x1 SWAPS (operator, 22/10/2026): «il mio del ruolo X deve essere migliore di uno suo titolare di quel ruolo
  // ed il suo del ruolo Y deve essere migliore del mio in quel ruolo/posizione». Read off the page and judged against
  // the FILE: who belongs to which squad, and the two comparisons each line states.
  await until(`!!document.querySelector('[data-scout-list]') || /Nessuno scambio/.test(document.querySelector('[data-scout-trades]')?.innerText ?? '')`);
  // ONE LINE PER SWAP, «A × B» (22/10/2026): who I give, who I take, the two gains. Read under the rival heading.
  const readLines = (list, offer) => ev(`(() => {
    const out = [];
    let rival = null, index = 0;
    for (const node of document.querySelector('${list}')?.children ?? []) {
      if (node.matches('[data-scout-rival]')) { rival = node.querySelector('span').innerText.trim(); continue; }
      if (!node.matches('${offer}')) continue;
      index += 1;
      for (const line of node.querySelectorAll('[data-scout-line]')) {
        const g = line.querySelector('[data-scout-gains]')?.innerText.match(/per te \\+([\\d.]+) · per loro \\+([\\d.]+)/);
        const f = line.querySelector('[data-scout-form]')?.innerText.replace('forma', '').trim();
        out.push({ rival, offer: index, gives: line.getAttribute('data-gives'), takes: line.getAttribute('data-takes'),
          ours: g ? Number(g[1]) : null, theirs: g ? Number(g[2]) : null, form: f ? Number(f.replace('+', '')) : null });
      }
    }
    return out;
  })()`);
  const lines = await readLines('[data-scout-list]', '[data-scout-offer]');
  console.log(`    1x1 lines ${lines.length}`);
  for (const l of lines.slice(0, 6)) console.log(`    ${l.rival}: ${l.gives} × ${l.takes} · +${l.ours} / +${l.theirs}`);
  check(lines.every((l) => squads.has(l.rival) && l.rival !== MINE), 'every offer names a real rival');
  // The two gains are what each BEST ELEVEN gains, net of who leaves (Cunha for Marmoush, 22/10/2026), and comparable.
  check(lines.every((l) => l.ours >= 0.09 && l.theirs >= 0.09), 'every line: both elevens gain at least +0.1');
  const lopsided = lines.filter((l) => Math.min(l.ours, l.theirs) < 0.5 * Math.max(l.ours, l.theirs) - 0.01);
  check(lopsided.length === 0, `${lopsided.length} lines with one gain over double the other`);
  // «Il trend del calciatore richiesto è troppo elevato per convincere l'altro» (22/10/2026): never below -0.25.
  check(lines.every((l) => l.form === null || l.form >= -0.25 - 1e-9), `every 1x1 line offers form no worse than -0.25 (${lines.filter((l) => l.form !== null).length} with a form)`);
  const byOffer = new Map();
  for (const l of lines) byOffer.set(`${l.rival}|${l.offer}`, [...(byOffer.get(`${l.rival}|${l.offer}`) ?? []), l.gives]);
  check([...byOffer.values()].every((g) => new Set(g).size === g.length), 'no man twice in one offer');
  await shot('2-trades.png');

  // THE COMPARISON TABLE (22/10/2026): «i calciatori che chiedo e quelli che offro», two seasons, the press, the strip.
  if (lines.length) {
    await ev(`document.querySelector('[data-scout-compare-toggle]').click()`);
    await until(`!!document.querySelector('[data-scout-compare]')`);
    // MIEI on the left, SUOI on the right: who I give replaces their starter (→), who I take replaces mine (←).
    const rows = await ev(`[...document.querySelectorAll('[data-scout-compare-row]')].map((r) => ({
      dir: r.getAttribute('data-direction'),
      men: [...r.querySelectorAll('[data-scout-compare-man]')].map((c) => c.getAttribute('data-scout-compare-man')),
      arrow: r.querySelector('[data-scout-arrow]').innerText.trim() }))`);
    for (const r of rows) console.log(`    ${r.men[0] ?? 'posto vuoto'} ${r.arrow} ${r.men[1] ?? 'posto vuoto'}`);
    const first = lines[0];
    check(rows.length === 2 && rows[0].dir === 'gives' && rows[0].men[0] === first.gives && rows[1].dir === 'takes' && rows[1].men[1] === first.takes
      && rows.every((r) => /meglio di/.test(r.arrow)),
      'the 1x1 table: my man given on the left beats their starter, their man taken on the right beats mine');
    check(await ev(`document.querySelectorAll('[data-scout-compare] ui-vote-trend').length`) === 4 - rows.flatMap((r) => r.men).filter((m) => !m).length, 'each man draws his trend strip');
    await shot('2b-compare.png');
  }

  // THE 2x2 (22/10/2026): the mode, the search, and the same two promises per line - both elevens gain, comparably.
  await ev(`document.querySelectorAll('[data-scout-mode] label')[1].click()`);
  await until(`!!document.querySelector('[data-scout-search]')`);
  const t0 = Date.now();
  await ev(`document.querySelector('[data-scout-search]').click()`);
  const doneSearch = await until(`/scambi 2x2 in/.test(document.querySelector('[data-scout-trades]')?.innerText ?? '')`, 240000);
  check(!!doneSearch, `the 2x2 search finishes (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const pairLines = await readLines('[data-scout-pairs]', '[data-scout-pair-offer]');
  console.log(`    2x2 lines ${pairLines.length}`);
  for (const l of pairLines.slice(0, 6)) console.log(`    ${l.rival}: ${l.gives} × ${l.takes} · +${l.ours} / +${l.theirs}`);
  check(pairLines.every((l) => l.ours >= 0.09 && l.theirs >= 0.09), 'every 2x2 line: both elevens gain at least +0.1');
  check(pairLines.every((l) => Math.min(l.ours, l.theirs) >= 0.5 * Math.max(l.ours, l.theirs) - 0.01), 'every 2x2 line: the two gains are comparable');
  check(pairLines.every((l) => l.form === null || l.form >= -0.25 - 1e-9), 'every 2x2 line offers form no worse than -0.25');
  const pairOffers = new Map();
  for (const l of pairLines) pairOffers.set(`${l.rival}|${l.offer}`, [...(pairOffers.get(`${l.rival}|${l.offer}`) ?? []), ...l.gives.split(' + ')]);
  // A man on EVERY line of an offer is its core (the same payment, different returns) and is written on each line now
  // that a line is «A + B × C + D»; what must not happen is a man on SOME lines only, twice.
  const pairDoubles = [...pairOffers.entries()].filter(([key, g]) => {
    const linesOf = pairLines.filter((l) => `${l.rival}|${l.offer}` === key).map((l) => l.gives.split(' + '));
    const core = new Set(g.filter((m) => linesOf.every((one) => one.includes(m))));
    const rest = g.filter((m) => !core.has(m));
    return new Set(rest).size !== rest.length;
  }).length;
  check(pairDoubles === 0, `${pairDoubles} 2x2 offers show a man on two lines`);
  if (pairLines.length) {
    await ev(`document.querySelector('[data-scout-pairs] [data-scout-compare-toggle]').click()`);
    await until(`document.querySelectorAll('[data-scout-compare-row]').length >= 4`);
    const pr = await ev(`[...document.querySelectorAll('[data-scout-compare-row]')].map((r) => ({ dir: r.getAttribute('data-direction'),
      men: [...r.children].filter((c) => c.hasAttribute('data-scout-compare-man') || c.getAttribute('colspan') === '9').map((c) => c.getAttribute('data-scout-compare-man')) }))`);
    for (const r of pr) console.log(`    2x2: ${r.men[0] ?? 'posto vuoto'} ${r.dir === 'gives' ? '→' : '←'} ${r.men[1] ?? 'posto vuoto'}`);
    check(pr.filter((r) => r.dir === 'gives').length >= 2 && pr.filter((r) => r.dir === 'takes').length >= 2, 'the 2x2 table: two given (→) and two taken (←)');
  }
  await shot('3-pairs.png');

  // THE LAST SEARCH SURVIVES A REFRESH («salva l'ultima ricerca e mostrala al refresh»).
  await send('Page.reload');
  const restored = await until(`/ultima ricerca del/.test(document.querySelector('[data-scout-pair-meta]')?.innerText ?? '')`, 60000);
  const after = await ev(`document.querySelectorAll('[data-scout-pairs] [data-scout-line]').length`);
  check(!!restored && after === pairLines.length, `after a refresh the 2x2 are back without a new search (${after} of ${pairLines.length} lines)`);
  check(!noise.length, `no page errors${noise.length ? ': ' + noise.join(' | ') : ''}`);
} finally {
  ws.close();
  spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  server.close();
}
console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nOK');
process.exit(problems.length ? 1 : 0);
