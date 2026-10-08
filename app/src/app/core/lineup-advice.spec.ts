import { describe, expect, it } from 'vitest';

import { MantraModules } from './auction-value';
import { BenchRule } from './leghe-rules';
import {
  LineupMan,
  VOTE_IF_UNLISTED,
  adviseLineup,
  allowedRules,
  benchOf,
  drawSent,
  rulebookName,
  toTheFlanks,
  voteChance,
} from './lineup-advice';

const CLASSIC: MantraModules = {
  slot_roles: { P: ['P'], D: ['D'], C: ['C'], A: ['A'] },
  modules: {
    '3-4-3': { D: ['D', 'D', 'D'], M: ['C', 'C', 'C', 'C'], A: ['A', 'A', 'A'] },
    '4-4-2': { D: ['D', 'D', 'D', 'D'], M: ['C', 'C', 'C', 'C'], A: ['A', 'A'] },
  },
};

let next = 1;
function man(role: string, points: number | null, chance = 1): LineupMan {
  const id = next++;
  return {
    id,
    name: `${role}${id}`,
    roles: [role.toLowerCase()],
    shown: [role],
    chance,
    fm: points === null ? null : points / chance,
    points,
  };
}

const FREE_BENCH: BenchRule = { size: null, fixed: false, perRole: [], sequence: null };

describe('voteChance', () => {
  it('reads the measured curve and stays flat beyond its ends', () => {
    expect(voteChance(5, null)).toBeCloseTo(0.013);
    expect(voteChance(93, null)).toBeCloseTo(0.952);
    expect(voteChance(100, null)).toBeCloseTo(0.952);
    expect(voteChance(0, null)).toBeCloseTo(0.013);
    const mid = voteChance(57.5, null);
    expect(mid).toBeGreaterThan(0.643);
    expect(mid).toBeLessThan(0.713);
  });

  it('is zero for a man Leghe flags out, and the measured share for one the page does not list', () => {
    expect(voteChance(90, 'suspended')).toBe(0);
    expect(voteChance(null, null)).toBe(VOTE_IF_UNLISTED);
  });
});

describe('module names', () => {
  it('turns Leghe codes into rulebook names and keeps only the allowed modules', () => {
    expect(rulebookName('4231')).toBe('4-2-3-1');
    expect(Object.keys(allowedRules(CLASSIC, ['442']).modules)).toEqual(['4-4-2']);
    // Nothing readable allowed = the whole rulebook, never «no module is legal».
    expect(Object.keys(allowedRules(CLASSIC, []).modules)).toEqual(['3-4-3', '4-4-2']);
  });
});

describe('adviseLineup', () => {
  it('fields the best eleven on an allowed module and benches the rest by role', () => {
    const squad = [
      man('P', 4),
      man('P', 1),
      ...[6, 5, 5, 5, 2].map((p) => man('D', p)),
      ...[6, 6, 5, 5, 1].map((p) => man('C', p)),
      ...[7, 7, 7, 1].map((p) => man('A', p)),
    ];
    const plan = adviseLineup(squad, CLASSIC, ['343', '442'], FREE_BENCH, 'classic')!;
    expect(plan.module).toBe('3-4-3');
    expect(plan.placed).toBe(11);
    expect(plan.total).toBeCloseTo(4 + 6 + 5 + 5 + 6 + 6 + 5 + 5 + 7 + 7 + 7);
    expect(plan.bench.map((m) => m.shown[0])).toEqual(['P', 'D', 'D', 'C', 'A']);
  });

  it('never fields a man nobody can price, and does not drop him either', () => {
    const squad = [man('P', 4), man('D', null), man('D', 5)];
    const plan = adviseLineup(squad, CLASSIC, [], FREE_BENCH, 'classic')!;
    const onPitch = plan.rows.flatMap((r) => r.places).filter((p) => p.man).map((p) => p.man!.id);
    expect(onPitch).not.toContain(squad[1].id);
    expect(plan.bench.map((m) => m.id)).toContain(squad[1].id);
  });
});

describe('benchOf', () => {
  it('honours a fixed classic bench by role and leaves the rest outside', () => {
    const rest = [man('P', 1), man('P', 0.5), man('D', 3), man('D', 2), man('C', 4), man('A', 1)];
    const rule: BenchRule = { size: 4, fixed: true, perRole: [1, 1, 1, 1], sequence: null };
    const { bench, outside } = benchOf(rest, rule, 'classic');
    expect(bench.map((m) => m.shown[0])).toEqual(['P', 'D', 'C', 'A']);
    expect(bench[1].points).toBe(3);
    expect(outside).toHaveLength(2);
  });

  it('caps a variable bench at its size, best first', () => {
    const rest = [man('D', 1), man('C', 3), man('A', 2)];
    const rule: BenchRule = { size: 2, fixed: false, perRole: [], sequence: null };
    expect(benchOf(rest, rule, 'mantra').bench.map((m) => m.points)).toEqual([3, 2]);
  });
});

describe('drawSent', () => {
  it('draws the lineup sent on its own module, bench in the order it was written', () => {
    const keeper = man('P', 4);
    const defs = [man('D', 5), man('D', 5), man('D', 5), man('D', 5)];
    const mids = [man('C', 5), man('C', 5), man('C', 5), man('C', 5)];
    const atts = [man('A', 5), man('A', 5)];
    const subA = man('A', 1);
    const subD = man('D', 2);
    const all = [keeper, ...defs, ...mids, ...atts, subA, subD];
    const plan = drawSent(all, CLASSIC, {
      module: '442',
      starts: [keeper, ...defs, ...mids, ...atts].map((m) => m.id),
      bench: [subA.id, subD.id],
    })!;
    expect(plan.module).toBe('4-4-2');
    expect(plan.placed).toBe(11);
    expect(plan.bench.map((m) => m.id)).toEqual([subA.id, subD.id]);
  });
});

describe('toTheFlanks', () => {
  const row = (...slots: string[]) => slots.map((slot) => ({ line: 'T' as const, slot, man: null }));
  const slots = (places: { slot: string }[]) => places.map((p) => p.slot);

  it('sends the wide places of a 4-1-4-1 to the two touchlines', () => {
    expect(slots(toTheFlanks(row('C/T', 'T', 'E/W', 'W')))).toEqual(['E/W', 'C/T', 'T', 'W']);
  });

  it('leaves sided and all-central lines as the rulebook writes them', () => {
    expect(slots(toTheFlanks(row('DD', 'DC', 'DC', 'DS')))).toEqual(['DD', 'DC', 'DC', 'DS']);
    expect(slots(toTheFlanks(row('E', 'M', 'C', 'E')))).toEqual(['E', 'M', 'C', 'E']);
  });
});
