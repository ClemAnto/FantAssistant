/**
 * e2e-clubs.mjs - guida la pagina SQUADRE vera e misura le due cose che l'operatore ha chiesto il
 * 06/09/2026: il campetto senza il tooltip che apre la CARD al click, e la tabella della rosa compatta
 * col nome che apre la stessa card.
 *
 * Perche' un browser e non un test unitario: quello che va provato non e' che un componente emetta un
 * evento - lo dice un test in tre righe - e' che un CLICK VERO su un nome apra la card, che la card
 * porti i numeri di QUEL calciatore, e che il tooltip che c'era prima non compaia piu' all'hover. Tre
 * fatti che vivono sullo schermo: un `element.click()` passa sopra la CSS e un tooltip che non c'e' non
 * si dimostra leggendo il DOM.
 *
 * Cosa misura, e ogni passo dice su quante cose ha guardato (un audit rotto risponde «zero problemi» ed
 * e' indistinguibile da una pagina pulita):
 *
 *   * LA TABELLA COMPATTA, coi numeri che DECIDONO: altezza della riga, larghezza della tabella, e -
 *     la cosa che conta - nessuna intestazione e nessuna cella TAGLIATA. Una colonna stretta che
 *     nasconde una cifra non e' compattezza, e' un numero che mente («276px di colonne non strette,
 *     ASSENTI», 29/07/2026).
 *   * IL NOME DELLA TABELLA APRE LA CARD, con un puntatore vero, e la card parla di LUI: il nome
 *     dell'intestazione della card si confronta con quello della riga cliccata.
 *   * IL CAMPETTO APRE LA STESSA CARD, e la card di questa pagina NON ha la meta' d'asta: qui non c'e'
 *     un tavolo, e una max offerta accanto a una rosa vera sarebbe il numero di un'asta che non esiste.
 *   * IL TOOLTIP DEL CAMPETTO NON C'E' PIU', verificato con un hover vero e cercando le due etichette
 *     che solo quella scheda aveva.
 *   * SI CHIUDE, perche' una card che si apre e non si chiude e' una card che copre la pagina.
 *   * NESSUNA ECCEZIONE IN CONSOLE: un errore vuol dire che qualcosa non e' stato provato.
 *
 * Usage: node scripts/e2e-clubs.mjs [--headed] [--json]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gz': 'application/gzip', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

/** Quanto una riga della tabella compatta puo' essere alta perche' si possa chiamare compatta. */
const DENSE_ROW_MAX_PX = 28;
/** Le due etichette che SOLO la vecchia scheda all'hover del campetto scriveva. */
const OLD_HOVER_CARD = ['Titolarità (board)', 'Giornate a voto (motore)'];

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

// ------------------------------------------------------------------ what runs IN the page

/**
 * LA TABELLA COMPATTA come la ha lo schermo, e la domanda che conta non e' «quanto e' piccola» ma
 * «qualcosa e' stato TAGLIATO»: si confronta quello che ogni cella chiede (`scrollWidth`) con quello che
 * le e' stato dato (`clientWidth`), intestazione per intestazione e cella per cella.
 */
function tableShape() {
  const table = document.querySelector('nz-table table');
  if (!table) return { ready: false };
  const rows = [...table.querySelectorAll('tbody tr')];
  const heads = [...table.querySelectorAll('thead th')];
  if (!rows.length || !heads.length) return { ready: false };
  const host = table.closest('nz-table')?.parentElement ?? null;
  const cell = rows[0].children[1];
  // IL TAGLIO SI MISURA CON UN RANGE SUL CONTENUTO, non sullo `scrollWidth` della cella: una colonna
  // `nzLeft` porta l'ombra di antd (un `::after` di 30px fuori dalla cella) e lo scrollWidth del `<td>`
  // la conta - letto cosi' si legge «ogni nome tagliato di 30px» su una tabella che non taglia niente
  // (creduto per dieci minuti il 06/09/2026). Un Range misura le caselle del contenuto e ignora gli
  // pseudo-elementi; un testo con `truncate` misura la sua casella, quindi i puntini non sono un taglio.
  const over = (one) => {
    const range = document.createRange();
    range.selectNodeContents(one);
    const need = Math.ceil(range.getBoundingClientRect().width);
    const style = getComputedStyle(one);
    const room = one.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return Math.max(0, need - room);
  };
  return {
    ready: true,
    dense: !!document.querySelector('nz-table.table-dense'),
    rows: rows.length,
    columns: heads.length,
    rowHeight: Math.round(rows[0].getBoundingClientRect().height),
    headHeight: Math.round(heads[0].getBoundingClientRect().height),
    fontSize: cell ? getComputedStyle(cell).fontSize : null,
    tableWidth: Math.round(table.getBoundingClientRect().width),
    hostWidth: host ? Math.round(host.getBoundingClientRect().width) : null,
    pageScroll: document.documentElement.scrollHeight,
    clippedHeads: heads.filter((one) => over(one) > 1)
      .map((one) => `${(one.innerText || '').trim().replace(/\s+/g, ' ')} (+${over(one)}px)`),
    clippedCells: rows.flatMap((row) => [...row.children].filter((one) => over(one) > 1)
      .map((one) => `${(one.innerText || '').trim()} (+${over(one)}px)`)).slice(0, 8),
  };
}

/**
 * LA TABELLA DELLE ULTIME PARTITE, che e' l'altra lettura della stessa rosa.
 *
 * La riga non scende come quella dei valori e non e' un difetto: una cella porta DUE righe - il voto e
 * la striscia delle iconcine - quindi 31px e' il suo pavimento, non 23.
 */
function matchesShape() {
  const table = document.querySelector('ui-matches-table nz-table table');
  if (!table) return { ready: false };
  const rows = [...table.querySelectorAll('tbody tr')];
  const heads = [...table.querySelectorAll('thead th')];
  if (!rows.length || !heads.length) return { ready: false };
  const over = (one) => {
    const range = document.createRange();
    range.selectNodeContents(one);
    const need = Math.ceil(range.getBoundingClientRect().width);
    const style = getComputedStyle(one);
    const room = one.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return Math.max(0, need - room);
  };
  const host = table.closest('nz-table')?.parentElement ?? null;
  return {
    ready: true,
    dense: !!document.querySelector('ui-matches-table nz-table.table-dense'),
    rows: rows.length,
    columns: heads.length,
    rowHeight: Math.round(rows[0].getBoundingClientRect().height),
    fontSize: getComputedStyle(rows[0].children[1]).fontSize,
    tableWidth: Math.round(table.getBoundingClientRect().width),
    hostWidth: host ? Math.round(host.getBoundingClientRect().width) : null,
    pageScroll: document.documentElement.scrollHeight,
    // Le iconcine dentro le celle: se la compattezza le avesse spente, la tabella direbbe meno cose.
    marks: table.querySelectorAll('tbody nz-icon').length,
    // I MARCHI DEL VOCABOLARIO (`ui-bonus`): gol, rigori e assist disegnati come nella card.
    bonuses: table.querySelectorAll('tbody ui-bonus').length,
    // IL CONFINE FRA DUE STAGIONI: la colonna che non e' una partita, e quante ne sono.
    dividers: heads.filter((one) => !(one.innerText || '').trim() && one.clientWidth < 24).length,
    /*
     * L'ORDINE DELLE COLONNE, ricavato dal TITOLO di ognuna e non creduto: il titolo porta «Giornata N»,
     * quindi si legge la sequenza delle giornate e si guarda che SCENDA - la piu' recente a sinistra
     * (operatore, 06/09/2026). Il confine spezza la sequenza perche' fra le due stagioni il numero
     * ricomincia, quindi si controlla ogni tratto per se'.
     */
    rounds: heads.map((one) => {
      const found = /Giornata (\d+)/.exec(one.getAttribute('title') || '');
      return found ? Number(found[1]) : null;
    }),
    dividerWidth: (() => {
      const found = heads.find((one) => !(one.innerText || '').trim() && one.clientWidth < 24);
      return found ? Math.round(found.getBoundingClientRect().width) : null;
    })(),
    /*
     * I RISULTATI COLORATI, e il verso si RICAVA dal punteggio invece di crederci: il club della
     * pagina e' la sigla che compare in OGNI intestazione, quindi da «Lec-Ata 0-3» si sa che i suoi
     * gol sono i 3 - e allora quel numero deve essere verde. Confrontare il colore con se stesso
     * sarebbe l'asserzione circolare del 04/09.
     */
    results: (() => {
      const labels = heads.map((one) => (one.querySelector('span')?.innerText || '').trim());
      const counts = new Map();
      for (const label of labels) {
        for (const side of label.split('-')) {
          if (side) counts.set(side, (counts.get(side) ?? 0) + 1);
        }
      }
      let ours = null;
      for (const [side, seen] of counts) if (!ours || seen > counts.get(ours)) ours = side;
      return heads.flatMap((head) => {
        const label = (head.querySelector('span')?.innerText || '').trim();
        const score = [...head.querySelectorAll('span')]
          .map((one) => (one.innerText || '').trim())
          .find((text) => /^\d+-\d+$/.test(text));
        if (!score || !label.includes('-')) return [];
        const sides = label.split('-');
        const goals = score.split('-').map(Number);
        const at = sides.indexOf(ours);
        if (at < 0) return [];
        const mine = goals[at];
        const theirs = goals[1 - at];
        const node = [...head.querySelectorAll('span')]
          .find((one) => (one.innerText || '').trim() === score);
        return [{
          label,
          score,
          want: mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw',
          ink: node ? getComputedStyle(node).color : null,
        }];
      });
    })(),
    /* LO ZEBRATO si misura fra RIGHE DELLA STESSA PAGINA e mai contro un letterale: i token sono
       `color-mix` e il tema ha due versi, quindi la sola affermazione verificabile e' «la riga pari ha
       un fondo diverso dalla dispari» (lezione del 04/09 sull'evidenziazione della plancia). */
    stripes: (() => {
      const odd = rows[0] ? getComputedStyle(rows[0].children[1]).backgroundColor : null;
      const even = rows[1] ? getComputedStyle(rows[1].children[1]).backgroundColor : null;
      return { odd, even, different: !!odd && !!even && odd !== even };
    })(),
    clipped: [
      ...heads.filter((one) => over(one) > 1)
        .map((one) => `testa ${(one.innerText || '').trim().replace(/\s+/g, ' ')} (+${over(one)}px)`),
      ...rows.flatMap((row) => [...row.children].filter((one) => over(one) > 1)
        .map((one) => `cella ${(one.innerText || '').trim().replace(/\s+/g, ' ')} (+${over(one)}px)`)),
    ].slice(0, 8),
  };
}

/** Il rettangolo del nome della prima riga della tabella, e CHI c'e' sotto il suo centro. */
function tableNameAt(index) {
  const row = document.querySelectorAll('nz-table tbody tr')[index];
  const target = row?.children[1]?.querySelector('span[role="button"]');
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const over = document.elementFromPoint(x, y);
  return {
    name: (target.innerText || '').trim(),
    x, y,
    covered: !(target === over || target.contains(over) || over?.contains(target)),
    cursor: getComputedStyle(target).cursor,
  };
}

/** Lo stesso, per un nome disegnato sul CAMPETTO: e' il posto, non la riga di una tabella. */
function pitchNameAt(index) {
  const targets = [...document.querySelectorAll('ui-club-board span[role="button"]')];
  const target = targets[index];
  if (!target) return { total: targets.length };
  const rect = target.getBoundingClientRect();
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const over = document.elementFromPoint(x, y);
  return {
    total: targets.length,
    name: (target.querySelector('span')?.innerText || '').trim(),
    x, y,
    covered: !(target === over || target.contains(over) || over?.contains(target)),
    cursor: getComputedStyle(target).cursor,
  };
}

/** Le card aperte: di chi parlano, e se portano la meta' d'asta (che qui non deve esserci). */
function cards() {
  return [...document.querySelectorAll('ui-player-card')].map((one) => {
    const text = (one.innerText || '').replace(/\s+/g, ' ');
    // IL NOME STA NELLA MANIGLIA, e si legge da LA': `b`/`strong`/`header` non esistono in questa card
    // e cercarli fa leggere una stringa vuota, cioe' accusa la pagina di non dire un nome che dice.
    const handle = one.querySelector('[cdkdraghandle]');
    const button = one.querySelector('button[aria-label="chiudi"]');
    const rect = button?.getBoundingClientRect();
    return {
      title: (handle?.querySelector('span span')?.innerText || '').trim(),
      text: text.slice(0, 400),
      market: /max offerta|pagato/i.test(text),
      close: rect
        ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
        : null,
    };
  });
}

/** Il testo dei tooltip VISIBILI: ng-zorro tiene l'overlay nel DOM e lo dissolve, quindi si filtra. */
function tooltipText() {
  return [...document.querySelectorAll('.ant-tooltip')]
    .filter((one) => !one.classList.contains('ant-tooltip-hidden') && one.offsetParent !== null
      && Number(getComputedStyle(one).opacity) > 0.1)
    .map((one) => (one.innerText ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-clubs-'));
  const base = `http://127.0.0.1:${port}`;
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1000',
    `${base}/clubs`,
  ], { stdio: 'ignore' });

  const report = { base, steps: [], problems: [] };
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

    const click = async (where) => {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await session.send('Input.dispatchMouseEvent', {
          type, x: where.x, y: where.y, button: 'left',
          buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, pointerType: 'mouse',
        });
      }
    };
    const hover = (where) => session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: where.x, y: where.y, pointerType: 'mouse',
    });
    /** Due letture identiche di fila: un bersaglio che si muove non e' un bersaglio (27/08/2026). */
    const steady = async (probe, ...args) => {
      let last = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const read = await evaluate(session, probe, ...args);
        if (last && read && read.x === last.x && read.y === last.y) return read;
        last = read;
        await wait(250);
      }
      return last;
    };

    // 1. LA TABELLA COMPATTA, e la domanda che decide e' se qualcosa e' tagliato.
    let shape = null;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      shape = await evaluate(session, tableShape);
      if (shape?.ready) break;
      await wait(250);
    }
    if (!shape?.ready) throw new Error('la tabella della rosa non e mai arrivata');
    note('la tabella della rosa e compatta e non taglia niente', {
      said: `${shape.rows} righe x ${shape.columns} colonne \u00b7 riga ${shape.rowHeight}px `
        + `(testa ${shape.headHeight}px, testo ${shape.fontSize}) \u00b7 tabella ${shape.tableWidth}px `
        + `in ${shape.hostWidth}px \u00b7 pagina ${shape.pageScroll}px`,
      problems: [
        ...(shape.dense ? [] : ['la tabella non e in modo compatto: manca la classe `table-dense`']),
        ...(shape.rowHeight <= DENSE_ROW_MAX_PX ? []
          : [`una riga e alta ${shape.rowHeight}px: sopra ${DENSE_ROW_MAX_PX} non e compatta`]),
        ...shape.clippedHeads.map((one) => `intestazione tagliata: ${one}`),
        ...shape.clippedCells.map((one) => `cella tagliata: ${one}`),
      ],
    });

    // 2. IL CAMPETTO PRIMA DELLA TABELLA, e non e' un ordine comodo: la card e' `fixed` e finisce
    //    SOPRA il campetto, quindi misurando il campetto con una card aperta si legge «il nome e'
    //    coperto» e si accusa la pagina di un difetto dell'arnese (succede: prima corsa, tre problemi
    //    su tre erano miei). Prima il campetto a schermo pulito, poi la tabella.
    await hover({ x: 5, y: 700 });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await evaluate(session, tooltipText))) break;
      await wait(200);
    }
    const man = await steady(pitchNameAt, 0);
    let tip = '';
    if (man?.x != null) {
      await hover({ x: man.x, y: man.y });
      await wait(1200);
      tip = (await evaluate(session, tooltipText)) ?? '';
    }
    note('il campetto non ha piu la scheda all hover', {
      said: `${man?.total ?? 0} nomi cliccabili · hover su «${man?.name ?? '?'}» → «${tip}»`,
      problems: [
        ...(man?.total ? [] : ['nessun nome del campetto e cliccabile']),
        ...(man?.covered ? ['il nome sul campetto e coperto da un altro elemento'] : []),
        ...OLD_HOVER_CARD.filter((one) => tip.includes(one))
          .map((one) => `all hover compare ancora la vecchia scheda («${one}»)`),
      ],
    });

    let fromPitch = [];
    if (man?.x != null) {
      await click(man);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        fromPitch = (await evaluate(session, cards)) ?? [];
        if (fromPitch.length) break;
        await wait(250);
      }
      note('il click sul campetto apre la card di quel calciatore', {
        said: `«${man.name}» → ${fromPitch.length} card, titolo «${fromPitch[0]?.title ?? ''}»`,
        problems: [
          ...(fromPitch.length === 1 ? [] : [`${fromPitch.length} card aperte invece di una`]),
          // Il nome sul campetto porta anche il marchio e l'overall, quindi si confronta il COGNOME.
          ...(fromPitch[0]?.title && man.name.startsWith(fromPitch[0].title.split(' ')[0]) ? []
            : [`la card dice «${fromPitch[0]?.title}» e il campetto «${man.name}»`]),
          ...(fromPitch[0]?.market ? ['la card porta la meta d asta: qui non c e nessun tavolo'] : []),
        ],
      });

      // 3. SI CHIUDE, e si chiude PRIMA di misurare la tabella: una card aperta copre le righe.
      if (fromPitch[0]?.close) {
        await click(fromPitch[0].close);
        let left = fromPitch;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          left = (await evaluate(session, cards)) ?? [];
          if (left.length < fromPitch.length) break;
          await wait(200);
        }
        note('una card si chiude', {
          said: `${fromPitch.length} → ${left.length}`,
          problems: left.length < fromPitch.length ? [] : ['la card non si e chiusa'],
        });
      }
    }

    // 4. IL NOME DELLA TABELLA APRE LA STESSA CARD, con un puntatore vero, e parla di LUI.
    const row = await steady(tableNameAt, 0);
    if (!row) throw new Error('nessun nome cliccabile nella tabella');
    await click(row);
    let open = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      open = (await evaluate(session, cards)) ?? [];
      if (open.length) break;
      await wait(250);
    }
    note('il nome della tabella apre la card di quel calciatore', {
      said: `«${row.name}» (cursore ${row.cursor}) → ${open.length} card, `
        + `titolo «${open[0]?.title ?? ''}»`,
      problems: [
        ...(row.covered ? ['il nome e coperto da un altro elemento: il click non lo raggiunge'] : []),
        ...(row.cursor === 'pointer' ? [] : [`il cursore sul nome e ${row.cursor}: non promette un gesto`]),
        ...(open.length === 1 ? [] : [`${open.length} card aperte invece di una`]),
        ...(open[0]?.title === row.name ? []
          : [`la card dice «${open[0]?.title}» e la riga «${row.name}»`]),
        ...(open[0]?.market ? ['la card porta la meta d asta: qui non c e nessun tavolo'] : []),
      ],
    });

    // 5. L'ALTRA TABELLA DELLA STESSA ROSA - le ultime partite - compatta come la prima.
    await evaluate(session, () => {
      history.pushState({}, '', '/clubs?vista=matches');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    let matches = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      matches = await evaluate(session, matchesShape);
      if (matches?.ready) break;
      await wait(250);
    }
    note('anche la tabella delle ultime partite e compatta', {
      said: matches?.ready
        ? `${matches.rows} righe x ${matches.columns} colonne · riga ${matches.rowHeight}px `
          + `(testo ${matches.fontSize}) · tabella ${matches.tableWidth}px in ${matches.hostWidth}px `
          + `· pagina ${matches.pageScroll}px · ${matches.bonuses} marchi del vocabolario`
        : 'non e mai arrivata',
      problems: [
        ...(matches?.ready ? [] : ['la tabella delle ultime partite non si e aperta']),
        ...(matches?.dense === false ? ['non e in modo compatto: manca la classe `table-dense`'] : []),
        ...(matches?.ready && matches.rowHeight > 34
          ? [`una riga e alta ${matches.rowHeight}px: la cella ne porta due, ma non piu di 34`] : []),
        ...(matches?.ready && !matches.bonuses
          ? ['nessun `ui-bonus` nelle celle: i marchi non sono quelli della card'] : []),
        ...(matches?.clipped ?? []).map((one) => `tagliato: ${one}`),
      ],
    });

    // 5b. LE ULTIME DIECI IN ASSOLUTO: due stagioni e un CONFINE fra loro.
    note('le ultime dieci giornate attraversano le stagioni', {
      said: `${matches?.dividers ?? 0} confini (larghi ${matches?.dividerWidth ?? '?'}px) su `
        + `${matches?.columns ?? 0} colonne`,
      problems: [
        ...(matches?.dividers === 1 ? [] : [
          `${matches?.dividers} colonne divisorie: alla seconda giornata di campionato le ultime dieci `
            + 'stanno su due stagioni, quindi il confine e uno',
        ]),
        ...(matches?.dividerWidth != null && matches.dividerWidth <= 24 ? [] : [
          `il confine e largo ${matches?.dividerWidth}px: e una colonna, non una giornata`,
        ]),
      ],
    });

    // 5b-bis. L'ORDINE: la piu' recente a sinistra, e la prova non passa dall'app - i numeri di
    //         giornata stanno nei titoli delle colonne.
    const runs = [];
    let run = [];
    for (const round of matches?.rounds ?? []) {
      if (round == null) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      run.push(round);
    }
    if (run.length) runs.push(run);
    const rising = runs.filter((one) => one.some((round, at) => at > 0 && round > one[at - 1]));
    note('le colonne vanno dalla piu recente alla piu vecchia', {
      said: runs.map((one) => one.join('>')).join(' | ') || 'nessuna giornata nei titoli',
      problems: [
        ...(runs.length ? [] : ['nessuna colonna dichiara la sua giornata: ordine non verificabile']),
        ...rising.map((one) => `un tratto risale: ${one.join(' ')}`),
      ],
    });

    // 5c. IL RISULTATO COLORATO, col verso RICAVATO dal punteggio e non creduto.
    // UN COLORE SI GIUDICA PER CLASSE, non per valore: verde e rosso vengono dai token del tema, quindi
    // si confrontano FRA LORO - tutti i vinti con lo stesso inchiostro, i persi con un altro - e non
    // contro un letterale (`color-mix` in Chrome non si legge come `rgb()`, lezione del 03/09).
    const wrong = (matches?.results ?? []).filter((one) => !one.ink);
    const inks = new Map();
    for (const one of matches?.results ?? []) {
      if (!inks.has(one.want)) inks.set(one.want, new Set());
      inks.get(one.want).add(one.ink);
    }
    note('i risultati in intestazione sono colorati per esito', {
      said: [...inks.entries()].map(([want, set]) => `${want}: ${[...set].join('/')}`).join(' · ')
        + ` · ${(matches?.results ?? []).length} risultati letti`,
      problems: [
        ...(matches?.results?.length ? [] : ['nessuna intestazione porta un risultato']),
        ...wrong.map((one) => `${one.label}: nessun colore letto`),
        ...[...inks.entries()].filter(([, set]) => set.size > 1)
          .map(([want, set]) => `gli esiti «${want}» hanno ${set.size} inchiostri diversi`),
        ...(inks.size > 1 && new Set([...inks.values()].map((set) => [...set][0])).size === 1
          ? ['vinte e perse hanno lo stesso colore: la distinzione non si vede'] : []),
      ],
    });

    // 5d. LE RIGHE PARI PIU' CHIARE, misurate fra righe della stessa pagina.
    note('le righe pari hanno un fondo diverso dalle dispari', {
      said: `dispari ${matches?.stripes?.odd} · pari ${matches?.stripes?.even}`,
      problems: matches?.stripes?.different ? []
        : ['le due righe hanno lo stesso fondo: lo zebrato non dipinge'],
    });

    // 6. NIENTE ECCEZIONI: un errore vuol dire che qualcosa non e' stato provato.
    const noise = session.noise();
    note('la pagina non urla in console', {
      said: noise.length ? noise.join(' | ') : 'niente',
      problems: noise,
    });
  } finally {
    session?.close();
    if (process.platform === 'win32' && browser.pid) {
      spawnSync('taskkill', ['/pid', String(browser.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      browser.kill();
    }
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  if (flag('--json')) console.log(JSON.stringify(report, null, 2));
  console.log(report.problems.length ? `\n${report.problems.length} PROBLEMI` : '\nnessun problema');
  process.exitCode = report.problems.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
