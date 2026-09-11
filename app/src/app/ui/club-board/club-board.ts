import { DecimalPipe } from '@angular/common';
import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Board, BoardMan } from '../../core/bundle';
import {
  OnTable,
  PITCH_CLAIM_FLOOR,
  PitchLine,
  PitchMan,
  disagreementHint,
  pitchOf,
  shapesOf,
} from '../../core/club-eleven';
import { overallTone } from '../../core/player-ratings';
import { BOARD_EFFECT, BOARD_EFFECT_LABEL } from '../../core/player-rulings';
import { TITOLARITA_SHORT, Titolarita } from '../../core/titolarita';
import { stored } from '../../core/view-state';
import { PlayerFlags } from '../player-flags/player-flags';
import { RoleBadge } from '../role-badge/role-badge';
import { RoleSet } from '../role-set/role-set';
import { RulingDot } from '../ruling-dot/ruling-dot';

/** What each drawn line is called, in the language of the pitch. */
const LINE_LABEL: Record<PitchLine, string> = {
  A: 'attacco',
  T: 'trequarti',
  M: 'centrocampo',
  D: 'difesa',
  P: 'porta',
};

/** Nothing known: the honest default for a caller that has no sheet and no table in hand. */
const NOTHING: ReadonlyMap<number, number | null> = new Map();
const NO_TABLE: ReadonlyMap<number, OnTable> = new Map();
const NO_RULINGS: ReadonlyMap<number, Titolarita> = new Map();

/**
 * IL CAMPETTO DI UNA SQUADRA VERA - uno, per tutte le schermate che lo mostrano.
 *
 * «Il campetto di una squadra reale deve essere sempre uguale sia nella schermata dell'asta che in quello
 * delle squadre» (operatore, 18/08/2026): fino a ieri erano DUE componenti con due template che si
 * assomigliavano, e due copie di una carta finiscono sempre per dire due cose - è lo stesso motivo per cui
 * l'undici lo disegna il toolkit e non l'app. Quindi qui c'è il disegno, e le due viste passano soltanto
 * quello che sanno loro: la vista Squadre niente, il pannello d'asta chi è già stato preso.
 *
 * Cosa mostra un ITEM, che è un POSTO del modulo e non un uomo (sua richiesta dello stesso giorno): il
 * ruolo reale del posto, piccolo, e sotto i calciatori in ballottaggio per quel posto - il titolare per
 * primo - ognuno col suo ruolo di listone, le sue icone, il suo Overall 0-99 e i minuti che ci si aspetta
 * da lui in una partita del club. Un uomo compare in UN posto solo (`oneItemEach`) e un rivale sotto
 * `PITCH_CLAIM_FLOOR` non compare affatto: le due regole stanno in `core/club-eleven.ts` con le misure
 * che le hanno scelte, perché sono scelte di visualizzazione e nessun gate le possiede.
 */
@Component({
  selector: 'ui-club-board',
  templateUrl: './club-board.html',
  imports: [
    DecimalPipe, NzEmptyModule, NzTooltipModule, PlayerFlags, RoleBadge, RoleSet,
    RulingDot,
  ],
  host: { class: 'block' },
})
export class ClubBoard {
  readonly board = input.required<Board | null>();
  /** True quando NESSUN foglio della piattaforma porta le board: è una frase diversa da «non questo club». */
  readonly noBoards = input(false);
  /**
   * L'OVERALL 0-99 per `fc_id`, che è il numero accanto a ogni nome.
   *
   * È un INPUT e non una lettura di questo componente per la stessa ragione per cui la board lo è: quale
   * listone e quale foglio quel numero descriva lo sa solo il chiamante, e un 0-99 preso da un'altra pool
   * sarebbe un rango di un'altra domanda.
   */
  readonly overall = input<ReadonlyMap<number, number | null>>(NOTHING);
  /** La quota di calendario che il MOTORE gli prevede, per il marchio del disaccordo. */
  readonly expectedShares = input<ReadonlyMap<number, number | null>>(NOTHING);
  /** Quello che solo un tavolo sa: chi è già stato preso, cosa chiede, se è in questo listone. */
  readonly table = input<ReadonlyMap<number, OnTable>>(NO_TABLE);
  /**
   * COME SI LEGGE IL DETTAGLIO DI UN UOMO, e sono due frasi diverse su due schermate diverse.
   *
   * `card`: il click apre la CARD del calciatore, quella di `ui/player-card` - la stessa della plancia e
   * della Strategia (richiesta dell'operatore per la vista Squadre, 06/09/2026: «togli il tooltip dai
   * calciatori sul campetto e metti al click l'apertura della card dettaglio»). `tooltip`: la vecchia
   * carta all'hover, che è quello che il pannello d'asta ha oggi.
   *
   * È un INTERRUTTORE DICHIARATO e non un comportamento indovinato: la card la costruisce la PAGINA,
   * perché i numeri di un uomo dipendono dal foglio che quella pagina sta leggendo, e una schermata che
   * non la sa costruire non può restare senza nessun dettaglio. Quindi la ragione sta scritta a ognuno
   * dei due punti di chiamata - la stessa forma di `extract_boards(apply_rulings=…)` nel toolkit, dove
   * una funzione sola serve due chiamanti con bisogni opposti.
   */
  readonly detail = input<'tooltip' | 'card'>('tooltip');
  /**
   * LE DRITTE DELL'OPERATORE sugli uomini di QUESTA rosa (`core/player-rulings.ts`).
   *
   * Un INPUT come la board e l'Overall: quale stagione e quale listone si stia guardando lo sa la
   * pagina. La mappa e' quella della ROSA e non del listone intero, ed e' quello che permette di dire
   * quante dichiarazioni il campetto non e' riuscito a disegnare - un uomo che il toolkit non mette in
   * discussione da nessuna parte non ha un posto in cui entrare senza inventarlo.
   */
  readonly ruled = input<ReadonlyMap<number, Titolarita>>(NO_RULINGS);
  /** Chi è stato cliccato, per `fc_id`: la pagina decide cosa farne (aprire la sua card). */
  readonly pick = output<number>();

  protected readonly label = LINE_LABEL;

  /**
   * QUALE MODULO è disegnato: quello scelto dal pannello, o un altro fra quelli che il toolkit manda.
   *
   * `linkedSignal` perché la scelta appartiene al CLUB che si sta guardando: cambiando squadra torna al
   * modulo del modello, invece di restare su una forma che apparteneva a un'altra board.
   */
  protected readonly shape = linkedSignal<Board | null, string | null>({
    source: () => this.board(),
    computation: () => null,
  });

  /**
   * RUOLI DI LISTONE O RUOLI CLASSIC accanto ai nomi (interruttore in fondo al campetto, richiesta
   * dell'operatore del 18/08/2026). Ricordato come le altre preferenze di lettura: è come si legge, non
   * cosa si guarda, quindi vale in tutt'e due le schermate e sopravvive a un refresh.
   */
  protected readonly roleKind = stored<'mantra' | 'classic'>(
    'board.roles', 'mantra', ['mantra', 'classic'],
  );

  /** I moduli fra cui si può passare, il disegnato compreso: uno solo = niente tastini. */
  protected readonly shapes = computed(() => shapesOf(this.board()));

  protected readonly pitch = computed(() => {
    const known = this.table();
    const shares = this.expectedShares();
    const worth = this.overall();
    const resolve = (man: BoardMan): OnTable => {
      const id = man.fc_id;
      const live = id == null ? undefined : known.get(id);
      return {
        taken: live?.taken ?? false,
        price: live?.price ?? null,
        // Fuori da un tavolo nessuno è «non nel listone»: la vista Squadre descrive, non compra.
        onTable: live?.onTable ?? true,
        value99: live?.value99 ?? null,
        overall: id == null ? null : (worth.get(id) ?? null),
        expectedShare: id == null ? null : (shares.get(id) ?? null),
      };
    };
    const declared = this.ruled();
    return pitchOf(
      this.board(),
      resolve,
      this.shape(),
      declared.size ? (fcId) => declared.get(fcId) ?? null : undefined,
    );
  });

  /**
   * QUANTE DRITTE IL CAMPETTO NON HA POTUTO DISEGNARE, in una frase - o vuota se le ha disegnate tutte.
   *
   * Un uomo entra nell'undici solo dai candidati che il toolkit ha scritto per un posto: chi non e' ne'
   * titolare ne' ballottaggio di nessuna maglia non ha un posto in cui entrare, e metterlo da qualche
   * parte vorrebbe dire calcolare qui un undici di un club vero. La sua dritta vale comunque sui NUMERI
   * (presenze attese, surplus, SWING) e il disegno lo aggiorna la prossima costruzione del foglio, che
   * ha in mano la rosa intera. Un filtro silenzioso e' un filtro che inganna, quindi si dice: e' la
   * stessa regola dei ballottaggi non disegnati qui sopra.
   */
  protected readonly undrawn = computed(() => {
    const declared = this.ruled();
    const drawn = this.pitch();
    if (!declared.size || !drawn) return '';
    const seen = new Set<number>();
    for (const row of drawn.rows) {
      for (const man of row.men) {
        if (man.fcId != null) seen.add(man.fcId);
        for (const rival of man.duels) if (rival.fcId != null) seen.add(rival.fcId);
      }
    }
    const missing = [...declared.keys()].filter((fcId) => !seen.has(fcId)).length;
    if (!missing) return '';
    return `${missing === 1 ? 'Una dritta' : `${missing} dritte`} non disegnabile qui: la board non `
      + 'li mette in nessun posto. I numeri li seguono comunque.';
  });

  /** Quanti degli undici disegnati sono già stati presi: zero fuori da un tavolo. */
  protected readonly taken = computed(() => this.pitch()?.taken ?? 0);

  protected choose(shape: string): void {
    this.shape.set(shape === (this.board()?.board_shape ?? null) ? null : shape);
  }

  protected shows(shape: string): boolean {
    const chosen = this.shape();
    return chosen == null ? shape === (this.board()?.board_shape ?? this.pitch()?.module) : chosen === shape;
  }

  /** I candidati di un posto: il titolare e i suoi ballottaggi, che sono già filtrati e deduplicati. */
  protected candidates(man: PitchMan): PitchMan[] {
    return [man, ...man.duels];
  }

  /** I ruoli da stampare accanto al nome, secondo l'interruttore. Vuoto = il listone non lo dice. */
  protected rolesOf(man: PitchMan): string[] {
    if (this.roleKind() === 'classic') return man.classic ? [man.classic] : [];
    return man.mantra;
  }

  /**
   * IL RUOLO REALE DEL POSTO, che è la prima riga di un item.
   *
   * È il marcatore che il pannello ha dato al TITOLARE di quel posto (`Td`, `Dc`, `Pc`), cioè il mestiere
   * che quel posto chiede - non il ruolo di un uomo: i ballottaggi stanno sotto proprio perché si giocano
   * quello stesso posto.
   */
  protected place(man: PitchMan): string | null {
    return man.badge;
  }

  /**
   * Il colore del pallino dell'overall.
   *
   * Le bande stanno dove sta l'overall (`core/player-ratings.ts`) e non qui: il campetto lo DISEGNA, non
   * decide cosa sia un buon numero - e un secondo posto dove deciderlo sarebbe il secondo giudizio sullo
   * stesso uomo che questo componente esiste per evitare.
   */
  protected tone(overall: number | null): string {
    return overallTone(overall);
  }

  /** La sigla della dritta accanto al nome: la stessa della tabella, o due vocabolari per una parola. */
  protected ruledShort(man: PitchMan): string | null {
    return man.ruled ? TITOLARITA_SHORT[man.ruled] : null;
  }

  /** Tre parole: chi l'ha detto e cosa fa qui. Il perche' sta nel codice, non in un tooltip. */
  protected ruledHint(man: PitchMan): string {
    return man.ruled ? `dritta tua: ${man.ruled} · ${BOARD_EFFECT_LABEL[BOARD_EFFECT[man.ruled]]}` : '';
  }

  /** Il marchio del disaccordo fra board e motore, che viaggia col nome dovunque sia disegnato. */
  protected disputed(man: PitchMan): string | null {
    return disagreementHint(man);
  }

  /**
   * PERCHÉ QUELL'UOMO È SCESO A «BALLOTTAGGIO», o null se non è sceso.
   *
   * La regola dell'operatore (10/09/2026) agisce solo sulla board dell'ULTIMO PERIODO e può togliere tre
   * gradini a un uomo che sta giocando: senza questa frase la riga sembra un ordinamento rotto, perché
   * mostra `ballottaggio` accanto a una quota alta. La sua stessa frase, detta come una spiegazione e
   * non come un'accusa - il posto non è suo, il che non toglie niente a quello che sta facendo.
   */
  /**
   * SE LA FINESTRA CORTA NON L'HA VISTO GIOCARE, in una frase - o null.
   *
   * Su un campetto che si chiama «ultimo periodo» questo è l'unico fatto che il disegno da solo non
   * direbbe: la sua quota lì viene dalla STAGIONE, perché una finestra vuota restituisce il prior
   * intatto, quindi senza la frase lo si legge come uno che quel periodo l'ha giocato. Sono 16 dei 220
   * disegnati sul foglio Serie A del 10/09/2026 - pochi, e sono proprio quelli su cui la parola
   * «ultimo periodo» promette di più di quanto sa.
   *
   * NIENTE dove i due numeri non ci sono (una board più vecchia delle colonne): quello è ignoto, e un
   * ignoto non si annuncia come un'assenza.
   */
  protected unseen(man: PitchMan): string | null {
    // ...e su chi oggi non può giocare TACE: la sua finestra è vuota per la ragione che il marchio
    // accanto già dice, e due simboli per un fatto solo occupano il posto di un fatto diverso (la
    // regola di `pressSaysTheSame`, 04/09/2026, incontrata su un altro canale).
    if (man.outToday) return null;
    if (man.recentPlayed == null || man.recentAvailable == null || man.recentPlayed > 0) return null;
    return man.recentAvailable > 0
      ? `Nelle ultime partite del suo club non è mai sceso in campo, pur essendo disponibile in `
        + `${man.recentAvailable}. Il numero qui accanto viene quindi dalla stagione e non da questa `
        + 'finestra: la lettura corta, senza partite sue, restituisce il prior intatto.'
      : 'Nelle ultime partite del suo club non era disponibile in nessuna, quindi questa finestra non '
        + 'dice niente su di lui: il numero qui accanto è quello della stagione.';
  }

  /**
   * OGGI NON PUÒ GIOCARE, ed è per questo che è disegnato - o null (richiesta dell'operatore,
   * 11/09/2026: «nelle formazioni Ultimo Periodo ... visualizza i calciatori che secondo l'algoritmo
   * dovrebbero essere in ballottaggio ma sono infortunati»).
   *
   * È il solo marchio del campetto che spiega una PRESENZA invece di una parola: questa board esclude
   * gli indisponibili dall'undici, quindi un uomo così è in lista soltanto perché quella maglia se la
   * giocherebbe. Senza la frase la sua riga si legge come un rivale qualunque con una quota alta - e la
   * quota è quella di STAGIONE, perché la finestra corta di un infortunato è vuota.
   *
   * Letto dalla board e mai dedotto da `injuries`: `ui-flags` risponde a un'altra domanda e solo per gli
   * stop di 45+ giorni o per una voce di stampa di tre giorni - misurato sul foglio del 10/09/2026,
   * **34 di questi 67 uomini non portano nessuna icona**, cioè metà sarebbero disegnati come chiunque
   * altro.
   */
  protected sidelined(man: PitchMan): string | null {
    if (!man.outToday) return null;
    return 'Oggi non è disponibile, e su questo campetto è in lista solo per questo: la formazione '
      + "dell'ultimo periodo gli indisponibili non li schiera, quindi non contende la maglia adesso - "
      + 'ma quando rientra quel posto è fra i suoi. La percentuale qui accanto è quella di stagione: la '
      + 'finestra corta, senza partite sue, restituisce il prior intatto.';
  }

  protected returning(man: PitchMan): string | null {
    if (!man.ownerReturning) return null;
    return 'Sta giocando lui, ma quel posto è di un altro: la formazione tipo a lungo periodo ci disegna '
      + 'un compagno che oggi è indisponibile e rientra a breve. Per questo la parola è «ballottaggio» '
      + 'anche se le ultime partite le ha fatte tutte — è una regola dichiarata, non una misura su di lui.';
  }

  /**
   * SE IL SUO NOME È UN BERSAGLIO, e ci vogliono tutt'e due le condizioni.
   *
   * La card la chiede la pagina (`detail`), e un uomo che la board non riesce a identificare non ne ha
   * una: senza `fc_id` non ci sono né i suoi numeri né le sue partite - «vuoto = ignoto», applicato a un
   * gesto. Un nome che sembra cliccabile e non fa niente è peggio di un nome che non lo sembra, quindi il
   * cursore e il `role` seguono questa risposta e non l'interruttore da solo.
   */
  protected clickable(man: PitchMan): boolean {
    return this.detail() === 'card' && man.fcId != null;
  }

  protected onPick(man: PitchMan): void {
    if (this.clickable(man)) this.pick.emit(man.fcId as number);
  }

  /**
   * Quanti ballottaggi il campetto non mostra, in una frase - o vuota se non ne ha nascosto nessuno.
   *
   * Un filtro silenzioso è un filtro che inganna: è la stessa regola del conteggio delle righe che arrivano
   * scorrendo, e le due ragioni si dicono separate perché sono due fatti diversi.
   */
  protected readonly hidden = computed(() => {
    const counted = this.pitch()?.hiddenDuels;
    if (!counted || (!counted.floor && !counted.duplicate)) return '';
    const bits: string[] = [];
    if (counted.floor) {
      bits.push(`${counted.floor} sotto il ${Math.round(PITCH_CLAIM_FLOOR * 100)}% da titolare`);
    }
    if (counted.duplicate) bits.push(`${counted.duplicate} già mostrati su un altro posto`);
    return `Ballottaggi non disegnati: ${bits.join(' · ')}.`;
  });
}
