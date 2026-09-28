import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { AuctionAdvice, RankedPlayer } from '../../core/auction-advice';
import { AuctionDemo } from '../../core/auction-demo';
import { AuctionFeed, AuctionTeam, SquadEntry, Zone } from '../../core/auction-feed';
import { Bundle } from '../../core/bundle';
import { DraftPlace, RECOMMENDED_MANTRA, draftPitchOf } from '../../core/draft-pitch';
import type { FantaMan } from '../../core/fanta-eleven';
import { GlobalOptions } from '../../core/global-options';
import { lazyRows } from '../../core/lazy-rows';
import { looseMatch } from '../../core/loose-search';
import { trendStrips } from '../../core/plancia-store';
import { PlayerRulings } from '../../core/player-rulings';
import type { TrendCell } from '../../core/player-trend';
import type { Platform } from '../../core/players-store';
import { SeasonLine, seasonLines } from '../../core/season-line';
import { AppHeader } from '../../ui/app-header/app-header';
import { LiveConnect } from '../../ui/live-connect/live-connect';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleSet } from '../../ui/role-set/role-set';
import { TrendVotes } from '../../ui/trend-votes/trend-votes';

/**
 * The classic macro-role of a man, from the zone the feed files him under: on classic the rulebook rations
 * macro-roles and nothing finer, so the zone IS the role (same rule as the old fanta pitch).
 */
const CLASSIC_ROLE: Partial<Record<Zone, string>> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };

/** The press's own six words, short enough for a column; the full word is the tooltip. */
const PRESS_SHORT: Record<string, string> = {
  titolarissimo: 'TT',
  titolare: 'TIT',
  ballottaggio: 'BAL',
  comprimario: 'COM',
  riserva: 'RIS',
  scarto: 'SCA',
};

/** How the free list is read: the default columns, or the season averages (operator, 28/09/2026). */
export type FreeMode = 'default' | 'medie';

const MODE_KEY = 'fantassistant.draft.freeMode';

/** One free man as the list draws him. */
export interface FreeRow {
  id: number;
  name: string;
  club: string;
  roles: string[];
  fvm: number;
  press: string | null;
  trend: readonly TrendCell[];
  /** The priority on 0-99 of this table's free pool; null where the sheet cannot value him. */
  priority: number | null;
  /** Off OUR board this turn because of the FVM ceiling of the first turns. */
  locked: boolean;
  goal: boolean;
}

/** One squad in the call order, as the middle column draws it. */
interface SeatRow {
  team: AuctionTeam;
  /** Position in the current call order, from 1. */
  at: number;
  mine: boolean;
  last: string | null;
  next: { name: string; roles: string[]; predicted: boolean } | null;
  /** Where the squad calls in the round AFTER this one, by the platform's own rule. */
  nextAt: number | null;
}

const EMPTY_STRIP: readonly TrendCell[] = [];

/**
 * THE DRAFT ASSISTANT (ex «Segui un'asta», rifatto da capo il 28/09/2026 su richiesta dell'operatore).
 *
 * One screen, three columns and no page scroll: the squad being built on a pitch, the call order with what
 * each squad is expected to take, and the free men. It opens on the table of the DECLARED league, empty
 * (`AuctionDemo.start`), and a real fanta-asta-live session can still be followed from the same button as
 * before - the page reads whichever table the feed holds, and draws the same three columns on both.
 *
 * Nothing here predicts a footballer. The pitch is the rulebook (`draft-pitch.ts`), the call order is the
 * platform's own rule, the expected picks are the plan's two policies (`simulateRound`), and the priority is
 * the score our own pick is chosen on (`AuctionAdvice.priorities`).
 */
@Component({
  selector: 'app-auction',
  imports: [
    AppHeader,
    DecimalPipe,
    FormsModule,
    LiveConnect,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzRadioModule,
    NzSelectModule,
    NzTooltipModule,
    PlayerFlags,
    RoleBadge,
    RoleSet,
    TrendVotes,
  ],
  templateUrl: './auction.html',
  // The free list's two column sets. Declared once here and not as utilities on every row: the header and
  // the rows must share ONE track list, or the columns of the header drift from the numbers under them.
  styles: `
    .free-grid { display: grid; align-items: center; column-gap: 0.25rem; }
    .free-default { grid-template-columns: 5.25rem minmax(0, 1fr) 4.5rem 2rem 2.25rem 75px 2rem; }
    .free-medie { grid-template-columns: 5.25rem minmax(0, 1fr) repeat(2, 1.6rem 2.2rem 2.2rem 2.4rem); }
  `,
  host: { class: 'view-host' },
})
export class Auction {
  protected readonly feed = inject(AuctionFeed);
  protected readonly advice = inject(AuctionAdvice);
  protected readonly demo = inject(AuctionDemo);
  protected readonly options = inject(GlobalOptions);
  private readonly rulings = inject(PlayerRulings);
  private readonly bundle = inject(Bundle);
  private readonly message = inject(NzMessageService);

  protected readonly connecting = signal(false);

  constructor() {
    // A refresh mid-auction re-joins whatever session this browser was on, and only when there is none the
    // page opens on the declared league's table. The order is forced: starting the table first would
    // overwrite a real auction the operator is in.
    void this.feed.restore().then(() => {
      if (!this.feed.hasTable()) void this.demo.start();
    });
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === 'default' || saved === 'medie') this.mode.set(saved);
    } catch {
      // Nothing saved: the default columns.
    }

    // THE TABLE FOLLOWS THE SETTINGS: a changed league is a different table, so the invented one is rebuilt.
    // Only on the invented table - a real session's seats are the host's - and only when a field the table is
    // MADE of changes, or a toggle that prices nothing would wipe the picks he has been writing.
    let last: string | null = null;
    effect(() => {
      const league = this.options.league();
      const key = JSON.stringify([
        league.platform, league.game, league.teams, league.budget, league.slots, league.draftCap,
      ]);
      untracked(() => {
        const changed = last !== null && key !== last;
        last = key;
        if (changed && this.feed.demo()) void this.demo.start();
      });
    });

    // The two readings of the free list that do not come with the advice: the trend strips (from the sheet
    // itself) and the season lines (from `season_stats`, on the sheet's own platform).
    effect(() => {
      const entry = this.advice.entry();
      if (!entry) return;
      untracked(() => void this.loadReadings(entry.path, entry.platform));
    });
  }

  // ---------------------------------------------------------------------------------------- the table

  protected readonly teamOnClock = computed(() => this.feed.onTheClock());

  /** The squads in the order they call, then whoever the order does not list. */
  protected readonly seats = computed<SeatRow[]>(() => {
    const teams = this.feed.teams();
    const order = this.feed.pickOrder();
    const listed = new Set(order.map((team) => team.id));
    const all = [...order, ...teams.filter((team) => !listed.has(team.id))];
    const round = this.advice.round();
    const picks = new Map((round?.picks ?? []).map((pick) => [pick.teamId, pick]));
    const nextOrder = round?.nextOrder ?? [];
    const mine = this.feed.followedTeamId();
    return all.map((team, index) => {
      const pick = picks.get(team.id);
      const last = lastOf(team.squad);
      const at = nextOrder.indexOf(team.id);
      return {
        team,
        at: index + 1,
        mine: team.id === mine,
        last: last?.player ? this.feed.shownName(last.player) : null,
        next: pick?.player
          ? { name: this.shown(pick.player.id, pick.player.name), roles: pick.player.roles, predicted: pick.predicted }
          : null,
        nextAt: at < 0 ? null : at + 1,
      };
    });
  });

  /** «Chi prendo adesso»: our own pick of the round being played, and how many calls come before it. */
  protected readonly advised = computed(() => {
    const mine = this.feed.followedTeamId();
    const pick = this.advice.round()?.picks.find((one) => one.teamId === mine) ?? null;
    return pick?.player ? { name: this.shown(pick.player.id, pick.player.name), roles: pick.player.roles } : null;
  });

  protected readonly capLine = computed<string | null>(() => {
    const cap = this.advice.pickCap();
    return cap ? `FVM ≥ ${cap.fvm} congelati per ${cap.frozenTurns} turni` : null;
  });

  /** Which squad the pitch draws: the one clicked in the middle column, else mine, else the first. */
  private readonly viewed = signal<number | null>(null);

  protected readonly pitchTeam = computed<AuctionTeam | null>(() => {
    const teams = this.feed.teams();
    return (
      teams.find((team) => team.id === this.viewed())
      ?? teams.find((team) => team.id === this.feed.followedTeamId())
      ?? teams[0]
      ?? null
    );
  });

  protected view(teamId: number): void {
    this.viewed.set(this.viewed() === teamId ? null : teamId);
  }

  /** «This squad is mine»: on the invented table it is how he sits down; on a live one the modal does it. */
  protected sitAt(teamId: number): void {
    this.feed.follow(teamId);
    this.viewed.set(null);
  }

  // ---------------------------------------------------------------------------------------- the pitch

  /** A module the operator forced, or null for the best one the rulebook allows. */
  protected readonly forcedModule = signal<string | null>(null);

  protected readonly moduleNames = computed<string[]>(() => {
    const names = Object.keys(this.advice.rules()?.modules ?? {});
    if (!this.feed.isMantra()) return names;
    const first = RECOMMENDED_MANTRA.filter((name) => names.includes(name));
    return [...first, ...names.filter((name) => !first.includes(name as (typeof RECOMMENDED_MANTRA)[number]))];
  });

  protected isRecommended(name: string): boolean {
    return this.feed.isMantra() && (RECOMMENDED_MANTRA as readonly string[]).includes(name);
  }

  private readonly squad = computed<FantaMan[]>(() => {
    const mantra = this.feed.isMantra();
    const values = this.advice.valueBy();
    const worth99 = this.advice.value99By();
    const men: FantaMan[] = [];
    for (const entry of this.pitchTeam()?.squad ?? []) {
      const player = entry.player;
      if (!player) continue;
      const shown = mantra ? player.roles : [CLASSIC_ROLE[this.feed.zoneOf(player)] ?? ''].filter(Boolean);
      men.push({
        id: player.id,
        name: this.feed.shownName(player),
        club: this.goal(player.id) ? 'porta' : player.club,
        shown,
        roles: shown.map((role) => role.toLowerCase()),
        value: values.get(player.id) ?? null,
        value99: worth99.get(player.id) ?? null,
        cost: entry.cost,
        minutesPerMatch: null,
      });
    }
    return men;
  });

  protected readonly pitch = computed(() =>
    draftPitchOf(
      this.squad(),
      this.advice.rules(),
      this.feed.isMantra() ? RECOMMENDED_MANTRA : [],
      this.forcedModule(),
    ),
  );

  protected placeHint(place: DraftPlace): string {
    const head = place.man
      ? `${place.man.name} · ${place.man.club}${place.man.value99 != null ? ` · valore ${place.man.value99}/99` : ''}`
      : `Posto ${place.slot}: ancora scoperto`;
    if (!place.reserves.length) return head;
    return `${head} · riserve: ${place.reserves.map((man) => man.name).join(', ')}`;
  }

  // ---------------------------------------------------------------------------------------- the free list

  protected readonly query = signal('');
  protected readonly roleFilter = signal<ReadonlySet<string>>(new Set());
  protected readonly mode = signal<FreeMode>('default');

  protected setMode(mode: FreeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // A browser that refuses storage still switches; it just forgets it on refresh.
    }
  }

  /** The roles the filter offers: the rulebook's own vocabulary, read and never transcribed. */
  protected readonly roleOptions = computed<string[]>(() => {
    if (!this.feed.isMantra()) return ['P', 'D', 'C', 'A'];
    return this.advice.rules()?.roles ?? ['Por', 'Dd', 'Dc', 'Ds', 'B', 'E', 'M', 'C', 'W', 'T', 'A', 'Pc'];
  });

  protected toggleRole(role: string): void {
    const key = role.toLowerCase();
    const next = new Set(this.roleFilter());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.roleFilter.set(next);
  }

  protected clearRoles(): void {
    this.roleFilter.set(new Set());
  }

  protected roleOn(role: string): boolean {
    return this.roleFilter().has(role.toLowerCase());
  }

  private readonly trends = signal<ReadonlyMap<number, readonly TrendCell[]>>(new Map());
  private readonly lines = signal<ReadonlyMap<number, ReadonlyMap<string, SeasonLine>>>(new Map());
  protected readonly seasons = signal<{ now: string | null; last: string | null }>({ now: null, last: null });

  /** Every free man with his priority, dearest priority first; the frozen ones after, in the same order. */
  private readonly freeAll = computed<FreeRow[]>(() => {
    const scores = this.advice.priorities();
    const press = this.rulings.press();
    const trends = this.trends();
    const ranked = this.advice.ranked();
    let top = 0;
    for (const row of ranked) {
      const score = scores.get(row.player.id);
      if (score != null && score > top && !this.advice.lockedForMe(row.price)) top = score;
    }
    const rows = ranked.map((row) => this.freeRow(row, scores.get(row.player.id) ?? null, top, press, trends));
    return rows.sort(
      (a, b) =>
        Number(a.locked) - Number(b.locked)
        || (b.priority ?? -1) - (a.priority ?? -1)
        || b.fvm - a.fvm,
    );
  });

  private freeRow(
    row: RankedPlayer,
    score: number | null,
    top: number,
    press: ReadonlyMap<number, { pressTier?: string | null }>,
    trends: ReadonlyMap<number, readonly TrendCell[]>,
  ): FreeRow {
    const goal = !!row.porta;
    return {
      id: row.player.id,
      name: this.feed.shownName(row.player),
      club: goal ? 'porta' : row.player.club,
      roles: row.player.roles,
      fvm: row.price,
      press: goal ? null : (press.get(row.player.id)?.pressTier ?? null),
      trend: goal ? EMPTY_STRIP : (trends.get(row.player.id) ?? EMPTY_STRIP),
      priority: score == null || top <= 0 ? null : Math.max(0, Math.round((score / top) * 99)),
      locked: this.advice.lockedForMe(row.price),
      goal,
    };
  }

  /** The list after the search and the role filter; roles in OR, as he asked. */
  protected readonly freeFiltered = computed<FreeRow[]>(() => {
    const query = this.query();
    const roles = this.roleFilter();
    return this.freeAll().filter(
      (row) =>
        looseMatch(query, row.name, row.club)
        && (!roles.size || row.roles.some((role) => roles.has(role.toLowerCase()))),
    );
  });

  protected readonly free = lazyRows(this.freeFiltered, '[data-free-list]');

  protected pressShort(tier: string | null): string {
    return tier ? (PRESS_SHORT[tier] ?? tier.slice(0, 3).toUpperCase()) : '—';
  }

  protected lineOf(id: number, which: 'now' | 'last'): SeasonLine | null {
    const season = this.seasons()[which];
    return season ? (this.lines().get(id)?.get(season) ?? null) : null;
  }

  protected ga(line: SeasonLine | null): string {
    if (!line || (line.goals == null && line.assists == null)) return '—';
    return `${line.goals ?? 0}:${line.assists ?? 0}`;
  }

  /** Double click: the squad on the clock takes him. Only the invented table can be written by hand. */
  protected take(row: FreeRow): void {
    const refused = this.demo.pick(row.id);
    if (refused) this.message.warning(refused);
  }

  protected undo(): void {
    if (!this.demo.undo()) this.message.info('Non c’è nessuna scelta da annullare.');
  }

  protected reset(): void {
    this.demo.reset();
  }

  protected freeHint(row: FreeRow): string {
    const bits = [`${row.name} · ${row.club}`, `FVM ${row.fvm}`];
    if (row.press) bits.push(`stampa: ${row.press}`);
    if (row.locked) bits.push('congelato: FVM sopra il tetto dei primi turni');
    const clock = this.teamOnClock();
    if (this.feed.demo() && clock) bits.push(`doppio click: lo prende ${clock.label}`);
    return bits.join(' · ');
  }

  // ---------------------------------------------------------------------------------------- helpers

  protected goal(id: number): boolean {
    return this.feed.isGoalsMode() && this.feed.portaOfKeeper().has(id);
  }

  protected flagId(id: number, goal: boolean): number | undefined {
    return goal ? undefined : id;
  }

  private shown(id: number, fallback: string): string {
    const porta = this.feed.isGoalsMode() ? this.feed.portaOfKeeper().get(id) : undefined;
    return porta ? porta.club : fallback;
  }

  private async loadReadings(path: string, platform: Platform): Promise<void> {
    try {
      const [sheet, stats, manifest] = await Promise.all([
        this.bundle.table(path.replace(/\.json(\.gz)?$/, '')),
        this.bundle.table('season_stats'),
        this.bundle.manifest(),
      ]);
      this.trends.set(trendStrips(sheet));
      const now = manifest.target_season ?? null;
      const last = manifest.input_season ?? null;
      const wanted = [now, last].filter((one): one is string => !!one);
      this.lines.set(seasonLines({ seasonStats: stats, platform, seasons: wanted }));
      this.seasons.set({ now, last });
    } catch {
      // Without them the list still ranks: the strip draws four empty cells and the averages read «—».
    }
  }
}

function lastOf(squad: readonly SquadEntry[]): SquadEntry | null {
  let last: SquadEntry | null = null;
  for (const entry of squad) if (!last || entry.index > last.index) last = entry;
  return last;
}
