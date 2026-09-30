import { PresenceTestFile, PresenceTestRow, distanceOf, presenceRows, ratioOf } from './presence-test';

const row = (name: string, formula: number, engine: number | null, actual: number,
  window: 'T1' | 'T2' = 'T2', sample = true): PresenceTestRow => ({
  window, target: '2025-26', fcId: name.length * 7 + formula, name, role: 'C', context: 'serie A, stesso club',
  clubChange: false, europeIn: false, europeOut: false, mv: 6, prev: null, prev2: null, d: 0.9, s: 0.8,
  paFormula: formula, paEngine: engine, paActual: actual, sample,
});

const file = (rows: PresenceTestRow[]): PresenceTestFile => ({
  generated_at: '2026-09-30T00:00:00+00:00', formula: '', params: {}, priors: {},
  summary: {} as PresenceTestFile['summary'], rows,
});

describe('ratioOf / distanceOf', () => {
  it('reads predicted over real, and 50% and 200% are the same distance from 100%', () => {
    expect(ratioOf(15, 30)).toBe(0.5);
    expect(ratioOf(30, 15)).toBe(2);
    expect(ratioOf(10, 0)).toBeNull();
    expect(distanceOf(0.5)).toBeCloseTo(distanceOf(2)!, 12);
    expect(distanceOf(1)).toBe(0);
  });
});

describe('presenceRows', () => {
  it('shows the sample of one window, closest to 100% first, the unratioed last', () => {
    const rows = presenceRows(file([
      row('Lontano', 40, 20, 20),        // 200%
      row('Esatto', 30, 25, 30),         // 100%
      row('Mezzo', 10, 10, 20),          // 50%
      row('Zero', 5, 5, 0),              // played nothing: no ratio
      row('Fuori', 30, 30, 30, 'T2', false),
      row('Altra', 30, 30, 30, 'T1'),
    ]), 'T2', { sort: 'ratioFormula', descending: false });
    expect(rows.map((one) => one.name)).toEqual(['Esatto', 'Lontano', 'Mezzo', 'Zero']);
    expect(rows[1].ratioFormula).toBe(2);
    expect(rows[3].ratioFormula).toBeNull();
  });

  it('reads every row when asked, and filters by role and query', () => {
    const rows = presenceRows(file([{ ...row('Uno', 1, 1, 1), role: 'P' }, row('Due', 1, 1, 1, 'T2', false)]), 'T2',
      { sort: 'name', descending: false, all: true, role: 'C', query: (one) => one.name.startsWith('D') });
    expect(rows.map((one) => one.name)).toEqual(['Due']);
  });
});
