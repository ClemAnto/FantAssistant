import { ClubMan, byLine, clubEleven } from './club-eleven';

/** Two shapes that disagree about the back line, so «which module» is a real question here. */
const SHAPES = {
  slot_roles: { P: ['Por'], DC: ['Dc'], DD: ['Dd'], DS: ['Ds'], 'A/PC': ['A', 'Pc'], M: ['M'] },
  modules: {
    'three-at-the-back': { D: ['DC', 'DC'], M: ['M'], T: [], A: ['A/PC'] },
    'four-at-the-back': { D: ['DD', 'DC', 'DS'], M: ['M'], T: [], A: [] },
  },
};

const man = (id: number, roles: string[], pv: number | null, taken = false): ClubMan => ({
  id,
  name: `P${id}`,
  roles,
  pv,
  price: 10 * id,
  taken,
});

describe('clubEleven', () => {
  it('draws the shape whose places the club actually FILLS, not the one it likes', () => {
    // A keeper, two centre-backs, a mediano and a striker: the three-at-the-back shape places all five, the
    // four-at-the-back one has no `dd`/`ds` to put anywhere and leaves two places empty.
    const men = [
      man(1, ['por'], 30), man(2, ['dc'], 28), man(3, ['dc'], 27),
      man(4, ['m'], 26), man(5, ['pc'], 25),
    ];
    const eleven = clubEleven(men, SHAPES)!;
    expect(eleven.module).toBe('three-at-the-back');
    expect(eleven.filled).toBe(5);
    expect(eleven.places.length).toBe(5);
  });

  it('ranks by expected APPEARANCES and not by the price', () => {
    const men = [man(1, ['por'], 30), man(2, ['dc'], 5), man(3, ['dc'], 29)];
    const eleven = clubEleven(men, SHAPES)!;
    const drawn = eleven.places.filter((place) => place.player).map((place) => place.player!.id);
    expect(drawn).toContain(3);          // 29 appearances, price 30
    expect(drawn).toContain(2);          // both `dc` places exist, so the second one is drawn too
  });

  it('does NOT order two identical places by anything: the augmenting path displaces the incumbent', () => {
    // Worth asserting because it is a property of the drawing, not a detail: when a new man is placed, the
    // augmenting search hands him the first matching place and pushes whoever held it onward - so among places
    // of the SAME type the order is an artifact of the walk. The pitch therefore claims a LINE and a place
    // TYPE, never a left/right position; that one is the toolkit board's job (flank pairing, `_reshape`).
    const men = [man(1, ['por'], 30), man(2, ['dc'], 5), man(3, ['dc'], 29)];
    const inLine = clubEleven(men, SHAPES)!.places
      .filter((place) => place.slot === 'DC')
      .map((place) => place.player!.id);
    expect(inLine.sort()).toEqual([2, 3]);
  });

  it('leaves a place EMPTY rather than inventing somebody for it', () => {
    const men = [man(1, ['por'], 30), man(2, ['dc'], 28)];
    const eleven = clubEleven(men, SHAPES)!;
    expect(eleven.filled).toBe(2);
    expect(eleven.places.some((place) => !place.player)).toBe(true);
  });

  it('does not draw a man with no expected appearances, and says how many they are', () => {
    const men = [man(1, ['por'], 30), man(2, ['dc'], null), man(3, ['dc'], null)];
    const eleven = clubEleven(men, SHAPES)!;
    expect(eleven.unpriced).toBe(2);
    expect(eleven.filled).toBe(1);
  });

  it('counts the men already taken, which is what the fading is drawn from', () => {
    const men = [man(1, ['por'], 30, true), man(2, ['dc'], 28), man(3, ['dc'], 27, true)];
    const eleven = clubEleven(men, SHAPES)!;
    expect(eleven.taken).toBe(2);
    expect(eleven.places.find((place) => place.player?.id === 1)!.player!.taken).toBe(true);
  });

  it('reads a HYBRID place: an `a` fills the striker place typed `A/PC`', () => {
    const men = [man(1, ['por'], 30), man(2, ['a'], 28)];
    const eleven = clubEleven(men, SHAPES)!;
    expect(eleven.places.find((place) => place.slot === 'A/PC')!.player!.id).toBe(2);
  });

  it('gives no eleven at all when there are no shapes, and does not guess one', () => {
    expect(clubEleven([man(1, ['por'], 30)], null)).toBeNull();
  });

  it('gives no eleven when nobody of the club has a number', () => {
    expect(clubEleven([man(1, ['por'], null)], SHAPES)).toBeNull();
  });
});

describe('byLine', () => {
  it('draws attack first and the goal last, and skips a line the module does not field', () => {
    const men = [man(1, ['por'], 30), man(2, ['dc'], 28), man(3, ['dc'], 27),
                 man(4, ['m'], 26), man(5, ['pc'], 25)];
    const rows = byLine(clubEleven(men, SHAPES)!);
    expect(rows.map((row) => row.line)).toEqual(['A', 'M', 'D', 'P']);
    expect(rows.at(-1)!.places[0].player!.roles).toContain('por');
  });
});
