/* Generates a DEMO bundle with the same shape as the toolkit's export, for the public
 * GitHub Pages build.
 *
 * Why this exists: the real bundle is paid fantacalcio.it content ("NON PUO' ESSERE
 * RIPRODOTTO NE' PUBBLICATO"), so it is gitignored and can never be deployed. Everything
 * here is INVENTED - clubs, players, votes - and the manifest says so with `demo: true`,
 * which the app reads to put a banner on screen. Nobody should ever mistake this for data.
 *
 *   node scripts/make-demo-bundle.mjs <output-dir>
 */
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] ?? 'public/data');

/* Deterministic pseudo-randomness: the same demo every build, so a visual difference on the
 * published page is a code change and never the dice. */
let seed = 20260809;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);

const SEASONS = ['2024-25', '2025-26'];
const MATCHDAYS = 38;
const LEAGUE = 'serie_a'; // the identifier the real bundle uses: the demo must speak the same vocabulary
const TARGET_SEASON = '2026-27';

// Invented clubs. Deliberately not real ones: a fictional table must look fictional.
const CLUB_NAMES = [
  'Aurelia', 'Borgorosso', 'Calanca', 'Duomo FC', 'Estense', 'Fontechiara', 'Grifonia',
  'Altavilla', 'Lagoverde', 'Montebello', 'Nuvolara', 'Ortica', 'Portovecchio', 'Quercia',
  'Rocca Alta', 'Salicorno', 'Torrenova', 'Valmarina', 'Ventaglio', 'Zafferana',
];

const SURNAMES = [
  'Amato', 'Bandini', 'Corsi', 'Dallara', 'Ercolani', 'Fabbri', 'Gallo', 'Iacobelli',
  'Lanza', 'Marchetti', 'Nardi', 'Orsini', 'Petrucci', 'Quarta', 'Rovere', 'Sabatini',
  'Tinelli', 'Ubaldi', 'Vanzetti', 'Zoppi', 'Bertoldi', 'Cinquini', 'Draghi', 'Esposti',
  'Ferraro', 'Ginepro', 'Loriga', 'Masiero', 'Neroni', 'Pantano', 'Ravaglia', 'Sartori',
  'Toscano', 'Verdelli', 'Zanobbi', 'Bellandi', 'Cattaneo', 'Donati', 'Fiorillo', 'Guidetti',
];
const INITIALS = ['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.', 'L.', 'M.', 'N.', 'P.', 'R.', 'S.', 'T.'];

const SQUAD = [
  ...Array(3).fill('P'),
  ...Array(8).fill('D'),
  ...Array(8).fill('C'),
  ...Array(6).fill('A'),
];
const MANTRA = {
  P: ['Por'],
  D: ['Dc', 'Dd', 'Ds', 'Dc;Ds', 'Dd;E', 'B;Dc'],
  C: ['M', 'C', 'M;C', 'C;T', 'E;C', 'W;T'],
  A: ['Pc', 'A', 'W;A', 'T;A', 'Pc;A'],
};

const clubs = CLUB_NAMES.map((name, i) => ({ id: i + 1, name }));

const players = [];
let fcId = 1000;
for (const club of clubs) {
  for (const role of SQUAD) {
    const surname = SURNAMES[(fcId * 7) % SURNAMES.length];
    const name = rnd() < 0.25 ? `${surname} ${pick(INITIALS)}` : surname;
    players.push({
      fcId: ++fcId,
      name,
      role,
      mantra: pick(MANTRA[role]),
      club: club.id,
      clubName: club.name,
      // How often he is fielded, and how good he is. Both are what makes the table look
      // like football instead of noise.
      starter: between(0.05, 0.98),
      quality: between(-0.6, 0.9),
    });
  }
}

/* Circle-method round robin: 19 rounds, mirrored into 38, so every matchday is a real
 * pairing and the derived scoreline (goals for / goals against) is consistent. */
function fixtures(round) {
  const n = clubs.length;
  const half = n / 2;
  const rotation = clubs.slice(1);
  const shift = round % (n - 1);
  const order = [clubs[0], ...rotation.slice(shift), ...rotation.slice(0, shift)];
  const pairs = [];
  for (let i = 0; i < half; i++) {
    const home = order[i];
    const away = order[n - 1 - i];
    pairs.push(round < n - 1 ? [home, away] : [away, home]);
  }
  return pairs;
}

const matchRatings = [];
const externalStats = [];

for (const season of SEASONS) {
  for (let md = 1; md <= MATCHDAYS; md++) {
    const date = matchDate(season, md);
    for (const [home, away] of fixtures((md - 1) % (clubs.length - 1) + (md > 19 ? clubs.length - 1 : 0))) {
      const homeGoals = goalsFor(true);
      const awayGoals = goalsFor(false);
      fieldTeam(season, md, date, home, away, true, homeGoals, awayGoals);
      fieldTeam(season, md, date, away, home, false, awayGoals, homeGoals);
    }
  }
}

function goalsFor(home) {
  const draw = rnd();
  const base = home ? 1.45 : 1.15;
  let goals = 0;
  for (let i = 0; i < 6; i++) if (rnd() < base / 6) goals++;
  return draw < 0.02 ? goals + 1 : goals;
}

function matchDate(season, md) {
  const startYear = Number(season.slice(0, 4));
  const start = Date.UTC(startYear, 7, 20); // 20 August
  const day = start + (md - 1) * 7 * 86400000;
  return new Date(day).toISOString().slice(0, 10);
}

function fieldTeam(season, md, date, club, opponent, home, scored, conceded) {
  const squad = players.filter((p) => p.club === club.id);
  const keeper = squad.filter((p) => p.role === 'P').sort((a, b) => b.starter - a.starter)[0];
  const outfield = squad
    .filter((p) => p.role !== 'P')
    .map((p) => ({ p, roll: p.starter + between(-0.25, 0.25) }))
    .sort((a, b) => b.roll - a.roll)
    .slice(0, 13)
    .map((x) => x.p);

  // Hand the team's goals to the men most likely to have scored them.
  const scorers = new Map();
  const assisters = new Map();
  const candidates = outfield.filter((p) => p.role === 'A' || p.role === 'C');
  for (let g = 0; g < scored; g++) {
    const man = candidates.length ? pick(candidates) : pick(outfield);
    scorers.set(man.fcId, (scorers.get(man.fcId) ?? 0) + 1);
    if (rnd() < 0.65) {
      const helper = pick(outfield.filter((p) => p.fcId !== man.fcId));
      if (helper) assisters.set(helper.fcId, (assisters.get(helper.fcId) ?? 0) + 1);
    }
  }

  const fielded = [keeper, ...outfield].filter(Boolean);
  for (const player of fielded) {
    const started = player === keeper || outfield.indexOf(player) < 10;
    const minutes = started ? Math.round(between(60, 90)) : Math.round(between(5, 35));
    const goals = scorers.get(player.fcId) ?? 0;
    const assists = assisters.get(player.fcId) ?? 0;

    // A vote exists for most appearances; a short one sometimes has none (s.v.), which is
    // the case the UI has to render differently from "did not play".
    const rated = minutes >= 25 || rnd() < 0.5;
    let mv = null;
    if (rated) {
      const raw = 6 + player.quality * 0.5 + goals * 0.6 + assists * 0.2 + between(-0.9, 0.9);
      mv = Math.round(Math.min(9, Math.max(4, raw)) * 2) / 2;
    }
    const yellows = rnd() < 0.12 ? 1 : 0;
    const reds = rnd() < 0.012 ? 1 : 0;
    const fantavoto =
      mv == null ? null : Math.round((mv + goals * 3 + assists - yellows * 0.5 - reds * 1) * 2) / 2;

    matchRatings.push([
      player.fcId, season, md, player.role, club.name, 'default',
      mv, goals, assists, 0, 0, 0, 0,
      player.role === 'P' ? conceded : null,
      yellows, reds, 0, started ? 1 : 0, null, fantavoto, mv == null ? 'no_vote' : 'played',
    ]);

    // The provider's per-match layer: where the minutes and the opponent come from, and the
    // synthetic vote for the appearances fantacalcio did not rate.
    externalStats.push([
      player.fcId, season, 'sofascore', `${season}-${md}-${player.fcId}`, LEAGUE, md, date,
      club.name, opponent.name, home ? 1 : 0, minutes, started ? 1 : 0,
      mv == null ? Math.round(between(5.2, 6.4) * 100) / 100 : null,
    ]);
  }
}

const rosters = players.map((p) => [
  p.fcId, TARGET_SEASON, p.club, p.mantra.toLowerCase(), p.role, LEAGUE,
  Math.round(between(1, 30)), Math.round(between(1, 30)),
]);

const tables = {
  players: {
    columns: ['fc_id', 'canonical_name', 'birth_year', 'nationality'],
    rows: players.map((p) => [p.fcId, p.name, 1995 + Math.floor(rnd() * 12), 'IT']),
  },
  clubs: {
    columns: ['fc_club_id', 'canonical_name', 'league'],
    rows: clubs.map((c) => [c.id, c.name, LEAGUE]),
  },
  rosters: {
    columns: ['fc_id', 'season', 'fc_club_id', 'roles', 'role_classic', 'league', 'price', 'price_initial'],
    rows: rosters,
  },
  match_ratings: {
    columns: [
      'fc_id', 'season', 'matchday', 'role', 'team', 'platform', 'mv', 'goals', 'assists',
      'assists_set_piece', 'own_goals', 'pen_scored', 'pen_missed', 'goals_conceded',
      'yellows', 'reds', 'player_of_the_match', 'started', 'minutes', 'fantavoto', 'status',
    ],
    rows: matchRatings,
  },
  external_match_stats: {
    columns: [
      'fc_id', 'season', 'source', 'match_id', 'competition', 'real_md', 'match_date',
      'club', 'opponent', 'home', 'minutes', 'started', 'mv_synth',
    ],
    rows: externalStats,
  },
  matchday_map: {
    columns: ['season', 'euro_md', 'league', 'real_md', 'source', 'confidence'],
    rows: [],
  },
};

mkdirSync(OUT, { recursive: true });

const manifest = {
  schema_version: 1,
  demo: true,
  generated_at: new Date().toISOString(),
  target_season: TARGET_SEASON,
  input_season: SEASONS.at(-1),
  history_seasons: SEASONS,
  heavy_seasons: SEASONS,
  known_gaps: [
    'Questo bundle e\' GENERATO: nomi, squadre, voti e partite sono inventati. Il bundle reale del toolkit contiene dati a pagamento e non e\' pubblicabile.',
  ],
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

let bytes = 0;
for (const [name, table] of Object.entries(tables)) {
  const payload = gzipSync(JSON.stringify({ table: name, ...table }));
  writeFileSync(join(OUT, `${name}.json.gz`), payload);
  bytes += payload.length;
  console.log(`  ${name.padEnd(22)} ${String(table.rows.length).padStart(7)} rows`);
}
console.log(`demo bundle -> ${OUT} (${(bytes / 1024 / 1024).toFixed(1)} MB gzipped)`);
