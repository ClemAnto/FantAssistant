import { DecimalPipe } from '@angular/common';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { outWindowNote } from '../../core/injury-window';
import { BonusRow } from '../../core/match-bonuses';
import {
  CARD_WIDTH,
  CardMan,
  RECENT_MATCHES,
  RECENT_SEASONS,
  SeasonTotals,
  cardLeft,
  cardRows,
  cardTop,
  seasonTotals,
} from '../../core/player-card';
import { PlayerStatus } from '../../core/player-status';
import { PlayersStore, clubNameKey } from '../../core/players-store';
import { EDGE_BASE } from '../../core/plancia';
import { BonusMark } from '../bonus-mark/bonus-mark';
import { ClubCrest } from '../club-crest/club-crest';
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
    BonusMark,
    CdkDrag,
    CdkDragHandle,
    ClubCrest,
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

  /** La larghezza sta in `core/` accanto al passo che la usa: due numeri si scoprono diversi tardi. */
  protected readonly width = CARD_WIDTH;

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
  /** Le righe con i loro divisori: la lista che il template disegna, gia' decisa in `core/`. */
  protected readonly rows = computed(() => cardRows(this.recent(), this.man().club));

  protected readonly recent = computed(() =>
    this.players.ready()
      ? this.players.recent(
          this.man().id,
          this.man().platform,
          // Chiusa: le ultime cinque. Aperta: quante stagioni ne ha chieste - due per cominciare, una
          // in piu' a ogni «carica». Due limiti diversi perche' sono due domande diverse.
          this.open() ? { seasons: this.seasonsWanted() } : { count: RECENT_MATCHES },
        )
      : [],
  );

  /**
   * QUANTE STAGIONI L'ELENCO APERTO STA MOSTRANDO, e il tasto che ne chiede una in piu'.
   *
   * Richiesta dell'operatore (05/09/2026): «quando scrollo al termine della stagione scorsa, mostra un
   * tasto per caricare anche la stagione precedente». Il tasto sta IN FONDO all'elenco e non in cima,
   * che e' esattamente «quando scrollo al termine»: si incontra arrivando dove la lista finisce, e non
   * chiede a nessuno di ricordarsi che esiste.
   *
   * E NOMINA LA STAGIONE CHE CARICHEREBBE, presa da `PlayersStore.seasonsWith` - lo stesso elenco su
   * cui `recent` decide dove fermarsi. Chiedere al bundle «qual e' la stagione prima» avrebbe offerto
   * un tasto che carica ZERO righe per chiunque abbia saltato un anno: qui una stagione esiste solo se
   * ha prodotto qualcosa. Quando non ce n'e' piu', il tasto non c'e' - non e' disabilitato, che si
   * legge come «non funziona» invece che come «non c'e' altro».
   */
  private readonly seasonsWanted = signal(RECENT_SEASONS);

  protected readonly moreSeason = computed<string | null>(() => {
    if (!this.open() || !this.players.ready()) return null;
    const seasons = this.players.seasonsWith(this.man().id, this.man().platform);
    return seasons[this.seasonsWanted()] ?? null;
  });

  protected loadMore(): void {
    this.seasonsWanted.update((many) => many + 1);
  }

  /**
   * IL RIEPILOGO DI UNA STAGIONE, sotto il suo divisore (operatore, 05/09/2026).
   *
   * Sulle partite che lo STORE ha di quella stagione e non su quelle disegnate: l'elenco puo' essere
   * troncato, e una media su tre righe che dice «2024-25» sarebbe una statistica su una lista diversa
   * da quella che descrive - il difetto che questo progetto ha gia' pagato, con i segni invertiti.
   * Il numero di partite sta in prima colonna proprio per questo: e' il denominatore, e si vede.
   */
  /**
   * Una media del riepilogo come si legge: una cifra dopo la virgola, e il `~` se poggia su un voto
   * sintetico - lo stesso marchio che porta la riga da cui viene, o due numeri della stessa colonna
   * direbbero che uno dei due e' misurato.
   */
  protected mean(value: number | null, totals: SeasonTotals): string {
    if (value == null) return '—';
    return (totals.synthetic ? '~' : '') + value.toFixed(1);
  }

  /**
   * UN ATTESO COME SI LEGGE: due cifre dopo la virgola, e nessun `~`.
   *
   * DUE E NON UNA come le medie qui sopra, perche' e' un'altra grandezza: un xG a partita sta fra 0,00
   * e 0,80 e a una cifra sola meta' del listone leggerebbe «0,1». E niente marchio del sintetico: un
   * atteso arriva dal provider come lo pubblica, non da una retta calibrata sui voti.
   */
  protected expected(value: number | null): string {
    return value == null ? '—' : value.toFixed(2);
  }

  /**
   * SU QUANTE PARTITE POGGIANO, che sono due numeri diversi e nessuno dei due e' `played`.
   *
   * Gli attesi vengono dal layer per-partita e i voti dai voti: una giornata puo' avere il voto e non
   * la riga del provider. Dirlo e' il punto - una media senza il suo denominatore e' la famiglia di
   * difetti che questo progetto paga da sempre - e il posto giusto e' il tooltip, perche' la riga porta
   * gia' due numeri e la card e' larga `CARD_WIDTH`, che e' una costante e non un numero da citare qui
   * (citato, il commento e' rimasto a 288 il giorno in cui la card e' passata a 320).
   */
  protected expectedHint(totals: SeasonTotals): string {
    const on = (many: number) => `${many} partit${many === 1 ? 'a' : 'e'} di ${totals.played}`;
    return (
      `Gol e assist ATTESI per partita giocata, dal fornitore dei dati per partita. ` +
      `xG su ${on(totals.xgOn)}, xA su ${on(totals.xaOn)}. Solo partite di campionato.`
    );
  }

  /** I due marchi del riepilogo, con lo stesso vocabolario di icone di una riga di partita. */
  protected goalsMark(totals: SeasonTotals): BonusRow {
    return { kind: 'goal', label: 'Gol', short: 'G', count: totals.goals, points: null, good: true };
  }

  protected assistsMark(totals: SeasonTotals): BonusRow {
    return {
      kind: 'assist', label: 'Assist', short: 'A', count: totals.assists, points: null, good: true,
    };
  }

  protected totals(season: string): SeasonTotals | null {
    if (!this.players.ready()) return null;
    return seasonTotals(this.players.matchesOf(this.man().id, this.man().platform, season));
  }

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
    // Chiudendo si torna alle due stagioni: quello che si e' caricato appartiene a QUELLA lettura, e
    // riaprire la card con dieci stagioni gia' dentro sarebbe una card che decide da se' quanto scorrere.
    if (!opening) this.seasonsWanted.set(RECENT_SEASONS);
  }

  protected readonly loadingMatches = computed(() => !this.players.ready());

  protected readonly crests = computed(() => this.players.crests());
  protected readonly scoring = computed(() => this.players.scoring());

  /**
   * LO STEMMA DI UN CLUB DALLA SUA GRAFIA, e vale per tutt'e due le squadre di una riga.
   *
   * PER LA SUA VALE COME PER L'AVVERSARIO, ed e' la correzione del 05/09/2026 («quando un calciatore
   * giocava per un'altra squadra mostri lo stesso lo stemma della squadra corrente»): prima la riga
   * riceveva l'id del club di OGGI, quindi le trentadue partite di Kolo Muani col Tottenham
   * portavano lo stemma della Juventus - e lo stesso capitava dentro la Serie A a chiunque avesse
   * cambiato squadra, sulle giornate della stagione passata.
   *
   * Nessun ripiego sul club di oggi: uno stemma sbagliato dice una cosa FALSA sulla riga, mentre uno
   * scudo grigio dice quello che e'. Quanto costa, misurato sul bundle del 05/09/2026: il club di una
   * riga di campionato si risolve al 100% (`match_ratings` scrive la grafia canonica) e quello del
   * layer per-partita al 61,3% - il provider scrive `Tottenham Hotspur` dove il nostro listone scrive
   * `Tottenham`, e la lista degli alias vive nel TOOLKIT (`matching.CLUB_ALIASES`), che e' dove va
   * risolta un'identita'. Rifarla nel browser e' il join che una volta ha perso Milan, Roma e Napoli.
   */
  protected crestId(name: string | null): number | null {
    return this.players.clubIdOf(name);
  }

  /**
   * QUEL GIORNO GIOCAVA ALTROVE: il confronto e' fra il club della RIGA e quello di oggi.
   *
   * Sulla CHIAVE normalizzata e non sulla stringa, o `Tottenham Hotspur` e `Tottenham` sarebbero due
   * club diversi e ogni riga estera si accenderebbe due volte per lo stesso motivo. Un club che non
   * si sa nominare (una giornata saltata non porta squadra) non e' «altrove»: e' ignoto, e non si
   * dipinge.
   */
  protected elsewhere(team: string): boolean {
    const key = clubNameKey(team);
    return !!key && key !== clubNameKey(this.man().club);
  }

  /** La fantamedia da mostrare, gia' scelta da chi ha costruito la riga: la card non ne sceglie una sua. */
  protected readonly fm = computed(() => this.man().fm);
}
