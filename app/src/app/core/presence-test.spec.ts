import { PresenceTestFile, PresenceTestRow, distanceOf, presenceRows, ratioOf } from './presence-test';

const row = (name: string, formula: number, engine: number | null, actual: number,
  window = 'T2', sample = true): PresenceTestRow => ({
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

  it('keeps two zero predictions together at the end instead of sorting on NaN', () => {
    const rows = presenceRows(file([row('A', 0, 0, 10), row('B', 10, 10, 10), row('C', 0, 0, 20)]), 'T2',
      { sort: 'ratioEngine', descending: false });
    expect(rows[0].name).toBe('B');
    expect(rows.slice(1).map((one) => one.name).sort()).toEqual(['A', 'C']);
  });

  it('reads every row when asked, and filters by role and query', () => {
    const rows = presenceRows(file([{ ...row('Uno', 1, 1, 1), role: 'P' }, row('Due', 1, 1, 1, 'T2', false)]), 'T2',
      { sort: 'name', descending: false, all: true, role: 'C', query: (one) => one.name.startsWith('D') });
    expect(rows.map((one) => one.name)).toEqual(['Due']);
  });

  it('sorts a rung by the ladder, strongest first, and an unknown rung last', () => {
    const rows = presenceRows(file([
      { ...row('Riserva', 5, 5, 5), rung: 'riserva' },
      { ...row('Bandiera', 30, 30, 30), rung: 'bandiera' },
      { ...row('Ignoto', 20, 20, 20), rung: null },
      { ...row('Ballottaggio', 20, 20, 21), rung: 'ballottaggio' },
    ]), 'T2', { sort: 'rung', descending: false });
    // Ascending on the rank is the ladder's own order: 0 = bandiera. Never the alphabet (BAN, BLT, RIS).
    expect(rows.map((one) => one.name)).toEqual(['Bandiera', 'Ballottaggio', 'Riserva', 'Ignoto']);
  });

  it('reads any window of the gate, not only T1 and T2', () => {
    const rows = presenceRows(file([row('Vecchio', 20, 20, 20, 'Tm7'), row('Nuovo', 20, 20, 20)]), 'Tm7',
      { sort: 'name', descending: false });
    expect(rows.map((one) => one.name)).toEqual(['Vecchio']);
  });
});
