import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { Component, computed, inject, input, output } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';

import { ClubBoards } from '../../core/club-boards';
import { CLUB_CARD_WIDTH, clubCardLeft, clubCardTop } from '../../core/player-card';
import { Platform } from '../../core/players-store';
import { ValuationStore } from '../../core/valuation-store';
import { ClubBoard } from '../club-board/club-board';
import { ClubCrest } from '../club-crest/club-crest';

/**
 * LA CARD DI UNA SQUADRA: il campetto con la sua formazione tipo, trascinabile e chiudibile.
 *
 * Richiesta dell'operatore (23/09/2026): «quando si clicca sul nome della squadra all'interno della card
 * dettaglio calciatore fai aprire una nuova card draggabile con il campetto con la formazione tipo della
 * squadra». Nasce quindi da `ui/player-card`, e la domanda che risponde e' quella che una card di un
 * calciatore provoca: «e nel suo undici, dove sta?».
 *
 * IL DISEGNO E' QUELLO DI SEMPRE (`ui-club-board`): «il campetto di una squadra reale deve essere sempre
 * uguale» (operatore, 18/08/2026), quindi questa e' una CORNICE e non un secondo campetto - e l'undici lo
 * disegna il TOOLKIT (`modules/boards.py`), che e' la regola piu' vecchia di questa pagina: l'app legge la
 * board e non ne calcola mai una sua.
 *
 * E A DIFFERENZA DELLA CARD DI UN CALCIATORE, QUESTA I NUMERI SE LI PRENDE DA SE'. Non e' un'eccezione
 * alla regola, e' la stessa regola letta per intero: la card di un uomo riceve i suoi numeri perche' il
 * surplus di un uomo e' un fatto del GIOCO che lo prezza, e la plancia e la Strategia leggono due fogli
 * diversi; una board invece e' una previsione su un allenatore vero, che i due giochi di una piattaforma
 * condividono - `ValuationStore` ne tiene UNA per piattaforma, e la dice per (piattaforma, club) come
 * dice il ruolo reale granulare. Quindi basta sapere di quale club si parla e su quale listone.
 */
@Component({
  selector: 'ui-club-card',
  templateUrl: './club-card.html',
  imports: [CdkDrag, CdkDragHandle, ClubBoard, ClubCrest, NzIconModule],
})
export class ClubCard {
  private readonly valuation = inject(ValuationStore);
  private readonly boards = inject(ClubBoards);

  readonly club = input.required<string>();
  /** Quale listone: lo stesso club ha due board sulle due piattaforme, e non sono la stessa domanda. */
  readonly platform = input.required<Platform>();
  /** Il POSTO che la pila le ha dato alla nascita, e che tiene finche' e' aperta. */
  readonly at = input<number>(0);
  readonly front = input<boolean>(false);

  readonly closed = output<void>();
  readonly raised = output<void>();

  constructor() {
    // IL PACCHETTO NON E' DETTO CHE SIA GIA' LETTO: sulla plancia nessuno chiede `ValuationStore`, che e'
    // il negozio che porta le board. Si chiede QUI, cioe' alla prima card aperta, e non all'apertura
    // della pagina - `load()` tiene la sua promessa, quindi la seconda card non paga niente.
    void this.valuation.load();
  }

  protected readonly width = CLUB_CARD_WIDTH;
  protected readonly left = computed(() => clubCardLeft(this.at()));
  protected readonly top = computed(() => clubCardTop(this.at()));

  protected readonly crests = computed(() => this.valuation.crests());

  /** La rosa quotata di questo club, dal negozio che valuta un uomo: nessun numero nasce qui. */
  private readonly squad = computed(() => this.boards.squadOf(this.platform(), this.club()));

  protected readonly pack = computed(() =>
    this.boards.packFor(this.platform(), this.club(), this.squad()),
  );

  /** Quale FOGLIO ha disegnato questa board: un numero che non dice da dove viene non e' un numero. */
  protected readonly sheet = computed(() => this.pack().sheet?.league ?? null);

  protected close(): void {
    this.closed.emit();
  }

  /** Toccata: davanti alle altre, su `pointerdown` - un click e un trascinamento sono la stessa cosa. */
  protected raise(): void {
    this.raised.emit();
  }
}
