/**
 * e2e-draft-classic.mjs - drive the REAL Draft Assistant (`/auction`) on a REAL finished CLASSIC draft, replayed
 * one pick at a time, and hold every screen to what the table really did (todolist-draft-classic-v1.md, item 1.2:
 * «guardare la pagina collegata a quella sessione: lista, filtro P/D/C/A, campetto, ordine di chiamata, previsioni
 * "prima di te", nessuna scelta prevista fuori quota»).
 *
 * The session is a FILE written by a read-only dump of fanta-asta-live (`sessions/<code>`: `env.playerList` and
 * `state`), served by the fake host of `e2e-draft-review.mjs` - copied, because every bench here is standalone.
 * The file carries names, prices and squads (paid content) and stays OUT of the repository: pass its path.
 *
 * The page is walked with its own review buttons (the cursor lives in the feed, so every number on screen is read
 * from the table as it stood), and it stops at every turn of the squad it follows. At each stop, against the
 * FIXTURE and never against the screen:
 *   1. ORDER: the squad on the clock is the one that really made the next pick, and the seats, read in call
 *      order, are the squads in the order they really called next (pingpong or default, whatever the host said).
 *   2. SQUADS: every seat carries as many men as the table held; the pitch draws the whole squad.
 *   3. THE LIST: no man already taken is on it; «pieno» is on a row exactly when our line of his zone is full.
 *   4. «PRIMA DI TE», read right after our pick: no man is predicted for us, no rival is predicted past a quota
 *      (squad + predicted, per line), and on a SNAKE each rival is predicted exactly as many calls as it really
 *      made before our next turn (under `default` that count is a forecast, so it is counted and not asserted). How many of the predicted really went is MEASURED and printed beside a null (the same number
 *      of free men with the highest classic FVM, which is how rivals call).
 *   5. THE P/D/C/A FILTER, once: every row it keeps carries the role.
 *   6. No exception in the console.
 *
 * Usage: node scripts/e2e-draft-classic.mjs --session PATH [--team ID] [--headed] [--shot PATH]
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

/** Everything a stop asserts, read in ONE evaluation so the parts cannot describe two different moments. */
function readStop() {
  const at = document.querySelector('[data-review-at]');
  const pitch = document.querySelector('[data-column="pitch"]');
  const places = [...document.querySelectorAll('[data-place]')];
  return {
    label: at?.innerText.trim() ?? null,
    clock: document.querySelector('[data-seat][data-clock]')?.getAttribute('data-seat') ?? null,
    seats: [...document.querySelectorAll('[data-seat]')].map((one) => ({
      id: Number(one.getAttribute('data-seat')),
      at: Number(one.getAttribute('data-at')),
      picks: Number(one.getAttribute('data-picks')),
      mine: one.hasAttribute('data-mine'),
    })),
    squad: Number(pitch?.getAttribute('data-squad') ?? NaN),
    filled: places.filter((one) => one.hasAttribute('data-filled')).length,
    reserves: document.querySelectorAll('[data-reserve]').length,
    unplaced: document.querySelectorAll('[data-unplaced]').length,
    rows: [...document.querySelectorAll('[data-free]')].map((one) => ({
      id: Number(one.getAttribute('data-free')),
      roles: (one.getAttribute('data-roles') ?? '').split(',').filter(Boolean),
      full: one.hasAttribute('data-full'),
      locked: one.hasAttribute('data-locked'),
      takenBy: one.getAttribute('data-taken-by') === null ? null : Number(one.getAttribute('data-taken-by')),
    })),
    takenText: document.querySelector('[data-only-taken]')?.innerText.trim() ?? null,
    ready: !!document.querySelector('[data-free]') && places.length > 0,
  };
}

// ------------------------------------------------------------------ the run

const listOf = (items) =>
  (Array.isArray(items) ? items : Object.values(items ?? {})).filter((one) => one != null);

async function main() {
  const path = value('--session', null);
  if (!path) throw new Error('serve --session PATH (il dump di una sessione, fuori dal repository)');
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build in ${DIST}: run "ng build" first`);
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const root = JSON.parse(await readFile(path, 'utf-8'));
  const state = root.state;
  const code = root.id ?? 'FA-tst-003';
  if (state?.settings?.game !== 1) throw new Error(`${code} is not a classic draft (game ${state?.settings?.game})`);
  const picks = listOf(state.picks).filter((one) => !one.released).sort((a, b) => a.index - b.index);
  const teams = listOf(state.teams);
  const me = Number(value('--team', String(teams.find((one) => one.connection?.host)?.id ?? teams[0].id)));
  const listone = listOf(root.env.playerList);
  const zone = new Map(listone.map((one) => [one.id, one.zone?.classic]));
  const fvm = new Map(listone.map((one) => [one.id, one.stats?.fmv?.classic ?? 0]));
  const quota = {
    gk: state.settings.roles.gk[1], def: state.settings.roles.def[1],
    mid: state.settings.roles.mid[1], atk: state.settings.roles.atk[1],
  };
  const total = picks.length;
  console.log(`${code}: ${teams.length} squadre, ${total} scelte, ordine ${state.pickOrderType}, seguo la squadra ${me}`);

  // The table as it stood after k picks, from the FIXTURE.
  const squadsAt = (k) => {
    const out = new Map(teams.map((one) => [one.id, { gk: 0, def: 0, mid: 0, atk: 0, n: 0 }]));
    for (const pick of picks.slice(0, k)) {
      const line = out.get(pick.teamId);
      line[zone.get(pick.playerId)] += 1;
      line.n += 1;
    }
    return out;
  };
  const takenAt = (k) => new Set(picks.slice(0, k).map((one) => one.playerId));
  const stops = picks.map((one, k) => (one.teamId === me ? k : -1)).filter((k) => k >= 0);

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-classic-'));
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
    for (const one of found.slice(0, 8)) console.log(`    ! ${one}`);
    if (found.length > 8) console.log(`    ! ... e altri ${found.length - 8}`);
    problems.push(...found.map((one) => `${step}: ${one}`));
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Runtime.enable');
    await session.send('Page.enable');

    const saved = JSON.stringify(JSON.stringify({ code, teamId: me }));
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        `try { localStorage.setItem('fantassistant.auction', ${saved}); } catch {}\n`
        + `(${fakeHost.toString()})(${JSON.stringify(code)}, ${JSON.stringify(state)}, ${JSON.stringify(root.env.playerList)});`,
    });
    await session.send('Page.navigate', { url });

    // The whole table first, and the sheet in: the list needs the engine columns before it means anything.
    let first = null;
    for (let i = 0; i < 100; i += 1) {
      first = await evaluate(session, readStop);
      if (first?.ready && first.label === `${total}/${total}`) break;
      await wait(200);
    }
    if (!first?.label) throw new Error(`the page never showed the review: ${JSON.stringify(first)?.slice(0, 200)}`);

    const press = async (selector) => {
      const box = await evaluate(session, boxOf, selector, '');
      if (!box) return `non trovo ${selector}`;
      if (!box.reachable) return `${selector} e' coperto`;
      await click(session, box);
      return null;
    };
    const settle = async (k) => {
      for (let i = 0; i < 80; i += 1) {
        const seen = await evaluate(session, readStop);
        if (seen?.label === `${k}/${total}` && seen.ready) {
          await wait(150);
          return evaluate(session, readStop);
        }
        await wait(120);
      }
      return evaluate(session, readStop);
    };

    let miss = await press('[data-review-start]');
    if (miss) throw new Error(miss);
    await settle(0);

    const bad = { order: [], squads: [], pitch: [], list: [], full: [], taken: [], quota: [] };
    const hits = { predicted: 0, went: 0, byTeam: 0, real: 0, nullWent: 0, stops: 0, orderMiss: 0 };
    let cursor = 0;
    let filterChecked = false;
    for (const k of stops) {
      while (cursor < k) {
        miss = await press('[data-review-forward]');
        if (miss) throw new Error(`scelta ${cursor}: ${miss}`);
        cursor += 1;
      }
      const seen = await settle(k);
      const where = `scelta ${k + 1}`;
      if (seen?.label !== `${k}/${total}`) {
        bad.order.push(`${where}: il cursore legge «${seen?.label}»`);
        continue;
      }
      const squads = squadsAt(k);
      const taken = takenAt(k);

      // 1. ORDER.
      if (Number(seen.clock) !== me) bad.order.push(`${where}: di turno la squadra ${seen.clock}, non la ${me}`);
      const next = [];
      for (const pick of picks.slice(k)) if (!next.includes(pick.teamId)) next.push(pick.teamId);
      const shown = [...seen.seats].sort((a, b) => a.at - b.at).map((one) => one.id).filter((id) => next.includes(id));
      if (shown.join(',') !== next.join(',')) bad.order.push(`${where}: ordine ${shown.join(',')} contro il vero ${next.join(',')}`);

      // 2. SQUADS and the pitch.
      for (const seat of seen.seats) {
        const held = squads.get(seat.id)?.n;
        if (seat.picks !== held) bad.squads.push(`${where}: la squadra ${seat.id} porta ${seat.picks} uomini, il tavolo ${held}`);
      }
      const mine = squads.get(me);
      if (seen.squad !== mine.n) bad.pitch.push(`${where}: il campetto dice ${seen.squad} in rosa, il tavolo ${mine.n}`);
      if (seen.filled + seen.reserves + seen.unplaced !== mine.n) {
        bad.pitch.push(`${where}: titolari ${seen.filled} + riserve ${seen.reserves} + senza posto ${seen.unplaced} contro ${mine.n} in rosa`);
      }

      // 3. THE LIST: nobody already taken, «pieno» exactly on our full lines.
      for (const row of seen.rows) {
        if (taken.has(row.id)) bad.list.push(`${where}: ${row.id} e' in lista ma e' gia' stato preso`);
        const z = zone.get(row.id);
        const full = !!z && mine[z] >= quota[z];
        if (row.full !== full) bad.full.push(`${where}: ${row.id} (${z}) «pieno» ${row.full ? 'acceso' : 'spento'} con ${mine[z]}/${quota[z]}`);
      }

      // 4. «PRIMA DI TE», one pick LATER: on our own turn the set is empty by definition (nobody calls before
      // us), so the prediction worth reading is the one right after our pick, until our next turn. Read on the
      // switch that shows ALL of them (the list itself loads 60 rows at a time).
      const until = stops.find((one) => one > k) ?? total;
      if (k + 1 < until) {
        miss = await press('[data-review-forward]');
        if (miss) throw new Error(`${where}: ${miss}`);
        cursor += 1;
        const after = await settle(k + 1);
        const takenNow = takenAt(k + 1);
        const squadsNow = squadsAt(k + 1);
        let predicted = [];
        let onlyTaken = null;
        if (after.takenText !== null) {
          miss = await press('[data-only-taken]');
          if (miss) throw new Error(`${where}: ${miss}`);
          await wait(250);
          onlyTaken = await evaluate(session, readStop);
          miss = await press('[data-only-taken]');
          if (miss) throw new Error(`${where}: ${miss}`);
          predicted = onlyTaken.rows.filter((row) => row.takenBy !== null);
          const said = Number(/\d+/.exec(onlyTaken.takenText ?? '')?.[0] ?? NaN);
          if (predicted.length !== onlyTaken.rows.length || predicted.length !== said) {
            bad.taken.push(`${where}: «${onlyTaken.takenText}» ma ${predicted.length} righe segnate su ${onlyTaken.rows.length}`);
          }
        } else {
          bad.taken.push(`${where}: nessuna previsione «prima di te» con ${until - k - 1} scelte altrui prima del nostro turno`);
        }
        const load = new Map([...squadsNow].map(([id, line]) => [id, { ...line }]));
        for (const row of predicted) {
          if (row.takenBy === me) bad.taken.push(`${where}: ${row.id} previsto per noi`);
          if (takenNow.has(row.id)) bad.taken.push(`${where}: ${row.id} previsto ma gia' preso`);
          const line = load.get(row.takenBy);
          const z = zone.get(row.id);
          if (!line || !z) continue;
          line[z] += 1;
          if (line[z] > quota[z]) bad.quota.push(`${where}: la squadra ${row.takenBy} prevista al ${line[z]}° ${z} su ${quota[z]} (${row.id})`);
        }
        const perTeam = new Map();
        for (const row of predicted) perTeam.set(row.takenBy, (perTeam.get(row.takenBy) ?? 0) + 1);
        const realPerTeam = new Map();
        for (const pick of picks.slice(k + 1, until)) realPerTeam.set(pick.teamId, (realPerTeam.get(pick.teamId) ?? 0) + 1);
        // WHO calls how many times before us is a RULE on a snake and a FORECAST under `default`, where the next
        // round's order depends on the prices of picks not made yet: asserted on the first, counted on the second.
        const offCount = [...realPerTeam].filter(([team, n]) => (perTeam.get(team) ?? 0) !== n);
        if (state.pickOrderType === 'pingpong') {
          for (const [team, n] of offCount) bad.taken.push(`${where}: la squadra ${team} chiama ${n} volte prima di noi, previste ${perTeam.get(team) ?? 0}`);
        } else if (offCount.length) hits.orderMiss += 1;
        // Measured, not asserted: the rivals' picks between ours and our next one, against «the dearest by FVM».
        const went = new Map(picks.slice(k + 1, until).map((one) => [one.playerId, one.teamId]));
        const free = [...fvm.keys()].filter((id) => !takenNow.has(id) && zone.get(id));
        const byPrice = free.sort((a, b) => fvm.get(b) - fvm.get(a)).slice(0, predicted.length);
        hits.stops += 1;
        hits.predicted += predicted.length;
        hits.real += went.size;
        hits.went += predicted.filter((row) => went.has(row.id)).length;
        hits.byTeam += predicted.filter((row) => went.get(row.id) === row.takenBy).length;
        hits.nullWent += byPrice.filter((id) => went.has(id)).length;
      }

      // 5. THE FILTER, once, a third of the way in.
      if (!filterChecked && k >= total / 3) {
        filterChecked = true;
        miss = await press('[data-role-filter="d"]');
        await wait(300);
        const filtered = await evaluate(session, readStop);
        await press('[data-role-filter="d"]');
        const off = filtered.rows.filter((row) => !row.roles.includes('d'));
        note('filtro D', miss ?? `${filtered.rows.length} righe tenute alla scelta ${k + 1}`, [
          ...(miss ? [miss] : []),
          ...(filtered.rows.length ? [] : ['il filtro D non tiene nessuna riga']),
          ...off.map((row) => `${row.id} tenuto con ruoli ${row.roles.join(',')}`),
        ]);
      }
    }

    note('ordine di chiamata', `${stops.length} turni guardati`, bad.order);
    note('rose', `${stops.length} x ${teams.length} squadre`, bad.squads);
    note('campetto', `${stops.length} turni`, bad.pitch);
    note('lista', 'nessun preso fra gli svincolati', bad.list);
    note('pieno', 'acceso solo sui reparti pieni', bad.full);
    note('prima di te', `${hits.predicted} previsioni su ${hits.stops} turni`, bad.taken);
    note('quote delle previsioni', 'nessun rivale oltre la quota', bad.quota);
    const pc = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
    console.log(`  misura: delle previsioni ne sono uscite davvero ${pc(hits.went, hits.predicted)}`
      + ` (${pc(hits.byTeam, hits.predicted)} dalla squadra prevista), contro ${pc(hits.nullWent, hits.predicted)}`
      + ` del null «i piu' cari per FVM»; ${hits.real} scelte vere nelle finestre`
      + (state.pickOrderType === 'pingpong' ? '' : `; chiamate per squadra sbagliate in ${hits.orderMiss} finestre su ${hits.stops}`));

    const shot = argv.indexOf('--shot');
    if (shot >= 0 && argv[shot + 1]) {
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
