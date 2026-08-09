import { Injectable, computed, inject, signal } from '@angular/core';

import { Bundle, BundleTable, columnIndex } from './bundle';

export type ClassicRole = 'P' | 'D' | 'C' | 'A';
export const CLASSIC_ROLES: ClassicRole[] = ['P', 'D', 'C', 'A'];

/** One match of one player: what the cell shows, plus what its tooltip explains. */
export interface MatchCell {
  matchday: number;
  vote: number | null;
  /** True when the vote is the calibrated synthetic one and not the fantacalcio vote. */
  voteSynthetic: boolean;
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
  date: string | null;
}

export interface PlayerRow {
  fcId: number;
  name: string;
  role: ClassicRole;
  mantra: string;
  club: string;
}

/** A player plus the cells of the window on screen. One cell per matchday, null = did not play. */
export interface PlayerLine extends PlayerRow {
  cells: (MatchCell | null)[];
}

/** Serie A only for now: on `euro` a matchday is a EuroLeghe round and the join to the
 *  provider's per-match layer has to go through `matchday_map`, which is a separate step. */
const PLATFORM = 'default';
const LEAGUE = 'serie_a';
const COLUMNS = 10;

type Status = 'idle' | 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class PlayersStore {
  private readonly bundle = inject(Bundle);

  readonly status = signal<Status>('idle');
  readonly error = signal<string | null>(null);
  readonly generatedAt = signal<string | null>(null);
  readonly demo = signal(false);

  private readonly roster = signal<PlayerRow[]>([]);
  /** season -> fc_id -> matchday -> cell */
  private readonly matches = signal<Map<string, Map<number, Map<number, MatchCell>>>>(new Map());

  readonly seasons = signal<string[]>([]);
  readonly season = signal<string>('');
  readonly lastMatchday = signal<number>(COLUMNS);
  readonly windowFrom = signal<number>(1);
  readonly windowTo = signal<number>(COLUMNS);

  readonly role = signal<ClassicRole | null>(null);
  readonly club = signal<string | null>(null);
  /** Alphabetical puts the fringe first and the first page comes out empty, which reads as a
   *  broken table. Default to who actually played in the period. */
  readonly sortBy = signal<'played' | 'name'>('played');

  readonly clubs = computed(() =>
    [...new Set(this.roster().map((p) => p.club))].filter(Boolean).sort((a, b) => a.localeCompare(b)),
  );

  /** The matchdays on screen: the last ten of the chosen period, so the columns line up
   *  across players and two rows can actually be compared. */
  readonly matchdays = computed(() => {
    const to = this.windowTo();
    const from = Math.max(this.windowFrom(), to - COLUMNS + 1);
    const days: number[] = [];
    for (let md = from; md <= to; md++) days.push(md);
    return days;
  });

  readonly lines = computed<PlayerLine[]>(() => {
    const bySeason = this.matches().get(this.season());
    const days = this.matchdays();
    const role = this.role();
    const club = this.club();
    const lines = this.roster()
      .filter((p) => (!role || p.role === role) && (!club || p.club === club))
      .map((p) => {
        const own = bySeason?.get(p.fcId);
        return { ...p, cells: days.map((md) => own?.get(md) ?? null) };
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
      const [players, clubs, rosters, ratings, external] = await Promise.all([
        this.bundle.table('players'),
        this.bundle.table('clubs'),
        this.bundle.table('rosters'),
        this.bundle.table('match_ratings'),
        this.bundle.table('external_match_stats'),
      ]);

      this.generatedAt.set(manifest.generated_at);
      this.demo.set(manifest.demo === true);
      this.roster.set(buildRoster(players, clubs, rosters, manifest.target_season));

      const provider = buildProviderIndex(external);
      const built = buildMatches(ratings, provider);
      this.matches.set(built.bySeason);

      const seasons = [...built.bySeason.keys()].sort();
      this.seasons.set(seasons);
      const latest = seasons.at(-1) ?? '';
      this.season.set(latest);
      this.selectSeason(latest);

      this.status.set('ready');
    } catch (err) {
      // One message per cause: the reason is in the error, not in a generic sentence.
      this.error.set(err instanceof Error ? err.message : String(err));
      this.status.set('error');
    }
  }

  selectSeason(season: string): void {
    this.season.set(season);
    const played = this.matches().get(season);
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

function buildRoster(
  players: BundleTable,
  clubs: BundleTable,
  rosters: BundleTable,
  targetSeason: string,
): PlayerRow[] {
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

  const out: PlayerRow[] = [];
  for (const row of rosters.rows) {
    if (row[rSeason] !== targetSeason || row[rLeague] !== LEAGUE) continue;
    const fcId = row[rId] as number;
    const role = row[rRoleClassic] as ClassicRole | null;
    if (!role) continue;
    out.push({
      fcId,
      name: names.get(fcId) ?? `#${fcId}`,
      role,
      mantra: mantraLabel(row[rRoles] as string | null),
      club: clubNames.get(row[rClub] as number) ?? '',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
  date: string | null;
}

/** The provider's per-match layer, keyed the way `match_ratings` can reach it: on `default`
 *  a matchday IS the real Serie A round, so (fc_id, season, real_md) is the whole join. */
function buildProviderIndex(external: BundleTable): Map<string, ProviderMatch> {
  const [fcId, season, competition, realMd, date, opponent, home, minutes, mvSynth] = columnIndex(
    external,
    'fc_id',
    'season',
    'competition',
    'real_md',
    'match_date',
    'opponent',
    'home',
    'minutes',
    'mv_synth',
  );
  const index = new Map<string, ProviderMatch>();
  for (const row of external.rows) {
    if (row[competition] !== LEAGUE || row[realMd] == null) continue;
    const key = `${row[fcId]}|${row[season]}|${row[realMd]}`;
    if (index.has(key)) continue;
    index.set(key, {
      opponent: (row[opponent] as string) ?? null,
      home: row[home] == null ? null : row[home] === 1,
      minutes: (row[minutes] as number) ?? null,
      voteSynth: (row[mvSynth] as number) ?? null,
      date: (row[date] as string) ?? null,
    });
  }
  return index;
}

/** The scoreline is derived INSIDE match_ratings and never by matching club names across
 *  sources: goals-for is the team's own goals plus its converted penalties (the column is net
 *  of penalties and own goals), goals-against is what its goalkeeper conceded. */
function buildMatches(ratings: BundleTable, provider: Map<string, ProviderMatch>) {
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

  const scores = new Map<string, { for: number; against: number | null }>();
  const rows = ratings.rows.filter((r) => r[platform] === PLATFORM);

  for (const row of rows) {
    const key = `${row[season]}|${row[matchday]}|${row[team]}`;
    let score = scores.get(key);
    if (!score) scores.set(key, (score = { for: 0, against: null }));
    score.for += ((row[goals] as number) ?? 0) + ((row[penScored] as number) ?? 0);
    if (row[role] === 'P' && row[conceded] != null) score.against = row[conceded] as number;
  }

  const bySeason = new Map<string, Map<number, Map<number, MatchCell>>>();
  for (const row of rows) {
    if (row[role] === 'ALL') continue; // the coach has a rating row and is not a player
    const s = row[season] as string;
    const id = row[fcId] as number;
    const md = row[matchday] as number;

    let seasonMap = bySeason.get(s);
    if (!seasonMap) bySeason.set(s, (seasonMap = new Map()));
    let playerMap = seasonMap.get(id);
    if (!playerMap) seasonMap.set(id, (playerMap = new Map()));

    const teamName = row[team] as string;
    const score = scores.get(`${s}|${md}|${teamName}`);
    const extra = provider.get(`${id}|${s}|${md}`);
    const realVote = row[mv] as number | null;

    playerMap.set(md, {
      matchday: md,
      vote: realVote ?? extra?.voteSynth ?? null,
      voteSynthetic: realVote == null && extra?.voteSynth != null,
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
      date: extra?.date ?? null,
    });
  }
  return { bySeason };
}
