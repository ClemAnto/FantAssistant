/* Bundles the app's own auction code into `appcode.mjs`, so every measurement here is about the code that
 * ships. Run it before any bench script; `run.ps1` does it for you.
 *
 * esbuild is the app's own (Angular ships it), so there is nothing to install. It strips the types and
 * emits ES modules - no transpilation choice is being made here that the app does not already make. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { HERE, ROOT } from './paths.mjs';

// The package's own JS shim, not `.bin/esbuild.cmd`: spawning a `.cmd` without a shell is EINVAL on
// Windows since Node 20, and going through a shell would need the paths quoted.
const esbuild = `${ROOT}app/node_modules/esbuild/bin/esbuild`;
if (!existsSync(esbuild)) {
  console.error(`esbuild not found at ${esbuild} - run "npm install" in app/ first.`);
  process.exit(1);
}

execFileSync(process.execPath, [
  esbuild,
  `${HERE}entry.ts`,
  '--bundle',
  '--format=esm',
  '--platform=node',
  `--outfile=${HERE}appcode.mjs`,
], { stdio: 'inherit' });

console.log('appcode.mjs written from app/src/app/core (the panel\'s own code)');
