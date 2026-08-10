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
import { Covered, Placeable, augments, bestCovered, bestElevenWorth } from './mantra-legal';

/** A team as the simulation needs it: who it is, what it holds, and where it sits in the order. */
export interface PlanTeam {
  id: number;
  label: string;
  /** The slots it already holds, one entry per player taken (`pc`, `dc`, ...). */
  slots: string[];
  /**
   * The same men by their COMPLETE role lists, which is what legality is decided on: 497 of 1014 quoted
   * players carry two or more Mantra codes, and with the primary code alone the flexibility disappears and
   * the conclusions change (a bench mistake already paid for). Empty in classic, where a role is a role.
   */
  held: Placeable[];
  /** The same men by id, in the same order: a weighted eleven needs what each of them is WORTH. */
  heldIds: number[];
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
  /** Points over the live replacement. On the row because a rival's head may be this one. */
  surplus: number | null;
  /**
   * The GROSS worth - fantamedia x expected appearances - and in a DRAFT this is the currency, not `net`.
   *
   * Measured on the five gate windows (10/08/2026, `docs/model/metrica-asta-surplus-v1.md` §16): ranking a
   * draft by the net is a near-free-player generator, −52% against the paired rivals on 0 of 5 windows, 34
   * credits spent over 25 picks and half the eleven uncovered. The cause is structural rather than a bad
   * coefficient - lambda is the exchange rate between a credit and a fantapunto, and in a draft you do not
   * spend credits, you spend PICKS (§11.2), so subtracting a rate nobody pays rewards being nearly free.
   * `net` stays on the row because it is the right number in an auction with raises.
   */
  value: number | null;
}

export interface PlannedPick {
  teamId: number;
  teamLabel: string;
  player: PlanPlayer;
  /** True for the rows we ASSUMED rather than read. */
  predicted: boolean;
  /**
   * Fantapunti this rival's best legal eleven GAINS from the man he is expected to take - i.e. what taking
   * him first would deny (item 1.5). Zero where it cannot be computed, which is honest: no shapes, no eleven.
   */
  denies: number;
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
 * value of §11.5. So there the score is his own worth PER CREDIT instead of his own worth.
 *
 * `head` is what he ranks by, and it is no longer assumed to be the same for everybody: measured on the five
 * gate windows (`docs/model/metrica-asta-surplus-v1.md` §17), guessing each rival's head from the picks he
 * has already made predicts his next one **82.8%** of the time against **69.2%** for one head for all, 5/5
 * windows - and at a table where only a quarter of the seats are price-driven the single head collapses to
 * 28.4% against 74.8%. The assumption is still declared; it is declared PER RIVAL now.
 *
 * THE TAIL IS LEFT EXACTLY AS IT WAS, and that is a deliberate refusal to tidy: the two arms of the
 * measurement above SHARE the tail rule, so the run says nothing about it - and «his own worth per credit»
 * would silently make a price-driven rival take the DEAREST man in the tail (`price / (price + floor)` grows
 * with the price), which is the opposite of the incentive the rule exists for. So the tail keeps using our
 * own valuation as the proxy for «a good player cheaply», with the over-assumption still declared: a rival
 * does not see our surplus. Measuring the tail is its own question and it has not been asked yet.
 */
export type RivalHead = 'prezzo' | 'surplus' | 'valore';

/** What each head reads. Three, because those are the ones a table's own picks can distinguish. */
export const HEAD_WORTH: Record<RivalHead, (player: PlanPlayer) => number | null> = {
  prezzo: (player) => player.price,
  surplus: (player) => player.surplus,
  valore: (player) => player.value,
};

export const DEFAULT_HEAD: RivalHead = 'prezzo';

export function predictRivalPick(
  team: PlanTeam,
  pool: PlanPlayer[],
  places: Map<string, number>,
  keeperCap: number,
  placesFromEnd = Infinity,
  head: RivalHead = DEFAULT_HEAD,
): PlanPlayer | null {
  const keepers = team.slots.filter((slot) => slot === 'por').length;
  const inTail = placesFromEnd <= TAIL_POSITIONS;
  const worthOf = HEAD_WORTH[head] ?? HEAD_WORTH[DEFAULT_HEAD];
  let best: PlanPlayer | null = null;
  let bestScore = -Infinity;
  let priced = false;
  for (const player of pool) {
    if (player.slot === 'por' && keepers >= keeperCap) continue;
    const worth = worthOf(player);
    if (worth != null) priced = true;
    const need = needFor(team, player.slot, places);
    // In the tail: points per credit, so a cheap man with real worth beats an expensive name. The floor
    // keeps a one-credit player from dividing by nothing and winning by arithmetic alone.
    const score = inTail
      ? ((player.net ?? 0) / (player.price + TAIL_PRICE_FLOOR)) * need
      : (worth ?? 0) * need;
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  // A head that can price nobody in this pool says nothing about him: fall back to the PRICE, which every
  // row has, rather than let the order of the pool decide.
  if (!priced && head !== DEFAULT_HEAD) {
    return predictRivalPick(team, pool, places, keeperCap, placesFromEnd, DEFAULT_HEAD);
  }
  // A tail team with nothing priced would score every candidate at zero and pick the first one it saw.
  if (inTail && best && (best.net ?? 0) <= 0) {
    return predictRivalPick(team, pool, places, keeperCap, Infinity, head);
  }
  return best;
}

/**
 * How many of a rival's own picks we insist on seeing before believing the guess.
 *
 * TWO, and it is measured rather than cautious: on the five windows the hit rate FALLS as the warm-up grows
 * (82.8% at 2, 81.7% at 4, 79.3% at 8), because a couple of picks are already enough to tell a surplus head
 * from a price head, and every further pick spent on the default is one predicted with the wrong head.
 */
export const HEAD_WARMUP = 2;

/** One past pick as the classifier needs to replay it: who took whom, in the order it happened. */
export interface PastPick {
  teamId: number;
  playerId: number;
}

/**
 * Guess what each rival ranks by, by REPLAYING his picks against the pool he actually faced.
 *
 * The evidence has to be the pool AT THE TIME - a man taken in round two was not there in round nine - so
 * the replay walks the picks in order and shrinks the pool as it goes. Scoring a head is «how often would it
 * have named the man he actually took», which is the question the bench scored.
 *
 * A rival below the warm-up, or one no head explains better than the default, is simply absent from the
 * result: that is «we do not know», and it must not read as a discovery.
 */
export function classifyRivals(input: {
  picks: PastPick[];
  pool: PlanPlayer[];
  places: Map<string, number>;
  keeperCap: number;
  mineId: number;
  warmup?: number;
}): Map<number, RivalHead> {
  const byId = new Map(input.pool.map((player) => [player.id, player]));
  let free = [...input.pool];
  const slots = new Map<number, string[]>();
  const score = new Map<number, { picks: number; hits: Record<RivalHead, number> }>();
  const heads = Object.keys(HEAD_WORTH) as RivalHead[];

  for (const pick of input.picks) {
    const player = byId.get(pick.playerId);
    if (player && pick.teamId !== input.mineId) {
      const team = { slots: slots.get(pick.teamId) ?? [] } as PlanTeam;
      let row = score.get(pick.teamId);
      if (!row) {
        row = { picks: 0, hits: { prezzo: 0, surplus: 0, valore: 0 } };
        score.set(pick.teamId, row);
      }
      row.picks += 1;
      for (const head of heads) {
        // Where in the round the pick happened is not recoverable from a list of picks, so the tail rule is
        // off here: a predictor that guessed the tail wrong would be scoring the tail, not the head.
        const says = predictRivalPick(team, free, input.places, input.keeperCap, Infinity, head);
        if (says?.id === player.id) row.hits[head] += 1;
      }
    }
    if (player) {
      free = free.filter((candidate) => candidate.id !== pick.playerId);
      slots.set(pick.teamId, [...(slots.get(pick.teamId) ?? []), player.slot ?? '']);
    }
  }

  const warmup = input.warmup ?? HEAD_WARMUP;
  const guessed = new Map<number, RivalHead>();
  for (const [teamId, row] of score) {
    if (row.picks < warmup) continue;
    let best = DEFAULT_HEAD;
    for (const head of heads) if (row.hits[head] > row.hits[best]) best = head;
    if (best !== DEFAULT_HEAD) guessed.set(teamId, best);
  }
  return guessed;
}

/**
 * What taking a man would REMOVE from the rival who was going to take him.
 *
 * Measured before being written (item 1.5, `metrica-asta-surplus-v1.md` §17): denial is only worth anything
 * if the man would actually be GONE by our next turn - if he is still there we take him then, and taking him
 * now buys nothing. So a note is only ever offered for men the lookahead expects to disappear, and the number
 * is the difference between that rival's best legal eleven with and without him.
 *
 * It stays a NOTE and never becomes a change of pick, and that is the measurement's own verdict: at the most
 * generous defensible rate for this game - you meet each rival once a matchday, so a point taken from one of
 * them is worth about 1/(teams-1) of a point of ours - denial clears its cost on 63-70% of the picks in the
 * first fifteen rounds and on ZERO per cent after the sixteenth, and where it clears it does so by a quarter
 * to two thirds of the cost, never by an order of magnitude.
 *
 * ONE BIAS, stated rather than averaged away: a man the sheet cannot price is not fielded in the rival's
 * eleven, because that is «unknown» and not «zero» - so a rival whose squad we can only half price shows
 * empty places, and any newcomer appears to add his whole worth. The number is therefore an UPPER bound,
 * and the more of his squad we cannot price the looser it is (on the Serie A listone the engine refuses 111
 * men of 433, on the EuroLeghe one far fewer).
 */
export interface Denial {
  teamId: number;
  teamLabel: string;
  /** Fantapunti his best legal eleven would gain from this man - i.e. what taking him denies. */
  points: number;
}

/** A man a squad holds, with what he is worth to it: the pair a weighted eleven needs. */
interface WeighedMan extends Placeable {
  worth: number | null;
}

export function denialOf(
  player: PlanPlayer,
  team: PlanTeam,
  shapes: MantraModules | null,
  worthOf: (playerId: number) => number | null,
): number {
  if (!shapes) return 0;
  const held: WeighedMan[] = team.heldIds.map((id, at) => ({
    roles: team.held[at]?.roles ?? [],
    worth: worthOf(id),
  }));
  const him: WeighedMan = { roles: player.roles.map((role) => role.toLowerCase()), worth: player.value };
  const weigh = (men: WeighedMan[]) => bestElevenWorth(men, shapes, (man) => man.worth);
  return Math.max(0, weigh([...held, him]) - weigh(held));
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
  /** What our squad still has to cover, so all three roots are rationed the way our pick is. */
  need?: CoverNeed | null;
  /** Our own squad: the quota rule counts what we already hold at a role, so it needs the team. */
  mine?: PlanTeam;
  /** Who will be gone before our next turn: a survivor is worth waiting for (`SURVIVOR_DISCOUNT`). */
  gone?: Set<number> | null;
}

export function planRoots(pool: PlanPlayer[], context?: RootsContext): PlanRoot[] {
  const roots: PlanRoot[] = [];
  const need = context?.need ?? null;
  const mine = context?.mine;
  const gone = context?.gone ?? null;
  const best = pickForUs(pool, need, mine, gone);
  if (!best) return roots;
  roots.push({ player: best, why: 'il massimo valore' });

  const bestLine = lineOf(best.slot);
  const elsewhere = pickForUs(pool.filter((player) => lineOf(player.slot) !== bestLine), need, mine, gone);
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
    const holding = pickForUs(affordable, need, mine, gone);
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

/**
 * How many legal elevens our squad should be able to field before depth stops being urgent.
 *
 * TWO, and it is measured rather than chosen: a Mantra squad rosters 22 outfield men against a shape's ten
 * outfield places, so two elevens plus two spares IS the standard roster. Imposing it is the biggest lever
 * in the whole advice - +1.47% of points per matchday against the app's previous rationing, robust on 5
 * windows (4/5, worst −0.64%), with the eleven covered 93.4% → 97.4% of the matchdays and 30 credits LESS
 * spent. One eleven (−5.34%) and three (−4.31%) both lose, so the number is interior and not an edge.
 *
 * ON MANTRA ONLY, and that is a measurement and not a caution: re-run on the ten Serie A windows under
 * CLASSIC legality the same rule LOSES (−1.00%, 4/10), because there `startingPlaces` already sums to
 * exactly ten - a classic module's places are integers, so the quotas are one eleven's worth and need no
 * correction - and insisting on two full elevens over a pool only 20% larger than the draft's own demand
 * buys weak men to fill places that were covered anyway. See `QUOTA_DEPTH` for what ships there.
 */
export const COVER_COPIES = 2;

/**
 * The GRADUATED quota ladder: full while a role's places are uncovered, `QUOTA_DEPTH` up to twice them,
 * `DEPTH_WEIGHT` after.
 *
 * This is what ships on CLASSIC, where it is the only candidate with a verdict: +0.77% of points per
 * matchday, robust, 6 of 10 windows - against −1.00% for the places-based target and −4.93% for no
 * rationing at all. It is also robust on mantra (+0.70%, 4/5), where it is the runner-up, so it is the one
 * rule of the two that never loses; the places-based target keeps mantra because it is worth twice as much
 * there and the project adopts per population when the evidence differs (the gate does the same with R19).
 */
export const QUOTA_DEPTH = 0.7;

/**
 * How our own pick is rationed, and by which of the two measured rules.
 *
 * `places` is the Mantra rule (cover two legal elevens, asked on the module's own typed places); `quotas` is
 * the classic one (the graduated ladder over `startingPlaces`); `none` is «we cannot evaluate either», which
 * must weigh 1 for everybody - a rationing nobody can compute must never become a rationing of zero.
 *
 * `answers` is keyed by ROLE SET because that is what the places question depends on: a listone has a few
 * dozen distinct role sets against a thousand free men, so one augmenting walk per set answers the pool.
 * Rebuild the whole thing whenever our squad changes - it describes exactly that squad.
 */
export type CoverNeed =
  | { kind: 'places'; covered: Covered<Placeable>; answers: Map<string, boolean> }
  | { kind: 'quotas'; places: Map<string, number> }
  | { kind: 'none' };

/**
 * Build the rationing the GAME asks for.
 *
 * `game` decides the rule, not the shapes that happen to be loaded: reading «no shapes» as «no rationing»
 * is how classic ended up unrationed for a day, which the bench prices at −4.93%.
 */
export function coverNeedOf(
  held: Placeable[],
  shapes: MantraModules | null,
  game: 'mantra' | 'classic' = 'mantra',
  copies = COVER_COPIES,
): CoverNeed {
  if (game === 'classic') {
    const places = startingPlaces(shapes);
    return places.size ? { kind: 'quotas', places } : { kind: 'none' };
  }
  const covered = bestCovered(held, shapes, copies);
  return covered ? { kind: 'places', covered, answers: new Map() } : { kind: 'none' };
}

/**
 * How much WE still want a man, under whichever rule this game was measured to need.
 *
 * A man whose codes we do NOT have is discounted on the places rule, and that is «vuoto = ignoto» being
 * bent: he covers nothing because no typed place accepts a role nobody stated. It is left this way because
 * it is exactly what the bench measured - there a man with no Mantra role carries his classic one (`d`, `c`,
 * `a`), which matches no Mantra place either - so the panel and the measurement agree. Worth revisiting with
 * a measurement, not with an opinion.
 */
export function needForUs(need: CoverNeed | null, player: PlanPlayer, team?: PlanTeam): number {
  if (!need || need.kind === 'none') return 1;
  if (need.kind === 'quotas') {
    if (!player.slot || !team) return DEPTH_WEIGHT;
    const wanted = need.places.get(player.slot) ?? 1;
    const held = team.slots.filter((slot) => slot === player.slot).length;
    if (held < wanted) return 1;
    return held < 2 * wanted ? QUOTA_DEPTH : DEPTH_WEIGHT;
  }
  const roles = player.roles.length ? player.roles.map((role) => role.toLowerCase()) : [];
  if (!roles.length) return DEPTH_WEIGHT;
  const key = roles.join('|');
  let helps = need.answers.get(key);
  if (helps === undefined) {
    helps = augments(need.covered.matching, need.covered.places, roles);
    need.answers.set(key, helps);
  }
  return helps ? 1 : DEPTH_WEIGHT;
}

/**
 * Our own pick: the best gross worth we can see, rationed by what our squad still has to cover.
 *
 * Two measured decisions in one line, both from the five-window draft bench (§16):
 *   * the currency is the VALUE and not the net (see `PlanPlayer.value`);
 *   * the rationing is coverage of TWO legal elevens (see `COVER_COPIES`).
 * A negative worth divides by the weight instead of multiplying, because multiplying would RAISE it - the
 * discount has to stay a discount on both sides of zero.
 *
 * Falls back to the price when nothing is priced at all, which is the behaviour this function has always
 * had for a man the sheet cannot value.
 */
export function pickForUs(
  pool: PlanPlayer[],
  need: CoverNeed | null = null,
  team?: PlanTeam,
  gone?: Set<number> | null,
): PlanPlayer | null {
  let best: PlanPlayer | null = null;
  let bestScore = -Infinity;
  const scoreOf = (player: PlanPlayer) => {
    const worth = player.value ?? player.net;
    if (worth == null) return -Infinity;
    const want = needForUs(need, player, team);
    // A man who will still be there next round is worth waiting for: the discount is what was measured.
    const survives = gone && !gone.has(player.id) ? SURVIVOR_DISCOUNT : 1;
    return worth >= 0 ? worth * want * survives : (worth / want) / survives;
  };
  for (const player of pool) {
    const score = scoreOf(player);
    if (best === null || score > bestScore || (score === bestScore && player.price > best.price)) {
      best = player;
      bestScore = score;
    }
  }
  return best;
}

/**
 * What a survivor is worth next to a man who will be GONE by our next turn.
 *
 * This is the biggest lever measured on the whole draft bench and it uses no informational edge at all: the
 * rivals rank by the price, so the dear men disappear and the cheap ones survive - which means two candidates
 * we rate the same are not equivalent. The dear one has to be taken NOW or lost; the cheap one can be
 * harvested next round. Buying the survivor first spends a pick on what waiting would have given for free.
 *
 * Measured on the five gate windows (`metrica-asta-surplus-v1.md` §18), gain over the adopted value policy:
 * **+4.54%** of points per matchday, **5 of 5 windows, STRICT** - three times the coverage constraint, which
 * was the previous biggest lever, and the only strict verdict this bench has produced. The parameter is
 * interior (0.85 → +3.76%, 0.70 → +4.54%, 0.50 → +4.16%) and 1.0 is the rule switched off, which is the
 * baseline. The spend rises from 299 to 345 credits, which IS the mechanism: it buys what would be gone.
 *
 * What it is allowed to know is only what the table shows: the ORDER (the platform's own rule), the rivals'
 * squads, and a policy for their heads. It never sees the future - it simulates it, and it was measured with
 * the WEAKER assumption available (one price head for everybody) rather than with the estimated heads, so the
 * classifier of §17.1 can only help from here.
 */
export const SURVIVOR_DISCOUNT = 0.7;

/**
 * Who will be taken between now and our next turn, simulated with the platform's own order rule.
 *
 * It is the same walk `plan()` does, minus ourselves: the rest of this round, then the next round up to our
 * slot. Ours is left out on purpose - the set has to be knowable BEFORE we choose, or the pick would depend on
 * itself.
 */
export function goneBeforeOurNextTurn(input: {
  teams: PlanTeam[];
  order: number[];
  pool: PlanPlayer[];
  places: Map<string, number>;
  mineId: number;
  keeperCap: number;
  maxAheadPicks: number;
  heads?: Map<number, RivalHead>;
}): Set<number> {
  const gone = new Set<number>();
  const teams = new Map(input.teams.map((team) => [team.id, team]));
  const order = input.order.filter((id) => teams.has(id));
  const myPlace = order.indexOf(input.mineId);
  if (myPlace < 0) return gone;
  let pool = [...input.pool];

  const step = (id: number, placesFromEnd: number) => {
    const team = teams.get(id);
    if (!team) return;
    const choice = predictRivalPick(team, pool, input.places, input.keeperCap, placesFromEnd,
                                    input.heads?.get(id) ?? DEFAULT_HEAD);
    if (!choice) return;
    pool = pool.filter((player) => player.id !== choice.id);
    teams.set(id, take(team, choice));
    gone.add(choice.id);
  };

  const after = order.slice(myPlace + 1);
  for (const [index, id] of after.entries()) step(id, after.length - index);

  const next = [...teams.values()]
    .sort((a, b) => ahead(a, b, input.maxAheadPicks))
    .map((team) => team.id);
  for (const [index, id] of next.entries()) {
    if (id === input.mineId) break;
    step(id, next.length - index);
  }
  return gone;
}

/** The platform's own comparison, in the order its `compare()` applies it. */
export function ahead(a: PlanTeam, b: PlanTeam, maxAheadPicks: number): number {
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
    // The roles travel too, or our coverage would stop moving after the first simulated pick and every
    // later round would ration against the squad we started with.
    held: [...team.held, { roles: player.roles.map((role) => role.toLowerCase()) }],
    heldIds: [...team.heldIds, player.id],
    rosterValue: team.rosterValue + player.price,
    pickValues: [...team.pickValues, player.price],
    picksCount: team.picksCount + 1,
  };
}

export interface PlanInput {
  teams: PlanTeam[];
  /** What a man is worth to whoever holds him, by id: the weight a rival's eleven is measured with. */
  worthOf?: (playerId: number) => number | null;
  /** The order as the host publishes it: index 0 is on the clock. */
  order: number[];
  pool: PlanPlayer[];
  mineId: number;
  shapes: MantraModules | null;
  /** How many keepers a squad may hold - the session's own slot count. */
  keeperCap: number;
  /** Which game is being played: it decides which of the two measured rationing rules applies. */
  game?: 'mantra' | 'classic';
  /**
   * What each rival ranks by, guessed from his own picks (`classifyRivals`). A team absent from the map
   * keeps the default head, which is «the dearest man he still needs» - the panel's old single assumption,
   * now the fallback for a rival who has not shown enough.
   */
  heads?: Map<number, RivalHead>;
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

  // What WE still have to cover, rebuilt after every pick of ours: it describes one squad, and a memo of a
  // squad that has changed would ration the next round against the one we started with.
  const needNow = () => coverNeedOf(teams.get(input.mineId)?.held ?? [], input.shapes, input.game);
  const meNow = () => teams.get(input.mineId);
  const goneNow = (from: number[]) => goneBeforeOurNextTurn({
    teams: [...teams.values()], order: from, pool, places, mineId: input.mineId,
    keeperCap: input.keeperCap, maxAheadPicks: input.maxAheadPicks, heads: input.heads,
  });
  const mine = input.rootId !== undefined
    ? (pool.find((player) => player.id === input.rootId) ?? pickForUs(pool, needNow(), meNow(), goneNow(order)))
    : pickForUs(pool, needNow(), meNow(), goneNow(order));
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
    const choice = predictRivalPick(team, pool, places, input.keeperCap, after.length - index,
                                    input.heads?.get(id) ?? DEFAULT_HEAD);
    if (!choice) break;
    const denies = input.worthOf ? denialOf(choice, team, input.shapes, input.worthOf) : 0;
    pool = pool.filter((player) => player.id !== choice.id);
    teams.set(id, take(team, choice));
    restOfRound.push({ teamId: id, teamLabel: team.label, player: choice, predicted: true, denies });
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
        ours = pickForUs(pool, needNow(), meNow(), goneNow(nextOrder));
        if (ours) {
          pool = pool.filter((player) => player.id !== ours!.id);
          teams.set(id, take(teams.get(id)!, ours));
        }
        passed = true;
        continue;
      }
      const team = teams.get(id)!;
      const choice = predictRivalPick(team, pool, places, input.keeperCap,
                                      nextOrder.length - index,
                                      input.heads?.get(id) ?? DEFAULT_HEAD);
      if (!choice) break;
      const denies = input.worthOf ? denialOf(choice, team, input.shapes, input.worthOf) : 0;
      pool = pool.filter((player) => player.id !== choice.id);
      teams.set(id, take(team, choice));
      (passed ? roundAfter : roundBefore).push({
        teamId: id, teamLabel: team.label, player: choice, predicted: true, denies,
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
