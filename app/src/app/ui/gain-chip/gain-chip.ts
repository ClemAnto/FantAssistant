import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';

import { GainBand, GainScale, gainBandOf } from '../../core/sealed-bid';

/**
 * The colour of each band. Four words, four steps, and the neutral one in the middle.
 *
 * It is `player-ratings.toneOf`'s own structure and not a second palette: green above the middle of the
 * pool, NEUTRAL for the middle itself - a screen where every number is painted is a screen that shouts,
 * and «medio» is not news - amber below it, and RED left where the house rule keeps it, for danger and
 * for destructive actions. A poor player is not a danger.
 *
 * The ink depends on how full the ground is, which was measured on this app's own page rather than
 * guessed (`toneOf`): on a FULL token the ink is the page's background, which is opposite by
 * construction; on a translucent one the page's normal ink still reads.
 */
const BAND_TONE: Record<GainBand, string> = {
  ottimo: 'bg-success text-page',
  buono: 'bg-success/60 text-fg',
  medio: 'bg-control text-fg',
  scarso: 'bg-warning/50 text-fg',
  ignoto: 'text-muted',
};

/**
 * THE GAIN, drawn the same way everywhere: a rounded square whose colour says what kind of man he is.
 *
 * The operator's rule of 25/08/2026 - «il gain deve essere mostrato sempre allo stesso modo in un
 * quadrato smussato con bg colorato che a seconda del colore indica se un calciatore è ottimo, buono,
 * medio, scarso». One component, so a colour cannot mean one thing in the plan and another in a roster:
 * the defect this project keeps paying for is a displayed list whose figures describe a different list.
 *
 * The BANDS are not this component's to choose - they are percentiles of the pool, cut once by
 * `gainScale` and passed in - because the pool is half of the measurement and the same man must not
 * change colour when somebody else is bought.
 *
 * An unknown gain draws a DASH and no colour. «Vuoto = ignoto, mai zero»: painting him `scarso` would be
 * a verdict nobody gave, and a man the sheet cannot price is exactly the one the operator may know
 * something about.
 */
@Component({
  selector: 'ui-gain',
  templateUrl: './gain-chip.html',
  imports: [DecimalPipe],
  host: { class: 'inline-flex' },
})
export class GainChip {
  readonly gain = input.required<number | null>();
  readonly scale = input.required<GainScale>();
  /**
   * Quante cifre dopo la virgola, perché la SCALA del numero non è la stessa in ogni pagina.
   *
   * Un gain di stagione va da 0 a ~50 e una cifra basta; lo stesso gain A GIORNATA sta fra 0 e ~1,3, e
   * con una cifra sola metà listone leggerebbe «0,1». Il default è quello che le pagine avevano prima,
   * quindi nessun chiamante cambia lettura per una colonna aggiunta altrove.
   */
  readonly digits = input(1);
  /**
   * QUANTO E' GRANDE il riquadro, e le due taglie sono una scelta di DENSITA' e non di stile.
   *
   * `md` e' quella delle pagine dove il gain e' il numero grosso di una scheda; `sm` e' per una lista
   * che si scorre (operatore, 04/09/2026: «fallo un po' piu' piccolino»), dove ogni pixel del riquadro
   * e' un pixel tolto al NOME, che e' quello che si sta cercando. Quello che NON cambia e' il resto -
   * forma, colore e fasce - perche' la sua regola del 25/08 e' che il gain si mostri sempre allo stesso
   * modo: un colore non puo' voler dire una cosa in una lista e un'altra in una scheda.
   */
  readonly size = input<'sm' | 'md'>('md');
  protected readonly band = computed<GainBand>(() => gainBandOf(this.gain(), this.scale()));
  protected readonly format = computed(() => `1.${this.digits()}-${this.digits()}`);
  protected readonly box = computed(() =>
    this.size() === 'sm' ? 'h-4 min-w-9 text-[10px]' : 'h-5 min-w-10 text-xs',
  );

  protected readonly tone = computed(() => BAND_TONE[this.band()]);
}
