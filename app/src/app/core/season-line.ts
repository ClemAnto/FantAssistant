import { BundleTable, columnIndex, optionalIndex } from './bundle';
import { Platform, competitionKind } from './players-store';

/**
 * ONE SEASON OF A PLAYER, as the bundle's own tables state it - read, never derived.
 *
 * It exists for the hover on the GAIN (the operator's request of 25/08/2026): a number that says «this
 * man is worth 21 points more than his replacement» is a CONCLUSION, and the first thing anybody asks
 * of a conclusion is what it was built on. So the popover puts last season and the season in progress
 * side by side, in the units the game itself uses.
 *
 * TWO SOURCES, because no single table has all of it, and each one is used for what it actually knows:
 *  - `season_stats` is the fantacalcio aggregate on THIS platform's calendar: appearances with a vote,
 *    media voto, fantamedia, goals, assists, and for a keeper the goals he let in and the sheets he
 *    kept clean. It is what the game scored, so it is the only honest source for anything scored.
 *  - `external_match_stats` is the per-match layer: minutes, xG and xA, which the votes Excel does not
 *    carry at all (`match_ratings.minutes` is NULL on all 263,393 rows - a declared absence, not a gap).
 *
 * LEAGUE MATCHES ONLY on the second one, and it is the same rule the whole project obeys: a share of a
 * season is a share of the CHAMPIONSHIP, so a friendly and a cup tie are not in the denominator of
 * «minuti per partita». `competitionKind` is the one definition of that, read here rather than copied.
 *
 * A ZERO IS NEVER INVENTED. A season the tables do not carry is absent from the map, and a metric no
 * row could fill stays null - «vuoto = ignoto, mai zero», applied to a screen that would otherwise say
 * «0 gol» about a man nobody has measured. It matters most for the season in progress: in August it is
 * empty by construction, and the popover has to say that rather than draw a row of zeros.
 */
export interface SeasonLine {
  season: string;
  /** Appearances WITH A VOTE, on this platform's calendar. */
  pv: number | null;
  mv: number | null;
  fm: number | null;
  /** Goals INCLUDING penalties scored: `goals` is net of them in the table, and a goal is a goal. */
  goals: number | null;
  assists: number | null;
  /** Keepers: what he let in, and how many matchdays he closed at zero. */
  conceded: number | null;
  cleanSheets: number | null;
  /** Minutes per APPEARANCE, over the league matches the per-match layer has him on the pitch for. */
  minutesPerMatch: number | null;
  /** ...and how many those matches were: a mean over three matches is not the same claim as over thirty. */
  matches: number;
  xg: number | null;
  xa: number | null;
}

const EMPTY = (season: string): SeasonLine => ({
  season,
  pv: null,
  mv: null,
  fm: null,
  goals: null,
  assists: null,
  conceded: null,
  cleanSheets: null,
  minutesPerMatch: null,
  matches: 0,
  xg: null,
  xa: null,
});

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Every player's line for the seasons asked for, on one platform.
 *
 * Two passes over two tables and nothing else: no valuation, no shrinkage, no anchor. Whatever the
 * screen shows here has to be a fact somebody can look up, or the popover would be explaining a number
 * with another number of ours.
 */
export function seasonLines(input: {
  seasonStats: BundleTable;
  matches: BundleTable;
  platform: Platform;
  seasons: readonly string[];
}): Map<number, Map<string, SeasonLine>> {
  const { seasonStats, matches, platform, seasons } = input;
  const wanted = new Set(seasons);
  const out = new Map<number, Map<string, SeasonLine>>();
  const lineFor = (fcId: number, season: string): SeasonLine => {
    const bySeason = out.get(fcId) ?? new Map<string, SeasonLine>();
    if (!out.has(fcId)) out.set(fcId, bySeason);
    const line = bySeason.get(season) ?? EMPTY(season);
    if (!bySeason.has(season)) bySeason.set(season, line);
    return line;
  };

  const [statId, statSeason, statPlatform, pv, mv, fm, goals, assists] = columnIndex(
    seasonStats,
    'fc_id',
    'season',
    'platform',
    'pv',
    'mv',
    'fm',
    'goals',
    'assists',
  );
  // The five that a bundle written before they existed may not carry: asked for by name, and simply
  // absent rather than fatal - the same treatment `player-ratings` gives `clean_sheets`.
  const penScored = optionalIndex(seasonStats, 'pen_scored');
  const conceded = optionalIndex(seasonStats, 'goals_conceded');
  const cleanSheets = optionalIndex(seasonStats, 'clean_sheets');

  for (const row of seasonStats.rows) {
    if (row[statPlatform] !== platform) continue;
    const season = row[statSeason] as string;
    if (!wanted.has(season)) continue;
    const line = lineFor(row[statId] as number, season);
    line.pv = asNumber(row[pv]);
    line.mv = asNumber(row[mv]);
    line.fm = asNumber(row[fm]);
    const scored = asNumber(row[goals]);
    const pens = penScored >= 0 ? asNumber(row[penScored]) : null;
    // A goal from the spot is a goal: the table keeps them apart, the operator's question does not.
    line.goals = scored == null && pens == null ? null : (scored ?? 0) + (pens ?? 0);
    line.assists = asNumber(row[assists]);
    line.conceded = conceded >= 0 ? asNumber(row[conceded]) : null;
    line.cleanSheets = cleanSheets >= 0 ? asNumber(row[cleanSheets]) : null;
  }

  const [matchId, matchSeason, competition, minutes] = columnIndex(
    matches,
    'fc_id',
    'season',
    'competition',
    'minutes',
  );
  const xgAt = optionalIndex(matches, 'xg');
  const xaAt = optionalIndex(matches, 'xa');
  const totals = new Map<string, { minutes: number; matches: number; xg: number | null; xa: number | null }>();
  for (const row of matches.rows) {
    const season = row[matchSeason] as string;
    if (!wanted.has(season)) continue;
    if (competitionKind(row[competition] as string) !== 'league') continue;
    const played = asNumber(row[minutes]);
    // No minutes on the row is an unused substitute: he was in the squad and did not play, so he is
    // not a denominator of «how long he stays on» - and not a zero-minute appearance either.
    if (played == null || played <= 0) continue;
    const key = `${row[matchId]}|${season}`;
    const total = totals.get(key) ?? { minutes: 0, matches: 0, xg: null, xa: null };
    total.minutes += played;
    total.matches += 1;
    const xg = xgAt >= 0 ? asNumber(row[xgAt]) : null;
    const xa = xaAt >= 0 ? asNumber(row[xaAt]) : null;
    if (xg != null) total.xg = (total.xg ?? 0) + xg;
    if (xa != null) total.xa = (total.xa ?? 0) + xa;
    totals.set(key, total);
  }
  for (const [key, total] of totals) {
    const [id, season] = key.split('|');
    const line = lineFor(Number(id), season);
    line.matches = total.matches;
    line.minutesPerMatch = total.matches ? total.minutes / total.matches : null;
    line.xg = total.xg;
    line.xa = total.xa;
  }
  return out;
}
