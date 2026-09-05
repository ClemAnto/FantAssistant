import { formatNumber } from '@angular/common';
import { Component, LOCALE_ID, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { BoardMan, EngineSheetEntry } from '../../core/bundle';
import { OnTable, PitchLine, PitchMan, pitchOf } from '../../core/club-eleven';
import { ExpectedPlay, PlayOutlook } from '../../core/expected-play';
import { GlobalOptions } from '../../core/global-options';
import { looseMatch } from '../../core/loose-search';
import { SeasonTotals, seasonTotals } from '../../core/player-card';
import { PlayersStore } from '../../core/players-store';
import { ClassicRole } from '../../core/players-store';
import {
  RULE_NOTE,
  WhyColumns,
  Rung,
  SurplusWhy,
  coreFormula,
  explainSurplus,
} from '../../core/surplus-why';
import {
  TITOLARITA_SHORT,
  isTitolarita,
  titolaritaNote,
  titolaritaRank,
} from '../../core/titolarita';
import { EngineExpectation, ValuationStore } from '../../core/valuation-store';
import { stored } from '../../core/view-state';
import { APP_VERSION } from '../../version';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { RoleSet } from '../../ui/role-set/role-set';

/**
 * QUANTI VICINI si mostrano per lato nella graduatoria di ruolo: tre.
 *
 * È una scelta di lettura e non una misura: tre sopra e tre sotto stanno in sette righe, che è quanto si
 * legge in un colpo d'occhio senza scorrere. Meno non fa vedere un andamento, di più diventa una seconda
 * tabella dentro la carta.
 */
const PEERS_AROUND = 3;

/** Chi si gioca un posto, ridotto a quello che serve dirne: il nome e i suoi RUOLI REALI. */
export interface PlaceMan {
  fcId: number | null;
  name: string;
  /** I codici granulari (`DL`, `DC`, `AM`...): è quello che dice che un terzino non è un centrale. */
  codes: string[];
  /** La quota da titolare del pannello: chi parte, non chi prende il voto. */
  claim: number | null;
}

/**
 * IL POSTO CHE L'UNDICI TIPO GLI DÀ, e chi glielo contende. Letto dalla board, mai dedotto qui.
 *
 * `starter` distingue le due metà di un ballottaggio: chi il posto ce l'ha e chi glielo contende. La
 * riga è la stessa vista dalle due parti - stesso posto, stesso titolare - perché la domanda «perché è
 * un ballottaggio» si fa da tutt'e due i lati.
 */
export interface BoardPlace {
  club: string;
  module: string;
  line: PitchLine;
  /** Il posto come lo nomina il pannello (`Dc`, `Td`, `Pc`): UNO, non l'elenco dei suoi codici. */
  badge: string | null;
  /** Chi quel posto lo occupa nell'undici disegnato. */
  holder: PlaceMan | null;
  /** Gli altri che se lo giocano, lui escluso. */
  rivals: PlaceMan[];
  /** Falso quando il suo ruolo reale è ignoto: allora i ballottaggi sono IGNOTI, non assenti. */
  duelsKnown: boolean;
  starter: boolean;
  codes: string[];
  claim: number | null;
  /** Dove la board e il motore non sono d'accordo su di lui, e quale dei due è l'ottimista. */
  disagreement: 'board' | 'engine' | null;
}

/** Una riga della pagina: chi è, e la spiegazione del suo surplus. Nient'altro. */
export interface WhyRow {
  fcId: number;
  name: string;
  club: string;
  clubId: number | null;
  role: ClassicRole;
  mantraCodes: string[];
  quoted: boolean;
  why: SurplusWhy;
  /**
   * IL GRADINO della scala dell'operatore (`desc_titolarita`) e i DUE NUMERI che lo decidono: la quota
   * di partite disponibili in cui prende il voto, e i minuti che ci si aspetta quando gioca.
   *
   * Vuoto - e non «riserva» - dove il foglio non lo porta: il gradino lo scrive la stessa passata che
   * disegna gli undici, quindi su una macchina senza display la colonna è vuota per costruzione.
   */
  titolarita: string | null;
  play: number | null;
  minutesNext: number | null;
  /** Dove l'undici tipo lo mette e chi glielo contende, o null se la board non lo nomina affatto. */
  place: BoardPlace | null;
  /** L'ESITO delle giornate già giocate: il solo numero che può smentire la catena. Null = non ha giocato. */
  now: SeasonTotals | null;
  /**
   * LA POOL su cui il suo rimpiazzo è misurato (`engine_role_slot`), che è anche quella su cui ha senso
   * confrontarlo: su mantra un'ala e una punta hanno due zeri diversi. Ripiega sul ruolo di listone dove
   * il foglio non porta lo slot - su un foglio classic sono la stessa cosa.
   */
  pool: string | null;
  /** Il conto delle giornate dell'app, con i suoi pezzi: serve a spiegare il riprezzo, non a farlo. */
  outlook: PlayOutlook;
  /** Il core scritto per esteso coi SUOI numeri, o vuoto dove quella formula non è la sua. */
  formula: string | null;
}

/**
 * COME SI ORDINA LA LISTA: una chiave per colonna, e nessuna di loro cambia un numero - cambia solo
 * cosa si guarda per primo.
 *
 * L'elenco e' dichiarato una volta e letto due: il tipo lo restringe a compile time, e `stored` lo usa
 * per rifiutare quello che trova sul disco - una chiave di una versione precedente non deve aprire una
 * pagina ordinata per una colonna che non esiste piu'.
 */
export const SORT_KEYS = [
  'name',
  'club',
  'titolarita',
  'fm',
  'anchor',
  'replacement',
  'perPlayed',
  'pv',
  'surplus',
  'perMatch',
  'appPv',
  'appPerMatch',
  'now',
] as const;

type SortKey = (typeof SORT_KEYS)[number];

/**
 * PERCHÉ QUEL SURPLUS: la lista completa, e per ogni uomo i fattori che lo producono.
 *
 * Richiesta dell'operatore (05/09/2026): «non sono ancora contento del surplus assegnato ad ogni
 * calciatore, ci sono delle dinamiche che non mi convincono ... preparami una nuova pagina dove
 * inserisci la lista completa dei calciatori e per ogni calciatore mi espliciti i fattori che poi
 * portano al valore di surplus/match ... devi esplicitare anche come calcoli i fattori».
 *
 * QUESTA PAGINA NON CALCOLA NIENTE DI SUO, ed è la sola cosa che la rende utile: se ricalcolasse,
 * spiegherebbe un numero che nessun'altra pagina ha. Legge il foglio - le due colonne del motore, il
 * rimpiazzo, e la SCALA delle regole adottate che il toolkit ci scrive accanto (`why_*`, revisione 45) -
 * ricostruisce la moltiplicazione finale e CONTROLLA che torni. Dove non torna lo dice: una catena
 * plausibile che finisce su un altro numero è peggio di nessuna catena.
 *
 * TRE COSE CHE SI VEDONO QUI E DA NESSUN'ALTRA PARTE.
 *
 *  - QUANTO DI UN SURPLUS È LA FANTAMEDIA E QUANTO SONO LE PRESENZE. Il surplus è un prodotto, quindi
 *    due uomini con lo stesso numero possono essere due animali diversi: uno che rende molto per
 *    partita e ne gioca metà, e uno che rende poco e c'è sempre. Le due colonne «+/giornata» e
 *    «+/partita» sono la stessa quantità in due unità, e insieme dicono quale dei due è.
 *  - COSA HA FATTO OGNI REGOLA su quell'uomo, in ordine di adozione, col suo scarto. Una regola che su
 *    di lui non dice niente resta a schermo muta invece di sparire: «non lo tocca» è un'informazione.
 *  - DOVE FINISCE IL MOTORE E DOVE COMINCIA L'APP. Il foglio dà un surplus; questa app lo riprezza per
 *    lo stop aperto e per l'assicurazione (`core/expected-play.ts`), ed è quel secondo numero che ordina
 *    le liste della Strategia e della Plancia. Sono due domande, quindi due colonne e due nomi.
 */
@Component({
  selector: 'app-why',
  imports: [
    ClubCrest,
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzRadioModule,
    NzSelectModule,
    NzTooltipModule,
    RoleBadge,
    RoleSet,
    RouterLink,
  ],
  templateUrl: './why.html',
})
export class Why {
  protected readonly store = inject(ValuationStore);
  private readonly options = inject(GlobalOptions);
  private readonly play = inject(ExpectedPlay);
  /** Il layer per-partita: serve solo al falsificatore, e si chiede all'apertura. */
  private readonly players = inject(PlayersStore);
  private readonly locale = inject(LOCALE_ID);
  protected readonly appVersion = APP_VERSION;
  protected readonly ruleNote = RULE_NOTE;

  /** Le colonne del motore del foglio dichiarato, per `fc_id`. Null = non ancora lette, o foglio assente. */
  private readonly engine = signal<Map<number, EngineExpectation> | null>(null);
  protected readonly reading = signal(false);

  constructor() {
    void this.store.load();
    // I VOTI GIÀ PRESI di questa stagione: 422 KB, e sono il solo dato che può smentire una
    // previsione. Non è opzionale come sulla Strategia - lì è una pastiglia in più, qui è metà
    // della ragione per cui la pagina esiste - quindi si chiede subito e la colonna compare
    // quando atterra.
    void this.players.load();
    // Stessa forma della Strategia: il foglio cambia quando cambia (listone, gioco), e finché le colonne
    // non arrivano la pagina dice che sta leggendo - un vuoto silenzioso si legge come «nessuno è valutato».
    effect(() => {
      const sheet = this.sheet();
      if (!sheet) {
        this.engine.set(null);
        this.reading.set(false);
        return;
      }
      this.reading.set(true);
      void this.store.expectationsFor(sheet).then((columns) => {
        if (this.sheet()?.path !== sheet.path) return;
        this.engine.set(columns);
        this.reading.set(false);
      });
    });
  }

  // ---------------------------------------------------------------- il foglio dichiarato

  protected readonly settings = computed(() => this.options.league());

  /** Il foglio che prezza QUESTA combinazione, o null se il bundle non ce l'ha. */
  protected readonly sheet = computed<EngineSheetEntry | null>(() => {
    const { platform, game } = this.settings();
    return this.store.sheets().find((one) => one.platform === platform && one.game === game) ?? null;
  });

  protected readonly matchdays = computed(() => this.sheet()?.matchdays_target ?? null);

  protected openSettings(): void {
    this.options.open();
  }

  // ---------------------------------------------------------------- le righe

  /**
   * LA LISTA COMPLETA, che è la richiesta alla lettera: ogni uomo del listone dichiarato, quotato o no.
   *
   * Le altre pagine tagliano chi il listone non quota, e hanno ragione - una lista di nomi da comprare
   * non contiene chi non si può comprare (operatore, 04/09/2026). Qui la domanda è un'altra: è una
   * pagina diagnostica sul MOTORE, e un uomo che il motore prezza deve poter essere letto anche se
   * nessuno lo vende. Chi non è quotato porta il suo marchio, e il filtro lo toglie in un click.
   */
  protected readonly rows = computed<WhyRow[]>(() => {
    const engine = this.engine();
    if (!engine) return [];
    const platform = this.settings().platform;
    const listone = this.store.rosters().get(platform) ?? [];
    const matchdays = this.matchdays();
    const places = this.boardPlaces();
    const now = this.nowSeason();
    return listone.map((player) => {
      const one = engine.get(player.fcId);
      const outlook = this.play.outlook(
        { id: player.fcId, club: player.club },
        {
          pv: one?.pv ?? null,
          pvIsEstimate: one?.pvIsEstimate ?? false,
          playShare: one?.titolaritaPlay ?? null,
        },
        matchdays,
      );
      const why = explainSurplus({
        fm: one?.fm ?? null,
        pv: one?.pv ?? null,
        replacement: one?.replacementFm ?? null,
        sheetSurplus: one?.surplus ?? null,
        confidence: one?.confidence ?? 1,
        fmIsEstimate: one?.fmIsEstimate ?? false,
        pvIsEstimate: one?.pvIsEstimate ?? false,
        estBasis: one?.basis ?? null,
        estNote: one?.note ?? null,
        anchor: one?.anchor ?? null,
        matchdays,
        why: one?.why ?? null,
        factor: outlook.factor,
      });
      return {
        fcId: player.fcId,
        name: player.name,
        titolarita: one?.titolarita ?? null,
        play: one?.titolaritaPlay ?? null,
        minutesNext: one?.minutesNext ?? null,
        place: places.get(player.fcId) ?? null,
        now: now.get(player.fcId) ?? null,
        pool: one?.slot ?? player.role ?? null,
        club: player.club,
        clubId: player.clubId,
        role: player.role,
        mantraCodes: player.mantraCodes,
        quoted: player.quoted,
        why,
        outlook,
        // LA FORMULA SI STAMPA SOLO DOVE È LA SUA, e sono due condizioni.
        //
        // Il PORTIERE non passa dall'ancora (il suo core parte dal voto base e sottrae i gol attesi del
        // club); e chi il motore NON prezza non ha un core affatto - la sua FM viene dal ripiego
        // dichiarato, quindi scrivere «5.97 + 0.50 × (5.00 − 5.97) = 5.49» accanto a una riga che porta
        // 5.91 sarebbe una formula che non produce il numero che le sta accanto. Trovato guardando la
        // schermata di Jimenez A. (1 presenza misurata, ripiego `shrunk`): una formula sbagliata accanto
        // al numero giusto è peggio che nessuna formula.
        formula:
          why.basis === 'core'
            ? coreFormula(one?.why ?? null, one?.anchor ?? null, player.role === 'P')
            : null,
      };
    });
  });

  /** Quante righe il foglio riesce a spiegare per intero: è la prima cosa che questa pagina deve dire. */
  protected readonly coverage = computed(() => {
    const rows = this.rows();
    return {
      total: rows.length,
      priced: rows.filter((row) => row.why.basis !== 'none').length,
      estimated: rows.filter((row) => row.why.basis === 'estimate').length,
      // CHI HA DAVVERO UNA SCALA, e non «chi ha le colonne»: il foglio le porta per tutti e le
      // riempie per chi il motore riesce a prevedere. Contare le colonne diceva 600 dove le scale
      // sono 386 - un conteggio vero sulla domanda sbagliata, che è il modo in cui una copertura
      // sembra completa.
      explained: rows.filter((row) => row.why.fmRungs.length || row.why.pvRungs.length).length,
      // Le righe la cui catena NON riproduce il surplus del foglio: zero è il numero che ci si aspetta,
      // e vederlo scritto è quello che rende leggibile un numero diverso da zero.
      disagreeing: rows.filter((row) => !row.why.agrees).length,
    };
  });

  // ---------------------------------------------------------------- filtri e ordine

  protected readonly query = signal('');
  protected readonly role = signal<'tutti' | ClassicRole>('tutti');
  /**
   * LA SQUADRA, come `fc_club_id` e mai come nome: il nome non è una chiave, qui come in tutto il
   * progetto (due club possono chiamarsi quasi uguale, e la stessa squadra può cambiare grafia fra
   * due fonti). `0` = tutte.
   */
  protected readonly club = signal(0);
  /** «Solo quotati» è una preferenza di LETTURA, quindi si ricorda: default spento, la lista è completa. */
  protected readonly onlyQuoted = stored<'si' | 'no'>('why.onlyQuoted', 'no', ['si', 'no']);

  /**
   * L'ORDINE, e si ricorda: a differenza di un filtro non nasconde niente, quindi ritrovarlo al
   * ricaricamento non può far leggere una lista per un'altra. I filtri no - un filtro salvato che
   * all'apertura nasconde metà lista è la cosa peggiore che questa pagina possa fare a un'asta.
   */
  protected readonly sortKey = stored<SortKey>('why.sort', 'perMatch', SORT_KEYS);
  protected readonly sortAsc = stored<'si' | 'no'>('why.sortAsc', 'no', ['si', 'no']);

  protected readonly roleChoices: { value: 'tutti' | ClassicRole; label: string }[] = [
    { value: 'tutti', label: 'Tutti' },
    { value: 'P', label: 'P' },
    { value: 'D', label: 'D' },
    { value: 'C', label: 'C' },
    { value: 'A', label: 'A' },
  ];

  /**
   * LE SQUADRE DI QUESTA PAGINA, coi loro uomini: dalle RIGHE e non dal catalogo globale.
   *
   * Il catalogo conosce ogni club che il bundle porta; qui la domanda è «di chi posso vedere le righe»,
   * e offrire una squadra che su questo listone non ha nessuno sarebbe una scelta che non fa niente. Il
   * conteggio viaggia con la voce perché è quello che rende consapevole la scelta - filtrare è
   * nascondere N uomini, e la tendina lo dice invece di lasciarlo scoprire.
   */
  protected readonly clubChoices = computed(() => {
    const count = new Map<number, { id: number; name: string; men: number }>();
    for (const row of this.rows()) {
      if (row.clubId == null) continue;
      const one = count.get(row.clubId) ?? { id: row.clubId, name: row.club, men: 0 };
      one.men += 1;
      count.set(row.clubId, one);
    }
    return [...count.values()].sort((left, right) => left.name.localeCompare(right.name, 'it'));
  });

  /**
   * IL NUMERO SU CUI SI ORDINA, per colonna. Una mappa e non uno `switch` nel template: le colonne sono
   * undici e la chiave che le nomina è la stessa che l'intestazione porta, quindi una colonna nuova si
   * aggiunge in un posto solo o smette di essere ordinabile in silenzio.
   *
   * `name` e `club` non sono numeri e hanno il loro ramo dentro `sorted`.
   */
  private readonly SORTS: Record<Exclude<SortKey, 'name' | 'club'>, (row: WhyRow) => number | null> = {
    // IL GRADINO SI ORDINA SULLA SCALA e non sull'alfabeto (`titolaritaRank`), col segno girato: sulla
    // scala 0 è `bandiera`, e «in discesa» su questa colonna deve voler dire «i più titolari in cima»
    // come su ogni altra. Ordinare per la sigla darebbe BAL, BAN, PAN, RIS, TIS, TIT.
    titolarita: (row) => {
      const rank = titolaritaRank(row.titolarita);
      return rank == null ? null : -rank;
    },
    fm: (row) => row.why.fm,
    anchor: (row) => row.why.anchor,
    replacement: (row) => row.why.replacement,
    perPlayed: (row) => row.why.perPlayed,
    pv: (row) => row.why.pv,
    surplus: (row) => row.why.sheetSurplus,
    perMatch: (row) => row.why.sheetPerMatch,
    appPv: (row) => row.outlook.expected,
    appPerMatch: (row) => row.why.appPerMatch,
    // La fantamedia REALIZZATA finora: si ordina su quella e non sulle partite giocate, perché è la
    // metà che smentisce la colonna «FM att.» - le giornate stanno accanto e le dice il tooltip.
    now: (row) => row.now?.fm ?? null,
  };

  /**
   * Clicca su una colonna: la stessa gira il verso, una nuova parte dal verso che si legge per primo.
   *
   * I numeri partono in DISCESA («chi rende di più») e i due testi in salita, che è come si cerca un
   * nome. Non è una preferenza nascosta: è quello che uno si aspetta al primo click, e il secondo click
   * lo smentisce in un gesto.
   */
  protected toggleSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortAsc.set(this.sortAsc() === 'si' ? 'no' : 'si');
      return;
    }
    this.sortKey.set(key);
    this.sortAsc.set(key === 'name' || key === 'club' ? 'si' : 'no');
  }

  /** La freccia accanto all'intestazione: dice DOVE si sta ordinando e in che verso. */
  protected sortArrow(key: SortKey): string {
    if (this.sortKey() !== key) return '';
    return this.sortAsc() === 'si' ? ' ↑' : ' ↓';
  }

  private sorted(rows: WhyRow[]): WhyRow[] {
    const key = this.sortKey();
    const sign = this.sortAsc() === 'si' ? 1 : -1;
    if (key === 'name' || key === 'club') {
      return [...rows].sort(
        (left, right) =>
          (key === 'name'
            ? left.name.localeCompare(right.name, 'it')
            : left.club.localeCompare(right.club, 'it') ||
              left.name.localeCompare(right.name, 'it')) * sign,
      );
    }
    const read = this.SORTS[key];
    return [...rows].sort((left, right) => {
      const a = read(left);
      const b = read(right);
      // UN VUOTO NON È MAI «IL MIGLIORE» E NEMMENO «IL PEGGIORE»: va in fondo in tutt'e due i versi,
      // perché un ignoto non è un ultimo posto. Senza questo, ordinare in salita metterebbe in cima le
      // trecento righe che il motore non prezza, cioè la lista direbbe il contrario di quello che è.
      if (a == null && b == null) return left.name.localeCompare(right.name, 'it');
      if (a == null) return 1;
      if (b == null) return -1;
      return (a - b) * sign;
    });
  }

  protected readonly visible = computed(() => {
    const query = this.query().trim();
    const role = this.role();
    const club = this.club();
    const quotedOnly = this.onlyQuoted() === 'si';
    const rows = this.rows().filter(
      (row) =>
        (role === 'tutti' || row.role === role) &&
        (!club || row.clubId === club) &&
        (!quotedOnly || row.quoted) &&
        (!query || looseMatch(query, row.name, row.club)),
    );
    return this.sorted(rows);
  });

  /** Quante righe i filtri stanno NASCONDENDO: un filtro attivo lo dice, non lo lascia scoprire. */
  protected readonly hidden = computed(() => this.rows().length - this.visible().length);

  /** Se un filtro qualsiasi è acceso: decide se la crocetta «mostra tutti» esiste. */
  protected readonly filtered = computed(
    () => !!this.query().trim() || this.role() !== 'tutti' || !!this.club() || this.onlyQuoted() === 'si',
  );

  protected setQuery(text: string): void {
    this.query.set(text);
  }

  protected clearFilters(): void {
    this.query.set('');
    this.role.set('tutti');
    this.club.set(0);
    this.onlyQuoted.set('no');
  }

  protected toggleQuoted(): void {
    this.onlyQuoted.set(this.onlyQuoted() === 'si' ? 'no' : 'si');
  }

  /**
   * QUELLO CHE STA SUCCEDENDO DAVVERO, giornata per giornata: il solo FALSIFICATORE di questa pagina.
   *
   * Tutto il resto qui è la catena che produce una previsione, e una catena si può leggere per intero
   * senza accorgersi che il numero in fondo è sbagliato. Quello che può SMENTIRLO è l'esito: quante ne
   * ha giocate davvero e con che fantamedia, sulle giornate già disputate.
   *
   * VIENE DAL LAYER PER-PARTITA e non dall'aggregato di stagione, e non è un dettaglio: `season_stats`
   * lo scrive `stats:derive`, che una corsa quotidiana NON rifà, quindi sul pacchetto del 05/09/2026
   * legge **una** giornata dove i voti ne portano **due** (Malen 1 contro 2, 256 righe su 354). Sarebbe
   * un falsificatore vecchio di una giornata, cioè metà di quello che c'è. Stessa funzione che scrive
   * il riepilogo della card (`seasonTotals`): due aritmetiche sugli stessi voti darebbero a un uomo due
   * stagioni.
   *
   * Vuoto per chi non ha ancora giocato: non è uno zero, è una riga che non esiste.
   */
  private readonly nowSeason = computed<Map<number, SeasonTotals>>(() => {
    const out = new Map<number, SeasonTotals>();
    if (!this.players.ready()) return out;
    const platform = this.settings().platform;
    const season = this.store.targetSeason();
    if (!season) return out;
    for (const player of this.store.rosters().get(platform) ?? []) {
      const totals = seasonTotals(this.players.matchesOf(player.fcId, platform, season));
      if (totals) out.set(player.fcId, totals);
    }
    return out;
  });

  // ---------------------------------------------------------------- il posto e i rivali

  /**
   * DOVE L'UNDICI TIPO LO METTE, e chi gli contende quel posto: LETTO dalla board del toolkit.
   *
   * Un undici di un club vero è una previsione su una persona, quindi l'app non ne calcola nessuno - la
   * disegna `modules/boards.py` e qui si legge, con la stessa `pitchOf` che disegna il campetto delle
   * Squadre. Due letture della stessa board darebbero a un uomo due ballottaggi.
   *
   * SI COSTRUISCE UNA VOLTA PER TUTTA LA PAGINA e non per riga: seicento righe per venti club vorrebbe
   * dire ridisegnare ogni undici seicento volte. La mappa è per `fc_id`, e ci finiscono TUTT'E DUE i
   * lati di un ballottaggio - chi il posto ce l'ha e chi glielo contende - perché la domanda «perché è
   * un ballottaggio» si fa da tutt'e due le parti.
   *
   * `expectedShare` viaggia dentro `resolve` apposta: è quello che fa calcolare a `pitchOf` il
   * DISACCORDO fra la board e il motore, che è esattamente la tensione che questa pagina deve mostrare -
   * la board lo schiera e il motore lo aspetta in diciannove giornate, oppure il contrario.
   */
  private readonly boardPlaces = computed<Map<number, BoardPlace>>(() => {
    const out = new Map<number, BoardPlace>();
    const platform = this.settings().platform;
    const file = this.store.boardsFor(platform);
    if (!file) return out;
    const engine = this.engine();
    const rounds = this.matchdays();
    const resolve = (man: BoardMan): OnTable => {
      const one = man.fc_id == null ? undefined : engine?.get(man.fc_id);
      return {
        taken: false,
        price: null,
        // Fuori da un tavolo nessuno è «non nel listone»: questa pagina descrive, non compra.
        onTable: true,
        value99: null,
        expectedShare: one?.pv != null && rounds ? one.pv / rounds : null,
      };
    };
    const short = (man: PitchMan) => ({
      fcId: man.fcId,
      name: man.name,
      codes: man.codes,
      claim: man.claim,
    });
    for (const [club, board] of Object.entries(file.clubs ?? {})) {
      const pitch = pitchOf(board, resolve);
      if (!pitch) continue;
      for (const row of pitch.rows) {
        for (const man of row.men) {
          const place: Omit<BoardPlace, 'starter' | 'codes' | 'claim' | 'disagreement'> = {
            club,
            module: pitch.module,
            line: row.line,
            badge: man.badge,
            holder: short(man),
            rivals: man.duels.map(short),
            duelsKnown: man.duelsKnown,
          };
          if (man.fcId != null) {
            out.set(man.fcId, {
              ...place,
              starter: true,
              codes: man.codes,
              claim: man.claim,
              disagreement: man.disagreement,
            });
          }
          // ...e OGNI RIVALE riceve la stessa riga vista dalla sua parte: il titolare resta il titolare,
          // e gli altri contendenti sono gli altri ballottaggi dello stesso posto, lui escluso.
          for (const rival of man.duels) {
            if (rival.fcId == null) continue;
            out.set(rival.fcId, {
              ...place,
              starter: false,
              rivals: man.duels.filter((one) => one.fcId !== rival.fcId).map(short),
              codes: rival.codes,
              claim: rival.claim,
              disagreement: rival.disagreement,
            });
          }
        }
      }
    }
    return out;
  });

  // ---------------------------------------------------------------- la riga aperta

  /**
   * QUALE RIGA È APERTA: una sola.
   *
   * Aperte tutte insieme la pagina diventa un muro di catene e non si confronta più niente; ed è una
   * DOMANDA che si fa su un uomo alla volta - «perché lui?» - quindi la forma è quella.
   */
  private readonly open = signal<number | null>(null);

  protected isOpen(fcId: number): boolean {
    return this.open() === fcId;
  }

  protected toggle(fcId: number): void {
    this.open.update((one) => (one === fcId ? null : fcId));
  }

  /** La legenda del metodo, aperta o chiusa. Chiusa all'inizio: si legge una volta, non a ogni visita. */
  protected readonly method = signal(false);

  protected toggleMethod(): void {
    this.method.update((one) => !one);
  }

  /** Le regole che il foglio ha davvero percorso, per la legenda: quelle e non un elenco scritto a mano. */
  protected readonly rulesInPlay = computed(() => {
    const keys: string[] = [];
    for (const row of this.rows()) {
      for (const rung of [...row.why.fmRungs, ...row.why.pvRungs]) {
        if (!keys.includes(rung.key)) keys.push(rung.key);
      }
    }
    // Una sigla che questo file non conosce si stampa lo stesso, con la sua nota vuota: una regola
    // adottata domani deve comparire nella legenda invece di sparire da una spiegazione.
    return keys.map((key) => ({ key, note: RULE_NOTE[key] ?? null }));
  });

  // ---------------------------------------------------------------- fra i pari ruolo

  /**
   * LA GRADUATORIA DENTRO IL RUOLO, che è il modo in cui un numero sbagliato si fa vedere.
   *
   * Un errore quasi mai si legge in assoluto - «7.92 di fantamedia» non dice niente da solo - e si vede
   * per CONFRONTO: se un uomo sta terzo fra i difensori e non ha senso che ci stia, il numero che lo ha
   * portato lassù è quello da guardare. Quindi la carta mostra il suo posto e i VICINI, con le stesse
   * colonne della tabella: si confronta come con come.
   *
   * LA POOL È LO SLOT su cui il suo rimpiazzo è misurato (`engine_role_slot`) e non il ruolo di listone:
   * su un foglio mantra un'ala e una punta hanno due zeri diversi, quindi metterli in una graduatoria
   * sola confronterebbe due sottrazioni fatte da altezze diverse. Dove il foglio non porta lo slot resta
   * il ruolo classic, che su quel foglio È lo slot.
   *
   * E IL NOME DICE DI CHI È LA GRADUATORIA: è quella di QUESTA LISTA - 663 righe, quotati e non - e non
   * `engine_role_rank`, che il toolkit conta sulle 600 del foglio. Due ranghi sotto un nome solo sono il
   * difetto che questo progetto paga da sempre, quindi questo porta il suo («fra i 84 dc di questa
   * lista») invece di somigliare all'altro.
   */
  private readonly byPool = computed<Map<string, WhyRow[]>>(() => {
    const out = new Map<string, WhyRow[]>();
    for (const row of this.rows()) {
      const pool = row.pool;
      if (!pool) continue;
      const list = out.get(pool) ?? [];
      list.push(row);
      out.set(pool, list);
    }
    for (const [pool, list] of out) {
      // Ordinati come la pagina ordina di default: il surplus del foglio, il più alto per primo. Chi non
      // ha un numero non ha un posto - «vuoto = ignoto» - e finisce in fondo senza rango.
      list.sort(
        (left, right) =>
          (right.why.sheetSurplus ?? -Infinity) - (left.why.sheetSurplus ?? -Infinity) ||
          left.name.localeCompare(right.name, 'it'),
      );
      out.set(pool, list);
    }
    return out;
  });

  /** Dove sta ognuno nella sua pool, e quanti sono: la mappa che la carta legge. */
  private readonly ranks = computed<Map<number, { rank: number | null; total: number }>>(() => {
    const out = new Map<number, { rank: number | null; total: number }>();
    for (const list of this.byPool().values()) {
      const priced = list.filter((one) => one.why.sheetSurplus != null).length;
      list.forEach((row, at) => {
        out.set(row.fcId, {
          rank: row.why.sheetSurplus == null ? null : at + 1,
          total: priced,
        });
      });
    }
    return out;
  });

  protected rankOf(row: WhyRow): { rank: number | null; total: number } | null {
    return this.ranks().get(row.fcId) ?? null;
  }

  /**
   * I VICINI della riga aperta: tre sopra e tre sotto, lei compresa.
   *
   * Si calcola solo per la riga APERTA e non per tutte: una finestra per ognuna delle seicento righe
   * sarebbe seicento fette di lista per mostrarne una.
   */
  protected readonly openPeers = computed<{ pool: string; men: WhyRow[] } | null>(() => {
    const id = this.open();
    if (id == null) return null;
    const row = this.rows().find((one) => one.fcId === id);
    if (!row?.pool) return null;
    const list = this.byPool().get(row.pool) ?? [];
    const at = list.findIndex((one) => one.fcId === id);
    if (at < 0) return null;
    return {
      pool: row.pool,
      men: list.slice(Math.max(0, at - PEERS_AROUND), at + PEERS_AROUND + 1),
    };
  });

  // ---------------------------------------------------------------- come si stampa un numero

  /** Le giornate già disputate, dal foglio: il denominatore di «quest'anno». */
  protected readonly seen = computed(() => {
    for (const row of this.rows()) {
      if (row.why.why?.roundsSeen) return row.why.why.roundsSeen;
    }
    return null;
  });

  /**
   * SOTTO QUANTE PRESENZE il core rifiuta di prevedere: `model.MIN_PV_PREV` del toolkit, non un numero
   * di qui. Dichiarato con la sua provenienza perché è una SOGLIA DEL MOTORE e questa pagina la cita.
   */
  protected readonly minVotes = 15;

  /** Se la fantamedia dell'anno scorso poggia su un campione che il core non accetta. */
  protected thinSample(why: WhyColumns): boolean {
    return why.fmPrev != null && (why.pvPrev ?? 0) < this.minVotes;
  }

  /** La frase della cella «Quest'anno»: due numeri, e il tooltip dice quali. */
  protected nowNote(row: WhyRow): string {
    if (!row.now) return 'Non ha ancora una giornata giocata in questa stagione.';
    const bits = [`${row.now.played} giornate giocate delle ${this.seen() ?? '?'} disputate`];
    if (row.now.fm != null) bits.push(`fantamedia reale ${row.now.fm.toFixed(2)}`);
    if (row.now.mv != null) bits.push(`voto ${row.now.mv.toFixed(2)}`);
    if (row.now.minutes != null) bits.push(`${row.now.minutes}′ a partita`);
    bits.push('dai voti, non dall’aggregato di stagione');
    return bits.join(' · ');
  }

  /** La sigla di tre lettere del gradino, dal vocabolario che la possiede. Vuoto = ignoto, mai `RIS`. */
  protected short(status: string | null): string {
    return isTitolarita(status) ? TITOLARITA_SHORT[status] : '—';
  }

  /** ...e la frase intera, coi due numeri che l'hanno decisa: la sigla è un promemoria, non la spiegazione. */
  protected rungNote(row: WhyRow): string {
    return (
      titolaritaNote(row.titolarita, row.play, row.minutesNext) ??
      'Il foglio non porta il gradino per lui: la passata che lo scrive è la stessa che disegna gli undici.'
    );
  }

  /** Il posto in parole: «Dc dell’undici tipo (3-4-3)». Il badge è UNO, non l’elenco dei suoi codici. */
  protected placeLabel(place: BoardPlace): string {
    return [place.badge ?? place.line, place.module ? `(${place.module})` : ''].filter(Boolean).join(' ');
  }

  /** Un numero, o un trattino. Mai uno zero al posto di un vuoto. */
  protected num(value: number | null | undefined, format = '1.1-1'): string {
    if (value == null) return '—';
    return formatNumber(value, this.locale, format);
  }

  /** ...e col segno, per gli scarti: `+0,4` si legge come uno spostamento, `0,4` come un valore. */
  protected signed(value: number | null | undefined, format = '1.1-1'): string {
    if (value == null) return '—';
    return (value > 0 ? '+' : '') + formatNumber(value, this.locale, format);
  }

  protected pct(value: number | null | undefined): string {
    if (value == null) return '—';
    return formatNumber(value * 100, this.locale, '1.0-0') + '%';
  }

  /** Come si legge un gradino: il valore, e quanto ha spostato. Il template non decide niente. */
  protected rungText(rung: Rung, format: string): string {
    if (rung.value == null) return '—';
    const value = formatNumber(rung.value, this.locale, format);
    if (rung.delta == null) return value;
    if (rung.silent) return value;
    return `${value} (${rung.delta > 0 ? '+' : ''}${formatNumber(rung.delta, this.locale, format)})`;
  }
}
