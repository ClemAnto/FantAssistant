import { DraftPlace } from './draft-pitch';
import { FantaMan } from './fanta-eleven';
import { fantaManOf, keeperZeroOf, placePoints, placeTargets } from './scout-pitch';
import { ScoutMan } from './scout';

function scout(id: number, role: string, fm: number | null, pv: number | null, club = `c${id}`): ScoutMan {
  return { id, name: `m${id}`, club, role: role.toUpperCase() as ScoutMan['role'], roles: [role], shown: [role.toUpperCase()], fm, pv, fvm: id };
}

function place(roles: string[], man: FantaMan | null, reserves: FantaMan[] = []): DraftPlace {
  return { line: 'A', slot: roles[0].toUpperCase(), roles, man, badge: null, reserves };
}

describe('scout-pitch', () => {
  it('reads an outfield bonus above 6 and a keeper above the average starting keeper', () => {
    const a = fantaManOf(scout(1, 'a', 7.2, 19, 'x'), 38, 5);
    expect(a.share).toBeCloseTo(0.5);
    expect(a.bonus).toBeCloseTo(1.2);
    const p = fantaManOf(scout(2, 'p', 5.4, 38), 38, 5);
    expect(p.share).toBe(1);
    expect(p.bonus).toBeCloseTo(0.4);
  });

  it('takes the keeper with the most appearances of each club as its starter', () => {
    const zero = keeperZeroOf([
      { club: 'x', fm: 5.5, pv: 30 },
      { club: 'x', fm: 3, pv: 2 },
      { club: 'y', fm: 4.5, pv: 35 },
    ]);
    expect(zero).toBeCloseTo(5);
  });

  it('lists the men who raise a place, best first, and not the ones who lower it', () => {
    const holder = fantaManOf(scout(1, 'a', 6.5, 19), 38, 5);
    const at = place(['a'], holder);
    const strong = fantaManOf(scout(10, 'a', 8, 34), 38, 5);
    const weak = fantaManOf(scout(11, 'a', 5, 5), 38, 5);
    const keeper = fantaManOf(scout(12, 'p', 6, 38), 38, 5);
    const out = placeTargets(at, [{ name: 'R', men: [weak, strong, keeper], standing: new Map([[10, 'titolare' as const]]) }], 5);
    expect(out.map((one) => one.man.id)).toContain(10);
    expect(out[0].man.id).toBe(10);
    expect(out[0].ours).toBe('titolare');
    expect(out[0].theirs).toBe('titolare');
    expect(out.some((one) => one.man.id === 12)).toBe(false);
    for (const one of out) expect(one.points).toBeGreaterThan(0);
  });

  it('fills an empty place with whoever covers it', () => {
    const empty = place(['d'], null);
    expect(placePoints(empty, 5)).toBe(0);
    const out = placeTargets(empty, [{ name: 'R', men: [fantaManOf(scout(3, 'd', 6, 19), 38, 5)], standing: new Map() }], 5);
    expect(out[0].cover).toBeCloseTo(0.5);
    expect(out[0].points).toBeCloseTo(3);
  });
});
