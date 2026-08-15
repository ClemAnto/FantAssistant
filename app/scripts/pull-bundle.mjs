/* Copies the toolkit's export bundle into public/data/ so the dev server can serve it.
 *
 * The app reads the BUNDLE, never the database: `python -m euroleghe_ingest export` writes
 * data/export/<season>/ and this script picks the newest one. The copy is gitignored for the
 * same reason the export is - it carries paid fantacalcio.it content and this repo is public.
 *
 *   node scripts/pull-bundle.mjs [season]
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const EXPORT_ROOT = resolve(import.meta.dirname, '../../data/export');
const OUT = resolve(import.meta.dirname, '../public/data');

/* Only what the views actually read. Adding a table here is a deliberate act: the bundle's
 * own contract is derived from what the engine queries, and this list from what the UI does. */
const TABLES = [
  'players',
  'clubs',
  'club_match_lineups',
  'rosters',
  'listone_quotes',
  'injuries',
  'match_ratings',
  'external_match_stats',
  'matchday_map',
  /* Last season's MEASURED fantamedia, per platform: the auction panel shows it beside the
   * prediction so a number can be judged against what the man actually did. */
  'season_stats',
  /* The GRANULAR real role - GK | DL DC DR | DM | ML MC MR | AM | LW RW | ST - which is the only
   * thing that separates a left back from a centre back: `rosters.role_classic` calls both `D`.
   * The boards already carry it for the eleven they draw; the squad view needs it for everybody,
   * and it is a SNAPSHOT (the provider serves only "now"), so the row carries its own date. */
  'player_roles',
];

if (!existsSync(EXPORT_ROOT)) {
  console.error(`No export at ${EXPORT_ROOT}. Run: python -m euroleghe_ingest export`);
  process.exit(1);
}

const season =
  process.argv[2] ??
  readdirSync(EXPORT_ROOT)
    .filter((d) => statSync(join(EXPORT_ROOT, d)).isDirectory())
    .sort()
    .pop();

const src = join(EXPORT_ROOT, season);
if (!existsSync(join(src, 'manifest.json'))) {
  console.error(`No manifest.json in ${src} - that folder is not a bundle.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
copyFileSync(join(src, 'manifest.json'), join(OUT, 'manifest.json'));
/* The scoring is per-CHAMPIONSHIP parametric and no reader may hard-code +3/-3/+1, so the
 * bonus/malus panel reads the same file the toolkit and the engine read. */
copyFileSync(join(src, 'config/scoring_config.json'), join(OUT, 'scoring_config.json'));
/* The GAME's own rules: the eleven legal Mantra shapes and which listone role fits each slot type.
 * They are what says how many men of a role a squad actually fields, so the auction panel needs them
 * to know its demand per role - without them it can only split a roster by macro quotas. */
if (existsSync(join(src, 'config/mantra_modules.json'))) {
  copyFileSync(join(src, 'config/mantra_modules.json'), join(OUT, 'mantra_modules.json'));
}
/* And the CLASSIC rulebook, which is a different law and not a subset: its places are macro-roles. The panel
 * needs it because its own role rationing was measured PER GAME, and without it a classic session rations
 * with what `startingPlaces` can say from nothing. */
if (existsSync(join(src, 'config/classic_modules.json'))) {
  copyFileSync(join(src, 'config/classic_modules.json'), join(OUT, 'classic_modules.json'));
}
/* The operator's DECLARED player notes: fuori rosa, rottura con la società, ha chiesto di andare via.
 * Nothing measures those, so they are declared and dated (`config/player_notes.json`, the same standing
 * as `board_rulings.json`), and they only ever draw an icon beside a name - no number reads them. A
 * bundle without the file simply shows no such icon. */
if (existsSync(join(src, 'config/player_notes.json'))) {
  copyFileSync(join(src, 'config/player_notes.json'), join(OUT, 'player_notes.json'));
}

let bytes = statSync(join(OUT, 'manifest.json')).size;
const missing = [];
for (const table of TABLES) {
  const file = `${table}.json.gz`;
  const from = join(src, 'json', file);
  if (!existsSync(from)) {
    missing.push(table);
    continue;
  }
  copyFileSync(from, join(OUT, file));
  bytes += statSync(from).size;
}

/* The engine's per-player numbers, one file per declared league. They are what the auction panel
 * ranks by - a surplus, never the listone's price - and the manifest says which league each one was
 * measured against, so they travel under their own folder and keep their names. */
const sheetsIn = join(src, 'sheets');
let sheets = 0;
if (existsSync(sheetsIn)) {
  const sheetsOut = join(OUT, 'sheets');
  mkdirSync(sheetsOut, { recursive: true });
  for (const file of readdirSync(sheetsIn)) {
    copyFileSync(join(sheetsIn, file), join(sheetsOut, file));
    bytes += statSync(join(sheetsIn, file)).size;
    sheets++;
  }
}

/* The DRAWN BOARDS, one file per declared league: per club the module, the eleven where the PANEL places it
 * and up to two ballottaggi per man. Without them the pitch has nothing honest to draw - and this copy was
 * missing for one build, which is exactly how «non vedo i campetti» happened: the bundle had them, the app's
 * own copy did not, and the card correctly said it had no board. A folder added to the export has to be added
 * HERE too, or the app is reading an older shape of the same bundle. */
const boardsIn = join(src, 'boards');
let boards = 0;
if (existsSync(boardsIn)) {
  const boardsOut = join(OUT, 'boards');
  mkdirSync(boardsOut, { recursive: true });
  for (const file of readdirSync(boardsIn)) {
    copyFileSync(join(boardsIn, file), join(boardsOut, file));
    bytes += statSync(join(boardsIn, file)).size;
    boards++;
  }
}

// The clubs' badges: a folder of small images plus the index that says which file is whose.
const crestsIn = join(src, 'crests');
let crests = 0;
if (existsSync(crestsIn)) {
  const crestsOut = join(OUT, 'crests');
  mkdirSync(crestsOut, { recursive: true });
  for (const file of readdirSync(crestsIn)) {
    copyFileSync(join(crestsIn, file), join(crestsOut, file));
    bytes += statSync(join(crestsIn, file)).size;
    crests++;
  }
}

const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
console.log(`bundle ${season} -> public/data`);
console.log(`  schema_version ${manifest.schema_version}, generated ${manifest.generated_at}`);
console.log(`  target ${manifest.target_season}, heavy seasons ${manifest.heavy_seasons.join(', ')}`);
console.log(`  ${TABLES.length - missing.length}/${TABLES.length} tables, ${crests} crests, `
  + `${sheets} engine sheets, ${boards} board files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
if (missing.length) console.warn(`  MISSING: ${missing.join(', ')}`);
/* Silence here would read as "the app can rank by surplus" while it cannot: without a sheet the
 * auction panel has no engine numbers at all and has to say so instead of ranking by the price. */
if (!sheets) console.warn('  NO engine sheets: run `snapshot --league NAME` then `export`.');
// A silent zero is how a whole feature reads as broken: the pitch has nothing to draw and nobody knows why.
if (!boards) {
  console.warn('  NO boards: the pitch of a real club will say it has none. They are written by `snapshot`'
    + ' (it needs a display) and carried by `export`.');
}
