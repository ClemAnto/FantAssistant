/**
 * e2e-strategy-filters.mjs - drive the REAL strategy page and measure the two things asked for on
 * 12/09/2026: the four FREQUENCIES, and the composed FILTER with its saved sets.
 *
 * Why a browser, and why a harness of its own. The numbers are a fact about the screen and the filter
 * is a GESTURE: a modal that opens, three controls inside it, a list that shrinks - and a synthetic
 * `element.click()` proves nothing about any of those, because it passes over the CSS (app/CLAUDE.md,
 * measured 20/08/2026 on the table's funnels). `e2e-strategy.mjs` measures the page as a whole and is
 * red on defects that predate this work; this one is about the feature and has to be readable as a
 * verdict on it.
 *
 * THE FOUR NUMBERS ARE CHECKED AGAINST THE BUNDLE and never against the screen, which is the rule this
 * project pays for whenever it forgets it: a share re-derived by dividing what the pill says is the
 * circular assertion. The re-derivation is written HERE on purpose rather than imported, so that a
 * convention changing on one side only is caught instead of followed - and it is restricted to the men
 * whose whole measured football is Serie A, because the page also counts foreign championships and a
 * harness reading a NARROWER population does not stay quiet, it ACCUSES (05/09/2026).
 *
 * Zero dependencies, like the other harnesses: serves `dist/`, launches Edge or Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-strategy-filters.mjs [--headed] [--json] [--shot]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gz': 'application/gzip', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.sqlite': 'application/octet-stream',
};
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

/** Le soglie DICHIARATE dall'operatore, riscritte qui: se una cambia da una parte sola si vede. */
const LONG_SHIFT = 85;
const GOOD_MATCH = 6.5;
const POOR_MATCH = 6;
/** Sotto quante partite la pastiglia va SBIADITA: `match-frequency.THIN_SAMPLE`. */
const THIN_SAMPLE = 10;
/** I campionati che il bundle chiama «campionato»: `players-store.LEAGUE_COMPETITIONS`, riscritti. */
const LEAGUES = new Set(['serie_a', 'premier_league', 'la_liga', 'bundesliga', 'ligue_1', 'serie_b']);
/**
 * LA CONDIZIONE CHE IL BANCO SCRIVE, ed e' scelta perche' TAGLIA A META' invece di svuotare o di non
 * fare niente: un filtro che non lascia passare nessuno e un filtro rotto si leggono uguale, e su una
 * lista vuota non si puo' provare che i posti non siano stati rinumerati.
 */
const WANTED = { label: "Partite oltre l'85'", value: '50' };

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

function freePort() {
  return new Promise((done) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function serve(dir) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    let file = join(dir, path === '/' ? 'index.html' : path);
    if (!existsSync(file) || !extname(file)) file = join(dir, 'index.html');
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch (error) {
      response.writeHead(404);
      response.end(String(error));
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({
    server, port: server.address().port,
  })));
}

async function attach(port) {
  let list;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((one) => one.type === 'page')) break;
    } catch {
      /* the browser is still coming up */
    }
    await wait(250);
  }
  const page = list?.find((one) => one.type === 'page');
  if (!page) throw new Error('no page target: the browser never opened one');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', fail, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const noise = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params?.exceptionDetails;
      noise.push(`ECCEZIONE: ${detail?.exception?.description ?? detail?.text ?? '?'}`.slice(0, 300));
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      noise.push(`CONSOLE: ${message.params.args.map((one) => one.description ?? one.value).join(' ')}`
        .slice(0, 300));
    }
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.fail(new Error(JSON.stringify(message.error)));
    else waiting.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, fail) => {
    const id = (sequence += 1);
    pending.set(id, { done, fail });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => socket.close(), noise: () => noise.splice(0, noise.length) };
}

async function evaluate(session, fn, ...args) {
  const expression = `(${fn.toString()})(${args.map((one) => JSON.stringify(one)).join(',')})`;
  const result = await session.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
  }
  return result.result.value;
}

/** A REAL pointer: hover first, then press and release where the browser says the target is. */
async function click(session, point) {
  const at = { x: Math.round(point.x), y: Math.round(point.y) };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'none' });
  await wait(60);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...at, button: 'left', clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...at, button: 'left', clickCount: 1,
  });
  await wait(300);
}

/**
 * Click a target that has STOPPED MOVING: an antd modal enters with a zoom animation and for ~200ms
 * its controls MOVE, so a click lands where the button no longer is (misurato 27/08/2026).
 */
async function clickSteady(session, selector, tries = 20) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const box = await evaluate(session, boxOf, selector);
    if (!box) return null;
    if (last && Math.round(last.x) === Math.round(box.x) && Math.round(last.y) === Math.round(box.y)) {
      await click(session, box);
      return box;
    }
    last = box;
    await wait(80);
  }
  if (last) await click(session, last);
  return last;
}

async function waitFor(session, fn, tries = 60, ...args) {
  let out = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    out = await evaluate(session, fn, ...args);
    if (out) return out;
    await wait(250);
  }
  return out;
}

// ------------------------------------------------------------------ what runs IN the page

/** Where a control really is, and WHO is under that point: «it is there» is a fact about the DOM. */
function boxOf(selector) {
  const found = document.querySelector(selector);
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const under = document.elementFromPoint(x, y);
  return { x, y, reachable: found.contains(under) || under?.contains(found) || false };
}

/** Le righe con le loro pastiglie, per identita': il confronto vale solo contro il FOGLIO. */
function readRows() {
  return [...document.querySelectorAll('app-strategy ol li[data-id]')].map((row) => {
    const strip = row.querySelector('[data-readings]');
    const pills = strip ? [...strip.querySelectorAll(':scope > span')] : [];
    const name = row.querySelector('span.flex-1');
    return {
      id: Number(row.dataset.id),
      block: [...document.querySelectorAll('app-strategy ol')].indexOf(row.closest('ol')),
      at: (row.querySelector('span.tabular-nums')?.innerText ?? '').trim(),
      say: Object.fromEntries(
        pills.map((one) => [one.dataset.reading ?? '?', (one.innerText ?? '').trim()]),
      ),
      faded: pills.filter((one) => Number(getComputedStyle(one).opacity) < 0.9)
        .map((one) => one.dataset.reading ?? '?'),
      // IL PREZZO DI UNA PASTIGLIA IN PIU' SI PAGA SUL NOME, e si misura invece di sperarlo: «276px di
      // colonne non erano strette, erano ASSENTI» e' la stessa famiglia. Il taglio si legge dal browser
      // e non dal numero di caratteri.
      nameWidth: name ? Math.round(name.getBoundingClientRect().width) : 0,
      nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : false,
      // Su un blocco stretto la fila va a capo, e allora NON toglie un pixel al nome: un passo che
      // misura due incognite insieme attribuisce il difetto a quella sbagliata.
      stripOwnLine: !!(strip && name
        && strip.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 2),
    };
  });
}

/** Le pastiglie della barra, con le coordinate a cui il dito deve arrivare. */
function readToggles() {
  return [...document.querySelectorAll('app-strategy button[data-reading]')].map((one) => {
    const box = one.getBoundingClientRect();
    return {
      key: one.dataset.reading,
      text: (one.innerText ?? '').trim(),
      on: one.getAttribute('aria-pressed') === 'true',
      point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      under: (document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        ?.tagName ?? '').toLowerCase(),
    };
  });
}

/** Lo stato del filtro come lo schermo lo dichiara: i gettoni, il conteggio, e cosa c'e' sul disco. */
function readFilterBar() {
  const chips = [...document.querySelectorAll('app-strategy strategy-filters nz-tag')]
    .map((one) => (one.innerText ?? '').replace(/\s+/g, ' ').trim());
  const said = [...document.querySelectorAll('app-strategy strategy-filters span')]
    .map((one) => (one.innerText ?? '').trim())
    .find((one) => /esclusi$/.test(one)) ?? '';
  let saved = null;
  let sets = null;
  try {
    saved = localStorage.getItem('fantassistant.strategy.filter');
    sets = localStorage.getItem('fantassistant.strategy.filters');
  } catch {
    /* un browser che rifiuta la memoria e' un fatto, non un guasto */
  }
  return { chips, said, saved, sets, rows: document.querySelectorAll('app-strategy ol li[data-id]').length };
}

/** Le righe della finestra dei filtri, e i tre controlli di ognuna. */
function readModal() {
  const modal = document.querySelector('.ant-modal-content');
  if (!modal) return null;
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  return {
    title: (modal.querySelector('.ant-modal-title')?.innerText ?? '').trim(),
    clauses: [...modal.querySelectorAll('[data-clause]')].map((row) => ({
      key: (row.querySelector('[data-clause-key]')?.innerText ?? '').trim(),
      op: (row.querySelector('[data-clause-op]')?.innerText ?? '').trim(),
      value: row.querySelector('[data-clause-value] input')?.value ?? '',
      keyPoint: box(row.querySelector('[data-clause-key]')),
      opPoint: box(row.querySelector('[data-clause-op]')),
      valuePoint: box(row.querySelector('[data-clause-value] input')),
    })),
    sets: [...modal.querySelectorAll('[data-set]')].map((one) => (one.innerText ?? '').trim()),
  };
}

/**
 * LA VOCE DI UNA TENDINA VIRTUALE, cercata SCORRENDO dall'alto: `cdk-virtual-scroll-viewport` disegna
 * solo quello che si vede, quindi «non e' nel DOM» e «non esiste» sono due frasi diverse - e la tendina
 * si apre gia' scorsa sulla voce scelta, quindi cercare in avanti soltanto non trova mai le prime.
 */
async function pickOption(session, label) {
  const seen = new Set();
  await evaluate(session, () => {
    const item = document.querySelector('nz-option-item');
    const holder = item?.closest('cdk-virtual-scroll-viewport, .rc-virtual-list-holder, .ant-select-dropdown');
    if (holder) holder.scrollTop = 0;
    return true;
  });
  await wait(150);
  for (let turn = 0; turn < 40; turn += 1) {
    const step = await evaluate(session, (wanted) => {
      const items = [...document.querySelectorAll('nz-option-item')];
      if (!items.length) return { texts: [], stuck: true };
      const holder = items[0].closest(
        'cdk-virtual-scroll-viewport, .rc-virtual-list-holder, .ant-select-dropdown',
      );
      const texts = items.map((one) => (one.innerText ?? '').trim());
      const item = items.find((one, at) => texts[at] === wanted);
      if (item && holder) {
        holder.scrollTop = item.offsetTop - holder.clientHeight / 2 + item.offsetHeight / 2;
        return { texts, found: true };
      }
      if (!holder) return { texts, stuck: true };
      const before = holder.scrollTop;
      holder.scrollTop = before + Math.max(64, holder.clientHeight - 32);
      return { texts, stuck: holder.scrollTop === before };
    }, label);
    for (const one of step?.texts ?? []) seen.add(one);
    if (step?.found) {
      await wait(250);
      const where = await evaluate(session, (wanted) => {
        const item = [...document.querySelectorAll('nz-option-item')]
          .find((one) => (one.innerText ?? '').trim() === wanted);
        if (!item) return null;
        const rect = item.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return { x, y, under: (document.elementFromPoint(x, y)?.tagName ?? '?').toLowerCase() };
      }, label);
      if (!where) return `la voce «${label}» e' sparita fra la ricerca e il click`;
      await click(session, where);
      await wait(300);
      return null;
    }
    if (step?.stuck) break;
    await wait(120);
  }
  return `la voce «${label}» non e' nel pannello: ci sono ${JSON.stringify([...seen])}`;
}

/** Scrive un numero in una casella VERA: si clicca, si seleziona tutto e si digita. */
async function typeNumber(session, point, text) {
  await click(session, point);
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
  });
  await session.send('Input.insertText', { text });
  await wait(200);
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  await wait(300);
}

async function pressReading(session, key) {
  const now = (await evaluate(session, readToggles)) ?? [];
  const pill = now.find((one) => one.key === key);
  if (!pill) return `nessuna pastiglia «${key}» in barra`;
  if (pill.under !== 'button' && pill.under !== 'span') {
    return `sotto la pastiglia «${key}» c'e' ${pill.under}: e' coperta`;
  }
  const before = pill.on;
  await click(session, pill.point);
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 600, button: 'none' });
  await wait(250);
  const after = ((await evaluate(session, readToggles)) ?? []).find((one) => one.key === key);
  if (after && after.on === before) return `la pastiglia «${key}» non ha cambiato stato`;
  return null;
}

// ------------------------------------------------------------------ il bundle, ri-derivato qui

/**
 * LE QUATTRO FREQUENZE ri-derivate dal pacchetto, per i soli uomini il cui calcio misurato e' TUTTO
 * Serie A.
 *
 * La restrizione e' la cosa che rende il confronto onesto: la pagina conta anche i campionati esteri
 * (`isChampionship` prende `league` e `other_league`), quindi su chi ha giocato altrove un banco che
 * legge i soli voti italiani leggerebbe di meno e ACCUSEREBBE la pagina del proprio difetto - e' quello
 * che e' successo il 06/09/2026 sulle coppie `G:A`, 54 righe.
 *
 * Le convenzioni sono riscritte apposta: un bonus e' gol, rigore segnato, assist, assist da fermo e -
 * per chi ha giocato IN PORTA in quella partita - rigore parato; i minuti li porta il livello
 * per-partita, perche' `match_ratings.minutes` e' NULL su tutte le righe del pacchetto.
 */
async function frequenciesFromBundle() {
  const table = (name) =>
    readFile(join(DIST, 'data', `${name}.json.gz`)).then((raw) =>
      JSON.parse(gunzipSync(raw).toString('utf8')));
  const [ratings, external] = await Promise.all([table('match_ratings'), table('external_match_stats')]);

  const ex = (name) => external.columns.indexOf(name);
  const [xId, xSeason, xCompetition, xRealMd, xMinutes] =
    ['fc_id', 'season', 'competition', 'real_md', 'minutes'].map(ex);
  /**
   * I minuti di ogni giornata, e chi ha giocato in un campionato che non e' la Serie A.
   *
   * NESSUN FILTRO SULLA `source`, ed e' un difetto che questo banco ha commesso e pagato: l'app non ne
   * fa nessuno - `sofascore` e' lo strato di campionato, `sofascore_extra` le coppe e i campionati
   * esteri, `sofascore_recent` la forma di chi qui non ha storia - e leggere solo il primo lasciava
   * fuori le 15 partite di Serie B di un uomo che la pagina conta. Il banco leggeva una popolazione
   * PIU' STRETTA della pagina, e allora non tace: ACCUSA (la lezione del 05/09/2026, 54 righe).
   */
  const minutes = new Map();
  const elsewhere = new Set();
  const synthetic = new Set();
  for (const row of external.rows) {
    const competition = row[xCompetition];
    if (competition === 'serie_a') {
      minutes.set(`${row[xId]}|${row[xSeason]}|${row[xRealMd]}`, row[xMinutes]);
    } else if (LEAGUES.has(competition)) {
      elsewhere.add(Number(row[xId]));
    }
  }

  const at = (name) => ratings.columns.indexOf(name);
  const [rId, rSeason, rMd, rRole, rPlatform, rFantavoto, rGoals, rPen, rAssists, rSetPiece, rSaved] =
    ['fc_id', 'season', 'matchday', 'role', 'platform', 'fantavoto', 'goals', 'pen_scored', 'assists',
      'assists_set_piece', 'pen_saved'].map(at);
  const out = new Map();
  for (const row of ratings.rows) {
    if (row[rPlatform] !== 'default' || row[rRole] === 'ALL') continue;
    const id = Number(row[rId]);
    // ...E CHI HA UNA GIORNATA SENZA FANTAVOTO PUBBLICATO esce dal confronto SULLE DUE QUOTE DEL
    // FANTAVOTO e non dalle altre due: li' l'app ne calcola uno SINTETICO dal voto del provider
    // (`syntheticFantavoto`), e rifare quel conto qui vorrebbe dire riscrivere il punteggio di un
    // campionato dentro un banco. I minuti e i bonus non ne dipendono, quindi restano confrontabili -
    // «ognuna col suo denominatore» applicato alla popolazione del banco invece che a quella della
    // pagina. Si confronta dove le due derivazioni devono coincidere esattamente, e si DICE su quante
    // righe: un banco che restringe in silenzio dice «nessun problema» dopo aver guardato niente.
    if (row[rFantavoto] == null) synthetic.add(id);
    const sum = out.get(id) ?? { played: 0, timed: 0, rated: 0, long: 0, good: 0, poor: 0, bonus: 0 };
    sum.played += 1;
    const played = minutes.get(`${id}|${row[rSeason]}|${row[rMd]}`);
    if (played != null) {
      sum.timed += 1;
      if (played > LONG_SHIFT) sum.long += 1;
    }
    const fantavoto = row[rFantavoto];
    if (fantavoto != null) {
      sum.rated += 1;
      if (fantavoto >= GOOD_MATCH) sum.good += 1;
      if (fantavoto < POOR_MATCH) sum.poor += 1;
    }
    const bonus = (row[rGoals] ?? 0) + (row[rPen] ?? 0) + (row[rAssists] ?? 0) + (row[rSetPiece] ?? 0)
      + (row[rRole] === 'P' ? (row[rSaved] ?? 0) : 0);
    if (bonus > 0) sum.bonus += 1;
    out.set(id, sum);
  }
  const share = (hits, over) => (over ? Math.round((hits / over) * 100) : null);
  const said = new Map();
  for (const [id, sum] of out) {
    if (elsewhere.has(id)) continue;
    const rated = synthetic.has(id);
    said.set(id, {
      played: sum.played,
      timed: sum.timed,
      rated: rated ? null : sum.rated,
      longPlay: share(sum.long, sum.timed),
      goodMatch: rated ? undefined : share(sum.good, sum.rated),
      bonusMatch: share(sum.bonus, sum.played),
      poorMatch: rated ? undefined : share(sum.poor, sum.rated),
    });
  }
  return said;
}

/** Quante giornate di Serie A il pacchetto porta per la stagione BERSAGLIO: il null del passo 3. */
async function playedInTarget() {
  const manifest = JSON.parse(await readFile(join(DIST, 'data', 'manifest.json'), 'utf8'));
  const raw = await readFile(join(DIST, 'data', 'match_ratings.json.gz'));
  const ratings = JSON.parse(gunzipSync(raw).toString('utf8'));
  const at = (name) => ratings.columns.indexOf(name);
  const [season, md, platform] = ['season', 'matchday', 'platform'].map(at);
  let last = 0;
  for (const row of ratings.rows) {
    if (row[platform] !== 'default' || row[season] !== manifest.target_season) continue;
    last = Math.max(last, row[md]);
  }
  return last;
}

// ------------------------------------------------------------------ la corsa

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-filters-'));
  const debugPort = Number(value('--port', String(await freePort())));
  const url = `http://127.0.0.1:${port}/strategy`;
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1000',
    url,
  ], { stdio: 'ignore' });

  const report = { url, steps: [], problems: [] };
  const note = (step, detail) => {
    report.steps.push({ step, ...detail });
    console.log(`· ${step}: ${detail.said ?? ''}`);
    for (const problem of detail.problems ?? []) console.log(`    ⚠ ${problem}`);
    if (detail.problems?.length) report.problems.push(...detail.problems.map((one) => `${step}: ${one}`));
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await wait(500);
    // SI PARTE DALLO STATO DICHIARATO: un filtro salvato da una corsa precedente misurerebbe un'altra
    // lista sotto le stesse aspettative - ed e' proprio la cosa che questa feature puo' fare.
    await evaluate(session, () => {
      try {
        for (const key of ['setup', 'readings', 'filter', 'filters', 'sort']) {
          localStorage.removeItem(`fantassistant.strategy.${key}`);
        }
      } catch {
        /* un browser che rifiuta la memoria e' gia' ai valori di partenza */
      }
      location.reload();
      return true;
    });
    await wait(900);
    const where = await evaluate(session, () => location.href);
    if (!where.startsWith(url.split('?')[0])) {
      throw new Error(`la pagina aperta è ${where}: mi sono attaccato al browser sbagliato`);
    }
    const ready = await waitFor(session, () =>
      document.querySelectorAll('app-strategy ol li[data-id]').length || null, 120);
    if (!ready) throw new Error('nessun nome è mai comparso: il bundle non ha caricato');

    // 1. LE QUATTRO PASTIGLIE esistono, si accendono, e la riga porta i loro numeri.
    //    Il NOME prima e dopo, perche' quattro riquadri in piu' si pagano li'.
    const naked = (await evaluate(session, readRows)) ?? [];
    const keys = ['longPlay', 'goodMatch', 'bonusMatch', 'poorMatch'];
    const pressed = [];
    for (const key of keys) pressed.push(await pressReading(session, key));
    await waitFor(session, () =>
      document.querySelector('app-strategy [data-readings] [data-reading="longPlay"]') ? true : null, 60);
    const rows = (await evaluate(session, readRows)) ?? [];
    const withAll = rows.filter((one) => keys.every((key) => key in one.say));
    const narrowest = (list) => Math.min(...list.map((one) => one.nameWidth));
    const clipped = (list) => list.filter((one) => one.nameClipped).length;
    // ...E LA CONFIGURAZIONE CHE QUESTA FEATURE PORTA DAVVERO: le quattro sole, con le tre di partenza
    // spente. Un costo misurato su SETTE pastiglie e' il costo di sette pastiglie, non di quattro - e
    // un passo che misura due incognite insieme attribuisce il difetto a quella sbagliata.
    for (const key of ['bonus', 'played', 'passed']) await pressReading(session, key);
    await wait(300);
    const fourOnly = (await evaluate(session, readRows)) ?? [];
    for (const key of ['bonus', 'played', 'passed']) await pressReading(session, key);
    await wait(300);
    note('le quattro frequenze in barra', {
      said: `${rows.length} righe · ${withAll.length} portano tutte e quattro le pastiglie · esempio `
        + `${JSON.stringify(rows.find((one) => one.say.longPlay && one.say.longPlay !== '—')?.say ?? null)}`
        + ` · il nome piu' stretto: ${narrowest(naked)}px con le tre di partenza, `
        + `${narrowest(fourOnly)}px con le sole quattro nuove, ${narrowest(rows)}px con tutte e sette `
        + `· nomi tagliati ${clipped(naked)} / ${clipped(fourOnly)} / ${clipped(rows)} su ${rows.length}`,
      problems: [
        ...pressed.filter(Boolean),
        ...(withAll.length === rows.length
          ? [] : [`${rows.length - withAll.length} righe senza le quattro pastiglie`]),
        // NESSUN NOME RIDOTTO A NIENTE: il taglio e' il prezzo dichiarato di una pastiglia accesa, ma
        // una colonna del nome che sparisce e' un'altra cosa - e' la riga che non si puo' piu' leggere.
        ...(narrowest(rows) > 0 ? [] : ['qualche nome e largo zero: la riga non si legge piu']),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const file = join(ROOT, 'dist', 'e2e-strategy-filters.png');
      await writeFile(file, Buffer.from(shot.data, 'base64'));
      console.log(`· screenshot: ${file}`);
    }

    // 2. I NUMERI VENGONO DAL PACCHETTO, e non da se stessi.
    const bundle = await frequenciesFromBundle();
    const checked = [];
    const wrong = [];
    const faded = { right: 0, wrong: [] };
    for (const row of rows) {
      const mine = bundle.get(row.id);
      if (!mine) continue;
      checked.push(row.id);
      for (const key of keys) {
        const said = row.say[key];
        const wanted = mine[key];
        // `undefined` = questo banco non sa rispondere su quella quota per quest'uomo (fantavoto
        // sintetico); `null` = la risposta e' «non lo sappiamo», che invece si confronta.
        if (wanted === undefined) continue;
        const read = said === '—' ? null : Number(String(said).replace('%', '').replace(',', '.'));
        if (wanted == null && read == null) continue;
        if (wanted == null || read == null || Math.abs(read - wanted) > 1) {
          wrong.push(`${row.id}: ${key} dice ${said} e il pacchetto ${wanted}% su ${mine.played} partite`);
        }
      }
      // ...E IL CAMPIONE SOTTILE E' SBIADITO: la stessa riga puo' avere una quota solida e una
      // spannometrica, perche' i tre denominatori sono tre numeri diversi.
      const thin = mine.timed > 0 && mine.timed < THIN_SAMPLE;
      if (thin === row.faded.includes('longPlay')) faded.right += 1;
      else if (mine.timed > 0) faded.wrong.push(`${row.id}: ${mine.timed} partite e sbiadito=${row.faded.includes('longPlay')}`);
    }
    note('i quattro numeri vengono dal pacchetto', {
      said: `${checked.length} righe confrontate su ${rows.length} (solo chi ha giocato SOLO in Serie A) `
        + `· ${checked.filter((one) => bundle.get(one)?.rated != null).length} anche sulle due quote del `
        + `fantavoto · ${faded.right} righe col giusto sbiadito`,
      problems: [
        ...(checked.length < 20
          ? [`solo ${checked.length} righe confrontabili: il banco non sta misurando niente`] : []),
        ...wrong.slice(0, 5),
        ...(wrong.length > 5 ? [`...e altre ${wrong.length - 5} righe che non tornano`] : []),
        ...faded.wrong.slice(0, 3),
      ],
    });

    // 3. LA FINESTRA E' TUTTO IL SUO CALCIO, e non la stagione in corso.
    //
    //    L'invariante e' falsificabile e non ha bisogno di nessuna fonte: con `k` giornate giocate, una
    //    quota calcolata sulla sola stagione bersaglio puo' valere SOLO uno dei `k+1` multipli di
    //    `100/k`. Se meta' delle righe porta un valore che su `k` partite non esiste, la finestra non e'
    //    quella - ed e' il fatto che rende le quattro pastiglie una misura invece di un lancio di dado.
    const k = await playedInTarget();
    const possible = new Set(Array.from({ length: k + 1 }, (_, at) => Math.round((at * 100) / k)));
    const values = rows
      .map((one) => one.say.longPlay)
      .filter((one) => one && one !== '—')
      .map((one) => Number(String(one).replace('%', '').replace(',', '.')));
    const impossible = values.filter((one) => !possible.has(one));
    note('la finestra e tutto il suo calcio, non la stagione in corso', {
      said: `${k} giornate giocate nella stagione bersaglio · su quelle una quota potrebbe valere solo `
        + `${[...possible].sort((a, b) => a - b).join('/')}% · ${impossible.length} righe su ${values.length} `
        + 'portano un valore che su quel campione non esiste',
      problems: impossible.length > values.length / 4
        ? []
        : [`solo ${impossible.length} righe su ${values.length} sono incompatibili con la stagione in `
          + 'corso: la finestra potrebbe essere quella sbagliata'],
    });

    // 4. IL FILTRO: la finestra si apre, una condizione si scrive, la lista si accorcia.
    //
    //    LE QUATTRO PASTIGLIE SI SPENGONO PRIMA, e non per pulizia: il calcio giocato si carica solo
    //    per quello che la pagina deve mostrare, quindi un filtro su una lettura SPENTA e' il caso in
    //    cui una colonna mai caricata taglierebbe la lista in silenzio - «vuoto = ignoto» applicato a
    //    un filtro svuota ogni blocco. E' esattamente il difetto che `needed()` esiste per non avere,
    //    e si prova filtrando su una pastiglia che in barra e' spenta.
    for (const key of keys) await pressReading(session, key);
    const off = ((await evaluate(session, readToggles)) ?? []).filter((one) => keys.includes(one.key));
    const before = await evaluate(session, readFilterBar);
    const opened = await clickSteady(session, 'app-strategy [data-filters]');
    const modalUp = await waitFor(session, readModal, 40);
    const added = modalUp ? await clickSteady(session, '[data-add-clause]') : null;
    if (flag('--shot') && modalUp) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const file = join(ROOT, 'dist', 'e2e-strategy-filters-modal.png');
      await writeFile(file, Buffer.from(shot.data, 'base64'));
      console.log(`· screenshot della finestra: ${file}`);
    }
    let modal = await waitFor(session, readModal, 20);
    const first = modal?.clauses?.[0] ?? null;
    let picked = null;
    if (first?.keyPoint) {
      await click(session, first.keyPoint);
      await wait(300);
      picked = await pickOption(session, WANTED.label);
    }
    modal = await evaluate(session, readModal);
    const valuePoint = modal?.clauses?.[0]?.valuePoint;
    if (valuePoint) await typeNumber(session, valuePoint, WANTED.value);
    // ...e si RILEGGE dopo aver scritto: una finestra letta prima di digitare riporta il valore di
    // prima, e il passo accuserebbe la pagina di non aver ricevuto quello che ha ricevuto.
    modal = await evaluate(session, readModal);
    // La finestra si chiude come un modale antd si chiude, con la sua X.
    await clickSteady(session, '.ant-modal-close');
    await wait(400);
    const after = await waitFor(session, readFilterBar, 20);
    const shown = (await evaluate(session, readRows)) ?? [];
    const numbers = shown
      .filter((one) => one.block === 0)
      .map((one) => Number(one.at))
      .filter((one) => Number.isFinite(one));
    note('una condizione accorcia le liste e lo DICE', {
      said: `finestra «${modalUp?.title ?? '—'}» · condizione ${JSON.stringify(modal?.clauses?.[0]
        ? { key: modal.clauses[0].key, op: modal.clauses[0].op, value: modal.clauses[0].value } : null)} `
        + `· righe ${before.rows} → ${after.rows} · gettoni ${JSON.stringify(after.chips)} · «${after.said}» `
        + `· disco ${after.saved} · pastiglie spente ${off.filter((one) => !one.on).length}/4`,
      problems: [
        ...(off.every((one) => !one.on)
          ? [] : ['le quattro pastiglie non si sono spente: il passo non prova niente sul caricamento']),
        ...(opened?.reachable ? [] : ['il bottone dei filtri non risponde alle proprie coordinate']),
        ...(modalUp ? [] : ['la finestra dei filtri non si e aperta']),
        ...(added?.reachable ? [] : ['«aggiungi filtro» non risponde alle proprie coordinate']),
        ...(picked ? [picked] : []),
        ...(modal?.clauses?.length === 1 ? [] : [`${modal?.clauses?.length ?? 0} condizioni invece di una`]),
        ...(modal?.clauses?.[0]?.value === WANTED.value
          ? [] : [`la casella legge «${modal?.clauses?.[0]?.value}» invece di ${WANTED.value}`]),
        ...(after.rows < before.rows ? [] : [`le liste non si sono accorciate: ${before.rows} → ${after.rows}`]),
        // UNA LISTA VUOTA E' IL DIFETTO CHE QUESTO PASSO CERCA: e' quello che si vedrebbe se il filtro
        // leggesse una colonna che nessuno ha caricato.
        ...(after.rows > 0 ? [] : ['il filtro ha svuotato ogni blocco: la lettura non e stata caricata']),
        ...(after.chips.length === 1 ? [] : [`${after.chips.length} gettoni invece di uno`]),
        ...(/\d+ esclusi/.test(after.said) ? [] : [`la barra non dice quanti nomi esclude: «${after.said}»`]),
        // IL POSTO RESTA QUELLO VERO: se i numeri accanto ai nomi fossero 1, 2, 3... il filtro avrebbe
        // rinumerato la lista, e il quarantesimo difensore si leggerebbe come il primo.
        ...(numbers.length > 2 && numbers.some((one, at) => at > 0 && one !== numbers[at - 1] + 1)
          ? [] : [`i posti del primo blocco sono contigui (${numbers.slice(0, 6).join(',')}): rinumerati`]),
      ],
    });

    // 5. SALVA, AZZERA, RICHIAMA - e sopravvive a un ricaricamento.
    await clickSteady(session, 'app-strategy [data-filters]');
    await waitFor(session, readModal, 40);
    const namePoint = await evaluate(session, boxOf, '[data-set-name]');
    if (namePoint) {
      await click(session, namePoint);
      await session.send('Input.insertText', { text: 'Titolari' });
      await wait(200);
    }
    const saved = await clickSteady(session, '[data-save-set]');
    await wait(300);
    const withSet = await evaluate(session, readModal);
    await clickSteady(session, '.ant-modal-close');
    await wait(300);
    // Azzerato dalla barra, cioe' dal gettone che sta fuori da ogni pannello che si chiude.
    await clickSteady(session, 'app-strategy [data-clear-filters]');
    await wait(400);
    const cleared = await evaluate(session, readFilterBar);
    // ...e richiamato dalla finestra.
    await clickSteady(session, 'app-strategy [data-filters]');
    await waitFor(session, readModal, 40);
    const recalled = await clickSteady(session, '[data-recall-set]');
    await wait(400);
    await clickSteady(session, '.ant-modal-close');
    await wait(300);
    const back = await evaluate(session, readFilterBar);
    // ...e il ricaricamento non se lo dimentica: e' il senso di «salvare e richiamare».
    await evaluate(session, () => {
      location.reload();
      return true;
    });
    await wait(1200);
    await waitFor(session, () =>
      document.querySelectorAll('app-strategy ol li[data-id]').length || null, 120);
    const reloaded = await evaluate(session, readFilterBar);
    note('un insieme si salva, si azzera e si richiama', {
      said: `salvato ${JSON.stringify(withSet?.sets ?? [])} · azzerato: ${cleared.chips.length} gettoni, `
        + `${cleared.rows} righe · richiamato: ${JSON.stringify(back.chips)} · dopo il ricaricamento `
        + `${JSON.stringify(reloaded.chips)} e ${reloaded.rows} righe`,
      problems: [
        ...(saved?.reachable ? [] : ['«salva» non risponde alle proprie coordinate']),
        ...(withSet?.sets?.length === 1 ? [] : [`${withSet?.sets?.length ?? 0} insiemi salvati invece di uno`]),
        ...(withSet?.sets?.[0]?.includes('Titolari') ? [] : ['l insieme salvato non porta il suo nome']),
        ...(cleared.chips.length === 0 ? [] : ['azzerando restano dei gettoni']),
        ...(cleared.rows === before.rows ? [] : [`azzerando le liste non tornano intere: ${cleared.rows} invece di ${before.rows}`]),
        ...(recalled?.reachable ? [] : ['il nome dell insieme non si fa cliccare']),
        ...(back.chips.length === 1 ? [] : [`richiamando ci sono ${back.chips.length} gettoni invece di uno`]),
        ...(back.rows === after.rows ? [] : [`richiamando le righe sono ${back.rows} invece di ${after.rows}`]),
        ...(reloaded.chips.length === 1
          ? [] : [`dopo il ricaricamento ci sono ${reloaded.chips.length} gettoni invece di uno`]),
        ...(reloaded.sets?.includes('Titolari') ? [] : ['l insieme salvato non e sopravvissuto al ricaricamento']),
      ],
    });

    // 6. Quello che la PAGINA urla: un'eccezione vuol dire che qualcosa non e' stato provato.
    const noise = session.noise();
    note('la console', {
      said: noise.length ? noise.join(' | ') : 'niente',
      problems: noise,
    });
  } finally {
    session?.close();
    browser.kill();
    server.close();
  }

  if (flag('--json')) console.log(JSON.stringify(report, null, 2));
  if (report.problems.length) {
    console.log(`\n${report.problems.length} problemi:`);
    for (const one of report.problems) console.log(`- ${one}`);
    process.exitCode = 1;
  } else {
    console.log('\nnessun problema');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
