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
 * The lines a module is written in. Same five letters the boards use, declared here rather than imported:
 * this file is bundled by the draft bench, and the pitch's own types drag in `bundle.ts` and with it Angular.
 */
export type ModuleLine = 'P' | 'D' | 'M' | 'T' | 'A';

const LINES: ModuleLine[] = ['D', 'M', 'T', 'A'];

/** One typed place of a module: the line it belongs to, the slot that names it, the roles it accepts. */
export interface Place {
  line: ModuleLine;
  /** The rulebook's own name for it (`DC/B`, `A/PC`, and `P` for the keeper). */
  slot: string;
  /** Lowercase, because that is the vocabulary a man's roles are compared in. */
  roles: string[];
}

/**
 * A module's places IN ORDER, keeper first, each with the line it belongs to.
 *
 * The keeper is outside the lines in the rulebook's own table (one `P` place in every scheme), so it is
 * prepended here rather than stored eleven times. The order inside a line is the rulebook's own, which is the
 * team's right to its left (`4-3-3` opens its defence with `DD` and closes it with `DS`): that is the only
 * side information a module carries, and a drawing that ignored it would put the right back on the left.
 */
export function placesIn(rules: MantraModules, moduleName: string): Place[] {
  const shape = rules.modules[moduleName];
  if (!shape) return [];
  const roles = (slot: string) => (rules.slot_roles[slot] ?? []).map((role) => role.toLowerCase());
  const places: Place[] = [{ line: 'P', slot: 'P', roles: roles('P') }];
  for (const line of LINES) {
    for (const slot of shape[line] ?? []) places.push({ line, slot, roles: roles(slot) });
  }
  return places;
}

/** The same places as the bare role lists the matching walks. ONE definition: `placesIn` is it. */
export function placesOf(rules: MantraModules, moduleName: string): string[][] {
  return placesIn(rules, moduleName).map((place) => place.roles);
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

/** The best legal eleven a squad can field on one module, place by place. */
export interface Eleven<T extends Placeable> {
  module: string;
  places: Place[];
  /** Who stands on each place, aligned to `places`. Null where the squad cannot fill it. */
  holders: (T | null)[];
  /** The men on the pitch, in no particular order: the same ones `holders` names. */
  men: T[];
  total: number;
  /** What every module is worth to this squad, best first: the reason the winner won. */
  scores: { module: string; total: number; placed: number }[];
}

/**
 * The best legal eleven a squad can field, by a weight - the module, the men, and where each one stands.
 *
 * Sorting first is what makes it the BEST eleven and not merely a legal one: the matching is maximum whatever
 * the order, but WHICH men are in it is not. A non-positive weight is not fielded - an empty place is worth
 * more than a vote below zero - and a man with no weight at all is not fielded either, because that is
 * «unknown», never «zero».
 *
 * A TIE goes to the module declared first, exactly as `bestCovered` resolves its own: with an incomplete squad
 * many shapes hold the same men and the tie is common, so it is stated rather than hidden.
 */
export function bestEleven<T extends Placeable>(
  squad: readonly T[],
  rules: MantraModules | null,
  weightOf: (man: T) => number | null,
): Eleven<T> | null {
  if (!rules?.modules) return null;
  const ranked = squad
    .filter((man) => (weightOf(man) ?? 0) > 0)
    .sort((left, right) => (weightOf(right) ?? 0) - (weightOf(left) ?? 0));
  let best: Eleven<T> | null = null;
  const scores: { module: string; total: number; placed: number }[] = [];
  for (const name of Object.keys(rules.modules)) {
    const places = placesIn(rules, name);
    if (!places.length) continue;
    const { chosen, holder } = assign(ranked, places.map((place) => place.roles));
    const total = chosen.reduce((sum, man) => sum + (weightOf(man) ?? 0), 0);
    scores.push({ module: name, total, placed: chosen.length });
    if (total > (best?.total ?? 0)) {
      best = {
        module: name,
        places,
        holders: holder.map((who) => (who === -1 ? null : chosen[who])),
        men: chosen,
        total,
        scores,
      };
    }
  }
  if (best) best.scores = [...scores].sort((left, right) => right.total - left.total);
  return best;
}

/**
 * What that eleven is WORTH, which is all the denial note needs.
 *
 * The app did not need the eleven itself while it only asked «does he cover a place»; it needs the number for
 * the DENIAL note (`todolist-draft-v1.md` item 1.5), because «what taking him removes from a rival» is the
 * difference between two elevens and nothing cheaper says the same thing. Zero when nothing can be fielded -
 * `bestEleven` returns null there, and a squad that fields nobody is worth nothing rather than unknown.
 */
export function bestElevenWorth<T extends Placeable>(
  squad: readonly T[],
  rules: MantraModules | null,
  weightOf: (man: T) => number | null,
): number {
  return bestEleven(squad, rules, weightOf)?.total ?? 0;
}
