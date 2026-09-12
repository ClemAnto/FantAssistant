import { Component, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { ClubsStore } from '../../core/clubs-store';
import { ExpectedPlay, PlayOutlook } from '../../core/expected-play';
import { GlobalOptions } from '../../core/global-options';
import { cleanSheetBaseline, cleanSheetOutlook } from '../../core/keeper-pairs';
import { CardMan, CardStack } from '../../core/player-card';
import { LineupMan, MatchLineup, lineupOf } from '../../core/match-lineup';
import { EDGE_BASE } from '../../core/plancia';
import { MatchCell, Platform, PlayersStore, day } from '../../core/players-store';
import { Role } from '../../core/plancia';
import { swingOf } from '../../core/swing';
import { EngineExpectation, SquadMan, ValuationStore } from '../../core/valuation-store';
import { AppHeader } from '../../ui/app-header/app-header';
import { ClubBoard } from '../../ui/club-board/club-board';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { MatchLineupBoard } from '../../ui/match-lineup/match-lineup';
import { MatchesTable } from '../../ui/matches-table/matches-table';
import { PlayerCard } from '../../ui/player-card/player-card';
import { SquadTable } from '../../ui/squad-table/squad-table';
import { bindQuery } from '../../core/view-state';

/**
 * The two questions this page can answer about the same rosa.
 *
 * `values` is what each man is WORTH, `matches` what he DID in the last ten rounds - the consultation
 * view's own table, the same component fed by the same `PlayersStore.matchTable`, because «come nella
 * schermata calciatori» has to mean the same cells and not a second drawing of them.
 */
export type SquadMode = 'values' | 'matches';

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
    ClubCrest,
    FormsModule,
    MatchLineupBoard,
    MatchesTable,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzRadioModule,
    NzSpinModule,
    NzTooltipModule,
    PlayerCard,
    SquadTable,
  ],
  host: { class: 'view-host' },
})
export class Clubs {
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
  });

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

  protected readonly openCards = computed(() => {
    const byId = new Map(this.store.squad().map((man) => [man.fcId, man]));
    const engine = this.engine();
    const rounds = this.store.boardSheet()?.matchdays_target ?? null;
    const platform = this.store.platform();
    return this.cards.place((id) => {
      const man = byId.get(id);
      if (!man) return undefined;
      const numbers = engine?.get(id) ?? null;
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
      // Su `default` una riga che il motore prezza porta già la miscela in-season (R25K40, 07/09/2026);
      // su `euro` R25 non è adottata e la correzione dentro SWING resta il solo canale.
      fmBlendsSeen: this.store.platform() === 'default' && numbers != null && !numbers.fmIsEstimate,
      rFactor: league.rFactor,
      cleanSheetBonus: league.cleanSheet,
      cleanSheetShare: calendar ? cleanSheetOutlook(calendar, man.club) : null,
      cleanSheetMean: calendar ? cleanSheetBaseline(calendar) : null,
    });
  }

  protected readonly frontCard = computed(() => this.cards.front());

  /** Il click su un nome del campetto: apre la sua card e nient'altro. */
  protected onPick(id: number): void {
    this.cards.openCard(id);
  }

  protected closeCard(id: number): void {
    this.cards.closeCard(id);
  }

  protected raiseCard(id: number): void {
    this.cards.raiseCard(id);
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
    unpricedReason: null,
    fvm: man.fvm,
    out: outlook.window,
    market: null,
  };
}
