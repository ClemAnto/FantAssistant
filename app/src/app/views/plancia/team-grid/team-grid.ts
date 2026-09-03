import { Component, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ROLES, Role } from '../../../core/plancia';
import { BoardTeam } from '../../../core/plancia-store';

/**
 * THE TEN PARTICIPANTS, as a column of cards beside the board.
 *
 * A column and not a strip along the bottom, because the board needs its height for 250 rows and this
 * needs to be read at every extraction: three states the card has to say without a word - RIVAL on this
 * lot (a free place in the role AND the credits to reach the band), not interested, out of it.
 *
 * The one that carries a number is the first: how many rosters still want that role is what decides the
 * second price (§23.1) and what the adopted timing rule reads (§24), and at a free extraction it changes
 * with every name drawn - so it has to be readable without counting by hand.
 *
 * «Out» is not painted red. It is an absence and not a danger, which is the house rule about colour; red
 * on this page means «this costs you points» and it is spent on one verdict only.
 */
@Component({
  selector: 'plancia-team-grid',
  templateUrl: './team-grid.html',
  imports: [NzIconModule, NzTooltipModule],
  host: { class: 'block min-h-0' },
})
export class TeamGrid {
  readonly teams = input.required<BoardTeam[]>();
  /** The role of the lot on the table: the only one of the four numbers that lights up. */
  readonly role = input<Role | null>(null);

  protected readonly roles = ROLES;

  protected sigla(team: BoardTeam): string {
    const words = team.label.trim().split(/\s+/);
    const letters = words.length > 1 ? words.map((word) => word[0]).join('') : (words[0] ?? '');
    return letters.slice(0, 3).toUpperCase();
  }

  protected cardTone(team: BoardTeam): string {
    if (team.me) return 'border-primary bg-primary/15';
    if (team.rival) return 'border-primary/40 bg-control';
    if (team.out) return 'border-border opacity-40';
    return 'border-border opacity-70';
  }

  /** The lot's role lights up on the cards that can still take it, and nowhere else. */
  protected slotTone(team: BoardTeam, role: Role, missing: number): string {
    if (role === this.role() && missing > 0 && !team.out) return 'bg-success/20 text-success';
    return missing === 0 ? 'text-muted/50' : 'text-fg';
  }

  protected tip(team: BoardTeam): string {
    const role = this.role();
    const purse = `${team.credits} crediti · posti ${team.missing.join('·')} (P·D·C·A)`;
    if (team.me) return `La tua rosa — ${purse}.`;
    if (team.out) return `${team.label} non arriva alla banda — ${purse}.`;
    if (team.rival && role) {
      return `${team.label} è un rivale su questo lotto: ha ancora un posto in ${role} e i crediti per pagarlo — ${purse}.`;
    }
    if (role)
      return `${team.label} ha il reparto ${role} completo: non rilancia su questo lotto — ${purse}.`;
    return `${team.label} — ${purse}.`;
  }
}
