import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzSegmentedModule } from 'ng-zorro-antd/segmented';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { APP_VERSION } from '../../version';
import { AuctionAdvice, RankedPlayer } from '../../core/auction-advice';
import { AuctionDemo } from '../../core/auction-demo';
import { Plan, PlanPlayer, PlannedPick } from '../../core/auction-plan';
import { per } from '../../core/auction-value';
import { AuctionFeed, DraftStatus, KeeperMode, Zone } from '../../core/auction-feed';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { PlayerTrendStrip } from '../../ui/player-trend/player-trend';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleSet } from '../../ui/role-set/role-set';
import { ClubPitch } from './club-pitch/club-pitch';
import { FantaPitch } from './fanta-pitch/fanta-pitch';

const STATUS_LABEL: Record<DraftStatus, string> = {
  [DraftStatus.Loading]: 'Caricamento',
  [DraftStatus.Idle]: 'In attesa di iniziare',
  [DraftStatus.Started]: 'In corso',
  [DraftStatus.Completed]: 'Completata',
  [DraftStatus.Terminated]: 'Terminata',
};

const ZONE_LABEL: Record<Zone, string> = {
  gk: 'Portieri',
  def: 'Difensori',
  mid: 'Centrocampisti',
  atk: 'Attaccanti',
  mov: 'Movimento',
};

/** Which way the operator likes his suggestions drawn: it survives a refresh like the other settings. */
const PLAN_VIEW_KEY = 'fantassistant.auction.planView';

/** How many players to list per zone. Thirty, on the operator's request of 10/08/2026: the list is
 *  what he reads at the table, and eight ran out as soon as the first names went. */
const AVAILABLE_PER_ZONE = 30;

/** The columns a header can sort by, and how each one reads a row. */
const SORTS = {
  // IL LEAD, che è la colonna con cui la lista apre (operatore, 18/08/2026: era «Valore», su 0-99).
  lead: (row: RankedPlayer) => row.lead,
  surplus: (row: RankedPlayer) => row.surplusPer10,
  price: (row: RankedPlayer) => row.price,
  fmPrev: (row: RankedPlayer) => row.fmPrev,
  minutes: (row: RankedPlayer) => row.minutesPerMatch,
  net: (row: RankedPlayer) => row.netPer10,
  // What he has DONE in his club's last ten league matches. It orders the list and it enters no
  // valuation: measured 14/08/2026, a departure from one's own averages does not predict the next
  // rounds (excess +0.0167 / +0.0072 / -0.0007 at 2, 3 and 5 matchdays, sign changing).
  trend: (row: RankedPlayer) => row.trend99,
} as const;

export type SortKey = keyof typeof SORTS;

@Component({
  selector: 'app-auction',
  imports: [
    ClubPitch,
    DecimalPipe,
    FantaPitch,
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzEmptyModule,
    NzInputModule,
    NzInputNumberModule,
    NzProgressModule,
    NzSegmentedModule,
    NzTagModule,
    NzTooltipModule,
    PlayerFlags,
    PlayerTrendStrip,
    RoleBadge,
    RoleSet,
  ],
  templateUrl: './auction.html',
  host: { class: 'view-host' },
})
export class Auction {
  protected readonly feed = inject(AuctionFeed);
  protected readonly advice = inject(AuctionAdvice);
  protected readonly demo = inject(AuctionDemo);
  protected readonly appVersion = APP_VERSION;
  protected readonly zoneLabel = ZONE_LABEL;

  protected readonly code = signal('');

  /**
   * The switch carries the mode as its VALUE. With plain strings `nz-segmented` emits the label, so
   * an index-based mapping silently resolves to the first option - it did, and only the browser saw it.
   */
  protected readonly keeperModeOptions: { label: string; value: KeeperMode }[] = [
    { label: 'Portieri', value: 'players' },
    { label: 'Porte', value: 'goals' },
  ];

  constructor() {
    // A refresh mid-auction must not cost a setup: re-join whatever session this browser was on.
    void this.feed.restore();
    try {
      const saved = localStorage.getItem(PLAN_VIEW_KEY);
      if (saved === 'estesa' || saved === 'compatta') this.planView.set(saved);
    } catch {
      // Nothing saved: the extended view is the default.
    }
  }

  /**
   * How the suggestions are drawn. `estesa` groups by ROUND - who picks around you, round by round -
   * and `compatta` pivots the same simulation by TEAM, one chain per squad in the current pick order.
   * The numbers are identical: it is the same plan read along the other axis.
   */
  protected readonly planViewOptions: { label: string; value: 'estesa' | 'compatta' }[] = [
    { label: 'Estesa', value: 'estesa' },
    { label: 'Compatta', value: 'compatta' },
  ];
  protected readonly planView = signal<'estesa' | 'compatta'>('estesa');

  protected setPlanView(view: 'estesa' | 'compatta'): void {
    this.planView.set(view);
    try {
      localStorage.setItem(PLAN_VIEW_KEY, view);
    } catch {
      // A browser that refuses storage still draws the card; it just forgets which way you like it.
    }
  }

  /**
   * The same plan pivoted by TEAM: each squad's chain of picks to come, in the order it will take them.
   *
   * Rows follow the CURRENT pick order, so the list reads top-to-bottom like the table does, and only
   * FUTURE picks are in it - what a squad already holds is in its own card, and mixing the two would
   * make «>» mean two different things.
   */
  protected readonly planByTeam = computed(() => {
    const plan = this.advice.planned();
    const mineId = this.feed.followedTeamId();
    if (!plan?.mine || mineId === null) return [];

    const chains = new Map<number, { label: string; picks: PlanPlayer[] }>();
    const push = (teamId: number, label: string, player: PlanPlayer) => {
      const row = chains.get(teamId) ?? { label, picks: [] };
      row.picks.push(player);
      chains.set(teamId, row);
    };

    push(mineId, 'Tu', plan.mine);
    for (const round of plan.rounds) {
      for (const entry of round.before) push(entry.teamId, entry.teamLabel, entry.player);
      if (round.mine) push(mineId, 'Tu', round.mine);
      for (const entry of round.after) push(entry.teamId, entry.teamLabel, entry.player);
    }

    const order = this.feed.pickOrder().map((team) => team.id);
    const rounds = this.advice.rounds();
    return [...chains.entries()]
      .sort(([a], [b]) => {
        const left = order.indexOf(a);
        const right = order.indexOf(b);
        return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
      })
      .map(([teamId, row]) => {
        // The mean of what OUR numbers say those picks are worth, in the unit the rest of the panel
        // uses (points every ten rounds). Only the picks we can price are in it, and `priced` says how
        // many they were: a mean over half a chain is a different quantity and must not read as the
        // chain's. The trim rule does not apply here - four picks is under its own 5-sample floor.
        const priced = row.picks.map((pick) => pick.net).filter((net): net is number => net !== null);
        const mean = priced.length ? priced.reduce((sum, net) => sum + net, 0) / priced.length : null;
        // Where he would choose in the round AFTER the simulated ones: the consequence of the chain.
        const at = plan.nextOrder.indexOf(teamId);
        return {
          teamId,
          label: row.label,
          picks: row.picks,
          mine: teamId === mineId,
          avg: per(mean, rounds),
          priced: priced.length,
          of: row.picks.length,
          nextAt: at < 0 ? null : at + 1,
        };
      });
  });

  /** True while the card is answering «e se prendessi lui?» instead of showing its own suggestion. */
  protected readonly isWhatIf = computed(() => {
    const chosen = this.advice.chosenRoot();
    return chosen !== null && !this.advice.roots().some((root) => root.player.id === chosen);
  });

  protected isChosenRoot(playerId: number): boolean {
    const chosen = this.advice.chosenRoot();
    return chosen === null ? this.advice.plans()[0]?.root.player.id === playerId : chosen === playerId;
  }

  /**
   * What a whole chain is worth on average, by our numbers, in points every ten rounds.
   *
   * It is the number that makes three options comparable: the root alone would say «the dearest man
   * wins», which is what the option list exists to argue with. Only the picks the engine prices are in
   * it - the rest would drag a mean nobody can read.
   */
  protected chainAverage(plan: Plan): number | null {
    const picks = [plan.mine, ...plan.rounds.map((round) => round.mine)]
      .filter((pick): pick is PlanPlayer => !!pick)
      .map((pick) => pick.net)
      .filter((net): net is number => net !== null);
    if (!picks.length) return null;
    return per(picks.reduce((sum, net) => sum + net, 0) / picks.length, this.advice.rounds());
  }

  /** The keepers of mine that took a goal somebody already had, named so the warning is actionable. */
  protected readonly strayNames = computed(() =>
    this.feed
      .myStrayKeeperPicks()
      .map((entry) => {
        const keeper = entry.porta.keepers.find((player) => player.id === entry.pick.playerId);
        return `${keeper?.name ?? 'un portiere'} (${entry.porta.club})`;
      })
      .join(', '),
  );

  protected readonly connecting = computed(() => this.feed.status() === 'connecting');

  /** The saved-table marker. It must never read as live, and it must say which of the two it is. */
  protected readonly staleLabel = computed(() =>
    this.feed.status() === 'error' ? '· salvato · riaggancio non riuscito' : '· salvato · riaggancio in corso',
  );

  protected readonly staleTitle = computed(() => {
    const saved = this.feed.savedAt();
    const when = saved ? ` (${new Date(saved).toLocaleTimeString('it-IT')})` : '';
    return this.feed.status() === 'error'
      ? `Ultimo stato salvato in questo browser${when}. Il riaggancio non è riuscito: ${this.feed.error() ?? ''} I numeri restano quelli di quel momento.`
      : `Ultimo stato salvato in questo browser${when}. Il collegamento è in corso: appena arriva, la pagina si aggiorna da sé.`;
  });
  protected readonly statusLabel = computed(() => STATUS_LABEL[this.feed.draftStatus()] ?? '—');
  protected readonly marketLabel = computed(() => (this.feed.isDraft() ? 'Draft' : 'Rilanci'));

  protected readonly budgetLeftPercent = computed(() => {
    const team = this.feed.followed();
    const budget = this.feed.budget();
    return team && budget ? Math.round((team.budgetLeft / budget) * 100) : 0;
  });

  /** What can go on the next name while still leaving one credit for every slot left to fill. */
  protected readonly maxAffordable = computed(() => {
    const team = this.feed.followed();
    return team ? Math.max(0, team.budgetLeft - Math.max(0, team.missingTotal - 1)) : 0;
  });

  /**
   * The best free men per zone, ranked by what they are WORTH and not by what they cost.
   *
   * The order is the VALUE - fantamedia x expected appearances - because this panel prices a DRAFT, and
   * that is measured and not preferred (§26, five gate windows): the netto scores −52% against the paired
   * rivals here, because lambda is a rate you pay in an auction with raises and not in a draft, where the
   * scarce thing is the PICK. The surplus and the netto stay as columns and as sort keys: they are what a
   * price is read against, and they are the right key the day a credit auction is played here.
   */
  protected readonly topAvailable = computed(() => {
    // With the porte rule on, the keepers are listed as goals instead: one row per club, below.
    const zones = this.feed
      .zones()
      .filter((zone) => !(zone === 'gk' && this.feed.isGoalsMode()));
    return zones.map((zone) => ({
      zone,
      label: ZONE_LABEL[zone],
      // The THIRTY best by value, re-ordered by whichever column was clicked. Sorting the whole
      // listone by price would answer a different question - the thirty cheapest men are nobody.
      players: this.sorted(this.advice.bySlotOrZone(zone, AVAILABLE_PER_ZONE)),
    }));
  });

  /**
   * Which column the lists are ordered by. The WORTH is the default, descending.
   *
   * It has to be the same quantity the rows were SELECTED with, or the first row the operator reads is not
   * the one the panel recommends - a displayed list whose order describes a different list, which is a
   * defect this project has already paid for once.
   */
  protected readonly sortKey = signal<SortKey>('lead');
  protected readonly sortAsc = signal(false);

  /**
   * Below how many fantapunti a denial is not worth printing.
   *
   * Measured (item 1.5, §17): what switching to a denial pick costs us has a median of about 10 fantapunti in
   * the rounds where denial can pay at all, and a point taken from ONE rival is worth about a tenth of a point
   * of ours in a table of twelve. So a denial under ~50 cannot repay even a small sacrifice, and printing it
   * would be decoration. The number is deliberately blunt: it decides what is SHOWN, never what is chosen.
   */
  protected readonly denialFloor = 50;

  /** What clicking a predicted pick does, and what taking him first would remove from that rival. */
  protected denialHint(row: PlannedPick): string {
    const base = 'Imposta questo giocatore come TUA scelta e ricalcola tutto da lì';
    if (!(row.denies >= this.denialFloor)) return base;
    return `${base}. Prendendolo tu, togli ${Math.round(row.denies)} fantapunti all'undici di `
      + `${row.teamLabel} — misurato: conviene solo nei primi giri, e solo se il tuo miglior nome `
      + 'alternativo è quasi equivalente.';
  }

  /** Click once to sort by a column, again to flip it. */
  protected toggleSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortAsc.set(!this.sortAsc());
      return;
    }
    this.sortKey.set(key);
    // Money and minutes read naturally ascending first (who costs least), the rest descending.
    this.sortAsc.set(key === 'price');
  }

  protected sortArrow(key: SortKey): string {
    if (this.sortKey() !== key) return '';
    return this.sortAsc() ? ' ↑' : ' ↓';
  }

  private sorted(rows: RankedPlayer[]): RankedPlayer[] {
    const read = SORTS[this.sortKey()];
    const sign = this.sortAsc() ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = read(a);
      const right = read(b);
      // A missing number is never «the best»: it sinks whichever way the column is pointing.
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return (left - right) * sign;
    });
  }

  /** One line per row, on the tooltip: the two secondary numbers plus what the surplus is measured on. */
  protected explain(row: RankedPlayer): string {
    const parts: string[] = [];
    const rounds = this.advice.rounds();
    if (row.lead != null) {
      parts.push(`lead ${row.lead.toFixed(1)} fantapunti sopra il rimpiazzo`
        + (row.leadZero != null ? ` (rimpiazzo ${row.leadZero.toFixed(2)} di fantamedia)` : ''));
    }
    if (row.surplus != null) {
      parts.push(
        `${row.surplus.toFixed(1)} punti in tutto` + (rounds ? ` su ${rounds} giornate` : ''),
      );
    }
    if (row.valuation.fm != null && row.valuation.pv != null) {
      parts.push(
        `fantamedia ${row.valuation.fm.toFixed(2)} su ${row.valuation.pv.toFixed(1)} presenze attese`,
      );
    }
    if (row.replacementFm != null) {
      parts.push(`rimpiazzo fra i liberi ${row.replacementFm.toFixed(2)}`);
    }
    if (row.surplusForMe != null) {
      parts.push(`alza il TUO undici di ${row.surplusForMe.toFixed(1)}`);
    }
    if (row.ratio != null) parts.push(`qualità/prezzo ${row.ratio.toFixed(3)} per credito`);
    if (!row.zeroIsLive) {
      parts.push("zero di lega: al tavolo non c'è una domanda calcolabile per questo ruolo");
    }
    if (row.valuation.basis === 'estimated') {
      parts.push(`stima: ${row.valuation.note ?? 'base dichiarata'}`);
    }
    if (row.valuation.basis === 'none') {
      parts.push(row.valuation.note ?? 'il motore non lo prezza');
    }
    return parts.join(' · ');
  }

  /** The dearest goals nobody has taken yet - the unit a bid is made on when the porte rule is on. */
  protected readonly topPorte = computed(() => this.feed.freePorte().slice(0, AVAILABLE_PER_ZONE));

  /** Whether an entry of my squad is a keeper that granted no porta. */
  protected isStray(index: number): boolean {
    return this.feed.myStrayKeeperPicks().some((entry) => entry.pick.index === index);
  }

  protected async connect(): Promise<void> {
    await this.feed.connect(this.code());
  }

  /** The invented table: what the panel does, without an auction to follow. */
  protected async startDemo(): Promise<void> {
    await this.demo.start();
  }

  /**
   * One line naming the listone the demo is played on: a fixture must say what it is made of.
   *
   * The count is the LIVE one and not the sheet's `rows`: the demo board carries only the men the target
   * listone actually quotes, so the two numbers differ (898 of 1009 on the euro sheet) and printing the
   * bigger one would describe a list nobody is playing with.
   */
  protected readonly demoSource = computed(() => {
    const sheet = this.demo.sheet();
    if (!sheet) return '';
    return `${sheet.league} · ${sheet.game} · ${sheet.platform} · `
      + `${this.feed.listoneIds().length} giocatori quotati`;
  });

  protected exit(): void {
    // Leaving a DEMO must not forget the real session this browser may be holding: the demo was never
    // saved, so there is nothing of its own to remove and `forget()` here would delete somebody else's.
    const wasDemo = this.feed.demo();
    this.feed.disconnect();
    if (!wasDemo) this.feed.forget();
    this.code.set('');
  }
}
