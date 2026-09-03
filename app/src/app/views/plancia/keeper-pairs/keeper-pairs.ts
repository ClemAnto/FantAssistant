import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { PlanciaStore } from '../../../core/plancia-store';
import { KeeperGrid } from '../keeper-grid/keeper-grid';

/** How many the operator asked to be shown. His number, not a cut chosen here. */
export const TOP_PAIRS = 3;

/**
 * GLI ACCOPPIAMENTI DI UN PORTIERE: con chi va comprato, e su quante giornate i due si coprono.
 *
 * Una rosa schiera UN portiere, quindi il secondo non e' profondita' come lo e' un quarto
 * centrocampista: e' l'uomo che gioca nelle giornate in cui il primo e' una scommessa. Per questo la
 * pagina li giudica in COPPIA e non uno alla volta - la stessa aritmetica per cui `plancia.ts` rifiuta
 * di sommare i due portieri dello slot sotto: fra loro sono alternative, con lui sono una coppia.
 *
 * IL CONTO E' SUO E LO SPAREGGIO E' MISURATO, e i due numeri non si mescolano mai in una cifra sola.
 * «FACILI» e' la sua regola alla lettera: la giornata conta se almeno uno dei due ha una partita che
 * supera il margine congelato. Sul calendario 2026-27 quella regola pero' legge ZERO per dodici club di
 * venti, quindi quasi tutte le coppie pareggiano a zero: «coperte» - le giornate attese con almeno una
 * porta inviolata - e' la stessa frase con la probabilita' al posto della monetina, e ordina dentro il
 * pareggio. La modale dice quale dei due sta decidendo.
 */
@Component({
  selector: 'plancia-keeper-pairs',
  templateUrl: './keeper-pairs.html',
  imports: [DecimalPipe, NzButtonModule, NzIconModule, NzModalModule, NzTooltipModule, KeeperGrid],
})
export class KeeperPairs {
  protected readonly store = inject(PlanciaStore);

  protected readonly gridOpen = signal(false);

  protected readonly man = computed(() => this.store.pairingMan());
  protected readonly window = computed(() => this.store.pairingWindow());

  protected readonly result = computed(() => this.store.keeperPairs());

  /** The three he asked for, and the rest below them: one list, cut once, so nothing is computed twice. */
  protected readonly best = computed(() => this.result().suggestions.slice(0, TOP_PAIRS));
  protected readonly rest = computed(() => this.result().suggestions.slice(TOP_PAIRS));

  /**
   * Whether the count alone is deciding anything, and it usually is not.
   *
   * The screen must not present a tie-break as if it were the operator's rule: when the three best
   * share one count, what ordered them is the expectation, and the note says so instead of leaving him
   * to infer it from three identical numbers.
   */
  protected readonly tiedAtTop = computed(() => {
    const top = this.best();
    return top.length > 1 && top.every((one) => one.cover.facili === top[0].cover.facili);
  });

  /** No calendar in the bundle is a state to SAY, never an empty list that reads as «no good pair». */
  protected readonly noCalendar = computed(() => this.store.calendar() == null);

  /** The calendar knows the club but the championship has no fitted probability: no tie-break there. */
  protected readonly noTieBreak = computed(() => {
    const club = this.man()?.club;
    const calendar = club ? this.store.calendar()?.forClub(club) : null;
    return calendar != null && !calendar.cleanSheetFitted;
  });

  protected readonly unknownClub = computed(() => {
    const club = this.man()?.club;
    return club != null && this.store.calendar() != null && !this.store.calendar()!.leagueOf(club);
  });

  protected close(): void {
    this.gridOpen.set(false);
    this.store.openPairs(null);
  }
}
