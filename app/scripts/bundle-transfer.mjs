/**
 * THE BUNDLE BETWEEN TWO MACHINES (09/10/2026, operator: «facciamo in modo che possa andare sulla macchina con il
 * database ed esportare un file che posso importare qui»). The database lives on ONE machine; the app is worked on
 * from others, which have no `data/export/` and so nothing for `data:pull` or `deploy:pages` to read.
 *
 *   on the machine WITH the database, after `python -m euroleghe_ingest export`:
 *     npm run data:pack                -> data/fantassistant-bundle-<season>.tgz
 *   on the other one:
 *     npm run data:import -- <file.tgz>  -> data/export/<season>/, then the same copy `data:pull` does
 *
 * WHAT TRAVELS is the export folder as `export` wrote it, so on the other side `pull-bundle.mjs` and
 * `deploy-pages.mjs` run unchanged - a second selection of «what the app needs» here would be a second
 * definition of the bundle, which is the defect this repository keeps paying for (the boards, `availability`,
 * `transfers_history`). Only `bundle.sqlite` stays home: no reader of the app opens it, and it is most of the size.
 *
 * THE FILE CARRIES PAID fantacalcio.it CONTENT, like `data/export/` itself: it is written under `data/` (gitignored)
 * and must never be committed or put anywhere public. Carry it on a drive or a private folder.
 *
 * `tar` is Windows' own (`System32\tar.exe`, bsdtar) and the archive goes through a PIPE, never a path argument:
 * GNU tar reads «H:\...» as a remote host, and a pipe means neither tar has to parse a Windows path.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DATA = resolve(import.meta.dirname, '../../data');
const EXPORT_ROOT = join(DATA, 'export');
const PREVIOUS = join(DATA, 'export-previous');
const SEASON = /^\d{4}-\d{2}$/;
const TAR = process.platform === 'win32' && existsSync(join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'))
  ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe')
  : 'tar';

/** Thrown, never `process.exit`: an exit skips the `finally` that removes the staging folder. */
function fail(message) {
  throw new Error(message);
}

function newestSeason() {
  if (!existsSync(EXPORT_ROOT)) return null;
  return readdirSync(EXPORT_ROOT).filter((d) => SEASON.test(d) && statSync(join(EXPORT_ROOT, d)).isDirectory()).sort().pop() ?? null;
}

function manifestOf(folder) {
  const path = join(folder, 'manifest.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Run tar with one end of the archive on a pipe; resolves on a clean exit, rejects with tar's own words. */
function tarPiped(args, cwd, { from = null, to = null } = {}) {
  return new Promise((done, failed) => {
    const child = spawn(TAR, args, { cwd, stdio: [from ? 'pipe' : 'ignore', to ? 'pipe' : 'ignore', 'pipe'] });
    let said = '';
    child.stderr.on('data', (chunk) => (said += chunk));
    if (from) createReadStream(from).pipe(child.stdin);
    if (to) child.stdout.pipe(createWriteStream(to));
    child.on('error', failed);
    child.on('close', (code) => (code === 0 ? done() : failed(new Error(`tar exited ${code}: ${said.trim().slice(0, 300)}`))));
  });
}

async function pack(season) {
  const chosen = season ?? newestSeason();
  if (!chosen) fail(`No export in ${EXPORT_ROOT}. Run first: python -m euroleghe_ingest export`);
  const folder = join(EXPORT_ROOT, chosen);
  const manifest = manifestOf(folder);
  if (!manifest) fail(`${folder} has no readable manifest.json: it is not an export folder.`);
  const out = join(DATA, `fantassistant-bundle-${chosen}.tgz`);
  await tarPiped(['-czf', '-', '--exclude', `${chosen}/bundle.sqlite`, chosen], EXPORT_ROOT, { to: out });
  console.log(`packed export ${chosen} (generated ${manifest.generated_at}, sheet revision ${manifest.sheet_revision ?? '?'})`);
  console.log(`  -> ${out}  ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
  console.log('  Paid content: carry it privately, never commit it. On the other machine: npm run data:import -- <file>');
}

async function importFrom(file) {
  if (!file) fail('Usage: npm run data:import -- <fantassistant-bundle-....tgz>');
  const archive = resolve(file);
  if (!existsSync(archive)) fail(`No such file: ${archive}`);
  // Unpacked NEXT TO its destination, so the final move is a rename on one volume and never half a copy. A
  // staging folder left by an import that was KILLED (no `finally` survives that) is ours, and goes first.
  for (const old of readdirSync(DATA).filter((d) => d.startsWith('.import-'))) {
    rmSync(join(DATA, old), { recursive: true, force: true });
  }
  const staging = join(DATA, `.import-${Date.now()}`);
  mkdirSync(staging, { recursive: true });
  try {
    await tarPiped(['-xzf', '-'], staging, { from: archive });
    const seasons = readdirSync(staging).filter((d) => statSync(join(staging, d)).isDirectory());
    if (seasons.length !== 1 || !SEASON.test(seasons[0])) {
      fail(`The archive must hold ONE season folder; it holds: ${seasons.join(', ') || 'nothing'}.`);
    }
    const season = seasons[0];
    const manifest = manifestOf(join(staging, season));
    if (!manifest?.schema_version) fail(`${season} in the archive has no readable manifest.json: refused.`);
    mkdirSync(EXPORT_ROOT, { recursive: true });
    const target = join(EXPORT_ROOT, season);
    if (existsSync(target)) {
      // THE EXPORT THIS ONE REPLACES is kept, once, outside `export/`: `pull-bundle` takes the newest folder by
      // name there, so a backup beside it would be read instead of the import. Only the previous one is kept -
      // it is a copy of a copy, and the database that made both is on the other machine.
      mkdirSync(PREVIOUS, { recursive: true });
      rmSync(join(PREVIOUS, season), { recursive: true, force: true });
      renameSync(target, join(PREVIOUS, season));
    }
    renameSync(join(staging, season), target);
    console.log(`imported export ${season} (generated ${manifest.generated_at}, sheet revision ${manifest.sheet_revision ?? '?'})`);
    console.log(`  -> ${target}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  // ...and the app's own copy, exactly as `npm run data:pull` makes it.
  const pulled = spawnSync(process.execPath, [join(import.meta.dirname, 'pull-bundle.mjs')], { stdio: 'inherit' });
  process.exit(pulled.status ?? 1);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === 'pack') await pack(arg ?? null);
  else if (command === 'import') await importFrom(arg);
  else fail('Usage: node scripts/bundle-transfer.mjs pack [season] | import <file.tgz>');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
