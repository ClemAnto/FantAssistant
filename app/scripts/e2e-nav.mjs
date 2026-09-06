/**
 * e2e-nav.mjs - guida l'app VERA e misura che da ogni pagina si arrivi a ogni altra pagina.
 *
 * Perche' un browser e non un test unitario: quello che l'intestazione comune promette non e' «il
 * componente disegna nove link» - quello lo dice `app-header.spec.ts` in tre righe - e' che le NOVE
 * viste, caricate dal router una per una con i loro store e i loro layout, mostrino la stessa barra e
 * che le sue icone si possano CLICCARE. Il difetto che il nav cura era proprio questo: sette template
 * tenevano ognuno la sua manciata di collegamenti, quindi «si arriva a ogni pagina?» era una domanda
 * su nove file, e la risposta era no (dal pannello d'asta non si tornava da nessuna parte).
 *
 * Cosa misura, e ogni passo dice su quante cose ha guardato (un audit rotto risponde «zero problemi»
 * ed e' indistinguibile da una pagina pulita):
 *
 *   * UN `<header>` SOLO PER PAGINA, con il titolo della rotta, la versione e tutte le voci.
 *   * NESSUNA ICONA VUOTA. Un `nz-icon` non registrato non da' errore: va a cercare il disegno per
 *     rete, prende un 404 e lascia la casella vuota. Si conta il suo `<svg>`, non la sua classe.
 *   * OGNI ICONA E' CLICCABILE SULLO SCHERMO e non solo nel DOM: si guarda chi c'e' sotto il suo
 *     centro (`elementFromPoint`) e poi si clicca con un puntatore VERO - `element.click()` passa
 *     sopra la CSS e non dimostra niente di un controllo.
 *   * IL GIRO COMPLETO: dal listone si raggiungono le altre otto pagine usando SOLO il nav, e da
 *     ognuna si torna, rileggendo indirizzo e titolo a ogni tappa. E' l'unica prova della frase «un
 *     unico nav che mi permetta di navigare su ogni pagina».
 *   * IL TOOLTIP ESISTE, aperto con un hover vero: un nav di sole icone senza il suo nome non si
 *     sceglie, e il titolo di `nz-tooltip` e' un binding di proprieta' che nel DOM non lascia niente.
 *   * QUANTO COSTA IN ALTEZZA sulle due pagine che NON scorrono (plancia, strategia): l'altezza della
 *     barra, e che la pagina continui a non scorrere. E' la stessa misura che al pannello Tk e' costata
 *     105px di campetto.
 *   * NESSUNA VISTA URLA IN CONSOLE: un'eccezione vuol dire che qualcosa non e' stato provato.
 *
 * Usage: node scripts/e2e-nav.mjs [--headed] [--json]
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

/** Le pagine con il titolo che devono scrivere. Dichiarate qui: un banco che le leggesse dall'app
 *  confermerebbe l'app con l'app, che e' l'asserzione circolare pagata il 04/09/2026. */
const PAGES = [
  ['/', 'Calciatori', 'app-players'],
  ['/clubs', 'Squadre', 'app-clubs'],
  ['/charts', 'Grafici', 'app-charts'],
  ['/strategy', 'Strategia', 'app-strategy'],
  ['/plancia', 'Plancia', 'app-plancia'],
  ['/auction', "Segui un'asta", 'app-auction'],
  ['/sealed-bid', 'Buste chiuse', 'app-sealed-bid'],
  ['/why', 'Perch\u00e9 quel surplus', 'app-why'],
  ['/hello', 'Ciao, FantAssistant', 'app-hello'],
];
/** I tag delle nove viste: quale sia MONTATA e' l'unico segnale di «ci sono arrivato» che non passi
 *  dal titolo - aspettare il titolo e poi asserirlo sarebbe l'asserzione circolare del 04/09/2026. */
const TAGS = PAGES.map((one) => one[2]);
/** Le due pagine il cui layout e' un BUDGET: l'altezza e' quella della finestra, non del contenuto. */
const TIGHT = ['/strategy', '/plancia'];

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
  /* Quello che la pagina URLA, raccolto invece che ignorato: «non si apre» ha quasi sempre
     un'eccezione dietro, e senza questa lista si finisce a indovinare il meccanismo. */
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
 * LA BARRA COME LA HA LO SCHERMO: quante ne esistono, che titolo scrive, quante voci porta il nav,
 * quale e' accesa, e per ogni voce se disegna il suo `<svg>` e chi c'e' sotto il suo centro.
 *
 * Risponde `{ ready: false }` finche' la vista non c'e': fra la navigazione e il primo frame il
 * documento puo' non avere ancora niente, e una sonda che serve un ciclo di attesa deve poter dire
 * «non ancora» invece di lanciare - un ciclo che polla non aspetta niente se chi interroga muore.
 */
function shapeOf(tags) {
  // L'intestazione della PAGINA e' quella che porta il nav: `<header>` ne esistono anche dentro le
  // sezioni (le card dei grafici, i blocchi della strategia), e quelli sono loro.
  const headers = [...document.querySelectorAll('header')].filter((one) => one.querySelector('nav a[data-nav]'));
  const shell = headers[0];
  if (!shell) return { ready: false };
  const links = [...shell.querySelectorAll('nav a[data-nav]')].map((one) => {
    const rect = one.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const over = document.elementFromPoint(x, y);
    return {
      link: one.getAttribute('data-nav'),
      here: one.getAttribute('aria-current') === 'page',
      drawn: !!one.querySelector('svg'),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      x, y,
      covered: !(one === over || one.contains(over) || over?.contains(one)),
    };
  });
  const doc = document.documentElement;
  return {
    ready: true,
    // LA VISTA MONTATA SI LEGGE QUI E NON IN UNA SECONDA SONDA: «quale pagina e' a schermo» e «che
    // titolo scrive la barra» sono due fatti che devono essere D'ACCORDO, quindi si leggono nello
    // stesso istante. Con due `Runtime.evaluate` la navigazione puo' passare in mezzo, e allora il
    // passo attribuisce alla pagina un titolo che apparteneva a quella di prima - misurato: /clubs
    // leggeva «Calciatori» mentre a schermo, un decimo di secondo dopo, c'era «Squadre».
    path: location.pathname,
    search: location.search,
    view: (tags ?? []).find((tag) => document.querySelector(tag)) ?? null,
    headers: headers.length,
    title: (shell.querySelector('h1')?.innerText ?? '').trim(),
    h1: document.querySelectorAll('h1').length,
    version: /v\d+\.\d+\.\d+/.test(shell.innerText ?? ''),
    headerHeight: Math.round(shell.getBoundingClientRect().height),
    navWidth: Math.round(shell.querySelector('nav')?.getBoundingClientRect().width ?? 0),
    links,
    scrolls: doc.scrollHeight > doc.clientHeight + 1,
    overflow: doc.scrollHeight - doc.clientHeight,
  };
}

/** Il testo del tooltip aperto, letto dall'overlay: nel DOM della voce non c'e' nessun attributo. */
function tooltipText() {
  return [...document.querySelectorAll('.ant-tooltip')]
    .filter((one) => !one.classList.contains('ant-tooltip-hidden') && one.offsetParent !== null
      && Number(getComputedStyle(one).opacity) > 0.1)
    .map((one) => (one.innerText ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

/** L'altezza della barra col nav e senza: l'A/B piu' piccolo possibile, una cosa sola che si muove. */
function navCost() {
  const shell = [...document.querySelectorAll('header')]
    .find((one) => one.querySelector('nav a[data-nav]'));
  const nav = shell?.querySelector('nav');
  if (!shell || !nav) return null;
  const withNav = Math.round(shell.getBoundingClientRect().height);
  nav.style.display = 'none';
  const without = Math.round(shell.getBoundingClientRect().height);
  nav.style.display = '';
  return { withNav, without, cost: withNav - without };
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-nav-'));
  /* Porta zero, cioe' scelta dal sistema e riletta dal profilo: con una porta fissa una corsa che non
     ha chiuso il suo browser fa attaccare la corsa DOPO a quello vecchio, e si misura la sessione
     sbagliata (misurato il 27/08/2026 su un'altra suite). */
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
    /**
     * Aspetta che la vista attesa sia MONTATA e la barra completa, e ritorna quella lettura.
     *
     * Una lettura SOLA, non due: quello che si confronta - la vista a schermo e il titolo che la barra
     * scrive - deve venire dallo stesso istante, o il passo accusa una pagina del titolo di un'altra.
     */
    const settle = async (view) => {
      let shape = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        shape = await evaluate(session, shapeOf, TAGS);
        if (shape?.ready && shape.view === view && shape.links.length === PAGES.length) return shape;
        await wait(250);
      }
      return shape;
    };
    const goTo = async (to, view) => {
      await evaluate(session, (path) => {
        history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, to);
      return settle(view);
    };

    // L'APP DEVE ESSERE IN PIEDI PRIMA DI NAVIGARE: su `about:blank` un `pushState` lancia una
    // SecurityError, e la corsa muore prima di misurare niente. Si aspetta la prima barra.
    let up = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      up = await evaluate(session, shapeOf, TAGS);
      if (up?.ready && up.links?.length) break;
      await wait(250);
    }
    if (!up?.ready) throw new Error("l'app non ha mai disegnato la sua intestazione");

    // 1. OGNI VISTA PORTA LA STESSA BARRA, col suo store e il suo layout.
    const seen = [];
    for (const [path, title, view] of PAGES) {
      const shape = await goTo(path, view);
      seen.push({ path, title, shape, noise: session.noise() });
    }
    note('ogni vista apre la stessa intestazione', {
      said: seen
        .map((one) => `${one.path} \u00ab${one.shape?.title}\u00bb ${one.shape?.links?.length ?? 0} voci`)
        .join(' \u00b7 '),
      problems: [
        ...seen.filter((one) => !one.shape?.ready).map((one) => `${one.path} non ha nessun <header>`),
        ...seen.filter((one) => one.shape?.headers > 1).map((one) =>
          `${one.path} ha ${one.shape.headers} intestazioni col nav: l'intestazione della pagina e' una`),
        ...seen.filter((one) => one.shape?.h1 > 1).map((one) => `${one.path} ha ${one.shape.h1} <h1>`),
        ...seen.filter((one) => one.shape?.title !== one.title).map((one) =>
          `${one.path} scrive \u00ab${one.shape?.title}\u00bb invece di \u00ab${one.title}\u00bb`),
        ...seen.filter((one) => one.shape?.links?.length !== PAGES.length).map((one) =>
          `${one.path} porta ${one.shape?.links?.length} voci invece di ${PAGES.length}`),
        ...seen.filter((one) => !one.shape?.version).map((one) => `${one.path} non porta la versione`),
        ...seen.flatMap((one) => one.noise.map((problem) => `${one.path}: ${problem}`)),
      ],
    });

    // 2. LE VOCI SI VEDONO E SI CLICCANO, su tutte le pagine e non solo sulla prima.
    const icons = seen.flatMap((one) =>
      (one.shape?.links ?? []).map((link) => ({ ...link, page: one.path })));
    const blank = icons.filter((one) => !one.drawn);
    const covered = icons.filter((one) => one.covered);
    const marked = seen.map((one) => ({
      path: one.path,
      here: (one.shape?.links ?? []).filter((link) => link.here).map((link) => link.link),
    }));
    note('le voci si vedono, si cliccano e dicono dove sei', {
      said: `${icons.length} voci misurate su ${seen.length} pagine \u00b7 ${blank.length} vuote \u00b7 `
        + `${covered.length} coperte \u00b7 nav ${seen[0]?.shape?.navWidth}px \u00b7 accesa: `
        + marked.map((one) => one.here.join(',') || 'nessuna').join(' '),
      problems: [
        ...blank.map((one) => `${one.page}: la voce ${one.link} non disegna nessuna icona`),
        ...covered.map((one) => `${one.page}: la voce ${one.link} e' coperta da un altro elemento`),
        ...marked.filter((one) => one.here.length !== 1).map((one) =>
          `${one.path} accende ${one.here.length} voci invece di una`),
        ...marked.filter((one) => one.here.length === 1 && one.here[0] !== one.path).map((one) =>
          `${one.path} accende ${one.here[0]}`),
      ],
    });

    // 3. IL GIRO COMPLETO CON SOLI CLIC, che e' la frase da dimostrare.
    await goTo('/', 'app-players');
    const hops = [];
    for (const [path, title, view] of PAGES) {
      if (path === '/') continue;
      const target = (await evaluate(session, shapeOf, TAGS))?.links?.find((one) => one.link === path);
      if (!target) {
        hops.push({ path, said: 'la voce non esiste in barra', ok: false });
        continue;
      }
      await click(target);
      const landed = await settle(view);
      // ...e si torna indietro col nav, cosi' il giro prova anche il ritorno da ogni pagina.
      const back = (await evaluate(session, shapeOf, TAGS))?.links?.find((one) => one.link === '/');
      if (back) await click(back);
      const home = await settle('app-players');
      hops.push({
        path,
        said: `andata ${landed?.path} (${landed?.view}) titolo ${landed?.title}, `
          + `ritorno ${home?.path} (${home?.view})`,
        ok: landed?.path === path && landed?.title === title && landed?.view === view
          && home?.path === '/' && home?.view === 'app-players',
      });
    }
    note('dal listone si raggiunge ogni pagina, e si torna, con soli clic', {
      said: hops.map((one) => `${one.path}${one.ok ? '' : ` (${one.said})`}`).join(' \u00b7 '),
      problems: hops.filter((one) => !one.ok).map((one) => `${one.path}: ${one.said}`),
    });

    // 4. IL TOOLTIP, aperto con un hover vero: senza il nome un'icona non si sceglie.
    //
    //    PRIMA SI RIPORTA IL PUNTATORE A RIPOSO e si aspetta che NESSUN tooltip sia a schermo: ng-zorro
    //    tiene l'overlay nel DOM e lo dissolve, quindi leggendo subito si legge quello del passo prima -
    //    e' quello che questa corsa ha letto («Strategia» sulla voce delle Buste). Uno stato di partenza
    //    non verificato fa attribuire una lettura all'hover sbagliato.
    await goTo('/', 'app-players');
    await hover({ x: 5, y: 600 });
    let clean = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (!(await evaluate(session, tooltipText))) { clean = true; break; }
      await wait(200);
    }
    // UN BERSAGLIO CHE SI MUOVE NON E' UN BERSAGLIO, e le coordinate sono quelle del momento del
    // gesto: il nav e' allineato a destra, quindi quando la pastiglia del pacchetto arriva (lo store
    // finisce di leggere) le voci SCORRONO - questa corsa ha puntato le Buste e ha aperto Strategia.
    // Si aspettano due letture identiche di fila, come fa `clickSteady` sulle finestre di antd.
    let probe = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const read = (await evaluate(session, shapeOf, TAGS)).links.find((one) => one.link === '/sealed-bid');
      if (probe && read && probe.x === read.x && probe.y === read.y) break;
      probe = read;
      await wait(250);
    }
    await hover({ x: probe.x, y: probe.y });
    let tip = '';
    for (let attempt = 0; attempt < 25; attempt += 1) {
      tip = (await evaluate(session, tooltipText)) ?? '';
      if (tip) break;
      await wait(200);
    }
    note('un hover vero apre il nome della voce', {
      said: `partenza ${clean ? 'pulita' : 'SPORCA'} · «${tip}»`,
      problems: [
        ...(clean ? [] : ["un tooltip era gia a schermo: la lettura non e attribuibile"]),
        ...(tip.includes('Buste chiuse') ? [] : [
          `il tooltip della voce /sealed-bid legge «${tip}»: `
            + 'un nav di sole icone senza nome non si sceglie',
        ]),
      ],
    });
    await hover({ x: 5, y: 600 });

    // 5. QUANTO COSTA IL NAV DOVE L'ALTEZZA E' UN BUDGET, misurato muovendo una cosa sola: la stessa
    //    barra con il nav e senza, nella stessa pagina e nella stessa sessione. Quello che deve valere
    //    e' che la pagina NON scorra - e' la promessa del suo layout - e il costo si stampa comunque,
    //    perche' un numero senza il suo prima non si legge.
    const cost = [];
    for (const path of TIGHT) {
      const [, , view] = PAGES.find((one) => one[0] === path);
      await goTo(path, view);
      cost.push({ path, ...(await evaluate(session, navCost)), shape: await evaluate(session, shapeOf, TAGS) });
    }
    note("quanto costa il nav dove l'altezza e' un budget", {
      said: cost.map((one) => `${one.path} barra ${one.withNav}px, senza il nav ${one.without}px `
        + `(+${one.cost}) · ${one.shape?.scrolls ? `SCORRE di ${one.shape.overflow}px` : 'non scorre'}`)
        .join(' · '),
      problems: cost.filter((one) => one.shape?.scrolls).map((one) =>
        `${one.path} ha ricominciato a scorrere (${one.shape.overflow}px oltre la finestra)`),
    });

  } finally {
    session?.close();
    /* Un headless si sdoppia in figli, e uccidere il padre lascia in piedi il browser - che e' poi
       quello che si prende la sessione della corsa successiva. Si ammazza l'ALBERO. */
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
