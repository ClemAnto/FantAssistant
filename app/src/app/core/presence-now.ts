/**
 * THE NEW FORMULA'S Pa FOR TODAY (operator, 01/10/2026: «la colonna Pa - partite attese, nuova formula - dopo la
 * colonna SeSw in draft»), written by `toolkit/scripts/presence_test/now.py`: the decomposed formula of
 * `partite-attese-scomposte-v1.md` with the bench's September reading, on the season in progress.
 *
 * The app computes nothing the toolkit did not: it reads the SHARE of the rounds left and puts it on a full season,
 * like every other number in matchdays (`season-scale.ts`). Two limits travel with it and the column says them:
 * the formula is not gated (R33 failed on all quoted men; R33b is judged forward on this season), and it is
 * measured on Serie A only - a man the file does not carry is a dash, never a zero.
 */

export interface PresenceNowRow {
  fcId: number;
  name: string;
  role: string | null;
  context: string;
  /** Appearances with a vote over the rounds LEFT (`rounds` in the file). */
  pa: number;
  /** `pa` over the rounds left: the reading that does not depend on the calendar. */
  share: number | null;
  seenVotes: number | null;
  outOpen: number;
}

export interface PresenceNowFile {
  generated_at: string;
  formula: string;
  platform: string;
  input: string;
  target: string;
  auction: string;
  seen: number;
  rounds: number;
  k: number;
  gated: boolean;
  rows: PresenceNowRow[];
}

/** fc_id -> share of the rounds left. Empty for a missing file: nobody ran the script. */
export function presenceNowShares(file: PresenceNowFile | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of file?.rows ?? []) {
    if (row.share != null && Number.isFinite(row.share)) out.set(row.fcId, row.share);
  }
  return out;
}

/**
 * fc_id -> the rounds left the formula already took off for an OPEN stop (`outOpen`), where it took any: a reader that
 * prices the stop itself on a narrower window must give these back first, or it charges the same weeks twice.
 */
export function presenceNowOut(file: PresenceNowFile | null): { rounds: number; out: Map<number, number> } {
  const out = new Map<number, number>();
  for (const row of file?.rows ?? []) if (row.outOpen > 0) out.set(row.fcId, row.outOpen);
  return { rounds: file?.rounds ?? 0, out };
}

/** The share on a full season of `seasonRounds` matchdays (the platform's, not the number 38); null = unknown. */
export function paOnSeason(share: number | null | undefined, seasonRounds: number | null | undefined): number | null {
  if (share == null || !seasonRounds || seasonRounds <= 0) return null;
  return Math.round(Math.min(1, Math.max(0, share)) * seasonRounds * 10) / 10;
}
