import { PlanPlayer, PlanTeam } from './auction-plan';
import { EARLY_PICKS, SeenMan, goneOdds } from './rival-odds';

const LINE = { P: 'gk', D: 'def', C: 'mid', A: 'atk' } as const;

function man(id: number, slot: 'P' | 'D' | 'C' | 'A', price: number, club = `club${id}`): PlanPlayer {
  return { id, name: `m${id}`, club, slot, roles: [slot.toLowerCase()], price, net: null, surplus: null, value: null };
}

function team(id: number, picks: PlanPlayer[], index: number, limits?: PlanTeam['limits']): PlanTeam {
  return {
    id, label: `t${id}`, slots: picks.map((one) => one.slot ?? ''), held: [], heldIds: picks.map((one) => one.id),
    rosterValue: picks.reduce((sum, one) => sum + one.price, 0), pickValues: picks.map((one) => one.price),
    picksCount: picks.length, firstRoundIndex: index, ...(limits ? { limits } : {}),
  };
}

function seenOf(pool: PlanPlayer[]): Map<number, SeenMan> {
  return new Map(pool.map((one) => [one.id, {
    line: LINE[one.slot as keyof typeof LINE], club: one.club, fm: null, mv: null, played: 0,
  }]));
}

describe('goneOdds', () => {
  const pool = [man(1, 'A', 400), man(2, 'A', 200), man(3, 'C', 120), man(4, 'D', 60), man(5, 'P', 30), man(6, 'C', 5)];

  // Three squads on a snake, ours (0) on the clock: our pick is priced at zero and the two rivals call twice each
  // (1, 2, 2, 1) before our next turn.
  const input = (teams: PlanTeam[], seed = 7) => ({
    teams, pool, mineId: 0, keeperCap: 3, maxAheadPicks: 1,
    orderType: 'pingpong' as const, cap: null, rounds: 25, seen: seenOf(pool), seed,
  });

  it('is a probability per man, and the walks take exactly the rivals\' calls', () => {
    const odds = goneOdds(input([team(0, [], 0), team(1, [], 1), team(2, [], 2)]));
    for (const p of odds.values()) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    // Each walk takes four men (two calls each for the two rivals): the odds sum to four.
    const total = [...odds.values()].reduce((sum, p) => sum + p, 0);
    expect(total).toBeCloseTo(4, 5);
  });

  it('reads the same table the same way: the seed keeps the list from flickering', () => {
    const teams = [team(0, [], 0), team(1, [], 1), team(2, [], 2)];
    expect([...goneOdds(input(teams, 3))]).toEqual([...goneOdds(input(teams, 3))]);
  });

  it('in the early turns follows the price: the dearest is the likeliest to go', () => {
    const odds = goneOdds(input([team(0, [], 0), team(1, [], 1), team(2, [], 2)]));
    expect(EARLY_PICKS).toBeGreaterThan(0);
    expect(odds.get(1)!).toBeGreaterThan(odds.get(3) ?? 0);
    expect(odds.get(2)!).toBeGreaterThan(odds.get(6) ?? 0);
  });

  it('never gives a rival a man his full line refuses', () => {
    const limits = { por: 3, dif: 8, cen: 8, att: 0 };
    const odds = goneOdds(input([team(0, [], 0), team(1, [], 1, limits), team(2, [], 2, limits)]));
    expect(odds.get(1)).toBeUndefined();
    expect(odds.get(2)).toBeUndefined();
  });

  it('counts keepers on the listone line, so an unpriced mantra keeper (no slot) cannot pass the cap', () => {
    const held = [{ ...man(10, 'P', 20), slot: null }];
    const loose = { ...man(11, 'P', 900), slot: null };
    const table = [team(0, [], 0), { ...team(1, held, 1), slots: [''] }, { ...team(2, held, 2), slots: [''] }];
    const seen = seenOf(pool);
    for (const id of [10, 11]) seen.set(id, { line: 'gk', club: `club${id}`, fm: null, mv: null, played: 0 });
    const odds = goneOdds({ ...input(table), pool: [...pool, loose], keeperCap: 1, seen });
    expect(odds.get(11)).toBeUndefined();
  });

  it('is empty when we follow nobody at this table', () => {
    expect(goneOdds({ ...input([team(1, [], 1), team(2, [], 2)]), mineId: 0 }).size).toBe(0);
  });
});
