import { describe, expect, it } from 'vitest';

import { CupExposure, cupMark, windowFromNote } from './player-cup';

const doan: CupExposure = {
  cup: "Coppa d'Asia 2027",
  window: '07/01-05/02',
  country: 'Japan',
  capped: true,
};

describe('cupMark', () => {
  it('names the tournament, its window and the country, and says WHICH claim it is', () => {
    const mark = cupMark(doan)!;
    expect(mark.flag).toBe('intl_cup');
    expect(mark.note).toContain("Coppa d'Asia 2027");
    expect(mark.note).toContain('07/01-05/02');
    expect(mark.note).toContain('Japan');
    // «nazionale» and «convocabile» are two different claims, and on CAF they are worth two different
    // coefficients (0.35 against 0.20) - so the tooltip must never blur them.
    expect(mark.note).toContain('nazionale');
    expect(cupMark({ ...doan, capped: false })!.note).toContain('convocabile');
  });

  it('carries NO round count, because a round belongs to a calendar the mark does not know', () => {
    // One mark per player, two calendars: the same Asian Cup is 4 Serie A rounds and 3.3 euro ones. The
    // number therefore lives in the column, which knows its platform.
    expect(cupMark(doan)!.note).not.toMatch(/\d+([.,]\d+)?\s*giornate (nella|attese)/);
  });

  it('is null when the sheet declares nothing: no cup is the normal state', () => {
    expect(cupMark(null)).toBeNull();
    expect(cupMark({ ...doan, cup: '' })).toBeNull();
    // a country the sheet did not fill is «ignoto» and cannot produce a mark
    expect(cupMark({ ...doan, country: '' })).toBeNull();
  });

  it('reads the window out of the toolkit\'s own note instead of rebuilding it', () => {
    expect(windowFromNote("Coppa d'Asia 2027 (07/01-05/02): Japan, nazionale · 4.0 giornate"))
      .toBe('07/01-05/02');
    expect(windowFromNote(null)).toBeNull();
    expect(windowFromNote('nothing dated here')).toBeNull();
  });
});
