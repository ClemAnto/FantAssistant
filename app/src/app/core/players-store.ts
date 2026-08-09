import { Injectable, computed, inject, signal } from '@angular/core';

import { Bundle, BundleTable, ScoringConfig, columnIndex, optionalIndex } from './bundle';

export type ClassicRole = 'P' | 'D' | 'C' | 'A';
export const CLASSIC_ROLES: ClassicRole[] = ['P', 'D', 'C', 'A'];

/** `default` = the classic Serie A listone (20 clubs, 38 rounds). `euro` = EuroLeghe (the five
 *  championships' top clubs, 31 rounds). They are two different games with two different
 *  calendars and two different quotations, so the platform is part of every key. */
export type Platform = 'default' | 'euro';

/** What the column is a match OF. The distinction is not cosmetic: only a league match has a
 *  fantacalcio vote, and only a league match has a scoreline we can derive. */
export type MatchKind = 'league' | 'cup' | 'friendly';

/** Why the cell looks the way it does. Measured on Serie A 2025-26 over the 499 quoted men and
 *  38 rounds: played or s.v. 45.9%, bench 14.9%, never in this championship 24.6%, injured
 *  7.6%, and only 6.9% genuinely unaccounted for. An empty cell used to be all five at once. */
export type CellState =
  | 'played'
  | 'no_vote'
  /** The match is on file and carries nothing measurable. NOT the same as `bench`: that
   *  reading was measured on the LEAGUE layer, where a row without minutes matches a man with
   *  no ratings row. In a friendly the provider often records the line-up and no minutes at
   *  all - 0 of Napoli's 63 rows in 2026-27 have any - so calling it a bench would be a claim
   *  about the player made out of a gap in the source. */
  | 'no_data'
  | 'bench'
  | 'injured'
  | 'not_in_league'
  | 'absent';

export interface MatchCell {
  kind: MatchKind;
  state: CellState;
  /** For `injured`: what the source says, and when the spell ran. */
  injury: { detail: string | null; from: string; to: string | null } | null;
  /** The role he was fielded in for THIS match, from the ratings row: the keeper's terms of
   *  the fantavoto only apply to a row that played as one. */
  role: string | null;
  competition: string;
  competitionLabel: string;
  /** Only a league match has one. */
  matchday: number | null;
  date: string | null;
  /** The fantacalcio vote, or the calibrated synthetic one. League matches only. */
  vote: number | null;
  voteSynthetic: boolean;
  /** The provider's own 1-10 rating. A DIFFERENT SCALE from the fantacalcio vote - it is all
   *  a cup or a friendly has, because those competitions are not calibrated (`mv_synth` is
   *  null on every one of them), and the two must never be shown as the same number. */
  providerRating: number | null;
  fantavoto: number | null;
  goals: number;
  assists: number;
  assistsSetPiece: number;
  penScored: number;
  penMissed: number;
  penSaved: number;
  ownGoals: number;
  goalsConceded: number | null;
  yellows: number;
  reds: number;
  minutes: number | null;
  team: string;
  opponent: string | null;
  home: boolean | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  /** The shape his club started with, from the line counts of that match's own line-up:
   *  `4-3-3`. Joined on (match_id, club) - two outputs of the SAME parser - and never by
   *  matching a club NAME across sources, which is how `coach_repertoire` once lost 13,830
   *  elevens of 24,042. */
  shape: string | null;
  /** Set only in the mixed view, when the week held more than one match for this player. */
  alsoInWeek?: number;
}

export interface PlayerRow {
  fcId: number;
  name: string;
  role: ClassicRole;
  mantra: string;
  club: string;
  league: string | null;
}

export interface PlayerLine extends PlayerRow {
  cells: (MatchCell | null)[];
}

/** One column of the mixed-competition view: a WEEK, so that a round spread over Friday to
 *  Monday and the midweek cup tie of the same week share a column across every player. */
export interface ColumnSlot {
  key: string;
  /** The matchday, the date, or - with one club on screen - the fixture: `Nap-Mil`. */
  label: string;
  /** The scoreline, on its own line under the label. Only when a club is selected. */
  detail: string | null;
  /** What kind of match the column is about - known only when one club is on screen, because
   *  without a filter a week holds a league round AND its cup ties AND friendlies at once. */
  kind: MatchKind | null;
  title: string;
}

const COLUMNS = 10;

/** The football week runs THURSDAY to WEDNESDAY, and that is measured rather than chosen: on
 *  Serie A 2025-26 a Monday-anchored week splits 28 matchdays of 38 across two columns, a
 *  Thursday-anchored one splits 4. Clustering by gaps does not work at all - across five
 *  leagues and their cups there is football almost every day, so 240 dates collapse into 14
 *  groups, one of them 59 days long. */
const WEEK_ANCHOR = 4; // Thursday, as Date#getUTCDay counts it (Sunday = 0)

function weekOf(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`);
  const back = (day.getUTCDay() - WEEK_ANCHOR + 7) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

/** The championships a player's own league rows live under: everything else in the per-match
 *  layer is another competition. Measured on the bundle, not guessed. */
const LEAGUE_COMPETITIONS = new Set([
  'serie_a',
  'premier_league',
  'la_liga',
  'bundesliga',
  'ligue_1',
  'serie_b',
]);

/** Friendlies and pre-season tournaments. An unknown slug deliberately does NOT land here: it
 *  falls into the "other competitions" bucket, where it is visible and labelled, rather than
 *  being silently dropped. */
const FRIENDLY_COMPETITIONS = new Set([
  'club-friendly-games',
  'como-cup',
  'emirates-cup',
  'kings-cup',
]);

const COMPETITION_LABELS: Record<string, string> = {
  serie_a: 'Serie A',
  premier_league: 'Premier League',
  la_liga: 'LaLiga',
  bundesliga: 'Bundesliga',
  ligue_1: 'Ligue 1',
  serie_b: 'Serie B',
  'uefa-champions-league': 'Champions League',
  'uefa-europa-league': 'Europa League',
  'uefa-europa-conference-league': 'Conference League',
  'club-world-championship': 'Mondiale per club',
  'coppa-italia': 'Coppa Italia',
  'fa-cup': 'FA Cup',
  'efl-cup': 'EFL Cup',
  'copa-del-rey': 'Copa del Rey',
  'dfb-pokal': 'DFB-Pokal',
  'coupe-de-france': 'Coupe de France',
  'club-friendly-games': 'Amichevole',
  'como-cup': 'Como Cup',
  'emirates-cup': 'Emirates Cup',
};

export function competitionLabel(slug: string): string {
  return (
    COMPETITION_LABELS[slug] ??
    slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function competitionKind(slug: string): MatchKind {
  if (LEAGUE_COMPETITIONS.has(slug)) return 'league';
  return FRIENDLY_COMPETITIONS.has(slug) ? 'friendly' : 'cup';
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class PlayersStore {
  private readonly bundle = inject(Bundle);

  readonly status = signal<Status>('idle');
  readonly error = signal<string | null>(null);
  readonly generatedAt = signal<string | null>(null);
  readonly demo = signal(false);
  readonly scoring = signal<ScoringConfig | null>(null);

  private readonly rosters = signal<Map<Platform, PlayerRow[]>>(new Map());
  /** `platform|season` -> fc_id -> matchday -> cell */
  private readonly league = signal<Map<string, Map<number, Map<number, MatchCell>>>>(new Map());
  /** season -> fc_id -> the cups and friendlies, already sorted by date */
  private readonly other = signal<Map<string, Map<number, MatchCell[]>>>(new Map());
  /** `platform|season` -> fc_id -> matchday -> why he is NOT in the ratings of that round */
  private readonly absence = signal<Map<string, Map<number, Map<number, MatchCell>>>>(new Map());

  readonly platform = signal<Platform>('default');
  readonly seasons = signal<string[]>([]);
  readonly season = signal<string>('');
  readonly lastMatchday = signal<number>(COLUMNS);
  readonly windowFrom = signal<number>(1);
  readonly windowTo = signal<number>(COLUMNS);

  readonly role = signal<ClassicRole | null>(null);
  readonly club = signal<string | null>(null);
  readonly sortBy = signal<'played' | 'name' | 'role'>('played');

  /** Which competitions the columns may show. Adding anything to `league` changes the unit of
   *  a column: a cup match has no matchday, so the columns become the player's last matches. */
  readonly withCups = signal(false);
  readonly withFriendlies = signal(false);
  readonly byMatchday = computed(() => !this.withCups() && !this.withFriendlies());

  readonly roster = computed(() => this.rosters().get(this.platform()) ?? []);

  readonly clubs = computed(() =>
    [...new Set(this.roster().map((p) => p.club))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  );

  readonly matchdays = computed(() => {
    const to = this.windowTo();
    const from = Math.max(this.windowFrom(), to - COLUMNS + 1);
    const days: number[] = [];
    for (let md = from; md <= to; md++) days.push(md);
    return days;
  });

  /** The players the filters keep. Both the axis and the rows are built from this and nothing
   *  else, so the columns describe the table you are looking at. */
  private readonly filtered = computed(() => {
    const role = this.role();
    const club = this.club();
    return this.roster().filter((p) => (!role || p.role === role) && (!club || p.club === club));
  });

  /** The shared axis of the mixed view: the last ten WEEKS in which anything was played BY THE
   *  PLAYERS ON SCREEN, so column 3 is the same week for every row and no column is spent on a
   *  week none of them played. Filter by club and the axis follows the club. */
  /** The columns, in both modes. With a club selected each one also names the fixture it is
   *  about - possible only then, because without a filter one week holds many matches. */
  readonly columns = computed<ColumnSlot[]>(() => {
    const slots = this.byMatchday() ? this.matchdaySlots() : this.weekSlots();
    if (!this.club()) return slots;
    const leagueBySeason = this.league().get(`${this.platform()}|${this.season()}`);
    const otherBySeason = this.other().get(this.season());
    const players = this.filtered();
    return slots.map((slot) => {
      // Any man of the club will do: they all played the same fixture.
      let chosen: MatchCell | undefined;
      for (const player of players) {
        const candidates = [
          ...(leagueBySeason?.get(player.fcId)?.values() ?? []),
          ...(otherBySeason?.get(player.fcId) ?? []),
        ];
        for (const cell of candidates) {
          if (this.slotOf(cell) !== slot.key) continue;
          if (!chosen || (chosen.kind !== 'league' && cell.kind === 'league')) chosen = cell;
        }
        if (chosen?.kind === 'league') break;
      }
      if (!chosen || (!chosen.opponent && !chosen.team)) return slot;
      const fixture = fixtureLabel(chosen);
      return {
        ...slot,
        label: fixture.label,
        detail: [fixture.detail ?? slot.label, chosen.shape].filter(Boolean).join(' · '),
        kind: chosen.kind,
        title: `${chosen.competitionLabel} · ${fixture.long}${chosen.shape ? ' · modulo ' + chosen.shape : ''} · ${slot.title}`,
      };
    });
  });

  /** Which column a cell belongs to: the matchday, or the week. */
  private slotOf(cell: MatchCell): string {
    if (this.byMatchday()) return cell.matchday == null ? '' : String(cell.matchday);
    return cell.date ? weekOf(cell.date) : '';
  }

  private readonly matchdaySlots = computed<ColumnSlot[]>(() =>
    this.matchdays().map((md) => ({
      key: String(md),
      label: String(md),
      detail: null,
      kind: null,
      title: `Giornata ${md}`,
    })),
  );

  private readonly weekSlots = computed<ColumnSlot[]>(() => {
    const season = this.season();
    const leagueBySeason = this.league().get(`${this.platform()}|${season}`);
    const otherBySeason = this.other().get(season);
    const wantCups = this.withCups();
    const wantFriendlies = this.withFriendlies();

    /** week -> the matchdays played in it, and the earliest date seen */
    const weeks = new Map<string, { matchdays: Set<number>; first: string; last: string }>();
    const note = (cell: MatchCell) => {
      const week = cell.date ? weekOf(cell.date) : null;
      if (!week) return;
      let entry = weeks.get(week);
      if (!entry) weeks.set(week, (entry = { matchdays: new Set(), first: cell.date!, last: cell.date! }));
      if (cell.matchday != null && cell.kind === 'league') entry.matchdays.add(cell.matchday);
      if (cell.date! < entry.first) entry.first = cell.date!;
      if (cell.date! > entry.last) entry.last = cell.date!;
    };
    for (const player of this.filtered()) {
      for (const cell of leagueBySeason?.get(player.fcId)?.values() ?? []) note(cell);
      for (const cell of otherBySeason?.get(player.fcId) ?? []) {
        if (cell.kind === 'cup' ? wantCups : wantFriendlies) note(cell);
      }
    }

    return [...weeks.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-COLUMNS)
      .map(([key, entry]) => {
        const days = [...entry.matchdays].sort((a, b) => a - b);
        const range =
          entry.first === entry.last ? day(entry.first) : `${day(entry.first)}-${day(entry.last)}`;
        return {
          key,
          label: days.length ? days.join('/') : day(entry.first).slice(0, 5),
          detail: null,
          kind: null,
          title: days.length ? `Giornata ${days.join(', ')} · ${range}` : range,
        };
      });
  });

  readonly lines = computed<PlayerLine[]>(() => {
    const season = this.season();
    const leagueBySeason = this.league().get(`${this.platform()}|${season}`);
    const absenceBySeason = this.absence().get(`${this.platform()}|${season}`);
    const otherBySeason = this.other().get(season);
    const days = this.matchdays();
    const byMatchday = this.byMatchday();
    const slots = this.weekSlots();
    const wantCups = this.withCups();
    const wantFriendlies = this.withFriendlies();

    const lines = this.filtered().map((p) => {
        const own = leagueBySeason?.get(p.fcId);
        if (byMatchday) {
          // A round he is not in the ratings of is not an empty cell: it has a reason, and the
          // reason is the point of the column.
          const missing = absenceBySeason?.get(p.fcId);
          return { ...p, cells: days.map((md) => own?.get(md) ?? missing?.get(md) ?? null) };
        }
        // Mixed competitions: a column is a WEEK of the shared axis, not this player's own
        // nth-from-last match - otherwise column 3 means a different date on every row.
        const matches = [...(own?.values() ?? [])];
        for (const cell of otherBySeason?.get(p.fcId) ?? []) {
          if (cell.kind === 'cup' ? wantCups : wantFriendlies) matches.push(cell);
        }
        const byWeek = new Map<string, MatchCell[]>();
        for (const cell of matches) {
          if (!cell.date) continue; // no date, no column it can honestly sit in
          const week = weekOf(cell.date);
          const list = byWeek.get(week);
          list ? list.push(cell) : byWeek.set(week, [cell]);
        }
        return {
          ...p,
          cells: slots.map((slot) => {
            const week = byWeek.get(slot.key);
            if (!week?.length) return null;
            // Two matches in one week: the league one is the column's subject, the other is
            // named in the tooltip rather than dropped in silence.
            const chosen = week.find((c) => c.kind === 'league') ?? week[0];
            return week.length > 1 ? { ...chosen, alsoInWeek: week.length - 1 } : chosen;
          }),
        };
      });

    if (this.sortBy() === 'role') {
      const order: Record<ClassicRole, number> = { P: 0, D: 1, C: 2, A: 3 };
      lines.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
    } else if (this.sortBy() === 'played') {
      // Counting non-empty cells would now count the ABSENCES too - every round has a cell
      // since they carry their reason. What the operator asked to sort by is appearances.
      const played = (line: PlayerLine) =>
        line.cells.reduce((n, c) => n + (c && (c.state === 'played' || c.state === 'no_vote') ? 1 : 0), 0);
      lines.sort((a, b) => played(b) - played(a) || a.name.localeCompare(b.name));
    }
    return lines;
  });

  async load(): Promise<void> {
    if (this.status() === 'loading' || this.status() === 'ready') return;
    this.status.set('loading');
    this.error.set(null);
    try {
      const manifest = await this.bundle.manifest();
      const [players, clubs, rosters, quotes, ratings, external, map, injuries, lineups, scoring] =
        await Promise.all([
        this.bundle.table('players'),
        this.bundle.table('clubs'),
        this.bundle.table('rosters'),
        this.bundle.table('listone_quotes'),
        this.bundle.table('match_ratings'),
        this.bundle.table('external_match_stats'),
        this.bundle.table('matchday_map'),
        this.bundle.table('injuries'),
        this.bundle.table('club_match_lineups'),
        // A missing scoring file must not take the table down with it: the panel then shows
        // the events without their points, which is less than the truth but never a wrong one.
        this.bundle.scoring().catch(() => null),
      ]);

      this.generatedAt.set(manifest.generated_at);
      this.demo.set(manifest.demo === true);
      this.scoring.set(scoring);

      const roster = buildRosters(players, clubs, rosters, quotes, manifest.target_season);
      this.rosters.set(roster);

      const leagueOf = new Map<number, string | null>();
      for (const list of roster.values()) for (const p of list) leagueOf.set(p.fcId, p.league);

      const provider = buildProviderIndex(external);
      const euroToReal = buildMatchdayMap(map);
      const shapes = buildShapes(lineups);
      const built = buildLeagueMatches(ratings, provider.index, leagueOf, euroToReal, shapes);
      this.league.set(built);
      this.absence.set(
        buildAbsences(built, roster, provider, euroToReal, buildInjuries(injuries)),
      );

      const seasons = [
        ...new Set([...built.keys()].map((key) => key.split('|')[1])),
        manifest.target_season,
      ].sort();
      this.seasons.set(seasons);
      this.other.set(buildOtherMatches(external, new Set(seasons), leagueOf, shapes));

      this.selectSeason(seasons.at(-2) ?? seasons.at(-1) ?? '');
      this.status.set('ready');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.status.set('error');
    }
  }

  selectPlatform(platform: Platform): void {
    this.platform.set(platform);
    this.club.set(null); // the club lists do not overlap: keeping a filter would empty the table
    this.selectSeason(this.season());
  }

  selectSeason(season: string): void {
    this.season.set(season);
    const played = this.league().get(`${this.platform()}|${season}`);
    let last = COLUMNS;
    if (played) {
      for (const byDay of played.values()) {
        for (const md of byDay.keys()) if (md > last) last = md;
      }
    }
    this.lastMatchday.set(last);
    this.windowFrom.set(Math.max(1, last - COLUMNS + 1));
    this.windowTo.set(last);
  }

  setWindow([from, to]: [number, number]): void {
    this.windowFrom.set(from);
    this.windowTo.set(to);
  }
}

/** Sorting mixed competitions needs one axis, and it is the date. A league match whose
 *  provider row did not match has no date, so it falls back to a position derived from its
 *  matchday - approximate, and better than dropping it to the front of the list. */
/** Club-form words neither side of a fixture label needs. */
const ABBREVIATION_SKIP = new Set(['ac', 'as', 'ss', 'ssc', 'fc', 'rc', 'afc', 'us', 'ol', 'rb']);

/** `Napoli` -> `Nap`, `Borussia Dortmund` -> `Bor`, `AC Milan` -> `Mil`. Three letters is what
 *  fits a column; the full fixture stays in the header's title. */
function abbreviate(name: string | null): string {
  if (!name) return '???';
  const words = name.split(/\s+/).filter((w) => w && !ABBREVIATION_SKIP.has(w.toLowerCase()));
  return (words[0] ?? name).slice(0, 3);
}

/** The fixture as it is written: home first. */
function fixtureLabel(cell: MatchCell): { label: string; detail: string | null; long: string } {
  const away = cell.home === false;
  const left = away ? cell.opponent : cell.team;
  const right = away ? cell.team : cell.opponent;
  const leftGoals = away ? cell.goalsAgainst : cell.goalsFor;
  const rightGoals = away ? cell.goalsFor : cell.goalsAgainst;
  const score =
    leftGoals != null && rightGoals != null ? `${leftGoals}-${rightGoals}` : null;
  return {
    label: `${abbreviate(left)}-${abbreviate(right)}`,
    detail: score,
    long: `${left ?? 'Ignota'} - ${right ?? 'Ignota'}${score ? ' ' + score : ''}`,
  };
}

/** dd/mm/yyyy: a date in a header is read by a person. */
function day(iso: string): string {
  return iso.split('-').reverse().join('/');
}

function sortKey(cell: MatchCell, season: string): number {
  if (cell.date) return Date.parse(cell.date);
  const startYear = Number(season.slice(0, 4));
  return Date.UTC(startYear, 7, 20) + (cell.matchday ?? 0) * 7 * 86400000;
}

function buildRosters(
  players: BundleTable,
  clubs: BundleTable,
  rosters: BundleTable,
  quotes: BundleTable,
  targetSeason: string,
): Map<Platform, PlayerRow[]> {
  const [pId, pName] = columnIndex(players, 'fc_id', 'canonical_name');
  const names = new Map<number, string>();
  for (const row of players.rows) names.set(row[pId] as number, row[pName] as string);

  const [cId, cName] = columnIndex(clubs, 'fc_club_id', 'canonical_name');
  const clubNames = new Map<number, string>();
  for (const row of clubs.rows) clubNames.set(row[cId] as number, row[cName] as string);

  const [rId, rSeason, rClub, rRoles, rRoleClassic, rLeague] = columnIndex(
    rosters,
    'fc_id',
    'season',
    'fc_club_id',
    'roles',
    'role_classic',
    'league',
  );
  const byId = new Map<number, PlayerRow>();
  for (const row of rosters.rows) {
    if (row[rSeason] !== targetSeason) continue;
    const fcId = row[rId] as number;
    const role = row[rRoleClassic] as ClassicRole | null;
    if (!role) continue;
    byId.set(fcId, {
      fcId,
      name: names.get(fcId) ?? `#${fcId}`,
      role,
      mantra: mantraLabel(row[rRoles] as string | null),
      club: clubNames.get(row[rClub] as number) ?? '',
      league: (row[rLeague] as string) ?? null,
    });
  }

  /* WHO is on a platform is the quotation's business, not the roster's: `rosters` holds one
   * row per player while the two listoni are two different games, so the perimeter comes
   * from `listone_quotes` - the table that exists precisely because of that. */
  const [qId, qSeason, qPlatform] = columnIndex(quotes, 'fc_id', 'season', 'platform');
  const out = new Map<Platform, PlayerRow[]>([
    ['default', []],
    ['euro', []],
  ]);
  for (const row of quotes.rows) {
    if (row[qSeason] !== targetSeason) continue;
    const player = byId.get(row[qId] as number);
    const list = out.get(row[qPlatform] as Platform);
    if (player && list) list.push(player);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function mantraLabel(roles: string | null): string {
  if (!roles) return '';
  return roles
    .split(';')
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => code[0].toUpperCase() + code.slice(1))
    .join(' ');
}

interface ProviderMatch {
  matchId: string | null;
  club: string | null;
  opponent: string | null;
  home: boolean | null;
  minutes: number | null;
  voteSynth: number | null;
  rating: number | null;
  date: string | null;
}

/** Keyed on (fc_id, season, competition, real_md): the competition belongs in the key because
 *  a player can have a league round and a cup tie under the same number. */
function buildProviderIndex(external: BundleTable): {
  index: Map<string, ProviderMatch>;
  present: Set<string>;
  roundDates: Map<string, string>;
} {
  const [fcId, season, competition, realMd, date, club, opponent, home, minutes, rating, mvSynth,
    matchId] = columnIndex(
      external,
      'fc_id',
      'season',
      'competition',
      'real_md',
      'match_date',
      'club',
      'opponent',
      'home',
      'minutes',
      'rating',
      'mv_synth',
      'match_id',
    );
  const index = new Map<string, ProviderMatch>();
  /** He appears in this championship this season - on the pitch or on the bench. Without it a
   *  man who never left the bench would read as "never in this league". */
  const present = new Set<string>();
  /** When a round was played, taken from the earliest match of that round: an absence has no
   *  date of its own, and an injury spell has to be checked against something. */
  const roundDates = new Map<string, string>();
  for (const row of external.rows) {
    if (row[realMd] == null || !LEAGUE_COMPETITIONS.has(row[competition] as string)) continue;
    present.add(`${row[fcId]}|${row[season]}|${row[competition]}`);
    const matchDate = (row[date] as string) ?? null;
    const roundKey = `${row[season]}|${row[competition]}|${row[realMd]}`;
    if (matchDate && (!roundDates.has(roundKey) || matchDate < roundDates.get(roundKey)!)) {
      roundDates.set(roundKey, matchDate);
    }
    const key = `${row[fcId]}|${row[season]}|${row[competition]}|${row[realMd]}`;
    if (index.has(key)) continue;
    index.set(key, {
      matchId: (row[matchId] as string) ?? null,
      club: (row[club] as string) ?? null,
      opponent: (row[opponent] as string) ?? null,
      home: row[home] == null ? null : row[home] === 1,
      minutes: (row[minutes] as number) ?? null,
      voteSynth: (row[mvSynth] as number) ?? null,
      rating: (row[rating] as number) ?? null,
      date: matchDate,
    });
  }
  return { index, present, roundDates };
}

/** One EuroLeghe round bundles a DIFFERENT real round in each of the five championships, so
 *  the map is keyed by league too. Without it the euro columns would join the provider layer
 *  on a number that means something else. */
function buildMatchdayMap(map: BundleTable): Map<string, number> {
  const [season, euroMd, league, realMd] = columnIndex(
    map,
    'season',
    'euro_md',
    'league',
    'real_md',
  );
  const index = new Map<string, number>();
  for (const row of map.rows) {
    index.set(`${row[season]}|${row[euroMd]}|${row[league]}`, row[realMd] as number);
  }
  return index;
}

function buildLeagueMatches(
  ratings: BundleTable,
  provider: Map<string, ProviderMatch>,
  leagueOf: Map<number, string | null>,
  euroToReal: Map<string, number>,
  shapes: Map<string, string>,
) {
  const [
    fcId,
    season,
    matchday,
    role,
    team,
    platform,
    mv,
    goals,
    assists,
    ownGoals,
    penScored,
    penMissed,
    conceded,
    yellows,
    reds,
    fantavoto,
    assistsSetPiece,
    penSaved,
  ] = columnIndex(
    ratings,
    'fc_id',
    'season',
    'matchday',
    'role',
    'team',
    'platform',
    'mv',
    'goals',
    'assists',
    'own_goals',
    'pen_scored',
    'pen_missed',
    'goals_conceded',
    'yellows',
    'reds',
    'fantavoto',
    'assists_set_piece',
    'pen_saved',
  );

  /* The scoreline is derived inside match_ratings and never by matching club names across
   * sources: goals-for is the team's own goals plus its converted penalties, goals-against is
   * what its goalkeeper conceded. */
  const scores = new Map<string, { for: number; against: number | null }>();
  for (const row of ratings.rows) {
    const key = `${row[platform]}|${row[season]}|${row[matchday]}|${row[team]}`;
    let score = scores.get(key);
    if (!score) scores.set(key, (score = { for: 0, against: null }));
    score.for += ((row[goals] as number) ?? 0) + ((row[penScored] as number) ?? 0);
    if (row[role] === 'P' && row[conceded] != null) score.against = row[conceded] as number;
  }

  const out = new Map<string, Map<number, Map<number, MatchCell>>>();
  for (const row of ratings.rows) {
    if (row[role] === 'ALL') continue; // the coach has a rating row and is not a player
    const plat = row[platform] as Platform;
    const s = row[season] as string;
    const id = row[fcId] as number;
    const md = row[matchday] as number;
    const key = `${plat}|${s}`;

    let seasonMap = out.get(key);
    if (!seasonMap) out.set(key, (seasonMap = new Map()));
    let playerMap = seasonMap.get(id);
    if (!playerMap) seasonMap.set(id, (playerMap = new Map()));

    // On `default` the matchday IS the real round; on `euro` it is a EuroLeghe round and has
    // to be translated, per league, before the provider layer can be reached at all.
    const league = leagueOf.get(id) ?? null;
    const realMd = plat === 'euro' ? euroToReal.get(`${s}|${md}|${league}`) : md;
    const extra =
      league && realMd != null ? provider.get(`${id}|${s}|${league}|${realMd}`) : undefined;

    const teamName = row[team] as string;
    const score = scores.get(`${plat}|${s}|${md}|${teamName}`);
    const realVote = row[mv] as number | null;

    playerMap.set(md, {
      kind: 'league',
      state: realVote == null && extra?.voteSynth == null ? 'no_vote' : 'played',
      injury: null,
      role: (row[role] as string) ?? null,
      competition: league ?? '',
      competitionLabel: league ? competitionLabel(league) : 'Campionato',
      matchday: md,
      date: extra?.date ?? null,
      vote: realVote ?? extra?.voteSynth ?? null,
      voteSynthetic: realVote == null && extra?.voteSynth != null,
      providerRating: extra?.rating ?? null,
      fantavoto: (row[fantavoto] as number) ?? null,
      goals: (row[goals] as number) ?? 0,
      assists: (row[assists] as number) ?? 0,
      assistsSetPiece: (row[assistsSetPiece] as number) ?? 0,
      penScored: (row[penScored] as number) ?? 0,
      penMissed: (row[penMissed] as number) ?? 0,
      penSaved: (row[penSaved] as number) ?? 0,
      ownGoals: (row[ownGoals] as number) ?? 0,
      goalsConceded: (row[conceded] as number) ?? null,
      yellows: (row[yellows] as number) ?? 0,
      reds: (row[reds] as number) ?? 0,
      minutes: extra?.minutes ?? null,
      team: teamName,
      opponent: extra?.opponent ?? null,
      home: extra?.home ?? null,
      goalsFor: score?.for ?? null,
      goalsAgainst: score?.against ?? null,
      shape: extra ? (shapes.get(`${extra.matchId}|${extra.club}`) ?? null) : null,
    });
  }
  return out;
}

/** Cups, friendlies and anything else the provider recorded that is not the player's league.
 *  None of these carries a fantacalcio vote, and none is a calibrated competition, so
 *  `mv_synth` is null on every one of them - all they have is the provider's own rating. */
function buildOtherMatches(
  external: BundleTable,
  seasons: Set<string>,
  leagueOf: Map<number, string | null>,
  shapes: Map<string, string>,
): Map<string, Map<number, MatchCell[]>> {
  const [fcId, season, competition, date, club, opponent, home, minutes, rating, goals, assists,
    yellows, reds, matchIdOther] = columnIndex(
      external,
      'fc_id',
      'season',
      'competition',
      'match_date',
      'club',
      'opponent',
      'home',
      'minutes',
      'rating',
      'goals',
      'assists',
      'yellows',
      'reds',
      'match_id',
    );
  // The scoreline the provider published - a cup or a friendly has no ratings row to derive one
  // from. Optional: a bundle exported before 09/08/2026 has no such column, and that is a gap in
  // the data, not a reason to refuse to draw the table.
  const teamGoals = optionalIndex(external, 'team_goals');
  const opponentGoals = optionalIndex(external, 'opponent_goals');

  const out = new Map<string, Map<number, MatchCell[]>>();
  for (const row of external.rows) {
    const s = row[season] as string;
    if (!seasons.has(s)) continue;
    const slug = row[competition] as string;
    const kind = competitionKind(slug);
    // His own championship is already covered by the ratings; another country's league is
    // not a cup, but it is football he played and it belongs in "other competitions".
    if (kind === 'league' && slug === leagueOf.get(row[fcId] as number)) continue;

    let seasonMap = out.get(s);
    if (!seasonMap) out.set(s, (seasonMap = new Map()));
    const id = row[fcId] as number;
    let list = seasonMap.get(id);
    if (!list) seasonMap.set(id, (list = []));

    list.push({
      kind: kind === 'league' ? 'cup' : kind,
      state:
        (row[minutes] as number | null) == null && (row[rating] as number | null) == null
          ? 'no_data'
          : 'played',
      injury: null,
      role: null,
      competition: slug,
      competitionLabel: competitionLabel(slug),
      matchday: null,
      date: (row[date] as string) ?? null,
      vote: null,
      voteSynthetic: false,
      providerRating: (row[rating] as number) ?? null,
      fantavoto: null,
      goals: (row[goals] as number) ?? 0,
      assists: (row[assists] as number) ?? 0,
      assistsSetPiece: 0,
      penScored: 0,
      penMissed: 0,
      penSaved: 0,
      ownGoals: 0,
      goalsConceded: null,
      yellows: (row[yellows] as number) ?? 0,
      reds: (row[reds] as number) ?? 0,
      minutes: (row[minutes] as number) ?? null,
      team: (row[club] as string) ?? '',
      opponent: (row[opponent] as string) ?? null,
      home: row[home] == null ? null : row[home] === 1,
      goalsFor: teamGoals < 0 ? null : ((row[teamGoals] as number) ?? null),
      goalsAgainst: opponentGoals < 0 ? null : ((row[opponentGoals] as number) ?? null),
      shape: shapes.get(`${row[matchIdOther]}|${row[club]}`) ?? null,
    });
  }
  for (const seasonMap of out.values()) {
    for (const list of seasonMap.values()) {
      list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    }
  }
  return out;
}

interface InjurySpell {
  from: string;
  to: string | null;
  detail: string | null;
}

/** The shape a club STARTED a match with, from the counts of its own line-up: `4-3-3`. Keyed on
 *  (match_id, club), both written by the same parser from the same payload - so this is not a
 *  name join across sources. Only complete elevens count: 24,378 rows of 24,379 have eleven
 *  starters, and the odd one out cannot say a shape. */
function buildShapes(lineups: BundleTable): Map<string, string> {
  const [matchId, club, starters, defenders, midfielders, forwards] = columnIndex(
    lineups,
    'match_id',
    'club',
    'starters',
    'defenders',
    'midfielders',
    'forwards',
  );
  const out = new Map<string, string>();
  for (const row of lineups.rows) {
    if (row[starters] !== 11) continue;
    out.set(
      `${row[matchId]}|${row[club]}`,
      `${row[defenders]}-${row[midfielders]}-${row[forwards]}`,
    );
  }
  return out;
}

/** Dated spells from the source, over EVERY competition: the question they answer is "was he
 *  injured on this date", which is exactly what an empty round needs asking. */
function buildInjuries(injuries: BundleTable): Map<number, InjurySpell[]> {
  const [fcId, start, end, detail] = columnIndex(
    injuries,
    'fc_id',
    'start_date',
    'end_date',
    'detail',
  );
  const out = new Map<number, InjurySpell[]>();
  for (const row of injuries.rows) {
    const from = row[start] as string | null;
    if (!from) continue;
    const id = row[fcId] as number;
    let list = out.get(id);
    if (!list) out.set(id, (list = []));
    list.push({ from, to: (row[end] as string) ?? null, detail: (row[detail] as string) ?? null });
  }
  return out;
}

/**
 * Why a player is missing from a round's ratings. Five answers, in this order:
 * he was on the BENCH (the provider has his row with no minutes - 5,068 such rows against
 * 5,070 with no rating at all, which is what makes the reading safe); he was NEVER IN THIS
 * CHAMPIONSHIP that season (123 of the 499 quoted men, and calling that "left out" would be a
 * category error); he was INJURED on the day the round was played; or nothing accounts for it,
 * and the cell says exactly that rather than inventing a reason.
 *
 * The order matters: "not in this league" comes before "injured" because a Ligue 1 man's
 * injury has no business being read as a missed Serie A round.
 */
function buildAbsences(
  league: Map<string, Map<number, Map<number, MatchCell>>>,
  rosters: Map<Platform, PlayerRow[]>,
  provider: {
    index: Map<string, ProviderMatch>;
    present: Set<string>;
    roundDates: Map<string, string>;
  },
  euroToReal: Map<string, number>,
  injuries: Map<number, InjurySpell[]>,
): Map<string, Map<number, Map<number, MatchCell>>> {
  const out = new Map<string, Map<number, Map<number, MatchCell>>>();

  for (const [key, bySeason] of league) {
    const [platform, season] = key.split('|') as [Platform, string];
    let lastMd = 0;
    for (const byDay of bySeason.values()) {
      for (const md of byDay.keys()) if (md > lastMd) lastMd = md;
    }
    if (!lastMd) continue;

    const seasonOut = new Map<number, Map<number, MatchCell>>();
    for (const player of rosters.get(platform) ?? []) {
      const own = bySeason.get(player.fcId);
      const competition = player.league;
      if (!competition) continue; // no championship on his roster row: nothing to be absent from
      const everThere =
        (own?.size ?? 0) > 0 || provider.present.has(`${player.fcId}|${season}|${competition}`);
      const spells = injuries.get(player.fcId) ?? [];
      const missing = new Map<number, MatchCell>();

      for (let md = 1; md <= lastMd; md++) {
        if (own?.has(md)) continue;
        const realMd = platform === 'euro' ? euroToReal.get(`${season}|${md}|${competition}`) : md;
        if (realMd == null) continue;
        const roundKey = `${season}|${competition}|${realMd}`;
        const when = provider.roundDates.get(roundKey) ?? null;
        const bench = provider.index.get(`${player.fcId}|${season}|${competition}|${realMd}`);

        let state: CellState;
        let injury: MatchCell['injury'] = null;
        if (bench) {
          state = 'bench';
        } else if (!everThere) {
          state = 'not_in_league';
        } else {
          const spell = when
            ? spells.find((s) => s.from <= when && when <= (s.to ?? '2100-01-01'))
            : undefined;
          if (spell) {
            state = 'injured';
            injury = { detail: spell.detail, from: spell.from, to: spell.to };
          } else {
            state = 'absent';
          }
        }

        missing.set(md, {
          kind: 'league',
          state,
          injury,
          role: null,
          competition,
          competitionLabel: competitionLabel(competition),
          matchday: md,
          date: bench?.date ?? when,
          vote: null,
          voteSynthetic: false,
          providerRating: null,
          fantavoto: null,
          goals: 0,
          assists: 0,
          assistsSetPiece: 0,
          penScored: 0,
          penMissed: 0,
          penSaved: 0,
          ownGoals: 0,
          goalsConceded: null,
          yellows: 0,
          reds: 0,
          // A bench row knows he was there and against whom; it does NOT get a scoreline,
          // because reaching one would mean joining the provider's club name to the ratings'
          // spelling, and a name join is the defect this project keeps paying for.
          minutes: bench ? 0 : null,
          team: bench?.club ?? '',
          opponent: bench?.opponent ?? null,
          home: bench?.home ?? null,
          goalsFor: null,
          goalsAgainst: null,
          shape: null,
        });
      }
      if (missing.size) seasonOut.set(player.fcId, missing);
    }
    if (seasonOut.size) out.set(key, seasonOut);
  }
  return out;
}
