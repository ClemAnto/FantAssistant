/**
 * Il PULSANTE dei due orizzonti, guidato con un puntatore vero sulla pagina Squadre.
 *
 * Serve `dist/`, dove il `boards.json` porta la board dell'ultimo periodo scritta da uno `snapshot` vero.
 * Quello che misura, e ogni passo dice su quante cose ha guardato:
 *   - il pulsante c'e' (il pacchetto porta `short`) e parte su «Stagione»
 *   - un click su «Ultimo periodo» CAMBIA gli undici nomi disegnati, e la barra lo dichiara
 *   - i nomi nuovi sono quelli che la board breve del file dichiara: il confronto e' col FILE e non con
 *     lo schermo, o sarebbe l'asserzione circolare
 *
 * SALTA, DICENDOLO, se il bundle non porta ancora `short`: il pulsante esiste solo se la board
 * dell'ultimo periodo c'e', e un «nessun problema» dopo aver guardato niente e' peggio di un rosso.
 *
 * Usage: node scripts/e2e-board-horizon.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gz': 'application/gzip', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(dir) {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent(req.url.split('?')[0]);
      let file = join(dir, path);
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        ...(extname(file) === '.gz' ? { 'content-encoding': 'gzip' } : {}) });
      res.end(body);
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
    if (m.method === 'Runtime.exceptionThrown') noise.push(String(m.params?.exceptionDetails?.text));
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

// ---- IL FILE, letto qui: il confronto e' col bundle e mai con lo schermo.
const boards = JSON.parse(readFileSync(join(DIST, 'data', 'boards', 'leghe.json'), 'utf8'));
const namesOf = (board) => Object.values(board?.lines ?? {}).flat().map((m) => m.name).filter(Boolean);
const CLUB = 'Genoa';
const wantLong = namesOf(boards.clubs[CLUB]).sort();
if (!boards.short?.clubs) {
  // SALTATO, E LO DICE FORTE: questo banco misura il pulsante, e il pulsante esiste solo se il pacchetto
  // porta la board dell'ultimo periodo. Un «nessun problema» dopo aver guardato NIENTE e' il difetto che
  // questo progetto si e' scritto tre volte, quindi qui si stampa quante cose sono state controllate (zero)
  // e come rimediare, invece di uscire verde in silenzio.
  console.log("SALTATO · 0 controlli: il bundle non porta ancora la board dell'ultimo periodo.");
  console.log('  Rilancia `python -m euroleghe_ingest snapshot --league Leghe` e poi `export`,');
  console.log('  poi `node scripts/pull-bundle.mjs`: data/boards/leghe.json deve avere la chiave short.');
  process.exit(0);
}
const wantShort = namesOf(boards.short.clubs[CLUB]).sort();

const binary = BROWSERS.find((o) => existsSync(o));
const profile = await mkdtemp(join(tmpdir(), 'horizon-'));
const { port } = await serve(DIST);
const browser = spawn(binary, ['--headless=new', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1600,1100',
  `http://127.0.0.1:${port}/clubs?platform=default&club=${CLUB}`], { stdio: 'ignore' });
const s = await attach(await devToolsPort(profile));
await s.send('Runtime.enable');

const problems = [];
const pitch = () => ev(s, () => {
  // UN ITEM E' UN POSTO (`data-place`) e il PRIMO candidato dentro di lui e' il titolare: e' come il
  // campetto si dichiara, e prendere «ogni foglia con del testo» leggeva anche i ruoli e i ballottaggi.
  const names = [...document.querySelectorAll('ui-club-board [data-place]')]
    .map((place) => {
      // Il TITOLARE e' il primo candidato cliccabile del posto, e il suo nome e' il primo `.truncate`
      // dentro di lui: letto dalla sonda sul DOM vero, non indovinato - `span[1]` era il ruolo.
      const first = place.querySelector('[role="button"] .truncate');
      return (first?.textContent ?? '').trim();
    })
    .filter(Boolean);
  // UN DOMRect NON ATTRAVERSA CDP: i suoi campi non sono proprieta' proprie, quindi `returnByValue` lo
  // consegna vuoto e il click parte con x undefined. Si spacchetta di qua.
  const buttons = [...document.querySelectorAll('nz-radio-group label')].map((l) => {
    const box = l.getBoundingClientRect();
    return { text: l.textContent.trim(), on: l.className.includes('checked'),
      x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  return { names, buttons, banner: document.body.innerText.includes('ultimo periodo') };
});

let seen = null;
for (let i = 0; i < 200; i += 1) {
  seen = await pitch();
  if (seen?.names?.length) break;
  await wait(250);
}

const horizonButtons = seen.buttons.filter((b) => /Stagione|Ultimo periodo/.test(b.text));
console.log(`· il pulsante c'e': ${horizonButtons.length} voci (${horizonButtons.map((b) => b.text).join(' / ')})`);
if (horizonButtons.length !== 2) problems.push('il selettore dei due orizzonti non e\' a schermo');
const before = seen.names.filter((n) => wantLong.includes(n) || wantShort.includes(n)).sort();
console.log(`· all'apertura disegna ${before.length} nomi · combaciano con la board LUNGA del file: `
  + `${JSON.stringify(before) === JSON.stringify(wantLong)}`);
if (JSON.stringify(before) !== JSON.stringify(wantLong)) {
  problems.push(`apertura: schermo ${before.length} contro file ${wantLong.length}`);
}

// CLICK VERO sul secondo bottone, alle coordinate che il browser dichiara.
const target = horizonButtons.find((b) => b.text.includes('Ultimo periodo'));
if (target) {
  const { x, y } = target;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse' });
  }
  let after = null;
  for (let i = 0; i < 40; i += 1) {
    after = await pitch();
    const now = after.names.filter((n) => wantLong.includes(n) || wantShort.includes(n)).sort();
    if (JSON.stringify(now) !== JSON.stringify(before)) break;
    await wait(150);
  }
  const now = after.names.filter((n) => wantLong.includes(n) || wantShort.includes(n)).sort();
  console.log(`· dopo il click disegna ${now.length} nomi · combaciano con la board BREVE del file: `
    + `${JSON.stringify(now) === JSON.stringify(wantShort)}`);
  if (JSON.stringify(now) !== JSON.stringify(wantShort)) {
    problems.push(`dopo il click: ${JSON.stringify(now)} contro ${JSON.stringify(wantShort)}`);
  }
  console.log(`· la barra dichiara l'orizzonte scelto: ${after.banner}`);
  if (!after.banner) problems.push('nessuna riga dice che si sta guardando l\'ultimo periodo');
} else {
  problems.push('nessun bottone «Ultimo periodo» da premere');
}
if (s.noise.length) problems.push(`eccezioni in console: ${s.noise.slice(0, 3).join(' | ')}`);
console.log(problems.length ? `\nPROBLEMI:\n  ${problems.join('\n  ')}` : '\nnessun problema');
browser.kill();
process.exit(problems.length ? 1 : 0);
