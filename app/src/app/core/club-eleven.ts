/**
 * The eleven a REAL club is most likely to field, drawn on one of the game's own shapes.
 *
 * WHAT THIS IS, and the label matters more than the picture. It is the eleven of the men the ENGINE expects
 * to play most (`pv`, expected appearances), placed on the shape those men fill best. It is **not** the
 * toolkit's board: that one is drawn in the Tk panel from the claim (`engine/presence.standing`), the coach's
 * own repertoire (`coach_shapes`), the operator's rulings (`config/board_rulings.json`) and a Hungarian fit
 * over a distance grid with the five `_reshape` transformations on top - none of which travels in the bundle.
 * Calling this «la formazione tipo» of the panel would be the defect this repository keeps paying for: a
 * number that describes one thing under the name of another.
 *
 * Why `pv` and not our value: measured on fifteen window instances (`gate-motore-v1.md` §7-octovicies,
 * `metrica-asta-surplus-v1.md` §18), expected appearances are the half of the prediction that carries the
 * ranking - `pv_pred` +0.459 against `fm_pred` +0.259 - and «who starts» is exactly the question a pitch is
 * asking. Ranking this eleven by the fantamedia would draw the men who score when they play, which is a
 * different picture and the wrong one for «chi scende in campo».
 *
 * The placement is the SHARED matroid (`mantra-legal`), the same definition the draft bench and the coverage
 * rule use, so no second legality exists anywhere in this app.
 */

import { MantraModules } from './auction-value';
import { Placeable, assign, placesOf } from './mantra-legal';

/** A man as a pitch needs him: who he is, whether he is gone, and what the eleven is ranked by. */
export interface ClubMan extends Placeable {
  id: number;
  name: string;
  /** Expected appearances. A man the sheet cannot price has none, and he is not drawn - unknown, not zero. */
  pv: number | null;
  price: number;
  taken: boolean;
}

/** One place of the drawn shape, and who fills it. `player` is null for a place nobody covers. */
export interface ElevenPlace {
  /** The place's own type as the rulebook spells it (`DC/B`, `A/PC`, `P`, `D`, ...). */
  slot: string;
  /** Which line it belongs to, in the order a pitch draws them from the goal up. */
  line: 'P' | 'D' | 'M' | 'T' | 'A';
  player: ClubMan | null;
}

export interface ClubEleven {
  module: string;
  places: ElevenPlace[];
  /** How many places the club's men actually cover: a squad we can only half price shows gaps. */
  filled: number;
  /** How many of the drawn men are already off the board. */
  taken: number;
  /** Men with no `pv` at all, so the pitch can say why it drew ten and not eleven. */
  unpriced: number;
}

/** The lines of a module, in the order they are drawn, keeper first. */
function linesOf(rules: MantraModules, name: string): ElevenPlace['line'][] {
  const shape = rules.modules[name];
  const lines: ElevenPlace['line'][] = ['P'];
  for (const line of ['D', 'M', 'T', 'A'] as const) {
    for (const _place of shape?.[line] ?? []) lines.push(line);
  }
  return lines;
}

/** The place types of a module, keeper first - the same order `placesOf` walks. */
function slotsOf(rules: MantraModules, name: string): string[] {
  const shape = rules.modules[name];
  return ['P', ...(shape?.['D'] ?? []), ...(shape?.['M'] ?? []), ...(shape?.['T'] ?? []),
          ...(shape?.['A'] ?? [])];
}

/**
 * The club's likely eleven: the shape its most-used men fill best, and who stands where.
 *
 * «Best» is the sum of the expected appearances of the men the shape can place, so a shape that leaves a place
 * empty is beaten by one that fills it - which is what makes the drawn module the club's own and not ours.
 * Ties go to the first module declared, the same tie-break the coverage rule uses and for the same reason:
 * it is the one that was measured.
 *
 * A man with no `pv` is not drawn at all. That is «vuoto = ignoto»: on a Serie A sheet the engine refuses 111
 * men of 433, and filling their places with a guess would draw an eleven nobody predicted.
 */
export function clubEleven(men: ClubMan[], rules: MantraModules | null): ClubEleven | null {
  if (!rules?.modules) return null;
  const unpriced = men.filter((man) => man.pv == null).length;
  const ranked = men
    .filter((man) => man.pv != null && man.roles.length)
    .sort((left, right) => (right.pv ?? 0) - (left.pv ?? 0));
  if (!ranked.length) return null;

  let best: ClubEleven | null = null;
  for (const name of Object.keys(rules.modules)) {
    const places = placesOf(rules, name);
    if (!places.length) continue;
    const { chosen, holder } = assign(ranked, places);
    const worth = chosen.reduce((sum, man) => sum + (man.pv ?? 0), 0);
    const slots = slotsOf(rules, name);
    const lines = linesOf(rules, name);
    const drawn: ElevenPlace[] = places.map((_roles, at) => ({
      slot: slots[at] ?? '',
      line: lines[at] ?? 'M',
      player: holder[at] >= 0 ? chosen[holder[at]] : null,
    }));
    const filled = drawn.filter((place) => place.player).length;
    const candidate: ClubEleven = {
      module: name,
      places: drawn,
      filled,
      taken: drawn.filter((place) => place.player?.taken).length,
      unpriced,
    };
    // More places covered first, then the appearances they add up to: a fuller eleven is the club's eleven.
    if (!best || filled > best.filled
        || (filled === best.filled && worth > best.places.reduce(
          (sum, place) => sum + (place.player?.pv ?? 0), 0))) {
      best = candidate;
    }
  }
  return best;
}

/** The lines a pitch draws, top (attack) to bottom (goal), with the places of each. */
export function byLine(eleven: ClubEleven): { line: ElevenPlace['line']; places: ElevenPlace[] }[] {
  const order: ElevenPlace['line'][] = ['A', 'T', 'M', 'D', 'P'];
  return order
    .map((line) => ({ line, places: eleven.places.filter((place) => place.line === line) }))
    .filter((row) => row.places.length);
}
