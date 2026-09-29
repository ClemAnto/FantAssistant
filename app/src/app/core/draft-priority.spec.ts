import { describe, expect, it } from 'vitest';

import { PlanPlayer, PlanTeam } from './auction-plan';
import {
  PriorityMan,
  PriorityRules,
  PriorityState,
  TRIM,
  WorthContext,
  baseRole,
  manValue,
  priorities,
  priorityPick,
  roleStats,
} from './draft-priority';

/** A rulebook cut to the bone: one shape of five places - two Dc, one C, one Pc (and the door). */
const RULES: PriorityRules = {
  roles: ['Por', 'Dc', 'C', 'Pc'],
  slot_roles: { P: ['Por'], DC: ['Dc'], C: ['C'], PC: ['Pc'] },
  modules: { only: { D: ['DC', 'DC'], M: ['C'], T: [], A: ['PC'] } },
};

let next = 1;
const man = (role: string, fm: number, share = 0.9, price = 10): PriorityMan => ({
  id: next++, roles: [role], slot: role, price, fm, share, steady: 0.6,
});

/** Twenty men per role, fantamedia evenly spread: Dc 5.50-6.45, C 6.00-6.95, Pc 7.00-7.95, doors 4.50-5.45. */
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
  return { team: team(0, mine), pool: pool.map(asPlan), manOf: (id) => known.get(id) ?? null, worth: context(everybody),
    matchdays: 38 };
}

const trimmed = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const cut = Math.floor(s.length * TRIM);
  const kept = s.length >= 10 ? s.slice(cut, s.length - cut) : s;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
};

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

describe('Z is a starter and R a reserve (the operator, 29/09/2026)', () => {
  it('splits a role\'s bought men by fantamedia at teams x its places: Z the starters, R the rest', () => {
    const everybody = population();
    const stats = context(everybody).stats;
    const dcs = everybody.filter((m) => m.slot === 'dc').map((m) => m.fm!).sort((a, b) => b - a);
    // Z: the best three Dc per participant, 8 x 3 = 24 - all twenty here (the operator, 29/09/2026).
    expect(stats.get('dc')!.z).toBeCloseTo(trimmed(dcs.slice(0, 24)), 9);
    // R keeps the old split: eight teams start two Dc each, the four weakest are the reserves.
    expect(stats.get('dc')!.reserveFm).toBeCloseTo(trimmed(dcs.slice(16)), 9);
    for (const role of ['dc', 'c', 'pc', 'por']) {
      expect(stats.get(role)!.reserveFm!).toBeLessThan(stats.get(role)!.z);
    }
  });

  it('with no reserve at all, reads R on the bottom quarter of the role', () => {
    const few = [man('pc', 7.0), man('pc', 7.2), man('pc', 7.4), man('pc', 7.6)];
    const stats = roleStats(few, RULES, SIZE); // eight teams start eight Pc: nobody is left over
    expect(stats.get('pc')!.reserveFm).toBeCloseTo(7.0, 9);
  });
});

describe('the Draft Priority', () => {
  it('is [P (Fm - Z) + (N - P) (R - Z)] / N, per matchday', () => {
    const everybody = population();
    const worth = context(everybody);
    const { z, reserveFm } = worth.stats.get('dc')!;
    const defender = man('dc', 6.8, 0.8);
    const pv = 0.8 * 38;
    expect(manValue(defender, worth, 38)).toBeCloseTo((pv * (6.8 - z) + (38 - pv) * (reserveFm! - z)) / 38, 9);
    expect(manValue({ ...defender, fm: null }, worth, 38)).toBeNull();
  });

  it('prefers the full back who scores over the forward who scores the same (the operator\'s example)', () => {
    const everybody = population();
    const defender = man('dc', 7.0);
    const forward = man('pc', 7.0);
    const scores = priorities(state([defender, forward], everybody));
    expect(scores.get(defender.id)!).toBeGreaterThan(scores.get(forward.id)!);
  });

  it('ranks a forward who plays above one who barely does, whoever the squad already holds', () => {
    const everybody = population();
    const kane = man('pc', 9.2, 0.85);
    const benchwarmer = man('pc', 7.4, 2 / 38);
    const regular = man('pc', 7.9, 23 / 38);
    const scores = priorities(state([benchwarmer, regular], everybody, [kane]));
    expect(scores.get(regular.id)!).toBeGreaterThan(scores.get(benchwarmer.id)!);
  });

  it('is a fact about the man: it depends neither on our squad nor on the picks left', () => {
    const everybody = population();
    const candidate = man('c', 6.9);
    const few = [man('dc', 6.0), man('pc', 7.4)];
    const many = [...few, man('c', 7.9), man('c', 7.8), man('por', 5.0), man('por', 5.0), man('pc', 7.0)];
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
