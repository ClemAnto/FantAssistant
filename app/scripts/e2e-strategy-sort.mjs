/**
 * e2e-strategy-sort.mjs - IL DOPPIO CLICK CHE ORDINA, sulla pagina Strategia vera.
 *
 * Nato il 16/09/2026 dalla richiesta dell'operatore: «quando faccio doppio click su un valore
 * nell'item del giocatore, attivi l'ordinamento per quel valore; un successivo doppio click inverti
 * l'ordinamento; deve funzionare anche cliccando sul nome».
 *
 * PERCHE' UN BROWSER E NON UNO SPEC. Un doppio click e' un GESTO: quello che va provato non e' che
 * `sortOn` faccia la cosa giusta - per quello c'e' `strategy.spec.ts` - ma che il browser consegni
 * l'evento a quell'elemento e che il `click` che lo precede non faccia partire anche la card. Il
 * difetto che questo banco esiste per cogliere e' esattamente quello: un doppio click emette PRIMA un
 * `click`, e senza la guardia la card si apre in mezzo al gesto (misurato sulla plancia il
 * 04/09/2026: «un guard che ferma meta' di un gesto lo rende meta' rotto»).
 *
 * Cosa misura, e ogni riga dice su quante cose ha guardato:
 *   - il doppio click su una PASTIGLIA imposta quella chiave in barra e RIORDINA la lista;
 *   - un secondo doppio click sullo stesso bersaglio INVERTE, e lo dice a schermo (la freccia);
 *   - il doppio click sul NOME ordina per nome, dalla A;
 *   - il doppio click NON apre la card - che e' la guardia, ed e' la sola asserzione che cade se la
 *     si toglie;
 *   - un click SINGOLO apre la card lo stesso, cioe' la guardia non si e' mangiata il gesto che
 *     c'era prima.
 *
 * Usage: node scripts/e2e-strategy-sort.mjs [--headed]
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist', 'fantassistant', 'browser');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gz': 'application/gzip', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const HEADED = process.argv.includes('--headed');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(dir) {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      let file = join(dir, decodeURIComponent(req.url.split('?')[0]));
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        ...(extname(file) === '.gz' ? { 'content-encoding': 'gzip' } : {}) });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => done(server.address().port));
  });
}
async function devToolsPort(p) {
  for (let i = 0; i < 80; i += 1) {
    try { return (await readFile(join(p, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); }
    catch { await wait(250); }
  }
  throw new Error('no port');
}
async function attach(port) {
  let list;
  for (let i = 0; i < 60; i += 1) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((o) => o.type === 'page')) break; } catch { /* coming up */ }
    await wait(250);
  }
  const socket = new WebSocket(list.find((o) => o.type === 'page').webSocketDebuggerUrl);
  await new Promise((d, f) => { socket.addEventListener('open', d, { once: true });
    socket.addEventListener('error', f, { once: true }); });
  let seq = 0; const pending = new Map();
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data); const w = pending.get(m.id); if (!w) return;
    pending.delete(m.id); m.error ? w.f(new Error(JSON.stringify(m.error))) : w.d(m.result);
  });
  return (method, params = {}) => new Promise((d, f) => {
    const id = (seq += 1); pending.set(id, { d, f }); socket.send(JSON.stringify({ id, method, params }));
  });
}

const port = await serve(DIST);
const profile = await mkdtemp(join(tmpdir(), 'sort-'));
const browser = spawn(BROWSERS.find((o) => existsSync(o)),
  [...(HEADED ? [] : ['--headless=new']), '--remote-debugging-port=0', `--user-data-dir=${profile}`,
   '--no-first-run', '--no-default-browser-check', '--window-size=1800,1200',
   `http://127.0.0.1:${port}/strategy`], { stdio: 'ignore' });
const send = await attach(await devToolsPort(profile));
await send('Runtime.enable');

const ev = async (fn, ...args) => {
  const r = await send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`,
    returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
  return r.result.value;
};

/**
 * UN PUNTATORE VERO, e il doppio click si manda come lo manda il sistema: due coppie press/release,
 * la seconda con `clickCount: 2`. E' quella che fa sintetizzare `dblclick` al browser - mandare due
 * click a `clickCount: 1` verifica due click singoli, cioe' un'altra cosa.
 */
async function pointer(point, { times = 1 } = {}) {
  const at = { x: Math.round(point.x), y: Math.round(point.y) };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'none' });
  await wait(50);
  for (let n = 1; n <= times; n += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', clickCount: n });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', clickCount: n });
    if (n < times) await wait(30);
  }
  // Piu' lungo del ritardo che la pagina mette sul click (`DOUBLE_MS` = 250 ms): un banco che misura
  // prima che l'attesa sia scaduta legge lo stato di mezzo e accusa la pagina del proprio anticipo.
  await wait(500);
}

/** Dove il browser dice che sta un bersaglio, e null se non c'e' - un passo che non trova deve DIRLO. */
const boxOf = (selector) => {
  const node = document.querySelector(selector);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/** Lo stato che conta: la chiave in barra, il verso dichiarato, e i nomi del primo blocco. */
const readState = () => {
  const block = document.querySelector('app-strategy ol');
  const names = [...(block?.querySelectorAll('[data-name]') ?? [])].map((o) => o.textContent.trim());
  return {
    sort: (document.querySelector('app-strategy nz-select[data-sort]')?.innerText ?? '').trim(),
    dir: document.querySelector('[data-sort-dir]')?.getAttribute('data-dir') ?? null,
    saved: localStorage.getItem('fantassistant.strategy.sort'),
    savedDir: localStorage.getItem('fantassistant.strategy.sortDir'),
    names,
    card: !!document.querySelector('ui-player-card, .ant-modal-content'),
  };
};

const problems = [];
const say = (ok, line) => { console.log(`${ok ? '  ok  ' : '  ×   '}${line}`); if (!ok) problems.push(line); };

/**
 * ASPETTA CHE LA PAGINA CI SIA, e la sonda deve poter dire «non ancora» invece di morire.
 *
 * Fra il lancio del browser e il primo frame il documento non e' ancora quello servito da noi: li'
 * `localStorage` LANCIA (`SecurityError`), e un ciclo che polla con una sonda che puo' morire non
 * aspetta niente - e' la regola gia' pagata su `e2e-options` il 04/09/2026.
 */
async function until(fn, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try { if (await ev(fn)) return true; } catch { /* non ancora */ }
    await wait(500);
  }
  return false;
}

try {
  if (!(await until(() => !!document.querySelector('app-strategy')))) {
    throw new Error('la pagina Strategia non si e montata');
  }
  // La pagina parte com'e' uscita di fabbrica: una preferenza salvata da una corsa precedente
  // ordinerebbe la lista prima che il banco tocchi qualcosa, e il primo confronto misurerebbe quella.
  await ev(() => { localStorage.clear(); location.reload(); });
  await wait(1500);
  if (!(await until(() => !!document.querySelector('app-strategy ol [data-name]')))) {
    throw new Error('nessun nome disegnato: il pacchetto non e arrivato');
  }

  const start = await ev(readState);
  console.log(`[sort] partenza: chiave «${start.sort}», verso ${start.dir}, ${start.names.length} nomi nel primo blocco`);
  if (!start.names.length) throw new Error('nessun nome nel primo blocco: la pagina non ha dati');

  // --- 1. il doppio click su una pastiglia ordina per quella lettura
  const pill = await ev(() =>
    (() => {
      const node = document.querySelector('app-strategy ol li [data-sort-key][data-reading]');
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, key: node.getAttribute('data-sort-key') };
    })());
  if (!pill) throw new Error('nessuna pastiglia ordinabile a schermo');
  await pointer(pill, { times: 2 });
  const afterPill = await ev(readState);
  say(afterPill.saved === pill.key,
    `la chiave in vigore e' quella della pastiglia: «${afterPill.saved}» contro «${pill.key}»`);
  say(afterPill.names.join('|') !== start.names.join('|'),
    `la lista si e' riordinata (${afterPill.names.slice(0, 3).join(', ')}…)`);
  say(!afterPill.card, 'il doppio click NON ha aperto la card');
  say(afterPill.dir === 'desc', `il verso parte dal naturale di un numero: ${afterPill.dir}`);

  // --- 2. un secondo doppio click inverte, e lo dice
  await pointer(pill, { times: 2 });
  const flipped = await ev(readState);
  say(flipped.dir === 'asc' && flipped.savedDir === 'asc',
    `il secondo doppio click ha invertito il verso: ${flipped.dir}`);
  say(flipped.saved === pill.key, 'e la chiave non e\' cambiata');
  // I NOMI SI ROVESCIANO, ma non si pretende l'esatto contrario: chi quel numero non ce l'ha resta in
  // fondo in TUTT'E DUE i versi (`strategy.spec.ts`), quindi una lista con dei vuoti non e' simmetrica.
  say(flipped.names[0] !== afterPill.names[0],
    `e la lista e' cambiata in testa: ${afterPill.names[0]} -> ${flipped.names[0]}`);

  // --- 3. il doppio click sul nome ordina per nome
  const name = await ev(boxOf, 'app-strategy ol li [data-name]');
  if (!name) throw new Error('nessun nome cliccabile');
  await pointer(name, { times: 2 });
  const byName = await ev(readState);
  say(byName.saved === 'name', `il doppio click sul nome ordina per nome: «${byName.saved}»`);
  say(byName.dir === 'asc', `e il verso naturale di un NOME e' dalla A: ${byName.dir}`);
  const sorted = [...byName.names].sort((a, b) => a.localeCompare(b));
  say(byName.names.join('|') === sorted.join('|'),
    `i nomi sono in ordine alfabetico (${byName.names.slice(0, 3).join(', ')}…)`);
  say(!byName.card, 'e nemmeno questo ha aperto la card');

  // --- 4. ...e un click SINGOLO la apre ancora: la guardia non si e' mangiata il gesto che c'era
  await pointer(name, { times: 1 });
  const clicked = await ev(readState);
  say(clicked.card, 'un click singolo sul nome apre la card');

  console.log(`[sort] ${problems.length ? `${problems.length} problemi` : 'nessun problema'} `
    + `su 4 gesti e ${start.names.length} righe del primo blocco`);
} finally {
  browser.kill();
}
process.exit(problems.length ? 1 : 0);
