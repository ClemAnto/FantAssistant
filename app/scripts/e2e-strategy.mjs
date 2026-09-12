/**
 * e2e-strategy.mjs - drive the REAL strategy page in a browser and MEASURE it.
 *
 * Why a browser. Everything this page promises is a fact about the SCREEN and not about the DOM: «the
 * page does not scroll, the lists do» is a comparison of rectangles, «every name carries a crest, its
 * roles and its gain» is a count of elements per row, and «the settings button opens the panel» is a
 * pointer arriving at the coordinates the browser reports - which is exactly what a synthetic
 * `element.click()` cannot prove (app/CLAUDE.md, measured 20/08/2026 on the table's funnels).
 *
 * Zero dependencies, like the other two harnesses: it serves `dist/` itself, launches Edge or Chrome
 * headless and speaks CDP. It reports how many blocks and how many rows it examined, because an audit
 * that answers «0 problems» after looking at nothing is indistinguishable from a clean page.
 *
 * Usage: node scripts/e2e-strategy.mjs [--headed] [--json] [--shot]
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
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gz': 'application/gzip', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.sqlite': 'application/octet-stream',
};
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
/**
 * LA LEGA CHE IL BANCO DICHIARA: dieci partecipanti, rose 3/8/8/6 - i valori di partenza dell'app, che
 * la corsa ripristina cancellando le impostazioni salvate prima di misurare qualunque cosa.
 *
 * Sta QUI e non si legge dalla pagina, perché è il riferimento contro cui la pagina viene giudicata: le
 * lunghezze attese dei blocchi (slot × partecipanti) e la larghezza di una BANDA di sfondo vengono da
 * questi due numeri, e ricavarle da quello che lo schermo dice sarebbe l'asserzione circolare.
 */
/** «· Dc/B»: i codici mantra come la frase della riga li scrive, quando sono piu' di uno. */
const CODES = / · [A-Za-z]+\/[A-Za-z]+/;
const TEAMS = 10;
const SLOTS = { P: 3, D: 8, C: 8, A: 6 };

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Una porta che in questo momento nessuno tiene. */
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
  await wait(250);
}

/**
 * UN TRASCINAMENTO VERO: premi, muovi a passi col tasto GIU', lascia.
 *
 * `buttons: 1` su ogni movimento non e' decorazione: senza di lui il browser manda un `pointermove` col
 * tasto alzato e la pagina non ha niente in mano. E i passi sono tanti perche' il gesto ha una soglia -
 * un salto solo la supererebbe, ma non assomiglierebbe a una mano.
 */
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

/**
 * CLICCA UN BERSAGLIO CHE STA FERMO, e non uno che si sta muovendo.
 *
 * `boxOf` da' le coordinate al momento della MISURA; un modale che entra con la sua animazione zoom sposta
 * i suoi bottoni per ~200ms, quindi un click a quelle coordinate atterra dove il bottone NON e' piu'.
 * Misurato contando i click che ARRIVANO: `elementFromPoint` sul centro di «Annulla» rispondeva col suo
 * stesso `span` (quindi «il bottone e' li'») e il click arrivato era **0**. E' la lezione dei filtri della
 * tabella vista dal lato del tempo: un controllo si verifica alle coordinate che il browser dichiara *nel
 * momento in cui si clicca*.
 *
 * Due letture uguali di fila e il bersaglio e' fermo; se non lo diventa mai, si clicca l'ultima e il
 * chiamante lo scopre dal suo asserto - non si finge di aver cliccato.
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

/**
 * ASPETTA CHE LA FINESTRA CI SIA, invece di contare millisecondi.
 *
 * L'attesa a tempo del `click` bastava finche' nessun passo ricaricava la pagina: dopo un `Page.reload`
 * l'overlay del modale si costruisce per la prima volta e 250ms non sempre bastano, quindi il passo
 * leggeva «non si e' aperta» e i sette passi dopo cadevano con lui. Un passo che misura due incognite -
 * «si apre?» e «e' gia' pronta?» - attribuisce il difetto a quella sbagliata.
 */
async function waitForClosed(session, tries = 20) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    if (!(await evaluate(session, modalOpen))?.visible) return true;
    await wait(200);
  }
  return false;
}

async function waitForModal(session, tries = 40) {
  let modal = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    modal = await evaluate(session, modalOpen);
    if (modal?.visible) return modal;
    await wait(250);
  }
  return modal;
}

// ------------------------------------------------------------------ what runs IN the page

/** Every block with its own rectangle, its header count and the rows the browser really drew. */
function readBlocks() {
  const sections = [...document.querySelectorAll('app-strategy section')];
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      left: Math.round(rect.left), width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };
  return sections.map((section) => {
    const header = section.querySelector('header');
    const counter = header?.lastElementChild;
    const list = section.querySelector('ol');
    // Le righe dei GIOCATORI, e non ogni `li`: la lista porta anche la riga di confine «arrivano da
    // dietro», che non è un nome e non va contata contro il contatore del blocco.
    const rows = list
      ? [...list.querySelectorAll('li')].filter((one) => one.querySelector('ui-gain'))
      : [];
    return {
      role: header?.querySelector('ui-role')?.innerText?.trim() ?? '',
      label: header?.querySelector('span')?.innerText?.trim() ?? '',
      counter: (counter?.innerText ?? '').trim(),
      box: box(section),
      list: list ? box(list) : null,
      scrollHeight: list?.scrollHeight ?? 0,
      clientHeight: list?.clientHeight ?? 0,
      rows: rows.length,
      // Cosa porta ogni riga: lo stemma, il nome e il gain. Contati, non guardati - e i BADGE DEI
      // RUOLI si contano ancora perché quello che si asserisce ora è la loro ASSENZA (il blocco è già
      // il ruolo): un'assenza si misura, o «non l'ho guardato» si legge come «non c'è».
      parts: rows.map((row) => ({
        crest: row.querySelectorAll('ui-crest img, ui-crest span').length,
        roles: row.querySelectorAll('ui-roles span').length,
        name: (row.querySelector('span.flex-1')?.innerText ?? '').trim(),
        gain: (row.querySelector('ui-gain')?.innerText ?? '').trim(),
        // «lo metteresti più arretrato»: in questo blocco è un ripiego, non un acquisto per questo posto.
        behind: row.dataset.behind === '1',
        // LA BANDA che la riga dichiara e il fondo che la disegna. Il colore si legge COMPUTATO e si
        // confronta fra righe della stessa pagina, mai con un letterale: i token sono `color-mix` e il
        // tema ha due versi, quindi l'unica affermazione verificabile è «questa riga è come quella».
        band: Number(row.dataset.band),
        background: getComputedStyle(row).backgroundColor,
        padLeft: Math.round(parseFloat(getComputedStyle(row).paddingLeft)),
        // La frase della riga: è dove sono finiti i codici mantra da quando il badge non c'è più.
        title: row.getAttribute('title') ?? '',
      })),
      // La riga di confine è l'unico `li` senza un gain: contarla per l'attributo prenderebbe anche i
      // nativi, che non ne hanno nessuno (`null` non scrive l'attributo).
      dividers: list
        ? [...list.querySelectorAll('li')].filter((one) => !one.querySelector('ui-gain')).length
        : 0,
    };
  });
}

/**
 * LE TRE PASTIGLIE di ogni riga, con l'identita' dell'uomo e i RETTANGOLI che occupano.
 *
 * L'identita' serve perche' l'unica verifica che valga qualcosa e' quella contro il FOGLIO: confrontare
 * la pastiglia con un numero ricavato dalla pastiglia stessa e' l'asserzione circolare che questo
 * progetto ha gia' pagato (`e2e-plancia-injury.mjs`, 04/09/2026). E i rettangoli servono perche' tre
 * riquadri aggiunti a una riga stretta si pagano sul NOME: «276px di colonne non erano strette, erano
 * ASSENTI» e' la stessa famiglia, quindi il costo si misura invece di sperarlo.
 */
function readPills() {
  const rows = [...document.querySelectorAll('app-strategy ol li[data-id]')];
  return rows.map((row) => {
    const name = row.querySelector('span.flex-1');
    // LA FILA SI TROVA PER IL SUO MARCHIO e non contandone i figli: da quando le letture si scelgono
    // (05/09/2026) quanti riquadri ci siano è una PREFERENZA, quindi un arnese che cerca «quello con
    // tre span» misura il default e non la pagina.
    const strip = row.querySelector('[data-readings]');
    const pills = strip ? [...strip.querySelectorAll(':scope > span')] : [];
    const rect = row.getBoundingClientRect();
    return {
      id: Number(row.dataset.id),
      // IL BLOCCO a cui la riga appartiene: le colonne si incolonnano DENTRO una lista, e due liste
      // affiancate stanno a due x diverse per costruzione.
      block: [...document.querySelectorAll('app-strategy ol')].indexOf(row.closest('ol')),
      name: (name?.innerText ?? '').trim(),
      // IL BORDO DESTRO della fila e se la riga porta il TILDE della stima: in un flex dove il nome e'
      // `flex-1`, il bordo destro di un elemento vale `container.right - (somma dei successivi)`,
      // quindi QUALUNQUE cosa condizionale messa dopo la fila la sposta solo su alcune righe.
      stripRight: strip ? Math.round(strip.getBoundingClientRect().right * 100) / 100 : null,
      estimated: !!row.querySelector('[data-estimated]'),
      // Ogni riquadro col NOME della lettura che porta: confrontarli per posizione vorrebbe dire
      // sapere l'ordine, e l'ordine è quello che l'operatore può cambiare.
      say: Object.fromEntries(
        pills.map((one) => [one.dataset.reading ?? '?', (one.innerText ?? '').trim()]),
      ),
      faded: pills.filter((one) => Number(getComputedStyle(one).opacity) < 0.9)
        .map((one) => one.dataset.reading ?? '?'),
      // Il nome e' TAGLIATO quando il testo e' piu' largo della cella: e' il prezzo delle pastiglie, e
      // si legge dal browser invece che dal numero di caratteri.
      nameWidth: name ? Math.round(name.getBoundingClientRect().width) : 0,
      nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : false,
      pills: pills.map((one) => (one.innerText ?? '').trim()),
      height: Math.round(rect.height),
      // SU CHE RIGA STANNO: su un blocco stretto vanno a capo (`@max-[23rem]:order-last`), e allora
      // NON tolgono un pixel al nome - quindi un nome corto lì è un fatto della lista stretta e non
      // loro. Un passo che misura due incognite insieme attribuisce il difetto a quella sbagliata.
      stripOwnLine: !!(strip && name
        && strip.getBoundingClientRect().top >= name.getBoundingClientRect().bottom - 2),
      // Dentro la riga, o e' un riquadro che c'e' nel DOM e non sullo schermo.
      outside: pills.filter((one) => {
        const box = one.getBoundingClientRect();
        return box.right > rect.right + 1 || box.left < rect.left - 1 || box.width === 0;
      }).length,
    };
  });
}

/**
 * LE SETTE PASTIGLIE DELLA BARRA: quale numero accendono e se sono accese.
 *
 * Si leggono per `data-reading` e non per posizione, e l'ACCESO si legge da `aria-pressed` invece che
 * dalla classe di antd: la classe e' un fatto sulla libreria, lo stato e' un fatto sul bottone.
 */
function readToggles() {
  return [...document.querySelectorAll('app-strategy button[data-reading]')].map((one) => {
    const box = one.getBoundingClientRect();
    return {
      key: one.dataset.reading,
      text: (one.innerText ?? '').trim(),
      on: one.getAttribute('aria-pressed') === 'true',
      point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      // Chi risponde a quel punto: «il bottone c'e'» e' un fatto sul DOM, non sullo schermo.
      under: (document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        ?.tagName ?? '').toLowerCase(),
    };
  });
}

/**
 * LE CARD APERTE e cosa portano: l'intestazione, i due numeri grandi e le righe delle ultime partite.
 *
 * Le righe si contano per CELLE e non per elementi: `ui-match-line` ha `display: contents`, quindi il
 * suo elemento non esiste sullo schermo - contare i componenti direbbe «cinque righe» anche se la
 * griglia le avesse schiacciate a zero.
 */
function readCards() {
  return [...document.querySelectorAll('ui-player-card > div')].map((card) => {
    const box = card.getBoundingClientRect();
    const lines = [...card.querySelectorAll('ui-match-line')].map((line) => {
      const cells = [...line.children].map((cell) => ({
        text: (cell.innerText ?? '').replace(/\s+/g, ' ').trim(),
        width: Math.round(cell.getBoundingClientRect().width),
      }));
      return {
        cells: cells.length,
        text: cells.map((one) => one.text),
        // Ogni cella dentro la card, o e' un riquadro che c'e' nel DOM e non sullo schermo.
        outside: cells.filter((one) => one.width === 0).length,
        crests: line.querySelectorAll('ui-crest').length,
      };
    });
    // IL RIEPILOGO DELLA STAGIONE IN CIMA: e' quello che le pastiglie della lista devono ripetere, e
    // il confronto fra i due e' la sola prova che la definizione sia una sola.
    const totals = card.querySelector('[data-season-totals]');
    const marks = totals ? [...totals.children][3] : null;
    const expected = card.querySelector('[data-season-expected]');
    return {
      summary: totals
        ? {
          played: Number(((totals.children[0]?.innerText ?? '').match(/\d+/) ?? [0])[0]),
          marks: (marks?.innerText ?? '').replace(/\s+/g, ' ').trim(),
          expected: (expected?.children[1]?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        }
        : null,
      name: (card.querySelector('.text-sm')?.innerText ?? '').trim(),
      // La riga sotto il nome (club · dove): il fratello del titolo, invece di un selettore su una
      // classe con le parentesi quadre - che in una stringa JS va scritta con due escape e in CSS con uno.
      where: (card.querySelector('.text-sm')?.nextElementSibling?.innerText ?? '').trim(),
      box: { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width) },
      // La META' D'ASTA non deve esistere qui: la Strategia e' quello che si prepara prima di sedersi.
      market: /max offerta|pagato/.test(card.innerText),
      lines,
      note: (card.querySelector('.border-t')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    };
  });
}

/** La pagina scorre? Le liste possono; la pagina no, ed è il punto del layout. */
function readPage() {
  const root = document.documentElement;
  const bar = document.querySelector('app-strategy .bg-surface');
  return {
    scrollHeight: root.scrollHeight,
    innerHeight: window.innerHeight,
    bodyScroll: document.body.scrollHeight,
    alerts: [...document.querySelectorAll('nz-alert')].map((one) => one.innerText.trim().slice(0, 160)),
    summary: (bar?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

/** Where a control really is, by its visible text. Null when nothing on screen carries it. */
function boxOf(selector, text) {
  const found = [...document.querySelectorAll(selector)].find(
    (one) => (one.innerText ?? '').trim().toLowerCase().includes(text.toLowerCase()),
  );
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  // Chi c'è DAVVERO sotto quel punto: «il bottone è lì» è un fatto sul DOM, non sullo schermo.
  const under = document.elementFromPoint(x, y);
  return {
    x, y,
    text: (found.innerText ?? '').trim().slice(0, 40),
    under: under ? `${under.tagName.toLowerCase()}${under.className ? '.' + String(under.className).split(' ')[0] : ''}` : null,
    inside: found.contains(under) || under?.contains(found) || false,
  };
}

/**
 * L'ULTIMA RIGA DELL'ULTIMO BLOCCO, portata in fondo, contro il box del viaggio nel tempo.
 *
 * Il box è `fixed` in basso a destra e sta fuori dalla vista, quindi nessuna misura DENTRO la pagina lo
 * vede: due rettangoli che si sovrappongono sono un nome che al tavolo non si legge.
 */
function readTail() {
  const sections = [...document.querySelectorAll('app-strategy section')];
  const last = sections.at(-1);
  const list = last?.querySelector('ol');
  if (!list) return null;
  list.scrollTop = list.scrollHeight;
  const rows = [...list.querySelectorAll('li')];
  const name = rows.at(-1);
  const machine = document.querySelector('ui-time-machine > div, ui-time-machine div');
  const rect = (element) => {
    const one = element.getBoundingClientRect();
    return {
      top: Math.round(one.top), bottom: Math.round(one.bottom),
      left: Math.round(one.left), right: Math.round(one.right),
    };
  };
  if (!name) return null;
  const row = rect(name);
  const box = machine ? rect(machine) : null;
  const covered = box
    ? row.bottom > box.top && row.top < box.bottom && row.right > box.left && row.left < box.right
    : false;
  return { role: last.querySelector('ui-role')?.innerText?.trim() ?? '', row, box, covered,
           text: (name.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) };
}

/**
 * Dove sta una riga, e chi e'. Le coordinate sono quelle che il BROWSER dichiara: un gesto si guida su
 * quelle e non su una somma di altezze.
 */
function rowGeometry(block, index) {
  const sections = [...document.querySelectorAll('app-strategy section')];
  const rows = [...(sections[block]?.querySelectorAll('li[data-id]') ?? [])];
  const one = rows[index];
  if (!one) return null;
  const box = one.getBoundingClientRect();
  return {
    x: Math.round(box.left + box.width / 2),
    y: Math.round(box.top + box.height / 2),
    top: Math.round(box.top),
    id: Number(one.dataset.id),
    name: (one.querySelector('span.flex-1')?.innerText ?? '').trim(),
    of: rows.length,
  };
}

/**
 * CONTA GLI EVENTI CHE ARRIVANO, non quelli spediti.
 *
 * E' la lezione del 20/08/2026 sulla tabella: un `mousedown` piu' un movimento sopra del testo fa partire
 * il drag NATIVO di Chromium, che si prende il puntatore e smette di mandare `pointermove`. Nessuna misura
 * di geometria o di ordine lo vede - si legge come «funziona a volte», che e' il difetto piu' difficile da
 * inseguire. Quindi la pagina si mette in ascolto e li conta.
 */
function armEvents() {
  const seen = { down: 0, move: 0, up: 0 };
  window.__strategyEvents = seen;
  window.addEventListener('pointerdown', () => (seen.down += 1), true);
  window.addEventListener('pointermove', () => (seen.move += 1), true);
  window.addEventListener('pointerup', () => (seen.up += 1), true);
  return true;
}

/**
 * I PEZZI DI CDK: l'anteprima e il segnaposto (che a metà volo devono esserci) e i `transform` rimasti
 * addosso alle righe (che al rilascio devono essere zero).
 *
 * È la misura per cui CDK era stato mandato via dalla tabella il 18/08/2026: al rilascio quattro
 * intestazioni restavano traslate di 64px mentre l'ordine era già cambiato, cioè si vedevano celle nuove
 * con lo spostamento della posizione vecchia. Qui le righe sono `<li>` di una lista che scorre, e questa
 * funzione è quello che permette di dirlo invece di crederlo.
 */
function cdkPieces() {
  const rows = [...document.querySelectorAll('app-strategy ol li[data-id]')];
  const moved = rows.filter((one) => {
    const t = one.style.transform;
    return !!t && t !== 'none';
  });
  const preview = document.querySelector('.cdk-drag-preview');
  const placeholder = document.querySelector('.cdk-drag-placeholder');
  const paint = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      opacity: style.opacity, background: style.backgroundColor, shadow: style.boxShadow,
      // Le classi che l'elemento porta DAVVERO: la clonazione di CDK e' l'unica cosa che decide se una
      // variante Tailwind scritta sulla riga arriva anche sull'anteprima.
      classes: String(element.className).slice(0, 200),
      inline: element.getAttribute('style') ?? null,
      parent: element.parentElement?.tagName.toLowerCase() ?? null,
      // Il token è arrivato fin qui? Un `var()` che non risolve vale «trasparente» col build verde.
      token: style.getPropertyValue('--color-surface').trim() || null,
      hasClass: element.classList.contains('[&.cdk-drag-preview]:bg-surface'),
      // LA DOMANDA DECISIVA: il browser dice che quel selettore combacia con questo elemento? Tutto il
      // resto (la classe c'e', il token risolve, la regola e' nel CSS) puo' essere vero e la regola non
      // applicarsi comunque - e allora la causa e' nel selettore, non nel colore.
      matches: (() => {
        const out = [];
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules; } catch { continue; }
          for (const rule of rules) {
            const walk = (one) => {
              if (one.cssRules) { for (const kid of one.cssRules) walk(kid); return; }
              if (!one.selectorText || !one.selectorText.includes('cdk-drag')) return;
              let hit = false;
              try { hit = element.matches(one.selectorText); } catch { hit = false; }
              out.push({ sel: one.selectorText.slice(0, 90), hit, css: one.style.cssText.slice(0, 60) });
            };
            walk(rule);
          }
        }
        return out;
      })(),
    };
  };
  return {
    previews: document.querySelectorAll('.cdk-drag-preview').length,
    placeholders: document.querySelectorAll('.cdk-drag-placeholder').length,
    dragging: document.querySelectorAll('.cdk-drop-list-dragging').length,
    moved: moved.length,
    example: moved[0]?.style.transform ?? null,
    // Come sono VESTITI, che è la richiesta dell'operatore del 27/08: l'anteprima trasparente, il
    // segnaposto con un fondo. Si misurano i valori CALCOLATI, perché una schermata mostra una resa e
    // non un numero - e un `color-mix()` che punta a un token cancellato smette di dipingere col build
    // verde.
    preview: paint(preview),
    placeholder: paint(placeholder),
  };
}

/**
 * IL FOGLIO SERIE A CLASSIC letto dal FILE, che e' la fonte indipendente da quello che la pagina disegna.
 *
 * Gli stessi due ripieghi che legge l'app (`valuation-store.readSheet`): `engine_*` dove c'e', `est_*`
 * dove il motore non prezza. Non e' una terza definizione - e' la stessa regola riscritta apposta fuori
 * dall'app, che e' quello che rende il confronto una prova invece di un'eco.
 */
/** Chi ha uno spell APERTO oggi, dalla tabella del bundle: un fatto con due date, non una formula. */
async function openInjuries() {
  const raw = await readFile(join(DIST, 'data', 'injuries.json.gz'));
  const table = JSON.parse(gunzipSync(raw).toString('utf8'));
  const at = (name) => table.columns.indexOf(name);
  const [id, from, to] = ['fc_id', 'start_date', 'end_date'].map(at);
  const today = new Date().toISOString().slice(0, 10);
  const out = new Set();
  for (const row of table.rows) {
    const start = row[from];
    const end = row[to];
    if (start && start <= today && (!end || end >= today)) out.add(Number(row[id]));
  }
  return out;
}

/**
 * Preme una pastiglia delle letture leggendone le coordinate ADESSO, e poi porta il puntatore via.
 *
 * Le coordinate si rileggono a ogni giro perche' la barra si ridisegna, e il puntatore si sposta perche'
 * UN TOOLTIP LUNGO COPRE IL CONTROLLO ACCANTO - la lezione delle buste chiuse (25/08/2026), pagata due
 * volte qui: la prima versione leggeva i bottoni una volta sola e il secondo click finiva sul pannello
 * aperto dal primo, quindi «spegnere Bpm» non spegneva niente; e il 05/09/2026 lo stesso difetto ha
 * lasciato ACCESA la pastiglia xG dopo il passo che la doveva rimettere com'era, facendo fallire due
 * passi piu' in la' che misuravano tutt'altro. Una definizione sola, quindi, e due chiamanti.
 */
/**
 * SCEGLIE UNA VOCE DEL SELETTORE D'ORDINAMENTO, con un puntatore vero e verificando che abbia MORSO.
 *
 * Il pannello di un `nz-select` entra con la sua animazione, quindi le voci SI MUOVONO per ~200ms:
 * si passa da `clickSteady`, che e' la lezione gia' pagata sul modale delle opzioni («un bersaglio in
 * movimento non e' cliccabile, e le coordinate sono quelle al momento del CLICK»). E si CHIUDE il
 * pannello alla fine: un overlay lasciato aperto intercetta i click dei passi seguenti, che poi
 * accusano la pagina di aprire la card di un altro.
 */
/**
 * LA VOCE DI UNA TENDINA VIRTUALE, cercata SCORRENDO: `cdk-virtual-scroll-viewport` disegna solo quello
 * che si vede, quindi «non e' nel DOM» e «non esiste» sono due frasi diverse.
 *
 * Si scorre SOLO il contenitore della tendina e mai con `scrollIntoView`, che si porta dietro ogni
 * antenato scorrevole (05/09) e sposterebbe la pagina sotto i passi seguenti. Si riporta anche tutto
 * quello che si e' visto passare: un errore che dice «non c'e'» senza dire cosa c'era e' un errore che
 * non si puo' diagnosticare.
 */
async function findOption(session, label) {
  const seen = new Set();
  let scrolled = null;
  // SI PARTE DALL'ALTO, e questo e' il passo che mancava: la tendina si apre gia' scorsa sulla voce
  // SCELTA, quindi scorrendo solo in avanti le voci PRECEDENTI non compaiono mai - e l'arnese diceva
  // «non c'e'» della prima voce dell'elenco. Un passo che cerca in una direzione sola trova solo meta'
  // delle cose che cerca.
  await evaluate(session, () => {
    const item = document.querySelector('nz-option-item');
    const holder = item?.closest('cdk-virtual-scroll-viewport, .rc-virtual-list-holder, .ant-select-dropdown');
    if (holder) holder.scrollTop = 0;
    return true;
  });
  await wait(150);
  for (let turn = 0; turn < 40; turn += 1) {
    const step = await evaluate(session, (wanted) => {
      const items = [...document.querySelectorAll('nz-option-item')];
      if (!items.length) return { texts: [], stuck: true };
      const holder = items[0].closest(
        'cdk-virtual-scroll-viewport, .rc-virtual-list-holder, .ant-select-dropdown',
      );
      const texts = items.map((one) => (one.innerText ?? '').trim());
      const item = items.find((one, at) => texts[at] === wanted);
      if (item && holder) {
        const before = holder.scrollTop;
        holder.scrollTop = item.offsetTop - holder.clientHeight / 2 + item.offsetHeight / 2;
        return { texts, found: true, scrolled: { before, after: holder.scrollTop, height: holder.clientHeight } };
      }
      if (!holder) return { texts, stuck: true };
      const before = holder.scrollTop;
      holder.scrollTop = before + Math.max(64, holder.clientHeight - 32);
      return { texts, stuck: holder.scrollTop === before };
    }, label);
    for (const one of step?.texts ?? []) seen.add(one);
    if (step?.found) {
      scrolled = step.scrolled;
      await wait(250);
      return { found: true, seen: [...seen], scrolled };
    }
    if (step?.stuck) break;
    await wait(120);
  }
  return { found: false, seen: [...seen], scrolled };
}

async function pickSort(session, label) {
  const before = await evaluate(session, () => {
    const select = document.querySelector('app-strategy nz-select[data-sort]');
    if (!select) return null;
    const rect = select.getBoundingClientRect();
    return rect.width
      ? { point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          text: (select.innerText ?? '').trim() }
      : null;
  });
  if (!before) return { problem: "non c'e' nessun selettore d'ordinamento in barra" };
  await click(session, before.point);
  await wait(400);
  // LA VOCE PUO' ESSERE FUORI DALLO SCORRIMENTO DELLA TENDINA, e allora il dito non ci arriva.
  //
  // Misurato il 06/09/2026: il pannello e' alto 264px e tiene nove voci; la dodicesima esiste nel DOM
  // a y=497 mentre il pannello finisce a 357, quindi `elementFromPoint` sul suo centro risponde con una
  // riga della PAGINA e il click chiude la tendina invece di scegliere. E' la lezione dei varchi fuori
  // schermo (20/08) su un contenitore piu' piccolo: si porta la voce dentro il pannello e si clicca.
  //
  // ...E DAL 12/09/2026 SI CERCA SCORRENDO, perche' quella tendina e' VIRTUALE: quello che non e'
  // visibile non e' nel DOM affatto. Con ventuno voci al posto di diciassette (le quattro frequenze) la
  // tendina si apre gia' scorsa sulla voce scelta, e un `querySelectorAll` letto una volta sola
  // rispondeva «la voce non c'e'» a proposito della PRIMA - cioe' l'arnese accusava la pagina del
  // proprio difetto, per l'ennesima volta. `findOption` scorre il contenitore dall'alto finche' la
  // trova, e riporta tutto quello che ha visto passare.
  const scan = await findOption(session, label);
  const scrolled = scan.scrolled;
  if (!scan.found) {
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
    return {
      was: before.text,
      problem: `la voce «${label}» non e' nel pannello: ci sono ${JSON.stringify(scan.seen)}`,
    };
  }
  const probe = await evaluate(session, boxOf, 'nz-option-item', label);
  const hit = await clickSteady(session, 'nz-option-item', label);
  await wait(400);
  const now = await evaluate(session, () => ({
    text: (document.querySelector('app-strategy nz-select[data-sort]')?.innerText ?? '').trim(),
    panels: document.querySelectorAll('nz-option-container').length,
    // La preferenza sul disco: se il click e' arrivato, questa e' cambiata anche se lo schermo no.
    saved: localStorage.getItem('fantassistant.strategy.sort'),
    under: (() => {
      const item = [...document.querySelectorAll('nz-option-item')][0];
      if (!item) return 'nessuna voce';
      const r = item.getBoundingClientRect();
      return (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.tagName ?? '?');
    })(),
  }));
  return {
    was: before.text,
    problem: !hit
      ? `la voce «${label}» non si e' fatta cliccare`
      : now.text !== label
        ? `il selettore legge «${now.text}» invece di «${label}» (disco ${now.saved}, scorrimento ${JSON.stringify(scrolled)}, voce ${JSON.stringify(probe)})`
        : now.panels
          ? "il pannello del selettore e' rimasto aperto: coprirebbe i passi seguenti"
          : null,
  };
}

async function pressReading(session, key) {
  const now = (await evaluate(session, readToggles)) ?? [];
  const pill = now.find((one) => one.key === key);
  if (!pill) return `nessuna pastiglia «${key}» in barra`;
  if (pill.under !== 'button' && pill.under !== 'span') {
    return `sotto la pastiglia «${key}» c'e' ${pill.under}: e' coperta`;
  }
  const before = pill.on;
  await click(session, pill.point);
  // Via dal bottone: il tooltip si chiude e non copre quello che si preme dopo.
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 500, button: 'none' });
  await wait(250);
  // E SI VERIFICA CHE ABBIA MORSO: un click che non cambia niente e' indistinguibile da un bottone
  // che non c'e', e il passo dopo ne accusa un altro.
  const after = ((await evaluate(session, readToggles)) ?? []).find((one) => one.key === key);
  if (after && after.on === before) return `la pastiglia «${key}» non ha cambiato stato`;
  return null;
}

/** I campionati che il bundle chiama «campionato»: `players-store.LEAGUE_COMPETITIONS`, riscritti. */
const LEAGUES = new Set([
  'serie_a', 'premier_league', 'la_liga', 'bundesliga', 'ligue_1', 'serie_b',
]);

/**
 * GLI ATTESI DEL BUNDLE, ri-derivati QUI e non importati dall'app.
 *
 * Dal LAYER PER-PARTITA, che e' quello che la pagina somma: l'aggregato di stagione dello STESSO
 * provider (`external_stats`) e' stato misurato e scartato il 05/09/2026 - a due decimali il 19,7%
 * degli uomini leggeva due cifre diverse fra la pastiglia e la card, fino a 0,21 di scarto, e le due
 * cose stanno sullo schermo insieme.
 *
 * La regola dei vuoti si riscrive apposta invece di importarla: dentro un (stagione, competizione) in
 * cui la fonte ha pubblicato almeno un attesa una cella vuota e' uno ZERO, fuori e' un ignoto. Se un
 * giorno cambiasse in un solo posto, questo banco deve accorgersene e non seguirla.
 */
async function expectedFromBundle() {
  const manifest = JSON.parse(await readFile(join(DIST, 'data', 'manifest.json'), 'utf8'));
  const raw = await readFile(join(DIST, 'data', 'external_match_stats.json.gz'));
  const table = JSON.parse(gunzipSync(raw).toString('utf8'));
  const at = (name) => table.columns.indexOf(name);
  const [id, season, competition, minutes, xg, xa] =
    ['fc_id', 'season', 'competition', 'minutes', 'xg', 'xa'].map(at);
  const scope = { xg: new Set(), xa: new Set() };
  for (const row of table.rows) {
    const key = `${row[season]}|${row[competition]}`;
    if (row[xg] != null) scope.xg.add(key);
    if (row[xa] != null) scope.xa.add(key);
  }
  const out = new Map();
  for (const row of table.rows) {
    if (row[season] !== manifest.target_season) continue;
    if (!LEAGUES.has(row[competition]) || !row[minutes]) continue;
    const key = `${row[season]}|${row[competition]}`;
    const sum = out.get(Number(row[id])) ?? { xg: 0, xa: 0, onXg: 0, onXa: 0, matches: 0 };
    if (scope.xg.has(key)) { sum.xg += row[xg] ?? 0; sum.onXg += 1; }
    if (scope.xa.has(key)) { sum.xa += row[xa] ?? 0; sum.onXa += 1; }
    sum.matches += 1;
    out.set(Number(row[id]), sum);
  }
  for (const [key, sum] of out) {
    out.set(key, {
      xg: sum.onXg ? sum.xg / sum.onXg : null,
      xa: sum.onXa ? sum.xa / sum.onXa : null,
      matches: sum.matches,
    });
  }
  return out;
}

/**
 * I GOL E GLI ASSIST CONTATI del bundle, per stagione: quello che le due pastiglie `G:A` devono dire.
 *
 * DAI VOTI (`match_ratings`) e non da un aggregato, perche' e' da li' che l'app li prende: la pagina
 * somma le celle che `buildLeagueMatches` costruisce su questa stessa tabella, quindi ri-derivarli qui
 * e' un secondo conto sugli stessi dati - che e' il solo confronto che valga qualcosa. Un totale
 * ricavato dalla pastiglia sarebbe l'asserzione circolare.
 *
 * I RIGORI TRASFORMATI DENTRO I GOL e gli assist da fermo dentro gli assist (operatore, 06/09/2026):
 * la convenzione si riscrive qui apposta invece di importarla, cosi' se un giorno cambiasse da una
 * parte sola il banco se ne accorge invece di seguirla.
 *
 * DUE STRATI, perche' «una stagione» comprende il campionato che ha giocato ANCHE se non e' il nostro:
 * `isChampionship` conta `league` e `other_league`, quindi Vicario in Premier nel 2025-26 ha una
 * stagione e non un vuoto. Leggere i soli voti dava «0:0 sullo schermo e niente nel bundle» su 54
 * righe - e il torto era dell'arnese, che guardava meta' della domanda. La riga del suo PROPRIO
 * campionato si salta sullo strato esterno (e' gia' nei voti), che e' la stessa riga che
 * `buildOtherMatches` scrive di se'.
 */
async function countedFromBundle(platform = 'default') {
  const manifest = JSON.parse(await readFile(join(DIST, 'data', 'manifest.json'), 'utf8'));
  const table = (name) =>
    readFile(join(DIST, 'data', `${name}.json.gz`)).then((raw) =>
      JSON.parse(gunzipSync(raw).toString('utf8')));
  const [ratings, external, rosters] =
    await Promise.all([table('match_ratings'), table('external_match_stats'), table('rosters')]);
  const want = { now: manifest.target_season, prev: manifest.input_season };
  const whenOf = (season) => (season === want.now ? 'now' : season === want.prev ? 'prev' : null);
  const out = new Map();
  const add = (fcId, when, goals, assists) => {
    const sum = out.get(fcId) ?? { now: null, prev: null };
    const one = sum[when] ?? { goals: 0, assists: 0 };
    one.goals += goals;
    one.assists += assists;
    sum[when] = one;
    out.set(fcId, sum);
  };

  const rAt = (name) => ratings.columns.indexOf(name);
  const [id, season, plat, role, goals, pens, assists, setPiece] = [
    'fc_id', 'season', 'platform', 'role', 'goals', 'pen_scored', 'assists', 'assists_set_piece',
  ].map(rAt);
  for (const row of ratings.rows) {
    if (row[plat] !== platform || row[role] === 'ALL') continue;
    const when = whenOf(row[season]);
    if (when) {
      add(Number(row[id]), when, (row[goals] ?? 0) + (row[pens] ?? 0),
        (row[assists] ?? 0) + (row[setPiece] ?? 0));
    }
  }

  // IL CAMPIONATO DI CIASCUNO nella stagione BERSAGLIO, che e' quello che decide cosa e' «un altro
  // campionato»: `rosters` per la stagione target, la stessa riga che `players-store` legge.
  const sAt = (name) => rosters.columns.indexOf(name);
  const [sId, sSeason, sLeague] = ['fc_id', 'season', 'league'].map(sAt);
  const leagueOf = new Map();
  for (const row of rosters.rows) {
    if (row[sSeason] === want.now) leagueOf.set(Number(row[sId]), row[sLeague] ?? null);
  }

  const eAt = (name) => external.columns.indexOf(name);
  const [eId, eSeason, eCompetition, eMinutes, eRating, eGoals, eAssists] =
    ['fc_id', 'season', 'competition', 'minutes', 'rating', 'goals', 'assists'].map(eAt);
  for (const row of external.rows) {
    const when = whenOf(row[eSeason]);
    if (!when) continue;
    const slug = row[eCompetition];
    if (!LEAGUES.has(slug)) continue; // una coppa e un'amichevole non sono una stagione di campionato
    const fcId = Number(row[eId]);
    if (slug === leagueOf.get(fcId)) continue; // il suo campionato: gia' contato dai voti
    // Senza minuti E senza rating la cella e' `no_data`, che `seasonTotals` non conta.
    if (row[eMinutes] == null && row[eRating] == null) continue;
    add(fcId, when, row[eGoals] ?? 0, row[eAssists] ?? 0);
  }
  return { counted: out, seasons: want };
}

async function sheetNumbers() {
  const manifest = JSON.parse(await readFile(join(DIST, 'data', 'manifest.json'), 'utf8'));
  const entry = (manifest.engine_sheets ?? []).find(
    (one) => one.platform === 'default' && one.game === 'classic',
  );
  if (!entry) throw new Error('il bundle non porta il foglio Serie A classic: il passo non ha niente da misurare');
  const raw = await readFile(join(DIST, 'data', entry.path));
  const table = JSON.parse(
    entry.path.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8'),
  );
  const at = (name) => table.columns.indexOf(name);
  const open = await openInjuries();
  const [id, fm, estFm, mv, pv, estPv, minutes, play] = [
    'fc_id', 'engine_fm_pred', 'est_fm', 'est_mv', 'engine_pv_pred', 'est_pv', 'desc_minutes_next',
    'desc_titolarita_play',
  ].map(at);
  const out = new Map();
  for (const row of table.rows) {
    out.set(Number(row[id]), {
      fm: row[fm] ?? row[estFm] ?? null,
      // La media voto ATTESA, che e' la meta' che il Bpm sottrae (`est_mv`, revisione 18+).
      mv: mv < 0 ? null : (row[mv] ?? null),
      pv: row[pv] ?? row[estPv] ?? null,
      // IL MOTORE lo prezza, oppure il foglio ripiega: dove ripiega la pagina puo' leggere la BOARD
      // (`expected-play.ts`), quindi il tetto da asserire e' un altro. Senza questa distinzione il
      // passo accusa di «aggiungere giornate» proprio i nomi per cui quel ramo esiste.
      core: row[pv] != null,
      // ...e se OGGI e' fermo: allora la pagina gli toglie anche le giornate che salta di sicuro, che
      // sono un fatto e non hanno il tetto dell'assicurazione. E' una lettura della tabella degli
      // infortuni (date, non formule), quindi non e' una seconda copia dell'aritmetica della pagina.
      hurt: open.has(Number(row[id])),
      play: play < 0 ? null : (row[play] ?? null),
      minutes: minutes < 0 ? null : (row[minutes] ?? null),
    });
  }
  out.matchdays = entry.matchdays_target ?? null;
  return out;
}

/**
 * Il testo del tooltip APERTO, e non un attributo.
 *
 * Con `[nzTooltipTitle]` il titolo e' un binding di PROPRIETA': nel DOM non c'e' niente da leggere, e
 * un arnese che cerca un attributo accusa la pastiglia di non dire quello che dice a chiunque ci passi
 * sopra (`e2e-plancia-injury.mjs`, 04/09/2026). Un tooltip si verifica aprendolo.
 */
function readTooltip() {
  const inner = document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden) .ant-tooltip-inner');
  return inner ? (inner.innerText ?? '').replace(/\s+/g, ' ').trim() : null;
}

/** Dove sta la fila delle pastiglie della prima riga: il punto su cui portare un puntatore vero. */
/**
 * IL NOME della prima riga: il centro del suo rettangolo, e chi c'e' davvero sotto quel punto.
 *
 * E' il solo bersaglio di hover rimasto su una riga (operatore, 04/09/2026), quindi e' li' che si va a
 * bussare - e si chiede al browser CHI risponde a quelle coordinate, perche' «il tooltip c'e'» e' un
 * fatto sul DOM e non sullo schermo.
 */
function namePoint() {
  const row = document.querySelector('app-strategy ol li[data-id]');
  const name = row?.querySelector('span.flex-1');
  if (!name) return null;
  const box = name.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const under = document.elementFromPoint(x, y);
  return {
    x, y,
    inside: name.contains(under) || under === name,
    text: (name.innerText ?? '').trim(),
  };
}

/**
 * QUANTI BERSAGLI DI HOVER porta una riga, e di chi sono.
 *
 * «Limita i tooltip al minimo essenziale» e' una richiesta che si misura contando: il selettore
 * `nz-tooltip` resta come attributo nel DOM, quindi quanti pannelli una riga puo' aprire si legge senza
 * passarci sopra col puntatore.
 *
 * SI CONTA QUELLO CHE QUESTA LISTA SCRIVE, e i marchi di `ui-flags` si contano a parte: sono di un
 * componente condiviso, esistono solo dove c'e' un marchio da spiegare e un'icona senza la sua frase e'
 * un'icona che nessuno sa leggere. Contarli insieme misurerebbe due decisioni diverse in un numero solo.
 */
function readRowTips() {
  const rows = [...document.querySelectorAll('app-strategy ol li[data-id]')];
  let most = 0;
  let flags = 0;
  let titles = 0;
  let crests = 0;
  for (const row of rows) {
    const all = [...row.querySelectorAll('[nz-tooltip]')];
    const inFlags = all.filter((one) => one.closest('ui-flags')).length;
    const own = all.length - inFlags + (row.hasAttribute('nz-tooltip') ? 1 : 0);
    if (own > most) most = own;
    if (inFlags > flags) flags = inFlags;
    // Il `title` della RIGA, che e' quello che questa lista scriveva; quello dello stemma e' di
    // `ui-crest` e porta il nome del club, cioe' l'unica cosa che un'immagine da 16px non dice.
    if (row.hasAttribute('title')) titles += 1;
    if (row.querySelector('ui-crest [title]')) crests += 1;
  }
  return { rows: rows.length, most, flags, titles, crests };
}

/** Il centro del nome di UNA riga scelta (per `fc_id`), per bussare dove il tooltip di quel nome sta. */
function namePointOf(id) {
  const row = document.querySelector(`app-strategy ol li[data-id="${id}"]`);
  const name = row?.querySelector('span.flex-1');
  if (!name) return null;
  const box = name.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, text: (name.innerText ?? '').trim() };
}

/**
 * APRE IL TOOLTIP DI UN PUNTO, dopo essersi assicurato che non ce ne sia gia' uno aperto.
 *
 * Trovato dal banco stesso il 04/09/2026: il passo mantra chiedeva la frase di Kalulu e leggeva quella
 * di NERES. Il passo prima chiude una finestra modale con un click a (1025,757), e quando la modale
 * sparisce il puntatore resta fermo su qualunque riga stia sotto quel punto - che apre il SUO tooltip da
 * sola. Il polling successivo trovava un pannello aperto al primo giro, prima che il nostro (0,4s di
 * ritardo) fosse nato: un tooltip letto senza essersi assicurati che il precedente sia chiuso e' il
 * tooltip di un'altra riga, e non lo dice.
 */
async function hoverTip(session, point) {
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await evaluate(session, readTooltip))) break;
    await wait(150);
  }
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(point.x), y: Math.round(point.y), button: 'none',
  });
  let tip = null;
  for (let attempt = 0; attempt < 30 && !tip; attempt += 1) {
    await wait(150);
    tip = await evaluate(session, readTooltip);
  }
  // Via dal bersaglio, o il pannello resta aperto sopra quello che il passo dopo misura.
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
  await wait(300);
  return tip;
}

function modalOpen() {
  const modal = document.querySelector('nz-modal-container');
  if (!modal) return null;
  const rect = modal.getBoundingClientRect();
  return {
    visible: rect.width > 0 && rect.height > 0,
    text: modal.innerText.replace(/\s+/g, ' ').trim().slice(0, 300),
  };
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-strategy-'));
  // UNA PORTA LIBERA PER OGNI CORSA, e non un numero fisso: la prima versione ne usava uno solo, e
  // quando il browser della corsa precedente sopravvive (Chromium fa figli, `kill()` non li prende
  // tutti) l'arnese si attacca a QUELLA pagina e misura lo stato di prima. Succede davvero: una corsa
  // ha letto dodici blocchi mantra dove la pagina appena aperta ne disegna quattro.
  const debugPort = Number(value('--port', String(await freePort())));
  const url = `http://127.0.0.1:${port}${value('--path', '/strategy')}`;
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1000',
    url,
  ], { stdio: 'ignore' });

  // LE DUE STAGIONI CHE IL PACCHETTO DICHIARA: da quando una lettura porta la sua stagione
  // (12/09/2026), la cella di una riga si chiama `chiave@stagione` e questo e' il vocabolario per
  // leggerla. Dal manifest e mai «bersaglio meno uno».
  const manifestSeasons = JSON.parse(await readFile(join(DIST, 'data', 'manifest.json'), 'utf8'));
  const TARGET_SEASON = manifestSeasons.target_season;
  const INPUT_SEASON = manifestSeasons.input_season;

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
    // LA PAGINA CHE MISURIAMO È LA NOSTRA, dichiarato invece di sperato: se ci fossimo attaccati a un
    // browser di un'altra corsa, `location.href` sarebbe un altro server.
    await session.send('Page.navigate', { url });
    await wait(500);
    // ...e si parte dai valori DICHIARATI: le lunghezze attese qui sotto sono quelle di dieci
    // partecipanti con rose 3/8/8/6, quindi un'impostazione salvata da una corsa precedente
    // misurerebbe un'altra lega sotto le stesse aspettative.
    await evaluate(session, () => {
      try {
        localStorage.removeItem('fantassistant.strategy.setup');
      } catch {
        /* un browser che rifiuta la memoria è già ai valori di partenza */
      }
      location.reload();
      return true;
    });
    await wait(800);
    const where = await evaluate(session, () => location.href);
    if (!where.startsWith(url.split('?')[0])) {
      throw new Error(`la pagina aperta è ${where} e non ${url}: mi sono attaccato al browser sbagliato`);
    }

    let blocks = [];
    for (let attempt = 0; attempt < 120; attempt += 1) {
      blocks = (await evaluate(session, readBlocks)) ?? [];
      if (blocks.some((one) => one.rows > 0)) break;
      await wait(500);
    }
    if (!blocks.some((one) => one.rows)) throw new Error('nessun nome è mai comparso: il bundle non ha caricato');

    const page = await evaluate(session, readPage);
    const rowsSeen = blocks.reduce((sum, one) => sum + one.rows, 0);

    // 1. IL LAYOUT: la pagina non scorre, le liste sì, e ogni lista sta dentro il suo blocco.
    const overflow = page.scrollHeight - page.innerHeight;
    const spilling = blocks.filter((one) => one.list && one.list.bottom > one.box.bottom + 1);
    note('il layout', {
      said: `${blocks.length} blocchi, ${rowsSeen} nomi disegnati · pagina ${page.scrollHeight}px in `
        + `${page.innerHeight}px di finestra · liste che scorrono: `
        + `${blocks.filter((one) => one.scrollHeight > one.clientHeight + 1).length}`,
      problems: [
        ...(overflow > 1 ? [`la pagina scorre di ${overflow}px: l'altezza non è quella della finestra`] : []),
        ...spilling.map((one) => `la lista di ${one.role} esce dal suo blocco di ${one.list.bottom - one.box.bottom}px`),
        ...(blocks.length === 4 ? [] : [`${blocks.length} blocchi invece dei quattro di classic`]),
      ],
    });

    if (flag('--shot')) {
      const first = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'dist', 'e2e-strategy-classic.png');
      await writeFile(where, Buffer.from(first.data, 'base64'));
      console.log(`· screenshot classic: ${where}`);
    }

    // 2. LA RIGA: stemma, nome, gain - e NESSUN badge del ruolo, che è il blocco stesso (04/09/2026).
    //    L'assenza si conta, o «non l'ho guardata» e «non c'è» si leggono uguale.
    const missing = { crest: 0, name: 0, gain: 0 };
    let badges = 0;
    const dashes = [];
    for (const block of blocks) {
      for (const part of block.parts) {
        if (!part.crest) missing.crest += 1;
        if (part.roles) badges += 1;
        if (!part.name) missing.name += 1;
        if (!part.gain) missing.gain += 1;
        if (part.gain === '—') dashes.push(`${block.role} · ${part.name}`);
      }
    }
    note('la riga', {
      said: `${rowsSeen} righe esaminate · ${badges} badge del ruolo · prima riga: `
        + `${JSON.stringify(blocks[0]?.parts[0] ?? null)}`,
      problems: [
        ...(missing.crest ? [`${missing.crest} righe senza stemma`] : []),
        ...(badges ? [`${badges} righe portano ancora il badge del ruolo`] : []),
        ...(missing.name ? [`${missing.name} righe senza nome`] : []),
        ...(missing.gain ? [`${missing.gain} righe senza gain`] : []),
        ...(dashes.length ? [`${dashes.length} righe col gain vuoto in classifica (${dashes[0]})`] : []),
      ],
    });

    // 2a. LE BANDE DELLO SLOT: il fondo cambia ogni `partecipanti` nomi, e non una riga sì e una no.
    //
    //     Due affermazioni, e sono diverse: la prima è ARITMETICA (la banda che la riga dichiara è
    //     l'indice diviso i partecipanti), la seconda è QUELLO CHE SI VEDE (dentro una banda il fondo
    //     è lo stesso, e cambia al confine). Il colore si confronta fra righe della stessa pagina e
    //     mai con un letterale - i token sono `color-mix` e il tema ha due versi - quindi quello che
    //     si asserisce è un'uguaglianza e una DIFFERENZA, che è la sola cosa verificabile.
    const bandProblems = [];
    let boundaries = 0;
    for (const block of blocks) {
      if (!block.parts.length) continue;
      const wrongIndex = block.parts.findIndex((part, at) => part.band !== Math.floor(at / TEAMS));
      if (wrongIndex >= 0) {
        bandProblems.push(
          `${block.role}: la riga ${wrongIndex + 1} dichiara la banda ${block.parts[wrongIndex].band}`
            + ` invece di ${Math.floor(wrongIndex / TEAMS)}`,
        );
      }
      for (let at = 1; at < block.parts.length; at += 1) {
        const same = block.parts[at].background === block.parts[at - 1].background;
        const border = block.parts[at].band !== block.parts[at - 1].band;
        if (border) boundaries += 1;
        if (border && same) {
          bandProblems.push(`${block.role}: il fondo non cambia fra la riga ${at} e la ${at + 1}`);
        }
        if (!border && !same) {
          bandProblems.push(`${block.role}: il fondo cambia DENTRO una banda, alla riga ${at + 1}`);
        }
      }
    }
    const bar = await evaluate(session, () => {
      const said = document.querySelector('app-strategy .bg-surface')?.innerText ?? '';
      return said.replace(/\s+/g, ' ').trim().slice(0, 80);
    });
    note('le bande dello slot', {
      said: `${TEAMS} partecipanti dichiarati · ${boundaries} confini fra bande · barra «${bar}» · `
        + `prime tinte: ${JSON.stringify(blocks[0]?.parts.slice(0, 2).map((one) => one.background) ?? [])}`,
      problems: [
        ...bandProblems.slice(0, 4),
        ...(boundaries ? [] : ['nessun confine di banda: la lista non è raggruppata affatto']),
        ...(bar.includes(`${TEAMS} partecipanti`)
          ? [] : [`la barra non dichiara ${TEAMS} partecipanti: le bande sarebbero misurate su un'altra lega`]),
      ],
    });

    // 2b. IL RIENTRO A SINISTRA: il nome parte quasi dal bordo, perché ogni pixel di margine è un pixel
    //     tolto al nome (richiesta dell'operatore, 04/09/2026). Misurato COMPUTATO, non guardato.
    const pads = [...new Set(blocks.flatMap((one) => one.parts.map((part) => part.padLeft)))];
    note('il rientro della riga', {
      said: `padding-left: ${pads.join(' · ')}px su ${rowsSeen} righe`,
      problems: [
        ...(pads.every((one) => one <= 4) ? [] : [`una riga rientra di ${Math.max(...pads)}px a sinistra`]),
      ],
    });

    // 2c. LE PASTIGLIE, contro il FOGLIO e non contro se stesse.
    //
    //     Il foglio si legge QUI, in Node, dal file che il server dell'arnese sta servendo: e' la sola
    //     fonte indipendente da quello che la pagina disegna. Confrontare la pastiglia con un numero
    //     ricavato dalla pastiglia e' l'asserzione circolare che passa qualunque cosa.
    //
    //     DAL 05/09/2026 LE LETTURE SI SCELGONO (sette pastiglie in barra, le prime tre accese), quindi
    //     ogni riquadro si legge per il suo NOME e non per la sua posizione, e il passo asserisce
    //     esattamente le tre che devono essere accese all'apertura.
    const sheet = await sheetNumbers();
    const pills = (await evaluate(session, readPills)) ?? [];
    const wrongPills = [];
    let checked = 0;
    let clipped = 0;
    let outside = 0;
    let noMinutes = 0;
    let widest = Infinity;
    const DEFAULT_ON = ['bonus', 'played', 'passed'];
    for (const row of pills) {
      const shown = Object.keys(row.say);
      if (shown.join(',') !== DEFAULT_ON.join(',')) {
        wrongPills.push(`${row.name} porta ${JSON.stringify(shown)} invece delle tre accese all'apertura`);
        continue;
      }
      outside += row.outside;
      if (row.nameClipped) clipped += 1;
      widest = Math.min(widest, row.nameWidth);
      const said = sheet.get(row.id);
      if (!said) {
        wrongPills.push(`${row.name} (${row.id}) non e' nel foglio: la pagina disegna un uomo che il file non prezza`);
        continue;
      }
      checked += 1;
      const number = (text) => (text == null || text === '—' ? null : Number(String(text).replace(',', '.').replace('′', '')));
      // 1) IL BONUS A PARTITA MEDIO: fantamedia meno media voto, tutt'e due ATTESE e tutt'e due del
      //    foglio. E' la definizione della colonna «Bonus» (FMa - MVa), non il «sopra il 6».
      const bonus = said.fm == null || said.mv == null ? null : said.fm - said.mv;
      const shownBonus = number(row.say.bonus);
      if (bonus == null ? shownBonus != null : Math.abs(shownBonus - bonus) > 0.06) {
        wrongPills.push(`${row.name}: Bpm dice ${row.say.bonus} e il foglio ${bonus?.toFixed(2)}`);
      }
      // 2) LE PRESENZE ATTESE, che dal 04/09/2026 sono ASSICURATE (`core/expected-play.ts`): il foglio
      //    resta il riferimento, ma quello che si asserisce e' la DIREZIONE e il TETTO, non l'uguaglianza
      //    - la formula toglie giornate e non ne aggiunge mai, e non ne toglie piu' del tetto dichiarato.
      //    Ricalcolare qui l'assicurazione sarebbe l'asserzione circolare: si confronterebbe la pagina
      //    con una seconda copia della sua stessa aritmetica.
      const played = number(row.say.played);
      const passed = number(row.say.passed);
      const ceiling = said.core ? said.pv : Math.max(said.pv ?? 0, (said.play ?? 0) * sheet.matchdays);
      if (said.pv == null ? played != null : played > ceiling + 0.51) {
        wrongPills.push(`${row.name}: le presenze dicono ${row.say.played} e il tetto e' ${ceiling?.toFixed(2)}: l'assicurazione non aggiunge giornate`);
      } else if (said.core && said.pv != null && played != null && !said.hurt
                 && said.pv - played > sheet.matchdays * 0.36 + 0.51) {
        wrongPills.push(`${row.name}: tolte ${(said.pv - played).toFixed(1)} giornate su ${said.pv.toFixed(1)}, oltre il tetto dichiarato`);
      }
      if (passed != null && played != null && passed > played) {
        wrongPills.push(`${row.name}: ${passed} partite buone su ${played} giocate - un sottoinsieme piu' grande dell'insieme`);
      }
      if (played != null && sheet.matchdays && played > sheet.matchdays + 0.5) {
        wrongPills.push(`${row.name}: ${played} presenze su un calendario di ${sheet.matchdays} giornate`);
      }
    }
    note('le pastiglie accese', {
      said: `${checked} righe confrontate col foglio (${sheet.size} uomini prezzati, calendario `
        + `${sheet.matchdays} giornate) · esempio ${JSON.stringify(pills[0]?.say ?? null)} per `
        + `«${pills[0]?.name}» · in riga ${pills.filter((one) => !one.stripOwnLine).length}/${pills.length}`
        + ` · nomi tagliati ${clipped}/${pills.length}, il piu' stretto ${widest}px`,
      problems: [
        ...(checked ? [] : ['nessuna riga confrontata: il passo non ha misurato niente']),
        ...(outside ? [`${outside} pastiglie fuori dalla loro riga: ci sono nel DOM e non sullo schermo`] : []),
        ...wrongPills.slice(0, 5),
        ...(wrongPills.length > 5 ? [`...e altre ${wrongPills.length - 5} righe che non tornano`] : []),
      ],
    });

    // 2c-ante. LA COLONNA DELLE PASTIGLIE E' UNA SOLA, dentro ogni lista.
    //
    // Il difetto che l'ha imposto (operatore, 09/09/2026: «il simbolo ~ rompe l'incolonnamento dei
    // valori»): il tilde della stima stava FRA la fila e il gain, e in un flex col nome `flex-1` il
    // bordo destro di un elemento vale `container.right - (somma dei successivi)` - quindi spostava la
    // fila di 10,84px (il glifo 6,84 piu' i 4 di `gap-x-1`) sulle sole 58 righe di 250 che lo portano,
    // mentre il gain, essendo l'ULTIMO, restava allineato. Si asserisce il fatto e non la cura: se
    // domani qualcuno mette un altro marchio condizionale li' in mezzo, questo passo cade.
    //
    // Il conteggio dei tilde viaggia col verdetto perche' un passo che li trova ZERO leggerebbe
    // «incolonnato» dopo aver guardato una pagina senza il caso che sta giudicando.
    const columns = new Map();
    for (const row of pills) {
      if (row.stripRight == null) continue;
      if (!columns.has(row.block)) columns.set(row.block, { edges: new Set(), tilde: 0, rows: 0 });
      const seen = columns.get(row.block);
      seen.edges.add(row.stripRight);
      seen.rows += 1;
      if (row.estimated) seen.tilde += 1;
    }
    const zigzag = [...columns.entries()]
      .filter(([, seen]) => seen.edges.size > 1)
      .map(([block, seen]) => `blocco ${block}: ${seen.edges.size} bordi destri `
        + `${JSON.stringify([...seen.edges].sort((a, b) => a - b))} su ${seen.rows} righe `
        + `(${seen.tilde} col tilde)`);
    const tildeSeen = [...columns.values()].reduce((sum, one) => sum + one.tilde, 0);
    note('le pastiglie sono incolonnate', {
      said: `${columns.size} liste, ${pills.length} righe, ${tildeSeen} col tilde della stima `
        + `· bordi destri per lista: ${[...columns.values()].map((one) => one.edges.size).join('/')}`,
      problems: [
        ...(columns.size ? [] : ['nessuna lista misurata: il passo non ha guardato niente']),
        ...(tildeSeen ? [] : [`nessuna riga stimata a schermo: la colonna e' dritta perche' il caso che la spezza non c'e'`]),
        ...zigzag,
      ],
    });

    // 2c-bis. GLI ATTESI, accesi con un CLICK VERO e confrontati col layer per-partita del bundle.
    //
    //     Due cose in un passo solo e sono la stessa: che la pastiglia si accenda (una preferenza che
    //     vive in `localStorage`, quindi il DOM e' l'unico posto da cui si sa che ha morso) e che il
    //     numero sia quello del pacchetto. Il confronto e' col FILE - un xG ricavato dalla pastiglia
    //     sarebbe l'asserzione circolare che passa qualunque cosa.
    const producedByBundle = await expectedFromBundle();
    const wrongExpected = [];
    let withExpected = 0;
    let crossChecked = null;
    // Dichiarato QUI perche' il verbale sta fuori dal blocco: un passo che non ha misurato le coppie
    // deve dirlo, non tacere - «zero problemi» e «non ho guardato» non devono leggersi uguale.
    let countedSaid = 'coppie G:A non misurate';
    // LE DUE COPPIE INSIEME ALLE QUATTRO MEDIE (06/09/2026): sono la stessa lettura in due unita', e
    // metterle nello stesso passo e' quello che permette di legarle - un conteggio e una media che si
    // contraddicono sullo stesso uomo sono la prova che la definizione e' tornata a essere due.
    //
    // CINQUE E NON SEI dal 12/09/2026: `G:A` e' UNA lettura con una stagione, e la seconda stagione si
    // chiede al suo menu' invece di essere un'altra pastiglia. Il carico massimo che questo banco prova
    // resta nove celle - le tre dell'apertura piu' sei - perche' la `G:A` ne porta due da sola.
    const SEASON_PILLS = ['goals', 'assists', 'xg', 'xa', 'ga'];
    const switched = [];
    for (const key of SEASON_PILLS) switched.push(await pressReading(session, key));
    // ...e la SECONDA stagione della coppia, dal menu' della sua pastiglia: e' l'unico modo di avere le
    // due `G:A` accanto, che e' quello che questo passo confronta col pacchetto.
    await clickSteady(session, 'app-strategy [data-seasons="ga"]', '');
    const ticked = await clickSteady(session, `[data-season="${INPUT_SEASON}"]`, '');
    if (!ticked) switched.push('la stagione scorsa della G:A non si e fatta spuntare');
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
    await wait(300);
    switched.splice(0, switched.length, ...switched.filter(Boolean));
    if (!switched.length) {
      for (const row of (await evaluate(session, readPills)) ?? []) {
        const want = producedByBundle.get(row.id);
        const number = (text) => (text == null || text === '—' ? null : Number(String(text).replace(',', '.')));
        const said = { xg: number(row.say[`xg@${TARGET_SEASON}`]), xa: number(row.say[`xa@${TARGET_SEASON}`]) };
        if (said.xg === undefined || !(`xg@${TARGET_SEASON}` in row.say)) {
          wrongExpected.push(`${row.name}: la pastiglia xG non si e' accesa`);
          continue;
        }
        // Chi non ha una riga non ha una media: un trattino, mai uno zero.
        const near = (screen, file) =>
          file == null ? screen == null : screen != null && Math.abs(screen - file) < 0.006;
        if (!near(said.xg, want?.xg ?? null) || !near(said.xa, want?.xa ?? null)) {
          wrongExpected.push(
            `${row.name}: xG/xA dicono ${row.say[`xg@${TARGET_SEASON}`]}/${row.say[`xa@${TARGET_SEASON}`]} e il bundle `
            + `${want ? `${want.xg?.toFixed(2)}/${want.xa?.toFixed(2)} su ${want.matches} partite` : 'niente'}`,
          );
        }
        if (want) withExpected += 1;
      }
      // LE DUE COPPIE CONTATE, contro i VOTI del pacchetto (non contro la pastiglia accanto).
      const { counted, seasons } = await countedFromBundle();
      const pair = (text) => {
        if (text == null || text === '—') return null;
        const parts = String(text).split(':').map(Number);
        return parts.length === 2 && parts.every(Number.isFinite)
          ? { goals: parts[0], assists: parts[1] } : undefined;
      };
      let withCounted = 0;
      for (const row of (await evaluate(session, readPills)) ?? []) {
        for (const [key, when] of [[`ga@${TARGET_SEASON}`, 'now'], [`ga@${INPUT_SEASON}`, 'prev']]) {
          if (!(key in row.say)) {
            wrongExpected.push(`${row.name}: la pastiglia ${key} non si e' accesa`);
            continue;
          }
          const said = pair(row.say[key]);
          if (said === undefined) {
            wrongExpected.push(`${row.name}: ${key} dice «${row.say[key]}», che non e' una coppia`);
            continue;
          }
          const file = counted.get(row.id)?.[when] ?? null;
          // Chi non ha una giornata su file non porta uno 0:0, e chi ne ha una lo porta anche a zero:
          // e' la differenza fra «non ha segnato» e «non ha giocato», e vale in tutt'e due i versi.
          if (file == null) {
            if (said != null) wrongExpected.push(`${row.name}: ${key} dice ${row.say[key]} e il bundle niente`);
            continue;
          }
          if (said == null || said.goals !== file.goals || said.assists !== file.assists) {
            wrongExpected.push(
              `${row.name}: ${key} (${when === 'now' ? seasons.now : seasons.prev}) dice `
              + `«${row.say[key]}» e i voti ${file.goals}:${file.assists}`,
            );
          } else {
            withCounted += 1;
          }
        }
      }
      // IL COSTO DELLE DUE PASTIGLIE IN PIU', misurato invece che sperato: con nove accese la riga e'
      // la piu' carica che la pagina possa disegnare, e «276px di colonne non erano strette, erano
      // ASSENTI» e' la famiglia di difetti che si paga proprio qui. Un fatto in verbale e non una
      // soglia: quante ne accende e' una preferenza sua, non un limite nostro.
      const loaded = (await evaluate(session, readPills)) ?? [];
      const clipped = loaded.filter((one) => one.nameClipped).length;
      const outside = loaded.reduce((sum, one) => sum + one.outside, 0);
      countedSaid = `coppie G:A ${withCounted} verificate su ${loaded.length * 2} disegnate `
        + `(${seasons.prev} e ${seasons.now}) · con nove pastiglie accese: nomi tagliati ${clipped}, `
        + `riquadri fuori riga ${outside}`;
      if (outside) wrongExpected.push(`${outside} riquadri disegnati fuori dalla propria riga`);
      // ...E LA CARD DEVE DIRE LO STESSO, che e' la proprieta' per cui la fonte e' stata cambiata:
      // pastiglia e riepilogo passano dalla STESSA funzione (`seasonTotals`), quindi due numeri diversi
      // sullo stesso uomo sullo stesso schermo sono la prova che la definizione e' tornata a essere due.
      // L'uomo si sceglie dai DATI - il primo con gol E assist, cosi' i due marchi del riepilogo sono
      // tutt'e due disegnati e il conteggio non e' ambiguo - e mai da una lista scritta a mano.
      const pilled = (await evaluate(session, readPills)) ?? [];
      const num = (text) => (text == null || text === '—' ? null : Number(String(text).replace(',', '.')));
      const witness = pilled.find((row) => num(row.say.goals) > 0 && num(row.say.assists) > 0);
      if (witness) {
        // PRIMA LO SI PORTA SOTTO GLI OCCHI: i blocchi scorrono, e il testimone e' il primo uomo con
        // gol E assist - che sta dove capita. Cliccare le coordinate di una riga fuori dalla lista
        // visibile non apre niente e fa accusare la pagina di un difetto che e' dell'arnese: e' la
        // lezione dei varchi fuori dal viewport (20/08/2026), incontrata da un altro lato.
        const where = await evaluate(session, (id) => {
          const row = document.querySelector(`app-strategy ol li[data-id="${id}"]`);
          if (!row) return null;
          // SI SCORRE LA LISTA, NON LA PAGINA: `scrollIntoView` porta con se' ogni antenato
          // scorrevole, e su questa pagina ha fatto scorrere il documento di 14.750px - la barra delle
          // pastiglie e' finita fuori schermo e quattro passi dopo hanno letto «e' coperta». La cura
          // di un difetto dell'arnese non deve produrne uno piu' grosso: qui si tocca il solo `ol`.
          const list = row.closest('ol');
          if (list) {
            const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
            list.scrollTop += top - list.clientHeight / 2;
          }
          const box = row.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        }, witness.id);
        if (where) {
          await click(session, where);
          let card = null;
          let seen = 0;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const open = (await evaluate(session, readCards)) ?? [];
            seen = open.length;
            card = open[0] ?? null;
            if (card?.summary?.played) break;
            await wait(500);
          }
          const summary = card?.summary ?? null;
          const counts = (summary?.marks ?? '').match(/\d+/g)?.map(Number) ?? [];
          if (!summary || counts.length !== 2) {
            wrongExpected.push(
              `la card di ${witness.name} non porta un riepilogo leggibile: ${JSON.stringify(summary)}`
              + ` (card aperte ${seen}, nome «${card?.name ?? '-'}», righe ${card?.lines?.length ?? 0};`
              + ` la riga dice G ${witness.say.goals} / A ${witness.say.assists})`,
            );
          } else {
            const same = (chip, mine) => Math.abs(chip - mine) < 0.006;
            if (!same(num(witness.say.goals), counts[0] / summary.played)
                || !same(num(witness.say.assists), counts[1] / summary.played)) {
              wrongExpected.push(
                `${witness.name}: la pastiglia dice G ${witness.say.goals} / A ${witness.say.assists} e `
                + `la card ${counts[0]}+${counts[1]} su ${summary.played} partite`,
              );
            }
            // SI CONFRONTANO I NUMERI e non le stringhe: e' il confronto giusto comunque, ed e' come
            // il difetto e' stato trovato - fino al 05/09/2026 la card scriveva `0,10` e la lista
            // `0.10`, due separatori nella stessa app. Ora il punto e' la regola (sotto c'e' il passo
            // che la misura a schermo), e questa resta una tolleranza dell'arnese.
            const onCard = (summary.expected.match(/\d+[.,]\d+/g) ?? []).join(' ').replace(/,/g, '.');
            const onPill = `${witness.say.xg} ${witness.say.xa}`.replace(/,/g, '.');
            if (onCard !== onPill) {
              wrongExpected.push(`${witness.name}: xG/xA «${onPill}» sulla riga e «${onCard}» sulla card`);
            }
          }
          crossChecked = witness.name;
          // La card si chiude: i passi dopo ne aprono una loro e ne contano UNA.
          const shut = await evaluate(session, () => {
            const button = document.querySelector('ui-player-card button[aria-label="chiudi"]');
            if (!button) return null;
            const box = button.getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          });
          if (shut) await click(session, shut);
        }
      }
      if (flag('--shot')) {
        const shot = await session.send('Page.captureScreenshot', { format: 'png' });
        const where = join(ROOT, 'dist', 'e2e-strategy-expected.png');
        await writeFile(where, Buffer.from(shot.data, 'base64'));
        console.log(`· screenshot con xG e xA accesi: ${where}`);
      }
      // ...e si rispengono: le pastiglie accese sono una preferenza SALVATA, e lasciarle accese
      // cambierebbe l'altezza delle righe che i passi dopo misurano.
      for (const key of SEASON_PILLS) {
        const said = await pressReading(session, key);
        if (said) switched.push(said);
      }
    }
    // ...E IL DIVISORE DEI DECIMALI E' IL PUNTO (operatore, 05/09/2026), misurato sul TESTO che la
    // riga disegna: una regola sul separatore si rompe alla prossima `.replace('.', ',')`, quindi
    // deve fallire dove si vede. `1,000` sarebbe un separatore di MIGLIAIA e non e' questa regola.
    const commaPills = ((await evaluate(session, readPills)) ?? [])
      .flatMap((row) => Object.entries(row.say).map(([key, text]) => `${key} ${text}`))
      .filter((one) => /\d,\d{1,2}(?!\d)/.test(one));
    note('i decimali col punto', {
      said: `${commaPills.length} pastiglie con la virgola decimale`,
      problems: commaPills.length
        ? [`la riga scrive ancora la virgola: ${commaPills.slice(0, 3).join(' · ')}`]
        : [],
    });

    note('gol, assist e attesi: dal bundle e uguali alla card', {
      said: `${withExpected} righe con xG/xA nel pacchetto su ${producedByBundle.size} uomini con una `
        + `riga · ${countedSaid} · card confrontata: `
        + `${crossChecked ?? 'nessuna (nessun uomo con gol E assist)'}`,
      problems: [
        ...switched,
        ...wrongExpected.slice(0, 5),
        ...(wrongExpected.length > 5 ? [`...e altre ${wrongExpected.length - 5} righe che non tornano`] : []),
      ],
    });

    // 2d. LA FRASE DELLA RIGA, aperta con un puntatore vero sul NOME - il solo bersaglio di hover
    //     rimasto (operatore, 04/09/2026: «limita i tooltip nei calciatori al minimo essenziale»).
    //     Due cose si verificano insieme e sono diverse: che il pannello si APRA, e che dica quello
    //     che e' di QUELL'UOMO (il nome intero, che la colonna taglia, e il club) invece della legenda
    //     che ora sta nell'intestazione del blocco. La lunghezza e' la misura del «minimo»: la vecchia
    //     frase delle pastiglie era un paragrafo di ~700 caratteri su ogni riga.
    const tips = await evaluate(session, readRowTips);
    const target = await evaluate(session, namePoint);
    const tip = target ? await hoverTip(session, target) : null;
    note('la frase della riga', {
      said: `${tips.rows} righe, al piu' ${tips.most} tooltip suoi e ${tips.titles} title nativi per `
        + `riga (piu' ${tips.flags} marchi di ui-flags e ${tips.crests} stemmi con il nome del club) · `
        + `«${tip ?? 'nessun tooltip aperto'}»`,
      problems: [
        ...(target?.inside ? [] : ["sotto il centro del nome non c'e' il nome: il puntatore arriva altrove"]),
        ...(tip ? [] : ["il nome non apre nessun tooltip: il nome tagliato non si puo' leggere"]),
        ...(tips.most > 1 ? [`una riga porta ${tips.most} tooltip: doveva restarne uno`] : []),
        ...(tips.titles ? [`${tips.titles} righe portano ancora un title nativo`] : []),
        ...(tip && target && tip.includes(target.text.replace(/…$/, '').trim().slice(0, 8))
          ? [] : ['la frase non porta il nome di quella riga']),
        ...(tip && tip.length <= 200 ? [] : [`la frase e' lunga ${tip?.length ?? 0} caratteri: non e' il minimo essenziale`]),
      ],
    });

    // 2b. LA CODA: l'ultimo nome dell'ultimo blocco non sta sotto il box del viaggio nel tempo.
    const tail = await evaluate(session, readTail);
    note('la coda', {
      said: tail
        ? `${tail.role} in fondo: «${tail.text}» a ${JSON.stringify(tail.row)} · box `
          + `${JSON.stringify(tail.box)}`
        : 'nessuna riga da leggere',
      problems: [
        ...(tail ? [] : ["non ho trovato la coda dell'ultimo blocco: il passo non ha misurato niente"]),
        ...(tail?.covered ? ["il box del viaggio nel tempo copre l'ultimo nome dell'ultimo blocco"] : []),
      ],
    });

    // 3. LE LUNGHEZZE: il contatore dice n/domanda, e la domanda è quella della stanza dichiarata.
    const expected = Object.fromEntries(
      Object.entries(SLOTS).map(([role, slots]) => [role, slots * TEAMS]),
    );
    const counters = blocks.map((one) => `${one.role} ${one.counter}`).join(' · ');
    const wrong = blocks.filter((one) => {
      const said = Number((one.counter.split('/')[1] ?? '').trim());
      return expected[one.role] !== undefined && said !== expected[one.role];
    });
    const mismatched = blocks.filter((one) => Number(one.counter.split('/')[0]) !== one.rows);
    note('le lunghezze', {
      said: `${counters} · attese ${JSON.stringify(expected)} (dieci partecipanti, rose 3/8/8/6)`,
      problems: [
        ...wrong.map((one) => `${one.role} chiede ${one.counter} e la stanza ne comprerà ${expected[one.role]}`),
        ...mismatched.map((one) => `${one.role} dice ${one.counter} e disegna ${one.rows} righe`),
      ],
    });

    // 4. L'ORDINE: dentro un blocco il gain non risale mai.
    const unsorted = [];
    for (const block of blocks) {
      const values = block.parts
        .map((part) => Number(part.gain.replace(',', '.')))
        .filter((one) => Number.isFinite(one));
      for (let at = 1; at < values.length; at += 1) {
        // La tolleranza e' quella dell'ARROTONDAMENTO stampato (due cifre da quando il gain e' a
        // giornata), non un margine scelto: piu' larga di cosi' nasconderebbe un'inversione vera,
        // perche' su questa scala i gain stanno fra 0 e ~1,3.
        if (values[at] > values[at - 1] + 0.011) {
          unsorted.push(`${block.role}: ${values[at - 1]} poi ${values[at]} alla riga ${at + 1}`);
          break;
        }
      }
    }
    note("l'ordine", {
      said: blocks
        .map((one) => `${one.role} da ${one.parts[0]?.gain ?? '?'} a ${one.parts.at(-1)?.gain ?? '?'}`)
        .join(' · '),
      problems: unsorted,
    });

    // 5. LA BARRA: dice il regolamento senza aprire niente, e la VALUTA sta a un hover.
    //
    //    Dal 05/09/2026 la scritta «GAIN = SURPLUS a giornata» non c'e' piu': al suo posto ci sono le
    //    sette pastiglie delle letture, e i due fatti che quella scritta portava - quale valuta ordina
    //    e quanti uomini non hanno un numero - stanno nel `?` in coda alla fila. Sono FATTI e vanno
    //    detti, quindi il passo li cerca dove sono adesso invece di lasciarli cadere: si apre il
    //    pannello con un puntatore vero, perche' `[nzTooltipTitle]` non lascia niente nel DOM.
    const helpPoint = await evaluate(session, () => {
      const mark = document.querySelector('app-strategy .cursor-help');
      if (!mark) return null;
      const box = mark.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const currency = helpPoint ? await hoverTip(session, helpPoint) : null;
    note('la barra', {
      said: `${page.summary} · il «?» dice: «${(currency ?? 'niente').slice(0, 120)}»`,
      problems: [
        ...(helpPoint ? [] : ['nessun «?» in coda alle pastiglie: i due fatti sono spariti']),
        ...(currency?.includes('SURPLUS') ? [] : ['il «?» non dice quale valuta ordina le liste']),
        ...(currency?.includes('senza numero')
          ? [] : ['il «?» non dice quanti uomini il foglio non prezza']),
        ...(page.summary.includes('partecipanti') ? [] : ['la barra non dice quanti partecipanti']),
      ],
    });

    // 5b. IL RIORDINO A MANO: si trascina una riga con un puntatore vero, si contano gli eventi che
    //     ARRIVANO, e la preferenza deve sopravvivere a un ricaricamento.
    await evaluate(session, armEvents);
    const fifth = await evaluate(session, rowGeometry, 0, 4);
    const first = await evaluate(session, rowGeometry, 0, 0);
    if (!fifth || !first) throw new Error('non trovo le righe del primo blocco: il passo non misura niente');
    // Bersaglio: sopra la mezzeria della prima riga, cioe' il varco 0.
    let flight = null;
    await dragTo(session, fifth, { x: first.x, y: first.top - 4 }, 8, async () => {
      flight = await evaluate(session, cdkPieces);
      // La schermata a metà volo è la sola che mostri l'anteprima: al rilascio non esiste più.
      if (flag('--shot')) {
        const mid = await session.send('Page.captureScreenshot', { format: 'png' });
        const where = join(ROOT, 'dist', 'e2e-strategy-drag.png');
        await writeFile(where, Buffer.from(mid.data, 'base64'));
        console.log(`· screenshot a metà volo: ${where}`);
      }
    });
    // ...e subito DOPO il rilascio, prima che qualunque altra cosa succeda.
    const settled = await evaluate(session, cdkPieces);
    const events = await evaluate(session, () => window.__strategyEvents);
    const afterDrag = await evaluate(session, rowGeometry, 0, 0);
    const blocksAfter = (await evaluate(session, readBlocks)) ?? [];
    const chip = await evaluate(session, () => {
      const bar = document.querySelector('app-strategy .bg-surface');
      return (bar?.innerText ?? '').includes('nel tuo ordine');
    });

    if (flag('--shot')) {
      const dragged = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'dist', 'e2e-strategy-order.png');
      await writeFile(where, Buffer.from(dragged.data, 'base64'));
      console.log(`· screenshot ordine tuo: ${where}`);
    }

    // ...e dopo un ricaricamento il nome deve essere ancora primo: una preferenza che non sopravvive e'
    // una preferenza che l'operatore riscrive a ogni sguardo.
    await session.send('Page.reload');
    let reloaded = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      reloaded = await evaluate(session, rowGeometry, 0, 0);
      if (reloaded) break;
      await wait(500);
    }

    // ...e la crocetta del blocco torna al gain.
    const cross = await evaluate(session, () => {
      const section = document.querySelector('app-strategy section');
      // IL BOTTONE SI CERCA PER IL SUO MARCHIO e non per posizione: dal 05/09/2026 l'intestazione ne
      // porta due (la lente della ricerca e la crocetta dell'ordine), e «il primo bottone» premerebbe
      // quello sbagliato - che e' esattamente come questo passo e' fallito la prima volta.
      const button = section?.querySelector('header button[data-clear]');
      if (!button) return null;
      const box = button.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const under = document.elementFromPoint(x, y);
      return { x, y, inside: button.contains(under) || under === button };
    });
    if (cross) await click(session, cross);
    const cleared = await evaluate(session, rowGeometry, 0, 0);

    note('il riordino a mano', {
      said: `«${fifth.name}» dal 5° posto al 1° · eventi arrivati ${JSON.stringify(events)} · `
        + `a metà volo ${JSON.stringify(flight)} · al rilascio ${JSON.stringify(settled)} · `
        + `dopo il rilascio «${afterDrag?.name}» · dopo il ricaricamento «${reloaded?.name}» · `
        + `dopo la crocetta «${cleared?.name}» · chip nella barra: ${chip}`,
      problems: [
        // Le tre cose che il difetto della tabella lasciava a schermo, misurate qui: mentre trascini
        // l'anteprima e il segnaposto DEVONO esserci, e al rilascio non deve restare niente.
        ...(flight?.previews === 1 ? [] : [`a metà volo ci sono ${flight?.previews} anteprime invece di 1`]),
        ...(flight?.placeholders === 1
          ? [] : [`a metà volo ci sono ${flight?.placeholders} segnaposti invece di 1`]),
        // I due valori che l'operatore ha chiesto, misurati e non guardati.
        ...(flight?.preview?.opacity === '0.3'
          ? [] : [`l'anteprima ha opacità ${flight?.preview?.opacity} invece di 0.3`]),
        ...(flight?.placeholder?.background && !/rgba\(0, 0, 0, 0\)|transparent/.test(flight.placeholder.background)
          ? [] : [`il segnaposto non ha un fondo: ${flight?.placeholder?.background}`]),
        ...(settled?.previews === 0 && settled?.placeholders === 0 && settled?.dragging === 0
          ? [] : [`al rilascio resta qualcosa di CDK: ${JSON.stringify(settled)}`]),
        ...(settled?.moved === 0
          ? [] : [`al rilascio ${settled?.moved} righe restano traslate (es. ${settled?.example})`]),
        ...(events?.down === 1 ? [] : [`pointerdown arrivati ${events?.down} invece di 1`]),
        ...(events?.move >= 6
          ? [] : [`pointermove arrivati ${events?.move} su 9: il browser si e' preso il puntatore`]),
        ...(afterDrag?.id === fifth.id
          ? [] : [`in cima c'e' «${afterDrag?.name}» e non il nome trascinato`]),
        ...(chip ? [] : ['la barra non dice che un blocco e\' nel suo ordine']),
        ...(cross?.inside ? [] : ['la crocetta del blocco non e\' raggiungibile con un puntatore vero']),
        ...(reloaded?.id === fifth.id
          ? [] : [`dopo il ricaricamento in cima c'e' «${reloaded?.name}»: la preferenza non e' stata salvata`]),
        ...(cleared?.id === first.id
          ? [] : [`la crocetta non ha rimesso il gain: in cima c'e' «${cleared?.name}»`]),
      ],
    });

    // 6. IL BOTTONE DELLA PAGINA, con un puntatore vero alle coordinate che il browser dichiara.
    //
    //    Dal 27/08/2026 il regolamento della lega non e' piu' di questa pagina: sta nelle OPZIONI
    //    GLOBALI (`core/global-options.ts`), e questo bottone deve aprire quel pannello. Il passo
    //    misura esattamente quello, e quando fallisce dice dove guardare: se il click ARRIVA e nessun
    //    overlay nasce, il segnale che il bottone scrive non e' quello che il pannello legge.
    const button = await evaluate(session, boxOf, 'button', 'Impostazioni lega');
    if (!button) throw new Error('il bottone delle impostazioni non è a schermo');
    // Si CONTA il click che arriva, non quello spedito: se la finestra non si apre, questo dice se il
    // click e' stato mangiato (un overlay) o se e' arrivato e non ha fatto niente (la pagina).
    await evaluate(session, () => {
      window.__clicks = { onWindow: 0, onButton: 0, overlay: [] };
      window.addEventListener('click', () => (window.__clicks.onWindow += 1), true);
      const found = [...document.querySelectorAll('button')].find((one) =>
        (one.innerText ?? '').toLowerCase().includes('impostazioni lega'),
      );
      found?.addEventListener('click', () => (window.__clicks.onButton += 1));
      return true;
    });
    await click(session, button);
    const clicks = await evaluate(session, () => ({
      ...window.__clicks,
      overlay: [...document.querySelectorAll('.cdk-overlay-container > *')].map(
        (one) => `${one.tagName.toLowerCase()}.${String(one.className).split(' ')[0]}`,
      ),
      // C'E' UN OSPITE DEL MODALE NEL DOM? E' la domanda che ha risolto un'indagine intera: il click
      // arrivava (`onButton` 1), nessun overlay lo mangiava, e la finestra non c'era perche' non era
      // nel template. Un passo che dice solo «non si e' aperta» manda a cercare nel posto sbagliato.
      hasModalHost: !!document.querySelector('nz-modal'),
      containers: document.querySelectorAll('.cdk-overlay-container').length,
    }));
    const modal = await waitForModal(session);
    // ...e il passo si RICHIUDE la porta dietro: lasciare il pannello aperto fa fallire il passo dopo
    // sulla propria maschera, cioe' un passo che rompe un altro passo. Il referto dice se ce l'ha fatta.
    // Si conta anche QUESTO click: «non si chiude» ha due cause possibili - il click non arriva, o arriva
    // e non fa niente - e senza il conteggio si sceglie a caso quale inseguire.
    await evaluate(session, () => {
      window.__cancel = 0;
      const found = [...document.querySelectorAll('.ant-modal-footer button')].find((one) =>
        (one.innerText ?? '').toLowerCase().includes('annulla'),
      );
      found?.addEventListener('click', () => (window.__cancel += 1));
      return !!found;
    });
    const shut = await clickSteady(session, '.ant-modal-footer button', 'Annulla');
    const cancelClicks = await evaluate(session, () => window.__cancel);
    const closed = await waitForClosed(session);
    // Se non si richiude, il referto dice COM'E' rimasta: quante finestre ci sono, che rettangolo hanno e
    // che classi porta la maschera. «Non si chiude» senza questo manda a indovinare il meccanismo.
    const leftover = closed ? null : await evaluate(session, () => {
      const all = [...document.querySelectorAll('nz-modal-container')];
      return all.map((one) => {
        const box = one.getBoundingClientRect();
        const style = getComputedStyle(one);
        return {
          w: Math.round(box.width), h: Math.round(box.height),
          display: style.display, visibility: style.visibility, opacity: style.opacity,
          classes: String(one.className).slice(0, 80),
        };
      });
    });
    note('le impostazioni si aprono', {
      said: `bottone a (${Math.round(button.x)},${Math.round(button.y)}), sotto il punto c'è `
        + `${button.under} · finestra: ${modal?.visible ? 'aperta' : 'chiusa'} · `
        + `click arrivati ${JSON.stringify(clicks)} · «Annulla» ${JSON.stringify(shut)} · `
        + `richiusa: ${closed} (click su Annulla arrivati: ${cancelClicks})`
        + `${leftover ? ' · rimasta ' + JSON.stringify(leftover) : ''}`,
      problems: [
        ...(button.inside ? [] : [`sotto il punto del bottone c'è ${button.under}: un dito non lo raggiunge`]),
        ...(modal?.visible
          ? []
          : [
              'il bottone «Impostazioni lega» non apre niente: il click arriva'
                + ` (${clicks?.onButton} sul bottone) e nessun overlay nasce (${clicks?.containers} contenitori).`
                + ' Il bottone chiama `GlobalOptions.open()`, che alza `panelOpen`, e quel segnale non lo'
                + ' legge nessuno: il pannello globale apre col suo `editing`. Due segnali per una porta.',
            ]),
        ...(modal?.visible && !modal.text?.includes('Partecipanti')
          ? ['la finestra si apre ma non porta il campo dei partecipanti'] : []),
        ...(modal?.visible && !closed
          ? [`«Annulla» non richiude la finestra (click arrivati: ${cancelClicks}): la sua maschera copre`
             + ' i controlli dei passi dopo'] : []),
      ],
    });

    const setTo = async (...labels) => {
      // Il pannello globale si apre dal suo bottone, in basso a sinistra: quello della pagina oggi non
      // apre niente (vedi il passo 6), e un arnese che passasse da lui misurerebbe due difetti insieme.
      await waitForClosed(session);
      const open = await evaluate(session, boxOf, 'button', 'Opzioni');
      if (open) await click(session, open);
      if (!(await waitForModal(session))?.visible) {
        // Il passo dice DOVE guardare: il bottone c'era, e sotto il suo punto chi c'era?
        return `il pannello globale non si e' aperto · bottone ${JSON.stringify(open)}`;
      }
      for (const label of labels) {
        const radio = await clickSteady(session, 'label.ant-radio-button-wrapper', label);
        if (!radio) return `non trovo l'opzione «${label}» nella finestra`;
      }
      const ok = await clickSteady(session, '.ant-modal-footer button', 'Applica');
      if (!ok) return 'non trovo il bottone «Applica»';
      await wait(1200);
      return null;
    };

    // ...e si ASPETTA che sia via: una maschera che sta sfumando intercetta il click del passo dopo, e
    // il difetto si legge come «il pannello non si apre» a proposito di niente.
    await waitForClosed(session);

    // 7. MANTRA: si cambia gioco e la pagina cambia vocabolario, non solo etichetta.
    const toMantra = await setTo('Mantra');
    let after = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      after = (await evaluate(session, readBlocks)) ?? [];
      if (after.length > 4 && after.some((one) => one.rows)) break;
      await wait(500);
    }
    const afterPage = await evaluate(session, readPage);
    // I badge del ruolo sono disegnati in maiuscolo dalla CSS, quindi il confronto è sul CODICE e non
    // su come lo si legge: un arnese che confronta la resa invece del dato inventa un difetto.
    const roles = after.map((one) => one.role.toLowerCase()).join(',');
    // CHI HA PIU' DI UN CODICE si sa senza leggere il tooltip: un uomo compare in un blocco per ogni
    // codice che porta, quindi due blocchi sono due codici. E' il riferimento indipendente che serve per
    // giudicare la frase della riga, invece di confrontarla con se stessa.
    //
    // E LA FRASE SI VERIFICA APRENDOLA (lezione delle buste chiuse, 25/08/2026): da quando il badge non
    // c'e' piu', i codici viaggiano in un `[nzTooltipTitle]`, che e' un binding di PROPRIETA' - nel DOM
    // non c'e' nessun attributo da leggere, quindi un passo che cercasse una stringa nell'HTML direbbe
    // «non ci sono» di una frase che c'e'.
    const seen = new Map();
    for (const block of after) {
      for (const part of block.parts) seen.set(part.name, (seen.get(part.name) ?? 0) + 1);
    }
    const manyCoded = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    const rowsOf = (await evaluate(session, readPills)) ?? [];
    const probe = rowsOf.find((one) => manyCoded.includes(one.name));
    const codedRow = probe ? await evaluate(session, namePointOf, probe.id) : null;
    const codesTip = codedRow ? await hoverTip(session, codedRow) : null;
    note('mantra', {
      said: `${after.length} blocchi (${roles}) · ${after.reduce((sum, one) => sum + one.rows, 0)} nomi · `
        + `contatori ${after.map((one) => one.counter).join('/')} · ${manyCoded.length} uomini in piu' `
        + `blocchi · la frase di «${probe?.name ?? '?'}»: «${codesTip ?? 'nessun tooltip'}»`,
      problems: [
        ...(toMantra ? [toMantra] : []),
        ...(after.length === 12 ? [] : [`${after.length} blocchi invece dei dodici ruoli mantra`]),
        ...(roles.includes('por') && roles.includes('dc') && roles.includes('pc')
          ? [] : [`il vocabolario mantra non è quello del regolamento: ${roles}`]),
        ...(afterPage.scrollHeight - afterPage.innerHeight > 1
          ? [`con dodici blocchi la pagina scorre di ${afterPage.scrollHeight - afterPage.innerHeight}px`] : []),
        // I CODICI non si disegnano più (il blocco è il ruolo), e su mantra la metà che diceva qualcosa
        // in più - in quali ALTRI blocchi l'uomo compare - è finita nel tooltip della riga: si verifica
        // che sia LÌ, o sarebbe stata buttata invece che spostata.
        ...(after.some((one) => one.parts.some((part) => part.roles))
          ? ['qualche riga mantra porta ancora il badge dei codici'] : []),
        ...(probe ? [] : ["nessun uomo in due blocchi: il tooltip dei codici non e' stato misurato"]),
        ...(probe && !codesTip ? ['il nome di un polivalente non apre nessun tooltip'] : []),
        ...(codesTip && !codesTip.startsWith(`${probe?.name} `)
          ? [`ho chiesto la frase di ${probe?.name} e ho letto «${codesTip}»: e' di un altra riga`] : []),
        ...(codesTip && codesTip.startsWith(`${probe?.name} `) && !CODES.test(codesTip)
          ? [`la frase di ${probe?.name} non porta i suoi codici: «${codesTip}»`] : []),
      ],
    });

    // 7a. LA RIGA STRETTA: dodici blocchi in una finestra fanno liste da ~254px, e le tre pastiglie
    //     inline lì non ci stanno - il nome sparisce e il gain esce dal blocco. Misurato invece che
    //     creduto: un passo che guarda solo la vista larga direbbe «nessun problema» dopo aver
    //     guardato l'altra metà della pagina.
    const narrow = (await evaluate(session, readPills)) ?? [];
    const wrapped = narrow.filter((one) => one.stripOwnLine).length;
    // Un nome schiacciato conta come difetto SOLO dove le pastiglie sono ancora sulla sua riga: dove
    // sono andate a capo, quello che stringe il nome sono i codici, i marchi e il gain, cioe' la lista
    // stretta di prima. Attribuire a loro anche quelli sarebbe accusarle di un difetto altrui.
    const namesGone = narrow.filter((one) => !one.stripOwnLine && one.nameWidth < 40).length;
    const clippedInline = narrow.filter((one) => !one.stripOwnLine && one.nameClipped).length;
    const stripsOut = narrow.reduce((sum, one) => sum + one.outside, 0);
    const withoutPills = narrow.filter((one) => Object.keys(one.say).length !== 3).length;
    note('la riga stretta (mantra)', {
      said: `${narrow.length} righe · ${wrapped} con le pastiglie a capo · riga alta `
        + `${narrow[0]?.height}px · nome piu' stretto ${Math.min(...narrow.map((one) => one.nameWidth))}px`
        + ` · tagliati ${narrow.filter((one) => one.nameClipped).length} (di cui ${clippedInline} con le `
        + `pastiglie ancora in riga) · esempio «${narrow[0]?.name}» ${JSON.stringify(narrow[0]?.say ?? null)}`,
      problems: [
        ...(narrow.length ? [] : ['nessuna riga letta: il passo non ha misurato niente']),
        ...(wrapped === narrow.length
          ? [] : [`${narrow.length - wrapped} righe tengono le pastiglie in riga su un blocco stretto`]),
        ...(namesGone ? [`${namesGone} righe col nome ridotto a meno di 40px: le pastiglie se lo mangiano`] : []),
        ...(stripsOut ? [`${stripsOut} pastiglie fuori dalla loro riga`] : []),
        ...(withoutPills ? [`${withoutPills} righe senza le tre pastiglie`] : []),
      ],
    });

    // 7b. IL POSTO PIÙ ARRETRATO: nella lettura di default il gain ordina e chi ha un posto più
    //     arretrato porta il marchio - quindi i polivalenti forti restano in lista, marcati.
    const marks = [];
    const climbs = [];
    for (const block of after) {
      const behind = block.parts.filter((part) => part.behind).length;
      marks.push({ role: block.role.toLowerCase(), behind, of: block.parts.length, dividers: block.dividers });
      const values = block.parts
        .map((part) => Number(part.gain.replace(',', '.')))
        .filter((one) => Number.isFinite(one));
      for (let at = 1; at < values.length; at += 1) {
        // La tolleranza e' quella dell'ARROTONDAMENTO stampato (due cifre da quando il gain e' a
        // giornata), non un margine scelto: piu' larga di cosi' nasconderebbe un'inversione vera,
        // perche' su questa scala i gain stanno fra 0 e ~1,3.
        if (values[at] > values[at - 1] + 0.011) {
          climbs.push(`${block.role}: ${values[at - 1]} poi ${values[at]}`);
          break;
        }
      }
    }
    const braccetti = marks.find((one) => one.role === 'b');
    const trequartisti = marks.find((one) => one.role === 't');
    note('il posto più arretrato', {
      said: marks.map((one) => `${one.role} ${one.behind}/${one.of}`).join(' · '),
      problems: [
        ...climbs.map((one) => `il gain non ordina la lista · ${one}`),
        ...(marks.some((one) => one.behind) ? [] : ['nessuna riga è marcata: la regola non sta agendo']),
        ...(braccetti && braccetti.behind === braccetti.of
          ? [] : ['i braccetti non sono tutti marcati: sul listone vero ognuno è anche un difensore']),
        ...(trequartisti?.behind ? [] : ['fra i trequartisti nessun C/T è marcato']),
        ...marks
          .filter((one) => one.dividers)
          .map((one) => `${one.role} porta ${one.dividers} righe che non sono nomi`),
      ],
    });

    if (flag('--shot')) {
      const middle = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'dist', 'e2e-strategy-mantra.png');
      await writeFile(where, Buffer.from(middle.data, 'base64'));
      console.log(`· screenshot mantra: ${where}`);
    }

    // ...e «Solo di mestiere» FILTRA: tiene chi non può giocare più arretrato, col prezzo che si vede.
    const nativesBox = await evaluate(session, boxOf, 'label.ant-radio-button-wrapper', 'Solo di mestiere');
    if (nativesBox) await click(session, nativesBox);
    await wait(700);
    const natives = (await evaluate(session, readBlocks)) ?? [];
    const stillMarked = natives.filter((one) => one.parts.some((part) => part.behind));
    const nativeB = natives.find((one) => one.role.toLowerCase() === 'b');
    const emptyText = await evaluate(session, () => {
      const sections = [...document.querySelectorAll('app-strategy section')];
      const found = sections.find((one) => !one.querySelector('ol'));
      return found ? (found.querySelector('p')?.innerText ?? '').replace(/\s+/g, ' ').trim() : null;
    });
    note('solo di mestiere', {
      said: `${natives.length} blocchi · nomi ${natives.reduce((sum, one) => sum + one.rows, 0)} · `
        + `braccetti ${nativeB?.rows ?? '?'} · il blocco vuoto dice: «${emptyText ?? 'niente'}»`,
      problems: [
        ...(nativesBox ? [] : ["non trovo l'opzione «Solo di mestiere» nella barra"]),
        ...stillMarked.map((one) => `${one.role} tiene ancora righe marcate in questa lettura`),
        ...(nativeB?.rows === 0 ? [] : [`i braccetti di mestiere sono ${nativeB?.rows}: sul listone sono zero`]),
        ...(emptyText?.includes('di mestiere')
          ? [] : ['un blocco vuoto non spiega perché lo è']),
      ],
    });

    if (flag('--shot')) {
      const other = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'dist', 'e2e-strategy-mantra-natives.png');
      await writeFile(where, Buffer.from(other.data, 'base64'));
      console.log(`· screenshot mantra (solo di mestiere): ${where}`);
    }
    // Rimesso come la pagina apre, così i passi che seguono misurano il default e non una scelta
    // dell'arnese: un'impostazione che sopravvive a un passo è un passo che ne cambia un altro.
    const backBox = await evaluate(session, boxOf, 'label.ant-radio-button-wrapper', 'Tutti');
    if (backBox) await click(session, backBox);

    // 7c. LE PASTIGLIE DELLA BARRA: sette, tre accese, e un click deve cambiare la RIGA.
    //
    //     Quello che si asserisce non e' che il bottone cambi colore - quello e' un fatto su antd - ma
    //     che la riga segua: una pastiglia che si accende senza cambiare niente sotto e' un bottone che
    //     mente. E si preme con un PUNTATORE VERO alle coordinate che il browser dichiara, perche'
    //     `element.click()` passa sopra la CSS e proverebbe un bersaglio che nessun dito raggiunge.
    const toggles = (await evaluate(session, readToggles)) ?? [];
    const beforeToggle = (await evaluate(session, readPills)) ?? [];
    const pressed = [];
    for (const key of ['fvm']) pressed.push(await pressReading(session, key));
    const withFvm = (await evaluate(session, readPills)) ?? [];
    for (const key of ['bonus']) pressed.push(await pressReading(session, key));
    const withoutBpm = (await evaluate(session, readPills)) ?? [];
    // ...e si rimette come si e' trovata, o i passi che seguono misurerebbero una scelta dell'arnese.
    for (const key of ['fvm', 'bonus']) pressed.push(await pressReading(session, key));
    const restoredPills = (await evaluate(session, readPills)) ?? [];
    // IL PREZZO PAGATO DAVVERO, confrontato col PACCHETTO e non con se stesso: la pastiglia legge
    // `auction_prices` e lo scala sulla lega dichiarata (10 squadre x 1000 crediti sul banco, cioe'
    // la scala di archivio, quindi il numero deve tornare identico). Ricavarlo dallo schermo sarebbe
    // l'asserzione circolare che questo progetto ha gia' pagato due volte.
    // SI TORNA SU CLASSIC PER QUESTO PASSO, e si rimette com'era dopo: le aste vere che il pacchetto
    // porta sono classic, quindi su mantra la pastiglia e' vuota per costruzione e il passo non
    // misurerebbe niente. Verificare una colonna sulla popolazione in cui non puo' esistere e' il
    // modo piu' rapido di dichiarare «nessun problema» dopo aver guardato niente.
    const backToClassic = await setTo('Classic');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (((await evaluate(session, readBlocks)) ?? []).some((one) => one.rows)) break;
      await wait(300);
    }
    for (const key of ['paid']) pressed.push(await pressReading(session, key));
    const withPaid = (await evaluate(session, readPills)) ?? [];
    const paidProblems = backToClassic ? [`non sono tornato su Classic: ${backToClassic}`] : [];
    try {
      const raw = await readFile(join(DIST, 'data', 'auction_prices.json.gz'));
      const table = JSON.parse(gunzipSync(raw).toString('utf8'));
      const at = (name) => table.columns.indexOf(name);
      const [idAt, platAt, gameAt, monthAt, medAt] =
        ['fc_id', 'platform', 'game', 'month', 'price_med'].map(at);
      const months = new Map();
      for (const row of table.rows) {
        const book = `${row[platAt]}|${row[gameAt]}`;
        if (!months.has(book) || row[monthAt] > months.get(book)) months.set(book, row[monthAt]);
      }
      // IL LIBRO SU CUI LA PAGINA STA, letto da lei e non assunto: i passi che precedono cambiano
      // listone e gioco, e restano cambiati. La prima versione di questo passo confrontava sempre con
      // `default|classic` mentre la pagina era su MANTRA, e accusava l'app di mostrare una pastiglia
      // vuota che era GIUSTA - di aste mantra non ne abbiamo nessuna. E' «un passo che misura la
      // popolazione sbagliata accusa il codice del proprio difetto», ennesima istanza, e mi e' costato
      // tre ricostruzioni prima di sospettare l'arnese invece del codice.
      const league = await evaluate(session, () => {
        try {
          const stored = JSON.parse(localStorage.getItem('fantassistant.options.league') ?? '{}');
          return {
            platform: stored.platform === 'euro' ? 'euro' : 'default',
            game: stored.game === 'mantra' ? 'mantra' : 'classic',
            teams: Number(stored.teams) || 10,
            budget: Number(stored.budget) || 1000,
          };
        } catch {
          return { platform: 'default', game: 'classic', teams: 10, budget: 1000 };
        }
      });
      const book = `${league.platform}|${league.game}`;
      // ...e il prezzo si converte nella valuta della SUA lega, che e' esattamente quello che l'app
      // fa: la tabella e' archiviata su 10 squadre x 1000 crediti.
      const scale = (league.teams * league.budget) / (10 * 1000);
      const priced = new Map();
      for (const row of table.rows) {
        if (`${row[platAt]}|${row[gameAt]}` === book && row[monthAt] === months.get(book)) {
          priced.set(String(row[idAt]), row[medAt] * scale);
        }
      }
      const shown = withPaid.filter((one) => one.say?.paid != null && one.say.paid !== '—');
      // NESSUN PREZZO NEL LIBRO E' UNA RISPOSTA, non un guasto: su mantra la pastiglia DEVE essere
      // vuota su ogni riga, ed e' quello che si asserisce - «vuoto = ignoto» visto dal banco.
      if (!priced.size) {
        if (shown.length) {
          paidProblems.push(`${shown.length} righe mostrano un prezzo su ${book}, che il bundle non prezza`);
        }
      } else if (!shown.length) {
        paidProblems.push(`nessuna riga mostra un prezzo, e il bundle ne prezza ${priced.size} su ${book}`);
      }
      for (const row of shown.slice(0, 12)) {
        const want = priced.get(String(row.id));
        const got = Number(String(row.say.paid).replace(/[^\d.-]/g, ''));
        if (want == null) {
          paidProblems.push(`«${row.name}» mostra ${row.say.paid} e il pacchetto non lo prezza`);
        } else if (Math.abs(got - want) > 1) {
          paidProblems.push(`«${row.name}» mostra ${got} e il pacchetto dice ${want.toFixed(0)}`);
        }
      }
      note('il prezzo pagato davvero viene dal pacchetto', {
        said: `libro ${book} (${league.teams} squadre x ${league.budget}) · ${priced.size} uomini`
          + ` prezzati nel bundle · ${shown.length} righe con un prezzo`
          + ` · esempio «${shown[0]?.name ?? '—'}» ${shown[0]?.say?.paid ?? '—'}`,
        problems: paidProblems,
      });
    } catch (error) {
      note('il prezzo pagato davvero viene dal pacchetto', {
        said: 'non letto',
        problems: [`non ho potuto leggere auction_prices: ${error.message}`],
      });
    }
    for (const key of ['paid']) pressed.push(await pressReading(session, key));
    // ...e la pagina si rimette su Mantra, che e' come i passi seguenti l'hanno trovata.
    await setTo('Mantra');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (((await evaluate(session, readBlocks)) ?? []).length > 4) break;
      await wait(300);
    }

    const keysOf = (rows) => Object.keys(rows[0]?.say ?? {});
    note('le diciannove letture della barra', {
      said: `${toggles.length} pastiglie (${toggles.map((one) => one.text).join(' ')}) · accese `
        + `${toggles.filter((one) => one.on).length} · la riga passa da ${JSON.stringify(keysOf(beforeToggle))} `
        + `a ${JSON.stringify(keysOf(withFvm))} e poi a ${JSON.stringify(keysOf(withoutBpm))} `
        + `· esempio FVM «${withFvm[0]?.say?.fvm}»`,
      problems: [
        ...pressed.filter(Boolean),
        // VENTI dal 12/09/2026 (le quattro frequenze: oltre l'85', fantavoto 6.5+, con bonus, sotto il
        // 6), sedici dal 07/09 (la titolarita'), quattordici dal 06/09 (le due coppie `G:A`), dodici lo
        // stesso giorno (lo SWING), undici dal 05/09 (gol, assist, xG e xA accanto a MV e FM). Il
        // numero e' scritto qui perche' e' il VOCABOLARIO della pagina e non una misura: se cresce,
        // cresce per una richiesta, e allora si aggiorna insieme a `READINGS` invece di leggere dallo
        // schermo quello che lo schermo dice.
        ...(toggles.length === 19 ? [] : [`${toggles.length} pastiglie invece delle diciannove dichiarate`]),
        // UNA PASTIGLIA PER LETTURA, e quelle stagionali NOMINANO la stagione su cui sono accese
        // (12/09/2026): `G:A` era dichiarata due volte con l'anno dentro la chiave, e da quando la
        // stagione si sceglie e' una sola - due bottoni con lo stesso testo erano il difetto che
        // `dated` curava, e adesso il testo lo compone il riferimento.
        ...((() => {
          const dated = toggles.filter((one) => /^G:A/.test(one.text));
          if (dated.length !== 1) return [`${dated.length} pastiglie G:A invece di una`];
          const said = dated[0].text;
          // Accesa su una stagione la nomina; spenta resta la sigla nuda.
          return dated[0].on && !/^G:A (\d\d\/\d\d|×\d)$/.test(said)
            ? [`la G:A accesa non nomina la sua stagione: «${said}»`] : [];
        })()),
        ...(toggles.filter((one) => one.on).length === 3
          ? [] : [`${toggles.filter((one) => one.on).length} accese all'apertura invece di tre`]),
        ...(toggles.every((one) => one.under === 'button' || one.under === 'span')
          ? [] : ['qualche pastiglia non risponde alle proprie coordinate: nel DOM e non sullo schermo']),
        ...(keysOf(withFvm).includes('fvm')
          ? [] : ['accendere FVM non ha aggiunto niente alla riga: il bottone si accende e non fa niente']),
        ...(keysOf(withoutBpm).includes('bonus')
          ? ['spegnere Bpm ha lasciato il numero sulla riga'] : []),
        ...(keysOf(restoredPills).join(',') === keysOf(beforeToggle).join(',')
          ? [] : ['la riga non e tornata come si e trovata: i passi seguenti misurerebbero altro']),
      ],
    });

    // 7c-bis. IL SELETTORE ORDINA DAVVERO (operatore, 06/09/2026).
    //
    //     Si misura sullo SCHERMO e in due direzioni, perche' un selettore che si muove e non ordina
    //     e' indistinguibile da uno che ordina: (a) la lista CAMBIA quando la chiave cambia, (b) i
    //     numeri della chiave scelta SCENDONO. Il secondo e' l'invariante vero - il primo da solo
    //     passerebbe anche su un riordino a caso.
    //
    //     La pastiglia dello SWING si accende PRIMA, o la sua colonna non e' sullo schermo e il passo
    //     misurerebbe la propria cecita' invece dell'ordine.
    const sortBefore = ((await evaluate(session, readPills)) ?? []).map((one) => one.name);
    const sortLit = await pressReading(session, 'swing');
    const sortPick = await pickSort(session, 'SWING');
    const sortedRows = (await evaluate(session, readPills)) ?? [];
    const sortedNames = sortedRows.map((one) => one.name);
    const swingValues = sortedRows
      .map((one) => Number((one.say?.swing ?? '').replace(/[^0-9.-]/g, '')))
      .filter((one) => Number.isFinite(one));
    const sortDrops = [];
    for (let at = 1; at < swingValues.length; at += 1) {
      // Le righe di `readPills` sono TUTTI i blocchi in fila, quindi la discesa si spezza legittimamente
      // fra un blocco e l'altro: si conta solo dove il valore RISALE dentro la stessa lista contigua,
      // che e' esattamente cio' che un blocco e'. Un salto in su di piu' di un blocco intero non
      // esiste, quindi si segna e si guarda.
      if (swingValues[at] > swingValues[at - 1] + 0.05) sortDrops.push(at);
    }
    // ...e si rimette com'era, o i passi dopo misurerebbero una scelta dell'arnese.
    const sortBack = await pickSort(session, sortPick.was);
    if (!sortLit) await pressReading(session, 'swing');
    const sortRestored = ((await evaluate(session, readPills)) ?? []).map((one) => one.name);
    note('il selettore ordina le liste, e la colonna scelta scende', {
      said:
        `${swingValues.length} righe con uno SWING · risalite ${sortDrops.length}` +
        ` (una per blocco e' attesa: i blocchi sono in fila)` +
        ` · la lista cambia in ${sortedNames.filter((one, at) => one !== sortBefore[at]).length} posizioni su ${sortBefore.length}`,
      problems: [
        ...(sortLit ? [sortLit] : []),
        ...(sortPick.problem ? [sortPick.problem] : []),
        ...(sortBack.problem ? [sortBack.problem] : []),
        ...(swingValues.length > 20
          ? []
          : [`solo ${swingValues.length} righe portano uno SWING: il passo non proverebbe niente`]),
        // Dodici blocchi al massimo, quindi al piu' undici salti legittimi fra un blocco e l'altro.
        ...(sortDrops.length <= 11
          ? []
          : [`lo SWING risale ${sortDrops.length} volte: la lista non e' ordinata su di lei`]),
        // L'ASSERZIONE E' STATA ROVESCIATA DUE VOLTE IN UN GIORNO, e la storia sta qui perche' e'
        // esattamente quello che un banco deve registrare (06/09/2026).
        //
        // Al mattino SWING portava copertura e convessita' e l'ordine doveva CAMBIARE. Un giudice
        // fuori campione ha tolto tutt'e due, SWING e' diventato il surplus riscalato e l'asserzione
        // e' passata a «non deve muovere una riga». Poi l'operatore ha proposto il termine di
        // COSTANZA (`STEADY_SHARE`), che e' stato adottato su evidenza dichiaratamente debole: adesso
        // SWING e' di nuovo un ordine DIVERSO dal surplus, e la lista deve muoversi.
        //
        // Il giorno che qualcuno togliesse quel termine, questo passo cadrebbe per primo - che e' il
        // suo mestiere, perche' una colonna che smette di ordinare e continua a essere offerta come
        // criterio e' una scelta che non sceglie.
        ...(sortedNames.join(',') === sortBefore.join(',')
          ? ['ordinare per SWING non ha mosso una riga: il termine di costanza non arriva alla lista']
          : []),
        ...(sortRestored.join(',') === sortBefore.join(',')
          ? []
          : ["la lista non e' tornata sull'ordine di prima: i passi seguenti misurerebbero altro"]),
      ],
    });

    // 7c-ter. ...E CHE IL SELETTORE ORDINI DAVVERO SI PROVA CON UNA CHIAVE CHE NON E' IL GAIN.
    //
    //     Il passo qui sopra non puo' farlo piu': SWING e il gain sono la stessa graduatoria. Il
    //     fantavalore no - e' il prezzo del listone, cioe' l'opinione di qualcun altro - quindi se
    //     sceglierlo non muove niente il selettore e' rotto.
    const fvmBefore = ((await evaluate(session, readPills)) ?? []).map((one) => one.name);
    const fvmPick = await pickSort(session, 'Fantavalore di mercato');
    const fvmAfter = ((await evaluate(session, readPills)) ?? []).map((one) => one.name);
    const fvmBack = await pickSort(session, fvmPick.was);
    note('il selettore ordina anche su una chiave che col gain non centra', {
      said: `il fantavalore muove ${fvmAfter.filter((one, at) => one !== fvmBefore[at]).length} posizioni su ${fvmBefore.length}`,
      problems: [
        ...(fvmPick.problem ? [fvmPick.problem] : []),
        ...(fvmBack.problem ? [fvmBack.problem] : []),
        ...(fvmAfter.join(',') === fvmBefore.join(',')
          ? ['ordinare per fantavalore non ha mosso una riga: il selettore non ordina']
          : []),
      ],
    });

    // 7d. IL CLICK APRE LA CARD, IL TRASCINAMENTO NO (operatore, 05/09/2026).
    //
    //     I due gesti vivono sulla stessa riga, quindi il passo li prova TUTT'E DUE e separatamente:
    //     «un passo che misura due incognite insieme attribuisce il difetto a quella sbagliata». Del
    //     trascinamento si asserisce quello che NON deve succedere - nessuna card - che e' un'assenza
    //     e quindi va misurata invece di sperata.
    const firstRow = await evaluate(session, () => {
      const row = document.querySelector('app-strategy ol li[data-id]');
      if (!row) return null;
      const box = row.getBoundingClientRect();
      const name = row.querySelector('span.flex-1');
      return {
        id: Number(row.dataset.id),
        name: (name?.innerText ?? '').trim(),
        point: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      };
    });
    if (firstRow) await click(session, firstRow.point);
    // La card legge un ALTRO store (le ultime partite): si aspetta che le righe arrivino invece di
    // fotografare il primo fotogramma, o il passo direbbe «nessuna partita» di una card che le ha.
    let cards = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      cards = (await evaluate(session, readCards)) ?? [];
      if (cards[0]?.lines?.length) break;
      await wait(500);
    }
    const card = cards[0] ?? null;
    const badLines = (card?.lines ?? []).filter((one) => one.cells !== 5 || one.outside);
    note('il click apre la card', {
      said: `${cards.length} card · «${card?.name ?? '?'}» (${card?.where ?? '?'}) con `
        + `${card?.lines?.length ?? 0} partite · prima riga ${JSON.stringify(card?.lines?.[0]?.text ?? null)}`,
      problems: [
        ...(firstRow ? [] : ['nessuna riga da cliccare: il passo non ha misurato niente']),
        ...(cards.length === 1 ? [] : [`${cards.length} card aperte da un click solo`]),
        ...(card && card.name === firstRow?.name
          ? [] : [`ho cliccato «${firstRow?.name}» e la card dice «${card?.name}»`]),
        // LA META D'ASTA NON ESISTE QUI: questa pagina si prepara prima di sedersi, e una max offerta
        // sarebbe il numero di un tavolo inventato accanto a una lista che non lo riguarda.
        ...(card?.market ? ['la card della Strategia mostra una max offerta: non ce nessun tavolo'] : []),
        ...(card?.lines?.length ? [] : [`la card non porta nessuna partita: «${card?.note ?? ''}»`]),
        ...(card && card.lines.length > 5 ? [`${card.lines.length} partite invece delle cinque chieste`] : []),
        ...badLines.slice(0, 3).map((one) =>
          `una riga porta ${one.cells} celle (${one.outside} larghe zero) invece delle cinque colonne`),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'dist', 'e2e-strategy-card.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      console.log(`· screenshot card: ${where}`);
    }

    // ...e IL CHEVRON: l'elenco si estende fino all'intestazione, carica due stagioni e SCORRE, e la
    //     card resta delle stesse dimensioni (operatore, 05/09/2026). «Stesse dimensioni» e' una
    //     misura, quindi si misura: il rettangolo prima e dopo, non l'intenzione.
    const shellBefore = await evaluate(session, () => {
      const card = document.querySelector('ui-player-card > div');
      if (!card) return null;
      const box = card.getBoundingClientRect();
      return { w: Math.round(box.width), h: Math.round(box.height) };
    });
    const chevron = await evaluate(session, () => {
      const button = document.querySelector('ui-player-card [data-expand]');
      if (!button) return null;
      const box = button.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const under = document.elementFromPoint(x, y);
      return { x, y, inside: !!under && button.contains(under) };
    });
    if (chevron) await click(session, chevron);
    await wait(400);
    const opened = await evaluate(session, () => {
      const card = document.querySelector('ui-player-card > div');
      // Il contenitore delle partite si cerca per il suo MARCHIO: «il primo div che contiene una
      // partita» prendeva il riquadro INTORNO all'elenco, che non scorre - e il passo accusava di non
      // scorrere una lista che scorre. Un passo che misura l'elemento sbagliato accusa il codice del
      // proprio difetto.
      const list = card?.querySelector('[data-matches]');
      const box = card?.getBoundingClientRect();
      return {
        w: Math.round(box?.width ?? 0),
        h: Math.round(box?.height ?? 0),
        lines: card?.querySelectorAll('ui-match-line').length ?? 0,
        // SCORRE: il contenuto e' piu' alto della finestra che lo mostra, che e' l'unica prova che una
        // barra di scorrimento serva davvero.
        scrolls: list ? list.scrollHeight > list.clientHeight + 1 : false,
        // ...e quello che sta sopra si e' chiuso per fargli posto.
        numbers: !!card?.innerText.includes('partite attese'),
      };
    });
    note("il chevron apre l'elenco", {
      said: `card ${shellBefore?.w}x${shellBefore?.h} -> ${opened.w}x${opened.h} · partite `
        + `${card?.lines?.length ?? 0} -> ${opened.lines} · scorre ${opened.scrolls} · i due numeri `
        + `grandi ${opened.numbers ? 'ancora a schermo' : 'chiusi'}`,
      problems: [
        ...(chevron ? [] : ['nessun chevron sulla riga delle ultime partite']),
        ...(chevron && !chevron.inside ? ['il chevron non risponde alle proprie coordinate'] : []),
        ...(opened.lines > (card?.lines?.length ?? 0)
          ? [] : [`aperto porta ${opened.lines} partite: non ha caricato niente in piu'`]),
        ...(shellBefore && opened.h === shellBefore.h && opened.w === shellBefore.w
          ? [] : [`la card cambia dimensioni: ${shellBefore?.w}x${shellBefore?.h} -> ${opened.w}x${opened.h}`]),
        ...(opened.scrolls ? [] : ["l'elenco aperto non scorre: o non è cresciuto, o esce dalla card"]),
        ...(opened.numbers ? ['i due numeri grandi sono ancora a schermo: lo spazio non è stato prestato'] : []),
      ],
    });
    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'dist', 'e2e-strategy-card-open.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      console.log(`· screenshot card aperta: ${where}`);
    }
    if (chevron) await click(session, chevron);
    await wait(300);

    // ...e ora il trascinamento, che deve riordinare e NON aprire niente.
    await evaluate(session, () => {
      for (const one of document.querySelectorAll('ui-player-card button')) {
        if (one.getAttribute('aria-label') === 'chiudi') one.click();
      }
      return true;
    });
    await wait(200);
    const fourth = await evaluate(session, rowGeometry, 0, 3);
    const top = await evaluate(session, rowGeometry, 0, 0);
    const move = fourth && top ? { from: fourth, to: { x: top.x, y: top.top - 4 } } : null;
    if (move) await dragTo(session, move.from, move.to);
    await wait(400);
    const cardsAfterDrag = (await evaluate(session, readCards)) ?? [];
    const orderNow = (await evaluate(session, readPills)) ?? [];
    note('il trascinamento riordina e non apre niente', {
      said: `${cardsAfterDrag.length} card dopo il trascinamento · «${fourth?.name}» dal 4° posto in `
        + `cima, e in cima ora c'e' «${orderNow[0]?.name}»`,
      problems: [
        ...(move ? [] : ['non sono riuscito a misurare il varco: il passo non ha trascinato niente']),
        ...(cardsAfterDrag.length ? [`${cardsAfterDrag.length} card aperte da un trascinamento: il click non e filtrato`] : []),
        ...(orderNow[0] && fourth && orderNow[0].name === fourth.name
          ? [] : [`ho portato in cima «${fourth?.name}» e in cima c'e' «${orderNow[0]?.name}»`]),
      ],
    });
    // Rimesso: l'ordine personale e le letture sono preferenze SALVATE, e lasciarle addosso cambierebbe
    // i passi che seguono - e la prossima corsa.
    await evaluate(session, () => {
      try {
        localStorage.removeItem('fantassistant.strategy.priority');
        localStorage.removeItem('fantassistant.strategy.readings');
      } catch {
        /* niente memoria: non c'era niente da rimettere */
      }
      return true;
    });

    // 7e. LA RICERCA DENTRO UN BLOCCO (operatore, 05/09/2026): la lente apre una casella, la casella
    //     filtra QUESTA lista per nome o per squadra, e la ricerca è «intelligente».
    //
    //     L'EQUIVALENZA SI PROVA SCRIVENDO MALE APPOSTA, e la storpiatura la dichiara il banco (k→c,
    //     y→i, doppie singole): non è una copia della funzione dell'app - quella la provano i test
    //     unitari - è la promessa fatta all'operatore, verificata dal lato dello schermo.
    const lens = await evaluate(session, () => {
      const button = document.querySelector('app-strategy section header button[data-search]');
      if (!button) return null;
      const box = button.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const under = document.elementFromPoint(x, y);
      // «CHI RISPONDE A QUEL PUNTO» si chiede al bottone e non al nome del tag: al centro di
      // un'icona c'e' un `<svg>`, che e' SUO - un passo che pretendesse un `button` accuserebbe di
      // essere irraggiungibile un bersaglio che il puntatore raggiunge benissimo.
      return { x, y, under: (under?.tagName ?? '').toLowerCase(), inside: !!under && button.contains(under) };
    });
    const listBefore = await evaluate(session, () => {
      const rows = [...document.querySelectorAll('app-strategy section:first-of-type ol li[data-id]')];
      return rows.map((one) => ({
        id: Number(one.dataset.id),
        name: (one.querySelector('span.flex-1')?.innerText ?? '').trim(),
        at: (one.querySelector('span.w-5')?.innerText ?? '').trim(),
      }));
    });
    if (lens) await click(session, lens);
    await wait(200);
    // Un nome della lista, storpiato come lo scriverebbe chi lo ha solo sentito: la seconda metà del
    // cognome, senza maiuscole, con le k al posto delle c e le y al posto delle i.
    const hunted = listBefore.find((one) => one.name.length >= 6) ?? listBefore[0];
    const typed = (hunted?.name ?? '')
      .slice(2, 7)
      .toLowerCase()
      .replace(/c/g, 'k')
      .replace(/i/g, 'y');
    await evaluate(session, (text) => {
      const box = document.querySelector('app-strategy section input');
      if (!box) return false;
      box.focus();
      return true;
    }, typed);
    await session.send('Input.insertText', { text: typed });
    await wait(300);
    const sifted = await evaluate(session, () => {
      const section = document.querySelector('app-strategy section');
      const rows = [...(section?.querySelectorAll('ol li[data-id]') ?? [])];
      return {
        box: !!section?.querySelector('input'),
        counter: (section?.querySelector('header span:last-of-type')?.innerText ?? '').trim(),
        rows: rows.map((one) => ({
          id: Number(one.dataset.id),
          name: (one.querySelector('span.flex-1')?.innerText ?? '').trim(),
          at: (one.querySelector('span.w-5')?.innerText ?? '').trim(),
          // Il trascinamento è sospeso mentre si filtra: CDK lo dichiara sulla riga.
          draggable: !one.classList.contains('cdk-drag-disabled'),
        })),
        empty: (section?.querySelector('p')?.innerText ?? '').trim(),
      };
    });
    // ...e si richiude, che deve anche CANCELLARE il testo: un filtro dentro un pannello chiuso è
    // invisibile, ed è il difetto che i filtri della tabella hanno già pagato.
    if (lens) await click(session, lens);
    await wait(250);
    const sealed = await evaluate(session, () => {
      const section = document.querySelector('app-strategy section');
      return {
        box: !!section?.querySelector('input'),
        rows: (section?.querySelectorAll('ol li[data-id]') ?? []).length,
      };
    });
    const kept = sifted.rows.find((one) => one.id === hunted?.id);
    note('la ricerca dentro un blocco', {
      said: `lente a (${Math.round(lens?.x ?? 0)},${Math.round(lens?.y ?? 0)}) su ${lens?.under} · `
        + `cercato «${typed}» (da «${hunted?.name}») · ${listBefore.length} → ${sifted.rows.length} righe`
        + ` · «${hunted?.name}» al posto ${kept?.at ?? '?'} (prima ${hunted?.at}) · contatore `
        + `«${sifted.counter}» · richiusa: ${!sealed.box}, ${sealed.rows} righe`,
      problems: [
        ...(lens ? [] : ['nessuna lente in intestazione: la ricerca non c’è']),
        ...(lens && !lens.inside
          ? [`sotto la lente c’è ${lens.under}, che non è suo: è coperta`] : []),
        ...(sifted.box ? [] : ['la lente non ha aperto nessuna casella']),
        ...(kept ? [] : [`ho scritto «${typed}» e «${hunted?.name}» è sparito: la ricerca non tiene le storpiature`]),
        ...(sifted.rows.length < listBefore.length
          ? [] : [`${sifted.rows.length} righe su ${listBefore.length}: la casella non filtra niente`]),
        // IL POSTO RESTA QUELLO VERO: rinumerare da uno le righe trovate direbbe che il quarantesimo
        // difensore è il primo.
        ...(kept && kept.at === hunted?.at
          ? [] : [`«${hunted?.name}» era al posto ${hunted?.at} e filtrato legge ${kept?.at}`]),
        ...(sifted.rows.some((one) => one.draggable)
          ? ['si può ancora trascinare una riga di una lista filtrata: l’ordine finirebbe sbagliato'] : []),
        ...(sealed.box ? ['la lente non ha richiuso la casella'] : []),
        ...(sealed.rows === listBefore.length
          ? [] : [`richiudendo restano ${sealed.rows} righe invece di ${listBefore.length}: il filtro non è stato cancellato`]),
      ],
    });

    // 8. IL LISTONE: il foglio è scelto da (listone, gioco), e la combinazione che il bundle non porta
    //    deve DIRLO invece di riempirsi col foglio dell'altro gioco.

    const toEuroClassic = await setTo('EuroLeghe', 'Classic');
    const empty = await evaluate(session, readPage);
    const emptyBlocks = (await evaluate(session, readBlocks)) ?? [];
    note('una combinazione che il bundle non porta', {
      said: `${emptyBlocks.length} blocchi · avvisi: ${JSON.stringify(empty.alerts).slice(0, 200)}`,
      problems: [
        ...(toEuroClassic ? [toEuroClassic] : []),
        ...(emptyBlocks.length ? [`${emptyBlocks.length} blocchi con un foglio che non esiste`] : []),
        ...(empty.alerts.some((one) => one.includes('Nessun foglio'))
          ? [] : ['la pagina non dice che per questa combinazione non c’è un foglio']),
      ],
    });

    const toEuroMantra = await setTo('Mantra');
    let euro = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      euro = (await evaluate(session, readBlocks)) ?? [];
      if (euro.some((one) => one.rows)) break;
      await wait(500);
    }
    // L'INTESTAZIONE SI LEGGE PER INTERO, non alla seconda `<span>` (06/09/2026).
    //
    // Un selettore POSIZIONALE dentro un'intestazione si rompe il giorno che qualcuno ci mette un
    // controllo: il selettore d'ordinamento ha aggiunto uno span e `nth-of-type(2)` ha cominciato a
    // rispondere «Impostazioni lega», cioe' ad accusare la pagina del proprio difetto mentre la
    // pagina disegnava 12 blocchi e 255 nomi giusti. Quello che il passo vuole sapere e' se
    // l'intestazione NOMINA il foglio, e quella e' una domanda sul testo.
    const header = await evaluate(session, () =>
      (document.querySelector('app-strategy header')?.innerText ?? '').trim().replace(/\s+/g, ' '));
    note('il listone euro', {
      said: `${euro.length} blocchi, ${euro.reduce((sum, one) => sum + one.rows, 0)} nomi · `
        + `intestazione «${header.slice(0, 60)}»`,
      problems: [
        ...(toEuroMantra ? [toEuroMantra] : []),
        ...(euro.some((one) => one.rows) ? [] : ['nessun nome sul listone EuroLeghe']),
        ...(header.includes('EuroLeghe') ? [] : [`l'intestazione dice «${header}» e non il foglio EuroLeghe`]),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = value('--shot-to', join(ROOT, 'dist', 'e2e-strategy-euro.png'));
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      console.log(`· screenshot: ${where}`);
      report.screenshot = where;
    }

    // 9. QUELLO CHE LA PAGINA HA URLATO: un'eccezione vuol dire che qualcosa non è stato provato.
    const noise = session.noise();
    note('la console', {
      said: noise.length ? noise.join(' | ') : 'niente',
      problems: noise,
    });
  } finally {
    session?.close();
    // Chromium fa figli: su Windows `kill()` prende il lanciatore e lascia il browser in piedi con la
    // sua porta di debug aperta - che è come una corsa finisce per misurare la pagina di quella prima.
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

await main();
