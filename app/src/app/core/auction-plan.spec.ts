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
  PickCap,
  PlanPlayer,
  capBlocks,
  capContradiction,
  PlanTeam,
  coverNeedOf,
  needFor,
  needForUs,
  goneBeforeOurNextTurn,
  takenBeforeOurTurn,
  pickForUs,
  plan,
  planRoots,
  positionAfterSpending,
  predictRivalPick,
  rivalPicksHorizon,
  rivalWalker,
  ahead,
  nextCaller,
  roleFull,
  startingPlaces,
  ORDER_SETTLES_AFTER,
  ourTurnPin,
  settledAfter,
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

describe('the classic quotas (30/09/2026)', () => {
  const places = startingPlaces(SHAPES);
  const limits = { por: 3, dif: 8, cen: 8, att: 6 };

  it('reads a classic keeper `P` as a keeper, so the fourth is never predicted', () => {
    const keepers = [player(9, 'P', 500), player(3, 'D', 10)];
    const full = team(1, { slots: ['P', 'P', 'P'] });
    expect(predictRivalPick(full, keepers, places, 3)!.id).toBe(3);
  });

  it('never predicts a ninth defender, nor lets our own pick take one', () => {
    const eight = team(1, { slots: Array(8).fill('D'), picksCount: 8, limits });
    const pool = [player(1, 'D', 300), player(2, 'A', 20)];
    expect(roleFull(eight, 'D')).toBe(true);
    expect(roleFull(eight, 'A')).toBe(false);
    expect(predictRivalPick(eight, pool, places, 3)!.id).toBe(2);
    expect(pickForUs(pool, null, eight)!.id).toBe(2);
    // Without quotas (mantra) the same squad may take him: nothing changes there.
    expect(pickForUs(pool, null, team(1, { slots: Array(8).fill('D'), picksCount: 8 }))!.id).toBe(1);
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

describe('the rival walk leaves the tail rule off unless asked (todolist classic, item 1.4)', () => {
  const places = startingPlaces(SHAPES);
  const pool = [player(1, 'pc', 400, 20), player(2, 'dc', 40, 12)];
  const walkFrom = (tail?: boolean) => {
    const teams = new Map([[1, team(1)]]);
    const walk = rivalWalker({ teams: [team(1)], order: [1], pool, places, mineId: 0, keeperCap: 3,
      maxAheadPicks: 1, ...(tail === undefined ? {} : { tail }) }, teams);
    walk.step(1, TAIL_POSITIONS);
    return [...walk.gone.keys()];
  };

  it('predicts the dearest by default, and the tail only when asked for (off since 30/09/2026)', () => {
    expect(walkFrom()).toEqual([1]);
    expect(walkFrom(false)).toEqual([1]);
    expect(walkFrom(true)).toEqual([2]);
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

describe('the FVM ceiling of the first turns (operator, 28/09/2026)', () => {
  // «Non sarà possibile scegliere un calciatore con FVM >= 213 prima del sesto turno.»
  const CAP: PickCap = { fvm: 213, frozenTurns: 5 };
  const places = startingPlaces(SHAPES);

  it('blocks from the threshold INCLUDED, and only before the turn named', () => {
    expect(capBlocks(0, 213, CAP)).toBe(true); // first turn, exactly 213: blocked, the sign is >=
    expect(capBlocks(0, 212, CAP)).toBe(false);
    expect(capBlocks(4, 300, CAP)).toBe(true); // fifth turn: still before the sixth
    expect(capBlocks(5, 300, CAP)).toBe(false); // sixth turn: free
    expect(capBlocks(0, 499, null)).toBe(false); // no ceiling declared, nobody is blocked
  });

  it('keeps a blocked man out of OUR pick, and lets him in on the turn it opens', () => {
    const pool = [player(1, 'pc', 300, 30), player(2, 'pc', 150, 20)];
    expect(pickForUs(pool, null, team(0), null, CAP)!.id).toBe(2);
    expect(pickForUs(pool, null, team(0, { picksCount: 5 }), null, CAP)!.id).toBe(1);
  });

  it('answers NOTHING rather than a forbidden man when every name is blocked', () => {
    expect(pickForUs([player(1, 'pc', 300, 30)], null, team(0), null, CAP)).toBeNull();
  });

  it('binds the rivals too, so the lookahead never hands them a man they cannot call', () => {
    const pool = [player(1, 'pc', 300), player(2, 'pc', 150)];
    expect(predictRivalPick(team(1), pool, places, 3, Infinity, DEFAULT_HEAD, CAP)!.id).toBe(2);
    expect(predictRivalPick(team(1, { picksCount: 5 }), pool, places, 3, Infinity, DEFAULT_HEAD, CAP)!.id)
      .toBe(1);
  });

  it('does not count a blocked man as GONE before our next turn, because nobody could take him', () => {
    const pool = [player(1, 'pc', 300), player(2, 'pc', 150), player(3, 'pc', 120)];
    const gone = goneBeforeOurNextTurn({
      teams: [team(0), team(1), team(2)],
      order: [0, 1, 2],
      pool,
      places,
      mineId: 0,
      keeperCap: 3,
      maxAheadPicks: 1,
      cap: CAP,
    });
    expect(gone.has(1)).toBe(false);
  });

  it('refuses a what-if root the ceiling forbids, and plays its own pick instead', () => {
    const pool = [player(1, 'pc', 300, 30), player(2, 'dc', 150, 20), player(3, 'dc', 100, 10)];
    const result = plan({
      teams: [team(0), team(1)],
      order: [0, 1],
      pool,
      mineId: 0,
      shapes: SHAPES,
      keeperCap: 3,
      maxAheadPicks: 1,
      rootId: 1,
      cap: CAP,
    });
    expect(result.mine!.id).not.toBe(1);
  });

  it('opens the dear man in the simulated rounds exactly at the turn the ceiling names', () => {
    // Four picks behind us: THIS is our fifth turn (blocked), the next simulated one is the sixth.
    const four = { picksCount: 4, pickValues: [10, 10, 10, 10], rosterValue: 40 };
    const pool = [player(1, 'pc', 300, 90), player(2, 'dc', 150, 20), player(3, 'dc', 100, 10)];
    const result = plan({
      teams: [team(0, four), team(1, { ...four, firstRoundIndex: 1 })],
      order: [0, 1],
      pool,
      mineId: 0,
      shapes: SHAPES,
      keeperCap: 3,
      maxAheadPicks: 1,
      cap: CAP,
    });
    expect(result.mine!.id).not.toBe(1); // fifth turn: he is not ours to call
    // ...and the rival behind us is on his fifth turn too, so he cannot take him either.
    expect(result.rounds[0].after.map((row) => row.player.id)).not.toContain(1);
    // Sixth turn for both: he is still on the board, and now somebody takes him.
    const next = result.rounds[1];
    expect([next.mine?.id, ...[...next.before, ...next.after].map((row) => row.player.id)]).toContain(1);
  });
});

describe('takenBeforeOurTurn (operator, 29/09/2026)', () => {
  const places = startingPlaces(SHAPES);
  const pool = [player(1, 'pc', 300), player(2, 'dc', 200), player(3, 'dc', 100), player(4, 'pc', 50)];
  const base = { pool, places, keeperCap: 3, maxAheadPicks: 1 };

  it('while others are on the clock, names the men the squads calling before us take, and who takes them', () => {
    const taken = takenBeforeOurTurn({ ...base, teams: [team(0), team(1), team(2)], order: [1, 2, 0], mineId: 0 });
    expect([...taken.values()].sort()).toEqual([1, 2]);
    expect(taken.size).toBe(2);
    expect(taken.get(1)).toBe(1); // the first to call takes the dearest: the rivals call by price
  });

  it('when we are on the clock, is the set our advice waits out (goneBeforeOurNextTurn)', () => {
    const input = { ...base, teams: [team(0), team(1), team(2)], order: [0, 1, 2], mineId: 0 };
    expect(new Set(takenBeforeOurTurn(input).keys())).toEqual(goneBeforeOurNextTurn(input));
  });
});

/**
 * THE ORDER SETTLES AFTER TWO ROUNDS (operator, 08/10/2026: «dopo 2 giri ... la prossima scelta si farà dopo 9 turni»):
 * under the `default` order, from our third pick our next turn comes after one call of every rival, whatever we pay.
 */
describe('ORDER_SETTLES_AFTER', () => {
  const places = startingPlaces(SHAPES);
  const pool = [player(1, 'pc', 300), player(2, 'dc', 200), player(3, 'dc', 100), player(4, 'pc', 50),
    player(5, 'pc', 40), player(6, 'dc', 30)];
  const base = { pool, places, keeperCap: 3, maxAheadPicks: 1, rounds: 25 };
  // We are the LAST of this round, on the clock; the rivals paid big this round and passed our zero-priced value, so
  // the platform's rule would hand us the first call of the next round too: back to back.
  const table = (picks: number) => [
    team(0, { picksCount: picks, rosterValue: 130 }),
    team(1, { picksCount: picks + 1, rosterValue: 400 }),
    team(2, { picksCount: picks + 1, rosterValue: 410 }),
    team(3, { picksCount: picks + 1, rosterValue: 420 }),
  ];

  it('is the platform\'s rule for our first two picks, and one call of every rival from the third', () => {
    expect(settledAfter(1)).toBe(false);
    expect(settledAfter(ORDER_SETTLES_AFTER)).toBe(true);
    expect(settledAfter(ORDER_SETTLES_AFTER, 'pingpong')).toBe(false);
    const early = goneBeforeOurNextTurn({ ...base, teams: table(1), order: [0, 1, 2, 3], mineId: 0 });
    expect(early.size).toBe(0); // the rule still moves us: our second pick would follow at once
    const settled = goneBeforeOurNextTurn({ ...base, teams: table(2), order: [0, 1, 2, 3], mineId: 0 });
    expect(settled.size).toBe(3);
  });

  it('off the clock, counts the rivals that have already called since our pick (`lastPickAt`)', () => {
    const teams = [
      team(0, { picksCount: 3, rosterValue: 200, lastPickAt: 20 }),
      team(1, { picksCount: 3, rosterValue: 100, lastPickAt: 21 }), // called after us
      team(2, { picksCount: 2, rosterValue: 50, lastPickAt: 17 }), // on the clock
      team(3, { picksCount: 3, rosterValue: 80, lastPickAt: 18 }), // called before us
    ];
    const pin = ourTurnPin(new Map(teams.map((one) => [one.id, one])), 0, 'default', false);
    expect([...pin!.called]).toEqual([1]);
    // 2 closes the round, 3 calls again; 1 already has: our turn. The rule alone would let 1 pass too (100 < 200).
    const taken = takenBeforeOurTurn({ ...base, teams, order: [2, 0, 1, 3], mineId: 0 });
    expect(taken.size).toBe(2);
    expect(new Set(taken.values())).toEqual(new Set([2, 3]));
  });

  it('no pin while our call of the round being played is still to come: that order is already fixed', () => {
    const teams = new Map([0, 1, 2].map((id) => [id, team(id, { picksCount: 3, lastPickAt: 10 + id })]));
    expect(ourTurnPin(teams, 0, 'default', false)).toBeNull();
  });
});

/**
 * THE SNAKE (`pickOrderType: pingpong`), observed on the classic draft FA-yei-458 (30/09/2026, 250 picks of 250):
 * the first round's order, reversed on every other round, and the roster's price moves nobody. The `default`
 * rule of the same function is what FA-l1n-0pn (classic, 200 of 200) and FA-jo5-zai (mantra, 384 of 384) play.
 */
describe('the order rule', () => {
  const table = (picks: number, values: number[]) =>
    new Map(values.map((value, id) => [id, team(id, { picksCount: picks, rosterValue: value, pickValues: [value] })]));

  it('on a snake, the first round order forward on even rounds and backwards on odd ones, whatever was paid', () => {
    // Squad 0 is the richest, squad 2 the poorest: the default rule would put 2 first.
    const even = table(2, [300, 200, 100]);
    expect(nextCaller(even, 1, Infinity, 'pingpong')!.id).toBe(0);
    const odd = table(1, [300, 200, 100]);
    expect(nextCaller(odd, 1, Infinity, 'pingpong')!.id).toBe(2);
    expect(nextCaller(odd, 1)!.id).toBe(2);
    expect(nextCaller(even, 1)!.id).toBe(2);
  });

  it('still lets fewer picks go first, and reads an absent rule as the default one', () => {
    const teams = table(3, [100, 200, 300]);
    teams.set(2, { ...teams.get(2)!, picksCount: 2 });
    expect(nextCaller(teams, 1, Infinity, 'pingpong')!.id).toBe(2);
    const a = team(0, { picksCount: 1, rosterValue: 50 });
    const b = team(1, { picksCount: 1, rosterValue: 10 });
    expect(ahead(a, b, 1)).toBeGreaterThan(0);
    expect(ahead(a, b, 1, 'pingpong')).toBeGreaterThan(0);
    expect(ahead(team(0, { picksCount: 2, rosterValue: 50 }), team(1, { picksCount: 2, rosterValue: 10 }), 1, 'pingpong'))
      .toBeLessThan(0);
  });
});

/**
 * THE HORIZON WALK of the «+Giro» column (06/10/2026): one walk past the latest places our turns can fall,
 * so every candidate chain reads its own prefixes of it by its prices (`draft-turn.goneUpTo`).
 */
describe('rivalPicksHorizon', () => {
  const places = startingPlaces(SHAPES);
  const pool = [player(1, 'pc', 500), player(2, 'pc', 400), player(3, 'pc', 300), player(4, 'pc', 200),
    player(5, 'pc', 150), player(6, 'pc', 120), player(7, 'pc', 100), player(8, 'pc', 80)];
  const base = { order: [0, 1, 2], pool, places, mineId: 0, keeperCap: 3, maxAheadPicks: 1, rounds: 25 };

  it('walks the rest of this round and the asked rounds beyond, with each later caller\'s projected value', () => {
    const { steps, myTurns } = rivalPicksHorizon({ ...base, teams: [team(0), team(1), team(2)] }, 3);
    // Two rivals close this round (always before us), then both call in each of the three rounds watched.
    expect(steps.map((step) => step.playerId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(steps.map((step) => step.round)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(steps.map((step) => step.value)).toEqual([null, null, 400, 500, 700, 700, 820, 850]);
    // Priced at zero we would call FIRST in every future round: right after each round's boundary.
    expect(myTurns).toEqual([2, 4, 6]);
  });

  it('on a snake records where our turns fall, which no price can move', () => {
    const { steps, myTurns } = rivalPicksHorizon({
      ...base, teams: [team(0), team(1), team(2)], orderType: 'pingpong' as const,
    }, 2);
    // Round 0 forward (1, 2), round 1 backwards (2, 1, us), round 2 forward (us, 1, 2).
    expect(steps.length).toBe(6);
    expect(myTurns).toEqual([4, 4]);
  });
});

describe('capContradiction', () => {
  const CAP = { fvm: 213, frozenTurns: 5 };
  const squad = (label: string, prices: number[]) => ({
    label,
    picks: prices.map((price, i) => ({ index: i * 10 + 3, price, name: `${label}${i}` })),
  });

  it('names the pick that breaks the ceiling inside the frozen turns of a squad', () => {
    expect(capContradiction([squad('A', [100, 90]), squad('B', [120, 235])], CAP)).toEqual({ team: 'B', name: 'B1', turn: 2 });
  });

  it('a dear man taken AFTER the frozen turns proves nothing', () => {
    expect(capContradiction([squad('A', [100, 90, 80, 70, 60, 260])], CAP)).toBeNull();
  });

  it('reads the picks in table order, not in the order they are listed', () => {
    const shuffled = { label: 'C', picks: [{ index: 60, price: 250, name: 'late' }, ...squad('C', [10, 10, 10, 10, 10]).picks] };
    expect(capContradiction([shuffled], CAP)).toBeNull();
  });

  it('no declared ceiling, nothing to contradict', () => {
    expect(capContradiction([squad('A', [300])], null)).toBeNull();
  });
});
