/**
 * e2e-plancia-injury.mjs - guidare la VERA plancia e misurare il riprezzo di chi rientra.
 *
 * Richiesta dell'operatore (04/09/2026): «in base alla data di ritorno ricalcola le partite attese e
 * di conseguenza anche la massima offerta», piu' «non mostrare anche l'icona "La stampa lo da'
 * indisponibile", e' ridondante». Sono due affermazioni sullo SCHERMO e nessun test unitario le puo'
 * provare: la prima e' un numero che deve arrivare fino alla card, la seconda e' quante icone si
 * vedono su una riga.
 *
 * L'ARITMETICA SI CONTROLLA CONTRO IL BUNDLE e non contro una copia sua, come fa il banco dei
 * portieri: l'arnese legge `injuries` e `calendar.json` DALLO STESSO server da cui li legge la
 * pagina, ricalcola quante giornate del club cadono dopo la data di rientro, e confronta con quello
 * che la card dice. Un banco che ricalcola dalla propria fixture non prova niente sulla pagina.
 *
 * E L'UOMO SI SCEGLIE DAL BUNDLE, mai da una lista scritta a mano: un nome fisso morirebbe alla
 * prossima guarigione e il banco leggerebbe «nessun problema» dopo aver guardato niente.
 *
 * Zero dipendenze come gli altri: serve `dist/`, lancia Edge o Chrome headless, CDP.
 *
 * Uso: node scripts/e2e-plancia-injury.mjs [--headed] [--json] [--shot] [--who Yildiz]
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
  await wait(300);
}

/** A REAL hover, and nothing else: a popover appears on the pointer, not on a click. */
async function hover(session, point) {
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round(point.x), y: Math.round(point.y), button: 'none',
  });
  await wait(500);
}

/**
 * Click a target that has STOPPED MOVING. An antd modal enters with a zoom animation, so for ~200ms
 * its own buttons are somewhere else than where they were measured (app/CLAUDE.md, 27/08/2026).
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
 * La riga di un uomo sulla plancia: dove sta, quante icone porta, e se e' barrata.
 *
 * Le icone si contano sugli ELEMENTI che il componente disegna e non sul testo: un marchio e'
 * un'icona, e contare parole leggerebbe zero e accuserebbe la regola sbagliata. Il taglio si legge
 * da `text-decoration-line` COMPUTATO, perche' e' una classe che potrebbe esserci e non dipingere.
 */
function readRow(name) {
  const rows = [...document.querySelectorAll('plancia-slot-matrix button')];
  const found = rows.find((one) => (one.innerText ?? '').toLowerCase().includes(name.toLowerCase()));
  if (!found) return null;
  const rect = found.getBoundingClientRect();
  const style = getComputedStyle(found);
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const under = document.elementFromPoint(x, y);
  return {
    text: (found.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    x,
    y,
    reachable: found.contains(under) || under === found,
    // I marchi di `ui-flags`, uno per uno con il loro titolo: e' la lista che deve accorciarsi di
    // uno, e sapere QUALE se ne va vale piu' del totale.
    flags: [...found.querySelectorAll('ui-flags [nz-tooltip], ui-flags [title]')].map((one) =>
      (one.getAttribute('nztooltiptitle') ?? one.getAttribute('title') ?? '').slice(0, 70),
    ),
    icons: found.querySelectorAll('ui-flags .anticon, ui-flags svg').length,
    struck: style.textDecorationLine.includes('line-through'),
  };
}

/**
 * IL BLOCCO CORTO: quanti uomini la plancia NON disegna, e dove chiederglielo.
 *
 * La pastiglia «N fuori lista» in barra e- stata togliuta su istruzione dell-operatore (04/09/2026:
 * «queste due etichette non servono») e la frase e- rimasta dove la domanda si fa: nel tooltip del
 * blocco che ha una riga in meno. Quindi il conto si legge dall-ARITMETICA del blocco - `teams` meno le
 * righe disegnate - e la frase aprendo quel tooltip, che e- un binding di PROPRIETA- e non un attributo.
 *
 * Si cerca il blocco piu- corto e non un nome: quale slot resti corto dipende da chi e- infortunato
 * oggi, e una scelta scritta a mano qui invecchierebbe al primo cambio di stagione.
 */
function shortBlocks(teams) {
  return [...document.querySelectorAll('plancia-slot-matrix .grid > div')]
    .filter((one) => one.querySelector('button'))
    .map((block) => {
      const header = block.firstElementChild;
      const rect = header.getBoundingClientRect();
      return {
        id: (header.querySelector('span')?.innerText ?? '?').trim(),
        rows: block.querySelectorAll('button').length,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    })
    .filter((block) => block.rows < teams);
}

/**
 * Il testo del tooltip APERTO.
 *
 * Non si legge da un attributo: con `[nzTooltipTitle]` il titolo e' un binding di PROPRIETA' e nel
 * DOM non c'e' nessun attributo da leggere - il primo tentativo leggeva `null` e accusava la pastiglia
 * di non dire chi, mentre lo dice a chiunque ci passi sopra. Un tooltip si verifica aprendolo.
 */
function readTooltip() {
  const inner = document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden) .ant-tooltip-inner');
  return inner ? (inner.innerText ?? '').replace(/\s+/g, ' ').trim() : null;
}

/** La card aperta: le partite attese, la max offerta e la nota rossa in cima. */
function readCard() {
  const card = document.querySelector('plancia-man-card');
  if (!card) return null;
  const text = (card.innerText ?? '').replace(/\s+/g, ' ').trim();
  const attese = text.match(/partite attese\s+([\d.,]+)\s*su\s*(\d+)/i);
  const offerta = text.match(/max offerta\s+([\d.,]+)[^\d]{1,3}([\d.,]+)\s*cr/i);
  return {
    text: text.slice(0, 500),
    attese: attese ? Number(attese[1].replace(',', '.')) : null,
    calendario: attese ? Number(attese[2]) : null,
    offertaLow: offerta ? Number(offerta[1]) : null,
    offertaHigh: offerta ? Number(offerta[2]) : null,
    // LE DUE DATE E IL CONTO, letti dal testo della card e non da una classe.
    //
    // Prima li cercavo con `.text-danger`, cioe' col COLORE: leggeva vuoto su una card che la nota ce
    // l'aveva eccome (si vede in `text`), e l'arnese ha accusato la pagina di non dire una cosa che
    // dice. Il colore e' una proprieta' del tema, il TESTO e' quello che l'operatore legge - e quello
    // che il passo sta verificando e' il testo.
    // Chi lo dice sta nella frase, perche' le fonti sono DUE: la stampa quotidiana e l'archivio.
    dichiarata:
      (text.match(/(?:La stampa di oggi dice|L'archivio infortuni dice|La fonte dice) (\d{2}\/\d{2}\/\d{4})/) ??
        [])[1] ?? null,
    fonte: /La stampa di oggi dice/.test(text)
      ? 'press'
      : /L'archivio infortuni dice/.test(text)
        ? 'file'
        : null,
    prudente: (text.match(/rientro stimato il (\d{2}\/\d{2}\/\d{4})/) ?? [])[1] ?? null,
    perde: Number((text.match(/Perde (\d+) giornate/) ?? [])[1] ?? NaN),
    giocate: Number((text.match(/quindi ne gioca (\d+)/) ?? [])[1] ?? NaN),
  };
}

// ------------------------------------------------------------------ la corsa

/** Le giornate che un club gioca da `today` in poi, e quante di quelle cadono dopo il rientro. */
function countRounds(calendar, clubName, today, until) {
  for (const league of Object.values(calendar.leagues ?? {})) {
    const club = league.clubs.find((one) => one.name === clubName);
    if (!club) continue;
    const dates = league.matches
      .filter((match) => match[2] === club.key || match[3] === club.key)
      .map((match) => match[1]);
    const remaining = dates.filter((date) => date >= today);
    const playable = remaining.filter((date) => date >= until);
    return {
      league: league === calendar.leagues.serie_a ? 'serie_a' : 'altro',
      remaining: remaining.length,
      playable: playable.length,
      lost: remaining.length - playable.length,
    };
  }
  return null;
}

async function gz(url) {
  const { gunzipSync } = await import('node:zlib');
  const body = await (await fetch(url)).arrayBuffer();
  return JSON.parse(gunzipSync(Buffer.from(body)).toString('utf-8'));
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-injury-'));
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
    console.log(`- ${step}: ${detail.said ?? ''}`);
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
    await wait(3000);

    // 0. IL BUNDLE CHE LA PAGINA STA LEGGENDO. Le date di rientro stanno in `injuries` e le giornate
    //    in `calendar.json`: si leggono dallo STESSO server della pagina, o il banco confronterebbe
    //    lo schermo con una copia dei dati invece che con i dati.
    const base = `http://127.0.0.1:${port}/data`;
    const calendar = await (await fetch(`${base}/calendar.json`)).json();
    const injuries = await gz(`${base}/injuries.json.gz`);
    // LA SECONDA FONTE DELLA DATA (04/09/2026): la prosa degli indisponibili, parsata nel toolkit. Il
    // banco deve conoscerle entrambe, o accusa la card di attribuire alla fonte una data che la fonte
    // dice davvero - solo l'altra.
    const availability = await gz(`${base}/availability.json.gz`);
    const players = await gz(`${base}/players.json.gz`);
    const rosters = await gz(`${base}/rosters.json.gz`);
    // IL FOGLIO che la plancia sta prezzando: le presenze PIENE, quelle che il riprezzo deve ridurre.
    const sheet = await gz(`${base}/sheets/leghe.json.gz`);
    const sheetPv = new Map(
      sheet.rows.map((row) => [
        row[sheet.columns.indexOf('fc_id')],
        row[sheet.columns.indexOf('engine_pv_pred')] ?? row[sheet.columns.indexOf('est_pv')],
      ]),
    );
    const clubs = await gz(`${base}/clubs.json.gz`);
    // IL GIORNO LO DICHIARA LA PAGINA. Il processo del banco e quel browser possono stare su due
    // date diverse (`toISOString` e- UTC), e allora il conto sarebbe fatto su un calendario di un
    // giorno diverso da quello che lo schermo sta mostrando: si chiede a lui, in ora locale.
    const today = await evaluate(session, () => new Date().toLocaleDateString('sv'));
    const at = (name) => injuries.columns.indexOf(name);
    const open = injuries.rows.filter(
      (row) => row[at('start_date')] <= today && (row[at('end_date')] ?? '9999') > today,
    );
    const dated = open.filter((row) => row[at('end_date')]);
    note('il bundle', {
      said:
        `${injuries.rows.length} spell - ${open.length} aperti oggi (${today}), ` +
        `${dated.length} con una data di rientro`,
      problems: dated.length
        ? []
        : ['nessuno spell aperto porta una data: non c-e- niente da riprezzare'],
    });

    // 1. L'UOMO, scelto dal BUNDLE e non da una lista scritta a mano: un nome fisso morirebbe alla
    //    prossima guarigione e il banco leggerebbe «nessun problema» dopo aver guardato niente.
    const nameAt = players.columns.indexOf('canonical_name');
    const idAt = players.columns.indexOf('fc_id');
    const nameById = new Map(players.rows.map((row) => [row[idAt], row[nameAt]]));
    const wanted = value('--who', null);
    const candidates = dated
      .map((row) => ({
        id: row[at('fc_id')],
        name: nameById.get(row[at('fc_id')]),
        until: row[at('end_date')],
        detail: row[at('detail')],
      }))
      .filter((one) => one.name && (!wanted || one.name.toLowerCase().includes(wanted.toLowerCase())))
      .sort((left, right) => right.until.localeCompare(left.until));

    let measured = null;
    for (const candidate of candidates.slice(0, 40)) {
      const row = await evaluate(session, readRow, candidate.name);
      if (row) {
        measured = { ...candidate, row };
        break;
      }
    }
    if (!measured) {
      note('l-uomo', {
        said: '-',
        problems: ['nessun infortunato con data di rientro sta sul tabellone'],
      });
      throw new Error('niente da misurare');
    }

    // IL CLUB SI LEGGE DAL BUNDLE e non dal testo della riga: la riga porta il nome e due numeri e
    // basta, quindi cercarci dentro un club risponde SEMPRE «non lo conosco» - un banco che accusa la
    // pagina del proprio difetto. Il join e- quello del bundle: fc_id -> fc_club_id -> nome canonico.
    const clubOf = (id) => {
      const rosterId = rosters.columns.indexOf('fc_id');
      const rosterClub = rosters.columns.indexOf('fc_club_id');
      const rosterSeason = rosters.columns.indexOf('season');
      const seasons = rosters.rows.filter((row) => row[rosterId] === id);
      const latest = seasons.sort((left, right) =>
        String(left[rosterSeason]).localeCompare(String(right[rosterSeason]))).at(-1);
      if (!latest) return null;
      const clubId = clubs.columns.indexOf('fc_club_id');
      const clubName_ = clubs.columns.indexOf('canonical_name');
      return clubs.rows.find((row) => row[clubId] === latest[rosterClub])?.[clubName_] ?? null;
    };
    const clubName = clubOf(measured.id);

    note('l-uomo', {
      said:
        `${measured.name} (${clubName ?? '?'}), rientro ${measured.until} - riga ` +
        `«${measured.row.text}» - ${measured.row.flags.length} marchi, barrata ${measured.row.struck}`,
      flags: measured.row.flags,
      problems: [
        ...(measured.row.reachable
          ? []
          : ['la riga esiste nel DOM ma qualcosa la copre sullo schermo']),
        // IL BARRATO ORA DICE UN'ALTRA COSA, e questa asserzione e' stata girata invece di cancellata
        // (04/09/2026, sua istruzione: «lo stile barrato utilizziamolo per gli infortunati di lunga
        // data»). Prima diceva «oggi non gioca» - un vincolo - e allora non poteva stare su un uomo
        // gia' riprezzato, o lo stesso fatto lo puniva due volte. Ora dice «infortunio aperto da 45
        // giorni o piu'», che NON sposta e NON riprezza niente: e' un'etichetta di taglia, e questo
        // uomo - fuori da mesi con un rientro a data - e' esattamente chi deve portarla. Quindi il
        // difetto ora sarebbe il contrario, e si asserisce quello.
        ...(measured.row.struck
          ? []
          : [
              'la riga NON e- barrata: e- un infortunio lungo con una data, cioe- esattamente il ' +
                'fatto che il barrato dice da oggi',
            ]),
        // LA DEDUPLICA CHIESTA: due marchi per una notizia sola.
        ...(measured.row.flags.some((one) => /stampa lo d/i.test(one)) &&
        measured.row.flags.some((one) => /nfortunio lungo/i.test(one))
          ? ['la riga porta SIA «la stampa lo da- indisponibile» SIA «infortunio lungo in corso»']
          : []),
        ...(clubName ? [] : ['il calendario non conosce il suo club: il conto non e- verificabile']),
      ],
    });

    // 2. LA CARD, e il numero che deve essere cambiato - confrontato con il conto fatto sul bundle.
    await click(session, { x: measured.row.x, y: measured.row.y });
    const card = await waitFor(session, readCard);
    // LE PRESENZE PIENE VENGONO DAL FOGLIO, non dalla card. La prima versione le ricavava dividendo
    // il numero a schermo per la quota - cioe- confrontava la card con se stessa e sarebbe passata
    // qualunque cosa mostrasse. E- il difetto che questo progetto si e- gia- scritto (un audit che
    // STAMPA il numero atteso accanto a quello dello schermo senza confrontarli), commesso di nuovo.
    // IL CONTO SI FA SULLA DATA PRUDENTE, che e' quella su cui la pagina lo fa - e la si legge DALLA
    // PAGINA invece di ricalcolarla: il margine e' una costante del codice, e un arnese che se ne
    // tiene una copia misura la propria copia. Quello che si verifica qui e' che la data prudente sia
    // DOPO quella dichiarata (il margine esiste e va nel verso giusto) e che le giornate contate sul
    // calendario del bundle a partire da quella data siano quelle che la card mostra.
    const iso = (day) => (day ? day.split('/').reverse().join('-') : null);
    const prudent = card ? iso(card.prudente) : null;
    const counted = clubName && prudent ? countRounds(calendar, clubName, today, prudent) : null;
    const appliedSlip =
      prudent && measured.until
        ? (Date.parse(prudent) - Date.parse(measured.until)) /
          (Date.parse(measured.until) - Date.parse(today))
        : 0;
    // Le date che le DUE fonti dicono di lui, in formato italiano: la card deve portarne una.
    const availAt = (name) => availability.columns.indexOf(name);
    const pressReturn = availability.rows
      .filter((row) => row[availAt('fc_id')] === measured.id && row[availAt('expected_return')])
      .sort((left, right) => String(left[availAt('valid_from')]).localeCompare(String(right[availAt('valid_from')])))
      .at(-1)?.[availAt('expected_return')] ?? null;
    const declaredDates = [measured.until, pressReturn]
      .filter(Boolean)
      .map((one) => one.split('-').reverse().join('/'));
    const pv = sheetPv.get(measured.id);
    const atteso = pv != null && counted && counted.remaining > 0
      ? (pv * counted.playable) / counted.remaining
      : null;
    note('la card', {
      said: card
        ? `partite attese ${card.attese} su ${card.calendario} - max offerta ` +
          `${card.offertaLow}-${card.offertaHigh} cr` +
          (counted
            ? ` - il foglio ne dice ${pv} piene, il calendario ${counted.playable} giocabili su ` +
              `${counted.remaining} (perde ${counted.lost}): attese ${atteso?.toFixed(1)}`
            : '')
        : '-',
      nota: card?.nota ?? null,
      problems: [
        // IL NUMERO A SCHERMO E- IL CONTO DEL BUNDLE, ed e- l-unica asserzione che prova la feature:
        // le presenze piene del foglio moltiplicate per le giornate giocabili sulle rimaste. Si
        // confronta a meno di mezza unita- perche- la card arrotonda.
        // DAL 04/09/2026 IL NUMERO E- ANCHE ASSICURATO (`core/expected-play.ts`), quindi il conto del
        // bundle e- un TETTO e non un-uguaglianza: la finestra dice quello che perde di sicuro,
        // l-assicurazione toglie ancora - e mai aggiunge. Ricalcolare qui anche quella meta- sarebbe
        // confrontare la pagina con una seconda copia della sua stessa aritmetica.
        ...(card && atteso != null && card.attese > atteso + 0.51
          ? [`la card dice ${card.attese} e il tetto del foglio piu- il calendario e- ` +
             `${atteso.toFixed(1)} (${pv} presenze piene x ${counted.playable}/${counted.remaining}): ` +
             `l-assicurazione non aggiunge giornate`]
          : []),
        ...(atteso == null ? ['il foglio non prezza le sue presenze: il conto non e- verificabile'] : []),
        ...(card ? [] : ['il click non ha aperto la card: non c-e- niente da leggere']),
        // LA RAGIONE STA A SCHERMO: una riduzione muta si legge come un difetto.
        ...(card && !card.prudente
          ? ['la card non dice PERCHE- i numeri sono ridotti']
          : []),
        // LE DUE DATE, e il margine nel verso giusto: una sola direbbe una bugia in un senso o
        // nell-altro, e un margine che ANTICIPA il rientro sarebbe il difetto peggiore di tutti.
        ...(card && card.dichiarata && !declaredDates.includes(card.dichiarata)
          ? [`la card attribuisce a ${card.fonte ?? 'una fonte'} il ${card.dichiarata}, e nel bundle `
             + `le due fonti dicono ${declaredDates.join(' / ') || 'niente'}`]
          : []),
        // E LA FRASE DEVE DIRE QUALE DELLE DUE: con due fonti, «la fonte dice» non dice niente.
        ...(card && card.dichiarata && !card.fonte
          ? ['la card non dice QUALE delle due fonti ha dato la data']
          : []),
        ...(card && card.prudente && prudent && prudent < measured.until
          ? ['la data prudente ANTICIPA quella dichiarata: il margine va nel verso sbagliato']
          : []),
        ...(card && counted && card.perde !== counted.lost
          ? [`la card dice che perde ${card.perde} giornate, il calendario ne conta ${counted.lost}`]
          : []),
      ],
    });

    report.man = measured.name;
    report.club = clubName;
    report.until = measured.until;
    report.card = card;
    report.counted = counted;

    // 3. IL CONFRONTO. Un uomo SANO dello stesso ruolo si legge sulla stessa card: se le presenze
    //    attese di chi rientra a novembre non sono piu- basse delle sue, il riprezzo non e- arrivato
    //    fino allo schermo - ed e- il solo modo di distinguerlo da un numero che non e- cambiato.
    if (card) {
      const healthy = await evaluate(
        session,
        (skip) => {
          const rows = [...document.querySelectorAll('plancia-slot-matrix button')];
          const found = rows.find(
            (one) =>
              !(one.innerText ?? '').toLowerCase().includes(skip.toLowerCase()) &&
              !one.querySelector('ui-flags .anticon'),
          );
          if (!found) return null;
          const rect = found.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            text: (found.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 50),
          };
        },
        measured.name,
      );
      if (healthy) {
        // La card aperta va CHIUSA prima, e col suo BOTTONE: senza, il click sulla riga nuova lascia
        // in piedi la vecchia e il banco rilegge gli stessi numeri credendo di leggerne altri -
        // «zero differenze» detto da uno strumento che non ha guardato. Escape non la chiude (non e-
        // una modale antd, e- un pannello trascinabile con la sua crocetta), e provarci e- stato
        // esattamente il modo di scoprirlo.
        const shut = await evaluate(session, () => {
          const button = document.querySelector('plancia-man-card [aria-label="chiudi"]');
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        if (shut) await click(session, shut);
        await wait(400);
        await click(session, { x: healthy.x, y: healthy.y });
        await wait(400);
        const other = await waitFor(session, readCard);
        note('il confronto', {
          said: `${healthy.text} - partite attese ${other?.attese} su ${other?.calendario}`,
          problems: [
            ...(other && card.calendario !== other.calendario
              ? ['due uomini leggono due calendari diversi: il denominatore non e- lo stesso']
              : []),
            // E IL CONFRONTO SI ASSERISCE, o due numeri stampati accanto sono un banco che risponde
            // «nessun problema» dopo aver guardato senza confrontare (03/09/2026, stessa famiglia).
            ...(other && other.attese === card.attese
              ? ['l-uomo sano e quello che rientra leggono le STESSE presenze: la card non e- cambiata']
              : []),
          ],
        });
        report.healthy = { ...healthy, card: other };
      }
    }

    // 4. CHI LA PLANCIA NON DISEGNA. Il conto sullo schermo contro il conto sul bundle: chi, con la
    //    data prudente, giocherebbe meno della soglia dichiarata. La soglia si legge dalla PAGINA
    //    (la frase la porta) invece di tenerne una copia qui - e da oggi la frase sta sul BLOCCO
    //    corto e non piu- in barra, perche- la pastiglia e- stata togliuta il 04/09/2026.
    // IL CONTO LO DICE LA PAGINA, sommato sui blocchi corti invece di dedotto dalle loro altezze.
    // Due versioni sbagliate prima di questa, e la seconda spiega perche-: sulla griglia del MERCATO
    // ogni escluso resta nel suo slot - il posto non si sposta, si svuota - quindi due esclusi sono due
    // blocchi da nove e non uno da otto, e leggere il piu- corto ne contava uno (un massimo non e- un
    // conteggio). Poi l-esenzione per l-ultimo blocco di un ruolo, messa perche- quello puo- essere
    // corto per la dimensione del listone, ne nascondeva un altro. La forma che regge non deduce
    // niente: apre il tooltip di ogni blocco corto e somma il numero che il blocco DICE.
    const shorts = (await evaluate(session, shortBlocks, 10)) ?? [];
    const chip = { count: 0, id: shorts.map((one) => one.id).join('+') || null, note: null };
    for (const block of shorts) {
      await hover(session, { x: 800, y: 980 });
      await hover(session, { x: block.x, y: block.y });
      const said = await waitFor(session, readTooltip, 8);
      const declared = Number((said?.match(/(\d+) fuori lista/) ?? [])[1] ?? 0);
      chip.count += declared;
      if (declared && !chip.note) chip.note = said;
    }
    const floor = Number((chip.note?.match(/meno del (\d+)%/) ?? [])[1] ?? NaN) / 100;
    // NESSUNA RIGA DISEGNATA E- DI UN UOMO SOTTO LA SOGLIA: e- la regola detta dal lato dello
    // SCHERMO, e non ha bisogno di rifare a mano la divisione in slot. La prima versione contava gli
    // esclusi del bundle (18) contro quelli della pastiglia (2) e accusava la pagina: ma il bundle
    // porta gli infortuni di cinque campionati e la plancia disegna un listone solo, quindi i due
    // numeri non sono confrontabili - due popolazioni, non due risposte.
    const below = [];
    if (Number.isFinite(floor)) {
      for (const row of dated) {
        const id = row[at('fc_id')];
        if (!sheetPv.has(id)) continue;
        const club = clubOf(id);
        if (!club) continue;
        const declared = row[at('end_date')];
        const left = (Date.parse(declared) - Date.parse(today)) / 86400000;
        const until = new Date(
          Date.parse(declared) + Math.round(left * appliedSlip) * 86400000,
        ).toISOString().slice(0, 10);
        const found = countRounds(calendar, club, today, until);
        if (found && found.remaining > 0 && found.playable / found.remaining < floor) {
          below.push({ name: nameById.get(id), until });
        }
      }
    }
    const drawn = [];
    for (const one of below) {
      if (await evaluate(session, readRow, one.name)) drawn.push(one.name);
    }
    note('chi non e- in plancia', {
      said: `${chip.count} fuori lista sui blocchi ${chip.id ?? '?'} - sotto il `
        + `${Math.round(floor * 100)}% ce ne sono ${below.length} sul foglio, disegnati ${drawn.length}`,
      below: below.map((one) => one.name),
      tooltip: chip.note?.slice(0, 220) ?? null,
      problems: [
        ...(chip.count ? [] : ['nessuno e- fuori lista: la regola non sta agendo o non c-e- nessuno']),
        ...(chip.note ? [] : ['il blocco corto non dice PERCHE-, ne- chi']),
        ...(drawn.length ? [`disegnati anche se sotto la soglia: ${drawn.join(', ')}`] : []),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'e2e-plancia-injury.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      report.screenshot = where;
      console.log(`  (schermata: ${where})`);
    }

    const noise = session.noise();
    if (noise.length) note('la pagina ha urlato', { said: noise.join(' | '), problems: noise });
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
