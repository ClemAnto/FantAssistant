import { DecimalPipe } from '@angular/common';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { Component, computed, inject, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { outWindowNote } from '../../../core/injury-window';
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

  /**
   * L'uomo di QUESTA card, passato dalla pagina: le card aperte sono più di una.
   *
   * L'uomo arriva come input e non si legge dallo store perché è la pagina che sa quante card ci
   * sono - lo store tiene gli ID e la riga viva, il componente disegna quella che gli è data. Così
   * ogni card resta agganciata al proprio uomo mentre la mappa si ricostruisce sotto.
   */
  readonly man = input.required<BoardMan>();

  /**
   * IL SUO POSTO, assegnato dallo store alla nascita e tenuto per tutta la vita della card.
   *
   * Non è l'indice nell'elenco: con l'indice, chiudere una card faceva scalare tutte le successive
   * («quando chiudo una card le altre non si devono spostare»), e una card che si sposta da sé mentre
   * la guardi rompe il confronto per cui è aperta.
   */
  readonly at = input<number>(0);

  /** Chiudere è dello store, che è l'unico a sapere chi è aperto. */
  protected close(): void {
    this.store.closeCard(this.man().id);
  }

  /**
   * DOVE NASCE QUESTA CARD: AFFIANCATE, non a cascata.
   *
   * Le card servono a CONFRONTARE (sua richiesta), e due card sfalsate di 28px si coprono per il 90%:
   * per confrontare devono stare una accanto all'altra. Quindi quattro per riga a 300px di passo (288
   * di card piu' 12 di aria), poi si scende di 44px e si ricomincia - una griglia a cascata e non una
   * pila. Il ciclo invece di un TETTO al numero: lui non ne ha chiesto un limite, e una soglia scelta
   * da me su quante card si possono aprire e' una soglia che nessuno ha misurato.
   *
   * Dal bordo SINISTRO e non dal centro, cosi' la posizione non dipende dalla larghezza della finestra
   * (una card centrata piu' una sfalsata e' una coppia che si sovrappone su uno schermo stretto). E
   * tutte restano trascinabili: il posto vero glielo da' lui.
   */
  protected readonly left = computed(() => 16 + (this.at() % 4) * 300);
  protected readonly top = computed(() => 96 + (Math.floor(this.at() / 4) % 3) * 44);

  /**
   * QUESTA CARD È DAVANTI? Dallo store, che tiene l'ultima toccata - e non dall'indice, che è
   * l'ordine di APERTURA e serve al posto in cui la card nasce. Due domande, due stati: leggerle
   * dallo stesso numero fa saltare le card di posto ogni volta che ne porti una avanti.
   */
  protected readonly front = computed(() => this.store.frontCard() === this.man().id);

  /**
   * TOCCATA: davanti alle altre, su `pointerdown` e non su `cdkDragStarted`.
   *
   * Un trascinamento comincia con un pointerdown, quindi questo copre la sua richiesta («quando
   * trascino una card deve spostarsi sopra le altre») e anche il caso più frequente, che è un
   * semplice click su una card mezza coperta per leggerla. E precede sempre il drag di CDK, quindi la
   * card è già davanti nel primo fotogramma del movimento invece che dopo la soglia dei tre pixel.
   */
  protected raise(): void {
    this.store.raiseCard(this.man().id);
  }

  /** Il gradino, la banda e i minuti: le tre frasi che un'asta chiede di un nome. */
  protected readonly numbers = computed(() => this.store.numbersFor(this.man().id));

  /** Cosa dice oggi la stampa (o un infortunio aperto): la ragione, non solo il fatto. */
  /**
   * LA FRASE ROSSA IN CIMA ALLA CARD, e ce ne sono due perche' sono due situazioni.
   *
   * Dove una data di rientro esiste, la nota e' il CONTO - quante giornate perde, quante ne gioca -
   * perche' e' quello che spiega i due numeri qui sotto e la banda: le presenze attese della card
   * sono gia' ridotte, e una riduzione senza il suo perche' si legge come un difetto. Dove la data
   * non c'e', resta la frase del servizio: «oggi non gioca», che e' tutto quello che si sa.
   */
  protected readonly outNote = computed(() => {
    const window = this.man().out;
    if (window) return outWindowNote(window);
    return this.status.unavailableNow(this.man().id)?.note ?? null;
  });

  /**
   * FUORI ROSA: la nota DICHIARATA dall'operatore, letta dal servizio e non da un campo della riga.
   *
   * `BoardMan` non ha quel campo - la plancia non lo porta - e io avevo scritto il template contro un
   * campo ricordato invece che letto: «verifica la FUNZIONE, non la colonna che le somiglia», in casa
   * mia. Il servizio è lo stesso che disegna le icone, quindi la card e la riga non possono dire due
   * cose diverse sullo stesso uomo.
   */
  protected readonly outOfSquad = computed(
    () => this.status.declared().get(this.man().id)?.kind === 'out_of_squad',
  );

  /**
   * PERCHE' IL TETTO E' QUELLO, quando non e' il suo gradino a deciderlo.
   *
   * Una max offerta piu' bassa senza una parola si legge come un errore, ed e' la stessa regola per
   * cui la finestra dell'infortunio sta scritta sopra: «un vincolo che agisce in silenzio e'
   * indistinguibile da un ordinamento rotto». Sul lotto la ragione la scrive `adviseLot`; qui la card
   * si apre anche su chi non e' in asta, quindi la ragione se la deve dire da sola.
   */
  protected readonly capNote = computed(() => {
    const band = this.man().band;
    if (!band) return null;
    if (band.bet) {
      return `Tetto dichiarato per una scommessa: ${band.high} crediti, non di piu'.`;
    }
    if (band.pricedAt !== Number(this.slotLabel())) {
      return `Prezzato come uno slot ${band.pricedAt}: infortunato oggi, non lo pago da primo.`;
    }
    return null;
  });

  protected readonly base = EDGE_BASE;

  /** `A1`, `P3`: lo slot come lo legge la plancia, dal blocco in cui l'uomo sta. */
  protected readonly slotLabel = computed(() => {
    const id = this.man().id;
    const block = this.store.blocks().find((one) => one.rows.some((row) => row.id === id));
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
    const engine = this.numbers();
    if (!engine) return null;
    return this.man().basis === 'estimated' ? engine.estFm : engine.fm;
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
