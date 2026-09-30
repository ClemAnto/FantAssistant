/* The draft-strategy measurements, on FIVE seasons instead of one: the gate's measurable euro/mantra
 * windows (Tm4, Tm3, T0, T1, T2 - 21/22 is empty at the source and costs euro two of them).
 *
 * Usage:  node multi.mjs [published|coverage|currency] [league] [windowsFile]
 * `published` reproduces the 10/08/2026 campaign; the others judge a candidate against the app as it
 * ships, which is the first policy of the set (see `bench.reportAgainstBaseline`).
 *
 * Why a conclusion here needs five windows and not one: two results were reported to the operator from T2
 * alone and both died - the middle-way floor (+92 became +0.0%) and «the engine beats the market». */
import { SETS } from './policies.mjs';
import { SEEDS, loadShapes, loadWindows, reportAdvantage, reportAgainstBaseline, measure, setup } from './bench.mjs';

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.split('=')[1];
// A flag nobody reads produces a wrong run that looks like a right one (CLAUDE.md, the dispatcher rule).
const KNOWN = ['--declared', '--seeds=', '--seat=', '--cap=', '--quotas', '--pingpong'];
const unknown = flags.filter((f) => !KNOWN.some((k) => (k.endsWith('=') ? f.startsWith(k) : f === k)));
if (unknown.length) {
  console.error(`unknown option(s): ${unknown.join(', ')}`);
  process.exit(1);
}
const which = positional[0] ?? 'published';
const league = positional[1] ?? 'EuroLeghe';
// --declared: the EuroLeghe rules (declared eleven, unlimited subs, R-Factor); --seeds=N; --seat=S (0-based).
const metric = flags.includes('--declared') ? 'declared' : 'best';
const seeds = flag('seeds') ? SEEDS.slice(0, Number(flag('seeds'))) : SEEDS;
const seatFilter = flag('seat') ? [Number(flag('seat'))] : null;
const policies = SETS[which];
if (!policies) {
  console.error(`unknown policy set "${which}" - available: ${Object.keys(SETS).join(', ')}`);
  process.exit(1);
}

// --quotas: the classic league's 8/8/6 per line, for every seat (todolist-draft-classic-v1 item 2.1).
const base = setup(league);
if (flags.includes('--quotas') && !base.lineQuotas) {
  console.error(`--quotas: league "${base.name}" is ${base.game}, and only a classic league has line quotas`);
  process.exit(1);
}
const table = { ...base, exactKeepers: flags.includes('--declared'),
  ...(flags.includes('--quotas') ? { quotas: base.lineQuotas } : {}),
  // --pingpong: the snake order (FA-yei-458) instead of the roster-FVM rule.
  ...(flags.includes('--pingpong') ? { orderType: 'pingpong' } : {}),
  ...(flag('cap') ? { capRank: Number(flag('cap')), capTurns: 5 } : {}) };
const windows = loadWindows(positional[2] ?? 'windows.json');
const shapes = loadShapes(table.game);
console.log(`league "${table.name}": ${table.teams} teams, ${table.rounds} rounds, ${table.keepers} keepers`
  + ` (${table.platform}/${table.game})` + (table.quotas ? `, quotas ${JSON.stringify(table.quotas)}` : '')
  + (table.orderType ? `, order ${table.orderType}` : ''));

console.log(`metric: ${metric}, ${seeds.length} seeds, seats ${seatFilter ?? 'all'}`);
const run = measure(policies, { windows, shapes, setup: table, metric, seeds, seatFilter });
reportAdvantage(run, policies, 'PER MATCHDAY (the project\'s definition)', 'adv');
reportAdvantage(run, policies, 'SEASON TOTALS', 'tot');
if (policies.length > 1 && which !== 'published') reportAgainstBaseline(run, policies);
