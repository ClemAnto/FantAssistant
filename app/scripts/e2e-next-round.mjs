/**
 * «PROSSIMO TURNO» sulla pagina Squadre, guidato con un puntatore vero.
 *
 *   node app/scripts/e2e-next-round.mjs ["<url dell'endpoint>"]
 *
 * IL CONFRONTO E' COL FOGLIO E MAI CON LO SCHERMO. Il payload si scarica QUI, da Node, e ogni numero
 * disegnato si verifica contro di lui: confrontare la pagina con qualcosa ricavato dalla pagina e'
 * l'asserzione circolare che questo repository ha gia' pagato due volte (la card del 04/09, il banco
 * della plancia del 05/09). Quello che NON si rifa' qui e' la riduzione - chi entra, chi contende, chi
 * resta fuori: quella e' provata dai test di `next-round.spec.ts` sul dato sintetico, e riscriverla qui
 * sarebbe una seconda implementazione che puo' divergere. Qui si controllano i FATTI del payload (quali
 * nomi, con quanti voti su quante fonti) e le INVARIANTI dichiarate della lettura.
 *
 * COSA MISURA, e ogni passo dice su quante cose ha guardato:
 *   - il terzo pulsante c'e' accanto ai due orizzonti, e la pagina apre sulla NOSTRA board;
 *   - un click vero su «Prossimo turno» disegna la lettura delle fonti e TOGLIE il nostro campetto;
 *   - ogni nome a schermo e' un nome che il payload porta per quel club, e i suoi voti sono i suoi;
 *   - nessun nome del payload e' sparito per strada;
 *   - certi + maglie contese = 11, e una contesa non ha mai UN uomo solo (si contenderebbe con se');
 *   - il MODULO stampato e' un'affermazione falsificabile sul disegno accanto: le sue cifre sono i posti
 *     che ogni riga deve avere, e non serve nessuna fonte esterna per smentirla.
 *
 * SALTA DICENDOLO, con quante cose ha guardato, se l'endpoint non risponde o se nessun club del payload
 * si aggancia al pacchetto: un «nessun problema» dopo aver guardato niente e' peggio di un rosso.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'fantassistant', 'browser');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gz': 'application/gzip', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// L'indirizzo arriva dalla riga di comando, o da quello che l'app distribuisce come predefinito: una
// seconda copia scritta qui direbbe un'altra cosa il giorno di una nuova distribuzione.
const FROM_CODE = readFileSync(join(ROOT, 'src/app/core/next-round-store.ts'), 'utf8')
  .match(/(https:\/\/script\.google\.com\/[^'"\s]+)/);
const URL_ = process.argv[2] ?? (FROM_CODE ? FROM_CODE[1] : null);
// IL CLUB SI PUO' NOMINARE, e il default NON e' «quello che fa passare il banco»: e' quello che il
// pacchetto aggancia meglio. Serve a guardare un club dove il modulo si deduce E uno dove non si deduce,
// che sono due rami diversi e vanno visti tutti e due - non a scegliere il caso comodo.
const WANT_CLUB = process.argv[3] ?? null;

function serve(dir) {
  return new Promise((done) => {
    const server = createServer((req, res) => {
      const path = decodeURIComponent(req.url.split('?')[0]);
      let file = join(dir, path);
      if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        ...(extname(file) === '.gz' ? { 'content-encoding': 'gzip' } : {}) });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port }));
  });
}
async function devToolsPort(p) {
  for (let i = 0; i < 80; i += 1) {
    try { return (await readFile(join(p, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); }
    catch { await wait(250); }
  }
  throw new Error('no DevToolsActivePort');
}
async function attach(port) {
  let list;
  for (let i = 0; i < 60; i += 1) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (list.some((o) => o.type === 'page')) break; } catch { /* still coming up */ }
    await wait(250);
  }
  const socket = new WebSocket(list.find((o) => o.type === 'page').webSocketDebuggerUrl);
  await new Promise((d, f) => { socket.addEventListener('open', d, { once: true });
    socket.addEventListener('error', f, { once: true }); });
  let seq = 0; const pending = new Map(); const noise = [];
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') noise.push(String(m.params?.exceptionDetails?.text));
    const w = pending.get(m.id); if (!w) return;
    pending.delete(m.id); m.error ? w.f(new Error(JSON.stringify(m.error))) : w.d(m.result);
  });
  return { send: (method, params = {}) => new Promise((d, f) => {
    const id = (seq += 1); pending.set(id, { d, f });
    socket.send(JSON.stringify({ id, method, params })); }), noise };
}
async function ev(s, fn, ...args) {
  const r = await s.send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`,
    returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'threw');
  return r.result.value;
}
function skip(why, how) {
  console.log(`SALTATO · 0 controlli: ${why}`);
  if (how) console.log('  ' + how);
  process.exit(0);
}

// ---- 1. IL FOGLIO, letto qui -------------------------------------------------------------------
if (!URL_) skip("nessun indirizzo dell'endpoint", "passalo come primo argomento");
// ...E RITENTA COME FA L'APP, per la stessa ragione misurata: il secondo salto di Apps Script
// (`script.googleusercontent.com`) ha risposto 404 due volte su sei il 18/09/2026. Un banco che si
// arrendesse al primo 404 salterebbe una volta su tre, e un banco che salta a caso non e' un banco.
let payload = null;
let why = '';
for (let attempt = 1; attempt <= 3 && !payload; attempt += 1) {
  try {
    const res = await fetch(URL_, { redirect: 'follow' });
    const body = await res.text();
    if (!res.ok) { why = `HTTP ${res.status}`; await wait(600); continue; }
    payload = JSON.parse(body);
  } catch (error) {
    why = error.message;
    await wait(600);
  }
}
if (!payload) {
  skip(`il foglio non risponde dopo 3 tentativi (${why})`,
    'e questo banco misura cosa la pagina fa di quel payload');
}
const clubs = Object.entries(payload && payload.clubs ? payload.clubs : {});
if (!clubs.length) skip('il foglio non ha ancora nessuna presa', 'lancia «Capture now» dal suo menu');

// ---- 2. QUALE CLUB APRIRE, agganciato per `fc_id` -----------------------------------------------
// Il nome canonico del listone lo porta il pacchetto e l'aggancio passa dagli id: il payload chiama i
// club con la tabella di alias del foglio, e un join per stringa fra i due vocabolari e' il difetto che
// qui ha gia' perso Milan, Roma e Napoli una volta.
const boards = JSON.parse(readFileSync(join(DIST, 'data', 'boards', 'leghe.json'), 'utf8'));
const clubOf = new Map();
for (const [name, board] of Object.entries(boards.clubs ?? {})) {
  for (const man of Object.values(board?.lines ?? {}).flat()) {
    if (man?.fc_id) clubOf.set(Number(man.fc_id), name);
  }
}
let best = null;
for (const [, club] of clubs) {
  const votes = new Map();
  for (const man of club.men ?? []) {
    const name = man.fc_id ? clubOf.get(Number(man.fc_id)) : null;
    if (name) votes.set(name, (votes.get(name) ?? 0) + 1);
  }
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) continue;
  if (WANT_CLUB ? top[0] === WANT_CLUB : top[1] > (best?.hits ?? 0)) {
    best = { club, name: top[0], hits: top[1] };
  }
}
if (!best || best.hits < 3) {
  skip('nessun club del payload si aggancia al pacchetto per fc_id',
    'pacchetto e foglio potrebbero essere di due stagioni diverse');
}
console.log(`=== ${best.name} · turno ${payload.round} · ${clubs.length} club nel foglio`
  + ` · ${best.club.men.length} uomini nominati (${best.hits} agganciati al pacchetto) ===`);

// ---- 3. LA PAGINA -------------------------------------------------------------------------------
const binary = BROWSERS.find((o) => existsSync(o));
const profile = await mkdtemp(join(tmpdir(), 'nextround-'));
const { port } = await serve(DIST);
const browser = spawn(binary, ['--headless=new', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1600,1100',
  `http://127.0.0.1:${port}/clubs?platform=default&club=${encodeURIComponent(best.name)}`],
{ stdio: 'ignore' });
const s = await attach(await devToolsPort(profile));
await s.send('Runtime.enable');

const problems = [];
const look = () => ev(s, () => {
  const buttons = [...document.querySelectorAll('nz-radio-group label')].map((l) => {
    const box = l.getBoundingClientRect();
    return { text: l.textContent.trim(), on: l.className.includes('checked'),
      x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  // Una riga si riconosce da COSA E' (la sua banda), non da come e' dipinta: un banco che cercasse la
  // classe che sta verificando non potrebbe fallire su quella classe.
  const rows = [...document.querySelectorAll('ui-next-round li[data-band]')].map((li) => ({
    band: li.getAttribute('data-band'),
    name: (li.querySelector('[data-cell="name"]')?.textContent ?? '').trim(),
    votes: (li.querySelector('[data-cell="votes"]')?.textContent ?? '').trim(),
  }));
  // QUANDO NON C'E' NESSUNA RIGA LE RAGIONI SONO DUE E NON UNA - la vista non disegna, oppure il foglio
  // non ha risposto - e un banco che non le separa accusa il codice di un difetto della rete. Si legge
  // quello che la sezione DICE di se stessa: lo stato e' disegnato apposta, quindi basta guardarlo.
  const card = document.querySelector('section[data-board]');
  const clean = (node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // IL CAMPETTO: una riga per linea, un posto per maglia. Si legge il POSTO e non il nome, perche' un
  // posto che nessuno riempie e' l'affermazione piu' importante che questo disegno possa fare.
  const drawn = [...document.querySelectorAll('ui-next-round [data-line]')].map((row) => ({
    line: row.getAttribute('data-line'),
    places: [...row.querySelectorAll('[data-place]')].map((place) => ({
      // IL NOME SI CHIEDE ALLA CELLA DEL NOME e non a «chi ha un title»: le pastiglie del ruolo ne hanno
      // uno (Portiere, Difensore...), quindi la prima versione leggeva 22 nomi su 11 posti e accusava la
      // pagina di stampare uomini che il foglio non porta.
      names: [...place.querySelectorAll('[data-cell="name"]')].map((n) => n.textContent.trim()),
      votes: [...place.querySelectorAll('[data-cell="votes"]')].map((n) => n.textContent.trim()),
      contested: !!place.querySelector('[data-contested]'),
    })),
  }));
  return { buttons, rows, drawn,
    pitch: document.querySelectorAll('ui-club-board [data-place]').length,
    text: clean(document.querySelector('ui-next-round')),
    card: clean(document.querySelector('section[data-board]')),
    said: clean(document.querySelector('nz-alert')) || clean(card).slice(0, 200) };
});

let seen = null;
for (let i = 0; i < 200; i += 1) {
  seen = await look();
  if (seen?.buttons?.length) break;
  await wait(250);
}
const tabs = seen.buttons.filter((b) => /Stagione|Ultimo periodo|Prossimo turno/.test(b.text));
const lit = (list) => list.filter((b) => b.on).map((b) => b.text).join(', ') || 'nessuna';
console.log(`· il selettore ha ${tabs.length} voci (${tabs.map((b) => b.text).join(' / ')})`
  + ` · accesa: ${lit(tabs)}`);
if (!tabs.some((b) => b.text.includes('Prossimo turno'))) {
  problems.push("la voce «Prossimo turno» non e' a schermo");
}
if (lit(tabs) !== 'Stagione') problems.push(`all'apertura dovrebbe essere su Stagione, e' su ${lit(tabs)}`);
if (!seen.pitch) problems.push("all'apertura non c'e' il campetto della nostra board");

// ---- 4. IL CLICK VERO ---------------------------------------------------------------------------
const target = tabs.find((b) => b.text.includes('Prossimo turno'));
let after = seen;
if (target) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x: target.x, y: target.y, button: 'left',
      clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse' });
  }
  // L'ATTESA E' TARATA SU UNA MISURA E NON A OCCHIO: il secondo salto di Apps Script
  // (`script.googleusercontent.com`) ha risposto 404 due volte su sei il 18/09/2026, impiegandoci fino a
  // 27 secondi, e lo store ritenta tre volte. Un'attesa piu' corta di quella misurerebbe la pazienza del
  // banco invece della pagina, e leggerebbe «non disegna niente» su una lettura che stava arrivando.
  for (let i = 0; i < 480; i += 1) {
    after = await look();
    if (after.rows.length || /non risponde/.test(after.said)) break;
    await wait(250);
  }
} else {
  problems.push("nessun bottone «Prossimo turno» da premere");
}
console.log(`· dopo il click: ${after.rows.length} righe di lista e ${(after.drawn ?? []).length}`
  + ` righe di campetto · posti del campetto NOSTRO ancora a schermo: ${after.pitch}`);
if (!after.rows.length && !(after.drawn ?? []).length) {
  // La sezione dice da se' in quale dei quattro stati e': se e' `unreachable` il difetto e' di rete o
  // della distribuzione, non della vista, e il banco lo deve DIRE invece di accusare il codice. E si
  // accetta L'UNA O L'ALTRA forma - lista o campetto - o il banco leggerebbe «non disegna niente»
  // proprio dove la feature riesce meglio.
  console.log(`  la sezione dice: ${after.said || '(niente)'}`);
  problems.push('dopo il click ne' + "' lista ne' campetto · la sezione dice: "
    + (after.said || '(niente)').slice(0, 160));
}
if (after.pitch) problems.push('la nostra board e la lettura delle fonti sono a schermo insieme');

// ---- 5. OGNI NOME A SCHERMO CONTRO IL PAYLOAD ----------------------------------------------------
// LA LETTURA HA DUE FORME - il campetto quando il modulo si deduce, la lista quando no - e il banco
// deve leggere quella che c'e', non quella che si aspetta. Un passo che guardasse solo la lista
// direbbe «non disegna niente» proprio dove la feature funziona meglio.
const want = new Map((best.club.men ?? []).map((m) => [m.player, `${m.votes}/${m.of}`]));
const drawn = after.drawn ?? [];
const onPitch = drawn.flatMap((row) => row.places.flatMap(
  (place) => place.names.map((name, i) => ({ name, votes: place.votes[i] ?? '' }))));
const shown = after.rows.length ? after.rows : onPitch;
const mode = after.rows.length ? 'lista' : (onPitch.length ? 'campetto' : 'niente');
const wrong = shown.filter((one) => want.get(one.name) !== one.votes);
console.log(`· forma a schermo: ${mode} · ${shown.length} nomi`);
console.log(`· nomi a schermo che il foglio non conferma: ${wrong.length}`
  + (wrong.length ? ' -> ' + JSON.stringify(wrong.slice(0, 3)) : ''));
if (wrong.length) problems.push(`${wrong.length} nomi non combaciano col foglio`);

// CHI E' NOMINATO DA TUTTE LE FONTI NON PUO' RESTARE FUORI, ed e' un'invariante che non rifa' il
// taglio: se `of` fonti hanno letto quel club e un uomo ha `votes === of`, nessuno lo batte. Vale
// finche' gli unanimi non sono piu' di undici, che sarebbe un'altra storia e si dice.
const unanimous = (best.club.men ?? []).filter((m) => m.of > 0 && m.votes === m.of);
const lost = unanimous.length <= 11
  ? unanimous.filter((m) => !shown.some((one) => one.name === m.player)) : [];
console.log(`· unanimi ${unanimous.length} · fra loro, non disegnati: ${lost.length}`
  + (lost.length ? ' -> ' + lost.map((m) => m.player).join(', ') : ''));
if (lost.length) problems.push(`${lost.length} uomini nominati da TUTTE le fonti non sono a schermo`);

// In forma LISTA si pretende anche che non manchi nessuno: li' la lista li porta tutti.
if (after.rows.length) {
  const missing = [...want.keys()].filter((name) => !after.rows.some((r) => r.name === name));
  console.log(`· uomini del foglio che la lista non disegna: ${missing.length}`
    + (missing.length ? ' -> ' + missing.slice(0, 5).join(', ') : ''));
  if (missing.length) problems.push(`${missing.length} uomini del foglio non sono in lista`);
  const band = (name) => after.rows.filter((r) => r.band === name).length;
  const places = 11 - band('certain');
  console.log(`· certi ${band('certain')} · contesi ${band('contested')} per ${places} maglie`
    + ` · fuori ${band('out')}`);
  if (band('certain') > 11) problems.push(`${band('certain')} certi: un undici ne ha undici`);
  if (band('contested') === 1) problems.push('una contesa con UN uomo solo: si contende con se stesso');
  if (band('contested') && band('contested') <= places) {
    problems.push(`${band('contested')} uomini per ${places} maglie non e' una contesa: entrerebbero tutti`);
  }
}

// ---- 6. IL CAMPETTO ------------------------------------------------------------------------------
// IL MODULO E' UN'AFFERMAZIONE FALSIFICABILE SUL DISEGNO ACCANTO: le sue cifre sono i posti che ogni
// riga deve avere. Non serve nessuna fonte esterna per smentirla, che e' il genere di asserzione che
// regge anche il giorno in cui il payload cambia forma.
// I moduli hanno TRE o QUATTRO numeri (un 3-4-2-1 esiste e un modulo classic non lo sa dire): la
// regola vale identica, e una regex a tre cifre leggerebbe «nessun modulo» proprio sui piu' interessanti.
const shape = (after.text.match(/Modulo\s+(\d+(?:-\d+){2,3})/) ?? [])[1] ?? null;
if (shape) {
  const digits = shape.split('-').map(Number);
  const perRow = drawn.map((row) => row.places.length);
  const total = perRow.reduce((sum, one) => sum + one, 0);
  const empty = drawn.flatMap((row) => row.places.filter((one) => !one.names.length)).length;
  const contestedPlaces = drawn.flatMap((row) => row.places.filter((one) => one.contested)).length;
  console.log(`· campetto ${shape} · righe ${JSON.stringify(perRow)} · posti ${total}`
    + ` · nomi ${onPitch.length} · posti contesi ${contestedPlaces} · vuoti ${empty}`);
  if (digits.reduce((sum, one) => sum + one, 0) !== 10) {
    problems.push(`il modulo ${shape} non somma dieci uomini di movimento`);
  }
  if (JSON.stringify(perRow) !== JSON.stringify([1, ...digits])) {
    problems.push(`il disegno ha righe ${JSON.stringify(perRow)} e il modulo dice ${shape}`);
  }
  if (total !== 11) problems.push(`${total} posti disegnati: un undici ne ha undici`);
  // UN NOME UNA VOLTA SOLA. Vergara compariva sotto De Bruyne E sotto Lang, perche' i suoi codici lo
  // mettono su due righe: un uomo disegnato due volte fa leggere due ballottaggi dove ce n'e' uno.
  const twice = onPitch.map((one) => one.name)
    .filter((name, at, all) => all.indexOf(name) !== at);
  console.log(`· nomi disegnati piu' di una volta: ${twice.length}`
    + (twice.length ? ' -> ' + [...new Set(twice)].join(', ') : ''));
  if (twice.length) problems.push(`${[...new Set(twice)].join(', ')} disegnato piu' di una volta`);
  // Un posto con DUE nomi e' la maglia contesa, e ci stanno dentro tutti e due: se il disegno ne
  // scegliesse uno, la monetina sarebbe rotta proprio dove nessuno la guarda.
  // I DUE NOMI SI CONTANO SUI SOLI POSTI CONTESI. Da quando un posto porta anche l'ALTERNATIVA (chi le
  // fonti rimaste mettono al posto del titolare) un posto normale puo' avere due nomi, e contarli tutti
  // faceva leggere «il campetto ha scelto per noi» su una pagina che non aveva scelto niente: il banco
  // accusava il codice del proprio difetto, ennesima volta.
  const pairs = drawn.flatMap((row) => row.places
    .filter((one) => one.contested && one.names.length > 1)).length;
  if (contestedPlaces && contestedPlaces !== pairs) {
    problems.push('un posto conteso con un nome solo: il campetto ha scelto per noi');
  }
} else if (drawn.length) {
  problems.push('un campetto disegnato senza dire quale modulo');
} else {
  // NESSUN CAMPETTO E' UNA RISPOSTA LEGITTIMA - il modulo puo' non essere deducibile - ma DEVE avere
  // la sua ragione a schermo: un disegno che sparisce in silenzio si legge come un guasto.
  const said = (after.text.match(/Nessun campetto: ([^.]+)/) ?? [])[1] ?? null;
  console.log(`· nessun campetto · la ragione a schermo: ${said ?? '(NESSUNA)'}`);
  if (!said) problems.push('nessun campetto e nessuna ragione detta');
}

// La frase che dichiara cos'e' questa sezione viene dal payload: se sparisce, lo schermo smette di dire
// che sta mostrando la stampa e non una nostra previsione.
if (payload.what && !after.text.includes(payload.what.slice(0, 30))) {
  problems.push("la pagina non ripete quello che il payload dichiara di essere");
}

// ---- 7. LA LETTURA SALVATA, PROVATA COL FOGLIO IRRAGGIUNGIBILE -----------------------------------
// La prova che una lettura viene dal DISCO e non dalla rete non e' che compaia in fretta: e' che
// compaia mentre la rete non c'e'. Si blocca l'indirizzo e si ricarica - se il turno e' ancora li',
// arriva da `localStorage`, e non c'e' altra spiegazione possibile.
await s.send('Network.enable');
await s.send('Network.setBlockedURLs', { urls: ['*script.google.com*', '*googleusercontent.com*'] });
await s.send('Page.reload', { ignoreCache: false });
let cached = null;
for (let i = 0; i < 120; i += 1) {
  cached = await look();
  if (cached?.buttons?.length) break;
  await wait(250);
}
const again = cached.buttons.find((b) => b.text.includes('Prossimo turno'));
if (again) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x: again.x, y: again.y, button: 'left',
      clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse' });
  }
  let back = null;
  for (let i = 0; i < 40; i += 1) {
    back = await look();
    if (back.rows.length || (back.drawn ?? []).length) break;
    await wait(250);
  }
  const names = back.rows.length
    ? back.rows.length
    : (back.drawn ?? []).flatMap((row) => row.places.flatMap((one) => one.names)).length;
  const said = (back.card.match(/letto (oggi|il \d\d\/\d\d) alle \d\d:\d\d/) ?? [])[0] ?? null;
  console.log(`· col foglio BLOCCATO e la pagina ricaricata: ${names} nomi · dice «${said ?? '(niente)'}»`);
  if (!names) problems.push('con la rete bloccata la lettura salvata non ricompare');
  if (!said) problems.push('la pagina non dice QUANDO la lettura salvata e\' stata presa');
  if (!/Rileggi/.test(back.card)) problems.push('nessun tasto per rileggere');
} else {
  problems.push('dopo il ricarico il selettore non ha piu\' la voce «Prossimo turno»');
}

if (s.noise.length) problems.push(`eccezioni in console: ${s.noise.slice(0, 3).join(' | ')}`);
console.log(problems.length ? `\nPROBLEMI:\n  ${problems.join('\n  ')}` : '\nnessun problema');
// `kill()` UCCIDE IL LANCIATORE E NON L'ALBERO: su Windows Chrome sparge una decina di processi
// figli che sopravvivono al padre, e dopo una ventina di corse di banchi ne restavano **546** vivi -
// abbastanza da far morire `ng test` senza memoria, cioe' un difetto dell'arnese che si presenta come
// un difetto della suite. Si ammazza l'ALBERO; gli altri banchi di questo repository hanno ancora la
// forma vecchia, ed e' scritto invece di lasciarlo scoprire.
try { execFileSync('taskkill', ['/pid', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); }
catch { browser.kill(); }
process.exit(problems.length ? 1 : 0);
