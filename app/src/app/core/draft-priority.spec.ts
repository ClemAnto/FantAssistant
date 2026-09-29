import { describe, expect, it } from 'vitest';

import { PlanPlayer, PlanTeam } from './auction-plan';
import {
  PriorityMan,
  PriorityRules,
  PriorityState,
  WorthContext,
  baseRole,
  benchOf,
  leagueReserves,
  draftPriority,
  manValue,
  priorities,
  priorityPick,
  reserveOf,
  roleStats,
} from './draft-priority';

/** A rulebook cut to the bone: one shape of five places. */
const RULES: PriorityRules = {
  roles: ['Por', 'Dc', 'C', 'Pc'],
  slot_roles: { P: ['Por'], DC: ['Dc'], C: ['C'], PC: ['Pc'] },
  modules: { only: { D: ['DC', 'DC'], M: ['C'], T: [], A: ['PC'] } },
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

const SIZE = { teams: 8, keepers: 2, rounds: 12 };

function context(everybody: PriorityMan[]): WorthContext {
  return { rules: RULES, stats: roleStats(everybody, RULES, SIZE) };
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

function state(pool: PriorityMan[], everybody: PriorityMan[], mine: PriorityMan[] = []): PriorityState {
  const known = new Map([...everybody, ...pool, ...mine].map((m) => [m.id, m]));
  return {
    team: team(0, mine),
    pool: pool.map(asPlan),
    manOf: (id) => known.get(id) ?? null,
    worth: context(everybody),
    matchdays: 38,
    reserves: new Set(leagueReserves(everybody, RULES, SIZE).map((m) => m.id)),
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

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

describe('the Draft Priority (the operator, 29/09/2026)', () => {
  it('is [P (Fm - Z) + (N - P) (R - Z)] / N, per matchday', () => {
    const everybody = population();
    const worth = context(everybody);
    const z = worth.stats.get('dc')!.z;
    const defender = man('dc', 6.8, 0.8);
    const pv = 0.8 * 38;
    expect(manValue(defender, worth, 38, 6.1)).toBeCloseTo((pv * (6.8 - z) + (38 - pv) * (6.1 - z)) / 38, 9);
    expect(manValue({ ...defender, fm: null }, worth, 38, 6.1)).toBeNull();
  });

  it('prefers the full back who scores over the forward who scores the same (the operator\'s example)', () => {
    const everybody = population();
    const defender = man('dc', 7.0);
    const forward = man('pc', 7.0);
    const scores = priorities(state([defender, forward], everybody));
    expect(scores.get(defender.id)!).toBeGreaterThan(scores.get(forward.id)!);
  });

  it('reads R from the squad\'s men of the base role who are NOT in its eleven (the operator, 29/09/2026)', () => {
    const everybody = population();
    // The only shape fields two Dc: the two best start, the third is the bench - and only he is R.
    const mine = [man('dc', 6.9), man('dc', 6.6), man('dc', 5.1), man('c', 7.5), man('pc', 7.9)];
    const candidate = man('dc', 6.5);
    expect(benchOf(mine, RULES).map((m) => m.fm)).toEqual([5.1]);
    expect(reserveOf(candidate, RULES, benchOf(mine, RULES), everybody)).toBeCloseTo(5.1, 9);
    const s = state([candidate], everybody, mine);
    expect(priorities(s).get(candidate.id)!).toBeCloseTo(manValue(candidate, s.worth, 38, 5.1)!, 9);
  });

  it('never takes a STARTER as the reserve: with Kane on the pitch, a forward who never plays is not covered by him', () => {
    const everybody = population();
    const kane = man('pc', 9.2, 0.85);
    const benchwarmer = man('pc', 7.4, 2 / 38);
    const regular = man('pc', 7.9, 23 / 38);
    const scores = priorities(state([benchwarmer, regular], everybody, [kane]));
    expect(scores.get(regular.id)!).toBeGreaterThan(scores.get(benchwarmer.id)!);
  });

  it('with no bench of that role, reads R from the FREE men of RESERVE rank of that role, never himself', () => {
    const everybody = population();
    const reserves = leagueReserves(everybody, RULES, SIZE).filter((m) => m.slot === 'dc');
    expect(reserves.length).toBeGreaterThan(1);
    const candidate = reserves[0];
    const expected = mean(reserves.filter((m) => m.id !== candidate.id).map((m) => m.fm!));
    expect(reserveOf(candidate, RULES, [], reserves)).toBeCloseTo(expected, 9);
    // A free man of STARTER rank is no reserve: he is outside the population R reads among the free.
    const starterRank = everybody.filter((m) => m.slot === 'dc' && !reserves.includes(m))
      .sort((a, b) => b.fm! - a.fm!)[0];
    const s = state([candidate, ...reserves.slice(1), starterRank], everybody);
    expect(priorities(s).get(candidate.id)!)
      .toBeCloseTo(draftPriority(candidate, s.worth, 38, [], reserves.slice(1))!, 9);
  });

  it('does not depend on how many picks are left: the promise that faded to zero is gone', () => {
    const everybody = population();
    const candidate = man('c', 6.9);
    const few = [man('dc', 6.0), man('pc', 7.4)];
    const many = [...few, man('dc', 6.0), man('pc', 7.4), man('por', 5.0), man('por', 5.0), man('pc', 7.0)];
    const a = priorities(state([candidate], everybody, few)).get(candidate.id)!;
    const b = priorities(state([candidate], everybody, many)).get(candidate.id)!;
    expect(a).toBeCloseTo(b, 9);
  });
});

describe('priorityPick', () => {
  it('takes the highest priority among the men the rules let the squad call, never a frozen top', () => {
    const everybody = population();
    const star = man('pc', 9.0, 0.95, 300);
    const rest = everybody.slice(0, 12);
    const s = state([star, ...rest], everybody);
    const rules = { cap: { fvm: 213, frozenTurns: 5 }, keeperCap: 2, rounds: 12 };
    const pick = priorityPick(s, rules);
    expect(pick).not.toBeNull();
    expect(pick!.id).not.toBe(star.id);
    expect(priorityPick(s, { ...rules, cap: null })!.id).toBe(star.id);
  });
});
