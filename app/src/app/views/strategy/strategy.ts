import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { formatNumber } from '@angular/common';
import { Component, LOCALE_ID, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropdownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMenuModule } from 'ng-zorro-antd/menu';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule, NzSelectOptionInterface } from 'ng-zorro-antd/select';
import { NzSpaceModule } from 'ng-zorro-antd/space';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle, EngineSheetEntry, MantraModulesFile } from '../../core/bundle';
import { ExpectedPlay } from '../../core/expected-play';
import { GlobalOptions, LeagueSettings } from '../../core/global-options';
import {
  CalendarBook,
  CalendarFile,
  LeagueCalendar,
  calendarBookFrom,
  cleanSheetBaseline,
  cleanSheetOutlook,
} from '../../core/keeper-pairs';
import { withRowAt } from '../../core/manual-order';
import { matchFrequencies } from '../../core/match-frequency';
import { looseMatch } from '../../core/loose-search';
import { CardMan, CardStack, seasonTotals } from '../../core/player-card';
import { PlayerRatingsStore } from '../../core/player-ratings-store';
import { AuctionPricesStore, scaleTo } from '../../core/auction-prices';
import { PlayersStore } from '../../core/players-store';
import { GainScale, scaleOf } from '../../core/sealed-bid';
import {
  AuctionKind,
  BlockView,
  DEFAULT_READINGS,
  READINGS,
  SORTABLE_READINGS,
  GAIN_SORT,
  ReadingRef,
  SeasonFootball,
  refText,
  WHOLE_CAREER,
  defaultSeasonOf,
  readRef,
  sameRef,
  seasonSample,
  seasonsFor,
  seasonsNeeded,
  shortSeason,
  wantsPlayedFootball,
  RankedMan,
  ManReadings,
  ReadingKey,
  ReadingSpec,
  RoleBlock,
  SortKey,
  DEFAULT_SORT,
  StrategyBidder,
  StrategyGame,
  StrategySetup,
  blocksOf,
  gainOf,
  readingHas,
  readingIsRough,
  readingPair,
  readingShort,
  readingValue,
  readingsOf,
} from '../../core/strategy';
import {
  FilterClause,
  FilterSet,
  filterFields,
  filterReadings,
  isFilterSet,
  passesFilter,
  readClauses,
  readFilterSet,
} from '../../core/strategy-filter';
import { swingOf } from '../../core/swing';
import { EngineExpectation, ValuationStore, valueFromEngine } from '../../core/valuation-store';
import { stored, storedJson } from '../../core/view-state';
import { AppHeader } from '../../ui/app-header/app-header';
import { ClubCrest } from '../../ui/club-crest/club-crest';
import { GainChip } from '../../ui/gain-chip/gain-chip';
import { PlayerCard } from '../../ui/player-card/player-card';
import { PlayerFlags } from '../../ui/player-flags/player-flags';
import { RoleBadge } from '../../ui/role-badge/role-badge';
import { PlayerRulings } from '../../core/player-rulings';
import { TITOLARITA_SHORT, isTitolarita } from '../../core/titolarita';
import { RulingDot } from '../../ui/ruling-dot/ruling-dot';
import { StrategyFilters } from './strategy-filters/strategy-filters';

/**
 * IL REGOLAMENTO NON È PIÙ DI QUESTA PAGINA: sta in `core/global-options.ts` e vale per ogni vista.
 *
 * Qui resta solo quello che è di questa pagina e di nessun'altra - COME si legge un blocco - perché è
 * una preferenza di lettura e non una regola della lega. Il resto (listone, gioco, rose, budget,
 * partecipanti, tipo d'asta) lo dichiara il pannello delle opzioni globali, che questa pagina apre e
 * non duplica: due finestre sulla stessa dichiarazione sarebbero due dichiarazioni.
 */
type Settings = LeagueSettings & { view: BlockView };

/** Dove finisce l'ordine personale dei blocchi: una preferenza sua, non un fatto del bundle. */
const PRIORITY_KEY = 'strategy.priority';

/**
 * L'ordine personale come sta sul disco, validato invece che creduto.
 *
 * Quello che c'e' scritto puo' venire da una versione precedente: un JSON illeggibile, o che non e' una
 * mappa di liste di numeri, torna vuoto. Un ordine perso e' una preferenza persa, che va bene; una
 * pagina che non si apre no.
 */
function readPriority(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(`fantassistant.${PRIORITY_KEY}`);
    const stored: unknown = raw == null ? null : JSON.parse(raw);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const out: Record<string, number[]> = {};
    for (const [key, ids] of Object.entries(stored as Record<string, unknown>)) {
      if (!Array.isArray(ids)) continue;
      const kept = ids.filter((one): one is number => typeof one === 'number' && Number.isFinite(one));
      if (kept.length) out[key] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

/** Un numero che moltiplica le presenze, riscalato: null resta null, «vuoto = ignoto». */
function scaled(value: number | null, factor: number): number | null {
  return value == null ? null : value * factor;
}

/** Come si chiama a schermo ognuna delle due valute, e cosa dice quel numero. */
const GAIN_LABEL: Record<AuctionKind, string> = {
  rilanci: 'SURPLUS',
  draft: 'VALORE',
};

/**
 * PERCHÉ IL NUMERO È A GIORNATA, e non un totale di stagione (operatore, 04/09/2026).
 *
 * È la sua regola del 03/09 - «i risultati si riportano in punti A GIORNATA, mai in totali di stagione:
 * per me è più facile capire di che grandezze parliamo» - applicata alla colonna che ordina queste
 * liste. Un totale nasconde l'ordine di grandezza, e la giornata è anche l'unità in cui la differenza
 * CONTA, perché una giornata vale ~70 punti e la scala dei gol parte da 66.
 *
 * IL DIVISORE È DEL FOGLIO (`matchdays_target`, 38 su Serie A e 31 su EuroLeghe) e non una costante:
 * `engine_pv_pred` vive sul calendario della PIATTAFORMA, e dividere il surplus di un foglio per le
 * giornate di un altro è una quota di niente. Dove il foglio non lo dichiara il numero resta il totale
 * di stagione e l'etichetta lo DICE, invece di stampare un totale sotto un'unità che non è la sua.
 */
const PER_MATCH_HINT =
  ' Il numero è A GIORNATA: il totale di stagione diviso le giornate del calendario su cui il motore lo'
  + ' esprime (il foglio le dichiara), perché un totale nasconde l\'ordine di grandezza. L\'ordine delle'
  + ' liste non cambia - dividere tutti per lo stesso numero non riordina niente - e nemmeno le fasce del'
  + ' colore, che sono percentili.';

const GAIN_HINT: Record<AuctionKind, string> = {
  rilanci:
    "In un'asta a rilanci la risorsa scarsa è il credito, cioè esattamente quello che il surplus sottrae: i fantapunti che dà IN PIÙ del giocatore che schiereresti al suo posto. È la colonna del motore (engine_surplus), letta dal foglio e mai ricalcolata qui.",
  draft:
    'In un draft non si spendono crediti ma scelte, e il surplus addebita una scarsità per-slot che il regolamento non impone: misurato sulle cinque finestre del banco (metrica-asta-surplus-v1.md §16) costa il 4% dei punti. La valuta è quindi il VALORE - fantamedia attesa × presenze attese, senza sottrarre niente - portiere compreso.',
};

/**
 * LA STRATEGIA: quanti uomini di ogni ruolo servono, e chi sono i migliori.
 *
 * La pagina non possiede aritmetica: tutto quello che disegna viene da `core/strategy.ts`, che un test
 * unitario raggiunge senza un browser. Qui stanno la dichiarazione del regolamento (che nel bundle non
 * c'è), la scelta del FOGLIO che quella dichiarazione implica, e il layout.
 *
 * IL FOGLIO È SCELTO DA (listone, gioco) e non dalla piattaforma: il bundle ne porta tre - EuroLeghe
 * mantra, Leghe classic, Leghe mantra - e il surplus di un uomo è un fatto sul GIOCO per cui lo compri,
 * perché il rimpiazzo è per slot di ruolo e i due giochi non hanno gli stessi slot. Una combinazione che
 * il bundle non porta non viene riempita con l'altra: la pagina dice che non c'è.
 */
@Component({
  selector: 'app-strategy',
  imports: [
    AppHeader,
    CdkDrag,
    CdkDropList,
    ClubCrest,
    FormsModule,
    GainChip,
    NzAlertModule,
    NzButtonModule,
    NzDropdownModule,
    NzIconModule,
    NzMenuModule,
    NzInputModule,
    NzPopconfirmModule,
    NzRadioModule,
    NzSelectModule,
    NzSpaceModule,
    NzTooltipModule,
    PlayerCard,
    PlayerFlags,
    RoleBadge,
    RulingDot,
    StrategyFilters,
  ],
  templateUrl: './strategy.html',
  host: { class: 'view-host' },
})
export class Strategy {
  protected readonly store = inject(ValuationStore);
  private readonly bundle = inject(Bundle);
  /**
   * LE LETTURE MISURATE, per la sola metà che il foglio non porta: la COSTANZA.
   *
   * Letta da chi la calcola già e mai ricalcolata qui: `steadyOf` è una definizione sola con tre
   * lettori (la colonna, il campetto, le buste), e una quarta copia darebbe a un uomo due percentuali
   * di sufficienze. Non costa niente in più a questa pagina - `ValuationStore` chiede le letture da sé
   * appena il listone è in casa - e finché non arrivano la pastiglia porta le sole presenze.
   */
  private readonly ratings = inject(PlayerRatingsStore);
  /** Le dritte dichiarate: la parola della titolarita' che una riga mostra e' la tua, se ce n'e' una. */
  private readonly rulings = inject(PlayerRulings);
  /** Il regolamento della lega e le squadre escluse: dichiarati una volta, validi in ogni vista. */
  private readonly options = inject(GlobalOptions);
  /** Il conto delle giornate che giochera' davvero: lo stesso della plancia, non una copia. */
  private readonly play = inject(ExpectedPlay);

  /**
   * IL CALCIO GIOCATO, per le due pastiglie degli ATTESI - e si carica solo se qualcuno le accende.
   *
   * xG e xA non stanno in nessun aggregato che questa pagina gia' legge: `season_stats` non li ha. Le
   * DUE strade misurate il 05/09/2026: l'aggregato di stagione del provider (`external_stats`, 310 KB)
   * e la somma delle sue partite (`external_match_stats`, 2,1 MB, che e' quello che la CARD somma nel
   * riepilogo). Non danno lo stesso numero - il provider serve un xG diverso dalla pagina di stagione e
   * da quella della partita, e a due decimali **il 19,7% degli uomini leggerebbe due cifre diverse**,
   * fino a 0,21 di scarto - quindi l'aggregato e' stato scartato: una pastiglia e una card aperte sullo
   * stesso schermo che dicono due xG dello stesso uomo sono il difetto che questo repository paga da
   * sempre.
   *
   * IL PREZZO E' PAGATO SOLO DA CHI LE ACCENDE. Le due pastiglie sono spente all'apertura, e lo store
   * si chiede al primo click (`load()` tiene la sua promessa, quindi aprire una card dopo non costa
   * niente). Finche' non atterra le due caselle portano un trattino, che e' quello che sono.
   */
  private readonly players = inject(PlayersStore);
  /**
   * IL PREZZO CHE UNA STANZA VERA HA PAGATO (`core/auction-prices.ts`, 08/09/2026, su richiesta
   * dell'operatore). Caricato all'apertura e non al primo click come il calcio giocato: la tabella
   * sta in 4 KB, quindi non c'e' niente da rimandare - il prezzo che si paga per una pastiglia
   * pigra e' una casella vuota su una pagina gia' disegnata.
   */
  private readonly paidPrices = inject(AuctionPricesStore);

  /** Il calendario su cui il foglio esprime le sue previsioni: il divisore di ogni numero a giornata. */
  protected readonly matchdays = computed(() => this.sheet()?.matchdays_target ?? null);

  /**
   * Il gain A GIORNATA, che è quello che le liste mostrano (vedi `PER_MATCH_HINT`).
   *
   * UNA definizione sola, letta dalla riga E dalla scala del colore: le fasce sono percentili, quindi
   * dividere solo le righe le lascerebbe tarate su un'altra unità e ogni uomo leggerebbe `scarso`.
   */
  protected perMatch(gain: number | null): number | null {
    const rounds = this.matchdays();
    return gain == null || !rounds ? gain : gain / rounds;
  }

  protected readonly gainLabel = computed(
    () => GAIN_LABEL[this.settings().auction] + (this.matchdays() ? ' a giornata' : ' a stagione'),
  );

  protected readonly gainHint = computed(
    () =>
      GAIN_HINT[this.settings().auction] +
      (this.matchdays()
        ? PER_MATCH_HINT.replace('il foglio le dichiara', `${this.matchdays()} su questo foglio`)
        : ' Il foglio non dichiara il suo calendario, quindi questo è il TOTALE di stagione: senza le'
          + ' giornate su cui il motore lo esprime, un numero a giornata sarebbe una quota di niente.'),
  );

  /**
   * IL REGOLAMENTO, letto dalle opzioni globali, più la sola preferenza che è di questa pagina.
   *
   * Letto e non copiato: se la Strategia ne tenesse una copia, cambiarlo dalle Buste chiuse lascerebbe
   * questa pagina a ordinare con un budget e delle rose che nessuno dichiara più.
   */
  /**
   * COME SI LEGGE UN BLOCCO: l'unica preferenza che resta di questa pagina.
   *
   * Non è il regolamento - non cambia chi si può comprare né quanti - è come si vuole leggere la
   * classifica di un posto, quindi segue l'operatore da una sessione all'altra e sta in `localStorage`
   * come le altre preferenze di lettura. Un valore che questa versione non capisce torna al default.
   */
  protected readonly view = stored<BlockView>('strategy.view', 'all', ['all', 'natives']);

  protected readonly settings = computed<Settings>(() => ({
    ...this.options.league(),
    view: this.view(),
  }));

  /** Il rulebook mantra: le undici forme legali e quali ruoli accetta ogni posto. Letto, mai dedotto. */
  private readonly rulebook = signal<MantraModulesFile | null>(null);
  private readonly rulebookMissing = signal(false);

  /** Il calendario prezzato del bundle, o null: serve al solo bonus porta inviolata dei portieri. */
  private readonly calendarFile = signal<CalendarFile | null>(null);
  private readonly calendar = computed<CalendarBook | null>(() => calendarBookFrom(this.calendarFile()));

  /**
   * L'ORDINE PERSONALE per blocco: `listone|gioco|ruolo` -> gli `fc_id` come li ha sistemati lui.
   *
   * La chiave NON contiene il foglio: una preferenza è un fatto sulla sua lega e sul ruolo, non sulla
   * revisione del foglio che stiamo leggendo, quindi un export nuovo la conserva. Contiene il listone e
   * il gioco perché quelli sono liste di uomini DIVERSE, e un ordine che scavalcasse da una all'altra
   * sarebbe l'ordine di una lista addosso a un'altra.
   */
  private readonly priority = signal<Record<string, number[]>>(readPriority());

  /** Solo gli ordini di questa combinazione, per ruolo: è quello che `blocksOf` chiede. */
  private readonly priorityHere = computed<Map<string, readonly number[]>>(() => {
    const { platform, game } = this.settings();
    const out = new Map<string, readonly number[]>();
    for (const [key, ids] of Object.entries(this.priority())) {
      const [where, which, role] = key.split('|');
      if (where === platform && which === game && role && ids.length) out.set(role, ids);
    }
    return out;
  });

  /** Quanti blocchi porta un ordine suo: la barra lo dice, o una preferenza salvata è invisibile. */
  protected readonly arranged = computed(() => this.priorityHere().size);


  /** Le colonne del motore del foglio scelto, per `fc_id`. Null = non ancora lette, o foglio assente. */
  private readonly engine = signal<Map<number, EngineExpectation> | null>(null);
  protected readonly reading = signal(false);

  constructor() {
    void this.store.load();
    // Il prezzo pagato da aste vere: 4 KB, quindi si carica con la pagina. La `pool` lo legge da un
    // signal, cosi' le righe si rifanno da se' quando atterra - come per le sufficienze.
    void this.paidPrices.ensure();
    void this.bundle.modules().then((file) => {
      this.rulebook.set(file);
      // Un bundle più vecchio non porta il regolamento: su mantra le liste non possono essere
      // dimensionate dalle forme, e la pagina lo dice invece di inventare una lunghezza.
      this.rulebookMissing.set(file == null);
    });
    // Il calendario prezzato del bundle, per il bonus porta inviolata dello SWING dei portieri. La
    // fetch è UNA (il servizio la cachea), quindi due pagine che lo leggono non lo scaricano due volte.
    void this.bundle.calendar().then((file) => this.calendarFile.set(file));

    // Il foglio cambia quando cambia (listone, gioco): le colonne si rileggono, e finché non arrivano la
    // pagina dice che sta leggendo - un vuoto silenzioso si legge come «nessuno è valutato».
    effect(() => {
      const sheet = this.sheet();
      if (!sheet) {
        this.engine.set(null);
        this.reading.set(false);
        return;
      }
      this.reading.set(true);
      void this.store.expectationsFor(sheet).then((columns) => {
        // Il foglio può essere già cambiato mentre si leggeva: una risposta vecchia non deve
        // sovrascrivere quella nuova.
        if (this.sheet()?.path !== sheet.path) return;
        this.engine.set(columns);
        this.reading.set(false);
      });
    });
  }

  // ---------------------------------------------------------------- il foglio e il setup

  /** Il foglio che prezza QUESTA combinazione, o null se il bundle non ce l'ha. */
  protected readonly sheet = computed<EngineSheetEntry | null>(() => {
    const { platform, game } = this.settings();
    return (
      this.store.sheets().find((one) => one.platform === platform && one.game === game) ?? null
    );
  });

  /** Cosa il bundle porta davvero, per dirlo quando la combinazione scelta non c'è. */
  protected readonly available = computed(() =>
    this.store
      .sheets()
      .map((one) => `${one.league} · ${one.game === 'mantra' ? 'Mantra' : 'Classic'}`)
      .join(' · '),
  );

  protected readonly setup = computed<StrategySetup>(() => {
    const { game, slots, budget, auction, teams, view } = this.settings();
    return { game, slots, budget, auction, teams, view };
  });

  /**
   * Come si leggono i blocchi, e lo switch sta nella BARRA e non nella finestra: cambia l'ordine di ogni
   * lista a schermo, e un'impostazione che cambia quello che si sta guardando non si mette dove per
   * vederla bisogna chiudere quello che si sta guardando.
   */
  protected readonly viewOptions: { value: BlockView; label: string; hint: string }[] = [
    // I suggerimenti sono CORTI per regola dell'operatore (05/09/2026): poche parole per dire cosa
    // vuol dire quella scelta. Il perché - e i numeri che l'hanno decisa - stanno in
    // `pagina-strategia-v1.md` e nei commenti, dove si leggono una volta invece che a ogni hover.
    { value: 'all', label: 'Tutti', hint: 'Chiunque possa coprire il posto.' },
    { value: 'natives', label: 'Solo di mestiere', hint: 'Solo chi non può giocare più arretrato.' },
  ];

  protected setView(view: BlockView): void {
    this.view.set(view);
  }

  // ---------------------------------------------------------------- le letture della riga

  /**
   * QUALI NUMERI SI VEDONO SU UNA RIGA (richiesta dell'operatore, 05/09/2026).
   *
   * Quattordici pastiglie cliccabili al posto della scritta che c'era in barra, e le prime tre accese
   * all'inizio. E' una preferenza di LETTURA - non cambia chi si puo' comprare ne' in che ordine - e
   * per questo sta in `localStorage` come il taglio dei blocchi, e non nell'indirizzo.
   *
   * `storedJson` e non `storedList` perche' NESSUNA pastiglia accesa e' una scelta legittima, e una
   * lista vuota sul disco deve restare vuota invece di ripartire dai default: «vuoto = ignoto» vale per
   * chi non ha mai scelto, non per chi ha scelto di spegnere tutto.
   */
  protected readonly readings = storedJson<string[]>('strategy.readings', (raw) =>
    Array.isArray(raw) ? raw.filter((one): one is string => typeof one === 'string') : [...DEFAULT_READINGS],
  );

  /**
   * LE CONDIZIONI IN VIGORE (operatore, 12/09/2026): tutte insieme, in AND.
   *
   * SI RICORDANO, a differenza della ricerca per blocco qui sotto, e la differenza non e' un capriccio:
   * quella e' una domanda che si fa e si chiude, questo e' uno strumento che si costruisce. Quello che
   * rende legittimo ricordarlo e' che ogni condizione e' SCRITTA IN BARRA col suo segno e con quanti
   * nomi sta nascondendo (`strategy-filters`), quindi non puo' aprire una sessione nascondendo meta'
   * lista in silenzio - e' la stessa cura con cui i filtri per colonna della tabella si ricordano.
   *
   * `readClauses` come lettore e non un type guard: una condizione scritta da una versione precedente
   * su una lettura che non esiste piu' si BUTTA, e le altre restano. Un filtro che non si puo' ne'
   * leggere ne' spegnere taglierebbe una lista senza dire perche'.
   */
  protected readonly clauses = storedJson<FilterClause[]>('strategy.filter', readClauses);

  /** ...e gli insiemi SALVATI, che sono quello che l'operatore richiama («salvare e richiamare un set»). */
  protected readonly filterSets = storedJson<FilterSet[]>('strategy.filters', (raw) =>
    Array.isArray(raw) ? raw.filter(isFilterSet).map(readFilterSet) : [],
  );

  /**
   * LE LETTURE CHE SERVONO ALLA PAGINA: quelle accese PIU' quelle che il filtro interroga.
   *
   * Una definizione sola, e non e' un dettaglio: quali stagioni di calcio giocato caricare si decide da
   * qui, e senza le chiavi del filtro una condizione su `xG` avrebbe letto una colonna che nessuno ha
   * caricato - cioe' avrebbe svuotato ogni blocco in silenzio, che e' il difetto peggiore che un filtro
   * possa avere.
   */
  private readonly needed = computed<ReadingRef[]>(() => [
    ...this.shownReadings().map((one) => one.ref),
    ...filterReadings(this.clauses()).map((one) => ({
      key: one.key,
      // Una condizione scritta prima che la stagione esistesse non la porta: cade sul default della
      // sua lettura, che e' la stessa risposta che da' la pastiglia.
      season: one.season ?? defaultSeasonOf(
        READINGS.find((spec) => spec.key === one.key)!,
        this.seasonNames(),
      ),
    })),
  ]);

  /**
   * LE DUE STAGIONI CHE IL PACCHETTO DICHIARA, come le pastiglie le scrivono.
   *
   * Lette dal manifest e mai calcolate: `targetSeason` e' quella che si sta comprando, `inputSeason`
   * quella su cui il foglio e' costruito, e tutt'e due seguono il viaggio nel tempo. Un'etichetta che
   * dicesse `25/26` sopra i numeri di un'altra stagione sarebbe un nome che non corrisponde al suo
   * numero, che questo progetto ha gia' pagato una volta (la colonna «Bonus», 18/08/2026).
   */
  private readonly seasonNames = computed(() => ({
    target: this.store.targetSeason(),
    input: this.store.inputSeason(),
  }));

  /**
   * LE STAGIONI CHE SI POSSONO SCEGLIERE: quelle di cui il pacchetto porta il calcio giocato.
   *
   * Dallo store e non dal manifest, perche' la domanda e' «di quali stagioni ho le partite» e non
   * «quali dichiara il foglio»: sono le `heavy_seasons`, e finche' il livello per-partita non e' in
   * casa restano le due che il foglio nomina - cosi' il menu' non e' mai vuoto e non offre una
   * stagione su cui ogni cella sarebbe un trattino.
   *
   * Dalla piu' recente: al tavolo la prima domanda e' «quest'anno».
   */
  protected readonly pickableSeasons = computed<string[]>(() => {
    const { target, input } = this.seasonNames();
    const carried = this.players.ready() ? [...this.players.seasons()] : [];
    const known = carried.length ? carried : [target, input].filter(Boolean);
    return [...new Set(known)].sort().reverse();
  });

  /**
   * LE PASTIGLIE DELLA BARRA: una per LETTURA, con le stagioni che ha accese.
   *
   * Una per lettura e non una per istanza, ed e' una decisione di larghezza: con tre stagioni per
   * undici letture stagionali la fila sarebbe di quarantacinque bottoni. La molteplicita' vive nel
   * MENU' della pastiglia (quali stagioni) e sulla RIGA (una cella per stagione accesa), che e' anche
   * dove serve leggerla.
   */
  protected readonly readingPills = computed(() => {
    const refs = this.shownReadings();
    const seasons = this.seasonNames();
    const pickable = this.pickableSeasons();
    return READINGS.map((spec) => {
      const mine = refs.filter((one) => one.ref.key === spec.key);
      return {
        key: spec.key,
        label: spec.label,
        hint: spec.hint,
        seasonal: !!spec.seasonal,
        on: mine.length > 0,
        /** Le stagioni accese di questa lettura, per il segno di spunta nel menu'. */
        seasons: mine.map((one) => one.ref.season),
        /** ...e quelle che puo' prendere: `tutte` solo dove la spec lo dichiara. */
        choices: seasonsFor(spec, pickable).map((season) => ({
          season,
          label: season === WHOLE_CAREER ? WHOLE_CAREER : shortSeason(season),
          on: mine.some((one) => one.ref.season === season),
        })),
        /** La sigla come si legge: con la stagione quando ne ha UNA sola accesa, o quante sono. */
        short: mine.length === 1
          ? readingShort(spec, mine[0].ref)
          : mine.length > 1
            ? `${spec.short} ×${mine.length}`
            : spec.short,
        default: defaultSeasonOf(spec, seasons),
      };
    });
  });

  /**
   * QUALE PASTIGLIA HA APERTO IL MENU' DELLE STAGIONI.
   *
   * Un menu' solo per tutte, riempito da chi lo apre: uno per pastiglia vorrebbe dire venti
   * `nz-dropdown-menu` nel DOM, e due direttive che attaccano lo STESSO `TemplateRef` a due overlay e'
   * il guasto misurato il 20/08/2026 sugli imbuti della tabella.
   */
  protected readonly menuFor = signal<ReadingKey | null>(null);

  /** Le stagioni che la pastiglia aperta puo' prendere, con la spunta su quelle accese. */
  protected readonly seasonChoices = computed(() => {
    const key = this.menuFor();
    return this.readingPills().find((one) => one.key === key)?.choices ?? [];
  });

  /**
   * ...e le ISTANZE accese, che e' quello che una riga disegna: una cella per (lettura, stagione).
   *
   * Nell'ordine in cui `READINGS` dichiara le letture, e dentro una lettura per stagione DECRESCENTE:
   * due celle `MV` accanto si leggono «quest'anno, l'anno prima», che e' il verso in cui si guarda una
   * carriera. Senza un ordine dichiarato sarebbero due numeri uguali in ordine di click.
   */
  protected readonly shownReadings = computed(() => {
    const seasons = this.seasonNames();
    const refs = this.readings()
      .map((one) => readRef(one, seasons))
      .filter((one): one is ReadingRef => !!one);
    const out: { ref: ReadingRef; spec: ReadingSpec; id: string }[] = [];
    for (const spec of READINGS) {
      const mine = refs.filter((one) => one.key === spec.key);
      mine.sort((left, right) => (right.season ?? '').localeCompare(left.season ?? ''));
      for (const ref of mine) {
        // `id` e' la chiave di `@for` E l'attributo che l'arnese legge: due celle della stessa lettura
        // su due stagioni devono essere distinguibili, e la chiave nuda le renderebbe la stessa cosa.
        if (!out.some((one) => sameRef(one.ref, ref))) out.push({ ref, spec, id: refText(ref) });
      }
    }
    return out;
  });

  /**
   * SE QUALCUNO HA CHIESTO GLI ATTESI, e allora si va a prendere il calcio giocato.
   *
   * L'effetto sta qui e non nel costruttore perche' la scelta cambia a ogni click, e la preferenza e'
   * SALVATA: chi le aveva accese ieri le trova accese oggi, e la richiesta parte all'apertura. Una
   * seconda chiamata non costa niente - `load()` tiene la sua promessa - quindi non serve ricordarsi
   * se e' gia' stata fatta.
   */
  private readonly wantsExpected = effect(() => {
    if (wantsPlayedFootball(this.needed())) void this.players.load();
  });

  /**
   * LE STAGIONI DI CALCIO GIOCATO DA RICOSTRUIRE, e nient'altro: quelle che qualcuno guarda.
   *
   * Un computed a se' e non tre righe dentro `pool`, per la ragione di sempre: un computed si invalida
   * sul VALORE che produce, quindi da qui passa un ELENCO DI STAGIONI e non le pastiglie accese.
   * Scritto dentro `pool`, accendere una qualunque pastiglia ricostruiva le seicento righe - con
   * l'esito atteso, la costanza e il fantavalore di ognuna - per una preferenza di lettura.
   *
   * La chiave e' una stringa perche' un array nuovo a ogni giro invaliderebbe comunque: due elenchi
   * con le stesse stagioni sono la stessa risposta, e `pool` non deve rifarsi per un oggetto nuovo.
   */
  private readonly heavySeasons = computed<string>(() => {
    if (!this.players.ready()) return '';
    return seasonsNeeded(this.needed()).sort().join('|');
  });

  /**
   * Se la cella ha qualcosa da stampare e se quel qualcosa è spannometrico: dal vocabolario.
   *
   * `has` e non «il numero è nullo», da quando esistono le coppie: `readingValue` risponde `null` su
   * una `G:A` per costruzione, quindi la riga avrebbe disegnato vuota la pastiglia di chi ha segnato.
   */
  protected has = readingHas;
  protected isRough = readingIsRough;

  private readonly locale = inject(LOCALE_ID);

  /**
   * LA PASTIGLIA COME SI LEGGE: un metodo e non tre chiamate nel template.
   *
   * Ogni riga ne disegna fino a quattordici e le righe sono seicento: scrivere il ternario nel
   * template vorrebbe dire chiamare `readingValue` tre volte per pastiglia a ogni giro di change
   * detection. Un trattino e non uno zero dove il numero non c'è, che è la regola di casa sui vuoti.
   */
  /**
   * SU QUANTE GIORNATE POGGIANO LE MEDIE che la riga mostra, e di QUALE stagione.
   *
   * Da quando la stagione si sceglie, «MV/FM su 3ª» non basta piu': la stessa riga puo' portare la
   * media di due stagioni, e un campione senza il suo anno descriverebbe l'altra. Una frase per
   * stagione accesa, e niente per chi non ne ha nessuna.
   */
  protected sampleSaid(readings: ManReadings): string {
    const said: string[] = [];
    for (const season of new Set(this.shownReadings().map((one) => one.ref.season))) {
      if (!season || season === WHOLE_CAREER) continue;
      const sample = seasonSample(season, readings);
      if (sample) said.push(`MV/FM ${shortSeason(season)} su ${sample}ª`);
    }
    return said.length ? ` · ${said.join(' · ')}` : '';
  }

  protected text(spec: ReadingSpec, ref: ReadingRef, readings: ManReadings): string {
    // LE PAROLE PER PRIME, e non passano da `DecimalPipe`: un formato numerico su una stringa stampa
    // `NaN`, che e' il modo in cui una pastiglia nuova finisce a schermo sbagliata invece che vuota.
    // La sigla e' quella della tabella (`TITOLARITA_SHORT`): due vocabolari per un gradino sarebbero
    // due legende da imparare.
    if (spec.word) {
      const rung = readings.titolarita;
      return isTitolarita(rung) ? TITOLARITA_SHORT[rung] : '—';
    }
    // LE COPPIE PER PRIME, perche' per loro `readingValue` risponde `null` per costruzione: leggerlo
    // e basta stamperebbe un trattino su un uomo che ha segnato dodici gol.
    if (spec.pair) {
      const pair = readingPair(ref, readings);
      if (!pair) return '—';
      const digits = (value: number) => formatNumber(value, this.locale, spec.format);
      return `${digits(pair.goals)}:${digits(pair.assists)}`;
    }
    const value = readingValue(ref, readings);
    if (value == null) return '—';
    const sign = spec.signed && value > 0 ? '+' : '';
    return sign + formatNumber(value, this.locale, spec.format) + (spec.suffix ?? '');
  }

  /**
   * ACCENDE UNA LETTURA SULLA SUA STAGIONE DI DEFAULT, o la spegne TUTTA.
   *
   * Spegnere tutte le sue stagioni e non solo una, e non e' una scorciatoia: il bottone dice «questa
   * lettura», e lasciarne accesa una mentre il bottone si spegne sarebbe un interruttore che non
   * corrisponde a quello che si vede sulla riga. Le stagioni una per una si scelgono nel menu'.
   */
  protected toggleReading(key: ReadingKey): void {
    const spec = READINGS.find((one) => one.key === key);
    if (!spec) return;
    const season = spec.seasonal ? defaultSeasonOf(spec, this.seasonNames()) : null;
    const mine = this.shownReadings().filter((one) => one.ref.key === key);
    this.readings.update((on) =>
      mine.length
        ? on.filter((one) => readRef(one, this.seasonNames())?.key !== key)
        : [...on, refText({ key, season })],
    );
  }

  /**
   * ...E UNA STAGIONE PER VOLTA (operatore, 12/09/2026), che e' quello che permette di averne due
   * accanto: `MV 26/27` e `MV 25/26` sono due celle della stessa lettura.
   *
   * Togliere l'ultima spegne la lettura, perche' una lettura accesa su nessuna stagione non e' uno
   * stato che si possa disegnare - e il bottone la mostrerebbe accesa su una riga che non ha celle.
   */
  protected toggleSeason(key: ReadingKey, season: string): void {
    const seasons = this.seasonNames();
    const wanted = refText({ key, season });
    this.readings.update((on) => {
      const mine = on.filter((one) => {
        const ref = readRef(one, seasons);
        return ref?.key === key && refText(ref) === wanted;
      });
      return mine.length
        ? on.filter((one) => {
          const ref = readRef(one, seasons);
          return !(ref?.key === key && refText(ref) === wanted);
        })
        : [...on, wanted];
    });
  }

  // ---------------------------------------------------------------- la ricerca dentro un blocco

  /**
   * IL TESTO CERCATO IN OGNI BLOCCO (richiesta dell'operatore, 05/09/2026): la lente in intestazione
   * apre una casella sotto, e la casella filtra QUELLA lista per nome o per squadra.
   *
   * Per BLOCCO e non per pagina: dodici liste a mantra sono dodici domande diverse, e un filtro solo
   * le taglierebbe tutte per trovare un nome in una. Non si salva in `localStorage` come le altre
   * preferenze di lettura, perché non è una preferenza: è una domanda che si fa e si chiude - e un
   * filtro salvato che al ricaricamento nasconde metà lista è la cosa peggiore che questa pagina possa
   * fare a un'asta.
   */
  private readonly queries = signal<Record<string, string>>({});
  private readonly openSearch = signal<Record<string, boolean>>({});

  protected queryOf(role: string): string {
    return this.queries()[role] ?? '';
  }

  protected searchOpen(role: string): boolean {
    return this.openSearch()[role] ?? false;
  }

  /**
   * Apre o chiude la casella, e CHIUDENDO cancella il testo.
   *
   * Un filtro attivo dentro un pannello chiuso è invisibile, e una lista corta senza una ragione a
   * schermo si legge come un blocco rotto - la stessa regola per cui i filtri della tabella portano
   * la loro etichetta sopra la tabella (20/08/2026).
   */
  protected toggleSearch(role: string): void {
    const open = !this.searchOpen(role);
    this.openSearch.update((one) => ({ ...one, [role]: open }));
    if (!open) {
      this.queries.update((one) => ({ ...one, [role]: '' }));
      return;
    }
    // Il fuoco va nella casella appena esiste: si apre per scrivere, e chiedere un secondo click
    // sarebbe un gesto in più su una pagina che si usa con una mano sola.
    queueMicrotask(() => document.getElementById(`cerca-${role}`)?.focus());
  }

  protected setQuery(role: string, text: string): void {
    this.queries.update((one) => ({ ...one, [role]: text }));
  }

  /**
   * I BLOCCHI COME SI VEDONO: gli stessi di `blocks()`, con le righe che la ricerca lascia passare.
   *
   * Il filtro sta QUI e non in `blocksOf` perché non è una regola del gioco: la domanda «quanti uomini
   * di questo ruolo comprerà la stanza» non cambia perché sto cercando un nome, e il numero accanto a
   * ogni riga resta il suo posto VERO (`RankedMan.at`, assegnato prima del filtro) - rinumerare da uno
   * le tre righe trovate direbbe che il quarantesimo difensore è il primo.
   */
  protected readonly visible = computed(() =>
    this.blocks().map((block) => {
      const query = this.queryOf(block.role);
      if (!query.trim()) return { ...block, hidden: 0 };
      const men = block.men.filter((row) => looseMatch(query, row.man.name, row.man.club));
      return { ...block, men, hidden: block.men.length - men.length };
    }),
  );

  // ---------------------------------------------------------------- la card di un calciatore

  /**
   * LE CARD APERTE su questa pagina, con la loro pila.
   *
   * `new CardStack()` e non un servizio: la regola del posto e di chi sta davanti e' UNA sola
   * (`core/player-card.ts`), ma le card di questa pagina non devono seguirti sulla plancia - sono due
   * pile della stessa specie.
   */
  private readonly cards = new CardStack();

  protected readonly openCards = computed(() => {
    const byId = new Map(this.pool().map((man) => [man.fcId, man]));
    const engine = this.engine();
    const rounds = this.matchdays();
    const { platform, game } = this.settings();
    return this.cards.place((id) => {
      const man = byId.get(id);
      return man ? cardManOf(man, engine?.get(id) ?? null, rounds, platform, game) : undefined;
    });
  });

  protected readonly frontCard = computed(() => this.cards.front());

  protected closeCard(id: number): void {
    this.cards.closeCard(id);
  }

  protected raiseCard(id: number): void {
    this.cards.raiseCard(id);
  }

  protected closeAllCards(): void {
    this.cards.openCard(null);
  }

  /**
   * IL CLICK APRE LA CARD, IL TRASCINAMENTO RIORDINA (richiesta dell'operatore, 05/09/2026).
   *
   * Sulla stessa riga convivono due gesti, e la sola cosa che li distingue e' se CDK ha superato la sua
   * soglia (`dragStartThreshold`, 5px): sotto quella non e' un trascinamento e nessun `cdkDragStarted`
   * arriva. CDK pero' non spegne il `click` che il browser manda dopo un rilascio, quindi senza questa
   * guardia ogni riordino aprirebbe anche la card della riga rilasciata.
   *
   * La guardia si spegne su un TIMEOUT e non dentro il click: se un trascinamento finisce e nessun click
   * segue, un flag che aspetta il click si mangerebbe quello dopo - «un guard che ferma meta' di un
   * gesto lo rende meta' rotto», la lezione della lente della plancia (04/09/2026).
   */
  private dragging = false;

  protected onDragStarted(): void {
    this.dragging = true;
  }

  protected onDragEnded(): void {
    // Il `click` di un rilascio arriva PRIMA di un timeout, quindi la guardia e' ancora alzata per lui
    // e giu' per il prossimo.
    setTimeout(() => (this.dragging = false));
  }

  protected onPick(man: StrategyBidder): void {
    if (this.dragging) return;
    this.cards.openCard(man.fcId);
  }

  /**
   * DOVE LA DICHIARAZIONE E IL FOGLIO NON VANNO D'ACCORDO, e non si corregge da sé.
   *
   * Il surplus del foglio è contato dal rimpiazzo di `squadre × slot` del foglio stesso: se la lega che
   * l'operatore dichiara ne ha altri, il GAIN resta quello del foglio - l'app non ha un motore e non può
   * ricalcolarlo - mentre le LISTE seguono la sua dichiarazione. Detto a schermo, perché «un numero deve
   * dire contro cosa è misurato»: il bottone «allinea al foglio» è lì per chi vuole che coincidano.
   */
  protected readonly mismatch = computed<string | null>(() => {
    const sheet = this.sheet();
    if (!sheet) return null;
    const { teams, game, slots } = this.settings();
    const said: string[] = [];
    if (sheet.teams != null && sheet.teams !== Math.round(teams)) {
      said.push(`${sheet.teams} squadre invece di ${Math.round(teams)}`);
    }
    const own = sheet.squad_slots;
    if (own) {
      const mine =
        game === 'classic'
          ? [slots.classic.P, slots.classic.D, slots.classic.C, slots.classic.A]
          : null;
      const sheetSlots = [own['P'] ?? 0, own['D'] ?? 0, own['C'] ?? 0, own['A'] ?? 0];
      if (mine && mine.some((one, at) => Math.round(one) !== sheetSlots[at])) {
        said.push(`rose ${sheetSlots.join('/')} invece di ${mine.map(Math.round).join('/')}`);
      }
      if (!mine) {
        // Su mantra il foglio dichiara comunque i quattro slot classic: quello che si può confrontare è
        // il totale, cioè quanti uomini una rosa tiene - il resto è un altro vocabolario.
        const total = sheetSlots.reduce((sum, one) => sum + one, 0);
        const declared = Math.round(slots.mantra.por + slots.mantra.mov);
        if (total !== declared) said.push(`rose di ${total} uomini invece di ${declared}`);
      }
    }
    return said.length ? said.join(', ') : null;
  });

  // ---------------------------------------------------------------- gli uomini

  /**
   * Ogni uomo quotato su questo listone, con i due numeri del foglio scelto addosso.
   *
   * Il PERIMETRO è quello del listone (`listone_quotes` attraverso lo store), cioè la stessa popolazione
   * che vede la tabella di consultazione: due liste diverse sotto la stessa intestazione sarebbero due
   * liste i cui numeri descrivono l'altra.
   */
  protected readonly pool = computed<StrategyBidder[]>(() => {
    const engine = this.engine();
    if (!engine) return [];
    const platform = this.settings().platform;
    const listone = this.store.rosters().get(platform) ?? [];
    // Letto perché le righe si RIFACCIANO quando le letture atterrano: arrivano dopo il resto del
    // bundle, e senza questa dipendenza la pastiglia delle sufficienze resterebbe muta per sempre su
    // una pagina già disegnata. Stessa riga, stessa ragione, di `ValuationStore.valuations`.
    const rated = this.ratings.ready();
    // La valuta della sua lega, letta una volta: il prezzo osservato ci si converte dentro.
    const { teams: teamsNow, budget: budgetNow } = this.settings();
    const matchdays = this.matchdays();
    // Il calendario prezzato, per il +1 a porta inviolata dei portieri; la media di campionato e'
    // cacheata per lega, o seicento righe la ricalcolerebbero venti volte.
    const book = this.calendar();
    const csBase = new Map<LeagueCalendar, number | null>();
    // LE STAGIONI DI CALCIO GIOCATO DA RICOSTRUIRE, e nient'altro: quelle che le pastiglie accese e il
    // filtro nominano. Da un computed suo, cosi' questa lista dipende dal RISULTATO - un elenco di
    // stagioni - e non dalle pastiglie: accenderne una che non costa niente non rifa' le seicento
    // righe. Lo `scoring` serve solo a dare un VALORE agli eventi e non a dire quali sono bonus,
    // quindi una lega senza file di punteggio legge le stesse quote.
    const heavy = this.heavySeasons().split('|').filter(Boolean);
    const scoring = this.players.scoring();
    // ...e le stagioni per cui serve l'AGGREGATO (media voto e fantamedia), che non costa un
    // caricamento: undici stagioni sono gia' in casa, quindi si legge quello che serve senza chiedere
    // niente a nessuno.
    const light = [...new Set(this.needed().map((one) => one.season).filter((one): one is string => !!one))];
    // SOLO CHI IL LISTONE QUOTA (operatore, 04/09/2026: «Cheddira del Napoli e' ridicolo che stia nei
    // primi 60 attaccanti, non giochera' mai»). Il difetto non era la sua valutazione: e' che non e'
    // quotato affatto - zero righe in `listone_quotes` per il 2026-27, su nessuna delle due piattaforme
    // - ed era in lista perche' il FOGLIO si costruisce sulle rose vere e l'app aggiunge chi il listone
    // non ha (70 righe su 602). Un uomo che non si puo' comprare non sta in una lista di nomi da
    // comprare: e' la sua regola del 03/09 gia' viva sulla plancia, portata qui.
    //
    // ...E NEMMENO CHI IL LISTONE DA' PER CEDUTO (07/09/2026, «perche' nel Napoli c'e' ancora
    // Lukaku?»): l'asterisco accanto al nome e' la piattaforma che dichiara che quell'uomo non gioca
    // piu' qui, ed e' il piu' forte dei tre segnali - i fogli del motore quelle righe non le portano
    // piu' affatto, ma questa lista si costruisce dalle QUOTAZIONI, dove il ceduto ha ancora prezzo e
    // club. Un fatto per PIATTAFORMA: sette uomini sono ceduti in Serie A e comprabili su euro.
    return listone.filter((player) => player.quoted && !player.sold).map((player) => {
      const one = engine.get(player.fcId);
      const steady = rated ? this.ratings.for(platform, player.fcId)?.steady : null;
      const played = this.store.playedOf(platform, player.fcId);
      // IL SUO CALCIO, UNA STAGIONE PER VOCE (operatore, 12/09/2026: «per ogni pill vorrei poter
      // selezionare la stagione di afferenza»). Si riempiono SOLO le stagioni chieste, e le due meta'
      // costano diverso: la media voto viene dall'aggregato (gia' in casa), tutto il resto dal livello
      // per-partita. Le celle di una stagione si leggono UNA VOLTA e nutrono tutt'e due le funzioni -
      // il riepilogo della card (`seasonTotals`) e le frequenze - perche' due passate sulle stesse
      // partite darebbero a un uomo due denominatori.
      const football = new Map<string, SeasonFootball>();
      for (const season of light) {
        const cells = heavy.includes(season) && season !== WHOLE_CAREER
          ? this.players.matchesOf(player.fcId, platform, season)
          : null;
        const totals = cells ? seasonTotals(cells) : null;
        // TUTTO IL SUO CALCIO e' una finestra e non una stagione: si passa da `recent` senza limiti,
        // cioe' dal lettore che questo store dichiara per «tutte le sue partite».
        const whole = season === WHOLE_CAREER && heavy.includes(season)
          ? this.players.recent(player.fcId, platform, {}).map((one) => one.cell)
          : null;
        const aggregate = this.store.seasonStatsOf(platform, player.fcId, season);
        football.set(season, {
          played: aggregate?.pv ?? null,
          mv: aggregate?.mv ?? null,
          fm: aggregate?.fm ?? null,
          goals: totals?.played ? totals.goals / totals.played : null,
          assists: totals?.played ? totals.assists / totals.played : null,
          xg: totals?.xg ?? null,
          xa: totals?.xa ?? null,
          ga: totals ? { goals: totals.goals, assists: totals.assists } : null,
          frequencies: whole
            ? matchFrequencies(whole, scoring)
            : cells ? matchFrequencies(cells, scoring) : null,
        });
      }
      // QUANTE NE GIOCHERA' DAVVERO, col conto unico dell'app (`core/expected-play.ts`, 04/09/2026):
      // il metro della plancia dove il motore ripiega su una costante, meno le giornate che uno stop
      // aperto gli toglie di sicuro, meno l'assicurazione dell'operatore. Il FATTORE che ne esce
      // riprezza il surplus e il valore perche' tutt'e due moltiplicano le presenze - non e' un
      // secondo motore, e' il numero del foglio con meno giornate sotto.
      const outlook = this.play.outlook(
        { id: player.fcId, club: player.club, platform },
        { pv: one?.pv ?? null, pvIsEstimate: one?.pvIsEstimate ?? false,
          playShare: one?.titolaritaPlay ?? null, titolarita: one?.titolarita ?? null },
        matchdays,
      );
      // IL +1 A PORTA INVIOLATA (solo portieri, opzione di lega): P(porta inviolata) del suo club sul
      // calendario che resta, e la media del campionato come metro del sostituto - il differenziale lo
      // fa `swingOf`, una definizione e due lettori (la plancia fa lo stesso conto).
      const paid = this.paidPrices.priceOf(player.fcId, platform, this.settings().game);
      const csCalendar = player.role === 'P' ? (book?.forClub(player.club) ?? null) : null;
      const csShare = csCalendar ? cleanSheetOutlook(csCalendar, player.club) : null;
      const csMean = csCalendar
        ? (csBase.get(csCalendar) ?? csBase.set(csCalendar, cleanSheetBaseline(csCalendar)).get(csCalendar)!)
        : null;
      return {
        fcId: player.fcId,
        name: player.name,
        club: player.club,
        clubId: player.clubId,
        role: player.role,
        mantraCodes: player.mantraCodes,
        surplus: one?.surplus == null ? null : one.surplus * outlook.factor,
        surplusIsEstimate: one?.surplusIsEstimate ?? false,
        value: scaled(valueFromEngine(one), outlook.factor),
        outlook,
        // Il valore è un PRODOTTO: sta in piedi sul ripiego dichiarato se una delle due metà lo è.
        valueIsEstimate: (one?.fmIsEstimate ?? false) || (one?.pvIsEstimate ?? false),
        // Le letture delle pastiglie: dal foglio, meno la costanza (le sue stagioni) e il fantavalore
        // (il listone). Si leggono TUTTE anche se la riga ne mostra tre: quali si vedono è una
        // preferenza che cambia a ogni click, e ricostruire il listone a ogni click sarebbe pagare un
        // giro di 600 righe per accendere una pastiglia.
        fm: one?.fm ?? null,
        mv: one?.mv ?? null,
        pv: outlook.expected,
        minutes: one?.minutesNext ?? null,
        steady: steady?.share ?? null,
        steadyWeight: steady?.weight ?? 0,
        steadyNote: steady?.note ?? '',
        // IL SUO CALCIO PER STAGIONE, gia' letto: la riga lo porta e `readingsOf` lo passa. Vuoto per
        // le stagioni che nessuno ha chiesto, che non e' uno zero - e' una domanda che non si e' fatta.
        seasons: football,
        // Il PREZZO del suo listone, nella valuta del gioco dichiarato: letto da chi lo possiede già.
        fvm: this.store.fvmOf(platform, player.fcId, this.settings().game),
        // IL PREZZO VERO, portato nella valuta della lega DICHIARATA: la tabella lo archivia su una
        // lega da 10 x 1000 e mostrarlo cosi' a chi ne gioca una da 500 sarebbe una cifra che nel suo
        // gioco nessuno puo' pagare. La conversione e' l'inverso esatto della normalizzazione con cui
        // il toolkit l'ha scritto - la quota del montepremi - e non una taratura.
        paid: paid ? scaleTo(paid.median, teamsNow, budgetNow) : null,
        paidSold: paid?.sold ?? null,
        paidSoldOf: paid?.soldOf ?? null,
          // LO SWING: lo stesso surplus della riga, nell'unita' con cui la lega assegna i punti.
        // Una conversione e non una seconda valutazione - vedi `core/swing.ts` per i due termini che
        // un giudice fuori campione ha tolto il 06/09/2026.
        // LA TITOLARITA' IN UNA PAROLA, con la precedenza di sempre: la tua dritta batte il gradino
        // del foglio. Risolta qui perche' e' qui che si sa chi ha dichiarato cosa - `readingsOf` e'
        // pura - e cosi' la pastiglia, la card e il campetto dicono la stessa parola.
        titolarita: this.rulings.rungOf(player.fcId) ?? one?.titolarita ?? null,
        swing: swingOf({
          role: player.role,
          surplus: one?.surplus == null ? null : one.surplus * outlook.factor,
          pv: outlook.expected,
          // Lo zero del foglio e il calendario dichiarato: la ribasatura verso il 6 e il «per
          // giornata» dell'unita' dichiarata dall'operatore (07/09/2026).
          replacement: one?.replacementFm ?? null,
          matchdays,
          steady: steady?.share ?? null,
          // R25 dentro SWING: la fantamedia che ha GIA' tenuto in questa stagione, e su quante
          // partite. Sono i due numeri che le pastiglie `FM` e le sue giornate mostrano gia', letti
          // da chi li possiede - non una seconda misura della stessa cosa.
          fm: one?.fm ?? null,
          seasonFm: played?.fm ?? null,
          seasonPlayed: played?.pv ?? null,
          confidence: one?.confidence ?? null,
          // Su `default` una riga che il motore prezza porta gia' la miscela (R25K40 adottata il
          // 07/09/2026); su `euro` R25 non e' adottata e la correzione resta il solo canale.
          fmBlendsSeen: platform === 'default' && one != null && !one.fmIsEstimate,
          // ...e la costanza si paga solo dove la lega paga l'R-Factor (opzione dichiarata).
          rFactor: this.settings().rFactor,
          // ...e il +1 a porta inviolata solo dove la lega lo paga (opzione dichiarata, 07/09/2026).
          cleanSheetBonus: this.settings().cleanSheet,
          cleanSheetShare: csShare,
          cleanSheetMean: csMean,
        }),
      };
    });
  });

  /**
   * Le fasce del gain, tagliate UNA VOLTA sul listone intero e non sul blocco.
   *
   * Sono percentili del pool, e quale pool è metà della misura: tagliate per blocco, ogni ruolo avrebbe
   * il suo miglior uomo `ottimo` e il colore direbbe soltanto «è il primo della sua lista». Così invece
   * un verde vale la stessa cosa in tutt'e dodici le colonne.
   */
  protected readonly scale = computed<GainScale>(() =>
    scaleOf(this.pool().map((man) => this.perMatch(gainOf(man, this.setup().auction)))),
  );

  /**
   * PERCHE' LA PASTIGLIA DEL PREZZO VERO E' VUOTA, quando lo e' per tutti.
   *
   * Duecentocinquanta trattini in colonna si leggono come un guasto, e la differenza fra «di questo
   * gioco non abbiamo aste vere» e «la tabella non e' arrivata» e' esattamente quella che un catch
   * muto cancella. Vuoto quando non c'e' niente da dire: la pastiglia spenta non merita un avviso, e
   * nemmeno un libro che i prezzi ce li ha.
   */
  protected readonly paidNotice = computed<string | null>(() => {
    if (!this.readings().includes('paid')) return null;
    const { platform, game } = this.settings();
    const read = this.paidPrices.diagnosis();
    if (read == null) return null;
    if (this.paidPrices.monthOf(platform, game)) return null;
    const other = [...this.paidPrices.month().keys()];
    return read.why
      ? `Il pacchetto non porta prezzi d'asta: ${read.why}.`
      : `Nessuna asta vera su questa combinazione. Il pacchetto ne porta per: ${other.join(', ') || 'nessuna'}.`;
  });

  protected readonly blocks = computed<RoleBlock[]>(() =>
    blocksOf({
      pool: this.pool(),
      setup: this.setup(),
      rules: this.rulebook(),
      priority: this.priorityHere(),
      sort: this.sort(),
      keep: this.keep(),
    }),
  );

  /**
   * IL FILTRO COME PREDICATO, nell'UNITA' IN CUI LA RIGA STAMPA I NUMERI.
   *
   * Il gain in memoria e' un totale di stagione e sulla riga si legge PER GIORNATA (`perMatch`): un
   * filtro che confrontasse il numero grezzo risponderebbe su un'unita' diversa da quella che
   * l'operatore ha davanti, che e' la famiglia di difetti piu' cara di questo progetto. Le letture
   * passano da `readingValue`, cioe' dalla stessa funzione che disegna la pastiglia.
   *
   * Null quando non c'e' nessuna condizione, cosi' `blocksOf` non filtra affatto invece di filtrare con
   * un predicato che dice sempre di si'.
   */
  private readonly keep = computed<((row: RankedMan) => boolean) | undefined>(() => {
    const clauses = this.clauses();
    if (!clauses.length) return undefined;
    // `perMatch` legge `matchdays()` dove serve, cioe' dentro il predicato: e' `blocks` a eseguirlo,
    // quindi e' `blocks` a dipendere dal calendario - che e' esattamente il computed che si deve rifare
    // se il calendario cambia.
    return (row: RankedMan) =>
      passesFilter(clauses, (clause) =>
        // LA STESSA DIVISIONE CHE DISEGNA LA RIGA, e non una sua copia: `perMatch` e' la definizione, e
        // due copie darebbero al filtro e alla colonna due unita' il giorno in cui una cambia.
        clause.key === 'gain'
          ? this.perMatch(row.gain)
          // ...e la STAGIONE della condizione, che e' meta' della domanda: senza, «mv > 7 e mv < 6»
          // non avrebbe soluzioni. Una condizione senza stagione cade sul default della sua lettura.
          : readingValue(
            { key: clause.key, season: clause.season ?? this.seasonOfKey(clause.key) },
            row.readings,
          ),
      );
  });

  /** Le voci del menu' «valore», col nome che il gain ha in questa asta e le stagioni del pacchetto. */
  protected readonly filterFieldsHere = computed(() =>
    filterFields(this.gainLabel(), { pickable: this.pickableSeasons(), ...this.seasonNames() }),
  );

  /** La stagione su cui una lettura si legge quando la condizione non ne porta una: la sua dichiarata. */
  private seasonOfKey(key: ReadingKey): string | null {
    const spec = READINGS.find((one) => one.key === key);
    return spec?.seasonal ? defaultSeasonOf(spec, this.seasonNames()) : null;
  }

  /**
   * QUANTI NOMI IL FILTRO STA NASCONDENDO, sommati su tutti i blocchi.
   *
   * Contato e detto in barra: un blocco corto senza una ragione a schermo si legge come un blocco rotto,
   * ed e' la ragione per cui questa pagina puo' permettersi di RICORDARE un filtro.
   */
  protected readonly hiddenByFilter = computed(() =>
    this.blocks().reduce((sum, one) => sum + one.dropped, 0),
  );

  /**
   * SU COSA SONO ORDINATE LE LISTE (operatore, 06/09/2026), e resta scelto fra una sessione e l'altra.
   *
   * `stored` con l'elenco delle chiavi ammesse, che e' anche la guardia: una preferenza salvata mesi fa
   * con una chiave che non esiste piu' torna al default invece di ordinare per una colonna che nessuno
   * disegna. Non e' per (listone, gioco) come l'ordine manuale: quello e' una PREFERENZA su dei nomi,
   * questo e' su come si legge la pagina, e la pagina e' una sola.
   */
  protected readonly sort = stored<SortKey>('strategy.sort', DEFAULT_SORT, [
    'gain',
    // SENZA LE COPPIE: `G:A` stampa due cifre e non ha un numero dietro, quindi ordinarci sopra
    // lascerebbe a schermo una colonna che non scende - vedi `SORTABLE_READINGS`.
    ...SORTABLE_READINGS,
  ]);

  /** L'etichetta della chiave in vigore: il gain non e' una lettura e la sua se la scrive da se'. */
  protected readonly sortLabel = computed(() => {
    const key = this.sort();
    if (key === 'gain') return this.gainLabel();
    return READINGS.find((one) => one.key === key)?.label ?? key;
  });

  /**
   * LE VOCI DEL SELETTORE: il gain piu' le letture ORDINABILI, nell'ordine in cui `READINGS` le
   * dichiara.
   *
   * Costruite da `READINGS` e non riscritte a mano, cosi' una lettura nuova compare qui da se': due
   * elenchi della stessa cosa sono come una pastiglia finisce per esistere e non essere ordinabile.
   * Le COPPIE sono l'eccezione dichiarata, e non un dimenticato - vedi `SORTABLE_READINGS`.
   */
  protected readonly sortOptions = computed<NzSelectOptionInterface[]>(() => {
    const seasons = this.seasonNames();
    const shown = this.shownReadings();
    const out: NzSelectOptionInterface[] = [{ label: this.gainLabel(), value: GAIN_SORT }];
    for (const spec of READINGS) {
      // SENZA LE COPPIE, per la ragione scritta in `SORTABLE_READINGS`: una voce che non ordina niente
      // e' peggio di una voce che manca, perche' sceglierla non fa succedere nulla.
      if (spec.pair) continue;
      // UNA VOCE PER STAGIONE ACCESA, e una sola al default per le letture spente: offrire tutte le
      // combinazioni darebbe un menu' di cinquanta voci di cui quarantasette ordinano su una colonna
      // che non si vede. Chi vuole ordinare per la MV di un'altra stagione l'accende, e la voce compare.
      const mine = shown.filter((one) => one.ref.key === spec.key);
      const refs = mine.length
        ? mine.map((one) => one.ref)
        : [{ key: spec.key, season: spec.seasonal ? defaultSeasonOf(spec, seasons) : null }];
      for (const ref of refs) {
        // IL NOME PER ESTESO, con l'anno solo dove la stagione esiste: «SWING · SWING» e «FVM ·
        // Fantavalore di mercato» erano la sigla incollata al nome, cioe' due volte la stessa cosa.
        const said = ref.season ? `${spec.label} ${ref.season === WHOLE_CAREER ? WHOLE_CAREER : shortSeason(ref.season)}` : spec.label;
        out.push({ label: said, value: refText(ref) });
      }
    }
    return out;
  });

  protected setSort(key: SortKey): void {
    this.sort.set(key);
  }

  /** Quanti nomi la pagina sta mostrando in tutto, e quanti il foglio non prezza affatto. */
  protected readonly counted = computed(() => {
    const blocks = this.blocks();
    return {
      shown: blocks.reduce((sum, one) => sum + one.men.length, 0),
      demand: blocks.reduce((sum, one) => sum + one.demand, 0),
      unranked: blocks.reduce((sum, one) => sum + one.unranked, 0),
    };
  });

  /**
   * QUANTE COLONNE, e non è una scelta estetica: quattro blocchi classic stanno in una riga sola, dodici
   * blocchi mantra no, quindi sei per riga li mette in due righe piene invece di lasciarne una spaiata.
   */
  protected readonly columns = computed(() => (this.settings().game === 'mantra' ? 6 : 4));

  protected readonly warning = computed<string | null>(() => {
    if (this.settings().game === 'mantra' && this.rulebookMissing()) {
      return 'Questo bundle non porta mantra_modules.json, che è il file dove stanno i ruoli del listone mantra e le forme legali: senza di lui non so né come si chiamano i blocchi né quanti uomini di ogni ruolo comprerà la stanza, quindi non ne disegno nessuno. Rifai un export del toolkit, oppure gioca a classic.';
    }
    return null;
  });

  // ---------------------------------------------------------------- le impostazioni

  /** La finestra è UNA e sta fuori dalle viste: questa pagina la apre e non ne tiene una sua. */
  protected openSettings(): void {
    this.options.open();
  }

  /** Le due domande che la barra deve poter rispondere senza aprire niente. */
  protected readonly summary = computed(() => {
    const { platform, game, slots, budget, auction, teams } = this.settings();
    const roster =
      game === 'classic'
        ? `${slots.classic.P}/${slots.classic.D}/${slots.classic.C}/${slots.classic.A}`
        : `${slots.mantra.por} + ${slots.mantra.mov}`;
    return {
      listone: platform === 'euro' ? 'EuroLeghe' : 'Serie A',
      game: game === 'mantra' ? 'Mantra' : 'Classic',
      roster,
      budget,
      auction: auction === 'draft' ? 'Draft' : 'Rilanci',
      teams: Math.round(teams),
    };
  });

  protected readonly game = computed<StrategyGame>(() => this.settings().game);

  // ---------------------------------------------------------------- le bande dello slot

  /**
   * QUANTI NOMI FA UNA BANDA: i partecipanti, e non un numero scelto per come sta a schermo.
   *
   * Una banda di `teams` nomi È uno SLOT - il rango dentro il ruolo diviso il numero di rose - che in
   * questo progetto è una legge di conservazione e non una convenzione grafica: in una lega da dieci ci
   * sono dieci «primi difensori» perché ognuno ne schiera uno, ed è la popolazione su cui il banco
   * d'asta ha misurato ogni tetto d'offerta (`simulatore-asta-rilanci-v1.md` §19.3). A classic la
   * domanda del blocco è `slot × partecipanti`, quindi le bande cadono esatte; a mantra la domanda
   * viene dalle forme e l'ultima banda può essere corta - che è un fatto sulla lista, non un difetto.
   */
  protected readonly bandSize = computed(() => Math.max(1, Math.round(this.settings().teams)));

  /** In quale banda cade la riga `at` (0-based): il numero che il DOM dichiara, così è verificabile. */
  protected bandOf(at: number): number {
    return Math.floor(at / this.bandSize());
  }

  /**
   * Il fondo di una riga: le bande si alternano, la prima tinta.
   *
   * La tinta è quella della zebra che sostituisce (`bg-control/25`, misurata a schermo su questo tema),
   * e la zebra se ne va invece di restare: due alternanze sulla stessa proprietà darebbero quattro
   * tinte, e il confine della banda - la sola cosa che questo colore deve dire - si perderebbe fra le
   * altre tre. Il segnaposto del trascinamento vince comunque, perché la sua regola porta due classi.
   */
  protected bandTone(at: number): string {
    return this.bandOf(at) % 2 === 0 ? 'bg-control/25' : '';
  }

  /**
   * Le classi che CDK mette sull'ANTEPRIMA - l'opacità 0,3 chiesta dall'operatore (27/08/2026).
   *
   * UN ARRAY, e la ragione è misurata: una stringa sola con gli spazi finisce in `classList.add()`, che su
   * un nome con spazi solleva `InvalidCharacterError` - e il gesto muore in SILENZIO, con la pagina intera
   * che si disegna bene, zero anteprime e nessun errore in console. Un array è una classe per voce, che è
   * quello che quel metodo accetta. Un campo e non un letterale nel template, perché un array scritto in
   * un binding è un oggetto nuovo a ogni giro di change detection.
   *
   * E NIENTE FONDO, che è un fatto misurato e non una scelta: sull'anteprima **nessuna classe di
   * background si applica** - né `bg-surface`, né la stessa cosa come variante sulla riga
   * (`[&.cdk-drag-preview]:bg-surface`), né un colore LETTERALE (`bg-[#141d19]`) - mentre `opacity-30`
   * dalla stessa lista si applica. La regola è nel foglio costruito, la classe è sull'elemento, il token
   * risolve, e il fondo resta `rgba(0, 0, 0, 0)`: non è spiegato, quindi non c'è CSS che finga di
   * dipingerlo. Quello che si vede è l'opacità, che è quello che era stato chiesto; il fondo era
   * un'aggiunta per la leggibilità e resta un item aperto (`pagina-strategia-v1.md` §12).
   */
  protected readonly previewClass = ['rounded-md', 'opacity-30'];

  // ---------------------------------------------------------------- il riordino

  /**
   * IL RILASCIO DI CDK, che è l'unica cosa che questa pagina deve sapere del gesto.
   *
   * Il trascinamento è di `@angular/cdk/drag-drop` per scelta dell'operatore (27/08/2026), e con lui
   * arrivano l'anteprima, il segnaposto, lo scorrimento della lista al bordo e il drag nativo del browser
   * già spento: le quattro cose che il gesto scritto in casa rifaceva a mano. Il pacchetto era già
   * installato - `ng-zorro-antd` dipende da `@angular/cdk` - quindi non è una dipendenza nuova, solo una
   * riga di `package.json` che ora la DICHIARA invece di ereditarla di nascosto.
   *
   * Quello che NON cambia è il modello: `withRowAt` riceve l'indice finale che CDK dichiara e restituisce
   * il PREFISSO (i nomi sistemati in cima, sotto continua il gain). Il DOM lo muove e lo rimette a posto
   * CDK; l'ordine vero resta il nostro signal, e la lista si ridisegna da quello.
   *
   * IL PRECEDENTE, perché ce n'è uno e va letto: CDK era stato mandato via dalla TABELLA il 18/08/2026 con
   * due accuse, e una delle due è stata poi ribaltata - i «buchi / disallineamenti» erano un `nz-tooltip`
   * che si mangiava una colonna della griglia (`letture-app-v1.md` §17), non CDK. Quello che restava di
   * misurato era il fotogramma al rilascio su una riga di `<th>` a larghezze fisse; qui le righe sono
   * `<li>` di una lista che scorre, cioè il caso per cui `cdkDropList` esiste. L'arnese e2e misura
   * esattamente quel fotogramma: zero anteprime, zero segnaposti, zero `transform` residui.
   */
  /**
   * Il riordino a mano è SOSPESO mentre un blocco è filtrato, e non è una limitazione da nascondere.
   *
   * `withRowAt` costruisce il prefisso dai nomi COME SONO A SCHERMO: su una lista filtrata quei nomi
   * sono tre di ottanta, quindi il rilascio scriverebbe un ordine che parla di una lista che non
   * esiste. Meglio un gesto spento con il cursore che lo dice, che un ordine sbagliato salvato.
   */
  protected canDrag(role: string): boolean {
    return !this.queryOf(role).trim();
  }

  protected dropped(role: string, event: CdkDragDrop<RankedMan[]>): void {
    const shown = event.container.data.map((row) => row.man.fcId);
    const id = event.item.data as number;
    const moved = withRowAt(this.priorityHere().get(role) ?? [], shown, id, event.currentIndex);
    if (!moved) return;
    const { platform, game } = this.settings();
    this.priority.update((one) => ({ ...one, [`${platform}|${game}|${role}`]: moved }));
    this.savePriority();
  }

  /** Torna al gain per quel blocco. Revocabile a ogni sguardo, come ogni cosa dichiarata di questa app. */
  protected clearOrder(role: string): void {
    const { platform, game } = this.settings();
    this.priority.update((one) => {
      const out = { ...one };
      delete out[`${platform}|${game}|${role}`];
      return out;
    });
    this.savePriority();
  }

  /** ...e per tutti i blocchi di questa combinazione: dodici crocette sono dodici gesti. */
  protected clearAllOrders(): void {
    const { platform, game } = this.settings();
    this.priority.update((one) => {
      const out: Record<string, number[]> = {};
      for (const [key, ids] of Object.entries(one)) {
        if (!key.startsWith(`${platform}|${game}|`)) out[key] = ids;
      }
      return out;
    });
    this.savePriority();
  }

  private savePriority(): void {
    try {
      localStorage.setItem(`fantassistant.${PRIORITY_KEY}`, JSON.stringify(this.priority()));
    } catch {
      // Un browser che rifiuta la memoria disegna la pagina: dimentica l'ordine al ricaricamento.
    }
  }
}

/**
 * UN UOMO DELLA STRATEGIA COME LA CARD LO VUOLE.
 *
 * Traduce e non ricalcola, esattamente come il gemello della plancia: `pv` e' gia' quello ridotto dal
 * conto delle giornate, `fm` e' gia' quella che la riga usa, e la finestra dello stop viene da
 * `outlook` e non da una seconda lettura.
 *
 * IL «DOVE» E' IL VOCABOLARIO DEL GIOCO e non il blocco in cui e' stato cliccato: su mantra un uomo sta
 * in tutti i blocchi che i suoi codici nominano, quindi «Dc/Ds» e' un fatto su di lui mentre «il blocco
 * Ds» sarebbe un fatto sul click. La plancia scrive `A1` per la stessa ragione opposta: la' un uomo sta
 * in uno slot solo.
 */
function cardManOf(
  man: StrategyBidder,
  engine: EngineExpectation | null,
  rounds: number | null,
  platform: 'default' | 'euro',
  game: StrategyGame,
): CardMan {
  return {
    id: man.fcId,
    name: man.name,
    club: man.club,
    clubId: man.clubId,
    where: game === 'mantra' && man.mantraCodes.length ? man.mantraCodes.join('/') : man.role,
    role: man.role,
    platform,
    // Le stesse letture della riga, dalla stessa funzione: cosi' la card non puo' dire un numero e la
    // riga un altro sullo stesso uomo.
    edge: readingsOf(man).edge,
    pv: man.pv,
    rounds,
    // ...e lo SWING, che questa lista ha gia' in mano: una delle sue dodici letture. `?? null` perche'
    // sul bidder e' opzionale - un uomo che il foglio non prezza non ne ha uno, e la card lo legge
    // come ignoto invece che come zero.
    swing: man.swing ?? null,
    fm: man.fm,
    estimated: engine?.fmIsEstimate ?? false,
    estNote: engine?.note ?? null,
    titolarita: engine?.titolarita ?? null,
    titolaritaPlay: engine?.titolaritaPlay ?? null,
    minutesNext: engine?.minutesNext ?? null,
    seasonMatches: engine?.seasonMatches ?? null,
    minutesFullSeason: engine?.minutesFullSeason ?? null,
    unpricedReason: null,
    fvm: man.fvm,
    out: man.outlook.window,
    // NESSUN TAVOLO: questa pagina e' quello che si prepara PRIMA di sedersi, quindi non c'e' una max
    // offerta ne' un padrone, e inventarli mostrerebbe i numeri di un'asta che non esiste.
    market: null,
  };
}
