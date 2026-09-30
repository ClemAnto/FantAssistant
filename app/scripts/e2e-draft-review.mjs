/**
 * e2e-draft-review.mjs - drive the REAL Draft Assistant (`/auction`) on a FINISHED draft served by a FAKE
 * fanta-asta-live, and measure the operator's requests of 30/09/2026: «tasti avanti e indietro per navigare
 * un'asta draft passata: premendo indietro il cursore si sposta di una scelta indietro ignorando tutto quello
 * che succede dopo», and «aggiungi anche i tasti inizio e fine».
 *
 * The fake host (anonymous sign-in, the listone, the SSE stream) is the one of `e2e-plancia-resume.mjs`,
 * copied because every bench here is standalone. The draft is twelve picks over four squads, in SNAKE order,
 * with the host's `pickOrder` as it reads at the END - so a page that walked the published order instead of
 * rebuilding it from the history would put the wrong squad on the clock, and the step says which.
 *
 * What is asserted at every cursor, against the FIXTURE and never against the screen: the counter «k/12», the
 * squad on the clock (the one that really made pick k+1), the last pick shown (pick k), how many last picks and
 * how many men are in the squads (k), and the four buttons' disabled states at the ends. Then a reload shows
 * the whole table again: the cursor is a way of looking, not a state of the table.
 *
 * Usage: node scripts/e2e-draft-review.mjs [--headed] [--shot PATH]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
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
  '.sqlite': 'application/octet-stream',
};
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
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
      response.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404);
      response.end(String(error));
    }
  });
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () =>
      done({
        server,
        port: server.address().port,
      }),
    ),
  );
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
  const noise = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params?.exceptionDetails;
      noise.push(
        `ECCEZIONE: ${detail?.exception?.description ?? detail?.text ?? '?'}`.slice(0, 300),
      );
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      noise.push(
        `CONSOLE: ${message.params.args.map((one) => one.description ?? one.value).join(' ')}`.slice(
          0,
          300,
        ),
      );
    }
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
  return { send, close: () => socket.close(), noise: () => noise.splice(0, noise.length) };
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

/**
 * A REAL pointer: hover first, then press and release where the browser says the target is.
 *
 * `clicks` is the clickCount the browser is told about, and it is what makes a DOUBLE click a double
 * click: two presses at the same point with `clickCount` 1 then 2 are what Chromium turns into a
 * `dblclick`, and dispatching the event by hand would prove nothing about the card being reachable.
 */
async function click(session, point, clicks = 1) {
  const at = { x: Math.round(point.x), y: Math.round(point.y) };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'none' });
  await wait(60);
  for (let n = 1; n <= clicks; n += 1) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...at,
      button: 'left',
      clickCount: n,
    });
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...at,
      button: 'left',
      clickCount: n,
    });
    if (n < clicks) await wait(40);
  }
  await wait(350);
}

/** Click a target that has STOPPED MOVING: a popover enters with an animation. */
async function clickSteady(session, selector, text, tries = 20) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const box = await evaluate(session, boxOf, selector, text);
    if (!box) return null;
    if (
      last &&
      Math.round(last.x) === Math.round(box.x) &&
      Math.round(last.y) === Math.round(box.y)
    ) {
      await click(session, box);
      return box;
    }
    last = box;
    await wait(80);
  }
  if (last) await click(session, last);
  return last;
}

async function waitFor(session, fn, tries = 60, ...args) {
  let out = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    out = await evaluate(session, fn, ...args);
    if (out) return out;
    await wait(250);
  }
  return out;
}



// ------------------------------------------------------------------ the FAKE fanta-asta-live

function fakeHost(code, state, listone) {
  // IL TAVOLO NON SI DIMENTICA QUANDO IL MIO BROWSER RICARICA. `addScriptToEvaluateOnNewDocument` gira
  // su OGNI documento, quindi senza questa riga il finto host tornava allo stato iniziale a ogni
  // refresh - e il passo del refresh misurava un tavolo appena nato invece del tavolo di prima. Il
  // difetto era del banco e si e' visto perche' un passo verde e' diventato rosso appena l'asta ha
  // cominciato ad avere una storia.
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem('__fakeAuction') ?? 'null');
  } catch {
    saved = null;
  }
  const store = { code, state: saved ?? state, streams: [] };
  store.keep = () => {
    try {
      sessionStorage.setItem('__fakeAuction', JSON.stringify(store.state));
    } catch {
      /* un browser che rifiuta lo storage fa lo stesso il resto */
    }
  };
  window.__fakeAuction = store;

  /**
   * IL LISTONE DELLA SESSIONE, ed e' quello VERO e non un segnaposto.
   *
   * Per un giro e' stato uno solo, con la ragione «tanto la plancia prezza dal FOGLIO»: vera a meta'.
   * La plancia prezza dal foglio, ma il FEED risolve il RUOLO di un uomo comprato da questa lista -
   * `deriveTeams` chiama `players.get(pick.playerId)` per sapere in che reparto togliere un posto - e
   * con un listone di un nome quel ruolo era sempre `null`, quindi i posti che restano non si
   * muovevano. L'ha trovato l'invariante della sincronia, non una rilettura: il primo giro in cui e'
   * stato chiamato ha detto «Dino legge posti 3·8·8·6 e il tavolo ne lascia 3·7·8·6».
   *
   * *Un fixture piu' povero della cosa vera misura una catena piu' corta di quella che esiste.*
   */

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('identitytoolkit.googleapis.com')) {
      return new Response(JSON.stringify({ idToken: 'fake-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('firebaseio.com')) {
      const body = url.includes('/env/playerList') ? listone : null;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  };

  /**
   * The stream. The feed adds its `put`/`patch` listeners AFTER the constructor returns, so the first
   * event is SCHEDULED and never dispatched inline - firing it synchronously would land on a socket
   * nobody is listening to yet, which is a defect of the harness that reads as a page that never
   * connects.
   */
  class FakeSource extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
      store.streams.push(this);
      setTimeout(() => this.push('put', '/', store.state), 30);
    }
    push(kind, path, data) {
      this.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify({ path, data }) }));
    }
    close() {
      this.readyState = 2;
      store.streams = store.streams.filter((one) => one !== this);
    }
  }
  FakeSource.CLOSED = 2;
  window.EventSource = FakeSource;
}

/** Four squads, three rounds in snake order, the draft over. */
const ORDER = [0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 2, 3];
const LABELS = ['Io', 'Bea', 'Ciro', 'Dino'];

function finishedDraft(ids) {
  return {
    status: 3,
    marketType: 1,
    playerListType: 'default',
    settings: {
      budget: 1000,
      participants: LABELS.length,
      game: 1,
      roles: { gk: [3, 3], def: [8, 8], mid: [8, 8], atk: [6, 6], size: [25, 25] },
    },
    options: { draft: { maxAheadPicks: 1 } },
    teams: LABELS.map((label, id) => ({ id, connection: { label, active: true, host: id === 0 } })),
    // The order as it reads at the END: not the order of any moment of the review.
    pickOrder: [3, 2, 1, 0],
    turnTeamId: 3,
    picks: ORDER.map((teamId, index) => ({ index, teamId, playerId: ids[index], cost: 12 - index })),
  };
}

// ------------------------------------------------------------------ what runs IN the page

function boxOf(selector, text) {
  const found = [...document.querySelectorAll(selector)].find((one) =>
    (one.innerText ?? '').trim().toLowerCase().includes(text.toLowerCase()),
  );
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const under = document.elementFromPoint(x, y);
  return { x, y, reachable: found.contains(under) || under?.contains(found) || false };
}


/** What the review shows: the counter, the buttons, the squad on the clock, the last picks, the squads. */
function readReview() {
  const at = document.querySelector('[data-review-at]');
  if (!at) return null;
  const clock = document.querySelector('[data-seat][data-at="1"]');
  const off = (selector) => !!document.querySelector(selector)?.disabled;
  return {
    label: at.innerText.trim(),
    startOff: off('[data-review-start]'),
    backOff: off('[data-review-back]'),
    forwardOff: off('[data-review-forward]'),
    endOff: off('[data-review-end]'),
    clock: clock ? Number(clock.getAttribute('data-seat')) : null,
    last: [...document.querySelectorAll('[data-last-pick]')].map((one) => Number(one.getAttribute('data-last-pick'))),
    held: [...document.querySelectorAll('[data-seat]')].reduce((sum, one) => sum + Number(one.getAttribute('data-picks') || 0), 0),
    totals: !!document.querySelector('[data-pitch-cover]') && !!document.querySelector('[data-pitch-fertility]'),
  };
}

// ------------------------------------------------------------------ the run

async function gz(url) {
  const { gunzipSync } = await import('node:zlib');
  const body = await (await fetch(url)).arrayBuffer();
  return JSON.parse(gunzipSync(Buffer.from(body)).toString('utf-8'));
}


const CODE = 'FA-tst-002';

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build in ${DIST}: run "ng build" first`);
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-review-'));
  const debugPort = Number(value('--port', String(await freePort())));
  const url = `http://127.0.0.1:${port}/auction`;
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1600,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  const problems = [];
  const note = (step, said, found = []) => {
    console.log(`· ${step}: ${said}`);
    for (const one of found) console.log(`    ! ${one}`);
    problems.push(...found.map((one) => `${step}: ${one}`));
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Runtime.enable');
    await session.send('Page.enable');

    // The listone of the session from the SHEET the page reads, so the picks resolve to real men.
    const sheet = await gz(`http://127.0.0.1:${port}/data/sheets/leghe.json.gz`);
    const col = (name) => sheet.columns.indexOf(name);
    const ZONE = { P: 'gk', D: 'def', C: 'mid', A: 'atk' };
    const listone = {};
    for (const one of sheet.rows) {
      const role = one[col('role_classic')];
      if (!ZONE[role]) continue;
      listone[one[col('fc_id')]] = {
        id: one[col('fc_id')], name: one[col('name')], team: one[col('club')], roles: [],
        zone: { classic: ZONE[role], mantra: role === 'P' ? 'gk' : 'mov' },
        championship: { label: 'Serie A' }, stats: { fmv: { classic: 1, mantra: 1 } },
      };
    }
    const ids = Object.keys(listone).slice(0, ORDER.length).map(Number);
    const state = finishedDraft(ids);

    // The session this browser «was following», so the page re-joins it by itself; the fake host on every
    // document, so the reload of step 6 finds the same table.
    const saved = JSON.stringify(JSON.stringify({ code: CODE, teamId: 0 }));
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        `try { localStorage.setItem('fantassistant.auction', ${saved}); } catch {}\n` +
        `(${fakeHost.toString()})(${JSON.stringify(CODE)}, ${JSON.stringify(state)}, ${JSON.stringify(listone)});`,
    });
    await session.send('Page.navigate', { url });

    const total = ORDER.length;
    const expectAt = (k, seen) => {
      const found = [];
      if (!seen) return ['la barra non disegna i tasti di revisione'];
      if (seen.label !== `${k}/${total}`) found.push(`il contatore legge «${seen.label}» invece di «${k}/${total}»`);
      if (k < total && seen.clock !== ORDER[k]) {
        found.push(`di turno c'e' la squadra ${seen.clock}, e la scelta ${k + 1} l'ha fatta la ${ORDER[k]}`);
      }
      const last = k ? ids[k - 1] : null;
      if ((seen.last[0] ?? null) !== last) found.push(`ultima scelta mostrata ${seen.last[0] ?? '—'}, attesa ${last ?? '—'}`);
      if (seen.last.length !== Math.min(k, 10)) found.push(`${seen.last.length} ultime scelte invece di ${Math.min(k, 10)}`);
      if (seen.held !== k) found.push(`le rose portano ${seen.held} uomini invece di ${k}`);
      for (const [key, name, on] of [
        ['startOff', 'inizio', k === 0], ['backOff', 'indietro', k === 0],
        ['forwardOff', 'avanti', k === total], ['endOff', 'fine', k === total],
      ]) {
        if (seen[key] !== on) found.push(`«${name}» ${seen[key] ? 'spento' : 'acceso'} alla scelta ${k}`);
      }
      return found;
    };
    const settle = async (k) => {
      for (let i = 0; i < 60; i += 1) {
        const seen = await evaluate(session, readReview);
        if (seen?.label === `${k}/${total}`) {
          await wait(120);
          return evaluate(session, readReview);
        }
        await wait(150);
      }
      return evaluate(session, readReview);
    };
    const press = async (selector) => {
      const box = await evaluate(session, boxOf, selector, '');
      if (!box) return `non trovo ${selector}`;
      if (!box.reachable) {
        const under = await evaluate(session, (x, y) => {
          const one = document.elementFromPoint(x, y);
          return one ? `${one.tagName.toLowerCase()}.${[...one.classList].slice(0, 3).join('.')}` : 'niente';
        }, box.x, box.y);
        return `${selector} e' coperto da ${under}`;
      }
      await click(session, box);
      return null;
    };

    // 1. The whole draft, as the host left it. The counter reads 12/12 as soon as the stream lands (~0.4s),
    // while the engine's sheet and the rulebook arrive later (~0.7s): read before them, the pitch is still
    // empty and this step blamed the page for the bench's own haste (30/09/2026, 2 runs of 2).
    for (let i = 0; i < 60; i += 1) {
      if ((await evaluate(session, readReview))?.totals) break;
      await wait(150);
    }
    const start = await settle(total);
    note('draft finito', `«${start?.label}», totali del campo ${start?.totals ? 'presenti' : 'assenti'}`, [
      ...expectAt(total, start),
      ...(start?.totals ? [] : ["l'intestazione del campo non porta copertura e fertilita'"]),
    ]);

    // 2. Back one pick at a time down to zero, checking every cursor.
    let bad = [];
    for (let k = total - 1; k >= 0; k -= 1) {
      const miss = await press('[data-review-back]');
      if (miss) { bad.push(miss); break; }
      bad.push(...expectAt(k, await settle(k)).map((one) => `scelta ${k}: ${one}`));
    }
    note('indietro fino alla prima', `${total} passi`, bad);

    // 3. Forward three picks.
    bad = [];
    for (let k = 1; k <= 3; k += 1) {
      const miss = await press('[data-review-forward]');
      if (miss) { bad.push(miss); break; }
      bad.push(...expectAt(k, await settle(k)).map((one) => `scelta ${k}: ${one}`));
    }
    note('avanti di tre', 'fino a 3', bad);

    // 4. «Fine» shows the whole table, «Inizio» the draft before anybody chose.
    let miss = await press('[data-review-end]');
    note('fine', miss ?? 'premuto', [...(miss ? [miss] : []), ...expectAt(total, await settle(total))]);
    miss = await press('[data-review-start]');
    note('inizio', miss ?? 'premuto', [...(miss ? [miss] : []), ...expectAt(0, await settle(0))]);

    // 5. A review does not survive a reload: it is a way of looking, not a state of the table.
    await session.send('Page.reload');
    await wait(500);
    const reloaded = await settle(total);
    note('dopo un refresh', `«${reloaded?.label}»`, expectAt(total, reloaded));

    const shot = argv.indexOf('--shot');
    if (shot >= 0 && argv[shot + 1]) {
      await press('[data-review-back]');
      await press('[data-review-back]');
      await settle(total - 2);
      const image = await session.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(argv[shot + 1], Buffer.from(image.data, 'base64'));
      console.log(`screenshot: ${argv[shot + 1]}`);
    }
    const noise = session.noise();
    note('console', `${noise.length} messaggi`, noise.slice(0, 5));
  } finally {
    session?.close();
    // THE WHOLE TREE and this run's PROFILE, as in `e2e-draft.mjs`: Edge leaves renderers behind otherwise.
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
