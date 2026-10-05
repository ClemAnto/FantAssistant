import { THIN_SAMPLE } from './match-frequency';
import { MatchCell, isChampionship } from './players-store';

/**
 * THE «CHECKS» VIEW OF THE DRAFT LIST (operator, 04/10/2026): five yes/no badges per man, one column each.
 *
 * - `tit`   the PRESS's titolarità is `titolare` or better (the engine's rung does not count: the condition
 *           names the press);
 * - `mv`    last season's base vote is at least 6;
 * - `fm`    last season's fantamedia (scored or rebuilt on the synthetic vote) is good IN HIS ROLE;
 * - `bonus` the share of his matches with bonus minus malus at least zero, last season, is good in his role;
 * - `cont`  the share of his matches closed with a sufficient base vote (the Costanza) is good in his role;
 * - `m`     last season's MINUTES PER APPEARANCE are good in his role (operator, 04/10/2026: «ottimo minutaggio»).
 *           Per appearance and not the total, so it does not repeat `p`: the total is appearances × minutes;
 * - `p`     last season's APPEARANCES with a vote are good in his role («ottimo numero di presenze»);
 * - `trend` the base-vote mean of his club's last five matches, a 5 for every one he did not play or got no
 *           vote in (`player-trend.trendVoteMean`, the Strategy's own reading), is good in his role.
 *
 * `bonus` READS BONUS MINUS MALUS >= 0, FOR EVERY ROLE (operator, 04/10/2026, in two steps): first for keepers
 * only - their bonuses are few and their malus is the goals conceded, and «> 0» averaged 2% of matches over the 24
 * Serie A keepers of 2025-26 with 10+ matches, separating nobody, where «>= 0» runs from 12% to 48% - then «vale per
 * tutti»: a match not spoiled by a card, an own goal or a missed penalty, i.e. fantavoto at least the base vote
 * (`cleanShare`). It replaced «at least one bonus», which `match-frequency` still reads for the Strategy. The checks
 * on a share or a count also require it above zero: a bar that falls on zero would otherwise hand the badge to
 * everybody.
 *
 * «GOOD IN HIS ROLE» IS THE TOP THIRD (`GOOD_QUANTILE`), a declared choice: a badge must separate, and a third
 * of a role's regulars is about as many men as a ten-team league fields in it (a keeper per squad of 22, four
 * defenders per squad of ~120). The bar is cut on the WHOLE listone, taken men included, so a man does not earn a
 * badge because the better ones have been called - the bar is a fact about the role, not about the free pool.
 *
 * A SEASON IS READ SINCE HE ARRIVED (operator, 04/10/2026, on Malen: «la valutazione va fatta solo nel periodo
 * da quando è stato acquistato»): every season-based check reads his LAST STINT of that season (`lastStint`),
 * the matches of the championship and club he ended it with, from the first one he was on file for. A January
 * signing is not charged the rounds he spent elsewhere, nor credited the minutes he played there. So `p` is a
 * SHARE - his appearances over his club's rounds since he arrived - and not a count, which would read half a
 * season as a poor one. Limit, stated: for a club abroad the layer carries only the matches he is on file for
 * (called up), so there the share is generous.
 *
 * A SEASON READING NEEDS A SAMPLE: under `THIN_SAMPLE` matches (ten, where one match moves a share by more than
 * ten points) a man gets no badge on the four season-based checks and does not enter the bar either - three
 * matches at 7.5 are not a good fantamedia, they are three matches. The Costanza carries its own shrinkage
 * toward the role, so it enters as it is. Unknown is never «no»: a missing number is a missing badge, with the
 * reason in the cell's tooltip.
 */

/** The share of a role's men a «good» badge leaves BELOW the bar: the top third gets it. */
export const GOOD_QUANTILE = 2 / 3;

/** The base vote from which the `mv` check is true (operator: «almeno 6»). */
export const MV_PASS = 6;

/** What one man brings to the five checks. `zone` is the role the bars are cut in (P/D/C/A). */
export interface CheckMan {
  id: number;
  zone: string;
  /** The titolarità word as the PRESS says it, null where the press does not have him. */
  pressRank: number | null;
  /** Last season: matches with a vote, base vote, fantamedia. */
  pv: number | null;
  /** Since he arrived: the share of his club's rounds he played, and over how many rounds. */
  presence: number | null;
  rounds: number;
  mv: number | null;
  fm: number | null;
  /** Last season: the share of played league matches with a bonus, and over how many. */
  bonus: number | null;
  played: number | null;
  /** The Costanza: share of his votes with a base vote of 6 or more. */
  steady: number | null;
  /** Last season: mean minutes over the league matches he played whose minutes are known, and over how many. */
  minutes: number | null;
  timed: number | null;
  /** The last-five base-vote mean, and how many of those five he got a vote in. */
  trend: number | null;
  trendVoted: number;
}

export type CheckKey = 'tit' | 'mv' | 'fm' | 'bonus' | 'cont' | 'm' | 'p' | 'trend';

export const CHECK_KEYS: readonly CheckKey[] = ['tit', 'mv', 'fm', 'bonus', 'cont', 'm', 'p', 'trend'];

/**
 * HIS MATCHES WITHOUT A MINUS: the share of his voted league matches where bonus minus malus is at least zero, i.e.
 * the fantavoto is not below the base vote. Over the matches with BOTH numbers; null when there is none.
 */
export function cleanShare(cells: readonly MatchCell[]): { share: number | null; rated: number } {
  const rated = cells.filter(
    (one) => isChampionship(one.kind) && one.state === 'played' && one.vote != null && one.fantavoto != null,
  );
  if (!rated.length) return { share: null, rated: 0 };
  return {
    share: rated.filter((one) => (one.fantavoto as number) >= (one.vote as number)).length / rated.length,
    rated: rated.length,
  };
}

/**
 * His mean minutes per league appearance, over the matches whose minutes are known: a match without minutes says
 * neither yes nor no, the same rule as `match-frequency.matchFrequencies`. Null when none is known.
 */
export function minutesPerAppearance(cells: readonly MatchCell[]): { minutes: number | null; timed: number } {
  const timed = cells.filter(
    (one) => isChampionship(one.kind) && (one.state === 'played' || one.state === 'no_vote') && one.minutes != null,
  );
  if (!timed.length) return { minutes: null, timed: 0 };
  return { minutes: timed.reduce((sum, one) => sum + (one.minutes as number), 0) / timed.length, timed: timed.length };
}

/** The states that put him on file for a match: he played, got no vote, sat on the bench or was injured. */
const ON_FILE = new Set(['played', 'no_vote', 'bench', 'injured']);

/**
 * HIS LAST STINT OF A SEASON: the championship matches of the competition and club he was last on file for,
 * from the first match of that run onward (his arrival), rounds he missed included. Empty when he is on file
 * nowhere. The cells come NEWEST FIRST, as `PlayersStore.matchesOf` sorts them; the stint comes back oldest first.
 */
export function lastStint(cells: readonly MatchCell[]): MatchCell[] {
  const league = cells.filter((one) => isChampionship(one.kind)).reverse();
  let end = -1;
  for (let at = league.length - 1; at >= 0; at -= 1) {
    if (ON_FILE.has(league[at].state)) {
      end = at;
      break;
    }
  }
  if (end < 0) return [];
  const { competition } = league[end];
  // THE CLUB IS COMPARED ONLY ACROSS MATCHES HE PLAYED: a played row spells the club as the votes do, a bench row
  // as the provider does (`AC Milan` against `Milan`), and comparing the two would cut every season in pieces.
  let team: string | null = null;
  let start = end;
  for (let at = end; at >= 0; at -= 1) {
    const one = league[at];
    if (!ON_FILE.has(one.state)) continue;
    if (one.competition !== competition) break;
    if (one.state === 'played' || one.state === 'no_vote') {
      if (team != null && one.team !== team) break;
      team = one.team;
    }
    start = at;
  }
  // Nobody else had him before this run: he did not ARRIVE, so the rounds he missed at the start are his too.
  if (!league.slice(0, start).some((one) => ON_FILE.has(one.state))) start = 0;
  return league.slice(start).filter((one) => one.competition === competition);
}

/** The share of the stint's rounds he played, over the rounds his club played in it (`not_in_league` is not one). */
export function stintPresence(stint: readonly MatchCell[]): { share: number | null; rounds: number } {
  const rounds = stint.filter((one) => one.state !== 'not_in_league');
  if (!rounds.length) return { share: null, rounds: 0 };
  const played = rounds.filter((one) => one.state === 'played' || one.state === 'no_vote').length;
  return { share: played / rounds.length, rounds: rounds.length };
}

type Bars = Record<'fm' | 'bonus' | 'cont' | 'm' | 'p' | 'trend', number | null>;
const NO_BARS: Bars = { fm: null, bonus: null, cont: null, m: null, p: null, trend: null };

/** One check of one man: true / false, or null when the number behind it is unknown or too thin. */
export interface CheckCell {
  ok: boolean | null;
  /** The number the check read, and the bar it was compared with (null for `tit`). */
  value: number | null;
  bar: number | null;
}

export type Checks = Record<CheckKey, CheckCell>;

/** The value at quantile `q` of an ascending list (linear between neighbours); null on an empty list. */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const at = q * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** The three per-role bars, cut on the men whose number is a measurement and not a handful of matches. */
export function checkBars(men: readonly CheckMan[]): Map<string, Bars> {
  const pools = new Map<string, Record<keyof Bars, number[]>>();
  for (const man of men) {
    const pool = pools.get(man.zone) ?? { fm: [], bonus: [], cont: [], m: [], p: [], trend: [] };
    pools.set(man.zone, pool);
    if (man.fm != null && (man.pv ?? 0) >= THIN_SAMPLE) pool.fm.push(man.fm);
    if (man.bonus != null && (man.played ?? 0) >= THIN_SAMPLE) pool.bonus.push(man.bonus);
    if (man.steady != null) pool.cont.push(man.steady);
    if (man.minutes != null && (man.timed ?? 0) >= THIN_SAMPLE) pool.m.push(man.minutes);
    // THE APPEARANCES' BAR IS CUT ON THE MEN WHO PLAYED AT LEAST ONE: with every quoted man in, a role's third best
    // would be read against benchwarmers and fringe men at zero, and the bar would sit far too low.
    if (man.presence != null && man.presence > 0 && man.rounds >= THIN_SAMPLE) pool.p.push(man.presence);
    // ...and the same for the trend: a man with no vote in the five is the 5 of everybody who does not play.
    if (man.trend != null && man.trendVoted > 0) pool.trend.push(man.trend);
  }
  const bars = new Map<string, Bars>();
  const cut = (values: number[]) => quantile([...values].sort((a, b) => a - b), GOOD_QUANTILE);
  for (const [zone, pool] of pools) {
    bars.set(zone, {
      fm: cut(pool.fm), bonus: cut(pool.bonus), cont: cut(pool.cont), m: cut(pool.m), p: cut(pool.p), trend: cut(pool.trend),
    });
  }
  return bars;
}

/** The five checks of every man of the pool, keyed by id. */
export function checksOf(men: readonly CheckMan[], titolareRank: number): Map<number, Checks> {
  const bars = checkBars(men);
  const out = new Map<number, Checks>();
  for (const man of men) {
    const bar = bars.get(man.zone) ?? NO_BARS;
    const seasonOk = (man.pv ?? 0) >= THIN_SAMPLE;
    const against = (value: number | null, limit: number | null, measured: boolean, positive = false): CheckCell => ({
      ok: value == null || limit == null || !measured ? null : value >= limit && (!positive || value > 0),
      value,
      bar: limit,
    });
    out.set(man.id, {
      tit: { ok: man.pressRank == null ? null : man.pressRank >= titolareRank, value: null, bar: null },
      mv: against(man.mv, MV_PASS, seasonOk),
      fm: against(man.fm, bar.fm, seasonOk),
      bonus: against(man.bonus, bar.bonus, (man.played ?? 0) >= THIN_SAMPLE, true),
      cont: against(man.steady, bar.cont, true, true),
      m: against(man.minutes, bar.m, (man.timed ?? 0) >= THIN_SAMPLE),
      // A count needs no sample: zero appearances is a measured «no», not a thin reading.
      p: against(man.presence, bar.p, man.rounds >= THIN_SAMPLE, true),
      trend: against(man.trend, bar.trend, true),
    });
  }
  return out;
}
