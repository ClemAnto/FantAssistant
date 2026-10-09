import { describe, expect, it } from 'vitest';

import { fcTeamNames, fixtureOf, parseCompetitions, parseLdate, parseRoster, parseSaved, parseTeam } from './leghe-matchday';

/**
 * THE NEXT MATCHDAY AS LEGHE SERVES IT. Synthetic rows with the real shapes (08/10/2026): the players are
 * real footballers with their real Leghe ids, because the id IS our `fc_id` and that join is the point.
 */

const lineupBody = {
  teamLineupDto: {
    mdl: '4231', starts: [6734, 2557], bench: [4154, 0], mday: 1, cmday: 5, ldate: '20260929163236158',
  },
  lineUpInfo: [
    {
      pid: 2557, plyr: 'Kane', role: [16], tname: 'Bayern', champ: 'GER', teamH: 'AUG', teamA: 'BAY', hoaw: 1,
      percent: 90, status: 1, comment: '', descr: '', agrd: 7.1, fagrd: 9.12, trnsf: 0,
    },
    {
      pid: 4154, plyr: 'Hradecky', role: [6], tname: 'Monaco', champ: 'FRA', teamH: 'AMO', teamA: 'TOU', hoaw: 0,
      percent: 90, status: 1, comment: '', descr: '', agrd: 6.5, fagrd: 5.62, trnsf: 0,
    },
    {
      pid: 5591, plyr: 'Hojbjerg', role: [11, 12], tname: 'Marsiglia', champ: 'FRA', teamH: 'TRO', teamA: 'OLM', hoaw: 1,
      percent: 0, status: 2, comment: 'Problema muscolare', descr: 'Problema muscolare', agrd: 0, fagrd: 0, trnsf: 0,
    },
  ],
};

describe('parseRoster', () => {
  it('turns lineUpInfo into rows: roles, next match, the platform percentage and the availability flag', () => {
    const rows = parseRoster(lineupBody);
    expect(rows.map((r) => r.fcId)).toEqual([2557, 4154, 5591]);
    expect(rows[0]).toMatchObject({ roles: ['Pc'], match: 'AUG-BAY', home: false, percent: 90, out: null });
    expect(rows[1]).toMatchObject({ roles: ['Por'], home: true });
    expect(rows[2]).toMatchObject({ roles: ['M', 'C'], out: 'unavailable', note: 'Problema muscolare' });
  });

  it('a season average of zero is «no vote yet», not a zero', () => {
    expect(parseRoster(lineupBody)[2]).toMatchObject({ vote: null, fantavote: null });
  });
});

describe('parseSaved and parseLdate', () => {
  it('reads the lineup already sent, dropping the empty bench slots', () => {
    const saved = parseSaved(lineupBody);
    expect(saved).toMatchObject({ module: '4231', starts: [6734, 2557], bench: [4154], matchday: 1, championshipMatchday: 5 });
    expect(saved?.savedAt?.getFullYear()).toBe(2026);
    expect(saved?.savedAt?.getHours()).toBe(16);
  });

  it('a lineup never submitted has no date', () => {
    expect(parseLdate('0')).toBeNull();
    expect(parseLdate('00000000000000000')).toBeNull();
    expect(parseLdate(undefined)).toBeNull();
  });
});

describe('competitions, calendar and teams', () => {
  it('keeps the competitions that exist and says which are head-to-head', () => {
    const comps = parseCompetitions([
      { id: 501, name: 'Campionato', type: 1, sDay: 5, eDay: 30, del: false, tmids: [11] },
      { id: 502, name: 'Highlander', type: 11, sDay: 7, eDay: 29, del: false, tmids: [] },
      { id: 9, name: 'gone', type: 1, del: true },
    ]);
    expect(comps.map((c) => [c.id, c.typeLabel, c.headToHead])).toEqual([
      [501, 'Campionato', true],
      [502, 'Highlander', false],
    ]);
  });

  it('finds this matchday opponent on either side of the fixture', () => {
    const calendar = [
      { matchDay: 1, championshipMatchDay: 5, matches: [{ tIdH: 11, tIdA: 12 }, { tIdH: 9, tIdA: 13 }] },
    ];
    expect(fixtureOf(calendar, 1, 11)).toEqual({ matchday: 1, championshipMatchday: 5, opponentId: 12, home: true });
    expect(fixtureOf(calendar, 1, 13)).toMatchObject({ opponentId: 9, home: false });
    expect(fixtureOf(calendar, 2, 11)).toBeNull();
  });

  it('reads a team: the roster ids come with a trailing separator', () => {
    expect(parseTeam({ id: 11, n: 'Squadra di prova', nu: 'utente', d: 'A', cal: '7638;7559;' })).toEqual({
      id: 11, name: 'Squadra di prova', manager: 'utente', division: 'A', roster: [7638, 7559],
    });
  });
});

describe('fcTeamNames', () => {
  it('names a club by the id Leghe uses for it, also outside the EuroLeghe perimeter', () => {
    // «PSG-MAN»: Leghe's `tidOp` 166 is not in `championship/teams`, and the probabili page calls it Le Mans.
    const table = { columns: ['team_id', 'name', 'observed_on'], rows: [[81, 'Paris Saint-Germain', '2026-10-09'], [166, 'Le Mans', '2026-10-09'], [7, '', '2026-10-09']] };
    const names = fcTeamNames(table);
    expect(names.get(166)).toBe('Le Mans');
    expect(names.get(81)).toBe('Paris Saint-Germain');
    expect(names.has(7)).toBe(false);
  });

  it('a bundle without the table names nobody, and says nothing wrong', () => {
    expect(fcTeamNames(null).size).toBe(0);
    expect(fcTeamNames({ columns: ['id', 'label'], rows: [[166, 'Le Mans']] }).size).toBe(0);
  });
});
