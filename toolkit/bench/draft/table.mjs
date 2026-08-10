/* The clean test, with no draft and no opponents: sort the listone by a criterion, take the default MANTRA
 * squad (3 keepers + 22 outfield) and look at the eleven that comes out.
 *
 * The squad is NOT «the top 25 of the ranking»: measured, that one does NOT field a legal eleven (the best
 * 22 outfield men are forwards and wide players, and 4-10 places of 11 stay covered). So the rule is: cover
 * a module first - the best one ACCORDING TO THE CRITERION ITSELF, never according to the outcome - and the
 * shirts that remain go to the best men left. It is what anybody buying a squad he has to field does.
 *
 * Three readings of the same squad, because one alone would say things the others contradict:
 *   1) the FANTAMEDIA of the best legal eleven: what a man is worth WHEN he plays;
 *   2) the mean APPEARANCES of that same eleven: if they are 12 of 31, the fantamedia is not a season;
 *   3) the points per matchday (best legal eleven among each matchday's available men): the only one of
 *      the three that pays for availability, and it is the project's definition.
 *
 *   node table.mjs [covers]     covers = how many times the module is covered before the spare shirts
 */
import { matchdayXI } from './engine.mjs';
import { assign, legalXI, placesOf } from './legal.mjs';
import { loadShapes, loadWindows, NL } from './bench.mjs';

const shapes = loadShapes();
const windows = loadWindows();
const KEYS = Object.keys(windows);
const KEEPERS = 3, OUTFIELD = 22;

const CRITERIA = [
  { name: 'FVM*', of: (p) => p.fvm },
  { name: 'SURPLUS', of: (p) => p.surplus },
  { name: 'VALORE', of: (p) => p.value },
  { name: 'Qt.I', of: (p) => p.price },
  { name: 'FM-1', of: (p) => p.fm_prev },
];

/** The default mantra squad. `covers` = how many times the module is covered before the remaining shirts
 *  go to the criterion's best men: 1 = «cover the eleven, then the best», 2 = «two elevens», which with ten
 *  outfield places is exactly 20 + 2 spares, i.e. the standard squad. It separates two things the draft
 *  bench had glued together: the CURRENCY and the split by role. */
function roster(players, of, covers = 1) {
  const ranked = players.filter((p) => of(p) !== null && of(p) !== undefined)
    .sort((a, b) => of(b) - of(a));
  if (!ranked.length) return null;
  const keepers = ranked.filter((p) => p.slot === 'por').slice(0, KEEPERS);
  const field = ranked.filter((p) => p.slot !== 'por');
  let best = null;
  for (const name of Object.keys(shapes.modules)) {
    const places = placesOf(shapes, name).slice(1);        // the keeper's place is already assigned
    const core = assign(field, places, of);
    if (!core.complete) continue;
    if (best === null || core.total > best.total) best = { ...core, module: name };
  }
  if (!best) return null;
  const places = placesOf(shapes, best.module).slice(1);
  const taken = new Set(best.chosen.map((p) => p.id));
  const picked = [...best.chosen];
  for (let pass = 1; pass < covers && picked.length < OUTFIELD; pass += 1) {
    const again = assign(field.filter((p) => !taken.has(p.id)), places, of);
    for (const p of again.chosen) { if (picked.length < OUTFIELD) { picked.push(p); taken.add(p.id); } }
  }
  const bench = field.filter((p) => !taken.has(p.id)).slice(0, OUTFIELD - picked.length);
  return { squad: [...keepers, ...picked, ...bench], module: best.module, rankable: ranked.length };
}

const COVERS = Number(process.argv[2] ?? 1);
const cells = new Map();
for (const c of CRITERIA) cells.set(c.name, []);
for (const key of KEYS) {
  const w = windows[key];
  for (const c of CRITERIA) {
    const built = roster(w.players, c.of, COVERS);
    if (!built) { cells.get(c.name).push(null); continue; }
    const xi = legalXI(built.squad, shapes, (p) => p.fm_act);
    const eleven = [...built.squad].sort((a, b) => b.fm_act - a.fm_act).slice(0, xi.filled);
    const md = matchdayXI(built.squad, shapes, w.votes, w.rounds);
    cells.get(c.name).push({
      fm: xi.filled ? xi.points / xi.filled : null,
      pv: eleven.length ? eleven.reduce((s, p) => s + p.pv_act, 0) / eleven.length : null,
      filled: xi.filled,
      perRound: md.points / w.rounds,
      cover: 100 * md.filled / md.places,
      module: built.module,
      rankable: built.rankable,
    });
  }
}

const head = (title) => {
  console.log(NL + title + NL);
  console.log(`${'season'.padEnd(12)}${'matchdays'.padStart(10)}${CRITERIA.map((c) => c.name.padStart(11)).join('')}`);
};
const line = (pick, digits) => {
  for (const [k, key] of KEYS.entries()) {
    const w = windows[key];
    console.log(`${w.target.padEnd(12)}${String(w.rounds).padStart(10)}`
      + CRITERIA.map((c) => {
        const cell = cells.get(c.name)[k];
        const v = cell === null ? null : pick(cell);
        return (v === null || v === undefined ? '-' : (typeof v === 'number' ? v.toFixed(digits) : v)).padStart(11);
      }).join(''));
  }
  console.log(`${'MEAN'.padEnd(12)}${''.padStart(10)}`
    + CRITERIA.map((c) => {
      const xs = cells.get(c.name).filter((cell) => cell !== null).map(pick).filter((v) => v !== null);
      return (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(digits) : '-').padStart(11);
    }).join(''));
};

console.log(COVERS === 1 ? 'SQUAD: module covered once, then the criterion\'s best men'
  : `SQUAD: module covered ${COVERS} times (the split by role IMPOSED), then the best men`);
head('1) TRUE FANTAMEDIA of the best legal eleven');
line((c) => c.fm, 2);

head('2) mean APPEARANCES of that same eleven (the season has 29-31 matchdays)');
line((c) => c.pv, 1);

head('3) POINTS PER MATCHDAY: best legal eleven among the available men, matchday by matchday');
line((c) => c.perRound, 1);

head('4) PLACES COVERED in the eleven, % over the season\'s matchdays');
line((c) => c.cover, 1);

head('5) module covered while building (chosen with the criterion, not with the outcome)');
line((c) => c.module, 0);

const last = KEYS.at(-1);
console.log(NL + `rankable by criterion (${windows[last].target}): `
  + CRITERIA.map((c) => `${c.name} ${cells.get(c.name).at(-1)?.rankable ?? 0}`).join(' · ')
  + ` of ${windows[last].players.length}`);
console.log(NL + '* FVM = the ARCHIVED FVM: the listone\'s last read, taken after the season, so it KNOWS'
  + ' the outcome - and before 2022-23 the source does not keep it. A reference, never a head at the table.');
