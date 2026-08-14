/**
 * A FANTA squad's eleven: the best legal one the rulebook lets it field, drawn on the same pitch.
 *
 * The difference with `club-eleven.ts` is the whole point and must not be blurred. There the eleven is a
 * PREDICTION about a real coach, so the app computes nothing and reads the board the toolkit drew. Here there
 * is no coach and nothing to predict: a fanta squad's eleven is a question about the RULEBOOK - which of the
 * legal shapes lets these men on the pitch, and which of them are worth fielding - so it is decided here, with
 * the same matroid the auction advice already rations on (`mantra-legal.ts`, one definition, shared with the
 * draft bench).
 *
 * Two rules the numbers obey, both the project's own:
 *   * the weight is the VALUE (fantamedia x expected appearances), the currency the five-window draft bench
 *     measured as the right one for this format - not the surplus and not the netto;
 *   * a man the sheet cannot price is NOT fielded and is NOT a zero: he is listed apart, so «this eleven has
 *     ten men» reads as what it is rather than as a squad with a hole.
 *
 * The BALLOTTAGGIO is the strongest man of the bench that same place would accept. It is exact and not a
 * heuristic: swapping him for the holder of one place leaves every other place untouched, so the eleven stays
 * legal iff his roles fit that place - no second matching to run.
 */

import { MantraModules } from './auction-value';
import { DRAW_ORDER, PitchLine } from './club-eleven';
import { Placeable, bestEleven } from './mantra-legal';

/** One man of a fanta squad, priced as the panel prices him. */
export interface FantaMan extends Placeable {
  id: number;
  name: string;
  club: string;
  /** Lowercase, for the matching: `roles`. These are the same codes AS SHOWN, for the chip. */
  shown: string[];
  /** Fantamedia x expected appearances. Null when the sheet cannot price him - never a zero. */
  value: number | null;
  /** The same worth on the session's 0-99 scale, so a chip can carry it like the real pitch does. */
  value99: number | null;
  /** What he cost at this table. */
  cost: number;
  /** Minutes per match played last season, for the tooltip. */
  minutesPerMatch: number | null;
}

export interface FantaPlace {
  line: PitchLine;
  /** The rulebook's own name for the place (`DC/B`, `A/PC`, `D` on classic). */
  slot: string;
  man: FantaMan | null;
  /** The ONE role of his this place is filled with, which is what the chip shows. */
  badge: string | null;
  /** The strongest man on the bench this place would accept. Null when nobody on it fits. */
  rival: FantaMan | null;
}

export interface FantaRow {
  line: PitchLine;
  places: FantaPlace[];
}

export interface FantaEleven {
  module: string;
  rows: FantaRow[];
  /** The eleven's worth in fantapunti - the sum of the values on the pitch. */
  total: number;
  /** How many of the eleven places are filled: early in an auction a squad cannot fill them all. */
  placed: number;
  /** Priced men left out, best first. */
  bench: FantaMan[];
  /** Men the sheet cannot price at all: not fielded, and the card says so rather than counting them out. */
  unpriced: FantaMan[];
  /** What each module would be worth to this squad, best first: why this one won, and by how much. */
  scores: { module: string; total: number; placed: number }[];
}

/**
 * The best eleven, on the module that maximises it.
 *
 * Returns null when there are no shapes to read - which is the bundle's business, not this file's - and the
 * card must then say so instead of drawing an eleven on a rulebook nobody loaded.
 */
export function fantaElevenOf(squad: readonly FantaMan[], rules: MantraModules | null): FantaEleven | null {
  if (!rules?.modules) return null;
  const best = bestEleven(squad, rules, (man) => man.value);
  if (!best) {
    return {
      module: '',
      rows: [],
      total: 0,
      placed: 0,
      bench: [],
      unpriced: squad.filter((man) => man.value == null),
      scores: [],
    };
  }

  const onPitch = new Set(best.men.map((man) => man.id));
  const bench = squad
    .filter((man) => !onPitch.has(man.id) && (man.value ?? 0) > 0)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));

  const rows: FantaRow[] = [];
  for (const line of DRAW_ORDER) {
    const places: FantaPlace[] = [];
    best.places.forEach((place, at) => {
      if (place.line !== line) return;
      const man = best.holders[at];
      places.push({
        line,
        slot: place.slot,
        man,
        badge: man ? badgeFor(man, place.roles) : null,
        // Bench first come, best first: the same man can be the ballottaggio of two places, which is what
        // «he is the first alternative there» means - it is not a substitution plan.
        rival: bench.find((other) => fits(other, place.roles)) ?? null,
      });
    });
    if (places.length) rows.push({ line, places });
  }

  return {
    module: best.module,
    rows,
    total: best.total,
    placed: best.men.length,
    bench,
    unpriced: squad.filter((man) => man.value == null),
    scores: best.scores,
  };
}

function fits(man: FantaMan, roles: string[]): boolean {
  return man.roles.some((role) => roles.includes(role));
}

/** The one role of his the place is filled with, spelled the way the listone spells it. */
function badgeFor(man: FantaMan, roles: string[]): string | null {
  const at = man.roles.findIndex((role) => roles.includes(role));
  return at < 0 ? null : (man.shown[at] ?? man.roles[at]);
}
