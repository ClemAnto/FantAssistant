import { describe, expect, it } from 'vitest';

import { BoardsFile } from './bundle';
import { placesFrom } from './valuation-store';

/**
 * Where the drawn elevens put their men, over a WHOLE boards file.
 *
 * The squads view asks for one club and the listone's table for all of them, and the answer must be the
 * same map: a man belongs to one board, so reading the file once is the definition and reading the club
 * on screen was only the first caller of it. What is tested is that nobody is lost by widening it, and
 * that a club the panel could not draw contributes nobody instead of an empty place.
 */
const file = (clubs: BoardsFile['clubs']): BoardsFile => ({
  sheet: 'test',
  mode: 'mantra',
  apply_rulings: true,
  clubs,
});

describe('placesFrom', () => {
  it('reads the place of every club of the file, not of one', () => {
    const places = placesFrom(
      file({
        Napoli: { lines: { P: [], D: [{ fc_id: 1, name: 'Di Lorenzo', codes: 'DR;DC', badge: 'Dd' }], M: [], T: [], A: [] } },
        Milan: { lines: { P: [], D: [], M: [{ fc_id: 2, name: 'Modric', codes: 'MC;DM', badge: 'M' }], T: [], A: [] } },
      } as unknown as BoardsFile['clubs']),
    );
    expect(places.get(1)).toBe('DR');
    expect(places.get(2)).toBe('MC');
    expect(places.size).toBe(2);
  });

  it('gives no place to a club the panel could not draw', () => {
    // An `error` board is not an empty eleven: nobody in it is «not a starter», the drawing failed.
    const places = placesFrom(
      file({
        Verona: { error: 'no shape' },
        Como: { lines: { P: [{ fc_id: 3, name: 'Butez', codes: 'GK', badge: 'Por' }], D: [], M: [], T: [], A: [] } },
      } as unknown as BoardsFile['clubs']),
    );
    expect(places.has(3)).toBe(true);
    expect(places.size).toBe(1);
  });

  it('answers with nothing when there is no file at all', () => {
    // No boards on this platform: «vuoto = ignoto», and the caller must not read a place into it.
    expect(placesFrom(null).size).toBe(0);
  });
});
