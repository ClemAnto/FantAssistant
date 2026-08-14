import { Component, computed, inject, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { PlayerFlag, PlayerMark, PlayerStatus } from '../../core/player-status';

/**
 * One icon per state, and the injury keeps the icon the consultation table already uses for it: a mark is a
 * vocabulary, so the same fact must not have two symbols in one app.
 */
const ICON: Record<PlayerFlag, string> = {
  long_injury: 'medicine-box',
  back_from_long: 'medicine-box',
  dispute: 'disconnect',
};

/**
 * How each one is painted, and the difference IS the message (the operator's own, 11/08/2026): the man who is
 * out reads at full strength, the man who is back reads at half - same icon, so «he has been through it» is
 * the same fact seen from after. Amber and not red: an injury is a fact about a player, never a failure, and
 * this app keeps red for danger.
 */
const TONE: Record<PlayerFlag, string> = {
  long_injury: 'text-warning',
  back_from_long: 'text-warning opacity-50',
  dispute: 'text-warning',
};

const LABEL: Record<PlayerFlag, string> = {
  long_injury: 'Infortunio lungo in corso',
  back_from_long: 'Rientrato da poco da un infortunio lungo',
  dispute: 'Fuori rosa / rottura con la società',
};

/**
 * The marks a name carries, drawn wherever a player is listed.
 *
 * One component and one service (`PlayerStatus`), so the suggestion list, the pitches and the squad cards can
 * never disagree about whether a man is injured - the defect this project has already paid for is a displayed
 * list whose figures describe a different list.
 */
@Component({
  selector: 'ui-flags',
  templateUrl: './player-flags.html',
  imports: [NzIconModule, NzTooltipModule],
  host: { class: 'inline-flex shrink-0 items-center gap-1' },
})
export class PlayerFlags {
  private readonly status = inject(PlayerStatus);

  readonly playerId = input.required<number | null | undefined>();

  protected readonly icon = ICON;
  protected readonly tone = TONE;

  protected readonly marks = computed(() => this.status.marksFor(this.playerId()));

  /** The state, what it is, and WHEN it was read: an open spell in an old bundle may have closed since. */
  protected hint(mark: PlayerMark): string {
    const read = this.status.readAt();
    return `${LABEL[mark.flag]} — ${mark.note}`
      + (read ? ` · dati letti il ${read.slice(0, 10).split('-').reverse().join('/')}` : '');
  }
}
