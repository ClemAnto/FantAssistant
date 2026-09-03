import { describe, expect, it } from 'vitest';

import { LeagueCalendar } from './keeper-pairs';
import { outWindow, outWindowNote } from './injury-window';

/** Un campionato finto di due club, una giornata a settimana, cosi' le date sono contabili a occhio. */
function calendar(rounds = 10): LeagueCalendar {
  const clubs = [
    { key: 'aaa', name: 'Alfa', fcClubId: 1, elo: 1500 },
    { key: 'bbb', name: 'Beta', fcClubId: 2, elo: 1500 },
  ];
  const matches = Array.from({ length: rounds }, (_, at) => {
    const day = new Date(Date.UTC(2026, 8, 6 + at * 7)).toISOString().slice(0, 10);
    return [at + 1, day, at % 2 ? 'aaa' : 'bbb', at % 2 ? 'bbb' : 'aaa', 0, null, null] as const;
  });
  return new LeagueCalendar('serie_a', rounds, false, clubs, matches as never, 75, null);
}

describe('la finestra di un infortunio', () => {
  it('conta le giornate del SUO club e non i giorni', () => {
    // Giornate: 06/09, 13/09, 20/09, 27/09, 04/10 ... Rientro il 30/09 -> perde le prime quattro.
    const window = outWindow({
      calendar: calendar(),
      club: 'Alfa',
      today: '2026-09-05',
      until: '2026-09-30',
    });
    expect(window).toEqual({
      until: '2026-09-30',
      lost: 4,
      playable: 6,
      remaining: 10,
      share: 0.6,
    });
  });

  it('conta il denominatore da OGGI: le giornate gia\' giocate le hanno perse tutti', () => {
    // Stesso rientro, ma si guarda il 21/09: TRE giornate sono passate (06, 13, 20) e non sono sue
    // da perdere. Restano sette, e di quelle ne salta una sola.
    const window = outWindow({
      calendar: calendar(),
      club: 'Alfa',
      today: '2026-09-21',
      until: '2026-09-30',
    });
    expect(window).toMatchObject({ lost: 1, playable: 6, remaining: 7 });
  });

  it('non riprezza quello che non sa contare, e i quattro silenzi sono diversi da uno zero', () => {
    const book = calendar();
    const base = { calendar: book, club: 'Alfa', today: '2026-09-05' };
    // nessuna data di rientro
    expect(outWindow({ ...base, until: null })).toBeNull();
    // un rientro gia' passato
    expect(outWindow({ ...base, until: '2026-09-01' })).toBeNull();
    // un club che il calendario non conosce - «vuoto = ignoto», non una quota media
    expect(outWindow({ ...base, club: 'Gamma', until: '2026-09-30' })).toBeNull();
    // nessun calendario nel pacchetto
    expect(outWindow({ ...base, calendar: null, until: '2026-09-30' })).toBeNull();
  });

  it('non e\' una finestra se non perde neanche una giornata', () => {
    // Rientro prima della prossima partita del club: c\'e\' una data, ma non costa niente.
    expect(
      outWindow({ calendar: calendar(), club: 'Alfa', today: '2026-09-05', until: '2026-09-06' }),
    ).toBeNull();
  });

  it('la nota dice il conto e non la sola quota', () => {
    const window = outWindow({
      calendar: calendar(),
      club: 'Alfa',
      today: '2026-09-05',
      until: '2026-09-30',
    })!;
    const note = outWindowNote(window, 'Tizio');
    expect(note).toContain('Tizio');
    expect(note).toContain('30/09/2026');
    expect(note).toContain('4 giornate');
    expect(note).toContain('10');
    expect(note).toContain('6');
  });
});
