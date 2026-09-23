import { Component, computed, inject, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';

import { AuctionFeed } from '../../core/auction-feed';
import { GlobalOptions } from '../../core/global-options';

/**
 * LA SESSIONE DAL VIVO, tutta qui: collegarsi, dire quale squadra è la propria, cambiare asta, uscire.
 *
 * The operator's decision of 03/09/2026 turned the connection from the entrance into an option: both
 * auction pages now OPEN on an invented table with standard settings, and the code is asked for only
 * when he presses the button. So the code field belongs in a modal, and the modal belongs to neither
 * page - two copies of it would eventually validate the code two ways, and the format is the reason
 * the connection works at all (`FA-` plus two base-36 triplets IS the database key).
 *
 * DAL 24/09/2026 PORTA ANCHE LE ALTRE DUE DOMANDE, su sua richiesta: da collegati il tasto «cambia
 * asta» sparisce dalla barra e l'ENTRATA è la pastiglia col codice, che è anche il posto dove uno
 * guarda quando vuole sapere a cosa è collegato. Un bottone in barra per ogni cosa che si fa una volta
 * per asta è una barra che si legge per quattro ore.
 *
 * QUALE SQUADRA È LA MIA non è una preferenza, è un INPUT dei numeri: senza, la plancia non ha una
 * borsa su cui poggiare i tetti (`room` legge i crediti della mia rosa) e conta DIECI mani alzate su
 * ogni nome invece di nove, perché quella che esclude è la mia. Prima di oggi da `/plancia` non si
 * poteva dire affatto - la si sceglieva solo dal pannello draft - quindi collegarsi da lì lasciava il
 * tabellone a leggere il budget di lega al posto del mio.
 *
 * It talks to `AuctionFeed` directly rather than emitting a code upward, because the two things it has
 * to show while connecting - the loading state and WHY a connection failed - are the feed's own and
 * copying them into an input would be a second answer to «are we connected?». L'unica cosa che ESCE è
 * `left`: cosa mettere a schermo quando non c'è più un tavolo è una decisione della pagina (la plancia
 * torna alla finzione), e deciderla qui vorrebbe dire che questa modale sa chi la sta usando.
 */
@Component({
  selector: 'ui-live-connect',
  templateUrl: './live-connect.html',
  imports: [
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzModalModule,
  ],
})
export class LiveConnect {
  protected readonly feed = inject(AuctionFeed);
  /** Il regolamento dichiarato, per DIRE cosa il tavolo gli ha cambiato quando ci si e' seduti. */
  protected readonly options = inject(GlobalOptions);

  /** Two-way: the page owns the button, this owns what happens after it. */
  readonly open = model(false);

  /** Il tavolo se n'è andato: la pagina rimetta il suo. Vedi il commento in testa. */
  readonly left = output<void>();

  protected readonly code = signal('');
  protected readonly busy = signal(false);

  /**
   * C'È UNA SESSIONE DI CUI PARLARE, che non è «siamo collegati».
   *
   * Dopo un refresh il tavolo salvato è a schermo mentre lo stream si riapre: lì il codice c'è, la
   * squadra si può ancora scegliere e uscire ha senso, quindi la modale deve mostrare le sue tre
   * domande. Gatarla su `connected()` avrebbe fatto comparire il campo del codice sopra un'asta che
   * l'operatore sta giocando, che è esattamente il contrario di quello che ha chiesto.
   */
  protected readonly session = computed(() => !this.feed.demo() && !!this.feed.code());

  protected async connect(): Promise<void> {
    const code = this.code().trim();
    if (!code) return;
    this.busy.set(true);
    try {
      if (await this.feed.connect(code)) {
        // IL CAMPO SI SVUOTA SOLO QUANDO IL COLLEGAMENTO RIESCE: un codice rifiutato deve restare
        // scritto, o correggere un carattere vuol dire ribatterlo tutto.
        this.code.set('');
        this.open.set(false);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** La squadra è una scelta reversibile: ri-premere quella accesa la spegne, come la lente. */
  protected choose(teamId: number): void {
    if (this.feed.followedTeamId() === teamId) this.feed.unfollow();
    else this.feed.follow(teamId);
  }

  protected leave(): void {
    this.feed.leave();
    this.code.set('');
    this.open.set(false);
    this.left.emit();
  }
}
