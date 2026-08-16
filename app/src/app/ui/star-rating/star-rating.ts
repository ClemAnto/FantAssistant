import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzRateModule } from 'ng-zorro-antd/rate';

import { MOSTLY_ANCHOR, STAR_WORD, starsOf, toneOf } from '../../core/player-ratings';
import { short } from '../../core/tooltip';

/**
 * A 0-99 drawn as five stars, HALVES included, on the bands of `starsOf`.
 *
 * The score is the fact and the stars are the VERDICT on it: three stars is the middle of the listone,
 * four is a standard deviation above it and five two - so a star is a sentence («in media», «molto sopra
 * la media») and not the number divided by twenty. The column still sorts on the score, because two men
 * inside one band are still two different numbers, and the toggle beside the table shows it.
 *
 * A score that does not exist draws NO stars and a dash - «vuoto = ignoto, mai zero» - because an empty
 * five-star row and a measured zero would otherwise look the same.
 */
@Component({
  selector: 'ui-stars',
  templateUrl: './star-rating.html',
  imports: [DecimalPipe, FormsModule, NzRateModule],
  host: { class: 'inline-flex' },
})
export class StarRating {
  readonly score = input.required<number | null>();
  /** What the number rests on: sample, window, caveat. Drawn as the element's own title. */
  readonly hint = input<string>('');
  /** How much of the number is his own football: under half, the stars are drawn as what they are. */
  readonly weight = input<number>(1);
  /**
   * How the reading is DRAWN: five stars, or the 0-99 behind them.
   *
   * One reading and two drawings of it, never two numbers: the stars are the VERDICT on that score and
   * the score is the place itself, which is why the column sorts on the score and why the choice is
   * worth offering - inside «in media» there are twenty points of listone, a queue of a hundred men.
   */
  readonly show = input<'stars' | 'score'>('stars');

  protected readonly stars = computed(() => starsOf(this.score()));

  /** Il colore del quadrato: la banda della stella, mai una soglia sua. */
  protected readonly tone = computed(() => toneOf(this.score()));

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
    if (score == null) return short(`Non misurabile${hint}`);
    // The WORD and the place, and then what the number rests on. Never «5 stelle su 5»: the stars are
    // on screen, and a tooltip has two lines to spend (`TOOLTIP_MAX`) - what they MEAN is in the panel
    // under the table, not here.
    return short(
      `${STAR_WORD[this.stars()!] ?? ''} · ${Math.round(score)}/99`
        + (this.rough() ? ' · SPANNOMETRICO' : '')
        + hint,
    );
  });
}
