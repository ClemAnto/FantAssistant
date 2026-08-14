import { describe, expect, it } from 'vitest';

import { MIN_TREND_POOL, isKnownAbsence, parseTrend, trendScores } from './player-trend';

/** One record of `desc_trend_detail`, in the sixteen fields the toolkit writes. */
function record(fields: Partial<Record<number, string>>): string {
  const base = [
    '2026-05-01', 'serie_a', 'Lazio', 'A', 'p', '90', '1', '6.5', 'real', '6.5', '0', '0', '0', '0',
    '0.20', '1',
  ];
  for (const [at, value] of Object.entries(fields)) base[Number(at)] = value as string;
  return base.join('|');
}

describe('parseTrend', () => {
  it('reads the sixteen fields and keeps the toolkit’s own order', () => {
    const [match] = parseTrend(record({ 4: 'p', 5: '63', 6: '', 10: '1', 12: '1', 15: '0' }));
    expect(match.minutes).toBe(63);
    expect(match.started).toBe(false);
    expect(match.goals).toBe(1);
    expect(match.yellows).toBe(1);
    expect(match.inEuro).toBe(false);
  });

  it('never turns an unknown into a zero', () => {
    // A synthetic round has no cards at all (the per-match layer carries no bookings) and a season
    // the provider served no xG for has no xG: both must stay null, or the strip draws a fact nobody
    // measured. Same rule as everywhere else here - «vuoto = ignoto, mai zero».
    const [match] = parseTrend(record({ 8: 'synth', 12: '', 13: '', 14: '', 15: '' }));
    expect(match.yellows).toBeNull();
    expect(match.reds).toBeNull();
    expect(match.xga).toBeNull();
    expect(match.inEuro).toBeNull();
    expect(match.voteSource).toBe('synth');
  });

  it('skips a record shorter than the format instead of padding it', () => {
    // A bundle older than the column would otherwise read as «voto 0, dentro il calendario».
    expect(parseTrend('2026-05-01|serie_a|Lazio|A|p|90|1')).toEqual([]);
    expect(parseTrend(null)).toEqual([]);
  });
});

describe('isKnownAbsence', () => {
  it('counts the four reasons we know and not the two we do not', () => {
    // The four count ZERO in the mean because he really was not on the pitch; `n` (no data at all)
    // and `x` (an eleven with no statistics) are unknown, and a zero there would say he was bad.
    expect(['b', 'i', 's', 'o'].every(isKnownAbsence as never)).toBe(true);
    expect(['p', 'n', 'x'].some(isKnownAbsence as never)).toBe(false);
  });
});

describe('trendScores', () => {
  const pool = (role: string, values: number[]) =>
    values.map((fp, index) => ({ id: index + 1 + (role === 'A' ? 100 : 0), role, fp }));

  it('scales inside the ROLE, so a defender is not ranked against a striker', () => {
    const forwards = pool('A', Array.from({ length: MIN_TREND_POOL }, (_x, i) => 4 + i * 0.5));
    const defenders = pool('D', Array.from({ length: MIN_TREND_POOL }, (_x, i) => 2 + i * 0.2));
    const scores = trendScores([...forwards, ...defenders]);
    expect(scores.get(forwards.at(-1)!.id)).toBe(99);
    expect(scores.get(defenders.at(-1)!.id)).toBe(99);
    // the best defender collects 3.4 against the best forward's 7.5 and still reads 99: the column
    // answers «how is HE going», not «is a defender worth as much as a striker»
    expect(scores.get(defenders[0].id)).toBe(Math.round((2 / 3.4) * 99));
  });

  it('refuses a pool too thin to be a distribution, and never invents a zero', () => {
    const thin = pool('P', [5, 6, 7]);
    expect(trendScores(thin).size).toBe(0);
    const withHoles = [
      ...pool('A', Array.from({ length: MIN_TREND_POOL }, () => 6)),
      { id: 999, role: 'A', fp: null },
    ];
    expect(trendScores(withHoles).has(999)).toBe(false);
  });
});
