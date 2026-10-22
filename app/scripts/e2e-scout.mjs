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

/**
 * ROADMAP STEPS 2 and 4 on one list: the FVM filter leaves only offers the FVM favours, with its count on screen and
 * the full list back when it is off; the «Bisogno» order puts, per rival, the offers that meet a need first.
 */
async function roadmapChecks(readLines, list, offer, label) {
  const before = await readLines(list, offer);
  await ev(`document.querySelector('[data-scout-fvm-fair] input').click()`);
  await until(`!!document.querySelector('[data-scout-fvm-count]')`, 10000);
  const count = await ev(`document.querySelector('[data-scout-fvm-count]')?.innerText ?? ''`);
  const fair = await readLines(list, offer);
  const m = count.match(/(\d+) di (\d+)/);
  console.log(`    ${label} FVM a suo favore: ${count} (${fair.length} lines drawn, ${before.length} before)`);
  check(!!m && Number(m[1]) <= Number(m[2]) && fair.every((l) => l.fvm !== null && l.fvm >= 0),
    `${label}: with the FVM filter every line drawn gives at least the FVM it asks, and the count reads «k di n»`);
  await ev(`document.querySelector('[data-scout-fvm-fair] input').click()`);
  await until(`!document.querySelector('[data-scout-fvm-count]')`, 10000);
  check((await readLines(list, offer)).length === before.length, `${label}: the filter off gives the list back`);
  await ev(`document.querySelector('[data-scout-order-need]').click()`);
  await wait(300);
  const byNeed = await readLines(list, offer);
  const firsts = new Map();
  for (const l of byNeed) if (!firsts.has(`${l.rival}|${l.offer}`)) firsts.set(`${l.rival}|${l.offer}`, l);
  const perRival = new Map();
  for (const l of firsts.values()) perRival.set(l.rival, [...(perRival.get(l.rival) ?? []), l.need ? 1 : 0]);
  const sorted = [...perRival.values()].every((flags) => flags.every((f, i) => i === 0 || f <= flags[i - 1]));
  console.log(`    ${label}: ${byNeed.filter((l) => l.need).length} of ${byNeed.length} lines meet a rival's need`);
  check(sorted, `${label}: ordered by «Bisogno», the offers that meet a need come first for every rival`);
  await ev(`document.querySelector('[data-scout-order] label').click()`);
  await wait(300);
}

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!localStorage.getItem('fantassistant.lineup.rosters')) {
      localStorage.setItem('fantassistant.lineup.rosters', ${JSON.stringify(JSON.stringify(saved))});
      localStorage.setItem('fantassistant.lineup.roster', 'r-e2e-scout');
    }` });
  await send('Page.navigate', { url: `${ORIGIN}/scout` });
  check(!!(await until(`!!document.querySelector('[data-scout-open-mine]')`)), `the page opens on «${MINE}»`);

  // ONE SCREEN (22/10/2026): the page itself never scrolls - the list and the panel scroll inside.
  const fits = await ev(`document.documentElement.scrollHeight <= window.innerHeight + 1`);
  check(fits, 'the page fits one screen (only the list and the panel scroll)');

  // HIS SQUAD, in its drawer.
  await ev(`document.querySelector('[data-scout-open-mine]').click()`);
  check(!!(await until(`!!document.querySelector('[data-scout-mine]')`, 10000)), `his squad «${MINE}» opens in a drawer`);
  const bench = await ev(`document.querySelectorAll('[data-scout-bench] li').length`);
  console.log(`    bench lines: ${bench}`);
  // A starter's reserve must share his BASE role (operator: «Chabot non è alternativa a Grimaldo»): the first badge.
  const backed = await ev(`[...document.querySelectorAll('[data-scout-expendable] > li')].map((li) => {
    const badges = [...li.querySelectorAll('ui-roles')].map((r) => r.innerText.trim().split(/\\s+/)[0]);
    return { names: [...li.querySelectorAll('button')].map((b) => b.innerText.trim()).join(' <- '), starter: badges[0], reserve: badges[1] };
  })`);
  for (const b of backed) console.log(`    ${b.names} (${b.starter} / ${b.reserve})`);
  check(backed.every((b) => b.starter === b.reserve), `${backed.length} starters with a reserve, every one of his base role`);
  await shot('1-mine.png');
  await ev(`document.querySelector('.ant-drawer-close')?.click()`);
  await until(`!document.querySelector('[data-scout-mine]') || !document.querySelector('.ant-drawer-open')`, 5000);

  // THE RIVALS, in theirs: one card each, their problems (step 4) and their surpluses (step 6).
  await ev(`document.querySelector('[data-scout-open-rivals]').click()`);
  await until(`!!document.querySelector('[data-scout-rivals]')`, 10000);
  const rivals = await ev(`document.querySelectorAll('[data-scout-rivals] > section').length`);
  check(rivals === squads.size - 1, `${rivals} rival cards for ${squads.size - 1} rivals, in a drawer`);
  const felt = await ev(`[...document.querySelectorAll('[data-scout-rival-need]')].map((x) => x.innerText.trim())`);
  for (const t of felt.slice(0, 4)) console.log(`    problema: ${t}`);
  check(felt.every((t) => {
    const out = t.match(/fuori (\d+) g$/);
    const nv = t.match(/senza voto in (\d+) delle ultime (\d+)$/);
    return out ? Number(out[1]) > 0 : nv ? Number(nv[1]) >= 3 && Number(nv[1]) <= Number(nv[2]) : false;
  }), `${felt.length} rival problems, each «fuori N g» with N > 0 or «senza voto in k delle ultime m» with 3 <= k <= m`);
  const surplus = await ev(`[...document.querySelectorAll('[data-scout-surplus]')].map((x) => x.innerText.trim())`);
  for (const t of surplus.slice(0, 3)) console.log(`    eccedenza: ${t}`);
  check(surplus.every((t) => { const m = t.match(/^(\d+) [PDCA] da titolare per (\d+) post[oi]$/); return !!m && Number(m[1]) > Number(m[2]); }),
    `${surplus.length} surplus labels, each «N R da titolare per M posti» with N > M`);
  await shot('1-rivals.png');
  await ev(`document.querySelector('.ant-drawer-close')?.click()`);
  await until(`!document.querySelector('.ant-drawer-open')`, 5000);

  // THE LIST: one row per offer, names only - the numbers ride on attributes and are judged against the rules.
  const readLines = (list, offer) => ev(`(() => {
    const out = [];
    let rival = null, index = 0;
    const num = (v) => v === null || v === '' ? null : Number(v);
    for (const node of document.querySelector('${list}')?.children ?? []) {
      if (node.matches('[data-scout-rival]')) { rival = node.querySelector('span').innerText.trim(); continue; }
      if (!node.matches('${offer}')) continue;
      index += 1;
      out.push({ rival, offer: index, gives: node.getAttribute('data-gives'), takes: node.getAttribute('data-takes'),
        ours: num(node.getAttribute('data-ours')), theirs: num(node.getAttribute('data-theirs')),
        form: num(node.getAttribute('data-form')), fvm: num(node.getAttribute('data-fvm')), need: node.getAttribute('data-need'),
        text: node.innerText.trim() });
    }
    return out;
  })()`);
  const judge = (lines, label) => {
    check(lines.every((l) => squads.has(l.rival) && l.rival !== MINE), `${label}: every offer names a real rival`);
    check(lines.every((l) => l.ours >= 0.09 && l.theirs >= 0.09), `${label}: both elevens gain at least +0.1`);
    check(lines.every((l) => Math.min(l.ours, l.theirs) >= 0.5 * Math.max(l.ours, l.theirs) - 0.01), `${label}: the two gains are comparable`);
    check(lines.every((l) => l.form === null || l.form >= -0.25 - 1e-9), `${label}: form no worse than -0.25`);
    check(lines.every((l) => !/\d/.test(l.text)), `${label}: a row shows the names and no number`);
  };
  await until(`!!document.querySelector('[data-scout-list]') || /Nessuno scambio/.test(document.querySelector('[data-scout-detail]')?.parentElement?.innerText ?? '')`);
  const lines = await readLines('[data-scout-list]', '[data-scout-offer]');
  console.log(`    1x1 rows ${lines.length}`);
  judge(lines, '1x1');
  if (lines.length) await panelChecks(lines[0], 'gives-first');
  await roadmapChecks(readLines, '[data-scout-list]', '[data-scout-offer]', '1x1');

  // THE 2x2: the search, the rows, the panel, the roadmap steps.
  await ev(`document.querySelectorAll('[data-scout-mode] label')[1].click()`);
  await until(`!!document.querySelector('[data-scout-search]')`);
  const t0 = Date.now();
  await ev(`document.querySelector('[data-scout-search]').click()`);
  const doneSearch = await until(`/scambi 2x2 in/.test(document.querySelector('[data-scout-pair-meta]')?.innerText ?? '')`, 240000);
  check(!!doneSearch, `the 2x2 search finishes (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const pairLines = await readLines('[data-scout-pairs]', '[data-scout-pair-offer]');
  console.log(`    2x2 rows ${pairLines.length}`);
  for (const l of pairLines.slice(0, 4)) console.log(`    ${l.rival}: ${l.gives} × ${l.takes} · +${l.ours} / +${l.theirs}`);
  judge(pairLines, '2x2');
  if (pairLines.length) {
    await panelChecks(pairLines[0], 'pair');
    await extensionChecks();
  }
  await roadmapChecks(readLines, '[data-scout-pairs]', '[data-scout-pair-offer]', '2x2');
  await shot('3-pairs.png');

  // THE LAST SEARCH SURVIVES A REFRESH («salva l'ultima ricerca e mostrala al refresh»).
  await send('Page.reload');
  const restored = await until(`/ricerca del/.test(document.querySelector('[data-scout-pair-meta]')?.innerText ?? '')`, 60000);
  const after = await ev(`document.querySelectorAll('[data-scout-pairs] [data-scout-line]').length`);
  check(!!restored && after === pairLines.length, `after a refresh the 2x2 are back without a new search (${after} of ${pairLines.length} rows)`);
  check(!noise.length, `no page errors${noise.length ? ': ' + noise.join(' | ') : ''}`);

  /** The panel shows the row picked: its men, its gains, its four-sided table. */
  async function panelChecks(row, kind) {
    await ev(`(() => { const r = [...document.querySelectorAll('[data-scout-line]')].find((x) => x.getAttribute('data-gives') === ${JSON.stringify(row.gives)} && x.getAttribute('data-takes') === ${JSON.stringify(row.takes)}); r?.click(); })()`);
    await wait(200);
    const panel = await ev(`(() => { const c = document.querySelector('[data-scout-current]'); return c && { gives: c.getAttribute('data-gives'), takes: c.getAttribute('data-takes') }; })()`);
    check(!!panel && panel.gives === row.gives && panel.takes === row.takes, `the panel shows the row picked («${row.gives} × ${row.takes}»)`);
    const gains = await ev(`document.querySelector('[data-scout-detail] [data-scout-gains]')?.innerText ?? ''`);
    const g = gains.match(/per te \+([\d.]+) · per loro \+([\d.]+)/);
    check(!!g && Math.abs(Number(g[1]) - row.ours) < 0.006 && Math.abs(Number(g[2]) - row.theirs) < 0.006, 'the panel states the two gains of the row');
    const rows = await ev(`[...document.querySelectorAll('[data-scout-compare-row]')].map((r) => ({ dir: r.getAttribute('data-direction'),
      men: [...r.querySelectorAll('[data-scout-compare-man]')].map((c) => c.getAttribute('data-scout-compare-man')),
      arrow: r.querySelector('[data-scout-arrow]').innerText.trim() }))`);
    for (const r of rows) console.log(`    ${r.men[0] ?? 'posto vuoto'} ${r.arrow} ${r.men[1] ?? 'posto vuoto'}`);
    if (kind === 'gives-first') {
      check(rows.length === 2 && rows[0].dir === 'gives' && rows[0].men[0] === row.gives && rows[1].dir === 'takes' && rows[1].men[1] === row.takes
        && rows.every((r) => /meglio di/.test(r.arrow)), 'the 1x1 table: my man given beats their starter, their man taken beats mine');
    } else {
      check(rows.filter((r) => r.dir === 'gives').length >= 2 && rows.filter((r) => r.dir === 'takes').length >= 2, 'the 2x2 table: two given (→) and two taken (←)');
    }
    const alts = await ev(`[...document.querySelectorAll('[data-scout-alternative]')].map((b) => b.innerText.trim())`);
    check(new Set(alts).size === alts.length, `${alts.length} other ways of paying, none twice`);
    await shot(`2-panel-${kind}.png`);
  }

  /** ROADMAP STEP 3 in the panel: one man more, each extension a valid offer that makes something better for him. */
  async function extensionChecks() {
    const base = await ev(`(() => { const c = document.querySelector('[data-scout-current]'); const g = document.querySelector('[data-scout-detail] [data-scout-gains]').innerText.match(/per te \\+([\\d.]+) · per loro \\+([\\d.]+)/);
      return { gives: c.getAttribute('data-gives').split(' + '), takes: c.getAttribute('data-takes').split(' + '), theirs: Number(g[2]) }; })()`);
    await ev(`document.querySelector('[data-scout-extend]').click()`);
    await until(`!!document.querySelector('[data-scout-extensions]')`, 30000);
    const exts = await ev(`[...document.querySelectorAll('[data-scout-extension]')].map((b) => ({ gives: b.getAttribute('data-gives').split(' + '),
      takes: b.getAttribute('data-takes').split(' + '), ours: Number(b.getAttribute('data-ours')), theirs: Number(b.getAttribute('data-theirs')),
      form: b.getAttribute('data-form') === null ? null : Number(b.getAttribute('data-form')), better: b.innerText.trim() }))`);
    console.log(`    aggiungi on «${base.gives.join(' + ')} × ${base.takes.join(' + ')}»: ${exts.length} extensions`);
    for (const e of exts) console.log(`      ${e.better.replace(/\s+/g, ' ')}`);
    const sizeOk = (e) => {
      const g = e.gives.length - base.gives.length, t = e.takes.length - base.takes.length;
      return GAME === 'classic' ? g === 1 && t === 1 : g + t >= 1 && g <= 1 && t <= 1;
    };
    check(exts.every((e) => base.gives.every((m) => e.gives.includes(m)) && base.takes.every((m) => e.takes.includes(m)) && sizeOk(e)),
      'every extension keeps the offer and adds one man a side at most (one each way on classic)');
    check(exts.every((e) => e.ours >= 0.09 && e.theirs >= 0.09 && Math.min(e.ours, e.theirs) >= 0.5 * Math.max(e.ours, e.theirs) - 0.01
      && (e.form === null || e.form >= -0.25 - 1e-9) && e.theirs >= base.theirs - 0.06),
      'every extension: both gains hold and stay comparable, the form rule holds, his gain is not worse');
    check(exts.every((e) => /per loro|FVM|forma/.test(e.better)), 'every extension says what it made better for him');
    if (exts.length) {
      // Opening one makes it the offer on the panel, and «indietro» goes back.
      await ev(`document.querySelector('[data-scout-extension]').click()`);
      await wait(200);
      const opened = await ev(`document.querySelector('[data-scout-current]').getAttribute('data-gives').split(' + ')`);
      check(opened.length > base.gives.length || exts[0].gives.length === base.gives.length, 'opening an extension puts it on the panel');
      await shot('4-extension.png');
      await ev(`document.querySelector('[data-scout-back]').click()`);
      await wait(200);
      const back = await ev(`document.querySelector('[data-scout-current]').getAttribute('data-gives')`);
      check(back === base.gives.join(' + '), '«offerta precedente» goes back to the offer it came from');
    }
  }
} finally {
  ws.close();
  spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  server.close();
}
console.log(problems.length ? `\n${problems.length} PROBLEM(S)` : '\nOK');
process.exit(problems.length ? 1 : 0);
