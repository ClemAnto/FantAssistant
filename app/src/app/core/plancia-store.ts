/**
 * The state behind `/plancia`: the slot board of a random-extraction auction.
 *
 * Two sources, one shape. By DEFAULT the board opens on an invented table with the standard league
 * settings (`plancia-demo.ts`), and connecting to a real fanta-asta session is something the operator
 * ASKS for with a button - his decision of 03/09/2026, and it holds for the draft panel too. The rest
 * of this file cannot tell the two apart, which is the point: one set of numbers, and a banner that
 * says which table they describe.
 *
 * WHAT A LIVE SESSION DOES NOT CARRY, stated instead of invented: fanta-asta-live publishes the raise
 * MECHANICS (`options.bids`: countdown, minimum bid, buzzer) and this project has never observed a node
 * naming the lot currently on the table. So the lot is drawn by the fixture in demo and NAMED BY HAND
 * when live, and `lotSource` says which - a field guessed from a payload nobody has read would be the
 * defect this repository has already paid for.
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
import { GlobalOptions } from './global-options';
import { CardMan, CardStack } from './player-card';
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
  OfferBand,
  PlanciaMan,
  PlanciaMap,
  Role,
  ROLES,
  SlotBlock,
  adviseLot,
  alternativeFor,
  buildMap,
  offerBand,
  regroupByOffer,
  SlotView,
} from './plancia';
import { STANDARD_LEAGUE, buildRandomAuction, roleOf } from './plancia-demo';
import { swingOf } from './swing';

/** The four letters of the board's lines, from the two alphabets the feed splits the outfield into. */
const ZONE_ROLE: Record<string, Role> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };
const ROLE_ZONE: Record<Role, Zone> = { P: 'gk', D: 'def', C: 'mid', A: 'atk' };

export type LotSource = 'demo' | 'manual' | 'none';

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
  ownerId: number | null;
  ownerLabel: string | null;
  ownerColour: string | null;
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
  block: BoardBlock;
  /** What the table is at right now. Zero before anybody has bid. */
  price: number;
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
  private readonly options = inject(GlobalOptions);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Which sheet prices the board, so the page can NAME it with its revision. */
  readonly sheet = signal<EngineSheetEntry | null>(null);

  private readonly numbers = signal<Map<number, EngineNumbers>>(new Map());
  private readonly listone = signal<AuctionPlayer[]>([]);

  private readonly lotId = signal<number | null>(null);
  readonly lotPrice = signal(0);
  readonly lotSource = signal<LotSource>('none');

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
        { id: player.id, club: player.club },
        { pv: valuation.pv, pvIsEstimate: valuation.basis === 'estimated',
          playShare: numbers.get(player.id)?.titolaritaPlay ?? null },
        this.sheet()?.matchdays_target ?? null,
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
        swing: swingOf({
          role,
          surplus,
          pv,
          // Lo zero del foglio e il calendario su cui `pv` e surplus vivono: servono alla ribasatura
          // verso il 6 e al «per giornata» — l'unita' dichiarata dall'operatore (07/09/2026).
          replacement: engine?.replacementFm ?? null,
          matchdays: this.sheet()?.matchdays_target ?? null,
          fm: valuation.fm,
          confidence: valuation.confidence,
          steady: this.ratings.ready()
            ? (this.ratings.for('default', player.id)?.steady?.share ?? null)
            : null,
          seasonFm: played?.fm ?? null,
          seasonPlayed: played?.pv ?? null,
          // La plancia prezza sempre il foglio default|classic, e li' una riga MISURATA porta gia'
          // la miscela in-season (R25K40 adottata il 07/09/2026): la correzione resta alle stimate.
          fmBlendsSeen: valuation.basis === 'measured',
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
  private readonly mineByClub = computed<Map<string, number>>(() => {
    const mine = this.mineId();
    const out = new Map<string, number>();
    if (mine == null) return out;
    const byId = new Map<number, string>();
    for (const man of this.men()) byId.set(man.id, man.club);
    for (const pick of this.feed.picks()) {
      if (pick.teamId !== mine) continue;
      const club = byId.get(pick.playerId);
      if (club) out.set(club, (out.get(club) ?? 0) + 1);
    }
    return out;
  });

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

  readonly blocks = computed<BoardBlock[]>(() => {
    const owners = this.owners();
    const teams = new Map(this.feed.teams().map((team) => [team.id, team]));
    const mine = this.mineId();
    const lot = this.lotId();
    const budget = this.budget();

    const sameClub = this.mineByClub();
    return this.map().blocks.map((block) => {
      const medianPoints = middleOf(block.men.map((man) => man.points));
      let left = 0;
      let hasMine = false;

      const rows: BoardMan[] = block.men.map((man) => {
        const owner = owners.get(man.id);
        const state: ManState =
          man.id === lot ? 'asta' : owner ? (owner.teamId === mine ? 'mio' : 'altro') : 'urna';
        if (state === 'urna' || state === 'asta') left += 1;
        if (state === 'mio') hasMine = true;
        const team = owner ? teams.get(owner.teamId) : null;
        const band =
          offerBand({
            role: block.role,
            slotIndex: block.index,
            budget,
            room: budget,
            points: man.points,
            medianPoints,
            available: man.out?.share,
            hurt: !!man.out || !!man.outNow,
            confidence: man.confidence,
            // Quanti ne ho gia' del suo club: l'offerta scende, il suo valore no (sua istruzione
            // del 04/09/2026). Sta in TUTT'E DUE i posti che chiamano `offerBand` - qui e sul lotto -
            // o la riga direbbe una cifra e la card un'altra.
            sameClub: sameClub.get(man.club) ?? 0,
          }) ?? null;
        return {
          ...man,
          state,
          band,
          price: owner?.price ?? band?.high ?? null,
          ownerId: owner?.teamId ?? null,
          ownerLabel: team?.label ?? null,
          ownerColour: team?.colour ?? null,
        };
      });

      return {
        ...block,
        rows: mineFirst(rows),
        left,
        mine: hasMine,
        medianOffer: middleOf(rows.map((row) => row.band?.high ?? null)),
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
   */
  readonly slotView = signal<SlotView>('market');

  /** La plancia come la si guarda: `blocks()` sul mercato, la stessa gente ritagliata sul mio tetto. */
  readonly viewBlocks = computed<BoardBlock[]>(() => {
    const market = this.blocks();
    if (this.slotView() === 'market') return market;
    // Gli uomini che la mappa PORTA, non il listone: chi sta nella coda non ha una banda affatto, e
    // promuoverlo qui vorrebbe dire prezzarlo su un gradino della scala che non esiste per lui.
    const rows = market.flatMap((block) => block.rows);
    // CHI NON SI DISEGNA VA DICHIARATO ANCHE QUI, and the right place is the role's LAST block: the
    // personal grid is cut on the same men MINUS the excluded, so the whole shortfall lands at the end
    // of the role - that is the block drawn with eight rows instead of ten. Leaving `excluded` empty
    // left it short without a word, and the bar pastille that used to name them is gone (04/09/2026).
    const goneByRole = new Map<Role, PlanciaMan[]>();
    for (const block of market) {
      if (!block.excluded.length) continue;
      goneByRole.set(block.role, [...(goneByRole.get(block.role) ?? []), ...block.excluded]);
    }
    const groups = regroupByOffer(
      rows,
      // Il tetto MISURATO e non la cifra della colonna: `price` porta il prezzo PAGATO per chi ha gia'
      // un padrone, e ordinare su una colonna con due significati darebbe una graduatoria che ne mescola
      // due. Chi non ha un tetto (il foglio non lo prezza, quindi confidenza zero) finisce in fondo.
      (man) => man.band?.high ?? -1,
      this.teamsCount(),
      this.slots(),
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
    const man = block?.rows.find((row) => row.id === id);
    if (!block || !man) return null;

    const budget = this.budget();
    const room = this.me()?.budgetLeft ?? budget;
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
      sameClub: this.mineByClub().get(man.club) ?? 0,
    });

    const hands = this.handsFor(block.role, band?.low ?? 1);
    const owners = this.owners();

    return {
      man,
      block,
      price: this.lotPrice(),
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

  readonly cardMen = computed<{ man: CardMan; slot: number }[]>(() => {
    const byId = new Map<number, { man: BoardMan; block: BoardBlock }>();
    for (const block of this.blocks()) {
      for (const row of block.rows) byId.set(row.id, { man: row, block });
    }
    const numbers = this.numbers();
    const rounds = this.sheet()?.matchdays_target ?? null;
    // Chi non è più in mappa esce da sé: la coda si compra a un credito e non ha una riga, quindi non
    // ha una card - e una card che sopravvive alla propria riga mostrerebbe numeri di un altro giro.
    return this.cards.place((id) => {
      const found = byId.get(id);
      return found ? cardManOf(found.man, found.block, numbers.get(id) ?? null, rounds) : undefined;
    });
  });

  readonly frontCard = computed(() => this.cards.front());

  openCard(id: number | null): void {
    this.cards.openCard(id);
  }

  /** Toccata: davanti alle altre. Un click o un trascinamento, che per questo sono la stessa cosa. */
  raiseCard(id: number): void {
    this.cards.raiseCard(id);
  }

  closeCard(id: number): void {
    this.cards.closeCard(id);
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
    const role = lot?.block.role ?? null;
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
   */
  async startDemo(force = false): Promise<boolean> {
    if (!force && this.feed.hasTable() && this.men().length) return true;
    this.loading.set(true);
    this.error.set(null);
    try {
      const players = await this.loadListone();
      // The STANDARD settings and not the sheet's: what the fixture is for is testing the board on the
      // league every published number of the bench is measured against (ten seats, 1000 credits,
      // 3/8/8/6). A sheet built for a twelve-team league would silently change the width of every slot,
      // which is the one coordinate the whole page stands on.
      const auction = buildRandomAuction({ players, ...STANDARD_LEAGUE });
      this.feed.startDemo(auction);
      this.lotSource.set('demo');
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
   * Connects to a real session, keeping the sheet and the listone the board is already drawn on.
   *
   * The board's own listone comes from the SHEET and not from the session: the two meet on `fc_id`,
   * which is this project's primary key, so a live table prices its men with the same numbers the
   * demo did. What the live table brings is the squads, the credits and the picks.
   */
  async connect(code: string): Promise<boolean> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.loadListone();
      const ok = await this.feed.connect(code);
      if (ok) {
        this.lotSource.set('manual');
        // Same reason as `startDemo`: the live table brings its own squads and its own ids.
        this.clearLens();
        this.setLot(null);
      } else {
        this.error.set(this.feed.error());
      }
      return ok;
    } finally {
      this.loading.set(false);
    }
  }

  /** Names the lot on the table. `null` clears it - between two extractions there is no lot. */
  setLot(id: number | null): void {
    this.lotId.set(id);
    this.lotPrice.set(0);
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
        `Scrivi quanto è stato pagato ${lot.man.name} nella riga del lotto: a prezzo zero ` +
          "l'assegnazione sarebbe un acquisto inventato, e i crediti di ogni rosa reggono tutti i " +
          'tetti di questa pagina.',
      );
      return false;
    }
    if ((team.missing[ROLE_ZONE[lot.block.role]] ?? 0) <= 0) {
      this.error.set(`${team.label} ha il reparto ${lot.block.role} completo: non può prenderlo.`);
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
   * Sua richiesta del 04/09/2026, e serve perché il tavolo inventato si gioca da sé un terzo dell'asta
   * prima di consegnare la plancia (`DEMO_PROGRESS`): quegli acquisti sono di nessuno, e un'asta vera
   * comincia da zero. Quello che NON si tocca è il regolamento - dieci sedie, 1000 crediti, 3·8·8·6 e
   * le dieci etichette restano, perché sono le impostazioni della lega e non lo stato dell'asta.
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
    this.numbers.set(engineNumbersFrom(table));
    // Il calendario e i portieri titolari: nessuno dei due e' necessario per disegnare la plancia, quindi
    // un bundle che non li porta la apre lo stesso e le modali che li leggono lo dicono.
    void this.loadCalendar();
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
    platform: 'default',
    edge: man.edge,
    pv: man.pv,
    rounds,
    // La fantamedia che la RIGA sta usando: `basis` lo ha gia' deciso a monte (`valuationOf`), o la card
    // direbbe un numero e la riga un altro.
    fm: man.basis === 'estimated' ? (numbers?.estFm ?? null) : (numbers?.fm ?? null),
    estimated: man.basis === 'estimated',
    estNote: numbers?.estNote ?? null,
    titolarita: numbers?.titolarita ?? null,
    minutesNext: numbers?.minutesNext ?? null,
    seasonMatches: numbers?.seasonMatches ?? null,
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
  if (band.pricedAt !== block.index) {
    return `Prezzato come uno slot ${band.pricedAt}: infortunato oggi, non lo pago da primo.`;
  }
  return null;
}
