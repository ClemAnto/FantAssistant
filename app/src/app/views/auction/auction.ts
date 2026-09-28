import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
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
import { CardKey, CardMan, CardStack, clubCard, clubOfCard, playerCard, playerOfCard } from '../../core/player-card';
import { EDGE_BASE, Role } from '../../core/plancia';
import { positionAfterSpending } from '../../core/auction-plan';
import { AuctionDemo } from '../../core/auction-demo';
import { AuctionFeed, AuctionPlayer, AuctionTeam, SquadEntry, Zone } from '../../core/auction-feed';
import { Bundle } from '../../core/bundle';
import { DraftPlace, RECOMMENDED_MANTRA, draftPitchOf, withSuggestions } from '../../core/draft-pitch';
import type { FantaMan } from '../../core/fanta-eleven';
import { GlobalOptions } from '../../core/global-options';
import { lazyRows } from '../../core/lazy-rows';
import { looseMatch } from '../../core/loose-search';
import { trendStrips } from '../../core/plancia-store';
import { PlayerRulings } from '../../core/player-rulings';
import { PlayerRatingsStore } from '../../core/player-ratings-store';
import { ValuationStore } from '../../core/valuation-store';
import type { TrendCell } from '../../core/player-trend';
import { PlayersStore, type Platform } from '../../core/players-store';
import { SeasonLine, seasonLineFromMatches, seasonLines, seasonLinesFromSheet } from '../../core/season-line';
import { AppHeader } from '../../ui/app-header/app-header';
import { ClubCard } from '../../ui/club-card/club-card';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { LiveConnect } from '../../ui/live-connect/live-connect';
import { PlayerCard } from '../../ui/player-card/player-card';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleSet } from '../../ui/role-set/role-set';
import { TrendVotes } from '../../ui/trend-votes/trend-votes';

/**
 * The classic macro-role of a man, from the zone the feed files him under: on classic the rulebook rations
 * macro-roles and nothing finer, so the zone IS the role (same rule as the old fanta pitch).
 */
const CLASSIC_ROLE: Partial<Record<Zone, string>> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };

/**
 * THE TITOLARITÀ COLUMN'S BADGES (operator, 29/09/2026: «scrivi i valori con etichette intere con badge
 * colorati: verde titolare, ambra ballottaggio, ecc.»). Colour on an ordinal scale is his explicit request
 * here, against the app's default of reading such a scale by weight: green the two top words, amber the
 * contested shirt, orange who comes on, red who does not play. The press's six words and the sheet's six
 * rungs share four; `bandiera` reads as `titolarissimo` and `panchina` as `comprimario`, which is what
 * each promises.
 */
const RUNG_BADGE: Record<string, string> = {
  bandiera: 'bg-success/30 text-success font-semibold',
  titolarissimo: 'bg-success/30 text-success font-semibold',
  titolare: 'bg-success/15 text-success',
  ballottaggio: 'bg-warning/20 text-warning',
  comprimario: 'bg-[color-mix(in_oklab,var(--color-warning),var(--color-danger))]/20 text-[color-mix(in_oklab,var(--color-warning),var(--color-danger))]',
  panchina: 'bg-[color-mix(in_oklab,var(--color-warning),var(--color-danger))]/20 text-[color-mix(in_oklab,var(--color-warning),var(--color-danger))]',
  riserva: 'bg-danger/15 text-danger',
  scarto: 'bg-danger/30 text-danger font-semibold',
};

/** A season number the «medie» view can be sorted by. */
type SeasonMetric = 'pv' | 'mv' | 'fm' | 'ga';

/** Every column a header can sort the free list by. */
export type FreeSort =
  | 'role' | 'name' | 'press' | 'fvm' | 'trend' | 'prio'
  | 'rung' | 'pvp' | 'min' | 'mvp' | 'steady' | 'fmp'
  | `${SeasonMetric}@${'now' | 'last'}`;

/** The two ladders in one order, best first: what «sort by titolarità» orders by. */
const PRESS_RANK: Record<string, number> = {
  bandiera: 7,
  titolarissimo: 6,
  titolare: 5,
  ballottaggio: 4,
  comprimario: 3,
  panchina: 3,
  riserva: 2,
  scarto: 1,
};

/** How the free list is read: the default columns, or the season averages (operator, 28/09/2026). */
export type FreeMode = 'default' | 'medie' | 'previste';

const MODE_KEY = 'fantassistant.draft.freeMode';

/** One free man as the list draws him. */
export interface FreeRow {
  id: number;
  name: string;
  club: string;
  /** The club's canonical id, for the crest: the name is not a key. */
  clubId: number | null;
  roles: string[];
  fvm: number;
  /** The titolarità word: the PRESS's where the survey has him, else the sheet's own rung. */
  press: string | null;
  pressSource: 'stampa' | 'motore' | null;
  trend: readonly TrendCell[];
  /** The priority on 0-99 of this table's free pool; null where the sheet cannot value him. */
  priority: number | null;
  /** Off OUR board this turn because of the FVM ceiling of the first turns. */
  locked: boolean;
  /**
   * WHAT THE SHEET EXPECTS of him, for the «previste» view: the ENGINE's own rung (not the press), the
   * appearances with a vote, the minutes, the base vote and the fantamedia - the measured number where the
   * engine prices him, its declared fallback (`estimated`, drawn in italic) where it does not - and the
   * steadiness of his seasons, the same reading the Strategy page shows.
   */
  expected: {
    rung: string | null;
    pv: number | null;
    minutes: number | null;
    mv: number | null;
    steady: number | null;
    fm: number | null;
    estimated: boolean;
  };
  /** How many of OUR turns are left before he unlocks for us; null when he is not blocked. */
  turnsLeft: number | null;
  goal: boolean;
}

/** One squad in the call order, as the middle column draws it. */
interface SeatRow {
  team: AuctionTeam;
  /** Position in the current call order, from 1. */
  at: number;
  /**
   * THE PLACE IN ITS TURN, which is what the row prints (operator, 29/09/2026): the squads that still
   * have to play this turn end at the table's size (the last before the line is the 12th of twelve), and
   * those below the line start again from 1°.
   */
  turnAt: number;
  mine: boolean;
  last: { id: number; name: string; roles: string[] } | null;
  next: { id: number; name: string; roles: string[]; predicted: boolean } | null;
  /** Where the squad calls in the round AFTER this one, by the platform's own rule. */
  nextAt: number | null;
  /**
   * Its roster's FVM minus the SELECTED squad's (the one on the pitch), shown on hover (operator,
   * 29/09/2026). Null on the selected squad itself. In a draft the FVM spent is what the order is decided
   * on after the pick count, so this gap is how far two squads are from swapping places.
   */
  delta: number | null;
}

const EMPTY_STRIP: readonly TrendCell[] = [];

/** How long AUTO waits before a rival takes his predicted man. */
const AUTO_DELAY_MS = 500;

/** How long a click on a free man's name waits for its second half: the double click chooses him. */
const CARD_DELAY_MS = 260;

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
    ClubCard,
    ClubCrest,
    DecimalPipe,
    FormsModule,
    LiveConnect,
    NgTemplateOutlet,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzRadioModule,
    NzSelectModule,
    NzTooltipModule,
    PlayerCard,
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
    /* Role, name, FVM, priority first in all three views; then the view's own columns. */
    .free-default { grid-template-columns: 5.25rem minmax(0, 1fr) 2.25rem 2rem 4.9rem 75px; }
    .free-previste { grid-template-columns: 5.25rem minmax(0, 1fr) 2.25rem 2rem 4.9rem 2.1rem 2.1rem 2.3rem 2.3rem 2.3rem; }
    .sort { cursor: pointer; user-select: none; }
    /* The call order: every seat sits at its place by a transform, so a change of place SLIDES. */
    ol { --seat-h: 2.75rem; --seat-step: 3rem; }
    .seat {
      position: absolute; left: 0; right: 0; top: 0; height: var(--seat-h);
      transform: translateY(calc(var(--seat-at) * var(--seat-step)));
      transition: transform 450ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 200ms, border-color 200ms;
    }
    /* The line between two turns sits in the gap between two seats, and slides with them. */
    .round-line {
      position: absolute; left: 0; right: 0; top: 0; height: 0; z-index: 1; pointer-events: none;
      border-top: 1px dashed color-mix(in oklab, var(--color-primary) 70%, transparent);
      transform: translateY(calc(var(--seat-at) * var(--seat-step) - (var(--seat-step) - var(--seat-h)) / 2));
      transition: transform 450ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .round-line > span {
      position: absolute; right: 0.25rem; top: -0.45rem; padding: 0 0.25rem; font-size: 9px; line-height: 0.9rem;
      background: var(--color-surface); color: color-mix(in oklab, var(--color-primary) 85%, var(--color-fg));
    }
    @media (prefers-reduced-motion: reduce) { .seat, .round-line { transition: none; } }
    /* «In piccolo»: the smallest badge the app has, shrunk once more so a two-line seat keeps its height. */
    .seat-roles { transform: scale(0.8); transform-origin: left center; margin-right: -0.35rem; }
    .sort:hover { color: var(--color-fg); }
    /* Eight EQUAL columns (operator, 29/09/2026: «le colonne non sono distanziate equamente»): the widest
       value any of them prints (12.75, 17:10) fits in 2.5rem, so one width serves them all. */
    .free-medie { grid-template-columns: 5.25rem minmax(0, 1fr) 2.25rem 2rem repeat(8, 2.3rem); }
    /* The same room for the list's scrollbar on the headers as on the rows, or every column right of the
       name slides by the scrollbar's width. 'overflow' has to be set for the gutter to be reserved. */
    .gutter { scrollbar-gutter: stable; overflow-y: hidden; }
    ul.gutter { overflow-y: auto; }
    /* The seam between the two seasons: dashed, because it separates two readings and not two things. */
    .split { border-left: 1px dashed color-mix(in oklab, var(--color-fg) 35%, transparent); }
  `,
  host: { class: 'view-host' },
})
export class Auction {
  protected readonly feed = inject(AuctionFeed);
  protected readonly advice = inject(AuctionAdvice);
  protected readonly demo = inject(AuctionDemo);
  protected readonly options = inject(GlobalOptions);
  private readonly rulings = inject(PlayerRulings);
  /** The steadiness of a man's seasons: `ValuationStore` asks `PlayerRatingsStore` for it, once. */
  private readonly ratings = inject(PlayerRatingsStore);
  private readonly valuation = inject(ValuationStore);
  private readonly bundle = inject(Bundle);
  /** The per-match layer, for the seasons the platform did not rate his club (`rebuiltLine`). */
  private readonly players = inject(PlayersStore);
  private readonly message = inject(NzMessageService);

  protected readonly connecting = signal(false);

  /** The debug switch that plays the rivals by themselves (see the effect in the constructor). */
  protected readonly auto = signal(false);

  constructor() {
    // A refresh mid-auction re-joins whatever session this browser was on, and only when there is none the
    // page opens on the declared league's table. The order is forced: starting the table first would
    // overwrite a real auction the operator is in.
    // The steadiness column reads the ratings, which the valuation store computes once its sheets are in.
    void this.valuation.load();
    void this.feed.restore().then(() => {
      if (!this.feed.hasTable()) void this.demo.start();
    });
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === 'default' || saved === 'medie' || saved === 'previste') this.mode.set(saved);
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
        league.platform, league.game, league.teams, league.slots, league.draftCap,
      ]);
      untracked(() => {
        const changed = last !== null && key !== last;
        last = key;
        if (changed && this.feed.demo()) void this.demo.start();
      });
    });

    // AUTO (debug, operator 29/09/2026): with it on, every squad but mine takes its predicted man 500ms after
    // coming on the clock - the same prediction the middle column prints - and the table stops on my turn.
    // Only on the invented table: a live auction's picks are the host's.
    effect((onCleanup) => {
      const clock = this.feed.onTheClock();
      const predicted = this.advice.round()?.picks.find((pick) => pick.teamId === clock?.id)?.player ?? null;
      if (!this.auto() || !this.feed.demo() || !clock || clock.id === this.feed.followedTeamId() || !predicted) return;
      const timer = setTimeout(() => {
        const refused = this.demo.pick(predicted.id);
        if (refused) {
          this.auto.set(false);
          this.message.warning(`AUTO fermo: ${refused}`);
        }
      }, AUTO_DELAY_MS);
      onCleanup(() => clearTimeout(timer));
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
  protected readonly seats = computed<SeatRow[]>(() => this.numberTurns(this.seatsInOrder()));

  /** Each seat's place in its own turn: see `SeatRow.turnAt`. */
  private numberTurns(seats: SeatRow[]): SeatRow[] {
    const size = seats.length;
    let start = 0;
    const out = seats.map((seat) => ({ ...seat }));
    while (start < size) {
      let end = start;
      while (end + 1 < size && seats[end + 1].team.squad.length === seats[start].team.squad.length) end += 1;
      // The FIRST group is the tail of the turn being played, unless it is the whole table.
      const first = start === 0 && end < size - 1 ? size - (end - start + 1) + 1 : 1;
      for (let at = start; at <= end; at += 1) out[at].turnAt = first + (at - start);
      start = end + 1;
    }
    return out;
  }

  private readonly seatsInOrder = computed<SeatRow[]>(() => {
    const teams = this.feed.teams();
    const order = this.feed.pickOrder();
    const listed = new Set(order.map((team) => team.id));
    const all = [...order, ...teams.filter((team) => !listed.has(team.id))];
    const round = this.advice.round();
    const picks = new Map((round?.picks ?? []).map((pick) => [pick.teamId, pick]));
    const nextOrder = round?.nextOrder ?? [];
    const mine = this.feed.followedTeamId();
    const selected = this.pitchTeam();
    return all.map((team, index) => {
      const pick = picks.get(team.id);
      const last = lastOf(team.squad);
      const at = nextOrder.indexOf(team.id);
      return {
        team,
        at: index + 1,
        turnAt: index + 1,
        mine: team.id === mine,
        last: last?.player
          ? { id: last.player.id, name: this.feed.shownName(last.player), roles: last.player.roles }
          : null,
        next: pick?.player
          ? {
              id: pick.player.id,
              name: this.shown(pick.player.id, pick.player.name),
              roles: pick.player.roles,
              predicted: pick.predicted,
            }
          : null,
        nextAt: at < 0 ? null : at + 1,
        delta: selected && selected.id !== team.id ? team.spent - selected.spent : null,
      };
    });
  });

  /**
   * The same seats in a FIXED order (by team), which is the order the DOM keeps: the place in the call order
   * is a transform (`--seat-at`), so a squad that moves slides instead of jumping. A DOM reordered on every
   * pick would move the nodes, and a moved node has no «before» style to transition from.
   */
  protected readonly seatsStable = computed(() => [...this.seats()].sort((a, b) => a.team.id - b.team.id));

  /**
   * WHERE ONE TURN ENDS AND THE NEXT BEGINS in the call order (operator, 29/09/2026: «basta che conti le
   * scelte già fatte»): the order puts fewest picks first, so a change in the pick count between two
   * neighbours is the boundary. `round` is the turn the squads BELOW the line are about to play.
   */
  protected readonly roundLines = computed(() => {
    const seats = this.seats();
    const out: { at: number; round: number }[] = [];
    for (let at = 1; at < seats.length; at += 1) {
      const above = seats[at - 1].team.squad.length;
      const below = seats[at].team.squad.length;
      if (below !== above) out.push({ at, round: below + 1 });
    }
    return out;
  });

  /** «Chi prendo adesso»: our own pick of the round being played, and how many calls come before it. */
  protected readonly advised = computed(() => {
    const mine = this.feed.followedTeamId();
    const pick = this.advice.round()?.picks.find((one) => one.teamId === mine) ?? null;
    return pick?.player
      ? { id: pick.player.id, name: this.shown(pick.player.id, pick.player.name), roles: pick.player.roles }
      : null;
  });

  protected readonly capLine = computed<string | null>(() => {
    const cap = this.advice.pickCap();
    return cap ? `Top bloccati: FVM ≥ ${cap.fvm} per ${cap.frozenTurns} turni` : null;
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

  protected signed(value: number): string {
    return value > 0 ? `+${value}` : String(value);
  }

  protected view(teamId: number): void {
    this.viewed.set(this.viewed() === teamId ? null : teamId);
  }

  /** «This squad is mine»: on the invented table it is how he sits down; on a live one the modal does it. */
  protected sitAt(teamId: number): void {
    this.feed.follow(teamId);
    this.viewed.set(null);
    this.demo.remember();
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

  /** A man as the pitch draws him: roles to match on, and the numbers the panel prices him with. */
  private manOf(player: AuctionPlayer, cost: number): FantaMan {
    const shown = this.feed.isMantra()
      ? player.roles
      : [CLASSIC_ROLE[this.feed.zoneOf(player)] ?? ''].filter(Boolean);
    return {
      id: player.id,
      name: this.feed.shownName(player),
      club: this.goal(player.id) ? 'porta' : player.club,
      shown,
      roles: shown.map((role) => role.toLowerCase()),
      value: this.advice.valueBy().get(player.id) ?? null,
      value99: this.advice.value99By().get(player.id) ?? null,
      cost,
      minutesPerMatch: null,
    };
  }

  private readonly squad = computed<FantaMan[]>(() =>
    (this.pitchTeam()?.squad ?? [])
      .filter((entry) => !!entry.player)
      .map((entry) => this.manOf(entry.player!, entry.cost)),
  );

  /**
   * THE SUGGESTED MEN, on MY squad only: the picks the plan projects for me with the auction going on
   * (`AuctionAdvice.projection`). Another squad's pitch shows what it has and nothing it might take.
   */
  private readonly suggested = computed<FantaMan[]>(() => {
    const team = this.pitchTeam();
    if (!team || team.id !== this.feed.followedTeamId()) return [];
    const everyone = this.everyone();
    return this.advice.projection()
      .map((pick) => everyone.get(pick.id))
      .filter((player): player is AuctionPlayer => !!player)
      .map((player) => this.manOf(player, player.fvm));
  });

  protected readonly pitch = computed(() => {
    const rules = this.advice.rules();
    const preferred = this.feed.isMantra() ? RECOMMENDED_MANTRA : [];
    const suggested = this.suggested();
    // The MODULE is the one the squad-to-be fields best, real and projected men together: the shape it is
    // being built towards. The men on it are then the real ones, and the suggestions fill the gaps.
    const target = this.forcedModule()
      ?? (suggested.length ? draftPitchOf([...this.squad(), ...suggested], rules, preferred)?.module ?? null : null);
    const drawn = draftPitchOf(this.squad(), rules, preferred, target);
    return drawn && suggested.length ? withSuggestions(drawn, suggested) : drawn;
  });

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
  private readonly linesPlatform = signal<Platform | null>(null);
  /** Last season from Transfermarkt (`desc_tm_*`), for whom not even a synthetic vote exists. */
  private readonly tmLines = signal<ReadonlyMap<number, SeasonLine>>(new Map());
  /** The rebuilt lines, one per `id|season`, cleared whenever the matches or the platform change. */
  private readonly rebuilt = computed(() => {
    this.players.ready();
    this.linesPlatform();
    return new Map<string, SeasonLine | null>();
  });
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
      if (score != null && score > top) top = score;
    }
    const rows = ranked.map((row) => this.freeRow(row, scores.get(row.player.id) ?? null, top, press, trends));
    // THE BLOCKED TOPS STAY WHERE THEIR PRIORITY PUTS THEM (operator, 29/09/2026: «devono essere visibili
    // anche i calciatori freezati»): they used to sink to the bottom of a list that loads sixty rows at a
    // time, i.e. out of sight. The row says it is blocked and for how long - dimmed, with its badge.
    return rows.sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || b.fvm - a.fvm);
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
      clubId: this.advice.clubIds().get(row.player.club) ?? null,
      roles: row.player.roles,
      fvm: row.price,
      ...this.rungOf(row, press, goal),
      trend: goal ? EMPTY_STRIP : (trends.get(row.player.id) ?? EMPTY_STRIP),
      priority: score == null || top <= 0 ? null : Math.max(0, Math.round((score / top) * 99)),
      locked: this.advice.lockedForMe(row.price),
      turnsLeft: this.turnsLeft(row.price),
      expected: this.expectedOf(row.player.id, goal),
      goal,
    };
  }

  /**
   * How many of OUR turns are left before a man of this FVM can be called: the ceiling blocks our first
   * `frozenTurns` picks, and the pick we are about to make is number `squad + 1`. Null when he is free.
   */
  private turnsLeft(price: number): number | null {
    const cap = this.advice.pickCap();
    const team = this.feed.followed();
    if (!cap || !team || !this.advice.lockedForMe(price)) return null;
    return Math.max(1, cap.frozenTurns - team.squad.length);
  }

  /**
   * WHERE I WOULD CALL IN THE NEXT TURN if I took a man of this FVM now (operator, 29/09/2026: «seleziona
   * una delle 12 posizioni e scompaiano i calciatori che comprandoli ti farebbero scegliere oltre»).
   *
   * The platform's rule, already written in the plan (`positionAfterSpending`): in the next turn everybody
   * has the same number of picks, so the order is the roster's FVM, cheapest first. A rival that still has
   * to call in THIS turn ends it with what the plan expects him to take (`simulateRound`); one that has
   * already called keeps what he has. Null when I follow no squad.
   */
  private readonly positionOf = computed<((price: number) => number) | null>(() => {
    const me = this.feed.followed();
    if (!me) return null;
    const expected = new Map((this.advice.round()?.picks ?? []).map((pick) => [pick.teamId, pick.player?.price ?? 0]));
    const rivals = this.feed.teams()
      .filter((team) => team.id !== me.id)
      .map((team) => team.spent + (team.squad.length === me.squad.length ? (expected.get(team.id) ?? 0) : 0));
    return (price: number) => positionAfterSpending(price, me.spent, rivals);
  });

  /** The furthest place in the next turn he accepts; null = every man. */
  protected readonly maxPosition = signal<number | null>(null);

  protected readonly positionOptions = computed(() =>
    Array.from({ length: this.feed.teams().length }, (_, at) => at + 1),
  );

  /** The list after the search, the role filter (roles in OR, as he asked) and the place filter. */
  protected readonly freeFiltered = computed<FreeRow[]>(() => {
    const query = this.query();
    const roles = this.roleFilter();
    const limit = this.maxPosition();
    const position = this.positionOf();
    return this.freeAll().filter(
      (row) =>
        looseMatch(query, row.name, row.club)
        && (!roles.size || row.roles.some((role) => roles.has(role.toLowerCase())))
        && (limit === null || !position || position(row.fvm) <= limit),
    );
  });

  /** Where taking him would put me next turn, for the row's tooltip. */
  protected nextPlace(row: FreeRow): number | null {
    return this.positionOf()?.(row.fvm) ?? null;
  }

  /**
   * THE COLUMN THE LIST IS SORTED BY, clicked on its header (operator, 29/09/2026), in both views. `null` is
   * the priority, which is the order the list opens on. A second click on the same header flips it, and a
   * man with no number sinks whichever way the column points: an empty cell is never «the best».
   */
  protected readonly seasonKeys = ['now', 'last'] as const;
  protected readonly metrics = [
    { key: 'pv', label: 'Pv' },
    { key: 'mv', label: 'Mv' },
    { key: 'fm', label: 'Fm' },
    { key: 'ga', label: 'G:A' },
  ] as const;

  protected readonly sortKey = signal<FreeSort | null>(null);
  protected readonly sortAsc = signal(false);

  protected sortBy(key: FreeSort): void {
    if (this.sortKey() === key) {
      this.sortAsc.set(!this.sortAsc());
      return;
    }
    this.sortKey.set(key);
    // Words read A to Z first; numbers read best first.
    this.sortAsc.set(key === 'name' || key === 'role');
  }

  protected arrow(key: FreeSort): string {
    const current = this.sortKey() ?? 'prio';
    if (current !== key) return '';
    return this.sortAsc() ? ' ↑' : ' ↓';
  }

  private readonly sorted = computed<FreeRow[]>(() => {
    const rows = this.freeFiltered();
    const key = this.sortKey();
    if (key === null) return rows;
    const sign = this.sortAsc() ? 1 : -1;
    if (key === 'name') {
      return [...rows].sort((a, b) => sign * a.name.localeCompare(b.name, 'it'));
    }
    const read = this.reader(key);
    return [...rows].sort((a, b) => {
      const left = read(a);
      const right = read(b);
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return sign * (left - right) || (b.priority ?? -1) - (a.priority ?? -1);
    });
  });

  /** How a column reads a row, as a number. */
  private reader(key: FreeSort): (row: FreeRow) => number | null {
    switch (key) {
      case 'role': {
        const order = this.roleOptions().map((role) => role.toLowerCase());
        return (row) => {
          const at = order.indexOf((row.roles[0] ?? '').toLowerCase());
          return at < 0 ? null : at;
        };
      }
      case 'press':
        return (row) => (row.press && PRESS_RANK[row.press] != null ? PRESS_RANK[row.press] : null);
      case 'fvm':
        return (row) => row.fvm;
      case 'prio':
        return (row) => row.priority;
      case 'rung':
        return (row) => (row.expected.rung && PRESS_RANK[row.expected.rung] != null ? PRESS_RANK[row.expected.rung] : null);
      case 'pvp':
        return (row) => row.expected.pv;
      case 'min':
        return (row) => row.expected.minutes;
      case 'mvp':
        return (row) => row.expected.mv;
      case 'steady':
        return (row) => row.expected.steady;
      case 'fmp':
        return (row) => row.expected.fm;
      case 'trend':
        return (row) => {
          const points = row.trend.map((cell) => cell.points).filter((one): one is number => one != null);
          return points.length ? points.reduce((sum, one) => sum + one, 0) / points.length : null;
        };
      default: {
        const [metric, which] = key.split('@') as [SeasonMetric, 'now' | 'last'];
        return (row) => {
          const line = this.lineOf(row.id, which);
          if (!line) return null;
          if (metric === 'ga') {
            return line.goals == null && line.assists == null ? null : (line.goals ?? 0) + (line.assists ?? 0);
          }
          return line[metric];
        };
      }
    }
  }

  protected readonly free = lazyRows(this.sorted, '[data-free-list]');

  protected badgeOf(word: string | null): string {
    return (word && RUNG_BADGE[word]) || 'bg-fg/10 text-muted';
  }

  /** The «previste» numbers of a man (see `FreeRow.expected`); a goal is a club and has none of its own. */
  private expectedOf(id: number, goal: boolean): FreeRow['expected'] {
    const numbers = goal ? null : (this.advice.numbers().get(id) ?? null);
    const platform = this.advice.entry()?.platform ?? 'default';
    const measured = numbers?.fm != null;
    return {
      rung: numbers?.titolarita ?? null,
      pv: numbers?.pv ?? numbers?.estPv ?? null,
      minutes: numbers?.minutesNext ?? null,
      mv: numbers?.mv ?? null,
      steady: goal ? null : (this.ratings.for(platform, id)?.steady?.share ?? null),
      fm: numbers?.fm ?? numbers?.estFm ?? null,
      estimated: !measured && (numbers?.estFm ?? null) != null,
    };
  }

  /** The press's word where the survey has him; else the sheet's rung, which the engine writes for all. */
  private rungOf(
    row: RankedPlayer,
    press: ReadonlyMap<number, { pressTier?: string | null }>,
    goal: boolean,
  ): { press: string | null; pressSource: 'stampa' | 'motore' | null } {
    return goal ? { press: null, pressSource: null } : this.rungById(row.player.id, press);
  }

  /** The same titolarità word by id, for the list AND the pitch: one reading, two places that show it. */
  private rungById(
    id: number,
    press: ReadonlyMap<number, { pressTier?: string | null }> = this.rulings.press(),
  ): { press: string | null; pressSource: 'stampa' | 'motore' | null } {
    const said = press.get(id)?.pressTier ?? null;
    if (said) return { press: said, pressSource: 'stampa' };
    const sheet = this.advice.numbers().get(id)?.titolarita ?? null;
    return sheet ? { press: sheet, pressSource: 'motore' } : { press: null, pressSource: null };
  }

  /**
   * THE TITOLARITÀ OF EVERY MAN OF THE PITCH, next to his name (operator, 29/09/2026). A goal (porte rule)
   * is a club and has no word of its own.
   */
  protected readonly pitchRungs = computed(() => {
    const press = this.rulings.press();
    const out = new Map<number, { press: string | null; pressSource: 'stampa' | 'motore' | null }>();
    for (const man of [...this.squad(), ...this.suggested()]) {
      out.set(man.id, this.goal(man.id) ? { press: null, pressSource: null } : this.rungById(man.id, press));
    }
    return out;
  });

  protected lineOf(id: number, which: 'now' | 'last'): SeasonLine | null {
    const season = this.seasons()[which];
    if (!season) return null;
    const scored = this.lines().get(id)?.get(season) ?? null;
    if (scored?.pv != null) return scored;
    const rebuilt = this.rebuiltLine(id, season);
    if (rebuilt) return rebuilt;
    // ...and where not even a synthetic vote exists, Transfermarkt's appearances (last season only).
    const fromTm = which === 'last' ? this.tmLines().get(id) : undefined;
    return fromTm ?? scored;
  }

  /**
   * THE SEASON THE PLATFORM DID NOT SCORE, rebuilt from his matches on the synthetic vote (operator,
   * 29/09/2026: «recuperiamo i valori dello scorso anno ... va bene anche visualizzare i valori
   * sintetici (in corsivo)»). Only where `season_stats` has no row: a scored line always wins. Null
   * until the per-match layer is in, and for a man who played outside the five championships.
   */
  private rebuiltLine(id: number, season: string): SeasonLine | null {
    const platform = this.linesPlatform();
    if (!platform || !this.players.ready()) return null;
    const memo = this.rebuilt();
    const key = `${id}|${season}`;
    if (!memo.has(key)) memo.set(key, seasonLineFromMatches(this.players.matchesOf(id, platform, season), season));
    return memo.get(key) ?? null;
  }

  protected ga(line: SeasonLine | null): string {
    if (!line || (line.goals == null && line.assists == null)) return '—';
    return `${line.goals ?? 0}:${line.assists ?? 0}`;
  }

  /** Double click: the squad on the clock takes him. Only the invented table can be written by hand. */
  protected take(row: FreeRow): void {
    this.cancelCard();
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
    const place = this.nextPlace(row);
    if (place != null) bits.push(`prendendolo chiami ${place}° nel turno dopo`);
    if (row.press) bits.push(`titolarità ${row.press} (${row.pressSource === 'stampa' ? 'dalla stampa' : 'dal motore'})`);
    if (row.turnsLeft != null) {
      bits.push(`bloccato: ancora ${row.turnsLeft} ${row.turnsLeft === 1 ? 'turno' : 'turni'} prima di poterlo chiamare`);
    }
    const clock = this.teamOnClock();
    if (this.feed.demo() && clock) bits.push(`doppio click: lo prende ${clock.label}`);
    return bits.join(' · ');
  }

  // ---------------------------------------------------------------------------------------- the cards

  /**
   * IL NOME DI UN CALCIATORE APRE LA SUA CARD, ovunque sulla pagina (operatore, 29/09/2026): nella lista,
   * sul campetto, nell'ordine di chiamata e nel consiglio. La card e' quella della plancia e della
   * Strategia (`ui-player-card`), con la sua pila: una sola per le due specie, perche' il posto e chi sta
   * davanti sono globali allo schermo. Nessun tavolo nella card (`market: null`): in un draft non c'e' una
   * max offerta.
   */
  private readonly cards = new CardStack();

  /** Every man of this table's listone, taken or free, so a card opens on a squad's man as on a free one. */
  private readonly everyone = computed(
    () => new Map(this.advice.listone().map((entry) => [entry.player.id, entry.player])),
  );

  protected readonly openCards = computed(() =>
    this.cards.place((key) => {
      const id = playerOfCard(key);
      return id == null ? undefined : (this.cardManOf(id) ?? undefined);
    }),
  );

  protected readonly clubCards = computed(() => this.cards.place((key) => clubOfCard(key) ?? undefined));
  protected readonly frontCard = computed(() => this.cards.front());

  /**
   * A click that may be the first half of a double click waits for it: in the free list the double click
   * CHOOSES, and a card opening under it would be the gesture doing two things.
   */
  private pendingCard: ReturnType<typeof setTimeout> | null = null;

  protected openCard(id: number, event?: MouseEvent, waitForDouble = false): void {
    event?.stopPropagation();
    this.cancelCard();
    if (event && event.detail > 1) return;
    if (!waitForDouble) {
      this.cards.openCard(playerCard(id));
      return;
    }
    this.pendingCard = setTimeout(() => {
      this.pendingCard = null;
      this.cards.openCard(playerCard(id));
    }, CARD_DELAY_MS);
  }

  private cancelCard(): void {
    if (this.pendingCard) clearTimeout(this.pendingCard);
    this.pendingCard = null;
  }

  protected closeCard(key: CardKey): void {
    this.cards.closeCard(key);
  }

  protected raiseCard(key: CardKey): void {
    this.cards.raiseCard(key);
  }

  protected openClubCard(club: string): void {
    this.cards.openCard(clubCard(this.advice.entry()?.platform ?? 'default', club));
  }

  /** A man as the card draws him, from the numbers the sheet already carries: nothing recomputed here. */
  private cardManOf(id: number): CardMan | null {
    const player = this.everyone().get(id);
    if (!player) return null;
    const numbers = this.advice.numbers().get(id) ?? null;
    const role = (CLASSIC_ROLE[player.zoneClassic] ?? 'C') as Role;
    const measured = numbers?.fm != null;
    const fm = numbers?.fm ?? numbers?.estFm ?? null;
    const porta = this.feed.isGoalsMode() ? this.feed.portaOfKeeper().get(id) : undefined;
    return {
      id,
      name: player.name,
      club: player.club,
      clubId: this.advice.clubIds().get(player.club) ?? null,
      where: this.feed.isMantra() && player.roles.length ? player.roles.join('/') : role,
      role,
      platform: this.advice.entry()?.platform ?? 'default',
      edge: fm == null ? null : fm - EDGE_BASE,
      pv: numbers?.pv ?? numbers?.estPv ?? null,
      rounds: this.advice.matchdaysTarget(),
      swing: null,
      fm,
      estimated: !measured && fm != null,
      estNote: numbers?.estNote ?? null,
      titolarita: numbers?.titolarita ?? null,
      titolaritaPlay: numbers?.titolaritaPlay ?? null,
      minutesNext: numbers?.minutesNext ?? null,
      seasonMatches: numbers?.seasonMatches ?? null,
      minutesFullSeason: numbers?.minutesFullSeason ?? null,
      category: numbers?.category ?? null,
      categoryLevel: numbers?.categoryLevel ?? null,
      categoryBars: numbers?.categoryBars ?? null,
      unpricedReason: numbers?.unpricedReason ?? null,
      fvm: player.fvm,
      out: null,
      market: null,
      ...(porta
        ? { porta: { club: porta.club, others: porta.keepers.filter((one) => one.id !== id).map((one) => one.name) } }
        : {}),
    };
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
      this.linesPlatform.set(platform);
      this.tmLines.set(last ? seasonLinesFromSheet(sheet, last) : new Map());
      void this.players.load();
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
