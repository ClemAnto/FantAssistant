/**
 * e2e-plancia-resume.mjs - drive the REAL plancia against a FAKE fanta-asta-live, and measure the two
 * things the operator reported on 24/09/2026: «se refresho deve rimanere la connessione» and «non si
 * aggiorna il calciatore in asta».
 *
 * WHY A FAKE SERVER AND NOT THE REAL ONE: a live session is somebody's auction, it exists for an hour
 * and it cannot be asked to hold still. So the page's ONE network path is stubbed before the app boots
 * - anonymous sign-in, the listone, and the SSE stream - and the harness becomes the host: it decides
 * what the table publishes and WHEN, which is the only way to drive «somebody buys the man who is
 * currently up» as an event instead of as a mock. Nothing here talks to fanta-asta-live.
 *
 * THE STUB SURVIVES A RELOAD (`Page.addScriptToEvaluateOnNewDocument`), which is the whole point of
 * step 5: a refresh mid-auction has to re-join by itself, and before today `/plancia` opened the
 * invented table over it - `feed.restore()` was called by `/auction` only, and the rule had never been
 * inherited here.
 *
 * FOUR ASSERTIONS AND EACH ONE HAS ITS NULL, because three of the four would pass on a broken page:
 *  - the fixture names somebody BEFORE the connection (else «nobody in asta» after it proves nothing);
 *  - connecting empties that row AND brings the fake table's own squads (else the empty row could just
 *    be a board that failed to load);
 *  - a name put up by hand shows up (else step 4's emptying is not about the pick either);
 *  - and the reload keeps the CODE on screen while the header says whether it is live or saved.
 *
 * Zero dependencies, like the other harnesses: serves `dist/`, launches Edge or Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-plancia-resume.mjs [--headed] [--json] [--shot]
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


// ------------------------------------------------------------------ the FAKE fanta-asta-live

/**
 * The whole of the host, as one function injected before the app boots.
 *
 * IT MUST BE SELF-CONTAINED: `addScriptToEvaluateOnNewDocument` runs it on every document, including
 * the one a reload creates, so it cannot close over anything from this file - the session is built
 * from its two arguments and nothing else.
 *
 * WHAT IT STUBS, and only that: the anonymous sign-in, `sessions/<code>/env/playerList`, and the SSE
 * stream on `sessions/<code>/state`. Everything else - the bundle, the sheets, the assets - goes to
 * the real server, so the board is priced by the REAL engine columns exactly as at a table.
 */
function fakeHost(code, state, listone) {
  // IL TAVOLO NON SI DIMENTICA QUANDO IL MIO BROWSER RICARICA. `addScriptToEvaluateOnNewDocument` gira
  // su OGNI documento, quindi senza questa riga il finto host tornava allo stato iniziale a ogni
  // refresh - e il passo del refresh misurava un tavolo appena nato invece del tavolo di prima. Il
  // difetto era del banco e si e' visto perche' un passo verde e' diventato rosso appena l'asta ha
  // cominciato ad avere una storia.
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem('__fakeAuction') ?? 'null');
  } catch {
    saved = null;
  }
  const store = { code, state: saved ?? state, streams: [] };
  store.keep = () => {
    try {
      sessionStorage.setItem('__fakeAuction', JSON.stringify(store.state));
    } catch {
      /* un browser che rifiuta lo storage fa lo stesso il resto */
    }
  };
  window.__fakeAuction = store;

  /**
   * IL LISTONE DELLA SESSIONE, ed e' quello VERO e non un segnaposto.
   *
   * Per un giro e' stato uno solo, con la ragione «tanto la plancia prezza dal FOGLIO»: vera a meta'.
   * La plancia prezza dal foglio, ma il FEED risolve il RUOLO di un uomo comprato da questa lista -
   * `deriveTeams` chiama `players.get(pick.playerId)` per sapere in che reparto togliere un posto - e
   * con un listone di un nome quel ruolo era sempre `null`, quindi i posti che restano non si
   * muovevano. L'ha trovato l'invariante della sincronia, non una rilettura: il primo giro in cui e'
   * stato chiamato ha detto «Dino legge posti 3·8·8·6 e il tavolo ne lascia 3·7·8·6».
   *
   * *Un fixture piu' povero della cosa vera misura una catena piu' corta di quella che esiste.*
   */

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('identitytoolkit.googleapis.com')) {
      return new Response(JSON.stringify({ idToken: 'fake-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('firebaseio.com')) {
      const body = url.includes('/env/playerList') ? listone : null;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  };

  /**
   * The stream. The feed adds its `put`/`patch` listeners AFTER the constructor returns, so the first
   * event is SCHEDULED and never dispatched inline - firing it synchronously would land on a socket
   * nobody is listening to yet, which is a defect of the harness that reads as a page that never
   * connects.
   */
  class FakeSource extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 1;
      store.streams.push(this);
      setTimeout(() => this.push('put', '/', store.state), 30);
    }
    push(kind, path, data) {
      this.dispatchEvent(new MessageEvent(kind, { data: JSON.stringify({ path, data }) }));
    }
    close() {
      this.readyState = 2;
      store.streams = store.streams.filter((one) => one !== this);
    }
  }
  FakeSource.CLOSED = 2;
  window.EventSource = FakeSource;

  /**
   * CHI E' IN ASTA, come lo pubblica un tavolo vero: `state.selectedPlayerId`.
   *
   * LETTO e non inventato - sessione `FA-xxx-xxx` del 24/09/2026, `appVer` 1.22.2-live, meccanismo a
   * RILANCI: il campo valeva 6875 (Paz N.) mentre l'operatore guardava Paz N. sullo schermo del
   * banditore, stabile su quattordici letture in quaranta secondi e distinto da `lastPick`, che nella
   * stessa lettura portava un uomo gia' venduto.
   */
  store.select = (playerId) => {
    store.state = { ...store.state, selectedPlayerId: playerId };
    store.keep();
    for (const stream of store.streams) stream.push('put', '/selectedPlayerId', playerId);
    return playerId;
  };

  /**
   * QUANTO E' STATO OFFERTO, come lo pubblica un tavolo vero: `state.currentBid`.
   *
   * LETTO e non inventato - stessa sessione `FA-xxx-xxx`, 24/09/2026: alle 23:11 il nodo leggeva
   * `{playerId 5555, value 5}` e trentasei secondi dopo quell'uomo era in `lastPick` con `cost` 5,
   * che e' la prova che `value` e' l'OFFERTA e non il valore dell'uomo (in `lastPick` convivono
   * `cost` 5 e `value` 15, quindi li' la stessa parola dice un'altra cosa).
   */
  store.bid = (playerId, value) => {
    const bid = { playerId, value, teamId: 0, timestamp: Date.now() };
    store.state = { ...store.state, currentBid: bid };
    // Un tavolo che dimentica l'offerta a un refresh non e' il tavolo di un momento prima, ed e' la
    // stessa ragione per cui `select` e `award` la salvano.
    store.keep();
    for (const stream of store.streams) stream.push('put', '/currentBid', bid);
    return value;
  };

  /**
   * UN'AGGIUDICAZIONE ANNULLATA, come il Realtime Database la manda davvero.
   *
   * Non e' un array piu' corto: il database non ha array, li emula su chiavi `"0"`, `"1"`, ... e li
   * serializza come array solo finche' quelle chiavi sono contigue da zero. Togliendo il pick `at`
   * restano chiavi bucate, quindi arriva un OGGETTO - ed e' quella forma che va spedita, o il banco
   * proverebbe un caso che al tavolo vero non capita mai.
   */
  store.unaward = (at) => {
    const picks = {};
    for (const [index, pick] of Object.entries(store.state.picks ?? {})) {
      if (Number(index) !== at) picks[index] = pick;
    }
    store.state = { ...store.state, picks };
    store.keep();
    for (const stream of store.streams) stream.push('put', '/picks', picks);
    return Object.keys(picks).length;
  };

  /**
   * LE ROSE CHE CAMBIANO: una che se ne va, una che si rinomina, una che riceve crediti extra.
   *
   * I campi sono LETTI (24/09/2026, `FA-xxx-xxx`): il nome sta su `connection.label`/`nick` e i
   * crediti regalati su `deltaBudget` - che su sette rose di otto non esisteva affatto, perche' e' un
   * delta e non un totale.
   */
  store.seats = (change) => {
    const teams = (Array.isArray(store.state.teams) ? store.state.teams : []).flatMap((team) => {
      if (change.remove === team.id) return [];
      if (change.id !== team.id) return [team];
      const next = { ...team };
      if (change.label != null) next.connection = { ...(team.connection ?? {}), label: change.label };
      if (change.delta != null) next.deltaBudget = change.delta;
      return [next];
    });
    store.state = { ...store.state, teams };
    store.keep();
    for (const stream of store.streams) stream.push('put', '/teams', teams);
    return teams.length;
  };

  /** What the harness drives: a pick arriving from the banditore, on every open stream. */
  store.award = (playerId, teamId, cost) => {
    const picks = [...(store.state.picks ?? [])];
    const index = picks.reduce((top, pick) => Math.max(top, pick.index), -1) + 1;
    picks.push({ index, teamId, playerId, cost });
    store.state = { ...store.state, picks };
    store.keep();
    for (const stream of store.streams) stream.push('put', '/picks', picks);
    return picks.length;
  };
}

/** Ten seats, 1000 credits, 3/8/8/6 classic: the league every published number of the bench is
 *  measured against, so the board reads the same slot widths it does on the invented table. */
function fakeState(labels) {
  return {
    status: 2,
    marketType: 0,
    playerListType: 'default',
    settings: {
      // 750 E NON 1000: il regolamento dichiarato parte da mille (`DEFAULT_LEAGUE`), quindi un tavolo
      // che ne dichiara mille non proverebbe niente sull'adozione - sarebbe un'uguaglianza scambiata
      // per una cura.
      budget: 750,
      participants: labels.length,
      game: 1,
      roles: { gk: [3, 3], def: [8, 8], mid: [8, 8], atk: [6, 6], size: [25, 25] },
    },
    options: { bids: { countdownSeconds: 10, minBid: 1 } },
    teams: labels.map((label, id) => ({
      id,
      currentBudget: 1000,
      connection: { label, active: true, host: id === 0 },
    })),
    picks: [],
  };
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
 * CHI E' IN ASTA, letto dalla riga in cima - e la riga dichiara da se' quando non c'e' nessuno.
 *
 * Il nome si prende dall'elemento che lo porta e non da tutto il testo della card: quella riga porta
 * anche la banda, il verdetto e l'alternativa, quindi un `includes` sull'intero risponderebbe di si'
 * a mezzo tabellone. `null` quando la card non e' ancora in pagina, che e' un'altra cosa da «nessuno».
 */
function readLot() {
  const card = document.querySelector('plancia-lot-card');
  if (!card) return null;
  const text = (card.innerText ?? '').replace(/\s+/g, ' ').trim();
  if (/nessun calciatore in asta/i.test(text)) return { empty: true, name: null, club: null };
  const name = card.querySelector('.text-base.font-semibold');
  if (!name) return null;
  const club = name.parentElement?.nextElementSibling;
  return {
    empty: false,
    name: (name.innerText ?? '').trim() || null,
    club: (club?.innerText ?? '').trim() || null,
    // CHI LO DICE: il marchio che la riga disegna quando il nome arriva dal tavolo. Si legge
    // l'`<svg>` e non la classe, che `NzIconDirective` mette comunque.
    live: !!card.querySelector('.anticon-wifi svg'),
    // QUANTO C'E' SUL TAVOLO, e chi lo dice. Le due strade sono due elementi diversi apposta - una
    // casella che si batte e una cifra che si guarda - quindi il banco le distingue senza leggere
    // nessuna classe di stile: o c'e' l'input, o c'e' il numero con la sua parola accanto.
    bid: (() => {
      const said = [...card.querySelectorAll('span')].find(
        (one) => (one.innerText ?? '').trim() === 'dal tavolo',
      );
      if (said) {
        const figure = said.previousElementSibling;
        return { from: 'tavolo', value: Number((figure?.innerText ?? '').trim()) };
      }
      const input = card.querySelector('ui-digit-input');
      if (!input) return null;
      const digits = (input.innerText ?? '').replace(/[^0-9]/g, '');
      return { from: 'mano', value: digits === '' ? null : Number(digits) };
    })(),
  };
}

/**
 * Il marchio del tavolo: cosa dice, che stato dichiara, e dove si trova.
 *
 * Si aggancia a `data-table` e non al cammino nell'albero: «la prima pastiglia dell'intestazione» e' il
 * selettore che il giorno in cui la lente si accende comincia a rispondere un'altra cosa.
 */
function readBadge() {
  const badge = document.querySelector('header [data-table]');
  if (!badge) return null;
  const rect = badge.getBoundingClientRect();
  return {
    text: (badge.innerText ?? '').replace(/\s+/g, ' ').trim(),
    state: badge.getAttribute('data-table'),
    button: badge.tagName === 'BUTTON',
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/** I bottoni dell'intestazione, per testo: e' cosi' che si misura un tasto che deve NON esserci. */
function headerButtons() {
  return [...document.querySelectorAll('header button')].map((one) =>
    (one.innerText ?? '').replace(/\s+/g, ' ').trim(),
  );
}

/** Le squadre offerte dalla modale, e quale e' accesa. */
function readPicker() {
  const modal = document.querySelector('.ant-modal-content');
  if (!modal) return null;
  const rows = [...modal.querySelectorAll('button')].filter((one) =>
    one.querySelector('span[style*="background-color"]'),
  );
  return {
    teams: rows.map((one) => (one.innerText ?? '').replace(/\s+/g, ' ').trim()),
    chosen: rows
      .filter((one) => one.className.includes('border-primary'))
      .map((one) => (one.innerText ?? '').replace(/\s+/g, ' ').trim()),
  };
}

/** Quante card di rosa la plancia dichiara MIE: il fatto che la scelta della squadra deve produrre. */
function mineCards() {
  return [...document.querySelectorAll('plancia-team-grid [aria-label]')]
    .filter((card) => /la tua rosa/i.test(card.getAttribute('aria-label') ?? ''))
    .map((card) => (card.querySelectorAll('span')[1]?.innerText ?? '').trim());
}

/** Le sigle delle dieci rose: il null del passo del collegamento - una riga vuota puo' essere un
 *  tabellone che non ha caricato, dieci etichette nuove no. */
function readTeams() {
  return [...document.querySelectorAll('plancia-team-grid [aria-label]')].map((card) =>
    (card.querySelectorAll('span')[1]?.innerText ?? '').trim(),
  );
}

/**
 * LE ROSE COME LA STRISCIA LE DISEGNA: quante sono, come si chiamano, quanti crediti hanno.
 *
 * I crediti si prendono dal NOME ACCESSIBILE e non da una cella: la card lo compone da se' («… — N
 * crediti · posti …») ed e' l'unico posto in cui il numero sta scritto per esteso, quindi leggerlo di
 * li' non dipende da dove la card mette le sue cifre.
 */
function readSeats() {
  return [...document.querySelectorAll('plancia-team-grid [aria-label]')].map((card) => {
    const aria = card.getAttribute('aria-label') ?? '';
    const credits = aria.match(/(\d+)\s*crediti/);
    // «posti 3·8·8·6 (P·D·C·A)», che la card compone da se': i posti che restano per reparto,
    // cioe' il fondo di ogni conto che questa pagina fa sui rivali.
    const places = aria.match(/posti\s*([\d·]+)/);
    return {
      label: (card.querySelectorAll('span')[1]?.innerText ?? '').trim(),
      credits: credits ? Number(credits[1]) : null,
      places: places ? places[1].split('·').map(Number) : null,
    };
  });
}

/**
 * Una riga della plancia ancora NELL'URNA, col suo nome e dove si trova.
 *
 * «Di nessuno» si legge dalla barretta del proprietario, che e' trasparente finche' il nome e' libero:
 * e' lo stesso canale su cui il banco della lente fa il suo join, e non dipende da nessuna classe.
 */
function pickRow(nth) {
  const rows = [...document.querySelectorAll('[data-block] button')].filter((row) => {
    if (row.disabled) return false;
    const bar = row.querySelector('span');
    const paint = bar ? getComputedStyle(bar).backgroundColor : '';
    return paint === 'rgba(0, 0, 0, 0)' || paint === 'transparent';
  });
  const row = rows[nth];
  if (!row) return null;
  const rect = row.getBoundingClientRect();
  return {
    name: (row.querySelectorAll('span')[1]?.innerText ?? '').trim(),
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    rows: rows.length,
  };
}

/**
 * QUANTE RIGHE HA IL TABELLONE: il segnale di «la pagina ha finito», e deve essere INDIPENDENTE da
 * quello che si sta per asserire.
 *
 * La prima versione aspettava che la card del lotto ESISTESSE, e quella card e' in pagina anche vuota:
 * su un avvio freddo il banco leggeva «nessuno in asta» mentre il foglio si stava ancora scaricando, e
 * accusava la plancia di non aver estratto niente. Un giro su due. Il tabellone invece non ha righe
 * finche' il foglio non e' arrivato, e non dice niente ne' sulla barra ne' su chi e' in asta.
 */
function boardRows() {
  return document.querySelectorAll('[data-block] button').length;
}

/**
 * COSA IL TAVOLO HA CAMBIATO: la FRASE che la modale annuncia e il REGOLAMENTO che ha davvero scritto.
 *
 * Tutt'e due, perche' la prima da sola non puo' fallire sulla seconda: con la scrittura rimessa a
 * difetto - la riga annunciata e la dichiarazione NON scritta - il passo restava VERDE. E'
 * l'asserzione circolare da un angolo nuovo: si misurava l'annuncio credendo di misurare l'adozione.
 * Il regolamento e' quello che ogni pagina legge davvero, quindi si legge da li'.
 */
function readAdopted() {
  const line = document.querySelector('.ant-modal-content .border-primary\\/40');
  let budget = null;
  try {
    budget = JSON.parse(localStorage.getItem('fantassistant.options.league') ?? 'null')?.budget;
  } catch {
    budget = null;
  }
  return {
    said: line ? (line.innerText ?? '').replace(/\s+/g, ' ').trim() : null,
    budget: budget ?? null,
  };
}

function readAlert() {
  const alert = document.querySelector('nz-alert');
  return alert ? (alert.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) : null;
}

function typeCode(code) {
  const input = document.querySelector('.ant-modal input');
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  ).set;
  setter.call(input, code);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** Lo stato del finto tavolo, come il banco lo ha spedito: l'altra meta' del confronto. */
function tableState() {
  const store = window.__fakeAuction;
  return store ? { state: store.state } : null;
}

// ------------------------------------------------------------------ the run

async function gz(url) {
  const { gunzipSync } = await import('node:zlib');
  const body = await (await fetch(url)).arrayBuffer();
  return JSON.parse(gunzipSync(Buffer.from(body)).toString('utf-8'));
}

const CODE = 'FA-tst-001';
const LABELS = ['Io', 'Bea', 'Ciro', 'Dino', 'Elsa', 'Fede', 'Gigi', 'Ivo', 'Lea', 'Mimmo'];

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run "ng build" first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-resume-'));
  const debugPort = Number(value('--port', String(await freePort())));
  // IL TAVOLO APRE VUOTO, che e' il default dal 23/09/2026 ed e' quello che serve qui: il collegamento
  // deve portare LE ROSE DELLA SESSIONE, e su un fixture gia' giocato le due popolazioni si
  // confonderebbero.
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

  /**
   * L'INVARIANTE DELLA SINCRONIA, richiesto dall'operatore il 24/09/2026 («accertati che i dati restino
   * SEMPRE sincronizzati fra plancia e asta-live»).
   *
   * I passi qui sotto misurano un FATTO per volta - questo misura il TUTTO, e lo rifa' dopo ogni
   * mossa del banditore. Confronta tre cose che la pagina disegna con le stesse tre RICALCOLATE dallo
   * stato del tavolo e dal FOGLIO:
   *
   *  - quante rose ci sono e come si chiamano;
   *  - i crediti di ognuna: `budget + deltaBudget - speso`, con lo speso dai PICK (che sono giusti a
   *    ogni istante) e non da `currentBudget` (che e' in ritardo, misurato il 09/08/2026);
   *  - i posti che restano per reparto, che e' la catena pick -> ruolo -> rosa per intero;
   *  - e chi e' in asta.
   *
   * Il ruolo di ogni uomo comprato viene dal FOGLIO e non dallo schermo: confrontare la pagina con un
   * numero ricavato dalla pagina e' l'asserzione circolare che questo repository ha gia' pagato due
   * volte in questa stessa sessione.
   */
  let sync = null;

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Runtime.enable');
    await session.send('Page.enable');

    // IL LISTONE DELLA SESSIONE, costruito dal FOGLIO che la pagina stessa legge: stessi `fc_id`, stessi
    // ruoli, quindi la catena pick -> ruolo -> posti che restano e' quella vera.
    const sheetForList = await gz(`http://127.0.0.1:${port}/data/sheets/leghe.json.gz`);
    const col = (name) => sheetForList.columns.indexOf(name);
    const ZONE = { P: 'gk', D: 'def', C: 'mid', A: 'atk' };
    const listone = {};
    for (const one of sheetForList.rows) {
      const role = one[col('role_classic')];
      if (!ZONE[role]) continue;
      listone[one[col('fc_id')]] = {
        id: one[col('fc_id')],
        name: one[col('name')],
        team: one[col('club')],
        roles: [],
        zone: { classic: ZONE[role], mantra: role === 'P' ? 'gk' : 'mov' },
        championship: { label: 'Serie A' },
        stats: { fmv: { classic: 1, mantra: 1 } },
      };
    }

    // IL FINTO HOST PRIMA DELL'APP, e su OGNI documento: il passo del refresh non misura niente se lo
    // stub vive solo nella pagina in cui e' stato installato.
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        `(${fakeHost.toString()})(${JSON.stringify(CODE)}, ${JSON.stringify(fakeState(LABELS))}, ` +
        `${JSON.stringify(listone)});`,
    });
    await session.send('Page.reload');
    await wait(400);

    // 1. IL NULL DI TUTTO IL RESTO: la finzione apre nominando qualcuno. Senza questo passo, «nessuno
    //    in asta» dopo il collegamento non distingue la cura da un tabellone che non ha caricato.
    const drawn = await waitFor(session, boardRows, 80);
    const opened = await evaluate(session, readLot);
    const badgeBefore = await evaluate(session, readBadge);
    const buttonsBefore = await evaluate(session, headerButtons);
    const entrance = (buttonsBefore ?? []).filter((one) => /collegati/i.test(one)).length;
    note('la plancia apre sul tavolo finto, con un nome gia in asta e il tasto per collegarsi', {
      said:
        `${drawn} righe disegnate · barra «${badgeBefore?.text ?? '—'}» (${badgeBefore?.state ?? '—'}) · ` +
        `${entrance} tasti «collegati» · ` +
        `in asta «${opened?.empty ? 'nessuno' : (opened?.name ?? '—')}»`,
      problems: [
        ...(drawn ? [] : ['il tabellone non ha disegnato una riga: la pagina non ha finito di caricare']),
        ...(badgeBefore?.state === 'demo'
          ? []
          : [`la barra dichiara «${badgeBefore?.state}» e non «demo»`]),
        // IL NULL DEL PASSO 2: senza il tasto QUI, «il tasto non c'e' da collegati» non distingue la
        // cura da una fessura di proiezione che non ha mai pescato niente.
        ...(entrance === 1
          ? []
          : [
              `sul tavolo finto trovo ${entrance} tasti «collegati» invece di uno: ` +
                "senza, il passo che lo cerca ASSENTE non proverebbe niente",
            ]),
        ...(opened && !opened.empty
          ? []
          : [
              'il tavolo finto non ha messo nessuno in asta: i passi seguenti non avrebbero un null',
            ]),
      ],
    });

    // 2. IL COLLEGAMENTO, dal bottone e dalla modale - la strada dell'operatore, non `feed.connect`.
    //    E' precisamente quella che il difetto aveva: la modale parla col FEED e non con la plancia.
    const connect = await evaluate(session, boxOf, 'header button', "collegati a un'asta");
    if (connect) await click(session, connect);
    await wait(500);
    const typed = await evaluate(session, typeCode, CODE);
    await wait(200);
    const submit = await evaluate(session, boxOf, '.ant-modal button', 'collegati');
    if (submit) await click(session, submit);
    // SI ASPETTA L'ATTRIBUTO CHE LA PAGINA DICHIARA, non il cammino nell'albero: la pastiglia e'
    // diventata un BOTTONE il 24/09/2026 e questa sonda continuava a cercare uno `<span>` - leggeva
    // «il collegamento non e arrivato» accanto a una barra che stampava il codice.
    const connected = await waitFor(
      session,
      (code) => (document.querySelector('header [data-table]')?.innerText ?? '').includes(code),
      40,
      CODE,
    );
    await wait(500);

    const afterConnect = await evaluate(session, readLot);
    const teams = await evaluate(session, readTeams);
    const seen = LABELS.filter((label) => (teams ?? []).includes(label)).length;
    const badgeLive = await evaluate(session, readBadge);
    const buttonsLive = await evaluate(session, headerButtons);
    const leftovers = (buttonsLive ?? []).filter((one) => /collegati|cambia asta/i.test(one));
    note('collegarsi porta le rose della sessione E svuota chi era in asta', {
      said:
        `codice digitato: ${typed} · barra «${badgeLive?.text ?? '—'}» (${badgeLive?.state ?? '—'}) · ` +
        `${leftovers.length} tasti d'asta in barra · ` +
        `${seen} delle ${LABELS.length} sigle della sessione a schermo · ` +
        `in asta «${afterConnect?.empty ? 'nessuno' : (afterConnect?.name ?? '—')}»`,
      problems: [
        // SUA ISTRUZIONE DEL 24/09/2026: da collegati il tasto non c'e' piu', e l'entrata e' la
        // pastiglia col codice - che quindi dev'essere un BOTTONE.
        ...(leftovers.length
          ? [`da collegati la barra porta ancora ${leftovers.join(', ')}`]
          : []),
        ...(badgeLive?.button
          ? []
          : ['la pastiglia col codice non e un bottone: non c\'e\' nessuna entrata alla sessione']),
        ...(connected
          ? []
          : ['la barra non ha mai mostrato il codice: il collegamento non e arrivato']),
        ...(seen >= LABELS.length
          ? []
          : [
              `solo ${seen} delle ${LABELS.length} sigle della sessione sono a schermo: ` +
                'le rose non sono quelle del tavolo vero',
            ]),
        ...(afterConnect?.empty
          ? []
          : [
              `«${afterConnect?.name}» e rimasto in asta dopo il collegamento: era il nome estratto ` +
                'dalla finzione, e a quel tavolo non e in asta nessuno',
            ]),
      ],
    });

    // 2-bis. LA PASTIGLIA APRE LA MODALE, E LI' SI DICE QUALE SQUADRA E' LA MIA (sue istruzioni del
    //    24/09/2026). Il fatto che deve uscirne non e' nella modale: e' la plancia che comincia a
    //    riconoscere una rosa come la propria - prima di oggi da qui non si poteva dire affatto, e il
    //    tabellone contava me fra i rivali e leggeva il budget di lega al posto dei miei crediti.
    const mineBefore = await evaluate(session, mineCards);
    if (badgeLive) await click(session, badgeLive);
    await wait(500);
    const picker = await evaluate(session, readPicker);
    // IL REGOLAMENTO SEGUE IL TAVOLO (sua richiesta, 24/09/2026), e lo DICE: la sessione dichiara 750
    // crediti contro i 1000 di partenza, quindi la riga deve nominarli. Un tavolo che dichiarasse gli
    // stessi numeri non proverebbe niente.
    const adoptedSaid = await evaluate(session, readAdopted);
    const target = (picker?.teams ?? []).findIndex((one) => one.startsWith(LABELS[0]));
    if (target >= 0) {
      const at = await evaluate(session, (label) => {
        const modal = document.querySelector('.ant-modal-content');
        const row = [...(modal?.querySelectorAll('button') ?? [])]
          .filter((one) => one.querySelector('span[style*="background-color"]'))
          .find((one) => (one.innerText ?? '').trim().startsWith(label));
        if (!row) return null;
        const rect = row.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, LABELS[0]);
      if (at) await click(session, at);
    }
    await wait(300);
    const chosen = await evaluate(session, readPicker);
    await evaluate(session, () => {
      document.querySelector('.ant-modal-close')?.click();
      return true;
    });
    await wait(400);
    const mineAfter = await evaluate(session, mineCards);
    note('la pastiglia apre la modale, e da li si sceglie la propria squadra', {
      said:
        `presa dal tavolo: «${adoptedSaid?.said ?? '—'}», ` +
        `il regolamento dichiara ${adoptedSaid?.budget ?? '—'} crediti · ` +
        `${picker?.teams?.length ?? 0} squadre offerte · ` +
        `accesa «${(chosen?.chosen ?? []).join(', ') || 'nessuna'}» · ` +
        `rose mie sulla plancia: ${mineBefore?.length ?? 0} prima, ${mineAfter?.length ?? 0} dopo ` +
        `(${(mineAfter ?? []).join(', ') || '—'})`,
      problems: [
        ...((picker?.teams?.length ?? 0) === LABELS.length
          ? []
          : [
              `la modale offre ${picker?.teams?.length ?? 0} squadre invece delle ${LABELS.length} ` +
                'del tavolo: o non si e aperta, o non legge le rose della sessione',
            ]),
        ...((mineBefore ?? []).length === 0
          ? []
          : ['la plancia aveva gia una rosa mia prima della scelta: il passo non ha un null']),
        ...((mineAfter ?? []).length === 1 && mineAfter[0].startsWith(LABELS[0])
          ? []
          : [
              `dopo la scelta la plancia dichiara ${(mineAfter ?? []).length} rose mie ` +
                `(${(mineAfter ?? []).join(', ') || 'nessuna'}) invece della sola ${LABELS[0]}`,
            ]),
        ...((chosen?.chosen ?? []).length === 1
          ? []
          : ['la modale non ha marcato la squadra scelta: la scelta non si rilegge']),
        ...(/750/.test(adoptedSaid?.said ?? '')
          ? []
          : [
              'la modale non dichiara di aver preso i 750 crediti del tavolo: ' +
                `dice «${adoptedSaid?.said ?? 'niente'}»`,
            ]),
        ...(adoptedSaid?.budget === 750
          ? []
          : [
              `il regolamento dichiarato e rimasto a ${adoptedSaid?.budget} crediti invece dei 750 ` +
                'del tavolo: la frase lo annuncia e la dichiarazione non e stata scritta',
            ]),
      ],
    });

    // 3. IL TAVOLO PUBBLICA CHI E' IN ASTA, ed e' la segnalazione dell'operatore del 24/09/2026 («il
    //    calciatore che si dovrebbe vedere in asta e Zappacosta e dovrebbe arrivare dai dati live»).
    //    Il campo e' `selectedPlayerId`, LETTO su una sessione a rilanci viva e non indovinato.
    //
    //    CHI SIA QUEL NOME LO DICE IL FOGLIO e non lo schermo: il banco pubblica un `fc_id` preso dal
    //    pacchetto e poi controlla che la riga stampi QUEL nome - confrontare lo schermo con se stesso
    //    e' l'asserzione circolare che questo repository ha gia' pagato.
    const base = `http://127.0.0.1:${port}/data`;
    const sheet = await gz(`${base}/sheets/leghe.json.gz`);
    const nameAt = sheet.columns.indexOf('name');
    const idAt = sheet.columns.indexOf('fc_id');
    const clubAt = sheet.columns.indexOf('club');
    // CHI LA PLANCIA NON DISEGNA: il caso in cui il difetto del 24/09/2026 (sera) viveva. La mappa
    // porta 25 slot da `teams` uomini - 250 su ~600 - e a un'estrazione LIBERA la maggior parte dei
    // nomi estratti sta sotto. Si prende dal FOGLIO piu' le quotazioni, come fa la pagina: il rango
    // per FVM dentro il ruolo, e chi sta oltre `slot x teams` e' nella coda.
    const quotes = await gz(`${base}/listone_quotes.json.gz`);
    const manifest = await (await fetch(`${base}/manifest.json`)).json();
    const qAt = (name) => quotes.columns.indexOf(name);
    const fvm = new Map();
    for (const one of quotes.rows) {
      if (String(one[qAt('season')]) !== String(manifest.target_season)) continue;
      if (String(one[qAt('platform')]) !== 'default') continue;
      const value = Number(one[qAt('fvm')]);
      if (value > 0) fvm.set(Number(one[qAt('fc_id')]), value);
    }
    const roleAt = sheet.columns.indexOf('role_classic');
    const SLOTS = { P: 3, D: 8, C: 8, A: 6 };
    const byRole = {};
    for (const one of sheet.rows) {
      const value = fvm.get(one[idAt]);
      if (!value) continue;
      (byRole[one[roleAt]] ??= []).push([one, value]);
    }
    for (const role of Object.keys(byRole)) byRole[role].sort((a, b) => b[1] - a[1]);
    // L'ULTIMO DIFENSORE QUOTATO: il piu' lontano possibile dalla mappa, cosi' il passo non dipende da
    // dove cade esattamente il confine.
    const tailRow = (byRole.D ?? []).at(-1)?.[0];
    const tailId = tailRow?.[idAt] ?? null;
    const tailRank = (byRole.D ?? []).length;
    const tailDrawn = SLOTS.D * LABELS.length;

    const roleOfId = new Map(sheet.rows.map((one) => [one[idAt], one[sheet.columns.indexOf('role_classic')]]));
    const ROLE_ORDER = ['P', 'D', 'C', 'A'];
    sync = async (when) => {
      const table = await evaluate(session, tableState);
      const seats = await evaluate(session, readSeats);
      const lot = await evaluate(session, readLot);
      const state = table?.state;
      if (!state || !seats) {
        note(`sincronia — ${when}`, {
          said: 'non ho letto ne il tavolo ne lo schermo',
          problems: ['il passo NON ha guardato niente'],
        });
        return;
      }
      const picks = (Array.isArray(state.picks) ? state.picks : Object.values(state.picks ?? {}))
        .filter((one) => one && !one.released);
      const rows = Array.isArray(state.teams) ? state.teams : Object.values(state.teams ?? {});
      const budget = state.settings?.budget ?? 0;
      const slots = state.settings?.roles ?? {};
      const need = (zone) => (Array.isArray(slots[zone]) ? slots[zone][0] : (slots[zone] ?? 0));
      const problems = [];

      const want = rows.map((team) => {
        const mine = picks.filter((one) => one.teamId === team.id);
        const spent = mine.reduce((sum, one) => sum + (one.cost ?? one.value ?? 0), 0);
        const owned = { P: 0, D: 0, C: 0, A: 0 };
        for (const one of mine) {
          const role = roleOfId.get(one.playerId);
          if (role in owned) owned[role] += 1;
        }
        return {
          label: team.connection?.label ?? team.connection?.nick ?? team.name ?? `Squadra ${team.id}`,
          credits: budget + (Number(team.deltaBudget) || 0) - spent,
          places: [
            Math.max(0, need('gk') - owned.P),
            Math.max(0, need('def') - owned.D),
            Math.max(0, need('mid') - owned.C),
            Math.max(0, need('atk') - owned.A),
          ],
        };
      });

      if (seats.length !== want.length) {
        problems.push(`a schermo ci sono ${seats.length} rose e il tavolo ne ha ${want.length}`);
      }
      for (const expected of want) {
        const shown = seats.find((one) => one.label === expected.label);
        if (!shown) {
          problems.push(`«${expected.label}» e al tavolo e non a schermo`);
          continue;
        }
        if (shown.credits !== expected.credits) {
          problems.push(
            `«${expected.label}» legge ${shown.credits} crediti e il tavolo ne da ${expected.credits}`,
          );
        }
        if ((shown.places ?? []).join('·') !== expected.places.join('·')) {
          problems.push(
            `«${expected.label}» legge posti ${(shown.places ?? []).join('·')} e il tavolo ` +
              `ne lascia ${expected.places.join('·')}`,
          );
        }
      }

      // CHI E' IN ASTA: quello che il tavolo pubblica, a meno che non sia gia' stato comprato - e in
      // quel caso la riga NON deve portarlo, che e' la meta' che nessun conteggio vedrebbe.
      const up = state.selectedPlayerId;
      const sold = picks.some((one) => one.playerId === up);
      const upName = up && !sold ? sheet.rows.find((one) => one[idAt] === up)?.[nameAt] : null;
      if (upName && lot?.name !== upName) {
        problems.push(
          `il tavolo ha in asta «${upName}» e la riga dice «${lot?.empty ? 'nessuno' : lot?.name}»`,
        );
      }
      if (up && sold && lot?.live) {
        problems.push(`la riga porta ancora «${lot?.name}» dal tavolo, ma e gia stato venduto`);
      }

      note(`sincronia — ${when}`, {
        said:
          `${seats.length} rose · ${picks.length} aggiudicazioni · ` +
          `in asta «${upName ?? (lot?.empty ? 'nessuno' : (lot?.name ?? '—'))}» · ` +
          `${problems.length ? problems.length + ' scarti' : 'tutto allineato'}`,
        problems,
      });
    };

    const onBoard = await evaluate(session, pickRow, 40);
    const alsoOnBoard = await evaluate(session, pickRow, 90);
    const idOf = (shown) => {
      const rows = sheet.rows.filter(
        (one) => one[nameAt] === shown?.name && (!shown?.club || one[clubAt] === shown.club),
      );
      return rows.length === 1 ? rows[0][idAt] : null;
    };
    // Il club non e' sulla riga della plancia, quindi si prende il nome e si accetta solo se il foglio
    // lo identifica senza ambiguita': un omonimo qui misurerebbe un altro uomo.
    const firstId = idOf({ name: onBoard?.name });
    const secondId = idOf({ name: alsoOnBoard?.name });

    if (firstId != null) await evaluate(session, (id) => window.__fakeAuction.select(id), firstId);
    await wait(700);
    const live = await evaluate(session, readLot);
    note('il tavolo pubblica chi e in asta, e la riga lo mostra dicendo che e suo', {
      said:
        firstId == null
          ? `il foglio non identifica «${onBoard?.name}»: passo NON giudicato`
          : `pubblicato fc_id ${firstId} (${onBoard?.name}) · la riga dice ` +
            `«${live?.empty ? 'nessuno' : (live?.name ?? '—')}», dal tavolo: ${live?.live}`,
      problems: [
        ...(firstId == null
          ? ['il foglio non identifica il nome a schermo, quindi questo passo NON ha guardato niente']
          : []),
        ...(firstId != null && live?.name !== onBoard?.name
          ? [
              `il tavolo ha messo in asta «${onBoard?.name}» e la riga dice ` +
                `«${live?.empty ? 'nessuno' : live?.name}»`,
            ]
          : []),
        ...(firstId != null && live?.name === onBoard?.name && !live?.live
          ? ['la riga non dichiara che il nome arriva dal tavolo: il marchio non c\'e\'']
          : []),
      ],
    });

    await sync('il tavolo ha appena messo un nome in asta');

    // 3-bis. E LO SEGUE QUANDO CAMBIA. Un campo letto una volta sola all'apertura si comporterebbe
    //    bene qui sopra e male per tutta l'asta, che e' il difetto peggiore dei due.
    if (secondId != null) await evaluate(session, (id) => window.__fakeAuction.select(id), secondId);
    await wait(700);
    const moved = await evaluate(session, readLot);
    note('e quando il tavolo cambia nome, la riga lo segue', {
      said:
        secondId == null
          ? `il foglio non identifica «${alsoOnBoard?.name}»: passo NON giudicato`
          : `passato a fc_id ${secondId} (${alsoOnBoard?.name}) · la riga dice ` +
            `«${moved?.empty ? 'nessuno' : (moved?.name ?? '—')}»`,
      problems: [
        ...(secondId == null
          ? ['il foglio non identifica il secondo nome: questo passo NON ha guardato niente']
          : []),
        ...(secondId != null && moved?.name !== alsoOnBoard?.name
          ? [
              `il tavolo e passato a «${alsoOnBoard?.name}» e la riga dice ` +
                `«${moved?.empty ? 'nessuno' : moved?.name}»`,
            ]
          : []),
      ],
    });

    const named = moved;

    // 3-ter. E QUANTO C'E' SUL TAVOLO ARRIVA DALLO STESSO POSTO (sua richiesta, 24/09/2026:
    //    «aggiorna anche l'offerta corrente per il calciatore in asta letta da fanta-asta-live»).
    //    `state.currentBid`, letto sulla sessione viva insieme al nome.
    //
    //    DUE OFFERTE E NON UNA, perche' un campo letto una volta sola si comporterebbe bene al primo
    //    rilancio e male per tutta l'asta - lo stesso null del nome, un piano sotto.
    if (secondId != null) await evaluate(session, (id) => window.__fakeAuction.bid(id, 7), secondId);
    await wait(700);
    const firstBid = await evaluate(session, readLot);
    if (secondId != null) await evaluate(session, (id) => window.__fakeAuction.bid(id, 23), secondId);
    await wait(700);
    const raised = await evaluate(session, readLot);
    note("l offerta corrente arriva dal tavolo, e la riga dice che non e nostra", {
      said:
        secondId == null
          ? 'senza un fc_id identificato non c e niente su cui offrire: passo NON giudicato'
          : `il banditore ha pubblicato 7 e poi 23 · la riga legge ` +
            `${firstBid?.bid?.value ?? '—'} e ${raised?.bid?.value ?? '—'}, ` +
            `da «${raised?.bid?.from ?? '—'}»`,
      problems: [
        ...(secondId == null
          ? ['il foglio non identifica il nome in asta, quindi questo passo NON ha guardato niente']
          : []),
        ...(secondId != null && firstBid?.bid?.value !== 7
          ? [`il tavolo ha offerto 7 e la riga legge ${firstBid?.bid?.value ?? 'niente'}`]
          : []),
        ...(secondId != null && raised?.bid?.value !== 23
          ? [`il rilancio a 23 non e arrivato: la riga legge ${raised?.bid?.value ?? 'niente'}`]
          : []),
        // CHI LO DICE e' meta' del fatto: una cifra del banditore dentro una casella che si batte
        // sarebbe un gesto che non fa niente, e un gesto che non fa niente in silenzio e
        // indistinguibile da uno rotto.
        ...(secondId != null && raised?.bid?.value === 23 && raised?.bid?.from !== 'tavolo'
          ? ['la cifra e quella giusta ma la riga non dichiara che e del tavolo: e ancora la casella']
          : []),
      ],
    });

    // 3-quater. IL NULL: un offerta che nomina UN ALTRO UOMO non si stampa. Fra due lotti quel nodo
    //    puo' restare fermo sull'ultimo, e una cifra vera detta sull'uomo sbagliato decide un
    //    verdetto, una banda e un acquisto. Senza questo passo la meta' che conta non e' guardata.
    if (firstId != null) await evaluate(session, (id) => window.__fakeAuction.bid(id, 99), firstId);
    await wait(700);
    const stale = await evaluate(session, readLot);
    note('e un offerta che nomina un altro uomo NON finisce sulla riga di chi e in asta', {
      said:
        firstId == null || secondId == null
          ? 'servono due fc_id identificati per separare le due domande: passo NON giudicato'
          : `pubblicata un offerta di 99 su fc_id ${firstId} mentre in asta c e ${secondId} · ` +
            `la riga legge ${stale?.bid?.value ?? '—'} da «${stale?.bid?.from ?? '—'}»`,
      problems: [
        ...(firstId == null || secondId == null
          ? ['non ho due nomi identificati, quindi questo passo NON ha guardato niente']
          : []),
        ...(firstId != null && secondId != null && stale?.bid?.value === 99
          ? ["la riga ha preso l offerta fatta su un ALTRO uomo: 99 crediti attribuiti a chi e in asta"]
          : []),
        ...(firstId != null && secondId != null && stale?.bid?.from === 'tavolo'
          ? ['la riga dichiara ancora che la cifra e del tavolo, ma quella del tavolo e di un altro']
          : []),
      ],
    });

    await sync('il nome in asta e cambiato');

    // 3-ter. UN NOME DELLA CODA, che e' il caso segnalato dall'operatore la sera del 24/09/2026 («adesso
    //    non vedo il calciatore in asta»): il tavolo aveva Jean del Lecce, rango 169 di 189 difensori,
    //    e la riga diceva «nessun calciatore in asta» perche' `lot()` lo cercava solo fra i 250
    //    DISEGNATI. Invisibile finche' il nome lo mettevamo noi cliccando una riga della plancia; il
    //    caso normale dal giorno in cui a nominarlo e' il tavolo.
    if (tailId != null) await evaluate(session, (id) => window.__fakeAuction.select(id), tailId);
    await wait(700);
    const tail = await evaluate(session, readLot);
    note('anche un nome della CODA si vede, e la riga dice che non ha uno slot', {
      said:
        tailId == null
          ? 'non ho saputo costruire la coda dal pacchetto: passo NON giudicato'
          : `pubblicato fc_id ${tailId} (${tailRow?.[nameAt]}), rango ${tailRank} di ${tailRank} fra i D ` +
            `mentre la plancia ne disegna ${tailDrawn} · la riga dice ` +
            `«${tail?.empty ? 'nessuno' : (tail?.name ?? '—')}»`,
      problems: [
        ...(tailId == null ? ['il passo NON ha guardato niente'] : []),
        ...(tailId != null && tail?.name !== tailRow?.[nameAt]
          ? [
              `il tavolo ha messo in asta «${tailRow?.[nameAt]}», che la plancia non disegna, ` +
                `e la riga dice «${tail?.empty ? 'nessuno' : tail?.name}»`,
            ]
          : []),
        ...(tailId != null && tail?.name === tailRow?.[nameAt] && !tail?.live
          ? ['la riga non dichiara che il nome arriva dal tavolo']
          : []),
      ],
    });

    // ...e poi si torna a un nome DISEGNATO, o i passi dopo misurerebbero la coda.
    if (secondId != null) await evaluate(session, (id) => window.__fakeAuction.select(id), secondId);
    await wait(500);

    await sync('in asta c e un uomo della coda');

    // 4. QUALCUNO LO COMPRA, e l'acquisto arriva dallo STREAM come a un tavolo vero: nessun gesto
    //    nostro lo cancella, quindi se la riga non si svuota da se' resta «in asta» un uomo venduto.
    //    CHI SIA quel nome lo dice il FOGLIO e non lo schermo, e quando il foglio non lo identifica il
    //    passo DICE di non aver giudicato niente invece di passare.
    const soldId = secondId;
    if (soldId != null) {
      await evaluate(session, (id) => window.__fakeAuction.award(id, 3, 42), soldId);
    }
    await wait(700);
    const afterSale = await evaluate(session, readLot);
    note('quando il banditore lo assegna, la riga si svuota da se', {
      said:
        soldId == null
          ? `non ho saputo dire quale fc_id sia «${named?.name}»: NON giudicato`
          : `venduto fc_id ${soldId} a ${LABELS[3]} per 42 · in asta «${afterSale?.empty ? 'nessuno' : (afterSale?.name ?? '—')}»`,
      problems: [
        ...(soldId == null
          ? ['il foglio non identifica il nome a schermo, quindi questo passo NON ha guardato niente']
          : []),
        ...(soldId != null && !afterSale?.empty
          ? [`«${afterSale?.name}» e ancora in asta dopo essere stato venduto`]
          : []),
      ],
    });

    await sync('il banditore ha appena aggiudicato');

    // 4-bis. E QUANDO IL BANDITORE LA ANNULLA (sua richiesta, 24/09/2026: «le assegnazioni possono
    //    essere anche annullate o modificate»). Firebase manda un nodo con le chiavi BUCATE, cioe' un
    //    OGGETTO e non un array: prima di oggi `livePicks` ci chiamava `.filter` sopra, che e' un
    //    `TypeError` dentro un `computed` - la plancia si spegneva nell'istante in cui il banditore
    //    correggeva un errore, che e' il momento peggiore in cui possa succedere.
    //
    //    IL NULL E' IL CONTEGGIO PRIMA: «una riga libera in piu'» non vuol dire niente senza «quante
    //    ce n'erano», e «la pagina non si e' spenta» si misura sulle righe disegnate.
    const beforeCancel = await evaluate(session, pickRow, 0);
    const left = await evaluate(session, (index) => window.__fakeAuction.unaward(index), 0);
    await wait(700);
    const afterCancel = await evaluate(session, pickRow, 0);
    const stillDrawn = await evaluate(session, boardRows);
    note('un aggiudicazione annullata rimette l uomo nell urna, e la plancia non si spegne', {
      said:
        `annullato il pick 0, ne restano ${left} · righe libere ${beforeCancel?.rows ?? 0} → ` +
        `${afterCancel?.rows ?? 0} · il tabellone disegna ${stillDrawn} righe`,
      problems: [
        ...(stillDrawn
          ? []
          : [
              'dopo l annullamento il tabellone non disegna piu una riga: la pagina si e spenta, ' +
                'che e esattamente il difetto del nodo bucato',
            ]),
        ...((afterCancel?.rows ?? 0) === (beforeCancel?.rows ?? 0) + 1
          ? []
          : [
              `le righe libere sono passate da ${beforeCancel?.rows} a ${afterCancel?.rows}: ` +
                'l uomo non e tornato nell urna',
            ]),
      ],
    });

    await sync('un aggiudicazione e stata annullata');

    // 4-ter. LE ROSE CAMBIANO SOTTO (sua richiesta, 24/09/2026: «quando vengono aggiunte o rimosse, se
    //    cambiano nome, se ottengono crediti extra»). Tre fatti in un passo solo perche' arrivano dallo
    //    stesso nodo e con lo stesso evento; misurati tutt'e tre dal lato dello SCHERMO.
    //
    //    I CREDITI EXTRA sono `deltaBudget`, LETTO sul tavolo vero e non `currentBudget`, che e' il
    //    campo in ritardo misurato il 09/08: derivare la spesa dai pick e sommare il regalo e' l'unico
    //    modo di avere una borsa giusta a ogni istante.
    const seatsBefore = await evaluate(session, readSeats);
    await evaluate(session, () => window.__fakeAuction.seats({ id: 1, label: 'Rinominata' }));
    await wait(500);
    await evaluate(session, () => window.__fakeAuction.seats({ id: 2, delta: 250 }));
    await wait(500);
    const seatsRenamed = await evaluate(session, readSeats);
    await evaluate(session, () => window.__fakeAuction.seats({ remove: 4 }));
    await wait(600);
    const seatsAfter = await evaluate(session, readSeats);
    const renamed = (seatsRenamed ?? []).some((one) => one.label === 'Rinominata');
    const gifted = (seatsRenamed ?? []).find((one) => one.label === LABELS[2]);
    const wasGifted = (seatsBefore ?? []).find((one) => one.label === LABELS[2]);
    note('le rose cambiano sotto: nome nuovo, crediti extra, una che se ne va', {
      said:
        `rose ${seatsBefore?.length ?? 0} → ${seatsAfter?.length ?? 0} · ` +
        `«${LABELS[1]}» → «Rinominata»: ${renamed} · ` +
        `crediti di ${LABELS[2]}: ${wasGifted?.credits} → ${gifted?.credits} · ` +
        `${LABELS[4]} ancora a schermo: ${(seatsAfter ?? []).some((one) => one.label === LABELS[4])}`,
      problems: [
        ...(renamed ? [] : [`la rosa rinominata si chiama ancora «${LABELS[1]}»`]),
        ...(gifted?.credits === (wasGifted?.credits ?? 0) + 250
          ? []
          : [
              `i 250 crediti extra non sono arrivati: ${LABELS[2]} legge ${gifted?.credits} ` +
                `invece di ${(wasGifted?.credits ?? 0) + 250}`,
            ]),
        ...((seatsAfter ?? []).length === (seatsBefore ?? []).length - 1
          ? []
          : [
              `le rose sono ${seatsAfter?.length} invece di ${(seatsBefore?.length ?? 0) - 1}: ` +
                'quella tolta e ancora al tavolo',
            ]),
        ...((seatsAfter ?? []).some((one) => one.label === LABELS[4])
          ? [`«${LABELS[4]}» e stata tolta dal tavolo e la plancia la disegna ancora`]
          : []),
      ],
    });

    await sync('le rose sono cambiate');

    // 5. IL REFRESH. E' la segnalazione numero uno, e la sua misura e' la barra: il codice deve
    //    restare, e non deve ricomparire «tavolo finto».
    //
    //    PRIMA SI RIMETTE UN NOME IN ASTA, perche' dal 24/09/2026 il refresh deve riportarlo a schermo
    //    («appena la connessione con l'asta-live si attiva, deve essere visibile il calciatore in
    //    asta»). Senza questo, la riga vuota dopo il ricaricamento non distinguerebbe «non l'ha
    //    ripreso» da «non c'era niente da riprendere».
    // IL TAVOLO TACE PRIMA DI QUESTO PASSO: da quando pubblica chi e' in asta, un nome messo a mano
    // non arriverebbe mai a schermo - il doppio click si rifiuta, dicendolo. Quello che si misura qui
    // e' l'ALTRA meta' (§52: il nome nominato sopravvive al refresh), che vive proprio quando il
    // tavolo non parla.
    await evaluate(session, () => window.__fakeAuction.select(null));
    await wait(500);
    const again = await evaluate(session, pickRow, 12);
    if (again) await click(session, { x: again.x, y: again.y }, 2);
    await wait(500);
    const beforeReload = await evaluate(session, readLot);

    await session.send('Page.reload');
    await wait(600);
    // STESSO SEGNALE INDIPENDENTE: si aspetta il tabellone e poi si legge la barra, che e' quello che
    // si sta asserendo - aspettare la barra vorrebbe dire aspettare la risposta.
    const redrawn = await waitFor(session, boardRows, 80);
    const badgeAfter = await evaluate(session, readBadge);
    const mineKept = await evaluate(session, mineCards);
    const teamsAfter = await evaluate(session, readTeams);
    // LE SIGLE ATTESE SONO QUELLE CHE IL TAVOLO HA ADESSO e non le dieci di partenza: il passo delle
    // rose ne ha tolta una e rinominata un'altra, quindi confrontare con `LABELS` misurerebbe il
    // tavolo di mezz'ora fa. `seatsAfter` e' la fotografia presa un istante prima del refresh.
    const expected = (seatsAfter ?? []).map((one) => one.label);
    const kept = expected.filter((label) => (teamsAfter ?? []).includes(label)).length;
    const lotAfter = await evaluate(session, readLot);
    note('un refresh riprende la sessione invece di aprirci sopra la finzione', {
      said:
        `${redrawn} righe ridisegnate · barra «${badgeAfter?.text ?? '—'}» (${badgeAfter?.state ?? '—'}) · ` +
        `${kept} delle ${expected.length} sigle · rosa mia: «${(mineKept ?? []).join(', ') || 'nessuna'}» · ` +
        `in asta «${beforeReload?.name ?? '—'}» prima, «${lotAfter?.empty ? 'nessuno' : (lotAfter?.name ?? '—')}» dopo`,
      problems: [
        ...(redrawn ? [] : ['dopo il refresh il tabellone non ha disegnato una riga']),
        ...((badgeAfter?.text ?? '').includes(CODE)
          ? []
          : [`dopo il refresh la barra dice «${badgeAfter?.text}»: la sessione non e stata ripresa`]),
        ...(badgeAfter?.state === 'demo'
          ? ['dopo il refresh la plancia e tornata al tavolo inventato']
          : []),
        ...(kept >= expected.length
          ? []
          : [`solo ${kept} delle ${expected.length} sigle sono tornate`]),
        // LA SQUADRA SCELTA E' RICORDATA: `follow` la scrive in `localStorage` e `restore` la rimette
        // prima ancora che lo stream risponda. Se si perdesse, i tetti dopo un refresh leggerebbero il
        // budget di lega senza che niente a schermo lo dica.
        ...((mineKept ?? []).length === 1
          ? []
          : [`dopo il refresh la plancia dichiara ${(mineKept ?? []).length} rose mie invece di una`]),
        // IL NOME IN ASTA TORNA, appena il codice della sessione arriva: e' un fatto che l'operatore ha
        // DICHIARATO, e ridichiararlo a ogni ricaricamento e' esattamente cio' che non deve costare.
        ...(beforeReload && !beforeReload.empty
          ? []
          : ['non avevo messo nessuno in asta prima del refresh: il passo non ha un null']),
        ...(lotAfter && !lotAfter.empty && lotAfter.name === beforeReload?.name
          ? []
          : [
              `prima del refresh era in asta «${beforeReload?.name}» e dopo la riga dice ` +
                `«${lotAfter?.empty ? 'nessuno' : lotAfter?.name}»`,
            ]),
      ],
    });

    await sync('dopo un refresh a meta asta');

    // 6. SCOLLEGARSI, dalla stessa modale: il tavolo torna a essere inventato e la pagina non resta
    //    vuota - quale sia il tavolo di ripiego e' una decisione della PAGINA, e questo passo la misura.
    const badgeNow = await evaluate(session, readBadge);
    if (badgeNow) await click(session, badgeNow);
    await wait(500);
    const leaveAt = await evaluate(session, boxOf, '.ant-modal button', 'scollegati');
    if (leaveAt) await click(session, leaveAt);
    await waitFor(session, boardRows, 60);
    await wait(400);
    const badgeGone = await evaluate(session, readBadge);
    const buttonsGone = await evaluate(session, headerButtons);
    note('scollegarsi rimette il tavolo di prova, e il tasto per collegarsi torna', {
      said:
        `barra «${badgeGone?.text ?? '—'}» (${badgeGone?.state ?? '—'}) · ` +
        `${(buttonsGone ?? []).filter((one) => /collegati/i.test(one)).length} tasti «collegati»`,
      problems: [
        ...(leaveAt ? [] : ['la modale non offre il tasto per scollegarsi']),
        ...(badgeGone?.state === 'demo'
          ? []
          : [`dopo lo scollegamento la barra dichiara «${badgeGone?.state}» e non «demo»`]),
        ...((buttonsGone ?? []).some((one) => /collegati/i.test(one))
          ? []
          : ['senza sessione il tasto per collegarsi non e tornato: non c\'e\' piu\' nessuna entrata']),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'plancia-resume.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      report.screenshot = where;
      console.log(`  screenshot: ${where}`);
    }

    const said = await evaluate(session, readAlert);
    if (said) note('la pagina dice', { said });

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
