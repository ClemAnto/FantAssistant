/**
 * e2e-plancia-squad.mjs - drive the REAL plancia and measure the SQUAD CARD.
 *
 * «Nello spazio disponibile in basso a destra aggiungi una card dove mostri due colonne: a destra un
 * campetto con i migliori 11 della tua squadra (secondo il modulo 433) e a sinistra i restanti
 * calciatori ordinati prima per ruolo e poi per moneta. Se in una posizione non sono stati acquistati
 * calciatori mostra con opacita' 0.5 un paio di suggerimenti realistici su chi potrebbe essere
 * acquistato in quella posizione. Se per una posizione occupata c'e' disponibile ancora un acquisto
 * migliore fattibile per quella posizione fallo comparire subito sotto» (operatore, 23/09/2026).
 *
 * Quella richiesta e' fatta di AFFERMAZIONI VERIFICABILI, e questo banco le verifica una per una contro
 * qualcosa che non sia la card stessa:
 *  - i posti del campetto contro `classic_modules.json`, letto dallo stesso server che serve la pagina
 *    (1-4-3-3), perche' il modulo e' un REGOLAMENTO e non una nostra memoria;
 *  - «un acquisto MIGLIORE» contro i numeri che la PLANCIA stampa sulle sue 250 righe: il valore atteso
 *    e' `(6 + edge) x pv`, e il suggerimento deve batterlo. Senza questo passo la parola «migliore»
 *    sarebbe un'affermazione della card su se stessa - l'asserzione circolare che questo repository ha
 *    gia' pagato due volte (04/09, 23/09);
 *  - «FATTIBILE» contro la cifra che la card DICHIARA nel proprio tooltip: nessun prezzo suggerito la
 *    supera;
 *  - «ancora da comprare» contro la barra del proprietario sulla riga della plancia: un nome grigio che
 *    sulla plancia risulta di qualcuno sarebbe un consiglio impossibile.
 *
 * E DUE COSE CHE LA CARD PROMETTE SENZA DIRLE. La riga d'ATTACCO non deve finire sotto la barra in basso
 * a destra (misurato prima della cura: 35px su 37, cioe' la riga intera), e la card deve riprendersi
 * quei 40px appena la barra si piega - quindi il passo la piega davvero e rimisura, invece di fidarsi
 * della classe. E i nomi in grigio devono essere TUTTI DIVERSI: lo stesso uomo consigliato sotto due
 * posti direbbe di comprarlo due volte.
 *
 * Zero dependencies, like the other harnesses: serves `dist/`, launches Edge or Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-plancia-squad.mjs [--headed] [--json] [--shot]
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

/** Il modulo che l'operatore ha dichiarato: la card lo scrive, e questo banco lo cerca nel regolamento. */
const MODULE = '4-3-3';
/** Le quattro lettere della rosa, nell'ordine in cui la plancia le disegna. */
const ROLES = ['P', 'D', 'C', 'A'];
/** Il voto di riferimento del gioco, che e' la base della colonna `edge` della plancia (`EDGE_BASE`). */
const EDGE_BASE = 6;

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
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port })),
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
 * Un puntatore VERO, dove il browser dice che il bersaglio sta: un `element.click()` passa sopra la CSS.
 *
 * `clicks` e' il `clickCount` che il browser riceve, ed e' quello che fa di un doppio click un doppio
 * click: due pressioni sullo stesso punto con `clickCount` 1 e poi 2 sono cio' che Chromium trasforma in
 * un `dblclick`. Spedire l'evento a mano non proverebbe niente sul GESTO, che e' la cosa in prova qui.
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
  // Piu' del ritardo con cui il singolo click apre la card (`DOUBLE_MS` = 250 ms): il passo deve
  // misurare quello che resta a gesto FINITO, non a meta' dell'attesa.
  await wait(500);
}

/** Un bersaglio che si e' FERMATO: un popover entra con un'animazione, e si clicca dove arriva. */
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

/**
 * LA CARD COME LO SCHERMO CE L'HA: i posti, chi li occupa, i grigi sotto e dove tutto questo cade.
 *
 * Un posto occupato porta una riga PIENA e i grigi hanno `opacity: 0.5`, che e' il canale con cui la
 * card dice «questo non e' tuo»: si legge percio' l'opacita' CALCOLATA e non una classe, o si starebbe
 * verificando il sorgente invece dello schermo.
 */
function readCard() {
  const card = document.querySelector('plancia-squad-card');
  if (!card) return null;
  const shell = card.parentElement;
  const box = shell.getBoundingClientRect();
  const dock = document.querySelector('[data-dock="right"]')?.getBoundingClientRect() ?? null;
  // LA LINEA SI CHIEDE PER NOME e non si conta: il cestino del riordino e' un fratello delle quattro
  // righe, quindi `> div > div` finisce su di LUI - misurato, questo passo accusava la card di stare
  // fuori dalla linea degli attaccanti mentre misurava il cestino.
  const attack = document.querySelector('[data-line="A"]')?.getBoundingClientRect() ?? null;
  const pitch = card.querySelector('[data-pitch]');
  const rows = [...(pitch?.children ?? [])].map((row) => {
    const rect = row.getBoundingClientRect();
    return {
      y: Math.round(rect.top),
      h: Math.round(rect.height),
      // Quanto di questa riga finisce sotto la barra in basso: e' il difetto che la card cura cedendo
      // il proprio fondo, e la promessa e' ZERO. Un RETTANGOLO e non solo l'altezza, perche' da piegata
      // la barra e' larga quanto la sua freccia: dire «coperta» di una riga che le passa accanto
      // sarebbe il banco che misura la cosa sbagliata.
      hidden: dock
        ? Math.round(
            Math.max(0, Math.min(rect.bottom, dock.bottom) - Math.max(rect.top, dock.top)) *
              (Math.min(rect.right, dock.right) > Math.max(rect.left, dock.left) ? 1 : 0),
          )
        : 0,
      /** ...e quanto della sua LARGHEZZA: da piegata e' solo l'angolo, da aperta e' la riga intera. */
      hiddenWide: dock
        ? Math.round(Math.max(0, Math.min(rect.right, dock.right) - Math.max(rect.left, dock.left)))
        : 0,
      width: Math.round(rect.width),
      places: [...row.querySelectorAll('[data-place]')].map((place) => {
        const held = place.querySelector('[data-held]');
        return {
          role: place.getAttribute('data-place'),
          man: held ? (held.innerText ?? '').trim() : null,
          dashed: getComputedStyle(place).borderTopStyle === 'dashed',
          hints: [...place.querySelectorAll('[data-hint]')].map((hint) => ({
            name: (hint.querySelector('[data-hint-name]')?.innerText ?? '').trim(),
            price: Number((hint.querySelector('[data-hint-price]')?.innerText ?? '').trim()),
            // L'opacita' che ha chiesto, letta come il browser la calcola.
            opacity: Number(getComputedStyle(hint).opacity),
          })),
        };
      }),
    };
  });
  return {
    width: Math.round(box.width),
    height: Math.round(box.height),
    // La card deve stare DENTRO la linea degli attaccanti: altrove sarebbe un'altra cosa.
    inAttackLine: attack
      ? Math.round(box.top) >= Math.round(attack.top) - 2 &&
        Math.round(box.bottom) <= Math.round(attack.bottom) + 2
      : false,
    module: (card.querySelector('[data-module]')?.innerText ?? '').trim(),
    filled: (card.querySelector('[data-filled]')?.innerText ?? '').trim(),
    rows,
    bench: [...card.querySelectorAll('[data-bench-row]')].map((row) => ({
      role: row.getAttribute('data-bench-row'),
      name: (row.querySelector('[data-bench-name]')?.innerText ?? '').trim(),
      coin: (row.querySelector('[data-bench-coin]')?.innerText ?? '').trim(),
    })),
    // Nessun figlio deve uscire dalla card: `overflow` la taglierebbe in silenzio.
    outside: [...card.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && (r.bottom > box.bottom + 1 || r.right > box.right + 1);
    }).length,
  };
}

/**
 * LA PLANCIA COME GIUDICE INDIPENDENTE: per ogni nome, i due numeri che stampa e se ha un padrone.
 *
 * `edge` e `pv` sono le due cifre che la riga porta accanto al nome, e il loro prodotto ribasato sul sei
 * e' il VALORE ATTESO con cui il campetto sceglie chi gioca. I nomi doppi si scartano invece di essere
 * indovinati: un confronto su un omonimo e' peggio di un confronto in meno.
 */
function readBoard() {
  const byName = new Map();
  const twice = new Set();
  // LE RIGHE DEL TABELLONE E BASTA, per l'attributo che la griglia DICHIARA. La card della rosa e la
  // striscia delle rose sono PROIETTATE dentro `plancia-slot-matrix`, quindi `plancia-slot-matrix
  // button` prende anche le loro righe: ogni uomo disegnato sulla card comparirebbe due volte,
  // finirebbe fra gli omonimi e verrebbe scartato - cioe' il banco leggerebbe ZERO confronti e
  // accuserebbe la pagina del proprio difetto. Trovato alla prima corsa, ed e' il motivo per cui un
  // passo che non giudica niente deve dirlo invece di passare.
  for (const row of document.querySelectorAll('plancia-slot-matrix [data-block] button')) {
    const cells = [...row.querySelectorAll('span')];
    const name = (row.innerText ?? '').split('\n')[0].trim();
    if (!name) continue;
    const edge = Number((cells.at(-3)?.innerText ?? '').replace(/[^0-9.-]/g, ''));
    const pv = Number((cells.at(-2)?.innerText ?? '').replace(/[^0-9.-]/g, ''));
    const paint = cells[0] ? getComputedStyle(cells[0]).backgroundColor : '';
    const owned = !!paint && paint !== 'transparent' && !paint.startsWith('rgba(0, 0, 0, 0');
    if (byName.has(name)) twice.add(name);
    byName.set(name, { edge, pv, owned });
  }
  for (const name of twice) byName.delete(name);
  return { men: Object.fromEntries(byName), ambiguous: [...twice] };
}

/** Dove sta un controllo, per il suo testo visibile - e chi c'e' davvero sotto quel punto. */
function boxOf(selector, text) {
  const found = [...document.querySelectorAll(selector)].find((one) =>
    (one.innerText ?? one.getAttribute('aria-label') ?? '')
      .toLowerCase()
      .includes(text.toLowerCase()),
  );
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Il bersaglio di un hover, per attributo: l'icona che porta la frase della card. */
function iconBox() {
  const found = document.querySelector('plancia-squad-card [data-note]');
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * DOVE STA UNA RIGA DEL TABELLONE, e se quel nome e' ancora di nessuno.
 *
 * La barra del proprietario e' dipinta: e' il canale con cui la riga dichiara di avere un padrone, ed e'
 * la stessa lettura che `readBoard` fa. `owned` decide quale dei due casi il passo sta provando.
 */
function rowBox(owned) {
  for (const row of document.querySelectorAll('plancia-slot-matrix [data-block] button')) {
    const bar = row.querySelector('span');
    const paint = bar ? getComputedStyle(bar).backgroundColor : '';
    const has = !!paint && paint !== 'transparent' && !paint.startsWith('rgba(0, 0, 0, 0');
    if (has !== owned) continue;
    const rect = row.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const x = rect.left + rect.width / 3;
    const y = rect.top + rect.height / 2;
    const under = document.elementFromPoint(x, y);
    if (!row.contains(under) && under !== row) continue;
    return { x, y, name: (row.innerText ?? '').split(String.fromCharCode(10))[0].trim() };
  }
  return null;
}

/** Cosa il tavolo dice di se': il lotto in asta, quante card sono aperte, e l'avviso della pagina. */
function readTable() {
  return {
    lot: (document.querySelector('plancia-lot-card')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    cards: document.querySelectorAll('ui-player-card').length,
    alert: (document.querySelector('nz-alert')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
  };
}

function tooltipText() {
  const tip = document.querySelector('.ant-tooltip-inner');
  return tip ? (tip.innerText ?? '').trim() : '';
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run "ng build" first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-squad-'));
  const debugPort = Number(value('--port', String(await freePort())));
  // DUE INDIRIZZI, e sono due popolazioni. La plancia apre su un tavolo VUOTO (sua istruzione del
  // 23/09/2026: «di default non abilitare il tavolo finto»), che e' lo stato con cui lui si siede: li' si
  // verifica proprio quello, che non ci sia niente di comprato. Tutto il resto - i posti occupati, «un
  // acquisto migliore», la panchina - ha bisogno di una rosa, quindi si chiede il fixture GIOCATO.
  const url = `http://127.0.0.1:${port}/plancia`;
  const played = `${url}?fixture=played`;
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
    if (detail.problems?.length)
      report.problems.push(...detail.problems.map((p) => `${step}: ${p}`));
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await wait(1500);

    // 0-bis. IL TAVOLO APRE VUOTO, che e' la sua istruzione del 23/09/2026 e la prima cosa che si vede
    //        aprendo la pagina. Senza questo passo la regressione sarebbe muta: un tavolo che torna a
    //        giocarsi addosso un terzo dell'asta si legge come «ho gia' comprato nove uomini» e la card
    //        della rosa lo dice pure, con undici nomi che non sono suoi.
    const fresh = await waitFor(session, readCard);
    const freshPlaces = fresh?.rows.flatMap((row) => row.places) ?? [];
    note('la plancia apre su un tavolo VUOTO', {
      said: fresh
        ? `${freshPlaces.filter((one) => one.man).length} posti occupati · panchina ${fresh.bench.length} · ` +
          `${freshPlaces.flatMap((one) => one.hints).length} suggerimenti`
        : 'nessuna card a schermo',
      problems: [
        ...(fresh ? [] : ['la card non si disegna sul tavolo di default']),
        ...(fresh && freshPlaces.some((one) => one.man)
          ? ["il tavolo di default ha gia' degli acquisti: si e' rigiocato addosso"]
          : []),
        ...(fresh && fresh.bench.length ? ['il tavolo di default arriva con una panchina'] : []),
      ],
    });

    // ...e da qui in poi serve una rosa da disegnare, quindi il fixture GIOCATO.
    await session.send('Page.navigate', { url: played });
    await wait(1800);

    // 0. IL REGOLAMENTO, dallo stesso server che serve la pagina: il modulo e' una cosa DICHIARATA in
    //    `config/classic_modules.json`, quindi il numero atteso si legge di la' e non si scrive qui.
    const rulebook = await (
      await fetch(`http://127.0.0.1:${port}/data/classic_modules.json`)
    ).json();
    const shape = rulebook?.modules?.[MODULE];
    const wanted = shape
      ? { P: 1, D: (shape.D ?? []).length, C: (shape.M ?? []).length, A: (shape.A ?? []).length }
      : null;
    note('il regolamento classic', {
      said: wanted ? `${MODULE} = ${ROLES.map((r) => `${r}${wanted[r]}`).join(' ')}` : 'assente',
      problems: wanted
        ? []
        : [
            `il pacchetto non porta ${MODULE} in classic_modules.json: il resto non si puo' giudicare`,
          ],
    });

    const card = await waitFor(session, readCard);
    if (!card) throw new Error('nessuna plancia-squad-card a schermo');
    const board = await evaluate(session, readBoard);

    // 1. DOV'E' E QUANTO E' GRANDE. Due colonne in basso a destra, dentro la linea degli attaccanti.
    const places = card.rows.flatMap((row) => row.places);
    const counts = ROLES.reduce(
      (out, role) => ({ ...out, [role]: places.filter((p) => p.role === role).length }),
      {},
    );
    note('la card sta nello spazio in basso a destra', {
      said: `${card.width}x${card.height}px · ${places.length} posti · ${ROLES.map((r) => `${r}${counts[r]}`).join(' ')}`,
      problems: [
        ...(card.inAttackLine ? [] : ['la card non sta dentro la linea degli attaccanti']),
        ...(card.outside ? [`${card.outside} elementi escono dalla card e vengono tagliati`] : []),
        ...(card.module === MODULE
          ? []
          : [`l'intestazione dice «${card.module}» invece di ${MODULE}`]),
        // I posti si contano contro il REGOLAMENTO e non contro un numero scritto qui.
        ...(wanted && ROLES.some((role) => counts[role] !== wanted[role])
          ? [
              `i posti non sono quelli del regolamento: ` +
                `${ROLES.map((r) => `${r} ${counts[r]}/${wanted[r]}`).join(' · ')}`,
            ]
          : []),
      ],
    });

    // 2. LA RIGA D'ATTACCO NON STA SOTTO LA BARRA. E' il difetto misurato prima della cura (35px su 37
    //    nascosti), quindi la promessa e' zero e la si pretende a barra APERTA, che e' lo stato normale.
    const hidden = card.rows.filter((row) => row.hidden > 0);
    note('nessuna riga del campetto finisce sotto la barra in basso', {
      said: `${card.rows.length} righe, ${hidden.length} coperte`,
      problems: hidden.map(
        (row, at) => `la riga ${at + 1} ha ${row.hidden}px dei suoi ${row.h} sotto la barra`,
      ),
    });

    // 3. I GRIGI: all'opacita' che ha chiesto, tutti diversi, e nessuno gia' di qualcuno.
    const hints = places.flatMap((place) => place.hints);
    const names = hints.map((one) => one.name);
    const sold = names.filter((name) => board.men[name]?.owned);
    const wrongInk = hints.filter((one) => Math.abs(one.opacity - 0.5) > 0.01);
    note('i suggerimenti sono grigi, distinti e ancora comprabili', {
      said: `${hints.length} nomi · ${new Set(names).size} distinti · opacita' ${[...new Set(hints.map((o) => o.opacity))].join('/')}`,
      problems: [
        ...(hints.length
          ? []
          : ['nessun suggerimento a schermo: la card non sta consigliando niente']),
        ...(new Set(names).size === names.length
          ? []
          : [
              `lo stesso uomo e' consigliato su piu' posti: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`,
            ]),
        ...(wrongInk.length
          ? [`${wrongInk.length} suggerimenti non sono allo 0.5 di opacita'`]
          : []),
        ...(sold.length
          ? [`${sold.length} consigliati sono gia' di qualcuno: ${sold.join(', ')}`]
          : []),
      ],
    });

    // 4. UN POSTO VUOTO NE PORTA DUE, UNO OCCUPATO AL PIU' UNO. E' la forma esatta della sua richiesta.
    const empty = places.filter((place) => !place.man);
    const held = places.filter((place) => place.man);
    const tooMany = held.filter((place) => place.hints.length > 1);
    const notPair = empty.filter((place) => place.hints.length && place.hints.length !== 2);
    note('due grigi sotto un posto vuoto, uno sotto un posto occupato', {
      said: `${held.length} occupati (${held.filter((p) => p.hints.length).length} da migliorare) · ${empty.length} vuoti`,
      problems: [
        ...tooMany.map((place) => `un posto occupato porta ${place.hints.length} suggerimenti`),
        ...notPair.map(
          (place) => `un posto vuoto porta ${place.hints.length} suggerimenti invece di 2`,
        ),
        // Il tratteggio e' il canale con cui un posto vuoto si dichiara, ora che la parola non c'e' piu'.
        ...(empty.every((place) => place.dashed)
          ? []
          : ['un posto vuoto non ha il bordo tratteggiato: si legge come un posto occupato']),
      ],
    });

    // 5. «MIGLIORE» SI VERIFICA SUI NUMERI DELLA PLANCIA, non sulla parola della card. Il valore atteso
    //    e' `(6 + edge) x pv`, che e' quello che la plancia stampa su ogni riga.
    const worth = (name) => {
      const found = board.men[name];
      return found && Number.isFinite(found.edge) && Number.isFinite(found.pv)
        ? (EDGE_BASE + found.edge) * found.pv
        : null;
    };
    const judged = [];
    const skipped = [];
    for (const place of held) {
      for (const hint of place.hints) {
        const mine = worth(place.man);
        const his = worth(hint.name);
        if (mine == null || his == null) skipped.push(`${hint.name} su ${place.man}`);
        else judged.push({ place: place.man, hint: hint.name, mine, his });
      }
    }
    const worse = judged.filter((one) => !(one.his > one.mine));
    note("un «acquisto migliore» lo e' davvero, coi numeri della plancia", {
      // I NON GIUDICABILI SI NOMINANO, ed e' un limite del GIUDICE e non della card: la plancia disegna
      // 25 slot x `teams` uomini, quindi chi sta nella CODA o chi rientra troppo tardi per avere una
      // riga non ha i due numeri su cui questo confronto poggia - e nella rosa del tavolo finto ce ne
      // sono (Terracciano dalla coda, Thuram K. che rientra a gennaio). La card invece i punti ce li
      // ha per tutti, perche' legge il listone e non il tabellone.
      said:
        `${judged.length} confronti verificati · ${skipped.length} fuori dal tabellone` +
        (skipped.length ? ` (${skipped.slice(0, 6).join(' · ')})` : ''),
      problems: [
        ...worse.map(
          (one) =>
            `${one.hint} (${one.his.toFixed(0)}) e' consigliato al posto di ${one.place} ` +
            `(${one.mine.toFixed(0)}), che rende di piu'`,
        ),
        // Un banco che non riesce a giudicare NIENTE non e' un banco verde: lo dice.
        ...(judged.length || !held.some((p) => p.hints.length)
          ? []
          : ["nessun confronto e' stato giudicabile: il banco non ha guardato niente"]),
      ],
    });

    // 6. LA PANCHINA: per RUOLO e poi per MONETA, che e' la sua istruzione alla lettera.
    const benchRoles = card.bench.map((one) => ROLES.indexOf(one.role));
    const outOfOrder = benchRoles.filter((at, i) => i && at < benchRoles[i - 1]).length;
    const coinBreaks = [];
    card.bench.forEach((one, at) => {
      const before = card.bench[at - 1];
      if (!before || before.role !== one.role) return;
      const a = before.coin === '·' ? -Infinity : Number(before.coin);
      const b = one.coin === '·' ? -Infinity : Number(one.coin);
      if (b > a) coinBreaks.push(`${one.name} (${one.coin}) sopra ${before.name} (${before.coin})`);
    });
    note("la panchina e' ordinata per ruolo e poi per moneta", {
      said: `${card.bench.length} nomi · ${[...new Set(card.bench.map((o) => o.role))].join('')}`,
      problems: [
        ...(outOfOrder ? [`${outOfOrder} righe rompono l'ordine dei ruoli P-D-C-A`] : []),
        ...coinBreaks.map((one) => `la moneta risale dentro un reparto: ${one}`),
        // Il separatore dei decimali di quest'app e' il PUNTO (sua regola, 05/09/2026).
        ...(card.bench.some((one) => /\d,\d/.test(one.coin))
          ? ["una moneta e' scritta con la virgola: il separatore di quest'app e' il punto"]
          : []),
      ],
    });

    // 7. «FATTIBILE» CONTRO LA CIFRA CHE LA CARD DICHIARA DI SE': il tooltip dice fino a quanto si puo'
    //    arrivare su un uomo solo, e nessun prezzo suggerito deve superarlo. Il tooltip si apre con un
    //    puntatore vero, perche' `[nzTooltipTitle]` e' un binding di PROPRIETA' e nel DOM non c'e' niente.
    const icon = await evaluate(session, iconBox);
    let said = '';
    if (icon) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(icon.x),
        y: Math.round(icon.y),
        button: 'none',
      });
      await wait(700);
      said = await evaluate(session, tooltipText);
    }
    const room = Number(/arrivare a (\d+) crediti/.exec(said)?.[1] ?? NaN);
    const overRoom = Number.isFinite(room) ? hints.filter((one) => one.price > room) : [];
    note("nessun suggerimento costa piu' di quello che la card dichiara", {
      said: said ? `«${said.slice(0, 120)}...» · tetto ${room}` : 'nessun tooltip',
      problems: [
        ...(said
          ? []
          : ["la frase della card non si apre: l'unica spiegazione dei grigi non arriva"]),
        ...(said && !Number.isFinite(room)
          ? ['la frase non dichiara il tetto: «fattibile» resta una parola']
          : []),
        ...overRoom.map((one) => `${one.name} costa ${one.price} e il tetto dichiarato e' ${room}`),
        ...(hints.some((one) => !Number.isFinite(one.price) || one.price < 1)
          ? ['un suggerimento non porta un prezzo leggibile']
          : []),
      ],
    });
    // Via il puntatore, o il tooltip resta aperto sopra i passi che vengono dopo.
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 20,
      y: 400,
      button: 'none',
    });
    await wait(300);

    // 8. LA BARRA SI PIEGA E LA CARD SI RIPRENDE I SUOI 40px. La riserva esiste solo mentre serve: se
    //    restasse sarebbe spazio buttato, ed e' la ragione per cui e' legata allo stato della barra.
    const fold = await evaluate(session, boxOf, '[data-dock="right"] button[aria-expanded]', '');
    let folded = null;
    if (fold) {
      await click(session, fold);
      folded = await evaluate(session, readCard);
    }
    // La riga della DIFESA, e con un ripiego perche' un banco che va in eccezione non riporta niente:
    // senza una sedia riconosciuta al tavolo la card non disegna nessun campetto, e li' non c'e' nessuna
    // riga da misurare.
    const pitchRow = (read) => read?.rows?.[1] ?? read?.rows?.[0] ?? null;
    const grew = pitchRow(folded) && pitchRow(card) ? pitchRow(folded).h - pitchRow(card).h : 0;
    // DA PIEGATA LA BARRA E' LA SUA FRECCIA, e la freccia non sparisce mai per scelta («un controllo che
    // sparisce e' irraggiungibile»): quello che resta sotto di lei e' un ANGOLO, ed e' un costo di tutta
    // la pagina e non di questa card - la stessa freccia copre l'angolo del blocco A6 accanto. Quindi
    // qui non si pretende lo zero: si pretende che resti un ANGOLO, e quanto sia grande si STAMPA invece
    // di lasciarlo scoprire - un banco che gira intorno a un ostacolo senza nominarlo fa sparire il fatto.
    const corner = folded?.rows.filter((row) => row.hidden > 0) ?? [];
    const wide = corner.filter((row) => row.hiddenWide > row.width / 2);
    note('piegando la barra la card si riprende il suo fondo', {
      said: folded
        ? `riga del campetto ${pitchRow(card)?.h}px -> ${pitchRow(folded)?.h}px · sotto la freccia ` +
          (corner.length ? `${corner[0].hiddenWide}px di ${corner[0].width}` : '0px')
        : 'la freccia della barra non si trova',
      problems: [
        ...(fold ? [] : ["nessuna freccia sulla barra di destra: la via d'uscita non c'e'"]),
        ...(folded && grew > 0
          ? []
          : folded
            ? ["la card non si riprende niente: la riserva e' inerte"]
            : []),
        ...wide.map(
          (row) =>
            `da piegata la barra copre ${row.hiddenWide}px dei ${row.width} di una riga: ` +
            "non e' piu' un angolo",
        ),
      ],
    });

    // 8-bis. IL DOPPIO CLICK METTE IL NOME IN ASTA, E NON APRE LA CARD (sua istruzione, 23/09/2026).
    //        Tre fatti in un gesto e si misurano tutti e tre: il lotto cambia, nessuna card si apre, e
    //        il SINGOLO click continua ad aprirla - senza l'ultimo la cura si leggerebbe come «il
    //        doppio click funziona» anche se avesse spento il click.
    const free = await evaluate(session, rowBox, false);
    if (free) await click(session, free, 2);
    const named = free ? await evaluate(session, readTable) : null;
    const taken = await evaluate(session, rowBox, true);
    if (taken) await click(session, taken, 2);
    const refused = taken ? await evaluate(session, readTable) : null;
    // ...e il singolo click, su un nome qualunque: deve aprire la card e NON toccare il lotto.
    const single = await evaluate(session, rowBox, false);
    if (single) await click(session, single, 1);
    const opened = single ? await evaluate(session, readTable) : null;
    note('doppio click = in asta, e la card non si apre', {
      said:
        `${free?.name ?? '?'} -> lotto «${(named?.lot ?? '').slice(0, 40)}», ${named?.cards ?? '?'} card · ` +
        `su uno gia' venduto (${taken?.name ?? '?'}): «${(refused?.alert ?? '').slice(0, 60)}» · ` +
        `un click solo: ${opened?.cards ?? '?'} card`,
      problems: [
        ...(free ? [] : ['nessuna riga libera raggiungibile: il gesto non si puo\' provare']),
        ...(named && free && named.lot.includes(free.name)
          ? []
          : named
            ? [`il doppio click non ha messo ${free.name} in asta`]
            : []),
        ...(named?.cards ? [`il doppio click ha aperto ${named.cards} card: doveva non aprirne`] : []),
        // Il rifiuto e' l'altra meta': un nome gia' venduto non si nomina, e la pagina DICE perche'.
        ...(taken && refused && refused.alert.includes('già di')
          ? []
          : taken
            ? ['un nome gia\' venduto e\' stato accettato in asta, o il rifiuto e\' muto']
            : []),
        ...(taken && refused && named && refused.lot === named.lot
          ? []
          : taken
            ? ['il lotto e\' cambiato su un nome che ha gia\' un padrone']
            : []),
        ...(single && opened && opened.cards === 1
          ? []
          : single
            ? [`un click solo ha aperto ${opened?.cards} card invece di una: il gesto normale e' rotto`]
            : []),
      ],
    });
    // La card aperta si chiude: i passi dopo leggono la plancia, e una card in mezzo copre delle righe.
    if (opened?.cards) await evaluate(session, () => document.querySelector('ui-player-card [aria-label*="hiudi"], ui-player-card button')?.click());
    await wait(300);

    // 9. LA ROSA VUOTA, che e' lo stato da cui la sua asta VERA comincia: il tavolo finto arriva con un
    //    terzo dell'asta giocata, e «azzera le rose» e' il tasto che si preme prima di sedersi. Li' la
    //    card deve consigliare per intero - undici posti vuoti, due nomi ciascuno, tutti diversi - e la
    //    panchina deve essere vuota invece di restare con i nomi di prima.
    const reset = await evaluate(session, boxOf, 'ui-global-options button', 'azzera le rose');
    if (reset) await click(session, reset);
    const confirmed = reset ? await clickSteady(session, '.ant-popover button', 'Azzera') : null;
    await wait(500);
    const bare = confirmed ? await evaluate(session, readCard) : null;
    const barePlaces = bare?.rows.flatMap((row) => row.places) ?? [];
    const bareHints = barePlaces.flatMap((place) => place.hints.map((one) => one.name));
    note('a rose azzerate la card consiglia undici posti su undici', {
      said: bare
        ? `${barePlaces.filter((p) => !p.man).length} posti vuoti · ${bareHints.length} suggerimenti · ` +
          `${new Set(bareHints).size} distinti · panchina ${bare.bench.length}`
        : 'azzeramento non riuscito',
      problems: [
        ...(reset
          ? []
          : ["non c'e' nessun tasto «azzera le rose»: lo stato vuoto non si puo' provare"]),
        ...(bare && barePlaces.every((place) => !place.man)
          ? []
          : bare
            ? ["dopo l'azzeramento il campetto schiera ancora qualcuno"]
            : []),
        ...(bare && bare.bench.length ? ["dopo l'azzeramento la panchina non e' vuota"] : []),
        ...(bare && bareHints.length === barePlaces.length * 2
          ? []
          : bare
            ? [
                `${bareHints.length} suggerimenti invece dei ${barePlaces.length * 2} che 11 posti vuoti chiedono`,
              ]
            : []),
        ...(new Set(bareHints).size === bareHints.length
          ? []
          : ["a rose azzerate lo stesso uomo e' consigliato su piu' posti"]),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'plancia-squad.png');
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
