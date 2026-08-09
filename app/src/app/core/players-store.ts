import { Injectable, computed, inject, signal } from '@angular/core';

import { Bundle, BundleTable, columnIndex } from './bundle';

export type ClassicRole = 'P' | 'D' | 'C' | 'A';
export const CLASSIC_ROLES: ClassicRole[] = ['P', 'D', 'C', 'A'];

/** `default` = the classic Serie A listone (20 clubs, 38 rounds). `euro` = EuroLeghe (the five
 *  championships' top clubs, 31 rounds). They are two different games with two different
 *  calendars and two different quotations, so the platform is part of every key. */
export type Platform = 'default' | 'euro';

/** What the column is a match OF. The distinction is not cosmetic: only a league match has a
 *  fantacalcio vote, and only a league match has a scoreline we can derive. */
export type MatchKind = 'league' | 'cup' | 'friendly';

export interface MatchCell {
  kind: MatchKind;
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
  penScored: number;
  penMissed: number;
  ownGoals: number;
  yellows: number;
  reds: number;
  minutes: number | null;
  team: string;
  opponent: string | null;
  home: boolean | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
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

const COLUMNS = 10;

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

  private readonly rosters = signal<Map<Platform, PlayerRow[]>>(new Map());
  /** `platform|season` -> fc_id -> matchday -> cell */
  private readonly league = signal<Map<string, Map<number, Map<number, MatchCell>>>>(new Map());
  /** season -> fc_id -> the cups and friendlies, already sorted by date */
  private readonly other = signal<Map<string, Map<number, MatchCell[]>>>(new Map());

  readonly platform = signal<Platform>('default');
  readonly seasons = signal<string[]>([]);
  readonly season = signal<string>('');
  readonly lastMatchday = signal<number>(COLUMNS);
  readonly windowFrom = signal<number>(1);
  readonly windowTo = signal<number>(COLUMNS);

  readonly role = signal<ClassicRole | null>(null);
  readonly club = signal<string | null>(null);
  readonly sortBy = signal<'played' | 'name'>('played');

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

  readonly lines = computed<PlayerLine[]>(() => {
    const season = this.season();
    const leagueBySeason = this.league().get(`${this.platform()}|${season}`);
    const otherBySeason = this.other().get(season);
    const days = this.matchdays();
    const role = this.role();
    const club = this.club();
    const byMatchday = this.byMatchday();
    const wantCups = this.withCups();
    const wantFriendlies = this.withFriendlies();

    const lines = this.roster()
      .filter((p) => (!role || p.role === role) && (!club || p.club === club))
      .map((p) => {
        const own = leagueBySeason?.get(p.fcId);
        if (byMatchday) {
          return { ...p, cells: days.map((md) => own?.get(md) ?? null) };
        }
        // Mixed competitions: a column is a MATCH, and the only order they share is the date.
        const matches = [...(own?.values() ?? [])];
        for (const cell of otherBySeason?.get(p.fcId) ?? []) {
          if (cell.kind === 'cup' ? wantCups : wantFriendlies) matches.push(cell);
        }
        matches.sort((a, b) => sortKey(a, season) - sortKey(b, season));
        const last = matches.slice(-COLUMNS);
        const pad = Array<MatchCell | null>(Math.max(0, COLUMNS - last.length)).fill(null);
        return { ...p, cells: [...pad, ...last] };
      });

    if (this.sortBy() === 'played') {
      const played = (line: PlayerLine) => line.cells.reduce((n, c) => n + (c ? 1 : 0), 0);
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
      const [players, clubs, rosters, quotes, ratings, external, map] = await Promise.all([
        this.bundle.table('players'),
        this.bundle.table('clubs'),
        this.bundle.table('rosters'),
        this.bundle.table('listone_quotes'),
        this.bundle.table('match_ratings'),
        this.bundle.table('external_match_stats'),
        this.bundle.table('matchday_map'),
      ]);

      this.generatedAt.set(manifest.generated_at);
      this.demo.set(manifest.demo === true);

      const roster = buildRosters(players, clubs, rosters, quotes, manifest.target_season);
      this.rosters.set(roster);

      const leagueOf = new Map<number, string | null>();
      for (const list of roster.values()) for (const p of list) leagueOf.set(p.fcId, p.league);

      const provider = buildProviderIndex(external);
      const euroToReal = buildMatchdayMap(map);
      const built = buildLeagueMatches(ratings, provider, leagueOf, euroToReal);
      this.league.set(built);

      const seasons = [
        ...new Set([...built.keys()].map((key) => key.split('|')[1])),
        manifest.target_season,
      ].sort();
      this.seasons.set(seasons);
      this.other.set(buildOtherMatches(external, new Set(seasons), leagueOf));

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
  opponent: string | null;
  home: boolean | null;
  minutes: number | null;
  voteSynth: number | null;
  rating: number | null;
  date: string | null;
}

/** Keyed on (fc_id, season, competition, real_md): the competition belongs in the key because
 *  a player can have a league round and a cup tie under the same number. */
function buildProviderIndex(external: BundleTable): Map<string, ProviderMatch> {
  const [fcId, season, competition, realMd, date, opponent, home, minutes, rating, mvSynth] =
    columnIndex(
      external,
      'fc_id',
      'season',
      'competition',
      'real_md',
      'match_date',
      'opponent',
      'home',
      'minutes',
      'rating',
      'mv_synth',
    );
  const index = new Map<string, ProviderMatch>();
  for (const row of external.rows) {
    if (row[realMd] == null || !LEAGUE_COMPETITIONS.has(row[competition] as string)) continue;
    const key = `${row[fcId]}|${row[season]}|${row[competition]}|${row[realMd]}`;
    if (index.has(key)) continue;
    index.set(key, {
      opponent: (row[opponent] as string) ?? null,
      home: row[home] == null ? null : row[home] === 1,
      minutes: (row[minutes] as number) ?? null,
      voteSynth: (row[mvSynth] as number) ?? null,
      rating: (row[rating] as number) ?? null,
      date: (row[date] as string) ?? null,
    });
  }
  return index;
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
      penScored: (row[penScored] as number) ?? 0,
      penMissed: (row[penMissed] as number) ?? 0,
      ownGoals: (row[ownGoals] as number) ?? 0,
      yellows: (row[yellows] as number) ?? 0,
      reds: (row[reds] as number) ?? 0,
      minutes: extra?.minutes ?? null,
      team: teamName,
      opponent: extra?.opponent ?? null,
      home: extra?.home ?? null,
      goalsFor: score?.for ?? null,
      goalsAgainst: score?.against ?? null,
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
): Map<string, Map<number, MatchCell[]>> {
  const [fcId, season, competition, date, club, opponent, home, minutes, rating, goals, assists, yellows, reds] =
    columnIndex(
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
    );

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
      penScored: 0,
      penMissed: 0,
      ownGoals: 0,
      yellows: (row[yellows] as number) ?? 0,
      reds: (row[reds] as number) ?? 0,
      minutes: (row[minutes] as number) ?? null,
      team: (row[club] as string) ?? '',
      opponent: (row[opponent] as string) ?? null,
      home: row[home] == null ? null : row[home] === 1,
      goalsFor: null,
      goalsAgainst: null,
    });
  }
  for (const seasonMap of out.values()) {
    for (const list of seasonMap.values()) {
      list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    }
  }
  return out;
}
