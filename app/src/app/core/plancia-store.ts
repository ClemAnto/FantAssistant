/**
 * The state behind `/plancia`: the slot board of a random-extraction auction.
 *
 * Two sources, one shape. By DEFAULT the board opens on an invented table with the standard league
 * settings (`plancia-demo.ts`), and connecting to a real fanta-asta session is something the operator
 * ASKS for with a button - his decision of 03/09/2026, and it holds for the draft panel too. The rest
 * of this file cannot tell the two apart, which is the point: one set of numbers, and a banner that
 * says which table they describe.
 *
 * CHI E' IN ASTA LO PUBBLICA IL TAVOLO, e fino al 24/09/2026 questo file diceva il contrario.
 *
 * Diceva che «nessun nodo che nomini il lotto e' mai stato osservato», ed era vero alla lettera e falso
 * come misura: le due sole sessioni mai lette (09/08/2026) portano `marketType: 1` - erano DRAFT, dove
 * un lotto non esiste, c'e' un turno. Nessuno aveva mai guardato una sessione a RILANCI. La prima
 * guardata (`FA-xxx-xxx`, su segnalazione dell'operatore mentre la giocava) porta
 * `state.selectedPlayerId` alla prima lettura, verificato contro quello che lui vedeva a schermo.
 *
 * Quindi il nome in asta e' un'OSSERVAZIONE e non una dichiarazione, e batte quella messa a mano
 * (`plancia.lotUp`); il nome a mano resta per il tavolo inventato e per quando il tavolo tace.
 * `app/scripts/probe-live-session.mjs` e' l'arnese che ha risposto, e resta per la prossima volta.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { AuctionFeed, AuctionPlayer, Zone } from './auction-feed';
import { demoPlayers } from './auction-demo';
import { EngineNumbers, ValuationBasis, valuationOf } from './auction-value';
import { Bundle, EngineSheetEntry } from './bundle';
import { ValuationStore } from './valuation-store';
import { ExpectedPlay } from './expected-play';
import { PlayerRatingsStore } from './player-ratings-store';
import { PlayerStatus } from './player-status';
import { engineNumbersFrom } from './engine-sheet';
import { seasonRoundsOf } from './season-scale';
import { GlobalOptions } from './global-options';
import {
  CardKey,
  CardMan,
  CardStack,
  clubCard,
  clubOfCard,
  playerCard,
  playerOfCard,
} from './player-card';
import {
  CalendarBook,
  CalendarFile,
  EASY_ALREADY_SHARE,
  GridCell,
  LeagueCalendar,
  PairSuggestion,
  aloneCover,
  calendarBookFrom,
  cleanSheetBaseline,
  cleanSheetOutlook,
  coverGrid,
  rankPairs,
} from './keeper-pairs';
import {
  Alternative,
  EDGE_BASE,
  LotAdvice,
  MIN_PLAY_SHARE,
  OfferBand,
  PlanciaMan,
  PlanciaMap,
  Role,
  ROLES,
  RowStats,
  SameClubHeld,
  SlotBlock,
  adviseLot,
  adviseTail,
  alternativeFor,
  buildMap,
  lotUp,
  bidUp,
  offerBand,
  regroupByCoin,
  sameClubDiscount,
  tailBand,
  SlotView,
} from './plancia';
import { DEMO_PROGRESS, STANDARD_LEAGUE, buildRandomAuction, roleOf } from './plancia-demo';
import { PlayerRulings, rungShares } from './player-rulings';
import { Platform } from './players-store';
import { SeasonLine, seasonLines } from './season-line';
import { needOf, nextGoal, serves, GOALS, Goal, Owned, TOP_WORDS } from './focus';
import { withRowAt } from './manual-order';
import { stored, storedFlag, storedJson } from './view-state';

/**
 * QUANTO DEVE GIOCARE UN UOMO PERCHE' IL FOCUS LO CONTI COME COPERTURA: 25 giornate su 38, sua cifra.
 *
 * VENTICINQUE E NON VENTISEI, e la differenza non e' un arrotondamento: il 26 e' il confine fra
 * `scommessa` e `operaio` sulla scala delle categorie, dove cade nel vuoto fra i suoi nomi (Diao 25,8
 * contro Davis 27,3). Qui la domanda e' un'altra - «questo uomo gioca sempre?» - e la sua cifra e' 25.
 * Due domande vicine con due numeri vicini sono esattamente il posto in cui questo repository ha gia'
 * sbagliato tre volte prendendone uno in prestito per l'altra.
 *
 * LA PRIMA VERSIONE USAVA 0,35 - `minAvailability`, la quota che la pagina delle buste chiede per dire
 * che un uomo regge un posto - E IL BANCO L'HA BOCCIATA GUARDANDO LO SCHERMO: a rosa vuota tutti e
 * quattro i reparti sono scoperti, e con quella soglia il focus accendeva 239 righe su 271, cioe' non
 * restringeva niente. Un focus che mostra tutto e' un focus spento con un tasto acceso.
 *
 * La soglia giusta e' quella del PAVIMENTO DEGLI OPERAI (`BET_CEILING_SHARE`, 26 su 38): chi copre un
 * posto e' chi lo regge tutte le settimane, ed e' la stessa misura dall'altro lato - un confine, un
 * numero. 0,35 risponde a un'altra domanda («vale la pena metterlo in una busta?»), e una soglia presa
 * in prestito da un'altra domanda e' un difetto che questo repository ha gia' pagato tre volte.
 */
const MIN_FOCUS_SHARE = 25 / 38;

/** ...e la quota che «gioca sempre» chiede, che e' la sua: Pa >= 25, tenuta come quota del calendario. */
const FOCUS_RULES = { matchdays: 0, coverShare: MIN_FOCUS_SHARE };
import { sheetBlendsSeen, swingOf } from './swing';

/** The four letters of the board's lines, from the two alphabets the feed splits the outfield into. */
const ZONE_ROLE: Record<string, Role> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };
const ROLE_ZONE: Record<Role, Zone> = { P: 'gk', D: 'def', C: 'mid', A: 'atk' };

/** A row of the board: the man, and what has happened to him. */
export type ManState = 'urna' | 'mio' | 'altro' | 'asta';

export interface BoardMan extends PlanciaMan {
  state: ManState;
  /** What he was paid, once somebody has him; the max offer while he is still in the urn. */
  price: number | null;
  /**
   * La banda INTERA, che la riga calcola comunque per stamparne il massimo.
   *
   * Tenuta invece di ricalcolata perché la card di un calciatore vuole i due estremi: due chiamate a
   * `offerBand` con due insiemi di parametri sono come un uomo finisce con due prezzi, e questa è la
   * stessa funzione che disegna la riga. `null` dove il foglio non lo prezza o dove è già di qualcuno.
   *
   * E' l'`OfferBand` INTERA e non i due estremi: la banda porta anche PERCHE' e' quella - lo slot su
   * cui il tetto e' stato letto, e se a deciderlo e' stato il tetto dichiarato di una scommessa - e
   * ritagliarla qui obbligherebbe la card a ricalcolare quella ragione, cioe' a darne una seconda.
   */
  band: OfferBand | null;
  /**
   * QUANTO L'OFFERTA E' SCESA PERCHE' DI QUEL CLUB NE HO GIA', 0 quando non ne ho.
   *
   * Sulla riga non c'e' un tooltip (sua istruzione del 03/09: su 250 righe un pannello che si apre
   * passando copre quello che stai leggendo), quindi il fatto si dichiara TINGENDO la cifra che ha
   * cambiato - la max offerta - e la legenda dice cosa vuol dire quella tinta. Marcare il nome
   * sarebbe sbagliato: l'infortunio tinge il nome perche' e' un fatto sull'UOMO, questo e' un fatto
   * sulla MIA rosa e vive sul numero che ne discende.
   */
  sameClubCut: number;
  ownerId: number | null;
  ownerLabel: string | null;
  ownerColour: string | null;
  /**
   * RIPESCATO DALLA CODA: la mappa del mercato lo lasciava sotto l'ultimo slot, ed e' entrato sulla
   * griglia personale al posto di un nome che ho buttato (sua richiesta del 23/09/2026).
   *
   * Un uomo cosi' non ha una BANDA e la sua riga stampa un trattino - `rowMaker` dice perche' - quindi
   * il flag serve a DICHIARARLO nel tooltip del blocco: una riga senza tetto in mezzo a nove che ce
   * l'hanno si legge come un dato mancante, e qui e' invece la cosa piu' onesta che si possa scrivere.
   */
  fromTail?: boolean;
}

export interface BoardBlock extends SlotBlock {
  rows: BoardMan[];
  /** How many of the `teams` men are still in the urn. Zero means exhausted - and that lifts a ceiling. */
  left: number;
  /** True when one of them is mine, which is the only thing a compact block has to say about me. */
  mine: boolean;
  /**
   * La mediana delle MIE max offerte sui suoi uomini: la cifra che l'intestazione mostra sulla griglia
   * personale, dove `medianFvm` non e' piu' una proprieta' del blocco.
   *
   * Sta su tutt'e due le griglie perche' e' vera su tutt'e due - sul mercato dice «quanto pago il medio
   * di questo slot» - e perche' due letture della stessa mediana in due posti sono come un blocco
   * finisce per dichiarare due cifre. `null` dove nessuno dei suoi uomini ha un tetto.
   */
  medianOffer: number | null;
  /**
   * LA MEDIANA DELLA MONETA, che dal 23/09/2026 e' la coordinata su cui la griglia PERSONALE e'
   * tagliata (il surplus: `PlanciaMan.surplus`). E' quella che la sua intestazione stampa, perche'
   * l'intestazione dichiara il taglio - e sul MERCATO e' `null`, dove a tagliare e' il prezzo.
   */
  medianCoin: number | null;
}

/** A participant as the strip draws him: credits, four numbers, and whether he is in on THIS lot. */
export interface BoardTeam {
  id: number;
  label: string;
  colour: string;
  credits: number;
  /** Places still to fill, in P·D·C·A order - four numbers and no four labels. */
  missing: number[];
  me: boolean;
  /** He has a free place in the lot's role AND the credits to reach the band. */
  rival: boolean;
  /** He cannot reach the band at all: an absence, not a danger. */
  out: boolean;
  /**
   * LA ROSA ATTIVA: quella di cui la plancia sta mostrando gli acquisti (sua richiesta, 04/09/2026).
   *
   * Una sola alla volta, perche' la domanda e' «cosa ha preso QUESTO qui»: due rose accese insieme
   * rispondono a una domanda che nessuno ha fatto e spengono il confronto che serve.
   */
  active: boolean;
}

export interface Lot {
  man: BoardMan;
  /**
   * LO SLOT SU CUI IL VERDETTO E' MISURATO, oppure `null` per chi la mappa non disegna.
   *
   * La plancia porta 25 slot da `teams` uomini e sotto l'ultimo c'e' la CODA, che a un'estrazione
   * libera e' dove finisce la maggior parte dei nomi estratti. Prima del 24/09/2026 un uomo della coda
   * non poteva essere un lotto affatto - `lot()` non lo trovava e la riga diceva «nessun calciatore in
   * asta» mentre il tavolo lo aveva sul banco - il che era invisibile finche' il nome lo mettevamo noi
   * cliccando una riga DISEGNATA, ed e' diventato il caso normale il giorno in cui a nominarlo e'
   * stato il tavolo.
   */
  block: BoardBlock | null;
  /** Il suo ruolo, che c'e' sempre: il blocco no. Chi chiede «di che reparto e' il lotto» chiede qui. */
  role: Role;
  /** True quando il nome lo pubblica il TAVOLO e non lo abbiamo messo noi. La riga lo dice. */
  live: boolean;
  /** What the table is at right now. Zero before anybody has bid. */
  price: number;
  /** True quando la cifra la pubblica il TAVOLO e non l'abbiamo battuta noi. La riga lo dice. */
  bidLive: boolean;
  advice: LotAdvice;
  alternative: Alternative | null;
  /** How many blocks below his are already empty - the thing that lifts the ceiling by half. */
  exhaustedBelow: number;
}

@Injectable({ providedIn: 'root' })
export class PlanciaStore {
  private readonly bundle = inject(Bundle);
  private readonly feed = inject(AuctionFeed);
  /**
   * Chi oggi non gioca, dall'unico servizio che lo sa.
   *
   * La plancia non ricalcola quello stato: due definizioni di «è fuori» finirebbero per dare a un uomo
   * due risposte, e la prima volta che qualcuno se ne accorge è a un tavolo.
   */
  private readonly status = inject(PlayerStatus);
  /** Il conto delle giornate che giochera' davvero: uno solo, per ogni pagina. */
  private readonly play = inject(ExpectedPlay);
  /**
   * LA COSTANZA, che e' il secondo termine di SWING e non sta sul foglio: la misura `PlayerRatings`
   * sui voti veri delle sue stagioni, ed e' la stessa lettura che la Strategia mostra col nome `Pas`.
   *
   * Due letture della stessa quota darebbero a un uomo due costanze, e la prima volta che si
   * noterebbe e' su due schermi che dicono due numeri diversi dello stesso nome.
   */
  private readonly ratings = inject(PlayerRatingsStore);
  /**
   * ...e la stagione GIA' GIOCATA, che e' l'altro termine di SWING (R25): la fantamedia che ha tenuto
   * finora e su quante partite. Letta da chi la possiede (`ValuationStore.playedOf`), che e' la stessa
   * lettura che la Strategia mostra: due misure della stessa stagione darebbero a un uomo due medie.
   *
   * Se lo store non e' in casa la miscela non si forma e resta il surplus del foglio: «vuoto = ignoto».
   */
  private readonly valuations = inject(ValuationStore);
  /** Le dritte dichiarate: questa pagina misura per loro quanto vale una parola sul proprio foglio. */
  private readonly rulings = inject(PlayerRulings);
  private readonly options = inject(GlobalOptions);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Which sheet prices the board, so the page can NAME it with its revision. */
  readonly sheet = signal<EngineSheetEntry | null>(null);
  /**
   * Le giornate su cui i numeri di questo foglio sono espressi, dopo il riporto a stagione piena.
   *
   * Questa pagina legge il foglio da se' e non passa da `ValuationStore`, quindi la sua base la
   * dichiara qui: senza, `pv` e surplus sarebbero riportati e il loro denominatore no - due basi
   * sotto un nome solo, che e' l'errore di unita' piu' caro di questo progetto.
   */
  readonly seasonRounds = signal<number | null>(null);

  private readonly numbers = signal<Map<number, EngineNumbers>>(new Map());
  private readonly listone = signal<AuctionPlayer[]>([]);

  /**
   * IL NOME NOMINATO, CON IL TAVOLO SU CUI LO E' STATO - e il lotto vero e' DERIVATO da qui.
   *
   * Perche' non basta un id, e quali due fatti lo cancellano senza che nessuno prema niente, sta per
   * intero su `lotUp`. Qui la conseguenza: `setLot` e' l'unico che scrive, e legge il codice del
   * tavolo nell'istante in cui il nome viene messo in asta.
   *
   * E SOPRAVVIVE A UN REFRESH (sua richiesta, 24/09/2026: «appena la connessione con l'asta-live si
   * attiva, deve essere visibile il calciatore in asta»). Il TAVOLO nella chiave e' cio' che lo rende
   * sicuro da salvare: al ricaricamento il codice della sessione non c'e' ancora, quindi la riga e'
   * vuota finche' lo stream non dice a quale asta siamo - e se nel frattempo quell'uomo e' stato
   * venduto, `lotUp` lo toglie da se'. Un id salvato da solo sarebbe invece un nome che ricompare
   * su qualunque tavolo si apra dopo.
   *
   * IL PREZZO NON SI SALVA, ed e' una decisione che il 24/09/2026 ha smesso di essere un limite: la
   * cifra BATTUTA e' dove la stanza era arrivata due secondi fa e non c'e' modo di sapere se quel
   * momento e' passato, quindi riappare a zero - «nessuno ha ancora offerto», la stessa cosa che
   * dice dopo ogni estrazione. Quella del TAVOLO invece torna da se' appena lo stream riaggancia,
   * perche' non e' una cosa salvata: e' un fatto che il banditore ripubblica (`bidUp`).
   */
  private readonly named = storedJson<{ table: string | null; id: number | null }>(
    'plancia.lot',
    (raw) => {
      const one = raw as { table?: unknown; id?: unknown } | null;
      const table = typeof one?.table === 'string' ? one.table : null;
      const id = typeof one?.id === 'number' ? one.id : null;
      return { table, id };
    },
  );
  /** Chi e' in asta e CHI LO DICE: la definizione sta su `lotUp`, i lettori qui sotto sono due. */
  private readonly upNow = computed(() =>
    lotUp(this.feed.selectedPlayerId(), this.named(), this.feed.code(), this.owners()),
  );
  private readonly lotId = computed(() => this.upNow()?.id ?? null);

  /**
   * LA CIFRA BATTUTA A MANO, che e' l'unica che esiste su un tavolo inventato e il ripiego su uno
   * vero - la casella in cima scrive qui, e nessun altro.
   */
  readonly typedPrice = signal(0);

  /**
   * QUANTO C'E' SUL TAVOLO, e chi lo dice: la definizione sta su `bidUp`, i lettori qui sono tre (il
   * verdetto, la banda e l'assegnazione a mano).
   *
   * Il commento su `named` diceva che il prezzo non si poteva sapere - «la cifra e' dove la stanza
   * era arrivata due secondi fa e non c'e' modo di sapere se quel momento e' passato» - ed era vero
   * di una cifra SALVATA, che invecchia in un `localStorage` mentre l'asta va. Quella dello stream
   * non invecchia: arriva dal banditore, porta il nome dell'uomo a cui si riferisce e si spegne da
   * se' quando il lotto cambia.
   */
  private readonly bid = computed(() =>
    bidUp(this.feed.currentBid(), this.lotId(), this.typedPrice()),
  );
  readonly lotPrice = computed(() => this.bid().value);

  /** True while the table on screen is invented. It is the FEED's state, never a second copy. */
  readonly demo = computed(() => this.feed.demo());
  readonly live = computed(() => this.feed.connected());
  readonly ready = computed(() => this.feed.hasTable() && this.men().length > 0);

  readonly teamsCount = computed(() => this.feed.teams().length || STANDARD_LEAGUE.teams);
  readonly budget = computed(() => this.feed.budget() || STANDARD_LEAGUE.budget);

  /** The roster shape the league declares, in the board's own four letters. */
  readonly slots = computed<Record<Role, number>>(() => {
    const roles = this.feed.league()['roles'] ?? {};
    const read = (zone: Zone, fallback: number) => {
      const value = roles[zone];
      const declared = Array.isArray(value) ? value[0] : value;
      return Number(declared) > 0 ? Number(declared) : fallback;
    };
    return {
      P: read('gk', STANDARD_LEAGUE.slots.P),
      D: read('def', STANDARD_LEAGUE.slots.D),
      C: read('mid', STANDARD_LEAGUE.slots.C),
      A: read('atk', STANDARD_LEAGUE.slots.A),
    };
  });

  /**
   * The listone as the board needs it: the room's price and the engine's expectation on one row.
   *
   * A man his own listone never quoted has no price and therefore no place on the board - pricing him
   * at zero would put a free man nobody could refuse at the top of a slot. A man the SHEET cannot
   * price keeps his place and carries no number: «vuoto = ignoto, mai zero» cuts both ways, and the
   * two absences are different facts.
   */
  private readonly men = computed<PlanciaMan[]>(() => {
    const numbers = this.numbers();
    const book = this.calendar();
    // La media di campionato del +1 a porta inviolata, cacheata per lega: e' il metro del sostituto
    // nel differenziale dello SWING dei portieri, e ricalcolarla per riga sarebbe un giro di
    // settecento partite per ognuno dei trenta portieri.
    const csBase = new Map<LeagueCalendar, number | null>();
    const out: PlanciaMan[] = [];
    for (const player of this.listone()) {
      const role = roleOf(player);
      if (!role || !(player.fvm > 0)) continue;
      const valuation = valuationOf(numbers.get(player.id));
      // LE GIORNATE CHE PERDE, contate sul calendario del SUO club (04/09/2026). Il foglio prezza una
      // stagione intera; chi rientra a novembre non la gioca, quindi le presenze attese e i punti che
      // ne discendono sono ridotti QUI - una volta sola, dove la riga nasce, cosi' l'ordine dentro lo
      // slot, la banda e i due numeri sullo schermo leggono tutti la stessa valutazione.
      // ...E IL «DI PIU'» SOPRA IL FATTO (operatore, 04/09/2026): la finestra dice quello che perde di
      // sicuro, l'assicurazione quello che puo' perdere. Il conto e' UNO per tutta l'app
      // (`expected-play.ts`) e non piu' una moltiplicazione scritta qui: due copie di questa
      // sottrazione darebbero allo stesso uomo due presenze attese sulla plancia e sulla strategia.
      const outlook = this.play.outlook(
        // `default` e non una lettura: questa pagina prezza sempre il foglio `default|classic`, ed e'
        // scritto a due passi da qui. La piattaforma serve alla dritta dell'operatore, la cui
        // conversione in giornate e' misurata sulla popolazione di UN foglio.
        { id: player.id, club: player.club, platform: 'default' },
        { pv: valuation.pv, pvIsEstimate: valuation.basis === 'estimated',
          playShare: numbers.get(player.id)?.titolaritaPlay ?? null,
          titolarita: numbers.get(player.id)?.titolarita ?? null },
        this.seasonRounds(),
      );
      const pv = outlook.expected;
      // La finestra viene da `outlook` e non da una seconda chiamata a `outWindow` accanto: due strade
      // per lo stesso fatto sono come una riga finisce per dirne due versioni.
      const window = outlook.window;
      const points = valuation.fm != null && pv != null ? valuation.fm * pv : null;
      // IL SURPLUS DI QUESTA RIGA: quello del foglio, riscalato sulle giornate che restano come lo
      // sono `points` e `pv`. Una sola valutazione per uomo, che e' quella che lo schermo mostra.
      const engine = numbers.get(player.id);
      const played = this.valuations.playedOf('default', player.id);
      const sheetSurplus = engine?.surplusLeague ?? engine?.estSurplus ?? null;
      const sheetPv = engine?.pv ?? engine?.estPv ?? null;
      const surplus =
        sheetSurplus == null || pv == null || !sheetPv ? sheetSurplus : (sheetSurplus * pv) / sheetPv;
      // IL +1 A PORTA INVIOLATA (solo portieri, opzione di lega): P(porta inviolata) del suo club sul
      // calendario che resta, e la media del campionato come metro del sostituto - il differenziale lo
      // fa `swingOf`, una definizione e due lettori (la Strategia fa lo stesso conto).
      const csCalendar = role === 'P' ? (book?.forClub(player.club) ?? null) : null;
      const csShare = csCalendar ? cleanSheetOutlook(csCalendar, player.club) : null;
      const csMean = csCalendar
        ? (csBase.get(csCalendar) ??
           csBase.set(csCalendar, cleanSheetBaseline(csCalendar)).get(csCalendar)!)
        : null;
      out.push({
        id: player.id,
        name: player.name,
        club: player.club,
        role,
        fvm: player.fvm,
        points,
        pv,
        // Dalla fantamedia e non da `points / pv`: quel rapporto tornerebbe lo stesso numero solo
        // finche' nessuno tocca `points`, e due strade per una cifra e' come un uomo finisce con due
        // valutazioni. Le presenze viaggiano accanto (`pv`), non dentro.
        edge: valuation.fm != null ? valuation.fm - EDGE_BASE : null,
        basis: valuation.basis as ValuationBasis,
        confidence: valuation.confidence,
        out: window,
        // ...e chi oggi non gioca lo si SEGNA e non lo si penalizza (04/09/2026): resta il campo,
        // perche' la card e l'icona lo dicono e il tetto lo demota di un gradino, ma non muove piu'
        // nessuna riga. I due non convivono: dove una data c'e', il numero fa lo stesso lavoro meglio.
        outNow: !window && !!this.status.unavailableNow(player.id),
        // L'INFORTUNATO DI LUNGA DATA, che e' l'inchiostro BARRATO da oggi: uno spell aperto da 45
        // giorni o piu'. Letto dal servizio che decide anche l'icona - un'icona e un inchiostro per
        // una frase sola, quindi un lettore solo.
        longOut: !!this.status.longInjury(player.id),
        // La nota dichiarata, come informazione sulla riga: solo `out_of_squad`, perche' `dispute` e
        // `wants_out` sono stati di una RELAZIONE e chi ci sta dentro si schiera e si compra ancora.
        outOfSquad: this.status.declared().get(player.id)?.kind === 'out_of_squad',
        // LO SWING: il surplus di questa riga in gol di classifica. Il surplus viene dal foglio ed
        // e' riscalato sulle giornate che restano come `points` e `pv`, cosi' la riga porta UNA
        // valutazione sola. Il numero e' una conversione e non una graduatoria nuova: ordina come il
        // surplus, e `core/swing.ts` dice perche' i due termini che lo distinguevano sono stati tolti.
        // Lo SWING: il surplus piu' la costanza, in gol di classifica. La costanza arriva dallo
        // store delle misure e vale `null` finche' non e' atterrato - allora `swingOf` prende la
        // mediana del ruolo, che e' «vuoto = ignoto» e non uno zero.
        // LA MONETA DELLA GRIGLIA PERSONALE (23/09/2026). Gia' calcolato qui sopra e riscalato sulle
        // giornate che restano: si consegna alla riga invece di rifarlo, o un uomo avrebbe due surplus.
        surplus,
        category: engine?.category ?? null,
        swing: swingOf({
          role,
          surplus,
          pv,
          // Lo zero del foglio e il calendario su cui `pv` e surplus vivono: servono alla ribasatura
          // verso il 6 e al «per giornata» — l'unita' dichiarata dall'operatore (07/09/2026).
          replacement: engine?.replacementFm ?? null,
          matchdays: this.seasonRounds(),
          fm: valuation.fm,
          confidence: valuation.confidence,
          steady: this.ratings.ready()
            ? (this.ratings.for('default', player.id)?.steady?.share ?? null)
            : null,
          seasonFm: played?.fm ?? null,
          seasonPlayed: played?.pv ?? null,
          // La plancia prezza sempre il foglio default|classic, e li' dalla revisione 71 la miscela
          // in-season e' su TUTTE le righe - anche quelle di ripiego, che prima la prendevano qui.
          fmBlendsSeen: sheetBlendsSeen('default'),
          // ...e la costanza si paga solo dove la lega paga l'R-Factor (opzione dichiarata).
          rFactor: this.options.league().rFactor,
          // ...e il +1 a porta inviolata solo dove la lega lo paga (opzione dichiarata, 07/09/2026).
          cleanSheetBonus: this.options.league().cleanSheet,
          cleanSheetShare: csShare,
          cleanSheetMean: csMean,
        }),
      });
    }
    return out;
  });

  readonly map = computed<PlanciaMap>(() => buildMap(this.men(), this.teamsCount(), this.slots()));

  /**
   * QUANTI UOMINI HO GIÀ, PER CLUB REALE: il numero che fa scendere l'offerta su un suo compagno.
   *
   * Sua istruzione del 04/09/2026. Conta solo i MIEI acquisti - il club di un rivale non è un rischio
   * mio - e per NOME canonico del club, che è quello che la riga porta: qui non si joina niente per
   * id perché sono le stesse stringhe della stessa mappa.
   */
  /**
   * QUANTI UOMINI DI OGNI CLUB HA LA MIA ROSA, contati per RUOLO.
   *
   * Per ruolo perche' la penalita' e' diversa (sua istruzione, 08/09/2026): chi pesta il ruolo di chi
   * sto guardando vale il 25%, chi sta in un altro reparto il 15%. `sameClubDiscount` compone i due.
   *
   * Il conteggio si CONTA e non si ricava per differenza: «quanti ne ho di quel club» e «quanti posti
   * mi restano» sono due domande, e ricavare la prima dalla seconda e' il difetto che questa pagina ha
   * gia' pagato su `progress`. E il club viene da `men()`, che e' il listone intero con un ruolo e un
   * FVM - non i 250 disegnati - cosi' un mio acquisto che la plancia non disegna conta comunque per il
   * suo club, che e' l'unico modo di non sottostimare il rischio proprio dove si sta accumulando.
   */
  private readonly mineByClub = computed<Map<string, Map<Role, number>>>(() => {
    const mine = this.mineId();
    const out = new Map<string, Map<Role, number>>();
    if (mine == null) return out;
    const byId = new Map<number, { club: string; role: Role }>();
    for (const man of this.men()) byId.set(man.id, { club: man.club, role: man.role });
    for (const pick of this.feed.picks()) {
      if (pick.teamId !== mine) continue;
      const held = byId.get(pick.playerId);
      if (!held) continue;
      const byRole = out.get(held.club) ?? new Map<Role, number>();
      byRole.set(held.role, (byRole.get(held.role) ?? 0) + 1);
      out.set(held.club, byRole);
    }
    return out;
  });

  /**
   * Quanti dei miei stanno nel suo club, separati fra chi gli pesta il ruolo e chi no.
   *
   * Una definizione sola, letta dalla riga E dal lotto: due chiamate con due conteggi diversi sono
   * come un uomo finisce con due prezzi sulla stessa plancia.
   */
  private heldOf(club: string, role: Role): SameClubHeld {
    const byRole = this.mineByClub().get(club);
    if (!byRole) return { sameRole: 0, otherRole: 0 };
    let sameRole = 0;
    let otherRole = 0;
    for (const [held, count] of byRole) {
      if (held === role) sameRole += count;
      else otherRole += count;
    }
    return { sameRole, otherRole };
  }

  /** Who owns whom, at what price - the only field of a live session that is right at every instant. */
  private readonly owners = computed(() => {
    const teams = new Map(this.feed.teams().map((team) => [team.id, team]));
    const out = new Map<number, { teamId: number; price: number }>();
    for (const pick of this.feed.picks()) {
      if (!teams.has(pick.teamId)) continue;
      out.set(pick.playerId, { teamId: pick.teamId, price: pick.cost ?? pick.value ?? 0 });
    }
    return out;
  });

  readonly mineId = computed(() => this.feed.followedTeamId());

  /**
   * COME SI COSTRUISCE UNA RIGA DEL TABELLONE, in un posto solo.
   *
   * Estratta da `blocks()` il 23/09/2026 perche' da oggi la griglia personale ne costruisce alcune da
   * se' (i ripescati dalla coda, sotto): due copie di questa decorazione sarebbero due letture dello
   * stesso foglio, cioe' un uomo con due stati o due bande a seconda di quale griglia lo disegna - il
   * difetto che questa pagina ha gia' pagato con i due lettori di `engine_fm_pred`.
   *
   * IL CONTESTO SI LEGGE UNA VOLTA e non per riga: la mappa delle squadre costa, e duecentocinquanta
   * righe la ricostruirebbero duecentocinquanta volte.
   *
   * `slot` e' `null` per chi un posto sulla mappa non ce l'ha, e allora NIENTE BANDA. La scala delle
   * offerte e' misurata PER (ruolo, slot) e sotto l'ultimo non c'e' un gradino: `offerBand` lo
   * aggancerebbe comunque all'ultimo (il `Math.min` del suo clamp), cioe' prezzerebbe l'81esimo
   * difensore come il 75esimo - un parametro applicato fuori dalla popolazione su cui e' misurato.
   * «Vuoto = ignoto»: la riga stampa un trattino, che e' quello che sappiamo.
   */
  private rowMaker(): (
    man: PlanciaMan,
    slot: { index: number; medianPoints: number | null } | null,
  ) => BoardMan {
    const owners = this.owners();
    const teams = new Map(this.feed.teams().map((team) => [team.id, team]));
    const mine = this.mineId();
    const lot = this.lotId();
    const budget = this.budget();

    return (man, slot) => {
      const owner = owners.get(man.id);
      const state: ManState =
        man.id === lot ? 'asta' : owner ? (owner.teamId === mine ? 'mio' : 'altro') : 'urna';
      const team = owner ? teams.get(owner.teamId) : null;
      // `man.role` e non quello del blocco: `buildMap` impila per `man.role`, quindi sono lo stesso
      // valore - e cosi' la funzione vale anche per chi un blocco non ce l'ha.
      const held = this.heldOf(man.club, man.role);
      const band = slot
        ? (offerBand({
            role: man.role,
            slotIndex: slot.index,
            budget,
            room: budget,
            points: man.points,
            medianPoints: slot.medianPoints,
            available: man.out?.share,
            hurt: !!man.out || !!man.outNow,
            confidence: man.confidence,
            // Quanti ne ho gia' del suo club: l'offerta scende, il suo valore no (sua istruzione
            // del 04/09/2026). Sta in TUTT'E DUE i posti che chiamano `offerBand` - qui e sul lotto -
            // o la riga direbbe una cifra e la card un'altra.
            sameClub: held,
          }) ?? null)
        : // NIENTE SLOT, QUINDI NIENTE SCALA: il tetto e' il minimo dell'asta e la card dice perche'.
          tailBand(budget, budget);
      return {
        ...man,
        state,
        band,
        sameClubCut: sameClubDiscount(held),
        price: owner?.price ?? band?.high ?? null,
        ownerId: owner?.teamId ?? null,
        ownerLabel: team?.label ?? null,
        ownerColour: team?.colour ?? null,
        fromTail: !slot,
      };
    };
  }

  readonly blocks = computed<BoardBlock[]>(() => {
    const make = this.rowMaker();

    return this.map().blocks.map((block) => {
      const medianPoints = middleOf(block.men.map((man) => man.points));
      const rows: BoardMan[] = block.men.map((man) =>
        make(man, { index: block.index, medianPoints }),
      );

      return {
        ...block,
        rows: mineFirst(rows),
        left: rows.filter((row) => row.state === 'urna' || row.state === 'asta').length,
        mine: rows.some((row) => row.state === 'mio'),
        medianOffer: middleOf(rows.map((row) => row.band?.high ?? null)),
        // `null` e non la mediana del surplus: qui a tagliare e' il PREZZO, e un blocco che
        // dichiarasse una coordinata su cui non e' tagliato direbbe una cosa falsa di se'.
        medianCoin: null,
      };
    });
  });

  /**
   * QUALE GRIGLIA DISEGNA LA PLANCIA: quella del MERCATO o la MIA.
   *
   * Sua richiesta del 04/09/2026. Non e' un filtro e non e' un ordinamento della tabella: sono due
   * tagli dello stesso listone, e il bottone li NOMINA perche' un blocco chiamato `D1` che contiene
   * due insiemi diversi di dieci uomini a seconda di uno stato invisibile e' esattamente il difetto
   * che questa pagina si e' scritta due volte. Quello che NON cambia col taglio e' tutto cio' che e'
   * misurato - la banda, il verdetto del lotto, l'alternativa, lo slot che la card nomina - perche'
   * quelli leggono `blocks()`, che resta la griglia del mercato: vedi `regroupByOffer`.
   *
   * IN `localStorage` E NON NELL'INDIRIZZO (sua richiesta del 23/09/2026: «memorizza lo stato dei
   * tasti premuti in modo che al refresh non si perdano le impostazioni»). La regola di casa manda
   * nell'indirizzo cio' che la pagina SELEZIONA, perche' sia condivisibile e camminabile col tasto
   * Indietro; questa pagina non e' un link che si manda a qualcuno, e' il foglio su cui si segna
   * l'asta - e un ricaricamento a meta' asta deve ritrovarla com'era anche se l'indirizzo e' nudo.
   */
  readonly slotView = stored<SlotView>('plancia.view', 'market', ['market', 'mine']);

  /**
   * QUALI NUMERI STAMPANO LE RIGHE: quelli del motore o le tre misure della stagione scorsa.
   *
   * Sua richiesta del 23/09/2026. Persistita come gli altri due interruttori della barra e per la
   * stessa ragione: e' un modo di leggere la pagina, non un link da mandare a qualcuno.
   */
  readonly rowStats = stored<RowStats>('plancia.stats', 'engine', ['engine', 'last']);

  /**
   * LA STAGIONE SCORSA DI OGNI UOMO, letta e mai derivata (`seasonLines`, una definizione sola).
   *
   * Vuota finche' `season_stats` non e' in casa, e allora le righe stampano un trattino: «vuoto =
   * ignoto», che qui e' anche letteralmente vero per chi in Serie A l'anno scorso non ha giocato.
   */
  readonly lastSeason = signal<ReadonlyMap<number, SeasonLine>>(new Map());

  /** Che stagione e', per l'etichetta: il nome non si deduce dalla data di oggi. */
  readonly lastSeasonLabel = signal<string | null>(null);

  /** La plancia come la si guarda: `blocks()` sul mercato, la stessa gente ritagliata sul mio tetto. */
  readonly viewBlocks = computed<BoardBlock[]>(() => {
    const market = this.blocks();
    if (this.slotView() === 'market') return market;
    // Gli uomini che la mappa PORTA, non il listone: chi sta nella coda non ha una banda affatto, e
    // promuoverlo qui vorrebbe dire prezzarlo su un gradino della scala che non esiste per lui.
    // ...MENO CHI HO BUTTATO, e gli altri scalano da se': la griglia si ritaglia su chi resta, quindi
    // togliere un nome ricompone i blocchi senza che nessuno debba «spostare» niente (sua richiesta del
    // 23/09/2026: «quando butto un calciatore in automatico tutti gli altri scalano»).
    const binned = this.binnedIds();
    const drawn = market.flatMap((block) => block.rows);
    const rows = drawn.filter((man) => !binned.has(man.id));
    // IL CONTO DI UN RUOLO NON CAMBIA PERCHE' HO BUTTATO UN NOME (sua richiesta del 23/09/2026: «il
    // numero totale di calciatori di quel ruolo deve rimanere invariato, quindi deve entrare uno dei
    // calciatori che prima era rimasto fuori»). Al posto di ognuno entra il primo della CODA, cioe' di
    // quelli che la mappa del mercato lascia sotto l'ultimo slot.
    //
    // DALLA CODA E NON DAGLI ESCLUSI, che pure il codice chiama «lasciati fuori»: quelli sono i nomi
    // che `MIN_PLAY_SHARE` toglie dalla riga tenendoli nel rango, e ripescarli qui farebbe DISFARE a
    // un click un vincolo dichiarato. Per la stessa ragione il ripescato quella soglia la deve passare.
    //
    // E LA CODA E' GIA' IN ORDINE DI PREZZO (`buildMap` impila per FVM decrescente): chi entra e' il
    // primo sotto la linea, cioe' il nome che il taglio stesso aveva appena lasciato fuori. Sceglierlo
    // con un'altra moneta vorrebbe dire ridefinire la popolazione invece di ripararla.
    const make = this.rowMaker();
    const spares: BoardMan[] = [];
    for (const role of ROLES) {
      const need =
        drawn.filter((man) => man.role === role).length -
        rows.filter((man) => man.role === role).length;
      if (need <= 0) continue;
      spares.push(
        ...this.map()
          .tail.filter(
            (man) =>
              man.role === role &&
              !binned.has(man.id) &&
              (man.out?.share ?? 1) >= MIN_PLAY_SHARE,
          )
          .slice(0, need)
          .map((man) => make(man, null)),
      );
    }
    // CHI NON SI DISEGNA VA DICHIARATO ANCHE QUI, and the right place is the role's LAST block: the
    // personal grid is cut on the same men MINUS the excluded, so the whole shortfall lands at the end
    // of the role - that is the block drawn with eight rows instead of ten. Leaving `excluded` empty
    // left it short without a word, and the bar pastille that used to name them is gone (04/09/2026).
    const goneByRole = new Map<Role, PlanciaMan[]>();
    for (const block of market) {
      if (!block.excluded.length) continue;
      goneByRole.set(block.role, [...(goneByRole.get(block.role) ?? []), ...block.excluded]);
    }
    // ...E IL MIO ORDINE VIENE PRIMA DEL TAGLIO, come sulla Strategia: un nome sistemato all'ottantesimo
    // posto deve restare visibile, e applicarlo dopo lo taglierebbe fuori dalla lista in cui l'ho messo.
    const pinned = Object.fromEntries(ROLES.map((role) => [role, this.orderFor(role)]));
    const groups = regroupByCoin(
      // IL RIPESCATO ENTRA NEL TAGLIO COME TUTTI, e non appiccicato in fondo: la colonna di questa
      // griglia E' la moneta (04/09/2026, la sua domanda su Hojlund e Martinez), quindi una riga messa
      // ultima a dispetto del proprio surplus rimetterebbe la contraddizione che quella cura ha tolto.
      // In pratica scende lo stesso in fondo quasi sempre - chi la moneta non ce l'ha ci va per
      // costruzione (`regroupByCoin` lo manda a `-Infinity`) - ma e' la moneta a dirlo e non noi.
      [...rows, ...spares],
      // LA MONETA E' IL SURPLUS (operatore, 23/09/2026), e taglia E ordina: vedi `PlanciaMan.surplus`
      // per la misura che lo sceglie contro lo swing, e `regroupByCoin` per perche' la chiave e' una.
      // Il TETTO resta dov'era - nella sua colonna, letto sullo slot di mercato - perche' la scala che
      // lo produce e' misurata su un rango di PREZZO e non si rilegge su una griglia nostra.
      (man) => man.surplus,
      this.teamsCount(),
      this.slots(),
      pinned,
    );
    const lastOfRole = new Map<Role, string>();
    for (const group of groups) lastOfRole.set(group.role, group.id);
    return groups.map((group) => ({
      role: group.role,
      index: group.index,
      id: group.id,
      men: group.men,
      // Chi rientra troppo tardi e' fuori dalla lista in tutt'e due i tagli: qui non c'e' un blocco a
      // cui appartenga - senza una riga non ha un tetto su cui essere ordinato - quindi la dichiarazione
      // sta sul blocco CORTO, che e' l'ultimo del ruolo, ed e' il tooltip a portare conto, nomi e soglia.
      excluded: lastOfRole.get(group.role) === group.id ? (goneByRole.get(group.role) ?? []) : [],
      medianFvm: group.medianFvm,
      // Dalla stessa `middleOf` della griglia del mercato: un uomo senza tetto non e' un tetto di zero,
      // quindi non entra nel campione - e `medianOffer` promette `null` dove nessuno ne ha uno.
      medianOffer: middleOf(group.men.map((man) => man.band?.high ?? null)),
      // LA COORDINATA DEL TAGLIO, che e' quella che l'intestazione stampa. Stessa `middleOf` e stessa
      // ragione: chi il foglio non prezza non e' un surplus di zero, quindi non entra nel campione.
      medianCoin: middleOf(group.men.map((man) => man.surplus)),
      // NIENTE PREFISSO DEI MIEI QUI, e non e' una dimenticanza: su questa griglia la colonna E'
      // l'ordine (04/09/2026, sua domanda su Hojlund e Martinez), quindi appuntare dei nomi in cima
      // rimetterebbe esattamente la contraddizione che stiamo togliendo - una riga sopra un'altra con
      // un numero piu' basso. «I miei in cima» (03/09) resta sulla plancia del mercato, dove l'ordine
      // e' il valore atteso e il prefisso e' un'aggiunta dichiarata sopra di esso; qui i miei si vedono
      // dallo sfondo grigio, che e' il canale che avevano gia'.
      rows: group.men,
      left: group.men.filter((man) => man.state === 'urna' || man.state === 'asta').length,
      mine: group.men.some((man) => man.state === 'mio'),
    }));
  });

  /**
   * Il blocco da evidenziare sulla griglia che si sta guardando.
   *
   * `lot.block` e' e resta quello del MERCATO - e' lo slot su cui il verdetto e' misurato - quindi
   * cercarlo per id sulla griglia personale evidenzierebbe un blocco che non contiene il lotto.
   */
  readonly viewLotBlockId = computed<string | null>(() => {
    const id = this.lotId();
    if (id == null) return null;
    return this.viewBlocks().find((block) => block.rows.some((row) => row.id === id))?.id ?? null;
  });

  private readonly blockById = computed(
    () => new Map(this.blocks().map((block) => [block.id, block])),
  );

  /** My own squad, which is the one whose room decides every ceiling on screen. */
  readonly me = computed(() => this.feed.teams().find((team) => team.id === this.mineId()) ?? null);

  /**
   * LA MODALITA' FOCUS: accesa, la plancia smorza chi NON serve alla mia rosa (`core/focus.ts`).
   *
   * Sua richiesta del 23/09/2026. Uno STATO e non un filtro, per la ragione che questa pagina si e'
   * gia' data due volte: le righe restano tutte, perche' all'asta esce quello che esce e una lista che
   * NASCONDE un nome non lo rende non-comprabile - lo rende invisibile nel momento in cui viene
   * chiamato. Il focus toglie ATTENZIONE, non uomini, ed e' lo stesso meccanismo della lente su una rosa.
   *
   * SOPRAVVIVE A UN RICARICAMENTO, e qui l'obiezione c'e' ed e' guardata: uno stato che smorza
   * duecento righe e torna acceso domani sembrerebbe un guasto. Non lo e' perche' si DICHIARA da se' -
   * il tasto e' `primary` e accanto ci sono i quattro obiettivi - che e' la stessa condizione per cui
   * la lente su una rosa puo' smorzarne 250: «smorzare senza una parola in cima si legge come un
   * guasto», quindi la parola c'e'.
   */
  readonly focusOn = storedFlag('plancia.focus', false);

  /**
   * I POSTI CHE L'UNDICI SCHIERA, per il conto dei buchi: il 4-3-3, una delle sue due forme dichiarate
   * (`referenceShape` della pagina delle buste le nomina tutte e due) ed e' anche quella su cui il banco
   * misura (`rules.FIELDED`). Dichiarato qui perche' la plancia una forma di riferimento non la sceglie:
   * la sceglie chi compra, e finche' non gliela si chiede questa e' la sua.
   */
  private readonly FOCUS_PLACES: Record<Role, number> = { P: 1, D: 4, C: 3, A: 3 };

  /** La mia rosa come il focus la legge: il ruolo, quanto gioca, il club e la parola della scala. */
  private readonly ownedForFocus = computed<Owned[]>(() =>
    this.blocks()
      .flatMap((block) => block.rows)
      .filter((man) => man.state === 'mio')
      .map((man) => ({
        role: man.role, expected: man.pv, club: man.club, category: man.category ?? null,
      })),
  );

  /**
   * IL BISOGNO DI OGNI REPARTO, e quale sia decide cosa il focus accende.
   *
   * `null` dove non c'e' piu' niente da comprare: un reparto pieno non ha bisogni, e continuare ad
   * accendergli delle righe direbbe il contrario di quello che la barra dichiara.
   */
  readonly focusAuto = computed<Record<Role, Goal | null>>(() => {
    const mine = this.ownedForFocus();
    const team = this.me();
    // SENZA CALENDARIO NON C'E' UNA QUOTA, e quindi non c'e' un obiettivo: la stessa regola che
    // `expectedPlay` applica alla dritta - una quota senza le giornate non e' un numero di partite.
    const matchdays = this.seasonRounds();
    if (!matchdays) return { P: null, D: null, C: null, A: null } as Record<Role, Goal | null>;
    const rules = { ...FOCUS_RULES, matchdays };
    const out = {} as Record<Role, Goal | null>;
    for (const role of ROLES) {
      const left = team ? (team.missing[ROLE_ZONE[role]] ?? 0) : this.slots()[role];
      const want = needOf(mine, role, this.FOCUS_PLACES[role], left, rules);
      out[role] = want === null ? null : this.pressured(role, want, left);
    }
    return out;
  });

  /**
   * DUE CORREZIONI CHE VENGONO DALL'ASTA E NON DALLA ROSA (sua richiesta del 23/09/2026: «il sistema
   * deve valutare cosa stanno cercando le altre squadre ... riconoscere se stanno cominciando a
   * scarseggiare ... ottimizzare i crediti spendibili»).
   *
   * 1. LA SCARSITA' ALZA L'OBIETTIVO. Se i top di quel ruolo ancora nell'urna sono meno delle rose che
   *    quel ruolo lo vogliono ancora, ogni mano alzata ne prende uno e per gli ultimi non c'e' per
   *    tutti: e' il momento di prenderne uno, qualunque cosa la rosa dica. `handsFor` e' la stessa
   *    quantita' che il banco usa - «conta come mano alzata solo il rivale che PUO' pagare» vale +2,0%
   *    e le forme piu' elaborate valgono meno (§22) - quindi si legge quella e non se ne inventa una.
   *
   * 2. IL BUDGET LO ABBASSA. Se quello che resta, tolto un credito per ogni posto ancora da riempire,
   *    non basta per il piu' economico dei top in urna, TOP non e' un consiglio: e' una lista che non
   *    si puo' comprare. «Un posto e' scarso quanto un credito» (§14) letto dal lato del consiglio.
   *
   * QUELLO CHE NON FA, e ha un numero: leggere COSA cercano i rivali oltre al loro numero. Misurato con
   * un ORACLE che vede i loro tetti prima di offrire - quindi un tetto per qualunque modello - e
   * respinto su quattro famiglie: a secondo prezzo sapere cosa serve per vincere il lotto che hai
   * davanti vale ZERO, perche' se il tuo tetto e' sopra vinci e paghi comunque il secondo prezzo, e se
   * e' sotto perdi comunque (§22). L'unica cosa dei rivali che paga e' quanti sono, ed e' il punto 1.
   */
  private pressured(role: Role, want: Goal, left: number): Goal {
    const hands = this.handsFor(role);
    const topsLeft = this.blocks()
      .filter((block) => block.role === role)
      .flatMap((block) => block.rows)
      .filter((man) => man.state === 'urna' && !!man.category
        && TOP_WORDS.includes(man.category)).length;
    // LA SCARSITA': meno top che mani, e chi non si muove resta senza.
    if (topsLeft > 0 && topsLeft <= hands && want !== 'top') return 'top';
    if (want !== 'top') return want;
    // IL BUDGET: il piu' economico dei top in urna, contro quello che posso spendere lasciando un
    // credito per ogni altro posto. Se non ci arrivo, TOP e' una lista che non posso comprare.
    const purse = (this.me()?.budgetLeft ?? 0) - Math.max(0, left - 1);
    const cheapest = Math.min(
      ...this.blocks()
        .filter((block) => block.role === role)
        .flatMap((block) => block.rows)
        .filter((man) => man.state === 'urna' && !!man.category
          && TOP_WORDS.includes(man.category))
        .map((man) => man.band?.low ?? man.fvm),
    );
    if (Number.isFinite(cheapest) && purse < cheapest) return 'starter';
    return want;
  }

  /**
   * L'OBIETTIVO CHE HA SCELTO LUI, per i ruoli in cui l'ha fatto: un click sull'etichetta passa al
   * successivo (sua richiesta del 23/09/2026).
   *
   * UN OVERRIDE E NON UNA SOSTITUZIONE: quello che il focus propone resta calcolato, e quello che lui
   * sceglie sta sopra per quel ruolo soltanto. Cosi' un reparto che non ha toccato continua a seguire
   * la rosa mentre compra, che e' la ragione per cui l'obiettivo automatico esiste - a quattro ore
   * d'asta nessuno ricalcola a mente quanti buchi ha in difesa.
   *
   * PERSISTITO come gli altri due, e per una ragione in piu' di «e' un tasto premuto»: un'asta dura
   * ore e un ricaricamento in mezzo non e' un ripensamento. Cio' che lo rende sicuro e' che si VEDE -
   * l'etichetta scavalcata perde il primario e il tooltip dice «Scelto da te» - e che si puo'
   * TOGLIERE, cioe' `cycleGoal` qui sotto. La pila del cestino invece non e' persistita, e la
   * differenza e' la stessa: un «annulla» che sopravvive disferebbe una cosa fatta ieri, mentre un
   * obiettivo che sopravvive la si legge e la si cambia in un click.
   */
  private readonly chosen = storedJson<Partial<Record<Role, Goal>>>(
    'plancia.goals',
    (raw) => {
      // Si VALIDA invece di fidarsi, parola per parola: una scritta da una versione precedente
      // arriverebbe in `focusNeeds` e da li' in `serves`, che su un valore che non conosce non accende
      // niente - cioe' uno schermo spento senza una ragione a schermo.
      if (!raw || typeof raw !== 'object') return {};
      const out: Partial<Record<Role, Goal>> = {};
      for (const role of ROLES) {
        const one = (raw as Record<string, unknown>)[role];
        if (typeof one === 'string' && GOALS.includes(one as Goal)) out[role] = one as Goal;
      }
      return out;
    },
  );

  /** L'obiettivo VIVO di ogni reparto: il suo se l'ha scelto, altrimenti quello che la rosa chiede. */
  readonly focusNeeds = computed<Record<Role, Goal | null>>(() => {
    const auto = this.focusAuto();
    const mine = this.chosen();
    const out = {} as Record<Role, Goal | null>;
    // ...e su un reparto PIENO la scelta non si applica: `auto` dice `null` perche' non c'e' piu'
    // niente da comprare, e accendere delle righe li' direbbe il contrario di quello che la barra
    // dichiara. Una scelta che sopravvive al proprio reparto e' un filtro che nessuno ha chiesto.
    for (const role of ROLES) out[role] = auto[role] === null ? null : (mine[role] ?? auto[role]);
    return out;
  });

  /**
   * IL MIO ORDINE SULLA GRIGLIA PERSONALE, e i nomi che ho BUTTATO (sua richiesta del 23/09/2026:
   * «quando gli slot-personali sono attivi, permettimi di riordinare i calciatori tramite drag&drop e
   * salva in locale l'ordine ... un tasto per resettare» e «un'area cestino ... tutti gli altri
   * scalano ... un tasto per annullare l'ultima eliminazione»).
   *
   * IL MODELLO E' IL PREFISSO DELLA STRATEGIA, non un secondo ordine personale: `orderedBy` e
   * `withRowAt` sono le stesse funzioni (`core/manual-order.ts`), e la ragione per cui un prefisso
   * batte «salva tutta la lista» vale identica qui - un uomo nuovo che il foglio prezza bene
   * finirebbe sotto duecento nomi, cioe' invisibile, mentre sotto il prefisso compare in cima alla
   * meta' misurata. E' «vuoto = ignoto» applicato a un ORDINE: un nome che nessuno ha ordinato non e'
   * un nome ordinato ultimo.
   *
   * PER RUOLO E NON PER BLOCCO, ed e' la differenza che rende il gesto utile: i blocchi sono la
   * graduatoria tagliata a dieci, quindi portare un uomo in cima lo porta nel PRIMO slot - che e'
   * quello che «il mio ordine di priorita'» vuol dire. Un ordine dentro il blocco lascerebbe ognuno
   * dove il tetto l'ha messo.
   *
   * LA CHIAVE PORTA LA PIATTAFORMA e non il foglio: una preferenza e' un fatto sulla sua lega, non
   * sulla revisione che stiamo leggendo, quindi un export nuovo la conserva.
   */
  private readonly order = storedJson<Record<string, number[]>>(
    'plancia.order',
    (raw) => (raw && typeof raw === 'object' ? (raw as Record<string, number[]>) : {}),
  );

  /**
   * I NOMI BUTTATI, e la PILA per disfare: due strutture perche' sono due domande - «chi non voglio
   * vedere» e «cos'e' l'ultima cosa che ho fatto». Una lista sola non saprebbe rispondere alla seconda.
   */
  private readonly binned = storedJson<Record<string, number[]>>(
    'plancia.binned',
    (raw) => (raw && typeof raw === 'object' ? (raw as Record<string, number[]>) : {}),
  );

  /** La chiave di una lista: la piattaforma e il ruolo, mai il foglio. */
  private keyOf(role: Role): string {
    return `default|${role}`;
  }

  /**
   * LA PILA DI CIO' CHE HO BUTTATO, in ordine di tempo e su tutti i ruoli insieme: «annulla l'ultima
   * eliminazione» vuol dire l'ultima in assoluto, e con quattro liste separate non si saprebbe quale.
   * NON e' persistita: un annulla che sopravvive a un ricaricamento disferebbe una cosa fatta ieri.
   */
  private readonly binOrder = signal<{ role: Role; id: number }[]>([]);

  /** Gli id che ho buttato, per la griglia che li toglie e per il tasto che li rimette. */
  readonly binnedIds = computed<ReadonlySet<number>>(() => {
    const all = this.binned();
    return new Set(Object.values(all).flat());
  });

  /** Quanti ne ho buttati, per la barra: un conto che non si vede e' un vincolo muto. */
  readonly binnedCount = computed(() => this.binnedIds().size);

  /** Se c'e' un ordine mio da annullare, per accendere la crocetta solo quando serve. */
  readonly hasOrder = computed(() => Object.values(this.order()).some((one) => one.length > 0));

  /** L'ordine mio di un ruolo, come `orderedBy` lo vuole. */
  orderFor(role: Role): readonly number[] {
    return this.order()[this.keyOf(role)] ?? [];
  }

  /** Il rilascio di un trascinamento: l'uomo va al posto `at` della lista che si sta vedendo. */
  moveTo(role: Role, shown: readonly number[], id: number, at: number): void {
    const next = withRowAt(this.orderFor(role), shown, id, at);
    if (!next) return;
    this.order.update((was) => ({ ...was, [this.keyOf(role)]: next }));
  }

  /** BUTTATO: esce dalla lista e gli altri scalano da se', perche' la griglia si ritaglia su chi resta. */
  bin(role: Role, id: number): void {
    const key = this.keyOf(role);
    this.binned.update((was) => ({ ...was, [key]: [...(was[key] ?? []), id] }));
    this.binOrder.update((was) => [...was, { role, id }]);
  }

  /**
   * ANNULLA L'ULTIMA ELIMINAZIONE, che e' l'ultima in ordine di tempo su TUTTI i ruoli e non su uno.
   *
   * La pila e' implicita nell'ordine in cui i nomi sono stati aggiunti - l'ultimo di ogni lista e' il
   * suo piu' recente - e fra i quattro si sceglie l'ultimo assoluto tenendo un contatore: senza, «annulla»
   * dopo aver buttato un difensore e poi un attaccante rimetterebbe il difensore, che non e' quello che
   * la parola promette.
   */
  unbin(): void {
    const stack = this.binOrder();
    const last = stack[stack.length - 1];
    if (!last) return;
    const key = this.keyOf(last.role);
    this.binned.update((was) => ({
      ...was,
      [key]: (was[key] ?? []).filter((one) => one !== last.id),
    }));
    this.binOrder.update((was) => was.slice(0, -1));
  }

  /** ...e il tasto che rimette tutto come il foglio lo aveva messo: ordine e cestino insieme. */
  resetOrder(): void {
    this.order.set({});
    this.binned.set({});
    this.binOrder.set([]);
  }

  /**
   * Il click sull'etichetta: al successivo dei quattro, e il giro riparte da capo.
   *
   * E QUANDO IL GIRO TORNA SUL CONSIGLIO, LO SCAVALCO SI TOGLIE invece di essere riscritto uguale -
   * altrimenti quel reparto smetterebbe di seguire la rosa per sempre, pur leggendo «consigliato»
   * (il primario confronta i due valori, non l'esistenza della scelta). Da quando lo scavalco
   * sopravvive a un ricaricamento questa e' l'unica strada di ritorno che esista, e una preferenza
   * persistente che non si puo' togliere e' una trappola: l'ultimo click del giro la toglie.
   */
  cycleGoal(role: Role): void {
    const now = this.focusNeeds()[role];
    if (now === null) return;
    const next = nextGoal(now);
    const advised = this.focusAuto()[role];
    this.chosen.update((was) => {
      const out = { ...was };
      if (next === advised) delete out[role];
      else out[role] = next;
      return out;
    });
  }

  /**
   * GLI ID CHE SERVONO, o `null` col focus spento: la forma in cui la griglia lo legge.
   *
   * Un INSIEME e non un predicato, perche' `slot-matrix` e' puro a input e deve restarlo - chi sa cosa
   * serve e' questo negozio, chi lo disegna e' il componente. E si calcola una volta per disegno invece
   * che duecentocinquanta: la stessa ragione per cui `pool` della Strategia non si rifa' a ogni click.
   */
  readonly focusIds = computed<ReadonlySet<number> | null>(() => {
    if (!this.focusOn()) return null;
    const out = new Set<number>();
    for (const block of this.viewBlocks()) {
      for (const man of block.rows) if (this.servesFocus(man)) out.add(man.id);
    }
    return out;
  });

  /** Se questa riga chiude il bisogno del suo reparto. Falso per tutti quando il focus e' spento. */
  servesFocus(man: { role: Role; pv: number | null; category: string | null; club: string }): boolean {
    if (!this.focusOn()) return false;
    return serves(
      this.focusNeeds()[man.role],
      { role: man.role, expected: man.pv, category: man.category, club: man.club },
      man.role,
      { ...FOCUS_RULES, matchdays: this.seasonRounds() ?? 0 },
      // ...e la MIA rosa, che due dei quattro obiettivi confrontano: «completa l'undici» e
      // «complementa quelli che abbiamo» sono relazioni, non soglie.
      this.ownedForFocus(),
      this.FOCUS_PLACES[man.role],
    );
  }

  /**
   * I MIEI UOMINI, TUTTI: dal listone e non dalla plancia, perche' la plancia non li disegna tutti.
   *
   * `blocks()` porta i 25 slot x `teams` uomini e lascia fuori due popolazioni che in rosa ci sono
   * eccome - la CODA (cinque uomini su venticinque, a un credito) e chi rientra troppo tardi per
   * valere un posto (`MIN_PLAY_SHARE`) - quindi un campetto costruito su quelle righe disegnerebbe un
   * undici di una rosa che non e' la mia. Si legge percio' da `men()`, che e' il listone intero e
   * l'unica definizione di come questa pagina prezza un uomo, incrociato con gli acquisti del feed.
   *
   * Vuoto finche' non si sa chi sono io: «vuoto = ignoto», e un campetto senza padrone non si disegna.
   */
  readonly mySquad = computed<PlanciaMan[]>(() => {
    const mine = this.mineId();
    if (mine == null) return [];
    const owned = new Set(
      this.feed.picks().filter((pick) => pick.teamId === mine).map((pick) => pick.playerId),
    );
    return owned.size ? this.men().filter((man) => owned.has(man.id)) : [];
  });

  /**
   * How many rosters still want a role - the number that decides the second price (§23.1) and the one
   * nobody counts by hand at the fourth hour. Mine is NOT in it: it counts the hands raised against me.
   */
  handsFor(role: Role, floor = 0): number {
    const mine = this.mineId();
    return this.feed
      .teams()
      .filter(
        (team) =>
          team.id !== mine &&
          (team.missing[ROLE_ZONE[role]] ?? 0) > 0 &&
          team.budgetLeft >= Math.max(1, floor),
      ).length;
  }

  readonly lot = computed<Lot | null>(() => {
    const id = this.lotId();
    if (id == null) return null;
    const block = this.blocks().find((candidate) => candidate.rows.some((row) => row.id === id));
    const budget = this.budget();
    const room = this.me()?.budgetLeft ?? budget;

    // CHI LA MAPPA NON DISEGNA E' COMUNQUE IN ASTA. `rowMaker` sa gia' costruire una riga senza slot
    // (tetto = minimo d'asta, `fromTail`), quindi quello che mancava non era il come: era che nessuno
    // gliela chiedesse. Il verdetto e' quello della coda e non `adviseLot` con uno slot inventato.
    if (!block) {
      const tail = this.men().find((one) => one.id === id);
      if (!tail) return null;
      const row = this.rowMaker()(tail, null);
      const hands = this.handsFor(row.role, row.band?.low ?? 1);
      return {
        man: row,
        block: null,
        role: row.role,
        live: !!this.upNow()?.live,
        // La cifra sul tavolo passa dalla stessa definizione della riga disegnata (`bid`): la coda non
        // e' un secondo lettore dell'offerta del banditore.
        price: this.bid().value,
        bidLive: this.bid().live,
        exhaustedBelow: 0,
        advice: adviseTail(row.band, row.basis !== 'none', this.bid().value, hands),
        alternative: null,
      };
    }

    const man = block.rows.find((row) => row.id === id);
    if (!man) return null;

    const medianPoints = middleOf(block.men.map((entry) => entry.points));
    const roleBlocks = this.map().byRole.get(block.role) ?? [];
    const exhaustedBelow = roleBlocks
      .filter((candidate) => candidate.index > block.index)
      .slice(0, 2)
      .filter((candidate) => (this.blockById().get(candidate.id)?.left ?? 0) === 0).length;

    const band = offerBand({
      role: block.role,
      slotIndex: block.index,
      budget,
      room,
      points: man.points,
      medianPoints,
      exhaustedBelow,
      available: man.out?.share,
      hurt: !!man.out || !!man.outNow,
      confidence: man.confidence,
      sameClub: this.heldOf(man.club, block.role),
    });

    const hands = this.handsFor(block.role, band?.low ?? 1);
    const owners = this.owners();

    return {
      man,
      block,
      role: block.role,
      live: !!this.upNow()?.live,
      price: this.bid().value,
      bidLive: this.bid().live,
      exhaustedBelow,
      advice: adviseLot({
        role: block.role,
        slotIndex: block.index,
        band,
        medianFvm: block.medianFvm,
        tablePrice: this.lotPrice(),
        hands,
        teams: this.teamsCount(),
        exhaustedBelow,
        priced: man.basis !== 'none',
        outNow: man.outNow,
        outReason: this.status.unavailableNow(man.id)?.note ?? null,
        out: man.out ?? null,
        sameClub: { ...this.heldOf(man.club, block.role), club: man.club },
      }),
      alternative: alternativeFor(
        this.map(),
        block,
        (candidate) => !owners.has(candidate.id) && candidate.id !== id,
        id,
        (candidate) => this.offerOf(candidate.id),
      ),
    };
  });

  /** Max offer by id, from the board itself: one pricing, so a row and a pair cannot disagree. */
  private readonly offers = computed(() => {
    const out = new Map<number, number>();
    for (const block of this.blocks()) {
      for (const man of block.rows) if (man.price != null) out.set(man.id, man.price);
    }
    return out;
  });

  private offerOf(id: number): number {
    return this.offers().get(id) ?? 0;
  }

  /**
   * THE PAIR BEHIND EVERY NAME, precomputed once per board.
   *
   * It is on every row and not only on the lot because that count is the work the board exists for: the
   * alternative degrades as the auction empties, and at the fourth hour nobody holds «who is left in the
   * slot below» in his head. Cheap because it is a fact about the BLOCK and not about the man - the two
   * best still in the urn one slot down are the same for all ten of them - so it is computed 25 times
   * and not 250. The keepers are the exception and are done per man, because there the alternative is
   * another keeper of his OWN slot and he cannot be his own alternative.
   */
  readonly pairs = computed<Map<number, Alternative | null>>(() => {
    const owners = this.owners();
    const map = this.map();
    const free = (man: PlanciaMan) => !owners.has(man.id);
    const cost = (man: PlanciaMan) => this.offerOf(man.id);
    const out = new Map<number, Alternative | null>();

    for (const block of map.blocks) {
      if (block.role === 'P') {
        for (const man of block.men) {
          if (owners.has(man.id)) continue;
          out.set(man.id, alternativeFor(map, block, free, man.id, cost));
        }
        continue;
      }
      const shared = alternativeFor(map, block, free, -1, cost);
      for (const man of block.men) if (!owners.has(man.id)) out.set(man.id, shared);
    }
    return out;
  });

  // ---------------------------------------------------------------------------------------------
  // GLI ACCOPPIAMENTI FRA PORTIERI (03/09/2026). Una rosa ne schiera UNO, quindi il secondo portiere
  // non e' profondita': e' l'uomo che gioca nelle giornate in cui il primo e' una scommessa. Tutto
  // quello che serve per dirlo e' il CALENDARIO, e la parte che e' una misura - se una partita e'
  // facile - arriva gia' decisa dal bundle.

  private readonly calendarFile = signal<CalendarFile | null>(null);

  /** Il calendario del bundle, o null: senza `fixtures` non c'e' niente da contare, e si dice. */
  readonly calendar = computed<CalendarBook | null>(() => calendarBookFrom(this.calendarFile()));

  /** Quale portiere e' aperto sulla modale. Un id e non un oggetto: la plancia si ridisegna sotto. */
  readonly pairingId = signal<number | null>(null);

  readonly pairingMan = computed<BoardMan | null>(() => {
    const id = this.pairingId();
    if (id == null) return null;
    for (const block of this.blocks()) {
      const man = block.rows.find((row) => row.id === id);
      if (man) return man;
    }
    return null;
  });

  /**
   * La finestra della competizione, dal regolamento che l'operatore dichiara una volta per tutta l'app.
   *
   * Ritagliata sulle giornate che il campionato ha davvero: `to` a 38 su una Bundesliga da 34 non e'
   * una finestra piu' lunga, e' quattro giornate che non esistono. Il taglio si fa qui e non nel conto,
   * cosi' la finestra che si stampa e' quella su cui si e' contato.
   */
  readonly pairingWindow = computed(() => {
    const league = this.options.league();
    const club = this.pairingMan()?.club ?? '';
    const rounds = this.calendar()?.forClub(club)?.rounds ?? 0;
    const from = Math.max(1, Math.round(league.from));
    const to = rounds > 0 ? Math.min(rounds, Math.round(league.to)) : Math.round(league.to);
    return { from, to: Math.max(from, to), rounds };
  });

  /**
   * I portieri con cui accoppiarlo: quelli ANCORA NELL'URNA, perche' sono i soli che si possono ancora
   * comprare, piu' i miei, che sono la coppia che ho gia'. Uno gia' di un altro non e' un consiglio.
   *
   * Solo dello STESSO campionato: una giornata di fantacalcio cade su un turno diverso in ogni lega e
   * per la stagione bersaglio la mappa ne copre cinque su trentuno, quindi accoppiarli sarebbe
   * inventare un calendario. Quelli lasciati fuori sono CONTATI e la modale lo dice.
   */
  readonly keeperPairs = computed<{
    suggestions: PairSuggestion<BoardMan>[];
    otherLeague: number;
    taken: number;
    deputies: number;
    covered: number;
  }>(() => {
    const man = this.pairingMan();
    const book = this.calendar();
    const calendar = man && book ? book.forClub(man.club) : null;
    if (!man || !book || !calendar) {
      return { suggestions: [], otherLeague: 0, taken: 0, deputies: 0, covered: 0 };
    }

    const { from, to } = this.pairingWindow();
    const first = this.boardKeeperIds();
    const candidates: { man: BoardMan; club: string }[] = [];
    let otherLeague = 0;
    let taken = 0;
    let deputies = 0;
    let covered = 0;
    for (const block of this.blocks()) {
      if (block.role !== 'P') continue;
      for (const row of block.rows) {
        if (row.id === man.id) continue;
        if (row.state === 'altro') {
          taken += 1;
          continue;
        }
        if (!calendar.has(row.club)) {
          otherLeague += 1;
          continue;
        }
        // SOLO I PRIMI PORTIERI (istruzione dell'operatore, 03/09/2026: «non mostrare sia Meret che
        // Milinkovic S.»). Chi il campetto NON schiera non e' un accoppiamento: di un club gioca un
        // portiere, quindi il vice non aggiunge una giornata a nessuno. Il primo si legge dal
        // campetto del toolkit - la stessa mappa che intesta le colonne della griglia - e per
        // IDENTITA'. Dove il campetto non c'e' la mappa non ha una voce e non si esclude nessuno:
        // «vuoto = ignoto», e nascondere un portiere di cui non sappiamo il posto e' inventare.
        const owner = first.get(row.club);
        if (owner != null && owner !== row.id) {
          deputies += 1;
          continue;
        }
        // NON I PORTIERI DI UN CLUB CHE E' GIA' COPERTO DA SOLO: la sua regola del 03/09/2026,
        // «non consigliare i portieri di squadre che da sole hanno gia' 25 o piu' partite facili»,
        // che ha sostituito la prima lettura («via il primo slot», cioe' per PREZZO) ritrattandola
        // lui stesso. Il PREZZO era la quantita' sbagliata: su Butez quel taglio escludeva undici
        // dei quattordici migliori compagni - Skorupski compreso, che e' venuto a cercare - mentre
        // Provedel usciva primo non perche' costa (FVM 5) ma perche' e' dell'Inter, che da sola ne
        // ha 34. «Scontato» e' una proprieta' del CALENDARIO, non del cartellino.
        //
        // La soglia vive nel core come QUOTA della finestra (`EASY_ALREADY_SHARE`), o su una
        // competizione di tre giornate nessuno avrebbe mai 25 di niente.
        if (
          aloneCover(calendar, row.club, from, to) >=
          EASY_ALREADY_SHARE * this.windowRounds(calendar, row.club, from, to)
        ) {
          covered += 1;
          continue;
        }
        candidates.push({ man: row, club: row.club });
      }
    }
    return {
      suggestions: rankPairs(calendar, man.club, candidates, from, to),
      otherLeague,
      taken,
      deputies,
      covered,
    };
  });

  /** Quante partite ha un club DENTRO la finestra: il denominatore della sua quota, contato e mai
   *  `to - from` - una giornata che quel club non gioca non e' una giornata mancata. */
  private windowRounds(
    calendar: NonNullable<ReturnType<CalendarBook['forClub']>>,
    club: string,
    from: number,
    to: number,
  ): number {
    return calendar.window(club, from, to).length;
  }

  /**
   * LA GRIGLIA: ogni squadra del campionato contro ogni altra, e il portiere che ogni club schiera.
   *
   * Il portiere titolare NON si sceglie qui: e' il primo della linea P della board che il TOOLKIT ha
   * disegnato (`boards.json`), quindi l'undici di questa pagina e l'undici del pannello sono la stessa
   * chiamata. Un club senza board porta la casella senza nome invece di un portiere scelto in un
   * secondo modo.
   */
  private readonly boardKeepers = signal<Map<string, string>>(new Map());

  readonly keeperOfClub = computed(() => this.boardKeepers());

  /** Chi il campetto schiera, per identita': la sola cosa che dice «primo portiere» senza inventarla. */
  private readonly boardKeeperIds = signal<Map<string, number>>(new Map());

  readonly keeperGrid = computed<{
    clubs: string[];
    cells: Map<string, Map<string, GridCell>>;
  } | null>(() => {
    const man = this.pairingMan();
    const calendar = man ? this.calendar()?.forClub(man.club) : null;
    if (!calendar) return null;
    const { from, to } = this.pairingWindow();
    const clubs = calendar.clubNames();
    return { clubs, cells: coverGrid(calendar, clubs, from, to) };
  });

  /** Apre gli accoppiamenti su un portiere. NON mette niente in asta: sono due gesti diversi. */
  openPairs(id: number | null): void {
    this.pairingId.set(id);
  }

  /**
   * LE CARD APERTE: PIÙ DI UNA, perché servono a confrontare - e ognuna con il suo POSTO.
   *
   * Sua richiesta del 04/09/2026 («deve essere possibile aprire più card contemporaneamente così si
   * possono confrontare»), e cambia la struttura e non il numero: un `id | null` che diventa un tetto
   * di due sarebbe una soglia inventata da me.
   *
   * La REGOLA del posto e di chi sta davanti se n'è andata in `core/player-card.ts` il 05/09/2026,
   * quando l'operatore ha chiesto la stessa card sulla Strategia: due pagine, due pile - le card della
   * plancia non devono seguirti altrove - ma UNA sola definizione di dove nasce una card, o due pagine
   * disporrebbero le stesse card in due modi.
   */
  private readonly cards = new CardStack();

  readonly cardMen = computed<{ man: CardMan; slot: number; key: CardKey }[]>(() => {
    const byId = new Map<number, { man: BoardMan; block: BoardBlock }>();
    for (const block of this.blocks()) {
      for (const row of block.rows) byId.set(row.id, { man: row, block });
    }
    const numbers = this.numbers();
    const rounds = this.seasonRounds();
    // Chi non è più in mappa esce da sé: la coda si compra a un credito e non ha una riga, quindi non
    // ha una card - e una card che sopravvive alla propria riga mostrerebbe numeri di un altro giro.
    return this.cards.place((key) => {
      const id = playerOfCard(key);
      const found = id == null ? undefined : byId.get(id);
      return found
        ? cardManOf(found.man, found.block, numbers.get(id as number) ?? null, rounds)
        : undefined;
    });
  });

  /**
   * LE CARD DI UNA SQUADRA, dalla STESSA pila dei calciatori.
   *
   * Nascono dal click sul nome del club dentro la card di un uomo (operatore, 23/09/2026). Una pila sola
   * per le due specie perche' il POSTO e chi sta DAVANTI sono globali allo schermo: due pile darebbero
   * lo stesso posto a due card aperte insieme, e due «davanti» contemporanei - cioe' una card toccata
   * che non passa davanti alle altre.
   */
  readonly clubCards = computed(() => this.cards.place((key) => clubOfCard(key) ?? undefined));

  /**
   * QUANTE CARD SONO A SCHERMO, e non quante ne tiene la pila: sono due numeri diversi.
   *
   * Una card di calciatore ESCE DA SE' quando la sua riga non c'e' piu' - si cambia club sulla vista
   * Squadre, si aggiudica un uomo sulla plancia - perche' una card che sopravvive alla propria riga
   * mostrerebbe i numeri di dieci minuti prima. La pila pero' la tiene ancora, quindi contando LEI il
   * tasto direbbe «chiudi le 2 card» sopra uno schermo senza nessuna card: un conteggio che descrive
   * una lista diversa da quella disegnata, che e' il difetto che questo progetto paga da sempre.
   */
  readonly cardCount = computed(() => this.cardMen().length + this.clubCards().length);

  readonly frontCard = computed(() => this.cards.front());

  openCard(id: number | null): void {
    this.cards.openCard(id == null ? null : playerCard(id));
  }

  openClubCard(platform: Platform, club: string): void {
    this.cards.openCard(clubCard(platform, club));
  }

  /** Toccata: davanti alle altre. Un click o un trascinamento, che per questo sono la stessa cosa. */
  raiseCard(key: CardKey): void {
    this.cards.raiseCard(key);
  }

  closeCard(key: CardKey): void {
    this.cards.closeCard(key);
  }

  /** I numeri del motore di un uomo, dal lettore unico: la card non ne apre un secondo. */
  numbersFor(id: number): EngineNumbers | null {
    return this.numbers().get(id) ?? null;
  }

  /**
   * QUALE ROSA E' ACCESA, e non e' un filtro: le righe restano tutte, le altre si smorzano.
   *
   * Sua richiesta del 04/09/2026: «quando faccio click su un box di una squadra -> attiva quella
   * squadra ed evidenzia sulla plancia tutti i calciatori comprati da quella squadra mettendo opacita'
   * 30% a tutti gli altri». E' una lente e non una selezione - togliere le altre righe cambierebbe i
   * blocchi, e i blocchi sono la struttura del mercato: qui non si muove niente, si smorza.
   *
   * `null` e' «nessuna», che e' lo stato normale della pagina.
   */
  readonly activeTeamId = signal<number | null>(null);

  /**
   * Il click ACCENDE, e sulla stessa rosa SPEGNE - una via d'uscita che sta dove sta il gesto.
   *
   * Il secondo click di un DOPPIO click non arriva qui (`MouseEvent.detail`, filtrato nella card):
   * senza quel filtro l'assegnazione col doppio click accenderebbe e spegnerebbe la rosa in mezzo al
   * gesto, cioe' duecentocinquanta righe che sfarfallano mentre si compra un calciatore.
   */
  toggleTeam(teamId: number): void {
    this.activeTeamId.update((at) => (at === teamId ? null : teamId));
  }

  /** Una lente su una rosa che non ha piu' niente non e' una lente: si spegne con l'azzeramento. */
  private clearLens(): void {
    this.activeTeamId.set(null);
  }

  /**
   * THE LENS THAT ACTUALLY EXISTS: the chosen id, guarded against a table that changed under it.
   *
   * The board can be handed a WHOLE NEW table - «Cambia asta» connects to a live session, the fixture
   * is re-rolled - and the ids come from that new table. An id nobody has any more dims all 250 rows
   * while the bar draws no badge and therefore no way out, which is the half-off screen this lens
   * exists not to produce. Same shape as `AuctionFeed.followed`, which answers null when the id is
   * gone; a new table reusing the id would be a DIFFERENT squad, so `startDemo`/`connect` clear it too.
   *
   * Every reader goes through here - the strip, the count and the board - or one of them would light a
   * squad the other two cannot see.
   */
  readonly lensId = computed<number | null>(() => {
    const at = this.activeTeamId();
    if (at == null) return null;
    return this.feed.teams().some((team) => team.id === at) ? at : null;
  });

  /** La rosa accesa come la strip la disegna, o `null`: un lettore solo per la barra e per le card. */
  readonly activeTeam = computed(() => this.teams().find((team) => team.active) ?? null);

  /**
   * Quante righe la plancia le sta evidenziando, e quante ne ha in tutto.
   *
   * Due numeri perche' sono due cose: la CODA non e' disegnata (§la plancia porta 25 slot da `teams`
   * uomini e sotto c'e' un conteggio), quindi una rosa che ha comprato un uomo dalla coda ha piu'
   * acquisti di quanti se ne accendano. Dirne uno solo farebbe leggere l'altro come un difetto.
   */
  readonly activeCount = computed(() => {
    const at = this.lensId();
    if (at == null) return null;
    const drawn = this.blocks()
      .flatMap((block) => block.rows)
      .filter((row) => row.ownerId === at).length;
    const bought = this.feed.picks().filter((pick) => pick.teamId === at).length;
    return { drawn, bought };
  });

  readonly teams = computed<BoardTeam[]>(() => {
    const mine = this.mineId();
    const active = this.lensId();
    const lot = this.lot();
    const role = lot?.role ?? null;
    const floor = lot?.advice.band?.low ?? 1;

    return this.feed.teams().map((team) => {
      const missing = ROLES.map((entry) => team.missing[ROLE_ZONE[entry]] ?? 0);
      const wantsRole = role ? (team.missing[ROLE_ZONE[role]] ?? 0) > 0 : false;
      const canPay = team.budgetLeft >= Math.max(1, floor);
      return {
        id: team.id,
        label: team.label,
        colour: team.colour,
        credits: team.budgetLeft,
        missing,
        me: team.id === mine,
        rival: team.id !== mine && wantsRole && canPay,
        out: team.id !== mine && !canPay,
        active: team.id === active,
      };
    });
  });

  /** How much of the auction is gone, per role: the only progress figure a free extraction has. */
  readonly progress = computed(() =>
    ROLES.map((role) => {
      const blocks = this.map().byRole.get(role) ?? [];
      const total = blocks.length * this.teamsCount();
      // GLI ASSEGNATI SI CONTANO, non si ricavano dai posti vuoti (04/09/2026): `capienza - rimasti`
      // conta come «gia' assegnato» anche un uomo che nel blocco non e' MAI entrato - chi la plancia
      // lascia fuori perche' gioca troppo poco (`MIN_PLAY_SHARE`). Con l'assicurazione due centrocampisti
      // hanno cominciato a cadere sotto quella soglia e la barra leggeva «C 2/80» su un tavolo azzerato,
      // cioe' due acquisti che nessuno aveva fatto. Quanti restano fuori lo dice gia' il tooltip del
      // blocco, che e' il posto dove quella frase e' vera.
      const done = blocks.reduce((sum, block) => {
        const rows = this.blockById().get(block.id)?.rows ?? [];
        return sum + rows.filter((man) => man.state === 'mio' || man.state === 'altro').length;
      }, 0);
      return { role, done, total };
    }),
  );

  /*
   * QUANTO NON SI DISEGNA PIU' IN BARRA, e vale la pena dire cosa c'era.
   *
   * Un blocco di prosa e non un JSDoc: qui sotto non c'e' niente da documentare, e un doc-comment senza
   * una dichiarazione dopo di lui si attacca a quella successiva - `tail`, che non ne parla.
   *
   * Qui vivevano `outNowCount` / `outNowNote` («N saltano la prossima») e `excluded` / `excludedNote`
   * («N fuori lista»), due pastiglie che l'operatore ha fatto togliere il 04/09/2026: «queste due
   * etichette non servono». Togliere il CODICE e non solo il markup e' la stessa regola di un output
   * che nessuno emette - un calcolo che nessuna vista legge e' un contratto che mente a chi lo trova.
   *
   * Dove sono finite le due frasi: la prima da nessuna parte, perche' dichiarava un vincolo che era
   * stato ritirato poche ore prima (chi oggi non gioca non scende e non si barra piu'); la seconda nel
   * tooltip del BLOCCO corto, che porta conto, nomi e soglia - `SlotBlock.excluded` non e' toccato, e'
   * la barra che non lo legge piu'.
   */

  /** The tail: a count and no names, because a board that hides it talks you into waiting. */
  readonly tail = computed(() => {
    const owners = this.owners();
    return this.map().tail.filter((man) => !owners.has(man.id)).length;
  });

  /**
   * Opens the board on an invented table. Called on load, so the page never opens on a code field.
   *
   * `force` re-rolls it; without it a board that already has a table is left alone, or navigating back
   * would throw away an auction the operator is in the middle of.
   *
   * `progress` E' ZERO DI DEFAULT (sua istruzione del 23/09/2026): le sedie sono sue, gli acquisti no.
   * La ragione per esteso, e chi chiede l'altro valore, stanno su `DEMO_PROGRESS` e `PLAYED_PROGRESS`.
   */
  async startDemo(force = false, progress = DEMO_PROGRESS): Promise<boolean> {
    if (!force && this.feed.hasTable() && this.men().length) return true;
    this.loading.set(true);
    this.error.set(null);
    try {
      const players = await this.loadListone();
      // The STANDARD settings and not the sheet's: what the fixture is for is testing the board on the
      // league every published number of the bench is measured against (ten seats, 1000 credits,
      // 3/8/8/6). A sheet built for a twelve-team league would silently change the width of every slot,
      // which is the one coordinate the whole page stands on.
      const auction = buildRandomAuction({ players, ...STANDARD_LEAGUE, progress });
      this.feed.startDemo(auction);
      // A NEW TABLE IS A NEW SET OF SQUADS: the lens cannot survive it, because an id that happens to
      // exist on the new table names a DIFFERENT squad. `lensId` already refuses one that is gone.
      this.clearLens();
      this.setLot(auction.lotId);
      // The drawn name can be one of the TAIL's, which has no block and therefore no advice: the board
      // must still open on a decision, so it falls back to the first man still in the urn - in map
      // order, so the fixture stays reproducible.
      if (!this.lot()) this.setLot(this.firstFree());
      return true;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Non riesco ad aprire la plancia.');
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * APRE LA PLANCIA: prima l'asta vera che questo browser stava seguendo, poi il tavolo inventato.
   *
   * L'ORDINE E' FORZATO, la stessa regola che `/auction` applica dal 03/09/2026 e che questa pagina non
   * aveva ereditato: la finzione parte SOLO se non c'e' niente da riprendere, altrimenti sovrascriverebbe
   * un'asta che l'operatore sta giocando. Costava una riconnessione a mano a ogni refresh - e un refresh
   * a meta' asta non e' un caso di laboratorio, e' quello che si fa quando una pagina sembra ferma.
   *
   * IL LISTONE PRIMA DI TUTTO, e non e' un dettaglio d'ordine: `startDemo` decide di non fare niente
   * guardando `men()`, che e' vuoto finche' il foglio non e' letto - quindi con un ripescaggio riuscito e
   * il listone ancora fuori, la finzione partirebbe sopra l'asta appena ripresa. E si carica comunque,
   * collegati o no, perche' il listone della plancia viene dal FOGLIO e non dalla sessione: i due si
   * incontrano su `fc_id`, che e' la chiave primaria di questo progetto, quindi un tavolo vero prezza i
   * suoi uomini con gli stessi numeri della finzione. Quello che il tavolo vero porta sono le rose, i
   * crediti e gli acquisti.
   *
   * E SI RIPRENDE SOLO SE NON C'E' GIA' UN TAVOLO: tornare qui da un'altra pagina non deve ne' buttare
   * via quello che c'e' ne' riaprire un secondo stream sulla stessa sessione (`connect` con `preserve`
   * non chiude il precedente).
   */
  async open(progress = DEMO_PROGRESS): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.loadListone();
      if (!this.feed.hasTable()) await this.feed.restore();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Non riesco ad aprire la plancia.');
      return false;
    } finally {
      this.loading.set(false);
    }
    return this.startDemo(false, progress);
  }

  /** Names the lot on the table. `null` clears it - between two extractions there is no lot. */
  setLot(id: number | null): void {
    this.named.set({ table: this.feed.code(), id });
    this.typedPrice.set(0);
  }

  /**
   * NOMINA IL LOTTO, e un uomo che ha gia' un padrone non si puo' nominare.
   *
   * `setLot` non chiede niente a nessuno perche' i suoi chiamanti interni sanno gia' cosa gli stanno
   * passando (l'estrazione, l'apertura del tavolo, l'azzeramento). Questo e' il percorso dell'OPERATORE
   * - il bottone dentro la card e, dal 23/09/2026, il doppio click su una riga - e li' il nome puo'
   * essere di chiunque: il bottone si disegna solo su chi e' nell'urna, il doppio click arriva da tutte
   * e 250 le righe. Un lotto che porta un uomo gia' venduto farebbe leggere una banda, un verdetto e
   * delle mani alzate su una decisione che nessuno puo' piu' prendere.
   *
   * Il rifiuto DICE perche' e nomina il padrone: un gesto che non fa niente in silenzio e'
   * indistinguibile da un gesto rotto, che e' la stessa ragione per cui `award` scrive la sua.
   */
  nameLot(id: number): boolean {
    // IL TAVOLO PARLA E NOI NO. Da quando una sessione a rilanci pubblica chi e' in asta, metterci un
    // altro nome a mano non farebbe niente - il prossimo evento dello stream lo rimpiazzerebbe - e un
    // gesto che non fa niente in silenzio e' indistinguibile da un gesto rotto. Quindi si rifiuta
    // DICENDO chi c'e' e chi lo dice, e resta il click, che apre la card di chiunque.
    const live = this.feed.selectedPlayerId();
    if (live != null && live !== id && !this.owners().has(live)) {
      const who = this.men().find((man) => man.id === live)?.name ?? 'un altro';
      this.error.set(
        `In asta c'è ${who}, e lo dice il tavolo: su ${this.feed.code()} il nome lo pubblica il ` +
          'banditore. Clicca un nome per aprirne la card.',
      );
      return false;
    }
    const owner = this.owners().get(id);
    if (owner) {
      const who = this.feed.teams().find((team) => team.id === owner.teamId)?.label ?? 'un altro';
      const name = this.men().find((man) => man.id === id)?.name ?? 'Questo nome';
      this.error.set(`${name} è già di ${who}: in asta ci va uno che nessuno ha ancora preso.`);
      return false;
    }
    this.error.set(null);
    this.setLot(id);
    return true;
  }

  /** The first man still in the urn, in map order. Deterministic: a fixture nobody can reproduce is a
   *  fixture nobody can report a defect about. */
  private firstFree(): number | null {
    const owners = this.owners();
    for (const block of this.map().blocks) {
      const free = block.men.find((man) => !owners.has(man.id));
      if (free) return free.id;
    }
    return null;
  }

  /** Draws the next name out of the urn. Only the fixture can do this: a real urn is not ours to turn. */
  drawNext(): void {
    if (!this.demo()) return;
    const owners = this.owners();
    const free = this.map()
      .blocks.flatMap((block) => block.men)
      .filter((man) => !owners.has(man.id) && man.id !== this.lotId());
    if (!free.length) return this.setLot(null);
    this.setLot(free[Math.floor(Math.random() * free.length)].id);
  }

  /**
   * ASSEGNA IL LOTTO A UNA ROSA: il doppio click sulla card di una squadra (operatore, 04/09/2026).
   *
   * È il gesto che rende la plancia utilizzabile alla SUA asta: là l'urna la gira un software di
   * qualcun altro e questo pannello non è collegato (la connessione è un bottone, 03/09/2026), quindi
   * l'unica cosa che il tavolo non può sapere da sé è chi si è preso il lotto e a quanto.
   *
   * IL PREZZO NON HA UN VALORE DI CORTESIA. Zero vuol dire «nessuno ha ancora offerto», non «un
   * credito», e i crediti di ogni rosa sono la quantità su cui poggia ogni tetto di questa pagina -
   * quindi un'assegnazione a un prezzo che nessuno ha scritto è un acquisto inventato, e si rifiuta
   * dicendolo. La cifra è quella della riga del lotto, che lui tiene aggiornata mentre i rilanci
   * salgono perché è la stessa che fa il verdetto.
   *
   * DUE RIFIUTI CHE SONO DEL REGOLAMENTO E NON MIEI: un reparto completo e una borsa che non arriva.
   * Un doppio click è un gesto grosso, e un acquisto impossibile lasciato passare darebbe a una rosa
   * ventisei posti o crediti negativi, cioè un tavolo che non esiste. Ognuno dice a schermo perché.
   */
  award(teamId: number): boolean {
    const lot = this.lot();
    if (!lot) {
      this.error.set(
        'Nessun calciatore in asta: estrai un nome, o aprilo dalla plancia e premi «in asta», ' +
          'prima di assegnarlo a una rosa.',
      );
      return false;
    }
    const team = this.feed.teams().find((one) => one.id === teamId);
    if (!team) return false;

    const price = Math.round(this.lotPrice());
    if (!(price > 0)) {
      this.error.set(
        `Scrivi quanto è stato pagato ${lot.man.name} nella riga in cima: a prezzo zero ` +
          "l'assegnazione sarebbe un acquisto inventato, e i crediti di ogni rosa reggono tutti i " +
          'tetti di questa pagina.',
      );
      return false;
    }
    if ((team.missing[ROLE_ZONE[lot.role]] ?? 0) <= 0) {
      this.error.set(`${team.label} ha il reparto ${lot.role} completo: non può prenderlo.`);
      return false;
    }
    if (team.budgetLeft < price) {
      this.error.set(
        `${team.label} ha ${team.budgetLeft} crediti e ${lot.man.name} ne costa ${price}.`,
      );
      return false;
    }
    if (!this.feed.awardByHand(lot.man.id, teamId, price)) {
      this.error.set(
        this.live()
          ? `Sei collegato a ${this.feed.code()}: le rose di un'asta vera le scrive il banditore, ` +
              'e la prossima riga in arrivo cancellerebbe quello che scrivessimo noi.'
          : `${lot.man.name} è già di qualcuno.`,
      );
      return false;
    }
    this.error.set(null);
    // Il lotto si SVUOTA: l'uomo appena assegnato non è più nell'urna, e lasciarlo «in asta» sarebbe
    // una riga che dice due cose diverse su di lui (lo stato del lotto viene letto prima di quello del
    // proprietario). Il prossimo nome lo porta l'estrazione - vera o del banco.
    this.setLot(null);
    return true;
  }

  /**
   * AZZERA LE ROSE: nessun acquisto, borse piene, tutti i nomi di nuovo nell'urna.
   *
   * Sua richiesta del 04/09/2026, e la RAGIONE per cui esiste e' cambiata il 23/09: nasceva perche' il
   * tavolo inventato si giocava da se' un terzo dell'asta prima di consegnare la plancia, e adesso che
   * apre vuoto (`DEMO_PROGRESS` = 0) il tasto serve a ricominciare da capo a meta' sessione - che e' la
   * stessa cosa fatta quando serve invece che a ogni apertura. Resta necessario: su un tavolo giocato a
   * mano, o chiesto giocato (`PLAYED_PROGRESS`), e' l'unico modo di tornare a zero.
   *
   * Quello che NON si tocca è il regolamento - dieci sedie, 1000 crediti, 3·8·8·6 e le dieci etichette
   * restano, perché sono le impostazioni della lega e non lo stato dell'asta.
   */
  resetSquads(): boolean {
    if (!this.feed.emptySquads()) {
      this.error.set(
        `Sei collegato a ${this.feed.code()}: le rose di un'asta vera non sono nostre da azzerare.`,
      );
      return false;
    }
    this.error.set(null);
    this.setLot(null);
    // ...e la lente si spegne con le rose: una lente su una rosa vuota smorzerebbe 250 righe per
    // evidenziarne zero, cioe' uno schermo spento senza una ragione leggibile.
    this.clearLens();
    return true;
  }

  private async loadListone(): Promise<AuctionPlayer[]> {
    if (this.listone().length) return this.listone();

    const manifest = await this.bundle.manifest();
    const sheets = manifest.engine_sheets ?? [];
    if (!sheets.length) {
      throw new Error(
        'Il bundle non porta nessun foglio del motore: senza numeri la plancia mostrerebbe solo caselle vuote. ' +
          'Lancia "snapshot --league NOME" e poi "export".',
      );
    }
    // THE SHEET HAS TO MATCH THE LEAGUE, and not merely be the fattest one.
    //
    // The ladder every max offer stands on is measured on the operator's OWN auctions - ten seats, 1000
    // credits, 3/8/8/6, the classic Serie A listone (§19.3) - so pricing a EuroLeghe board with it would
    // be applying a parameter outside the population it was fitted on, which is the mistake this
    // repository has paid for more than once. Serie A classic first, then whatever prices the most men,
    // and the header always NAMES the sheet it ended up with.
    const suits = (sheet: EngineSheetEntry) =>
      sheet.platform === 'default' && sheet.game === 'classic';
    const chosen =
      [...sheets].filter(suits).sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0))[0] ??
      [...sheets].sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0))[0];
    const table = await this.bundle.table(chosen.path.replace(/\.json(\.gz)?$/, ''));

    this.sheet.set(chosen);
    this.seasonRounds.set(seasonRoundsOf(table.matchdays, chosen.matchdays_target));
    const numbers = engineNumbersFrom(table);
    this.numbers.set(numbers);
    // QUANTO VALE UNA PAROLA su questo foglio, consegnato a chi tiene le dritte dell'operatore: questa
    // pagina legge il foglio da se' e non passa da `ValuationStore`, quindi senza questa riga il
    // selettore della card stamperebbe un trattino al posto delle giornate di ogni gradino.
    this.rulings.observe(chosen.platform, rungShares([...numbers.values()]));
    // Il calendario, i portieri titolari e la stagione scorsa: nessuno dei tre e' necessario per
    // disegnare la plancia, quindi un bundle che non li porta la apre lo stesso e chi li legge lo dice.
    void this.loadCalendar();
    void this.loadLastSeason(manifest.input_season, chosen.platform);
    void this.loadBoardKeepers(chosen);

    const prices = await this.prices(manifest.target_season, chosen.platform);
    const players = demoPlayers(table, prices, false);
    if (!players.length) {
      throw new Error(
        `Nessun giocatore del foglio "${chosen.league}" è quotato sul listone ${chosen.platform} ` +
          `${manifest.target_season}: senza prezzo non c'è una plancia da disegnare.`,
      );
    }
    this.listone.set(players);
    return players;
  }

  private async loadCalendar(): Promise<void> {
    if (this.calendarFile()) return;
    this.calendarFile.set(await this.bundle.calendar());
  }

  /**
   * LE TRE MISURE DELLA STAGIONE SCORSA, per il set di numeri che la select offre.
   *
   * `season_stats` e basta - 133 KB, e `Bundle` la tiene in cache, quindi una pagina che l'ha gia'
   * chiesta non la ripaga. Il livello per-partita NON si chiede: sono 2,1 MB per quattro campi che
   * questa riga non stampa, ed e' per poterlo omettere che `seasonLines` ha quel parametro opzionale.
   *
   * E la PIATTAFORMA e' quella del foglio: la stessa riga di `season_stats` esiste su due calendari
   * (31 giornate su euro, 38 su default) e leggere quella sbagliata darebbe a un uomo due stagioni.
   */
  private async loadLastSeason(season: string | null, platform: string): Promise<void> {
    if (!season || this.lastSeason().size) return;
    const seasonStats = await this.bundle.table('season_stats');
    const lines = seasonLines({ seasonStats, platform: platform as Platform, seasons: [season] });
    const out = new Map<number, SeasonLine>();
    for (const [id, bySeason] of lines) {
      const line = bySeason.get(season);
      if (line) out.set(id, line);
    }
    this.lastSeason.set(out);
    this.lastSeasonLabel.set(season);
  }

  /**
   * IL PORTIERE TITOLARE DI OGNI CLUB, letto dalla board che il TOOLKIT ha disegnato.
   *
   * Mai scelto qui. «L'app legge la board e mai la propria» vale per l'undici di un club vero, che e'
   * una previsione su una persona: il primo della linea P di `boards.json` e' il portiere che il
   * pannello schiera, e sceglierlo in un secondo modo darebbe a un club due portieri titolari. Un club
   * senza board resta senza nome, che e' quello che la griglia deve mostrare.
   */
  private async loadBoardKeepers(sheet: EngineSheetEntry): Promise<void> {
    if (!sheet.boards || this.boardKeepers().size) return;
    const boards = await this.bundle.boards(sheet.boards);
    if (!boards?.clubs) return;
    const out = new Map<string, string>();
    const ids = new Map<string, number>();
    for (const [club, board] of Object.entries(boards.clubs)) {
      const first = board.lines?.['P']?.[0];
      if (first?.name) out.set(club, first.name);
      // The ID and not the name: «an entity joins through its canonical key, never through the string
      // a source uses to name it» - and the suggestions filter on exactly this.
      if (first?.fc_id != null) ids.set(club, Number(first.fc_id));
    }
    this.boardKeepers.set(out);
    this.boardKeeperIds.set(ids);
  }

  /**
   * The FVM of the auction day, per player.
   *
   * Frozen on purpose: a coordinate that reshuffles between two sessions is a bad coordinate - moving
   * from Qt.I to FVM today alone moves 154 men of 527 into a different slot.
   */
  private async prices(season: string, platform: string): Promise<Map<number, number>> {
    const table = await this.bundle.table('listone_quotes');
    const at = (name: string) => table.columns.indexOf(name);
    const columns = {
      id: at('fc_id'),
      season: at('season'),
      platform: at('platform'),
      fvm: at('fvm'),
    };
    const out = new Map<number, number>();
    for (const row of table.rows) {
      if (String(row[columns.season]) !== season) continue;
      if (String(row[columns.platform]) !== platform) continue;
      const fvm = Number(row[columns.fvm]);
      if (fvm > 0) out.set(Number(row[columns.id]), fvm);
    }
    return out;
  }
}

/**
 * I MIEI IN CIMA AL BLOCCO (sua richiesta, 03/09/2026), e sotto di loro l'ordine misurato INTATTO.
 *
 * `sort` in JS e' stabile, quindi questo e' un PREFISSO e non un riordino - la stessa forma dell'ordine
 * personale dei blocchi della pagina strategia. Vale sulla plancia del MERCATO, dove l'ordine del
 * blocco e' il valore atteso (§23.2) e il prefisso e' un'aggiunta dichiarata sopra di esso; NON sulla
 * griglia personale, dove la colonna e' l'ordine e appuntare dei nomi in cima si leggerebbe come un
 * ordinamento rotto. Due tagli, due promesse, e la regola sta dove la promessa la regge.
 */
function mineFirst(rows: BoardMan[]): BoardMan[] {
  return [...rows].sort(
    (left, right) => (right.state === 'mio' ? 1 : 0) - (left.state === 'mio' ? 1 : 0),
  );
}

/** The median of the numbers that exist. A null is not a zero, so it is not in the sample. */
function middleOf(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null).sort((a, b) => a - b);
  if (!known.length) return null;
  const middle = known.length >> 1;
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
}

/**
 * UNA RIGA DELLA PLANCIA COME LA CARD LA VUOLE.
 *
 * Traduce e non ricalcola: ogni numero e' gia' stato deciso dalla riga (`men`, `buildMap`, `offerBand`),
 * e la card ne e' il terzo lettore dopo il blocco e il lotto. Due strade per una cifra sono come un uomo
 * finisce con due valutazioni.
 *
 * IL PIATTAFORMA E' `default` PERCHE' LA PLANCIA PREZZA SEMPRE IL LISTONE CLASSIC DI SERIE A
 * (`loadSheet`, che sceglie `default|classic` per primo e lo NOMINA in intestazione): le partite che la
 * card mostra sono quelle di quel calendario, e passare la piattaforma sbagliata mostrerebbe le giornate
 * di un altro gioco sotto lo stesso nome.
 */
function cardManOf(
  man: BoardMan,
  block: BoardBlock,
  numbers: EngineNumbers | null,
  rounds: number | null,
): CardMan {
  const inUrn = man.state === 'urna' || man.state === 'asta';
  const band = man.band;
  return {
    id: man.id,
    name: man.name,
    club: man.club,
    // Il listone d'asta non porta l'identita' di un club: la card la risolve dal nome, e solo per lo
    // stemma. Un fatto che decide un numero non passerebbe mai di li'.
    clubId: null,
    where: `${man.role}${block.index}`,
    role: man.role,
    platform: 'default',
    edge: man.edge,
    pv: man.pv,
    rounds,
    // LO SWING della RIGA e non un secondo conto: la plancia ordina dentro lo slot su queste stesse
    // valutazioni, quindi la card e la riga devono portare la stessa cifra.
    swing: man.swing,
    // La fantamedia che la RIGA sta usando: `basis` lo ha gia' deciso a monte (`valuationOf`), o la card
    // direbbe un numero e la riga un altro.
    fm: man.basis === 'estimated' ? (numbers?.estFm ?? null) : (numbers?.fm ?? null),
    estimated: man.basis === 'estimated',
    estNote: numbers?.estNote ?? null,
    titolarita: numbers?.titolarita ?? null,
    titolaritaPlay: numbers?.titolaritaPlay ?? null,
    minutesNext: numbers?.minutesNext ?? null,
    seasonMatches: numbers?.seasonMatches ?? null,
    category: numbers?.category ?? null,
    categoryLevel: numbers?.categoryLevel ?? null,
    categoryBars: numbers?.categoryBars ?? null,
    minutesFullSeason: numbers?.minutesFullSeason ?? null,
    unpricedReason: numbers?.unpricedReason ?? null,
    fvm: man.fvm,
    out: man.out ?? null,
    market: {
      // DUE SIGNIFICATI SU UNA CIFRA SOLA, e la riga dice quale dei due e': la max offerta finche' e'
      // nell'urna, il prezzo PAGATO quando e' di qualcuno.
      label: inUrn ? 'max offerta' : 'pagato',
      band: inUrn && band ? { low: band.low, high: band.high } : null,
      price: man.price,
      ownerLabel: man.ownerLabel,
      ownerColour: man.ownerColour,
      capNote: capNoteOf(man, block),
      inUrn: man.state === 'urna',
      keeper: man.role === 'P',
    },
  };
}

/**
 * PERCHE' IL TETTO E' QUELLO, quando non e' il suo slot a deciderlo.
 *
 * Una max offerta piu' bassa senza una parola si legge come un errore, ed e' la stessa regola per cui la
 * finestra dell'infortunio sta scritta sopra: «un vincolo che agisce in silenzio e' indistinguibile da un
 * ordinamento rotto». Sul lotto la ragione la scrive `adviseLot`; la card si apre anche su chi non e' in
 * asta, quindi la ragione se la deve dire da sola.
 */
function capNoteOf(man: BoardMan, block: BoardBlock): string | null {
  const band = man.band;
  if (!band) return null;
  if (band.bet) return `Tetto dichiarato per una scommessa: ${band.high} crediti, non di piu'.`;
  // PRIMA DELLA DEMOZIONE, o la frase dell'infortunato finirebbe addosso a chi non ha uno slot: il
  // suo `pricedAt` e' 0 e non coinciderebbe mai con quello del blocco in cui e' finito.
  if (man.fromTail) {
    return `Sotto l'ultimo slot: la scala delle offerte non arriva fin li', quindi resta il minimo dell'asta.`;
  }
  if (band.pricedAt !== block.index) {
    return `Prezzato come uno slot ${band.pricedAt}: infortunato oggi, non lo pago da primo.`;
  }
  // ...e il club che ho gia', che era il fattore muto: la percentuale la porta la riga
  // (`sameClubCut`), calcolata dalla scala una volta sola, cosi' la card non ha una seconda copia di
  // quei numeri da tenere allineata.
  if (man.sameClubCut > 0) {
    return `Di quel club ne hai gia' in rosa: offro il ${Math.round(man.sameClubCut * 100)}% in meno per non concentrare il rischio.`;
  }
  return null;
}
