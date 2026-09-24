/**
 * Stampa l'HTML in PDF con Chrome headless e MISURA il risultato: quante pagine, e quanto del
 * foglio e' rimasto fuori. Un A4 solo e' un requisito, quindi si conta invece di sperarlo.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const HTML = resolve(process.argv[2] ?? 'campetti.html');
const PDF = resolve(process.argv[3] ?? 'campetti.pdf');
const SHOT = process.argv.includes('--shot');
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
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
    const file = join(dir, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      const type = extname(file) === '.html' ? 'text/html' : 'application/octet-stream';
      response.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((one) => one.type === 'page')) break;
    } catch {
      /* still coming up */
    }
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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
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
  return { send, close: () => socket.close() };
}

async function evaluate(session, fn) {
  const result = await session.send('Runtime.evaluate', {
    expression: `(${fn.toString()})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
  return result.result.value;
}

/** Quanto il foglio DEBORDA dal suo contenitore, e quante righe e club ha davvero disegnato. */
function measure() {
  const sheet = document.querySelector('.sheet');
  const clubs = [...document.querySelectorAll('.club')];
  const rows = [...document.querySelectorAll('.row')];
  const box = sheet.getBoundingClientRect();
  let widest = 0;
  let clipped = 0;
  const worst = [];
  for (const cell of document.querySelectorAll('.n')) {
    const lost = cell.scrollWidth - cell.clientWidth;
    if (lost > 1) { clipped += 1; worst.push(`${cell.innerText.trim()} -${lost}px`); }
  }
  worst.sort((a, b) => Number(b.split('-').pop().replace('px','')) - Number(a.split('-').pop().replace('px','')));
  for (const club of clubs) {
    const rect = club.getBoundingClientRect();
    widest = Math.max(widest, rect.right);
  }
  // QUALE FACCIA STA DIPINGENDO: non `document.fonts.check`, che riecheggia la dichiarazione - la
  // larghezza della STESSA stringa nella faccia e nel suo ripiego. Se coincidono, la condensata non
  // c'e' e tutte le misure di larghezza qui sopra valgono per un altro font.
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:40px';
  probe.textContent = 'Milinkovic-Savic 10.5';
  document.body.appendChild(probe);
  probe.style.fontFamily = "'Arial Narrow'";
  const narrow = probe.getBoundingClientRect().width;
  probe.style.fontFamily = 'Arial';
  const arial = probe.getBoundingClientRect().width;
  probe.remove();
  // IL CORSIVO SI VERIFICA SUL COMPUTED STYLE e non sulla classe: una classe che nessuna regola
  // raggiunge legge come una feature che c'e'. E si conta anche quante celle NON lo sono, o
  // «tutte in corsivo» passerebbe.
  const synth = [...document.querySelectorAll('.past.synth')];
  const upright = [...document.querySelectorAll('.past:not(.synth)')].filter((one) => one.innerText.trim());
  const italic = synth.filter((one) => getComputedStyle(one).fontStyle === 'italic').length;
  const wrongUpright = upright.filter((one) => getComputedStyle(one).fontStyle === 'italic').length;
  const marks = {
    up: document.querySelectorAll('.tri.up').length,
    down: document.querySelectorAll('.tri.down').length,
  };
  let content = 0;
  for (const club of clubs) content += club.getBoundingClientRect().height + 4;
  return {
    narrowWidth: Math.round(narrow),
    arialWidth: Math.round(arial),
    narrowIsReal: Math.abs(narrow - arial) > 1,
    contentHeight: Math.round(content),
    columnsNeeded: +(content / box.height).toFixed(2),
    synthCells: synth.length,
    synthItalic: italic,
    uprightCells: upright.length,
    uprightWronglyItalic: wrongUpright,
    marks,
    clubs: clubs.length,
    rows: rows.length,
    sheetHeight: Math.round(box.height),
    scrollHeight: sheet.scrollHeight,
    overflowRight: Math.round(widest - box.right),
    clippedNames: clipped,
    worstNames: worst.slice(0, 6),
    lastClub: clubs.at(-1)?.querySelector('.head span')?.innerText ?? '?',
  };
}

async function main() {
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');
  const { server, port } = await serve(resolve('.'));
  const profile = await mkdtemp(join(tmpdir(), 'fant-pdf-'));
  const debugPort = await freePort();
  const url = `http://127.0.0.1:${port}/${HTML.split(/[\\/]/).pop()}`;
  const browser = spawn(
    binary,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1400,1000',
      url,
    ],
    { stdio: 'ignore' },
  );
  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    // SI MISURA IN CONDIZIONI DI STAMPA: il viewport dell'A4 orizzontale meno i margini e il media
    // `print`, o si misura come sta sullo SCHERMO - che e' un'altra larghezza e un'altra risposta.
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1123, height: 794, deviceScaleFactor: 1, mobile: false,
    });
    await session.send('Emulation.setEmulatedMedia', { media: 'print' });
    await session.send('Page.navigate', { url });
    await wait(1200);
    const seen = await evaluate(session, measure);
    const print = await session.send('Page.printToPDF', {
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    });
    const bytes = Buffer.from(print.data, 'base64');
    await writeFile(PDF, bytes);
    const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    console.log(JSON.stringify({ ...seen, pdfPages: pages, bytes: bytes.length }, null, 1));
    if (SHOT) {
      const shot = await session.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: process.argv.includes('--zoom')
          ? { x: 8, y: 8, width: 230, height: 130, scale: 9 }
          : { x: 0, y: 0, width: 1123, height: 794, scale: 2 },
      });
      await writeFile(PDF.replace(/\.pdf$/, '.png'), Buffer.from(shot.data, 'base64'));
    }
  } finally {
    session?.close();
    browser.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
