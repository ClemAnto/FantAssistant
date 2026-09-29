import { describe, expect, it } from 'vitest';

import { PlanPlayer, PlanTeam } from './auction-plan';
import {
  PriorityInput,
  PriorityMan,
  PriorityRules,
  WorthContext,
  baseRole,
  draftPriorities,
  expectedRFactor,
  manValue,
  priorLeft,
  priorityPick,
  roleStats,
  squadWorth,
} from './draft-priority';

/** A rulebook cut to the bone: one shape of five places, and the matrix rows it needs. */
const RULES: PriorityRules = {
  roles: ['Por', 'Dc', 'C', 'Pc'],
  slot_roles: { P: ['Por'], DC: ['Dc'], C: ['C'], PC: ['Pc'] },
  modules: { only: { D: ['DC', 'DC'], M: ['C'], T: [], A: ['PC'] } },
  substitution: {
    matrix: {
      Dc: { Dc: 'OK', C: '-1', Pc: '-1', Por: 'NO' },
      C: { Dc: '-1', C: 'OK', Pc: '-1', Por: 'NO' },
      Pc: { Dc: '-1', C: '-1', Pc: 'OK', Por: 'NO' },
      Por: { Dc: 'NO', C: 'NO', Pc: 'NO', Por: 'OK' },
    },
  },
};

let next = 1;
const man = (role: string, fm: number, share = 0.9, price = 10): PriorityMan => ({
  id: next++, roles: [role], slot: role, price, fm, share, steady: 0.6,
});

/** A population whose zeros are known: Dc around 6.0, C around 6.5, Pc around 7.5, doors around 5.0. */
function population(): PriorityMan[] {
  const out: PriorityMan[] = [];
  for (let i = 0; i < 20; i += 1) {
    out.push(man('dc', 5.5 + i * 0.05));
    out.push(man('c', 6.0 + i * 0.05));
    out.push(man('pc', 7.0 + i * 0.05));
    out.push(man('por', 4.5 + i * 0.05));
  }
  return out;
}

function context(everybody: PriorityMan[], rounds = 12): WorthContext {
  return { rules: RULES, stats: roleStats(everybody, RULES, { teams: 8, keepers: 2, rounds }), rounds, rFactor: true };
}

const asPlan = (m: PriorityMan): PlanPlayer => ({
  id: m.id, name: `m${m.id}`, club: 'Club', slot: m.slot, roles: m.roles.map((r) => r[0].toUpperCase() + r.slice(1)),
  price: m.price, net: null, surplus: null, value: (m.fm ?? 0) * (m.share ?? 0),
});

const team = (id: number, held: PriorityMan[] = []): PlanTeam => ({
  id, label: `t${id}`, slots: held.map((m) => m.slot ?? ''), held: held.map((m) => ({ roles: m.roles })),
  heldIds: held.map((m) => m.id), rosterValue: held.reduce((a, m) => a + m.price, 0),
  pickValues: held.map((m) => m.price), picksCount: held.length, firstRoundIndex: id,
});

function input(pool: PriorityMan[], worth: WorthContext, mine: PriorityMan[] = [], extra: Partial<PriorityInput> = {}):
  PriorityInput {
  const everybody = new Map([...pool, ...mine].map((m) => [m.id, m]));
  return {
    teams: [team(0, mine), team(1)],
    order: [0, 1],
    at: 0,
    pool: pool.map(asPlan),
    mineId: 0,
    keeperCap: 2,
    maxAheadPicks: 1,
    cap: null,
    places: new Map(),
    manOf: (id) => everybody.get(id) ?? null,
    worth,
    deep: false,
    doubles: true,
    ...extra,
  };
}

describe('the base role', () => {
  it('is the most defensive code the rulebook ever puts a man in', () => {
    expect(baseRole(RULES, ['c', 'pc'], 'c')).toBe('c');
    expect(baseRole(RULES, ['pc', 'dc'], 'pc')).toBe('dc');
    expect(baseRole(RULES, ['pc'], 'pc')).toBe('pc');
  });

  it('falls back to the slot for a man the rulebook does not name', () => {
    expect(baseRole(RULES, ['zz'], 'zz')).toBe('zz');
  });
});

describe('the R-Factor', () => {
  it('reads the declared ladder and is exact over independent men', () => {
    expect(expectedRFactor(new Array(11).fill(1))).toBe(3);
    expect(expectedRFactor([...new Array(8).fill(1), 0, 0, 0])).toBe(0.5);
    expect(expectedRFactor(new Array(11).fill(0))).toBe(0);
    const half = expectedRFactor(new Array(11).fill(0.5));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(0.5);
  });
});

describe('the reserve prior fades with the picks left', () => {
  it('is whole until the eleven is built and gone at the last pick', () => {
    expect(priorLeft(0, 32)).toBe(1);
    expect(priorLeft(11, 32)).toBe(1);
    expect(priorLeft(32, 32)).toBe(0);
    expect(priorLeft(21, 32)).toBeCloseTo(11 / 21, 6);
  });
});

describe('squadWorth', () => {
  it('prices an empty place as a promise that becomes a hole at the end of the draft', () => {
    const everybody = population();
    const defender = man('dc', 6.0);
    const early = squadWorth([defender], context(everybody, 32));
    // The same eleven with no picks left - eleven men who fit no place fill the roster - has four HOLES:
    // minus each role's zero, and no R-Factor.
    const fillers = new Array(11).fill(0).map(() => man('zz', 0, 0));
    const holes = squadWorth([defender, ...fillers], context(everybody, 12));
    expect(early).toBeGreaterThan(holes);
    expect(holes).toBeLessThan(-15);
  });
});

describe('draftPriorities', () => {
  it('prefers the full back who scores over the forward who scores the same (the operator\'s example)', () => {
    const everybody = population();
    const worth = context(everybody);
    const defender = man('dc', 7.0);  // a whole point above his role's zero
    const forward = man('pc', 7.5);   // at his role's zero, dearer fantamedia
    const rows = draftPriorities(input([defender, forward], worth));
    expect(rows.get(defender.id)!.gain).toBeGreaterThan(rows.get(forward.id)!.gain);
  });

  it('gives every priced free man a number, and none to a man with no fantamedia', () => {
    const everybody = population();
    const unknown: PriorityMan = { ...man('c', 0), fm: null };
    const rows = draftPriorities(input([...everybody.slice(0, 8), unknown], context(everybody)));
    expect(rows.size).toBe(8);
    expect(rows.has(unknown.id)).toBe(false);
  });

  it('runs the one-turn look-ahead only when asked, and only on the heads', () => {
    const everybody = population();
    const worth = context(everybody);
    const shallow = draftPriorities(input(everybody, worth));
    expect([...shallow.values()].every((row) => row.next === null)).toBe(true);
    const deep = draftPriorities(input(everybody, worth, [], { deep: true }));
    const looked = [...deep.values()].filter((row) => row.next !== null);
    expect(looked.length).toBeGreaterThan(0);
    expect(looked.length).toBeLessThanOrEqual(10);
    for (const row of looked) expect(row.score).toBeCloseTo(row.gain + row.next! + 0, 6);
  });

  it('marks a DOUBLE - a top man our eleven would bench - with the man he could be traded for', () => {
    const everybody = population();
    const worth = context(everybody);
    const topDc = () => man('dc', 7.2, 0.95, 50);
    // Six men held, so the pick is our SEVENTH call: the first a double may be advised on.
    const mine = [topDc(), topDc(), man('c', 6.2), man('pc', 7.4), man('por', 5.0), man('por', 4.9)];
    const third = topDc();
    const midfielder = man('c', 7.4, 0.95, 40); // another base role, a lower price, a bigger gain
    const on = draftPriorities(input([third, midfielder], worth, mine));
    expect(on.get(third.id)!.double?.tradeFor.id).toBe(midfielder.id);
    expect(on.get(midfielder.id)!.double).toBeNull();
    const off = draftPriorities(input([third, midfielder], worth, mine, { doubles: false }));
    expect(off.get(third.id)!.double).toBeNull();
    // ...and one call earlier the same man is not advised as a double (the operator, 29/09/2026).
    const early = draftPriorities(input([third, midfielder], worth, mine.slice(0, 5)));
    expect(early.get(third.id)!.double).toBeNull();
  });
});

describe('DP, a man\'s own value', () => {
  it('reads R as the mean fantamedia of the role\'s RESERVES - the bought men past the league\'s starters', () => {
    const everybody = population();
    const worth = context(everybody);
    const dc = worth.stats.get('dc')!;
    // Eight teams start two Dc each in the only shape: of the twenty bought, the four weakest are reserves.
    const weakest = everybody.filter((m) => m.slot === 'dc').map((m) => m.fm!).sort((a, b) => a - b).slice(0, 4);
    expect(dc.reserveFm).toBeCloseTo(weakest.reduce((a, b) => a + b, 0) / 4, 6);
    const defender = man('dc', 6.8, 0.8);
    const pv = 0.8 * 38;
    expect(manValue(defender, worth, 38)).toBeCloseTo((pv * (6.8 - dc.z) + (38 - pv) * (dc.reserveFm! - dc.z)) / 38, 6);
    expect(manValue({ ...defender, fm: null }, worth, 38)).toBeNull();
  });
});

describe('priorityPick', () => {
  it('never picks a man the ceiling of the first turns freezes', () => {
    const everybody = population();
    const worth = context(everybody);
    const star = man('pc', 9.0, 0.95, 300);
    const rest = everybody.slice(0, 12);
    const pick = priorityPick(input([star, ...rest], worth, [], { cap: { fvm: 213, frozenTurns: 5 }, deep: true }));
    expect(pick).not.toBeNull();
    expect(pick!.player.id).not.toBe(star.id);
    const free = priorityPick(input([star, ...rest], worth, [], { deep: true }));
    expect(free!.player.id).toBe(star.id);
  });
});
