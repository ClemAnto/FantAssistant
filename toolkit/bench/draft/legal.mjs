/* The bench's readings of a squad's legality. The LEGALITY ITSELF is not here: `placesOf`, `assign`,
 * `augments` and `bestCovered` are the APP's (`app/src/app/core/mantra-legal.ts`), re-exported through
 * `appcode.mjs`, because two copies of an augmenting search would be two legalities and the bench exists to
 * judge what ships.
 *
 * What IS here is the two things the app never does: score a season's outcome, and pick the best eleven by a
 * weight. Both are the same matching read through a weight.
 *
 * A place the squad cannot cover is worth ZERO and does not void the matchday: that is how the game treats a
 * «senza voto» with no bench player of the same role. For the same reason a NEGATIVE weight is not fielded -
 * an empty place is worth more than a vote below zero - but whoever BUILDS a squad must be able to take a man
 * of negative value to cover a place, so it is an option and not a rule. */
import { assign, augments, bestCovered, placesOf } from './appcode.mjs';

export { assign, augments, bestCovered, placesOf };

/**
 * The same matching read through a weight: walk the men best-first and sum what the module can place.
 *
 * Sorting first is what makes this the BEST eleven rather than merely a legal one - the matching is maximum
 * whatever the order, but which men are in it is not. `skipNonPositive` drops the men a place should refuse,
 * which on a sorted list is the same as stopping at the first of them.
 */
export function weighted(men, places, weightOf, { skipNonPositive = false } = {}) {
  const ranked = [...men].sort((a, b) => weightOf(b) - weightOf(a));
  const matching = assign(skipNonPositive ? ranked.filter((p) => weightOf(p) > 0) : ranked, places);
  return {
    ...matching,
    total: matching.chosen.reduce((sum, p) => sum + weightOf(p), 0),
    complete: matching.chosen.length === places.length,
  };
}

/** The squad's best legal eleven, on the module it fields best. */
export function legalXI(roster, config, weightOf = (p) => p.actual) {
  let best = { points: 0, filled: 0, places: 0, module: null };
  for (const name of Object.keys(config.modules)) {
    const places = placesOf(config, name);
    const { chosen, total } = weighted(roster, places, weightOf, { skipNonPositive: true });
    if (total > best.points) {
      best = { points: total, filled: chosen.length, places: places.length, module: name };
    }
  }
  return best;
}
