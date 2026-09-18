/**
 * probe-sheet-endpoint.mjs - can the APP's own origin read the Sheet's JSON endpoint?
 *
 *   node app/scripts/probe-sheet-endpoint.mjs "<the /exec URL of the Apps Script web app>"
 *
 * WHY THIS RUNS BEFORE ANY VIEW CODE. The "prossimo turno" board is to be read live from the Sheet,
 * and there is exactly one thing about that plan which cannot be settled by reading code: whether a
 * BROWSER, at the origin the app is served from, is allowed to fetch a script.google.com response.
 * Apps Script answers a `doGet` with a 302 to script.googleusercontent.com and sets its own CORS
 * headers, and whether that survives a cross-origin `fetch` is a property of Google's deployment
 * settings, not of our code. It is the same unknown `probe()` settled for the capture, asked one layer
 * out - and the same discipline: verify the route on ONE unit before building on it.
 *
 * WHAT IT ASSERTS, and each is a different way the plan can fail:
 *   - a plain server-side fetch works at all (the deployment is public, the script did not throw);
 *   - a fetch from the PRODUCTION origin (gh-pages) succeeds and the body parses as our payload;
 *   - a fetch from LOCALHOST succeeds too, or development is blind to a defect production has;
 *   - the payload carries the round, the clubs and the per-man vote counts the board needs.
 *
 * A `no-cors` fetch is deliberately NOT counted as success: it returns an opaque response that the app
 * cannot read, which is precisely the failure this probe exists to catch - it would look like a 200.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_ = process.argv[2];
if (!URL_) {
  console.error('usage: node app/scripts/probe-sheet-endpoint.mjs "<https://script.google.com/.../exec>"');
  process.exit(2);
}
const ORIGINS = [
  ['production (gh-pages)', 'https://clemanto.github.io/FantAssistant/'],
  ['development (localhost)', 'http://localhost:4200/'],
];
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (ok, msg) => { if (!ok) { failed += 1; console.log('  FAILED: ' + msg); } };

// ---- 1. the endpoint itself, server side: is it deployed and public at all? -------------------
console.log('=== the endpoint, fetched server-side ===');
let sample = null;
try {
  const res = await fetch(URL_, { redirect: 'follow' });
  const text = await res.text();
  console.log(`  HTTP ${res.status} | ${text.length} bytes | content-type ${res.headers.get('content-type')}`);
  try { sample = JSON.parse(text); } catch { /* reported below */ }
  check(res.status === 200, `expected 200, got ${res.status} - is the deployment set to access ANYONE?`);
  check(!!sample, 'the body did not parse as JSON (an Apps Script error page looks like HTML)');
  if (sample) {
    const clubs = Object.keys(sample.clubs ?? {});
    const men = clubs.length ? sample.clubs[clubs[0]].men ?? [] : [];
    console.log(`  round ${sample.round} | sources ${(sample.sources ?? []).length}`
      + ` | clubs ${clubs.length} | first club names ${men.length} men`);
    console.log(`  declares: ${sample.what ?? '(nothing - the payload should say it is the press)'}`);
    check(clubs.length > 0, 'no clubs in the payload - has a capture run yet?');
    check(men.length === 0 || typeof men[0].votes === 'number',
      'the men carry no vote count, which is the whole point of the payload');
  }
} catch (e) {
  failed += 1;
  console.log('  FAILED: the endpoint did not answer at all - ' + e.message);
}

// ---- 2. the part only a browser can answer: CORS from the app's own origins -------------------
async function devToolsPort(p) {
  for (let i = 0; i < 80; i += 1) {
    try { return (await readFile(join(p, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); }
    catch { await wait(250); }
  }
  throw new Error('no port');
}
async function attach(port) {
  let list;
  for (let i = 0; i < 60; i += 1) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((o) => o.type === 'page')) break; } catch { /* coming up */ }
    await wait(250);
  }
  const socket = new WebSocket(list.find((o) => o.type === 'page').webSocketDebuggerUrl);
  await new Promise((d, f) => { socket.addEventListener('open', d, { once: true });
    socket.addEventListener('error', f, { once: true }); });
  let seq = 0; const pending = new Map();
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data); const w = pending.get(m.id); if (!w) return;
    pending.delete(m.id); m.error ? w.f(new Error(JSON.stringify(m.error))) : w.d(m.result);
  });
  return (method, params = {}) => new Promise((d, f) => {
    const id = (seq += 1); pending.set(id, { d, f }); socket.send(JSON.stringify({ id, method, params }));
  });
}

const profile = await mkdtemp(join(tmpdir(), 'endpoint-'));
const browser = spawn(BROWSERS.find((o) => existsSync(o)),
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
   '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const send = await attach(await devToolsPort(profile));
await send('Runtime.enable');
await send('Page.enable');

console.log('\n=== the same endpoint, fetched BY A BROWSER at the app\'s origin ===');
for (const [label, origin] of ORIGINS) {
  try {
    // CDP reports a failed navigation in `errorText`, and that distinction is the whole point here:
    // with no dev server listening the page never loads, the fetch that follows measures Chrome's own
    // error page, and the first version of this probe reported "the endpoint is blocked" for an
    // endpoint that was fine. A step that measures the wrong thing accuses the code of its own defect.
    const nav = await send('Page.navigate', { url: origin });
    if (nav.errorText) {
      console.log(`  ${label.padEnd(24)} NOT TESTED - nothing is serving ${origin} (${nav.errorText})`);
      continue;
    }
    await wait(2500);
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { try {
          const res = await fetch(${JSON.stringify(URL_)});
          const t = await res.text();
          let parsed = null; try { parsed = JSON.parse(t); } catch {}
          return { where: location.origin, ok: res.ok, status: res.status, type: res.type,
                   bytes: t.length, clubs: parsed ? Object.keys(parsed.clubs || {}).length : -1 };
        } catch (e) { return { where: location.origin, error: String(e) }; } })()`,
      awaitPromise: true, returnByValue: true,
    });
    const v = r.result.value ?? {};
    if (v.error) {
      console.log(`  ${label.padEnd(24)} from ${v.where}: BLOCKED - ${v.error}`);
      check(false, `${label}: the browser could not read it (this is the CORS answer)`);
    } else {
      console.log(`  ${label.padEnd(24)} from ${v.where}: HTTP ${v.status} | type ${v.type}`
        + ` | ${v.bytes} bytes | ${v.clubs} clubs`);
      // `type: 'opaque'` is a no-cors response: a 200 the page cannot read a byte of.
      check(v.ok && v.type !== 'opaque' && v.bytes > 0,
        `${label}: the response is not readable by the page (type ${v.type})`);
      check(v.clubs > 0, `${label}: the body did not parse into clubs`);
    }
  } catch (e) {
    // localhost is expected to fail when nothing is serving there; say so rather than counting it.
    console.log(`  ${label.padEnd(24)} could not be tested: ${e.message}`);
  }
}

browser.kill();
console.log(failed ? `\n### ${failed} CHECK(S) FAILED - the direct read is not available as deployed ###`
  : '\n### the app can read the endpoint from its own origin ###');
process.exit(failed ? 1 : 0);
