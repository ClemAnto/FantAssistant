import { describe, expect, it } from 'vitest';

import { LeagueCalendar } from './keeper-pairs';
import { RETURN_SLIP, outWindow, outWindowNote } from './injury-window';

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
  // Il conto delle giornate si prova col MARGINE SPENTO: sono due affermazioni diverse - quante
  // giornate cadono prima di una data, e quanto si toglie in piu' di quello che la fonte dichiara -
  // e un test che le misura insieme attribuirebbe il difetto alla sbagliata.
  const counting = { calendar: calendar(), club: 'Alfa', slip: 0 };

  it('conta le giornate del SUO club e non i giorni', () => {
    // Giornate: 06/09, 13/09, 20/09, 27/09, 04/10 ... Rientro il 30/09 -> perde le prime quattro.
    const window = outWindow({ ...counting, today: '2026-09-05', until: '2026-09-30' });
    expect(window).toEqual({
      until: '2026-09-30',
      declared: '2026-09-30',
      seasonOver: false,
      source: null,
      slipDays: 0,
      lost: 4,
      playable: 6,
      remaining: 10,
      share: 0.6,
    });
  });

  it('conta il denominatore da OGGI: le giornate gia giocate le hanno perse tutti', () => {
    // Stesso rientro, ma si guarda il 21/09: TRE giornate sono passate (06, 13, 20) e non sono sue
    // da perdere. Restano sette, e di quelle ne salta una sola.
    const window = outWindow({ ...counting, today: '2026-09-21', until: '2026-09-30' });
    expect(window).toMatchObject({ lost: 1, playable: 6, remaining: 7 });
  });

  it('non riprezza quello che non sa contare, e i quattro silenzi sono diversi da uno zero', () => {
    const base = { ...counting, today: '2026-09-05' };
    // nessuna data di rientro
    expect(outWindow({ ...base, until: null })).toBeNull();
    // un rientro gia passato
    expect(outWindow({ ...base, until: '2026-09-01' })).toBeNull();
    // un club che il calendario non conosce - «vuoto = ignoto», non una quota media
    expect(outWindow({ ...base, club: 'Gamma', until: '2026-09-30' })).toBeNull();
    // nessun calendario nel pacchetto
    expect(outWindow({ ...base, calendar: null, until: '2026-09-30' })).toBeNull();
  });

  it('non e una finestra se non perde neanche una giornata', () => {
    // Rientro prima della prossima partita del club: c-e una data, ma non costa niente.
    expect(outWindow({ ...counting, today: '2026-09-05', until: '2026-09-06' })).toBeNull();
  });
});

describe('il margine di prudenza', () => {
  const base = { calendar: calendar(20), club: 'Alfa', today: '2026-09-05' };

  it('si applica a quello che RESTA dell-assenza, non alla durata dello spell', () => {
    // 60 giorni dichiarati da oggi, +25% = 15 giorni in piu-.
    const window = outWindow({ ...base, until: '2026-11-04' })!;
    expect(window.declared).toBe('2026-11-04');
    expect(window.slipDays).toBe(Math.round(60 * RETURN_SLIP));
    expect(window.until).toBe('2026-11-19');
  });

  it('toglie SEMPRE giornate, mai gliene aggiunge', () => {
    const prudent = outWindow({ ...base, until: '2026-11-04' })!;
    const declared = outWindow({ ...base, until: '2026-11-04', slip: 0 })!;
    expect(prudent.share).toBeLessThan(declared.share);
    expect(prudent.lost).toBeGreaterThan(declared.lost);
  });

  it('e PROPORZIONALE: un-assenza lunga sfora di piu- giorni di una corta', () => {
    const corta = outWindow({ ...base, until: '2026-09-25' })!;
    const lunga = outWindow({ ...base, until: '2027-01-05' })!;
    expect(lunga.slipDays).toBeGreaterThan(corta.slipDays * 3);
  });

  it('la nota dice TUTT-E DUE le date, o attribuirebbe alla fonte una data che non ha scritto', () => {
    const window = outWindow({ ...base, until: '2026-11-04' })!;
    const note = outWindowNote(window, 'Tizio');
    expect(note).toContain('Tizio');
    expect(note).toContain('04/11/2026');
    expect(note).toContain('19/11/2026');
    expect(note).toContain(String(window.slipDays));
    expect(note).toContain(`${window.lost} giornate`);
  });
});


describe('la stagione finita', () => {
  it('e una finestra COMPLETA e non un buco nei dati: quota zero, senza una data', () => {
    const window = outWindow({
      calendar: calendar(),
      club: 'Alfa',
      today: '2026-09-05',
      until: null,
      seasonOver: true,
    })!;
    expect(window.seasonOver).toBe(true);
    expect(window.until).toBeNull();
    expect(window.declared).toBeNull();
    expect(window.share).toBe(0);
    expect(window.playable).toBe(0);
    expect(window.lost).toBe(window.remaining);
  });

  it('non ha bisogno di una data, e la nota lo dice a parole', () => {
    // Il fatto piu decisivo che una fonte possa dire non nomina nessun mese: se servisse una data,
    // questa riga non produrrebbe niente proprio nel caso in cui sbagliare costa piu caro.
    const window = outWindow({
      calendar: calendar(),
      club: 'Alfa',
      today: '2026-09-05',
      until: null,
      seasonOver: true,
    })!;
    const note = outWindowNote(window, 'Tizio');
    expect(note).toContain('Tizio');
    expect(note.toUpperCase()).toContain('STAGIONE');
    expect(note).not.toContain('/');
  });

  it('senza calendario resta ignota come tutto il resto', () => {
    expect(
      outWindow({ calendar: null, club: 'Alfa', today: '2026-09-05', until: null, seasonOver: true }),
    ).toBeNull();
  });
});
