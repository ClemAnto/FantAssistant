import { describe, expect, it } from 'vitest';

import { ANCHOR_TOP, anchorValue, piBand, scale99 } from './projection';

// I numeri veri del foglio mantra di Serie A del 19/08/2026.
const WORST = 38;
const MEAN = 158;
const BEST = 213;
const at = (value: number) => scale99(value, MEAN, BEST, WORST);

describe('la scala di Fπ', () => {
  it('ha i tre punti fissi che l\'operatore ha dettato', () => {
    expect(at(WORST)).toBe(0);
    expect(at(MEAN)).toBe(50);
    expect(at(BEST)).toBe(99);
  });

  it('sopra l\'ancora non cambia niente rispetto alla retta', () => {
    expect(at(207)).toBe(94);   // Yildiz
    expect(at(176)).toBe(66);   // Kelly
    expect(at(164)).toBe(55);   // Pongracic
  });

  it('sotto l\'ancora distende la coda invece di schiacciarla su zero', () => {
    // Il difetto che ha fatto cambiare la scala: «uno come Stones con 6.4x16 non può avere Fpi=0».
    // Con una retta fra le sole due ancore alte, prolungata all'ingiù, 183 uomini leggevano 0 insieme.
    expect(at(103)).toBeGreaterThan(0);            // Stones
    expect(at(102)).toBeGreaterThan(0);            // Skorupski
    expect(at(103)).toBeLessThan(30);              // ...ma resta nella banda «scarso»
    expect(at(70)).toBeLessThan(at(103));          // Pisseri, terzo portiere
  });

  it('è monotona: più fantapunti, mai meno punteggio', () => {
    let previous = -1;
    for (let value = WORST; value <= BEST; value += 1) {
      const score = at(value)!;
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });

  it('sotto l\'ancora la curva morde: la pendenza è più dolce che sopra', () => {
    const sopra = at(MEAN + 20)! - 50;
    const sotto = 50 - at(MEAN - 20)!;
    expect(sopra).toBeGreaterThan(sotto);
  });

  it('un vuoto resta un vuoto, e non è uno zero', () => {
    expect(scale99(null, MEAN, BEST, WORST)).toBeNull();
    expect(scale99(150, null, BEST, WORST)).toBeNull();
    expect(scale99(150, MEAN, null, WORST)).toBeNull();
    expect(scale99(150, MEAN, BEST, null)).toBeNull();
    expect(scale99(150, BEST, MEAN, WORST)).toBeNull();   // pool incoerente
  });
});

describe('l\'ancora', () => {
  it('sceglie i 250 con una colonna e li media con un\'altra', () => {
    // Serve perché un\'ancora definita dalla colonna che sta scalando si sposta a ogni suo ritocco.
    // Qui le due sono in ordine OPPOSTO, così se la selezione tornasse a farla Fπ il test se ne accorge.
    const overall = Array.from({ length: 300 }, (_, i) => i);
    const fpi = Array.from({ length: 300 }, (_, i) => 300 - i);
    const picked = anchorValue(fpi, overall)!;
    const alone = anchorValue(fpi)!;
    expect(picked).toBeLessThan(alone);
  });

  it('non risponde su una pool più corta del riferimento', () => {
    expect(anchorValue(Array.from({ length: 100 }, (_, i) => i))).toBeNull();
    expect(ANCHOR_TOP).toBe(250);
  });
});

describe('le bande dichiarate', () => {
  it('dicono in parole quello che il numero vuol dire', () => {
    expect(piBand(0)).toBe('non gioca');
    expect(piBand(5)).toBe('inutile');
    expect(piBand(25)).toBe('scarso');
    expect(piBand(45)).toBe('riserva');
    expect(piBand(70)).toBe('titolare');
    expect(piBand(null)).toBeNull();
  });
});
