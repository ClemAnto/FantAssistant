import { describe, expect, it } from 'vitest';

import { PlaceChange, placeMark } from './player-place';

const base: PlaceChange = {
  change: 'gained',
  on: '2025-10-05',
  matchday: 6,
  minutes: '6 -> 73',
  cause: 'won_then_injury',
  who: 'Estupinan (ankle, 2025-10-12 -> 2025-10-31)',
};

describe('placeMark', () => {
  it('says WHEN, and keeps the two sentences about an injury apart', () => {
    // The operator's own case, and the order is the measurement: he took the place on 5 October and
    // the ankle is of the 12th. «Gioca perché manca X» would be the opposite claim about the same man.
    const won = placeMark(base)!;
    expect(won.flag).toBe('place_gained');
    expect(won.note).toContain('05/10/2025');
    expect(won.note).toContain('giornata 6');
    expect(won.note).toContain('consolidato');

    const standIn = placeMark({ ...base, cause: 'front_injured' })!;
    expect(standIn.note).toContain('era già fuori');
    expect(standIn.note).toContain('tornare indietro');
  });

  it('marks a lost place and names what it is, without inventing a suspension', () => {
    const lost = placeMark({ ...base, change: 'lost', cause: 'benched', who: '20 di 31 in panchina' })!;
    expect(lost.flag).toBe('place_lost');
    expect(lost.note).toContain('DISPONIBILE e non schierato');
    // Where a ban cannot be seen the note says it was not looked at - never «no suspension».
    expect(lost.note).toContain('non sono controllate');
  });

  it('adds the caveat only where it belongs', () => {
    // He was out himself: there is nothing a suspension could add, so the sentence does not carry it.
    const hurt = placeMark({ ...base, change: 'lost', cause: 'own_injury', who: 'fuori per 9 partite' })!;
    expect(hurt.note).not.toContain('non sono controllate');
  });

  it('is null when the sheet says nothing, and never a neutral sentence', () => {
    expect(placeMark(null)).toBeNull();
    expect(placeMark({ ...base, change: '' as never })).toBeNull();
    expect(placeMark({ ...base, on: '' })).toBeNull();
  });
});
