import { describe, expect, it } from 'vitest';

import { RarityMan, atLeastAsGood, rarity, rarityText } from './draft-rarity';

function man(id: number, group: string, over: Partial<RarityMan> = {}): RarityMan {
  return { id, group, rung: 5, steady: 0.6, mv: 6.0, bonus: 0.2, share: 0.8, fragility: 0.02, ...over };
}

describe('draft-rarity', () => {
  it("reads the operator's example: six forwards as good as each other, one defender better than the rest", () => {
    const forwards = [1, 2, 3, 4, 5, 6].map((id) => man(id, 'pc', { mv: 7.0, bonus: 3.0 }));
    const defenders = [man(10, 'dc', { mv: 6.5, bonus: 0 }), ...[11, 12, 13].map((id) => man(id, 'dc', { mv: 6.0, bonus: 0 }))];
    const rar = rarity([...forwards, ...defenders]);
    expect(rar.get(1)?.count).toBe(5);
    expect(rar.get(10)?.count).toBe(0);
    // ...and the worse defenders have the good one among their peers.
    expect(rar.get(11)).toEqual({ count: 3, of: 3 });
  });

  it('counts only inside the group', () => {
    const rar = rarity([man(1, 'dc'), man(2, 'pc')]);
    expect(rar.get(1)).toEqual({ count: 0, of: 0 });
    expect(rar.get(2)).toEqual({ count: 0, of: 0 });
  });

  it('forgives each reading its tolerance, and no more', () => {
    const base = man(1, 'c', { mv: 6.3 });
    expect(atLeastAsGood(man(2, 'c', { mv: 6.2 }), base)).toBe(true);
    expect(atLeastAsGood(man(3, 'c', { mv: 6.1 }), base)).toBe(false);
  });

  it('needs him at least as good on EVERY reading, and reads fragility the other way', () => {
    const base = man(1, 'c');
    expect(atLeastAsGood(man(2, 'c', { mv: 7, share: 0.7 }), base)).toBe(false);
    expect(atLeastAsGood(man(3, 'c', { fragility: 0.1 }), base)).toBe(false);
    expect(atLeastAsGood(man(4, 'c', { fragility: 0 }), base)).toBe(true);
    expect(atLeastAsGood(man(5, 'c', { rung: 4 }), base)).toBe(false);
  });

  it("reads a candidate's missing reading as the group's mean; his own missing reading constrains nobody", () => {
    const unknown = man(1, 'c', { steady: null });
    expect(atLeastAsGood(man(2, 'c'), unknown)).toBe(true);
    // Mean 0.7 over the group: as good as a man at 0.6, not as good as one at 0.9.
    const means = { steady: 0.7 };
    expect(atLeastAsGood(unknown, man(3, 'c', { steady: 0.6 }), means)).toBe(true);
    expect(atLeastAsGood(unknown, man(4, 'c', { steady: 0.9 }), means)).toBe(false);
    // No mean at all: he cannot be shown to be as good.
    expect(atLeastAsGood(unknown, man(5, 'c'))).toBe(false);
    const rar = rarity([man(10, 'c', { steady: null }), man(11, 'c', { steady: 0.6 }), man(12, 'c', { steady: 0.8 })]);
    expect(rar.get(11)?.count).toBe(2);
  });

  it('shows the count up to ten, then the share of the other free men of his group', () => {
    expect(rarityText({ count: 10, of: 40 })).toBe('10');
    expect(rarityText({ count: 11, of: 40 })).toBe('28%');
    expect(rarityText(null)).toBe('—');
  });
});
