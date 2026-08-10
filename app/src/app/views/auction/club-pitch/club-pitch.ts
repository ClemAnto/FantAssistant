import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { AuctionAdvice } from '../../../core/auction-advice';
import { AuctionFeed } from '../../../core/auction-feed';
import { BoardMan } from '../../../core/bundle';
import { OnTable, PitchLine, PitchMan, pitchOf } from '../../../core/club-eleven';
import { ClubCrest } from '../../../ui/club-crest/club-crest';
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
 * A real club's board on a pitch, with the men already taken faded out.
 *
 * The board is the TOOLKIT's - the panel's own class, driven headless, with the operator's shape rulings
 * applied (`modules/boards.py`) - so this component computes no eleven of its own. What it adds is the only
 * thing the toolkit cannot know: which of those men are already off THIS table.
 *
 * The drawing is the module's numbers, as the operator stated the rule: each number is how many men stand on
 * that line, the keeper is never one of them and always stands alone in front of the defence, and with four
 * numbers the third is the trequarti and the last is always the attack. The horizontal position is the
 * panel's own `x`, so an empty flank reads as a gap instead of as a tidy row.
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

  protected readonly label = LINE_LABEL;

  /** What the operator picked. Null = follow the recommended pick's club, which is where he is looking. */
  private readonly chosen = signal<string | null>(null);

  protected readonly clubs = computed(() => this.advice.realClubs());

  /**
   * The club on the pitch: his choice, or the club of the man the panel is recommending.
   *
   * Following the recommendation by default is the useful behaviour at the table - «and that club, what else
   * does it have» is the question a suggestion provokes - and it stops being followed the moment he chooses.
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

  /** The live listone by id: what the board cannot know - who is gone, and what he costs here. */
  private readonly live = computed(() => {
    const rows = new Map<number, OnTable>();
    for (const row of this.advice.listone()) {
      rows.set(row.player.id, { taken: row.taken, price: row.player.fvm, onTable: true });
    }
    return rows;
  });

  protected readonly pitch = computed(() => {
    const board = this.advice.boardOf(this.club());
    const live = this.live();
    const resolve = (man: BoardMan): OnTable =>
      (man.fc_id != null ? live.get(man.fc_id) : undefined)
      // A man the board draws and this session's listone does not carry is NOT «free»: he cannot be bought
      // at all, and saying «taken» would be a different claim. `onTable` false is what the row reads.
      ?? { taken: false, price: null, onTable: false };
    return pitchOf(board, resolve);
  });

  /** True when the sheet in use carries no boards at all: then there is nothing honest to draw. */
  protected readonly noBoards = computed(() => this.advice.boards() === null);

  /** How many men of this club are in the session listone, and how many are gone. */
  protected readonly counted = computed(() => {
    const club = this.club();
    const rows = this.advice.listone().filter((row) => row.player.club === club);
    return { total: rows.length, taken: rows.filter((row) => row.taken).length };
  });

  /** A man's tooltip: what he is, how much he plays, and what he costs here. */
  protected hint(man: PitchMan): string {
    const bits = [man.name];
    if (man.taken) bits.push('già preso');
    if (!man.onTable) bits.push('non è nel listone di questa sessione');
    if (man.codes.length) bits.push(`ruolo reale ${man.codes.join(', ')}`);
    if (man.minutes != null) {
      bits.push(man.matches ? `${man.minutes}′ in ${man.matches} partite` : `${man.minutes}′`);
    }
    if (man.minutesPerMatch != null) bits.push(`${man.minutesPerMatch}′ per partita del club`);
    if (man.claim != null) bits.push(`titolarità ${man.claim}`);
    if (man.price != null) bits.push(`FVM ${man.price}`);
    return bits.join(' · ');
  }

  /** The ballottaggi of a man, as one line: «insidiato da X, Y». */
  protected duelHint(man: PitchMan): string | null {
    if (!man.duelsKnown) {
      return 'ballottaggio ignoto: di lui non conosciamo il ruolo reale granulare, quindi non «nessun rivale»';
    }
    if (!man.duels.length) return null;
    return `insidiato da ${man.duels.map((rival) => `${rival.name}`
      + (rival.claim != null ? ` (${rival.claim})` : '')
      + (rival.taken ? ' — già preso' : '')).join(', ')}`;
  }
}
