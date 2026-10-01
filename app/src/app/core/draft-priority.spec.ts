import { describe, expect, it } from 'vitest';

import { DEPTH_WEIGHT, PlanPlayer, PlanTeam } from './auction-plan';
import { RarityMan } from './draft-rarity';
import {
  PriorityMan,
  PriorityRules,
  PriorityState,
  RARITY_DISCOUNT,
  ZERO_REFERENCES,
  KEEPER_RESERVE_GAP,
  TRIM,
  WorthContext,
  baseRole,
  priceZero,
  RESERVE_FVM,
  ZERO_FVM_PERCENTILE,
  legalFor,
  manValue,
  picksBefore,
  priorities,
  priorityParts,
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

describe('on classic (30/09/2026)', () => {
  /** The classic rulebook's shape: roles P/D/C/A, whole places per line, no keeper line. */
  const CLASSIC: PriorityRules = {
    roles: ['P', 'D', 'C', 'A'],
    slot_roles: { P: ['P'], D: ['D'], C: ['C'], A: ['A'] },
    modules: { '4-4-2': { D: ['D', 'D', 'D', 'D'], M: ['C', 'C', 'C', 'C'], T: [], A: ['A', 'A'] } },
  };

  it('reads a keeper as the door in either vocabulary, and a classic role as its own base role', () => {
    expect(baseRole(CLASSIC, ['p'], 'P')).toBe('por');
    expect(baseRole(CLASSIC, ['d'], 'D')).toBe('d');
    expect(baseRole(CLASSIC, ['a'], 'A')).toBe('a');
  });

  it("buys each line to its quota and takes Z from a module's whole places", () => {
    const everybody: PriorityMan[] = [];
    let id = 5000;
    const add = (role: string, slot: string, fm: number) =>
      everybody.push({ id: id++, roles: [role], slot, price: 10, fm, share: 0.9, steady: 0.6 });
    for (let i = 0; i < 40; i += 1) {
      add('d', 'D', 5.5 + i * 0.02);
      add('a', 'A', 6.5 + i * 0.03);
    }
    const stats = roleStats(everybody, CLASSIC, { teams: 2, keepers: 3, rounds: 25,
      quotas: { dif: 8, att: 6 }, startersFromPlaces: true });
    // Two teams buy 16 defenders and 12 forwards, not the 50 best by what they give.
    expect(stats.get('d')!.bought).toBe(16);
    expect(stats.get('a')!.bought).toBe(12);
    // Z = the 2 x 4 = 8 best bought defenders (trimmed mean below ten values = plain mean).
    const top8 = everybody.filter((m) => m.slot === 'D').map((m) => m.fm!).sort((a, b) => b - a).slice(0, 8);
    expect(stats.get('d')!.z).toBeCloseTo(top8.reduce((a, b) => a + b, 0) / 8, 6);
  });

  it('takes Z on classic from the DECLARED count per line, keepers included (30/09/2026)', () => {
    const everybody: PriorityMan[] = [];
    let id = 7000;
    const add = (role: string, slot: string, fm: number) =>
      everybody.push({ id: id++, roles: [role], slot, price: 10, fm, share: 0.9, steady: 0.6 });
    for (let i = 0; i < 40; i += 1) {
      add('d', 'D', 5.5 + i * 0.02);
      add('a', 'A', 6.5 + i * 0.03);
      add('p', 'P', 4.5 + i * 0.01);
    }
    const stats = roleStats(everybody, CLASSIC, { teams: 2, keepers: 3, rounds: 25,
      quotas: { dif: 8, att: 6 }, startersFromPlaces: true, startersPerLine: { por: 2, dif: 4, att: 3 } });
    const meanOfBest = (slot: string, n: number) => {
      const best = everybody.filter((m) => m.slot === slot).map((m) => m.fm!).sort((a, b) => b - a).slice(0, n);
      return best.reduce((a, b) => a + b, 0) / n;
    };
    // 2 teams: the 8 best defenders, the 6 best forwards and the 4 best keepers - not one door per team, and not
    // the module's 2 forward places.
    expect(stats.get('d')!.z).toBeCloseTo(meanOfBest('D', 8), 6);
    expect(stats.get('a')!.z).toBeCloseTo(meanOfBest('A', 6), 6);
    expect(stats.get('por')!.z).toBeCloseTo(meanOfBest('P', 4), 6);
  });

  it('keeps a full classic line off the board', () => {
    const squad: PlanTeam = { ...team(0), slots: Array(8).fill('D'), picksCount: 8,
      limits: { por: 3, dif: 8, cen: 8, att: 6 } };
    const pool = [{ ...asPlan(man('d', 6.5)), slot: 'D' }, { ...asPlan(man('a', 6.5)), slot: 'A' }];
    expect(legalFor(squad, pool, { cap: null, keeperCap: 3, rounds: 25 }).map((p) => p.slot)).toEqual(['A']);
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

describe('the new Draft Priority: SeSw, RAR and the rationing (30/09/2026)', () => {
  const readingsOf = (men: PriorityMan[]) => {
    const byId = new Map<number, RarityMan>(men.map((m) => [m.id, { id: m.id, group: m.slot ?? '', rung: null,
      steady: m.steady, mv: m.fm, bonus: null, share: m.share, fragility: null }]));
    return (id: number) => byId.get(id) ?? null;
  };
  const table = (n: number) => Array.from({ length: n }, (_, id) => team(id));

  it("lowers the common man and keeps the last of his kind: the operator's example", () => {
    const everybody = population();
    const forwards = [0, 1, 2, 3, 4, 5].map(() => man('pc', 7.9));
    const defender = man('dc', 6.9);
    const pool = [...forwards, defender, man('dc', 5.5), man('c', 6.0)];
    const base = state(pool, everybody);
    const alone = priorities(base);
    const parts = priorityParts({ ...base, rarityOf: readingsOf(pool), teams: table(6), rounds: 12 });
    const forward = parts.get(forwards[0].id)!;
    expect(forward.rar?.count).toBe(5);
    expect(parts.get(defender.id)!.rar?.count).toBe(0);
    // The defender keeps his SeSw; the forward loses a quarter of his distance from the floor, and no more.
    expect(parts.get(defender.id)!.score).toBeCloseTo(alone.get(defender.id)!, 9);
    const floor = Math.min(...alone.values());
    const share = Math.min(1, 5 / forward.k!);
    expect(forward.score).toBeCloseTo(floor + (1 - RARITY_DISCOUNT * share) * (forward.sesw - floor), 9);
  });

  it('never RAISES a man below zero: it shrinks the distance from the floor, not the signed SeSw', () => {
    const everybody = population();
    const weak = [0, 1, 2, 3].map(() => man('dc', 5.6));
    const pool = [...weak, man('dc', 5.5)];
    const base = state(pool, everybody);
    const alone = priorities(base);
    const parts = priorityParts({ ...base, rarityOf: readingsOf(pool), teams: table(4), rounds: 12 });
    expect(alone.get(weak[0].id)!).toBeLessThan(0);
    expect(parts.get(weak[0].id)!.score).toBeLessThanOrEqual(alone.get(weak[0].id)!);
  });

  it('rations like the app: a slot the squad already fills weighs DEPTH_WEIGHT', () => {
    const everybody = population();
    const held = [man('pc', 7.5)];
    const candidate = man('pc', 7.9);
    const pool = [candidate, man('dc', 5.5)];
    const parts = priorityParts({ ...state(pool, everybody, held), places: new Map([['pc', 1], ['dc', 2]]) });
    expect(parts.get(candidate.id)!.need).toBe(DEPTH_WEIGHT);
  });

  it('counts k as the rest of the round plus who the order puts ahead after paying him', () => {
    const me = team(0);
    const rivals = [team(1), team(2), { ...team(3), picksCount: 1, rosterValue: 50 }];
    const pool = [man('pc', 7, 0.9, 40), man('pc', 7, 0.9, 1)].map(asPlan);
    const k = picksBefore(me, [me, ...rivals], pool, 12);
    // Teams 1 and 2 still call this round (and add the two dearest, 40 and 1); team 3 has called.
    expect(k(1)).toBe(2 + 0);
    expect(k(60)).toBe(2 + 3);
  });
});

describe('Z and R by price inside the role (01/10/2026)', () => {
  // A role of 101 men whose fantamedia grows with the FVM: price i, fm 5 + i/100.
  const priced = (role: string) => Array.from({ length: 101 }, (_, i) => ({ ...man(role, 5 + i / 100), price: i }));

  it('takes Z at the 75th percentile of the price and R around 10 FVM', () => {
    const zr = priceZero(priced('c'))!;
    // Percentiles 70-80 are the men priced 70..80: mean fm 5.75.
    expect(zr.z).toBeCloseTo(5 + ZERO_FVM_PERCENTILE, 6);
    // The 15 nearest FVM 10 are priced 3..17: mean fm 5.10.
    expect(zr.r).toBeCloseTo(5 + RESERVE_FVM / 100, 6);
    expect(zr.r).toBeLessThan(zr.z);
    expect(priceZero([])).toBeNull();
  });

  it('replaces the counts only where the caller asks, and a man on Z who always plays reads zero', () => {
    const everybody = [...priced('c'), ...priced('pc')];
    const counted = roleStats(everybody, RULES, SIZE);
    const byPrice = roleStats(everybody, RULES, { ...SIZE, byPrice: true });
    expect(byPrice.get('c')!.z).toBeCloseTo(5.75, 6);
    expect(byPrice.get('c')!.reserveFm).toBeCloseTo(5.1, 6);
    expect(counted.get('c')!.z).not.toBeCloseTo(5.75, 2);
    const ctx: WorthContext = { rules: RULES, stats: byPrice };
    expect(manValue({ ...man('c', 5.75, 1), id: 999 }, ctx, 38)).toBeCloseTo(0, 6);
  });

  it('prices a door one goal under Z, so a backup with a high fantamedia ranks under a starter (01/10/2026)', () => {
    const byPrice = roleStats(priced('por'), RULES, { ...SIZE, byPrice: true });
    const { z, reserveFm } = byPrice.get('por')!;
    expect(reserveFm).toBeCloseTo(z - KEEPER_RESERVE_GAP, 9);
    const ctx: WorthContext = { rules: RULES, stats: byPrice };
    // Provedel-like: 12 of 33 at Z + 0.28; Falcone-like: 30 of 33 at Z + 0.04.
    const backup = manValue({ ...man('por', z + 0.28, 12 / 33), id: 901 }, ctx, 33)!;
    const starter = manValue({ ...man('por', z + 0.04, 30 / 33), id: 902 }, ctx, 33)!;
    expect(starter).toBeGreaterThan(backup);
  });

  it('keeps the four reference lines declared by fc_id', () => {
    expect(Object.keys(ZERO_REFERENCES).sort()).toEqual(['att', 'cen', 'dif', 'por']);
  });
});
