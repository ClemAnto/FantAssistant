/**
 * What to take NOW, given what happens before your next turn.
 *
 * A draft is not a ranking read once: taking the dearest man sends you to the back of the next round
 * (§11.5, and it is measured - `cost == FVM`, so the pick order is the exact inverse of the spend), and
 * whoever chooses in between takes names off the board. So the question is «who is best now, knowing
 * who will still be there later», which is a small lookahead and not a bigger sort.
 *
 * TWO THINGS ARE CERTAIN AND ONE IS ASSUMED, and the difference is the whole honesty of this file:
 *   * the ORDER is certain. fanta-asta-live recomputes it after every pick - fewest picks first (the
 *     round barrier), then lowest roster value, then whoever owns the dearer single player picks later,
 *     then the first round's order. That is its own `compare()`, read from its source on 09/08/2026.
 *   * the PRICE is certain: in a draft it is the FVM, the same for everybody.
 *   * WHAT THE RIVALS WILL TAKE is assumed. It is the only assumption here, it is stated in the card
 *     next to the prediction (§17.3), and it is deliberately NOT «the best surplus»: a rival does not
 *     have our numbers. The declared baseline is «the best FVM still free», weighted by the roles his
 *     own squad still has to cover according to the shapes the game allows (§13.3) - which is what the
 *     operator asked for, and what stops the simulation from handing a fourth keeper to a rival who
 *     already has three.
 */

import { MantraModules, slotShares } from './auction-value';

/** A team as the simulation needs it: who it is, what it holds, and where it sits in the order. */
export interface PlanTeam {
  id: number;
  label: string;
  /** The slots it already holds, one entry per player taken (`pc`, `dc`, ...). */
  slots: string[];
  /** What its squad is worth in the order's own currency - the FVM sum, which IS the spend. */
  rosterValue: number;
  /** Its picks, dearest first: the platform's tie-break compares them lexicographically. */
  pickValues: number[];
  picksCount: number;
  /** Position in the FIRST round, the permanent last-resort tie-break. */
  firstRoundIndex: number;
}

/** A free player, reduced to what a plan needs. */
export interface PlanPlayer {
  id: number;
  name: string;
  club: string;
  slot: string | null;
  /** The listone's own Mantra roles, so a suggestion is read the way the table reads a player. */
  roles: string[];
  /** The price, which in a draft is the FVM. */
  price: number;
  /** OUR valuation: what the panel ranks by. Rivals are not assumed to see it. */
  net: number | null;
}

export interface PlannedPick {
  teamId: number;
  teamLabel: string;
  player: PlanPlayer;
  /** True for the rows we ASSUMED rather than read. */
  predicted: boolean;
}

/** One WHOLE round of the lookahead: who chooses before us, what we take, who chooses after. */
export interface PlanRound {
  /** Rivals choosing BEFORE us. Empty in the current round - those picks have already happened. */
  before: PlannedPick[];
  /** What we would take. Null in the current round: that pick is `Plan.mine`. */
  mine: PlanPlayer | null;
  /** Rivals choosing AFTER us, to the END of the round. */
  after: PlannedPick[];
}

export interface Plan {
  /** What to take now. */
  mine: PlanPlayer | null;
  /**
   * The rounds ahead, each one WHOLE. `rounds[0]` is the current one (its `mine` is null - that pick is
   * `mine` above - and its `after` is the rest of the round); every entry after it runs from the first
   * rival of the round to the last.
   *
   * Running each round to its END is not presentation: it is what makes the NEXT round's order right.
   * Stopping at our own pick left the teams behind us without one, so they entered the following round
   * with a stale pick count and a stale roster value - and both are what the order is computed from.
   */
  rounds: PlanRound[];
  /** How many picks happen between our first and our second - the number the card leads with. */
  gap: number;
  /**
   * The pick order that would hold AFTER the simulated rounds, team ids in turn order.
   *
   * It is the consequence of the chain, and the one number a draft hides: every credit spent scales a
   * squad back, so where you will choose next is decided by what you take now (§11.5). Computed with
   * the platform's own rule, on the squads as the simulation leaves them.
   */
  nextOrder: number[];
}

/** How far ahead to look. Three rounds because that is what the operator reads at the table; each one
 *  costs one pass over the free pool per team, so depth is cheap and confidence is not. */
export const ROUNDS_AHEAD = 4;

/**
 * How many starting places each slot asks for, per team, from the shapes.
 *
 * A shape fields ten outfield men and the average over the eleven legal ones says how many of each
 * kind (`slotShares`): 2.2 `dc`, 1.2 `m`, 0.5 `ds` and so on. Rounded UP, because half a place is
 * still a place somebody has to be able to fill.
 */
export function startingPlaces(shapes: MantraModules | null): Map<string, number> {
  const places = new Map<string, number>();
  if (!shapes) return places;
  for (const [slot, share] of slotShares(shapes)) {
    places.set(slot, Math.ceil(share));
  }
  return places;
}

/**
 * How much a team still WANTS a slot: 1 while it cannot field the places the shapes ask for, less
 * afterwards.
 *
 * `DEPTH_WEIGHT` is a declared number and not a measured one - it says «a spare is worth wanting, and
 * less than a starter». It is the one dial of the rival policy, so it lives here with its name on it.
 */
export const DEPTH_WEIGHT = 0.35;

export function needFor(team: PlanTeam, slot: string | null, places: Map<string, number>): number {
  if (!slot) return DEPTH_WEIGHT;
  const wanted = places.get(slot) ?? 1;
  const held = team.slots.filter((held) => held === slot).length;
  return held < wanted ? 1 : DEPTH_WEIGHT;
}

/** How many places from the end of a round count as «the tail», where spending little pays twice. */
export const TAIL_POSITIONS = 2;

/**
 * The credits the tail treats as free in order to stay ahead - and the number that stops the rule from
 * degenerating.
 *
 * A plain «points per credit» rewards being nearly free by arithmetic: measured 10/08/2026, the last two
 * of the round both took ONE-credit fillers (Lahdo, Goldaniga), because a net of 0.2 over a price of 1
 * beats a net of 12 over 50. The operator asked for «high surplus AND low FVM», which is a good player
 * cheaply and not the cheapest thing on the board, so the price is smoothed: with this floor a 1-credit
 * man scores 0.008 and a 50-credit defender with real surplus scores 0.16.
 */
export const TAIL_PRICE_FLOOR = 25;

/**
 * What a rival takes: the dearest man he still needs - unless he is at the END of the round.
 *
 * The weight on need is what makes it a policy and not a shopping list: without it the simulation gives
 * a fourth keeper to a team that has three, which no real table does.
 *
 * THE TAIL BEHAVES DIFFERENTLY, and it is the operator's observation of 10/08/2026: whoever chooses
 * last or second-to-last has the strongest incentive to spend LITTLE, because the order is roster value
 * ascending - a cheap pick now buys the first or second call of the next round, which is the option
 * value of §11.5. So there the score is value PER CREDIT instead of value.
 *
 * That is a STRONGER assumption than the baseline and it is declared as one: a rival does not see our
 * surplus, so modelling him as hunting it credits him with a valuation of his own. It is stated in the
 * card and it is the second thing to measure against the real table, after the names.
 */
export function predictRivalPick(
  team: PlanTeam,
  pool: PlanPlayer[],
  places: Map<string, number>,
  keeperCap: number,
  placesFromEnd = Infinity,
): PlanPlayer | null {
  const keepers = team.slots.filter((slot) => slot === 'por').length;
  const inTail = placesFromEnd <= TAIL_POSITIONS;
  let best: PlanPlayer | null = null;
  let bestScore = -Infinity;
  for (const player of pool) {
    if (player.slot === 'por' && keepers >= keeperCap) continue;
    const need = needFor(team, player.slot, places);
    // In the tail: points per credit, so a cheap man with real surplus beats an expensive name. The
    // floor of 1 keeps a one-credit player from dividing by nothing and winning by arithmetic alone.
    const score = inTail
      ? ((player.net ?? 0) / (player.price + TAIL_PRICE_FLOOR)) * need
      : player.price * need;
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  // A tail team with nothing priced would score every candidate at zero and pick the first one it saw:
  // fall back to the baseline rather than let the order of the pool decide.
  if (inTail && best && (best.net ?? 0) <= 0) {
    return predictRivalPick(team, pool, places, keeperCap, Infinity);
  }
  return best;
}

/** The four lines a slot can belong to, in either game's vocabulary. */
export type Line = 'por' | 'dif' | 'cen' | 'att';

const LINE_OF: Record<string, Line> = {
  por: 'por', P: 'por',
  dd: 'dif', dc: 'dif', ds: 'dif', b: 'dif', D: 'dif',
  e: 'cen', m: 'cen', c: 'cen', w: 'cen', t: 'cen', C: 'cen',
  a: 'att', pc: 'att', A: 'att',
};

export function lineOf(slot: string | null): Line | null {
  return slot ? (LINE_OF[slot] ?? LINE_OF[slot.toLowerCase()] ?? null) : null;
}

/** One of the roots a plan can be grown from, with the reason it is on the list. */
export interface PlanRoot {
  player: PlanPlayer;
  /** Why this option exists - shown to the operator, because a choice needs its own label. */
  why: string;
}

/**
 * Where a squad would choose next round if it spent `price` now.
 *
 * The order is roster value ascending, so the question is only «how many rivals end this round with a
 * cheaper squad than mine». The rivals' projected values are their own spend plus what the policy
 * expects them to take, which is the same assumption the rest of the plan runs on - using their CURRENT
 * values instead would flatter every big spend, because everybody is about to add a name.
 */
export function positionAfterSpending(price: number, mySpend: number, rivalValues: number[]): number {
  const mine = mySpend + price;
  return 1 + rivalValues.filter((value) => value < mine).length;
}

/**
 * Three STARTING POINTS that point in different directions.
 *
 * §17.3 is explicit that the three strips must not be the top three of one ranking: three almost
 * equivalent picks give three almost identical chains - «tre attaccanti, nessuna informazione». So the
 * roots are chosen for DIVERGENCE:
 *   1. the best `net` we can see - the answer to «who is worth most»;
 *   2. the best `net` in ANOTHER LINE - the answer to «and if I start from a different department»;
 *   3. the best `net` among the cheap half - the answer to «and if I keep my place in the order»,
 *      which is the option value of §11.5 and the only one of the three that is about the ORDER.
 *
 * The axis the doc would prefer is the defensive FAMILY (three at the back against four, §17.2), and
 * it needs a score for which shapes a squad can still reach - not built yet. This axis is declared as
 * the interim one rather than presented as that one.
 */
export interface RootsContext {
  /** What our squad is already worth in the order's currency. */
  mySpend: number;
  /** Each rival's projected roster value at the END of this round. */
  rivalValues: number[];
  /** How far down the next round's order still counts as «keeping our place». */
  keepWithin: number;
}

export function planRoots(pool: PlanPlayer[], context?: RootsContext): PlanRoot[] {
  const roots: PlanRoot[] = [];
  const best = pickForUs(pool);
  if (!best) return roots;
  roots.push({ player: best, why: 'il massimo netto' });

  const bestLine = lineOf(best.slot);
  const elsewhere = pickForUs(pool.filter((player) => lineOf(player.slot) !== bestLine));
  if (elsewhere) roots.push({ player: elsewhere, why: 'un altro reparto' });

  // «Keeps our place» is a statement about the ORDER and it has to be measured there. It used to be
  // «in the cheaper half of the pool», which on a listone whose median FVM is 14 and whose maximum is
  // 499 meant «almost free»: it offered an 11-credit unknown while a 244-credit striker that really
  // did keep the place was never considered (found 10/08/2026 by the operator asking why).
  if (context && context.rivalValues.length) {
    const affordable = pool.filter(
      (player) => !roots.some((root) => root.player.id === player.id)
        && positionAfterSpending(player.price, context.mySpend, context.rivalValues) <= context.keepWithin,
    );
    const holding = pickForUs(affordable);
    if (holding) {
      roots.push({
        player: holding,
        why: `resti ${positionAfterSpending(holding.price, context.mySpend, context.rivalValues)}° su `
          + `${context.rivalValues.length + 1}`,
      });
    }
  }

  return roots;
}

/** Our own pick: the best `net` we can see, falling back to the price when nothing is priced. */
export function pickForUs(pool: PlanPlayer[]): PlanPlayer | null {
  let best: PlanPlayer | null = null;
  for (const player of pool) {
    if (!best) {
      best = player;
      continue;
    }
    const left = player.net ?? -Infinity;
    const right = best.net ?? -Infinity;
    if (left > right || (left === right && player.price > best.price)) best = player;
  }
  return best;
}

/** The platform's own comparison, in the order its `compare()` applies it. */
function ahead(a: PlanTeam, b: PlanTeam, maxAheadPicks: number): number {
  let byPicks = a.picksCount - b.picksCount;
  if (Math.abs(byPicks) < maxAheadPicks) byPicks = 0;
  if (byPicks) return byPicks;
  if (a.rosterValue !== b.rosterValue) return a.rosterValue - b.rosterValue;
  // Lexicographic over the picks, dearest first: whoever owns the more expensive man chooses later.
  const left = [...a.pickValues].sort((x, y) => y - x);
  const right = [...b.pickValues].sort((x, y) => y - x);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return a.firstRoundIndex - b.firstRoundIndex;
}

function take(team: PlanTeam, player: PlanPlayer): PlanTeam {
  return {
    ...team,
    slots: [...team.slots, player.slot ?? ''],
    rosterValue: team.rosterValue + player.price,
    pickValues: [...team.pickValues, player.price],
    picksCount: team.picksCount + 1,
  };
}

export interface PlanInput {
  teams: PlanTeam[];
  /** The order as the host publishes it: index 0 is on the clock. */
  order: number[];
  pool: PlanPlayer[];
  mineId: number;
  shapes: MantraModules | null;
  /** How many keepers a squad may hold - the session's own slot count. */
  keeperCap: number;
  maxAheadPicks: number;
  roundsAhead?: number;
  /** Force the FIRST pick, so a plan can be grown from a root the operator chose. */
  rootId?: number;
}

/**
 * The plan: our pick, everybody else's until our next turn, and our second.
 *
 * It is a beam of ONE, deliberately: §17.3 asks for three strips chosen for DIVERGENCE of direction,
 * and three near-identical lists would be three attackers and no information. One honest chain first,
 * the divergent alternatives when the shapes can score a squad's direction.
 */
export function plan(input: PlanInput): Plan {
  const places = startingPlaces(input.shapes);
  let teams = new Map(input.teams.map((team) => [team.id, team]));
  let pool = [...input.pool];
  const order = input.order.filter((id) => teams.has(id));

  const mine = input.rootId !== undefined
    ? (pool.find((player) => player.id === input.rootId) ?? pickForUs(pool))
    : pickForUs(pool);
  if (!mine) return { mine: null, rounds: [], gap: 0, nextOrder: [] };
  pool = pool.filter((player) => player.id !== mine.id);
  teams.set(input.mineId, take(teams.get(input.mineId)!, mine));

  const rounds: PlanRound[] = [];

  // The REST of this round: the order the host published, from just after us. It is not a forecast.
  const restOfRound: PlannedPick[] = [];
  const myPlace = order.indexOf(input.mineId);
  const after = order.slice(myPlace + 1);
  for (const [index, id] of after.entries()) {
    const team = teams.get(id)!;
    // How many places are left after his, THIS round: the tail is where spending little pays twice.
    const choice = predictRivalPick(team, pool, places, input.keeperCap, after.length - index);
    if (!choice) break;
    pool = pool.filter((player) => player.id !== choice.id);
    teams.set(id, take(team, choice));
    restOfRound.push({ teamId: id, teamLabel: team.label, player: choice, predicted: true });
  }
  rounds.push({ before: [], mine: null, after: restOfRound });

  // ...then every following round, WHOLE: the order is recomputed as the platform does it, the rivals
  // ahead of us choose, we choose, and the rest of the round choose too - which is what leaves the next
  // round's order standing on real pick counts instead of on teams that skipped a turn.
  for (let round = 1; round < (input.roundsAhead ?? ROUNDS_AHEAD); round += 1) {
    const nextOrder = [...teams.values()]
      .sort((a, b) => ahead(a, b, input.maxAheadPicks))
      .map((team) => team.id);
    const roundBefore: PlannedPick[] = [];
    const roundAfter: PlannedPick[] = [];
    let ours: PlanPlayer | null = null;
    let passed = false;
    for (const [index, id] of nextOrder.entries()) {
      if (id === input.mineId) {
        ours = pickForUs(pool);
        if (ours) {
          pool = pool.filter((player) => player.id !== ours!.id);
          teams.set(id, take(teams.get(id)!, ours));
        }
        passed = true;
        continue;
      }
      const team = teams.get(id)!;
      const choice = predictRivalPick(team, pool, places, input.keeperCap,
                                      nextOrder.length - index);
      if (!choice) break;
      pool = pool.filter((player) => player.id !== choice.id);
      teams.set(id, take(team, choice));
      (passed ? roundAfter : roundBefore).push({
        teamId: id, teamLabel: team.label, player: choice, predicted: true,
      });
    }
    rounds.push({ before: roundBefore, mine: ours, after: roundAfter });
    if (!ours) break;
  }

  return {
    mine,
    rounds,
    gap: (rounds[0]?.after.length ?? 0) + (rounds[1]?.before.length ?? 0),
    nextOrder: [...teams.values()]
      .sort((a, b) => ahead(a, b, input.maxAheadPicks))
      .map((team) => team.id),
  };
}
