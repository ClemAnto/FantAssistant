/**
 * THE EXPECTED-APPEARANCES TEST (30/09/2026, `toolkit/scripts/presence_test/build.py`): the season of every man
 * split into the reasons he did or did not get a vote, the formula rebuilt from those parts, and the engine's own
 * pre-season number beside it, both judged on what he really played.
 *
 * The app READS it and computes nothing that the toolkit did not: the only arithmetic here is the error columns
 * (a subtraction of two numbers the file carries) and the order of the rows. A second computation of `Pa` in the
 * browser would be a second definition of the number the page exists to check.
 */

import { titolaritaRank } from './titolarita';

export interface PresenceSeason {
  /** Club league games while he was there, and what each one was for him. */
  n: number;
  inj: number;
  susp: number;
  other: number;
  out: number;
  bench: number;
  sub: number;
  start: number;
  minutes: number;
  /** Of `other`, the games he missed with his national team (v2). */
  naz?: number;
}

export interface PresenceTestRow {
  /** The gate's window key (Tm7 ... T2): every one of them judged with parameters fitted on the other nine. */
  window: string;
  target: string;
  fcId: number;
  name: string;
  role: string | null;
  context: string;
  clubChange: boolean;
  /** His club in the season measured and in the season predicted (the gate's own `club_prev` / `club_target`). */
  clubPrev?: string | null;
  clubNext?: string | null;
  europeIn: boolean;
  europeOut: boolean;
  mv: number | null;
  prev: PresenceSeason | null;
  prev2: Pick<PresenceSeason, 'n' | 'inj' | 'susp' | 'other'> | null;
  /** The season predicted as it went: league games missed injured, banned, away with the national team. */
  next?: { n: number; inj: number; susp: number; naz: number } | null;
  d: number | null;
  s: number | null;
  /**
   * The six-word ladder (`engine/status.py`) derived by the TOOLKIT from the formula's S and the minutes of the
   * season measured, without the board's gate (a past window has no drawn board) - and the rung he really
   * reached in the season predicted, on the same two axes. Absent on a v1 file.
   */
  rung?: string | null;
  rungActual?: string | null;
  paFormula: number;
  paEngine: number | null;
  paActual: number;
  /** One of the varied sample the page shows (up to two per role x context x band of real appearances). */
  sample: boolean;
}

export interface PresenceTestSummary {
  target: string;
  fitted_on: string;
  out_of_sample: boolean;
  n: number;
  mae_formula: number;
  mae_engine: number;
  median_formula: number;
  median_engine: number;
  /** Predicted over real, median, and the share of men within 80%-125% of what they really played. */
  median_ratio_formula: number;
  median_ratio_engine: number;
  within20_formula: number;
  within20_engine: number;
  /** Men who played nothing: they have no ratio, any prediction over zero is infinitely off. */
  zero_actual: number;
}

export interface PresenceTestFile {
  generated_at: string;
  formula: string;
  params: Record<string, number>;
  priors: Record<string, number>;
  /** Keyed by window. v1 carried T1 and T2 only, v2 every pre-season window of the gate. */
  summary: Record<string, PresenceTestSummary>;
  /** v2: how the formula was judged, and its verdict over the windows in the gate's own vocabulary. */
  protocol?: string;
  verdict?: Record<string, PresenceVerdict>;
  inseason?: { k_rule: string | null; k: number | null; verdict: PresenceVerdict | null };
  rows: PresenceTestRow[];
}

export interface PresenceVerdict {
  windows: number;
  wins: number;
  mean_gain: number;
  worst: number;
  strict: boolean;
  robust: boolean;
}

/**
 * A row with the two RATIOS the page is judged by (operator, 30/09/2026): predicted over real. 100% exact, 50% he
 * played twice what was expected, 200% he played half. Null for a man who played nothing.
 */
export interface PresenceTestView extends PresenceTestRow {
  ratioFormula: number | null;
  ratioEngine: number | null;
}

export type PresenceSort =
  | 'name' | 'paActual' | 'paFormula' | 'paEngine' | 'ratioFormula' | 'ratioEngine' | 'd' | 's' | 'rung' | 'rungActual';

/** Predicted over real, or null where he played nothing. */
export function ratioOf(predicted: number | null, actual: number): number | null {
  return predicted == null || actual <= 0 ? null : predicted / actual;
}

/** How far a ratio is from 100%, symmetric: 50% and 200% are the same distance (|ln|). */
export function distanceOf(ratio: number | null): number | null {
  return ratio == null || ratio <= 0 ? (ratio === 0 ? Infinity : null) : Math.abs(Math.log(ratio));
}

/**
 * The rows of one window - the sample only, unless asked - filtered by name and role and sorted. On a ratio column
 * the order is the DISTANCE from 100%, so the closest come first ascending; a man with no ratio sorts last.
 */
export function presenceRows(
  file: PresenceTestFile,
  window: string,
  opts: {
    query?: (row: PresenceTestRow) => boolean;
    role?: string | null;
    sort: PresenceSort;
    descending: boolean;
    all?: boolean;
  },
): PresenceTestView[] {
  const rows: PresenceTestView[] = file.rows
    .filter((row) => row.window === window && (opts.all || row.sample))
    .filter((row) => !opts.role || row.role === opts.role)
    .filter((row) => !opts.query || opts.query(row))
    .map((row) => ({
      ...row,
      ratioFormula: ratioOf(row.paFormula, row.paActual),
      ratioEngine: ratioOf(row.paEngine, row.paActual),
    }));
  const key = (row: PresenceTestView): number | string | null => {
    switch (opts.sort) {
      case 'name': return row.name;
      case 'ratioFormula': return distanceOf(row.ratioFormula);
      case 'ratioEngine': return distanceOf(row.ratioEngine);
      // The ladder's order, not the alphabet (`titolaritaRank`); an unknown rung sorts last.
      case 'rung': return titolaritaRank(row.rung);
      case 'rungActual': return titolaritaRank(row.rungActual);
      default: return row[opts.sort];
    }
  };
  const sign = opts.descending ? -1 : 1;
  return rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    // Two predictions of zero are both infinitely far: equal, not NaN (which leaves Array.sort inconsistent).
    if (x === y) return 0;
    return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * sign;
  });
}
