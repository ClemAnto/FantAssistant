import { TestBed } from '@angular/core/testing';

import {
  AuctionFeed,
  AuctionPlayer,
  RawPick,
  RawState,
  applyStreamEvent,
  deriveTeams,
  inactiveClubsOf,
  leagueSettings,
  listTypeOf,
  listOf,
  livePicks,
  platformOf,
  porteOf,
  pricedFor,
  rewindState,
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
    expect(listOf<any>(STATE.teams)[0].currentBudget).toBe(1000);
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
    expect(
      platformOf({ playerListType: 'custom' }, [foreign('Arsenal', 'Premier League')]),
    ).toBeNull();
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

describe('porteOf, the cheapest keeper', () => {
  const keeper = (id: number, name: string, club: string, fvm: number): AuctionPlayer => ({
    id, name, club, roles: ['por'], zoneClassic: 'gk', zoneMantra: 'gk', championship: 'Serie A', fvm,
  });

  it('carries the DEAREST keeper as the price and the CHEAPEST as what a draft pick of the goal can cost', () => {
    // Any keeper of the club takes its goal, and a draft pick costs the FVM of the man called.
    const { porte } = porteOf(
      [keeper(101, 'Svilar', 'Roma', 65), keeper(102, 'Gollini', 'Roma', 3)], [], false,
    );
    expect(porte[0].price).toBe(65);
    expect(porte[0].cheapest).toBe(3);
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
    expect(listOf<any>(mirror.teams)[0]).toEqual({ id: 0, picksCount: 1, color: '#fff' });
  });

  it('appends a pick written at its array index', () => {
    const mirror: RawState = { picks: [{ index: 0, teamId: 0, playerId: 1, cost: 5 }] };
    applyStreamEvent(mirror, 'put', '/picks/1', { index: 1, teamId: 2, playerId: 9, cost: 40 });
    expect(listOf<RawPick>(mirror.picks).length).toBe(2);
    expect(listOf<RawPick>(mirror.picks)[1].cost).toBe(40);
  });

  it('removes a key when the event carries null', () => {
    const mirror: RawState = { status: 2, turnTeamId: 3 };
    applyStreamEvent(mirror, 'put', '/turnTeamId', null);
    expect('turnTeamId' in mirror).toBe(false);
  });

  it('rebuilds the state a real session sends: full put, then the pick that follows', () => {
    let mirror: RawState = {};
    // Su una COPIA: `put` alla radice restituisce l'oggetto che gli si passa, e i tre `put` che
    // seguono scriverebbero dentro il fixture di tutto il file.
    mirror = applyStreamEvent(mirror, 'put', '/', structuredClone(STATE));
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

/**
 * LE ROSE SCRITTE A MANO, che esistono solo sul tavolo inventato.
 *
 * Quello che va tenuto fermo sono i due confini, perche' se cedono non si vedono a schermo: un
 * acquisto scritto da noi su un'asta VERA sarebbe cancellato dalla prima riga in arrivo (e nel
 * frattempo il pannello mostrerebbe una rosa che al tavolo non esiste), e un uomo assegnato due volte
 * avrebbe due proprietari, che `livePicks` consegnerebbe entrambi.
 */
describe('AuctionFeed: awardByHand / emptySquads', () => {
  const fresh = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const feed = TestBed.inject(AuctionFeed);
    feed.startDemo({
      players: [...PLAYERS.values()],
      // I DUE PICK SCRITTI QUI e non ereditati: quello che questi test misurano e' quanti proprietari
      // ha un uomo, quindi il tavolo di partenza dev'essere quello dichiarato e non quello che un
      // altro test ha lasciato in giro.
      state: {
        ...structuredClone(STATE),
        picks: [
          { index: 0, teamId: 0, playerId: 5585, cost: 365 },
          { index: 1, teamId: 1, playerId: 6052, cost: 271 },
        ],
      },
      mineId: 0,
    });
    return feed;
  };

  it('assigns a man to a squad, at the price it is given', () => {
    const feed = fresh();
    const before = feed.teams().find((one) => one.id === 2)!;
    expect(before.spent).toBe(0);

    expect(feed.awardByHand(9999, 2, 120)).toBe(true);
    const after = feed.teams().find((one) => one.id === 2)!;
    expect(after.spent).toBe(120);
    expect(after.budgetLeft).toBe(880);
    // The index CONTINUES the table's own numbering: `livePicks` sorts on it, and two picks sharing
    // one index are a history nobody can put back in order.
    expect(feed.picks().at(-1)).toMatchObject({ index: 2, teamId: 2, playerId: 9999, cost: 120 });
  });

  it('refuses a man somebody already has', () => {
    const feed = fresh();
    // 5585 is the host's in the fixture: awarding him again would give him two owners.
    expect(feed.awardByHand(5585, 3, 10)).toBe(false);
    expect(feed.picks().length).toBe(2);
    expect(feed.teams().find((one) => one.id === 3)!.spent).toBe(0);
  });

  it('empties every squad and leaves the regulation alone', () => {
    const feed = fresh();
    expect(feed.emptySquads()).toBe(true);
    expect(feed.picks().length).toBe(0);
    expect(feed.teams().every((one) => one.spent === 0)).toBe(true);
    expect(feed.teams().every((one) => one.budgetLeft === 1000)).toBe(true);
    // What is reset are the ROSTERS: seats, budget, slots and labels are the league's own facts.
    expect(feed.teams().length).toBe(10);
    expect(feed.budget()).toBe(1000);
    expect(feed.teams().find((one) => one.id === 1)!.label).toBe('Ciccio');
    expect(feed.teams().find((one) => one.id === 0)!.missing['gk']).toBe(3);
  });

  it('touches nothing at all when the table is not ours', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const feed = TestBed.inject(AuctionFeed);
    expect(feed.demo()).toBe(false);
    expect(feed.awardByHand(5585, 1, 10)).toBe(false);
    expect(feed.emptySquads()).toBe(false);
    expect(feed.picks().length).toBe(0);
  });
});

describe("il prezzo di un draft e' l'FVM del GIOCO del tavolo", () => {
  // Serie A 2026-27: the listone serves both values and they differ on 140 men of 535.
  const calhanoglu: AuctionPlayer = {
    id: 7001, name: 'Calhanoglu', club: 'Inter', roles: ['c', 't'], zoneClassic: 'mid', zoneMantra: 'mov',
    championship: 'Serie A', fvm: 250, fvmByGame: { classic: 220, mantra: 250 },
  };

  it('reads the classic value on a classic table and the mantra one on a mantra table', () => {
    expect(pricedFor(calhanoglu, false).fvm).toBe(220);
    expect(pricedFor(calhanoglu, true).fvm).toBe(250);
    // A row built from the bundle carries its game's value already, and stays as it is.
    const bundled = { ...calhanoglu, fvmByGame: undefined, fvm: 210 };
    expect(pricedFor(bundled, false)).toBe(bundled);
  });

  it('prices the free list by the game the state declares, which arrives after the listone', () => {
    const table = (game: number) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const feed = TestBed.inject(AuctionFeed);
      feed.startDemo({
        players: [calhanoglu],
        state: { ...structuredClone(STATE), picks: [], settings: { ...structuredClone(STATE).settings, game } },
        mineId: 0,
      });
      return feed;
    };
    expect(table(1).isMantra()).toBe(false);
    expect(table(1).available().find((one) => one.id === 7001)?.fvm).toBe(220);
    expect(table(2).isMantra()).toBe(true);
    expect(table(2).available().find((one) => one.id === 7001)?.fvm).toBe(250);
  });
});

describe('una lista come Firebase la manda', () => {
  // IL CASO CHE LA FA ESISTERE: un'aggiudicazione ANNULLATA lascia un buco fra le chiavi, e da quel
  // momento il Realtime Database serializza il nodo come OGGETTO invece che come array. Prima del
  // 24/09/2026 `livePicks` ci chiamava `.filter` sopra: un `TypeError` dentro un `computed`, cioe' la
  // plancia che si spegne nell'istante in cui il banditore corregge un errore.
  const pick = (index: number, playerId: number) => ({ index, teamId: 0, playerId, cost: 1 });

  it('legge un array come un array', () => {
    expect(listOf([pick(0, 1), pick(1, 2)])).toHaveLength(2);
  });

  it('legge come una lista anche un oggetto con le chiavi numeriche bucate', () => {
    const picks = livePicks({ picks: { 0: pick(0, 11), 2: pick(2, 33) } });
    expect(picks.map((one) => one.playerId)).toEqual([11, 33]);
  });

  it('ordina per NUMERO e non per stringa, o il decimo starebbe fra il primo e il secondo', () => {
    const picks = livePicks({ picks: { 1: pick(1, 1), 10: pick(10, 10), 2: pick(2, 2) } });
    expect(picks.map((one) => one.index)).toEqual([1, 2, 10]);
  });

  it('butta i buchi, perche un posto vuoto non e una riga', () => {
    expect(listOf({ 0: pick(0, 1), 1: null, 2: pick(2, 3) })).toHaveLength(2);
    expect(listOf([pick(0, 1), null, pick(2, 3)])).toHaveLength(2);
  });

  it('e una chiave che non e un numero non e una riga di quella lista', () => {
    expect(listOf({ 0: pick(0, 1), meta: { chi: 'se' } })).toHaveLength(1);
  });

  it('su niente restituisce niente, invece di far cadere chi la legge', () => {
    expect(listOf(undefined)).toEqual([]);
    expect(listOf(null)).toEqual([]);
    expect(listOf(7)).toEqual([]);
  });

  it('e le ROSE hanno lo stesso problema: una rosa tolta le rende un oggetto', () => {
    const seats = listOf<any>(STATE.teams);
    const teams = deriveTeams({ ...STATE, teams: { 0: seats[0], 2: seats[2] } }, PLAYERS, {
      ...CONTEXT,
      zones: [...CONTEXT.zones],
    });
    expect(teams.map((one) => one.id)).toEqual([0, 2]);
  });
});

describe('inactiveClubsOf', () => {
  // Read on a live draft (29/09/2026): the host's switched-off clubs sit in settings, by the listone's names,
  // while their players stay in the list.
  it('reads settings.inactiveTeams, lowercased, as an array or as the object RTDB makes of one', () => {
    expect([...inactiveClubsOf({ settings: { inactiveTeams: ['Inter', 'Milan '] } })]).toEqual(['inter', 'milan']);
    expect([...inactiveClubsOf({ settings: { inactiveTeams: { 0: 'Roma', 2: 'Lazio' } } })]).toEqual(['roma', 'lazio']);
  });

  it('is empty where the table switched nothing off, or says something that is not a name', () => {
    expect(inactiveClubsOf({ settings: {} }).size).toBe(0);
    expect(inactiveClubsOf({}).size).toBe(0);
    expect(inactiveClubsOf({ settings: { inactiveTeams: [3, null] } }).size).toBe(0);
  });
});

describe('rivedere un draft scelta per scelta', () => {
  // Three squads, two rounds, and the host's order as it reads at the END of the draft. The history is the
  // order the squads really called in: 1, 2, 3, then 3, 1, 2.
  const ENDED: RawState = {
    marketType: 1,
    status: 3,
    teams: [{ id: 1 }, { id: 2 }, { id: 3 }],
    pickOrder: [2, 3, 1],
    turnTeamId: 2,
    picks: [
      { index: 0, teamId: 1, playerId: 101, cost: 90 },
      { index: 1, teamId: 2, playerId: 102, cost: 80 },
      { index: 2, teamId: 3, playerId: 103, cost: 70 },
      { index: 3, teamId: 3, playerId: 104, cost: 60 },
      { index: 4, teamId: 1, playerId: 105, cost: 50 },
      { index: 5, teamId: 2, playerId: 106, cost: 40 },
    ],
  };

  it('keeps only the picks before the cursor, and nothing after it', () => {
    const at3 = rewindState(ENDED, 3);
    expect(livePicks(at3).map((pick) => pick.playerId)).toEqual([101, 102, 103]);
    expect(rewindState(ENDED, 0).picks).toEqual([]);
  });

  it('rebuilds the call order of that moment from who called next, not the order published now', () => {
    const at3 = rewindState(ENDED, 3);
    expect(at3.pickOrder).toEqual([3, 1, 2]);
    expect(at3.turnTeamId).toBe(3);
    expect(rewindState(ENDED, 0).pickOrder).toEqual([1, 2, 3]);
    // A squad that never calls again after the cursor still has a seat: it goes last, in the host's order.
    expect(rewindState(ENDED, 5).pickOrder).toEqual([2, 3, 1]);
  });

  it('reads a finished draft as one still being played, and leaves the whole table alone', () => {
    expect(rewindState(ENDED, 2).status).toBe(2);
    expect(rewindState(ENDED, 6)).toBe(ENDED);
    expect(rewindState(ENDED, 60)).toBe(ENDED);
  });

  const feedOn = (state: RawState) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const feed = TestBed.inject(AuctionFeed);
    feed.startDemo({ players: [], state: structuredClone(state), mineId: 1 });
    return feed;
  };

  it('steps back and forward, and past the last pick shows the table whole again', () => {
    const feed = feedOn(ENDED);
    expect(feed.reviewing()).toBe(false);
    feed.back();
    expect(feed.cursor()).toBe(5);
    expect(feed.picks().length).toBe(5);
    expect(feed.totalPicks()).toBe(6);
    feed.back();
    feed.back();
    expect(feed.onTheClock()?.id).toBe(3);
    expect(feed.teams().find((team) => team.id === 1)!.squad.length).toBe(1);
    feed.forward();
    feed.forward();
    feed.forward();
    expect(feed.reviewing()).toBe(false);
    expect(feed.picks().length).toBe(6);
  });

  it('jumps to the first pick and back to the whole table', () => {
    const feed = feedOn(ENDED);
    feed.toStart();
    expect(feed.cursor()).toBe(0);
    expect(feed.picks().length).toBe(0);
    expect(feed.onTheClock()?.id).toBe(1);
    feed.toEnd();
    expect(feed.reviewing()).toBe(false);
    expect(feed.picks().length).toBe(6);
  });

  it('stops at the first pick and never goes below it', () => {
    const feed = feedOn(ENDED);
    for (let i = 0; i < 10; i += 1) feed.back();
    expect(feed.cursor()).toBe(0);
    expect(feed.picks().length).toBe(0);
  });

  it('remembers the cursor WITH the table code, forgets it at the end, and puts it back once the table is in', () => {
    localStorage.removeItem('fantassistant.auction.cursor');
    const feed = feedOn(ENDED);
    feed.code.set('FA-aaa-bbb');
    feed.back();
    feed.back();
    expect(JSON.parse(localStorage.getItem('fantassistant.auction.cursor')!)).toEqual({ code: 'FA-aaa-bbb', at: 4 });
    feed.toEnd();
    expect(localStorage.getItem('fantassistant.auction.cursor')).toBeNull();
    // What `restore` does on a refresh: the saved index waits for ITS table, and a different code never takes it.
    const again = feedOn(ENDED);
    (again as unknown as { pendingCursor: { set(v: unknown): void } }).pendingCursor.set({ code: 'FA-aaa-bbb', at: 4 });
    again.code.set('FA-zzz-zzz');
    TestBed.tick();
    expect(again.cursor()).toBeNull();
    again.code.set('FA-aaa-bbb');
    TestBed.tick();
    expect(again.cursor()).toBe(4);
    expect(again.picks().length).toBe(4);
  });

  it('ends the review when the table changes hands or is written by hand', () => {
    const feed = feedOn(ENDED);
    feed.back();
    feed.disconnect();
    expect(feed.cursor()).toBeNull();
    const again = feedOn(ENDED);
    again.back();
    again.undoLastByHand();
    expect(again.reviewing()).toBe(false);
  });
});

describe('AuctionFeed: the order rule and the first round', () => {
  const withState = (state: RawState) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const feed = TestBed.inject(AuctionFeed);
    feed.startDemo({ players: [...PLAYERS.values()], state, mineId: 0 });
    return feed;
  };

  it('reads a snake from the state, and anything else as the default rule', () => {
    expect(withState({ ...structuredClone(STATE), pickOrderType: 'pingpong' }).orderType()).toBe('pingpong');
    expect(withState({ ...structuredClone(STATE), pickOrderType: 'mystery' }).orderType()).toBe('default');
    expect(withState(structuredClone(STATE)).orderType()).toBe('default');
  });

  it('takes the first round from the history, then the squads still to pick in the published order', () => {
    const feed = withState({
      ...structuredClone(STATE),
      pickOrder: [3, 1, 2, 0],
      picks: [
        { index: 0, teamId: 2, playerId: 5585, cost: 30 },
        { index: 1, teamId: 0, playerId: 6052, cost: 20 },
      ],
    });
    const order = feed.firstRoundOrder();
    expect(order.slice(0, 4)).toEqual([2, 0, 3, 1]);
  });
});

describe('AuctionFeed.restore: the squad a re-join follows', () => {
  // Found on 30/09/2026 replaying the classic draft FA-yei-458 on the real page: with the code saved and NO
  // snapshot, `connect` starts from `disconnect`, which forgot the squad `restore` had just set - and then
  // `remember` wrote `teamId: null`, so the panel came back following nobody (no predictions, no «pieno»).
  it('keeps the followed squad when there is no snapshot to paint', async () => {
    const realFetch = globalThis.fetch;
    const realSource = (globalThis as { EventSource?: unknown }).EventSource;
    localStorage.clear();
    localStorage.setItem('fantassistant.auction', JSON.stringify({ code: 'FA-abc-123', teamId: 3 }));
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      const body = url.includes('identitytoolkit')
        ? { idToken: 'fake' }
        : url.includes('/env/playerList')
          ? { 1: { id: 1, name: 'Uno', team: 'Inter', roles: ['Pc'], zone: { classic: 'atk', mantra: 'mov' },
            stats: { fmv: { classic: 10, mantra: 10 } } } }
          : null;
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    class FakeSource extends EventTarget {
      static CLOSED = 2;
      readyState = 1;
      close(): void {
        this.readyState = 2;
      }
    }
    (globalThis as { EventSource?: unknown }).EventSource = FakeSource;
    try {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const feed = TestBed.inject(AuctionFeed);
      expect(await feed.restore()).toBe(true);
      expect(feed.followedTeamId()).toBe(3);
      expect(JSON.parse(localStorage.getItem('fantassistant.auction') ?? '{}').teamId).toBe(3);
      feed.disconnect();
    } finally {
      globalThis.fetch = realFetch;
      (globalThis as { EventSource?: unknown }).EventSource = realSource;
      localStorage.clear();
    }
  });
});
