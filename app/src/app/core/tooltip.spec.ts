import { describe, expect, it } from 'vitest';

import {
  ANCHOR_HINT,
  RATING_HINT,
  RATING_KEYS,
  STAR_SCALE_HINT,
} from './player-ratings';
import { TOOLTIP_MAX, short } from './tooltip';

/**
 * A tooltip is at most a couple of lines (the operator's rule, 15/08/2026), and it is a TEST and not a
 * promise: these strings grow one clause at a time, and nobody notices the day they stop being readable.
 * The long version is not lost - it lives in «Come si leggono queste colonne», under the table.
 */
describe('tooltip length', () => {
  const hints: Record<string, string> = {
    ...Object.fromEntries(RATING_KEYS.map((key) => [`RATING_HINT.${key}`, RATING_HINT[key]])),
    STAR_SCALE_HINT,
    ANCHOR_HINT,
  };

  it('keeps every hint the app hovers within two lines', () => {
    const tooLong = Object.entries(hints).filter(([, text]) => text.length > TOOLTIP_MAX);
    // Report WHAT was examined: an audit that checks nothing also finds nothing. Sei da quando la
    // COSTANZA non è più una colonna (operatore, 17/08/2026) ma un simbolo accanto ai Voti: erano sette.
    expect(Object.keys(hints).length).toBeGreaterThanOrEqual(6);
    expect(tooLong.map(([name, text]) => `${name} (${text.length})`)).toEqual([]);
  });

  it('says the sentence was cut instead of ending mid-word', () => {
    const cut = short('una frase lunghissima che non entra in nessun modo dentro il limite', 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/ …$/);
  });

  it('leaves a sentence that already fits exactly as it is', () => {
    expect(short('corta', 20)).toBe('corta');
  });
});
