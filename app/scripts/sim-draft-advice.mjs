/**
 * A WHOLE DRAFT PLAYED ON THE ADVICE (operator, 01/10/2026: «fai un test simulando un draft completo seguendo i
 * consigli generati, poi analizza le rose e vedi se sono costruite bene o ci sono delle falle»).
 *
 * The real /auction page, on the invented table and the declared league (a fresh profile = his classic Serie A
 * rules), with AUTO on and `?autoMe`: every squad picks by itself, mine ALWAYS on the first of its three plans, the
 * rivals on one of their three drawn at random (the page's own AUTO). When the draft is over every squad is read off
 * the page - its roster (ids, roles, rung) and its pitch (module, each place's coverage, fertility and men) - and
 * written to a JSON file for the analysis. Read-only: nothing in the repository is touched.
 *
 * Usage: node scripts/sim-draft-advice.mjs [--out FILE] [--runs N] [--rivals human] [--headed]
 * `--rivals human`: the rivals play four human heads (FVM, a favourite club, instinct, the advice) instead of the advice.
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
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.sqlite': 'application/octet-stream',
};
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
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
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port })));
}

async function devToolsPort(profile) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const line = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0];
      if (line.trim()) return Number(line.trim());
    } catch { /* not yet */ }
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
    } catch { /* coming up */ }
    await wait(250);
  }
  const page = list?.find((one) => one.type === 'page');
  if (!page) throw new Error('no page target');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', fail, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const noise = [];
  const heads = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map((one) => one.value ?? one.description).join(' ');
      if (text.startsWith('[rivals=human]')) heads.push(text.slice('[rivals=human] '.length));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      noise.push(`ECCEZIONE: ${message.params?.exceptionDetails?.exception?.description ?? '?'}`.slice(0, 200));
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
  return { send, close: () => socket.close(), noise, heads };
}

async function evaluate(session, fn, ...args) {
  const expression = `(${fn.toString()})(${args.map((one) => JSON.stringify(one)).join(',')})`;
  const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
  return result.result.value;
}

const centre = (selector) => {
  const one = document.querySelector(selector);
  const rect = one?.getBoundingClientRect();
  return rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null;
};

function readTable() {
  return {
    mine: document.querySelector('[data-seat][data-mine]')?.getAttribute('data-seat') ?? null,
    seats: [...document.querySelectorAll('[data-seat]')].map((one) => ({
      id: one.getAttribute('data-seat'), picks: Number(one.getAttribute('data-picks')),
      label: (one.innerText ?? '').split('\n')[0].trim(),
    })),
    messages: [...document.querySelectorAll('.ant-message-notice')].map((one) => (one.innerText ?? '').trim()),
  };
}

function readPitch() {
  const section = document.querySelector('[data-column="pitch"]');
  return {
    team: section?.getAttribute('data-team') ?? null,
    module: document.querySelector('[data-module]')?.getAttribute('data-module') ?? null,
    places: [...document.querySelectorAll('[data-place]')].map((place) => ({
      slot: (place.querySelector('ui-role')?.innerText ?? '').trim(),
      cover: (place.querySelector('[data-place-cover]')?.innerText ?? '').trim(),
      fertility: (place.querySelector('[data-place-fertility]')?.innerText ?? '').trim(),
      men: [...place.querySelectorAll('[data-card-name]')].map((one) => (one.innerText ?? '').trim()),
      reserves: place.querySelectorAll('[data-reserve], [data-displaced]').length,
    })),
    unplaced: [...document.querySelectorAll('[data-unplaced]')].map((one) => (one.innerText ?? '').trim()),
  };
}

function readRoster() {
  return [...document.querySelectorAll('[data-roster]')].map((one) => ({
    id: Number(one.getAttribute('data-roster')), roles: one.getAttribute('data-roles') ?? '',
    turn: Number(one.getAttribute('data-turn')),
    name: (one.querySelector('[data-card-name]')?.innerText ?? '').trim(),
    rung: (one.querySelector('[data-rung]')?.innerText ?? '').trim() || null,
  }));
}

async function oneDraft(binary, base, run) {
  const profile = await mkdtemp(join(tmpdir(), 'fant-sim-draft-'));
  const browser = spawn(binary, [
    argv.includes('--headed') ? '--headless=false' : '--headless=new',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--window-size=1600,1000', `${base}/auction?autoMe${option('--rivals', null) ? `&rivals=${option('--rivals')}` : ''}`,
  ], { stdio: 'ignore' });
  let session;
  try {
    session = await attach(await devToolsPort(profile));
    await session.send('Runtime.enable');
    const mouse = async (where) => {
      if (!where) throw new Error('nothing to click');
      await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: where.x, y: where.y });
      for (const type of ['mousePressed', 'mouseReleased']) {
        await session.send('Input.dispatchMouseEvent', { type, x: where.x, y: where.y, button: 'left', clickCount: 1 });
      }
    };
    for (let tries = 0; tries < 120; tries += 1) {
      if (await evaluate(session, () => !!document.querySelector('[data-free]') && !!document.querySelector('[data-auto]'))) break;
      await wait(500);
    }
    await mouse(await evaluate(session, centre, '[data-auto]'));
    let table = await evaluate(session, readTable);
    const total = table.seats.length * 25;
    const started = Date.now();
    const stops = new Set();
    for (;;) {
      await wait(1000);
      table = await evaluate(session, readTable);
      for (const text of table.messages) if (text.startsWith('AUTO')) stops.add(text);
      const done = table.seats.reduce((sum, one) => sum + one.picks, 0);
      if (done >= total || stops.size || Date.now() - started > 25 * 60_000) break;
    }
    const done = table.seats.reduce((sum, one) => sum + one.picks, 0);
    console.log(`run ${run}: ${done}/${total} scelte in ${Math.round((Date.now() - started) / 1000)}s${stops.size ? ` - ${[...stops].join(' | ')}` : ''}`);
    const squads = [];
    for (const seat of table.seats) {
      await mouse(await evaluate(session, (id) => {
        const rect = document.querySelector(`[data-seat="${id}"]`)?.getBoundingClientRect();
        return rect ? { x: Math.round(rect.left + 40), y: Math.round(rect.top + rect.height / 2) } : null;
      }, seat.id));
      await wait(400);
      await mouse(await evaluate(session, centre, '[data-pitch-view="lista"]'));
      await wait(300);
      const roster = await evaluate(session, readRoster);
      await mouse(await evaluate(session, centre, '[data-pitch-view="campo"]'));
      await wait(400);
      const pitch = await evaluate(session, readPitch);
      squads.push({ seat: seat.id, label: seat.label, mine: seat.id === table.mine, roster, pitch });
    }
    return { run, done, total, stops: [...stops], noise: session.noise.slice(0, 10), heads: session.heads, squads };
  } finally {
    session?.close();
    browser.kill();
    if (process.platform === 'win32' && browser.pid) spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
    await wait(500);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('no build: run `ng build` first');
  const binary = BROWSERS.find((one) => existsSync(one));
  const { server, port } = await serve(DIST);
  const runs = Number(option('--runs', '1'));
  const out = [];
  try {
    for (let run = 1; run <= runs; run += 1) out.push(await oneDraft(binary, `http://127.0.0.1:${port}`, run));
  } finally {
    server.close();
  }
  const file = option('--out', join(tmpdir(), 'sim-draft-advice.json'));
  await writeFile(file, JSON.stringify(out, null, 1), 'utf-8');
  console.log(`scritto ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
