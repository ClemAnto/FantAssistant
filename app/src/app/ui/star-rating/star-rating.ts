import { Component, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzRateModule } from 'ng-zorro-antd/rate';

import { MOSTLY_ANCHOR, starsOf } from '../../core/player-ratings';

/**
 * A 0-99 drawn as five stars, HALVES included.
 *
 * The score is the fact and the stars are the reading of it: a column sorts on the number and shows the
 * stars, so two men half a star apart are still two different numbers. A score that does not exist draws
 * NO stars and a dash - «vuoto = ignoto, mai zero» - because an empty five-star row and a measured zero
 * would otherwise look the same.
 */
@Component({
  selector: 'ui-stars',
  templateUrl: './star-rating.html',
  imports: [FormsModule, NzRateModule],
  host: { class: 'inline-flex' },
})
export class StarRating {
  readonly score = input.required<number | null>();
  /** What the number rests on: sample, window, caveat. Drawn as the element's own title. */
  readonly hint = input<string>('');
  /** How much of the number is his own football: under half, the stars are drawn as what they are. */
  readonly weight = input<number>(1);

  protected readonly stars = computed(() => starsOf(this.score()));

  /** Mostly the anchor speaking: the star is a guess with a scale behind it, and it must look like one. */
  protected readonly rough = computed(() => this.score() != null && this.weight() < MOSTLY_ANCHOR);

  /** Five slots, each full, half or empty: the drawing of the number and nothing more. */
  protected readonly slots = computed<('full' | 'half' | 'empty')[]>(() => {
    const stars = this.stars();
    if (stars == null) return [];
    return [0, 1, 2, 3, 4].map((at) =>
      stars >= at + 1 ? 'full' : stars >= at + 0.5 ? 'half' : 'empty',
    );
  });

  protected readonly label = computed(() => {
    const score = this.score();
    const hint = this.hint() ? ` · ${this.hint()}` : '';
    if (score == null) return `Non misurabile${hint}`;
    const stars = this.stars()!;
    return `${stars} stell${stars === 1 ? 'a' : 'e'} su 5 · ${score}/99 nel listone`
      + (this.rough() ? ' · SPANNOMETRICO' : '')
      + hint;
  });
}
