/**
 * e2e-docks.mjs - le due barre in basso: FISSE, che non si mangiano la pagina, e PIEGABILI.
 *
 * Sua richiesta, 23/09/2026: «facciamo in modo che i menu' in basso (Opzioni / Estrai / azzera /
 * Viaggio nel tempo / ecc...) siano position fixed e non occupino spazio nella pagina. facciamo anche
 * che i menu' in basso siano collassabili».
 *
 * Le due meta' si misurano in modo diverso e nessuna delle due si legge nel CSS.
 *
 *  - «NON OCCUPA SPAZIO» non e' `position: fixed` scritto in una classe: quello e' vero da sempre. Era
 *    la PAGINA a tenersi un margine sotto (`pb-14` sulla plancia, `pb-11` sull'ultima lista della
 *    Strategia), e la prova che non c'e' piu' e' che il contenuto arrivi SOTTO la scatola - cioe' che
 *    delle righe stiano dentro al suo rettangolo. Con la riserva non ce ne stava nessuna.
 *  - «SI PIEGA» e' che i CONTROLLI spariscano mentre l'ALLARME resta. E' la regola della scatola
 *    (`ui/bottom-dock`) e la sola cosa che un lettore futuro potrebbe togliere credendo di
 *    semplificare: questa app ha due frasi che esistono apposta per non lasciarsi dimenticare - la
 *    pastiglia che dice «allarmi spenti» e la data in cui l'app crede di trovarsi - e un collasso che
 *    le spegnesse sarebbe il difetto che quei due riquadri sono stati scritti per impedire.
 *
 * Il gesto si prova con un PUNTATORE VERO e si guarda chi c'e' sotto la freccia: un bottone che un
 * altro elemento copre e' presente nel DOM e irraggiungibile da un dito (il difetto degli imbuti,
 * 20/08/2026).
 *
 * Zero dipendenze, come gli altri banchi: serve `dist/`, avvia Edge o Chrome headless, CDP.
 *
 * Usage: node scripts/e2e-docks.mjs [--headed] [--json] [--shot]
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
      noise.push(`ECCEZIONE: ${detail?.exception?.description ?? detail?.text ?? '?'}`.slice(0, 300));
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      noise.push(
        `CONSOLE: ${message.params.args.map((one) => one.description ?? one.value).join(' ')}`.slice(0, 300),
      );
    }
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.fail(new Error(JSON.stringify(message.error)));
    else waiting.done(message.result);
  });
  return {
    send: (method, params = {}) =>
      new Promise((done, fail) => {
        const id = (sequence += 1);
        pending.set(id, { done, fail });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    close: () => socket.close(),
    noise: () => noise.splice(0, noise.length),
  };
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

/** Un puntatore VERO: si passa sopra, poi si preme e si rilascia dove il browser dichiara il bersaglio. */
async function click(session, point) {
  const at = { x: Math.round(point.x), y: Math.round(point.y) };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
  await wait(90);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...at, button: 'left', clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...at, button: 'left', clickCount: 1,
  });
  await wait(250);
}

/**
 * Le due scatole come stanno adesso.
 *
 * `covers` e' la misura di «non occupa spazio»: quante righe della plancia finiscono DENTRO il
 * rettangolo della scatola. Si conta sul rettangolo e non su quante ne mancano, perche' una riga
 * coperta esiste ancora - quello che si sta provando e' che la pagina non si sia ristretta per far
 * posto.
 */
function readDocks() {
  const out = { docks: {} };
  const rows = [...document.querySelectorAll('plancia-slot-matrix .grid > div button')];
  for (const side of ['left', 'right']) {
    const dock = document.querySelector(`[data-dock="${side}"]`);
    if (!dock) {
      out.docks[side] = null;
      continue;
    }
    const box = dock.getBoundingClientRect();
    const toggle = dock.querySelector('button[aria-expanded]');
    const t = toggle?.getBoundingClientRect();
    const at = t && t.width ? { x: t.left + t.width / 2, y: t.top + t.height / 2 } : null;
    const under = at ? document.elementFromPoint(at.x, at.y) : null;
    out.docks[side] = {
      collapsed: dock.hasAttribute('data-collapsed'),
      fixed: getComputedStyle(dock).position === 'fixed',
      w: Math.round(box.width),
      h: Math.round(box.height),
      buttons: dock.querySelectorAll('button').length,
      text: dock.innerText.replace(/\s+/g, ' ').trim(),
      toggleAt: at,
      // Non «c'e' un bottone» ma «il punto in cui si clicca appartiene a quel bottone».
      reaches: !!(toggle && under && toggle.contains(under)),
      under: under?.tagName ?? null,
      covers: rows.filter((row) => {
        const r = row.getBoundingClientRect();
        return r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom;
      }).length,
    };
  }
  const page = document.scrollingElement;
  const matrix = document.querySelector('plancia-slot-matrix');
  out.rows = rows.length;
  out.matrixH = matrix ? Math.round(matrix.getBoundingClientRect().height) : null;
  out.pageScrolls = page.scrollHeight > page.clientHeight + 1;
  return out;
}

async function main() {
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-docks-'));
  const debugPort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/plancia`;
  const browser = spawn(
    binary,
    [
      flag('--headed') ? '--headless=false' : '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--window-size=1600,900',
      url,
    ],
    { stdio: 'ignore' },
  );

  const report = { url, steps: [], problems: [] };
  const note = (step, detail) => {
    report.steps.push({ step, ...detail });
    console.log(`. ${step}: ${detail.said ?? ''}`);
    for (const problem of detail.problems ?? []) console.log(`    ! ${problem}`);
    if (detail.problems?.length) report.problems.push(...detail.problems.map((one) => `${step}: ${one}`));
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await wait(2500);

    let state = null;
    for (let attempt = 0; attempt < 40 && !state?.rows; attempt += 1) {
      state = await evaluate(session, readDocks);
      if (!state?.rows) await wait(300);
    }
    if (!state?.rows) throw new Error('la plancia non ha disegnato nessuna riga');
    const open = state;

    // 1. FISSE, E LA PAGINA NON SI RESTRINGE PIU' PER LORO.
    note('le due barre sono fisse e la pagina arriva sotto', {
      said:
        `sinistra ${open.docks.left?.w}x${open.docks.left?.h}px su ${open.docks.left?.covers} righe · ` +
        `destra ${open.docks.right?.w}x${open.docks.right?.h}px su ${open.docks.right?.covers} · ` +
        `plancia ${open.matrixH}px, ${open.rows} righe`,
      problems: [
        ...(open.docks.left && open.docks.right ? [] : ['una delle due barre non e\' a schermo']),
        ...(open.docks.left?.fixed && open.docks.right?.fixed
          ? []
          : ['una delle due barre non e\' `fixed`: sta nel flusso e spinge la pagina']),
        // La riserva sotto (`pb-14`) si vedeva cosi': ZERO righe nel rettangolo di una barra. Se torna,
        // questo conteggio va a zero, ed e' la ragione per cui la misura e' questa e non la classe.
        ...(open.docks.left?.covers > 0
          ? []
          : ['nessuna riga passa sotto la barra di sinistra: la pagina si tiene ancora un margine per lei']),
        ...(open.pageScrolls ? ['la pagina ha ricominciato a scorrere'] : []),
      ],
    });

    // 2. LA FRECCIA E' RAGGIUNGIBILE DA UN DITO, non solo presente nel DOM.
    note('la freccia sta sullo schermo e non solo nel DOM', {
      said:
        `sinistra sotto il centro <${open.docks.left?.under}> · destra <${open.docks.right?.under}>`,
      problems: [
        ...(open.docks.left?.reaches ? [] : ['il centro della freccia di sinistra appartiene a un altro elemento']),
        ...(open.docks.right?.reaches ? [] : ['il centro della freccia di destra appartiene a un altro elemento']),
      ],
    });

    // 3. IL COLLASSO: via i controlli, resta l'allarme. Sulla plancia la barra di sinistra porta
    //    quattro gesti (Opzioni, estrai, azzera le rose, segnali) e la pastiglia della freschezza.
    await click(session, open.docks.left.toggleAt);
    await click(session, open.docks.right.toggleAt);
    const shut = await evaluate(session, readDocks);
    const fresh = /dati |allarmi spenti/.test(shut.docks.left?.text ?? '');
    note('piegate: spariscono i CONTROLLI e resta l\'ALLARME', {
      said:
        `sinistra ${open.docks.left.w}→${shut.docks.left?.w}px, bottoni ` +
        `${open.docks.left.buttons}→${shut.docks.left?.buttons}, resta «${shut.docks.left?.text}» · ` +
        `destra ${open.docks.right.w}→${shut.docks.right?.w}px, copre ` +
        `${open.docks.right.covers}→${shut.docks.right?.covers} righe`,
      problems: [
        ...(shut.docks.left?.collapsed && shut.docks.right?.collapsed
          ? []
          : ['una delle due non si e\' piegata']),
        ...(shut.docks.left?.w < open.docks.left.w
          ? []
          : ['piegata, la barra di sinistra non si e\' ristretta: «collassata» sarebbe solo «vuota»']),
        ...(shut.docks.left?.buttons === 1
          ? []
          : [`piegata, la barra di sinistra tiene ${shut.docks.left?.buttons} bottoni invece della sola freccia`]),
        // LA REGOLA: la pastiglia della freschezza non si spegne mai. Uno schermo senza allarmi si
        // legge come «non c'e' nessuno fuori».
        ...(fresh ? [] : ['piegata, la barra di sinistra ha perso la pastiglia della freschezza']),
        ...(shut.docks.left?.covers < open.docks.left.covers
          ? []
          : ['piegata, la barra di sinistra copre ancora tante righe quante ne copriva aperta']),
      ],
    });

    // 4. ...e si riapre. Un controllo che sparisce e' un controllo irraggiungibile.
    await click(session, shut.docks.left.toggleAt);
    const again = await evaluate(session, readDocks);
    note('la freccia riapre quello che ha piegato', {
      said: `sinistra ${shut.docks.left?.w}→${again.docks.left?.w}px, bottoni ${again.docks.left?.buttons}`,
      problems: [
        ...(again.docks.left?.collapsed === false && again.docks.left?.buttons === open.docks.left.buttons
          ? []
          : ['riaperta, la barra di sinistra non e\' tornata quella di prima']),
        // I due angoli sono indipendenti: riaprire l'una non deve riaprire l'altra.
        ...(again.docks.right?.collapsed
          ? []
          : ['riaprendo la barra di sinistra si e\' riaperta anche quella di destra']),
      ],
    });

    // 5. E LO STATO SI RICORDA: e' la sola prova che la preferenza e' scritta e riletta.
    await session.send('Page.navigate', { url });
    await wait(2500);
    let back = null;
    for (let attempt = 0; attempt < 40 && !back?.rows; attempt += 1) {
      back = await evaluate(session, readDocks);
      if (!back?.rows) await wait(300);
    }
    note('la piega sopravvive al ricaricamento', {
      said: `sinistra ${back?.docks.left?.collapsed ? 'piegata' : 'aperta'} · destra ${back?.docks.right?.collapsed ? 'piegata' : 'aperta'}`,
      problems: [
        ...(back?.docks.left?.collapsed === false ? [] : ['la barra di sinistra si e\' ricordata di essere piegata, e non lo era']),
        ...(back?.docks.right?.collapsed ? [] : ['la barra di destra non si e\' ricordata di essere piegata']),
      ],
    });

    if (flag('--shot')) {
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = join(ROOT, 'docks.png');
      await writeFile(where, Buffer.from(shot.data, 'base64'));
      report.screenshot = where;
      console.log(`  screenshot: ${where}`);
    }

    const noise = session.noise();
    if (noise.length) note('la console della pagina', { said: `${noise.length} righe`, problems: noise });
  } finally {
    session?.close();
    // Un headless si sdoppia in figli, e uccidere il padre lascia in piedi il browser.
    if (process.platform === 'win32' && browser.pid) {
      spawnSync('taskkill', ['/pid', String(browser.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      browser.kill();
    }
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
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
