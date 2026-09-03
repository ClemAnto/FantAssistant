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
import { PlayerStatus } from './player-status';
import { engineNumbersFrom } from './engine-sheet';
import { GlobalOptions } from './global-options';
import {
  CalendarBook,
  CalendarFile,
  EASY_ALREADY_SHARE,
  GridCell,
  PairSuggestion,
  aloneCover,
  calendarBookFrom,
  coverGrid,
  rankPairs,
} from './keeper-pairs';
import {
  Alternative,
  EDGE_BASE,
  LotAdvice,
  PlanciaMan,
  PlanciaMap,
  Role,
  ROLES,
  SlotBlock,
  adviseLot,
  alternativeFor,
  buildMap,
  offerBand,
} from './plancia';
import { STANDARD_LEAGUE, buildRandomAuction, roleOf } from './plancia-demo';

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
   */
  band: { low: number; high: number } | null;
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
    const out: PlanciaMan[] = [];
    for (const player of this.listone()) {
      const role = roleOf(player);
      if (!role || !(player.fvm > 0)) continue;
      const valuation = valuationOf(numbers.get(player.id));
      const points =
        valuation.fm != null && valuation.pv != null ? valuation.fm * valuation.pv : null;
      out.push({
        id: player.id,
        name: player.name,
        club: player.club,
        role,
        fvm: player.fvm,
        points,
        pv: valuation.pv,
        // Dalla fantamedia e non da `points / pv`: quel rapporto tornerebbe lo stesso numero solo
        // finche' nessuno tocca `points`, e due strade per una cifra e' come un uomo finisce con due
        // valutazioni. Le presenze viaggiano accanto (`pv`), non dentro.
        edge: valuation.fm != null ? valuation.fm - EDGE_BASE : null,
        basis: valuation.basis as ValuationBasis,
        outNow: !!this.status.unavailableNow(player.id),
        // La nota dichiarata, come informazione sulla riga: solo `out_of_squad`, perche' `dispute` e
        // `wants_out` sono stati di una RELAZIONE e chi ci sta dentro si schiera e si compra ancora.
        outOfSquad: this.status.declared().get(player.id)?.kind === 'out_of_squad',
      });
    }
    return out;
  });

  readonly map = computed<PlanciaMap>(() => buildMap(this.men(), this.teamsCount(), this.slots()));

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

      // I MIEI IN CIMA AL BLOCCO (sua richiesta, 03/09/2026), e sotto di loro l'ordine MISURATO
      // resta intatto: `sort` in JS e' stabile, quindi questo e' un PREFISSO e non un riordino - la
      // stessa forma dell'ordine personale dei blocchi della pagina strategia. Il resto del blocco
      // continua a leggersi per valore atteso, che e' l'ordine che §23.2 ha adottato.
      rows.sort(
        (left_, right_) => (right_.state === 'mio' ? 1 : 0) - (left_.state === 'mio' ? 1 : 0),
      );

      return { ...block, rows, left, mine: hasMine };
    });
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
   * LA CARD DI UN CALCIATORE: chi è aperto, e uno solo alla volta.
   *
   * Un id e non l'uomo, per la ragione di sempre: la riga si ricostruisce a ogni aggiudicazione, e una
   * card che tenesse la COPIA di un uomo continuerebbe a mostrare il prezzo di dieci minuti prima -
   * «una lista mostrata i cui numeri descrivono un'altra lista». Con l'id la card segue lo stato.
   */
  private readonly cardId = signal<number | null>(null);

  readonly cardMan = computed<BoardMan | null>(() => {
    const at = this.cardId();
    if (at == null) return null;
    for (const block of this.blocks()) {
      const found = block.rows.find((row) => row.id === at);
      if (found) return found;
    }
    // Fuori mappa: la coda si compra a un credito e non ha una riga, quindi non ha una card.
    return null;
  });

  openCard(id: number | null): void {
    this.cardId.set(id);
  }

  /** I numeri del motore di un uomo, dal lettore unico: la card non ne apre un secondo. */
  numbersFor(id: number): EngineNumbers | null {
    return this.numbers().get(id) ?? null;
  }

  readonly teams = computed<BoardTeam[]>(() => {
    const mine = this.mineId();
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
      };
    });
  });

  /** How much of the auction is gone, per role: the only progress figure a free extraction has. */
  readonly progress = computed(() =>
    ROLES.map((role) => {
      const blocks = this.map().byRole.get(role) ?? [];
      const total = blocks.length * this.teamsCount();
      const left = blocks.reduce(
        (sum, block) => sum + (this.blockById().get(block.id)?.left ?? 0),
        0,
      );
      return { role, done: total - left, total };
    }),
  );

  /**
   * Quanti uomini della mappa oggi non giocano: il conto che la pagina DICE.
   *
   * Un vincolo che agisce in silenzio è indistinguibile da un ordinamento rotto, quindi la plancia
   * dichiara quanti nomi ha fatto scendere invece di limitarsi a farli scendere.
   */
  readonly outNowCount = computed(
    () =>
      this.map()
        .blocks.flatMap((block) => block.men)
        .filter((man) => man.outNow).length,
  );

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

/** The median of the numbers that exist. A null is not a zero, so it is not in the sample. */
function middleOf(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null).sort((a, b) => a - b);
  if (!known.length) return null;
  const middle = known.length >> 1;
  return known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
}
