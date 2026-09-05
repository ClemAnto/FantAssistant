import { Component, computed, input } from '@angular/core';

import { ScoringConfig } from '../../core/bundle';
import { BonusRow, bonusesOf } from '../../core/match-bonuses';
import { MatchCell, PlayerRow } from '../../core/players-store';
import { BonusMark } from '../bonus-mark/bonus-mark';
import { ClubCrest } from '../club-crest/club-crest';
import { STATE_LABEL } from '../matches-table/vocabulary';
import { RoleBadge } from '../role-badge/role-badge';
import { RoleSet } from '../role-set/role-set';

export type { BonusRow } from '../../core/match-bonuses';

@Component({
  selector: 'ui-match-detail',
  imports: [BonusMark, ClubCrest, RoleBadge, RoleSet],
  templateUrl: './match-detail.html',
})
export class MatchDetail {
  readonly cell = input.required<MatchCell>();
  readonly player = input.required<PlayerRow>();
  readonly scoring = input.required<ScoringConfig | null>();
  readonly crests = input<Record<string, string>>({});

  /** Only OUR side has an id, so only our side can show its badge: of the opponent we hold the
   *  provider's name and nothing that identifies it. */
  protected readonly leftId = computed(() =>
    this.cell().home === false ? null : this.player().clubId,
  );
  protected readonly rightId = computed(() =>
    this.cell().home === false ? this.player().clubId : null,
  );

  /** Home on the left, always, so the score is read the way it is written. */
  protected readonly left = computed(() =>
    this.cell().home === false ? this.cell().opponent : this.cell().team,
  );
  protected readonly right = computed(() =>
    this.cell().home === false ? this.cell().team : this.cell().opponent,
  );
  protected readonly leftGoals = computed(() =>
    this.cell().home === false ? this.cell().goalsAgainst : this.cell().goalsFor,
  );
  protected readonly rightGoals = computed(() =>
    this.cell().home === false ? this.cell().goalsFor : this.cell().goalsAgainst,
  );

  /** The roster row already carries the codes: splitting the label again would be a second parsing. */
  protected readonly mantraCodes = computed(() => this.player().mantraCodes);

  /**
   * Gli eventi di questa partita che valgono qualcosa, dal lettore unico (`core/match-bonuses.ts`).
   *
   * Il conto se ne e' andato di qui il 05/09/2026, quando la riga compatta della card di un calciatore
   * ha chiesto la stessa lista: due conti sugli stessi eventi darebbero a una partita due fantavoti.
   */
  protected readonly bonuses = computed<BonusRow[]>(() => bonusesOf(this.cell(), this.scoring()));

  protected readonly totalBonus = computed(() =>
    this.bonuses().reduce((sum, row) => sum + (row.points ?? 0), 0),
  );

  protected readonly hasPoints = computed(() => this.bonuses().some((r) => r.points !== null));

  /** The arithmetic is shown AND checked against the stored fantavoto. If they disagree the
   *  panel says so instead of quietly showing the prettier of the two numbers. */
  protected readonly reconciliation = computed(() => {
    const cell = this.cell();
    if (cell.vote == null || cell.fantavoto == null || !this.hasPoints()) return null;
    const computedFv = cell.vote + this.totalBonus();
    const diff = computedFv - cell.fantavoto;
    return { computed: computedFv, stored: cell.fantavoto, matches: Math.abs(diff) < 0.01, diff };
  });

  protected number(value: number | null | undefined, decimals = 1): string {
    if (value == null) return '-';
    const text = value.toFixed(decimals);
    return value > 0 && decimals === 1 ? text : text;
  }

  protected signed(value: number): string {
    return (value > 0 ? '+' : '') + value.toFixed(1);
  }

  protected readonly stateLabel = computed(() => STATE_LABEL[this.cell().state]);
  protected readonly played = computed(() =>
    ['played', 'no_vote', 'no_data'].includes(this.cell().state),
  );
  protected readonly injuryLabel = computed(() => {
    const injury = this.cell().injury;
    if (!injury) return null;
    const day = (iso: string) => iso.split('-').reverse().join('/');
    const to = injury.to ? ` al ${day(injury.to)}` : ' (fine non nota)';
    return `${injury.detail ?? 'Infortunio'} - dal ${day(injury.from)}${to}`;
  });

  protected readonly dateLabel = computed(() => {
    const date = this.cell().date;
    return date ? date.split('-').reverse().join('/') : null;
  });
}
