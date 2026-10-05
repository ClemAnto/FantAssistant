import { SUB_BONUS_COST, subBonusShift } from './sub-bonus';

describe('subBonusShift', () => {
  it('lowers a starter who is now in a ballottaggio (Saelemaekers: 33 of 35 started, now 35% when fit)', () => {
    const shift = subBonusShift('C', 35, 0.898, { apps: 35, starts: 33 })!;
    expect(shift).toBeCloseTo(-SUB_BONUS_COST['C'] * (1 - 0.35 / 0.898 - 2 / 35), 6);
    expect(shift).toBeLessThan(-0.06);
  });

  it('barely moves a starter who stays a starter (Atta: 29 of 32, now 80%)', () => {
    expect(Math.abs(subBonusShift('C', 80, 0.894, { apps: 32, starts: 29 })!)).toBeLessThan(0.005);
  });

  it('raises a man who came off the bench and now starts', () => {
    expect(subBonusShift('A', 90, 0.95, { apps: 20, starts: 5 })!).toBeGreaterThan(0.3);
  });

  it('costs more up front than at the back, and nothing in goal', () => {
    const at = (role: string) => subBonusShift(role, 30, 0.9, { apps: 30, starts: 30 });
    expect(at('A')!).toBeLessThan(at('C')!);
    expect(at('C')!).toBeLessThan(at('D')!);
    expect(at('P')).toBeNull();
  });

  it('moves nothing where a number is missing: empty is unknown, never zero', () => {
    expect(subBonusShift('C', null, 0.9, { apps: 30, starts: 30 })).toBeNull();
    expect(subBonusShift('C', 50, null, { apps: 30, starts: 30 })).toBeNull();
    expect(subBonusShift('C', 50, 0.9, null)).toBeNull();
    expect(subBonusShift('C', 50, 0.9, { apps: 3, starts: 3 })).toBeNull();
  });
});
