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

/** The lines a pitch draws, from the GOAL down to the attack: the keeper at the top. */
export type PitchLine = 'A' | 'T' | 'M' | 'D' | 'P';

/**
 * The order the rows are drawn in, and it is the operator's (10/08/2026): the keeper at the TOP and the
 * forwards at the bottom - the team attacking downward, the way he reads a formation.
 *
 * It is only the drawing. The module's numbers are unchanged and still count from the defence up (`4-3-3` is
 * four defenders, three midfielders, three forwards, keeper never one of them): `lineCounts` reads the string,
 * this decides which end of the page each line lands on.
 */
export const DRAW_ORDER: PitchLine[] = ['P', 'D', 'M', 'T', 'A'];

export interface PitchMan {
  fcId: number | null;
  name: string;
  /** The granular REAL role codes, which is what says a left back is not a centre back. */
  codes: string[];
  /** The LISTONE's own role(s): what the game scores by, and what a bid is made against. */
  mantra: string[];
  /**
   * The ONE role he wears in this module, named by the panel (`Td`, `Dc`, `C`, `Pc`, ...).
   *
   * This is what the pitch shows, and showing his whole code list instead was the operator's correction of
   * 10/08/2026: a man drawn at right back is a `Td` there, and printing `DR;DC` says two jobs where the
   * module gave him one. Null on a board built before the marker travelled.
   */
  badge: string | null;
  /** The season's total minutes, on his own championship's calendar. Kept for the tooltip. */
  minutes: number | null;
  /** The matches he PLAYED, which is the denominator of the average below. */
  matches: number | null;
  /**
   * MINUTI MEDI A PARTITA, and this is the number the pitch shows (operator, 10/08/2026): minutes over the
   * matches he played, so «gioca poco» reads as «45′» and not as a season total nobody can compare at a
   * glance. Null when either half is missing - unknown, never zero.
   */
  perMatch: number | null;
  /**
   * A DIFFERENT quantity, and the two must not be confused: the sheet's own `minutes per club match` over the
   * last-ten window, which divides by the CLUB's matches and therefore folds absences in (Di Lorenzo 44.7
   * against 88 of the season average). It stays in the tooltip, labelled, and never on the chip.
   */
  minutesPerClubMatch: number | null;
  /** The panel's own claim: who starts when everybody is fit. It is what put him on the pitch. */
  claim: number | null;
  /** Where the panel draws him across the line: 0 is one touchline, 1 the other. Flanks already ordered. */
  x: number;
  /** Already off the board at this table. */
  taken: boolean;
  /** What the table asks for him, from the LIVE listone - the board does not carry a price. */
  price: number | null;
  /** In the live listone at all: a man the board draws and the session does not have cannot be bought. */
  onTable: boolean;
  /** The 0-99 worth, on the scale of the whole session listone so it means one thing all evening. */
  value99: number | null;
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

/** What the live table knows about a man the board drew: whether he is gone, what he costs, what he is worth. */
export interface OnTable {
  taken: boolean;
  price: number | null;
  onTable: boolean;
  /** His worth on the 0-99 scale of THIS session's listone. Null when the sheet cannot price him. */
  value99: number | null;
}

function toMan(man: BoardMan, resolve: (man: BoardMan) => OnTable): PitchMan {
  const live = resolve(man);
  return {
    fcId: man.fc_id ?? null,
    name: man.name ?? '—',
    codes: (man.codes ?? '').split(';').map((code) => code.trim()).filter(Boolean),
    mantra: (man.mantra ?? '').split(';').map((code) => code.trim()).filter(Boolean),
    badge: man.badge ?? null,
    minutes: int(man.minutes),
    matches: int(man.matches),
    perMatch: (() => {
      const minutes = int(man.minutes);
      const matches = int(man.matches);
      return minutes != null && matches ? Math.round(minutes / matches) : null;
    })(),
    minutesPerClubMatch: man.minutes_per_match != null && man.minutes_per_match !== ''
      ? Number(man.minutes_per_match) : null,
    claim: man.claim ?? null,
    x: typeof man.x === 'number' ? man.x : 0.5,
    taken: live.taken,
    price: live.price,
    onTable: live.onTable,
    value99: live.value99,
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
