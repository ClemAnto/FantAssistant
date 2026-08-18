/**
 * e2e-table.mjs - drive the REAL app in a browser and MEASURE the table.
 *
 * Why a browser and not a unit test. The defects this harness exists for are all invisible to jsdom: the
 * columns are laid out by `nzTableLayout="fixed"` (a `<colgroup>` nobody writes by hand), the rows arrive
 * by SCROLLING (`lazy-rows.ts`), and the reorder is a CDK drag driven by pointer events. A jsdom test
 * asserting «the header has 15 cells» passes while the screen shows holes - the family of defect this
 * project keeps paying for: verify the FUNCTION, not the column that looks like it.
 *
 * Zero dependencies on purpose (Node 24 has `fetch` and `WebSocket`): a harness that needs an install is
 * a harness nobody runs. It serves `dist/` itself, launches Edge or Chrome headless, speaks CDP, and
 * reports three things:
 *
 *   * ALIGNMENT - every header cell over its own body cell, before and after a drag. A mismatch of counts
 *     or of left edges is what «buchi / disallineamenti» looks like in numbers.
 *   * SORTING - click a numeric header, load EVERY row by scrolling, and check the column is monotone.
 *     Sorting only what is on screen reads as a sorted table until you scroll.
 *   * PERSISTENCE - reload and check the chosen sort and the column order are still there.
 *
 * Usage: node scripts/e2e-table.mjs [--headed] [--path "/?vista=ratings"] [--column Overall] [--json]
 */
import { spawn } from 'node:child_process';
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
const value = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** The dist folder, served with the SPA fallback the router needs. */
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

/** A CDP session on the browser's first page target. */
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
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
  return { send, close: () => socket.close() };
}

/** Run a function in the page and bring back its value. Throws what the page threw. */
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

/** Header labels, first-row cells and the colgroup: the three things a hole shows up in. */
function readTable() {
  const table = document.querySelector('nz-table table') ?? document.querySelector('table');
  if (!table) return null;
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { left: Math.round(rect.left), width: Math.round(rect.width) };
  };
  const head = table.querySelector('thead tr');
  const first = table.querySelector('tbody tr');
  return {
    head: [...head.querySelectorAll('th')].map((th) => ({
      label: (th.innerText || '').trim().split('\n')[0], ...box(th),
    })),
    body: first ? [...first.querySelectorAll('td')].map((td) => ({
      text: (td.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 20), ...box(td),
    })) : [],
    cols: [...table.querySelectorAll('colgroup col')].map((col) => col.style.width || ''),
    rows: table.querySelectorAll('tbody tr').length,
  };
}

/** Every loaded row's value in one column, as a number where it is one. */
function readColumn(label) {
  const table = document.querySelector('nz-table table') ?? document.querySelector('table');
  const heads = [...table.querySelectorAll('thead th')];
  const at = heads.findIndex((th) => (th.innerText || '').trim().startsWith(label));
  if (at < 0) return { at, values: [] };
  const values = [...table.querySelectorAll('tbody tr')].map((row) => {
    const cell = row.querySelectorAll('td')[at];
    const text = (cell?.innerText || '').trim().replace('~', '').replace(',', '.');
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  });
  return { at, values };
}

/**
 * Does a header still carry its STATIC classes next to the bound one?
 *
 * `class="text-right"` and `[class]="dragMark(key)"` live on the same `th`, and Angular merging the two is
 * the kind of thing that must be seen rather than believed: if the binding replaced the static class, every
 * numeric header would silently go left-aligned while the cells under it stayed right.
 */
function headClasses(label) {
  const heads = [...document.querySelectorAll('nz-table thead th')];
  const th = heads.find((one) => (one.innerText || '').trim().startsWith(label));
  return th ? [...th.classList] : null;
}

/** Click a header by its label - what a user does to sort. */
function clickHead(label) {
  const heads = [...document.querySelectorAll('nz-table thead th')];
  const th = heads.find((one) => (one.innerText || '').trim().startsWith(label));
  if (!th) return false;
  (th.querySelector('.ant-table-column-sorters') ?? th).click();
  return true;
}

/**
 * The reading scale: the star columns carry no TEXT, so a numeric check on them is vacuous.
 *
 * This harness reported «nessun problema» on a sort that was never measured, which is exactly the defect
 * the root CLAUDE.md names: an audit that returns zero failures is indistinguishable from a clean page.
 */
function chooseScore() {
  const labels = [...document.querySelectorAll('label[nz-radio-button], label')];
  const button = labels.find((one) => (one.innerText || '').trim() === '0-99');
  if (!button) return false;
  button.click();
  return true;
}

/**
 * Seed the saved column order, which is the state a reorder LEAVES BEHIND.
 *
 * It is how the rendering gets tested apart from the gesture: if a seeded order draws holes, the defect is
 * in the table and not in the drag, and the two need opposite cures.
 */
function seedOrder(order) {
  localStorage.setItem('fantassistant.squad.order', JSON.stringify(order));
  return localStorage.getItem('fantassistant.squad.order');
}

/** What the app has written down about the table: the preferences that must survive a refresh. */
function storedState() {
  const out = {};
  for (let at = 0; at < localStorage.length; at += 1) {
    const key = localStorage.key(at);
    if (key?.startsWith('fantassistant.squad')) out[key] = localStorage.getItem(key);
  }
  return out;
}

/** Is CDK actually dragging? The preview only exists while a drag is live. */
function dragging() {
  const shifted = [...document.querySelectorAll('nz-table thead th')]
    .map((th) => ({ label: (th.innerText || '').trim().split('\n')[0], moved: th.style.transform || '' }))
    .filter((one) => one.moved);
  return {
    preview: !!document.querySelector('.cdk-drag-preview'),
    placeholder: !!document.querySelector('.cdk-drag-placeholder'),
    dragging: !!document.querySelector('.cdk-drop-list-dragging'),
    // WHETHER CDK IS SORTING, which is a different question from whether it is dragging: while it sorts,
    // the siblings after the taken column carry an inline transform. None moving means the drop will
    // report the same index it started from, and the column will not move at all.
    shifted,
  };
}

/** Scroll to the bottom once: `lazy-rows` listens on the window. */
function scrollDown() {
  window.scrollTo(0, document.documentElement.scrollHeight);
  return document.querySelectorAll('nz-table tbody tr').length;
}

/** Where a header is, so a drag can start and end on real coordinates. */
function headBox(label) {
  const heads = [...document.querySelectorAll('nz-table thead th')];
  const th = heads.find((one) => (one.innerText || '').trim().startsWith(label));
  if (!th) return null;
  const rect = th.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}

// ------------------------------------------------------------------ the run

async function loadEveryRow(session) {
  let seen = 0;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = await evaluate(session, scrollDown);
    if (rows === seen) break;
    seen = rows;
    await wait(220);
  }
  return seen;
}

/**
 * Drag one header onto another with real mouse events, the way CDK expects them.
 *
 * Two things had to be measured rather than assumed. CDK starts a drag only after the pointer has moved
 * past `dragStartThreshold`, so the first move is a small jiggle and the rest walk to the target; and the
 * events must be POINTER events - dispatching `mousePressed` alone left `.cdk-drag-preview` absent and the
 * header order unchanged, which reads exactly like «the reorder does not work» when it is the harness
 * that never dragged. It returns what CDK was doing mid-flight, so a failed drag says so.
 */
async function dragHead(session, from, to) {
  const start = await evaluate(session, headBox, from);
  const end = await evaluate(session, headBox, to);
  if (!start || !end) throw new Error(`cannot find headers ${from} / ${to}`);
  const pointer = (type, x, y) => session.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
    pointerType: 'mouse',
  });
  await pointer('mousePressed', start.x, start.y);
  // Past the threshold first, slowly: CDK only begins to sort once it considers the drag started.
  for (const nudge of [3, 8, 16]) {
    await pointer('mouseMoved', start.x + nudge, start.y);
    await wait(60);
  }
  let live = null;
  const steps = 20;
  for (let step = 1; step <= steps; step += 1) {
    await pointer('mouseMoved',
      Math.round(start.x + ((end.x - start.x) * step) / steps),
      Math.round(start.y + ((end.y - start.y) * step) / steps));
    await wait(40);
    if (step === Math.round(steps / 2)) live = await evaluate(session, dragging);
  }
  await pointer('mouseMoved', end.x, end.y);
  await wait(120);
  await pointer('mouseReleased', end.x, end.y);
  await wait(600);
  return live;
}

function alignment(table) {
  if (!table) return ['no table on the page'];
  const problems = [];
  if (table.head.length !== table.body.length) {
    problems.push(`intestazioni ${table.head.length} contro celle ${table.body.length}`);
  }
  const pairs = Math.min(table.head.length, table.body.length);
  for (let at = 0; at < pairs; at += 1) {
    const gap = Math.abs(table.head[at].left - table.body[at].left);
    if (gap > 2) {
      problems.push(`colonna ${at} «${table.head[at].label || '(vuota)'}» a ${table.head[at].left}px, `
        + `cella «${table.body[at].text}» a ${table.body[at].left}px (${gap}px di scarto)`);
    }
  }
  const empty = table.head.filter((one) => !one.label).length;
  if (empty) problems.push(`${empty} intestazioni senza etichetta`);
  return problems;
}

const monotone = (values, direction) => {
  const known = values.filter((one) => one != null);
  for (let at = 1; at < known.length; at += 1) {
    if (direction === 'desc' ? known[at] > known[at - 1] + 1e-9 : known[at] < known[at - 1] - 1e-9) {
      return { ok: false, at, before: known[at - 1], after: known[at], of: known.length };
    }
  }
  return { ok: true, of: known.length };
};

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-e2e-'));
  const debugPort = Number(value('--port', '9333'));
  const path = value('--path', '/?vista=ratings');
  const url = `http://127.0.0.1:${port}${path}`;
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

    // The table arrives after the bundle: wait for a body row rather than for a fixed delay.
    let table = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      table = await evaluate(session, readTable);
      if (table?.rows) break;
      await wait(500);
    }
    if (!table?.rows) throw new Error('no rows ever appeared: the bundle did not load');
    // --shot: apri, aspetta, fotografa. Serve per i cambi VISIVI (il campetto), dove i passi della
    // tabella non c'entrano e non vale la pena pagarli.
    if (flag('--shot')) {
      await wait(Number(value('--settle', '2500')));
      const only = await session.send('Page.captureScreenshot', { format: 'png' });
      const where = value('--shot-to', join(ROOT, 'dist', 'e2e-shot.png'));
      await writeFile(where, Buffer.from(only.data, 'base64'));
      console.log(`· screenshot: ${where}`);
      report.screenshot = where;
      return;
    }

    const numericHead = await evaluate(session, headClasses, 'FMa');
    note('la tabella apre', {
      said: `${table.head.length} colonne (${table.head.map((one) => one.label || '(vuota)').join(',')}), `
        + `${table.rows} righe · «FMa» porta ${JSON.stringify(numericHead)}`,
      problems: [
        ...alignment(table),
        ...(numericHead?.includes('text-right')
          ? [] : ['l\'intestazione «FMa» ha perso la sua classe statica: il binding [class] l\'ha sostituita']),
      ],
    });

    // The star columns carry no text, so every numeric check on them would be vacuous: read 0-99.
    await evaluate(session, chooseScore);
    await wait(400);

    // ---------------------------------------------------------------- sorting over the WHOLE list
    //
    // THE INVARIANT IS NOT «the loaded rows are monotone». Sorting only the loaded slice ends up looking
    // sorted once everything is loaded, because each new slice is re-sorted with the rest. What it cannot
    // do is put the best man of the WHOLE listone on the first row while he is still unloaded - so the top
    // value is read with the first slice on screen and then compared with the maximum of all of them.
    //
    // And the DIRECTION is part of the invariant, which this harness got wrong once and is worth stating:
    // the table opens sorted by Overall DESCENDING, so a click is the second step of ng-zorro's cycle and
    // gives the ascending order. Asserting «a click gives the best first» measured the harness's
    // assumption and not the table.
    const column = value('--column', 'Overall');
    const checkSort = async (label, said, direction) => {
      const first = await evaluate(session, readColumn, label);
      const top = first.values.find((one) => one != null) ?? null;
      const rows = await loadEveryRow(session);
      const all = await evaluate(session, readColumn, label);
      const numbers = all.values.filter((one) => one != null);
      const edge = numbers.length
        ? (direction === 'desc' ? Math.max(...numbers) : Math.min(...numbers)) : null;
      const problems = [];
      if (numbers.length < 100) {
        problems.push(`solo ${numbers.length} numeri in «${label}»: il controllo non misura niente`);
      } else if (top == null) {
        problems.push(`la prima riga non porta un numero in «${label}»`);
      } else if (direction === 'desc' ? edge > top + 1e-9 : edge < top - 1e-9) {
        problems.push(`in cima c'era ${top}, ma ${direction === 'desc' ? 'il massimo' : 'il minimo'} `
          + `del listone è ${edge} - l'ordinamento ha visto solo le righe già caricate`);
      }
      note(said, {
        said: `cima ${top}, ${direction === 'desc' ? 'massimo' : 'minimo'} ${edge} `
          + `su ${numbers.length} numeri, ${rows} righe`,
        problems,
      });
    };

    // Come apre: il default è «Overall, dal migliore» e deve valere su TUTTO il listone, non sulle 60.
    await checkSort(column, `apre ordinata per ${column}, poi carica tutto`, 'desc');

    // ...e una colonna cliccata da zero: primo click = discendente (`highFirst`), sempre su tutta la lista.
    const clicked = value('--click', 'Fantapunti');
    await evaluate(session, clickHead, clicked);
    await wait(600);
    await checkSort(clicked, `cliccata «${clicked}», poi carica tutto`, 'desc');

    // ---------------------------------------------------------------- the drag
    const from = value('--drag', 'Squadra');
    const onto = value('--onto', 'Overall');
    const before = (await evaluate(session, readTable)).head.map((one) => one.label);
    const savedBefore = await evaluate(session, storedState);
    const live = await dragHead(session, from, onto);
    const after = await evaluate(session, readTable);
    const savedAfter = await evaluate(session, storedState);
    const moved = after.head.map((one) => one.label).join(',') !== before.join(',');
    note(`trascina «${from}» su «${onto}»`, {
      said: `${before.join(',')} → ${after.head.map((one) => one.label || '(vuota)').join(',')}`
        + ` · CDK a metà volo: ${JSON.stringify(live)}`
        + ` · su disco: ${savedBefore['fantassistant.squad.order'] === savedAfter['fantassistant.squad.order']
          ? 'invariato' : 'riscritto'} ${savedAfter['fantassistant.squad.order'] ?? '(niente)'}`,
      problems: [
        ...(moved ? [] : ['l\'ordine non è cambiato: il drag non è arrivato a destinazione']),
        ...alignment(after),
      ],
    });

    // ---------------------------------------------------------------- persistence
    const chosen = after.head.map((one) => one.label);
    await session.send('Page.navigate', { url });
    await wait(1500);
    let reloaded = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      reloaded = await evaluate(session, readTable);
      if (reloaded?.rows) break;
      await wait(500);
    }
    await evaluate(session, chooseScore);
    await wait(400);
    // La scelta salvata è quella che deve tornare, non una che ci piace: si legge dal disco e si verifica
    // che la tabella la rispetti - colonna E verso.
    const savedSort = await evaluate(session, storedState);
    const key = savedSort['fantassistant.squad.sort'];
    const way = savedSort['fantassistant.squad.sortWay'] === 'ascend' ? 'asc' : 'desc';
    const again = await evaluate(session, readColumn, clicked);
    const numbersAgain = again.values.filter((one) => one != null);
    const stillSorted = monotone(numbersAgain, way);
    // «Mercato» arrives only once the market curve is fetched, so it is in one reading and not in the
    // other: comparing the two lists raw reported a lost order that was never lost. Compare the columns
    // both readings actually offered.
    const common = (list) => list.filter((one) => one && one !== 'Mercato').join(',');
    const keptOrder = common(reloaded.head.map((one) => one.label)) === common(chosen);
    note('ricarica la pagina', {
      said: `colonne ${reloaded.head.map((one) => one.label || '(vuota)').join(',')}`
        + ` · sul disco «${key}» ${way} · ${numbersAgain.length} numeri in «${clicked}»`,
      problems: [
        ...(keptOrder ? [] : [`l'ordine delle colonne non è stato ripreso: era ${common(chosen)}`]),
        ...(numbersAgain.length >= 20 && stillSorted.ok
          ? [] : [`l'ordinamento scelto non è stato ripreso (${key} ${way}: `
            + `alla riga ${stillSorted.at} si passa da ${stillSorted.before} a ${stillSorted.after})`]),
        ...alignment(reloaded),
      ],
    });

    // ------------------------------------------------------- the rendering, apart from the gesture
    //
    // Seeded orders instead of drags: `--hunt N` reloads the page with N shuffled column orders and
    // measures the alignment of each. A drag leaves exactly this state behind, so a hole that shows up
    // here is a hole of the TABLE - and one that only shows up after a real drag is a hole of the drag.
    const hunt = Number(value('--hunt', '0'));
    const keys = ['mantra', 'club', 'codes', 'expected', 'expectedFm', 'expectedMv', 'surplus',
      'surplusFielded', 'value', 'fvm', 'market', 'mv', 'fm', 'overall', 'votes', 'bonus', 'presence'];
    for (let round = 1; round <= hunt; round += 1) {
      // Deterministic shuffle, so a failing round can be replayed: rotate by the round and swap a pair.
      const order = [...keys.slice(round % keys.length), ...keys.slice(0, round % keys.length)];
      const swap = round % (keys.length - 1);
      [order[swap], order[swap + 1]] = [order[swap + 1], order[swap]];
      await evaluate(session, seedOrder, order);
      await session.send('Page.navigate', { url });
      await wait(1200);
      let drawn = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        drawn = await evaluate(session, readTable);
        if (drawn?.rows) break;
        await wait(400);
      }
      note(`ordine seminato #${round}`, {
        said: `${order.slice(0, 4).join(',')}… → ${drawn.head.map((one) => one.label || '(vuota)').join(',')}`,
        problems: alignment(drawn),
      });
    }

    const shot = await session.send('Page.captureScreenshot', { format: 'png' });
    const out = value('--shot', join(ROOT, 'dist', 'e2e-table.png'));
    await writeFile(out, Buffer.from(shot.data, 'base64'));
    report.screenshot = out;
    console.log(`· screenshot: ${out}`);
  } finally {
    session?.close();
    browser.kill();
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  console.log(report.problems.length ? `\n${report.problems.length} PROBLEMI\n` : '\nnessun problema\n');
  if (flag('--json')) console.log(JSON.stringify(report, null, 1));
  process.exit(report.problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
