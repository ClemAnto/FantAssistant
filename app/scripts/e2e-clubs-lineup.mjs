/**
 * LA FORMAZIONE DI UNA PARTITA GIA' GIOCATA, sul campetto vero e con un puntatore vero.
 *
 * Richiesta dell'operatore, 12/09/2026: «nella pagina CLUBS, quando nella visualizzazione "ultime
 * partite" seleziono una partita cliccando sul nome della colonna, vorrei che nel campetto ricostruissi
 * la formazione che ha giocato quella partita». Il disegno lo fa `core/match-lineup.ts`; qui si misura
 * che arrivi sullo schermo, e SU QUALE partita.
 *
 * IL CONFRONTO E' COL PACCHETTO E MAI CON LO SCHERMO, e la partita la sceglie QUESTO banco prima di
 * aprire la pagina: se la scegliesse leggendo l'intestazione, una pagina che dichiara la partita
 * sbagliata verrebbe verificata contro la partita sbagliata e passerebbe - l'asserzione circolare, dal
 * lato dell'identita' invece che del numero. La strada dal giocatore al nome del club passa per le
 * CHIAVI (`fc_id` -> `fc_club_id` -> nome canonico) e mai per la grafia del provider: rifare qui il
 * join per nome sarebbe ripetere quello che a questo progetto e' costato Milan, Roma e Napoli.
 *
 * DUE CASI E NON UNO, perche' sono due meta' del disegno e la seconda e' quella che puo' rompersi in
 * silenzio: su `default` il pacchetto nomina tutti e undici i titolari nel 99,4% delle partite-club di
 * Serie A, su `euro` - dove il listone quota una parte della rosa di un club estero - si sta fra il 49%
 * e il 67%, quindi li' un posto resta VUOTO. Un banco che guardasse solo il primo caso direbbe
 * «nessun problema» a proposito del ramo che nessuno ha mai disegnato.
 *
 * Cosa misura, e ogni passo dice su quante cose ha guardato:
 *   - la colonna che il banco ha scelto esiste e risponde alle proprie coordinate
 *   - i NOMI disegnati sono esattamente i titolari che il layer per-partita registra per quella coppia
 *   - i POSTI per riga sono quelli del MODULO DICHIARATO dalla fonte quando c'e' (trequarti compresa)
 *     e dei tre conteggi di club quando non c'e'
 *   - l'ORDINE dentro ogni linea e' quello della distinta, riga per riga: e' il confronto fra la
 *     nostra formazione e quella di Sofascore che l'operatore ha chiesto il 12/09/2026
 *   - i posti senza nome sono tanti quanti ne mancano: uno scheletro completo con un buco dichiarato
 *   - i SUBENTRATI disegnati sotto i titolari sono tutti quelli che hanno giocato, e nessun altro
 *   - la colonna scelta si vede diversa dalle altre DELLA STESSA PAGINA (i token sono `color-mix`)
 *   - la via d'uscita riporta l'undici tipo, e un nome del campetto apre la sua card
 *
 * Usage: node scripts/e2e-clubs-lineup.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
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
/** I cinque campionati del progetto: gli stessi su cui il layer per-partita porta la distinta. */
const LEAGUES = new Set(['serie_a', 'premier_league', 'la_liga', 'bundesliga', 'ligue_1']);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const page = list.find((o) => o.type === 'page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
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
/** Un click VERO, alle coordinate che il browser dichiara: `element.click()` passa sopra la CSS. */
async function click(s, x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse' });
  }
}

// ---------------------------------------------------------------- il pacchetto, letto qui
const table = (name) => {
  const raw = readFileSync(join(DIST, 'data', `${name}.json.gz`));
  const one = JSON.parse(gunzipSync(raw).toString('utf8'));
  const at = {};
  one.columns.forEach((c, i) => { at[c] = i; });
  return { rows: one.rows, at };
};
const manifest = JSON.parse(readFileSync(join(DIST, 'data', 'manifest.json'), 'utf8'));
const ems = table('external_match_stats');
const cml = table('club_match_lineups');
const rosters = table('rosters');
const quotes = table('listone_quotes');
const clubs = table('clubs');
const players = table('players');

/** Ogni riga del layer per-partita, per la coppia (partita, club nella grafia del provider). */
const byMatch = new Map();
for (const row of ems.rows) {
  const league = row[ems.at.competition];
  if (!LEAGUES.has(league)) continue;
  const key = `${row[ems.at.match_id]}|${row[ems.at.club]}`;
  const one = byMatch.get(key) ?? { league, date: row[ems.at.match_date], men: [] };
  one.men.push({ fcId: row[ems.at.fc_id], started: row[ems.at.started] === 1,
    line: row[ems.at.position], slot: row[ems.at.lineup_slot],
    minutes: row[ems.at.minutes],
    // DI CHI HA PRESO IL POSTO, dove il pacchetto lo porta: serve all'unica asserzione che il difetto
    // del 12/09/2026 falsificava - un subentrato disegnato sotto un uomo rimasto in campo.
    cameFor: ems.at.came_for == null ? null : row[ems.at.came_for] });
  byMatch.set(key, one);
}
/** Il MODULO, dai conteggi della distinta del club: la meta' completa delle due. */
const shapes = new Map();
for (const row of cml.rows) {
  if (row[cml.at.starters] !== 11) continue;
  // IL MODULO DICHIARATO DALLA FONTE vince sui tre conteggi, che non sanno dire una trequarti: con lui
  // le linee attese sono le sue, e il campetto deve tagliare li'.
  const declared = cml.at.formation == null ? null : row[cml.at.formation];
  const numbers = String(declared ?? '').split('-').map(Number).filter((one) => one > 0);
  const four = numbers.length === 4;
  const three = numbers.length === 3;
  shapes.set(`${row[cml.at.match_id]}|${row[cml.at.club]}`, {
    P: 1,
    D: four || three ? numbers[0] : row[cml.at.defenders],
    M: four || three ? numbers[1] : row[cml.at.midfielders],
    T: four ? numbers[2] : 0,
    A: four ? numbers[3] : three ? numbers[2] : row[cml.at.forwards],
    declared: four || three ? declared : null,
    text: four || three
      ? declared
      : `${row[cml.at.defenders]}-${row[cml.at.midfielders]}-${row[cml.at.forwards]}`,
  });
}
/** Le mappe di CHIAVI che portano dal giocatore al nome che la pagina mostra. Nessun join per nome. */
const clubOfPlayer = new Map();
for (const row of rosters.rows) {
  if (row[rosters.at.season] === manifest.target_season) {
    clubOfPlayer.set(row[rosters.at.fc_id], row[rosters.at.fc_club_id]);
  }
}
const clubName = new Map(clubs.rows.map((row) => [row[clubs.at.fc_club_id],
  row[clubs.at.canonical_name]]));
const playerName = new Map(players.rows.map((row) => [row[players.at.fc_id],
  row[players.at.canonical_name]]));
/** Quanti uomini una piattaforma quota per club: sotto undici il club non e' nella striscia. */
const quotedPerClub = new Map();
for (const row of quotes.rows) {
  if (row[quotes.at.season] !== manifest.target_season || row[quotes.at.sold]) continue;
  const key = `${row[quotes.at.platform]}|${clubOfPlayer.get(row[quotes.at.fc_id])}`;
  quotedPerClub.set(key, (quotedPerClub.get(key) ?? 0) + 1);
}

/**
 * LA PARTITA PIU' RECENTE di un club che questa piattaforma mostra - cioe' quella della PRIMA colonna,
 * che e' l'unico modo di essere sicuri che sia fra le dieci a schermo.
 *
 * `want` sceglie fra le due meta' del disegno: `full` una distinta che il pacchetto nomina per intero,
 * `partial` una in cui un nome manca e il posto deve restare vuoto.
 */
function pick(platform, want, skip = new Set(), onlyClub = null) {
  return [...byMatch.entries()]
    .filter(([key, one]) => shapes.has(key) && one.men.some((man) => man.started))
    .map(([key, one]) => {
      const [matchId, club] = key.split('|');
      // Il club che la pagina mostra si ricava dai TITOLARI, per chiave: la grafia del provider non e'
      // un'identita'. Si prende quello su cui la maggioranza di loro e' d'accordo - peso dell'evidenza,
      // che e' anche quello che fa `namedColumns` per decidere di chi e' una colonna.
      const votes = new Map();
      for (const man of one.men.filter((x) => x.started)) {
        const id = clubOfPlayer.get(man.fcId);
        if (id != null) votes.set(id, (votes.get(id) ?? 0) + 1);
      }
      let best = null;
      for (const [id, seen] of votes) if (!best || seen > votes.get(best)) best = id;
      const named = one.men.filter((man) => man.started && playerName.has(man.fcId));
      // L'ORDINE ATTESO DENTRO OGNI LINEA, dal posto che la FONTE scrive (`lineup_slot`): e' il
      // confronto che l'operatore ha chiesto - la nostra formazione contro quella di Sofascore - e si
      // fa col pacchetto, mai con lo schermo. Una linea in cui manca un posto non si confronta.
      const shape = shapes.get(key);
      const order = {};
      const starters = one.men.filter((man) => man.started);
      const sequence = starters.every((man) => man.slot != null)
        ? starters.slice().sort((a, b) => a.slot - b.slot)
        : null;
      if (shape?.declared && sequence && shape.P + shape.D + shape.M + shape.T + shape.A === 11) {
        // IL TAGLIO E' QUELLO DELLA FONTE, e si fa per INTERVALLI DI POSTO: `lineup_slot` e' un indice
        // assoluto, quindi un nome che il listone non quota lascia il SUO posto vuoto senza spostare
        // nessun altro. A fette bastava un uomo mancante per far scivolare tutta la linea.
        let at = 0;
        for (const [key2, asks] of [['porta', shape.P], ['difesa', shape.D],
          ['centrocampo', shape.M], ['trequarti', shape.T], ['attacco', shape.A]]) {
          const from = at;
          order[key2] = asks
            ? sequence.filter((man) => man.slot >= from && man.slot < from + asks)
              .map((man) => playerName.get(man.fcId) ?? null)
            : null;
          at += asks;
        }
      } else {
        for (const [line, key2] of [['G', 'porta'], ['D', 'difesa'], ['M', 'centrocampo'],
          ['F', 'attacco']]) {
          const mine = named.filter((man) => man.line === line);
          order[key2] = mine.every((man) => man.slot != null)
            ? mine.slice().sort((a, b) => a.slot - b.slot).map((man) => playerName.get(man.fcId))
            : null;
        }
      }
      const came = one.men.filter((man) => !man.started && (man.minutes ?? 0) > 0
        && playerName.has(man.fcId));
      return { matchId, club, league: one.league, date: one.date, shape: shapes.get(key),
        page: best == null ? null : clubName.get(best), clubId: best, votes: votes.get(best) ?? 0,
        names: named.map((man) => playerName.get(man.fcId)).sort(), order,
        came: came.map((man) => playerName.get(man.fcId)).sort(),
        // CHI E' RIMASTO IN CAMPO PER TUTTA LA GARA, per nome: nessun subentrato puo' stare sotto di
        // lui, perche' il suo posto non si e' mai liberato.
        stayed: named.filter((man) => man.minutes != null && man.minutes >= 90)
          .map((man) => playerName.get(man.fcId)),
        // E DOVE IL CAMBIO E' NOTO, il nome del TITOLARE in fondo alla catena: Koopmeiners entra per
        // Cambiaso, entrato per Conceicao, quindi il posto del modulo e' quello di Conceicao.
        seatOf: Object.fromEntries(came.map((man) => {
          const byId = new Map(one.men.map((who) => [who.fcId, who]));
          let at = man;
          for (let step = 0; step < 10 && at; step++) {
            const before = at.cameFor;
            if (before == null) return [playerName.get(man.fcId), null];
            const who = byId.get(before);
            if (who?.started) return [playerName.get(man.fcId), playerName.get(before) ?? null];
            at = who;
          }
          return [playerName.get(man.fcId), null];
        })) };
    })
    .filter((one) => one.page && one.votes >= 8 && !skip.has(one.matchId)
      && (!onlyClub || one.page === onlyClub)
      && (quotedPerClub.get(`${platform}|${one.clubId}`) ?? 0) >= 11
      && (want === 'full' ? one.names.length === 11 : one.names.length < 11))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] ?? null;
}

const CASES = [
  { platform: 'default', want: 'full', why: 'una distinta nominata per intero' },
  { platform: 'euro', want: 'partial', why: 'una distinta con un nome che manca' },
];
const picked = CASES.map((one) => ({ ...one, match: pick(one.platform, one.want) }));
/**
 * LA PARTITA PIU' RECENTE PUO' NON AVERE ANCORA UNA COLONNA: l'asse della tabella si costruisce sulle
 * giornate che hanno una riga nei VOTI, e una partita giocata ieri ha la distinta del provider e non
 * ancora la pagella. Il banco tiene quindi un elenco di ricambi e prova il piu' recente che sia a
 * schermo - non e' circolare, perche' la partita resta scelta dal pacchetto e il confronto pure.
 */
if (!picked.some((one) => one.match)) {
  console.log('SALTATO · 0 controlli: il pacchetto non porta nessuna partita con una distinta completa');
  console.log('  e undici titolari attribuibili a un club. Rilancia `node scripts/pull-bundle.mjs`.');
  process.exit(0);
}

// ---------------------------------------------------------------- la pagina
const binary = BROWSERS.find((o) => existsSync(o));
const profile = await mkdtemp(join(tmpdir(), 'lineup-'));
const { port } = await serve(DIST);
const first = picked.find((one) => one.match);
const url = (one) => `http://127.0.0.1:${port}/clubs?platform=${one.platform}`
  + `&club=${encodeURIComponent(one.match.page)}&vista=matches`;
const browser = spawn(binary, ['--headless=new', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=1700,1200', url(first)], { stdio: 'ignore' });
const s = await attach(await devToolsPort(profile));
await s.send('Runtime.enable');

const problems = [];

/** Le intestazioni di partita: la loro identita' dichiarata, il loro fondo e dove si clicca. */
const headers = () => ev(s, () => [...document.querySelectorAll('ui-matches-table th[data-match]')]
  .map((th) => {
    const box = th.getBoundingClientRect();
    return { matchId: th.dataset.match, club: th.dataset.matchClub,
      x: box.x + box.width / 2, y: box.y + box.height / 2,
      background: getComputedStyle(th).backgroundColor,
      outline: getComputedStyle(th).boxShadow,
      // ...e chi risponde a quelle coordinate: una testa coperta non e' un bersaglio.
      hit: th.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
  }));

/** Il campetto della partita: i posti per riga, i nomi, i posti senza nome. */
const drawn = () => ev(s, () => {
  const board = document.querySelector('ui-match-lineup');
  if (!board) return null;
  const rows = [...board.querySelectorAll('[data-line]')].map((row) => ({
    line: row.getAttribute('aria-label'),
    places: row.querySelectorAll('[data-place]').length,
    unnamed: row.querySelectorAll('[data-unnamed]').length,
    // I TITOLARI E I SUBENTRATI hanno due appigli diversi: un selettore solo li impacchetterebbe
    // insieme e il banco confronterebbe quindici nomi con undici.
    names: [...row.querySelectorAll('[data-place] [data-starter] [role="button"]')]
      .map((n) => n.textContent.trim()),
    came: [...row.querySelectorAll('[data-place] [data-came] [role="button"]')]
      .map((n) => n.textContent.trim()),
    // PER POSTO e non per riga: «chi e' entrato sotto CHI» e' la domanda del 12/09/2026, e una lista
    // per riga impacchetta undici maglie in una e non la puo' rispondere.
    seats: [...row.querySelectorAll('[data-place]')].map((place) => ({
      starter: place.querySelector('[data-starter] [role="button"]')?.textContent.trim() ?? null,
      came: [...place.querySelectorAll('[data-came] [role="button"]')]
        .map((n) => n.textContent.trim()),
    })),
  }));
  const said = board.parentElement?.textContent ?? '';
  return { rows, note: said.includes('layer per-partita'),
    deducedSaid: /(\d+) righe dedotte/.exec(said)?.[1] ?? '0' };
});

async function settle(probe, ok, tries = 200) {
  let value = null;
  for (let i = 0; i < tries; i += 1) {
    value = await probe();
    if (ok(value)) return value;
    await wait(150);
  }
  return value;
}

/** Un caso: apre il club, clicca la colonna che il PACCHETTO ha scelto, e confronta col pacchetto. */
async function run(one, last) {
  let want = one.match;
  console.log(`\n${one.platform.toUpperCase()} · ${one.why}`);
  console.log(`  ${want.page} (${want.league}) · ${want.date} · evento ${want.matchId}`);
  console.log(`  modulo ${want.shape.text} · ${want.names.length} titolari nominabili su 11`);

  const seen = await settle(headers, (rows) => rows?.length > 0);
  console.log(`· colonne di partita cliccabili: ${seen.length}`);
  if (!seen.length) {
    problems.push(`${one.platform}: nessuna colonna dichiara una partita (data-match assente)`);
    return;
  }
  let target = seen.find((row) => row.matchId === want.matchId && row.club === want.club);
  // Un ricambio quando la piu' recente non ha ancora una colonna (vedi `picked`): si riparte dal
  // pacchetto, mai dallo schermo - scegliere la colonna che c'e' e poi verificarla contro se stessa
  // sarebbe l'asserzione circolare.
  const skip = new Set([want.matchId]);
  while (!target) {
    const next = pick(one.platform, one.want, skip, want.page);
    if (!next) break;
    skip.add(next.matchId);
    // LO STESSO CLUB, o si finisce a verificare la riga dell'AVVERSARIO: una partita ha due lati e la
    // colonna ne dichiara uno solo - il ricambio aveva trovato Frosinone sullo schermo del Venezia.
    target = seen.find((row) => row.matchId === next.matchId && row.club === next.club);
    if (target) {
      want = next;
      console.log(`  ...la piu' recente non ha ancora una colonna, si prova ${want.page} `
        + `${want.date} (modulo ${want.shape.text})`);
    }
  }
  if (!target) {
    problems.push(`${one.platform}: nessuna delle partite del pacchetto ha una colonna a schermo`);
    return;
  }
  if (target.club !== want.club) {
    problems.push(`${one.platform}: la colonna dichiara «${target.club}», il pacchetto «${want.club}»`);
  }
  if (!target.hit) problems.push(`${one.platform}: la testa della colonna non risponde alle sue coordinate`);

  const before = { background: target.background, outline: target.outline };
  await click(s, target.x, target.y);
  const pitch = await settle(drawn, (value) => value?.rows?.length > 0);
  if (!pitch?.rows?.length) {
    problems.push(`${one.platform}: il campetto della partita non si disegna`);
    return;
  }

  const names = pitch.rows.flatMap((row) => row.names).sort();
  const places = pitch.rows.reduce((sum, row) => sum + row.places, 0);
  const unnamed = pitch.rows.reduce((sum, row) => sum + row.unnamed, 0);
  console.log(`· campetto: ${places} posti · ${names.length} nomi · ${unnamed} senza nome`);
  if (places !== 11) problems.push(`${one.platform}: il modulo chiede 11 posti, disegnati ${places}`);
  if (unnamed !== 11 - want.names.length) {
    problems.push(`${one.platform}: posti senza nome ${unnamed}, il pacchetto ne lascia `
      + `${11 - want.names.length}`);
  }
  const same = JSON.stringify(names) === JSON.stringify(want.names);
  console.log(`· nomi disegnati contro il pacchetto: combaciano ${same} `
    + `(${names.length} contro ${want.names.length})`);
  if (!same) {
    problems.push(`${one.platform}: di troppo `
      + `${JSON.stringify(names.filter((n) => !want.names.includes(n)))} · mancanti `
      + `${JSON.stringify(want.names.filter((n) => !names.includes(n)))}`);
  }

  // LE RIGHE SONO QUELLE DEL MODULO, e il modulo viene dai conteggi di CLUB: la meta' completa.
  const lines = Object.fromEntries(pitch.rows.map((row) => [row.line, row.places]));
  const asks = { porta: want.shape.P, difesa: want.shape.D, centrocampo: want.shape.M,
    ...(want.shape.T ? { trequarti: want.shape.T } : {}), attacco: want.shape.A };
  console.log(`· righe a schermo ${JSON.stringify(lines)} · il modulo ${want.shape.text} `
    + `dice ${JSON.stringify(asks)}`);
  for (const [line, count] of Object.entries(asks)) {
    if ((lines[line] ?? 0) !== count) {
      problems.push(`${one.platform}: linea ${line}, ${lines[line] ?? 0} posti contro ${count}`);
    }
  }
  if (!pitch.note) problems.push(`${one.platform}: il campetto non dichiara da dove viene il disegno`);

  // L'ORDINE DENTRO OGNI LINEA CONTRO QUELLO DI SOFASCORE, che e' il confronto chiesto il 12/09/2026.
  // Non e' circolare: il posto lo scrive la FONTE (`lineup_slot`, l'indice della voce nella sua
  // distinta) e il banco lo rilegge dal pacchetto, mentre la pagina lo ordina per conto suo.
  let checked = 0;
  for (const [line, expected] of Object.entries(want.order)) {
    if (!expected || !expected.length) continue;
    const drawnNames = pitch.rows.find((row) => row.line === line)?.names ?? [];
    checked += 1;
    if (JSON.stringify(drawnNames) !== JSON.stringify(expected)) {
      problems.push(`${one.platform}: ${line} disegnata ${JSON.stringify(drawnNames)} `
        + `contro la distinta ${JSON.stringify(expected)}`);
    }
  }
  console.log(`· ordine dentro la linea, contro la distinta della fonte: ${checked} righe `
    + `confrontate · righe dedotte dichiarate a schermo: ${pitch.deducedSaid}`);
  if (!checked) problems.push(`${one.platform}: nessuna linea confrontabile con la distinta`);

  // I SUBENTRATI SONO SOTTO I TITOLARI (sua richiesta): tutti quelli che hanno giocato, e nessun altro.
  const drawnCame = pitch.rows.flatMap((row) => row.came).sort();
  console.log(`· entrati disegnati sotto i titolari: ${drawnCame.length} · il pacchetto ne ha `
    + `${want.came.length} · combaciano ${JSON.stringify(drawnCame) === JSON.stringify(want.came)}`);
  if (JSON.stringify(drawnCame) !== JSON.stringify(want.came)) {
    problems.push(`${one.platform}: entrati ${JSON.stringify(drawnCame)} contro `
      + `${JSON.stringify(want.came)}`);
  }

  // NESSUN SUBENTRATO SOTTO UN UOMO RIMASTO IN CAMPO NOVANTA MINUTI. E' il difetto che l'operatore ha
  // trovato il 12/09/2026 - Gonzalez N. disegnato sotto Kolo Muani - e l'asserzione non e' circolare:
  // i minuti li rilegge il banco dal PACCHETTO, la pagina decide il posto per conto suo.
  const seats = pitch.rows.flatMap((row) => row.seats);
  const stayed = new Set(want.stayed);
  const onAStayer = seats.filter((seat) => seat.came.length && stayed.has(seat.starter));
  console.log(`· posti con un entrato: ${seats.filter((one) => one.came.length).length} · di cui `
    + `sopra un uomo che ha giocato tutta la gara: ${onAStayer.length}`);
  for (const seat of onAStayer) {
    problems.push(`${one.platform}: ${seat.came.join(', ')} disegnato sotto ${seat.starter}, `
      + `che ha giocato 90' e quindi non ha ceduto il posto a nessuno`);
  }
  // E DOVE IL CAMBIO E' NOTO, il posto e' QUELLO: il fatto viene dal pacchetto, non dallo schermo.
  let pairs = 0;
  for (const seat of seats) {
    for (const who of seat.came) {
      const owed = want.seatOf[who];
      if (owed == null) continue;
      pairs += 1;
      if (seat.starter !== owed) {
        problems.push(`${one.platform}: ${who} e' entrato per ${owed} e il campetto lo disegna `
          + `sotto ${seat.starter ?? 'un posto senza nome'}`);
      }
    }
  }
  console.log(`· entrati il cui cambio il pacchetto conosce: ${pairs} · disegnati sul posto giusto: `
    + `${pairs - problems.filter((p) => p.includes("e' entrato per")).length}`);

  // LA COLONNA SCELTA SI VEDE, e il confronto e' con un'altra colonna DELLA STESSA PAGINA: i token
  // sono `color-mix` e i temi sono due, quindi un letterale non e' un'affermazione verificabile.
  const after = await headers();
  const mine = after.find((row) => row.matchId === want.matchId);
  const other = after.find((row) => row.matchId !== want.matchId);
  console.log(`· colonna scelta: fondo ${mine?.background} · un'altra ${other?.background}`);
  if (!other) problems.push(`${one.platform}: una sola colonna, niente con cui confrontare`);
  else if (mine.background === other.background && mine.outline === other.outline) {
    problems.push(`${one.platform}: la colonna scelta si disegna identica alle altre`);
  }
  if (mine && mine.background === before.background && mine.outline === before.outline) {
    problems.push(`${one.platform}: la colonna non e' cambiata dopo il click`);
  }

  if (!last) return;

  // LA VIA D'USCITA riporta l'undici tipo. Si prova PRIMA della card, e non e' un ordine comodo: una
  // card e' `fixed` e copre quello che sta sotto, quindi il click finirebbe su di lei e il banco
  // accuserebbe l'uscita di non funzionare - che e' quello che la prima corsa di questo banco ha fatto.
  const back = await ev(s, () => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes("torna all'undici tipo"));
    if (!button) return null;
    const box = button.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // ...e chi risponde a quelle coordinate: «il bottone c'e'» e' un fatto sul DOM, non sullo schermo.
    return { x, y, hit: button.contains(document.elementFromPoint(x, y)) };
  });
  if (!back) problems.push("nessuna via d'uscita dalla formazione di una partita");
  else {
    if (!back.hit) problems.push("la via d'uscita e' coperta da qualcos'altro");
    await click(s, back.x, back.y);
    const state = await settle(
      () => ev(s, () => ({ board: document.querySelectorAll('ui-club-board').length,
        lineup: document.querySelectorAll('ui-match-lineup').length })),
      (value) => value.board > 0 && value.lineup === 0, 40);
    console.log(`· dopo l'uscita: ${state.board} undici tipo · ${state.lineup} formazioni di partita`);
    if (!state.board || state.lineup) problems.push("l'uscita non riporta l'undici tipo");
    const again = (await headers()).find((row) => row.matchId === want.matchId);
    if (again) {
      await click(s, again.x, again.y);
      await settle(drawn, (value) => value?.rows?.length > 0, 60);
    }
  }

  // UN NOME DEL CAMPETTO APRE LA SUA CARD: e' lo stesso gesto dell'undici tipo, e un nome che promette
  // un gesto che non c'e' e' peggio di un nome che non lo promette.
  const spot = await ev(s, () => {
    const name = document.querySelector('ui-match-lineup [data-place] [role="button"]');
    if (!name) return null;
    const box = name.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, name: name.textContent.trim() };
  });
  if (!spot) problems.push('nessun nome cliccabile sul campetto della partita');
  else {
    await click(s, spot.x, spot.y);
    const cards = await settle(
      () => ev(s, () => document.querySelectorAll('ui-player-card').length), (n) => n > 0, 40);
    console.log(`· click su «${spot.name}»: ${cards} card aperte`);
    if (!cards) problems.push('il click su un nome del campetto non apre la card');
  }
}

let ran = 0;
for (const one of picked) {
  if (!one.match) {
    console.log(`\n${one.platform.toUpperCase()} · SALTATO: il pacchetto non porta ${one.why}.`);
    continue;
  }
  if (ran) {
    await s.send('Page.navigate', { url: url(one) });
    await settle(() => ev(s, () => document.querySelectorAll('ui-matches-table').length), (n) => n > 0);
  }
  // L'ultimo caso e' quello che prova anche l'uscita e la card: sono gesti della PAGINA e non della
  // piattaforma, e ripeterli due volte misurerebbe la stessa cosa due volte.
  await run(one, one === picked.filter((x) => x.match).at(-1));
  ran += 1;
}
console.log(`\ncasi provati: ${ran} di ${CASES.length}`);
if (s.noise.length) problems.push(`eccezioni in console: ${s.noise.slice(0, 3).join(' | ')}`);
console.log(problems.length ? `\nPROBLEMI:\n  ${problems.join('\n  ')}` : '\nnessun problema');
browser.kill();
process.exit(problems.length ? 1 : 0);
