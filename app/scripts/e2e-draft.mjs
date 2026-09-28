/**
 * e2e-draft.mjs - guida il DRAFT ASSISTANT vero (`/auction`) e misura le promesse della richiesta del
 * 28/09/2026, una per passo, ciascuno dicendo su quante cose ha guardato (un audit rotto risponde «zero
 * problemi» ed e' indistinguibile da una pagina pulita):
 *
 *   1. UNA SCHERMATA SENZA SCROLL, in tre colonne nell'ordine campetto · ordine · svincolati.
 *   2. IL TAVOLO VIENE DALLE IMPOSTAZIONI DI LEGA ED E' VUOTO: tante squadre quante la lega di default
 *      ne dichiara, nessuna scelta, undici posti tutti vuoti.
 *   3. IL DOPPIO CLICK FA SCEGLIERE LA SQUADRA DI TURNO, con un puntatore VERO (`clickCount` 2): il nome
 *      esce dalla lista, il turno passa, la rosa di chi ha scelto cresce di uno.
 *   4. IL CAMPETTO DISEGNA TUTTA LA ROSA: titolari + riserve + senza posto = uomini in rosa.
 *   5. LA RICERCA E IL FILTRO PER RUOLO (in OR) tengono solo chi risponde.
 *   6. «MEDIE» cambia le colonne.
 *   7. NESSUNA ECCEZIONE in console.
 *
 * Gli agganci sono gli attributi `data-*` che la pagina DICHIARA, mai il cammino nell'albero.
 *
 * Usage: node scripts/e2e-draft.mjs [--headed] [--shot PATH]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

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
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

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

async function devToolsPort(profile) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const line = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0];
      if (line.trim()) return Number(line.trim());
    } catch {
      /* the browser has not written it yet */
    }
    await wait(250);
  }
  throw new Error('the browser never wrote DevToolsActivePort');
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
  /* Quello che la pagina URLA, raccolto invece che ignorato: «non si apre» ha quasi sempre
     un'eccezione dietro, e senza questa lista si finisce a indovinare il meccanismo. */
  const noise = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params?.exceptionDetails;
      noise.push(`ECCEZIONE: ${detail?.exception?.description ?? detail?.text ?? '?'}`.slice(0, 200));
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      noise.push(`CONSOLE: ${message.params.args.map((one) => one.description ?? one.value).join(' ')}`
        .slice(0, 200));
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

// ------------------------------------------------------------------ what runs IN the page

function readPage() {
  const doc = document.documentElement;
  const columns = [...document.querySelectorAll('[data-column]')].map((one) => {
    const rect = one.getBoundingClientRect();
    return { name: one.getAttribute('data-column'), left: Math.round(rect.left), width: Math.round(rect.width) };
  });
  const list = document.querySelector('[data-free-list]');
  const places = [...document.querySelectorAll('[data-place]')];
  const pitch = document.querySelector('[data-column="pitch"]');
  const clock = document.querySelector('[data-seat][data-clock]');
  const first = document.querySelector('[data-free]');
  const firstRect = first?.getBoundingClientRect();
  return {
    ready: !!first && places.length > 0,
    scrolls: doc.scrollHeight > doc.clientHeight + 1,
    overflow: doc.scrollHeight - doc.clientHeight,
    columns,
    rows: document.querySelectorAll('[data-free]').length,
    listScrolls: !!list && list.scrollHeight > list.clientHeight + 1,
    seats: document.querySelectorAll('[data-seat]').length,
    onClock: clock?.getAttribute('data-seat') ?? null,
    places: places.length,
    filled: places.filter((one) => one.hasAttribute('data-filled')).length,
    reserves: document.querySelectorAll('[data-reserve]').length,
    unplaced: document.querySelectorAll('[data-unplaced]').length,
    squadSize: Number(pitch?.getAttribute('data-squad') ?? NaN),
    first: first
      ? {
          x: Math.round(firstRect.left + firstRect.width / 2),
          y: Math.round(firstRect.top + firstRect.height / 2),
          id: first.getAttribute('data-free'),
          text: (first.innerText ?? '').replace(/\s+/g, ' ').trim(),
        }
      : null,
    header: (document.querySelector('[data-free-head]')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
  };
}

function freeIds() {
  return [...document.querySelectorAll('[data-free]')].map((one) => one.getAttribute('data-free'));
}

function freeTexts() {
  // The club is not a printed column any more (a crest stands for it): the row declares it instead.
  return [...document.querySelectorAll('[data-free]')].map((one) =>
    `${(one.innerText ?? '').replace(/\s+/g, ' ').trim()} ${one.getAttribute('data-club') ?? ''}`);
}

/** The open player cards, by the name they print in their title. */
function cardTitles() {
  return [...document.querySelectorAll('ui-player-card')].map((one) => (one.innerText ?? '').split('\n')[0].trim());
}

function nameTarget(selector) {
  const one = document.querySelector(selector);
  if (!one) return null;
  const rect = one.getBoundingClientRect();
  return { x: Math.round(rect.left + Math.min(12, rect.width / 2)), y: Math.round(rect.top + rect.height / 2), text: (one.innerText ?? '').trim() };
}

function freeRoles() {
  return [...document.querySelectorAll('[data-free]')].map((one) =>
    (one.getAttribute('data-roles') ?? '').split(',').filter(Boolean));
}

function centre(selector) {
  const one = document.querySelector(selector);
  if (!one) return null;
  const rect = one.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}


/** The numbers of one column of the loaded rows, read at the cell index the header declares. */
function columnOf(sort) {
  const head = document.querySelector('[data-free-head]');
  const at = [...(head?.children ?? [])].findIndex((one) => one.getAttribute('data-sort') === sort);
  if (at < 0) return null;
  return [...document.querySelectorAll('[data-free]')].map((row) => {
    const text = (row.children[at]?.innerText ?? '').trim();
    const value = Number(text.replace(',', '.'));
    return text === '' || text === '—' || !Number.isFinite(value) ? null : value;
  });
}

function ordered(values, descending) {
  const known = values.filter((one) => one != null);
  const tail = values.slice(values.findIndex((one) => one == null) < 0 ? values.length : values.findIndex((one) => one == null));
  const sorted = known.every((one, at) => at === 0 || (descending ? known[at - 1] >= one : known[at - 1] <= one));
  return sorted && tail.every((one) => one == null);
}


/** Where every seat of the call order stands, and whether one is sliding right now. */
function seatsNow() {
  return [...document.querySelectorAll('[data-seat]')].map((one) => {
    const rect = one.getBoundingClientRect();
    return {
      id: one.getAttribute('data-seat'),
      at: Number(one.getAttribute('data-at')),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      sliding: one.getAnimations().some((animation) => animation.playState === 'running'),
      clipped: one.scrollHeight > one.clientHeight + 1,
    };
  });
}


/** The turn lines of the call order against the seats they separate. */
function roundLinesNow() {
  const seats = [...document.querySelectorAll('[data-seat]')].map((one) => {
    const rect = one.getBoundingClientRect();
    return { at: Number(one.getAttribute('data-at')), top: rect.top, bottom: rect.bottom, picks: Number(one.getAttribute('data-picks')) };
  }).sort((a, b) => a.at - b.at);
  const lines = [...document.querySelectorAll('[data-round-line]')].map((one) => ({
    y: one.getBoundingClientRect().top,
    label: (one.innerText ?? '').trim(),
  }));
  const boundaries = seats.filter((one, at) => at > 0 && one.picks !== seats[at - 1].picks).length;
  const misplaced = lines.filter((line) => {
    const below = seats.find((one) => one.top >= line.y - 1);
    const above = [...seats].reverse().find((one) => one.bottom <= line.y + 1);
    return !below || !above || below.picks === above.picks || line.label !== `turno ${below.picks + 1}`;
  }).length;
  // THE NUMBER IS THE PLACE IN ITS TURN: below a line it restarts from 1°, and the seat just above a line
  // is the last of its turn, i.e. the table's size.
  const numbers = [...document.querySelectorAll('[data-seat]')].map((one) => ({
    at: Number(one.getAttribute('data-at')),
    shown: Number((one.querySelector('[data-turn-at]')?.innerText ?? '').replace('°', '')),
    picks: Number(one.getAttribute('data-picks')),
  })).sort((a, b) => a.at - b.at);
  const size = numbers.length;
  const wrongNumbers = numbers.filter((one, at) => {
    const nextBoundary = numbers.findIndex((other, k) => k > at && other.picks !== one.picks);
    const prevBoundary = [...numbers.keys()].filter((k) => k <= at && (k === 0 || numbers[k - 1].picks !== numbers[k].picks)).pop();
    const expected = prevBoundary === 0 && nextBoundary >= 0 ? size - (nextBoundary - at) + 1 : at - prevBoundary + 1;
    return one.shown !== expected;
  }).map((one) => `${one.at}:${one.shown}`);
  return { lines: lines.length, boundaries, misplaced, labels: lines.map((one) => one.label), wrongNumbers, shown: numbers.map((one) => one.shown) };
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');
  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-draft-'));
  const base = `http://127.0.0.1:${port}`;
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1000', `${base}/auction`,
  ], { stdio: 'ignore' });

  const problems = [];
  const note = (step, said, found = []) => {
    console.log(`· ${step}: ${said}`);
    for (const one of found) console.log(`    ! ${one}`);
    problems.push(...found.map((one) => `${step}: ${one}`));
  };

  let session;
  try {
    session = await attach(await devToolsPort(profile));
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    // --euro: the operator's own draft league (EuroLeghe, mantra, 12 squads, 2 porte + 30 of movement).
    const euro = flag('--euro');
    if (euro) {
      await wait(1500);
      await evaluate(session, () => localStorage.setItem('fantassistant.options.league', JSON.stringify({
        platform: 'euro', game: 'mantra', auction: 'draft', teams: 12, porte: true,
        slots: { mantra: { por: 2, mov: 30 } },
        // A ceiling that is NOT the default one, so the page can only show it by reading the settings.
        draftCap: { on: true, fvm: 300, frozenTurns: 3 },
      })));
      await session.send('Page.reload');
      await wait(1500);
    }
    const mouse = async (where, clickCount = 1) => {
      if (!where) throw new Error('nothing to click: the target is not on the page');
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: where.x, y: where.y, pointerType: 'mouse' });
      for (let n = 1; n <= clickCount; n += 1) {
        for (const type of ['mousePressed', 'mouseReleased']) {
          await session.send('Input.dispatchMouseEvent', {
            type, x: where.x, y: where.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: n, pointerType: 'mouse',
          });
        }
      }
    };
    const settle = async (test, what) => {
      let page = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        page = await evaluate(session, readPage);
        if (page?.ready && test(page)) return page;
        await wait(250);
      }
      throw new Error(`never settled: ${what} (last: ${JSON.stringify(page).slice(0, 300)})`);
    };

    // 1-2. The table of the declared league (the default one: 10 squads, classic), empty.
    let page = await settle(() => true, 'first render');
    const order = page.columns.map((one) => one.name).join(' · ');
    note('una schermata', `scroll di pagina ${page.overflow}px, colonne ${order}, larghezze ${page.columns.map((c) => c.width).join('/')}`,
      [
        ...(page.scrolls ? [`la pagina scorre di ${page.overflow}px`] : []),
        ...(order !== 'pitch · order · free' ? [`ordine delle colonne ${order}`] : []),
        ...(page.columns.some((c) => c.width < 250) ? ['una colonna sotto i 250px'] : []),
        ...(!page.listScrolls ? ['la lista degli svincolati non scorre'] : []),
      ]);
    note('tavolo dalla lega', `${page.seats} squadre, posti ${page.places}, pieni ${page.filled}, rosa ${page.squadSize}`,
      [
        ...(page.seats !== (euro ? 12 : 10) ? [`${page.seats} squadre invece delle ${euro ? 12 : 10} dichiarate`] : []),
        ...(page.places !== 11 ? [`${page.places} posti invece di 11`] : []),
        ...(page.filled ? [`${page.filled} posti gia' pieni su un tavolo vuoto`] : []),
        ...(page.squadSize !== 0 ? [`rosa di ${page.squadSize} su un tavolo vuoto`] : []),
      ]);

    // 2b. The ceiling of the first turns, as the league declares it: said on screen, and a blocked top
    // cannot be taken with a double click.
    if (euro) {
      const cap = await evaluate(session, () => document.querySelector('[data-cap]')?.innerText ?? '');
      // VISIBLE IN THEIR PLACE (operator, 29/09/2026): among the first rows loaded, dimmed, with the badge
      // saying how many of our turns are left - three, on an empty squad with a three-turn block.
      const shown = await evaluate(session, () => [...document.querySelectorAll('[data-free][data-locked]')].map((one) => ({
        badge: (one.querySelector('[data-lock]')?.innerText ?? '').trim(),
        icon: !!one.querySelector('[data-lock] svg'),
        opacity: Number(getComputedStyle(one).opacity),
      })));
      // Blocked men sort to the BOTTOM of a list that loads sixty rows at a time: find one by name.
      await mouse(await evaluate(session, centre, '[data-column="free"] input[type="search"]'));
      await session.send('Input.insertText', { text: 'kane' });
      await wait(700);
      const locked = await evaluate(session, () => [...document.querySelectorAll('[data-free][data-locked]')]
        .map((one) => Number(one.getAttribute('data-fvm'))));
      const target = await evaluate(session, () => {
        const one = document.querySelector('[data-free][data-locked]');
        if (!one) return null;
        one.scrollIntoView({ block: 'center' });
        const rect = one.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), id: one.getAttribute('data-free') };
      });
      if (target) {
        await mouse(target, 2);
        await wait(700);
      }
      const still = target ? (await evaluate(session, freeIds)).includes(target.id) : false;
      const after = await evaluate(session, readPage);
      note('top bloccati', `riga «${cap}», ${shown.length} bloccati fra le prime righe (badge ${shown[0]?.badge ?? '-'}), cercando «kane» FVM min ${Math.min(...locked)}`,
        [
          ...(!/300/.test(cap) || !/3 turni/.test(cap) ? [`la riga non dice il tetto dichiarato (300, 3 turni): «${cap}»`] : []),
          ...(!shown.length ? ['nessun bloccato fra le prime righe: sono finiti in fondo alla lista'] : []),
          ...(shown.some((one) => one.badge !== '3') ? [`badge dei turni: ${[...new Set(shown.map((one) => one.badge))].join(', ')} invece di 3`] : []),
          ...(shown.some((one) => !one.icon) ? ['badge senza lucchetto'] : []),
          ...(shown.some((one) => Math.abs(one.opacity - 0.5) > 0.01) ? ['un bloccato non e\' al 50% di opacita\''] : []),
          ...(!target ? ['nessun top bloccato fra le righe caricate'] : []),
          ...(locked.some((fvm) => fvm < 300) ? ['un bloccato sotto la soglia'] : []),
          ...(target && (!still || after.squadSize !== 0) ? ["un top bloccato e' stato preso col doppio click"] : []),
        ]);
      await mouse(await evaluate(session, centre, '[data-column="free"] .ant-input-clear-icon'));
      await wait(700);
      page = await evaluate(session, readPage);
    }

    // 3. Double click: the squad on the clock takes the first free man.
    const before = page;
    const seatsBefore = await evaluate(session, seatsNow);
    await mouse(before.first, 2);
    // Read while the move is still flying: the squad that chose drops to the bottom of the order.
    await wait(120);
    const flying = await evaluate(session, seatsNow);
    page = await settle((p) => p.first?.id !== before.first.id, 'the pick');
    await wait(700);
    const landed = await evaluate(session, seatsNow);
    const byAt = [...landed].sort((a, b) => a.at - b.at);
    const overlap = byAt.some((one, at) => at > 0 && one.top < byAt[at - 1].bottom);
    const outOfOrder = byAt.some((one, at) => at > 0 && one.top <= byAt[at - 1].top);
    const moved = landed.filter((one) => seatsBefore.find((old) => old.id === one.id)?.at !== one.at).length;
    note('ordine animato', `${moved} squadre cambiano posto, ${flying.filter((one) => one.sliding).length} in volo a 120ms, ferme dopo: ${landed.filter((one) => one.sliding).length}`,
      [
        ...(!moved ? ['nessuna squadra ha cambiato posto'] : []),
        ...(moved && !flying.some((one) => one.sliding) ? ['il cambio di posto non e\' animato'] : []),
        ...(landed.some((one) => one.sliding) ? ['una riga e\' ancora in volo dopo 700ms'] : []),
        ...(outOfOrder ? ['a schermo le righe non seguono l\'ordine di chiamata'] : []),
        ...(overlap ? ['due righe si sovrappongono'] : []),
        ...(landed.some((one) => one.clipped) ? ['una riga taglia il suo contenuto'] : []),
      ]);
    const ids = await evaluate(session, freeIds);
    note('doppio click', `preso «${before.first.text.slice(0, 40)}», di turno prima ${before.onClock} ora ${page.onClock}, rosa ${page.squadSize}`,
      [
        ...(ids.includes(before.first.id) ? ['il preso e\' ancora fra gli svincolati'] : []),
        ...(page.onClock === before.onClock ? ['il turno non e\' passato'] : []),
        ...(page.squadSize !== 1 ? [`la rosa di chi ha scelto (la mia) conta ${page.squadSize} invece di 1`] : []),
        ...(page.filled !== 1 ? [`il campetto porta ${page.filled} titolari invece di 1`] : []),
      ]);

    // 3b. AUTO: switched on after my pick, the rivals take their predicted men by themselves, one every
    // 500ms, and the table stops when it is my turn again; then it is switched off.
    const picksOf = () => evaluate(session, () =>
      [...document.querySelectorAll('[data-seat]')].reduce((sum, one) => sum + Number(one.getAttribute('data-picks')), 0));
    const mine = await evaluate(session, () => document.querySelector('[data-column="pitch"]')?.getAttribute('data-team'));
    const mySquad = () => evaluate(session, () => Number(document.querySelector('[data-column="pitch"]')?.getAttribute('data-squad')));
    const squadFrom = await mySquad();
    const autoFrom = await picksOf();
    const autoStart = Date.now();
    await mouse(await evaluate(session, centre, '[data-auto]'));
    let autoClock = null;
    for (let tick = 0; tick < 80; tick += 1) {
      await wait(250);
      autoClock = (await evaluate(session, readPage)).onClock;
      if (autoClock === mine) break;
    }
    const autoMs = Date.now() - autoStart;
    await wait(900);
    const autoTo = await picksOf();
    const squadTo = await mySquad();
    const stayed = (await evaluate(session, readPage)).onClock;
    await mouse(await evaluate(session, centre, '[data-auto]'));
    await wait(300);
    const seatsTotal = (await evaluate(session, readPage)).seats;
    note('AUTO', `${autoTo - autoFrom} scelte automatiche in ${autoMs}ms, poi di turno ${stayed} (io ${mine})`,
      [
        ...(autoClock !== mine ? ['AUTO non riporta il turno a me'] : []),
        // How MANY rivals call before me again is the order's business (after a dear pick I can be last of
        // the next turn, i.e. two turns of rivals): what AUTO owes is that none of them was mine.
        ...(autoTo - autoFrom < seatsTotal - 1 ? [`solo ${autoTo - autoFrom} scelte automatiche prima del mio turno`] : []),
        ...(squadTo !== squadFrom || stayed !== mine ? ['AUTO ha scelto anche per me'] : []),
        ...(autoMs < (autoTo - autoFrom) * 450 ? ['le scelte automatiche non aspettano i 500ms'] : []),
      ]);

    // 4. Forty more picks, then the pitch must draw the whole squad, and the page must still not scroll.
    const rowAt = (index) => {
      const one = document.querySelectorAll('[data-free]')[index];
      if (!one) return null;
      one.scrollIntoView({ block: 'nearest' });
      const rect = one.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), id: one.getAttribute('data-free') };
    };
    let refused = 0;
    for (let n = 0; n < 40; n += 1) {
      const clock = (await evaluate(session, readPage)).onClock;
      for (let index = 0; index < 20; index += 1) {
        const target = await evaluate(session, rowAt, index);
        await mouse(target, 2);
        await wait(250);
        if ((await evaluate(session, readPage)).onClock !== clock) break;
        refused += 1;
      }
    }
    console.log(`    (scelte rifiutate dal regolamento e ritentate sulla riga dopo: ${refused})`);
    await wait(500);
    const stray = (await evaluate(session, cardTitles)).length;
    if (stray) note('doppio click e card', `${stray} card aperte`, [`${stray} card aperte da doppi click che dovevano solo scegliere`]);
    await evaluate(session, () => document.querySelector('[data-free-list]')?.scrollTo(0, 0));
    page = await evaluate(session, readPage);
    const drawn = page.filled + page.reserves + page.unplaced;
    note('campetto', `rosa ${page.squadSize}: titolari ${page.filled} + riserve ${page.reserves} + senza posto ${page.unplaced}; scroll ${page.overflow}px`,
      [
        ...(drawn !== page.squadSize ? [`il campetto disegna ${drawn} uomini su ${page.squadSize}`] : []),
        ...(page.squadSize < 3 ? ['la mia rosa non e\' cresciuta'] : []),
        ...(page.scrolls ? [`dopo le scelte la pagina scorre di ${page.overflow}px`] : []),
      ]);

    // 4-bis. THE SUGGESTIONS on my pitch: a starter for every empty place and a reserve where there is none,
    // at 30% opacity, all of them men still free - and a pick must not get slow because of them.
    const ghosts = await evaluate(session, () => {
      const free = new Set([...document.querySelectorAll('[data-free]')].map((one) => one.getAttribute('data-free')));
      const places = [...document.querySelectorAll('[data-column="pitch"] [data-place]')];
      const empty = places.filter((one) => !one.hasAttribute('data-filled')).length;
      const starters = [...document.querySelectorAll('[data-column="pitch"] [data-suggested]')];
      const reserves = [...document.querySelectorAll('[data-column="pitch"] [data-suggested-reserve]')];
      const names = [...starters, ...reserves].map((one) => (one.querySelector('[data-card-name]')?.innerText ?? '').trim());
      return {
        empty,
        starters: starters.length,
        reserves: reserves.length,
        opacity: [...new Set([...starters, ...reserves].map((one) => getComputedStyle(one).opacity))],
        duplicates: names.length - new Set(names).size,
        freeKnown: free.size,
      };
    });
    const clockBefore = (await evaluate(session, readPage)).onClock;
    let pickMs = null;
    for (let index = 0; index < 20 && pickMs === null; index += 1) {
      const target = await evaluate(session, rowAt, index);
      const started = Date.now();
      await mouse(target, 2);
      for (let tick = 0; tick < 40; tick += 1) {
        if ((await evaluate(session, readPage)).onClock !== clockBefore) {
          pickMs = Date.now() - started;
          break;
        }
        await wait(25);
        if (tick === 12 && (await evaluate(session, readPage)).onClock === clockBefore) break;
      }
    }
    await wait(700);   // the seats and the turn line slide for 450ms: measure them where they land
    note('suggerimenti', `${ghosts.starters} titolari suggeriti su ${ghosts.empty} posti vuoti, ${ghosts.reserves} riserve, `
      + `opacita' ${ghosts.opacity.join('/')}, una scelta in ${pickMs}ms`,
      [
        ...(ghosts.empty && !ghosts.starters ? ['nessun titolare suggerito sui posti vuoti'] : []),
        ...(ghosts.starters > ghosts.empty ? ['piu\' titolari suggeriti che posti vuoti'] : []),
        ...(!ghosts.reserves ? ['nessuna riserva suggerita'] : []),
        ...(ghosts.opacity.some((one) => Math.abs(Number(one) - 0.3) > 0.01) ? ['un suggerimento non e\' al 30%'] : []),
        ...(ghosts.duplicates ? [`${ghosts.duplicates} nomi suggeriti due volte`] : []),
        ...(pickMs > 2500 ? [`una scelta impiega ${pickMs}ms`] : []),
      ]);

    // 4a'. A dashed line where one turn ends and the next begins, counted on the picks already made.
    const rounds = await evaluate(session, roundLinesNow);
    note('linea fra i turni', `${rounds.lines} linee per ${rounds.boundaries} confini (${rounds.labels.join(', ')}), numeri ${rounds.shown.join(' ')}`,
      [
        ...(rounds.lines !== rounds.boundaries ? [`${rounds.lines} linee invece di ${rounds.boundaries}`] : []),

        ...(rounds.misplaced ? [`${rounds.misplaced} linee fuori posto o con l'etichetta sbagliata`] : []),
        ...(rounds.wrongNumbers.length ? [`numeri di turno sbagliati: ${rounds.wrongNumbers.join(', ')} (a schermo ${rounds.shown.join(' ')})`] : []),
      ]);

    // 4a. The titolarità badge next to every man of the pitch that has one, whole and in its colour.
    const pitchRungs = await evaluate(session, () => {
      const badges = [...document.querySelectorAll('[data-column="pitch"] [data-pitch-rung]')];
      const names = document.querySelectorAll('[data-column="pitch"] [data-place] [data-card-name]').length;
      return {
        names,
        badges: badges.length,
        words: [...new Set(badges.map((one) => one.innerText.trim()))],
        clipped: badges.filter((one) => one.scrollWidth > one.clientWidth + 1).length,
      };
    });
    note('titolarita sul campetto', `${pitchRungs.badges} badge su ${pitchRungs.names} nomi: ${pitchRungs.words.join(', ')}`,
      [
        ...(pitchRungs.names && !pitchRungs.badges ? ['nessun badge accanto ai calciatori del campetto'] : []),
        ...(pitchRungs.badges > pitchRungs.names ? ['piu\' badge che nomi'] : []),
        ...(pitchRungs.clipped ? [`${pitchRungs.clipped} badge tagliati`] : []),
      ]);

    // 4b. Hovering another squad shows its roster's FVM minus the selected one's; the selected squad shows none.
    const seatInfo = (id) => {
      const one = document.querySelector(`[data-seat="${id}"]`);
      if (!one) return null;
      const rect = one.getBoundingClientRect();
      const delta = one.querySelector('[data-fvm-delta]');
      return {
        x: Math.round(rect.left + rect.width * 0.3), y: Math.round(rect.top + rect.height / 2),
        spent: Number(one.querySelector('[data-seat-fvm]')?.innerText ?? NaN),
        delta: delta ? { shown: getComputedStyle(delta).display !== 'none', text: (delta.innerText ?? '').trim() } : null,
      };
    };
    const seatIds = await evaluate(session, () => [...document.querySelectorAll('[data-seat]')].map((one) => one.getAttribute('data-seat')));
    const mineSpent = await evaluate(session, () => Number(document.querySelector('[data-column="pitch"]')?.getAttribute('data-spent')));
    const mineId = await evaluate(session, () => document.querySelector('[data-column="pitch"]')?.getAttribute('data-team'));
    const other = seatIds.find((id) => id !== mineId);
    const idle = await evaluate(session, seatInfo, other);
    await mouse(idle, 0);
    await wait(300);
    const hovered = await evaluate(session, seatInfo, other);
    const selfTarget = await evaluate(session, seatInfo, mineId);
    await mouse(selfTarget, 0);
    await wait(300);
    const self = await evaluate(session, seatInfo, mineId);
    const expected = hovered.spent - mineSpent;
    const expectedText = `Δ ${expected > 0 ? '+' : ''}${expected}`;
    note('delta FVM', `hover su un'altra squadra: «${hovered.delta?.text}» (atteso ${expectedText}); sulla selezionata ${self.delta ? 'un delta' : 'niente'}`,
      [
        ...(idle.delta?.shown ? ['il delta si vede anche senza hover'] : []),
        ...(!hovered.delta?.shown ? ['il delta non compare in hover'] : []),
        ...(hovered.delta?.shown && hovered.delta.text !== expectedText ? [`delta sbagliato: ${hovered.delta.text} invece di ${expectedText}`] : []),
        ...(self.delta ? ['la squadra selezionata mostra un delta con se stessa'] : []),
      ]);

    // 5. Search, then two roles in OR.
    await mouse(await evaluate(session, centre, '[data-column="free"] input[type="search"]'));
    await session.send('Input.insertText', { text: 'inter' });
    await wait(700);
    const found = await evaluate(session, freeTexts);
    note('ricerca', `«inter»: ${found.length} righe`,
      [
        ...(!found.length ? ['nessuna riga'] : []),
        ...found.filter((t) => !/inter/i.test(t)).slice(0, 3).map((t) => `riga che non risponde: ${t.slice(0, 60)}`),
      ]);
    await mouse(await evaluate(session, centre, '[data-column="free"] .ant-input-clear-icon'));
    await wait(700);
    const all = (await evaluate(session, readPage)).rows;
    const pair = page.seats && (await evaluate(session, () =>
      [...document.querySelectorAll('[data-role-filter]')].map((one) => one.getAttribute('data-role-filter'))));
    const chosen = pair.includes('pc') ? ['dc', 'pc'] : ['d', 'a'];
    // THE OR IS COUNTED ON THE WHOLE FILTERED LIST, not on the rows loaded: the list loads 60 at a time
    // and after forty picks the first sixty can all carry the same role.
    const totalNow = () => evaluate(session, () => Number(document.querySelector('[data-total]')?.getAttribute('data-total')));
    // A toggle is a click that has to BITE: the total is read only once it has moved, and a click that
    // did not move it is sent again - measured on classic, the first click after clearing the search can
    // land before the list has settled and read the whole listone as «one role».
    const toggle = async (role) => {
      const before = await totalNow();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await mouse(await evaluate(session, centre, `[data-role-filter="${role}"]`));
        for (let tick = 0; tick < 10; tick += 1) {
          await wait(150);
          const now = await totalNow();
          if (now !== before) return now;
        }
      }
      return await totalNow();
    };
    const singles = [];
    for (const role of chosen) {
      singles.push(await toggle(role));
      await toggle(role);
    }
    await toggle(chosen[0]);
    const both = await toggle(chosen[1]);
    const roles = await evaluate(session, freeRoles);
    const wrong = roles.filter((one) => !one.some((r) => chosen.includes(r)));
    note('filtro ruoli', `${chosen.join(' o ')}: ${both} in tutto (da soli ${singles.join(' e ')}), ${roles.length} caricate su ${all}`,
      [
        ...(!roles.length ? ['nessuna riga'] : []),
        ...(wrong.length ? [`${wrong.length} righe senza ${chosen.join(' ne\' ')}`] : []),
        ...(singles.some((one) => !(both >= one)) || !(both > Math.min(...singles)) ? ["non e' un OR: insieme non ne tengono piu' di un ruolo solo"] : []),
      ]);

    // 5b. A click on a header sorts, a second click flips it; an empty cell sinks either way.
    await mouse(await evaluate(session, centre, '[data-free-head] [data-sort="fvm"]'));
    await wait(500);
    const fvmDown = await evaluate(session, columnOf, 'fvm');
    await mouse(await evaluate(session, centre, '[data-free-head] [data-sort="fvm"]'));
    await wait(500);
    const fvmUp = await evaluate(session, columnOf, 'fvm');
    note('ordina (default)', `FVM giu' ${fvmDown?.slice(0, 3).join('/')} · su ${fvmUp?.slice(0, 3).join('/')}`,
      [
        ...(!fvmDown?.length ? ['la colonna FVM non si legge'] : []),
        ...(fvmDown && !ordered(fvmDown, true) ? ['il primo click non ordina per FVM decrescente'] : []),
        ...(fvmUp && !ordered(fvmUp, false) ? ['il secondo click non rovescia'] : []),
      ]);
    await mouse(await evaluate(session, centre, '[data-free-head] [data-sort="prio"]'));
    await wait(400);

    // 5a'. The place filter: pick «fino al 3°» with a real pointer; every man left would let me call 3rd
    // or better in the next turn, and the list shrinks.
    const totalAll = Number(await evaluate(session, () => document.querySelector('[data-total]')?.getAttribute('data-total')));
    // THE LIMIT IS READ FROM THE ROWS, not chosen: whether «3rd» keeps anybody depends on how much this
    // squad has spent (measured, Serie A after 42 picks: nobody - which is right, not a defect). The
    // smallest place a row offers keeps somebody and, where places differ, drops somebody.
    const placesNow = await evaluate(session, () =>
      [...document.querySelectorAll('[data-free]')].map((one) => Number(one.getAttribute('data-next'))));
    const limit = Math.min(...placesNow);
    const varied = new Set(placesNow).size > 1;
    await mouse(await evaluate(session, centre, '[data-position-filter]'));
    await wait(500);
    const option = await evaluate(session, (wanted) => {
      const one = [...document.querySelectorAll('.ant-select-item-option')].find((item) => (item.innerText ?? '').trim() === wanted);
      if (!one) return null;
      const rect = one.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }, `fino al ${limit}°`);
    await mouse(option);
    await wait(700);
    const kept = await evaluate(session, () => ({
      total: Number(document.querySelector('[data-total]')?.getAttribute('data-total')),
      places: [...document.querySelectorAll('[data-free]')].map((one) => Number(one.getAttribute('data-next'))),
    }));
    note('filtro posizione', `fino al ${limit}°: ${kept.total} su ${totalAll}, posizioni viste ${[...new Set(kept.places)].sort((a, b) => a - b).join(',')}`,
      [
        ...(!option ? [`l'opzione «fino al ${limit}°» non c'e'`] : []),
        ...(varied && !(kept.total < totalAll) ? ['il filtro non toglie nessuno'] : []),
        ...(!kept.places.length ? ['il filtro toglie anche chi ci sta'] : []),
        ...(kept.places.some((place) => !(place <= limit)) ? [`resta chi farebbe chiamare oltre il ${limit}°`] : []),
      ]);
    await mouse(await evaluate(session, centre, '[data-position-filter] .ant-select-clear'));
    await wait(600);

    // 5b'. The titolarità column: its header, and full words in coloured badges.
    const rungs = await evaluate(session, () => ({
      header: [...document.querySelectorAll('[data-free-head] [data-sort="press"]')].map((one) => one.innerText.trim())[0] ?? '',
      words: [...new Set([...document.querySelectorAll('[data-free] [data-rung]')].map((one) => one.innerText.trim()))],
      colours: new Set([...document.querySelectorAll('[data-free] [data-rung]')].map((one) => getComputedStyle(one).color)).size,
      clipped: [...document.querySelectorAll('[data-free] [data-rung]')].filter((one) => one.scrollWidth > one.clientWidth + 1).length,
    }));
    const known = ['bandiera', 'titolarissimo', 'titolare', 'ballottaggio', 'comprimario', 'panchina', 'riserva', 'scarto'];
    note('titolarita', `intestazione «${rungs.header}», parole ${rungs.words.join(', ')}, ${rungs.colours} colori`,
      [
        ...(!/^Titolarità/i.test(rungs.header) ? ['l\'intestazione non dice Titolarità'] : []),
        ...(!rungs.words.length ? ['nessun badge'] : []),
        ...(rungs.words.some((word) => !known.includes(word)) ? ['una parola non intera: ' + rungs.words.filter((word) => !known.includes(word)).join(', ')] : []),
        ...(rungs.words.length > 1 && rungs.colours < 2 ? ['i badge hanno tutti lo stesso colore'] : []),
        ...(rungs.clipped ? [`${rungs.clipped} badge tagliati`] : []),
      ]);

    // 5c. A click on a name opens the player's card - in the list (after the double-click wait) and in the
    // call order - and a double click on a row does NOT (it chooses).
    const before5c = (await evaluate(session, cardTitles)).length;
    const listName = await evaluate(session, nameTarget, '[data-free] [data-card-name]');
    await mouse(listName, 1);
    await wait(700);
    const afterList = await evaluate(session, cardTitles);
    const seatName = await evaluate(session, nameTarget, '[data-seat] [data-card-name]');
    await mouse(seatName, 1);
    await wait(500);
    const afterSeat = await evaluate(session, cardTitles);
    note('card', `lista «${listName?.text}» → ${afterList.length - before5c} card, ordine «${seatName?.text}» → ${afterSeat.length} in tutto`,
      [
        ...(!listName ? ['nessun nome cliccabile nella lista'] : []),
        ...(afterList.length !== before5c + 1 ? ['il clic sul nome nella lista non apre la card'] : []),
        ...(!seatName ? ['nessun nome cliccabile nell\'ordine di chiamata'] : []),
        ...(seatName && afterSeat.length !== afterList.length + 1 ? ['il clic sul nome nell\'ordine non apre la card'] : []),
        ...(afterList.length > before5c && !afterList.some((title) => title.includes(listName.text)) ? [`la card non porta il nome cliccato: ${afterList.join(' | ')}`] : []),
      ]);
    await evaluate(session, () => document.querySelectorAll('ui-player-card button[aria-label], ui-player-card [data-close]').forEach(() => {}));

    // 6. Medie.
    await mouse(await evaluate(session, centre, '[data-mode="medie"]'));
    page = await settle((p) => /PV/i.test(p.header), 'medie');
    // THE LABELS SIT OVER THEIR NUMBERS: the right edge of every header cell against the right edge of the
    // cell under it, on the first row. The list scrolls and its scrollbar used to take pixels from the rows
    // only, so every column right of the name slid (found by the operator, 29/09/2026).
    const align = await evaluate(session, () => {
      const head = document.querySelector('[data-free-head]');
      const row = document.querySelector('[data-free]');
      if (!head || !row) return null;
      const heads = [...head.children].map((one) => one.getBoundingClientRect());
      const cells = [...row.children].map((one) => one.getBoundingClientRect());
      const drift = heads.map((one, at) => (cells[at] ? Math.round(Math.abs(one.right - cells[at].right)) : null));
      // The eight season columns, after role, name, FVM and priority.
      const widths = heads.slice(4).map((one) => Math.round(one.width));
      const clipped = [...document.querySelectorAll('[data-free]')].flatMap((one) => [...one.children].slice(2))
        .filter((cell) => cell.scrollWidth > cell.clientWidth + 1).length;
      const fmHead = head.children[6];
      const fmCell = row.children[6];
      const splits = document.querySelectorAll('[data-column="free"] .split').length;
      const crests = row.querySelectorAll('ui-crest').length;
      return {
        drift: drift.slice(2),
        fmHead: fmHead ? getComputedStyle(fmHead).color : null,
        fmCell: fmCell ? getComputedStyle(fmCell).color : null,
        mvCell: row.children[5] ? getComputedStyle(row.children[5]).color : null,
        splits,
        crests,
        widths,
        clipped,
      };
    });
    note('medie', `intestazione «${page.header.slice(0, 60)}», scarto destro etichetta/valore ${align?.drift.join('/')}px, `
      + `tratteggi ${align?.splits}, stemmi sulla riga ${align?.crests}`,
      [
        ...(/TITOLARIT|TREND/i.test(page.header) ? ['le colonne di default sono ancora a schermo'] : []),
        ...(!align ? ['niente da misurare'] : []),
        ...(align && align.drift.some((one) => one == null || one > 1) ? ['etichette non allineate ai valori'] : []),
        ...(align && align.fmCell === align.mvCell ? ['la Fm ha lo stesso colore della Mv'] : []),
        ...(align && align.fmHead !== align.fmCell ? ['etichetta Fm e valore Fm di due colori'] : []),
        ...(align && align.splits < 3 ? ['manca il tratteggio fra le due stagioni'] : []),
        ...(align && align.crests !== 1 ? ['manca lo stemma prima del nome'] : []),
        ...(align && new Set(align.widths).size !== 1 ? [`colonne di larghezze diverse: ${align.widths.join('/')}`] : []),
        ...(align && align.clipped ? [`${align.clipped} valori tagliati`] : []),
      ]);

    await mouse(await evaluate(session, centre, '[data-free-head] [data-sort="fm@last"]'));
    await wait(500);
    const fmLast = await evaluate(session, columnOf, 'fm@last');
    await mouse(await evaluate(session, centre, '[data-free-head] [data-sort="pv@now"]'));
    await wait(500);
    const pvNow = await evaluate(session, columnOf, 'pv@now');
    note('ordina (medie)', `Fm scorsa ${fmLast?.slice(0, 3).join('/')} · Pv ora ${pvNow?.slice(0, 3).join('/')}`,
      [
        ...(!fmLast?.length ? ['la colonna Fm della stagione scorsa non si legge'] : []),
        ...(fmLast && !ordered(fmLast, true) ? ['Fm della stagione scorsa non ordinata'] : []),
        ...(pvNow && !ordered(pvNow, true) ? ['Pv di questa stagione non ordinata'] : []),
      ]);

    // 7. The hand-written table survives a refresh; written for another league, it is not replayed.
    const beforeReload = await evaluate(session, () => ({
      squad: document.querySelector('[data-column="pitch"]')?.getAttribute('data-squad'),
      // The picks made, not the free list's total: that one depends on the filters, which a refresh resets.
      picks: [...document.querySelectorAll('[data-seat]')].reduce((sum, one) => sum + Number(one.getAttribute('data-picks')), 0),
      clock: document.querySelector('[data-seat][data-clock]')?.getAttribute('data-seat'),
    }));
    await session.send('Page.reload');
    await wait(1500);
    const reloaded = await settle(() => true, 'reload');
    const afterReload = await evaluate(session, () => ({
      squad: document.querySelector('[data-column="pitch"]')?.getAttribute('data-squad'),
      // The picks made, not the free list's total: that one depends on the filters, which a refresh resets.
      picks: [...document.querySelectorAll('[data-seat]')].reduce((sum, one) => sum + Number(one.getAttribute('data-picks')), 0),
      clock: document.querySelector('[data-seat][data-clock]')?.getAttribute('data-seat'),
    }));
    await evaluate(session, () => {
      const league = JSON.parse(localStorage.getItem('fantassistant.options.league') ?? '{}');
      localStorage.setItem('fantassistant.options.league', JSON.stringify({ ...league, teams: (league.teams ?? 10) - 1 }));
    });
    await session.send('Page.reload');
    await wait(1500);
    const otherLeague = await settle(() => true, 'other league');
    note('scelte salvate', `prima rosa ${beforeReload.squad}, scelte ${beforeReload.picks}, di turno ${beforeReload.clock}; `
      + `dopo il refresh ${afterReload.squad}/${afterReload.picks}/${afterReload.clock}; con un'altra lega rosa ${otherLeague.squadSize}`,
      [
        ...(JSON.stringify(beforeReload) !== JSON.stringify(afterReload) ? ['il refresh non riporta il tavolo com\'era'] : []),
        ...(reloaded.scrolls ? ['dopo il refresh la pagina scorre'] : []),
        ...(otherLeague.squadSize !== 0 ? ['le scelte di un\'altra lega sono state rigiocate'] : []),
      ]);

    // 6b. PREVISTE: FVM and priority stay right after the name, then the sheet's forecast in six columns.
    await mouse(await evaluate(session, centre, '[data-mode="previste"]'));
    await wait(700);
    const previste = await evaluate(session, () => {
      const head = [...(document.querySelector('[data-free-head]')?.children ?? [])].map((one) => one.getAttribute('data-sort'));
      const rows = [...document.querySelectorAll('[data-free]')];
      const filled = (at) => rows.filter((row) => !['', '—'].includes((row.children[at]?.innerText ?? '').trim())).length;
      return { head, rows: rows.length, rung: filled(4), pv: filled(5), minutes: filled(6), mv: filled(7), steady: filled(8), fm: filled(9) };
    });
    note('previste', `colonne ${previste.head.join(' ')}; su ${previste.rows} righe: gradino ${previste.rung}, pv ${previste.pv}, `
      + `minuti ${previste.minutes}, mv ${previste.mv}, costanza ${previste.steady}, fm ${previste.fm}`,
      [
        ...(previste.head.join(' ') !== 'role name fvm prio rung pvp min mvp steady fmp' ? ['colonne nell\'ordine sbagliato'] : []),
        ...(['rung', 'pv', 'minutes', 'mv', 'steady', 'fm'].filter((key) => !previste[key]).map((key) => `colonna ${key} vuota su tutte le righe`)),
      ]);

    const at = argv.indexOf('--shot');
    if (at >= 0 && argv[at + 1]) {
      if (!flag('--medie')) await mouse(await evaluate(session, centre, '[data-mode="default"]'));
      await wait(600);
      const image = await session.send('Page.captureScreenshot', { format: 'png' });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(argv[at + 1], Buffer.from(image.data, 'base64'));
      console.log(`screenshot: ${argv[at + 1]}`);
    }

    const noise = session.noise();
    note('console', `${noise.length} messaggi`, noise.slice(0, 5));
  } finally {
    session?.close();
    // THE WHOLE TREE, not the parent: on Windows `kill` stops the first Edge process and leaves its renderers
    // behind - measured 29/09/2026, 210 headless Edge left by this bench had eaten the machine's memory.
    // Not even the tree is enough: part of Edge re-parents itself away from the process we launched, so the
    // reliable key is this run's own PROFILE directory, which no other browser on the machine can carry.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile}*' } | `
        + 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], { stdio: 'ignore' });
    } else browser.kill();
    server.close();
    await wait(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  console.log(problems.length ? `\n${problems.length} PROBLEMI` : '\nNESSUN PROBLEMA');
  process.exit(problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
