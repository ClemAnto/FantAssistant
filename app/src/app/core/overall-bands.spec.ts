import { describe, expect, it } from 'vitest';

import { OVERALL_BANDS, bandsOf } from './overall-bands';

/** How many of `scores` fell in one band, so an assertion names the band instead of an index. */
function counted(scores: (number | null)[], key: string): number {
  return bandsOf(scores).find((band) => band.key === key)!.count;
}

describe('bandsOf', () => {
  it('puts a score in the band its threshold opens, and the threshold itself in the one below', () => {
    // The operator wrote «> 90», so 90 is not above 90. Every boundary is checked from both sides,
    // because an off-by-one here moves men between slices and nothing on screen would say so.
    expect(counted([91], 'top')).toBe(1);
    expect(counted([90], 'top')).toBe(0);
    expect(counted([90], 'high')).toBe(1);

    expect(counted([76], 'high')).toBe(1);
    expect(counted([75], 'high')).toBe(0);
    expect(counted([75], 'upper')).toBe(1);

    expect(counted([51], 'upper')).toBe(1);
    expect(counted([50], 'upper')).toBe(0);
    expect(counted([50], 'lower')).toBe(1);

    expect(counted([26], 'lower')).toBe(1);
    expect(counted([25], 'lower')).toBe(0);
    expect(counted([25], 'bottom')).toBe(1);
  });

  it('keeps the ends of the scale inside the pie', () => {
    // 0 and 99 are real percentiles, and a man who fell out of the drawing would be invisible.
    expect(counted([0], 'bottom')).toBe(1);
    expect(counted([99], 'top')).toBe(1);
  });

  it('gives a man with no Overall a slice of his own and never the worst one', () => {
    expect(counted([null, null], 'none')).toBe(2);
    expect(counted([null, null], 'bottom')).toBe(0);
  });

  it('keeps a band nobody fell in, with zero', () => {
    const bands = bandsOf([99]);
    expect(bands.length).toBe(OVERALL_BANDS.length);
    expect(bands.every((band) => band.label.length > 0)).toBe(true);
    expect(bands.filter((band) => band.count === 0).length).toBe(OVERALL_BANDS.length - 1);
  });

  it('counts every man exactly once', () => {
    const scores = [99, 91, 90, 80, 75, 60, 50, 30, 25, 10, 0, null];
    expect(bandsOf(scores).reduce((sum, band) => sum + band.count, 0)).toBe(scores.length);
  });
});
