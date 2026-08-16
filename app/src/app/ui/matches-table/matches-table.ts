import { Component, computed, inject, input, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { Bundle, ScoringConfig } from '../../core/bundle';
import { ColumnSlot, MatchCell, PlayerLine } from '../../core/players-store';
import { short } from '../../core/tooltip';
import { ClubCrest } from '../club-crest/club-crest';
import { MatchDetail } from '../match-detail/match-detail';
import { PlayerFlags } from '../player-flags/player-flags';
import { RoleBadge } from '../role-badge/role-badge';
import { KIND_ICON, KIND_LABEL, STATE_ICON, STATE_LABEL } from './vocabulary';

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
    ClubCrest,
    MatchDetail,
    NzIconModule,
    NzModalModule,
    NzTableModule,
    NzTooltipModule,
    PlayerFlags,
    RoleBadge,
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
  /** Null = the whole list. A number paginates, which a listone of 900 men needs. */
  readonly pageSize = input<number | null>(null);

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

  protected readonly paginated = computed(() => this.pageSize() != null);

  /**
   * The name column plus the three narrow ones, then a column per match - and `y`, which is what keeps
   * the column names in view while the list scrolls: ng-zorro's own fixed header (two tables), because
   * a `position: sticky` on the th anchors itself to the scrolling container and leaves with it.
   */
  protected readonly scroll = computed(() => ({
    x: `${(this.narrow() ? 176 : this.showClub() ? 490 : 360) + this.columns().length * 62}px`,
    y: 'calc(100vh - 22rem)',
  }));

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

  /** The number in the cell, and it is NOT the same quantity in every cell:
   *  a league match carries the fantacalcio vote (or the calibrated synthetic one, marked
   *  `~`), while a cup or a friendly can only carry the provider's own 1-10 rating, marked
   *  `*` because it is a different scale. A dot means he has a row and nothing measurable. */
  protected voteText(cell: MatchCell): string {
    if (cell.kind === 'league') {
      if (cell.vote == null) return 's.v.';
      return (cell.voteSynthetic ? '~' : '') + cell.vote.toFixed(1).replace('.', ',');
    }
    if (cell.providerRating == null) return '·';
    return '*' + cell.providerRating.toFixed(1).replace('.', ',');
  }

  protected voteClass(cell: MatchCell): string {
    // The bands are calibrated on the fantacalcio vote. A provider rating is another scale,
    // so colouring it the same way would be a claim nobody measured: it stays neutral.
    if (cell.kind !== 'league') return 'text-muted';
    // Back to the original bands (the operator changed his mind on 09/08/2026), with one
    // addition: 5 and below is marked in red. That is an explicit negative verdict, which is
    // the one use the colour rule allows.
    if (cell.vote == null) return 'text-muted italic';
    if (cell.vote >= 7) return 'text-primary font-semibold';
    if (cell.vote >= 6) return 'text-fg';
    if (cell.vote > 5) return 'text-muted';
    return 'text-danger font-semibold';
  }

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
      parts.push(`fantavoto ${cell.fantavoto.toFixed(1).replace('.', ',')}`);
    }
    if (cell.alsoInWeek) parts.push(`+${cell.alsoInWeek} nella stessa settimana`);

    return short(`${parts.join(' · ')} · clicca per il dettaglio`);
  }
}
