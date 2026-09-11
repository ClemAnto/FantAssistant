/**
 * IL BALLOTTAGGIO CHE OGGI NON PUO' GIOCARE, sul campetto vero e con un puntatore vero.
 *
 * Richiesta dell'operatore, 11/09/2026: «nelle formazioni Ultimo Periodo sul campetto visualizza i
 * calciatori che secondo l'algoritmo dovrebbero essere in ballottaggio ma sono infortunati». Chi li
 * mette in lista e' il toolkit (`gui.eleven`, in coda e mai al posto di un rivale sano); qui si misura
 * che si VEDANO, che e' l'altra meta' - un controllo puo' esistere nel DOM e non esistere sullo schermo.
 *
 * Serve `dist/`, dove `boards.json` porta la board dell'ultimo periodo scritta da uno `snapshot` vero.
 * Ogni passo dice su quante cose ha guardato. Quello che misura:
 *   - il nome marcato e' DISEGNATO, e il confronto e' col FILE (mai con lo schermo: sarebbe circolare)
 *   - il ✚ risponde alle proprie coordinate (`elementFromPoint`), cioe' non e' coperto ne' fuori cella
 *   - il suo nome ha un colore DIVERSO da quello di un rivale sano della stessa pagina - i token sono
 *     `color-mix` e i temi sono due, quindi l'unica affermazione verificabile e' fra due righe vere
 *   - il nome non e' TAGLIATO: la larghezza del contenuto sta nella sua casella (Range, non `scrollWidth`,
 *     che conta anche gli pseudo-elementi che vivono fuori dalla cella)
 *   - il tooltip si apre con un hover vero e dice la ragione
 *   - sulla board di STAGIONE quel marchio non c'e': la' un infortunato e' un rivale a pieno titolo
 *
 * SALTA, DICENDOLO, se il pacchetto non porta nessun ballottaggio marcato: un «nessun problema» dopo
 * aver guardato niente e' peggio di un rosso.
 *
 * Usage: node scripts/e2e-board-sidelined.mjs
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
/** Lo stesso pavimento che il campetto applica ai ballottaggi (`core/club-eleven.PITCH_CLAIM_FLOOR`). */
const FLOOR = 0.2;
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
/** I nomi che il pavimento lascia passare, marcati e non, di una board di un club. */
const duelsOf = (board, only) => Object.values(board?.lines ?? {}).flat()
  .flatMap((man) => (man.duels ?? []))
  .filter((one) => one.claim == null || one.claim >= FLOOR)
  .filter((one) => (only === 'hurt' ? one.out_today : !one.out_today))
  .map((one) => one.name).filter(Boolean);

const candidates = Object.entries(boards.short?.clubs ?? {})
  .map(([club, board]) => ({ club, hurt: [...new Set(duelsOf(board, 'hurt'))],
    fit: [...new Set(duelsOf(board, 'fit'))] }))
  // Un club che ne ha di tutt'e due i tipi: il confronto dei colori vuole una riga sana sulla stessa
  // pagina, o si finirebbe a confrontare una tinta con un letterale.
  .filter((one) => one.hurt.length && one.fit.length)
  .sort((a, b) => b.hurt.length - a.hurt.length);

if (!candidates.length) {
  // SALTATO, E LO DICE FORTE: questo banco misura un marchio, e il marchio esiste solo se il pacchetto
  // porta un ballottaggio indisponibile. Zero controlli, detto, piu' la strada per rimediare.
  console.log('SALTATO · 0 controlli: il pacchetto non porta nessun ballottaggio marcato `out_today`.');
  console.log('  Rilancia `python -m euroleghe_ingest snapshot --league Leghe` e poi `export`,');
  console.log('  poi `node scripts/pull-bundle.mjs`.');
  process.exit(0);
}
const { club: CLUB, hurt: WANT_HURT, fit: WANT_FIT } = candidates[0];
/** ...e sulla board di STAGIONE dello stesso club il marchio non deve esistere affatto. */
const LONG_HURT = duelsOf(boards.clubs[CLUB], 'hurt');

const binary = BROWSERS.find((o) => existsSync(o));
const profile = await mkdtemp(join(tmpdir(), 'sidelined-'));
const { port } = await serve(DIST);
const browser = spawn(binary, ['--headless=new', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1600,1100',
  `http://127.0.0.1:${port}/clubs?platform=default&club=${encodeURIComponent(CLUB)}`],
{ stdio: 'ignore' });
const s = await attach(await devToolsPort(profile));
await s.send('Runtime.enable');

const problems = [];
/** Ogni nome disegnato sul campetto, col suo colore, la sua casella, il taglio e il ✚ accanto. */
const rows = () => ev(s, () => {
  const out = [];
  for (const place of document.querySelectorAll('ui-club-board [data-place]')) {
    for (const who of place.querySelectorAll('[role="button"], [nz-tooltip] > span')) {
      const label = who.querySelector?.('.truncate');
      if (!label) continue;
      const box = label.getBoundingClientRect();
      // IL TAGLIO SI MISURA SUL CONTENUTO e non con `scrollWidth`, che conta anche gli pseudo-elementi
      // che vivono fuori dalla cella (la ritrattazione del 06/09/2026).
      const range = document.createRange();
      range.selectNodeContents(label);
      const ink = range.getBoundingClientRect();
      range.detach?.();
      // Il ✚ e' il fratello subito dopo il nome, quando c'e'.
      const mark = [...(label.parentElement?.children ?? [])]
        .find((node) => node !== label && node.textContent.trim() === '\u271a');
      const at = mark?.getBoundingClientRect();
      out.push({
        name: label.textContent.trim(),
        colour: getComputedStyle(label).color,
        clipped: Math.round(ink.width - box.width),
        mark: mark ? { x: at.x + at.width / 2, y: at.y + at.height / 2,
          // ...e chi RISPONDE a quelle coordinate: un glifo coperto o fuori cella non e' un glifo.
          hit: !!mark.contains(document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2))
               || document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2) === mark,
          colour: getComputedStyle(mark).color } : null,
      });
    }
  }
  const buttons = [...document.querySelectorAll('nz-radio-group label')].map((l) => {
    const box = l.getBoundingClientRect();
    return { text: l.textContent.trim(), x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  return { out, buttons };
});

let seen = null;
for (let i = 0; i < 200; i += 1) {
  seen = await rows();
  if (seen?.out?.length) break;
  await wait(250);
}

// 1. SULLA BOARD DI STAGIONE IL MARCHIO NON ESISTE: si guarda PRIMA di premere il pulsante.
const longMarks = seen.out.filter((r) => r.mark).map((r) => r.name);
console.log(`· board di STAGIONE: ${seen.out.length} nomi disegnati · marcati ${longMarks.length} `
  + `(il file ne dichiara ${LONG_HURT.length})`);
if (longMarks.length !== LONG_HURT.length) {
  problems.push(`stagione: ${longMarks.length} marchi a schermo contro ${LONG_HURT.length} nel file`);
}

// 2. CLICK VERO su «Ultimo periodo», alle coordinate che il browser dichiara.
const target = seen.buttons.find((b) => b.text.includes('Ultimo periodo'));
if (!target) {
  problems.push('nessun bottone «Ultimo periodo» da premere');
} else {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left',
      clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse' });
  }
  let after = null;
  for (let i = 0; i < 40; i += 1) {
    after = await rows();
    if (after.out.some((r) => r.mark)) break;
    await wait(150);
  }
  const marked = after.out.filter((r) => r.mark);
  const drawn = [...new Set(marked.map((r) => r.name))].sort();
  const wanted = [...WANT_HURT].sort();
  console.log(`· ${CLUB}, ULTIMO PERIODO: ${marked.length} righe marcate · nomi ${JSON.stringify(drawn)}`);
  console.log(`  il file ne dichiara ${JSON.stringify(wanted)} · combaciano: `
    + `${JSON.stringify(drawn) === JSON.stringify(wanted)}`);
  if (JSON.stringify(drawn) !== JSON.stringify(wanted)) {
    problems.push(`disegnati ${JSON.stringify(drawn)} contro il file ${JSON.stringify(wanted)}`);
  }

  // 3. IL GLIFO RISPONDE ALLE PROPRIE COORDINATE, uno per uno.
  const deaf = marked.filter((r) => !r.mark.hit).map((r) => r.name);
  console.log(`· il ✚ risponde alle proprie coordinate su ${marked.length - deaf.length}/${marked.length}`);
  if (deaf.length) problems.push(`✚ coperto o fuori cella su: ${deaf.join(', ')}`);

  // 4. IL COLORE E' DIVERSO DA QUELLO DI UN RIVALE SANO DELLA STESSA PAGINA.
  const healthy = after.out.find((r) => !r.mark && WANT_FIT.includes(r.name));
  const tints = [...new Set(marked.map((r) => r.colour))];
  console.log(`· colore: marcati ${tints.join(' / ')} · un rivale sano (${healthy?.name ?? '—'}) `
    + `${healthy?.colour ?? '—'}`);
  if (!healthy) problems.push('nessun rivale sano a schermo con cui confrontare la tinta');
  else if (tints.some((t) => t === healthy.colour)) {
    problems.push('un nome marcato ha lo stesso colore di un rivale sano');
  }

  // 5. QUANTO COSTA IL GLIFO IN LARGHEZZA, misurato muovendo UNA COSA SOLA sullo stesso DOM: si
  //    nascondono i ✚ e si rimisura. Un elenco di nomi tagliati non attribuisce niente - questa
  //    tabella e' piena di nomi piu' lunghi della loro casella da prima (`truncate` li accorcia coi
  //    puntini, che e' una degradazione dichiarata e visibile). Quello che va saputo e' se il marchio
  //    ne accorcia di NUOVI.
  const cutBefore = after.out.filter((r) => r.clipped > 1).map((r) => r.name);
  await ev(s, () => {
    for (const node of document.querySelectorAll('ui-club-board [data-place] span')) {
      if (node.textContent.trim() === '✚' && !node.children.length) node.hidden = true;
    }
  });
  const without = await rows();
  const cutAfter = without.out.filter((r) => r.clipped > 1).map((r) => r.name);
  await ev(s, () => {
    for (const node of document.querySelectorAll('ui-club-board [data-place] span[hidden]')) {
      node.hidden = false;
    }
  });
  const extra = cutBefore.filter((name) => !cutAfter.includes(name));
  console.log(`· nomi accorciati dai puntini: ${cutBefore.length} col ✚, ${cutAfter.length} senza `
    + `(su ${after.out.length}) · il marchio ne accorcia ${extra.length} di nuovi`
    + `${extra.length ? `: ${[...new Set(extra)].join(', ')}` : ''}`);

  // 6. IL TOOLTIP SI APRE CON UN HOVER VERO e dice la ragione: `[nzTooltipTitle]` e' un binding di
  //    PROPRIETA', quindi nel DOM non c'e' nessun attributo da leggere.
  if (marked.length) {
    const { x, y } = marked[0].mark;
    // ...E SI PARTE DA UNO SCHERMO PULITO, VERIFICATO: il click di prima ha lasciato aperto il tooltip
    // del pulsante, e un tooltip rimasto in giro si legge come quello nuovo - la prima corsa di questo
    // banco ha accusato il ✚ di dire una frase sugli orizzonti.
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, pointerType: 'mouse' });
    for (let i = 0; i < 40; i += 1) {
      if (!await ev(s, () => document.querySelectorAll('.ant-tooltip-inner').length)) break;
      await wait(150);
    }
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
    let said = '';
    for (let i = 0; i < 30; i += 1) {
      said = await ev(s, () => [...document.querySelectorAll('.ant-tooltip-inner')]
        .map((n) => n.textContent.trim()).join(' | '));
      if (said) break;
      await wait(150);
    }
    console.log(`· tooltip del ✚: ${said ? `«${said.slice(0, 70)}…»` : 'NON SI APRE'}`);
    if (!said.includes('non è disponibile')) {
      problems.push(`il tooltip del ✚ non dice la ragione: ${said || '(vuoto)'}`);
    }
  }
}

if (s.noise.length) problems.push(`eccezioni in console: ${s.noise.slice(0, 3).join(' | ')}`);
console.log(problems.length ? `\nPROBLEMI:\n  ${problems.join('\n  ')}` : '\nnessun problema');
browser.kill();
process.exit(problems.length ? 1 : 0);
