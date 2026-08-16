/**
 * The Overall listone cut into bands: how many men sit above 90, above 75, above 50, above 25.
 *
 * THE BANDS ARE DISJOINT, and that is the operator's «> 90 · > 75 · > 50 · > 25» drawn as a pie rather
 * than restated: cumulative slices would count the same man in four of them, and a pie whose slices
 * overlap is not a pie. So each threshold opens an interval that ends where the next one begins.
 *
 * WHAT THE NUMBER IS, because it decides how the picture reads. The Overall is a PERCENTILE inside its
 * own listone (`player-ratings.rank99`): 50 means «half the listone is below him», not «half as good as
 * the best». Over the WHOLE listone the shares are therefore fixed by the construction of the scale
 * (roughly 9% / 15% / 25% / 25% / 25% of the measured men) and the picture describes the ruler. It
 * starts describing football as soon as the pool is narrowed - one club, one role - which is why the
 * view that draws it carries those filters and says so under the chart.
 *
 * `none` is not a zero. A man the engine predicts no appearances for has NO Overall («vuoto = ignoto,
 * mai zero»), and filing him among the worst would be a verdict nobody gave - so he gets a slice of his
 * own, which on the full listone is the one slice that carries information.
 */

/** One band, from the top down. `above` is STRICT, as the operator wrote it, and the scores are whole. */
export interface OverallBand {
  key: string;
  label: string;
  /** The percentile a man must be strictly ABOVE to be in this band. Null = the men with no Overall. */
  above: number | null;
  /**
   * The colour of the slice. A DISPLAY scale and nothing else: no valuation reads it, no gate owns it.
   *
   * It is `player-ratings.toneOf`'s own structure on this very number - green above the middle of the
   * listone, amber below it and the more saturated the worse, red left where it belongs (danger) -
   * echoed rather than imported, because `toneOf` answers in Tailwind classes and an SVG `fill` wants
   * a colour. The one step that is NOT on that scale is `none`, which is the only grey here: «senza
   * Overall» is the absence of a band and not a low one, and painting it amber would say «è scarso»
   * about a man nobody measured.
   *
   * WHAT `toneOf` COULD NOT LEND, and it was measured rather than guessed: its two neutral steps
   * (`bg-control`, and `--color-border` for the empty one) paint the background of a table CELL, where
   * the cell's own edges carry the boundary. A pie has no edges to borrow, and drawn with those two
   * tokens two slices of six were indistinguishable from the card behind them - ΔE 10.5 and 9.3, on a
   * bar of 15. Hence `scripts/audit-slices.mjs`, which checks EVERY pair of bands and every band
   * against the card, in every theme, and reports how many pairs it examined: 42 of 42 separate today.
   * A ramp that reads in one theme and collapses in another is the same defect twice.
   */
  fill: string;
}

export const OVERALL_BANDS: readonly OverallBand[] = [
  { key: 'top', label: 'oltre 90', above: 90, fill: 'var(--color-success)' },
  {
    key: 'high',
    label: '76-90',
    above: 75,
    fill: 'color-mix(in srgb, var(--color-success) 60%, var(--color-page))',
  },
  {
    key: 'upper',
    label: '51-75',
    above: 50,
    fill: 'color-mix(in srgb, var(--color-success) 28%, var(--color-page))',
  },
  // Sotto la mediana si passa all'ambra, e più è carica peggio è: è la struttura di `toneOf`, che su
  // QUESTO stesso numero usa `warning/30` per «molto sotto la media» e `warning/60` per il gradino
  // ancora sotto. Il rosso resta dov'è, cioè al pericolo: un quarto del listone non è un allarme.
  {
    key: 'lower',
    label: '26-50',
    above: 25,
    fill: 'color-mix(in srgb, var(--color-warning) 32%, var(--color-page))',
  },
  {
    key: 'bottom',
    label: '0-25',
    above: -1,
    fill: 'color-mix(in srgb, var(--color-warning) 62%, var(--color-page))',
  },
  // Non è una fascia bassa, è l'assenza di una fascia. Quindi è l'unico grigio del disegno - fuori
  // dalla scala verde-ambra per costruzione - o «non lo sappiamo» si leggerebbe come «è scarso».
  {
    key: 'none',
    label: 'senza Overall',
    above: null,
    fill: 'color-mix(in srgb, var(--color-muted) 42%, var(--color-page))',
  },
];

/** One band with how many men fell in it. A band with nobody keeps its row: an empty slice is a fact. */
export interface BandCount extends OverallBand {
  count: number;
}

/**
 * The men of a pool counted band by band, in the order the bands are declared.
 *
 * A score outside 0-99 cannot happen (`rank99` produces the percentile itself) and is not guarded
 * against: it would be a defect upstream, and swallowing it here would hide it.
 */
export function bandsOf(scores: Iterable<number | null>): BandCount[] {
  const out = OVERALL_BANDS.map((band) => ({ ...band, count: 0 }));
  const none = out[out.length - 1];
  for (const score of scores) {
    if (score == null) {
      none.count += 1;
      continue;
    }
    // The bands are declared top down, so the first one he clears is his.
    const band = out.find((one) => one.above != null && score > one.above);
    if (band) band.count += 1;
  }
  return out;
}
