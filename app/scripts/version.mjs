/* The app's version, in one place and never typed twice.
 *
 *   node scripts/version.mjs            regenerate src/app/version.ts from package.json
 *   node scripts/version.mjs --bump     bump the patch and regenerate
 *   node scripts/version.mjs --bump minor|major
 *
 * `package.json` is the source of truth; `src/app/version.ts` is generated from it so the
 * header can show it without importing the whole manifest into the bundle. The build and the
 * dev server regenerate it (prebuild/prestart), and `deploy:pages` bumps it - the operator's
 * rule of 09/08/2026: every publish gets a new number, so what is online can be named.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = resolve(import.meta.dirname, '..');
const MANIFEST = join(APP, 'package.json');
const OUT = join(APP, 'src/app/version.ts');

const argv = process.argv.slice(2);
const bumpIndex = argv.indexOf('--bump');
const kind = bumpIndex >= 0 ? (argv[bumpIndex + 1] ?? 'patch') : null;

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
let version = manifest.version;

if (kind) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (![major, minor, patch].every(Number.isInteger)) {
    throw new Error(`versione non interpretabile in package.json: "${version}"`);
  }
  version =
    kind === 'major'
      ? `${major + 1}.0.0`
      : kind === 'minor'
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;
  manifest.version = version;
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`versione ${kind}: ${version}`);
}

writeFileSync(
  OUT,
  `// GENERATO da scripts/version.mjs - non modificare a mano.\n` +
    `// La verita' e' package.json; questo file esiste solo perche' il template possa leggerla.\n` +
    `export const APP_VERSION = '${version}';\n`,
);
