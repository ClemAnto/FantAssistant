import { PresenceTestFile, PresenceTestRow, presenceRows } from './presence-test';

const row = (name: string, formula: number, engine: number | null, actual: number, window: 'T1' | 'T2' = 'T2'): PresenceTestRow => ({
  window, target: '2025-26', fcId: name.length, name, role: 'C', context: 'serie A, stesso club', clubChange: false,
  europeIn: false, europeOut: false, mv: 6, prev: null, prev2: null, d: 0.9, s: 0.8,
  paFormula: formula, paEngine: engine, paActual: actual,
});

const file = (rows: PresenceTestRow[]): PresenceTestFile => ({
  generated_at: '2026-09-30T00:00:00+00:00', formula: '', params: {}, priors: {},
  summary: {} as PresenceTestFile['summary'], rows,
});

describe('presenceRows', () => {
  it('keeps one window, signs the errors and ranks by the formula\'s gain over the engine', () => {
    const rows = presenceRows(file([
      row('Uno', 30, 20, 30),      // formula exact, engine 10 off: gain +10
      row('Due', 25, 26, 26),      // formula 1 off, engine exact: gain -1
      row('Tre', 10, null, 12),    // no engine number: no gain, last
      row('Quattro', 1, 1, 1, 'T1'),
    ]), 'T2', { sort: 'gain', descending: true });
    expect(rows.map((one) => one.name)).toEqual(['Uno', 'Due', 'Tre']);
    expect(rows[1].errFormula).toBe(-1);
    expect(rows[1].errEngine).toBe(0);
    expect(rows[2].errEngine).toBeNull();
  });

  it('filters by role and by the query', () => {
    const rows = presenceRows(file([{ ...row('Uno', 1, 1, 1), role: 'P' }, row('Due', 1, 1, 1)]), 'T2',
      { sort: 'name', descending: false, role: 'C', query: (one) => one.name.startsWith('D') });
    expect(rows.map((one) => one.name)).toEqual(['Due']);
  });
});
