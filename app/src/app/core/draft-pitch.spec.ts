import { MantraModules } from './auction-value';
import { DraftPlace, addedYield, starterWeight, draftPitchOf, flanksOutside, placeYield, preferring, recommendedModules, spreadReserves, withSuggestions } from './draft-pitch';
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
  it('sums each man x 0.8 and caps the place at 100%, the cap cutting the last man (01/10/2026)', () => {
    // The operator's own example: 38 of 38 gives 80%, 20 of 38 gives 42%, together 122% -> 100%.
    const starter = { ...man('Titolare', ['Dc'], 20), share: 38 / 38, bonus: 0.5 };
    const reserve = { ...man('Riserva', ['Dc'], 10), share: 20 / 38, bonus: 1 };
    expect(placeYield(place('DC', ['dc'], starter)).cover).toBeCloseTo(0.8, 9);
    expect(placeYield(place('DC', ['dc'], reserve)).cover).toBeCloseTo(0.421, 3);
    const both = placeYield({ ...place('DC', ['dc'], starter), reserves: [reserve] });
    expect(both.cover).toBeCloseTo(1, 9);
    expect(both.fertility).toBeCloseTo(0.8 * 0.5 + 0.2 * 1, 9);
  });

  it('reads an empty place as covering nothing, and an unknown bonus as no fertility', () => {
    expect(placeYield(place('DC', ['dc'], null))).toEqual({ cover: 0, fertility: null });
    const unknown = { ...man('Senza voto base', ['Dc'], 20), share: 0.5, bonus: null };
    expect(placeYield(place('DC', ['dc'], unknown))).toEqual({ cover: 0.4, fertility: null });
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
  it('adds his share where a place is empty and leaves the pitch untouched', () => {
    const pitch = draftPitchOf([{ ...man('Centrale', ['Dc'], 20), share: 0.9, bonus: 0.2 }], SHAPES, ['first'])!;
    const striker = { ...man('Punta', ['Pc'], 30), share: 0.8, bonus: 1 };
    const added = addedYield(pitch, striker);
    expect(added.cover).toBeCloseTo(0.64, 9);
    expect(added.fertility).toBeCloseTo(0.64, 9);
    expect(pitch.rows.flatMap((row) => row.places).every((one) => !one.suggested && !one.suggestedReserve)).toBe(true);
  });

  it('as a reserve adds up to the cap, and nothing to a place already at 100%', () => {
    const starter = { ...man('Titolare', ['Pc'], 30), share: 0.9, bonus: 1 };
    const reserve = { ...man('Riserva', ['Pc'], 20), share: 0.5, bonus: 0.5 };
    const third = { ...man('Terzo', ['Pc'], 10), share: 0.5, bonus: 0.5 };
    const one = draftPitchOf([starter], SHAPES, ['first'])!;
    expect(addedYield(one, reserve).cover).toBeCloseTo(1 - 0.72, 9); // 0.72 + 0.40 capped at 1
    const two = draftPitchOf([starter, reserve], SHAPES, ['first'], 'first')!;
    expect(addedYield(two, third)).toEqual({ cover: 0, fertility: 0 });
  });

  it('reads an unknown bonus as an unknown fertility, never as zero', () => {
    const pitch = draftPitchOf([], SHAPES, ['first'])!;
    const blank = { ...man('Senza bonus', ['Pc'], 30), share: 0.7, bonus: null };
    const added = addedYield(pitch, blank);
    expect(added.cover).toBeCloseTo(0.56, 9);
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
    // Behind the weak starter (20%) both reserves still add; behind the strong one (80%) only 20% is left.
    expect(places[1].reserves.map((one) => one.name)).toEqual(['Prima riserva', 'Seconda riserva']);
    expect(places[0].reserves).toEqual([]);
  });

  it('a projected man is drawn where he adds most, even on a place that already has a real reserve', () => {
    const starter = { ...man('Titolare', ['Pc'], 30), share: 0.5, bonus: 1 };
    const reserve = { ...man('Riserva', ['Pc'], 20), share: 0.25, bonus: 1 };
    const pitch = draftPitchOf([starter, reserve], SHAPES, ['first'], 'first')!;
    const third = { ...man('Terzo', ['Pc'], 10), share: 0.5, bonus: 1 };
    expect(addedYield(pitch, third).cover).toBeCloseTo(1 - 0.6, 9); // 0.40 + 0.20 + 0.40 capped
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
});
