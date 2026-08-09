import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSliderModule } from 'ng-zorro-antd/slider';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { CLASSIC_ROLES, ClassicRole, MatchCell, PlayersStore } from '../../core/players-store';

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
    NzIconModule,
    NzRadioModule,
    NzSelectModule,
    NzSliderModule,
    NzSpinModule,
    NzTableModule,
    NzTooltipModule,
  ],
  templateUrl: './players.html',
  host: { class: 'view-host' },
})
export class Players {
  protected readonly store = inject(PlayersStore);
  protected readonly roles = CLASSIC_ROLES;
  protected readonly roleLabel = ROLE_LABEL;

  protected readonly window = computed<[number, number]>(() => [
    this.store.windowFrom(),
    this.store.windowTo(),
  ]);

  /** In "last matches" mode a column is a position, not a matchday: 10 = ten matches ago,
   *  1 = the most recent, so the row still reads left to right in time. */
  protected readonly headers = computed(() =>
    this.store.byMatchday()
      ? this.store.matchdays().map(String)
      : Array.from({ length: 10 }, (_, i) => String(10 - i)),
  );

  constructor() {
    void this.store.load();
  }

  protected onWindow(value: number[] | number): void {
    if (Array.isArray(value)) this.store.setWindow([value[0], value[1]]);
  }

  /** The number in the cell, and it is NOT the same quantity in every cell:
   *  a league match carries the fantacalcio vote (or the calibrated synthetic one, marked
   *  `~`), while a cup or a friendly can only carry the provider's own 1-10 rating, marked
   *  `*` because it is a different scale. A dot means he has a row and nothing measurable. */
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

    parts.push(cell.home == null ? 'campo ignoto' : cell.home ? 'in casa' : 'in trasferta');
    parts.push(cell.minutes == null ? 'minuti ignoti' : `${cell.minutes}'`);

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
    } else if (cell.providerRating != null) {
      parts.push(`* voto Sofascore ${cell.providerRating.toFixed(1).replace('.', ',')} - scala diversa dal voto di fantacalcio`);
    } else {
      parts.push('nessun voto ne\' minuti: di questa partita sappiamo solo che risulta giocata');
    }

    return parts.join(' · ');
  }
}
