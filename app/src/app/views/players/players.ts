import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSliderModule } from 'ng-zorro-antd/slider';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { RouterLink } from '@angular/router';

import { CLASSIC_ROLES, ClassicRole, Platform, PlayersStore } from '../../core/players-store';
import { CONSULTABLE_FLAGS, FLAG_LABEL, PlayerFlag } from '../../core/player-status';
import { ValuationStore } from '../../core/valuation-store';
import { asFlag, bindQuery, storedFlag } from '../../core/view-state';
import { MatchesTable } from '../../ui/matches-table/matches-table';
import { SquadTable } from '../../ui/squad-table/squad-table';
import { APP_VERSION } from '../../version';

const ROLE_LABEL: Record<ClassicRole, string> = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

/**
 * The two questions this page can answer about the same list of men.
 *
 * `matches` is what he DID, match by match; `ratings` is what he is WORTH - the squads view's own table,
 * the same component reading the same store, because «le stesse colonne» has to mean the same numbers.
 * The filters that survive the switch are the ones both modes can honour: a period of matchdays means
 * nothing to a valuation of the season that is coming, so it is hidden rather than left there lying.
 */
export type PlayersMode = 'matches' | 'ratings';

@Component({
  selector: 'app-players',
  imports: [
    FormsModule,
    RouterLink,
    NzAlertModule,
    NzButtonModule,
    NzCheckboxModule,
    NzCollapseModule,
    NzIconModule,
    NzInputModule,
    NzRadioModule,
    NzSelectModule,
    NzSliderModule,
    NzSpinModule,
    NzTooltipModule,
    MatchesTable,
    SquadTable,
  ],
  templateUrl: './players.html',
  host: { class: 'view-host' },
})
export class Players {
  protected readonly store = inject(PlayersStore);
  /** The valuation of a man: the same store the squads view reads, so one man reads one way. */
  protected readonly valuation = inject(ValuationStore);
  protected readonly appVersion = APP_VERSION;
  protected readonly roles = CLASSIC_ROLES;
  protected readonly roleLabel = ROLE_LABEL;
  /** Le icone che queste tabelle sanno produrre, e come si chiamano: una definizione sola. */
  protected readonly markFlags = CONSULTABLE_FLAGS;
  protected readonly markLabel = FLAG_LABEL;

  /**
   * Which of the two tables is on screen, and it OPENS ON THE VALUATIONS (operatore, 18/08/2026).
   *
   * It used to open on the matches - what the page had always been - and the cost of the valuations was
   * the reason (they read the sheet, the boards and the granular roles, and rank the whole listone). The
   * decision reverses the default because this app is an auction assistant: «quanto vale» is the question
   * one comes here with, and «ultime partite» is the one you ask about a man you have already found.
   * The load is started in the constructor for the same reason - a default view that fetches only after a
   * click would show an empty table on the page that opens.
   */
  protected readonly mode = signal<PlayersMode>('ratings');

  /**
   * The men the filters keep, valued.
   *
   * The POOL of the four readings stays the whole listone - a percentile is a fact about a pool, and
   * filtering by club must not re-rank a man against his team-mates alone - while the ROWS are the ones
   * on screen: the same `filtered` the match table is built from, so the two modes are two readings of
   * one list and never two lists.
   */
  protected readonly valued = computed(() =>
    this.valuation.valuations(this.store.platform(), this.store.filtered()),
  );

  protected readonly window = computed<[number, number]>(() => [
    this.store.windowFrom(),
    this.store.windowTo(),
  ]);

  /** The filter bar takes a fifth of the screen and is set once per session: it collapses, and
   *  when closed its header says what is applied, so a folded filter can never be a hidden one.
   *  Open or closed is a habit and not a selection, so it is remembered here and not in the address. */
  protected readonly filtersOpen = storedFlag('players.filters', true);

  /** What is applied, so a folded filter bar is never a hidden one - and it lists only the filters
   *  the mode on screen actually honours. */
  protected readonly filterSummary = computed(() => {
    const parts: string[] = [this.store.platform() === 'euro' ? 'EuroLeghe' : 'Serie A'];
    if (this.mode() === 'matches') parts.push(this.store.season());
    const search = this.store.search();
    if (search) parts.push(`«${search}»`);
    const role = this.store.role();
    if (role) parts.push(ROLE_LABEL[role]);
    for (const flag of this.store.flags()) parts.push(FLAG_LABEL[flag]);
    const club = this.store.club();
    if (club) parts.push(club);
    if (this.mode() !== 'matches') return parts.join(' · ');
    if (this.store.withCups()) parts.push('coppe');
    if (this.store.withFriendlies()) parts.push('amichevoli');
    if (this.store.byMatchday()) {
      parts.push(`giornate ${this.store.windowFrom()}-${this.store.windowTo()}`);
    }
    return parts.join(' · ');
  });

  constructor() {
    void this.store.load();
    // La vista che apre e' quella delle valutazioni, quindi il suo strato si carica subito: `load()` e'
    // idempotente, quindi tornare avanti e indietro costa una fetch per sessione.
    void this.valuation.load();

    /*
     * Every filter of this page in the address, so a refresh - or a link - finds the same table.
     *
     * The ORDER is the point: choosing a listone empties the club filter and re-picks the season, and
     * choosing a season resets the window, so those two are applied first and the fields they would
     * overwrite come after. Each `apply` checks before it writes for the same reason: this runs on every
     * navigation, and a blind re-apply would wipe the fields applied beside it.
     */
    bindQuery(
      [
        {
          param: 'listone',
          read: () => (this.store.platform() === 'default' ? null : this.store.platform()),
          apply: (raw) => {
            const platform: Platform = raw === 'euro' ? 'euro' : 'default';
            if (platform !== this.store.platform()) this.store.selectPlatform(platform);
          },
        },
        {
          param: 'stagione',
          read: () => this.store.season() || null,
          apply: (raw) => {
            if (raw && raw !== this.store.season() && this.store.seasons().includes(raw)) {
              this.store.selectSeason(raw);
            }
          },
        },
        {
          param: 'da',
          read: () => String(this.store.windowFrom()),
          apply: (raw) => {
            const round = Number(raw);
            if (raw && Number.isFinite(round)) this.store.windowFrom.set(round);
          },
        },
        {
          param: 'a',
          read: () => String(this.store.windowTo()),
          apply: (raw) => {
            const round = Number(raw);
            if (raw && Number.isFinite(round)) this.store.windowTo.set(round);
          },
        },
        {
          param: 'vista',
          // L'indirizzo porta soltanto quello che NON e' il default, e il default e' cambiato: adesso
          // «?vista=matches» e' la deviazione. Un link vecchio con «?vista=ratings» resta valido.
          read: () => (this.mode() === 'ratings' ? null : this.mode()),
          apply: (raw) => this.show(raw === 'matches' ? 'matches' : 'ratings'),
        },
        {
          param: 'cerca',
          read: () => this.store.search() || null,
          apply: (raw) => this.store.search.set(raw ?? ''),
        },
        {
          param: 'ruolo',
          read: () => this.store.role(),
          apply: (raw) =>
            this.store.role.set(
              CLASSIC_ROLES.includes(raw as ClassicRole) ? (raw as ClassicRole) : null,
            ),
        },
        {
          param: 'icone',
          read: () => this.store.flags().join(',') || null,
          apply: (raw) =>
            this.store.flags.set(
              (raw ?? '').split(',').filter((one): one is PlayerFlag =>
                CONSULTABLE_FLAGS.includes(one as PlayerFlag)),
            ),
        },
        {
          param: 'squadra',
          read: () => this.store.club(),
          apply: (raw) => this.store.club.set(raw && this.store.clubs().includes(raw) ? raw : null),
        },
        {
          param: 'coppe',
          read: () => asFlag.read(this.store.withCups()),
          apply: (raw) => this.store.withCups.set(asFlag.apply(raw)),
        },
        {
          param: 'amichevoli',
          read: () => asFlag.read(this.store.withFriendlies()),
          apply: (raw) => this.store.withFriendlies.set(asFlag.apply(raw)),
        },
        {
          param: 'ordine',
          read: () => (this.store.sortBy() === 'played' ? null : this.store.sortBy()),
          apply: (raw) =>
            this.store.sortBy.set(raw === 'name' || raw === 'role' ? raw : 'played'),
        },
      ],
      computed(() => this.store.status() === 'ready'),
    );
  }

  /**
   * The other table, and its data is fetched only when it is asked for.
   *
   * The valuation reads the engine sheet, the boards and the granular roles, and it ranks the whole
   * listone for the stars: that is a real cost, and the page that opens by default does not owe it.
   * `load()` is idempotent, so switching back and forth costs one fetch in a session.
   */
  protected show(mode: PlayersMode): void {
    this.mode.set(mode);
    if (mode === 'ratings') void this.valuation.load();
  }

  /**
   * Filtrare per icona chiede il layer che quelle icone le produce.
   *
   * Infortuni, fragilità e note dichiarate `PlayerStatus` se li carica da solo; il MISTERO no - nasce dal
   * calcolo delle letture, cioè dallo stesso lavoro che la modalità «Valutazioni» fa partire. Senza
   * questa riga il filtro trovava zero misteri e non lo diceva: una funzione che sembra rotta.
   */
  protected chooseFlags(flags: PlayerFlag[]): void {
    this.store.flags.set(flags);
    if (flags.length) void this.valuation.load();
  }

  protected onWindow(value: number[] | number): void {
    if (Array.isArray(value)) this.store.setWindow([value[0], value[1]]);
  }
}
