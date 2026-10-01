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
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
  // The first row the squad on the clock can CALL: with the Draft Priority a frozen top (Kane) may head the
      // list, dimmed, and a double click on him is refused by design.
      const first = document.querySelector('[data-free]:not([data-locked])');
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
    } else {
      // HIS OWN BROWSER (30/09/2026): the EuroLeghe draft left the Italian clubs excluded, in the single list
      // the app kept before exclusions went per listone. A Serie A table must not inherit them - with one list
      // they emptied the whole listone - so the classic run carries them, and every count below would fall.
      const { gunzipSync } = await import('node:zlib');
      const clubs = JSON.parse(gunzipSync(await readFile(join(DIST, 'data', 'clubs.json.gz'))).toString('utf-8'));
      const [id, league] = ['fc_club_id', 'league'].map((name) => clubs.columns.indexOf(name));
      const italian = clubs.rows.filter((row) => row[league] === 'serie_a').map((row) => row[id]);
      await wait(1500);
      await evaluate(session, (ids) => localStorage.setItem('fantassistant.options.excludedClubs', JSON.stringify(ids)), italian);
      // HIS COMPETITION WINDOW (01/10/2026): «giornate» 5-22 in the global options, so every number in matchdays of
      // the draft is on 18 rounds and not on the 38 of a season.
      await evaluate(session, () => localStorage.setItem('fantassistant.options.league', JSON.stringify({ from: 5, to: 22 })));
      await session.send('Page.reload');
      await wait(1500);
      console.log(`· esclusioni EuroLeghe salvate: ${italian.length} club di Serie A nella lista di prima`);
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
      note('top bloccati', `${shown.length} bloccati fra le prime righe (badge ${shown[0]?.badge ?? '-'}), cercando «kane» FVM min ${Math.min(...locked)}`,
        [
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
    // Read while the move is still flying: the squad that chose drops to the bottom of the order. Polled,
    // not read at a fixed instant - the first pick of a table also builds the projection before it paints.
    let flying = [];
    for (let tick = 0; tick < 30; tick += 1) {
      await wait(40);
      flying = await evaluate(session, seatsNow);
      if (flying.some((one) => one.sliding)) break;
    }
    page = await settle((p) => p.first?.id !== before.first.id, 'the pick');
    await wait(700);
    const landed = await evaluate(session, seatsNow);
    const byAt = [...landed].sort((a, b) => a.at - b.at);
    const overlap = byAt.some((one, at) => at > 0 && one.top < byAt[at - 1].bottom);
    const outOfOrder = byAt.some((one, at) => at > 0 && one.top <= byAt[at - 1].top);
    const moved = landed.filter((one) => seatsBefore.find((old) => old.id === one.id)?.at !== one.at).length;
    note('ordine animato', `${moved} squadre cambiano posto, ${flying.filter((one) => one.sliding).length} in volo, ferme dopo: ${landed.filter((one) => one.sliding).length}`,
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

    // 3a. A MODULE CHOSEN STAYS CHOSEN (operator, 29/09/2026): pick one in the selector, make picks, and the
    // pitch must still be drawn on it - and after a refresh too.
    const moduleNow = () => evaluate(session, () => ({
      drawn: document.querySelector('[data-module]')?.getAttribute('data-module') ?? null,
      select: (document.querySelector('[data-module-select]')?.innerText ?? '').trim(),
    }));
    await mouse(await evaluate(session, centre, '[data-module-select]'));
    await wait(500);
    // The menu's SECOND module (after «Auto» and the first): visible without scrolling, and not the one the
    // automatic choice opens on, on either game (mantra and classic have different modules).
    const moduleOption = await evaluate(session, () => {
      const one = [...document.querySelectorAll('.ant-select-item-option')][2];
      if (!one) return null;
      const rect = one.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2),
        name: (one.innerText ?? '').replace('★', '').trim(),
      };
    });
    const wantedModule = moduleOption?.name;
    await mouse(moduleOption);
    await wait(500);
    const chosenModule = await moduleNow();
    for (let n = 0; n < 6; n += 1) {
      const now = await evaluate(session, readPage);
      await mouse(now.first, 2);
      await wait(400);
    }
    const afterPicks = await moduleNow();
    await session.send('Page.reload');
    await wait(1500);
    await settle(() => true, 'reload after module');
    const moduleReloaded = await moduleNow();
    note('modulo scelto', `scelto ${chosenModule.drawn} («${chosenModule.select}»), dopo 6 scelte ${afterPicks.drawn}, dopo il refresh ${moduleReloaded.drawn} («${moduleReloaded.select}»)`,
      [
        ...(chosenModule.drawn !== wantedModule ? [`il campetto non disegna il modulo scelto (${chosenModule.drawn})`] : []),
        ...(afterPicks.drawn !== wantedModule ? [`dopo le scelte il modulo e' diventato ${afterPicks.drawn}`] : []),
        ...(moduleReloaded.drawn !== wantedModule ? [`dopo il refresh il modulo e' ${moduleReloaded.drawn}`] : []),
      ]);
    // Back to automatic, which is what the rest of the bench measures.
    await mouse(await evaluate(session, centre, '[data-module-select]'));
    await wait(500);
    await mouse(await evaluate(session, () => {
      const one = [...document.querySelectorAll('.ant-select-item-option')].find((item) => (item.innerText ?? '').trim() === 'Auto');
      if (!one) return null;
      const rect = one.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }));
    await wait(400);

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
        // AUTO may start anywhere in the order - the steps before it pick with the page, and with the Draft
        // Priority those picks are different men at different prices - so it owes at least one pick, a stop
        // on me and never a pick for me; the count is the order's business.
        ...(autoTo - autoFrom < 1 || seatsTotal < 2 ? ['nessuna scelta automatica prima del mio turno'] : []),
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

    // 4-ter. CAMPO / LISTA (operator, 29/09/2026): the list shows the squad's BOUGHT men, one row each, in the
    // rulebook's role order, with crest, FVM and the titolarità word; back to the pitch after.
    await mouse(await evaluate(session, centre, '[data-pitch-view="lista"]'));
    await wait(400);
    const list = await evaluate(session, () => {
      const rows = [...document.querySelectorAll('[data-roster-list] [data-roster]')];
      return {
        pitchGone: !document.querySelector('[data-column="pitch"] [data-place]'),
        rows: rows.length,
        squad: Number(document.querySelector('[data-column="pitch"]')?.getAttribute('data-squad')),
        crests: rows.filter((one) => one.querySelector('ui-crest')).length,
        fvm: rows.filter((one) => /\d/.test(one.children[3]?.textContent ?? '')).length,
        turns: rows.map((one) => Number(one.getAttribute('data-turn'))),
        firstRoles: rows.map((one) => (one.getAttribute('data-roles') ?? '').split(',')[0]),
      };
    });
    const rulebook = euro
      ? ['por', 'dd', 'dc', 'ds', 'b', 'e', 'm', 'c', 'w', 't', 'a', 'pc']
      : ['p', 'd', 'c', 'a'];
    const ranks = list.firstRoles.map((role) => rulebook.indexOf(role));
    // Sorted by the turn column: 1, 2, 3... - each man once, and every turn of the squad there.
    await mouse(await evaluate(session, centre, '[data-roster-sort="turn"]'));
    await wait(300);
    const byTurn = await evaluate(session, () =>
      [...document.querySelectorAll('[data-roster-list] [data-roster]')].map((one) => Number(one.getAttribute('data-turn'))));
    const turnsOk = byTurn.every((turn, i) => turn === i + 1) && byTurn.length === list.rows;
    await mouse(await evaluate(session, centre, '[data-roster-sort="role"]'));
    await wait(200);
    await mouse(await evaluate(session, centre, '[data-pitch-view="campo"]'));
    await wait(400);
    const back =await evaluate(session, () => document.querySelectorAll('[data-column="pitch"] [data-place]').length);
    note('campo/lista', `${list.rows} righe per una rosa di ${list.squad}, ruoli ${list.firstRoles.join(' ')}, stemmi ${list.crests}, FVM ${list.fvm}; di nuovo il campo: ${back} posti`,
      [
        ...(!list.pitchGone ? ['in lista il campetto e\' ancora a schermo'] : []),
        ...(list.rows !== list.squad ? [`la lista ha ${list.rows} righe per ${list.squad} in rosa`] : []),
        ...(list.crests !== list.rows ? ['una riga senza stemma'] : []),
        ...(list.fvm !== list.rows ? ['una riga senza FVM'] : []),
        ...(ranks.some((rank, i) => i > 0 && rank >= 0 && ranks[i - 1] >= 0 && rank < ranks[i - 1]) ? ['la lista non e\' in ordine di ruolo'] : []),
        ...(back !== 11 ? [`tornando al campo i posti sono ${back}`] : []),
        ...(!turnsOk ? [`ordinata per turno legge ${byTurn.join(' ')}`] : []),
      ]);

    // 4-quater. THE MANTRA ROLES ON THE PITCH (operator, 29/09/2026): every man drawn carries his codes on
    // mantra, inside his place; on classic the place IS the role and nobody carries them.
    const pitchRoles = await evaluate(session, () => {
      const names = [...document.querySelectorAll('[data-column="pitch"] [data-place] [data-card-name]')];
      const roles = [...document.querySelectorAll('[data-column="pitch"] [data-place] [data-pitch-roles]')];
      const outside = roles.filter((one) => {
        const box = one.getBoundingClientRect();
        const place = one.closest('[data-place]').getBoundingClientRect();
        return box.width === 0 || box.left < place.left - 0.5 || box.right > place.right + 0.5;
      }).length;
      return { men: names.length, roles: roles.length, outside, sample: (roles[0]?.innerText ?? '').replace(/\s+/g, '') };
    });
    note('ruoli sul campetto', `${pitchRoles.men} uomini disegnati, ${pitchRoles.roles} con i ruoli (es. «${pitchRoles.sample}»)`,
      [
        ...(!pitchRoles.men ? ['nessun uomo sul campetto: il passo non ha guardato niente'] : []),
        ...(euro && pitchRoles.roles !== pitchRoles.men ? [`${pitchRoles.men - pitchRoles.roles} uomini senza ruoli mantra`] : []),
        ...(!euro && pitchRoles.roles ? [`${pitchRoles.roles} ruoli disegnati sul classic`] : []),
        ...(pitchRoles.outside ? [`${pitchRoles.outside} gruppi di ruoli fuori dal loro posto o larghi zero`] : []),
      ]);

    // 4-quinquies. DOWNLOAD (operator, 29/09/2026): rose and scelte as two CSVs, read back from DISK and
    // compared with the picks the seats count - the file is the thing promised, not the click.
    const downloads = await mkdtemp(join(tmpdir(), 'fant-e2e-draft-dl-'));
    await session.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    const totalPicks = await picksOf();
    const files = {};
    let menuStuck = false;
    for (const what of ['rose', 'scelte']) {
      await mouse(await evaluate(session, centre, '[data-download]'));
      await wait(400);
      await mouse(await evaluate(session, centre, `[data-download-what="${what}"]`));
      let text = null;
      for (let tick = 0; tick < 40 && text === null; tick += 1) {
        await wait(150);
        const name = (await readdir(downloads)).find((one) => one.endsWith(`-${what}.csv`));
        if (name) text = await readFile(join(downloads, name), 'utf8');
      }
      files[what] = text;
      // The menu closes after a choice: wait for it, or the next click on the button would toggle it shut.
      let closed = false;
      for (let tick = 0; tick < 20 && !closed; tick += 1) {
        closed = !(await evaluate(session, () => !!document.querySelector('[data-download-what]')));
        if (!closed) await wait(100);
      }
      if (!closed) menuStuck = true;
    }
    await rm(downloads, { recursive: true, force: true });
    const rowsOf = (text) => (text ?? '').replace(/^﻿/, '').trimEnd().split('\r\n').slice(1).map((line) => line.split(';'));
    const scelte = rowsOf(files.scelte);
    const rose = rowsOf(files.rose);
    const key = (rows) => rows.map((row) => `${row[0]}|${row[4]}|${row[10]}`).sort().join(',');
    note('download', `scelte ${scelte.length} righe, rose ${rose.length}, scelte sul tavolo ${totalPicks}`,
      [
        ...(files.scelte === null ? ['il file delle scelte non e\' arrivato'] : []),
        ...(files.rose === null ? ['il file delle rose non e\' arrivato'] : []),
        ...(files.scelte && !files.scelte.startsWith('﻿') ? ['il file non ha il BOM: Excel leggerebbe male gli accenti'] : []),
        ...(scelte.length !== totalPicks ? [`le scelte nel file sono ${scelte.length} contro ${totalPicks} sul tavolo`] : []),
        ...(scelte.some((row, i) => Number(row[0]) !== i + 1) ? ['le scelte non sono in ordine di chiamata'] : []),
        ...(key(scelte) !== key(rose) ? ['rose e scelte non portano le stesse aggiudicazioni'] : []),
        ...(scelte.some((row) => !row[5]) ? ['una scelta senza nome'] : []),
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

    // 4a''. The call order is the order and nothing else (operator, 29/09/2026): below it the LAST TEN picks,
    //       most recent first and agreeing with the table; and the men predicted gone before our turn marked
    //       in the list, each with the colour of the squad predicted to take him.
    const tail = await evaluate(session, () => ({
      seatsWithPicks: document.querySelectorAll('[data-seat] [data-predicted]').length,
      last: [...document.querySelectorAll('[data-last-pick]')].map((one) => Number(one.getAttribute('data-last-pick'))),
      taken: [...document.querySelectorAll('[data-free][data-taken-by]')].map((one) => ({
        id: Number(one.getAttribute('data-free')),
        bar: getComputedStyle(one).boxShadow,
      })),
      switchText: document.querySelector('[data-only-taken]')?.innerText ?? null,
    }));
    note('ordine e ultime scelte',
      `${tail.last.length} ultime scelte, ${tail.seatsWithPicks} previsioni sulle righe dell'ordine; `
      + `${tail.taken.length} righe caricate segnate «prima di te», interruttore «${tail.switchText ?? '—'}»`,
      [
        ...(tail.seatsWithPicks ? ["le righe dell'ordine portano ancora la scelta prevista"] : []),
        // By here AUTO has made ten picks and more, so the list is full.
        ...(tail.last.length !== 10 ? [`${tail.last.length} ultime scelte invece di 10`] : []),
        ...(tail.taken.some((one) => !one.bar || one.bar === 'none') ? ['una riga «prima di te» senza la barra del colore'] : []),
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
    // A CLEAN START: the pointer of an earlier step may sit on a free-list row whose tooltip reaches over the
    // order column, and a teleported pointer that lands ON a tooltip keeps it open - the hover then measures
    // the tooltip instead of the seat (found 29/09/2026, when the list's order changed which row was there).
    await mouse({ x: 2, y: 2 }, 0);
    await wait(400);
    const leftover = await evaluate(session, () => document.querySelectorAll('.ant-tooltip:not(.ant-tooltip-hidden)').length);
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
        ...(leftover ? [`${leftover} tooltip ancora aperti prima dell'hover`] : []),
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
    // 5b'. RAR (operator, 30/09/2026): how many free men of his base role are as good or better. It is a COUNT,
    // so every loaded row carries a whole number; the first click puts the RAREST first, i.e. ascending.
    await mouse(await evaluate(session, centre, '[data-free-head] [data-sort="rar"]'));
    await wait(500);
    // The column PRINTS a share above ten, so the count is read from the attribute the row declares.
    const rarRows = await evaluate(session, () => [...document.querySelectorAll('[data-free] [data-rar]')].map((cell) => ({
      count: cell.getAttribute('data-rar-count') == null ? null : Number(cell.getAttribute('data-rar-count')),
      of: cell.getAttribute('data-rar-of') == null ? null : Number(cell.getAttribute('data-rar-of')),
      text: cell.textContent.trim(),
    })));
    const rarUp = rarRows.map((one) => one.count);
    const freeTotal = Number(await evaluate(session, () => document.querySelector('[data-total]')?.getAttribute('data-total')));
    // The printed form: the count up to ten, above it the share of the OTHER free men of his group.
    const badText = rarRows.filter((one) => one.count != null && one.text !== (one.count <= 10 || !one.of
      ? String(one.count) : `${Math.round((one.count / one.of) * 100)}%`));
    note('RAR', `rari prima: ${rarUp.slice(0, 5).join('/')} · ${rarUp.filter((one) => one === 0).length} a zero su ${rarUp.length} caricate`,
      [
        ...(!rarUp.length ? ['la colonna RAR non si legge'] : []),
        ...(rarUp.some((one) => one == null) ? [`${rarUp.filter((one) => one == null).length} righe senza RAR`] : []),
        ...(rarRows.some((one) => one.count != null && (!Number.isInteger(one.count) || one.count < 0 || one.count > one.of || one.of >= freeTotal))
          ? ['un RAR che non e\' un conteggio di altri svincolati'] : []),
        ...(badText.length ? [`${badText.length} righe stampano il RAR nella forma sbagliata (es. «${badText[0].text}» per ${badText[0].count}/${badText[0].of})`] : []),
        ...(!ordered(rarUp, false) ? ['il primo click su RAR non mette i piu\' rari in cima'] : []),
      ]);
    // A second click flips it: the LEAST rare first, i.e. the counts above ten, which print a share.
    await mouse(await evaluate(session, centre, '[data-free-head] [data-sort="rar"]'));
    await wait(500);
    const rarDown = await evaluate(session, () => [...document.querySelectorAll('[data-free] [data-rar]')].map((cell) => ({
      count: Number(cell.getAttribute('data-rar-count')), of: Number(cell.getAttribute('data-rar-of')), text: cell.textContent.trim(),
    })));
    const shares = rarDown.filter((one) => one.text.endsWith('%'));
    const wrongShare = rarDown.filter((one) => one.count > 10 && one.of
      && one.text !== `${Math.round((one.count / one.of) * 100)}%`);
    note('RAR in percentuale', `meno rari: ${rarDown.slice(0, 3).map((one) => `${one.text} (${one.count}/${one.of})`).join(', ')}; `
      + `${shares.length} righe in percentuale`,
      [
        ...(!shares.length ? ['nessun RAR oltre 10 stampato in percentuale'] : []),
        ...(wrongShare.length ? [`${wrongShare.length} percentuali sbagliate`] : []),
        ...(!ordered(rarDown.map((one) => one.count), true) ? ['il secondo click non rovescia'] : []),
      ]);
    // DP = B + (1 - 0.25 min(1, RAR/k)) (SeSw - B) (30/09/2026): it never exceeds SeSw, and where RAR is 0 - the
    // last of his kind - it IS SeSw. Both printed in hundredths and truncated, so one unit of slack.
    const seswRows = await evaluate(session, () => [...document.querySelectorAll('[data-free]')]
      .map((row) => ({
        sesw: Number(row.querySelector('[data-sesw]')?.textContent.trim()),
        // Role, name, FVM, SeSw, Pa (01/10/2026), then the priority.
        dp: Number(row.children[5]?.textContent.trim()),
        rar: row.querySelector('[data-rar]')?.getAttribute('data-rar-count'),
      }))
      .filter((one) => Number.isFinite(one.sesw) && Number.isFinite(one.dp)));
    const above = seswRows.filter((one) => one.dp > one.sesw + 1);
    const rareOff = seswRows.filter((one) => one.rar === '0' && Math.abs(one.dp - one.sesw) > 1);
    const lowered = seswRows.filter((one) => one.dp < one.sesw - 1).length;
    // Every draft has a SeSw since 30/09/2026, classic too: it is a READING of the man. The DP was mantra-only from
    // that evening to 01/10/2026 (the draft bench measured it at -19.9% on classic, priorita-draft-v1.md §24) and is
    // ON EVERYWHERE since, by the operator's decision - so the «DP <= SeSw» arithmetic holds on every game.
    note('SeSw e DP', `${seswRows.length} righe con entrambe, ${lowered} abbassate dalla rarita'`,
      [
        ...(!seswRows.length ? ['nessuna riga con SeSw'] : []),
        ...(above.length ? [`${above.length} righe con DP sopra SeSw`] : []),
        ...(rareOff.length ? [`${rareOff.length} righe con RAR 0 e DP diversa da SeSw`] : []),
        ...(seswRows.length && !lowered ? ["la rarita' non abbassa nessuno"] : []),
      ]);
    // +ROSA (01/10/2026): what one man adds to my pitch. He stands on ONE place (or one reserve), so he adds at most
    // one place of coverage and never takes any away; the printed % is that coverage over the eleven places.
    const addedRows = await evaluate(session, () => [...document.querySelectorAll('[data-free]')]
      .map((row) => ({
        cover: row.querySelector('[data-added]')?.getAttribute('data-added-cover'),
        text: (row.querySelector('[data-added]')?.innerText ?? '').trim(),
      })));
    const measured = addedRows.filter((one) => one.cover != null).map((one) => ({ ...one, cover: Number(one.cover) }));
    const outOfRange = measured.filter((one) => one.cover < -1e-9 || one.cover > 1 + 1e-9);
    // In % of the whole squad's eleven places, one decimal (01/10/2026).
    const pct = (cover) => Math.round((cover / 11) * 1000) / 10;
    const misprinted = measured.filter((one) => !one.text.startsWith(`${pct(one.cover) > 0 ? '+' : ''}${pct(one.cover).toFixed(1)}%`));
    note('+Rosa', `${measured.length} di ${addedRows.length} righe, ${measured.filter((one) => one.cover > 0.005).length} che coprono qualcosa`,
      [
        ...(!measured.length ? ['nessuna riga con +Rosa'] : []),
        ...(measured.length && !measured.some((one) => one.cover > 0.005) ? ['nessuno aggiunge copertura'] : []),
        ...(outOfRange.length ? [`${outOfRange.length} righe con una copertura fuori da 0-1 posto`] : []),
        ...(misprinted.length ? [`${misprinted.length} percentuali stampate diverse dalla copertura`] : []),
      ]);
    // ...and its header sorts on FERTILITY, coverage only on a tie (operator, 01/10/2026).
    await mouse(await evaluate(session, centre, '[data-free-head] [data-sort="added"]'));
    await wait(400);
    const bySort = await evaluate(session, () => [...document.querySelectorAll('[data-free] [data-added]')]
      .map((cell) => {
        const [cover, fertility] = (cell.innerText ?? '').trim().split(/\s+/);
        return { cover: Number(cover?.replace('%', '')), fertility: Number(fertility) };
      })
      .filter((one) => Number.isFinite(one.fertility)));
    const addedOutOfOrder = bySort.filter((one, at) => at > 0 && (one.fertility > bySort[at - 1].fertility
      || (one.fertility === bySort[at - 1].fertility && one.cover > bySort[at - 1].cover)));
    note('+Rosa ordina', `primi: ${bySort.slice(0, 4).map((one) => `${one.cover}% ${one.fertility}`).join(' · ')}`,
      [
        ...(!bySort.length ? ['nessuna fertilità da ordinare'] : []),
        ...(addedOutOfOrder.length ? [`${addedOutOfOrder.length} righe fuori ordine (fertilità, poi copertura)`] : []),
      ]);
    // The next step puts the list back on the priority itself.
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400, pointerType: 'mouse' });
    await wait(300);
    // THE NEW FORMULA'S Pa (01/10/2026): every loaded row against `presence_now.json` itself, never against the
    // column - the share of the rounds left times the COMPETITION's rounds for everybody (18 here), and a dash for
    // whoever the file does not carry (it is Serie A only).
    const nowFile = existsSync(join(DIST, 'data', 'presence_now.json'))
      ? JSON.parse(await readFile(join(DIST, 'data', 'presence_now.json'), 'utf-8')) : null;
    const paShare = new Map((nowFile?.rows ?? []).filter((one) => one.share != null).map((one) => [one.fcId, one.share]));
    const paRows = await evaluate(session, () => [...document.querySelectorAll('[data-free]')]
      .map((row) => ({ id: Number(row.getAttribute('data-free')), text: row.querySelector('[data-pa]')?.textContent.trim() ?? null })));
    const paShown = paRows.filter((one) => /\d/.test(one.text ?? ''));
    const scales = paShown.filter((one) => paShare.get(one.id) > 0.05)
      .map((one) => Number(one.text) / paShare.get(one.id));
    const scale = scales.length ? scales.reduce((a, b) => a + b, 0) / scales.length : null;
    const offScale = scales.filter((one) => scale && Math.abs(one - scale) > 0.06 / 0.05 + 0.5);
    const missing = paRows.filter((one) => paShare.has(one.id) && !/\d/.test(one.text ?? ''));
    const invented = paShown.filter((one) => !paShare.has(one.id));
    note('Pa nuova formula', nowFile
      ? `${paShown.length} di ${paRows.length} righe con la Pa, scala ${scale?.toFixed(2)} giornate`
      : 'presence_now.json assente nel build', [
        ...(!nowFile ? ['manca presence_now.json: npm run data:pull dopo now.py'] : []),
        ...(nowFile && !paShown.length ? ['nessuna riga con la Pa'] : []),
        ...(missing.length ? [`${missing.length} righe col dato nel file e un trattino a schermo`] : []),
        ...(invented.length ? [`${invented.length} righe con una Pa che il file non ha`] : []),
        ...(offScale.length ? [`${offScale.length} righe su una scala diversa`] : []),
        // On the competition's «giornate» (01/10/2026): 5-22 is 18 rounds on the classic run.
        ...(!euro && scale && Math.abs(scale - 18) > 0.5 ? [`scala ${scale.toFixed(2)} invece di 18 (giornate 5-22)`] : []),
      ]);
    await mouse(await evaluate(session, centre, '[data-free-head] [data-sort="prio"]'));
    await wait(400);
    // A CDP pointer TELEPORTS: the header's tooltip would stay open over the next control, where a hand would
    // have closed it on its way out. Leave the header the way a hand does.
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400, pointerType: 'mouse' });
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

    // 5a''. The FVM range: typed with the keyboard into the two boxes, both ends included.
    const typeInto = async (selector, text) => {
      await mouse(await evaluate(session, centre, `${selector} input`), 1);
      await session.send('Input.insertText', { text });
      await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', windowsVirtualKeyCode: 9 });
      await wait(500);
    };
    const allBefore = Number(await evaluate(session, () => document.querySelector('[data-total]')?.getAttribute('data-total')));
    const labelBefore = await evaluate(session, () => (document.querySelector('[data-fvm-range]')?.innerText ?? '').trim());
    // Only the label is on the screen: the boxes are in the small panel it opens.
    const boxesClosed = await evaluate(session, () => !document.querySelector('[data-fvm-min]'));
    await mouse(await evaluate(session, centre, '[data-fvm-range]'));
    await wait(500);
    await typeInto('[data-fvm-min]', '20');
    await typeInto('[data-fvm-max]', '60');
    const ranged = await evaluate(session, () => ({
      total: Number(document.querySelector('[data-total]')?.getAttribute('data-total')),
      fvm: [...document.querySelectorAll('[data-free]')].map((one) => Number(one.getAttribute('data-fvm'))),
    }));
    const labelAfter = await evaluate(session, () => (document.querySelector('[data-fvm-range]')?.innerText ?? '').trim());
    note('range FVM', `etichetta «${labelBefore}» → «${labelAfter}»; 20-60: ${ranged.total} su ${allBefore}, FVM visti ${Math.min(...ranged.fvm)}-${Math.max(...ranged.fvm)}`,
      [
        ...(!boxesClosed ? ['le caselle sono a schermo prima di aprire il riquadro'] : []),
        ...(!/^FVM 0 → \d+$/.test(labelBefore) ? [`etichetta iniziale «${labelBefore}»`] : []),
        ...(labelAfter !== 'FVM 20 → 60' ? [`l'etichetta non dice il range: «${labelAfter}»`] : []),
        ...(!ranged.fvm.length ? ['il range toglie tutti'] : []),
        ...(!(ranged.total < allBefore) ? ['il range non toglie nessuno'] : []),
        ...(ranged.fvm.some((fvm) => fvm < 20 || fvm > 60) ? ['resta un FVM fuori dal range'] : []),
      ]);
    await mouse(await evaluate(session, centre, '[data-fvm-reset]'));
    await wait(500);
    const reset = await evaluate(session, () => ({
      total: Number(document.querySelector('[data-total]')?.getAttribute('data-total')),
      label: (document.querySelector('[data-fvm-range]')?.innerText ?? '').trim(),
    }));
    note('range FVM azzerato', `«${reset.label}», ${reset.total} righe`,
      reset.total !== allBefore || reset.label !== labelBefore ? ['«Azzera» non riporta la lista intera'] : []);
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
    await mouse(await evaluate(session, centre, '[data-column="order"]'));
    await wait(400);

    // 5a'''. The rung filter: pick «titolare» and only men at least titolare stay.
    await mouse(await evaluate(session, centre, '[data-rung-filter]'));
    await wait(500);
    await mouse(await evaluate(session, () => {
      const one = [...document.querySelectorAll('.ant-select-item-option')].find((item) => (item.innerText ?? '').trim() === 'almeno titolare');
      if (!one) return null;
      const rect = one.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }));
    await wait(600);
    const atLeast = await evaluate(session, () => ({
      total: Number(document.querySelector('[data-total]')?.getAttribute('data-total')),
      words: [...new Set([...document.querySelectorAll('[data-free] [data-rung]')].map((one) => one.innerText.trim()))],
      blanks: [...document.querySelectorAll('[data-free]')].filter((one) => !one.querySelector('[data-rung]')).length,
    }));
    note('filtro gradino', `almeno titolare: ${atLeast.total} righe, parole ${atLeast.words.join(', ')}`,
      [
        ...(!atLeast.total ? ['il filtro toglie tutti'] : []),
        ...(atLeast.words.some((word) => !['bandiera', 'titolarissimo', 'titolare'].includes(word)) ? ['resta un gradino sotto titolare'] : []),
        ...(atLeast.blanks ? [`${atLeast.blanks} righe senza gradino restano`] : []),
      ]);
    await mouse(await evaluate(session, centre, '[data-rung-filter]'));
    await wait(500);
    await mouse(await evaluate(session, () => {
      const one = [...document.querySelectorAll('.ant-select-item-option')].find((item) => (item.innerText ?? '').trim() === 'tutti i gradini');
      if (!one) return null;
      const rect = one.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }));
    await wait(500);

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
    // last picks under the call order - and a double click on a row does NOT (it chooses).
    const before5c = (await evaluate(session, cardTitles)).length;
    const listName = await evaluate(session, nameTarget, '[data-free] [data-card-name]');
    await mouse(listName, 1);
    await wait(700);
    const afterList = await evaluate(session, cardTitles);
    // THE CARDS OPEN OVER THE MIDDLE COLUMN, and since the «di turno» box left it (29/09/2026) the last picks sit
    // right under the card the list just opened: close them first, so the next click measures the last picks and
    // not a card lying on top of them.
    await evaluate(session, () => document.querySelectorAll('ui-player-card button[aria-label="chiudi"]').forEach((one) => one.click()));
    await wait(300);
    const reopened = await evaluate(session, cardTitles);
    // A name whose card is NOT open yet: clicking an open one only brings it to the front.
    const seatName = await evaluate(session, (open) => {
      // ...and one the pointer can REACH: the cards already open float over the page and may cover it.
      for (const name of document.querySelectorAll('[data-last-pick] [data-card-name]')) {
        if (open.some((title) => title.includes((name.innerText ?? '').trim()))) continue;
        const rect = name.getBoundingClientRect();
        const at = { x: Math.round(rect.left + Math.min(12, rect.width / 2)), y: Math.round(rect.top + rect.height / 2) };
        if (!name.contains(document.elementFromPoint(at.x, at.y))) continue;
        return { ...at, text: (name.innerText ?? '').trim() };
      }
      return null;
    }, reopened);
    await mouse(seatName, 1);
    await wait(500);
    const afterSeat = await evaluate(session, cardTitles);
    note('card', `lista «${listName?.text}» → ${afterList.length - before5c} card, ultime scelte «${seatName?.text}» → ${afterSeat.length} in tutto`,
      [
        ...(!listName ? ['nessun nome cliccabile nella lista'] : []),
        ...(afterList.length !== before5c + 1 ? ['il clic sul nome nella lista non apre la card'] : []),
        ...(!seatName ? ['nessun nome raggiungibile nelle ultime scelte'] : []),
        ...(reopened.length ? [`${reopened.length} card ancora aperte dopo la chiusura`] : []),
        ...(seatName && afterSeat.length !== reopened.length + 1 ? ['il clic sul nome nelle ultime scelte non apre la card'] : []),
        ...(afterList.length > before5c && !afterList.some((title) => title.includes(listName.text)) ? [`la card non porta il nome cliccato: ${afterList.join(' | ')}`] : []),
      ]);
    await evaluate(session, () => document.querySelectorAll('ui-player-card button[aria-label], ui-player-card [data-close]').forEach(() => {}));

    // 5d. THE PLANS (operator, 29/09/2026): a package reads «N) rosa +x (difficolta')», with one of the four words.
    // Mantra only: the plans are built on the Draft Priority, which is off on classic since 30/09/2026 (evening, the
    // bench's -19.9%). There the step asks the opposite - no plan on screen. The pointer on a package does nothing
    // (his rule of the same night).
    {
      const plan = await evaluate(session, () => {
        const one = document.querySelector('[data-scenario]');
        return one ? { text: (one.innerText ?? '').replace(/\s+/g, ' ').trim(), difficulty: one.getAttribute('data-difficulty') } : null;
      });
      // SELECTED, the plan highlights the places it fills with how much it adds there; a second click unpins it.
      const pinned = async () => evaluate(session, () => !!document.querySelector('[data-scenario].border-primary'));
      const wasPinned = await pinned();
      if (plan && !wasPinned) await mouse(await evaluate(session, centre, '[data-scenario]'));
      await wait(500);
      const lit = await evaluate(session, () => ({
        places: document.querySelectorAll('[data-plan-place]').length,
        gains: [...document.querySelectorAll('[data-place-gain]')].map((one) => (one.innerText ?? '').trim()),
      }));
      if (plan && !wasPinned) await mouse(await evaluate(session, centre, '[data-scenario]'));
      await wait(400);
      const after = await evaluate(session, () => document.querySelectorAll('[data-plan-place]').length);
      // The plans follow the Draft Priority, which is on in every game since 01/10/2026 (operator's decision).
      note('piani', plan ? `«${plan.text}» (${plan.difficulty}); selezionato: ${lit.places} posti evidenziati, incrementi ${lit.gains.join(' | ')}; deselezionato ${after}` : 'nessun piano',
        [
          ...(!plan ? ['nessun piano a schermo'] : []),
          ...(plan && !/^1\) rosa [+-]?\d+ \((sicuro|facile|medio|difficile)\) [+-]\d+% [+-]\d+ /.test(plan.text) ? ["il piano non porta gli incrementi di copertura e fertilita'"] : []),
          ...(plan && !lit.places ? ['selezionato, nessun posto evidenziato sul campetto'] : []),
          ...(plan && lit.gains.length !== lit.places ? [`${lit.places} posti evidenziati e ${lit.gains.length} incrementi`] : []),
          ...(plan && lit.gains.some((one) => !/^\+\d+% · [+-]\d+$/.test(one)) ? [`incrementi illeggibili: ${lit.gains.join(' | ')}`] : []),
          ...(plan && !wasPinned && after ? [`${after} posti ancora evidenziati dopo averlo deselezionato`] : []),
          ...(plan && !/^1\) rosa [+-]?\d+/.test(plan.text) ? [`il piano non si legge «1) rosa +N»: «${plan.text}»`] : []),
          ...(plan && !['sicuro', 'facile', 'medio', 'difficile'].includes(plan.difficulty) ? [`difficolta' ${plan.difficulty}`] : []),
        ]);
    }

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
      // The eight season columns, after role, name, FVM, SeSw, Pa (01/10/2026), priority, rarity and +Rosa.
      const widths = heads.slice(8).map((one) => Math.round(one.width));
      const clipped = [...document.querySelectorAll('[data-free]')].flatMap((one) => [...one.children].slice(2))
        .filter((cell) => cell.scrollWidth > cell.clientWidth + 1).length;
      const fmHead = head.children[10];
      const fmCell = row.children[10];
      const splits = document.querySelectorAll('[data-column="free"] .split').length;
      const crests = row.querySelectorAll('ui-crest').length;
      return {
        drift: drift.slice(2),
        fmHead: fmHead ? getComputedStyle(fmHead).color : null,
        fmCell: fmCell ? getComputedStyle(fmCell).color : null,
        mvCell: row.children[9] ? getComputedStyle(row.children[9]).color : null,
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
      // MY squad, off my seat: the pitch draws whichever squad was last CLICKED, which is not saved, so reading
      // the pitch compared two squads whenever a step had clicked a rival.
      squad: document.querySelector('[data-seat][data-mine]')?.getAttribute('data-picks'),
      // The picks made, not the free list's total: that one depends on the filters, which a refresh resets.
      picks: [...document.querySelectorAll('[data-seat]')].reduce((sum, one) => sum + Number(one.getAttribute('data-picks')), 0),
      clock: document.querySelector('[data-seat][data-clock]')?.getAttribute('data-seat'),
    }));
    // THE FILTERS SURVIVE A REFRESH (operator, 01/10/2026): they travel in the address, so the same query string
    // and the same filtered total come back. Read before, compared after - never assumed.
    const filtersBefore = await evaluate(session, () => ({
      search: location.search,
      total: document.querySelector('[data-total]')?.getAttribute('data-total') ?? null,
    }));
    await session.send('Page.reload');
    await wait(1500);
    const reloaded = await settle(() => true, 'reload');
    let filtersAfter = null;
    for (let tick = 0; tick < 20; tick += 1) {
      filtersAfter = await evaluate(session, () => ({
        search: location.search,
        total: document.querySelector('[data-total]')?.getAttribute('data-total') ?? null,
      }));
      if (filtersAfter.total === filtersBefore.total) break;
      await wait(250);
    }
    note('filtri dopo il refresh', `indirizzo «${filtersBefore.search || '(vuoto)'}», totale ${filtersBefore.total} -> ${filtersAfter.total}`, [
      ...(!filtersBefore.search ? ["nessun filtro nell'indirizzo prima del refresh"] : []),
      ...(filtersAfter.search !== filtersBefore.search ? ["il refresh ha perso l'indirizzo dei filtri"] : []),
      ...(filtersAfter.total !== filtersBefore.total ? ['la lista filtrata non torna uguale dopo il refresh'] : []),
    ]);
    const afterReload = await evaluate(session, () => ({
      // MY squad, off my seat: the pitch draws whichever squad was last CLICKED, which is not saved, so reading
      // the pitch compared two squads whenever a step had clicked a rival.
      squad: document.querySelector('[data-seat][data-mine]')?.getAttribute('data-picks'),
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
    // The steps after this one read the WHOLE free list: the filters left on by the steps before travel in the
    // address now, so they go with a navigation to the bare path - a refresh would keep them.
    await evaluate(session, () => { location.href = location.pathname; });
    await wait(1500);
    await settle(() => true, 'no filters');
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
    // The steadiness arrives with the ratings, which are computed after the sheet: wait for them to land.
    for (let tick = 0; tick < 40; tick += 1) {
      const steadyFilled = await evaluate(session, () => [...document.querySelectorAll('[data-free]')]
        .some((row) => !['', '—'].includes((row.children[12]?.innerText ?? '').trim())));
      if (steadyFilled) break;
      await wait(250);
    }
    const previste = await evaluate(session, () => {
      const head = [...(document.querySelector('[data-free-head]')?.children ?? [])].map((one) => one.getAttribute('data-sort'));
      const rows = [...document.querySelectorAll('[data-free]')];
      const filled = (at) => rows.filter((row) => !['', '—'].includes((row.children[at]?.innerText ?? '').trim())).length;
      return { head, rows: rows.length, rung: filled(8), pv: filled(9), minutes: filled(10), mv: filled(11), steady: filled(12), fm: filled(13) };
    });
    note('previste', `colonne ${previste.head.join(' ')}; su ${previste.rows} righe: gradino ${previste.rung}, pv ${previste.pv}, `
      + `minuti ${previste.minutes}, mv ${previste.mv}, costanza ${previste.steady}, fm ${previste.fm}`,
      [
        ...(previste.head.join(' ') !== 'role name fvm sesw pa prio rar added rung pvp min mvp steady fmp' ? ['colonne nell\'ordine sbagliato'] : []),
        ...(['rung', 'pv', 'minutes', 'mv', 'steady', 'fm'].filter((key) => !previste[key]).map((key) => `colonna ${key} vuota su tutte le righe`)),
      ]);

    // 8. THE CLASSIC DRAFT PLAYED TO ITS END (todolist-draft-classic-v1, items 3.3 and 3.4, 30/09/2026). AUTO plays
    // every rival with the page's own prediction; my picks are the first callable row, forwards first so a line
    // fills early. Asserted: «pieno» is on a free row EXACTLY when my line of his role is full (3.3), the double
    // click on a full-line row is refused, AUTO never stops on a refused pick - a prediction past a quota is one
    // the host refuses (3.4) - and every squad ends at 3/8/8/6. On mantra there is no line quota to test.
    if (!euro) {
      const QUOTA = { p: 3, d: 8, c: 8, a: 6 };
      const lineOf = (roles) => (roles.split(',').find((one) => one in QUOTA) ?? null);
      await mouse(await evaluate(session, centre, '[data-mode="default"]'));
      await mouse(await evaluate(session, centre, '[data-pitch-view="lista"]'));
      await wait(400);
      const readTable = () => evaluate(session, () => ({
        clock: document.querySelector('[data-seat][data-clock]')?.getAttribute('data-seat') ?? null,
        seats: [...document.querySelectorAll('[data-seat]')].map((one) => ({
          id: one.getAttribute('data-seat'), picks: Number(one.getAttribute('data-picks')),
        })),
        roster: [...document.querySelectorAll('[data-roster]')].map((one) => one.getAttribute('data-roles') ?? ''),
        rows: [...document.querySelectorAll('[data-free]')].map((one) => ({
          id: one.getAttribute('data-free'), roles: one.getAttribute('data-roles') ?? '',
          full: one.hasAttribute('data-full'), locked: one.hasAttribute('data-locked'),
        })),
        messages: [...document.querySelectorAll('.ant-message-notice')].map((one) => (one.innerText ?? '').trim()),
      }));
      const countOf = (roster) => {
        const out = { p: 0, d: 0, c: 0, a: 0 };
        for (const roles of roster) { const line = lineOf(roles); if (line) out[line] += 1; }
        return out;
      };
      // The pitch draws the squad last clicked in the order column, else mine: make sure it is mine.
      for (let tries = 0; tries < 3; tries += 1) {
        const shown = await evaluate(session, () => document.querySelector('[data-column="pitch"]')?.getAttribute('data-team'));
        if (shown === mine) break;
        await mouse(await evaluate(session, (id) => {
          const rect = document.querySelector(`[data-seat="${id}"]`)?.getBoundingClientRect();
          return rect ? { x: Math.round(rect.left + 40), y: Math.round(rect.top + rect.height / 2) } : null;
        }, shown));
        await wait(300);
      }
      const fullWrong = [];
      const messages = new Set();
      let fullSeen = 0, fullChecked = 0, refusedFull = null, myPicks = 0;
      await mouse(await evaluate(session, centre, '[data-auto]'));
      let table = await readTable();
      const total = table.seats.length * 25;
      const started = Date.now();
      for (let guard = 0; guard < 2400; guard += 1) {
        table = await readTable();
        for (const text of table.messages) messages.add(text);
        if (table.seats.reduce((sum, one) => sum + one.picks, 0) >= total) break;
        if ([...messages].some((text) => text.startsWith('AUTO fermo'))) break;
        if (table.clock !== mine) { await wait(200); continue; }
        // My turn: the pitch shows my squad, so its list is my roster.
        const count = countOf(table.roster);
        // A FULL LINE'S MEN SIT AT THE BOTTOM since 01/10/2026 (below everybody callable): to see one, and to try
        // the refusal on it, the tail of the list has to be loaded - it loads sixty rows a scroll.
        if (refusedFull === null && Object.keys(QUOTA).some((line) => count[line] >= QUOTA[line])) {
          for (let scroll = 0; scroll < 8 && !table.rows.some((row) => row.full); scroll += 1) {
            await evaluate(session, () => { const list = document.querySelector('[data-free-list]'); if (list) list.scrollTop = list.scrollHeight; });
            await wait(250);
            table = await readTable();
          }
          if (table.clock !== mine) continue;
        }
        for (const row of table.rows) {
          const line = lineOf(row.roles);
          if (!line) continue;
          fullChecked += 1;
          if (row.full) fullSeen += 1;
          if (row.full !== (count[line] >= QUOTA[line])) {
            fullWrong.push(`${row.id} (${line}) «pieno» ${row.full ? 'acceso' : 'spento'} con ${count[line]}/${QUOTA[line]}`);
          }
        }
        // Once, the refusal: a double click on a man of a full line must not give him to me.
        const fullRow = table.rows.find((row) => row.full && !row.locked);
        if (fullRow && refusedFull === null) {
          const before = table.seats.find((one) => one.id === mine).picks;
          await mouse(await evaluate(session, (id) => {
            const one = document.querySelector(`[data-free="${id}"] [data-card-name]`)?.closest('[data-free]');
            if (!one) return null;
            one.scrollIntoView({ block: 'center' });
            const rect = one.getBoundingClientRect();
            return { x: Math.round(rect.left + rect.width - 30), y: Math.round(rect.top + rect.height / 2) };
          }, fullRow.id), 2);
          await wait(500);
          const after = (await readTable()).seats.find((one) => one.id === mine).picks;
          refusedFull = after === before;
        }
        const wantForward = count.a < QUOTA.a;
        const pick = table.rows.find((row) => !row.full && !row.locked && (!wantForward || lineOf(row.roles) === 'a'))
          ?? table.rows.find((row) => !row.full && !row.locked);
        if (!pick) {
          // The list loads 60 rows at a time: every loaded one is frozen or of a full line, so load more.
          await evaluate(session, () => { const list = document.querySelector('[data-free-list]'); if (list) list.scrollTop = list.scrollHeight; });
          await wait(300);
          continue;
        }
        const before = table.seats.find((one) => one.id === mine).picks;
        await mouse(await evaluate(session, (id) => {
          const one = document.querySelector(`[data-free="${id}"]`);
          if (!one) return null;
          one.scrollIntoView({ block: 'center' });
          const rect = one.getBoundingClientRect();
          return { x: Math.round(rect.left + rect.width - 30), y: Math.round(rect.top + rect.height / 2) };
        }, pick.id), 2);
        for (let tick = 0; tick < 20; tick += 1) {
          await wait(150);
          if ((await readTable()).seats.find((one) => one.id === mine).picks > before) { myPicks += 1; break; }
        }
      }
      const autoOn = await evaluate(session, () => document.querySelector('[data-auto]')?.className ?? '');
      if (/primary|active|checked/.test(autoOn)) await mouse(await evaluate(session, centre, '[data-auto]'));
      const done = table.seats.reduce((sum, one) => sum + one.picks, 0);
      // Every squad's composition, read by viewing it: a seat click puts its squad on the pitch.
      const shapes = [];
      for (const seat of table.seats) {
        await mouse(await evaluate(session, (id) => {
          const one = document.querySelector(`[data-seat="${id}"]`);
          const rect = one?.getBoundingClientRect();
          return rect ? { x: Math.round(rect.left + 40), y: Math.round(rect.top + rect.height / 2) } : null;
        }, seat.id));
        await wait(300);
        const count = countOf((await readTable()).roster);
        shapes.push(`${seat.id}:${count.p}/${count.d}/${count.c}/${count.a}`);
      }
      const offShape = shapes.filter((one) => !one.endsWith(':3/8/8/6'));
      const stopped = [...messages].filter((text) => text.startsWith('AUTO fermo'));
      note('draft classic fino in fondo', `${done}/${total} scelte in ${Math.round((Date.now() - started) / 1000)}s,`
        + ` ${myPicks} mie; «pieno» su ${fullSeen} righe di ${fullChecked} guardate; rose ${shapes.join(' ')}`, [
        ...(done !== total ? [`il draft si e' fermato a ${done} scelte su ${total}`] : []),
        ...stopped.map((text) => `AUTO si e' fermato su una scelta rifiutata: «${text}»`),
        ...fullWrong.slice(0, 5),
        ...(fullWrong.length > 5 ? [`... e altre ${fullWrong.length - 5} righe con «pieno» sbagliato`] : []),
        ...(!fullSeen ? ['nessuna riga «pieno»: nessun mio reparto si e\' riempito mentre guardavo'] : []),
        ...(refusedFull === false ? ['il doppio click su un uomo di un reparto pieno me l\'ha dato'] : []),
        ...(refusedFull === null ? ['non ho trovato una riga «pieno» su cui provare il rifiuto'] : []),
        ...offShape.map((one) => `rosa fuori quota ${one} (atteso 3/8/8/6)`),
      ]);
    }

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
