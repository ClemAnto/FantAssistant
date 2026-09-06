import { booleanAttribute, Component, computed, inject, input, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle, ScoringConfig } from '../../core/bundle';
import { BonusKind, BonusRow, bonusesOf } from '../../core/match-bonuses';
import { ColumnSlot, MatchCell, PlayerLine } from '../../core/players-store';
import { short } from '../../core/tooltip';
import { BonusMark } from '../bonus-mark/bonus-mark';
import { ClubCrest } from '../club-crest/club-crest';
import { MatchDetail } from '../match-detail/match-detail';
import { PlayerFlags } from '../player-flags/player-flags';
import { RoleBadge } from '../role-badge/role-badge';
import { RoleSet } from '../role-set/role-set';
import { lazyRows } from '../../core/lazy-rows';
import { KIND_ICON, KIND_LABEL, STATE_ICON, STATE_LABEL, voteClass, voteText } from './vocabulary';

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

/** dd/mm/yyyy, because a date in a tooltip is read by a person and not by a parser. */
const it = (iso: string): string => iso.split('-').reverse().join('/');

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
  ],
  host: { class: 'block' },
})
export class MatchesTable {
  private readonly bundle = inject(Bundle);

  readonly lines = input.required<PlayerLine[]>();
  readonly columns = input.required<ColumnSlot[]>();
  readonly crests = input<Record<string, string>>({});
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
  protected readonly stateLabel = STATE_LABEL;

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
      role: dense ? 40 : 60,
      mantra: dense ? 76 : 110,
      club: dense ? 96 : 130,
      cell: dense ? 48 : 58,
      detail: dense ? 66 : 92,
      // Il CONFINE fra due stagioni: dieci pixel, quanto basta a vedersi come una giuntura e non come
      // una colonna vuota che qualcuno ha dimenticato di riempire.
      divider: dense ? 10 : 14,
    };
  });

  /** La larghezza minima, non uno scroller: scorre la PAGINA nei due assi (vedi `squad-table.minWidth`). */
  protected readonly minWidth = computed(() => {
    const width = this.widths();
    const fixed = this.narrow()
      ? width.name
      : width.name + width.role + width.mantra + (this.showClub() ? width.club : 0);
    const cells = this.columns().reduce(
      (sum, one) =>
        sum + (one.divider ? width.divider : one.detail || one.score ? width.detail : width.cell),
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

  /** Which cell the pointer is on. The tooltip is driven from here instead of by hover alone,
   *  so a CLICK can close it: otherwise it stays up over the panel it just opened. */
  protected readonly hovered = signal<string | null>(null);

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
  protected onPointerEnter(event: PointerEvent, key: string): void {
    if (event.pointerType === 'mouse') this.hovered.set(key);
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

  /** Se la colonna in quella posizione e' il CONFINE fra due stagioni e non una partita. */
  protected divider(index: number): boolean {
    return !!this.columns()[index]?.divider;
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
   * The hover: the match, what he did in it, and nothing else.
   *
   * Two lines at most (`TOOLTIP_MAX`, the operator's rule of 15/08/2026) - and it can afford to be
   * short because a CLICK opens the whole match: the panel behind it has the scoreline, the shape, the
   * fantavoto broken into its terms and why a vote is missing. A hover is for «which match is this?».
   */
  protected tooltip(cell: MatchCell): string {
    const parts: string[] = [];

    if (cell.state !== 'played') parts.push(STATE_LABEL[cell.state]);

    const fixture = cell.opponent
      ? cell.home === false
        ? `${cell.opponent} - ${cell.team}`
        : `${cell.team} - ${cell.opponent}`
      : cell.team;
    parts.push(
      cell.kind === 'league' && cell.matchday != null
        ? `${fixture}, ${cell.matchday}ª`
        : `${fixture} (${cell.competitionLabel})`,
    );
    if (cell.date) parts.push(it(cell.date));

    if (cell.state === 'played' || cell.state === 'no_vote') {
      parts.push(cell.minutes == null ? 'minuti ignoti' : `${cell.minutes}'`);
    }

    const events: string[] = [];
    if (cell.goals + cell.penScored) events.push(`${cell.goals + cell.penScored} gol`);
    if (cell.assists) events.push(`${cell.assists} assist`);
    if (cell.penMissed) events.push('rig. sbagliato');
    if (cell.ownGoals) events.push('autogol');
    if (cell.yellows) events.push('ammonito');
    if (cell.reds) events.push('espulso');
    if (events.length) parts.push(events.join(', '));

    if (cell.kind === 'league' && cell.fantavoto != null) {
      parts.push(`fantavoto ${cell.fantavoto.toFixed(1)}`);
    }
    if (cell.alsoInWeek) parts.push(`+${cell.alsoInWeek} nella stessa settimana`);

    return short(`${parts.join(' · ')} · clicca per il dettaglio`);
  }
}
