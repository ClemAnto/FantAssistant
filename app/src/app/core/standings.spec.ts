import { describe, expect, it } from 'vitest';

import { CalendarFile } from './keeper-pairs';
import { placeOf, standingsOf } from './standings';

const club = (key: string, name: string | null, id: number | null) => ({ key, name, fc_club_id: id, elo: null });

const calendar = {
  leagues: {
    la_liga: {
      clubs: [club('real madrid', 'Real Madrid', 7), club('real sociedad', null, null), club('real betis', null, null)],
      standings: [['real madrid', 1, 15, 6], ['real sociedad', 4, 10, 6], ['real betis', 9, 7, 6]],
    },
    bundesliga: {
      clubs: [club('bayern munchen', 'Bayern Monaco', 12), club('koln', null, null)],
      standings: [['bayern munchen', 2, 13, 5], ['koln', 11, 6, 5]],
    },
  },
} as unknown as CalendarFile;

describe('placeOf', () => {
  const table = standingsOf(calendar);

  it('finds a club of ours by identity before any name', () => {
    expect(placeOf(table, { fcClubId: 12, name: 'Qualunque' })?.position).toBe(2);
  });

  it('tells two clubs sharing a first word apart by the words they share', () => {
    expect(placeOf(table, { fcClubId: null, name: 'Real Sociedad', championship: 'ESP' })?.position).toBe(4);
    expect(placeOf(table, { fcClubId: null, name: 'FC Köln', championship: 'GER' })?.position).toBe(11);
  });

  it('gives no place to a name that fits two clubs equally', () => {
    expect(placeOf(table, { fcClubId: null, name: 'Real', championship: 'ESP' })).toBeNull();
  });
});
