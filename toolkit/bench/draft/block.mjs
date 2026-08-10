/* Item 1.5: does DENIAL ever beat our own best pick?
 *
 * The operator's idea (10/08/2026): take the last strong `Dc` that would complete a rival's eleven, even with
 * that department full. The item says to measure IF and WHEN before writing a note in the advice, and that
 * order is the point - «it feels right» is how a channel gets adopted without a verdict.
 *
 * THE QUESTION, made exact, and the first version of this script got it wrong in a way worth recording.
 * Denial is only worth anything if the man would ACTUALLY BE GONE by our next turn: if he is still there, we
 * take him then and taking him now buys nothing at all. So the denial of a candidate is not «the most any
 * rival would gain from him» - that is a number about a counterfactual nobody faces, and it made 84% of picks
 * look like a case for denial. It is «what the rival who really took him gained, if one did, and zero if
 * nobody did», read off the SAME draft.
 *
 *   ourGain(X) = bestXI(our roster + X) - bestXI(our roster)        how much X raises OUR eleven
 *   denial(X)  = bestXI(taker + X) - bestXI(taker)  if he was taken before our next pick, else 0
 *   cost(X)    = ourGain(B) - ourGain(X)            B = the pick our adopted policy actually makes
 *
 * Denial pays at exchange rate `r` when `r x denial(X) > cost(X)`. The rate is the answer, not a yes/no: in
 * this game you meet each rival ONCE a matchday, so a point taken from one of them is worth about
 * 1/(teams-1) of a point of ours, and that is the rate the report holds it to.
 *
 * Declared: this is a ONE-STEP counterfactual. Taking X instead of B leaves B on the board and changes what
 * the rivals do after us; the sequence used here is the one that actually happened. A diagnostic can live
 * with that, a policy could not.
 *
 *   node block.mjs [league]
 */
import { bestUnder, makeDraft, setupFrom } from './engine.mjs';
import { legalXI } from './legal.mjs';
import { coverPlaces } from './policies.mjs';
import { loadLeagues, loadShapes, loadWindows, NL } from './bench.mjs';

const table = setupFrom(loadLeagues(), process.argv[2] ?? 'EuroLeghe');
const windows = loadWindows(process.argv[3] ?? 'windows.json');
const shapes = loadShapes(table.game);
/* Fewer seeds than a policy run, on purpose: every candidate costs two legal-eleven searches, and this is a
 * diagnostic about a distribution rather than a verdict about a mean. */
const SEEDS = [7, 42, 1234];
const SEATS = [0, 5];
const CANDIDATES = 15;

const worth = (p) => p.value;
const xi = (roster) => legalXI(roster, shapes, worth).points;
const need = coverPlaces(2);
const rows = [];

for (const key of Object.keys(windows)) {
  const w = windows[key];
  const draft = makeDraft(w.players, shapes, table);
  for (const seed of SEEDS) for (const seat of SEATS) {
    // The whole draft as it happened, in order: who picked, with what roster, and whom he took.
    const log = [];
    draft({
      seat,
      seed,
      policy: { need, currency: worth, floor: Infinity },
      observe: (state) => {
        if (!state.choice) return;
        log.push({ isMine: state.isMine, teamId: state.team.id, roster: state.team.roster,
                   choice: state.choice, round: state.round, pool: state.pool, places: state.places,
                   keeperCap: state.keeperCap, slotsLeft: state.slotsLeft, teams: state.teams });
      },
    });

    for (const [at, entry] of log.entries()) {
      if (!entry.isMine) continue;
      const ctx = { round: entry.round, rounds: table.rounds, keepers: entry.keeperCap, shapes,
                    pool: entry.pool, slotsLeft: entry.slotsLeft, teams: table.teams };
      const best = bestUnder({ team: { slots: entry.roster.map((p) => p.slot), roster: entry.roster },
                               pool: entry.pool, places: entry.places, keeperCap: entry.keeperCap,
                               tail: false, quality: worth, need, ctx });
      if (!best) continue;

      // Everything a rival takes between this pick of ours and the next one: that is what «gone» means.
      const taken = new Map();
      for (let j = at + 1; j < log.length; j += 1) {
        if (log[j].isMine) break;
        taken.set(log[j].choice.id, log[j]);
      }

      const mineBase = xi(entry.roster);
      const gain = (roster, base, p) => xi([...roster, p]) - base;
      const ourBest = gain(entry.roster, mineBase, best);

      // Only men who will actually be gone can be denied, so the shortlist is drawn from THEM - which is
      // also what makes this cheap: it is a handful of players, not the whole pool.
      const shortlist = [...taken.keys()]
        .map((id) => entry.pool.find((p) => p.id === id))
        .filter((p) => p && p.id !== best.id)
        .sort((a, b) => worth(b) - worth(a))
        .slice(0, CANDIDATES);

      let bestRatio = -Infinity, chosen = null;
      for (const p of shortlist) {
        const taker = taken.get(p.id);
        const denial = gain(taker.roster, xi(taker.roster), p);
        const cost = ourBest - gain(entry.roster, mineBase, p);
        const ratio = cost <= 0 ? Infinity : denial / cost;
        if (ratio > bestRatio) { bestRatio = ratio; chosen = { p, denial, cost, ratio }; }
      }
      if (chosen) {
        rows.push({ key, round: entry.round, ...chosen, ourBest, gone: taken.size,
                    candidates: shortlist.length });
      }
    }
  }
  console.log(`done ${key} (${w.target})`);
}

const FAIR = 1 / (table.teams - 1);
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

const report = (label, subset) => {
  if (!subset.length) {
    console.log(`${label.padEnd(16)}${'0'.padStart(7)}`);
    return;
  }
  // «free» is NOT a case for denial and it is reported apart: it means some man who is about to be taken
  // raises our own eleven at least as much as our policy's pick does, i.e. it is a statement about OUR
  // objective (value x coverage is not the same as «the biggest marginal eleven»), not about the rival.
  const free = subset.filter((r) => !Number.isFinite(r.ratio));
  const real = subset.filter((r) => Number.isFinite(r.ratio));
  const paysAtOne = real.filter((r) => r.ratio > 1).length;
  const paysAtFair = real.filter((r) => r.ratio > 1 / FAIR).length;
  console.log(`${label.padEnd(16)}${String(subset.length).padStart(7)}`
    + `${`${((100 * free.length) / subset.length).toFixed(1)}%`.padStart(9)}`
    + `${String(real.length).padStart(8)}`
    + `${`${((100 * paysAtOne) / (real.length || 1)).toFixed(1)}%`.padStart(10)}`
    + `${`${((100 * paysAtFair) / (real.length || 1)).toFixed(1)}%`.padStart(11)}`
    + `${(real.length ? quantile(real.map((r) => r.ratio), 0.5).toFixed(2) : '-').padStart(9)}`
    + `${(real.length ? quantile(real.map((r) => r.ratio), 0.9).toFixed(2) : '-').padStart(9)}`
    + `${(real.length ? quantile(real.map((r) => r.denial), 0.5).toFixed(2) : '-').padStart(9)}`
    + `${(real.length ? quantile(real.map((r) => r.cost), 0.5).toFixed(2) : '-').padStart(8)}`);
};

console.log(NL + '=== ITEM 1.5: at what exchange rate would DENIAL beat our own best pick');
console.log(`A table of ${table.teams}: you meet each rival once a matchday, so a point taken from ONE of them`
  + ` is worth about ${FAIR.toFixed(3)} of a point of ours - denial has to be ${(1 / FAIR).toFixed(0)}x bigger`
  + ' than what we give up. Only men who are ACTUALLY taken before our next pick can be denied.' + NL);
console.log(`${'picks'.padEnd(16)}${'n'.padStart(7)}${'free'.padStart(9)}${'real'.padStart(8)}`
  + `${'pays @1'.padStart(10)}${`pays @${(1 / FAIR).toFixed(0)}x`.padStart(11)}`
  + `${'median'.padStart(9)}${'p90'.padStart(9)}${'denial'.padStart(9)}${'cost'.padStart(8)}`);
report('all of them', rows);
report('rounds 1-5', rows.filter((r) => r.round < 5));
report('rounds 6-15', rows.filter((r) => r.round >= 5 && r.round < 15));
report('rounds 16+', rows.filter((r) => r.round >= 15));

const gone = rows.map((r) => r.gone);
console.log(NL + `Men gone between two picks of ours: median ${quantile(gone, 0.5)}, p90 ${quantile(gone, 0.9)}`
  + ` over ${rows.length} of our picks. «median»/«p90» above are of the RATIO denial/cost, «denial» is the`
  + ' median denial in fantapunti of the best candidate.');
console.log('«free» is reported apart and is NOT evidence for denial: it says our own objective (value x'
  + ' coverage) and «the biggest marginal eleven» disagree on that pick.');
console.log(NL + 'READ THE MECHANISM, not the ratio. The ratio is a big number over a small one - a whole'
  + ' whole player worth over the gap between two candidates we rate almost the same - so it is unstable by'
  + ' construction, and with a thousand men on the board a near-tie always exists. The two numbers that'
  + ' decide are the last two: the median DENIAL divided by the fair rate, against the median COST.');
