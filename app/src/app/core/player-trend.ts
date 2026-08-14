/**
 * The last ten CHAMPIONSHIP matches of a player's club, as the sheet's `desc_trend_detail` carries them.
 *
 * WHY THE WINDOW IS THE CHAMPIONSHIP and not «the last ten matches»: the EuroLeghe calendar skips 3 to 7
 * real rounds of each league every season, so a man read on his euro fantamedia alone is read on about
 * 82% of the football he played (measured 14/08/2026, `matchdays`). Those rounds are still in the
 * per-match layer, they still have a calibrated base voto, and the strip marks them - that is the whole
 * reason this window exists beside `desc_form_*`, which walks every competition, friendlies included.
 *
 * NOTHING IS COMPUTED HERE. The toolkit builds the record (`snapshot.trend_block`) because it is a
 * MEASUREMENT - which vote a match had, whether the game scored it, whether he was on the bench - and a
 * measurement lives where measurements are made and judged. This file parses it and ranks it, so the app
 * and the operator panel draw one picture and not two that drift.
 */

/** What happened to a man in one match. `p` he played · `b` named on the bench and never used ·
 *  `i` injured · `s` suspended · `o` not in the squad · `n` no player-level data · `x` in the eleven of
 *  a match with no statistics at all. Four of them are absences and each is a different fact. */
export type TrendState = 'p' | 'b' | 'i' | 's' | 'o' | 'n' | 'x';

/** Where the voto comes from. `real` is the game's own; `synth` is the calibrated base voto for a round
 *  the euro calendar skipped - the same number, on the same scale, from a line fitted on the overlap. */
export type VoteSource = 'real' | 'synth' | null;

export interface TrendMatch {
  date: string;
  competition: string;
  opponent: string;
  home: boolean;
  state: TrendState;
  minutes: number | null;
  started: boolean;
  vote: number | null;
  voteSource: VoteSource;
  /** The fantapunti of that match. Null where nobody could score it - never a zero. */
  points: number | null;
  goals: number;
  assists: number;
  /** Only a really voted match carries them: the per-match layer has no bookings at all. */
  yellows: number | null;
  reds: number | null;
  /** The second layer. Null where the provider served no xG for that season, 0 where he did not shoot. */
  xga: number | null;
  /** False = the EuroLeghe calendar never counted this round. Null where no map exists for the season. */
  inEuro: boolean | null;
}

export interface PlayerTrend {
  matches: TrendMatch[];
  /** Mean fantapunti over the window: a match he did not play counts 0, one nobody can score is out. */
  fp: number | null;
  /** How many entered that mean, so a mean over three never reads as a mean over ten. */
  scored: number;
  window: number;
  played: number;
  bench: number;
  /** How many of the ten the euro calendar never counted. */
  outsideEuro: number;
}

const ABSENT: ReadonlySet<TrendState> = new Set<TrendState>(['b', 'i', 's', 'o']);

/** Is this a match he did not play, for a reason we actually know? Those count ZERO in the mean. */
export function isKnownAbsence(state: TrendState): boolean {
  return ABSENT.has(state);
}

function num(value: string): number | null {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One `desc_trend_detail` string into its matches, oldest first - the order the toolkit wrote them in.
 *
 * A record shorter than the sixteen fields is a sheet older than the column: it is skipped rather than
 * padded, because a padded record would silently claim a vote of zero and a round inside the calendar.
 */
export function parseTrend(detail: string | null | undefined): TrendMatch[] {
  if (!detail) return [];
  const out: TrendMatch[] = [];
  for (const line of detail.split(';')) {
    if (!line) continue;
    const f = line.split('|');
    if (f.length < 16) continue;
    out.push({
      date: f[0],
      competition: f[1],
      opponent: f[2],
      home: f[3] === 'H',
      state: (f[4] || 'n') as TrendState,
      minutes: num(f[5]),
      started: f[6] === '1',
      vote: num(f[7]),
      voteSource: (f[8] || null) as VoteSource,
      points: num(f[9]),
      goals: num(f[10]) ?? 0,
      assists: num(f[11]) ?? 0,
      yellows: num(f[12]),
      reds: num(f[13]),
      xga: num(f[14]),
      inEuro: f[15] === '' ? null : f[15] === '1',
    });
  }
  return out;
}

/**
 * The 0-99 of a trend, inside a POOL that has to be stated: the same role, on the list being played.
 *
 * «He is going well» is a sentence relative to what his role can produce - a forward's ten matches are
 * worth more fantapunti than a defender's by construction - so one pool for everybody would rank the
 * roles and call it form. Linear against the best of the role, which is the scale `score99` already uses
 * for the value, so twice the fantapunti reads as twice the score.
 *
 * IT IS A DESCRIPTION AND NOT A FORECAST. Measured 14/08/2026 over ~65,000 windows against the reshuffled
 * null, a player's departure from his own averages does not predict his next rounds: the true excess is
 * +0.0167 / +0.0072 / -0.0007 at two, three and five matchdays and it changes SIGN. Ordering by it
 * answers «what has he done», which is legitimate and fast; selling it as «what will he do» would be the
 * third refused form of one idea. No valuation, no plan and no board reads it.
 */
export const MIN_TREND_POOL = 8;

export function trendScores(
  players: readonly { id: number; role: string | null; fp: number | null }[],
): Map<number, number> {
  const byRole = new Map<string, { id: number; fp: number }[]>();
  for (const man of players) {
    const role = (man.role ?? '').toUpperCase();
    if (!role || man.fp == null) continue;
    const group = byRole.get(role);
    if (group) group.push({ id: man.id, fp: man.fp });
    else byRole.set(role, [{ id: man.id, fp: man.fp }]);
  }
  const out = new Map<number, number>();
  for (const group of byRole.values()) {
    if (group.length < MIN_TREND_POOL) continue; // a 0-99 read against two men says nothing
    const top = Math.max(...group.map((man) => man.fp));
    if (top <= 0) continue;
    for (const man of group) {
      out.set(man.id, Math.max(0, Math.min(99, Math.round((man.fp / top) * 99))));
    }
  }
  return out;
}
