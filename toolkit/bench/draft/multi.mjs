/* The draft-strategy measurements, on FIVE seasons instead of one: the gate's measurable euro/mantra
 * windows (Tm4, Tm3, T0, T1, T2 - 21/22 is empty at the source and costs euro two of them).
 *
 * Usage:  node multi.mjs [published|coverage|currency] [league]
 * `published` reproduces the 10/08/2026 campaign; the others judge a candidate against the app as it
 * ships, which is the first policy of the set (see `bench.reportAgainstBaseline`).
 *
 * Why a conclusion here needs five windows and not one: two results were reported to the operator from T2
 * alone and both died - the middle-way floor (+92 became +0.0%) and «the engine beats the market». */
import { SETS } from './policies.mjs';
import { loadShapes, loadWindows, reportAdvantage, reportAgainstBaseline, measure, setup } from './bench.mjs';

const which = process.argv[2] ?? 'published';
const league = process.argv[3] ?? 'EuroLeghe';
const policies = SETS[which];
if (!policies) {
  console.error(`unknown policy set "${which}" - available: ${Object.keys(SETS).join(', ')}`);
  process.exit(1);
}

const table = setup(league);
const windows = loadWindows();
const shapes = loadShapes();
console.log(`league "${table.name}": ${table.teams} teams, ${table.rounds} rounds, ${table.keepers} keepers`
  + ` (${table.platform}/${table.game})`);

const run = measure(policies, { windows, shapes, setup: table });
reportAdvantage(run, policies, 'PER MATCHDAY (the project\'s definition)', 'adv');
reportAdvantage(run, policies, 'SEASON TOTALS', 'tot');
if (policies.length > 1 && which !== 'published') reportAgainstBaseline(run, policies);
