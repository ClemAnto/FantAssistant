/**
 * e2e-plancia-award.mjs - drive the REAL plancia and measure the two gestures that write the rosters.
 *
 * «Azzera le rose» and «doppio click su una rosa = il lotto e' suo» (operatore, 04/09/2026) are facts
 * about the SCREEN, and a double click is a GESTURE: only a pointer arriving at the coordinates the
 * browser reports can say whether it lands, because `element.dispatchEvent` passes over the CSS and
 * would answer yes even with an overlay on the card (app/CLAUDE.md, measured 20/08/2026 on the table's
 * funnels). What it checks is what the two gestures PROMISE - full purses and every name back in the
 * urn after the reset; after the award, the credits down by the price WRITTEN on the lot, one place
 * fewer in the lot's own role, and an empty lot - plus the refusal, which has to SAY why.
 *
 * And the third instruction of the same evening, which is an ABSENCE and gets measured like anything
 * else: no native `title` on the board's rows.
 *
 * Zero dependencies, like the other harnesses: serves `dist/`, launches Edge or Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-plancia-award.mjs [--headed] [--json] [--shot]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
      noise.push(`ECCEZIONE: ${detail?.exception?.description ?? detail?.text ?? '?'}`.slice(0, 300));
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      noise.push(`CONSOLE: ${message.params.args.map((one) => one.description ?? one.value).join(' ')}`
        .slice(0, 300));
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
      type: 'mousePressed', ...at, button: 'left', clickCount: n,
    });
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', ...at, button: 'left', clickCount: n,
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
    if (last && Math.round(last.x) === Math.round(box.x) && Math.round(last.y) === Math.round(box.y)) {
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

// ------------------------------------------------------------------ what runs IN the page

/** Where a control really is, by its visible text - and WHO is under that point. */
function boxOf(selector, text) {
  const found = [...document.querySelectorAll(selector)].find(
    (one) => (one.innerText ?? '').trim().toLowerCase().includes(text.toLowerCase()),
  );
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const under = document.elementFromPoint(x, y);
  return {
    x, y,
    text: (found.innerText ?? '').trim().slice(0, 40),
    // «the control is there» is a fact about the DOM; this is a fact about the SCREEN.
    reachable: found.contains(under) || under?.contains(found) || false,
  };
}

/** THE TEN CARDS: label, credits, the four places still to fill, and where each card is. */
function readTeams() {
  const cards = [...document.querySelectorAll('plancia-team-grid > div > div')];
  if (!cards.length) return null;
  return cards.map((card) => {
    const rect = card.getBoundingClientRect();
    const under = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      label: (card.querySelectorAll('span')[1]?.innerText ?? '').trim(),
      credits: Number((card.querySelector('.text-lg')?.innerText ?? '').replace(/[^0-9]/g, '')),
      missing: [...card.querySelectorAll('.ml-auto span')].map((one) => Number(one.innerText)),
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      reachable: card.contains(under) || under === card,
    };
  });
}

/** The header's own progress, per role: how many places of each are already assigned. */
function readProgress() {
  const chips = [...document.querySelectorAll('header span.tabular-nums')]
    .map((one) => (one.innerText ?? '').trim())
    .filter((text) => /^[PDCA] [0-9]+\/[0-9]+$/.test(text));
  return chips.length ? chips : null;
}

/** The lot on the table, and the price field beside it. */
function readLot() {
  const card = document.querySelector('plancia-lot-card');
  const input = card?.querySelector('input');
  const rect = input?.getBoundingClientRect();
  return {
    name: (card?.querySelector('.truncate')?.innerText ?? '').trim(),
    price: input ? input.value : null,
    priceAt:
      rect && rect.width
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : null,
  };
}

/** The board's rows: how many carry an owner's colour bar, how many carry a native `title`. */
function readRows(name) {
  const painted = (row) => {
    const bar = row?.querySelector('span');
    const paint = bar ? getComputedStyle(bar).backgroundColor : '';
    return !!paint && paint !== 'transparent' && !paint.startsWith('rgba(0, 0, 0, 0');
  };
  const rows = [...document.querySelectorAll('plancia-slot-matrix button')];
  const named = name
    ? rows.find((row) => (row.innerText ?? '').split('\n')[0].trim() === name)
    : null;
  return {
    rows: rows.length,
    owned: rows.filter(painted).length,
    titles: rows.filter((row) => row.hasAttribute('title')).length,
    man: named ? { owned: painted(named) } : null,
  };
}

/** What the page SAYS when it refuses. A refusal nobody can read is indistinguishable from a bug. */
function readAlert() {
  const alert = document.querySelector('nz-alert');
  return alert ? (alert.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 220) : null;
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run "ng build" first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-award-'));
  const debugPort = Number(value('--port', String(await freePort())));
  const url = `http://127.0.0.1:${port}/plancia`;
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1000',
    url,
  ], { stdio: 'ignore' });

  const report = { url, steps: [], problems: [] };
  const note = (step, detail) => {
    report.steps.push({ step, ...detail });
    console.log(`. ${step}: ${detail.said ?? ''}`);
    for (const problem of detail.problems ?? []) console.log(`    ! ${problem}`);
    if (detail.problems?.length) {
      report.problems.push(...detail.problems.map((one) => `${step}: ${one}`));
    }
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await wait(1500);

    // 1. THE INVENTED TABLE ARRIVES ALREADY PLAYED, which is the reason the reset exists - so it is
    //    measured BEFORE the button is pressed: a reset of an empty table would prove nothing.
    const before = await waitFor(session, readTeams, 80);
    const spent = (before ?? []).filter((one) => one.credits < 1000).length;
    note('il tavolo prima', {
      said: `${before?.length ?? 0} rose · ${spent} hanno gia' speso · `
        + `${(before ?? []).filter((one) => one.reachable).length} card raggiungibili col puntatore`,
      problems: [
        ...(before?.length === 10 ? [] : [`le rose a schermo sono ${before?.length ?? 0} e non dieci`]),
        ...(spent > 0
          ? []
          : ["nessuna rosa ha speso: il tavolo finto non e' partito giocato, e l'azzeramento non proverebbe niente"]),
        ...((before ?? []).every((one) => one.reachable)
          ? []
          : ['una card di rosa ha qualcosa sopra: il doppio click non ci arriverebbe']),
      ],
    });

    // 2. AZZERA LE ROSE, and the confirmation is a second real pointer.
    const reset = await evaluate(session, boxOf, 'header button', 'azzera le rose');
    if (reset) await click(session, reset);
    const confirmed = await clickSteady(session, '.ant-popover button', 'Azzera');
    await wait(400);
    const after = await evaluate(session, readTeams);
    const progress = await evaluate(session, readProgress);
    const board = await evaluate(session, readRows, null);
    const rich = (after ?? []).filter((one) => one.credits === 1000).length;
    note('azzera le rose', {
      said: `tasto ${reset ? 'presente' : 'ASSENTE'} · conferma ${confirmed ? 'premuta' : 'MAI apparsa'} · `
        + `${rich}/10 rose a 1000 cr · avanzamento ${progress?.join(' ') ?? '?'} · `
        + `${board?.owned ?? '?'} righe con un proprietario`,
      problems: [
        ...(reset ? [] : ["non c'e' nessun tasto «azzera le rose» in barra"]),
        ...(reset && !reset.reachable ? ['il tasto «azzera le rose» ha qualcosa sopra'] : []),
        ...(confirmed ? [] : ["la conferma non e' comparsa: il tasto azzererebbe senza chiedere"]),
        ...(rich === 10
          ? []
          : ["dopo l'azzeramento qualche rosa ha ancora speso: "
             + (after ?? []).filter((o) => o.credits !== 1000).map((o) => `${o.label} ${o.credits}`).join(', ')]),
        ...((after ?? []).every((one) => String(one.missing) === '3,8,8,6')
          ? []
          : ["dopo l'azzeramento qualche rosa ha ancora dei posti occupati: "
             + (after ?? []).filter((o) => String(o.missing) !== '3,8,8,6').map((o) => `${o.label} ${o.missing}`).join(', ')]),
        ...((progress ?? []).every((chip) => chip.includes(' 0/'))
          ? []
          : [`l'avanzamento non e' tornato a zero: ${progress?.join(' ')}`]),
        ...(board?.owned === 0
          ? []
          : [`${board?.owned} righe della plancia hanno ancora la barra di un proprietario`]),
      ],
    });

    // 3. THE NATIVE TOOLTIP IS GONE («da' fastidio»). An absence is measured like anything else.
    note('nessun tooltip nativo sulle righe', {
      said: `${board?.titles ?? '?'} attributi title su ${board?.rows ?? '?'} righe`,
      problems: board?.titles ? [`${board.titles} righe portano ancora un title nativo`] : [],
    });

    // 4. A NAME ON THE TABLE, and the refusal FIRST: at price zero nothing may be bought, and the
    //    page has to say why - a mute refusal reads exactly like a broken gesture.
    await clickSteady(session, 'header button', 'estrai');
    await wait(300);
    const lot = await waitFor(session, readLot, 20);
    const seated = await evaluate(session, readTeams);
    if (seated?.[1]) await click(session, seated[1], 2);
    const refused = await evaluate(session, readAlert);
    const stillRich = (await evaluate(session, readTeams))?.[1]?.credits;
    note('doppio click a prezzo zero', {
      said: `lotto «${lot?.name ?? '?'}» a ${lot?.price ?? '?'} · l'avviso dice «${(refused ?? '—').slice(0, 90)}»`,
      problems: [
        ...(lot?.name ? [] : ['«estrai» non ha messo nessun nome sul tavolo']),
        ...(refused
          ? []
          : ["il doppio click a prezzo zero non ha detto niente: un rifiuto muto e' indistinguibile da un gesto rotto"]),
        ...(stillRich === 1000 ? [] : ['a prezzo zero la rosa ha comprato lo stesso']),
      ],
    });

    // 5. THE PRICE, and its coordinates are read AGAIN here on purpose: the refused double click put
    //    an alert in the page, which pushes the lot row down - clicking where the field WAS is how a
    //    harness invents a defect the app does not have. Its own step, so «the price did not get in»
    //    and «the award did not happen» cannot be attributed to one another.
    const field = await evaluate(session, readLot);
    if (field?.priceAt) {
      await click(session, field.priceAt);
      await session.send('Input.insertText', { text: '45' });
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      });
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      });
      await wait(300);
    }
    const priced = await evaluate(session, readLot);
    const paid = Number(String(priced?.price ?? '0').replace(/[^0-9]/g, ''));
    note('scrivo il prezzo sul lotto', {
      said: `il campo legge ${priced?.price ?? '?'}`,
      problems: paid === 45 ? [] : [`ho digitato 45 e il campo legge ${priced?.price ?? 'niente'}`],
    });

    const buyer = (await evaluate(session, readTeams))?.[1];
    if (buyer) await click(session, buyer, 2);
    await wait(400);
    const sold = (await evaluate(session, readTeams))?.[1];
    const rows = await evaluate(session, readRows, lot?.name ?? null);
    const emptied = await evaluate(session, readLot);
    const took = buyer && sold ? buyer.credits - sold.credits : null;
    const places = buyer && sold
      ? buyer.missing.map((left, at) => left - sold.missing[at]).filter((gap) => gap === 1).length
      : 0;
    note("doppio click = il lotto e' suo", {
      said: `${buyer?.label ?? '?'} paga ${took} crediti (prezzo scritto ${paid}) · ${places} posto in meno · `
        + `lotto dopo «${emptied?.name || 'vuoto'}» · ${rows?.owned ?? 0} righe con proprietario`,
      problems: [
        ...(took === paid ? [] : [`la rosa ha perso ${took} crediti invece dei ${paid} scritti sul lotto`]),
        ...(places === 1 ? [] : ["il posto occupato non e' uno solo, o non e' nel ruolo del lotto"]),
        ...(emptied?.name ? [`dopo l'assegnazione il lotto nomina ancora «${emptied.name}»`] : []),
        ...(rows?.man?.owned ? [] : ["la riga dell'uomo assegnato non porta la barra del proprietario"]),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'plancia-award.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      report.screenshot = where;
      console.log(`  screenshot: ${where}`);
    }

    const noise = session.noise();
    if (noise.length) note('la console della pagina', { said: `${noise.length} righe`, problems: noise });
  } finally {
    session?.close();
    browser.kill();
    server.close();
  }

  if (flag('--json')) console.log(JSON.stringify(report, null, 2));
  console.log(
    report.problems.length
      ? `\n${report.problems.length} problemi:\n- ${report.problems.join('\n- ')}`
      : '\nnessun problema',
  );
  process.exitCode = report.problems.length ? 1 : 0;
}

await main();
