import { Component, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';

import { AuctionFeed } from '../../core/auction-feed';

/**
 * «Collegati a un'asta vera»: the ONE way into a live fanta-asta session, for every auction page.
 *
 * The operator's decision of 03/09/2026 turned the connection from the entrance into an option: both
 * auction pages now OPEN on an invented table with standard settings, and the code is asked for only
 * when he presses the button. So the code field belongs in a modal, and the modal belongs to neither
 * page - two copies of it would eventually validate the code two ways, and the format is the reason
 * the connection works at all (`FA-` plus two base-36 triplets IS the database key).
 *
 * It talks to `AuctionFeed` directly rather than emitting a code upward, because the two things it has
 * to show while connecting - the loading state and WHY a connection failed - are the feed's own and
 * copying them into an input would be a second answer to «are we connected?».
 */
@Component({
  selector: 'ui-live-connect',
  templateUrl: './live-connect.html',
  imports: [FormsModule, NzAlertModule, NzButtonModule, NzInputModule, NzModalModule],
})
export class LiveConnect {
  protected readonly feed = inject(AuctionFeed);

  /** Two-way: the page owns the button, this owns what happens after it. */
  readonly open = model(false);

  protected readonly code = signal('');
  protected readonly busy = signal(false);

  protected async connect(): Promise<void> {
    const code = this.code().trim();
    if (!code) return;
    this.busy.set(true);
    try {
      if (await this.feed.connect(code)) this.open.set(false);
    } finally {
      this.busy.set(false);
    }
  }
}
