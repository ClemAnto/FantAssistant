import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { TrendCell, TrendState, trendDeltaMean } from '../../core/player-trend';
import { DeltaTrend, deltaFill, deltaRise } from './delta-trend';

/** Una partita col suo FANTAVOTO: e' la misura che questa striscia disegna, il voto non conta. */
function cell(state: TrendState | null, points: number | null = null, minutes: number | null = 90): TrendCell {
  return {
    date: state ? '2026-09-20' : '',
    state,
    points,
    vote: points == null ? null : 6,
    opponent: state ? 'Cagliari' : null,
    home: state ? true : null,
    spell: { minutes: state === 'p' ? minutes : null, on: false, off: false },
  };
}

function draw(cells: TrendCell[]): HTMLElement[] {
  const fixture = TestBed.createComponent(DeltaTrend);
  fixture.componentRef.setInput('cells', cells);
  fixture.detectChanges();
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-vote-bar]')];
}

describe('ui-delta-trend', () => {
  it('le cinque fasce del delta', () => {
    expect(deltaFill(0)).toContain('vote-mid');
    expect(deltaFill(-0.5)).toContain('warning');
    // Il -1 esatto e' ambra: il rosso e' solo «sotto -1».
    expect(deltaFill(-1)).toContain('warning');
    expect(deltaFill(-1.5)).toContain('vote-poor');
    expect(deltaFill(0.5)).toContain('vote-good');
    expect(deltaFill(4)).toContain('vote-good');
    expect(deltaFill(4.5)).toContain('vote-top');
  });

  it('cresce solo per un delta positivo', () => {
    expect(deltaRise(0)).toBe(0);
    expect(deltaRise(-2)).toBe(0);
    expect(deltaRise(3)).toBeCloseTo(0.5);
    expect(deltaRise(12)).toBe(1);
    // Le caselle arrivano dalla piu' recente e si disegnano dalla piu' vecchia: 10.5 e' a destra.
    const [flat, grown] = draw([cell('p', 10.5), cell('p', 6)]).slice(-2);
    expect(flat.style.height).toBe('4px');
    expect(grown.style.height).toContain('calc');
    expect(grown.style.background).toContain('vote-top');
  });

  it('le assenze come la striscia del voto: un puntino da 2.5', () => {
    const [bench, injured] = draw([cell('i'), cell('b')]).slice(-2);
    expect(bench.style.background).toContain('absent-out');
    expect(injured.style.background).toContain('absent-injury');
    expect(bench.style.width).toBe('2.5px');
    expect(injured.style.height).toBe('2.5px');
  });
});

describe('trendDeltaMean', () => {
  it('la prima partita senza fantavoto vale -0.5, la seconda -1, la terza -1.5; una che non esiste non conta', () => {
    // (+4.5) + 0 + (-0.5 panchina) = 4 su tre partite.
    expect(trendDeltaMean([cell('p', 10.5), cell('p', 6), cell('b'), cell(null)])).toBeCloseTo(4 / 3);
    // Cinque vuoti: -0.5 - 1 - 1.5 - 2 - 2.5 = -7.5, su cinque = -1.5.
    expect(trendDeltaMean([cell('b'), cell('i'), cell('s'), cell('o'), cell('p', null)])).toBeCloseTo(-1.5);
    // L'ordine dei vuoti non cambia la media.
    expect(trendDeltaMean([cell('b'), cell('p', 8), cell('i')]))
      .toBeCloseTo(trendDeltaMean([cell('p', 8), cell('b'), cell('i')])!);
    expect(trendDeltaMean([cell(null)])).toBeNull();
  });
});
