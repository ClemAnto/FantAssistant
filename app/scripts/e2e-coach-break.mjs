/**
 * e2e-coach-break.mjs - L'ASSE della striscia «Ultime partite» sulla vista Squadre.
 *
 * Nato l'11/09/2026 per i due separatori («evidenzia quando viene cambiato allenatore ... con un
 * separatore diverso da quello del cambio stagione») e allargato il 15/09 alle altre due cose che
 * decidono di quale partita una colonna parla, perche' sono la stessa domanda vista da tre lati.
 *
 * Cosa controlla, e ogni riga dice su quante cose ha guardato:
 *   - quale club la pagina sta DAVVERO mostrando: chiedere un club che non e' in quel listone fa
 *     ripiegare la pagina sul primo, e ogni numero letto dopo e' di un altro club (succede: Chelsea
 *     su `platform=default` mostrava l'Atalanta, e il banco accusava l'app del proprio difetto);
 *   - i confini di PANCHINA e quelli di STAGIONE, cioe' che i due non si confondano - e che il cambio
 *     a cavallo di due stagioni NON produca due separatori attaccati, ma marchi quello che c'e' gia';
 *   - CHE LA LINEA NON SIA ROTTA, e si misura sul meccanismo e non a occhio: il difetto del 15/09 era
 *     che `border-double` e `border-primary/70` scrivono stile e colore su tutti e quattro i lati,
 *     quindi ridipingevano il separatore di riga da 1px che antd mette sotto ogni cella - un piolo rosa
 *     a ogni riga. Si pretende quindi che il bordo INFERIORE di una cella di confine sia trasparente e
 *     che la linea sia uno SFONDO, che e' esattamente cio' che la cura fa e che il markup vecchio non
 *     faceva;
 *   - CHE NESSUNA COLONNA SCRIVA `???`: una partita giocata di cui il livello per-partita non e' ancora
 *     arrivato non sa dire contro chi, ne' in che campo, ne' con che modulo, e viene tolta;
 *   - CHE LA PROSSIMA PARTITA CI SIA, sia la prima colonna e abbia tutte le celle VUOTE - non un
 *     trattino, che in questa tabella vuol dire un'altra cosa;
 *   - e UNO ZERO E' UN RISULTATO: un club senza cambi nelle dieci partite non deve disegnare niente
 *     (il Genoa, il cui cambio e' di novembre 2025 e cade fuori dalla finestra).
 *
 * Usage: node scripts/e2e-coach-break.mjs [club,club,...] [default|euro]
 *   Il default sono i due club che portano i tre casi: la Fiorentina (un cambio DENTRO la stagione piu'
 *   un confine di stagione che ne porta un altro) e l'Atalanta (solo il secondo).
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
const CLUBS = (process.argv[2] ?? 'Fiorentina,Atalanta').split(',').filter(Boolean);
const PLATFORM = process.argv[3] ?? 'default';
const browser = spawn(BROWSERS.find((o) => existsSync(o)),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
   '--no-first-run', '--no-default-browser-check', '--window-size=1800,1200',
   `http://127.0.0.1:${port}/clubs?platform=${PLATFORM}&vista=matches`], { stdio: 'ignore' });
const send = await attach(await devToolsPort(profile));
await send('Runtime.enable');
const ev = async (fn) => {
  const r = await send('Runtime.evaluate', { expression: `(${fn.toString()})()`, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
  return r.result.value;
};

/**
 * Cosa la pagina disegna davvero, per un club.
 *
 * Le classi sono quello che il TEMPLATE decide, quindi i confini si riconoscono da li'; il colore
 * calcolato no - su un tema con due versi non si confronta con niente. Quello che invece SI legge
 * calcolato e' il bordo INFERIORE di una cella di confine, perche' li' la domanda non e' «di che
 * colore e'» ma «e' trasparente», che e' un'affermazione sul meccanismo e non sulla tinta.
 */
const read = () => {
  const heads = [...document.querySelectorAll('thead tr th')];
  if (heads.length < 6) return null;
  const shown = document.querySelector('h2')?.textContent?.trim() ?? '';
  if (!shown) return null;
  // QUALE COLONNA E' UN CONFINE lo dice il TITOLO, cioe' il DATO, e non la classe: identificarlo
  // dalla classe che si sta verificando e' un'asserzione circolare - col markup vecchio questo banco
  // non trovava nessun confine e stampava «tutto a posto» dopo aver guardato niente (misurato il
  // 15/09/2026 rimettendo il difetto, che e' l'unico modo di sapere che un banco morde).
  const kindOf = (title) =>
    title.startsWith('Cambio in panchina') ? 'coach'
      : title.startsWith('Confine fra le stagioni') ? 'season'
        : title.startsWith('Prossima partita') ? 'upcoming' : null;
  const columns = heads.map((h) => {
    const title = h.getAttribute('title') || '';
    return {
      kind: kindOf(title),
      cls: h.className,
      text: h.textContent.trim(),
      title,
      mark: h.textContent.trim() === '⇄',
    };
  });
  // Le celle di una colonna: la riga qualunque non basta, perche' una cella vuota si distingue da una
  // col trattino solo guardandole TUTTE - un trattino su venticinque righe e' esattamente il difetto
  // che questa asserzione esiste per trovare.
  const rows = [...document.querySelectorAll('tbody tr')];
  const at = columns.findIndex((one) => one.kind === 'upcoming');
  const upcomingCells = at < 0 ? [] : rows.map((tr) => (tr.children[at]?.textContent ?? '').trim());
  // Il bordo di riga di una cella di confine, e lo SFONDO che disegna la linea. Col markup vecchio il
  // primo era del colore primario (il piolo) e il secondo era `none`.
  const breakCells = [];
  for (const [index, column] of columns.entries()) {
    if (column.kind !== 'coach' && column.kind !== 'season') continue;
    const cell = rows[0]?.children[index];
    if (!cell) continue;
    const style = getComputedStyle(cell);
    breakCells.push({ kind: column.kind, cls: cell.className, bottom: style.borderBottomColor,
                      line: style.backgroundImage === 'none' ? 'nessuna' : 'sfondo' });
  }
  // Due confini ATTACCATI: e' il difetto del 15/09, e si conta sulle posizioni e non sui titoli.
  const glued = columns.filter((one, index) =>
    (one.kind === 'coach' || one.kind === 'season')
    && (columns[index + 1]?.kind === 'coach' || columns[index + 1]?.kind === 'season')).length;
  return { shown, columns, upcomingCells, breakCells, glued, rows: rows.length };
};

let bad = 0;
for (const club of CLUBS) {
  await send('Page.navigate',
    { url: `http://127.0.0.1:${port}/clubs?platform=${PLATFORM}&club=${encodeURIComponent(club)}&vista=matches` });
  let seen = null;
  for (let i = 0; i < 300; i += 1) {
    seen = await ev(read);
    if (seen && seen.shown === club) break;
    await wait(200);
  }
  if (!seen) { console.log(`${club}: NON LETTO`); bad += 1; continue; }
  const say = (ok, line) => { if (!ok) bad += 1; console.log(`   ${ok ? '·' : 'PROBLEMA:'} ${line}`); };
  const coach = seen.columns.filter((one) => one.kind === 'coach');
  const season = seen.columns.filter((one) => one.kind === 'season');
  const upcoming = seen.columns.filter((one) => one.kind === 'upcoming');
  const unnamed = seen.columns.filter((one) => one.text.includes('???') || one.title.includes('Ignota'));

  console.log(`${club} (${PLATFORM}): ${seen.columns.length} intestazioni · ${seen.rows} righe · a schermo c'e' «${seen.shown}»`);
  if (seen.shown !== club) {
    console.log('   ATTENZIONE: la pagina mostra un ALTRO club - ogni numero qui sotto e di quello.');
    bad += 1;
    continue;
  }
  console.log(`   confini di PANCHINA ${coach.length} · di STAGIONE ${season.length}`);
  for (const one of [...coach, ...season]) {
    console.log(`      [${one.kind}] «${one.title}»  segno: ${one.mark ? '⇄' : '(niente)'}`);
  }
  say(coach.every((one) => one.title.startsWith('Cambio in panchina')),
      'ogni confine di panchina dice di chi e il cambio');
  // UN CONFINE DI STAGIONE CHE PORTA ANCHE UN CAMBIO deve dirlo E marcarlo: e' il fatto che prima
  // costava una seconda colonna.
  say(season.every((one) => one.mark === one.title.includes('cambio in panchina')),
      'il confine di stagione porta il segno ⇄ se e solo se dice anche del cambio');
  say(seen.glued === 0, `nessun confine attaccato a un altro (ne ho contati ${seen.glued})`);
  // UN `every` SU UN ELENCO VUOTO E' VERO: senza questa riga il banco passava col difetto rimesso,
  // perche' non trovava nessun confine da guardare. Si pretende di averli guardati TUTTI.
  say(seen.breakCells.length === coach.length + season.length,
      `ho guardato le celle di tutti i confini (${seen.breakCells.length} su ${coach.length + season.length})`);
  say(seen.breakCells.every((one) => one.cls.includes(`is-break-${one.kind}`)),
      `ogni cella di confine porta la classe del SUO confine (${seen.breakCells.map((one) => one.cls).join(' | ') || 'nessuna'})`);
  say(seen.breakCells.every((one) => /rgba\(0, 0, 0, 0\)|transparent/.test(one.bottom)),
      `la linea non e rotta: il bordo di riga di una cella di confine e trasparente `
      + `(${seen.breakCells.map((one) => one.bottom).join(' · ') || 'nessun confine da guardare'})`);
  say(seen.breakCells.every((one) => one.line === 'sfondo'),
      'la linea di un confine e uno SFONDO, che scende intero, e non un bordo interrotto a ogni riga');
  say(unnamed.length === 0,
      `nessuna colonna scrive «???»: ne ho trovate ${unnamed.length}`
      + (unnamed.length ? ' → ' + unnamed.map((one) => one.title).join(' | ') : ''));
  say(upcoming.length === 1, `una sola colonna per la prossima partita (ne ho contate ${upcoming.length})`);
  if (upcoming.length === 1) {
    console.log(`      prossima: «${upcoming[0].title}»`);
    // LA PRIMA fra le colonne di partita, perche' la tabella si legge dalla piu' recente: il futuro
    // sta prima del passato piu' vicino.
    const first = seen.columns.findIndex((one) => one.kind || one.title.includes('Giornata'));
    say(seen.columns[first]?.kind === 'upcoming', 'e la PRIMA colonna di partita');
    const filled = seen.upcomingCells.filter(Boolean);
    say(filled.length === 0,
        `le sue celle sono tutte vuote su ${seen.upcomingCells.length} righe`
        + (filled.length ? ` (ne ho trovate ${filled.length} con dentro «${filled[0]}»)` : ''));
  }
}

console.log(bad === 0 ? '\nL ASSE DELLA STRISCIA E COME DEVE ESSERE' : `\nPROBLEMI: ${bad}`);
browser.kill();
process.exit(bad === 0 ? 0 : 1);
