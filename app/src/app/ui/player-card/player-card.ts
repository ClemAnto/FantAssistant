import { DecimalPipe } from '@angular/common';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { outWindowNote } from '../../core/injury-window';
import { CardMan, RECENT_MATCHES, RECENT_SEASONS, cardLeft, cardTop } from '../../core/player-card';
import { PlayerStatus } from '../../core/player-status';
import { PlayersStore } from '../../core/players-store';
import { EDGE_BASE } from '../../core/plancia';
import { MatchLine } from '../match-line/match-line';
import { PlayerFlags } from '../player-flags/player-flags';

/**
 * LA CARD DI UN CALCIATORE: si apre col click su un nome, si trascina, si chiude.
 *
 * Nata sulla PLANCIA il 04/09/2026 («quando clicco su un calciatore si deve aprire una card compatta
 * draggabile e chiudibile con le info principali del calciatore e le sue statistiche essenziali») e
 * spostata in `ui/` il 05/09/2026, quando l'operatore ha chiesto LA STESSA card sulla Strategia. Due
 * card sarebbero due letture degli stessi `engine_*`, cioe' due valutazioni per un uomo.
 *
 * TRE COSE CHE QUESTA CARD NON FA, e sono la ragione per cui e' una card e non un pannello.
 *
 * NON RICALCOLA NIENTE. Ogni numero arriva gia' letto in `CardMan`, dalla pagina che apre la card e dal
 * FOGLIO che quella pagina sta leggendo - che non e' sempre lo stesso: la plancia prezza
 * `default|classic`, la Strategia il foglio della combinazione dichiarata. Una card che andasse a
 * prendersi i numeri da sola direbbe di un uomo il surplus di un altro gioco.
 *
 * NON DECIDE AL POSTO SUO. Il click apre la card e nient'altro: nominare il LOTTO e' un bottone, e
 * resta un gesto separato per l'istruzione del 03/09 («cliccare non deve mettere il calciatore in
 * asta»). I bottoni li PROIETTA la pagina (`[card-actions]`), perche' sono gesti di quella pagina: la
 * Strategia non ha un'asta in corso e quindi non ne ha nessuno.
 *
 * NON SI TRASCINA DA SE': `cdkDrag` con `cdkDragHandle` sull'intestazione, perche' una card che si
 * sposta afferrandola in mezzo a un numero e' una card in cui non si puo' selezionare un numero.
 *
 * QUELLO CHE INVECE SI PRENDE DA SE' sono i fatti che non dipendono dal foglio: i marchi e la nota
 * dichiarata (`PlayerStatus`) e LE ULTIME PARTITE (`PlayersStore`), che sono calcio giocato e non una
 * previsione - stesse celle della tabella di consultazione, non una seconda lettura.
 */
@Component({
  selector: 'ui-player-card',
  templateUrl: './player-card.html',
  imports: [
    CdkDrag,
    CdkDragHandle,
    DecimalPipe,
    NzIconModule,
    NzTooltipModule,
    MatchLine,
    PlayerFlags,
  ],
})
export class PlayerCard {
  private readonly status = inject(PlayerStatus);
  private readonly players = inject(PlayersStore);

  /** L'uomo di QUESTA card, passato dalla pagina: le card aperte sono piu' di una. */
  readonly man = input.required<CardMan>();

  /**
   * IL SUO POSTO, assegnato dallo stack alla nascita e tenuto per tutta la vita della card.
   *
   * Non e' l'indice nell'elenco: con l'indice, chiudere una card faceva scalare tutte le successive
   * («quando chiudo una card le altre non si devono spostare»), e una card che si sposta da se' mentre
   * la guardi rompe il confronto per cui e' aperta.
   */
  readonly at = input<number>(0);

  /** Se sta davanti alle altre: lo sa lo stack, che tiene l'ultima TOCCATA. */
  readonly front = input<boolean>(false);

  readonly closed = output<number>();
  readonly raised = output<number>();

  constructor() {
    // Le ultime partite vivono in un altro store, che nessuna delle due pagine d'asta carica: si chiede
    // QUI, cioe' alla prima card aperta, e non all'apertura della pagina. `load()` tiene la sua promessa,
    // quindi la seconda card non paga niente.
    void this.players.load();
  }

  protected close(): void {
    this.closed.emit(this.man().id);
  }

  /**
   * TOCCATA: davanti alle altre, su `pointerdown` e non su `cdkDragStarted`.
   *
   * Un trascinamento comincia con un pointerdown, quindi questo copre «quando trascino una card deve
   * spostarsi sopra le altre» e anche il caso piu' frequente, che e' un click su una card mezza coperta
   * per leggerla. E precede sempre il drag di CDK, quindi la card e' gia' davanti nel primo fotogramma.
   */
  protected raise(): void {
    this.raised.emit(this.man().id);
  }

  protected readonly left = computed(() => cardLeft(this.at()));
  protected readonly top = computed(() => cardTop(this.at()));

  protected readonly base = EDGE_BASE;

  /**
   * LA FRASE ROSSA IN CIMA, e ce ne sono due perche' sono due situazioni.
   *
   * Dove una data di rientro esiste, la nota e' il CONTO - quante giornate perde, quante ne gioca -
   * perche' e' quello che spiega i numeri qui sotto: le presenze attese della card sono gia' ridotte, e
   * una riduzione senza il suo perche' si legge come un difetto. Dove la data non c'e', resta la frase
   * del servizio: «oggi non gioca», che e' tutto quello che si sa.
   */
  protected readonly outNote = computed(() => {
    const window = this.man().out;
    if (window) return outWindowNote(window);
    return this.status.unavailableNow(this.man().id)?.note ?? null;
  });

  /**
   * FUORI ROSA: la nota DICHIARATA dall'operatore, letta dal servizio e non da un campo della riga.
   *
   * Il servizio e' lo stesso che disegna le icone, quindi la card e la riga non possono dire due cose
   * diverse sullo stesso uomo.
   */
  protected readonly outOfSquad = computed(
    () => this.status.declared().get(this.man().id)?.kind === 'out_of_squad',
  );

  // ------------------------------------------------------------ le ultime partite

  /**
   * LE ULTIME CINQUE PARTITE DELLA SUA SQUADRA (richiesta dell'operatore, 05/09/2026).
   *
   * Della SQUADRA e non le sue: una giornata che ha saltato e' una riga con la sua ragione - infortunio,
   * panchina, non in questo campionato - ed e' il punto della richiesta. «Le ultime cinque in cui ha
   * giocato» sarebbe un'altra domanda, e molto piu' lusinghiera.
   *
   * Le costruisce `PlayersStore.recent`, che e' lo stesso lettore della tabella di consultazione:
   * `MatchQuery` scrive di se' che esiste perche' «una seconda implementazione di le ultime partite
   * sarebbe una seconda risposta a una domanda che questo store risponde gia'».
   */
  protected readonly recent = computed(() =>
    this.players.ready()
      ? this.players.recent(
          this.man().id,
          this.man().platform,
          // Chiusa: le ultime cinque. Aperta: tutto quello che c'e' di questa stagione e della
          // precedente - due limiti diversi perche' sono due domande diverse.
          this.open() ? { seasons: RECENT_SEASONS } : { count: RECENT_MATCHES },
        )
      : [],
  );

  /**
   * IL PANNELLO APERTO (richiesta dell'operatore, 05/09/2026): «l'area delle ultime partite si deve
   * estendere fino all'header e caricare tutte le partite di questa stagione e della precedente; la
   * card deve rimanere delle stesse dimensioni e deve avere una scrollbar».
   *
   * Quindi non e' una card che cresce: e' lo SPAZIO DI SOPRA che viene prestato all'elenco. I due
   * numeri grandi, il prezzo e le statistiche si chiudono, l'elenco prende quello che lasciano, e la
   * card resta larga e alta com'era.
   */
  protected readonly open = signal(false);

  private readonly shell = viewChild<ElementRef<HTMLElement>>('shell');

  /**
   * L'ALTEZZA CONGELATA: quella che la card aveva quando l'hai aperta.
   *
   * «Delle stesse dimensioni» e' una misura e non un'intenzione, quindi si MISURA invece di sperarci:
   * un'altezza fissa scelta da me sarebbe troppa per un portiere senza note e troppo poca per un
   * infortunato con due avvisi in cima. Si legge il rettangolo che il browser dichiara nel momento del
   * click e si pianta li'; chiudendo, si lascia andare.
   */
  protected readonly pinned = signal<number | null>(null);

  protected toggleOpen(): void {
    const opening = !this.open();
    this.pinned.set(opening ? (this.shell()?.nativeElement.offsetHeight ?? null) : null);
    this.open.set(opening);
  }

  protected readonly loadingMatches = computed(() => !this.players.ready());

  protected readonly crests = computed(() => this.players.crests());
  protected readonly scoring = computed(() => this.players.scoring());

  /** L'avversario ha un nome e non un'identita': lo stemma si prova a risolvere, o resta un monogramma. */
  protected opponentId(name: string | null): number | null {
    return this.players.clubIdOf(name);
  }

  /**
   * L'identita' del SUO club: la CHIAVE se chi apre la card ce l'ha, il nome solo se non ce l'ha.
   *
   * La Strategia legge il listone e porta l'id; la plancia sta su un listone che di identita' di club
   * non ne ha una. L'ordine e' quello e non l'inverso, perche' un nome non e' una chiave: si ripiega
   * sul nome dove non c'e' altro, e per uno STEMMA - mai per un numero.
   */
  protected readonly ownId = computed(
    () => this.man().clubId ?? this.players.clubIdOf(this.man().club),
  );

  /** La fantamedia da mostrare, gia' scelta da chi ha costruito la riga: la card non ne sceglie una sua. */
  protected readonly fm = computed(() => this.man().fm);
}
