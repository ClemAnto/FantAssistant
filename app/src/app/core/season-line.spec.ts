import { MatchCell } from './players-store';
import { seasonLineFromMatches } from './season-line';

const cell = (over: Partial<MatchCell> = {}): MatchCell => ({
  kind: 'league',
  state: 'played',
  injury: null,
  role: 'A',
  competition: 'premier_league',
  competitionLabel: 'Premier League',
  matchday: 1,
  date: '2025-08-23',
  vote: 6,
  voteSynthetic: true,
  providerRating: 6.9,
  fantavoto: 6,
  goals: 0,
  assists: 0,
  assistsSetPiece: 0,
  penScored: 0,
  penMissed: 0,
  penSaved: 0,
  ownGoals: 0,
  goalsConceded: null,
  xg: null,
  xa: null,
  yellows: 0,
  reds: 0,
  minutes: 90,
  started: true,
  team: 'Bournemouth',
  opponent: 'Brentford',
  home: false,
  goalsFor: 1,
  goalsAgainst: 0,
  shape: null,
  formation: null,
  matchId: null,
  matchClub: null,
  ...over,
});

describe('la stagione ricostruita dalle partite', () => {
  it('conta le presenze A VOTO, le due medie sui loro denominatori e i gol coi rigori', () => {
    const line = seasonLineFromMatches(
      [
        cell({ vote: 7, fantavoto: 10, goals: 1 }),
        cell({ vote: 6, fantavoto: 7, assists: 1 }),
        cell({ vote: 6.5, fantavoto: 9.5, penScored: 1 }),
        // uno spezzone senza voto non e' una presenza a voto
        cell({ vote: null, fantavoto: null, minutes: 8 }),
      ],
      '2025-26',
    );
    expect(line?.pv).toBe(3);
    expect(line?.mv).toBeCloseTo(6.5, 6);
    expect(line?.fm).toBeCloseTo(26.5 / 3, 6);
    expect(line?.goals).toBe(2);
    expect(line?.assists).toBe(1);
    expect(line?.matches).toBe(4);
    expect(line?.synthetic).toBe(true);
  });

  it('non conta coppe, amichevoli ne partite non giocate', () => {
    const line = seasonLineFromMatches(
      [
        cell({ vote: 7 }),
        cell({ kind: 'cup', vote: 8, fantavoto: 11 }),
        cell({ kind: 'friendly', vote: 8, fantavoto: 11 }),
        cell({ state: 'bench', vote: null, fantavoto: null, minutes: null }),
      ],
      '2025-26',
    );
    expect(line?.pv).toBe(1);
    expect(line?.mv).toBe(7);
  });

  it('un campionato di un altro paese e un campionato', () => {
    const line = seasonLineFromMatches([cell({ kind: 'other_league', vote: 6.5 })], '2025-26');
    expect(line?.pv).toBe(1);
  });

  it('senza nessun voto non inventa una riga: vuoto = ignoto', () => {
    expect(seasonLineFromMatches([], '2025-26')).toBeNull();
    expect(seasonLineFromMatches([cell({ kind: 'cup', vote: 7 })], '2025-26')).toBeNull();
  });

  it('per un portiere porta i gol subiti e le porte inviolate', () => {
    const line = seasonLineFromMatches(
      [cell({ role: 'P', goalsConceded: 0 }), cell({ role: 'P', goalsConceded: 2 })],
      '2025-26',
    );
    expect(line?.conceded).toBe(2);
    expect(line?.cleanSheets).toBe(1);
  });
});
