import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
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
import { ClassicRole, Platform } from '../../core/players-store';
import { SquadMan, ValuationStore } from '../../core/valuation-store';
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
  { key: 'expectedFm', label: 'FM att.', width: 62 },
  { key: 'expectedMv', label: 'MV att.', width: 62 },
  { key: 'surplus', label: 'Surplus', width: 64 },
  { key: 'value', label: 'Valore', width: 64 },
  { key: 'fvm', label: 'FVM', width: 58 },
  { key: 'mv', label: 'MV', width: 56 },
  { key: 'fm', label: 'FM', width: 56 },
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
    return short(
      `${man.fvm} di fantavalore · si muove a ogni evento, a differenza della Qt.I che è fissata prima `
        + 'della stagione',
    );
  }

  /**
   * Il SURPLUS, e chi non ne ha uno sta in fondo - ma il fondo qui è più basso di −1, perché il surplus
   * È NEGATIVO per chiunque valga meno del rimpiazzo del suo ruolo, e sono tanti. Con −1 come sentinella
   * un uomo senza numero finiva in mezzo alla lista, cioè in mezzo a gente misurata.
   */
  protected readonly bySurplus = (left: SquadMan, right: SquadMan): number =>
    (left.surplus ?? -Infinity) - (right.surplus ?? -Infinity);

  protected readonly byValue = (left: SquadMan, right: SquadMan): number =>
    (left.value ?? -1) - (right.value ?? -1);

  protected readonly surplusHeader = short(
    'SURPLUS del motore: i fantapunti che ti dà IN PIÙ del rimpiazzo del suo ruolo, su tutta la '
      + 'stagione. È la metrica con cui il toolkit ordina l\'asta.',
  );

  protected readonly valueHeader = short(
    'VALORE: i fantapunti che porta in tutto (fantamedia × presenze attese), senza sottrarre niente. '
      + 'Surplus = valore − rimpiazzo × presenze.',
  );

  protected surplusHint(man: SquadMan): string {
    if (man.surplus == null) return 'Il motore non lo valuta e non offre una stima: ignoto, mai zero.';
    return short(
      `${man.surplus >= 0 ? '+' : '−'}${Math.abs(man.surplus).toFixed(1)} fantapunti sopra il rimpiazzo`
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
        + (man.expectedFmIsEstimate ? ' · sulla STIMA della fantamedia' : ''),
    );
  }

  /** ...and on the row: the number, and - per una stima - la parola che il toolkit le ha scritto. */
  protected expectedFmHint(man: SquadMan): string {
    if (man.expectedFm == null) return 'Il motore non lo valuta e non offre una stima: ignoto, mai zero.';
    if (!man.expectedFmIsEstimate) return `${man.expectedFm.toFixed(2)} di fantamedia attesa dal motore`;
    return short(
      `STIMA ${man.expectedFm.toFixed(2)}`
        + (man.estimateBasis ? ` · base «${man.estimateBasis}»` : '')
        + (man.estimateNote ? ` · ${man.estimateNote}` : ''),
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
  protected measuredHint(man: SquadMan): string {
    if (man.pv === 0) return short(`Mai a voto in ${this.measuredOn()}: non ha una media, che non è zero.`);
    if (man.fm == null && man.mv == null) {
      return short(`Nessuna stagione misurata in ${this.measuredOn()}: ignoto, mai zero.`);
    }
    const played = man.pv != null ? `${man.pv} presenze` : 'presenze ignote';
    return short(`${this.measuredOn()} · ${played}`);
  }
}
