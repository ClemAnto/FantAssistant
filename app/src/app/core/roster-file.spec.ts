import { describe, expect, it } from 'vitest';

import { PlayerRow } from './players-store';
import { RosterFile, SavedRoster, guessPlatform, leagueOfFile, matchdayFromFile, mergeRosters, parseRosterFile, matchingRoster, newRosterId, readSaved } from './roster-file';

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

describe('many rosters, one per fantasquadra, merged between devices', () => {
  const entry = (key: string, updatedAt: string, extra: Partial<SavedRoster> = {}): SavedRoster => ({
    key,
    updatedAt,
    fileName: 'neuroseghe_rosters_1.csv',
    loadedAt: updatedAt,
    teams: [{ name: 'A', ids: [1] }],
    team: 'A',
    platform: 'euro',
    game: 'mantra',
    ...extra,
  });

  it('the league is the export file name prefix', () => {
    expect(leagueOfFile("'neuroseghe_rosters_1792146043476.csv")).toBe('neuroseghe');
    expect(leagueOfFile('C:/x/Lega Amici_rosters_12.csv')).toBe('Lega Amici');
  });

  it('a new squad gets a new id every time, so a name never is the key', () => {
    expect(newRosterId()).not.toBe(newRosterId());
  });

  it('a newer export finds the squad it updates by listone, league and name - and only as a default', () => {
    const stored = [entry('r-1', 't', { fileName: 'neuroseghe_rosters_1.csv', team: 'A' }), entry('r-2', 't', { team: 'B' })];
    expect(matchingRoster(stored, { platform: 'euro', fileName: "'neuroseghe_rosters_9.csv", team: 'A' })?.key).toBe('r-1');
    expect(matchingRoster(stored, { platform: 'classic', fileName: 'neuroseghe_rosters_9.csv', team: 'A' })).toBeNull();
    expect(matchingRoster(stored, { platform: 'euro', fileName: 'other_rosters_9.csv', team: 'A' })).toBeNull();
    expect(matchingRoster([{ ...stored[0], removed: true }], { platform: 'euro', fileName: 'neuroseghe_rosters_9.csv', team: 'A' })).toBeNull();
  });

  it('per key the later entry wins, a removal included, newest first', () => {
    const merged = mergeRosters(
      [entry('x', '2026-10-01T00:00:00Z'), entry('y', '2026-10-03T00:00:00Z')],
      [entry('x', '2026-10-02T00:00:00Z', { team: 'A', fileName: 'new_rosters_1.csv' }), entry('y', '2026-10-02T00:00:00Z')],
    );
    expect(merged.map((m) => [m.key, m.updatedAt])).toEqual([
      ['y', '2026-10-03T00:00:00Z'],
      ['x', '2026-10-02T00:00:00Z'],
    ]);
    const gone = mergeRosters(merged, [{ ...entry('x', '2026-10-04T00:00:00Z'), removed: true }]);
    expect(gone.find((m) => m.key === 'x')?.removed).toBe(true);
  });

  it('an entry off the sheet that cannot be read is dropped, a tombstone is kept', () => {
    expect(readSaved({ key: 'x' })).toBeNull();
    expect(readSaved({ ...entry('x', 't'), team: 'nobody' })).toBeNull();
    expect(readSaved({ key: 'x', updatedAt: 't', removed: true })?.removed).toBe(true);
  });
});
