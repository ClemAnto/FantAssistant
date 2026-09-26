import { AuctionPlayer, Zone, listOf, platformOf } from './auction-feed';
import { buildRandomAuction } from './plancia-demo';

function men(count: number): AuctionPlayer[] {
  const zones: Zone[] = ['gk', 'def', 'mid', 'atk'];
  return Array.from({ length: count }, (_, at) => ({
    id: at + 1,
    name: `Uomo ${at + 1}`,
    club: 'Club',
    roles: [],
    zoneClassic: zones[at % 4],
    zoneMantra: at % 4 === 0 ? 'gk' : 'mov',
    championship: null,
    fvm: 10 + at,
  }));
}

describe('buildRandomAuction', () => {
  it('IL TAVOLO E\' QUELLO DELLA LEGA DICHIARATA: sedie, budget, rose e listone (26/09/2026)', () => {
    // La plancia non collegata deve allinearsi alle opzioni di lega: un tavolo da dieci per una lega da
    // otto, o un listone di Serie A per una lega EuroLeghe, sarebbe un altro tavolo in silenzio.
    const auction = buildRandomAuction({
      players: men(400),
      teams: 8,
      budget: 500,
      slots: { P: 2, D: 7, C: 7, A: 5 },
      platform: 'euro',
      progress: 0,
    });
    expect(listOf(auction.state.teams).length).toBe(8);
    expect(auction.state.settings?.['budget']).toBe(500);
    expect(auction.state.settings?.['roles']?.['def']).toEqual([7, 7]);
    expect(auction.state.settings?.['roles']?.['size']).toEqual([21, 21]);
    expect(platformOf(auction.state)).toBe('euro');
    expect(listOf(auction.state.picks).length).toBe(0);
  });

  it('una lega oltre le dodici squadre ha tutte le sue sedie, fino alle ventiquattro del pannello', () => {
    expect(listOf(buildRandomAuction({ players: men(400), teams: 14 }).state.teams).length).toBe(14);
    expect(listOf(buildRandomAuction({ players: men(400), teams: 24 }).state.teams).length).toBe(24);
  });

  it('senza dichiarazioni resta lo standard su cui i banchi misurano: dieci sedie e Serie A', () => {
    const auction = buildRandomAuction({ players: men(400) });
    expect(listOf(auction.state.teams).length).toBe(10);
    expect(platformOf(auction.state)).toBe('default');
  });
});
