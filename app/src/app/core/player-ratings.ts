import { BundleTable, columnIndex } from './bundle';
import { Spell, isOpen } from './player-status';
import { Platform, PlayerRow } from './players-store';

/**
 * Four readings of a player, each a 0-99 inside the listone he is quoted on.
 *
 * THEY ARE REPORTING, and that has to be said before anything else: no valuation reads them, no ranking
 * of the auction panel uses them, no gate owns them. They are four questions the operator asks at a
 * table - «prende voti?», «fa bonus?», «gioca?», «è costante?» - answered from what was MEASURED, with
 * every threshold declared here in one place so nobody takes one for a fitted parameter.
 *
 * THE POOL IS PART OF THE MEASUREMENT. The score is a percentile inside the platform's own listone with
 * the ROLES MIXED, which is what the operator asked for («rispetto a tutti gli altri trasversalmente ai
 * ruoli»): a keeper therefore reads one star for bonus, and that is the answer and not a defect. It is
 * also why this is computed per platform - the euro listone and the Serie A one are different pools, and
 * a percentile quoted without its pool means nothing.
 *
 * It is NOT `value99`, which is a proportion of the best man's worth (`auction-value.score99`). This one
 * is a RANK: 50 means «half the listone is below him», not «half as good as the best».
 */

/**
 * A FULL sample: how many appearances a reading needs before it is entirely his own.
 *
 * It is the toolkit's own `estimate.FULL_SEASON_VOTES` and not a new number: below it the reading is
 * blended with the anchor in proportion to what he HAS - «aggiungiamo i voti che mancano come la media
 * del ruolo», the operator's remedy written as arithmetic. Without it a third keeper with four
 * appearances at 6.2 outranks a man with three hundred at 6.1, because a mean says nothing about how
 * much of it there is; with it he is mostly his role's anchor, which is what we actually know about him.
 */
export const FULL_SAMPLE = 15;

/** How fast a club's own level takes over from the role's - `estimate.CLUB_PRIOR`, same number. */
export const CLUB_PRIOR = 3;

/** Under how much of a reading being his own it is drawn as «spannometrico» rather than measured. */
export const MOSTLY_ANCHOR = 0.5;

/** Under how many measured matches the per-match readings refuse to answer. A display choice. */
export const MIN_MATCHES = 5;

/** The base vote from which a performance stops being a bad one. The game's own «sufficienza». */
export const PASS_MARK = 6;

/** A season's mean is trimmed of its best and worst only from this many seasons on (operator's rule). */
export const TRIM_FROM = 5;

/** How far back the injury share looks. One year: a calendar of a player's own. */
export const INJURY_WINDOW_DAYS = 365;

const DAY_MS = 86_400_000;

export type RatingKey = 'overall' | 'votes' | 'bonus' | 'presence' | 'consistency';

/** The four readings, in the order a row is read. `overall` is not one of them: it is their mean. */
export const DETAIL_KEYS: Exclude<RatingKey, 'overall'>[] = [
  'votes', 'bonus', 'presence', 'consistency',
];

/** Every column, the summary first: it is the one that is scanned, the four are the reason for it. */
export const RATING_KEYS: RatingKey[] = ['overall', ...DETAIL_KEYS];

export interface Rating {
  /** The quantity itself, in its own unit. Null = not even an anchor could answer. */
  raw: number | null;
  /** Its rank inside the listone, 0-99. Null wherever `raw` is. */
  score: number | null;
  /**
   * How much of the number is HIS: 1 = a full sample of his own football, 0 = the anchor of his role at
   * his club and nothing else. It is the doubt, carried on the row instead of hidden behind a dash.
   */
  weight: number;
  /** What the number rests on, in words: the sample, the window, the caveat. */
  note: string;
}

export type PlayerRating = Record<RatingKey, Rating>;

/** One season of a player, as `season_stats` states it for one platform. */
interface SeasonRow {
  season: string;
  pv: number;
  mv: number | null;
  bonus: number | null;
}

/** What the per-match layer says about a player, already reduced. */
interface MatchHistory {
  /** The base vote of every match he PLAYED: the real one where it exists, else the calibrated one. */
  votes: number[];
  synthetic: number;
  /** Minutes he was on the pitch for, over the matches of the clubs he belonged to. */
  minutes: number;
  /** The matches he actually got on the pitch in: the denominator of «how long he stays on». */
  appearances: number;
  seasons: Set<string>;
}

/**
 * The percentile of every value inside its own pool, as a 0-99.
 *
 * Ties share a score - two identical numbers cannot be ranked apart - and a null keeps no place at all:
 * a man we cannot measure is not «the worst», he is unmeasured, and giving him a 0 would put him in the
 * ranking under a claim nobody made.
 */
export function rank99(values: ReadonlyMap<number, number | null>): Map<number, number | null> {
  const measured = [...values.entries()].filter(([, value]) => value != null) as [number, number][];
  const out = new Map<number, number | null>();
  for (const [id] of values) out.set(id, null);
  if (measured.length < 2) {
    // One measured man is a pool of one: he is neither above nor below anybody, so he has no rank.
    for (const [id] of measured) out.set(id, measured.length === 1 ? 50 : null);
    return out;
  }
  const sorted = measured.map(([, value]) => value).sort((left, right) => left - right);
  for (const [id, value] of measured) {
    // How many are strictly below him, over how many he could be above: the plain percentile.
    let below = 0;
    while (below < sorted.length && sorted[below] < value) below += 1;
    out.set(id, Math.round((99 * below) / (sorted.length - 1)));
  }
  return out;
}

/**
 * The mean of the readings a player HAS, and null when he has none.
 *
 * It is a mean of the four ranks and not of the four raw numbers, which could not be averaged at all: a
 * media voto, a bonus per appearance, a share of minutes and a share of matches are four different units.
 * Averaging the places they occupy is the only sum of them that means anything.
 */
export function meanOfScores(scores: readonly (number | null)[]): number | null {
  const known = scores.filter((score): score is number => score != null);
  if (!known.length) return null;
  return known.reduce((sum, score) => sum + score, 0) / known.length;
}

/**
 * The stars a score is drawn as: five of them, in HALVES, so 0-99 becomes 0 to 5 in steps of 0.5.
 *
 * The number is the fact and the stars are the reading of it - which is why the column sorts on the
 * score and not on the stars: two men half a star apart are two different numbers.
 */
export function starsOf(score: number | null): number | null {
  return score == null ? null : Math.round((score / 99) * 10) / 2;
}

/** Whole days between two ISO dates. */
function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * The mean of a player's seasons, weighted by the appearances each rests on - and trimmed of its best
 * and its worst season once there are five, which is the operator's own convention for a mean that
 * judges: one exceptional year should not be what a career reads as.
 */
function seasonMean(rows: readonly { pv: number; value: number | null }[]): number | null {
  const usable = rows.filter((row) => row.value != null && row.pv > 0) as { pv: number; value: number }[];
  // The floor is on the APPEARANCES and not on the seasons: one season of thirty matches is a career
  // this can speak about, four matches spread over three seasons is not.
  if (usable.reduce((sum, row) => sum + row.pv, 0) < MIN_MATCHES) return null;
  let kept = usable;
  if (usable.length >= TRIM_FROM) {
    const byValue = [...usable].sort((left, right) => left.value - right.value);
    kept = byValue.slice(1, -1);
  }
  const weight = kept.reduce((sum, row) => sum + row.pv, 0);
  if (!weight) return null;
  return kept.reduce((sum, row) => sum + row.value * row.pv, 0) / weight;
}

/** `season_stats` reduced to one list per player, for one platform. */
export function seasonHistories(
  table: BundleTable,
  platform: Platform,
): Map<number, SeasonRow[]> {
  const [id, season, plat, pv, mv, goals, assists] = columnIndex(
    table, 'fc_id', 'season', 'platform', 'pv', 'mv', 'goals', 'assists',
  );
  const out = new Map<number, SeasonRow[]>();
  for (const row of table.rows) {
    if (row[plat] !== platform) continue;
    const appearances = (row[pv] as number) ?? 0;
    // A season with no appearance carries no average: its stored 0.0 is the aggregation's zero.
    if (!appearances) continue;
    const fcId = Number(row[id]);
    const list = out.get(fcId);
    const one: SeasonRow = {
      season: row[season] as string,
      pv: appearances,
      mv: (row[mv] as number) ?? null,
      bonus: (((row[goals] as number) ?? 0) + ((row[assists] as number) ?? 0)) / appearances,
    };
    list ? list.push(one) : out.set(fcId, [one]);
  }
  return out;
}

/**
 * The per-match layer reduced per player: the base vote of every match he played, his minutes, and the
 * matches his clubs played while he was there.
 *
 * The vote follows the TOOLKIT's own definition (`arrivals.fm_equivalents`): the real fantacalcio vote
 * where one exists, the calibrated synthetic one where it does not - `COALESCE(mr.mv, e.mv_synth)` - over
 * matches with minutes on the clock. The real vote is looked for on BOTH platforms because the base voto
 * is the same number seen from two calendars (spec v9): `default` states it for a Serie A round, `euro`
 * for whichever round its own calendar bundled, and only when neither has it does the synthetic answer.
 *
 * MINUTES are summed with the APPEARANCES they were played in, and nothing else: how much of a match he
 * plays when he plays. How much of the SEASON he plays is not asked here at all - that is the engine's
 * own forecast (`expectedShare`), because the question «presenze» is about the season that is coming.
 */
export function matchHistories(
  external: BundleTable,
  ratings: BundleTable,
  matchdayMap: BundleTable,
  leagueOf: ReadonlyMap<number, string | null>,
  /**
   * Which championships this listone PRICES. On Serie A it is `serie_a` alone - a foreign fantamedia is
   * R1, refused by the gate - while the euro listone prices five, so filtering a euro man on the league
   * his roster names today threw away the whole history of everybody who moved: 37 men of 925, Bernardo
   * Silva's 71 Premier matches among them.
   */
  inScope: ReadonlySet<string>,
): Map<number, MatchHistory> {
  const [rId, rSeason, rPlatform, rMatchday, rMv] = columnIndex(
    ratings, 'fc_id', 'season', 'platform', 'matchday', 'mv',
  );
  const [mSeason, mEuro, mLeague, mReal] = columnIndex(
    matchdayMap, 'season', 'euro_md', 'league', 'real_md',
  );
  /** (season, league, real round) -> the euro round that bundled it. */
  const euroRound = new Map<string, number>();
  for (const row of matchdayMap.rows) {
    euroRound.set(`${row[mSeason]}|${row[mLeague]}|${row[mReal]}`, row[mEuro] as number);
  }
  /** The real votes, keyed by the round they were played in on each platform. */
  const realVote = new Map<string, number>();
  for (const row of ratings.rows) {
    const mv = row[rMv] as number | null;
    if (mv == null) continue;
    realVote.set(`${row[rPlatform]}|${row[rId]}|${row[rSeason]}|${row[rMatchday]}`, mv);
  }

  const [eId, eSeason, eSource, eCompetition, eRealMd, eMinutes, eSynth] = columnIndex(
    external, 'fc_id', 'season', 'source', 'competition', 'real_md', 'minutes', 'mv_synth',
  );

  const out = new Map<number, MatchHistory>();

  for (const row of external.rows) {
    // The LEAGUE calendar only, and only the source the calibration was fitted on: a friendly goal must
    // never enter a number a threshold was fitted on, and a cup tie has no fantacalcio vote at all.
    if (row[eSource] !== 'sofascore') continue;
    const fcId = Number(row[eId]);
    const league = row[eCompetition] as string;
    // Football played in a championship this listone does not price: it happened, and it is not what
    // this sheet is about. A man whose own roster league is outside the scope keeps nothing either.
    if (!inScope.has(league) || !inScope.has(leagueOf.get(fcId) ?? league)) continue;
    const season = row[eSeason] as string;
    let history = out.get(fcId);
    if (!history) {
      out.set(fcId, (history = {
        votes: [], synthetic: 0, minutes: 0, appearances: 0, seasons: new Set(),
      }));
    }
    history.seasons.add(season);

    // A row with NO minutes is an unused substitute: he was there and was not chosen, so it adds
    // nothing to the minutes and does not count as an appearance either.
    const minutes = (row[eMinutes] as number) ?? 0;
    history.minutes += minutes;
    if (minutes <= 0) continue;
    history.appearances += 1;

    const realMd = row[eRealMd] as number | null;
    const euroMd = realMd == null ? undefined : euroRound.get(`${season}|${league}|${realMd}`);
    const vote =
      (realMd != null ? realVote.get(`default|${fcId}|${season}|${realMd}`) : undefined)
      ?? (euroMd != null ? realVote.get(`euro|${fcId}|${season}|${euroMd}`) : undefined)
      ?? (row[eSynth] as number | null)
      ?? null;
    if (vote == null) continue;
    history.votes.push(vote);
    if (realMd == null || realVote.get(`default|${fcId}|${season}|${realMd}`) == null) {
      const fromEuro = euroMd != null && realVote.get(`euro|${fcId}|${season}|${euroMd}`) != null;
      if (!fromEuro) history.synthetic += 1;
    }
  }

  return out;
}

/** The days of the last year a player spent inside an injury spell, as a share of that year. */
export function injuredShare(spells: readonly Spell[], today: string): number {
  const from = new Date(Date.parse(today) - INJURY_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  // The source records one row per DIAGNOSIS, so a man hurt twice at once - or re-injured before the
  // first spell was closed - has overlapping rows: summing them read 591 days out of 365 for one player.
  // Merged first, then counted, so a day out is a day and never two.
  const windows: [string, string][] = [];
  for (const spell of spells) {
    if (!spell.from) continue;
    const start = spell.from > from ? spell.from : from;
    const endsAt = spell.to ?? today;
    // An open spell counts to today and no further: what it will cost from tomorrow is a forecast.
    const end = isOpen(spell, today) || endsAt > today ? today : endsAt;
    if (end <= start) continue;
    windows.push([start, end]);
  }
  windows.sort((left, right) => left[0].localeCompare(right[0]));
  let out = 0;
  let open: [string, string] | null = null;
  for (const window of windows) {
    if (open && window[0] <= open[1]) {
      if (window[1] > open[1]) open[1] = window[1];
      continue;
    }
    if (open) out += days(open[0], open[1]);
    open = [window[0], window[1]];
  }
  if (open) out += days(open[0], open[1]);
  return Math.min(1, out / INJURY_WINDOW_DAYS);
}

const it = (iso: string): string => iso.split('-').reverse().join('/');

/** One reading of one man's own football: the number, how much of it there is, and what it says. */
interface Sample {
  value: number | null;
  /** Appearances or matches behind it. Zero = nothing measured, which is not a zero value. */
  size: number;
  said: string;
}

/** How the role is named in a sentence about a club's level. */
const ROLE_WORD: Record<string, string> = {
  P: 'portieri',
  D: 'difensori',
  C: 'centrocampisti',
  A: 'attaccanti',
};

/**
 * The anchors a thin reading is blended with: one per ROLE, and one per (club, role) inside it.
 *
 * Both are means over the men of THIS listone who have a full-sized sample, so the scale is the pool's
 * own - the same reason the percentile is. A club with nobody measured in that role simply has no club
 * anchor and the role's stands.
 */
function anchorsOf(
  pool: readonly PlayerRow[],
  own: ReadonlyMap<number, Record<'votes' | 'bonus' | 'consistency', Sample>>,
  key: 'votes' | 'bonus' | 'consistency',
): { role: Map<string, number>; club: Map<string, { mean: number; measured: number }> } {
  const byRole = new Map<string, number[]>();
  const byClub = new Map<string, number[]>();
  for (const player of pool) {
    const sample = own.get(player.fcId)?.[key];
    if (!sample || sample.value == null || sample.size < FULL_SAMPLE) continue;
    (byRole.get(player.role) ?? byRole.set(player.role, []).get(player.role)!).push(sample.value);
    const clubKey = `${player.club}|${player.role}`;
    (byClub.get(clubKey) ?? byClub.set(clubKey, []).get(clubKey)!).push(sample.value);
  }
  const mean = (values: number[]) => values.reduce((sum, one) => sum + one, 0) / values.length;
  return {
    role: new Map([...byRole].map(([role, values]) => [role, mean(values)])),
    club: new Map([...byClub].map(([clubKey, values]) =>
      [clubKey, { mean: mean(values), measured: values.length }])),
  };
}

/**
 * The role's anchor moved toward the CLUB's own level for that role - `estimate.club_anchor`, same
 * arithmetic and same prior: a club we have measured three men of counts half, one man counts a quarter.
 */
export function clubAnchor(
  roleAnchor: number,
  club: { mean: number; measured: number } | undefined,
): number {
  if (!club || club.measured <= 0) return roleAnchor;
  return roleAnchor + (club.mean - roleAnchor) * (club.measured / (club.measured + CLUB_PRIOR));
}

/**
 * The four readings for one listone, ranked inside it.
 *
 * Each raw number is measured first and ranked after, so the note can state what the star rests on -
 * «6.12 di media su 87 partite» - and a reader can disagree with the number instead of with the stars.
 */
export function ratingsFor(input: {
  pool: readonly PlayerRow[];
  seasons: ReadonlyMap<number, SeasonRow[]>;
  matches: ReadonlyMap<number, MatchHistory>;
  spells: ReadonlyMap<number, Spell[]>;
  /**
   * The share of the coming calendar the ENGINE expects him to be on the team sheet for -
   * `engine_pv_pred / matchdays_target`, or its declared fallback. It is what «presenze» is about
   * (operator, 15/08/2026): a star there must say what he will play, not what he played.
   */
  expectedShare: ReadonlyMap<number, { share: number | null; estimated: boolean }>;
  today: string;
}): Map<number, PlayerRating> {
  const { pool, seasons, matches, spells, expectedShare, today } = input;
  const raw: Record<Exclude<RatingKey, 'overall'>, Map<number, number | null>> = {
    votes: new Map(), bonus: new Map(), presence: new Map(), consistency: new Map(),
  };
  const notes: Record<Exclude<RatingKey, 'overall'>, Map<number, string>> = {
    votes: new Map(), bonus: new Map(), presence: new Map(), consistency: new Map(),
  };
  const weights: Record<Exclude<RatingKey, 'overall'>, Map<number, number>> = {
    votes: new Map(), bonus: new Map(), presence: new Map(), consistency: new Map(),
  };

  /** What each man's own football says, before anybody is compared with anybody. */
  const own = new Map<number, Record<'votes' | 'bonus' | 'consistency', Sample>>();
  /** ...and how much of a match he plays when he plays, which the presences reading needs per role. */
  const minutesShare = new Map<number, { value: number | null; size: number }>();

  for (const player of pool) {
    const id = player.fcId;
    const history = seasons.get(id) ?? [];
    const played = matches.get(id);
    const window = played ? [...played.seasons].sort().join(', ') : '';

    // 1. VOTI - the base vote of a career, weighted by the appearances behind each season and trimmed
    //    once there are five. The synthetic vote enters only where a season has no measured one: the
    //    listone's own history is the fact, the calibrated line is the fallback.
    const measuredSeasons = history.map((row) => ({ pv: row.pv, value: row.mv }));
    const seasonAppearances = history.reduce((sum, row) => sum + row.pv, 0);
    let votes: Sample = { value: seasonMean(measuredSeasons), size: seasonAppearances, said: '' };
    if (votes.value != null) {
      const kept = history.filter((row) => row.mv != null).length;
      votes.said = `${votes.value.toFixed(2)} di media voto su ${kept} stagion${kept === 1 ? 'e' : 'i'}`
        + ` (${seasonAppearances} presenze)`
        + (kept >= TRIM_FROM ? ', scartata la migliore e la peggiore' : '');
    } else if (played?.votes.length) {
      const sum = played.votes.reduce((total, one) => total + one, 0);
      votes = {
        value: sum / played.votes.length,
        size: played.votes.length,
        said: `${(sum / played.votes.length).toFixed(2)} di media su ${played.votes.length} partite di `
          + `${window}, ${played.synthetic} con voto sintetico calibrato`,
      };
    }

    // 2. BONUS - gol e assist per presenza, sulle stesse stagioni e con la stessa media troncata.
    const bonusValue = seasonMean(history.map((row) => ({ pv: row.pv, value: row.bonus })));
    const bonus: Sample = {
      value: bonusValue,
      size: seasonAppearances,
      said: bonusValue == null ? ''
        : `${bonusValue.toFixed(2)} tra gol e assist per presenza, su ${seasonAppearances} presenze`,
    };

    // 4. COSTANZA - quante delle partite che gioca porta a casa almeno la sufficienza. È misurata sul
    //    VOTO e non sul fantavoto, perché la domanda è proprio quella: se non segna, prende 5?
    const votesPlayed = played?.votes ?? [];
    const consistency: Sample = {
      value: votesPlayed.length
        ? votesPlayed.filter((vote) => vote >= PASS_MARK).length / votesPlayed.length
        : null,
      size: votesPlayed.length,
      said: votesPlayed.length
        ? `${Math.round((votesPlayed.filter((vote) => vote >= PASS_MARK).length / votesPlayed.length) * 100)}%`
          + ` delle ${votesPlayed.length} partite giocate in ${window} chiuse con almeno ${PASS_MARK} di voto`
        : '',
    };
    own.set(id, { votes, bonus, consistency });

    // 3. PRESENZE - quanto della stagione CHE VIENE ti assicura, e la domanda guarda avanti (operator,
    //    15/08/2026): la base è la quota di calendario che il MOTORE gli prevede - la sua titolarità
    //    nella rosa di oggi, non le partite di ieri - corretta da quanto sta in campo QUANDO gioca, che
    //    è l'unica cosa che il passato sa e la previsione non dice: `pv` conta presenze a voto, non
    //    minuti, e un uomo che entra sempre al 70' ne ha tante e vale poco.
    //
    //    Gli infortuni NON sono un secondo sconto: il modello delle presenze del toolkit li legge già,
    //    e toglierli di nuovo sarebbe contarli due volte. Restano nella nota, come informazione.
    const forecast = expectedShare.get(id);
    const expected = forecast?.share ?? null;
    // How much of a match he plays when he is on the team sheet. Blended with the ROLE's own figure by
    // how many appearances it rests on - the same shrink as every other reading here - because crediting
    // an unmeasured man with a full 90' put men nobody has seen play at the top of the column.
    minutesShare.set(id, played?.appearances
      ? { value: Math.min(1, played.minutes / (played.appearances * 90)), size: played.appearances }
      : { value: null, size: 0 });
    raw.presence.set(id, expected);       // the second half is applied below, once the role is known
    weights.presence.set(id, expected == null ? 0 : forecast!.estimated ? 0.5 : 1);
    const hurt = injuredShare(spells.get(id) ?? [], today);
    notes.presence.set(
      id,
      expected == null
        ? 'il motore non gli prevede presenze e non offre nemmeno una stima: non misurabile'
        : `${Math.round(expected * 100)}% del calendario che viene, ${forecast!.estimated ? 'STIMATO' : 'previsto'} dal motore`
          + (hurt > 0
            ? ` · ha passato il ${Math.round(hurt * 100)}% dell'ultimo anno infortunato (letto al `
              + `${it(today)}, ed è già dentro la previsione)`
            : ''),
    );
  }

  /**
   * ...and now the men with little or nothing measured, which is most of what an August listone is.
   *
   * NOBODY IS LEFT WITHOUT A NUMBER (operator, 15/08/2026, and it is his own rule of 05/08 one level
   * down): where his own football is thin the reading is BLENDED with the anchor of his role moved
   * toward his club's own level for that role, and where there is no football at all the anchor IS the
   * reading. The arithmetic is the toolkit's own and so are its constants - `engine/estimate.py`:
   * `shrink` pads the sample he is missing with the anchor (full sample = 15 votes), `club_anchor`
   * moves the role's number toward the club's by `n/(n+3)`.
   *
   * The doubt is not hidden, it is CARRIED: `weight` says how much of the number is his own, the note
   * says it in words, and the stars are drawn faded when it is mostly the anchor speaking. «Un
   * attaccante titolare della Juve anche se sconosciuto è sempre meglio di un attaccante sconosciuto
   * del Verona» - that is what the club pull is, and it is measured rather than assumed.
   */
  /**
   * The second half of PRESENZE, now that the pool can speak for a man it has not measured: how much of
   * a match his ROLE plays when it plays, blended with his own by the appearances he has. A keeper who
   * is fielded plays 90, a forward is taken off, and neither is «unknown means a full match».
   */
  const minuteAnchor = new Map<string, number>();
  const byRole = new Map<string, number[]>();
  for (const player of pool) {
    const one = minutesShare.get(player.fcId);
    if (!one || one.value == null || one.size < FULL_SAMPLE) continue;
    (byRole.get(player.role) ?? byRole.set(player.role, []).get(player.role)!).push(one.value);
  }
  for (const [role, values] of byRole) {
    minuteAnchor.set(role, values.reduce((sum, one) => sum + one, 0) / values.length);
  }
  for (const player of pool) {
    const id = player.fcId;
    const expected = raw.presence.get(id) ?? null;
    if (expected == null) continue;
    const one = minutesShare.get(id) ?? { value: null, size: 0 };
    const anchor = minuteAnchor.get(player.role) ?? null;
    const weight = Math.max(0, Math.min(1, one.size / FULL_SAMPLE));
    const share = one.value == null || anchor == null
      ? (one.value ?? anchor)
      : anchor + weight * (one.value - anchor);
    if (share == null) continue;   // nothing of his role measured either: the forecast stands alone
    raw.presence.set(id, expected * share);
    // A forecast is only as sure as the minutes it is multiplied by: an unmeasured factor halves it.
    if (one.value == null || weight < 1) {
      weights.presence.set(id, (weights.presence.get(id) ?? 1) * Math.max(0.5, weight));
    }
    notes.presence.set(
      id,
      `${notes.presence.get(id)} × ${Math.round(share * 90)}′ medi quando gioca`
        + (one.value == null
          ? ' (dei giocatori del suo ruolo: di lui non ne abbiamo)'
          : weight < 1
            ? ` (${Math.round(weight * 100)}% suoi, su ${one.size} presenze, il resto del ruolo)`
            : ''),
    );
  }

  for (const key of ['votes', 'bonus', 'consistency'] as const) {
    const anchors = anchorsOf(pool, own, key);
    for (const player of pool) {
      const id = player.fcId;
      const sample = own.get(id)![key];
      const anchor = anchors.role.get(player.role) ?? null;
      if (anchor == null) {
        // A role nobody in this listone has measured at all: there is nothing to anchor to, and
        // inventing a number here would be inventing the scale itself.
        raw[key].set(id, sample.value);
        notes[key].set(id, sample.said || 'niente di misurato e nessuna ancora per il suo ruolo');
        weights[key].set(id, sample.value == null ? 0 : 1);
        continue;
      }
      const clubbed = clubAnchor(anchor, anchors.club.get(`${player.club}|${player.role}`));
      const weight = Math.max(0, Math.min(1, sample.size / FULL_SAMPLE));
      const value = sample.value == null ? clubbed : clubbed + weight * (sample.value - clubbed);
      raw[key].set(id, value);
      weights[key].set(id, sample.value == null ? 0 : weight);
      // «del Juventus» is not Italian and «della Roma» is: a club's article is not derivable, so the
      // sentence is built to need none.
      const level = `il livello dei ${ROLE_WORD[player.role] ?? 'giocatori'} del suo club`
        + (player.club ? ` (${player.club})` : '');
      notes[key].set(
        id,
        sample.value == null
          ? `SPANNOMETRICO: niente di misurato, vale ${level} (${clubbed.toFixed(2)})`
          : weight >= 1
            ? sample.said
            : `${sample.said} — campione corto, quindi mescolato con ${level} `
              + `(${Math.round(weight * 100)}% suo, ${clubbed.toFixed(2)} l'ancora)`,
      );
    }
  }

  const ranked: Record<RatingKey, Map<number, number | null>> = {
    votes: rank99(raw.votes),
    bonus: rank99(raw.bonus),
    presence: rank99(raw.presence),
    consistency: rank99(raw.consistency),
    overall: new Map(),
  };

  /**
   * OVERALL - the mean of the other four, then ranked like all of them.
   *
   * Two steps and both are needed. The MEAN is of the four ranks, because the four raw numbers are four
   * different units and their average would mean nothing. The RANK of that mean is what the column shows,
   * for the same reason every other column shows one: a mean of percentiles piles up in the middle - four
   * correlated readings almost never all reach the top - so drawing it straight would give five stars to
   * nobody. The mean itself stays in the note, so the number he asked for is on the row.
   */
  const overallRaw = new Map<number, number | null>();
  for (const player of pool) {
    const id = player.fcId;
    overallRaw.set(id, meanOfScores(DETAIL_KEYS.map((key) => ranked[key].get(id) ?? null)));
  }
  ranked.overall = rank99(overallRaw);

  const out = new Map<number, PlayerRating>();
  for (const player of pool) {
    const id = player.fcId;
    const mean = overallRaw.get(id) ?? null;
    const counted = DETAIL_KEYS.filter((key) => ranked[key].get(id) != null).length;
    const reading = (key: Exclude<RatingKey, 'overall'>): Rating => ({
      raw: raw[key].get(id) ?? null,
      score: ranked[key].get(id) ?? null,
      weight: weights[key].get(id) ?? 0,
      note: notes[key].get(id) ?? '',
    });
    // The overall is as sure as the readings under it: the mean of their weights, so a row built on
    // anchors reads faded all the way across instead of pretending the summary knows more.
    const sureness = DETAIL_KEYS.map((key) => weights[key].get(id) ?? 0);
    out.set(id, {
      overall: {
        raw: mean,
        score: ranked.overall.get(id) ?? null,
        weight: sureness.reduce((sum, one) => sum + one, 0) / sureness.length,
        note: mean == null
          ? 'nessuna delle quattro letture è misurabile per lui'
          : `media delle altre quattro: ${Math.round(mean)}/99`
            + (counted < DETAIL_KEYS.length ? ` (su ${counted} letture di ${DETAIL_KEYS.length})` : ''),
      },
      votes: reading('votes'),
      bonus: reading('bonus'),
      presence: reading('presence'),
      consistency: reading('consistency'),
    });
  }
  return out;
}

/** What each column is called, and what its star actually says. Written once, drawn everywhere. */
export const RATING_LABEL: Record<RatingKey, string> = {
  overall: 'Overall',
  votes: 'Voti',
  bonus: 'Bonus',
  presence: 'Presenze',
  consistency: 'Costanza',
};

export const RATING_HINT: Record<RatingKey, string> = {
  overall:
    'La media delle altre quattro colonne - dei loro punteggi, non dei numeri grezzi, che sono in quattro '
    + 'unità diverse - e poi il posto che quella media occupa nel listone, come per ogni altra colonna. '
    + 'Dove una lettura manca, la media è fatta su quelle che ci sono e il tooltip dice quante.',
  votes:
    'Media voto di carriera, pesata sulle presenze di ogni stagione e - da cinque stagioni in su - '
    + 'scartata la migliore e la peggiore. Dove una stagione non è sul listone entra il voto sintetico '
    + 'calibrato. Le stelle sono il posto che occupa nel listone, tutti i ruoli insieme.',
  bonus:
    'Gol più assist per presenza, sulle stesse stagioni e con la stessa media troncata. Un portiere qui '
    + 'vale una stella: è la risposta, non un difetto - il confronto è con tutto il listone.',
  presence:
    'Quanto della stagione CHE VIENE ti assicura: la quota di calendario che il motore gli prevede '
    + '(engine_pv_pred, o la stima dichiarata), corretta da quanti minuti sta in campo quando gioca. '
    + 'Guarda avanti, non indietro; gli infortuni sono già dentro la previsione e non vengono contati '
    + 'due volte.',
  consistency:
    'Quante delle partite che gioca chiude con almeno 6 di VOTO (non di fantavoto): se non segna, prende '
    + '5? La misura è sul voto base, reale dove c\'è e sintetico calibrato dove manca.',
};

/**
 * The sentence that explains a faded star, said once.
 *
 * It is the honest half of «tutti devono avere un valore»: everybody gets one, and the ones built on
 * the anchor say so instead of looking like the measured ones.
 */
export const ANCHOR_HINT =
  'Stella SFUMATA = spannometrica: di lui è misurato poco o niente, quindi il numero è (in tutto o in '
  + 'parte) l\'ancora del suo ruolo spostata verso il livello del suo club - la stessa scala che usa il '
  + 'toolkit quando non può valutare un giocatore. Il tooltip della cella dice quanto è suo.';
