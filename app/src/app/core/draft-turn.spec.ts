import type { HorizonStep } from './auction-plan';
import { TURN_PICKS, TurnInput, TurnMan, goneUpTo, turnScores } from './draft-turn';

const man = (id: number, over: Partial<TurnMan> = {}): TurnMan => ({
  id,
  price: 10,
  group: 'a',
  fert: 0.1,
  cover: 0.5,
  ...over,
});

/** Two rivals: the rest of this round, then three future rounds with their projected values. */
const STEPS: HorizonStep[] = [
  { playerId: 11, round: 0, value: null },
  { playerId: 12, round: 0, value: null },
  { playerId: 13, round: 1, value: 400 },
  { playerId: null, round: 1, value: 450 },
  { playerId: 14, round: 2, value: 420 },
  { playerId: 15, round: 2, value: 500 },
  { playerId: 16, round: 3, value: 440 },
  { playerId: 17, round: 3, value: 560 },
];

/** Our zero-priced turns: first in every future round (we spent nothing). */
const MY_TURNS = [2, 4, 6];

const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  men: [],
  steps: STEPS,
  myTurns: MY_TURNS,
  orderType: 'default',
  myValue: 0,
  picksLeft: TURN_PICKS,
  canPick: () => true,
  exactOn: () => new Map(),
  ...over,
});

describe('goneUpTo', () => {
  it('counts every call of the earlier rounds, and of its own round only the callers a DEAR chain lets before us', () => {
    // Cheap pick: we stay first in the next round, only this round's two calls precede our second pick.
    expect(goneUpTo(STEPS, MY_TURNS, 'default', 0, [100])).toEqual({ wait: 2, gone: new Set([11, 12]) });
    // Dear pick: the 400 squad calls before us; a caller with nobody to take still spends a turn.
    expect(goneUpTo(STEPS, MY_TURNS, 'default', 0, [410])).toEqual({ wait: 3, gone: new Set([11, 12, 13]) });
    expect(goneUpTo(STEPS, MY_TURNS, 'default', 0, [460]).wait).toBe(4);
    // A tie goes to us, `positionAfterSpending`'s own comparison: strictly cheaper callers only.
    expect(goneUpTo(STEPS, MY_TURNS, 'default', 0, [400]).wait).toBe(2);
    // Before the THIRD pick every round-1 call counts (they all precede our round-2 turn), and the chain's
    // accumulated spend decides the round-2 callers: 100 + 330 = 430 lets the 420 squad pass us too.
    expect(goneUpTo(STEPS, MY_TURNS, 'default', 0, [100, 10]).gone).toEqual(new Set([11, 12, 13]));
    expect(goneUpTo(STEPS, MY_TURNS, 'default', 0, [100, 330]).gone).toEqual(new Set([11, 12, 13, 14]));
  });

  it('on a snake reads the positional prefix of each turn: the prices move nothing', () => {
    expect(goneUpTo(STEPS, MY_TURNS, 'pingpong', 0, [1])).toEqual(goneUpTo(STEPS, MY_TURNS, 'pingpong', 0, [999]));
    expect(goneUpTo(STEPS, MY_TURNS, 'pingpong', 0, [1])).toEqual({ wait: 2, gone: new Set([11, 12]) });
    expect(goneUpTo(STEPS, MY_TURNS, 'pingpong', 0, [1, 1]).gone).toEqual(new Set([11, 12, 13]));
    expect(goneUpTo(STEPS, MY_TURNS, 'pingpong', 0, [1, 1, 1]).gone).toEqual(new Set([11, 12, 13, 14, 15]));
  });
});

describe('turnScores', () => {
  it('is «take who will be gone» as a chain: the contested man beats his equal whose twin survives', () => {
    // X (id 11) is predicted TAKEN before our next turn; Y is worth the same but his twin survives. Taking X
    // now keeps Y's group for the next pick at full value; taking Y now leaves only the twin, whose re-measure
    // on the pitch WITH Y collapses (starter + reserve of one group), and X is gone. So X ranks first.
    const x = man(11, { group: 'dc', fert: 0.3 });
    const y = man(2, { group: 'pc', fert: 0.3 });
    const twinOfY = man(31, { group: 'pc', fert: 0.29 });
    const exactOn: TurnInput['exactOn'] = (_taken, candidates) =>
      new Map(candidates.map((one) => [one.id, 0.02]));
    const out = turnScores(input({ men: [x, y, twinOfY], exactOn, picksLeft: 2 }));
    expect(out.get(11)!.picks.map((pick) => pick.id)).toEqual([2]);
    expect(out.get(11)!.score).toBeCloseTo(0.3 + 0.3, 9);
    expect(out.get(2)!.picks.map((pick) => pick.id)).toEqual([31]);
    expect(out.get(2)!.score).toBeCloseTo(0.3 + 0.02, 9);
    expect(out.get(11)!.score).toBeGreaterThan(out.get(2)!.score);
  });

  it('a dear pick pays its wait across the chain: losing one target slides every later pick down to the tail', () => {
    const dear = man(1, { group: 'dc', fert: 0.3, price: 500 });
    const cheap = man(2, { group: 'dc', fert: 0.3, price: 10 });
    const next1 = man(13, { group: 'pc', fert: 0.25 });
    const next2 = man(14, { group: 'w', fert: 0.2 });
    const next3 = man(16, { group: 'm', fert: 0.15 });
    const tail = man(99, { group: 't', fert: 0.05 });
    // 13 sits with the 400 squad: the cheap chain keeps him, the dear one loses him at once and its whole
    // chain slides one place down, paying the tail man at the fourth pick.
    const out = turnScores(input({ men: [dear, cheap, next1, next2, next3, tail] }));
    expect(out.get(2)!.picks.map((pick) => pick.id)).toEqual([13, 14, 16]);
    expect(out.get(2)!.score).toBeCloseTo(0.3 + 0.25 + 0.2 + 0.15, 9);
    expect(out.get(1)!.picks.map((pick) => pick.id)).toEqual([14, 16, 99]);
    expect(out.get(1)!.score).toBeCloseTo(0.3 + 0.2 + 0.15 + 0.05, 9);
    expect(out.get(1)!.wait).toBeGreaterThan(out.get(2)!.wait);
  });

  it('re-measures ONLY the used-group tops that would otherwise win, on the pitch with the chain', () => {
    const first = man(1, { group: 'dc', fert: 0.3 });
    const sameTop = man(2, { group: 'dc', fert: 0.28 });
    const sameLow = man(3, { group: 'dc', fert: 0.05 });
    const other = man(4, { group: 'pc', fert: 0.2 });
    const asked: number[][] = [];
    const exactOn: TurnInput['exactOn'] = (_taken, candidates) => {
      asked.push(candidates.map((one) => one.id));
      return new Map(candidates.map((one) => [one.id, 0.01]));
    };
    const out = turnScores(input({ men: [first, sameTop, sameLow, other], exactOn, picksLeft: 2 }));
    // The used-group top collapses on the exact pitch, so the fresh group's best stands...
    expect(out.get(1)!.picks.map((pick) => pick.id)).toEqual([4]);
    expect(out.get(1)!.score).toBeCloseTo(0.3 + 0.2, 9);
    // ...and the used-group man already UNDER that bar was never re-measured: a cached loser stays a loser.
    expect(asked.find((ids) => ids.includes(3))).toBeUndefined();
  });

  it('a used-group man whose exact re-measure still wins IS the next pick', () => {
    const first = man(1, { group: 'dc', fert: 0.3 });
    const sameTop = man(2, { group: 'dc', fert: 0.28 });
    const other = man(4, { group: 'pc', fert: 0.1 });
    const exactOn: TurnInput['exactOn'] = (_taken, candidates) =>
      new Map(candidates.map((one) => [one.id, 0.15]));
    const out = turnScores(input({ men: [first, sameTop, other], exactOn, picksLeft: 2 }));
    expect(out.get(1)!.picks.map((pick) => pick.id)).toEqual([2]);
    expect(out.get(1)!.score).toBeCloseTo(0.3 + 0.15, 9);
  });

  it('skips a pick the rules refuse, and a man with an unknown fertility gets no score at all', () => {
    const first = man(1, { group: 'dc', fert: 0.3 });
    const illegal = man(2, { group: 'pc', fert: 0.29 });
    const legal = man(3, { group: 'w', fert: 0.1 });
    const unknown = man(4, { group: 't', fert: null });
    const out = turnScores(input({
      men: [first, illegal, legal, unknown],
      picksLeft: 2,
      canPick: (_taken, candidate) => candidate.id !== 2,
    }));
    expect(out.get(1)!.picks.map((pick) => pick.id)).toEqual([3]);
    expect(out.has(4)).toBe(false);
  });

  it('on our LAST pick the score is his own fertility alone, and says so', () => {
    const out = turnScores(input({ men: [man(1, { fert: 0.3 })], picksLeft: 1 }));
    expect(out.get(1)).toEqual({ score: 0.3, picks: [], wait: 0, last: true });
  });
});
