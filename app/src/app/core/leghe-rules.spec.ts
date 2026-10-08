import { describe, expect, it } from 'vitest';

import { moduleLabel, parseRules, rulesSummary } from './leghe-rules';

/**
 * THE LEAGUE'S RULES AS LEGHE SERVES THEM. The three payloads are the real settings of two of the
 * operator's leagues on 08/10/2026 (a classic one with the defence modifier, his Mantra EuroLeghe),
 * trimmed to the keys this file reads: settings carry no names and no tokens.
 */

const CLASSIC_LINEUP = {
  hlnp: true, rlnp: true, fbench: true, assu: false, lcap: 3, lswi: 3, elnp: 0, tbench: 12, count: 9,
  mods: ['343', '352', '433', '442', '451', '532', '541'], brdrs: [0, 0, 0, 0], bseq: null, version: 'v3',
};
const CLASSIC_CALC = {
  bnMls: { bmycsv: 0, motm: [1, 1, 1, 1] },
  step: { stlmt: 66, stgoal: [5] },
  subst: { ssdfm: 4, ssdfg: 2, sstype: 1, ssdfn: 1, ssnum: 5, ssdft: false },
  smodd: { smodlu: 7.25, smodld: 6, smodty: 1, smoddg: true, smodva: [0, 0.5, 1, 1.5, 2, 2.5, 3] },
  smodp: null,
};
const EURO_LINEUP = {
  rlnp: true, fbench: true, lcap: 3, lswi: 3, elnp: 1, tbench: 12, brdrs: [1, 0], bseq: null,
  mods: ['3412', '3421', '343', '3511', '352', '4141', '4231', '4312', '433', '4411', '442'],
};
const EURO_CALC = {
  bnMls: { bmycsv: 0 },
  step: { stlmt: 66, stgoal: [5] },
  subst: { ssdfm: 4, ssdfg: 2, sstype: 6, ssdfn: 1, ssnum: 11, ssdft: false },
  smodd: null,
  smodp: { smodva: [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1, 2, 3] },
};

describe('parseRules', () => {
  it('reads a classic league: fixed bench of 12, Dynamic, five changes, the defence modifier to +3', () => {
    const rules = parseRules(CLASSIC_LINEUP, CLASSIC_CALC, { sroles: 1 });
    expect(rules.game).toBe('classic');
    expect(rules.modules).toHaveLength(7);
    expect(rules.bench).toEqual({ size: 12, fixed: true, perRole: [0, 0, 0, 0], sequence: null });
    expect(rules.substitutions).toEqual({ kind: 'dynamic', max: 5 });
    expect(rules.officeReserve).toEqual({ on: false, keeper: 2, outfield: 4 });
    expect(rules.captain).toBe('none');
    expect(rules.switchMode).toBe('plus');
    expect(rules.closesMinutesBefore).toBe(0);
    expect(rules.defence).toEqual({ from: 6, to: 7.25, values: [0, 0.5, 1, 1.5, 2, 2.5, 3], withKeeper: true });
    expect(rules.performance).toBeNull();
    expect(rules.goals).toEqual({ first: 66, steps: [5] });
  });

  it('reads the Mantra league: Master, unlimited changes, a performance factor and no defence modifier', () => {
    const rules = parseRules(EURO_LINEUP, EURO_CALC, { sroles: 2 });
    expect(rules.game).toBe('mantra');
    expect(rules.substitutions).toEqual({ kind: 'master', max: null });
    expect(rules.defence).toBeNull();
    expect(rules.performance?.[11]).toBe(3);
    expect(rules.bench.perRole).toEqual([1, 0]);
  });

  it('a variable bench of size 0 has no limit; a fixed bench of size 0 has no bench', () => {
    expect(parseRules({ fbench: false, tbench: 0 }, {}, null).bench.size).toBeNull();
    expect(parseRules({ fbench: true, tbench: 0 }, {}, null).bench.size).toBe(0);
  });

  it('a missing payload gives empty sections, never a default dressed up as the league rule', () => {
    const rules = parseRules(null, null, null);
    expect(rules.game).toBeNull();
    expect(rules.substitutions).toEqual({ kind: null, max: null });
    expect(rules.captain).toBeNull();
    expect(rules.goals).toBeNull();
  });
});

describe('rulesSummary and moduleLabel', () => {
  it('words the rules in the operator language', () => {
    const lines = Object.fromEntries(
      rulesSummary(parseRules(CLASSIC_LINEUP, CLASSIC_CALC, { sroles: 1 })).map((l) => [l.label, l.value]),
    );
    expect(lines['Sostituzioni']).toBe('Dynamic (prima il cambio modulo) · al massimo 5');
    expect(lines['Mod. difesa']).toBe('da 6 a 7.25, fino a +3 (col portiere)');
    expect(lines['Moduli']).toContain('3-4-3');
  });

  it('spells a module one digit per line', () => {
    expect(moduleLabel('4231')).toBe('4-2-3-1');
    expect(moduleLabel('343')).toBe('3-4-3');
  });
});
