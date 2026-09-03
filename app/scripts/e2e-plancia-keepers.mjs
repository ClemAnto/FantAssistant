/**
 * e2e-plancia-keepers.mjs - drive the REAL plancia and measure the keeper pairings.
 *
 * Everything this feature promises is a fact about the SCREEN. «Clicking a keeper opens the pairings
 * and puts nothing on the table» is two facts, and only a pointer arriving at the coordinates the
 * browser reports can prove either - a synthetic `element.click()` passes over the CSS and would say
 * yes to both even if an overlay covered the row (app/CLAUDE.md, measured 20/08/2026 on the table's
 * funnels). «Hovering a cell shows both calendars with a V on the easy matches» is an element that
 * only exists while the pointer is on it.
 *
 * It also checks the arithmetic AGAINST THE BUNDLE rather than against itself: the harness reads
 * `calendar.json` over the same HTTP server the app reads it from, recomputes what the top row should
 * say, and compares. A unit test proves the function; this proves the SCREEN is showing that function's
 * answer, which is the gap this project has paid for more than once.
 *
 * Zero dependencies, like the other harnesses: serves `dist/`, launches Edge or Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-plancia-keepers.mjs [--headed] [--json] [--shot]
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

/** A REAL pointer: hover first, then press and release where the browser says the target is. */
async function click(session, point) {
  const at = { x: Math.round(point.x), y: Math.round(point.y) };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'none' });
  await wait(60);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...at, button: 'left', clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...at, button: 'left', clickCount: 1,
  });
  await wait(300);
}

/** A REAL hover, and nothing else: a popover appears on the pointer, not on a click. */
async function hover(session, point) {
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(point.x), y: Math.round(point.y), button: 'none',
  });
  await wait(500);
}

/**
 * Click a target that has STOPPED MOVING. An antd modal enters with a zoom animation, so for ~200ms
 * its own buttons are somewhere else than where they were measured (app/CLAUDE.md, 27/08/2026).
 */
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
    under: under ? under.tagName.toLowerCase() : null,
    inside: found.contains(under) || under?.contains(found) || false,
  };
}

/** The board's keeper line: the first block of role P, its rows, and where each of them sits. */
function readKeeperRows() {
  const lines = [...document.querySelectorAll('plancia-slot-matrix > div > div')];
  const keepers = lines[0];
  if (!keepers) return null;
  const blocks = [...keepers.querySelectorAll('.grid > div')];
  const first = blocks[0];
  if (!first) return null;
  const rows = [...first.querySelectorAll('button')];
  return {
    blocks: blocks.length,
    rows: rows.map((row, at) => {
      const rect = row.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const under = document.elementFromPoint(x, y);
      return {
        at,
        name: (row.innerText ?? '').split('\n')[0].trim(),
        disabled: row.disabled,
        x, y,
        // «the row is there» is a fact about the DOM; this is a fact about the SCREEN.
        reachable: row.contains(under) || under === row,
      };
    }),
  };
}

/** What the lot card currently names, so «the click did NOT put him on the table» is measurable. */
function readLot() {
  const card = document.querySelector('plancia-lot-card');
  return (card?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** The pairing modal, parsed: its title, the three best, and the notes under them. */
function readPairs() {
  const modal = [...document.querySelectorAll('nz-modal-container')].find((one) =>
    (one.innerText ?? '').includes('Con chi accoppiare'));
  if (!modal) return null;
  const rect = modal.getBoundingClientRect();
  if (!rect.width) return null;
  const rows = [...modal.querySelectorAll('.border-primary\\/40')];
  const titleParts = [...modal.querySelectorAll('.ant-modal-title span')]
    .map((one) => (one.innerText ?? '').trim())
    .filter(Boolean);
  return {
    title: (modal.querySelector('.ant-modal-title')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    // The club of the keeper the modal is ABOUT, read from the screen rather than guessed from a name.
    mineClub: titleParts.at(-1) ?? null,
    text: modal.innerText.replace(/\s+/g, ' ').trim().slice(0, 700),
    best: rows.map((row) => {
      const cells = [...row.children].map((one) => (one.innerText ?? '').replace(/\s+/g, ' ').trim());
      return { rank: cells[0], name: cells[1], club: cells[2], facili: cells[3], covered: cells[4] };
    }),
    hasGridButton: [...modal.querySelectorAll('button')].some((one) =>
      (one.innerText ?? '').includes('mostra griglia')),
  };
}

/** The grid: its size, its headers, and whether the diagonal really is the club alone. */
function readGrid() {
  const modal = [...document.querySelectorAll('nz-modal-container')].find((one) =>
    (one.innerText ?? '').includes('Coppie di portieri'));
  const table = modal?.querySelector('table');
  if (!table) return null;
  const head = [...table.querySelectorAll('thead th')].slice(1);
  const body = [...table.querySelectorAll('tbody tr')];
  return {
    columns: head.length,
    rows: body.length,
    // Each column names the club AND the keeper the toolkit's board draws for it.
    headers: head.map((one) => (one.innerText ?? '').replace(/\s+/g, ' ').trim()),
    withKeeper: head.filter((one) => {
      const parts = (one.innerText ?? '').trim().split('\n').map((x) => x.trim()).filter(Boolean);
      return parts.length === 2 && parts[1] !== '—';
    }).length,
    cells: body.map((row) => ({
      club: (row.querySelector('th')?.innerText ?? '').trim(),
      values: [...row.querySelectorAll('td')].map((one) => Number(one.innerText.trim())),
    })),
    // Every cell has a real background, so the shading is not a dead `color-mix()` on a lost token.
    painted: [...table.querySelectorAll('tbody td')].filter((one) => {
      const bg = getComputedStyle(one).backgroundColor;
      return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    }).length,
    total: table.querySelectorAll('tbody td').length,
  };
}

/**
 * THE HIGHLIGHTED HEADERS, read as COMPUTED values and not as class names.
 *
 * `[class.bg-primary]` on an element that already carries `bg-surface` is two utilities on one
 * property in one layer, and which of them paints is decided by the order they appear in the
 * generated CSS - not by which one is bound. This project has already paid for that once
 * (app/CLAUDE.md, 27/08/2026): a rule that does not paint keeps the build green.
 */
function readHighlight(club) {
  const modal = [...document.querySelectorAll('nz-modal-container')].find((one) =>
    (one.innerText ?? '').includes('Coppie di portieri'));
  const table = modal?.querySelector('table');
  if (!table) return null;
  const heads = [...table.querySelectorAll('thead th')].slice(1);
  const rowHeads = [...table.querySelectorAll('tbody th')];
  const pick = (list) => list.find((one) => (one.innerText ?? '').trim().startsWith(club));
  const read = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, colour: style.color };
  };
  const plain = read(heads.find((one) => !(one.innerText ?? '').trim().startsWith(club)));
  return { column: read(pick(heads)), row: read(pick(rowHeads)), plain };
}

/** Where a given cell of the grid is, so the pointer can be sent to it. */
function cellAt(rowIndex, columnIndex) {
  const modal = [...document.querySelectorAll('nz-modal-container')].find((one) =>
    (one.innerText ?? '').includes('Coppie di portieri'));
  const row = modal?.querySelectorAll('tbody tr')[rowIndex];
  const cell = row?.querySelectorAll('td')[columnIndex];
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    value: Number(cell.innerText.trim()),
    row: (row.querySelector('th')?.innerText ?? '').trim(),
  };
}

/** The popover the hover opened: how many matchdays it lists and how many carry the V. */
function readPopover() {
  const popover = document.querySelector('nz-popover-component .ant-popover-inner, .ant-popover-inner');
  if (!popover) return null;
  const rect = popover.getBoundingClientRect();
  if (!rect.width) return null;
  const rows = [...popover.querySelectorAll('tbody tr')];
  return {
    title: (popover.querySelector('.ant-popover-title')?.innerText ?? '').trim(),
    columns: popover.querySelectorAll('thead th').length,
    rows: rows.length,
    ticks: rows.filter((one) => (one.lastElementChild?.innerText ?? '').trim() === 'V').length,
    sample: rows.slice(0, 3).map((one) =>
      [...one.children].map((cell) => (cell.innerText ?? '').trim()).join(' | ')),
  };
}

function modalCount() {
  return [...document.querySelectorAll('nz-modal-container')].filter(
    (one) => one.getBoundingClientRect().width > 0).length;
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-keepers-'));
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
    console.log(`· ${step}: ${detail.said ?? ''}`);
    for (const problem of detail.problems ?? []) console.log(`    ⚠ ${problem}`);
    if (detail.problems?.length) report.problems.push(...detail.problems.map((one) => `${step}: ${one}`));
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await wait(1500);

    // 0. THE BUNDLE the page is reading, so the arithmetic below is checked against ITS numbers and
    //    not against a copy of them. A harness that recomputes from its own fixture proves nothing
    //    about the screen.
    const calendar = await (await fetch(`http://127.0.0.1:${port}/data/calendar.json`)).json();
    const serieA = calendar.leagues?.serie_a;
    note('il calendario nel bundle', {
      said: `${Object.keys(calendar.leagues ?? {}).length} campionati · serie_a `
        + `${serieA?.matches?.length ?? 0} partite, ${serieA?.clubs?.length ?? 0} club, `
        + `margine ${calendar.easy_margin} = P(porta inviolata) ${calendar.clean_sheet?.at_margin}`,
      problems: [
        ...(serieA ? [] : ['il bundle non porta il calendario di serie_a: non c’è niente da misurare']),
        ...(calendar.clean_sheet?.at_margin > 0.39 && calendar.clean_sheet?.at_margin < 0.41
          ? [] : [`il margine congelato non vale più 0.40 di porta inviolata (${calendar.clean_sheet?.at_margin})`]),
      ],
    });

    // 1. THE BOARD is up, and the keeper rows are REACHABLE - a fact about the screen, not the DOM.
    const board = await waitFor(session, readKeeperRows, 80);
    const reachable = (board?.rows ?? []).filter((one) => one.reachable).length;
    note('la linea dei portieri', {
      said: `${board?.blocks ?? 0} blocchi · ${board?.rows?.length ?? 0} righe nel primo, `
        + `${reachable} raggiungibili col puntatore, ${board?.rows?.filter((o) => o.disabled).length ?? 0} disabilitate`,
      problems: [
        ...(board?.rows?.length ? [] : ['nessuna riga di portiere sulla plancia']),
        ...(reachable === (board?.rows?.length ?? 0)
          ? [] : [`${(board?.rows?.length ?? 0) - reachable} righe di portiere hanno qualcosa sopra`]),
        // Un portiere già di qualcuno resta cliccabile: «con chi lo accoppio» ha senso anche su di lui.
        ...(board?.rows?.some((one) => one.disabled)
          ? ['una riga di portiere è disabilitata: la domanda sull’accoppiamento vale anche sui presi'] : []),
      ],
    });

    // 2. THE CLICK: it opens the pairings, and it does NOT put the man on the table. Two facts, and
    //    the second is the operator's own instruction of 03/09/2026 - so it is asserted, not assumed.
    const lotBefore = await evaluate(session, readLot);
    const target = board?.rows?.[0];
    if (target) await click(session, target);
    const pairs = await waitFor(session, readPairs, 40);
    const lotAfter = await evaluate(session, readLot);
    note('il click su un portiere', {
      said: `«${target?.name}» → modale «${pairs?.title ?? 'nessuna'}» · `
        + `il lotto era «${lotBefore.slice(0, 40)}…» ed è «${lotAfter.slice(0, 40)}…»`,
      problems: [
        ...(pairs ? [] : ['il click su un portiere non ha aperto gli accoppiamenti']),
        ...(lotAfter === lotBefore
          ? [] : ['il click ha ANCHE messo il portiere in asta: non è un comportamento richiesto']),
        ...(pairs?.title?.includes(target?.name ?? '\u0000')
          ? [] : [`la modale non nomina il portiere cliccato (${pairs?.title})`]),
      ],
    });

    // 3. THE THREE, and their arithmetic against the bundle. The count is the operator's own rule and
    //    the expectation breaks its ties, so BOTH have to be on the row and both have to be right.
    const window = /giornate (\d+)[–-](\d+)/i.exec(pairs?.text ?? '');
    const from = Number(window?.[1] ?? 0);
    const to = Number(window?.[2] ?? 0);
    const expected = expectedFor(calendar, pairs?.mineClub, pairs?.best?.[0]?.club, from, to);
    note('i tre migliori', {
      said: (pairs?.best ?? []).map((one) =>
        `${one.rank}. ${one.name} (${one.club}) ${one.facili} / ${one.covered}`).join(' · ')
        + ` — finestra ${from}–${to}`,
      problems: [
        ...(pairs?.best?.length === 3 ? [] : [`${pairs?.best?.length ?? 0} migliori invece di 3`]),
        ...(from > 0 && to > from ? [] : ['la modale non dichiara la finestra della competizione']),
        ...(pairs?.best?.every((one) => /^\d+/.test(one.facili))
          ? [] : ['una riga non porta il numero di giornate facili']),
        ...expected.problems,
        // ...AND the number is compared, not merely printed beside the screen's. An audit that
        // computes an expectation and never asserts it answers «0 problems» after looking at nothing.
        ...(expected.expected == null || expected.expected === parseInt(pairs?.best?.[0]?.facili, 10)
          ? []
          : [`la coppia in cima dice ${pairs?.best?.[0]?.facili} giornate facili, il calendario ne ha `
             + `${expected.expected}`]),
      ],
      checked: expected.said,
    });
    if (expected.said) console.log(`    ↳ ${expected.said}`);

    // ...and its own picture, taken BEFORE the grid covers it: two windows, two screenshots, or the
    // second one is the only thing anybody ever sees of this feature.
    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'dist', 'e2e-plancia-keepers-pairs.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      console.log(`· screenshot: ${where}`);
      report.screenshotPairs = where;
    }

    // 4. THE GRID opens on the button, and it is a real table with both axes.
    const gridButton = await clickSteady(session, 'button', 'mostra griglia');
    const grid = await waitFor(session, readGrid, 40);
    const square = (grid?.rows ?? 0) === (grid?.columns ?? 0);
    const diagonalOk = (grid?.cells ?? []).every((row, at) => {
      const own = row.values[at];
      // A club paired with anybody covers at least what it covers alone: the diagonal is the floor
      // of its own row, and a diagonal that is not would mean the pair is losing matchdays.
      return own != null && row.values.every((one) => one >= own);
    });
    note('la griglia', {
      said: `${grid?.rows ?? 0}x${grid?.columns ?? 0} · ${grid?.withKeeper ?? 0} colonne col portiere `
        + `titolare · ${grid?.painted ?? 0}/${grid?.total ?? 0} caselle con uno sfondo dipinto`,
      problems: [
        ...(gridButton ? [] : ['il bottone «mostra griglia» non c’è']),
        ...(grid ? [] : ['la griglia non si è aperta']),
        ...(square ? [] : ['la griglia non è quadrata: righe e colonne devono essere le stesse squadre']),
        ...(grid && grid.withKeeper === grid.columns
          ? [] : [`${(grid?.columns ?? 0) - (grid?.withKeeper ?? 0)} colonne senza il nome del portiere`]),
        ...(diagonalOk ? [] : ['una coppia copre MENO del club da solo: la diagonale non è il pavimento della sua riga']),
        // Una casella senza sfondo è un `color-mix()` su un token perduto: il build resta verde.
        ...(grid && grid.painted === grid.total
          ? [] : [`${(grid?.total ?? 0) - (grid?.painted ?? 0)} caselle senza sfondo dipinto`]),
      ],
    });

    // 4b. THE MARK on the keeper's own row and column, measured and not assumed: two background
    //     utilities on one element are decided by the generated CSS order, never by the binding.
    const mark = await evaluate(session, readHighlight, pairs?.mineClub ?? '');
    note('la riga e la colonna del suo club', {
      said: `colonna ${mark?.column?.background} su ${mark?.column?.colour} · `
        + `riga ${mark?.row?.background} · una qualsiasi ${mark?.plain?.background}`,
      problems: [
        ...(mark?.column && mark.plain && mark.column.background !== mark.plain.background
          ? [] : ['la colonna del suo club è dipinta come tutte le altre: il segno non arriva a schermo']),
        ...(mark?.row && mark.plain && mark.row.background !== mark.plain.background
          ? [] : ['la riga del suo club è dipinta come tutte le altre']),
        ...(mark?.column && contrast(mark.column.background, mark.column.colour) >= 4.5
          ? [] : [`il testo della colonna marcata ha contrasto `
                  + `${contrast(mark?.column?.background, mark?.column?.colour).toFixed(2)}:1, sotto 4.5`]),
        ...(mark?.row && contrast(mark.row.background, mark.row.colour) >= 4.5
          ? [] : [`il testo della riga marcata ha contrasto `
                  + `${contrast(mark?.row?.background, mark?.row?.colour).toFixed(2)}:1, sotto 4.5`]),
      ],
    });

    // 5. THE POPOVER, which exists only while the pointer is on the cell. A cell OFF the diagonal, so
    //    it must list two calendars and not one.
    const cell = await evaluate(session, cellAt, 0, 1);
    if (cell) await hover(session, cell);
    const popover = await waitFor(session, readPopover, 20);
    note('il popover di una casella', {
      said: `«${popover?.title ?? '—'}» · ${popover?.rows ?? 0} giornate, ${popover?.ticks ?? 0} con la V, `
        + `${popover?.columns ?? 0} colonne · es. ${(popover?.sample ?? []).join(' // ')}`,
      problems: [
        ...(popover ? [] : ['passando sopra una casella non compare nessun popover']),
        ...(popover?.rows ? [] : ['il popover non elenca nessuna partita']),
        // Fuori diagonale sono DUE squadre: giornata, la prima, la seconda, la V.
        ...(popover?.columns === 4
          ? [] : [`il popover ha ${popover?.columns} colonne invece delle 4 di una coppia`]),
        ...(popover && popover.ticks === cell?.value
          ? [] : [`le V nel popover (${popover?.ticks}) non sono il numero della casella (${cell?.value})`]),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = value('--shot-to', join(ROOT, 'dist', 'e2e-plancia-keepers.png'));
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      console.log(`· screenshot: ${where}`);
      report.screenshot = where;
    }

    // 6. Nothing left open behind us, and nothing the page shouted.
    const noise = session.noise();
    note('la console', { said: noise.length ? noise.join(' | ') : 'niente', problems: noise });
    note('le finestre aperte', {
      said: `${await evaluate(session, modalCount)} modali visibili`,
      problems: [],
    });
  } finally {
    session?.close();
    if (process.platform === 'win32' && browser.pid) {
      spawn('taskkill', ['/pid', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      browser.kill();
    }
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

/**
 * WHAT THE TOP ROW SHOULD SAY, recomputed from the bundle the page is reading.
 *
 * Runs in the harness and not in the page, deliberately: computing it inside would be asking the app to
 * check itself with its own function, which cannot fail. This is a second implementation of the same
 * sentence - «matchdays where at least one of the two clears the margin» - and if the two disagree, one
 * of them is wrong and the run says so.
 */
function expectedFor(calendar, mineName, club, from, to) {
  const league = calendar.leagues?.serie_a;
  if (!league || !club || !from) return { problems: [], said: null };
  const nameOf = new Map(league.clubs.map((one) => [one.key, one.name]));
  const keyOf = new Map(league.clubs.map((one) => [one.name, one.key]));
  const theirs = keyOf.get(club);
  if (!theirs) return { problems: [`il club «${club}» non è nel calendario`], said: null };

  const easyByRound = (key) => {
    const out = new Map();
    for (const [round, , home, away, edge] of league.matches) {
      if (round < from || round > to) continue;
      if (home === key) out.set(round, edge != null && edge > calendar.easy_margin);
      if (away === key) out.set(round, edge != null && -edge > calendar.easy_margin);
    }
    return out;
  };
  const mineKey = mineName ? keyOf.get(mineName) : null;
  const a = mineKey ? easyByRound(mineKey) : null;
  const b = easyByRound(theirs);
  if (!a) {
    // Without the clicked keeper's own club we can still check the CANDIDATE's half, which is what
    // makes a zero on the screen suspicious. Reporting what was checked, never claiming more.
    const alone = [...b.values()].filter(Boolean).length;
    return {
      problems: [],
      said: `${nameOf.get(theirs)} da solo ha ${alone} giornate facili fra la ${from} e la ${to}`,
    };
  }
  const rounds = new Set([...a.keys(), ...b.keys()]);
  const facili = [...rounds].filter((round) => a.get(round) || b.get(round)).length;
  return { expected: facili, said: `atteso ${facili} per la coppia in cima`, problems: [] };
}

/** WCAG contrast of two `rgb()` strings. A colour pair is measured, never looked at. */
function contrast(background, colour) {
  const parse = (raw) => (String(raw).match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((one) => {
      const channel = one / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const one = parse(background);
  const two = parse(colour);
  if (one.length < 3 || two.length < 3) return 0;
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

await main();
