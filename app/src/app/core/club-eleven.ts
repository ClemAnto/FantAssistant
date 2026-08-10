/**
 * A real club's eleven, read from the board the TOOLKIT drew - not computed here.
 *
 * The board comes from `modules/boards.py`, which drives the panel's own class headless and calls the real
 * `board_shape` / `eleven` / `lanes_for` / `_placed`, with the operator's shape rulings applied. So the pitch
 * in this app and the pitch on the panel are the same call: there is no second eleven anywhere, which is the
 * whole point - the 08/08/2026 defect was a harness whose population differed from the screen's.
 *
 * What this file does is only READING it: turn the module's numbers into rows, join each man to the live
 * listone (so a man already taken can be faded), and report where the two disagree instead of hiding it.
 *
 * THE MODULE IS THE DRAWING, and it is the operator's own rule (10/08/2026): every number is how many men
 * stand on that line; the keeper is never one of them and always occupies one slot in front of the defence;
 * three numbers are defence / midfield / attack; four are defence / midfield / TREQUARTI / attack, and the
 * last is always the attack.
 */

import { Board, BoardMan } from './bundle';

/** The lines a pitch draws, from the attack down to the goal. */
export type PitchLine = 'A' | 'T' | 'M' | 'D' | 'P';

export const DRAW_ORDER: PitchLine[] = ['A', 'T', 'M', 'D', 'P'];

export interface PitchMan {
  fcId: number | null;
  name: string;
  /** The granular REAL role codes, which is what says a left back is not a centre back. */
  codes: string[];
  minutes: number | null;
  matches: number | null;
  minutesPerMatch: number | null;
  /** The panel's own claim: who starts when everybody is fit. It is what put him on the pitch. */
  claim: number | null;
  /** Where the panel draws him: 0 is the team's right touchline, 1 its left. Flanks already ordered. */
  x: number;
  /** Already off the board at this table. */
  taken: boolean;
  /** What the table asks for him, from the LIVE listone - the board does not carry a price. */
  price: number | null;
  /** In the live listone at all: a man the board draws and the session does not have cannot be bought. */
  onTable: boolean;
  /** At most two, in the panel's own order. */
  duels: PitchMan[];
  /** False when his granular real role is unknown: then the duels are UNKNOWN, not absent. */
  duelsKnown: boolean;
}

export interface PitchRow {
  line: PitchLine;
  /** How many men the MODULE puts on this line. */
  wanted: number;
  men: PitchMan[];
}

export interface Pitch {
  /** The module the drawn men actually form - the numbers this pitch is built from. */
  module: string;
  /** The module the fit was solved on, when it differs: a transformation split a row. */
  solvedOn: string | null;
  /** What the club usually plays, and how likely the drawn one was, so the picture can be doubted. */
  typical: string | null;
  coach: string | null;
  newCoach: boolean;
  why: string | null;
  odds: { shape: string; p: number }[];
  rows: PitchRow[];
  taken: number;
  /** Where the module's numbers and the drawn men disagree. Shown, never smoothed over. */
  problems: string[];
}

/**
 * The module's numbers as the LINES they are, keeper excluded.
 *
 * The same function exists in the toolkit (`boards.counts_of`) because both sides have to agree on what a
 * module string means; they are checked against each other by the fact that a mismatch is REPORTED - if the
 * two ever read a string differently, `problems` says so on the club it happens to.
 */
export function lineCounts(picture: string | null | undefined): Record<PitchLine, number> | null {
  if (!picture) return null;
  const numbers = String(picture)
    .split('-')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .map((part) => Number(part));
  if (numbers.length === 3) {
    return { P: 1, D: numbers[0], M: numbers[1], T: 0, A: numbers[2] };
  }
  if (numbers.length === 4) {
    return { P: 1, D: numbers[0], M: numbers[1], T: numbers[2], A: numbers[3] };
  }
  return null;
}

const int = (value: string | null | undefined): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** What the live table knows about a man the board drew: whether he is gone, and what he costs. */
export interface OnTable {
  taken: boolean;
  price: number | null;
  onTable: boolean;
}

function toMan(man: BoardMan, resolve: (man: BoardMan) => OnTable): PitchMan {
  const live = resolve(man);
  return {
    fcId: man.fc_id ?? null,
    name: man.name ?? '—',
    codes: (man.codes ?? '').split(';').map((code) => code.trim()).filter(Boolean),
    minutes: int(man.minutes),
    matches: int(man.matches),
    minutesPerMatch: int(man.minutes_per_match) ?? (man.minutes_per_match
      ? Number(man.minutes_per_match) : null),
    claim: man.claim ?? null,
    x: typeof man.x === 'number' ? man.x : 0.5,
    taken: live.taken,
    price: live.price,
    onTable: live.onTable,
    duels: (man.duels ?? []).map((rival) => toMan(rival, resolve)),
    duelsKnown: man.duels_known !== false,
  };
}

/**
 * The pitch of one board: rows from the module's numbers, men where the panel puts them.
 *
 * A row is drawn even when the board placed FEWER men on it than the module asks for - the gap is the
 * information (an empty flank reads as a gap, which is exactly what the panel's own geometry is for), and
 * `problems` names it. Filling it would be inventing a man the toolkit did not place.
 */
export function pitchOf(board: Board | null, resolve: (man: BoardMan) => OnTable): Pitch | null {
  if (!board || board.error) return null;
  const module = board.picture ?? board.board_shape ?? null;
  const counts = lineCounts(module);
  if (!counts || !board.lines) return null;

  const rows: PitchRow[] = [];
  const problems: string[] = [];
  let taken = 0;
  for (const line of DRAW_ORDER) {
    const wanted = counts[line] ?? 0;
    const drawn = (board.lines[line] ?? []).map((man) => toMan(man, resolve));
    if (!wanted && !drawn.length) continue;
    if (wanted !== drawn.length) {
      problems.push(`linea ${line}: il modulo dice ${wanted}, i disegnati sono ${drawn.length}`);
    }
    taken += drawn.filter((man) => man.taken).length;
    // ORDERED by the panel's own x and then spread evenly on the row, instead of placed at that x.
    // The order is the information a pitch can keep on a phone - it is the team's right to its left, flanks
    // already resolved by `_placed` - while the exact coordinate is not: four chips at their true x overlap
    // on a narrow screen, and a row nobody can read says less than a tidy one. A line the module says is
    // fuller than the drawn men still reports the gap (`problems`), which is what the empty space said.
    rows.push({ line, wanted, men: [...drawn].sort((left, right) => left.x - right.x) });
  }

  const solved = board.board_shape ?? null;
  return {
    module: module ?? '',
    solvedOn: solved && solved !== module ? solved : null,
    typical: board.formation_typical ?? null,
    coach: board.coach ?? null,
    // `'yes'` / `'no'`, as the sheet's own column spells it - and NOT `Boolean(...)`, which reads `'no'` as
    // true and would have called every coach new. The column that looks like a flag is a word.
    newCoach: String(board.new_coach ?? '').toLowerCase() === 'yes',
    why: board.why ?? null,
    odds: Object.entries(board.odds ?? {}).map(([shape, p]) => ({ shape, p })),
    rows,
    taken,
    problems,
  };
}
