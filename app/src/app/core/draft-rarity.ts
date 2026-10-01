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
 * The titolarità words as one ladder, best highest. ONE LADDER since 01/10/2026 (operator: «dobbiamo uniformare
 * i gradini nelle varie formule e nelle varie etichette altrimenti ci confondiamo»): the press survey writes the
 * project's own words, and the two it wrote before - `titolarissimo`, `comprimario` - are kept only as aliases
 * for a file or pack that still carries them, on the rung each converged into (`bandiera`, `panchina`).
 * `scarto` is the press's word under `riserva`, kept apart because it is measured apart (1 vote of 38 against
 * 10). One definition for the list's sort, its filter and the rung reading of RAR.
 */
export const RUNG_RANK: Record<string, number> = {
  bandiera: 6,
  titolarissimo: 6,
  titolare: 5,
  ballottaggio: 4,
  panchina: 3,
  comprimario: 3,
  riserva: 2,
  scarto: 1,
};

/** The retired words of the press survey, on the word they converged into (01/10/2026). */
export const RETIRED_RUNGS: Readonly<Record<string, string>> = { titolarissimo: 'bandiera', comprimario: 'panchina' };

/** A titolarità word as the app SHOWS it: a retired one reads as the word it became, anything else as itself. */
export function shownRung(word: string | null | undefined): string | null {
  return word ? (RETIRED_RUNGS[word] ?? word) : null;
}

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
  /**
   * WHAT HE ADDS TO MY SQUAD, the «+Rosa» column (operator, 01/10/2026: «il fattore RAR adesso valutalo su +ROSA»):
   * fertility in points per matchday and coverage in places (`draft-pitch.addedYield`). Where it is present it is the
   * ONLY thing RAR compares - the six readings stay for a table where I follow no squad. Fertility null = unknown.
   */
  rosa?: { fertility: number | null; cover: number } | null;
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

const HIGHER: readonly (keyof Omit<RarityMan, 'id' | 'group' | 'fragility' | 'rosa'>)[] = ['rung', 'steady', 'mv', 'bonus', 'share'];

type Reading = (typeof HIGHER)[number] | 'fragility';
const READINGS: readonly Reading[] = [...HIGHER, 'fragility'];

/**
 * «Pari (simile)» ON +ROSA, DECLARED like the six above: five hundredths of a point per matchday of fertility (the
 * unit the column prints in, and half the bonus tolerance on a full-time man's 80% cover) and five points of a place
 * of coverage.
 */
export const ROSA_TOLERANCE = { fertility: 0.05, cover: 0.05 } as const;

/** Whether `other` adds my squad at least as much as `man` on +Rosa: fertility, then coverage, both with tolerance. */
function rosaAtLeast(other: RarityMan, man: RarityMan): boolean {
  const mine = man.rosa!;
  const theirs = other.rosa;
  if (!theirs) return false;
  if (mine.fertility != null && (theirs.fertility == null || theirs.fertility < mine.fertility - ROSA_TOLERANCE.fertility)) {
    return false;
  }
  return theirs.cover >= mine.cover - ROSA_TOLERANCE.cover;
}

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
  if (man.rosa) return rosaAtLeast(other, man);
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
  /**
   * Up to `RARITY_SIMILAR` of the men counted who are SIMILAR and not better (operator, 01/10/2026: «solo 3 simili
   * (non superiori)»): within the tolerance on both sides, the closest first. Who the tooltip names.
   */
  similar?: number[];
}

/** How many of the men counted the RAR tooltip names. */
export const RARITY_SIMILAR = 3;

/**
 * How far `other` is from `man`, and null when he is better beyond the tolerance (not «similar»): on +Rosa where `man`
 * has it, else on the six readings. The distance is in tolerances, so the readings add up in one unit.
 */
function similarity(other: RarityMan, man: RarityMan): number | null {
  if (man.rosa && other.rosa) {
    const parts: [number | null, number | null, number][] = [
      [man.rosa.fertility, other.rosa.fertility, ROSA_TOLERANCE.fertility],
      [man.rosa.cover, other.rosa.cover, ROSA_TOLERANCE.cover],
    ];
    return distance(parts);
  }
  return distance(READINGS.map((key) => [man[key], other[key], RARITY_TOLERANCE[key] || 1]));
}

function distance(parts: readonly [number | null, number | null, number][]): number | null {
  let sum = 0;
  for (const [mine, theirs, tolerance] of parts) {
    if (mine == null || theirs == null) continue;
    const steps = Math.abs(theirs - mine) / tolerance;
    if (steps > 1 + 1e-9) return null;
    sum += steps;
  }
  return sum;
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
      const counted = men.filter((other) => other.id !== man.id && atLeastAsGood(other, man, means));
      const similar = counted
        .map((other) => ({ id: other.id, far: similarity(other, man) }))
        .filter((one): one is { id: number; far: number } => one.far != null)
        .sort((a, b) => a.far - b.far)
        .slice(0, RARITY_SIMILAR)
        .map((one) => one.id);
      out.set(man.id, { count: counted.length, of: men.length - 1, similar });
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
