/**
 * e2e-plancia-order.mjs - drive the REAL plancia and measure the PERSONAL grid's hand order:
 * drag, bin, undo, reset, and the count that must not move.
 *
 * Four claims, and every one of them is about the SCREEN.
 *  - DRAG REORDERS ACROSS BLOCKS («permettimi di riordinare i calciatori tramite drag&drop», operatore
 *    23/09/2026), because the blocks of a role are one ranking cut into tens - moving a name from the
 *    third slot to the first is a move inside a list, not a removal from one set and an insert in
 *    another. The gesture is verified with a REAL pointer and CDK's own 5px threshold.
 *  - THE BIN EXISTS ONLY MID-FLIGHT and it has to RECEIVE: a target that shows and takes nothing is
 *    worse than no target (CDK computes the connected lists when the drag STARTS, so the zone lives in
 *    the DOM and only hides - measured twice at 224x56px with the name still in the list afterwards).
 *  - THE ROLE'S COUNT DOES NOT MOVE when a name is binned («il numero totale di calciatori di quel
 *    ruolo deve rimanere invariato quindi deve entrare uno dei calciatori che prima era rimasto
 *    fuori», 23/09/2026): one man comes up from the tail. The step also PRINTS where he landed, since
 *    the grid places him by its own coin and «last» is a consequence and not a rule.
 *  - AND THE HAND ORDER SURVIVES A RELOAD, while the ✕ gives the sheet's own order back.
 *
 * Zero dependencies, like the other harnesses: serves `dist/`, launches Edge or Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-plancia-order.mjs [--headed]
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

/** Le quattro lettere della plancia, nell'ordine in cui la rosa le dichiara. */
const ROLES = ['P', 'D', 'C', 'A'];

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

// ------------------------------------------------------------------ what runs IN the page

/** Where a control really is, by its visible text - and WHO is under that point. */
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
  return {
    x,
    y,
    text: (found.innerText ?? '').trim().slice(0, 40),
    // «the control is there» is a fact about the DOM; this is a fact about the SCREEN.
    reachable: found.contains(under) || under?.contains(found) || false,
  };
}

/**
 * THE WHOLE BOARD as the screen has it: per block its id, its header figure and its rows.
 *
 * A row is read as the NAME plus the LAST number of the line, which is the max-offer column - and
 * `struck` says whether it is the row the constraint pushed to the bottom, because a descent broken
 * by a man who does not play today is the rule working and not a defect.
 */
function readBoard() {
  const blocks = [...document.querySelectorAll('plancia-slot-matrix [data-block]')].filter((one) =>
    one.querySelector('button'),
  );
  if (!blocks.length) return null;
  return blocks.map((block) => {
    const header = block.firstElementChild;
    const figures = [...header.querySelectorAll('span')].map((one) => (one.innerText ?? '').trim());
    const rect = header.getBoundingClientRect();
    return {
      id: figures[0] ?? '?',
      left: Number(figures[1] ?? '0'),
      median: Number((figures[2] ?? '').replace(/[^0-9]/g, '')),
      headerAt: rect.width
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : null,
      rows: [...block.querySelectorAll('button')].map((row) => {
        const cells = [...row.querySelectorAll('span')];
        const paint = cells[0] ? getComputedStyle(cells[0]).backgroundColor : '';
        return {
          name: (row.innerText ?? '').split('\n')[0].trim(),
          offer: Number((cells.at(-1)?.innerText ?? '').replace(/[^0-9-]/g, '')),
          // IL NUMERO DI SINISTRA, che e' quello che SPIEGA l'ordine e cambia col taglio: sul mercato
          // quanto rende sopra il sei, sui personali LA MONETA (il surplus). Letto dalla terza cella DA DESTRA e
          // non dalla terza da sinistra, perche' in mezzo c'e' `ui-flags`, che disegna un numero
          // variabile di span. Il punto e' il separatore decimale di quest'app, quindi si parsa cosi'.
          lead: Number((cells.at(-3)?.innerText ?? '').replace(/[^0-9.-]/g, '')),
          // Il vincolo si legge dall'inchiostro, che e' il canale con cui la pagina lo dichiara.
          struck: getComputedStyle(row).textDecorationLine.includes('line-through'),
          // DI QUALCUNO: la barra del proprietario e' dipinta. E' il canale con cui la riga lo dice,
          // e sono le righe su cui la colonna del mercato cambia significato.
          owned: !!paint && paint !== 'transparent' && !paint.startsWith('rgba(0, 0, 0, 0'),
        };
      }),
    };
  });
}

/** Which of the two grids the buttons say is on - read from the control, never from our own state. */
/**
 * LA CARD DELLE ROSE, misurata dove vive: nello spazio che la linea dei portieri lascia libera.
 *
 * L'operatore l'ha chiesta «per rendere più evidente il cambio di contesto dai calciatori», che è
 * un'affermazione su cosa si VEDE e non sul CSS: due fondi possono essere dichiarati diversi e valere
 * due punti su 255 (misurato il 16/09 sulle bande della Strategia). Quindi il passo confronta ELEMENTI
 * DELLA STESSA PAGINA - la card, la pagina dietro di lei, un blocco accanto - e non un letterale, che
 * con due temi non vorrebbe dire niente. E normalizza prima di sottrarre: Chrome restituisce un
 * `color-mix` come `oklab(...)` e un token come `rgb(...)`, e sommare una L fra 0 e 1 a un canale fra
 * 0 e 255 è il modo in cui una sonda mente (stesso giorno, stessa pagina).
 */
function readTeamCard() {
  const strip = document.querySelector('plancia-team-grid');
  const card = strip?.parentElement;
  const block = document.querySelector('plancia-slot-matrix [data-block]');
  if (!card || !block) return null;
  const paint = (el) => getComputedStyle(el).backgroundColor;
  const box = card.getBoundingClientRect();
  return {
    card: paint(card),
    page: paint(document.body),
    block: paint(block),
    border: getComputedStyle(card).borderTopWidth,
    width: Math.round(box.width),
    height: Math.round(box.height),
    teams: strip.querySelectorAll('[role="button"]').length,
    // La card deve stare NELLA linea dei portieri: se finisse sotto la plancia sarebbe un'altra cosa.
    aboveDefence: Math.round(box.bottom) <= Math.round(
      (document.querySelector('[data-line="D"]')?.getBoundingClientRect().top ?? 0) + 2,
    ),
  };
}

/**
 * LA PLANCIA A UNA FINESTRA BASSA: i nomi si accavallano, e la plancia scorre?
 *
 * Sua segnalazione, 23/09/2026: «per altezze non sufficienti della pagina visualizza i nomi dei
 * calciatori accavallati», e il pavimento e' suo: «stringiamo fino a 11px l'altezza minima».
 *
 * QUELLO CHE DECIDE E' L'INCHIOSTRO E NON LA SCATOLA DEL FONT, e la prima versione di questa sonda
 * misurava la seconda. Il Range su un nodo di testo restituisce ascent+descent della FACCIA (14px a
 * 10px di corpo), che contiene spazio che quasi nessuna lettera usa: con quella misura una riga da
 * 11px legge 224 accavallamenti su 224 e sullo schermo non se ne tocca nessuno. «Accavallati» e' una
 * frase sui PIXEL, quindi si misura `actualBoundingBox*` sulla STRINGA di quella riga - dove i pixel
 * cadono davvero - e la scatola resta come LETTURA accanto, non come verdetto.
 *
 * L'ARNESE SI VERIFICA PRIMA DI ACCUSARE LA PAGINA: il canvas puo' risolvere una faccia diversa da
 * quella del DOM, e allora l'inchiostro sarebbe di un altro carattere. `faceGap` e' la differenza fra
 * la scatola che il canvas dichiara e quella che il Range misura, e deve essere zero.
 *
 * Lo SCROLLER e' il div dentro l'host e non l'host: `scrollHeight` sull'host legge l'altezza del
 * figlio in `h-full`, cioe' se stesso, e direbbe «non eccede» qualunque cosa succeda sotto. Anche
 * quello era un difetto della prima versione, ed e' l'asserzione circolare un'altra volta.
 */
function readSqueeze() {
  const matrix = document.querySelector('plancia-slot-matrix');
  const scroller = matrix?.firstElementChild;
  if (!scroller) return null;
  const blocks = [...matrix.querySelectorAll('[data-block]')].filter((one) =>
    one.querySelector('button'),
  );
  if (!blocks.length) return null;
  const measure = document.createElement('canvas').getContext('2d');
  const boxesOf = (button) => {
    const span = button.querySelector('span.truncate');
    if (!span?.firstChild) return null;
    const range = document.createRange();
    range.selectNodeContents(span);
    const face = range.getBoundingClientRect();
    if (!face.height) return null;
    const style = getComputedStyle(span);
    measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const m = measure.measureText(span.textContent);
    // La scatola della faccia e' centrata nella riga, quindi la BASE si ricava da lei e dalle metriche
    // del carattere; l'inchiostro si appende alla base.
    const baseline = face.top + m.fontBoundingBoxAscent;
    return {
      face,
      faceGap: Math.abs(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent - face.height),
      tallestChild: Math.max(
        ...[...button.children].map((one) => one.getBoundingClientRect().height),
      ),
      ink: {
        top: baseline - m.actualBoundingBoxAscent,
        bottom: baseline + m.actualBoundingBoxDescent,
        height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
      },
    };
  };
  let overlaps = 0;
  let boxOverlaps = 0;
  let pairs = 0;
  let worst = 0;
  let gap = Infinity;
  let rows = 0;
  let ink = 0;
  let inkName = '';
  let child = 0;
  let childOut = 0;
  let faceGap = 0;
  const heights = [];
  for (const block of blocks) {
    let previous = null;
    let previousBox = null;
    for (const button of block.querySelectorAll('button')) {
      rows += 1;
      const box = button.getBoundingClientRect();
      heights.push(box.height);
      const both = boxesOf(button);
      if (!both) continue;
      faceGap = Math.max(faceGap, both.faceGap);
      child = Math.max(child, both.tallestChild);
      if (both.tallestChild > box.height + 0.5) childOut += 1;
      if (both.ink.height > ink) {
        ink = both.ink.height;
        inkName = button.querySelector('span.truncate').textContent;
      }
      if (previous) {
        pairs += 1;
        const over = previous.bottom - both.ink.top;
        gap = Math.min(gap, -over);
        // LA TOLLERANZA E' PIU' PICCOLA DELLA COSA CHE PROTEGGE: al pavimento che l'operatore ha
        // scelto (10px) l'aria fra due nomi e' ZERO, quindi mezzo pixel di sconto lascerebbe passare
        // proprio il primo gradino di accavallamento che questo passo esiste per vedere.
        if (over > 0.2) {
          overlaps += 1;
          worst = Math.max(worst, over);
        }
        if (previousBox.bottom - both.face.top > 0.5) boxOverlaps += 1;
      }
      previous = both.ink;
      previousBox = both.face;
    }
  }
  // L'ULTIMA RIGA E' RAGGIUNGIBILE? Si porta lo scroller in fondo e si guarda se il fondo dell'ultimo
  // blocco entra nella sua finestra. Una plancia che scorre e taglia comunque l'ultimo nome sarebbe
  // il difetto di prima con una barra accanto.
  const was = scroller.scrollTop;
  scroller.scrollTop = scroller.scrollHeight;
  const view = scroller.getBoundingClientRect();
  const last = [...blocks[blocks.length - 1].querySelectorAll('button')].pop();
  const reachable = last ? last.getBoundingClientRect().bottom <= view.bottom + 1 : false;
  scroller.scrollTop = was;
  const page = document.scrollingElement;
  const round = (x) => Math.round(x * 10) / 10;
  return {
    rows,
    pairs,
    overlaps,
    boxOverlaps,
    worst: round(worst),
    gap: round(gap),
    rowMin: round(Math.min(...heights)),
    ink: round(ink),
    inkName,
    child: round(child),
    childOut,
    faceGap: round(faceGap),
    viewH: round(view.height),
    contentH: scroller.scrollHeight,
    scrollsY: scroller.scrollHeight > scroller.clientHeight + 1,
    scrollsX: scroller.scrollWidth > scroller.clientWidth + 1,
    reachable,
    pageScrolls: page.scrollHeight > page.clientHeight + 1,
  };
}

/** `rgb()`/`rgba()`/`oklab()` -> tre numeri confrontabili. Senza questo si sottraggono unità diverse. */
function channels(paint) {
  const numbers = (paint.match(/-?[0-9.]+/g) ?? []).map(Number);
  if (paint.startsWith('oklab') || paint.startsWith('oklch') || paint.startsWith('color(')) {
    return [numbers[0] * 255, numbers[1] * 255, numbers[2] * 255];
  }
  return numbers.slice(0, 3);
}
const apart = (a, b) => {
  const [x, y] = [channels(a), channels(b)];
  return Math.max(...x.map((v, at) => Math.abs(v - y[at])));
};

function readToggle() {
  const labels = [...document.querySelectorAll('header nz-radio-group label')];
  return labels.length
    ? labels.map((one) => ({
        text: (one.innerText ?? '').trim(),
        on: one.classList.contains('ant-radio-button-wrapper-checked'),
      }))
    : null;
}

/**
 * What a VISIBLE tooltip says. There is no attribute to read: the title is a property binding.
 *
 * «Visible» is the whole of it, and the first version of this step was wrong for exactly that reason:
 * ng-zorro leaves an overlay in the DOM after the pointer has left it, so the first `.ant-tooltip-inner`
 * was the RADIO BUTTON's hint from two steps earlier - a stale panel read as the block's own sentence,
 * which is the harness inventing a defect and, worse, hiding one.
 */
function readTooltip() {
  const tips = [...document.querySelectorAll('.ant-tooltip')].filter((one) => {
    if (one.classList.contains('ant-tooltip-hidden')) return false;
    const rect = one.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(one).opacity !== '0';
  });
  const inner = tips.at(-1)?.querySelector('.ant-tooltip-inner');
  return inner ? (inner.innerText ?? '').replace(/\s+/g, ' ').trim() : null;
}

// ------------------------------------------------------------------ the arithmetic, on what was read

/**
 * WHERE THE DESCENT BREAKS, which is the whole claim of the personal grid.
 *
 * Down a role the max offer may never rise, inside a block or across two - except on a row the page
 * has STRUCK, which is the man the constraint moved. It returns the offending pairs, so the report
 * can name them instead of saying «something is wrong with the order».
 */
function breaks(board, role) {
  const flat = [];
  for (const block of board.filter((one) => one.id.startsWith(role))) {
    for (const row of block.rows) flat.push({ ...row, block: block.id });
  }
  const out = [];
  for (let at = 1; at < flat.length; at += 1) {
    const up = flat[at - 1];
    const down = flat[at];
    // NESSUNA ESENZIONE, e da oggi non serve: il barrato non e' piu' un vincolo che sposta una riga
    // (era «chi oggi non gioca», ritirato il 04/09/2026) ma un fatto che il suo numero porta gia'.
    // Quindi la discesa deve valere per ogni riga, barrata compresa - un'esenzione lasciata li' dopo
    // che il vincolo e' sparito nasconderebbe un difetto vero su quelle righe.
    if (down.offer > up.offer) {
      out.push(`${down.block} ${down.name} ${down.offer} sopra ${up.block} ${up.name} ${up.offer}`);
    }
  }
  return out;
}

/**
 * IL TAGLIO dei blocchi personali, che dal 23/09/2026 e' LA MONETA e non piu' la mia max offerta -
 * e che e' tornata a essere la STESSA domanda dell'ordine, perche' la chiave e' una sola.
 *
 * La storia va tenuta perche' e' il motivo per cui questo passo esiste in due pezzi. Fino al 06/09 il
 * taglio e l'ordine erano il TETTO e `breaks` bastava; dal 06/09 il taglio restava il tetto e
 * l'ordine passava allo SWING, quindi le due invarianti si scrivevano separate; dal 23/09 la moneta
 * (il SURPLUS) fa tutt'e due, su istruzione dell'operatore - «riformare i blocchi secondo la moneta
 * che vogliamo utilizzare ... il valore per cui vengono ordinati deve essere anche quello visibile».
 * Quindi l'invariante e' di nuovo UNA e piu' forte delle due di prima: la colonna di sinistra deve
 * scendere su TUTTA la plancia del ruolo, riga dopo riga e blocco dopo blocco.
 *
 * E la max offerta ADESSO NON DEVE SCENDERE: il tetto e' letto sullo slot di MERCATO e non si
 * ri-deriva sulla griglia nuova (`regroupByCoin` dice perche'), quindi una sua risalita non e' un
 * difetto - e' la prova che quella scala non e' stata riletta su un rango che non e' il suo.
 */
function cutBreaks(board, role) {
  const blocks = board.filter((one) => one.id.startsWith(role));
  const out = [];
  for (let at = 1; at < blocks.length; at += 1) {
    const up = blocks[at - 1];
    const down = blocks[at];
    const above = up.rows.filter((row) => Number.isFinite(row.lead));
    const below = down.rows.filter((row) => Number.isFinite(row.lead));
    if (!above.length || !below.length) continue;
    const worstAbove = Math.min(...above.map((row) => row.lead));
    const bestBelow = Math.max(...below.map((row) => row.lead));
    if (bestBelow > worstAbove + 1e-9) {
      out.push(`${down.id} rende fino a ${bestBelow} mentre ${up.id} scende a ${worstAbove}`);
    }
  }
  return out;
}

/**
 * L'ORDINE DENTRO un blocco, che e' LA MONETA: il numero di sinistra deve scendere.
 *
 * E' la regola del 03/09 applicata al taglio nuovo - una colonna che spiega un ordinamento DEVE
 * essere quell'ordinamento - e si misura sullo SCHERMO e non sui nostri dati: se la pagina ordinasse
 * per una cosa e ne stampasse un'altra, questo passo e' il solo che se ne accorgerebbe.
 *
 * Chi non ha la moneta stampa `·`, che parsa NaN: si salta senza esentare chi viene dopo di lui,
 * perche' un buco in mezzo alla lista sarebbe un difetto vero e non un'assenza di dato.
 */
function orderBreaks(board, role) {
  const out = [];
  for (const block of board.filter((one) => one.id.startsWith(role))) {
    const rows = block.rows.filter((row) => Number.isFinite(row.lead));
    for (let at = 1; at < rows.length; at += 1) {
      if (rows[at].lead > rows[at - 1].lead + 1e-9) {
        out.push(
          `${block.id} ${rows[at].name} ${rows[at].lead} sopra ${rows[at - 1].name} ${rows[at - 1].lead}`,
        );
      }
    }
    if (!rows.length && block.rows.length) out.push(`${block.id}: nessuna riga porta la moneta`);
  }
  return out;
}

/** Le righe BARRATE, che sono la popolazione che la griglia personale non deve disegnare. */
function struckOf(board) {
  return (board ?? []).flatMap((block) =>
    block.rows.filter((row) => row.struck).map((row) => `${block.id} ${row.name}`),
  );
}

function names(board) {
  return board.flatMap((block) => block.rows.map((row) => row.name)).sort();
}

function shapeOf(board) {
  return (board ?? []).map((one) => `${one.id}:${one.rows.length}`).join(' ');
}
async function dragTo(session, from, to, steps = 8, midFlight = null) {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await wait(40);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1,
  });
  for (let step = 1; step <= steps; step += 1) {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * step) / steps),
      y: Math.round(from.y + ((to.y - from.y) * step) / steps),
      button: 'left',
      buttons: 1,
    });
    await wait(25);
    // A metà volo si guarda quello che esiste SOLO mentre si trascina: l'anteprima e il segnaposto.
    if (midFlight && step === Math.ceil(steps / 2)) await midFlight();
  }
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: Math.round(to.x), y: Math.round(to.y), button: 'left', clickCount: 1,
  });
  await wait(300);
}

/** IL RIORDINO A MANO della griglia personale: il trascinamento, il cestino, l'annulla, il reset. */
async function main() {
  const binary = BROWSERS.find((one) => existsSync(one));
  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-order-'));
  const debugPort = Number(await freePort());
  const url = `http://127.0.0.1:${port}/plancia`;
  const browser = spawn(binary, ['--headless=new', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--window-size=1600,1000', url], { stdio: 'ignore' });
  let session;
  const problems = [];
  const rowsOf = (role) => {
    const out = [];
    // `[data-block]` e non un cammino nell'albero: dentro questa griglia stanno anche due card
    // PROIETTATE, e da quando la seconda porta dei `<button>` un selettore strutturale prende anche
    // le sue righe - tre banchi vicini rossi insieme il 23/09, tutti e tre ad accusare la pagina.
    for (const block of document.querySelectorAll('[data-block]')) {
      const head = block.querySelector('span')?.innerText?.trim() ?? '';
      if (!head.startsWith(role)) continue;
      for (const b of block.querySelectorAll('button')) {
        out.push({ name: (b.innerText ?? '').split('\n')[0].trim(), block: head });
      }
    }
    return out;
  };
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await waitFor(session, readBoard, 120);
    const toMine = await evaluate(session, boxOf, 'header nz-radio-group label', 'personali');
    await click(session, toMine);
    await wait(500);

    const before = await evaluate(session, rowsOf, 'D');
    console.log(`. la difesa personale: ${before.length} righe, la prima e «${before[0]?.name}»`);

    // IL TRASCINAMENTO: una riga del TERZO blocco portata in cima al PRIMO. Fra blocchi e non dentro
    // uno, perche' e' il movimento che conta - i blocchi sono la stessa graduatoria tagliata a dieci.
    const from = await evaluate(session, (name) => {
      const b = [...document.querySelectorAll('[data-block] button')]
        .find((one) => (one.innerText ?? '').includes(name));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, before[22]?.name ?? '');
    const to = await evaluate(session, (name) => {
      const b = [...document.querySelectorAll('[data-block] button')]
        .find((one) => (one.innerText ?? '').includes(name));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 2 };
    }, before[0]?.name ?? '');
    const moved = before[22]?.name;
    if (!from || !to) throw new Error('non trovo le due righe da trascinare');

    // ...e a META' VOLO si guarda il CESTINO, che esiste solo mentre si trascina.
    let binSeen = null;
    await dragTo(session, from, to, 10, async () => {
      binSeen = await evaluate(session, () => {
        const el = document.querySelector('[data-bin]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
    });
    const after = await evaluate(session, rowsOf, 'D');
    console.log(`. trascinato «${moved}» in cima: ora la prima e «${after[0]?.name}»`);
    console.log(`. il cestino a meta volo: ${binSeen ? `${binSeen.w}x${binSeen.h}px` : 'NON COMPARE'}`);
    if (after[0]?.name !== moved) problems.push(`il trascinamento non ha spostato «${moved}»: la prima e «${after[0]?.name}»`);
    if (!binSeen) problems.push('il cestino non compare durante il trascinamento');

    // IL CESTINO: si butta il primo e gli altri devono SCALARE.
    if (binSeen) {
      const second = after[1]?.name;
      const grab = await evaluate(session, (name) => {
        const b = [...document.querySelectorAll('[data-block] button')]
          .find((one) => (one.innerText ?? '').includes(name));
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, after[0]?.name ?? '');
      await dragTo(session, grab, binSeen, 10);
      const dumped = await evaluate(session, rowsOf, 'D');
      console.log(`. buttato «${after[0]?.name}»: ora la prima e «${dumped[0]?.name}» (${dumped.length} righe)`);
      if (dumped.some((one) => one.name === after[0]?.name)) problems.push('il buttato e ancora in lista');
      if (dumped[0]?.name !== second) problems.push(`gli altri non scalano: dopo il buttato la prima e «${dumped[0]?.name}» invece di «${second}»`);

      // IL CONTO DEL RUOLO NON SI MUOVE, e chi entra viene dalla coda (sua richiesta del 23/09/2026).
      // Si asserisce il CONTO e si STAMPA il posto: la griglia lo colloca con la propria moneta, quindi
      // «all'ultimo posto» e' quello che succede quasi sempre e non una regola che il codice impone -
      // pretenderlo qui vorrebbe dire asserire una cosa che nessuno ha deciso.
      const had = new Set(after.map((one) => one.name));
      const fresh = dumped.filter((one) => !had.has(one.name));
      const where = fresh.map((one) => `${one.name} (${one.block}, ${dumped.indexOf(one) + 1}º di ${dumped.length})`);
      console.log(`. entrati dalla coda: ${fresh.length ? where.join(' · ') : 'NESSUNO'}`);
      if (dumped.length !== after.length) {
        problems.push(`il conto della difesa si e' mosso: ${dumped.length} righe invece di ${after.length}`);
      }
      if (fresh.length !== 1) {
        problems.push(`al posto del buttato sono entrati ${fresh.length} nomi invece di uno`);
      }

      // ...E IL BLOCCO LO DICE. Una riga senza max offerta in mezzo a nove che ce l'hanno si legge
      // come un dato perso: il tooltip del blocco in cui e' finito nomina chi e' entrato e perche' la
      // sua colonna e' vuota. Si legge APRENDOLO, perche' il titolo e' un binding di proprieta'.
      if (fresh.length === 1) {
        const head = await evaluate(session, (id) => {
          const block = [...document.querySelectorAll('[data-block]')].find(
            (one) => (one.querySelector('span')?.innerText ?? '').trim() === id,
          );
          const bar = block?.firstElementChild;
          if (!bar) return null;
          const r = bar.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, fresh[0].block);
        if (!head) problems.push(`non trovo l intestazione del blocco ${fresh[0].block}`);
        else {
          await session.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: Math.round(head.x), y: Math.round(head.y), button: 'none',
          });
          await wait(700);
          const tip = await evaluate(session, readTooltip);
          console.log(`. il blocco ${fresh[0].block} dice: «${(tip ?? '').slice(-110)}»`);
          if (!tip || !tip.includes('ripescati dalla coda')) {
            problems.push(`il blocco ${fresh[0].block} non dichiara il ripescato: «${tip}»`);
          }
          if (tip && !tip.includes(fresh[0].name)) {
            problems.push(`il blocco non NOMINA chi e entrato (${fresh[0].name})`);
          }
        }
      }

      // L'ANNULLA lo rimette, e il tasto esiste solo quando c'e' qualcosa da annullare.
      const un = await evaluate(session, boxOf, '[data-unbin]', 'buttati');
      if (!un) problems.push("il tasto «annulla l'ultima eliminazione» non c'e'");
      else {
        await click(session, un);
        await wait(400);
        const back = await evaluate(session, rowsOf, 'D');
        console.log(`. annullato: ${back.length} righe, la prima e «${back[0]?.name}»`);
        if (!back.some((one) => one.name === after[0]?.name)) problems.push('annulla non ha rimesso il buttato');
        // E IL RIPESCATO TORNA SOTTO LA LINEA: il conto e' lo stesso di prima del cestino, quindi se
        // restasse il ruolo avrebbe un uomo di troppo - il difetto opposto, e altrettanto silenzioso.
        if (back.length !== after.length) {
          problems.push(`dopo l annulla il ruolo ha ${back.length} righe invece di ${after.length}`);
        }
        if (fresh.length && back.some((one) => one.name === fresh[0].name)) {
          problems.push(`il ripescato «${fresh[0].name}» e' rimasto dopo l annulla`);
        }
      }
    }

    // LA PERSISTENZA: l'ordine e' salvato in locale, quindi sopravvive a un ricaricamento.
    await session.send('Page.navigate', { url });
    await waitFor(session, readBoard, 120);
    const again = await evaluate(session, boxOf, 'header nz-radio-group label', 'personali');
    await click(session, again);
    await wait(600);
    const reloaded = await evaluate(session, rowsOf, 'D');
    console.log(`. dopo il ricaricamento la prima e «${reloaded[0]?.name}»`);
    if (reloaded[0]?.name !== moved) problems.push(`l ordine non e' stato salvato: la prima e «${reloaded[0]?.name}» invece di «${moved}»`);

    // ...E IL RESET rimette quello del foglio.
    const reset = await evaluate(session, boxOf, '[data-reset-order]', '');
    if (!reset) problems.push('il tasto per azzerare l ordine non c e');
    else {
      await click(session, reset);
      await wait(400);
      const plain = await evaluate(session, rowsOf, 'D');
      console.log(`. azzerato: la prima e «${plain[0]?.name}» (era «${before[0]?.name}» all inizio)`);
      if (plain[0]?.name !== before[0]?.name) problems.push(`il reset non torna all ordine del foglio: «${plain[0]?.name}» invece di «${before[0]?.name}»`);
    }
  } finally {
    if (session) session.close();
    browser.kill();
    server.close();
  }
  for (const one of problems) console.log(`    ! ${one}`);
  console.log(problems.length ? `\nPROBLEMI: ${problems.length}` : '\nnessun problema');
  if (problems.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
