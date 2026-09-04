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
    const strip = [...row.children].find((one) => one.querySelectorAll(':scope > span').length === 3
      && one.className.includes('tabular-nums'));
    const pills = strip ? [...strip.querySelectorAll(':scope > span')] : [];
    const rect = row.getBoundingClientRect();
    return {
      id: Number(row.dataset.id),
      name: (name?.innerText ?? '').trim(),
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
  const [id, fm, estFm, pv, estPv, minutes] = [
    'fc_id', 'engine_fm_pred', 'est_fm', 'engine_pv_pred', 'est_pv', 'desc_minutes_next',
  ].map(at);
  const out = new Map();
  for (const row of table.rows) {
    out.set(Number(row[id]), {
      fm: row[fm] ?? row[estFm] ?? null,
      pv: row[pv] ?? row[estPv] ?? null,
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
function stripPoint() {
  const row = document.querySelector('app-strategy ol li[data-id]');
  const strip = row
    ? [...row.children].find((one) => one.querySelectorAll(':scope > span').length === 3
      && one.className.includes('tabular-nums'))
    : null;
  if (!strip) return null;
  const box = strip.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const under = document.elementFromPoint(x, y);
  return { x, y, inside: strip.contains(under) || under === strip };
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

    // 2c. LE TRE PASTIGLIE, contro il FOGLIO e non contro se stesse.
    //
    //     Il foglio si legge QUI, in Node, dal file che il server dell'arnese sta servendo: e' la sola
    //     fonte indipendente da quello che la pagina disegna. Confrontare la pastiglia con un numero
    //     ricavato dalla pastiglia e' l'asserzione circolare che passa qualunque cosa.
    const sheet = await sheetNumbers();
    const pills = (await evaluate(session, readPills)) ?? [];
    const wrongPills = [];
    let checked = 0;
    let clipped = 0;
    let outside = 0;
    let noMinutes = 0;
    let widest = Infinity;
    for (const row of pills) {
      if (row.pills.length !== 3) {
        wrongPills.push(`${row.name} porta ${row.pills.length} pastiglie invece di 3`);
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
      // 1) QUANTO RENDE SOPRA IL SEI: la fantamedia del foglio meno 6, a un decimale.
      const edge = said.fm == null ? null : said.fm - 6;
      const shownEdge = row.pills[0] === '—' ? null : Number(row.pills[0].replace(',', '.'));
      if (edge == null ? shownEdge != null : Math.abs(shownEdge - edge) > 0.06) {
        wrongPills.push(`${row.name}: la prima pastiglia dice ${row.pills[0]} e il foglio ${edge?.toFixed(2)}`);
      }
      // 2) LE PRESENZE ATTESE, e le buone che non possono essere piu' delle giocate.
      const [playedText, passedText] = row.pills[1].split(':');
      const played = playedText === '—' ? null : Number(playedText);
      if (said.pv == null ? played != null : Math.abs(played - said.pv) > 0.51) {
        wrongPills.push(`${row.name}: le presenze dicono ${playedText} e il foglio ${said.pv?.toFixed(2)}`);
      }
      if (passedText != null && played != null && Number(passedText) > played) {
        wrongPills.push(`${row.name}: ${passedText} partite buone su ${played} giocate - un sottoinsieme piu' grande dell'insieme`);
      }
      if (played != null && sheet.matchdays && played > sheet.matchdays + 0.5) {
        wrongPills.push(`${row.name}: ${played} presenze su un calendario di ${sheet.matchdays} giornate`);
      }
      // 3) I MINUTI, e dove il foglio non li porta la pastiglia deve tacere invece di dire zero.
      const minutes = row.pills[2] === '—' ? null : Number(row.pills[2].replace('′', ''));
      if (said.minutes == null) {
        noMinutes += 1;
        if (minutes != null) wrongPills.push(`${row.name}: minuti ${row.pills[2]} e il foglio non ne dichiara`);
      } else if (minutes == null || Math.abs(minutes - said.minutes) > 0.51) {
        wrongPills.push(`${row.name}: i minuti dicono ${row.pills[2]} e il foglio ${said.minutes}`);
      }
    }
    note('le tre pastiglie', {
      said: `${checked} righe confrontate col foglio (${sheet.size} uomini prezzati, calendario `
        + `${sheet.matchdays} giornate) · esempio ${JSON.stringify(pills[0]?.pills ?? null)} per `
        + `«${pills[0]?.name}» · in riga ${pills.filter((one) => !one.stripOwnLine).length}/${pills.length}`
        + ` · nomi tagliati ${clipped}/${pills.length}, il piu' stretto ${widest}px `
        + `· ${noMinutes} righe senza minuti sul foglio`,
      problems: [
        ...(checked ? [] : ['nessuna riga confrontata: il passo non ha misurato niente']),
        ...(outside ? [`${outside} pastiglie fuori dalla loro riga: ci sono nel DOM e non sullo schermo`] : []),
        ...wrongPills.slice(0, 5),
        ...(wrongPills.length > 5 ? [`...e altre ${wrongPills.length - 5} righe che non tornano`] : []),
      ],
    });

    // 2d. LA FRASE DELLE PASTIGLIE, aperta con un puntatore vero: e' li' che si dice quale dei numeri
    //     e' una PREVISIONE e quale una MISURA, cioe' la sola cosa che tre cifre nude non possono dire.
    const strip = await evaluate(session, stripPoint);
    let tip = null;
    if (strip) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: Math.round(strip.x), y: Math.round(strip.y), button: 'none',
      });
      for (let attempt = 0; attempt < 20 && !tip; attempt += 1) {
        await wait(150);
        tip = await evaluate(session, readTooltip);
      }
      // Via dal riquadro, o il pannello resta aperto sopra la riga che il passo dopo misura.
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
      await wait(300);
    }
    note('la frase delle pastiglie', {
      said: tip ? `«${tip.slice(0, 220)}…»` : 'nessun tooltip aperto',
      problems: [
        ...(strip?.inside ? [] : ['sotto il centro della fila non ci sta la fila: il puntatore arriva altrove']),
        ...(tip ? [] : ['la fila delle pastiglie non apre nessun tooltip']),
        ...(tip && tip.includes('PREVISIONE') && tip.includes('MISURA')
          ? [] : ['la frase non dice quale numero sia una previsione e quale una misura']),
        ...(tip && tip.includes('sopra il 6') ? [] : ['la frase non dice contro cosa sia misurato il primo numero']),
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
        if (values[at] > values[at - 1] + 0.05) {
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

    // 5. LA BARRA: dice il regolamento e quale valuta ordina, senza aprire niente.
    note('la barra', {
      said: page.summary,
      problems: [
        ...(page.summary.includes('SURPLUS') ? [] : ['la barra non dice quale valuta ordina le liste']),
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
      const button = section?.querySelector('header button');
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
    // CHI HA PIÙ DI UN CODICE si sa senza leggere il tooltip: un uomo compare in un blocco per ogni
    // codice che porta, quindi due blocchi sono due codici. È il riferimento indipendente che serve per
    // giudicare la frase della riga, invece di confrontarla con se stessa.
    const seen = new Map();
    for (const block of after) {
      for (const part of block.parts) seen.set(part.name, (seen.get(part.name) ?? 0) + 1);
    }
    const polyvalent = { rows: 0, titled: 0 };
    for (const block of after) {
      for (const part of block.parts) {
        if ((seen.get(part.name) ?? 0) < 2) continue;
        polyvalent.rows += 1;
        if (/ · [A-Za-z]+\/[A-Za-z]+/.test(part.title)) polyvalent.titled += 1;
      }
    }
    note('mantra', {
      said: `${after.length} blocchi (${roles}) · ${after.reduce((sum, one) => sum + one.rows, 0)} nomi · `
        + `contatori ${after.map((one) => one.counter).join('/')} · ${polyvalent.titled}/${polyvalent.rows} `
        + 'righe con più codici li dicono nel tooltip',
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
        ...(polyvalent.rows
          ? (polyvalent.titled === polyvalent.rows
            ? [] : [`${polyvalent.rows - polyvalent.titled} righe con più codici non li dicono nel tooltip`])
          : ['nessuna riga con più di un codice: il tooltip dei codici non è stato misurato']),
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
    const withoutPills = narrow.filter((one) => one.pills.length !== 3).length;
    note('la riga stretta (mantra)', {
      said: `${narrow.length} righe · ${wrapped} con le pastiglie a capo · riga alta `
        + `${narrow[0]?.height}px · nome piu' stretto ${Math.min(...narrow.map((one) => one.nameWidth))}px`
        + ` · tagliati ${narrow.filter((one) => one.nameClipped).length} (di cui ${clippedInline} con le `
        + `pastiglie ancora in riga) · esempio «${narrow[0]?.name}» ${JSON.stringify(narrow[0]?.pills ?? null)}`,
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
        if (values[at] > values[at - 1] + 0.05) {
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
    const header = await evaluate(session, () =>
      (document.querySelector('app-strategy header span:nth-of-type(2)')?.innerText ?? '').trim());
    note('il listone euro', {
      said: `${euro.length} blocchi, ${euro.reduce((sum, one) => sum + one.rows, 0)} nomi · `
        + `intestazione «${header}»`,
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
