import { Component, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ClubsStore } from '../../core/clubs-store';
import { ExpectedPlay, PlayOutlook } from '../../core/expected-play';
import { GlobalOptions } from '../../core/global-options';
import { cleanSheetBaseline, cleanSheetOutlook } from '../../core/keeper-pairs';
import {
  CardKey,
  CardMan,
  CardStack,
  clubCard,
  clubOfCard,
  playerCard,
  playerOfCard,
} from '../../core/player-card';
import { LineupMan, MatchLineup, lineupOf } from '../../core/match-lineup';
import { EDGE_BASE } from '../../core/plancia';
import { BoardHorizon, BoardMan } from '../../core/bundle';
import { PitchLine } from '../../core/club-eleven';
import { laneKnown } from '../../core/match-lineup';

/** Dove la board disegna un uomo: la riga, il punto sull'asse laterale e la parola del suo posto. */
interface Spot {
  line: PitchLine;
  x: number;
  badge: string | null;
}
import { NextRoundStore } from '../../core/next-round-store';
import { NextMan, ShapeOdds, linesFor, nextClubFor, nextPitch, nextShapes } from '../../core/next-round';
import { MatchCell, Platform, PlayersStore, day } from '../../core/players-store';
import { upcomingFor, withUpcoming } from '../../core/next-match';
import { Role } from '../../core/plancia';
import { sheetBlendsSeen, swingOf } from '../../core/swing';
import { EngineExpectation, SquadMan, ValuationStore } from '../../core/valuation-store';
import { AppHeader } from '../../ui/app-header/app-header';
import { ClubBoard } from '../../ui/club-board/club-board';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { MatchLineupBoard } from '../../ui/match-lineup/match-lineup';
import { NextRoundBoard } from '../../ui/next-round/next-round';
import { MatchesTable } from '../../ui/matches-table/matches-table';
import { ClubCard } from '../../ui/club-card/club-card';
import { PlayerCard } from '../../ui/player-card/player-card';
import { SquadTable } from '../../ui/squad-table/squad-table';
import { TimeTravel } from '../../core/time-travel';
import { bindQuery } from '../../core/view-state';
import { itDate } from '../../core/tooltip';

/**
 * The two questions this page can answer about the same rosa.
 *
 * `values` is what each man is WORTH, `matches` what he DID in the last ten rounds - the consultation
 * view's own table, the same component fed by the same `PlayersStore.matchTable`, because «come nella
 * schermata calciatori» has to mean the same cells and not a second drawing of them.
 */
export type SquadMode = 'values' | 'matches';

/**
 * LE TRE LETTURE DELL'UNDICI DI UN CLUB, e la terza non e' un terzo orizzonte della stessa cosa.
 *
 * `season` e `short` sono le nostre board: le disegna il toolkit, sono previsioni nostre e si scelgono
 * su `ValuationStore.boardHorizon`, che altre schermate leggono. `next` e' LA STAMPA - quello che
 * quattro siti hanno pubblicato a un quarto d'ora dal fischio - e in questo progetto la stampa e' un
 * GIUDICE delle prime due e mai un input. Per questo vive in un campo di questa vista e NON dentro
 * `BoardHorizon`: infilarla li' la farebbe arrivare a `boardViewOf`, cioe' al lettore di `boards.json`,
 * che una board della stampa non ce l'ha e non deve averla.
 */
export type BoardTab = BoardHorizon | 'next';

/**
 * Le squadre: what each real club has, in today's snapshot.
 *
 * Two answers side by side and they come from two different places on purpose. The PITCH is the board the
 * toolkit drew - a prediction about a real coach, so it is a measurement and lives where measurements are
 * made and judged - and this app only reads it. The TABLE is the club's whole quoted squad with what each
 * man actually did last season and what the engine expects of him: it is the same `ui-squad-table` the
 * consultation view draws for the whole listone, reading the same `ValuationStore`, so a man cannot read
 * one way here and another there.
 */
@Component({
  selector: 'app-clubs',
  templateUrl: './clubs.html',
  imports: [
    AppHeader,
    ClubBoard,
    ClubCard,
    ClubCrest,
    FormsModule,
    MatchLineupBoard,
    MatchesTable,
    NzAlertModule,
    NzButtonModule,
    NextRoundBoard,
    NzIconModule,
    NzInputModule,
    NzRadioModule,
    NzSpinModule,
    NzTooltipModule,
    PlayerCard,
    SquadTable,
  ],
  host: { class: 'view-host' },
})
export class Clubs {
  /**
   * Il giorno di un ISTANTE come lo legge chi guarda lo schermo.
   *
   * Si lavora in UTC e si mostra in locale: il template tagliava l'ISO a dieci caratteri, che e' il
   * giorno UTC - per un pacchetto scritto all'01:30 italiane sarebbe il giorno prima. Una definizione
   * sola (`core/tooltip`), qui e nella pastiglia della freschezza.
   */
  protected readonly shownDay = itDate;

  protected readonly store = inject(ClubsStore);
  /** The per-match layer, for the other reading of the same rosa. Loaded only when it is asked for. */
  protected readonly matches = inject(PlayersStore);
  /** Il foglio, per le colonne che la card mostra e la tabella no: `expectationsFor` è il suo lettore. */
  private readonly valuation = inject(ValuationStore);

  /** Which of the two tables is on screen. The values one is what this page has always been. */
  protected readonly mode = signal<SquadMode>('values');

  /**
   * The last ten league rounds of the MEASURED season, for this rosa, in the table's own order.
   *
   * The query is written here rather than taken from the consultation view's filter bar: that bar is a
   * different screen's state, and a table that followed it would change under this club without anybody
   * touching this page. The season is the one the values table is about (`input_season`), so the two
   * modes describe the same football; the men are passed in the SAME order, so it is one list twice.
   */
  /**
   * LE ULTIME DIECI GIORNATE IN ASSOLUTO di questa rosa, attraversando le stagioni.
   *
   * Richiesta dell'operatore (06/09/2026): «mostra le ultime 10 partite in assoluto e non solo della
   * stagione precedente». Prima la finestra era la stagione MISURATA (`input_season`), che a settembre
   * vuol dire «l'anno scorso» anche quando il campionato nuovo ha già giocato due giornate - e a un
   * tavolo la domanda è sempre «come sta adesso».
   *
   * Le stagioni si passano dalla più recente e le compone lo store (`matchTableAcross`), che è dove la
   * definizione di «le ultime partite» già vive: una seconda implementazione qui sarebbe una seconda
   * risposta alla stessa domanda. La query resta scritta qui e non presa dalla barra dei filtri della
   * vista Calciatori: quella è lo stato di un'altra schermata, e una tabella che la seguisse cambierebbe
   * sotto questo club senza che nessuno abbia toccato questa pagina.
   */
  protected readonly matchTable = computed(() => {
    const club = this.store.club();
    const seasons = [this.store.targetSeason(), this.store.inputSeason()]
      .filter((one): one is string => !!one);
    if (!club || !seasons.length || this.matches.status() !== 'ready') {
      return { columns: [], lines: [] };
    }
    // ...E DAVANTI A TUTTE LA PROSSIMA PARTITA (operatore, 15/09/2026). Viene dal CALENDARIO e non dai
    // voti, quindi si aggiunge qui: `PlayersStore` e' lo store del calcio giocato e un secondo lettore
    // del calendario la' dentro sarebbe una seconda risposta alla stessa domanda. Sta a sinistra perche'
    // la tabella si legge dalla piu' recente - il futuro viene prima del passato piu' vicino.
    return withUpcoming(this.playedTable(club, seasons), this.upcoming());
  });

  /** La colonna del futuro, dal calendario del bundle: null a stagione finita o senza `fixtures`. */
  protected readonly upcoming = computed(() =>
    upcomingFor(this.play.book()?.forClub(this.store.club() ?? '') ?? null,
                this.store.club(), this.travel.today()));

  /** Le ultime giornate GIOCATE, che sono quelle che lo store sa comporre attraverso le stagioni. */
  private playedTable(club: string, seasons: string[]) {
    return this.matches.matchTableAcross(
      {
        platform: this.store.platform(),
        season: seasons[0],
        from: 1,
        to: 1,
        // League only: a rosa's ten rounds are ten rounds. With cups a column becomes a WEEK, which is
        // a different unit and a different question - it belongs where the filters for it live.
        withCups: false,
        withFriendlies: false,
        club,
      },
      seasons,
      this.store.squad(),
    );
  }

  // ------------------------------------------------------------- la formazione di UNA partita
  //
  // «Quando nella visualizzazione "ultime partite" seleziono una partita (cliccando sul nome della
  // colonna) vorrei che nel campetto ricostruissi la formazione che ha giocato quella partita»
  // (operatore, 12/09/2026). E' un FATTO e non una previsione, quindi l'app puo' leggerlo: la regola
  // «l'undici di un club vero lo disegna il toolkit» vincola la board DISEGNATA, che e' una previsione
  // su una persona. Il perche' e le misure di completezza stanno in `core/match-lineup.ts`.

  /**
   * LA PARTITA SCELTA, e si azzera da se' quando cambia quello che la rende sensata.
   *
   * `linkedSignal` sul club, sulla piattaforma e sulla vista: una formazione e' di UN club in UNA
   * partita, quindi tenerla mentre si passa a un'altra squadra disegnerebbe l'undici di qualcun altro
   * sotto il nome sbagliato - e uscendo dalle «ultime partite» non c'e' piu' nessuna colonna accesa
   * che dica da dove viene il disegno.
   */
  protected readonly picked = linkedSignal<string, { matchId: string; club: string } | null>({
    source: () => `${this.store.platform()}|${this.store.club()}|${this.mode()}`,
    computation: () => null,
  });

  /** Gli uomini di quella partita, come il layer per-partita li registra. Null = non ancora letti. */
  private readonly lineupMen = signal<{ key: string; men: LineupMan[] } | null>(null);

  /**
   * L'UNDICI DISEGNATO: lo scheletro dal MODULO della colonna, i nomi dal layer per-partita.
   *
   * Il modulo viene dalla colonna e non si ricava dagli uomini trovati: e' un conteggio di CLUB
   * (`club_match_lineups`), quindi completo anche dove un nome manca - e ricavarlo dai nomi che
   * abbiamo farebbe descrivere il nostro perimetro invece della partita (misurato: su 820 partite-club
   * di Serie A le due letture danno le stesse linee 815 volte, e le cinque che discordano sono proprio
   * quelle in cui un nome manca).
   */
  protected readonly lineup = computed<MatchLineup | null>(() => {
    const chosen = this.picked();
    const loaded = this.lineupMen();
    if (!chosen || loaded?.key !== keyOf(chosen)) return null;
    const column = this.matchTable().columns.find((one) => one.matchId === chosen.matchId);
    // I codici del RIPIEGO, e sono DUE vocabolari perche' dicono due cose diverse: i granulari
    // (`DR`, `LW`) portano il LATO, quelli di listone (`dd`, `ds`) pure e in piu' esistono per chi il
    // provider non ha mai osservato. Servono solo dove la distinta della fonte non porta il posto -
    // nella finestra pesante e' il 100% dei titolari di campionato, quindi quasi mai.
    const codes = this.squadRoles();
    return lineupOf(
      column?.shape ?? null,
      loaded.men,
      (fcId) => [...(this.valuation.realRolesOf(fcId)?.codes ?? []), ...(codes.get(fcId) ?? [])],
      column?.formation ?? null,
    );
  });

  /** La colonna che ha prodotto il disegno, per nominarla in cima: la partita, la data, il risultato. */
  protected readonly pickedColumn = computed(() => {
    const chosen = this.picked();
    const column = chosen
      ? (this.matchTable().columns.find((one) => one.matchId === chosen.matchId) ?? null)
      : null;
    // La data si legge come la legge la tabella accanto (`day`): due formati sulla stessa schermata
    // fanno leggere due date diverse per la stessa partita.
    return column && { ...column, when: column.date ? day(column.date) : null };
  });

  /**
   * LE CELLE DI QUELLA PARTITA, per `fc_id`: il voto, il fantavoto e i bonus che la colonna mostra.
   *
   * Prese dalla TABELLA accanto e non rilette dal bundle: sono gli stessi numeri che si vedono due dita
   * piu' in la', e una seconda lettura darebbe allo stesso uomo due pagelle nella stessa schermata. Chi
   * la tabella non ha - un titolare che questo listone non quota - resta senza, che e' quello che di lui
   * si sa qui.
   */
  protected readonly pickedCells = computed<ReadonlyMap<number, MatchCell>>(() => {
    const chosen = this.picked();
    const table = this.matchTable();
    const at = chosen ? table.columns.findIndex((one) => one.matchId === chosen.matchId) : -1;
    const out = new Map<number, MatchCell>();
    if (at < 0) return out;
    for (const line of table.lines) {
      const cell = line.cells[at];
      if (cell) out.set(line.fcId, cell);
    }
    return out;
  });

  /** I ruoli di listone accanto a ogni nome, dalla rosa: vuoti per chi il listone non quota. */
  protected readonly squadRoles = computed<ReadonlyMap<number, readonly string[]>>(() => {
    const out = new Map<number, readonly string[]>();
    for (const man of this.store.squad()) out.set(man.fcId, man.mantraCodes);
    return out;
  });

  /**
   * IL CLICK SU UNA COLONNA. La lettura e' asincrona (la tabella per-partita e' la piu' pesante del
   * pacchetto e si chiede solo quando serve), quindi la risposta si accetta solo se e' ANCORA quella
   * che si sta guardando: passare da una colonna all'altra mentre la prima arriva disegnerebbe la
   * formazione della partita sbagliata sotto il nome di questa.
   */
  protected chooseMatch(what: { matchId: string; club: string }): void {
    if (this.picked()?.matchId === what.matchId) {
      this.picked.set(null);
      return;
    }
    this.picked.set(what);
    const key = keyOf(what);
    void this.matches.lineupOf(what.matchId, what.club).then((men) => {
      const still = this.picked();
      if (still && keyOf(still) === key) this.lineupMen.set({ key, men });
    });
  }

  /** Quali stagioni la tabella sta mostrando davvero, per dirlo in intestazione. */
  protected readonly matchSeasons = computed(() => {
    const seen = new Set<string>();
    for (const column of this.matchTable().columns) {
      const border = column.divider?.split(' → ') ?? [];
      for (const one of border) seen.add(one);
    }
    if (!seen.size) {
      const only = this.store.inputSeason();
      return only ? [only] : [];
    }
    return [...seen];
  });

  constructor() {
    void this.store.load();

    /**
     * Le colonne del motore del foglio in vigore, rilette quando il listone cambia.
     *
     * `expectationsFor` tiene la sua cache per PERCORSO, quindi passare dal listone Serie A a EuroLeghe e
     * tornare non rilegge niente; e la card si apre su un uomo del listone che si sta guardando, quindi il
     * foglio giusto è quello di questa pagina e non «il primo che c'è».
     */
    effect(() => {
      const sheet = this.store.boardSheet();
      if (!sheet) {
        this.engine.set(null);
        return;
      }
      void this.valuation.expectationsFor(sheet).then((columns) => {
        this.engine.set(columns);
      });
    });

    /**
     * The selection lives in the URL, and the URL is the only place it lives.
     *
     * The click sets the store and the binder writes the address, never two writers for one field: with
     * two sources of truth a refresh, a Back and a shared link would eventually disagree about what is
     * on screen. Held until the bundle is in - applying `?club=Napoli` to a store with no clubs yet
     * would resolve to nothing and then be written back as an empty address.
     */
    bindQuery(
      [
        {
          param: 'platform',
          read: () => this.store.platform(),
          apply: (raw) => {
            const platform: Platform = raw === 'euro' ? 'euro' : 'default';
            if (platform !== this.store.platform()) this.store.selectPlatform(platform);
          },
        },
        {
          param: 'club',
          // A club is a CLICK, and the Back button should walk back through the ones looked at.
          push: true,
          read: () => this.store.club(),
          apply: (raw) => {
            const clubs = this.store.clubs();
            // A name this listone does not carry - a stale link, or the other platform's club: the page
            // shows the first one rather than an empty panel, and the address is corrected to match.
            const known = raw != null && clubs.some((one) => one.name === raw);
            this.store.select(known ? raw : (clubs[0]?.name ?? null));
          },
        },
        {
          param: 'vista',
          read: () => (this.mode() === 'values' ? null : this.mode()),
          apply: (raw) => this.show(raw === 'matches' ? 'matches' : 'values'),
        },
      ],
      computed(() => this.store.status() === 'ready'),
    );
  }

  /** A club chosen from the strip: the store holds it and the address follows. */
  protected choose(club: string): void {
    this.store.select(club);
  }

  /**
   * The other table, and its data is fetched only when it is asked for.
   *
   * The per-match layer is the heaviest thing the bundle carries (`match_ratings` plus the provider's
   * own rows): the page that opens by default does not owe it. `load()` is idempotent and shared with
   * the consultation view, so a session pays for it once whichever screen asks first.
   */
  protected show(mode: SquadMode): void {
    this.mode.set(mode);
    if (mode === 'matches') void this.matches.load();
  }

  /** The other listone: the store takes the club with it, because the two lists barely overlap. */
  protected choosePlatform(platform: Platform): void {
    this.store.selectPlatform(platform);
  }

  protected readonly selected = computed(() =>
    this.store.clubs().find((club) => club.name === this.store.club()) ?? null,
  );

  // ------------------------------------------------------------------ la card di un calciatore
  //
  // «Togli il tooltip dai calciatori sul campetto e metti al click l'apertura della card dettaglio
  // (uguale a quella nella plancia e nella strategia)» - operatore, 06/09/2026. È LA STESSA card
  // (`ui/player-card`): due card sarebbero due letture degli stessi `engine_*`, cioè due valutazioni per
  // un uomo. Quello che questa pagina deve fare è COSTRUIRE la riga, perché i numeri di un uomo sono del
  // FOGLIO che questa pagina legge - qui quello del listone scelto, lo stesso che prezza la tabella
  // accanto e che ha disegnato la board.

  /** La formula unica delle presenze attese: serve la FINESTRA di uno stop aperto, che la card scrive. */
  private readonly play = inject(ExpectedPlay);
  /** Il giorno in cui l'app crede di trovarsi: la colonna del futuro segue il viaggio nel tempo. */
  private readonly travel = inject(TimeTravel);
  /** Le impostazioni di lega: i due modificatori decidono se lo SWING paga la costanza e la porta. */
  private readonly options = inject(GlobalOptions);

  /**
   * Le colonne del motore del foglio che questa pagina sta leggendo, per `fc_id`.
   *
   * `SquadMan` porta quasi tutto quello che la card mostra, ma non le due MISURE della stagione scorsa
   * (partite giocate e minuti): quelle vivono su `EngineExpectation`, che è il lettore unico di quelle
   * colonne. Chiesto per il foglio NOMINATO (`boardSheet`), che è lo stesso da cui vengono i numeri della
   * tabella - chiedere «il primo della piattaforma» sarebbe un secondo foglio sotto lo stesso nome.
   */
  private readonly engine = signal<ReadonlyMap<number, EngineExpectation> | null>(null);

  /**
   * Le card aperte, col loro posto.
   *
   * `new CardStack()` e non un servizio: le card di questa pagina non devono seguirti sulla plancia, ma
   * la regola del POSTO è una sola - due pagine che disponessero le stesse card in due modi sarebbero due
   * risposte a una domanda di layout.
   */
  private readonly cards = new CardStack();

  /**
   * COSA PROMETTE L'ULTIMO PERIODO, con la finestra DICHIARATA dal toolkit che l'ha usata.
   *
   * Il numero non è scritto qui: viene da `boards.json`, dove `snapshot` lo mette accanto ai numeri che
   * ne escono. Una costante ricopiata in TypeScript sarebbe un'etichetta che smette di dire il vero il
   * giorno che uno sweep muove la finestra - e nessuno lo scoprirebbe leggendo lo schermo.
   */
  protected readonly shortHint = computed(() => {
    const window = this.store.shortWindow();
    const matches = window ? `le ultime ${window} partite` : 'le ultime partite';
    return `L'undici che esce da ${matches} di campionato, contate sulle sole in cui era disponibile e`
      + ' miscelate con la stagione. Prevede la PROSSIMA partita, non le giornate che restano: misurata'
      + ' fuori campione su 3.638 partite-club, sbaglia meno della lettura di stagione su chi comincia'
      + " (Brier 0.170 → 0.154) e ne indovina 8.7 degli undici veri contro 8.5. Gli indisponibili di oggi"
      + ' sono fuori.';
  });

  // ------------------------------------------------------------------ il prossimo turno (la stampa)

  /** Il foglio delle probabili, letto dal vivo. Solo questa vista lo chiede, e solo se lo si apre. */
  protected readonly next = inject(NextRoundStore);

  /** Quale delle tre letture e' a schermo. Non e' salvata: si riparte sempre dalla nostra. */
  protected readonly boardTab = signal<BoardTab>('season');

  /**
   * La scelta scrive in DUE posti diversi apposta: i due orizzonti nostri vanno su `boardHorizon`, che
   * e' dello store e lo leggono altre schermate; la stampa resta qui. E la rete si paga solo quando la
   * si apre - `load()` chiede una volta sola, e `idle` esiste proprio per poter dire «nessuno ha ancora
   * chiesto» invece di far partire una lettura a ogni apertura della pagina.
   */
  protected chooseBoard(tab: BoardTab): void {
    this.boardTab.set(tab);
    if (tab !== 'next') {
      this.store.boardHorizon.set(tab);
      return;
    }
    this.next.load();
  }

  /**
   * Il club del payload che corrisponde a questo, AGGANCIATO PER `fc_id` E MAI PER NOME: il foglio
   * chiama i club con la sua tabella di alias e questa app col nome canonico del listone: un join per
   * stringa fra i due e' il difetto che qui ha gia' perso Milan, Roma e Napoli una volta.
   */
  protected readonly nextClub = computed(() =>
    nextClubFor(this.next.round(), this.store.squad().map((man) => man.fcId)),
  );

  /**
   * Il ruolo del LISTONE per ogni uomo della rosa: le fonti ne pubblicano uno solo a volte, e il
   * vocabolario con cui si compra e' il nostro. Non torna in nessun numero - e' come si legge una riga.
   */
  protected readonly nextRoles = computed<ReadonlyMap<number, string>>(() => {
    const out = new Map<number, string>();
    for (const man of this.store.squad()) out.set(man.fcId, man.role);
    return out;
  });

  /** Chi di quei nomi e' uno che compriamo: solo per lui c'e' una card da aprire. */
  protected readonly nextKnown = computed<ReadonlySet<number>>(
    () => new Set(this.store.squad().map((man) => man.fcId)),
  );

  /**
   * I MODULI CHE QUESTO CLUB GIOCA, e sono quelli VERI.
   *
   * Non il regolamento mantra - correzione dell'operatore, 18/09/2026: quella e' la legalita' di un
   * undici al fantacalcio, mentre qui la domanda e' sul calcio. Il repertorio lo MISURA gia' il toolkit
   * e viaggia nel pacchetto: `odds` da' a ogni modulo la probabilita' che quel club lo giochi, e
   * `board_shape` e' quello su cui la board e' stata risolta. Una lista di moduli scritta a mano in
   * TypeScript sarebbe una seconda copia di una misura.
   */
  protected readonly shapeCandidates = computed<ShapeOdds[]>(() => {
    const board = this.store.board();
    if (!board) return [];
    const out = new Map<string, number | null>();
    for (const [shape, odds] of Object.entries(board.odds ?? {})) out.set(shape, odds);
    for (const shape of [board.board_shape, board.picture, board.formation_typical]) {
      if (shape && !out.has(shape)) out.set(shape, null);
    }
    // ...E I MODULI VERI CHE IL PACCHETTO HA VISTO NEGLI ALTRI CLUB, come ripiego dichiarato. Il
    // repertorio di un club e' stretto - il Cagliari gioca quattro schemi, tutti con la difesa a
    // quattro - e la stampa puo' annunciare una cosa che quel club non ha ancora giocato. Sono misurati
    // (le board del toolkit), non trascritti, entrano SENZA probabilita' e quindi vanno sempre dopo i
    // suoi, e la carta dice che non sono roba sua.
    for (const shape of this.leagueShapes()) if (!out.has(shape)) out.set(shape, null);
    return [...out].map(([shape, odds]) => ({ shape, odds }));
  });

  /** I moduli che il pacchetto disegna su TUTTI i club di questa piattaforma: un universo misurato. */
  private readonly leagueShapes = computed<string[]>(() => {
    const view = this.valuation.boardViewFor(this.store.platform());
    const out = new Set<string>();
    for (const board of Object.values(view?.clubs ?? {})) {
      for (const shape of [board.board_shape, board.picture, board.formation_typical]) {
        if (shape) out.add(shape);
      }
      for (const shape of Object.keys(board.odds ?? {})) out.add(shape);
    }
    return [...out];
  });

  /**
   * SU QUALI LINEE PUO' STARE OGNI UOMO: dai suoi codici granulari, o dal suo macro-ruolo.
   *
   * Una definizione (`linesFor`) e non una per schermata: e' il vocabolario con cui il quinto sta in
   * difesa o a centrocampo e l'ala arretra a coprire la fascia, che questo progetto ha gia' scritto
   * nelle trasformazioni del pannello.
   */
  /**
   * Il ruolo del LISTONE di un uomo: il nostro quando e' uno che compriamo, quello della fonte
   * altrimenti. Una definizione e tre lettori (la riga, il ripiego delle linee, il badge), o tre
   * risposte diverse allo stesso «che ruolo ha» disegnerebbero un campetto che non torna coi suoi nomi.
   */
  private readonly roleFor = (man: { fcId: number | null; role: string | null }): string | null =>
    (man.fcId !== null ? this.nextRoles().get(man.fcId) : null) ?? man.role;

  private readonly codesFor = (man: NextMan): readonly string[] =>
    (man.fcId !== null ? this.squadRoles().get(man.fcId) : null) ?? [];

  /**
   * DOVE LA NOSTRA BOARD DISEGNA OGNI UOMO - la linea e il punto sull'asse laterale.
   *
   * E' il meccanismo della formazione stagionale RIUSATO invece che rifatto (operatore, 18/09/2026): il
   * campetto del toolkit ha gia' risolto quell'assegnazione sull'intero undici, con l'ungherese sui
   * codici granulari e le sue riparazioni, e il risultato viaggia nel pacchetto uomo per uomo. Entrano
   * anche i BALLOTTAGGI, perche' un rivale di un posto gioca in quella linea: e' quello che il posto
   * dice di lui.
   */
  private readonly boardSpot = computed<ReadonlyMap<number, Spot>>(() => {
    const out = new Map<number, Spot>();
    const lines = this.store.board()?.lines;
    if (!lines) return out;
    for (const [line, men] of Object.entries(lines) as [PitchLine, BoardMan[]][]) {
      for (const man of men ?? []) {
        if (man?.fc_id) {
          out.set(Number(man.fc_id), { line, x: man.x ?? 0.5, badge: man.badge ?? null });
        }
        for (const duel of man?.duels ?? []) {
          if (duel?.fc_id && !out.has(Number(duel.fc_id))) {
            // Un ballottaggio eredita il POSTO che si contende, quindi anche la sua etichetta.
            out.set(Number(duel.fc_id), { line, x: man.x ?? 0.5, badge: man.badge ?? null });
          }
        }
      }
    }
    return out;
  });

  /**
   * SU QUALI LINEE PUO' STARE: quella in cui la NOSTRA board lo disegna, o - per chi non disegna - le
   * linee che i suoi codici coprono. Il primo canale e' un'assegnazione gia' risolta, il secondo una
   * proprieta' dell'uomo: l'ordine fra i due e' la decisione.
   */
  /**
   * Le linee di un uomo si calcolano UNA VOLTA. `nextShapes` interroga ogni modulo candidato e, dove c'e'
   * una maglia contesa, ogni combinazione di contendenti: senza memoria la stessa risposta veniva
   * ricostruita qualche migliaio di volte per club. La chiave e' l'OGGETTO - gli uomini escono tutti da
   * `parseNextRound` - quindi una `WeakMap` si svuota da se' quando arriva una presa nuova.
   */
  private readonly lines = computed<WeakMap<NextMan, readonly PitchLine[]>>(() => {
    // LA CACHE DIPENDE DA CIO' CHE MEMORIZZA, e questa riga e' la ragione per cui e' un `computed` e non
    // un campo: le linee di un uomo leggono la board, quindi cambiando ORIZZONTE (stagione / ultimo
    // periodo) la stessa persona puo' avere una riga di casa diversa. Con una WeakMap tenuta a mano
    // sarebbero rimaste quelle di prima - un'ottimizzazione che si ricorda una risposta vecchia e' un
    // difetto, non un guadagno.
    this.boardSpot();
    return new WeakMap<NextMan, readonly PitchLine[]>();
  });

  private readonly linesOf = (man: NextMan): readonly PitchLine[] => {
    const memo = this.lines();
    const seen = memo.get(man);
    if (seen) return seen;
    const out = this.linesFresh(man);
    memo.set(man, out);
    return out;
  };

  private readonly linesFresh = (man: NextMan): readonly PitchLine[] => {
    const spot = man.fcId !== null ? this.boardSpot().get(man.fcId) : null;
    const own = linesFor(this.codesFor(man), this.roleFor(man));
    if (!spot) return own;
    // LA BOARD SI AGGIUNGE, NON RESTRINGE, e la prima versione faceva il contrario: inchiodare ognuno
    // alla riga in cui il nostro campetto lo disegna ha fatto smettere di disegnare Roma e Milan, perche'
    // la stampa schiera un modulo diverso dal nostro e li' qualcuno deve stare in un'altra riga. Il suo
    // posto e' un SUGGERIMENTO su dove gioca, non un veto su dove puo' giocare - e dove pesa davvero e'
    // nell'ORDINE dentro la riga (`xOf`), che e' un'assegnazione gia' risolta sull'intero undici.
    return own.includes(spot.line) ? own : [spot.line, ...own];
  };

  /** Dove la board lo mette sull'asse laterale, per ordinare la riga. Null = non lo disegna. */
  private readonly xOf = (man: NextMan): number | null =>
    (man.fcId !== null ? this.boardSpot().get(man.fcId)?.x : null) ?? null;

  /** ...e in quale RIGA, che e' quella che decide dove mostrarlo come alternativa. */
  private readonly homeOf = (man: NextMan): PitchLine | null =>
    (man.fcId !== null ? this.boardSpot().get(man.fcId)?.line : null) ?? null;

  /**
   * ...e come si chiama il suo posto: la parola della NOSTRA board, o il suo codice primario di listone.
   * Nessuna delle due e' inventata qui, che e' la ragione per cui non si costruisce un'etichetta dalla
   * posizione nella riga - «il terzo di una difesa a tre» non e' una parola che qualcuno usa.
   */
  private readonly badgeOf = (man: NextMan): string | null => {
    const codes = this.codesFor(man);
    // IL MARCATORE NON PUO' CONTRADDIRE IL POSTO. Quello della board porta un LATO (`Ad`, `As`), e la
    // fascia la decidono i CODICI quando parlano: Noslin, disegnato al centro perche' e' un `Pc`,
    // leggeva «Ad» sopra la testa (operatore, 19/09/2026). Dove i codici parlano l'etichetta e' la loro;
    // il marcatore della board resta dove sono muti, che e' l'unico posto in cui aggiunge qualcosa.
    if (laneKnown(codes)) return codes[0].charAt(0).toUpperCase() + codes[0].slice(1);
    const spot = man.fcId !== null ? this.boardSpot().get(man.fcId) : null;
    if (spot?.badge) return spot.badge;
    return codes.length ? codes[0].charAt(0).toUpperCase() + codes[0].slice(1) : null;
  };

  /** Che modulo giocano questi undici: quello dichiarato dalle fonti, o il più probabile del suo repertorio. */
  protected readonly nextShape = computed(() => {
    const club = this.nextClub();
    return club ? nextShapes(club, this.linesOf, this.shapeCandidates()) : null;
  });

  /** Gli undici ai loro posti. Niente campetto finché il modulo non è UNO. */
  protected readonly nextPitch = computed(() => {
    const club = this.nextClub();
    const shape = this.nextShape();
    if (!club || shape?.shapes.length !== 1) return null;
    return nextPitch(club, shape.shapes[0], this.linesOf, this.codesFor, shape.by, shape.ours,
      this.xOf, this.homeOf, this.badgeOf);
  });

  /**
   * QUANDO ABBIAMO LETTO, e il GIORNO c'e' appena non e' oggi.
   *
   * E' un'altra cosa dal momento in cui la presa e' stata fatta (quello sta sul campetto, in minuti dal
   * fischio): questo dice quanto e' vecchia la copia che stiamo guardando. Da quando la lettura si tiene
   * in `localStorage` puo' essere di ieri o di un altro turno, e una presa vecchia disegnata senza la sua
   * data si leggerebbe come quella di oggi. In ora LOCALE, perche' e' visualizzazione.
   */
  protected readonly nextReadAt = computed(() => {
    const when = this.next.readAt();
    if (!when) return null;
    const at = when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const same = when.toDateString() === new Date().toDateString();
    return same ? `oggi alle ${at}` : `il ${when.toLocaleDateString('it-IT',
      { day: '2-digit', month: '2-digit' })} alle ${at}`;
  });

  protected readonly openCards = computed(() => {
    const byId = new Map(this.store.squad().map((man) => [man.fcId, man]));
    const engine = this.engine();
    const rounds = this.valuation.seasonRoundsFor(this.store.boardSheet());
    const platform = this.store.platform();
    return this.cards.place((key) => {
      const id = playerOfCard(key);
      const man = id == null ? undefined : byId.get(id);
      if (!man) return undefined;
      const numbers = engine?.get(id as number) ?? null;
      const outlook = this.play.outlook(
        { id: man.fcId, club: man.club, platform },
        { pv: man.expected, pvIsEstimate: man.expectedIsEstimate, playShare: man.titolaritaPlay,
          titolarita: man.titolarita },
        rounds,
      );
      return cardManOf(man, numbers, outlook, rounds, platform, this.swing(man, numbers, outlook));
    });
  });

  /**
   * LO SWING di un uomo di questa rosa (richiesta dell'operatore, 07/09/2026: «nella card con il
   * dettaglio del calciatore metti anche lo SWING»).
   *
   * TERZO CHIAMANTE della definizione unica (`core/swing.ts`) e non una terza aritmetica: la plancia e
   * la Strategia lo hanno già sulla riga, questa pagina no - la sua tabella mostra le colonne del
   * FOGLIO - quindi il conto si fa qui, con gli stessi ingressi degli altri due. Il pezzo che conta è
   * `pv`: le presenze dell'APP (`outlook.expected`, cioè col «di più» dell'assicurazione dentro) e il
   * surplus riscalato sullo STESSO fattore, o la card mostrerebbe uno SWING costruito su presenze
   * diverse da quelle che stampa due righe sopra.
   */
  private swing(
    man: SquadMan,
    numbers: EngineExpectation | null,
    outlook: PlayOutlook,
  ): number | null {
    const league = this.options.league();
    // Il +1 a porta inviolata vale solo per i portieri e solo dove la lega lo paga: il differenziale
    // contro la media del campionato lo fa `swingOf`, che è la definizione che leggono le altre due.
    const calendar = man.role === 'P' ? (this.play.book()?.forClub(man.club) ?? null) : null;
    return swingOf({
      role: man.role as Role,
      surplus: man.surplus == null ? null : man.surplus * outlook.factor,
      pv: outlook.expected,
      replacement: numbers?.replacementFm ?? null,
      matchdays: outlook.matchdays,
      fm: man.expectedFm,
      steady: man.rating?.steady?.share ?? null,
      seasonFm: man.fm,
      seasonPlayed: man.pv,
      confidence: numbers?.confidence ?? null,
      // Su `default` il foglio porta già la miscela in-season su TUTTE le righe dalla revisione 71
      // (motore per R25K40, ripiego per `estimate_for`); su `euro` resta il solo canale. Una
      // definizione sola: `swing.sheetBlendsSeen`.
      fmBlendsSeen: sheetBlendsSeen(this.store.platform()),
      rFactor: league.rFactor,
      cleanSheetBonus: league.cleanSheet,
      cleanSheetShare: calendar ? cleanSheetOutlook(calendar, man.club) : null,
      cleanSheetMean: calendar ? cleanSheetBaseline(calendar) : null,
    });
  }

  /**
   * LE CARD DI UNA SQUADRA, dalla stessa pila: il click sul nome del club dentro la card di un uomo.
   *
   * Una pila sola per le due specie perche' il POSTO e chi sta DAVANTI sono globali allo schermo: due
   * pile darebbero lo stesso posto a due card aperte insieme e due «davanti» contemporanei.
   */
  protected readonly clubCards = computed(() =>
    this.cards.place((key) => clubOfCard(key) ?? undefined),
  );

  /**
   * QUANTE CARD SONO A SCHERMO, e non quante ne tiene la pila: sono due numeri diversi.
   *
   * Una card di calciatore ESCE DA SE' quando la sua riga non c'e' piu' - si cambia club sulla vista
   * Squadre, si aggiudica un uomo sulla plancia - perche' una card che sopravvive alla propria riga
   * mostrerebbe i numeri di dieci minuti prima. La pila pero' la tiene ancora, quindi contando LEI il
   * tasto direbbe «chiudi le 2 card» sopra uno schermo senza nessuna card: un conteggio che descrive
   * una lista diversa da quella disegnata, che e' il difetto che questo progetto paga da sempre.
   */
  protected readonly cardCount = computed(
    () => this.openCards().length + this.clubCards().length,
  );

  protected readonly frontCard = computed(() => this.cards.front());

  /** Il click su un nome del campetto: apre la sua card e nient'altro. */
  protected onPick(id: number): void {
    this.cards.openCard(playerCard(id));
  }

  protected openClubCard(platform: Platform, club: string): void {
    this.cards.openCard(clubCard(platform, club));
  }

  protected closeCard(key: CardKey): void {
    this.cards.closeCard(key);
  }

  protected raiseCard(key: CardKey): void {
    this.cards.raiseCard(key);
  }

  protected closeAllCards(): void {
    this.cards.openCard(null);
  }
}

/**
 * LA CHIAVE DI UNA PARTITA, in una funzione sola: (evento, club) e mai una delle due.
 *
 * Un id di evento e' di una PARTITA e una partita ha due squadre, quindi confrontare i due id direbbe
 * «e' la stessa» di due formazioni opposte. Scritta qui perche' la legge sia chi accetta una risposta
 * arrivata tardi sia chi la mette da parte: due modi di dire «e' ancora questa» finirebbero per non
 * essere d'accordo esattamente nel caso per cui il confronto esiste.
 */
function keyOf(what: { matchId: string; club: string }): string {
  return `${what.matchId}|${what.club}`;
}

/**
 * UN UOMO COME LA CARD LO DISEGNA, dalla riga che questa pagina ha già in mano.
 *
 * Nessun numero si ricalcola qui: `SquadMan` è quello che la tabella accanto mostra, quindi la card e la
 * riga non possono dire due cose diverse sullo stesso uomo. Il «dove» è il POSTO che la board gli dà nel
 * suo undici tipo (`place`, `Dc` o `Td`), che su questa pagina è la domanda - la plancia scrive `A1` e la
 * Strategia i codici del listone, perché là il posto è un altro fatto.
 *
 * NESSUN TAVOLO (`market: null`): la vista Squadre descrive una rosa vera, non compra - non c'è una max
 * offerta né un padrone, e inventarli mostrerebbe i numeri di un'asta che non esiste.
 */
function cardManOf(
  man: SquadMan,
  numbers: EngineExpectation | null,
  outlook: PlayOutlook,
  rounds: number | null,
  platform: Platform,
  swing: number | null,
): CardMan {
  return {
    id: man.fcId,
    name: man.name,
    club: man.club,
    clubId: man.clubId,
    where: man.place ?? (man.mantra || man.role),
    role: man.role as Role,
    platform,
    // La stessa definizione della plancia e della Strategia: quanto rende una sua partita sopra il sei.
    edge: man.expectedFm == null ? null : man.expectedFm - EDGE_BASE,
    pv: man.expected,
    rounds,
    swing,
    fm: man.expectedFm,
    estimated: man.expectedFmIsEstimate,
    estNote: man.estimateNote,
    titolarita: man.titolarita,
    titolaritaPlay: man.titolaritaPlay,
    minutesNext: man.minutesNext,
    seasonMatches: numbers?.seasonMatches ?? null,
    minutesFullSeason: numbers?.minutesFullSeason ?? null,
    category: numbers?.category ?? null,
    categoryLevel: numbers?.categoryLevel ?? null,
    categoryBars: numbers?.categoryBars ?? null,
    unpricedReason: null,
    fvm: man.fvm,
    out: outlook.window,
    market: null,
  };
}
