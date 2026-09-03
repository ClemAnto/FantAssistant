/**
 * ACCOPPIARE DUE PORTIERI: quante giornate della competizione ne hanno almeno uno con la porta al
 * sicuro. The operator's question of 03/09/2026, and the whole of it is about the CALENDAR.
 *
 * Nothing here predicts a footballer, and nothing here decides what «facile» means. Both of those are
 * measurements and live in the toolkit (`modules/fixtures.py`): the bundle's `calendar.json` arrives
 * with every match already carrying the home side's EDGE - its level, the venue and the opponent's
 * level in one subtraction - and, for the championship the coefficients were fitted on, the
 * probability that each side concedes nothing. What this file does is COUNT: which matchdays fall
 * inside the competition the operator declared, and what two clubs cover between them.
 *
 * WHY A PAIR IS THE UNIT. A fanta squad fields ONE keeper, so the second one is not depth in the sense
 * a fourth midfielder is: he is the man who plays on the matchdays the first one is a bad bet. That is
 * `metrica-asta-surplus-v1.md` §24 read from the calendar's side - «un'assicurazione si prezza contro
 * quello che ti copre gia'» - and it is why the two are ranked TOGETHER and never one at a time.
 *
 * TWO NUMBERS, TWO NAMES, and the reason is measured. `facili` is the operator's own rule applied to
 * the letter (edge over the frozen margin, at least one of the two); but on the 2026-27 calendar that
 * rule reads ZERO for twelve Serie A clubs of twenty, so most pairs tie at nothing and a ranking on it
 * alone would say «buy Inter's keeper» to everybody. `covered` is the same sentence with the
 * probability where the coin was - the expected number of matchdays on which at least one of the two
 * keeps a clean sheet - so it breaks the ties the count cannot. His rule decides, the expectation
 * orders inside it; the screen names both and never blends them into one figure.
 */

/** The bundle's calendar, as `fixtures.schedule` writes it. Read, never recomputed. */
export interface CalendarClub {
  key: string;
  /** OUR canonical name, resolved in the toolkit - null for a club outside the perimeter. */
  name: string | null;
  fcClubId: number | null;
  elo: number | null;
}

/** `[round, date, homeKey, awayKey, edgeHome, csHome, csAway]`, the toolkit's own column order. */
export type CalendarRow = [
  number,
  string,
  string,
  string,
  number | null,
  number | null,
  number | null,
];

export interface CalendarFile {
  season: string;
  elo_year: string;
  observed_on: string | null;
  easy_margin: number;
  home_advantage: number;
  clean_sheet: {
    intercept: number;
    slope_per_100: number;
    sample: number;
    leagues: string[];
    at_margin: number;
  };
  leagues: Record<
    string,
    {
      rounds: number;
      unclassified: number;
      clean_sheet_fitted: boolean;
      clubs: { key: string; name: string | null; fc_club_id: number | null; elo: number | null }[];
      columns: string[];
      matches: CalendarRow[];
    }
  >;
}

/** One match as a club sees it: whom, where, and how safe its own goal is. */
export interface ClubMatch {
  round: number;
  date: string;
  /** The opponent's canonical name where we have one, else the calendar's own key. */
  opponent: string;
  home: boolean;
  /** Level + venue - opponent, from the bundle. Null when a level was missing on either side. */
  edge: number | null;
  /** P(this club concedes nothing). Null outside the championship the coefficients were fitted on. */
  cleanSheet: number | null;
  /** The operator's own rule: the edge clears the frozen margin. */
  easy: boolean;
}

/**
 * The calendar of ONE championship, ready to be counted: per club, per matchday, one match.
 *
 * A club can carry two matches on one round only through a postponement the provider has already
 * moved, and `fixtures` is keyed on the match, so the last one written wins - stated rather than
 * silently averaged. The unit is the MATCH and the round is what the operator's window is expressed
 * in, which is why both travel on the row.
 */
export class LeagueCalendar {
  private readonly byClub = new Map<string, Map<number, ClubMatch>>();
  /** Canonical name -> the key the calendar is written in. The join, resolved in the toolkit. */
  private readonly keyByName = new Map<string, string>();
  private readonly nameByKey = new Map<string, string>();

  constructor(
    readonly league: string,
    readonly rounds: number,
    readonly cleanSheetFitted: boolean,
    clubs: CalendarClub[],
    matches: CalendarRow[],
    readonly easyMargin: number,
  ) {
    for (const club of clubs) {
      if (club.name) {
        this.keyByName.set(club.name, club.key);
        this.nameByKey.set(club.key, club.name);
      }
    }
    for (const [round, date, home, away, edge, csHome, csAway] of matches) {
      this.put(home, {
        round,
        date,
        opponent: this.label(away),
        home: true,
        edge,
        cleanSheet: csHome,
        easy: edge != null && edge > easyMargin,
      });
      const awayEdge = edge == null ? null : -edge;
      this.put(away, {
        round,
        date,
        opponent: this.label(home),
        home: false,
        edge: awayEdge,
        cleanSheet: csAway,
        easy: awayEdge != null && awayEdge > easyMargin,
      });
    }
  }

  private put(key: string, match: ClubMatch): void {
    const rounds = this.byClub.get(key) ?? this.byClub.set(key, new Map()).get(key)!;
    rounds.set(match.round, match);
  }

  private label(key: string): string {
    return this.nameByKey.get(key) ?? key;
  }

  /** Whether this calendar can say anything at all about a club - by the name a sheet row carries. */
  has(clubName: string): boolean {
    const key = this.keyByName.get(clubName);
    return key != null && this.byClub.has(key);
  }

  /** The clubs it knows, by OUR canonical name, in alphabetical order. */
  clubNames(): string[] {
    return [...this.keyByName.keys()].sort((a, b) => a.localeCompare(b, 'it'));
  }

  /**
   * A club's matches inside the declared competition window, one per matchday.
   *
   * A matchday the club has no fixture for is ABSENT and not a zero: at a free-extraction auction the
   * question is «how many of the competition's matchdays are covered», and a round nobody plays is not
   * a round somebody failed to cover.
   */
  window(clubName: string, from: number, to: number): ClubMatch[] {
    const key = this.keyByName.get(clubName);
    const rounds = key == null ? null : this.byClub.get(key);
    if (!rounds) return [];
    const out: ClubMatch[] = [];
    for (let round = Math.max(1, from); round <= to; round += 1) {
      const match = rounds.get(round);
      if (match) out.push(match);
    }
    return out;
  }
}

/** One matchday of a pair: what each of the two plays, and whether his rule fires. */
export interface PairRow {
  round: number;
  a: ClubMatch | null;
  b: ClubMatch | null;
  /** The operator's «FACILE»: at least one of the two is easy. */
  facile: boolean;
}

/** What a pair of clubs covers over the window - his count, and the expectation that breaks its ties. */
export interface PairCover {
  /** Matchdays on which at least one of the two has an EASY match: the operator's own rule. */
  facili: number;
  /** Matchdays either of them has a fixture in - the denominator, and never assumed to be `to - from`. */
  matchdays: number;
  /**
   * Expected matchdays with at least one clean sheet: `sum over md of 1 - (1-pA)(1-pB)`.
   *
   * Null where the championship has no fitted probability, because an unfitted pair must not be ranked
   * against a fitted one on a number that does not exist for it.
   */
  covered: number | null;
  /** The matchdays themselves, for the popover: what each of the two plays and which side is easy. */
  rows: PairRow[];
}

/**
 * What two clubs cover between them over the window.
 *
 * Passing the SAME club twice is legal and answers «what does this club alone cover», which is what a
 * grid's diagonal is: the two matches are then one match, so the union is that match and the
 * probability is not squared. `sameClub` says so explicitly rather than being guessed from the name.
 */
export function pairCover(a: ClubMatch[], b: ClubMatch[], sameClub = false): PairCover {
  const rounds = new Map<number, PairRow>();
  const take = (matches: ClubMatch[], side: 'a' | 'b') => {
    for (const match of matches) {
      const row = rounds.get(match.round) ?? { round: match.round, a: null, b: null, facile: false };
      row[side] = match;
      rounds.set(match.round, row);
    }
  };
  take(a, 'a');
  if (!sameClub) take(b, 'b');

  let facili = 0;
  let covered = 0;
  let known = 0;
  const rows = [...rounds.values()].sort((left, right) => left.round - right.round);
  for (const row of rows) {
    row.facile = Boolean(row.a?.easy || row.b?.easy);
    if (row.facile) facili += 1;
    const pa = row.a?.cleanSheet;
    const pb = row.b?.cleanSheet;
    if (pa == null && pb == null) continue;
    known += 1;
    covered += 1 - (1 - (pa ?? 0)) * (1 - (pb ?? 0));
  }

  return {
    facili,
    matchdays: rows.length,
    covered: rows.length > 0 && known === rows.length ? covered : null,
    rows,
  };
}

/** A candidate keeper, ranked. */
export interface PairSuggestion<T> {
  man: T;
  club: string;
  cover: PairCover;
}

/**
 * The candidates, best first: the operator's COUNT decides, the expectation breaks its ties.
 *
 * The tie-break is not a refinement, it is what makes the list readable: at the frozen margin twelve
 * Serie A clubs of twenty have no easy match all season, so on his rule alone most of the list is one
 * long tie at zero. Where the expectation does not exist (an unfitted championship) the order falls
 * back to the count and then to the club's name, so it is reproducible rather than arbitrary.
 *
 * The cover is a fact about the two CLUBS, so it is computed once per club and shared by every keeper
 * of it - the same reasoning that computes the board's pairs 25 times and not 250.
 */
export function rankPairs<T>(
  calendar: LeagueCalendar,
  mine: string,
  candidates: { man: T; club: string }[],
  from: number,
  to: number,
): PairSuggestion<T>[] {
  const ours = calendar.window(mine, from, to);
  const byClub = new Map<string, PairCover>();
  const out: PairSuggestion<T>[] = [];
  for (const candidate of candidates) {
    if (!calendar.has(candidate.club)) continue;
    let cover = byClub.get(candidate.club);
    if (!cover) {
      cover = pairCover(ours, calendar.window(candidate.club, from, to), candidate.club === mine);
      byClub.set(candidate.club, cover);
    }
    out.push({ man: candidate.man, club: candidate.club, cover });
  }
  return out.sort(
    (left, right) =>
      right.cover.facili - left.cover.facili ||
      (right.cover.covered ?? -1) - (left.cover.covered ?? -1) ||
      left.club.localeCompare(right.club, 'it'),
  );
}

/** One cell of the club x club grid. */
export interface GridCell {
  facili: number;
  covered: number | null;
  rows: PairRow[];
}

/**
 * The whole grid, clubs on both axes.
 *
 * Symmetric by construction, so only half of it is computed and both halves read the SAME object: two
 * passes over one question is how a cell and its mirror end up disagreeing. The diagonal is the club
 * ALONE - not paired with itself - which is the reading that makes it comparable with its own row.
 */
export function coverGrid(
  calendar: LeagueCalendar,
  clubs: string[],
  from: number,
  to: number,
): Map<string, Map<string, GridCell>> {
  const windows = new Map(clubs.map((club) => [club, calendar.window(club, from, to)]));
  const grid = new Map<string, Map<string, GridCell>>(clubs.map((club) => [club, new Map()]));
  for (let i = 0; i < clubs.length; i += 1) {
    for (let j = i; j < clubs.length; j += 1) {
      const cover = pairCover(windows.get(clubs[i]) ?? [], windows.get(clubs[j]) ?? [], i === j);
      const cell: GridCell = { facili: cover.facili, covered: cover.covered, rows: cover.rows };
      grid.get(clubs[i])!.set(clubs[j], cell);
      grid.get(clubs[j])!.set(clubs[i], cell);
    }
  }
  return grid;
}

/**
 * THE WHOLE BUNDLE'S CALENDAR: every championship it carries, and which one a club plays in.
 *
 * The league is read from the calendar ITSELF - a club is in the championship whose fixtures it
 * appears in - and never from the majority of its players' rows, which is the derivation this project
 * has already written down as wrong. Two clubs of two different championships cannot be paired at all
 * here and the caller must SAY so rather than align them by hand: a fanta matchday maps to a different
 * real round in each league (`matchday_map`), and for the target season that map carries five rows of
 * thirty-one - so aligning them would be inventing a calendar, not reading one.
 */
export class CalendarBook {
  private readonly byLeague = new Map<string, LeagueCalendar>();
  private readonly leagueByClub = new Map<string, string>();

  constructor(
    readonly file: CalendarFile,
    leagues: LeagueCalendar[],
  ) {
    for (const calendar of leagues) {
      this.byLeague.set(calendar.league, calendar);
      for (const club of calendar.clubNames()) this.leagueByClub.set(club, calendar.league);
    }
  }

  /** The championship a club plays in, by OUR canonical name. Null = the calendar has never seen it. */
  leagueOf(clubName: string): string | null {
    return this.leagueByClub.get(clubName) ?? null;
  }

  /** The calendar a club's matchdays are counted on. */
  forClub(clubName: string): LeagueCalendar | null {
    const league = this.leagueOf(clubName);
    return league == null ? null : (this.byLeague.get(league) ?? null);
  }
}

export function calendarBookFrom(file: CalendarFile | null): CalendarBook | null {
  if (!file?.leagues) return null;
  const leagues: LeagueCalendar[] = [];
  for (const name of Object.keys(file.leagues)) {
    const one = leagueCalendarFrom(file, name);
    if (one) leagues.push(one);
  }
  return leagues.length ? new CalendarBook(file, leagues) : null;
}

/** The bundle's file into the shape above. One reader, so nothing else parses the raw columns. */
export function leagueCalendarFrom(file: CalendarFile, league: string): LeagueCalendar | null {
  const one = file.leagues?.[league];
  if (!one) return null;
  return new LeagueCalendar(
    league,
    one.rounds,
    one.clean_sheet_fitted,
    one.clubs.map((club) => ({
      key: club.key,
      name: club.name,
      fcClubId: club.fc_club_id,
      elo: club.elo,
    })),
    one.matches,
    file.easy_margin,
  );
}
