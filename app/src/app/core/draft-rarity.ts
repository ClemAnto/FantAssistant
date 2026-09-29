/**
 * RAR, THE RARITY OF A FREE MAN (the operator, 30/09/2026): «il numero totale di calciatori ancora svincolati di
 * pari (simile) o superiore valore (titolarità/costanza/mv/bonus/presenze/propensione infortuni)».
 *
 * Why it exists, in his own example: six managers, six forwards at FM 10 and one defender at 6.5 where every other
 * defender reads 6 or less. The defender has the lower fantamedia and must be taken first, because a forward as
 * good will still be free at the next turn and a defender as good will not. The Draft Priority is a fact about the
 * MAN (`draft-priority.manValue`) and cannot see that; RAR counts it. A HIGH RAR is a man who can wait, a RAR of 0
 * is the last of his kind.
 *
 * «SIMILE O SUPERIORE» IS A DOMINANCE WITH A TOLERANCE, on every one of his six readings at once: a free man counts
 * for him when he is in the same GROUP (his base role - who can take the same place) and on each reading he is at
 * least as good as him, minus the tolerance of that reading (`RARITY_TOLERANCE`). One reading worse beyond its
 * tolerance and he is not «the same kind of player», which is what the sentence says. The tolerances are DECLARED,
 * not measured: nothing here predicts a footballer, and no harness owns a count shown beside a name.
 *
 * «VUOTO = IGNOTO»: a reading HE lacks constrains nobody (there is nothing to be at least as good as), while a
 * candidate who lacks a reading he HAS does not count - he cannot be shown to be as good. So a man with no numbers
 * at all reads the whole group, and the count says so by being large.
 *
 * The file imports no Angular.
 */

/** A free man as the rarity reads him. Every reading is «higher is better» except `fragility`. */
export interface RarityMan {
  id: number;
  /** Who can take the same place: the base role in mantra, the role in classic. */
  group: string;
  /** The titolarità word as a rank, best highest (`PRESS_RANK` of the view). */
  rung: number | null;
  /** Share of his votes with a base vote of 6 or more. */
  steady: number | null;
  /** Expected base vote. */
  mv: number | null;
  /** Expected bonus per appearance: fantamedia minus base vote. */
  bonus: number | null;
  /** Expected appearances over the season's matchdays. */
  share: number | null;
  /** Share of the last three years he spent injured (`player-status.fragilityOf`): LOWER is better. */
  fragility: number | null;
}

/**
 * How much worse a man may be on each reading and still be «pari (simile)»: DECLARED, one step of the unit each
 * reading is printed in. The rung is a word, so «pari» is the same word or a better one.
 */
export const RARITY_TOLERANCE = {
  rung: 0,
  /** Five points of the share of votes closed at 6 or more. */
  steady: 0.05,
  /** A tenth of base vote. */
  mv: 0.1,
  /** A tenth of bonus per appearance. */
  bonus: 0.1,
  /** Five points of the calendar: two matchdays of 38. */
  share: 0.05,
  /** Five points of three years: about 55 days out. */
  fragility: 0.05,
} as const;

const HIGHER: readonly (keyof Omit<RarityMan, 'id' | 'group' | 'fragility'>)[] = ['rung', 'steady', 'mv', 'bonus', 'share'];

/** Whether `other` is of equal (similar) or higher value than `man` on every reading `man` has. */
export function atLeastAsGood(other: RarityMan, man: RarityMan): boolean {
  for (const key of HIGHER) {
    const mine = man[key];
    if (mine == null) continue;
    const theirs = other[key];
    if (theirs == null || theirs < mine - RARITY_TOLERANCE[key]) return false;
  }
  if (man.fragility != null) {
    if (other.fragility == null || other.fragility > man.fragility + RARITY_TOLERANCE.fragility) return false;
  }
  return true;
}

/** RAR of every man of `free`, by id: how many OTHER free men of his group are at least as good as him. */
export function rarity(free: readonly RarityMan[]): Map<number, number> {
  const byGroup = new Map<string, RarityMan[]>();
  for (const man of free) {
    if (!byGroup.has(man.group)) byGroup.set(man.group, []);
    byGroup.get(man.group)!.push(man);
  }
  const out = new Map<number, number>();
  for (const men of byGroup.values()) {
    for (const man of men) {
      let count = 0;
      for (const other of men) if (other.id !== man.id && atLeastAsGood(other, man)) count += 1;
      out.set(man.id, count);
    }
  }
  return out;
}
