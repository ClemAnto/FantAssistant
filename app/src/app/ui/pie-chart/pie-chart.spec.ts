import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { PieChart, PieSlice } from './pie-chart';

/**
 * A drawing is verified on its GEOMETRY and not by looking at it: a screenshot cannot tell a wedge that
 * is three times another from one that is merely wider, and it cannot tell an arc that draws nothing
 * from one that was never there.
 */
function pie(slices: PieSlice[], hole?: number): SVGElement | HTMLElement {
  const fixture = TestBed.createComponent(PieChart);
  fixture.componentRef.setInput('slices', slices);
  if (hole != null) fixture.componentRef.setInput('hole', hole);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const slice = (label: string, value: number): PieSlice => ({ label, value, fill: 'red' });

/** Where a wedge's outer arc ENDS, which is the angle it was drawn to. */
function endsAt(path: string): number {
  // `M x y A r r 0 f 1 x2 y2 ...` - the point after the flags is the end of the outer arc.
  const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const [x, y] = path.startsWith('M 50 50')
    ? numbers.slice(9, 11)   // filled pie: M centre, L start, A r r 0 f 1 end
    : numbers.slice(7, 9);   // doughnut:   M start, A r r 0 f 1 end
  // Clockwise from twelve o'clock, as a share of the turn.
  return ((Math.atan2(y - 50, x - 50) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
}

describe('ui-pie', () => {
  it('gives each slice the share of the turn its value is worth', () => {
    const svg = pie([slice('tre', 3), slice('uno', 1)]);
    const paths = [...svg.querySelectorAll('path')].map((one) => one.getAttribute('d')!);
    expect(paths.length).toBe(2);
    // The first ends three quarters round, the second closes the circle.
    expect(endsAt(paths[0])).toBeCloseTo(0.75, 3);
    expect(endsAt(paths[1])).toBeCloseTo(0, 3);
  });

  it('tells SVG to take the long way round for a wedge over half the circle', () => {
    // Without the large-arc flag a 75% wedge is drawn as its own 25% complement, which looks like a
    // correct pie of the wrong numbers - the worst kind of defect a chart can have.
    const svg = pie([slice('tre', 3), slice('uno', 1)]);
    const paths = [...svg.querySelectorAll('path')].map((one) => one.getAttribute('d')!);
    expect(paths[0]).toContain(' 1 1 ');
    expect(paths[1]).toContain(' 0 1 ');
  });

  it('draws a lone slice as a ring, because an arc of a full turn draws nothing', () => {
    const svg = pie([slice('tutti', 12)]);
    expect(svg.querySelectorAll('path').length).toBe(0);
    const ring = svg.querySelector('circle')!;
    expect(ring).not.toBeNull();
    expect(Number(ring.getAttribute('stroke-width'))).toBeGreaterThan(0);
    expect(ring.getAttribute('fill')).toBe('none');
  });

  it('draws nothing and says so when there is nobody to count', () => {
    const svg = pie([slice('vuota', 0), slice('anche', 0)]);
    expect(svg.querySelector('svg')).toBeNull();
    expect(svg.textContent).toContain('Nessun calciatore');
  });

  it('leaves out a band nobody fell in, and still lists it in the legend', () => {
    // The legend answers «what are the bands», the drawing answers «who is in them»: a zero-width
    // wedge would be an invisible path, and a missing legend row would hide an empty band.
    const svg = pie([slice('piena', 5), slice('vuota', 0)]);
    expect(svg.querySelectorAll('li').length).toBe(2);
    expect(svg.querySelectorAll('path').length).toBe(0);   // one drawn slice: it is a ring
  });

  it('states each slice as a count and a share', () => {
    const svg = pie([slice('tre', 3), slice('uno', 1)]);
    const rows = [...svg.querySelectorAll('li')].map((one) => one.textContent!.replace(/\s+/g, ' '));
    expect(rows[0]).toContain('3');
    expect(rows[0]).toContain('75.0%');
    expect(rows[1]).toContain('25.0%');
  });

  it('draws a full pie when the hole is closed', () => {
    const svg = pie([slice('tre', 3), slice('uno', 1)], 0);
    const paths = [...svg.querySelectorAll('path')].map((one) => one.getAttribute('d')!);
    expect(paths[0].startsWith('M 50 50')).toBe(true);
    expect(endsAt(paths[0])).toBeCloseTo(0.75, 3);
  });
});
