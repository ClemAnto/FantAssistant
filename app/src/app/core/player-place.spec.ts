import { describe, expect, it } from 'vitest';

import { PlaceChange, placeMark, rotationMark } from './player-place';

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

describe('rotationMark', () => {
  it('says the two things the operator asked for, and carries its own measurement', () => {
    const mark = rotationMark({ minutes: 27.6, starts: 1, from: '2025-08-16', to: '2025-09-21' })!;
    expect(mark.flag).toBe('rotation_risk');
    expect(mark.note).toContain('28 minuti');
    expect(mark.note).toContain('1 partita da titolare');
    expect(mark.note).toContain('non è il titolare e non ha minutaggio');
    // a screen is a reason to look and never a certainty: the note says how often it is right
    expect(mark.note).toContain('90,4%');
    expect(mark.note).toContain('Uno su dieci diventa titolare davvero');
  });

  it('is null on a sheet that has no season to read yet', () => {
    // Pre-season: the columns are empty by construction, and an empty column is not a clean bill.
    expect(rotationMark(null)).toBeNull();
    expect(rotationMark({ minutes: null, starts: null, from: null, to: null })).toBeNull();
  });
});
