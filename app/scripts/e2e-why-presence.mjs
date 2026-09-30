/**
 * e2e-why-presence.mjs - drive the /why page's «Partite attese» section (30/09/2026) and hold it to the file the
 * toolkit wrote (`public/data/presence_test.json`, from `toolkit/scripts/presence_test/build.py`): the switch opens
 * the section, both windows draw every row of the file's sample, the summary carries the file's two errors, and on every row
 * the seven reasons (injured ... started) add up to the club's games, the real Pa and the formula's Pa are the
 * file's, and «Err. F» is the formula minus what he really played.
 *
 * Usage: node scripts/e2e-why-presence.mjs [--headed] [--shot PATH]
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
// The rung's three letters as the app draws them (`core/titolarita.ts`, TITOLARITA_SHORT).
const SHORT = { bandiera: 'BAN', titolarissimo: 'TIS', titolare: 'TIT', ballottaggio: 'BLT', panchina: 'PAN', riserva: 'RIS' };

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



// ------------------------------------------------------------------ what runs IN the page

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

function readTable() {
  const table = document.querySelector('[data-presence-table]');
  if (!table) return null;
  // The SECOND header row names the columns; the first names the two season blocks (01/10/2026).
  const heads = [...table.querySelectorAll('[data-presence-heads] th')].map((one) => (one.innerText ?? '').replace(/[↑↓]/g, '').trim());
  const groups = [...table.querySelectorAll('[data-presence-groups] th')].map((one) => (one.innerText ?? '').trim());
  // Where each block begins, in every body row: the index of the cells that carry the rule.
  const starts = [...table.querySelectorAll('[data-presence-row]')].slice(0, 5).map((one) =>
    [...one.children].map((cell, i) => (cell.hasAttribute('data-group-start') ? i : -1)).filter((i) => i >= 0).join(','));
  const rows = [...table.querySelectorAll('[data-presence-row]')].map((one) => ({
    id: Number(one.getAttribute('data-presence-row')),
    cells: [...one.children].map((cell) => (cell.innerText ?? '').trim()),
    span: [...one.children].some((cell) => cell.colSpan > 1),
  }));
  return { heads, groups, starts, rows, summary: (document.querySelector('[data-presence-summary]')?.innerText ?? '').replace(/\s+/g, ' ') };
}

// ------------------------------------------------------------------ the run

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build in ${DIST}: run "ng build" first`);
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');
  const file = JSON.parse(await readFile(join(ROOT, 'public', 'data', 'presence_test.json'), 'utf-8'));

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-presence-'));
  const debugPort = Number(value('--port', String(await freePort())));
  const browser = spawn(binary, [
    flag('--headed') ? '--headless=false' : '--headless=new',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });

  const problems = [];
  const note = (step, said, found = []) => {
    console.log(`· ${step}: ${said}`);
    for (const one of found.slice(0, 8)) console.log(`    ! ${one}`);
    if (found.length > 8) console.log(`    ! ... e altri ${found.length - 8}`);
    problems.push(...found.map((one) => `${step}: ${one}`));
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Runtime.enable');
    await session.send('Page.enable');
    await session.send('Page.navigate', { url: `http://127.0.0.1:${port}/why` });
    const toggle = await waitFor(session, () => !!document.querySelector('[data-why-section="pa"]'), 80);
    if (!toggle) throw new Error('la pagina /why non disegna l\'interruttore delle sezioni');
    await clickSteady(session, '[data-why-section="pa"]', '');
    const first = await waitFor(session, () => {
      const t = document.querySelector('[data-presence-table]');
      return t && t.querySelectorAll('[data-presence-row]').length ? true : null;
    }, 80);
    if (!first) throw new Error('la sezione «Partite attese» non disegna la tabella');

    // v2 (01/10/2026): every window of the gate, each out of sample. The newest opens; the one before is picked
    // from the select the way a hand would, which is also how the club headers are checked to follow the season.
    // Not the oldest: nz-select renders its list VIRTUALLY, so the tenth option is not in the DOM until scrolled.
    for (const window of ['T2', 'T1']) {
      if (window !== 'T2') {
        if (!await clickSteady(session, '[data-presence-window-select]', '')) throw new Error("il selettore della stagione non c'è");
        await wait(400);
        if (!await clickSteady(session, '.ant-select-item-option', file.summary[window].target)) {
          throw new Error(`la stagione ${file.summary[window].target} non è fra le voci del selettore`);
        }
        await wait(600);
      }
      const seen = await evaluate(session, readTable);
      const expected = file.rows.filter((row) => row.window === window && row.sample);
      const byId = new Map(expected.map((row) => [row.fcId, row]));
      const bad = [];
      const at = (name) => (name === 'Squadra#0' ? seen.heads.indexOf('Squadra')
        : name === 'Squadra#1' ? seen.heads.lastIndexOf('Squadra') : seen.heads.indexOf(name));
      const start = Number(file.summary[window].target.slice(0, 4));
      const short = (year) => `${String(year).slice(2)}-${String(year + 1).slice(2)}`;
      // Two blocks, each named after its season, and each opening with its «Squadra» column.
      const prevGroup = `Stagione ${short(start - 1)}`;
      const nextGroup = `Stagione ${short(start)}`;
      if (!seen.groups.some((g) => g.toLowerCase().startsWith(prevGroup.toLowerCase()))
          || !seen.groups.some((g) => g.toLowerCase().startsWith(nextGroup.toLowerCase()))) {
        throw new Error(`i due blocchi di stagione non sono nominati: ${seen.groups.join(' | ')}`);
      }
      const squads = seen.heads.flatMap((h, i) => (h === 'Squadra' ? [i] : []));
      if (squads.length !== 2) throw new Error(`attese due colonne «Squadra», trovate ${squads.length}`);
      const bothOpen = seen.starts.filter((one) => one !== `${squads[0]},${squads[1]}` && !one.startsWith(`${squads[0]},`));
      if (bothOpen.length) bad.push(`il confine dei blocchi non apre sulle due «Squadra» (${seen.starts.join(' / ')})`);
      const clubPrevHead = 'Squadra#0';
      const clubNextHead = 'Squadra#1';
      if (seen.rows.length !== expected.length) bad.push(`${seen.rows.length} righe a schermo contro ${expected.length} nel file`);
      const sum = file.summary[window];
      for (const number of [sum.mae_formula.toFixed(2), sum.mae_engine.toFixed(2)]) {
        if (!seen.summary.includes(number)) bad.push(`il riepilogo non porta ${number}: «${seen.summary}»`);
      }
      let checked = 0;
      for (const row of seen.rows) {
        const truth = byId.get(row.id);
        if (!truth) { bad.push(`riga ${row.id} che il file non ha`); continue; }
        const num = (name) => Number(row.cells[at(name) - (row.span && at(name) > at('Min') ? 8 : 0)]);
        // The columns after the season block shift left by 8 when the block is one «nessuna stagione» cell.
        if (!row.span) {
          const parts = ['Inf.', 'Squal.', 'Ass.', 'N.c.', 'Panch.', 'Sub', 'Tit.'].reduce((a, name) => a + num(name), 0);
          if (parts !== num('Partite')) bad.push(`${truth.name}: le sette colonne sommano ${parts}, le partite sono ${num('Partite')}`);
        }
        if (num('Pa vere') !== truth.paActual) bad.push(`${truth.name}: Pa vere ${num('Pa vere')} contro ${truth.paActual}`);
        if (Math.abs(num('Pa formula') - truth.paFormula) > 0.05) bad.push(`${truth.name}: Pa formula ${num('Pa formula')} contro ${truth.paFormula}`);
        // The ratio is predicted over REAL, as the operator defined it: 100% exact, 50% he played twice, 200% half.
        const shown = row.cells[at('Formula %') - (row.span ? 8 : 0)];
        const want = truth.paActual > 0 ? `${Math.round((truth.paFormula / truth.paActual) * 100)}%` : '—';
        if (shown !== want) bad.push(`${truth.name}: Formula % «${shown}» contro ${want}`);
        // The two clubs and the two rungs are the file's (the toolkit derives the rung with `engine/status.py`).
        const text = (name) => row.cells[at(name) - (row.span && at(name) > at('Min') ? 8 : 0)];
        if (text(clubPrevHead) !== (truth.clubPrev ?? '—')) bad.push(`${truth.name}: squadra prima «${text(clubPrevHead)}» contro ${truth.clubPrev}`);
        if (text(clubNextHead).replace(/ ⇄$/, '') !== (truth.clubNext ?? '—')) bad.push(`${truth.name}: squadra dopo «${text(clubNextHead)}» contro ${truth.clubNext}`);
        if (text('Grad.') !== (SHORT[truth.rung] ?? '—')) bad.push(`${truth.name}: gradino «${text('Grad.')}» contro ${truth.rung}`);
        if (text('Grad. vero') !== (SHORT[truth.rungActual] ?? '—')) bad.push(`${truth.name}: gradino vero «${text('Grad. vero')}» contro ${truth.rungActual}`);
        // The season predicted, as it went: the three kinds of missed games are the file's (the SECOND «Inf.»
        // and «Squal.» of the header row; the first two are the season measured).
        const late = (name) => row.cells[seen.heads.lastIndexOf(name) - (row.span ? 8 : 0)];
        for (const [head, key] of [['Inf.', 'inj'], ['Squal.', 'susp'], ['Naz.', 'naz']]) {
          const want = truth.next ? String(truth.next[key]) : '—';
          if (late(head) !== want) bad.push(`${truth.name}: ${head} nella stagione prevista «${late(head)}» contro ${want}`);
        }
        checked += 1;
      }
      note(`tabella ${window}`, `${seen.rows.length} righe, ${checked} confrontate col file; riepilogo «${seen.summary.slice(0, 140)}»`, bad);
    }

    // THE HEADER STAYS AT THE TOP and «Pa formula» is bold (operator, 01/10/2026): the table's own scroller is
    // moved down and the header must still sit on its top edge, with an opaque ground under it.
    const sticky = await evaluate(session, () => {
      const scroller = document.querySelector('[data-presence-scroller]');
      const head = scroller?.querySelector('thead th');
      const bold = document.querySelector('[data-presence-pa-formula]');
      if (!scroller || !head || !bold) return null;
      scroller.scrollTop = 600;
      const drift = Math.abs(head.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
      const ground = getComputedStyle(head).backgroundColor;
      return { scrolled: scroller.scrollTop, drift, ground, weight: Number(getComputedStyle(bold).fontWeight) };
    });
    const stickyBad = [];
    if (!sticky) stickyBad.push("manca il contenitore, l'intestazione o la cella del Pa formula");
    else {
      if (!sticky.scrolled) stickyBad.push('la tabella non scorre dentro il suo contenitore');
      if (sticky.drift > 1.5) stickyBad.push(`l'intestazione si stacca dal bordo di ${sticky.drift.toFixed(1)}px`);
      if (/rgba\(0, 0, 0, 0\)|transparent/.test(sticky.ground)) stickyBad.push("l'intestazione ha un fondo trasparente");
      if (sticky.weight < 700) stickyBad.push(`Pa formula ha peso ${sticky.weight}, non grassetto`);
    }
    note('intestazione fissa', sticky ? `scorsa di ${sticky.scrolled}px, scarto ${sticky.drift.toFixed(1)}px, peso Pa ${sticky.weight}` : 'niente', stickyBad);

    const shot = argv.indexOf('--shot');
    if (shot >= 0 && argv[shot + 1]) {
      const image = await session.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(argv[shot + 1], Buffer.from(image.data, 'base64'));
      console.log(`screenshot: ${argv[shot + 1]}`);
    }
    const noise = session.noise();
    note('console', `${noise.length} messaggi`, noise.slice(0, 5));
  } finally {
    session?.close();
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
      spawnSync('powershell', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${profile}*' } | `
        + 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], { stdio: 'ignore' });
    } else browser.kill();
    server.close();
    await wait(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  console.log(problems.length ? `\n${problems.length} PROBLEMI` : '\nNESSUN PROBLEMA');
  process.exit(problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
