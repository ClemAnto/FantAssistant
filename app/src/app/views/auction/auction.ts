import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropdownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMenuModule } from 'ng-zorro-antd/menu';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { AuctionAdvice, RankedPlayer } from '../../core/auction-advice';
import { CardKey, CardMan, CardStack, clubCard, clubOfCard, playerCard, playerOfCard } from '../../core/player-card';
import { EDGE_BASE, Role } from '../../core/plancia';
import { positionAfterSpending } from '../../core/auction-plan';
import { ExportReadings, pickRecords, picksCsv, saveCsv, squadsCsv } from '../../core/draft-export';
import { AuctionDemo } from '../../core/auction-demo';
import { AuctionFeed, AuctionPlayer, AuctionTeam, CLASSIC_OF_ZONE, SquadEntry } from '../../core/auction-feed';
import { Bundle } from '../../core/bundle';
import { DraftPlace, draftPitchOf, pitchYield, placeYield, recommendedModules, withSuggestions } from '../../core/draft-pitch';
import type { FantaMan } from '../../core/fanta-eleven';
import { GlobalOptions } from '../../core/global-options';
import { lazyRows } from '../../core/lazy-rows';
import { looseMatch } from '../../core/loose-search';
import { trendStrips } from '../../core/plancia-store';
import { PlayerRulings } from '../../core/player-rulings';
import { PlayerRatingsStore } from '../../core/player-ratings-store';
import { ValuationStore } from '../../core/valuation-store';
import { type TrendCell, trendPointsMean } from '../../core/player-trend';
import { PlayersStore, type Platform } from '../../core/players-store';
import { SeasonLine, seasonLineFromMatches, seasonLines, seasonLinesFromSheet } from '../../core/season-line';
import { RUNG_RANK, Rarity, rarityText } from '../../core/draft-rarity';
import { AppHeader } from '../../ui/app-header/app-header';
import { ClubCard } from '../../ui/club-card/club-card';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { LiveConnect } from '../../ui/live-connect/live-connect';
import { PlayerCard } from '../../ui/player-card/player-card';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleSet } from '../../ui/role-set/role-set';
import { DeltaTrend } from '../../ui/delta-trend/delta-trend';
import type { Difficulty, Interest, Scenario, ScenarioStep, Verdict } from '../../core/draft-scenarios';


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
  | 'rung' | 'pvp' | 'min' | 'mvp' | 'steady' | 'fmp' | 'rar' | 'sesw'
  | `${SeasonMetric}@${'now' | 'last'}`;

/** The two ladders in one order, best first: what «sort by titolarità» orders by (one definition, in core). */
const PRESS_RANK = RUNG_RANK;

/** How the free list is read: the default columns, or the season averages (operator, 28/09/2026). */
export type FreeMode = 'default' | 'medie' | 'previste';

const MODE_KEY = 'fantassistant.draft.freeMode';
const PITCH_VIEW_KEY = 'fantassistant.draft.pitchView';

/** The columns the roster list sorts by. */
type RosterSort = 'role' | 'name' | 'fvm' | 'rung' | 'turn';

function readPitchView(): 'campo' | 'lista' {
  try {
    return localStorage.getItem(PITCH_VIEW_KEY) === 'lista' ? 'lista' : 'campo';
  } catch {
    return 'campo';
  }
}

/** Where the module he chose for his pitch is kept. */
const MODULE_KEY = 'fantassistant.draft.module';

function readModule(): string | null {
  try {
    return localStorage.getItem(MODULE_KEY) || null;
  } catch {
    return null;
  }
}

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
  /**
   * The priority as it is SHOWN: in a mantra draft the Draft Priority in hundredths of a point per matchday
   * (`hundredths`), elsewhere the 0-99 of this table's free pool; null where the sheet cannot value him.
   */
  priority: number | null;
  /** The raw score, the one the list is ordered on (the advice picks on it). */
  score: number | null;
  /**
   * RAR (operator, 30/09/2026): how many OTHER free men of his base role are of equal (similar) or higher
   * value on all six of his readings (`core/draft-rarity.ts`). 0 = the last of his kind. Null only while the
   * list has not been counted. `rarText` is how the column prints it: the count up to ten, then a share.
   */
  rar: Rarity | null;
  rarText: string;
  /**
   * SeSw, the SEASON SWING (operator, 30/09/2026): the name he gave to what the Draft Priority has been so far -
   * `draft-priority.manValue`, a fact about the man, in hundredths of a point per matchday. For now DP is the same
   * number; the formula that joins SeSw and RAR into the new DP is still to be found. Null outside a mantra draft.
   */
  sesw: number | null;
  /** The raw SeSw, for the sort. */
  seswScore: number | null;
  /** Off OUR board this turn because of the FVM ceiling of the first turns. */
  locked: boolean;
  /** Off OUR board for the rest of the draft: our line is full (the keepers, and on classic 8/8/6). */
  full: boolean;
  /** The squad predicted to take him BEFORE our next pick (`AuctionAdvice.takenBeforeUs`); null otherwise. */
  takenBy: { id: number; label: string; colour: string } | null;
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

/**
 * THE DRAFT PRIORITY AS IT IS SHOWN (the operator, 29/09/2026: «mostralo x100, ad esempio 0.15657 -> 15 oppure
 * 1.1 -> 110»): hundredths of a point per matchday, TRUNCATED toward zero as his example truncates, so a man
 * below his role's average reads negative instead of being clamped to 0.
 */
export function hundredths(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.trunc(Math.round(value * 1e6) / 1e4);
}

/** How long a click on a free man's name waits for its second half: the double click chooses him. */
const CARD_DELAY_MS = 260;

/** The places of an eleven: a plan's coverage total is read as a share of them. */
const ELEVEN = 11;

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
    NzDropdownModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzMenuModule,
    NzPopoverModule,
    NzRadioModule,
    NzSelectModule,
    NzTooltipModule,
    PlayerCard,
    PlayerFlags,
    RoleBadge,
    RoleSet,
    DeltaTrend,
  ],
  templateUrl: './auction.html',
  // The free list's two column sets. Declared once here and not as utilities on every row: the header and
  // the rows must share ONE track list, or the columns of the header drift from the numbers under them.
  styles: `
    .free-grid { display: grid; align-items: center; column-gap: 0.25rem; }
    /* THE ROLE TRACK FOLLOWS THE GAME (30/09/2026): up to three Mantra codes need 5.25rem, a classic man has ONE
       letter, and the same width there left a hole between the badge and the name on every row. */
    .classic-roles { --role-w: 1.4rem; }
    /* Role, name, FVM, priority first in all three views; then the view's own columns. FVM AND DP RIGHT AFTER
       THE NAME (operator, 29/09/2026): the name has a fixed room and the space the list has to spare goes to an
       empty last track, so a wide list does not push the two numbers a pick is made on to the far edge. */
    .free-default { grid-template-columns: var(--role-w, 5.25rem) minmax(0, 13rem) 2.25rem 2rem 2rem 2.25rem 4.9rem 75px minmax(0, 1fr); }
    .free-previste { grid-template-columns: var(--role-w, 5.25rem) minmax(0, 13rem) 2.25rem 2rem 2rem 2.25rem 4.9rem 2.1rem 2.1rem 2.3rem 2.3rem 2.3rem minmax(0, 1fr); }
    /* GONE BEFORE OUR TURN: a bar in the colour of the squad expected to take him, and a tint of it. */
    .taken {
      box-shadow: inset 3px 0 0 var(--taken);
      background: color-mix(in oklab, var(--taken) 14%, transparent);
    }
    .sort { cursor: pointer; user-select: none; }
    /* The call order: every seat sits at its place by a transform, so a change of place SLIDES. */
    ol { --seat-h: 1.3rem; --seat-step: 1.4rem; }
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
    /* The landing arrow of the selected man: a line on the gap the squad on the clock would slide into. */
    .landing {
      position: absolute; left: 0; right: 0; top: 0; height: 0; z-index: 2; pointer-events: none;
      border-top: 2px solid var(--landing);
      transform: translateY(calc(var(--seat-at) * var(--seat-step) - (var(--seat-step) - var(--seat-h)) / 2));
    }
    .landing > span {
      position: absolute; left: 0.1rem; top: -0.5rem; padding: 0 0.25rem; font-size: 10px; line-height: 0.95rem;
      font-weight: 600; border-radius: 0.2rem; background: var(--color-surface); color: var(--color-fg);
      border: 1px solid var(--landing);
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
    .free-medie { grid-template-columns: var(--role-w, 5.25rem) minmax(0, 13rem) 2.25rem 2rem 2rem 2.25rem repeat(8, 2.3rem) minmax(0, 1fr); }
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
  protected readonly hundredths = hundredths;
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
    // A REVIEW ENDS WITH THE PAGE: the cursor lives in the feed, which is shared with the plancia, and a board
    // opened elsewhere on a truncated table would show a past auction with no control saying so.
    inject(DestroyRef).onDestroy(() => this.feed.toEnd());
    // A refresh mid-auction re-joins whatever session this browser was on, and only when there is none the
    // page opens on the declared league's table. The order is forced: starting the table first would
    // overwrite a real auction the operator is in.
    // The steadiness column reads the ratings, which the valuation store computes once its sheets are in.
    void this.valuation.load();
    // The invented table only when there is NO session to resume: `restore` answers true as soon as it has
    // joined, which is BEFORE the stream's first event - and in that gap `hasTable()` still reads false, so
    // reading it alone started the demo on top of a live session that had just been joined (found on a live
    // draft, 29/09/2026, from a browser with the code saved and no snapshot).
    void this.feed.restore().then((resumed) => {
      if (!resumed && !this.feed.hasTable()) void this.demo.start();
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
    // A scenario describes one table state: the next pick makes it stale.
    effect(() => {
      this.feed.picks().length;
      untracked(() => this.chosen.set(null));
    });
    effect(() => {
      const entry = this.advice.entry();
      if (!entry) return;
      untracked(() => void this.loadReadings(entry.path, entry.platform));
    });
  }

  // ---------------------------------------------------------------------------------------- the table

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
    const mine = this.feed.followedTeamId();
    const selected = this.pitchTeam();
    return all.map((team, index) => {
      return {
        team,
        at: index + 1,
        turnAt: index + 1,
        mine: team.id === mine,
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

  /** The fantavoti of the strip in words, in the strip's own order, for its tooltip: the bars print no number. */
  protected trendText(cells: readonly TrendCell[]): string {
    if (!cells.length) return 'Nessuna partita';
    return 'Fantavoti: ' + cells.map((cell) => (cell.points == null ? '—' : cell.points.toFixed(1))).join(' · ');
  }

  /**
   * THE SCENARIO ON SCREEN (operator, 29/09/2026: «cliccando su una soluzione dovrebbe aggiornare il campetto ...
   * e nella tabella evidenziare i calciatori che potrebbero essere persi»): one of the three, or the one built
   * from a man he double-clicked, with its verdict. A new pick on the table clears it: it described a state
   * that is gone.
   */
  protected readonly chosen = signal<{ key: string; scenario: Scenario; verdict?: Verdict; why?: string } | null>(null);

  /** The three chains of the table state, and first the one the operator built from a man, when there is one. */
  protected readonly scenarioChains = computed(() => {
    const list = this.advice.scenarios().list
      .map((scenario, at) => ({ key: `auto:${at}:${scenario.first.player.id}`, scenario }));
    const mine = this.chosen();
    return mine?.verdict ? [{ key: mine.key, scenario: mine.scenario }, ...list] : list;
  });

  protected choose(key: string, scenario: Scenario): void {
    this.chosen.set(this.chosen()?.key === key ? null : { key, scenario });
  }


  /** A step of a chain: the name and what the whole squad gains by him («Undav +44»). */
  protected stepText(step: ScenarioStep): string {
    return `${this.shown(step.player.id, step.player.name)} ${this.gainText(step.gain)}`;
  }

  /** The ink of a plan's difficulty: safe and easy read green, medium amber, hard red. */
  protected readonly difficultyInk: Record<Difficulty, string> = {
    sicuro: 'text-success', facile: 'text-success', medio: 'text-warning', difficile: 'text-danger',
  };

  /** The squads that want the second man while we wait, in a few words: «Tiki Taka FC (nessun Pc)». */
  protected interestText(plan: Scenario): string {
    if (plan.wait === 0) return 'Nessuna scelta in mezzo';
    if (!plan.interested.length) return 'Nessuna delle squadre in mezzo gli è interessata';
    const why = (one: Interest) => {
      const role = one.role.charAt(0).toUpperCase() + one.role.slice(1);
      return one.why === 'nessuno' ? `nessun ${role}` : one.why === 'pochi' ? `pochi ${role}` : `${role} scarsi`;
    };
    return 'Interessate: ' + plan.interested
      .map((one) => `${this.feed.teams().find((team) => team.id === one.teamId)?.label ?? '?'} (${why(one)})`)
      .join(', ');
  }

  /** A gain on the squad in hundredths of a point per matchday, signed: «+67». */
  protected gainText(value: number): string {
    const gain = hundredths(value);
    return gain == null ? '—' : `${gain > 0 ? '+' : ''}${gain}`;
  }

  /**
   * The free man whose row is SELECTED, for the landing arrow in the call order: a click selects a row and a second
   * click on it clears it (operator, 29/09/2026: «non aggiornarlo sull'hover dei calciatori in tabella ma solo
   * quando si clicca su di essi per selezionare la riga»).
   */
  protected readonly selectedRow = signal<number | null>(null);

  protected selectRow(id: number): void {
    this.selectedRow.set(this.selectedRow() === id ? null : id);
  }

  /**
   * THE LANDING ARROW: where the squad on the clock ends up in the call order if it takes the selected man
   * (`AuctionAdvice.landingOf`). Drawn on the gap it would slide into: the squads that stay keep their
   * order, so in the list as it is now that gap is below the `at`-th of them.
   */
  protected readonly landing = computed(() => {
    const id = this.selectedRow();
    const land = id === null ? null : this.advice.landingOf(id);
    if (!land) return null;
    const team = this.feed.teams().find((one) => one.id === land.teamId);
    return team ? { at: land.at + 1, place: land.at + 1, label: team.label, colour: team.colour } : null;
  });

  /** The squad predicted to take a man before our next pick, for his row: the chosen scenario's, else the table's. */
  private takenBy(id: number): FreeRow['takenBy'] {
    const teamId = (this.chosen()?.scenario.gone ?? this.advice.takenBeforeUs()).get(id);
    const team = teamId === undefined ? null : this.feed.teams().find((one) => one.id === teamId);
    return team ? { id: team.id, label: team.label, colour: team.colour } : null;
  }

  /** The header's tooltip on the priority: what the number is, in the draft that has one. */
  protected prioHint(): string {
    return this.advice.priorityOn()
      ? 'Draft Priority: la SeSw, abbassata se ne resteranno di simili al tuo turno'
      : 'Priorità del consiglio, 0-99';
  }

  /**
   * THE LAST TEN PICKS, most recent first (operator, 29/09/2026): the call number, the squad's colour, the man
   * and what he cost.
   */
  protected readonly lastPicks = computed(() =>
    this.feed.teams()
      .flatMap((team) => team.squad.map((entry) => ({ entry, team })))
      .filter(({ entry }) => !!entry.player)
      .sort((a, b) => b.entry.index - a.entry.index)
      .slice(0, 10)
      .map(({ entry, team }) => ({
        index: entry.index,
        id: entry.player!.id,
        name: this.feed.shownName(entry.player!),
        roles: this.feed.gameRoles(entry.player),
        cost: entry.cost,
        team: team.label,
      })));

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
    // A module chosen by hand on a rival's pitch is about THAT squad: another one opens on its own best.
    this.rivalModule.set(null);
  }

  /** «This squad is mine»: on the invented table it is how he sits down; on a live one the modal does it. */
  protected sitAt(teamId: number): void {
    this.feed.follow(teamId);
    this.viewed.set(null);
    this.demo.remember();
  }

  // ---------------------------------------------------------------------------------------- the pitch

  /**
   * A module the operator forced, or null for the best one the rulebook allows. ONCE CHOSEN IT STAYS
   * (operator, 29/09/2026: «quando si seleziona un modulo quello deve essere e non deve modificarsi da
   * solo»): picks never move it, and it is kept in the browser so a refresh does not drop it back to the
   * automatic choice - which is the one that follows the squad.
   */
  protected readonly forcedModule = signal<string | null>(readModule());

  /**
   * THE PITCH OF ANOTHER PARTICIPANT opens on ITS best module, the one with the highest FERTILITY (operator,
   * 30/09/2026: «quando seleziono una squadra di un partecipante che non sia te stesso, devi selezionare in
   * automatico il modulo migliore (fertilità + alto)»). Mine keeps the module I forced, which is a decision about
   * the squad I am building; a rival's pitch is a reading of a squad I am not building, so it is chosen per squad
   * and a hand choice there lasts until another squad is opened - it is not saved, and it never moves mine.
   */
  protected readonly rivalView = computed(() => {
    const team = this.pitchTeam();
    return !!team && team.id !== this.feed.followedTeamId();
  });

  private readonly rivalModule = signal<string | null>(null);

  /** What the module selector shows: my forced module on my pitch, the hand choice on a rival's. */
  protected readonly moduleChoice = computed(() => (this.rivalView() ? this.rivalModule() : this.forcedModule()));

  /**
   * The module whose pitch has the highest fertility for the squad on screen, on real men only (the same
   * `pitchYield` the header prints); a tie goes to the higher coverage, then to the rulebook's order with the
   * recommended shapes first. Null on my own pitch.
   */
  protected readonly fertileModule = computed<string | null>(() => {
    if (!this.rivalView()) return null;
    const rules = this.advice.rules();
    const preferred = recommendedModules(this.feed.isMantra());
    const squad = this.squad();
    let best: { name: string; fertility: number; cover: number } | null = null;
    for (const name of this.moduleNames()) {
      const drawn = draftPitchOf(squad, rules, preferred, name);
      if (!drawn || drawn.module !== name) continue;
      const { cover, fertility } = pitchYield(drawn);
      if (!best || fertility > best.fertility + 1e-9 || (Math.abs(fertility - best.fertility) <= 1e-9 && cover > best.cover + 1e-9)) {
        best = { name, fertility, cover };
      }
    }
    return best?.name ?? null;
  });

  protected chooseModule(name: string | null): void {
    if (this.rivalView()) {
      this.rivalModule.set(name);
      return;
    }
    this.forcedModule.set(name);
    try {
      if (name) localStorage.setItem(MODULE_KEY, name);
      else localStorage.removeItem(MODULE_KEY);
    } catch {
      // A browser that refuses storage still draws the module; it just forgets it on refresh.
    }
  }

  protected readonly moduleNames = computed<string[]>(() => {
    const names = Object.keys(this.advice.rules()?.modules ?? {});
    const first = recommendedModules(this.feed.isMantra()).filter((name) => names.includes(name));
    return [...first, ...names.filter((name) => !first.includes(name))];
  });

  protected isRecommended(name: string): boolean {
    return recommendedModules(this.feed.isMantra()).includes(name);
  }

  /** A man as the pitch draws him: roles to match on, and the numbers the panel prices him with. */
  private manOf(player: AuctionPlayer, cost: number): FantaMan {
    const shown = this.feed.gameRoles(player);
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
      share: this.advice.expectedShareBy().get(player.id) ?? null,
      bonus: this.advice.bonusBy().get(player.id) ?? null,
    };
  }

  /** Coverage and fertility of a place, as the pitch prints them: «87%» and «+85» (hundredths per matchday). */
  protected yieldOf(place: DraftPlace): { cover: string; coverInk: string; fertility: string; fertilityInk: string; gain: string | null } {
    const { cover, fertility } = placeYield(place);
    const f = hundredths(fertility);
    // On a place the selected plan fills: how much coverage and fertility it adds there.
    let gain: string | null = null;
    if (this.planPlace(place)) {
      const after = placeYield(place, true);
      const df = hundredths((after.fertility ?? 0) - (fertility ?? 0)) ?? 0;
      gain = `+${Math.round((after.cover - cover) * 100)}% · ${df >= 0 ? '+' : ''}${df}`;
    }
    // Coverage in three inks (operator, 29/09/2026): red under half the calendar, amber under 85%, green from 85%.
    // The two cuts are DECLARED, not measured: change them here.
    const coverInk = cover < 0.5 ? 'text-danger' : cover < 0.85 ? 'text-warning' : 'text-success';
    // Fertility green, RED when negative (operator, 29/09/2026): a place that loses bonus points, a porta's malus.
    const fertilityInk = f != null && f < 0 ? 'text-danger' : 'text-success';
    return { cover: `${Math.round(cover * 100)}%`, coverInk, fertility: f == null ? '—' : `${f > 0 ? '+' : ''}${f}`, fertilityInk, gain };
  }

  /** Campo o lista, per la colonna della rosa: una preferenza di lettura, ricordata nel browser. */
  protected readonly pitchView = signal<'campo' | 'lista'>(readPitchView());

  protected setPitchView(view: 'campo' | 'lista'): void {
    this.pitchView.set(view);
    try {
      localStorage.setItem(PITCH_VIEW_KEY, view);
    } catch {
      // A browser that refuses storage still switches; it just forgets it on refresh.
    }
  }

  /**
   * LA ROSA IN LISTA (sua richiesta, 29/09/2026): i calciatori ACQUISTATI della squadra sul campetto, per
   * ruolo nell'ordine del regolamento (il primo codice di ciascuno), a parita' di ruolo il FVM piu' alto
   * prima. La titolarita' e' la stessa parola della lista degli svincolati (`rungById`: stampa, altrimenti
   * motore), cosi' un uomo non porta due parole in due colonne.
   */
  protected readonly rosterList = computed(() => {
    const order = this.roleOptions().map((role) => role.toLowerCase());
    const rank = (roles: string[]) => {
      const at = roles.map((role) => order.indexOf(role.toLowerCase())).filter((index) => index >= 0);
      return at.length ? Math.min(...at) : order.length;
    };
    const press = this.rulings.press();
    const ids = this.advice.clubIds();
    return (this.pitchTeam()?.squad ?? [])
      // The squad is in the order it was called, so its position is the squad's own TURN of that pick.
      .map((entry, at) => ({ entry, turn: at + 1 }))
      .filter(({ entry }) => !!entry.player)
      .map(({ entry, turn }) => {
        const player = entry.player!;
        const roles = this.feed.gameRoles(player);
        return {
          id: player.id,
          name: this.feed.shownName(player),
          club: player.club,
          clubId: ids.get(player.club) ?? null,
          roles,
          fvm: player.fvm,
          ...this.rungById(player.id, press),
          rank: rank(roles),
          turn,
        };
      })
      .sort((a, b) => a.rank - b.rank || b.fvm - a.fvm || a.name.localeCompare(b.name, 'it'));
  });

  /**
   * LA LISTA SI ORDINA PER COLONNA (sua richiesta, 29/09/2026), come quella degli svincolati: un click sceglie
   * la colonna, un secondo la rovescia. Il ruolo resta lo spareggio, cosi' a parita' l'ordine e' quello di
   * partenza. Un gradino ignoto va in fondo nei due versi: non e' «il peggiore», non ha una parola.
   */
  protected readonly rosterSort = signal<{ key: RosterSort; asc: boolean }>({ key: 'role', asc: true });

  protected sortRoster(key: RosterSort): void {
    const now = this.rosterSort();
    // Words and the turn read first-to-last; the FVM and the titolarità read best first.
    this.rosterSort.set(now.key === key ? { key, asc: !now.asc } : { key, asc: key !== 'fvm' && key !== 'rung' });
  }

  protected rosterArrow(key: RosterSort): string {
    const now = this.rosterSort();
    return now.key === key ? (now.asc ? ' ↑' : ' ↓') : '';
  }

  protected readonly rosterRows = computed(() => {
    const { key, asc } = this.rosterSort();
    const rows = this.rosterList();
    if (key === 'role' && asc) return rows;
    const of = (row: (typeof rows)[number]): number | string | null => {
      switch (key) {
        case 'name': return row.name;
        case 'fvm': return row.fvm;
        case 'turn': return row.turn;
        case 'rung': return row.press && PRESS_RANK[row.press] != null ? PRESS_RANK[row.press] : null;
        default: return row.rank;
      }
    };
    const sign = asc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = of(a), right = of(b);
      if (left === null || right === null) return left === right ? a.rank - b.rank : left === null ? 1 : -1;
      const diff = typeof left === 'string' ? left.localeCompare(right as string, 'it') : left - (right as number);
      return sign * diff || a.rank - b.rank;
    });
  });

  private readonly squad = computed<FantaMan[]>(() =>
    (this.pitchTeam()?.squad ?? [])
      .filter((entry) => !!entry.player)
      .map((entry) => this.manOf(entry.player!, entry.cost)),
  );

  /** MY squad, whichever squad the pitch shows: the plans are about mine. */
  private readonly mySquad = computed<FantaMan[]>(() =>
    (this.feed.followed()?.squad ?? [])
      .filter((entry) => !!entry.player)
      .map((entry) => this.manOf(entry.player!, entry.cost)),
  );

  /**
   * WHAT EACH STEP OF A PLAN ADDS to my pitch's coverage and fertility (operator, 29/09/2026: «la soluzione non deve
   * mostrare solo il +DP, mostra anche l'incremento di fertilità e di copertura»): my pitch drawn on the module the
   * plan builds towards, then with the first man, then with both - the same pipeline the pitch draws, so the
   * numbers are the ones a click puts on it. Coverage in percentage points of a place, fertility in hundredths.
   */
  protected readonly planYields = computed(() => {
    const out = new Map<string, { first: { cover: number; fertility: number }; second: { cover: number; fertility: number } | null }>();
    const rules = this.advice.rules();
    const preferred = recommendedModules(this.feed.isMantra());
    const squad = this.mySquad();
    const everyone = this.everyone();
    for (const chain of this.scenarioChains()) {
      const picks = [chain.scenario.first.player, ...(chain.scenario.second ? [chain.scenario.second.player] : [])]
        .map((pick) => everyone.get(pick.id))
        .filter((player): player is AuctionPlayer => !!player)
        .map((player) => this.manOf(player, player.fvm));
      // The module the pitch draws once the plan is chosen (`pitch`): the forced one first, or the totals here would
      // describe another shape than the per-place increments a click puts on the pitch.
      const target = this.forcedModule() ?? draftPitchOf([...squad, ...picks], rules, preferred)?.module ?? null;
      const yieldWith = (extra: FantaMan[]) => {
        const drawn = draftPitchOf(squad, rules, preferred, target);
        return drawn ? pitchYield(withSuggestions(drawn, extra), true) : { cover: 0, fertility: 0 };
      };
      const base = yieldWith([]);
      const one = yieldWith(picks.slice(0, 1));
      const both = picks.length > 1 ? yieldWith(picks) : null;
      out.set(chain.key, {
        first: { cover: one.cover - base.cover, fertility: one.fertility - base.fertility },
        second: both ? { cover: both.cover - one.cover, fertility: both.fertility - one.fertility } : null,
      });
    }
    return out;
  });

  /**
   * A plan's TOTAL increments in one short string, «+10% +35»: coverage as a share of the WHOLE ELEVEN (the places
   * it adds, over eleven), fertility in hundredths per matchday. Both men counted.
   */
  protected yieldText(plan: { first: { cover: number; fertility: number }; second: { cover: number; fertility: number } | null } | undefined): { cover: string; fertility: string; negative: boolean } | null {
    if (!plan) return null;
    const cover = plan.first.cover + (plan.second?.cover ?? 0);
    const f = hundredths(plan.first.fertility + (plan.second?.fertility ?? 0)) ?? 0;
    const c = Math.round((cover / ELEVEN) * 100);
    return { cover: `${c >= 0 ? '+' : ''}${c}%`, fertility: `${f >= 0 ? '+' : ''}${f}`, negative: f < 0 };
  }

  /** The men of the plan the operator selected, by id: the places of the pitch they stand on are highlighted. */
  protected readonly planMen = computed<ReadonlySet<number>>(() => {
    const plan = this.chosen()?.scenario;
    return new Set(plan ? [plan.first.player.id, ...(plan.second ? [plan.second.player.id] : [])] : []);
  });

  protected planPlace(place: DraftPlace): boolean {
    return this.planStep(place) !== null;
  }

  /**
   * Which of the plan's two men stands on this place: the FIRST is a pick we make, the SECOND is a hope - he has to
   * survive the picks in between - so his place is highlighted at half strength (operator, 29/09/2026).
   */
  protected planStep(place: DraftPlace): 'first' | 'second' | null {
    const plan = this.chosen()?.scenario;
    if (!plan) return null;
    const ids = [place.suggested?.id, place.suggestedReserve?.id];
    if (ids.includes(plan.first.player.id)) return 'first';
    if (plan.second && ids.includes(plan.second.player.id)) return 'second';
    return null;
  }

  /**
   * THE SUGGESTED MEN, on MY squad only: the picks the plan projects for me with the auction going on
   * (`AuctionAdvice.projection`). Another squad's pitch shows what it has and nothing it might take.
   */
  private readonly suggested = computed<FantaMan[]>(() => {
    const team = this.pitchTeam();
    if (!team || team.id !== this.feed.followedTeamId()) return [];
    const everyone = this.everyone();
    const chain = this.chosen()?.scenario;
    const picks = chain ? [chain.first.player, ...(chain.second ? [chain.second.player] : [])] : this.advice.projection();
    return picks
      .map((pick) => everyone.get(pick.id))
      .filter((player): player is AuctionPlayer => !!player)
      .map((player) => this.manOf(player, player.fvm));
  });

  protected readonly pitch = computed(() => {
    const rules = this.advice.rules();
    const preferred = recommendedModules(this.feed.isMantra());
    const suggested = this.suggested();
    // The MODULE is the one the squad-to-be fields best, real and projected men together: the shape it is
    // being built towards. The men on it are then the real ones, and the suggestions fill the gaps.
    const target = this.rivalView()
      ? (this.rivalModule() ?? this.fertileModule())
      : this.forcedModule()
        ?? (suggested.length ? draftPitchOf([...this.squad(), ...suggested], rules, preferred)?.module ?? null : null);
    const drawn = draftPitchOf(this.squad(), rules, preferred, target);
    return drawn && suggested.length ? withSuggestions(drawn, suggested) : drawn;
  });

  /**
   * THE WHOLE PITCH'S coverage and fertility, for the header (operator, 30/09/2026: «nell'intestazione del campo metti
   * anche la copertura totale e la fertilità totale»). The same `placeYield` the places print, summed, and on the REAL
   * men only: the header describes the squad, the suggestions are what a pick would add. Coverage as a share of the
   * eleven (the places covered over eleven), in the places' own three inks; fertility in hundredths per matchday.
   * A place whose bonus is unknown is left out of the sum and COUNTED, so a total over ten places is never read as one
   * over eleven («vuoto = ignoto, mai zero»).
   */
  protected readonly pitchTotals = computed(() => {
    const drawn = this.pitch();
    if (!drawn) return null;
    let cover = 0;
    let fertility = 0;
    let unknown = 0;
    let places = 0;
    for (const place of drawn.rows.flatMap((row) => row.places)) {
      const one = placeYield(place);
      places += 1;
      cover += one.cover;
      if (one.fertility == null) unknown += one.cover > 0 ? 1 : 0;
      else fertility += one.fertility;
    }
    const share = cover / (places || ELEVEN);
    const f = hundredths(fertility) ?? 0;
    return {
      cover: `${Math.round(share * 100)}%`,
      coverInk: share < 0.5 ? 'text-danger' : share < 0.85 ? 'text-warning' : 'text-success',
      fertility: `${f > 0 ? '+' : ''}${f}`,
      fertilityInk: f < 0 ? 'text-danger' : 'text-success',
      unknown,
    };
  });

  protected placeHint(place: DraftPlace): string {
    const yielded = this.yieldOf(place);
    const numbers = `copertura ${yielded.cover} · fertilità ${yielded.fertility}`;
    return `${this.placeHead(place)} · ${numbers}`;
  }

  private placeHead(place: DraftPlace): string {
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

  /** Every free man with his priority, highest first - the frozen ones included, where their score puts them. */
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
    const rar = this.advice.freeRarity();
    const season = this.advice.priorityOfMan();
    for (const row of rows) {
      row.rar = rar.get(row.id) ?? null;
      row.rarText = rarityText(row.rar);
      row.seswScore = season.get(row.id) ?? null;
      row.sesw = hundredths(row.seswScore);
    }
    // THE BLOCKED TOPS STAY WHERE THEIR PRIORITY PUTS THEM (operator, 29/09/2026: «devono essere visibili
    // anche i calciatori freezati»): they used to sink to the bottom of a list that loads sixty rows at a
    // time, i.e. out of sight. The row says it is blocked and for how long - dimmed, with its badge.
    // On the RAW score and not the 0-99 (the code review of 29/09/2026): the rounding tied men a point apart and
    // clamped every negative score to 0, and a tie broken by FVM could put the advised pick below his own list.
    return rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || b.fvm - a.fvm);
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
      roles: this.feed.gameRoles(row.player),
      fvm: row.price,
      ...this.rungOf(row, press, goal),
      trend: goal ? EMPTY_STRIP : (trends.get(row.player.id) ?? EMPTY_STRIP),
      priority: this.advice.priorityOn()
        ? hundredths(score)
        : score == null || top <= 0 ? null : Math.max(0, Math.round((score / top) * 99)),
      score,
      rar: null,
      rarText: '—',
      sesw: null,
      seswScore: null,
      locked: this.advice.lockedForMe(row.price),
      full: this.advice.fullForMe(row.player.id),
      takenBy: this.takenBy(row.player.id),
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

  /**
   * THE FVM RANGE of the free list (operator, 29/09/2026), both ends included; an empty box is no bound on
   * that side. A porta reads the FVM of the keeper it is called with, like the column.
   */
  protected readonly fvmMin = signal<number | null>(null);
  protected readonly fvmMax = signal<number | null>(null);

  /** The dearest free man: the upper end the label shows while no maximum is set. */
  protected readonly fvmTop = computed(() => this.freeAll().reduce((top, row) => Math.max(top, row.fvm), 0));

  protected setFvm(which: 'min' | 'max', value: unknown): void {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : null;
    (which === 'min' ? this.fvmMin : this.fvmMax).set(number);
  }

  /**
   * THE RUNG FILTER (operator, 29/09/2026: «nascondi tutti quelli che non sono ALMENO quel gradino»), read on
   * the rung the view SHOWS. In «Default» and «Medie» that is the PRESS's word only (his correction of the same
   * day: «il filtro sul gradino deve essere applicato sul gradino della stampa») - never the engine's rung the
   * «Default» column falls back to - and a man the press has no word for is hidden while the filter is on. In
   * «Previste» the column is the ENGINE's rung, and a filter on another word than the one printed beside it
   * read as a broken filter (his report of the same evening: Kane «titolare» under «almeno titolarissimo»).
   */
  protected readonly minRung = signal<number | null>(null);
  protected readonly rungOptions = [
    { rank: 6, label: 'almeno titolarissimo' },
    { rank: 5, label: 'almeno titolare' },
    { rank: 4, label: 'almeno ballottaggio' },
    { rank: 3, label: 'almeno comprimario' },
    { rank: 2, label: 'almeno riserva' },
  ] as const;

  /** Whose rung the filter reads now, for its placeholder. */
  protected readonly rungSource = computed(() => (this.mode() === 'previste' ? 'motore' : 'stampa'));

  /** The furthest place in the next turn he accepts; null = every man. */
  protected readonly maxPosition = signal<number | null>(null);

  protected readonly positionOptions = computed(() =>
    Array.from({ length: this.feed.teams().length }, (_, at) => at + 1),
  );

  /**
   * ONLY THE MEN EXPECTED GONE BEFORE OUR TURN: the rivals call by price, so under the priority's order they
   * sit far down the list, and a switch next to the count brings them up (29/09/2026).
   */
  protected readonly onlyTaken = signal(false);
  protected readonly takenCount = computed(() => this.freeAll().filter((row) => !!row.takenBy).length);

  /** The list after the search, the role filter (roles in OR, as he asked) and the place filter. */
  protected readonly freeFiltered = computed<FreeRow[]>(() => {
    const query = this.query();
    const roles = this.roleFilter();
    const limit = this.maxPosition();
    const position = this.positionOf();
    const low = this.fvmMin();
    const high = this.fvmMax();
    const rung = this.minRung();
    const rungFromEngine = this.mode() === 'previste';
    const onlyTaken = this.onlyTaken();
    return this.freeAll().filter(
      (row) =>
        (!onlyTaken || !!row.takenBy)
        && looseMatch(query, row.name, row.club)
        && (!roles.size || row.roles.some((role) => roles.has(role.toLowerCase())))
        && (limit === null || !position || position(row.fvm) <= limit)
        && (low === null || row.fvm >= low)
        && (high === null || row.fvm <= high)
        && (rung === null
          || (rungFromEngine
            ? row.expected.rung != null && (PRESS_RANK[row.expected.rung] ?? 0) >= rung
            : row.pressSource === 'stampa' && row.press != null && (PRESS_RANK[row.press] ?? 0) >= rung)),
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
    // Words read A to Z first; numbers read best first - and on RAR the best is the RAREST, the lowest count.
    this.sortAsc.set(key === 'name' || key === 'role' || key === 'rar');
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
      return sign * (left - right) || (b.score ?? -Infinity) - (a.score ?? -Infinity);
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
        return (row) => row.score;
      case 'rar':
        return (row) => row.rar?.count ?? null;
      case 'sesw':
        return (row) => row.seswScore;
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
        // Col 5 al posto di ogni fantavoto che manca (sua regola, 29/09/2026): chi salta una partita scende.
        return (row) => trendPointsMean(row.trend);
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
    if (!this.feed.demo()) {
      // A real table is read-only here: the double click builds the chain from him, with its verdict.
      const judged = this.advice.judgeScenario(row.id);
      if (!judged?.scenario) {
        this.message.info(judged ? judged.why : 'Nessuno scenario: la Draft Priority vale solo in un draft.');
        return;
      }
      this.chosen.set({ key: `judge:${row.id}`, scenario: judged.scenario, verdict: judged.verdict, why: judged.why });
      return;
    }
    const refused = this.demo.pick(row.id);
    if (refused) this.message.warning(refused);
  }

  protected undo(): void {
    if (!this.demo.undo()) this.message.info('Non c’è nessuna scelta da annullare.');
  }

  protected reset(): void {
    this.demo.reset();
  }

  /** At least one pick made: before that there is nothing to download, and the button says so by being off. */
  protected readonly hasPicks = computed(() => this.feed.picks().length > 0);

  /**
   * THE DRAFT AS TWO FILES (operator, 29/09/2026), from one set of records (`core/draft-export`): the numbers
   * of a man are the same readings the lists on this page print, so a file cannot disagree with the screen.
   */
  protected download(what: 'rose' | 'scelte'): void {
    const records = pickRecords([...this.feed.lastPicks()].reverse());
    if (!records.length) {
      this.message.info('Nessuna scelta da scaricare.');
      return;
    }
    const press = this.rulings.press();
    const readings = (id: number): ExportReadings => {
      const goal = this.goal(id);
      const expected = this.expectedOf(id, goal);
      const rung = goal ? { press: null, pressSource: null } : this.rungById(id, press);
      return {
        rung: rung.press,
        rungSource: rung.pressSource,
        fm: expected.fm,
        pv: expected.pv,
        value: this.advice.valueBy().get(id) ?? null,
        value99: this.advice.value99By().get(id) ?? null,
      };
    };
    const mine = this.feed.followedTeamId();
    const text = what === 'rose'
      ? squadsCsv(records, this.feed.teams(), mine, readings)
      : picksCsv(records, mine, readings);
    const table = this.feed.demo() ? 'finto' : (this.feed.code() ?? 'asta');
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    saveCsv(`draft-${table}-${stamp}-${what}.csv`, text);
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
    const role = (CLASSIC_OF_ZONE[player.zoneClassic] ?? 'C') as Role;
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

