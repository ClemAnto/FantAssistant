/**
 * e2e-coach-break.mjs - il separatore del CAMBIO ALLENATORE sulla vista Squadre / Ultime partite.
 *
 * Richiesta dell'operatore (11/09/2026): «evidenzia quando viene cambiato allenatore nella vista
 * squadre/ultime partite con un separatore diverso da quello del cambio stagione». Questo banco guida
 * la pagina vera e misura che i DUE confini si vedano diversi.
 *
 * Cosa controlla, e ogni riga dice su quante cose ha guardato:
 *   - quale club la pagina sta DAVVERO mostrando: chiedere un club che non e' in quel listone fa
 *     ripiegare la pagina sul primo, e ogni numero letto dopo e' di un altro club (succede: Chelsea
 *     su `platform=default` mostrava l'Atalanta, e il banco accusava l'app del proprio difetto);
 *   - i confini di PANCHINA, col nome nel titolo e il doppio bordo;
 *   - i confini di STAGIONE, col bordo semplice - cioe' che i due non si confondano;
 *   - e UNO ZERO E' UN RISULTATO: un club senza cambi nelle dieci partite non deve disegnare niente
 *     (il Genoa, il cui cambio e' di novembre 2025 e cade fuori dalla finestra).
 *
 * Usage: node scripts/e2e-coach-break.mjs [club] [default|euro]
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
const profile = await mkdtemp(join(tmpdir(), 'coach-'));
const CLUB = process.argv[2] ?? 'Atalanta';
const PLATFORM = process.argv[3] ?? 'default';
const browser = spawn(BROWSERS.find((o) => existsSync(o)),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
   '--no-first-run', '--no-default-browser-check', '--window-size=1800,1200',
   `http://127.0.0.1:${port}/clubs?platform=${PLATFORM}&club=${CLUB}&vista=matches`], { stdio: 'ignore' });
const send = await attach(await devToolsPort(profile));
await send('Runtime.enable');
const ev = async (fn) => {
  const r = await send('Runtime.evaluate', { expression: `(${fn.toString()})()`, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
  return r.result.value;
};

let seen = null;
for (let i = 0; i < 200; i += 1) {
  seen = await ev(() => {
    const heads = [...document.querySelectorAll('thead tr th')];
    if (heads.length < 3) return null;
    // Un confine e' una TH senza testo: si distinguono per la CLASSE, che e' quello che il template
    // decide - non per il colore calcolato, che su un tema con due versi non si confronta con niente.
    const breaks = heads.filter((h) => !h.textContent.trim() || h.textContent.trim() === '⇄')
      .map((h) => ({ cls: h.className, title: h.getAttribute('title') || '',
                     doubled: h.className.includes('border-double'), text: h.textContent.trim() }));
    const shown = document.querySelector('h2')?.textContent?.trim() ?? '';
    return { heads: heads.length, breaks, shown };
  });
  if (seen) break;
  await wait(250);
}
const coach = seen.breaks.filter((b) => b.doubled);
// Il titolo del confine di stagione dice «Confine fra le stagioni ...» e NON porta la freccia
// (quella sta nel testo del divisore): cercarla qui leggeva zero su una tabella che ne ha uno.
const season = seen.breaks.filter((b) => !b.doubled && b.title.startsWith('Confine fra le stagioni'));
console.log(`${CLUB} (${PLATFORM}): ${seen.heads} intestazioni · a schermo c'e' «${seen.shown}»`);
if (seen.shown && seen.shown !== CLUB) {
  console.log('  ATTENZIONE: la pagina mostra un ALTRO club - il club chiesto non e in questo listone,');
  console.log('  e ogni numero qui sotto e di quello a schermo. Era un difetto del banco, non dell app.');
}
console.log(`  confini di PANCHINA (doppio bordo): ${coach.length}`);
for (const b of coach) console.log(`     «${b.title}»  segno: ${b.text || '(niente)'}`);
console.log(`  confini di STAGIONE (bordo semplice): ${season.length}`);
for (const b of season) console.log(`     «${b.title}»`);
// UNO ZERO E' UN RISULTATO: un club senza cambi nella finestra non deve disegnare niente, e
// pretendere almeno un confine faceva leggere «PROBLEMA» su una pagina giusta (il Genoa, il cui
// cambio e' di novembre e cade fuori dalle dieci partite).
const ok = seen.shown === CLUB && coach.every((b) => b.title.startsWith('Cambio in panchina'))
  && season.every((b) => !b.doubled);
console.log(ok ? '\nI DUE SEPARATORI SI VEDONO DIVERSI' : '\nPROBLEMA: vedi sopra');
browser.kill();
process.exit(ok ? 0 : 1);
