import { describe, expect, it } from 'vitest';

import {
  INJURY_WINDOW_DAYS,
  clubAnchor,
  injuredShare,
  meanOfScores,
  rank99,
  starsOf,
} from './player-ratings';
import { Spell } from './player-status';

/** A rank is a fact about a POOL, and these are the properties that must hold whatever the numbers are. */
describe('rank99', () => {
  it('puts the worst at 0 and the best at 99', () => {
    const ranked = rank99(new Map([[1, 5], [2, 7], [3, 6]]));
    expect(ranked.get(1)).toBe(0);
    expect(ranked.get(3)).toBe(50);
    expect(ranked.get(2)).toBe(99);
  });

  it('gives equal numbers equal rank', () => {
    const ranked = rank99(new Map([[1, 6], [2, 6], [3, 9]]));
    expect(ranked.get(1)).toBe(ranked.get(2));
    expect(ranked.get(3)).toBe(99);
  });

  it('leaves the unmeasured OUT of the ranking instead of at the bottom', () => {
    // The whole point: a man nobody could measure is not «the worst», and a 0 would say he is.
    const ranked = rank99(new Map<number, number | null>([[1, 6], [2, null], [3, 9]]));
    expect(ranked.get(2)).toBeNull();
    expect(ranked.get(1)).toBe(0);
  });

  it('refuses to rank a pool of one measured man against nobody', () => {
    expect(rank99(new Map<number, number | null>([[1, 6]])).get(1)).toBe(50);
    expect(rank99(new Map<number, number | null>([[1, null]])).get(1)).toBeNull();
  });
});

/** «Un attaccante sconosciuto della Juve è meglio di uno sconosciuto del Verona», as arithmetic. */
describe('clubAnchor', () => {
  it('stays on the role when the club has nobody measured', () => {
    expect(clubAnchor(6.0, undefined)).toBe(6.0);
    expect(clubAnchor(6.0, { mean: 7.0, measured: 0 })).toBe(6.0);
  });

  it('moves toward the club by how much of it we measured', () => {
    // Three men measured = half way, the same prior the toolkit uses (n / (n + 3)).
    expect(clubAnchor(6.0, { mean: 7.0, measured: 3 })).toBeCloseTo(6.5, 6);
    expect(clubAnchor(6.0, { mean: 7.0, measured: 1 })).toBeCloseTo(6.25, 6);
    expect(clubAnchor(6.0, { mean: 5.0, measured: 9 })).toBeCloseTo(5.25, 6);
  });

  it('never overshoots the club it is moving toward', () => {
    const moved = clubAnchor(6.0, { mean: 7.0, measured: 1000 });
    expect(moved).toBeLessThanOrEqual(7.0);
    expect(moved).toBeGreaterThan(6.9);
  });
});

describe('meanOfScores', () => {
  it('averages the readings', () => {
    expect(meanOfScores([80, 60, 40, 20])).toBe(50);
  });

  it('averages the ones that exist and does not read a missing one as a zero', () => {
    expect(meanOfScores([80, null, null, 60])).toBe(70);
  });

  it('answers nothing when nothing was measured', () => {
    expect(meanOfScores([null, null, null, null])).toBeNull();
  });

  it('keeps a measured zero, which is not a missing reading', () => {
    expect(meanOfScores([0, 0, 0, 0])).toBe(0);
  });
});

describe('starsOf', () => {
  it('draws the halves', () => {
    expect(starsOf(0)).toBe(0);
    expect(starsOf(99)).toBe(5);
    expect(starsOf(50)).toBe(2.5);
    // Every value lands on a half and never between two.
    for (let score = 0; score <= 99; score++) {
      expect((starsOf(score)! * 2) % 1).toBe(0);
    }
  });

  it('draws nothing for what was not measured', () => {
    expect(starsOf(null)).toBeNull();
  });
});

describe('injuredShare', () => {
  const spell = (from: string, to: string | null): Spell => ({ from, to, days: null, kind: null, detail: null });

  it('counts only the days inside the last year', () => {
    // A spell that ended before the window opened is not what he is carrying now.
    expect(injuredShare([spell('2024-01-01', '2024-03-01')], '2026-08-14')).toBe(0);
  });

  it('counts an open spell up to today and no further', () => {
    const share = injuredShare([spell('2026-07-15', null)], '2026-08-14');
    expect(share).toBeCloseTo(30 / INJURY_WINDOW_DAYS, 5);
  });

  it('clips a spell that started before the window at the window', () => {
    const share = injuredShare([spell('2020-01-01', null)], '2026-08-14');
    expect(share).toBe(1);
  });

  it('is zero for a man with no spell at all', () => {
    expect(injuredShare([], '2026-08-14')).toBe(0);
  });
});

describe('injuredShare, overlapping spells', () => {
  const spell = (from: string, to: string | null): Spell =>
    ({ from, to, days: null, kind: null, detail: null });

  it('counts a day out ONCE when two spells overlap', () => {
    // The source records one row per diagnosis, so a man hurt twice at once has two rows over the same
    // days: summed, one player of the window read 591 days out of 365.
    const both = injuredShare([spell('2026-05-01', '2026-07-01'), spell('2026-05-15', '2026-06-15')],
                              '2026-08-14');
    const one = injuredShare([spell('2026-05-01', '2026-07-01')], '2026-08-14');
    expect(both).toBeCloseTo(one, 6);
  });

  it('joins two spells that touch and keeps two that do not', () => {
    const joined = injuredShare([spell('2026-05-01', '2026-06-01'), spell('2026-06-01', '2026-07-01')],
                                '2026-08-14');
    expect(joined).toBeCloseTo(injuredShare([spell('2026-05-01', '2026-07-01')], '2026-08-14'), 6);
    const apart = injuredShare([spell('2026-05-01', '2026-05-11'), spell('2026-06-01', '2026-06-11')],
                               '2026-08-14');
    expect(apart).toBeCloseTo(20 / INJURY_WINDOW_DAYS, 6);
  });

  it('never reports more than the window itself', () => {
    const many = [spell('2020-01-01', null), spell('2026-01-01', null), spell('2026-06-01', null)];
    expect(injuredShare(many, '2026-08-14')).toBe(1);
  });
});
