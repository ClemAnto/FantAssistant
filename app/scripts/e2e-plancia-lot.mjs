/**
 * e2e-plancia-lot.mjs - guida la PLANCIA vera e misura la riga del CALCIATORE IN ASTA.
 *
 * Quattro gruppi, richiesti dall'operatore il 24/09/2026, e ognuno si confronta con una fonte che non
 * e' lo schermo - un passo che ricava il numero atteso dal numero che sta controllando e' l'asserzione
 * circolare che questo repository ha gia' pagato due volte.
 *  - LE ULTIME QUATTRO PARTITE col fantavoto e i triangolini, contro `desc_trend_detail` del FOGLIO,
 *    col taglio rifatto a mano (le ultime quattro del calendario, la piu' recente a sinistra, e le
 *    giornate del club che ha lasciato fuori).
 *  - Pv | Mv | Fm DELLA STAGIONE SCORSA, contro `season_stats` del pacchetto.
 *  - IL SURPLUS, contro la cifra che la GRIGLIA PERSONALE stampa per lo stesso uomo: e' la stessa
 *    quantita' vista due volte, e due valutazioni per un uomo sono il difetto che questa pagina
 *    esiste per non avere.
 *  - IL PREZZO MEDIO PAGATO nel suo (ruolo, slot), ri-derivato dalle righe VENDUTE di quel blocco -
 *    quelle con un padrone, perche' su una riga ancora nell'urna la stessa colonna porta la MAX
 *    OFFERTA e mescolarle sarebbe una media di due quantita' diverse.
 *  - E I RIVALI DI POSIZIONE, contro `boards.json`: chi la board disegna in quel posto e chi gliela
 *    contende. L'app legge la board e non ne calcola una propria, quindi il confronto e' col file.
 *
 * Zero dipendenze, come gli altri banchi: serve `dist/`, lancia Edge o Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-plancia-lot.mjs [--headed]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.gz': 'application/gzip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const headed = process.argv.slice(2).includes('--headed');
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
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port })),
  );
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.fail(new Error(JSON.stringify(message.error)));
    else waiting.done(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = (sequence += 1);
      pending.set(id, { done, fail });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => socket.close() };
}

async function evaluate(session, fn, ...args) {
  const expression = `(${fn.toString()})(${args.map((one) => JSON.stringify(one)).join(',')})`;
  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
  }
  return result.result.value;
}

/** Un puntatore VERO: il doppio click e' quello che mette un nome in asta. */
async function press(session, at, clicks = 1) {
  const point = { x: Math.round(at.x), y: Math.round(at.y) };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none' });
  await wait(60);
  for (let n = 1; n <= clicks; n += 1) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', ...point, button: 'left', clickCount: n,
    });
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', ...point, button: 'left', clickCount: n,
    });
    if (n < clicks) await wait(40);
  }
  await wait(600);
}

async function waitFor(session, fn, tries = 100) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const out = await evaluate(session, fn);
    if (out) return out;
    await wait(250);
  }
  return null;
}

// ------------------------------------------------------------------ le fonti, dal pacchetto

/** Il foglio che la plancia prezza: Serie A classic, come `loadSheet` lo sceglie. */
async function sheetOf() {
  const manifest = JSON.parse(await readFile(join(DIST, 'data', 'manifest.json'), 'utf8'));
  const sheets = manifest.engine_sheets ?? [];
  const chosen =
    [...sheets].filter((s) => s.platform === 'default' && s.game === 'classic')
      .sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0))[0] ??
    [...sheets].sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0))[0];
  const table = JSON.parse(gunzipSync(await readFile(join(DIST, 'data', chosen.path))).toString('utf8'));
  return { manifest, sheet: chosen, table };
}

/**
 * Le ultime quattro partite di un uomo, dal foglio.
 *
 * Il taglio si rifa' a mano e non si importa da `core/player-trend`: chiedere alla stessa funzione che
 * disegna la riga confronterebbe la pagina con se stessa.
 */
function trendOfRow(record, league) {
  const all = String(record ?? '').split(';').filter(Boolean).map((one) => one.split('|'));
  if (!all.length) return null;
  const own = all.filter((f) => f[16] === '1');
  const mine = league ? all.filter((f) => f[1] === league) : [];
  const window = own.length ? own : mine.length ? mine : all;
  const cells = window.slice(-4).reverse().map((f) => {
    const minutes = f[5] === '' ? null : Number(f[5]);
    const started = f[6] === '1';
    const points = f[9] === '' ? null : Number(f[9]);
    return {
      text: points == null ? '\u00b7' : points.toFixed(1),
      on: minutes != null && !started && minutes > 0,
      off: minutes != null && started && minutes > 0 && minutes < 90,
    };
  });
  while (cells.length < 4) cells.push({ text: '\u00b7', on: false, off: false });
  return cells;
}

/** Pv, Mv e Fm della stagione d'ingresso, dalla tabella del pacchetto. */
async function lastSeasonOf(season, platform) {
  const table = JSON.parse(
    gunzipSync(await readFile(join(DIST, 'data', 'season_stats.json.gz'))).toString('utf8'),
  );
  const at = (name) => table.columns.indexOf(name);
  const [id, seasonAt, platformAt, pv, mv, fm] =
    ['fc_id', 'season', 'platform', 'pv', 'mv', 'fm'].map(at);
  const out = new Map();
  for (const row of table.rows) {
    if (row[seasonAt] !== season || row[platformAt] !== platform) continue;
    out.set(Number(row[id]), { pv: row[pv], mv: row[mv], fm: row[fm] });
  }
  return out;
}

/** La board di un club, e chi si gioca la maglia di un uomo: la stessa lettura che l'app fa del file. */
async function boardsOf(path) {
  if (!path) return null;
  const raw = await readFile(join(DIST, 'data', path));
  const text = path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return JSON.parse(text);
}

function shirtFromBoards(boards, club, id) {
  const board = boards?.clubs?.[club];
  if (!board?.lines) return null;
  for (const line of Object.values(board.lines)) {
    for (const drawn of line ?? []) {
      const duels = drawn.duels ?? [];
      if (drawn.fc_id != null && Number(drawn.fc_id) === id) {
        return { mine: true, names: duels.map((one) => one.name ?? '-') };
      }
      if (duels.some((one) => one.fc_id != null && Number(one.fc_id) === id)) {
        return {
          mine: false,
          names: [
            drawn.name ?? '-',
            ...duels.filter((one) => Number(one.fc_id) !== id).map((one) => one.name ?? '-'),
          ],
        };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ cosa gira NELLA pagina

/** Un uomo ancora nell'urna in un blocco in cui la stanza ha gia' comprato: e' il caso che ha tutto. */
/** Dove sta un controllo, per il suo testo visibile: la stessa lettura degli altri banchi. */
function boxOf(selector, text) {
  const found = [...document.querySelectorAll(selector)].find((one) =>
    (one.innerText ?? '').toLowerCase().includes(text.toLowerCase()),
  );
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function pickLot() {
  const owned = (row) => {
    const bar = row.querySelector(':scope > span');
    const paint = bar ? getComputedStyle(bar).backgroundColor : '';
    return !!paint && paint !== 'transparent' && !paint.startsWith('rgba(0, 0, 0, 0');
  };
  for (const block of document.querySelectorAll('[data-block]')) {
    const rows = [...block.querySelectorAll('button')];
    const sold = rows.filter(owned);
    const free = rows.find((one) => !owned(one));
    if (sold.length >= 2 && free) {
      const r = free.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        name: (free.innerText ?? '').split(String.fromCharCode(10))[0].trim(),
        block: (block.querySelector('span')?.innerText ?? '').trim(),
        // I PREZZI PAGATI di quel blocco, dall'ultima cella di ogni riga VENDUTA: su una riga ancora
        // nell'urna la stessa colonna porta la max offerta, che e' un'altra quantita'.
        paid: sold.map((one) => {
          const cells = [...one.querySelectorAll(':scope > span')];
          return Number((cells.at(-1)?.innerText ?? '').replace(/[^0-9-]/g, ''));
        }),
      };
    }
  }
  return null;
}

/** La riga del lotto come lo schermo la ha: i quattro gruppi, letti dai loro attributi dichiarati. */
function readLot() {
  const card = document.querySelector('plancia-lot-card');
  if (!card) return null;
  const groups = [...card.querySelectorAll('[data-lot-group]')];
  const out = {
    name: '',
    trend: [],
    last: '',
    surplus: '',
    paid: '',
    rivals: [],
    shirtLabel: '',
    band: '',
    verdict: '',
    brief: null,
    ceilings: null,
  };
  // IL NOME dal suo gruppo e non dalla prima `.truncate` della card: il ciclo qui sotto scrive
  // `out[<gruppo>]`, quindi con `name` fra i gruppi lo sovrascriveva con la cella che quel gruppo non
  // aveva - e il banco accusava la pagina di non mettere nessuno in asta.
  out.name = '';
  for (const group of groups) {
    const what = group.getAttribute('data-lot-group');
    if (what === 'trend') {
      out.trend = [...group.querySelectorAll('[data-trend-cell]')].map((cell) => ({
        text: (cell.innerText ?? '').trim(),
        on: !!cell.querySelector('svg[aria-label="subentrato"]'),
        off: !!cell.querySelector('svg[aria-label="sostituito"]'),
      }));
    } else if (what === 'brief') {
      // L'ETICHETTA «MI SERVE» (24/09/2026): quattro campi dichiarati, perche' una sola stringa
      // costringerebbe a parsare a parole quello che il componente gia' separa.
      out.brief = {
        interest: (group.querySelector('[data-lot-interest]')?.innerText ?? '').trim(),
        // LA CHIAVE, non le parole: «NON TI SERVE» contiene «TI SERVE», e un test su sottostringa
        // ha letto come disaccordo un accordo perfetto alla prima corsa.
        key: group.querySelector('[data-lot-interest]')?.getAttribute('data-lot-interest') ?? '',
        spend: (group.querySelector('[data-lot-spend]')?.innerText ?? '').trim(),
        bound: (group.querySelector('[data-lot-bound]')?.innerText ?? '').trim(),
        timing: (group.querySelector('[data-lot-timing]')?.innerText ?? '').trim(),
        reason: group.getAttribute('ng-reflect-nz-tooltip-title') ?? '',
      };
    } else if (what === 'band') {
      // LA BANDA DALLA SUA CELLA e non dall'intero gruppo: da quando il gruppo porta anche i due
      // tetti della borsa, «l'ultimo numero del gruppo» era il massimo assoluto - e il confronto
      // «il consiglio sta dentro la banda» diventava un confronto con un'altra cosa, cioe' non
      // poteva piu' fallire. Trovato alla prima corsa, guardando il numero stampato accanto al verde.
      out.band = (group.querySelector('[data-lot-band]')?.innerText ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      // I DUE TETTI DELLA BORSA (24/09/2026): le cifre sotto la barra e la posizione delle due marche
      // SULLA barra. Le due letture servono insieme - una marca disegnata da un'altra quantita' e' il
      // difetto che un solo numero non vedrebbe.
      const num = (sel) => {
        const at = group.querySelector(sel);
        if (!at) return null;
        const only = (at.innerText ?? '').replace(/[^0-9]/g, '');
        return only ? Number(only) : null;
      };
      const markAt = (which) => {
        const at = group.querySelector(`[data-lot-mark="${which}"]`);
        return at ? Number.parseFloat(at.style.left) : null;
      };
      out.ceilings = {
        sensible: num('[data-lot-sensible]'),
        absolute: num('[data-lot-absolute]'),
        sensibleAt: markAt('sensible'),
        absoluteAt: markAt('absolute'),
      };
    } else if (what === 'verdict') {
      out.verdict = group.getAttribute('nztype') ?? group.getAttribute('ng-reflect-nz-type') ?? '';
    } else if (what === 'shirt') {
      out.shirtLabel = (group.querySelector('[data-lot-label]')?.innerText ?? '').trim();
      out.rivals = [...group.querySelectorAll('[data-lot-rival]')].map((one) =>
        (one.innerText ?? '').trim(),
      );
    } else {
      out[what] = (group.querySelector('[data-lot-value]')?.innerText ?? '').trim();
    }
  }
  return out;
}

/**
 * LA GEOMETRIA DELLA RIGA: dove comincia ogni gruppo, quanto e' largo e se taglia il suo contenuto.
 *
 * `scrollWidth > clientWidth` e' la stessa prova che il banco delle colonne della plancia fa: una
 * larghezza DICHIARATA e' una promessa che un carattere in piu' puo' rompere, e il posto in cui lo si
 * deve scoprire e' qui invece che a schermo.
 */
function geometryNow() {
  const card = document.querySelector('plancia-lot-card');
  if (!card) return null;
  const out = { height: Math.round(card.getBoundingClientRect().height), groups: {} };
  for (const el of card.querySelectorAll('[data-lot-group]')) {
    const r = el.getBoundingClientRect();
    out.groups[el.getAttribute('data-lot-group')] = {
      left: Math.round(r.left),
      width: Math.round(r.width),
      // Il taglio si chiede all'elemento E ai suoi discendenti: un gruppo e' una colonna e il testo che
      // sborda sta quasi sempre in uno span dentro, non nella scatola che porta l'attributo.
      clipped:
        el.scrollWidth > el.clientWidth + 1 ||
        [...el.querySelectorAll('*')].some((one) => one.scrollWidth > one.clientWidth + 1),
    };
  }
  return out;
}

/** Un lotto qualunque, preso a passo costante su tutti i blocchi: ruoli e slot diversi. */
function lotAt(n) {
  const rows = [...document.querySelectorAll('[data-block] button')];
  const step = Math.max(1, Math.floor(rows.length / 14));
  const pick = rows[(n * step) % rows.length];
  if (!pick) return null;
  const r = pick.getBoundingClientRect();
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    name: (pick.innerText ?? '').split(String.fromCharCode(10))[0].trim(),
  };
}

/** La stessa cifra sulla griglia PERSONALE, dove la colonna E' il surplus. */
function surplusOnGrid(name) {
  const row = [...document.querySelectorAll('[data-block] button')].find(
    (one) => (one.innerText ?? '').split(String.fromCharCode(10))[0].trim() === name,
  );
  if (!row) return null;
  const cells = [...row.querySelectorAll(':scope > span')];
  return (cells.at(-3)?.innerText ?? '').trim();
}

async function main() {
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');
  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-lot-'));
  const debugPort = Number(await freePort());
  // IL TAVOLO GIA' GIOCATO, chiesto nell'indirizzo: senza acquisti non c'e' un prezzo medio da leggere
  // e il passo direbbe «nessun problema» dopo aver guardato niente.
  const url = `http://127.0.0.1:${port}/plancia?fixture=played`;
  const flags = ['--remote-debugging-port=' + debugPort, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1000', url];
  const browser = spawn(binary, headed ? flags : ['--headless=new', ...flags], { stdio: 'ignore' });
  let session;
  const problems = [];
  try {
    const { manifest, sheet, table } = await sheetOf();
    const at = (name) => table.columns.indexOf(name);
    const [idAt, nameAt, clubAt, leagueAt, detailAt] =
      ['fc_id', 'name', 'club', 'league', 'desc_trend_detail'].map(at);
    const byName = new Map();
    const twice = new Set();
    for (const row of table.rows) {
      const key = String(row[nameAt]).trim();
      if (byName.has(key)) twice.add(key);
      byName.set(key, row);
    }
    for (const key of twice) byName.delete(key);
    const last = await lastSeasonOf(manifest.input_season, sheet.platform);
    const boards = await boardsOf(sheet.boards);
    console.log(`. il foglio: ${table.rows.length} righe · ${twice.size} nomi doppi fuori dal confronto` +
      ` · board ${boards?.clubs ? Object.keys(boards.clubs).length : 0} club`);

    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    const ready = await waitFor(session, () =>
      document.querySelectorAll('[data-block] button').length > 100);
    if (!ready) throw new Error('la plancia non ha disegnato le righe');
    await wait(700);

    const chosen = await evaluate(session, pickLot);
    if (!chosen) throw new Error('nessun blocco con due venduti e un uomo libero: niente da misurare');
    console.log(`. in asta «${chosen.name}» dal blocco ${chosen.block} · venduti ${chosen.paid.length}`);
    await press(session, chosen, 2);

    const shown = await evaluate(session, readLot);
    if (!shown) throw new Error('la riga del lotto non e sullo schermo');
    if (shown.name !== chosen.name) {
      throw new Error(`in asta c'e' «${shown.name}» e non «${chosen.name}»: il resto misurerebbe un altro`);
    }
    const row = byName.get(chosen.name);
    if (!row) throw new Error(`«${chosen.name}» non e' sul foglio, o e' un nome doppio`);
    const id = Number(row[idAt]);

    // 1. LE ULTIME QUATTRO, contro il foglio.
    const wantTrend = trendOfRow(row[detailAt], row[leagueAt]);
    console.log(`. ultime 4: schermo ${JSON.stringify(shown.trend.map((one) =>
      one.text + (one.on ? '^' : '') + (one.off ? 'v' : '')))}`);
    if (!wantTrend) {
      if (shown.trend.some((one) => one.text !== '\u00b7')) {
        problems.push('la striscia stampa dei numeri su un uomo che il foglio non ha nella finestra');
      }
    } else {
      if (shown.trend.length !== 4) problems.push(`la striscia ha ${shown.trend.length} caselle invece di quattro`);
      wantTrend.forEach((want, n) => {
        const got = shown.trend[n];
        if (!got || got.text !== want.text || got.on !== want.on || got.off !== want.off) {
          problems.push(`casella ${n + 1}: schermo «${got?.text}» · foglio «${want.text}»`);
        }
      });
    }

    // 2. Pv | Mv | Fm, contro il pacchetto.
    const line = last.get(id);
    const near = (text, value, digits) => {
      if (value == null) return text === '\u00b7';
      const got = Number(String(text).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(got) && Math.abs(got - value) <= 0.5 * 10 ** -digits + 1e-9;
    };
    const [pv, mv, fm] = shown.last.split('|').map((one) => one.trim());
    console.log(`. ${manifest.input_season}: schermo «${shown.last}» · pacchetto ` +
      `${line ? `${line.pv} ${line.mv} ${line.fm}` : 'nessuna riga'}`);
    if (line) {
      if (!near(pv, line.pv, 0) || !near(mv, line.mv, 2) || !near(fm, line.fm, 2)) {
        problems.push(`la stagione scorsa non e' quella del pacchetto: «${shown.last}»`);
      }
    } else if (shown.last.replace(/[\s|]/g, '') !== '\u00b7\u00b7\u00b7') {
      problems.push(`il pacchetto non ha la sua stagione e la riga stampa «${shown.last}»`);
    }

    // 3. IL SURPLUS, contro la cifra della griglia personale: due letture di una quantita' sola.
    const toMine = await evaluate(session, () => {
      const el = [...document.querySelectorAll('header nz-radio-group label')]
        .find((one) => (one.innerText ?? '').toLowerCase().includes('personali'));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!toMine) problems.push('il taglio «slot personali» non e sullo schermo');
    else {
      await press(session, toMine);
      await wait(600);
      const onGrid = await evaluate(session, surplusOnGrid, chosen.name);
      console.log(`. surplus: riga del lotto «${shown.surplus}» · griglia personale «${onGrid}»`);
      if (onGrid == null) {
        problems.push(`«${chosen.name}» non e' sulla griglia personale: il confronto non aggancia`);
      } else if (onGrid !== shown.surplus) {
        problems.push(`due cifre per un surplus solo: «${shown.surplus}» sulla riga, «${onGrid}» sulla griglia`);
      }
    }

    // 4. IL PREZZO MEDIO PAGATO, ri-derivato dalle righe vendute di quel blocco.
    const mean = chosen.paid.reduce((sum, one) => sum + one, 0) / chosen.paid.length;
    // IL PRIMO NUMERO e non «tutte le cifre incollate»: la cella porta anche il conto («40 su 2»), e
    // spogliarla delle lettere dava  402 - il banco accusava la pagina del proprio difetto.
    const got = Number((shown.paid.match(/-?\d+(\.\d+)?/) ?? ['NaN'])[0]);
    console.log(`. pagato ${chosen.block}: schermo «${shown.paid}» · dalle righe vendute ` +
      `${Math.round(mean)} su ${chosen.paid.length}`);
    if (!shown.paid) {
      problems.push('la riga non dice quanto e stato pagato in quello slot, e c erano acquisti');
    } else if (Math.abs(got - mean) > 0.51) {
      problems.push(`la media pagata non torna: «${shown.paid}» contro ${mean.toFixed(1)}`);
    }
    if (shown.paid && !shown.paid.includes(String(chosen.paid.length))) {
      problems.push(`la media non dice su quanti acquisti e' fatta: «${shown.paid}»`);
    }

    // 5. I RIVALI DI POSIZIONE, contro `boards.json`.
    const wantShirt = shirtFromBoards(boards, String(row[clubAt]), id);
    console.log(`. maglia: schermo «${shown.shirtLabel}» ${JSON.stringify(shown.rivals)} · board ` +
      `${wantShirt ? JSON.stringify(wantShirt.names) : 'non lo nomina'}`);
    if (!wantShirt) {
      if (shown.rivals.length) {
        problems.push('la riga elenca dei rivali che la board non porta');
      }
    } else {
      const names = shown.rivals.map((one) => one.split(/\s{2,}|\n/)[0].trim());
      if (names.length !== wantShirt.names.length) {
        problems.push(`rivali: ${names.length} a schermo contro ${wantShirt.names.length} sulla board`);
      }
      for (const who of wantShirt.names) {
        if (!names.some((one) => one.includes(who))) problems.push(`la board nomina «${who}» e la riga no`);
      }
      // E LA PAROLA DICE DA CHE PARTE STA: «gli contendono» se la board disegna lui.
      const saysMine = shown.shirtLabel.toLowerCase().startsWith('gli contendono');
      if (saysMine !== wantShirt.mine) {
        problems.push(`la riga dice «${shown.shirtLabel}» e la board dice ${wantShirt.mine ? 'che e suo' : 'che e di un altro'}`);
      }
    }
    // 6. E LA RIGA NON SI MUOVE, qualunque calciatore ci sia dentro (sua istruzione, 24/09/2026: «fai
    //    in modo che la riga intera abbia un layout ben definito e che gli elementi non si muovano a
    //    seconda dei contenuti»).
    //
    //    E' una claim sulle LARGHEZZE DICHIARATE e non sul contenuto: si contano i bordi sinistri
    //    distinti di ogni gruppo su una dozzina di lotti - uno, o non e' una colonna - e si verifica che
    //    nessuna cella tagli quello che porta, perche' una larghezza dichiarata e' una promessa che un
    //    carattere in piu' puo' rompere. Il NULL e' il conteggio dei lotti guardati: su uno solo ogni
    //    bordo e' unico per costruzione e il passo direbbe «nessun problema» dopo aver guardato niente.
    const back = await evaluate(session, () => {
      const el = [...document.querySelectorAll('header nz-radio-group label')]
        .find((one) => (one.innerText ?? '').toLowerCase().includes('mercato'));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (back) await press(session, back);
    const edges = new Map();
    const heights = new Set();
    const cut = new Set();
    let looked = 0;
    for (let n = 0; n < 14; n += 1) {
      const at = await evaluate(session, lotAt, n);
      if (!at) continue;
      await press(session, at, 2);
      const now = await evaluate(session, geometryNow);
      if (!now?.groups?.name) continue;
      looked += 1;
      heights.add(now.height);
      for (const [what, box] of Object.entries(now.groups)) {
        edges.set(what, (edges.get(what) ?? new Set()).add(box.left));
        if (box.clipped) cut.add(`${what} (${at.name})`);
      }
    }
    const moving = [...edges.entries()].filter(([, set]) => set.size > 1);
    console.log(`. layout: ${looked} lotti · ${edges.size} gruppi · bordi sinistri distinti ` +
      `${moving.length ? moving.map(([what, set]) => `${what}:${set.size}`).join(' ') : 'uno ciascuno'}` +
      ` · altezze ${[...heights].join('/')}`);
    if (looked < 8) problems.push(`solo ${looked} lotti guardati: il conteggio dei bordi non prova niente`);
    if (moving.length) {
      problems.push(`la riga si muove col contenuto: ${moving.map(([what, set]) => `${what} in ${set.size} posizioni`).join(' · ')}`);
    }
    if (cut.size) problems.push(`celle che tagliano il loro contenuto: ${[...cut].join(' · ')}`);
    if (heights.size > 1) problems.push(`la riga cambia altezza col contenuto: ${[...heights].join(', ')}px`);

    // 9. L'ETICHETTA «MI SERVE, FINO A QUANTO, E' IL MOMENTO» (sua richiesta, 24/09/2026).
    //
    //    Tre affermazioni e tre prove, ognuna contro qualcosa che NON e' l'etichetta stessa:
    //     - il tetto consigliato non supera mai la BANDA misurata, che e' due colonne piu' a destra;
    //     - il momento non contraddice il VERDETTO, che legge lo stesso `worthWaiting` - implicazione
    //       in un verso solo, perche' «lascia» e «fermo» arrivano prima di lui e lo zittiscono;
    //     - «TI SERVE» concorda con la MODALITA' FOCUS, che accende le righe che servono: stesso
    //       predicato, due lettori, e se divergono uno dei due mente.
    const lotNow = await evaluate(session, readLot);
    const brief = lotNow?.brief ?? null;
    const high = Number((lotNow?.band ?? '').replace(/[^0-9]+/g, ' ').trim().split(' ').at(-1));
    const spend = Number((brief?.spend ?? '').replace(/[^0-9]/g, ''));
    const briefProblems = [];
    if (!brief) briefProblems.push("la riga del lotto non porta l'etichetta «mi serve»");
    if (brief && Number.isFinite(high) && Number.isFinite(spend) && spend > high) {
      briefProblems.push(`consiglia ${spend} su una banda che finisce a ${high}`);
    }
    if (brief && lotNow?.verdict === 'clock-circle' && !/aspett/i.test(brief.timing)) {
      briefProblems.push(`il verdetto dice «aspetta» e l'etichetta dice «${brief.timing}»`);
    }
    // IL FOCUS: si accende davvero, e si guarda se la riga di QUESTO uomo resta accesa.
    const focusAt = await evaluate(session, boxOf, '[data-focus]', 'FOCUS');
    let litSays = 'non provato';
    if (focusAt && brief) {
      await press(session, focusAt);
      await new Promise((done) => setTimeout(done, 500));
      const lit = await evaluate(session, (name) => {
        const rows = [...document.querySelectorAll('plancia-slot-matrix [data-block] button')];
        const his = rows.find((row) => (row.innerText ?? '').split(String.fromCharCode(10))[0].trim() === name);
        if (!his) return null;
        return Number(getComputedStyle(his).opacity) >= 0.9;
      }, lotNow.name);
      // DUE CHIAVI DICONO «CHIUDE L'OBIETTIVO»: `serve` e `caro` - la seconda e' lo stesso uomo a un
      // prezzo che non posso pagare, non un uomo che non mi serve. Leggendo solo la prima questo
      // controllo lasciava passare un criterio INVERTITO, e l'ha mostrato la controprova.
      const serves = brief.key === 'serve' || brief.key === 'caro';
      litSays = lit == null ? "la sua riga non e' sul tabellone" : lit ? 'accesa' : 'smorzata';
      if (lit != null && lit !== serves) {
        briefProblems.push(
          `l'etichetta dice «${brief.interest}» e il focus lo lascia ${lit ? 'acceso' : 'smorzato'}`,
        );
      }
      // ...E IL CASO POSITIVO, che senza non viene mai provato: col focus acceso si mette in asta una
      // riga ACCESA e si pretende che l'etichetta dica «serve». Un banco che vede solo «non serve»
      // ha guardato meta' della funzione, e nella meta' guardata un `false` costante passerebbe.
      const litRow = await evaluate(session, () => {
        const rows = [...document.querySelectorAll('plancia-slot-matrix [data-block] button')];
        const on = rows.find((row) => {
          const bar = row.querySelector(':scope > span');
          const paint = bar ? getComputedStyle(bar).backgroundColor : '';
          const owned = !!paint && paint !== 'transparent' && !paint.startsWith('rgba(0, 0, 0, 0');
          return !owned && Number(getComputedStyle(row).opacity) >= 0.9;
        });
        if (!on) return null;
        const r = on.getBoundingClientRect();
        return { x: r.left + r.width / 3, y: r.top + r.height / 2 };
      });
      if (litRow) {
        await press(session, litRow, 2);
        const served = await evaluate(session, readLot);
        const key = served?.brief?.key ?? '';
        litSays += ` · acceso in asta: «${served?.brief?.interest ?? '?'}»`;
        if (key !== 'serve' && key !== 'caro') {
          briefProblems.push(
            `una riga che il focus tiene ACCESA legge «${served?.brief?.interest}» in asta`,
          );
        }
      } else {
        briefProblems.push('col focus acceso nessuna riga libera resta accesa: il ramo «serve» non e stato provato');
      }
      await press(session, focusAt);
      await new Promise((done) => setTimeout(done, 300));
    }
    console.log(
      `. mi serve: «${brief?.interest ?? '?'}» · fino a ${brief?.spend ?? '?'} cr ${brief?.bound ?? ''}` +
        ` · «${brief?.timing ?? '?'}» · banda fino a ${high} · nel focus ${litSays}`,
    );

    // 10. I DUE TETTI DELLA BORSA SULLA BARRA (sua richiesta, 24/09/2026), e tre invarianti che si
    //     provano senza conoscere ne' il budget ne' la mia rosa:
    //      - il SENSATO non supera mai l'ASSOLUTO, perche' la riserva del primo e' fatta di prezzi che
    //        valgono almeno un credito l'uno, cioe' almeno la riserva del secondo. E' aritmetica, non
    //        un'aspettativa: se si inverte, una delle due riserve conta i posti sbagliati;
    //      - il tetto CONSIGLIATO non supera l'assoluto, che e' il muro del regolamento;
    //      - le due MARCHE stanno sulla barra in proporzione alle due cifre. Senza questa, una marca
    //        disegnata dalla quantita' sbagliata resterebbe invisibile: la barra e' larga 160px e uno
    //        scarto di venti crediti sono tre pixel.
    const roof = lotNow?.ceilings ?? null;
    const ceilProblems = [];
    if (!roof || roof.absolute == null || roof.sensible == null) {
      ceilProblems.push('la barra non porta i due tetti della borsa');
    } else {
      if (roof.sensible > roof.absolute) {
        ceilProblems.push(`il tetto sensato (${roof.sensible}) supera l'assoluto (${roof.absolute})`);
      }
      if (Number.isFinite(spend) && spend > roof.absolute) {
        ceilProblems.push(`consiglia ${spend} sopra il massimo assoluto (${roof.absolute})`);
      }
      // LA PROPORZIONE, che non ha bisogno del budget: due marche sulla stessa scala stanno fra loro
      // come le due cifre. Mezzo punto percentuale di tolleranza, che a 160px e' meno di un pixel.
      if (roof.absolute > 0 && roof.sensibleAt != null && roof.absoluteAt != null) {
        const wanted = (roof.sensible / roof.absolute) * roof.absoluteAt;
        if (Math.abs(wanted - roof.sensibleAt) > 0.5) {
          ceilProblems.push(
            `la marca del sensato cade al ${roof.sensibleAt.toFixed(1)}% invece che al ` +
              `${wanted.toFixed(1)}%: e' disegnata da un'altra quantita'`,
          );
        }
      }
    }
    console.log(
      `. la borsa sulla barra: sensato ${roof?.sensible ?? '?'} (${roof?.sensibleAt?.toFixed(1) ?? '?'}%)` +
        ` · assoluto ${roof?.absolute ?? '?'} (${roof?.absoluteAt?.toFixed(1) ?? '?'}%)`,
    );
    problems.push(...briefProblems, ...ceilProblems);
  } finally {
    if (session) session.close();
    browser.kill();
    server.close();
  }
  for (const one of problems) console.log(`    ! ${one}`);
  console.log(problems.length ? `\nPROBLEMI: ${problems.length}` : '\nnessun problema');
  if (problems.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
