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
  const out = { name: '', trend: [], last: '', surplus: '', paid: '', rivals: [], shirtLabel: '' };
  out.name = (card.querySelector('.truncate')?.innerText ?? '').trim();
  for (const group of groups) {
    const what = group.getAttribute('data-lot-group');
    if (what === 'trend') {
      out.trend = [...group.querySelectorAll('[data-trend-cell]')].map((cell) => ({
        text: (cell.innerText ?? '').trim(),
        on: !!cell.querySelector('svg[aria-label="subentrato"]'),
        off: !!cell.querySelector('svg[aria-label="sostituito"]'),
      }));
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
