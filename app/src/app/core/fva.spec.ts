import { describe, expect, it } from 'vitest';

import {
  GOAL_BONUS,
  MATCH_DELTA_MAX,
  MATCH_GOALS_PER_100,
  MATCH_MV_PER_100,
  MATCH_OTHERS_PER_100,
  fvaOf,
  lambdaOf,
  minutesFactor,
  oddsScale,
} from './fva';

const outfield = { keeper: false, mv: 6.5, fm: 7.5, minutes: 90, goalsPerMatch: 0.25, oddsProb: null };

describe('fvaOf', () => {
  it('without a price, gives back the fantamedia at full minutes', () => {
    // 6.5 + 3 x 0.25 (goals) + (1.0 - 0.75) others = 7.5
    expect(fvaOf(outfield).value).toBeCloseTo(7.5, 6);
    expect(fvaOf(outfield).source).toBe('history');
  });

  it('replaces the goal part with the price, and only that part', () => {
    const fva = fvaOf({ ...outfield, oddsProb: 0.5 });
    expect(fva.goals).toBeCloseTo(GOAL_BONUS * Math.log(2), 6);
    expect(fva.others).toBeCloseTo(0.25, 6);
    expect(fva.source).toBe('odds');
  });

  it('lets the minutes move the number only a little', () => {
    expect(minutesFactor(90)).toBe(1);
    expect(minutesFactor(45)).toBeCloseTo(0.925, 6);
    expect(minutesFactor(null)).toBe(1);
    const full = fvaOf(outfield).value!;
    const half = fvaOf({ ...outfield, minutes: 45 }).value!;
    expect(full - half).toBeGreaterThan(0);
    expect(full - half).toBeLessThan(0.2);
  });

  it('never rewards a man under 6 for playing less', () => {
    const low = { ...outfield, mv: 5.6, fm: 5.8, goalsPerMatch: 0 };
    expect(fvaOf({ ...low, minutes: 45 }).value!).toBeLessThanOrEqual(fvaOf(low).value!);
  });

  it('reads a keeper from the clean-sheet price: MV minus the goals conceded', () => {
    const fva = fvaOf({ keeper: true, mv: 6, fm: 5, minutes: 90, goalsPerMatch: null, oddsProb: Math.exp(-1) });
    expect(fva.value).toBeCloseTo(5, 6);
    expect(fvaOf({ keeper: true, mv: 6, fm: 5.2, minutes: 90, goalsPerMatch: null, oddsProb: null }).value).toBe(5.2);
  });

  it('is unknown, never zero, without a fantamedia', () => {
    expect(fvaOf({ ...outfield, fm: null }).value).toBeNull();
  });
});

describe('the match', () => {
  it('adds nothing on an ordinary match or an unknown one', () => {
    expect(fvaOf({ ...outfield, delta: 0 }).value).toBeCloseTo(7.5, 6);
    expect(fvaOf({ ...outfield, delta: null }).value).toBeCloseTo(7.5, 6);
  });

  it('moves the base vote, the other bonuses and the goals of the history on an easier match', () => {
    const fva = fvaOf({ ...outfield, delta: 100 });
    const expected = MATCH_MV_PER_100 + MATCH_OTHERS_PER_100 + GOAL_BONUS * 0.25 * MATCH_GOALS_PER_100;
    expect(fva.match).toBeCloseTo(expected, 6);
    expect(fva.value).toBeCloseTo(7.5 + expected, 6);
    expect(fvaOf({ ...outfield, delta: -100 }).value!).toBeLessThan(7.5);
  });

  it('leaves the goals to the price where there is one: the price already knows the opponent', () => {
    const priced = { ...outfield, oddsProb: 0.5 };
    const fva = fvaOf({ ...priced, delta: 100 });
    expect(fva.goals).toBeCloseTo(fvaOf(priced).goals, 6);
    expect(fva.match).toBeCloseTo(MATCH_MV_PER_100 + MATCH_OTHERS_PER_100, 6);
  });

  it('is clamped, because the fit is linear', () => {
    expect(fvaOf({ ...outfield, delta: 5000 }).value).toBeCloseTo(fvaOf({ ...outfield, delta: MATCH_DELTA_MAX }).value!, 6);
  });

  it('reads a keeper without a price from the calendar, and the price first where both exist', () => {
    const keeper = { keeper: true, mv: 6, fm: 5, minutes: 90, goalsPerMatch: null, oddsProb: null };
    const fromCalendar = fvaOf({ ...keeper, cleanSheet: Math.exp(-1.5) });
    expect(fromCalendar.value).toBeCloseTo(4.5, 6);
    expect(fromCalendar.source).toBe('calendar');
    expect(fvaOf({ ...keeper, oddsProb: Math.exp(-1), cleanSheet: Math.exp(-1.5) }).value).toBeCloseTo(5, 6);
    expect(fvaOf({ ...keeper, cleanSheet: null }).value).toBe(5);
  });
});

describe('oddsScale', () => {
  it('brings the prices to the level of the football played, never above 1', () => {
    const pairs = [0.3, 0.4, 0.5].map((oddsProb) => ({ oddsProb, goalsPerMatch: lambdaOf(oddsProb) * 0.8 }));
    expect(oddsScale(pairs)).toBeCloseTo(0.8, 6);
    expect(oddsScale(pairs.map((p) => ({ ...p, goalsPerMatch: p.goalsPerMatch * 2 })))).toBe(1);
    expect(oddsScale(pairs.slice(0, 2))).toBe(1);
  });
});
