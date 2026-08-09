import { Component, computed, input } from '@angular/core';

import { ScoringConfig, ScoringTerms } from '../../../core/bundle';
import { MatchCell, PlayerRow } from '../../../core/players-store';
import { STATE_LABEL } from '../players';
import { ClubCrest } from '../../../ui/club-crest/club-crest';
import { RoleBadge } from '../../../ui/role-badge/role-badge';

export interface BonusRow {
  label: string;
  count: number;
  /** Null when no scoring config was available: the event is still a fact, its value is not. */
  points: number | null;
}

@Component({
  selector: 'app-match-detail',
  imports: [ClubCrest, RoleBadge],
  templateUrl: './match-detail.html',
})
export class MatchDetail {
  readonly cell = input.required<MatchCell>();
  readonly player = input.required<PlayerRow>();
  readonly scoring = input.required<ScoringConfig | null>();

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

  protected readonly mantraCodes = computed(() =>
    this.player().mantra.split(/\s+/).filter(Boolean),
  );

  /** The terms of the CHAMPIONSHIP the match was played in, falling back to the default. The
   *  file exists exactly because a league may score differently. */
  private readonly terms = computed<ScoringTerms | null>(() => {
    const config = this.scoring();
    if (!config) return null;
    return { ...config.default, ...(config.leagues[this.cell().competition] ?? {}) };
  });

  protected readonly bonuses = computed<BonusRow[]>(() => {
    const cell = this.cell();
    const t = this.terms();
    const rows: BonusRow[] = [];
    const add = (label: string, count: number, value: number | undefined, sign: 1 | -1) => {
      if (!count) return;
      rows.push({ label, count, points: t && value != null ? sign * count * value : null });
    };

    add('Gol', cell.goals, t?.goal_bonus, 1);
    add('Rigori segnati', cell.penScored, t?.penalty_scored_bonus, 1);
    add('Assist', cell.assists, t?.assist_bonus, 1);
    add('Assist da fermo', cell.assistsSetPiece, t?.assist_set_piece_bonus, 1);
    add('Rigori sbagliati', cell.penMissed, t?.penalty_missed_malus, -1);
    add('Autogol', cell.ownGoals, t?.own_goal_malus, -1);
    add('Ammonizioni', cell.yellows, t?.yellow_card_malus, -1);
    add('Espulsioni', cell.reds, t?.red_card_malus, -1);

    if (cell.role === 'P') {
      add('Rigori parati', cell.penSaved, t?.penalty_saved_bonus_gk, 1);
      add('Gol subiti', cell.goalsConceded ?? 0, t?.goal_conceded_malus_gk, -1);
    }
    return rows;
  });

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
    const text = value.toFixed(decimals).replace('.', ',');
    return value > 0 && decimals === 1 ? text : text;
  }

  protected signed(value: number): string {
    return (value > 0 ? '+' : '') + value.toFixed(1).replace('.', ',');
  }

  protected readonly stateLabel = computed(() => STATE_LABEL[this.cell().state]);
  protected readonly played = computed(
    () => this.cell().state === 'played' || this.cell().state === 'no_vote',
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
