import { describe, expect, it } from 'vitest';

import { PlanPlayer, PlanTeam, startingPlaces } from './auction-plan';
import { PriorityMan, PriorityRules, WorthContext, roleStats } from './draft-priority';
import { CHAIN_TURNS, ScenarioInput, chainFrom, diagnose, interestIn, judge, keeperAllowed, movesFor, pickVaried, rankGain, scenarios, squadWorth, Scenario } from './draft-scenarios';
import { SURVIVOR_DISCOUNT } from './auction-plan';

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

describe('the move that gives the WHOLE squad most', () => {
  it('opens on the bonus-heavy man, not on the empty door the diagnosis lists first', () => {
    const everybody = population();
    const door = man('por', 5.2, 0.9, 5);
    const bonusDc = man('dc', 7.2, 0.9, 5);
    const pool = [door, bonusDc, man('c', 6.5, 0.9, 30), man('pc', 7.4, 0.9, 40)];
    const result = scenarios(input(pool, everybody), 3);
    expect(result.diagnosis!.needs[0]).toMatchObject({ kind: 'vuoto', place: { slot: 'P' } });
    expect(result.list[0].first.player.id).toBe(bonusDc.id);
    // Ranked by what the squad gains over the chain, best first.
    const totals = result.list.map((chain) => chain.total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it('gains nothing from a man who would sit on the bench', () => {
    const everybody = population();
    const mine = [man('dc', 6.4), man('dc', 6.3), man('c', 6.9), man('pc', 7.9), man('por', 5.3)];
    const thirdDc = man('dc', 5.9);
    const moves = movesFor({ ...input([thirdDc], everybody, mine).teams[0] }, [asPlan(thirdDc)], input([thirdDc], everybody, mine));
    expect(moves[0].gain).toBe(0);
  });

  it('charges a hole the picks left can no longer fill', () => {
    const everybody = population();
    const ctx = input([], everybody);
    const four = [man('dc', 6.4), man('dc', 6.3), man('pc', 7.9), man('por', 5.3)];
    const promised = squadWorth(four, ctx, 1);
    const stuck = squadWorth(four, ctx, 0);
    // The empty C costs the Z of a C once no pick can reach it.
    expect(promised - stuck).toBeCloseTo(ctx.worth.stats.get('c')!.z, 6);
  });
});

describe('a classic quota (todolist-draft-classic-v1 item 3.2)', () => {
  it('never proposes a man of a FULL line, as a move or anywhere in a chain', () => {
    const everybody = population();
    const mine = [man('pc', 7.9)];
    // The best man on the board is a Pc, and our attack line is already at its quota of one.
    const bestPc = man('pc', 8.6, 0.95, 5);
    const pool = [bestPc, man('pc', 8.2, 0.95, 5), man('c', 6.4, 0.9, 5), man('dc', 6.0, 0.9, 5), man('por', 5.0, 0.9, 5)];
    const ctx = input(pool, everybody, mine);
    ctx.teams = ctx.teams.map((t) => (t.id === 0 ? { ...t, limits: { att: 1 } } : t));
    const pcs = new Set(pool.filter((m) => m.slot === 'pc').map((m) => m.id));
    expect(movesFor(ctx.teams[0], ctx.pool, ctx).some((step) => pcs.has(step.player.id))).toBe(false);
    for (const chain of scenarios(ctx, 5).list) {
      expect(pcs.has(chain.first.player.id)).toBe(false);
      if (chain.second) expect(pcs.has(chain.second.player.id)).toBe(false);
      for (const step of chain.later) expect(pcs.has(step.player.id)).toBe(false);
    }
  });
});

describe('a plan judged over CHAIN_TURNS of our picks (02/10/2026)', () => {
  it('adds our later picks to the ranking, never a man taken before them, and leaves the two on screen alone', () => {
    const everybody = population();
    const pool = [
      man('c', 6.9, 0.9, 5), man('c', 6.8, 0.9, 4), man('c', 6.7, 0.9, 3), man('c', 6.6, 0.9, 2),
      man('dc', 6.4, 0.9, 50), man('dc', 6.3, 0.9, 40), man('dc', 6.2, 0.9, 30), man('dc', 6.1, 0.9, 20),
      man('pc', 7.9, 0.9, 60), man('pc', 7.8, 0.9, 45), man('pc', 7.4, 0.9, 25), man('pc', 7.2, 0.9, 15),
      man('por', 5.3, 0.9, 10), man('por', 5.1, 0.9, 8), man('por', 5.0, 0.9, 6),
    ];
    const ctx = input(pool, everybody);
    const chain = chainFrom(ctx, asPlan(pool[0]), null)!;
    expect(chain.later.length).toBe(CHAIN_TURNS - 2);
    expect(chain.horizon).toBeCloseTo(chain.total + chain.later.reduce((sum, step) => sum + step.gain, 0), 9);
    const ours = [chain.first.player.id, chain.second!.player.id, ...chain.later.map((step) => step.player.id)];
    expect(new Set(ours).size).toBe(ours.length);
    // `gone` is still «before OUR NEXT pick», what the screen highlights - none of it ever ours.
    for (const id of ours) expect(chain.gone.has(id)).toBe(false);
    // We call first in this round, so «gone before our next pick» is exactly the wait - not the later walks.
    expect(chain.gone.size).toBe(chain.wait);
  });
});

describe('how hard a plan is', () => {
  it('asks each squad calling in between whether it wants the second man, and counts them', () => {
    const everybody = population();
    const cheap = man('c', 6.9, 0.9, 1);
    const pool = [cheap, man('pc', 7.9, 0.9, 300), man('dc', 6.4, 0.9, 50), man('dc', 6.3, 0.9, 40),
      man('c', 6.8, 0.9, 30), man('pc', 7.8, 0.9, 20)];
    const chain = chainFrom(input(pool, everybody), asPlan(cheap), null)!;
    // Two picks in between, two empty rival squads: both have nobody of his role.
    expect(chain.wait).toBe(2);
    expect(chain.interested.map((one) => one.why)).toEqual(['nessuno', 'nessuno']);
    expect(chain.difficulty).toBe('difficile');
  });

  it('reads nobody, few or weak men of the role on a rival roster', () => {
    const everybody = population();
    const ctx = input([], everybody);
    const targetMan = man('dc', 6.5);
    const target = asPlan(targetMan);
    const rival = (held: PriorityMan[]) => ({ ...ctx.teams[1], heldIds: held.map((m) => m.id), slots: held.map((m) => m.slot ?? '') });
    const known = new Map<number, PriorityMan>([[targetMan.id, targetMan]]);
    const withMen = (held: PriorityMan[]) => {
      for (const m of held) known.set(m.id, m);
      return { ...ctx, manOf: (id: number) => known.get(id) ?? ctx.manOf(id) };
    };
    expect(interestIn(rival([]), target, withMen([]))?.why).toBe('nessuno');
    const one = [man('dc', 6.6)];
    expect(interestIn(rival(one), target, withMen(one))?.why).toBe('pochi'); // the shape starts two Dc
    const weak = [man('dc', 5.4), man('dc', 5.5)];
    expect(interestIn(rival(weak), target, withMen(weak))?.why).toBe('scarsi');
    const good = [man('dc', 6.8), man('dc', 6.7)];
    expect(interestIn(rival(good), target, withMen(good))).toBeNull();
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

describe('the plans on the draft pitch (01/10/2026)', () => {
  it('ranks the moves and reads the places to fix through the pitch when the caller gives one', () => {
    const everybody = population();
    const strong = man('pc', 7.4, 0.9, 40);
    const reserve = man('dc', 5.6, 0.9, 5);
    const pool = [strong, reserve];
    const base = input(pool, everybody);
    // A pitch that values only the reserve: the plans must follow it, not the Draft Priority's eleven.
    const pitched: ScenarioInput = {
      ...base,
      pitch: {
        worth: (roster) => (roster.some((m) => m.id === reserve.id) ? 1 : 0),
        diagnose: () => ({ module: 'only', needs: [{ kind: 'scoperto', place: { line: 'D', slot: 'DC', roles: ['dc'] }, holder: null, gap: 0.3 }] }),
        placeOf: (_, m) => (m.id === reserve.id ? { line: 'D', slot: 'DC', roles: ['dc'] } : null),
      },
    };
    const moves = movesFor(pitched.teams[0], pitched.pool, pitched);
    expect(moves[0].player.id).toBe(reserve.id);
    expect(moves[0].gain).toBe(1);
    const result = scenarios(pitched, 3);
    expect(result.diagnosis!.needs[0].kind).toBe('scoperto');
    expect(judge(pitched, asPlan(reserve))).toMatchObject({ verdict: 'coerente' });
    expect(judge(pitched, asPlan(strong)).verdict).toBe('inopportuna');
  });
});

describe('the right moment: who survives is worth waiting for (01/10/2026)', () => {
  it('ranks a survivor at SURVIVOR_DISCOUNT of his gain, never a man who will be gone, a loss or the last pick', () => {
    const one = man('pc', 7);
    const step = { player: asPlan(one), priority: 1, gain: 1, need: null };
    const base = input([one], population());
    expect(rankGain(step, base, 5)).toBe(1); // no walk: as before
    const walked = { ...base, gone: new Map<number, number>() };
    expect(rankGain(step, walked, 5)).toBeCloseTo(SURVIVOR_DISCOUNT, 9);
    expect(rankGain(step, { ...base, gone: new Map([[one.id, 1]]) }, 5)).toBe(1);
    expect(rankGain(step, walked, 1)).toBe(1);
    expect(rankGain({ ...step, gain: -1 }, walked, 5)).toBe(-1);
  });
});

describe('a keeper who is not the first of his club waits for an anchor (01/10/2026)', () => {
  it('is a move only as the deputy of a keeper held, or at the last calls (01/10/2026)', () => {
    const first = man('por', 5.2);
    const second = man('por', 5.0, 0.4);
    const other = man('por', 5.1);
    const clubs = new Map([[first.id, 'Como'], [second.id, 'Como'], [other.id, 'Roma']]);
    const base = input([second], population());
    const ruled: ScenarioInput = { ...base, keepers: { firsts: new Set([first.id, other.id]), clubOf: (id) => clubs.get(id) ?? null } };
    const empty = team(0);
    expect(keeperAllowed(empty, asPlan(second), ruled, 6)).toBe(false);
    expect(keeperAllowed(empty, asPlan(first), ruled, 6)).toBe(true);
    // Next to a first keeper of ANOTHER club he waits for the last calls; next to his own club's he is the deputy.
    expect(keeperAllowed(team(0, [other]), asPlan(second), ruled, 6)).toBe(false);
    expect(keeperAllowed(team(0, [other]), asPlan(second), ruled, 1)).toBe(true);
    expect(keeperAllowed(team(0, [first]), asPlan(second), ruled, 6)).toBe(true);
    expect(keeperAllowed(empty, asPlan(second), ruled, 1)).toBe(true);
    expect(keeperAllowed(empty, asPlan(second), base, 6)).toBe(true);
  });
});

describe('the men the operator excluded from the advice (05/10/2026)', () => {
  it('never opens or continues a plan on an excluded man, and the rivals still may take him', () => {
    const everybody = population();
    const bonusDc = man('dc', 7.2, 0.9, 5);
    const pool = [man('por', 5.2, 0.9, 5), bonusDc, man('c', 6.5, 0.9, 30), man('pc', 7.4, 0.9, 40)];
    const base = input(pool, everybody);
    expect(scenarios(base, 3).list[0].first.player.id).toBe(bonusDc.id);
    const ctx = { ...base, excluded: new Set([bonusDc.id]) };
    const ours = scenarios(ctx, 3).list.flatMap((chain) =>
      [chain.first.player.id, chain.second?.player.id, ...chain.later.map((step) => step.player.id)]);
    expect(ours).not.toContain(bonusDc.id);
    // A rival's own moves ignore OUR exclusions.
    expect(movesFor(ctx.teams[1], ctx.pool, ctx).some((step) => step.player.id === bonusDc.id)).toBe(true);
  });
});

describe('the men likely gone before our pick are not advised for it (05/10/2026)', () => {
  it('cannot open a plan when we are not on the clock, and cannot be the second pick when we are', () => {
    const everybody = population();
    const bonusDc = man('dc', 7.2, 0.9, 5);
    const pool = [man('por', 5.2, 0.9, 5), bonusDc, man('c', 6.5, 0.9, 30), man('pc', 7.4, 0.9, 40)];
    const base = input(pool, everybody);
    expect(scenarios(base, 3).list[0].first.player.id).toBe(bonusDc.id);
    const waiting = { ...base, likelyGone: { ids: new Set([bonusDc.id]), beforeNow: true } };
    expect(scenarios(waiting, 3).list.map((chain) => chain.first.player.id)).not.toContain(bonusDc.id);
    // On the clock the odds end at our NEXT call: taking him now is allowed, waiting for him is not.
    const onClock = { ...base, likelyGone: { ids: new Set([bonusDc.id]), beforeNow: false } };
    const plans = scenarios(onClock, 3).list;
    expect(plans[0].first.player.id).toBe(bonusDc.id);
    expect(plans.map((chain) => chain.second?.player.id)).not.toContain(bonusDc.id);
  });
});

describe('waiting is priced by role (05/10/2026, ROLE_WAIT)', () => {
  const everybody = population();
  const base = input([], everybody);
  const step = (id: number, gain: number, waitAlt?: number) =>
    ({ player: asPlan({ ...man('c', 6), id }), priority: 0, gain, need: null, waitAlt });

  it('discounts a man who will be gone when a man as good of his role will still be there', () => {
    const ctx = { ...base, gone: new Map([[1, 1]]) };
    expect(rankGain(step(1, 10), ctx, 10)).toBe(10); // gone, nobody of his role left
    expect(rankGain(step(1, 10, 10), ctx, 10)).toBeCloseTo(7, 9); // gone, but an equal one survives
    expect(rankGain(step(1, 10, 4), ctx, 10)).toBeCloseTo(8.8, 9); // a weaker one survives: a smaller discount
    expect(rankGain(step(2, 10, 0), ctx, 10)).toBeCloseTo(7, 9); // he survives himself: the old discount
    expect(rankGain(step(2, 10, 30), ctx, 10)).toBeCloseTo(7, 9); // never more than the old discount
    expect(rankGain(step(1, -2, 10), ctx, 10)).toBe(-2); // a loss is never discounted
  });
});

describe('the three plans vary in role or difficulty (05/10/2026)', () => {
  const plan = (id: number, slot: string, difficulty: Scenario['difficulty']) =>
    ({ first: { player: { id, slot } }, difficulty }) as unknown as Scenario;
  const ids = (list: { chain: Scenario }[]) => list.map(({ chain }) => chain.first.player.id);

  it('skips a plan that repeats the role AND the difficulty of one already shown, and says how many it skipped', () => {
    const ranked = [plan(1, 'dc', 'facile'), plan(2, 'dc', 'facile'), plan(3, 'dc', 'medio'), plan(4, 'c', 'facile')];
    const shown = pickVaried(ranked, 3);
    expect(ids(shown)).toEqual([1, 3, 4]);
    expect(shown.map(({ skipped }) => skipped)).toEqual([0, 1, 1]);
  });

  it('a third plan must differ from BOTH plans before it, not only from the first', () => {
    const ranked = [plan(1, 'dc', 'facile'), plan(2, 'c', 'facile'), plan(3, 'c', 'facile'), plan(4, 'pc', 'facile')];
    expect(ids(pickVaried(ranked, 3))).toEqual([1, 2, 4]);
  });

  it('fills with the ranking when there is not enough variety, and marks nothing it did not choose for variety', () => {
    const ranked = [plan(1, 'dc', 'sicuro'), plan(2, 'dc', 'sicuro'), plan(3, 'dc', 'sicuro')];
    const shown = pickVaried(ranked, 3);
    expect(ids(shown)).toEqual([1, 2, 3]);
    expect(shown.every(({ skipped }) => skipped === 0)).toBe(true);
  });
});
