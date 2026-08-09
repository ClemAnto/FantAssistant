/* Publishes the app to GitHub Pages FROM THIS MACHINE, bundle included.
 *
 *   npm run deploy:pages
 *
 * Why it is not a CI job: the bundle is not in git, so a runner cannot have it. Only the
 * machine that ran `python -m euroleghe_ingest export` can publish the real data, which is
 * also why there is exactly ONE publisher - a workflow deploying in parallel would republish
 * the site without the data and wipe it.
 *
 * ⚠️ What this puts online is the toolkit's real bundle: paid fantacalcio.it content, on a
 * public URL, downloadable by anyone who finds it. The operator decided this on 09/08/2026
 * («pubblica i dati veri ... la webapp e' per uso personale») against the standing rule in
 * the root CLAUDE.md, which now records the exception. robots.txt discourages crawlers -
 * that is the only access control GitHub Pages offers on a public repository.
 *
 * The branch is rewritten as a single orphan commit every time, so the repo does not grow by
 * 2.4 MB per deploy.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const APP = resolve(import.meta.dirname, '..');
const REPO = resolve(APP, '..');
const DIST = join(APP, 'dist/fantassistant/browser');
const BRANCH = 'gh-pages';
const BASE_HREF = '/FantAssistant/';

/* `shell` only where Windows needs it (npm/npx are .cmd): with a shell the arguments get
 * re-split on spaces, which is how a commit message became three unknown pathspecs. */
const run = (cmd, args, { cwd = APP, shell = false } = {}) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell });

console.log('1/5  bundle: copio l\'export piu\' recente in public/data');
run('node', ['scripts/pull-bundle.mjs']);

console.log(`\n2/5  build con base href ${BASE_HREF}`);
// public/ is an asset root in angular.json, so the bundle in public/data lands in dist.
run('npx', ['ng', 'build', '--base-href', BASE_HREF], { shell: process.platform === 'win32' });

console.log('\n3/5  file di contorno del sito');
copyFileSync(join(DIST, 'index.html'), join(DIST, '404.html')); // SPA fallback on Pages
writeFileSync(join(DIST, '.nojekyll'), '');
writeFileSync(
  join(DIST, 'robots.txt'),
  'User-agent: *\nDisallow: /\n', // personal use: ask crawlers to stay out
);

const manifest = JSON.parse(readFileSync(join(DIST, 'data/manifest.json'), 'utf8'));
console.log(
  `     bundle pubblicato: ${manifest.demo ? 'DEMO generato' : 'REALE, esportato il ' + manifest.generated_at.slice(0, 10)}`,
);

console.log(`\n4/5  preparo il branch ${BRANCH}`);
const work = mkdtempSync(join(tmpdir(), 'ghpages-'));
try {
  run('git', ['worktree', 'add', '--detach', work], { cwd: REPO });
  // The branch is rebuilt from scratch every time, so a local one left by the previous deploy
  // would make `checkout --orphan` fail. It is dropped, not reused: the remote is the truth.
  try {
    run('git', ['branch', '-D', BRANCH], { cwd: REPO });
  } catch {
    /* first deploy on this machine: there is nothing to delete */
  }
  run('git', ['checkout', '--orphan', BRANCH], { cwd: work });
  // The orphan branch starts with the previous worktree's files staged: clear it, then take
  // exactly what the build produced.
  run('git', ['rm', '-rq', '--cached', '.'], { cwd: work });
  for (const entry of readdirSync(work)) {
    if (entry !== '.git') rmSync(join(work, entry), { recursive: true, force: true });
  }
  cpSync(DIST, work, { recursive: true });

  console.log(`\n5/5  push`);
  run('git', ['add', '-A', '-f'], { cwd: work });
  run('git', ['commit', '-q', '-m', `deploy ${new Date().toISOString()}`], { cwd: work });
  run('git', ['push', '-q', '--force', 'origin', `${BRANCH}:${BRANCH}`], { cwd: work });
} finally {
  run('git', ['worktree', 'remove', '--force', work], { cwd: REPO });
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}

console.log('\nfatto -> https://clemanto.github.io/FantAssistant/');
