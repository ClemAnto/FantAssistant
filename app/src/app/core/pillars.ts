/**
 * I PILASTRI (operatore, 22/10/2026): «dobbiamo schierare sempre chi sappiamo per assodato che sono degli ottimi
 * calciatori: Kane, Rice, Grimaldo, Gvardiol ... sono dei pilastri e solo una striscia di brutte partite potrebbe
 * metterne in dubbio la titolarità». A pillar is a CONSTRAINT on the lineup, not a weight: an available pillar is
 * fielded first (`lineup-advice.PILLAR_PRIORITY`), and the FVA decides only among the places he leaves.
 *
 * WHAT DECIDES IT is his own measured football and nothing else - the FVM was tried first and kept out by the
 * operator («valutiamo piuttosto la costanza, la media voto, la frequenza di bonus, la titolarità»):
 *   - the window is the last season plus this one, every club he played for: this platform's votes first, the other
 *     platform's for the clubs this one does not vote (Hojlund at United, Malen at Villa), never a synthetic vote;
 *   - costanza = share of base votes of at least 6; media voto; and the BONUS VALUE per match (fantamedia minus
 *     media voto), not their frequency, because a goal is 3 and an assist 1 - frequency could not tell Rabiot (10
 *     goals, 7 assists) from Barella (4 and 11), and the operator ruled the first a pillar and the second not;
 *   - a keeper is judged on his FANTAMEDIA, because his media voto ignores the goals conceded (Caprile 6.42 and
 *     Falcone 6.40 read higher than Svilar 6.30, and concede 1.3-1.4 a match);
 *   - the titolarità is the sheet's rung (`desc_titolarita`), which counts the matches he was FIT for: a share of
 *     the club's calendar read Gvardiol at 0.51 and Malen at 0.46, i.e. an injury or a January arrival as a bench.
 *
 * THE THRESHOLDS ARE DECLARED, tuned by hand on the operator's own verdicts (22/10/2026): 15 «yes» and 29 «no» over
 * the two platforms, every one of them reproduced. They are per PLATFORM because EuroLeghe fields only top clubs and
 * its regulars read higher (Sorloth, Doku and Leweling clear the Serie A bars), and in a MANTRA game the midfield is
 * split by Mantra role, because a mediano scores fewer bonuses by trade: Rice (M, bonus 0.50) is a pillar, Pedri,
 * Atta and Da Cunha (C;T, 0.46-0.50) are not. No gate owns these numbers: they choose nothing the engine predicts.
 */

export type PillarRole = 'P' | 'D' | 'C' | 'A';
export type PillarPlatform = 'default' | 'euro';

interface Bars {
  /** Media voto, or for a keeper the fantamedia. */
  level: number;
  steady: number;
  /** Bonus value per match (fantamedia - media voto); absent = not asked. */
  bonus?: number;
  /** A Mantra mediano's own bonus bar, where it differs. */
  medianoBonus?: number;
}

export const PILLAR_BARS: Record<PillarPlatform, Record<PillarRole, Bars>> = {
  default: {
    P: { level: 5.4, steady: 0.85 },
    D: { level: 6.15, steady: 0.7 },
    C: { level: 6.05, steady: 0.65, bonus: 0.6 },
    A: { level: 6.1, steady: 0.56, bonus: 0.85 },
  },
  euro: {
    P: { level: 5.4, steady: 0.85 },
    D: { level: 6.15, steady: 0.7 },
    C: { level: 6.3, steady: 0.76, bonus: 0.55, medianoBonus: 0.45 },
    A: { level: 6.25, steady: 0.65, bonus: 1.4 },
  },
};

/** Fewer votes than this over the window is too short a record to call anybody «assodato» (Holm 17, Gvardiol 19). */
export const PILLAR_MIN_VOTES = 18;
/** The rungs that say «the eleven fields him»; a keeper must OWN the shirt, since one of a club plays. */
const RUNGS = ['bandiera', 'titolare', 'ballottaggio'];
const KEEPER_RUNGS = ['bandiera', 'titolare'];

/** «Solo una striscia di brutte partite»: of his last `STREAK_OF` voted matches, `STREAK_BAD` under the 6. */
export const STREAK_OF = 4;
export const STREAK_BAD = 3;

export interface PillarCell {
  vote: number;
  fantavoto: number;
  date: string | null;
}

export interface PillarRecord {
  votes: number;
  mv: number;
  fm: number;
  steady: number;
  bonus: number;
  /** True when his last matches are the bad streak that suspends a pillar. */
  streak: boolean;
}

export function pillarRecord(cells: readonly PillarCell[]): PillarRecord | null {
  if (!cells.length) return null;
  const n = cells.length;
  const mv = cells.reduce((sum, one) => sum + one.vote, 0) / n;
  const fm = cells.reduce((sum, one) => sum + one.fantavoto, 0) / n;
  const steady = cells.filter((one) => one.vote >= 6).length / n;
  const last = [...cells].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, STREAK_OF);
  const streak = last.length === STREAK_OF && last.filter((one) => one.vote < 6).length >= STREAK_BAD;
  return { votes: n, mv, fm, steady, bonus: fm - mv, streak };
}

export type PillarState = 'pillar' | 'suspended' | null;

/**
 * Is he a pillar this matchday? `mediano` = his first Mantra role is M (only read on a Mantra game). A man who
 * meets every bar but is in the bad streak is `suspended`: he goes back to the FVA like everybody else.
 */
export function pillarState(
  record: PillarRecord | null,
  role: PillarRole | null,
  platform: PillarPlatform,
  rung: string | null,
  mediano: boolean,
): PillarState {
  if (!record || !role || record.votes < PILLAR_MIN_VOTES) return null;
  if (!(role === 'P' ? KEEPER_RUNGS : RUNGS).includes(rung ?? '')) return null;
  const bars = PILLAR_BARS[platform][role];
  const level = role === 'P' ? record.fm : record.mv;
  const bonusBar = mediano && bars.medianoBonus !== undefined ? bars.medianoBonus : bars.bonus;
  if (level < bars.level || record.steady < bars.steady) return null;
  if (bonusBar !== undefined && record.bonus < bonusBar) return null;
  return record.streak ? 'suspended' : 'pillar';
}
