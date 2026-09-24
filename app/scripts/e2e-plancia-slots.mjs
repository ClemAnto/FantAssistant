/**
 * e2e-plancia-slots.mjs - drive the REAL plancia and measure the two SLOT GRIDS.
 *
 * «Un tasto che mi permetta di cambiare visualizzazione da slot MERCATO a slot PERSONALI ... ripopolare
 * gli slot ordinando i calciatori per offerta massima» (operatore, 04/09/2026). What that promises is
 * an ARITHMETIC claim about the screen, so it is measured on the screen and not deduced from the code:
 * on the personal grid the max-offer column has to be non-increasing DOWN the board - inside a block
 * and from one block to the next - and the two grids have to carry the SAME MEN, because the toggle is
 * a re-cut and not a filter.
 *
 * Three cautions this repository has already paid for, and each one is a step of its own.
 *  - NORMALISING THE STATE CAN HIDE THE DEFECT THAT ONLY LIVES IN THE UN-NORMALISED ONE, and this run
 *    paid for it: it pressed «azzera le rose» before measuring anything - for a good reason, the
 *    market column mixes two figures and ranking a mixed column measures nothing - and that reset put
 *    every name back in the urn, i.e. it removed the only rows on which the personal grid's descent
 *    was actually broken (a man somebody OWNS showed the price PAID, 403, and sat under a 333). The
 *    operator found it by looking. So the descent is now measured TWICE: on the table as it arrives,
 *    played, and again after the reset.
 *  - A TOOLTIP IS A PROPERTY BINDING and there is no attribute to read: the block's own sentence is
 *    verified by HOVERING it and reading the overlay, or «the header says whose cut it is» would be a
 *    claim about the source and not about the screen.
 *  - THE TWO GRIDS DRAW THE SAME MEN, struck rows included, and that is a decision that was made and
 *    then UNMADE within the hour: for a while the personal grid dropped whoever does not play today,
 *    on his request, and he withdrew it - «non e' molto rilevante ai fini del mercato, e' solo una
 *    gara saltata». So the run asserts the restoration, and asserts that the strikethrough now marks
 *    the LONG-TERM injured on both grids («lo stile barrato utilizziamolo per gli infortunati di lunga
 *    data»): a row struck on one grid and not on the other would be two answers about one man.
 *
 * Zero dependencies, like the other harnesses: serves `dist/`, launches Edge or Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-plancia-slots.mjs [--headed] [--json] [--shot]
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
          // ...e lo STATO dalla riga stessa (`data-state`, 24/09/2026): «mio» e «di un altro» sono due
          // barre dipinte, e dal 24/09 la colonna di destra li tratta in modo diverso.
          state: row.getAttribute('data-state'),
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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run "ng build" first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-slots-'));
  const debugPort = Number(value('--port', String(await freePort())));
  // `?fixture=played` PERCHE' QUESTO BANCO MISURA SU RIGHE CHE HANNO UN PADRONE: dal 23/09/2026 la
  // plancia apre su un tavolo VUOTO (sua istruzione), e su un tavolo vuoto la lente, il prezzo pagato e
  // l'azzeramento non hanno niente da mostrare. La popolazione si CHIEDE nell'indirizzo invece di
  // tornare a giocare il tavolo per tutti.
  const url = `http://127.0.0.1:${port}/plancia?fixture=played`;
  const browser = spawn(
    binary,
    [
      flag('--headed') ? '--headless=false' : '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1600,1000',
      url,
    ],
    { stdio: 'ignore' },
  );

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

    // 0-bis. IL TAVOLO COME ARRIVA, GIOCATO, che e' lo stato in cui l'operatore guarda la pagina: un
    //        terzo dell'asta e' fatto, quindi ci sono righe DI QUALCUNO - le sole su cui il difetto
    //        del 04/09 esisteva. Questo passo viene PRIMA dell'azzeramento di proposito.
    const playedToggle = await evaluate(session, boxOf, 'header nz-radio-group label', 'personali');
    if (playedToggle) await click(session, playedToggle);
    await wait(500);
    const played = await waitFor(session, readBoard, 60);
    const playedBreaks = played
      ? ROLES.flatMap((role) => [...cutBreaks(played, role), ...orderBreaks(played, role)])
      : [];
    const playedOwned = (played ?? []).flatMap((block) =>
      block.rows.filter((row) => row.owned).map((row) => `${block.id} ${row.name}`),
    );
    note("sul tavolo GIOCATO la moneta taglia e ordina anche le righe di chi ha gia' comprato", {
      said: `${playedOwned.length} righe sono di qualcuno · ${playedBreaks.length} punti rotti`,
      problems: [
        ...(playedOwned.length
          ? []
          : [
              "nessuna riga e' di qualcuno: il tavolo finto non e' partito giocato e il passo non " +
                'proverebbe niente',
            ]),
        ...playedBreaks.slice(0, 6),
      ],
    });
    const backToMarket = await evaluate(session, boxOf, 'header nz-radio-group label', 'mercato');
    if (backToMarket) await click(session, backToMarket);
    await wait(400);

    // 0-ter. CHI E' MIO PORTA QUELLO CHE HO PAGATO, anche sul taglio personale (sua richiesta,
    //        24/09/2026: «mostra il costo dei tuoi calciatori al posto del costo massimo in ogni riga
    //        nei gruppi»). Il numero si verifica contro la stessa riga sulla griglia del MERCATO, dove
    //        la colonna e' il prezzo di chiunque abbia un padrone da sempre: due tagli della stessa
    //        pagina devono dire dello stesso acquisto la stessa cifra. Confrontarlo col tetto che la
    //        riga mostrava prima sarebbe confrontarlo con la cosa che si e' appena tolta.
    const playedMarket = await waitFor(session, readBoard, 60);
    const paidOnMarket = new Map();
    for (const block of playedMarket ?? []) {
      for (const row of block.rows) if (row.state === 'mio') paidOnMarket.set(row.name, row.offer);
    }
    const mineRows = (played ?? []).flatMap((block) => block.rows).filter((row) => row.state === 'mio');
    const wrongPaid = mineRows
      .filter((row) => paidOnMarket.has(row.name) && paidOnMarket.get(row.name) !== row.offer)
      .map((row) => `${row.name}: personali ${row.offer}, mercato ${paidOnMarket.get(row.name)}`);
    // I RIVALI RESTANO AL MIO TETTO, ed e' l'altra meta' della regola: il prezzo che ha pagato un
    // altro non e' una cifra mia, ed era il 403 di Martinez L. che il 04/09 ha aperto la questione.
    const rivals = (played ?? []).flatMap((block) => block.rows).filter((row) => row.state === 'altro');
    const rivalsAtPaid = rivals.filter((row) => {
      const onMarket = (playedMarket ?? [])
        .flatMap((block) => block.rows)
        .find((one) => one.name === row.name);
      return onMarket && onMarket.state === 'altro' && onMarket.offer === row.offer && row.offer > 0;
    });
    note("sui personali chi e' mio porta il prezzo PAGATO, e i rivali il mio tetto", {
      said:
        `${mineRows.length} righe mie · ${wrongPaid.length} in disaccordo col mercato · ` +
        `${rivals.length} righe di rivali, ${rivalsAtPaid.length} col prezzo che hanno pagato loro`,
      problems: [
        ...wrongPaid,
        // Un passo che non ha guardato niente lo DICE: su un tavolo senza miei acquisti questo
        // confronto passerebbe a vuoto, e un verde cosi' e' quello che non si distingue da un difetto.
        ...(mineRows.length
          ? []
          : ['nessuna riga mia sul taglio personale: il passo non ha guardato niente']),
      ],
    });


    // 0. TUTTI NELL'URNA. La colonna del MERCATO porta due significati - max offerta finche' e' nell'urna,
    //    prezzo pagato dopo - e i passi che confrontano le due plance riga per riga hanno bisogno che sia
    //    una cifra sola. Per questo l'azzeramento sta qui e non prima del passo qui sopra.
    const reset = await evaluate(session, boxOf, 'ui-global-options button', 'azzera le rose');
    if (reset) await click(session, reset);
    const confirmed = await clickSteady(session, '.ant-popover button', 'Azzera');
    await wait(500);

    const market = await waitFor(session, readBoard, 80);
    const toggle = await evaluate(session, readToggle);
    const drawn = market?.reduce((sum, one) => sum + one.rows.length, 0) ?? 0;
    note('la plancia del mercato', {
      said:
        `${market?.length ?? 0} blocchi · ${drawn} righe · tasti [` +
        `${(toggle ?? []).map((one) => `${one.text}${one.on ? ' ON' : ''}`).join(' | ')}]`,
      problems: [
        ...(confirmed
          ? []
          : ["l'azzeramento non ha chiesto conferma: le righe non sono tutte nell'urna"]),
        ...(market?.length === 25
          ? []
          : [`i blocchi a schermo sono ${market?.length ?? 0} e non venticinque`]),
        ...(toggle?.length === 2
          ? []
          : [`i tasti del taglio sono ${toggle?.length ?? 0} e non due`]),
        ...(toggle?.[0]?.on
          ? []
          : ["la pagina non apre sul taglio del MERCATO, che e' quello misurato"]),
      ],
    });

    // 1. IL MERCATO NON E' GIA' ORDINATO PER OFFERTA, e va detto prima: se lo fosse, il taglio
    //    personale non si distinguerebbe da quello di partenza e il passo dopo passerebbe a vuoto.
    const marketBreaks = market ? ROLES.flatMap((role) => breaks(market, role)) : [];
    note('il mercato taglia per PREZZO e non per la mia offerta', {
      said: `${marketBreaks.length} punti in cui la max offerta risale scendendo la plancia`,
      problems: marketBreaks.length
        ? []
        : [
            "la plancia del mercato e' gia' ordinata per max offerta: il taglio personale non proverebbe niente",
          ],
    });

    // 2. IL TASTO, con un puntatore vero e alle coordinate che il browser dichiara.
    const button = await evaluate(session, boxOf, 'header nz-radio-group label', 'personali');
    if (button) await click(session, button);
    await wait(500);
    const mine = await evaluate(session, readBoard);
    const after = await evaluate(session, readToggle);
    const mineCut = mine ? ROLES.flatMap((role) => cutBreaks(mine, role)) : [];
    const mineOrder = mine ? ROLES.flatMap((role) => orderBreaks(mine, role)) : [];
    const mineBreaks = [...mineCut, ...mineOrder];
    const firstD = (mine ?? []).find((one) => one.id === 'D1');
    note('slot personali: la MONETA taglia E ordina, e il tetto resta quello del mercato', {
      said:
        `taglio: ${mineCut.length} punti rotti · ordine: ${mineOrder.length}` +
        ` · D1 offre «${firstD?.rows.map((row) => row.offer).join(' ') ?? '?'}»` +
        ` e spinge «${firstD?.rows.map((row) => row.lead).join(' ') ?? '?'}»`,
      problems: [
        ...(button ? [] : ["non c'e' nessun tasto «slot personali» in barra"]),
        ...(button && !button.reachable ? ['il tasto «slot personali» ha qualcosa sopra'] : []),
        ...(after?.[1]?.on
          ? []
          : ["il tasto non e' rimasto premuto: la pagina e' ancora sul mercato"]),
        ...mineBreaks.slice(0, 6),
      ],
    });

    // 2-bis. IL BARRATO E' L'INFORTUNATO DI LUNGA DATA, e sta su TUTT'E DUE le griglie. Il conto si fa
    //        sull'inchiostro con cui la pagina lo dichiara e non su una lista di nomi nostra; il null
    //        viene prima, perche' «gli stessi barrati» fra due plance che non ne hanno non prova
    //        niente. E i nomi si confrontano, non solo il conteggio: due insiemi della stessa taglia
    //        possono essere due insiemi diversi.
    const struckMarket = struckOf(market).map((one) => one.split(' ').slice(1).join(' '));
    const struckMine = struckOf(mine).map((one) => one.split(' ').slice(1).join(' '));
    note("il barrato e' l'infortunato di lunga data, e vale su tutt'e due i tagli", {
      said:
        `barrati: ${struckMarket.length} sul mercato, ${struckMine.length} sui personali` +
        (struckMarket.length ? ` (${struckMarket.slice(0, 4).join(', ')})` : ''),
      problems: [
        ...(struckMarket.length
          ? []
          : ['nessuna riga barrata sul mercato: il passo non proverebbe niente']),
        ...(String([...struckMarket].sort()) === String([...struckMine].sort())
          ? []
          : [
              'i barrati dei due tagli non sono gli stessi uomini: ' +
                `mercato ${struckMarket.length}, personali ${struckMine.length}`,
            ]),
      ],
    });

    // 3. GLI STESSI UOMINI, negli stessi venticinque blocchi: un taglio e non un filtro.
    //
    //    E la FORMA non e' la stessa, il che e' giusto e va detto invece di asserito al contrario -
    //    la prima versione di questo passo pretendeva blocco per blocco la stessa altezza e leggeva
    //    un difetto che non c'e'. Sul mercato chi rientra troppo tardi lascia il suo POSTO vuoto,
    //    perche' lo slot e' un rango del MERCATO e far salire tutti di uno parlerebbe di slot
    //    diversi da quelli su cui la scala e' misurata; sulla griglia personale quell'uomo non ha
    //    un tetto affatto, quindi non ha un rango MIO da tenere, e le righe che mancano si vedono in
    //    fondo al ruolo. Quello che si asserisce e' questo: pieni tutti tranne l'ultimo di un ruolo.
    // Gli stessi nomi, tutti: dal 04/09/2026 il taglio personale non esclude nessuno, e questo passo
    // e' la prova della restituzione - la versione che sottraeva i barrati e' durata un'ora.
    const same = market && mine && String(names(market)) === String(names(mine));
    const short = (mine ?? []).filter(
      (block, at, all) =>
        block.rows.length < 10 && all[at + 1] && all[at + 1].id.startsWith(block.id[0]),
    );
    note('e sono gli stessi uomini, negli stessi venticinque blocchi', {
      said:
        `${mine?.length ?? 0} blocchi · ${mine?.reduce((sum, one) => sum + one.rows.length, 0) ?? 0} righe · ` +
        `corti solo in fondo al ruolo: ${
          shapeOf(mine)
            .split(' ')
            .filter((one) => !one.endsWith(':10'))
            .join(' ') || 'nessuno'
        }`,
      problems: [
        ...(same
          ? []
          : [
              'i nomi disegnati non sono gli stessi del mercato: il tasto sta filtrando invece di ' +
                'ritagliare',
            ]),
        ...(market?.length === mine?.length
          ? []
          : [`i blocchi erano ${market?.length} e sono ${mine?.length}`]),
        ...(short.length
          ? [
              `un blocco non in fondo al ruolo ha meno di dieci righe: ${short.map((one) => one.id).join(', ')}`,
            ]
          : []),
      ],
    });

    // 4. L'INTESTAZIONE PORTA LA MEDIANA DELLA COORDINATA SU CUI HA TAGLIATO, e non l'altra: sul
    //    mercato il prezzo della stanza, qui LA MONETA (23/09/2026, prima era la max offerta - che
    //    ha smesso di tagliare, quindi un'intestazione che la dichiarasse direbbe di se' una cosa
    //    falsa). Verificata contro le righe che disegna, cioe' contro la colonna del surplus.
    const coins = firstD ? firstD.rows.map((row) => row.lead).filter(Number.isFinite) : [];
    const expected = coins.length ? Math.round(median(coins)) : null;
    note("la cifra dell'intestazione e' la mediana della MONETA", {
      said: `D1 dichiara ${firstD?.median ?? '?'} e le sue righe danno ${expected ?? '?'}`,
      problems:
        firstD && expected != null && Math.abs(firstD.median - expected) <= 1
          ? []
          : [`D1 dichiara ${firstD?.median} mentre la mediana delle sue righe e' ${expected}`],
    });

    // 5. E LA FRASE DEL BLOCCO DICE DI CHI E' IL TAGLIO. Un tooltip e' un binding di PROPRIETA':
    //    nel DOM non c'e' nessun attributo da leggere, quindi si apre.
    let tip = null;
    if (firstD?.headerAt) {
      // Prima si porta il puntatore ALTROVE: arrivando dal tasto appena premuto, il pannello ancora
      // aperto e' quello del tasto, e un banco che lo legge crede di aver letto il blocco.
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 800,
        y: 980,
        button: 'none',
      });
      await wait(400);
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(firstD.headerAt.x),
        y: Math.round(firstD.headerAt.y),
        button: 'none',
      });
      tip = await waitFor(session, readTooltip, 20);
    }
    note("il blocco DICE di chi e' il taglio", {
      said: `il tooltip di D1 dice «${(tip ?? '—').slice(0, 120)}»`,
      problems: [
        ...(tip ? [] : ["passando sull'intestazione di D1 non si apre nessun tooltip"]),
        ...(tip && /il tuo D1/i.test(tip)
          ? []
          : [
              "il tooltip di D1 non dice che il blocco e' il MIO: un blocco chiamato `D1` che porta due" +
                ' insiemi diversi a seconda di uno stato invisibile si legge come un tabellone rotto',
            ]),
      ],
    });

    // 6. E SI TORNA INDIETRO IDENTICI: un taglio che non si annulla e' uno stato in cui si resta
    //    intrappolati, e la griglia del mercato e' quella su cui ogni numero misurato e' letto.
    const back = await evaluate(session, boxOf, 'header nz-radio-group label', 'mercato');
    if (back) await click(session, back);
    await wait(500);
    const again = await evaluate(session, readBoard);
    const print = (board) =>
      String(
        (board ?? []).map((one) => one.rows.map((row) => `${row.name}:${row.offer}`).join(',')),
      );
    const identical = !!market && !!again && print(market) === print(again);
    note('e si torna al mercato identico', {
      said: identical
        ? 'riga per riga, la stessa plancia di partenza'
        : "la plancia del mercato e' cambiata",
      problems: identical ? [] : ["tornando al mercato la plancia non e' quella di partenza"],
    });

    const strip = await evaluate(session, readTeamCard);
    const fromPage = strip ? apart(strip.card, strip.page) : 0;
    const fromBlock = strip ? apart(strip.card, strip.block) : 0;
    note('le rose stanno in una card, nello spazio dei portieri', {
      said: strip
        ? `${strip.teams} rose in ${strip.width}x${strip.height}px · fondo ${strip.card} · ` +
          `${fromPage} punti dalla pagina, ${fromBlock} da un blocco · bordo ${strip.border}`
        : 'nessuna card delle rose sullo schermo',
      problems: [
        ...(strip ? [] : ["la striscia delle rose non e' dentro la plancia"]),
        ...(strip && strip.teams === 10 ? [] : [`${strip?.teams} rose disegnate invece di 10`]),
        // Dieci punti per canale e' il gradino che i blocchi usano per leggersi come card: sotto
        // quello il «cambio di contesto» che la card promette e' un bordo da un pixel e basta.
        ...(fromPage >= 8 ? [] : [`la card si stacca dalla pagina di ${fromPage} punti per canale`]),
        ...(strip && parseFloat(strip.border) > 0 ? [] : ['la card non ha un bordo']),
        ...(strip?.aboveDefence
          ? []
          : ["la card delle rose non sta nella linea dei portieri: e' scesa sotto la plancia"]),
      ],
    });

    // 8. UNA FINESTRA BASSA: la plancia SCORRE e i nomi non si toccano (sua segnalazione, 23/09/2026).
    //    La misura si fa a due altezze e le due dicono cose opposte: a 1000px c'e' posto per tutto e
    //    nulla deve scorrere - una plancia che scorresse quando ci sta sarebbe il difetto opposto - a
    //    600px non ce n'e', e quello che si pretende e' che a cedere sia lo SPAZIO e non la leggibilita'.
    //
    //    LE DUE ALTEZZE SONO SCELTE COL MARGINE, ed e' una correzione a questo stesso passo: con 900 e
    //    720 il verdetto «scorre» si decideva su DUE pixel (553 di vista contro 555 di plancia), cioe'
    //    sarebbe andato rosso alla prima riga in piu' in barra, per una ragione che non e' un difetto.
    //    A 1000px la vista e' 828 contro 555, a 600px e' 428: nessuna delle due risposte e' in bilico.
    const squeezed = {};
    for (const height of [1000, 600]) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: 1600, height, deviceScaleFactor: 1, mobile: false,
      });
      await wait(600);
      squeezed[height] = await waitFor(session, readSqueeze, 40);
    }
    await session.send('Emulation.clearDeviceMetricsOverride');
    await wait(400);
    const tall = squeezed[1000];
    const tight = squeezed[600];
    note('a finestra bassa la plancia scorre invece di accavallare i nomi', {
      said:
        tall && tight
          ? `1000px: riga ${tall.rowMin}px, ${tall.overlaps}/${tall.pairs} accavallati, ` +
            `${tall.scrollsY ? 'scorre' : 'non scorre'} · ` +
            `600px: riga ${tight.rowMin}px, inchiostro max ${tight.ink}px («${tight.inkName}»), ` +
            `aria ${tight.gap}px, ${tight.overlaps}/${tight.pairs} accavallati ` +
            `(scatole del font ${tight.boxOverlaps}), figlio ${tight.child}px, ` +
            `${tight.viewH}px su ${tight.contentH}px di plancia, ` +
            `ultima riga ${tight.reachable ? 'raggiungibile' : 'tagliata'}`
          : 'la plancia non ha disegnato blocchi a finestra bassa',
      problems: [
        ...(tall && tight ? [] : ["non si e' potuta misurare la plancia a finestra bassa"]),
        // L'ARNESE PRIMA DELLA PAGINA: se il canvas non risolve la stessa faccia del DOM, l'inchiostro
        // che segue e' di un altro carattere e ogni numero di questo passo parla d'altro.
        ...(tight && tight.faceGap <= 0.5
          ? []
          : [`il canvas misura un'altra faccia: ${tight.faceGap}px di scarto dalla scatola del DOM`]),
        ...(tall?.overlaps
          ? [`a 1000px ${tall.overlaps} nomi su ${tall.pairs} si accavallano: ${tall.worst}px`]
          : []),
        ...(tall && tall.scrollsY
          ? ["a 1000px la plancia scorre: ci starebbe tutta e una barra qui e' spazio buttato"]
          : []),
        ...(tight?.overlaps
          ? [`a 600px ${tight.overlaps} nomi su ${tight.pairs} si accavallano: ${tight.worst}px`]
          : []),
        // Il pavimento si asserisce come DISUGUAGLIANZA contro cio' che la pagina dipinge, non contro
        // un numero scritto qui: gli 11px sono suoi, i nove dell'inchiostro sono del carattere, e il
        // giorno in cui uno dei due si muove e' questa riga a dirlo.
        ...(tight && tight.rowMin >= tight.ink
          ? []
          : [`a 600px la riga sta a ${tight?.rowMin}px sotto i ${tight?.ink}px di inchiostro`]),
        ...(tight && tight.childOut
          ? [`a 600px ${tight.childOut} righe hanno un figlio da ${tight.child}px fuori dalla riga`]
          : []),
        ...(tight && tight.scrollsY
          ? []
          : ["a 600px la plancia non scorre: le 250 righe non ci stanno e nessuno puo' arrivarci"]),
        ...(tight && !tight.reachable ? ["a 600px l'ultima riga resta tagliata anche scorrendo"] : []),
        ...(tight && tight.scrollsX ? ['la plancia ha guadagnato uno scorrimento LATERALE'] : []),
        ...(tight && tight.pageScrolls
          ? ["a 600px scorre la PAGINA: l'intestazione e la card del lotto se ne vanno"]
          : []),
      ],
    });

    if (flag('--shot')) {
      if (button) await click(session, button);
      await wait(400);
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'plancia-slots.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      report.screenshot = where;
      console.log(`  screenshot: ${where}`);
    }

    const noise = session.noise();
    if (noise.length)
      note('la console della pagina', { said: `${noise.length} righe`, problems: noise });
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
