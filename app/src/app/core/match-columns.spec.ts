import { describe, expect, it } from 'vitest';

import { CalendarFile, CalendarRow, leagueCalendarFrom } from './keeper-pairs';
import { upcomingColumn, upcomingFor, withUpcoming } from './next-match';
import { ColumnSlot, MatchCell, MatchTable, PlayerLine, dropUnnamed } from './players-store';

/**
 * L'ASSE della tabella delle ultime partite: cosa si rifiuta di disegnare, e la colonna del futuro.
 *
 * Due richieste dell'operatore del 15/09/2026 sulla vista Squadre - «quando i dati sono corrotti o
 * incompleti, non visualizzarli» e «mostriamo sempre una colonna con la prossima partita da giocare
 * della squadra» - che sono la stessa domanda vista dai due capi: di quale partita una colonna parla.
 */

const column = (key: string, over: Partial<ColumnSlot> = {}): ColumnSlot => ({
  key,
  label: key,
  detail: null,
  score: null,
  outcome: null,
  sides: null,
  shape: null,
  formation: null,
  matchId: null,
  matchClub: null,
  divider: null,
  breakKind: null,
  bench: null,
  unnamed: false,
  upcoming: false,
  date: null,
  kind: null,
  title: key,
  ...over,
});

const line = (fcId: number, cells: (MatchCell | null)[]): PlayerLine =>
  ({ fcId, name: `uomo ${fcId}`, cells }) as unknown as PlayerLine;

const cell = (vote: number): MatchCell => ({ vote } as MatchCell);

const table = (columns: ColumnSlot[], rows: (MatchCell | null)[][]): MatchTable => ({
  columns,
  lines: rows.map((cells, at) => line(at + 1, cells)),
});

describe('dropUnnamed', () => {
  it('toglie la colonna che non sa dire quale partita è, E le sue celle', () => {
    // Le due metà nascono dallo stesso asse: togliere una colonna dalle sole intestazioni farebbe
    // scivolare ogni voto di una posizione, che è il difetto degli 84px del 20/08 un piano più sotto.
    const got = dropUnnamed(
      table(
        [column('4', { unnamed: true }), column('3'), column('2')],
        [[cell(6), cell(6.5), cell(5.5)], [null, cell(7), null]],
      ),
    );
    expect(got.columns.map((one) => one.key)).toEqual(['3', '2']);
    expect(got.lines[0].cells).toEqual([cell(6.5), cell(5.5)]);
    expect(got.lines[1].cells).toEqual([cell(7), null]);
  });

  it('non tocca niente dove ogni colonna sa di che partita parla', () => {
    // Uno zero è un risultato: il caso normale è che non ci sia niente da togliere, e allora la
    // tabella torna com'era invece di essere ricostruita.
    const one = table([column('3'), column('2')], [[cell(6), cell(6)]]);
    expect(dropUnnamed(one)).toBe(one);
  });

  it('una colonna SENZA celle non è una colonna incompleta', () => {
    // «Vuoto = ignoto»: una giornata che questo club non ha giocato resta una giornata nuda, con il suo
    // numero. Quella che si toglie è una partita GIOCATA di cui manca il tabellino.
    const got = dropUnnamed(table([column('3'), column('2')], [[null, null]]));
    expect(got.columns.length).toBe(2);
  });
});

// ------------------------------------------------------------------ la prossima partita

const row = (round: number, date: string, home: string, away: string): CalendarRow =>
  [round, date, home, away, 100, 0.4, 0.2];

const file = (matches: CalendarRow[]): CalendarFile => ({
  season: '2026-27',
  elo_year: '2026',
  observed_on: '2026-09-01',
  easy_margin: 200,
  easy_probability: 0.3002,
  home_advantage: 35,
  clean_sheet: { intercept: -1.1, slope_per_100: 0.35, sample: 5354, leagues: ['serie_a'],
                 at_margin: 0.3 },
  leagues: {
    serie_a: {
      rounds: 38,
      unclassified: 0,
      clean_sheet_fitted: true,
      clubs: [['atalanta', 'Atalanta'], ['cagliari', 'Cagliari'], ['genoa', 'Genoa']].map(
        ([key, name], at) => ({ key, name, fc_club_id: at + 1, elo: 1700 }),
      ),
      columns: ['round', 'date', 'home', 'away', 'edge_home', 'cs_home', 'cs_away'],
      matches,
    },
  },
});

const calendar = leagueCalendarFrom(
  file([
    row(4, '2026-09-12', 'atalanta', 'cagliari'),
    row(5, '2026-09-20', 'genoa', 'atalanta'),
    row(6, '2026-09-27', 'atalanta', 'genoa'),
  ]),
  'serie_a',
)!;

describe('LeagueCalendar.next', () => {
  it('è la prima per DATA fra quelle che restano, non quella col numero più basso', () => {
    // Con un rinvio la 16a si gioca dopo la 20a: «la prossima» è una domanda sul calendario e non
    // sulla numerazione - è la regola di casa «l'unità è la PARTITA, mai la giornata».
    const shuffled = leagueCalendarFrom(
      file([
        row(20, '2026-09-20', 'genoa', 'atalanta'),
        row(16, '2026-10-04', 'atalanta', 'cagliari'),
      ]),
      'serie_a',
    )!;
    expect(shuffled.next('Atalanta', '2026-09-16')?.round).toBe(20);
  });

  it('la partita di OGGI è ancora da giocare', () => {
    // Di un calendario si sa il giorno e non l'ora: trattarla come passata la nasconderebbe proprio il
    // giorno in cui la si aspetta.
    expect(calendar.next('Atalanta', '2026-09-20')?.round).toBe(5);
  });

  it('a stagione finita, e per un club che non è qui, risponde NULL invece di inventare', () => {
    expect(calendar.next('Atalanta', '2027-06-01')).toBeNull();
    expect(calendar.next('Inter', '2026-09-16')).toBeNull();
  });
});

describe('la colonna della prossima partita', () => {
  it('mette in casa per prima e non dà nessun gol a nessuno dei due', () => {
    // La testa la legge come tutte le altre (`sides`), e i gol a null la tabella li stampa già come
    // `·`: il risultato non c'è perché la partita non c'è stata, e non perché sia zero a zero.
    const next = calendar.next('Atalanta', '2026-09-16')!;
    const got = upcomingColumn(next, 'Atalanta');
    expect(got.sides?.map((one) => one.name)).toEqual(['Gen', 'Ata']);
    expect(got.sides?.every((one) => one.goals === null)).toBe(true);
    expect(got.outcome).toBeNull();
    expect(got.upcoming).toBe(true);
    expect(got.detail).toBe('20/09');
    expect(got.title).toContain('Giornata 5');
  });

  it('mette la maiuscola solo dove il calendario non ha un nome, e non la tocca dove ce l’è', () => {
    // Fuori dal perimetro di un listone il calendario ripiega sulla sua CHIAVE (`elche`): in una testa
    // fatta di `Juv`, `Ata`, `Nap` un `elc` minuscolo si legge come un difetto. La maiuscola è
    // presentazione; il nome che il toolkit ha già risolto resta esattamente com'è.
    const other = leagueCalendarFrom(
      file([row(5, '2026-09-20', 'elche', 'atalanta')]),
      'serie_a',
    )!;
    expect(upcomingColumn(other.next('Atalanta', '2026-09-16')!, 'Atalanta').title).toContain('Elche');
    // `Cagliari` è già risolto: nessuno lo riscrive.
    expect(upcomingColumn(calendar.next('Cagliari', '2026-09-01')!, 'Cagliari').title)
      .toContain('Atalanta - Cagliari');
  });

  it('non promette il click che apre la formazione', () => {
    // La colonna è cliccabile solo con `matchId` E `matchClub`: una partita che nessuno ha giocato non
    // ha un undici da disegnare, e un bersaglio che non risponde è peggio di nessun bersaglio.
    const got = upcomingColumn(calendar.next('Atalanta', '2026-09-16')!, 'Atalanta');
    expect(got.matchId).toBeNull();
    expect(got.matchClub).toBeNull();
  });

  it('sta DAVANTI a tutte e porta una cella vuota a ogni riga', () => {
    const one = table([column('4'), column('3')], [[cell(6), cell(6.5)], [cell(5), null]]);
    const got = withUpcoming(one, upcomingColumn(calendar.next('Atalanta', '2026-09-16')!, 'Atalanta'));
    expect(got.columns[0].upcoming).toBe(true);
    expect(got.lines.every((row) => row.cells.length === got.columns.length)).toBe(true);
    expect(got.lines.map((row) => row.cells[0])).toEqual([null, null]);
  });

  it('senza calendario, senza club o a stagione finita non si disegna niente', () => {
    // Non si inventa una partita che il calendario non porta: una testa vuota si legge come un guasto.
    const one = table([column('4')], [[cell(6)]]);
    expect(upcomingFor(null, 'Atalanta', '2026-09-16')).toBeNull();
    expect(upcomingFor(calendar, null, '2026-09-16')).toBeNull();
    expect(upcomingFor(calendar, 'Atalanta', '2027-06-01')).toBeNull();
    expect(withUpcoming(one, null)).toBe(one);
  });
});
