import {
  EngineNumbers,
  demandBySlot,
  demandFromShapes,
  lambdaOf,
  liveReplacements,
  netOf,
  per,
  score99,
  slotShares,
  surplusOf,
  valuationOf,
  valueOf,
} from './auction-value';

const numbers = (over: Partial<EngineNumbers> = {}): EngineNumbers => ({
  fm: null,
  pv: null,
  slot: 'pc',
  replacementFm: 6,
  surplusLeague: null,
  unpricedReason: null,
  estFm: null,
  estPv: null,
  estConfidence: null,
  estBasis: null,
  estNote: null,
  minutesFullSeason: null,
  seasonMatches: null,
  ...over,
});

describe('valuationOf', () => {
  it('prefers the measured pair', () => {
    const valuation = valuationOf(numbers({ fm: 7.2, pv: 26, estFm: 6.1, estPv: 20 }));
    expect(valuation.basis).toBe('measured');
    expect([valuation.fm, valuation.pv, valuation.confidence]).toEqual([7.2, 26, 1]);
  });

  it('falls back to the estimate, carrying its penalty and its reason', () => {
    const valuation = valuationOf(
      numbers({ estFm: 6.05, estPv: 18, estConfidence: 0.55, estNote: 'thin season' }),
    );
    expect(valuation.basis).toBe('estimated');
    expect(valuation.confidence).toBe(0.55);
    expect(valuation.note).toBe('thin season');
  });

  it('says a man has NO number instead of calling it zero', () => {
    const valuation = valuationOf(numbers({ unpricedReason: 'only 3 votes of 15' }));
    expect(valuation.basis).toBe('none');
    expect(valuation.fm).toBeNull();
    expect(valuation.note).toBe('only 3 votes of 15');
  });
});

describe('valueOf and score99', () => {
  it('is the gross worth: fantamedia times appearances, nothing subtracted', () => {
    expect(valueOf(valuationOf(numbers({ fm: 8, pv: 25 })))).toBe(200);
  });

  it('carries the estimate penalty, like the surplus does, so one column ranks the whole list', () => {
    expect(valueOf(valuationOf(numbers({ estFm: 8, estPv: 25, estConfidence: 0.5 })))).toBe(100);
  });

  it('has no answer for a man with no number', () => {
    expect(valueOf(valuationOf(numbers()))).toBeNull();
  });

  it('puts the best man of the listone at 99 and scales the rest linearly', () => {
    expect(score99(228, 228)).toBe(99);
    expect(score99(114, 228)).toBe(50);   // twice the fantapunti reads as twice the score
    expect(score99(0, 228)).toBe(0);
  });

  it('says nothing instead of inventing a scale', () => {
    expect(score99(null, 228)).toBeNull();
    expect(score99(100, 0)).toBeNull();
    expect(score99(100, null)).toBeNull();
  });
});

describe('demandBySlot', () => {
  it('reads the league demand off the sheet: the men it puts above their own zero', () => {
    const demand = demandBySlot([
      numbers({ fm: 8, pv: 26, replacementFm: 6, slot: 'pc' }),
      numbers({ fm: 6, pv: 26, replacementFm: 6, slot: 'pc' }), // at the line: still rostered
      numbers({ fm: 5.4, pv: 26, replacementFm: 6, slot: 'pc' }), // below: the bench
      numbers({ fm: 6.5, pv: 20, replacementFm: 6.2, slot: 'dc' }),
    ]);
    expect(demand.get('pc')).toBe(2);
    expect(demand.get('dc')).toBe(1);
  });

  it('counts an estimated man too, because he can be bought like any other', () => {
    const demand = demandBySlot([numbers({ estFm: 6.4, estPv: 20, replacementFm: 6, slot: 'w' })]);
    expect(demand.get('w')).toBe(1);
  });
});

describe('liveReplacements', () => {
  const free = [
    { id: 1, slot: 'pc', fm: 8.0 },
    { id: 2, slot: 'pc', fm: 7.0 },
    { id: 3, slot: 'pc', fm: 6.0 },
    { id: 4, slot: 'pc', fm: 5.0 },
  ];

  it('is the last man the table still has room for', () => {
    const zeros = liveReplacements(free, new Map([['pc', 3]]), new Map());
    expect(zeros.get('pc')).toBe(6.0);
  });

  it('does not move when the men taken were all above the line', () => {
    // Demand 3, the 8.0 is gone: two places left among 7.0/6.0/5.0, so the zero is still 7.0's rival.
    const zeros = liveReplacements(free.slice(1), new Map([['pc', 3]]), new Map([['pc', 1]]));
    expect(zeros.get('pc')).toBe(6.0);
  });

  it('rises when somebody digs below the line, which shrinks every surplus left', () => {
    // The 5.0 was bought: demand 2 remains over 8.0/7.0/6.0, so the bench is now 7.0.
    const zeros = liveReplacements(
      free.filter((man) => man.id !== 4),
      new Map([['pc', 3]]),
      new Map([['pc', 1]]),
    );
    expect(zeros.get('pc')).toBe(7.0);
  });

  it('takes the worst man available when the pool is thinner than the demand', () => {
    const zeros = liveReplacements(free.slice(0, 2), new Map([['pc', 10]]), new Map());
    expect(zeros.get('pc')).toBe(7.0);
  });

  it('has no zero for a slot nobody is buying any more', () => {
    expect(liveReplacements(free, new Map([['pc', 2]]), new Map([['pc', 2]])).has('pc')).toBe(false);
  });
});

describe('surplusOf', () => {
  it('is points over the bench across the appearances expected', () => {
    const valuation = valuationOf(numbers({ fm: 7, pv: 26 }));
    expect(surplusOf(valuation, 6)).toBeCloseTo(26, 6);
  });

  it('scales with the horizon, and the factor cannot reorder anybody', () => {
    const a = valuationOf(numbers({ fm: 7, pv: 26 }));
    const b = valuationOf(numbers({ fm: 6.5, pv: 30 }));
    const full = [surplusOf(a, 6)!, surplusOf(b, 6)!];
    const short = [surplusOf(a, 6, 4 / 31)!, surplusOf(b, 6, 4 / 31)!];
    expect(short[0]).toBeCloseTo(full[0] * (4 / 31), 6);
    expect(full[0] > full[1]).toBe(short[0] > short[1]);
  });

  it('penalises the SURPLUS of an estimated man, never his fantamedia', () => {
    const valuation = valuationOf(numbers({ estFm: 7, estPv: 26, estConfidence: 0.5 }));
    expect(valuation.fm).toBe(7);
    expect(surplusOf(valuation, 6)).toBeCloseTo(13, 6);
  });

  it('has no answer without a zero', () => {
    expect(surplusOf(valuationOf(numbers({ fm: 7, pv: 26 })), null)).toBeNull();
  });
});

describe('lambdaOf and netOf', () => {
  const priced = [
    { id: 1, surplus: 40, price: 365 }, // 0.110
    { id: 2, surplus: 20, price: 100 }, // 0.200
    { id: 3, surplus: 1.5, price: 5 }, // 0.300
  ];

  it('is the rate of the last man the residual demand can still take', () => {
    expect(lambdaOf(priced, 1)).toBeCloseTo(0.3, 6);
    expect(lambdaOf(priced, 2)).toBeCloseTo(0.2, 6);
    expect(lambdaOf(priced, 3)).toBeCloseTo(40 / 365, 6);
  });

  it('reorders the cheap curiosity away from the top, which is why it exists', () => {
    const lambda = 0.1;
    const byRatio = [...priced].sort((a, b) => b.surplus / b.price - a.surplus / a.price);
    const byNet = [...priced].sort(
      (a, b) => netOf(b.surplus, b.price, lambda)! - netOf(a.surplus, a.price, lambda)!,
    );
    expect(byRatio.map((man) => man.id)).toEqual([3, 2, 1]);
    expect(byNet.map((man) => man.id)).toEqual([2, 1, 3]);
  });

  it('refuses a rate when there is nothing left to buy or nothing priced', () => {
    expect(lambdaOf(priced, 0)).toBeNull();
    expect(lambdaOf([{ id: 9, surplus: null, price: 10 }], 5)).toBeNull();
    expect(netOf(30, 100, null)).toBeNull();
  });
});

describe('per', () => {
  it('spreads a total over ten rounds', () => {
    // 27.3 points across a 31-round competition: what he adds every ten rounds.
    expect(per(27.3, 31)).toBeCloseTo(8.81, 2);
    expect(per(27.3, 31, 1)).toBeCloseTo(0.881, 3);
  });

  it('is the SAME number whatever the competition is long', () => {
    // A 4-round window carries 4/31 of the total, so per-10 does not move: that is the point.
    const total = 27.3;
    expect(per(total * (4 / 31), 4)).toBeCloseTo(per(total, 31)!, 6);
  });

  it('cannot reorder anybody: it is one constant', () => {
    const a = per(27.3, 31)!;
    const b = per(27.6, 31)!;
    expect(a < b).toBe(27.3 < 27.6);
  });

  it('has no answer without a horizon, and none for a man with no surplus', () => {
    expect(per(27.3, null)).toBeNull();
    expect(per(27.3, 0)).toBeNull();
    expect(per(null, 31)).toBeNull();
  });
});

describe('slotShares and demandFromShapes', () => {
  // Two shapes, cut to the bone: one with a pure DS place, one without, plus a shared W/A.
  const rules = {
    slot_roles: { DS: ['Ds'], DC: ['Dc'], 'DC/B': ['Dc', 'B'], 'W/A': ['W', 'A'] },
    modules: {
      'four-at-the-back': { D: ['DS', 'DC'], A: ['W/A'] },
      'three-at-the-back': { D: ['DC', 'DC/B'], A: ['W/A'] },
    },
  };

  it('splits a shared place among the roles that may fill it', () => {
    const shares = slotShares(rules);
    // W/A appears in both shapes and takes a w or an a: half a place each, every shape.
    expect(shares.get('w')).toBeCloseTo(0.5, 6);
    expect(shares.get('a')).toBeCloseTo(0.5, 6);
    // DC/B is shared too, so B exists only half of the shapes it appears in.
    expect(shares.get('b')).toBeCloseTo(0.25, 6);
  });

  it('counts a role that only some shapes field for the shapes that do', () => {
    // DS is in one shape of two: a table playing a mix needs it half of the time.
    expect(slotShares(rules).get('ds')).toBeCloseTo(0.5, 6);
    // Dc is in both, twice in the second: (1 + 1.5) / 2.
    expect(slotShares(rules).get('dc')).toBeCloseTo(1.25, 6);
  });

  it('turns the shares into men once the squad size is known', () => {
    const demand = demandFromShapes(slotShares(rules), 10, 30);
    // Three places per shape here, so 30 outfield men over 3 places is 10 men per place.
    expect(demand.get('ds')).toBe(Math.round((0.5 / 3) * 30 * 10));
    // Nobody is ever demanded zero: a role with a place in some shape can always be bought.
    expect([...demand.values()].every((men) => men >= 1)).toBe(true);
  });

  it('has nothing to say without shapes or without a squad', () => {
    expect(slotShares({ slot_roles: {}, modules: {} }).size).toBe(0);
    expect(demandFromShapes(slotShares(rules), 0, 30).size).toBe(0);
    expect(demandFromShapes(slotShares(rules), 10, 0).size).toBe(0);
  });
});
