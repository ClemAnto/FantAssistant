/**
 * e2e-why.mjs - guidare la pagina «Perché quel surplus» e confrontarla col FOGLIO.
 *
 * La pagina esiste per far controllare un numero, quindi il banco deve controllare che il numero sia
 * controllabile: ogni cifra a schermo si confronta con la colonna del foglio letta DALLO STESSO server
 * da cui la legge la pagina. Confrontare la pagina con se stessa - ricavare le presenze dividendo il
 * surplus per quello che la pagina dice - è l'asserzione circolare che questo progetto ha già pagato
 * (04/09/2026): passa qualunque cosa.
 *
 * L'UOMO SI SCEGLIE DAL FOGLIO e mai da una lista scritta a mano: si prende chi ha la scala più lunga
 * fra quelle che MUOVONO le presenze, perché è la riga su cui la spiegazione ha qualcosa da dire, e un
 * nome fisso morirebbe al primo mercato.
 *
 * Zero dipendenze come gli altri: serve `dist/`, lancia Edge o Chrome headless, CDP.
 *
 * Uso: node scripts/e2e-why.mjs [--headed] [--json] [--shot] [--who Malen]
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

/**
 * Riporta la pagina in cima prima di toccare un'intestazione.
 *
 * Serve per una ragione che la sonda ha nominato da sé: il box del VIAGGIO NEL TEMPO è `fixed` in basso
 * a destra, quindi con la pagina scorsa a metà la riga delle intestazioni ci finisce sotto e le ultime
 * colonne non si possono cliccare. Un utente scorre in su e lo fa; un banco che non lo fa accusa la
 * pagina di non ordinare.
 */
async function toTop(session) {
  await evaluate(session, () => {
    window.scrollTo(0, 0);
    return true;
  });
  await wait(300);
}

/** Porta il puntatore in un angolo e aspetta che il tooltip aperto si chiuda. */
async function restPointer(session) {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, button: 'none' });
  await wait(350);
}

/** Un puntatore VERO: prima l'hover, poi premi e rilascia dove il browser dice che il bersaglio è. */
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
  await wait(350);
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

// ------------------------------------------------------------------ quello che gira NELLA pagina

/**
 * UNA REGOLA PER TUTTI I LETTORI DI QUESTA PAGINA: si guarda SOLO la tabella grande.
 *
 * Da quando il pannello aperto contiene la tabella dei PARI RUOLO, un `document.querySelectorAll('table
 * tbody tr')` prende anche le sue righe: il banco leggeva 671 righe su 663, «7 righe non sono di
 * Fiorentina» e «i vuoti non stanno in fondo», cioè accusava la pagina di tre difetti che erano suoi.
 * Ogni lettore ritaglia quindi `:scope > tbody > tr` della PRIMA tabella - e lo fa per conto suo, perché
 * `evaluate` serializza una funzione sola e un aiutante comune nella pagina non esisterebbe.
 */

/** Un numero italiano come la pagina lo scrive: `−1,23` → -1.23, `—` → null. */
function parseNumber(text) {
  const clean = (text ?? '').replace(/\s/g, '').replace('−', '-').replace('+', '').replace(',', '.');
  if (!clean || clean === '—' || clean === '-') return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * La riga di un uomo: le sue celle, e DOVE si clicca.
 *
 * Le celle si leggono per POSIZIONE dentro la riga e non per una stringa cercata nel testo: le colonne
 * sono numeri e due colonne possono portare lo stesso numero, quindi cercare «61,7» troverebbe la prima
 * che capita. La posizione la dichiara l'intestazione, che il banco legge a parte.
 */
function readRow(name) {
  const table = document.querySelector('table');
  const rows = table ? [...table.querySelectorAll(':scope > tbody > tr')] : [];
  const found = rows.find((one) => {
    const first = one.querySelector('td');
    return first && (first.innerText ?? '').toLowerCase().includes(name.toLowerCase());
  });
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  return {
    cells: [...found.querySelectorAll('td')].map((cell) => (cell.innerText ?? '').trim()),
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    height: rect.height,
  };
}

/** Le intestazioni, in ordine: dicono quale cella è quale, così il banco non le indovina. */
function readHeaders() {
  const table = document.querySelector('table');
  return table
    ? [...table.querySelectorAll(':scope > thead > tr > th')].map((one) => (one.innerText ?? '').trim())
    : [];
}

/** Quante righe la tabella disegna, e quanti calciatori la barra dichiara. */
function readBar() {
  const bar = document.querySelector('.rounded-lg.border.border-border.bg-surface');
  return {
    said: (bar?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 260),
    rows: (document.querySelector('table')
      ? [...document.querySelector('table').querySelectorAll(':scope > tbody > tr')]
      : []
    ).filter((one) => !one.querySelector('td[colspan]')).length,
  };
}

/** Il pannello aperto sotto una riga: i tre riquadri, con i loro gradini. */
function readPanel() {
  const table = document.querySelector('table');
  const open = (table ? [...table.querySelectorAll(':scope > tbody > tr')] : []).find((one) =>
    one.querySelector('td[colspan]'),
  );
  if (!open) return null;
  const sections = [...open.querySelectorAll('section')];
  return {
    titles: sections.map((one) => (one.querySelector('h3')?.innerText ?? '').trim()),
    // I gradini di ogni riquadro: la voce e il numero, come stanno a schermo.
    rungs: sections.map((one) =>
      [...one.querySelectorAll('ul li')].map((line) => (line.innerText ?? '').replace(/\s+/g, ' ').trim()),
    ),
    formula: (open.querySelector('.font-mono')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    text: (open.innerText ?? '').replace(/\s+/g, ' ').trim(),
  };
}

/** La tabella dei pari ruolo dentro il pannello aperto: il titolo, il rango e le righe dei vicini. */
function readPeers() {
  const table = document.querySelector('table');
  const open = (table ? [...table.querySelectorAll(':scope > tbody > tr')] : []).find((one) =>
    one.querySelector('td[colspan]'),
  );
  const box = [...(open?.querySelectorAll('div') ?? [])].find((one) =>
    (one.querySelector('h3')?.innerText ?? '').startsWith('Fra i pari ruolo'),
  );
  if (!box) return null;
  const title = (box.querySelector('h3')?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const rank = Number((title.match(/(\d+)°/) ?? [])[1] ?? NaN);
  // `box.querySelectorAll('tbody tr')` NON è ritagliato come sembra: il selettore si valuta sul
  // DOCUMENTO e poi si filtrano i discendenti del box, quindi la riga del `<thead>` di questa tabella
  // matcha lo stesso - il suo antenato è il `<tbody>` della tabella GRANDE, che sta fuori. Leggeva
  // cinque righe su quattro, con una senza `<td>` che `Number('')` trasformava in un surplus di ZERO:
  // da lì «i vicini non sono in ordine». Si parte dalla tabella e si chiede `:scope > tbody > tr`.
  const inner = box.querySelector('table');
  const rows = [...(inner ? inner.querySelectorAll(':scope > tbody > tr') : [])].map((one) => {
    const cells = [...one.querySelectorAll('td')].map((cell) => (cell.innerText ?? '').trim());
    const value = (text) => {
      const clean = (text ?? '').replace(/\s/g, '').replace('−', '-').replace(',', '.');
      // Una cella VUOTA non è uno zero: `Number('')` dà 0, ed è il modo in cui una riga che non è una
      // riga entra in una graduatoria.
      if (!clean || clean === '—') return null;
      const parsed = Number(clean);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return { name: cells[0] ?? '', surplus: value(cells[4]) };
  });
  return { title, rank: Number.isFinite(rank) ? rank : null, rows };
}

/** Il pannello del metodo, quando è aperto: i suoi titoli. */
function readMethod() {
  const method = [...document.querySelectorAll('section')].find((one) =>
    (one.innerText ?? '').includes('Il conto, per intero'),
  );
  if (!method) return null;
  return {
    titles: [...method.querySelectorAll('h2')].map((one) => (one.innerText ?? '').trim()),
    rules: [...method.querySelectorAll('dl > div')].map((one) =>
      (one.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 90),
    ),
  };
}

/**
 * I VALORI DI UNA COLONNA, riga per riga, come la pagina li scrive.
 *
 * La riga del pannello aperto si scarta (`td[colspan]`): il suo primo `td` contiene tutto il testo del
 * pannello, quindi passerebbe per una riga di calciatore e falserebbe ogni conteggio.
 */
function readColumn(label) {
  const table = document.querySelector('table');
  if (!table) return null;
  const heads = [...table.querySelectorAll(':scope > thead > tr > th')].map((one) =>
    (one.innerText ?? '').trim(),
  );
  const index = heads.findIndex((one) => one.startsWith(label));
  if (index < 0) return null;
  return [...table.querySelectorAll(':scope > tbody > tr')]
    .filter((one) => !one.querySelector('td[colspan]'))
    .map((one) => (one.querySelectorAll('td')[index]?.innerText ?? '').replace(/\s+/g, ' ').trim());
}

/** Le coordinate del bottone che ordina una colonna: si clicca dove il browser dice che sta. */
function headerAt(label) {
  const table = document.querySelector('table');
  const heads = table ? [...table.querySelectorAll(':scope > thead > tr > th')] : [];
  const found = heads.find((one) => (one.innerText ?? '').trim().startsWith(label));
  const button = found?.querySelector('button') ?? found;
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * CHI STA SOTTO UN PUNTO, che è la sola domanda che spiega un click che non morde.
 *
 * «Il bottone è lì» è un fatto sul DOM e non sullo schermo: un tooltip aperto sulla colonna accanto
 * copre il bersaglio, e senza questa sonda il banco direbbe «non ordina» accusando la pagina di un
 * difetto dell'arnese (25/08/2026, e di nuovo qui appena la tabella si è allargata di una colonna).
 */
function underAt(x, y) {
  const one = document.elementFromPoint(x, y);
  if (!one) return 'niente';
  const button = one.closest('button');
  return button ? 'il bottone' : `${one.tagName.toLowerCase()}.${(one.className ?? '').toString().slice(0, 40)}`;
}

/** La freccia che una colonna porta ADESSO: `↓`, `↑`, o niente se non è lei a ordinare. */
function arrowOf(label) {
  const table = document.querySelector('table');
  const heads = table ? [...table.querySelectorAll(':scope > thead > tr > th')] : [];
  const found = heads.find((one) => (one.innerText ?? '').trim().startsWith(label));
  const text = (found?.innerText ?? '').trim();
  if (text.includes('↓')) return '↓';
  if (text.includes('↑')) return '↑';
  return '';
}

/** Scrive nella casella di ricerca come farebbe una tastiera, e lo dice ad Angular. */
function typeSearch(text) {
  const box = document.querySelector('input[type="search"]');
  if (!box) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(box, text);
  box.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** ...e la svuota, che è la stessa cosa con la stringa vuota. */
function clearSearch() {
  const box = document.querySelector('input[type="search"]');
  if (!box) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(box, '');
  box.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** Ogni testo che la tabella e il pannello aperto disegnano: per la guardia sul separatore. */
function readEveryNumber() {
  const cells = [...document.querySelectorAll('table td, table th')];
  const lines = [...document.querySelectorAll('table td[colspan] li, table td[colspan] dd, .font-mono')];
  return [...cells, ...lines].map((one) => (one.innerText ?? '').replace(/\s+/g, ' ').trim());
}

/** Le coordinate di un bottone col suo testo: si clicca dove il browser dice che sta. */
function buttonAt(text) {
  const found = [...document.querySelectorAll('button')].find((one) =>
    (one.innerText ?? '').trim().toLowerCase().includes(text.toLowerCase()),
  );
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// ------------------------------------------------------------------ il banco

async function gz(url) {
  const body = await (await fetch(url)).arrayBuffer();
  return JSON.parse(gunzipSync(Buffer.from(body)).toString('utf-8'));
}

/**
 * LA CHIAVE DELLA RICERCA, riscritta APPOSTA fuori dall'app (`core/loose-search.ts`).
 *
 * Non è una copia per pigrizia: è la stessa regola detta due volte, che è quello che rende il confronto
 * una prova invece di un'eco - se l'app cambiasse regola in silenzio, questo passo lo direbbe. E serve
 * davvero: cercando «Jimen» la pagina disegna anche **Gimenez**, e ha ragione - `ii` si stringe in `i`,
 * quindi la chiave è `imen`, che sta dentro `gimenez`. Un banco che assertisse un `includes` crudo
 * accuserebbe la pagina di un difetto che è una feature.
 */
function looseKey(text) {
  let out = (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  out = out.replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
  out = out.replace(/[øđð]/g, (one) => (one === 'ø' ? 'o' : 'd')).replace(/þ/g, 't');
  out = out.replace(/ł/g, 'l').replace(/ı/g, 'i');
  out = out.replace(/ck|ch/g, 'c');
  out = out.replace(/k/g, 'c').replace(/[jy]/g, 'i').replace(/w/g, 'v').replace(/x/g, 's');
  out = out.replace(/h/g, '');
  out = out.replace(/(.)\1+/g, '$1');
  return out.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Vicino abbastanza: la pagina stampa due decimali, il foglio ne porta tre. */
const near = (left, right, slack) =>
  left != null && right != null && Math.abs(left - right) <= slack;

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-why-'));
  const debugPort = Number(value('--port', String(await freePort())));
  const url = `http://127.0.0.1:${port}/why`;
  const browser = spawn(
    binary,
    [
      flag('--headed') ? '--headless=false' : '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1600,1000',
      url,
    ],
    { stdio: 'ignore' },
  );

  const report = { url, steps: [], problems: [] };
  const note = (step, detail) => {
    report.steps.push({ step, ...detail });
    console.log(`- ${step}: ${detail.said ?? ''}`);
    for (const problem of detail.problems ?? []) console.log(`    ! ${problem}`);
    if (detail.problems?.length) {
      report.problems.push(...detail.problems.map((one) => `${step}: ${one}`));
    }
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await wait(3500);

    // 0. IL FOGLIO che la pagina sta leggendo, dallo STESSO server: è il metro di ogni passo dopo.
    //    Il profilo è nuovo, quindi la lega dichiarata è quella di default (Serie A · classic).
    const base = `http://127.0.0.1:${port}/data`;
    const manifest = await (await fetch(`${base}/manifest.json`)).json();
    const entry = (manifest.engine_sheets ?? []).find(
      (one) => one.platform === 'default' && one.game === 'classic',
    );
    if (!entry) throw new Error('il bundle non porta il foglio Serie A classic');
    const sheet = await gz(`${base}/${entry.path}`);
    const at = (name) => sheet.columns.indexOf(name);
    const columns = {
      id: at('fc_id'), name: at('name'), fm: at('engine_fm_pred'), estFm: at('est_fm'),
      pv: at('engine_pv_pred'), estPv: at('est_pv'), replacement: at('engine_replacement_fm'),
      surplus: at('engine_surplus'), estSurplus: at('est_surplus'), anchor: at('engine_anchor'),
      club: at('club'), slot: at('engine_role_slot'),
      confidence: at('est_confidence'), fmSteps: at('why_fm_steps'), pvSteps: at('why_pv_steps'),
      fmPrev: at('why_fm_prev'), pvPrev: at('why_pv_prev'), rung: at('desc_titolarita'),
    };
    const matchdays = entry.matchdays_target ?? null;
    const men = sheet.rows.map((row) => ({
      id: row[columns.id],
      name: row[columns.name],
      club: row[columns.club] ?? null,
      slot: columns.slot < 0 ? null : (row[columns.slot] ?? null),
      fm: row[columns.fm] ?? row[columns.estFm] ?? null,
      pv: row[columns.pv] ?? row[columns.estPv] ?? null,
      replacement: row[columns.replacement] ?? null,
      surplus: row[columns.surplus] ?? row[columns.estSurplus] ?? null,
      anchor: row[columns.anchor] ?? null,
      confidence: row[columns.confidence] ?? 1,
      fmSteps: columns.fmSteps < 0 ? null : (row[columns.fmSteps] ?? null),
      pvSteps: columns.pvSteps < 0 ? null : (row[columns.pvSteps] ?? null),
      rung: columns.rung < 0 ? null : (row[columns.rung] ?? null),
      fmPrev: columns.fmPrev < 0 ? null : (row[columns.fmPrev] ?? null),
      pvPrev: columns.pvPrev < 0 ? null : (row[columns.pvPrev] ?? null),
    }));
    const withLadder = men.filter((one) => one.pvSteps);
    note('il foglio', {
      said:
        `${entry.league} rev. ${entry.sheet_revision} · ${men.length} righe · ` +
        `${withLadder.length} con la scala · ${matchdays} giornate`,
      problems: [
        ...(columns.pvSteps >= 0 ? [] : ['il foglio non porta `why_pv_steps`: la pagina non ha niente da spiegare']),
        ...(matchdays ? [] : ['il foglio non dichiara le giornate: il +/giornata non è calcolabile']),
      ],
    });

    // 1. LA PAGINA SI APRE e disegna la lista completa. Il conto della barra si confronta col foglio,
    //    non con se stesso: «600 calciatori» deve essere il listone e non un numero che suona bene.
    const bar = await waitFor(session, readBar, 40);
    const declared = Number((bar?.said?.match(/(\d+) calciatori/) ?? [])[1] ?? 0);
    // QUANTE SCALE la barra dichiara, contro quante il foglio ne riempie. Non sono le colonne: il
    // foglio le porta per tutti e le riempie per chi il motore riesce a prevedere, e la prima
    // versione di questo conteggio leggeva 600 dove le scale sono 386.
    const saidLadders = Number((bar?.said?.match(/(\d+) con la scala/) ?? [])[1] ?? 0);
    note('la pagina', {
      said: `${bar?.rows ?? 0} righe disegnate · barra: ${bar?.said ?? '(niente)'}`,
      problems: [
        ...(bar?.rows ? [] : ['nessuna riga disegnata']),
        ...(declared ? [] : ['la barra non dichiara quanti calciatori ci sono']),
        ...(saidLadders === withLadder.length
          ? []
          : [`la barra dichiara ${saidLadders} scale e il foglio ne riempie ${withLadder.length}`]),
      ],
    });

    // 2. IL CONTROLLO DELLA PAGINA. La barra dice quante righe NON riproducono il surplus del foglio, e
    //    lo zero è il numero che ci si aspetta; il banco lo rifà per conto suo su tutte le righe, o
    //    starebbe credendo alla pagina sulla parola proprio dove la pagina si autocertifica.
    const mine = men.filter(
      (one) => one.fm != null && one.pv != null && one.replacement != null && one.surplus != null,
    );
    const off = mine.filter(
      (one) => Math.abs((one.fm - one.replacement) * one.pv * (one.confidence ?? 1) - one.surplus) > 0.15,
    );
    const saidOff = Number((bar?.said?.match(/(\d+) righe la cui catena/) ?? [])[1] ?? 0);
    note('la catena torna', {
      said: `${off.length} righe del foglio non si ricostruiscono · la pagina ne dichiara ${saidOff}`,
      examples: off.slice(0, 5).map((one) => one.name),
      problems:
        off.length === saidOff
          ? []
          : [`la pagina dichiara ${saidOff} disaccordi e il foglio ne ha ${off.length}`],
    });

    // 3. UN UOMO, scelto dal FOGLIO: quello la cui scala delle presenze muove di più, perché è la riga
    //    su cui c'è qualcosa da spiegare. Un nome fisso qui morirebbe al primo mercato.
    const wanted = value('--who', null);
    const moved = (steps) => {
      const values = String(steps ?? '')
        .split(';')
        .map((piece) => Number(piece.split(':')[1]))
        .filter((one) => Number.isFinite(one));
      return values.length ? Math.max(...values) - Math.min(...values) : 0;
    };
    const target = withLadder
      .filter((one) => one.surplus != null && (!wanted || one.name.toLowerCase().includes(wanted.toLowerCase())))
      .sort((left, right) => moved(right.pvSteps) - moved(left.pvSteps))[0];
    if (!target) throw new Error('nessun uomo con una scala: non c\'è niente da misurare');

    // Si cerca il nome, o la riga potrebbe essere fuori schermo: la pagina scorre e il click va dove
    // il browser dice che la riga sta ADESSO.
    await evaluate(session, (name) => {
      const box = document.querySelector('input[type="search"]');
      if (!box) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      ).set;
      setter.call(box, name);
      box.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, target.name);
    await wait(600);

    const headers = await evaluate(session, readHeaders);
    const row = await waitFor(session, readRow, 20, target.name);
    const cell = (label) => {
      const index = headers.findIndex((one) => one.startsWith(label));
      return index < 0 || !row ? null : parseNumber(row.cells[index]);
    };
    const seen = {
      fm: cell('FM att.'),
      replacement: cell('Rimpiazzo'),
      perPlayed: cell('+/partita'),
      pv: cell('Presenze'),
      surplus: cell('Surplus'),
      perMatch: cell('+/giornata'),
    };
    const expected = {
      fm: target.fm,
      replacement: target.replacement,
      perPlayed: target.fm != null && target.replacement != null ? target.fm - target.replacement : null,
      pv: target.pv,
      surplus: target.surplus,
      perMatch: target.surplus != null && matchdays ? target.surplus / matchdays : null,
    };
    const wrong = Object.entries(expected).filter(
      // Due decimali a schermo contro tre sul foglio: mezzo centesimo di scarto è l'arrotondamento, e
      // il surplus si stampa a un decimale.
      ([key, want]) => !near(seen[key], want, key === 'surplus' || key === 'pv' ? 0.06 : 0.006),
    );
    note('una riga contro il foglio', {
      said: `${target.name}: ${JSON.stringify(seen)} contro ${JSON.stringify(expected)}`,
      problems: [
        ...(row ? [] : [`la riga di ${target.name} non è disegnata`]),
        ...wrong.map(([key, want]) => `${key}: a schermo ${seen[key]}, sul foglio ${want}`),
      ],
    });

    // 4. IL PANNELLO: un gradino per regola, quelli che il foglio scrive. Contarli è quello che
    //    distingue «la scala si vede» da «la scala esiste da qualche parte».
    if (row) await click(session, { x: row.x, y: row.y });
    const panel = await waitFor(session, readPanel, 20);
    const rungsOnSheet = String(target.pvSteps ?? '').split(';').filter(Boolean).length;
    const rungsOnScreen = (panel?.rungs ?? []).reduce((sum, one) => Math.max(sum, one.length), 0);
    note('il pannello', {
      said:
        `${panel?.titles?.length ?? 0} riquadri (${(panel?.titles ?? []).join(' · ')}) · ` +
        `${rungsOnScreen} gradini a schermo contro ${rungsOnSheet} sul foglio`,
      formula: panel?.formula ?? null,
      problems: [
        ...(panel ? [] : ['il pannello non si apre']),
        ...((panel?.titles?.length ?? 0) === 4
          ? []
          : ['i riquadri non sono quattro: fantamedia, presenze, il conto, il posto']),
        ...(rungsOnScreen === rungsOnSheet
          ? []
          : [`la scala a schermo ha ${rungsOnScreen} gradini e il foglio ne scrive ${rungsOnSheet}`]),
      ],
    });

    // 4c. FRA I PARI RUOLO: la finestra dei vicini deve essere ORDINATA per surplus e deve contenere
    //     l'uomo aperto - se lo perde, sta mostrando la graduatoria di qualcun altro. Il rango si
    //     ricalcola dal FOGLIO sulla stessa pool (`engine_role_slot`), che è la sola prova che il posto
    //     dichiarato sia il suo: contarlo dalla pagina sarebbe leggere la pagina con la pagina.
    const peers = await evaluate(session, readPeers);
    const peerProblems = [];
    if (!peers) {
      peerProblems.push('la tabella dei pari ruolo non compare');
    } else {
      const numbers = peers.rows.map((one) => one.surplus).filter((one) => one != null);
      const ordered = numbers.every((one, at, all) => at === 0 || all[at - 1] >= one - 1e-9);
      const mine = peers.rows.find((one) => one.name.includes(target.name));
      // Il rango contato sul foglio: quanti uomini della sua stessa pool hanno un surplus più alto.
      const pool = target.slot;
      const better = men.filter(
        (one) => one.slot === pool && one.surplus != null && target.surplus != null
          && one.surplus > target.surplus,
      ).length;
      if (!ordered) peerProblems.push('i vicini non sono in ordine di surplus');
      if (!mine) peerProblems.push("la finestra dei vicini non contiene l'uomo aperto");
      // ±1: la pagina conta su 663 righe (listone compreso) e il foglio su 600, quindi il rango può
      // scostarsi di poco - quello che NON può è essere un altro numero.
      if (peers.rank != null && Math.abs(peers.rank - (better + 1)) > 3) {
        peerProblems.push(`la pagina lo mette ${peers.rank}° e il foglio ${better + 1}°`);
      }
    }
    note('fra i pari ruolo', {
      said: peers ? `${peers.rows.length} vicini · ${peers.title}` : '(nessuna tabella)',
      // Le righe lette vanno nel verbale: un passo che accusa senza mostrare cosa ha letto costringe a
      // rifare la corsa per sapere di che parla.
      rows: peers?.rows ?? [],
      problems: peerProblems,
    });

    // 4a. L'ESITO, che è il falsificatore: la colonna «Quest'anno» viene dai VOTI del pacchetto e non
    //     dall'aggregato di stagione (`season_stats` lo scrive una derivazione che una corsa quotidiana
    //     non rifà: sul pacchetto del 05/09 legge una giornata dove i voti ne portano due). Il banco
    //     conta le righe di `match_ratings` per quell'uomo e pretende lo stesso numero.
    const ratings = await gz(`${base}/match_ratings.json.gz`);
    const r = (name) => ratings.columns.indexOf(name);
    const his = ratings.rows.filter(
      (row) =>
        row[r('fc_id')] === target.id &&
        row[r('season')] === (sheet.target_season ?? manifest.target_season) &&
        row[r('platform')] === entry.platform,
    );
    const nowCell = ((await evaluate(session, readColumn, "Quest'anno")) ?? [])[0] ?? '';
    const played = Number((nowCell.match(/^(\d+)\s*\//) ?? [])[1] ?? NaN);
    note("l'esito di quest'anno", {
      said: `${target.name}: la pagina dice ${nowCell || '(niente)'}, i voti ne portano ${his.length}`,
      problems:
        his.length && played !== his.length
          ? [`la colonna dice ${played} giornate e i voti ne portano ${his.length}`]
          : [],
    });

    // 4b. IL POSTO E I RIVALI, contro la BOARD del toolkit e non contro la pagina: l'undici di un club
    //     vero lo disegna `modules/boards.py`, quindi la sola prova che la carta dica il vero è
    //     ritrovare nel file quello che la carta scrive. Chi non è né schierato né in ballottaggio deve
    //     leggere che la board non lo nomina - «vuoto = ignoto» ha una frase, non una carta vuota.
    const placeProblems = [];
    let placeSaid = 'la board non nomina questo uomo';
    if (!entry.boards) {
      placeProblems.push('il manifest non dichiara un file di board: la carta non ha una fonte');
    } else {
      const boards = await (await fetch(`${base}/${entry.boards}`)).json();
      const board = (boards.clubs ?? {})[target.club ?? ''] ?? null;
      const text = panel?.text ?? '';
      let drawn = null;
      let holder = null;
      for (const men of Object.values(board?.lines ?? {})) {
        for (const man of men) {
          if (man.fc_id === target.id) drawn = man;
          for (const duel of man.duels ?? []) {
            if (duel.fc_id === target.id) holder = man;
          }
        }
      }
      if (drawn) {
        placeSaid = `schierato come ${drawn.badge ?? '?'}`;
        if (drawn.badge && !text.includes(drawn.badge)) {
          placeProblems.push(`la board lo schiera come ${drawn.badge} e la carta non lo dice`);
        }
        if (!text.includes('lo schiera')) placeProblems.push('la carta non dice che è schierato');
      } else if (holder) {
        placeSaid = `in ballottaggio con ${holder.name}`;
        if (!text.includes(holder.name)) {
          placeProblems.push(`il posto è di ${holder.name} e la carta non lo nomina`);
        }
      } else if (!text.includes('non lo disegna')) {
        placeProblems.push('la board non lo nomina e la carta non lo dice');
      }
      // ...e il GRADINO viene dal foglio, non dalla board: le due cose stanno sulla stessa carta e
      // devono restare due (`desc_titolarita` è scritto dalla stessa passata, ma è un'altra colonna).
      if (target.rung && !text.toUpperCase().includes(target.rung.toUpperCase())) {
        placeProblems.push(`il foglio dice ${target.rung} e la carta non lo scrive`);
      }
    }
    note('il posto e i rivali', { said: placeSaid, problems: placeProblems });

    // ...E IL DIVISORE DEI DECIMALI E' IL PUNTO (operatore, 05/09/2026), misurato sul TESTO che la
    // pagina disegna - tabella E pannello aperto, che e' dove sta la formula del core. Una regola sul
    // separatore si rompe alla prossima `.replace('.', ',')`, quindi deve fallire dove si vede, e
    // questa pagina l'ha rotta appena nata. `1,000` sarebbe un separatore di MIGLIAIA e non e' questa
    // regola.
    const commas = ((await evaluate(session, readEveryNumber)) ?? []).filter((one) =>
      /\d,\d{1,2}(?!\d)/.test(one),
    );
    note('i decimali col punto', {
      said: `${commas.length} celle con la virgola decimale`,
      problems: commas.length ? [`si scrive ancora la virgola: ${commas.slice(0, 3).join(' · ')}`] : [],
    });

    // ...e una FOTOGRAFIA del pannello, che è la cosa per cui la pagina esiste: i conteggi dicono che i
    // gradini sono sette, non che si leggono. La schermata si prende PRIMA di aprire il metodo, o
    // finisce sotto un muro di testo (e la pagina scorre da sé fino alla riga aperta).
    if (flag('--shot')) {
      await evaluate(session, () => {
        const open = [...document.querySelectorAll('table tbody tr')].find((one) =>
          one.querySelector('td[colspan]'),
        );
        open?.scrollIntoView({ block: 'center' });
        return true;
      });
      await wait(400);
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'e2e-why-panel.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      report.panelShot = where;
      console.log(`  (schermata del pannello: ${where})`);
    }

    // 5. IL METODO: è la metà della richiesta che dice «esplicita anche COME calcoli i fattori», quindi
    //    o si apre e nomina le regole percorse, o quella metà non è consegnata.
    const opener = await evaluate(session, buttonAt, 'Come si calcola');
    if (opener) await click(session, opener);
    const method = await waitFor(session, readMethod, 12);
    const keys = new Set(String(target.pvSteps ?? '').split(';').map((one) => one.split(':')[0]));
    const missing = [...keys].filter(
      (key) => !(method?.rules ?? []).some((line) => line.startsWith(key)),
    );
    note('come si calcola', {
      said: `${method?.titles?.length ?? 0} sezioni · ${method?.rules?.length ?? 0} regole in legenda`,
      titles: method?.titles ?? [],
      problems: [
        ...(method ? [] : ['il pannello del metodo non si apre']),
        ...(missing.length ? [`regole percorse e non spiegate: ${missing.join(', ')}`] : []),
      ],
    });

    // 6. L'ORDINAMENTO, richiesto dall'operatore. L'affermazione da provare è sull'ORDINE contro i
    //    VALORI che la pagina stessa disegna - due cose diverse, quindi il confronto non è circolare -
    //    e comprende la regola che decide il caso limite: un VUOTO va in fondo in TUTT'E DUE i versi,
    //    perché un ignoto non è un ultimo posto. Senza quella, ordinare in salita metterebbe in cima le
    //    trecento righe che il motore non prezza.
    // ...e prima si RICHIUDE il pannello del metodo, che è alto quanto uno schermo: aperto spinge la
    // riga delle intestazioni sotto il box fisso del viaggio nel tempo, e il click non arriva. L'ha
    // nominato la sonda (`underAt`) invece di farmelo indovinare, che è la ragione per cui esiste.
    const shut = await evaluate(session, buttonAt, 'Come si calcola');
    if (shut) await click(session, shut);
    await evaluate(session, clearSearch);
    await toTop(session);
    await wait(400);
    const orderProblems = [];
    let orderSaid = '';
    for (const column of ['Surplus', '+/partita', 'Presenze app']) {
      await toTop(session);
      await restPointer(session);
      const head = await evaluate(session, headerAt, column);
      if (!head) {
        orderProblems.push(`la colonna ${column} non ha un'intestazione cliccabile`);
        continue;
      }
      const under = await evaluate(session, underAt, head.x, head.y);
      if (under !== 'il bottone') {
        orderProblems.push(`${column}: sul suo punto c'è ${under}, non il bottone`);
      }
      await click(session, head);
      const down = (await evaluate(session, readColumn, column)) ?? [];
      // LA FRECCIA È LA PROVA CHE IL CLICK È ARRIVATO, e serve: `Surplus` e `+/giornata` sono lo stesso
      // ordine (uno è l'altro diviso una costante), quindi su quella colonna un click che non arriva
      // lascerebbe la lista già ordinata e il passo leggerebbe «tutto a posto» dopo aver guardato
      // niente. Il verso lo dice la freccia, non l'ordine.
      const arrowDown = await evaluate(session, arrowOf, column);
      await toTop(session);
      await restPointer(session);
      await click(session, head);
      const up = (await evaluate(session, readColumn, column)) ?? [];
      const arrowUp = await evaluate(session, arrowOf, column);
      if (arrowDown !== '↓') orderProblems.push(`${column}: nessuna freccia in giù dopo il primo click`);
      if (arrowUp !== '↑') orderProblems.push(`${column}: la freccia non gira dopo il secondo click`);
      const numbers = (cells) => cells.map(parseNumber);
      const filled = (cells) => numbers(cells).filter((one) => one != null);
      const sortedDown = filled(down).every((one, at, all) => at === 0 || all[at - 1] >= one - 1e-9);
      const sortedUp = filled(up).every((one, at, all) => at === 0 || all[at - 1] <= one + 1e-9);
      // I vuoti stanno in FONDO nei due versi: si guarda dove cade il primo trattino.
      const firstBlank = (cells) => numbers(cells).findIndex((one) => one == null);
      const lastFull = (cells) => {
        const values = numbers(cells);
        for (let at = values.length - 1; at >= 0; at -= 1) if (values[at] != null) return at;
        return -1;
      };
      const blanksLast =
        (firstBlank(down) < 0 || firstBlank(down) > lastFull(down)) &&
        (firstBlank(up) < 0 || firstBlank(up) > lastFull(up));
      orderSaid += `${column}: ${filled(down).length}/${down.length} con un numero · `;
      if (!sortedDown) orderProblems.push(`${column}: il primo click non ordina in discesa`);
      if (!sortedUp) orderProblems.push(`${column}: il secondo click non gira il verso`);
      if (!blanksLast) orderProblems.push(`${column}: i vuoti non stanno in fondo in tutt'e due i versi`);
    }
    note('si ordina per ogni valore', { said: orderSaid.trim(), problems: orderProblems });

    // 7. IL FILTRO PER SQUADRA, e il club si sceglie dal BUNDLE: una squadra scritta a mano qui
    //    morirebbe alla prima promozione. Si guida con un puntatore VERO - `element.click()` passa
    //    sopra la CSS e proverebbe qualcosa sul DOM invece che sullo schermo.
    const clubName = men.find((one) => one.name === target.name)?.club ?? null;
    await toTop(session);
    await restPointer(session);
    const box = await evaluate(session, () => {
      const select = document.querySelector('nz-select');
      if (!select) return null;
      const rect = select.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    let clubSaid = 'nessuna tendina delle squadre';
    const clubProblems = [];
    if (!box) {
      clubProblems.push('la tendina delle squadre non esiste');
    } else {
      await click(session, box);
      await wait(400);
      // SI SCRIVE IL NOME, come farebbe una mano: la tendina è a scorrimento VIRTUALE, quindi un club in
      // fondo all'alfabeto non è nel DOM finché non lo si cerca - il primo tentativo leggeva «la tendina
      // non offre Roma» su una tendina che la offre eccome. Un banco che cerca un'opzione non renderizzata
      // accusa il controllo del proprio difetto.
      await evaluate(session, (name) => {
        const input = document.querySelector('.ant-select-selection-search-input');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, name);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }, clubName ?? '');
      await wait(500);
      const option = await evaluate(session, (name) => {
        const items = [...document.querySelectorAll('.ant-select-item-option')];
        const found = items.find((one) => (one.innerText ?? '').startsWith(name));
        if (!found) return null;
        found.scrollIntoView({ block: 'center' });
        const rect = found.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: (found.innerText ?? '').trim() };
      }, clubName ?? '');
      if (!option) {
        clubProblems.push(`la tendina non offre ${clubName}`);
      } else {
        await click(session, option);
        await wait(500);
        const drawn = (await evaluate(session, readColumn, 'Calciatore')) ?? [];
        const wrong = drawn.filter((one) => !one.includes(clubName ?? ' '));
        // Quanti uomini la voce DICHIARA: la tendina porta il conto accanto al nome, ed è quello che
        // rende consapevole la scelta. Deve essere lo stesso numero delle righe che restano.
        const declaredMen = Number((option.text.match(/·\s*(\d+)/) ?? [])[1] ?? NaN);
        clubSaid = `${clubName}: ${drawn.length} righe, la tendina ne dichiara ${declaredMen}`;
        if (wrong.length) clubProblems.push(`${wrong.length} righe non sono di ${clubName}`);
        if (Number.isFinite(declaredMen) && declaredMen !== drawn.length) {
          clubProblems.push(`la tendina dichiara ${declaredMen} uomini e la pagina ne disegna ${drawn.length}`);
        }
        if (!drawn.length) clubProblems.push('il filtro non lascia passare nessuno');
      }
    }
    note('si filtra per squadra', { said: clubSaid, problems: clubProblems });

    // 8. LA RICERCA, che cerca nel NOME e nella SQUADRA insieme, e la crocetta che rimette tutto.
    const searchProblems = [];
    const surname = (target.name.split(' ')[0] ?? target.name).slice(0, 5);
    await evaluate(session, clearSearch);
    await wait(300);
    const clear = await evaluate(session, buttonAt, 'Mostra tutti');
    if (clear) await click(session, clear);
    await wait(400);
    const everything = ((await evaluate(session, readColumn, 'Calciatore')) ?? []).length;
    await evaluate(session, typeSearch, surname);
    await wait(600);
    const found = (await evaluate(session, readColumn, 'Calciatore')) ?? [];
    const searched = looseKey(surname);
    const missed = found.filter((one) => !looseKey(one).includes(searched));
    if (!found.length) searchProblems.push(`cercando «${surname}» non resta nessuno`);
    if (missed.length) {
      searchProblems.push(
        `${missed.length} righe non contengono «${surname}»: ${missed.slice(0, 3).join(' | ')}`,
      );
    }
    if (everything <= found.length) searchProblems.push('la ricerca non toglie nessuna riga');
    note('si cerca un calciatore', {
      said: `«${surname}»: ${found.length} righe su ${everything}`,
      problems: searchProblems,
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'e2e-why.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      report.screenshot = where;
      console.log(`  (schermata: ${where})`);
    }

    const noise = session.noise();
    if (noise.length) note('la pagina ha urlato', { said: noise.join(' | '), problems: noise });
  } finally {
    session?.close();
    browser.kill();
    server.close();
  }

  if (flag('--json')) console.log(JSON.stringify(report, null, 2));
  console.log(
    report.problems.length
      ? `\n${report.problems.length} problemi:\n- ${report.problems.join('\n- ')}`
      : '\nnessun problema',
  );
  process.exitCode = report.problems.length ? 1 : 0;
}

await main();
