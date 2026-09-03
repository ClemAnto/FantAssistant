import { DecimalPipe } from '@angular/common';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { Component, computed, inject } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { EDGE_BASE } from '../../../core/plancia';
import { BoardMan, PlanciaStore } from '../../../core/plancia-store';
import { PlayerStatus } from '../../../core/player-status';
import { PlayerFlags } from '../../../ui/player-flags/player-flags';

/**
 * LA CARD DI UN CALCIATORE: si apre col click su un nome della plancia, si trascina, si chiude.
 *
 * Richiesta dell'operatore (04/09/2026): «quando clicco su un calciatore nella plancia si deve aprire
 * una card compatta draggabile e chiudibile con le info principali del calciatore e le sue statistiche
 * essenziali. Se è un portiere aggiungi un tastino "abbinamenti"».
 *
 * TRE COSE CHE QUESTA CARD NON FA, e sono la ragione per cui è una card e non un pannello.
 *
 * NON RICALCOLA NIENTE. Ogni numero qui viene dal foglio del motore attraverso l'unico lettore che
 * questo progetto ha (`engine-sheet.ts` -> `PlanciaStore`), e i due che non sono sul foglio - la max
 * offerta e la banda - vengono dalla stessa funzione che li disegna sulla plancia. Tre viste sugli
 * stessi `engine_*` con tre letture darebbero a un uomo tre valutazioni, che è il difetto che questo
 * repository ha già pagato.
 *
 * NON DECIDE AL POSTO SUO. Il click apre la card e nient'altro: nominare il LOTTO è un bottone, e
 * resta un gesto separato per l'istruzione del 03/09 («cliccare non deve mettere il calciatore in
 * asta»). Per un portiere il bottone in più è «abbinamenti», che apre la modale che già esiste.
 *
 * NON SI TRASCINA DA SÉ: `cdkDrag` con `cdkDragHandle` sull'intestazione, perché una card che si
 * sposta afferrandola in mezzo a un numero è una card in cui non si può selezionare un numero. Il
 * gesto è di CDK, che questo progetto ha già scelto e misurato per il riordino delle liste (27/08) -
 * dipendenza dichiarata, non aggiunta.
 */
@Component({
  selector: 'plancia-man-card',
  templateUrl: './man-card.html',
  imports: [CdkDrag, CdkDragHandle, DecimalPipe, NzIconModule, NzTooltipModule, PlayerFlags],
})
export class ManCard {
  private readonly store = inject(PlanciaStore);
  private readonly status = inject(PlayerStatus);

  /** Chiudere è dello store, che è l'unico a sapere chi è aperto: due stati per una card sono due card. */
  protected close(): void {
    this.store.openCard(null);
  }

  protected readonly man = computed(() => this.store.cardMan());

  /** Il gradino, la banda e i minuti: le tre frasi che un'asta chiede di un nome. */
  protected readonly numbers = computed(() => {
    const man = this.man();
    return man ? this.store.numbersFor(man.id) : null;
  });

  /** Cosa dice oggi la stampa (o un infortunio aperto): la ragione, non solo il fatto. */
  protected readonly outNote = computed(() => {
    const man = this.man();
    return man ? (this.status.unavailableNow(man.id)?.note ?? null) : null;
  });

  /**
   * FUORI ROSA: la nota DICHIARATA dall'operatore, letta dal servizio e non da un campo della riga.
   *
   * `BoardMan` non ha quel campo - la plancia non lo porta - e io avevo scritto il template contro un
   * campo ricordato invece che letto: «verifica la FUNZIONE, non la colonna che le somiglia», in casa
   * mia. Il servizio è lo stesso che disegna le icone, quindi la card e la riga non possono dire due
   * cose diverse sullo stesso uomo.
   */
  protected readonly outOfSquad = computed(() => {
    const man = this.man();
    return man ? this.status.declared().get(man.id)?.kind === 'out_of_squad' : false;
  });

  protected readonly base = EDGE_BASE;

  /** `A1`, `P3`: lo slot come lo legge la plancia, dal blocco in cui l'uomo sta. */
  protected readonly slotLabel = computed(() => {
    const man = this.man();
    if (!man) return '';
    const block = this.store.blocks().find((one) => one.rows.some((row) => row.id === man.id));
    return block ? String(block.index) : '';
  });

  /** Le giornate del calendario su cui `pv` è espresso: dal FOGLIO, mai un 38 scritto a mano. */
  protected readonly rounds = computed(() => this.store.sheet()?.matchdays_target ?? null);

  /**
   * La fantamedia da mostrare, e la card NON scegle fra le due: `basis` lo ha già deciso a monte
   * (`valuationOf`), quindi qui si legge quella che la riga sta usando - o la card direbbe un numero
   * e la riga un altro.
   */
  protected readonly fm = computed(() => {
    const man = this.man();
    const engine = this.numbers();
    if (!man || !engine) return null;
    return man.basis === 'estimated' ? engine.estFm : engine.fm;
  });

  /** Il lotto e gli abbinamenti restano DUE gesti, e questa card non ne inventa un terzo. */
  protected nameLot(man: BoardMan): void {
    this.store.setLot(man.id);
    this.close();
  }

  protected pairs(man: BoardMan): void {
    this.store.openPairs(man.id);
  }
}
