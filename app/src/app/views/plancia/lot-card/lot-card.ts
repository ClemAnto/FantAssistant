import { DecimalPipe } from '@angular/common';
import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';

import { CEILING_ALWAYS_SAFE, CEILING_ALWAYS_WRONG, Role, Verdict } from '../../../core/plancia';
import { Lot } from '../../../core/plancia-store';

/** One icon per verdict, and never a sentence: the shape has to read from across the table. */
const VERDICT_ICON: Record<Verdict, string> = {
  prendi: 'check-circle',
  aspetta: 'clock-circle',
  lascia: 'close-circle',
  ignoto: 'question-circle',
  // Il campanello, lo stesso marchio che la riga porta accanto al nome: una cosa sola vista due volte.
  fermo: 'alert',
};

/**
 * The colour of a verdict. Amber for «wait» because it is a caution and not a danger; red is kept
 * where the house rule keeps it, for the one verdict that says «this costs you points».
 */
const VERDICT_TONE: Record<Verdict, string> = {
  prendi: 'text-success',
  aspetta: 'text-warning',
  lascia: 'text-danger',
  ignoto: 'text-muted',
  fermo: 'text-danger',
};

const VERDICT_RAIL: Record<Verdict, string> = {
  prendi: 'bg-success',
  aspetta: 'bg-warning',
  lascia: 'bg-danger',
  ignoto: 'bg-border',
  fermo: 'bg-danger',
};

export const ROLE_TONE: Record<Role, string> = {
  P: 'bg-role-keeper',
  D: 'bg-role-defence',
  C: 'bg-role-midfield',
  A: 'bg-role-attack',
};

/**
 * THE LOT IN AUCTION: one card, one question — «lo prendo, e fino a quanto?».
 *
 * The hierarchy is the answer's: the verdict is an icon and a colour, the band is the number, and the
 * ALTERNATIVE sits under it because an automatic choice must be doubtable - it is what you would buy
 * instead, with its price, so the verdict can be checked instead of believed.
 *
 * The band is drawn on the BUDGET's own scale, with the two lines the measurement can state flat: under
 * 10% one is never wrong, over 20% one is wrong in any slot. Everything between them is a band and not
 * a figure, because the thresholds are measured on ten seasons with 3-8 agreeing (§27.6).
 */
@Component({
  selector: 'plancia-lot-card',
  templateUrl: './lot-card.html',
  imports: [DecimalPipe, FormsModule, NzIconModule, NzInputNumberModule, NzTooltipModule],
  host: { class: 'block' },
})
export class LotCard {
  readonly lot = input<Lot | null>(null);
  /**
   * What the table is at, and it is EDITABLE here rather than in a bar of its own.
   *
   * It is the only thing touched during an auction, and it is a fact about the lot: a second place to
   * type it would be a second answer to «what is this costing», and the page's own footer collided with
   * the app's fixed bottom bars anyway.
   */
  readonly price = model(0);
  readonly budget = input.required<number>();
  /** What is left in my purse: the ceiling can never be higher than this. */
  readonly room = input.required<number>();
  readonly urnLeft = input(0);
  readonly tail = input(0);
  readonly myMissing = input<number[]>([]);

  protected readonly icon = computed(() => VERDICT_ICON[this.lot()?.advice.verdict ?? 'ignoto']);
  protected readonly tone = computed(() => VERDICT_TONE[this.lot()?.advice.verdict ?? 'ignoto']);
  protected readonly rail = computed(() => VERDICT_RAIL[this.lot()?.advice.verdict ?? 'ignoto']);
  protected readonly roleTone = computed(() => ROLE_TONE[this.lot()?.block.role ?? 'P']);

  /** Where the two flat lines fall on the bar, so the scale explains itself without a legend. */
  protected readonly safeAt = computed(() => `${CEILING_ALWAYS_SAFE * 100}%`);
  protected readonly wrongAt = computed(() => `${CEILING_ALWAYS_WRONG * 100}%`);

  /** The band and the table price, as a share of the budget - the bar's own coordinate. */
  protected readonly bandLeft = computed(() => this.pct(this.lot()?.advice.band?.low));
  protected readonly bandWidth = computed(() => {
    const band = this.lot()?.advice.band;
    if (!band) return '0%';
    return `${Math.max(1, ((band.high - band.low) / Math.max(1, this.budget())) * 100)}%`;
  });
  protected readonly priceLeft = computed(() => this.pct(this.lot()?.price));

  private pct(value: number | null | undefined): string {
    if (value == null || !(this.budget() > 0)) return '0%';
    return `${Math.min(100, Math.max(0, (value / this.budget()) * 100))}%`;
  }
}
