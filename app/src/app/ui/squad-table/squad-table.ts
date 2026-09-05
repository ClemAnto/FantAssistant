import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzDropdownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule, NzTableSortOrder } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import {
  ANCHOR_DETAIL,
  ANCHOR_HINT,
  RATING_DETAIL,
  RATING_HINT,
  RATING_KEYS,
  RATING_LABEL,
  STAR_SCALE_DETAIL,
  STAR_SCALE_HINT,
  RatingKey,
} from '../../core/player-ratings';
import { starsOf, toneOf } from '../../core/player-ratings';
import {
  MarketTrend,
  MarketValues,
  TREND_BAND,
  TREND_MONTHS,
  daysSince,
  euros,
} from '../../core/market-trend';
import { ClassicRole, Platform } from '../../core/players-store';
import { TimeTravel } from '../../core/time-travel';
import { SquadMan, ToneKey, ValuationStore } from '../../core/valuation-store';
import { itDate, short } from '../../core/tooltip';
import { lazyRows } from '../../core/lazy-rows';
import { stored, storedJson, storedList } from '../../core/view-state';
import { gapAt, withColumnMoved } from './column-drag';
import {
  Blanks,
  ColumnFilter,
  FilterKind,
  NO_VALUE,
  describeFilter,
  fold,
  isActive,
  passesPick,
  passesRange,
  passesText,
  readFilters,
} from './column-filter';
import { ClubCrest } from '../club-crest/club-crest';
import { PlayerFlags } from '../player-flags/player-flags';
import { RoleBadge } from '../role-badge/role-badge';
import { RoleSet } from '../role-set/role-set';
import { StarRating } from '../star-rating/star-rating';
import { CATEGORIA_SHORT, categoriaNote, categoriaRank, isCategoria } from '../../core/categoria';
import { TITOLARITA_SHORT, isTitolarita, titolaritaNote, titolaritaRank } from '../../core/titolarita';

const ROLE_LABEL: Record<ClassicRole, string> = {
  P: 'Portiere',
  D: 'Difensore',
  C: 'Centrocampista',
  A: 'Attaccante',
};

/** The listone's own reading order, and the table's default one. */
const ROLE_ORDER: Record<string, number> = { P: 0, D: 1, C: 2, A: 3 };

/** Come si chiama il pool in una frase: «78/99 fra i 152 difensori del listone». */
const ROLE_POOL_WORD: Record<string, string> = {
  P: 'portieri',
  D: 'difensori',
  C: 'centrocampisti',
  A: 'attaccanti',
};

/**
 * TUTTO QUELLO CHE UNA COLONNA È, in un posto solo - e il posto è questo e non il template.
 *
 * Fino al 20/08/2026 l'intestazione era uno `@switch` di diciannove `<th>` quasi identici, che è come si
 * fa a mettere `class="text-right"` su diciotto e a dimenticarlo sul diciannovesimo. Con la larghezza,
 * l'allineamento e il tipo di filtro qui accanto alla chiave, il template disegna UNA cella e la ripete:
 * una colonna nuova è una riga di questo elenco, non venti righe di HTML da copiare.
 */
export interface SquadColumn {
  key: string;
  /** Come si chiama nel selettore delle colonne, dove c'è spazio per una parola intera. */
  label: string;
  /** ...e come in TESTA alla colonna, dove ce n'è per le cifre che porta. Assente = la stessa. */
  head?: string;
  width: number;
  /** A destra i numeri, al centro le sigle, a sinistra le parole. Assente = a sinistra. */
  align?: 'center' | 'right';
  /** Che domanda si fa a questa colonna (`column-filter.ts`). Assente = non si filtra. */
  filter?: FilterKind;
}

export const SQUAD_COLUMNS: readonly SquadColumn[] = [
  { key: 'mantra', label: 'Mantra', width: 78, filter: 'pick' },
  { key: 'club', label: 'Squadra', width: 130, filter: 'pick' },
  { key: 'codes', label: 'Ruolo reale', width: 100, filter: 'pick' },
  // LA TITOLARITÀ IN UNA PAROLA, tre caratteri (operatore, 20/08/2026), accanto alla P perché è la
  // stessa domanda detta a parole: quanto gioca. La sigla è un promemoria e il tooltip porta la parola
  // intera coi due numeri che l'hanno decisa, perché un gradino si ribalta su un minuto.
  { key: 'titolarita', label: 'Tit.', width: 46, align: 'center', filter: 'pick' },
  // LE SEI PAROLE DENTRO IL RUOLO, accanto alla titolarità perché sono le due metà di una domanda
  // sola: quella dice quanto GIOCA, questa quanto PORTA. Tre caratteri come l'altra, e il tooltip
  // porta la frase intera coi due numeri - il tasso misurato e le sbarre del suo ruolo - perché una
  // parola sola non si può controllare.
  { key: 'categoria', label: 'Cat.', width: 46, align: 'center', filter: 'pick' },
  { key: 'expected', label: 'P (partite attese)', head: 'P', width: 48, align: 'right', filter: 'range' },
  // Le quattro colonne di fantamedia sono più larghe delle cifre che portano: dentro ognuna il numero sta
  // in un riquadro colorato, e un riquadro più largo della colonna manderebbe la tabella a scorrere.
  { key: 'expectedFm', label: 'FMa', width: 70, align: 'right', filter: 'range' },
  { key: 'expectedMv', label: 'MVa', width: 70, align: 'right', filter: 'range' },
  // LA COSTANZA, quota di partite chiuse con almeno il 6 di voto BASE (operatore, 01/09/2026), qui
  // perché è la seconda metà della colonna accanto: la MVa dice il livello, questa quanto spesso quel
  // livello supera la soglia che il REGOLAMENTO paga. In questa lega i due modificatori classici si
  // sommano e pagano tutt'e due sul voto base, quindi è una moneta e non una curiosità: fra un undici
  // di popolazione e uno di uomini al p90 del loro ruolo ballano 27 punti di R-Factor a stagione più
  // 10 di modificatore di difesa (misurato il 01/09/2026, cinque stagioni di Serie A).
  // È una QUOTA e non un rank, ed è la differenza con la lettura 0-99 che l'operatore aveva fatto
  // togliere il 17/08: le soglie dei modificatori sono assolute, e un rank dice quanti uomini stanno
  // sotto di lui invece di dire se supera il 6.
  { key: 'steady', label: 'Costanza', head: 'Cost.', width: 58, align: 'right', filter: 'range' },
  { key: 'surplus', label: 'Surplus', width: 64, align: 'right', filter: 'range' },
  // ...e lo stesso conto dall'ALTRO ZERO, affiancato invece che al posto suo: sono due domande («chi
  // conviene comprare» contro «quanto costa una giornata saltata») e nessuna delle due vince, quindi si
  // vedono insieme e si sceglie soltanto per quale ordinare (operatore, 16/08/2026, §21.1 della metrica).
  // «MARGINE» DI NUOVO (operatore, 18/08/2026): per un giorno si è chiamata «Lead», e quel nome è passato
  // alla colonna dell'asta, che conta dal marginale di ROSA - lo stesso zero di «Surplus» qui accanto.
  // Due colonne con un nome solo sarebbero due domande indistinguibili, che è il difetto che questo
  // progetto paga da sempre: questa resta il conto dall'altro zero, il rimpiazzo che ENTRA davvero.
  { key: 'surplusFielded', label: 'Margine', width: 68, align: 'right', filter: 'range' },
  // LE DUE COLONNE «−C» (Surplus e Margine al netto della coppa) SONO STATE TOLTE, decisione
  // dell'operatore del 17/08/2026 sera, il giorno stesso in cui erano nate. Il FATTO resta dove è
  // misurato - il foglio porta `desc_surplus_cup` / `desc_surplus_fielded_cup`, il globo segna chi parte
  // e il tooltip delle presenze attese dice quante giornate costa - quindi non si è perso niente: due
  // colonne in più su una tabella che ne ha quindici sono un costo di lettura, e la stessa notizia era
  // già leggibile accanto al nome. Non rimetterle senza che lo chieda lui.
  // FANTAPUNTI e non «Valore» (operatore, 16/08/2026): la colonna vive accanto all'FVM, che è il
  // fantaVALORE di mercato, e i due si chiamavano uguale pur essendo uno in fantapunti e l'altro in
  // crediti. Il nome nuovo dice l'UNITÀ, che è la sola cosa che non si può confondere con un prezzo.
  // La chiave resta `value`: gli identificatori del codice stanno in inglese e non seguono l'etichetta.
  { key: 'value', label: 'Fantapunti', width: 92, align: 'right', filter: 'range' },
  { key: 'fvm', label: 'FVM', width: 58, align: 'right', filter: 'range' },
  // ...e accanto all'FVM il prezzo che il MERCATO VERO gli dà, con la sua tendenza (`market-trend.ts`).
  // Si chiama «Mercato» e non «Valore» perché in questa tabella `value` sono i Fantapunti e `mv` è la
  // media voto: due colonne che già portano quelle due lettere, e un terzo «V» le renderebbe indistinguibili.
  { key: 'market', label: 'Mercato', width: 92, align: 'right', filter: 'range' },
  // LE PARTITE A VOTO DELLA STAGIONE MISURATA (operatore, 18/08/2026), davanti alle due medie di cui
  // sono il DENOMINATORE: una FM di 7,00 su tre presenze e una su trentotto sono due fatti diversi, e
  // finora quel numero stava solo nel tooltip. Zero non e' vuoto: quotato e mai a voto (`pv` = 0) e' un
  // fatto, e chi non ha giocato affatto in questo listone porta un trattino.
  { key: 'pv', label: 'Pv', width: 48, align: 'right', filter: 'range' },
  { key: 'mv', label: 'MV', width: 64, align: 'right', filter: 'range' },
  { key: 'fm', label: 'FM', width: 64, align: 'right', filter: 'range' },
  ...RATING_KEYS.map((key) => ({ key, label: RATING_LABEL[key], width: 84, filter: 'range' as const })),
];

/**
 * LE DUE COLONNE FISSE: il ruolo e il nome.
 *
 * Non stanno in `SQUAD_COLUMNS` perché non si spengono e non si trascinano - sono l'identità della riga,
 * e una tabella senza il nome non è una tabella più corta, è un'altra cosa. Ma si ORDINANO come tutte, e
 * dal 20/08/2026 si FILTRANO come tutte: «cerca un nome» e «solo i portieri» sono le due domande che si
 * fanno più spesso, e la vista SQUADRE non ha un pannello di filtri dove chiederle.
 */
export const FIXED_COLUMNS: readonly SquadColumn[] = [
  { key: 'role', label: 'Ruolo', head: 'R', width: 44, filter: 'pick' },
  { key: 'name', label: 'Nome', width: 116, filter: 'text' },
];

/** Ogni colonna per chiave, fisse comprese: il template ne chiede una alla volta. */
const COLUMN_BY_KEY = new Map<string, SquadColumn>(
  [...FIXED_COLUMNS, ...SQUAD_COLUMNS].map((one) => [one.key, one]),
);

/**
 * Le colonne per cui si può ORDINARE, che non sono tutte: `mantra` e `codes` portano una lista di
 * badge e «in ordine di ruolo reale» non è una domanda che qualcuno faccia.
 *
 * Serve come vocabolario di quello che si può trovare salvato su disco: una chiave che non è qui torna al
 * default, così una preferenza di una versione precedente non lascia la tabella senza ordinamento.
 * `role` e `name` sono le due colonne fisse, che si ordinano come tutte le altre.
 */
export const SORTABLE_COLUMNS: readonly string[] = [
  'role', 'name', 'club', 'titolarita', 'categoria', 'expected', 'expectedFm', 'expectedMv',
  'steady',
  'surplus',
  'surplusFielded',
  'value', 'fvm', 'market', 'pv', 'mv', 'fm', ...RATING_KEYS,
];

/**
 * L'ORDINE DELLE COLONNE: quelle salvate nell'ordine salvato, e le nuove al loro posto di listino.
 *
 * Pura e esportata perché due cose vanno protette da un test e non da un'occhiata (l'operatore le ha
 * segnalate entrambe): le colonne si SPENGONO, quindi una chiave salvata può non essere fra quelle offerte
 * in questa vista - la squadra non c'è nella rosa di un club - e va ignorata senza spostare le altre; e una
 * colonna NUOVA non deve nascere invisibile per chi ha già un ordine salvato, quindi entra accanto alla
 * vicina con cui è nata in `SQUAD_COLUMNS` e non in coda, dove nessuno la cercherebbe.
 */
export function orderColumns(saved: readonly string[], offered: readonly string[]): string[] {
  const known = new Set(offered);
  const out = saved.filter((key) => known.has(key));
  for (const key of offered) {
    if (out.includes(key)) continue;
    // Il vicino di SINISTRA che è già in lista: la colonna nuova gli si mette accanto.
    const at = offered.indexOf(key);
    const after = offered.slice(0, at).filter((other) => out.includes(other)).pop();
    out.splice(after ? out.indexOf(after) + 1 : 0, 0, key);
  }
  return out;
}

/** Quello che una riga occupa comunque, sommato dalle colonne stesse invece di ricopiato a mano. */
const FIXED_WIDTH = FIXED_COLUMNS.reduce((sum, one) => sum + one.width, 0);

/** Quanti pixel prima che un click diventi un trascinamento: sotto, è un click che ordina. */
const DRAG_THRESHOLD_PX = 5;

/** A quanti pixel dal bordo della finestra la pagina comincia a scorrere da sé, e di quanto per volta. */
const DRAG_EDGE_PX = 60;
const DRAG_SCROLL_STEP_PX = 24;

/** Il verso naturale di una colonna di testo: la A per prima. Una costante, non un letterale nel
 *  template - `nzSortDirections` è un input, e un array nuovo a ogni lettura è un `ngOnChanges` a ogni
 *  ciclo (la stessa trappola già scritta sopra `ratingSorters`). */
const TEXT_FIRST: NzTableSortOrder[] = ['ascend', 'descend', null];

/** Le colonne di PAROLE: il ruolo (nell'ordine del listone), il nome e la squadra. */
const TEXT_SORTED: readonly string[] = ['role', 'name', 'club'];

/** Le due che stanno sempre in testa, come chiavi: il template le ripete davanti alle mobili. */
const FIXED_KEYS: readonly string[] = FIXED_COLUMNS.map((one) => one.key);

/** Le colonne di FANTAMEDIA, dove un estremo si muove di un decimo: fra 6,0 e 7,0 c'è un'asta intera. */
const DECIMAL_COLUMNS: readonly string[] = ['expectedFm', 'expectedMv', 'mv', 'fm'];

/**
 * What a quoted man is worth, as a table: measured season, engine forecast, four readings.
 *
 * ONE component because it is ONE table: the squads view draws it for a club's rosa, the consultation
 * view for the whole listone, and the columns, the tooltips and the sort rules must be the same object
 * in both - two copies would be two definitions of «FMa» under one heading, which is exactly the
 * defect this project keeps paying for. The rows come from `ValuationStore` through the caller, so the
 * figures always describe the list on screen.
 *
 * The only difference between the two callers is the CLUB column, which a single club's squad has no use
 * for, and the pagination: a rosa is drawn whole, a listone of a thousand men is not.
 */
@Component({
  selector: 'ui-squad-table',
  templateUrl: './squad-table.html',
  imports: [
    ClubCrest,
    DecimalPipe,
    FormsModule,
    NzButtonModule,
    NzCheckboxModule,
    NzCollapseModule,
    NzDropdownModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzRadioModule,
    NzSelectModule,
    NzTableModule,
    NzTagModule,
    NzTooltipModule,
    NgTemplateOutlet,
    PlayerFlags,
    RoleBadge,
    RoleSet,
    StarRating,
  ],
  host: { class: 'block' },
})
export class SquadTable {
  private readonly valuation = inject(ValuationStore);
  private readonly market = inject(MarketValues);
  /** L'ultima variazione va detta in giorni, e i giorni si contano dalla data in cui l'app si trova. */
  private readonly travel = inject(TimeTravel);

  readonly rows = input.required<SquadMan[]>();
  /** Which listone these numbers are about: MV and FM are a fact about a CALENDAR, so it is said. */
  readonly platform = input.required<Platform>();
  /** A list of one club does not need a club column; the listone's own does. */
  readonly showClub = input(false);
  readonly crests = input<Record<string, string>>({});
  /**
   * LE RIGHE SI CARICANO SCORRENDO e la paginazione non c'è più (operatore, 17/08/2026).
   *
   * `lazyRows` mostra le prime 60 e ne aggiunge 60 quando lo scorrimento arriva vicino al fondo, e la riga
   * sotto la tabella dice sempre quante se ne vedono su quante: un conteggio che non corrisponde a quello
   * che è a schermo è il difetto che la paginazione nascosta di nz-table aveva già prodotto qui.
   */
  /**
   * L'ORDINAMENTO È DI QUESTO COMPONENTE, non di nz-table, e la ragione è misurata (18/08/2026).
   *
   * `nzSortFn` ordina `nzData`, e `nzData` sono le righe GIÀ CARICATE: con 60 righe di 592 a schermo,
   * ordinare per Overall metteva in cima il 95 mentre il massimo del listone è 99 - e scorrendo comparivano
   * uomini che dovevano stare sopra. Misurato in e2e (`scripts/e2e-table.mjs`), che è l'unico posto da cui
   * si vede: in jsdom le righe non arrivano scorrendo. Non era «una tabella ordinata», era una tabella
   * ordinata su un campione, cioè la stessa famiglia del difetto «una lista mostrata i cui numeri
   * descrivono un'altra lista».
   *
   * Quindi si ordina PRIMA di ritagliare: `sorted` ordina tutte le righe e `lazyRows` ne mostra le prime.
   * La scelta finisce in localStorage come le colonne spente e per lo stesso motivo (regola dell'operatore
   * del 18/08/2026: «l'ordinamento selezionato deve essere memorizzato e ripreso al refresh»), e il valore
   * salvato viene VALIDATO: una chiave che il codice non conosce più torna al default invece di lasciare la
   * tabella in uno stato che non sa disegnare.
   */
  protected readonly sortKey = stored<string>('squad.sort', 'overall', SORTABLE_COLUMNS);
  protected readonly sortWay = stored<NonNullable<NzTableSortOrder>>(
    'squad.sortWay', 'descend', ['ascend', 'descend']);

  /**
   * Le righe nell'ordine scelto: tutte quelle che i FILTRI hanno lasciato passare.
   *
   * L'ordine dei tre passaggi è filtra → ordina → ritaglia, e non è indifferente: ritagliare prima di
   * filtrare darebbe «i primi sessanta della lista, filtrati», cioè una lista che si riempie scorrendo.
   */
  protected readonly sorted = computed<SquadMan[]>(() => {
    const rows = this.kept();
    const compare = this.comparatorOf(this.sortKey());
    if (!compare) return [...rows];
    const way = this.sortWay() === 'ascend' ? 1 : -1;
    return [...rows].sort((left, right) => way * compare(left, right));
  });

  protected readonly lazy = lazyRows(this.sorted);

  /**
   * Un click su una colonna di NUMERI ordina subito dal più alto al più basso (operatore, 16/08/2026).
   *
   * ng-zorro gira `ascend → descend → niente`, che su una tabella di valutazioni è il verso sbagliato:
   * il primo click mostra i peggiori, e per vedere i migliori - che è sempre la domanda - ne servono due.
   * Le colonne di TESTO restano al loro giro naturale: su «Nome» il primo click deve dare la A, non la Z.
   */
  protected readonly highFirst: NzTableSortOrder[] = ['descend', 'ascend', null];

  protected readonly roleLabel = ROLE_LABEL;
  protected readonly ratingKeys = RATING_KEYS;
  protected readonly ratingLabel = RATING_LABEL;
  protected readonly ratingHint = RATING_HINT;
  protected readonly anchorHint = ANCHOR_HINT;
  /* ...and the long version of each, for the panel under the table: a tooltip has two lines to spend. */
  protected readonly ratingDetail = RATING_DETAIL;
  protected readonly anchorDetail = ANCHOR_DETAIL;
  protected readonly starsDetail = STAR_SCALE_DETAIL;

  protected readonly inputSeason = this.valuation.inputSeason;

  /**
   * How the five readings are drawn: the stars, or the 0-99 behind them.
   *
   * It lives in the TABLE and not in the views, so the choice belongs to the thing it changes and both
   * screens have it without a second control that could say something different - and it is REMEMBERED
   * in local storage rather than in the address for the same reason: it is not about which page you are
   * on, so it must survive both a refresh and a walk from one view to the other.
   */
  protected readonly scale = stored<'stars' | 'score'>('reading', 'stars', ['stars', 'score']);

  /** What a star is worth, said once and in the operator's own words (15/08/2026). */
  protected readonly starsHint = STAR_SCALE_HINT;

  /** Che cosa dice il colore delle quattro colonne di fantamedia - e, soprattutto, contro chi. */
  protected readonly tonesDetail =
    'Verde = fra i migliori del SUO RUOLO nel listone, ambra = sotto la metà, rosso = in fondo, e il '
    + 'centro resta neutro perché la media non è una notizia. È il ruolo e non il listone intero perché '
    + '6.20 di fantamedia è un ottimo portiere e un mediocre attaccante: un colore trasversale direbbe '
    + 'che ruolo gioca, non quanto è buono. Il pool sono i quotati di questo listone — non le righe che '
    + 'vedi — così il colore di un uomo non cambia passando dalla rosa di un club alla lista intera. Il '
    + 'tooltip di ogni cella dice il posto e su quanti. La scala è la stessa delle stelline: sono '
    + 'percentili, nessuna valutazione li legge.';

  /** ...e perché l'FVM è colorato da un ALTRO numero, che è la parte che va spiegata seduti. */
  protected readonly fvmToneDetail =
    'L\'FVM non è colorato da sé stesso ma dal confronto col surplus, perché «costa tanto» non è una '
    + 'notizia: un fuoriclasse costa. La notizia è quanto il listone lo prezza sopra o sotto quello che '
    + 'il motore gli dà. Le due valute si convertono come un problema di budget — il surplus dei '
    + '«squadre × slot» uomini che il motore comprerebbe vale il monte crediti che il mercato spende sui '
    + 'suoi, per ruolo di listone — e la differenza è il dVM. VERDE = il listone lo prezza molto sotto '
    + '(occasione), AMBRA = molto sopra (caro), e «molto» è la stessa banda che le stelline chiamano '
    + '«molto sopra/sotto la media». Si confronta col SURPLUS e non con i Fantapunti perché quello che un '
    + 'credito compra è il margine sopra chi giocherebbe al suo posto: i fantapunti contano da zero, e da '
    + 'zero non paga nessuno.';

  /**
   * QUALI COLONNE si vedono. Ricordato come la scala delle letture, e per lo stesso motivo: è una
   * preferenza sulla tabella, non sulla pagina, quindi vale in tutt'e due le viste e sopravvive a un
   * refresh (regola dell'operatore, 15/08/2026: ogni settaggio si ritrova com'era).
   *
   * Sul disco finiscono le colonne SPENTE e non quelle accese, ed è la differenza che conta: così una
   * colonna nuova - il Surplus e il Valore di oggi - nasce VISIBILE anche per chi ha già una preferenza
   * salvata, invece di restare invisibile a chi non sa di doverla accendere.
   */
  private readonly hidden = storedList<string>('squad.hidden',
    (one): one is string => typeof one === 'string');

  /**
   * Le colonne offerte: la squadra solo dove ha senso (una rosa sola non ha bisogno della colonna) e il
   * valore di mercato solo se il bundle porta la curva, perché una colonna vuota si legge come «il
   * mercato non si muove» invece di «questo bundle è più vecchio della tabella».
   */
  protected readonly columns = computed(() =>
    SQUAD_COLUMNS.filter((one) =>
      (one.key !== 'club' || this.showClub())
      && (one.key !== 'market' || this.market.loaded())));

  /**
   * L'ORDINE DELLE COLONNE, trascinabile e ricordato (operatore, 17/08/2026).
   *
   * Sul disco finiscono le chiavi nell'ordine scelto, come per le colonne spente e per la stessa ragione:
   * e' una preferenza sulla TABELLA, quindi vale in tutt'e due le viste e sopravvive a un refresh. Una
   * chiave che il codice non conosce piu' viene ignorata, e una NUOVA colonna non resta invisibile a chi
   * ha gia' un ordine salvato: si aggiunge al suo posto di listino invece di sparire in fondo.
   */
  private readonly order = storedList<string>('squad.order',
    (one): one is string => typeof one === 'string');

  /** Le colonne offerte, nell'ordine scelto. La regola è una funzione pura, così un test la copre. */
  private readonly ordered = computed(() => orderColumns(this.order(), this.columns().map((one) => one.key)));

  protected readonly visible = computed(() =>
    this.ordered().filter((key) => !this.hidden().includes(key)));

  /* ---------------------------------------------------------------- l'intestazione, UNA cella
   *
   * Il template disegna una `<th>` sola e la ripete su `heads()`: larghezza, allineamento, verso
   * dell'ordinamento, tooltip e tipo di filtro vengono da `SquadColumn`. Prima erano diciannove `<th>`
   * quasi identiche in uno `@switch`, che è come si fa a dimenticare `text-right` sulla diciannovesima -
   * e ora sono anche il posto dove il filtro va aggiunto una volta invece di diciannove.
   */

  /** Tutte le intestazioni in ordine: le due fisse davanti, poi le mobili come l'utente le ha messe. */
  protected readonly heads = computed(() => [...FIXED_KEYS, ...this.visible()]);

  /** Quello che sta scritto in testa: la versione corta, dove ce n'è una. */
  protected headOf(key: string): string {
    const column = COLUMN_BY_KEY.get(key);
    return column?.head ?? column?.label ?? key;
  }

  protected widthOf(key: string): string {
    return `${COLUMN_BY_KEY.get(key)?.width ?? 80}px`;
  }

  /**
   * L'allineamento, il cursore e il segno del trascinamento: UN binding, così nessuno può divergere.
   *
   * Il cursore sta qui e non nel CSS globale perché è una proprietà delle colonne MOBILI, e solo questo
   * componente sa quali sono: una regola `nth-child(n+3)` in `ng-zorro.css` ricopierebbe in un foglio di
   * stile il numero di colonne fisse, cioè un fatto che vive in `FIXED_COLUMNS`. `touch-pan-y` lascia
   * alla pagina lo scorrimento verticale col dito e tiene per sé l'asse X, che è quello del riordino.
   */
  protected headClass(key: string): string {
    const align = COLUMN_BY_KEY.get(key)?.align;
    const cell = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';
    const grab = FIXED_KEYS.includes(key)
      ? ''
      : `touch-pan-y ${this.dragKey() ? 'cursor-grabbing' : 'cursor-grab'}`;
    return `${cell} ${grab} ${this.dragMark(key)}`.replace(/\s+/g, ' ').trim();
  }

  protected sortable(key: string): boolean {
    return SORTABLE_COLUMNS.includes(key);
  }

  /** Il verso: la A per prima sulle parole, il numero più alto per primo su tutto il resto. */
  protected directionsOf(key: string): NzTableSortOrder[] {
    return TEXT_SORTED.includes(key) ? TEXT_FIRST : this.highFirst;
  }

  /**
   * Il tooltip dell'intestazione, uno per colonna e vuoto dove non c'è niente da spiegare.
   *
   * Le frasi vivono nei campi che già le portavano; le tre che stavano scritte nel template (il ruolo
   * reale, la titolarità, la MVa) sono diventate campi come le altre - identiche alla lettera, perché
   * una riscrittura del gesto non è il posto dove cambiare quello che una colonna dichiara di essere.
   */
  protected headHint(key: string): string {
    switch (key) {
      case 'codes': return this.codesHeader;
      case 'titolarita': return this.titolaritaHeader;
      case 'categoria': return this.categoriaHeader;
      case 'expected': return this.expectedHeader();
      case 'expectedFm': return this.expectedFmHeader;
      case 'expectedMv': return this.expectedMvHeader;
      case 'steady': return this.steadyHeader;
      case 'surplus': return this.surplusHeader;
      case 'surplusFielded': return this.surplusFieldedHeader;
      case 'value': return this.valueHeader;
      case 'fvm': return this.fvmHeader();
      case 'market': return this.marketHeader;
      case 'pv': return this.pvHeader();
      default:
        return RATING_KEYS.includes(key as RatingKey) ? this.ratingHint[key as RatingKey] : '';
    }
  }

  protected readonly codesHeader =
    'Dove gioca davvero, osservato oggi. In GRASSETTO il ruolo che occuperebbe nella formazione tipo.';

  protected readonly titolaritaHeader =
    'La titolarità in una parola, decisa dal toolkit sull\'undici tipo: BAN bandiera · TIS titolarissimo '
    + '· TIT titolare · BLT ballottaggio · PAN panchina · RIS riserva. Qui «titolarità» vuol dire '
    + 'prendere il voto, anche da subentrato.';

  protected readonly categoriaHeader =
    'Quanto vale DENTRO IL SUO RUOLO, in una parola: ORO gioca sempre e porta tanti bonus · ARG '
    + 'gioca sempre e porta bonus · BRO gioca sempre · CRI gioca poco ma porta bonus · SCM '
    + 'nessuno l\'ha ancora misurato · SRT gioca poco e porta poco. Le sbarre sono del RUOLO: un '
    + 'centrale e un centravanti non si confrontano fra loro.';

  protected readonly steadyHeader =
    'La COSTANZA: quante delle partite che gioca chiude con almeno 6 di voto BASE, non di fantavoto - '
    + 'se non segna, prende 5? È la moneta dei due modificatori, che in questa lega si sommano e pagano '
    + 'tutt\'e due sul voto base. Si confronta DENTRO IL RUOLO: la mediana è 86% per un portiere e 60% '
    + 'per un attaccante, e il tooltip della riga porta quella del suo.';

  protected readonly expectedMvHeader =
    'Media voto ATTESA: il foglio la ricava dalla FM attesa, e la differenza fra le due è il bonus che '
    + 'si aspetta da lui.';

  /* ---------------------------------------------------------------- riordinare le colonne
   *
   * NIENTE CDK, e non è una preferenza: è la cura del difetto che l'operatore ha visto come «buchi /
   * disallineamenti» il 18/08/2026 (CDK muoveva il DOM che Angular possiede, e nemmeno riordinava - le
   * due misure stanno in `docs/model/letture-app-v1.md`, e il pacchetto non è più una dipendenza).
   *
   * RISCRITTO DA CAPO il 20/08/2026, perché la prima versione funzionava male e i motivi sono cinque,
   * ognuno con la sua cura. Sono tutti la stessa famiglia: un gesto è fatto di pixel, e ogni pixel dove
   * non risponde è un pezzo di gesto che «non funziona».
   *
   *   1. SI LASCIAVA SU UNA COLONNA, e fra due celle non c'è nessuna colonna. `columnAt` tornava `null`
   *      oltre l'ultima intestazione, sopra le due fisse e in ogni fessura fra due bordi, e il rilascio
   *      con `null` non spostava niente: portare una colonna in TESTA o in CODA - che è quello che si
   *      fa - non faceva assolutamente nulla. Adesso il gesto ragiona per VARCHI (`gapAt`): ce n'è uno
   *      più delle colonne, esistono sempre, e le mezzerie danno il verso giusto senza soglie.
   *   2. IL SEGNO NON DICEVA DOVE. Un contorno intorno alla colonna «di destinazione» non distingue
   *      «prima di lei» da «dopo di lei», che sono due risultati diversi: si trascinava a occhio e si
   *      scopriva l'esito al rilascio. Adesso una barra sul VARCO, che è esattamente la cosa scelta.
   *   3. SI SELEZIONAVA IL TESTO. Nessuno spegneva la selezione, quindi trascinare un'intestazione
   *      evidenziava di blu mezza riga - il sintomo che si legge come «si è rotto qualcosa».
   *   4. IL CLICK DA MANGIARE POTEVA RESTARE APPESO. Il listener era `{once: true}` sulla riga: se dopo
   *      il rilascio non arrivava un click (rilascio fuori, gesto annullato), restava lì e si mangiava
   *      il PRIMO click legittimo dopo - cioè un ordinamento che non partiva, molto più tardi e senza
   *      una causa visibile. Adesso ha un proprietario che lo smonta.
   *   5. NON SI POTEVA ANNULLARE, né rilasciare fuori dalla finestra in modo prevedibile: `Escape` non
   *      faceva niente e `pointercancel` nemmeno.
   *
   * Quello che NON è cambiato è la scelta di fondo, che resta giusta: il gesto non tocca il DOM. Segna
   * quale colonna è in mano e in quale varco cadrebbe, e al rilascio riscrive SOLO il segnale
   * dell'ordine - Angular ridisegna una volta, da una sola verità.
   */

  /** La colonna in mano. `null` = niente in volo, ed è anche l'interruttore di tutti i segni a schermo. */
  protected readonly dragKey = signal<string | null>(null);

  /** In quale VARCO cadrebbe: `0` = prima della prima colonna mobile, `n` = dopo l'ultima. */
  protected readonly dragGap = signal<number | null>(null);

  /** Il click che segue il rilascio, da mangiare una volta. Tenuto qui perché va anche smontato. */
  private swallowClick: (() => void) | null = null;

  /**
   * Preso per la testa: si aspetta un movimento vero prima di chiamarlo trascinamento.
   *
   * La soglia esiste perché la stessa intestazione fa DUE cose - un click ordina, un trascinamento
   * riordina - e senza di essa un click sarebbe un riordino di zero pixel.
   *
   * I tre listener del volo stanno su `window` e non sulla riga, e non è indifferente: senza cattura del
   * puntatore un `pointermove` ha per bersaglio quello che sta sotto il dito, quindi uscendo dalla
   * tabella una riga non li sentirebbe più e il gesto si fermerebbe a metà. Un tocco invece è catturato
   * dal browser da sé, e in tutt'e due i casi gli eventi arrivano a `window`: è il solo posto che li
   * sente sempre. `setPointerCapture` sarebbe la cura opposta, e su un evento sintetico può fallire -
   * un gesto che muore perché una cattura non è andata a buon fine è peggio di un listener in più.
   */
  protected grabAt(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // L'imbuto del filtro è un pulsante dentro l'intestazione: aprirlo non è prendere la colonna.
    if (!target || target.closest('.ant-table-filter-trigger')) return;
    const head = target.closest('th');
    const row = head?.closest('tr');
    if (!head || !row) return;
    const key = this.keyOf(row, head);
    // Le due fisse sono l'identità della riga e non si spostano: `visible()` non le contiene.
    if (!key || !this.visible().includes(key)) return;

    const startX = event.clientX;
    let dragging = false;
    /*
     * IL TRASCINAMENTO NATIVO DEL BROWSER VA SPENTO SUBITO, e questo è il difetto che costava il gesto
     * dal SECONDO in poi: un `mousedown` seguito da un movimento sopra del testo fa partire il drag
     * NATIVO di Chromium, che si prende il puntatore e smette di mandare `pointermove` - manda `drag`.
     * Misurato in e2e il 20/08/2026 contando gli eventi che arrivavano davvero: `pointerdown` 1,
     * `pointermove` **2 su 18**, e a metà volo nessuna colonna in mano. Il primo trascinamento della
     * pagina funzionava, tutti quelli dopo no, e a schermo si legge come «funziona a volte».
     * Si spengono dal `pointerdown` e non dalla soglia, perché il drag nativo parte prima che noi
     * abbiamo deciso che è un trascinamento; e si spegne anche la SELEZIONE, perché una selezione
     * rimasta in giro è proprio ciò che rende «trascinabile» il testo sotto il dito. Nessun
     * `preventDefault` sul `pointerdown` stesso: sopprimerebbe anche il click, che qui deve ordinare.
     */
    const stopNative = (native: Event): void => native.preventDefault();
    document.addEventListener('selectstart', stopNative);
    document.addEventListener('dragstart', stopNative);

    const end = (moved: boolean): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('selectstart', stopNative);
      document.removeEventListener('dragstart', stopNative);
      const gap = this.dragGap();
      this.dragKey.set(null);
      this.dragGap.set(null);
      if (!dragging) return;
      // Il click che il browser manda dopo il rilascio è la coda del gesto, non una scelta: va mangiato
      // anche quando il gesto è stato annullato, perché il click arriva comunque.
      this.eatNextClick(row);
      if (moved && gap != null) this.moveColumn(key, gap);
    };

    const move = (moving: PointerEvent): void => {
      if (!dragging && Math.abs(moving.clientX - startX) < DRAG_THRESHOLD_PX) return;
      if (!dragging) {
        dragging = true;
        this.dragKey.set(key);
        // E la selezione che c'era PRIMA va via: è quella che il browser proverebbe a trascinare.
        document.getSelection()?.removeAllRanges();
      }
      this.dragGap.set(this.gapUnder(row, moving.clientX));
      this.edgeScroll(moving.clientX);
    };
    const up = (): void => end(true);
    const cancel = (): void => end(false);
    const onKey = (pressed: KeyboardEvent): void => {
      if (pressed.key === 'Escape') end(false);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey);
  }

  /**
   * Il segno del gesto: sbiadita la colonna in mano, una barra sul varco dove finirebbe.
   *
   * Una classe sola per intestazione e nessun nodo spostato da nessuno. La barra è un'OMBRA INTERNA e
   * non un bordo: un bordo su una tabella a larghezze fisse ruba due pixel al contenuto e sposta le
   * cifre di tutte le celle sotto, cioè disegnerebbe il disallineamento che questo gesto deve curare.
   */
  protected dragMark(key: string): string {
    if (!this.dragKey()) return '';
    const marks: string[] = [];
    if (this.dragKey() === key) marks.push('opacity-40');
    const gap = this.dragGap();
    const list = this.visible();
    if (gap != null) {
      // Il varco `n` non ha una colonna a destra: si disegna sul bordo DESTRO dell'ultima.
      if (list[gap] === key) marks.push('shadow-[inset_3px_0_0_0_var(--color-primary)]');
      else if (gap === list.length && list.at(-1) === key) {
        marks.push('shadow-[inset_-3px_0_0_0_var(--color-primary)]');
      }
    }
    return marks.join(' ');
  }

  /**
   * VICINO AL BORDO, LA PAGINA SCORRE - altrimenti metà delle destinazioni non sono raggiungibili.
   *
   * Questa tabella chiede circa 1900px e una finestra ne ha 1600: le ultime colonne sono FUORI dallo
   * schermo, e senza questo un varco fuori dal viewport non si può scegliere, perché il dito non ci
   * arriva. Misurato guidando il gesto con un mouse vero il 20/08/2026: trascinando una colonna in coda
   * finiva fuori, e da lì non si poteva più riprendere.
   * Scorre la PAGINA e non un contenitore, che è la stessa scelta dello sticky dell'intestazione (in
   * `ng-zorro.css` c'è il perché); e ogni `pointermove` ne sposta un passo, quindi la velocità è quella
   * della mano - nessun timer da fermare, nessuna animazione che continua dopo il rilascio.
   */
  private edgeScroll(x: number): void {
    const near = x < DRAG_EDGE_PX
      ? -1
      : x > window.innerWidth - DRAG_EDGE_PX
        ? 1
        : 0;
    if (near) window.scrollBy({ left: near * DRAG_SCROLL_STEP_PX, behavior: 'instant' });
  }

  /** Le intestazioni MOBILI, in ordine: le fisse stanno in testa e non si spostano. */
  private movableHeads(row: Element): HTMLElement[] {
    const heads = Array.from(row.querySelectorAll<HTMLElement>('th'));
    return heads.slice(FIXED_COLUMNS.length);
  }

  /** Di quale colonna è questa intestazione, letto dalla POSIZIONE: la riga è l'unica verità. */
  private keyOf(row: Element, head: Element): string | null {
    const at = this.movableHeads(row).indexOf(head as HTMLElement);
    return at < 0 ? null : (this.visible()[at] ?? null);
  }

  /** In quale varco sta il dito, misurato sulle intestazioni vere e non su una somma di larghezze. */
  private gapUnder(row: Element, x: number): number {
    return gapAt(this.movableHeads(row).map((head) => head.getBoundingClientRect()), x);
  }

  /** Sposta una colonna in un varco, scrivendo l'ordine INTERO - comprese le spente. */
  private moveColumn(key: string, gap: number): void {
    const moved = withColumnMoved(this.ordered(), this.visible(), key, gap);
    if (moved) this.order.set(moved);
  }

  /**
   * Mangia il prossimo click e poi si smonta, in qualunque dei due modi finisca.
   *
   * Il `setTimeout` è la parte che nella prima versione mancava: un `{once: true}` che non scatta resta
   * appeso e si mangia un click legittimo molto più tardi, cioè produce un ordinamento che non parte e
   * nessuna causa visibile. Il click di un rilascio arriva nello stesso giro di eventi, quindi zero
   * millisecondi bastano e non c'è nessuna attesa da indovinare.
   */
  private eatNextClick(row: Element): void {
    this.swallowClick?.();
    const eat = (click: Event): void => {
      click.stopPropagation();
      click.preventDefault();
      this.swallowClick?.();
    };
    const timer = setTimeout(() => this.swallowClick?.(), 0);
    this.swallowClick = () => {
      clearTimeout(timer);
      row.removeEventListener('click', eat, { capture: true });
      this.swallowClick = null;
    };
    row.addEventListener('click', eat, { capture: true });
  }

  /* ---------------------------------------------------------------- filtrare, una colonna per volta
   *
   * PERCHÉ NON È IL FILTRO DI nz-table, e la ragione è la stessa dell'ordinamento (misurata il
   * 18/08/2026): `nzFilterFn` filtra `nzData`, e `nzData` sono le righe GIÀ CARICATE. «FMa ≥ 6,50»
   * avrebbe risposto sulle prime sessanta di cinquecentonovantadue e la tabella si sarebbe riempita
   * scorrendo - una lista mostrata i cui numeri descrivono un'altra lista. Quindi si filtra la lista
   * INTERA, prima di ordinarla e prima di ritagliarla, e le intestazioni si limitano a chiedere.
   *
   * Le tre domande e come si decide chi passa stanno in `column-filter.ts`, pure e coperte da un test.
   * Qui c'è solo quello che ha bisogno del componente: quale numero legge una colonna, quali valori si
   * possono spuntare, e la frase che ogni filtro attivo scrive SOPRA la tabella - perché un filtro
   * ricordato che non si vede è un filtro che la prossima sessione legge come «il listone ha dodici
   * uomini». Per la stessa ragione la barra dei filtri attivi non sta dentro un pannello che si chiude.
   */

  /**
   * I FILTRI, ricordati come le colonne spente e l'ordine, e per lo stesso motivo: sono una preferenza
   * sulla TABELLA, quindi valgono in tutt'e due le viste e sopravvivono a un refresh.
   *
   * La contro-obiezione è vera e la cura è dichiarata: un filtro salvato è invisibile, e questo progetto
   * paga da sempre il difetto delle liste che non dicono cosa sono. Per questo ogni filtro attivo ha la
   * sua etichetta sopra la tabella, con la sua crocetta, e il conteggio sotto dice quanti uomini sono
   * stati nascosti su quanti.
   */
  private readonly filters = storedJson<Record<string, ColumnFilter>>('squad.filters', readFilters);

  /** Quale imbuto è aperto. Uno alla volta, così il pannello condiviso sa di chi parla. */
  protected readonly openFilter = signal<string | null>(null);

  /**
   * I filtri che si APPLICANO qui: quelli delle colonne che questa vista offre.
   *
   * Una rosa di club non ha la colonna «Squadra», e un filtro per squadra rimasto acceso dalla vista
   * CALCIATORI la svuoterebbe senza che ci sia un imbuto da cui togliersolo. Stessa regola di
   * `setVisible`: quello che questa vista non offre, non lo tocca e non lo legge.
   */
  private readonly liveFilters = computed(() => {
    const filters = this.filters();
    const offered = new Set([
      ...FIXED_COLUMNS.map((one) => one.key),
      ...this.columns().map((one) => one.key),
    ]);
    return Object.keys(filters)
      .filter((key) => offered.has(key) && isActive(filters[key]))
      .map((key) => ({ key, filter: filters[key] }));
  });

  /** Le righe che passano i filtri. TUTTE le righe: è la lista intera che si filtra. */
  protected readonly kept = computed<SquadMan[]>(() => {
    const live = this.liveFilters();
    if (!live.length) return this.rows();
    return this.rows().filter((man) => live.every((one) => this.passes(man, one.key, one.filter)));
  });

  /** Quanti uomini i filtri stanno nascondendo: il numero che rende onesta la tabella. */
  protected readonly hiddenByFilters = computed(() => this.rows().length - this.kept().length);

  /** Un'etichetta per filtro attivo: la colonna e, in parole, che cosa chiede. */
  protected readonly filterChips = computed(() =>
    this.liveFilters().map((one) => ({
      key: one.key,
      label: COLUMN_BY_KEY.get(one.key)?.label ?? one.key,
      said: describeFilter(this.filterKind(one.key) ?? 'range', one.filter,
        (value) => this.pickLabel(one.key, value)),
    })));

  /** Come si filtra questa colonna, o `null` per quelle che non si filtrano. */
  protected filterKind(key: string): FilterKind | null {
    return COLUMN_BY_KEY.get(key)?.filter ?? null;
  }

  /** Il filtro di una colonna, sempre un oggetto: il template lo legge senza guardie. */
  protected filterOf(key: string): ColumnFilter {
    return this.filters()[key] ?? {};
  }

  protected isFiltered(key: string): boolean {
    return isActive(this.filters()[key]);
  }

  /** Cambia una metà del filtro di una colonna. Un filtro che non chiede più niente esce dalla mappa. */
  protected setFilter(key: string, patch: Partial<ColumnFilter>): void {
    const next = { ...this.filterOf(key), ...patch };
    const all = { ...this.filters() };
    if (isActive(next)) all[key] = next;
    else delete all[key];
    this.filters.set(all);
  }

  protected clearFilter(key: string): void {
    const all = { ...this.filters() };
    delete all[key];
    this.filters.set(all);
  }

  /** Azzera solo quello che questa vista applica: l'altra schermata non ha chiesto niente. */
  protected clearFilters(): void {
    const all = { ...this.filters() };
    for (const one of this.liveFilters()) delete all[one.key];
    this.filters.set(all);
  }

  /**
   * L'imbuto: apre e chiude, e ne resta aperto uno solo.
   *
   * `nz-filter-trigger` emette anche il `false` di chi si chiude quando un altro si apre, quindi la
   * chiusura vale solo se parla della colonna che è davvero aperta - altrimenti l'ultimo a parlare
   * chiuderebbe quello appena aperto.
   */
  protected showFilter(key: string, open: boolean): void {
    if (open) {
      this.openFilter.set(key);
      this.pickSearch.set('');
      return;
    }
    if (this.openFilter() === key) this.openFilter.set(null);
  }

  /**
   * La ricerca DENTRO un elenco da spuntare: le squadre di un listone sono quaranta, e scorrerle per
   * trovarne una è il modo lento di fare la cosa veloce. Si azzera ad ogni apertura, perché è una
   * scorciatoia per arrivare alla spunta e non un filtro: quello che filtra sono le spunte.
   */
  protected readonly pickSearch = signal('');

  /** Spuntare e togliere una voce, che è quello che fa una casella dell'elenco. */
  protected togglePick(key: string, value: string, on: boolean): void {
    const chosen = new Set(this.filterOf(key).pick ?? []);
    if (on) chosen.add(value);
    else chosen.delete(value);
    this.setFilter(key, { pick: [...chosen] });
  }

  protected isPicked(key: string, value: string): boolean {
    return (this.filterOf(key).pick ?? []).includes(value);
  }

  /**
   * LE VOCI DA SPUNTARE della colonna aperta, contate sulle righe - e contate PRIMA dei filtri.
   *
   * Il numero accanto a ogni voce è quanti uomini la portano, e va letto sul TOTALE: contarlo sulle
   * righe già filtrate lo farebbe ballare a ogni spunta, e «Napoli (3)» dopo aver scelto i portieri
   * direbbe che il Napoli ha tre giocatori. `NO_VALUE` compare solo se qualcuno davvero non ce l'ha.
   *
   * Un `computed` e non un metodo del template: gira su tutte le righe, e un metodo lo rifarebbe a ogni
   * ciclo di change detection per il solo fatto che un pannello è aperto.
   */
  protected readonly openOptions = computed(() => {
    const key = this.openFilter();
    if (!key || this.filterKind(key) !== 'pick') return [];
    const counts = new Map<string, number>();
    for (const man of this.rows()) {
      const values = this.pickValues(man, key);
      for (const one of values.length ? values : [NO_VALUE]) {
        counts.set(one, (counts.get(one) ?? 0) + 1);
      }
    }
    const wanted = fold(this.pickSearch());
    return [...counts]
      .map(([value, count]) => ({ value, count, label: this.pickLabel(key, value) }))
      .filter((one) => !wanted || fold(one.label).includes(wanted))
      .sort((left, right) => this.pickOrder(key, left.value) - this.pickOrder(key, right.value)
        || left.label.localeCompare(right.label, 'it'));
  });

  /** Quante voci ha in tutto: sotto una dozzina la ricerca è un controllo in più che non serve. */
  protected readonly openOptionsAreMany = computed(() => this.openOptions().length > 12
    || !!this.pickSearch());

  /** Quello che una riga porta in una colonna da spuntare. Lista vuota = non ce l'ha. */
  private pickValues(man: SquadMan, key: string): readonly string[] {
    switch (key) {
      case 'role': return [man.role];
      case 'club': return [man.club];
      case 'mantra': return man.mantraCodes;
      case 'codes': return man.codes;
      case 'titolarita': return man.titolarita ? [man.titolarita] : [];
      case 'categoria': return man.category ? [man.category] : [];
      default: return [];
    }
  }

  /** Come si chiama una voce a schermo: la stessa parola che la cella mostra, non un'altra. */
  private pickLabel(key: string, value: string): string {
    if (value === NO_VALUE) return 'ignoto';
    if (key === 'role') return ROLE_LABEL[value as ClassicRole] ?? value;
    if (key === 'titolarita') {
      return isTitolarita(value) ? `${TITOLARITA_SHORT[value]} · ${value}` : value;
    }
    if (key === 'categoria') {
      return isCategoria(value) ? `${CATEGORIA_SHORT[value]} · ${value}` : value;
    }
    return value;
  }

  /**
   * L'ordine dell'elenco: la SCALA dove ce n'è una, l'alfabeto dove non c'è.
   *
   * Il ruolo va P, D, C, A - l'ordine del listone - e la titolarità dalla bandiera alla riserva: in
   * ordine alfabetico verrebbe BAL, BAN, PAN, RIS, TIS, TIT, cioè nessun ordine. Chi non ha il valore
   * sta in fondo, come ogni altro vuoto di questa tabella.
   */
  private pickOrder(key: string, value: string): number {
    if (value === NO_VALUE) return 99;
    if (key === 'role') return ROLE_ORDER[value] ?? 9;
    if (key === 'titolarita') return titolaritaRank(value) ?? 98;
    if (key === 'categoria') return categoriaRank(value) ?? 98;
    return 0;
  }

  /**
   * GLI ESTREMI VERI della colonna aperta, che il pannello scrive dentro le caselle vuote.
   *
   * È la differenza fra un filtro che si può usare e uno da indovinare: «FMa» va da 3,50 a 8,10 e
   * «Fantapunti» da −20 a 340, e senza vederlo scritto il primo tentativo è sempre sbagliato. Contati
   * su TUTTE le righe, come i conteggi delle spunte, e per la stessa ragione.
   */
  protected readonly openRange = computed(() => {
    const key = this.openFilter();
    if (!key || this.filterKind(key) !== 'range') return null;
    let min: number | null = null;
    let max: number | null = null;
    for (const man of this.rows()) {
      const value = this.numberOf(man, key);
      if (value == null) continue;
      if (min == null || value < min) min = value;
      if (max == null || value > max) max = value;
    }
    if (min == null || max == null) return null;
    // Arrotondati verso l'esterno, così il suggerimento non esclude gli estremi che dichiara.
    return { min: Math.floor(min * 100) / 100, max: Math.ceil(max * 100) / 100 };
  });

  /** Di quanto si muove una freccia dell'estremo: un decimale dove la colonna ne ha uno. */
  protected rangeStep(key: string): number {
    return DECIMAL_COLUMNS.includes(key) ? 0.1 : 1;
  }

  /** Il tre-vie sugli ignoti, che è la parte del filtro che questo progetto non può non avere. */
  protected setBlanks(key: string, blanks: Blanks): void {
    this.setFilter(key, { blanks });
  }

  protected blanksOf(key: string): Blanks {
    return this.filterOf(key).blanks ?? 'any';
  }

  /** Se una riga passa il filtro di una colonna: una domanda per tipo, mai una per colonna. */
  private passes(man: SquadMan, key: string, filter: ColumnFilter): boolean {
    switch (this.filterKind(key)) {
      case 'text': return passesText(man.name, filter);
      case 'pick': return passesPick(this.pickValues(man, key), filter);
      case 'range': return passesRange(this.numberOf(man, key), filter);
      default: return true;
    }
  }

  /**
   * IL NUMERO che una colonna porta, e per ognuna è LO STESSO che ordina e che si vede.
   *
   * Non un secondo modo di leggere la stessa cella: due letture finirebbero per non essere d'accordo, e
   * il primo posto dove si vedrebbe è un filtro che nasconde una riga il cui numero a schermo lo passa.
   * Il mercato si ordina per VALORE e non per tendenza (la ragione sta su `byMarket`), quindi si filtra
   * per valore.
   */
  private numberOf(man: SquadMan, key: string): number | null {
    switch (key) {
      case 'expected': return man.expected;
      case 'expectedFm': return man.expectedFm;
      case 'expectedMv': return man.expectedMv;
      // La quota per CENTO, così il filtro si scrive come si legge la cella: «da 70 a 100» e non
      // «da 0,7 a 1». Gli estremi del pannello vengono da qui, quindi le due cose non possono divergere.
      case 'steady':
        return man.rating?.steady.share == null ? null : man.rating.steady.share * 100;
      case 'surplus': return man.surplus;
      case 'surplusFielded': return man.surplusFielded;
      case 'value': return man.value;
      case 'fvm': return man.fvm;
      case 'market': return this.trend(man)?.value ?? null;
      case 'pv': return man.pv;
      case 'mv': return man.mv;
      case 'fm': return man.fm;
      default:
        return RATING_KEYS.includes(key as RatingKey)
          ? (man.rating?.[key as RatingKey].score ?? null)
          : null;
    }
  }

  /* ---------------------------------------------------------------- ordinare
   *
   * Un comparatore per colonna, presi UNO A UNO da quelli che già esistono: la mappa non ne inventa
   * nessuno, così l'ordinamento di una colonna resta quello che il suo tooltip descrive.
   */
  private comparatorOf(key: string): ((left: SquadMan, right: SquadMan) => number) | null {
    switch (key) {
      case 'role': return this.byRole;
      case 'name': return this.byName;
      case 'club': return this.byClub;
      case 'titolarita': return this.byTitolarita;
      case 'categoria': return this.byCategoria;
      case 'expected': return this.byExpected;
      case 'expectedFm': return this.byExpectedFm;
      case 'expectedMv': return this.byExpectedMv;
      case 'steady': return this.bySteady;
      case 'surplus': return this.bySurplus;
      case 'surplusFielded': return this.bySurplusFielded;
      case 'value': return this.byValue;
      case 'fvm': return this.byFvm;
      case 'market': return this.byMarket;
      case 'pv': return this.byPv;
      case 'mv': return this.byMv;
      case 'fm': return this.byFm;
      default:
        return RATING_KEYS.includes(key as RatingKey) ? this.byRating(key as RatingKey) : null;
    }
  }

  /** Quale freccia mostra un'intestazione: la sua, o nessuna. */
  protected sortOrderOf(key: string): NzTableSortOrder {
    return this.sortKey() === key ? this.sortWay() : null;
  }

  /**
   * Cliccata un'intestazione. `null` (il terzo giro di ng-zorro) rimette il RUOLO, che è l'ordine di
   * lettura del listone: una tabella senza ordinamento non esiste, le righe arriverebbero come capita.
   */
  protected sortWith(key: string, order: string | null): void {
    if (!order) {
      this.sortKey.set('role');
      this.sortWay.set('ascend');
      return;
    }
    this.sortKey.set(key);
    this.sortWay.set(order === 'ascend' ? 'ascend' : 'descend');
  }

  /** Il cast che il template non puo' fare da se': nel `@default` la chiave e' una delle letture. */
  protected asRating(key: string): RatingKey {
    return key as RatingKey;
  }

  protected shows(key: string): boolean {
    return !this.hidden().includes(key);
  }

  /** Quello che l'utente sceglie è cosa VEDERE; sul disco va il complemento. */
  protected setVisible(keys: string[]): void {
    const wanted = new Set(keys);
    const offered = this.columns().map((one) => one.key);
    // Le colonne non offerte in questa vista (la squadra) non vengono toccate: spegnerle qui le
    // spegnerebbe anche nell'altra tabella, dove l'utente non ha scelto niente.
    const untouched = this.hidden().filter((key) => !offered.includes(key));
    this.hidden.set([...untouched, ...offered.filter((key) => !wanted.has(key))]);
  }

  /**
   * Quattordici colonne, quindici con la squadra: sotto questa larghezza la tabella scorre di lato
   * invece di tagliare. E `y` è quello che tiene i NOMI DELLE COLONNE in alto mentre la lista scorre
   * (operatore, 15/08/2026): è il meccanismo di ng-zorro - intestazione e corpo in due tabelle - e non
   * un `position: sticky` sulle th, che dentro un contenitore che scorre si ancora al contenitore e se
   * ne va con lui (misurato: dopo 463px di pagina l'intestazione era a -215).
   *
   * L'altezza è quella della finestra meno quello che sta sopra la tabella, così il corpo scorre e la
   * pagina no; sotto le venti righe non cambia niente perché il corpo è più corto del suo massimo.
   */
  /**
   * LA LARGHEZZA MINIMA della tabella: la somma delle colonne accese.
   *
   * Non è più `nzScroll` - la tabella non sta in un contenitore che scorre, o lo sticky dell'intestazione si
   * ancorerebbe a quello e se ne andrebbe con lui (misurato: −952px dopo 1200px di pagina) - ma la somma
   * serve ancora: senza, con venti colonne accese le celle si stringono fino a spezzare i numeri. Scorre la
   * PAGINA, nei due assi, e la barra è una per asse.
   */
  protected readonly minWidth = computed(() => {
    const width = this.columns()
      .filter((one) => this.shows(one.key))
      .reduce((sum, one) => sum + one.width, FIXED_WIDTH);
    return `${width}px`;
  });


  /** What the two measured columns are about: one season, one calendar, said once. */
  protected readonly measuredOn = computed(() => this.valuation.measuredOn(this.platform()));

  /** How the table sorts by role: the listone's order, never the alphabet. */
  protected readonly byRole = (left: SquadMan, right: SquadMan): number =>
    (ROLE_ORDER[left.role] ?? 9) - (ROLE_ORDER[right.role] ?? 9);

  protected readonly byName = (left: SquadMan, right: SquadMan): number =>
    left.name.localeCompare(right.name);

  protected readonly byClub = (left: SquadMan, right: SquadMan): number =>
    left.club.localeCompare(right.club, 'it') || left.name.localeCompare(right.name);

  /** Il fantavalore, e un uomo che il listone non quota sta in fondo: non ha un prezzo, non vale zero. */
  protected readonly byFvm = (left: SquadMan, right: SquadMan): number =>
    (left.fvm ?? -1) - (right.fvm ?? -1);

  /** Che cos'è l'FVM, e in quale valuta lo stiamo mostrando. */
  protected readonly fvmHeader = computed(() => {
    const sheet = this.valuation.sheetFor(this.platform());
    return short(
      `Fantavalore di mercato del listone${sheet ? ` (${sheet.game})` : ''}: il giudizio più fresco del `
        + 'mercato, e nessun nostro numero lo legge.',
    );
  });

  protected fvmHint(man: SquadMan): string {
    if (man.fvm == null) return 'Questo listone non lo quota: ignoto, mai zero.';
    if (man.dvm == null || man.spm == null) {
      return short(
        `${man.fvm} di fantavalore · questo foglio non porta l'SpM, quindi il confronto col surplus non `
          + 'è stato fatto (foglio da ricostruire, revisione 20)',
      );
    }
    // Il verso in parole, perché «+38» da solo non dice CHI sta sopra: dVM positivo = il motore lo
    // prezza più del listone, cioè costa meno di quanto rende.
    const verse = man.dvm >= 0 ? 'meno' : 'più';
    return short(
      `${man.fvm} di fantavalore contro ${Math.round(man.spm)} di surplus in crediti: `
        + `il listone lo prezza ${Math.abs(Math.round(man.dvm))} ${verse} del motore${this.rank(man, 'dvm')}`,
    );
  }

  /**
   * IL COLORE DELL'FVM, e qui è INCHIOSTRO e non riquadro (operatore, 16/08/2026).
   *
   * Che cosa colora, e perché non il prezzo in sé: un fuoriclasse costa, quindi tingere l'FVM per quanto
   * è grande direbbe «è caro», che si legge già dal numero. La notizia è il CONFRONTO col surplus - il
   * dVM - e va nel verso giusto: **verde quando il listone lo prezza molto SOTTO** quello che il motore
   * gli dà (occasione), **ambra quando lo prezza molto SOPRA** (caro). Niente rosso: la regola di casa lo
   * tiene per il pericolo, e un uomo caro è un avvertimento, non un allarme.
   *
   * «MOLTO» NON È UNA SOGLIA NUOVA: è la banda che le stelline già chiamano «molto sopra / molto sotto la
   * media» (±0,75 sigma, cioè i percentili 77 e 23 dentro il ruolo). Inventarne una seconda avrebbe fatto
   * dire due cose diverse alla stessa parola. Prende circa un quarto del ruolo per lato.
   */
  protected fvmTone(man: SquadMan): string {
    const stars = starsOf(man.tones.dvm);
    if (stars == null) return '';
    if (stars >= 4) return 'text-success font-medium';
    if (stars <= 2) return 'text-warning font-medium';
    return '';
  }

  /* ---------------------------------------------------------------- il valore di mercato */
  /** La lettura di un uomo alla data dell'app. Null = la fonte non lo conosce: ignoto, mai zero. */
  protected trend(man: SquadMan): MarketTrend | null {
    return this.market.trend(man.fcId);
  }

  /** Che cos'è la colonna, e - la parte che conta - che cosa NON è. */
  protected readonly marketHeader = short(
    `Valore di mercato Transfermarkt e la sua tendenza sugli ultimi ${TREND_MONTHS} mesi. `
      + 'È un prezzo misurato, non un nostro numero: nessuna valutazione lo legge.',
  );

  /** La freccia: tre stati, e nessuno quando la curva non arriva a un anno prima. */
  protected marketArrow(man: SquadMan): string {
    const direction = this.trend(man)?.direction;
    return direction === 'up' ? '↑' : direction === 'down' ? '↓' : direction === 'flat' ? '→' : '';
  }

  /**
   * IL COLORE, e va nel verso del MERCATO e non del nostro interesse.
   *
   * Verde = il mercato sta salendo su di lui, ambra = sta scendendo. Non è un consiglio d'acquisto - un
   * valore che scende è spesso un uomo che costa poco - ed è per questo che il colore sta sulla freccia
   * e non sulla cifra: colora la NOTIZIA (il mercato si è mosso), non il prezzo.
   */
  protected marketTone(man: SquadMan): string {
    const direction = this.trend(man)?.direction;
    if (direction === 'up') return 'text-success';
    if (direction === 'down') return 'text-warning';
    return 'text-muted';
  }

  protected marketCell(man: SquadMan): string {
    const trend = this.trend(man);
    return trend ? euros(trend.value) : '—';
  }

  protected marketHint(man: SquadMan): string {
    const trend = this.trend(man);
    if (!trend) {
      return short(
        'La fonte non ha una curva per lui: ignoto, mai zero. Sono 57 quotati su 1.175 (17/08/2026), e '
          + 'sono quelli senza identità Transfermarkt.',
      );
    }
    const read = `${euros(trend.value)} il ${itDate(trend.at)}`;
    // La data conta quanto la cifra: la fonte muove i valori a ondate, quindi l'ultimo punto ha in mediana
    // 77 giorni. Non è vecchio, è l'ultimo che esiste - e chi lo legge deve saperlo.
    const age = daysSince(trend.at, this.travel.today());
    const when = age > 30 ? `${read} (l'ultima variazione: ${age} giorni)` : read;
    if (trend.change == null || !trend.from) {
      return short(`${when} · la curva non arriva a ${TREND_MONTHS} mesi prima, quindi la tendenza è ignota`);
    }
    const percent = `${trend.change > 0 ? '+' : '−'}${Math.abs(Math.round(trend.change * 100))}%`;
    return short(
      `${when} · da ${euros(trend.from.value)} del ${itDate(trend.from.on)}: ${percent} in `
        + `${TREND_MONTHS} mesi`,
    );
  }

  /**
   * SI ORDINA PER VALORE E MAI PER TENDENZA, ed è una misura e non un gusto.
   *
   * Una variazione in percentuale dipende dalla base: sui quotati 2026-27 il quartile più povero ha mediana
   * +50% e nono decile +1.614%, il più ricco mediana −9%. Ordinare per tendenza metterebbe in cima chi
   * passa da 200 mila a 3 milioni, che è vero e non è la domanda di un'asta - la stessa lezione dei
   * portieri. Chi non ha curva sta in fondo: non ha un prezzo, non vale zero.
   */
  protected readonly byMarket = (left: SquadMan, right: SquadMan): number =>
    (this.trend(left)?.value ?? -1) - (this.trend(right)?.value ?? -1);

  /** La parte lunga, per il pannello sotto la tabella. */
  protected readonly marketDetail =
    'Il valore di mercato è il prezzo che il mercato VERO gli ha dato (Transfermarkt), l\'FVM è quello che '
    + 'il listone chiede: due giudizi sulla stessa persona da due tavoli diversi. La freccia guarda '
    + `${TREND_MONTHS} mesi indietro e cambia oltre il ${Math.round(TREND_BAND * 100)}% — verde sale, ambra `
    + 'scende, → si è mossa di poco — e si ferma quando la curva non arriva a un anno, perché «ignoto» non '
    + 'è «ferma». La colonna si ordina per VALORE e non per tendenza: una percentuale dipende dalla base, e '
    + 'ordinarci sopra metterebbe in cima i ragazzi che passano da 200 mila a 3 milioni. Nessun numero del '
    + 'motore la legge: il gate ha misurato la curva come canale (l\'investimento) e l\'ha respinta.';

  /**
   * Il SURPLUS, e chi non ne ha uno sta in fondo - ma il fondo qui è più basso di −1, perché il surplus
   * È NEGATIVO per chiunque valga meno del rimpiazzo del suo ruolo, e sono tanti. Con −1 come sentinella
   * un uomo senza numero finiva in mezzo alla lista, cioè in mezzo a gente misurata.
   */
  protected readonly bySurplus = (left: SquadMan, right: SquadMan): number =>
    (left.surplus ?? -Infinity) - (right.surplus ?? -Infinity);

  /** Stesso ordinamento del surplus e stessa sentinella: senza numero si sta in fondo, non a −1. */
  protected readonly bySurplusFielded = (left: SquadMan, right: SquadMan): number =>
    (left.surplusFielded ?? -Infinity) - (right.surplusFielded ?? -Infinity);

  protected readonly byValue = (left: SquadMan, right: SquadMan): number =>
    (left.value ?? -1) - (right.value ?? -1);

  protected readonly surplusHeader = short(
    'SURPLUS del motore: i fantapunti che ti dà IN PIÙ del rimpiazzo del suo ruolo, su tutta la '
      + 'stagione. Il rimpiazzo qui è il MARGINALE DI ROSA - l\'ottantesimo centrocampista di dieci '
      + 'squadre - quindi la domanda a cui risponde è «chi conviene comprare». È la metrica con cui il '
      + 'toolkit ordina l\'asta, ed è quella che il gate possiede. È lo STESSO zero del «Lead» del '
      + 'pannello asta, con una differenza sola: là una riga stimata è moltiplicata per la sua '
      + 'confidenza, qui no.',
  );

  /**
   * L'altra colonna, e la sua intestazione deve dire lo ZERO: senza, i due numeri sembrano lo stesso
   * numero calcolato due volte, che è il modo più veloce per non fidarsi di nessuno dei due.
   */
  protected readonly surplusFieldedHeader = short(
    'MARGINE sul rimpiazzo che ENTRA DAVVERO: non l\'ottantesimo del listone, ma il migliore dei tuoi '
      + 'che ha il voto quel giorno (rango «squadre × posti che il regolamento schiera»). Mezzo punto di '
      + 'fantamedia più in alto del Surplus, quindi risponde a un\'altra domanda: quanto costa una '
      + 'giornata saltata. Chi sta in alto in tutt\'e due è forte davvero; chi qui scende valeva '
      + 'soprattutto perché i riempitivi del suo ruolo sono pessimi. REPORTING: nessuna regola la legge.',
  );

  protected readonly valueHeader = short(
    'FANTAPUNTI che porta in tutto (fantamedia × presenze attese), senza sottrarre niente. '
      + 'Surplus = fantapunti − rimpiazzo × presenze. Da non confondere con l\'FVM, che è un prezzo.',
  );

  protected surplusHint(man: SquadMan): string {
    if (man.surplus == null) return 'Il motore non lo valuta e non offre una stima: ignoto, mai zero.';
    return short(
      `${man.surplus >= 0 ? '+' : '−'}${Math.abs(man.surplus).toFixed(1)} fantapunti sopra il rimpiazzo`
        + (man.surplusIsEstimate ? ' · è la STIMA, già scontata della sua incertezza' : ''),
    );
  }

  protected surplusFieldedHint(man: SquadMan): string {
    if (man.surplusFielded == null) {
      return 'Il foglio non porta questo secondo zero (bundle prima della revisione 22), o il motore '
        + 'non lo valuta e non offre una stima: ignoto, mai zero.';
    }
    const sign = man.surplusFielded >= 0 ? '+' : '−';
    // Il numero E il suo zero: una differenza senza il metro non è un fatto, ed è precisamente la
    // domanda che una seconda colonna di surplus fa venire in mente.
    return short(
      `${sign}${Math.abs(man.surplusFielded).toFixed(1)} fantapunti sopra chi entrerebbe al posto suo`
        + (man.replacementFielded != null
          ? ` · il rimpiazzo che entra vale ${man.replacementFielded.toFixed(2)} di fantamedia` : '')
        + (man.surplusIsEstimate ? ' · è la STIMA, già scontata della sua incertezza' : ''),
    );
  }

  protected valueHint(man: SquadMan): string {
    if (man.value == null) return 'Senza fantamedia attesa o presenze attese non c\'è un totale.';
    const bits = [`${man.value.toFixed(0)} fantapunti attesi in stagione`];
    if (man.expectedFm != null && man.expected != null) {
      bits.push(`${man.expectedFm.toFixed(2)} × ${man.expected.toFixed(1)}`);
    }
    if (man.expectedFmIsEstimate) bits.push('sulla STIMA');
    return short(bits.join(' · '));
  }

  /** A man with no measured season sorts last in both directions: he has no number, not a zero. */
  /** Le presenze misurate: chi non ne ha in questo listone sta in fondo - ignoto, non zero. */
  protected readonly byPv = (left: SquadMan, right: SquadMan): number =>
    (left.pv ?? -1) - (right.pv ?? -1);

  protected readonly byMv = (left: SquadMan, right: SquadMan): number =>
    (left.mv ?? -1) - (right.mv ?? -1);

  protected readonly byFm = (left: SquadMan, right: SquadMan): number =>
    (left.fm ?? -1) - (right.fm ?? -1);

  /**
   * La scala e non l'alfabeto: si ordina per il RANGO (0 = bandiera), invertito perché la freccia «alto
   * per primo» di questa tabella vuol dire «il migliore in cima», e sulla scala il migliore è lo zero.
   * Chi non ha gradino sta in fondo come ogni altro vuoto della tabella.
   */
  protected readonly byTitolarita = (left: SquadMan, right: SquadMan): number =>
    (titolaritaRank(right.titolarita) ?? 99) - (titolaritaRank(left.titolarita) ?? 99);

  protected readonly byExpected = (left: SquadMan, right: SquadMan): number =>
    (left.expected ?? -1) - (right.expected ?? -1);

  protected readonly byExpectedFm = (left: SquadMan, right: SquadMan): number =>
    (left.expectedFm ?? -1) - (right.expectedFm ?? -1);

  protected readonly byExpectedMv = (left: SquadMan, right: SquadMan): number =>
    (left.expectedMv ?? -1) - (right.expectedMv ?? -1);

  /** La costanza: chi non ha nemmeno un'ancora sta in fondo, come ogni altro vuoto di questa tabella. */
  protected readonly bySteady = (left: SquadMan, right: SquadMan): number =>
    (left.rating?.steady.share ?? -1) - (right.rating?.steady.share ?? -1);

  /**
   * La scala e non l'alfabeto, come per la titolarità: `oro` in testa, chi non ha parola in fondo.
   *
   * `scommessa` e `scarto` restano DUE gradini e non uno: il primo dice che non c'è misura, il
   * secondo che la misura c'è ed è bassa, e ordinarli insieme perderebbe esattamente la
   * differenza che li separa.
   */
  protected readonly byCategoria = (left: SquadMan, right: SquadMan): number =>
    (categoriaRank(right.category) ?? 99) - (categoriaRank(left.category) ?? 99);

  /** La sigla di tre caratteri della categoria, o null per una riga che il foglio non classifica. */
  protected categoriaShort(man: SquadMan): string | null {
    return isCategoria(man.category) ? CATEGORIA_SHORT[man.category] : null;
  }

  /** La frase intera coi due numeri: la sigla è un promemoria, il tooltip la spiegazione. */
  protected categoriaHint(man: SquadMan): string {
    return (
      categoriaNote(man.category, man.categoryBonus, man.categoryBars)
      ?? 'Il foglio non porta la categoria: è più vecchio della revisione 38, oppure il motore non '
        + 'gli prevede nemmeno le presenze. In tutt\'e due i casi è IGNOTO, che non è «scarto».'
    );
  }

  /**
   * Quanto è forte la parola, come CONTRASTO e non come colore - la stessa regola della titolarità.
   *
   * Qui la tentazione è più grossa perché le parole SONO colori (oro, argento, bronzo), ma la regola
   * dell'app è che il colore porta un significato e i dati vanno neutri: tre tinte metalliche su una
   * colonna di dati direbbero «premio» dove c'è una misura. Si legge dal peso, e il colore si
   * aggiunge solo se lo chiede lui.
   */
  protected categoriaTone(man: SquadMan): string {
    const rank = categoriaRank(man.category);
    if (rank == null) return 'text-muted';
    if (rank <= 1) return 'font-semibold';
    if (rank >= 4) return 'text-muted';
    return '';
  }

  /** La sigla di tre caratteri, o null per uno stato che il foglio non porta. */
  protected titolaritaShort(man: SquadMan): string | null {
    return isTitolarita(man.titolarita) ? TITOLARITA_SHORT[man.titolarita] : null;
  }

  /** La parola intera, la promessa e i due numeri: la sigla non spiega, il tooltip sì. */
  protected titolaritaHint(man: SquadMan): string {
    return (
      titolaritaNote(man.titolarita, man.titolaritaPlay, man.minutesNext)
      ?? 'Il foglio non porta il gradino: nessuna partita sua è misurata, oppure il foglio non porta '
        + 'l’undici tipo che lo decide (prima della revisione 35, o costruito senza schermo). In '
        + 'tutt’e due i casi è IGNOTO e non «riserva»: quella è un’affermazione sul calcio che gioca.'
    );
  }

  /**
   * Quanto è forte la parola, come CONTRASTO e non come colore.
   *
   * La regola dell'app è che il colore porta un significato («rosso = pericolo», i dati vanno neutri),
   * quindi sei tinte su una scala ordinale direbbero «allarme» dove c'è solo una riserva. La scala si
   * legge dal peso: i due gradini alti in grassetto, i due bassi smorzati, i due di mezzo normali.
   */
  protected titolaritaTone(man: SquadMan): string {
    const rank = titolaritaRank(man.titolarita);
    if (rank == null) return 'text-muted';
    if (rank <= 1) return 'font-semibold';
    if (rank >= 4) return 'text-muted';
    return '';
  }

  /** What P is, said once in its header: a number of matches needs the calendar it is out of. */
  protected readonly expectedHeader = computed(() => {
    const rounds = this.valuation.sheetFor(this.platform())?.matchdays_target;
    return short(
      `Partite attese A VOTO dal motore${rounds ? ` su ${rounds} giornate` : ''}: «~» è la stima, `
        + 'vuoto vuol dire ignoto.',
    );
  });

  /** What FM att. is: the engine's number, and the fallback it declares for who it cannot price. */
  protected readonly expectedFmHeader = short(
    'Fantamedia ATTESA dal motore per la stagione che viene: la FM accanto dice quanto ha fatto, '
      + 'questa quanto ci si aspetta. «~» è la stima.',
  );

  /** The expected base vote, and the bonus rate that separates it from the expected fantamedia. */
  protected expectedMvHint(man: SquadMan): string {
    if (man.expectedMv == null) {
      return man.expectedFm == null
        ? 'Il motore non lo valuta: ignoto, mai zero.'
        : 'Senza un ruolo il bonus a presenza non è ricavabile, quindi il foglio non la porta.';
    }
    const bonus = man.expectedFm == null ? null : man.expectedFm - man.expectedMv;
    return short(
      `${man.expectedMv.toFixed(2)} di media voto attesa`
        + (bonus == null ? '' : ` · ${bonus >= 0 ? '+' : ''}${bonus.toFixed(2)} di bonus a presenza`)
        + (man.expectedFmIsEstimate ? ' · sulla STIMA della fantamedia' : '')
        + this.rank(man, 'expectedMv'),
    );
  }

  /** ...and on the row: the number, and - per una stima - la parola che il toolkit le ha scritto. */
  protected expectedFmHint(man: SquadMan): string {
    if (man.expectedFm == null) return 'Il motore non lo valuta e non offre una stima: ignoto, mai zero.';
    if (!man.expectedFmIsEstimate) {
      return short(
        `${man.expectedFm.toFixed(2)} di fantamedia attesa dal motore${this.rank(man, 'expectedFm')}`,
      );
    }
    return short(
      `STIMA ${man.expectedFm.toFixed(2)}`
        + (man.estimateBasis ? ` · base «${man.estimateBasis}»` : '')
        + (man.estimateNote ? ` · ${man.estimateNote}` : '')
        + this.rank(man, 'expectedFm'),
    );
  }

  /** ...and on the row: the number, what it is out of, and whether it is the estimate. */
  protected expectedHint(man: SquadMan): string {
    if (man.expected == null) return 'Il motore non lo prevede: ignoto, che non vuol dire zero.';
    const rounds = this.valuation.sheetFor(this.platform())?.matchdays_target;
    return short(
      `${man.expected.toFixed(1)} partite a voto attese${rounds ? ` su ${rounds}` : ''}`
        + (man.expectedIsEstimate ? ' · è la STIMA, il motore non riesce a valutarlo' : '')
        // LA COPPA sta QUI e non in una colonna sua: è una correzione MISURATA a questo numero, e il
        // numero è quello che il gate possiede - quindi si affianca, si spiega, e non lo riscrive. È
        // anche l'unico posto che sa su quale calendario contare le giornate.
        + this.cupPenalty(man),
    );
  }

  /**
   * «− 2,4 per la Coppa d'Asia 2027» — o niente, che è il caso normale.
   *
   * Il numero è LETTO dal foglio (`desc_pv_cup`) e la sottrazione non si rifà qui: il coefficiente è una
   * misura e il tappo che impedisce a un riservista di perdere più giornate di quante ne avrebbe giocate
   * sta nella funzione che l'ha misurato (`engine/cups.py`).
   */
  private cupPenalty(man: SquadMan): string {
    if (!man.cup || man.pvCup == null || man.expected == null) return '';
    const lost = man.expected - man.pvCup;
    if (lost <= 0.05) return '';
    return ` · −${lost.toFixed(1)} per ${man.cup}, che si gioca in mezzo al campionato`
      + (man.cupRounds ? ` (${man.cupRounds.toFixed(1)} giornate dentro la finestra)` : '');
  }

  /**
   * The star columns sort on the 0-99 behind them, never on the stars: half a star is a real gap.
   *
   * Built ONCE, not per call: a `[nzSortFn]` that returns a new closure on every read makes nz-th see a
   * changed input at every cycle, which re-sorts the table, which asks for another cycle - measured at
   * ~34 change-detection passes a second with nobody touching the page.
   */
  private readonly ratingSorters: Record<RatingKey, (left: SquadMan, right: SquadMan) => number> =
    Object.fromEntries(
      RATING_KEYS.map((key) => [
        key,
        (left: SquadMan, right: SquadMan) =>
          (left.rating?.[key].score ?? -1) - (right.rating?.[key].score ?? -1),
      ]),
    ) as Record<RatingKey, (left: SquadMan, right: SquadMan) => number>;

  protected byRating(key: RatingKey): (left: SquadMan, right: SquadMan) => number {
    return this.ratingSorters[key];
  }

  /**
   * IL COLORE delle quattro colonne di fantamedia: buono, medio, scarso, a colpo d'occhio.
   *
   * Tre decisioni, e vanno lette insieme perché una sola di esse renderebbe la colonna una bugia comoda.
   *
   * DENTRO IL RUOLO. 6,20 di fantamedia è un ottimo portiere e un mediocre attaccante, quindi un colore
   * cross-ruolo dipingerebbe i ruoli e non i giocatori - la stessa lezione che il 16/08 ha rifatto
   * l'Overall. Il rango lo calcola `ValuationStore` sul LISTONE, non su queste righe.
   *
   * LA SCALA È QUELLA DELLE STELLINE (`toneOf`), non una sua: due scale sullo stesso numero finirebbero
   * per dire due cose diverse. Quindi il centro del listone resta NEUTRO - una tabella dove ogni numero è
   * colorato è una tabella che grida - e il rosso sta solo in fondo.
   *
   * IL NUMERO RESTA IL FATTO. Il colore è la lettura, e il tooltip dice sempre contro chi è presa:
   * senza il pool un percentile non vuol dire niente.
   */
  protected tone(man: SquadMan, key: ToneKey): string {
    const score = man.tones[key];
    // Nessun posto nel ruolo = nessun colore. `toneOf(null)` risponderebbe `text-muted`, che su una cella
    // con un numero dentro lo sbiadirebbe come se fosse una stima.
    return score == null ? '' : toneOf(score);
  }

  /** Che cosa sono le Pv, e di QUALE stagione: una presenza senza il suo calendario non è confrontabile. */
  protected readonly pvHeader = computed(() => short(
    `Partite a VOTO in ${this.measuredOn()}: quante volte ha preso un voto, che è il denominatore delle `
      + 'due medie accanto. Zero vuol dire quotato e mai a voto - un fatto - mentre un trattino vuol dire '
      + 'che in questo listone non esiste una stagione misurata: ignoto, mai zero.',
  ));

  /** ...e sulla riga, la stessa cosa detta del singolo: le tre situazioni sono tre fatti diversi. */
  protected pvHint(man: SquadMan): string {
    if (man.pv == null) return short(`Nessuna stagione misurata in ${this.measuredOn()}: ignoto, mai zero.`);
    if (man.pv === 0) {
      return short(`Quotato in ${this.measuredOn()} e mai a voto: le due medie accanto non esistono, `
        + 'e non sono uno zero.');
    }
    return short(`${man.pv} partite a voto in ${this.measuredOn()}`
      + (man.expected != null ? ` · il motore gliene prevede ${Math.round(man.expected)}` : ''));
  }

  /** Il percentile in parole, per la coda del tooltip. Vuoto quando non c'è un posto da dichiarare. */
  protected rank(man: SquadMan, key: ToneKey): string {
    const score = man.tones[key];
    if (score == null) return '';
    const pool = this.valuation.rolePool().get(`${this.platform()}|${man.role}`);
    const among = ROLE_POOL_WORD[man.role] ?? 'quotati del suo ruolo';
    return ` · ${Math.round(score)}/99 fra i ${pool ?? ''}${pool ? ' ' : ''}${among} del listone`;
  }

  /** The real-role cell: when it was observed, and which of the codes the typical eleven would use. */
  protected codesHint(man: SquadMan): string {
    const bits: string[] = [];
    if (man.codesOn) bits.push(`osservato il ${man.codesOn.split('-').reverse().join('/')}`);
    bits.push(man.place ? `nella formazione tipo gioca da ${man.place}` : 'non è nella formazione tipo');
    return short(bits.join(' · '));
  }

  /**
   * What the two measured cells are worth, and WHY one is empty - the three cases are different facts.
   *
   * No row at all: he played that season somewhere this listone does not count. A row with zero
   * appearances: he was quoted and never got a vote, so he has no average - which is not an average of
   * zero. Otherwise the number, with the appearances it rests on beside it.
   */
  /**
   * La costanza sulla riga: la frase che `player-ratings` ha già costruito, e non una seconda.
   *
   * Porta il campione, la finestra, la mediana del suo ruolo e - quando il numero non è tutto suo -
   * l'ancora con cui è stato completato: è la stessa nota che il simbolo di varianza si portava dietro
   * finché la costanza non aveva una colonna.
   */
  protected steadyHint(man: SquadMan): string {
    const steady = man.rating?.steady;
    if (!steady) return 'In calcolo.';
    if (steady.share == null) {
      return short('Nessuna partita misurata e nessuna ancora del ruolo: ignoto, mai zero.');
    }
    return short(steady.note);
  }

  protected measuredHint(man: SquadMan, key: 'fm' | 'mv'): string {
    if (man.pv === 0) return short(`Mai a voto in ${this.measuredOn()}: non ha una media, che non è zero.`);
    if (man.fm == null && man.mv == null) {
      return short(`Nessuna stagione misurata in ${this.measuredOn()}: ignoto, mai zero.`);
    }
    const played = man.pv != null ? `${man.pv} presenze` : 'presenze ignote';
    return short(`${this.measuredOn()} · ${played}${this.rank(man, key)}`);
  }
}
