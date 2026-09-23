/**
 * e2e-plancia-stats.mjs - drive the REAL plancia and measure the two SETS OF NUMBERS on a row,
 * plus the floor under every offer.
 *
 * Three claims, and the first two are the operator's own sentences.
 *  - A PLAYER'S MINIMUM COST IS ONE CREDIT («vedi Zapata», 23/09/2026). At an auction you bid from
 *    one, so a ceiling that reads zero - or nothing - is not a cheaper offer, it is no offer. The
 *    case that produced it is a man RIPESCATO DALLA CODA, who has no rung on the scale at all: his
 *    figure has to read exactly the minimum, and the step bins forwards until one of them turns up.
 *  - THE SELECT SWAPS THE SET («metti una select ... default | scorso -> Pv | Mv | Fm»), and the
 *    three figures of «scorso» are MEASURES of last season. So they are compared with the BUNDLE and
 *    never with the screen: a step that derives the expected number from the number it is checking
 *    is the circular assertion this repository has paid for twice.
 *  - THE FIGURES LINE UP DOWN A BLOCK («mantieni i valori allineati verticalmente tra di loro»),
 *    which on sibling flex rows is a claim about DECLARED WIDTHS and not about `tabular-nums`: that
 *    makes digits equal to each other, never cells equal across rows. So the step counts the distinct
 *    LEFT EDGES of each numeric column inside one block - one, or they are not a column - and checks
 *    that no cell is clipped, because a declared width is a promise that can be broken by one digit.
 *  - AND THE PRICE OF THE ICONS AND OF A THIRD FIGURE IS MEASURED rather than argued: both take width
 *    from the name, so the run counts the CLIPPED names in both sets and prints them.
 *
 * Zero dependencies, like the other harnesses: serves `dist/`, launches Edge or Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-plancia-stats.mjs [--headed]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

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

/**
 * IL FOGLIO DEL MOTORE, per fare il ponte fra il NOME che si legge a schermo e l'`fc_id` con cui il
 * pacchetto tiene le stagioni. Un join per nome e' il difetto piu' ripetuto di questo repository,
 * quindi la chiave si verifica: i nomi doppi escono dal confronto e il loro numero e' stampato.
 */
async function sheetNames() {
  const manifest = JSON.parse(await readFile(join(DIST, 'data', 'manifest.json'), 'utf8'));
  const sheets = manifest.engine_sheets ?? [];
  const chosen =
    [...sheets].filter((s) => s.platform === 'default' && s.game === 'classic')
      .sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0))[0] ??
    [...sheets].sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0))[0];
  const raw = await readFile(join(DIST, 'data', chosen.path));
  const table = JSON.parse(gunzipSync(raw).toString('utf8'));
  const at = (name) => table.columns.indexOf(name);
  const [id, name] = ['fc_id', 'name'].map(at);
  const byName = new Map();
  const twice = new Set();
  for (const row of table.rows) {
    const key = String(row[name]).trim();
    if (byName.has(key)) twice.add(key);
    byName.set(key, Number(row[id]));
  }
  for (const key of twice) byName.delete(key);
  return { byName, twice: twice.size, season: manifest.input_season, platform: chosen.platform };
}

/** Pv, Mv e Fm della stagione scorsa, dalla tabella del pacchetto e non dallo schermo. */
async function lastFromBundle(season, platform) {
  const raw = await readFile(join(DIST, 'data', 'season_stats.json.gz'));
  const table = JSON.parse(gunzipSync(raw).toString('utf8'));
  const at = (name) => table.columns.indexOf(name);
  const [id, seasonAt, platformAt, pv, mv, fm] =
    ['fc_id', 'season', 'platform', 'pv', 'mv', 'fm'].map(at);
  const out = new Map();
  for (const row of table.rows) {
    if (row[seasonAt] !== season || row[platformAt] !== platform) continue;
    out.set(Number(row[id]), { pv: row[pv], mv: row[mv], fm: row[fm] });
  }
  return out;
}

/** Le righe come lo schermo le ha: il nome, le celle numeriche da destra, e se il nome e' tagliato. */
function readRows() {
  const out = [];
  for (const block of document.querySelectorAll('[data-block]')) {
    const head = block.querySelector('span')?.innerText?.trim() ?? '';
    for (const row of block.querySelectorAll('button')) {
      const cells = [...row.querySelectorAll('span')];
      const label = row.querySelector('.truncate');
      out.push({
        block: head,
        name: (row.innerText ?? '').split('\n')[0].trim(),
        // DA DESTRA, perche' in mezzo ci sono `ui-flags` e `ui-ruling-dot`, che rendono un numero
        // variabile di span: contare da sinistra leggerebbe una cella diversa riga per riga.
        figures: cells.slice(-4).map((one) => (one.innerText ?? '').trim()),
        // Un nome TAGLIATO, misurato sul contenuto e non sulla scatola: `scrollWidth` di un elemento
        // con `truncate` supera la sua larghezza esattamente quando i puntini compaiono.
        clipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
        owned: (() => {
          const paint = cells[0] ? getComputedStyle(cells[0]).backgroundColor : '';
          return !!paint && paint !== 'transparent' && !paint.startsWith('rgba(0, 0, 0, 0');
        })(),
      });
    }
  }
  return out;
}

/**
 * L'ALLINEAMENTO, contato DENTRO ogni blocco e non sul tabellone intero.
 *
 * Sul tabellone i bordi sinistri sarebbero otto per costruzione - tante quante le colonne della
 * griglia - quindi contarli li' darebbe otto anche su righe perfettamente allineate e la misura non
 * direbbe niente. La domanda e' «le righe di QUESTO blocco si incolonnano», e la risposta e' uno.
 */
function columnsOf() {
  const out = [];
  for (const block of document.querySelectorAll('[data-block]')) {
    const rows = [...block.querySelectorAll('button')];
    if (rows.length < 2) continue;
    const lefts = [[], [], [], []];
    let clipped = 0;
    for (const row of rows) {
      const cells = [...row.querySelectorAll(':scope > span')].slice(-4);
      cells.forEach((cell, i) => {
        lefts[i].push(Math.round(cell.getBoundingClientRect().left));
        if (cell.scrollWidth > cell.clientWidth + 1) clipped += 1;
      });
    }
    out.push({
      id: (block.querySelector('span')?.innerText ?? '').trim(),
      rows: rows.length,
      distinct: lefts.map((one) => new Set(one).size),
      clipped,
    });
  }
  return out;
}

async function main() {
  const binary = BROWSERS.find((one) => existsSync(one));
  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-stats-'));
  const debugPort = Number(await freePort());
  const url = `http://127.0.0.1:${port}/plancia`;
  const browser = spawn(binary, ['--headless=new', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--window-size=1600,1000', url], { stdio: 'ignore' });
  let session;
  const problems = [];
  const grab = (name) => {
    const b = [...document.querySelectorAll('[data-block] button')]
      .find((one) => (one.innerText ?? '').includes(name));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  try {
    const { byName, twice, season, platform } = await sheetNames();
    const truth = await lastFromBundle(season, platform);
    console.log(`. il pacchetto: ${season} su ${platform} · ${truth.size} righe · ${twice} nomi doppi fuori dal confronto`);

    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await waitFor(session, readBoard, 120);

    // 1. NESSUNA OFFERTA A ZERO, su tutt'e due i tagli: un tetto di zero non e' un'offerta.
    for (const grid of ['mercato', 'personali']) {
      if (grid === 'personali') {
        const to = await evaluate(session, boxOf, 'header nz-radio-group label', 'personali');
        await click(session, to);
        await wait(600);
      }
      const rows = await evaluate(session, readRows);
      const offers = rows
        .filter((one) => !one.owned)
        .map((one) => Number((one.figures.at(-1) ?? '').replace(/[^0-9-]/g, '')));
      const zeros = offers.filter((one) => one === 0).length;
      const blanks = offers.filter((one) => Number.isNaN(one)).length;
      console.log(`. [${grid}] ${offers.length} offerte · minimo ${Math.min(...offers)} · a zero ${zeros} · vuote ${blanks}`);
      if (zeros || blanks) problems.push(`[${grid}] ${zeros} offerte a zero e ${blanks} vuote: sotto l uno non c e un offerta`);
    }

    // 2. IL RIPESCATO DALLA CODA paga il minimo. Si buttano attaccanti finche' non ne sale uno.
    const before = await evaluate(session, readRows);
    const had = new Set(before.map((one) => one.name));
    let fresh = [];
    for (let n = 0; n < 4 && !fresh.length; n += 1) {
      const attackers = (await evaluate(session, readRows)).filter((one) => one.block.startsWith('A'));
      const from = await evaluate(session, grab, attackers.at(-1).name);
      const bin = await evaluate(session, () => {
        const el = document.querySelector('[data-bin]');
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await dragTo(session, from, bin, 10);
      fresh = (await evaluate(session, readRows)).filter((one) => !had.has(one.name));
    }
    console.log(`. saliti dalla coda: ${fresh.map((f) => `${f.name} «${f.figures.at(-1)}»`).join(' · ') || 'NESSUNO'}`);
    if (!fresh.length) problems.push('nessuno e salito dalla coda: il passo non ha misurato niente');
    for (const one of fresh) {
      if ((one.figures.at(-1) ?? '').trim() !== '1') {
        problems.push(`«${one.name}» viene dalla coda e la sua offerta legge «${one.figures.at(-1)}» invece di 1`);
      }
    }

    // 3. LA SELECT, e le tre cifre confrontate col PACCHETTO.
    const clipBefore = (await evaluate(session, readRows)).filter((one) => one.clipped).length;
    // SI VERIFICA CHE LA VOCE SIA RAGGIUNGIBILE, e non solo che esista: e' il passo che ha trovato il
    // difetto vero di questa feature - il tooltip della select copriva le proprie voci, quindi il
    // click atterrava sul pannello e il set non cambiava mai. «Un controllo puo' esistere nel DOM e
    // non esistere sullo schermo» (20/08), e la sola prova e' `elementFromPoint` sulle sue coordinate.
    const select = await evaluate(session, boxOf, '[data-stats]', '');
    if (!select) throw new Error('la select delle statistiche non e sullo schermo');
    await click(session, select);
    await wait(500);
    const option = await evaluate(session, boxOf, 'nz-option-item', 'scorso');
    if (!option) throw new Error('la voce «scorso» non e nel menu');
    console.log(`. la voce «${option.text}» e' raggiungibile: ${option.reachable}`);
    if (!option.reachable) {
      const over = await evaluate(session, (pt) => {
        const el = document.elementFromPoint(pt.x, pt.y);
        return el ? `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60) : 'niente';
      }, { x: Math.round(option.x), y: Math.round(option.y) });
      problems.push(`la voce «scorso» e' coperta da ${over}: un click di una mano non la prende`);
    }
    await click(session, option);
    await wait(700);
    // E CHE IL CLICK ABBIA MORSO prima di giudicare i numeri: senza, si confronterebbe il set VECCHIO
    // col pacchetto e la colpa finirebbe sui numeri.
    const chose = await evaluate(session, () =>
      (document.querySelector('[data-stats] .ant-select-selection-item')?.innerText ?? '').trim());
    if (!chose.startsWith('scorso')) {
      throw new Error(`la select dice ancora «${chose}»: il resto del passo misurerebbe l altro set`);
    }

    const shown = await evaluate(session, readRows);
    let checked = 0;
    const wrong = [];
    for (const row of shown) {
      const id = byName.get(row.name);
      const line = id == null ? null : truth.get(id);
      if (!line) continue;
      const [pv, mv, fm] = row.figures;
      // SI CONFRONTA IL NUMERO CON UNA TOLLERANZA DI MEZZA UNITA' NELL'ULTIMA CIFRA STAMPATA, non due
      // stringhe. La prima versione usava `toFixed` e accusava 19 righe: `toFixed` arrotonda sulla
      // rappresentazione BINARIA (5,05 e' 5,0499...) mentre `Intl` - che e' quello che il pipe di
      // Angular usa - arrotonda sul decimale, quindi le due danno 5,0 e 5,1 sullo stesso numero. Era
      // l'arnese, non la pagina: *un banco si verifica prima di accusare il codice*, e la forma che non
      // dipende da nessuno dei due formattatori e' la distanza.
      const near = (text, value, digits) => {
        if (value == null) return text === '·';
        const shownValue = Number(String(text).replace(/[^0-9.-]/g, ''));
        return Number.isFinite(shownValue) && Math.abs(shownValue - value) <= 0.5 * 10 ** -digits + 1e-9;
      };
      checked += 1;
      const wantPv = line.pv == null ? '' : `(${Math.round(line.pv)})`;
      if (pv !== wantPv || !near(mv, line.mv, 1) || !near(fm, line.fm, 1)) {
        wrong.push(`${row.name}: schermo ${pv} ${mv} ${fm} · pacchetto ${wantPv} ${line.mv} ${line.fm}`);
      }
    }
    console.log(`. «scorso»: ${checked} righe confrontate col pacchetto · sbagliate ${wrong.length}`);
    for (const one of wrong.slice(0, 5)) console.log(`      ${one}`);
    if (!checked) problems.push('zero righe confrontate: il ponte fra schermo e pacchetto non aggancia niente');
    if (wrong.length) problems.push(`${wrong.length} righe stampano numeri che il pacchetto non ha`);

    // 4a. COSA COSTA IL DECIMALE IN MENO, contato sul PACCHETTO e non sullo schermo: dentro un blocco
    //     di dieci, quanti valori distinti restano di media con una cifra e con due. Il conto si fa
    //     qui e non a parole perche' e' l'unica cosa che una precisione puo' far perdere - e va letto
    //     sapendo che questa colonna non ordina niente: il blocco resta tagliato sulla moneta.
    const perBlock = new Map();
    for (const row of shown) {
      const line = truth.get(byName.get(row.name) ?? -1);
      if (!line || line.mv == null) continue;
      const bucket = perBlock.get(row.block) ?? [];
      bucket.push(line.mv);
      perBlock.set(row.block, bucket);
    }
    const distinct = (values, digits) => new Set(values.map((one) => one.toFixed(digits))).size;
    const ones = [...perBlock.values()].map((v) => distinct(v, 1));
    const twos = [...perBlock.values()].map((v) => distinct(v, 2));
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    console.log(`. il decimale: in un blocco la media voto ha ${mean(ones).toFixed(1)} valori distinti ` +
      `con una cifra e ${mean(twos).toFixed(1)} con due (${perBlock.size} blocchi)`);

    // 4. IL PREZZO DELLE ICONE E DELLA TERZA CIFRA, misurato e non discusso.
    const clipAfter = shown.filter((one) => one.clipped).length;
    console.log(`. nomi tagliati: ${clipBefore} col set del motore, ${clipAfter} con la stagione scorsa (su ${shown.length})`);

    // 5. LE COLONNE SI INCOLONNANO, e nessuna cifra e' tagliata dalla propria larghezza dichiarata.
    const columns = await evaluate(session, columnsOf);
    const loose = columns.filter((one) => one.distinct.slice(1).some((n) => n > 1));
    const cut = columns.filter((one) => one.clipped);
    console.log(`. colonne: ${columns.length} blocchi · disallineati ${loose.length} · con cifre tagliate ${cut.length}`);
    for (const one of loose.slice(0, 3)) {
      console.log(`      ${one.id}: bordi distinti ${JSON.stringify(one.distinct)} su ${one.rows} righe`);
    }
    if (loose.length) problems.push(`${loose.length} blocchi hanno i numeri non incolonnati`);
    if (cut.length) problems.push(`${cut.length} blocchi tagliano una cifra: una larghezza dichiarata e troppo stretta`);

    // 5. E LA SCELTA SOPRAVVIVE A UN RICARICAMENTO, come gli altri interruttori della barra.
    await session.send('Page.reload', { ignoreCache: false });
    await waitFor(session, readBoard, 120);
    await wait(600);
    const kept = await evaluate(session, () =>
      (document.querySelector('[data-stats] .ant-select-selection-item')?.innerText ?? '').trim());
    console.log(`. dopo il refresh la select dice «${kept}»`);
    if (!kept.startsWith('scorso')) problems.push(`il refresh riporta la select a «${kept}»`);
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
