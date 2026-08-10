import {
  DEPTH_WEIGHT,
  TAIL_POSITIONS,
  TAIL_PRICE_FLOOR,
  PlanPlayer,
  PlanTeam,
  needFor,
  pickForUs,
  plan,
  planRoots,
  positionAfterSpending,
  predictRivalPick,
  startingPlaces,
} from './auction-plan';

/** Two shapes, cut to the bone: enough to give `dc` two places and `ds` one. */
const SHAPES = {
  slot_roles: { DC: ['Dc'], DS: ['Ds'], 'A/PC': ['A', 'Pc'], P: ['Por'] },
  modules: {
    'four-at-the-back': { D: ['DC', 'DC', 'DS'], A: ['A/PC'] },
    'three-at-the-back': { D: ['DC', 'DC'], A: ['A/PC', 'A/PC'] },
  },
};

const team = (id: number, over: Partial<PlanTeam> = {}): PlanTeam => ({
  id,
  label: `Squadra ${id}`,
  slots: [],
  rosterValue: 0,
  pickValues: [],
  picksCount: 0,
  firstRoundIndex: id,
  ...over,
});

const player = (id: number, slot: string | null, price: number, net = price / 10): PlanPlayer => ({
  id,
  name: `P${id}`,
  club: 'C',
  slot,
  roles: slot ? [slot] : [],
  price,
  net,
});

describe('startingPlaces', () => {
  it('rounds a shared place UP: half a place is still a place to cover', () => {
    const places = startingPlaces(SHAPES);
    expect(places.get('dc')).toBe(2); // two in both shapes
    expect(places.get('ds')).toBe(1); // one in one shape of two: 0.5 -> 1
  });
});

describe('needFor', () => {
  it('wants a slot fully until the places are covered, then only as depth', () => {
    const places = startingPlaces(SHAPES);
    expect(needFor(team(1), 'dc', places)).toBe(1);
    expect(needFor(team(1, { slots: ['dc'] }), 'dc', places)).toBe(1);
    expect(needFor(team(1, { slots: ['dc', 'dc'] }), 'dc', places)).toBe(DEPTH_WEIGHT);
  });
});

describe('predictRivalPick', () => {
  const places = startingPlaces(SHAPES);
  const pool = [player(1, 'dc', 100), player(2, 'pc', 90)];

  it('takes the dearest man he still needs', () => {
    expect(predictRivalPick(team(1), pool, places, 3)!.id).toBe(1);
  });

  it('lets a cheaper man win when the dear one fills a slot he has covered', () => {
    // 100 x 0.35 = 35 against 90 x 1: the covered `dc` loses to the `pc` he still needs.
    const covered = team(1, { slots: ['dc', 'dc'] });
    expect(predictRivalPick(covered, pool, places, 3)!.id).toBe(2);
  });

  it('never hands a fourth keeper to a team that already has its three', () => {
    const keepers = [player(9, 'por', 500), player(3, 'dc', 10)];
    const full = team(1, { slots: ['por', 'por', 'por'] });
    expect(predictRivalPick(full, keepers, places, 3)!.id).toBe(3);
  });
});

describe('pickForUs', () => {
  it('ranks by OUR net and not by the price', () => {
    const pool = [player(1, 'dc', 500, 4), player(2, 'pc', 100, 9)];
    expect(pickForUs(pool)!.id).toBe(2);
  });

  it('falls back to the price when nothing is priced', () => {
    const pool = [{ ...player(1, 'dc', 100), net: null }, { ...player(2, 'pc', 300), net: null }];
    expect(pickForUs(pool)!.id).toBe(2);
  });
});

describe('plan', () => {
  const pool = [
    player(1, 'pc', 300, 30),
    player(2, 'dc', 200, 20),
    player(3, 'dc', 150, 15),
    player(4, 'ds', 120, 12),
    player(5, 'pc', 110, 11),
    player(6, 'dc', 100, 10),
  ];

  it('takes our best, then everybody after us, then the next round up to us again', () => {
    const result = plan({
      teams: [team(0), team(1), team(2)],
      order: [0, 1, 2],
      pool,
      mineId: 0,
      shapes: SHAPES,
      keeperCap: 3,
      maxAheadPicks: 1,
    });
    expect(result.mine!.id).toBe(1); // our best net
    expect(result.rounds[0].after.map((row) => row.teamId)).toEqual([1, 2]);
    expect(result.rounds[0].before).toEqual([]); // those picks already happened
    expect(result.rounds[0].mine).toBeNull(); // the current round's pick is `mine`
    // We spent the most, so the next round starts with the others: our second pick comes after them.
    expect(result.rounds[1].before.every((row) => row.teamId !== 0)).toBe(true);
    expect(result.gap).toBe(result.rounds[0].after.length + result.rounds[1].before.length);
    expect(result.rounds[1].mine).not.toBeNull();
    // FOUR rounds, which is what the card's four columns read.
    expect(result.rounds.length).toBeGreaterThanOrEqual(3);
  });

  it('does not predict the same player twice', () => {
    const result = plan({
      teams: [team(0), team(1), team(2)],
      order: [0, 1, 2],
      pool,
      mineId: 0,
      shapes: SHAPES,
      keeperCap: 3,
      maxAheadPicks: 1,
    });
    const taken = [result.mine!.id,
                   ...result.rounds.flatMap((round) =>
                     [...round.before, ...round.after].map((row) => row.player.id)),
                   ...result.rounds.map((round) => round.mine?.id).filter((id) => id !== undefined)];
    expect(new Set(taken).size).toBe(taken.length);
  });

  it('puts whoever spent least on the clock first in the next round', () => {
    // Team 2 arrives with a big roster value, so it must choose LAST next round.
    const result = plan({
      teams: [team(0), team(1), team(2, { rosterValue: 900, pickValues: [900], picksCount: 1 })],
      order: [0, 1],
      pool,
      mineId: 0,
      shapes: SHAPES,
      keeperCap: 3,
      maxAheadPicks: 1,
    });
    expect(result.rounds[1].before.map((row) => row.teamId)).not.toContain(2);
  });

  it('runs a round to its END, so the next order stands on real pick counts', () => {
    const result = plan({
      teams: [team(0), team(1), team(2)],
      order: [0, 1, 2],
      pool,
      mineId: 0,
      shapes: SHAPES,
      keeperCap: 3,
      maxAheadPicks: 1,
      roundsAhead: 2,
    });
    // Round +1: everybody who is not us appears once, before us or after us - nobody skips a turn.
    const seen = [...result.rounds[1].before, ...result.rounds[1].after].map((row) => row.teamId);
    expect(new Set(seen)).toEqual(new Set([1, 2]));
  });

  it('says nothing rather than something when the pool is empty', () => {
    const result = plan({
      teams: [team(0)],
      order: [0],
      pool: [],
      mineId: 0,
      shapes: SHAPES,
      keeperCap: 3,
      maxAheadPicks: 1,
    });
    expect(result.mine).toBeNull();
    expect(result.gap).toBe(0);
  });
});

describe('nextOrder', () => {
  const pool = [
    player(1, 'pc', 300, 30),
    player(2, 'dc', 200, 20),
    player(3, 'dc', 150, 15),
    player(4, 'ds', 120, 12),
    player(5, 'pc', 110, 11),
    player(6, 'dc', 100, 10),
  ];

  it('puts whoever spent most LAST in the round after the simulated ones', () => {
    const result = plan({
      teams: [team(0), team(1), team(2)],
      order: [0, 1, 2],
      pool,
      mineId: 0,
      shapes: SHAPES,
      keeperCap: 3,
      maxAheadPicks: 1,
      roundsAhead: 2,
    });
    const spend = new Map(
      result.nextOrder.map((id) => [id, [result.mine, ...result.rounds.flatMap((round) =>
        [...round.before, ...round.after].filter((row) => row.teamId === id).map((row) => row.player))]]),
    );
    expect(result.nextOrder.length).toBe(3);
    expect(spend.size).toBe(3);
    // The order is a permutation of the teams, computed and not copied from the published one.
    expect(new Set(result.nextOrder)).toEqual(new Set([0, 1, 2]));
  });

  it('has no order to give when there is nothing to plan', () => {
    expect(plan({
      teams: [team(0)], order: [0], pool: [], mineId: 0,
      shapes: SHAPES, keeperCap: 3, maxAheadPicks: 1,
    }).nextOrder).toEqual([]);
  });
});

describe('planRoots', () => {
  const pool = [
    player(1, 'pc', 400, 40),   // il massimo netto, e ti manda in fondo
    player(2, 'pc', 244, 24),   // caro ma non il piu' caro: tiene la posizione
    player(3, 'dc', 200, 20),   // altro reparto
    player(4, 'pc', 11, 3),     // quasi gratis, netto basso
  ];

  it('offers three directions and not the top three of one list', () => {
    const roots = planRoots(pool, { mySpend: 0, rivalValues: [365, 271, 260, 250], keepWithin: 3 });
    expect(roots[0].player.id).toBe(1);
    expect(roots[0].why).toContain('massimo');
    expect(roots[1].player.id).toBe(3); // another line
    expect(roots[2].player.id).toBe(2); // the dearest that still keeps the place
    expect(roots[2].why).toMatch(/resti \d+° su 5/);
  });

  it('measures «keeps the place» on the ORDER and not on the price', () => {
    // With everybody spending 365+, a 244 squad is 1st of 5; the 11-credit man is not offered because
    // he is not the best NET among those that keep the place - which is the whole point of the rule.
    const roots = planRoots(pool, { mySpend: 0, rivalValues: [365, 371, 360, 350], keepWithin: 3 });
    expect(roots[2].player.id).toBe(2);
    expect(positionAfterSpending(244, 0, [365, 371, 360, 350])).toBe(1);
    // 400 is dearer than all four rivals, so it is last of five - which is the point of the option.
    expect(positionAfterSpending(400, 0, [365, 371, 360, 350])).toBe(5);
  });

  it('offers only two options when the order cannot be read', () => {
    expect(planRoots(pool).length).toBe(2);
  });
});

describe('predictRivalPick in the tail of a round', () => {
  const places = startingPlaces(SHAPES);
  // The dear name and the cheap man with real surplus: the two the tail has to choose between.
  const pool = [player(1, 'pc', 400, 20), player(2, 'dc', 40, 12)];

  it('takes the dearest when it chooses in the middle of the round', () => {
    expect(predictRivalPick(team(1), pool, places, 3, 5)!.id).toBe(1);
  });

  it('takes points PER CREDIT when it is last or second-to-last', () => {
    // 20/400 = 0.05 against 12/40 = 0.30: the cheap man wins, and the team keeps the next call.
    expect(predictRivalPick(team(1), pool, places, 3, 1)!.id).toBe(2);
    expect(predictRivalPick(team(1), pool, places, 3, TAIL_POSITIONS)!.id).toBe(2);
    // One place further from the end and the incentive is gone.
    expect(predictRivalPick(team(1), pool, places, 3, TAIL_POSITIONS + 1)!.id).toBe(1);
  });

  it('falls back to the baseline when the tail can price nobody', () => {
    const blind = [{ ...player(1, 'pc', 400), net: null }, { ...player(2, 'dc', 40), net: null }];
    expect(predictRivalPick(team(1), blind, places, 3, 1)!.id).toBe(1);
  });
});

describe('the tail does not fall for the nearly free', () => {
  const places = startingPlaces(SHAPES);
  // The defect this guards: a 1-credit filler with a scrap of surplus used to beat a real defender.
  const pool = [player(1, 'dc', 50, 12), player(2, 'dc', 1, 0.2), player(3, 'pc', 400, 20)];

  it('prefers a good player cheaply over the cheapest thing on the board', () => {
    expect(predictRivalPick(team(1), pool, places, 3, 1)!.id).toBe(1);
  });

  it('still lets the middle of the round chase the dearest name', () => {
    expect(predictRivalPick(team(1), pool, places, 3, 9)!.id).toBe(3);
  });
});
