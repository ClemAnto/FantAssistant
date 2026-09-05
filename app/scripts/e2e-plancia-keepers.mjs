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
    // READ BY LABEL AND NOT BY POSITION. The row grew a column («quante ne ha da solo») and this
    // probe, which indexed `cells[3]`, started reporting «la coppia in cima dice 22 solo giornate
    // facili» - a sentence that means nothing, i.e. the instrument accusing the page of its own
    // defect. Every figure on that row carries its own word next to it, so the word is the key.
    best: rows.map((row) => {
      const cells = [...row.children].map((one) => (one.innerText ?? '').replace(/\s+/g, ' ').trim());
      const numbered = (word) => {
        const found = cells.find((one) => one.toLowerCase().includes(word));
        return found ? (found.match(/[-+]?[\d.,]+/) ?? [null])[0] : null;
      };
      const plain = cells.filter((one) => !/facili|aggiunte|coperte|solo/i.test(one));
      return {
        rank: plain[0],
        name: plain[1],
        club: plain[2],
        facili: numbered('facili'),
        alone: numbered('solo'),
        gain: numbered('aggiunte'),
        covered: numbered('coperte'),
      };
    }),
    hasGridButton: [...modal.querySelectorAll('button')].some((one) =>
      (one.innerText ?? '').includes('mostra griglia')),
  };
}

/**
 * The grid: its size, its headers, whether the diagonal is EMPTY, and whether it fits its modal.
 *
 * «Non sfonda orizzontalmente» is a fact about two numbers the browser reports and nothing else can
 * substitute for: the scroll box's own `scrollWidth` against its `clientWidth` (does the table need
 * more room than the box gives it) and the modal's width against the viewport (has the modal itself
 * grown past the window). A cell count says nothing about either.
 */
function readGrid() {
  const modal = [...document.querySelectorAll('nz-modal-container')].find((one) =>
    (one.innerText ?? '').includes('Coppie di portieri'));
  const table = modal?.querySelector('table');
  if (!table) return null;
  const head = [...table.querySelectorAll('thead th')].slice(1);
  const body = [...table.querySelectorAll('tbody tr')];
  const box = table.closest('.overflow-auto');
  const dialog = modal.querySelector('.ant-modal');
  return {
    columns: head.length,
    rows: body.length,
    // Does the table need more width than its box has, and has the modal outgrown the window?
    boxScroll: box ? box.scrollWidth : null,
    boxWidth: box ? box.clientWidth : null,
    tableWidth: Math.round(table.getBoundingClientRect().width),
    modalWidth: dialog ? Math.round(dialog.getBoundingClientRect().width) : null,
    viewport: window.innerWidth,
    // Vertically: where the dialog starts and ends against the window. A modal that runs off the
    // bottom is measured here and nowhere else - no count of cells can see it.
    modalTop: dialog ? Math.round(dialog.getBoundingClientRect().top) : null,
    modalBottom: dialog ? Math.round(dialog.getBoundingClientRect().bottom) : null,
    viewportHeight: window.innerHeight,
    // How many lines of prose sit above the table: he asked for one, and a paragraph that creeps back
    // is what pushes the table off the screen again.
    noteHeight: (() => {
      const note = modal.querySelector('p');
      return note ? Math.round(note.getBoundingClientRect().height) : null;
    })(),
    // The diagonal: nothing written in it, and the club-alone figure moved to the row's own header.
    diagonalText: body.map((row, at) =>
      ([...row.querySelectorAll('td')][at]?.innerText ?? '').trim()).join(''),
    aloneOnHeader: body.filter((row) =>
      /\d/.test((row.querySelector('th')?.innerText ?? ''))).length,
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
    // The diagonal is EXPECTED to have none of ours: it is not a pair, so it is not painted either.
    painted: [...table.querySelectorAll('tbody td')].filter((one) => {
      const bg = getComputedStyle(one).backgroundColor;
      return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    }).length,
    total: table.querySelectorAll('tbody td').length,
    // THE TINTS, counted: «sembra tutto verde e non risalta niente» is a fact about how many distinct
    // colours reach the screen and how the cells are spread over them - a cell count cannot see it.
    tints: (() => {
      const seen = new Map();
      for (const cell of table.querySelectorAll('tbody td')) {
        const style = getComputedStyle(cell);
        const bg = style.backgroundColor;
        // The TEXT on each tint travels with it: a scale whose darkest class cannot be read is a
        // scale that hid the number, and the number is what makes the colour checkable.
        const found = seen.get(bg) ?? { count: 0, colour: style.color };
        found.count += 1;
        seen.set(bg, found);
      }
      return [...seen.entries()].map(([background, one]) => ({
        background, colour: one.colour, count: one.count,
      }));
    })(),
    legend: [...(modal.querySelectorAll('p span span') ?? [])]
      .map((one) => getComputedStyle(one).backgroundColor)
      .filter((one) => one && one !== 'rgba(0, 0, 0, 0)').length,
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
  // The headers DRAW three letters and DECLARE the club in `title` - so the club is read from the
  // declaration and not from the label. Matching on the drawn text found nothing once the cells were
  // narrowed, which reads exactly like a highlight that stopped painting: two different defects.
  const pick = (list) => list.find((one) => (one.getAttribute('title') ?? '').startsWith(club));
  const read = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, colour: style.color };
  };
  const plain = read(heads.find((one) => !(one.getAttribute('title') ?? '').startsWith(club)));
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

/**
 * The popover the hover opened: the matchdays, the CHECK ICONS, and which club each column is about.
 *
 * Three things are measured here that a count of rows cannot see. The mark is an ICON now and not the
 * letter V, so it is counted as `.anticon-check` - counting text would read zero and blame the rule.
 * The column headers carry their club's full name in `title`, which is what lets the caller check the
 * attribution against the bundle: the cell is shared with its mirror, so below the diagonal `a` and
 * `b` are NOT the row and the column, and the operator saw one club's fixtures under the other's name.
 * And `scrollWidth` against `clientWidth` says whether this list can be read without dragging it
 * sideways, which is the other thing he asked for.
 */
function readPopover() {
  const popover = document.querySelector('nz-popover-component .ant-popover-inner, .ant-popover-inner');
  if (!popover) return null;
  const rect = popover.getBoundingClientRect();
  if (!rect.width) return null;
  const rows = [...popover.querySelectorAll('tbody tr')];
  const box = popover.querySelector('.overflow-y-auto') ?? popover;
  const heads = [...popover.querySelectorAll('thead th')];
  return {
    title: (popover.querySelector('.ant-popover-title')?.innerText ?? '').trim(),
    columns: heads.length,
    // The two middle headers, by the full name they declare - not by the three letters they draw.
    clubs: heads.slice(1, 3).map((one) => one.getAttribute('title')),
    rows: rows.length,
    ticks: rows.filter((one) => one.querySelector('.anticon-check')).length,
    // Which matches are marked easy, per column, and the matchday they sit on: his own rule is
    // «evidenzia solo le partite facili», so the marks are read one by one and not as a total.
    marked: rows.map((one) => {
      const cells = [...one.children];
      return {
        round: Number((cells[0]?.innerText ?? '').trim()),
        a: (cells[1]?.innerText ?? '').trim(),
        b: (cells[2]?.innerText ?? '').trim(),
        easyA: Boolean(cells[1]?.classList.contains('text-success')),
        easyB: Boolean(cells[2]?.classList.contains('text-success')),
        tick: Boolean(one.querySelector('.anticon-check')),
      };
    }),
    scrollX: box.scrollWidth - box.clientWidth,
    sample: rows.slice(0, 3).map((one) =>
      [...one.children].map((cell) => (cell.innerText ?? '').trim()).join(' | ')),
  };
}

/**
 * ONE ROW OF THE BOARD, and what lights up while the pointer is on it.
 *
 * The tooltip is gone (his instruction) and the hover now RINGS the two men he would buy instead, so
 * the thing to measure is a count of rings - not the presence of a panel. Reads the ring from the
 * computed outline width, because a class name is not a pixel.
 */
function readBoardRow(role, at) {
  const column = [...document.querySelectorAll('plancia-slot-matrix .grid > div')].find((one) =>
    (one.innerText ?? '').trim().startsWith(role));
  const rows = [...(column?.querySelectorAll('button') ?? [])];
  const row = rows[at];
  if (!row) return null;
  const rect = row.getBoundingClientRect();
  const cells = [...row.querySelectorAll('span')].map((one) => (one.innerText ?? '').trim());
  // WHAT CHANGES IS WHAT COUNTS, so the probe returns every row's background as a STRING and the
  // caller diffs the two readings. Two attempts at reading it directly failed and both failures are
  // worth keeping: counting outlines read 250 of 250 (every button has one - the instrument saying
  // «everything is marked», i.e. nothing), and parsing the red channel read 0, because Chrome
  // computes a `color-mix(in srgb …)` as `color(srgb 1 0.17 0.47 / 0.1)` and not as `rgb()` - a
  // channel test on that string compares 1 with 8. A diff needs no format at all.
  const shades = [...document.querySelectorAll('plancia-slot-matrix button')].map(
    (one) => getComputedStyle(one).backgroundColor,
  );
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    text: (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
    numbers: cells.filter((one) => /^[-+]?[\d.,]+$/.test(one)),
    hasTooltipDirective: row.hasAttribute('nz-tooltip'),
    shades,
    names: [...document.querySelectorAll('plancia-slot-matrix button')].map(
      (one) => (one.innerText ?? '').split('\n')[0].trim()),
  };
}

/**
 * LA CARD DI UN CALCIATORE: dov'e', cosa dice, e i due bottoni.
 *
 * Si misura la POSIZIONE perche' «draggabile» e' una domanda su dei pixel: un `cdkDrag` che non si
 * muove lascia il DOM identico, quindi contare i nodi direbbe che tutto va bene.
 */
function readCard(at = 0) {
  // PIÙ DI UNA: le card aperte sono un elenco (sua richiesta del 04/09, per confrontare), quindi il
  // probe le CONTA e legge quella chiesta - un `querySelector` che ne prende la prima e tace sulle
  // altre direbbe «una card» sia con una che con sei.
  const cards = [...document.querySelectorAll('ui-player-card .fixed')];
  const card = cards[at];
  if (!card) return null;
  const rect = card.getBoundingClientRect();
  if (!rect.width) return null;
  const handle = card.querySelector('[cdkdraghandle]');
  const hrect = handle?.getBoundingClientRect();
  const buttons = [...card.querySelectorAll('button')].map((one) =>
    (one.innerText ?? '').replace(/\s+/g, ' ').trim());
  const closer = [...card.querySelectorAll('button')].find(
    (one) => one.getAttribute('aria-label') === 'chiudi');
  const closeRect = closer?.getBoundingClientRect();
  const pairs = [...card.querySelectorAll('button')].find(
    (one) => (one.innerText ?? '').toLowerCase().includes('abbinamenti'));
  const pairsRect = pairs?.getBoundingClientRect();
  return {
    open: cards.length,
    // Chi sta davanti e dove sta ognuna: «sopra le altre» è una `z`, e «non si spostano» sono due
    // coppie di coordinate prima e dopo. Nessuna delle due si legge da un conteggio di nodi.
    stack: cards.map((one) => ({
      name: (one.innerText ?? '').split('\n')[0].trim(),
      z: Number(getComputedStyle(one).zIndex) || 0,
      x: Math.round(one.getBoundingClientRect().left),
      y: Math.round(one.getBoundingClientRect().top),
    })),
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    text: (card.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
    labels: [...card.querySelectorAll('dt')].map((one) => (one.innerText ?? '').trim()),
    buttons,
    handle: hrect ? { x: hrect.left + hrect.width / 2, y: hrect.top + hrect.height / 2 } : null,
    closer: closeRect
      ? { x: closeRect.left + closeRect.width / 2, y: closeRect.top + closeRect.height / 2 }
      : null,
    pairs: pairsRect
      ? { x: pairsRect.left + pairsRect.width / 2, y: pairsRect.top + pairsRect.height / 2 }
      : null,
  };
}

/** A REAL drag: press, several moves (a single jump is not a drag), release. */
async function drag(session, from, dx, dy, steps = 8) {
  const at = { x: Math.round(from.x), y: Math.round(from.y) };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'none' });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...at, button: 'left', clickCount: 1,
  });
  for (let step = 1; step <= steps; step += 1) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(at.x + (dx * step) / steps),
      y: Math.round(at.y + (dy * step) / steps),
      button: 'left',
      buttons: 1,
    });
    await wait(20);
  }
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: Math.round(at.x + dx),
    y: Math.round(at.y + dy),
    button: 'left',
    clickCount: 1,
  });
  await wait(250);
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

  const theme = value('--theme', null);
  const report = { url, steps: [], problems: [], theme: theme ?? 'default' };
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
    // IL TEMA SI CHIEDE PER NOME, non con `prefers-color-scheme`: questa app non ha un tema chiaro
    // che segue il sistema, ha temi NOMINATI su `:root[data-theme="x"]` (app/src/styles/themes/). Un
    // `Emulation.setEmulatedMedia` qui non muove un pixel - misurato, le celle restavano identiche -
    // e un flag che non muove niente è peggio di nessun flag: leggerebbe «nessun problema» su una
    // cosa che non ha guardato. Con `--theme magenta` la scala dei colori si rimisura sui token di
    // quel tema, che è la variazione che questa app ha davvero.
    await session.send('Page.navigate', { url });
    await wait(1500);
    if (theme) {
      await evaluate(session, (name) => {
        document.documentElement.dataset.theme = name;
        return document.documentElement.dataset.theme;
      }, theme);
      await wait(200);
    }

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
        // IL MARGINE È DICHIARATO, e quello che promette si asserisce al valore che ha davvero.
        // Per un giorno valeva 0.40 come `club_defence.CLEAN_SHEET_SHARE`; il 03/09/2026 (sera)
        // l'operatore l'ha portato a 100 su tre partite sue, quindi la promessa è 0.32 e va scritta
        // qui - o uno schermo costruito a 0.32 si legge con il numero di un'altra soglia.
        ...(calendar.easy_margin === 75
          ? [] : [`il margine nel bundle è ${calendar.easy_margin} e non i 75 dichiarati: `
                  + `il pacchetto è più vecchio della decisione`]),
        ...(calendar.clean_sheet?.at_margin > 0.29 && calendar.clean_sheet?.at_margin < 0.31
          ? [] : [`a margine ${calendar.easy_margin} la porta inviolata dovrebbe valere ~0.30 e vale `
                  + `${calendar.clean_sheet?.at_margin}`]),
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

    // 1b. LA RIGA: tre numeri e nessun tooltip, e l'hover accende i due che comprerebbe invece.
    const before = await evaluate(session, readBoardRow, 'A1', 0);
    if (before) await hover(session, before);
    const during = await evaluate(session, readBoardRow, 'A1', 0);
    await hover(session, { x: 5, y: 5 });
    const after = await evaluate(session, readBoardRow, 'A1', 0);
    const changed = (one, two) => {
      const out = [];
      for (let at = 0; at < (one?.shades?.length ?? 0); at += 1) {
        if (one.shades[at] !== two?.shades?.[at]) out.push(one.names[at]);
      }
      return out;
    };
    // La riga SOTTO IL PUNTATORE cambia da sola (ha il suo `hover:` di stato), e non e' una delle due
    // alternative: si toglie dal conto invece di alzare la soglia, o l'asserto direbbe «due» anche
    // quando l'alternativa e' una sola e la terza e' lei.
    const own = (before?.text ?? '').split(' ')[0];
    const lit = changed(before, during).filter((one) => one !== own);
    const leftOver = changed(before, after);
    note('una riga della plancia', {
      said: `«${before?.text}» · numeri ${JSON.stringify(before?.numbers)} · `
        + `tooltip ${before?.hasTooltipDirective ? 'ANCORA LI' : 'no'} · `
        + `accese all'hover ${lit.length} (${lit.join(', ')}) · `
        + `rimaste accese dopo ${leftOver.length}`,
      problems: [
        ...(before ? [] : ['la prima riga di A1 non si trova']),
        // TRE numeri per riga: quanto rende sopra il sei per partita, le partite attese fra
        // parentesi, e la max offerta. Il secondo si asserisce col suo FORMATO, perche' e' quello
        // che lo distingue dagli altri due - e la parentesi e' la meta' del messaggio.
        ...(before?.numbers?.length === 2
          ? [] : [`la riga porta ${before?.numbers?.length} numeri liberi invece di 2: `
                  + `${JSON.stringify(before?.numbers)}`]),
        ...(/\(\d+\)/.test(before?.text ?? '')
          ? [] : [`la riga non porta le partite attese fra parentesi: «${before?.text}»`]),
        ...(before?.hasTooltipDirective
          ? ['la riga ha ancora il tooltip: doveva sparire'] : []),
        // L'hover accende la coppia alternativa, e lasciando la riga si spegne: un'evidenziazione
        // che resta accesa e' indistinguibile da una che non risponde.
        // La coppia sono DUE uomini, quindi due righe: una sola vorrebbe dire che l'alternativa e'
        // letta a metà, e zero che il gesto non arriva.
        ...(lit.length === 2
          ? [] : [`passando su un nome si accendono ${lit.length} righe invece di 2: `
                  + `${lit.join(', ') || 'nessuna'}`]),
        ...(leftOver.length === 0
          ? [] : [`uscendo dalla riga restano accese ${leftOver.join(', ')}`]),
      ],
    });

    // 1c. LA CARD: il click su un nome la apre (04/09/2026), si trascina dall'intestazione, e i due
    //     gesti di prima sono BOTTONI suoi. Il click NON mette niente in asta, che è l'istruzione del
    //     03/09 e resta asserita qui: è la cosa che questa pagina non deve fare.
    const lotBefore = await evaluate(session, readLot);
    const target = board?.rows?.[0];
    if (target) await click(session, target);
    const card = await waitFor(session, readCard, 20);
    const lotAfterCard = await evaluate(session, readLot);
    let moved = null;
    if (card?.handle) {
      await drag(session, card.handle, 140, 70);
      moved = await evaluate(session, readCard);
    }
    // DUE CARD, che è la richiesta: si apre un secondo nome e il primo deve restare, sfalsato.
    const second = await evaluate(session, readBoardRow, 'A1', 0);
    if (second) await click(session, second);
    const both = await evaluate(session, readCard, 1);
    const first = await evaluate(session, readCard, 0);
    // ...e le due cose che ha chiesto subito dopo: quella TOCCATA passa davanti, e chiuderne una non
    // sposta le altre. Si misurano su una `z` e su due coppie di coordinate.
    const beforeRaise = await evaluate(session, readCard, 0);
    if (beforeRaise?.handle) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: Math.round(beforeRaise.handle.x), y: Math.round(beforeRaise.handle.y),
        button: 'none',
      });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: Math.round(beforeRaise.handle.x),
        y: Math.round(beforeRaise.handle.y), button: 'left', clickCount: 1,
      });
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: Math.round(beforeRaise.handle.x),
        y: Math.round(beforeRaise.handle.y), button: 'left', clickCount: 1,
      });
      await wait(200);
    }
    const raised = await evaluate(session, readCard, 0);
    const front = (raised?.stack ?? []).find((one) => one.name === raised?.stack?.[0]?.name);
    const zs = (raised?.stack ?? []).map((one) => one.z);
    // La chiusura: si chiude la SECONDA e si guarda dove sta la prima, prima e dopo.
    const secondCard = await evaluate(session, readCard, 1);
    const wasAt = raised?.stack?.[0];
    if (secondCard?.closer) await click(session, secondCard.closer);
    const afterClose = await evaluate(session, readCard, 0);
    const stillAt = afterClose?.stack?.[0];
    note('due card aperte insieme', {
      said: `${both?.open ?? 0} card aperte · posti (${first?.x}, ${first?.y}) e (${both?.x}, `
        + `${both?.y}) · z ${JSON.stringify(zs)} · toccata la prima, davanti è «${front?.name}» · `
        + `chiusa la seconda, la prima resta a (${stillAt?.x}, ${stillAt?.y})`,
      problems: [
        ...(both?.open === 2
          ? [] : [`aprendo un secondo nome ci sono ${both?.open ?? 0} card invece di 2`]),
        // Affiancate: due card nello stesso punto sono una card.
        ...(both && first && (both.x !== first.x || both.y !== first.y)
          ? [] : ['la seconda card nasce esattamente sopra la prima']),
        // TOCCATA = DAVANTI: la `z` della prima deve superare quella dell'altra.
        ...(zs.length === 2 && zs[0] > zs[1]
          ? [] : [`toccando la prima card la sua z è ${zs[0]} contro ${zs[1]}: non passa davanti`]),
        // CHIUDERNE UNA NON SPOSTA LE ALTRE.
        ...(wasAt && stillAt && wasAt.x === stillAt.x && wasAt.y === stillAt.y
          ? [] : [`chiudendo una card l'altra si è spostata da (${wasAt?.x}, ${wasAt?.y}) a `
                  + `(${stillAt?.x}, ${stillAt?.y})`]),
      ],
    });

    note('la card di un calciatore', {
      said: `«${target?.name}» → card ${card ? 'aperta' : 'NON aperta'} a (${card?.x}, ${card?.y}) `
        + `larga ${card?.width}px · voci ${JSON.stringify(card?.labels)} · `
        + `bottoni ${JSON.stringify(card?.buttons)} · trascinata a (${moved?.x}, ${moved?.y})`,
      problems: [
        ...(card ? [] : ['cliccando un nome non si apre nessuna card']),
        ...(lotAfterCard === lotBefore
          ? [] : ['il click ha ANCHE messo il calciatore in asta: non è un comportamento richiesto']),
        // Compatta: una card che copre la plancia non è una card.
        ...(card && card.width <= 340
          ? [] : [`la card è larga ${card?.width}px: non è compatta`]),
        ...(card && card.labels.length >= 4
          ? [] : [`la card porta ${card?.labels?.length ?? 0} voci di statistica: sono poche`]),
        ...(card?.handle ? [] : ['la card non ha una maniglia: non si può trascinare']),
        // «Draggabile» è una domanda su dei PIXEL: un cdkDrag che non si muove lascia il DOM identico.
        ...(card && moved && (Math.abs(moved.x - card.x) > 40 || Math.abs(moved.y - card.y) > 20)
          ? [] : [`trascinando l'intestazione la card resta a (${moved?.x}, ${moved?.y}) invece di `
                  + `spostarsi da (${card?.x}, ${card?.y})`]),
        ...(card?.pairs ? [] : ['un portiere non ha il bottone «abbinamenti»']),
      ],
    });

    // 2. IL BOTTONE «ABBINAMENTI» della card apre la modale: due gesti, e il secondo è un bottone.
    if (moved?.pairs ?? card?.pairs) await click(session, moved?.pairs ?? card.pairs);
    const pairs = await waitFor(session, readPairs, 40);
    const lotAfter = await evaluate(session, readLot);
    note('il bottone «abbinamenti»', {
      said: `modale «${pairs?.title ?? 'nessuna'}» · `
        + `il lotto era «${lotBefore.slice(0, 40)}…» ed è «${lotAfter.slice(0, 40)}…»`,
      problems: [
        ...(pairs ? [] : ['il bottone «abbinamenti» non ha aperto la modale']),
        ...(lotAfter === lotBefore
          ? [] : ['aprire gli abbinamenti ha messo il portiere in asta']),
        ...(pairs?.title?.includes(target?.name ?? '\u0000')
          ? [] : [`la modale non nomina il portiere della card (${pairs?.title})`]),
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
        `${one.rank}. ${one.name} (${one.club}) ${one.facili} facili (+${one.gain}, `
        + `da solo ${one.alone}) / ${one.covered}`).join(' · ')
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
    // The diagonal is EMPTY by the operator's decision of 03/09/2026: a club with itself is not a
    // pair, and a number in that cell reads as if it were. What it used to say - the club alone -
    // moved onto the row's own header, so the assertion moved with it instead of being deleted.
    const offDiagonal = (grid?.total ?? 0) - (grid?.rows ?? 0);
    note('la griglia', {
      said: `${grid?.rows ?? 0}x${grid?.columns ?? 0} · ${grid?.withKeeper ?? 0} colonne col portiere `
        + `titolare · ${grid?.painted ?? 0}/${offDiagonal} caselle dipinte fuori diagonale · `
        + `tabella ${grid?.tableWidth}px in un riquadro da ${grid?.boxWidth}px, `
        + `modale ${grid?.modalWidth}x[${grid?.modalTop}..${grid?.modalBottom}] su `
        + `${grid?.viewport}x${grid?.viewportHeight} di finestra · nota ${grid?.noteHeight}px · `
        + `${grid?.tints?.length} tinte`,
      problems: [
        ...(gridButton ? [] : ['il bottone «mostra griglia» non c’è']),
        ...(grid ? [] : ['la griglia non si è aperta']),
        ...(square ? [] : ['la griglia non è quadrata: righe e colonne devono essere le stesse squadre']),
        ...(grid && grid.withKeeper === grid.columns
          ? [] : [`${(grid?.columns ?? 0) - (grid?.withKeeper ?? 0)} colonne senza il nome del portiere`]),
        // La diagonale: niente scritto e niente dipinto, e il «da solo» su ogni intestazione di riga.
        ...(grid && grid.diagonalText === ''
          ? [] : [`la diagonale porta ancora un numero: «${grid?.diagonalText}»`]),
        ...(grid && grid.aloneOnHeader === grid.rows
          ? [] : [`${(grid?.rows ?? 0) - (grid?.aloneOnHeader ?? 0)} righe senza il «da solo» `
                  + `sull’intestazione: il numero della diagonale è stato perso, non spostato`]),
        // LA SCALA DEI COLORI, misurata: cinque classi devono ARRIVARE a schermo, e nessuna deve
        // ingoiare la griglia - una classe che copre metà delle caselle è la scala lineare di prima,
        // che l'operatore ha letto come «tutto verde». La diagonale porta la sua tinta trasparente,
        // quindi le tinte attese sono le cinque più quella.
        ...(grid && grid.tints.length >= 5
          ? [] : [`solo ${grid?.tints?.length} tinte distinte sulla griglia: la scala non arriva`]),
        // IL NUMERO SI DEVE LEGGERE SU OGNI TINTA. Una cella dipinta è una cella con un numero
        // sopra, e la tinta più scura è quella che lo mangia per prima: si misura, non si guarda.
        ...(grid?.tints ?? [])
          .filter((one) => one.background !== 'rgba(0, 0, 0, 0)'
            && contrast(one.background, one.colour) < 4.5)
          .map((one) => `il numero su ${one.background} ha contrasto `
            + `${contrast(one.background, one.colour).toFixed(2)}:1 (${one.count} caselle)`),
        ...(grid && Math.max(...grid.tints.map((one) => one.count)) <= grid.total * 0.45
          ? [] : [`una tinta sola copre ${Math.max(...(grid?.tints ?? []).map((one) => one.count))} `
                  + `caselle su ${grid?.total}: non risalta niente`]),
        ...(grid && grid.legend >= 4
          ? [] : [`la legenda mostra ${grid?.legend} tinte: una scala a classi senza legenda è una `
                  + `figura che nessuno può controllare`]),
        // NON SFONDA: due numeri del browser, e nessun conteggio di celle può sostituirli.
        ...(grid && grid.boxScroll <= grid.boxWidth
          ? [] : [`la tabella chiede ${grid?.boxScroll}px in un riquadro da ${grid?.boxWidth}px: `
                  + `${(grid?.boxScroll ?? 0) - (grid?.boxWidth ?? 0)}px di scorrimento laterale`]),
        ...(grid && grid.modalWidth <= grid.viewport
          ? [] : [`la modale è larga ${grid?.modalWidth}px su una finestra da ${grid?.viewport}px`]),
        // NON ESCE IN BASSO (sua richiesta, 03/09/2026), e nemmeno in alto.
        ...(grid && grid.modalTop >= 0 && grid.modalBottom <= grid.viewportHeight
          ? [] : [`la modale va da ${grid?.modalTop} a ${grid?.modalBottom} su una finestra alta `
                  + `${grid?.viewportHeight}: esce dallo schermo`]),
        ...(grid && grid.noteHeight != null && grid.noteHeight <= 48
          ? [] : [`la riga di spiegazione è alta ${grid?.noteHeight}px: era una riga, è tornata un `
                  + `paragrafo e spinge la tabella fuori`]),
        // E NON È TROPPO LARGA: una modale che eccede la sua tabella di più dei due padding del corpo
        // è spazio morto, che è la seconda metà della richiesta («è troppo larga») e si misura sulla
        // stessa coppia di numeri. Dove le squadre sono più di venti la tabella è più larga del tetto
        // e la differenza è negativa, quindi l'asserto non morde dove non deve.
        ...(grid && grid.modalWidth - grid.tableWidth <= 160
          ? [] : [`la modale eccede la griglia di ${grid.modalWidth - grid.tableWidth}px: `
                  + `tabella ${grid.tableWidth}px in una modale da ${grid.modalWidth}px`]),
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

    // 5. THE POPOVER, which exists only while the pointer is on the cell. A cell BELOW the diagonal
    //    on purpose: that is the half where the shared cell's `a` and `b` are not the row and the
    //    column, and where the operator found one club's fixtures drawn under the other's name.
    const cell = await evaluate(session, cellAt, 2, 0);
    // IL PASSAGGIO DEL PUNTATORE NON DEVE APRIRE NIENTE (sua istruzione, 03/09/2026): su quattrocento
    // caselle un pannello che si apre passando copre proprio quelle che stavi leggendo. Si misura
    // muovendo il puntatore e guardando che NON compaia, prima di cliccare - «zero problemi» e «non
    // ho guardato» non devono leggersi uguale.
    if (cell) await hover(session, cell);
    await wait(400);
    const onHover = await evaluate(session, readPopover);
    if (cell) await click(session, cell);
    const popover = await waitFor(session, readPopover, 20);
    // The attribution, checked against the BUNDLE: each column must carry the fixtures of the club
    // its own header declares. A second implementation of the sentence, not the app's own function.
    const attribution = attributionOf(calendar, popover, from, to);
    // His rule, one row at a time: the check is there when at least one of the two is easy, and only
    // the easy match is highlighted.
    const rule = (popover?.marked ?? []).filter(
      (row) => row.tick !== (row.easyA || row.easyB)).length;
    note('il popover di una casella', {
      said: `«${popover?.title ?? '—'}» · ${popover?.rows ?? 0} giornate, ${popover?.ticks ?? 0} col check, `
        + `${popover?.columns ?? 0} colonne (${(popover?.clubs ?? []).join(' | ')}) · `
        + `scorrimento laterale ${popover?.scrollX}px · es. ${(popover?.sample ?? []).join(' // ')}`,
      problems: [
        ...(onHover ? ['il puntatore che passa apre già il pannello: doveva aprirlo il click'] : []),
        ...(popover ? [] : ['cliccando una casella non compare nessun popover']),
        ...(popover?.rows ? [] : ['il popover non elenca nessuna partita']),
        // Fuori diagonale sono DUE squadre: giornata, la prima, la seconda, il check.
        ...(popover?.columns === 4
          ? [] : [`il popover ha ${popover?.columns} colonne invece delle 4 di una coppia`]),
        ...(popover && popover.ticks === cell?.value
          ? [] : [`i check nel popover (${popover?.ticks}) non sono il numero della casella `
                  + `(${cell?.value})`]),
        ...(rule === 0
          ? [] : [`${rule} righe in cui il check non corrisponde a «almeno una delle due è facile»`]),
        ...(popover && popover.scrollX <= 0
          ? [] : [`la lista delle partite scorre di lato di ${popover?.scrollX}px`]),
        ...attribution.problems,
      ],
    });
    if (attribution.said) console.log(`    ↳ ${attribution.said}`);

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

  // THE SAME SENTENCE THE PAGE APPLIES, and since 03/09/2026 that sentence lives on the PROBABILITY:
  // the clean-sheet model reads the last ten matches' goals of both clubs, so an edge threshold can no
  // longer express «facile». This is still a second implementation and not a call into the app - the
  // point is that the two agree - but it has to be the second implementation of the CURRENT rule.
  const threshold = calendar.easy_probability;
  const easyByRound = (key) => {
    const out = new Map();
    for (const [round, , home, away, edge, csHome, csAway] of league.matches) {
      if (round < from || round > to) continue;
      const decide = (own, cs) =>
        threshold != null && cs != null ? cs > threshold : own != null && own > calendar.easy_margin;
      if (home === key) out.set(round, decide(edge, csHome));
      if (away === key) out.set(round, decide(edge == null ? null : -edge, csAway));
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

/**
 * WHOSE FIXTURES ARE UNDER WHOSE NAME, recomputed from the bundle.
 *
 * The grid computes each cell once and lets the cell and its mirror read one object - which is right,
 * two passes over one question is how a cell and its mirror disagree - and the price is that `a` and
 * `b` are the order the PAIR was built in. Labelling them from the axes therefore swaps them below the
 * diagonal, which is what the operator saw on «Com + Ata»: Atalanta's matches under Como, and the
 * highlight with them. So the header declares its club and this checks the opponents against the
 * calendar, one column at a time.
 */
function attributionOf(calendar, popover, from, to) {
  const league = calendar?.leagues?.serie_a;
  if (!league || !popover?.marked?.length) return { problems: [], said: null };
  const nameOf = new Map(league.clubs.map((one) => [one.key, one.name]));
  const keyOf = new Map(league.clubs.map((one) => [one.name, one.key]));
  const fixtures = (key) => {
    const out = new Map();
    for (const [round, , home, away] of league.matches) {
      if (from && (round < from || round > to)) continue;
      if (home === key) out.set(round, nameOf.get(away) ?? away);
      if (away === key) out.set(round, `@ ${nameOf.get(home) ?? home}`);
    }
    return out;
  };
  const problems = [];
  const said = [];
  for (const [at, side] of [[0, 'a'], [1, 'b']]) {
    const club = popover.clubs?.[at];
    const key = club ? keyOf.get(club) : null;
    if (!key) {
      problems.push(`la colonna ${at + 1} del popover non dichiara di che club è (title «${club}»)`);
      continue;
    }
    const mine = fixtures(key);
    // The label truncates on screen, so compare on the PREFIX and count what actually disagrees.
    const wrong = popover.marked.filter((row) => {
      const drawn = row[side];
      const real = mine.get(row.round);
      if (!drawn || drawn === '—' || !real) return false;
      const cut = drawn.replace(/\u2026$/, '');
      return !real.startsWith(cut) && !cut.startsWith(real);
    });
    said.push(`${club}: ${popover.marked.length - wrong.length}/${popover.marked.length} righe`);
    if (wrong.length) {
      const one = wrong[0];
      problems.push(`sotto «${club}» ci sono le partite di un altro club: alla giornata ${one.round} `
        + `il popover scrive «${one[side]}» e il calendario dice «${mine.get(one.round)}» `
        + `(${wrong.length} righe su ${popover.marked.length})`);
    }
  }
  return { problems, said: `attribuzione delle colonne · ${said.join(' · ')}` };
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
