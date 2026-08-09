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
console.log(`  ${TABLES.length - missing.length}/${TABLES.length} tables, ${crests} crests, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
if (missing.length) console.warn(`  MISSING: ${missing.join(', ')}`);
