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
  return [...document.querySelectorAll('[data-free]')].map((one) => (one.innerText ?? '').replace(/\s+/g, ' ').trim());
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
      note('top bloccati', `riga «${cap}», ${locked.length} bloccati caricati (FVM min ${Math.min(...locked)})`,
        [
          ...(!/300/.test(cap) || !/3 turni/.test(cap) ? [`la riga non dice il tetto dichiarato (300, 3 turni): «${cap}»`] : []),
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
    await mouse(before.first, 2);
    page = await settle((p) => p.first?.id !== before.first.id, 'the pick');
    const ids = await evaluate(session, freeIds);
    note('doppio click', `preso «${before.first.text.slice(0, 40)}», di turno prima ${before.onClock} ora ${page.onClock}, rosa ${page.squadSize}`,
      [
        ...(ids.includes(before.first.id) ? ['il preso e\' ancora fra gli svincolati'] : []),
        ...(page.onClock === before.onClock ? ['il turno non e\' passato'] : []),
        ...(page.squadSize !== 1 ? [`la rosa di chi ha scelto (la mia) conta ${page.squadSize} invece di 1`] : []),
        ...(page.filled !== 1 ? [`il campetto porta ${page.filled} titolari invece di 1`] : []),
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
    await evaluate(session, () => document.querySelector('[data-free-list]')?.scrollTo(0, 0));
    page = await evaluate(session, readPage);
    const drawn = page.filled + page.reserves + page.unplaced;
    note('campetto', `rosa ${page.squadSize}: titolari ${page.filled} + riserve ${page.reserves} + senza posto ${page.unplaced}; scroll ${page.overflow}px`,
      [
        ...(drawn !== page.squadSize ? [`il campetto disegna ${drawn} uomini su ${page.squadSize}`] : []),
        ...(page.squadSize < 3 ? ['la mia rosa non e\' cresciuta'] : []),
        ...(page.scrolls ? [`dopo le scelte la pagina scorre di ${page.overflow}px`] : []),
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
    const singles = [];
    for (const role of chosen) {
      await mouse(await evaluate(session, centre, `[data-role-filter="${role}"]`));
      await wait(500);
      singles.push(await totalNow());
      await mouse(await evaluate(session, centre, `[data-role-filter="${role}"]`));
      await wait(500);
    }
    for (const role of chosen) await mouse(await evaluate(session, centre, `[data-role-filter="${role}"]`));
    await wait(700);
    const both = await totalNow();
    const roles = await evaluate(session, freeRoles);
    const wrong = roles.filter((one) => !one.some((r) => chosen.includes(r)));
    note('filtro ruoli', `${chosen.join(' o ')}: ${both} in tutto (da soli ${singles.join(' e ')}), ${roles.length} caricate su ${all}`,
      [
        ...(!roles.length ? ['nessuna riga'] : []),
        ...(wrong.length ? [`${wrong.length} righe senza ${chosen.join(' ne\' ')}`] : []),
        ...(singles.some((one) => !(both >= one)) || !(both > Math.min(...singles)) ? ["non e' un OR: insieme non ne tengono piu' di un ruolo solo"] : []),
      ]);

    // 6. Medie.
    await mouse(await evaluate(session, centre, '[data-mode="medie"]'));
    page = await settle((p) => /PV/i.test(p.header), 'medie');
    note('medie', `intestazione «${page.header.slice(0, 90)}»`, /FVM/.test(page.header) ? ['le colonne di default sono ancora a schermo'] : []);

    const at = argv.indexOf('--shot');
    if (at >= 0 && argv[at + 1]) {
      await mouse(await evaluate(session, centre, '[data-mode="default"]'));
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
    browser.kill();
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
