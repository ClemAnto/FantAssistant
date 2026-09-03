import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { AuctionFeed } from '../../core/auction-feed';
import { ROLES } from '../../core/plancia';
import { BoardMan, PlanciaStore } from '../../core/plancia-store';
import { LiveConnect } from '../../ui/live-connect/live-connect';
import { APP_VERSION } from '../../version';
import { LotCard } from './lot-card/lot-card';
import { SlotMatrix } from './slot-matrix/slot-matrix';
import { TeamGrid } from './team-grid/team-grid';

/**
 * `/plancia` - the assistant of a RANDOM-EXTRACTION raise auction.
 *
 * The page opens on an invented table with the standard league settings and connects to a real session
 * only when the operator presses the button (his decision of 03/09/2026, which holds for `/auction`
 * too). Three zones and a fixed regulation bar, laid out the way he asked on the same day: the LOT is a
 * ROW under the header, the ten participants are a COLUMN of cards on the right, and everything else is
 * the board - which needs the room, because all 250 rows are on screen at once. The page itself does
 * NOT scroll.
 *
 * The mechanic is FREE extraction over the whole listone - one name at a time, any role at any moment -
 * which is the operator's own auction. It is not the departmental order the bench models
 * (`bench.PHASES`, adopted from 16 of the 20 real auctions with this configuration), and the difference
 * is stated rather than smoothed over: what the board reads - the ladder, the thinning discount, the
 * timing band - is indexed on how many rosters still want a role and not on the order, so it carries
 * over; what does not carry over is any expectation about WHICH role comes next.
 */
@Component({
  selector: 'app-plancia',
  templateUrl: './plancia.html',
  imports: [
    FormsModule,
    RouterLink,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzInputNumberModule,
    NzTooltipModule,
    LiveConnect,
    LotCard,
    SlotMatrix,
    TeamGrid,
  ],
})
export class Plancia {
  protected readonly store = inject(PlanciaStore);
  protected readonly feed = inject(AuctionFeed);

  protected readonly appVersion = APP_VERSION;
  protected readonly roles = ROLES;
  protected readonly connecting = signal(false);

  /** The regulation, always on screen: it is what decides every number under it. */
  protected readonly rules = computed(() => {
    const slots = this.store.slots();
    return {
      sheet: this.store.sheet(),
      teams: this.store.teamsCount(),
      budget: this.store.budget(),
      roster: ROLES.map((role) => slots[role]).join('·'),
    };
  });

  protected readonly myMissing = computed(
    () => this.store.teams().find((team) => team.me)?.missing ?? [],
  );

  protected readonly room = computed(() => this.store.me()?.budgetLeft ?? this.store.budget());

  protected readonly urnLeft = computed(() =>
    this.store.blocks().reduce((sum, block) => sum + block.left, 0),
  );

  constructor() {
    // The board opens on a table, never on a code field: `startDemo` is a no-op when one is already up,
    // so coming back to the page does not throw away an auction in progress.
    void this.store.startDemo();
  }

  protected onPick(man: BoardMan): void {
    this.store.setLot(man.id);
  }
}
