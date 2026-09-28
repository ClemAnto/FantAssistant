/**
 * THE DRAFT ASSISTANT'S PITCH: a squad as it is being built, on a module, with every man somewhere.
 *
 * The operator's request of 28/09/2026: the positions start EMPTY, each pick goes where it can, the men with
 * the highest priority on the pitch, and whoever is not a starter is spread EVENLY over the places of his own
 * role, drawn under the starter as his reserve.
 *
 * It is `fanta-eleven.ts` with two differences, both declared:
 *   * a squad that fields nobody yet still has a MODULE - the first of the recommended ones - so the empty
 *     places are on screen from the first minute instead of a blank card;
 *   * the bench is not «the first alternative of each place» (a man there can be the ballottaggio of two
 *     places, which is a statement about ONE place) but a DISTRIBUTION: every reserve stands under exactly
 *     one place, and the places of a role fill up evenly.
 *
 * The eleven itself is the same matroid (`mantra-legal.bestEleven`), on the same weight the panel prices a
 * draft with - the VALUE - and nothing here predicts a footballer.
 */

import { MantraModules } from './auction-value';
import { DRAW_ORDER } from './club-eleven';
import type { FantaMan } from './fanta-eleven';
import { ModuleLine, Place, assign, bestEleven, placesIn } from './mantra-legal';

/**
 * The modules the operator plays towards on MANTRA, in the order he names them («il modulo di riferimento
 * parte da 4-2-3-1 e 4-1-4-1», `docs/model/priorita-draft-v1.md` §3). They are a PREFERENCE and not a
 * measurement: they decide the shape an empty squad is drawn on and who wins a TIE - with an incomplete
 * squad many shapes hold the same men, and a tie broken by the order of the rulebook's file would be an
 * accident. A module that fields a strictly better eleven still wins.
 */
export const RECOMMENDED_MANTRA = ['4-2-3-1', '4-1-4-1'] as const;

export interface DraftPlace {
  line: ModuleLine;
  /** The rulebook's own name for the place (`DC/B`, `A/PC`). */
  slot: string;
  /** The listone roles this place accepts, lowercase. */
  roles: string[];
  man: FantaMan | null;
  /** His role the place is filled with, as the listone spells it. */
  badge: string | null;
  /** The men standing under this place as its reserves, best first. */
  reserves: FantaMan[];
  /** A SUGGESTED starter, where the squad has nobody for this place yet (`withSuggestions`). */
  suggested?: FantaMan | null;
  /** A SUGGESTED reserve, where the place has no reserve yet. */
  suggestedReserve?: FantaMan | null;
}

export interface DraftRow {
  line: ModuleLine;
  places: DraftPlace[];
}

export interface DraftPitch {
  module: string;
  /** True when the module is not one of the recommended ones: an automatic choice must say it moved. */
  offPlan: boolean;
  rows: DraftRow[];
  /** How many of the eleven places are filled. */
  placed: number;
  /** The squad's men no place of this module accepts: never dropped, listed apart. */
  unplaced: FantaMan[];
  /** The module's eleven worth, in fantapunti. */
  total: number;
}

/** The rulebook with the preferred modules FIRST, so a tie goes to them (`bestEleven` keeps the first). */
export function preferring(rules: MantraModules, preferred: readonly string[]): MantraModules {
  const names = Object.keys(rules.modules ?? {});
  const first = preferred.filter((name) => names.includes(name));
  const ordered: MantraModules['modules'] = {};
  for (const name of [...first, ...names.filter((name) => !first.includes(name))]) {
    ordered[name] = rules.modules[name];
  }
  return { ...rules, modules: ordered };
}

/**
 * The pitch of a squad on the best module, with its reserves spread.
 *
 * `forced` draws a module the operator chose instead of the best one. Returns null when there is no
 * rulebook to read - the card must say so rather than draw shapes nobody loaded.
 */
export function draftPitchOf(
  squad: readonly FantaMan[],
  rules: MantraModules | null,
  preferred: readonly string[] = [],
  forced: string | null = null,
): DraftPitch | null {
  if (!rules?.modules || !Object.keys(rules.modules).length) return null;
  const ordered = preferring(rules, forced ? [forced, ...preferred] : preferred);
  const scoped = forced && ordered.modules[forced]
    ? { ...ordered, modules: { [forced]: ordered.modules[forced] } }
    : ordered;
  const best = bestEleven(squad, scoped, (man) => man.value);
  const module = best?.module ?? Object.keys(scoped.modules)[0];
  const places: Place[] = best?.places ?? placesIn(scoped, module);
  const holders: (FantaMan | null)[] = best?.holders ?? places.map(() => null);

  const drawn: DraftPlace[] = places.map((place, at) => {
    const man = holders[at];
    return {
      line: place.line,
      slot: place.slot,
      roles: place.roles,
      man,
      badge: man ? badgeFor(man, place.roles) : null,
      reserves: [],
    };
  });

  const { unplaced } = spreadReserves(drawn, squad.filter((man) => !holders.includes(man)));

  const rows: DraftRow[] = [];
  for (const line of DRAW_ORDER) {
    const inLine = drawn.filter((place) => place.line === line);
    if (inLine.length) rows.push({ line, places: inLine });
  }
  return {
    module,
    offPlan: preferred.length > 0 && !preferred.includes(module),
    rows,
    placed: drawn.filter((place) => place.man).length,
    unplaced,
    total: best?.total ?? 0,
  };
}

/**
 * THE RESERVES, SPREAD EVENLY: each man, best first, goes under the place of his roles that has the FEWEST
 * reserves so far, and a tie goes to the place whose starter is weakest - that is where a reserve is most
 * likely to play. It mutates `places[*].reserves` and returns who fits nowhere.
 *
 * Evenly is the operator's word and it is the whole rule: it is not a substitution plan (the rulebook's
 * matrix decides who comes on, with its -1 out of role), it is where a man is DRAWN so that a glance tells
 * which places are covered twice and which not at all. A man with no value sorts last, never first.
 */
export function spreadReserves(
  places: DraftPlace[],
  bench: readonly FantaMan[],
): { unplaced: FantaMan[] } {
  const unplaced: FantaMan[] = [];
  const ordered = [...bench].sort(
    (left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity),
  );
  for (const man of ordered) {
    let target: DraftPlace | null = null;
    for (const place of places) {
      if (!man.roles.some((role) => place.roles.includes(role))) continue;
      if (
        !target
        || place.reserves.length < target.reserves.length
        || (place.reserves.length === target.reserves.length
          && (place.man?.value ?? -Infinity) < (target.man?.value ?? -Infinity))
      ) {
        target = place;
      }
    }
    if (target) target.reserves.push(man);
    else unplaced.push(man);
  }
  return { unplaced };
}

/** The one role of his the place is filled with, spelled the way the listone spells it. */
function badgeFor(man: FantaMan, roles: string[]): string | null {
  const at = man.roles.findIndex((role) => roles.includes(role));
  return at < 0 ? null : (man.shown[at] ?? man.roles[at]);
}


/**
 * THE SUGGESTIONS ON THE PITCH (operator, 29/09/2026: «suggerisci un titolare ed una riserva per ogni
 * ruolo, con opacità 0.3»), filled in only where the REAL squad leaves a gap: a real man is never pushed
 * off his place by a projected one. First the empty places get a starter - a maximum matching, best
 * projected man first, so the suggestions cover as many places as they can - then the places with no
 * reserve get one from whoever is left. Mutates the places and returns the pitch.
 */
export function withSuggestions(pitch: DraftPitch, projected: readonly FantaMan[]): DraftPitch {
  const places = pitch.rows.flatMap((row) => row.places);
  const ranked = [...projected].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  const empty = places.filter((place) => !place.man);
  const starters = assign(ranked, empty.map((place) => place.roles));
  empty.forEach((place, at) => {
    place.suggested = starters.holder[at] >= 0 ? starters.chosen[starters.holder[at]] : null;
  });
  const used = new Set(starters.chosen);
  const left = ranked.filter((man) => !used.has(man));
  const bare = places.filter((place) => !place.reserves.length);
  const reserves = assign(left, bare.map((place) => place.roles));
  bare.forEach((place, at) => {
    place.suggestedReserve = reserves.holder[at] >= 0 ? reserves.chosen[reserves.holder[at]] : null;
  });
  return pitch;
}
