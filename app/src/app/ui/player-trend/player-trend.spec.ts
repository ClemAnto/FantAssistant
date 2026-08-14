import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { PlayerTrend, parseTrend } from '../../core/player-trend';
import { PlayerTrendStrip, VOTE_CEIL, VOTE_FLOOR } from './player-trend';

/**
 * A drawing is verified on its GEOMETRY and not by looking at it: a screenshot shows a rendering, it
 * does not show that an absence was drawn as a short bar - which is the one confusion this strip must
 * never make, because «he did not play» and «he played badly» are different facts and the first one is
 * 90% of the variance of fantapunti.
 */
function strip(detail: string) {
  const matches = parseTrend(detail);
  const trend: PlayerTrend = {
    matches,
    fp: null,
    scored: 0,
    window: matches.length,
    played: matches.filter((match) => match.state === 'p').length,
    bench: matches.filter((match) => match.state === 'b').length,
    outsideEuro: matches.filter((match) => match.inEuro === false).length,
  };
  const fixture = TestBed.createComponent(PlayerTrendStrip);
  fixture.componentRef.setInput('trend', trend);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const PLAYED = (vote: string, extra: Record<number, string> = {}) => {
  const base = ['2026-05-01', 'serie_a', 'Lazio', 'A', 'p', '90', '1', vote, 'real', vote, '0', '0',
    '0', '0', '', '1'];
  for (const [at, value] of Object.entries(extra)) base[Number(at)] = value;
  return base.join('|');
};

describe('ui-trend', () => {
  it('draws a taller bar for a better voto, on the declared scale', () => {
    const svg = strip([PLAYED('5.0'), PLAYED('7.0'), PLAYED('9.0')].join(';'));
    const heights = [...svg.querySelectorAll('rect')].map((rect) =>
      Number(rect.getAttribute('height')),
    );
    expect(heights[0]).toBeLessThan(heights[1]);
    expect(heights[1]).toBeLessThan(heights[2]);
    // above the ceiling the bar stops growing rather than leaving the cell
    const ceiling = strip(PLAYED(String(VOTE_CEIL + 2)));
    expect(Number(ceiling.querySelector('rect')!.getAttribute('height'))).toBe(
      Number(strip(PLAYED(String(VOTE_CEIL))).querySelector('rect')!.getAttribute('height')),
    );
    // and below the floor it is still visible: a bad match is a fact, not a blank
    expect(
      Number(strip(PLAYED(String(VOTE_FLOOR - 2))).querySelector('rect')!.getAttribute('height')),
    ).toBeGreaterThan(0);
  });

  it('draws an absence as a plinth, in the reason’s own colour, and never as a bar', () => {
    const bench = '2026-05-08|serie_a|Como|H|b|||||||||||1';
    const injured = '2026-05-15|serie_a|Roma|A|i|||||||||||1';
    const svg = strip([bench, injured].join(';'));
    const rects = [...svg.querySelectorAll('rect')];
    expect(rects).toHaveLength(2);
    for (const rect of rects) {
      expect(Number(rect.getAttribute('height'))).toBe(2);
      expect(Number(rect.getAttribute('y'))).toBe(16); // sitting on the baseline
    }
    expect(rects[0].getAttribute('fill')).toBe('var(--color-absent-bench)');
    expect(rects[1].getAttribute('fill')).toBe('var(--color-absent-injury)');
  });

  it('says a synthetic voto is synthetic instead of passing it off as the game’s own', () => {
    const svg = strip(PLAYED('6.5', { 8: 'synth' }));
    const rect = svg.querySelector('rect')!;
    expect(rect.getAttribute('fill')).toBe('none');
    expect(rect.getAttribute('stroke')).toBe('var(--color-vote-good)');
  });

  it('keeps xG+xA beside the bar and the euro mark under it', () => {
    const svg = strip(PLAYED('6.5', { 14: '0.80', 15: '0' }));
    const fills = [...svg.querySelectorAll('rect')].map((rect) => rect.getAttribute('fill'));
    expect(fills).toContain('var(--color-xga)');
    expect(fills).toContain('var(--color-muted)'); // the round the euro calendar never counted
  });

  it('draws nothing at all when there is no window, rather than an empty axis', () => {
    const fixture = TestBed.createComponent(PlayerTrendStrip);
    fixture.componentRef.setInput('trend', null);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('svg')).toBeNull();
  });
});
