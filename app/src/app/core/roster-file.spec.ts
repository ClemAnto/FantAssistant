import { describe, expect, it } from 'vitest';

import { PlayerRow } from './players-store';
import { RosterFile, guessPlatform, matchdayFromFile, parseRosterFile } from './roster-file';

const CSV = ['$,$,$', 'Kane & ten others,10,0', 'Kane & ten others,11,0', '$,$,$', 'Piangi, Meno FC,12,1', 'Piangi, Meno FC,99,0', ''].join('\n');

const row = (fcId: number, name: string, extra: Partial<PlayerRow> = {}): PlayerRow => ({
  fcId,
  name,
  clubId: 1,
  role: 'D',
  mantra: 'Dc',
  mantraCodes: ['Dc'],
  club: 'Inter',
  league: 'serie_a',
  quoted: true,
  sold: false,
  ...extra,
});

describe('the roster export read as squads', () => {
  it('groups the lines by squad, and a comma inside a squad name stays in the name', () => {
    expect(parseRosterFile(CSV)).toEqual([
      { name: 'Kane & ten others', ids: [10, 11] },
      { name: 'Piangi, Meno FC', ids: [12, 99] },
    ]);
  });

  it('a file that is not an export gives no squad', () => {
    expect(parseRosterFile('hello\nworld')).toEqual([]);
  });

  it('the listone is the one that knows more of the ids', () => {
    const teams = parseRosterFile(CSV);
    const rows = new Map([
      ['default', [row(10, 'A')]],
      ['euro', [row(10, 'A'), row(11, 'B'), row(12, 'C')]],
    ] as const);
    expect(guessPlatform(teams, rows)).toBe('euro');
    expect(guessPlatform(teams, new Map([['default', [row(10, 'A')]]] as const))).toBe('classic');
  });
});

describe('the matchday built from the file', () => {
  const file: RosterFile = {
    fileName: 'rose.csv',
    loadedAt: '2026-10-16T10:00:00.000Z',
    teams: parseRosterFile(CSV),
    team: 'Piangi, Meno FC',
    platform: 'classic',
    game: 'mantra',
  };
  const rows = new Map([[12, row(12, 'Bastoni', { sold: true })]]);

  it('carries his squad with the bundle facts and leaves out (and counts) who the listone does not know', () => {
    const md = matchdayFromFile(file, rows, new Date())!;
    expect(md.team?.name).toBe('Piangi, Meno FC');
    expect(md.roster.map((r) => [r.fcId, r.name, r.roles, r.championship, r.transferred])).toEqual([
      [12, 'Bastoni', ['Dc'], 'ITA', true],
    ]);
    expect(md.unknown).toEqual([99]);
  });

  it('invents nothing Leghe used to serve: no competition, no deadline, no percentage, no module list', () => {
    const md = matchdayFromFile(file, rows, new Date())!;
    expect(md.competitions).toEqual([]);
    expect(md.closesAt).toBeNull();
    expect(md.roster[0].percent).toBeNull();
    expect(md.rules.game).toBe('mantra');
    expect(md.rules.modules).toEqual([]);
  });

  it('classic roles are the listone role, and no chosen squad = no matchday', () => {
    expect(matchdayFromFile({ ...file, game: 'classic' }, rows, new Date())!.roster[0].roles).toEqual(['D']);
    expect(matchdayFromFile({ ...file, team: null }, rows, new Date())).toBeNull();
  });
});
