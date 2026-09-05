/**
 * e2e-player-card.mjs - guidare la card di un calciatore e misurare le «ultime partite».
 *
 * Richiesta dell'operatore (05/09/2026): «i voti sintetici devono essere utilizzati anche dall'app per
 * ricostruire lo storico del calciatore anche quando ha giocato fuori dalla serie A ... dobbiamo sempre
 * mostrare cosa ha fatto, non mi basta vedere la data della partita», piu' «per le ultime partite
 * utilizza una scrollbar piu' sottile». Sono tre affermazioni sullo SCHERMO e nessun test unitario le
 * puo' provare: che righe di un altro campionato compaiano, che portino un numero e non solo una data,
 * e quanto e' larga una barra di scorrimento.
 *
 * IL CONFRONTO E' COL BUNDLE e mai con la card stessa. L'arnese legge `external_match_stats` DALLO
 * STESSO server da cui lo legge la pagina, si sceglie da li' l'uomo con piu' partite fuori dal suo
 * campionato, e verifica che la card dica di lui quello che il bundle dice. Ricavare l'atteso dallo
 * schermo sarebbe l'asserzione circolare che questo progetto ha gia' pagato (04/09/2026).
 *
 * E L'UOMO SI SCEGLIE DAI DATI, mai da una lista scritta a mano: «Kolo Muani» e' il caso da cui la
 * richiesta nasce, non un nome da incidere - alla prossima esportazione sarebbe un banco che legge
 * «nessun problema» dopo aver guardato niente.
 *
 * Zero dipendenze come gli altri: serve `dist/`, lancia Edge o Chrome headless, CDP.
 *
 * Uso: node scripts/e2e-player-card.mjs [--headed] [--json] [--shot] [--who Nome]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
/** I cinque campionati che il bundle chiama «campionato»: fuori da qui e' coppa o amichevole. */
const LEAGUES = new Set([
  'serie_a', 'premier_league', 'la_liga', 'bundesliga', 'ligue_1', 'serie_b',
]);
/** Le amichevoli che l'app riconosce (`players-store.FRIENDLY_COMPETITIONS`): il resto e' coppa. */
const FRIENDLY = new Set(['club-friendly-games', 'como-cup', 'emirates-cup', 'kings-cup']);
/** La barra normale e' 12px (`--scrollbar-size`): «piu' sottile» vuol dire strettamente meno. */
const NORMAL_SCROLLBAR = 12;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
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
      noise.push(`CONSOLE: ${message.params.args.map((one) => one.description ?? one.value).join(' ')}`
        .slice(0, 300));
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

/** A REAL pointer: hover first, then press and release where the browser says the target is. */
async function click(session, point) {
  const at = { x: Math.round(point.x), y: Math.round(point.y) };
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'none' });
  await wait(60);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...at, button: 'left', clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...at, button: 'left', clickCount: 1,
  });
  await wait(350);
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

// ------------------------------------------------------------------ quello che gira NELLA pagina

/** Le righe della plancia con il loro rettangolo: da qui si sceglie chi aprire. */
function readRows() {
  return [...document.querySelectorAll('plancia-slot-matrix button')].map((one) => {
    const rect = one.getBoundingClientRect();
    return {
      text: (one.innerText ?? '').replace(/\s+/g, ' ').trim(),
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
}

/**
 * L'ELENCO DELLA CARD, riga per riga.
 *
 * ATTENZIONE A `display: contents`, ed e' il difetto che questo banco ha commesso alla prima corsa:
 * l'ospite di `ui-match-line` non ha un box, ma resta un FIGLIO del DOM - quindi `grid.children` sono
 * i COMPONENTI e non le celle, e leggerne cinque alla volta impacchettava cinque partite in una riga
 * sola («Bou–Eve 20' *6,7 | Eve–Cry 11' *6,5 | ...»), col confronto che poi accusava la pagina.
 * Le celle sono i figli del componente; il divisore di stagione e' l'altro tipo di figlio della griglia.
 *
 * I DUE CLUB SI LEGGONO SEPARATI e non da una stringa unita: fra i due nomi la riga stampa il
 * RISULTATO (o un trattino lungo), quindi `Bou-Eve` non compare mai nel testo - un confronto su una
 * stringa unita legge zero e da' la colpa alla pagina.
 */
function readMatches() {
  const grid = document.querySelector('ui-player-card [data-matches]');
  if (!grid) return null;
  const style = getComputedStyle(grid);
  const rows = [];
  let seasonSeen = null;
  const clubBreaks = [];
  const summaries = [];
  const expected = [];
  for (const child of grid.children) {
    if (child.tagName.toLowerCase() !== 'ui-match-line') {
      // TRE FIGLI CHE NON SONO PARTITE: il divisore di stagione, quello del cambio di squadra e il
      // riepilogo. Si distinguono dai loro MARCHI e non dal testo - la prima versione leggeva il
      // riepilogo come se fosse una stagione, e ogni riga sotto finiva attribuita a «18 partite ...».
      if (child.hasAttribute('data-club-break')) clubBreaks.push((child.innerText ?? '').trim());
      // GLI ATTESI sono una riga del riepilogo e NON un divisore: senza questo ramo il suo testo
      // finiva in `seasonSeen` e ogni partita sotto risultava della stagione «attesi a partita xG
      // ...» - un elemento nuovo letto come uno vecchio, che e' il difetto che questo banco ha gia'
      // pagato col riepilogo scambiato per un divisore.
      else if (child.hasAttribute('data-season-expected')) {
        const cells = [...child.children];
        expected.push({
          season: seasonSeen,
          label: (cells[0]?.innerText ?? '').trim(),
          values: (cells[1]?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        });
      } else if (child.hasAttribute('data-season-totals')) {
        const cells = [...child.children];
        summaries.push({
          season: seasonSeen,
          xs: cells.map((one) => Math.round(one.getBoundingClientRect().left)),
          played: (cells[0]?.innerText ?? '').trim(),
          minutes: (cells[1]?.innerText ?? '').trim(),
          mv: (cells[2]?.innerText ?? '').trim(),
          marks: [...(cells[3]?.querySelectorAll('ui-bonus') ?? [])].map(
            (one) => (one.innerText ?? '').trim(),
          ),
          fm: (cells[4]?.innerText ?? '').trim(),
        });
      } else if (!child.hasAttribute('data-more')) seasonSeen = (child.innerText ?? '').trim();
      continue;
    }
    const cells = [...child.children];
    if (cells.length < 5) continue;
    const [fixture, spell, vote, bonuses, fantavoto] = cells;
    const icon = fixture.querySelector('.anticon');
    const rect = fixture.getBoundingClientRect();
    rows.push({
      season: seasonSeen,
      // LE X DI OGNI CELLA: l'incolonnamento e' il punto di questo componente, e passare a
      // `grid-cols-subgrid` e' esattamente il genere di cambio che lo puo' rompere in silenzio.
      xs: cells.map((one) => Math.round(one.getBoundingClientRect().left)),
      // LO SFONDO DELLA RIGA: dal 05/09 l'ospite e' un elemento e si puo' dipingere.
      background: getComputedStyle(child).backgroundColor,
      // I FILE degli stemmi, UNO PER `ui-crest` e in ordine (casa a sinistra): un club senza stemma
      // non disegna nessuna `<img>`, quindi leggere le immagini per posizione farebbe scivolare lo
      // stemma di destra al posto di quello di sinistra - un banco che sbaglia a leggere accusa la
      // pagina di uno stemma sbagliato mentre disegna quello giusto.
      badges: [...fixture.querySelectorAll('ui-crest')].map(
        (one) => one.querySelector('img')?.getAttribute('src') ?? null,
      ),
      fixture: (fixture.innerText ?? '').replace(/\s+/g, ' ').trim(),
      // i due nomi come li stampa la riga, senza quello che sta in mezzo
      sides: [...fixture.querySelectorAll('span')]
        .map((one) => (one.innerText ?? '').trim())
        .filter((one) => one && !/^[\d–-]/.test(one)),
      mark: icon ? ([...icon.classList].find((one) => one.startsWith('anticon-')) ?? '?') : null,
      crests: fixture.querySelectorAll('ui-crest').length,
      minutes: (spell.innerText ?? '').trim(),
      vote: (vote.innerText ?? '').trim(),
      voteInk: getComputedStyle(vote).color,
      bonuses: (bonuses.innerText ?? '').replace(/\s+/g, ' ').trim(),
      fantavoto: (fantavoto.innerText ?? '').trim(),
      box: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      // L'OPACITA' STA SULLE CELLE e non sull'ospite (o spegnerebbe anche lo sfondo): si legge
      // computata, che e' l'unico modo di sapere se dipinge davvero.
      dim: Number(getComputedStyle(fixture).opacity),
      // LE COLONNE che devono avere respiro, e i nomi che potrebbero essere tagliati.
      bonusWidth: Math.round(bonuses.getBoundingClientRect().width),
      bonusMarks: bonuses.querySelectorAll('ui-bonus').length,
      clipped: [...fixture.querySelectorAll('span')].filter(
        (one) => one.scrollWidth > one.clientWidth + 1,
      ).length,
    });
  }
  // QUANTO CHIEDE LA GRIGLIA CONTRO QUANTO LE SI DA' (operatore, 05/09/2026: «allarga un po' la card
  // del dettaglio altrimenti alcuni valori risultano tagliati»). Una colonna tagliata dal bordo della
  // card non e' STRETTA, e' ASSENTE - la stessa famiglia dei «276px di colonne non strette, assenti» -
  // e nessun conteggio di celle la vede: quello che la vede e' la x del bordo DESTRO dell'ultima cella
  // contro il bordo destro della griglia.
  const shell = document.querySelector('ui-player-card > div');
  const edge = grid.getBoundingClientRect().right;
  const spill = (child) =>
    Math.max(0, Math.round(child.getBoundingClientRect().right - edge));
  const cut = [...grid.children]
    .map((child) => spill([...child.children].at(-1) ?? child))
    .filter((over) => over > 0);
  return {
    rows,
    clubBreaks,
    summaries,
    expected,
    fit: {
      card: Math.round(shell?.getBoundingClientRect().width ?? 0),
      given: grid.clientWidth,
      needed: grid.scrollWidth,
      /** Quanti pixel manca la piu' larga delle righe: 0 = nessuna cella tocca il bordo. */
      cut: cut.length ? Math.max(...cut) : 0,
      cutRows: cut.length,
    },
    // LA BARRA: quanto spazio si prende davvero, non una classe che c'e' e potrebbe non dipingere.
    scrollbar: grid.offsetWidth - grid.clientWidth,
    scrolls: grid.scrollHeight > grid.clientHeight + 1,
    size: style.getPropertyValue('--scrollbar-size').trim(),
    empty: (document.querySelector('ui-player-card p')?.innerText ?? '').slice(0, 160),
    // IL CLUB DI OGGI come la card stessa lo dichiara: e' il termine di paragone del confronto
    // «giocava altrove», ed e' un fatto sull'uomo che le righe non portano.
    club: (
      document.querySelector('ui-player-card [cdkDragHandle] span span:nth-child(2)')?.innerText ?? ''
    ).split('·')[0].trim(),
  };
}

/** Il tasto in fondo all'elenco, se c'e': quello che dice e dove sta. */
function readMore() {
  const button = document.querySelector('ui-player-card [data-more]');
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return {
    text: (button.innerText ?? '').replace(/\s+/g, ' ').trim(),
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function readTooltip() {
  const inner = document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden) .ant-tooltip-inner');
  return inner ? (inner.innerText ?? '').replace(/\s+/g, ' ').trim() : null;
}

// ------------------------------------------------------------------ la corsa

async function gz(url) {
  const { gunzipSync } = await import('node:zlib');
  const body = await (await fetch(url)).arrayBuffer();
  return JSON.parse(gunzipSync(Buffer.from(body)).toString('utf-8'));
}

/** `Napoli` -> `Nap`: la stessa abbreviazione che la riga stampa (`players-store.abbreviate`). */
const SKIP = new Set(['ac', 'as', 'ss', 'ssc', 'fc', 'rc', 'afc', 'us', 'ol', 'rb']);
function abbreviate(name) {
  if (!name) return '???';
  const words = String(name).split(/\s+/).filter((one) => one && !SKIP.has(one.toLowerCase()));
  return (words[0] ?? name).slice(0, 3);
}

/** Il passo del voto (`match-bonuses.VOTE_STEP`): i voti veri sono TUTTI a mezzi punti, misurato. */
function roundVote(value) {
  return Math.round(value / 0.5) * 0.5;
}

/** La chiave normalizzata di un club (`players-store.clubNameKey`): senza le parole che non nominano. */
function clubKey(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter((one) => one && !SKIP.has(one.toLowerCase()))
    .map((one) => one.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim())
    .filter(Boolean)
    .join(' ');
}

/** Il file dello stemma di un club, per NOME: la stessa catena che l'app percorre, ricostruita fuori. */
function crestFileWith(index, crests) {
  return (name) => {
    const id = index.get(clubKey(name));
    return id == null ? null : (crests[String(id)] ?? null);
  };
}

/** I due nomi abbreviati di una partita del bundle, in casa a sinistra come li stampa la riga. */
function sidesOf(match) {
  const left = match.home === false ? match.opponent : match.club;
  const right = match.home === false ? match.club : match.opponent;
  return [abbreviate(left), abbreviate(right)];
}

/** La riga dello schermo e la partita del bundle nominano gli stessi due club? */
function sameFixture(row, match) {
  const [left, right] = sidesOf(match);
  return row.sides.length >= 2 && row.sides[0] === left && row.sides[1] === right;
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`no build in ${DIST}: run \`ng build\` first`);
  }
  const binary = BROWSERS.find((one) => existsSync(one));
  if (!binary) throw new Error('no Edge or Chrome found');

  const { server, port } = await serve(DIST);
  const profile = await mkdtemp(join(tmpdir(), 'fant-card-'));
  const debugPort = Number(value('--port', String(await freePort())));
  const url = `http://127.0.0.1:${port}/plancia`;
  const browser = spawn(
    binary,
    [
      flag('--headed') ? '--headless=false' : '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1600,1000',
      url,
    ],
    { stdio: 'ignore' },
  );

  const report = { url, steps: [], problems: [] };
  const note = (step, detail) => {
    report.steps.push({ step, ...detail });
    console.log(`- ${step}: ${detail.said ?? ''}`);
    for (const problem of detail.problems ?? []) console.log(`    ! ${problem}`);
    if (detail.problems?.length) {
      report.problems.push(...detail.problems.map((one) => `${step}: ${one}`));
    }
  };

  let session;
  try {
    session = await attach(debugPort);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });
    await wait(3500);

    // 0. IL BUNDLE CHE LA PAGINA STA LEGGENDO: chi ha giocato fuori dal suo campionato, e quanto.
    const base = `http://127.0.0.1:${port}/data`;
    const manifestSeason = (await (await fetch(`${base}/manifest.json`)).json()).target_season;
    const external = await gz(`${base}/external_match_stats.json.gz`);
    const players = await gz(`${base}/players.json.gz`);
    const quotes = await gz(`${base}/listone_quotes.json.gz`);
    const clubs = await gz(`${base}/clubs.json.gz`);
    const rosters = await gz(`${base}/rosters.json.gz`);
    const crestIndex = await (await fetch(`${base}/crests/index.json`)).json();
    const col = (table, name) => table.columns.indexOf(name);
    // nome del club -> id -> file dello stemma: la stessa catena dell'app, costruita fuori da lei
    const clubIndex = new Map(
      clubs.rows.map((row) => [
        clubKey(row[col(clubs, 'canonical_name')]),
        row[col(clubs, 'fc_club_id')],
      ]),
    );
    const crestFile = crestFileWith(clubIndex, crestIndex);
    // IL RUOLO DI LISTONE, che e' quello su cui l'app decide se un uomo e' un portiere (il listone ce
    // l'ha per tutti, la posizione del provider manca sull'1,4% delle righe).
    const roleOf = new Map(
      rosters.rows
        .filter((row) => row[col(rosters, 'season')] === manifestSeason)
        .map((row) => [row[col(rosters, 'fc_id')], row[col(rosters, 'role_classic')]]),
    );
    const scoring = await (await fetch(`${base}/scoring_config.json`)).json();

    // il campionato di ognuno, dal listone di QUESTA piattaforma (la plancia disegna `default`)
    const leagueOf = new Map();
    for (const row of quotes.rows) {
      if (row[col(quotes, 'platform')] !== 'default') continue;
      leagueOf.set(row[col(quotes, 'fc_id')], row[col(quotes, 'league')]);
    }
    const nameOf = new Map(
      players.rows.map((row) => [row[col(players, 'fc_id')], row[col(players, 'canonical_name')]]),
    );

    /** Per uomo: le sue partite fuori dal campionato del suo listone. */
    const abroad = new Map();
    let synthRows = 0;
    let ratedRows = 0;
    for (const row of external.rows) {
      const id = row[col(external, 'fc_id')];
      const competition = row[col(external, 'competition')];
      if (row[col(external, 'rating')] != null) ratedRows += 1;
      if (row[col(external, 'mv_synth')] != null) synthRows += 1;
      if (!LEAGUES.has(competition) || competition === leagueOf.get(id)) continue;
      const list = abroad.get(id) ?? [];
      list.push({
        season: row[col(external, 'season')],
        competition,
        date: row[col(external, 'match_date')],
        club: row[col(external, 'club')],
        opponent: row[col(external, 'opponent')],
        home: row[col(external, 'home')] === 1,
        minutes: row[col(external, 'minutes')],
        rating: row[col(external, 'rating')],
        synth: row[col(external, 'mv_synth')],
      });
      abroad.set(id, list);
    }
    note('il bundle', {
      said:
        `${external.rows.length} righe per-partita · ${ratedRows} col rating · `
        + `${synthRows} col voto sintetico · `
        + `${abroad.size} uomini con partite in un campionato che non e' il loro`,
      synthRows,
      ratedRows,
      abroad: abroad.size,
      problems: abroad.size ? [] : ['nessun uomo con calcio giocato altrove: niente da provare'],
    });

    // 1. L'UOMO: quello con piu' partite altrove FRA QUELLI CHE LA PLANCIA DISEGNA.
    const rows = await waitFor(session, readRows, 40);
    if (!rows?.length) throw new Error('la plancia non ha disegnato nessuna riga');
    const wanted = value('--who', null);
    // OGNI RIGA DISEGNATA con l'identita' che il bundle le da': `--who` sceglie fra QUESTE e non fra
    // gli uomini con calcio all'estero - un infortunato senza una partita fuori dalla Serie A e' un
    // caso legittimo da guardare (le sue righe portano una RAGIONE invece di un incontro), e un banco
    // che lo rifiuta e' un banco che non puo' verificare meta' della richiesta.
    const drawn = rows
      .map((row) => {
        // IL NOME PIU' LUNGO che la riga contiene, e non il primo: `nameOf` e' in ordine di `fc_id`,
        // quindi «Sanchez Ro.» prendeva l'id di un «Sanchez» qualunque e il banco confrontava la card
        // di un uomo con le partite di un altro - un riepilogo che «non torna» accusando la pagina.
        const hit = [...nameOf.entries()]
          .filter(([, name]) => name && row.text.toLowerCase().includes(String(name).toLowerCase()))
          .sort((a, b) => String(b[1]).length - String(a[1]).length)[0];
        return hit ? { ...row, id: hit[0], name: hit[1], matches: abroad.get(hit[0]) ?? [] } : null;
      })
      .filter(Boolean)
      .filter((one) => !wanted || one.name.toLowerCase().includes(wanted.toLowerCase()))
      .sort((a, b) => b.matches.length - a.matches.length);
    const who = drawn[0];
    note('chi', {
      said: who
        ? `${who.name} (${who.id}): ${who.matches.length} partite fuori dal suo campionato, `
          + `${new Set(who.matches.map((one) => one.competition)).size} competizioni`
        : 'nessuna riga della plancia porta un nome che il bundle conosca',
      problems: who ? [] : ['nessuno da guardare'],
    });
    if (!who) throw new Error('nobody to look at');

    // 2. LA CARD, e l'elenco APERTO: e' quello che porta piu' di cinque righe.
    await click(session, who);
    const card = await waitFor(session, () => !!document.querySelector('ui-player-card'), 20);
    if (!card) throw new Error('la card non si e\' aperta');
    const expand = await evaluate(session, () => {
      const button = document.querySelector('ui-player-card [data-expand]');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    if (expand) await click(session, expand);
    await wait(700);
    const shown = await waitFor(session, readMatches, 20);
    if (!shown?.rows?.length) {
      note('l\'elenco', { said: shown?.empty ?? 'vuoto', problems: ['la card non ha nessuna riga'] });
      throw new Error('no rows');
    }

    // 3. CE NE SONO DI UN ALTRO CAMPIONATO? E' la richiesta, ridotta a un conteggio.
    const matchedAbroad = shown.rows.filter((one) =>
      who.matches.some((match) => sameFixture(one, match)),
    );
    const marks = shown.rows.filter((one) => one.mark);
    note('le partite di un altro campionato', {
      said:
        `${shown.rows.length} righe · ${marks.length} col marchio di una competizione · `
        + `${matchedAbroad.length} riconosciute nel bundle come giocate altrove`,
      sample: matchedAbroad.slice(0, 4).map((one) => `${one.fixture} ${one.minutes} ${one.vote}`),
      drawn: shown.rows.slice(0, 6).map(
        (one) => `${one.mark ?? '-'} ${one.fixture} | ${one.minutes} | ${one.vote} | ${one.fantavoto}`,
      ),
      // Se il bundle non gli conosce partite altrove non c'e' niente da pretendere: chiederlo
      // comunque sarebbe accusare la pagina di non disegnare una cosa che non esiste.
      problems: !who.matches.length || matchedAbroad.length
        ? []
        : ["nessuna partita fuori dal suo campionato e' arrivata sulla card"],
    });

    // 4. NESSUNA RIGA MOSTRA SOLO LA DATA: e' la richiesta, ridotta a una proprieta' falsificabile.
    //    «Cosa ha fatto» e' o un incontro con due squadre, o la ragione per cui non c'era: la prima
    //    versione di questo passo chiedeva quattro lettere nel nome e bocciava «Eve 1-1 Lil», cioe'
    //    accusava la pagina di un difetto della propria espressione regolare - le sigle sono di TRE.
    const dateOnly = shown.rows.filter((one) =>
      /^\d{1,2}[ªa]?\s*·?\s*\d{2}\/\d{2}\/\d{4}$/.test(one.fixture)
      || /^\d{2}\/\d{2}\/\d{4}$/.test(one.fixture),
    );
    const mute = shown.rows.filter((one) => one.sides.length < 2 && one.fixture.length < 4);
    const named = shown.rows.filter((one) => one.sides.length >= 2);
    note('cosa ha fatto', {
      said:
        `${named.length}/${shown.rows.length} righe nominano un incontro, `
        + `${shown.rows.length - named.length} portano una ragione`,
      problems: [
        ...(dateOnly.length ? [`${dateOnly.length} righe mostrano SOLO la data`] : []),
        ...(mute.length ? [`${mute.length} righe non dicono niente`] : []),
      ],
    });

    // 5. IL NUMERO E' QUELLO DEL BUNDLE, e la scala e' dichiarata: `~` sintetico, `*` provider.
    // Solo dove i due club identificano UNA partita sola: Beto ha giocato Bournemouth-Everton in due
    // stagioni, e prendere la prima che capita confronta la riga di quest'anno con quella di due anni
    // fa - un banco che sbaglia ad attribuire da' la colpa alla pagina. Quelle ambigue si CONTANO.
    //
    // LA STAGIONE FA PARTE DELLA CHIAVE, perche' gli stessi due club si incontrano ogni anno. La card
    // la scrive nel divisore; il primo blocco non ne ha uno sopra (e' la piu' recente), e quella si
    // ricava dai DATI - la stagione piu' alta fra le sue - non dallo schermo.
    //
    // ...E I CANDIDATI SONO TUTTE LE SUE PARTITE, non solo quelle dei cinque campionati. Costruendo
    // l'indice sui soli campionati, la riga «Tot 1-2 Ast» (Tottenham-Aston Villa di FA CUP, 59',
    // rating 6,6, col suo risultato) veniva attribuita alla partita di PREMIER fra gli stessi due
    // club (11', 6,3), e il banco accusava la pagina di stampare numeri sbagliati mentre stampava
    // quelli giusti di un'altra partita. Un indice costruito su meno di quello che lo schermo
    // disegna e' un indice che sbaglia ad attribuire.
    const all = external.rows
      .filter((row) => row[col(external, 'fc_id')] === who.id)
      .map((row) => ({
        season: row[col(external, 'season')],
        competition: row[col(external, 'competition')],
        date: row[col(external, 'match_date')],
        club: row[col(external, 'club')],
        opponent: row[col(external, 'opponent')],
        home: row[col(external, 'home')] === 1,
        minutes: row[col(external, 'minutes')],
        rating: row[col(external, 'rating')],
        synth: row[col(external, 'mv_synth')],
        goals: row[col(external, 'goals')],
        assists: row[col(external, 'assists')],
        xg: row[col(external, 'xg')],
        xa: row[col(external, 'xa')],
        matchId: row[col(external, 'match_id')],
        opponentGoals: row[col(external, 'opponent_goals')],
      }));
    const newest = all.map((one) => one.season).sort().at(-1);
    // I GOL DI OGNI CLUB IN OGNI PARTITA, per rifare dal bundle il conto dei gol subiti di un
    // portiere: gli INPUT vengono dai dati e non dallo schermo, che e' cio' che rende il confronto
    // una verifica e non un'eco.
    const scored = new Map();
    for (const row of external.rows) {
      const key = row[col(external, 'match_id')];
      if (!key) continue;
      let clubsIn = scored.get(key);
      if (!clubsIn) scored.set(key, (clubsIn = new Map()));
      const team = row[col(external, 'club')] ?? '';
      clubsIn.set(team, (clubsIn.get(team) ?? 0) + (row[col(external, 'goals')] ?? 0));
    }
    const concededIn = (match) => {
      if (match.opponentGoals != null) return match.opponentGoals;
      const clubsIn = scored.get(match.matchId);
      if (!clubsIn || clubsIn.size < 2) return null;
      let goals = 0;
      for (const [team, n] of clubsIn) if (team !== match.club) goals += n;
      return goals;
    };
    const byFixture = new Map();
    for (const match of all) {
      const key = `${match.season}|${sidesOf(match).join('|')}`;
      byFixture.set(key, [...(byFixture.get(key) ?? []), match]);
    }
    const checked = [];
    let ambiguous = 0;
    let ownLeague = 0;
    for (const row of shown.rows) {
      const found = byFixture.get(`${row.season ?? newest}|${row.sides.slice(0, 2).join('|')}`);
      if (!found) continue;
      if (found.length > 1) {
        ambiguous += 1;
        continue;
      }
      const source = found[0];
      const want = source.synth != null
        ? `~${roundVote(source.synth).toFixed(1).replace('.', ',')}`
        : source.rating != null
          ? `*${source.rating.toFixed(1).replace('.', ',')}`
          : '·';
      // NIENTE MINUTI E NIENTE RATING = la riga non lo mette in campo affatto: al posto dei minuti
      // disegna l'icona dello stato, quindi la cella non ha testo. Aspettarsi «?'» li' era una mia
      // assunzione sul componente e non una lettura di quello che fa.
      const onPitch = source.minutes != null || source.rating != null;
      const wantMinutes = !onPitch ? '' : source.minutes == null ? "?'" : `${source.minutes}'`;
      // IL MARCHIO DICE LA COMPETIZIONE, e la competizione la sa il bundle: `serie_a` e' il suo, e non
      // porta marchio; un altro campionato e' un calendario, una coppa un trofeo, un'amichevole un caffe'.
      // IL SUO CAMPIONATO NON SI GIUDICA QUI: li' il voto viene dai VOTI (`match_ratings`), non dal
      // rating del provider, quindi predirlo da `external_match_stats` sarebbe confrontare la riga con
      // la fonte sbagliata - il banco leggeva «5,5 invece di *6,7» su una riga giusta.
      const own = LEAGUES.has(source.competition) && source.competition === leagueOf.get(who.id);
      if (own) {
        ownLeague += 1;
        continue;
      }
      const wantMark = own
        ? null
        : LEAGUES.has(source.competition)
          ? 'anticon-calendar'
          : FRIENDLY.has(source.competition)
            ? 'anticon-coffee'
            : 'anticon-trophy';
      checked.push({
        fixture: row.fixture,
        competition: source.competition,
        vote: row.vote, wantVote: want,
        minutes: row.minutes, wantMinutes,
        mark: row.mark, wantMark,
        ok: row.vote === want && row.minutes.endsWith(wantMinutes),
      });
    }
    const wrong = checked.filter((one) => !one.ok);
    const mismatched = checked.filter((one) => one.wantMark !== one.mark);
    note('il numero viene dal bundle', {
      said:
        `${checked.length - wrong.length}/${checked.length} righe estere col voto e i minuti attesi`
        + ` (${ambiguous} saltate perche' ambigue, ${ownLeague} del suo campionato che i VOTI prezzano)`,
      sample: checked.slice(0, 4),
      problems: [
        ...(wrong.length ? [`${wrong.length} discordanti: ${JSON.stringify(wrong.slice(0, 2))}`] : []),
        ...(mismatched.length
          ? [`${mismatched.length} col marchio sbagliato: ${JSON.stringify(mismatched.slice(0, 2))}`]
          : []),
      ],
    });

    // 5b. LA SCALA E' DICHIARATA SULLA RIGA: `~` il sintetico, `*` il rating del provider.
    //     Il conto si fa SULLO SCHERMO e non sul bundle, perche' la domanda e' se il numero che si
    //     legge dica di che scala e': un rating stampato nudo si confonderebbe con un voto.
    const synthShown = shown.rows.filter((one) => one.vote.startsWith('~')).length;
    const ratingShown = shown.rows.filter((one) => one.vote.startsWith('*')).length;
    const naked = shown.rows.filter((one) => one.mark && /^[0-9]/.test(one.vote));
    note('la scala del numero', {
      said: `${synthShown} righe col sintetico (~) · ${ratingShown} col rating (*)`,
      problems: naked.length
        ? [`${naked.length} righe di un'altra competizione stampano un numero nudo: scala ignota`]
        : synthShown === 0 && ratedRows > 0 && synthRows * 2 < ratedRows
          ? [
            `nessun sintetico a schermo, e il bundle ne porta ${synthRows} su ${ratedRows} righe col `
            + 'rating: `synth` va rieseguito nel toolkit, poi `export` e `npm run data:pull`',
          ]
          : [],
    });

    // 5c. L'INCOLONNAMENTO SOPRAVVIVE AL SUBGRID. E' la sola cosa che il passaggio da
    //     `display: contents` a `grid-cols-subgrid` puo' rompere, e la romperebbe in silenzio: le
    //     colonne scivolerebbero di riga in riga e la lista si leggerebbe a zig-zag.
    const columns = shown.rows[0].xs.map((_, at) => new Set(shown.rows.map((one) => one.xs[at])));
    const ragged = columns.filter((one) => one.size > 1);
    note('le colonne restano incolonnate', {
      said: `${columns.length} colonne su ${shown.rows.length} righe · ${ragged.length} disallineate`,
      xs: shown.rows[0].xs,
      problems: ragged.length
        ? [`${ragged.length} colonne hanno x diverse fra le righe: ${JSON.stringify(ragged.map((one) => [...one]))}`]
        : [],
    });

    // 5d. LO STEMMA E' QUELLO DELLA SQUADRA DI QUELLA RIGA, non del club di oggi.
    //     Il file atteso si ricava dal BUNDLE (nome del club -> `fc_club_id` -> file), che e' la
    //     stessa catena che l'app percorre ma ricostruita fuori da lei.
    const badged = [];
    for (const row of shown.rows) {
      const source = byFixture.get(`${row.season ?? newest}|${row.sides.slice(0, 2).join('|')}`);
      if (!source || source.length !== 1) continue;
      const match = source[0];
      // IL SUO CLUB E' SEMPRE `club`, e il LATO dipende da dove giocava: `sidesOf` mette in casa a
      // sinistra, quindi da trasferta il suo stemma e' il secondo. Prendere il club del lato sinistro
      // significa chiedere lo stemma dell'AVVERSARIO e poi stupirsi che non torni.
      const want = crestFile(match.club);
      if (!want) continue;
      const drawnFile = (row.badges[match.home === false ? 1 : 0] ?? '').split('/').pop();
      badged.push({
        fixture: row.fixture, club: match.club, want, drawn: drawnFile, ok: drawnFile === want,
      });
    }
    const wrongBadge = badged.filter((one) => !one.ok);
    note("lo stemma e' della squadra giusta", {
      said: `${badged.length - wrongBadge.length}/${badged.length} righe con lo stemma del club di QUELLA partita`,
      sample: badged.slice(0, 3),
      problems: wrongBadge.length
        ? [`${wrongBadge.length} con lo stemma sbagliato: ${JSON.stringify(wrongBadge.slice(0, 2))}`]
        : [],
    });

    // 5e. LE RIGHE DI UN ALTRO CLUB SONO EVIDENZIATE, e il confronto e' FRA RIGHE della stessa
    //     pagina: i token sono `color-mix` e il tema ha due versi, quindi un colore letterale non
    //     e' un'affermazione verificabile (lezione del 04/09/2026).
    const his = abbreviate(shown.club);
    const away = shown.rows.filter((one) => one.sides.length >= 2 && !one.sides.includes(his));
    const home = shown.rows.filter((one) => one.sides.includes(his));
    const awayTones = new Set(away.map((one) => one.background));
    const homeTones = new Set(home.map((one) => one.background));
    note('le righe di un altro club sono evidenziate', {
      said:
        `${home.length} righe col suo club (${[...homeTones].join(' / ')}) · `
        + `${away.length} con un altro (${[...awayTones].join(' / ')})`,
      problems:
        !away.length || !home.length
          ? []
          : [...awayTones].some((tone) => homeTones.has(tone))
            ? ['una riga di un altro club ha lo stesso sfondo di una del suo: non si distingue']
            : [],
    });

    // 5f. IL TASTO IN FONDO carica la stagione che nomina.
    // ...e ci si arriva SCORRENDO, che e' anche il gesto della richiesta: un tasto in fondo a una
    // lista che scorre ha un rettangolo fuori dallo schermo finche' non lo si raggiunge, e cliccare
    // le sue coordinate colpirebbe quello che c'e' li' sopra.
    await evaluate(session, () => {
      const grid = document.querySelector('ui-player-card [data-matches]');
      if (grid) grid.scrollTop = grid.scrollHeight;
    });
    await wait(300);
    const more = await evaluate(session, readMore);
    let after = null;
    if (more) {
      await click(session, more);
      await wait(500);
      after = await evaluate(session, readMatches);
    }
    note('carica la stagione precedente', {
      said: more
        ? `«${more.text}» · righe ${shown.rows.length} -> ${after?.rows.length ?? '?'}`
        : '(nessun tasto: non ci sono altre stagioni)',
      problems: !more
        ? []
        : !/^Carica stagione \d{4}-\d{2}$/.test(more.text)
          ? [`il tasto non nomina una stagione: «${more.text}»`]
          : (after?.rows.length ?? 0) <= shown.rows.length
            ? ["il tasto non ha caricato nessuna riga in piu'"]
            : (after.rows.some((one) => one.season === more.text.replace('Carica stagione ', ''))
              ? []
              : ['le righe caricate non sono della stagione che il tasto nomina']),
    });

    // 5g. IL SINTETICO STA SULLA GRIGLIA DEI MEZZI PUNTI, come ogni voto vero (misurato sul bundle:
    //     57.925 su 57.925). Vale anche per il FANTAVOTO, che si somma a quel numero e non a quello
    //     prima dell'arrotondamento - o la riga non tornerebbe.
    // LA GRIGLIA E' DELLA SCALA DEL FANTACALCIO, non di ogni numero della riga: il rating del
    // provider (`*`) sta su un'altra scala e non ha nessun motivo di essere a mezzi punti - la prima
    // versione di questo passo lo pretendeva e accusava la pagina di cinque numeri giusti.
    const onGrid = (text) => {
      if (text.startsWith('*')) return true;
      const value = Number(text.replace(/^[~]/, '').replace(',', '.'));
      return !Number.isFinite(value) || Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;
    };
    const offGrid = shown.rows.filter(
      (one) => !onGrid(one.vote) || !onGrid(one.fantavoto.replace('—', '')),
    );
    // ...e il fantavoto si RICALCOLA DAL BUNDLE - il voto arrotondato piu' i punteggi degli eventi
    // che il layer per-partita porta - e non dal testo della riga: la cella dei bonus disegna dei
    // MARCHI e non dei numeri, quindi leggerla come se ci fossero i punti trova zero e accusa la
    // pagina di una somma che non torna. Un banco che ricava l'atteso dallo schermo non prova niente.
    const summed = [];
    for (const row of shown.rows) {
      if (!row.vote.startsWith('~') || row.fantavoto === '—') continue;
      const found = byFixture.get(`${row.season ?? newest}|${row.sides.slice(0, 2).join('|')}`);
      if (!found || found.length !== 1 || found[0].synth == null) continue;
      const terms = { ...scoring.default, ...(scoring.leagues[found[0].competition] ?? {}) };
      // I GOL SUBITI DI UN PORTIERE entrano nella somma (operatore, 05/09/2026), e si contano dal
      // bundle come li conta l'app: il risultato dichiarato se c'e', altrimenti i gol degli altri
      // club di quella partita.
      const conceded = roleOf.get(who.id) === 'P' ? concededIn(found[0]) : null;
      if (roleOf.get(who.id) === 'P' && conceded == null) continue;
      const points =
        (found[0].goals ?? 0) * (terms.goal_bonus ?? 0)
        + (found[0].assists ?? 0) * (terms.assist_bonus ?? 0)
        - (conceded ?? 0) * (terms.goal_conceded_malus_gk ?? 0);
      const want = roundVote(found[0].synth) + points;
      const said = Number(row.fantavoto.replace('~', '').replace(',', '.'));
      summed.push({ fixture: row.fixture, said, want, ok: Math.abs(said - want) < 0.011 });
    }
    const wrongSum = summed.filter((one) => !one.ok);
    note('il voto sintetico e il suo fantavoto', {
      said:
        `${summed.length} righe col fantavoto calcolato · ${offGrid.length} numeri fuori dalla `
        + 'griglia dei mezzi punti',
      sample: summed.slice(0, 3).map((one) => `${one.fixture} ${one.vote} ${one.bonuses} = ${one.fantavoto}`),
      problems: [
        ...(offGrid.length
          ? [`${offGrid.length} numeri non sono mezzi punti: ${JSON.stringify(offGrid.slice(0, 2).map((one) => [one.vote, one.fantavoto]))}`]
          : []),
        ...(wrongSum.length
          ? [`${wrongSum.length} fantavoti non tornano col voto + i bonus della riga: ${JSON.stringify(wrongSum.slice(0, 2))}`]
          : []),
      ],
    });

    // 5h. LE PARTITE CHE NON SONO DI CAMPIONATO SONO ATTENUATE, e le altre no.
    const cupRows = shown.rows.filter((one) => one.mark === 'anticon-trophy' || one.mark === 'anticon-coffee');
    const leagueRows = shown.rows.filter((one) => one.mark !== 'anticon-trophy' && one.mark !== 'anticon-coffee');
    const litCup = cupRows.filter((one) => one.dim > 0.9);
    const dimLeague = leagueRows.filter((one) => one.dim < 0.9);
    note('coppe e amichevoli attenuate', {
      said: `${cupRows.length} righe non di campionato (opacita' ${[...new Set(cupRows.map((one) => one.dim))].join('/')}) · ${leagueRows.length} di campionato (${[...new Set(leagueRows.map((one) => one.dim))].join('/')})`,
      problems: [
        ...(litCup.length ? [`${litCup.length} coppe/amichevoli non attenuate`] : []),
        ...(dimLeague.length ? [`${dimLeague.length} partite di campionato attenuate per sbaglio`] : []),
      ],
    });

    // 5i. IL DIVISORE DEL CAMBIO DI SQUADRA, e i nomi che non devono essere tagliati.
    // La colonna e' una sola per tutta la griglia: la sua larghezza si legge da una riga qualunque,
    // e quante ne ha davvero da mostrare si conta sui MARCHI (la cella non stampa numeri).
    const widest = Math.max(...shown.rows.map((one) => one.bonusWidth));
    const withMarks = shown.rows.filter((one) => one.bonusMarks).length;
    const clipped = shown.rows.filter((one) => one.clipped);
    note('il cambio di squadra e lo spazio ai bonus', {
      said:
        `divisori di squadra: ${JSON.stringify(shown.clubBreaks)} · `
        + `colonna bonus ${widest}px per ${withMarks} righe con marchi · `
        + `${clipped.length} righe con un nome tagliato`,
      problems: clipped.length ? [`${clipped.length} righe hanno un nome tagliato`] : [],
    });

    // 5j. IL RIEPILOGO DI STAGIONE: incolonnato come una riga di partita, e coi numeri che il
    //     BUNDLE dice - ricalcolati qui sulle partite di CAMPIONATO di quella stagione, che e' la
    //     popolazione dichiarata (coppe e amichevoli fuori: sono le righe attenuate).
    const wantTotals = (season) => {
      const own = all.filter(
        (one) => one.season === season && LEAGUES.has(one.competition)
          && (one.minutes != null || one.rating != null),
      );
      if (!own.length) return null;
      const mins = own.filter((one) => one.minutes != null).map((one) => one.minutes);
      const votes = own.filter((one) => one.synth != null).map((one) => roundVote(one.synth));
      const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
      return {
        played: own.length,
        minutes: mins.length ? Math.round(mean(mins)) : null,
        mv: mean(votes),
        goals: own.reduce((sum, one) => sum + (one.goals ?? 0), 0),
      };
    };
    const wrongTotals = [];
    for (const one of shown.summaries) {
      // La stagione del riepilogo e' quella del divisore che ha appena sopra - e il PRIMO un divisore
      // non ce l'ha, perche' la stagione in corso la annuncia l'intestazione (05/09/2026). Saltarlo
      // avrebbe lasciato senza verifica proprio il riepilogo che l'operatore ha chiesto.
      const want = wantTotals(one.season ?? newest);
      if (!want) continue;
      const said = Number((one.played.match(/\d+/) ?? [0])[0]);
      const mins = Number((one.minutes.match(/\d+/) ?? [NaN])[0]);
      const mv = Number(one.mv.replace('~', '').replace(',', '.'));
      const ok =
        said === want.played
        && (want.minutes == null || Math.abs(mins - want.minutes) <= 1)
        && (want.mv == null || Math.abs(mv - want.mv) < 0.06);
      if (!ok) wrongTotals.push({ ...one, want });
    }
    // ...e le sue celle stanno sulle STESSE x delle righe: «incolonnate correttamente» e' una misura.
    const misaligned = shown.summaries.filter(
      (one) => one.xs.join('|') !== shown.rows[0].xs.join('|'),
    );
    // 5k. GLI ATTESI DEL RIEPILOGO, ricalcolati QUI dal bundle e mai dallo schermo.
    //     L'ammissibilita' si ri-deriva come fa l'app - un (stagione, competizione) in cui la fonte
    //     ha pubblicato almeno un attesa - invece di importarla: se un giorno la regola cambiasse in
    //     un solo posto, il banco deve accorgersene, non seguirla.
    const scope = { xg: new Set(), xa: new Set() };
    for (const row of external.rows) {
      const key = `${row[col(external, 'season')]}|${row[col(external, 'competition')]}`;
      if (row[col(external, 'xg')] != null) scope.xg.add(key);
      if (row[col(external, 'xa')] != null) scope.xa.add(key);
    }
    const wantExpected = (season) => {
      const own = all.filter(
        (one) => one.season === season && LEAGUES.has(one.competition)
          && (one.minutes != null || one.rating != null),
      );
      const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
      const values = (which) =>
        own
          .filter((one) => scope[which].has(`${one.season}|${one.competition}`))
          .map((one) => one[which] ?? 0);
      return { xg: mean(values('xg')), xa: mean(values('xa')) };
    };
    const wrongExpected = [];
    for (const one of shown.expected) {
      const want = wantExpected(one.season ?? newest);
      const said = [...one.values.matchAll(/(\d+,\d+)/g)].map((m) => Number(m[1].replace(',', '.')));
      const near = (screen, bundle) =>
        bundle == null ? screen === undefined : screen != null && Math.abs(screen - bundle) < 0.006;
      if (!near(said[0], want.xg) || !near(said[1], want.xa)) wrongExpected.push({ ...one, want });
    }
    note('gli attesi del riepilogo', {
      said: shown.expected.length
        ? shown.expected.map((one) => `${one.season ?? newest}: ${one.values}`).join(' | ')
        : 'nessuna riga di attesi (la fonte non li pubblica per queste stagioni)',
      problems: wrongExpected.length
        ? [`${wrongExpected.length} riepiloghi con attesi diversi dal bundle`]
        : [],
      sample: wrongExpected.slice(0, 2),
    });

    // 5l. LA CARD CI STA: nessuna cella oltre il bordo destro della griglia. Un valore tagliato dal
    //     bordo non e' stretto, e' ASSENTE - e nessun conteggio di righe o di celle lo vede.
    note('i valori ci stanno nella card', {
      said: `card ${shown.fit.card}px · griglia ${shown.fit.given}px, ne chiede ${shown.fit.needed} `
        + `· ${shown.fit.cutRows} righe tagliate (max ${shown.fit.cut}px)`,
      problems: shown.fit.cut > 0
        ? [`${shown.fit.cutRows} righe perdono fino a ${shown.fit.cut}px oltre il bordo`]
        : [],
    });

    note('il riepilogo di stagione', {
      said: shown.summaries.length
        ? shown.summaries
          .map((one) => `${one.season}: ${one.played} · ${one.minutes} · ${one.mv} · ${one.marks.join(' ')} · ${one.fm}`)
          .join(' | ')
        : '(nessuna stagione da riassumere)',
      problems: [
        ...(wrongTotals.length
          ? [`${wrongTotals.length} riepiloghi non tornano col bundle: ${JSON.stringify(wrongTotals.slice(0, 1))}`]
          : []),
        ...(misaligned.length ? [`${misaligned.length} riepiloghi fuori colonna`] : []),
      ],
    });

    // 6. LA BARRA DI SCORRIMENTO, misurata e non dedotta da una classe.
    note('la barra di scorrimento', {
      said: `${shown.scrollbar}px (--scrollbar-size «${shown.size}», la normale e' ${NORMAL_SCROLLBAR}px)`,
      scrollbar: shown.scrollbar,
      scrolls: shown.scrolls,
      problems: !shown.scrolls
        ? ['l\'elenco non scorre: la barra non si puo\' misurare qui']
        : shown.scrollbar >= NORMAL_SCROLLBAR
          ? [`la barra e' larga ${shown.scrollbar}px, cioe' non piu' sottile della normale`]
          : shown.scrollbar === 0
            ? ['larghezza zero: la barra non occupa spazio, quindi non e\' quella che si vede']
            : [],
    });

    // 7. IL TOOLTIP nomina la competizione: e' li' che vive il nome per esteso.
    const abroadRow = matchedAbroad[0] ?? shown.rows.find((one) => one.mark);
    let hint = null;
    if (abroadRow) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: Math.round(abroadRow.box.x), y: Math.round(abroadRow.box.y),
        button: 'none',
      });
      await wait(900);
      hint = await evaluate(session, readTooltip);
    }
    note('il tooltip', {
      said: hint ?? '(nessun tooltip aperto)',
      problems: !abroadRow || (hint && /[A-Za-z]{4}/.test(hint))
        ? []
        : ['il tooltip non dice di che partita e\''],
    });

    if (flag('--shot')) {
      // IN CIMA PRIMA DI FOTOGRAFARE: l'elenco e' rimasto dove il tasto «carica» lo aveva lasciato, e
      // una foto scattata a meta' lista non mostra la testa della card - che e' dove sta il riepilogo
      // della stagione in corso, cioe' proprio quello che si vuole guardare.
      await evaluate(session, () => {
        const grid = document.querySelector('ui-player-card [data-matches]');
        if (grid) grid.scrollTop = 0;
        return true;
      });
      const shot = await session.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(ROOT, 'player-card.png'), Buffer.from(shot.data, 'base64'));
      console.log('  screenshot -> player-card.png');
    }

    const noise = session.noise();
    if (noise.length) note('la console', { said: `${noise.length} messaggi`, problems: noise });
  } finally {
    session?.close();
    browser.kill();
    server.close();
  }

  if (flag('--json')) console.log(JSON.stringify(report, null, 2));
  console.log(report.problems.length ? `\nPROBLEMI: ${report.problems.length}` : '\nnessun problema');
  process.exit(report.problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
