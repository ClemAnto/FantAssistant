import { Component, computed, inject, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { FLAG_LABEL, PlayerFlag, PlayerMark, PlayerStatus } from '../../core/player-status';
import { short } from '../../core/tooltip';

/**
 * One icon per state, and the injury keeps the icon the consultation table already uses for it: a mark is a
 * vocabulary, so the same fact must not have two symbols in one app.
 */
const ICON: Record<PlayerFlag, string> = {
  long_injury: 'medicine-box',
  back_from_long: 'medicine-box',
  // A cracked thing: he breaks, and it is about a HABIT and not about today - so not the medicine box,
  // which this app already spends on «is he out?».
  fragile: 'alert',
  // Invisibile: c'era, stava bene, e non si è visto.
  mystery: 'eye-invisible',
  // Un cartellino solo per due marchi, e il COLORE dice quale: stessa cosa vista a due intensità, come
  // già fanno l'infortunio in corso e il rientro.
  yellows: 'stop',
  reds: 'stop',
  // Un gol che va all'indietro.
  own_goals: 'rollback',
  // Il dischetto: chi lo sbaglia, chi lo para, chi lo batte. Tre facce di una cosa sola.
  penalty_risk: 'close-circle',
  penalty_saved: 'check-circle',
  set_pieces: 'aim',
  // Uno SCUDO: quello che protegge non è lui, è la squadra davanti a lui - ed è il motivo per cui non
  // è un guanto né una porta.
  clean_sheets: 'safety',
  dispute: 'disconnect',
  promise: 'rise',
  flop_risk: 'fall',
  // A place gained or lost is a fact about the PAST and about a shirt, so it must not borrow the two
  // arrows the screens use for a projection: those say «he might», these say «he did».
  place_gained: 'login',
  place_lost: 'logout',
  // A half-filled clock: he is on the pitch and only for part of it, which is exactly what the mark says.
  rotation_risk: 'clock-circle',
  // The same icon at half strength: same fact, a window too short to say it as loudly.
  rotation_early: 'clock-circle',
  // The mirror: he is taking off, and it is the one piece of GOOD news among the marks.
  starter_signs: 'rocket',
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
  // Amber, like the injuries it is made of: a warning about what you are buying, never a verdict on him.
  fragile: 'text-warning',
  // Una DESCRIZIONE e non un verdetto: niente rosso, niente ambra, come i due screen.
  mystery: 'opacity-70',
  // Il giallo non è un grosso problema (l'operatore, 15/08/2026): ambra sfumata. Il ROSSO sì - vale −1
  // più il voto rovinato - ed è l'uso del rosso che la regola dei colori consente: un verdetto
  // esplicitamente negativo.
  yellows: 'text-warning opacity-70',
  reds: 'text-danger',
  own_goals: 'text-warning',
  penalty_risk: 'text-warning',
  // Le due buone notizie: verde, come l'unico altro marchio che è una buona notizia.
  penalty_saved: 'text-success',
  set_pieces: 'text-success',
  // Buona notizia per chi lo compra, e sfumata perché il merito NON è suo: il colore dice «conta»,
  // l'opacità dice «non è farina del suo sacco», e il tooltip lo scrive.
  clean_sheets: 'text-success opacity-70',
  dispute: 'text-warning',
  // The two screens are a READING and not a fact about the man, so they stay neutral: this app paints
  // red for danger and amber for a warning, and a projection is neither. Their own tooltip carries the
  // measured lift, which is what makes them worth looking at rather than believing.
  promise: 'opacity-70',
  flop_risk: 'opacity-70',
  // Measured facts about last season, and neither is good or bad news on its own: a place won while
  // the starter was hurt is not a promotion, and the tooltip is where that lives. So: neutral.
  place_gained: 'opacity-70',
  place_lost: 'opacity-70',
  // Amber: this one IS a warning about what you are buying, and it is measured (90.4% precision).
  rotation_risk: 'text-warning',
  rotation_early: 'text-warning opacity-50',
  // Green confirms, and this is the only mark that is good news for the man carrying it.
  starter_signs: 'text-success',
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
    return short(
      `${FLAG_LABEL[mark.flag]} — ${mark.note}`
        + (read ? ` · letto il ${read.slice(0, 10).split('-').reverse().join('/')}` : ''),
    );
  }
}
