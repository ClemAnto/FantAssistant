import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle } from '../../core/bundle';
import { COVER_OK, DraftPlace, draftPitchOf, placeYield, recommendedModules } from '../../core/draft-pitch';
import { ExpectedPlay } from '../../core/expected-play';
import { FantaMan } from '../../core/fanta-eleven';
import { LEGHE } from '../../core/leghe-api';
import { ModuleLine } from '../../core/mantra-legal';
import { CardKey, CardMan, CardStack, clubCard, clubOfCard, playerCard, playerOfCard } from '../../core/player-card';
import { EDGE_BASE, Role } from '../../core/plancia';
import { TrendCell, VOTE_TREND_MATCHES, trendPointsMean, trendVoteMean } from '../../core/player-trend';
import { Platform, PlayersStore } from '../../core/players-store';
import { RosterFileStore, leagueOfFile } from '../../core/roster-file';
import { SeasonLine, seasonLineFromMatches, seasonLines, seasonLinesFromSheet } from '../../core/season-line';
import { ScoutMan, ScoutRole, ScoutSquad } from '../../core/scout';
import { PlaceTarget, Standing, fantaManOf, keeperZeroOf, placePoints, placeTargets, placesOf, standingsOf } from '../../core/scout-pitch';
import { ValuationStore } from '../../core/valuation-store';
import { storedJson } from '../../core/view-state';
import { AppHeader } from '../../ui/app-header/app-header';
import { ClubCard } from '../../ui/club-card/club-card';
import { PlayerCard } from '../../ui/player-card/player-card';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleSet } from '../../ui/role-set/role-set';
import { RosterUpload } from '../../ui/roster-upload/roster-upload';
import { VoteTrend } from '../../ui/vote-trend/vote-trend';

/** His last club matches (up to five that exist) and how many gave him no vote. */
function recentOf(cells: readonly TrendCell[] | null): { matches: number; noVote: number } | null {
  const played = (cells ?? []).slice(0, VOTE_TREND_MATCHES).filter((cell) => cell.state !== null);
  return played.length ? { matches: played.length, noVote: played.filter((cell) => cell.vote === null).length } : null;
}

/** Hundredths of a fantapunto, the draft pitch's unit for fertility («+85»). */
function hundredths(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100);
}

/** What the right side is about: one place of the pitch (by its index in drawing order), or a whole line. */
type Selection = { kind: 'place'; at: number } | { kind: 'line'; line: ModuleLine } | null;

/** A target as the right side lists it: the place it would improve, named. */
interface TargetRow extends PlaceTarget {
  slot: string;
  fm: number | null;
  pv: number | null;
  fvm: number | null;
  form: number | null;
  /** His last club matches, for the form bars (`ui-vote-trend`). */
  trend: readonly TrendCell[];
  /** The mean FANTAVOTO of his last five (a match with none counted 5, the Draft's trend rule). */
  trendPoints: number | null;
  /** HYPE (operator, 23/10/2026): that trend over the fantamedia expected of him. Over 1 = he is doing better than we expect. */
  hype: number | null;
}

const BASE_SORTS = ['name', 'rival', 'slot', 'fm', 'pv', 'fvm', 'form', 'cover', 'fertility', 'points', 'hype', 'ours', 'theirs'] as const;
/** The averages of a season (the «medie» columns): fantamedia, media voto, presenze, gol:assist. */
const SEASON_METRICS = ['fm', 'mv', 'pv', 'ga'] as const;
type SeasonMetric = (typeof SEASON_METRICS)[number];
type SeasonWhich = 'last' | 'now';
type TargetSort = (typeof BASE_SORTS)[number] | `${SeasonMetric}@${SeasonWhich}`;
const TARGET_SORTS: readonly string[] = [
  ...BASE_SORTS,
  ...(['last', 'now'] as const).flatMap((which) => SEASON_METRICS.map((m) => `${m}@${which}`)),
];

/**
 * THE COLUMN SETS of the targets' table (operator, 23/10/2026), one icon each in its header: «default» - form bars, FVM,
 * FM, Pa and what he adds to the place - and «medie» - FM, MV, Pv and G:A of last season and this one.
 */
type ColumnSet = 'default' | 'medie' | 'hype';

/** The three standings in the order «Da noi · da loro» sorts them, the highest first. */
const STANDING_RANK: Record<Standing, number> = { titolare: 3, riserva: 2, panchina: 1 };
/** The columns a first click sorts A to Z; every other one starts from the highest. */
const TEXT_SORTS = new Set<TargetSort>(['name', 'rival', 'slot']);

const LINE_LABEL: Record<string, string> = { P: 'Porta', D: 'Difesa', M: 'Centrocampo', T: 'Trequarti', A: 'Attacco' };

/**
 * SCOUT (operator, 22/10/2026, rebuilt 23/10/2026: «a sinistra ci deve essere il campetto con la mia formazione ideale
 * ... cliccando su una zona/posizione nella parte destra devono comparire gli obiettivi delle altre squadre che possono
 * migliorare quella zona/posizione. Per il momento mostra solo gli obiettivi, poi capiremo come costruire il piano»).
 *
 * The pitch is the Draft Assistant's (`core/draft-pitch.ts`), on his squad from the league's roster export
 * (`core/roster-file.ts`); the numbers behind it and the targets of a place are `core/scout-pitch.ts`. The trade
 * search of 22/10 (`core/scout.ts`: `simpleSwaps`, `pairSwaps`) is no longer drawn here: it is kept for the plan.
 */
@Component({
  selector: 'app-scout',
  imports: [
    AppHeader,
    ClubCard,
    DecimalPipe,
    FormsModule,
    NzButtonModule,
    NzIconModule,
    NzRadioModule,
    NzSelectModule,
    NzTooltipModule,
    PlayerCard,
    RoleBadge,
    RoleSet,
    RosterUpload,
    VoteTrend,
  ],
  templateUrl: './scout.html',
})
export class Scout {
  protected readonly store = inject(ValuationStore);
  private readonly bundle = inject(Bundle);
  private readonly play = inject(ExpectedPlay);
  private readonly players = inject(PlayersStore);
  protected readonly rosterFile = inject(RosterFileStore);
  protected readonly connecting = signal(false);

  constructor() {
    void this.store.load();
    if (this.columns() === 'medie') void this.players.load();
  }

  private readonly platform = computed(() => (this.rosterFile.file()?.platform === 'euro' ? 'euro' : 'default'));
  protected readonly mantra = computed(() => this.rosterFile.file()?.game === 'mantra');

  protected readonly leagueKey = computed(() => this.rosterFile.file()?.key ?? null);
  protected readonly leagueOptions = computed(() =>
    this.rosterFile.rosters().map((one) => ({
      key: one.key,
      label: `${LEGHE[one.platform].label} · ${leagueOfFile(one.fileName)} · ${one.team}`,
    })),
  );

  protected chooseRoster(key: string): void {
    this.selected.set(null);
    this.rosterFile.choose(key);
  }

  private readonly sheet = computed(() => {
    const sheets = this.store.sheets().filter((s) => s.platform === this.platform());
    const game = this.mantra() ? 'mantra' : 'classic';
    return sheets.find((s) => s.game === game) ?? sheets[0] ?? null;
  });

  private readonly expectations = resource({
    params: () => this.sheet() ?? undefined,
    loader: ({ params }) => this.store.expectationsFor(params),
  });

  private readonly rulebook = resource({
    params: () => (this.rosterFile.file() ? (this.mantra() ? 'mantra' : 'classic') : undefined),
    loader: ({ params }) => (params === 'mantra' ? this.bundle.modules() : this.bundle.classicModules()),
  });

  private readonly rules = computed(() => (this.rulebook.hasValue() ? this.rulebook.value() : null));
  protected readonly rounds = computed(() => this.store.seasonRoundsFor(this.sheet()));

  private readonly bundleRows = computed(() => {
    const rows = this.store.allRosters().get(this.platform()) ?? [];
    return new Map(rows.map((r) => [r.fcId, r]));
  });

  /**
   * Every squad of the file, each man priced: the fantamedia of the sheet, the appearances of `ExpectedPlay` (the
   * one formula of the app, declarations included). A man the listone does not know is left out and counted.
   */
  protected readonly squads = computed<{ mine: ScoutSquad; rivals: ScoutSquad[]; unknown: number } | null>(() => {
    const file = this.rosterFile.file();
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const rounds = this.rounds();
    if (!file || !sheet || !rounds) return null;
    const rows = this.bundleRows();
    const platform = this.platform();
    const game = this.mantra() ? 'mantra' : 'classic';
    let unknown = 0;
    const squadOf = (name: string, ids: number[]): ScoutSquad => {
      const men: ScoutMan[] = [];
      for (const id of ids) {
        const row = rows.get(id);
        if (!row) {
          unknown += 1;
          continue;
        }
        const numbers = sheet.get(id) ?? null;
        const outlook = this.play.outlook(
          { id, club: row.club, platform },
          {
            pv: numbers?.pv ?? null,
            pvIsEstimate: numbers?.pvIsEstimate ?? false,
            playShare: numbers?.titolaritaPlay ?? null,
            titolarita: numbers?.titolarita ?? null,
          },
          rounds,
        );
        const shown = game === 'mantra' && row.mantraCodes.length ? row.mantraCodes : [row.role];
        men.push({
          id,
          name: row.name,
          club: row.club,
          role: row.role as ScoutRole,
          roles: shown.map((r) => r.toLowerCase()),
          shown,
          fm: numbers?.fm ?? null,
          pv: outlook.expected,
          fvm: this.store.fvmOf(platform, id, game),
          category: numbers?.category ?? null,
          form: trendVoteMean((numbers?.recentVotes ?? []).slice(0, VOTE_TREND_MATCHES)),
          outFor: outlook.window ? (outlook.window.seasonOver ? rounds : outlook.window.lost) : null,
          recent: recentOf(numbers?.recentVotes ?? null),
        });
      }
      return { name, men };
    };
    const mineTeam = file.teams.find((t) => t.name === file.team);
    if (!mineTeam) return null;
    return {
      mine: squadOf(mineTeam.name, mineTeam.ids),
      rivals: file.teams.filter((t) => t !== mineTeam).map((t) => squadOf(t.name, t.ids)),
      unknown,
    };
  });

  /**
   * THE AVERAGE STARTING KEEPER of the listone (`scout-pitch.keeperZeroOf`): a door's fertility is read against him,
   * over every club of the platform and not only the ones the league's squads hold.
   */
  private readonly keeperZero = computed(() => {
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    if (!sheet) return EDGE_BASE - 1;
    const keepers = [...this.bundleRows().values()]
      .filter((row) => row.role === 'P')
      .map((row) => ({ club: row.club, fm: sheet.get(row.fcId)?.fm ?? null, pv: sheet.get(row.fcId)?.pv ?? null }));
    return keeperZeroOf(keepers);
  });

  private readonly fantaOf = computed(() => {
    const rounds = this.rounds() ?? 0;
    const zero = this.keeperZero();
    return (man: ScoutMan) => fantaManOf(man, rounds, zero);
  });

  // ---------------------------------------------------------------- the pitch

  /** The module he chose for his pitch; null = the one that fields the best eleven (recommended shapes first). */
  protected readonly moduleChoice = storedJson<string | null>('scout.module', (raw) => (typeof raw === 'string' ? raw : null));

  protected readonly moduleNames = computed(() => Object.keys(this.rules()?.modules ?? {}));

  protected isRecommended(name: string): boolean {
    return recommendedModules(this.mantra()).includes(name);
  }

  protected chooseModule(name: string | null): void {
    this.moduleChoice.set(name);
    this.selected.set(null);
  }

  /**
   * MY IDEAL FORMATION: the draft pitch of my whole squad - the eleven that gives the most fertility, the reserves
   * spread where they add most coverage (`draftPitchOf` with `byCoverage`, as the Draft Assistant draws it).
   */
  protected readonly pitch = computed(() => {
    const squads = this.squads();
    const rules = this.rules();
    if (!squads || !rules) return null;
    const men = squads.mine.men.map(this.fantaOf());
    const forced = this.moduleChoice();
    return draftPitchOf(men, rules, recommendedModules(this.mantra()), forced && rules.modules[forced] ? forced : null, true);
  });

  private readonly places = computed(() => placesOf(this.pitch()));

  /** Coverage and fertility of a place, as the draft pitch prints them: «87%» and «+85» (hundredths a matchday). */
  protected yieldOf(place: DraftPlace): { cover: string; coverInk: string; fertility: string; fertilityInk: string } {
    const { cover, fertility } = placeYield(place, false, 0);
    const f = hundredths(fertility);
    const coverInk = cover < 0.5 ? 'text-danger' : cover < COVER_OK ? 'text-warning' : 'text-success';
    const fertilityInk = f != null && f < 0 ? 'text-danger' : 'text-success';
    return { cover: `${Math.round(cover * 100)}%`, coverInk, fertility: f == null ? '—' : `${f > 0 ? '+' : ''}${f}`, fertilityInk };
  }

  /** The pitch's totals: coverage as a share of the eleven, fertility summed, and the fantapunti a matchday. */
  protected readonly totals = computed(() => {
    const places = this.places();
    if (!places.length) return null;
    const zero = this.keeperZero();
    let cover = 0;
    let fertility = 0;
    let unknown = 0;
    let points = 0;
    for (const place of places) {
      const one = placeYield(place, false, 0);
      cover += one.cover;
      if (one.fertility == null) unknown += one.cover > 0 ? 1 : 0;
      else fertility += one.fertility;
      points += placePoints(place, zero);
    }
    const share = cover / places.length;
    const f = hundredths(fertility) ?? 0;
    return {
      cover: `${Math.round(share * 100)}%`,
      coverInk: share < 0.5 ? 'text-danger' : share < COVER_OK ? 'text-warning' : 'text-success',
      fertility: `${f > 0 ? '+' : ''}${f}`,
      fertilityInk: f < 0 ? 'text-danger' : 'text-success',
      unknown,
      points,
    };
  });

  protected lineLabel(line: string): string {
    return LINE_LABEL[line] ?? line;
  }

  // ---------------------------------------------------------------- the selection and its targets

  protected readonly selected = signal<Selection>(null);

  protected placeIndex(place: DraftPlace): number {
    return this.places().indexOf(place);
  }

  protected isSelected(place: DraftPlace): boolean {
    const sel = this.selected();
    if (!sel) return false;
    return sel.kind === 'place' ? this.placeIndex(place) === sel.at : place.line === sel.line;
  }

  protected selectPlace(place: DraftPlace): void {
    const at = this.placeIndex(place);
    const sel = this.selected();
    this.selected.set(sel?.kind === 'place' && sel.at === at ? null : { kind: 'place', at });
  }

  protected selectLine(line: ModuleLine): void {
    const sel = this.selected();
    this.selected.set(sel?.kind === 'line' && sel.line === line ? null : { kind: 'line', line });
  }

  /** Rival filter of the targets; null = every squad. */
  protected readonly rivalFilter = signal<string | null>(null);
  protected readonly rivalNames = computed(() => this.squads()?.rivals.map((r) => r.name) ?? []);

  /** Each rival's men as the pitch reads them, and where each stands on that squad's own pitch (`standingsOf`). */
  private readonly rivalPool = computed(() => {
    const squads = this.squads();
    const rules = this.rules();
    const rounds = this.rounds();
    if (!squads || !rules || !rounds) return [];
    const of = this.fantaOf();
    return squads.rivals.map((squad) => {
      const men = squad.men.map(of);
      return {
        name: squad.name,
        men,
        standing: standingsOf(draftPitchOf(men, rules, recommendedModules(this.mantra()), null, true)),
        byId: new Map(squad.men.map((man) => [man.id, man])),
      };
    });
  });

  /** What the right side is titled with: the place's slot and holder, or the line. */
  protected readonly selectionTitle = computed(() => {
    const sel = this.selected();
    if (!sel) return null;
    if (sel.kind === 'line') return `${this.lineLabel(sel.line)} · tutte le posizioni`;
    const place = this.places()[sel.at];
    if (!place) return null;
    return `${place.slot} · ${place.man ? place.man.name : 'posto scoperto'}`;
  });

  /**
   * THE TARGETS of what is selected (`scout-pitch.placeTargets`). On a whole line each man is listed once, on the place
   * of that line where he adds most.
   */
  protected readonly targets = computed<TargetRow[]>(() => {
    const sel = this.selected();
    if (!sel) return [];
    const places = this.places();
    const chosen = sel.kind === 'place' ? [places[sel.at]].filter((p): p is DraftPlace => !!p) : places.filter((p) => p.line === sel.line);
    const pool = this.rivalPool().filter((rival) => !this.rivalFilter() || rival.name === this.rivalFilter());
    const zero = this.keeperZero();
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const best = new Map<number, TargetRow>();
    for (const place of chosen) {
      for (const one of placeTargets(place, pool, zero)) {
        const known = best.get(one.man.id);
        if (known && known.points >= one.points) continue;
        const scout = pool.find((rival) => rival.name === one.rival)?.byId.get(one.man.id);
        const trend = sheet?.get(one.man.id)?.recentVotes ?? [];
        const trendPoints = trendPointsMean(trend.slice(0, VOTE_TREND_MATCHES));
        best.set(one.man.id, {
          ...one,
          slot: place.slot,
          fm: scout?.fm ?? null,
          pv: scout?.pv ?? null,
          fvm: scout?.fvm ?? null,
          form: scout?.form ?? null,
          trend,
          trendPoints,
          hype: trendPoints == null || !scout?.fm ? null : trendPoints / scout.fm,
        });
      }
    }
    return [...best.values()].sort((a, b) => b.points - a.points);
  });

  /**
   * THE TARGETS' ORDER (operator, 23/10/2026: «le colonne devono essere ordinabili cliccando sul nome della colonna»):
   * a click sorts on that column, a second click reverses it. Numbers start from the highest, names from A; a blank
   * goes last in both directions («vuoto = ignoto», never a zero). Default: the points a matchday it adds.
   */
  protected readonly sort = storedJson<{ key: TargetSort; desc: boolean }>('scout.targetSort', (raw) => {
    const o = raw as { key?: string; desc?: unknown } | null;
    return o && typeof o.key === 'string' && TARGET_SORTS.includes(o.key)
      ? { key: o.key as TargetSort, desc: !!o.desc }
      : { key: 'points', desc: true };
  });

  protected sortBy(key: TargetSort): void {
    const now = this.sort();
    this.sort.set(now.key === key ? { key, desc: !now.desc } : { key, desc: !TEXT_SORTS.has(key) });
  }

  protected sortArrow(key: TargetSort): string {
    const now = this.sort();
    return now.key === key ? (now.desc ? ' ↓' : ' ↑') : '';
  }

  protected readonly sortedTargets = computed<TargetRow[]>(() => {
    const { key, desc } = this.sort();
    const value = (t: TargetRow): number | string | null => {
      switch (key) {
        case 'name': return t.man.name;
        case 'rival': return t.rival;
        case 'slot': return t.slot;
        case 'ours': return STANDING_RANK[t.ours];
        case 'theirs': return t.theirs ? STANDING_RANK[t.theirs] : null;
        case 'hype': return t.hype;
        case 'fm': case 'pv': case 'fvm': case 'form': case 'cover': case 'fertility': case 'points': return t[key];
      }
      const [metric, which] = key.split('@') as [SeasonMetric, SeasonWhich];
      return this.seasonValue(this.lineOf(t.man.id, which), metric, this.isKeeper(t.man));
    };
    return [...this.targets()].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
      return (desc ? -c : c) || b.points - a.points;
    });
  });

  protected readonly columns = storedJson<ColumnSet>('scout.targetColumns', (raw) => (raw === 'medie' || raw === 'hype' ? raw : 'default'));

  protected chooseColumns(set: ColumnSet): void {
    this.columns.set(set);
    // The averages rebuild a season the platform did not score from his matches: the per-match layer, loaded once.
    if (set === 'medie') void this.players.load();
  }

  protected readonly seasonKeys: readonly SeasonWhich[] = ['last', 'now'];
  protected readonly seasonMetrics = SEASON_METRICS;

  /** The two seasons the averages read, from the bundle's manifest, with the scored lines and Transfermarkt's. */
  private readonly readings = resource({
    params: () => {
      const sheet = this.sheet();
      return sheet && this.columns() === 'medie' ? { path: sheet.path, platform: this.platform() as Platform } : undefined;
    },
    loader: async ({ params }) => {
      const [stats, manifest, sheet] = await Promise.all([
        this.bundle.table('season_stats'),
        this.bundle.manifest(),
        this.bundle.table(params.path.replace(/\.json(\.gz)?$/, '')),
      ]);
      const now = manifest.target_season ?? null;
      const last = manifest.input_season ?? null;
      const wanted = [now, last].filter((one): one is string => !!one);
      return {
        platform: params.platform,
        seasons: { now, last } as Record<SeasonWhich, string | null>,
        lines: seasonLines({ seasonStats: stats, platform: params.platform, seasons: wanted }),
        tm: last ? seasonLinesFromSheet(sheet, last) : new Map<number, SeasonLine>(),
      };
    },
  });

  protected seasonLabel(which: SeasonWhich): string {
    const r = this.readings.hasValue() ? this.readings.value() : null;
    return r?.seasons[which] ?? (which === 'now' ? 'stagione' : 'scorsa');
  }

  /**
   * A season's line, as the Draft Assistant reads it: the game's scored line; where the platform did not score his club,
   * rebuilt from his matches on the synthetic vote (in italic); for last season, failing that, Transfermarkt's
   * appearances and goals with no vote.
   */
  protected lineOf(id: number, which: SeasonWhich): SeasonLine | null {
    const r = this.readings.hasValue() ? this.readings.value() : null;
    const season = r?.seasons[which];
    if (!r || !season) return null;
    const scored = r.lines.get(id)?.get(season) ?? null;
    if (scored?.pv != null) return scored;
    if (this.players.ready()) {
      const rebuilt = seasonLineFromMatches(this.players.matchesOf(id, r.platform, season), season);
      if (rebuilt) return rebuilt;
    }
    return (which === 'last' ? r.tm.get(id) : undefined) ?? scored;
  }

  protected isKeeper(man: FantaMan): boolean {
    return man.roles.some((role) => role === 'por' || role === 'p');
  }

  /**
   * «Gol» is ALWAYS goals including penalties (the line's `goals` already is), and for a keeper the pair is goals
   * conceded and clean sheets (operator, 23/10/2026).
   */
  protected metricLabel(metric: SeasonMetric): string {
    return metric === 'ga' ? 'G:A' : metric.toUpperCase();
  }

  protected pairOf(line: SeasonLine | null, keeper: boolean): string {
    if (!line) return '—';
    const [a, b] = keeper ? [line.conceded, line.cleanSheets] : [line.goals, line.assists];
    return a == null && b == null ? '—' : `${a ?? 0}:${b ?? 0}`;
  }

  /** The number a season column sorts on; the pair sorts on its first half (goals, or conceded for a keeper). */
  private seasonValue(line: SeasonLine | null, metric: SeasonMetric, keeper: boolean): number | null {
    if (!line) return null;
    if (metric === 'ga') return keeper ? line.conceded : line.goals;
    return line[metric];
  }

  protected pct(value: number): string {
    const v = Math.round(value * 100);
    return `${v > 0 ? '+' : ''}${v}%`;
  }

  protected fert(value: number | null): string {
    const v = hundredths(value);
    return v == null ? '—' : `${v > 0 ? '+' : ''}${v}`;
  }

  protected manPv(man: FantaMan): string {
    const rounds = this.rounds();
    return man.share == null || !rounds ? '—' : (man.share * rounds).toFixed(0);
  }

  // ---------------------------------------------------------------- the player card (click on a name, every page)

  private readonly cards = new CardStack();

  protected readonly openCards = computed(() => {
    const rows = this.bundleRows();
    const sheet = this.expectations.hasValue() ? this.expectations.value() : null;
    const rounds = this.rounds();
    const platform = this.platform();
    const game = this.mantra() ? 'mantra' : 'classic';
    return this.cards.place((key) => {
      const id = playerOfCard(key);
      const row = id === null ? undefined : rows.get(id);
      if (!row) return undefined;
      const numbers = sheet?.get(row.fcId) ?? null;
      const outlook = this.play.outlook(
        { id: row.fcId, club: row.club, platform },
        {
          pv: numbers?.pv ?? null,
          pvIsEstimate: numbers?.pvIsEstimate ?? false,
          playShare: numbers?.titolaritaPlay ?? null,
          titolarita: numbers?.titolarita ?? null,
        },
        rounds,
      );
      const man: CardMan = {
        id: row.fcId,
        name: row.name,
        club: row.club,
        clubId: row.clubId,
        where: game === 'mantra' && row.mantraCodes.length ? row.mantraCodes.join('/') : row.role,
        role: row.role as Role,
        platform,
        edge: numbers?.fm == null ? null : numbers.fm - EDGE_BASE,
        pv: outlook.expected,
        rounds,
        swing: null,
        fm: numbers?.fm ?? null,
        estimated: numbers?.fmIsEstimate ?? false,
        estNote: numbers?.note ?? null,
        titolarita: numbers?.titolarita ?? null,
        titolaritaPlay: numbers?.titolaritaPlay ?? null,
        minutesNext: numbers?.minutesNext ?? null,
        seasonMatches: numbers?.seasonMatches ?? null,
        minutesFullSeason: numbers?.minutesFullSeason ?? null,
        category: numbers?.category ?? null,
        categoryLevel: numbers?.categoryLevel ?? null,
        categoryBars: numbers?.categoryBars ?? null,
        unpricedReason: null,
        fvm: this.store.fvmOf(platform, row.fcId, game),
        out: outlook.window,
        market: null,
      };
      return man;
    });
  });

  protected readonly clubCards = computed(() => this.cards.place((key) => clubOfCard(key) ?? undefined));
  protected readonly cardCount = computed(() => this.openCards().length + this.clubCards().length);
  protected readonly frontCard = computed(() => this.cards.front());

  protected openPlayer(id: number, event?: Event): void {
    event?.stopPropagation();
    this.cards.openCard(playerCard(id));
  }

  protected openClubCard(platform: 'default' | 'euro', club: string): void {
    this.cards.openCard(clubCard(platform, club));
  }

  protected closeCard(key: CardKey): void {
    this.cards.closeCard(key);
  }

  protected raiseCard(key: CardKey): void {
    this.cards.raiseCard(key);
  }

  protected closeAllCards(): void {
    this.cards.openCard(null);
  }
}
