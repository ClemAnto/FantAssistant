import { describe, expect, it } from 'vitest';

import { MantraModules } from './auction-value';
import { LineupMan } from './lineup-advice';
import { LineupDraft, NO_SWITCH, drawDraft, move, relayout } from './lineup-edit';

/**
 * THE LINEUP EDITED BY HAND (operator, 09/10/2026): every drag & drop of the LINEUP page is one `move`, so the
 * gestures he asked for are tested here one by one - table to pitch, pitch to bench and back, the bench reordered,
 * two men swapped on the pitch, the switch - and so is every refusal.
 */

const RULES: MantraModules = {
  slot_roles: { P: ['P'], D: ['D'], C: ['C'], A: ['A'] },
  modules: {
    '4-4-2': { D: ['D', 'D', 'D', 'D'], M: ['C', 'C', 'C', 'C'], A: ['A', 'A'] },
    '4-3-3': { D: ['D', 'D', 'D', 'D'], M: ['C', 'C', 'C'], A: ['A', 'A', 'A'] },
  },
};

let next = 1;
function man(role: string, points = 6): LineupMan {
  const id = next++;
  return { id, name: `${role}${id}`, roles: [role.toLowerCase()], shown: [role], chance: 0.9, fm: points, points, fva: points };
}

/** A 4-4-2 (places in `placesIn` order: P, D x4, C x4, A x2), a bench of four and two men out. */
function setup() {
  const eleven = [man('P'), man('D'), man('D'), man('D'), man('D'), man('C'), man('C'), man('C'), man('C'), man('A'), man('A')];
  const bench = [man('P'), man('D'), man('C'), man('A')];
  const out = [man('A', 7), man('C', 5)];
  const all = [...eleven, ...bench, ...out];
  const draft: LineupDraft = {
    owner: 'classic:1:2001:7',
    module: '4-4-2',
    places: eleven.map((m) => m.id),
    bench: bench.map((m) => m.id),
    switch: NO_SWITCH,
  };
  return { eleven, bench, out, men: new Map(all.map((m) => [m.id, m])), all, draft };
}

const ok = (result: ReturnType<typeof move>): LineupDraft => {
  if ('refused' in result) throw new Error(result.refused);
  return result.draft;
};

describe('move', () => {
  it('table -> pitch: he takes the place, the man there leaves the lineup', () => {
    const { draft, men, out, eleven } = setup();
    const after = ok(move(draft, out[0].id, { kind: 'place', at: 9 }, men, RULES));
    expect(after.places[9]).toBe(out[0].id);
    expect(after.places).not.toContain(eleven[9].id);
    expect(after.bench).not.toContain(eleven[9].id);
  });

  it('a place he cannot play is refused, with the reason', () => {
    const { draft, men, out } = setup();
    const result = move(draft, out[0].id, { kind: 'place', at: 1 }, men, RULES);
    expect('refused' in result && result.refused).toMatch(/non gioca da D/);
  });

  it('bench -> pitch: the starter takes the bench man’s slot on the bench', () => {
    const { draft, men, bench, eleven } = setup();
    const after = ok(move(draft, bench[3].id, { kind: 'place', at: 10 }, men, RULES));
    expect(after.places[10]).toBe(bench[3].id);
    expect(after.bench[3]).toBe(eleven[10].id);
  });

  it('pitch -> pitch: two men swap places, when each can play the other’s', () => {
    const { draft, men, eleven } = setup();
    const after = ok(move(draft, eleven[5].id, { kind: 'place', at: 8 }, men, RULES));
    expect(after.places[5]).toBe(eleven[8].id);
    expect(after.places[8]).toBe(eleven[5].id);
  });

  it('pitch -> bench: inserted where it was dropped, his place left empty', () => {
    const { draft, men, eleven } = setup();
    const after = ok(move(draft, eleven[9].id, { kind: 'bench', index: 1 }, men, RULES));
    expect(after.places[9]).toBeNull();
    expect(after.bench[1]).toBe(eleven[9].id);
    expect(after.bench.length).toBe(5);
  });

  it('bench -> bench: reordered the way CDK declares the index', () => {
    const { draft, men, bench } = setup();
    const after = ok(move(draft, bench[0].id, { kind: 'bench', index: 3 }, men, RULES));
    expect(after.bench).toEqual([bench[1].id, bench[2].id, bench[3].id, bench[0].id]);
  });

  it('back on the table: out of the lineup', () => {
    const { draft, men, eleven, bench } = setup();
    const offPitch = ok(move(draft, eleven[2].id, { kind: 'out' }, men, RULES));
    expect(offPitch.places[2]).toBeNull();
    const offBench = ok(move(draft, bench[1].id, { kind: 'out' }, men, RULES));
    expect(offBench.bench).not.toContain(bench[1].id);
  });

  it('the switch: a starter goes out, a bench man comes in, and it follows them when they move', () => {
    const { draft, men, eleven, bench } = setup();
    expect('refused' in move(draft, bench[2].id, { kind: 'switch-out' }, men, RULES)).toBe(true);
    expect('refused' in move(draft, eleven[6].id, { kind: 'switch-in' }, men, RULES)).toBe(true);
    let after = ok(move(draft, eleven[6].id, { kind: 'switch-out' }, men, RULES));
    after = ok(move(after, bench[2].id, { kind: 'switch-in' }, men, RULES));
    expect(after.switch).toMatchObject({ out: eleven[6].id, in: bench[2].id });
    // The man going out sent to the bench: he is no starter any more, so that side of the switch empties.
    after = ok(move(after, eleven[6].id, { kind: 'bench', index: 0 }, men, RULES));
    expect(after.switch.out).toBeNull();
  });
});

describe('relayout and drawDraft', () => {
  it('another module keeps the men who fit and sends the others to the head of the bench', () => {
    const { draft, men, eleven, bench } = setup();
    const after = relayout(draft, '4-3-3', men, RULES);
    expect(after.module).toBe('4-3-3');
    expect(after.places.filter((id) => id !== null).length).toBe(10);
    expect(after.places.some((id) => id === null)).toBe(true); // the third forward's place, to fill by hand
    const midfielders = eleven.filter((m) => m.roles[0] === 'c').map((m) => m.id);
    expect(midfielders).toContain(after.bench[0]);
    expect(after.bench.slice(1)).toEqual(bench.map((m) => m.id));
  });

  it('draws the draft as a plan: rows with their places, the bench, the men left out, the cover', () => {
    const { draft, all, out } = setup();
    const plan = drawDraft(all, RULES, draft, 'classic')!;
    expect(plan.placed).toBe(11);
    expect(plan.rows.flatMap((r) => r.places).map((p) => p.at).sort((a, b) => a - b)).toEqual([...Array(11).keys()]);
    expect(plan.outside.map((m) => m.id)).toEqual(out.map((m) => m.id));
    expect(plan.cover?.starters).toBe(11);
  });
});
