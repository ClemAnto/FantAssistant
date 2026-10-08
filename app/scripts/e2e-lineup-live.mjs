/**
 * LIVE check of the Formazione page (08/10/2026): drives `/lineup` under `ng serve` against the REAL Leghe
 * account in the repository's `.env` (FANTACALCIO_USERNAME / FANTACALCIO_PASSWORD, never printed):
 * EuroLeghe direct login, Leghe embedded login, then reads what the page shows. Read-only on Leghe.
 *
 *   npm start -- --port 4321          (in another shell)
 *   node scripts/e2e-lineup-live.mjs 4321
 *
 * Screenshots go to the OS temp folder: they carry the operator's roster and league names, and the
 * repository is public.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.argv[2] ?? '4321';
const URL0 = `http://localhost:${PORT}/lineup`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SHOTS = join(tmpdir(), 'e2e-lineup-live');
await mkdir(SHOTS, { recursive: true });

// Credentials from the repository's .env, the only place they live.
const ENV = {};
for (const line of readFileSync(join(import.meta.dirname, '..', '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
  if (m) ENV[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const USER = ENV.FANTACALCIO_USERNAME;
const PASS = ENV.FANTACALCIO_PASSWORD;
if (!USER || !PASS) throw new Error('FANTACALCIO_USERNAME / FANTACALCIO_PASSWORD missing in .env');

const prof = await mkdtemp(join(tmpdir(), 'e2e-lineup-'));
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--window-size=1400,1100', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const [port] = (await readFile(join(prof, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const frames = []; const problems = [];
const send = (method, params = {}, sessionId) => new Promise((r) => { const m = ++id; pending.set(m, r); ws.send(JSON.stringify({ id: m, method, params, sessionId })); });
let pageSession = null;
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown' && msg.sessionId === pageSession) problems.push('exception: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 200));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error' && msg.sessionId === pageSession) problems.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  if (msg.method === 'Target.attachedToTarget') {
    const s = msg.params.sessionId;
    send('Runtime.enable', {}, s);
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, s);
    frames.push({ s, type: msg.params.targetInfo.type });
  }
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evalIn = async (s, expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, s)).result?.result?.value;
const ev = (expression) => evalIn(pageSession, expression);
const until = async (expression, ms = 20000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expression)) return true; await wait(250); } return false; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }, pageSession); await writeFile(join(SHOTS, name), Buffer.from(r.result.data, 'base64')); };
const type = async (s, selector, text) => { await evalIn(s, `document.querySelector(${JSON.stringify(selector)}).focus()`); await send('Input.insertText', { text }, s); };

try {
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  pageSession = (await send('Target.attachToTarget', { targetId, flatten: true })).result.sessionId;
  await send('Runtime.enable', {}, pageSession);
  await send('Page.enable', {}, pageSession);
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession);
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1100, deviceScaleFactor: 1, mobile: false }, pageSession);
  await send('Page.navigate', { url: URL0 }, pageSession);
  console.log('page mounted:', await until(`!!document.querySelector('app-lineup [data-lineup-connect]')`));
  await shot('1-empty.png');

  // EuroLeghe, direct login.
  await ev(`document.querySelector('[data-lineup-connect]').click()`);
  console.log('modal open:', await until(`!!document.querySelector('[data-leghe-platform="euro"] input[name=username]')`));
  await type(pageSession, '[data-leghe-platform="euro"] input[name=username]', USER);
  await type(pageSession, '[data-leghe-platform="euro"] input[name=password]', PASS);
  await ev(`document.querySelector('[data-leghe-platform="euro"] button[type=submit]').click()`);
  console.log('euro connected:', await until(`/collegato/.test(document.querySelector('[data-leghe-platform="euro"]').innerText)`));
  console.log('euro problem:', await ev(`document.querySelector('[data-leghe-platform="euro"] nz-alert')?.innerText ?? null`));

  // Leghe, embedded login inside the modal: the iframe is out-of-process, so it is found by its location.
  await ev(`[...document.querySelectorAll('[data-leghe-platform="classic"] button')].find(b => /Accedi/.test(b.innerText)).click()`);
  let frame = null;
  for (let t = 0; t < 40 && !frame; t++) {
    await wait(500);
    for (const f of frames.filter((f) => f.type === 'iframe')) {
      if (/leghe\.fantacalcio\.it/.test((await evalIn(f.s, 'location.href')) ?? '')) frame = f;
    }
  }
  console.log('embed iframe attached:', !!frame);
  if (frame) {
    for (let t = 0; t < 40; t++) { if (await evalIn(frame.s, `!!document.querySelector('input[type=password]')`)) break; await wait(500); }
    await type(frame.s, 'input[type=text]', USER);
    await type(frame.s, 'input[type=password]', PASS);
    await evalIn(frame.s, `(document.querySelector('button[type=submit]') || [...document.querySelectorAll('button')].find(b => /login|accedi/i.test(b.innerText)))?.click()`);
    console.log('classic connected:', await until(`/collegato/.test(document.querySelector('[data-leghe-platform="classic"]').innerText)`));
  }
  await shot('2-modal.png');

  // Close the modal and read the page: the league stays the one first shown, which is the point of
  // pinning it - a second login must not swap the page under the operator.
  await ev(`document.querySelector('.ant-modal-close')?.click()`);
  console.log('matchday shown:', await until(`!!document.querySelector('[data-lineup-matchday]')`, 40000));
  await wait(1500);
  const read = await ev(`(() => ({
    league: document.querySelector('[data-lineup-league] .ant-select-selection-item')?.innerText ?? null,
    competitions: [...document.querySelectorAll('[data-lineup-matchday] li')].map(li => li.innerText.replace(/\\s+/g, ' ')),
    closes: document.querySelector('[data-lineup-matchday] > div')?.innerText.replace(/\\s+/g, ' '),
    rules: document.querySelectorAll('[data-lineup-rules] dt').length,
    rosterRows: document.querySelectorAll('[data-lineup-roster] tbody tr[data-fc-id]').length,
    placed: [...document.querySelectorAll('[data-lineup-roster] tbody tr[data-fc-id]')].filter(tr => /Titolare|Panchina/.test(tr.innerText)).length,
    error: document.querySelector('app-lineup nz-alert')?.innerText ?? null,
  }))()`);
  console.log(JSON.stringify(read, null, 1));
  await shot('3-page.png');
} finally {
  console.log(problems.length ? problems.join('\n') : 'no page exceptions');
  console.log(`screenshots in ${SHOTS}`);
  browser.kill();
  ws.close();
}
