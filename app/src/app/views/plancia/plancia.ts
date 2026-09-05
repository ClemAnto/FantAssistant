import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { AuctionFeed } from '../../core/auction-feed';
import { ROLES, SlotView } from '../../core/plancia';
import { BoardMan, PlanciaStore } from '../../core/plancia-store';
import { FlagMenu } from '../../ui/flag-menu/flag-menu';
import { PlayerCard } from '../../ui/player-card/player-card';
import { LiveConnect } from '../../ui/live-connect/live-connect';
import { APP_VERSION } from '../../version';
import { KeeperPairs } from './keeper-pairs/keeper-pairs';
import { LotCard } from './lot-card/lot-card';
import { SlotMatrix } from './slot-matrix/slot-matrix';
import { TeamGrid } from './team-grid/team-grid';

/**
 * `/plancia` - the assistant of a RANDOM-EXTRACTION raise auction.
 *
 * The page opens on an invented table with the standard league settings and connects to a real session
 * only when the operator presses the button (his decision of 03/09/2026, which holds for `/auction`
 * too). Three zones and a fixed regulation bar, laid out the way he asked on the same day: the LOT is a
 * ROW under the header, the ten participants are a COLUMN of cards on the right, and everything else is
 * the board - which needs the room, because all 250 rows are on screen at once. The page itself does
 * NOT scroll.
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
    RouterLink,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzInputNumberModule,
    NzPopconfirmModule,
    NzRadioModule,
    NzTooltipModule,
    FlagMenu,
    KeeperPairs,
    LiveConnect,
    LotCard,
    PlayerCard,
    SlotMatrix,
    TeamGrid,
  ],
})
export class Plancia {
  protected readonly store = inject(PlanciaStore);
  protected readonly feed = inject(AuctionFeed);

  protected readonly appVersion = APP_VERSION;
  protected readonly roles = ROLES;
  protected readonly connecting = signal(false);

  /**
   * I DUE TAGLI, con la loro frase: il bottone dice cosa cambia, non solo che qualcosa cambia.
   *
   * Sua richiesta del 04/09/2026. La parola «slot» è quella del gioco (sua indicazione del 03/09,
   * come `titolarissimo` e `por`), quindi i due nomi sono i suoi e non «fasce» o «blocchi».
   */
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

  /** The regulation, always on screen: it is what decides every number under it. */
  protected readonly rules = computed(() => {
    const slots = this.store.slots();
    return {
      sheet: this.store.sheet(),
      teams: this.store.teamsCount(),
      budget: this.store.budget(),
      roster: ROLES.map((role) => slots[role]).join('·'),
    };
  });

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
    // The board opens on a table, never on a code field: `startDemo` is a no-op when one is already up,
    // so coming back to the page does not throw away an auction in progress.
    void this.store.startDemo();
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
    this.store.setLot(id);
    this.store.closeCard(id);
  }
}
