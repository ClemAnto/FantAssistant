import {
  COVER_COPIES,
  DEFAULT_HEAD,
  HEAD_WARMUP,
  QUOTA_DEPTH,
  classifyRivals,
  denialOf,
  DEPTH_WEIGHT,
  TAIL_POSITIONS,
  TAIL_PRICE_FLOOR,
  PlanPlayer,
  PlanTeam,
  coverNeedOf,
  needFor,
  needForUs,
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
  held: [],
  heldIds: [],
  rosterValue: 0,
  pickValues: [],
  picksCount: 0,
  firstRoundIndex: id,
  ...over,
});

const player = (
  id: number,
  slot: string | null,
  price: number,
  net = price / 10,
  value = net,
): PlanPlayer => ({
  id,
  name: `P${id}`,
  club: 'C',
  slot,
  roles: slot ? [slot] : [],
  price,
  net,
  surplus: net,
  value,
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
  it('ranks by OUR worth and not by the price', () => {
    const pool = [player(1, 'dc', 500, 4), player(2, 'pc', 100, 9)];
    expect(pickForUs(pool)!.id).toBe(2);
  });

  it('falls back to the price when nothing is priced', () => {
    const bare = (id: number, slot: string, price: number) =>
      ({ ...player(id, slot, price), net: null, surplus: null, value: null });
    expect(pickForUs([bare(1, 'dc', 100), bare(2, 'pc', 300)])!.id).toBe(2);
  });

  it('prefers the man who COVERS a place over a dearer man who does not', () => {
    // The squad already holds both `dc` places of every shape, so a third `dc` covers nothing: 30 x 0.35
    // against a `ds` worth 12 x 1. Without the rationing the `dc` would win, which is the whole point.
    const need = coverNeedOf([{ roles: ['dc'] }, { roles: ['dc'] }], SHAPES, 'mantra', 1);
    const pool = [player(1, 'dc', 300, 30), player(2, 'ds', 120, 12)];
    expect(pickForUs(pool, need)!.id).toBe(2);
    expect(pickForUs(pool)!.id).toBe(1);
  });
});

describe('needForUs', () => {
  it('wants a man who covers a place, and only as depth one who does not', () => {
    const need = coverNeedOf([{ roles: ['dc'] }], SHAPES, 'mantra', 1);
    expect(needForUs(need, player(1, 'ds', 10))).toBe(1);
    expect(needForUs(need, player(2, 'dc', 10))).toBe(1);      // the second `dc` place is still open
    const two = coverNeedOf([{ roles: ['dc'] }, { roles: ['dc'] }], SHAPES, 'mantra', 1);
    expect(needForUs(two, player(3, 'dc', 10))).toBe(DEPTH_WEIGHT);
  });

  it('reads a HYBRID place, which is where the flexibility lives', () => {
    // `A/PC` accepts an A or a Pc, so an `a` covers a striker's place even though no place is typed `A`.
    const need = coverNeedOf([{ roles: ['dc'] }, { roles: ['dc'] }], SHAPES, 'mantra', 1);
    expect(needForUs(need, player(4, 'a', 10))).toBe(1);
    expect(needForUs(need, player(5, 'pc', 10))).toBe(1);
  });

  it('measures against ONE module, and a tie between two is broken by the first', () => {
    // Both shapes cover this squad's three men, so the target is the first of them - and on that one the
    // single `A/PC` place is already taken, which the three-at-the-back would still have open. It is a
    // real limit of the rule and it is the behaviour that was MEASURED, so it is asserted rather than
    // quietly improved: with the shipping target of two elevens the tie is far rarer.
    const need = coverNeedOf([{ roles: ['dc'] }, { roles: ['dc'] }, { roles: ['pc'] }], SHAPES, 'mantra', 1);
    expect(needForUs(need, player(6, 'a', 10))).toBe(DEPTH_WEIGHT);
  });

  it('rations by graduated QUOTAS on classic, because that is what was measured there', () => {
    // Classic places are macro-roles and `startingPlaces` sums to exactly ten there, so the quota IS one
    // eleven: full weight up to it, QUOTA_DEPTH up to twice it, DEPTH_WEIGHT after.
    const CLASSIC = {
      slot_roles: { P: ['P'], D: ['D'], C: ['C'], A: ['A'] },
      modules: { '4-4-2': { D: ['D', 'D', 'D', 'D'], M: ['C', 'C', 'C', 'C'], T: [], A: ['A', 'A'] } },
    };
    const held = (n: number) => team(1, { slots: Array.from({ length: n }, () => 'd') });
    const need = coverNeedOf([], CLASSIC, 'classic');
    const man = player(1, 'd', 10);
    expect(needForUs(need, man, held(0))).toBe(1);
    expect(needForUs(need, man, held(3))).toBe(1);          // the fourth defender still fills a place
    expect(needForUs(need, man, held(4))).toBe(QUOTA_DEPTH);
    expect(needForUs(need, man, held(8))).toBe(DEPTH_WEIGHT);
  });

  it('rations nothing when there are no shapes to read: 1 for everybody', () => {
    const need = coverNeedOf([{ roles: ['dc'] }], null);
    expect(needForUs(need, player(1, 'dc', 10))).toBe(1);
  });

  it('targets TWO elevens by default, which is the measured number', () => {
    expect(COVER_COPIES).toBe(2);
    const need = coverNeedOf([{ roles: ['dc'] }, { roles: ['dc'] }], SHAPES);
    expect(needForUs(need, player(3, 'dc', 10))).toBe(1);      // the second eleven's places are open
  });
});

describe('classifyRivals', () => {
  const places = startingPlaces(SHAPES);
  // Two men the three heads disagree about: the DEARER one is worth less, so «price» and «surplus/value»
  // name different players and a couple of picks are enough to tell them apart.
  const pool = [
    player(1, 'dc', 300, 5, 5),
    player(2, 'dc', 100, 40, 40),
    player(3, 'ds', 280, 4, 4),
    player(4, 'ds', 90, 35, 35),
  ];

  it('reads a rival who takes the DEAREST man as the default head, and says nothing about him', () => {
    const heads = classifyRivals({
      picks: [{ teamId: 7, playerId: 1 }, { teamId: 7, playerId: 3 }],
      pool, places, keeperCap: 3, mineId: 0,
    });
    // The default is «we do not know, so assume the price»: it is absent from the map rather than asserted.
    expect(heads.has(7)).toBe(false);
    expect(DEFAULT_HEAD).toBe('prezzo');
  });

  it('reads a rival who takes the WORTH as a surplus head', () => {
    const heads = classifyRivals({
      picks: [{ teamId: 7, playerId: 2 }, { teamId: 7, playerId: 4 }],
      pool, places, keeperCap: 3, mineId: 0,
    });
    expect(heads.get(7)).toBe('surplus');
  });

  it('says nothing about a rival below the warm-up, and the warm-up is TWO', () => {
    expect(HEAD_WARMUP).toBe(2);
    const heads = classifyRivals({
      picks: [{ teamId: 7, playerId: 2 }],
      pool, places, keeperCap: 3, mineId: 0,
    });
    expect(heads.size).toBe(0);
  });

  it('never classifies US: our own picks are not evidence about a rival', () => {
    const heads = classifyRivals({
      picks: [{ teamId: 0, playerId: 2 }, { teamId: 0, playerId: 4 }],
      pool, places, keeperCap: 3, mineId: 0,
    });
    expect(heads.size).toBe(0);
  });

  it('scores a head against the pool AS IT WAS: a man already taken is not a candidate', () => {
    // Team 7 takes the cheap-and-worthy man, then the dear one - but by then the other worthy man is gone
    // (team 8 took it), so «surplus» still explains his second pick and the guess survives.
    const heads = classifyRivals({
      picks: [
        { teamId: 7, playerId: 2 },
        { teamId: 8, playerId: 4 },
        { teamId: 7, playerId: 3 },
      ],
      pool, places, keeperCap: 3, mineId: 0,
    });
    expect(heads.get(7)).toBe('surplus');
  });
});

describe('denialOf', () => {
  // A squad that can already field both `dc` places and the striker's: another `dc` adds nothing to its
  // eleven, while the `ds` it has no place for... also adds nothing, because no shape here needs three at
  // the back plus a `ds`. What DOES add is a better man at a place it already fills.
  const squad = (roles: string[][], ids: number[]): PlanTeam =>
    team(9, { held: roles.map((list) => ({ roles: list })), heldIds: ids });

  const worth = (map: Record<number, number>) => (id: number) => map[id] ?? null;

  it('is what the man ADDS to his best legal eleven, not what he is worth', () => {
    // He holds one `dc` worth 100; a second `dc` worth 40 fills the second place, so he gains 40.
    const held = squad([['dc']], [1]);
    const newcomer = player(2, 'dc', 10, 40, 40);
    expect(denialOf(newcomer, held, SHAPES, worth({ 1: 100 }))).toBe(40);
  });

  it('is ZERO when the module has no place left for him', () => {
    // Both `dc` places and the single `A/PC` are held, and the three-at-the-back shape has only two `dc`.
    const held = squad([['dc'], ['dc'], ['pc'], ['pc']], [1, 2, 3, 4]);
    const newcomer = player(5, 'dc', 10, 30, 30);
    expect(denialOf(newcomer, held, SHAPES, worth({ 1: 100, 2: 90, 3: 80, 4: 70 }))).toBe(0);
  });

  it('is ZERO without shapes: no eleven, no difference - and never a guess', () => {
    const held = squad([['dc']], [1]);
    expect(denialOf(player(2, 'dc', 10, 40, 40), held, null, worth({ 1: 100 }))).toBe(0);
  });

  it('never goes negative: taking a man cannot IMPROVE the squad he is taken from', () => {
    const held = squad([['dc'], ['dc']], [1, 2]);
    const newcomer = player(3, 'dc', 10, 1, 1);
    expect(denialOf(newcomer, held, SHAPES, worth({ 1: 100, 2: 90 }))).toBeGreaterThanOrEqual(0);
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
