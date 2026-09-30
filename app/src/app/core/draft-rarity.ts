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
 * A MISSING READING: HIS constrains nobody (there is nothing to be at least as good as); a CANDIDATE's is filled
 * with the MEAN of that reading over the free men of the group who have it (the operator, 30/09/2026: «utilizziamo
 * un dato medio calcolato per il confronto»). The first draft left such a candidate out, which made the count
 * depend on who happens to be missing a column rather than on who is as good. Where nobody of the group has the
 * reading, he cannot have it either, so it constrains nobody.
 *
 * The file imports no Angular.
 */

/**
 * The titolarità words as one ladder, best highest: the press's seven and the engine's own (`comprimario` and
 * `panchina` share a rung). One definition for the list's sort, its filter and the rung reading of RAR.
 */
export const RUNG_RANK: Record<string, number> = {
  bandiera: 7,
  titolarissimo: 6,
  titolare: 5,
  ballottaggio: 4,
  comprimario: 3,
  panchina: 3,
  riserva: 2,
  scarto: 1,
};

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

type Reading = (typeof HIGHER)[number] | 'fragility';
const READINGS: readonly Reading[] = [...HIGHER, 'fragility'];

/** The mean of every reading over the men of one group who have it: what a missing candidate reading reads. */
export type ReadingMeans = Partial<Record<Reading, number>>;

export function readingMeans(men: readonly RarityMan[]): ReadingMeans {
  const out: ReadingMeans = {};
  for (const key of READINGS) {
    const known = men.map((m) => m[key]).filter((v): v is number => v != null);
    if (known.length) out[key] = known.reduce((a, b) => a + b, 0) / known.length;
  }
  return out;
}

/**
 * Whether `other` is of equal (similar) or higher value than `man` on every reading `man` has; a reading `other`
 * lacks reads the group's mean (`means`), and with no mean at all he cannot be shown to be as good.
 */
export function atLeastAsGood(other: RarityMan, man: RarityMan, means: ReadingMeans = {}): boolean {
  for (const key of READINGS) {
    const mine = man[key];
    if (mine == null) continue;
    const theirs = other[key] ?? means[key];
    if (theirs == null) return false;
    const ok = key === 'fragility'
      ? theirs <= mine + RARITY_TOLERANCE.fragility
      : theirs >= mine - RARITY_TOLERANCE[key];
    if (!ok) return false;
  }
  return true;
}

/** RAR of one man: `count` other free men of his group are at least as good, `of` other free men are in it. */
export interface Rarity {
  count: number;
  of: number;
}

/** RAR of every man of `free`, by id: how many OTHER free men of his group are at least as good as him. */
export function rarity(free: readonly RarityMan[]): Map<number, Rarity> {
  const byGroup = new Map<string, RarityMan[]>();
  for (const man of free) {
    if (!byGroup.has(man.group)) byGroup.set(man.group, []);
    byGroup.get(man.group)!.push(man);
  }
  const out = new Map<number, Rarity>();
  for (const men of byGroup.values()) {
    const means = readingMeans(men);
    for (const man of men) {
      let count = 0;
      for (const other of men) if (other.id !== man.id && atLeastAsGood(other, man, means)) count += 1;
      out.set(man.id, { count, of: men.length - 1 });
    }
  }
  return out;
}

/**
 * RAR AS IT IS SHOWN (the operator, 30/09/2026: «se il numero è > 10 ... il x% di calciatori sono uguali o migliori
 * di lui»): the count up to `RARITY_COUNT_MAX`, above it the share of the OTHER free men of his group, rounded.
 */
export const RARITY_COUNT_MAX = 10;

export function rarityText(rar: Rarity | null): string {
  if (!rar) return '—';
  if (rar.count <= RARITY_COUNT_MAX || !rar.of) return String(rar.count);
  return `${Math.round((rar.count / rar.of) * 100)}%`;
}
