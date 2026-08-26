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
      // Cosa porta ogni riga: lo stemma, i ruoli, il nome e il gain. Contati, non guardati.
      parts: rows.map((row) => ({
        crest: row.querySelectorAll('ui-crest img, ui-crest span').length,
        roles: row.querySelectorAll('ui-roles span').length,
        name: (row.querySelector('span.flex-1')?.innerText ?? '').trim(),
        gain: (row.querySelector('ui-gain')?.innerText ?? '').trim(),
        // «lo metteresti più arretrato»: in questo blocco è un ripiego, non un acquisto per questo posto.
        behind: row.dataset.behind === '1',
      })),
      // La riga di confine è l'unico `li` senza un gain: contarla per l'attributo prenderebbe anche i
      // nativi, che non ne hanno nessuno (`null` non scrive l'attributo).
      dividers: list
        ? [...list.querySelectorAll('li')].filter((one) => !one.querySelector('ui-gain')).length
        : 0,
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

    // 2. LA RIGA: stemma, ruoli, nome, gain. Quattro cose contate su ogni riga disegnata.
    const missing = { crest: 0, roles: 0, name: 0, gain: 0 };
    const dashes = [];
    for (const block of blocks) {
      for (const part of block.parts) {
        if (!part.crest) missing.crest += 1;
        if (!part.roles) missing.roles += 1;
        if (!part.name) missing.name += 1;
        if (!part.gain) missing.gain += 1;
        if (part.gain === '—') dashes.push(`${block.role} · ${part.name}`);
      }
    }
    note('la riga', {
      said: `${rowsSeen} righe esaminate · prima riga: ${JSON.stringify(blocks[0]?.parts[0] ?? null)}`,
      problems: [
        ...(missing.crest ? [`${missing.crest} righe senza stemma`] : []),
        ...(missing.roles ? [`${missing.roles} righe senza ruolo`] : []),
        ...(missing.name ? [`${missing.name} righe senza nome`] : []),
        ...(missing.gain ? [`${missing.gain} righe senza gain`] : []),
        ...(dashes.length ? [`${dashes.length} righe col gain vuoto in classifica (${dashes[0]})`] : []),
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
    const expected = { P: 30, D: 80, C: 80, A: 60 };
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

    // 6. IL BOTTONE, con un puntatore vero alle coordinate che il browser dichiara.
    const button = await evaluate(session, boxOf, 'button', 'Impostazioni lega');
    if (!button) throw new Error('il bottone delle impostazioni non è a schermo');
    await click(session, button);
    const modal = await evaluate(session, modalOpen);
    note('le impostazioni si aprono', {
      said: `bottone a (${Math.round(button.x)},${Math.round(button.y)}), sotto il punto c'è `
        + `${button.under} · finestra: ${modal?.visible ? 'aperta' : 'chiusa'}`,
      problems: [
        ...(button.inside ? [] : [`sotto il punto del bottone c'è ${button.under}: un dito non lo raggiunge`]),
        ...(modal?.visible ? [] : ['la finestra non si è aperta con un puntatore vero']),
        ...(modal?.text?.includes('Partecipanti') ? [] : ['la finestra non porta il campo dei partecipanti']),
      ],
    });

    // 7. MANTRA: si cambia gioco e la pagina cambia vocabolario, non solo etichetta.
    const mantra = await evaluate(session, boxOf, 'label.ant-radio-button-wrapper', 'Mantra');
    if (mantra) await click(session, mantra);
    const apply = await evaluate(session, boxOf, '.ant-modal-footer button', 'Applica');
    if (apply) await click(session, apply);
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
    note('mantra', {
      said: `${after.length} blocchi (${roles}) · ${after.reduce((sum, one) => sum + one.rows, 0)} nomi · `
        + `contatori ${after.map((one) => one.counter).join('/')}`,
      problems: [
        ...(after.length === 12 ? [] : [`${after.length} blocchi invece dei dodici ruoli mantra`]),
        ...(roles.includes('por') && roles.includes('dc') && roles.includes('pc')
          ? [] : [`il vocabolario mantra non è quello del regolamento: ${roles}`]),
        ...(afterPage.scrollHeight - afterPage.innerHeight > 1
          ? [`con dodici blocchi la pagina scorre di ${afterPage.scrollHeight - afterPage.innerHeight}px`] : []),
        ...(after.some((one) => one.parts.some((part) => !part.roles))
          ? ['qualche riga mantra non porta i suoi codici'] : []),
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
    const setTo = async (...labels) => {
      const open = await evaluate(session, boxOf, 'button', 'Impostazioni lega');
      if (open) await click(session, open);
      for (const label of labels) {
        const radio = await evaluate(session, boxOf, 'label.ant-radio-button-wrapper', label);
        if (!radio) return `non trovo l'opzione «${label}» nella finestra`;
        await click(session, radio);
      }
      const ok = await evaluate(session, boxOf, '.ant-modal-footer button', 'Applica');
      if (!ok) return 'non trovo il bottone «Applica»';
      await click(session, ok);
      await wait(1200);
      return null;
    };

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
