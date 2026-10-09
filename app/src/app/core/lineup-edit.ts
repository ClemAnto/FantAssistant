/**
 * THE LINEUP THE OPERATOR EDITS BY HAND (operator, 09/10/2026: «dammi la possibilità di cambiare i calciatori nel
 * campetto utilizzando il drag&drop ... dalla tabella al campo (o alla panchina e viceversa) che dalla panchina al
 * campo (e viceversa). Permetti anche di riordinare la panchina ... o di "scambiare" due calciatori in campo», then
 * «se nelle regole della lega è disponibile lo SWITCH ... permettimi anche di impostarli»).
 *
 * A DRAFT is ids and nothing else - who holds each place of the module (in `placesIn` order), the bench in order,
 * the switch - so it can be drawn with the numbers of the moment (`drawDraft`) and checked by the same rules every
 * time. Every gesture is ONE pure function (`move`) that either returns the new draft or the sentence that says why
 * not, so the drop, the highlight while dragging and the tests read the same rule.
 *
 * A place takes a man only with one of the roles it accepts - the rulebook's law, the same matching the advice
 * uses (`mantra-legal`). Leghe's own editor also lets a Mantra man stand out of position with a malus; this page
 * does not, and says so when it refuses.
 */

import { MantraModules } from './auction-value';
import { LegheGame } from './leghe-rules';
import { LineupMan, LineupPlan, Substitutions, coverOrder, earnsDefence, modifiersOf, rowsOf } from './lineup-advice';
import { Place, assign, placesIn } from './mantra-legal';

export interface LineupSwitchDraft {
  /** The starter who leaves if he does not start the real match. */
  out: number | null;
  /** The bench man who takes his place. */
  in: number | null;
  /** The module after the switch (rulebook name, Plus only); null = the first that works. */
  module: string | null;
}

export interface LineupDraft {
  /** The fantasquadra and matchday it belongs to (`keyOf(league):matchday`): a draft of another one is not drawn. */
  owner: string;
  /** Rulebook name (`4-3-3`). */
  module: string;
  /** Who holds each place of the module, in `placesIn` order; null = empty. */
  places: (number | null)[];
  bench: number[];
  switch: LineupSwitchDraft;
}

export const NO_SWITCH: LineupSwitchDraft = { out: null, in: null, module: null };

/** Where a man can be dropped. */
export type DropTarget =
  | { kind: 'place'; at: number }
  | { kind: 'bench'; index: number }
  | { kind: 'out' }
  | { kind: 'switch-out' }
  | { kind: 'switch-in' };

/** A drawn lineup turned into a draft: what is on screen is where the editing starts. */
export function draftOf(plan: LineupPlan, owner: string, size: number, sw: LineupSwitchDraft = NO_SWITCH): LineupDraft {
  const places = new Array<number | null>(size).fill(null);
  for (const row of plan.rows) for (const place of row.places) places[place.at] = place.man?.id ?? null;
  return { owner, module: plan.module, places, bench: plan.bench.map((man) => man.id), switch: { ...sw } };
}

const fits = (man: LineupMan, place: Place | undefined) => !!place && man.roles.some((role) => place.roles.includes(role));

/** Where a man is in the draft. */
function locate(draft: LineupDraft, id: number): { kind: 'place'; at: number } | { kind: 'bench'; index: number } | null {
  const at = draft.places.indexOf(id);
  if (at >= 0) return { kind: 'place', at };
  const index = draft.bench.indexOf(id);
  return index >= 0 ? { kind: 'bench', index } : null;
}

/** The switch kept only where it still holds: the man going out on the pitch, the man coming in on the bench. */
function cleanSwitch(draft: LineupDraft): LineupDraft {
  const sw = { ...draft.switch };
  if (sw.out !== null && !draft.places.includes(sw.out)) sw.out = null;
  if (sw.in !== null && !draft.bench.includes(sw.in)) sw.in = null;
  return { ...draft, switch: sw };
}

const slotName = (place: Place | undefined) => place?.slot ?? '?';

/**
 * ONE GESTURE: man `id` dropped on `target`. Returns the new draft, or the reason it cannot be done.
 *
 *   - on a PLACE: he must fit it. The man already there goes where `id` came from - his place (a swap on the
 *     pitch, which he must fit too), his bench slot, or out of the lineup when `id` came from the roster.
 *   - on the BENCH at `index`: inserted there (a reorder when he was already on the bench); a starter leaves his
 *     place empty.
 *   - OUT (back to the roster table): off the pitch or the bench.
 *   - on the SWITCH: going out must be a starter, coming in must be on the bench.
 */
export function move(
  draft: LineupDraft,
  id: number,
  target: DropTarget,
  men: ReadonlyMap<number, LineupMan>,
  rules: MantraModules,
): { draft: LineupDraft } | { refused: string } {
  const man = men.get(id);
  if (!man) return { refused: 'Calciatore non in rosa.' };
  const places = placesIn(rules, draft.module);
  const from = locate(draft, id);
  const next: LineupDraft = { ...draft, places: [...draft.places], bench: [...draft.bench], switch: { ...draft.switch } };

  switch (target.kind) {
    case 'place': {
      const place = places[target.at];
      if (!place) return { refused: 'Posto inesistente.' };
      if (from?.kind === 'place' && from.at === target.at) return { draft };
      if (!fits(man, place)) return { refused: `${man.name} non gioca da ${slotName(place)}.` };
      const holderId = next.places[target.at];
      const holder = holderId === null ? null : (men.get(holderId) ?? null);
      if (from?.kind === 'place') {
        if (holder && !fits(holder, places[from.at])) {
          return { refused: `Scambio impossibile: ${holder.name} non gioca da ${slotName(places[from.at])}.` };
        }
        next.places[from.at] = holderId;
      } else if (from?.kind === 'bench') {
        if (holderId === null) next.bench.splice(from.index, 1);
        else next.bench[from.index] = holderId;
      }
      next.places[target.at] = id;
      break;
    }
    case 'bench': {
      if (from?.kind === 'bench') next.bench.splice(from.index, 1);
      if (from?.kind === 'place') next.places[from.at] = null;
      next.bench.splice(Math.max(0, Math.min(target.index, next.bench.length)), 0, id);
      break;
    }
    case 'out': {
      if (from?.kind === 'place') next.places[from.at] = null;
      if (from?.kind === 'bench') next.bench.splice(from.index, 1);
      break;
    }
    case 'switch-out': {
      if (from?.kind !== 'place') return { refused: 'Nello switch esce un titolare: trascina qui un calciatore in campo.' };
      next.switch.out = id;
      break;
    }
    case 'switch-in': {
      if (from?.kind !== 'bench') return { refused: 'Nello switch entra un panchinaro: trascina qui un calciatore della panchina.' };
      next.switch.in = id;
      break;
    }
  }
  return { draft: cleanSwitch(next) };
}

/**
 * THE SAME MEN ON ANOTHER MODULE: the starters are placed on the new module's places (`assign`, the best first), and
 * those it cannot place go to the HEAD of the bench, where they are seen, instead of vanishing.
 */
export function relayout(
  draft: LineupDraft,
  module: string,
  men: ReadonlyMap<number, LineupMan>,
  rules: MantraModules,
): LineupDraft {
  const places = placesIn(rules, module);
  if (!places.length || module === draft.module) return draft;
  const starters = draft.places
    .map((id) => (id === null ? null : (men.get(id) ?? null)))
    .filter((man): man is LineupMan => !!man)
    .sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity));
  const { chosen, holder } = assign(starters, places.map((p) => p.roles));
  const placed = new Set(chosen.filter((_, i) => holder.includes(i)).map((man) => man.id));
  const left = starters.filter((man) => !placed.has(man.id)).map((man) => man.id);
  return cleanSwitch({
    ...draft,
    module,
    places: holder.map((who) => (who === -1 ? null : chosen[who].id)),
    bench: [...left, ...draft.bench],
  });
}

/**
 * THE DRAFT DRAWN as a plan, with the numbers of the moment: the same rows, bench, «outside» and bench cover as the
 * advised lineup, so the pitch draws one shape whatever it shows. A man no longer in the roster is dropped.
 */
export function drawDraft(
  men: readonly LineupMan[],
  rules: MantraModules | null,
  draft: LineupDraft,
  game: LegheGame | null,
  subs?: Substitutions,
): LineupPlan | null {
  if (!rules?.modules) return null;
  const places = placesIn(rules, draft.module);
  if (!places.length) return null;
  const byId = new Map(men.map((man) => [man.id, man]));
  const holders = places.map((_, at) => {
    const id = draft.places[at];
    return id === null || id === undefined ? null : (byId.get(id) ?? null);
  });
  const starters = holders.flatMap((man, at) => (man ? [{ place: places[at], man }] : []));
  const bench = draft.bench.map((id) => byId.get(id)).filter((man): man is LineupMan => !!man);
  const used = new Set([...starters.map((one) => one.man.id), ...bench.map((man) => man.id)]);
  const { coveredBy } = coverOrder(starters, bench, game, rules, draft.module, subs);
  const open = starters.filter((one) => !coveredBy.has(one.man.id)).map((one) => one.man.name);
  const modifiers = modifiersOf(starters.map((one) => one.man), earnsDefence(places, game));
  return {
    module: draft.module,
    rows: rowsOf(places, holders),
    total: starters.reduce((sum, one) => sum + (one.man.points ?? 0), 0) + modifiers,
    modifiers,
    placed: starters.length,
    bench,
    outside: men.filter((man) => !used.has(man.id)),
    scores: [],
    cover: { starters: starters.length, covered: starters.length - open.length, open },
  };
}
