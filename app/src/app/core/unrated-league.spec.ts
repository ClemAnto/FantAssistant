import { describe, expect, it } from 'vitest';

import { MatchCell, OwnLeagueRow, Platform, PlayerRow, promoteUnrated } from './players-store';

/**
 * LE PARTITE DI CAMPIONATO CHE LA PIATTAFORMA NON HA VOTATO (27/09/2026, «mancano le partite delle
 * vecchie stagioni del Bournemouth»): EuroLeghe non aveva il Bournemouth nel perimetro fra il 2020 e il
 * 2026, quindi i voti tacciono e il livello per-partita no. Questi test fissano le tre guardie e il
 * criterio di copertura, che e' per (partita, club) e mai per nome.
 */

const cell = (over: Partial<MatchCell> = {}): MatchCell =>
  ({
    kind: 'other_league',
    state: 'played',
    competition: 'premier_league',
    competitionLabel: 'Premier League',
    matchday: null,
    date: '2025-09-13',
    vote: 6.5,
    voteSynthetic: true,
    providerRating: 7.1,
    minutes: 90,
    team: 'Bournemouth',
    opponent: 'Brighton',
    matchId: 'm1',
    matchClub: 'Bournemouth',
    ...over,
  }) as MatchCell;

const own = (fcId: number, over: Partial<MatchCell>, realMd = 4, season = '2025-26'): OwnLeagueRow => ({
  fcId,
  season,
  cell: cell(over),
  realMd,
});

const rated = (matchId: string, matchClub: string): MatchCell =>
  ({ kind: 'league', matchday: 5, matchId, matchClub } as MatchCell);

const rosters = (ids: number[]): Map<Platform, PlayerRow[]> =>
  new Map([['euro', ids.map((fcId) => ({ fcId }) as PlayerRow)]]);

/** Euro round 5 bundles Premier round 4; round 6 bundles round 5; there is no round for real 6. */
const calendar = new Map([
  ['2025-26|5|premier_league', 4],
  ['2025-26|6|premier_league', 5],
]);

/** A euro season whose last rated round is 6, rated for one Arsenal man at round 5. */
const league = () =>
  new Map([['euro|2025-26', new Map([[1, new Map([[5, rated('m1', 'Arsenal')], [6, rated('m9', 'Arsenal')]])]])]]);

describe('promoteUnrated', () => {
  it('mette la partita di un club fuori perimetro sulla giornata EuroLeghe che la impacchetta', () => {
    const built = league();
    promoteUnrated(built, [own(2, {})], rosters([1, 2]), calendar);
    const got = built.get('euro|2025-26')!.get(2)!.get(5)!;
    expect(got.kind).toBe('league');
    expect(got.matchday).toBe(5);
    expect(got.state).toBe('played');
    expect(got.voteSynthetic).toBe(true);
  });

  it('non tocca un club che i voti coprono: la coppia (partita, club) e non il nome della partita', () => {
    const built = league();
    // Arsenal - Bournemouth e' coperta per l'Arsenal: il Bournemouth resta scoperto e l'Arsenal no.
    promoteUnrated(built, [own(2, {}), own(3, { matchClub: 'Arsenal', team: 'Arsenal' })], rosters([1, 2, 3]), calendar);
    expect(built.get('euro|2025-26')!.get(2)?.get(5)).toBeDefined();
    expect(built.get('euro|2025-26')!.get(3)).toBeUndefined();
  });

  it('lascia alle assenze chi era solo in distinta, e non oltre l\'ultima giornata votata', () => {
    const built = league();
    promoteUnrated(
      built,
      [own(2, { minutes: null, providerRating: null, vote: null }), own(4, {}, 99)],
      rosters([1, 2, 4]),
      new Map([...calendar, ['2025-26|7|premier_league', 99]]),
    );
    expect(built.get('euro|2025-26')!.get(2)).toBeUndefined();
    expect(built.get('euro|2025-26')!.get(4)).toBeUndefined();
  });

  it('non inventa una colonna per una giornata vera che il calendario della piattaforma non contiene', () => {
    const built = league();
    promoteUnrated(built, [own(2, {}, 6)], rosters([1, 2]), calendar);
    expect(built.get('euro|2025-26')!.get(2)).toBeUndefined();
  });

  it('solo per chi e\' sul listone di QUELLA piattaforma, e solo nella sua stagione', () => {
    const built = league();
    promoteUnrated(built, [own(7, {}), own(2, {}, 4, '2024-25')], rosters([1, 2]), calendar);
    expect(built.get('euro|2025-26')!.get(7)).toBeUndefined();
    expect(built.get('euro|2025-26')!.get(2)).toBeUndefined();
  });
});
