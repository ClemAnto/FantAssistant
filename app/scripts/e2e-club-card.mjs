/**
 * LA CARD DI UNA SQUADRA, aperta dal nome del club dentro la card di un calciatore.
 *
 * Richiesta dell'operatore (23/09/2026): «quando si clicca sul nome della squadra all'interno della card
 * dettaglio calciatore fai aprire una nuova card draggabile con il campetto con la formazione tipo della
 * squadra». Nessun test unitario puo' provarla: e' un gesto, un pezzo di schermo e una posizione.
 *
 * COSA MISURA, e ogni passo dice su quante cose ha guardato:
 *   - sulla vista Squadre il nome del club dentro la card e' un BOTTONE, e un click vero apre una card
 *     con `data-club` uguale a quel club;
 *   - il campetto dentro la card disegna ESATTAMENTE gli undici nomi che `boards.json` dichiara per
 *     quel club - uguaglianza e non inclusione, e il confronto e' col FILE e mai con lo schermo, o
 *     sarebbe l'asserzione circolare del 04/09/2026;
 *   - la card NON nasce sopra quella del calciatore da cui e' stata aperta (una card che nasce coperta
 *     si legge come una card sparita) e resta dentro la finestra;
 *   - quanto OCCUPA e cosa costa la stretta: nessun nome largo zero, nessun pezzo di contorno che la
 *     modalita' compatta doveva togliere, NESSUN contenitore che scorre al suo interno, e il conto dei
 *     nomi troncati stampato a ogni corsa;
 *   - la card DICE quale dei due orizzonti sta disegnando, anche dopo che un'altra pagina ha girato
 *     quel segnale, che e' globale;
 *   - si trascina dall'intestazione e si chiude, senza portarsi dietro la card dell'uomo;
 *   - il tasto «chiudi le N card» conta quello che si VEDE: una card la cui riga non c'e' piu' esce da
 *     se', e la pila da sola annuncerebbe card che non ci sono;
 *   - SULLA PLANCIA il link c'e' lo stesso. E' il passo che giustifica una riga di codice: quella pagina
 *     non chiede `ValuationStore`, che e' il negozio che porta le board, quindi senza il `load()` dentro
 *     la card il campetto non si aprirebbe MAI di li' - e una feature che si vede in una vista sola e'
 *     indistinguibile da una feature che non esiste.
 *
 * Uso: node scripts/e2e-club-card.mjs
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
/** Un click VERO alle coordinate che il browser dichiara: `element.click()` passa sopra la CSS. */
async function click(s, x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse' });
  }
}
async function until(probe, ok, tries = 60, every = 200) {
  let seen = null;
  for (let i = 0; i < tries; i += 1) {
    seen = await probe();
    if (ok(seen)) return seen;
    await wait(every);
  }
  return seen;
}

// ---- IL FILE, letto qui: il confronto e' col bundle e mai con lo schermo.
const BOARDS = join(DIST, 'data', 'boards', 'leghe.json');
if (!existsSync(BOARDS)) {
  console.log('SALTATO · 0 controlli: dist/data/boards/leghe.json non esiste.');
  console.log('  Rilancia `npm run data:pull` e `npm run build`.');
  process.exit(0);
}
const boards = JSON.parse(readFileSync(BOARDS, 'utf8'));
const CLUB = 'Genoa';
const wantNames = Object.values(boards.clubs?.[CLUB]?.lines ?? {}).flat()
  .map((m) => m.name).filter(Boolean).sort();
if (wantNames.length !== 11) {
  console.log(`SALTATO · 0 controlli: il file non porta un undici per ${CLUB} (${wantNames.length}).`);
  process.exit(0);
}

const binary = BROWSERS.find((o) => existsSync(o));
const profile = await mkdtemp(join(tmpdir(), 'clubcard-'));
const { port } = await serve(DIST);
const browser = spawn(binary, ['--headless=new', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1600,1100',
  `http://127.0.0.1:${port}/clubs?platform=default&club=${CLUB}`], { stdio: 'ignore' });
const s = await attach(await devToolsPort(profile));
await s.send('Runtime.enable');

const problems = [];

/** Lo stato che interessa, in UNA lettura: due letture separate misurano due fotogrammi diversi. */
const state = () => ev(s, () => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  };
  // IL PRIMO NOME CLICCABILE DEL CAMPETTO DELLA PAGINA: `role="button"` e' come il campetto dichiara
  // di se' che quel nome apre una card, e non un cammino nell'albero.
  const pitchName = document.querySelector('app-clubs ui-club-board [data-place] [role="button"]');
  const card = document.querySelector('ui-player-card [data-player]');
  const link = card ? card.querySelector('[data-club-link]') : null;
  const clubCards = [...document.querySelectorAll('ui-club-card [data-club]')].map((one) => ({
    club: one.getAttribute('data-club'),
    platform: one.getAttribute('data-platform'),
    rect: rect(one),
    // I POSTI del campetto dentro la card: gli stessi agganci del campetto della pagina, perche' il
    // disegno e' lo stesso componente.
    names: [...one.querySelectorAll('[data-place]')]
      .map((place) => (place.querySelector('.truncate')?.textContent ?? '').trim())
      .filter(Boolean),
    handle: rect(one.querySelector('.cursor-move')),
    // QUANTO OCCUPA e quanto costa la stretta: l'altezza della carta e i nomi che si troncano. Un nome
    // troncato e' una degradazione DICHIARATA (i puntini si vedono), non un valore assente - quindi si
    // CONTA e si stampa invece di far cadere il passo su una soglia che nessuno ha misurato.
    clipped: [...one.querySelectorAll('[data-place] .truncate')]
      .filter((n) => n.scrollWidth > n.clientWidth + 1).length,
    names0: [...one.querySelectorAll('[data-place] .truncate')]
      .filter((n) => n.getBoundingClientRect().width < 1).length,
    // NESSUNA BARRA DENTRO LA CARD (operatore, 24/09/2026). Si cercano i CONTENITORI CHE SCORRONO fra
    // TUTTI i discendenti e non solo nel corpo: l'overflow si chiede CALCOLATO, perche' `overflow-y:
    // auto` fa calcolare `auto` anche sull'altro asse e una barra orizzontale puo' comparire per un
    // pixel di troppo senza che nessuno l'abbia scritta. La card intera e' esclusa: e' lei ad avere
    // `overflow-hidden` per arrotondare gli angoli, e quella non e' una barra.
    scrollers: [...one.querySelectorAll('*')]
      .map((node) => {
        const css = getComputedStyle(node);
        const scrolls = (axis) => /auto|scroll/.test(axis);
        if (!scrolls(css.overflowX) && !scrolls(css.overflowY)) return null;
        return {
          tag: node.tagName.toLowerCase(),
          overflow: `${css.overflowX}/${css.overflowY}`,
          // Quanto c'e' davvero da scorrere, e la gronda riservata: una barra che non scorre niente
          // occupa comunque lo spazio.
          x: node.scrollWidth - node.clientWidth,
          y: node.scrollHeight - node.clientHeight,
          gutter: node.offsetWidth - node.clientWidth,
        };
      })
      .filter(Boolean),
    // IL CONTORNO che la modalita' compatta toglie: la riga «Modulo ...» e l'interruttore dei ruoli.
    chrome: [...one.querySelectorAll('p, button')]
      .filter((n) => /^Modulo /.test(n.textContent.trim())
        || ['Mantra', 'Classic'].includes(n.textContent.trim())).length,
    // QUALE LETTURA la card dichiara di stare disegnando: l'orizzonte e' un segnale globale, e
    // un'intestazione che non lo nomina lascia leggere l'undici delle ultime partite come la
    // formazione tipo.
    horizon: (one.querySelector('[data-horizon]')?.textContent ?? '').trim(),
  }));
  const radios = [...document.querySelectorAll('nz-radio-group label')]
    .filter((l) => /Stagione|Ultimo periodo/.test(l.textContent))
    .map((l) => ({ text: l.textContent.trim(), rect: rect(l) }));
  // IL TASTO «CHIUDI LE N CARD» e quante card sono DAVVERO disegnate: sono due numeri che devono
  // stare insieme, e il difetto era che il tasto contava la PILA mentre lo schermo disegna quello
  // che la pagina riesce ancora a risolvere.
  const closeAll = [...document.querySelectorAll('button')]
    .map((b) => b.textContent.trim())
    .find((t) => /^chiudi le \d+ card$/.test(t)) ?? null;
  return {
    radios,
    closeAll,
    drawn: document.querySelectorAll('ui-player-card [data-player]').length,
    pitchName: pitchName ? { text: pitchName.textContent.trim(), rect: rect(pitchName) } : null,
    card: card ? { player: card.getAttribute('data-player'), rect: rect(card) } : null,
    link: link ? { tag: link.tagName, text: link.textContent.trim(), rect: rect(link) } : null,
    clubCards,
  };
});

// 1. una card di calciatore, aperta dal campetto della pagina.
let seen = await until(state, (o) => o && o.pitchName);
if (!seen || !seen.pitchName) {
  problems.push('il campetto della pagina Squadre non ha disegnato nessun nome cliccabile');
} else {
  await click(s, seen.pitchName.rect.cx, seen.pitchName.rect.cy);
  seen = await until(state, (o) => o && o.card && o.link);
}
console.log(`· card di un calciatore aperta: ${!!(seen && seen.card)} · il nome del club e' un `
  + `BOTTONE: ${seen && seen.link ? seen.link.tag === 'BUTTON' : false} `
  + `(${seen && seen.link ? seen.link.text : '—'})`);
if (!seen || !seen.card) problems.push('nessuna card di calciatore aperta');
if (!seen || !seen.link || seen.link.tag !== 'BUTTON') {
  problems.push("il nome del club dentro la card non e' cliccabile");
}

// 2. il click sul club apre la card della squadra.
const playerRect = seen && seen.card ? seen.card.rect : null;
if (seen && seen.link) {
  await click(s, seen.link.rect.cx, seen.link.rect.cy);
  seen = await until(state, (o) => o && o.clubCards.length);
}
const club = seen && seen.clubCards.length ? seen.clubCards[0] : null;
console.log(`· card di squadra aperte: ${seen ? seen.clubCards.length : 0} · club: `
  + `${club ? club.club : '—'} · listone: ${club ? club.platform : '—'}`);
if (!club) problems.push('il click sul nome del club non ha aperto nessuna card');
if (club && club.club !== CLUB) problems.push(`la card mostra ${club.club} e non ${CLUB}`);
if (club && club.platform !== 'default') {
  problems.push(`la card dichiara il listone ${club.platform} invece di default`);
}

// 3. il campetto dentro la card e' quello che il FILE dichiara.
if (club) {
  // UGUAGLIANZA E NON INCLUSIONE: la prima versione intersecava lo schermo col file prima di
  // confrontarli, cioe' asseriva «file incluso nello schermo» - un campetto che disegnasse un
  // dodicesimo posto sarebbe passato stampando «combaciano: true». Si confronta la lista INTERA.
  const drawn = club.names.slice().sort();
  const same = JSON.stringify(drawn) === JSON.stringify(wantNames);
  console.log(`· il campetto della card disegna ${club.names.length} posti · sono ESATTAMENTE gli `
    + `undici di boards.json: ${same}`);
  if (!same) {
    problems.push(`campetto: schermo ${JSON.stringify(drawn)} contro file `
      + `${JSON.stringify(wantNames)}`);
  }
}

// 3-bis. la card DICE quale delle due letture sta disegnando.
if (club) {
  const says = club.horizon.startsWith('Formazione tipo');
  console.log(`· sull'orizzonte di stagione l'intestazione dice: «${club.horizon}»`);
  if (!says) problems.push(`l'intestazione non nomina la lettura di stagione: «${club.horizon}»`);
}

// 3-ter. QUANTO OCCUPA, e cosa costa la stretta (operatore, 24/09/2026: «falla piu' piccolina,
// ottimizza un po' gli spazi e non mostrare quello che non serve»).
if (club) {
  console.log(`· occupa ${club.rect.w}x${club.rect.h}px · nomi troncati ${club.clipped} su 11 · `
    + `nomi larghi zero ${club.names0} · pezzi di contorno rimasti ${club.chrome}`);
  const scrollers = club.scrollers ?? [];
  console.log(`· contenitori che scorrono dentro la card: ${scrollers.length}`
    + (scrollers.length ? ` (${scrollers.map((one) => `${one.tag} ${one.overflow}`).join(', ')})` : ''));
  if (scrollers.length) {
    problems.push(`dentro la card ci sono ${scrollers.length} contenitori che scorrono: `
      + JSON.stringify(scrollers));
  }
  // UN NOME LARGO ZERO E' ASSENTE, e quello non si accetta; uno troncato porta i puntini e si legge.
  if (club.names0) problems.push(`${club.names0} nomi larghi zero: tagliati, non stretti`);
  if (club.chrome) {
    problems.push(`la modalita' compatta lascia ${club.chrome} pezzi di contorno a schermo`);
  }
}

// 4. non nasce SOPRA la card da cui e' stata aperta, e ci sta nella finestra.
if (club && playerRect) {
  const same = club.rect.x === playerRect.x && club.rect.y === playerRect.y;
  const inside = club.rect.x >= 0 && club.rect.x + club.rect.w <= 1600 && club.rect.y >= 0;
  console.log(`· nasce in (${club.rect.x}, ${club.rect.y}), la card dell'uomo e' in `
    + `(${playerRect.x}, ${playerRect.y}) · stesso angolo: ${same} · dentro la finestra: ${inside}`);
  if (same) problems.push('la card di squadra nasce esattamente sopra quella del calciatore');
  if (!inside) problems.push(`la card di squadra esce dalla finestra: ${JSON.stringify(club.rect)}`);
}

// 5. si trascina dall'intestazione.
if (club && club.handle) {
  const from = club.handle;
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.cx, y: from.cy,
    button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse' });
  for (let step = 1; step <= 6; step += 1) {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.cx + step * 20,
      y: from.cy + step * 8, button: 'left', buttons: 1, pointerType: 'mouse' });
  }
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.cx + 120,
    y: from.cy + 48, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse' });
  const moved = await until(state, (o) => {
    const now = o && o.clubCards.length ? o.clubCards[0].rect : null;
    return now && (now.x !== club.rect.x || now.y !== club.rect.y);
  }, 20, 150);
  const now = moved && moved.clubCards.length ? moved.clubCards[0].rect : null;
  console.log(`· trascinata: da (${club.rect.x}, ${club.rect.y}) a `
    + `(${now ? now.x : '?'}, ${now ? now.y : '?'})`);
  if (!now || (now.x === club.rect.x && now.y === club.rect.y)) {
    problems.push('la card di squadra non si trascina');
  }
}

// 6. si chiude, e chiudendola non si porta dietro quella del calciatore.
{
  const closer = await ev(s, () => {
    const card = document.querySelector('ui-club-card [data-club]');
    const button = card ? card.querySelector('button[aria-label="chiudi"]') : null;
    if (!button) return null;
    const r = button.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (!closer) problems.push('la card di squadra non ha un tasto di chiusura');
  else {
    await click(s, closer.cx, closer.cy);
    const after = await until(state, (o) => o && o.clubCards.length === 0, 20, 150);
    console.log(`· chiusa: restano ${after ? after.clubCards.length : '?'} card di squadra e `
      + `${after && after.card ? 1 : 0} di calciatore`);
    if (!after || after.clubCards.length) problems.push('la card di squadra non si chiude');
    if (after && !after.card) {
      problems.push('chiudere la card di squadra ha chiuso anche quella del calciatore');
    }
  }
}

// 6-bis. L'ORIZZONTE E' GLOBALE: girato sulla pagina, la card lo deve DIRE.
{
  const now = await state();
  const short = (now?.radios ?? []).find((r) => r.text.includes('Ultimo periodo'));
  const season = (now?.radios ?? []).find((r) => r.text.includes('Stagione'));
  if (!short || !season) {
    // SALTATO E LO DICE: senza la board dell'ultimo periodo nel pacchetto il pulsante non esiste, e
    // un «nessun problema» dopo aver guardato niente e' peggio di un rosso.
    console.log("· orizzonte: SALTATO, il pacchetto non porta la board dell'ultimo periodo");
  } else {
    await click(s, short.rect.cx, short.rect.cy);
    const link = await until(state, (o) => o?.link?.tag === 'BUTTON', 40, 200);
    if (link?.link) await click(s, link.link.rect.cx, link.link.rect.cy);
    const opened = await until(state, (o) => o?.clubCards?.length, 40, 200);
    const one = opened?.clubCards?.[0] ?? null;
    console.log(`· girato l'orizzonte, l'intestazione dice: «${one?.horizon ?? '—'}»`);
    if (!one) problems.push("sull'ultimo periodo la card di squadra non si apre");
    else if (!one.horizon.startsWith('Ultimo periodo')) {
      problems.push(`la card disegna l'ultimo periodo e l'intestazione dice «${one.horizon}»`);
    }
    // Si rimette com'era: l'orizzonte e' un segnale globale e il passo dopo cambia pagina.
    const closer = await ev(s, () => {
      const card = document.querySelector('ui-club-card [data-club]');
      const button = card ? card.querySelector('button[aria-label="chiudi"]') : null;
      if (!button) return null;
      const r = button.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
    if (closer) await click(s, closer.cx, closer.cy);
    await click(s, season.rect.cx, season.rect.cy);
  }
}

// 6-ter. IL TASTO CONTA QUELLO CHE SI VEDE, non quello che la pila si ricorda.
{
  const more = await ev(s, () => {
    const names = [...document.querySelectorAll('app-clubs ui-club-board [data-place] [role="button"]')];
    const other = names[3] ?? names[1] ?? null;
    if (!other) return null;
    const r = other.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  if (more) await click(s, more.cx, more.cy);
  let now = await until(state, (o) => o?.drawn >= 2, 30, 200);
  console.log(`· due card aperte: il tasto dice «${now?.closeAll ?? '—'}» su ${now?.drawn} disegnate`);
  if (now?.closeAll !== `chiudi le ${now?.drawn} card`) {
    problems.push(`il tasto dice «${now?.closeAll}» e le card disegnate sono ${now?.drawn}`);
  }
  // ...e cambiando club le card di quel club ESCONO da se': il tasto deve sparire con loro, o
  // annuncerebbe due card sopra uno schermo che non ne ha nessuna.
  // IL BERSAGLIO DEV'ESSERE RAGGIUNGIBILE: le card sono `fixed` in alto a sinistra e coprono la parte
  // sinistra della striscia, quindi un click alle coordinate di un bottone coperto finisce SULLA CARD -
  // e il passo accuserebbe la pagina del proprio difetto. Si chiede al browser chi c'e' davvero sotto
  // quel punto (`elementFromPoint`) invece di fidarsi del rettangolo.
  const another = await ev(s, (club) => {
    for (const button of document.querySelectorAll('button[title]')) {
      if (!button.title.includes(' · ') || button.title.startsWith(club)) continue;
      const r = button.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      if (!button.contains(document.elementFromPoint(cx, cy))) continue;
      return { name: button.title.split(' · ')[0], cx, cy };
    }
    return null;
  }, CLUB);
  if (!another) problems.push("nessun altro club della striscia e' raggiungibile dal puntatore");
  else {
    await click(s, another.cx, another.cy);
    // DUE INCOGNITE IN UN PASSO SOLO ATTRIBUISCONO IL DIFETTO A QUELLA SBAGLIATA: prima si verifica che
    // il club sia DAVVERO cambiato, poi si guarda il tasto.
    const switched = await until(
      () => ev(s, () => {
        const on = [...document.querySelectorAll('button[title][aria-pressed="true"]')]
          .map((b) => b.title.split(' · ')[0]);
        return on[0] ?? null;
      }),
      (who) => who === another.name, 30, 200,
    );
    now = await until(state, (o) => o?.drawn === 0, 30, 200);
    console.log(`· passato a ${switched ?? '???'}: ${now?.drawn} card disegnate · il tasto dice `
      + `«${now?.closeAll ?? 'niente'}»`);
    if (switched !== another.name) {
      problems.push(`il click sulla striscia non ha cambiato club: acceso ${switched}`);
    } else {
      if (now?.drawn !== 0) problems.push(`cambiando club restano ${now?.drawn} card disegnate`);
      if (now?.closeAll) {
        problems.push(`il tasto annuncia «${now.closeAll}» sopra uno schermo senza card`);
      }
    }
  }
}

// 7. LA PLANCIA, che e' il passo per cui il `load()` dentro la card esiste.
{
  await ev(s, (url) => { window.location.href = url; }, `http://127.0.0.1:${port}/plancia`);
  const row = await until(() => ev(s, () => {
    const one = document.querySelector('[data-block] button .truncate');
    if (!one) return null;
    const r = one.getBoundingClientRect();
    return { text: one.textContent.trim(), cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }), (o) => o && o.text, 80, 250);
  if (!row) problems.push('la plancia non ha disegnato nessuna riga');
  else {
    await click(s, row.cx, row.cy);
    const opened = await until(state, (o) => o && o.card && o.link && o.link.tag === 'BUTTON',
      80, 250);
    const isButton = !!(opened && opened.link && opened.link.tag === 'BUTTON');
    console.log(`· PLANCIA: card di ${row.text} · il nome del club e' un bottone: ${isButton} `
      + `(${opened && opened.link ? opened.link.text : '—'})`);
    if (!isButton) {
      problems.push("sulla plancia: il nome del club non apre niente, ValuationStore non e' arrivato");
    } else {
      await click(s, opened.link.rect.cx, opened.link.rect.cy);
      const drawn = await until(state, (o) => o && o.clubCards.length, 40, 200);
      const one = drawn && drawn.clubCards.length ? drawn.clubCards[0] : null;
      console.log(`· PLANCIA: card di squadra aperta su ${one ? one.club : '—'} · posti disegnati: `
        + `${one ? one.names.length : 0}`);
      if (!one) problems.push('sulla plancia il click sul club non apre la card');
      else if (one.club !== opened.link.text) {
        problems.push(`sulla plancia la card mostra ${one.club} e la riga diceva `
          + `${opened.link.text}`);
      } else if (!one.names.length) {
        problems.push(`sulla plancia la card di ${one.club} non disegna nessun posto`);
      }
    }
  }
}

if (s.noise.length) problems.push(`eccezioni in console: ${s.noise.slice(0, 3).join(' | ')}`);
console.log(problems.length ? `\nPROBLEMI:\n  ${problems.join('\n  ')}` : '\nnessun problema');
browser.kill();
process.exit(problems.length ? 1 : 0);
