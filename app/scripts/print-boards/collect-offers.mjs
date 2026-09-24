/**
 * Legge la MAX OFFERTA della plancia VERA, riga per riga, e la scrive in un JSON.
 *
 * Non ricalcola niente: `offerBand` ha dieci ingressi (lo slot, la mediana del blocco, il budget, la
 * quota di calendario, la confidenza, lo sconto stesso-club, il tetto della scommessa...) e
 * riscriverli qui sarebbe un secondo lettore dello stesso foglio, cioe' un uomo con due prezzi.
 * Si apre la pagina spedita e si legge quello che dice.
 *
 * TAVOLO VUOTO (il default dal 23/09/2026): li' la colonna e' la max offerta per tutti. Su un tavolo
 * giocato la stessa colonna porta il prezzo PAGATO sulle righe di qualcuno, che e' un altro numero.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve('D:/Projects/FantAssistant/app');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const OUT = process.argv[2] ?? join(process.cwd(), 'offers.json');
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((one) => one.type === 'page')) break;
    } catch {
      /* still coming up */
    }
    await wait(250);
  }
  const page = list?.find((one) => one.type === 'page');
  if (!page) throw new Error('no page target');
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

async function waitFor(session, fn, tries = 80) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const out = await evaluate(session, fn);
    if (out) return out;
    await wait(250);
  }
  return null;
}

/** Il tabellone come lo schermo ce l'ha: per blocco, le righe col nome e l'ultima cella. */
function readBoard() {
  const blocks = [...document.querySelectorAll('plancia-slot-matrix [data-block]')].filter((one) =>
    one.querySelector('button'),
  );
  if (!blocks.length) return null;
  return blocks.map((block) => {
    const header = block.firstElementChild;
    const figures = [...header.querySelectorAll('span')].map((one) => (one.innerText ?? '').trim());
    return {
      id: figures[0] ?? '?',
      rows: [...block.querySelectorAll('button')].map((row) => {
        const cells = [...row.querySelectorAll('span')];
        const paint = cells[0] ? getComputedStyle(cells[0]).backgroundColor : '';
        return {
          name: (row.innerText ?? '').split('\n')[0].trim(),
          offer: (cells.at(-1)?.innerText ?? '').trim(),
          owned: !!paint && paint !== 'transparent' && !paint.startsWith('rgba(0, 0, 0, 0'),
        };
      }),
    };
  });
}

/** Quello che la barra dichiara della lega: e' il contesto su cui ogni tetto poggia. */
function readHead() {
  return (document.body.innerText ?? '').slice(0, 600);
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build in ${DIST}`);
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');
  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-offers-'));
  const debugPort = await freePort();
  const url = `http://127.0.0.1:${port}/plancia`;
  const browser = spawn(
    binary,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1600,1200',
      url,
    ],
    { stdio: 'ignore' },
  );
  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await wait(2000);
    const board = await waitFor(session, readBoard);
    if (!board) throw new Error('la plancia non ha disegnato nessun blocco');
    const head = await evaluate(session, readHead);
    const rows = [];
    for (const block of board) for (const row of block.rows) rows.push({ block: block.id, ...row });
    const owned = rows.filter((one) => one.owned).length;
    await writeFile(OUT, JSON.stringify({ url, blocks: board.length, owned, head, rows }, null, 1), 'utf8');
    console.log(`blocchi ${board.length} · righe ${rows.length} · di qualcuno ${owned}`);
    console.log(head.split('\n').slice(0, 12).join(' | '));
    console.log(`scritto ${OUT}`);
  } finally {
    session?.close();
    browser.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
