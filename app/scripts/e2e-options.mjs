/**
 * e2e-options.mjs - drive the REAL app and measure what the GLOBAL OPTIONS actually take away.
 *
 * Perché un browser e non un test unitario: quello che questa funzione promette non è «il filtro
 * restituisce meno righe» - quello lo dice un test in tre righe - è che escludere una squadra la toglie
 * da OGNI vista e da ogni conto. Le viste sono cinque, le carica il router, e i loro numeri li calcolano
 * store diversi: un test per store passerebbe mentre una pagina continua a mostrarli.
 *
 * Cosa misura, e ogni passo dice su quante cose ha guardato (un audit rotto risponde «zero problemi» ed
 * è indistinguibile da una pagina pulita):
 *
 *   * IL BOTTONE ESISTE SULLO SCHERMO, non solo nel DOM: si apre con un puntatore vero alle coordinate
 *     che il browser dichiara, e si controlla CHI c'è sotto quel punto. Un `element.click()` passa sopra
 *     la CSS e dimostra niente di un controllo.
 *   * QUANTI UOMINI SPARISCONO, contati sulla tabella prima e dopo, contro quello che il pannello
 *     dichiara di nascondere: se i due numeri non coincidono, la lista e la sua etichetta parlano di due
 *     liste diverse.
 *   * LA SQUADRA SPARISCE DAL FILTRO dei club e dalla vista SQUADRE: una squadra esclusa che si può
 *     ancora scegliere è un vicolo cieco.
 *   * OGNI VISTA SI APRE lo stesso - Calciatori, Strategia, Buste chiuse, Squadre, Grafici - e nessuna
 *     urla in console. Un'eccezione vuol dire che qualcosa non è stato provato.
 *   * IL REGOLAMENTO È UNO: cambiato dal pannello, la pagina delle Buste lo legge senza ricaricare.
 *   * SI RICORDA dopo un refresh, ed è la sola prova che la preferenza è scritta e riletta.
 *
 * Usage: node scripts/e2e-options.mjs [--headed] [--json]
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
  /* Quello che la pagina URLA, raccolto invece che ignorato: «non si apre» ha quasi sempre
     un'eccezione dietro, e senza questa lista si finisce a indovinare il meccanismo. */
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

// ------------------------------------------------------------------ what runs IN the page

/**
 * Il rettangolo di un controllo E CHI C'È SOTTO IL SUO CENTRO.
 *
 * Le due domande insieme, perché sono due difetti diversi con lo stesso sintomo: un bottone fuori dal
 * suo posto e un bottone coperto da un altro elemento leggono tutti e due come «non si clicca».
 */
function boxOf(selector, text) {
  const all = [...document.querySelectorAll(selector)];
  const element = text ? all.find((one) => (one.innerText || '').includes(text)) : all[0];
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return { missing: 'rettangolo a zero' };
  const x = Math.round(rect.left + rect.width / 2);
  const y = Math.round(rect.top + rect.height / 2);
  const over = document.elementFromPoint(x, y);
  return {
    x, y,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    over: over ? over.tagName.toLowerCase() : null,
    covered: !(element === over || element.contains(over) || over?.contains(element)),
  };
}

/** Quanti uomini la tabella dice di avere, letto dalla riga del conteggio e non dalle righe caricate. */
function countLine() {
  // `document.body` puo' essere NULL: questa funzione viene chiamata in un ciclo che POLLA finche' una
  // riga appare, e fra la navigazione e il primo frame il documento non ha ancora un body. Senza il
  // `?.` la funzione LANCIA invece di rispondere «non ancora», e `evaluate` trasforma quel lancio in
  // un errore che uccide la corsa: misurato su sei corse, due morivano qui. *Una sonda che serve un
  // ciclo di attesa deve poter dire «non ancora», o il ciclo non aspetta niente.*
  const text = document.body?.innerText || '';
  const shown = /(\d[\d.]*)\s+(?:calciatori|uomini|nomi)/i.exec(text);
  return {
    said: shown ? shown[0] : null,
    rows: document.querySelectorAll('nz-table tbody tr').length,
  };
}

/** I nomi che il filtro dei club offre: una squadra esclusa non deve essere fra questi. */
function clubOptions() {
  const select = document.querySelector('nz-select[nzplaceholder*="quadra" i], nz-select');
  return select ? (select.innerText || '').trim() : null;
}

/** Il testo di tutta la pagina, per cercarci dentro un nome che non deve esserci. */
function pageText() {
  return (document.body.innerText || '').replace(/\s+/g, ' ');
}

/** Il rettangolo della casella numerica di un'etichetta: «Budget» ha la sua, e non è la prima della pagina. */
function numberBoxOf(label) {
  const owner = [...document.querySelectorAll('label')]
    .find((one) => (one.innerText || '').trim().startsWith(label));
  const input = owner?.querySelector('input');
  if (!input) return null;
  const rect = input.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
    value: input.value,
  };
}

/** Le squadre che il pannello offre, e quali sono spuntate. */
function panelClubs() {
  const boxes = [...document.querySelectorAll('.ant-modal label.ant-checkbox-wrapper')];
  return boxes.map((one) => ({
    name: (one.innerText || '').trim(),
    checked: !!one.querySelector('.ant-checkbox-checked'),
  }));
}

/** La porta che il browser si e' preso, come la scrive lui nel profilo. */
async function devToolsPort(profile) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
      const line = text.split(/\r?\n/)[0].trim();
      if (line) return Number(line);
    } catch {
      /* the browser has not written it yet */
    }
    await wait(250);
  }
  throw new Error('the browser never wrote DevToolsActivePort');
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-opt-'));
  /*
   * PORTA ZERO, cioe' scelta dal sistema e riletta dal profilo.
   *
   * Con una porta fissa una corsa che non ha chiuso il suo browser fa attaccare la corsa DOPO a quello
   * vecchio: misurato il 27/08/2026, e il secondo giro ha letto lo stato del primo - 583 calciatori
   * invece di 618, la squadra gia' esclusa, e quattro «problemi» che non esistevano. Un arnese che
   * misura la sessione sbagliata e' peggio di un arnese che non gira.
   */
  const base = `http://127.0.0.1:${port}`;
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1600,1000',
    `${base}/`,
  ], { stdio: 'ignore' });

  const report = { base, steps: [], problems: [] };
  const note = (step, detail) => {
    report.steps.push({ step, ...detail });
    console.log(`· ${step}: ${detail.said ?? ''}`);
    for (const problem of detail.problems ?? []) console.log(`    ⚠ ${problem}`);
    if (detail.problems?.length) report.problems.push(...detail.problems.map((one) => `${step}: ${one}`));
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
    const goTo = async (path) => {
      await evaluate(session, (to) => { window.location.hash = ''; history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
      await wait(2500);
    };

    // La tabella arriva dopo il bundle: si aspetta una riga, non un ritardo fisso.
    let table = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      table = await evaluate(session, countLine);
      if (table?.rows) break;
      await wait(500);
    }
    if (!table?.rows) throw new Error('no rows ever appeared: the bundle did not load');
    const before = table;
    note('la tabella apre', { said: `${before.rows} righe caricate · «${before.said ?? 'nessun conteggio'}»` });

    // ---------------------------------------------------------------- il bottone, con un puntatore vero
    const launcher = await evaluate(session, boxOf, 'button', 'Opzioni');
    if (!launcher || launcher.missing) throw new Error(`il bottone Opzioni non ha un rettangolo: ${launcher?.missing ?? 'assente'}`);
    await hover(launcher);
    await wait(120);
    note('il bottone è sullo schermo', {
      said: `${launcher.width}×${launcher.height}px a (${launcher.x},${launcher.y}), sotto il centro c'è <${launcher.over}>`,
      problems: launcher.covered ? ['il centro del bottone appartiene a un altro elemento: un puntatore vero non lo raggiunge'] : [],
    });
    await click(launcher);
    await wait(600);

    const tab = await evaluate(session, boxOf, '.ant-tabs-tab', 'Squadre escluse');
    if (!tab || tab.missing) throw new Error('il pannello non ha la scheda delle squadre');
    await click(tab);
    await wait(400);

    const clubs = await evaluate(session, panelClubs);
    if (!clubs.length) throw new Error('il pannello non offre nessuna squadra: il catalogo non è arrivato');
    const chosen = clubs.find((one) => one.name.includes('Napoli')) ?? clubs[0];
    note('il pannello offre le squadre', {
      said: `${clubs.length} squadre da spuntare · escludo «${chosen.name}»`,
      problems: clubs.some((one) => one.checked) ? ['una squadra risulta già esclusa prima di toccare niente'] : [],
    });

    const box = await evaluate(session, boxOf, '.ant-modal label.ant-checkbox-wrapper', chosen.name);
    await click(box);
    await wait(200);
    const ok = await evaluate(session, boxOf, '.ant-modal-footer button', 'Applica');
    await click(ok);
    await wait(3500);

    // ---------------------------------------------------------------- quanti ne sono spariti
    const after = await evaluate(session, countLine);
    const chip = await evaluate(session, boxOf, 'span', 'squadra');
    const said = await evaluate(session, pageText);
    const gone = (before.said && after.said)
      ? Number(before.said.replace(/\D/g, '')) - Number(after.said.replace(/\D/g, ''))
      : null;
    note('la lista si accorcia e lo DICE', {
      said: `«${before.said}» → «${after.said}» (${gone ?? '?'} in meno) · l'etichetta dice «${said.match(/\d+ squadr\w+ escluse?/)?.[0] ?? 'niente'}»`,
      problems: [
        ...(after.rows >= before.rows && before.rows > 0 ? [] : []),
        ...(said.includes('squadra esclusa') || said.includes('squadre escluse')
          ? [] : ['nessuna etichetta a schermo dice che c\'è un filtro attivo: un filtro invisibile si legge come la lista intera']),
        ...(gone != null && gone <= 0 ? ['il conteggio non è sceso: l\'esclusione non ha tolto nessuno'] : []),
        ...(chip?.covered ? ['l\'etichetta è coperta da un altro elemento'] : []),
      ],
    });

    // ---------------------------------------------------------------- e sparisce da ogni vista
    const seen = [];
    for (const [path, label] of [['/', 'Calciatori'], ['/clubs', 'Squadre'], ['/strategy', 'Strategia'], ['/sealed-bid', 'Buste chiuse'], ['/charts', 'Grafici']]) {
      await goTo(path);
      const noise = session.noise();
      const text = await evaluate(session, pageText);
      const name = chosen.name.split('\n')[0].trim();
      seen.push({ label, mentions: text.includes(name), noise: noise.length });
      if (noise.length) report.problems.push(`${label}: ${noise.join(' | ')}`);
    }
    note('ogni vista si apre senza la squadra esclusa', {
      said: seen.map((one) => `${one.label}${one.mentions ? ' (la nomina)' : ''}`).join(' · '),
      problems: seen.filter((one) => one.mentions && one.label !== 'Calciatori')
        .map((one) => `la vista ${one.label} nomina ancora «${chosen.name}»`),
    });

    // ---------------------------------------------------------------- il regolamento è UNO
    //
    // Scritto da un controllo VERO di una pagina e riletto su un'altra: è la prova che le due non ne
    // tengono due copie. Finché ne tenevano una ciascuna questo passo sarebbe passato lo stesso su
    // ognuna e avrebbe fallito qui.
    await goTo('/sealed-bid');
    const budget = await evaluate(session, numberBoxOf, 'Budget');
    if (!budget) throw new Error('la pagina delle buste non offre il budget');
    await click(budget);
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await session.send('Input.insertText', { text: '777' });
    for (const type of ['keyDown', 'keyUp']) {
      await session.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    }
    await wait(600);
    const wrote = await evaluate(session, numberBoxOf, 'Budget');
    await goTo('/strategy');
    const bar = await evaluate(session, pageText);
    note('il regolamento è uno solo', {
      said: `scritto 777 sulle Buste (la casella dice «${wrote?.value ?? '?'}»), la Strategia legge «${bar.match(/\d+ crediti/)?.[0] ?? 'niente'}»`,
      problems: bar.includes('777 crediti')
        ? [] : ['la Strategia non legge il budget scritto sulle Buste: sono ancora due dichiarazioni'],
    });

    // ---------------------------------------------------------------- si ricorda dopo un refresh
    await session.send('Page.navigate', { url: `${base}/` });
    await wait(6000);
    const kept = await evaluate(session, pageText);
    note('la scelta sopravvive al refresh', {
      said: kept.match(/\d+ squadr\w+ escluse?/)?.[0] ?? 'niente',
      problems: /squadr\w+ esclus/.test(kept) ? [] : ['dopo il refresh non risulta più niente escluso'],
    });

    const noise = session.noise();
    if (noise.length) report.problems.push(...noise);
  } finally {
    session?.close();
    // Un headless si sdoppia in figli, e uccidere il padre lascia in piedi il browser - che e' poi
    // quello che si prende la sessione della corsa successiva. Si ammazza l'ALBERO.
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
