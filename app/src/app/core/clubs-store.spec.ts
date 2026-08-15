import { describe, expect, it } from 'vitest';

import { shortNames } from './clubs-store';

/**
 * The short name under a badge. What is tested is the property that matters - no two clubs of the same
 * listone may read the same - because the two collisions are REAL: they are on the euro listone today.
 */
describe('shortNames', () => {
  it('takes three letters of the first real word', () => {
    const short = shortNames(['Napoli', 'AC Milan', 'Borussia Dortmund']);
    expect(short.get('Napoli')).toBe('Nap');
    expect(short.get('AC Milan')).toBe('Mil');
    expect(short.get('Borussia Dortmund')).toBe('Bor');
  });

  it('tells apart the two collisions the euro listone actually has', () => {
    const short = shortNames([
      'Manchester City',
      'Manchester United',
      'Bayern Monaco',
      'Bayer Leverkusen',
    ]);
    expect(short.get('Manchester City')).toBe('ManC');
    expect(short.get('Manchester United')).toBe('ManU');
    expect(short.get('Bayern Monaco')).toBe('BayM');
    expect(short.get('Bayer Leverkusen')).toBe('BayL');
  });

  it('leaves a club short when nobody else claims its letters', () => {
    // The pool is part of the label: without United on the listone, City is simply `Man`.
    expect(shortNames(['Manchester City', 'Arsenal']).get('Manchester City')).toBe('Man');
  });

  it('never gives two clubs of one listone the same name', () => {
    const names = [
      'Manchester City', 'Manchester United', 'Bayern Monaco', 'Bayer Leverkusen',
      'Borussia Dortmund', 'Borussia Monchengladbach', 'Atletico Madrid', 'Athletic Bilbao',
      'Atalanta', 'Inter', 'AC Milan', 'AS Roma',
    ];
    const short = shortNames(names);
    expect(short.size).toBe(names.length);
    expect(new Set(short.values()).size).toBe(names.length);
  });

  it('gives a name of one word alone its own letters', () => {
    // Two clubs spelled the same in their first word and with no second word cannot be told apart, and
    // the function must still answer for both rather than dropping one.
    const short = shortNames(['Genoa', 'Genoa CFC']);
    expect(short.size).toBe(2);
  });
});
