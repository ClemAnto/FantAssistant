import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzIconModule } from 'ng-zorro-antd/icon';
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
    NzIconModule,
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

  constructor() {
    void this.store.load();
  }

  protected onWindow(value: number[] | number): void {
    if (Array.isArray(value)) this.store.setWindow([value[0], value[1]]);
  }

  /** '6,5' for a fantacalcio vote, '~6,1' for the synthetic one, 's.v.' when he played
   *  without a vote. A cell with no match at all is not this method's business. */
  protected voteText(cell: MatchCell): string {
    if (cell.vote == null) return 's.v.';
    return (cell.voteSynthetic ? '~' : '') + cell.vote.toFixed(1).replace('.', ',');
  }

  protected voteClass(cell: MatchCell): string {
    if (cell.vote == null) return 'text-muted italic';
    if (cell.vote >= 7) return 'text-primary font-semibold';
    if (cell.vote >= 6) return 'text-fg';
    return 'text-muted';
  }

  /** What the cell cannot show: who played whom, how it ended, and for how long he was on. */
  protected tooltip(cell: MatchCell): string {
    const parts = [`Giornata ${cell.matchday}`];

    if (cell.goalsFor != null && cell.goalsAgainst != null && cell.opponent) {
      const [left, right] = cell.home
        ? [`${cell.team} ${cell.goalsFor}`, `${cell.goalsAgainst} ${cell.opponent}`]
        : [`${cell.opponent} ${cell.goalsAgainst}`, `${cell.goalsFor} ${cell.team}`];
      parts.push(`${left} - ${right}`);
    } else if (cell.goalsFor != null && cell.goalsAgainst != null) {
      parts.push(`${cell.team} ${cell.goalsFor} - ${cell.goalsAgainst} (avversario ignoto)`);
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

    if (cell.fantavoto != null) {
      parts.push(`fantavoto ${cell.fantavoto.toFixed(1).replace('.', ',')}`);
    }
    if (cell.voteSynthetic) parts.push('voto sintetico (calibrato), non quello di fantacalcio');

    return parts.join(' · ');
  }
}
