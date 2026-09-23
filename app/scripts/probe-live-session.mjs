/**
 * probe-live-session.mjs - READ ONE LIVE fanta-asta-live SESSION AND PRINT ITS SHAPE.
 *
 * WHY IT EXISTS. `core/plancia-store.ts` says the board's lot is NAMED BY HAND when live, because
 * «this project has never observed a node naming the lot currently on the table». That sentence is an
 * absence of OBSERVATION and not a measurement, and on 24/09/2026 it turned out to be weaker than it
 * reads: the only two live sessions this repository ever looked at (09/08/2026, pinned in
 * `core/auction-feed.spec.ts`) both carry `marketType: 1` - they were DRAFTS, where there is no lot at
 * all, only a turn. Nobody here has ever watched a RAISE session with a name up. So what a bids table
 * publishes in that moment is UNKNOWN, not empty, and this is what answers it.
 *
 * It is the same discipline that found Transfermarkt's JSON host (17/08/2026): when a source seems not
 * to carry something, look at what it actually serves instead of arguing from the last thing that was
 * tried. A field guessed from a payload nobody has read is the defect this repository has already paid
 * for more than once; a field READ from one is a fact.
 *
 * WHAT IT DOES, and nothing else: anonymous sign-in (the same the site performs on load, with the same
 * public web API key), then ONE REST read of `sessions/<code>` and one of `sessions/<code>/state`. No
 * stream, no write, no peer registered - it does not appear at the table and cannot alter the auction.
 *
 * WHAT IT PRINTS is a SHAPE and not a payload: the keys, their types, and for the small scalars their
 * values. Names, prices and squads stay out on purpose - the listone is paid content and this script
 * has to be safe to paste into a chat. `--full` prints the raw `state` for the case where the shape is
 * not enough, and says so.
 *
 * Usage: node scripts/probe-live-session.mjs FA-xxx-xxx [--full]
 *
 * Run it WHILE a name is up for bidding: the whole question is which key changes between «nobody is
 * up» and «Lautaro is up», so the useful reading is two runs a few seconds apart.
 */

const FIREBASE_API_KEY = 'AIzaSyAji5aMonqYhjfCnHU6YW4TgwOIh8x302Y';
const DATABASE_URL = 'https://leghe-fantagazzetta-app.firebaseio.com';
const CODE_PATTERN = /FA-[a-z0-9]{3}-[a-z0-9]{3}/i;

/** The keys the app already reads. Everything else is what this probe exists to find. */
const KNOWN = new Set([
  'status',
  'marketType',
  'settings',
  'playerListType',
  'options',
  'teams',
  'picks',
  'pickOrder',
  'turnTeamId',
]);

const argv = process.argv.slice(2);
const full = argv.includes('--full');
const typed = argv.find((one) => CODE_PATTERN.test(one));
if (!typed) {
  console.error('serve un codice sessione: node scripts/probe-live-session.mjs FA-xxx-xxx [--full]');
  process.exit(2);
}
// The code IS the database key and it is generated lowercase, so `FA-Y6K-VG9` would 404.
const code = `FA-${typed.match(CODE_PATTERN)[0].slice(3).toLowerCase()}`;

async function signIn() {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    },
  );
  if (!response.ok) throw new Error(`sign-in ${response.status}`);
  return (await response.json()).idToken;
}

async function read(token, path) {
  const response = await fetch(`${DATABASE_URL}/sessions/${path}.json?auth=${token}`);
  if (!response.ok) throw new Error(`${path}: il server ha risposto ${response.status}`);
  return response.json();
}

/**
 * The shape of a value, one line deep plus a peek.
 *
 * Scalars are printed; arrays say how long they are and what the first element looks like; objects say
 * their keys. That is enough to recognise «here is a player id» without carrying the listone out.
 */
function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const first = value.find((one) => one != null);
    return `array(${value.length})${first !== undefined && depth < 2 ? ` di ${shape(first, depth + 1)}` : ''}`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (depth >= 2) return `oggetto {${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''}}`;
    return `oggetto\n${keys
      .map((key) => `${'  '.repeat(depth + 2)}${key}: ${shape(value[key], depth + 1)}`)
      .join('\n')}`;
  }
  if (typeof value === 'string') return value.length > 40 ? `stringa(${value.length})` : `"${value}"`;
  return String(value);
}

const MARKET = { 0: 'RILANCI (bids)', 1: 'DRAFT' };

async function main() {
  const token = await signIn();

  const root = await read(token, code);
  if (!root) {
    console.error(`nessuna asta con il codice ${code}: il server risponde 200 con null.`);
    process.exit(1);
  }

  console.log(`sessione ${code}, letta il ${new Date().toISOString()}`);
  console.log(`\nNODI DI PRIMO LIVELLO (accanto a "state"): ${Object.keys(root).join(', ')}`);
  for (const [key, value] of Object.entries(root)) {
    // `env` carries the listone - paid content - so it is counted and never printed.
    if (key === 'env') {
      console.log(`  env: ${Object.keys(value ?? {}).join(', ')} (contenuto non stampato)`);
      continue;
    }
    if (key === 'state') continue;
    console.log(`  ${key}: ${shape(value, 1)}`);
  }

  const state = root.state ?? (await read(token, `${code}/state`));
  if (!state) {
    console.error('la sessione non ha un nodo "state".');
    process.exit(1);
  }

  console.log(`\nMECCANISMO: marketType ${state.marketType} = ${MARKET[state.marketType] ?? '?'}`);
  console.log('\nCHIAVI DI state:');
  for (const [key, value] of Object.entries(state)) {
    const mark = KNOWN.has(key) ? ' ' : '*';
    console.log(`${mark} ${key}: ${shape(value, 1)}`);
  }

  const unknown = Object.keys(state).filter((key) => !KNOWN.has(key));
  console.log(
    unknown.length
      ? `\n* = CHIAVI CHE L'APP NON LEGGE: ${unknown.join(', ')}\n` +
          "  E' qui che vive, se esiste, il calciatore attualmente in asta."
      : "\nL'app legge gia' tutte le chiavi di questo stato: qui il calciatore in asta NON c'e'.",
  );

  if (full) {
    console.log('\n--- state, per intero (--full) ---');
    console.log(JSON.stringify(state, null, 2));
  } else if (unknown.length) {
    console.log('  (rilancia con --full per vederne il contenuto)');
  }
}

await main();
