import { CheckMan, checkBars, checksOf, cleanShare, lastStint, strictBonusFor, quantile, stintPresence } from './draft-checks';
import { MatchCell } from './players-store';

const man = (over: Partial<CheckMan> & { id: number }): CheckMan => ({
  zone: 'C', pressRank: null, pv: 30, mv: 6.2, fm: 6.5, bonus: 0.2, played: 30, steady: 0.6, minutes: 70, timed: 30, trend: 6, trendVoted: 5, presence: 0.8, rounds: 30, ...over,
});

describe('draft checks', () => {
  it('cuts the bar at the top third of the role', () => {
    expect(quantile([1, 2, 3, 4], 2 / 3)).toBeCloseTo(3);
    const bars = checkBars([1, 2, 3, 4].map((at) => man({ id: at, fm: 5 + at })));
    expect(bars.get('C')!.fm).toBeCloseTo(8);
  });

  it('keeps the roles apart', () => {
    const checks = checksOf([
      man({ id: 1, zone: 'P', fm: 5 }), man({ id: 2, zone: 'P', fm: 4 }),
      man({ id: 3, zone: 'A', fm: 8 }), man({ id: 4, zone: 'A', fm: 7 }),
    ], 5);
    expect(checks.get(1)!.fm.ok).toBe(true);
    expect(checks.get(4)!.fm.ok).toBe(false);
  });

  it('gives no badge and no bar weight to a thin season', () => {
    const checks = checksOf([
      man({ id: 1, fm: 9, pv: 3, mv: 7 }), man({ id: 2, fm: 6.6 }), man({ id: 3, fm: 6.2 }),
    ], 5);
    expect(checks.get(1)!.fm.ok).toBeNull();
    expect(checks.get(1)!.mv.ok).toBeNull();
    expect(checks.get(2)!.fm.ok).toBe(true);
  });

  it('reads the press only, titolare or better', () => {
    const checks = checksOf([man({ id: 1, pressRank: 6 }), man({ id: 2, pressRank: 4 }), man({ id: 3 })], 5);
    expect(checks.get(1)!.tit.ok).toBe(true);
    expect(checks.get(2)!.tit.ok).toBe(false);
    expect(checks.get(3)!.tit.ok).toBeNull();
  });

  it('reads minutes per appearance with a sample, and appearances as a count', () => {
    const checks = checksOf([
      man({ id: 1, minutes: 88, presence: 0.9 }), man({ id: 2, minutes: 60, presence: 0.5 }),
      man({ id: 3, minutes: 30, presence: 0.3 }), man({ id: 4, minutes: 90, timed: 4, presence: 0 }),
    ], 5);
    expect(checks.get(1)!.m.ok).toBe(true);
    expect(checks.get(2)!.m.ok).toBe(false);
    expect(checks.get(4)!.m.ok).toBeNull();
    expect(checks.get(1)!.p.ok).toBe(true);
    // A man who never played is a measured no, and does not drag the bar down.
    expect(checks.get(4)!.p.ok).toBe(false);
    expect(checks.get(2)!.p.bar).toBeCloseTo(0.633, 2);
  });

  it('cuts the trend bar on the men with a vote in the five', () => {
    const checks = checksOf([
      man({ id: 1, trend: 6.6 }), man({ id: 2, trend: 6.2 }), man({ id: 3, trend: 5.8 }),
      man({ id: 4, trend: 5, trendVoted: 0 }), man({ id: 5, trend: 5, trendVoted: 0 }),
    ], 5);
    expect(checks.get(1)!.trend.ok).toBe(true);
    expect(checks.get(1)!.trend.bar).toBeCloseTo(6.33, 1);
    expect(checks.get(4)!.trend.ok).toBe(false);
  });

  it('never gives a share badge on zero, even when the bar is zero', () => {
    const checks = checksOf([man({ id: 1, bonus: 0, zone: 'P' }), man({ id: 2, bonus: 0, zone: 'P' })], 5);
    expect(checks.get(1)!.bonus.ok).toBe(false);
  });

  it('counts a match when the fantavoto is not below the base vote', () => {
    const cell = (vote: number, fantavoto: number) =>
      ({ kind: 'league', state: 'played', vote, fantavoto } as unknown as MatchCell);
    const read = cleanShare([cell(6, 7), cell(6, 5), cell(6.5, 6.5), cell(6, 4.5)]);
    expect(read.rated).toBe(4);
    expect(read.share).toBeCloseTo(0.5);
    // Outfield (05/10/2026): only a positive delta counts - the 6.5 / 6.5 match no longer does.
    expect(cleanShare([cell(6, 7), cell(6, 5), cell(6.5, 6.5), cell(6, 4.5)], true).share).toBeCloseTo(0.25);
    expect(strictBonusFor('A')).toBe(true);
    expect(strictBonusFor('P')).toBe(false);
  });

  it('reads a January signing on his new club only (Malen)', () => {
    const cell = (competition: string, team: string, state: string) =>
      ({ kind: competition === 'serie-a' ? 'league' : 'other_league', competition, team, state } as unknown as MatchCell);
    const cells = [
      ...Array.from({ length: 19 }, () => cell('serie-a', 'Roma', 'not_in_league')),
      ...Array.from({ length: 15 }, (_, at) => cell('premier-league', 'Aston Villa', at % 3 ? 'bench' : 'played')),
      ...Array.from({ length: 18 }, () => cell('serie-a', 'Roma', 'played')),
      cell('serie-a', 'Roma', 'injured'),
    ];
    // Written oldest first and handed over newest first, as `matchesOf` does: what decides the stint is the run
    // of matches he was ON FILE for, and the Roma rounds before he came are not his.
    const stint = lastStint([...cells].reverse());
    expect(stint.every((one) => one.competition === 'serie-a')).toBe(true);
    const presence = stintPresence(stint);
    expect(presence.rounds).toBe(19);
    expect(presence.share).toBeCloseTo(18 / 19);
  });

  it('keeps the whole season of a man who never moved', () => {
    const cell = (state: string) => ({ kind: 'league', competition: 'serie-a', team: 'Inter', state } as unknown as MatchCell);
    const stint = lastStint([cell('played'), cell('bench'), cell('played'), cell('absent')]);
    expect(stint.length).toBe(4);
    expect(stintPresence(stint).share).toBeCloseTo(0.5);
  });

  it('passes the base vote from 6', () => {
    const checks = checksOf([man({ id: 1, mv: 6 }), man({ id: 2, mv: 5.99 })], 5);
    expect(checks.get(1)!.mv.ok).toBe(true);
    expect(checks.get(2)!.mv.ok).toBe(false);
  });
});
