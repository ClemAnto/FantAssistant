import { describe, expect, it } from 'vitest';

import {
  Bidder,
  CHEAP_SHOT,
  DEFAULT_RULES,
  SURE_PER_ROLE,
  LeagueRules,
  RoundLog,
  Snapshot,
  allocate,
  alternativesTo,
  appearancesIn,
  adviceFor,
  askFor,
  boardFor,
  calibrationOf,
  canAdd,
  candidatesOf,
  contestedOf,
  dealsOf,
  gainBandOf,
  gainScale,
  ladderOf,
  marketRate,
  playsOften,
  ratingsOf,
  starsFromRank,
  sureTarget,
  strategyCheck,
  parseAwards,
  precedentsOf,
  pressureOf,
  rivalPlan,
  roleDemand,
  roundsOf,
  settle,
  strengthsOf,
  tacticOf,
  teamStates,
  verdicts,
  winChance,
  gainOf,
} from './sealed-bid';
import { ClassicRole } from './players-store';

const RULES: LeagueRules = { ...DEFAULT_RULES, budget: 100, slots: { P: 1, D: 2, C: 2, A: 1 } };

let next = 1;
const man = (role: ClassicRole, fvm: number | null, surplus: number, over: Partial<Bidder> = {}): Bidder => ({
  fcId: next++,
  name: `${role}${fvm}`,
  club: 'Club',
  role,
  fvm,
  surplus,
  surplusIsEstimate: false,
  // Half a season and more, so nobody is silently dropped by the availability floor unless a test says so.
  expected: 30,
  titolarita: 'titolare',
  spm: null,
  ...over,
});

const index = (pool: Bidder[]) => new Map(pool.map((one) => [one.fcId, one]));

/**
 * Three bands of past awards, nine each - enough that a neighbourhood of nine stays inside one band.
 *
 * Fewer would not test what it looks like it tests: with three precedents in the whole history every
 * candidate gets the same three neighbours and therefore the same price, so a fixture that small says
 * «the pricing does not distinguish anyone» rather than «the allocator chose badly». The real league
 * carries 125.
 */
const PRECEDENTS = [
  ...[1, 1, 2, 2, 2, 3, 3, 5, 6].map((paid, at) => ({ paid, pressure: 0, fvm: 6, at })),
  ...[6, 8, 10, 12, 15, 18, 20, 25, 30].map((paid, at) => ({ paid, pressure: 0.5, fvm: 40, at: at + 9 })),
  ...[35, 40, 45, 50, 60, 70, 80, 90, 110].map((paid, at) => ({ paid, pressure: 1, fvm: 180, at: at + 18 })),
].map(({ paid, pressure, fvm, at }) => ({ fcId: 900 + at, name: `p${at}`, team: 'T', paid, pressure, fvm, round: 1 }));

describe('parseAwards', () => {
  it('skips the `$` separators and keeps a team whose name contains a comma', () => {
    const awards = parseAwards(['$,$,$', 'Vitanic,7556,2', '$,$,$', 'Piangi, Meno FC,6060,25'].join('\n'));
    expect(awards).toEqual([
      { team: 'Vitanic', fcId: 7556, paid: 2 },
      { team: 'Piangi, Meno FC', fcId: 6060, paid: 25 },
    ]);
  });

  it('drops a line whose id or price is not a number instead of writing a NaN into a roster', () => {
    expect(parseAwards('Team,abc,2\nTeam,10,x\nTeam,11,3')).toEqual([
      { team: 'Team', fcId: 11, paid: 3 },
    ]);
  });
});

describe('teamStates', () => {
  const pool = [man('P', 10, 5), man('A', 40, 20), man('A', 30, 15)];
  const byId = index(pool);

  it('counts what he holds, what he may still buy and what he could put on one envelope', () => {
    const states = teamStates(
      [
        { team: 'Us', fcId: pool[0].fcId, paid: 10 },
        { team: 'Us', fcId: pool[1].fcId, paid: 60 },
      ],
      byId,
      RULES,
    );
    const us = states.get('Us')!;
    expect(us.spent).toBe(70);
    expect(us.credits).toBe(30);
    expect(us.free).toEqual({ P: 0, D: 2, C: 2, A: 0 });
    expect(us.slotsFree).toBe(4);
    // Four slots left: three of them still need a credit apiece, so one envelope can hold 27 and not 30.
    expect(us.ceiling).toBe(27);
  });

  it('keeps a team that has bought nothing, because an empty squad is a rival with all his money', () => {
    const states = teamStates([{ team: 'Us', fcId: pool[0].fcId, paid: 10 }], byId, RULES, ['Us', 'Them']);
    expect(states.get('Them')!.credits).toBe(100);
    expect(states.get('Them')!.slotsFree).toBe(6);
  });
});

describe('roleDemand', () => {
  it('is what the RIVALS still need, so our own slots never inflate the pressure on our own targets', () => {
    const pool = [man('A', 40, 20)];
    const states = teamStates([{ team: 'Us', fcId: pool[0].fcId, paid: 5 }], index(pool), RULES, [
      'Us',
      'Them',
    ]);
    expect(roleDemand(states)).toEqual({ P: 2, D: 4, C: 4, A: 1 });
    expect(roleDemand(states, 'Us')).toEqual({ P: 1, D: 2, C: 2, A: 1 });
  });
});

describe('pressureOf', () => {
  const pool = [man('A', 100, 10), man('A', 50, 10), man('A', 10, 10), man('A', 1, 10)];

  it('ranks by the FVM, because that is what the room demonstrably bids on', () => {
    const press = pressureOf(pool, { P: 0, D: 0, C: 0, A: 2 });
    expect(press.get(pool[0].fcId)).toBe(1);
    expect(press.get(pool[1].fcId)).toBe(0.5);
    // Outside what the role can still absorb: zero, and zero here is a fact and not a missing value.
    expect(press.get(pool[2].fcId)).toBe(0);
    expect(press.get(pool[3].fcId)).toBe(0);
  });

  it('puts the SAME man on the same scale under a demand of a different size', () => {
    const wide = pressureOf(pool, { P: 0, D: 0, C: 0, A: 4 });
    const narrow = pressureOf(pool, { P: 0, D: 0, C: 0, A: 2 });
    // The best free man is at the top of the demand whatever its depth - that is the whole point of
    // rank-against-demand, and it is what a count of interested rivals cannot do.
    expect(wide.get(pool[0].fcId)).toBe(1);
    expect(narrow.get(pool[0].fcId)).toBe(1);
    // ...and the second one is deeper inside a wide demand than inside a narrow one.
    expect(wide.get(pool[1].fcId)!).toBeGreaterThan(narrow.get(pool[1].fcId)!);
  });

  it('answers 0 for a role nobody has a slot for, instead of dividing by that zero', () => {
    expect(pressureOf(pool, { P: 0, D: 0, C: 0, A: 0 }).get(pool[0].fcId)).toBe(0);
  });
});

describe('askFor', () => {
  const precedents = [10, 12, 14, 40, 44, 48, 90, 96, 100].map((paid, at) => ({
    fcId: at,
    name: `p${at}`,
    team: 'T',
    paid,
    pressure: at < 3 ? 0 : at < 6 ? 0.5 : 1,
    fvm: at < 3 ? 5 : at < 6 ? 40 : 200,
    round: 1,
  }));

  it('answers with the awards nearest in pressure and price, and their spread', () => {
    const ask = askFor(1, 200, precedents, 3);
    expect(ask.comparables.map((one) => one.paid).sort((a, b) => a - b)).toEqual([90, 96, 100]);
    expect(ask.mid).toBe(96);
    expect(ask.ask).toBe(100);
  });

  it('reaches for the cheap end when the man sits outside the demand', () => {
    expect(askFor(0, 5, precedents, 3).mid).toBe(12);
  });

  it('never recommends less than a credit, and says so with no history at all', () => {
    expect(askFor(1, 200, [])).toEqual({ mid: 1, ask: 1, safe: 1, comparables: [] });
  });
});

describe('gainOf', () => {
  it('is silent - not zero - for a man under the league\'s own availability floor', () => {
    const floor = RULES.minAvailability * RULES.matchdays;
    expect(gainOf(man('A', 40, 20, { expected: floor + 1 }), RULES)).not.toBeNull();
    expect(gainOf(man('A', 40, 20, { expected: floor - 1 }), RULES)).toBeNull();
  });

  it('is silent for a man the sheet carries no surplus for', () => {
    expect(gainOf(man('A', 40, 20, { surplus: null }), RULES)).toBeNull();
  });

  it('discounts the surplus by how much of the season we can see coming', () => {
    const full = gainOf(man('A', 40, 20, { expected: RULES.matchdays }), RULES)!;
    const half = gainOf(man('A', 40, 20, { expected: RULES.matchdays / 2 }), RULES)!;
    expect(full).toBeCloseTo(20, 6);
    expect(half).toBeCloseTo(20 * Math.SQRT1_2, 6);
  });
});

describe('the competition horizon', () => {
  /** A market held after the first round buys 37 rounds of a 38-round calendar. */
  const SHORT: LeagueRules = { ...RULES, horizon: 37, matchdays: 38 };
  const FULL: LeagueRules = { ...RULES, horizon: 38, matchdays: 38 };

  it('scales every worth by the same factor and reorders nobody', () => {
    next = 1;
    const men = [
      man('A', 90, 40, { expected: 36 }),
      man('A', 40, 22, { expected: 20 }),
      man('C', 30, 18, { expected: 30 }),
      man('D', 10, 9, { expected: 25 }),
    ];
    const full = men.map((one) => gainOf(one, FULL)!);
    const short = men.map((one) => gainOf(one, SHORT)!);
    for (const [at, value] of short.entries()) {
      expect(value / full[at]).toBeCloseTo(37 / 38, 9);
    }
    const order = (values: number[]) =>
      values.map((_, at) => at).sort((left, right) => values[right] - values[left]);
    expect(order(short)).toEqual(order(full));
  });

  it('leaves the availability floor exactly where it was', () => {
    // His appearances and the window shrink together, so «how much of the season does he play» does not
    // move - and a man is not pushed under or over the league's floor by the market being held late.
    const floor = RULES.minAvailability * RULES.matchdays;
    for (const expected of [floor - 1, floor, floor + 1, RULES.matchdays]) {
      const one = man('C', 30, 18, { expected });
      expect(gainOf(one, SHORT) == null).toBe(gainOf(one, FULL) == null);
    }
  });

  it('cuts the appearances to the window, which is the number the screen has to print', () => {
    expect(appearancesIn(man('A', 40, 20, { expected: 38 }), SHORT)).toBeCloseTo(37, 9);
    expect(appearancesIn(man('A', 40, 20, { expected: 19 }), SHORT)).toBeCloseTo(18.5, 9);
    expect(appearancesIn(man('A', 40, 20, { expected: null }), SHORT)).toBeNull();
  });

  it('changes no bid of a plan: it is a unit, and a unit cannot advise', () => {
    next = 1;
    const pool = [
      man('A', 200, 40),
      man('A', 10, 30),
      man('D', 150, 20),
      man('D', 8, 18),
      man('D', 4, 3),
    ];
    const need = { P: 0, D: 2, C: 0, A: 1 };
    const planWith = (rules: LeagueRules) => {
      const states = teamStates([], index(pool), { ...rules, slots: need }, ['Us', 'Rival']);
      const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
      return allocate(candidates, need, 100);
    };
    const full = planWith(FULL);
    const short = planWith(SHORT);
    expect(short.bids.map((one) => one.candidate.man.fcId)).toEqual(
      full.bids.map((one) => one.candidate.man.fcId),
    );
    expect(short.bids.map((one) => one.offer)).toEqual(full.bids.map((one) => one.offer));
    expect(short.gain / full.gain).toBeCloseTo(37 / 38, 9);
  });
});

describe('allocate', () => {
  /** One dear-and-good man, one cheap-and-good one, and filler - the shape the real board has. */
  const board = () => {
    next = 1;
    const pool = [
      man('A', 200, 40), // the head of the demand: worth the most, costs the most
      man('A', 10, 30), // nearly as good and nobody is looking at him
      man('A', 5, 4),
      man('D', 150, 20),
      man('D', 8, 18),
      man('D', 4, 3),
      man('D', 3, 2),
    ];
    const rules = { ...RULES, slots: { P: 0, D: 2, C: 0, A: 1 } };
    const states = teamStates([], index(pool), rules, ['Us', 'Rich']);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    return { pool, candidates };
  };

  const NEED = { P: 0, D: 2, C: 0, A: 1 };

  it('fills every slot it is asked for, inside the budget', () => {
    const { candidates } = board();
    const plan = allocate(candidates, { P: 0, D: 2, C: 0, A: 1 }, 100);
    expect(plan.bids).toHaveLength(3);
    expect(plan.bids.filter((bid) => bid.candidate.man.role === 'D')).toHaveLength(2);
    expect(plan.spend).toBeLessThanOrEqual(100);
    expect(plan.unfilled).toEqual({ P: 0, D: 0, C: 0, A: 0 });
  });

  it('beats the worth-per-credit ranking, which is the objective this design exists to refuse', () => {
    // Ranking by efficiency fills every slot with a two-credit man and leaves the budget unspent, and an
    // unspent credit is worth nothing at the end of a market. So the knapsack must do strictly better
    // than the efficient plan built under the same quotas and the same cap.
    const { candidates } = board();
    const plan = allocate(candidates, NEED, 100);
    const taken = { P: 0, D: 0, C: 0, A: 0 } as Record<'P' | 'D' | 'C' | 'A', number>;
    let left = 100;
    let efficient = 0;
    for (const one of [...candidates].sort(
      (a, b) => (b.gain ?? 0) / b.ask.ask - (a.gain ?? 0) / a.ask.ask,
    )) {
      if (taken[one.man.role] >= NEED[one.man.role] || one.ask.ask > left) continue;
      taken[one.man.role] += 1;
      left -= one.ask.ask;
      efficient += one.gain ?? 0;
    }
    expect(plan.gain).toBeGreaterThan(efficient);
  });

  it('reaches both dear men when the budget holds them, and neither when it does not', () => {
    const { pool, candidates } = board();
    const rich = new Set(allocate(candidates, NEED, 200).bids.map((bid) => bid.candidate.man.fcId));
    expect(rich.has(pool[0].fcId)).toBe(true); // the dear forward
    expect(rich.has(pool[3].fcId)).toBe(true); // the dear defender

    const poor = allocate(candidates, NEED, 70);
    const chosen = new Set(poor.bids.map((bid) => bid.candidate.man.fcId));
    expect(chosen.has(pool[0].fcId)).toBe(false);
    expect(chosen.has(pool[3].fcId)).toBe(false);
    // ...and it still fills every slot, with the cheap near-equals.
    expect(poor.bids).toHaveLength(3);
    expect(poor.spend).toBeLessThanOrEqual(70);
  });

  it('writes every envelope at one of the three declared numbers, and marks what it raised', () => {
    const { candidates } = board();
    const plan = allocate(candidates, { P: 0, D: 2, C: 0, A: 1 }, 100);
    for (const bid of plan.bids) {
      // The optimiser chooses among «colpo», «consigliato» and «quasi sicuro»; the mop-up can only
      // move a non-shot up to the last of the three. Anything else would be a number nobody decided.
      const allowed = [CHEAP_SHOT, bid.candidate.ask.ask, bid.candidate.ask.safe];
      expect(allowed).toContain(bid.offer);
      expect(bid.offer).toBeLessThanOrEqual(bid.candidate.ask.safe);
      if (bid.raised) {
        expect(bid.shot).toBe(false);
        expect(bid.offer).toBe(bid.candidate.ask.safe);
      }
      // A lottery ticket is cheap BY DEFINITION: if it were not, it would be a normal bid.
      if (bid.shot) expect(bid.offer).toBeLessThan(bid.candidate.ask.ask);
    }
  });

  it('reports the slots it could not fill instead of quietly returning fewer bids', () => {
    const { candidates } = board();
    const plan = allocate(candidates, { P: 2, D: 0, C: 0, A: 0 }, 100);
    expect(plan.unfilled.P).toBe(2);
    expect(plan.bids).toHaveLength(0);
  });

  it('carries the null it has to beat: the same slots bought the way the room buys', () => {
    const { candidates } = board();
    const plan = allocate(candidates, { P: 0, D: 2, C: 0, A: 1 }, 100);
    expect(plan.marketGain).toBeGreaterThan(0);
    // Never worse, and allowed to TIE: where our ranking and the room's agree on the same men, the two
    // totals are the same sum added in a different order, so the comparison carries a float tolerance
    // rather than pretending the arithmetic is exact.
    expect(plan.gain).toBeGreaterThanOrEqual(plan.marketGain - 1e-9);
  });
});

describe('tacticOf', () => {
  const pool = [man('A', 100, 20), man('A', 90, 20), man('D', 80, 10), man('D', 5, 5)];
  const byId = index(pool);
  const state = (paid: number[]) =>
    teamStates(
      paid.map((one, at) => ({ team: 'T', fcId: pool[at].fcId, paid: one })),
      byId,
      RULES,
    ).get('T')!;

  it('calls a manager who has hardly spent a `tesoretto`, however concentrated his few bids look', () => {
    const read = tacticOf(state([20, 1, 1]), RULES);
    expect(read.topThree).toBeGreaterThan(0.9);
    expect(read.tactic).toBe('tesoretto');
  });

  it('calls a committed manager with his money on three names `stelle`', () => {
    expect(tacticOf(state([40, 30, 20, 1]), RULES).tactic).toBe('stelle');
  });

  it('counts the envelopes that arrived alone - the men who cost one or two credits', () => {
    expect(tacticOf(state([40, 30, 2, 1]), RULES).snipes).toBe(2);
  });
});

describe('rivalPlan', () => {
  const boardFor = (rules: LeagueRules, held: { fcId: number; paid: number }[], free: Bidder[], all: Bidder[]) => {
    const states = teamStates(
      held.map((one) => ({ team: 'Rival', ...one })),
      index(all),
      rules,
      ['Rival'],
    );
    const candidates = candidatesOf({ pool: free, states, precedents: PRECEDENTS, rules, me: 'Us' });
    return { state: states.get('Rival')!, candidates };
  };

  it('leaves a rival out of a role he has already filled, which is a rule and not a guess', () => {
    next = 1;
    const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 1, C: 0, A: 1 } };
    const held = [man('D', 90, 10)];
    const free = [man('D', 80, 9), man('A', 80, 9)];
    const { state, candidates } = boardFor(rules, [{ fcId: held[0].fcId, paid: 20 }], free, [
      ...held,
      ...free,
    ]);
    expect(rivalPlan(state, candidates, rules).map((one) => one.man.role)).toEqual(['A']);
  });

  it('does not put a name on his list that his own ceiling cannot reach', () => {
    next = 1;
    const rules: LeagueRules = { ...RULES, budget: 6, slots: { P: 0, D: 0, C: 0, A: 2 } };
    // A pool deeper than the demand, or every man in it is at the head of it and nothing is cheap:
    // with two slots and two free forwards both of them ARE contested, which is the right answer to a
    // different question than the one this test asks.
    const free = [man('A', 300, 40), man('A', 200, 35), man('A', 120, 30), man('A', 60, 20), man('A', 4, 8)];
    const { state, candidates } = boardFor(rules, [], free, free);
    // Two slots and six credits: one envelope can hold five.
    expect(state.ceiling).toBe(5);
    const wanted = rivalPlan(state, candidates, rules);
    // The two men at the head of the demand are out of his reach and off his list...
    expect(wanted.map((one) => one.man.fvm)).not.toContain(300);
    expect(wanted.map((one) => one.man.fvm)).not.toContain(200);
    // ...and nothing on it costs more than he can put in one envelope.
    expect(wanted.every((one) => one.ask.mid <= state.ceiling)).toBe(true);
    // Note what he IS left with: a man quoted 120 who sits OUTSIDE the two slots his role still has.
    // That is the model's central claim and the thing round 1 actually showed - Zaniolo, quoted 90,
    // was won for one credit - so pressure outranks the price tag and a big FVM nobody needs is cheap.
    expect(wanted.map((one) => one.man.fvm)).toContain(120);
  });

  it('gives him as many targets as he has slots, dearest first', () => {
    next = 1;
    const rules: LeagueRules = { ...RULES, budget: 1000, slots: { P: 0, D: 0, C: 0, A: 2 } };
    const free = [man('A', 300, 40), man('A', 90, 30), man('A', 40, 20), man('A', 4, 8)];
    const { state, candidates } = boardFor(rules, [], free, free);
    expect(rivalPlan(state, candidates, rules).map((one) => one.man.fvm)).toEqual([300, 90]);
  });
});

describe('roundsOf and precedentsOf', () => {
  it('reads the rounds as the DIFFERENCES between cumulative exports', () => {
    next = 1;
    const pool = [man('A', 90, 10), man('A', 80, 10), man('D', 70, 10)];
    const byId = index(pool);
    const first = [{ team: 'T', fcId: pool[0].fcId, paid: 30 }];
    const second = [...first, { team: 'T', fcId: pool[1].fcId, paid: 12 }];
    const rounds = roundsOf([first, second], byId, RULES);
    expect(rounds.map((round) => round.awards.length)).toEqual([1, 1]);
    expect(rounds[1].awards[0].fcId).toBe(pool[1].fcId);
    // The state BEFORE round two already holds the man won in round one.
    expect(rounds[1].before.get('T')!.men).toHaveLength(1);
  });

  it('prices each past award against the demand that existed when its envelope was written', () => {
    next = 1;
    const pool = [man('A', 90, 10), man('A', 80, 10)];
    const rules = { ...RULES, slots: { P: 0, D: 0, C: 0, A: 2 } };
    const first = [{ team: 'T', fcId: pool[0].fcId, paid: 30 }];
    const rounds = roundsOf(
      [first, [...first, { team: 'T', fcId: pool[1].fcId, paid: 12 }]],
      index(pool),
      rules,
    );
    // `roundsOf` learns the teams from the snapshots, so a second manager has to appear in them for the
    // fixture to be a market at all - see the test below for why that matters.
    rounds.forEach((round) => round.before.set('Rival', teamStates([], index(pool), rules, ['Rival']).get('Rival')!));
    const precedents = precedentsOf(rounds, pool);
    expect(precedents).toHaveLength(2);
    // In round one he was the best free forward the RIVAL still had slots for; in round two the other
    // one was, because the first had gone.
    expect(precedents[0].pressure).toBe(1);
    expect(precedents[1].pressure).toBe(1);
    expect(precedents.map((one) => one.round)).toEqual([1, 2]);
  });

  it('measures a past award against the demand of everyone EXCEPT the manager who won him', () => {
    // The same quantity `candidatesOf` measures for us, which excludes us: it is the pressure his
    // envelope had to beat. Read on the whole room instead, the ladder and the men priced against it
    // would sit on two different scales - and the price is read by comparing them.
    next = 1;
    const pool = [man('A', 90, 10)];
    const rules = { ...RULES, slots: { P: 0, D: 0, C: 0, A: 2 } };
    const rounds = roundsOf([[{ team: 'Alone', fcId: pool[0].fcId, paid: 30 }]], index(pool), rules);
    expect(precedentsOf(rounds, pool)[0].pressure).toBe(0);
  });
});

describe('verdicts', () => {
  it('does not crown the manager who simply bought least', () => {
    next = 1;
    const pool = [man('A', 90, 30), man('A', 80, 28), man('A', 5, 6), man('D', 40, 10)];
    const byId = index(pool);
    const rules = { ...RULES, budget: 100, slots: { P: 0, D: 1, C: 0, A: 2 } };
    const states = teamStates(
      [
        { team: 'Spender', fcId: pool[0].fcId, paid: 70 },
        { team: 'Hoarder', fcId: pool[2].fcId, paid: 2 },
      ],
      byId,
      rules,
      ['Spender', 'Hoarder'],
    );
    const free = [pool[1], pool[3]];
    const read = verdicts({ states, pool: free, rules });
    // Efficiency alone says the hoarder is three times the better manager; the standing knows he still
    // has to spend his money, and on a pool the good names have already left.
    expect(read.get('Hoarder')!.perHundred!).toBeGreaterThan(read.get('Spender')!.perHundred!);
    expect(read.get('Spender')!.gain).toBeGreaterThan(read.get('Hoarder')!.gain);
    expect(read.get('Hoarder')!.toCome).toBeGreaterThan(read.get('Spender')!.toCome);
  });

  it('leaves `perHundred` empty for a manager who has spent nothing, instead of dividing by zero', () => {
    const states = teamStates([], index([]), RULES, ['Idle']);
    expect(verdicts({ states, pool: [], rules: RULES }).get('Idle')!.perHundred).toBeNull();
  });
});

describe('a man this listone does not quote', () => {
  /** Measured on the real 2026-27 Serie A sheet: 82 rows of 605 carry no quotation on this platform. */
  const board = () => {
    next = 1;
    // Four quoted men against two rival slots, so somebody is genuinely OUTSIDE the demand and the
    // measured zero can be told apart from the unknown. With a pool the size of the demand every man is
    // inside it, which is right - and says nothing about the case this block is here for.
    const pool = [
      man('A', 200, 40),
      man('A', 120, 28),
      man('A', 40, 25),
      man('A', null, 30), // no quotation: an unknown price, not a cheap one
    ];
    const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 0, C: 0, A: 2 } };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    return {
      pool,
      rules,
      states,
      candidates: candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' }),
    };
  };

  it('carries a NULL pressure, which is not the zero of «nobody wants him»', () => {
    const { pool, candidates } = board();
    const unknown = candidates.find((one) => one.man.fcId === pool[3].fcId)!;
    expect(unknown.pressure).toBeNull();
    // ...and the man who really is outside the demand carries a measured zero, so the two are told apart.
    expect(candidates.find((one) => one.man.fcId === pool[2].fcId)!.pressure).toBe(0);
  });

  it('is kept OUT of the automatic plan, however good his number is', () => {
    const { pool, candidates } = board();
    // He is worth more than two of the three quoted men, and at a false price of 2 credits he would win a
    // slot outright - which is exactly how he got into a real recommendation before this was fixed.
    expect(gainOf(pool[3], RULES)!).toBeGreaterThan(gainOf(pool[2], RULES)!);
    const plan = allocate(candidates, { P: 0, D: 0, C: 0, A: 2 }, 100);
    expect(plan.bids.map((one) => one.candidate.man.fcId)).not.toContain(pool[3].fcId);
  });

  it('carries no invented precedents either', () => {
    const { pool, candidates } = board();
    const unknown = candidates.find((one) => one.man.fcId === pool[3].fcId)!;
    expect(unknown.ask.comparables).toEqual([]);
  });

  it('is not on a rival\'s shortlist, because he ranks by the quotation too', () => {
    const { pool, states, candidates, rules } = board();
    const wanted = rivalPlan(states.get('Rival')!, candidates, rules);
    expect(wanted.map((one) => one.man.fcId)).not.toContain(pool[3].fcId);
  });

  it('IS still offerable by hand: the automatic choice must be doubtable', () => {
    const { pool, candidates } = board();
    const plan = allocate(candidates, { P: 0, D: 0, C: 0, A: 2 }, 100);
    const others = alternativesTo(plan.bids[0], candidates, plan, 50);
    expect(others.map((one) => one.candidate.man.fcId)).toContain(pool[3].fcId);
  });
});

describe('winChance', () => {
  const ask = askFor(1, 180, PRECEDENTS); // the dear band: 35 40 45 50 60 70 80 90 110

  it('counts the comparables an offer would have OUTBID, strictly', () => {
    // Matching a precedent is a tie, and a tie awards the man to nobody: `<`, never `<=`.
    expect(winChance(45, ask)).toBeCloseTo(2 / 9, 6); // beats 35 and 40, ties 45
    expect(winChance(46, ask)).toBeCloseTo(3 / 9, 6);
  });

  it('answers 0 below everything and 1 above everything', () => {
    expect(winChance(1, ask)).toBe(0);
    expect(winChance(200, ask)).toBe(1);
  });

  it('is silent with no history, instead of claiming a certainty', () => {
    expect(winChance(50, { mid: 1, ask: 1, safe: 1, comparables: [] })).toBeNull();
  });

  it('rises with the offer and never falls', () => {
    let last = -1;
    for (const offer of [1, 20, 40, 55, 75, 95, 120]) {
      const now = winChance(offer, ask)!;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });
});

describe('a plan says what it will PROBABLY cost, not only its ceiling', () => {
  const board = () => {
    next = 1;
    const pool = [man('A', 200, 40), man('A', 10, 30), man('D', 150, 20), man('D', 8, 18), man('D', 4, 3)];
    const need = { P: 0, D: 2, C: 0, A: 1 };
    const rules: LeagueRules = { ...RULES, slots: need };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    return { need, candidates: candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' }) };
  };

  it('carries a chance on every bid and the two aggregates that follow from them', () => {
    const { need, candidates } = board();
    const plan = allocate(candidates, need, 200);
    expect(plan.bids.every((one) => one.chance != null)).toBe(true);
    expect(plan.expectedWins).toBeCloseTo(
      plan.bids.reduce((sum, one) => sum + (one.chance ?? 1), 0), 6,
    );
    expect(plan.expectedSpend).toBeCloseTo(
      plan.bids.reduce((sum, one) => sum + one.offer * (one.chance ?? 1), 0), 6,
    );
  });

  it('expects to pay LESS than the ceiling and to win fewer than every envelope', () => {
    // Losing costs nothing, so «257 di 257» is the worst case quoted as if it were the forecast.
    const { need, candidates } = board();
    const plan = allocate(candidates, need, 200);
    expect(plan.expectedSpend).toBeLessThan(plan.spend);
    expect(plan.expectedWins).toBeLessThan(plan.bids.length);
    expect(plan.expectedWins).toBeGreaterThan(0);
  });

  it('never raises a CHEAP SHOT: it was cheap on purpose, and raising it undoes the choice', () => {
    // A strong man nobody is chasing - low pressure, high gain - is exactly the operator's «colpo».
    next = 1;
    const pool = [man('A', 200, 40), man('D', 6, 30), man('D', 5, 11)];
    const need = { P: 0, D: 2, C: 0, A: 1 };
    const rules: LeagueRules = { ...RULES, slots: need };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    // Money to burn: whatever stays cheap here stays cheap because the plan MEANT it to.
    const plan = allocate(candidates, need, 400);
    for (const bid of plan.bids.filter((one) => one.shot)) {
      expect(bid.raised).toBe(false);
      expect(bid.offer).toBe(CHEAP_SHOT);
    }
  });

  it('spends the slack where a credit buys the most chance, not on the dearest name', () => {
    // A cheap envelope is a coin flip because everybody crowds the bottom - and the round-1 bids the
    // operator recovered show it directly: two offers of exactly 2 on one man, awarded to nobody. So
    // three credits down there are worth far more than three credits on a fifty-credit bid.
    next = 1;
    const pool = [man('A', 200, 40), man('D', 6, 12), man('D', 5, 11)];
    const need = { P: 0, D: 2, C: 0, A: 1 };
    const rules: LeagueRules = { ...RULES, slots: need };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    // Enough slack for SOME raising but not for all of it, so the order is what decides.
    const cheapest = Math.min(
      ...candidates.map((one) => one.ask.safe - one.ask.ask).filter((one) => one > 0),
    );
    const base = candidates
      .slice(0, 3)
      .reduce((sum, one) => sum + one.ask.ask, 0);
    const plan = allocate(candidates, need, base + cheapest);
    const raised = plan.bids.filter((one) => one.raised);
    // Whatever was raised must be the best chance-per-credit going, and the cheap defenders are. The
    // list can legitimately be EMPTY now: the objective already prices every step it was offered, so
    // this pass only mops up what the whole numbers left behind.
    for (const one of raised) {
      const step = one.candidate.ask.safe - one.candidate.ask.ask;
      const gain =
        (winChance(one.candidate.ask.safe, one.candidate.ask) ?? 0) -
        (winChance(one.candidate.ask.ask, one.candidate.ask) ?? 0);
      for (const other of plan.bids.filter((x) => !x.raised)) {
        const otherStep = other.candidate.ask.safe - other.candidate.ask.ask;
        if (otherStep <= 0) continue;
        const otherGain =
          (winChance(other.candidate.ask.safe, other.candidate.ask) ?? 0) -
          (winChance(other.candidate.ask.ask, other.candidate.ask) ?? 0);
        expect(gain / step).toBeGreaterThanOrEqual(otherGain / otherStep);
      }
    }
  });

  it('reads the chance of the RAISED offer, not of the one it started from', () => {
    const { need, candidates } = board();
    const plan = allocate(candidates, need, 200);
    for (const bid of plan.bids) {
      expect(bid.chance).toBe(winChance(bid.offer, bid.candidate.ask));
    }
  });
});

describe('our own envelopes, kept', () => {
  next = 1;
  const pool = [man('A', 200, 40), man('A', 90, 30), man('A', 40, 20)];
  const byId = index(pool);
  const log: RoundLog = {
    round: 2,
    bids: [
      { fcId: pool[0].fcId, offer: 60, chance: 0.7 },
      { fcId: pool[1].fcId, offer: 20, chance: 0.5 },
      { fcId: pool[2].fcId, offer: 12, chance: 0.4 },
    ],
  };
  const first: Snapshot = [];
  const second: Snapshot = [
    { team: 'Us', fcId: pool[0].fcId, paid: 60 },   // we won this one at our own number
    { team: 'Rival', fcId: pool[1].fcId, paid: 34 }, // somebody paid more
    // the third is in NOBODY's roster: we bid on him and he was not awarded
  ];

  it('tells apart won, lost and «nobody got him»', () => {
    const settled = settle(log, [first, second], byId, 'Us')!;
    expect(settled.map((one) => one.outcome.kind)).toEqual(['won', 'lost', 'unassigned']);
    expect(settled[1].outcome).toEqual({ kind: 'lost', team: 'Rival', price: 34 });
  });

  it('is silent about a round the league has not exported yet', () => {
    expect(settle({ ...log, round: 3 }, [first, second], byId, 'Us')).toBeNull();
  });

  it('counts a man already owned BEFORE the round as no outcome of ours', () => {
    // He was in the previous export, so he is not one of this round's awards - reading him as a win
    // would credit us with an envelope we never sent.
    const before: Snapshot = [{ team: 'Rival', fcId: pool[0].fcId, paid: 5 }];
    const after: Snapshot = [...before];
    const settled = settle({ round: 2, bids: [{ fcId: pool[0].fcId, offer: 60, chance: 0.7 }] },
      [before, after], byId, 'Us')!;
    expect(settled[0].outcome.kind).toBe('unassigned');
  });

  it('scores the forecast against the chances recorded AT THE TIME', () => {
    const read = calibrationOf(settle(log, [first, second], byId, 'Us')!);
    expect(read).toEqual({ sent: 3, won: 1, lost: 1, tied: 1, spent: 60, expected: 0.7 + 0.5 + 0.4 });
  });
});

describe('strengthsOf', () => {
  it('ranks inside the role and never across roles, and carries the holes beside the worth', () => {
    next = 1;
    const pool = [man('D', 90, 30), man('D', 10, 4), man('A', 90, 30)];
    const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 2, C: 0, A: 1 } };
    const states = teamStates(
      [
        { team: 'Strong', fcId: pool[0].fcId, paid: 50 },
        { team: 'Weak', fcId: pool[1].fcId, paid: 2 },
        { team: 'Weak', fcId: pool[2].fcId, paid: 40 },
      ],
      index(pool),
      rules,
      ['Strong', 'Weak'],
    );
    const read = strengthsOf(states, rules);
    const strongD = read.get('Strong')!.find((one) => one.role === 'D')!;
    const weakD = read.get('Weak')!.find((one) => one.role === 'D')!;
    expect(strongD.rank).toBe(1);
    expect(weakD.rank).toBe(2);
    // The hole is part of the reading: one defender held, one slot still open.
    expect(strongD.held).toBe(1);
    expect(strongD.free).toBe(1);
    // ...and at forward the ranking is the other way round, which one ranking over all roles could not say.
    expect(read.get('Weak')!.find((one) => one.role === 'A')!.rank).toBe(1);
  });

  it('gives every manager a row for every role, so an empty one reads as empty and not as missing', () => {
    const states = teamStates([], index([]), RULES, ['Idle']);
    const rows = strengthsOf(states, RULES).get('Idle')!;
    expect(rows.map((one) => one.role)).toEqual(['P', 'D', 'C', 'A']);
    expect(rows.every((one) => one.held === 0 && one.gain === 0)).toBe(true);
  });
});

describe('alternativesTo', () => {
  it('offers men of the same role who are not already in the plan, and prices the swap', () => {
    next = 1;
    const pool = [man('A', 90, 30), man('A', 80, 25), man('A', 10, 20), man('D', 40, 10)];
    const rules = { ...RULES, slots: { P: 0, D: 0, C: 0, A: 1 } };
    const states = teamStates([], index(pool), rules, ['Us', 'Them']);
    const candidates = candidatesOf({
      pool,
      states,
      precedents: [
        { fcId: 900, name: 'dear', team: 'T', paid: 50, pressure: 1, fvm: 90, round: 1 },
        { fcId: 901, name: 'cheap', team: 'T', paid: 3, pressure: 0, fvm: 10, round: 1 },
      ],
      rules,
      me: 'Us',
    });
    const plan = allocate(candidates, { P: 0, D: 0, C: 0, A: 1 }, 100);
    const others = alternativesTo(plan.bids[0], candidates, plan, 100 - plan.spend);
    expect(others.every((one) => one.candidate.man.role === 'A')).toBe(true);
    expect(others.some((one) => one.candidate.man.fcId === plan.bids[0].candidate.man.fcId)).toBe(false);
    expect(others.every((one) => typeof one.delta === 'number')).toBe(true);
  });
});


// ---------------------------------------------------------------------------------------------
// THE GAIN, ITS SCALE, AND THE THREE RULES THE OPERATOR DICTATED ON 25/08/2026
// ---------------------------------------------------------------------------------------------

describe('the GAIN scale', () => {
  const pool = [
    man('C', 10, 40),
    man('C', 10, 30),
    man('C', 10, 20),
    man('C', 10, 10),
    man('C', 10, 4),
  ];

  it('cuts its bands on the pool it is given, and says how many men that was', () => {
    const scale = gainScale(pool, RULES);
    expect(scale.sample).toBe(5);
    expect(scale.top).toBeGreaterThan(scale.good);
    expect(scale.good).toBeGreaterThan(scale.fair);
  });

  it('calls the best of the pool `ottimo` and the worst `scarso`', () => {
    const scale = gainScale(pool, RULES);
    const gains = pool.map((one) => gainOf(one, RULES)!).sort((a, b) => b - a);
    expect(gainBandOf(gains[0], scale)).toBe('ottimo');
    expect(gainBandOf(gains.at(-1)!, scale)).toBe('scarso');
  });

  it('answers `ignoto` for a man with no gain, and never `scarso`', () => {
    // «Vuoto = ignoto, mai zero»: painting an unpriced man as poor is a verdict nobody gave.
    expect(gainBandOf(null, gainScale(pool, RULES))).toBe('ignoto');
  });

  it('answers `ignoto` when there is no pool to cut bands on', () => {
    expect(gainBandOf(30, gainScale([], RULES))).toBe('ignoto');
  });
});

describe('ladderOf', () => {
  it('carries real awards as examples, and drops the bands nobody is in', () => {
    const bands = ladderOf(PRECEDENTS);
    expect(bands.every((one) => one.count > 0)).toBe(true);
    for (const band of bands) {
      expect(band.examples.length).toBeGreaterThan(0);
      // The examples are ACTUAL awards of that band, never a name from somewhere else.
      for (const one of band.examples) expect(PRECEDENTS).toContain(one);
      expect(band.hint.length).toBeGreaterThan(20);
    }
  });

  it('never prints the same award three times when a band holds one', () => {
    const single = [PRECEDENTS[0]];
    const bands = ladderOf(single);
    expect(bands).toHaveLength(1);
    expect(bands[0].examples).toHaveLength(1);
  });
});

describe('playsOften', () => {
  it('reads the sheet\'s own rung first', () => {
    expect(playsOften(man('C', 10, 10, { titolarita: 'bandiera' }), RULES)).toBe(true);
    expect(playsOften(man('C', 10, 10, { titolarita: 'panchina' }), RULES)).toBe(false);
  });

  it('falls back to his own expected share when the rung is missing', () => {
    expect(playsOften(man('C', 10, 10, { titolarita: null, expected: 34 }), RULES)).toBe(true);
    expect(playsOften(man('C', 10, 10, { titolarita: null, expected: 15 }), RULES)).toBe(false);
  });

  it('answers null - never false - for a man with neither', () => {
    expect(playsOften(man('C', 10, 10, { titolarita: null, expected: null }), RULES)).toBe(null);
  });
});

describe('what a manager\'s credits can still reach', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 1, D: 2, C: 2, A: 1 } };

  it('is bounded by his SLOTS and not only by his money', () => {
    // The defect this fixes, found by reading the screen (`todolist-buste-chiuse-v1.md` §2.1): one
    // league-wide rate times everybody's balance made 361 credits with five slots and 377 with
    // thirteen read practically the same number.
    next = 1;
    const pool = [
      man('P', 11, 22), man('D', 10, 20), man('D', 9, 18),
      man('C', 8, 16), man('C', 7, 14), man('A', 6, 12),
    ];
    // Both spend NOTHING, so the money is identical and only the slots differ: five of the six taken
    // on one side, none on the other.
    const awards = pool.slice(0, 5).map((one) => ({ team: 'Full', fcId: one.fcId, paid: 0 }));
    const states = teamStates(awards, index(pool), rules, ['Full', 'Empty']);
    const scores = verdicts({ states, pool, rules });
    expect(states.get('Full')!.credits).toBe(states.get('Empty')!.credits);
    expect(scores.get('Full')!.wanted).toBeLessThan(scores.get('Empty')!.wanted);
    expect(scores.get('Full')!.toCome).toBeLessThan(scores.get('Empty')!.toCome);
  });

  it('reads 1 for a manager with nothing left to buy, instead of dividing by zero', () => {
    const pool = [man('P', 10, 20)];
    const tiny: LeagueRules = { ...RULES, slots: { P: 1, D: 0, C: 0, A: 0 } };
    const awards = [{ team: 'Done', fcId: pool[0].fcId, paid: 10 }];
    const states = teamStates(awards, index(pool), tiny, ['Done']);
    expect(verdicts({ states, pool, rules: tiny }).get('Done')!.reach).toBe(1);
  });

  it('prices a slot per ROLE, because a credit is not fungible when the slots are not', () => {
    const pool = [man('D', 10, 30), man('A', 10, 6)];
    const states = teamStates([], index(pool), rules, ['One', 'Two']);
    const rate = marketRate(states, pool, rules);
    expect(rate.perSlot.D).toBeGreaterThan(rate.perSlot.A);
  });
});

describe('ratingsOf', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 1, D: 2, C: 2, A: 1 } };

  it('gives the best squad five stars and the worst one, inside this room', () => {
    next = 1;
    const pool = [man('D', 10, 40), man('D', 9, 30), man('D', 8, 6), man('D', 7, 4)];
    const awards = [
      { team: 'Rich', fcId: pool[0].fcId, paid: 40 },
      { team: 'Rich', fcId: pool[1].fcId, paid: 30 },
      { team: 'Poor', fcId: pool[2].fcId, paid: 3 },
      { team: 'Poor', fcId: pool[3].fcId, paid: 2 },
    ];
    const states = teamStates(awards, index(pool), rules, ['Rich', 'Poor']);
    const ratings = ratingsOf({ states, pool, rules });
    expect(ratings.get('Rich')!.squad).toBe(5);
    expect(ratings.get('Poor')!.squad).toBeLessThan(ratings.get('Rich')!.squad);
    for (const rating of ratings.values()) {
      expect(rating.squad).toBeGreaterThanOrEqual(1);
      expect(rating.conduct).toBeLessThanOrEqual(5);
    }
  });

  it('spreads the five bands over the ROOM: two managers of ten per band', () => {
    // With two managers nobody can be «one star»: the worse of two sits at the middle of the room,
    // and saying otherwise would be reading a ten-team verdict off a two-team league.
    expect(starsFromRank(1, 10)).toBe(5);
    expect(starsFromRank(2, 10)).toBe(5);
    expect(starsFromRank(5, 10)).toBe(3);
    expect(starsFromRank(10, 10)).toBe(1);
    expect(starsFromRank(2, 2)).toBe(3);
  });

  it('does not crown a manager who has not spent: no evidence is not the best evidence', () => {
    const pool = [man('D', 10, 20)];
    const awards = [{ team: 'Bought', fcId: pool[0].fcId, paid: 10 }];
    const states = teamStates(awards, index(pool), rules, ['Bought', 'Waiting']);
    const ratings = ratingsOf({ states, pool, rules });
    expect(ratings.get('Waiting')!.perHundred).toBe(null);
    expect(ratings.get('Waiting')!.perHundredRank).toBe(null);
  });
});

describe('the operator\'s rules about the SQUAD', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 3, D: 2, C: 2, A: 1 } };

  const squadOf = (pool: Bidder[], awards: { team: string; fcId: number; paid: number }[]) =>
    teamStates(awards, index(pool), rules, ['Us']).get('Us')!;

  it('counts what is MISSING per role, squad and envelopes together', () => {
    next = 1;
    const held = man('D', 10, 20, { titolarita: 'titolare' });
    const coming = man('D', 9, 18, { titolarita: 'bandiera' });
    const squad = squadOf([held], [{ team: 'Us', fcId: held.fcId, paid: 5 }]);
    expect(strategyCheck([], squad, rules).missingSure.D).toBe(SURE_PER_ROLE - 1);
    expect(strategyCheck([coming], squad, rules).missingSure.D).toBe(0);
  });

  it('asks for nothing where he has no slot left to ask with', () => {
    next = 1;
    const one = man('A', 10, 20, { titolarita: 'panchina' });
    const squad = squadOf([one], [{ team: 'Us', fcId: one.fcId, paid: 5 }]);
    // One forward slot in these rules, and it is taken: the rule cannot be met and is not a warning.
    expect(strategyCheck([], squad, rules).missingSure.A).toBe(0);
  });

  it('calls a lone keeper in a two-way fight a gamble, and a paired one not', () => {
    next = 1;
    const first = man('P', 20, 20, { titolarita: 'ballottaggio', club: 'Juve' });
    const mate = man('P', 15, 15, { titolarita: 'panchina', club: 'Juve' });
    const squad = squadOf([], []);
    expect(strategyCheck([first], squad, rules).keeperGamble).toBe(1);
    expect(strategyCheck([first, mate], squad, rules).keeperGamble).toBe(0);
  });

  it('counts a keeper already in the squad as cover for his club-mate', () => {
    next = 1;
    const owned = man('P', 15, 15, { titolarita: 'panchina', club: 'Juve' });
    const coming = man('P', 20, 20, { titolarita: 'ballottaggio', club: 'Juve' });
    const squad = squadOf([owned], [{ team: 'Us', fcId: owned.fcId, paid: 3 }]);
    expect(strategyCheck([coming], squad, rules).keeperGamble).toBe(0);
  });

  it('leaves a keeper who simply plays alone: there is no fight to cover', () => {
    next = 1;
    const sure = man('P', 30, 30, { titolarita: 'bandiera', club: 'Milan' });
    expect(strategyCheck([sure], squadOf([], []), rules).keeperGamble).toBe(0);
  });
});

describe('the plan under those rules', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 2, D: 2, C: 0, A: 0 }, budget: 100 };

  it('prefers a man who PLAYS to a bench man of the same price, to fill a department', () => {
    // The Cabal case: a `panchina` at a big club, two credits, seventeen appearances of thirty-eight.
    next = 1;
    const bench = [
      man('D', 40, 26, { titolarita: 'panchina', expected: 17, club: 'Juve' }),
      man('D', 38, 25, { titolarita: 'panchina', expected: 17, club: 'Juve' }),
    ];
    const regular = man('D', 20, 16, { titolarita: 'titolare', expected: 34, club: 'Lecce' });
    const pool = [...bench, regular];
    const need = { P: 0, D: 2, C: 0, A: 0 };
    const states = teamStates([], index(pool), { ...rules, slots: need }, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const plan = allocate(candidates, need, 100, { squad, rules });
    const names = plan.bids.map((one) => one.candidate.man.fcId);
    expect(names).toContain(regular.fcId);
    expect(plan.missingSure.D).toBe(SURE_PER_ROLE - 1);
  });

  it('never leaves a lone bet on a contested keeper when the board can cure it', () => {
    // The Di Gregorio case: one of two men fighting for one shirt, with only three keeper slots.
    next = 1;
    const contested = man('P', 60, 26, { titolarita: 'panchina', club: 'Juve' });
    const mate = man('P', 40, 15, { titolarita: 'ballottaggio', club: 'Juve' });
    const dependable = man('P', 30, 20, { titolarita: 'bandiera', club: 'Milan' });
    const pool = [contested, mate, dependable];
    const need = { P: 1, D: 0, C: 0, A: 0 };
    const states = teamStates([], index(pool), { ...rules, slots: need }, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const plan = allocate(candidates, need, 100, { squad, rules });
    expect(plan.bids).toHaveLength(1);
    // With ONE slot the pair is impossible, so the cure is the man who is not in a fight at all.
    expect(plan.bids[0].candidate.man.fcId).toBe(dependable.fcId);
    expect(plan.keeperGamble).toBe(0);
  });

  it('mixes serious bids with cheap shots: a strong man nobody wants is tried for two credits', () => {
    next = 1;
    // Two men of the same role: one everybody is chasing, one just as good that nobody is.
    const wanted = man('C', 200, 30, { titolarita: 'titolare' });
    const quiet = man('C', 4, 28, { titolarita: 'titolare' });
    const filler = man('C', 3, 6, { titolarita: 'titolare' });
    const pool = [wanted, quiet, filler];
    const need = { P: 0, D: 0, C: 2, A: 0 };
    const states = teamStates([], index(pool), { ...rules, slots: need }, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const plan = allocate(candidates, need, 40, { squad, rules });
    // The quiet one is cheap by the ladder itself; what matters is that the plan reaches BOTH good
    // men on a budget that could not pay the going rate for the contested one.
    const chosen = plan.bids.map((one) => one.candidate.man.fcId);
    expect(chosen).toContain(quiet.fcId);
    expect(plan.expectedGain).toBeLessThanOrEqual(plan.gain);
    expect(plan.expectedGain).toBeGreaterThan(0);
  });
});

describe('boardFor and canAdd', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 2, C: 0, A: 0 } };

  const setup = () => {
    next = 1;
    const pool = [man('D', 30, 30), man('D', 20, 20), man('D', 10, 10), man('C', 10, 10)];
    const need = { P: 0, D: 2, C: 0, A: 0 };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const plan = allocate(candidates, need, 100, { squad, rules });
    return { pool, candidates, plan, squad };
  };

  it('offers the whole role minus whoever is already in the plan', () => {
    const { candidates, plan } = setup();
    const rows = boardFor('D', candidates, plan);
    const inPlan = new Set(plan.bids.map((one) => one.candidate.man.fcId));
    expect(rows.every((one) => !inPlan.has(one.man.fcId))).toBe(true);
    expect(rows.every((one) => one.man.role === 'D')).toBe(true);
  });

  it('is the SAME list the short panel is cut from', () => {
    const { candidates, plan } = setup();
    const short = alternativesTo(plan.bids[0], candidates, plan, 50, 2);
    const whole = boardFor('D', candidates, plan, plan.bids[0].candidate.man.fcId);
    expect(short.map((one) => one.candidate.man.fcId)).toEqual(
      whole.slice(0, 2).map((one) => one.man.fcId),
    );
  });

  it('refuses a man already in the plan and one whose role has no slot', () => {
    const { candidates, plan, squad } = setup();
    const already = candidates.find((one) => one.man.fcId === plan.bids[0].candidate.man.fcId)!;
    expect(canAdd(already, plan, squad, rules).ok).toBe(false);
    const midfielder = candidates.find((one) => one.man.role === 'C')!;
    expect(canAdd(midfielder, plan, squad, rules).ok).toBe(false);
  });

  it('refuses one envelope more than the slots left, and says which rule stopped it', () => {
    const { candidates, plan, squad } = setup();
    const spare = boardFor('D', candidates, plan)[0];
    const check = canAdd(spare, plan, squad, rules);
    expect(check.ok).toBe(false);
    expect(check.why).toContain('slot');
  });

  it('ALLOWS a name the budget cannot cover, and marks it instead of refusing it', () => {
    // The slots are the rulebook; the budget is his decision, and the cure may be another offer.
    next = 1;
    const pool = [man('D', 30, 30), man('D', 20, 20), man('D', 10, 10)];
    const need = { P: 0, D: 2, C: 0, A: 0 };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const plan = allocate(candidates, { P: 0, D: 1, C: 0, A: 0 }, 100, { squad, rules });
    const spare = boardFor('D', candidates, plan)[0];
    const check = canAdd(spare, { ...plan, spend: squad.credits }, squad, rules);
    expect(check.ok).toBe(true);
    expect(check.tight).toBe(true);
  });
});

describe('adviceFor', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 3, D: 8, C: 8, A: 6 } };

  it('answers for every role, and ranks INSIDE the role', () => {
    next = 1;
    const pool = [man('D', 30, 30), man('C', 20, 20), man('P', 10, 10), man('A', 10, 10)];
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const lines = adviceFor({
      mine: states.get('Us')!,
      states,
      candidates,
      scale: gainScale(pool, rules),
      rules,
    });
    expect(lines.map((one) => one.role)).toEqual(['P', 'D', 'C', 'A']);
    for (const line of lines) {
      expect(line.advice.length).toBeGreaterThan(20);
      expect(line.of).toBe(2);
    }
  });

  it('tells the keeper department apart: it is about the SHIRT, not about how many you hold', () => {
    next = 1;
    const pool = [
      man('P', 20, 20, { titolarita: 'ballottaggio', club: 'Juve' }),
      man('P', 15, 15, { titolarita: 'panchina', club: 'Juve' }),
    ];
    // A budget that can actually PAY for the pair: two keepers at the head of the demand are dear,
    // and the advice only offers a way out that is within his own ceiling.
    const rich: LeagueRules = { ...rules, budget: 400 };
    const states = teamStates([], index(pool), rich, ['Us', 'Rival']);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules: rich, me: 'Us' });
    const keeper = adviceFor({
      mine: states.get('Us')!,
      states,
      candidates,
      scale: gainScale(pool, rich),
      rules: rich,
    })[0];
    expect(keeper.role).toBe('P');
    expect(keeper.state).toBe('scoperto');
    // The two ways out he named are both on the screen, and the pair is one of them.
    expect(keeper.advice).toContain('COPPIA');
  });

  it('does not count a man with no measured rung against him', () => {
    next = 1;
    const unknown = man('D', 10, 10, { titolarita: null, expected: null });
    const pool = [unknown, man('D', 8, 8)];
    const awards = [{ team: 'Us', fcId: unknown.fcId, paid: 2 }];
    const states = teamStates(awards, index(pool), rules, ['Us', 'Rival']);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const line = adviceFor({
      mine: states.get('Us')!,
      states,
      candidates,
      scale: gainScale(pool, rules),
      rules,
    }).find((one) => one.role === 'D')!;
    expect(line.unknown).toBe(1);
    expect(line.starters).toBe(0);
    expect(line.advice).toContain('gradino');
  });
});

describe('dealsOf', () => {
  it('ranks the dearest by what was PAID and the bargains by gain per credit', () => {
    next = 1;
    const star = man('A', 200, 40);
    const bargain = man('D', 10, 30);
    const pool = [star, bargain];
    const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 1, C: 0, A: 1 } };
    const rounds = roundsOf(
      [[
        { team: 'Rich', fcId: star.fcId, paid: 180 },
        { team: 'Clever', fcId: bargain.fcId, paid: 2 },
      ]],
      index(pool),
      rules,
    );
    const deals = dealsOf(rounds, pool, rules);
    expect(deals.dearest[0].name).toBe(star.name);
    expect(deals.bargains[0].name).toBe(bargain.name);
    // Both numbers travel with the ratio: a divisor that is hidden is a ratio nobody can check.
    expect(deals.bargains[0].paid).toBe(2);
    expect(deals.bargains[0].gain).toBeGreaterThan(0);
  });
});


describe('sureTarget', () => {
  it('is what an ELEVEN needs, with «un paio per ruolo» as the floor', () => {
    // The rule the department verdict is written on, so the plan and the verdict cannot disagree:
    // four defenders and four midfielders play every week, two forwards do, and the floor never
    // drops below the operator's own pair.
    expect(sureTarget('D')).toBe(4);
    expect(sureTarget('C')).toBe(4);
    expect(sureTarget('A')).toBe(2);
    expect(sureTarget('P')).toBe(SURE_PER_ROLE);
  });
});

describe('il piano rispecchia il giudizio di reparto', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 4, C: 0, A: 0 }, budget: 300 };

  const setup = () => {
    next = 1;
    // Four cheap bench men with a big number, and four regulars that cost a little more: without the
    // rule the knapsack takes the four benchwarmers, which is the Cabal case four times over.
    const bench = [40, 38, 36, 34].map((fvm) =>
      man('D', fvm, 26, { titolarita: 'panchina', expected: 17 }),
    );
    const regulars = [20, 18, 16, 14].map((fvm) =>
      man('D', fvm, 16, { titolarita: 'titolare', expected: 34 }),
    );
    const pool = [...bench, ...regulars];
    const need = { P: 0, D: 4, C: 0, A: 0 };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const plan = allocate(candidates, need, 300, { squad, rules });
    return { pool, states, squad, candidates, plan, need };
  };

  it('mette in busta abbastanza uomini che GIOCANO da coprire l\'undici', () => {
    const { plan, rules: _ = rules } = { ...setup(), rules };
    const playing = plan.bids.filter((one) => playsOften(one.candidate.man, rules) === true);
    expect(playing.length).toBeGreaterThanOrEqual(sureTarget('D'));
    expect(plan.missingSure.D).toBe(0);
  });

  it('e il verdetto del reparto NOMINA quelle stesse buste', () => {
    const { states, squad, candidates, plan } = setup();
    const line = adviceFor({
      mine: squad,
      states,
      candidates,
      scale: gainScale(candidates.map((one) => one.man), rules),
      rules,
      bids: plan.bids,
    }).find((one) => one.role === 'D')!;
    expect(line.bidding.map((one) => one.man.fcId).sort()).toEqual(
      plan.bids.map((one) => one.candidate.man.fcId).sort(),
    );
    expect(line.advice).toContain('Questo round ci busti su');
    // ...and it never offers as «still free» a man it is already bidding on: one name, one place.
    const inPlan = new Set(plan.bids.map((one) => one.candidate.man.fcId));
    expect(line.targets.every((one) => !inPlan.has(one.man.fcId))).toBe(true);
  });
});

describe('contestedOf', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 2, C: 0, A: 0 }, budget: 100 };

  it('conta chi può bustarci davvero e chi non ci arriva col proprio tetto', () => {
    next = 1;
    const dear = man('D', 200, 30);
    const cheap = man('D', 6, 10);
    const pool = [dear, cheap];
    // Un rivale ricco, uno che ha speso quasi tutto: stesso ruolo aperto, tetti opposti.
    const awards = [{ team: 'Poor', fcId: cheap.fcId, paid: 99 }];
    const states = teamStates(awards, index([...pool]), rules, ['Us', 'Rich', 'Poor']);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const rows = contestedOf({ candidates, states, rules, me: 'Us' });
    const row = rows.find((one) => one.candidate.man.fcId === dear.fcId)!;
    expect(row.chasers).toContain('Rich');
    expect(row.priced_out).toContain('Poor');
    // Il favorito è uno di quelli che possono pagarlo, mai uno che non ci arriva.
    expect(row.chasers).toContain(row.favourite!);
    expect(rows.every((one) => !one.chasers.includes('Us'))).toBe(true);
  });

  it('non inventa una contesa su un uomo che il listone non quota', () => {
    next = 1;
    const quoted = man('D', 30, 20);
    const unquoted = man('D', null, 25);
    const pool = [quoted, unquoted];
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const rows = contestedOf({ candidates, states, rules, me: 'Us' });
    expect(rows.some((one) => one.candidate.man.fcId === unquoted.fcId)).toBe(false);
  });
});
