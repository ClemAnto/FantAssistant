import { describe, expect, it } from 'vitest';

import { PlanPlayer, PlanTeam, startingPlaces } from './auction-plan';
import { PriorityMan, PriorityRules, WorthContext, roleStats } from './draft-priority';
import { ScenarioInput, chainFrom, diagnose, judge, scenarios } from './draft-scenarios';

/** One shape: a door, two Dc, one C, one Pc. */
const RULES: PriorityRules = {
  roles: ['Por', 'Dc', 'C', 'Pc'],
  slot_roles: { P: ['Por'], DC: ['Dc'], C: ['C'], PC: ['Pc'] },
  modules: { only: { D: ['DC', 'DC'], M: ['C'], T: [], A: ['PC'] } },
};

let next = 1;
const man = (role: string, fm: number, share = 0.9, price = 10): PriorityMan => ({
  id: next++, roles: [role], slot: role, price, fm, share, steady: 0.6,
});

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

const worthOf = (everybody: PriorityMan[]): WorthContext =>
  ({ rules: RULES, stats: roleStats(everybody, RULES, { teams: 8, keepers: 2, rounds: 12 }) });

const asPlan = (m: PriorityMan): PlanPlayer => ({
  id: m.id, name: `m${m.id}`, club: 'Club', slot: m.slot, roles: m.roles.map((r) => r[0].toUpperCase() + r.slice(1)),
  price: m.price, net: m.fm, surplus: m.fm, value: (m.fm ?? 0) * (m.share ?? 0),
});

const team = (id: number, held: PriorityMan[] = []): PlanTeam => ({
  id, label: `t${id}`, slots: held.map((m) => m.slot ?? ''), held: held.map((m) => ({ roles: m.roles })),
  heldIds: held.map((m) => m.id), rosterValue: held.reduce((a, m) => a + m.price, 0),
  pickValues: held.map((m) => m.price), picksCount: held.length, firstRoundIndex: id,
});

function input(pool: PriorityMan[], everybody: PriorityMan[], mine: PriorityMan[] = [], order = [0, 1, 2]): ScenarioInput {
  const known = new Map([...everybody, ...pool, ...mine].map((m) => [m.id, m]));
  return {
    teams: [team(0, mine), team(1), team(2)],
    order,
    pool: pool.map(asPlan),
    places: startingPlaces(RULES),
    mineId: 0,
    keeperCap: 1,
    maxAheadPicks: 1,
    rules: RULES,
    worth: worthOf(everybody),
    matchdays: 38,
    calls: { cap: null, keeperCap: 1, rounds: 6 },
    manOf: (id) => known.get(id) ?? null,
  };
}

describe('diagnose', () => {
  it('reads every place of an empty squad as empty', () => {
    const everybody = population();
    const d = diagnose([], RULES, worthOf(everybody), 38)!;
    expect(d.module).toBe('only');
    expect(d.needs.map((need) => need.kind)).toEqual(['vuoto', 'vuoto', 'vuoto', 'vuoto', 'vuoto']);
  });

  it('puts an empty place first, then a weak holder, then a place with no reserve', () => {
    const everybody = population();
    const weak = man('dc', 5.4); // under an average starting Dc: his Draft Priority is negative
    const good = man('dc', 6.6);
    const striker = man('pc', 8.2);
    const door = man('por', 5.6);
    const d = diagnose([weak, good, striker, door], RULES, worthOf(everybody), 38)!;
    expect(d.needs[0]).toMatchObject({ kind: 'vuoto', place: { slot: 'C' } });
    expect(d.needs[1]).toMatchObject({ kind: 'debole', holder: weak });
    expect(d.needs.slice(2).every((need) => need.kind === 'senza riserva')).toBe(true);
  });
});

describe('a chain A --wait--> A2', () => {
  it('waits longer after a DEAR first pick: the order after the round is roster FVM ascending', () => {
    const everybody = population();
    const cheap = man('c', 6.9, 0.9, 1);
    const dear = man('pc', 7.9, 0.9, 300);
    const others = [man('dc', 6.4, 0.9, 50), man('dc', 6.3, 0.9, 40), man('c', 6.8, 0.9, 30), man('pc', 7.8, 0.9, 20)];
    const pool = [cheap, dear, ...others];
    const afterCheap = chainFrom(input(pool, everybody), asPlan(cheap), null)!;
    const afterDear = chainFrom(input(pool, everybody), asPlan(dear), null)!;
    // Cheap: the two rivals end the round dearer than us, so we call FIRST next round: two picks of wait.
    expect(afterCheap.nextAt).toBe(1);
    expect(afterCheap.wait).toBe(2);
    // Dear: we call LAST next round, after both rivals once more.
    expect(afterDear.nextAt).toBe(3);
    expect(afterDear.wait).toBe(4);
    expect(afterDear.gone.size).toBe(4);
  });

  it('takes A2 for the place that is most urgent AFTER A, among the men the rivals leave', () => {
    const everybody = population();
    const mine = [man('dc', 6.4), man('dc', 6.3), man('pc', 7.9), man('por', 5.3)];
    const midfielder = man('c', 6.9, 0.9, 5);
    const second = man('c', 6.8, 0.9, 1);
    const pool = [midfielder, second, man('dc', 6.0, 0.9, 80), man('pc', 7.1, 0.9, 90)];
    const result = scenarios(input(pool, everybody, mine), 1);
    expect(result.diagnosis!.needs[0]).toMatchObject({ kind: 'vuoto', place: { slot: 'C' } });
    const chain = result.list[0];
    expect(chain.first.player.id).toBe(midfielder.id);
    expect(chain.second?.player.id).not.toBe(midfielder.id);
  });
});

describe('judge, the chain from a man the operator names', () => {
  it('is coherent when he fixes a place of the eleven, inopportune when he would sit on the bench', () => {
    const everybody = population();
    const mine = [man('dc', 6.4), man('dc', 6.3), man('pc', 7.9), man('por', 5.3)];
    const midfielder = man('c', 6.9);
    const thirdDc = man('dc', 5.8);
    const pool = [midfielder, thirdDc];
    expect(judge(input(pool, everybody, mine), asPlan(midfielder)).verdict).toBe('coerente');
    const bench = judge(input(pool, everybody, mine), asPlan(thirdDc));
    expect(bench.verdict).toBe('inopportuna');
    expect(bench.why).toContain('non entra');
  });
});
