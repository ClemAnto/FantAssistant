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
  easy_probability: 0.3002,
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

describe('la regola di FACILE', () => {
  it('decide sulla PROBABILITA’ dove c’e’, e sull’edge dove non c’e’', () => {
    // Da 03/09/2026 la probabilita' legge anche i gol delle ultime dieci partite dei due club, quindi
    // due partite allo stesso vantaggio Elo NON sono la stessa partita: il verdetto vive sulla
    // probabilita' e l'edge resta la spiegazione. Qui l'edge e' identico e sotto la soglia dei 200
    // della finestra di prova, e a decidere sono le due probabilita'.
    const calendar = calendarOf([
      match(1, 'inter', 'lecce', 100, 0.35, 0.20),
      match(2, 'lecce', 'inter', 100, 0.25, 0.10),
    ]);
    expect(calendar.window('Inter', 1, 1)[0].easy).toBe(true);
    expect(calendar.window('Lecce', 2, 2)[0].easy).toBe(false);
  });

  it('senza probabilita’ resta sull’edge, che e’ la regola con cui il pacchetto e’ stato scritto', () => {
    // Un campionato senza logistica (e un pacchetto scritto prima della soglia) non ha una
    // probabilita': la' il verdetto e' l'edge contro il margine, esattamente come prima.
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300), match(2, 'lecce', 'inter', -300)]);
    expect(calendar.window('Inter', 1, 1)[0].easy).toBe(true);
    expect(calendar.window('Lecce', 1, 1)[0].easy).toBe(false);
  });
});

describe('coverGrid', () => {
  it('e’ simmetrica, e le due meta’ sono lo STESSO oggetto', () => {
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300), match(2, 'como', 'inter', -300)]);
    const grid = coverGrid(calendar, ['Inter', 'Lecce', 'Como'], 1, 38);
    expect(grid.get('Inter')!.get('Como')).toBe(grid.get('Como')!.get('Inter'));
  });

  it('dice DI CHI e’ ogni colonna, perche’ la casella e’ condivisa con la sua speculare', () => {
    // Il difetto che questo asserto chiude, trovato dall'operatore il 03/09/2026 su «Com + Ata»: la
    // casella si calcola una volta per la coppia (i, j) e si legge da tutt'e due i lati, quindi sotto
    // la diagonale `a` e `b` NON sono la riga e la colonna - e chi le etichettava dagli assi disegnava
    // le partite di una squadra sotto il nome dell'altra, portandosi dietro il segno di «facile».
    const calendar = calendarOf(
      [match(1, 'inter', 'lecce', 300), match(2, 'como', 'parma', 300)],
      {
        clubs: [
          ['inter', 'Inter'],
          ['lecce', 'Lecce'],
          ['como', 'Como'],
          ['parma', 'Parma'],
        ],
      },
    );
    const grid = coverGrid(calendar, ['Inter', 'Como'], 1, 38);
    const cell = grid.get('Como')!.get('Inter')!;
    expect(cell).toBe(grid.get('Inter')!.get('Como'));
    // La casella dice l'ordine vero, e in quell'ordine ogni colonna porta le partite del proprio club.
    expect([cell.clubA, cell.clubB]).toEqual(['Inter', 'Como']);
    expect(cell.rows.find((row) => row.round === 1)!.a!.opponent).toBe('Lecce');
    expect(cell.rows.find((row) => row.round === 2)!.b!.opponent).toBe('Parma');
  });

  it('mette il club DA SOLO sulla diagonale, che e’ il paragone della sua riga', () => {
    const calendar = calendarOf([match(1, 'inter', 'lecce', 300), match(2, 'inter', 'como', 300)]);
    const grid = coverGrid(calendar, ['Inter', 'Lecce'], 1, 38);
    expect(grid.get('Inter')!.get('Inter')!.facili).toBe(2);
    // ...e accanto a Lecce non guadagna niente, perche' Lecce non ha partite facili qui.
    expect(grid.get('Inter')!.get('Lecce')!.facili).toBe(2);
  });
});

describe('quanto AGGIUNGE il secondo portiere', () => {
  it('e’ l’unione meno il migliore dei due da solo, e sulla diagonale e’ zero', () => {
    // L'osservazione dell'operatore (03/09/2026): «il Napoli e la Juve, singolarmente, hanno 31
    // partite facili; il Como ne ha 22 e solo insieme al Bologna arriva a 33». Un totale non dice chi
    // lo ha portato, quindi la coppia porta anche il MARGINALE. Qui l'Inter ha due giornate facili da
    // sola, il Lecce una che l'Inter non ha: insieme 3, quindi il Lecce ne aggiunge una.
    const calendar = calendarOf([
      match(1, 'inter', 'como', 300),
      match(2, 'inter', 'lecce', 300),
      match(3, 'lecce', 'como', 300),
    ]);
    const grid = coverGrid(calendar, ['Inter', 'Lecce'], 1, 38);
    const cell = grid.get('Inter')!.get('Lecce')!;
    expect([cell.aloneA, cell.aloneB, cell.facili, cell.gain]).toEqual([2, 1, 3, 1]);
    // Un club con se stesso non aggiunge niente a se stesso: zero, e non un numero che si leggerebbe
    // come un guadagno.
    expect(grid.get('Inter')!.get('Inter')!.gain).toBe(0);
  });

  it('viaggia anche sui suggerimenti, e NON ne cambia l’ordine', () => {
    // Il primo portiere e' quello che ha cliccato, quindi il suo «da solo» e' una costante: ordinare
    // per unione o per unione-meno-una-costante e' lo stesso ordine. Detto qui perche' e' la
    // differenza fra «cambia la decisione» e «cambia la classifica».
    const calendar = calendarOf([
      match(1, 'inter', 'como', 300),
      match(2, 'lecce', 'como', 300),
      match(3, 'lecce', 'inter', 300),
    ]);
    const ranked = rankPairs(
      calendar,
      'Como',
      [{ man: 'a', club: 'Inter' }, { man: 'b', club: 'Lecce' }],
      1,
      38,
    );
    for (const one of ranked) {
      // Il MIO calendario e' lo zero, non il migliore dei due: la domanda della lista e' «quanto
      // aggiunge accanto al mio», e col massimo si risponderebbe di nascosto a «quanto aggiungo io a
      // lui», che ordina un compagno forte sotto uno debole. Trovato da questo test, non rileggendo.
      expect(one.gain).toBe(one.cover.facili - one.aloneMine);
    }
    // L'affermazione da provare non e' un ordine letterale - sarebbe un test su questo fixture - ma
    // che i due ordini COINCIDANO: `aloneMine` e' lo stesso numero per tutti, quindi ordinare per
    // unione o per guadagno da' la stessa lista.
    const byGain = [...ranked].sort(
      (left, right) => right.gain - left.gain || left.club.localeCompare(right.club, 'it'),
    );
    expect(byGain.map((one) => one.club)).toEqual(ranked.map((one) => one.club));
    expect(new Set(ranked.map((one) => one.aloneMine)).size).toBe(1);
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
