import { describe, expect, it } from 'vitest';

import { MantraModules } from './auction-value';
import { BenchRule } from './leghe-rules';
import {
  LineupMan,
  MIN_CHANCE_ON_PITCH,
  Starter,
  VOTE_IF_UNLISTED,
  adviseLineup,
  allowedRules,
  benchOf,
  canCover,
  classicCounts,
  drawSent,
  earnsDefence,
  fieldWeight,
  readByDefence,
  rulebookName,
  toTheFlanks,
  voteChance,
  withLeagueModules,
} from './lineup-advice';
import { placesIn } from './mantra-legal';
import { STEADY_SHARE, steadyShareFor } from './swing';

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

  it('a classic module is its three numbers: one the rulebook does not write is built, never dropped', () => {
    expect(classicCounts('424')).toEqual([4, 2, 4]);
    expect(classicCounts('4-2-4')).toEqual([4, 2, 4]);
    expect(classicCounts('4231')).toBeNull(); // a Mantra name
    expect(classicCounts('442x')).toBeNull();
    expect(classicCounts('441')).toBeNull(); // nine outfield men
    // Leghe lets a classic league allow 4-2-4: until 09/10/2026 it vanished, and a league allowing only unknown
    // modules was advised the whole rulebook.
    const book = withLeagueModules(CLASSIC, ['442', '424'], 'classic');
    expect(book.modules['4-2-4']).toEqual({ D: ['D', 'D', 'D', 'D'], M: ['C', 'C'], T: [], A: ['A', 'A', 'A', 'A'] });
    expect(Object.keys(allowedRules(book, ['424']).modules)).toEqual(['4-2-4']);
    expect(withLeagueModules(CLASSIC, ['424'], 'mantra')).toBe(CLASSIC);
    const squad = [man('P', 6), ...[6, 6, 6, 6].map((p) => man('D', p)), man('C', 6), man('C', 6), ...[7, 7, 7, 7].map((p) => man('A', p))];
    const plan = adviseLineup(squad, CLASSIC, ['424'], FREE_BENCH, 'classic')!;
    expect(plan.module).toBe('4-2-4');
    expect(plan.placed).toBe(11);
  });
});

describe('adviseLineup', () => {
  const squad343 = () => [
    man('P', 4),
    man('P', 1),
    ...[6, 5, 5, 5, 2].map((p) => man('D', p)),
    ...[6, 6, 5, 5, 1].map((p) => man('C', p)),
    ...[7, 7, 7, 1].map((p) => man('A', p)),
  ];

  it('fields the best eleven on an allowed module and, under Traditional, benches the rest by role', () => {
    const plan = adviseLineup(squad343(), CLASSIC, ['343', '442'], FREE_BENCH, 'classic', {
      kind: 'traditional',
      modules: ['343', '442'],
    })!;
    expect(plan.module).toBe('3-4-3');
    expect(plan.placed).toBe(11);
    expect(plan.total).toBeCloseTo(4 + 6 + 5 + 5 + 6 + 6 + 5 + 5 + 7 + 7 + 7);
    expect(plan.bench.map((m) => m.shown[0])).toEqual(['P', 'D', 'D', 'C', 'A']);
  });

  it('classic Dynamic and Hybrid: the bench is ONE queue by FVA, the role does not group it', () => {
    // Leghe's classic engine walks the bench in order whatever the role (`ApplySubstitutionsClassic`, phase 2):
    // written by role, the best defender would come on for a missing striker before the forward behind him.
    for (const kind of ['dynamic', 'hybrid', null] as const) {
      const plan = adviseLineup(squad343(), CLASSIC, ['343', '442'], FREE_BENCH, 'classic', {
        kind,
        modules: ['343', '442'],
      })!;
      const points = plan.bench.map((m) => m.points!);
      expect(points).toEqual([...points].sort((a, b) => b - a));
      expect(plan.bench[0].shown[0]).toBe('D');
    }
  });

  it('never fields a man under 15% of a vote, however good his FVA, and keeps him on the bench', () => {
    // Operator, 09/10/2026: «togliamo dal campo i giocatori < 15% come Lienard» (a third keeper at 1%, FVA 5.2).
    const lienard = man('P', 5.2, 0.01);
    const regular = man('P', 4.8, 0.9);
    const plan = adviseLineup([lienard, regular, man('D', 5)], CLASSIC, [], FREE_BENCH, 'classic')!;
    const onPitch = plan.rows.flatMap((r) => r.places).filter((p) => p.man).map((p) => p.man!.id);
    expect(onPitch).toContain(regular.id);
    expect(onPitch).not.toContain(lienard.id);
    expect(plan.bench.map((m) => m.id)).toContain(lienard.id);
    // The floor itself, both sides of it.
    expect(fieldWeight(man('A', 7, MIN_CHANCE_ON_PITCH))).toBe(7);
    expect(fieldWeight(man('A', 7, MIN_CHANCE_ON_PITCH - 0.001))).toBeNull();
  });

  it('never fields a man nobody can price, and does not drop him either', () => {
    const squad = [man('P', 4), man('D', null), man('D', 5)];
    const plan = adviseLineup(squad, CLASSIC, [], FREE_BENCH, 'classic')!;
    const onPitch = plan.rows.flatMap((r) => r.places).filter((p) => p.man).map((p) => p.man!.id);
    expect(onPitch).not.toContain(squad[1].id);
    expect(plan.bench.map((m) => m.id)).toContain(squad[1].id);
  });
});

describe('the bench covers every starter (no holes)', () => {
  // Operator, 09/10/2026: «la panchina deve essere impostata in maniera da essere CERTI che non ci siano buchi nel
  // caso ci sia qualche infortunio all'ultimo».
  const squad = () => [
    man('P', 6),
    ...[6, 6, 6].map((p) => man('D', p)),
    ...[6, 6, 6, 6].map((p) => man('C', p)),
    ...[7, 7, 7].map((p) => man('A', p)),
  ];

  it('classic: a keeper who plays and one cover per department come before the best FVA', () => {
    const eleven = squad().map((m) => (m.shown[0] === 'A' ? { ...m, points: 10 } : m));
    const thirdKeeper = man('P', 5.5, 0.01); // the Lienard case: no cover, he will not play
    const secondKeeper = man('P', 4, 0.9);
    const subD = man('D', 3, 0.8);
    const subC = man('C', 3, 0.8);
    const flashy = [man('A', 9, 0.9), man('A', 8.5, 0.9), man('A', 8, 0.9)]; // the best FVA of the rest, all forwards
    const bench: BenchRule = { size: 4, fixed: false, perRole: [], sequence: null };
    const plan = adviseLineup([...eleven, thirdKeeper, secondKeeper, subD, subC, ...flashy], CLASSIC, ['343'], bench, 'classic')!;
    // by FVA alone the bench would be three forwards and the third keeper: one injured defender = a hole
    expect(plan.bench.map((m) => m.shown[0]).sort()).toEqual(['A', 'C', 'D', 'P']);
    expect(plan.bench.map((m) => m.id)).toContain(secondKeeper.id);
    expect(plan.bench.map((m) => m.id)).not.toContain(thirdKeeper.id);
    expect(plan.cover?.covered).toBe(4);
    expect(plan.cover?.starters).toBe(11);
  });

  it('a big enough bench covers all eleven, each with his own man', () => {
    const eleven = squad();
    const subs = [man('P', 4, 0.9), ...Array.from({ length: 3 }, () => man('D', 3, 0.7)),
      ...Array.from({ length: 4 }, () => man('C', 3, 0.7)), ...Array.from({ length: 3 }, () => man('A', 3, 0.7))];
    const plan = adviseLineup([...eleven, ...subs], CLASSIC, ['343'], FREE_BENCH, 'classic')!;
    expect(plan.cover?.covered).toBe(11);
    expect(plan.cover?.open).toEqual([]);
  });

  it('classic: a module change lets another role cover, as far as the league modules allow and no further', () => {
    // A 4-4-2 with no defender on the bench and six midfielders behind it. Traditional: the four defenders are
    // open. Dynamic with the 3-5-2 allowed: ONE midfielder can cover a defender (4-4-2 -> 3-5-2), not two, because
    // 2-6-2 is no module - the promise holds even if both drop out at once.
    const rules: MantraModules = { ...CLASSIC, modules: { ...CLASSIC.modules, '3-5-2': { D: ['D', 'D', 'D'], M: ['C', 'C', 'C', 'C', 'C'], A: ['A', 'A'] } } };
    const eleven = [man('P', 6), ...[6, 6, 6, 6].map((p) => man('D', p)), ...[6, 6, 6, 6].map((p) => man('C', p)), man('A', 8), man('A', 8)];
    const subs = [man('P', 4, 0.9), ...Array.from({ length: 6 }, () => man('C', 3, 0.8)), man('A', 3, 0.8), man('A', 3, 0.8)];
    const cover = (kind: 'dynamic' | 'traditional', modules: string[]) =>
      adviseLineup([...eleven, ...subs], rules, ['442'], FREE_BENCH, 'classic', { kind, modules })!.cover!;
    expect(cover('traditional', ['442', '352']).covered).toBe(7);
    expect(cover('dynamic', ['442', '352']).covered).toBe(8);
    expect(cover('dynamic', ['442', '352']).open.filter((name) => name.startsWith('D'))).toHaveLength(3);
    // Without the 3-5-2 among the league's modules, no change can land anywhere.
    expect(cover('dynamic', ['442']).covered).toBe(7);
  });

  it('classic canCover: same role always, another role only through an allowed module, a keeper only by a keeper', () => {
    const starterOf = (role: string): Starter => ({
      place: { line: role === 'P' ? 'P' : role === 'D' ? 'D' : role === 'C' ? 'M' : 'A', slot: role, roles: [role.toLowerCase()] },
      man: man(role, 6),
    });
    const dynamic = { kind: 'dynamic' as const, modules: ['442', '352'] };
    expect(canCover(man('D', 3), starterOf('D'), 'classic', CLASSIC, '4-4-2')).toBe(true);
    expect(canCover(man('C', 3), starterOf('D'), 'classic', CLASSIC, '4-4-2', dynamic)).toBe(true);
    expect(canCover(man('C', 3), starterOf('D'), 'classic', CLASSIC, '4-4-2', { kind: 'traditional', modules: ['442', '352'] })).toBe(false);
    expect(canCover(man('C', 3), starterOf('D'), 'classic', CLASSIC, '4-4-2', { kind: null, modules: ['442', '352'] })).toBe(false);
    expect(canCover(man('A', 3), starterOf('D'), 'classic', CLASSIC, '4-4-2', dynamic)).toBe(false); // 3-4-3 not allowed
    expect(canCover(man('D', 3), starterOf('P'), 'classic', CLASSIC, '4-4-2', dynamic)).toBe(false);
  });

  it('mantra: the official matrix decides who can replace whom, malus included', () => {
    const rules: MantraModules = {
      slot_roles: { P: ['Por'], DC: ['Dc'], 'A/PC': ['A', 'Pc'] },
      modules: { mini: { D: ['DC'], A: ['A/PC'] } },
      substitution: { matrix: { Dc: { B: '**', Pc: 'NO', Dc: 'OK' }, Pc: { B: '-1', Pc: 'OK' }, Por: { Por: 'OK' } } },
    };
    const keeper = { ...man('Por', 6), roles: ['por'] };
    const dc = { ...man('Dc', 6), roles: ['dc'] };
    const pc = { ...man('Pc', 9), roles: ['pc'] };
    const braccetto = { ...man('B', 3, 0.8), roles: ['b'] }; // covers the Dc (**) and the Pc (-1)
    const striker = { ...man('Pc', 8, 0.9), roles: ['pc'] }; // covers the Pc only: a Pc may not replace a Dc
    const backup = { ...man('Por', 4, 0.9), roles: ['por'] };
    const plan = adviseLineup([keeper, dc, pc, braccetto, striker, backup], rules, [], { size: 3, fixed: false, perRole: [], sequence: null }, 'mantra')!;
    expect(plan.cover).toEqual({ starters: 3, covered: 3, open: [] });
    expect(new Set(plan.bench.map((m) => m.id))).toEqual(new Set([backup.id, braccetto.id, striker.id]));
    const one = adviseLineup([keeper, dc, pc, braccetto, striker, backup], rules, [], { size: 2, fixed: false, perRole: [], sequence: null }, 'mantra')!;
    // two places: the keeper's and the defender's covers, because the striker can only stand in for the Pc
    expect(new Set(one.bench.map((m) => m.id))).toEqual(new Set([backup.id, braccetto.id]));
  });
});

describe('benchOf', () => {
  it('honours a fixed classic bench by role and leaves the rest outside', () => {
    const rest = [man('P', 1), man('P', 0.5), man('D', 3), man('D', 2), man('C', 4), man('A', 1)];
    const rule: BenchRule = { size: 4, fixed: true, perRole: [1, 1, 1, 1], sequence: null };
    const { bench, outside } = benchOf(rest, rule, 'classic', [], 'traditional');
    expect(bench.map((m) => m.shown[0])).toEqual(['P', 'D', 'C', 'A']);
    expect(bench[1].points).toBe(3);
    expect(outside).toHaveLength(2);
  });

  it('a fixed classic bench reads a zero quota as «any number», not as «none»', () => {
    // Leghe's settings: «se fixbench è true 0 vuol dire ruolo variabile». Until 09/10/2026 [1,1,0,0] on four
    // places stopped at two men.
    const rest = [man('P', 1), man('P', 0.5), man('D', 3), man('D', 2.5), man('C', 4), man('A', 2)];
    const rule: BenchRule = { size: 4, fixed: true, perRole: [1, 1, 0, 0], sequence: null };
    const { bench, outside } = benchOf(rest, rule, 'classic', [], 'traditional');
    expect(bench.map((m) => m.shown[0])).toEqual(['P', 'D', 'C', 'A']);
    expect(outside.map((m) => m.shown[0]).sort()).toEqual(['D', 'P']);
  });

  it('a fixed role per slot (bseq) fills each slot with its role, in slot order', () => {
    const rest = [man('A', 9), man('P', 1), man('D', 3), man('D', 2), man('C', 4)];
    const rule: BenchRule = { size: 12, fixed: true, perRole: [0, 0, 0, 0], sequence: [1, 2, 2, 3, 4] };
    const { bench } = benchOf(rest, rule, 'classic', [], 'dynamic');
    expect(bench.map((m) => `${m.shown[0]}${m.points}`)).toEqual(['P1', 'D3', 'D2', 'C4', 'A9']);
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
  const row = (...slots: string[]) => slots.map((slot, at) => ({ line: 'T' as const, slot, man: null, at }));
  const slots = (places: { slot: string }[]) => places.map((p) => p.slot);

  it('sends the wide places of a 4-1-4-1 to the two touchlines', () => {
    expect(slots(toTheFlanks(row('C/T', 'T', 'E/W', 'W')))).toEqual(['E/W', 'C/T', 'T', 'W']);
  });

  it('leaves sided and all-central lines as the rulebook writes them', () => {
    expect(slots(toTheFlanks(row('DD', 'DC', 'DC', 'DS')))).toEqual(['DD', 'DC', 'DC', 'DS']);
    expect(slots(toTheFlanks(row('E', 'M', 'C', 'E')))).toEqual(['E', 'M', 'C', 'E']);
    expect(slots(toTheFlanks(row('T/A/PC', 'A/PC')))).toEqual(['T/A/PC', 'A/PC']);
  });

  it('puts a W on the touchlines even when it shares the slot, and the Pc in the middle', () => {
    // The 3-4-3 and the 4-3-3 write their front three `W/A, W/A, A/PC` (operator, 09/10/2026: «le W devono
    // stare ai lati, la Pc al centro»).
    expect(slots(toTheFlanks(row('W/A', 'W/A', 'A/PC')))).toEqual(['W/A', 'A/PC', 'W/A']);
    expect(slots(toTheFlanks(row('W/T', 'T', 'W/A')))).toEqual(['W/T', 'T', 'W/A']);
    expect(slots(toTheFlanks(row('M', 'M/C', 'E', 'E/W')))).toEqual(['E', 'M', 'M/C', 'E/W']);
  });
});

describe('the modifiers pay steadiness (operator, 09/10/2026)', () => {
  it('the weight is the operator’s STEADY_SHARE with the league’s own size: 2/11 at two points', () => {
    expect(steadyShareFor(2)).toBeCloseTo(STEADY_SHARE);
    expect(steadyShareFor(3)).toBeCloseTo(3 / 11);
  });

  it('classic earns the defence modifier only with four defenders; Mantra with every scheme', () => {
    expect(earnsDefence(placesIn(CLASSIC, '4-4-2'), 'classic')).toBe(true);
    expect(earnsDefence(placesIn(CLASSIC, '3-4-3'), 'classic')).toBe(false);
    expect(earnsDefence(placesIn(CLASSIC, '3-4-3'), 'mantra')).toBe(true);
  });

  it('reads the men Leghe’s engine reads: defenders, Mantra’s defensive roles, the keeper only when counted', () => {
    expect(readByDefence(['d'], 'classic', false)).toBe(true);
    expect(readByDefence(['c'], 'classic', false)).toBe(false);
    expect(readByDefence(['p'], 'classic', false)).toBe(false);
    expect(readByDefence(['p'], 'classic', true)).toBe(true);
    expect(readByDefence(['m', 'c'], 'mantra', false)).toBe(true);
    expect(readByDefence(['e', 'w'], 'mantra', false)).toBe(true);
    expect(readByDefence(['t'], 'mantra', false)).toBe(false);
  });

  it('a defence bonus big enough makes the back four win over a 3-4-3, and the 3-4-3 is weighed without it', () => {
    const keeper = man('P', 6);
    const defs = [6, 6, 6, 5.5].map((points) => ({ ...man('D', points), defenceBonus: 0.5 }));
    const mids = [6.2, 6.2, 6.2, 6.2].map((points) => man('C', points));
    const atts = [6.6, 6.6, 6.6].map((points) => man('A', points));
    const squad = [keeper, ...defs, ...mids, ...atts];
    // Without the bonus the third forward (6.6) beats the fourth defender (5.5): 3-4-3.
    expect(adviseLineup(squad.map((m) => ({ ...m, defenceBonus: null })), CLASSIC, ['343', '442'], FREE_BENCH, 'classic')!.module).toBe('3-4-3');
    // With it, four defenders earn 4 x 0.5 and the 4-4-2 wins - and its total says so.
    const plan = adviseLineup(squad, CLASSIC, ['343', '442'], FREE_BENCH, 'classic')!;
    expect(plan.module).toBe('4-4-2');
    expect(plan.modifiers).toBeCloseTo(2);
    const three = plan.scores.find((one) => one.module === '3-4-3')!;
    expect(three.total).toBeCloseTo(6 + 6 * 3 + 6.2 * 4 + 6.6 * 3); // no defence bonus on a back three
  });
});
