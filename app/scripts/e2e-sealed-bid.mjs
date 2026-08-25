/**
 * e2e-sealed-bid.mjs - drive the REAL sealed-bid page in a browser and MEASURE it.
 *
 * Why a browser. Two of the three things this page has to do are invisible to a unit test: a suggestion
 * has to OPEN when a real pointer lands on it (`element.click()` proves nothing about a control - it
 * passes over the CSS, and on 20/08/2026 that exact blindness hid a filter funnel covered by an antd
 * `inset: 0` pseudo-element), and ten team cards plus twelve bids have to fit on ONE screen, which is
 * the operator's own requirement and a rectangle, not an opinion.
 *
 * What it checks, and every step says how many elements it looked at:
 *   * THE EMPTY STATE - with no file loaded the page must say what to do, not draw a broken plan.
 *   * THE PLAN - twelve bids for twelve slots, inside the budget, each with a role, a number and a price.
 *   * THE GESTURE - a REAL pointer on a bid row, at the coordinates the browser reports, after a real
 *     hover; the harness reports what sits under that point, because «the button is there» is a fact
 *     about the DOM and not about the screen. Then the alternatives panel must open, and clicking an
 *     alternative must change that row AND leave the other rows alone.
 *   * ONE SCREEN - the page must not scroll sideways, and the cards must fit the height the operator has.
 *   * THE TOOLTIPS - the numbers that carry a `nz-tooltip` must actually produce one on hover.
 *   * WHAT THE PAGE SHOUTS - any console error or exception fails the run, even with every measure green.
 *
 * The league's own data never enters this file: pass `--csv <path>` to seed a real round, or run it
 * without and only the empty state is measured.
 *
 * Usage: node scripts/e2e-sealed-bid.mjs [--csv path] [--team "Nome"] [--headed] [--json] [--keep-plan]
 *
 * `--keep-plan` skips the last block, which WRITES a synthetic next round to exercise `settle`. Use it
 * when the screenshot has to show the page as the operator will actually see it.
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
      /* still coming up */
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

// ------------------------------------------------------------------ what runs IN the page

/** The same parser the app uses, restated here only to SEED the browser's storage. */
function seed(payload) {
  const { awards, team, settings } = payload;
  localStorage.setItem('fantassistant.sealedBid.snapshots', JSON.stringify([awards]));
  localStorage.setItem('fantassistant.sealedBid.me', JSON.stringify(team));
  localStorage.setItem('fantassistant.sealedBid.rules', JSON.stringify(settings));
  localStorage.setItem('fantassistant.sealedBid.swaps', JSON.stringify({}));
  return true;
}

function emptyState() {
  const empty = document.querySelector('nz-empty');
  const upload = [...document.querySelectorAll('button')].find((one) =>
    /Carica le rose/i.test(one.textContent ?? ''));
  return {
    hasEmpty: !!empty,
    said: (empty?.textContent ?? '').trim().slice(0, 120),
    hasUpload: !!upload,
    cards: document.querySelectorAll('nz-card').length,
  };
}

/** The plan as the SCREEN has it: one entry per drawn row, with the box it occupies.
 *
 * Read off `data-bid`, not off a chain of `:scope > div`: the first version of this harness matched an
 * ancestor of the whole page and cheerfully reported the upload button as «the first alternative», which
 * is the same defect it exists to catch - a measurement that describes a different thing than it names.
 */
function readPlan() {
  const box = (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  };
  const bids = [...document.querySelectorAll('button[data-bid]')].map((one) => ({
    fcId: Number(one.dataset.bid),
    text: one.textContent.replace(/\s+/g, ' ').trim().slice(0, 70),
    role: one.querySelector('ui-role')?.textContent.trim() ?? '',
    box: box(one),
  }));
  const heading = [...document.querySelectorAll('h2')].find((one) =>
    /Le tue buste/i.test(one.textContent ?? ''));
  const card = heading?.closest('nz-card');
  const total = card?.textContent.match(/(\d+)\s*di\s*(\d+)\s*crediti/);
  return {
    bids,
    spend: total ? Number(total[1]) : null,
    budget: total ? Number(total[2]) : null,
  };
}

function readTeams() {
  const tiles = [...document.querySelectorAll('[data-team]')];
  return {
    count: tiles.length,
    names: tiles.map((one) => one.dataset.team),
    withTargets: tiles.filter((one) => /Probabili obiettivi/i.test(one.textContent ?? '')).length,
    // OUR card carries our own envelopes instead, and it must say so: «i probabili obiettivi» of a
    // rival is a forecast, ours are the buste we are about to send, and one label for both would be a
    // claim we never made.
    withOurs: tiles.filter((one) => /I tuoi obiettivi/i.test(one.textContent ?? '')).length,
    stars: tiles.reduce((sum, one) => sum + one.querySelectorAll('nz-rate').length, 0),
    locks: tiles.filter((one) => one.querySelector('nz-icon[nztype="lock"], .anticon-lock')).length,
  };
}

/** The rosters drawn in full: how many men, and whether the empty slots are stated. */
function readRosters() {
  const tiles = [...document.querySelectorAll('[data-team]')];
  const men = tiles.reduce(
    (sum, one) => sum + one.querySelectorAll('ui-gain').length,
    0,
  );
  return {
    men,
    holes: tiles.filter((one) => /slot da riempire/i.test(one.textContent ?? '')).length,
  };
}

/** The switch that draws them, by its own label. */
function rosterSwitchBox() {
  const label = [...document.querySelectorAll('label')].find((one) =>
    /Mostra le rose/i.test(one.textContent ?? ''));
  const node = label?.querySelector('nz-switch');
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/** The delete button of the first envelope: a control that must be reachable, not only present. */
function dropBox() {
  const node = document.querySelector('button[data-drop]');
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, fcId: Number(node.dataset.drop) };
}

/** What the modal is showing, and the first row it says can ACTUALLY be added. */
function modalRows() {
  const rows = [...document.querySelectorAll('button[data-browse]')];
  // The row states its own verdict, so the harness picks a valid one instead of guessing: clicking a
  // «non valida» row is supposed to do nothing, and a test that clicked one would be testing that.
  const valid = rows.find((one) => /puoi aggiungerlo/i.test(one.textContent ?? '')) ?? rows[0];
  const box = valid?.getBoundingClientRect();
  // IL RUOLO SI LEGGE DAL BOTTONE ACCESO, non dal titolo. Due tentativi di parsarlo da una stringa
  // hanno risposto `null` (`.ant-modal-title`, poi il contenuto della modale), e una terza stringa da
  // indovinare sarebbe stata la stessa scommessa: quale ruolo la modale sta mostrando e' uno STATO del
  // DOM - il radio con la classe `-checked` - e uno stato si legge, non si deduce.
  const checked = document.querySelector('.ant-radio-button-wrapper-checked');
  return {
    open: !!document.querySelector('nz-modal-container, .ant-modal'),
    // Il ruolo su cui e' aperta: serve per TORNARCI dopo aver guardato un altro ruolo - senza, il
    // passo dopo cliccava una riga che non era piu' quella che aveva misurato.
    role: checked ? (checked.textContent ?? '').trim() : null,
    rows: rows.length,
    first: valid?.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) ?? null,
    firstId: valid ? Number(valid.dataset.browse) : null,
    firstBox: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
    // How many rows the modal could judge at all: a modal that shows no verdict is a modal that
    // cannot say «questa busta è valida», which is the whole reason the operator asked for it.
    judged: rows.filter((one) => /(puoi aggiungerlo|non valida|sfori il tetto)/i.test(one.textContent ?? '')).length,
  };
}

/** Il bottone di un ruolo dentro la modale: e' cosi' che si guarda tutta la porta. */
function roleRadioBox(role) {
  // Due selettori, perche' quello che finisce nel DOM e' la CLASSE di antd e non sempre l'attributo
  // della direttiva: cercare solo `label[nz-radio-button]` faceva sparire il passo in silenzio, che e'
  // il difetto peggiore di un arnese - «zero problemi» e «non ho guardato» si leggono uguali.
  const nodes = document.querySelectorAll('label[nz-radio-button], .ant-radio-button-wrapper');
  const node = [...nodes].find((one) => (one.textContent ?? '').trim() === role);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/**
 * Quanti nomi la modale elenca e quanti di loro NON hanno un numero del motore.
 *
 * La domanda dell'operatore («come mai non mi esce il portiere Martinez dell'Inter?») era proprio
 * questa: chi sta sotto la soglia delle presenze non ha un GAIN, e la lista da cui si scegli a mano lo
 * nascondeva. Il trattino e' il segno che c'e' e che il suo numero non si sa.
 */
function modalUnpriced() {
  const rows = [...document.querySelectorAll('button[data-browse]')];
  return {
    rows: rows.length,
    dashes: rows.filter((one) => /—/.test(one.textContent ?? '')).length,
    names: rows.filter((one) => /—/.test(one.textContent ?? '')).slice(0, 3).map((one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)),
  };
}

/** Every bid row must carry a GAIN chip: the column the operator reads first. */
function gainCells() {
  const rows = [...document.querySelectorAll('button[data-bid]')];
  return {
    rows: rows.length,
    withGain: rows.filter((one) => one.querySelector('[data-cell="gain"] ui-gain')).length,
    // A chip with no colour is a chip that says nothing: `ignoto` draws a dash instead.
    coloured: rows.filter((one) => {
      const chip = one.querySelector('[data-cell="gain"] span');
      return chip && /bg-/.test(chip.className ?? '');
    }).length,
  };
}

/** The contested names, read across the rivals instead of down each one's list. */
function readContested() {
  const rows = [...document.querySelectorAll('[data-contested]')];
  return {
    rows: rows.length,
    // Every row has to say who is favourite - even if the answer is «nobody», which is a dash.
    named: rows.filter((one) => (one.textContent ?? '').trim().length > 10).length,
  };
}

/** The «escludi e ricalcola» button inside an open bid panel. */
function banBox() {
  const node = [...document.querySelectorAll('[data-panel="alternatives"] button')].find((one) =>
    /Escludi e ricalcola/i.test(one.textContent ?? ''));
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/** ...and the chips that list who is excluded, so the gesture can be undone. */
function bannedChips() {
  const strip = [...document.querySelectorAll('div')].find((one) =>
    /Esclusi dal tabellone/i.test(one.textContent ?? '') && one.querySelectorAll('button').length < 8);
  const chips = strip ? [...strip.querySelectorAll('button')] : [];
  const box = chips[0]?.getBoundingClientRect();
  return {
    count: chips.length,
    first: chips[0]?.textContent.trim().slice(0, 40) ?? null,
    firstBox: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
  };
}

/** The four departments of our own squad, each with a verdict and a sentence. */
function readAdvice() {
  const rows = [...document.querySelectorAll('[data-advice]')];
  return {
    rows: rows.length,
    roles: rows.map((one) => one.dataset.advice),
    withWords: rows.filter((one) => (one.textContent ?? '').length > 120).length,
    // The number the verdict is DECIDED on has to be on screen beside the word, or «scoperto» is a
    // claim nobody can check: «N maglie vuote su M». One per department, and the module is named in
    // every sentence so the target can be doubted where it is used.
    withHoles: rows.filter((one) => /maglie vuote su \d/.test(one.textContent ?? '')).length,
    named: rows.filter((one) => /\d-\d-\d/.test(one.textContent ?? '')).length,
    words: rows.map((one) => (one.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 150)),
  };
}

/**
 * THE MODULE THE ENVELOPES ARE TUNED ON, declared beside the plan's own title.
 *
 * Measured and not assumed, because it is a choice the operator has to be able to refuse: a target that
 * lives only inside the solver is a target nobody can correct.
 */
function readReference() {
  const title = [...document.querySelectorAll('h2')].find((one) =>
    (one.textContent ?? '').startsWith('Le tue buste'),
  );
  const tag = title?.parentElement?.querySelector('nz-tag');
  return { found: !!tag, name: tag?.textContent?.trim() ?? null };
}

/** What actually sits under a point - the only honest answer to «is the control reachable». */
function under(point) {
  const node = document.elementFromPoint(point.x, point.y);
  if (!node) return { tag: null, path: null };
  const path = [];
  for (let at = node; at && path.length < 4; at = at.parentElement) {
    path.push(at.tagName.toLowerCase() + (at.className ? `.${String(at.className).split(' ')[0]}` : ''));
  }
  return { tag: node.tagName.toLowerCase(), path: path.join(' < '), inButton: !!node.closest('button') };
}

function panelOpen() {
  const panel = document.querySelector('[data-panel="alternatives"]');
  const options = panel ? [...panel.querySelectorAll('button[data-alt]')] : [];
  const box = (node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  };
  return {
    open: !!panel,
    options: options.length,
    first: options[0]?.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) ?? null,
    firstId: options[0] ? Number(options[0].dataset.alt) : null,
    firstBox: options[0] ? box(options[0]) : null,
  };
}

function pageBox() {
  const doc = document.documentElement;
  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    scrollHeight: doc.scrollHeight,
    clientHeight: doc.clientHeight,
  };
}

/** The name of the first team card - what a roster hover has to be aimed at. */
function teamNameBox() {
  const node = document.querySelector('[data-team] span');
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/** The first GAIN cell of the plan: the chip whose hover has to explain where the number comes from. */
function gainBox() {
  const node = document.querySelector('[data-cell="gain"]');
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function popoverShown() {
  const panel = document.querySelector('.ant-popover-inner');
  return { shown: !!panel, text: (panel?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) };
}

function tooltipShown() {
  const tip = document.querySelector('.ant-tooltip-inner');
  return { shown: !!tip, text: (tip?.textContent ?? '').trim().slice(0, 160) };
}

function countTooltipTargets() {
  return document.querySelectorAll('[nz-tooltip], .ant-tooltip-open').length;
}

/** The plan's own footer: the ceiling, what it expects to pay, and how many envelopes it expects. */
function readFooter() {
  const heading = [...document.querySelectorAll('h2')].find((one) =>
    /Le tue buste/i.test(one.textContent ?? ''));
  const text = (heading?.closest('nz-card')?.textContent ?? '').replace(/\s+/g, ' ');
  const expected = text.match(/Spesa attesa\s+([\d.,]+)\s+dei\s+(\d+)\s+del tetto/);
  const wins = text.match(/buste attese\s+([\d.,]+)\s+di\s+(\d+)/);
  // Angular's number pipe runs in the build's locale, so the decimal mark can be a dot OR a comma.
  // The first version stripped every dot as a thousands separator and turned «7.3» into 73 - a parser
  // that reads the page wrong reports a defect that is its own.
  const num = (v) => {
    if (v == null) return null;
    const text = String(v).trim();
    return Number(/,\d+$/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, ''));
  };
  return {
    ceiling: expected ? Number(expected[2]) : null,
    expectedSpend: expected ? num(expected[1]) : null,
    expectedWins: wins ? num(wins[1]) : null,
    ofBids: wins ? Number(wins[2]) : null,
  };
}

/** The first row's offer and the percentage beside it - the pair the operator watches while typing. */
function firstRow() {
  const row = document.querySelector('button[data-bid]')?.parentElement;
  if (!row) return null;
  const input = row.querySelector('[data-cell="offer"] input');
  const chance = row.querySelector('[data-cell="chance"]');
  return {
    fcId: Number(row.querySelector('button[data-bid]').dataset.bid),
    offer: input ? Number(input.value) : null,
    editable: !!input,
    chance: (chance?.textContent ?? '').trim(),
  };
}

/**
 * The box of a NAMED cell of the first bid row - `data-cell`, so a new column cannot move the target.
 *
 * Searched from the ROW and not from inside the button: the offer became an editable field and moved
 * OUT of the button (an input inside a button is not a control anybody can use), so a descendant
 * selector stopped matching. It returned null, and «the cell does not exist» reads exactly like «the
 * field is not editable» - the harness blamed the page for its own selector.
 */
function cellBox(name) {
  const row = document.querySelector('button[data-bid]')?.parentElement;
  const node = row?.querySelector(`[data-cell="${name}"]`);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/** The box of the first button whose text matches, so a REAL pointer can be sent to it. */
function buttonBox(text) {
  const node = [...document.querySelectorAll('button')].find((one) =>
    new RegExp(text, 'i').test(one.textContent ?? ''));
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function storedLogs() {
  try {
    return JSON.parse(localStorage.getItem('fantassistant.sealedBid.logs') ?? 'null');
  } catch {
    return null;
  }
}

/** Seed the NEXT export, built from the envelopes we actually recorded. */
function seedSecond(payload) {
  const { awards } = payload;
  const snaps = JSON.parse(localStorage.getItem('fantassistant.sealedBid.snapshots'));
  localStorage.setItem('fantassistant.sealedBid.snapshots', JSON.stringify([snaps[0], awards]));
  return true;
}

/** What the «com'è andata» strip says, if it is there at all. */
function readSettled() {
  const strip = [...document.querySelectorAll('div')].find((one) =>
    /com'è andata/i.test(one.textContent ?? '') && one.querySelectorAll('div').length < 6);
  if (!strip) return { shown: false };
  const text = strip.textContent.replace(/\s+/g, ' ');
  const won = text.match(/(\d+)\s+vinte su\s+(\d+)/);
  const spent = text.match(/(\d+)\s+crediti/);
  const foreseen = text.match(/ne prevedeva\s+([\d.,]+)/);
  const tied = text.match(/(\d+)\s+in parità/);
  return {
    shown: true,
    text: text.slice(0, 200),
    won: won ? Number(won[1]) : null,
    sent: won ? Number(won[2]) : null,
    spent: spent ? Number(spent[1]) : null,
    foreseen: foreseen ? Number(String(foreseen[1]).replace(',', '.')) : null,
    tied: tied ? Number(tied[1]) : 0,
  };
}

// ------------------------------------------------------------------ pointer

async function hover(session, point) {
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, buttons: 0,
  });
}

async function realClick(session, point) {
  await hover(session, point);
  await wait(80);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
  });
}

const centre = (box) => ({ x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 2) });

/**
 * Take the pointer off whatever it is standing on, and let the overlays close.
 *
 * CDP moves are TELEPORTS: the pointer stays exactly where the last step left it, so a popover opened
 * on a gain chip is still open - and still covering the row - when the next step tries to type into the
 * offer field. A person's hand never does that. Measured on 25/08/2026: without this the offer field
 * read «95 typed, 55 in the box» and the tooltip step reported «nessuna spiegazione», and under the
 * field `document.elementFromPoint` answered `div.min-w-64`, which is the stats popover.
 */
async function rest(session) {
  await hover(session, { x: 4, y: 4 });
  await wait(300);
}

/**
 * Type into whatever is under a point, the way a person does: click it, clear it, write.
 *
 * The field is cleared with BACKSPACE and not with Ctrl+A, which is what the first version did: the
 * shortcut reached the document instead of the input, selected the whole page, left every word
 * highlighted in the screenshot - and the replacement silently missed, so the harness walked away
 * having changed a value it believed it had put back. A real pointer proves the control is reachable;
 * real keys prove it accepts what a person would type.
 */
async function typeInto(session, point, text) {
  await hover(session, point);
  await wait(80);
  // A TRIPLE CLICK, which is how a person replaces the contents of a field. Backspace was tried first
  // and does not clear this one, so `insertText` APPENDED: typing 141 over 101 gave 101141, which the
  // field's own maximum then truncated to the credits available - and the harness read that as the app
  // refusing the number. The gesture was wrong, not the control.
  for (const clickCount of [1, 2, 3]) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount,
    });
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount,
    });
  }
  await wait(120);
  await session.send('Input.insertText', { text });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  await session.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
  });
  await wait(350);
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const csv = value('--csv', null);
  const team = value('--team', null);
  const settings = {
    budget: Number(value('--budget', '1000')),
    rounds: Number(value('--rounds', '9')),
    roleLock: !flag('--no-role-lock'),
  };

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-bid-'));
  const debugPort = Number(value('--port', '9334'));
  const url = `http://127.0.0.1:${port}/sealed-bid`;
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--window-size=${value('--width', '1600')},${value('--height', '1000')}`,
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

    // ------------------------------------------------------ the empty state
    let empty = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      empty = await evaluate(session, emptyState);
      if (empty?.hasUpload) break;
      await wait(500);
    }
    note('la pagina apre senza file', {
      said: `${empty?.cards ?? 0} card, vuoto=${empty?.hasEmpty}, bottone di caricamento=${empty?.hasUpload}`,
      problems: [
        ...(empty?.hasUpload ? [] : ['non c\'è il bottone per caricare le rose']),
        ...(empty?.hasEmpty ? [] : ['senza file la pagina non dice cosa fare']),
      ],
    });

    if (!csv) {
      note('nessun --csv', { said: 'solo lo stato vuoto è stato misurato' });
    } else {
      // ---------------------------------------------------- seed a real round
      const text = await readFile(csv, 'utf8');
      const awards = [];
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('$')) continue;
        const last = line.lastIndexOf(',');
        const prev = line.lastIndexOf(',', last - 1);
        if (last < 0 || prev < 0) continue;
        const one = { team: line.slice(0, prev).trim(), fcId: Number(line.slice(prev + 1, last)), paid: Number(line.slice(last + 1)) };
        if (one.team && Number.isFinite(one.fcId) && Number.isFinite(one.paid)) awards.push(one);
      }
      if (!awards.length) throw new Error(`no awards parsed from ${csv}`);
      const mine = team ?? awards[0].team;
      await evaluate(session, seed, { awards, team: mine, settings });
      await session.send('Page.reload');
      await wait(1500);

      let plan = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        plan = await evaluate(session, readPlan);
        if (plan?.bids?.length) break;
        await wait(500);
      }
      const teams = await evaluate(session, readTeams);
      const slots = plan?.bids?.length ?? 0;
      note('il piano si disegna', {
        said: `${awards.length} aggiudicati letti · squadra «${mine}» · ${slots} buste · `
          + `${plan?.spend ?? '?'} di ${plan?.budget ?? '?'} crediti`,
        problems: [
          ...(slots ? [] : ['nessuna busta disegnata']),
          ...(plan?.spend != null && plan?.budget != null && plan.spend > plan.budget
            ? [`il piano spende ${plan.spend} contro un budget di ${plan.budget}`] : []),
          ...(plan?.bids?.some((one) => !one.role)
            ? ['una busta è senza ruolo disegnato'] : []),
        ],
      });
      note('le squadre si disegnano', {
        said: `${teams.count} card, ${teams.withTargets} con i probabili obiettivi, ${teams.withOurs} `
          + `con le nostre buste, ${teams.stars * 0.5} giudizi in stelline, ${teams.locks} ruoli chiusi`,
        problems: [
          ...(teams.count >= 2 ? [] : [`solo ${teams.count} card di squadra`]),
          ...(teams.withTargets === teams.count - 1
            ? [] : [`${teams.withTargets} card con obiettivi, ne servivano ${teams.count - 1} (tutte tranne la mia)`]),
          ...(teams.withOurs === 1 ? [] : ['la nostra card non mostra le nostre buste']),
          // Two ratings per card - la rosa e la condotta - so a card with one is a card that lost one.
          ...(teams.stars === teams.count * 2
            ? [] : [`${teams.stars} stelline su ${teams.count * 2} attese (due per squadra)`]),
        ],
      });

      // ---------------------------------------------------- the GAIN column, and the advice card
      const gains = await evaluate(session, gainCells);
      note('ogni busta porta il suo GAIN', {
        said: `${gains.withGain} righe su ${gains.rows} col riquadro, ${gains.coloured} colorate`,
        problems: [
          ...(gains.rows && gains.withGain === gains.rows
            ? [] : [`${gains.withGain} righe col GAIN su ${gains.rows}`]),
          ...(gains.coloured > 0 ? [] : ['nessun riquadro del GAIN è colorato: la fascia non si vede']),
        ],
      });

      const advice = await evaluate(session, readAdvice);
      note('la rosa è giudicata reparto per reparto', {
        said: `${advice.rows} reparti (${advice.roles.join(' ')}), ${advice.withWords} con un consiglio scritto, ` +
          `${advice.withHoles} col numero dei posti vuoti, ${advice.named} che nominano il modulo`,
        problems: [
          ...(advice.rows === 4 ? [] : [`${advice.rows} reparti invece di 4`]),
          ...(advice.withWords === advice.rows
            ? [] : [`${advice.withWords} reparti su ${advice.rows} portano un consiglio`]),
          // The keepers are exempt by design (their rule is the SHIRT, not a count of places), so three
          // of four is the target here and the count says which.
          ...(advice.withHoles >= advice.rows - 1
            ? [] : [`solo ${advice.withHoles} reparti su ${advice.rows} dicono quante maglie restano vuote`]),
        ],
      });
      const reference = await evaluate(session, readReference);
      note('le buste dicono su quale modulo sono tarate', {
        said: reference.found ? `modulo di riferimento «${reference.name}»` : 'nessun modulo dichiarato',
        problems: [
          ...(reference.found ? [] : ['il modulo su cui è tarato il piano non è a schermo']),
          ...(/^\d-\d-\d$/.test(reference.name ?? '')
            ? [] : [`«${reference.name}» non è un modulo`]),
        ],
      });

      // ---------------------------------------------------- the gesture, with a REAL pointer
      const first = plan?.bids?.[0];
      if (!first) {
        note('il gesto', { said: 'saltato: nessuna busta', problems: ['non c\'è niente su cui cliccare'] });
      } else {
        const point = centre(first.box);
        const sits = await evaluate(session, under, point);
        await realClick(session, point);
        await wait(350);
        const panel = await evaluate(session, panelOpen);
        note('un puntatore vero apre le alternative', {
          said: `sotto il punto (${point.x},${point.y}) c'è ${sits.path} · pannello=${panel.open}, `
            + `${panel.options} alternative · prima: ${panel.first ?? '-'}`,
          problems: [
            ...(sits.inButton ? [] : [`il punto centrale della riga non è dentro un <button>: ${sits.path}`]),
            ...(panel.open ? [] : ['il click con un puntatore vero non ha aperto le alternative']),
            ...(panel.open && !panel.options ? ['il pannello è aperto e non offre nessuna alternativa'] : []),
          ],
        });

        // ------------------------------------------------- swapping one row must not move the others
        if (panel.open && panel.firstBox) {
          const before = plan.bids.map((one) => one.fcId);
          await realClick(session, centre(panel.firstBox));
          await wait(400);
          const after = await evaluate(session, readPlan);
          const changed = after.bids.filter((one, at) => one.fcId !== before[at]).length;
          const arrived = after.bids.some((one) => one.fcId === panel.firstId);
          note('sostituire un nome cambia UNA riga sola', {
            said: `${changed} righe cambiate su ${before.length} · ora ${after.spend} di ${after.budget} crediti`,
            problems: [
              ...(changed === 1 ? [] : [`cambiate ${changed} righe: una sostituzione deve toccare solo il proprio slot`]),
              ...(arrived ? [] : ['il nome scelto fra le alternative non è entrato nel piano']),
              ...(after.bids.length === before.length
                ? [] : [`il piano è passato da ${before.length} a ${after.bids.length} buste`]),
            ],
          });
        }
      }

      // ---------------------------------------------------- what it EXPECTS to pay, not its ceiling
      const footer = await evaluate(session, readFooter);
      note('il piano dice la spesa attesa e non solo il tetto', {
        said: `tetto ${footer.ceiling} · spesa attesa ${footer.expectedSpend} · `
          + `buste attese ${footer.expectedWins} di ${footer.ofBids}`,
        problems: [
          ...(footer.expectedSpend != null ? [] : ['la spesa attesa non è sullo schermo']),
          ...(footer.expectedWins != null ? [] : ['le buste attese non sono sullo schermo']),
          // Losing costs nothing, so the forecast must sit strictly under the worst case - and under
          // the count of envelopes, or the page is claiming every single one is a certainty.
          ...(footer.expectedSpend != null && footer.ceiling != null && footer.expectedSpend < footer.ceiling
            ? [] : [`spesa attesa ${footer.expectedSpend} non sotto il tetto ${footer.ceiling}`]),
          ...(footer.expectedWins != null && footer.ofBids != null && footer.expectedWins < footer.ofBids
            ? [] : [`buste attese ${footer.expectedWins} non sotto le ${footer.ofBids} spedite`]),
        ],
      });

      // ---------------------------------------------------- writing your own number
      await rest(session);
      const before = await evaluate(session, firstRow);
      const offerCell = await evaluate(session, cellBox, 'offer');
      // WHAT SITS UNDER THE FIELD, before typing into it. `element.click()` proves nothing about a
      // control (app/CLAUDE.md, the filter funnels of 20/08), and neither does a value that fails to
      // change: without this line «the app refused my number» and «the pointer never reached the
      // input» read exactly the same.
      if (offerCell) {
        const sits = await evaluate(session, under, centre(offerCell));
        note('sotto il campo dell offerta', { said: `${sits.path}` });
      }
      if (!before?.editable || !offerCell) {
        note('scrivere la propria offerta', {
          said: 'saltato',
          problems: ["l'offerta della prima riga non è un campo modificabile"],
        });
      } else {
        // The box is re-read before EVERY keystroke sequence: changing the offer can make the
        // over-budget banner appear or vanish, which moves every row under it. Reusing the first
        // rectangle typed into whatever had slid into that place - and the run then reported the app
        // refusing a value it had never been given.
        const at = async () => centre(await evaluate(session, cellBox, 'offer'));
        const raised = String(before.offer + 40);
        await typeInto(session, await at(), raised);
        const up = await evaluate(session, firstRow);
        await typeInto(session, await at(), '1');
        const down = await evaluate(session, firstRow);
        const pct = (text) => (text === '?' ? null : Number(String(text).replace('%', '')));
        note('la percentuale segue il numero che scrivi', {
          said: `${before.offer} → ${before.chance} · ${up.offer} → ${up.chance} · ${down.offer} → ${down.chance}`,
          problems: [
            ...(up.offer === before.offer + 40 ? [] : [`ho scritto ${raised} e il campo legge ${up.offer}`]),
            ...(down.offer === 1 ? [] : [`ho scritto 1 e il campo legge ${down.offer}`]),
            // Monotone by construction - a bigger envelope cannot be less likely to win - so if this
            // fails the percentage is not being recomputed from the number beside it.
            ...(pct(up.chance) != null && pct(before.chance) != null && pct(up.chance) >= pct(before.chance)
              ? [] : [`alzando l'offerta la probabilità è scesa: ${before.chance} -> ${up.chance}`]),
            ...(pct(down.chance) != null && pct(up.chance) != null && pct(down.chance) <= pct(up.chance)
              ? [] : [`abbassando l'offerta a 1 la probabilità è salita: ${up.chance} -> ${down.chance}`]),
          ],
        });
        // Put the suggestion back, and CHECK that it went back: the first version assumed it had and
        // left the page showing a one-credit bid it had typed itself, in the screenshot and in every
        // measurement after it. A restore nobody verifies is a mutation.
        const backAt = await at();
        const sitsBack = await evaluate(session, under, backAt);
        await typeInto(session, backAt, String(before.offer));
        const restored = await evaluate(session, firstRow);
        note('sotto il campo al ripristino', {
          said: `(${backAt.x},${backAt.y}) ${sitsBack.path} · campo=${restored.offer}`,
        });
        note("l'offerta torna com'era", {
          said: `${restored.offer} (era ${before.offer})`,
          problems: restored.offer === before.offer
            ? []
            : [`ripristino fallito: il campo legge ${restored.offer} invece di ${before.offer}`],
        });
      }

      // ---------------------------------------------------- i nomi contesi, e l'esclusione
      const contested = await evaluate(session, readContested);
      note('i nomi contesi dicono chi è il favorito', {
        said: `${contested.rows} nomi, ${contested.named} con la riga piena`,
        problems: [
          ...(contested.rows > 0 ? [] : ['la card dei nomi contesi è vuota']),
          ...(contested.named === contested.rows
            ? [] : [`${contested.named} righe piene su ${contested.rows}`]),
        ],
      });

      // The panel of the first bid is opened again - the swap above closed it - so the exclusion has
      // something to act on.
      await rest(session);
      const rowNow = await evaluate(session, readPlan);
      if (rowNow.bids.length) {
        await realClick(session, centre(rowNow.bids[0].box));
        await wait(350);
        const ban = await evaluate(session, banBox);
        if (!ban) {
          note('escludere un nome', { said: 'saltato', problems: ['non trovo «Escludi e ricalcola»'] });
        } else {
          const before = rowNow.bids.map((one) => one.fcId);
          await realClick(session, centre(ban));
          await wait(500);
          const after = await evaluate(session, readPlan);
          const chips = await evaluate(session, bannedChips);
          note('un nome escluso esce dal tabellone e il piano si rifà', {
            said: `${before.length} → ${after.bids.length} buste · ${chips.count} esclusi in elenco: ${chips.first ?? '-'}`,
            problems: [
              ...(after.bids.some((one) => one.fcId === before[0])
                ? ['il nome escluso è ancora nel piano'] : []),
              ...(chips.count === 1 ? [] : [`${chips.count} nomi nell'elenco degli esclusi, ne serviva 1`]),
              // Re-solving is the POINT of this gesture, so the plan must still be a full plan.
              ...(after.bids.length >= before.length - 1
                ? [] : [`il piano è passato da ${before.length} a ${after.bids.length} buste`]),
            ],
          });
          if (chips.firstBox) {
            await realClick(session, centre(chips.firstBox));
            await wait(450);
            const back = await evaluate(session, bannedChips);
            note('e si può rimettere', {
              said: `${back.count} esclusi`,
              problems: back.count === 0 ? [] : ['il nome escluso non torna sul tabellone'],
            });
          }
        }
      }

      // ---------------------------------------------------- taking an envelope OUT and putting one IN
      await rest(session);
      const dropTarget = await evaluate(session, dropBox);
      if (!dropTarget) {
        note('togliere una busta', { said: 'saltato', problems: ['non trovo il bottone per togliere una busta'] });
      } else {
        const beforeDrop = await evaluate(session, readPlan);
        const sits = await evaluate(session, under, centre(dropTarget));
        await realClick(session, centre(dropTarget));
        await wait(350);
        const afterDrop = await evaluate(session, readPlan);
        note('una busta si può togliere', {
          said: `sotto il bottone c'è ${sits.path} · ${beforeDrop.bids.length} → ${afterDrop.bids.length} buste`,
          problems: [
            ...(sits.inButton ? [] : [`il centro del bottone non è dentro un <button>: ${sits.path}`]),
            ...(afterDrop.bids.length === beforeDrop.bids.length - 1
              ? [] : [`le buste sono passate da ${beforeDrop.bids.length} a ${afterDrop.bids.length}`]),
            ...(afterDrop.bids.some((one) => one.fcId === dropTarget.fcId)
              ? ['la busta tolta è ancora nel piano'] : []),
            // The slot must stay EMPTY: a screen that answers a deletion with another name has not
            // done what was asked.
            ...(afterDrop.spend <= beforeDrop.spend ? [] : ['togliendo una busta il tetto è salito']),
          ],
        });

        // ...and now put one back, from the whole role
        await rest(session);
        const addBox = await evaluate(session, buttonBox, 'Aggiungi');
        if (!addBox) {
          note('aggiungere una busta', { said: 'saltato', problems: ['non trovo il bottone «Aggiungi»'] });
        } else {
          await realClick(session, centre(addBox));
          await wait(500);
          let modal = await evaluate(session, modalRows);
          note('la modale mostra tutto il ruolo, con la validità di ogni busta', {
            said: `aperta=${modal.open} · ruolo=${modal.role} · ${modal.rows} liberi, ${modal.judged} giudicati · primo: ${modal.first ?? '-'}`,
            problems: [
              ...(modal.open ? [] : ['il click non ha aperto la modale']),
              ...(modal.rows > 0 ? [] : ['la modale non elenca nessun giocatore']),
              ...(modal.judged > 0 ? [] : ['nessuna riga dice se la busta sarebbe valida']),
            ],
          });
          // ...e la PORTA per intero, che e' la lista in cui l'operatore cercava il terzo portiere.
          const keeperTab = await evaluate(session, roleRadioBox, 'P');
          if (!keeperTab) {
            note('la modale elenca anche chi il motore non prezza', {
              said: 'saltato',
              problems: ['non trovo il selettore del ruolo dentro la modale'],
            });
          } else {
            await realClick(session, centre(keeperTab));
            await wait(450);
            const keepers = await evaluate(session, modalUnpriced);
            note('la modale elenca anche chi il motore non prezza', {
              said: `${keepers.rows} portieri liberi, ${keepers.dashes} senza numero, i primi: ${keepers.names.join(' | ')}`,
              problems: [
                ...(keepers.rows > 0 ? [] : ['nessun portiere elencato']),
                // Sotto la soglia delle presenze della lega ci sono 43 portieri su 72 in questo bundle:
                // se il trattino non compare mai, la lista sta di nuovo nascondendo chi non ha un numero.
                ...(keepers.dashes > 0
                  ? [] : ['nessuna riga senza numero: la lista nasconde chi il motore non prezza']),
              ],
            });
          }

          // Si torna al ruolo su cui la modale era aperta e si RILEGGE la lista: le coordinate di prima
          // erano di un'altra lista, e cliccarle avrebbe aggiunto (o non aggiunto) un altro nome.
          if (keeperTab && modal.role) {
            const backTab = await evaluate(session, roleRadioBox, modal.role);
            if (backTab) {
              await realClick(session, centre(backTab));
              await wait(450);
            }
            modal = await evaluate(session, modalRows);
          }

          if (modal.firstBox) {
            const beforeAdd = await evaluate(session, readPlan);
            await realClick(session, centre(modal.firstBox));
            await wait(450);
            const afterAdd = await evaluate(session, readPlan);
            // QUESTA asserzione ha già trovato un difetto vero (25/08/2026) e per questo va letta come
            // una guardia e non come una formalità: `swaps` è indicizzato sull'uomo che il risolutore
            // aveva proposto, `extras` su quello aggiunto a mano, e la stessa persona può essere tutt'e
            // due. Con la ricerca degli swap applicata anche agli extra, aggiungere proprio l'uomo che
            // era stato sostituito metteva in busta il SOSTITUTO: 265 crediti su 257 per un nome che
            // nessuno aveva scelto due volte, e il nome scelto da nessuna parte.
            note('un nome scelto a mano entra nel piano', {
              said: `${beforeAdd.bids.length} → ${afterAdd.bids.length} buste · ${afterAdd.spend} di ${afterAdd.budget}`,
              problems: [
                ...(afterAdd.bids.length === beforeAdd.bids.length + 1
                  ? [] : [`le buste sono passate da ${beforeAdd.bids.length} a ${afterAdd.bids.length}`]),
                ...(afterAdd.bids.some((one) => one.fcId === modal.firstId)
                  ? [] : ['il nome scelto non è entrato nel piano']),
              ],
            });
          }
          // A modal that stays open covers the whole page, and every measurement after it would be
          // about the overlay: measured on 25/08/2026, it read «l'interruttore non ha disegnato
          // nessuna rosa» about a click that never reached the switch, and 2.82 screens about a page
          // that is 1.9. Closed the way a person closes it, and CHECKED.
          await session.send('Input.dispatchKeyEvent', {
            type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
          });
          await session.send('Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
          });
          await wait(500);
          const closedModal = await evaluate(session, modalRows);
          note('la modale si chiude', {
            said: closedModal.open ? 'ancora aperta' : 'chiusa',
            problems: closedModal.open ? ['la modale non si chiude con Esc'] : [],
          });
        }
      }

      // ---------------------------------------------------- the rosters, drawn in full
      await rest(session);
      const rosterSwitch = await evaluate(session, rosterSwitchBox);
      if (!rosterSwitch) {
        note('mostrare le rose', { said: 'saltato', problems: ['non trovo l\'interruttore delle rose'] });
      } else {
        const closed = await evaluate(session, readRosters);
        await realClick(session, centre(rosterSwitch));
        await wait(400);
        const open = await evaluate(session, readRosters);
        note('le rose si aprono per intero, coi buchi dichiarati', {
          said: `riquadri GAIN ${closed.men} → ${open.men} · ${open.holes} squadre con gli slot mancanti scritti`,
          problems: [
            ...(open.men > closed.men ? [] : ['l\'interruttore non ha disegnato nessuna rosa']),
            ...(open.holes > 0 ? [] : ['nessuna squadra dice quanti slot le mancano']),
          ],
        });
        // Put it back: the height of the page is measured next, and it must be the page he opens.
        await realClick(session, centre(rosterSwitch));
        await wait(400);
      }

      // ---------------------------------------------------- one screen
      const box = await evaluate(session, pageBox);
      note('ci sta in una schermata', {
        said: `contenuto ${box.scrollWidth}x${box.scrollHeight}, finestra ${box.clientWidth}x${box.clientHeight}`,
        problems: [
          ...(box.scrollWidth <= box.clientWidth + 1
            ? [] : [`la pagina scorre in orizzontale: ${box.scrollWidth} contro ${box.clientWidth}`]),
          // TWO SCREENS is the budget since 25/08/2026 and the number is stated rather than quietly
          // raised: the operator asked for a per-department verdict and a «chi ha speso / chi ha fatto
          // l'affare» card, and both are READING and not acting - the working area (le buste, le rose)
          // still opens without scrolling. What this still catches is the runaway: a page that needs
          // three screens has stopped being usable at a table.
          ...(box.scrollHeight <= box.clientHeight * Number(value('--screens', '2.2'))
            ? [] : [`serve scorrere ${(box.scrollHeight / box.clientHeight).toFixed(2)} schermate`]),
        ],
      });

      // ---------------------------------------------------- the tooltips
      const targets = await evaluate(session, countTooltipTargets);
      // Read the boxes AGAIN: the swap above closed a panel and moved every row under it, and hovering
      // at coordinates measured before that lands on nothing. A step that reuses a stale rectangle
      // reports «no tooltip» about a tooltip that is there.
      // The box of the OFFER cell itself, by name. Computing it as «the row minus 60px» broke the moment
      // a column was added beside it, and the step then reported «no tooltip» about a tooltip that is there.
      await rest(session);
      const number = await evaluate(session, cellBox, 'offer');
      let tip = { shown: false, text: '' };
      if (number) {
        await hover(session, centre(number));
        await wait(900);
        tip = await evaluate(session, tooltipShown);
      }
      note('i numeri si spiegano', {
        said: `${targets} elementi con tooltip · sull\'offerta: ${tip.shown ? tip.text : 'nessuno'}`,
        problems: [
          ...(targets > 5 ? [] : [`solo ${targets} elementi portano un tooltip`]),
          ...(tip.shown ? [] : ['passando sul numero dell\'offerta non compare nessuna spiegazione']),
        ],
      });
      // ---------------------------------------------------- the two hovers the operator asked for
      await rest(session);
      const nameBox = await evaluate(session, teamNameBox);
      let roster = { shown: false, text: '' };
      if (nameBox) {
        await hover(session, centre(nameBox));
        await wait(900);
        roster = await evaluate(session, tooltipShown);
      }
      note('la rosa si legge passando sul nome della squadra', {
        said: roster.shown ? roster.text.slice(0, 120) : 'nessun tooltip',
        problems: [
          ...(roster.shown ? [] : ['passando sul nome di una squadra non compare la rosa']),
          // A LIST and not a paragraph: the operator asked for role, name, club, gain and price, so
          // the hover has to carry the credits it cost as well as the men.
          ...(/crediti spesi/i.test(roster.text) ? [] : ['la rosa nel tooltip non dice quanto ha speso']),
        ],
      });

      await rest(session);
      const gainCell = await evaluate(session, gainBox);
      let stats = { shown: false, text: '' };
      if (gainCell) {
        await hover(session, centre(gainCell));
        await wait(1000);
        stats = await evaluate(session, popoverShown);
      }
      note('il GAIN si spiega con le statistiche delle due stagioni', {
        said: stats.shown ? stats.text.slice(0, 140) : 'nessun popover',
        problems: [
          ...(stats.shown ? [] : ['passando sul GAIN non compaiono le statistiche']),
          ...(/Media voto/i.test(stats.text) ? [] : ['il popover del GAIN non porta la media voto']),
          ...(/Partite a voto/i.test(stats.text) ? [] : ['il popover del GAIN non porta le partite a voto']),
        ],
      });

      // ---------------------------------------------------- registering the envelopes, and surviving a reload
      //
      // LAST on purpose: it writes a synthetic next round into storage, which fills our slots and
      // empties the plan. Measuring the screen after it would be measuring a page nobody will see -
      // and the first version did exactly that, reporting «no tooltip» about a row that no longer
      // existed.
      const registerBox = flag('--keep-plan')
        ? null
        : await evaluate(session, buttonBox, 'Registra queste buste');
      if (flag('--keep-plan')) {
        note('registro e riepilogo', { said: 'saltati (--keep-plan): la pagina resta al round 2' });
      } else if (!registerBox) {
        note('registrare le buste', { said: 'saltato', problems: ['non trovo il bottone «Registra queste buste»'] });
      } else {
        const sits = await evaluate(session, under, centre(registerBox));
        await realClick(session, centre(registerBox));
        await wait(300);
        const saved = await evaluate(session, storedLogs);
        await session.send('Page.reload');
        await wait(1800);
        const afterReload = await evaluate(session, storedLogs);
        note('un puntatore vero registra le buste, e sopravvivono a un refresh', {
          said: `sotto il bottone c'è ${sits.path} · ${saved?.[0]?.bids?.length ?? 0} buste salvate, `
            + `${afterReload?.[0]?.bids?.length ?? 0} dopo il refresh`,
          problems: [
            ...(sits.inButton ? [] : [`il centro del bottone non è dentro un <button>: ${sits.path}`]),
            ...(saved?.[0]?.bids?.length ? [] : ['il click non ha salvato nessuna busta']),
            ...(afterReload?.[0]?.bids?.length === saved?.[0]?.bids?.length
              ? [] : ['le buste registrate non sopravvivono a un refresh']),
            // The chance has to be stored WITH the bid, or the forecast can never be scored honestly.
            ...(saved?.[0]?.bids?.every((one) => 'chance' in one)
              ? [] : ['una busta registrata non porta la probabilità che aveva quando è stata spedita']),
          ],
        });

        // ------------------------------------------------- and now the round that follows it
        const log = afterReload?.[0];
        if (log?.bids?.length >= 4) {
          const rival = awards.find((one) => one.team !== mine)?.team ?? 'Rivale';
          const taken = log.bids.slice(0, log.bids.length - 3);
          const lost = log.bids[log.bids.length - 3];
          const second = [
            ...awards,
            ...taken.map((one) => ({ team: mine, fcId: one.fcId, paid: one.offer })),
            { team: rival, fcId: lost.fcId, paid: lost.offer + 10 },
            // the last two are in nobody's roster: we bid on them and they were not awarded
          ];
          await evaluate(session, seedSecond, { awards: second });
          await session.send('Page.reload');
          await wait(1800);
          const read = await evaluate(session, readSettled);
          const wantSpend = taken.reduce((sum, one) => sum + one.offer, 0);
          note('il round dopo dice com\'è andata, parità comprese', {
            said: read.shown
              ? `${read.won} vinte su ${read.sent}, ${read.spent} crediti, previste ${read.foreseen}, `
                + `${read.tied} in parità`
              : 'la striscia non compare',
            problems: [
              ...(read.shown ? [] : ['dopo l\'export del round successivo non compare il riepilogo']),
              ...(read.won === taken.length ? [] : [`vinte ${read.won}, ne avevo preparate ${taken.length}`]),
              ...(read.sent === log.bids.length ? [] : [`spedite ${read.sent}, ne erano ${log.bids.length}`]),
              ...(read.spent === wantSpend ? [] : [`spesi ${read.spent}, dovevano essere ${wantSpend}`]),
              // The two nobody was awarded: we bid on them, so somebody wrote our own number.
              ...(read.tied === 2 ? [] : [`parità ${read.tied}, dovevano essere 2`]),
              ...(read.foreseen != null ? [] : ['il riepilogo non dice quante ne prevedeva']),
            ],
          });
        }
      }

    }

    const shouted = session.noise();
    note('quello che la pagina ha detto', {
      said: shouted.length ? `${shouted.length} messaggi` : 'niente',
      problems: shouted,
    });

    const shot = await session.send('Page.captureScreenshot', { format: 'png' });
    const out = value('--shot', join(ROOT, 'dist', 'e2e-sealed-bid.png'));
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
