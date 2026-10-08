import { describe, expect, it } from 'vitest';

import { OddsMan, OddsMatch, codeNames, joinOdds, matchFor, parseOdds, sameClub, scorerOf } from './bookmaker-odds';

const P = (name: string, price: number) => ({ name, price, prob: 1 / price, books: 12, min: price - 0.2, max: price + 0.2 });

// Squads in the listone's spelling, and the bookmakers' scorers in theirs.
const GENOA = ['Leali N.', 'Pellegrino M.', 'Messias', 'Vitinha', 'Malinovskyi', 'Frendrup'];
const FIORENTINA = ['De Gea D.', 'Beto', 'Gudmundsson A.', 'Mandragora', 'Kean', 'Ranieri'];
const COMO = ['Butez', 'Paz N.', 'Douvikas', 'Perrone', 'Da Cunha', 'Kempf'];

const GEN_FIO: OddsMatch = {
  league: 'serie_a',
  match: 'Genoa v Fiorentina',
  kickoff: '2026-10-10T13:00:00Z',
  taken: '2026-10-08T19:00:00Z',
  home: 'Genoa CFC',
  away: 'ACF Fiorentina',
  homeShort: 'GEN',
  awayShort: 'FIO',
  goal: [
    P('Mateo Pellegrino', 3.14), P('Junior Messias', 4.1), P('Ferreira Vitinha', 4.5), P('Ruslan Malinovskyi', 6),
    P('Morten Frendrup', 9), P('Beto', 3.07), P('Albert Gudmundsson', 4.2), P('Rolando Mandragora', 7), P('Moise Kean', 2.9),
    P('Luca Ranieri', 11),
    P('Lorenzo Pellegrini', 6), P('Marco Pellegrini', 7),
  ],
  cleanSheet: { home: { price: 3.68, prob: 0.27, books: 4, min: 3.5, max: 3.9 }, away: { price: 2.81, prob: 0.35, books: 4, min: 2.7, max: 2.9 } },
};

/** Fiorentina's NEXT-ROUND fixture, inside the same capture window: the case this whole check exists for. */
const FIO_COM: OddsMatch = {
  ...GEN_FIO,
  match: 'Fiorentina v Como',
  home: 'ACF Fiorentina',
  away: 'Como 1907',
  homeShort: 'FIO',
  awayShort: 'COM',
  kickoff: '2026-10-16T18:45:00Z',
  goal: [
    P('Beto', 3), P('Albert Gudmundsson', 4), P('Moise Kean', 2.5), P('Rolando Mandragora', 7), P('Luca Ranieri', 12),
    P('Nico Paz', 3.5), P('Anastasios Douvikas', 3.2), P('Lucas Perrone', 9), P('Lucas Da Cunha', 6), P('Marc Kempf', 14),
  ],
};

const INTER_PARMA: OddsMatch = { ...GEN_FIO, match: 'Inter Milan v Parma', home: 'Inter Milan', away: 'Parma Calcio 1913', homeShort: 'INT', awayShort: 'PAR', goal: [] };

const man = (
  id: number,
  name: string,
  club: string,
  match: string,
  home: boolean | null,
  squad: string[],
  opponentSquad: string[] | null,
  keeper = false,
  opponentName: string | null = null,
): OddsMan => ({ id, name, club, match, home, keeper, squad, opponentSquad, opponentName });

describe('club spellings and codes', () => {
  it('reads the first meaningful word, so «Inter Milan» is not Milan', () => {
    expect(sameClub('ACF Fiorentina', 'Fiorentina')).toBe(true);
    expect(sameClub('Inter Milan', 'Inter')).toBe(true);
    expect(sameClub('Inter Milan', 'Milan')).toBe(false);
    expect(sameClub('AC Milan', 'Milan')).toBe(true);
    expect(sameClub('Racing Club De Lens', 'Lens')).toBe(true);
  });

  it('reads a 3-letter code against the short name, a word or the initials', () => {
    expect(codeNames('TOU', 'TFC', 'Toulouse FC')).toBe(true);
    expect(codeNames('MAN', 'LEM', 'Le Mans FC')).toBe(true);
    expect(codeNames('PSG', 'PAR', 'Paris Saint Germain')).toBe(true);
    expect(codeNames('BAY', 'BMU', 'Augsburg')).toBe(false);
  });
});

describe('matchFor: the fixture is Leghe’s, recognised by its MEN', () => {
  it('prices the match Leghe names, not the club’s earlier or later one', () => {
    // Leghe says Fiorentina-Como: both squads are in the later match, only Fiorentina's in the earlier one.
    const nextRound = man(9, 'De Gea D.', 'Fiorentina', 'FIO-COM', true, FIORENTINA, COMO, true);
    expect(matchFor([GEN_FIO, FIO_COM], [nextRound])?.match).toBe('Fiorentina v Como');
    const thisRound = man(10, 'De Gea D.', 'Fiorentina', 'GEN-FIO', false, FIORENTINA, GENOA, true);
    expect(matchFor([FIO_COM, GEN_FIO], [thisRound])?.match).toBe('Genoa v Fiorentina');
  });

  it('never takes a match on its 3-letter labels alone', () => {
    // Codes that fit both sides, and no squad of his among the scorers: refused.
    const unknown = man(1, 'Rossi', 'Genoa', 'GEN-FIO', true, ['Rossi', 'Bianchi', 'Verdi', 'Neri'], null);
    expect(matchFor([GEN_FIO], [unknown])).toBeNull();
    // A man whose club the bundle does not know at all: no evidence, no price.
    expect(matchFor([GEN_FIO], [man(2, 'Beto', 'Fiorentina', 'GEN-FIO', false, [], GENOA)])).toBeNull();
  });

  it('with no squad for the opponent, his squad plus the opponent’s name or code; otherwise nothing', () => {
    const byName = man(3, 'Beto', 'Fiorentina', 'XXX-FIO', false, FIORENTINA, null, false, 'Genoa');
    expect(matchFor([GEN_FIO, FIO_COM], [byName])?.match).toBe('Genoa v Fiorentina');
    const byCode = man(4, 'Beto', 'Fiorentina', 'GEN-FIO', false, FIORENTINA, null);
    expect(matchFor([GEN_FIO, FIO_COM], [byCode])?.match).toBe('Genoa v Fiorentina');
    // His squad is in both matches and nothing says which opponent: two candidates, no answer.
    const blind = man(5, 'Beto', 'Fiorentina', 'XXX-FIO', false, FIORENTINA, null);
    expect(matchFor([GEN_FIO, FIO_COM], [blind])).toBeNull();
    // ...but with only ONE match of his club in the window, his squad there and his club on Leghe's side: taken.
    expect(matchFor([GEN_FIO, INTER_PARMA], [blind])?.match).toBe('Genoa v Fiorentina');
    // Not when his club is on the OTHER side from the one Leghe gives.
    const wrongSide = man(6, 'Beto', 'Fiorentina', 'FIO-XXX', true, FIORENTINA, null);
    expect(matchFor([GEN_FIO, INTER_PARMA], [wrongSide])).toBeNull();
  });
});

describe('scorerOf', () => {
  it('joins «Surname I.» to «Name Surname», and refuses two candidates', () => {
    expect(scorerOf(GEN_FIO.goal, 'Pellegrino M.')?.name).toBe('Mateo Pellegrino');
    expect(scorerOf(GEN_FIO.goal, 'Beto')?.name).toBe('Beto');
    expect(scorerOf(GEN_FIO.goal, 'Pellegrini L.')?.name).toBe('Lorenzo Pellegrini');
    expect(scorerOf(GEN_FIO.goal, 'Pellegrini')).toBeNull();
    expect(scorerOf(GEN_FIO.goal, 'Nessuno X.')).toBeNull();
  });

  it('ignores accents and the letters NFD does not decompose', () => {
    expect(scorerOf([P('Kenan Yıldız', 3)], 'Yildiz K.')?.name).toBe('Kenan Yıldız');
    expect(scorerOf([P('Rasmus Højlund', 3)], 'Hojlund R.')?.name).toBe('Rasmus Højlund');
    expect(scorerOf([P('Rafael Leão', 3)], 'Leao R.')?.name).toBe('Rafael Leão');
  });
});

describe('joinOdds', () => {
  it('gives a keeper his side’s clean sheet and an outfield man his goal price', () => {
    const odds = joinOdds([GEN_FIO, INTER_PARMA, FIO_COM], [
      man(1, 'Leali N.', 'Genoa', 'GEN-FIO', true, GENOA, FIORENTINA, true),
      man(2, 'Pellegrino M.', 'Genoa', 'GEN-FIO', true, GENOA, FIORENTINA),
      man(3, 'De Gea D.', 'Fiorentina', 'GEN-FIO', false, FIORENTINA, GENOA, true),
    ]);
    expect(odds.get(1)?.kind).toBe('clean-sheet');
    expect(odds.get(1)?.price).toBe(3.68);
    expect(odds.get(2)?.price).toBe(3.14);
    expect(odds.get(3)?.price).toBe(2.81);
    expect(odds.get(3)?.match).toBe('Genoa v Fiorentina');
  });

  it('parses the Sheet payload and refuses another shape', () => {
    expect(parseOdds({ matches: [GEN_FIO] })?.[0].goal).toHaveLength(12);
    expect(parseOdds({ round: 6, clubs: {} })).toBeNull();
  });
});
