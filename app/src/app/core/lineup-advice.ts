/**
 * THE ADVISED LINEUP, FIRST CUT (operator, 08/10/2026: «nella pagina della formazione consigliata ... un campo
 * che mostra i calciatori schierati e sotto una griglia con quelli in panchina»).
 *
 * WHAT THIS IS AND WHAT IT IS NOT. A lineup is a question about the RULEBOOK (which legal module lets these men
 * on the pitch) asked with a WEIGHT per man, and the weight is the one quantity this file owns: the points he
 * is expected to bring THIS matchday,
 *
 *     points = his FVA (`fva.ts`), null for a man Leghe marks out (unavailable, suspended, not called).
 *
 * Until 09/10/2026 it was P(vote) x FVA (and the sheet's FMa before that). The operator, that day: «il modulo
 * migliore è semplicemente la somma dei singoli FVA (non pensare alla probabilità di prendere il voto)». The
 * price of the rule, stated: a man Leghe gives at 5% with a good FVA can now be fielded over a regular starter -
 * the VOTO column still shows that chance, and choosing is the operator's.
 *
 * P(vote) is read from the platform's probable-starter percentage with the curve measured in
 * `rosa-3-giornate-v1.md` §2 (932 out-of-sample observations, matchdays 1-2 of 2026-27). That curve is on
 * record as «da rimisurare» and this is NOT the advice `formazione-leghe-v1.md` §4 describes: it ignores the
 * automatic substitutions, the modifiers, the press consensus and the opponent. It is the floor the page draws
 * until the bench (`formazione-leghe-v1.md` §5 item 3) can judge something better - stated on the page, so a
 * reader does not take a first cut for the engine.
 *
 * Legality is the rulebook's, never ours: the same matroid the draft uses (`mantra-legal.ts`), restricted to
 * the modules the LEAGUE allows (Leghe's own `mods`), on `classic_modules.json` or `mantra_modules.json`.
 */

import { MantraModules } from './auction-value';
import { DRAW_ORDER, PitchLine } from './club-eleven';
import { Eleven, Place, Placeable, assign, bestEleven, placesIn } from './mantra-legal';
import { BenchRule, LegheGame, SubstitutionKind } from './leghe-rules';

/**
 * P(vote) against the editorial starter probability, `rosa-3-giornate-v1.md` §2: bucket centres and the share
 * of men who then got a vote. Linear between centres, flat beyond the two ends - outside them nothing was
 * measured, and extending the line would be inventing the tails.
 */
export const VOTE_CURVE: readonly (readonly [number, number])[] = [
  [0.05, 0.013],
  [0.2, 0.141],
  [0.375, 0.374],
  [0.51, 0.643],
  [0.64, 0.713],
  [0.775, 0.791],
  [0.93, 0.952],
];

/** A man the probable-lineups page does not list at all: measured on the same population, not a zero. */
export const VOTE_IF_UNLISTED = 0.063;

/**
 * BELOW THIS CHANCE OF A VOTE A MAN IS NOT FIELDED (operator, 09/10/2026: «togliamo dal campo i giocatori < 15%
 * come Lienard»). The eleven is chosen on the FVA alone, which is «what he scores IF he plays» - so a third keeper
 * at 1% with a decent FVA was taking the place. The bench still has him, in FVA order: a place on the bench is
 * cheap. A declared threshold on the chance the page SHOWS (`voteChance`), not a measured one.
 */
export const MIN_CHANCE_ON_PITCH = 0.15;

/** What a man weighs when the ELEVEN is chosen: his points, or nothing under the floor. One rule for the pitch
 *  and for the module menu's totals, so the two cannot disagree about who can stand on the pitch. */
export function fieldWeight(man: LineupMan): number | null {
  return man.chance >= MIN_CHANCE_ON_PITCH ? man.points : null;
}

/**
 * DOES THIS MODULE EARN THE DEFENCE MODIFIER? Classic: only with at least FOUR defenders (operator, 09/10/2026: «le
 * difese con < 4 difensori non ottengono questo bonus»; Leghe's `ModificatoriHelper.ModificatoreDifesa` returns 0
 * under four, with or without the keeper). Mantra's D-Factor wants three defenders and two more defensive men, which
 * every Mantra scheme fields, so there every module earns it.
 */
export function earnsDefence(places: readonly Place[], game: LegheGame | null): boolean {
  return game !== 'classic' || places.filter((place) => place.line === 'D').length >= 4;
}

/**
 * WHO THE DEFENCE MODIFIER READS, as Leghe's engine reads them (`ModificatoriHelper`, 09/10/2026): on classic the
 * defenders, on Mantra the defensive men of the D-Factor (`Dd`, `Ds`, `Dc`, `B`, `E`, `M`), and the keeper in both
 * where the league puts him in the average (`smoddg`). Lowercase codes, as `LineupMan.roles` holds them.
 */
export function readByDefence(roles: readonly string[], game: LegheGame | null, withKeeper: boolean): boolean {
  const keeper = roles.includes('p') || roles.includes('por');
  if (keeper) return withKeeper;
  if (game === 'mantra') return roles.some((role) => ['dd', 'ds', 'dc', 'b', 'e', 'm'].includes(role));
  return roles[0] === 'd';
}

/**
 * THE WEIGHT ON ONE MODULE: the man's points plus what his steadiness is worth to the league's modifiers
 * (`LineupMan.steadyBonus`, `defenceBonus`), the defence part only where the module earns it. Under the floor of
 * `fieldWeight`, nothing: a modifier does not make a man who will not play worth fielding.
 */
export function weightOn(defence: boolean): (man: LineupMan) => number | null {
  return (man) => {
    const base = fieldWeight(man);
    return base === null ? null : base + (man.steadyBonus ?? 0) + (defence ? (man.defenceBonus ?? 0) : 0);
  };
}

/**
 * THE BEST ELEVEN WHEN THE WEIGHT DEPENDS ON THE MODULE: one `bestEleven` per module with that module's weight
 * (`weightOn(earnsDefence(...))`), the winner the highest total as there. A 3-4-3 is weighed without the defence
 * part, a 4-4-2 with it - which is how a classic league with the modifier ends up preferring a back four.
 */
export function bestOnModules(
  men: readonly LineupMan[],
  rules: MantraModules,
  game: LegheGame | null,
): Eleven<LineupMan> | null {
  let best: Eleven<LineupMan> | null = null;
  const scores: { module: string; total: number; placed: number }[] = [];
  for (const [name, shape] of Object.entries(rules.modules)) {
    const one = { ...rules, modules: { [name]: shape } };
    const eleven = bestEleven(men, one, weightOn(earnsDefence(placesIn(rules, name), game)));
    if (!eleven) {
      scores.push({ module: name, total: 0, placed: 0 });
      continue;
    }
    scores.push({ module: name, total: eleven.total, placed: eleven.men.length });
    if (eleven.total > (best?.total ?? 0)) best = eleven;
  }
  if (best) best.scores = [...scores].sort((left, right) => right.total - left.total);
  return best;
}

/** Leghe's own flag that he cannot play this matchday. */
export type OutFlag = 'unavailable' | 'suspended' | 'not-called' | null;

/** `percent` is Leghe's 0-100. Out = no vote, whatever the percentage says. */
export function voteChance(percent: number | null, out: OutFlag): number {
  if (out) return 0;
  if (percent === null) return VOTE_IF_UNLISTED;
  const p = Math.max(0, Math.min(1, percent / 100));
  const first = VOTE_CURVE[0];
  const last = VOTE_CURVE[VOTE_CURVE.length - 1];
  if (p <= first[0]) return first[1];
  if (p >= last[0]) return last[1];
  for (let i = 1; i < VOTE_CURVE.length; i++) {
    const [x1, y1] = VOTE_CURVE[i];
    if (p <= x1) {
      const [x0, y0] = VOTE_CURVE[i - 1];
      return y0 + ((p - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

/** One man of the roster, priced for this matchday. */
export interface LineupMan extends Placeable {
  id: number;
  name: string;
  /** Lowercase listone codes (`roles`) and the same codes as shown (`shown`). */
  shown: string[];
  chance: number;
  /** Expected fantavoto; null = nobody can price him, and then he is never fielded (unknown, not zero). */
  fm: number | null;
  /**
   * The weight the eleven is chosen on: the FVA (`fva.ts`) since 09/10/2026, evening; `chance x FVA` and
   * `chance x fm` before. Null = nobody can price him, or Leghe marks him out: then he is never fielded.
   */
  points: number | null;
  /** The FVA shown beside the name: the expected fantavoto IF he plays. Absent = the caller did not price it. */
  fva?: number | null;
  /**
   * WHAT HIS STEADINESS IS WORTH TO THE LEAGUE'S MODIFIERS, per match (operator, 09/10/2026: «se il modificatore di
   * rendimento è attivo aggiungi una valutazione migliore per quelli che hanno una continuità migliore ... se il
   * modificatore di difesa è attivo ... ai difensori»): his share of sufficient base votes x the league's own weight
   * (`swing.steadyShareFor`). `steadyBonus` is the R-Factor's, for everybody; `defenceBonus` the defence modifier's,
   * for the men it reads, and paid only on a module that earns it (`earnsDefence`). Absent = the league has none.
   */
  steadyBonus?: number | null;
  defenceBonus?: number | null;
}

export interface LineupPlace {
  line: PitchLine;
  /** The rulebook's name for the place (`D`, `DC/B`). */
  slot: string;
  man: LineupMan | null;
  /**
   * The place's index in the module's own order (`placesIn`): the drawing moves the wide places to the flanks
   * (`toTheFlanks`), so the position in a row is not the place - and a drop on the pitch has to name the place.
   */
  at: number;
}

export interface LineupRow {
  line: PitchLine;
  places: LineupPlace[];
}

export interface LineupPlan {
  module: string;
  rows: LineupRow[];
  /** Expected points of the eleven: the sum of the men placed, the modifiers' part (`modifiers`) included. */
  total: number;
  /** The part of `total` that is the steadiness the modifiers pay (`LineupMan.steadyBonus`, `defenceBonus`). */
  modifiers?: number;
  placed: number;
  /** In bench order: first in, first out. */
  bench: LineupMan[];
  /** Left out of both: past the bench's size, or unpriced. */
  outside: LineupMan[];
  /** Every allowed module's worth, best first: why the winner won, and by how much. */
  scores: { module: string; total: number; placed: number }[];
  /** How many starters have their own cover on the bench (`coverOrder`); absent on a lineup drawn as sent. */
  cover?: LineupCover;
}

/** The bench's promise: every starter with a distinct substitute who plays, or the names of those without one. */
export interface LineupCover {
  starters: number;
  covered: number;
  open: string[];
}

/** Leghe writes `343`, the rulebooks `3-4-3`. */
export function rulebookName(code: string): string {
  return /^\d+$/.test(code) ? code.split('').join('-') : code;
}

/**
 * The rulebook restricted to what the league allows. A league that allows nothing we can read keeps the whole
 * rulebook - an empty module list is «not read», never «no module is legal».
 */
export function allowedRules(rules: MantraModules, allowed: readonly string[]): MantraModules {
  const names = new Set(allowed.map(rulebookName));
  const kept = Object.fromEntries(Object.entries(rules.modules).filter(([name]) => names.has(name)));
  return Object.keys(kept).length ? { ...rules, modules: kept } : rules;
}

/**
 * A classic module's three counts (D, C, A) from its name, `442` or `4-4-2`; null for anything else (a Mantra
 * name, a module that does not field ten outfield men).
 */
export function classicCounts(code: string): [number, number, number] | null {
  const digits = code.replace(/-/g, '').match(/^(\d)(\d)(\d)$/);
  if (!digits) return null;
  const counts: [number, number, number] = [Number(digits[1]), Number(digits[2]), Number(digits[3])];
  return counts[0] + counts[1] + counts[2] === 10 ? counts : null;
}

/**
 * A CLASSIC MODULE IS ITS THREE NUMBERS (`classic_modules.json`: «a classic eleven is legal if the COUNTS match»).
 * The rulebook file writes the seven standard modules, while Leghe lets a classic league allow eighteen more (the
 * Leghe front-end's `EXTRA_FORMATIONS`: 4-2-4, 3-6-1, 6-3-1 ...). Until 09/10/2026 such a module was DROPPED by
 * `allowedRules`, and a league whose every module was unknown fell back to the whole rulebook - i.e. was advised
 * modules it does not allow. A classic module the file does not write is now built from its digits; that is the
 * classic law itself, not an analogy. Mantra is returned untouched: a Mantra place is typed and cannot be read off
 * a name.
 */
export function withLeagueModules(
  rules: MantraModules,
  allowed: readonly string[],
  game: LegheGame | null,
): MantraModules {
  if (game !== 'classic') return rules;
  const added: Record<string, Record<string, string[]>> = {};
  for (const code of allowed) {
    const counts = classicCounts(code);
    const name = rulebookName(code);
    if (!counts || rules.modules[name] || added[name]) continue;
    const [d, c, a] = counts;
    added[name] = { D: Array(d).fill('D'), M: Array(c).fill('C'), T: [], A: Array(a).fill('A') };
  }
  return Object.keys(added).length ? { ...rules, modules: { ...rules.modules, ...added } } : rules;
}

/**
 * The league's substitution rule as the bench has to serve it (`LineupRules.substitutions.kind` and the modules
 * the league allows, as Leghe writes them): a classic module change may only land on an allowed module.
 */
export interface Substitutions {
  kind: SubstitutionKind | null;
  modules: readonly string[];
}

const NO_SUBSTITUTIONS: Substitutions = { kind: null, modules: [] };

/** Does a classic substitution kind CHANGE MODULE? Dynamic (sstype 1) and Hybrid (2) do, Traditional (3) never. */
function changesModule(kind: SubstitutionKind | null): boolean {
  return kind === 'dynamic' || kind === 'hybrid';
}

const byPoints = (a: LineupMan, b: LineupMan) =>
  (b.points ?? -Infinity) - (a.points ?? -Infinity) || a.name.localeCompare(b.name);

export function rowsOf(places: ReturnType<typeof placesIn>, holders: (LineupMan | null)[]): LineupRow[] {
  const rows: LineupRow[] = [];
  for (const line of DRAW_ORDER) {
    const inLine: LineupPlace[] = [];
    places.forEach((place, at) => {
      if (place.line === line) inLine.push({ line, slot: place.slot, man: holders[at] ?? null, at });
    });
    if (inLine.length) rows.push({ line, places: toTheFlanks(inLine) });
  }
  return rows;
}

/**
 * A slot that offers a WIDE role (`E`, `W`): `E/W`, `W/A`, `W/T`. It has no side of its own, but a flank. Until
 * 09/10/2026 every option had to be wide, so `W/A` stayed where the rulebook writes it and the 3-4-3 drew its
 * front three as `W/A, W/A, A/PC`, the centre-forward on a touchline (operator: «le W devono stare ai lati, la Pc
 * al centro»). No rulebook slot offers both a wide role and a `PC`, so the centre-forward is never sent out.
 */
function isWideSlot(slot: string): boolean {
  return slot.split('/').some((code) => code === 'E' || code === 'W');
}

/**
 * THE WIDE PLACES GO TO THE TOUCHLINES (operator, 09/10/2026: «E/W e W devono essere ai lati del campo e non
 * centrali», then «le W devono stare ai lati, la Pc al centro»). The rulebook writes some lines in no side
 * order (`4-1-4-1` has `C/T, T, E/W, W`, the 3-4-3 `W/A, W/A, A/PC`), so the drawing moves the wide slots to
 * the two ends, alternating, and keeps the central ones - the `PC` among them - in the rulebook's order between
 * them. Sided slots (`DD`, `DS`) are not touched: their order already is the side.
 */
export function toTheFlanks(row: LineupPlace[]): LineupPlace[] {
  const wide = row.filter((place) => isWideSlot(place.slot));
  if (!wide.length || wide.length === row.length) return row;
  const left: LineupPlace[] = [];
  const right: LineupPlace[] = [];
  wide.forEach((place, at) => (at % 2 === 0 ? left.push(place) : right.unshift(place)));
  if (wide.length === 1) return [...row.filter((place) => !isWideSlot(place.slot)), ...left];
  return [...left, ...row.filter((place) => !isWideSlot(place.slot)), ...right];
}

/** The role a man counts as on a classic bench (`P`/`D`/`C`/`A`), or `Por` vs outfield on mantra. */
function benchGroup(man: LineupMan, game: LegheGame | null): number {
  if (game === 'mantra') return man.roles.includes('por') ? 0 : 1;
  const at = ['p', 'd', 'c', 'a'].indexOf(man.roles[0] ?? '');
  return at < 0 ? 4 : at;
}

/** A starter and the place he holds: what a bench has to be able to replace. */
export interface Starter {
  place: Place;
  man: LineupMan;
}

/** A classic outfield role's position in a module's counts (D, C, A). */
const CLASSIC_COUNT: Record<string, number> = { d: 0, c: 1, a: 2 };

/**
 * CLASSIC: who can take the place a starter leaves, as Leghe's OWN engine decides it (`LegheCalcoloClassicHelper.
 * ApplySubstitutionsClassic`, backend read 09/10/2026). The same role always. Dynamic and Hybrid also CHANGE
 * MODULE: an outfield man of another role enters when the men who played, plus him, still fit a module the league
 * allows (`CambioModulo`: D, C and A each at most the module's) - so in a 4-4-2 a midfielder covers a defender if
 * the league allows the 3-5-2. Traditional never changes module, a keeper is only ever replaced by a keeper, and a
 * kind or a module list we could not read counts the same role only: a cover we cannot be sure of is no cover.
 */
function classicCover(sub: LineupMan, starter: Starter, module: string, subs: Substitutions): boolean {
  const out = starter.man.roles[0];
  const into = sub.roles[0];
  if (!out || !into) return false;
  if (into === out) return true;
  if (!changesModule(subs.kind) || !(out in CLASSIC_COUNT) || !(into in CLASSIC_COUNT)) return false;
  const counts = classicCounts(module);
  if (!counts) return false;
  const after = [...counts];
  after[CLASSIC_COUNT[out]] -= 1;
  after[CLASSIC_COUNT[into]] += 1;
  return subs.modules.some((code) => {
    const allowed = classicCounts(code);
    return !!allowed && after.every((n, at) => n <= allowed[at]);
  });
}

/**
 * CAN `sub` TAKE THE PLACE `starter` LEAVES? Classic: `classicCover` (the same role, or another one through a
 * module change where the league's substitutions make one). Mantra: a role the place itself accepts (no malus), or
 * what the official matrix allows from the role the starter held there - with the out-of-position malus too,
 * because a malus of one point is not a hole. The footnotes read as the file states them: `*` only «in
 * alternativa» (i.e. the place already accepts the role, handled above), `**` always (OK or -1), `***` everywhere
 * but in the 4-1-4-1.
 */
export function canCover(
  sub: LineupMan,
  starter: Starter,
  game: LegheGame | null,
  rules: MantraModules,
  module: string,
  subs: Substitutions = NO_SUBSTITUTIONS,
): boolean {
  if (game !== 'mantra') return classicCover(sub, starter, module, subs);
  if (sub.roles.some((role) => starter.place.roles.includes(role))) return true;
  const matrix = rules.substitution?.matrix;
  if (!matrix) return false;
  const lower = (row: Record<string, string>) => new Map(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));
  const out = starter.man.roles.find((role) => starter.place.roles.includes(role)) ?? starter.man.roles[0];
  const rowKey = Object.keys(matrix).find((key) => key.toLowerCase() === out);
  if (!rowKey) return false;
  const row = lower(matrix[rowKey]);
  return sub.roles.some((role) => {
    const verdict = row.get(role);
    return verdict === 'OK' || verdict === '-1' || verdict === '**' || (verdict === '***' && module !== '4-1-4-1');
  });
}

/**
 * THE MEN WHO MAKE A HOLE IMPOSSIBLE, in the order to put them on the bench (operator, 09/10/2026: «la panchina
 * deve essere impostata in maniera da essere CERTI che non ci siano buchi nel caso ci sia qualche infortunio
 * all'ultimo»).
 *
 * Every starter gets his OWN cover - a distinct man, so two injuries in one department are two substitutions and
 * not one - and only a man who will play himself counts (chance >= `MIN_CHANCE_ON_PITCH`: a third keeper at 1% is
 * no cover). Rounds over the lines, keeper first: one cover per line per round, so the first injury of every
 * department is covered before the second of any; inside a line the starter with the fewest possible covers goes
 * first, and he gets the man most likely to play (then the best FVA). A starter nobody in the roster can replace
 * stays uncovered, and the caller counts him.
 *
 * On classic a module change can make a man of ANOTHER role a cover (`classicCover`); a man of the starter's own
 * role is still preferred, because he is the cover every kind of substitution honours and the cross-role one would
 * otherwise take the place of a man another department needs. And the module changes ADD UP: two defenders covered
 * by two midfielders turn a 4-4-2 into a 2-6-2, which no league allows - so a cross-role cover is checked against
 * the counts the covers already promised, and the promise holds even if every covered starter drops out at once.
 */
export function coverOrder(
  starters: readonly Starter[],
  rest: readonly LineupMan[],
  game: LegheGame | null,
  rules: MantraModules,
  module: string,
  subs: Substitutions = NO_SUBSTITUTIONS,
): { covers: LineupMan[]; coveredBy: Map<number, LineupMan> } {
  const candidates = rest.filter((man) => man.chance >= MIN_CHANCE_ON_PITCH);
  const used = new Set<number>();
  const coveredBy = new Map<number, LineupMan>();
  const covers: LineupMan[] = [];
  const better = (a: LineupMan, b: LineupMan) => b.chance - a.chance || byPoints(a, b);
  const sameRoleFirst = (one: Starter) => (a: LineupMan, b: LineupMan) =>
    game === 'mantra'
      ? 0
      : Number(b.roles[0] === one.man.roles[0]) - Number(a.roles[0] === one.man.roles[0]);
  // Classic: the module the covers promised so far, written as its counts (`4-4-2` -> `442`, then `352`...).
  const counts = game === 'mantra' ? null : classicCounts(module);
  const moduleNow = () => (counts ? counts.join('') : module);
  for (let progress = true; progress; ) {
    progress = false;
    for (const line of DRAW_ORDER) {
      const now = moduleNow();
      const open = starters
        .filter((one) => one.place.line === line && !coveredBy.has(one.man.id))
        .map((one) => ({
          one,
          options: candidates.filter((sub) => !used.has(sub.id) && canCover(sub, one, game, rules, now, subs)),
        }))
        .filter((entry) => entry.options.length)
        .sort((a, b) => a.options.length - b.options.length);
      if (!open.length) continue;
      const { one, options } = open[0];
      const pick = [...options].sort((a, b) => sameRoleFirst(one)(a, b) || better(a, b))[0];
      used.add(pick.id);
      coveredBy.set(one.man.id, pick);
      covers.push(pick);
      const [out, into] = [one.man.roles[0], pick.roles[0]];
      if (counts && out !== into && out in CLASSIC_COUNT && into in CLASSIC_COUNT) {
        counts[CLASSIC_COUNT[out]] -= 1;
        counts[CLASSIC_COUNT[into]] += 1;
      }
      progress = true;
    }
  }
  return { covers, coveredBy };
}

/**
 * THE BENCH: who sits there and in which order.
 *
 * WHO gets a place is decided by `covers` first (`coverOrder`: no hole if a starter drops out), then by the FVA,
 * within the league's per-role counts and its size. Unpriced men go last: a bench place is cheap, and «unknown»
 * is not «useless».
 *
 * THE ORDER is the one the league's engine substitutes in, and on classic that depends on the KIND (read in
 * Leghe's backend, `LegheCalcoloClassicHelper.ApplySubstitutionsClassic`, 09/10/2026):
 *   - Dynamic walks the bench IN ORDER, whatever the role, and the first man with a vote who fits an allowed
 *     module comes in; Hybrid does the same after a same-role pass. So the bench is ONE QUEUE, best FVA first -
 *     which is also the best order for one hole: with X ahead of Y the expected gain beats Y-first by
 *     P(X) x P(Y) x (FVA X - FVA Y), whatever the two chances. Until 09/10/2026 the classic bench was written by
 *     role (P, D, C, A), and under Dynamic that sent the best defender on for a missing striker before the
 *     forward behind him.
 *   - Traditional only ever takes the first man of the SAME role, so the order across roles does not matter and
 *     the bench is written by role, best first inside each - the same substitutions, easier to read.
 *   - A kind we could not read gets the queue: it is the right order for two kinds and an equivalent one for the
 *     third.
 * Mantra is one queue, best first, as before.
 *
 * Per-role counts (`brdrs`), on classic: on a FIXED bench a positive count is EXACT and a zero means «any number»
 * (Leghe's own default settings: «se fixbench è true 0 vuol dire ruolo variabile») - until 09/10/2026 a zero there
 * stopped the bench at the quotas, so `[1,2,0,0]` on seven places gave a bench of three. On a variable bench they
 * are floors. Mantra reads them as floors whatever the flags say (the Leghe editor ignores them there). A fixed
 * ROLE PER SLOT (`bseq`, classic only) fills each slot with the first man of its role, and the bench keeps the
 * slot order, since that is the order Leghe substitutes in.
 */
export function benchOf(
  rest: readonly LineupMan[],
  rule: BenchRule,
  game: LegheGame | null,
  covers: readonly LineupMan[] = [],
  kind: SubstitutionKind | null = null,
): {
  bench: LineupMan[];
  outside: LineupMan[];
} {
  const pool = [...rest].sort(byPoints);
  // The order places are handed out in: the covers first, in their own order, then everybody else by FVA.
  const coverIds = new Set(covers.map((man) => man.id));
  const ordered = [...covers.filter((man) => pool.includes(man)), ...pool.filter((man) => !coverIds.has(man.id))];
  const picked: LineupMan[] = [];
  const take = (man: LineupMan) => {
    picked.push(man);
    pool.splice(pool.indexOf(man), 1);
    ordered.splice(ordered.indexOf(man), 1);
  };
  const classic = game !== 'mantra';
  if (classic && rule.sequence?.length) {
    // Leghe's classic role ids are 1-4 (P, D, C, A): a slot asking for role `r` takes group `r - 1`.
    for (const role of rule.sequence) {
      const man = ordered.find((m) => benchGroup(m, game) === role - 1);
      if (man) take(man);
    }
    return { bench: picked, outside: pool };
  }
  const size = rule.size ?? pool.length;
  const groups = classic ? 4 : 2;
  const wanted = rule.perRole.slice(0, groups);
  // MANTRA ALWAYS WANTS A KEEPER ON THE BENCH, whatever the league's counts say: Leghe refuses the save otherwise
  // (`TeamLineupService.ValidateTeamLineup`, mantra branch: LUP011, backend read 09/10/2026).
  if (!classic) wanted[0] = Math.max(wanted[0] ?? 0, 1);
  wanted.forEach((count, group) => {
    for (const man of ordered.filter((m) => benchGroup(m, game) === group).slice(0, count)) {
      if (picked.length < size) take(man);
    }
  });
  const exactly = (group: number) => classic && rule.fixed && (wanted[group] ?? 0) > 0;
  for (const man of [...ordered]) {
    if (picked.length >= size) break;
    if (!exactly(benchGroup(man, game))) take(man);
  }
  const byRole = classic && kind === 'traditional';
  const bench = byRole
    ? picked.sort((a, b) => benchGroup(a, game) - benchGroup(b, game) || byPoints(a, b))
    : picked.sort(byPoints);
  return { bench, outside: pool };
}

/**
 * The best eleven by expected points on the `allowed` modules, and the bench behind it. `subs` is the league's
 * substitution rule, which decides who can cover whom and the bench's order; its `modules` are the LEAGUE's,
 * which a module change may land on even when the eleven is drawn on one module the operator picked.
 */
export function adviseLineup(
  men: readonly LineupMan[],
  rulebook: MantraModules | null,
  allowed: readonly string[],
  rule: BenchRule,
  game: LegheGame | null,
  subs: Substitutions = NO_SUBSTITUTIONS,
): LineupPlan | null {
  if (!rulebook?.modules) return null;
  const book = withLeagueModules(rulebook, [...allowed, ...subs.modules], game);
  const rules = allowedRules(book, allowed);
  const best = bestOnModules(men, rules, game);
  if (!best) return null;
  const onPitch = new Set(best.men.map((m) => m.id));
  const rest = men.filter((m) => !onPitch.has(m.id));
  const starters: Starter[] = best.places
    .map((place, at) => ({ place, man: best.holders[at] }))
    .filter((one): one is Starter => !!one.man);
  const { covers, coveredBy } = coverOrder(starters, rest, game, book, best.module, subs);
  const { bench, outside } = benchOf(rest, rule, game, covers, subs.kind);
  return {
    module: best.module,
    rows: rowsOf(best.places, best.holders),
    total: best.total,
    modifiers: modifiersOf(best.men, earnsDefence(best.places, game)),
    placed: best.men.length,
    bench,
    outside,
    scores: best.scores,
    cover: coverOf(starters, coveredBy, bench),
  };
}

/** What the modifiers add to an eleven: every starter's steadiness term, the defence part where the module earns it. */
export function modifiersOf(starters: readonly LineupMan[], defence: boolean): number {
  return starters.reduce((sum, man) => sum + (man.steadyBonus ?? 0) + (defence ? (man.defenceBonus ?? 0) : 0), 0);
}

/** Which starters have their own cover ON THE BENCH: a cover the bench's size left out covers nothing. */
function coverOf(starters: readonly Starter[], coveredBy: Map<number, LineupMan>, bench: readonly LineupMan[]): LineupCover {
  const onBench = new Set(bench.map((man) => man.id));
  const open = starters.filter((one) => !onBench.has(coveredBy.get(one.man.id)?.id ?? -1)).map((one) => one.man.name);
  return { starters: starters.length, covered: starters.length - open.length, open };
}

/**
 * The lineup ALREADY SENT to Leghe, drawn on the same pitch: its module, its eleven placed by the rulebook
 * and its bench in the order he wrote it. Men the module cannot place (a lineup sent under another rulebook)
 * end up in `outside` rather than vanishing.
 */
export function drawSent(
  men: readonly LineupMan[],
  rulebook: MantraModules | null,
  sent: { module: string; starts: readonly number[]; bench: readonly number[] },
): LineupPlan | null {
  if (!rulebook?.modules) return null;
  const module = rulebookName(sent.module);
  const places = placesIn(rulebook, module);
  if (!places.length) return null;
  const byId = new Map(men.map((m) => [m.id, m]));
  const starters = sent.starts.map((id) => byId.get(id)).filter((m): m is LineupMan => !!m);
  const { chosen, holder } = assign(
    [...starters].sort(byPoints),
    places.map((p) => p.roles),
  );
  const holders = holder.map((who) => (who === -1 ? null : chosen[who]));
  const placed = new Set(chosen.map((m) => m.id));
  return {
    module,
    rows: rowsOf(places, holders),
    total: chosen.reduce((sum, m) => sum + (m.points ?? 0), 0),
    placed: chosen.length,
    bench: sent.bench.map((id) => byId.get(id)).filter((m): m is LineupMan => !!m),
    outside: starters.filter((m) => !placed.has(m.id)),
    scores: [],
  };
}
