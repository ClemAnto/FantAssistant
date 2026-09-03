/**
 * A random-extraction auction with nobody at the table: the DEFAULT state of the board.
 *
 * The operator's rule of 03/09/2026: connecting to a live fanta-asta session is OPTIONAL and behind a
 * button, so both auction pages open on an invented table with standard settings and the connection is
 * something you ASK for. A page that opens on a code field shows the layout of the thing instead of
 * the thing, and the numbers can only be judged with the numbers on.
 *
 * What is fake and what is not is the same asymmetry `auction-demo.ts` already declares, and it is
 * deliberate: the TABLE is invented (squads, budgets, who took whom), the PLAYERS are real and so are
 * the engine's numbers about them, because the join between a session and a sheet is `fc_id` and an
 * invented listone would match no sheet at all.
 *
 * Two things this file does NOT do. It does not re-derive the listone: `demoPlayers` and `demoRoles`
 * are imported from the draft fixture rather than copied, or two definitions of «the demo's listone»
 * would eventually give two different boards. And it invents no MECHANICS: the extraction is free over
 * the whole listone, one name at a time and any role at any moment, which is the operator's own
 * auction (03/09/2026) and not the departmental order the bench models.
 */

import {
  AuctionPlayer,
  DraftStatus,
  GameType,
  MarketType,
  RawPick,
  RawState,
  zoneOf,
} from './auction-feed';
import { Role, ROLES } from './plancia';

/**
 * The league the board opens on: the operator's own, and the one every published number of the
 * auction bench is measured against (`simulatore-asta-rilanci-v1.md` §18: ten seats, 1000 credits,
 * 3/8/8/6 - `rules.TEAMS`, the conservation of `to_credits` over ten budgets, and the SLOT that is a
 * rank divided by ten all say the same number).
 */
export const STANDARD_LEAGUE = {
  teams: 10,
  budget: 1000,
  slots: { P: 3, D: 8, C: 8, A: 6 } as Record<Role, number>,
};

/** The invented squads: fixed names and colours, so two runs of the demo are the SAME table. */
const DEMO_TEAMS: { label: string; colour: string }[] = [
  { label: 'La mia rosa', colour: '#6f8cff' },
  { label: 'Bar Centrale', colour: '#f21a3c' },
  { label: 'Tridente', colour: '#63c617' },
  { label: 'Volk FC', colour: '#6300ff' },
  { label: 'Spartani', colour: '#0096a0' },
  { label: 'Gladiatori', colour: '#c89614' },
  { label: 'Marine', colour: '#a1400c' },
  { label: 'Zenith', colour: '#1169f7' },
  { label: 'Lupi di Fiume', colour: '#fa824c' },
  { label: 'Kraken', colour: '#757780' },
  { label: 'Ultimo Minuto', colour: '#c94f9b' },
  { label: 'Fuorigioco FC', colour: '#5fb0b7' },
];

/** How much of the auction the fixture plays before handing the board over. */
export const DEMO_PROGRESS = 0.35;

/**
 * A reproducible draw.
 *
 * `Math.random()` here would mean the operator could never point at the same thing twice, and a demo
 * nobody can reproduce is a demo nobody can report a defect about - the same rule the draft fixture
 * states about its own picks. A 32-bit LCG is enough: what is needed is repeatability, not entropy.
 */
export function drawer(seed = 20260903): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const ZONE_ROLE: Record<string, Role> = { gk: 'P', def: 'D', mid: 'C', atk: 'A' };

/** The macro-role of a listone row, in the four letters the board's lines are named with. */
export function roleOf(player: AuctionPlayer): Role | null {
  const zone = zoneOf(player, false);
  return ZONE_ROLE[zone] ?? null;
}

export interface DemoAuction {
  players: AuctionPlayer[];
  state: RawState;
  mineId: number;
  /** The lot on the table when the board opens, so it never starts on an empty focal zone. */
  lotId: number | null;
}

/**
 * The invented table: squads, a third of the auction already played, and a lot in progress.
 *
 * The awards are made the way a random auction makes them - a name drawn from the urn, bought by one
 * of the squads that still has a place for it - and their PRICE is the ladder the bench adopted times
 * the thinning the archive measured. It is a fixture: no verdict may ever be quoted off it, which is
 * why it says so here rather than in a comment nobody reads at the table.
 */
export function buildRandomAuction(input: {
  players: AuctionPlayer[];
  teams?: number;
  budget?: number;
  slots?: Record<Role, number>;
  progress?: number;
  seed?: number;
}): DemoAuction {
  const teams = Math.max(2, Math.min(input.teams ?? STANDARD_LEAGUE.teams, DEMO_TEAMS.length));
  const slots = input.slots ?? STANDARD_LEAGUE.slots;
  const budget = input.budget ?? STANDARD_LEAGUE.budget;
  const next = drawer(input.seed);

  const size = ROLES.reduce((total, role) => total + (slots[role] ?? 0), 0);
  const squads = Array.from({ length: teams }, (_, at) => ({
    id: at,
    spent: 0,
    byRole: new Map<Role, number>(),
  }));

  // The urn: every priced man, shuffled once. Free extraction means the ORDER is the whole mechanic,
  // so it is drawn here and not sorted - sorting it would silently rebuild a called auction.
  const urn = shuffle(
    input.players.filter((player) => player.fvm > 0 && roleOf(player)),
    next,
  );

  const picks: RawPick[] = [];
  // How far in the auction is, counted on the PLACES and not on the urn: «a third of the auction» is a
  // third of the 250 seats, not a third of the thousand names - most of which nobody ever buys.
  const stop = Math.floor(teams * size * clamp(input.progress ?? DEMO_PROGRESS, 0, 1));
  let lotId: number | null = null;

  for (let at = 0; at < urn.length; at += 1) {
    const player = urn[at];
    const role = roleOf(player)!;

    if (picks.length >= stop) {
      // The first name after the played part is the lot ON THE TABLE: the board opens on a decision.
      lotId = player.id;
      break;
    }

    const wants = squads.filter(
      (squad) => (squad.byRole.get(role) ?? 0) < (slots[role] ?? 0) && squad.spent < budget,
    );
    if (!wants.length) continue;

    const buyer = wants[Math.floor(next() * wants.length)];
    const price = Math.max(
      1,
      Math.min(budget - buyer.spent, Math.round(player.fvm * (0.6 + next()))),
    );
    picks.push({ index: picks.length, teamId: buyer.id, playerId: player.id, cost: price });
    buyer.spent += price;
    buyer.byRole.set(role, (buyer.byRole.get(role) ?? 0) + 1);
  }

  const state: RawState = {
    status: DraftStatus.Started,
    // The mechanic is RAISES, which is what tells the panel it is not a draft.
    marketType: MarketType.Bids,
    playerListType: 'default',
    settings: {
      budget,
      game: GameType.Classic,
      roles: {
        gk: [slots.P, slots.P],
        def: [slots.D, slots.D],
        mid: [slots.C, slots.C],
        atk: [slots.A, slots.A],
        size: [size, size],
      },
    },
    teams: squads.map((squad, at) => ({
      id: squad.id,
      color: DEMO_TEAMS[at].colour,
      connection: { label: DEMO_TEAMS[at].label, active: true, host: at === 0 },
    })),
    picks,
    pickOrder: squads.map((squad) => squad.id),
  };

  return { players: input.players, state, mineId: 0, lotId };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const out = [...items];
  for (let at = out.length - 1; at > 0; at -= 1) {
    const other = Math.floor(next() * (at + 1));
    [out[at], out[other]] = [out[other], out[at]];
  }
  return out;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
