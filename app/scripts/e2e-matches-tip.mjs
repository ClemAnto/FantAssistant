/**
 * e2e-matches-tip.mjs - guida la pagina CALCIATORI vera in modo «ultime partite» e misura le due cose
 * che l'operatore ha chiesto il 10/09/2026: i due TRIANGOLINI accanto al voto (verde chi e' subentrato,
 * rosso chi e' uscito) e il TOOLTIP come ELENCO, coi minuti dentro e le cose buone e cattive marcate
 * con effetti diversi.
 *
 * Perche' un browser e non un test unitario: `match-tip.spec.ts` prova il MODELLO - quali righe, con
 * che verso - e non puo' provare che quelle righe si vedano, che il triangolo sia disegnato dove sta il
 * voto, ne' che il verde e il rosso siano davvero due tinte diverse sullo schermo. Un tooltip si
 * verifica APRENDOLO con un puntatore vero (`[nzTooltipTitle]` non lascia nessun attributo nel DOM), e
 * un colore si confronta FRA RIGHE DELLA STESSA PAGINA e mai con un letterale: i token sono
 * `color-mix` e il tema ha due versi.
 *
 * IL CONFRONTO E' COL FOGLIO E NON CON LO SCHERMO. Il triangolo di una cella si ricava dal bundle -
 * `external_match_stats.json.gz`, unito per `(fc_id, data)` e non per nome - con la regola riscritta
 * qui fuori dall'app: dedurre il triangolo atteso dal triangolo disegnato e' l'asserzione circolare
 * che questo progetto ha gia' pagato due volte.
 *
 * Cosa misura, e ogni passo dice su quante cose ha guardato (un audit rotto risponde «zero problemi»
 * ed e' indistinguibile da una pagina pulita):
 *
 *   * QUANTI TRIANGOLI, e su quali celle: mai su una cella che dice «non c'era» (panchina, infortunio),
 *     e mai due sulla stessa cella - «entrato E uscito» non e' osservabile senza il minuto d'ingresso,
 *     quindi se comparisse sarebbe un segno inventato.
 *   * OGNI TRIANGOLO CONTRO IL BUNDLE, cella per cella: verso giusto, e nessuna cella senza triangolo
 *     dove il foglio ne vuole uno.
 *   * IL TOOLTIP E' UN ELENCO: quante voci, che ci siano i MINUTI, e che il numero dei minuti sia
 *     quello del foglio.
 *   * LE COSE BUONE E QUELLE CATTIVE HANNO EFFETTI DIVERSI: colore diverso E fondo diverso, misurati
 *     confrontando due righe dello stesso tooltip.
 *   * NESSUNA ECCEZIONE IN CONSOLE: un errore vuol dire che qualcosa non e' stato provato.
 *
 * Usage: node scripts/e2e-matches-tip.mjs [--headed] [--json]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const DATA = join(ROOT, 'public', 'data');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gz': 'application/gzip', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

/** Il confine dei 90': `match-bonuses.FULL_MATCH`, riscritto qui perche' il banco non importa l'app. */
const FULL_MATCH = 90;
/** Quante celle col triangolo si confrontano col foglio una per una. */
const SAMPLE = 8;
/**
 * LE ICONE CHE DICONO «NON C'ERA», dal vocabolario della tabella (`STATE_ICON`). `question-circle` non
 * e' fra queste ed e' il punto: «in campo, senza voto» e' una partita GIOCATA, quindi un triangolo li'
 * e' un fatto e non un segno inventato.
 */
const ABSENT_ICONS = [
  'anticon-pause-circle', 'anticon-medicine-box', 'anticon-global', 'anticon-minus-circle',
];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

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

async function devToolsPort(profile) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const line = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0];
      if (line.trim()) return Number(line.trim());
    } catch {
      /* the browser has not written it yet */
    }
    await wait(250);
  }
  throw new Error('the browser never wrote DevToolsActivePort');
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
      noise.push(`ECCEZIONE: ${detail?.exception?.description ?? detail?.text ?? '?'}`.slice(0, 200));
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      noise.push(`CONSOLE: ${message.params.args.map((one) => one.description ?? one.value).join(' ')}`
        .slice(0, 200));
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

// ------------------------------------------------------------------ il FOGLIO, letto qui

/**
 * Il livello per-partita del bundle, indicizzato per `(fc_id, data)`: e' la chiave con cui la cella si
 * dichiara nel DOM, ed e' un'IDENTITA' e non un nome.
 *
 * La regola del triangolo riscritta qui a mano - `spellOf` sta nell'app e il banco non la importa: se
 * la leggesse da la', proverebbe che la funzione e' uguale a se stessa.
 */
async function sheet() {
  const raw = JSON.parse(gunzipSync(await readFile(join(DATA, 'external_match_stats.json.gz'))));
  const at = Object.fromEntries(raw.columns.map((name, index) => [name, index]));
  const by = new Map();
  for (const row of raw.rows) {
    const started = row[at.started];
    const minutes = row[at.minutes];
    by.set(`${row[at.fc_id]}|${row[at.match_date]}`, {
      minutes,
      // «vuoto = ignoto, mai zero»: senza la distinta o senza i minuti non si disegna niente.
      on: started === 0 && minutes > 0,
      off: started === 1 && minutes > 0 && minutes < FULL_MATCH,
    });
  }
  return by;
}

/**
 * IL GRADINO DI TITOLARITA' DAL FOGLIO DEL MOTORE (`desc_titolarita`), per `fc_id`.
 *
 * E' la colonna che la tabella mostra, letta alla fonte: la pagina la prende da `ValuationStore` e
 * potrebbe scavalcarla con le DRITTE dell'operatore, che in un profilo nuovo del browser non ci sono -
 * `localStorage` e' vuoto - quindi qui foglio e schermo devono coincidere. Il giorno in cui una dritta
 * ci fosse, il banco leggerebbe una differenza e direbbe quale: e' il comportamento giusto.
 */
async function rungs() {
  const raw = JSON.parse(gunzipSync(await readFile(join(DATA, 'sheets', 'leghe.json.gz'))));
  const at = Object.fromEntries(raw.columns.map((name, index) => [name, index]));
  const by = new Map();
  for (const row of raw.rows) by.set(String(row[at.fc_id]), row[at.desc_titolarita] ?? null);
  return by;
}

// ------------------------------------------------------------------ quello che gira NELLA pagina

/**
 * LE CELLE DELLA TABELLA con quello che si vede: i triangoli disegnati (dal loro `aria-label`, che e'
 * il vocabolario del componente e non una classe), la chiave del foglio, e se la cella e' una di
 * quelle che dicono «non c'era».
 */
function cells() {
  const table = document.querySelector('ui-matches-table nz-table table');
  if (!table) return { ready: false };
  const rows = [...table.querySelectorAll('tbody tr')];
  if (!rows.length) return { ready: false };
  const out = [];
  for (const row of rows) {
    const fc = row.getAttribute('data-fc');
    for (const cell of row.querySelectorAll('span[role="button"][data-day]')) {
      const marks = [...cell.querySelectorAll('ui-spell svg')].map((one) => one.getAttribute('aria-label'));
      const rect = cell.getBoundingClientRect();
      out.push({
        fc,
        day: cell.getAttribute('data-day'),
        on: marks.includes('subentrato'),
        off: marks.includes('sostituito'),
        // L'ICONA DI STATO, quando la cella ne disegna una al posto del numero. Serve il TIPO e non la
        // sua presenza: `question-circle` vuol dire «in campo, senza voto» - una partita giocata, dove
        // un triangolo e' giusto - mentre le altre quattro dicono che non c'era, e li' sarebbe un segno
        // su una partita che non ha giocato. Letta la prima volta come «icona = non c'era», questa
        // misura accusava la pagina di un difetto dell'arnese.
        icon: (cell.querySelector(':scope > nz-icon .anticon, :scope > nz-icon')?.className || '')
          .split(' ').find((one) => one.startsWith('anticon-')) ?? null,
        text: (cell.innerText || '').trim(),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        visible: rect.width > 0 && rect.top > 60 && rect.bottom < innerHeight - 40,
      });
    }
  }
  return { ready: true, rows: rows.length, cells: out };
}

/**
 * IL TOOLTIP APERTO, letto come ELENCO: le voci, il loro colore e il loro fondo COMPUTATI - non le
 * classi, che direbbero solo che qualcuno le ha scritte.
 */
function openTip() {
  const tip = [...document.querySelectorAll('.ant-tooltip')].find(
    (one) => !one.classList.contains('ant-tooltip-hidden') && one.offsetParent !== null
      && Number(getComputedStyle(one).opacity) > 0.1,
  );
  if (!tip) return null;
  const items = [...tip.querySelectorAll('li')].map((one) => {
    const style = getComputedStyle(one);
    return {
      text: (one.innerText || '').replace(/\s+/g, ' ').trim(),
      color: style.color,
      background: style.backgroundColor,
      marks: [...one.querySelectorAll('ui-spell svg')].map((svg) => svg.getAttribute('aria-label')),
      bonus: !!one.querySelector('ui-bonus'),
    };
  });
  return {
    text: (tip.innerText || '').replace(/\s+/g, ' ').trim(),
    heading: (tip.querySelector('p')?.innerText || '').trim(),
    items,
  };
}

/**
 * LA COLONNA DELLA TITOLARITA' e il NOME di ogni riga, col colore COMPUTATO del nome: le classi
 * direbbero solo che qualcuno le ha scritte, e i token sono `color-mix` - il confronto e' fra righe
 * della stessa pagina e mai con un letterale.
 */
function names() {
  const table = document.querySelector('ui-matches-table nz-table table');
  if (!table) return { ready: false };
  const rows = [...table.querySelectorAll('tbody tr')];
  if (!rows.length) return { ready: false };
  const heads = [...table.querySelectorAll('thead th')].map((one) => (one.innerText || '').trim());
  return {
    ready: true,
    heads,
    rows: rows.map((row) => {
      const target = row.children[0]?.querySelector('span[role="button"]');
      const rect = target?.getBoundingClientRect();
      // CHI C'E' DAVVERO SOTTO IL PUNTO: l'intestazione fissa della tabella copre le prime righe, e un
      // click che finisce li' non e' un click sul nome - si legge come «il gesto non funziona».
      const over = rect ? document.elementFromPoint(
        Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2),
      ) : null;
      return {
        fc: row.getAttribute('data-fc'),
        name: (target?.innerText || '').trim(),
        covered: !!target && !(target === over || target.contains(over) || over?.contains(target)),
        rung: (row.children[1]?.innerText || '').trim(),
        // Il colore si legge sulla CELLA, che e' dove la classe sta: il bottone eredita.
        color: getComputedStyle(row.children[0]).color,
        x: rect ? Math.round(rect.left + rect.width / 2) : null,
        y: rect ? Math.round(rect.top + rect.height / 2) : null,
        cursor: target ? getComputedStyle(target).cursor : null,
      };
    }),
  };
}

/**
 * L'INTESTAZIONE DI UNA PARTITA COME L'OPERATORE L'HA DISEGNATA (10/09/2026): l'icona in cima, una
 * riga per squadra col suo gol, un filetto, il modulo. E la larghezza, che deve essere UNA SOLA.
 */
function headShape() {
  const table = document.querySelector('ui-matches-table nz-table table');
  if (!table || !table.querySelector('tbody tr')) return null;
  const heads = [...table.querySelectorAll('thead th')];
  const matches = heads.filter((one) => one.querySelector('[data-side]'));
  if (!matches.length) return null;
  const one = matches[0];
  const box = one.getBoundingClientRect();
  const icon = one.querySelector('nz-icon');
  const shape = [...one.children].find((child) => parseFloat(getComputedStyle(child).borderTopWidth) > 0);
  return {
    // Larghezze DISTINTE: una sola vuol dire che sono tutte uguali.
    widths: [...new Set(matches.map((head) => Math.round(head.getBoundingClientRect().width)))],
    columns: matches.length,
    // L'ordine verticale dei pezzi, letto dalla loro y: e' quello che il disegno dichiara.
    parts: [...one.children].map((child) => ({
      text: (child.innerText || '').replace(/\s+/g, ' ').trim(),
      top: Math.round(child.getBoundingClientRect().top),
      sides: child.hasAttribute('data-side'),
      rule: parseFloat(getComputedStyle(child).borderTopWidth) > 0,
    })),
    iconCentred: icon
      ? Math.abs((icon.getBoundingClientRect().left + icon.getBoundingClientRect().width / 2)
        - (box.left + box.width / 2)) <= 1
      : null,
    shapeText: shape ? (shape.innerText || '').trim() : null,
    // Nessuna intestazione deve sforare la sua colonna: il taglio si misura sul CONTENUTO (un Range),
    // non sullo `scrollWidth` della cella, che conta anche gli pseudo-elementi di antd.
    clipped: matches.filter((head) => {
      const range = document.createRange();
      range.selectNodeContents(head);
      const need = Math.ceil(range.getBoundingClientRect().width);
      const st = getComputedStyle(head);
      const room = head.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
      return need - room > 1;
    }).map((head) => (head.innerText || '').replace(/\s+/g, ' ').trim()),
  };
}

/**
 * CHI SCORRE E CHI STA FERMO: il contenitore della tabella, la pagina, e la x di ogni colonna
 * agganciata - misurata due volte, prima e dopo aver portato il contenitore in fondo a destra.
 */
function scrollShape() {
  const table = document.querySelector('ui-matches-table nz-table table');
  const box = table?.closest('.overflow-x-auto');
  if (!table || !box || !table.querySelector('tbody tr')) return null;
  const at = (el) => Math.round(el.getBoundingClientRect().left);
  const heads = [...table.querySelectorAll('thead th')];
  const pinned = heads.filter((one) => one.classList.contains('is-pinned'));
  const first = table.querySelector('tbody tr');
  return {
    overflowX: getComputedStyle(box).overflowX,
    client: box.clientWidth,
    scroll: box.scrollWidth,
    left: Math.round(box.scrollLeft),
    page: { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth },
    pinned: pinned.map((one) => ({ text: (one.innerText || '').trim().split('\n')[0], x: at(one) })),
    // Il primo <th> che NON e' agganciato: e' quello che deve scorrere sotto gli altri.
    firstMatch: heads.find((one) => !one.classList.contains('is-pinned'))
      ? at(heads.find((one) => !one.classList.contains('is-pinned'))) : null,
    // Il fondo di una cella agganciata deve essere OPACO: si legge l'alfa, non si confronta un colore.
    bodyBg: [...table.querySelectorAll('tbody tr')].slice(0, 4)
      .map((row) => getComputedStyle(row.querySelector('td.is-pinned')).backgroundColor),
    pinnedRow: first ? first.querySelectorAll('td.is-pinned').length : 0,
  };
}

/** Le card aperte e di chi parlano: il titolo sta nella MANIGLIA (`b`/`header` non esistono qui). */
function cards() {
  return [...document.querySelectorAll('ui-player-card')].map((one) => ({
    title: (one.querySelector('[cdkdraghandle] span span')?.innerText || '').trim(),
  }));
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  if (!existsSync(join(DATA, 'external_match_stats.json.gz'))) {
    throw new Error(`no bundle in ${DATA}: run \`node scripts/pull-bundle.mjs\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const truth = await sheet();
  const rung = await rungs();
  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-tip-'));
  const base = `http://127.0.0.1:${port}`;
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1000',
    `${base}/players?vista=matches`,
  ], { stdio: 'ignore' });

  const report = { base, sheetRows: truth.size, rungRows: rung.size, steps: [], problems: [] };
  const note = (step, detail) => {
    report.steps.push({ step, ...detail });
    console.log(`\u00b7 ${step}: ${detail.said ?? ''}`);
    for (const problem of detail.problems ?? []) console.log(`    ! ${problem}`);
    if (detail.problems?.length) {
      report.problems.push(...detail.problems.map((one) => `${step}: ${one}`));
    }
  };

  const debugPort = await devToolsPort(profile);
  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    const hover = (where) => session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: where.x, y: where.y, pointerType: 'mouse',
    });

    // 1. LE CELLE, e i triangoli che disegnano.
    let shape = null;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      shape = await evaluate(session, cells);
      if (shape?.ready && shape.cells.length) break;
      await wait(250);
    }
    if (!shape?.ready) throw new Error('la tabella delle ultime partite non e mai arrivata');

    const drawn = shape.cells.filter((one) => one.on || one.off);
    const both = shape.cells.filter((one) => one.on && one.off);
    const onAbsence = drawn.filter((one) => ABSENT_ICONS.includes(one.icon));
    note('i triangolini si disegnano, e solo dove ha giocato', {
      said: `${drawn.length} celle con un triangolo su ${shape.cells.length} `
        + `(${Math.round((100 * drawn.length) / shape.cells.length)}%) \u00b7 `
        + `${drawn.filter((one) => one.on).length} entrati, ${drawn.filter((one) => one.off).length} usciti`,
      problems: [
        ...(drawn.length ? [] : ['nessun triangolo in tutta la tabella: il marchio non arriva']),
        ...onAbsence.slice(0, 5).map((one) => `triangolo su una cella che dice «non c era» (${one.day})`),
        // «Entrato E uscito» non e' osservabile: un subentrato non ha un minuto d'ingresso in questi
        // dati. Se comparisse sarebbe un segno inventato, non una partita movimentata.
        ...both.slice(0, 5).map((one) => `due triangoli sulla stessa cella (${one.fc} ${one.day}): `
          + 'l uscita di un subentrato non e osservabile'),
      ],
    });

    // 2. OGNI TRIANGOLO CONTRO IL FOGLIO, per identita' e non per nome - e nei DUE versi: il segno di
    //    troppo e quello che manca. Solo le celle che il foglio conosce: una riga che il bundle non ha
    //    non dice niente su chi disegna.
    const known = shape.cells.filter((one) => truth.has(`${one.fc}|${one.day}`));
    const wrong = [];
    for (const cell of known) {
      const want = truth.get(`${cell.fc}|${cell.day}`);
      if (want.on !== cell.on || want.off !== cell.off) {
        wrong.push(`${cell.fc} ${cell.day}: schermo ${cell.on ? '\u25b2' : ''}${cell.off ? '\u25bc' : ''}`
          + `${!cell.on && !cell.off ? 'niente' : ''}, foglio ${want.on ? '\u25b2' : ''}`
          + `${want.off ? '\u25bc' : ''}${!want.on && !want.off ? 'niente' : ''} (${want.minutes}')`);
      }
    }
    note('ogni triangolo dice quello che dice il foglio', {
      said: `${known.length} celle unite al foglio per (fc_id, data) su ${shape.cells.length} \u00b7 `
        + `${known.length - wrong.length} d accordo`,
      problems: [
        ...(known.length >= 20 ? [] : [`solo ${known.length} celle unite al foglio: il banco non ha `
          + 'guardato abbastanza per dire niente']),
        ...wrong.slice(0, 8),
      ],
    });

    // 3. IL TOOLTIP, aperto con un puntatore vero su una cella che ha un triangolo: cosi' il passo
    //    misura anche che i due segni siano d'accordo fra la cella e l'elenco.
    const targets = drawn.filter((one) => one.visible && truth.has(`${one.fc}|${one.day}`)).slice(0, SAMPLE);
    let checked = 0;
    const tipProblems = [];
    let sample = null;
    for (const cell of targets) {
      await hover({ x: 5, y: 5 });
      await wait(150);
      await hover(cell);
      let tip = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        tip = await evaluate(session, openTip);
        if (tip?.items?.length) break;
        await wait(150);
      }
      if (!tip) {
        tipProblems.push(`nessun tooltip all hover su ${cell.fc} ${cell.day}`);
        continue;
      }
      checked += 1;
      sample ??= tip;
      const want = truth.get(`${cell.fc}|${cell.day}`);
      const minutes = tip.items.find((one) => one.text.startsWith('In campo'));
      if (!minutes) {
        tipProblems.push(`${cell.fc} ${cell.day}: l elenco non porta i minuti`);
      } else if (!minutes.text.includes(`${want.minutes}'`)) {
        tipProblems.push(`${cell.fc} ${cell.day}: l elenco dice «${minutes.text}», il foglio ${want.minutes}'`);
      }
      // I due segni sono gli stessi nella cella e nell'elenco: due letture dello stesso fatto.
      const marks = minutes?.marks ?? [];
      if (marks.includes('subentrato') !== cell.on || marks.includes('sostituito') !== cell.off) {
        tipProblems.push(`${cell.fc} ${cell.day}: i triangoli dell elenco non sono quelli della cella`);
      }
    }
    note('il tooltip e un elenco e porta i minuti', {
      said: `${checked} tooltip aperti su ${targets.length} celle \u00b7 `
        + `il primo: ${sample?.items.length ?? 0} voci, «${(sample?.text ?? '').slice(0, 120)}»`,
      problems: [
        ...(checked ? [] : ['nessun tooltip si e aperto: il passo non ha guardato niente']),
        ...(sample && sample.items.length >= 2 ? []
          : ['il tooltip non e un elenco: meno di due voci']),
        ...tipProblems.slice(0, 8),
      ],
    });

    // 4. LE COSE BUONE E QUELLE CATTIVE HANNO EFFETTI DIVERSI, e si misura confrontando due righe
    //    DELLO STESSO tooltip: i token sono `color-mix` e un confronto con un letterale mente.
    let contrast = null;
    for (const cell of shape.cells.filter((one) => one.visible && !ABSENT_ICONS.includes(one.icon))) {
      await hover({ x: 5, y: 5 });
      await wait(120);
      await hover(cell);
      let tip = null;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        tip = await evaluate(session, openTip);
        if (tip?.items?.some((one) => one.bonus)) break;
        await wait(150);
      }
      const events = tip?.items.filter((one) => one.bonus) ?? [];
      const plain = tip?.items.filter((one) => !one.bonus) ?? [];
      if (events.length && plain.length) {
        contrast = { day: cell.day, fc: cell.fc, events, plain };
        break;
      }
    }
    note('un evento si distingue da una riga qualsiasi, e non solo per la tinta', {
      said: contrast
        ? `${contrast.fc} ${contrast.day}: «${contrast.events[0].text}» ${contrast.events[0].color} `
          + `su ${contrast.events[0].background} contro «${contrast.plain[0].text}» `
          + `${contrast.plain[0].color} su ${contrast.plain[0].background}`
        : 'nessuna cella con un evento fra quelle a schermo',
      problems: contrast
        ? [
          ...(contrast.events[0].color !== contrast.plain[0].color ? []
            : ['un evento ha lo stesso colore di una riga qualsiasi']),
          ...(contrast.events[0].background !== contrast.plain[0].background ? []
            : ['un evento non ha nessun fondo: il colore resta l unico canale']),
        ]
        : [],
    });

    // 5. LA COLONNA DELLA TITOLARITA', il nome smorzato e il click che apre la card: sulla vista
    //    SQUADRE, che e' quella da cui l'operatore ha chiesto il gesto e la sola con una pila di card.
    // UNA VERA NAVIGAZIONE e non un `pushState`: da `/players` a `/clubs` cambia ROTTA, e il finto
    //   popstate lasciava la pagina dov'era - il passo leggeva 60 righe (il listone) invece di 25 (una
    //   rosa) e accusava il click di non aprire una card su una pagina che una pila di card non ce
    //   l'ha. Un passo che misura la pagina sbagliata accusa il codice del proprio difetto.
    await session.send('Page.navigate', { url: `${base}/clubs?vista=matches` });
    await wait(1500);
    let list = null;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      list = await evaluate(session, names);
      // Si aspetta che la colonna sia ARRIVATA e non solo che la tabella ci sia: lo strato della
      // valutazione e' un'altra fetch, e misurare prima leggerebbe «tutti ignoti».
      if (list?.ready && list.rows.some((one) => one.rung && one.rung !== '—')) break;
      await wait(250);
    }
    const shown = list?.rows ?? [];
    const withRung = shown.filter((one) => one.rung && one.rung !== '—');
    const disagree = withRung.filter((one) => rung.has(one.fc) && rung.get(one.fc) !== one.rung);
    note('la colonna della titolarita porta la parola del foglio', {
      said: `intestazioni ${(list?.heads ?? []).slice(0, 3).join(' | ')} · `
        + `${withRung.length} righe con una parola su ${shown.length} · `
        + `${withRung.filter((one) => rung.has(one.fc)).length} confrontate col foglio`,
      problems: [
        ...(list?.ready ? [] : ['la tabella delle ultime partite non e mai arrivata sulla vista Squadre']),
        ...((list?.heads ?? [])[1] === 'Titolarità' ? []
          : [`la seconda colonna si chiama «${(list?.heads ?? [])[1]}» e non «Titolarita»`]),
        // Una colonna uniformemente vuota non e' una colonna: e' uno strato che non e' arrivato.
        ...(withRung.length ? [] : ['nessuna riga porta un gradino: la colonna e vuota su tutte']),
        ...disagree.slice(0, 5).map((one) => `${one.name}: schermo «${one.rung}», foglio `
          + `«${rung.get(one.fc)}»`),
      ],
    });

    // I NOMI SMORZATI: si confrontano DUE RIGHE DELLA STESSA PAGINA, mai un colore con un letterale.
    const faint = shown.filter((one) => one.rung === 'riserva');
    const strong = shown.filter((one) => one.rung && one.rung !== 'riserva' && one.rung !== '—');
    const unknown = shown.filter((one) => one.rung === '—');
    note('il nome di una riserva e meno evidente, e un ignoto non lo e', {
      said: `${faint.length} riserve, ${strong.length} con un altro gradino, ${unknown.length} ignoti`
        + (faint.length && strong.length ? ` · ${faint[0].color} contro ${strong[0].color}` : ''),
      problems: [
        ...(faint.length && strong.length
          ? [
            ...(faint[0].color !== strong[0].color ? []
              : ['il nome di una riserva ha lo stesso colore di un titolare']),
            ...(faint.every((one) => one.color === faint[0].color) ? []
              : ['due riserve hanno due colori diversi']),
          ]
          : ['non c e una riserva e un non-riserva a schermo: il passo non ha guardato niente']),
        // «Vuoto = ignoto, mai riserva»: un uomo senza gradino non e' un uomo che non gioca.
        ...(unknown.length && faint.length && unknown[0].color === faint[0].color
          ? ['un uomo SENZA gradino e smorzato come una riserva: vuoto e ignoto, non riserva'] : []),
      ],
    });

    // IL CLICK SUL NOME APRE LA CARD DI QUELL'UOMO.
    const clicked = shown.find((one) => one.x != null && !one.covered);
    let open = [];
    if (clicked) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await session.send('Input.dispatchMouseEvent', {
          type, x: clicked.x, y: clicked.y, button: 'left',
          buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse',
        });
      }
      for (let attempt = 0; attempt < 40; attempt += 1) {
        open = (await evaluate(session, cards)) ?? [];
        if (open.length) break;
        await wait(250);
      }
    }
    note('il click sul nome apre la card di quel calciatore', {
      said: `«${clicked?.name ?? '?'}» (cursore ${clicked?.cursor ?? '?'}) → ${open.length} card, `
        + `titolo «${open[0]?.title ?? ''}»`,
      problems: [
        ...(clicked ? [] : [`nessun nome raggiungibile: ${shown.filter((one) => one.covered).length} `
          + `coperti su ${shown.length}`]),
        ...(clicked && clicked.cursor === 'pointer' ? []
          : [`il cursore sul nome e ${clicked?.cursor}: non promette un gesto`]),
        ...(open.length === 1 ? [] : [`${open.length} card aperte invece di una`]),
        ...(open[0]?.title && clicked?.name.startsWith(open[0].title.split(' ')[0]) ? []
          : [`la card dice «${open[0]?.title}» e la riga «${clicked?.name}»`]),
      ],
    });

    // L'INTESTAZIONE A QUATTRO PIANI E LE COLONNE TUTTE UGUALI.
    const head = await evaluate(session, headShape);
    const stacked = (head?.parts ?? []).map((one) => one.sides ? 'squadra' : one.rule ? 'modulo' : 'icona');
    note('l intestazione di una partita e impilata e le colonne sono tutte larghe uguale', {
      said: head
        ? `${head.columns} colonne, larghezze ${head.widths.join('/')}px · `
          + `${stacked.join(' > ')} · modulo «${head.shapeText}» · `
          + `icona centrata: ${head.iconCentred}`
        : 'nessuna intestazione di partita',
      problems: [
        ...(head ? [] : ['nessuna colonna porta una partita: il passo non ha guardato niente']),
        ...(head?.widths.length === 1 ? []
          : [`le colonne delle partite hanno ${head?.widths.length} larghezze diverse `
            + `(${head?.widths.join(', ')}px)`]),
        // L'ordine e' il disegno: icona, le due squadre, il modulo sotto il filetto.
        ...(stacked.join(',') === 'icona,squadra,squadra,modulo' ? []
          : [`i pezzi dell intestazione sono ${stacked.join(' > ')} e non icona > squadra > squadra > modulo`]),
        ...(head?.iconCentred === false ? ['l icona non e centrata sulla colonna'] : []),
        ...(head?.clipped ?? []).slice(0, 4).map((one) => `intestazione tagliata: ${one}`),
      ],
    });

    // SCORRE IL CONTENITORE E NON LA PAGINA, e le colonne che non sono partite restano ferme.
    //
    // LA FINESTRA SI STRINGE APPOSTA: a 1600px le colonne di una rosa ci stanno tutte (misurato: 1028
    // per 1028), quindi non c'e' nessuno sforo e il passo non potrebbe misurare un aggancio - direbbe
    // «nessun problema» dopo aver guardato niente. Va per ultimo perche' cambia le coordinate di tutto.
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1000, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await wait(600);
    const before = await evaluate(session, scrollShape);
    await evaluate(session, () => {
      document.querySelector('ui-matches-table .overflow-x-auto').scrollLeft = 99999;
    });
    await wait(400);
    const after = await evaluate(session, scrollShape);
    // Un'alfa < 1 vuol dire che le giornate si leggono ATTRAVERSO il nome mentre gli scorrono sotto.
    const seeThrough = (before?.bodyBg ?? []).filter(
      (one) => /rgba?\([^)]*[,/]\s*0?\.\d+\s*\)/.test(one) || /\/\s*0?\.\d+/.test(one),
    );
    const moved = (before?.pinned ?? []).filter(
      (one, index) => Math.abs(one.x - (after?.pinned?.[index]?.x ?? -999)) > 1,
    );
    note('scorre il contenitore, non la pagina, e le colonne fisse restano ferme', {
      said: before
        ? `contenitore ${before.client}px per ${before.scroll}px di colonne (overflow-x `
          + `${before.overflowX}) · scorso a ${after?.left ?? '?'} · pagina `
          + `${before.page.client}/${before.page.scroll} · ${before.pinnedRow} celle agganciate `
          + `per riga · prima partita da ${before.firstMatch} a ${after?.firstMatch}`
        : 'la tabella non e mai arrivata',
      problems: [
        ...(before ? [] : ['nessuna tabella da misurare']),
        ...(before?.overflowX === 'auto' ? []
          : [`il contenitore ha overflow-x ${before?.overflowX}: non scorre`]),
        // La PAGINA non deve piu' scorrere di lato: era il difetto da cui nasce la richiesta.
        ...(before && before.page.scroll <= before.page.client + 1 ? []
          : [`la pagina scorre ancora di lato: ${before?.page.scroll} contro ${before?.page.client}`]),
        // Se non sfora, il passo non ha guardato niente e lo dice invece di passare.
        ...(before && before.scroll > before.client + 1 ? []
          : ['le colonne entrano tutte: questo passo non ha potuto misurare nessun aggancio']),
        ...(after && after.left > 0 ? [] : ['il contenitore non si e mosso']),
        ...moved.map((one) => `«${one.text}» si e spostata scorrendo: non e agganciata`),
        ...(after && before && after.firstMatch === before.firstMatch
          ? ['la prima colonna di partita non si e mossa: non sta scorrendo niente'] : []),
        ...(before?.pinnedRow ? [] : ['nessuna cella agganciata nelle righe']),
        ...seeThrough.slice(0, 3).map((one) => `una cella agganciata e semitrasparente (${one}): le `
          + 'giornate si leggono attraverso il nome'),
      ],
    });

    await session.send('Emulation.clearDeviceMetricsOverride');
    await wait(400);

    // LA FOTOGRAFIA, che e' l'unica cosa che dice se un triangolino da sei pixel si vede: nessun
    //    conteggio puo' rispondere «e' troppo piccolo» o «e' troppo grosso».
    const shot = await session.send('Page.captureScreenshot', { format: 'png' });
    const file = join(ROOT, 'dist', 'e2e-matches-tip.png');
    await writeFile(file, Buffer.from(shot.data, 'base64'));
    note('screenshot', { said: file });

    const noise = session.noise();
    note('nessuna eccezione in console', {
      said: noise.length ? `${noise.length} messaggi` : 'pulita',
      problems: noise.slice(0, 5),
    });
  } finally {
    session?.close();
    browser.kill();
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }

  if (flag('--json')) console.log(JSON.stringify(report, null, 2));
  console.log(report.problems.length
    ? `\n${report.problems.length} problemi`
    : '\nnessun problema');
  process.exitCode = report.problems.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
