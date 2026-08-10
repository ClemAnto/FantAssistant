import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { AuctionAdvice } from '../../../core/auction-advice';
import { AuctionFeed } from '../../../core/auction-feed';
import { ClubMan, byLine, clubEleven } from '../../../core/club-eleven';
import { valuationOf } from '../../../core/auction-value';
import { ClubCrest } from '../../../ui/club-crest/club-crest';
import { RoleBadge } from '../../../ui/role-badge/role-badge';

/**
 * A real club's likely eleven on a pitch, with the men already taken faded out.
 *
 * What it answers at the table: «of this club, who is expected to play, and how much of it has already gone».
 * That second half is why it is HERE and not in the consultation page - the fading is a property of this
 * auction, not of the club.
 *
 * The eleven is the ENGINE's expected-appearances eleven, not the toolkit's board (`core/club-eleven.ts` says
 * why, and the card says so too): the panel's board needs the claim, the coach's repertoire and the operator's
 * rulings, and none of the three travels in the bundle. Labelling it as the board would be the defect this
 * repository keeps paying for.
 */
@Component({
  selector: 'app-club-pitch',
  templateUrl: './club-pitch.html',
  imports: [ClubCrest, DecimalPipe, FormsModule, NzEmptyModule, NzSelectModule, NzTooltipModule, RoleBadge],
  host: { class: 'block' },
})
export class ClubPitch {
  protected readonly advice = inject(AuctionAdvice);
  protected readonly feed = inject(AuctionFeed);

  /** What the operator picked. Null = follow the recommended pick's club, which is where he is looking. */
  private readonly chosen = signal<string | null>(null);

  protected readonly clubs = computed(() => this.advice.realClubs());

  /**
   * The club on the pitch: his choice, or the club of the man the panel is recommending.
   *
   * Following the recommendation by default is the useful behaviour at the table - «and what else does that
   * club have» is the question a suggestion provokes - and it stops being followed the moment he chooses.
   */
  protected readonly club = computed(() => {
    const picked = this.chosen();
    if (picked && this.clubs().includes(picked)) return picked;
    const suggested = this.advice.planned()?.mine?.club;
    if (suggested && this.clubs().includes(suggested)) return suggested;
    return this.clubs()[0] ?? null;
  });

  choose(club: string | null): void {
    this.chosen.set(club);
  }

  /** The club's men, in the shape the pitch needs them. */
  private readonly men = computed<ClubMan[]>(() => {
    const club = this.club();
    if (!club) return [];
    const numbers = this.advice.numbers();
    return this.advice
      .listone()
      .filter((row) => row.player.club === club)
      .map((row) => {
        const valuation = valuationOf(numbers.get(row.player.id));
        return {
          id: row.player.id,
          name: row.player.name,
          roles: row.player.roles.map((role) => role.toLowerCase()),
          pv: valuation.pv,
          price: row.player.fvm,
          taken: row.taken,
        };
      });
  });

  protected readonly eleven = computed(() => clubEleven(this.men(), this.advice.rules()));

  /** The rows a pitch draws, attack at the top and the goal at the bottom. */
  protected readonly lines = computed(() => {
    const drawn = this.eleven();
    return drawn ? byLine(drawn) : [];
  });

  /** How many of this club's men are in the session listone at all, and how many are gone. */
  protected readonly counted = computed(() => {
    const men = this.men();
    return { total: men.length, taken: men.filter((man) => man.taken).length };
  });

  /** Shown once under the pitch: it is a claim about what this drawing IS, so it is not a tooltip. */
  protected readonly caption = computed(() => {
    const drawn = this.eleven();
    if (!drawn) return null;
    const bits = [`modulo ${drawn.module}`];
    if (drawn.filled < drawn.places.length) {
      bits.push(`${drawn.places.length - drawn.filled} posti che il listone non copre`);
    }
    if (drawn.unpriced) bits.push(`${drawn.unpriced} senza presenze previste, quindi non disegnati`);
    return bits.join(' · ');
  });
}
