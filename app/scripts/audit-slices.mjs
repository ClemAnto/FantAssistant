// Measures whether the bands of a CHART can be told apart, in every theme.
//
// It is not `audit-contrast.mjs` with different inputs, and the difference is the whole reason it
// exists: that one asks whether INK is readable ON a surface (WCAG 1.4.3, 4.5:1). This one asks
// whether two adjacent AREAS are two colours - WCAG has no threshold for that, so the bar here is
// declared and it is ours. It was written after the first drawing of the Overall pie shipped two
// slices the eye could not separate from the card behind them (`--color-control` at 1.2:1 and
// `--color-border` at 1.1:1): a chart whose slices merge is not a chart with a styling problem, it is
// a chart that answers the wrong question.
//
// It reads the SHIPPED files - the band list from `core/overall-bands.ts`, the palettes from
// `styles/themes/` - and resolves `color-mix()` the same way the browser does. A run that examines
// zero pairs is a FAILURE: a broken audit answering "0 problems" is indistinguishable from a clean one.
//
//   node scripts/audit-slices.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = join(HERE, '..', 'src', 'styles', 'themes');
const BANDS_FILE = join(HERE, '..', 'src', 'app', 'core', 'overall-bands.ts');
const DEFAULT_THEME = 'default.css';

/**
 * WHY THIS IS A COLOUR DIFFERENCE AND NOT A CONTRAST RATIO, because the first version of this script
 * used a ratio and the ratio was the defect.
 *
 * WCAG contrast is a LUMINANCE ratio: by construction it cannot see the difference between a green and
 * an amber of the same lightness, which is a difference anybody sees instantly. Asked to separate six
 * bands on a dark page it also cannot be satisfied at all - a chain of six steps at 1.6:1 each needs a
 * top step brighter than white - so it was failing pairs that are perfectly distinct and demanding a
 * ramp that does not exist. That is a metric blind to the property being tested, and the argument for
 * dropping it does not depend on any palette passing afterwards: it is a fact about the formula.
 *
 * ΔE (CIE76, in Lab) measures how far apart two colours are however they differ - lightness, hue or
 * both - which is the actual question when two areas sit side by side.
 *
 * The bars are DECLARED, not measured, and stated here so nobody takes them for fitted constants.
 * ~2.3 is the just-noticeable difference for two patches that touch; large areas seen at a glance want
 * more, and 15 is the step where the first drawing's two unreadable slices (ΔE 5 and 9 from the card)
 * separate from the ones that always read (25 and up).
 */
const NEIGHBOURS = 15;
const AGAINST_CARD = 15;

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
  const hex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${hex(at(ra, rb))}${hex(at(ga, gb))}${hex(at(ba, bb))}`;
}

/** sRGB -> CIE L*a*b*, D65. The usual two steps: linearise, to XYZ, then the cube-root transfer. */
function lab(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76: the plain distance in Lab. Enough to tell «two colours» from «one colour». */
function deltaE(one, other) {
  const [a, b] = [lab(one), lab(other)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A band's declared fill resolved against one theme's palette. */
function resolve(fill, colors) {
  const plain = fill.match(/^var\(--color-([a-z0-9-]+)\)$/);
  if (plain) return colors.get(plain[1]) ?? null;
  const mixed = fill.match(
    /^color-mix\(in srgb,\s*var\(--color-([a-z0-9-]+)\)\s*(\d+)%,\s*var\(--color-([a-z0-9-]+)\)\)$/,
  );
  if (!mixed) return null;
  const [, from, share, onto] = mixed;
  if (!colors.has(from) || !colors.has(onto)) return null;
  return mix(colors.get(from), colors.get(onto), Number(share) / 100);
}

/** The bands as the shipped source declares them, in order. */
function bands() {
  const source = readFileSync(BANDS_FILE, 'utf8');
  const list = source.slice(source.indexOf('OVERALL_BANDS'));
  const out = [];
  for (const [, label] of list.matchAll(/label:\s*'([^']+)'/g)) out.push({ label });
  const fills = [...list.matchAll(/fill:\s*'([^']+)'/g)].map((one) => one[1]);
  return out.map((band, at) => ({ ...band, fill: fills[at] }));
}

const found = bands();
if (found.length < 2 || found.some((band) => !band.fill)) {
  console.error(`FAIL: read ${found.length} bands from overall-bands.ts - the parser is out of date.`);
  process.exit(1);
}

const files = readdirSync(THEMES_DIR).filter((name) => name.endsWith('.css'));
const base = palette(readFileSync(join(THEMES_DIR, DEFAULT_THEME), 'utf8'));

let examined = 0;
let failed = 0;

for (const file of files) {
  const colors =
    file === DEFAULT_THEME
      ? base
      : new Map([...base, ...palette(readFileSync(join(THEMES_DIR, file), 'utf8'))]);
  const card = colors.get('surface');
  const drawn = found.map((band) => ({ ...band, hex: resolve(band.fill, colors) }));

  const missing = drawn.filter((band) => !band.hex);
  if (missing.length) {
    console.error(`FAIL ${file}: cannot resolve ${missing.map((one) => one.label).join(', ')}`);
    failed += missing.length;
    continue;
  }

  const rows = [];
  // EVERY pair and not only the neighbours: on a pie the drawing order decides who touches whom, and
  // two bands that are not adjacent in the list still sit side by side in the legend.
  for (let at = 0; at < drawn.length; at += 1) {
    for (let other = at + 1; other < drawn.length; other += 1) {
      rows.push({
        what: `«${drawn[at].label}» vs «${drawn[other].label}»`,
        value: deltaE(drawn[at].hex, drawn[other].hex),
        min: NEIGHBOURS,
      });
    }
  }
  for (const band of drawn) {
    rows.push({ what: `«${band.label}» sulla card`, value: deltaE(band.hex, card), min: AGAINST_CARD });
  }

  console.log(`\n${file}  -  ${rows.length} pairs`);
  for (const row of rows) {
    const ok = row.value >= row.min;
    examined += 1;
    if (!ok) failed += 1;
    if (!ok || process.env.VERBOSE) {
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} dE ${row.value.toFixed(1)}  (min ${row.min})  ${row.what}`);
    }
  }
  if (!rows.some((row) => row.value < row.min)) console.log('  every pair separates');
}

console.log(`\nexamined ${examined} pairs over ${files.length} themes, ${failed} below the bar`);
if (!examined) {
  console.error('FAIL: examined nothing, which is not the same as finding nothing.');
  process.exit(1);
}
process.exit(failed ? 1 : 0);
