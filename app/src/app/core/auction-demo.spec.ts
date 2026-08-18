import { AuctionPlayer, livePicks } from './auction-feed';
import { buildDemoSession, demoBudget, demoPlayers, demoRoles } from './auction-demo';
import { BundleTable } from './bundle';

/**
 * The demo is a FIXTURE, so what these tests pin is not football: it is that the invented table obeys
 * the rules the panel explains to whoever is looking at it. A demo whose pick order contradicted the
 * sentence printed under the pick order would teach the wrong thing about the real one.
 */

const SHEET: BundleTable = {
  table: 'sheets/demo',
  columns: ['fc_id', 'name', 'club', 'league', 'role_classic', 'roles_mantra'],
  rows: [
    [1, 'Kane', 'Bayern Monaco', 'bundesliga', 'A', 'pc'],
    [2, 'Ezzalzouli', 'Betis', 'la_liga', 'A', 'w;a'],
    [3, 'Bastoni', 'Inter', 'serie_a', 'D', 'dc;b'],
    [4, 'Dimarco', 'Inter', 'serie_a', 'D', 'e;ds'],
    [5, 'Barella', 'Inter', 'serie_a', 'C', 'm;c'],
    [6, 'Rovella', 'Lazio', 'serie_a', 'C', 'm'],
    [7, 'Maignan', 'Milan', 'serie_a', 'P', 'por'],
    [8, 'Svilar', 'Roma', 'serie_a', 'P', 'por'],
    // Quoted by nobody: he must not reach the board at all.
    [9, 'Fantasma', 'Nessuno', 'serie_a', 'A', 'pc'],
    // A role the listone does not use: dropped rather than filed under a guess.
    [10, 'Ignoto', 'Nessuno', 'serie_a', 'X', ''],
  ],
};

const PRICES = new Map<number, number>([
  [1, 400],
  [2, 120],
  [3, 90],
  [4, 80],
  [5, 70],
  [6, 30],
  [7, 60],
  [8, 55],
  [10, 10],
]);

const SLOTS = { P: 2, D: 3, C: 3, A: 2 };

const mantraBoard = () => demoPlayers(SHEET, PRICES, true);

describe('demoPlayers', () => {
  it('leaves out a man his own listone never quoted, instead of pricing him at zero', () => {
    const players = mantraBoard();
    expect(players.some((player) => player.id === 9)).toBe(false);
    expect(players.every((player) => player.fvm > 0)).toBe(true);
  });

  it('leaves out a role the listone does not use rather than guessing a zone for it', () => {
    expect(mantraBoard().some((player) => player.id === 10)).toBe(false);
  });

  it('reads the vocabulary the GAME scores by', () => {
    const mantra = mantraBoard().find((player) => player.id === 2)!;
    expect(mantra.roles).toEqual(['w', 'a']);
    const classic = demoPlayers(SHEET, PRICES, false).find((player) => player.id === 2)!;
    expect(classic.roles).toEqual(['A']);
  });

  it('splits the outfield the way each game counts it', () => {
    const players = mantraBoard();
    const keeper = players.find((player) => player.id === 7)!;
    const defender = players.find((player) => player.id === 3)!;
    expect(keeper.zoneClassic).toBe('gk');
    expect(keeper.zoneMantra).toBe('gk');
    expect(defender.zoneClassic).toBe('def');
    expect(defender.zoneMantra).toBe('mov');
  });
});

describe('demoRoles', () => {
  it('writes the same roster twice, in the alphabet each game counts with', () => {
    const mantra = demoRoles(SLOTS, true);
    const classic = demoRoles(SLOTS, false);
    expect(mantra['gk']).toEqual([2, 2]);
    expect(mantra['mov']).toEqual([8, 8]);
    expect(classic['def']).toEqual([3, 3]);
    // The two vocabularies must describe ONE roster, or the panel's «da prendere» counts would differ
    // between two demos of the same league.
    expect(mantra['size']).toEqual(classic['size']);
    expect(mantra['size'][0]).toBe(10);
  });
});

describe('demoBudget', () => {
  it('is the money the market itself spends per squad, not a round number somebody chose', () => {
    const players = mantraBoard();
    // Two squads of two men: the four dearest quotations are 400 + 120 + 90 + 80 = 690, i.e. 345 each,
    // rounded to the nearest fifty.
    expect(demoBudget(players, 2, 2)).toBe(350);
  });

  it('says zero when there is nothing to price', () => {
    expect(demoBudget([], 2, 2)).toBe(0);
    expect(demoBudget(mantraBoard(), 0, 2)).toBe(0);
  });
});

describe('buildDemoSession', () => {
  const session = (over: Partial<Parameters<typeof buildDemoSession>[0]> = {}) =>
    buildDemoSession({
      players: mantraBoard(),
      teams: 2,
      slots: SLOTS,
      mantra: true,
      platform: 'euro',
      rounds: 2,
      ...over,
    });

  it('is the same table twice: a demo nobody can reproduce is a demo nobody can report', () => {
    expect(JSON.stringify(session().state)).toBe(JSON.stringify(session().state));
  });

  it('plays WHOLE rounds, which is the barrier the platform itself applies', () => {
    const picks = livePicks(session().state);
    expect(picks.length).toBe(4);
    const byTeam = new Map<number, number>();
    for (const pick of picks) byTeam.set(pick.teamId, (byTeam.get(pick.teamId) ?? 0) + 1);
    expect([...byTeam.values()]).toEqual([2, 2]);
    // ...and the first round really is one each, in the declared order.
    expect(picks.slice(0, 2).map((pick) => pick.teamId)).toEqual([0, 1]);
  });

  it('spends the price the pick is made at, and never buys the same man twice', () => {
    const picks = livePicks(session().state);
    const prices = new Map(mantraBoard().map((player) => [player.id, player.fvm]));
    for (const pick of picks) expect(pick.cost).toBe(prices.get(pick.playerId));
    expect(new Set(picks.map((pick) => pick.playerId)).size).toBe(picks.length);
  });

  it('puts on the clock the squad the platform would - the cheapest, not the first', () => {
    const built = session();
    const spent = new Map<number, number>();
    for (const pick of livePicks(built.state)) {
      spent.set(pick.teamId, (spent.get(pick.teamId) ?? 0) + (pick.cost ?? 0));
    }
    const order = built.state.pickOrder!;
    expect(spent.get(order[0])!).toBeLessThanOrEqual(spent.get(order[1])!);
    // The panel follows whoever is on the clock, so the demo opens on «chi prendo adesso».
    expect(built.mineId).toBe(order[0]);
    expect(built.state.turnTeamId).toBe(order[0]);
  });

  it('never lets a squad exceed the keeper slots the session declares', () => {
    const built = session({ slots: { P: 1, D: 3, C: 3, A: 2 }, rounds: 3 });
    const keepers = new Set(
      mantraBoard()
        .filter((player: AuctionPlayer) => player.zoneMantra === 'gk')
        .map((player) => player.id),
    );
    const held = new Map<number, number>();
    for (const pick of livePicks(built.state)) {
      if (keepers.has(pick.playerId)) held.set(pick.teamId, (held.get(pick.teamId) ?? 0) + 1);
    }
    for (const count of held.values()) expect(count).toBeLessThanOrEqual(1);
  });

  it('declares the platform outright, so nothing has to be guessed from the rows', () => {
    expect(session().state.playerListType).toBe('euro');
    expect(session({ platform: 'default' }).state.playerListType).toBe('default');
  });
});
