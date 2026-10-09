/**
 * THE FORMAZIONE PAGE AGAINST A FAKE LEGHE (09/10/2026): `/lineup` from `dist/`, with every Leghe answer served
 * here, so the page can be checked as often as needed WITHOUT asking Leghe anything (operator, 09/10/2026:
 * «limitiamo al minimo le richieste»). The real-account bench is `e2e-lineup-live.mjs`; this one never logs in.
 *
 * Two leagues, the same two shapes the operator plays: a classic Leghe league and a Mantra EuroLeghe one. The
 * players are real footballers with their real ids (the id IS the bundle's `fc_id`, which is what the page
 * joins on); the leagues, teams and percentages are made up. What it measures, each step saying how many
 * things it looked at:
 *   - THE ROLE FILTER (operator, 09/10/2026), the Draft Assistant's own chips (`ui/role-filter`): its chips are
 *     the league's game (4 on classic, the rulebook's 12 on Mantra, in its order), two roles picked with a real
 *     pointer leave exactly the men holding either, and its ✕ gives the roster back. The expected men come from
 *     the fake roster, never from the screen.
 *   - THE KEEPERS' ODDS SORT (operator, 09/10/2026: «le quote dei portieri ... *-1»): on «Quota» the
 *     clean-sheet prices make one block and the goal prices another, in both directions, and no cell prints
 *     a minus. Prices seeded in the page's own odds cache, so no request leaves for the Sheet either.
 *   - THE MATCH TOOLTIP (operator, 09/10/2026: «PSG-MAN ... MAN che squadra è?»): a PSG man's opponent is
 *     outside the EuroLeghe perimeter, so Leghe's `championship/teams` does not name it; with the bundle's
 *     `fc_teams` the tooltip reads «Le Mans», and WITHOUT it (the counter-check, same page reloaded) it falls
 *     back to the three letters. `fc_teams` is served here from a small table, because the bundle in
 *     `public/data` may predate it.
 *
 * Usage (after `npx ng build`): node scripts/e2e-lineup-offline.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gz': 'application/gzip', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

// ---- THE FAKE LEGHE. Leghe's role ids (`leghe-matchday.ts`): classic 1-4, Mantra 6-19.
const row = (pid, plyr, role, tid, tidOp, teamH, teamA, hoaw, champ, percent) =>
  ({ pid, plyr, role, tid, tidOp, teamH, teamA, hoaw, champ, percent, status: 1, comment: '', descr: '',
    agrd: 6.5, fagrd: 7, trnsf: 0, tname: '' });
const INTER = (pid, plyr, role, percent) => row(pid, plyr, role, 9, 2, 'INT', 'BOL', 0, 'ITA', percent);
const PSG = (pid, plyr, role, percent) => row(pid, plyr, role, 81, 166, 'PSG', 'MAN', 0, 'FRA', percent);
const CLASSIC = [
  INTER(5116, 'Martinez Jo.', [1], 95), INTER(1926, 'Di Gennaro', [1], 5),
  INTER(254, 'Dimarco', [2], 90), INTER(2120, 'Bastoni', [2], 90), INTER(4159, 'Akanji', [2], 85),
  INTER(6217, 'Bisseck', [2], 40), INTER(1870, 'Barella', [3], 90), INTER(2194, 'Calhanoglu', [3], 85),
  INTER(152, 'Zielinski', [3], 45), INTER(4871, 'Thuram', [4], 90), INTER(2764, 'Martinez L.', [4], 90),
  INTER(6669, 'Bonny', [4], 30),
];
const MANTRA = [
  PSG(6708, 'Chevalier', [6], 90), PSG(4160, 'Hakimi', [7, 10], 90), PSG(2374, 'Marquinhos', [9], 90),
  PSG(5700, 'Nuno Mendes', [8, 10], 85), PSG(6305, 'Pacho', [9], 80),
  INTER(254, 'Dimarco', [8, 10], 90), INTER(1870, 'Barella', [12, 11], 90), INTER(2194, 'Calhanoglu', [11, 12], 85),
  INTER(4871, 'Thuram', [16], 90), INTER(2764, 'Martinez L.', [16], 90), INTER(152, 'Zielinski', [12, 13], 45),
];
const LEAGUES = {
  classic: { id: 2001, name: 'Lega di prova', sroles: 1, mods: ['343', '352', '433', '442'], roster: CLASSIC,
    // Leghe's Serie A list names everybody; here only Inter, so the classic odds join confirms the opponent by code.
    teams: [{ id_s: 9, s: 'Inter', sigla: 'INT', camp: 'ITA' }] },
  euro: { id: 3001, name: 'Lega euro di prova', sroles: 2, mods: ['4231', '343', '3412'], roster: MANTRA,
    // THE PERIMETER: PSG and Inter, and NOT Le Mans (166) - which is the whole reason for `fc_teams`.
    teams: [{ id_s: 81, s: 'Paris Saint-Germain', sigla: 'PSG', camp: 'FRA' },
      { id_s: 9, s: 'Inter', sigla: 'INT', camp: 'ITA' }] },
};
function leghe(platform, path) {
  const league = LEAGUES[platform];
  if (!league) return null;
  const answers = {
    '/onboarding/v1/league/status': { mday: 5 },
    '/onboarding/v1/league/settings/lineup': { mods: league.mods, tbench: 7 },
    '/onboarding/v1/league/settings/calculate': {},
    '/onboarding/v1/league/settings/rosters': { sroles: league.sroles },
    '/onboarding/v1/league/competitions': [{ id: 11, name: 'Campionato', type: 2, tmids: [5] }],
    '/onboarding/v1/league/teams/my': { id: 5, n: 'Mia', d: 'A' },
    '/gaming/v1/league/timing': 86_400_000,
    '/onboarding/v1/championship/teams': { teams: league.teams },
    '/onboarding/v1/league/teams?page=1&pageSize=50&division=A': { data: [{ id: 5, n: 'Mia' }], pages: 1 },
    '/gaming/v1/teamLineup/visualizza/A/11': {
      lineUpInfo: league.roster, teamLineupDto: { mdl: '', starts: [], bench: [], mday: 5, cmday: 5, ldate: 0 } },
  };
  return path in answers ? answers[path] : null;
}

// ---- `fc_teams` as the toolkit writes it: Paris Saint-Germain 81, Le Mans 166, Bologna 2 (09/10/2026 page).
let serveFcTeams = true;
/** Requests that reached the fake Leghe: the page without a login must not add one. */
let legheAsked = 0;
const FC_TEAMS = gzipSync(JSON.stringify({ table: 'fc_teams', columns: ['team_id', 'name', 'observed_on'],
  rows: [[2, 'Bologna', '2026-10-09'], [9, 'Inter', '2026-10-09'], [81, 'Paris Saint-Germain', '2026-10-09'],
    [166, 'Le Mans', '2026-10-09']] }));

// ---- THE PRICES, in the page's own cache: Inter v Bologna, five+ Inter scorers (the join wants five men of
// the club among them) and both clean sheets. The two Inter keepers read the home clean sheet.
const ODDS = { matches: [{
  league: 'serie-a', match: 'Inter v Bologna', kickoff: new Date(Date.now() + 86_400_000).toISOString(),
  taken: new Date().toISOString(), home: 'Inter', away: 'Bologna', homeShort: 'INT', awayShort: 'BOL',
  goal: [['Lautaro Martinez', 2.1], ['Marcus Thuram', 2.5], ['Ange-Yoan Bonny', 3.4], ['Hakan Calhanoglu', 4.2],
    ['Nicolo Barella', 5.0], ['Federico Dimarco', 6.0], ['Alessandro Bastoni', 9.0], ['Manuel Akanji', 12.0]]
    .map(([name, price]) => ({ name, price, prob: 1 / price, books: 8, min: price, max: price })),
  cleanSheet: { home: { price: 2.6, prob: 1 / 2.6, books: 8, min: 2.6, max: 2.6 },
    away: { price: 4.5, prob: 1 / 4.5, books: 8, min: 4.5, max: 4.5 } },
}] };

function serve() {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const url = decodeURIComponent(req.url);
      const api = url.match(/^\/leghe-api\/(classic|euro)(\/.*)$/);
      if (api) {
        legheAsked += 1;
        const body = leghe(api[1], api[2]);
        res.writeHead(body === null ? 404 : 200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(body ?? { code: 'NOPE' }));
      }
      const path = url.split('?')[0];
      if (path === '/data/fc_teams.json.gz') {
        if (!serveFcTeams) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/gzip', 'content-encoding': 'gzip' });
        return res.end(FC_TEAMS);
      }
      let file = join(DIST, path);
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        ...(extname(file) === '.gz' ? { 'content-encoding': 'gzip' } : {}) });
      res.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port }));
  });
}

async function devToolsPort(p) {
  for (let i = 0; i < 80; i += 1) {
    try { return (await readFile(join(p, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); }
    catch { await wait(250); }
  }
  throw new Error('no DevToolsActivePort');
}
async function attach(port) {
  let list;
  for (let i = 0; i < 60; i += 1) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((o) => o.type === 'page')) break; } catch { /* still coming up */ }
    await wait(250);
  }
  const page = list.find((o) => o.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((d, f) => { socket.addEventListener('open', d, { once: true });
    socket.addEventListener('error', f, { once: true }); });
  let seq = 0; const pending = new Map(); const noise = [];
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') noise.push(String(m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text).slice(0, 200));
    const w = pending.get(m.id); if (!w) return;
    pending.delete(m.id); m.error ? w.f(new Error(JSON.stringify(m.error))) : w.d(m.result);
  });
  return { send: (method, params = {}) => new Promise((d, f) => {
    const id = (seq += 1); pending.set(id, { d, f });
    socket.send(JSON.stringify({ id, method, params })); }), noise };
}
async function ev(s, fn, ...args) {
  const r = await s.send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`,
    returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
  return r.result.value;
}
async function until(s, fn, ms = 30000, ...args) {
  for (let t = 0; t < ms; t += 200) { const v = await ev(s, fn, ...args); if (v) return v; await wait(200); }
  return null;
}
/** A REAL pointer at the coordinates the browser reports: `element.click()` passes over the CSS. */
async function click(s, x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse' });
  }
}
/** The centre of the first element matching `selector` whose text matches `text` (null = any), still. */
async function centre(s, selector, text = null) {
  let last = null;
  for (let i = 0; i < 40; i += 1) {
    const box = await ev(s, (sel, txt) => {
      const el = [...document.querySelectorAll(sel)].find((e) => txt === null || new RegExp(txt).test(e.textContent));
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, selector, text);
    if (box && last && box.x === last.x && box.y === last.y) return box;
    last = box;
    await wait(80);
  }
  return last;
}

const problems = [];
const check = (ok, said, problem) => { console.log(`${ok ? '·' : 'X'} ${said}`); if (!ok) problems.push(problem ?? said); };

const binary = BROWSERS.find((o) => existsSync(o));
const profile = await mkdtemp(join(tmpdir(), 'lineup-offline-'));
const { server, port } = await serve();
const browser = spawn(binary, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1600,1100', 'about:blank'], { stdio: 'ignore' });
try {
  const s = await attach(await devToolsPort(profile));
  await s.send('Runtime.enable');
  await s.send('Page.enable');
  await s.send('Network.enable');
  // Nothing leaves for Google: the Sheet's prices come from the seeded cache, the probable line-ups are not read.
  await s.send('Network.setBlockedURLs', { urls: ['*script.google.com*', '*googleusercontent.com*'] });
  const accounts = {
    classic: { platform: 'classic', userId: 1, via: 'embed',
      leagues: [{ platform: 'classic', id: LEAGUES.classic.id, name: LEAGUES.classic.name, alias: '', jwt: TOKEN, game: null }] },
    euro: { platform: 'euro', userId: 1, via: 'direct',
      leagues: [{ platform: 'euro', id: LEAGUES.euro.id, name: LEAGUES.euro.name, alias: '', jwt: TOKEN, game: 'mantra' }] },
  };
  const oddsCache = JSON.stringify({ at: new Date().toISOString(), body: JSON.stringify(ODDS) });
  await s.send('Page.addScriptToEvaluateOnNewDocument', { source: `try {
    if (!localStorage.getItem('e2e.no-token')) sessionStorage.setItem('leghe.accounts', ${JSON.stringify(JSON.stringify(accounts))});
    if (!localStorage.getItem('fantassistant.leghe-league')) localStorage.setItem('fantassistant.leghe-league', 'classic:${LEAGUES.classic.id}');
    localStorage.setItem('fantassistant.bookmaker-odds-cache', ${JSON.stringify(oddsCache)});
  } catch {}` });
  await s.send('Page.navigate', { url: `http://127.0.0.1:${port}/lineup` });

  const rows = () => ev(s, () => [...document.querySelectorAll('[data-lineup-roster] li[data-fc-id]')].map((li) => {
    const odds = li.querySelector('[data-odds-kind]');
    return { id: Number(li.getAttribute('data-fc-id')), kind: odds?.getAttribute('data-odds-kind') ?? null,
      text: odds?.textContent.trim() ?? null };
  }));
  const loaded = (n) => until(s, (count) => document.querySelectorAll('[data-lineup-roster] li[data-fc-id]').length === count, 40000, n);

  // ================================================================ 1. CLASSIC: the role filter
  // THE DRAFT ASSISTANT'S OWN CHIPS (operator, 09/10/2026: «deve essere esattamente lo stesso»): the same
  // component, so the same `data-role-filter` hooks the draft benches press.
  check(!!(await loaded(CLASSIC.length)), `la lega classic disegna ${CLASSIC.length} righe`, 'la rosa classic non arriva');
  const chips = () => ev(s, () => [...document.querySelectorAll('[data-lineup-role-filter] [data-role-filter]')].map((b) => b.getAttribute('data-role-filter')));
  let options = await chips();
  check(JSON.stringify(options) === JSON.stringify(['p', 'd', 'c', 'a']),
    `classic: i chip del filtro sono ${options.length} (${options.join(' ')})`, `classic: chip ${options.join(' ')}, attesi p d c a`);
  for (const role of ['d', 'a']) {
    const at = await centre(s, `[data-lineup-role-filter] [data-role-filter="${role}"]`);
    if (at) await click(s, at.x, at.y); else problems.push(`nessun chip ${role} da premere`);
    await wait(200);
  }
  const wantDA = CLASSIC.filter((m) => m.role.some((r) => r === 2 || r === 4)).map((m) => m.pid).sort();
  const seenDA = (await rows()).map((r) => r.id).sort();
  check(JSON.stringify(seenDA) === JSON.stringify(wantDA),
    `D + A: ${seenDA.length} righe a schermo, ${wantDA.length} nella rosa finta con D o A`,
    `D + A: schermo ${seenDA.join(',')} contro ${wantDA.join(',')}`);
  const count = await ev(s, () => document.querySelector('[data-lineup-role-count]')?.textContent.trim() ?? null);
  check(count === `${wantDA.length} di ${CLASSIC.length}`, `il conteggio dice «${count}»`);
  const clear = await centre(s, '[data-lineup-role-filter] [data-role-filter-clear]');
  if (clear) await click(s, clear.x, clear.y);
  check(!!(await loaded(CLASSIC.length)), `svuotato il filtro: tornano ${CLASSIC.length} righe`, 'il filtro non si svuota col suo ✕');

  // ================================================================ 2. CLASSIC: the keepers' odds sort
  await until(s, () => document.querySelectorAll('[data-lineup-roster] [data-odds-kind]').length >= 4, 10000);
  const header = await centre(s, '[data-lineup-roster] .lineup-grid span', '^Quota');
  const blocks = (list) => list.filter((r) => r.kind).map((r) => r.kind).filter((k, i, all) => i === 0 || all[i - 1] !== k);
  await click(s, header.x, header.y);
  await wait(400);
  let seen = await rows();
  const priced = seen.filter((r) => r.kind);
  check(priced.length >= 4, `quote a schermo: ${priced.length} (${priced.filter((r) => r.kind === 'clean-sheet').length} porte inviolate)`);
  check(JSON.stringify(blocks(seen)) === JSON.stringify(['clean-sheet', 'goal']),
    `Quota crescente: blocchi ${blocks(seen).join(' | ')}`, `Quota crescente: i blocchi sono ${blocks(seen).join(' | ')}`);
  check(seen.at(-1)?.kind === null || seen.every((r) => r.kind), 'senza quota in fondo', 'un uomo senza quota non è in fondo');
  check(priced.every((r) => !r.text.includes('-')), 'nessuna quota stampata col meno');
  await click(s, header.x, header.y);
  await wait(400);
  seen = await rows();
  check(JSON.stringify(blocks(seen)) === JSON.stringify(['goal', 'clean-sheet']),
    `Quota decrescente: blocchi ${blocks(seen).join(' | ')}`, `Quota decrescente: i blocchi sono ${blocks(seen).join(' | ')}`);

  // ================================================================ 3. EUROLEGHE MANTRA: filter choices + tooltip
  const league = await centre(s, '[data-lineup-league]');
  await click(s, league.x, league.y);
  await until(s, () => document.querySelectorAll('nz-option-item').length > 1, 5000);
  const euroOption = await centre(s, 'nz-option-item', 'euro di prova');
  await click(s, euroOption.x, euroOption.y);
  check(!!(await loaded(MANTRA.length)), `la lega euro disegna ${MANTRA.length} righe`, 'la rosa euro non arriva');
  // The draft page's chips in the draft page's order: the rulebook's own vocabulary (`mantra_modules.json`).
  options = await chips();
  const rulebook = JSON.parse(readFileSync(join(DIST, 'data', 'mantra_modules.json'), 'utf8')).roles.map((r) => r.toLowerCase());
  check(JSON.stringify(options) === JSON.stringify(rulebook),
    `mantra: i chip del filtro sono ${options.length} (${options.join(' ')}), nell'ordine del regolamento`,
    `mantra: chip ${options.join(' ')}, attesi ${rulebook.join(' ')}`);

  // THE MODULE SELECT IS NOT EMPTY ON OPENING (operator, 09/10/2026: «perchè inizialmente la select del modulo è
  // vuota?»): nz-select drew the «automatic» choice, whose value was null, as an empty box.
  const selectText = await until(s, () => document.querySelector('[data-module-select]')?.textContent.trim() || null, 10000);
  check(/automatico/.test(selectText ?? ''), `il selettore del modulo all'apertura dice «${selectText}»`);
  // THE BENCH SAYS HOW MANY STARTERS IT COVERS (operator: «essere CERTI che non ci siano buchi»).
  const coverText = await until(s, () => document.querySelector('[data-lineup-cover]')?.textContent.trim() || null, 10000);
  check(/^· copre \d+ di \d+$/.test(coverText ?? ''), `la panchina dice «${coverText}»`);

  // THE FRONT THREE OF A 3-4-3 (operator, 09/10/2026: «le W devono stare ai lati, la Pc al centro»): the
  // rulebook writes `W/A, W/A, A/PC`, the pitch must draw the Pc between the two W.
  const moduleSelect = await centre(s, '[data-module-select]');
  await click(s, moduleSelect.x, moduleSelect.y);
  await until(s, () => document.querySelectorAll('nz-option-item').length > 1, 5000);
  // The list is sorted by FVA and taller than its panel: bring the option into the panel's own view first, or
  // its centre lies below the panel and the click lands outside it (which closes the menu).
  await ev(s, () => [...document.querySelectorAll('nz-option-item')].find((o) => /^\s*3-4-3 /.test(o.textContent))?.scrollIntoView({ block: 'nearest' }));
  const three = await centre(s, 'nz-option-item', '^\\s*3-4-3 ');
  if (three) await click(s, three.x, three.y); else problems.push('nessuna voce 3-4-3 nel menu dei moduli');
  const front = await until(s, () => {
    const row = document.querySelector('[data-lineup-pitch] [data-line="A"]');
    const slots = row ? [...row.querySelectorAll('[data-place]')].map((p) => p.getAttribute('data-slot')) : [];
    return slots.length === 3 ? slots : null;
  }, 10000);
  if (!front) {
    console.log('  (debug)', await ev(s, () => ({
      options: [...document.querySelectorAll('nz-option-item')].map((o) => o.textContent.trim()).slice(0, 4),
      chosen: document.querySelector('[data-module-select]')?.textContent.trim(),
      rows: [...document.querySelectorAll('[data-lineup-pitch] [data-line]')].map((r) => `${r.getAttribute('data-line')}:${[...r.querySelectorAll('[data-place]')].map((p) => p.getAttribute('data-slot')).join(',')}`),
    })));
  }
  check(JSON.stringify(front) === JSON.stringify(['W/A', 'A/PC', 'W/A']),
    `3-4-3, la linea d'attacco a schermo: ${front?.join(' · ')}`, `3-4-3: attacco ${front?.join(' · ')}, atteso W/A · A/PC · W/A`);

  const tooltipOf = async (fcId) => {
    const at = await centre(s, `[data-lineup-roster] li[data-fc-id="${fcId}"] [nz-tooltip].truncate`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await wait(200);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    return until(s, () => document.querySelector('.ant-tooltip-inner')?.textContent.trim() || null, 5000);
  };
  const withNames = await tooltipOf(2374);
  check(/^Paris Saint-Germain.* - Le Mans/.test(withNames ?? ''), `con fc_teams: «${withNames}»`);
  // THE COUNTER-CHECK: the same page without the table must fall back to the code, or the line above proves
  // nothing about where «Le Mans» came from.
  serveFcTeams = false;
  await s.send('Page.reload', { ignoreCache: true });
  check(!!(await loaded(MANTRA.length)), 'ricaricata senza fc_teams', 'la rosa euro non torna dopo il reload');
  const withoutNames = await tooltipOf(2374);
  check(/^Paris Saint-Germain.* - MAN$/.test(withoutNames ?? ''), `senza fc_teams: «${withoutNames}»`);

  // ================================================================ 4. WITHOUT A LOGIN: the stored readings
  // Operator, 09/10/2026: «una volta che fai login ... memorizza i dati scaricati e riutilizzali in seguito senza
  // fare il login (mostra solo la data dell'ultimo aggiornamento)». A tab with no token: same rows, the date of
  // the readings in the header, and NOT ONE request to Leghe.
  await ev(s, () => { sessionStorage.clear(); localStorage.setItem('e2e.no-token', '1'); });
  const askedBefore = legheAsked;
  await s.send('Page.reload', { ignoreCache: true });
  check(!!(await loaded(MANTRA.length)), `senza login: la lega euro disegna ancora ${MANTRA.length} righe`, 'senza login la rosa salvata non torna');
  const readLine = await until(s, () => {
    const el = document.querySelector('[data-lineup-read]');
    return el ? { offline: el.hasAttribute('data-offline'), text: el.textContent.replace(/\s+/g, ' ').trim() } : null;
  }, 10000);
  check(!!readLine?.offline && /dati aggiornati/.test(readLine.text), `senza login l'intestazione dice «${readLine?.text}»`);
  await wait(1500);
  check(legheAsked === askedBefore, `senza login: ${legheAsked - askedBefore} richieste a Leghe`);
  const leagues = await ev(s, () => !!document.querySelector('[data-lineup-league]'));
  check(leagues, 'senza login il selettore delle leghe resta', 'senza login il selettore delle leghe sparisce');

  if (s.noise.length) problems.push(`eccezioni in pagina: ${s.noise.slice(0, 3).join(' | ')}`);
} finally {
  console.log(problems.length ? `\nPROBLEMI:\n  ${problems.join('\n  ')}` : '\nnessun problema');
  server.close();
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  else browser.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(problems.length ? 1 : 0);
