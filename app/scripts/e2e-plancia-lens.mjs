/**
 * e2e-plancia-lens.mjs - drive the REAL plancia and measure the TEAM LENS.
 *
 * «Quando faccio click su un box di una squadra -> attiva quella squadra ed evidenzia sulla plancia
 * tutti i calciatori comprati da quella squadra mettendo opacità 30% a tutti gli altri calciatori»
 * (operatore, 04/09/2026). Two things have to be measured and neither is visible from the code.
 *
 * THREE PROMISES, and the third one arrived last: the men he bought are IN THE CLEAR (opacity), and
 * their ink is the FULL one (colour) - because a lit row is «somebody else's» for the state machine
 * and that state is deliberately grey, so dimming the rest to 30% was not enough on its own.
 *
 * THE JOIN, not a count: a row is «his» when the colour of its owner bar equals the colour the card
 * paints on its own badge - the same literal string in both places - so «every man he bought is in the
 * clear» is checked man by man instead of by counting to twelve. And the opacity is read from
 * `getComputedStyle`, never from the class list: a utility class is a declaration, the computed value
 * is what the screen does.
 *
 * THE COEXISTENCE, which is the real risk of this gesture: the same card already ASSIGNS the lot on a
 * double click, and a double click fires a `click` first. So the run drives a real double click and
 * measures the lens before and after - if the guard on `MouseEvent.detail` ever goes, 250 rows will
 * flicker in the middle of a purchase and no unit test can see it.
 *
 * AND ONE CAUTION PAID FOR HERE, by this harness being wrong: it EXEMPTED the lot row and my own rows
 * from its «nothing else is in the clear» filters, because the page exempted them too - so it carried
 * inside the assertion the very exception the assertion should have tested, and could not fail on it.
 * The operator saw in a second what eight green steps could not: «quando seleziono una squadra e poi
 * ne seleziono un'altra, i calciatori della squadra precedente restano accesi». Both exceptions are
 * gone from the page, both are gone from the filters, and the sequence that shows it - MINE first,
 * then a rival - is now a step of its own.
 *
 * Two smaller cautions, both paid for elsewhere in this repository. The table is read AS IT ARRIVES,
 * played: on a board with no owners «zero rows dimmed» proves nothing, so that count is the null of
 * every step - and every colour claim is a comparison BETWEEN ROWS OF THE SAME PAGE, never against a
 * literal, because the theme has two directions and the tokens are `color-mix`. And WHICH card is mine
 * is asked to the PAGE - from its `aria-label`, which is what survived the tooltip being removed - and
 * never taken from the fixture's order: the sequence that found the exception starts on my own roster,
 * so a wrong guess there would measure a different sequence than his.
 *
 * Zero dependencies, like the other harnesses: serves `dist/`, launches Edge or Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-plancia-lens.mjs [--headed] [--json] [--shot]
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
  return { x, y, reachable: found.contains(under) || under?.contains(found) || false };
}

/**
 * Le dieci card: sigla, colore, dove sono, se la pagina le dichiara ACCESE, e se un dito ci arriva.
 *
 * `mine` viene dall'`aria-label`, che e' quello che resta da quando l'operatore ha fatto togliere il
 * tooltip (04/09/2026): la pagina lo dice, e non lo si prende dall'ordine del fixture. E' anche il
 * canale piu' stabile dei due - non ha bisogno di dieci hover per essere letto.
 */
function readCards() {
  const cards = [...document.querySelectorAll('plancia-team-grid > div > div')];
  if (!cards.length) return null;
  return cards.map((card) => {
    const rect = card.getBoundingClientRect();
    const badge = card.querySelector('span');
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const under = document.elementFromPoint(x, y);
    const label = card.getAttribute('aria-label') ?? '';
    return {
      label: (card.querySelectorAll('span')[1]?.innerText ?? '').trim(),
      // Il colore letterale che il template mette sulla sigla: e' la stessa stringa che finisce sulla
      // barra del proprietario di ogni riga, quindi il join fra card e righe e' esatto e non a occhio.
      colour: badge ? getComputedStyle(badge).backgroundColor : '',
      lens: !!card.querySelector('[nztype="eye"], .anticon-eye'),
      mine: /la tua rosa/i.test(label),
      aria: label,
      // NIENTE TOOLTIP SULLE CARD (sua istruzione, 04/09/2026): un'assenza si misura come qualunque
      // altra cosa, dal DOM (il `nz-tooltip` mette un attributo sull'elemento su cui sta) e dal
      // TITLE nativo, che e' l'altro modo di far spuntare un pannello sotto il puntatore.
      tooltip: card.hasAttribute('nztooltiptitle') || card.hasAttribute('title'),
      reachable: card.contains(under) || under === card,
      x,
      y,
    };
  });
}

/**
 * OGNI ICONA HA DIPINTO DAVVERO, che e' un'altra domanda da «l'icona c'e' nel DOM».
 *
 * `NzIconDirective` mette la classe `anticon-<tipo>` sull'host qualunque cosa accada, e se il tipo non
 * e' registrato in `NZ_ICONS` prova a scaricarlo da `assets/`, prende 404 e non disegna niente: la
 * classe resta, l'`<svg>` no. Quindi un banco che cerca `.anticon-eye` legge «c'e'» su una casella
 * vuota - ed e' esattamente cosi' che la lente e' stata spedita senza il suo occhio, con dieci passi
 * verdi (`nzType="eye"` mancava, trovato da una code review e non da qui).
 *
 * La forma generale invece della particolare: non «l'occhio c'e'» ma «nessuna icona della pagina e'
 * vuota» - una registrazione dimenticata e' sempre lo stesso difetto, e questa pagina disegna una
 * dozzina di tipi diversi. Ritorna i tipi vuoti, cosi' il verbale li NOMINA invece di contarli.
 */
function unpaintedIcons() {
  return [...document.querySelectorAll('.anticon')]
    .filter((one) => !one.querySelector('svg'))
    .map(
      (one) =>
        [...one.classList].find((name) => name.startsWith('anticon-')) ??
        one.getAttribute('nztype') ??
        '?',
    );
}

/** Quante icone la pagina sta disegnando: il null del passo qui sopra. */
function countIcons() {
  return document.querySelectorAll('.anticon').length;
}

/** Quanti pannelli di tooltip sono APERTI sullo schermo: l'altra faccia della stessa assenza. */
function openTooltips() {
  return [...document.querySelectorAll('.ant-tooltip')].filter((one) => {
    if (one.classList.contains('ant-tooltip-hidden')) return false;
    const rect = one.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(one).opacity !== '0';
  }).length;
}

/**
 * OGNI RIGA DELLA PLANCIA: opacita' calcolata, colore del proprietario, nome.
 *
 * L'opacita' si legge da `getComputedStyle` e non dalle classi: `opacity-30` e' una utility, e quello
 * che decide sullo schermo e' il valore calcolato - la stessa ragione per cui il 20/08 il filtro si e'
 * verificato con `elementFromPoint` e non contando dei nodi.
 */
function readRows() {
  return [...document.querySelectorAll('plancia-slot-matrix button')].map((row) => {
    const bar = row.querySelector('span');
    const paint = bar ? getComputedStyle(bar).backgroundColor : '';
    const style = getComputedStyle(row);
    return {
      name: (row.innerText ?? '').split('\n')[0].trim(),
      opacity: Number(style.opacity),
      // L'INCHIOSTRO, che si confronta DENTRO la pagina e mai con un letterale: il tema ha due versi
      // e i token sono `color-mix`, quindi la sola affermazione verificabile e' «questa riga ha lo
      // stesso colore di quella» - la stessa ragione per cui il 03/09 il canale rosso letto a mano
      // leggeva 0 su una cella dipinta.
      ink: style.color,
      struck: style.textDecorationLine.includes('line-through'),
      owner:
        !!paint && paint !== 'transparent' && !paint.startsWith('rgba(0, 0, 0, 0') ? paint : '',
    };
  });
}

/** La pastiglia della lente in barra: chi e' accesa, i suoi numeri, e la crocetta per spegnerla. */
function readPill() {
  const pill = [...document.querySelectorAll('header span')].find(
    (one) => one.querySelector('.anticon-eye') && one.querySelector('button'),
  );
  if (!pill) return null;
  const shut = pill.querySelector('button');
  const rect = shut.getBoundingClientRect();
  const under = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return {
    text: (pill.innerText ?? '').replace(/\s+/g, ' ').trim(),
    shutAt: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    shutReachable: shut.contains(under) || under === shut || shut.contains(under),
  };
}

/** Il nome del lotto in asta: e' l'unica riga che non deve smorzarsi anche se non e' della rosa accesa. */
function readLotName() {
  const card = document.querySelector('plancia-lot-card');
  return (card?.querySelector('.truncate')?.innerText ?? '').trim();
}

/** Cosa dice la pagina quando rifiuta: e' anche la prova che un gesto le e' arrivato. */
function readAlert() {
  const alert = document.querySelector('nz-alert');
  return alert ? (alert.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
}

/** Il taglio corrente, letto dal controllo: la lente deve valere su tutt'e due le griglie. */
function readView() {
  const on = [...document.querySelectorAll('header nz-radio-group label')].find((one) =>
    one.classList.contains('ant-radio-button-wrapper-checked'),
  );
  return on ? (on.innerText ?? '').trim() : null;
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run "ng build" first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-lens-'));
  const debugPort = Number(value('--port', String(await freePort())));
  const url = `http://127.0.0.1:${port}/plancia`;
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
    await wait(1800);

    // 0. IL TAVOLO COME ARRIVA, GIOCATO: senza acquisti non c'e' niente da evidenziare, e questo passo
    //    e' il NULL di tutti gli altri - «zero righe smorzate» su una plancia senza padroni non
    //    proverebbe niente. Qui dentro anche le due ASSENZE: nessuna lente accesa all'apertura, e
    //    nessun tooltip sulle card (sua istruzione del 04/09/2026), misurate e non date per fatte.
    const cards = await waitFor(session, readCards, 80);
    const before = await evaluate(session, readRows);
    const owned = (before ?? []).filter((row) => row.owner).length;
    const mineAt = (cards ?? []).findIndex((one) => one.mine);
    note('il tavolo prima', {
      said:
        `${cards?.length ?? 0} card · ${before?.length ?? 0} righe · ${owned} di qualcuno · ` +
        `${(before ?? []).filter((row) => row.opacity < 0.9).length} gia' smorzate · ` +
        `la mia e' la ${mineAt + 1} («${mineAt >= 0 ? cards[mineAt].label : '?'}»)`,
      problems: [
        ...(cards?.length === 10 ? [] : [`le card sono ${cards?.length ?? 0} e non dieci`]),
        ...(owned > 20
          ? []
          : [`solo ${owned} righe hanno un proprietario: il passo non proverebbe niente`]),
        ...((before ?? []).every((row) => row.opacity > 0.9)
          ? []
          : ['delle righe sono smorzate prima di accendere qualsiasi lente']),
        ...((cards ?? []).some((one) => one.lens) ? ["una card e' gia' accesa all'apertura"] : []),
        ...((cards ?? []).every((one) => one.reachable)
          ? []
          : ['una card ha qualcosa sopra: il click non ci arriverebbe']),
        ...(mineAt >= 0
          ? []
          : ["nessuna card dice di essere la mia: senza saperlo l'aritmetica non chiude"]),
      ],
    });

    // 1. NESSUN TOOLTIP SULLE CARD, e si misura da due lati: l'attributo nel DOM, e quanti pannelli si
    //    aprono davvero passando sopra con un puntatore vero. Il primo da solo non basterebbe - un
    //    `title` nativo o una direttiva su un figlio aprirebbero comunque qualcosa sullo schermo.
    let opened = 0;
    for (const card of cards ?? []) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(card.x),
        y: Math.round(card.y),
        button: 'none',
      });
      await wait(220);
      opened += await evaluate(session, openTooltips);
    }
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 800,
      y: 980,
      button: 'none',
    });
    note('nessun tooltip sulle card', {
      said:
        `${(cards ?? []).filter((one) => one.tooltip).length} attributi di tooltip su ` +
        `${cards?.length ?? 0} card · ${opened} pannelli aperti passando su tutte`,
      problems: [
        ...((cards ?? []).some((one) => one.tooltip)
          ? ['una card porta ancora un attributo di tooltip']
          : []),
        ...(opened
          ? [`passando sulle card si sono aperti ${opened} pannelli: il tooltip e' ancora vivo`]
          : []),
        // La frase non e' persa, e' solo invisibile: se anche l'`aria-label` sparisse, la card
        // sarebbe un controllo con due gesti e nessun nome, che e' una regressione e non una cura.
        ...((cards ?? []).every((one) => one.aria.length > 10)
          ? []
          : ["una card non ha nome accessibile: togliere il tooltip non e' togliere il fatto"]),
      ],
    });

    // 2. UN CLICK SULLA MIA: qui le eccezioni collassano - la rosa accesa E' la mia - quindi le righe
    //    in chiaro sono esattamente le sue, piu' al massimo il lotto.
    const lotName = await evaluate(session, readLotName);
    if (mineAt >= 0) await click(session, cards[mineAt]);
    const pillMine = await waitFor(session, readPill, 20);
    const afterMine = await evaluate(session, readRows);
    const cardsMine = await evaluate(session, readCards);
    const mineColour = mineAt >= 0 ? cards[mineAt].colour : '';
    const clearMine = (afterMine ?? []).filter((row) => row.opacity > 0.9);
    const hisMine = (afterMine ?? []).filter((row) => row.owner === mineColour);
    // NESSUNA ESENZIONE NEL FILTRO, e la prima versione ne aveva due (il lotto e i miei). Era il
    // difetto di questo banco e non della pagina: un'asserzione che porta dentro di se' l'eccezione
    // che dovrebbe provare non puo' fallire su quell'eccezione. Ora una riga in chiaro che non e'
    // della rosa accesa e' un problema, sempre.
    const strayMine = clearMine.filter((row) => row.owner !== mineColour);
    note('un click accende la lente sulla mia rosa', {
      said:
        `pastiglia «${pillMine?.text ?? 'ASSENTE'}» · ${hisMine.length} righe sue, ` +
        `${clearMine.length} in chiaro, ${(afterMine ?? []).length - clearMine.length} al 30%`,
      problems: [
        ...(pillMine
          ? []
          : ['la lente non si dichiara in barra: uno schermo mezzo spento senza una parola']),
        ...(pillMine?.shutReachable ? [] : ['la crocetta della pastiglia ha qualcosa sopra']),
        ...(hisMine.length ? [] : ['la lente non ha trovato nessuna riga della rosa accesa']),
        ...(hisMine.every((row) => row.opacity > 0.9)
          ? []
          : [`${hisMine.filter((row) => row.opacity <= 0.9).length} righe SUE sono smorzate`]),
        ...(strayMine.length
          ? [
              `${strayMine.length} righe che non sono sue restano in chiaro: ` +
                strayMine
                  .slice(0, 4)
                  .map((row) => row.name)
                  .join(', '),
            ]
          : []),
        // 0,30 ESATTO e non «piu' chiaro»: e' la cifra che ha chiesto, e un'opacita' diversa passerebbe
        // una soglia morbida senza che nessuno se ne accorga.
        ...((afterMine ?? []).some((row) => Math.abs(row.opacity - 0.3) < 0.02)
          ? []
          : ["nessuna riga e' esattamente al 30%: l'opacita' chiesta non e' quella applicata"]),
        // La CARD lo dichiara, e si rilegge adesso: la prima versione di questo passo lo asseriva
        // sull'array letto PRIMA dei click, cioe' su dieci card spente per costruzione.
        ...((cardsMine ?? []).filter((one) => one.lens).length === 1
          ? []
          : [
              `le card accese sono ${(cardsMine ?? []).filter((one) => one.lens).length} e non una`,
            ]),
        ...(cardsMine?.[mineAt]?.lens ? [] : ['la card cliccata non si dichiara accesa']),
      ],
    });

    // 3. LA CROCETTA SPEGNE, e la plancia torna com'era riga per riga.
    if (pillMine?.shutAt) await click(session, pillMine.shutAt);
    const restored = await evaluate(session, readRows);
    const same =
      String((before ?? []).map((row) => `${row.name}:${row.opacity}`)) ===
      String((restored ?? []).map((row) => `${row.name}:${row.opacity}`));
    const gone = await evaluate(session, readPill);
    const cardsOff = await evaluate(session, readCards);
    note('la crocetta spegne la lente', {
      said: same ? 'riga per riga, la plancia di partenza' : "la plancia non e' tornata com'era",
      problems: [
        ...(same ? [] : ['spegnendo la lente la plancia non torna allo stato di partenza']),
        ...(gone ? ["la pastiglia della lente e' ancora in barra"] : []),
        ...((cardsOff ?? []).some((one) => one.lens)
          ? ['una card si dichiara ancora accesa dopo lo spegnimento']
          : []),
      ],
    });

    // 4. UNA LENTE SU UN RIVALE, e il conto usa il numero del passo 2: in chiaro devono restare i suoi,
    //    i miei e il lotto - e nessun altro.
    const rivalAt = (cards ?? []).findIndex((one, at) => at !== mineAt);
    if (rivalAt >= 0) await click(session, cards[rivalAt]);
    const pillRival = await waitFor(session, readPill, 20);
    const afterRival = await evaluate(session, readRows);
    const cardsRival = await evaluate(session, readCards);
    const rivalColour = cards[rivalAt].colour;
    const his = (afterRival ?? []).filter((row) => row.owner === rivalColour);
    const clear = (afterRival ?? []).filter((row) => row.opacity > 0.9);
    const stray = clear.filter((row) => row.owner !== rivalColour);
    note("una lente su un rivale evidenzia i SUOI, e nient'altro", {
      said:
        `«${cards[rivalAt].label}»: ${his.length} righe sue · ${clear.length} in chiaro · ` +
        `pastiglia «${pillRival?.text ?? 'ASSENTE'}»`,
      problems: [
        ...(his.length ? [] : ['la lente non ha trovato nessuna riga del rivale']),
        ...(his.every((row) => row.opacity > 0.9)
          ? []
          : [`${his.filter((row) => row.opacity <= 0.9).length} righe SUE sono smorzate`]),
        ...(stray.length
          ? [
              `${stray.length} righe in chiaro non sono sue: ` +
                stray
                  .slice(0, 4)
                  .map((row) => row.name)
                  .join(', '),
            ]
          : []),
        ...(pillRival?.text.includes(cards[rivalAt].label)
          ? []
          : ['la pastiglia non nomina la rosa che ho acceso']),
      ],
    });

    // 4-ter. L'INCHIOSTRO DELLE RIGHE ACCESE E' QUELLO PIENO. «L'ink dei nomi accesi per la squadra
    //        selezionata deve essere bianco altrimenti non risalta» (04/09/2026): gli uomini di una
    //        rosa accesa sono «di un altro» per lo stato, e quello stato e' grigio di proposito, quindi
    //        smorzare il resto al 30% non bastava.
    //
    //        IL CONFRONTO E' FRA RIGHE DELLA STESSA PAGINA, e serve un NULL: le righe ancora nell'urna
    //        sono la definizione di «inchiostro pieno», quelle di un ALTRO padrone (non della rosa
    //        accesa) sono la definizione di «grigio», e se le due coincidessero il passo non
    //        proverebbe niente. Nessun letterale e nessun token: il tema ha due versi.
    const inkUrn = (afterRival ?? []).find((row) => !row.owner && !row.struck)?.ink ?? '';
    const inkOther =
      (afterRival ?? []).find((row) => row.owner && row.owner !== rivalColour && !row.struck)
        ?.ink ?? '';
    const litInk = his.filter((row) => !row.struck);
    const pale = litInk.filter((row) => row.ink !== inkUrn);
    note("l'inchiostro delle righe accese e' quello pieno", {
      said:
        `pieno ${inkUrn || '?'} · grigio ${inkOther || '?'} · ` +
        `${litInk.length - pale.length}/${litInk.length} righe accese col pieno`,
      problems: [
        ...(inkUrn && inkOther
          ? []
          : [
              "non ho trovato una riga nell'urna o una di un altro padrone: nessun confronto possibile",
            ]),
        ...(inkUrn !== inkOther
          ? []
          : ["nell'urna e di un altro hanno lo stesso inchiostro: il passo non proverebbe niente"]),
        ...(pale.length
          ? [
              `${pale.length} righe accese hanno ancora l'inchiostro smorzato: ` +
                pale
                  .slice(0, 4)
                  .map((row) => row.name)
                  .join(', '),
            ]
          : []),
      ],
    });

    // 4-bis. PRIMA LA MIA, POI UN RIVALE: il passo che mancava, ed e' il caso che l'operatore ha
    //        segnalato - «quando seleziono una squadra e poi ne seleziono un'altra, i calciatori
    //        della squadra precedente restano accesi». Mancava perche' il banco ESENTAVA i miei nei
    //        suoi filtri, cioe' portava dentro l'asserzione l'eccezione che avrebbe dovuto provare:
    //        due righe mie restavano accese per sempre e nessun passo poteva accorgersene.
    //
    //        La sequenza è quella sua, non una comoda: la prima rosa che uno guarda è la propria.
    if (mineAt >= 0) await click(session, cards[mineAt]);
    await wait(400);
    if (rivalAt >= 0) await click(session, cards[rivalAt]);
    await wait(400);
    const afterSwap = await evaluate(session, readRows);
    const leftMine = (afterSwap ?? []).filter(
      (row) => row.owner === mineColour && row.opacity > 0.9,
    );
    const nowHis = (afterSwap ?? []).filter(
      (row) => row.owner === rivalColour && row.opacity > 0.9,
    );
    note('prima la MIA, poi un rivale: la mia si spegne', {
      said:
        `${leftMine.length} righe mie ancora accese · ${nowHis.length} righe del rivale accese ` +
        `(ne ha ${(afterSwap ?? []).filter((row) => row.owner === rivalColour).length})`,
      problems: [
        ...(leftMine.length
          ? [
              `${leftMine.length} righe della rosa precedente sono rimaste accese: ` +
                leftMine
                  .slice(0, 4)
                  .map((row) => row.name)
                  .join(', '),
            ]
          : []),
        ...(nowHis.length ? [] : ['la lente non ha acceso nessuna riga del rivale']),
      ],
    });

    // 5. CLICCANDO UN'ALTRA CARD LA LENTE SI SPOSTA, e non se ne accende una seconda. E' il caso
    //    normale d'uso - si guarda una rosa dopo l'altra - e il difetto che nasconderebbe (due lenti
    //    insieme) lascerebbe in chiaro righe di due rose senza che niente lo dica.
    const thirdAt = (cards ?? []).findIndex((one, at) => at !== mineAt && at !== rivalAt);
    if (thirdAt >= 0) await click(session, cards[thirdAt]);
    const cardsThird = await evaluate(session, readCards);
    const afterThird = await evaluate(session, readRows);
    const oldOnes = (afterThird ?? []).filter(
      (row) => row.owner === rivalColour && row.opacity > 0.9,
    );
    const lit = (cardsThird ?? []).filter((one) => one.lens);
    note("cliccando un'altra card la lente si SPOSTA", {
      said:
        `accese ${lit.length} card («${lit.map((one) => one.label).join(', ')}») · ` +
        `${oldOnes.length} righe della rosa di prima sono ancora in chiaro`,
      problems: [
        ...(lit.length === 1 ? [] : [`le card accese sono ${lit.length} e non una`]),
        ...(cardsThird?.[thirdAt]?.lens ? [] : ["la card appena cliccata non e' quella accesa"]),
        ...(oldOnes.length
          ? [`${oldOnes.length} righe della rosa precedente sono rimaste in chiaro`]
          : []),
      ],
    });

    // 5-bis. E L'OCCHIO DELLA LENTE HA DIPINTO DAVVERO. Il passo esiste per un difetto che questo
    //        banco NON ha visto e che una code review ha trovato: `nzType="eye"` non era registrato in
    //        `NZ_ICONS`, quindi la direttiva metteva la classe, tentava un fetch da `assets/`, prendeva
    //        404 e non disegnava niente - e ogni passo che cercava `.anticon-eye` leggeva «c'e'» su una
    //        casella vuota. *Una classe che una direttiva mette comunque non e' la prova che qualcosa
    //        si veda.*
    //
    //        NELLA FORMA GENERALE E NON IN QUELLA PARTICOLARE: non «l'occhio c'e'» ma «nessuna icona
    //        della pagina e' vuota», perche' una registrazione dimenticata e' sempre lo stesso difetto
    //        e questa pagina disegna una dozzina di tipi. Con `waitFor`, perche' la risoluzione di
    //        un'icona e' asincrona: si POLLA invece di aspettare un tempo scelto a caso.
    const icons = await evaluate(session, countIcons);
    const unpainted = await waitFor(
      session,
      () => {
        const bad = [...document.querySelectorAll('.anticon')].filter(
          (one) => !one.querySelector('svg'),
        );
        // `waitFor` si ferma al primo valore VERO, quindi si aspetta il caso buono: la lista vuota
        // arriva solo dopo l'ultimo tentativo, ed e' esattamente il verdetto che si vuole.
        return bad.length
          ? bad.map(
              (one) =>
                [...one.classList].find((name) => name.startsWith('anticon-')) ??
                one.getAttribute('nztype') ??
                '?',
            )
          : null;
      },
      8,
    );
    const eyeDrawn = await evaluate(
      session,
      () => !!document.querySelector('.anticon-eye svg, .anticon-eye path'),
    );
    note("ogni icona della pagina ha dipinto, l'occhio della lente compreso", {
      said:
        `${icons ?? 0} icone a schermo · ${(unpainted ?? []).length} vuote` +
        ((unpainted ?? []).length ? ` (${[...new Set(unpainted)].join(', ')})` : '') +
        ` · occhio ${eyeDrawn ? 'disegnato' : 'VUOTO'}`,
      problems: [
        ...(icons > 10 ? [] : [`solo ${icons} icone a schermo: il passo non proverebbe niente`]),
        ...((unpainted ?? []).length
          ? [
              'icone senza svg (tipo non registrato in NZ_ICONS?): ' +
                [...new Set(unpainted)].join(', '),
            ]
          : []),
        ...(eyeDrawn ? [] : ["l'occhio della lente non ha disegnato niente"]),
      ],
    });

    // 6. E LA LENTE VALE ANCHE SUGLI SLOT PERSONALI: sono due tagli della stessa plancia, quindi una
    //    lente che funziona su uno solo sarebbe una lente che si spegne cambiando vista senza dirlo.
    const toPersonal = await evaluate(session, boxOf, 'header nz-radio-group label', 'personali');
    if (toPersonal) await click(session, toPersonal);
    await wait(500);
    const view = await evaluate(session, readView);
    const personal = await evaluate(session, readRows);
    const thirdColour = cards[thirdAt].colour;
    const hisPersonal = (personal ?? []).filter((row) => row.owner === thirdColour);
    const dimPersonal = (personal ?? []).filter((row) => row.opacity < 0.9).length;
    note('e la lente vale anche sugli slot personali', {
      said: `taglio «${view ?? '?'}» · ${hisPersonal.length} righe sue · ${dimPersonal} al 30%`,
      problems: [
        ...(/personali/i.test(view ?? '') ? [] : ["il taglio non e' passato agli slot personali"]),
        ...(dimPersonal ? [] : ["sugli slot personali non c'e' nessuna riga smorzata"]),
        ...(hisPersonal.length && hisPersonal.every((row) => row.opacity > 0.9)
          ? []
          : ['sugli slot personali le righe della rosa accesa non sono in chiaro']),
      ],
    });

    // 7. E IL DOPPIO CLICK NON TOCCA LA LENTE. E' la coesistenza il rischio di questo gesto, ed e' il
    //    passo che ha bocciato la prima versione del codice: il guard su `MouseEvent.detail` fermava il
    //    secondo click e non il PRIMO, che ha `detail` 1 come tutti - quindi un doppio click su una
    //    card accesa la spegneva prima di assegnare (misurato: card 2 prima, nessuna dopo).
    //
    //    DUE INCOGNITE, DUE ASSERZIONI: che la lente non si muova, e che il doppio click ARRIVI
    //    comunque - un ritardo che annulla troppo si legge come «la lente e' ferma» ed e' invece
    //    un'assegnazione persa, che e' il difetto peggiore dei due. La prova che arriva e' il RIFIUTO a
    //    prezzo zero, che la pagina scrive da se'.
    const backToMarket = await evaluate(session, boxOf, 'header nz-radio-group label', 'mercato');
    if (backToMarket) await click(session, backToMarket);
    await wait(400);
    const lensBefore = (await evaluate(session, readCards))?.findIndex((one) => one.lens);
    if (thirdAt >= 0) await click(session, cards[thirdAt], 2);
    await wait(500);
    const lensAfter = (await evaluate(session, readCards))?.findIndex((one) => one.lens);
    const said = await evaluate(session, readAlert);
    note('il doppio click non tocca la lente, e arriva comunque', {
      said:
        `accesa la card ${lensBefore + 1} prima, la ${lensAfter + 1} dopo · ` +
        `la pagina dice «${(said ?? '—').slice(0, 70)}»`,
      problems: [
        ...(lensBefore === lensAfter
          ? []
          : [
              `il doppio click ha spostato la lente: era la ${lensBefore + 1}, ` +
                `e' la ${lensAfter + 1}`,
            ]),
        ...(said
          ? []
          : [
              "il doppio click non ha prodotto nessuna risposta: il ritardo dell'accensione lo ha " +
                "mangiato, e un'assegnazione persa in silenzio e' peggio di una lente che sfarfalla",
            ]),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'plancia-lens.png');
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
