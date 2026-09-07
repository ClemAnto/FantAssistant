/**
 * e2e-player-ruling.mjs - dichiarare un gradino di titolarita' dalla card, e MISURARE cosa si muove.
 *
 * Richiesta dell'operatore (07/09/2026): «cliccando su un calciatore, nella card di dettaglio, fosse
 * possibile cliccare sulla riga "titolarita" e impostare la mia indicazione ... dovrebbe aggiornarsi il
 * campetto nella pagina squadre, il numero di partite attese, il surplus, lo swing e tutti i valori
 * derivati». Sono quattro affermazioni sullo SCHERMO e nessun test unitario le puo' provare: che il
 * click apra il selettore, che la parola cambi, che i numeri della riga la seguano, e che il CAMPETTO
 * di un club vero rimetta l'uomo in campo.
 *
 * TUTTO SULLA VISTA SQUADRE, che e' il flusso vero: la' il campetto, la card e la tabella dei numeri
 * stanno sulla stessa pagina, quindi le tre conseguenze si leggono senza cambiare schermata - e una
 * navigazione in mezzo e' esattamente il posto in cui un banco attribuisce un difetto alla pagina
 * sbagliata.
 *
 * IL GESTO SI VERIFICA CON UN PUNTATORE VERO, alle coordinate che il browser dichiara: `element.click()`
 * passa sopra la CSS e proverebbe soltanto che il DOM ha un bottone (regola di casa, 20/08/2026).
 *
 * IL CONFRONTO E' COL FOGLIO e mai con lo schermo. Le giornate che una parola comporta si ricalcolano
 * QUI dal `.json.gz` del motore - la mediana di `desc_titolarita_play` dentro ogni gradino - e si
 * confrontano con quello che il selettore stampa: ricavare l'atteso dalla pastiglia sarebbe
 * l'asserzione circolare che questo progetto ha gia' pagato (04/09/2026).
 *
 * L'UOMO SI SCEGLIE DAI DATI e mai da una lista scritta a mano: serve un BALLOTTAGGIO che la board
 * disegna sotto un titolare e che il foglio NON chiama titolare, cioe' l'unico caso in cui la
 * dichiarazione ha qualcosa da muovere sia sul disegno sia sui numeri. Un nome inciso qui sarebbe un
 * banco che alla prossima esportazione legge «nessun problema» dopo aver guardato niente.
 *
 * Zero dipendenze come gli altri: serve `dist/`, lancia Edge o Chrome headless, CDP.
 *
 * Uso: node scripts/e2e-player-ruling.mjs [--headed] [--json] [--shot]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
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
/** Le sei parole della scala, dalla piu' forte alla piu' debole (`core/titolarita.ts`). */
const LADDER = ['bandiera', 'titolarissimo', 'titolare', 'ballottaggio', 'panchina', 'riserva'];
/** I tre gradini che PRETENDONO l'undici (`core/player-rulings.ts`, `BOARD_EFFECT`). */
const STARTER_RUNGS = new Set(['bandiera', 'titolarissimo', 'titolare']);

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

/** Una tabella del bundle, letta dallo STESSO server da cui la legge la pagina. */
async function gz(url) {
  const body = Buffer.from(await (await fetch(url)).arrayBuffer());
  return JSON.parse(gunzipSync(body).toString('utf-8'));
}

async function attach(port) {
  let list;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((one) => one.type === 'page')) break;
    } catch {
      /* il browser sta ancora aprendo */
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

/** UN PUNTATORE VERO: prima l'hover, poi premi e rilascia dove il browser dice che sta il bersaglio. */
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
  await wait(400);
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

// ------------------------------------------------------------------ quello che gira NELLA pagina

/**
 * IL CAMPETTO: chi e' disegnato, se e' il TITOLARE del suo posto, e la sigla della dritta.
 *
 * Un posto e' un item con il titolare in cima e i ballottaggi sotto, quindi «e' titolare» si legge
 * dalla POSIZIONE dentro il suo item e non dal grassetto - un peso di carattere e' una proprieta' del
 * tema, e leggerlo vorrebbe dire far dipendere il verdetto da una scelta di stile.
 */
function readPitch() {
  const board = document.querySelector('ui-club-board');
  if (!board) return null;
  const men = [];
  // UN ITEM E' UN POSTO (`data-place`), e dentro di lui l'ORDINE e' la gerarchia: il titolare per
  // primo, i ballottaggi sotto. Si legge il posto e non un antenato indovinato: la prima versione
  // saliva di due `parentElement` e finiva sull'intera RIGA, quindi «e' il primo del suo posto»
  // rispondeva a un'altra domanda - e accusava la pagina di non aver fatto lo scambio.
  for (const place of board.querySelectorAll('[data-place]')) {
    const names = [...place.querySelectorAll('span.truncate')];
    names.forEach((one, index) => {
      const holder = one.parentElement;
      const rect = one.getBoundingClientRect();
      men.push({
        name: (one.textContent ?? '').trim(),
        first: index === 0,
        item: names.map((other) => (other.textContent ?? '').trim()),
        // IL MARCHIO E' IL PALLINO (`ui-ruling-dot`), letto dal suo HOOK e non dal colore: un
        // inchiostro e' una proprieta' del tema, e leggerlo farebbe dipendere il verdetto da una
        // scelta di stile - e da un `color-mix` che Chrome computa in un formato suo (04/09/2026).
        dot: !!holder?.querySelector('[data-ruling-dot]'),
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    });
  }
  return {
    men,
    places: board.querySelectorAll('[data-place]').length,
    said: (board.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
  };
}

/** La riga della TABELLA per un uomo: le celle sotto le intestazioni che ci interessano. */
function readTableRow(name, wanted) {
  const table = document.querySelector('ui-squad-table table');
  if (!table) return null;
  const heads = [...table.querySelectorAll('thead th')].map((one) => (one.innerText ?? '').trim());
  const row = [...table.querySelectorAll('tbody tr')].find(
    (one) => (one.children[heads.indexOf('Nome')]?.textContent ?? '').trim() === name,
  ) ?? [...table.querySelectorAll('tbody tr')].find((one) => (one.innerText ?? '').includes(name));
  if (!row) return null;
  const out = {};
  for (const label of wanted) {
    const at = heads.indexOf(label);
    out[label] = at >= 0 ? (row.children[at]?.textContent ?? '').trim() : null;
  }
  return { heads, cells: out };
}

/** La card aperta: il nome, la parola della titolarita', il bersaglio e le partite attese. */
function readCard() {
  const card = document.querySelector('ui-player-card');
  if (!card) return null;
  const boxes = [...card.querySelectorAll('div.rounded')].map((one) => ({
    label: one.querySelector('div')?.textContent?.trim() ?? '',
    text: (one.innerText ?? '').replace(/\s+/g, ' ').trim(),
  }));
  const expected = boxes.find((one) => one.label.startsWith('partite attese'));
  const rows = [...card.querySelectorAll('dt')];
  const row = rows.find((one) => (one.textContent ?? '').trim() === 'titolarità');
  const button = row?.nextElementSibling?.querySelector('button') ?? null;
  const rect = button?.getBoundingClientRect();
  return {
    who: card.querySelector('[data-player]')?.getAttribute('data-player') ?? null,
    expectedText: expected?.text ?? null,
    // Il numero, non la frase: «29 su 36» e «30 su 36» differiscono di una cifra e un confronto di
    // stringhe non dice di quanto.
    expected: Number((String(expected?.text ?? '').match(/(\d+(?:[.,]\d+)?)/) ?? [])[1]?.replace(',', '.')),
    word: button ? (button.innerText ?? '').replace(/\s+/g, ' ').trim() : null,
    // I MINUTI ATTESI: l'ALTRO asse della parola, e la riga che deve seguirla (operatore, 08/09/2026).
    minutes: (() => {
      const row = rows.find((one) => (one.textContent ?? '').trim() === 'minuti attesi');
      const found = (row?.nextElementSibling?.textContent ?? '').match(/(\d+)/);
      return found ? Number(found[1]) : null;
    })(),
    // LO SWING (operatore, 07/09/2026): la riga della lista, letta dalla sua etichetta e non dalla
    // posizione - una riga nuova nella `dl` cambierebbe il significato di un indice.
    swing: (() => {
      const swing = rows.find((one) => (one.textContent ?? '').trim() === 'SWING');
      const text = swing?.nextElementSibling?.textContent?.trim() ?? '';
      const found = text.match(/(-?\d+(?:[.,]\d+)?)/);
      return found ? Number(found[1].replace(',', '.')) : null;
    })(),
    target: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
  };
}

/** Il selettore aperto: le sei parole con le giornate che ognuna comporta, e dove cliccare. */
function readChoices() {
  const card = document.querySelector('ui-player-card');
  const panel = card?.querySelector('.border-border.bg-page\\/60');
  if (!panel) return null;
  return [...panel.querySelectorAll('button')].map((one) => {
    const rect = one.getBoundingClientRect();
    const cells = [...one.children].map((cell) => (cell.textContent ?? '').trim());
    // LA TERZA CELLA PORTA I DUE NUMERI DEL GRADINO («34.8 gg · 80′»): si estraggono separati, perché
    // un confronto sulla stringa intera non dice di QUANTO sbaglia - e sono due promesse diverse.
    const numbers = cells[2] ?? '';
    return {
      text: (one.innerText ?? '').replace(/\s+/g, ' ').trim(),
      rung: cells[1] ?? null,
      days: (numbers.match(/(\d+(?:\.\d+)?)\s*gg/) ?? [])[1] ?? null,
      minutes: (numbers.match(/(\d+)\s*[′']/) ?? [])[1] ?? null,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
}

// ------------------------------------------------------------------ il banco

/** La mediana di una lista non vuota, la stessa definizione di `core/player-rulings.ts`. */
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * L'ORDINE DELLA SCALA E' UNA DICHIARAZIONE, quindi la conversione lo rispetta: si muove solo il
 * gradino che lo contraddice, in mezzo ai suoi vicini misurati (`orderedShares`).
 *
 * Ricalcolato QUI dalle mediane grezze e non letto dall'app: il banco confronta lo schermo con quello
 * che la REGOLA dice del dato, non con quello che l'app ha calcolato - leggere il numero dall'app
 * sarebbe l'asserzione circolare.
 */
function ordered(measured) {
  const out = new Map([...measured].map(([rung, values]) => [rung, { ...values }]));
  for (const axis of ['play', 'minutes']) {
    for (let pass = 0; pass < LADDER.length; pass += 1) {
      let moved = false;
      const seats = LADDER
        .map((rung) => ({ rung, value: out.get(rung)?.[axis] ?? null }))
        .filter((one) => one.value != null);
      for (let index = 0; index < seats.length - 1; index += 1) {
        // Solo un'INVERSIONE si ripara, non un pareggio: sui minuti `bandiera` e `titolarissimo`
        // pareggiano davvero, perche' condividono il pavimento dei 75' e si separano sulla quota.
        if (seats[index].value >= seats[index + 1].value) continue;
        const above = index > 0 ? seats[index - 1].value : null;
        out.get(seats[index].rung)[axis] = above == null
          ? seats[index + 1].value
          : (seats[index + 1].value + above) / 2;
        moved = true;
      }
      if (!moved) break;
    }
  }
  return out;
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-ruling-'));
  const debugPort = Number(value('--port', String(await freePort())));
  const base = `http://127.0.0.1:${port}/data`;

  // ---------------------------------------------------------------- 0. il foglio e la board, fuori dall'app
  const manifest = await (await fetch(`${base}/manifest.json`)).json();
  const sheet = (manifest.engine_sheets ?? []).find(
    (one) => one.platform === 'default' && one.game === 'classic',
  );
  if (!sheet) throw new Error('il bundle non porta il foglio default|classic');
  const table = await gz(`${base}/${sheet.path}`);
  const at = {
    id: table.columns.indexOf('fc_id'),
    rung: table.columns.indexOf('desc_titolarita'),
    play: table.columns.indexOf('desc_titolarita_play'),
    minutes: table.columns.indexOf('desc_minutes_next'),
  };
  if (at.rung < 0 || at.play < 0) throw new Error('il foglio non porta la scala della titolarità');
  const pools = new Map();
  const minutePools = new Map();
  const rungById = new Map();
  for (const row of table.rows) {
    const rung = row[at.rung];
    const play = row[at.play];
    if (row[at.id] != null) rungById.set(Number(row[at.id]), rung);
    if (!LADDER.includes(rung) || play == null) continue;
    if (!pools.has(rung)) pools.set(rung, []);
    pools.get(rung).push(Number(play));
    // I MINUTI hanno il loro denominatore: una riga con la quota e senza i minuti entra nella prima
    // mediana e non nella seconda.
    if (row[at.minutes] == null) continue;
    if (!minutePools.has(rung)) minutePools.set(rung, []);
    minutePools.get(rung).push(Number(row[at.minutes]));
  }
  const medians = new Map([...pools].map(([rung, pool]) => [rung, {
    play: median(pool),
    minutes: minutePools.get(rung)?.length ? median(minutePools.get(rung)) : null,
  }]));
  const shares = ordered(medians);
  const rounds = sheet.matchdays_target;
  const daysOf = (rung) => (shares.has(rung) ? shares.get(rung).play * rounds : null);
  const minutesOf = (rung) => shares.get(rung)?.minutes ?? null;
  const measuredDaysOf = (rung) => (medians.has(rung) ? medians.get(rung).play * rounds : null);

  // L'UOMO: un ballottaggio disegnato sotto un titolare, che il foglio non chiama titolare.
  const boards = await (await fetch(`${base}/${sheet.boards}`)).json();
  let chosen = null;
  for (const [club, board] of Object.entries(boards.clubs ?? {})) {
    if (board.error) continue;
    for (const line of ['D', 'M', 'T', 'A', 'P']) {
      for (const starter of board.lines?.[line] ?? []) {
        for (const rival of starter.duels ?? []) {
          const rung = rungById.get(Number(rival.fc_id));
          if (!rival.fc_id || STARTER_RUNGS.has(rung)) continue;
          // Un rivale con un claim sopra la soglia del campetto, o non verrebbe disegnato affatto.
          if (!(rival.claim >= 0.2)) continue;
          if (!chosen) chosen = { club, line, who: rival.name, id: Number(rival.fc_id), rung, starter: starter.name };
        }
      }
    }
  }
  if (!chosen) throw new Error('nessun ballottaggio utile sulla board: il banco non ha un caso da misurare');

  const url = `http://127.0.0.1:${port}/clubs?club=${encodeURIComponent(chosen.club)}`;
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
    console.log(`- ${step}: ${detail.said ?? ''}`);
    for (const problem of detail.problems ?? []) console.log(`    ! ${problem}`);
    if (detail.problems?.length) {
      report.problems.push(...detail.problems.map((one) => `${step}: ${one}`));
    }
  };

  note('il foglio', {
    said: `${sheet.path} · ${rounds} giornate · ${LADDER
      .map((rung) => `${rung} ${daysOf(rung) == null ? '—' : daysOf(rung).toFixed(1)}`).join(' · ')}`,
    problems: shares.size < 4
      ? [`solo ${shares.size} gradini popolati: il selettore non potrà prezzare le parole`] : [],
  });
  // DUE AFFERMAZIONI, e sono l'una la ragione dell'altra. La MISURA non rispetta l'ordine della scala
  // (`titolarissimo` e' il gradino residuo, quindi sulle presenze sta sotto `titolare`); l'ORDINE e'
  // una dichiarazione dell'operatore («titolarissimo deve essere meglio di titolare», 08/09/2026),
  // quindi la conversione che l'app prezza lo rispetta. Se la prima cadesse, il banco non starebbe piu'
  // misurando il caso che conta; se cadesse la seconda, la dichiarazione punirebbe chi la fa.
  const ladderDays = LADDER.map((rung) => daysOf(rung)).filter((one) => one != null);
  note('la misura non rispetta l’ordine della scala, e la conversione sì', {
    said: `misurato: titolarissimo ${measuredDaysOf('titolarissimo')?.toFixed(1)} contro titolare `
      + `${measuredDaysOf('titolare')?.toFixed(1)} · convertito: ${LADDER
        .map((rung) => `${rung} ${daysOf(rung) == null ? '—' : daysOf(rung).toFixed(1)}gg/`
          + `${minutesOf(rung) == null ? '—' : minutesOf(rung).toFixed(0)}′`).join(' · ')}`,
    problems: [
      ...(measuredDaysOf('titolarissimo') != null && measuredDaysOf('titolare') != null
        && measuredDaysOf('titolarissimo') < measuredDaysOf('titolare')
        ? [] : ['su questo foglio la misura è già ordinata: il banco non misura più il caso che conta']),
      ...(ladderDays.every((one, at) => at === 0 || ladderDays[at - 1] > one)
        ? [] : [`la conversione non rispetta la scala: ${ladderDays.map((one) => one.toFixed(1))}`]),
    ],
  });
  note('il caso, scelto dai dati', {
    said: `${chosen.who} (${chosen.id}, ${chosen.rung}) è ballottaggio di ${chosen.starter} `
      + `nel ${chosen.club}, linea ${chosen.line}`,
  });

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await wait(4000);

    // ------------------------------------------------------------ 1. PRIMA: il campetto e la tabella
    const pitchBefore = await waitFor(session, readPitch, 60);
    const beforeMan = pitchBefore?.men.find((one) => one.name === chosen.who);
    const rowBefore = await waitFor(session, readTableRow, 40, chosen.who,
      ['Tit.', 'P', 'Surplus', 'FMa']);
    note('prima', {
      said: `campetto: ${beforeMan ? `${chosen.who} ${beforeMan.first ? 'TITOLARE' : 'ballottaggio'}`
        : 'non disegnato'} · tabella: ${JSON.stringify(rowBefore?.cells ?? {})}`,
      problems: [
        ...(beforeMan ? [] : [`il campetto non disegna ${chosen.who}: il caso scelto non è misurabile`]),
        ...(beforeMan?.first ? ['il caso scelto è già titolare: la dichiarazione non avrebbe da muovere'] : []),
        ...(rowBefore ? [] : [`la tabella non ha una riga per ${chosen.who}`]),
      ],
    });
    if (!beforeMan) throw new Error('il caso scelto non è sul campetto');

    // ------------------------------------------------------------ 2. la card, aperta dal suo nome
    await click(session, beforeMan);
    const cardBefore = await waitFor(session, readCard, 40);
    if (!cardBefore?.target) throw new Error('la card non ha una riga «titolarità» cliccabile');
    note('card aperta dal campetto', {
      said: `id ${cardBefore.who} · titolarità «${cardBefore.word}» · ${cardBefore.expectedText}`,
      problems: String(cardBefore.who) === String(chosen.id)
        ? [] : [`la card aperta è di ${cardBefore.who} e non di ${chosen.id}`],
    });

    // ------------------------------------------------------------ 3. il selettore, con le sue giornate
    await click(session, cardBefore.target);
    const choices = await waitFor(session, readChoices, 20);
    const problems = [];
    if (!choices) problems.push('il click sulla riga non ha aperto nessun selettore');
    else {
      if (choices.filter((one) => LADDER.includes(one.rung)).length < LADDER.length) {
        problems.push(`il selettore offre ${choices.length} voci invece delle sei della scala`);
      }
      for (const rung of LADDER) {
        const shown = choices.find((one) => one.rung === rung);
        if (!shown) {
          problems.push(`manca la parola «${rung}»`);
          continue;
        }
        const days = daysOf(rung);
        const said = Number(shown.days);
        // IL CONFRONTO E' COL FOGLIO: la pastiglia deve dire quello che le mediane del suo gradino
        // comportano su questo calendario, non un numero ricavato da se stessa.
        if (days == null) {
          if (shown.days != null) problems.push(`«${rung}» non è misurabile e stampa «${shown.days}»`);
        } else if (!Number.isFinite(said) || Math.abs(said - days) > 0.15) {
          problems.push(`«${rung}»: lo schermo dice ${shown.days} gg e il foglio ${days.toFixed(1)}`);
        }
        // ...E I MINUTI, che sono l'ALTRO ASSE su cui la parola e' assegnata (operatore, 08/09/2026):
        // una pastiglia che ne mostrasse uno solo direbbe meta' di quello che il gradino promette.
        const minutes = minutesOf(rung);
        const saidMinutes = shown.minutes == null ? null : Number(shown.minutes);
        if (minutes == null) {
          if (saidMinutes != null) problems.push(`«${rung}» non ha minuti misurati e stampa ${saidMinutes}`);
        } else if (saidMinutes == null || Math.abs(saidMinutes - minutes) > 0.6) {
          problems.push(`«${rung}»: lo schermo dice ${shown.minutes}′ e il foglio ${minutes.toFixed(0)}′`);
        }
      }
    }
    note('il selettore mostra le sei parole coi DUE numeri che promettono', {
      said: (choices ?? []).map((one) => `${one.rung} ${one.days}gg/${one.minutes}′`).join(' · '),
      problems,
    });

    // ------------------------------------------------------------ 4. DICHIARARE, e leggere le tre conseguenze
    const target = (choices ?? []).find((one) => one.rung === 'titolare');
    if (!target) throw new Error('il selettore non offre «titolare»');
    await click(session, target);
    await wait(600);
    const cardAfter = await evaluate(session, readCard);
    const rowAfter = await evaluate(session, readTableRow, chosen.who, ['Tit.', 'P', 'Surplus', 'FMa']);
    const pitchAfter = await evaluate(session, readPitch);
    const afterMan = pitchAfter?.men.find((one) => one.name === chosen.who);
    const number = (text) => Number(String(text ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));

    // LA PAROLA. `innerText` la porta MAIUSCOLA («TUA» e' un `uppercase` della CSS), quindi il
    // confronto e' senza cassa: leggere il testo trasformato come se fosse quello scritto e' il modo
    // in cui questo banco si e' accusato da solo alla prima corsa.
    note('la parola sulla card è la tua dritta', {
      said: `«${cardBefore.word}» → «${cardAfter?.word}»`,
      problems: /titolare/i.test(cardAfter?.word ?? '') && /tua/i.test(cardAfter?.word ?? '')
        ? [] : ['la riga non legge il gradino dichiarato con il suo marchio'],
    });

    note('le partite attese si muovono (punto 2)', {
      said: `${cardBefore.expected} → ${cardAfter?.expected} · tabella P `
        + `${rowBefore?.cells?.P} → ${rowAfter?.cells?.P}`,
      problems: [
        ...(cardAfter?.expected > cardBefore.expected
          ? [] : [`la card legge ${cardAfter?.expected} contro ${cardBefore.expected}`]),
        ...(number(rowAfter?.cells?.P) > number(rowBefore?.cells?.P)
          ? [] : [`la tabella legge ${rowAfter?.cells?.P} contro ${rowBefore?.cells?.P}`]),
      ],
    });

    // I MINUTI DELLA CARD devono diventare quelli del gradino dichiarato: e' la meta' visibile del
    // secondo asse, e senza questo passo la riga potrebbe dire «titolare» accanto ai minuti di un
    // riservista senza che nessuno se ne accorga.
    note('i minuti attesi seguono il gradino dichiarato', {
      said: `${cardBefore.minutes}′ → ${cardAfter?.minutes}′ (il gradino promette `
        + `${minutesOf('titolare')?.toFixed(0)}′)`,
      problems: cardAfter?.minutes != null && minutesOf('titolare') != null
        && Math.abs(cardAfter.minutes - minutesOf('titolare')) <= 0.6
        ? [] : [`la card legge ${cardAfter?.minutes}′ e il gradino promette ${minutesOf('titolare')}′`],
    });

    note('lo SWING sulla card la segue', {
      said: `${cardBefore.swing} → ${cardAfter?.swing}`,
      problems: cardBefore.swing != null && cardAfter?.swing != null
        && cardAfter.swing > cardBefore.swing
        ? [] : [`la riga SWING legge ${cardBefore.swing} → ${cardAfter?.swing}`],
    });

    note('il surplus e i valori derivati la seguono (punto 3)', {
      said: `Surplus ${rowBefore?.cells?.Surplus} → ${rowAfter?.cells?.Surplus} · `
        + `Tit. ${rowBefore?.cells?.['Tit.']} → ${rowAfter?.cells?.['Tit.']} · `
        + `FMa ${rowBefore?.cells?.FMa} → ${rowAfter?.cells?.FMa}`,
      problems: [
        ...(number(rowAfter?.cells?.Surplus) > number(rowBefore?.cells?.Surplus)
          ? [] : [`il surplus non è salito: ${rowBefore?.cells?.Surplus} → ${rowAfter?.cells?.Surplus}`]),
        ...(rowAfter?.cells?.['Tit.'] === 'TIT'
          ? [] : [`la colonna della titolarità legge «${rowAfter?.cells?.['Tit.']}» invece di TIT`]),
        // IL CONTROLLO NEGATIVO: la FANTAMEDIA non deve muoversi di un decimale. Dice quanto vale UNA
        // sua partita, non quante ne gioca - un banco che verifica solo quello che DEVE cambiare non
        // distingue una dichiarazione che riprezza le presenze da una che riscrive il foglio.
        ...(rowAfter?.cells?.FMa === rowBefore?.cells?.FMa
          ? [] : [`la fantamedia si è mossa: ${rowBefore?.cells?.FMa} → ${rowAfter?.cells?.FMa}`]),
      ],
    });

    note('il campetto lo rimette in campo (punto 1)', {
      said: afterMan
        ? `${chosen.who}: ${afterMan.first ? 'TITOLARE' : 'ballottaggio'} · pallino ${afterMan.dot}`
          + ` · il suo posto: ${(afterMan.item ?? []).join(' / ')} · ${pitchAfter?.places} posti`
        : 'non disegnato',
      problems: [
        ...(afterMan?.first ? [] : ['il campetto non gli ha dato la maglia del suo posto']),
        ...(afterMan?.dot ? [] : ['il nome non porta il pallino della personalizzazione']),
        // ...e NESSUN ALTRO lo porta: un pallino su tutti e' un marchio che non marca, ed e' il modo
        // in cui un banco legge «c'e'» su una pagina che non distingue niente.
        ...((pitchAfter?.men ?? []).filter((one) => one.dot).length === 1
          ? [] : [`il pallino e' su ${(pitchAfter?.men ?? []).filter((one) => one.dot).length} nomi`]),
      ],
    });

    // ------------------------------------------------------------ 5. e la strada INDIETRO
    await click(session, cardAfter.target);
    const back = await waitFor(session, () => {
      const card = document.querySelector('ui-player-card');
      const panel = card?.querySelector('.border-border.bg-page\\/60');
      const undo = [...(panel?.querySelectorAll('button') ?? [])].find(
        (one) => (one.textContent ?? '').includes('torna al gradino'),
      );
      if (!undo) return null;
      const rect = undo.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, 20);
    if (back) await click(session, back);
    await wait(600);
    const undone = await evaluate(session, readCard);
    const pitchUndone = await evaluate(session, readPitch);
    const undoneMan = pitchUndone?.men.find((one) => one.name === chosen.who);
    note('una dichiarazione ha una strada indietro', {
      said: `«${undone?.word}» · ${undone?.expected} · campetto: `
        + `${undoneMan?.first ? 'TITOLARE' : 'ballottaggio'}`,
      problems: [
        ...(back ? [] : ['il selettore non offre il ritorno al gradino del foglio']),
        ...(undone?.expected === cardBefore.expected
          ? [] : [`le partite attese non sono tornate: ${undone?.expected} contro ${cardBefore.expected}`]),
        ...(undoneMan && !undoneMan.first ? [] : ['il campetto non è tornato al disegno del toolkit']),
      ],
    });

    // ------------------------------------------------------------ 6. la STRATEGIA: la lettura «Tit»
    //
    // Richiesta dello stesso giorno: «nella pagina strategia, aggiungi anche la possibilita' di vedere
    // la titolarita' dei calciatori». La pastiglia porta una PAROLA e non un numero, quindi quello che
    // si verifica e' che stampi la SIGLA della scala - e che sia quella DICHIARATA, non il gradino del
    // foglio: la dritta e' stata revocata al passo precedente, quindi qui si ridichiara.
    await click(session, cardAfter.target);
    const again = await waitFor(session, readChoices, 20);
    const back2 = (again ?? []).find((one) => one.rung === 'titolare');
    if (back2) await click(session, back2);
    await session.send('Page.navigate', { url: `http://127.0.0.1:${port}/strategy` });
    await wait(4000);
    const chip = await waitFor(session, () => {
      const one = [...document.querySelectorAll('button, [role="button"]')].find(
        (node) => (node.textContent ?? '').trim() === 'Tit',
      );
      if (!one) return null;
      const rect = one.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, 40);
    if (chip) await click(session, chip);
    const strategy = await waitFor(session, (name) => {
      const row = [...document.querySelectorAll('li')].find(
        (one) => (one.innerText ?? '').includes(name),
      );
      if (!row) return null;
      const cell = row.querySelector('[data-reading="titolarita"]');
      return {
        text: (row.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
        reading: cell ? (cell.textContent ?? '').trim() : null,
        dot: !!row.querySelector('[data-ruling-dot]'),
      };
    }, 40, chosen.who);
    note('la Strategia mostra la titolarita, e la parola e la TUA', {
      said: strategy
        ? `pastiglia «${strategy.reading}» · pallino ${strategy.dot} · ${strategy.text}`
        : `«${chosen.who}» non compare fra i nomi della Strategia`,
      problems: [
        ...(chip ? [] : ['la fila delle letture non offre la pastiglia «Tit»']),
        ...(strategy?.reading === 'TIT'
          ? [] : [`la pastiglia legge «${strategy?.reading}» invece della sigla dichiarata TIT`]),
        ...(strategy?.dot ? [] : ['la riga non porta il pallino della personalizzazione']),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(ROOT, 'e2e-player-ruling.png'), Buffer.from(shot.data, 'base64'));
      console.log('- screenshot: e2e-player-ruling.png');
    }

    const noise = session.noise();
    if (noise.length) {
      note('la pagina ha urlato', { said: `${noise.length} messaggi`, problems: noise });
    }
  } finally {
    session?.close();
    browser.kill();
    server.close();
  }

  if (flag('--json')) console.log(JSON.stringify(report, null, 2));
  console.log(report.problems.length ? `\nPROBLEMI: ${report.problems.length}` : '\nnessun problema');
  process.exit(report.problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
