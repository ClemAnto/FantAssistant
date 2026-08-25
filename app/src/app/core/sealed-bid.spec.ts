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
  buyable,
  HOLE_TARGET,
  Reference,
  STANDARD_ELEVEN,
  expectedHoles,
  referenceShape,
  shapesOf,
  calibrationOf,
  canAdd,
  candidatesOf,
  contestedOf,
  dealsOf,
  gainBandOf,
  gainScale,
  LONG_OUT_DAYS,
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
  keeperAnchored,
  keeperCovered,
  keeperGain,
  marginalGains,
  squadGain,
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

  // A bundle older than the market, or a man the sheet has since dropped: the id is in the export and
  // in no listone. His money has still left that manager's pocket, and reading him as unspent made a
  // rival look RICHER than he is - which is the number every rival model on this page is built on.
  it('charges an award this listone cannot name, and COUNTS it instead of dropping it', () => {
    const states = teamStates(
      [
        { team: 'Us', fcId: pool[0].fcId, paid: 10 },
        { team: 'Us', fcId: 999_999, paid: 40 },
      ],
      byId,
      RULES,
    );
    const us = states.get('Us')!;
    expect(us.spent).toBe(50);
    expect(us.credits).toBe(50);
    expect(us.unknown).toBe(1);
    // The ROLE is what cannot be attributed, so he takes no slot and the screen says how many rows that was.
    expect(us.men).toHaveLength(1);
    expect(us.taken).toEqual({ P: 1, D: 0, C: 0, A: 0 });
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
      return allocate(candidates, need, 100, rules);
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
    const plan = allocate(candidates, { P: 0, D: 2, C: 0, A: 1 }, 100, RULES);
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
    const plan = allocate(candidates, NEED, 100, RULES);
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
    const rich = new Set(allocate(candidates, NEED, 200, RULES).bids.map((bid) => bid.candidate.man.fcId));
    expect(rich.has(pool[0].fcId)).toBe(true); // the dear forward
    expect(rich.has(pool[3].fcId)).toBe(true); // the dear defender

    const poor = allocate(candidates, NEED, 70, RULES);
    const chosen = new Set(poor.bids.map((bid) => bid.candidate.man.fcId));
    expect(chosen.has(pool[0].fcId)).toBe(false);
    expect(chosen.has(pool[3].fcId)).toBe(false);
    // ...and it still fills every slot, with the cheap near-equals.
    expect(poor.bids).toHaveLength(3);
    expect(poor.spend).toBeLessThanOrEqual(70);
  });

  it('writes every envelope at one of the three declared numbers, and marks what it raised', () => {
    const { candidates } = board();
    const plan = allocate(candidates, { P: 0, D: 2, C: 0, A: 1 }, 100, RULES);
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
    const plan = allocate(candidates, { P: 2, D: 0, C: 0, A: 0 }, 100, RULES);
    expect(plan.unfilled.P).toBe(2);
    expect(plan.bids).toHaveLength(0);
  });

  it('carries the null it has to beat: the same slots bought the way the room buys', () => {
    const { candidates } = board();
    const plan = allocate(candidates, { P: 0, D: 2, C: 0, A: 1 }, 100, RULES);
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
    const plan = allocate(candidates, { P: 0, D: 0, C: 0, A: 2 }, 100, RULES);
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
    const plan = allocate(candidates, { P: 0, D: 0, C: 0, A: 2 }, 100, RULES);
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
    const plan = allocate(candidates, need, 200, RULES);
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
    const plan = allocate(candidates, need, 200, RULES);
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
    const plan = allocate(candidates, need, 400, RULES);
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
    const plan = allocate(candidates, need, base + cheapest, RULES);
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
    const plan = allocate(candidates, need, 200, RULES);
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
    const plan = allocate(candidates, { P: 0, D: 0, C: 0, A: 1 }, 100, RULES);
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

  /**
   * THE JUVENTUS GOAL OF 25/08/2026, with the sheet's own numbers, because the defect was invisible to
   * every fixture that had two men in it: «Di Gregorio e Perin sono riserve e senza Vicario non ha senso
   * offrire delle buste per loro». Two club-mates were a pair whatever their rung, so the screen read
   * `keeperGamble` 0 on a plan that owned neither side of the fight it was betting on.
   */
  it('does not take two men the board draws NEITHER for the two sides of a fight', () => {
    next = 1;
    const behind = man('P', 10, 25.9, { titolarita: 'panchina', expected: 26.9, club: 'Juventus' });
    const third = man('P', 5, 10, { titolarita: 'riserva', expected: 13.3, club: 'Juventus' });
    const shirt = man('P', 55, 14.9, { titolarita: 'ballottaggio', expected: 23.6, club: 'Juventus' });
    const squad = squadOf([], []);
    // The two the operator was offered: a pair on the club, and nobody wearing the shirt.
    expect(strategyCheck([behind, third], squad, rules).keeperGamble).toBe(2);
    // ...and the arithmetic is not what refuses them: it PREFERS them, because 26.9 + 13.3 appearances
    // tile a 38-round season while 26.9 + 23.6 overlap. Hence a constraint and not a currency.
    expect(keeperGain([behind, third], rules)).toBeGreaterThan(keeperGain([behind, shirt], rules));
    expect(strategyCheck([behind, shirt], squad, rules).keeperGamble).toBe(0);
  });

  it('does not refuse a pair it cannot READ: an unknown rung is not evidence against it', () => {
    next = 1;
    // A sheet built where the boards could not be drawn carries no rung at all. Refusing every pair
    // there - or swapping men over it - would be «vuoto = ignoto» broken from the other side.
    const one = man('P', 20, 20, { titolarita: null, club: 'Juve' });
    const two = man('P', 15, 15, { titolarita: null, club: 'Juve' });
    expect(strategyCheck([one, two], squadOf([], []), rules).keeperGamble).toBe(0);
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
    const plan = allocate(candidates, need, 100, rules, squad);
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
    const plan = allocate(candidates, need, 100, rules, squad);
    expect(plan.bids).toHaveLength(1);
    // With ONE slot the pair is impossible, so the cure is the man who is not in a fight at all.
    expect(plan.bids[0].candidate.man.fcId).toBe(dependable.fcId);
    expect(plan.keeperGamble).toBe(0);
  });

  it('swaps the third keeper for the man who is actually fighting for the shirt', () => {
    // The same Juventus goal, one level up: with TWO keeper slots the plan can hold a pair, so the cure
    // is the pair - and the pair is the man the board draws, not the cheapest club-mate on the board.
    next = 1;
    const behind = man('P', 10, 25.9, { titolarita: 'panchina', expected: 26.9, club: 'Juventus' });
    const third = man('P', 5, 10, { titolarita: 'riserva', expected: 13.3, club: 'Juventus' });
    const shirt = man('P', 55, 14.9, { titolarita: 'ballottaggio', expected: 23.6, club: 'Juventus' });
    const pool = [behind, third, shirt];
    const need = { P: 2, D: 0, C: 0, A: 0 };
    const states = teamStates([], index(pool), { ...rules, slots: need }, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const plan = allocate(candidates, need, 200, rules, squad);
    const names = plan.bids.map((one) => one.candidate.man.fcId);
    expect(names).toContain(behind.fcId);
    expect(names).toContain(shirt.fcId);
    expect(names).not.toContain(third.fcId);
    expect(plan.keeperGamble).toBe(0);
    // ...and where the money does not reach him the gamble STANDS and is COUNTED, which is the third
    // move and not a failure: the man who wears the shirt asks 90 credits of the ladder here.
    const tight = allocate(candidates, need, 100, rules, squad);
    expect(tight.bids.map((one) => one.candidate.man.fcId)).toContain(third.fcId);
    expect(tight.keeperGamble).toBe(2);
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
    const plan = allocate(candidates, need, 40, rules, squad);
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
    const plan = allocate(candidates, need, 100, rules, squad);
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
    const plan = allocate(candidates, { P: 0, D: 1, C: 0, A: 0 }, 100, rules, squad);
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
  it('is his FLOOR, «un paio per ruolo», and non piu\' le maglie di un undici', () => {
    // It used to be `max(2, fielded)`, which is how a defence of five men kept asking for a fourth
    // signing. The consistency rule it existed for did not go away: the verdict and the repair now read
    // the same `expectedHoles`, and the count is back to being what the operator actually asked for.
    expect(sureTarget('D')).toBe(SURE_PER_ROLE);
    expect(sureTarget('C')).toBe(SURE_PER_ROLE);
    expect(sureTarget('A')).toBe(SURE_PER_ROLE);
    // The keepers are not in this rule at all: a pair is two men of whom one plays each week.
    expect(sureTarget('P')).toBe(0);
  });
});

describe('un reparto e\' un INSIEME, non un conteggio di titolari', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 3, D: 8, C: 8, A: 6 } };

  /** I cinque difensori veri dell'operatore, col gradino e le presenze del foglio Serie A rev. 36. */
  const hisDefence = () => {
    next = 1;
    return [
      man('D', 30, 30, { titolarita: 'bandiera', expected: 33.2, name: 'Solet' }),
      man('D', 30, 28, { titolarita: 'bandiera', expected: 30.9, name: 'Kalulu' }),
      man('D', 25, 24, { titolarita: 'bandiera', expected: 25.6, name: 'Di Lorenzo' }),
      man('D', 25, 22, { titolarita: 'ballottaggio', expected: 25.2, name: 'Bisseck' }),
      man('D', 20, 16, { titolarita: 'ballottaggio', expected: 18.9, name: 'Molina N.' }),
    ];
  };

  it('conta i posti VUOTI a giornata, e con cinque difensori sono meno di uno', () => {
    const five = hisDefence();
    // Le quote sono 0,87 · 0,81 · 0,67 · 0,66 · 0,50: coprono 3,36 posti su 4.
    expect(expectedHoles(five, 'D', 4, rules)).toBeCloseTo(0.64, 1);
    expect(expectedHoles(five, 'D', 3, rules)).toBeCloseTo(0.17, 1);
    // ...e i soli tre `bandiera` non coprirebbero quattro maglie: e' la differenza che il conteggio
    // dei gradini non vedeva, perche' `playsOften` risponde false a un `ballottaggio`.
    expect(expectedHoles(five.slice(0, 3), 'D', 4, rules)).toBeGreaterThan(1);
    expect(five.filter((one) => playsOften(one, rules) === true)).toHaveLength(3);
  });

  it('un posto senza nessuno e\' un posto vuoto, e uno senza maglie non e\' un buco', () => {
    expect(expectedHoles([], 'D', 4, rules)).toBe(4);
    expect(expectedHoles(hisDefence(), 'D', 0, rules)).toBe(0);
  });

  it('chi non ha presenze leggibili resta FUORI dal conto invece di contare come assente', () => {
    next = 1;
    const known = man('C', 20, 20, { titolarita: 'bandiera', expected: 38 });
    const unknown = man('C', 20, 20, { titolarita: null, expected: null });
    // Un uomo che copre tutto il calendario copre la maglia; l'ignoto non la copre e non la buca.
    expect(expectedHoles([known, unknown], 'C', 1, rules)).toBeCloseTo(0, 5);
    expect(expectedHoles([known, unknown], 'C', 2, rules)).toBeCloseTo(1, 5);
  });

  it('non dice piu\' SCOPERTO su una difesa che copre le sue maglie', () => {
    const five = hisDefence();
    const awards = five.map((one) => ({ team: 'Us', fcId: one.fcId, paid: 10 }));
    const states = teamStates(awards, index(five), rules, ['Us', 'Rival']);
    const mine = states.get('Us')!;
    const candidates = candidatesOf({ pool: five, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const scale = gainScale(five, rules);
    const shape: Reference = { name: '4-3-3', places: { P: 1, D: 4, C: 3, A: 3 } };
    const line = adviceFor({ mine, states, candidates, scale, rules, reference: shape }).find(
      (one) => one.role === 'D',
    )!;
    expect(line.starters).toBe(3);
    expect(line.fielded).toBe(4);
    expect(line.holes).toBeCloseTo(0.64, 1);
    expect(line.state).not.toBe('scoperto');
    // Col vecchio conteggio dei gradini erano «3 titolari su 4» e quindi scoperto: e' l'obiezione
    // dell'operatore del 25/08/2026, e la frase adesso porta il numero da cui esce.
    expect(line.advice).toContain('4-3-3');
  });

  it('...e lo dice quando il buco c\'e\' davvero', () => {
    next = 1;
    const two = [
      man('D', 30, 30, { titolarita: 'bandiera', expected: 33.2 }),
      man('D', 30, 28, { titolarita: 'bandiera', expected: 30.9 }),
    ];
    const awards = two.map((one) => ({ team: 'Us', fcId: one.fcId, paid: 10 }));
    const states = teamStates(awards, index(two), rules, ['Us', 'Rival']);
    const mine = states.get('Us')!;
    const candidates = candidatesOf({ pool: two, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const scale = gainScale(two, rules);
    const shape: Reference = { name: '4-3-3', places: { P: 1, D: 4, C: 3, A: 3 } };
    const line = adviceFor({ mine, states, candidates, scale, rules, reference: shape }).find(
      (one) => one.role === 'D',
    )!;
    expect(line.holes).toBeGreaterThan(HOLE_TARGET);
    expect(line.state).toBe('scoperto');
  });
});

describe('il modulo di riferimento si SCEGLIE', () => {
  // Un budget vero, perche' «quelli rimanenti» si misura sul TETTO: con i crediti in rosso nessuno e'
  // raggiungibile e la scelta cadrebbe sulla copertura di oggi invece che su quella che puoi comprare.
  const rules: LeagueRules = { ...RULES, budget: 1000, slots: { P: 3, D: 8, C: 8, A: 6 } };
  /** Il rulebook vero, come lo legge la pagina: nessuna trascrizione a mano. */
  const RULEBOOK = {
    modules: {
      '3-4-3': { D: ['D', 'D', 'D'], M: ['C', 'C', 'C', 'C'], T: [], A: ['A', 'A', 'A'] },
      '4-3-3': { D: ['D', 'D', 'D', 'D'], M: ['C', 'C', 'C'], T: [], A: ['A', 'A', 'A'] },
      '3-5-2': { D: ['D', 'D', 'D'], M: ['C', 'C', 'C', 'C', 'C'], T: [], A: ['A', 'A'] },
      '5-3-2': { D: ['D', 'D', 'D', 'D', 'D'], M: ['C', 'C', 'C'], T: [], A: ['A', 'A'] },
    },
  };

  it('legge le maglie dal regolamento, e ogni modulo ne schiera undici', () => {
    const shapes = shapesOf(RULEBOOK);
    expect(shapes.map((one) => one.name)).toEqual(['3-4-3', '4-3-3', '3-5-2', '5-3-2']);
    for (const shape of shapes) {
      expect(shape.places.P + shape.places.D + shape.places.C + shape.places.A).toBe(11);
    }
    expect(shapes.find((one) => one.name === '4-3-3')!.places).toEqual({ P: 1, D: 4, C: 3, A: 3 });
  });

  it('senza regolamento taro sull\'undici standard, e lo DICE', () => {
    next = 1;
    const states = teamStates([], index([]), rules, ['Us']);
    const choice = referenceShape({
      squad: states.get('Us')!,
      candidates: [],
      rules,
      shapes: [],
    });
    expect(choice.noRulebook).toBe(true);
    expect(choice.chosen).toEqual(STANDARD_ELEVEN);
    expect(choice.why).toContain('1-4-4-2');
  });

  it('col modificatore di difesa attivo sceglie il 4-3-3 se il quarto difensore e\' a portata', () => {
    next = 1;
    const squad: Bidder[] = [
      man('D', 30, 30, { titolarita: 'bandiera', expected: 33.2 }),
      man('D', 30, 28, { titolarita: 'bandiera', expected: 30.9 }),
      man('D', 25, 24, { titolarita: 'bandiera', expected: 25.6 }),
      man('D', 25, 22, { titolarita: 'ballottaggio', expected: 25.2 }),
      man('D', 20, 16, { titolarita: 'ballottaggio', expected: 18.9 }),
    ];
    // Il resto della rosa copre le sue maglie in tutt'e due i moduli, cosi' l'unica cosa che li
    // distingue e' la domanda difesa/centrocampo - che e' quello che questa prova vuole misurare.
    squad.push(
      ...[38, 38, 38, 38].map((expected) => man('C', 30, 30, { titolarita: 'bandiera', expected })),
      ...[38, 38, 38].map((expected) => man('A', 30, 30, { titolarita: 'bandiera', expected })),
    );
    const board = [man('D', 20, 18, { titolarita: 'titolare', expected: 34 })];
    const pool = [...squad, ...board];
    const awards = squad.map((one) => ({ team: 'Us', fcId: one.fcId, paid: 10 }));
    const states = teamStates(awards, index(pool), rules, ['Us', 'Rival']);
    const mine = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const shapes = shapesOf(RULEBOOK);
    const on = referenceShape({ squad: mine, candidates, rules, shapes });
    expect(on.chosen.name).toBe('4-3-3');
    expect(on.why).toContain('modificatore');
    // Spento, fra i due decide la sola copertura: il 3-4-3 lascia meno posti vuoti.
    const off = referenceShape({
      squad: mine,
      candidates,
      rules: { ...rules, defenceModifier: false },
      shapes,
    });
    expect(off.chosen.name).toBe('3-4-3');
    // E in ogni caso il secondo si dichiara: una scelta automatica deve essere dubitabile.
    expect(off.runnerUp?.name).toBe('4-3-3');
  });

  it('ripiega sugli altri cinque solo quando nessuno dei due dichiarati e\' copribile', () => {
    next = 1;
    // Cinque difensori che giocano sempre, nessun attaccante e nessuno slot libero: il 3-4-3 e il
    // 4-3-3 chiedono TRE attaccanti che non ci sono e non si possono comprare, il 5-3-2 ne chiede due.
    const squad = [
      ...[38, 38, 38, 38, 38].map((expected) =>
        man('D', 30, 30, { titolarita: 'bandiera', expected }),
      ),
      ...[38, 38, 38].map((expected) => man('C', 30, 30, { titolarita: 'bandiera', expected })),
      ...[38, 38].map((expected) => man('A', 30, 30, { titolarita: 'bandiera', expected })),
    ];
    const tight: LeagueRules = { ...rules, slots: { P: 0, D: 5, C: 3, A: 2 } };
    const awards = squad.map((one) => ({ team: 'Us', fcId: one.fcId, paid: 10 }));
    const states = teamStates(awards, index(squad), tight, ['Us', 'Rival']);
    const mine = states.get('Us')!;
    const choice = referenceShape({
      squad: mine,
      candidates: [],
      rules: tight,
      shapes: shapesOf(RULEBOOK),
    });
    expect(choice.chosen.name).toBe('5-3-2');
    expect(choice.fellBack).toBe(true);
    expect(choice.why).toContain('copribile');
  });

  it('il piano PORTA il modulo su cui e\' stato tarato, e nessuno lo ricalcola', () => {
    next = 1;
    const pool = [man('A', 40, 30, { titolarita: 'bandiera', expected: 34 })];
    const need = { P: 0, D: 0, C: 0, A: 1 };
    const states = teamStates([], index(pool), { ...rules, slots: need }, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const shape: Reference = { name: '3-4-3', places: { P: 1, D: 3, C: 4, A: 3 } };
    expect(allocate(candidates, need, 100, rules, squad, shape).reference).toEqual(shape);
    // Chi non lo passa legge quello che leggeva ieri, non una supposizione nuova.
    expect(allocate(candidates, need, 100, rules, squad).reference).toEqual(STANDARD_ELEVEN);
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
    const plan = allocate(candidates, need, 300, rules, squad);
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


describe('«vuoto = ignoto» dove decide un prezzo e una classifica', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 2, C: 0, A: 0 } };

  it('non usa come PRECEDENTE un aggiudicato che il listone non quota', () => {
    // Filed at pressure 0 and fvm 0 - which is what the old code did - he became the nearest
    // neighbour of every genuinely cheap candidate and tirava giù il loro prezzo consigliato.
    next = 1;
    const quoted = man('D', 30, 20);
    const unquoted = man('D', null, 25);
    const pool = [quoted, unquoted];
    const rounds = roundsOf(
      [[
        { team: 'Rival', fcId: quoted.fcId, paid: 30 },
        { team: 'Rival', fcId: unquoted.fcId, paid: 4 },
      ]],
      index(pool),
      rules,
    );
    const out = precedentsOf(rounds, pool);
    expect(out.map((one) => one.fcId)).toEqual([quoted.fcId]);
  });

  it('non conta come ZERO, nella tariffa di mercato, un uomo che il foglio non prezza', () => {
    next = 1;
    // Two defenders the demand will absorb: one worth 20 of gain, one the sheet cannot price at all.
    const priced = man('D', 30, 20);
    const blind = man('D', 28, 20, { expected: null });
    const states = teamStates([], index([priced, blind]), rules, ['Us', 'Rival']);
    const rate = marketRate(states, [priced, blind], rules);
    const alone = marketRate(states, [priced], rules);
    // The man nobody can price must not halve the rate: the mean is over what IS measured.
    expect(rate.perSlot.D).toBeCloseTo(alone.perSlot.D, 5);
    // ...and the screen can say how much of it was measurement.
    expect(rate.covered.D).toBeLessThan(1);
    expect(rate.covered.D).toBeGreaterThan(0);
  });
});

describe('rivalPlan senza il blocco dei ruoli', () => {
  it('taglia la lista sul TOTALE che può ancora comprare, non su ogni ruolo', () => {
    next = 1;
    const pool = [man('D', 40, 20), man('D', 30, 18), man('C', 35, 19), man('C', 25, 17)];
    const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 2, C: 2, A: 0 }, roleLock: false };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const board = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const rival = states.get('Rival')!;
    // Four open slots by role, but suppose only two men can still be bought in total.
    const capped = { ...rival, slotsFree: 2 };
    expect(rivalPlan(capped, board, rules)).toHaveLength(2);
    // With the lock ON the total is not the constraint - the roles are - so nothing is cut.
    expect(rivalPlan(capped, board, { ...rules, roleLock: true })).toHaveLength(4);
  });
});


describe('chi e\' fuori per un mese non si consiglia', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 0, D: 2, C: 0, A: 0 } };

  it('legge i giorni che RESTANO, e non sa niente di chi non li porta', () => {
    expect(buyable(man('D', 10, 10))).toBe(true);
    expect(buyable(man('D', 10, 10, { outDays: null }))).toBe(true);
    expect(buyable(man('D', 10, 10, { outDays: LONG_OUT_DAYS - 1 }))).toBe(true);
    expect(buyable(man('D', 10, 10, { outDays: LONG_OUT_DAYS }))).toBe(false);
  });

  /**
   * IL CASO LUKAKU (25/08/2026): il foglio lo prezza ancora e la stanza puo' ancora bustarci, ma chi e'
   * fuori rosa non e' un uomo su cui scrivere una busta. E' una DICHIARAZIONE dell'operatore e non una
   * misura - `config/player_notes.json` - e vale per il solo `out_of_squad`: chi ha litigato o ha chiesto
   * di andare via domenica gioca ancora, e leggerlo come un'assenza sarebbe inventare un fatto da un
   * altro.
   */
  it("non consiglia chi e' dichiarato fuori rosa, e non e' un infortunio", () => {
    expect(buyable(man('A', 100, 30, { outOfSquad: true }))).toBe(false);
    expect(buyable(man('A', 100, 30, { outOfSquad: false }))).toBe(true);
    expect(buyable(man('A', 100, 30))).toBe(true);
  });

  it("lo tiene fuori anche dai NOMI CONTESI, che e' dove l'operatore l'ha visto", () => {
    next = 1;
    const gone = man('A', 100, 30, { outOfSquad: true });
    const here = man('A', 40, 20);
    const pool = [gone, here];
    const states = teamStates([], index(pool), { ...RULES, slots: { P: 0, D: 0, C: 0, A: 2 } }, [
      'Us',
      'Rival',
    ]);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules: RULES, me: 'Us' });
    const contested = contestedOf({ candidates, states, rules: RULES, me: 'Us' });
    expect(contested.map((one) => one.candidate.man.fcId)).not.toContain(gone.fcId);
    expect(contested.map((one) => one.candidate.man.fcId)).toContain(here.fcId);
  });

  const board = () => {
    next = 1;
    // Il migliore del ruolo e' fuori per due mesi: senza la regola il piano lo prende comunque.
    const hurt = man('D', 40, 30, { outDays: 60 });
    const fit = man('D', 20, 20);
    const spare = man('D', 10, 10);
    const pool = [hurt, fit, spare];
    const need = { P: 0, D: 2, C: 0, A: 0 };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    return { hurt, fit, spare, pool, need, states, squad, candidates };
  };

  it('non entra nel piano automatico, per quanto sia il migliore', () => {
    const { hurt, need, squad, candidates } = board();
    const plan = allocate(candidates, need, 200, rules, squad);
    expect(plan.bids.some((one) => one.candidate.man.fcId === hurt.fcId)).toBe(false);
    expect(plan.bids).toHaveLength(2);
  });

  it('resta comunque sul tabellone, nelle alternative e scegliibile a mano', () => {
    const { hurt, squad, candidates } = board();
    // UNA busta sola su due slot da difensore, cosi' la regola degli slot non e' quella che risponde:
    // quello che si sta misurando e' se l'infortunato puo' essere scelto A MANO, non se c'e' posto.
    const plan = allocate(candidates, { P: 0, D: 1, C: 0, A: 0 }, 200, rules, squad);
    // Il tabellone e' la stanza, non il nostro piano: gli altri possono bustarci, e l'operatore puo'
    // sapere che rientra sabato.
    expect(boardFor('D', candidates, plan).some((one) => one.man.fcId === hurt.fcId)).toBe(true);
    const hurtCandidate = candidates.find((one) => one.man.fcId === hurt.fcId)!;
    expect(canAdd(hurtCandidate, plan, squad, rules).ok).toBe(true);
  });

  it('e non viene suggerito nemmeno dal giudizio di reparto', () => {
    const { hurt, states, squad, candidates, pool } = board();
    const line = adviceFor({
      mine: squad,
      states,
      candidates,
      scale: gainScale(pool, rules),
      rules,
    }).find((one) => one.role === 'D')!;
    expect(line.targets.some((one) => one.man.fcId === hurt.fcId)).toBe(false);
  });
});


describe('un uomo che il motore non prezza si puo\' comunque SCEGLIERE', () => {
  const rules: LeagueRules = { ...RULES, slots: { P: 3, D: 0, C: 0, A: 0 } };

  const setup = () => {
    next = 1;
    // Il caso vero: il secondo portiere dell'Inter, 10,6 presenze attese su 38 - sotto la soglia della
    // lega (35%), quindi senza GAIN - che l'operatore non trovava da nessuna parte.
    const first = man('P', 200, 30, { titolarita: 'titolare', club: 'Inter' });
    const third = man('P', 63, 6, { titolarita: 'riserva', expected: 10.6, club: 'Inter' });
    const other = man('P', 90, 20, { titolarita: 'titolare', club: 'Milan' });
    const pool = [first, third, other];
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const squad = states.get('Us')!;
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const plan = allocate(candidates, { P: 1, D: 0, C: 0, A: 0 }, 200, rules, squad);
    return { first, third, other, pool, states, squad, candidates, plan };
  };

  it('non ha un GAIN, quindi non entra nel piano automatico', () => {
    const { third, plan } = setup();
    expect(gainOf(third, rules)).toBe(null);
    expect(plan.bids.some((one) => one.candidate.man.fcId === third.fcId)).toBe(false);
  });

  it('ma sta nella lista da cui si scegli a mano, e ci sta in fondo', () => {
    const { third, candidates, plan } = setup();
    const board = boardFor('P', candidates, plan);
    expect(board.some((one) => one.man.fcId === third.fcId)).toBe(true);
    // Gli uomini senza numero stanno in coda: visibili, non in cima.
    expect(board.at(-1)!.man.fcId).toBe(third.fcId);
  });

  it('e la differenza di gain con lui e\' VUOTA, non zero', () => {
    const { third, candidates, plan } = setup();
    const alternatives = alternativesTo(plan.bids[0], candidates, plan, 100);
    const row = alternatives.find((one) => one.candidate.man.fcId === third.fcId)!;
    expect(row.delta).toBe(null);
  });

  it('e il consiglio sui portieri lo NOMINA come terzo, se hai la porta di quel club', () => {
    next = 1;
    const owned = man('P', 200, 30, { titolarita: 'titolare', club: 'Inter' });
    const mate = man('P', 63, 6, { titolarita: 'riserva', expected: 10.6, club: 'Inter' });
    const pool = [owned, mate];
    const states = teamStates(
      [{ team: 'Us', fcId: owned.fcId, paid: 40 }],
      index(pool),
      rules,
      ['Us', 'Rival'],
    );
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const keeper = adviceFor({
      mine: states.get('Us')!,
      states,
      candidates,
      scale: gainScale(pool, rules),
      rules,
    })[0];
    expect(keeper.advice).toContain(mate.name);
    expect(keeper.targets.some((one) => one.man.fcId === mate.fcId)).toBe(true);
  });
});


describe('il reparto portieri e` UN POSTO SOLO', () => {
  /** The real 2026-27 Serie A rows the operator's own busta was built on. */
  const falcone = () => man('P', 25, 31.1, { name: 'Falcone', club: 'Lecce', expected: 32.1 });
  const palmisani = () => man('P', 8, 18.2, { name: 'Palmisani', club: 'Frosinone', expected: 23.2 });

  it('vale esattamente `gainOf` quando il portiere e` uno solo', () => {
    const one = falcone();
    expect(keeperGain([one], RULES)).toBeCloseTo(gainOf(one, RULES)!, 9);
  });

  it('non somma due portieri di due club: le giornate in cui giocano entrambi si contano una volta', () => {
    const [uno, due] = [falcone(), palmisani()];
    const apart = gainOf(uno, RULES)! + gainOf(due, RULES)!;
    const together = keeperGain([uno, due], RULES);
    // The plan used to read 42.8 and collects 32.9: Palmisani is worth his 14.2 on the 15.5% of the
    // matchdays Falcone misses, plus what a deputy is worth to Falcone himself. He does ADD something -
    // the department beats either man alone - and it is a third of what the busta was crediting him.
    expect(apart).toBeCloseTo(42.8, 1);
    expect(together).toBeCloseTo(32.9, 1);
    expect(together).toBeGreaterThan(gainOf(uno, RULES)!);
  });

  it('un vice fa salire anche il portiere che hai gia`, perche` lo sconto e` sul REPARTO', () => {
    // «You set the lineup before knowing whether he plays» is a sentence about a slot with nobody
    // behind it: with a deputy listed, the automatic substitution catches the matchday whoever plays.
    const alone = keeperGain([falcone()], RULES);
    const covered = keeperGain([falcone(), palmisani()], RULES);
    expect(covered - alone).toBeGreaterThan(gainOf(palmisani(), RULES)! * 0.155);
    // A club pair that covers the whole calendar carries no catchability discount at all: what is
    // uncertain there is WHICH of the two plays, and you own both.
    const whole = [
      man('P', 10, 24.1, { club: 'Napoli', expected: 25 }),
      man('P', 45, 12.9, { club: 'Napoli', expected: 14.6 }),
    ];
    expect(keeperGain(whole, RULES)).toBeCloseTo(35.5, 1);
    expect(keeperGain(whole, RULES)).toBeGreaterThan(alone);
  });

  it('non fa giocare due portieri dello stesso club nella stessa giornata', () => {
    // Their two forecasts sum to 1.16 of a calendar, which the rulebook forbids: the department may
    // never be worth more than one man playing every match at the better of the two rates.
    const first = man('P', 20, 30, { club: 'Uno', expected: 30 });
    const second = man('P', 8, 11, { club: 'Uno', expected: 14 });
    const ceiling = (30 / 30) * RULES.matchdays;
    expect(keeperGain([first, second], RULES)).toBeLessThan(ceiling);
  });

  it('preferisce il COMPAGNO di squadra a un portiere altrove che da solo varrebbe di piu`', () => {
    // The pairing intuition falls out of the arithmetic instead of being a repair bolted on top: the
    // club-mate covers exactly the matchdays the first man misses, the stranger overlaps with them.
    const first = man('P', 40, 30, { club: 'Uno', expected: 30 });
    const mate = man('P', 8, 11, { club: 'Uno', expected: 14 });
    const stranger = man('P', 8, 12, { club: 'Due', expected: 16 });
    expect(gainOf(stranger, RULES)!).toBeGreaterThan(gainOf(mate, RULES)!);
    expect(keeperGain([first, mate], RULES)).toBeGreaterThan(keeperGain([first, stranger], RULES));
  });

  it('non conta chi il foglio non prezza, e non lo lascia nemmeno fare ombra a un altro', () => {
    const priced = falcone();
    const blank = man('P', 5, 0, { club: 'Roma', expected: 30, surplus: null } as never);
    expect(keeperGain([priced, blank], RULES)).toBeCloseTo(keeperGain([priced], RULES), 9);
  });

  it('e i marginali sommano ESATTAMENTE alla differenza fra i due reparti', () => {
    const held = [falcone()];
    const coming = [palmisani(), man('P', 3, 9, { club: 'Como', expected: 20 })];
    const adds = marginalGains(coming, held, RULES);
    const summed = coming.reduce((sum, one) => sum + (adds.get(one.fcId) ?? 0), 0);
    expect(summed).toBeCloseTo(
      keeperGain([...held, ...coming], RULES) - keeperGain(held, RULES),
      9,
    );
  });

  it('vale anche per una ROSA intera: tre portieri non sono tre reparti', () => {
    const keepers = [falcone(), palmisani(), man('P', 3, 9, { club: 'Como', expected: 20 })];
    const outfield = [man('D', 40, 10), man('C', 30, 12)];
    const squad = [...keepers, ...outfield];
    const added = squad.reduce((sum, one) => sum + (gainOf(one, RULES) ?? 0), 0);
    expect(squadGain(squad, RULES)).toBeLessThan(added);
    // ...and the three roles that are not one place are untouched.
    expect(squadGain(outfield, RULES)).toBeCloseTo(
      outfield.reduce((sum, one) => sum + gainOf(one, RULES)!, 0),
      9,
    );
  });

  it('e la classifica non premia piu` chi ha speso in porta', () => {
    next = 1;
    const pool = [
      man('P', 60, 31.1, { club: 'Lecce', expected: 32.1 }),
      man('P', 50, 30, { club: 'Roma', expected: 31 }),
      man('D', 60, 30, { club: 'Inter', expected: 31 }),
    ];
    const rules: LeagueRules = { ...RULES, budget: 100, slots: { P: 2, D: 1, C: 0, A: 0 } };
    const states = teamStates(
      [
        { team: 'DuePortieri', fcId: pool[0].fcId, paid: 40 },
        { team: 'DuePortieri', fcId: pool[1].fcId, paid: 40 },
        { team: 'UnoSolo', fcId: pool[2].fcId, paid: 40 },
      ],
      index(pool),
      rules,
      ['DuePortieri', 'UnoSolo'],
    );
    const read = verdicts({ states, pool: [], rules });
    // Two keepers of two clubs used to read as two departments. He is still ahead of a manager with
    // one man - the second keeper does cover something - but by what he can field and no longer by the
    // two numbers added, which is 12 points of standing he was being credited for a shirt he has once.
    const two = read.get('DuePortieri')!.gain;
    const one = read.get('UnoSolo')!.gain;
    const summed = pool.slice(0, 2).reduce((sum, man) => sum + gainOf(man, rules)!, 0);
    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThan(summed);
    expect(summed - two).toBeGreaterThan(10);
    expect(strengthsOf(states, rules).get('DuePortieri')!.find((row) => row.role === 'P')!.gain)
      .toBeCloseTo(keeperGain(pool.slice(0, 2), rules), 9);
  });
});

describe('la busta non compra piu` il secondo portiere al prezzo del primo', () => {
  const board = () => {
    next = 1;
    const pool = [
      man('P', 25, 31.1, { club: 'Lecce', expected: 32.1 }),
      man('P', 8, 18.2, { club: 'Frosinone', expected: 23.2 }),
      man('D', 40, 20),
      man('D', 8, 18),
      man('D', 4, 3),
    ];
    const rules: LeagueRules = { ...RULES, slots: { P: 2, D: 1, C: 0, A: 0 } };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    return {
      pool,
      rules,
      candidates: candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' }),
    };
  };

  it('scrive accanto a ogni busta quello che AGGIUNGE, e il totale e` la somma di quelle righe', () => {
    const { candidates, rules } = board();
    const plan = allocate(candidates, { P: 2, D: 1, C: 0, A: 0 }, 200, rules);
    const keepers = plan.bids.filter((one) => one.candidate.man.role === 'P');
    expect(keepers).toHaveLength(2);
    // The second keeper is the one the old arithmetic paid a full gain for.
    const second = keepers[1];
    expect(second.gain).toBeLessThan((second.candidate.gain ?? 0) / 3);
    expect(plan.gain).toBeCloseTo(
      plan.bids.reduce((sum, one) => sum + one.gain, 0),
      9,
    );
    expect(plan.gain).toBeCloseTo(squadGain(plan.bids.map((one) => one.candidate.man), rules), 9);
  });

  it('e un portiere che hai gia` in rosa toglie valore a quello che stai per comprare', () => {
    const { pool, candidates, rules } = board();
    const empty = teamStates([], index(pool), rules, ['Us']).get('Us')!;
    const owning = teamStates(
      [{ team: 'Us', fcId: pool[0].fcId, paid: 80 }],
      index(pool),
      rules,
      ['Us'],
    ).get('Us')!;
    const need = { P: 1, D: 0, C: 0, A: 0 };
    const fresh = allocate(candidates.filter((one) => one.man.fcId !== pool[0].fcId), need, 100, rules, empty);
    const after = allocate(candidates.filter((one) => one.man.fcId !== pool[0].fcId), need, 100, rules, owning);
    expect(fresh.bids[0].candidate.man.fcId).toBe(pool[1].fcId);
    expect(after.bids[0].candidate.man.fcId).toBe(pool[1].fcId);
    // Same man, same envelope, a fifth of the value: you already own the shirt he would have covered.
    expect(after.bids[0].gain).toBeLessThan(fresh.bids[0].gain / 3);
  });
});


describe('una scommessa in porta e` SOLITARIA solo se il reparto non ha un ancora', () => {
  const RULES_P: LeagueRules = { ...RULES, slots: { P: 2, D: 0, C: 0, A: 0 } };
  const falcone = () => man('P', 25, 31.1, { name: 'Falcone', club: 'Lecce', expected: 32.1, titolarita: 'bandiera' });
  const provedel = () => man('P', 5, 22.0, { name: 'Provedel', club: 'Inter', expected: 20.6, titolarita: 'ballottaggio' });
  const milinkovic = () => man('P', 10, 24.1, { name: 'Milinkovic', club: 'Napoli', expected: 25, titolarita: 'ballottaggio' });
  const meret = () => man('P', 45, 12.9, { name: 'Meret', club: 'Napoli', expected: 14.6, titolarita: 'panchina' });

  it('un uomo che gioca e` un ancora, e da solo un ballottaggio non lo e`', () => {
    expect(keeperAnchored([falcone(), provedel()], RULES_P)).toBe(true);
    expect(keeperAnchored([provedel()], RULES_P)).toBe(false);
    expect(keeperAnchored([provedel(), milinkovic()], RULES_P)).toBe(false);
  });

  it('...e possedere la maglia intera di un club lo e` anche senza nessuno che gioca sempre', () => {
    // Due pretendenti, uno dei quali la board disegna: e` la definizione di `ownsShirt` e non una nuova.
    expect(keeperAnchored([milinkovic(), meret()], RULES_P)).toBe(true);
  });

  it('il piano non scambia piu` un ballottaggio a sconto quando l`ancora c`e` gia`', () => {
    next = 1;
    const pool = [falcone(), provedel(), man('P', 27, 29.3, { name: 'Caprile', club: 'Cagliari', expected: 32.1, titolarita: 'bandiera' })];
    const rules: LeagueRules = { ...RULES, budget: 1000, slots: { P: 2, D: 0, C: 0, A: 0 } };
    const states = teamStates([], index(pool), rules, ['Us', 'Rival']);
    const candidates = candidatesOf({ pool, states, precedents: PRECEDENTS, rules, me: 'Us' });
    const mine = states.get('Us')!;
    const askOf = (name: string) => candidates.find((one) => one.man.name === name)!.ask.ask;
    // Il tetto che arriva all'ancora piu` la puntata a sconto, e NON al terzo `bandiera`: e` la
    // situazione in cui la riparazione agiva, perche` Provedel e` l'unico non-sicuro del piano.
    const cap = askOf('Falcone') + askOf('Provedel');
    expect(cap).toBeLessThan(askOf('Falcone') + askOf('Caprile'));
    const plan = allocate(candidates, { P: 2, D: 0, C: 0, A: 0 }, cap, rules, mine);
    const names = plan.bids.map((one) => one.candidate.man.name);
    // Con Falcone dentro, Provedel non e` una scommessa solitaria: la riparazione non lo tocca e la
    // pagina non stampa un avviso su un reparto che e` coperto.
    expect(names).toContain('Falcone');
    expect(names).toContain('Provedel');
    expect(plan.keeperGamble).toBe(0);
  });

  it('...e resta una scommessa quando in porta non c`e` nessun altro', () => {
    const squad = teamStates([], index([]), RULES_P, ['Us']).get('Us')!;
    const solo = strategyCheck([provedel()], squad, RULES_P);
    expect(solo.keeperGamble).toBe(1);
    const anchored = strategyCheck([provedel(), falcone()], squad, RULES_P);
    expect(anchored.keeperGamble).toBe(0);
  });

  it('e i buchi in porta si contano sull`ESCLUSIVITA` del club, non su tiri indipendenti', () => {
    // Due portieri di un club coprono il calendario intero; due di club diversi con le stesse quote no.
    const pair = [milinkovic(), meret()];
    const apart = [
      man('P', 10, 24.1, { club: 'Napoli', expected: 25, titolarita: 'ballottaggio' }),
      man('P', 45, 12.9, { club: 'Roma', expected: 14.6, titolarita: 'panchina' }),
    ];
    expect(keeperCovered(pair, RULES_P)).toBeCloseTo(1, 6);
    expect(expectedHoles(pair, 'P', 1, RULES_P)).toBeCloseTo(0, 6);
    expect(expectedHoles(apart, 'P', 1, RULES_P)).toBeGreaterThan(0.1);
  });
});
