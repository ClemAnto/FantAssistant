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
  goalChance,
  REST_PRIOR_MATCHES,
  restPerMatch,
  recentMv,
  RECENT_MV_K,
} from './fva';

const outfield = { keeper: false, mv: 6.5, fm: 7.5, minutes: 90, goalsPerMatch: 0.25, oddsProb: null };

describe('fvaOf', () => {
  it('without a price, gives back the fantamedia at full minutes', () => {
    // 6.5 + 3 x 0.25 (goals) + (1.0 - 0.75) others = 7.5
    expect(fvaOf(outfield).value).toBeCloseTo(7.5, 6);
    expect(fvaOf(outfield).source).toBe('history');
  });

  it('replaces the goal part with the CALIBRATED price, and only that part', () => {
    const fva = fvaOf({ ...outfield, appearances: 20, oddsProb: 0.5 });
    expect(fva.goals).toBeCloseTo(GOAL_BONUS * lambdaOf(goalChance(0.5, 5, 20)), 6);
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

describe('«altri» with a price: measured, not derived from the regressed fantamedia', () => {
  // The case that found it (09/10/2026), with the euro sheet's and the votes' own numbers: Kane's FM is pulled
  // from 10.6 to 9.2 toward the role's anchor, Gabriel Jesus's from 6.38 UP to 7.24. Derived as FM - MV - goals,
  // that regression read as «altri» -1.00 and +0.42; measured on their matches it is +0.05 and 0.00.
  const kane = { keeper: false, mv: 6.791, fm: 9.199, minutes: 62, goalsPerMatch: 38 / 33, oddsProb: 0.7154 };
  const jesus = { keeper: false, mv: 6.477, fm: 7.242, minutes: 36, goalsPerMatch: 0.1, oddsProb: 0.5704 };

  it('reads the measured rest of the bonus where the price takes the goals', () => {
    expect(fvaOf({ ...kane, restPerMatch: 0.05 }).others).toBeCloseTo(0.05 * minutesFactor(62), 6);
    expect(fvaOf({ ...jesus, restPerMatch: 0 }).others).toBeCloseTo(0, 6);
    // the old derivation, for the record: what the regression was doing to the two
    expect(fvaOf(kane).others).toBeLessThan(-0.9);
    expect(fvaOf(jesus).others).toBeGreaterThan(0.35);
  });

  it('keeps Kane ahead of Gabriel Jesus', () => {
    const k = fvaOf({ ...kane, appearances: 33, restPerMatch: 0.05 }).value!;
    const j = fvaOf({ ...jesus, appearances: 20, restPerMatch: 0 }).value!;
    expect(k).toBeGreaterThan(j);
  });

  it('without a price nothing changes: history goals and the remainder give the sheet FM back', () => {
    expect(fvaOf({ ...outfield, restPerMatch: 0.9 }).value).toBeCloseTo(7.5, 6);
    expect(fvaOf({ ...outfield, restPerMatch: 0.9 }).others).toBeCloseTo(0.25, 6);
  });

  it('measures the rest on voted matches: fantavoto - voto - 3 x goals, a scored penalty being a goal', () => {
    const cells = [
      { vote: 7, fantavoto: 11, goals: 1, penScored: 0 }, // +3 goal, +1 assist -> rest +1
      { vote: 6.5, fantavoto: 9, goals: 0, penScored: 1 }, // penalty goal, -0.5 booking -> rest -0.5
      { vote: null, fantavoto: null, goals: 0, penScored: 0 }, // no vote: not in the mean
    ];
    // +0.25 a match on TWO voted matches, shrunk by its sample: 0.5 / (2 + 10)
    expect(restPerMatch(cells)).toBeCloseTo(0.5 / (2 + REST_PRIOR_MATCHES), 6);
    expect(restPerMatch([{ vote: null, fantavoto: null, goals: 0, penScored: 0 }])).toBeNull();
  });

  it('credits a short record less: Doue (24 voted matches) ahead of Godts (3), «di poco»', () => {
    // The operator, 09/10/2026: «dobbiamo premiare leggermente di più chi ha dei dati più effettivi». Both at
    // PSG against Le Mans, priced 1.87 and 1.84; Godts' one assist in three matches read +0.31 a match raw.
    const voted = (n: number, extra: number) =>
      Array.from({ length: n }, (_, i) => ({ vote: 6, fantavoto: 6 + (i === 0 ? extra : 0), goals: 0, penScored: 0 }));
    const godtsRest = restPerMatch(voted(3, 1))!;
    const doueRest = restPerMatch(voted(24, 2))!;
    expect(godtsRest).toBeCloseTo(1 / 13, 6);
    expect(doueRest).toBeCloseTo(2 / 34, 6);
    // Here the goals are the PRICE's (calibrated): equal prices, so the rest of the bonus alone decides «di poco».
    const godts = { keeper: false, mv: 6.144, fm: 6.992, minutes: 51, goalsPerMatch: 0, restPerMatch: godtsRest, oddsProb: 0.546 };
    const doue = { keeper: false, mv: 6.287, fm: 6.863, minutes: 58, goalsPerMatch: 0, restPerMatch: doueRest, oddsProb: 0.546 };
    const gap = fvaOf(doue).value! - fvaOf(godts).value!;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(0.2);
  });
});

describe('goalChance: the price calibrated on what happened (22/10/2026)', () => {
  it('reads a price far LOWER than 1/price, as the archive measured', () => {
    // implied 25% realised ~13% in the archive; an average scorer (0.15 a match over 30) sits near it
    expect(goalChance(0.25, 4.5, 30)).toBeLessThan(0.18);
    expect(goalChance(0.25, 4.5, 30)).toBeGreaterThan(0.08);
  });

  it('rises with the price and with his own goal rate, never with nothing behind it', () => {
    expect(goalChance(0.4, 4.5, 30)).toBeGreaterThan(goalChance(0.3, 4.5, 30));
    expect(goalChance(0.3, 15, 30)).toBeGreaterThan(goalChance(0.3, 3, 30));
    // no record at all reads as the prior, not as a zero
    expect(goalChance(0.3, null, null)).toBeCloseTo(goalChance(0.3, 0, 0), 9);
    expect(goalChance(0.3, null, null)).toBeGreaterThan(0);
  });

  it('is not discounted by the minutes: the price already knows if he starts', () => {
    const priced = { ...outfield, appearances: 20, oddsProb: 0.4 };
    expect(fvaOf({ ...priced, minutes: 30 }).goals).toBeCloseTo(fvaOf(priced).goals, 9);
  });
});

describe('recentMv: the next match weighs the present (23/10/2026)', () => {
  it('leaves the sheet MV alone without votes, and moves toward recent votes with them', () => {
    expect(recentMv(6.2, [])).toBe(6.2);
    expect(recentMv(null, [5])).toBeNull();
    const low = recentMv(6.2, [5.5, 5.5, 5.5, 5.5])!;
    expect(low).toBeLessThan(6.2);
    expect(low).toBeGreaterThan(5.5);
    // Four equal votes at K 10 move the prior by a bit under 4/14 of the gap (the decay trims the old ones).
    expect(6.2 - low).toBeLessThan((0.7 * 4) / (RECENT_MV_K + 4));
  });

  it('weighs a recent vote more than an old one', () => {
    expect(recentMv(6, [5, 7])!).toBeGreaterThan(recentMv(6, [7, 5])!);
  });

  it('moves the FVA without a price: the rest of the bonus is still derived from the SHEET MV', () => {
    const plain = fvaOf(outfield).value!;
    const next = fvaOf({ ...outfield, mvNext: 6.0 }).value!;
    expect(plain - next).toBeCloseTo(0.5, 9);
  });
});
