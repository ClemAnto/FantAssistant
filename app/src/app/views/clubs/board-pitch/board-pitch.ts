import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Board, BoardMan } from '../../../core/bundle';
import { OnTable, PitchLine, PitchMan, pitchOf } from '../../../core/club-eleven';
import { PlayerFlags } from '../../../ui/player-flags/player-flags';
import { RoleBadge } from '../../../ui/role-badge/role-badge';

/** What each drawn line is called, in the language of the pitch. */
const LINE_LABEL: Record<PitchLine, string> = {
  A: 'attacco',
  T: 'trequarti',
  M: 'centrocampo',
  D: 'difesa',
  P: 'porta',
};

/**
 * Outside an auction there is no table, so nothing is taken and nothing has a price.
 *
 * `OnTable` exists for the auction pitch, which fades the men already gone and prints what they cost
 * here. This view answers a different question - «what does this club have» - and draws none of those
 * fields, so the neutral answer is the honest one rather than an invented number.
 */
const NO_TABLE: OnTable = { taken: false, price: null, onTable: true, value99: null };

/**
 * The eleven the TOOLKIT draws for a real club, on a pitch.
 *
 * It reads `pitchOf` - the same reading the auction panel's own pitch uses, and the same board written by
 * `modules/boards.py` - so there is one definition of a club's eleven in this app and not two. What differs
 * is only what a chip carries: the auction one prices a man at this table, this one describes him.
 *
 * The drawing is the module's numbers, with the KEEPER AT THE TOP and the forwards at the bottom (the
 * operator's own direction), the men ordered across by the panel's own `x` so a flank stays a flank.
 */
@Component({
  selector: 'app-board-pitch',
  templateUrl: './board-pitch.html',
  imports: [DecimalPipe, NzEmptyModule, NzTooltipModule, PlayerFlags, RoleBadge],
  host: { class: 'block' },
})
export class BoardPitch {
  readonly board = input.required<Board | null>();
  /** True when the platform's sheets carry no boards at all - a different sentence from «not this club». */
  readonly noBoards = input(false);

  protected readonly label = LINE_LABEL;

  protected readonly pitch = computed(() => pitchOf(this.board(), (_man: BoardMan) => NO_TABLE));

  /** A man's tooltip: what he is, and how much he plays. */
  protected hint(man: PitchMan): string {
    const bits = [man.name];
    if (man.badge) bits.push(`nel modulo ${man.badge}`);
    if (man.mantra.length) bits.push(`listone ${man.mantra.join('/')}`);
    if (man.codes.length) bits.push(`ruolo reale ${man.codes.join(', ')}`);
    if (man.perMatch != null) bits.push(`${man.perMatch}′ medi a partita`);
    if (man.minutes != null) {
      bits.push(man.matches ? `${man.minutes}′ in ${man.matches} partite giocate` : `${man.minutes}′`);
    }
    // The other denominator, named: this one divides by the CLUB's matches over the last ten, so it folds
    // absences in and is a smaller number for the same man. Two averages with one label would be a trap.
    if (man.minutesPerClubMatch != null) {
      bits.push(`${man.minutesPerClubMatch}′ per partita del club nelle ultime dieci`);
    }
    if (man.claim != null) bits.push(`titolarità ${man.claim}`);
    return bits.join(' · ');
  }

  /** The ballottaggi of a man, as one line: «insidiato da X, Y». */
  protected duelHint(man: PitchMan): string | null {
    if (!man.duelsKnown) {
      return 'ballottaggio ignoto: di lui non conosciamo il ruolo reale granulare, quindi non «nessun rivale»';
    }
    if (!man.duels.length) return null;
    return `insidiato da ${man.duels
      .map((rival) => rival.name + (rival.claim != null ? ` (${rival.claim})` : ''))
      .join(', ')}`;
  }
}
