// Measures the WCAG contrast of every theme in `src/styles/themes/`, because a screenshot
// shows a rendering and not a ratio. It reads the SHIPPED files: the default theme's
// `@theme static` block is the base palette, each extra theme is that base with its own
// `:root[data-theme="x"]` overrides applied on top - the same cascade the browser builds.
//
// It reports how many pairs it examined, and a run that examines zero is a FAILURE: a
// broken audit answering "0 problems" is indistinguishable from a clean page.
//
// What it cannot see, stated so nobody reads more into a pass than it says: ng-zorro's
// precompiled CSS paints component internals with its own literal colours, and those are
// only measurable in a browser. This audits the tokens and the pairs our own CSS builds
// from them.
//
//   node scripts/audit-contrast.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THEMES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'themes');
const DEFAULT_THEME = 'default.css';

// AA: 4.5 for body text. `null` means REPORTED AND NOT SCORED - not a lowered threshold but
// a pair no threshold governs, and the distinction is worth stating because relaxing a bar
// because a case failed it is the one thing this project does not do. WCAG 1.4.11 asks 3:1
// of the visual information REQUIRED TO IDENTIFY a control; our hairlines separate a card
// from the page next to it, which the filled surface already does. Both themes sit at
// 1.3-1.4:1 there, the default one included, so it is a property of the design and moving it
// is a decision about BOTH themes rather than a fix to slip into a new one.
const AA_TEXT = 4.5;
const REPORTED = null;

const SURFACES = ['page', 'surface', 'control'];
const INKS = ['fg', 'muted', 'primary', 'danger', 'warning', 'success'];

/** Every `--color-x: #hex` in a file, whichever block it sits in. */
function palette(css) {
  const found = new Map();
  for (const [, name, value] of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    found.set(name, value);
  }
  return found;
}

function rgb(hex) {
  const h = hex.slice(1);
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

/** `color-mix(in srgb, a p%, b)` - a plain linear mix of the gamma-encoded channels. */
function mix(a, b, p) {
  const [ra, ga, ba] = rgb(a);
  const [rb, gb, bb] = rgb(b);
  const at = (x, y) => x * p + y * (1 - p);
  const hex = (v) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(at(ra, rb))}${hex(at(ga, gb))}${hex(at(ba, bb))}`;
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** The pairs the app actually paints, each with the threshold that applies to it. */
function pairs(colors) {
  const out = [];
  const add = (what, fg, bg, min) => {
    if (colors.has(fg) === false && fg.startsWith('#') === false) return;
    if (colors.has(bg) === false && bg.startsWith('#') === false) return;
    out.push({
      what,
      fg: colors.get(fg) ?? fg,
      bg: colors.get(bg) ?? bg,
      min,
    });
  };

  for (const bg of SURFACES) for (const fg of INKS) add(`text-${fg} on bg-${bg}`, fg, bg, AA_TEXT);

  add('text-on-primary on bg-primary', 'on-primary', 'primary', AA_TEXT);
  // `.ant-btn-primary:hover` in ng-zorro.css lightens the fill; the ink does not follow it.
  out.push({
    what: 'text-on-primary on .ant-btn-primary:hover',
    fg: colors.get('on-primary'),
    bg: mix(colors.get('primary'), '#ffffff', 0.85),
    min: AA_TEXT,
  });

  // The role badges carry white text at 10px, so they are body text and not decoration.
  for (const name of [...colors.keys()].filter((k) => k.startsWith('role-'))) {
    add(`white on bg-${name}`, '#ffffff', name, AA_TEXT);
  }

  // Hairlines. Reported so the number is on the record rather than assumed - see REPORTED.
  add('border-border on bg-page', 'border', 'page', REPORTED);
  add('border-border on bg-surface', 'border', 'surface', REPORTED);
  add('bg-control on bg-page', 'control', 'page', REPORTED);

  return out;
}

const files = readdirSync(THEMES_DIR).filter((f) => f.endsWith('.css'));
const base = palette(readFileSync(join(THEMES_DIR, DEFAULT_THEME), 'utf8'));

let examined = 0;
let scored = 0;
let failed = 0;

for (const file of files) {
  const colors = file === DEFAULT_THEME ? base : new Map([...base, ...palette(readFileSync(join(THEMES_DIR, file), 'utf8'))]);
  const rows = pairs(colors);
  const bad = [];

  console.log(`\n${file}  -  ${rows.length} pairs`);
  for (const row of rows) {
    const r = ratio(row.fg, row.bg).toFixed(2);
    examined += 1;
    if (row.min === REPORTED) {
      console.log(`  --   ${r}:1  ${row.what}  (reported, no threshold)`);
    } else if (Number(r) < row.min) {
      bad.push(`  FAIL ${r}:1 (wants ${row.min})  ${row.what}  ${row.fg} on ${row.bg}`);
      scored += 1;
      failed += 1;
    } else {
      console.log(`  ok   ${r}:1  ${row.what}`);
      scored += 1;
    }
  }
  for (const line of bad) console.log(line);
}

console.log(`\n${examined} pairs examined, ${scored} scored against a threshold, ${failed} below it.`);
if (examined === 0) {
  console.log('An audit that examined nothing is a broken audit, not a clean one.');
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
