import { describe, expect, it } from 'vitest';

import { MYSTERY_WINDOW, mysteryOf } from './player-mystery';

/**
 * IL MISTERO: sano, quotato per giocare, e senza minuti. Le tre condizioni valgono INSIEME, e ognuna di
 * queste prove è uno dei modi in cui una lista di «misteri» diventerebbe una lista di riserve.
 */
describe('mysteryOf', () => {
  const base = {
    minutes: 27,
    rounds: MYSTERY_WINDOW,
    injured: 0,
    qualityPercentile: 80,
    expectedShare: 0.55,
    season: '2025-26',
  };

  it('segna chi era disponibile, è prezzato fra i primi e non ha giocato', () => {
    // Il caso vero: Angelino, 27 minuti nelle ultime dieci giornate senza un giorno di infortunio.
    const mark = mysteryOf(base)!;
    expect(mark.flag).toBe('mystery');
    expect(mark.note).toContain('27 minuti');
    expect(mark.note).toContain('senza essere infortunato');
  });

  it('non segna chi non gioca perché è infortunato: quello lo dice già l\'altra icona', () => {
    expect(mysteryOf({ ...base, injured: 6 })).toBeNull();
  });

  it('non segna una riserva: senza qualità misurata non è un mistero, è una gerarchia', () => {
    expect(mysteryOf({ ...base, qualityPercentile: 20 })).toBeNull();
    expect(mysteryOf({ ...base, qualityPercentile: null })).toBeNull();
  });

  it('non segna una riserva che il motore non prevede in campo: quella è una gerarchia', () => {
    // Contini, terzo portiere: dieci righe da panchinaro, zero minuti e una media voto alta. Il motore
    // gli prevede il 23% del calendario, ed è quello che lo distingue da un mistero.
    expect(mysteryOf({ ...base, minutes: 0, expectedShare: 0.23 })).toBeNull();
  });

  it('non segna chi i minuti li ha fatti', () => {
    expect(mysteryOf({ ...base, minutes: 400 })).toBeNull();
  });

  it('tace su una finestra troppo corta: con due giornate su dieci non si sa se non giocava o non c\'era', () => {
    expect(mysteryOf({ ...base, rounds: 2 })).toBeNull();
  });
});
