import {
  AuctionPlayer,
  RawState,
  applyStreamEvent,
  deriveTeams,
  leagueSettings,
  listTypeOf,
  livePicks,
  platformOf,
  porteOf,
  portaStandIns,
} from './auction-feed';

/**
 * The fixtures below are shaped on a REAL session observed on 09/08/2026 (`FA-y6k-vg9`): the
 * settings block, the pick order and the `currentBudget` staleness are transcribed from it, and the
 * player ids and values are the ones its listone carried. The session itself no longer exists - the
 * host removed it when the auction ended - which is precisely why the shape is pinned here.
 *
 * Re-checked on 09/08/2026 against a second live session (`FA-zna-v85`) AND against fanta-asta-live's
 * own source, which is what the three rules below come from: the league facts live in `settings`, the
 * slots still to fill count against the MINIMUM of the pair, and the platform is `playerListType`.
 * Where the tool and the league's regulation disagree the regulation wins (the «porte» rule), so a
 * test may pin what the host publishes and never what the league is playing.
 */

const MANTRA_ROLES = {
  gk: [3, 3],
  def: [8, 8],
  mid: [8, 8],
  atk: [6, 6],
  mov: [22, 22],
  size: [25, 25],
};

const player = (id: number, name: string, club: string, fvm: number): AuctionPlayer => ({
  id,
  name,
  club,
  roles: ['pc'],
  zoneClassic: 'atk',
  zoneMantra: 'mov',
  championship: 'Serie A',
  fvm,
});

const PLAYERS = new Map<number, AuctionPlayer>([
  [5585, player(5585, 'Malen', 'Roma', 365)],
  [6052, player(6052, 'Hojlund', 'Napoli', 271)],
]);

const team = (id: number, label?: string) => ({
  id,
  color: '#DC41DF',
  // Transcribed as the live feed had it: the host had not yet republished the recomputed budgets.
  currentBudget: 1000,
  connection: label ? { label, active: true, host: id === 0 } : undefined,
});

const STATE: RawState = {
  status: 2,
  marketType: 1,
  playerListType: 'default',
  // The league's own facts are in `settings`; `options.bids` carries the raise mechanics. A real host
  // publishes the whole blob in both, which is why the precedence needs its own test below.
  settings: { budget: 1000, participants: 10, game: 2, roles: MANTRA_ROLES, listType: 'euro' },
  options: {
    bids: { budget: 1000, participants: 10, game: 2, roles: MANTRA_ROLES, countdownSeconds: 10 },
    draft: { pickOrderType: 'default', maxAheadPicks: 1, rosterValueType: 'current' },
  },
  teams: [team(0, 'host'), team(1, 'Ciccio'), ...[2, 3, 4, 5, 6, 7, 8, 9].map((id) => team(id))],
  picks: [
    { index: 0, teamId: 0, playerId: 5585, cost: 365, value: 365 },
    { index: 1, teamId: 1, playerId: 6052, cost: 271, value: 271 },
  ],
  pickOrder: [2, 3, 4, 5, 6, 7, 8, 9, 1, 0],
  turnTeamId: 2,
};

const CONTEXT = {
  budget: 1000,
  zones: ['gk', 'mov'] as const,
  roles: MANTRA_ROLES,
  mantra: true,
};

describe('deriveTeams', () => {
  const teams = deriveTeams(STATE, PLAYERS, { ...CONTEXT, zones: [...CONTEXT.zones] });

  it('reads the spend from the picks, not from the stale currentBudget', () => {
    const host = teams.find((t) => t.id === 0)!;
    // The fixture carries currentBudget: 1000 for every team, exactly as the live feed did.
    expect(STATE.teams![0].currentBudget).toBe(1000);
    expect(host.spent).toBe(365);
    expect(host.budgetLeft).toBe(635);
  });

  it('counts the slots still to fill per zone', () => {
    const host = teams.find((t) => t.id === 0)!;
    expect(host.squad.length).toBe(1);
    expect(host.missing['gk']).toBe(3);
    expect(host.missing['mov']).toBe(21);
    expect(host.missingTotal).toBe(24);
  });

  it('counts what is still to fill against the MINIMUM of the slot pair, as the host does', () => {
    // fanta-asta-live's `getMissingPlayers` reads `roles[zone][0]`; the maximum only caps the squad.
    const wide = deriveTeams(STATE, PLAYERS, {
      ...CONTEXT,
      zones: [...CONTEXT.zones],
      roles: { ...MANTRA_ROLES, gk: [2, 3] },
    });
    expect(wide.find((t) => t.id === 0)!.missing['gk']).toBe(2);
  });

  it('places every team in the pick order, with the first one on the clock', () => {
    expect(teams.find((t) => t.id === 2)!.orderIndex).toBe(0);
    expect(teams.find((t) => t.id === 2)!.onTheClock).toBe(true);
    // Whoever spent most falls to the back: 365 behind 271, both behind the eight who spent nothing.
    expect(teams.find((t) => t.id === 1)!.orderIndex).toBe(8);
    expect(teams.find((t) => t.id === 0)!.orderIndex).toBe(9);
  });

  it('names a team from its connection, and falls back when nobody has joined it', () => {
    expect(teams.find((t) => t.id === 0)!.label).toBe('host');
    expect(teams.find((t) => t.id === 5)!.label).toBe('Squadra 5');
    expect(teams.find((t) => t.id === 5)!.online).toBe(false);
  });
});

describe('leagueSettings', () => {
  it('prefers state.settings, where the league facts actually live', () => {
    const state: RawState = {
      settings: { budget: 500 },
      options: { bids: { budget: 1000 } },
    };
    expect(leagueSettings(state)['budget']).toBe(500);
  });

  it('falls back to options.bids for a host that published them only there', () => {
    expect(leagueSettings({ options: { bids: { budget: 1000 } } })['budget']).toBe(1000);
  });
});

describe('platformOf', () => {
  const foreign = (club: string, championship: string): AuctionPlayer => ({
    ...player(900, 'X', club, 10),
    championship,
  });

  it('reads playerListType and not settings.listType', () => {
    // The real session carried listType 'euro' over a Serie A listone: the preset, not the list.
    expect(platformOf(STATE, PLAYERS.values())).toBe('default');
    expect(STATE.settings!['listType']).toBe('euro');
  });

  it('says nothing when the host has not uploaded a list yet', () => {
    expect(platformOf({ status: 1 })).toBeNull();
  });

  it('places a CUSTOM list from the championships of its own rows', () => {
    // Observed live: the host swapped in his own list and playerListType went to `custom`.
    const custom: RawState = { playerListType: 'custom' };
    expect(platformOf(custom, PLAYERS.values())).toBe('default');
    expect(platformOf(custom, [...PLAYERS.values(), foreign('Arsenal', 'Premier League')])).toBe(
      'euro',
    );
  });

  it('refuses to place a custom list it cannot read', () => {
    expect(platformOf({ playerListType: 'custom' }, [])).toBeNull();
    // One championship and it is not Serie A: neither of our two platforms is that list.
    expect(platformOf({ playerListType: 'custom' }, [foreign('Arsenal', 'Premier League')])).toBeNull();
  });

  it('keeps the raw list type available, custom included', () => {
    expect(listTypeOf({ playerListType: 'custom' })).toBe('custom');
    expect(listTypeOf({ playerListType: 'nonsense' })).toBeNull();
  });
});

describe('porteOf', () => {
  const keeper = (id: number, name: string, club: string, fvm: number): AuctionPlayer => ({
    id,
    name,
    club,
    roles: ['por'],
    zoneClassic: 'gk',
    zoneMantra: 'gk',
    championship: 'Serie A',
    fvm,
  });

  // Torino's shape in the 2026-27 listone: three keepers nobody quotes apart.
  const KEEPERS = [
    keeper(101, 'Svilar', 'Roma', 65),
    keeper(102, 'Gollini', 'Roma', 3),
    keeper(201, 'Paleari', 'Torino', 1),
    keeper(202, 'Mascardi', 'Torino', 1),
  ];

  it('gives the goal to the first keeper picked, even when it is the cheaper one', () => {
    const { porte } = porteOf(KEEPERS, [{ index: 0, teamId: 7, playerId: 102 }], false);
    const roma = porte.find((p) => p.club === 'Roma')!;
    expect(roma.teamId).toBe(7);
    // And it is priced at the dearest keeper, which is the one a bid would be made on.
    expect(roma.price).toBe(65);
  });

  it('ignores a second keeper of the same club and grants no second porta', () => {
    const { porte, strayPicks } = porteOf(
      KEEPERS,
      [
        { index: 0, teamId: 7, playerId: 101 },
        { index: 1, teamId: 3, playerId: 102 },
      ],
      false,
    );
    expect(porte.find((p) => p.club === 'Roma')!.teamId).toBe(7);
    expect(strayPicks.length).toBe(1);
    expect(strayPicks[0].pick.teamId).toBe(3);
    expect(strayPicks[0].porta.club).toBe('Roma');
  });

  it('needs no hierarchy where the listone quotes every keeper the same', () => {
    const { porte, strayPicks } = porteOf(KEEPERS, [{ index: 0, teamId: 5, playerId: 202 }], false);
    expect(porte.find((p) => p.club === 'Torino')!.teamId).toBe(5);
    expect(strayPicks.length).toBe(0);
  });

  it('leaves a club free until one of its keepers is taken', () => {
    const { porte } = porteOf(KEEPERS, [{ index: 0, teamId: 7, playerId: 101 }], false);
    expect(porte.filter((p) => p.teamId === null).map((p) => p.club)).toEqual(['Torino']);
  });
});

describe('portaStandIns', () => {
  const keeper = (id: number, name: string, club: string, fvm: number): AuctionPlayer => ({
    id, name, club, roles: ['por'], zoneClassic: 'gk', zoneMantra: 'gk', championship: 'Serie A', fvm,
  });
  const porte = porteOf(
    [keeper(101, 'Svilar', 'Roma', 65), keeper(102, 'Gollini', 'Roma', 3),
     keeper(201, 'Paleari', 'Torino', 1), keeper(202, 'Mascardi', 'Torino', 1)],
    [],
    false,
  ).porte;

  it('keeps ONE row per goal: the best keeper of the club by worth, and drops the others', () => {
    const worth = new Map([[101, 23.9], [102, 1.2], [201, 4.0], [202, 6.5]]);
    const { standIn, drop } = portaStandIns(porte, (id) => worth.get(id) ?? null);
    expect([...standIn.keys()].sort()).toEqual([101, 202]);
    expect([...drop].sort()).toEqual([102, 201]);
    // The goal costs what its DEAREST keeper costs, not what the stand-in costs.
    expect(standIn.get(202)!.price).toBe(1);
    expect(standIn.get(101)!.price).toBe(65);
  });

  it('gives a goal no row at all when none of its keepers has a number', () => {
    const { standIn, drop } = portaStandIns(porte, (id) => (id === 101 ? 10 : null));
    expect([...standIn.keys()]).toEqual([101]);
    // Torino's goal has no stand-in, so both its keepers are unbuyable rows rather than one invented one.
    expect(drop.has(201)).toBe(true);
    expect(drop.has(202)).toBe(true);
  });
});

describe('livePicks', () => {
  it('drops a released pick and orders the rest', () => {
    const picks = livePicks({
      picks: [
        { index: 2, teamId: 1, playerId: 1, cost: 10 },
        { index: 0, teamId: 0, playerId: 2, cost: 20, released: { index: 3, timestamp: 1 } },
        { index: 1, teamId: 0, playerId: 3, cost: 30 },
      ],
    });
    expect(picks.map((p) => p.index)).toEqual([1, 2]);
  });
});

describe('applyStreamEvent', () => {
  it('replaces the whole node on a root put', () => {
    const mirror = applyStreamEvent({ status: 1 }, 'put', '/', { status: 2, turnTeamId: 4 });
    expect(mirror).toEqual({ status: 2, turnTeamId: 4 });
  });

  it('merges only the given keys on a patch, leaving the siblings alone', () => {
    const mirror: RawState = { status: 2, teams: [{ id: 0, picksCount: 0, color: '#fff' }] };
    applyStreamEvent(mirror, 'patch', '/teams/0', { picksCount: 1 });
    expect(mirror.teams![0]).toEqual({ id: 0, picksCount: 1, color: '#fff' });
  });

  it('appends a pick written at its array index', () => {
    const mirror: RawState = { picks: [{ index: 0, teamId: 0, playerId: 1, cost: 5 }] };
    applyStreamEvent(mirror, 'put', '/picks/1', { index: 1, teamId: 2, playerId: 9, cost: 40 });
    expect(mirror.picks!.length).toBe(2);
    expect(mirror.picks![1].cost).toBe(40);
  });

  it('removes a key when the event carries null', () => {
    const mirror: RawState = { status: 2, turnTeamId: 3 };
    applyStreamEvent(mirror, 'put', '/turnTeamId', null);
    expect('turnTeamId' in mirror).toBe(false);
  });

  it('rebuilds the state a real session sends: full put, then the pick that follows', () => {
    let mirror: RawState = {};
    mirror = applyStreamEvent(mirror, 'put', '/', STATE);
    applyStreamEvent(mirror, 'put', '/picks/2', {
      index: 2,
      teamId: 2,
      playerId: 5585,
      cost: 100,
    });
    applyStreamEvent(mirror, 'put', '/pickOrder', [3, 4, 5, 6, 7, 8, 9, 2, 1, 0]);
    applyStreamEvent(mirror, 'put', '/turnTeamId', 3);

    const teams = deriveTeams(mirror, PLAYERS, { ...CONTEXT, zones: [...CONTEXT.zones] });
    expect(teams.find((t) => t.id === 2)!.spent).toBe(100);
    expect(teams.find((t) => t.id === 3)!.onTheClock).toBe(true);
    expect(teams.find((t) => t.id === 2)!.orderIndex).toBe(7);
  });
});
