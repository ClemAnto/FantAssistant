import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSliderModule } from 'ng-zorro-antd/slider';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import {
  CLASSIC_ROLES,
  CellState,
  ClassicRole,
  MatchCell,
  PlayerLine,
  PlayersStore,
} from '../../core/players-store';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { APP_VERSION } from '../../version';
import { MatchDetail } from './match-detail/match-detail';

/** A cell with no vote is not blank: it says WHY. One icon per reason, and never red - an
 *  injury is a fact about a player, not a failure. */
export const STATE_ICON: Record<CellState, string> = {
  played: '',
  no_data: '',
  no_vote: 'question-circle',
  bench: 'pause-circle',
  injured: 'medicine-box',
  not_in_league: 'global',
  absent: 'minus-circle',
};

export const STATE_LABEL: Record<CellState, string> = {
  played: 'Ha giocato',
  no_data: 'Risulta giocata, nessun dato oltre alla distinta',
  no_vote: 'In campo, senza voto',
  bench: 'In panchina, non entrato',
  injured: 'Infortunato',
  not_in_league: 'Non in questo campionato',
  absent: 'Non risulta in distinta',
};

/** dd/mm/yyyy, because a date in a tooltip is read by a person and not by a parser. */
const it = (iso: string): string => iso.split('-').reverse().join('/');

/** One symbol per kind of match, used BOTH in the column header and in the cell: two marks for
 *  the same thing would be two vocabularies. `national` has no icon in use - no national-team
 *  competition exists in the per-match layer, measured - but it is mapped so that the day one
 *  arrives it is named rather than filed under "cup". */
export const KIND_ICON: Record<string, string> = {
  league: 'calendar',
  cup: 'trophy',
  friendly: 'coffee',
  national: 'flag',
};

export const KIND_LABEL: Record<string, string> = {
  league: 'Campionato',
  cup: 'Coppa o altra competizione',
  friendly: 'Amichevole',
  national: 'Nazionale',
};

const ROLE_LABEL: Record<ClassicRole, string> = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

@Component({
  selector: 'app-players',
  imports: [
    FormsModule,
    NzAlertModule,
    NzCheckboxModule,
    NzCollapseModule,
    NzIconModule,
    NzModalModule,
    NzRadioModule,
    NzSelectModule,
    NzSliderModule,
    NzSpinModule,
    NzTableModule,
    NzTooltipModule,
    ClubCrest,
    RoleBadge,
    MatchDetail,
  ],
  templateUrl: './players.html',
  host: { class: 'view-host' },
})
export class Players {
  protected readonly store = inject(PlayersStore);
  protected readonly appVersion = APP_VERSION;
  protected readonly roles = CLASSIC_ROLES;
  protected readonly roleLabel = ROLE_LABEL;

  protected readonly window = computed<[number, number]>(() => [
    this.store.windowFrom(),
    this.store.windowTo(),
  ]);

  /** In the mixed view a column is a WEEK shared by every row - its label is the matchday
   *  played in it, or the date when no league round falls there. */
  protected readonly headers = computed(() => this.store.columns());

  /** The match the detail panel is showing, with the player it belongs to: a cell alone does
   *  not know whose it is, and the panel names him. */
  protected readonly selected = signal<{ cell: MatchCell; player: PlayerLine } | null>(null);

  /** The filter bar takes a fifth of the screen and is set once per session: it collapses, and
   *  when closed its header says what is applied, so a folded filter can never be a hidden one. */
  protected readonly filtersOpen = signal(true);

  protected readonly filterSummary = computed(() => {
    const parts: string[] = [
      this.store.platform() === 'euro' ? 'EuroLeghe' : 'Serie A',
      this.store.season(),
    ];
    const role = this.store.role();
    if (role) parts.push(ROLE_LABEL[role]);
    const club = this.store.club();
    if (club) parts.push(club);
    if (this.store.withCups()) parts.push('coppe');
    if (this.store.withFriendlies()) parts.push('amichevoli');
    if (this.store.byMatchday()) {
      parts.push(`giornate ${this.store.windowFrom()}-${this.store.windowTo()}`);
    }
    return parts.join(' · ');
  });

  /** Which cell the pointer is on. The tooltip is driven from here instead of by hover alone,
   *  so a CLICK can close it: otherwise it stays up over the panel it just opened. */
  protected readonly hovered = signal<string | null>(null);

  constructor() {
    void this.store.load();
  }

  protected open(cell: MatchCell, player: PlayerLine): void {
    this.hovered.set(null);
    this.selected.set({ cell, player });
  }

  protected readonly mantraCodes = (line: PlayerLine): string[] =>
    line.mantra.split(/\s+/).filter(Boolean);

  protected onWindow(value: number[] | number): void {
    if (Array.isArray(value)) this.store.setWindow([value[0], value[1]]);
  }

  /** The number in the cell, and it is NOT the same quantity in every cell:
   *  a league match carries the fantacalcio vote (or the calibrated synthetic one, marked
   *  `~`), while a cup or a friendly can only carry the provider's own 1-10 rating, marked
   *  `*` because it is a different scale. A dot means he has a row and nothing measurable. */
  protected readonly kindIcon = KIND_ICON;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly stateIcon = STATE_ICON;
  protected readonly stateLabel = STATE_LABEL;

  /** True when the cell has no number at all and is drawn as an icon only. */
  protected iconOnly(cell: MatchCell): boolean {
    // `no_data` keeps the dot: there is no reason to draw, only an absence of measurement.
    return (
      cell.state !== 'played' &&
      cell.state !== 'no_data' &&
      cell.vote == null &&
      cell.providerRating == null
    );
  }

  protected stateClass(cell: MatchCell): string {
    return cell.state === 'injured' ? 'text-warning' : 'text-muted';
  }

  protected voteText(cell: MatchCell): string {
    if (cell.kind === 'league') {
      if (cell.vote == null) return 's.v.';
      return (cell.voteSynthetic ? '~' : '') + cell.vote.toFixed(1).replace('.', ',');
    }
    if (cell.providerRating == null) return '·';
    return '*' + cell.providerRating.toFixed(1).replace('.', ',');
  }

  protected voteClass(cell: MatchCell): string {
    // The bands are calibrated on the fantacalcio vote. A provider rating is another scale,
    // so colouring it the same way would be a claim nobody measured: it stays neutral.
    if (cell.kind !== 'league') return 'text-muted';
    if (cell.vote == null) return 'text-muted italic';
    if (cell.vote >= 7) return 'text-primary font-semibold';
    if (cell.vote >= 6) return 'text-fg';
    return 'text-muted';
  }

  protected tooltip(cell: MatchCell): string {
    const parts: string[] = [];

    if (cell.state !== 'played') {
      parts.push(STATE_LABEL[cell.state]);
      if (cell.state === 'injured' && cell.injury) {
        const detail = cell.injury.detail ? `${cell.injury.detail}, ` : '';
        parts.push(`${detail}dal ${it(cell.injury.from)}${cell.injury.to ? ' al ' + it(cell.injury.to) : ''}`);
      }
    }

    if (cell.kind === 'league') {
      parts.push(`${cell.competitionLabel}, giornata ${cell.matchday}`);
    } else {
      parts.push(cell.competitionLabel);
    }
    if (cell.date) parts.push(cell.date.split('-').reverse().join('/'));

    if (cell.goalsFor != null && cell.goalsAgainst != null && cell.opponent) {
      const [left, right] = cell.home
        ? [`${cell.team} ${cell.goalsFor}`, `${cell.goalsAgainst} ${cell.opponent}`]
        : [`${cell.opponent} ${cell.goalsAgainst}`, `${cell.goalsFor} ${cell.team}`];
      parts.push(`${left} - ${right}`);
    } else if (cell.opponent) {
      parts.push(cell.home === false ? `${cell.opponent} - ${cell.team}` : `${cell.team} - ${cell.opponent}`);
      if (cell.kind !== 'league') parts.push('risultato non disponibile');
    } else {
      parts.push(cell.team);
    }

    if (cell.state === 'played' || cell.state === 'no_vote' || cell.state === 'bench') {
      parts.push(cell.home == null ? 'campo ignoto' : cell.home ? 'in casa' : 'in trasferta');
      parts.push(cell.minutes == null ? 'minuti ignoti' : `${cell.minutes}'`);
    }

    const events: string[] = [];
    if (cell.goals) events.push(`${cell.goals} gol`);
    if (cell.penScored) events.push(`${cell.penScored} rig. segnati`);
    if (cell.penMissed) events.push(`${cell.penMissed} rig. sbagliati`);
    if (cell.assists) events.push(`${cell.assists} assist`);
    if (cell.ownGoals) events.push(`${cell.ownGoals} autogol`);
    if (cell.yellows) events.push('ammonito');
    if (cell.reds) events.push('espulso');
    if (events.length) parts.push(events.join(', '));

    if (cell.kind === 'league') {
      if (cell.fantavoto != null) {
        parts.push(`fantavoto ${cell.fantavoto.toFixed(1).replace('.', ',')}`);
      }
      if (cell.voteSynthetic) parts.push('voto sintetico calibrato, non quello di fantacalcio');
    }
    if (cell.alsoInWeek) {
      parts.push(`+${cell.alsoInWeek} altra partita nella stessa settimana`);
    } else if (cell.providerRating != null) {
      parts.push(`* voto Sofascore ${cell.providerRating.toFixed(1).replace('.', ',')} - scala diversa dal voto di fantacalcio`);
    } else {
      parts.push('nessun voto ne\' minuti: di questa partita sappiamo solo che risulta giocata');
    }

    return parts.join(' · ');
  }
}
