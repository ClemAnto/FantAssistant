import { MantraModules } from './auction-value';
import { DOOR_HOLE_COST, DraftPlace, bonusFirst, doorHolePrice, addedYield, combinedCover, coverOf, starterWeight, draftPitchOf, flanksOutside, placeYield, preferring, recommendedModules, spreadReserves, withSuggestions } from './draft-pitch';
import type { FantaMan } from './fanta-eleven';

/**
 * Two shapes cut to the bone. `second` is declared LAST and fields the same men as `first` on an empty or
 * thin squad, so a tie shows which of the two the preference hands it to.
 */
const SHAPES: MantraModules = {
  slot_roles: { P: ['Por'], DC: ['Dc'], 'A/PC': ['A', 'Pc'] },
  modules: {
    first: { D: ['DC', 'DC'], M: [], T: [], A: ['A/PC'] },
    second: { D: ['DC', 'DC'], M: [], T: [], A: ['A/PC'] },
    wide: { D: ['DC'], M: [], T: [], A: ['A/PC', 'A/PC'] },
  },
};

let next = 1;
const man = (name: string, roles: string[], value: number | null): FantaMan => ({
  id: next++,
  name,
  club: 'Club',
  shown: roles,
  roles: roles.map((role) => role.toLowerCase()),
  value,
  value99: value == null ? null : Math.round(value),
  cost: 10,
  minutesPerMatch: null,
});

const place = (slot: string, roles: string[], holder: FantaMan | null): DraftPlace => ({
  line: 'D',
  slot,
  roles,
  man: holder,
  badge: null,
  reserves: [],
});

describe('recommendedModules', () => {
  it("names the operator's modules of each game, in his order (classic: 30/09/2026)", () => {
    expect(recommendedModules(true)).toEqual(['4-2-3-1', '4-1-4-1']);
    expect(recommendedModules(false)).toEqual(['3-4-3', '4-3-3']);
  });
});

describe('draftPitchOf', () => {
  it('draws an EMPTY squad on the first preferred module, every place empty', () => {
    const pitch = draftPitchOf([], SHAPES, ['second']);
    expect(pitch?.module).toBe('second');
    expect(pitch?.placed).toBe(0);
    expect(pitch?.rows.flatMap((row) => row.places).length).toBe(4);
    expect(pitch?.rows.flatMap((row) => row.places).every((one) => one.man === null)).toBe(true);
  });

  it('hands a TIE to the preferred module and a strictly better eleven to whoever fields it', () => {
    // Starters are chosen on their fertility since 01/10/2026, so they need a share and a bonus to be chosen at all.
    const plays = (one: FantaMan): FantaMan => ({ ...one, share: 0.8, bonus: 0 });
    const squad = [man('Keeper', ['Por'], 50), man('Centre', ['Dc'], 60)].map(plays);
    expect(draftPitchOf(squad, SHAPES, ['second'])?.module).toBe('second');
    const forwards = [man('Striker', ['Pc'], 80), man('Other', ['A'], 70), man('Back', ['Dc'], 60)].map(plays);
    const pitch = draftPitchOf(forwards, SHAPES, ['second']);
    expect(pitch?.module).toBe('wide');
    expect(pitch?.offPlan).toBe(true);
  });

  it('draws every man of the squad: starters, reserves and whoever fits nowhere', () => {
    const squad = [
      man('Keeper', ['Por'], 50),
      man('Centre A', ['Dc'], 60),
      man('Centre B', ['Dc'], 55),
      man('Centre C', ['Dc'], 40),
      man('Striker', ['Pc'], 70),
      man('Wing', ['W'], 65),
      man('Unknown', ['Dc'], null),
    ];
    const pitch = draftPitchOf(squad, SHAPES, ['first'])!;
    const places = pitch.rows.flatMap((row) => row.places);
    const drawn = places.filter((one) => one.man).length
      + places.reduce((sum, one) => sum + one.reserves.length, 0)
      + pitch.unplaced.length;
    expect(drawn).toBe(squad.length);
    expect(pitch.unplaced.map((one) => one.name)).toEqual(['Wing']);
    // The unpriced man is never a starter: he is a reserve, drawn after the priced ones.
    expect(places.some((one) => one.man?.name === 'Unknown')).toBe(false);
  });

  it('honours a module the operator forced, even when another would field more', () => {
    const forwards = [man('Striker', ['Pc'], 80), man('Other', ['A'], 70)];
    expect(draftPitchOf(forwards, SHAPES, ['first'], 'first')?.module).toBe('first');
  });

  it('answers null without a rulebook', () => {
    expect(draftPitchOf([], null)).toBeNull();
  });
});

describe('spreadReserves', () => {
  it('spreads the reserves of a role EVENLY over its places, best first to the weakest starter', () => {
    const strong = man('Strong', ['Dc'], 90);
    const weak = man('Weak', ['Dc'], 30);
    const places = [place('DC', ['dc'], strong), place('DC', ['dc'], weak)];
    const bench = [man('R1', ['Dc'], 50), man('R2', ['Dc'], 45), man('R3', ['Dc'], 40), man('R4', ['Dc'], 35)];
    const { unplaced } = spreadReserves(places, bench);
    expect(unplaced).toEqual([]);
    expect(places.map((one) => one.reserves.length)).toEqual([2, 2]);
    // The best reserve goes under the weakest starter, where he is likeliest to play.
    expect(places[1].reserves[0].name).toBe('R1');
  });

  it('never puts a man under a place his roles do not fit', () => {
    const places = [place('DC', ['dc'], null), place('A/PC', ['a', 'pc'], null)];
    spreadReserves(places, [man('Striker', ['Pc'], 50), man('Back', ['Dc'], 40)]);
    expect(places[0].reserves.map((one) => one.name)).toEqual(['Back']);
    expect(places[1].reserves.map((one) => one.name)).toEqual(['Striker']);
  });
});

describe('preferring', () => {
  it('moves the preferred modules first and keeps the rest in the rulebook order', () => {
    expect(Object.keys(preferring(SHAPES, ['wide', 'missing']).modules)).toEqual(['wide', 'first', 'second']);
  });
});

describe('flanksOutside', () => {
  const at = (slot: string, roles: string[]): DraftPlace => ({ ...place(slot, roles, null) });

  it('puts the wide places at the two ends and the central ones in the middle (3-5-1-1: M, M, C, E/W, E/W)', () => {
    const row = [at('M', ['m']), at('M', ['m']), at('C', ['c']), at('E/W', ['e', 'w']), at('E/W', ['e', 'w'])];
    expect(flanksOutside(row).map((one) => one.slot)).toEqual(['E/W', 'M', 'M', 'C', 'E/W']);
  });

  it('keeps a sided place on its side: Dd on the left of the drawing, Ds on the right', () => {
    const row = [at('DS', ['ds']), at('DC', ['dc']), at('DD', ['dd']), at('DC', ['dc'])];
    expect(flanksOutside(row).map((one) => one.slot)).toEqual(['DD', 'DC', 'DC', 'DS']);
  });

  it('leaves a line with no wide place as the rulebook wrote it', () => {
    const row = [at('DC', ['dc']), at('DC', ['dc']), at('DC/B', ['dc', 'b'])];
    expect(flanksOutside(row).map((one) => one.slot)).toEqual(['DC', 'DC', 'DC/B']);
  });
});

describe('placeYield, coverage and fertility of a place', () => {
  it('two KEEPERS of one club add up and cap the place at 100%, the cap cutting the last man (01/10/2026)', () => {
    // 80% and 42% of one club, together 122% -> 100% - one shirt (no margin since 01/10/2026: the share is the cover).
    const starter = { ...man('Titolare', ['Por'], 20), share: 0.8, bonus: 0.5 };
    const reserve = { ...man('Riserva', ['Por'], 10), share: 0.42, bonus: 1 };
    expect(placeYield(place('P', ['por'], starter)).cover).toBeCloseTo(0.8, 9);
    expect(placeYield(place('P', ['por'], reserve)).cover).toBeCloseTo(0.42, 9);
    const both = placeYield({ ...place('P', ['por'], starter), reserves: [reserve] });
    expect(both.cover).toBeCloseTo(1, 9);
    // The deputy plays only when the starter does not, whatever his bonus: one club, one shirt.
    expect(both.fertility).toBeCloseTo(0.8 * 0.5 + 0.2 * 1, 9);
  });

  it('combines men of DIFFERENT clubs as independent absences, not as a sum (01/10/2026)', () => {
    // The same 80% + 42% of two clubs: the place is empty only when both miss, 0.20 x 0.58, so 88.4% and not 100%.
    const starter = { ...man('Titolare', ['Dc'], 20), club: 'Uno', share: 0.8, bonus: 0.5 };
    const reserve = { ...man('Riserva', ['Dc'], 10), club: 'Due', share: 0.42, bonus: 0.3 };
    const both = placeYield({ ...place('DC', ['dc'], starter), reserves: [reserve] });
    const r = 0.42;
    expect(both.cover).toBeCloseTo(1 - 0.2 * (1 - r), 9);
    // The reserve scores his bonus only on the matchdays the starter leaves uncovered (his bonus is the lower one, so
    // the regular plays first: `bonusFirst`, 05/10/2026, would field a higher-bonus reserve first on a covered place).
    expect(both.fertility).toBeCloseTo(0.8 * 0.5 + 0.2 * r * 0.3, 9);
    // Two halves of two clubs: 64%, where the sum read 80%.
    const half = (name: string, club: string) => ({ ...man(name, ['Dc'], 10), club, share: 0.5, bonus: 0 });
    expect(combinedCover([half('A', 'Uno'), half('B', 'Due')])).toBeCloseTo(0.75, 9);
    // Two outfield men of ONE club can both start: still independent, not one shirt (operator, 01/10/2026).
    expect(combinedCover([half('A', 'Uno'), half('B', 'Uno')])).toBeCloseTo(0.75, 9);
  });

  it('adds two keepers of one club, capped at one place: a club fields one keeper', () => {
    const keeper = (name: string, club: string) => ({ ...man(name, ['Por'], 10), club, share: 0.5 });
    expect(combinedCover([keeper('A', 'Uno'), keeper('B', 'Uno')])).toBeCloseTo(1, 9);
    expect(combinedCover([keeper('A', 'Uno'), keeper('B', 'Due')])).toBeCloseTo(0.75, 9);
  });

  it('keeps the real club when the label is not one, so two doors stay two clubs', () => {
    const door = (name: string, club: string) => ({ ...man(name, ['Por'], 10), club: 'porta', coverClub: club, share: 0.5 });
    expect(combinedCover([door('A', 'Uno'), door('B', 'Due')])).toBeCloseTo(0.75, 9);
  });

  it('reads an empty place as covering nothing, and an unknown bonus as no fertility', () => {
    expect(placeYield(place('DC', ['dc'], null))).toEqual({ cover: 0, fertility: null });
    const unknown = { ...man('Senza voto base', ['Dc'], 20), share: 0.5, bonus: null };
    expect(placeYield(place('DC', ['dc'], unknown))).toEqual({ cover: 0.5, fertility: null });
  });
});

describe('coverOf, the margin that grows above 80% (operator, 01/10/2026)', () => {
  it('leaves a share up to 80% alone and discounts up to 10% at a full calendar, never reversing the order', () => {
    const at = (share: number) => coverOf({ ...man('X', ['Dc'], 10), share });
    expect(at(0.5)).toBe(0.5);
    expect(at(0.8)).toBeCloseTo(0.8, 9);
    expect(at(0.9)).toBeCloseTo(0.9 * 0.95, 9);
    expect(at(1)).toBeCloseTo(0.9, 9);
    for (let share = 0.8; share < 1; share += 0.01) expect(at(share + 0.01)).toBeGreaterThan(at(share));
  });
});

describe('one man, one place', () => {
  it('never draws a projected man who is already on the pitch, nor twice', () => {
    const held = man('In rosa', ['Dc'], 20);
    const pitch = draftPitchOf([held], SHAPES)!;
    const twice = man('Proiettato', ['Dc'], 15);
    withSuggestions(pitch, [held, twice, twice]);
    const drawn = pitch.rows.flatMap((row) => row.places)
      .flatMap((one) => [one.man, one.suggested, ...one.reserves, one.suggestedReserve])
      .filter((m): m is FantaMan => !!m)
      .map((m) => m.id);
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});

describe('addedYield, what one man adds to the pitch', () => {
  it('as a reserve of another club adds only the matchdays the starter misses', () => {
    const starter = { ...man('Titolare', ['Pc'], 30), club: 'Uno', share: 0.9, bonus: 1 };
    const reserve = { ...man('Riserva', ['Pc'], 20), club: 'Due', share: 0.5, bonus: 0.5 };
    const added = addedYield(draftPitchOf([starter], SHAPES, ['first'])!, reserve);
    expect(added.cover).toBeCloseTo(0.5 * (1 - 0.855), 9);
    expect(added.fertility).toBeCloseTo(0.5 * (1 - 0.855) * 0.5, 9);
  });


  it('adds his share where a place is empty and leaves the pitch untouched', () => {
    const pitch = draftPitchOf([{ ...man('Centrale', ['Dc'], 20), share: 0.9, bonus: 0.2 }], SHAPES, ['first'])!;
    const striker = { ...man('Punta', ['Pc'], 30), share: 0.8, bonus: 1 };
    const added = addedYield(pitch, striker);
    expect(added.cover).toBeCloseTo(0.8, 9);
    expect(added.fertility).toBeCloseTo(0.8, 9);
    expect(pitch.rows.flatMap((row) => row.places).every((one) => !one.suggested && !one.suggestedReserve)).toBe(true);
  });

  it('as a reserve adds the matchdays the starter misses, and a third man adds what the two still leave open', () => {
    const starter = { ...man('Titolare', ['Pc'], 30), share: 0.9, bonus: 1 };
    const reserve = { ...man('Riserva', ['Pc'], 20), share: 0.5, bonus: 0.5 };
    const third = { ...man('Terzo', ['Pc'], 10), share: 0.5, bonus: 0.5 };
    const one = draftPitchOf([starter], SHAPES, ['first'])!;
    expect(addedYield(one, reserve).cover).toBeCloseTo(0.5 * (1 - 0.855), 9); // independent, even of one club
    const two = draftPitchOf([starter, reserve], SHAPES, ['first'], 'first')!;
    expect(addedYield(two, third).cover).toBeCloseTo(0.5 * (1 - 0.855) * (1 - 0.5), 9);
  });

  it('takes the starter place when he is the better starter, and re-weighs the holder as a reserve', () => {
    // Operator, 01/10/2026: the man who is pushed to the bench keeps only the matchdays the new starter leaves open.
    const holder = { ...man('Titolare', ['Pc'], 30), club: 'Uno', share: 0.8, bonus: 0.5 };
    const better = { ...man('Migliore', ['Pc'], 40), club: 'Due', share: 0.8, bonus: 1.5 };
    const pitch = draftPitchOf([holder], SHAPES, ['first'])!;
    const added = addedYield(pitch, better);
    expect(added.cover).toBeCloseTo(0.2 * 0.8, 9);
    // With him: 0.8 x 1.5 + 0.2 x 0.8 x 0.5; without: 0.8 x 0.5.
    expect(added.fertility).toBeCloseTo(0.8 * 1.5 + 0.2 * 0.8 * 0.5 - 0.8 * 0.5, 9);
    expect(pitch.rows.flatMap((row) => row.places).find((one) => one.roles.includes('pc'))!.man).toBe(holder);
  });

  it('draws the better starter on the pitch the same way, the holder below him (plans and pitch aligned)', () => {
    const holder = { ...man('Titolare', ['Pc'], 30), club: 'Uno', share: 0.8, bonus: 0.5 };
    const better = { ...man('Migliore', ['Pc'], 40), club: 'Due', share: 0.8, bonus: 1.5 };
    const pitch = withSuggestions(draftPitchOf([holder], SHAPES, ['first'])!, [better]);
    const front = pitch.rows.flatMap((row) => row.places).find((one) => one.roles.includes('pc'))!;
    expect(front.man).toBe(holder);
    expect(front.suggested).toBe(better);
    expect(placeYield(front, true).fertility).toBeCloseTo(0.8 * 1.5 + 0.2 * 0.8 * 0.5, 9);
    expect(placeYield(front).fertility).toBeCloseTo(0.8 * 0.5, 9); // the real squad alone is untouched
  });

  it('fills an empty place before adding behind a starter, even with a malus', () => {
    const forward = { ...man('Punta', ['Pc'], 30), share: 0.5, bonus: 1 };
    const pitch = draftPitchOf([forward], SHAPES, ['first'])!;
    const both = { ...man('Jolly', ['Dc', 'Pc'], 20), club: 'Altro', share: 0.6, bonus: -0.1 };
    expect(addedYield(pitch, both).cover).toBeCloseTo(0.6, 9); // an empty DC, not 0.6 x 0.5 behind the forward
  });

  it('reads an unknown bonus as an unknown fertility, never as zero', () => {
    const pitch = draftPitchOf([], SHAPES, ['first'])!;
    const blank = { ...man('Senza bonus', ['Pc'], 30), share: 0.7, bonus: null };
    const added = addedYield(pitch, blank);
    expect(added.cover).toBeCloseTo(0.7, 9);
    expect(added.fertility).toBeNull();
  });
});

describe('the classic spread by coverage (01/10/2026)', () => {
  it('sends a reserve to the place where he adds most, not to the one with fewest reserves', () => {
    const strong = { ...man('Forte', ['Dc'], 30), share: 1, bonus: 0 };
    const weak = { ...man('Debole', ['Dc'], 20), share: 0.25, bonus: 0 };
    const first = { ...man('Prima riserva', ['Dc'], 15), share: 0.5, bonus: 0 };
    const second = { ...man('Seconda riserva', ['Dc'], 10), share: 0.5, bonus: 0 };
    const places = [place('DC', ['dc'], strong), place('DC', ['dc'], weak)];
    spreadReserves(places, [first, second], true);
    // Behind the weak starter (25%) both reserves still add; behind the strong one (100%) nothing is left.
    expect(places[1].reserves.map((one) => one.name)).toEqual(['Prima riserva', 'Seconda riserva']);
    expect(places[0].reserves).toEqual([]);
  });

  it('a projected man is drawn where he adds most, even on a place that already has a real reserve', () => {
    const starter = { ...man('Titolare', ['Pc'], 30), share: 0.5, bonus: 1 };
    const reserve = { ...man('Riserva', ['Pc'], 20), share: 0.25, bonus: 1 };
    const pitch = draftPitchOf([starter, reserve], SHAPES, ['first'], 'first')!;
    const third = { ...man('Terzo', ['Pc'], 10), share: 0.5, bonus: 1 };
    expect(addedYield(pitch, third).cover).toBeCloseTo(0.5 * (1 - 0.5) * (1 - 0.25), 9); // what the two leave open
  });
});

describe('who starts: the fertility contribution (01/10/2026)', () => {
  it('starts the man who gives the place more bonus, not the one with the higher value', () => {
    const valued = { ...man('Valore alto', ['Pc'], 90), share: 0.9, bonus: 0.3 };
    const fertile = { ...man('Fertile', ['Pc'], 40), share: 0.7, bonus: 1.2 };
    const pitch = draftPitchOf([valued, fertile], SHAPES, ['first'], 'first')!;
    const front = pitch.rows.flatMap((row) => row.places).find((one) => one.roles.includes('pc'))!;
    expect(front.man?.name).toBe('Fertile');
    expect(front.reserves.map((one) => one.name)).toEqual(['Valore alto']);
    expect(pitch.total).toBe(40); // the header's worth stays in fantapunti
  });

  it('a malus does not empty a place, and a keeper starts on coverage, not on his malus', () => {
    expect(starterWeight({ ...man('Difensore', ['Dc'], 10), share: 0.9, bonus: -0.2 })!).toBeGreaterThan(0);
    const starter = starterWeight({ ...man('Titolare', ['Por'], 30), share: 0.95, bonus: -1.1 })!;
    const deputy = starterWeight({ ...man('Secondo', ['Por'], 10), share: 0.1, bonus: -1.1 })!;
    expect(starter).toBeGreaterThan(deputy);
    const unknown = starterWeight({ ...man('Ignoto', ['Pc'], 50), share: 0.9, bonus: null })!;
    expect(unknown).toBeLessThan(starterWeight({ ...man('Noto', ['Pc'], 5), share: 0.2, bonus: -0.5 })!);
    expect(starterWeight({ ...man('Mai visto', ['Pc'], 50), share: null, bonus: 1 })).toBeNull();
  });

  it('between two first keepers of two clubs, the stronger door starts (05/10/2026, Vicario over Palmisani)', () => {
    const strong = starterWeight({ ...man('Vicario', ['Por'], 65), club: 'Juventus', share: 0.86, bonus: 0.3 })!;
    const weak = starterWeight({ ...man('Palmisani', ['Por'], 22), club: 'Frosinone', share: 0.88, bonus: -0.4 })!;
    expect(strong).toBeGreaterThan(weak);
    // A strong club's deputy still does not start over a first keeper who plays.
    expect(starterWeight({ ...man('Vice', ['Por'], 5), share: 0.1, bonus: 0.6 })!).toBeLessThan(weak);
  });
});

describe('the door week by week (01/10/2026)', () => {
  it('fields each week the keeper with the easier match, so complementary calendars are a bonus', () => {
    const a = { ...man('A', ['Por'], 10), club: 'Uno', share: 0.8, bonus: -1, weeks: [-0.5, -1.5] };
    const b = { ...man('B', ['Por'], 10), club: 'Due', share: 0.8, bonus: -1, weeks: [-1.5, -0.5] };
    const alone = placeYield(place('P', ['por'], a));
    expect(alone.cover).toBeCloseTo(0.8, 9);
    expect(alone.fertility).toBeCloseTo(0.8 * -1 - 0.2 * DOOR_HOLE_COST, 9);
    const pair = placeYield({ ...place('P', ['por'], a), reserves: [b] });
    expect(pair.cover).toBeCloseTo(0.96, 9);
    // Every week the easier match first, the other only when that keeper has no vote: 0.8 x -0.5 + 0.16 x -1.5.
    expect(pair.fertility).toBeCloseTo(0.8 * -0.5 + 0.16 * -1.5 - 0.04 * DOOR_HOLE_COST, 9);
  });

  it('counts a keeper only on the weeks his club plays, and two of one club as one shirt', () => {
    const a = { ...man('A', ['Por'], 10), club: 'Uno', share: 0.8, bonus: -1, weeks: [-1, null] };
    const deputy = { ...man('Vice', ['Por'], 5), club: 'Uno', share: 0.2, bonus: -1, weeks: [-1, null] };
    const one = placeYield({ ...place('P', ['por'], a), reserves: [deputy] });
    expect(one.cover).toBeCloseTo((1 + 0) / 2, 9);
    expect(one.fertility).toBeCloseTo((-1 - DOOR_HOLE_COST) / 2, 9);
  });
});

describe('the price of an uncovered door (01/10/2026)', () => {
  it('counts ONE open door however many keeper places the roster still has (05/10/2026, FA-610-2ih)', () => {
    // Three open places used to read three times the urgency of a door one keeper closes.
    expect(doorHolePrice(3, 21)).toBeCloseTo(DOOR_HOLE_COST / 21, 9);
    expect(doorHolePrice(1, 21)).toBeCloseTo(DOOR_HOLE_COST / 21, 9);
    expect(doorHolePrice(0, 21)).toBe(0);
    expect(doorHolePrice(3, 1)).toBeCloseTo(DOOR_HOLE_COST, 9);
  });
  it('charges DOOR_HOLE_COST for every week nobody covers, so a deputy is worth his cover', () => {
    expect(placeYield(place('P', ['por'], null))).toEqual({ cover: 0, fertility: -DOOR_HOLE_COST });
    const first = { ...man('Titolare', ['Por'], 10), club: 'Uno', share: 0.8, bonus: 0, weeks: [0] };
    const deputy = { ...man('Vice', ['Por'], 1), club: 'Uno', share: 0.2, bonus: 0, weeks: [0] };
    const alone = placeYield(place('P', ['por'], first));
    expect(alone.fertility).toBeCloseTo(-0.2 * DOOR_HOLE_COST, 9);
    const closed = placeYield({ ...place('P', ['por'], first), reserves: [deputy] });
    expect(closed.cover).toBeCloseTo(1, 9);
    expect(closed.fertility).toBeCloseTo(0, 9);
  });
});

describe('once a place is covered, the bonus plays first (05/10/2026, Cambiaso)', () => {
  const regular = () => ({ ...man('Regolare', ['Dc'], 20), share: 0.9, bonus: 0.1 });
  const scorer = () => ({ ...man('Cambiaso', ['Dc'], 20), share: 0.5, bonus: 0.8 });

  it('fields the higher bonus first on a covered place, and that is worth more', () => {
    const [a, b] = [regular(), scorer()];
    expect(bonusFirst([a, b])[0]).toBe(b);
    const covered = placeYield({ ...place('DC', ['dc'], a), reserves: [b] });
    // 0.5 x 0.8 + (0.95 - 0.5) x 0.1: the cover is the pair's either way, the scorer's bonus counts first.
    expect(covered.fertility!).toBeCloseTo(combinedCover([a, b]) * 0.1 + coverOf(b) * (0.8 - 0.1), 9);
    expect(covered.fertility!).toBeGreaterThan(coverOf(a) * 0.1 + (combinedCover([a, b]) - coverOf(a)) * 0.8);
  });

  it('keeps the regular first where the men do not reach a good cover together', () => {
    const a = { ...man('Regolare', ['Dc'], 20), share: 0.5, bonus: 0.1 };
    const b = { ...man('Raro', ['Dc'], 20), share: 0.2, bonus: 0.8 };
    expect(combinedCover([a, b])).toBeLessThan(0.85);
    expect(bonusFirst([a, b])[0]).toBe(a);
  });

  it('draws him as the starter on the pitch, the regular as his reserve', () => {
    const [a, b] = [regular(), scorer()];
    const k = { ...man('Portiere', ['Por'], 10), share: 0.9, bonus: 0 };
    const rules: MantraModules = { slot_roles: { P: ['Por'], DC: ['Dc'] }, modules: { solo: { D: ['DC'], M: [], T: [], A: [] } } };
    const pitch = draftPitchOf([k, a, b], rules)!;
    const dc = pitch.rows.flatMap((row) => row.places).find((one) => one.slot === 'DC')!;
    expect(dc.man?.name).toBe('Cambiaso');
    expect(dc.reserves.map((one) => one.name)).toEqual(['Regolare']);
  });
});
