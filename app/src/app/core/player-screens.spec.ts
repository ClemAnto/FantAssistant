import { describe, expect, it } from 'vitest';

import {
  MIN_ROLE_POOL,
  MIN_WINDOW_MINUTES,
  ScreenInput,
  screensFor,
  windowOf,
} from './player-screens';

/** A pool of `n` men of one role, priced 1..n so the percentile is exactly the position. */
function pool(role: string, n = MIN_ROLE_POOL, minutes = 180): ScreenInput[] {
  return Array.from({ length: n }, (_unused, i) => ({
    id: i + 1,
    role,
    price: i + 1,
    minutes,
    xg: 0,
    xa: 0,
  }));
}

describe('windowOf', () => {
  it('reads a missing xG as ZERO and a missing minute as «he did not play»', () => {
    // NULL xg means «no shot» - measured on the data, and the provider's payload changed shape between
    // seasons, so the reader imposes the convention. A row with no minutes is an unused substitute and
    // is not an observation at all: it must not dilute the rate.
    const got = windowOf([
      { minutes: 90, xg: 0.4, xa: null },
      { minutes: null, xg: null, xa: null },
      { minutes: 45, xg: null, xa: 0.2 },
    ]);
    expect(got).toEqual({ minutes: 135, xg: 0.4, xa: 0.2 });
  });

  it('is zero on an empty window rather than undefined', () => {
    expect(windowOf([])).toEqual({ minutes: 0, xg: 0, xa: 0 });
  });
});

describe('screensFor', () => {
  it('flags a CHEAP defender who is producing', () => {
    const men = pool('D');
    men[0] = { ...men[0], xg: 0.4, xa: 0.2 };      // cheapest, 0.6 over 180' = 0.30 per 90
    const got = screensFor(men);
    expect(got.get(1)?.flag).toBe('promise');
    expect(got.get(1)?.xga90).toBeCloseTo(0.3, 5);
  });

  it('does NOT flag the same production on an expensive defender', () => {
    const men = pool('D');
    men[men.length - 1] = { ...men[men.length - 1], xg: 0.4, xa: 0.2 };
    expect(screensFor(men).size).toBe(0);
  });

  it('flags a DEAR striker who is not producing, and leaves the cheap ones alone', () => {
    const men = pool('A');
    const got = screensFor(men);          // everybody at 0.00 per 90
    expect(got.get(men.length)?.flag).toBe('flop_risk');   // the dearest
    expect(got.has(1)).toBe(false);                        // the cheapest is not a flop question
  });

  it('never screens a midfielder or a keeper: those cells did not survive the calibration', () => {
    // Only two screens ship. The rest of the grid came out at or below 1.1x and three cells came out
    // BELOW 1.0, i.e. worse than not filtering - drawing them would be drawing noise.
    expect(screensFor(pool('C')).size).toBe(0);
    expect(screensFor(pool('P')).size).toBe(0);
  });

  it('refuses to screen a man who has not played enough for a rate to exist', () => {
    const men = pool('D', MIN_ROLE_POOL, MIN_WINDOW_MINUTES - 1);
    men[0] = { ...men[0], xg: 5, xa: 5 };
    expect(screensFor(men).size).toBe(0);
  });

  it('refuses a role pool too small to be a distribution', () => {
    const men = pool('D', MIN_ROLE_POOL - 1);
    men[0] = { ...men[0], xg: 0.4, xa: 0.2 };
    expect(screensFor(men).size).toBe(0);
  });

  it('ignores a man with no price: no percentile, no screen', () => {
    const men = pool('D');
    men[0] = { ...men[0], price: null, xg: 0.4, xa: 0.2 };
    expect(screensFor(men).has(1)).toBe(false);
  });

  it('computes the percentile inside the ROLE, so one role cannot move another', () => {
    // A defender priced 1 is cheap among defenders even if strikers are priced 100 - pooling the two
    // would rank him against a different scale, which is the defect the pool rule exists for.
    const men = [...pool('D'), ...pool('A', MIN_ROLE_POOL).map((m) => ({ ...m, id: m.id + 100, price: 100 }))];
    men[0] = { ...men[0], xg: 0.4, xa: 0.2 };
    expect(screensFor(men).get(1)?.flag).toBe('promise');
  });
});
