/**
 * THE EXPECTED-APPEARANCES TEST (30/09/2026, `toolkit/scripts/presence_test/build.py`): the season of every man
 * split into the reasons he did or did not get a vote, the formula rebuilt from those parts, and the engine's own
 * pre-season number beside it, both judged on what he really played.
 *
 * The app READS it and computes nothing that the toolkit did not: the only arithmetic here is the error columns
 * (a subtraction of two numbers the file carries) and the order of the rows. A second computation of `Pa` in the
 * browser would be a second definition of the number the page exists to check.
 */

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
}

export interface PresenceTestRow {
  window: 'T1' | 'T2';
  target: string;
  fcId: number;
  name: string;
  role: string | null;
  context: string;
  clubChange: boolean;
  europeIn: boolean;
  europeOut: boolean;
  mv: number | null;
  prev: PresenceSeason | null;
  prev2: Pick<PresenceSeason, 'n' | 'inj' | 'susp' | 'other'> | null;
  d: number | null;
  s: number | null;
  paFormula: number;
  paEngine: number | null;
  paActual: number;
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
}

export interface PresenceTestFile {
  generated_at: string;
  formula: string;
  params: Record<string, number>;
  priors: Record<string, number>;
  summary: Record<'T1' | 'T2', PresenceTestSummary>;
  rows: PresenceTestRow[];
}

/** A row with the two errors the page ranks and colours by: predicted minus real, signed. */
export interface PresenceTestView extends PresenceTestRow {
  errFormula: number;
  errEngine: number | null;
}

export type PresenceSort =
  | 'name' | 'paActual' | 'paFormula' | 'paEngine' | 'errFormula' | 'errEngine' | 'gain' | 'd' | 's';

/**
 * The rows of one window, filtered by name and role and sorted. `gain` is how much closer the formula got than the
 * engine (|engine error| - |formula error|): positive is the formula's win. A man the engine does not price has no
 * gain and no engine error, and sorts last rather than as a zero.
 */
export function presenceRows(
  file: PresenceTestFile,
  window: 'T1' | 'T2',
  opts: { query?: (row: PresenceTestRow) => boolean; role?: string | null; sort: PresenceSort; descending: boolean },
): PresenceTestView[] {
  const rows: PresenceTestView[] = file.rows
    .filter((row) => row.window === window)
    .filter((row) => !opts.role || row.role === opts.role)
    .filter((row) => !opts.query || opts.query(row))
    .map((row) => ({
      ...row,
      errFormula: round1(row.paFormula - row.paActual),
      errEngine: row.paEngine == null ? null : round1(row.paEngine - row.paActual),
    }));
  const key = (row: PresenceTestView): number | string | null => {
    switch (opts.sort) {
      case 'name': return row.name;
      case 'errFormula': return Math.abs(row.errFormula);
      case 'errEngine': return row.errEngine == null ? null : Math.abs(row.errEngine);
      case 'gain': return row.errEngine == null ? null : Math.abs(row.errEngine) - Math.abs(row.errFormula);
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
    return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * sign;
  });
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
