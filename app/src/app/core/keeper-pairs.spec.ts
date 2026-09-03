import { describe, expect, it } from 'vitest';

import {
  CalendarFile,
  CalendarRow,
  calendarBookFrom,
  coverGrid,
  leagueCalendarFrom,
  pairCover,
  rankPairs,
} from './keeper-pairs';

/**
 * Gli accoppiamenti fra portieri: quello che il conto deve fare, e le cinque cose che deve NON fare -
 * contare una giornata due volte, contare una giornata che nessuno gioca, sbagliare il verso del
 * vantaggio in trasferta, inventare una probabilita' dove il campionato non ne ha una, e sommare un
 * club con se stesso.
 */

const MARGIN = 200;

/** `[round, date, home, away, edgeHome, csHome, csAway]`, l'ordine che scrive il toolkit. */
const match = (
  round: number,
  home: string,
  away: string,
  edge: number | null,
  csHome: number | null = null,
  csAway: number | null = null,
): CalendarRow => [round, `2026-09-0${(round % 9) + 1}`, home, away, edge, csHome, csAway];

const file = (
  matches: CalendarRow[],
  options: { fitted?: boolean; clubs?: [string, string][] } = {},
): CalendarFile => ({
  season: '2026-27',
  elo_year: '2026',
  observed_on: '2026-09-01',
  easy_margin: MARGIN,
  home_advantage: 14.5,
  clean_sheet: {
    intercept: -1.104293,
    slope_per_100: 0.351375,
    sample: 5354,
    leagues: ['serie_a'],
    at_margin: 0.4009,
  },
  leagues: {
    serie_a: {
      rounds: 38,
      unclassified: 0,
      clean_sheet_fitted: options.fitted ?? true,
      clubs: (
        options.clubs ?? [
          ['inter', 'Inter'],
          ['lecce', 'Lecce'],
          ['como', 'Como'],
        ]
      ).map(([key, name], at) => ({ key, name, fc_club_id: at + 1, elo: 1700 })),
      columns: ['round', 'date', 'home', 'away', 'edge_home', 'cs_home', 'cs_away'],
      matches,
    },
  },
});

const calendarOf = (
  matches: CalendarRow[],
  options?: { fitted?: boolean; clubs?: [string, string][] },
) => leagueCalendarFrom(file(matches, options), 'serie_a')!;

describe('LeagueCalendar', () => {
  it('gira il vantaggio per chi gioca in trasferta invece di ricalcolarlo', () => {
    // Una sottrazione sola dice tutt'e due i lati: il vantaggio in trasferta e' esattamente l'opposto.
    // Se qualcuno lo ricalcolasse qui sarebbe una seconda definizione della stessa cosa.
    const calendar = calendarOf([match(1, 'inter', 'lecce', 402.4)]);
    expect(calendar.window('Inter', 1, 38)[0]).toMatchObject({ edge: 402.4, easy: true, home: true });
    expect(calendar.window('Lecce', 1, 38)[0]).toMatchObject({ edge: -402.4, easy: false, home: false });
  });

  it("nomina l'avversario col NOSTRO nome canonico, non con la chiave", () => {
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300)]);
    expect(calendar.window('Inter', 1, 38)[0].opponent).toBe('Lecce');
  });

  it('non chiama facile una partita di cui manca un livello: vuoto e’ ignoto, mai zero', () => {
    const calendar = calendarOf([match(1, 'inter', 'lecce', null)]);
    expect(calendar.window('Inter', 1, 38)[0]).toMatchObject({ edge: null, easy: false });
  });

  it('ritaglia sulla finestra della competizione e non sull’intera stagione', () => {
    const calendar = calendarOf([
      match(1, 'inter', 'lecce', 300),
      match(2, 'como', 'inter', -300),
      match(3, 'inter', 'como', 300),
    ]);
    expect(calendar.window('Inter', 2, 3).map((one) => one.round)).toEqual([2, 3]);
  });
});

describe('pairCover', () => {
  it('conta la giornata UNA volta anche se sono facili tutt’e due', () => {
    // «Almeno uno dei due»: due partite facili nella stessa giornata restano una giornata coperta.
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300), match(1, 'como', 'lecce', 300)]);
    const cover = pairCover(calendar.window('Inter', 1, 38), calendar.window('Como', 1, 38));
    expect(cover.facili).toBe(1);
    expect(cover.matchdays).toBe(1);
  });

  it('non conta una giornata che nessuno dei due gioca', () => {
    // Il denominatore sono le giornate che i due hanno DAVVERO, non `to - from`: un turno di riposo
    // non e' una giornata che qualcuno ha mancato di coprire.
    const calendar = calendarOf([match(5, 'inter', 'lecce', 300)]);
    const cover = pairCover(calendar.window('Inter', 1, 10), calendar.window('Como', 1, 10));
    expect(cover.matchdays).toBe(1);
  });

  it('unisce le probabilita’ invece di sommarle', () => {
    // «Almeno uno tiene la porta inviolata» e' 1 - (1-pA)(1-pB), non pA + pB, che passerebbe 1.
    const calendar = calendarOf([
      match(1, 'inter', 'lecce', 300, 0.6, 0.1),
      match(1, 'como', 'inter', -300, 0.1, 0.6),
    ]);
    const cover = pairCover(calendar.window('Inter', 1, 1), calendar.window('Como', 1, 1));
    expect(cover.covered).toBeCloseTo(1 - 0.4 * 0.9, 6);
  });

  it('tace sulla copertura attesa dove il campionato non ha una probabilita’ stimata', () => {
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300)], { fitted: false });
    const cover = pairCover(calendar.window('Inter', 1, 1), calendar.window('Lecce', 1, 1));
    expect(cover.facili).toBe(1);
    expect(cover.covered).toBeNull();
  });

  it('un club con se stesso e’ il club DA SOLO, non la sua partita contata due volte', () => {
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300, 0.6, 0.1)]);
    const alone = calendar.window('Inter', 1, 1);
    const cover = pairCover(alone, alone, true);
    expect(cover.covered).toBeCloseTo(0.6, 6);
  });
});

describe('rankPairs', () => {
  const men = [{ man: 'Butez', club: 'Como' }, { man: 'Falcone', club: 'Lecce' }];

  it('ordina per le giornate FACILI, che e’ la regola dell’operatore', () => {
    const calendar = calendarOf([
      match(1, 'como', 'lecce', 300),        // facile per Como
      match(2, 'lecce', 'como', 10),         // per nessuno
    ]);
    const ranked = rankPairs(calendar, 'Inter', men, 1, 38);
    expect(ranked.map((one) => one.club)).toEqual(['Como', 'Lecce']);
    expect(ranked[0].cover.facili).toBe(1);
  });

  it('rompe il pareggio con la copertura attesa, che e’ il caso normale e non l’eccezione', () => {
    // Nessuna delle due e' facile: su una scala di 200 il conteggio pareggia a zero, e cio' che
    // distingue le due coppie e' la probabilita'.
    const calendar = calendarOf([
      match(1, 'como', 'inter', 0, 0.25, 0.25),
      match(1, 'lecce', 'inter', 0, 0.05, 0.25),
    ]);
    const ranked = rankPairs(calendar, 'Inter', men, 1, 38);
    expect(ranked.every((one) => one.cover.facili === 0)).toBe(true);
    expect(ranked[0].club).toBe('Como');
  });

  it('lascia fuori un club che il calendario non conosce invece di dargli zero', () => {
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300)]);
    const ranked = rankPairs(calendar, 'Inter', [{ man: 'X', club: 'Bayern' }], 1, 38);
    expect(ranked).toEqual([]);
  });
});

describe('coverGrid', () => {
  it('e’ simmetrica, e le due meta’ sono lo STESSO oggetto', () => {
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300), match(2, 'como', 'inter', -300)]);
    const grid = coverGrid(calendar, ['Inter', 'Lecce', 'Como'], 1, 38);
    expect(grid.get('Inter')!.get('Como')).toBe(grid.get('Como')!.get('Inter'));
  });

  it('mette il club DA SOLO sulla diagonale, che e’ il paragone della sua riga', () => {
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300), match(2, 'inter', 'como', 300)]);
    const grid = coverGrid(calendar, ['Inter', 'Lecce'], 1, 38);
    expect(grid.get('Inter')!.get('Inter')!.facili).toBe(2);
    // ...e accanto a Lecce non guadagna niente, perche' Lecce non ha partite facili qui.
    expect(grid.get('Inter')!.get('Lecce')!.facili).toBe(2);
  });
});

describe('CalendarBook', () => {
  it('legge il campionato di un club dal calendario e non dai suoi giocatori', () => {
    const book = calendarBookFrom(file([match(1, 'inter', 'lecce', 300)]))!;
    expect(book.leagueOf('Inter')).toBe('serie_a');
    expect(book.leagueOf('Bayern')).toBeNull();
    expect(book.forClub('Inter')?.league).toBe('serie_a');
  });

  it('non esiste senza calendario, invece di esistere vuoto', () => {
    expect(calendarBookFrom(null)).toBeNull();
  });
});
