import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';

/** One slice, as the caller states it. The component knows nothing else about what it draws. */
export interface PieSlice {
  label: string;
  value: number;
  /** A CSS colour, and the caller's business: this component owns no palette. */
  fill: string;
  /** What the slice says in words, for its tooltip. The label alone when nothing is given. */
  hint?: string;
}

/**
 * Geometry, in the SVG's own units. Declared, like the trend strip's, so a change is one number.
 *
 * The box is a square of 100 with the pie centred in it: the legend is HTML beside the drawing rather
 * than text inside the picture, so it wraps, it can be read by a screen reader, and it does not scale
 * with the circle.
 */
const CENTRE = 50;
const RADIUS = 44;
/** The hole of the doughnut, as a share of the radius. Zero draws a full pie. */
const HOLE = 0.5;

/**
 * A pie - a doughnut, by default - drawn as inline SVG. No dependency, and no knowledge of the domain.
 *
 * The slices arrive already computed: this draws them and says what they are worth. The rules it does
 * own are the two the arithmetic forces, and they are handled here rather than discovered later - a
 * SINGLE slice at 100% degenerates as an arc (its start point is its end point, so the path draws
 * nothing) and is a `<circle>` instead, and a total of ZERO draws nothing at all, because a doughnut of
 * no men would otherwise look exactly like a doughnut of men in one band.
 */
@Component({
  selector: 'ui-pie',
  templateUrl: './pie-chart.html',
  imports: [DecimalPipe],
  host: { class: 'block' },
})
export class PieChart {
  readonly slices = input.required<readonly PieSlice[]>();
  /** How big the hole is, as a share of the radius. 0 = a full pie. */
  readonly hole = input<number>(HOLE);

  protected readonly centre = CENTRE;
  protected readonly radius = RADIUS;

  /** Bands with nothing in them are not drawn - a zero-width wedge is invisible and still a path. */
  private readonly drawn = computed(() => this.slices().filter((slice) => slice.value > 0));

  protected readonly total = computed(() =>
    this.slices().reduce((sum, slice) => sum + slice.value, 0),
  );

  protected readonly holeRadius = computed(() =>
    Math.max(0, Math.min(0.95, this.hole())) * RADIUS,
  );

  /** The one slice that covers the whole circle, when there is exactly one. Null otherwise. */
  protected readonly whole = computed(() => (this.drawn().length === 1 ? this.drawn()[0] : null));

  /**
   * The full circle, drawn as a STROKED ring rather than as two filled circles.
   *
   * A hole punched with a second circle would have to be painted the colour of whatever is behind the
   * chart, which this component cannot know - and the day the card behind it changes token, the hole
   * would stay the old colour. A ring has no background to guess.
   */
  protected readonly ringRadius = computed(() => (RADIUS + this.holeRadius()) / 2);
  protected readonly ringWidth = computed(() => RADIUS - this.holeRadius());

  /** Every slice as a wedge, from twelve o'clock and clockwise, which is how a pie is read. */
  protected readonly wedges = computed(() => {
    const total = this.total();
    if (total <= 0 || this.whole()) return [];
    let from = 0;
    return this.drawn().map((slice) => {
      const to = from + slice.value / total;
      const path = this.wedge(from, to);
      from = to;
      return { ...slice, path };
    });
  });

  /** What each slice is worth of the whole, for the legend. Zero total: no share to state. */
  protected share(value: number): number {
    const total = this.total();
    return total > 0 ? (value / total) * 100 : 0;
  }

  protected title(slice: PieSlice): string {
    const share = this.share(slice.value);
    return `${slice.hint ?? slice.label}: ${slice.value} · ${share.toFixed(1)}%`;
  }

  /** The path of one wedge, both bounds as a share of the turn. */
  private wedge(from: number, to: number): string {
    const outer = this.point(RADIUS, from);
    const outerEnd = this.point(RADIUS, to);
    const inner = this.holeRadius();
    // Which way round the arc goes: over half the circle SVG needs to be told, or it draws the short way.
    const large = to - from > 0.5 ? 1 : 0;
    if (inner <= 0) {
      return `M ${CENTRE} ${CENTRE} L ${outer.x} ${outer.y}`
        + ` A ${RADIUS} ${RADIUS} 0 ${large} 1 ${outerEnd.x} ${outerEnd.y} Z`;
    }
    const innerEnd = this.point(inner, to);
    const innerStart = this.point(inner, from);
    return `M ${outer.x} ${outer.y}`
      + ` A ${RADIUS} ${RADIUS} 0 ${large} 1 ${outerEnd.x} ${outerEnd.y}`
      + ` L ${innerEnd.x} ${innerEnd.y}`
      + ` A ${inner} ${inner} 0 ${large} 0 ${innerStart.x} ${innerStart.y} Z`;
  }

  /** A point on the circle, `turn` counted from twelve o'clock clockwise as a share of the whole. */
  private point(radius: number, turn: number): { x: string; y: string } {
    const angle = turn * 2 * Math.PI - Math.PI / 2;
    return {
      x: (CENTRE + radius * Math.cos(angle)).toFixed(3),
      y: (CENTRE + radius * Math.sin(angle)).toFixed(3),
    };
  }
}
