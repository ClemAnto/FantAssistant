import { AuctionTeam } from './auction-feed';
import { demoOrder } from './auction-demo';
import { PlanPlayer, PlanTeam, pickForUs, pickScore, simulateRound } from './auction-plan';

/**
 * The three pieces the Draft Assistant added around the plan: the score a list prints, the round walked
 * from whoever is on the clock, and the order of the invented table after a pick written by hand.
 */

const team = (id: number, over: Partial<PlanTeam> = {}): PlanTeam => ({
  id,
  label: `Squadra ${id}`,
  slots: [],
  held: [],
  heldIds: [],
  rosterValue: 0,
  pickValues: [],
  picksCount: 0,
  firstRoundIndex: id,
  ...over,
});

const player = (id: number, price: number, value: number | null): PlanPlayer => ({
  id,
  name: `P${id}`,
  club: 'C',
  slot: 'dc',
  roles: ['dc'],
  price,
  net: value,
  surplus: value,
  value,
});

describe('pickScore', () => {
  it('is the score pickForUs chooses on: the best score IS the pick', () => {
    const pool = [player(1, 50, 10), player(2, 90, 30), player(3, 20, 25)];
    const gone = new Set([2]);
    const best = pickForUs(pool, null, undefined, gone);
    const top = [...pool].sort((a, b) => pickScore(b, null, undefined, gone) - pickScore(a, null, undefined, gone))[0];
    expect(best?.id).toBe(top.id);
  });

  it('discounts a man who will still be there next turn, and has no score without a worth', () => {
    const one = player(1, 50, 10);
    expect(pickScore(one, null, undefined, new Set([1]))).toBe(10);
    expect(pickScore(one, null, undefined, new Set())).toBeCloseTo(7);
    expect(pickScore(player(2, 10, null), null)).toBe(-Infinity);
  });
});

describe('simulateRound', () => {
  it('walks the WHOLE order from the clock, one pick per seat, nobody taken twice', () => {
    const teams = [team(0), team(1), team(2)];
    const pool = [player(10, 90, 30), player(11, 80, 20), player(12, 70, 25), player(13, 10, 5)];
    const round = simulateRound({
      teams, order: [2, 0, 1], pool, mineId: 0, shapes: null, keeperCap: 3, maxAheadPicks: 1,
    });
    expect(round.picks.map((pick) => pick.teamId)).toEqual([2, 0, 1]);
    const ids = round.picks.map((pick) => pick.player?.id);
    expect(new Set(ids).size).toBe(3);
    // The rival on the clock takes the dearest (the default head is the price); ours is not a guess.
    expect(round.picks[0].player?.id).toBe(10);
    expect(round.picks[1].predicted).toBe(false);
    expect(round.picks[0].predicted).toBe(true);
    // Whoever spent most calls last in the next round.
    expect(round.nextOrder[round.nextOrder.length - 1]).toBe(2);
  });
});

describe('demoOrder', () => {
  const auctionTeam = (id: number, costs: number[]): AuctionTeam => ({
    id,
    label: `T${id}`,
    colour: '#000',
    online: true,
    host: false,
    spent: costs.reduce((sum, cost) => sum + cost, 0),
    budgetLeft: 0,
    squad: costs.map((cost, index) => ({ index, player: null, zone: 'mov', cost })),
    missing: {},
    missingTotal: 0,
    orderIndex: 0,
    onTheClock: false,
  });

  it('puts fewest picks first, then the cheapest squad, then the seat', () => {
    expect(demoOrder([auctionTeam(0, [100]), auctionTeam(1, []), auctionTeam(2, [])])).toEqual([1, 2, 0]);
    expect(demoOrder([auctionTeam(0, [100]), auctionTeam(1, [40]), auctionTeam(2, [70])])).toEqual([1, 2, 0]);
  });
});
