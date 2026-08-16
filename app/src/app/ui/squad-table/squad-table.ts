import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule, NzTableSortOrder } from 'ng-zorro-antd/table';
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
import { ClassicRole, Platform } from '../../core/players-store';
import { SquadMan, ToneKey, ValuationStore } from '../../core/valuation-store';
import { short } from '../../core/tooltip';
import { stored, storedList } from '../../core/view-state';
import { ClubCrest } from '../club-crest/club-crest';
import { PlayerFlags } from '../player-flags/player-flags';
import { RoleBadge } from '../role-badge/role-badge';
import { StarRating } from '../star-rating/star-rating';

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
 * Le colonne che si possono spegnere, con quanto occupano.
 *
 * `R` e `Nome` non sono qui perché non sono colonne opzionali: sono l'identità della riga, e una tabella
 * senza il nome non è una tabella più corta, è un'altra cosa.
 *
 * La LARGHEZZA sta accanto alla chiave e non nel template per una ragione misurata: la tabella scorre di
 * lato oltre una certa somma (`nzScroll.x`), e quella somma deve essere quella delle colonne ACCESE. Con
 * un numero fisso, spegnere metà tabella lasciava una barra orizzontale su una tabella che ci stava.
 */
export const SQUAD_COLUMNS: readonly { key: string; label: string; width: number }[] = [
  { key: 'mantra', label: 'Mantra', width: 78 },
  { key: 'club', label: 'Squadra', width: 130 },
  { key: 'codes', label: 'Ruolo reale', width: 100 },
  { key: 'expected', label: 'P (partite attese)', width: 48 },
  // Le quattro colonne di fantamedia sono più larghe delle cifre che portano: dentro ognuna il numero sta
  // in un riquadro colorato, e un riquadro più largo della colonna manderebbe la tabella a scorrere.
  { key: 'expectedFm', label: 'FM att.', width: 70 },
  { key: 'expectedMv', label: 'MV att.', width: 70 },
  { key: 'surplus', label: 'Surplus', width: 64 },
  // ...e lo stesso conto dall'ALTRO ZERO, affiancato invece che al posto suo: sono due domande («chi
  // conviene comprare» contro «quanto costa una giornata saltata») e nessuna delle due vince, quindi si
  // vedono insieme e si sceglie soltanto per quale ordinare (operatore, 16/08/2026, §21.1 della metrica).
  // MARGINE è il suo nome scelto dall'operatore: dice che è una differenza, e il tooltip dice da chi.
  { key: 'surplusFielded', label: 'Margine', width: 68 },
  // FANTAPUNTI e non «Valore» (operatore, 16/08/2026): la colonna vive accanto all'FVM, che è il
  // fantaVALORE di mercato, e i due si chiamavano uguale pur essendo uno in fantapunti e l'altro in
  // crediti. Il nome nuovo dice l'UNITÀ, che è la sola cosa che non si può confondere con un prezzo.
  // La chiave resta `value`: gli identificatori del codice stanno in inglese e non seguono l'etichetta.
  { key: 'value', label: 'Fantapunti', width: 92 },
  { key: 'fvm', label: 'FVM', width: 58 },
  { key: 'mv', label: 'MV', width: 64 },
  { key: 'fm', label: 'FM', width: 64 },
  ...RATING_KEYS.map((key) => ({ key, label: RATING_LABEL[key], width: 84 })),
];

/** Quello che una riga occupa comunque: il ruolo e il nome. */
const FIXED_WIDTH = 44 + 116;

/**
 * What a quoted man is worth, as a table: measured season, engine forecast, four readings.
 *
 * ONE component because it is ONE table: the squads view draws it for a club's rosa, the consultation
 * view for the whole listone, and the columns, the tooltips and the sort rules must be the same object
 * in both - two copies would be two definitions of «FM att.» under one heading, which is exactly the
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
    NzCollapseModule,
    NzRadioModule,
    NzSelectModule,
    NzTableModule,
    NzTooltipModule,
    PlayerFlags,
    RoleBadge,
    StarRating,
  ],
  host: { class: 'block' },
})
export class SquadTable {
  private readonly valuation = inject(ValuationStore);

  readonly rows = input.required<SquadMan[]>();
  /** Which listone these numbers are about: MV and FM are a fact about a CALENDAR, so it is said. */
  readonly platform = input.required<Platform>();
  /** A list of one club does not need a club column; the listone's own does. */
  readonly showClub = input(false);
  readonly crests = input<Record<string, string>>({});
  /** Null = the whole list, which is what a squad of 26 wants. A number paginates. */
  readonly pageSize = input<number | null>(null);

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
    + '6,20 di fantamedia è un ottimo portiere e un mediocre attaccante: un colore trasversale direbbe '
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

  /** Le colonne offerte: la squadra solo dove ha senso (una rosa sola non ha bisogno della colonna). */
  protected readonly columns = computed(() =>
    SQUAD_COLUMNS.filter((one) => one.key !== 'club' || this.showClub()));

  protected readonly visible = computed(() =>
    this.columns().filter((one) => !this.hidden().includes(one.key)).map((one) => one.key));

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
  protected readonly scroll = computed(() => {
    const width = this.columns()
      .filter((one) => this.shows(one.key))
      .reduce((sum, one) => sum + one.width, FIXED_WIDTH);
    return { x: `${width}px`, y: 'calc(100vh - 22rem)' };
  });

  protected readonly paginated = computed(() => this.pageSize() != null);

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
      + 'toolkit ordina l\'asta, ed è quella che il gate possiede.',
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
  protected readonly byMv = (left: SquadMan, right: SquadMan): number =>
    (left.mv ?? -1) - (right.mv ?? -1);

  protected readonly byFm = (left: SquadMan, right: SquadMan): number =>
    (left.fm ?? -1) - (right.fm ?? -1);

  protected readonly byExpected = (left: SquadMan, right: SquadMan): number =>
    (left.expected ?? -1) - (right.expected ?? -1);

  protected readonly byExpectedFm = (left: SquadMan, right: SquadMan): number =>
    (left.expectedFm ?? -1) - (right.expectedFm ?? -1);

  protected readonly byExpectedMv = (left: SquadMan, right: SquadMan): number =>
    (left.expectedMv ?? -1) - (right.expectedMv ?? -1);

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
        + (man.expectedIsEstimate ? ' · è la STIMA, il motore non riesce a valutarlo' : ''),
    );
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
  protected measuredHint(man: SquadMan, key: 'fm' | 'mv'): string {
    if (man.pv === 0) return short(`Mai a voto in ${this.measuredOn()}: non ha una media, che non è zero.`);
    if (man.fm == null && man.mv == null) {
      return short(`Nessuna stagione misurata in ${this.measuredOn()}: ignoto, mai zero.`);
    }
    const played = man.pv != null ? `${man.pv} presenze` : 'presenze ignote';
    return short(`${this.measuredOn()} · ${played}${this.rank(man, key)}`);
  }
}
