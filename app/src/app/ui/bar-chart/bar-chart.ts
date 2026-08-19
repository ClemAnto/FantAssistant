import { Component, computed, input } from '@angular/core';

/** One bar, as the caller states it. The component knows nothing else about what it draws. */
export interface Bar {
  label: string;
  value: number;
  /** A CSS colour, and the caller's business: this component owns no palette. */
  fill: string;
  /** What the bar says in words, for its tooltip. The label alone when nothing is given. */
  hint?: string;
}

/** How tall a bar may get, in the SVG's own units, and how much room the axis line needs under it. */
const HEIGHT = 100;
const BASELINE = 4;

/**
 * A column chart drawn as inline SVG. No dependency, and no knowledge of the domain.
 *
 * The counterpart of `ui-pie`, and it exists because a DISTRIBUTION is not a composition: a doughnut
 * answers «how is the whole divided», a histogram answers «what shape does it have», and the second
 * question is the one a scale has to be judged on - a heap at one end is a scale that is not saying
 * anything, and that is invisible in a pie.
 *
 * The two rules the arithmetic forces are handled here rather than discovered later: with every value at
 * ZERO nothing is drawn at all (a flat row of nothing would read as a flat distribution, which is a
 * different fact), and a bar whose value rounds to less than a pixel still gets a visible stub, because
 * «one man» and «no men» must not look the same.
 */
@Component({
  selector: 'ui-bars',
  templateUrl: './bar-chart.html',
  host: { class: 'block' },
})
export class BarChart {
  readonly bars = input.required<readonly Bar[]>();
  /** What one bar counts, for the tooltip: «12 calciatori». Singular is the caller's problem. */
  readonly unit = input<string>('');

  protected readonly total = computed(() => this.bars().reduce((sum, one) => sum + one.value, 0));
  protected readonly peak = computed(() => Math.max(0, ...this.bars().map((one) => one.value)));

  /** The bars with their geometry, or an empty list when there is nothing to draw. */
  protected readonly drawn = computed(() => {
    const bars = this.bars();
    const peak = this.peak();
    if (!bars.length || peak <= 0) return [];
    const slot = 100 / bars.length;
    const width = slot * 0.72;
    return bars.map((one, at) => {
      // Il moncone: un uomo e nessun uomo non devono somigliarsi, quindi sotto la soglia visibile si
      // disegna comunque una tacca invece di niente.
      const height = one.value > 0 ? Math.max(1.5, (one.value / peak) * HEIGHT) : 0;
      return {
        ...one,
        x: at * slot + (slot - width) / 2,
        width,
        height,
        y: HEIGHT - height,
        share: this.total() ? one.value / this.total() : 0,
      };
    });
  });

  protected readonly height = HEIGHT;
  protected readonly baseline = HEIGHT + BASELINE;
}
