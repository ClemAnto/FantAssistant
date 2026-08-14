import { MantraModules } from './auction-value';
import { FantaMan, fantaElevenOf } from './fanta-eleven';
import { bestEleven, bestElevenWorth, placesIn, placesOf } from './mantra-legal';

/**
 * Two shapes, cut to the bone, and they differ exactly where the choice has to show: one fields three
 * defenders and one forward, the other two defenders and two forwards.
 */
const SHAPES: MantraModules = {
  slot_roles: { P: ['Por'], DC: ['Dc'], 'DC/B': ['Dc', 'B'], 'A/PC': ['A', 'Pc'] },
  modules: {
    'three-at-the-back': { D: ['DC', 'DC', 'DC/B'], M: [], T: [], A: ['A/PC'] },
    'two-and-two': { D: ['DC', 'DC'], M: [], T: [], A: ['A/PC', 'A/PC'] },
  },
};

/** The classic rulebook's own shape: a place is a macro-role and accepts itself, nothing finer. */
const CLASSIC: MantraModules = {
  slot_roles: { P: ['P'], D: ['D'], C: ['C'], A: ['A'] },
  modules: { '2-1-1': { D: ['D', 'D'], M: ['C'], T: [], A: ['A'] } },
};

let next = 1;
const man = (name: string, roles: string[], value: number | null): FantaMan => ({
  id: next++,
  name,
  club: 'Club',
  shown: roles,
  roles: roles.map((role) => role.toLowerCase()),
  value: value,
  value99: value == null ? null : Math.round(value),
  cost: 10,
  minutesPerMatch: 70,
});

describe('placesIn', () => {
  it('carries the keeper, the line of every place and the rulebook order', () => {
    const places = placesIn(SHAPES, 'three-at-the-back');
    expect(places.map((place) => place.line)).toEqual(['P', 'D', 'D', 'D', 'A']);
    expect(places.map((place) => place.slot)).toEqual(['P', 'DC', 'DC', 'DC/B', 'A/PC']);
    expect(places[3].roles).toEqual(['dc', 'b']);
  });

  it('is the one definition the bare matching walks', () => {
    for (const name of Object.keys(SHAPES.modules)) {
      expect(placesOf(SHAPES, name)).toEqual(placesIn(SHAPES, name).map((place) => place.roles));
    }
  });
});

describe('bestEleven', () => {
  it('picks the module that fields the strongest men, not the one that fills most places', () => {
    const squad = [
      man('Por', ['Por'], 5),
      man('Dc1', ['Dc'], 4),
      man('Dc2', ['Dc'], 4),
      man('Bomber', ['Pc'], 40),
      man('Punta', ['A'], 30),
    ];
    const best = bestEleven(squad, SHAPES, (who) => who.value)!;
    // Three at the back could place one more man (a third defender does not exist here, so it would field
    // four); two-and-two fields both forwards and is worth 83 against 53.
    expect(best.module).toBe('two-and-two');
    expect(best.total).toBe(83);
    expect(best.men.map((who) => who.name).sort()).toEqual(['Bomber', 'Dc1', 'Dc2', 'Por', 'Punta']);
    expect(best.scores[0].module).toBe('two-and-two');
  });

  it('leaves a place empty rather than fielding a man nobody priced', () => {
    const squad = [man('Por', ['Por'], 5), man('Ignoto', ['Dc'], null)];
    const best = bestEleven(squad, SHAPES, (who) => who.value)!;
    expect(best.men.map((who) => who.name)).toEqual(['Por']);
    expect(best.holders.filter(Boolean).length).toBe(1);
  });

  it('agrees with the worth the denial note reads', () => {
    const squad = [man('Por', ['Por'], 5), man('Dc', ['Dc'], 4), man('Pc', ['Pc'], 9)];
    expect(bestElevenWorth(squad, SHAPES, (who) => who.value)).toBe(
      bestEleven(squad, SHAPES, (who) => who.value)!.total,
    );
  });

  it('has no eleven at all without a rulebook', () => {
    expect(bestEleven([man('Por', ['Por'], 5)], null, (who) => who.value)).toBeNull();
    expect(bestElevenWorth([man('Por', ['Por'], 5)], null, (who) => who.value)).toBe(0);
  });
});

describe('fantaElevenOf', () => {
  it('draws the keeper first and the attack last, and names the role each place is filled with', () => {
    const squad = [
      man('Por', ['Por'], 5),
      man('Dc1', ['Dc'], 4),
      man('Dc2', ['Dc'], 4),
      man('Bomber', ['Pc'], 40),
      man('Punta', ['A'], 30),
    ];
    const drawn = fantaElevenOf(squad, SHAPES)!;
    expect(drawn.rows.map((row) => row.line)).toEqual(['P', 'D', 'A']);
    expect(drawn.rows[0].places[0].man!.name).toBe('Por');
    expect(drawn.rows[0].places[0].badge).toBe('Por');
    expect(drawn.placed).toBe(5);
  });

  it('offers as ballottaggio the strongest bench man THAT place would accept', () => {
    const squad = [
      man('Por', ['Por'], 5),
      man('Dc1', ['Dc'], 9),
      man('Dc2', ['Dc'], 8),
      man('Dc3', ['Dc'], 7),
      man('Riserva', ['Dc'], 6.5),
      man('Braccetto', ['B'], 6),
      man('Bomber', ['Pc'], 40),
    ];
    const drawn = fantaElevenOf(squad, SHAPES)!;
    // One forward only, so the shape with three defensive places is the strongest: 69 against 62.
    expect(drawn.module).toBe('three-at-the-back');
    const defence = drawn.rows.find((row) => row.line === 'D')!;
    // The two pure `DC` places take the best bench `Dc`; the hybrid one accepts the `B` too, and still
    // prefers the stronger man. The same rival on two places is what «first alternative there» means.
    expect(defence.places.map((place) => place.rival?.name)).toEqual(['Riserva', 'Riserva', 'Riserva']);
    // The keeper has no second keeper behind him: unknown is not a rival, so the place says nothing.
    expect(drawn.rows[0].places[0].rival).toBeNull();
    expect(drawn.bench.map((who) => who.name)).toEqual(['Riserva', 'Braccetto']);
  });

  it('says which men have no number instead of counting them as zero', () => {
    const squad = [man('Por', ['Por'], 5), man('Ignoto', ['Dc'], null)];
    const drawn = fantaElevenOf(squad, SHAPES)!;
    expect(drawn.unpriced.map((who) => who.name)).toEqual(['Ignoto']);
    expect(drawn.bench).toEqual([]);
    expect(drawn.placed).toBe(1);
    // The other four places of the shape are still drawn, empty: what is missing is the information.
    expect(drawn.rows.flatMap((row) => row.places).filter((place) => !place.man).length).toBe(4);
  });

  it('draws a classic squad on macro-roles', () => {
    const squad = [
      man('Por', ['P'], 5),
      man('Dif1', ['D'], 4),
      man('Dif2', ['D'], 4),
      man('Cen', ['C'], 6),
      man('Att', ['A'], 9),
    ];
    const drawn = fantaElevenOf(squad, CLASSIC)!;
    expect(drawn.module).toBe('2-1-1');
    // Sorted, because two places that accept the same role are interchangeable: which of the two equal
    // defenders the matching leaves on which is an augmenting path's business, and nothing the eye reads.
    expect(drawn.rows.map((row) => row.places.map((place) => place.man?.name).sort())).toEqual([
      ['Por'],
      ['Dif1', 'Dif2'],
      ['Cen'],
      ['Att'],
    ]);
    expect(drawn.rows.map((row) => row.line)).toEqual(['P', 'D', 'M', 'A']);
  });

  it('has nothing to draw without a rulebook, and says so with a null', () => {
    expect(fantaElevenOf([man('Por', ['Por'], 5)], null)).toBeNull();
  });
});
