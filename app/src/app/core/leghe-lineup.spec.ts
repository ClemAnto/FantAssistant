import { describe, expect, it } from 'vitest';

import { LegheError } from './leghe-api';
import {
  LEGHE_MANTRA_SLOTS,
  SaveInput,
  SaveMan,
  legheModuleCode,
  legheSlots,
  orderForLeghe,
  orderWithSwitch,
  saveBody,
  saveRefusal,
  switchModules,
} from './leghe-lineup';
import { BenchRule } from './leghe-rules';

/**
 * THE LINEUP AS LEGHE TAKES IT. The rules below were read in Leghe's backend (`TeamLineupService.Save`,
 * `ValidateTeamLineup`, `ControlloSwitch`) and front-end (`Lineups.saveLineup`, `lineup-switch.ts`) on 09/10/2026;
 * the men are synthetic, because a real lineup is the operator's.
 */

let next = 1;
const man = (...roles: string[]): SaveMan => ({ id: next++, name: `${roles.join('/')}${next}`, roles });

/** A classic eleven in a shuffled order: the save must put the keeper first and count D, C, A. */
function classicEleven(d = 4, c = 4, a = 2): SaveMan[] {
  const out = [...Array.from({ length: a }, () => man('a')), ...Array.from({ length: c }, () => man('c'))];
  out.push(man('p'));
  out.push(...Array.from({ length: d }, () => man('d')));
  return out;
}

const FREE: BenchRule = { size: null, fixed: false, perRole: [], sequence: null };

function input(over: Partial<SaveInput> = {}): SaveInput {
  return {
    game: 'classic',
    rules: { modules: ['442', '433', '352'], bench: FREE, captain: 'none', switchMode: 'none' },
    module: '4-4-2',
    starters: classicEleven(),
    bench: [man('p'), man('d'), man('c'), man('a')],
    switchPair: null,
    competitionId: 11,
    matchday: 7,
    championshipMatchday: 7,
    teamId: 5,
    allCompetitions: false,
    visible: true,
    ...over,
  };
}

describe('the places in Leghe’s order', () => {
  it('classic: keeper, then the module’s defenders, midfielders and forwards', () => {
    expect(legheSlots('343', 'classic')).toEqual([['p'], ['d'], ['d'], ['d'], ['c'], ['c'], ['c'], ['c'], ['a'], ['a'], ['a']]);
    expect(legheSlots('343x', 'classic')).toBeNull();
  });

  it('mantra: the backend’s own table, eleven places each, the keeper first', () => {
    for (const code of Object.keys(LEGHE_MANTRA_SLOTS)) {
      const slots = legheSlots(code, 'mantra')!;
      expect(slots.length).toBe(11);
      expect(slots[0]).toEqual(['por']);
    }
    // The 4-3-3 as Leghe writes it: Ds before Dd, and the Pc BETWEEN the two W/A.
    expect(legheSlots('433', 'mantra')).toEqual([
      ['por'], ['ds'], ['dc'], ['dc'], ['dd'], ['c'], ['m'], ['m', 'c'], ['w', 'a'], ['a', 'pc'], ['w', 'a'],
    ]);
    expect(legheSlots('424', 'mantra')).toBeNull();
  });

  it('names a module the way the league does, and refuses one the league does not allow', () => {
    expect(legheModuleCode('4-2-3-1', ['343', '4231'])).toBe('4231');
    expect(legheModuleCode('3-5-2', ['343', '4231'])).toBeNull();
    expect(legheModuleCode('3-4-3', [])).toBe('343');
  });

  it('orders a Mantra eleven so that every man stands on a place of his roles', () => {
    const eleven = [
      man('pc'), man('w', 'a'), man('w'), man('m'), man('c'), man('c', 't'),
      man('dd'), man('dc'), man('dc', 'b'), man('ds'), man('por'),
    ];
    const slots = legheSlots('433', 'mantra')!;
    const ordered = orderForLeghe(eleven, slots)!;
    expect(ordered).not.toBeNull();
    ordered.forEach((one, at) => expect(one.roles.some((r) => slots[at].includes(r))).toBe(true));
    expect(ordered[0].roles).toEqual(['por']);
    // Two keepers and no Pc: no order fills the 4-3-3.
    expect(orderForLeghe([...eleven.slice(1), man('por')], slots)).toBeNull();
  });
});

describe('saveBody', () => {
  it('builds Leghe’s body: keeper first, the league’s module code, web action, no switch', () => {
    const plan = saveBody(input());
    if (!('body' in plan)) throw new Error(plan.refusal);
    const body = plan.body;
    expect(body.mdl).toBe('442');
    expect(body.starts.length).toBe(11);
    expect({ act: body.act, swtcA: body.swtcA, swtcB: body.swtcB, swtc: body.swtc, swtcMdl: body.swtcMdl, capt: body.capt })
      .toEqual({ act: 0, swtcA: 0, swtcB: 0, swtc: 0, swtcMdl: '', capt: [] });
    expect({ idcomp: body.idcomp, mday: body.mday, cmday: body.cmday, tid: body.tid, allComp: body.allComp, visb: body.visb })
      .toEqual({ idcomp: 11, mday: 7, cmday: 7, tid: 5, allComp: false, visb: true });
  });

  it('puts the keeper at index 0 whatever order the eleven came in', () => {
    const starters = classicEleven();
    const keeper = starters.find((m) => m.roles[0] === 'p')!;
    const plan = saveBody(input({ starters }));
    if (!('body' in plan)) throw new Error(plan.refusal);
    expect(plan.body.starts[0]).toBe(keeper.id);
  });

  it('refuses what Leghe would refuse, each with its own sentence', () => {
    const refusal = (over: Partial<SaveInput>) => {
      const plan = saveBody(input(over));
      return 'refusal' in plan ? plan.refusal : null;
    };
    expect(refusal({ starters: classicEleven().slice(1) })).toMatch(/Manca un titolare/);
    expect(refusal({ module: '4-5-1', starters: classicEleven(4, 5, 1) })).toMatch(/non è fra quelli ammessi/);
    expect(refusal({ matchday: null })).toMatch(/giornata/);
    expect(refusal({ rules: { ...input().rules, captain: 'match' } })).toMatch(/capitano/);
    // The eleven of a 3-5-2 declared as a 4-4-2: the counts do not fill the places.
    expect(refusal({ starters: classicEleven(3, 5, 2) })).toMatch(/non riempiono/);
  });

  it('checks the bench as Leghe does: fixed size, exact counts, a keeper on a Mantra bench', () => {
    const bench = [man('p'), man('d'), man('c')];
    const fixed: BenchRule = { size: 4, fixed: true, perRole: [], sequence: null };
    const plan = saveBody(input({ bench, rules: { ...input().rules, bench: fixed } }));
    expect('refusal' in plan && plan.refusal).toMatch(/deve avere 4/);
    const exact: BenchRule = { size: 3, fixed: true, perRole: [1, 2, 0, 0], sequence: null };
    const exactPlan = saveBody(input({ bench, rules: { ...input().rules, bench: exact } }));
    expect('refusal' in exactPlan && exactPlan.refusal).toMatch(/esattamente 2 D/);
    const sequence: BenchRule = { size: 3, fixed: true, perRole: [], sequence: [1, 3, 2] };
    const seqPlan = saveBody(input({ bench, rules: { ...input().rules, bench: sequence } }));
    expect('refusal' in seqPlan && seqPlan.refusal).toMatch(/P C D/);
    const capped: BenchRule = { size: 2, fixed: false, perRole: [], sequence: null };
    const capPlan = saveBody(input({ bench, rules: { ...input().rules, bench: capped } }));
    expect('refusal' in capPlan && capPlan.refusal).toMatch(/al massimo 2/);
  });

  it('a man on the pitch AND on the bench is refused', () => {
    const starters = classicEleven();
    const plan = saveBody(input({ starters, bench: [starters[0]] }));
    expect('refusal' in plan && plan.refusal).toMatch(/sia in campo sia in panchina/);
  });
});

describe('the switch', () => {
  it('basic: the man coming in must take the place of the man going out - same role on classic', () => {
    const starters = classicEleven();
    const out = starters.find((m) => m.roles[0] === 'c')!;
    expect(switchModules(starters, out, man('c'), '442', ['442'], 'classic', 'basic')).toEqual(['442']);
    expect(switchModules(starters, out, man('a'), '442', ['442', '433'], 'classic', 'basic')).toEqual([]);
  });

  it('plus: a man of another role lands on a module the league allows, and only there', () => {
    const starters = classicEleven();
    const out = starters.find((m) => m.roles[0] === 'c')!;
    // 4-4-2 minus a C plus an A = 4-3-3.
    expect(switchModules(starters, out, man('a'), '442', ['442', '433'], 'classic', 'plus')).toEqual(['433']);
    expect(switchModules(starters, out, man('a'), '442', ['442', '352'], 'classic', 'plus')).toEqual([]);
    // A keeper only for a keeper.
    const keeper = starters.find((m) => m.roles[0] === 'p')!;
    expect(switchModules(starters, keeper, man('d'), '442', ['442', '433', '352'], 'classic', 'plus')).toEqual([]);
  });

  it('mantra basic: the place the man going out stands in decides - a B for a Dc on the Dc/B place', () => {
    // QIT-1721, as the Leghe front-end states it: a B replaces a Dc standing on the Dc/B place.
    const slots = legheSlots('343', 'mantra')!;
    const eleven = [
      man('por'), man('dc'), man('dc'), man('dc'), man('e'), man('c'), man('m'), man('e'), man('w'), man('pc'), man('a'),
    ];
    const dc = eleven[1];
    const b = man('b');
    const ordered = orderWithSwitch(eleven, dc, b, slots)!;
    expect(ordered).not.toBeNull();
    expect(slots[ordered.indexOf(dc)]).toEqual(['dc', 'b']);
    expect(switchModules(eleven, dc, b, '343', ['343'], 'mantra', 'basic')).toEqual(['343']);
    // A W does not take a Dc's place in a Basic switch.
    expect(switchModules(eleven, dc, man('w'), '343', ['343'], 'mantra', 'basic')).toEqual([]);
  });

  it('the body carries the pair, the module after it and the position of the man going out', () => {
    const starters = classicEleven();
    const out = starters.find((m) => m.roles[0] === 'c')!;
    const into = man('a');
    const plan = saveBody(input({
      starters,
      bench: [man('p'), into],
      rules: { ...input().rules, switchMode: 'plus' },
      switchPair: { out: out.id, in: into.id, module: null },
    }));
    if (!('body' in plan)) throw new Error(plan.refusal);
    expect(plan.body.swtcA).toBe(out.id);
    expect(plan.body.swtcB).toBe(into.id);
    expect(plan.body.swtcMdl).toBe('433');
    expect(plan.body.starts[plan.body.pos]).toBe(out.id);
  });

  it('is refused where the league has none, and on a pair Leghe would not take', () => {
    const starters = classicEleven();
    const out = starters.find((m) => m.roles[0] === 'c')!;
    const into = man('a');
    const none = saveBody(input({ starters, bench: [into], switchPair: { out: out.id, in: into.id, module: null } }));
    expect('refusal' in none && none.refusal).toMatch(/non ha lo switch/);
    const basic = saveBody(input({
      starters,
      bench: [into],
      rules: { ...input().rules, switchMode: 'basic' },
      switchPair: { out: out.id, in: into.id, module: null },
    }));
    expect('refusal' in basic && basic.refusal).toMatch(/Switch Basic/);
  });
});

describe('saveRefusal', () => {
  it('says Leghe’s refusal in Italian when it knows the code, Leghe’s own words otherwise', () => {
    expect(saveRefusal(new LegheError('refused', 'x', 'LUP007'))).toMatch(/formazioni sono chiuse \(LUP007\)/);
    expect(saveRefusal(new LegheError('refused', 'Leghe ha rifiutato (ZZ9)', 'ZZ9'))).toBe('Leghe ha rifiutato (ZZ9)');
    expect(saveRefusal(new LegheError('expired', 'scaduta'))).toBe('scaduta');
  });
});
