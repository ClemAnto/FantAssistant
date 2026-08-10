/* Item 1.3: the price floor, judged by LEAVE-ONE-OUT CROSS-FIT instead of by looking at the curve.
 *
 * The «floor 200» of 09/08/2026 was chosen on T2, and on five windows the middle way is worth +0.0% per
 * matchday. That is not evidence that 200 is wrong - it is evidence that nobody had asked the question the
 * `sweep` protocol asks: pick the floor on FOUR windows, judge it on the fifth, and report what the choice
 * costs where it was not chosen. A level that does not transfer is not a level.
 *
 * The grid is PRE-REGISTERED here, before the run, and it is wider on both sides than the values that have
 * been tried, so «the winner sits at the edge» is a verdict this script can actually reach - a parameter is
 * never adopted at the edge of its grid.
 *
 *   node floor.mjs [league]
 */
import { measure, loadShapes, loadWindows, reportAgainstBaseline, setup, verdict, NL, FLOOR_PCT } from './bench.mjs';
import { VALUE, coverPlaces } from './policies.mjs';

const GRID = [0, 25, 50, 100, 200, 400, 800];

/* The rationing that won item 1.1, because a floor has to be judged on top of what is going to ship. */
const need = coverPlaces(2);
const POLICIES = [
  { name: 'nessun pavimento', need, currency: VALUE, floor: Infinity },
  ...GRID.map((floor) => ({ name: `pavimento ${floor}`, need, currency: VALUE, floor })),
];

const table = setup(process.argv[2] ?? 'EuroLeghe');
const windows = loadWindows(process.argv[3] ?? 'windows.json');
const shapes = loadShapes(table.game);
const run = measure(POLICIES, { windows, shapes, setup: table });
reportAgainstBaseline(run, POLICIES);

/* ---- the cross-fit ---------------------------------------------------------------------------------- */

const { results, keys } = run;
const base = results.get('nessun pavimento').mine;
const gainOf = (name) => results.get(name).mine.map((v, i) => 100 * (v - base[i]) / base[i]);
const gains = new Map(GRID.map((floor) => [floor, gainOf(`pavimento ${floor}`)]));

console.log(NL + '=== LEAVE-ONE-OUT: the floor is chosen on the OTHER four windows and judged on this one');
console.log(`${'held-out window'.padEnd(18)}${'chosen'.padStart(9)}${'gain in training'.padStart(18)}`
  + `${'gain HELD-OUT'.padStart(15)}${'edge?'.padStart(8)}`);
const heldOut = [];
for (const [i, key] of keys.entries()) {
  let best = null;
  for (const floor of GRID) {
    const others = gains.get(floor).filter((_, j) => j !== i);
    const mean = others.reduce((a, b) => a + b, 0) / others.length;
    if (!best || mean > best.mean) best = { floor, mean };
  }
  const out = gains.get(best.floor)[i];
  heldOut.push(out);
  const edge = best.floor === GRID[0] || best.floor === GRID.at(-1);
  console.log(`${key.padEnd(18)}${String(best.floor).padStart(9)}`
    + `${((best.mean >= 0 ? '+' : '') + best.mean.toFixed(2) + '%').padStart(18)}`
    + `${((out >= 0 ? '+' : '') + out.toFixed(2) + '%').padStart(15)}${(edge ? 'EDGE' : '-').padStart(8)}`);
}

const v = verdict(heldOut);
console.log(NL + `held-out mean ${(v.mean >= 0 ? '+' : '') + v.mean.toFixed(2)}%, won ${v.wins}/${heldOut.length},`
  + ` strict ${v.strict ? 'PASS' : '-'}, robust ${v.robust ? 'PASS' : '-'}`);
console.log(v.robust || v.strict
  ? 'A floor TRANSFERS: the advice may use the cross-fit value.'
  : `No floor passes held-out (the floor of the criterion is ${FLOOR_PCT}% of the mean): the advice uses`
    + ' NONE. What remains is the tie-break «at equal worth take the cheaper man» and the points-per-credit'
    + ' tail (TAIL_POSITIONS / TAIL_PRICE_FLOOR), both already measured and already in the code.');

console.log(NL + '=== the whole curve, per window, so a drifted optimum is visible instead of inferred');
console.log(`${'floor'.padEnd(18)}${keys.map((k) => k.padStart(9)).join('')}${'mean'.padStart(9)}`);
for (const floor of GRID) {
  const xs = gains.get(floor);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`${String(floor).padEnd(18)}${xs.map((x) => ((x >= 0 ? '+' : '') + x.toFixed(2)).padStart(9)).join('')}`
    + `${((mean >= 0 ? '+' : '') + mean.toFixed(2)).padStart(9)}`);
}
