/**
 * What the Mantra rulebook lets you FIELD, and the one question a draft has to ask about it.
 *
 * A module is a set of TYPED PLACES and many places accept a choice of roles (`A/PC` takes an A or a Pc,
 * `DC/B` a Dc or a B), so «can this squad field this eleven» is an ASSIGNMENT and not a sort - a per-role
 * cap cannot express it, because the constraint is joint (`docs/model/assistente-asta-v1.md` §12.3, §13.2).
 * The admissible squads form a TRANSVERSAL MATROID, which is what makes the greedy on the weight EXACT: walk
 * down the ranking and keep whoever the module can still place, with an augmenting path. No heuristic.
 *
 * Why it is in the app at all: measured on the five gate windows (10/08/2026,
 * `docs/model/metrica-asta-surplus-v1.md` §15.4 and §16), covering the module TWICE is the biggest lever in
 * the whole auction advice - and the top 25 of ANY ranking cannot field a legal eleven, so «who is worth
 * most» is not a squad. `auction-plan` asks this file whether a man covers a place the squad cannot cover
 * yet, and that answer is what rations its own pick.
 *
 * ONE definition, and it lives here: the draft bench (`toolkit/bench/draft/`) imports these functions
 * through its `appcode.mjs` bundle rather than copying them, so what was measured is what ships.
 */

import { MantraModules } from './auction-value';

/** Anything with the listone's own role codes on it - the only thing legality depends on. */
export interface Placeable {
  roles: string[];
}

/**
 * A module's places, keeper first, each as the lowercase roles allowed to fill it.
 *
 * The keeper is outside the lines in the rulebook's own table (one `P` place in every scheme), so it is
 * prepended here rather than stored eleven times.
 */
export function placesOf(rules: MantraModules, moduleName: string): string[][] {
  const shape = rules.modules[moduleName];
  if (!shape) return [];
  return ['P', ...shape['D'] ?? [], ...shape['M'] ?? [], ...shape['T'] ?? [], ...shape['A'] ?? []]
    .map((place) => (rules.slot_roles[place] ?? []).map((role) => role.toLowerCase()));
}

/** A matching of men onto places: which men are placed, and who holds each place (`-1` = empty). */
export interface Matching<T extends Placeable> {
  chosen: T[];
  holder: number[];
}

/**
 * Kuhn's augmenting search, and the only copy of it.
 *
 * `rolesOf` answers for the men already placed AND for a candidate whose index is one past them, which is
 * what makes «would he cover one more place?» a single walk instead of a rebuilt matching.
 */
function walkFrom(
  who: number,
  places: string[][],
  holder: number[],
  seen: boolean[],
  rolesOf: (index: number) => string[],
): boolean {
  const roles = rolesOf(who);
  for (let place = 0; place < places.length; place += 1) {
    if (seen[place] || !places[place].some((role) => roles.includes(role))) continue;
    seen[place] = true;
    if (holder[place] === -1 || walkFrom(holder[place], places, holder, seen, rolesOf)) {
      holder[place] = who;
      return true;
    }
  }
  return false;
}

/**
 * Place as many of `men` as the module can hold, walking them in the order given.
 *
 * Because each placement is an augmenting search, the result is a MAXIMUM matching whatever the order - so
 * «how much of this module can the squad cover» does not depend on how the squad is sorted, while «which
 * eleven is best» does, and that is why the caller sorts before asking.
 */
export function assign<T extends Placeable>(men: readonly T[], places: string[][]): Matching<T> {
  const chosen: T[] = [];
  const holder = new Array<number>(places.length).fill(-1);
  for (const man of men) {
    if (chosen.length === places.length) break;
    const index = chosen.push(man) - 1;
    const seen = new Array<boolean>(places.length).fill(false);
    if (!walkFrom(index, places, holder, seen, (i) => chosen[i].roles)) chosen.pop();
  }
  return { chosen, holder };
}

/**
 * Would a man with these roles cover a place the squad cannot cover yet?
 *
 * One walk on a COPY of the matching, so the caller's state survives the question. This is the whole of the
 * coverage rule: it is answered on the PLACES, never on a per-role budget - `startingPlaces` is the ceiling
 * of each role's average share over the eleven shapes and sums to sixteen against a shape's ten outfield
 * places, so «twice the starting places» is a target a 22-man squad never reaches. A place is what the
 * rulebook actually rations (measured, `metrica-asta-surplus-v1.md` §16).
 */
export function augments<T extends Placeable>(
  matching: Matching<T>,
  places: string[][],
  roles: string[],
): boolean {
  if (matching.chosen.length >= places.length) return false;
  const holder = [...matching.holder];
  const seen = new Array<boolean>(places.length).fill(false);
  return walkFrom(
    matching.chosen.length,
    places,
    holder,
    seen,
    (i) => (i < matching.chosen.length ? matching.chosen[i].roles : roles),
  );
}

export interface Covered<T extends Placeable> {
  /** The module the squad covers best - not the one it would be strongest on, the one it FILLS most. */
  module: string;
  /** Its places, repeated `copies` times: the target the coverage rule is measured against. */
  places: string[][];
  matching: Matching<T>;
}

/**
 * Which module the squad covers best, over `copies` elevens.
 *
 * `copies` = how many legal elevens the squad should be able to field. TWO is what the measurement adopted:
 * a mantra squad is 22 outfield men against a shape's ten outfield places, so two elevens plus two spares
 * IS the standard roster, and imposing it is worth an order of magnitude more than the choice of currency.
 *
 * Returns null when there are no shapes to read - the panel then keeps the rationing it had.
 *
 * A TIE is broken by the first module declared, and that is a real limit rather than a detail: two shapes
 * covering the same squad can leave different places open, so which one is the target decides whether a man
 * «covers something». It is left as it is because this is the behaviour the five-window bench measured, and
 * changing a tie-break after the run would be shipping something nobody scored; with the target of two
 * elevens the tie is much rarer than with one. Written down instead of fixed.
 */
export function bestCovered<T extends Placeable>(
  squad: readonly T[],
  rules: MantraModules | null,
  copies = 2,
): Covered<T> | null {
  if (!rules?.modules) return null;
  let best: Covered<T> | null = null;
  for (const name of Object.keys(rules.modules)) {
    const one = placesOf(rules, name);
    if (!one.length) continue;
    const places = copies === 1 ? one : Array.from({ length: copies }, () => one).flat();
    const matching = assign(squad, places);
    if (!best || matching.chosen.length > best.matching.chosen.length) {
      best = { module: name, places, matching };
    }
  }
  return best;
}

/**
 * The best legal eleven a squad can field, by a weight - and how much it is worth.
 *
 * The app did not need this while it only asked «does he cover a place»; it needs it for the DENIAL note
 * (`todolist-draft-v1.md` item 1.5), because «what taking him removes from a rival» is the difference between
 * two elevens and nothing cheaper says the same thing.
 *
 * Sorting first is what makes it the BEST eleven and not merely a legal one: the matching is maximum whatever
 * the order, but WHICH men are in it is not. A non-positive weight is not fielded - an empty place is worth
 * more than a vote below zero - and a man with no weight at all is not fielded either, because that is
 * «unknown», never «zero».
 */
export function bestElevenWorth<T extends Placeable>(
  squad: readonly T[],
  rules: MantraModules | null,
  weightOf: (man: T) => number | null,
): number {
  if (!rules?.modules) return 0;
  const ranked = squad
    .filter((man) => (weightOf(man) ?? 0) > 0)
    .sort((left, right) => (weightOf(right) ?? 0) - (weightOf(left) ?? 0));
  let best = 0;
  for (const name of Object.keys(rules.modules)) {
    const places = placesOf(rules, name);
    if (!places.length) continue;
    const { chosen } = assign(ranked, places);
    const total = chosen.reduce((sum, man) => sum + (weightOf(man) ?? 0), 0);
    if (total > best) best = total;
  }
  return best;
}
