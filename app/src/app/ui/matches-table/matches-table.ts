import { booleanAttribute, Component, computed, inject, input, output, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle, ScoringConfig } from '../../core/bundle';
import { Platform } from '../../core/players-store';
import { TITOLARITA_LADDER, Titolarita, titolaritaNote, titolaritaRank } from '../../core/titolarita';
import { ValuationStore } from '../../core/valuation-store';
import { BonusKind, BonusRow, bonusesOf, spellOf } from '../../core/match-bonuses';
import { ColumnSlot, MatchCell, PlayerLine } from '../../core/players-store';
import { BonusMark } from '../bonus-mark/bonus-mark';
import { ClubCrest } from '../club-crest/club-crest';
import { MatchDetail } from '../match-detail/match-detail';
import { PlayerFlags } from '../player-flags/player-flags';
import { RoleBadge } from '../role-badge/role-badge';
import { RoleSet } from '../role-set/role-set';
import { SpellMark } from '../spell-mark/spell-mark';
import { TipTone, matchTip } from './match-tip';
import { lazyRows } from '../../core/lazy-rows';
import { KIND_ICON, KIND_LABEL, STATE_ICON, voteClass, voteText } from './vocabulary';

/**
 * QUELLO CHE UNA CELLA MARCA: gol, rigori segnati, assist - gli stessi eventi che marcava prima, coi
 * marchi della CARD (operatore, 06/09/2026: «riguardo ai gol e agli assist, utilizza le stesse icone
 * utilizzate nella card di dettaglio dei calciatori»).
 *
 * Prima la cella disegnava un BERSAGLIO per i gol, che nel vocabolario della card è il RIGORE, e una
 * `share-alt` per l'assist, che nella card è una scarpetta: due pagine che disegnavano due cose diverse
 * per lo stesso fatto, cioè esattamente quello che `ui/bonus-mark` esiste per impedire. Ora il marchio
 * viene da lì e il gol torna a essere un pallone.
 *
 * LO STESSO INSIEME DI PRIMA e non tutti i bonus: cartellini, autogol e i due del portiere non erano
 * marcati e restano dove sono già leggibili - il tooltip della cella e la card - perché una cella è
 * larga 48px da compatti e tre marchi la riempiono. Quello che cambia è il DISEGNO, non cosa dice.
 */
const CELL_MARKS = new Set<BonusKind>(['goal', 'pen-scored', 'assist']);

/** Da quale gradino in giu' il nome si smorza: `riserva`, cioe' l'ultimo. Vedi `faint`. */
const FAINT_FROM = TITOLARITA_LADDER.indexOf('riserva');

/**
 * The last matches of a list of men: one column per round (or per week), one cell per match.
 *
 * ONE component because it is ONE table: the consultation view draws it for the listone behind its
 * filter bar, the squads view for one club's rosa, and the vocabulary of the cells - what a colour
 * means, what an icon means, what the tooltip says - has to be the same object in both. The rows and
 * the columns are built together by `PlayersStore.matchTable`, so a header can never describe a
 * different round than the cells under it.
 */
@Component({
  selector: 'ui-matches-table',
  templateUrl: './matches-table.html',
  imports: [
    BonusMark,
    ClubCrest,
    MatchDetail,
    NzIconModule,
    NzModalModule,
    NzTableModule,
    NzTooltipModule,
    PlayerFlags,
    RoleBadge,
    RoleSet,
    SpellMark,
  ],
  host: { class: 'block' },
})
export class MatchesTable {
  private readonly bundle = inject(Bundle);
  private readonly valuation = inject(ValuationStore);

  readonly lines = input.required<PlayerLine[]>();
  readonly columns = input.required<ColumnSlot[]>();
  readonly crests = input<Record<string, string>>({});
  /**
   * QUALE LISTONE, che e' quello che rende leggibile il gradino di titolarita': la stessa parola su due
   * piattaforme e' due previsioni diverse (calendari diversi, perimetri diversi), quindi una colonna
   * che non sapesse quale sta guardando ne mostrerebbe una a caso.
   */
  readonly platform = input<Platform>('default');
  /**
   * IL CLICK SUL NOME APRE LA CARD (operatore, 10/09/2026: «quando clicco sul nome del calciatore
   * mostrami la sua card di dettaglio»). La tabella non apre niente da se': emette l'IDENTITA' e la
   * pagina decide, come fa gia' `ui/squad-table` - due tabelle che aprissero due card sarebbero due
   * letture degli stessi `engine_*`.
   */
  readonly pick = output<number>();
  /** A list of one club does not repeat the club on every row. */
  readonly showClub = input(true);
  /**
   * LA VERSIONE COMPATTA, chiesta dall'operatore per la vista SQUADRE (06/09/2026, subito dopo l'altra
   * tabella: «compatta anche la tabella con gli ultimi risultati»).
   *
   * Le leve sono le stesse dell'altra e per la stessa ragione misurata: il PADDING e il CARATTERE stanno
   * in `ng-zorro.css` sotto UNA classe che le due tabelle condividono (`.table-dense`), le LARGHEZZE
   * qui. Quello che questa tabella ha in piu' e' che una cella e' alta DUE righe - il voto e la striscia
   * delle iconcine - quindi la riga non scende come la' (49px contro 39px di partenza) e l'altezza si
   * guadagna sul padding.
   */
  readonly dense = input(false, { transform: booleanAttribute });
  /**
   * LE RIGHE ARRIVANO SCORRENDO, senza paginazione (operatore, 17/08/2026): le prime 60 e poi 60 per volta
   * quando lo scorrimento arriva al fondo. La riga sotto la tabella dice quante se ne vedono su quante.
   */
  protected readonly lazy = lazyRows(this.lines);

  protected readonly kindIcon = KIND_ICON;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly stateIcon = STATE_ICON;

  /**
   * The scoring config, read here rather than passed in.
   *
   * The detail panel prices a match's events, and what a goal is worth is a fact about the CHAMPIONSHIP
   * (`config/scoring_config.json`, read by the toolkit and the engine too), not about the view that
   * happens to draw the table. `Bundle` caches it, so a second table costs nothing.
   */
  protected readonly scoring = signal<ScoringConfig | null>(null);


  /**
   * The name column plus the three narrow ones, then a column per match - and `y`, which is what keeps
   * the column names in view while the list scrolls: ng-zorro's own fixed header (two tables), because
   * a `position: sticky` on the th anchors itself to the scrolling container and leaves with it.
   */
  /**
   * LE LARGHEZZE DELLE COLONNE, in un posto solo: il template le BINDA e `minWidth` le somma.
   *
   * Prima erano scritte due volte - `nzWidth="190px"` nel template e un `490` in `minWidth` che era la
   * loro somma ricopiata a mano - quindi la larghezza minima e le colonne potevano finire per non essere
   * d'accordo (e per le colonne delle partite lo erano gia': 62 contro 58 e 92). Una definizione, due
   * lettori: e' la stessa cura che `SQUAD_COLUMNS` ha per l'altra tabella.
   *
   * I valori compatti sono MISURATI: una cella di partita porta un voto (~20px a 11px di carattere) e
   * fino a tre iconcine da 10px, quindi 48 e non meno; il nome tiene un cognome intero e va per ultimo,
   * perche' la sua colonna e' quella che si allunga se resta spazio.
   */
  protected readonly widths = computed(() => {
    const dense = this.dense();
    return {
      name: this.narrow() ? 176 : dense ? 150 : 190,
      // LA PAROLA INTERA e non la sigla di tre caratteri (operatore, 10/09/2026: «una colonna con le
      // etichette della titolarita' - titolarissimo, titolare, ballottaggio, ecc.»): `ballottaggio` e'
      // la piu' lunga delle sei e chiede ~78px a 11px di carattere, ~92px a 12px.
      titolarita: dense ? 86 : 104,
      role: dense ? 40 : 60,
      mantra: dense ? 76 : 110,
      club: dense ? 96 : 130,
      // UNA LARGHEZZA SOLA PER OGNI COLONNA DI PARTITA (operatore, 10/09/2026: «le colonne delle
      // partite devono avere larghezza fissa uguale»). Prima erano DUE - 48 per una giornata nuda e
      // 66/92 per una con l'intestazione a due righe - quindi la stessa tabella aveva colonne di due
      // misure a seconda di quello che la testa aveva da dire, e le celle sotto (che sono identiche)
      // ballavano. Il numero e' quello che serve alla cosa piu' larga che la testa porta: `Sq.A  0`
      // e un modulo di sette caratteri (`3-4-1-2`).
      cell: dense ? 58 : 68,
      // Il CONFINE fra due stagioni: dieci pixel, quanto basta a vedersi come una giuntura e non come
      // una colonna vuota che qualcuno ha dimenticato di riempire.
      divider: dense ? 10 : 14,
    };
  });

  /**
   * DA DOVE COMINCIA OGNI COLONNA FISSA, in pixel: e' l'offset con cui si aggancia a sinistra.
   *
   * Sommato dalle STESSE larghezze che il template binda (`widths()`), quindi un aggancio non puo'
   * finire per non essere d'accordo con la colonna che sta ancorando - la stessa cura che `minWidth` ha
   * gia'. Non e' `nzLeft` di ng-zorro: quello e' nel template dal 06/09 e MISURATO oggi non produce
   * niente (`left: auto` sulla cella del nome, cioe' nessun aggancio), perche' calcola gli offset solo
   * quando la tabella gli passa anche `nzScroll` - che qui non c'e' per scelta.
   */
  protected readonly pinLeft = computed(() => {
    const width = this.widths();
    const name = 0;
    const titolarita = name + width.name;
    const role = titolarita + width.titolarita;
    const mantra = role + width.role;
    return { name, titolarita, role, mantra, club: mantra + width.mantra };
  });

  /**
   * Quanto sono larghe in tutto le colonne che NON sono partite: e' quello che resta fermo mentre le
   * giornate scorrono, e serve a decidere se agganciarle abbia senso. Sotto una certa larghezza del
   * contenitore le colonne fisse mangerebbero tutto lo spazio e non resterebbe niente da scorrere.
   */
  protected readonly pinnedWidth = computed(() => {
    const width = this.widths();
    return this.narrow()
      ? width.name
      : width.name + width.titolarita + width.role + width.mantra
        + (this.showClub() ? width.club : 0);
  });

  /**
   * La larghezza minima della TABELLA, che ora e' la larghezza del suo scorrimento: il contenitore
   * scorre in orizzontale e la tabella resta larga quanto le sue colonne (operatore, 10/09/2026: «se le
   * colonne delle ultime partite non entrano nel contenitore, rendiamo il contenitore scrollabile
   * orizzontalmente»). Prima scorreva la PAGINA nei due assi, cioe' per leggere l'ultima giornata si
   * portava di lato anche l'intestazione della pagina e il campetto: misurato a 1200px di finestra, il
   * documento sforava di 365px.
   */
  protected readonly minWidth = computed(() => {
    const width = this.widths();
    const fixed = this.narrow()
      ? width.name
      : width.name + width.titolarita + width.role + width.mantra
        + (this.showClub() ? width.club : 0);
    const cells = this.columns().reduce(
      (sum, one) => sum + (one.divider ? width.divider : width.cell),
      0,
    );
    return `${fixed + cells}px`;
  });

  /** A phone. Two things change: the table gives up the three narrow columns and folds them
   *  into the name, and the tooltip goes away - on a touch screen there is no hover, so it would
   *  only be a thing that appears over the panel the tap just opened. */
  protected readonly narrow = signal(false);

  /** The match the detail panel is showing, with the player it belongs to: a cell alone does
   *  not know whose it is, and the panel names him. */
  protected readonly selected = signal<{ cell: MatchCell; player: PlayerLine } | null>(null);

  /**
   * Which cell the pointer is on. The tooltip is driven from here instead of by hover alone, so a
   * CLICK can close it: otherwise it stays up over the panel it just opened.
   *
   * PORTA ANCHE LA CELLA e non solo la chiave, perche' il tooltip e' ora un TEMPLATE e non una
   * stringa: un template ne disegna UNO alla volta, quindi il modello e' quello della cella sotto il
   * puntatore. Il guadagno non e' solo di forma - prima `tooltip(cell)` veniva ricostruita per OGNI
   * cella a ogni giro di change detection (sessanta righe per una quarantina di colonne), adesso una
   * volta per la sola cella che si sta guardando.
   */
  protected readonly hovered = signal<{ key: string; cell: MatchCell } | null>(null);

  /**
   * L'ELENCO DEL TOOLTIP, per la cella sotto il puntatore (operatore, 10/09/2026: «le informazioni
   * devono essere visualizzate come un elenco evidenziando le cose positive e quelle negative con
   * effetti diversi»). Il modello sta in `match-tip.ts`, puro; qui si sceglie solo la cella.
   */
  protected readonly tip = computed(() => {
    const hovered = this.hovered();
    return hovered ? matchTip(hovered.cell, this.scoring()) : null;
  });

  constructor() {
    const narrow = matchMedia('(max-width: 700px)');
    this.narrow.set(narrow.matches);
    narrow.addEventListener('change', (event) => this.narrow.set(event.matches));
    // A missing scoring file must not take the table down with it: the panel then shows the events
    // without their points, which is less than the truth but never a wrong one.
    void this.bundle.scoring().then((scoring) => this.scoring.set(scoring)).catch(() => undefined);
  }

  /** The tooltip belongs to a MOUSE, and the pointer event says which one it is - a media query
   *  cannot: `(hover: none)` is read once, is wrong on a hybrid laptop, and did not stop the
   *  tooltip on an emulated phone. A finger opens the detail; only a mouse gets the hint. */
  protected onPointerEnter(event: PointerEvent, key: string, cell: MatchCell): void {
    if (event.pointerType === 'mouse') this.hovered.set({ key, cell });
  }

  protected open(cell: MatchCell, player: PlayerLine): void {
    this.hovered.set(null);
    this.selected.set({ cell, player });
  }

  /**
   * I marchi di una cella, dal lettore UNICO dei bonus (`core/match-bonuses.ts`): la stessa funzione che
   * legge la riga compatta della card e il pannello grande della partita, quindi una partita non può
   * portare due elenchi di eventi.
   */
  protected marksOf(cell: MatchCell): BonusRow[] {
    return bonusesOf(cell, this.scoring()).filter((one) => CELL_MARKS.has(one.kind));
  }

  /**
   * I DUE TRIANGOLINI DELLA CELLA: e' subentrato, e' uscito, tutt'e due o nessuno dei due.
   *
   * Dalla definizione UNICA (`spellOf`), che e' la stessa che legge la riga compatta della card: due
   * conti sullo stesso fatto finirebbero per dare a una partita due storie. Che «entrato E uscito»
   * oggi non si accenda mai non e' una scelta di disegno ma il limite del dato, ed e' scritto dove il
   * marchio si disegna (`ui/spell-mark`).
   */
  protected spellOf = spellOf;

  /**
   * IL GRADINO DI UN UOMO, letto e mai ricalcolato: lo decide il toolkit sull'undici tipo disegnato
   * (`engine/status.py`), e le dritte dell'operatore lo scavalcano dentro `ValuationStore`. Vuoto dove
   * il foglio non lo porta - e vuoto vuol dire IGNOTO, che e' la ragione per cui la riga di un uomo
   * senza gradino non viene smorzata: non sappiamo che sia una riserva.
   */
  protected rung(fcId: number): Titolarita | null {
    const word = this.valuation.rungOf(this.platform(), fcId)?.titolarita;
    return titolaritaRank(word) == null ? null : (word as Titolarita);
  }

  /**
   * Quanto e' forte la parola, come CONTRASTO e non come colore: la regola dell'app e' che il colore
   * porta un significato, quindi sei tinte su una scala ordinale direbbero «allarme» dove c'e' solo una
   * riserva. La stessa lettura che `ui/squad-table` da' alla sua sigla - una scala, un modo di leggerla.
   */
  protected rungTone(fcId: number): string {
    const rank = titolaritaRank(this.rung(fcId));
    if (rank == null) return 'text-muted';
    if (rank <= 1) return 'font-semibold';
    if (rank >= 4) return 'text-muted';
    return '';
  }

  /** La parola intera, la promessa che porta e i due numeri da cui esce: la colonna non spiega, questo si'. */
  protected rungHint(fcId: number): string {
    const one = this.valuation.rungOf(this.platform(), fcId);
    return (
      titolaritaNote(one?.titolarita, one?.titolaritaPlay ?? null, one?.minutesNext ?? null)
      ?? 'Il foglio non porta il gradino: nessuna partita sua è misurata, oppure il foglio non '
        + 'porta l’undici tipo che lo decide. In tutt’e due i casi è IGNOTO e non «riserva»: '
        + 'quella sarebbe un’affermazione sul calcio che gioca.'
    );
  }

  /**
   * IL NOME SMORZATO di chi il foglio chiama `riserva` (operatore, 10/09/2026: «rendiamo meno evidenti
   * i nomi dei calciatori che sono riserve o peggio»).
   *
   * DA `riserva` IN GIU', che oggi vuol dire `riserva` e basta: e' l'ultimo gradino della scala, quindi
   * «o peggio» non ha nessuno sotto - `panchina` e' un gradino SOPRA e resta in chiaro. La soglia e' una
   * parola sola da cambiare se l'operatore vorra' anche quella.
   *
   * E UN UOMO SENZA GRADINO NON SI SMORZA: «vuoto = ignoto, mai riserva» - un foglio senza undici tipo,
   * o un uomo di cui non e' misurata una partita, non e' un uomo che non gioca, e smorzarlo sarebbe
   * un'affermazione sul calcio che nessuno ha fatto.
   */
  protected faint(fcId: number): boolean {
    const rank = titolaritaRank(this.rung(fcId));
    return rank != null && rank >= FAINT_FROM;
  }

  /** Se la colonna in quella posizione e' un CONFINE e non una partita. */
  protected divider(index: number): boolean {
    return !!this.columns()[index]?.divider;
  }

  /**
   * QUALE dei due confini e', perche' si disegnano diversi (operatore, 11/09/2026).
   *
   * Letto dalla COLONNA e non dedotto dal testo del titolo: due letture della stessa cosa finirebbero
   * per dipingere la testa di un colore e la cella di un altro, e la colonna si spezzerebbe a meta'
   * della tabella.
   */
  protected breakKind(index: number): 'season' | 'coach' | null {
    return this.columns()[index]?.breakKind ?? null;
  }

  /** True when the cell has no number at all and is drawn as an icon only. */
  protected iconOnly(cell: MatchCell): boolean {
    // `no_data` keeps the dot: there is no reason to draw, only an absence of measurement.
    return (
      cell.state !== 'played' &&
      cell.state !== 'no_data' &&
      cell.vote == null &&
      cell.providerRating == null
    );
  }

  protected stateClass(cell: MatchCell): string {
    return cell.state === 'injured' ? 'text-warning' : 'text-muted';
  }

  /** Il numero della cella e il suo inchiostro: dal VOCABOLARIO, che li possiede da quando la card
   *  di un calciatore disegna le stesse partite in riga compatta. Il template chiama questi. */
  protected voteText = voteText;
  protected voteClass = voteClass;

  /**
   * L'EFFETTO DI UNA RIGA DEL TOOLTIP: il colore E un riquadro tenue, cioe' due canali e non uno.
   *
   * Il verso lo dichiara il modello (`TipTone`, che per un evento viene da `BonusRow.good`); qui si
   * traduce in classi e basta. Il fondo esiste perche' l'operatore ha chiesto «effetti diversi» e non
   * «colori diversi»: il segno dei punti (`+3` contro `-0.5`) e il riquadro dicono la stessa cosa
   * anche a chi il verde e il rosso non li distingue.
   */
  protected toneClass(tone: TipTone): string {
    switch (tone) {
      case 'good':
        return 'bg-success/10 text-success';
      case 'bad':
        return 'bg-danger/10 text-danger';
      case 'warn':
        return 'text-warning';
      case 'muted':
        return 'text-muted';
      default:
        return 'text-fg';
    }
  }
}
