import { describe, expect, it } from 'vitest';

import { OddsMan, OddsMatch, codeNames, joinOdds, matchFor, parseOdds, sameClub, scorerOf } from './bookmaker-odds';

const P = (name: string, price: number) => ({ name, price, prob: 1 / price, books: 12, min: price - 0.2, max: price + 0.2 });

const GEN_FIO: OddsMatch = {
  league: 'serie_a',
  match: 'Genoa v Fiorentina',
  kickoff: '2026-10-10T13:00:00Z',
  taken: '2026-10-08T19:00:00Z',
  home: 'Genoa CFC',
  away: 'ACF Fiorentina',
  homeShort: 'GEN',
  awayShort: 'FIO',
  goal: [P('Mateo Pellegrino', 3.14), P('Beto', 3.07), P('Junior Messias', 4.1), P('Lorenzo Pellegrini', 6), P('Marco Pellegrini', 7)],
  cleanSheet: { home: { price: 3.68, prob: 0.27, books: 4, min: 3.5, max: 3.9 }, away: { price: 2.81, prob: 0.35, books: 4, min: 2.7, max: 2.9 } },
};

const INTER_PARMA: OddsMatch = { ...GEN_FIO, match: 'Inter Milan v Parma', home: 'Inter Milan', away: 'Parma Calcio 1913', homeShort: 'INT', awayShort: 'PAR', goal: [] };

describe('club spellings', () => {
  it('reads the first meaningful word, so «Inter Milan» is not Milan', () => {
    expect(sameClub('ACF Fiorentina', 'Fiorentina')).toBe(true);
    expect(sameClub('Inter Milan', 'Inter')).toBe(true);
    expect(sameClub('Inter Milan', 'Milan')).toBe(false);
    expect(sameClub('AC Milan', 'Milan')).toBe(true);
    expect(sameClub('Racing Club De Lens', 'Lens')).toBe(true);
  });
});

const man = (id: number, name: string, club: string, match: string, home: boolean | null, keeper = false): OddsMan => ({ id, name, club, match, home, keeper });

describe('matchFor', () => {
  it('finds a match by Leghe codes, by club name, or by its men alone', () => {
    expect(matchFor([INTER_PARMA, GEN_FIO], [man(1, 'Leali N.', 'Fiorentina', 'GEN-FIO', false, true)])).toBe(GEN_FIO);
    // One code that fits, a club spelled in Italian, and his name among the scorers: enough.
    expect(matchFor([INTER_PARMA, GEN_FIO], [man(1, 'Beto', 'Genova', 'GEN-FLO', true)])).toBe(GEN_FIO);
    expect(matchFor([INTER_PARMA], [man(1, 'Leao R.', 'Milan', 'MIL-JUV', true)])).toBeNull();
  });
});

describe('the fixture is Leghe\u2019s', () => {
  const later: OddsMatch = { ...GEN_FIO, match: 'Fiorentina v Como', home: 'ACF Fiorentina', away: 'Como 1907', homeShort: 'FIO', awayShort: 'COM', kickoff: '2026-10-16T18:45:00Z', goal: [] };

  it('reads a 3-letter code against the short name, a word or the initials', () => {
    expect(codeNames('TOU', 'TFC', 'Toulouse FC')).toBe(true);
    expect(codeNames('MAN', 'LEM', 'Le Mans FC')).toBe(true);
    expect(codeNames('PSG', 'PAR', 'Paris Saint Germain')).toBe(true);
    expect(codeNames('SGE', 'SGE', 'Eintracht Frankfurt')).toBe(true);
    expect(codeNames('BAY', 'BMU', 'Augsburg')).toBe(false);
  });

  it('prices the match Leghe names, even when the club plays an earlier one first', () => {
    // Leghe says Fiorentina-Como at home: the later fixture is the one this matchday counts.
    const keeper = man(9, 'De Gea D.', 'Fiorentina', 'FIO-COM', true, true);
    expect(matchFor([GEN_FIO, later], [keeper])?.match).toBe('Fiorentina v Como');
    // And Genoa-Fiorentina away when that is the fixture Leghe names.
    const other = man(10, 'De Gea D.', 'Fiorentina', 'GEN-FIO', false, true);
    expect(matchFor([later, GEN_FIO], [other])?.match).toBe('Genoa v Fiorentina');
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
    const odds = joinOdds([GEN_FIO, INTER_PARMA], [
      man(1, 'Leali N.', 'Genoa', 'GEN-FIO', true, true),
      man(2, 'Beto', 'Genoa', 'GEN-FIO', true),
      man(3, 'De Gea D.', 'Fiorentina', 'GEN-FIO', false, true),
    ]);
    expect(odds.get(1)?.kind).toBe('clean-sheet');
    expect(odds.get(1)?.price).toBe(3.68);
    expect(odds.get(2)?.price).toBe(3.07);
    expect(odds.get(3)?.price).toBe(2.81);
  });

  it('parses the Sheet payload and refuses another shape', () => {
    expect(parseOdds({ matches: [GEN_FIO] })?.[0].goal).toHaveLength(5);
    expect(parseOdds({ round: 6, clubs: {} })).toBeNull();
  });
});
