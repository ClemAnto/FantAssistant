import { collapseKeepers, mixPorta, porteZero } from './porte';

describe('mixPorta', () => {
  it('mixes the fantamedia AND the steadiness by the matches each keeper will play', () => {
    const mix = mixPorta(
      [
        { club: 'Roma', fm: 5.2, pv: 30, confidence: 1, estimated: false, steady: 0.9 },
        { club: 'Roma', fm: 4.6, pv: 6, confidence: 1, estimated: false, steady: 0.6 },
      ],
      38,
    );
    expect(mix.valuation.fm).toBeCloseTo(5.1, 6);
    expect(mix.valuation.pv).toBe(36);
    expect(mix.steady).toBeCloseTo((0.9 * 30 + 0.6 * 6) / 36, 6);
  });

  it('has no steadiness where none of its keepers has one: unknown, not zero', () => {
    expect(mixPorta([{ club: 'Roma', fm: 5, pv: 30, confidence: 1, estimated: false }], 38).steady).toBeNull();
  });
});

describe('porteZero', () => {
  it('is the fantamedia of the porta at the rank the league buys', () => {
    expect(porteZero([5.3, 5.1, 4.9, 4.7], 3)).toBe(4.9);
  });

  it('is the LAST porta when there are fewer than the league buys (27 porte for 36 places)', () => {
    expect(porteZero([5.3, 5.1, null], 36)).toBe(5.1);
  });

  it('does not exist without a demand or without a priced porta', () => {
    expect(porteZero([5.3], 0)).toBeNull();
    expect(porteZero([null], 3)).toBeNull();
  });
});

describe('collapseKeepers', () => {
  const rows = [
    { id: 1, role: 'A', club: 'Roma' },
    { id: 2, role: 'P', club: 'Roma' },
    { id: 3, role: 'D', club: 'Inter' },
    { id: 4, role: 'P', club: 'Roma' },
    { id: 5, role: 'P', club: 'Inter' },
  ];
  const isKeeper = (row: { role: string }) => row.role === 'P';

  it('puts ONE row per club where its first keeper was, and leaves every other row where it is', () => {
    const out = collapseKeepers(rows, isKeeper, (row) => row.club, (keepers) => ({
      id: -keepers.length, role: 'P', club: keepers[0].club,
    }));
    expect(out.map((row) => row.id)).toEqual([1, -2, 3, -1]);
  });

  it('drops the keepers of a club it cannot value, instead of leaving them as men', () => {
    const out = collapseKeepers(rows, isKeeper, (row) => row.club, (keepers) =>
      keepers[0].club === 'Inter' ? null : { id: 0, role: 'P', club: 'Roma' });
    expect(out.map((row) => row.id)).toEqual([1, 0, 3]);
  });
});
