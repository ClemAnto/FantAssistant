import { PILLAR_MIN_VOTES, PillarCell, pillarRecord, pillarState } from './pillars';

/** `n` voted matches: the OLDEST `n - good` at 5.5, the rest at `vote` (>= 6), each with `bonus` on the fantavoto. */
function cells(n: number, vote: number, bonus: number, good = n): PillarCell[] {
  return Array.from({ length: n }, (_, i) => ({
    vote: i >= n - good ? vote : 5.5,
    fantavoto: (i >= n - good ? vote : 5.5) + bonus,
    date: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`,
  }));
}

describe('pillars', () => {
  it('a Mantra mediano is judged on his own bonus bar: Rice in, a C;T with the same numbers out', () => {
    const rice = pillarRecord(cells(36, 6.5, 0.5, 30)); // media voto 6.33, costanza 0.83, bonus 0.50
    expect(pillarState(rice, 'C', 'euro', 'bandiera', true)).toBe('pillar');
    expect(pillarState(rice, 'C', 'euro', 'titolare', false)).toBeNull();
  });

  it('a keeper is judged on the fantamedia and must own the shirt', () => {
    const keeper = pillarRecord(cells(40, 6.4, -0.9, 37));
    expect(pillarState(keeper, 'P', 'default', 'bandiera', false)).toBe('pillar');
    expect(pillarState(keeper, 'P', 'default', 'ballottaggio', false)).toBeNull();
    expect(pillarState(pillarRecord(cells(40, 6.4, -1.3, 37)), 'P', 'default', 'bandiera', false)).toBeNull();
  });

  it('too short a record is no pillar, whatever the numbers', () => {
    expect(pillarState(pillarRecord(cells(PILLAR_MIN_VOTES - 1, 7, 1)), 'D', 'euro', 'bandiera', false)).toBeNull();
    expect(pillarState(pillarRecord(cells(PILLAR_MIN_VOTES, 7, 1)), 'D', 'euro', 'bandiera', false)).toBe('pillar');
  });

  it('three of the last four under the 6 suspend him, older bad matches do not', () => {
    const base = cells(30, 6.8, 2);
    const late = base.map((one, i) => (i >= 27 ? { ...one, vote: 5, fantavoto: 5 } : one));
    expect(pillarState(pillarRecord(late), 'A', 'euro', 'titolare', false)).toBe('suspended');
    const early = base.map((one, i) => (i < 3 ? { ...one, vote: 5, fantavoto: 5 } : one));
    expect(pillarState(pillarRecord(early), 'A', 'euro', 'titolare', false)).toBe('pillar');
  });
});
