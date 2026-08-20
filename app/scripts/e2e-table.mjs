/**
 * e2e-table.mjs - drive the REAL app in a browser and MEASURE the table.
 *
 * Why a browser and not a unit test. The defects this harness exists for are all invisible to jsdom: the
 * columns are laid out by `nzTableLayout="fixed"` (a `<colgroup>` nobody writes by hand), the rows arrive
 * by SCROLLING (`lazy-rows.ts`), and the reorder is a pointer gesture over real header boxes. A jsdom test
 * asserting «the header has 15 cells» passes while the screen shows holes - the family of defect this
 * project keeps paying for: verify the FUNCTION, not the column that looks like it.
 *
 * Zero dependencies on purpose (Node 24 has `fetch` and `WebSocket`): a harness that needs an install is
 * a harness nobody runs. It serves `dist/` itself, launches Edge or Chrome headless, speaks CDP, and
 * reports three things:
 *
 *   * ALIGNMENT - every header cell over its own body cell, before and after a drag. A mismatch of counts
 *     or of left edges is what «buchi / disallineamenti» looks like in numbers - and the header row is
 *     also checked for children that are NOT `<th>`, because one of those eats a column of the grid.
 *   * SORTING - click a numeric header, load EVERY row by scrolling, and check the column is monotone.
 *     Sorting only what is on screen reads as a sorted table until you scroll.
 *   * THE GESTURE - a drag onto another column, one past the LAST column and one before the FIRST (the
 *     two the old gesture could not do at all), Escape mid-flight, a drag started ON the filter funnel
 *     (which must not reorder), the page scrolling under a drag held at the edge, and the trailing click
 *     which must not sort. It also COUNTS the pointer events that arrive: few of them means the browser
 *     took the pointer for its own native drag, which no other measure can see.
 *   * FILTERING - all three shapes through the REAL controls (a bound typed into a number box, a club
 *     ticked in a list, «solo ignoti» on a measured column), each checked on the WHOLE list and on the
 *     column's own cells: a filter that shrinks the list without selecting the right thing looks like it
 *     works. Plus that every funnel is REACHABLE with a real pointer, that a spent one costs no width,
 *     and that the chip bar and the count line say what is hidden - a filter remembered and not shown is
 *     the defect this project keeps paying for.
 *   * PERSISTENCE - reload and check the sort, the column order and the filters are all still there; and
 *     the OTHER view (a club's rosa), where a filter on a column it does not offer must not apply.
 *   * WHAT THE PAGE SHOUTS - any console error or exception fails the run, even with every measure green.
 *
 * Usage: node scripts/e2e-table.mjs [--headed] [--path "/?vista=ratings"] [--column Overall] [--json]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

/** The dist folder, served with the SPA fallback the router needs. */
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

/** A CDP session on the browser's first page target. */
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
  /* QUELLO CHE LA PAGINA URLA, raccolto invece che ignorato: un difetto che si manifesta come «il
     pannello non si apre» ha quasi sempre un'eccezione dietro, e senza questa lista si finisce a
     indovinare il meccanismo. «No silent failures», applicato all'arnese. */
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
  return {
    send,
    close: () => socket.close(),
    /** Quello che la pagina ha urlato dall'ultima lettura, e poi la lista si azzera. */
    noise: () => noise.splice(0, noise.length),
  };
}

/** Run a function in the page and bring back its value. Throws what the page threw. */
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

/** Header labels, first-row cells and the colgroup: the three things a hole shows up in. */
function readTable() {
  const table = document.querySelector('nz-table table') ?? document.querySelector('table');
  if (!table) return null;
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: Math.round(rect.left), width: Math.round(rect.width) };
  };
  const head = table.querySelector('thead tr');
  const first = table.querySelector('tbody tr');
  return {
    head: [...head.querySelectorAll('th')].map((th) => ({
      label: (th.innerText || '').trim().split('\n')[0], ...box(th),
    })),
    body: first ? [...first.querySelectorAll('td')].map((td) => ({
      text: (td.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 20), ...box(td),
    })) : [],
    cols: [...table.querySelectorAll('colgroup col')].map((col) => col.style.width || ''),
    rows: table.querySelectorAll('tbody tr').length,
  };
}

/** Every loaded row's value in one column, as a number where it is one. */
function readColumn(label) {
  const table = document.querySelector('nz-table table') ?? document.querySelector('table');
  const heads = [...table.querySelectorAll('thead th')];
  const named = (one) => (one.innerText || '').trim().split('\n')[0];
  const exact = heads.findIndex((one) => named(one) === label);
  const at = exact >= 0 ? exact : heads.findIndex((one) => named(one).startsWith(label));
  if (at < 0) return { at, values: [] };
  const values = [...table.querySelectorAll('tbody tr')].map((row) => {
    const cell = row.querySelectorAll('td')[at];
    const text = (cell?.innerText || '').trim().replace('~', '').replace(',', '.');
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  });
  return { at, values };
}

/**
 * Is a header still carrying the classes its column declares?
 *
 * From 20/08/2026 there is ONE `<th>` in the template and the alignment comes from `SquadColumn.align`
 * through `headClass`, together with the drag marks - so this reads whether that composition actually
 * arrives on the element. It used to check Angular's merging of a static `class` with a bound one, which
 * is the same question one layer down: if the composition drops a piece, every numeric header goes left
 * while the cells under it stay right, and a screenshot of a narrow column would not show it.
 */
function headClasses(label) {
  const heads = [...document.querySelectorAll('nz-table thead th')];
  const named = (one) => (one.innerText || '').trim().split('\n')[0];
  const th = heads.find((one) => named(one) === label)
    ?? heads.find((one) => named(one).startsWith(label));
  return th ? [...th.classList] : null;
}

/**
 * ANY child of the header row that is NOT a `<th>` - which is a hole waiting to happen.
 *
 * Found on 20/08/2026, after two days of blaming the drag itself. `nz-tooltip` builds its component with
 * the ViewContainerRef of the element it sits on and then DETACHES that component's element from the DOM,
 * because the visible tooltip lives in an overlay. Angular still counts that node as part of the view, so
 * when a `@for` with `track` REORDERS, it re-inserts every root node of the moved view - the detached one
 * included. With the tooltip on the `<th>`, the re-inserted node was an `<nz-tooltip>` sitting directly in
 * the `<tr>`: the browser gives it a grid cell, the header row lands on 23 columns against the colgroup's
 * 22, and every header after the moved column is one column to the right of its own data - with the last
 * one squeezed to width ZERO. Measured: «Squadra» at 1219px and «Overall» at 1433 instead of 1349.
 *
 * The cure is one `<span>` (the tooltip goes on it, so the stray node stays INSIDE the cell). This check
 * is here because the symptom is 84 pixels and the cause is invisible: a screenshot shows a table that
 * looks almost right, and «almost right» is what shipped for two days.
 */
function strayHeadCells() {
  const row = document.querySelector('nz-table thead tr');
  if (!row) return ['no header row'];
  return [...row.children].filter((one) => one.tagName !== 'TH').map((one) => one.tagName);
}

/** Click a header by its label - what a user does to sort. */
function clickHead(label) {
  const heads = [...document.querySelectorAll('nz-table thead th')];
  const named = (one) => (one.innerText || '').trim().split('\n')[0];
  const th = heads.find((one) => named(one) === label)
    ?? heads.find((one) => named(one).startsWith(label));
  if (!th) return false;
  (th.querySelector('.ant-table-column-sorters') ?? th).click();
  return true;
}

/**
 * The reading scale: the star columns carry no TEXT, so a numeric check on them is vacuous.
 *
 * This harness reported «nessun problema» on a sort that was never measured, which is exactly the defect
 * the root CLAUDE.md names: an audit that returns zero failures is indistinguishable from a clean page.
 */
function chooseScore() {
  const labels = [...document.querySelectorAll('label[nz-radio-button], label')];
  const button = labels.find((one) => (one.innerText || '').trim() === '0-99');
  if (!button) return false;
  button.click();
  return true;
}

/**
 * Seed the saved column order, which is the state a reorder LEAVES BEHIND.
 *
 * It is how the rendering gets tested apart from the gesture: if a seeded order draws holes, the defect is
 * in the table and not in the drag, and the two need opposite cures.
 */
function seedOrder(order) {
  localStorage.setItem('fantassistant.squad.order', JSON.stringify(order));
  return localStorage.getItem('fantassistant.squad.order');
}

/** Seed a saved column filter, to check what the OTHER view does with one it cannot offer. */
function seedFilter(filters) {
  localStorage.setItem('fantassistant.squad.filters', JSON.stringify(filters));
  return localStorage.getItem('fantassistant.squad.filters');
}

/** What the app has written down about the table: the preferences that must survive a refresh. */
function storedState() {
  const out = {};
  for (let at = 0; at < localStorage.length; at += 1) {
    const key = localStorage.key(at);
    if (key?.startsWith('fantassistant.squad')) out[key] = localStorage.getItem(key);
  }
  return out;
}

/**
 * Is the drag actually live, and does it say WHERE it would land?
 *
 * The gesture is ours since 18/08/2026 and was rewritten on 20/08, so there is no CDK preview to look
 * for any more: the two signs are Tailwind classes on the headers - the taken column faded, the header
 * next to the chosen GAP carrying an inset bar. Reading them mid-flight is what tells a failed drop
 * («it never dragged») from a wrong drop («it dragged and landed elsewhere»), which need opposite cures.
 */
function dragging() {
  const heads = [...document.querySelectorAll('nz-table thead th')];
  const named = (th) => (th.innerText || '').trim().split('\n')[0] || '(vuota)';
  return {
    held: heads.filter((th) => th.classList.contains('opacity-40')).map(named),
    // Le due classi sono ombre interne con valore arbitrario: si cercano per prefisso, non per nome.
    mark: heads
      .filter((th) => [...th.classList].some((one) => one.startsWith('shadow-[inset')))
      .map(named),
    grabbing: heads.filter((th) => th.classList.contains('cursor-grabbing')).length,
  };
}

/**
 * Every column's filter funnel: is there one, is it lit, and can it be REACHED?
 *
 * The last one is the question a count cannot answer. A funnel added to a 46px column is markup that
 * exists and pixels that are clipped: the cell cuts what does not fit, and «the filter is there» would
 * be true of the DOM and false of the screen. So this measures the trigger's box against its own cell's
 * box - a rectangle outside its cell is a control nobody can click.
 */
function funnels() {
  return [...document.querySelectorAll('nz-table thead th')].map((th) => {
    const trigger = th.querySelector('.ant-table-filter-trigger');
    const cell = th.getBoundingClientRect();
    const box = trigger?.getBoundingClientRect();
    return {
      label: (th.innerText || '').trim().split('\n')[0] || '(vuota)',
      funnel: !!trigger,
      active: !!th.querySelector('.ant-table-filter-trigger.active'),
      // Quanto dell'imbuto sta FUORI dalla cella: zero vuol dire che si puo' cliccare.
      clipped: box
        ? Math.round(Math.max(0, box.right - cell.right) + Math.max(0, cell.left - box.left)) : 0,
      // ...e se si VEDE. Spento sta a zero (non costa larghezza a una colonna di 46px), acceso
      // deve stare a uno, perche' quale colonna stia filtrando e' un fatto e non un'affordance.
      shown: trigger ? Number(getComputedStyle(trigger).opacity) : null,
    };
  });
}

/** Where a column's header and its funnel are, so a REAL mouse can find them. */
function funnelBox(label) {
  const heads = [...document.querySelectorAll('nz-table thead th')];
  const named = (one) => (one.innerText || '').trim().split('\n')[0];
  const exact = heads.find((one) => named(one) === label);
  const th = exact ?? heads.find((one) => named(one).startsWith(label));
  const trigger = th?.querySelector('.ant-table-filter-trigger');
  if (!th || !trigger) return null;
  const cell = th.getBoundingClientRect();
  const box = trigger.getBoundingClientRect();
  const x = Math.round(box.left + box.width / 2);
  const y = Math.round(box.top + box.height / 2);
  const over = document.elementFromPoint(x, y);
  return {
    head: { x: Math.round(cell.left + cell.width / 2), y: Math.round(cell.top + cell.height / 2) },
    funnel: { x, y },
    wide: Math.round(box.width),
    // CHI STA DAVVERO SOTTO quel punto: un rettangolo dentro la cella e coperto da un altro elemento
    // e' un controllo che non si puo' cliccare, ed e' invisibile a ogni misura di geometria.
    over: over ? `${over.tagName}.${String(over.getAttribute('class') ?? '')}`.slice(0, 60) : null,
  };
}

/** Open a column's funnel and report what the shared panel drew for it. */
function openFunnel(label) {
  const heads = [...document.querySelectorAll('nz-table thead th')];
  const named = (one) => (one.innerText || '').trim().split('\n')[0];
  const exact = heads.find((one) => named(one) === label);
  const th = exact ?? heads.find((one) => named(one).startsWith(label));
  const trigger = th?.querySelector('.ant-table-filter-trigger');
  if (!trigger) return null;
  trigger.click();
  return true;
}

/** What the open panel offers: the kind of control, and the extremes it suggests. */
function panelState() {
  const panel = document.querySelector('.ant-table-filter-dropdown');
  if (!panel) return null;
  const numbers = [...panel.querySelectorAll('nz-input-number input')];
  return {
    open: true,
    numbers: numbers.map((one) => one.placeholder || ''),
    checkboxes: panel.querySelectorAll('label[nz-checkbox]').length,
    searches: panel.querySelectorAll('input[type="search"]').length,
    radios: [...panel.querySelectorAll('label[nz-radio-button]')].map((one) => one.innerText.trim()),
  };
}

/**
 * Type a minimum into the open range panel, the way a user does.
 *
 * Through the real input and a real `input` event, because the point of the check is that the SHIPPED
 * control writes the signal: setting `localStorage` and reloading would measure the reader and not the
 * panel - «verify the function, not the column that looks like it».
 */
function typeMinimum(value) {
  const panel = document.querySelector('.ant-table-filter-dropdown');
  const input = panel?.querySelector('nz-input-number input');
  if (!input) return false;
  input.focus();
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  input.blur();
  return true;
}

/** The count line under the table: the sentence that must never describe another list. */
function countLine() {
  const table = document.querySelector('nz-table');
  let node = table?.nextElementSibling;
  while (node && node.tagName !== 'P') node = node.nextElementSibling;
  return (node?.innerText || '').replace(/\s+/g, ' ').trim();
}

/** Close whatever panel is open, the way a click elsewhere does. */
function closePanel() {
  const close = [...document.querySelectorAll('.ant-table-filter-dropdown button')]
    .find((one) => (one.innerText || '').trim() === 'Chiudi');
  if (close) close.click();
  return !!close;
}

/** A column read as TEXT, for the checks a number cannot make («is this cell empty?»). */
function readTextColumn(label) {
  const table = document.querySelector('nz-table table');
  const heads = [...table.querySelectorAll('thead th')];
  const named = (one) => (one.innerText || '').trim().split('\n')[0];
  const exact = heads.findIndex((one) => named(one) === label);
  const at = exact >= 0 ? exact : heads.findIndex((one) => named(one).startsWith(label));
  if (at < 0) return [];
  return [...table.querySelectorAll('tbody tr')]
    .map((row) => (row.querySelectorAll('td')[at]?.innerText || '').trim())
    .filter((one, index) => index < 40);
}

/** Take every filter off from the chip bar, which is what «azzera tutti» is for. */
function clearAllChips() {
  const all = [...document.querySelectorAll('button')]
    .find((one) => (one.innerText || '').trim() === 'azzera tutti');
  if (all) all.click();
  return !!all;
}

/** Take a filter off from its chip, which is the one place a filter is always reachable from. */
function closeChip() {
  const close = document.querySelector('nz-tag .ant-tag-close-icon');
  if (!close) return false;
  close.click();
  return true;
}

/** The always-visible bar of active column filters, and how many chips it carries. */
function filterChips() {
  const tags = [...document.querySelectorAll('nz-tag')];
  return tags.map((one) => (one.innerText || '').replace(/\s+/g, ' ').trim());
}

/** Scroll to the bottom once: `lazy-rows` listens on the window. */
function scrollDown() {
  window.scrollTo(0, document.documentElement.scrollHeight);
  return document.querySelectorAll('nz-table tbody tr').length;
}

/**
 * Leave only a handful of columns on, or put them all back with `null`.
 *
 * The saved preference is the COMPLEMENT - the columns that are OFF - which is how a column added
 * tomorrow is born visible for everybody; so «keep these six» is written as «hide the other sixteen».
 */
function seedHidden(keep) {
  const key = 'fantassistant.squad.hidden';
  if (!keep) {
    localStorage.removeItem(key);
    return '(tutte accese)';
  }
  const every = ['mantra', 'club', 'codes', 'titolarita', 'expected', 'expectedFm', 'expectedMv',
    'surplus', 'surplusFielded', 'value', 'fvm', 'market', 'pv', 'mv', 'fm', 'overall', 'pi', 'votes',
    'bonus', 'presence'];
  localStorage.setItem(key, JSON.stringify(every.filter((one) => !keep.includes(one))));
  return localStorage.getItem(key);
}

/** How wide the window is, for a gesture that has to reach its edge. */
function viewportWidth() {
  return window.innerWidth;
}

/** Where the page is scrolled sideways, and how to put it back: the table is wider than the window. */
function scrollSideways(to) {
  if (to === 'end') window.scrollTo({ left: document.documentElement.scrollWidth, behavior: 'instant' });
  else if (to === 'start') window.scrollTo({ left: 0, behavior: 'instant' });
  return { x: Math.round(window.scrollX), max: Math.round(document.documentElement.scrollWidth - window.innerWidth) };
}

/** Where the header row begins and ends: a drag to the HEAD or the TAIL has to leave the row. */
function rowEdges() {
  const row = document.querySelector('nz-table thead tr');
  if (!row) return null;
  const box = row.getBoundingClientRect();
  return {
    left: Math.round(box.left),
    right: Math.round(box.right),
    y: Math.round(box.top + box.height / 2),
  };
}

/** Tick one voice of an open pick panel, by the word it shows. */
function checkPick(word) {
  const panel = document.querySelector('.ant-table-filter-dropdown');
  const label = [...(panel?.querySelectorAll('label[nz-checkbox]') ?? [])]
    .find((one) => (one.innerText || '').trim().startsWith(word));
  if (!label) return false;
  (label.querySelector('input') ?? label).click();
  return true;
}

/** Choose one of the three answers about the empty cells, by its own words. */
function chooseBlanks(word) {
  const panel = document.querySelector('.ant-table-filter-dropdown');
  const label = [...(panel?.querySelectorAll('label[nz-radio-button]') ?? [])]
    .find((one) => (one.innerText || '').trim() === word);
  if (!label) return false;
  (label.querySelector('input') ?? label).click();
  return true;
}

/**
 * COUNT THE EVENTS THE GESTURE ACTUALLY RECEIVES, which is not the same as counting the ones sent.
 *
 * This exists because of a defect it found on 20/08/2026: the FIRST drag of a page worked and every one
 * after it did nothing. Cause - a `mousedown` followed by a move over text starts Chromium's NATIVE drag,
 * which takes the pointer and stops sending `pointermove` (it sends `drag` instead). The numbers were
 * `pointerdown` 1 and `pointermove` **2 of 18**, and no measure of geometry, order or DOM could see it:
 * from the outside it reads as «the reorder works sometimes», which is the hardest kind of bug to chase.
 * So the count is an assertion now: if the native drag ever comes back, this collapses first.
 */
function armEventCount() {
  const row = document.querySelector('nz-table thead tr');
  window.__gesture = { down: 0, move: 0 };
  row.addEventListener('pointerdown', () => { window.__gesture.down += 1; }, true);
  window.addEventListener('pointermove', () => { window.__gesture.move += 1; }, true);
  return true;
}

function readEventCount() {
  return window.__gesture ?? null;
}

/** Where a header is, so a drag can start and end on real coordinates. */
function headBox(label) {
  const heads = [...document.querySelectorAll('nz-table thead th')];
  const named = (one) => (one.innerText || '').trim().split('\n')[0];
  const exact = heads.find((one) => named(one) === label);
  const th = exact ?? heads.find((one) => named(one).startsWith(label));
  if (!th) return null;
  const rect = th.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const over = document.elementFromPoint(x, y);
  // CHI STA SOTTO il punto da cui parte il gesto: se non e' la cella, il `pointerdown` non arriva alla
  // riga e il trascinamento non parte - e dal di fuori si legge come «il riordino non funziona».
  return { x, y, over: over ? `${over.tagName}.${String(over.getAttribute('class') ?? '')}`.slice(0, 50) : null };
}

// ------------------------------------------------------------------ the run

async function loadEveryRow(session) {
  let seen = 0;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = await evaluate(session, scrollDown);
    if (rows === seen) break;
    seen = rows;
    await wait(220);
  }
  return seen;
}

/**
 * Drag a header to an absolute X - which is how the HEAD and the TAIL get tested at all.
 *
 * `dragHead` walks to another header's centre, so it can only ever land BETWEEN two columns; the two
 * cases the first version of this gesture could not do are «before the first» and «after the last», and
 * both are outside the row. With `escape` it presses Escape mid-flight instead of releasing, which is the
 * other thing that did nothing before.
 */
async function dragHeadToX(session, from, x, { escape = false } = {}) {
  const start = await evaluate(session, headBox, from);
  if (!start) throw new Error(`cannot find header ${from}`);
  const pointer = (type, at, buttons = 1) => session.send('Input.dispatchMouseEvent', {
    type, x: at, y: start.y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse',
  });
  await pointer('mousePressed', start.x);
  for (const nudge of [3, 8, 16]) {
    await pointer('mouseMoved', start.x + nudge);
    await wait(50);
  }
  let live = null;
  const steps = 14;
  for (let step = 1; step <= steps; step += 1) {
    await pointer('mouseMoved', Math.round(start.x + ((x - start.x) * step) / steps));
    await wait(35);
    if (step === Math.round(steps / 2)) live = await evaluate(session, dragging);
  }
  await pointer('mouseMoved', x);
  await wait(120);
  if (escape) {
    for (const type of ['keyDown', 'keyUp']) {
      await session.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
    await wait(200);
  }
  await pointer('mouseReleased', x, 0);
  await wait(500);
  return { live, from: start.over };
}

/**
 * Hold a dragged column against the right edge and see whether the page follows.
 *
 * The table is wider than the window, so a varco past the last visible column is only reachable if the
 * page scrolls while the pointer is held there. Without it the gesture is half a gesture - which is what
 * this harness measured on 20/08/2026, by failing to grab a column it had just pushed off screen.
 */
async function dragAndHoldAtEdge(session, from) {
  const start = await evaluate(session, headBox, from);
  const before = await evaluate(session, scrollSideways, 'keep');
  const pointer = (type, x, buttons = 1) => session.send('Input.dispatchMouseEvent', {
    type, x, y: start.y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse',
  });
  await pointer('mousePressed', start.x);
  for (const nudge of [4, 12, 40]) {
    await pointer('mouseMoved', start.x + nudge);
    await wait(40);
  }
  // Sul bordo, e poi fermo: ogni `pointermove` sposta la pagina di un passo, quindi si insiste.
  const edge = (await evaluate(session, viewportWidth)) - 8;
  for (let step = 0; step < 30; step += 1) {
    await pointer('mouseMoved', edge - (step % 2));
    await wait(20);
  }
  const after = await evaluate(session, scrollSideways, 'keep');
  await pointer('mouseReleased', edge, 0);
  await wait(400);
  return { from: before.x, to: after.x, max: after.max };
}

/**
 * Press ON the funnel and drag: the order must not move.
 *
 * The funnel is a button inside the header, and a click that wanders a few pixels is the normal thing a
 * hand does. Without the guard in `grabAt`, opening a filter would reorder the table by accident - and
 * that is the kind of defect that only shows up at a table, in a hurry.
 */
async function dragFunnel(session, label, by) {
  const box = await evaluate(session, funnelBox, label);
  if (!box) return { ok: false, why: `nessun imbuto su «${label}»`, held: 0 };
  const pointer = (type, x, buttons = 1) => session.send('Input.dispatchMouseEvent', {
    type, x, y: box.funnel.y, button: 'left', buttons, clickCount: 1, pointerType: 'mouse',
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: box.head.x, y: box.head.y, buttons: 0, pointerType: 'mouse',
  });
  await wait(150);
  const at = await evaluate(session, funnelBox, label);
  await pointer('mousePressed', at.funnel.x);
  let held = 0;
  for (const step of [10, 25, 45, by]) {
    await pointer('mouseMoved', at.funnel.x + step);
    await wait(60);
    held = Math.max(held, (await evaluate(session, dragging)).held.length);
  }
  await pointer('mouseReleased', at.funnel.x + by, 0);
  await wait(400);
  await evaluate(session, closePanel);
  return { ok: true, held };
}

/**
 * Drag one header onto another with real mouse events, which is the only way to drive this gesture.
 *
 * Two things had to be measured rather than assumed, and both still hold now that the gesture is ours.
 * A drag begins only past `DRAG_THRESHOLD_PX`, so the first move is a small jiggle and the rest walk to
 * the target; and the events must be POINTER events - dispatching `mousePressed` alone left the header
 * order unchanged, which reads exactly like «the reorder does not work» when it is the harness that never
 * dragged. It returns what the gesture was showing mid-flight, so a failed drag says which half failed.
 */
async function dragHead(session, from, to) {
  const start = await evaluate(session, headBox, from);
  const end = await evaluate(session, headBox, to);
  if (!start || !end) throw new Error(`cannot find headers ${from} / ${to}`);
  const pointer = (type, x, y) => session.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
    pointerType: 'mouse',
  });
  await pointer('mousePressed', start.x, start.y);
  // Past the threshold first, slowly: under it the gesture is still a click that would sort.
  for (const nudge of [3, 8, 16]) {
    await pointer('mouseMoved', start.x + nudge, start.y);
    await wait(60);
  }
  let live = null;
  const steps = 20;
  for (let step = 1; step <= steps; step += 1) {
    await pointer('mouseMoved',
      Math.round(start.x + ((end.x - start.x) * step) / steps),
      Math.round(start.y + ((end.y - start.y) * step) / steps));
    await wait(40);
    if (step === Math.round(steps / 2)) live = await evaluate(session, dragging);
  }
  await pointer('mouseMoved', end.x, end.y);
  await wait(120);
  await pointer('mouseReleased', end.x, end.y);
  await wait(600);
  return live;
}

/** A PNG of what is on screen right now, for the parts a number cannot judge. */
async function shoot(session, report, where) {
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(where, Buffer.from(shot.data, 'base64'));
  console.log(`    · schermata: ${where}`);
  (report.shots ??= []).push(where);
}

/**
 * Reach a funnel the way a hand does: move the mouse onto the header, then click ON the funnel.
 *
 * `element.click()` would pass whatever the CSS does, including an icon clipped out of its own cell or
 * sitting under another element - and that is exactly the defect measured on 20/08/2026. A control is
 * verified functionally: a real pointer, at the coordinates the browser reports, after a real hover.
 */
async function clickFunnel(session, label) {
  const at = async () => evaluate(session, funnelBox, label);
  const first = await at();
  if (!first) return { ok: false, why: `nessun imbuto su «${label}»` };
  const move = (x, y) => session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, buttons: 0, pointerType: 'mouse',
  });
  await move(first.head.x, first.head.y);
  await wait(150);
  // Ri-letto DOPO il passaggio del mouse: se appare solo al hover, prima stava altrove o non c'era.
  const hovered = await at();
  await move(hovered.funnel.x, hovered.funnel.y);
  await wait(80);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await session.send('Input.dispatchMouseEvent', {
      type, x: hovered.funnel.x, y: hovered.funnel.y, button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse',
    });
  }
  await wait(400);
  return { ok: true, wide: hovered.wide, at: hovered.funnel, over: hovered.over };
}

function alignment(table) {
  if (!table) return ['no table on the page'];
  const problems = [];
  if (table.head.length !== table.body.length) {
    problems.push(`intestazioni ${table.head.length} contro celle ${table.body.length}`);
  }
  const pairs = Math.min(table.head.length, table.body.length);
  for (let at = 0; at < pairs; at += 1) {
    const gap = Math.abs(table.head[at].left - table.body[at].left);
    if (gap > 2) {
      problems.push(`colonna ${at} «${table.head[at].label || '(vuota)'}» a ${table.head[at].left}px, `
        + `cella «${table.body[at].text}» a ${table.body[at].left}px (${gap}px di scarto)`);
    }
  }
  const empty = table.head.filter((one) => !one.label).length;
  if (empty) problems.push(`${empty} intestazioni senza etichetta`);
  return problems;
}

const monotone = (values, direction) => {
  const known = values.filter((one) => one != null);
  for (let at = 1; at < known.length; at += 1) {
    if (direction === 'desc' ? known[at] > known[at - 1] + 1e-9 : known[at] < known[at - 1] - 1e-9) {
      return { ok: false, at, before: known[at - 1], after: known[at], of: known.length };
    }
  }
  return { ok: true, of: known.length };
};

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-'));
  const debugPort = Number(value('--port', '9333'));
  const path = value('--path', '/?vista=ratings');
  const url = `http://127.0.0.1:${port}${path}`;
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

    // The table arrives after the bundle: wait for a body row rather than for a fixed delay.
    let table = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      table = await evaluate(session, readTable);
      if (table?.rows) break;
      await wait(500);
    }
    if (!table?.rows) throw new Error('no rows ever appeared: the bundle did not load');
    // --shot: apri, aspetta, fotografa. Serve per i cambi VISIVI (il campetto), dove i passi della
    // tabella non c'entrano e non vale la pena pagarli.
    if (flag('--shot')) {
      await wait(Number(value('--settle', '2500')));
      const only = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = value('--shot-to', join(ROOT, 'dist', 'e2e-shot.png'));
      await writeFile(where, Buffer.from(only.data, 'base64'));
      console.log(`· screenshot: ${where}`);
      report.screenshot = where;
      return;
    }

    const numericHead = await evaluate(session, headClasses, 'FMa');
    note('la tabella apre', {
      said: `${table.head.length} colonne (${table.head.map((one) => one.label || '(vuota)').join(',')}), `
        + `${table.rows} righe · «FMa» porta ${JSON.stringify(numericHead)}`,
      problems: [
        ...alignment(table),
        ...(numericHead?.includes('text-right')
          ? [] : ['l\'intestazione «FMa» non porta text-right: `headClass` non compone l\'allineamento']),
        ...(numericHead?.includes('cursor-grab')
          ? [] : ['l\'intestazione «FMa» non dice col cursore che si può trascinare']),
      ],
    });

    // The star columns carry no text, so every numeric check on them would be vacuous: read 0-99.
    await evaluate(session, chooseScore);
    await wait(400);

    // ---------------------------------------------------------------- sorting over the WHOLE list
    //
    // THE INVARIANT IS NOT «the loaded rows are monotone». Sorting only the loaded slice ends up looking
    // sorted once everything is loaded, because each new slice is re-sorted with the rest. What it cannot
    // do is put the best man of the WHOLE listone on the first row while he is still unloaded - so the top
    // value is read with the first slice on screen and then compared with the maximum of all of them.
    //
    // And the DIRECTION is part of the invariant, which this harness got wrong once and is worth stating:
    // the table opens sorted by Overall DESCENDING, so a click is the second step of ng-zorro's cycle and
    // gives the ascending order. Asserting «a click gives the best first» measured the harness's
    // assumption and not the table.
    const column = value('--column', 'Overall');
    const checkSort = async (label, said, direction) => {
      const first = await evaluate(session, readColumn, label);
      const top = first.values.find((one) => one != null) ?? null;
      const rows = await loadEveryRow(session);
      const all = await evaluate(session, readColumn, label);
      const numbers = all.values.filter((one) => one != null);
      const edge = numbers.length
        ? (direction === 'desc' ? Math.max(...numbers) : Math.min(...numbers)) : null;
      const problems = [];
      if (numbers.length < 100) {
        problems.push(`solo ${numbers.length} numeri in «${label}»: il controllo non misura niente`);
      } else if (top == null) {
        problems.push(`la prima riga non porta un numero in «${label}»`);
      } else if (direction === 'desc' ? edge > top + 1e-9 : edge < top - 1e-9) {
        problems.push(`in cima c'era ${top}, ma ${direction === 'desc' ? 'il massimo' : 'il minimo'} `
          + `del listone è ${edge} - l'ordinamento ha visto solo le righe già caricate`);
      }
      note(said, {
        said: `cima ${top}, ${direction === 'desc' ? 'massimo' : 'minimo'} ${edge} `
          + `su ${numbers.length} numeri, ${rows} righe`,
        problems,
      });
    };

    // Come apre: il default è «Overall, dal migliore» e deve valere su TUTTO il listone, non sulle 60.
    await checkSort(column, `apre ordinata per ${column}, poi carica tutto`, 'desc');

    // ...e una colonna cliccata da zero: primo click = discendente (`highFirst`), sempre su tutta la lista.
    const clicked = value('--click', 'Fantapunti');
    await evaluate(session, clickHead, clicked);
    await wait(600);
    await checkSort(clicked, `cliccata «${clicked}», poi carica tutto`, 'desc');

    // ---------------------------------------------------------------- the drag
    const from = value('--drag', 'Squadra');
    const onto = value('--onto', 'Overall');
    const before = (await evaluate(session, readTable)).head.map((one) => one.label);
    const savedBefore = await evaluate(session, storedState);
    const live = await dragHead(session, from, onto);
    const after = await evaluate(session, readTable);
    const savedAfter = await evaluate(session, storedState);
    const moved = after.head.map((one) => one.label).join(',') !== before.join(',');
    const strays = await evaluate(session, strayHeadCells);
    // IL CLICK CHE SEGUE IL RILASCIO non deve ordinare: e' la coda del gesto, non una scelta. Si
    // legge dal disco, perche' e' la' che finisce l'ordinamento - e nella prima versione del gesto
    // il listener che lo mangiava poteva restare appeso e divorare un click legittimo molto dopo.
    const sortKept = savedBefore['fantassistant.squad.sort'] === savedAfter['fantassistant.squad.sort']
      && savedBefore['fantassistant.squad.sortWay'] === savedAfter['fantassistant.squad.sortWay'];
    note(`trascina «${from}» su «${onto}»`, {
      said: `${before.join(',')} → ${after.head.map((one) => one.label || '(vuota)').join(',')}`
        + ` · a metà volo: ${JSON.stringify(live)}`
        + ` · su disco: ${savedBefore['fantassistant.squad.order'] === savedAfter['fantassistant.squad.order']
          ? 'invariato' : 'riscritto'} ${savedAfter['fantassistant.squad.order'] ?? '(niente)'}`
        // IL COLGROUP, perche' un disallineamento dopo un riordino e' quasi sempre lui: `nzTableLayout`
        // fisso mette le larghezze la', e se la lista dei `th` cambia ORDINE senza cambiare numero la
        // sequenza puo' restare quella di prima. E' la prima cosa da guardare, non l'ultima.
        + ` · colgroup ${after.cols.join('|')}`
        + ` · nella riga di intestazione ${strays.length ? strays.join(',') : 'solo <th>'}`,
      problems: [
        ...(moved ? [] : ['l\'ordine non è cambiato: il drag non è arrivato a destinazione']),
        // I due segni a schermo sono la differenza fra «non ha trascinato» e «ha trascinato e ha
        // sbagliato bersaglio», che hanno cure opposte: se l'ordine non cambia e questi erano spenti, il
        // difetto è nel gesto; se erano accesi, è nell'aritmetica del varco.
        ...(live?.held?.length ? [] : ['a metà volo nessuna intestazione era in mano: il gesto non è partito']),
        ...(live?.mark?.length ? [] : ['a metà volo nessun varco era segnato: il rilascio non sa dove atterrare']),
        ...(sortKept ? [] : [`il trascinamento ha anche ORDINATO la tabella `
          + `(${savedBefore['fantassistant.squad.sort']} -> ${savedAfter['fantassistant.squad.sort']}): `
          + 'il click di coda del gesto non e stato mangiato']),
        // Un nodo che non è una `<th>` dentro la riga di intestazione mangia una colonna della
        // griglia: è la causa vera dei «buchi / disallineamenti», e si vede solo dopo un riordino.
        ...(strays.length ? [`la riga di intestazione contiene ${strays.join(',')}, che non è una `
          + 'cella: si mangia una colonna della griglia'] : []),
        ...alignment(after),
      ],
    });

    // ---------------------------------------------------------------- IN TESTA E IN CODA
    //
    // I due casi che la prima versione del gesto NON sapeva fare, ed erano quelli che si usano: decideva su
    // quale COLONNA si lasciava, e oltre l'ultima intestazione (o sopra le due fisse) non c'e' nessuna
    // colonna - `null`, e il rilascio non spostava niente. Un VARCO invece esiste sempre.
    //
    // SI MISURA SU UNA TABELLA CHE STA NELLA FINESTRA, spegnendo le colonne che qui non c'entrano, e questa
    // non e' una comodita' dell'arnese: a ventidue colonne la tabella chiede ~1900px contro i 1600 della
    // finestra, l'ultima intestazione e' FUORI, e una coordinata fuori dal viewport non colpisce niente -
    // misurando cosi', il primo tentativo ha dato «il varco in coda non esiste» quando il difetto era del
    // passo. Il varco in testa e in coda e' una proprieta' dell'ARITMETICA (`column-drag.ts`), e va misurata
    // dove la geometria non aggiunge una seconda incognita. Che le colonne fuori schermo siano
    // RAGGIUNGIBILI e' un'altra domanda, e ha il suo passo qui sotto.
    const movable = (heads) => heads.filter((one) => !['R', 'Nome'].includes(one));
    const FEW = ['mantra', 'club', 'titolarita', 'expectedFm', 'surplus', 'overall'];
    await evaluate(session, seedHidden, FEW);
    await session.send('Page.navigate', { url });
    await wait(1500);
    let few = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      few = await evaluate(session, readTable);
      if (few?.rows) break;
      await wait(400);
    }
    const narrow = await evaluate(session, rowEdges);

    const beforeTail = movable(few.head.map((one) => one.label));
    const tailFlight = await dragHeadToX(session, beforeTail[0], narrow.right - 4);
    const afterTail = movable((await evaluate(session, readTable)).head.map((one) => one.label));
    note(`trascina «${beforeTail[0]}» oltre l'ultima colonna`, {
      said: `${beforeTail.join(',')} → ${afterTail.join(',')} · volo ${JSON.stringify(tailFlight.live)}`,
      problems: [
        ...(afterTail.at(-1) === beforeTail[0] ? []
          : [`«${beforeTail[0]}» non e' finita in coda (ultima: «${afterTail.at(-1)}»): `
            + 'il varco oltre l' + "'" + 'ultima colonna non esiste']),
        ...alignment(await evaluate(session, readTable)),
      ],
    });

    const beforeHead = afterTail;
    await evaluate(session, armEventCount);
    const headFlight = await dragHeadToX(session, beforeHead.at(-1), narrow.left + 4);
    const events = await evaluate(session, readEventCount);
    const afterHead = movable((await evaluate(session, readTable)).head.map((one) => one.label));
    note(`trascina «${beforeHead.at(-1)}» prima della prima`, {
      said: `${beforeHead.join(',')} → ${afterHead.join(',')} · volo ${JSON.stringify(headFlight.live)} · preso da ${headFlight.from} · eventi ${JSON.stringify(events)}`,
      problems: [
        // I `pointermove` che sono ARRIVATI: pochi vogliono dire che il browser si e' preso il
        // puntatore per il suo drag nativo, ed e' l'unico modo di vedere quel difetto.
        ...(events?.move >= 10 ? []
          : [`al gesto sono arrivati ${events?.move} pointermove: il browser ha preso il puntatore `
            + 'per il suo trascinamento nativo']),
        ...(afterHead[0] === beforeHead.at(-1) ? []
          : [`«${beforeHead.at(-1)}» non e' finita in testa (prima: «${afterHead[0]}»): `
            + 'il varco davanti alla prima colonna non esiste']),
        ...alignment(await evaluate(session, readTable)),
      ],
    });

    // ---------------------------------------------------------------- ANNULLARE, e non trascinare l'imbuto
    const beforeEscape = (await evaluate(session, readTable)).head.map((one) => one.label);
    const escaped = await dragHeadToX(session, movable(beforeEscape)[0], narrow.right - 4, { escape: true });
    const afterEscape = (await evaluate(session, readTable)).head.map((one) => one.label);
    note('Escape annulla il trascinamento', {
      said: `a meta' volo ${JSON.stringify(escaped.live)} · ${afterEscape.join(',') === beforeEscape.join(',')
        ? 'ordine invariato' : 'ORDINE CAMBIATO'}`,
      problems: [
        ...(escaped.live?.held?.length ? []
          : ['non stava trascinando quando e arrivato Escape: il passo non misura niente']),
        ...(afterEscape.join(',') === beforeEscape.join(',') ? []
          : ['Escape non ha annullato: la colonna si e spostata comunque']),
      ],
    });

    // L'imbuto e' un pulsante DENTRO l'intestazione: prenderlo non e' prendere la colonna. Senza la guardia,
    // aprire un filtro su una tabella larga diventa un riordino involontario a ogni click leggermente mosso.
    const beforeFunnelDrag = (await evaluate(session, readTable)).head.map((one) => one.label);
    const funnelDrag = await dragFunnel(session, 'FMa', 80);
    const afterFunnelDrag = (await evaluate(session, readTable)).head.map((one) => one.label);
    note('trascinare per l\'imbuto non riordina', {
      said: `${funnelDrag.ok ? 'trascinato dall\'imbuto' : funnelDrag.why} · ${
        afterFunnelDrag.join(',') === beforeFunnelDrag.join(',') ? 'ordine invariato' : 'ORDINE CAMBIATO'}`,
      problems: [
        ...(funnelDrag.ok ? [] : [funnelDrag.why]),
        ...(afterFunnelDrag.join(',') === beforeFunnelDrag.join(',') ? []
          : ['un trascinamento partito dall\'imbuto ha riordinato le colonne']),
        ...(funnelDrag.held === 0 ? []
          : [`${funnelDrag.held} intestazioni erano «in mano»: la guardia sull'imbuto non ha tenuto`]),
      ],
    });

    // ---------------------------------------------------------------- LA PAGINA SCORRE MENTRE SI TRASCINA
    //
    // Riaccese tutte le colonne, la tabella e' piu' larga della finestra: senza questo, meta' delle
    // destinazioni non e' raggiungibile, perche' un varco fuori dal viewport non si puo' scegliere - il dito
    // non ci arriva. Il passo tiene il puntatore sul bordo destro e guarda se la pagina lo segue.
    await evaluate(session, seedHidden, null);
    await session.send('Page.navigate', { url });
    await wait(1500);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if ((await evaluate(session, readTable))?.rows) break;
      await wait(400);
    }
    await evaluate(session, scrollSideways, 'start');
    await wait(200);
    const wideHeads = movable((await evaluate(session, readTable)).head.map((one) => one.label));
    const scrolled = await dragAndHoldAtEdge(session, wideHeads[1]);
    note('trascinando sul bordo, la pagina scorre', {
      said: `scorrimento ${scrolled.from} → ${scrolled.to} (massimo ${scrolled.max})`,
      problems: [
        ...(scrolled.max < 50
          ? ['la pagina non scorre di lato: il passo non misura niente']
          : scrolled.to > scrolled.from + 50 ? []
            : [`la pagina non ha scorso (${scrolled.from} → ${scrolled.to}): le colonne fuori schermo `
              + 'non sono raggiungibili col trascinamento']),
      ],
    });

    // ---------------------------------------------------------------- persistence
    // L'ordine ADESSO, non quello di tre passi fa: fra il primo trascinamento e questo punto la
    // tabella e' stata riordinata altre volte, e confrontare col vecchio misura l'arnese.
    const chosen = (await evaluate(session, readTable)).head.map((one) => one.label);
    await session.send('Page.navigate', { url });
    await wait(1500);
    let reloaded = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      reloaded = await evaluate(session, readTable);
      if (reloaded?.rows) break;
      await wait(500);
    }
    await evaluate(session, chooseScore);
    await wait(400);
    // La scelta salvata è quella che deve tornare, non una che ci piace: si legge dal disco e si verifica
    // che la tabella la rispetti - colonna E verso.
    const savedSort = await evaluate(session, storedState);
    const key = savedSort['fantassistant.squad.sort'];
    const way = savedSort['fantassistant.squad.sortWay'] === 'ascend' ? 'asc' : 'desc';
    const again = await evaluate(session, readColumn, clicked);
    const numbersAgain = again.values.filter((one) => one != null);
    const stillSorted = monotone(numbersAgain, way);
    // «Mercato» arrives only once the market curve is fetched, so it is in one reading and not in the
    // other: comparing the two lists raw reported a lost order that was never lost. Compare the columns
    // both readings actually offered.
    const common = (list) => list.filter((one) => one && one !== 'Mercato').join(',');
    const keptOrder = common(reloaded.head.map((one) => one.label)) === common(chosen);
    note('ricarica la pagina', {
      said: `colonne ${reloaded.head.map((one) => one.label || '(vuota)').join(',')}`
        + ` · sul disco «${key}» ${way} · ${numbersAgain.length} numeri in «${clicked}»`,
      problems: [
        ...(keptOrder ? [] : [`l'ordine delle colonne non è stato ripreso: era ${common(chosen)}`]),
        ...(numbersAgain.length >= 20 && stillSorted.ok
          ? [] : [`l'ordinamento scelto non è stato ripreso (${key} ${way}: `
            + `alla riga ${stillSorted.at} si passa da ${stillSorted.before} a ${stillSorted.after})`]),
        ...alignment(reloaded),
      ],
    });


    // ---------------------------------------------------------------- filtrare, una colonna per volta
    //
    // Il filtro non è `nzFilterFn` per la stessa ragione per cui l'ordinamento non è `nzSortFn`: quello
    // filtrerebbe le righe GIÀ CARICATE, cioè risponderebbe sulle prime sessanta e la tabella si
    // riempirebbe scorrendo. Quindi qui si misura la lista INTERA - il totale sotto la tabella - e non
    // le righe a schermo, che sono un ritaglio di quel totale e non direbbero niente.
    //
    // E si passa dal CONTROLLO VERO: scrivere in `localStorage` e ricaricare misurerebbe il lettore
    // invece del pannello, che è «verify the FUNCTION, not the column that looks like it».
    // Il totale e' il numero che deve scendere: e' quello che il conteggio dichiara, non le righe
    // visibili - quelle sono un ritaglio del totale e direbbero «60» qualunque filtro sia acceso.
    const totalOf = (line) => Number((line.match(/di ([\d.]+) a schermo/)
      ?? line.match(/^([\d.]+) calciatori/) ?? [])[1]?.replace(/\./g, '') ?? NaN);
    const funnelled = await evaluate(session, funnels);
    const lineBefore = await evaluate(session, countLine);
    const filterCol = value('--filter', 'FMa');
    const reached = await clickFunnel(session, filterCol);
    await wait(300);
    const shown = await evaluate(session, panelState);
    const typed = await evaluate(session, typeMinimum, value('--filter-min', '6.5'));
    await wait(700);
    const lineAfter = await evaluate(session, countLine);
    // Il pannello APERTO va anche fotografato: i numeri qui sopra dicono che filtra, non che si
    // legge. Tre controlli in 288px si accavallano senza che nessuna misura se ne accorga.
    await shoot(session, report, join(ROOT, 'dist', 'e2e-filtro-numeri.png'));
    const chips = await evaluate(session, filterChips);
    const lit = (await evaluate(session, funnels)).filter((one) => one.active);
    const litFunnels = lit.length;
    const litShown = lit[0]?.shown ?? 0;
    const filteredTable = await evaluate(session, readTable);
    note(`filtra «${filterCol}» da ${value('--filter-min', '6.5')}`, {
      said: `imbuti ${funnelled.filter((one) => one.funnel).length}/${funnelled.length}`
        + ` · imbuto ${JSON.stringify(reached)} · pannello ${JSON.stringify(shown)} · scritto: ${typed}`
        + ` · prima «${lineBefore}» → dopo «${lineAfter}» · etichette ${JSON.stringify(chips)}`,
      problems: [
        ...(funnelled.every((one) => one.funnel)
          ? [] : [`${funnelled.filter((one) => !one.funnel).map((one) => one.label).join(',')}`
            + ' non hanno l\'imbuto: quelle colonne non si possono filtrare']),
        ...(reached.ok ? [] : [reached.why]),
        // Spento non deve costare larghezza, acceso deve vedersi: sono due fatti diversi.
        ...(funnelled.filter((one) => one.funnel && one.shown > 0).length === 0 ? []
          : ['un imbuto spento e visibile: occupa la cella di una colonna larga quanto le sue cifre']),
        ...(funnelled.every((one) => !one.clipped) ? []
          : [`imbuti tagliati dalla loro cella: ${funnelled.filter((one) => one.clipped)
            .map((one) => one.label + ' (' + one.clipped + 'px)').join(', ')}`
            + ' - ci sono nel DOM e non si possono cliccare']),
        ...(shown?.numbers?.length === 2
          ? [] : ['il pannello di una colonna di numeri non ha i due estremi']),
        ...(shown?.numbers?.every((one) => one)
          ? [] : ['gli estremi non suggeriscono il minimo e il massimo veri della colonna']),
        ...(shown?.radios?.length === 3
          ? [] : ['manca la scelta sulle celle vuote: senza, «ignoto» diventa uno zero']),
        ...(Number.isFinite(totalOf(lineAfter)) && totalOf(lineAfter) < totalOf(lineBefore)
          ? [] : [`il totale non è sceso (${totalOf(lineBefore)} → ${totalOf(lineAfter)}): `
            + 'il filtro non ha filtrato, o non filtra la lista intera']),
        ...(/nascond/.test(lineAfter)
          ? [] : ['il conteggio sotto la tabella non dice quanti uomini il filtro sta nascondendo']),
        ...(chips.length === 1 ? [] : [`etichette dei filtri attivi: ${chips.length} invece di 1 - `
          + 'un filtro ricordato che non si vede è un filtro invisibile']),
        ...(litFunnels === 1 ? [] : [`imbuti accesi: ${litFunnels} invece di 1`]),
        ...(litShown === 1 ? []
          : [`l'imbuto acceso ha opacità ${litShown}: quale colonna filtra non si vede`]),
        ...alignment(filteredTable),
      ],
    });


    // ...e le altre due forme del pannello, perché una colonna di parole e una di numeri fanno due
    // domande diverse: se il pannello ne offrisse una sola, metà delle colonne avrebbe un imbuto che non
    // risponde. La lista delle squadre è lunga, quindi deve portare anche la sua ricerca.
    await evaluate(session, closePanel);
    await wait(300);
    await evaluate(session, openFunnel, 'Squadra');
    await wait(500);
    const picking = await evaluate(session, panelState);
    await shoot(session, report, join(ROOT, 'dist', 'e2e-filtro-elenco.png'));
    // ...e si passa da un imbuto all'altro SENZA chiudere, che e' quello che fa una mano: il pannello e'
    // UNO per tutte le colonne, quindi qui si verifica che segua chi lo chiede invece di restare sul
    // primo (o di sparire, se i due overlay si contendessero lo stesso template).
    await evaluate(session, openFunnel, 'Nome');
    await wait(500);
    const searching = await evaluate(session, panelState);
    await evaluate(session, closePanel);
    note('gli altri due pannelli', {
      said: `Squadra ${JSON.stringify(picking)} · Nome ${JSON.stringify(searching)}`,
      problems: [
        ...(picking?.checkboxes > 1 ? [] : ['il pannello di «Squadra» non offre le spunte']),
        ...(picking?.searches === 1
          ? [] : ['un elenco di quaranta squadre non porta la sua ricerca: si trova scorrendo']),
        ...(searching?.searches === 1 ? [] : ['il pannello di «Nome» non offre la casella di ricerca']),
        ...(searching?.numbers?.length ? ['«Nome» offre due estremi numerici, che non vogliono dire niente'] : []),
      ],
    });

    // ...e si torna indietro dall'etichetta, che è l'unico posto da cui un filtro si vede sempre.
    await evaluate(session, closeChip);
    await wait(600);
    const cleared = await evaluate(session, countLine);
    note('toglie il filtro dall\'etichetta', {
      said: `«${cleared}»`,
      problems: [
        ...(totalOf(cleared) === totalOf(lineBefore)
          ? [] : [`il totale non è tornato quello di prima (${totalOf(lineBefore)} → ${totalOf(cleared)})`]),
        ...((await evaluate(session, filterChips)).length
          ? ['l\'etichetta è ancora lì dopo averla chiusa'] : []),
      ],
    });


    // ---------------------------------------------------------------- UN ELENCO DA SPUNTARE
    //
    // Il passo qui sopra misura un INTERVALLO; questo misura l'altra forma, e sono due domande diverse
    // («FMa >= 6,50» e «solo il Napoli») con due strade diverse fino a `kept()`. Una sola delle due provata
    // avrebbe lasciato metà del filtro non verificata - e la metà non provata è sempre quella che si rompe.
    await evaluate(session, openFunnel, 'Squadra');
    await wait(500);
    const clubBefore = await evaluate(session, countLine);
    const ticked = await evaluate(session, checkPick, 'Napoli');
    await wait(600);
    const clubAfter = await evaluate(session, countLine);
    const clubChips = await evaluate(session, filterChips);
    const clubColumn = await evaluate(session, readTextColumn, 'Squadra');
    await evaluate(session, closePanel);
    note('spunta una squadra', {
      said: `${ticked ? 'spuntato «Napoli»' : 'NON spuntato'} · «${clubBefore}» → «${clubAfter}»`
        + ` · etichette ${JSON.stringify(clubChips)} · in colonna ${[...new Set(clubColumn)].join(',')}`,
      problems: [
        ...(ticked ? [] : ['la voce «Napoli» non c\'era nell\'elenco da spuntare']),
        ...(totalOf(clubAfter) > 0 && totalOf(clubAfter) < totalOf(clubBefore) ? []
          : [`il totale non è sceso (${totalOf(clubBefore)} → ${totalOf(clubAfter)})`]),
        // E le righe che restano devono essere QUELLE: un filtro che riduce la lista senza selezionare la
        // cosa giusta è peggio di un filtro che non funziona, perché sembra funzionare.
        ...(clubColumn.length && clubColumn.every((one) => one === 'Napoli') ? []
          : [`in colonna «Squadra» restano ${[...new Set(clubColumn)].join(',')}: `
            + 'il filtro ha ridotto la lista senza selezionare la squadra scelta']),
        ...(clubChips.some((one) => /Squadra/.test(one)) ? []
          : ['nessuna etichetta nomina la colonna «Squadra»']),
      ],
    });

    // ---------------------------------------------------------------- «SOLO IGNOTI», che è la regola di casa
    //
    // Vuoto vuol dire IGNOTO e mai zero, e su questa tabella metà delle celle è vuota per costruzione - chi
    // non ha una stagione misurata in questo listone. Quindi «chi non ha il numero» deve essere una domanda
    // che si può FARE, e la risposta si controlla sulla colonna: se restasse anche una cella con una cifra,
    // il tre-vie starebbe dicendo un'altra cosa.
    await evaluate(session, clearAllChips);
    await wait(500);
    await evaluate(session, openFunnel, 'MV');
    await wait(500);
    const blanksBefore = await evaluate(session, countLine);
    const chosenBlanks = await evaluate(session, chooseBlanks, 'Solo ignoti');
    await wait(700);
    const blanksAfter = await evaluate(session, countLine);
    const mvColumn = await evaluate(session, readTextColumn, 'MV');
    const blankChips = await evaluate(session, filterChips);
    await evaluate(session, closePanel);
    note('«solo ignoti» su una colonna misurata', {
      said: `${chosenBlanks ? 'scelto' : 'NON scelto'} · «${blanksBefore}» → «${blanksAfter}»`
        + ` · in colonna ${[...new Set(mvColumn)].slice(0, 4).join(',')} · etichette ${JSON.stringify(blankChips)}`,
      problems: [
        ...(chosenBlanks ? [] : ['la scelta «Solo ignoti» non c\'è nel pannello']),
        ...(totalOf(blanksAfter) > 0 && totalOf(blanksAfter) < totalOf(blanksBefore) ? []
          : [`il totale non è sceso (${totalOf(blanksBefore)} → ${totalOf(blanksAfter)})`]),
        ...(mvColumn.length && mvColumn.every((one) => !/[0-9]/.test(one)) ? []
          : [`in colonna «MV» restano celle con una cifra (${[...new Set(mvColumn)].slice(0, 4).join(',')}): `
            + '«solo ignoti» sta tenendo righe che hanno il numero']),
      ],
    });

    // ---------------------------------------------------------------- ...e sopravvive a un refresh
    //
    // I filtri si ricordano come le colonne spente e l'ordinamento (è una preferenza sulla TABELLA), quindi
    // devono tornare - E devono tornare VISIBILI, che è la metà che conta: un filtro ripreso senza la sua
    // etichetta è una tabella che domani si legge come «il listone ha dodici uomini».
    await session.send('Page.navigate', { url });
    await wait(1500);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if ((await evaluate(session, readTable))?.rows) break;
      await wait(400);
    }
    const backLine = await evaluate(session, countLine);
    const backChips = await evaluate(session, filterChips);
    const backLit = (await evaluate(session, funnels)).filter((one) => one.active).map((one) => one.label);
    note('i filtri tornano dopo un refresh', {
      said: `«${backLine}» · etichette ${JSON.stringify(backChips)} · imbuti accesi ${backLit.join(',')}`,
      problems: [
        ...(totalOf(backLine) === totalOf(blanksAfter) ? []
          : [`il totale dopo il refresh è ${totalOf(backLine)} invece di ${totalOf(blanksAfter)}`]),
        ...(backChips.length === 1 ? [] : [`etichette dopo il refresh: ${backChips.length} invece di 1`]),
        ...(backLit.length === 1 ? [] : [`imbuti accesi dopo il refresh: ${backLit.length} invece di 1`]),
      ],
    });
    await evaluate(session, clearAllChips);
    await wait(500);

    // ------------------------------------------- l'altra vista, e un filtro che non le appartiene
    //
    // Il componente e' UNO e le due viste offrono colonne diverse: una rosa di club non ha «Squadra».
    // Un filtro per squadra rimasto acceso nella vista CALCIATORI la svuoterebbe senza che ci sia un
    // imbuto da cui togliersolo - un filtro invisibile E irraggiungibile, che e' il caso peggiore. La
    // regola e' la stessa delle colonne spente: quello che questa vista non offre, non lo legge.
    await evaluate(session, seedFilter, { club: { pick: ['Atalanta'] }, expectedFm: { min: 6.5 } });
    const clubUrl = `http://127.0.0.1:${port}/clubs?club=Napoli`;
    await session.send('Page.navigate', { url: clubUrl });
    await wait(1500);
    let rosa = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      rosa = await evaluate(session, readTable);
      if (rosa?.rows) break;
      await wait(500);
    }
    const rosaLine = await evaluate(session, countLine);
    const rosaChips = await evaluate(session, filterChips);
    const rosaHeads = rosa.head.map((one) => one.label);
    note('la rosa di un club, con un filtro che non le appartiene', {
      said: `colonne ${rosaHeads.join(',')} · «${rosaLine}» · etichette ${JSON.stringify(rosaChips)}`,
      problems: [
        ...(rosaHeads.includes('Squadra')
          ? ['la rosa di un club mostra la colonna «Squadra»'] : []),
        // Quello per squadra non deve applicarsi; quello sulla FMa si', ed e' la prova che il filtro
        // arriva davvero - senza, questo passo direbbe «niente e cambiato» anche a filtro rotto.
        ...(rosaChips.length === 1 && /FMa/.test(rosaChips[0])
          ? [] : [`etichette sulla rosa: ${JSON.stringify(rosaChips)} - `
            + 'atteso solo il filtro della colonna che questa vista offre']),
        ...(/nascond/.test(rosaLine)
          ? [] : ['il filtro sulla FMa non ha filtrato la rosa: il passo non misura niente']),
        ...alignment(rosa),
      ],
    });
    await evaluate(session, seedFilter, {});
    await session.send('Page.navigate', { url });
    await wait(1500);

    // ------------------------------------------------------- the rendering, apart from the gesture
    //
    // Seeded orders instead of drags: `--hunt N` reloads the page with N shuffled column orders and
    // measures the alignment of each. A drag leaves exactly this state behind, so a hole that shows up
    // here is a hole of the TABLE - and one that only shows up after a real drag is a hole of the drag.
    const hunt = Number(value('--hunt', '0'));
    const keys = ['mantra', 'club', 'codes', 'titolarita', 'expected', 'expectedFm', 'expectedMv',
      'surplus', 'surplusFielded', 'value', 'fvm', 'market', 'pv', 'mv', 'fm', 'overall', 'votes',
      'bonus', 'presence'];
    for (let round = 1; round <= hunt; round += 1) {
      // Deterministic shuffle, so a failing round can be replayed: rotate by the round and swap a pair.
      const order = [...keys.slice(round % keys.length), ...keys.slice(0, round % keys.length)];
      const swap = round % (keys.length - 1);
      [order[swap], order[swap + 1]] = [order[swap + 1], order[swap]];
      await evaluate(session, seedOrder, order);
      await session.send('Page.navigate', { url });
      await wait(1200);
      let drawn = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        drawn = await evaluate(session, readTable);
        if (drawn?.rows) break;
        await wait(400);
      }
      note(`ordine seminato #${round}`, {
        said: `${order.slice(0, 4).join(',')}… → ${drawn.head.map((one) => one.label || '(vuota)').join(',')}`,
        problems: alignment(drawn),
      });
    }

    // Quello che la pagina ha urlato durante tutta la corsa: un'eccezione e' un problema anche
    // quando ogni misura torna verde, perche' vuol dire che qualcosa non e' stato provato.
    const shouted = session.noise();
    note('quello che la pagina ha detto', {
      said: shouted.length ? `${shouted.length} messaggi` : 'niente',
      problems: shouted,
    });

    const shot = await session.send('Page.captureScreenshot', { format: 'png' });
    const out = value('--shot', join(ROOT, 'dist', 'e2e-table.png'));
    await writeFile(out, Buffer.from(shot.data, 'base64'));
    report.screenshot = out;
    console.log(`· screenshot: ${out}`);
  } finally {
    session?.close();
    browser.kill();
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  console.log(report.problems.length ? `\n${report.problems.length} PROBLEMI\n` : '\nnessun problema\n');
  if (flag('--json')) console.log(JSON.stringify(report, null, 1));
  process.exit(report.problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
