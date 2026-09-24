import {
  Component,
  DestroyRef,
  TemplateRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { AuctionFeed } from '../../core/auction-feed';
import { PageActions } from '../../core/page-actions';
import { Goal, GOAL_LABEL } from '../../core/focus';
import { Role, RowStats, SlotView } from '../../core/plancia';
import { PLAYED_PROGRESS } from '../../core/plancia-demo';
import { BoardMan, PlanciaStore } from '../../core/plancia-store';
import { AppHeader } from '../../ui/app-header/app-header';
import { FlagMenu } from '../../ui/flag-menu/flag-menu';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { TimeTravel } from '../../core/time-travel';
import { countsOf } from '../../core/plancia-order-file';
import { playerCard } from '../../core/player-card';
import { ROW_TREND_MATCHES } from '../../core/player-trend';
import { ClubCard } from '../../ui/club-card/club-card';
import { PlayerCard } from '../../ui/player-card/player-card';
import { LiveConnect } from '../../ui/live-connect/live-connect';
import { KeeperPairs } from './keeper-pairs/keeper-pairs';
import { LotCard } from './lot-card/lot-card';
import { SlotMatrix } from './slot-matrix/slot-matrix';
import { SquadCard } from './squad-card/squad-card';
import { TeamGrid } from './team-grid/team-grid';

/**
 * `/plancia` - the assistant of a RANDOM-EXTRACTION raise auction.
 *
 * The page opens on an invented table with the standard league settings and connects to a real session
 * only when the operator presses the button (his decision of 03/09/2026, which holds for `/auction`
 * too). Three zones and a fixed regulation bar, laid out the way he asked on the same day: the LOT is a
 * ROW under the header, and everything else is the board - which needs the room, because all 250 rows
 * are on screen at once. The page itself does NOT scroll. The ten participants were a COLUMN of cards
 * on the right until 22/09/2026, when he moved them into the empty space the keepers' line leaves:
 * that room was free and the column was costing the board 240px of width.
 *
 * The mechanic is FREE extraction over the whole listone - one name at a time, any role at any moment -
 * which is the operator's own auction. It is not the departmental order the bench models
 * (`bench.PHASES`, adopted from 16 of the 20 real auctions with this configuration), and the difference
 * is stated rather than smoothed over: what the board reads - the ladder, the thinning discount, the
 * timing band - is indexed on how many rosters still want a role and not on the order, so it carries
 * over; what does not carry over is any expectation about WHICH role comes next.
 */
@Component({
  selector: 'app-plancia',
  templateUrl: './plancia.html',
  imports: [
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzInputNumberModule,
    NzModalModule,
    NzPopconfirmModule,
    NzRadioModule,
    NzSelectModule,
    NzTooltipModule,
    AppHeader,
    FlagMenu,
    KeeperPairs,
    LiveConnect,
    LotCard,
    ClubCard,
    RoleBadge,
    PlayerCard,
    SlotMatrix,
    SquadCard,
    TeamGrid,
  ],
})
export class Plancia {
  /**
   * I TRE GESTI DI PREPARAZIONE, disegnati dalla scatola fissa in basso e non dalla barra in cima.
   *
   * Registrati e non proiettati perché `ui-global-options` sta fuori dall'outlet: la ragione per
   * intero, e perché non è una seconda scatola fissa, è in `core/page-actions.ts`. L'`effect` scrive
   * il template appena la vista esiste, e `DestroyRef` lo toglie quando la pagina se ne va - passando
   * IL PROPRIO, perché la vista che arriva si registra prima che questa sia distrutta e un `set(null)`
   * secco cancellerebbe i tasti di chi è appena entrato.
   */
  private readonly actions = viewChild<TemplateRef<unknown>>('pageActions');
  protected readonly store = inject(PlanciaStore);
  protected readonly feed = inject(AuctionFeed);

  protected readonly connecting = signal(false);

  /**
   * SE LA LISTA DEI BUTTATI E' APERTA (sua richiesta, 24/09/2026).
   *
   * Un segnale della VISTA e non dello store, come `connecting`: «questa modale e' aperta» e' un fatto
   * sullo schermo e non sull'asta, e lo store non deve sapere chi lo guarda. Non e' persistito - una
   * modale che si riapre da sola a ogni ricaricamento e' una modale che si impara a chiudere.
   */
  protected readonly binOpen = signal(false);

  /**
   * L'ORDINAMENTO DA PORTARE SU UN ALTRO DEVICE (sua richiesta, 24/09/2026).
   *
   * Una casella di testo sola per le due direzioni: si apre con dentro quello che c'e' adesso - pronto
   * da copiare - e la stessa casella e' dove si incolla quello che arriva. Due riquadri direbbero che
   * sono due cose, e sono la stessa: l'oggetto.
   *
   * NON un file da scaricare: fra due computer passa da una chat o da una mail come qualunque altro
   * testo, e un download obbligherebbe a trovare il file sull'altro device prima di poterlo incollare.
   */
  protected readonly moveOpen = signal(false);
  protected readonly moveText = signal('');
  /** Cosa e' successo all'ultimo gesto: un import muto e' indistinguibile da un bottone rotto. */
  protected readonly moveSays = signal('');
  private readonly travel = inject(TimeTravel);

  protected openMove(): void {
    this.moveText.set(JSON.stringify(this.store.exportOrder(this.travel.realToday), null, 1));
    this.moveSays.set('');
    this.moveOpen.set(true);
  }

  /** La copia negli appunti, con la ragione a schermo quando il browser non la concede. */
  protected async copyMove(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.moveText());
      this.moveSays.set('Copiato: incollalo nella stessa finestra sull altro device.');
    } catch {
      this.moveSays.set('Il browser non mi lascia scrivere negli appunti: seleziona il testo e copialo a mano.');
    }
  }

  /**
   * L'IMPORT DICE COSA HA LETTO, sempre: quante liste, quanti nomi, quanti buttati.
   *
   * «Importato» da solo non distingue un oggetto pieno da uno vuoto, e un oggetto vuoto e' esattamente
   * quello che si ottiene incollando la cosa sbagliata. Lo store SOSTITUISCE - la ragione sta li' - e
   * quando rifiuta torna la frase da mostrare invece di un silenzio.
   */
  protected importMove(): void {
    const done = this.store.importOrder(this.moveText());
    if (typeof done === 'string') return this.moveSays.set(done);
    const counts = countsOf(done);
    this.moveSays.set(
      `Importato${done.saved ? ` (salvato il ${done.saved})` : ''}: ${counts.names} nomi ordinati su ` +
        `${counts.lists} liste e ${counts.binned} buttati. Ora la plancia è quella.`,
    );
  }

  /**
   * I DUE TAGLI, con la loro frase: il bottone dice cosa cambia, non solo che qualcosa cambia.
   *
   * Sua richiesta del 04/09/2026. La parola «slot» è quella del gioco (sua indicazione del 03/09,
   * come `titolarissimo` e `por`), quindi i due nomi sono i suoi e non «fasce» o «blocchi».
   */
  /**
   * COSA IL FOCUS STA CERCANDO, in parole: una frase per reparto, e niente per quelli a posto.
   *
   * LE QUATTRO PAROLE SONO SUE (23/09/2026): TOP · TITOLARE · COPERTURA · RESTO. L'etichetta dice
   * l'obiettivo ATTIVO di quel reparto - quello che la rosa chiede, o quello che ha scelto lui - e un
   * click passa al successivo. Quello che l'automatico propone segue le misure: prima il buco (4,73
   * fantapunti a giornata, il numero piu' grande che questo progetto abbia misurato su una rosa) e per
   * chiuderlo serve un TITOLARE, poi le parole alte dove pagano, poi il riempimento.
   *
   * VUOTA QUANDO NON MANCA NIENTE, e lo dice il template con una frase invece che con il silenzio: una
   * barra che non nomina nessun reparto mentre lo schermo e' mezzo spento si legge come un guasto.
   */
  protected readonly focusSays = computed<{ role: Role; label: string; advised: boolean }[]>(() => {
    const needs = this.store.focusNeeds();
    const auto = this.store.focusAuto();
    return (['P', 'D', 'C', 'A'] as const)
      .filter((role) => needs[role] !== null)
      .map((role) => ({
        role,
        label: GOAL_LABEL[needs[role] as Goal],
        // IL PRIMARIO DICE «QUESTO E' IL CONSIGLIO» (sua richiesta del 23/09/2026: «colorando con il
        // primary l'etichetta corretta»), e la sua assenza dice «questo l'hai scelto tu». Sono due
        // fatti diversi sulla stessa etichetta, e senza il colore un obiettivo scavalcato a mano
        // sarebbe indistinguibile da uno consigliato - cioe' il sistema sembrerebbe suggerire quello
        // che invece gli e' stato imposto.
        advised: needs[role] === auto[role],
      }));
  });

  /**
   * I TRE SET DI NUMERI, e le loro parole sono quelle sue («default», «scorso», «trend»).
   *
   * In codice si chiamano `engine`, `last` e `trend`, perche' un identificatore che dice «default» non
   * dice quale dei tre e' - e il giorno che ne e' arrivato un terzo, che e' oggi, il primo avrebbe
   * smesso di esserlo.
   *
   * E L'ETICHETTA NOMINA LA STAGIONE invece di dire «scorsa»: «l'anno scorso» dipende da quando lo si
   * legge, `2025-26` no, ed e' il pacchetto a dirlo. Sta qui e non in un tooltip perche' quel tooltip
   * copriva le voci che doveva spiegare (vedi il template), e perche' un'etichetta si legge sempre
   * mentre un pannello bisogna andarselo a cercare. Finche' il file non e' arrivato resta «scorso»
   * secco, che e' la stessa ignoranza che le righe stampano col trattino.
   */
  protected readonly statSets = computed<{ value: RowStats; label: string }[]>(() => {
    const season = this.store.lastSeasonLabel();
    return [
      { value: 'engine', label: 'default' },
      { value: 'last', label: season ? `scorso (${season})` : 'scorso' },
      // L'ETICHETTA NOMINA LA FINESTRA e la legge dalla costante invece di riscriverne il numero: il
      // giorno che le caselle diventano tre o cinque, una voce che dicesse ancora «ultime 4» sarebbe
      // una frase falsa accanto alle celle che la smentiscono.
      { value: 'trend', label: `trend (ultime ${ROW_TREND_MATCHES})` },
    ];
  });

  protected readonly slotViews: { value: SlotView; label: string; hint: string }[] = [
    {
      value: 'market',
      label: 'slot mercato',
      hint: 'I dieci uomini che la stanza prezza uguale: uno slot è un rango per FVM diviso il numero di rose, ed è la griglia su cui la scala delle offerte è stata misurata. Dentro il blocco si ordina per valore atteso.',
    },
    {
      value: 'mine',
      label: 'slot personali',
      hint: 'Gli stessi uomini, ripartiti per la MIA max offerta: D1 diventa i dieci difensori che pagherei di più. I tetti non si ricalcolano sulla nuova griglia: restano quelli misurati sullo slot di mercato, che la card continua a nominare.',
    },
  ];

  /**
   * La frase della lente: cosa ha acceso, quanto ne vede la plancia e come si spegne.
   *
   * La compone la vista e non lo store perché è una frase sull'INTERFACCIA - «le altre righe sono al
   * 30%» non è un fatto sull'asta - mentre i due numeri che cita vengono dallo store, che è l'unico
   * a saperli.
   */
  protected readonly lensNote = computed(() => {
    const lens = this.store.activeTeam();
    const count = this.store.activeCount();
    if (!lens || !count) return '';
    const tail =
      count.bought === count.drawn
        ? ''
        : ` Gli altri ${count.bought - count.drawn} non sono disegnati: sono della coda, o rientrano ` +
          'troppo tardi per valere un posto in rosa.';
    return (
      `Stai guardando ${lens.label}: i suoi ${count.drawn} acquisti sono in chiaro sulla plancia e ` +
      `tutto il resto è al 30%, senza eccezioni.${tail} ` +
      'Clicca la crocetta o la sua card per spegnere.'
    );
  });

  /**
   * I due numeri della lente come UNA stringa: quante righe accende e, quando differiscono, quante ne
   * ha comprate in tutto. In una funzione e non in due interpolamenti perché il template avrebbe messo
   * uno spazio in mezzo alla frazione - lo ha letto il banco.
   */
  protected lensCount(count: { drawn: number; bought: number }): string {
    return count.bought === count.drawn ? String(count.drawn) : `${count.drawn}/${count.bought}`;
  }

  protected readonly myMissing = computed(
    () => this.store.teams().find((team) => team.me)?.missing ?? [],
  );

  protected readonly room = computed(() => this.store.me()?.budgetLeft ?? this.store.budget());

  protected readonly urnLeft = computed(() =>
    this.store.blocks().reduce((sum, block) => sum + block.left, 0),
  );

  /**
   * Se il doppio click su una rosa può assegnare qualcosa: un tavolo nostro, e un nome in asta.
   *
   * Decide solo quello che il tooltip PROMETTE. Il gesto arriva comunque allo store, che è l'unico a
   * sapere perché un'assegnazione non si può fare (reparto pieno, borsa corta, asta vera) e lo scrive
   * a schermo - una card che si mangia un doppio click in silenzio è indistinguibile da una rotta.
   */
  protected readonly canAssign = computed(() => this.feed.demo() && !!this.store.lot());

  constructor() {
    // IL TEMPLATE SI RICORDA IN UNA VARIABILE invece di rileggerlo dalla query alla distruzione, e la
    // ragione NON e' quella che avevo scritto: sospettavo che `viewChild` rispondesse `undefined`
    // dentro `onDestroy` - nel qual caso `clear(null)` non avrebbe mai corrisposto e i tasti della
    // plancia sarebbero rimasti nella scatola su ogni pagina dopo - e la controprova dice di no. Con
    // quella forma rimessa, `e2e-nav` legge lo stesso [Opzioni] sui Calciatori: oggi la query risponde
    // ancora. La variabile resta perche' cosi' la pulizia non DIPENDE dall'ordine di smontaggio di
    // Angular, che e' un dettaglio del framework e non una cosa che questo file possa asserire - ma
    // e' una cintura, non la cura di un difetto misurato, e dirlo e' il punto.
    const actions = inject(PageActions);
    let mine: TemplateRef<unknown> | null = null;
    effect(() => {
      mine = this.actions() ?? null;
      actions.set(mine);
    });
    inject(DestroyRef).onDestroy(() => actions.clear(mine));

    // The board opens on a table, never on a code field: `startDemo` is a no-op when one is already up,
    // so coming back to the page does not throw away an auction in progress.
    //
    // ...E PRIMA DELLA FINZIONE VIENE L'ASTA VERA (`store.open`): se questo browser stava seguendo una
    // sessione, un refresh la riprende invece di aprirci sopra il tavolo inventato. Fino al 24/09/2026
    // questa pagina chiamava `startDemo` e basta - la regola esisteva su `/auction` e non era stata
    // ereditata - quindi ogni ricaricamento costava un collegamento a mano.
    //
    // E IL TAVOLO APRE VUOTO (sua istruzione, 23/09/2026: «di default non abilitare il tavolo finto»):
    // dieci sedie con le borse piene e nessun acquisto, cioe' un'asta al minuto zero. `?fixture=played`
    // ne chiede uno GIOCATO, ed e' quello su cui i banchi misurano - la lente, la colonna del prezzo
    // pagato e l'azzeramento vivono sulle righe di chi un padrone ce l'ha, e su un tavolo vuoto non ce
    // ne sono. Letto dall'INDIRIZZO perche' e' cio' di cui la pagina parla (`core/view-state.ts`), e
    // una volta sola: cambiare fixture a meta' asta butterebbe via quello che c'e' scritto.
    const played = inject(ActivatedRoute).snapshot.queryParamMap.get('fixture') === 'played';
    void this.store.open(played ? PLAYED_PROGRESS : undefined);
  }

  /**
   * IL CLICK APRE LA CARD, e nient'altro (istruzione dell'operatore, 04/09/2026).
   *
   * Prima nominava il LOTTO per un uomo di movimento e apriva gli accoppiamenti per un portiere - due
   * gesti diversi sullo stesso click, che era già una sua correzione del 03/09 («cliccare non deve
   * mettere il calciatore in asta»). Adesso il click fa una cosa sola per tutti e le altre due sono
   * BOTTONI dentro la card: nominare il lotto, e per un portiere gli abbinamenti. Un gesto che fa due
   * cose diverse a seconda del ruolo è un gesto che va imparato; un gesto che apre una card no.
   */
  protected onPick(man: BoardMan): void {
    this.store.openCard(man.id);
  }

  /**
   * IL DOPPIO CLICK SU UNA ROSA LE ASSEGNA IL LOTTO (sua richiesta, 04/09/2026).
   *
   * È l'unico fatto che la plancia non può ricavarsi da sé quando non è collegata: chi si è preso il
   * nome estratto. Il prezzo è quello della riga del lotto, dove lui lo tiene aggiornato mentre i
   * rilanci salgono, e lo store rifiuta - dicendolo - un acquisto che il regolamento non permette.
   */
  protected onAssign(teamId: number): void {
    this.store.award(teamId);
  }

  /**
   * NOMINARE IL LOTTO dalla card, e chiuderla: e' un gesto SOLO della plancia.
   *
   * Sta nella pagina e non nella card perche' la card e' comune alla Strategia, dove un'asta in corso
   * non c'e' - un bottone «è il lotto in asta» su una pagina che si prepara prima di sedersi sarebbe
   * un'azione senza un tavolo su cui agire.
   */
  protected nameLot(id: number): void {
    // La card si chiude solo se il lotto e' stato davvero nominato: chiuderla su un rifiuto
    // nasconderebbe insieme alla card la ragione, che lo store scrive nell'avviso della pagina.
    if (this.store.nameLot(id)) this.store.closeCard(playerCard(id));
  }

  /**
   * IL DOPPIO CLICK SU UNA RIGA METTE QUEL NOME IN ASTA (sua istruzione, 23/09/2026), e NON apre la card.
   *
   * Il singolo click continua ad aprirla: i due gesti convivono perche' l'apertura ASPETTA un quarto di
   * secondo e il doppio click la annulla - la stessa forma, e la stessa costante, dei due gesti sulla
   * card di una rosa (04/09/2026). Filtrare il solo `detail > 1` non basta: un doppio click emette PRIMA
   * un click con `detail` 1 come tutti gli altri, quindi la card si aprirebbe lo stesso.
   *
   * Lo store rifiuta - dicendolo - un nome che ha gia' un padrone: il lotto in asta e' uno che nessuno
   * ha ancora preso, e un gesto che non fa niente in silenzio e' indistinguibile da un gesto rotto.
   */
  protected onName(man: BoardMan): void {
    this.store.nameLot(man.id);
  }
}
